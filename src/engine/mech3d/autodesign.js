// P4 자동설계 단계 실행기 — spec §1·§2. 순서 ② → ⑤ LED 높이 → ④ 케이스 면 → ① → ③(§2.3c), 체크 안 한 항목은 현재 값 고정. 계산은 io 가 맡는다(Worker / 시험 가짜).
// ① 재가중 창은 기준 ±0.25(ESS 한계, spec §2.1) — 창 밖은 이분 탐색으로 기준을 옮긴다. ② 는 Milky 상한에서 최소 개수를 구한 뒤 ① 이 낮춘다.
// io.milkyRows(d, ms, { precise }) — precise = 경계가 든 창의 재추적(광자 많이). 결과 { feasible, best(design), steps:[{stage, …}], reason, verified, current(현재안 io.verify), cancelled }
import { milkyAxis } from './reweight.js';
import { pickMilky, margin } from './milky-search.js';
import { searchLeds } from './basis.js';
import { gridCandidates } from './shape-opt.js';
import { gradeOf, heightCandidates } from './housing-led.js';

export const MILKY_STEP = 0.025, MILKY_ITERS = 8;
// 평활 길이 U — 길이 프로파일 3행 이동평균(NaN 행 제외)의 min/max. 한 칸 잡음 골짜기(min 통계 편향)에 덜 민감. profile 없으면 Ulen
export function smoothU(stats) {
  const p = stats?.profile;
  if (!p || !p.length) return stats?.Ulen ?? 0;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i])) continue;
    let s = 0, n = 0;
    for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < p.length && Number.isFinite(p[k])) { s += p[k]; n++; }
    const v = s / n; mn = Math.min(mn, v); mx = Math.max(mx, v);
  }
  return mx > 0 ? mn / mx : stats.Ulen ?? 0;
}
// 통과 판정은 margin(원래 Ulen) 그대로, 미달안 순위만 평활 길이 U
export const shapeScore = (r, obs) => (!r.ok ? -Infinity : margin(r.stats, obs) >= 0 ? 1 + r.eff : Math.min(smoothU(r.stats) / obs.targetLen, r.stats.Uwid == null ? Infinity : r.stats.Uwid / obs.targetWid));
export const SCORE_EPS = 0.01;   // 최종안이 현재안보다 이만큼은 나아야 추천
// stepVirt = LED STEP 가상 배치 여부(② 가 STEP 에서 돌면 true, current 는 현재 배치가 가상인지) — 개수가 같아도 원래 ↔ 가상은 다른 설계
// dz = LED 높이 이동(mm, 없음 = 0), finish = ④ 케이스 면 { part, kind, R } | null
const sameFinish = (f, g) => (!f && !g) || (!!f && !!g && f.part === g.part && f.kind === g.kind && (f.R ?? null) === (g.R ?? null));
export const sameDesign = (a, b) => ['count', 'pitch', 'milky'].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null)) && !!a?.stepVirt === !!b?.stepVirt && JSON.stringify(a?.shape ?? null) === JSON.stringify(b?.shape ?? null)
  && Math.abs((a?.dz ?? 0) - (b?.dz ?? 0)) < 1e-6 && sameFinish(a?.finish ?? null, b?.finish ?? null);

// 단계적 압축: schedule = [[남길 수(첫 단계는 전체), 광자 수, 후보당 시간 제한 ms?]…]. 각 단계 결과 점수로 다음 단계 후보를 줄임
export const SHAPE_SCHEDULE = [[27, 6e4, 2500], [6, 2e5, 4000], [2, 6e5, 6000]];
// 단계별 평가 후보 수 합(진행률 분모) — 실제로는 통과 후보가 적으면 더 적음
export const halvingTotal = (n, schedule = SHAPE_SCHEDULE) => schedule.reduce((s, [keep], i) => { const k = i === 0 ? n : Math.min(keep, s.last); return { sum: s.sum + k, last: k }; }, { sum: 0, last: n }).sum;
export async function halving(cands, evalFn, obs, schedule = SHAPE_SCHEDULE, cancelled = () => false) {
  let pool = cands, last = null;
  for (let s = 0; s < schedule.length; s++) {
    if (cancelled()) return null;
    const res = (await evalFn(pool, schedule[s][1], schedule[s][2])).filter((r) => r.ok).sort((a, b) => shapeScore(b, obs) - shapeScore(a, obs));
    if (!res.length) return null;
    last = res[0];
    pool = res.slice(0, schedule[s + 1]?.[0] ?? 1).map((r) => r.cand);
  }
  return last;
}

// 진행률 분모 — 선별 후보 수 + 압축 평가 수. 선별은 io.shapePlan?.({ screen, grid, total }) 로 먼저 알리고, 그 뒤 evalShapes 호출마다 후보 1개씩 센다
export const shapeTotal = (nScreen, nGrid, schedule = SHAPE_SCHEDULE) => nScreen + halvingTotal(nGrid, schedule);
// ③ 1단계 변수 선별 — 현재 형상 + 변수별 하한/상한 하나씩(R 은 h 와 묶음: h 후보는 R=mid). 이득 = max(점수(lo), 점수(hi)) − 점수(현재) ≥ eps 인 상위 keep 개
// 격자 차원 예산 budget(기본 3 → 3^3 = 27 이하): h 는 R 과 함께라 2, 나머지 1 — 이득 순으로 예산 안에 드는 것만
export async function screenShapeVars(evalFn, ranges, obs, { N = 6e4, maxMs = 2500, eps = 0.01, keep = 3, budget = 3 } = {}) {
  const rd = (v) => Math.round(v * 1e4) / 1e4, Rm = ranges.R ? rd((ranges.R[0] + ranges.R[1]) / 2) : 1, zero = { dt: 0, h: 0, R: Rm, e: 0, c: 0 };
  const names = Object.keys(ranges).filter((k) => k !== 'R'), cands = [zero], tag = [-1];
  names.forEach((v, i) => ranges[v].forEach((x) => { cands.push({ ...zero, [v]: rd(x) }); tag.push(i); }));
  const results = await evalFn(cands, N, maxMs), byCand = new Map(results.map((r) => [r.cand, r]));
  const sc = (c) => { const r = byCand.get(c); return r ? shapeScore(r, obs) : -Infinity; }, base = sc(zero), gains = {};
  names.forEach((v, i) => {
    const best = Math.max(...cands.filter((_, k) => tag[k] === i).map(sc));
    gains[v] = Number.isFinite(best) ? (Number.isFinite(base) ? best - base : eps) : 0;
  });
  const vars = [];
  let left = budget;
  for (const v of names.filter((v) => gains[v] >= eps).sort((a, b) => gains[b] - gains[a])) {
    const cost = v === 'h' && ranges.R ? 2 : 1;
    if (vars.length < keep && cost <= left) { vars.push(v); left -= cost; }
  }
  return { vars, gains, results };
}

// ④⑤ 이산 후보 선택 — 1차 전체(N1) → 2차 keep 개 정밀(N2) → 규칙대로 하나. evalFn(cands, N, maxMs) → [{ cand, ok, stats, eff }]
// lowestPassing: 2차 후보 = 1차 통과 중 등급 낮은 keep 개(통과 없으면 점수 상위), 2차 통과 중 등급 최저(같으면 점수 높은 쪽), 없으면 점수 최고. best: 점수 최고
export async function pickVariant(cands, evalFn, obs, { prefer = 'best', keep = 2, N1 = 6e4, N2 = 3e5, maxMs1 = 2500, maxMs2 = 6000, grade = () => 0, cancelled = () => false, progress } = {}) {
  const sc = (r) => shapeScore(r, obs), pass = (r) => r.ok && margin(r.stats, obs) >= 0, byScore = (a, b) => sc(b) - sc(a);
  const byGrade = (a, b) => grade(a.cand) - grade(b.cand) || sc(b) - sc(a);
  const results1 = await evalFn(cands, N1, maxMs1);
  const ok1 = results1.filter((r) => r.ok);
  if (!ok1.length || cancelled()) return { best: null, results1, results2: [] };
  const p1 = prefer === 'lowestPassing' ? ok1.filter(pass).sort(byGrade) : [];
  const pool = (p1.length ? p1 : [...ok1].sort(byScore)).slice(0, keep).map((r) => r.cand);
  progress?.(cands.length / (cands.length + pool.length), `상위 ${pool.length}개 정밀 평가`);
  const results2 = await evalFn(pool, N2, maxMs2), ok2 = results2.filter((r) => r.ok);
  if (!ok2.length) return { best: null, results1, results2 };
  const p2 = prefer === 'lowestPassing' ? ok2.filter(pass).sort(byGrade) : [];
  return { best: p2[0] ?? [...ok2].sort(byScore)[0], results1, results2 };
}

// 다음 기준점: 마지막 두 기준의 (Milky, 여유) 할선 근이 (lo, hi) 안이면 그것, 아니면 이분
export function nextBase(pts, lo, hi) {
  if (pts.length >= 2) {
    const [a, b] = pts.slice(-2);
    if (b[1] !== a[1]) { const r = b[0] - b[1] * (b[0] - a[0]) / (b[1] - a[1]); if (r > lo + 1e-9 && r < hi - 1e-9) return r; }
  }
  return (lo + hi) / 2;
}

// ① Milky: 구간 [0.25, 상한] 탐색 — 창 전체 통과면 위쪽 끝을 창 아래로, 전부 미달이면 아래쪽 끝을 창 위로, 다음 기준은 할선(밖이면 이분). 중지 = null
async function searchMilky(d, cfg, io, steps, mCap) {
  let lo = 0.25, hi = mCap, m0 = Math.min(hi, Math.max(lo, d.milky ?? hi)), found = null, nearest = null;
  const pts = [];   // 기준별 (대표 Milky, 여유)
  for (let it = 0; it < MILKY_ITERS; it++) {
    if (io.cancelled?.()) return null;
    io.progress?.('milky', it / MILKY_ITERS, `Milky 재가중 (기준 ${m0.toFixed(2)})`);
    const ms = milkyAxis(m0, MILKY_STEP, mCap);
    let rows = await io.milkyRows(d, ms), pick = pickMilky(rows, cfg.obs), precise = false;
    if (pick.feasible && pick.edge === null) {   // 창 안에 경계 — 같은 창을 광자를 늘려 다시(잡음으로 경계가 흔들리지 않게)
      if (io.cancelled?.()) return null;
      io.progress?.('milky', it / MILKY_ITERS, `Milky 경계 정밀 확인 (기준 ${m0.toFixed(2)})`);
      rows = await io.milkyRows(d, ms, { precise: true }); pick = pickMilky(rows, cfg.obs); precise = true;
    }
    steps.push({ stage: 'milky', base: m0, rows, pick, precise });
    if (pick.best) pts.push([pick.best.milky, pick.best.margin]);
    if (pick.feasible) {
      found = pick;
      if (pick.edge !== 'low' || ms[0] <= lo + 1e-9) break;   // 창 안에서 경계를 찾음 / 더 내려갈 곳 없음
      hi = ms[0];
    } else {
      if (!pick.best) break;   // 믿을 격자점 없음
      if (!nearest || pick.best.margin > nearest.best.margin) nearest = pick;
      lo = ms.at(-1);
      if (lo >= hi - 1e-9) break;   // 상한까지 미달
    }
    m0 = nextBase(pts, lo, hi);
  }
  return { found, nearest };
}

export async function runAutoDesign(cfg, io) {
  const { stages, obs } = cfg, steps = [], mCap = cfg.milkyMax ?? Math.max(cfg.current?.milky ?? 0, 5);
  let d = { ...cfg.current }, feasible = true, reason = '';
  const stop = () => io.cancelled?.();
  if (stop()) return { cancelled: true };
  io.progress?.('current', 0, '현재안 계산');   // 비교표 '현재' 열 — 최종안과 같은 추정기(io.verify). 수렴한 점진 결과가 있으면 재사용
  const currentVerified = cfg.currentVerified ?? await io.verify(d);
  if (stop()) return { cancelled: true };
  if (stages.leds) {   // ② — ① 이 켜져 있으면 Milky 상한(확산 최대)에서 최소 개수
    io.progress?.('leds', 0, 'LED 후보 위치 추적');
    if (stages.milky) d = { ...d, milky: mCap };
    const B = await io.basis(d);
    if (stop()) return { cancelled: true };
    const r = searchLeds({ G: cfg.G, obs, line: cfg.line, cand: B.cand, maps: B.maps, pitchRange: cfg.pitchRange ?? null, nMax: cfg.nMax, emitted: B.emitted });
    steps.push({ stage: 'leds', ...r });
    d = { ...d, count: r.n, pitch: r.pitch, stepVirt: !!cfg.stepMode };   // cfg.stepMode = LED STEP(② 는 가상 배치를 점수 매김)
    if (!r.feasible) { feasible = false; reason = r.reason; }
  }
  const evalV = (cands, N, ms) => io.evalVariants(d, cands, N, ms), uText = (s) => `길이 U ${s.Ulen.toFixed(2)}${s.Uwid == null ? '' : ` · 폭 U ${s.Uwid.toFixed(2)}`}`;
  if (stages.height && cfg.heightRange) {   // ⑤ LED 높이 — 후보 { dz }(0 = 현재), 점수 최고
    const cands = heightCandidates(cfg.heightRange, 7).map((dz) => ({ dz }));
    io.progress?.('height', 0, `LED 높이 후보 ${cands.length}개 평가`);
    const r = await pickVariant(cands, evalV, obs, { prefer: 'best', cancelled: stop, progress: (f, t) => io.progress?.('height', f, `LED 높이 ${t}`) });
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'height', ...r });
    if (r.best) {
      d = { ...d, dz: r.best.cand.dz };
      if (margin(r.best.stats, obs) < 0) { feasible = false; reason = `LED 높이 최적(${r.best.cand.dz >= 0 ? '+' : ''}${r.best.cand.dz} mm)에서도 목표 미달 — ${uText(r.best.stats)}`; }
    }
  }
  if (stages.housing && cfg.finishCands?.length) {   // ④ 케이스 면 — 후보 { finish }(current = 현재 면 처리), 통과 중 최저 등급
    const cands = cfg.finishCands.map(({ current, ...f }) => ({ finish: { part: cfg.housingPart ?? f.part, kind: f.kind, ...(f.R != null ? { R: f.R } : {}) }, current: !!current }));
    io.progress?.('housing', 0, `케이스 면 후보 ${cands.length}개 평가`);
    const r = await pickVariant(cands, evalV, obs, { prefer: 'lowestPassing', grade: (c) => gradeOf(c.finish), cancelled: stop, progress: (f, t) => io.progress?.('housing', f, `케이스 면 ${t}`) });
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'housing', ...r });
    if (r.best) {
      d = { ...d, finish: r.best.cand.current ? (cfg.current?.finish ?? null) : r.best.cand.finish };
      if (margin(r.best.stats, obs) < 0) { feasible = false; reason = `케이스 면 최고 등급에서도 목표 미달 — ${uText(r.best.stats)}`; }
    }
  }
  if (stages.milky) {   // ① — (②가 고른 개수에서) 목표를 만족하는 최소 Milky
    const m = await searchMilky(d, cfg, io, steps, mCap);
    if (!m) return { cancelled: true };
    if (m.found) d = { ...d, milky: m.found.milky };
    else { feasible = false; d = { ...d, milky: m.nearest?.milky ?? d.milky }; reason = `${m.nearest?.reason ?? '믿을 수 있는 격자점이 없음'} — Milky 상한(${mCap})을 올리거나 ②·③ 을 함께 쓰세요`; }
  }
  let shapeCands = cfg.shapeCands, shapeNone = false;
  if (stages.shape && cfg.shapeRanges) {   // ③ 1단계 선별 → 2단계 격자 (cfg.shapeCands 만 있으면 아래 기존 경로)
    const rg = cfg.shapeRanges, nScreen = 1 + 2 * Object.keys(rg).filter((k) => k !== 'R').length;
    io.shapePlan?.({ screen: nScreen, grid: null, total: null });
    io.progress?.('shape', 0, `형상 변수 선별 (후보 ${nScreen}개)`);
    const sc = await screenShapeVars((cands, N, ms) => io.evalShapes(d, cands, N, ms), rg, obs, cfg.screen);
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'shapeScreen', gains: sc.gains, vars: sc.vars });
    if (!sc.vars.length) { shapeNone = true; feasible = margin(currentVerified.stats, obs) >= 0; reason = '형상 변수의 효과가 잡음 수준 — 현재 형상 유지'; }
    else {
      shapeCands = gridCandidates(sc.vars.includes('h') && rg.R ? [...sc.vars, 'R'] : sc.vars, rg);
      io.shapePlan?.({ screen: nScreen, grid: shapeCands.length, total: shapeTotal(nScreen, shapeCands.length, cfg.schedule) });
    }
  }
  if (stages.shape && !shapeNone && shapeCands?.length) {   // ③
    io.progress?.('shape', 0, `형상 후보 ${shapeCands.length}개 평가`);
    const best = await halving(shapeCands, (cands, N, ms) => io.evalShapes(d, cands, N, ms), obs, cfg.schedule, stop);
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'shape', best });
    if (best) {
      const c = best.cand, zero = ['dt', 'h', 'e', 'c'].every((k) => !(c[k] ?? 0));   // 전부 0 이면 R 무관 — 빈 shapeMod 안 만듦
      d = { ...d, shape: zero ? null : { part: cfg.shapePart, ...c } };
      if (margin(best.stats, obs) < 0) { feasible = false; reason = `형상 최적안도 목표 미달 — 길이 U ${best.stats.Ulen.toFixed(2)}${best.stats.Uwid == null ? '' : ` · 폭 U ${best.stats.Uwid.toFixed(2)}`}`; }
      else { feasible = true; reason = ''; }
    } else { feasible = false; reason = '제약(살두께·간섭)을 만족하는 형상 후보가 없음 — 범위를 줄이세요'; }
  }
  if (stop()) return { cancelled: true };
  io.progress?.('verify', 0, '최종안 정밀 재계산');
  if (sameDesign(d, cfg.current)) return { feasible: feasible && margin(currentVerified.stats, obs) >= 0, best: { ...cfg.current }, steps, reason, verified: currentVerified, current: currentVerified, unchanged: true, cancelled: false };
  const verified = await io.verify(d);
  // 잡음 방어(①②③ 공통): 검증값이 현재안보다 SCORE_EPS 이상 낫지 않으면 현재안 유지. 둘 다 통과면 LED 개수 감소도 이득
  const sc = (v) => shapeScore({ ok: !v.stats.empty, stats: v.stats, eff: v.eff }, obs);
  const fewer = margin(verified.stats, obs) >= 0 && margin(currentVerified.stats, obs) >= 0 && d.count < (cfg.current.count ?? 0);
  if (!fewer && !(sc(verified) - sc(currentVerified) >= SCORE_EPS)) {
    steps.push({ stage: 'guard', tried: d, triedVerified: verified, triedReason: reason });
    return { feasible: margin(currentVerified.stats, obs) >= 0, best: { ...cfg.current }, steps, reason: `현재안보다 나은 설계를 찾지 못함 — 현재안 유지${reason ? ` (${reason})` : ''}`, verified: currentVerified, current: currentVerified, unchanged: true, cancelled: false };
  }
  // 판정·문구는 정밀 재계산 값 기준(후보 평가값은 광자가 적어 잡음이 큼)
  const vs = verified.stats, ok = margin(vs, obs) >= 0;
  if (ok) { feasible = true; reason = ''; }
  else if (reason.startsWith('형상 최적안도')) { feasible = false; reason = `형상 최적안도 목표 미달 — 길이 U ${vs.Ulen.toFixed(2)}${vs.Uwid == null ? '' : ` · 폭 U ${vs.Uwid.toFixed(2)}`}`; }
  return { feasible, best: d, steps, reason, verified, current: currentVerified, cancelled: false };
}
