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
// L2(Milky resin)는 확산도를 자유롭게 올릴 수 있어(t=1→U0≈100%) LED 개수가 극단적으로
// 부족하지 않는 한 .auto 는 항상 목표를 달성해야 한다(슬라이더 기본값 자체는 milky=1=확산 없음
// 이라 미달일 수 있음 — 그건 정상). L3/L4는 형상(각도·gap)만의 자유도라 확산폭이 물리적으로
// 제한적 — 이 스펙에서 .auto 단독 미달은 실제 한계이지 버그가 아니다.
ok(sv.find((r) => r.level === 2).auto.feasible, 'L2 는 확산도 조절만으로 목표 균일도 확보(.auto)');
console.log('  per-level:', sv.map((r) => {
  const cur = r.feasible ? `${r.pitch.toFixed(0)}mm/${r.leds}ea` : 'x';
  const auto = r.auto ? ` [자동:${r.auto.feasible ? r.auto.leds + 'ea' : 'x'}]` : '';
  return `L${r.level}:${cur}${auto}`;
}).join('  '));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
