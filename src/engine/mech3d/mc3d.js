// 3D MC 추적기 — spec 2026-10-14 §6.1. 부품 메쉬 장면(scene3d.buildTraceScene)을 확률 선택(가중 불변) 방식으로 추적.
// 매질 스택: 광자가 들어가 있는 투과성 부품(맨 위 = 현재 매질, 빈 스택 = 공기). 규칙은 P2 계획 "물리 규칙" 절 참고.
// 맞붙은 면은 면 단위가 아니라 **점 단위**로 판정한다: 면에 닿은 점에서 다른 부품의 반대 법선 삼각형이
//   허용 간격 안에 겹쳐 있으면 짝(coincident) 면이다. 허용 간격: 두 법선이 1e-4 이내로 반평행(평면)이면 0.02mm(spec §3.4),
//   아니면 0.04mm(곡면 테셀레이션 현 오차). 짝의 모드는 contacts 지정('contact'|'air'), 지정이 없으면 광학 접촉(spec §3.4 기본).
//   전이는 이 한 번의 충돌에서 처리하고, 그 전이의 정확한 두 면 (부품, 면) 이 같은 자리(허용 간격 이내)에서 다시 잡히면 통과한다.
// 수치: 사건 뒤 출발점을 옮기지 않고 직전 적중 삼각형을 다음 광선에서 제외한다(tMin = 0). 체적 산란 뒤에는 제외 없음.
// 비용: Milky 가 매우 높으면(≥ 9.5) 광자당 수 ms 가 든다 — P4 에서 사건 예산(event budget)을 둔다.
// 편광: 광자마다 전기장 단위벡터 E ⟂ d 를 추적한다(Fresnel s/p 분리). 확산 반사·면 처리·체적 산란 뒤에는 무작위화.
// onExit(part, face, x,y,z, dx,dy,dz, w): 투과성 부품에서 공기로 나가는 **모든** 전이(내부 공기 틈 포함 — 이후 다른 부품에
//   다시 들어갈 수 있음). onEscape(x,y,z, dx,dy,dz, w): 공기 중 무한 탈출 = 원거리장 총량.
import { intersectRay, queryBox } from './bvh.js';
import { fresnelPolarized, reflectFinish, randomPolarization } from './surface.js';
import { rng } from '../l2/mc-slab.js';

const COIN_GAP_PLANAR = 0.02, COIN_GAP = 0.04, COIN_PLANAR_DOT = -(1 - 1e-4), COIN_DOT = -0.97, COIN_BOX = 0.05, COIN_BARY = 1e-6;

function sampleHG(g, u) {
  if (Math.abs(g) < 1e-6) return 2 * u - 1;
  const f = (1 - g * g) / (1 - g + 2 * g * u);
  return (1 + g * g - f * f) / (2 * g);
}

// 다른 부품의 반대 법선 삼각형이 근처에 있을 수 있는 삼각형 표시(점 단위 판정의 사전 거름) — 장면별 캐시
const coinCache = new WeakMap();
function coinFlags(S) {
  if (coinCache.has(S)) return coinCache.get(S);
  const { P, T, normals: NM, partOf, bvh } = S, nT = partOf.length, flag = new Uint8Array(nT), buf = [];
  for (let t = 0; t < nT; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { const v = P[T[t * 3 + k] * 3 + c]; lo[c] = Math.min(lo[c], v - COIN_BOX); hi[c] = Math.max(hi[c], v + COIN_BOX); }
    queryBox(bvh, lo, hi, buf);
    for (const c of buf) {
      if (partOf[c] === partOf[t]) continue;
      if (NM[t * 3] * NM[c * 3] + NM[t * 3 + 1] * NM[c * 3 + 1] + NM[t * 3 + 2] * NM[c * 3 + 2] <= COIN_DOT) { flag[t] = 1; break; }
    }
  }
  coinCache.set(S, flag);
  return flag;
}

export function runMC3D(S, { source, N, seed = 1, onExit = null, onEscape = null, wMinRel = 1e-3, maxEvents = 100000 }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rnd = rng(seed), w0 = source.flux / N, wMin = w0 * wMinRel;
  const L = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const { P, T, optics, normals: NM, partOf, faceOf, fins, finOf, contact, film, bvh } = S;
  const nOf = (q) => (q < 0 ? 1 : optics[q].n);
  const flag = coinFlags(S), qbuf = [], lo = [0, 0, 0], hi = [0, 0, 0];

  // 점 (x,y,z) 에서 tri 와 맞붙은 다른 부품 삼각형(없으면 −1)
  let partnerTol = 0;   // 마지막 partnerAt 짝의 간격 허용치
  function partnerAt(tri, x, y, z) {
    if (!flag[tri]) return -1;
    lo[0] = x - COIN_BOX; lo[1] = y - COIN_BOX; lo[2] = z - COIN_BOX; hi[0] = x + COIN_BOX; hi[1] = y + COIN_BOX; hi[2] = z + COIN_BOX;
    queryBox(bvh, lo, hi, qbuf);
    const q = partOf[tri], Nx = NM[tri * 3], Ny = NM[tri * 3 + 1], Nz = NM[tri * 3 + 2];
    let best = -1, bestD = Infinity;
    partnerTol = 0;
    for (const c of qbuf) {
      if (partOf[c] === q) continue;
      const cx = NM[c * 3], cy = NM[c * 3 + 1], cz = NM[c * 3 + 2];
      const dot = Nx * cx + Ny * cy + Nz * cz;
      if (dot > COIN_DOT) continue;
      const tol = dot <= COIN_PLANAR_DOT ? COIN_GAP_PLANAR : COIN_GAP;   // 평면 0.02mm(spec §3.4), 곡면(현 오차) 0.04mm
      const a = T[c * 3] * 3, b = T[c * 3 + 1] * 3, e = T[c * 3 + 2] * 3;
      const dist = (x - P[a]) * cx + (y - P[a + 1]) * cy + (z - P[a + 2]) * cz;
      if (Math.abs(dist) > tol || Math.abs(dist) >= bestD) continue;
      // 평면 투영점의 무게중심 좌표
      const px = x - dist * cx - P[a], py = y - dist * cy - P[a + 1], pz = z - dist * cz - P[a + 2];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[e] - P[a], vy = P[e + 1] - P[a + 1], vz = P[e + 2] - P[a + 2];
      const uu = ux * ux + uy * uy + uz * uz, uv = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const pu = px * ux + py * uy + pz * uz, pv = px * vx + py * vy + pz * vz, den = uu * vv - uv * uv;
      if (!(den > 0)) continue;
      const s = (vv * pu - uv * pv) / den, t = (uu * pv - uv * pu) / den;
      if (s < -COIN_BARY || t < -COIN_BARY || s + t > 1 + COIN_BARY) continue;
      best = c; bestD = Math.abs(dist); partnerTol = tol;
    }
    return best;
  }
  // 짝 면의 모드: contacts 지정 우선, 없으면 광학 접촉
  const modeOf = (q, f, q2) => {
    const c = contact.get(`${q}|${f}`); if (c && c.part === q2) return 'contact';
    const m = film.get(`${q}|${f}`); if (m && m.part === q2) return 'air';
    return 'contact';
  };

  const stack = [];
  for (let p = 0; p < N; p++) {
    L.emitted += w0;
    let [px, py, pz, dx, dy, dz] = source.sample(rnd), w = w0;
    let [ex, ey, ez] = randomPolarization(dx, dy, dz, rnd);
    // 직전 짝 면 전이의 정확한 두 면 (부품, 면) — 같은 자리의 짝 면 적중만 통과(얇은 부품의 반대면은 통과하지 않음)
    let skipPA = -1, skipFA = -1, skipPB = -1, skipFB = -1, skipTol = 0, skipX = 0, skipY = 0, skipZ = 0, skipNx = 0, skipNy = 0, skipNz = 0;
    let lastTri = -1, lastTri2 = -1;   // 직전 적중 삼각형(+ 맞붙은 짝 삼각형) — 다음 광선에서 제외(출발점 이동 없음, tMin = 0)
    stack.length = 0;
    for (let e = 0; ; e++) {
      if (e > maxEvents) { L.lost += w; break; }
      const cur = stack.length ? stack[stack.length - 1] : -1, med = cur >= 0 ? optics[cur] : null;
      const sFree = med && med.mus > 0 ? -Math.log(1 - rnd()) / med.mus : Infinity;
      const h = intersectRay(bvh, px, py, pz, dx, dy, dz, 0, sFree, lastTri, lastTri2);
      if (!h && !Number.isFinite(sFree)) {
        if (cur >= 0) { L.lost += w; break; }   // 매질 안에서 교차 없음 = 열린 메쉬(진단)
        L.escaped += w; if (onEscape) onEscape(px, py, pz, dx, dy, dz, w); break;
      }
      const t = h ? h.t : sFree;
      px += t * dx; py += t * dy; pz += t * dz;
      if (med && med.mua > 0) { const a = w * (1 - Math.exp(-med.mua * t)); L.absVol += a; w -= a; }
      if (!h) {   // 체적 산란
        skipPA = -1; lastTri = -1; lastTri2 = -1;
        const cth = med.phase ? med.phase.sample(rnd()) : sampleHG(med.g, rnd()), sth = Math.sqrt(Math.max(0, 1 - cth * cth));
        const phi = 2 * Math.PI * rnd(), cp = Math.cos(phi), sp = Math.sin(phi);
        if (Math.abs(dz) > 0.99999) { dx = sth * cp; dy = sth * sp; dz = Math.sign(dz) * cth; }
        else {
          const tmp = Math.sqrt(1 - dz * dz);
          const nx2 = sth * (dx * dz * cp - dy * sp) / tmp + dx * cth, ny2 = sth * (dy * dz * cp + dx * sp) / tmp + dy * cth, nz2 = -sth * cp * tmp + dz * cth;
          dx = nx2; dy = ny2; dz = nz2;
        }
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        [ex, ey, ez] = randomPolarization(dx, dy, dz, rnd);
      } else {
        const tri = h.tri, q = partOf[tri], face = faceOf[tri];
        const Nx = NM[tri * 3], Ny = NM[tri * 3 + 1], Nz = NM[tri * 3 + 2];
        const prevTri = lastTri;
        lastTri = tri; lastTri2 = -1;
        // 직전 짝 면 전이의 바로 그 두 면 중 하나이고 전이 지점 평면에서 허용 간격 이내 — 이미 처리했으므로 통과
        if (skipPA >= 0 && ((q === skipPA && face === skipFA) || (q === skipPB && face === skipFB))
          && Math.abs(Nx * skipNx + Ny * skipNy + Nz * skipNz) > -COIN_DOT
          && Math.abs((px - skipX) * skipNx + (py - skipY) * skipNy + (pz - skipZ) * skipNz) <= skipTol + 1e-6) { lastTri2 = prevTri; continue; }   // 짝 두 삼각형 모두 제외(t≈0 핑퐁 방지)
        skipPA = -1;
        const entering = dx * Nx + dy * Ny + dz * Nz < 0;
        let dir = null, E = null, absorbed = false, lost = false;
        const nCur = nOf(cur);
        const reflectBy = (fin) => { const r = reflectFinish(fin, dx, dy, dz, Nx, Ny, Nz, rnd, nCur); if (r) { dir = r; E = null; } else absorbed = true; };
        // 편광 Fresnel n1 → n2: 반사면 true
        const fresnel = (n1, n2) => {
          const f = fresnelPolarized(dx, dy, dz, ex, ey, ez, Nx, Ny, Nz, n1, n2);
          if (f.R >= 1 || rnd() < f.R) { dir = [f.rx, f.ry, f.rz]; E = [f.erx, f.ery, f.erz]; return true; }
          dir = [f.tx, f.ty, f.tz]; E = [f.etx, f.ety, f.etz]; return false;
        };
        const tri2 = partnerAt(tri, px, py, pz);
        if (tri2 >= 0) {
          // 짝 면: 이탈하는 부품 A → 들어가는 부품 B (진입 q ⇔ 짝 부품에서 이탈)
          const q2 = partOf[tri2], triA = entering ? tri2 : tri, triB = entering ? tri : tri2, A = partOf[triA], B = partOf[triB];
          const mode = modeOf(q, face, q2);
          if (!optics[A].transmissive) lost = true;   // 불투명 부품 안에서 출발(진단)
          else if (fins[finOf[triA]].kind !== 'gloss') reflectBy(fins[finOf[triA]]);   // A 면의 반사형 코팅
          else if (optics[B].transmissive && fins[finOf[triB]].kind !== 'gloss') reflectBy(fins[finOf[triB]]);
          else if (mode === 'contact') {
            if (!optics[B].transmissive) reflectBy(fins[finOf[triB]]);   // 불투명 부품에 접착
            else if (!fresnel(nCur, nOf(B))) { const i = stack.lastIndexOf(A); if (i >= 0) stack.splice(i, 1); stack.push(B); }
          } else {
            const r = filmCross(optics[B].transmissive ? { n: nOf(B) } : { fin: fins[finOf[triB]] });
            if (r === 'B' && optics[B].transmissive) { const i = stack.lastIndexOf(A); if (i >= 0) stack.splice(i, 1); stack.push(B); }
          }
          lastTri2 = tri2;
          skipPA = A; skipFA = faceOf[triA]; skipPB = B; skipFB = faceOf[triB]; skipTol = partnerTol; skipX = px; skipY = py; skipZ = pz; skipNx = Nx; skipNy = Ny; skipNz = Nz;
        } else if (!optics[q].transmissive) {
          if (entering) reflectBy(fins[finOf[tri]]);
          else lost = true;   // 불투명 부품 안쪽에서 닿음(진단)
        }
        else if (entering ? stack.includes(q) : !stack.includes(q)) { /* 겹친 부품의 경계 — 통과 */ }
        else if (fins[finOf[tri]].kind !== 'gloss') reflectBy(fins[finOf[tri]]);   // 반사형 코팅(양면)
        else if (entering) { if (!fresnel(nCur, nOf(q))) stack.push(q); }   // 공기 또는 다른 부품 안(중첩)에서 진입
        else {
          let other = -1;
          for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== q) { other = stack[i]; break; }
          if (!fresnel(nCur, nOf(other))) {
            stack.splice(stack.lastIndexOf(q), 1);
            if (other >= 0 && stack[stack.length - 1] !== other) stack.push(other);
            if (!stack.length && onExit) onExit(q, face, px, py, pz, dir[0], dir[1], dir[2], w);
          }
        }
        if (lost) { L.lost += w; break; }
        if (absorbed) { L.absSurf += w; break; }
        if (dir) {
          const l = Math.hypot(dir[0], dir[1], dir[2]);
          dx = dir[0] / l; dy = dir[1] / l; dz = dir[2] / l;
          if (E) { ex = E[0]; ey = E[1]; ez = E[2]; } else [ex, ey, ez] = randomPolarization(dx, dy, dz, rnd);
        }

        // 공기막(맞붙은 '공기층' 면): 현재 매질(nCur) → 공기 → B. B = { n }(투과성) | { fin }(불투명 면 처리).
        // 막 안 다중 반사를 끝까지 풀어 dir·E 를 정하고 'A' | 'B' 반환(흡수면 absorbed). 최대 100회, 넘으면 흡수.
        function filmCross(Bm) {
          if (fresnel(nCur, 1)) return 'A';
          for (let k = 0; k < 100; k++) {
            const sx = dx, sy = dy, sz = dz, sex = ex, sey = ey, sez = ez;
            dx = dir[0]; dy = dir[1]; dz = dir[2]; ex = E[0]; ey = E[1]; ez = E[2];   // 막 안 광선
            if (Bm.fin) {
              const r = reflectFinish(Bm.fin, dx, dy, dz, Nx, Ny, Nz, rnd, 1);
              if (!r) { absorbed = true; dx = sx; dy = sy; dz = sz; ex = sex; ey = sey; ez = sez; return null; }
              const l = Math.hypot(r[0], r[1], r[2]); dir = [r[0] / l, r[1] / l, r[2] / l]; E = randomPolarization(dir[0], dir[1], dir[2], rnd);
            } else if (!fresnel(1, Bm.n)) { dx = sx; dy = sy; dz = sz; ex = sex; ey = sey; ez = sez; return 'B'; }
            dx = dir[0]; dy = dir[1]; dz = dir[2]; ex = E[0]; ey = E[1]; ez = E[2];   // 막 안에서 A 쪽으로
            const back = !fresnel(1, nCur);
            dx = sx; dy = sy; dz = sz; ex = sex; ey = sey; ez = sez;
            if (back) return 'A';
          }
          absorbed = true;
          return null;
        }
      }
      if (w < wMin) {
        if (rnd() < 0.1) { L.rrGain += 9 * w; w *= 10; } else { L.rrLoss += w; break; }
      }
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { ledger: L, ms: t1 - t0 };
}
