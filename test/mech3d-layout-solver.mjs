// ② LED 배치 Solver: node test/mech3d-layout-solver.mjs
import { solveLayout, uniformPositions, compressedPositions, layoutText, SNAP } from '../src/engine/mech3d/layout-solver.js';
import { candidateGrid, searchLeds2 } from '../src/engine/mech3d/basis.js';
import { ok, done } from './mech3d-util.mjs';

const line = { length: 100, closed: false };
const G = { ns: 100, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 100, closed: false, winS: 10, area: new Float64Array(100).fill(1), valid: new Uint8Array(100).fill(1) };
const cand = candidateGrid(line, { sStep: 2 });
// 후보 지도 = 가우시안(σ 6) × 끝 감쇠(att: 벽 근처 어두움)
const mk = (att) => cand.map(({ s }) => Float32Array.from({ length: 100 }, (_, i) => { const x = i + 0.5, edge = Math.min(x, 100 - x); return Math.exp(-((x - s) ** 2) / 72) * (1 - att * Math.exp(-edge / 6)); }));
const ss = (r) => r.positions.map((q) => q.s).sort((a, b) => a - b);
const sym = (r) => { const s = ss(r); return s.every((x, i) => Math.abs(x + s[s.length - 1 - i] - 100) < 1e-9); };
const grid = (r) => ss(r).every((x) => Math.abs(((x - 50) / SNAP) - Math.round((x - 50) / SNAP)) < 1e-9);
const gapsOk = (r, g) => ss(r).every((x, i, a) => i === 0 || x - a[i - 1] >= g - 1e-9);

{ const s = uniformPositions(100, 5, 10), c = compressedPositions(100, 6, 5, 0.4), gp = c.slice(1).map((x, i) => x - c[i]);
  ok(s.join() === '10,30,50,70,90' && uniformPositions(100, 1, 0).join() === '50', '같은 피치: 끝 여백 e 에서 가운데 대칭');
  ok(Math.abs(c[0] - 5) < 1e-9 && Math.abs(c.at(-1) - 95) < 1e-9 && gp[0] < gp[2] && Math.abs(gp[0] - gp[4]) < 1e-9, `끝 압축: 양 끝 고정 · 끝 간격 < 가운데 · 대칭 (${gp.map((x) => x.toFixed(1))})`); }
{ // 끝 감쇠 없음: 균등(반 피치 여백) 은 U ≈ 0.54 에서 막힘 → 끝 여백을 고르면 같은 피치로 통과, 개수 적음
  const maps = mk(0), obs = { targetLen: 0.7, targetWid: 0 };
  const r = solveLayout({ G, obs, line, cand, maps, rowsOptions: [1], nMax: 30 }), old = searchLeds2({ G, obs, line, cand, maps, rowsOptions: [1], pitches: [0], nMax: 30 });
  ok(r.feasible && r.kind === 'uniform' && !old.feasible && r.total === 7 && r.pitch > 0, `끝 여백 최적화: ${layoutText(r)} (기존 균등 = 미달)`);
  ok(sym(r) && grid(r) && gapsOk(r, 2) && r.positions.every((q) => q.w === 0), '대칭 · 0.25 mm 격자 · 최소 간격 2 mm · 1열');
  ok(r.alts.length >= 1 && r.alts.every((a) => a.positions?.length), '대안(검증 미달 때) 있음'); }
{ // 강한 끝 감쇠: 같은 피치로는 안 되고 끝을 촘촘히 해야 통과
  const maps = mk(0.4), obs = { targetLen: 0.7, targetWid: 0 };
  const r = solveLayout({ G, obs, line, cand, maps, rowsOptions: [1], nMax: 30 });
  const s = ss(r), g = s.slice(1).map((x, i) => x - s[i]);
  ok(r.feasible && r.kind !== 'uniform' && g[0] < g[Math.floor(g.length / 2)], `끝 감쇠: ${layoutText(r)} — 끝 간격 ${g[0].toFixed(1)} < 가운데 ${g[Math.floor(g.length / 2)].toFixed(1)}`);
  ok(sym(r) && grid(r) && gapsOk(r, 2), '비균등도 대칭 · 격자 · 최소 간격');
  const u = solveLayout({ G, obs, line, cand, maps, rowsOptions: [1], nMax: r.total, timeBudget: 500, now: ((t) => () => (t += 1000))(0) });
  ok(!u.feasible, '시간 예산 넘음 = 그때까지 최선 → 미달(가장 가까운 안)'); }
{ // 불가: 가장 가까운 안 + 이유
  const r = solveLayout({ G, obs: { targetLen: 0.95, targetWid: 0 }, line, cand, maps: mk(0.4), rowsOptions: [1], nMax: 12 });
  ok(!r.feasible && r.positions.length > 0 && /목표 미달 — 가장 가까운/.test(r.reason) && /권장/.test(r.reason), `불가: ${r.reason}`); }
{ // 사용자 피치 범위: 같은 피치는 그 범위 안
  const r = solveLayout({ G, obs: { targetLen: 0.5, targetWid: 0 }, line, cand, maps: mk(0), rowsOptions: [1], nMax: 30, pitchRange: { min: 10, max: 12 } });
  ok(r.feasible && r.kind === 'uniform' && r.pitch >= 10 - 0.5 && r.pitch <= 12 + 0.5 && gapsOk(r, 10 - 0.5), `피치 범위 10~12: ${layoutText(r)}`); }
{ // 닫힌 라인: 균등(L/n)
  const ring = { length: 100, closed: true }, Gc = { ...G, closed: true }, cc = candidateGrid(ring, { sStep: 2 });
  const maps = cc.map(({ s }) => Float32Array.from({ length: 100 }, (_, i) => { const d = Math.min(Math.abs(i + 0.5 - s), 100 - Math.abs(i + 0.5 - s)); return Math.exp(-(d * d) / 72); }));
  const r = solveLayout({ G: Gc, obs: { targetLen: 0.8, targetWid: 0 }, line: ring, cand: cc, maps, rowsOptions: [1], nMax: 30 }), s = ss(r);
  ok(r.feasible && r.kind === 'uniform' && s.every((x, i) => i === 0 || Math.abs(x - s[i - 1] - 100 / s.length) < 0.3), `닫힌 라인 균등: ${s.length}개`); }
done();
