// P4 단계 실행기(가짜 io): node test/mech3d-autodesign.mjs
import { runAutoDesign, shapeScore, halving, smoothU, halvingTotal, sameDesign, screenShapeVars, shapeTotal } from '../src/engine/mech3d/autodesign.js';
import { shapeVarRanges, gridCandidates } from '../src/engine/mech3d/shape-opt.js';
import { ok, done } from './mech3d-util.mjs';

const obs = { targetLen: 0.8, targetWid: 0.6 };
const st = (Ulen, Uwid) => ({ Ulen, Uwid, empty: false });
// 가짜 재가중 행: U(m) = 0.5 + 0.12·m → 목표 0.8 경계 = Milky 2.5 (창 = 기준 ±0.25)
const rowsOf = (ms, U = (m) => 0.5 + 0.12 * m) => ms.map((m) => ({ milky: m, Ulen: U(m), Uwid: 0.9, eff: 1 - m / 20, ess: 1, trusted: true, margin: Math.min(U(m) - 0.8, 0.3) }));
{ // ① 만: 기준 3 → 창 전체 통과 → 이분 탐색으로 내려가 경계 2.5 를 찾음 → 최종 검증
  const bases = [], precise = [], calls = [];
  const io = { milkyRows: async (d, ms, o) => { (o?.precise ? precise : bases).push(ms[10]); return rowsOf(ms); }, verify: async (d) => { calls.push(d.milky); return { stats: st(0.81, 0.9), eff: 1 - d.milky / 20 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5 }, io);
  ok(r.feasible && Math.abs(r.best.milky - 2.5) < 0.03 && calls.at(-1) === r.best.milky && bases.length <= 8 && bases[1] < bases[0], `① 이분 탐색: 기준 ${bases.map((b) => b.toFixed(2)).join(' → ')} → 최소 Milky ${r.best.milky}`);
  ok(precise.length === 1 && precise[0] === bases.at(-1) && r.steps.at(-1).precise, `경계가 든 창(기준 ${precise[0]?.toFixed(2)})만 정밀 재추적`);
  ok(calls.length === 2 && calls[0] === 3 && r.current.stats.Ulen === 0.81, '현재안을 먼저 같은 추정기(verify)로 계산 → r.current'); }
{ // cfg.currentVerified(수렴한 점진 결과) → 현재안 verify 생략
  const calls = [], cv = { stats: st(0.81, 0.9), eff: 0.95 };
  const io = { milkyRows: async (d, ms) => rowsOf(ms), verify: async (d) => { calls.push(d.milky); return { stats: st(0.81, 0.9), eff: 1 - d.milky / 20 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5, currentVerified: cv }, io);
  ok(calls.length === 1 && calls[0] !== 3 && r.current === cv, `현재안 재사용 → verify 는 최종안만 (${calls})`); }
{ // 할선: 경계 3.3(이분이면 기준 4.75 → 2.375 → 3.56 → 2.97 → 3.27 = 5개) → 두 기준의 여유로 할선 근 → 3개
  const bases = [], U = (m) => 0.8 + 0.1 * (m - 3.3);
  const io = { milkyRows: async (d, ms, o) => { if (!o?.precise) bases.push(ms[10]); return rowsOf(ms, U); }, verify: async (d) => ({ stats: st(U(d.milky), 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 4.9 }, milkyMax: 5 }, io);
  const m = r.steps.filter((x) => x.stage === 'milky').at(-1).pick.milky;
  ok(bases.length === 3 && Math.abs(m - 3.3) < 0.03, `할선 재기준: ${bases.map((b) => b.toFixed(2)).join(' → ')} (경계 ${m})`); }
{ // 상한까지 미달(U 가 천천히 오름) → 가장 가까운 안 = 상한 근처 + 상한 안내
  const io = { milkyRows: async (d, ms) => rowsOf(ms, (m) => 0.6 + 0.01 * m), verify: async (d) => ({ stats: st(0.6 + 0.01 * d.milky, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3 }, milkyMax: 5 }, io);
  ok(!r.feasible && /상한\(5\)/.test(r.reason) && r.best.milky >= 4.9, `불가: ${r.reason}`); }
{ // 여유가 Milky 와 함께 오르지만 상한까지 미달 → 가장 가까운 안 = 모든 기준 중 여유 최대 행(상한 근처), 사유도 그 Milky
  const io = { milkyRows: async (d, ms) => ms.map((m) => ({ milky: m, Ulen: 0.5 + 0.05 * m, Uwid: 0.9, eff: 1, ess: 1, trusted: true, margin: 0.05 * m - 0.3 })), verify: async (d) => ({ stats: st(0.5 + 0.05 * d.milky, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 2 }, milkyMax: 5 }, io);
  const top = Math.max(...r.steps.flatMap((x) => x.rows.map((w) => w.milky)));
  ok(!r.feasible && r.best.milky === top && top >= 4.9 && new RegExp(`Milky ${top}에서도`).test(r.reason), `가장 가까운 안 = 상한 근처 Milky ${r.best.milky}: ${r.reason}`); }
{ // ②+①: 후보 지도는 Milky 상한(5)에서 추적, 최소 개수 뒤 ① 이 Milky 를 낮춤
  let basisMilky = null;
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const io = { basis: async (d) => { basisMilky = d.milky; return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; }, milkyRows: async (d, ms) => rowsOf(ms), verify: async () => ({ stats: st(0.9, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true, leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 5, pitch: 0 }, milkyMax: 5, G, line: { length: 2, closed: false }, nMax: 4 }, io);
  ok(basisMilky === 5 && r.best.count === 1 && Math.abs(r.best.milky - 2.5) < 0.03, `②: 상한 ${basisMilky} 에서 최소 ${r.best.count}개 → ① Milky ${r.best.milky}`); }
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
  ok(sc.vars.join() === 'c' && seen[0].length === 7 && seen[1].length === 3 && seen[1].some((c) => c.c === 0 && c.dt === 0), `선별 → ['c'], 선별 7개 · 격자 3개(현재 포함): ${sc.vars}`);
  ok(r.best.shape.c > 0 && !r.unchanged && plans.at(-1).total === shapeTotal(7, 3), `최종 형상 c=${r.best.shape?.c}, 분모 ${plans.at(-1)?.total}`);
  const io2 = { ...io, evalShapes: mk(() => 0), verify: async () => ({ stats: st(0.75, 0.9), eff: 0.5 }) };
  const r2 = await runAutoDesign({ stages: { shape: true }, obs, current: cur, shapePart: 0, shapeRanges: rg }, io2);
  ok(r2.unchanged && r2.best.shape === null && r2.reason === '형상 변수의 효과가 잡음 수준 — 현재 형상 유지', `효과 없음 → 현재안 유지: ${r2.reason}`); }
{ // h 선별 → R 도 격자에 포함 (R 은 선별 후보에 안 나옴)
  const rg = shapeVarRanges({ t0: 2, pitch: 5, hasCenters: true }), seen = [];
  const evalFn = async (cands) => { seen.push(cands); return cands.map((c) => ({ cand: c, stats: st(0.6 + (c.h > 0 ? 0.3 : 0), 0.9), eff: 0.5, ok: true })); };
  const sc = await screenShapeVars(evalFn, rg, obs);
  ok(sc.vars.join() === 'h' && seen[0].length === 9 && seen[0].every((c) => c.R === 2.75), `h 선별(선별 9개(R 은 h 와 묶음), R=mid): ${sc.vars}`);
  const io = { evalShapes: (d, c, N) => evalFn(c), verify: async (d) => ({ stats: st(d.shape?.h > 0 ? 0.9 : 0.6, 0.9), eff: 0.5 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { shape: true }, obs, current: { milky: 3, shape: null }, shapePart: 0, shapeRanges: rg }, io);
  const grid = seen[2], Rs = new Set(grid.map((c) => c.R));
  ok(grid.length === 9 && Rs.size === 3 && r.best.shape.h > 0, `격자 ${grid.length}개, R ${[...Rs]}`); }
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
done();
