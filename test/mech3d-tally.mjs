// 관측 집계: node test/mech3d-tally.mjs
import { tallyGeometry, makeAccumulator, tallyStats } from '../src/engine/mech3d/tally.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { rng } from '../src/engine/l2/mc-slab.js';
import { topFaceMesh, rectTris, ok, done } from './mech3d-util.mjs';

const line = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 2)], [{ part: 0, face: 1 }], [0, 0, 1]);
const obs = { faces: [{ part: 0, face: 1 }], dir: [0, 0, 1], cone: 10, cell: 0.5, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.5 };
const G = tallyGeometry(line, obs);
ok(G.ns === 200 && G.valid.reduce((a, b) => a + b, 0) === (200 - 2) * 10, `격자: s ${G.ns}칸, 유효 셀 ${G.valid.reduce((a, b) => a + b, 0)} (가장자리 0.5mm 제외 → 198×10)`);
// 합성 출사: 밝기 ∝ (20 + x) — 길이 방향 선형 경사, 폭 방향 균일
const r = rng(1), B = 10, accs = [];
for (let b = 0; b < B; b++) {
  const a = makeAccumulator(G, line, obs);
  for (let k = 0; k < 200000; k++) {
    const x = r() * 100, y = r() * 6, w = (20 + x) / 120;
    a.onExit(0, 1, x, y, 2, 0, 0, 1, w); a.onEscape(x, y, 2.5, 0, 0, 1, w);
    a.onExit(0, 1, x, y, 2, 0.5, 0, Math.sqrt(0.75), w); a.onEscape(x, y, 3, 0.5, 0, Math.sqrt(0.75), w);   // 30° → 원뿔(10°) 밖
    a.onExit(0, 0, x, y, 0, 0, 0, -1, w); a.onEscape(x, y, -1, 0, 0, 1, w);                                 // 관측면 아닌 면
    a.onEscape(x, y, 5, 0, 0, 1, w);                                                                        // 관측면 출사 기록 없음
  }
  accs.push(a.acc);
}
const S = tallyStats(G, accs, obs), want = (20 + 0.75) / (20 + 99.25);
ok(Math.abs(S.Ulen - want) < 0.01, `길이 방향 U ${S.Ulen.toFixed(4)} (해석 ${want.toFixed(4)}), σ ${S.seLen.toFixed(4)}`);
ok(S.Uwid > 0.7 && S.Uwid <= 1, `폭 방향 최저 U ${S.Uwid.toFixed(3)} @ s=${S.sWorst.toFixed(1)}mm (균일 + 셀 잡음)`);
const rr = S.profile[150] / S.profile[50], r2 = Math.max(rr, 1 / rr), want2 = (20 + 75.25) / (20 + 25.25);   // 라인 진행 방향과 무관하게 비교
ok(!S.passLen && S.profile.length === 200 && Math.abs(r2 / want2 - 1) < 0.03, `판정·프로파일(길이 ${S.passLen ? '합격' : '불합격'}, 75/25mm 비 ${r2.toFixed(3)} / 해석 ${want2.toFixed(3)})`);
ok(S.counted === 198 * 10 && S.noiseWarn === false, `집계 셀 ${S.counted}, 잡음 경고 없음(목표와의 여유가 3σ 보다 큼)`);
done();
