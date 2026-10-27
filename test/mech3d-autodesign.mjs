// P4 단계 실행기(가짜 io): node test/mech3d-autodesign.mjs
import { runAutoDesign, shapeScore, halving, smoothU, halvingTotal, sameDesign, screenShapeVars, shapeTotal, pickVariant } from '../src/engine/mech3d/autodesign.js';
import { shapeVarRanges, gridCandidates } from '../src/engine/mech3d/shape-opt.js';
import { milkyRows } from '../src/engine/mech3d/milky-search.js';
import { ok, done } from './mech3d-util.mjs';

const obs = { targetLen: 0.8, targetWid: 0.6 };
const st = (Ulen, Uwid) => ({ Ulen, Uwid, empty: false });
// 가짜 재가중 행: U(m) = 0.5 + 0.12·m → 목표 0.8 경계 = Milky 2.5 (창 = 기준 ±0.25)
const rowsOf = (ms, U = (m) => 0.5 + 0.12 * m) => ms.map((m) => ({ milky: m, Ulen: U(m), Uwid: 0.9, eff: 1 - m / 20, ess: 1, trusted: true, margin: Math.min(U(m) - 0.8, 0.3) }));
{ // ① 만: 거친 탐색 0.5 → 1.5 → 2.5(창 안에 경계 2.5) → 그 창만 정밀 확인 → 최종 검증
  const bases = [], precise = [], calls = [];
  const io = { milkyRows: async (d, ms, o) => { (o?.precise ? precise : bases).push(ms[10]); return rowsOf(ms); }, verify: async (d) => { calls.push(d.milky); return { stats: st(0.81, 0.9), eff: 1 - d.milky / 20 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5 }, io);
  ok(r.feasible && Math.abs(r.best.milky - 2.5) < 0.03 && calls.at(-1) === r.best.milky && bases.join() === '0.5,1.5,2.5', `① 거친 탐색: 기준 ${bases.map((b) => b.toFixed(2)).join(' → ')} → 최소 Milky ${r.best.milky}`);
  ok(precise.length === 1 && precise[0] === bases.at(-1) && r.steps.at(-1).precise, `경계가 든 창(기준 ${precise[0]?.toFixed(2)})만 정밀 재추적`);
  ok(calls.length === 2 && calls[0] === 3 && r.current.stats.Ulen === 0.81, '현재안을 먼저 같은 추정기(verify)로 계산 → r.current'); }
{ // cfg.currentVerified(수렴한 점진 결과) → 현재안 verify 생략
  const calls = [], cv = { stats: st(0.81, 0.9), eff: 0.95 };
  const io = { milkyRows: async (d, ms) => rowsOf(ms), verify: async (d) => { calls.push(d.milky); return { stats: st(0.81, 0.9), eff: 1 - d.milky / 20 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5, currentVerified: cv }, io);
  ok(calls.length === 1 && calls[0] !== 3 && r.current === cv, `현재안 재사용 → verify 는 최종안만 (${calls})`); }
{ // 오르는 구간 할선: 경계 3.0 — 거친 2.5 미달 · 3.5 창 전체 통과 → [2.75, 3.25] 할선 근 3.0 → 창 하나로 끝
  const bases = [], U = (m) => 0.8 + 0.1 * (m - 3.0);
  const io = { milkyRows: async (d, ms, o) => { if (!o?.precise) bases.push(ms[10]); return rowsOf(ms, U); }, verify: async (d) => ({ stats: st(U(d.milky), 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 4.9 }, milkyMax: 5 }, io);
  const m = r.steps.filter((x) => x.stage === 'milky').at(-1).pick.milky;
  ok(bases.length === 5 && Math.abs(bases.at(-1) - 3) < 1e-6 && Math.abs(m - 3) < 0.03, `할선 재기준: ${bases.map((b) => b.toFixed(2)).join(' → ')} (경계 ${m})`); }
{ // 상한까지 미달(U 가 천천히 오름) → 가장 가까운 안 = 상한 근처 + 상한 안내
  const io = { milkyRows: async (d, ms) => rowsOf(ms, (m) => 0.6 + 0.01 * m), verify: async (d) => ({ stats: st(0.6 + 0.01 * d.milky, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3 }, milkyMax: 5 }, io);
  ok(!r.feasible && /상한\(5\)/.test(r.reason) && r.best.milky >= 4.9, `불가: ${r.reason}`); }
{ // 여유가 Milky 와 함께 오르지만 상한까지 미달 → 가장 가까운 안 = 모든 기준 중 여유 최대 행(상한 근처), 사유도 그 Milky
  const io = { milkyRows: async (d, ms) => ms.map((m) => ({ milky: m, Ulen: 0.5 + 0.05 * m, Uwid: 0.9, eff: 1, ess: 1, trusted: true, margin: 0.05 * m - 0.3 })), verify: async (d) => ({ stats: st(0.5 + 0.05 * d.milky, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 2 }, milkyMax: 5 }, io);
  const top = Math.max(...r.steps.flatMap((x) => x.rows.map((w) => w.milky)));
  ok(!r.feasible && r.best.milky === top && top >= 4.9 && new RegExp(`Milky ${top}에서도`).test(r.reason), `가장 가까운 안 = 상한 근처 Milky ${r.best.milky}: ${r.reason}`); }
{ // milkyRows 최저 위치(dark): 길이 = 프로파일 최저 칸, 폭 = 최악 창의 폭 프로파일 최저 칸 — 유효 범위 안 0~1
  const ns = 10, nw = 5, G = { ns, nw, ds: 1, cell: 1, closed: false, winS: 5, area: new Float64Array(ns * nw).fill(1), valid: new Uint8Array(ns * nw).fill(1) };
  const v = (i, j) => (i === 9 ? 0.5 : 1) * (j === 2 ? 0.7 : 1), a = Float64Array.from({ length: ns * nw }, (_, k) => v(Math.floor(k / nw), k % nw));
  const [r] = milkyRows(G, { targetLen: 0.8, targetWid: 0.6 }, { milkies: [3], batches: [a, a, a], ess: [1], emitted: 1 });
  ok(Math.abs(r.dark.len - 1) < 1e-9 && Math.abs(r.dark.wid - 0.5) < 1e-9, `dark: 길이 ${r.dark.len} · 폭 ${r.dark.wid}`); }
// 단봉형 U(Milky) — 최고점 4 · 행에 최저 위치(dark: 길이·폭 0~1) 를 실음
const peakRows = (ms, top, { len = 0.5, wid = 0.5, Uw = () => 0.9 } = {}) => ms.map((m) => { const Ulen = top - 0.05 * (m - 4) ** 2, Uwid = Uw(m);
  return { milky: m, Ulen, Uwid, eff: 1 - m / 12, ess: 1, trusted: true, margin: Math.min(Ulen - 0.8, Uwid - 0.6), dark: { len, wid } }; });
{ // 단봉형·통과: 최소 통과 Milky 는 오르는 쪽(3.0) — 최고점(4) 너머(5.0) 가 아님
  const bases = [], U = (m) => 0.85 - 0.05 * (m - 4) ** 2;   // verify +0.001: 경계 3.0 의 부동소수 0.7999… 가 정밀 판정에서 미달로 잡히지 않게
  const io = { milkyRows: async (d, ms, o) => { if (!o?.precise) bases.push(ms[10]); return peakRows(ms, 0.85); }, verify: async (d) => ({ stats: st(U(d.milky ?? 1) + 0.001, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 1 } }, io);
  ok(r.feasible && Math.abs(r.best.milky - 3) < 0.03 && Math.max(...bases) <= 3.5 + 1e-9, `단봉형 통과 → 최소 Milky ${r.best.milky} (기준 ${bases.map((b) => b.toFixed(2)).join(' → ')})`); }
{ // 단봉형·미달(길이 끝단이 가장 어두움) → 최고점 Milky ≈ 4 · '가장자리 감쇠' · 거친 탐색은 최고점 뒤 두 번 내려가면 멈춤
  const bases = [], precise = [], U = (m) => 0.75 - 0.05 * (m - 4) ** 2;
  const io = { milkyRows: async (d, ms, o) => { (o?.precise ? precise : bases).push(ms[10]); return peakRows(ms, 0.75, { len: 0.03 }); }, verify: async (d) => ({ stats: st(U(d.milky ?? 1), 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 1 } }, io);
  ok(!r.feasible && Math.abs(r.best.milky - 4) < 0.1 && /가장자리 감쇠/.test(r.reason) && /길이/.test(r.reason) && /Milky 4에서도/.test(r.reason), `미달 → 최고점 Milky ${r.best.milky}: ${r.reason}`);
  ok(bases.length <= 8 && Math.max(...bases) < 9 && precise.length <= 2, `최고점 뒤 조기 중단: 거친 ${bases.length}개(${bases.join(' ')}) · 정밀 ${precise.length}개`); }
{ // 단봉형·미달(폭이 막고 최저 위치가 가운데) → 'LED 리플' · ④ 보완 계산(housingProbe) 결과를 사유·hint 에
  const probe = { part: 1, kind: 'whiteDiffuse', R: 0.9 }, calls = [];
  const io = { milkyRows: async (d, ms) => peakRows(ms, 0.9, { wid: 0.5, len: 0.02, Uw: (m) => 0.55 - 0.01 * (m - 4) ** 2 }),
    evalVariants: async (d, cs, N) => { calls.push({ milky: d.milky, cs, N }); return cs.map((c) => ({ cand: c, ok: true, stats: st(0.93, 0.62), eff: 0.4 })); },
    verify: async (d) => ({ stats: st(0.9, 0.55 - 0.01 * ((d.milky ?? 1) - 4) ** 2), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 1 }, housingProbe: probe, finishText: (f) => `백색 ${Math.round(f.R * 100)}%` }, io);
  ok(!r.feasible && /LED 리플/.test(r.reason) && /폭/.test(r.reason) && !/가장자리 감쇠/.test(r.reason), `폭 한계 · 리플: ${r.reason}`);
  ok(calls.length === 1 && calls[0].cs[0].finish === probe && calls[0].N === 3e5 && Math.abs(calls[0].milky - r.best.milky) < 1e-9 && r.hint?.Ulen === 0.93 && r.hint?.Uwid === 0.62 && r.hint.finish === probe
    && /④ 케이스 백색 90% 를 함께 쓰면 나아짐/.test(r.reason) && !/와 함께 쓰면 길이 U/.test(r.reason), `보완 계산 1회 → ${r.reason}`); }
{ // ① 만 · 상한 입력 없음 → 9.9 까지(U 가 계속 오름) · ②+① 이면 ② 기준은 5, ① 은 그대로 9.9 까지
  const seen = [], U = (m) => 0.5 + 0.02 * m;
  const io = { milkyRows: async (d, ms) => { seen.push(...ms); return rowsOf(ms, U); }, verify: async (d) => ({ stats: st(U(d.milky ?? 1), 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 1 } }, io);
  ok(!r.feasible && Math.max(...seen) === 9.9 && r.best.milky === 9.9 && /상한\(9\.9\)/.test(r.reason), `① 만 상한 9.9: Milky ${r.best.milky} · ${r.reason}`);
  let basisMilky = null; seen.length = 0;
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const io2 = { ...io, basis: async (d) => { basisMilky = d.milky; return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; } };
  await runAutoDesign({ stages: { milky: true, leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 5, pitch: 0 }, G, line: { length: 2, closed: false }, nMax: 4 }, io2);
  ok(basisMilky >= 4.7 && basisMilky <= 5 && Math.max(...seen) === 9.9, `②+①: ② 기준 Milky ${basisMilky}(거친 최고점 ≤ 5) · ① 탐색 ${Math.max(...seen)} 까지`); }
{ // ②+①: 후보 지도는 Milky 상한(5)에서 추적, 최소 개수 뒤 ① 이 Milky 를 낮춤
  let basisMilky = null;
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const io = { basis: async (d) => { basisMilky = d.milky; return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; }, milkyRows: async (d, ms) => rowsOf(ms), verify: async () => ({ stats: st(0.9, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true, leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 5, pitch: 0 }, milkyMax: 5, G, line: { length: 2, closed: false }, nMax: 4 }, io);
  ok(basisMilky >= 4.7 && basisMilky <= 5 && r.best.count === 1 && Math.abs(r.best.milky - 2.5) < 0.03, `②: 기준 ${basisMilky}(U 단조 → 상한 근처) 에서 최소 ${r.best.count}개 → ① Milky ${r.best.milky}`); }
{ // 단계적 압축: 27 → 6 → 2 → 1, 각 단계 광자 수 증가
  const seen = [];
  const evalFn = async (cands) => { return cands.map((c) => ({ cand: c, stats: st(0.7 + c.k / 100, 0.9), eff: 0.5 + c.k / 1000, ok: c.k !== 26 })); };
  const evalFn2 = async (cands, N, ms) => { seen.push([cands.length, N, ms]); return evalFn(cands, N); };
  const best = await halving(Array.from({ length: 27 }, (_, k) => ({ k })), evalFn2, obs, [[27, 6e4, 2500], [6, 2e5, 4000], [2, 6e5, 6000]]);
  ok(seen.map((x) => x.join(':')).join(',') === '27:60000:2500,6:200000:4000,2:600000:6000' && best.cand.k === 25, `압축 27→6→2(광자·시간 제한 단계별): 최고 k=${best.cand.k}(제약 위반 26 제외)`);
  ok(shapeScore({ stats: st(0.85, 0.7), eff: 0.4, ok: true }, obs) > shapeScore({ stats: st(0.79, 0.9), eff: 0.9, ok: true }, obs), '점수: 목표 만족이 우선, 그다음 효율'); }
{ // 평활 길이 U: 3행 이동평균 — 한 칸 잡음 골짜기에 덜 민감, profile 없으면 Ulen
  const prof = Float64Array.from([1, 1, 1, 0.4, 1, 1, NaN, 1]);
  const u = smoothU({ profile: prof, Ulen: 0.4 });
  ok(Math.abs(u - 0.8) < 1e-9, `smoothU: 골짜기 0.4 → 이동평균 ${u.toFixed(3)} (= 0.8)`);
  ok(smoothU({ Ulen: 0.55 }) === 0.55, 'profile 없음 → Ulen');
  const noisy = { stats: { Ulen: 0.4, Uwid: 0.9, profile: prof }, eff: 0.5, ok: true };
  ok(Math.abs(shapeScore(noisy, obs) - 0.8 / 0.8) < 1e-9, '미달안 점수 = 평활 길이 U / 목표'); }
{ // ③ 최적 후보가 전부 0(R 무관) → shape = null(빈 shapeMod 없음) → 현재안 그대로
  const cur = { milky: 3, count: 5, pitch: 0, shape: null }, calls = [];
  const cands = [{ dt: 0, h: 0, R: 2.75, e: 0, c: 0 }, { dt: 0.2, h: 0, R: 2.75, e: 0, c: 0 }];
  const io = { evalShapes: async (d, cs) => cs.map((c) => ({ cand: c, stats: st(c.dt ? 0.7 : 0.9, 0.9), eff: 0.6, ok: true })),
    verify: async (d) => { calls.push(d.shape); return { stats: st(0.9, 0.9), eff: 0.6 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { shape: true }, obs, current: cur, shapePart: 0, shapeCands: cands }, io);
  ok(r.best.shape === null && r.unchanged && calls.length === 1, `영 형상 후보 → shape null, 현재안 유지 (verify ${calls.length}회)`); }
{ // ③ 최적안이 검증에서 현재안보다 나쁨 → 현재안 유지 + 사유, 시도안은 steps 에
  const cur = { milky: 3, count: 5, pitch: 0, shape: null };
  const io = { evalShapes: async (d, cands) => cands.map((c) => ({ cand: c, stats: st(0.9, 0.9), eff: 0.6, ok: true })),
    verify: async (d) => (d.shape ? { stats: st(0.69, 0.9), eff: 0.6 } : { stats: st(0.75, 0.9), eff: 0.6 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { shape: true }, obs, current: cur, shapePart: 0, shapeCands: [{ dt: -1, h: -1, R: 9 }] }, io);
  const g = r.steps.find((x) => x.stage === 'guard');
  ok(r.best.shape === null && r.unchanged && r.reason === '현재안보다 나은 설계를 찾지 못함 — 현재안 유지' && !r.feasible && r.verified.stats.Ulen === 0.75, `현재안 유지: ${r.reason}`);
  ok(g && g.tried.shape.dt === -1 && g.triedVerified.stats.Ulen === 0.69, '시도한 최적안·검증값은 steps(guard)에'); }
{ // ① 도 같음: 잡음으로 고른 Milky 가 현재안과 같은 수준(차 < 0.01) → 현재안 유지(현재 통과면 feasible)
  const io = { milkyRows: async (d, ms) => rowsOf(ms), verify: async () => ({ stats: st(0.85, 0.9), eff: 0.8 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5 }, io);
  ok(r.best.milky === 3 && r.unchanged && r.feasible && /현재안 유지/.test(r.reason), `① 이득 없음 → 현재 Milky ${r.best.milky} 유지`); }
{ // 중지
  const io = { milkyRows: async () => { throw new Error('불리면 안 됨'); }, progress() {}, cancelled: () => true };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3 } }, io);
  ok(r.cancelled === true, '중지 → cancelled'); }
{ // 현재안 유지 문구에 단계 이유를 남김 · 최종 문구는 정밀 재계산 값
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const io = { basis: async () => ({ cand: [0, 1, 2], maps: [Float32Array.from([1, 0.1]), Float32Array.from([1, 0.1]), Float32Array.from([1, 0.1])], emitted: 1 }), verify: async () => ({ stats: { Ulen: 0.5, Uwid: null, empty: false }, eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { leds: true }, obs: { targetLen: 0.9, targetWid: 0 }, current: { milky: 3, count: 1, pitch: 0 }, G, line: { length: 2, closed: false }, nMax: 2 }, io);
  ok(r.unchanged && /LED 2개까지 늘려도 목표 미달/.test(r.reason), `현재안 유지 + 단계 이유: ${r.reason}`); }
{ // LED STEP ②: 원래 STEP 과 개수가 같아도(1개·균등) ② 는 가상 배치를 점수 매김 → 현재안과 다른 설계(stepVirt)
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) }, seen = [];
  const io = { basis: async () => ({ cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }), verify: async (d) => { seen.push(!!d.stepVirt); return { stats: st(d.stepVirt ? 0.95 : 0.7, 0.9), eff: 1 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { leds: true }, stepMode: true, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 1, pitch: 0, stepVirt: false }, G, line: { length: 2, closed: false }, nMax: 3 }, io);
  ok(!r.unchanged && r.best.count === 1 && r.best.stepVirt === true && seen.join() === 'false,true', `STEP ② 같은 개수 → 가상안 검증·추천 (${seen})`);
  ok(!sameDesign({ count: 1, pitch: 0, stepVirt: true }, { count: 1, pitch: 0 }) && sameDesign({ count: 1, pitch: 0, stepVirt: false }, { count: 1, pitch: 0 }), 'sameDesign: stepVirt 비교(없음 = false)'); }
{ // ③ 2단계: 선별(변수별 lo/hi) → 선택 변수 격자 halving
  const rg = shapeVarRanges({ t0: 2, pitch: 5, hasCenters: false }), cur = { milky: 3, count: 5, pitch: 0, shape: null };
  const mk = (gain, seen = []) => async (d, cands) => { seen.push(cands.map((c) => ({ ...c }))); return cands.map((c) => ({ cand: c, stats: st(0.6 + gain(c), 0.9), eff: 0.5, ok: true })); };
  const seen = [], plans = [];
  const io = { evalShapes: mk((c) => (c.c > 0 ? 0.3 : 0), seen), verify: async (d) => ({ stats: st(d.shape?.c > 0 ? 0.9 : 0.6, 0.9), eff: 0.5 }), progress() {}, shapePlan: (p) => plans.push(p), cancelled: () => false };
  const r = await runAutoDesign({ stages: { shape: true }, obs, current: cur, shapePart: 0, shapeRanges: rg }, io);
  const sc = r.steps.find((x) => x.stage === 'shapeScreen');
  ok(sc.vars.join() === 'c' && seen[0].length === 13 && seen[1].length === 5 && seen[1].some((c) => c.c === 0 && c.dt === 0), `선별 → ['c'], 선별 13개(끝값+½) · 격자 5개(변수 1개 = 5단계, 현재 포함): ${sc.vars}`);
  ok(r.best.shape.c > 0 && !r.unchanged && plans.at(-1).total === shapeTotal(13, 5), `최종 형상 c=${r.best.shape?.c}, 분모 ${plans.at(-1)?.total}`);
  const io2 = { ...io, evalShapes: mk(() => 0), verify: async () => ({ stats: st(0.75, 0.9), eff: 0.5 }) };
  const r2 = await runAutoDesign({ stages: { shape: true }, obs, current: cur, shapePart: 0, shapeRanges: rg }, io2);
  ok(r2.unchanged && r2.best.shape === null && r2.reason === '형상 변수의 효과가 잡음 수준 — 현재 형상 유지', `효과 없음 → 현재안 유지: ${r2.reason}`); }
{ // h 선별 → R 도 격자에 포함 (R 은 선별 후보에 안 나옴)
  const rg = shapeVarRanges({ t0: 2, pitch: 5, hasCenters: true }), seen = [];
  const evalFn = async (cands) => { seen.push(cands); return cands.map((c) => ({ cand: c, stats: st(0.6 + (c.h > 0 ? 0.3 : 0), 0.9), eff: 0.5, ok: true })); };
  const sc = await screenShapeVars(evalFn, rg, obs);
  ok(sc.vars.join() === 'h' && seen[0].length === 17 && seen[0].every((c) => c.R === 2.75), `h 선별(선별 17개(R 은 h 와 묶음), R=mid): ${sc.vars}`);
  const io = { evalShapes: (d, c, N) => evalFn(c), verify: async (d) => ({ stats: st(d.shape?.h > 0 ? 0.9 : 0.6, 0.9), eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { shape: true }, obs, current: { milky: 3, shape: null }, shapePart: 0, shapeRanges: rg }, io);
  const grid = seen[2], Rs = new Set(grid.map((c) => c.R));
  ok(grid.length === 15 && Rs.size === 3 && r.best.shape.h > 0, `격자 ${grid.length}개(h 5단계 × R 3), R ${[...Rs]}`); }
{ // 격자 차원 예산 3: h(+R) = 2 → 다른 변수 하나만 / h 가 예산을 넘으면 건너뜀
  const rg = shapeVarRanges({ t0: 2, pitch: 5, hasCenters: true });
  const fake = (g) => async (cands) => cands.map((c) => ({ cand: c, stats: st(0.5 + g(c), 0.9), eff: 0.5, ok: true }));
  const g1 = (c) => (c.h > 0 ? 0.3 : 0) + (c.c > 0 ? 0.2 : 0) + (c.e > 0 ? 0.1 : 0) + (c.dt > 0 ? 0.05 : 0);
  const a = await screenShapeVars(fake(g1), rg, obs), ga = gridCandidates([...a.vars, 'R'], rg);
  ok(a.vars.join() === 'h,c' && ga.length <= 27, `h 선택 → 다른 변수 1개: ${a.vars} (격자 ${ga.length})`);
  const g2 = (c) => (c.c > 0 ? 0.3 : 0) + (c.e > 0 ? 0.2 : 0) + (c.h > 0 ? 0.1 : 0) + (c.dt > 0 ? 0.05 : 0);
  const b = await screenShapeVars(fake(g2), rg, obs);
  ok(b.vars.join() === 'c,e,dt' && gridCandidates(b.vars, rg).length <= 27, `h 가 예산 초과 → 건너뜀: ${b.vars}`); }
ok(halvingTotal(27) === 35 && halvingTotal(4) === 10 && halvingTotal(1) === 3, 'halving 평가 후보 수 합(진행률 분모)');
{ // pickVariant lowestPassing: 1차 전체(6만) → 2차 통과 후보 중 등급 낮은 2개(30만) → 통과 중 등급 최저
  const seen = [], cands = [0, 1, 2, 3, 4, 5].map((g) => ({ g }));
  const evalFn = async (cs, N, ms) => { seen.push([cs.map((c) => c.g).join(''), N, ms]); return cs.map((c) => ({ cand: c, ok: true, stats: st(0.7 + c.g * 0.04, 0.9), eff: 0.5 + c.g / 100 })); };
  const r = await pickVariant(cands, evalFn, obs, { prefer: 'lowestPassing', grade: (c) => c.g });
  ok(r.best.cand.g === 3 && seen[0][0] === '012345' && seen[0][1] === 6e4 && seen[1][1] === 3e5 && seen[1][0] === '34' && r.results1.length === 6 && r.results2.length === 2, `lowestPassing: 통과(g≥3) 중 최저 등급 g=${r.best.cand.g} (2차 ${seen[1][0]})`);
  const evalNo = async (cs) => cs.map((c) => ({ cand: c, ok: c.g !== 5, stats: st(0.5 + c.g * 0.04, 0.9), eff: 0.5 }));
  const r2 = await pickVariant(cands, evalNo, obs, { prefer: 'lowestPassing', grade: (c) => c.g });
  ok(r2.best.cand.g === 4, `통과 없음 → 점수 최고(제약 위반 제외): g=${r2.best.cand.g}`);
  const r3 = await pickVariant(cands, evalFn, obs, { prefer: 'best' });
  ok(r3.best.cand.g === 5, `best → 점수 최고(통과면 효율): g=${r3.best.cand.g}`);
  const r4 = await pickVariant(cands, async (cs) => cs.map((c) => ({ cand: c, ok: false })), obs, { prefer: 'best' });
  ok(r4.best === null, '전부 제약 위반 → null'); }
{ // sameDesign: dz(|Δ|<1e-6, 없음 = 0)·finish(part/kind/R)
  const b = { count: 5, pitch: 0, milky: 3 };
  ok(sameDesign({ ...b, dz: 0 }, b) && sameDesign({ ...b, dz: 1e-8 }, { ...b, dz: 0 }) && !sameDesign({ ...b, dz: 0.5 }, b), 'sameDesign: dz');
  const f = { part: 1, kind: 'whiteDiffuse', R: 0.85 };
  ok(sameDesign({ ...b, finish: f }, { ...b, finish: { ...f } }) && sameDesign({ ...b, finish: null }, b) && !sameDesign({ ...b, finish: f }, b)
    && !sameDesign({ ...b, finish: f }, { ...b, finish: { ...f, R: 0.9 } }) && !sameDesign({ ...b, finish: f }, { ...b, finish: { ...f, part: 2 } }) && !sameDesign({ ...b, finish: f }, { ...b, finish: { ...f, kind: 'metal' } }), 'sameDesign: finish'); }
{ // 실행 순서 ② → ⑤ → ④ → ① → ③ (가짜 io 호출 순서), ⑤ 는 best · ④ 는 통과 중 최저 등급, d 에 반영
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) }, log = [], prog = [];
  const fins = [{ kind: 'whiteDiffuse', R: 0.85, current: true }, { kind: 'whiteDiffuse', R: 0.9 }, { kind: 'whiteDiffuse', R: 0.95 }];
  const io = {
    basis: async () => { log.push('leds'); return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; },
    evalVariants: async (d, cs, N) => { const k = 'dz' in cs[0] ? 'height' : 'housing'; if (N === 6e4) log.push(k);
      return cs.map((c) => k === 'height' ? { cand: c, ok: true, stats: st(0.85, 0.9), eff: 0.5 - Math.abs(c.dz - 1.5) / 10 } : { cand: c, ok: true, stats: st(c.finish.R >= 0.9 ? 0.85 : 0.7, 0.9), eff: c.finish.R }); },
    milkyRows: async (d, ms) => { const k = log.includes('leds') ? 'milky' : 'ledsRef'; if (!log.includes(k)) log.push(k); return rowsOf(ms); },
    evalShapes: async (d, cs) => { if (!log.includes('shape')) log.push('shape'); return cs.map((c) => ({ cand: c, stats: st(0.9, 0.9), eff: 0.6, ok: true })); },
    verify: async (d) => ({ stats: st(d.dz ? 0.95 : 0.6, 0.9), eff: 0.6 }), progress: (s) => { if (prog.at(-1) !== s) prog.push(s); }, cancelled: () => false };
  const r = await runAutoDesign({ stages: { leds: true, height: true, housing: true, milky: true, shape: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 5, pitch: 0, shape: null, finish: null, dz: 0 },
    milkyMax: 5, G, line: { length: 2, closed: false }, nMax: 4, heightRange: [-1, 3], finishCands: fins, housingPart: 1, shapePart: 0, shapeCands: [{ dt: 0.2, h: 0, R: 2.75, e: 0, c: 0 }] }, io);
  ok(log.join() === 'ledsRef,leds,height,housing,milky,shape', `호출 순서: ${log.join()}`);
  ok(prog.join() === 'current,leds,height,housing,milky,shape,verify', `진행 단계: ${prog.join()}`);
  ok(r.best.dz === 1.5 && r.best.finish?.part === 1 && r.best.finish.R === 0.9 && r.best.finish.kind === 'whiteDiffuse', `⑤ dz=${r.best.dz} · ④ ${JSON.stringify(r.best.finish)}(통과 중 최저 등급)`);
  ok(r.steps.some((x) => x.stage === 'height' && x.results1.length === 7) && r.steps.some((x) => x.stage === 'housing'), 'steps 에 height(후보 7개)·housing'); }
{ // ④ 현재 면 처리(current)가 뽑히면 finish = 현재 값(null) · ⑤ 0 이면 dz 0 → 같은 설계 → 현재안 그대로
  const fins = [{ kind: 'whiteDiffuse', R: 0.85, current: true }, { kind: 'whiteDiffuse', R: 0.9 }], calls = [];
  const io = { evalVariants: async (d, cs) => cs.map((c) => ({ cand: c, ok: true, stats: st(0.9, 0.9), eff: 'dz' in c ? 0.5 - Math.abs(c.dz) : 0.5 })),
    verify: async (d) => { calls.push(d); return { stats: st(0.9, 0.9), eff: 0.5 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { height: true, housing: true }, obs, current: { milky: 3, count: 5, pitch: 0, finish: null, dz: 0 }, heightRange: [-1, 1], finishCands: fins, housingPart: 1 }, io);
  ok(r.unchanged && r.best.finish === null && r.best.dz === 0 && calls.length === 1, `현재 후보 선택 → 현재안 그대로 (verify ${calls.length}회)`); }
{ // ④ 특수 처리 후보(spec P4 §2.3d): 통과하는 유일한 후보가 특수 → best.finish.coating = id
  const fins = [{ kind: 'whiteDiffuse', R: 0.85, current: true }, { kind: 'whiteDiffuse', R: 0.9 }, { kind: 'whiteDiffuse', R: 0.97, special: true, coating: 'coat-white' }];
  const io = { evalVariants: async (d, cs) => cs.map((c) => ({ cand: c, ok: true, stats: st(c.finish.R > 0.95 ? 0.9 : 0.6, 0.9), eff: 0.5 })),
    verify: async (d) => ({ stats: st(d.finish?.R > 0.95 ? 0.9 : 0.6, 0.9), eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { housing: true }, obs, current: { milky: 3, count: 5, pitch: 0, finish: null }, finishCands: fins, housingPart: 1 }, io);
  ok(r.best.finish?.coating === 'coat-white' && r.best.finish.R === 0.97 && !('special' in r.best.finish), `특수 후보 선택 → coating 전달: ${JSON.stringify(r.best.finish)}`); }
{ // 가드: ⑤ 가 dz 를 골랐지만 검증에서 이득 없음 → 현재안 유지
  const io = { evalVariants: async (d, cs) => cs.map((c) => ({ cand: c, ok: true, stats: st(0.7 + c.dz / 100, 0.9), eff: 0.5 })),
    verify: async (d) => ({ stats: st(0.7, 0.9), eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { height: true }, obs, current: { milky: 3, count: 5, pitch: 0, dz: 0 }, heightRange: [0, 3] }, io);
  const g = r.steps.find((x) => x.stage === 'guard');
  ok(r.unchanged && r.best.dz === 0 && g?.tried.dz === 3 && /현재안 유지/.test(r.reason), `⑤ 이득 없음 → 현재안 유지 (시도 dz ${g?.tried.dz})`); }
{ // ② 2D 후보 격자(spec P4 §2.2b): 1열(w 0)은 리플, ±1 줄은 고름 → 2열 × 1개(±1) · d 에 rows·rowGap · sameDesign
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const cand = [0, -1, 1].flatMap((w) => [0, 1, 2].map((s) => ({ s, w }))), maps = cand.map(({ w }) => Float32Array.from(w === 0 ? [1, 0.1] : [1, 1]));
  const B = { cand, maps, emitted: 1, gaps: [1] }, line = { length: 2, closed: false, width: 4 };
  const io = { basis: async () => B, verify: async (d) => ({ stats: st(d.rows === 2 ? 0.95 : 0.5, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 2, pitch: 0 }, G, line, nMax: 4 }, io);
  const s2 = r.steps.find((x) => x.stage === 'leds');
  ok(!r.unchanged && r.best.count === 1 && r.best.rows === 2 && r.best.rowGap === 1 && s2.total === 2, `② 2D: 2열 × ${r.best.count}개 ±${r.best.rowGap} (총 ${s2.total})`);
  // fewer 는 총수 비교: 현재 1열 2개(총 2) vs 2열 × 1개(총 2) — 점수 같으면 현재안 유지(열당 1 < 2 로 속지 않음)
  const io2 = { ...io, verify: async () => ({ stats: st(0.95, 0.9), eff: 1 }) };
  const r2 = await runAutoDesign({ stages: { leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 2, pitch: 0, rows: 1 }, G, line, nMax: 4 }, io2);
  const r3 = await runAutoDesign({ stages: { leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 3, pitch: 0, rows: 1 }, G, line, nMax: 4 }, io2);
  ok(r2.unchanged && !r3.unchanged && r3.best.rows === 2, 'fewer = 총 LED 수(rows·count): 총 2 = 2 → 유지, 총 2 < 3 → 추천');
  ok(sameDesign({ count: 2, pitch: 0 }, { count: 2, pitch: 0, rows: 1, rowGap: 0 }) && sameDesign({ count: 2, pitch: 0, rows: 1, rowGap: 3 }, { count: 2, pitch: 0 }) && !sameDesign({ count: 2, pitch: 0, rows: 2, rowGap: 3 }, { count: 2, pitch: 0 })
    && !sameDesign({ count: 2, pitch: 0, rows: 2, rowGap: 3 }, { count: 2, pitch: 0, rows: 2, rowGap: 4 }) && sameDesign({ count: 2, pitch: 0, rows: 2, rowGap: 3 }, { count: 2, pitch: 0, rows: 2, rowGap: 3 }), 'sameDesign: rows(없음 = 1)·rowGap(1열이면 무시)'); }
{ // 최종 판정: 단계는 통과(⑤ 후보 0.9)였어도 정밀 재계산이 미달이면 feasible=false + 사유
  const io = { evalVariants: async (d, cs) => cs.map((c) => ({ cand: c, ok: true, stats: st(0.85 + c.dz / 100, 0.9), eff: 0.5 + c.dz / 100 })),
    verify: async (d) => ({ stats: st(d.dz ? 0.77 : 0.5, 0.92), eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { height: true }, obs, current: { milky: 3, count: 5, pitch: 0, dz: 0 }, heightRange: [0, 3] }, io);
  ok(!r.unchanged && !r.feasible && /최종 정밀 재계산에서 목표 미달 — 길이 U 0\.77 · 폭 U 0\.92/.test(r.reason), `정밀 재계산 미달 → 불가: ${r.reason}`); }
{ // ② 재확인: 첫 후보(±1) 검증 미달 → 같은 총수 다른 열 간격(±2) 검증 통과 → 그것
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const cand = [0, -1, 1, -2, 2].flatMap((w) => [0, 1, 2].map((s) => ({ s, w }))), maps = cand.map(({ w }) => Float32Array.from(w === 0 ? [1, 0.1] : [1, 1]));
  const B = { cand, maps, emitted: 1, gaps: [1, 2] }, line = { length: 2, closed: false, width: 4 }, cv = { stats: st(0.5, 0.9), eff: 1 };
  const run = async (U) => {
    const calls = [], prog = [];
    const io = { basis: async () => B, verify: async (d) => { calls.push(d); return { stats: st(U(d), 0.9), eff: 1 }; }, progress: (s, f, t) => prog.push(t), cancelled: () => false };
    const r = await runAutoDesign({ stages: { leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 3, pitch: 0, rows: 1 }, currentVerified: cv, G, line, nMax: 4 }, io);
    return { r, calls, prog };
  };
  const a = await run((d) => (d.rows === 2 && d.rowGap === 2 ? 0.95 : d.rows === 2 ? 0.7 : 0.6));
  const sv = a.r.steps.find((x) => x.stage === 'ledsVerify');
  ok(a.r.feasible && a.r.best.rows === 2 && a.r.best.rowGap === 2 && a.calls.length === 2 && sv?.tried.length === 2 && sv.tried[1].verified.stats.Ulen === 0.95 && a.prog.includes('② 후보 재확인 (2/3)'),
    `② 첫 후보 미달 → 두 번째(±${a.r.best.rowGap}) 통과 (verify ${a.calls.length}회)`);
  const b = await run((d) => (d.rows === 2 && d.rowGap === 2 ? 0.75 : d.rows === 2 ? 0.7 : 0.6));
  ok(!b.r.feasible && b.r.best.rows === 2 && b.r.best.rowGap === 2 && b.calls.length <= 3 && /최종 정밀 재계산에서 목표 미달 — 길이 U 0\.75/.test(b.r.reason),
    `② 모두 미달 → 검증 최고(±${b.r.best.rowGap}) 유지 · verify ${b.calls.length}회: ${b.r.reason}`); }
{ // ②+④+① (spec §2.2c): ② 기준 = 거친 최고점 Milky(상한 아님) · 케이스 최고 등급 → 개수 확정 뒤 ④ 최저 통과 등급 · ① 최소 Milky
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const fins = [{ kind: 'whiteDiffuse', R: 0.85, current: true }, { kind: 'whiteDiffuse', R: 0.95 }, { kind: 'whiteDiffuse', R: 0.9 }];
  const run = async (stages) => {
    const basisD = [], bases = [], prog = [];
    const io = { basis: async (d) => { basisD.push(d); return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; },
      milkyRows: async (d, ms, o) => { if (!basisD.length && !o?.precise) bases.push(ms[10]); return peakRows(ms, 0.85); },
      evalVariants: async (d, cs) => cs.map((c) => ({ cand: c, ok: true, stats: st(c.finish.R >= 0.9 ? 0.85 : 0.7, 0.9), eff: c.finish.R })),
      verify: async () => ({ stats: st(0.9, 0.9), eff: 1 }), progress: (s, f, t) => prog.push(t), cancelled: () => false };
    const r = await runAutoDesign({ stages, obs, current: { milky: 1, count: 5, pitch: 0, finish: null }, milkyMax: 5, G, line: { length: 2, closed: false }, nMax: 4, finishCands: fins, housingPart: 1 }, io);
    return { r, basisD, bases, prog, ref: r.steps.find((x) => x.stage === 'ledsRef') };
  };
  const a = await run({ leds: true, housing: true, milky: true });
  ok(a.basisD.length === 1 && Math.abs(a.basisD[0].milky - 4) <= 0.25 && a.basisD[0].finish?.R === 0.95 && a.basisD[0].finish.part === 1, `② 기준 d: Milky ${a.basisD[0]?.milky}(최고점 ≈4, 상한 5 아님) · 케이스 ${a.basisD[0]?.finish?.R}(최고 등급)`);
  ok(a.bases.join() === '0.5,1.5,2.5,3.5,4.5' && a.prog.some((t) => /^② 기준 Milky 찾기 \(Milky 0\.5\)/.test(t)), `거친 최고점 탐색 ${a.bases.join(' → ')} (≤ 상한 5, 정밀 없음)`);
  ok(a.ref && a.ref.milky === a.basisD[0].milky && a.ref.finish?.R === 0.95, `steps ledsRef: Milky ${a.ref?.milky} · 케이스 ${a.ref?.finish?.R}`);
  ok(a.r.best.count === 1 && a.r.best.finish?.R === 0.9 && Math.abs(a.r.best.milky - 3) < 0.05, `개수 ${a.r.best.count} → ④ 최저 통과 ${a.r.best.finish?.R} → ① 최소 Milky ${a.r.best.milky}`);
  const b = await run({ leds: true, milky: true });
  ok(Math.abs(b.basisD[0].milky - 4) <= 0.25 && b.basisD[0].finish === null && b.ref?.finish === null, `②+①: 기준 Milky ${b.basisD[0].milky} · 케이스 그대로`);
  const c = await run({ leds: true, housing: true });
  ok(c.basisD[0].milky === 1 && c.basisD[0].finish?.R === 0.95 && c.bases.length === 0 && c.ref?.milky == null && c.r.best.finish?.R === 0.9 && c.r.best.milky === 1, `②+④: 기준 Milky ${c.basisD[0].milky}(현재) · 케이스 최고 → 최종 ${c.r.best.finish?.R}`);
  const e = await run({ leds: true });
  ok(e.basisD[0].milky === 1 && e.basisD[0].finish === null && !e.ref && e.bases.length === 0, '② 만: 기존 그대로(기준 탐색 없음)'); }
done();
