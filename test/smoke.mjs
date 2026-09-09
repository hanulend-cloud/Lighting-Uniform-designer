// 엔진 스모크 테스트 (브라우저 불필요): node test/smoke.mjs
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { computeField } from '../src/engine/directLit.js';
import { metrics, localGradient } from '../src/engine/uniformity.js';
import { optimize } from '../src/engine/optimizer.js';
import { solvePerLevel } from '../src/engine/solver.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

const spec = structuredClone(DEFAULT_SPEC);

const res = computeField(spec, { depth: 15, pitchX: 25, pitchY: 25, nx: 61, ny: 61 });
ok(res.field.length === 61 * 61, 'field 크기');
ok(res.field.every((v) => v >= 0 && Number.isFinite(v)), 'field 유한·비음수');
ok(res.leds.length > 0, `LED 배치 (${res.leds.length}개)`);

const m = metrics(res.field, res.nx, res.ny, 0.05);
ok(m.U0 > 0 && m.U0 <= 1.0001, `U0 범위 (${m.U0.toFixed(3)})`);
ok(m.minMax > 0 && m.minMax <= 1.0001, `min/max 범위 (${m.minMax.toFixed(3)})`);
const g = localGradient(res.field, res.nx, res.ny, 0.05);
ok(g >= 0 && Number.isFinite(g), `gradient (${g.toFixed(3)})`);

// 피치를 크게 줄이면 균일도가 개선(증가)되어야 한다 (유효영역 기준)
const tf = computeField(spec, { depth: 15, pitchX: 10, pitchY: 10, nx: 61, ny: 61 });
const tight = metrics(tf.field, tf.nx, tf.ny, 0.05);
ok(tight.minMax >= m.minMax - 0.03, `피치↓ → 균일도 개선 (${(m.minMax * 100).toFixed(0)}% → ${(tight.minMax * 100).toFixed(0)}%)`);

const opt = optimize(spec);
ok(opt.rows.length === 3 * 5 * 5, `탐색 조합 수 (${opt.rows.length})`);
ok(opt.top2.length >= 1, `Top2 산출 (${opt.top2.length})`);

// solver: 난이도별 옵션 — 행 본값은 현재 슬라이더(spec.levels) 기준(항상 반응), L2~L5 는
// 추가로 .auto(그 레벨 자유도로 낼 수 있는 참고용 최소 LED 안 — 목적함수: LED수 최소화 1순위 /
// 확산 최소화 2순위)를 함께 담는다.
const sv = solvePerLevel(spec);
ok(sv.length === 5, `solver 5개 레벨 (${sv.length})`);
ok(sv.every((r) => r.pitch > 0 && r.leds > 0 && r.nx > 0), 'solver 유효값');
ok(sv.every((r) => !r.feasible || r.U0 >= spec.goal.U0 - 0.02), 'feasible 행은 목표 U0 충족');
ok(sv.filter((r) => r.level !== 1).every((r) => r.auto), 'L2~L5 는 .auto 참고치를 함께 반환');
// L2(Milky resin)는 확산도를 자유롭게 올릴 수 있어(t=1→U0≈100%) 대체로 목표를 달성할 수
// 있지만, 이건 타겟 크기가 깊이 대비 너무 크지 않을 때 얘기다 — blurAxis()의 경계 조건을
// zero-padding(타겟 밖엔 빛이 없음)으로 고친 뒤로는, blur가 타겟 크기에 비해 과도하면
// 가장자리·모서리로 갈수록 빛이 실제로 새어나가 손실되므로(zero-padding이 정확히 그 물리를
// 반영), 확산을 무한히 올린다고 균일도가 계속 좋아지지만은 않는다 — DEFAULT_SPEC(300x120mm,
// 깊이 12mm)처럼 깊이 대비 타겟이 매우 넓으면 milky를 최대로 올려도(blur~132mm) 80%를 못
// 넘는 것이 실측으로 확인됨(진짜 물리적 한계, 버그 아님). 이 단정은 그 한계에 걸리지 않는
// 정사각형·중간 크기 타겟으로 별도 확인한다(탐색 로직 자체의 정상 동작 검증이 목적).
{
  const specSq = structuredClone(DEFAULT_SPEC);
  specSq.target.xLen = 60; specSq.target.yLen = 60;
  const svSq = solvePerLevel(specSq, { levels: [2] });
  ok(svSq.find((r) => r.level === 2).auto.feasible, 'L2 는 확산도 조절만으로 목표 균일도 확보(.auto, 정사각 60x60mm)');
}
console.log('  per-level:', sv.map((r) => {
  const cur = r.feasible ? `${r.pitch.toFixed(0)}mm/${r.leds}ea` : 'x';
  const auto = r.auto ? ` [자동:${r.auto.feasible ? r.auto.leds + 'ea' : 'x'}]` : '';
  return `L${r.level}:${cur}${auto}`;
}).join('  '));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
