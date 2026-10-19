// ② LED 개수·피치(후보 응답 합산): node test/mech3d-basis.mjs
import { candidatePositions, interpWeights, layoutMap, searchLeds, pitchOptions } from '../src/engine/mech3d/basis.js';
import { ok, done } from './mech3d-util.mjs';
import { loadTable } from './l2-util.mjs';
import { plateFixture } from './m3-fixture.mjs';
import { runChunk } from '../src/engine/mech3d/job.js';

const line = { length: 100, closed: false };
{ const c = candidatePositions(line, 1);
  ok(c.length === 101 && c[0] === 0 && c[100] === 100, '열린 라인 후보: 0~L 1mm 간격, 양 끝 포함');
  const cc = candidatePositions({ length: 100, closed: true }, 1);
  ok(cc.length === 100 && cc[99] === 99, '닫힌 라인 후보: 균등(끝 = 처음)');
  const w = interpWeights(c, 10.25);
  ok(w.length === 2 && w[0][0] === 10 && Math.abs(w[0][1] - 0.75) < 1e-12 && w[1][0] === 11 && Math.abs(w[1][1] - 0.25) < 1e-12, '후보 사이 위치 = 이웃 두 후보 선형 보간'); }
{ // A-3 합성: s 칸 100 · 폭 1칸. 후보 c 의 지도 = 가우시안(σ=6). 등간격 n 개의 리플 U 를 해석적으로 계산해 최소 n 과 비교
  const G = { ns: 100, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 100, closed: false, winS: 10, area: new Float64Array(100).fill(1), valid: new Uint8Array(100).fill(1) };
  const sig = 6, cand = candidatePositions(line, 1);
  const maps = cand.map((s) => Float32Array.from({ length: 100 }, (_, i) => Math.exp(-(((i + 0.5) - s) ** 2) / (2 * sig * sig))));
  const U = (n) => { const ss = Array.from({ length: n }, (_, i) => ((i + 0.5) * 100) / n), p = Array.from({ length: 100 }, (_, i) => ss.reduce((a, s) => a + Math.exp(-(((i + 0.5) - s) ** 2) / (2 * sig * sig)), 0)); return Math.min(...p) / Math.max(...p); };
  // 열린 라인 끝단 손실로 U 는 ≈0.54 에서 포화 — 목표 0.5 (해석 최소 8개)
  const obs = { targetLen: 0.5, targetWid: 0 };
  let want = 1; while (U(want) < 0.5 && want < 40) want++;
  const r = searchLeds({ G, obs, line, cand, maps, pitches: [0], nMax: 40, emitted: 1 });
  ok(r.feasible && r.n === want && r.pitch === 0, `A-3 최소 개수: 찾음 ${r.n} = 해석 ${want}`);
  const sum = layoutMap(cand, maps, [25, 75.5]);
  ok(Math.abs(sum[25] - (maps[25][25] + 0.5 * maps[75][25] + 0.5 * maps[76][25])) < 1e-6, 'layoutMap = 위치별 보간 지도 합');
  const none = searchLeds({ G, obs: { targetLen: 0.999, targetWid: 0 }, line, cand, maps, pitches: [0], nMax: 5, emitted: 1 });
  ok(!none.feasible && none.n === 5 && /LED 최대 5개/.test(none.reason), `불가 → 가장 가까운 안: ${none.reason}`); }
{ const p = pitchOptions({ length: 100, closed: false }, 5, { min: 10, max: 30 });
  ok(p[0] === 0 && p.includes(10) && p.includes(25) && !p.includes(26), '피치 후보: 0(균등) + 범위 1mm 간격, (n−1)·p ≤ L 만');
  ok(pitchOptions({ length: 100, closed: true }, 5, { min: 10, max: 30 }).join() === '0', '닫힌 라인은 균등만'); }
{ // 판 장면(LED 5개 위치 10·30·50·70·90): 후보 지도(위치마다 LED 1개, 같은 광자/LED) 합 vs 5개 직접
  const F = plateFixture(loadTable()), nCell = F.G.ns * F.G.nw, B = 6, N1 = 20000;
  const at = (x) => ({ pos: [x, 3, -3], axis: [0, 0, 1], xAxis: [1, 0, 0] });
  const per = (em, b, N) => runChunk({ ...F, emitters: em, N, seed: 500 + b }).acc;
  // combineSources 는 광속을 더한다(LED 5개 = 방출 5배) → 단일 LED 지도 5개의 합 = 5개 직접 지도(나누기 없음)
  const sumB = Array.from({ length: B }, (_, b) => { const s = new Float64Array(nCell); for (const x of [10, 30, 50, 70, 90]) { const a = per([at(x)], b * 10 + x, N1); for (let k = 0; k < nCell; k++) s[k] += a[k]; } return s; });
  const dirB = Array.from({ length: B }, (_, b) => per(F.emitters, 1000 + b, N1));
  let worst = 0;
  for (let k = 0; k < nCell; k++) {
    if (!F.G.valid[k]) continue;
    const a = sumB.map((x) => x[k]), d = dirB.map((x) => x[k]);
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, se = (v) => Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1) / v.length);
    if (mean(d) <= 0) continue;
    worst = Math.max(worst, Math.abs(mean(a) - mean(d)) / Math.hypot(se(a), se(d)));
  }
  ok(worst < 4.5, `A-2 후보 합 = 다중 LED 직접: 셀 최대 ${worst.toFixed(2)}σ`); }
done();
