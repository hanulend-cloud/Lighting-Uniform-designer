// 새 L4(X·Y 독립 두께 프로필) 물리·형상 검증 + L3 리팩터 회귀 방지.
import { levelEffect, l4BotZAt, bodyProfile, l3BotZAt } from '../src/model/levels.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { computeField, evalGrid } from '../src/engine/directLit.js';

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

// L4 edgeBoost가 실제 필드 계산 경로(computeField)에서 크래시 없이 동작하고, 가장자리 근처
// 조도를 기존 최댓값 이상으로 밀어올리지 않는지(캡이 지켜지는지) 확인. boost 유무 두 번 계산해
// 비교해야만 캡이 실제로 걸리는지(applyAxisEdgeBoost의 min(maxF,...))를 검증할 수 있다 —
// 단일 호출의 유한·양수 체크만으로는 캡 로직을 통째로 지워도 통과해버린다.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 5 };
  const eff = levelEffect(spec, 4, spec.space.depth);
  const g = evalGrid(spec, 1.5);
  const commonOpt = {
    depth: spec.space.depth, pitchX: 20, pitchY: 20, nx: g.nx, ny: g.ny,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
  };
  const boosted = computeField(spec, { ...commonOpt, edgeBoost: eff.edgeBoost });
  const unboosted = computeField(spec, { ...commonOpt, edgeBoost: undefined });
  const boostedMax = Math.max(...boosted.field);
  const unboostedMax = Math.max(...unboosted.field);
  check('L4 edgeBoost 적용 후 필드가 유한하고 양수', Number.isFinite(boostedMax) && boostedMax > 0, `max=${boostedMax}`);
  check('L4 edgeBoost가 필드 최댓값을 넘어서지 않음(캡 유지)', boostedMax <= unboostedMax + 1e-9,
    `boostedMax=${boostedMax} unboostedMax=${unboostedMax}`);
}

// l4BotZAt 형상 — 중심/가장자리 두께가 min(Tx,Ty)로 결합되는지 확인.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const X = spec.target.xLen, Y = spec.target.yLen, depth = spec.space.depth;

  const thkCenter = depth - l4BotZAt(spec, depth, X / 2, Y / 2);
  check('중심 두께 = min(tx0,ty0)=3', Math.abs(thkCenter - 3) < 0.01, `thk=${thkCenter}`);

  const thkXEdge = depth - l4BotZAt(spec, depth, 0, Y / 2);
  check('X 가장자리(Y중앙) 두께 = min(tx100=2, ty0=3) = 2', Math.abs(thkXEdge - 2) < 0.01, `thk=${thkXEdge}`);

  const thkYEdge = depth - l4BotZAt(spec, depth, X / 2, 0);
  check('Y 가장자리(X중앙) 두께 = min(tx0=6, ty100=1.5) = 1.5', Math.abs(thkYEdge - 1.5) < 0.01, `thk=${thkYEdge}`);
}

// 모서리R을 켜도(코너 라운드) 두께가 물리적 범위([minThk,maxThk]) 안에서 유한하게 나오는지.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 10 };
  const depth = spec.space.depth;
  const thkCorner = depth - l4BotZAt(spec, depth, 3, 3);
  check('모서리R 근처 두께가 유한하고 [1.5,11] 범위 안', Number.isFinite(thkCorner) && thkCorner >= 1.4 && thkCorner <= 11.1, `thk=${thkCorner}`);
}

// bodyProfile()의 L3 분기가 l3BotZAt(spec,depth,x,Y/2)와 정확히 일치하는지 (비정사각 타겟에서
// Y거리도 테이퍼에 영향을 주는 새 동작을 고정) — 회귀 방지.
{
  const spec = baseSpec();
  spec.target.xLen = 100; spec.target.yLen = 30; // 비정사각: Y/2=15가 tw보다 작을 수 있는 케이스
  spec.levels[3] = { on: true, wallThk: 8, edgeAngle: 30, edgeR: 0 };
  spec.levels[4].on = false;
  const depth = spec.space.depth;
  const prof = bodyProfile(spec, [1, 3], depth, 5);
  let allMatch = true;
  for (const p of prof) {
    const expected = l3BotZAt(spec, depth, p.x, spec.target.yLen / 2);
    if (Math.abs(p.botZ - expected) > 1e-9) allMatch = false;
  }
  check('bodyProfile L3 분기 = l3BotZAt(x, Y/2) 일치', allMatch);
}

process.exitCode = fail ? 1 : 0;
console.log(`\n${pass} passed, ${fail} failed`);
