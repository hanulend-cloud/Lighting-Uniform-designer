// L2 슬래브 응답 테이블 — 레코드 패킹·로드·보간·흡수 적용·확산근사 전이 (spec 2026-10-07 §5.2).
// 테이블 셀 = (τ', g, n, 입사 행). 행 0..8 = 공기 중 입사 cos 균등(0~85°), 마지막 행 = 확산(Lambertian) 입사.
// 길이는 두께 t 단위. 질의 결과 q = { Tb, Ts, R, rad(반경 분포, 합 1), radTail, ang(출사각 분포, 합 1), shift, outOfRange }.
import { N_PATH, N_RAD, N_ANG, attenuate, radEdge, angEdgeDeg } from './mc-slab.js';
import { diffusionTR, diffusionKernel, diffusionAngles } from './diffusion.js';

export const REC = 6 * N_PATH + N_RAD + N_ANG + 2;
const O = {
  Tb: 0, TbL: N_PATH, Ts: 2 * N_PATH, TsL: 3 * N_PATH, R: 4 * N_PATH, RL: 5 * N_PATH,
  rad: 6 * N_PATH, ang: 6 * N_PATH + N_RAD, shift: 6 * N_PATH + N_RAD + N_ANG, photons: 6 * N_PATH + N_RAD + N_ANG + 1,
};
export const SW_LO = 10, SW_HI = 20;      // MC → 확산근사 전이 구간(τ')
const DEG = Math.PI / 180;

// MC 레코드 → Float32 (광자 수로 정규화)
export function packRecord(rec) {
  const out = new Float32Array(REC), N = rec.photons;
  for (const k of ['Tb', 'TbL', 'Ts', 'TsL', 'R', 'RL', 'rad', 'ang']) {
    const a = rec[k]; for (let i = 0; i < a.length; i++) out[O[k] + i] = a[i] / N;
  }
  out[O.shift] = rec.shift / N; out[O.photons] = N;
  return out;
}

function blend(parts) {
  const q = { Tb: 0, Ts: 0, R: 0, rad: new Float64Array(N_RAD), ang: new Float64Array(N_ANG), radTail: 0, shift: 0, nScat: 0 };
  let ws = 0;
  const inv = [];                                  // 분포 혼합의 유효 광자 수: 가중평균 분산 Σa²/n
  for (const [w, c] of parts) {
    q.Tb += w * c.Tb; q.Ts += w * c.Ts; q.R += w * c.R;
    const v = w * c.Ts;                          // 분포는 산란 투과량 가중으로 혼합
    if (v > 0) {
      ws += v;
      for (let k = 0; k < N_RAD; k++) q.rad[k] += v * c.rad[k];
      for (let k = 0; k < N_ANG; k++) q.ang[k] += v * c.ang[k];
      q.radTail += v * c.radTail; q.shift += v * c.shift; inv.push([v, c.nScat]);
    }
  }
  if (ws > 0) {
    for (let k = 0; k < N_RAD; k++) q.rad[k] /= ws;
    for (let k = 0; k < N_ANG; k++) q.ang[k] /= ws;
    q.radTail /= ws; q.shift /= ws;
    let iv = 0; for (const [v, n] of inv) iv += (v / ws) ** 2 / n;
    q.nScat = iv > 0 ? 1 / iv : Infinity;
  }
  return q;
}

function linBracket(grid, v) {
  const L = grid.length - 1;
  if (v <= grid[0]) return { i0: 0, i1: 0, w: 0, clamped: v < grid[0] - 1e-9 };
  if (v >= grid[L]) return { i0: L, i1: L, w: 0, clamped: v > grid[L] + 1e-9 };
  let i = 0; while (grid[i + 1] < v) i++;
  return { i0: i, i1: i + 1, w: (v - grid[i]) / (grid[i + 1] - grid[i]), clamped: false };
}

export function createTable(meta, data) {
  const G = meta.grids, NT = G.tauR.length, NG = G.g.length, NN = G.n.length, NROW = G.rows.length;
  if (meta.rec !== REC) throw new Error(`slab-table 레코드 길이 불일치: ${meta.rec} ≠ ${REC}`);
  if (data.length !== NT * NG * NN * NROW * REC) throw new Error('slab-table 크기 불일치');
  const diffuseRow = NROW - 1, angleRows = NROW - 1;
  const off = (it, ig, inn, ir) => ((((it * NG + ig) * NN + inn) * NROW + ir) * REC);

  function cell(o, muaT) {
    const sl = (k, len) => data.subarray(o + O[k], o + O[k] + len);
    const TsRaw = sl('Ts', N_PATH).reduce((p, v) => p + v, 0);
    const radRaw = sl('rad', N_RAD), sR = radRaw.reduce((p, v) => p + v, 0);
    const angRaw = sl('ang', N_ANG), sA = angRaw.reduce((p, v) => p + v, 0);
    return {
      Tb: attenuate(sl('Tb', N_PATH), sl('TbL', N_PATH), muaT),
      Ts: attenuate(sl('Ts', N_PATH), sl('TsL', N_PATH), muaT),
      R: attenuate(sl('R', N_PATH), sl('RL', N_PATH), muaT),
      rad: sR > 0 ? Float64Array.from(radRaw, (v) => v / sR) : new Float64Array(N_RAD),
      radTail: TsRaw > 0 ? Math.max(0, 1 - sR / TsRaw) : 0,
      ang: sA > 0 ? Float64Array.from(angRaw, (v) => v / sA) : new Float64Array(N_ANG),
      shift: TsRaw > 0 ? data[o + O.shift] / TsRaw : 0,
      nScat: TsRaw * data[o + O.photons],          // 산란 투과 광자(가중치) 수 — 각분포 통계 신뢰도
    };
  }
  function tauBracket(v) {
    const T = G.tauR;
    if (v <= 0) return { i0: 0, i1: 0, w: 0 };
    if (v < T[1]) return { i0: 0, i1: 1, w: v / T[1] };
    if (v >= T[NT - 1]) return { i0: NT - 1, i1: NT - 1, w: 0 };
    let i = 1; while (T[i + 1] < v) i++;
    return { i0: i, i1: i + 1, w: Math.log(v / T[i]) / Math.log(T[i + 1] / T[i]) };
  }
  function mc(tauR, g, n, row, muaT) {
    const bt = tauBracket(tauR), bg = linBracket(G.g, g), bn = linBracket(G.n, n);
    const parts = [];
    for (const [it, wt] of [[bt.i0, 1 - bt.w], [bt.i1, bt.w]])
      for (const [ig, wg] of [[bg.i0, 1 - bg.w], [bg.i1, bg.w]])
        for (const [inn, wn] of [[bn.i0, 1 - bn.w], [bn.i1, bn.w]]) {
          const w = wt * wg * wn;
          if (w > 0) parts.push([w, cell(off(it, ig, inn, row), muaT)]);
        }
    const q = blend(parts);
    q.outOfRange = bg.clamped || bn.clamped;
    return q;
  }
  const kMemo = new Map(), aMemo = new Map();
  function diff(tauR, g, n, row, muaT) {
    const inc = row === diffuseRow ? 'diffuse' : G.rows[row];
    const { T, R } = diffusionTR(tauR, muaT, n, inc);
    const kk = `${tauR.toPrecision(4)}|${n}|${inc}`;
    if (!kMemo.has(kk)) kMemo.set(kk, diffusionKernel(tauR, n, inc));
    if (!aMemo.has(n)) aMemo.set(n, diffusionAngles(n));
    return {
      Tb: 0, Ts: T, R, rad: kMemo.get(kk), radTail: 0, ang: aMemo.get(n), shift: 0, nScat: Infinity,
      outOfRange: g < G.g[0] - 1e-9 || g > G.g[NG - 1] + 1e-9 || n < G.n[0] - 1e-9 || n > G.n[NN - 1] + 1e-9,
    };
  }
  // mode: undefined(자동 전이) | 'mc' | 'diff'
  function query(tauR, g, n, row, muaT = 0, mode) {
    if (mode === 'mc' || (!mode && tauR <= SW_LO)) return mc(tauR, g, n, row, muaT);
    if (mode === 'diff' || tauR >= SW_HI) return diff(tauR, g, n, row, muaT);
    const w = Math.log(tauR / SW_LO) / Math.log(SW_HI / SW_LO);
    const a = mc(tauR, g, n, row, muaT), b = diff(tauR, g, n, row, muaT);
    const q = blend([[1 - w, a], [w, b]]);
    q.outOfRange = a.outOfRange || b.outOfRange;
    return q;
  }
  // 입사 cos → 가장 가까운 각도 행
  function bandOf(mu) {
    let best = 0, d = Infinity;
    for (let k = 0; k < angleRows; k++) { const e = Math.abs(G.rows[k] - mu); if (e < d) { d = e; best = k; } }
    return best;
  }
  return { meta, grids: G, angleRows, diffuseRow, query, bandOf, _data: data, _off: off };
}

// 반경 분포의 RMS 반경(두께 단위)
export function kernelRms(rad) {
  let m2 = 0; for (let k = 0; k < N_RAD; k++) m2 += rad[k] * ((radEdge(k) + radEdge(k + 1)) / 2) ** 2;
  return Math.sqrt(m2);
}

// 투과 광도 I(θ) 가 I(0)/2 가 되는 반광각 HPA(°). 비산란 성분은 0~1° bin 에 포함(측정기 분해능 ~1° 가정).
// MC 각분포는 bin 입체각이 작은 정면부일수록 광자가 적어 잡음이 크다(근-Lambertian 에서 0~5° 에 ≈0.8%).
// → I(0) 는 5° 부터 시작해 산란 광자 MIN_CNT 개 이상이 모일 때까지(최대 30°) 콘을 넓혀 풀링한 평균 광도,
//   10° 이후 bin 은 이웃 3-bin 가중 평균으로 평활. 확산근사(무한 통계)는 그대로.
const MIN_CNT = 400;
// { hpa, sigma } — sigma = MC 통계 불확도(°): 풀링 I(0) 와 교차점 부근 bin 의 상대 잡음 √(1/n₀+1/n_c) 를 기울기로 환산
export function hpaStats(q) {
  const dO = (k) => 2 * Math.PI * (Math.cos(angEdgeDeg(k) * DEG) - Math.cos(angEdgeDeg(k + 1) * DEG));
  const nS = q.nScat ?? Infinity, cnt = (k) => q.ang[k] * nS;
  let pool = 5, pP = 0, pO = 0, pc = 0;
  for (let k = 0; k < pool; k++) { pP += q.ang[k]; pO += dO(k); pc += cnt(k); }
  while (pc < MIN_CNT && angEdgeDeg(pool + 1) <= 30) { pP += q.ang[pool]; pO += dO(pool); pc += cnt(pool); pool++; }
  const Is = (k) => q.ang[k] / dO(k);
  const smooth = (k) => angEdgeDeg(k) >= 10 && k > 0 && k < N_ANG - 1;
  const I = new Float64Array(N_ANG);
  for (let k = 0; k < N_ANG; k++) {
    const v = k < pool ? pP / pO : smooth(k) ? (Is(k - 1) + Is(k) + Is(k + 1)) / 3 : Is(k);
    I[k] = q.Ts * v + (k === 0 ? q.Tb / dO(0) : 0);
  }
  if (!(I[0] > 0)) return { hpa: 0, sigma: 0 };
  const half = I[0] / 2;
  for (let k = 1; k < N_ANG; k++) {
    if (I[k] < half) {
      const c0 = (angEdgeDeg(k - 1) + angEdgeDeg(k)) / 2, c1 = (angEdgeDeg(k) + angEdgeDeg(k + 1)) / 2;
      const hpa = c0 + (I[k - 1] - half) / (I[k - 1] - I[k]) * (c1 - c0);
      const nc = smooth(k) ? cnt(k - 1) + cnt(k) + cnt(k + 1) : cnt(k);
      const rel = Number.isFinite(nS) ? Math.sqrt(1 / Math.max(pc, 1) + 1 / Math.max(nc, 1)) : 0;
      const slope = (I[k - 1] - I[k]) / (c1 - c0);          // 광도/°
      return { hpa, sigma: slope > 0 ? (rel * half) / slope : 0 };
    }
  }
  return { hpa: 90, sigma: 0 };
}
export function hpaDeg(q) { return hpaStats(q).hpa; }
