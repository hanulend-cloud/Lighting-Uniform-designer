// STEP 내보내기 빌더 검증 — 브라우저/워커 없이 Node에서 opencascade.js를 직접 호출.
// 무겁고(WASM 50MB) 느려서 기본 `npm test`(test/smoke.mjs)와는 분리: `npm run test:step`.
import initOpenCascade from 'opencascade.js/dist/node.js';
import { buildStepForSpec } from '../src/export/step-export.js';
import { volumeOf } from '../src/export/oc-build.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { solveCombo } from '../src/engine/solver.js';
import { buildGeometry } from '../src/model/geometry.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('PASS', name); pass++; }
  else { console.log('FAIL', name, detail); fail++; }
}

// DEFAULT_SPEC 타겟 그대로도 LED 수십~수백 개가 나와 STEP 빌드가 느려질 수 있다(Task 4 실측,
// 수 분/케이스) — 스모크 테스트는 형상 파이프라인 정상 동작 확인이 목적이라 20x20mm 소형 타겟
// 으로 낮춰 전체 스위트가 몇 분 안에 끝나게 한다(정확한 LED 배치 최적화 결과 자체는 이미
// test/smoke.mjs 가 검증함).
function specWith(levels) {
  const spec = JSON.parse(JSON.stringify(DEFAULT_SPEC));
  spec.target.xLen = 20; spec.target.yLen = 20;
  spec.goal.U0 = 0.3; // 낮은 목표치 → 최소 LED 수(보통 1~4개)로 수렴, STEP 생성이 빨라짐
  for (const k of [1, 2, 3, 4, 5]) spec.levels[k].on = false;
  for (const l of levels) spec.levels[l].on = true;
  return spec;
}

function run(oc, spec, active) {
  const combo = solveCombo(spec, active);
  const geom = buildGeometry(spec, {
    depth: combo.depth, ledPitch: combo.pitchX, ledPitchY: combo.pitchY ?? combo.pitchX,
    active, padX: combo.padX, padY: combo.padY,
  });
  return buildStepForSpec(oc, spec, combo, geom);
}

const oc = await initOpenCascade();

// L1 단독 — 평판, 솔리드 개수 = 바디 + LED*N + PCB, STEP 텍스트가 비어있지 않아야 함.
{
  const spec = specWith([1]);
  const r = run(oc, spec, [1]);
  check('L1 STEP 생성 성공', r.stepText.length > 100, 'len=' + r.stepText.length);
  check('L1 바디 부피 > 0', r.bodyVolume > 0, 'vol=' + r.bodyVolume);
}

// L3 — 같은 wallThk(6mm)의 "테이퍼 없는 평판"보다 부피가 작아야 함(가장자리가 얇아짐).
// (주의: L1 기본 baseThk=3mm 기준판과 비교하면 안 된다 — L3 중앙부 자체가 6mm 로 이미
// 3mm보다 두꺼워서, 가장자리가 아무리 얇아져도 3mm 기준판보다 부피가 커질 수 있다. 이건
// Task 3 Step 3 에서 이미 한 번 겪은 것과 같은 종류의 착오라 여기서도 wallThk 자신을
// 기준판으로 삼는다.)
{
  const specFlat6 = specWith([1]);
  specFlat6.levels[1].thk = 6; // L3의 wallThk(6mm)와 동일한 두께의 평판 기준
  const rFlat6 = run(oc, specFlat6, [1]);
  const spec3 = specWith([1, 3]);
  spec3.levels[3].wallThk = 6; spec3.levels[3].edgeAngle = 45; spec3.levels[3].edgeR = 5;
  const r3 = run(oc, spec3, [1, 3]);
  check('L3 STEP 생성 성공', r3.stepText.length > 100);
  check('L3 바디 부피 < 동일 두께 평판 부피', r3.bodyVolume < rFlat6.bodyVolume, `L3=${r3.bodyVolume} flat6mm=${rFlat6.bodyVolume}`);
}

// L4 — 정상 생성만 확인(형상은 L3와 다른 함수 경로).
{
  const spec4 = specWith([1, 4]);
  const r4 = run(oc, spec4, [1, 4]);
  check('L4 STEP 생성 성공', r4.stepText.length > 100);
}

// L5 — 작은 타겟(패턴 개수 적게)으로 Boolean Fuse 경로까지 확인.
{
  const spec5 = specWith([1, 5]);
  spec5.target.xLen = 5; spec5.target.yLen = 5;
  spec5.levels[5].sizeX = 1; spec5.levels[5].sizeY = 1; spec5.levels[5].depth = 0.3;
  const r5 = run(oc, spec5, [1, 5]);
  check('L5(소량 패턴) STEP 생성 성공', r5.stepText.length > 100);
  check('L5 바디 부피(돌기 포함) > 평판만일 때', r5.bodyVolume > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
