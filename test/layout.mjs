// LED 배치 원칙 테스트: node test/layout.mjs
// 기구 변경 없이 LED 배치·개수만으로 타겟 전체 균일도를 확보하는 것이 설계의 기본.
// 1) LED 는 개수 n 을 정해 타겟 중심 대칭으로 기구 경계(타겟+오버행, LED 반폭 안쪽)까지 균등하게
//    펼친다(간격 ≤ 피치). 판정은 중심부(면적 95%)이므로 "중심부 목표를 만족하는 최소 n" 을 찾는
//    것이 곧 추가는 중심부 기준으로, 제거는 가장자리 지원부터 줄이는 원칙이다.
// 2) 균일도는 피치에 단조가 아니다(피치≈깊이 근처가 최적) — 솔버는 이진탐색만으로 결론짓지 않는다.
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { ledPositions, ledCounts } from '../src/engine/directLit.js';
import { solveCombo } from '../src/engine/solver.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

const spec = structuredClone(DEFAULT_SPEC);
spec.target.xLen = 100; spec.target.yLen = 20; spec.led.sizeX = 1; spec.led.sizeY = 1; spec.space.depth = 5;
spec.goal.U0 = 0.85; spec.goal.edgeMargin = 0;

// 오버행 X 5 / Y 1, LED 1mm, 피치 상한 6 → X: usable 109 → 20열 간격 5.74, Y: usable 21 → 5열 간격 5.25.
// 최외곽 중심 = 기구 경계 안쪽 반폭(-4.5/104.5, -0.5/20.5), 중심 대칭.
{
  const pos = ledPositions(spec, 6, 6, 0, 0, 5, 1);
  const xs = [...new Set(pos.map((p) => +p.x.toFixed(6)))].sort((a, b) => a - b);
  const ys = [...new Set(pos.map((p) => +p.y.toFixed(6)))].sort((a, b) => a - b);
  ok(near(xs[0], -4.5) && near(xs.at(-1), 104.5), `X 최외곽 열 = 기구 경계 안쪽 반폭 (${xs[0]} / ${xs.at(-1)})`);
  ok(near(ys[0], -0.5) && near(ys.at(-1), 20.5), `Y 최외곽 열 = 기구 경계 안쪽 반폭 (${ys[0]} / ${ys.at(-1)})`);
  ok(xs.length === 20 && ys.length === 5 && near(ys[2], 10), `열 수 20×5, 중심 열 y=10 (${xs.length}×${ys.length})`);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  ok(Math.max(...gaps) <= 6 + 1e-9 && Math.max(...gaps) - Math.min(...gaps) < 1e-5, `X 간격 균등·피치 이하 (${gaps[0].toFixed(3)}mm)`);
  ok(xs.every((x, i) => near(x + xs[xs.length - 1 - i], 100)), '중심(x=50) 대칭');
  const c = ledCounts(spec, 6, 6, 5, 1);
  ok(c.nx === xs.length && c.ny === ys.length, `ledCounts = 실제 열 수 (${c.nx}×${c.ny})`);
  // 개수를 줄이면(피치 상한 ↑) 남는 열도 중심 대칭 + 경계까지 펼침: 피치 11 → 3열 (-0.5, 10, 20.5)
  const ys11 = [...new Set(ledPositions(spec, 6, 11, 0, 0, 5, 1).map((p) => +p.y.toFixed(6)))].sort((a, b) => a - b);
  ok(ys11.length === 3 && near(ys11[1], 10), `Y 피치 11 → 3열 중심 대칭 (${ys11.join(',')})`);
}
// 성긴 위상: 허용폭(usable 19) ≤ 피치 < 2·허용폭 → 양끝 2열(중심 비움), 피치 ≥ 2·허용폭 → 1열 중앙
{
  const ys2 = [...new Set(ledPositions(spec, 25, 25, 0, 0, 0, 0).map((p) => +p.y.toFixed(6)))].sort((a, b) => a - b);
  ok(ys2.length === 2 && near(ys2[0], 0.5) && near(ys2[1], 19.5), `Y 허용폭 19 ≤ 피치 25 → 양끝 2열 (${ys2.join(',')})`);
  const ys1 = [...new Set(ledPositions(spec, 25, 40, 0, 0, 0, 0).map((p) => p.y))];
  ok(ys1.length === 1 && near(ys1[0], 10), `피치 40 ≥ 2·19 → 1열 중앙 (${ys1.map((v) => v.toFixed(1)).join(',')})`);
}
// 사용자 실측 케이스: 100×20, 깊이 5, LED 1mm, 기구 +10%, L1 만 — LED 배치만으로 중심부 85% 달성
{
  const r = solveCombo(spec, [1]);
  ok(r.feasible && r.U0c >= 0.85, `L1 단독 중심부 85% 달성 (중심부 ${(r.U0c * 100).toFixed(1)}%, 전체 ${(r.U0 * 100).toFixed(1)}%, LED ${r.leds}, 피치 ${r.pitchX.toFixed(1)}×${(r.pitchY ?? r.pitchX).toFixed(1)})`);
  ok(r.leds <= 160, `LED 수 합리적 (${r.leds} ≤ 160)`);
}
// 기본 스펙 100×100, 깊이 12, 기구 +10%: L1 만으로 중심부 80% 달성
{
  const s = structuredClone(DEFAULT_SPEC);
  const r = solveCombo(s, [1]);
  ok(r.feasible && r.U0c >= 0.80, `기본 스펙 L1 중심부 80% 달성 (중심부 ${(r.U0c * 100).toFixed(1)}%, 전체 ${(r.U0 * 100).toFixed(1)}%, LED ${r.leds})`);
}

// 100×10, 깊이 7, L1 만, 목표 80%: 2열을 타겟 양끝에 두면 최대 63% 라 3열(39개)이 필요했지만, 최외곽
// 열을 안쪽으로 들이면(음수 오버행, y≈1.4/8.6) 2열 26개로 80% 를 넘는다 — 열이 적을 때는 최외곽
// 열 위치가 프로파일을 결정하므로 솔버가 안쪽 배치도 탐색한다. 기구 크기는 줄지 않는다(타겟 그대로).
// L5 최대 확산(강한 산란)은 적은 LED로도 목표를 크게 넘는다.
{
  const s = structuredClone(DEFAULT_SPEC);
  s.target = { xLen: 100, yLen: 10, shape: 'flat' }; s.goal.U0 = 0.80; s.led.sizeX = 1; s.led.sizeY = 1; s.space.depth = 7; s.levels[1].thk = 1;
  const r = solveCombo(s, [1]);
  ok(r.feasible && r.ny === 2 && r.padY < 0 && r.leds <= 30, `100×10 L1: 2열 안쪽 배치로 최소 LED (${r.nx}×${r.ny}=${r.leds}, padY ${r.padY.toFixed(2)}, 중심부 ${(r.U0c * 100).toFixed(1)}%)`);
  ok(Math.abs(r.fixtureY - 10) < 1e-9, `안쪽 배치여도 기구 Y 크기 = 타겟 (${r.fixtureY.toFixed(1)}mm)`);
  // 100×6: 1열(중앙) 15개로 80% 달성 — 2열 안쪽 배치(30개, 90%)보다 LED 가 적어 1열 선택
  const s6 = structuredClone(s); s6.target.yLen = 6;
  const r6 = solveCombo(s6, [1]);
  ok(r6.feasible && r6.leds <= 16, `100×6 L1: 최소 LED (${r6.nx}×${r6.ny}=${r6.leds}, 중심부 ${(r6.U0c * 100).toFixed(1)}%)`);
  // L5 최대 확산(각도 80°·미세크기·깊이 2mm)은 실측 물리량(edgeEscapeBoost)으로 재보정된
  // cone 항 덕분에 6~7개 정도로도 90%대 중심부 균일도를 낸다 — "패턴 자체로도 확산 효과가
  // 상당하다"는 방향과 일치(이전엔 물리적 근거 없는 depthK 항이 이 효과를 오히려 깎고 있었다).
  s.levels[5] = { on: true, ptype: 'pyramid', sizeX: 0.05, sizeY: 0.05, angleX: 80, angleY: 80, dir: '돌출', depth: 2 };
  s.goal.U0 = 0.9;
  const r5 = solveCombo(s, [1, 5]);
  ok(r5.feasible && r5.leds <= 10, `100×10 L5 최대확산: 적은 LED로 목표 달성 (${r5.leds}개, 중심부 ${(r5.U0c * 100).toFixed(1)}%)`);
}

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
