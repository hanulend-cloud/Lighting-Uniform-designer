// L2 슬래브 응답 테이블 — 레코드 패킹·로드·보간·흡수 적용·확산근사 전이 (spec 2026-10-07 §5.2).
// 테이블 셀 = (τ', g, n, 입사 행). 행 0..8 = 공기 중 입사 cos 균등(0~85°), 마지막 행 = 확산(Lambertian) 입사.
// 길이는 두께 t 단위. 질의 결과 q = { Tb, Ts, R, rad(반경 분포, 합 1), radTail, ang(출사각 분포, 합 1), shift, outOfRange }.
import { N_PATH, N_RAD, N_ANG, N_KAP, attenuate, radEdge, angEdgeDeg } from './mc-slab.js';
import { diffusionTR, diffusionKernel, diffusionAngles } from './diffusion.js';

// v2(2026-10-13): 반사광(하면 내부 탈출) 측방 반경 rRad·출사각 rAng 분포를 끝에 추가 — 재순환 착지 커널.
// v1 표(REC_V1)는 읽을 때 0 으로 확장되고, 그 경우 solver 는 기존 램버시안 갭 커널로 대체한다.
export const REC_V1 = 7 * N_PATH + N_RAD + N_ANG + 2;
// v3(2026-10-13): 산란 투과의 평균 출사점 기준 반경 분포 radC 추가 — 경사 입사 커널(입사점 기준 rad 의 시프트·축척은 도넛).
// 같은 판에서 반사광 착지 반경 분포 land(κ = t/h 4개, h 단위) 추가 — 출사점·출사 방향 상관을 보존한 재순환 착지 커널.
// v2 표는 0 으로 확장되고 solver 는 기존 근사(시프트·축척, 독립 합성 착지)로 대체한다.
export const REC_V2 = REC_V1 + N_RAD + N_ANG;
export const REC = REC_V2 + N_RAD + 1 + N_KAP * N_RAD;
const O = {
  Tb: 0, TbL: N_PATH, Ts: 2 * N_PATH, TsL: 3 * N_PATH, R: 4 * N_PATH, RL: 5 * N_PATH,
  rad: 6 * N_PATH, ang: 6 * N_PATH + N_RAD, TsR2: 6 * N_PATH + N_RAD + N_ANG,
  shift: 7 * N_PATH + N_RAD + N_ANG, photons: 7 * N_PATH + N_RAD + N_ANG + 1,
  rRad: REC_V1, rAng: REC_V1 + N_RAD, radC: REC_V2, xMed: REC_V2 + N_RAD, land: REC_V2 + N_RAD + 1,
};
export const SW_LO = 10, SW_HI = 20;      // MC → 확산근사 전이 구간(τ')
const DEG = Math.PI / 180;

// MC 레코드 → Float32 (광자 수로 정규화)
export function packRecord(rec) {
  const out = new Float32Array(REC), N = rec.photons;
  for (const k of ['Tb', 'TbL', 'Ts', 'TsL', 'R', 'RL', 'rad', 'ang', 'TsR2', 'rRad', 'rAng', 'radC', 'land']) {
    const a = rec[k]; for (let i = 0; i < a.length; i++) out[O[k] + i] = a[i] / N;
  }
  out[O.shift] = rec.shift / N; out[O.photons] = N; out[O.xMed] = rec.xMed ?? 0;
  return out;
}

export function blend(parts) {
  const q = { Tb: 0, Ts: 0, R: 0, rad: new Float64Array(N_RAD), ang: new Float64Array(N_ANG), rRad: new Float64Array(N_RAD), rAng: new Float64Array(N_ANG), radC: new Float64Array(N_RAD), xMed: 0, land: new Float64Array(N_KAP * N_RAD), radTail: 0, shift: 0, nScat: 0, radScale: 0 };
  let ws = 0, wr = 0, wc = 0, wl = 0, wall = 0;
  const inv = [];                                  // 분포 혼합의 유효 광자 수: 가중평균 분산 Σa²/n
  for (const [w, c] of parts) {
    q.Tb += w * c.Tb; q.Ts += w * c.Ts; q.R += w * c.R;
    const vr = c.rRad && c.rRadOk ? w * c.R : 0;      // 반사 분포는 반사량 가중(v1 표·확산근사 칸은 rRadOk 로 구분)
    if (vr > 0) { wr += vr; for (let k = 0; k < N_RAD; k++) q.rRad[k] += vr * c.rRad[k]; for (let k = 0; k < N_ANG; k++) q.rAng[k] += vr * c.rAng[k]; }
    if (w * c.R > 0) { wall += w * c.R; if (c.landOk) { wl += w * c.R; for (let k = 0; k < N_KAP * N_RAD; k++) q.land[k] += w * c.R * c.land[k]; } }
    const v = w * c.Ts;                          // 분포는 산란 투과량 가중으로 혼합
    if (v > 0) {
      ws += v;
      for (let k = 0; k < N_RAD; k++) q.rad[k] += v * c.rad[k];
      if (c.radCOk) { wc += v; q.xMed += v * (c.xMed ?? 0); for (let k = 0; k < N_RAD; k++) q.radC[k] += v * c.radC[k]; }
      for (let k = 0; k < N_ANG; k++) q.ang[k] += v * c.ang[k];
      q.radTail += v * c.radTail; q.shift += v * c.shift; q.radScale += v * (c.radScale ?? 1); inv.push([v, c.nScat]);
    }
  }
  q.rRadOk = wr > 0;
  q.radCOk = ws > 0 && wc > ws * (1 - 1e-9);
  q.landOk = wall > 0 && wl > wall * (1 - 1e-9);
  if (wl > 0) for (let k = 0; k < N_KAP * N_RAD; k++) q.land[k] /= wl;   // 섞인 칸이 모두 v3 일 때만
  if (wc > 0) { q.xMed /= wc; for (let k = 0; k < N_RAD; k++) q.radC[k] /= wc; }
  if (wr > 0) { for (let k = 0; k < N_RAD; k++) q.rRad[k] /= wr; for (let k = 0; k < N_ANG; k++) q.rAng[k] /= wr; }
  if (ws > 0) {
    for (let k = 0; k < N_RAD; k++) q.rad[k] /= ws;
    for (let k = 0; k < N_ANG; k++) q.ang[k] /= ws;
    q.radTail /= ws; q.shift /= ws; q.radScale /= ws;
    let iv = 0; for (const [v, n] of inv) iv += (v / ws) ** 2 / n;
    q.nScat = iv > 0 ? 1 / iv : Infinity;
  }
  return q;
}

// 착지 분포: κ 블록마다 합 1 로 정규화(R_MAX·h 밖 = 스치는 출사 ≪1% 는 버림)
function landOf(raw) {
  const land = new Float64Array(N_KAP * N_RAD);
  for (let c = 0; c < N_KAP; c++) {
    let s = 0; for (let k = 0; k < N_RAD; k++) s += raw[c * N_RAD + k];
    if (!(s > 0)) return { land, landOk: false };
    for (let k = 0; k < N_RAD; k++) land[c * N_RAD + k] = raw[c * N_RAD + k] / s;
  }
  return { land, landOk: true };
}

// 흡수에 의한 측방 확산 폭 비율 = RMS 반경(흡수 가중) / RMS 반경(무흡수). 경로 bin 별 Σw·r² 로 정확히 계산.
function radScaleOf(w, wL, wR2, muaT) {
  if (!muaT) return 1;
  let a0 = 0, b0 = 0, a1 = 0, b1 = 0;
  for (let k = 0; k < w.length; k++) {
    if (!(w[k] > 0)) continue;
    const f = Math.exp(-muaT * wL[k] / w[k]);
    a0 += wR2[k]; b0 += w[k]; a1 += wR2[k] * f; b1 += w[k] * f;
  }
  return a0 > 0 && b1 > 0 ? Math.sqrt((a1 / b1) / (a0 / b0)) : 1;
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
  const NC = NT * NG * NN * NROW;
  for (const RO of [REC_V1, REC_V2]) if (meta.rec === RO && data.length === NC * RO) {   // v1·v2 → v3 확장(추가 분포 0 = 없음)
    const d2 = new Float32Array(NC * REC);
    for (let c = 0; c < NC; c++) d2.set(data.subarray(c * RO, (c + 1) * RO), c * REC);
    data = d2; meta = { ...meta, rec: REC, v1: RO === REC_V1, v2: RO === REC_V2 };
  }
  if (meta.rec !== REC) throw new Error(`slab-table 레코드 길이 불일치: ${meta.rec} ≠ ${REC}`);
  if (data.length !== NC * REC) throw new Error('slab-table 크기 불일치');
  const diffuseRow = NROW - 1, angleRows = NROW - 1;
  const off = (it, ig, inn, ir) => ((((it * NG + ig) * NN + inn) * NROW + ir) * REC);

  function cell(o, muaT) {
    const sl = (k, len) => data.subarray(o + O[k], o + O[k] + len);
    const TsRaw = sl('Ts', N_PATH).reduce((p, v) => p + v, 0);
    const radRaw = sl('rad', N_RAD), sR = radRaw.reduce((p, v) => p + v, 0);
    const angRaw = sl('ang', N_ANG), sA = angRaw.reduce((p, v) => p + v, 0);
    const rcRaw = sl('radC', N_RAD), sRC = rcRaw.reduce((p, v) => p + v, 0);
    const rrRaw = sl('rRad', N_RAD), sRR = rrRaw.reduce((p, v) => p + v, 0), raRaw = sl('rAng', N_ANG), sRA = raRaw.reduce((p, v) => p + v, 0);
    return {
      rRad: sRR > 0 ? Float64Array.from(rrRaw, (v) => v / sRR) : new Float64Array(N_RAD),
      rAng: sRA > 0 ? Float64Array.from(raRaw, (v) => v / sRA) : new Float64Array(N_ANG),
      rRadOk: sRR > 0 && sRA > 0,
      radC: sRC > 0 ? Float64Array.from(rcRaw, (v) => v / sRC) : new Float64Array(N_RAD),
      radCOk: sRC > 0 || TsRaw <= 0, xMed: data[o + O.xMed], ...landOf(sl('land', N_KAP * N_RAD)),
      Tb: attenuate(sl('Tb', N_PATH), sl('TbL', N_PATH), muaT),
      Ts: attenuate(sl('Ts', N_PATH), sl('TsL', N_PATH), muaT),
      R: attenuate(sl('R', N_PATH), sl('RL', N_PATH), muaT),
      rad: sR > 0 ? Float64Array.from(radRaw, (v) => v / sR) : new Float64Array(N_RAD),
      radTail: TsRaw > 0 ? Math.max(0, 1 - sR / TsRaw) : 0,
      ang: sA > 0 ? Float64Array.from(angRaw, (v) => v / sA) : new Float64Array(N_ANG),
      shift: TsRaw > 0 ? data[o + O.shift] / TsRaw : 0,
      radScale: radScaleOf(sl('Ts', N_PATH), sl('TsL', N_PATH), sl('TsR2', N_PATH), muaT),
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
      Tb: 0, Ts: T, R, rad: kMemo.get(kk), radTail: 0, ang: aMemo.get(n), shift: 0, nScat: Infinity, radScale: 1,   // τ'>20: 흡수 측방 축소 미반영(가정 패널)
      rRad: kMemo.get(kk), rAng: aMemo.get(n), rRadOk: true, radC: kMemo.get(kk), radCOk: true, xMed: 0,         // 확산 반사: 측방 = 확산 커널, 각 = 확산 출사(근사)
      outOfRange: g < G.g[0] - 1e-9 || g > G.g[NG - 1] + 1e-9 || n < G.n[0] - 1e-9 || n > G.n[NN - 1] + 1e-9,
    };
  }
  // mode: undefined(자동 전이) | 'mc' | 'diff'
  // 질의 메모: solve 마다 밴드별로 같은 (τ', g, n, 행, μa·t) 를 다시 묻는다 — v3 필드(radC·land) 로 cell() 이 무거워져 탐색 비용의 큰 몫.
  // 반환 객체는 공유되므로 호출측은 고치지 말 것(복사 후 표시 — mie-material compositeTable 참고).
  const memo = new Map();
  function query(tauR, g, n, row, muaT = 0, mode) {
    const key = `${tauR}|${g}|${n}|${row}|${muaT}|${mode ?? ''}`;
    let q = globalThis.__noQueryMemo ? null : memo.get(key);
    if (!q) { q = query0(tauR, g, n, row, muaT, mode); if (memo.size > 20000) memo.clear(); memo.set(key, q); }
    return q;
  }
  function query0(tauR, g, n, row, muaT = 0, mode) {
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
  // 입사 cos → 인접 두 행 선형 보간 가중 [b0, b1, w1] (행은 cos 내림차순). 최근접 행 통째 배정은 밴드 경계에서
  // 커널이 계단식으로 바뀌어 PSF 에 고리·과집중을 만든다(형상 MC VS6 에서 확인).
  const _split = [0, 0, 0];
  function bandSplit(mu) {
    const R = G.rows;
    if (mu >= R[0]) { _split[0] = 0; _split[1] = 0; _split[2] = 0; return _split; }
    for (let k = 0; k < angleRows - 1; k++) {
      if (mu >= R[k + 1]) { _split[0] = k; _split[1] = k + 1; _split[2] = (R[k] - mu) / (R[k] - R[k + 1]); return _split; }
    }
    _split[0] = angleRows - 1; _split[1] = angleRows - 1; _split[2] = 0; return _split;
  }
  return { meta, grids: G, angleRows, diffuseRow, query, bandOf, bandSplit, _data: data, _off: off };
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

// 산란광의 법선 방향 방사휘도 계수: L(0°) = M·f (M = 출사도). ang 은 출사각 파워 분율(합 1),
// 0~5° 를 풀링한 평균 광도(/sr). Lambertian 이면 1/π.
export function normalRadianceFactor(ang) {
  let p = 0, o = 0;
  for (let k = 0; k < 5; k++) {
    p += ang[k];
    o += 2 * Math.PI * (Math.cos(angEdgeDeg(k) * DEG) - Math.cos(angEdgeDeg(k + 1) * DEG));
  }
  return o > 0 ? p / o : 1 / Math.PI;
}
