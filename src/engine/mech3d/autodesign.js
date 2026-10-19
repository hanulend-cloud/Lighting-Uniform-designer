// P4 자동설계 단계 실행기 — spec §1·§2. 순서 ② → ① → ③, 체크 안 한 항목은 현재 값 고정. 계산은 io 가 맡는다(Worker / 시험 가짜).
// ① 재가중 창은 기준 ±0.25(ESS 한계, spec §2.1) — 창 밖은 이분 탐색으로 기준을 옮긴다. ② 는 Milky 상한에서 최소 개수를 구한 뒤 ① 이 낮춘다.
// io.milkyRows(d, ms, { precise }) — precise = 경계가 든 창의 재추적(광자 많이). 결과 { feasible, best(design), steps:[{stage, …}], reason, verified, current(현재안 io.verify), cancelled }
import { milkyAxis } from './reweight.js';
import { pickMilky, margin } from './milky-search.js';
import { searchLeds } from './basis.js';

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
const sameDesign = (a, b) => ['count', 'pitch', 'milky'].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null)) && JSON.stringify(a?.shape ?? null) === JSON.stringify(b?.shape ?? null);

// 단계적 압축: schedule = [[남길 수(첫 단계는 전체), 광자 수, 후보당 시간 제한 ms?]…]. 각 단계 결과 점수로 다음 단계 후보를 줄임
export async function halving(cands, evalFn, obs, schedule = [[27, 6e4, 2500], [6, 2e5, 4000], [2, 6e5, 6000]], cancelled = () => false) {
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

// ① Milky: 구간 [0.25, 상한] 이분 탐색 — 창 전체 통과면 위쪽 끝을 창 아래로, 전부 미달이면 아래쪽 끝을 창 위로. 중지 = null
async function searchMilky(d, cfg, io, steps, mCap) {
  let lo = 0.25, hi = mCap, m0 = Math.min(hi, Math.max(lo, d.milky ?? hi)), found = null, nearest = null;
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
    m0 = (lo + hi) / 2;
  }
  return { found, nearest };
}

export async function runAutoDesign(cfg, io) {
  const { stages, obs } = cfg, steps = [], mCap = cfg.milkyMax ?? Math.max(cfg.current?.milky ?? 0, 5);
  let d = { ...cfg.current }, feasible = true, reason = '';
  const stop = () => io.cancelled?.();
  if (stop()) return { cancelled: true };
  io.progress?.('current', 0, '현재안 계산');   // 비교표 '현재' 열 — 최종안과 같은 추정기(io.verify)
  const currentVerified = await io.verify(d);
  if (stop()) return { cancelled: true };
  if (stages.leds) {   // ② — ① 이 켜져 있으면 Milky 상한(확산 최대)에서 최소 개수
    io.progress?.('leds', 0, 'LED 후보 위치 추적');
    if (stages.milky) d = { ...d, milky: mCap };
    const B = await io.basis(d);
    if (stop()) return { cancelled: true };
    const r = searchLeds({ G: cfg.G, obs, line: cfg.line, cand: B.cand, maps: B.maps, pitchRange: cfg.pitchRange ?? null, nMax: cfg.nMax, emitted: B.emitted });
    steps.push({ stage: 'leds', ...r });
    d = { ...d, count: r.n, pitch: r.pitch };
    if (!r.feasible) { feasible = false; reason = r.reason; }
  }
  if (stages.milky) {   // ① — (②가 고른 개수에서) 목표를 만족하는 최소 Milky
    const m = await searchMilky(d, cfg, io, steps, mCap);
    if (!m) return { cancelled: true };
    if (m.found) d = { ...d, milky: m.found.milky };
    else { feasible = false; d = { ...d, milky: m.nearest?.milky ?? d.milky }; reason = `${m.nearest?.reason ?? '믿을 수 있는 격자점이 없음'} — Milky 상한(${mCap})을 올리거나 ②·③ 을 함께 쓰세요`; }
  }
  if (stages.shape && cfg.shapeCands?.length) {   // ③
    io.progress?.('shape', 0, `형상 후보 ${cfg.shapeCands.length}개 평가`);
    const best = await halving(cfg.shapeCands, (cands, N, ms) => io.evalShapes(d, cands, N, ms), obs, cfg.schedule, stop);
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'shape', best });
    if (best) {
      d = { ...d, shape: { part: cfg.shapePart, ...best.cand } };
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
    return { feasible: margin(currentVerified.stats, obs) >= 0, best: { ...cfg.current }, steps, reason: '현재안보다 나은 설계를 찾지 못함 — 현재안 유지', verified: currentVerified, current: currentVerified, unchanged: true, cancelled: false };
  }
  return { feasible, best: d, steps, reason, verified, current: currentVerified, cancelled: false };
}
