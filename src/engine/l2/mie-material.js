// 입자(Mie) 소재 — spec 2026-10-07 §13 (단계 C). 비드 사양으로 위상함수를 정하고, 그 위상함수로 MC 한 소재별
// 응답표를 만든다(주 응답표는 HG 라 큰 비드의 "좁은 전방 로브 + 낮은 손실"을 표현하지 못함).
//  · buildMieTable: τ' ∈ [0, τ'_M] × 입사 행 — 주 응답표와 같은 레코드 형식(createTable 재사용)
//  · compositeTable: τ' ≤ 0.8τ'_M 은 소재표, ≥ τ'_M 은 주 응답표(HG, g=g_Mie), 사이는 혼합 (V13 연속성)
//  · fitParticle: 비드 종류(n_p) 고정, 지름 d 를 격자+정밀화로 고르고 (μs', μa) 는 기존 피팅으로
//  · recipe: μs → 체적분율 φ → wt%
import { runSlab } from './mc-slab.js';
import { packRecord, REC, createTable, blend } from './slab-table.js';
import { particleOptics, volumeFractionFromMus, wtFromVolume } from './mie.js';
import { fitMaterial } from './fit.js';

const COS85 = Math.cos(85 * Math.PI / 180);
export const STD_ROWS = [...Array.from({ length: 9 }, (_, k) => 1 - k * (1 - COS85) / 8), 'diffuse'];
export const BEADS = {   // 대표 확산 비드 (n_p @550nm, 밀도 g/cm³)
  PMMA: { nP: 1.49, rho: 1.19 },
  silicone: { nP: 1.43, rho: 1.32 },
  PS: { nP: 1.59, rho: 1.05 },
};
export const HOST = { PC: { n: 1.586, rho: 1.20 }, PMMA: { n: 1.49, rho: 1.19 } };

function tauGrid(tMax, k = 12) {
  const lo = Math.max(0.002, tMax / 300);
  return [0, ...Array.from({ length: k }, (_, i) => lo * Math.pow(tMax / lo, i / (k - 1)))];
}
const photons = (tauR, base) => Math.round(Math.max(base / 4, base / (1 + tauR)));

// opt = particleOptics(...) 결과. rows: STD_ROWS(시스템용) 또는 [1](법선 피팅용)
// grid: τ' 격자 직접 지정(피팅용 — 필요한 범위만). 없으면 [0, τ'_M] 로그 12점.
export function buildMieTable({ opt, n, tauMax, rows = STD_ROWS, N = 20000, seed = 1, onProgress, grid: g0 }) {
  const grid = g0 ?? tauGrid(tauMax), data = new Float32Array(grid.length * rows.length * REC);
  let k = 0;
  for (const tauR of grid) for (const inc of rows) {
    const rec = runSlab({ tau: tauR / (1 - opt.g), g: opt.g, n, inc, N: photons(tauR, N), seed: seed + k, phase: opt.phase });
    data.set(packRecord(rec), k * REC);
    k++;
    onProgress?.(k / (grid.length * rows.length));
  }
  const meta = { version: 1, rec: REC, kind: 'mie', grids: { tauR: grid, g: [opt.g], n: [n], rows }, tauMax: grid[grid.length - 1], created: new Date().toISOString() };
  return { meta, data, table: createTable(meta, data) };
}

// 소재표 + 주 응답표 → 같은 API 의 합성 표. τ' ≤ τ'_M 은 소재표(Mie), 그 위는 주 응답표(HG, g ≤ 0.99) 로
// 넘기고 q.beyondMaterial 표시(두께가 소재표 범위를 넘음 → HG 근사 경고). phaseKey 는 PSF 캐시 구분용.
export function compositeTable(mie, main, phaseKey) {
  const tM = mie.meta.tauMax;
  const query = (tauR, g, n, row, muaT = 0, mode) => {
    if (tauR <= tM) { const q = mie.query(tauR, g, n, row, muaT, 'mc'); q.outOfRange = false; return q; }
    const q = main.query(tauR, Math.min(g, 0.99), n, row, muaT, mode);
    q.beyondMaterial = true;
    return q;
  };
  return { ...main, meta: { ...main.meta, phaseKey }, query, phaseKey, mieTable: mie };
}

// V13: 소재표가 확산 영역(τ'_M ≥ 4)까지 덮을 때만 의미 — 전환점에서 소재표 vs 주 응답표 T·R 차
export function checkTransition(mie, main, g, n) {
  const t = mie.meta.tauMax;
  if (t < 4) return { id: 'V13', ok: true, value: 0, limit: 0.01, note: `소재표가 두께 범위 전체(τ'≤${t.toFixed(2)})를 덮음 — 전환 없음` };
  let w = 0;
  for (const [ra, rb] of [[0, 0], [mie.diffuseRow, main.diffuseRow]]) {
    const a = mie.query(t, g, n, ra, 0, 'mc'), b = main.query(t, Math.min(g, 0.99), n, rb, 0);
    w = Math.max(w, Math.abs(a.Tb + a.Ts - b.Tb - b.Ts), Math.abs(a.R - b.R));
  }
  return { id: 'V13', ok: w <= 0.01, value: w, limit: 0.01, note: `소재표↔주 응답표 전환 τ'=${t.toFixed(2)}` };
}

// 비드 종류 고정, d 탐색. entry = { n, samples }, bead = { nP, rho }, host = { n, rho }
export function fitParticle(mainTable, entry, bead, host, { lambda_um = 0.55, N = 20000, onProgress } = {}) {
  const hg = fitMaterial(mainTable, entry);                      // 1차(HG) — τ' 범위 추정용
  const ts = entry.samples.map((s) => s.t), tMin = Math.min(...ts), tMax = Math.max(...ts);
  // 피팅 표는 필요한 τ' 범위만: μs' ∈ [μs'_HG/3, 3μs'_HG] × 시료 두께 범위 (+0), 로그 8점
  const lo = Math.max(1e-3, (hg.mat.musR * tMin) / 3), hi = 3 * hg.mat.musR * tMax;
  const fitGrid = [0, ...Array.from({ length: 8 }, (_, i) => lo * Math.pow(hi / lo, i / 7))];
  const tauFit = hi;
  const cache = new Map();
  const evalD = (d) => {
    const key = d.toPrecision(5);
    if (cache.has(key)) return cache.get(key);
    const opt = particleOptics({ d_um: d, nP: bead.nP, nH: host.n, lambda_um });
    const { table } = buildMieTable({ opt, n: host.n, rows: [1], N, seed: 7, grid: fitGrid });
    const f = fitMaterial(table, { ...entry, n: host.n }, { gFix: opt.g });
    const r = { d, opt, f, J: f.J };
    cache.set(key, r);
    onProgress?.(cache.size);
    return r;
  };
  const grid = [0.5, 0.8, 1.2, 2, 3, 4.5, 7, 10];
  let rs = grid.map(evalD), bi = rs.reduce((b, r, i) => (r.J < rs[b].J ? i : b), 0);
  // 황금분할 정밀화(log d) — 이웃 격자 사이
  let a = Math.log(grid[Math.max(0, bi - 1)]), b = Math.log(grid[Math.min(grid.length - 1, bi + 1)]);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 4; it++) {
    const c = b - gr * (b - a), e = a + gr * (b - a);
    if (evalD(Math.exp(c)).J < evalD(Math.exp(e)).J) b = e; else a = c;
  }
  const best = [...cache.values()].reduce((p, r) => (r.J < p.J ? r : p));
  const mus = best.f.mat.musR / (1 - best.opt.g);
  const phi = volumeFractionFromMus(best.opt, mus);
  // 지름 식별성: J ≤ J_min + 1 (Δχ²=1, 1σ) 인 d 범위. 2배 넘게 퍼지면 데이터로 지름을 특정할 수 없음
  // 평가점 사이를 log d 선형 보간해 J = J_min + 1 교차점을 찾는다(평가점만 쓰면 날카로운 최소에서 범위가 0 으로 보임)
  // 불확도 보정: σ 가 응답표 MC 잡음을 포함하지 않으므로 Δχ² 임계를 잔차로 스케일(χ²_min/dof, 표준 관행)
  const nObs = entry.samples.reduce((n, sm) => n + ['T', 'R', 'haze', 'hpa'].filter((k) => sm[k] != null).length + (sm.curve ? 1 : 0), 0);
  const dof = Math.max(1, nObs - (best.f.free.mua ? 3 : 2));
  const dChi = Math.max(1, best.J / dof);
  const pts = [...cache.values()].sort((p, q) => p.d - q.d), lim = best.J + dChi, bi2 = pts.indexOf(best);
  const cross = (i, j) => { const a = pts[i], b = pts[j]; const f = (lim - a.J) / (b.J - a.J); return Math.exp(Math.log(a.d) + f * (Math.log(b.d) - Math.log(a.d))); };
  let iL = bi2; while (iL > 0 && pts[iL - 1].J <= lim) iL--;
  let iR = bi2; while (iR < pts.length - 1 && pts[iR + 1].J <= lim) iR++;
  // 탐색 분해능: 황금분할 최종 구간 [e^a, e^b] 보다 좁게 지름을 안다고 말할 수 없다 — 범위는 그 구간을 포함
  const dRange = [Math.min(iL > 0 ? cross(iL, iL - 1) : pts[0].d, Math.exp(a)), Math.max(iR < pts.length - 1 ? cross(iR, iR + 1) : pts[pts.length - 1].d, Math.exp(b))];
  const notes = dRange[1] / dRange[0] > 2
    ? [`입자 지름 식별 불가 — ${dRange[0].toFixed(1)}~${dRange[1].toFixed(1)}µm 가 측정을 같은 정도로 재현(측정 곡선·2두께 필요). 농도는 선택 지름 기준`]
    : [];
  return {
    d_um: best.d, dRange, notes, opt: best.opt, fit: best.f, mus, phi, wt: wtFromVolume(phi, bead.rho, host.rho),
    dependentScattering: phi > 0.1, hg, tauFit, evaluated: cache.size, chi2min: best.J, dof, dChi,
    scan: [...cache.values()].sort((p, q) => p.d - q.d).map((r) => ({ d: r.d, g: r.opt.g, J: r.J, V6: r.f.V6.ok })),
  };
}
