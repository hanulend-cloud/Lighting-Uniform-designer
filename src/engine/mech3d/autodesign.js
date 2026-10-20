// P4 자동설계 단계 실행기 — spec §1·§2. 순서 ② → ⑤ LED 높이 → ④ 케이스 면 → ① → ③(§2.3c), 체크 안 한 항목은 현재 값 고정. 계산은 io 가 맡는다(Worker / 시험 가짜).
// ① 재가중 창은 기준 ±0.25(ESS 한계, spec §2.1). U(Milky) 는 단봉형(§2.1a) — 거친 탐색으로 최고점을 지나면 멈추고, 오르는 구간에서만 할선/이분으로 최소 통과 Milky. ② 는 기준(①·④ 함께면 거친 최고점 Milky ≤ 5·케이스 최고 등급, §2.2c)에서 최소 개수를 구한 뒤 ④·① 이 고른다.
// io.milkyRows(d, ms, { precise }) — precise = 경계가 든 창의 재추적(광자 많이). 결과 { feasible, best(design), steps:[{stage, …}], reason, verified, current(현재안 io.verify), cancelled }
import { milkyAxis } from './reweight.js';
import { pickMilky, margin } from './milky-search.js';
import { searchLeds, searchLeds2 } from './basis.js';
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
// 열 배치(spec P4 §2.2b): rows 없음 = 1, 열 간격은 2열일 때만 의미 · 총 LED 수 = rows·count
const rowsOf = (x) => (x?.rows === 2 ? 2 : 1), gapOf = (x) => (rowsOf(x) === 2 ? x.rowGap ?? 0 : 0);
export const totalLeds = (x) => (x?.count ?? 0) * rowsOf(x);
const sameFinish = (f, g) => (!f && !g) || (!!f && !!g && f.part === g.part && f.kind === g.kind && (f.R ?? null) === (g.R ?? null));
export const sameDesign = (a, b) => ['count', 'pitch', 'milky'].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null)) && !!a?.stepVirt === !!b?.stepVirt && JSON.stringify(a?.shape ?? null) === JSON.stringify(b?.shape ?? null)
  && rowsOf(a) === rowsOf(b) && Math.abs(gapOf(a) - gapOf(b)) < 1e-6
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

// ① 오르는 구간 [lo, hi] 탐색(여유가 단조 증가로 봄) — 창 전체 통과면 위쪽 끝을 창 아래로, 전부 미달이면 아래쪽 끝을 창 위로, 다음 기준은 할선(밖이면 이분). 중지 = null
// pts = 이미 아는 (Milky, 여유) — 첫 기준부터 할선. f0 = 진행률 시작
async function searchMilky(d, cfg, io, steps, mCap, { lo = 0.25, hi = mCap, pts = [], f0 = 0 } = {}) {
  let m0 = nextBase(pts, lo, hi), found = null, nearest = null;
  pts = [...pts];   // 기준별 (대표 Milky, 여유)
  for (let it = 0; it < MILKY_ITERS; it++) {
    if (io.cancelled?.()) return null;
    io.progress?.('milky', f0 + (1 - f0) * it / MILKY_ITERS, `최소 Milky 탐색 (기준 ${m0.toFixed(2)})`);
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

export const COARSE_STEP = 1, EDGE_FRAC = 0.15;
const bestRow = (rows) => rows.filter((r) => r.trusted).reduce((a, b) => (!a || b.margin > a.margin ? b : a), null);
// 최고점에서 막는 쪽과 원인 — 여유가 작은 쪽(길이/폭), 최저 위치가 바깥 15 % 면 가장자리 감쇠, 아니면 LED 리플(dark 없으면 원인 생략)
export function limitText(row, obs) {
  const wid = row.Uwid != null && obs.targetWid != null && row.Uwid - obs.targetWid < row.Ulen - obs.targetLen;
  const f = row.dark?.[wid ? 'wid' : 'len'];
  const cause = f == null ? '' : f < EDGE_FRAC || f > 1 - EDGE_FRAC ? ` — ${wid ? '폭 가장자리가' : '길이 끝단이'} 가장 어두움(가장자리 감쇠)` : ' — 가운데 쪽이 가장 어두움(LED 리플)';
  return `한계: ${wid ? '폭' : '길이'} 방향${cause}`;
}
// ① 균일도 우선(spec §2.1a): 거친 탐색 0.5, 1.5, … ≤ 상한(최고점 뒤 두 번 연속 하락이면 멈춤 · 오르는 쪽에서 통과 창이 나오면 멈춤)
// → 통과 없으면 최고점 주변 정밀 창 → 거기서 통과하면 오르는 구간에서 최소 통과 Milky. 반환 { found(pick), peak(행), cap } | null(중지)
const coarseBases = (cap) => Array.from({ length: Math.max(1, Math.floor((cap - 0.5) / COARSE_STEP + 1e-9) + 1) }, (_, k) => Math.min(cap, 0.5 + k * COARSE_STEP));
// ② 기준 Milky(spec §2.2c): 거친 창 0.5, 1.5, … ≤ cap 만(정밀 없음) — 최고점 뒤 처음 내려가면 멈춤. 반환 최고 믿는 행의 Milky | null(믿을 행 없음) | undefined(중지)
async function coarsePeakMilky(d, cfg, io, steps, cap) {
  let best = null, prev = -Infinity;
  for (const m of coarseBases(cap)) {
    if (io.cancelled?.()) return undefined;
    io.progress?.('leds', 0, `② 기준 Milky 찾기 (Milky ${m.toFixed(1)})`);
    const rows = await io.milkyRows(d, milkyAxis(m, MILKY_STEP, cap)), r = bestRow(rows), g = r?.margin ?? -Infinity;
    steps.push({ stage: 'milky', phase: 'ledsRef', base: m, rows });
    if (r && (!best || r.margin > best.margin)) best = r;
    if (best && g < prev && g < best.margin) break;   // 최고점을 지나 내려감
    prev = g;
  }
  return best ? best.milky : null;
}
async function searchMilkyPeak(d, cfg, io, steps, cap) {
  const obs = cfg.obs, S = [];   // 거친 표본 { m, row(창 최고 믿는 행), ms }
  const bases = coarseBases(cap), nB = bases.length;
  let lo = 0.25;   // 지금까지 미달 창의 위 끝(오르는 구간 아래 경계)
  const rising = async (ms, pick, f0) => {   // 통과 창 → 최소 통과 Milky: 경계가 창 안이면 그대로, 창 맨 아래부터 통과면 [lo, 창 아래] 탐색
    if (pick.edge === null || ms[0] <= lo + 1e-9) return { found: pick };
    const below = S.filter((x) => x.row && x.row.milky <= lo + 1e-9).slice(-1).map((x) => [x.row.milky, x.row.margin]);
    const r = await searchMilky(d, cfg, io, steps, cap, { lo, hi: ms[0], pts: [...below, [pick.best.milky, pick.best.margin]], f0 });
    return r && { found: r.found ?? pick };
  };
  for (let k = 0; k < nB; k++) {
    if (io.cancelled?.()) return null;
    const m = bases[k], ms = milkyAxis(m, MILKY_STEP, cap);
    io.progress?.('milky', 0.6 * k / nB, `균일도 최고점 탐색 (Milky ${m.toFixed(1)})`);
    let rows = await io.milkyRows(d, ms), pick = pickMilky(rows, obs), precise = false;
    if (pick.feasible && pick.edge === null) {   // 창 안에 경계 — 같은 창을 광자를 늘려 다시
      if (io.cancelled?.()) return null;
      io.progress?.('milky', 0.6 * k / nB, `Milky 경계 정밀 확인 (기준 ${m.toFixed(2)})`);
      rows = await io.milkyRows(d, ms, { precise: true }); pick = pickMilky(rows, obs); precise = true;
    }
    steps.push({ stage: 'milky', phase: 'coarse', base: m, rows, pick, precise });
    S.push({ m, row: bestRow(rows), ms });
    if (pick.feasible) { const r = await rising(ms, pick, 0.6); return r && { ...r, cap }; }   // 아직 하락 전(오르는 쪽) 통과 창
    lo = Math.max(lo, ms.at(-1));
    const g = S.map((x) => x.row?.margin ?? -Infinity), n = g.length, ib = g.indexOf(Math.max(...g));
    if (n - 1 - ib >= 2 && g[n - 1] < g[n - 2] && g[n - 2] < g[n - 3]) break;   // 최고점 뒤 두 번 연속 하락
  }
  const ok = S.filter((x) => x.row);
  if (!ok.length) return { found: null, peak: null, cap };
  // 정밀 최고점 — 최고 거친 기준 + 더 나은 이웃 쪽 중간(마지막 기준이고 상한까지 여지가 있으면 상한 쪽)
  const ib = S.indexOf(ok.reduce((a, b) => (b.row.margin > a.row.margin ? b : a))), b = S[ib].m;
  const up = S[ib + 1] ?? (ib === S.length - 1 && cap - b > 0.25 ? { m: b + COARSE_STEP, row: { margin: Infinity } } : null);
  const nbr = [S[ib - 1], up].filter((x) => x?.row).reduce((a, x) => (!a || x.row.margin > a.row.margin ? x : a), null);
  const centres = [b, ...(nbr ? [Math.min(cap, (b + nbr.m) / 2)] : [])].sort((x, y) => x - y), peakRows = [];
  lo = S.filter((x) => x.m < centres[0] && x.row).reduce((a, x) => Math.max(a, x.ms.at(-1)), 0.25);
  for (const c of centres) {
    if (io.cancelled?.()) return null;
    const ms = milkyAxis(c, MILKY_STEP, cap);
    io.progress?.('milky', 0.65, `균일도 최고점 정밀 (Milky ${c.toFixed(2)})`);
    const rows = await io.milkyRows(d, ms, { precise: true }), pick = pickMilky(rows, obs);
    steps.push({ stage: 'milky', phase: 'peak', base: c, rows, pick, precise: true });
    if (pick.feasible) { const r = await rising(ms, pick, 0.7); return r && { ...r, cap }; }   // 최고점 여유 ≥ 0
    lo = Math.max(lo, ms.at(-1)); peakRows.push(...rows);
  }
  return { found: null, peak: bestRow(peakRows) ?? S[ib].row, cap };
}

// ② 대안(검증 실패 시): 고른 안을 뺀 tried — 같은 총수(기저 여유 순) → 다음 총수(총수 오름 → 여유 순). 1열 searchLeds 는 total = n
function ledAlternatives(r, two) {
  const tot = (e) => (two ? e.total : e.n), T0 = tot(r), mg = (e) => (Number.isFinite(e.margin) ? e.margin : -Infinity);
  const same = (e) => e.n === r.n && e.pitch === r.pitch && (!two || (e.rows === r.rows && e.rowGap === r.rowGap));
  const seen = new Set(), key = (e) => `${e.n}|${e.pitch}|${two ? `${e.rows}|${e.rowGap}` : ''}`;
  return (r.tried ?? []).filter((e) => !same(e) && tot(e) >= T0 && !seen.has(key(e)) && seen.add(key(e)))
    .sort((a, b) => tot(a) - tot(b) || mg(b) - mg(a));   // tot ≥ T0 이므로 총수 오름 = 같은 총수 먼저
}
// 상한: ① 탐색 = cfg.milkyMax ?? 9.9 · ② 기준 Milky = cfg.milkyMax ?? max(현재, 5)(계산 시간) — spec §2.1a
export const MILKY_SEARCH_MAX = 9.9;
export async function runAutoDesign(cfg, io) {
  const { stages, obs } = cfg, steps = [], mCap = cfg.milkyMax ?? Math.max(cfg.current?.milky ?? 0, 5), sCap = cfg.milkyMax ?? MILKY_SEARCH_MAX;
  let d = { ...cfg.current }, feasible = true, reason = '', hint = null, ledAlts = null;
  const stop = () => io.cancelled?.();
  if (stop()) return { cancelled: true };
  io.progress?.('current', 0, '현재안 계산');   // 비교표 '현재' 열 — 최종안과 같은 추정기(io.verify). 수렴한 점진 결과가 있으면 재사용
  const currentVerified = cfg.currentVerified ?? await io.verify(d);
  if (stop()) return { cancelled: true };
  const hasFin = 'finish' in d, fin0 = d.finish;   // ④ 전에 되돌릴 현재 케이스 면
  if (stages.leds) {   // ② — 함께 켠 ①·④ 는 유리한 쪽에서 개수를 정함(spec §2.2c): ① → 거친 최고점 Milky(≤ 상한), ④ → 케이스 최고 등급
    const ref = stages.milky || (stages.housing && cfg.finishCands?.length);
    if (stages.housing && cfg.finishCands?.length) {
      const top = cfg.finishCands.reduce((a, f) => (gradeOf(f) > gradeOf(a) ? f : a));
      d = { ...d, finish: top.current ? (cfg.current?.finish ?? null) : { part: cfg.housingPart ?? top.part, kind: top.kind, ...(top.R != null ? { R: top.R } : {}) } };
    }
    let mRef = null;
    if (stages.milky) {
      mRef = await coarsePeakMilky(d, cfg, io, steps, mCap);
      if (mRef === undefined) return { cancelled: true };
      d = { ...d, milky: Math.min(mCap, mRef ?? mCap) };
    }
    if (ref) steps.push({ stage: 'ledsRef', milky: mRef, finish: d.finish ?? null });
    io.progress?.('leds', 0, 'LED 후보 위치 추적');
    const B = await io.basis(d);
    if (stop()) return { cancelled: true };
    // 후보가 {s, w} 면 (s, w) 격자 — 열 수·열 간격까지(searchLeds2, nMax = 총수 상한), 숫자면 1열(기존)
    const two = typeof B.cand[0] === 'object', a = { G: cfg.G, obs, line: cfg.line, cand: B.cand, maps: B.maps, pitchRange: cfg.pitchRange ?? null, nMax: cfg.nMax, emitted: B.emitted };
    const r = two ? searchLeds2({ ...a, gaps: B.gaps ?? [], spare: 1 }) : searchLeds({ ...a, spare: 1 });   // spare: 다음 총수까지 tried 에(검증 실패 시 대안)
    steps.push({ stage: 'leds', ...r });
    const lay = (e) => ({ count: e.n, pitch: e.pitch, rows: two ? e.rows : 1, rowGap: two ? e.rowGap : 0 });
    d = { ...d, ...lay(r), stepVirt: !!cfg.stepMode };
    ledAlts = ledAlternatives(r, two).map(lay);   // cfg.stepMode = LED STEP(② 는 가상 배치를 점수 매김)
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
    if (hasFin) d = { ...d, finish: fin0 }; else delete (d = { ...d }).finish;   // ② 기준용 최고 등급 → 현재 면으로 되돌린 뒤 평가
    const r = await pickVariant(cands, evalV, obs, { prefer: 'lowestPassing', grade: (c) => gradeOf(c.finish), cancelled: stop, progress: (f, t) => io.progress?.('housing', f, `케이스 면 ${t}`) });
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'housing', ...r });
    if (r.best) {
      d = { ...d, finish: r.best.cand.current ? (cfg.current?.finish ?? null) : r.best.cand.finish };
      if (margin(r.best.stats, obs) < 0) { feasible = false; reason = `케이스 면 최고 등급에서도 목표 미달 — ${uText(r.best.stats)}`; }
    }
  }
  if (stages.milky) {   // ① 균일도 우선 — 목표 도달이면 최소 Milky, 아니면 균일도 최고 Milky + 한계·보완(④ 한 단계 위, spec §2.1a)
    const m = await searchMilkyPeak(d, cfg, io, steps, sCap);
    if (!m) return { cancelled: true };
    if (m.found) d = { ...d, milky: m.found.milky };
    else if (!m.peak) { feasible = false; reason = '믿을 수 있는 격자점이 없음 — 광자를 늘리세요'; }
    else {
      const p = m.peak, atCap = p.milky >= sCap - 0.3;
      feasible = false; d = { ...d, milky: p.milky };
      reason = `균일도 최고 Milky ${p.milky}에서도 ${uText(p)} — 목표 ${obs.targetLen.toFixed(2)}${p.Uwid == null ? '' : ` / ${obs.targetWid.toFixed(2)}`} 미달 · ${limitText(p, obs)}${atCap ? ` · Milky 상한(${sCap})을 올리거나 ②~⑤ 를 함께 쓰세요` : ''}`;
      if (cfg.housingProbe && io.evalVariants && !stop()) {   // 보완 계산: 최고점 Milky 에서 케이스 면 한 단계 위 한 번
        io.progress?.('milky', 0.95, '보완 계산 (④ 케이스 면 한 단계 위)');
        const [h] = await io.evalVariants(d, [{ finish: cfg.housingProbe }], 3e5, 6000);
        if (stop()) return { cancelled: true };
        if (h?.ok) {
          hint = { finish: cfg.housingProbe, Ulen: h.stats.Ulen, Uwid: h.stats.Uwid };
          const ft = cfg.finishText ?? ((f) => `${f.kind}${f.R != null ? ` ${Math.round(f.R * 100)}%` : ''}`);
          reason += ` · ④ 케이스 ${ft(cfg.housingProbe)} 와 함께 쓰면 ${uText(hint)}`;
        }
      }
    }
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
  if (sameDesign(d, cfg.current)) {   // 현재안이 최선 — 현재안이 목표 미달이면 이유를 비워 두지 않음
    const okCur = margin(currentVerified.stats, obs) >= 0, cs = currentVerified.stats;
    const why = reason || (okCur ? '' : `현재 설계가 최선 — 목표 미달(길이 U ${cs.Ulen.toFixed(2)}${cs.Uwid == null ? '' : ` · 폭 U ${cs.Uwid.toFixed(2)}`})`);
    return { feasible: feasible && okCur, best: { ...cfg.current }, steps, reason: why, verified: currentVerified, current: currentVerified, unchanged: true, cancelled: false, hint };
  }
  let verified = await io.verify(d);
  if (ledAlts?.length && margin(verified.stats, obs) < 0) {   // ② 재확인: 정밀 검증 미달이면 기저 순위의 다음 후보(같은 총수 → 다음 총수) 최대 2개 — 다른 필드(①③⑤④ 결과)는 그대로
    const tried = [{ design: d, verified }], scV = (v) => shapeScore({ ok: !v.stats.empty, stats: v.stats, eff: v.eff }, obs);
    for (const [i, L] of ledAlts.slice(0, 2).entries()) {
      if (stop()) return { cancelled: true };
      io.progress?.('verify', (i + 1) / 3, `② 후보 재확인 (${i + 2}/3)`);
      const e = { ...d, ...L }, v = await io.verify(e);
      tried.push({ design: e, verified: v });
      if (margin(v.stats, obs) >= 0) break;
    }
    steps.push({ stage: 'ledsVerify', tried });
    const pick = tried.find((t) => margin(t.verified.stats, obs) >= 0) ?? tried.reduce((a, b) => (scV(b.verified) > scV(a.verified) ? b : a));
    d = pick.design; verified = pick.verified;
  }
  // 잡음 방어(①②③ 공통): 검증값이 현재안보다 SCORE_EPS 이상 낫지 않으면 현재안 유지. 둘 다 통과면 총 LED 수(rows·count) 감소도 이득
  const sc = (v) => shapeScore({ ok: !v.stats.empty, stats: v.stats, eff: v.eff }, obs);
  const fewer = margin(verified.stats, obs) >= 0 && margin(currentVerified.stats, obs) >= 0 && totalLeds(d) < totalLeds(cfg.current);
  if (!fewer && !(sc(verified) - sc(currentVerified) >= SCORE_EPS)) {
    steps.push({ stage: 'guard', tried: d, triedVerified: verified, triedReason: reason });
    return { feasible: margin(currentVerified.stats, obs) >= 0, best: { ...cfg.current }, steps, reason: `현재안보다 나은 설계를 찾지 못함 — 현재안 유지${reason ? ` (${reason})` : ''}`, verified: currentVerified, current: currentVerified, unchanged: true, cancelled: false, hint };
  }
  // 판정·문구는 정밀 재계산 값 기준(후보 평가값은 광자가 적어 잡음이 큼)
  const vs = verified.stats, ok = margin(vs, obs) >= 0;
  if (ok) { feasible = true; reason = ''; }
  else {   // 단계가 통과로 끝났어도 정밀 재계산 미달이면 불가
    feasible = false;
    const vt = uText(vs);
    if (reason.startsWith('형상 최적안도')) reason = `형상 최적안도 목표 미달 — ${vt}`;
    else if (!reason) reason = `최종 정밀 재계산에서 목표 미달 — ${vt} (후보 평가와 차이: 잡음·LED 몸체 영향)`;
    else if (!reason.includes(vt)) reason += ` (최종 정밀 재계산: ${vt})`;
  }
  return { feasible, best: d, steps, reason, verified, current: currentVerified, cancelled: false, hint };
}
