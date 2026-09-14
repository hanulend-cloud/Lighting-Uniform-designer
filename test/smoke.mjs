// 엔진 스모크 테스트 (브라우저 불필요): node test/smoke.mjs
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { computeField } from '../src/engine/directLit.js';
import { metrics, localGradient } from '../src/engine/uniformity.js';
import { optimize } from '../src/engine/optimizer.js';
import { solvePerLevel, solveSolo } from '../src/engine/solver.js';

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
ok(sv.every((r) => !r.feasible || r.U0c >= spec.goal.U0 - 0.02), 'feasible 행은 중심부 목표 U0 충족');
ok(sv.filter((r) => r.level !== 1).every((r) => r.auto), 'L2~L5 는 .auto 참고치를 함께 반환');
// L2(Milky resin) 확산은 후방산란→기판 반사 재순환(levelEffect case 2)이라 blur 가 깊이 수준
// 까지만 커진다. 확산(blur)은 LED 사이 리플만 없앨 뿐 가장자리 falloff 를 들어올리진 못하고,
// 측벽은 투명 수지의 프레넬 반사(수직입사 5%, 스침각에서만 큼)뿐이라 가장자리 보강도 제한적
// — 그래서 L2 단독으로 목표를 못 미치는 조건이 흔하며 이는 물리적으로 맞다(예전 공식
// blur=11×depth 는 배열 전체를 거대 봉우리로 뭉개 이 효과를 가렸음). 탐색 로직 자체의 정상
// 동작은 달성 가능한 조건(정사각 60x60mm, 깊이 12mm)으로 검증한다.
// 판정은 베젤 마진 5% 를 명시: 타겟 전체 판정(기본 마진 0)에서는 기구 크기 제한(타겟 대비
// +10% → 각 변 3mm)이 깊이 12mm 에 한참 못 미쳐 어느 깊이에서도 물리적으로 미달이라(실측:
// 깊이 4/6/8mm 모두 U0 63~72%) 탐색 로직이 아니라 제약을 검사하는 셈이 되기 때문.
{
  const specSq = structuredClone(DEFAULT_SPEC);
  specSq.target.xLen = 60; specSq.target.yLen = 60; specSq.goal.edgeMargin = 0.05;
  const svSq = solvePerLevel(specSq, { levels: [2] });
  ok(svSq.find((r) => r.level === 2).auto.feasible, 'L2 는 확산도 조절만으로 목표 균일도 확보(.auto, 정사각 60x60mm)');
}
// 좁은 스트립(100x20mm, LED 1mm, milky 최대): 깊이가 얕을수록 확산(∝깊이)이 약해져 LED 가
// 점진적으로 늘어나야 한다 — 특정 깊이에서 605개↔2개로 급전환되던 회귀 방지. 목표 미달이어도
// 대표 LED 수(무릎점)는 같은 추세를 따라야 한다.
{
  const strip = structuredClone(DEFAULT_SPEC);
  strip.target.xLen = 100; strip.target.yLen = 20; strip.goal.U0 = 0.85;
  strip.goal.edgeMargin = 0.05;   // 위 60x60 과 같은 이유(Y 캡 1mm) — 추세 검증은 베젤 마진 판정으로
  strip.led.sizeX = 1; strip.led.sizeY = 1;
  strip.levels[2] = { on: true, milky: 10, decenterX: 0, decenterY: 0 };
  const byDepth = [4, 6, 8].map((d) => { const s = structuredClone(strip); s.space.depth = d; return solveSolo(s, [2]); });
  console.log('  L2 스트립 깊이 4/6/8mm:', byDepth.map((r) => `${r.leds}ea/${(r.U0 * 100).toFixed(0)}%${r.feasible ? '' : '(미달)'}`).join('  '));
  ok(byDepth.every((r) => r.pitch > 2.5), 'L2 스트립: 어느 깊이에서도 최소 피치(2mm, 605개)로 튀지 않음');
  ok(byDepth[0].leds >= byDepth[1].leds && byDepth[1].leds >= byDepth[2].leds, 'L2 스트립: 깊이↓ → LED 개수 단조 증가');
}
console.log('  per-level:', sv.map((r) => {
  const cur = r.feasible ? `${r.pitch.toFixed(0)}mm/${r.leds}ea` : 'x';
  const auto = r.auto ? ` [자동:${r.auto.feasible ? r.auto.leds + 'ea' : 'x'}]` : '';
  return `L${r.level}:${cur}${auto}`;
}).join('  '));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
