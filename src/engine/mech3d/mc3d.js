// 3D MC 추적기 — spec 2026-10-14 §6.1. 부품 메쉬 장면(scene3d.buildTraceScene)을 확률 선택(가중 불변) 방식으로 추적.
// 매질 스택: 광자가 들어가 있는 투과성 부품(맨 위 = 현재 매질, 빈 스택 = 공기). 규칙은 P2 계획 "물리 규칙" 절 참고.
// onExit(part, face, x,y,z, dx,dy,dz, w): 투과성 부품에서 공기로 나갈 때. onEscape(x,y,z, dx,dy,dz, w): 공기 중 무한 탈출.
import { intersectRay } from './bvh.js';
import { fresnelInterface, reflectFinish } from './surface.js';
import { rng } from '../l2/mc-slab.js';

const OFF = 1e-5, T_MIN = 1e-7;

function sampleHG(g, u) {
  if (Math.abs(g) < 1e-6) return 2 * u - 1;
  const f = (1 - g * g) / (1 - g + 2 * g * u);
  return (1 + g * g - f * f) / (2 * g);
}

// 공기막(맞붙은 '공기층' 면): 매질 A(nA) 쪽에서 막에 닿음. B = { n }(투과성) | { fin }(불투명 면 처리).
// 막 안 다중 반사를 끝까지 풀어 { dir, into: 'A'|'B' } 또는 null(흡수) 반환.
function filmCross(dx, dy, dz, Nx, Ny, Nz, nA, B, rnd) {
  const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nA, 1);
  if (f.R >= 1 || rnd() < f.R) return { dir: [f.rx, f.ry, f.rz], into: 'A' };
  let d = [f.tx, f.ty, f.tz];
  for (let k = 0; k < 100; k++) {
    if (B.fin) { const r = reflectFinish(B.fin, d[0], d[1], d[2], Nx, Ny, Nz, rnd); if (!r) return null; d = r; }
    else {
      const g = fresnelInterface(d[0], d[1], d[2], Nx, Ny, Nz, 1, B.n);
      if (!(g.R >= 1 || rnd() < g.R)) return { dir: [g.tx, g.ty, g.tz], into: 'B' };
      d = [g.rx, g.ry, g.rz];
    }
    const h = fresnelInterface(d[0], d[1], d[2], Nx, Ny, Nz, 1, nA);
    if (!(h.R >= 1 || rnd() < h.R)) return { dir: [h.tx, h.ty, h.tz], into: 'A' };
    d = [h.rx, h.ry, h.rz];
  }
  return null;   // 막 안 무한 반사(수치) — 흡수로 처리
}

export function runMC3D(S, { source, N, seed = 1, onExit = null, onEscape = null, wMinRel = 1e-3, maxEvents = 100000 }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rnd = rng(seed), w0 = source.flux / N, wMin = w0 * wMinRel;
  const L = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const { optics, normals: NM, partOf, faceOf, fins, finOf, contact, film } = S;
  const nOf = (q) => (q < 0 ? 1 : optics[q].n);
  const stack = [];
  for (let p = 0; p < N; p++) {
    L.emitted += w0;
    let [px, py, pz, dx, dy, dz] = source.sample(rnd), w = w0;
    stack.length = 0;
    for (let e = 0; ; e++) {
      if (e > maxEvents) { L.lost += w; break; }
      const cur = stack.length ? stack[stack.length - 1] : -1, med = cur >= 0 ? optics[cur] : null;
      const sFree = med && med.mus > 0 ? -Math.log(1 - rnd()) / med.mus : Infinity;
      const h = intersectRay(S.bvh, px, py, pz, dx, dy, dz, T_MIN, sFree);
      if (!h && !Number.isFinite(sFree)) {
        if (cur >= 0) { L.lost += w; break; }   // 매질 안에서 교차 없음 = 열린 메쉬(진단)
        L.escaped += w; if (onEscape) onEscape(px, py, pz, dx, dy, dz, w); break;
      }
      const t = h ? h.t : sFree;
      px += t * dx; py += t * dy; pz += t * dz;
      if (med && med.mua > 0) { const a = w * (1 - Math.exp(-med.mua * t)); L.absVol += a; w -= a; }
      if (!h) {   // 체적 산란
        const cth = med.phase ? med.phase.sample(rnd()) : sampleHG(med.g, rnd()), sth = Math.sqrt(Math.max(0, 1 - cth * cth));
        const phi = 2 * Math.PI * rnd(), cp = Math.cos(phi), sp = Math.sin(phi);
        if (Math.abs(dz) > 0.99999) { dx = sth * cp; dy = sth * sp; dz = Math.sign(dz) * cth; }
        else {
          const tmp = Math.sqrt(1 - dz * dz);
          const nx2 = sth * (dx * dz * cp - dy * sp) / tmp + dx * cth, ny2 = sth * (dy * dz * cp + dx * sp) / tmp + dy * cth, nz2 = -sth * cp * tmp + dz * cth;
          dx = nx2; dy = ny2; dz = nz2;
        }
      } else {
        const tri = h.tri, q = partOf[tri], face = faceOf[tri];
        const Nx = NM[tri * 3], Ny = NM[tri * 3 + 1], Nz = NM[tri * 3 + 2];
        const entering = dx * Nx + dy * Ny + dz * Nz < 0;
        let dir = null, absorbed = false;
        const reflectBy = (fin) => { const r = reflectFinish(fin, dx, dy, dz, Nx, Ny, Nz, rnd); if (r) dir = r; else absorbed = true; };
        // 공기막 결과 반영: into B 면 cur 를 빼고 b 로 들어감(b < 0 = 불투명이라 진입 없음)
        const viaFilm = (B, b) => {
          const r = filmCross(dx, dy, dz, Nx, Ny, Nz, nOf(cur), B, rnd);
          if (!r) { absorbed = true; return; }
          dir = r.dir;
          if (r.into === 'B' && b >= 0) { stack.splice(stack.lastIndexOf(cur), 1); stack.push(b); }
        };
        const fm = film.get(`${q}|${face}`);
        if (!optics[q].transmissive) {
          if (cur >= 0 && fm && fm.part === cur) viaFilm({ fin: fins[finOf[tri]] }, -1);   // 불투명 면과 공기막을 두고 맞붙음
          else reflectBy(fins[finOf[tri]]);
        }
        else if (entering ? stack.includes(q) : !stack.includes(q)) { /* 겹친 접촉면 — 통과 */ }
        else if (fins[finOf[tri]].kind !== 'gloss') reflectBy(fins[finOf[tri]]);   // 반사형 코팅(양면)
        else {
          const ct = contact.get(`${q}|${face}`);
          if (entering) {
            if (ct && ct.part === cur) {   // 접촉면을 상대 쪽 삼각형으로 먼저 만남: cur → q 직접 굴절
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nOf(cur), nOf(q));
              if (f.R >= 1 || rnd() < f.R) dir = [f.rx, f.ry, f.rz];
              else { dir = [f.tx, f.ty, f.tz]; stack.pop(); stack.push(q); }
            } else if (cur >= 0) viaFilm({ n: nOf(q) }, q);   // 다른 투과 부품 안에서 q 진입 = 맞붙은 공기막
            else {
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, 1, nOf(q));
              if (rnd() < f.R) dir = [f.rx, f.ry, f.rz]; else { dir = [f.tx, f.ty, f.tz]; stack.push(q); }
            }
          } else if (!ct && fm) {   // 공기막을 두고 맞붙은 상대 면이 같은 자리에 있음 — 여기서 함께 처리
            viaFilm(optics[fm.part].transmissive ? { n: nOf(fm.part) } : { fin: S.finishOfFace(fm.part, fm.face) }, optics[fm.part].transmissive ? fm.part : -1);
          } else {
            let other;
            if (ct) other = ct.part;
            else { other = -1; for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== q) { other = stack[i]; break; } }
            if (other >= 0 && !optics[other].transmissive) reflectBy(S.finishOfFace(other, ct.face));   // 불투명 부품과 맞닿은 면
            else {
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nOf(cur), nOf(other));
              if (f.R >= 1 || rnd() < f.R) dir = [f.rx, f.ry, f.rz];
              else {
                dir = [f.tx, f.ty, f.tz];
                stack.splice(stack.lastIndexOf(q), 1);
                if (other >= 0 && stack[stack.length - 1] !== other) stack.push(other);
                if (!stack.length && onExit) onExit(q, face, px, py, pz, f.tx, f.ty, f.tz, w);
              }
            }
          }
        }
        if (absorbed) { L.absSurf += w; break; }
        if (dir) {
          const l = Math.hypot(dir[0], dir[1], dir[2]);
          dx = dir[0] / l; dy = dir[1] / l; dz = dir[2] / l;
        }
      }
      px += OFF * dx; py += OFF * dy; pz += OFF * dz;
      if (w < wMin) {
        if (rnd() < 0.1) { L.rrGain += 9 * w; w *= 10; } else { L.rrLoss += w; break; }
      }
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { ledger: L, ms: t1 - t0 };
}
