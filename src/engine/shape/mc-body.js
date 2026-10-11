// S1 — 형상 몸체 MC 기준 추적기 (spec 2026-10-10 §4.1). 순수 JS — Node·Worker 공용.
// 기하: 2.5D 높이맵(셀 = 꼭짓점 높이 4개의 사각 패치 → 대각선 2삼각형 평면), 마스크 경계 = 수직 측벽,
//       캐비티 측벽(수직 평면, z ≤ 깊이), PCB(z=0). 좌표: 툴 좌표(mm), 몸체 높이 = depth + 높이맵 z.
// 물리: Fresnel(비편광)·TIR — 상면 탈출은 부분 탈출 가중, 그 외 계면은 확률 선택, 체적 산란(HG 또는 표 샘플러)·흡수, PCB Lambertian ρ_b, 측벽 모델.
import { fresnelR, relIntensity, lambertianExponent, gaussianSigma } from '../photometry.js';
import { rng } from '../l2/mc-slab.js';

const NONE = 0, TOP = 1, BOT = 2, SIDE = 3, PCB = 4, WALL = 5, ESC_SIDE = 6, ESC_UP = 7;
const KIND = ['none', 'top', 'bot', 'side', 'pcb', 'wall', 'escSide', 'escUp'];
const OFF = 1e-7;            // 계면 사건 후 출발점 이동(mm)
export const F_SCAT = 1, F_REFL = 2;   // 가지 이력: 산란 / 반사(계면·PCB·측벽)

// 높이맵 → 장면. hf: heightfield.js 형식(셀 중심 값), ox·oy: 높이맵 원점의 툴 좌표, depth: 윗면 기준 높이.
// medium: { mus, g, mua } (없으면 투명·무흡수), phase: { sample(u)→cosθ } (없으면 HG(g)),
// walls: { x0,x1,y0,y1, mode:'absorb'|'fresnel'|'diffuse', R?, n? } 또는 null(열린 영역 — 격자 밖 = 측면 탈출).
export function makeScene({ hf, ox, oy, depth, n, medium = null, phase = null, rhoB = 0, walls = null }) {
  const { nx, ny, cell: c, mask } = hf, NX = nx + 1;
  const ct = new Float64Array(NX * (ny + 1)), cb = new Float64Array(NX * (ny + 1));
  let zMinBot = Infinity, zMaxTop = -Infinity;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    let st = 0, sb = 0, w = 0;
    for (let jj = j - 1; jj <= j; jj++) for (let ii = i - 1; ii <= i; ii++) {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const k = jj * nx + ii;
      if (mask[k]) { st += hf.zt[k]; sb += hf.zb[k]; w++; }
    }
    const k = j * NX + i;
    if (w) { ct[k] = depth + st / w; cb[k] = depth + sb / w; if (cb[k] < zMinBot) zMinBot = cb[k]; if (ct[k] > zMaxTop) zMaxTop = ct[k]; }
  }
  // 셀별 높이 범위(꼭짓점 4개): 선분의 z 범위가 몸체 안(바닥 최대 < z < 윗면 최소) 또는 밖(바닥 최소 아래·윗면 최대 위)이면
  // 평면 교차 검사 생략 — 평탄·완만한 영역에서 교차 비용 대부분 제거(결과 동일)
  const cTmin = new Float64Array(nx * ny), cTmax = new Float64Array(nx * ny), cBmin = new Float64Array(nx * ny), cBmax = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * NX + i, q = j * nx + i, a = ct[k], b = ct[k + 1], c2 = ct[k + NX], d = ct[k + NX + 1], e = cb[k], f = cb[k + 1], g2 = cb[k + NX], h = cb[k + NX + 1];
    cTmin[q] = Math.min(a, b, c2, d); cTmax[q] = Math.max(a, b, c2, d); cBmin[q] = Math.min(e, f, g2, h); cBmax[q] = Math.max(e, f, g2, h);
  }
  // 8×8 셀 블록 범위(2단 DDA): 마스크 균일 블록에서 선분 z 범위가 몸체 안/밖이면 블록 전체를 한 번에 건너뜀
  const BS = 8, nbx = Math.ceil(nx / BS), nby = Math.ceil(ny / BS), NB = nbx * nby;
  const bTmin = new Float64Array(NB).fill(Infinity), bTmax = new Float64Array(NB).fill(-Infinity), bBmin = new Float64Array(NB).fill(Infinity), bBmax = new Float64Array(NB).fill(-Infinity), bMask = new Uint8Array(NB);
  const cntM = new Int32Array(NB), cntA = new Int32Array(NB);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q = j * nx + i, b = ((j / BS) | 0) * nbx + ((i / BS) | 0);
    cntA[b]++;
    if (!mask[q]) continue;
    cntM[b]++;
    if (cTmin[q] < bTmin[b]) bTmin[b] = cTmin[q]; if (cTmax[q] > bTmax[b]) bTmax[b] = cTmax[q];
    if (cBmin[q] < bBmin[b]) bBmin[b] = cBmin[q]; if (cBmax[q] > bBmax[b]) bBmax[b] = cBmax[q];
  }
  for (let b = 0; b < NB; b++) bMask[b] = cntM[b] === 0 ? 0 : cntM[b] === cntA[b] ? 1 : 2;
  return {
    BS, nbx, bTmin, bTmax, bBmin, bBmax, bMask,
    nx, ny, NX, c, gx0: ox + hf.x0, gy0: oy + hf.y0, mask, ct, cb, cTmin, cTmax, cBmin, cBmax, zMinBot, zMaxTop, depth, n,
    mus: medium?.mus ?? 0, g: medium?.g ?? 0, mua: medium?.mua ?? 0, phase, rhoB, walls,
  };
}

// ---- 교차 ----
// 결과는 재사용 객체(할당 없음): t, kind, 법선(몸체 밖 방향; 측벽·PCB 는 공기 쪽)
const ev = { t: 0, kind: NONE, nx: 0, ny: 0, nz: 0 };

// 셀 (i,j) 의 윗면(top=1)·바닥 패치에서 광선 교차 — [ta,tb] 구간, 첫 교점이 ev.t 보다 가까우면 갱신
function cellPlanes(S, i, j, px, py, pz, dx, dy, dz, ta, tb) {
  const { c, NX } = S, k = j * NX + i, u0 = (px - (S.gx0 + i * c)) / c, v0 = (py - (S.gy0 + j * c)) / c;
  for (let s = 0; s < 2; s++) {
    const Z = s === 0 ? S.ct : S.cb;
    const z00 = Z[k], z10 = Z[k + 1], z01 = Z[k + NX], z11 = Z[k + NX + 1];
    for (let tri = 0; tri < 2; tri++) {
      const a = tri === 0 ? z10 - z00 : z11 - z01, b = tri === 0 ? z11 - z10 : z01 - z00;
      const f0 = pz - z00 - a * u0 - b * v0, f1 = dz - (a * dx + b * dy) / c;
      if (f1 === 0) continue;
      const t = -f0 / f1;
      if (!(t > 1e-12) || t < ta - 1e-9 || t > tb + 1e-9 || t >= ev.t) continue;
      const u = u0 + t * dx / c, v = v0 + t * dy / c;
      if (tri === 0 ? u - v < -1e-12 : v - u < -1e-12) continue;
      const gx = a / c, gy = b / c, nn = Math.sqrt(gx * gx + gy * gy + 1);
      ev.t = t; ev.kind = s === 0 ? TOP : BOT;
      if (s === 0) { ev.nx = -gx / nn; ev.ny = -gy / nn; ev.nz = 1 / nn; } else { ev.nx = gx / nn; ev.ny = gy / nn; ev.nz = -1 / nn; }
    }
  }
}

// 셀 경계 점에서 그 셀 기둥의 몸체 내부인가 (마스크 + 바닥 < z < 윗면)
function insideCell(S, i, j, x, y, z) {
  if (i < 0 || j < 0 || i >= S.nx || j >= S.ny || !S.mask[j * S.nx + i]) return false;
  const { c, NX } = S, k = j * NX + i, u = (x - (S.gx0 + i * c)) / c, v = (y - (S.gy0 + j * c)) / c;
  const h = (Z) => (u >= v ? Z[k] + (Z[k + 1] - Z[k]) * u + (Z[k + NX + 1] - Z[k + 1]) * v
    : Z[k] + (Z[k + NX + 1] - Z[k + NX]) * u + (Z[k + NX] - Z[k]) * v);
  return z > h(S.cb) && z < h(S.ct);
}

// 몸체 표면(윗면·바닥·측벽) 첫 교차 — 셀 DDA, t ∈ (0, tLim)
function bodyHits(S, px, py, pz, dx, dy, dz, inBody, tLim) {
  const { c, nx, ny, gx0, gy0 } = S, gx1 = gx0 + nx * c, gy1 = gy0 + ny * c;
  // 격자 bbox 와의 구간
  let t0 = 0, t1 = tLim;
  if (dx !== 0) { let a = (gx0 - px) / dx, b = (gx1 - px) / dx; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  else if (px < gx0 || px > gx1) return;
  if (dy !== 0) { let a = (gy0 - py) / dy, b = (gy1 - py) / dy; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
  else if (py < gy0 || py > gy1) return;
  if (!inBody) {   // 공기: 몸체 z 범위 [zMinBot, zMaxTop] 안의 구간만
    if (dz !== 0) { let a = (S.zMinBot - pz) / dz, b = (S.zMaxTop - pz) / dz; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
    else if (pz < S.zMinBot || pz > S.zMaxTop) return;
  }
  if (!(t1 > t0)) return;
  const xs = px + t0 * dx, ys = py + t0 * dy;
  let i = Math.min(nx - 1, Math.max(0, Math.floor((xs - gx0) / c))), j = Math.min(ny - 1, Math.max(0, Math.floor((ys - gy0) / c)));
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? c / Math.abs(dx) : Infinity, tdy = dy !== 0 ? c / Math.abs(dy) : Infinity;
  let tmx = dx !== 0 ? (gx0 + (i + (dx > 0 ? 1 : 0)) * c - px) / dx : Infinity;
  let tmy = dy !== 0 ? (gy0 + (j + (dy > 0 ? 1 : 0)) * c - py) / dy : Infinity;
  let ta = t0, lastBlk = -1;
  for (let guard = 0; guard < 1e6; guard++) {
    // 블록 건너뛰기: 마스크 균일 블록에서 블록 출구까지 선분 z 범위가 몸체 안(몸체 광선)/밖(공기 광선)이면 출구 셀로 점프
    const BS = S.BS, bi = (i / BS) | 0, bj = (j / BS) | 0, bk = bj * S.nbx + bi, bm = S.bMask[bk];
    if (bk !== lastBlk && bm !== 2 && !(inBody && bm === 0)) {
      lastBlk = bk;
      const bx0 = gx0 + bi * BS * c, bx1 = Math.min(gx1, gx0 + (bi + 1) * BS * c), by0 = gy0 + bj * BS * c, by1 = Math.min(gy1, gy0 + (bj + 1) * BS * c);
      const txb = dx > 0 ? (bx1 - px) / dx : dx < 0 ? (bx0 - px) / dx : Infinity, tyb = dy > 0 ? (by1 - py) / dy : dy < 0 ? (by0 - py) / dy : Infinity;
      const tbe = Math.min(txb, tyb, t1), za = pz + ta * dz, zb2 = pz + tbe * dz, zlo = Math.min(za, zb2) - 1e-9, zhi = Math.max(za, zb2) + 1e-9;
      const skip = bm === 0 || (inBody ? (zlo > S.bBmax[bk] && zhi < S.bTmin[bk]) : (zhi < S.bBmin[bk] || zlo > S.bTmax[bk]));
      if (skip) {
        if (tbe >= t1 && !inBody) return;   // 몸체 광선은 격자 경계(외곽 측면) 전이 검사가 필요 — 마지막 셀로 점프
        const qx = px + (tbe - 1e-9) * dx, qy = py + (tbe - 1e-9) * dy;
        const ni = Math.min(Math.min(nx, (bi + 1) * BS) - 1, Math.max(bi * BS, Math.floor((qx - gx0) / c))), nj = Math.min(Math.min(ny, (bj + 1) * BS) - 1, Math.max(bj * BS, Math.floor((qy - gy0) / c)));
        if (ni !== i || nj !== j) {
          i = ni; j = nj;
          tmx = dx !== 0 ? (gx0 + (i + (dx > 0 ? 1 : 0)) * c - px) / dx : Infinity;
          tmy = dy !== 0 ? (gy0 + (j + (dy > 0 ? 1 : 0)) * c - py) / dy : Infinity;
          ta = Math.max(ta, Math.min(tmx, tmy, t1));   // 블록 안 평면 검사는 이미 불필요(건너뜀 조건)
        }
      }
    }
    const tb = Math.min(tmx, tmy, t1);
    const q = j * nx + i, cur = S.mask[q];
    if (cur) {
      const za = pz + ta * dz, zb = pz + tb * dz, zlo = (za < zb ? za : zb) - 1e-9, zhi = (za < zb ? zb : za) + 1e-9;
      const skip = inBody ? (zlo > S.cBmax[q] && zhi < S.cTmin[q]) : (zhi < S.cBmin[q] || zlo > S.cTmax[q]);
      if (!skip) cellPlanes(S, i, j, px, py, pz, dx, dy, dz, ta, tb);
    }
    // 셀 경계 교차가 t1(격자 끝 = 몸체 외곽)과 겹쳐도 전이(측면) 검사는 해야 한다 — 부동소수 등호에 기대지 않음
    if (ev.t <= tb + 1e-12 || Math.min(tmx, tmy) > t1 + 1e-9) return;
    // 다음 셀로 — 측벽 판정
    const stepX = tmx <= tmy, ni = stepX ? i + sx : i, nj = stepX ? j : j + sy;
    const qx = px + tb * dx, qy = py + tb * dy, qz = pz + tb * dz;
    const nIn = ni >= 0 && nj >= 0 && ni < nx && nj < ny && S.mask[nj * nx + ni];
    let hit = false;
    if (inBody) hit = cur && !nIn && insideCell(S, i, j, qx, qy, qz);
    else hit = !cur && nIn && insideCell(S, ni, nj, qx, qy, qz);
    if (hit && tb > 1e-12 && tb < ev.t) {
      ev.t = tb; ev.kind = SIDE;
      const o = inBody ? 1 : -1;      // 바깥 방향 = 몸체 셀 → 비몸체 셀
      ev.nx = stepX ? o * sx : 0; ev.ny = stepX ? 0 : o * sy; ev.nz = 0;
      return;
    }
    if (stepX) { i = ni; tmx += tdx; } else { j = nj; tmy += tdy; }
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    ta = tb;
  }
}

// 다음 사건. inBody 면 tMax(자유행로) 안에 표면이 없으면 kind = NONE(산란).
function nextEvent(S, px, py, pz, dx, dy, dz, inBody, tMax) {
  ev.t = tMax; ev.kind = NONE;
  if (!inBody) {
    const W = S.walls;
    // 공기 영역 경계: PCB, 캐비티 측벽(z ≤ depth), 위(몸체 최고점 위로 = 누설), 측면 탈출
    if (dz < 0) { const t = -pz / dz; if (t < ev.t) { ev.t = t; ev.kind = PCB; ev.nx = 0; ev.ny = 0; ev.nz = 1; } }
    if (dz > 0) { const t = (S.zMaxTop + 1e-6 - pz) / dz; if (t < ev.t) { ev.t = t; ev.kind = ESC_UP; } }
    const bx0 = W ? W.x0 : S.gx0, bx1 = W ? W.x1 : S.gx0 + S.nx * S.c, by0 = W ? W.y0 : S.gy0, by1 = W ? W.y1 : S.gy0 + S.ny * S.c;
    if (px < bx0 - 1e-9 || px > bx1 + 1e-9 || py < by0 - 1e-9 || py > by1 + 1e-9) { ev.t = 0; ev.kind = ESC_SIDE; return ev; }
    const lat = (t, nxx, nyy) => {
      if (!(t > 1e-12) || t >= ev.t) return;
      const z = pz + t * dz;
      if (W && z <= S.depth) { ev.t = t; ev.kind = WALL; ev.nx = nxx; ev.ny = nyy; ev.nz = 0; } else { ev.t = t; ev.kind = ESC_SIDE; }
    };
    if (dx < 0) lat((bx0 - px) / dx, 1, 0); else if (dx > 0) lat((bx1 - px) / dx, -1, 0);
    if (dy < 0) lat((by0 - py) / dy, 0, 1); else if (dy > 0) lat((by1 - py) / dy, 0, -1);
  }
  else if (tMax < Infinity) {
    // 빠른 경로(몸체 내부 짧은 자유행로): 끝점이 같은 셀이면 그 셀 패치만 검사 — 측벽은 셀 경계에서만 생기므로 정확
    const c = S.c, fi = (px - S.gx0) / c, fj = (py - S.gy0) / c, i = Math.floor(fi), j = Math.floor(fj);
    if (i >= 0 && j >= 0 && i < S.nx && j < S.ny && Math.floor(fi + tMax * dx / c) === i && Math.floor(fj + tMax * dy / c) === j && S.mask[j * S.nx + i]) {
      const q = j * S.nx + i, za = pz, zb = pz + tMax * dz, zlo = (za < zb ? za : zb) - 1e-9, zhi = (za < zb ? zb : za) + 1e-9;
      if (!(zlo > S.cBmax[q] && zhi < S.cTmin[q])) cellPlanes(S, i, j, px, py, pz, dx, dy, dz, 0, tMax);
      return ev;
    }
  }
  const keep = ev.t, kk = ev.kind, a = ev.nx, b = ev.ny, cz = ev.nz;
  bodyHits(S, px, py, pz, dx, dy, dz, inBody, Math.min(ev.t, 1e9));
  if (ev.t >= keep) { ev.t = keep; ev.kind = kk; ev.nx = a; ev.ny = b; ev.nz = cz; }
  return ev;
}

// 계면 굴절: d 단위벡터, N = 몸체 바깥 법선, inBody = 몸체 → 공기. 반환 { R, cosI, tx,ty,tz(투과), rx,ry,rz(반사) }
const ifc = { R: 0, cosI: 0, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
function interface_(n, dx, dy, dz, Nx, Ny, Nz, inBody) {
  const dn = dx * Nx + dy * Ny + dz * Nz;
  // 입사측 법선 Ni(입사 매질 쪽) — cosI = −d·Ni > 0
  const Nix = inBody ? -Nx : Nx, Niy = inBody ? -Ny : Ny, Niz = inBody ? -Nz : Nz;
  const cosI = Math.min(1, Math.abs(dn)), eta = inBody ? n : 1 / n;
  ifc.cosI = cosI;
  ifc.rx = dx - 2 * dn * Nx; ifc.ry = dy - 2 * dn * Ny; ifc.rz = dz - 2 * dn * Nz;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k <= 0) { ifc.R = 1; return ifc; }
  const cosT = Math.sqrt(k);
  ifc.R = fresnelR(inBody ? cosT : cosI, n);          // 공기측 각의 코사인으로 (양방향 동일)
  const m = eta * cosI - cosT;
  ifc.tx = eta * dx + m * Nix; ifc.ty = eta * dy + m * Niy; ifc.tz = eta * dz + m * Niz;
  return ifc;
}

// ---- 결정론 단일 광선(VS3·디버그): 투과 가지를 따라가고 TIR 이면 반사 ----
export function traceRay(S, o, d, maxEvents = 8) {
  let [px, py, pz] = o, [dx, dy, dz] = d, inBody = false;
  const out = [];
  for (let e = 0; e < maxEvents; e++) {
    const E = nextEvent(S, px, py, pz, dx, dy, dz, inBody, Infinity);
    if (E.kind === NONE) break;
    const t = E.t; px += t * dx; py += t * dy; pz += t * dz;
    const rec = { kind: KIND[E.kind], p: [px, py, pz], N: [E.nx, E.ny, E.nz], inBody };
    out.push(rec);
    if (E.kind !== TOP && E.kind !== BOT && E.kind !== SIDE) break;
    const f = interface_(S.n, dx, dy, dz, E.nx, E.ny, E.nz, inBody);
    rec.R = f.R; rec.cosI = f.cosI;
    if (f.R < 1) { dx = f.tx; dy = f.ty; dz = f.tz; inBody = !inBody; } else { dx = f.rx; dy = f.ry; dz = f.rz; }
    rec.dOut = [dx, dy, dz];
    if (E.kind === TOP && !inBody) break;
    px += OFF * dx; py += OFF * dy; pz += OFF * dz;
  }
  return out;
}

// ---- 광원 ----
function ledModel(led) {
  if (led.model === 'gaussian') {
    const sg = gaussianSigma(led.beamX), K = 4096, cdf = new Float64Array(K + 1);
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI / 2, b = ((i + 1) / K) * Math.PI / 2, m = (a + b) / 2;
      cdf[i + 1] = cdf[i] + relIntensity('gaussian', m, { sigma: sg }) * Math.sin(m) * (b - a);
    }
    const tot = cdf[K];
    return {
      solid: 2 * Math.PI * tot,
      uOf(theta) { const f = Math.min(K, Math.max(0, (theta / (Math.PI / 2)) * K)), i = Math.min(K - 1, Math.floor(f)); return (cdf[i] + (cdf[i + 1] - cdf[i]) * (f - i)) / tot; },
      cosTheta(u) {   // 역 CDF(구간 선형)
        const v = u * tot; let lo = 0, hi = K;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cdf[mid] <= v) lo = mid; else hi = mid; }
        const f = (v - cdf[lo]) / Math.max(1e-300, cdf[lo + 1] - cdf[lo]);
        return Math.cos(((lo + f) / K) * Math.PI / 2);
      },
    };
  }
  const m = lambertianExponent(led.beamX);
  return { solid: (2 * Math.PI) / (m + 1), cosTheta: (u) => Math.pow(1 - u, 1 / (m + 1)), uOf: (theta) => 1 - Math.pow(Math.max(0, Math.cos(theta)), m + 1) };
}
// LED 1개 광속(I0 단위 × sr) — 장부 기준
export function ledFlux(led) { return (led.I0 ?? 1) * ledModel(led).solid; }

function sampleHG(g, u) {
  if (Math.abs(g) < 1e-6) return 2 * u - 1;
  const f = (1 - g * g) / (1 - g + 2 * g * u);
  return (1 + g * g - f * f) / (2 * g);
}

// ---- MC ----
// opt: { leds:[{x,y}], led:{model,beamX,sizeX,sizeY,I0}, N, seed, map:{x0,y0,step,nx,ny}, batches, onExit(x,y,w,flags,dz), wMinRel }
// emit: 선택 — 사용자 광원(검증용) { flux, sample(rnd) → [x,y,z,dx,dy,dz] } (leds·led 대신)
export function runBodyMC(S, { leds = [null], led = { I0: 1 }, emit = null, N, seed = 1, map = null, batches = 1, onExit = null, wMinRel = 1e-3, maxEvents = 200000 }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rnd = rng(seed), lm = emit ? null : ledModel(led), L = leds.length;
  const w0 = (emit ? emit.flux : (led.I0 ?? 1) * lm.solid * L) / N, wMin = w0 * wMinRel;
  const ledger = { emitted: 0, top: 0, side: 0, leak: 0, wall: 0, pcb: 0, absBody: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const maps = map ? Array.from({ length: batches }, () => new Float64Array(map.nx * map.ny)) : null;
  const ang = new Float64Array(90);
  const { n, mus, g, mua, phase, rhoB, walls } = S;
  const stack = [];
  const lamb = (Nx, Ny, Nz) => {   // 법선 N 주위 cosine 가중 방향
    const u1 = rnd(), u2 = rnd(), r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
    const a = r * Math.cos(ph), b = r * Math.sin(ph), cz = Math.sqrt(Math.max(0, 1 - u1));
    // N 에 수직인 기저
    let tx, ty, tz;
    if (Math.abs(Nz) < 0.9) { tx = -Ny; ty = Nx; tz = 0; } else { tx = 0; ty = -Nz; tz = Ny; }
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = Ny * tz - Nz * ty, by = Nz * tx - Nx * tz, bz = Nx * ty - Ny * tx;
    return [a * tx + b * bx + cz * Nx, a * ty + b * by + cz * Ny, a * tz + b * bz + cz * Nz];
  };
  for (let p = 0; p < N; p++) {
    const batch = map ? Math.min(batches - 1, Math.floor((p * batches) / N)) : 0;
    ledger.emitted += w0;
    if (emit) { const [ex, ey, ez, ux, uy, uz] = emit.sample(rnd); stack.push([ex, ey, ez, ux, uy, uz, 0, w0, 0]); }
    else {
      const li = leds[p % L], ct = lm.cosTheta(rnd()), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = 2 * Math.PI * rnd();
      const ex = li.x + ((led.sizeX ?? 0) ? (rnd() - 0.5) * led.sizeX : 0), ey = li.y + ((led.sizeY ?? 0) ? (rnd() - 0.5) * led.sizeY : 0);
      stack.push([ex, ey, 1e-6, st * Math.cos(ph), st * Math.sin(ph), ct, 0, w0, 0]);
    }
    while (stack.length) {
      let [px, py, pz, dx, dy, dz, inB, w, flags] = stack.pop();
      let inBody = !!inB;
      for (let e = 0; ; e++) {
        if (e > maxEvents) { ledger.lost += w; break; }
        const sFree = inBody && mus > 0 ? -Math.log(1 - rnd()) / mus : Infinity;
        const E = nextEvent(S, px, py, pz, dx, dy, dz, inBody, sFree);
        const t = E.t;
        if (E.kind === NONE && !Number.isFinite(t)) { ledger.lost += w; break; }   // 갇힘(수치) — 진단
        px += t * dx; py += t * dy; pz += t * dz;
        if (inBody && mua > 0) { const a = w * (1 - Math.exp(-mua * t)); ledger.absBody += a; w -= a; }
        let kind = E.kind;
        if (kind === NONE) {   // 체적 산란
          flags |= F_SCAT;
          const cth = phase ? phase.sample(rnd()) : sampleHG(g, rnd()), sth = Math.sqrt(Math.max(0, 1 - cth * cth));
          const phi = 2 * Math.PI * rnd(), cp = Math.cos(phi), sp = Math.sin(phi);
          if (Math.abs(dz) > 0.99999) { dx = sth * cp; dy = sth * sp; dz = Math.sign(dz) * cth; }
          else {
            const tmp = Math.sqrt(1 - dz * dz);
            const nx2 = sth * (dx * dz * cp - dy * sp) / tmp + dx * cth, ny2 = sth * (dy * dz * cp + dx * sp) / tmp + dy * cth, nz2 = -sth * cp * tmp + dz * cth;
            dx = nx2; dy = ny2; dz = nz2;
          }
        } else if (kind === PCB) {
          ledger.pcb += w * (1 - rhoB); w *= rhoB; flags |= F_REFL;
          if (w <= 0) break;
          [dx, dy, dz] = lamb(0, 0, 1);
          pz = OFF;
        } else if (kind === WALL) {
          const Nx = E.nx, Ny = E.ny;
          if (!walls || walls.mode === 'absorb') { ledger.wall += w; break; }
          flags |= F_REFL;
          if (walls.mode === 'diffuse') {
            const R = walls.R ?? 0; ledger.wall += w * (1 - R); w *= R; if (w <= 0) break;
            [dx, dy, dz] = lamb(Nx, Ny, 0);
          } else {   // fresnel: 정반사(공기 → 측벽 수지), 투과분은 측벽 누설
            const R = fresnelR(Math.abs(dx * Nx + dy * Ny), walls.n ?? n);
            ledger.wall += w * (1 - R); w *= R;
            const dn = dx * Nx + dy * Ny; dx -= 2 * dn * Nx; dy -= 2 * dn * Ny;
          }
          px += OFF * Nx; py += OFF * Ny;
        } else if (kind === ESC_SIDE) { ledger.side += w; break; }
        else if (kind === ESC_UP) { ledger.leak += w; break; }
        else {   // 몸체 표면
          const f = interface_(n, dx, dy, dz, E.nx, E.ny, E.nz, inBody);
          if (kind === TOP && inBody) {
            const wt = w * (1 - f.R);
            if (wt > 0) {
              ledger.top += wt;
              if (maps) {
                const bi = Math.floor((px - map.x0) / map.step), bj = Math.floor((py - map.y0) / map.step);
                if (bi >= 0 && bj >= 0 && bi < map.nx && bj < map.ny) maps[batch][bj * map.nx + bi] += wt;
              }
              ang[Math.min(89, Math.floor(Math.acos(Math.min(1, f.tz)) * 180 / Math.PI))] += wt;
              if (onExit) onExit(px, py, wt, flags, f.tz);
            }
            w -= wt; flags |= F_REFL;
            dx = f.rx; dy = f.ry; dz = f.rz;
          } else if (f.R >= 1 || rnd() < f.R) { flags |= F_REFL; dx = f.rx; dy = f.ry; dz = f.rz; }   // 비종단 계면: 확률 선택(가중 불변)
          else { dx = f.tx; dy = f.ty; dz = f.tz; inBody = !inBody; }
          px += OFF * dx; py += OFF * dy; pz += OFF * dz;
        }
        if (w < wMin) {
          if (rnd() < 0.1) { ledger.rrGain += 9 * w; w *= 10; } else { ledger.rrLoss += w; break; }
        }
      }
    }
    // 스택의 룰렛은 꺼낸 뒤 첫 사건에서 처리됨
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { ledger, maps, ang, ms: t1 - t0 };
}

// ---- 빠른 solver(fast-body.js) 공용 내부 — 같은 기하·계면 코드를 써서 두 solver 가 기하에서 어긋나지 않게 ----
export const _K = { NONE, TOP, BOT, SIDE, PCB, WALL, ESC_SIDE, ESC_UP };
export { nextEvent as _nextEvent, interface_ as _interface, ledModel as _ledModel };
