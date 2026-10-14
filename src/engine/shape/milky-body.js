// S2b — 밀키(L2) + 형상 몸체(L3·L4·불러온 STEP): 로컬 슬래브 PSF (형상 몸체 spec 2026-10-10 §4.2 밀키).
// LED 하나를 중심으로 한 PSF 격자에서
//  ① 바닥 입사 조도: 바닥 높이 z_b(x,y)·국소 법선 기준 입사각(경사 바닥), 투영 면적당(÷ n_z), 입사각 행 선형 분배
//  ② 응답: 입사 위치의 국소 두께 t(x,y) 단계 합성(L2 캐비티 solver tMap), 출사 중심 바깥 이동(VS6)
//  ③ 재순환: 입사 가중 평균 갭·두께의 닫힌 해 + 재입사 투과는 도착 위치 국소 두께 단계
// 앵커: 주기 형상(L4)은 PSF 1개(중심 LED — 주기라 평행이동 정확), L3·불러온 몸체는 고정 격자 앵커 쌍선형(피치 무관 → 평가 간 캐시).
// 캐비티 벽은 기존 L2 와 같이 거울 LED × 확산 반사율 R_d. 가정: 윗면 평탄 근사(국소 슬래브), 바닥 경사의 자기 가림 무시.
import { solveCavity, twoScale } from '../l2/cavity-solver.js';
import { withFine } from '../l2/psf.js';
import { checkResult } from '../l2/validator.js';
import { normalRadianceFactor } from '../l2/slab-table.js';
import { sampleHeightfield } from './heightfield.js';

const MAX_CELLS = 255;
const _cache = new Map();

// 높이맵 표본(몸체 밖은 가장자리 값으로 — 열린 영역 근사)
function sampler(geom, depth) {
  const hf = geom.hf, X0 = geom.ox + hf.x0 + hf.cell * 0.5, X1 = geom.ox + hf.x0 + (hf.nx - 0.5) * hf.cell, Y0 = geom.oy + hf.y0 + hf.cell * 0.5, Y1 = geom.oy + hf.y0 + (hf.ny - 0.5) * hf.cell;
  return (x, y) => {
    const s = sampleHeightfield(hf, Math.min(X1, Math.max(X0, x)) - geom.ox, Math.min(Y1, Math.max(Y0, y)) - geom.oy);
    return s ? { zt: depth + s.zt, zb: depth + s.zb } : null;
  };
}

// 앵커 1개의 밀키 로컬 슬래브 PSF
export function milkyPsf(geom, depth, at, { table, mat, rhoB, intensity, intensityKey, I0, extentX, extentY, step, maxLevels = 5 }) {
  const key = [geom.key, 'F2', maxLevels, at.x.toFixed(3), at.y.toFixed(3), table.phaseKey ?? 'HG', mat.musR, mat.g, mat.mua, mat.n, depth, rhoB, intensityKey, I0, extentX, extentY, step].map((v) => (typeof v === 'number' ? v.toPrecision(7) : v)).join('|');
  const hit = _cache.get(key);
  if (hit) return hit;
  const smp = sampler(geom, depth);
  let tEff = 1, h = depth, first = true;
  const run = (s, nx, ny) => {
  const N = nx * ny, cx = (nx * s) / 2, cy = (ny * s) / 2;
  const E = Array.from({ length: table.angleRows }, () => new Float64Array(N)), tMap = new Float64Array(N);
  let sw = 0, swh = 0, swt = 0;
  const d = Math.max(0.05, s * 0.25);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, ox = (i + 0.5) * s - cx, oy = (j + 0.5) * s - cy, x = at.x + ox, y = at.y + oy;
    const g0 = smp(x, y);
    if (!g0) continue;
    tMap[k] = Math.max(0.05, g0.zt - g0.zb);
    // 바닥 기울기(중앙 차분) → 몸체 안쪽(위) 법선 n_in = (−gx, −gy, 1)/|·|
    const gx = (smp(x + d, y).zb - smp(x - d, y).zb) / (2 * d), gy = (smp(x, y + d).zb - smp(x, y - d).zb) / (2 * d), nn = Math.hypot(gx, gy, 1);
    // 근접장: 바닥이 격자보다 가까우면 셀 안 8×8 표본
    const SS = g0.zb < 2 * s && Math.hypot(ox, oy) < 4 * s ? 8 : 1;
    for (let q = 0; q < SS * SS; q++) {
      const px = ox + (SS > 1 ? ((q % SS) + 0.5) / SS - 0.5 : 0) * s, py = oy + (SS > 1 ? (((q / SS) | 0) + 0.5) / SS - 0.5 : 0) * s;
      const zb = SS > 1 ? smp(at.x + px, at.y + py).zb : g0.zb;
      const r2 = px * px + py * py + zb * zb, dist = Math.sqrt(r2), cosE = zb / dist;
      const cosI = (-px * gx - py * gy + zb) / (dist * nn);   // 입사각(국소 법선 기준)
      if (!(cosI > 0) || !(cosE > 0)) continue;
      const v = (I0 * intensity(cosE) * cosI) / r2 * (nn / 1) / (SS * SS);   // 투영 면적당 = 면적당 × (1/n_z), 1/n_z = nn
      const [b0, b1, w1] = table.bandSplit(cosI);
      E[b0][k] += v * (1 - w1); if (w1) E[b1][k] += v * w1;
      sw += v; swh += v * zb; swt += v * tMap[k];
    }
  }
  const hR = sw > 0 ? swh / sw : depth, tR = sw > 0 ? swt / sw : 1;   // 거친 전체 해의 값을 대표로(영역 크기에 따라 미세하게 다름)
  if (first) { h = hR; tEff = tR; first = false; }
  return solveCavity({ E, nx, ny, step: s, table, mat, t: tR, h: hR, rhoB, rW: 0, uniformTail: false, gapRmax: Math.max(extentX, extentY) / 2, center: { x: cx, y: cy }, tMap, maxLevels });
  };
  const ts = twoScale(run, { extentX, extentY, step, maxCells: MAX_CELLS }), { s, nx, ny, res } = ts, cx = (nx * s) / 2, cy = (ny * s) / 2;
  const tauR = mat.musR * tEff, muaT = mat.mua * tEff;
  const qn = table.query(tauR, mat.g, mat.n, 0, muaT), qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const sum = (a) => a.reduce((p, v) => p + v, 0);
  const sS = sum(res.Mscat), sR = sum(res.Mrec);
  const fScat = sS + sR > 0 ? (sS * normalRadianceFactor(qn.ang) + sR * normalRadianceFactor(qd.ang)) / (sS + sR) : 1 / Math.PI;
  const K = (data, fd) => withFine({ data, kNx: nx, kNy: ny, dxMin: -((nx - 1) / 2) * s, dyMin: -((ny - 1) / 2) * s, stepX: s, stepY: s }, ts.fine, fd);
  // 99% 에너지 반경(거울 LED 절단용)
  let tot = 0; const rings = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = res.M[j * nx + i]; if (v > 0) { rings.push([Math.hypot((i + 0.5) * s - cx, (j + 0.5) * s - cy), v]); tot += v; } }
  rings.sort((a, b) => a[0] - b[0]);
  let acc = 0, r99 = rings.at(-1)?.[0] ?? 0; for (const [rr, v] of rings) { acc += v; if (acc >= 0.99 * tot) { r99 = rr; break; } }
  const out = {
    key, K: K(res.M, 'M'), Kball: K(res.Mball, 'Mball'), step: s, h, tEff, r99,
    tailFlux: res.tail * s * s, trans: (res.energy.top + res.tail) / res.energy.input,
    fScat, qn, qd, rW: qd.R, check: checkResult(res), energy: res.energy,
  };
  if (_cache.size > 48) _cache.delete(_cache.keys().next().value);
  _cache.set(key, out);
  return out;
}

const bil = (K, dx, dy) => {
  if (K.fine && Math.abs(dx) <= K.fine.hx && Math.abs(dy) <= K.fine.hy) K = K.fine;   // 2단 격자 PSF
  const fa = (dx - K.dxMin) / K.stepX, fb = (dy - K.dyMin) / K.stepY, a0 = Math.floor(fa), b0 = Math.floor(fb);
  if (a0 < 0 || b0 < 0 || a0 + 1 >= K.kNx || b0 + 1 >= K.kNy) return 0;
  const ta = fa - a0, tb = fb - b0, w = K.kNx, D = K.data;
  return (D[b0 * w + a0] * (1 - ta) + D[b0 * w + a0 + 1] * ta) * (1 - tb) + (D[(b0 + 1) * w + a0] * (1 - ta) + D[(b0 + 1) * w + a0 + 1] * ta) * tb;
};

// 전체 장: 앵커 PSF 중첩 + 캐비티 벽 거울(R_d). opt: { table, mat, rhoB, intensity, intensityKey, I0, uniform, symmetric, anchorStep }
export function milkyShapeField(geom, depth, leds, grid, opt) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { NX, NY, x0, y0, stepX, stepY } = grid;
  const W = geom.walls, Wx = W.x1 - W.x0, Wy = W.y1 - W.y0, wcx = (W.x0 + W.x1) / 2, wcy = (W.y0 + W.y1) / 2;
  const step = Math.min(stepX, NY > 1 ? stepY : stepX), base = { ...opt, extentX: 2 * Wx, extentY: 2 * Wy, step, maxLevels: opt.maxLevels ?? 5 };
  const psfAt = (x, y) => milkyPsf(geom, depth, { x, y }, base);
  let weightsOf;
  if (geom.periodic || opt.uniform) {
    let a = { x: wcx, y: wcy };
    if (geom.periodic && leds.length) a = leds.reduce((b, l) => (Math.hypot(l.x - wcx, l.y - wcy) < Math.hypot(b.x - wcx, b.y - wcy) ? l : b));
    const one = [[psfAt(a.x, a.y), 1, 1, 1]];
    weightsOf = () => one;
  } else {
    // 앵커: LED 가 격자(고유 x·y 좌표 ≤ 16개씩)면 LED 좌표 자체 = LED 마다 정확한 국소 PSF. 벽 영역 균등 격자(≤8)는
    // 오버행 pad 에 앵커를 낭비하고 두께 정점(테이퍼 중앙)을 놓쳐 중앙 과대(VS7M L3 Milky 6: 이상 로컬 슬래브 U 43% vs 50%).
    const uniq = (v) => [...new Set(v.map((q) => Math.round(q * 1e6) / 1e6))].sort((a, b) => a - b);
    const lx = uniq(leds.map((l) => l.x)), ly = uniq(leds.map((l) => l.y));
    let ax, ay, Kx, Ky;
    if (opt.anchorStep == null && lx.length <= 16 && ly.length <= 16 && lx.length * ly.length <= 4 * leds.length) {
      ax = lx; ay = NY > 1 ? ly : [ly[0] ?? wcy]; Kx = ax.length; Ky = ay.length;
    } else {
      const stp = opt.anchorStep ?? Math.max(depth, Math.max(Wx, Wy) / 6);
      Kx = Math.max(2, Math.min(8, Math.round(Wx / stp))); Ky = NY > 1 ? Math.max(2, Math.min(8, Math.round(Wy / stp))) : 1;
      ax = Array.from({ length: Kx }, (_, k) => W.x0 + ((k + 0.5) / Kx) * Wx); ay = Array.from({ length: Ky }, (_, k) => W.y0 + ((k + 0.5) / Ky) * Wy);
    }
    const Gs = new Map();
    const G_at = (i, j) => {
      let mi = i, mj = j, mx = 1, my = 1;
      if (opt.symmetric) { if (i > (Kx - 1) / 2) { mi = Kx - 1 - i; mx = -1; } if (j > (Ky - 1) / 2) { mj = Ky - 1 - j; my = -1; } }
      const key = mi * 100 + mj;
      if (!Gs.has(key)) Gs.set(key, psfAt(ax[mi], ay[mj]));
      return [Gs.get(key), mx, my];
    };
    const lin = (arr, v) => {
      if (arr.length === 1 || v <= arr[0]) return [[0, 1]];
      if (v >= arr.at(-1)) return [[arr.length - 1, 1]];
      let k = 0; while (k < arr.length - 2 && v > arr[k + 1]) k++;
      const u = (v - arr[k]) / (arr[k + 1] - arr[k]);
      return [[k, 1 - u], [k + 1, u]];
    };
    weightsOf = (l) => { const o = []; for (const [i, wi] of lin(ax, l.x)) for (const [j, wj] of lin(ay, l.y)) { if (wi * wj <= 0) continue; const [G, mx, my] = G_at(i, j); o.push([G, wi * wj, mx, my]); } return o; };
  }
  const field = new Float64Array(NX * NY), fieldBall = new Float64Array(NX * NY);
  let tail = 0, trans = 0, tw = 0, rW = 0, fScat = 0, checks = [];
  const add = (P, lx, ly, w, mx, my) => {
    for (let b = 0; b < NY; b++) {
      const dy = (y0 + b * stepY - ly) * my;
      for (let a = 0; a < NX; a++) {
        const dx = (x0 + a * stepX - lx) * mx, k = b * NX + a;
        field[k] += w * bil(P.K, dx, dy); fieldBall[k] += w * bil(P.Kball, dx, dy);
      }
    }
  };
  for (const l of leds) {
    for (const [P, w, mx, my] of weightsOf(l)) {
      const r = opt.rWover ?? P.rW;
      add(P, l.x, l.y, w, mx, my);
      // 거울 LED: 벽에서 PSF 99% 반경 안의 LED 만(먼 LED 의 거울 기여는 무시할 만함 — 비용 ∝ LED 수)
      const rc = P.r99 ?? Infinity;
      if (r > 0) {
        if (l.x - W.x0 < rc) add(P, 2 * W.x0 - l.x, l.y, w * r, -mx, my);
        if (W.x1 - l.x < rc) add(P, 2 * W.x1 - l.x, l.y, w * r, -mx, my);
        if (NY > 1 && l.y - W.y0 < rc) add(P, l.x, 2 * W.y0 - l.y, w * r, mx, -my);
        if (NY > 1 && W.y1 - l.y < rc) add(P, l.x, 2 * W.y1 - l.y, w * r, mx, -my);
      }
      tail += w * P.tailFlux; trans += w * P.trans; tw += w; rW += w * P.rW; fScat += w * P.fScat;
      if (!P.check.ok) checks = P.check.checks;
    }
  }
  const tailU = tail / Math.max(1e-9, Wx * Wy);
  for (let k = 0; k < field.length; k++) field[k] += tailU;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { field, fieldBall, trans: tw ? trans / tw : 0, rW: tw ? rW / tw : 0, fScat: tw ? fScat / tw : 1 / Math.PI, check: { ok: !checks.length, checks }, ms: t1 - t0 };
}
