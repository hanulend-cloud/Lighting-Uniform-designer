// L3(X·Y 독립 두께 프로필, 자유형상 도파관) 물리·형상 검증 + L4(형상·정밀, 복원) 회귀 방지.
import { levelEffect, l3BotZAt, l4BotZAt, bodyProfile } from '../src/model/levels.js';
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

// ---- L3(신규 축 프로필) ----

// tx0>ty0 이면 X 방향 벌크 블러가 더 커야 한다 — 캡 없는 핵심 메커니즘의 존재 증명.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('tx0>ty0 → blurX>blurY', e.blurX > e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  const ratio = e.blurX / e.blurY;
  check('블러 비율이 두께 비율(6/3=2)과 일치', Math.abs(ratio - 2) < 0.01, `ratio=${ratio}`);
  check('L3 edgeBoost.kind === "axis"', e.edgeBoost.kind === 'axis');
  check('L3 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

// tx0===ty0 이면 대칭이어야 한다(회귀 방지).
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 4, tx50: 3, tx100: 2, ty0: 4, ty50: 3, ty100: 2, edgeR: 0 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('tx0=ty0 → blurX=blurY', Math.abs(e.blurX - e.blurY) < 1e-9, `blurX=${e.blurX} blurY=${e.blurY}`);
}

// L3 edgeBoost가 실제 필드 계산 경로(computeField)에서 크래시 없이 동작하고, 가장자리 근처
// 조도를 기존 최댓값 이상으로 밀어올리지 않는지(캡이 지켜지는지) 확인. boost 유무 두 번 계산해
// 비교해야만 캡이 실제로 걸리는지를 검증할 수 있다.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 5 };
  const eff = levelEffect(spec, 3, spec.space.depth);
  const g = evalGrid(spec, 1.5);
  const commonOpt = {
    depth: spec.space.depth, pitchX: 20, pitchY: 20, nx: g.nx, ny: g.ny,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
  };
  const boosted = computeField(spec, { ...commonOpt, edgeBoost: eff.edgeBoost });
  const unboosted = computeField(spec, { ...commonOpt, edgeBoost: undefined });
  const boostedMax = Math.max(...boosted.field);
  const unboostedMax = Math.max(...unboosted.field);
  check('L3 edgeBoost 적용 후 필드가 유한하고 양수', Number.isFinite(boostedMax) && boostedMax > 0, `max=${boostedMax}`);
  check('L3 edgeBoost가 필드 최댓값을 넘어서지 않음(캡 유지)', boostedMax <= unboostedMax + 1e-9,
    `boostedMax=${boostedMax} unboostedMax=${unboostedMax}`);
}

// l3BotZAt 형상 — 중심/가장자리 두께가 min(Tx,Ty)로 결합되는지 확인.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const X = spec.target.xLen, Y = spec.target.yLen, depth = spec.space.depth;

  const thkCenter = depth - l3BotZAt(spec, depth, X / 2, Y / 2);
  check('중심 두께 = min(tx0,ty0)=3', Math.abs(thkCenter - 3) < 0.01, `thk=${thkCenter}`);

  const thkXEdge = depth - l3BotZAt(spec, depth, 0, Y / 2);
  check('X 가장자리(Y중앙) 두께 = min(tx100=2, ty0=3) = 2', Math.abs(thkXEdge - 2) < 0.01, `thk=${thkXEdge}`);

  const thkYEdge = depth - l3BotZAt(spec, depth, X / 2, 0);
  check('Y 가장자리(X중앙) 두께 = min(tx0=6, ty100=1.5) = 1.5', Math.abs(thkYEdge - 1.5) < 0.01, `thk=${thkYEdge}`);
}

// 모서리R을 켜도(코너 라운드) 두께가 물리적 범위([minThk,maxThk]) 안에서 유한하게 나오는지.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 10 };
  const depth = spec.space.depth;
  const thkCorner = depth - l3BotZAt(spec, depth, 3, 3);
  check('모서리R 근처 두께가 유한하고 [1.5,11] 범위 안', Number.isFinite(thkCorner) && thkCorner >= 1.4 && thkCorner <= 11.1, `thk=${thkCorner}`);
}

// 회귀 방지: tx0≫tx100(큰 낙차)·edgeR이 클 때도 edgeBoost가 타겟 중심(안쪽 절반)까지 번지면
// 안 된다 — 번지면 가장자리 전체가 평평한 캡(최댓값)까지 떠올라 오히려 중심이 가장 어두워
// 보이는 역전(edge-bright/center-dark) 프로파일이 나온다(실측 스펙으로 확인된 회귀). 중심에서는
// boost가 정확히 0이어야 하므로 boosted/unboosted 필드값이 같아야 하고, 그러면서도 가장자리
// 근처에서는 여전히 보정이 살아 있어야(전면 무력화 아님) 한다.
{
  const spec = baseSpec();
  spec.target.xLen = 100; spec.target.yLen = 100;
  spec.levels[3] = { on: true, tx0: 9, tx50: 2, tx100: 1, ty0: 9, ty50: 2, ty100: 1, edgeR: 45 };
  const eff = levelEffect(spec, 3, spec.space.depth);
  const commonOpt = {
    depth: spec.space.depth, pitchX: 25, pitchY: 25, nx: 41, ny: 41,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
  };
  const boosted = computeField(spec, { ...commonOpt, edgeBoost: eff.edgeBoost });
  const unboosted = computeField(spec, { ...commonOpt, edgeBoost: undefined });
  const cx = Math.floor(41 / 2), cy = cx; // step=2.5mm → cx=20 → x=50(정확히 중심)
  const centerIdx = cy * 41 + cx;
  check('중심(안쪽 절반)에서는 edgeBoost=0 (boosted===unboosted)',
    Math.abs(boosted.field[centerIdx] - unboosted.field[centerIdx]) < 1e-9,
    `boosted=${boosted.field[centerIdx]} unboosted=${unboosted.field[centerIdx]}`);
  const edgeIdx = cy * 41 + 0; // x=0 (가장자리)
  check('가장자리에서는 여전히 edgeBoost>0 (전면 무력화 아님)',
    boosted.field[edgeIdx] > unboosted.field[edgeIdx] + 1e-9,
    `boosted=${boosted.field[edgeIdx]} unboosted=${unboosted.field[edgeIdx]}`);
}

// bodyProfile()의 L3 분기가 l3BotZAt(spec,depth,x,Y/2)와 정확히 일치하는지(비정사각 타겟에서
// Y거리도 형상에 영향을 주는지) — 회귀 방지.
{
  const spec = baseSpec();
  spec.target.xLen = 100; spec.target.yLen = 30; // 비정사각: Y/2=15가 tw보다 작을 수 있는 케이스
  spec.levels[3] = { on: true, tx0: 8, tx50: 5, tx100: 1, ty0: 8, ty50: 5, ty100: 1, edgeR: 0 };
  spec.levels[4].on = false;
  const depth = spec.space.depth;
  const prof = bodyProfile(spec, [1, 3], [], depth, 20, 5);
  let allMatch = true;
  for (const p of prof) {
    const expected = l3BotZAt(spec, depth, p.x, spec.target.yLen / 2);
    if (Math.abs(p.botZ - expected) > 1e-9) allMatch = false;
  }
  check('bodyProfile L3 분기 = l3BotZAt(x, Y/2) 일치', allMatch);
}

// ---- L4(형상·정밀, 복원) ----

// rise가 커질수록 blur가 커지는(단조 증가) 기존 경험식이 복원되었는지, edgeBoost를 만들지
// 않는지(형상 캡 로직 미보유) 확인.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 };
  const eBase = levelEffect(spec, 4, spec.space.depth);
  check('L4 blurX>0 (경험식 정상)', eBase.blurX > 0, `blurX=${eBase.blurX}`);
  check('L4 edgeBoost 없음(형상 캡 로직 미보유)', eBase.edgeBoost === undefined);

  const spec2 = baseSpec();
  spec2.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 16, radiusX: 0, radiusY: 0 };
  const eRise = levelEffect(spec2, 4, spec.space.depth);
  check('rise↑ → blur↑ (단조)', eRise.blurX > eBase.blurX, `base=${eBase.blurX} rise16=${eRise.blurX}`);
}

// l4BotZAt 형상 — flat 반경 안쪽은 평평(gap), 밖은 각도만큼 botZ가 커짐(재료가 얇아짐).
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 };
  const depth = spec.space.depth;
  const A = new Set([1, 4]);
  const botZFlat = l4BotZAt(spec, A, depth, 0, 10);
  check('flat 중심(dist=0) botZ = ledTop+gap', Math.abs(botZFlat - (spec.led.sizeZ + 2)) < 1e-9, `botZ=${botZFlat}`);

  const botZFar = l4BotZAt(spec, A, depth, 10, 10);
  check('flat 밖(dist=halfP)에서 botZ가 커짐(재료가 얇아짐)', botZFar > botZFlat, `flat=${botZFlat} far=${botZFar}`);
}

process.exitCode = fail ? 1 : 0;
console.log(`\n${pass} passed, ${fail} failed`);
