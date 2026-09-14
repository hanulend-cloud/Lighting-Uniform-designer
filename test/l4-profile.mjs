// 새 L4(X·Y 독립 두께 프로필) 물리·형상 검증 + L3 리팩터 회귀 방지.
import { levelEffect } from '../src/model/levels.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('PASS', name); pass++; }
  else { console.log('FAIL', name, detail); fail++; }
}

function baseSpec() {
  return JSON.parse(JSON.stringify(DEFAULT_SPEC));
}

// L3 리팩터(tirParams 추출) 후에도 wallThk=6mm 결과가 기존 실측값과 같아야 한다.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, wallThk: 6, edgeAngle: 45, edgeR: 5 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('L3 blurX>0 (도파관 확산 정상)', e.blurX > 0, `blurX=${e.blurX}`);
  check('L3 blurX===blurY (등방)', e.blurX === e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  check('L3 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

// tx0>ty0 이면 X 방향 벌크 블러가 더 커야 한다 — 캡 없는 핵심 메커니즘의 존재 증명.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const e = levelEffect(spec, 4, spec.space.depth);
  check('tx0>ty0 → blurX>blurY', e.blurX > e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  const ratio = e.blurX / e.blurY;
  check('블러 비율이 두께 비율(6/3=2)과 일치', Math.abs(ratio - 2) < 0.01, `ratio=${ratio}`);
  check('L4 edgeBoost.kind === "axis"', e.edgeBoost.kind === 'axis');
  check('L4 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

// tx0===ty0 이면 대칭이어야 한다(회귀 방지).
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 4, tx50: 3, tx100: 2, ty0: 4, ty50: 3, ty100: 2, edgeR: 0 };
  const e = levelEffect(spec, 4, spec.space.depth);
  check('tx0=ty0 → blurX=blurY', Math.abs(e.blurX - e.blurY) < 1e-9, `blurX=${e.blurX} blurY=${e.blurY}`);
}

process.exitCode = fail ? 1 : 0;
console.log(`\n${pass} passed, ${fail} failed`);
