// L2 분석 방향 — 실측 BTDF/BRDF·데이터시트 → μs'·g·μa 피팅 → Milky (spec 2026-10-07 §6.1, V6, V9).
// 측정은 법선 입사 가정. 모델 = 저장소 슬래브 응답표(MC + 확산근사, V1 로 AD 와 대조된 것)를 그대로 사용 —
// 런타임 MC 없이 격자 탐색 + Nelder–Mead 로 수백 ms 안에 끝난다.
//
// 측정 항목(entry.samples[]): { t(mm), T?, R?, haze?, hpa?(°), curve?: [{theta, v}], curveType?: 'intensity'|'btdf' }
//   T  : 전광선투과율(0~1)  R : 전반사율(정반사 포함, 0~1)  haze : ASTM D1003 (2.5° 밖 산란 / 전투과)
//   curve : 투과 각분포 — 'intensity' = 광도 I(θ), 'btdf' = BTDF(θ) (광도 = BTDF·cosθ). 크기는 무관(모양만 사용)
import { N_ANG, angEdgeDeg } from './mc-slab.js';
import { hpaStats } from './slab-table.js';
import { milkyFromMusR } from './milky.js';
import { L2_G, MUA_RESIN, KAPPA } from './material.js';

const DEG = Math.PI / 180;
const dOmega = (k) => 2 * Math.PI * (Math.cos(angEdgeDeg(k) * DEG) - Math.cos(angEdgeDeg(k + 1) * DEG));
// 모양 비교 격자: 5~10° 풀링 1개 + 10~80° 5° bin 14개 (1° bin 은 MC 잡음이 커서 풀링)
const SHAPE_BINS = [[5, 10], ...Array.from({ length: 14 }, (_, i) => [10 + 5 * i, 15 + 5 * i])];

export function parseAngleCsv(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const c = line.trim().split(/[,\t; ]+/).map(Number);
    if (c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) out.push({ theta: c[0], v: c[1] });
  }
  return out.sort((a, b) => a.theta - b.theta);
}

// 법선 입사 측정 예측: 두께 t(mm) 시료
export function predictSample(table, mat, t) {
  const q = table.query(mat.musR * t, mat.g, mat.n, 0, mat.mua * t);
  const T = q.Tb + q.Ts;
  // haze: 2.5° 밖 산란분(0~2°, 2~3° bin 의 절반은 안쪽) / 전투과
  let inner = q.Tb + q.Ts * (q.ang[0] + q.ang[1] + 0.5 * q.ang[2]);
  const I = new Float64Array(N_ANG);
  for (let k = 0; k < N_ANG; k++) I[k] = (q.Ts * q.ang[k] + (k === 0 ? q.Tb : 0)) / dOmega(k);
  return { T, R: q.R, Tb: q.Tb, Ts: q.Ts, haze: T > 0 ? (T - inner) / T : 0, hpa: hpaStats(q).hpa, I, q };
}

// 모델 광도 → 비교 격자 평균 광도(정규화: 격자 평균 = 1)
function modelShape(I) {
  const s = SHAPE_BINS.map(([a, b]) => {
    let p = 0, o = 0;
    for (let k = 0; k < N_ANG; k++) {
      const lo = angEdgeDeg(k), hi = angEdgeDeg(k + 1);
      if (lo >= a && hi <= b) { p += I[k] * dOmega(k); o += dOmega(k); }
    }
    return o > 0 ? p / o : 0;
  });
  const m = s.reduce((x, v) => x + v, 0) / s.length;
  return m > 0 ? s.map((v) => v / m) : s;
}

// 측정 곡선 → 비교 격자 평균 광도(입체각 가중 적분 평균, 정규화)
export function measuredShape(sample) {
  const c = sample.curve;
  if (!c || c.length < 3) return null;
  const Iat = (th) => {
    if (th <= c[0].theta) return val(c[0]);
    for (let i = 1; i < c.length; i++) if (th <= c[i].theta) {
      const f = (th - c[i - 1].theta) / (c[i].theta - c[i - 1].theta);
      return val(c[i - 1]) * (1 - f) + val(c[i]) * f;
    }
    return val(c[c.length - 1]);
  };
  const val = (p) => (sample.curveType === 'btdf' ? p.v * Math.cos(p.theta * DEG) : p.v);
  const s = SHAPE_BINS.map(([a, b]) => {
    let p = 0, o = 0;
    for (let i = 0; i < 10; i++) { const th = a + (b - a) * (i + 0.5) / 10, w = Math.sin(th * DEG); p += Iat(th) * w; o += w; }
    return p / o;
  });
  if (c[c.length - 1].theta < 75) return null;   // 각도 범위 부족
  const m = s.reduce((x, v) => x + v, 0) / s.length;
  return m > 0 ? s.map((v) => v / m) : null;
}

// 절대 BTDF 곡선이면 T 를 적분으로 보충(T = 2π∫BTDF·cosθ·sinθ dθ)
export function totalFromBtdf(curve) {
  let s = 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i], ta = a.theta * DEG, tb = b.theta * DEG;
    s += 0.5 * (a.v * Math.cos(ta) * Math.sin(ta) + b.v * Math.cos(tb) * Math.sin(tb)) * (tb - ta);
  }
  return 2 * Math.PI * s;
}

const SIG = { T: 0.01, R: 0.01, haze: 0.02, hpa: 1.5, shape: 0.03 };
// 측정 HPA < 5° = 정투과(비산란) 피크가 정면 광도를 지배 — 이때 HPA 는 정투과 분율의 아주 작은 차이에도
// 1°↔수십° 로 튀는 악조건 지표라 비교에서 제외한다(헤이즈·곡선으로 비교).
const HPA_MIN = 5;
const hpaUsable = (s) => s.hpa != null && s.hpa >= HPA_MIN;

function cost(table, mat, samples) {
  let J = 0;
  for (const s of samples) {
    const p = predictSample(table, mat, s.t);
    if (s.T != null) J += ((s.T - p.T) / SIG.T) ** 2;
    if (s.R != null) J += ((s.R - p.R) / SIG.R) ** 2;
    if (s.haze != null) J += ((s.haze - p.haze) / SIG.haze) ** 2;
    if (hpaUsable(s)) J += ((s.hpa - p.hpa) / SIG.hpa) ** 2;
    if (s._shape) {
      const m = modelShape(p.I);
      let e = 0; for (let i = 0; i < m.length; i++) e += ((s._shape[i] - m[i]) / SIG.shape) ** 2;
      J += e / m.length;
    }
  }
  return J;
}

function nelderMead(f, x0, step, iters = 300) {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    pts.sort((a, b) => a.f - b.f);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i].x[j] / n;
    const w = pts[n], mv = (a, s) => c.map((v, j) => v + s * (a[j] - v));
    const r = { x: mv(w.x, -1) }; r.f = f(r.x);
    if (r.f < pts[0].f) { const e = { x: mv(w.x, -2) }; e.f = f(e.x); pts[n] = e.f < r.f ? e : r; }
    else if (r.f < pts[n - 1].f) pts[n] = r;
    else {
      const k = { x: mv(w.x, 0.5) }; k.f = f(k.x);
      if (k.f < w.f) pts[n] = k;
      else for (let i = 1; i <= n; i++) { pts[i].x = pts[i].x.map((v, j) => pts[0].x[j] + 0.5 * (v - pts[0].x[j])); pts[i].f = f(pts[i].x); }
    }
    if (Math.abs(pts[n].f - pts[0].f) < 1e-9 * (1 + Math.abs(pts[0].f))) break;
  }
  pts.sort((a, b) => a.f - b.f);
  return pts[0];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// free: { g: bool, mua: bool }. 반환 mat = { musR, g, mua, n }
function fitCore(table, samples, n, free) {
  const make = (x) => {
    const musR = Math.exp(x[0]);
    const g = free.g ? clamp(x[1], 0.6, 0.99) : L2_G;
    const mua = free.mua ? Math.exp(clamp(x[free.g ? 2 : 1], Math.log(1e-5), Math.log(1))) : MUA_RESIN + KAPPA * musR / (1 - g);
    return { musR, g, mua, n };
  };
  const f = (x) => cost(table, make(x), samples);
  // 격자 탐색
  const gs = free.g ? [0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99] : [null];
  const as = free.mua ? [-11, -9, -7, -5.5, -4, -2.5, -1.2] : [null];
  let best = null;
  for (let e = -9; e <= 9.2; e += 0.3) for (const g of gs) for (const a of as) {
    const x = [e, ...(free.g ? [g] : []), ...(free.mua ? [a] : [])];
    const v = f(x);
    if (!best || v < best.f) best = { x, f: v };
  }
  const step = [0.3, ...(free.g ? [0.05] : []), ...(free.mua ? [1] : [])];
  const r = nelderMead(f, best.x, step);
  return { mat: make(r.x), J: r.f };
}

// entry = { name, n?, samples: [...] }  →  { mat, milky, free, notes, predictions, V6, V9 }
export function fitMaterial(table, entry) {
  const n = entry.n ?? 1.586;
  const samples = entry.samples.map((s) => {
    const o = { ...s };
    if (o.curve && o.curveType === 'btdf' && o.T == null && o.curveAbsolute) o.T = totalFromBtdf(o.curve);
    o._shape = measuredShape(o);
    return o;
  });
  const hasAng = samples.some((s) => s._shape || s.hpa != null);
  const thick = new Set(samples.map((s) => s.t)).size;
  const free = { g: hasAng, mua: samples.some((s) => s.R != null) || thick >= 2 };
  const notes = [];
  let r = fitCore(table, samples, n, free);
  const tauMax = Math.max(...samples.map((s) => r.mat.musR * s.t));
  if (free.g && tauMax >= 8) {
    free.g = false;
    notes.push(`g 식별 불가 — 확산 영역(τ'=${tauMax.toFixed(1)} ≥ 8)에서는 결과가 μs' 에만 의존, g=${L2_G} 고정`);
    r = fitCore(table, samples, n, free);
  }
  if (!hasAng) notes.push(`각도 정보(곡선·HPA) 없음 — g=${L2_G} 고정`);
  if (samples.some((s) => s.hpa != null && !hpaUsable(s))) notes.push(`HPA < ${HPA_MIN}° 시료는 정투과 피크 지배 — HPA 비교 제외`);
  if (!free.mua) notes.push('R 미측정·단일 두께 — μa 를 기본값(투명 PC + 산란제 흡수 임시값)으로 고정');
  if (!samples.some((s) => s._shape) && samples.some((s) => s.curve)) notes.push('곡선이 짧거나(75° 미만) 점이 부족해 모양 비교 제외');

  const predictions = samples.map((s) => ({ t: s.t, meas: s, pred: predictSample(table, r.mat, s.t) }));
  // V6: 피팅 재현
  let worstT = 0, worstR = 0, worstH = 0, worstC = 0;
  for (const { meas: s, pred: p } of predictions) {
    if (s.T != null) worstT = Math.max(worstT, Math.abs(s.T - p.T));
    if (s.R != null) worstR = Math.max(worstR, Math.abs(s.R - p.R));
    if (hpaUsable(s)) worstH = Math.max(worstH, Math.abs(s.hpa - p.hpa));
    if (s._shape) {
      const m = modelShape(p.I); let e = 0;
      for (let i = 0; i < m.length; i++) e += (s._shape[i] - m[i]) ** 2;
      worstC = Math.max(worstC, Math.sqrt(e / m.length));
    }
  }
  const V6 = { id: 'V6', ok: worstT <= 0.02 && worstR <= 0.02 && worstH <= 2 && worstC <= 0.05, value: Math.max(worstT, worstR), limit: 'T·R ±2%p, HPA ±2°, 곡선 RMS ≤5%',
    note: `T ${(worstT * 100).toFixed(1)}%p, R ${(worstR * 100).toFixed(1)}%p, HPA ${worstH.toFixed(1)}°, 곡선 RMS ${(worstC * 100).toFixed(1)}%` };
  // V9: 두께 하나를 빼고 피팅 → 그 두께 예측
  let V9 = null;
  if (thick >= 2) {
    let wT = 0, wR = 0, wH = 0;
    for (const tj of new Set(samples.map((s) => s.t))) {
      const train = samples.filter((s) => s.t !== tj), test = samples.filter((s) => s.t === tj);
      const fr = fitCore(table, train, n, { g: free.g, mua: train.some((s) => s.R != null) || new Set(train.map((s) => s.t)).size >= 2 });
      for (const s of test) {
        const p = predictSample(table, fr.mat, s.t);
        if (s.T != null) wT = Math.max(wT, Math.abs(s.T - p.T));
        if (s.R != null) wR = Math.max(wR, Math.abs(s.R - p.R));
        if (hpaUsable(s)) wH = Math.max(wH, Math.abs(s.hpa - p.hpa));
      }
    }
    V9 = { id: 'V9', ok: wT <= 0.03 && wR <= 0.03 && wH <= 3, value: Math.max(wT, wR), limit: '교차두께 T·R ±3%p, HPA ±3°',
      note: `T ${(wT * 100).toFixed(1)}%p, R ${(wR * 100).toFixed(1)}%p, HPA ${wH.toFixed(1)}°` };
  }
  return { mat: r.mat, milky: milkyFromMusR(table, r.mat.musR), free, notes, predictions, V6, V9, J: r.J };
}
