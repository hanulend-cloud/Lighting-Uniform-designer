// 자체 solver — 프로젝트.md §3.5
// 균일도 기준 = min/max (최소·최대 광량 위치 비율). 이 값이 목표 이상이 되도록 LED 배치.
// solveSolo / solveCombo 모두 동일한 X·Y 피치 독립 최적화(solveXY)를 사용 — 해상도만 다름.
// (참고용 단독 행과 실제 적용안이 다른 전략을 쓰면 LED 개수·균일도가 서로 달라져 혼동을 준다.)
// solveSolo : 저해상 — 난이도별 행 미리보기용 (5개를 매번 재계산해도 빠르게)
// solveCombo: 고해상 — 실제 적용될 최종안

import { computeField, evalGrid, centeredCount } from './directLit.js';
import { metrics, localGradient } from './uniformity.js';
import { combinedEffect, levelEffect, LEVEL_SCHEMA, extremeDiffusionParams, lerpParams, effectiveEdgeMargin } from '../model/levels.js';

// 판정 격자 셀 크기 상한(mm) — directLit.evalGrid 가 이 값으로 X·Y 해상도를 유도한다.
// 1.5mm 는 실측으로 수렴을 확인한 값(그 아래 1mm 와 결과 차이 ~0.3%p) — 더 굵게 하면(예: 4mm)
// 판정값 자체가 셀 크기에 따라 몇 %p씩 흔들려 신뢰할 수 없다. 대신 연산이 느려짐을 감수한다.
export const GRID = 1.5;
export const GRID_SOLO = 1.5;

function bounds(spec) {
  const ledMin = Math.max(spec.led.sizeX, spec.led.sizeY) + 1;   // 물리적 최소 피치 ≈ LED + 1mm
  return {
    maxD: spec.space.depth,
    target: spec.goal.U0,
    pMin: Math.max(ledMin, spec.opt.pitchMin ?? 1),   // LED 크기가 작을수록 촘촘한 배치 허용 (opt.pitchMin은 보조 하한)
    pMax: spec.opt.pitchMax ?? 60,
    edge: spec.goal.edgeMargin ?? 0.05,
    X: spec.target.xLen, Y: spec.target.yLen,
  };
}

// ok(p) 를 만족하는 최대 p (이진 탐색). lo 에서도 실패하면 lo 반환.
function searchMax(lo, hi, ok, iters = 11) {
  if (!ok(lo)) return { p: lo, feasible: false };
  if (ok(hi)) return { p: hi, feasible: true };
  for (let i = 0; i < iters; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m; else hi = m;
  }
  return { p: lo, feasible: true };
}

function evalField(spec, eff, pX, pY, gridN = GRID, padX = 0, padY = 0) {
  const g = evalGrid(spec, gridN);
  const f = computeField(spec, {
    depth: spec.space.depth, pitchX: pX, pitchY: pY, nx: g.nx, ny: g.ny,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
    decenterX: eff.decenterX ?? 0, decenterY: eff.decenterY ?? 0, edgeBoost: eff.edgeBoost,
    padX, padY,
  });
  // L3(균일두께 용기)가 켜져 있으면 그 보강 폭만큼 판정 마진을 줄여, 보강 효과가 실제로 반영되게 함.
  const edge = effectiveEdgeMargin(spec.goal.edgeMargin ?? 0.05, eff.edgeBoost);
  const m = metrics(f.field, f.nx, f.ny, edge);
  return {
    unif: m.minMax,                                   // 판정 기준 = min/max
    minAvg: m.U0, cv: m.cv,
    grad: localGradient(f.field, f.nx, f.ny, edge),
    leds: f.leds.length, dim: f.dim,
  };
}

// 한 번의 solve 안에서 동일 (pX,pY) 재평가 방지
function memoEval(spec, eff, gridN, padX = 0, padY = 0) {
  const cache = new Map();
  return (pX, pY) => {
    const k = `${pX.toFixed(2)}|${pY == null ? '-' : pY.toFixed(2)}`;
    let v = cache.get(k);
    if (!v) { v = evalField(spec, eff, pX, pY ?? pX, gridN, padX, padY); cache.set(k, v); }
    return v;
  };
}

export function solveSolo(spec, active) {
  const r = solveXY(spec, active, GRID_SOLO);
  return preferReasonableInfeasible(spec, combinedEffect(spec, spec.space.depth, active), r, GRID_SOLO);
}

export function solveCombo(spec, active) {
  const r = solveXY(spec, active, GRID);
  return preferReasonableInfeasible(spec, combinedEffect(spec, spec.space.depth, active), r, GRID);
}

// 목표 미달로 최종 확정된 결과의 대표 피치가 필요 이상으로 촘촘하면(예: 확산이 강해 균일도가
// 피치에 거의 무관한 경우 — 실측: 100×20mm 타겟에서 605개=77.5%, 6개=78.6%로 사실상 동급),
// "LED를 더 넣으면 될 것"이란 잘못된 인상을 준다. 합리적 밀도(N_MIN_LEDS) 피치에서도 다시
// 평가해 균일도가 크게(0.5%p 넘게) 나쁘지 않으면 그 쪽으로 대체한다. solveXY/solveXYAt 내부
// 탐색(autoTuneLevel 의 참고 피치 선정 등)에는 절대 쓰지 않고, 사용자에게 보여줄 "최종 확정
// infeasible" 결과에만 적용한다 — 내부에 섞으면 그 대체값이 다른 탐색의 기준점으로 다시 쓰여
// 전혀 다른(대개 더 나쁜) 결과로 튀는 문제가 실측으로 확인됨(L4/L5 auto 참고치 회귀).
function preferReasonableInfeasible(spec, eff, r, gridN) {
  if (r.feasible) return r;
  const { X, Y, pMin: truePMin, pMax: truePMax } = bounds(spec);
  const densityFloorPMax = Math.min(truePMax, Math.sqrt((X * Y) / N_MIN_LEDS));
  if (!(densityFloorPMax > truePMin && densityFloorPMax > r.pitchX + 0.01)) return r;
  const padX = r.padX ?? 0, padY = r.padY ?? 0;
  const rFloor = evalField(spec, eff, densityFloorPMax, densityFloorPMax, gridN, padX, padY);
  if (rFloor.unif < r.U0 - 0.005) return r;
  return pack(densityFloorPMax, densityFloorPMax, rFloor, X, Y, false, r.target, eff, spec.space.depth, padX, padY);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 합리적 최소 LED 개수 — 이 미만이면(solveXY 참고) 피치 상한을 낮춰 재탐색한다.
const N_MIN_LEDS = 6;

// ---- 기구물 오버행(타겟보다 최대 spec.opt.maxOverhang 만큼 크게) 자동탐색 ----
// 오버행이 크면 가장자리 LED 지원이 늘어 균일도엔 유리하지만, 기구 자체가 커져 LED 수가 늘 수도
// 있어 무조건 유리하지 않다 — 몇 지점을 실제로 계산해 LED 수가 가장 적은(불가능하면 균일도가
// 가장 높은) 오버행을 고른다. X·Y 동일 비율로만 넓힌다(한쪽만 넓히는 비대칭은 다루지 않음).
function solveXY(spec, active, gridN, effOverride, pMaxOverride) {
  const { X, Y } = bounds(spec);
  const maxOv = clamp(spec.opt.maxOverhang ?? 0.10, 0, 1);
  const best = maxOv <= 0 ? solveXYAt(spec, active, gridN, effOverride, 0, 0, pMaxOverride) : (() => {
    let best = null;
    for (const ov of [0, maxOv * 0.5, maxOv]) {
      const r = solveXYAt(spec, active, gridN, effOverride, ov * X / 2, ov * Y / 2, pMaxOverride);
      if (!best) { best = r; continue; }
      if (r.feasible !== best.feasible) { if (r.feasible) best = r; continue; }
      if (r.feasible) { if (r.leds < best.leds) best = r; }
      else if (r.U0 > best.U0) best = r;
    }
    return best;
  })();

  // 확산이 아주 강하면(예: 좁고 긴 타겟 + milky 최대) 균일도가 피치에 거의 무관해져, "LED 개수
  // 최소화" 목적함수가 극단적으로 성긴 해(예: LED 2개)를 그대로 골라버린다 — 수치상 균일도는
  // 만족해도 광원 2~3개에 전적으로 의존해 제조 공차·확산재 편차 여유가 없는 비현실적 설계가
  // 된다(실측: 100×20mm 타겟에서 605개↔2개로 급전환). N_MIN_LEDS 미만으로 나온 "성공" 해만
  // 골라 그 조건에서만 피치 상한(과 오버행 재탐색)을 낮춰 다시 풀어본다 — 정상적으로 이미 충분한
  // LED 수가 나온 케이스(대부분)는 원래 탐색 그대로 두어, 기존 해의 안정성(예: L4 좁은 안전망
  // 스캔 결과)을 건드리지 않는다. 그래도 목표를 못 채우면(성긴 해가 유일한 해) 원래 해를 유지.
  if (!pMaxOverride && best?.feasible && best.leds < N_MIN_LEDS) {
    const densityFloorPMax = Math.sqrt((X * Y) / N_MIN_LEDS);
    if (densityFloorPMax > bounds(spec).pMin) {
      const denser = solveXY(spec, active, gridN, effOverride, densityFloorPMax);
      if (denser?.feasible) return denser;
    }
  }
  return best;
}

// effOverride 를 주면 combinedEffect(spec, active) 대신 그 확산 효과를 그대로 사용
// (레벨 단독 자동탐색이 그 레벨 고유 파라미터로 만든 효과를 넣기 위함). pMaxOverride 를 주면
// bounds(spec)의 피치 상한 대신 그 값을 쓴다(합리적 LED 밀도 하한 재탐색용, solveXY 참고).
function solveXYAt(spec, active, gridN, effOverride, padX, padY, pMaxOverride) {
  const { maxD, target, pMin: truePMin, pMax: boundPMax, X, Y } = bounds(spec);
  const pMax = pMaxOverride != null ? Math.max(truePMin, Math.min(boundPMax, pMaxOverride)) : boundPMax;
  const eff = effOverride ?? combinedEffect(spec, maxD, active);
  const at = memoEval(spec, eff, gridN, padX, padY);

  // 진짜 최소피치(truePMin, LED 크기+1mm)는 작은 타겟에서도 LED 수천 개가 나와 평가가 매우
  // 비싸다. 균일도는 밀도에 단조증가(피치↓→균일도↑, smoke 테스트로 검증됨)하므로, 훨씬 성긴
  // '준-조밀' 피치(pCheck, LED 수 예산으로 제한)에서 이미 목표를 만족하면 truePMin 도 자동으로
  // 만족 — 이 경우 pCheck 를 탐색 하한으로 그대로 써도 정확도 손실 없이 비용만 크게 준다.
  const CHECK_LED_BUDGET = 300;
  const pCheck = Math.min(pMax, Math.max(truePMin, Math.sqrt((X * Y) / CHECK_LED_BUDGET)));
  const pMin = (pCheck > truePMin && at(pCheck, pCheck).unif >= target) ? pCheck : truePMin;

  if (at(pMin, pMin).unif < target) {
    // 안전망: "피치↓→균일도↑" 단조성이 항상 성립하진 않는다 — 좁고 긴 타겟에 blur 가 타겟
    // 폭에 맞먹을 만큼 크면, 오히려 성긴 피치(LED 몇 개)가 촘촘한 피치보다 균일도가 더 높은
    // 경우가 실측으로 확인됐다(예: 100×20mm 타겟, blur~10mm). pMin 이 실패했다고 바로
    // 포기하면 실제로 존재하는 성긴 해를 놓치므로, pMax 부터 몇 지점을 역방향으로 훑어
    // 혹시 성립하는 피치가 있는지 확인한 뒤에만 최종적으로 infeasible 로 결론짓는다.
    const SCAN = 8;
    for (let k = 0; k < SCAN; k++) {
      const p = pMax - (pMax - pMin) * (k / (SCAN - 1));   // pMax → pMin 방향으로 스캔
      const r = at(p, p);
      if (r.unif >= target) return pack(p, p, r, X, Y, true, target, eff, maxD, padX, padY);
    }
    return pack(pMin, pMin, at(pMin, pMin), X, Y, false, target, eff, maxD, padX, padY);
  }

  // 근사 정사각(±5%) 타겟 + 등방 혼합 → 필드가 X/Y 대칭 → pX == pY 가 최적
  const squareSym = Math.abs(X - Y) / Math.max(X, Y) < 0.05
    && Math.abs(eff.blurX - eff.blurY) < 1e-6;

  // 등방 시작점 + 등방 후보(항상 계산 — 비등방 하강이 더 나쁜 지역해에 빠질 때의 안전망)
  const iso = searchMax(pMin, pMax, (p) => at(p, p).unif >= target, 11).p;
  let pIso = Math.max(pMin, Math.floor(iso));
  let rIso = at(pIso, pIso), gIso = 0;
  while (rIso.unif < target && pIso > pMin && gIso++ < 40) { pIso -= 1; rIso = at(pIso, pIso); }
  const isoCand = pack(pIso, pIso, rIso, X, Y, rIso.unif >= target, target, eff, maxD, padX, padY);

  if (squareSym) return isoCand;

  // 좌표 하강: iso 에서 X·Y 를 번갈아 확장 (면적 min/max ≥ 목표 유지, pX·pY 곱 최대화)
  let pX = iso, pY = iso;
  for (let round = 0; round < 2; round++) {
    const nX = searchMax(pMin, pMax, (p) => at(p, pY).unif >= target, 8).p;
    const nY = searchMax(pMin, pMax, (p) => at(nX, p).unif >= target, 8).p;
    if (Math.abs(nX - pX) < 0.5 && Math.abs(nY - pY) < 0.5) { pX = nX; pY = nY; break; }
    pX = nX; pY = nY;
  }

  // 정수 확정 + 목표 '이상' 보장 — 혼합폭이 작은(리플이 큰) 축 = 병목 → 그 축부터 1mm 축소
  let iX = Math.max(pMin, Math.floor(pX));
  let iY = Math.max(pMin, Math.floor(pY));
  const tightenX = eff.blurX <= eff.blurY;   // 혼합폭 작은 축을 먼저 조인다
  let r = at(iX, iY), guard = 0;
  while (r.unif < target && guard++ < 80) {
    const canX = iX > pMin, canY = iY > pMin;
    if (!canX && !canY) break;
    if (canX && (!canY || tightenX)) iX -= 1; else iY -= 1;
    r = at(iX, iY);
  }

  const descCand = pack(iX, iY, r, X, Y, r.unif >= target, target, eff, maxD, padX, padY);

  // 좌표 하강이 등방 후보보다 못하면(지역해) 등방 후보 채택 — LED 수가 적은 쪽 선택
  if (!descCand.feasible) return isoCand.feasible ? isoCand : descCand;
  if (!isoCand.feasible) return descCand;
  return descCand.leds <= isoCand.leds ? descCand : isoCand;
}

// 각 난이도 단독 (행). 슬라이더에 입력된 현재 파라미터 기준 결과가 진실(항상 반응) —
// L2~L5 에는 추가로 '그 레벨 자유도로 낼 수 있는 참고용 최소 LED 안'(.auto)을 함께 담는다.
// (목적함수: LED 개수 최소화 1순위 / 확산 최소화 2순위. 적용은 사용자가 '적용' 버튼으로 직접.)
// L1(평판 두께)은 광학식에 파라미터가 관여하지 않아(levelEffect case 1) 자동탐색 대상에서 제외.
export function solvePerLevel(spec, opt = {}) {
  const levels = opt.levels ?? spec.opt.difficultyLevels ?? [1, 2, 3, 4, 5];
  return levels.map((level) => {
    const cur = { level, ...solveSolo(spec, [level]) };
    if (level !== 1 && LEVEL_SCHEMA[level]) cur.auto = autoTuneLevel(spec, level);
    return cur;
  });
}

// 그 레벨 고유 파라미터의 자유도 안에서 목표를 만족하는 최소 LED 해 — 참고치.
function autoTuneLevel(spec, level) {
  const b = bounds(spec);
  const depth = spec.space.depth;
  const maxEx = extremeDiffusionParams(level, depth, 'max');
  const minEx = extremeDiffusionParams(level, depth, 'min');
  let maxParams = maxEx.params, maxEffect = maxEx.effect;

  // 1단계: "확산을 최대로 밀수록 LED가 가장 적게 든다"는 가정이 실측(L2 milky, L3 도파관 모두)
  // 으로 깨지는 경우가 확인됨 — 과도한 확산은 (경계 밖으로 새는 빛이 늘어) 오히려 균일도를
  // 악화시킬 수 있다. solveXY(피치 탐색까지 포함)를 여러 지점마다 돌리면 너무 느려지므로
  // (실측: 9회 반복 시 스모크 테스트가 7분대로 느려짐), 먼저 최대 확산으로 solveXY 1회를
  // 돌려 "그 피치"를 기준점으로 삼고, 그 피치에서 값싼 evalField로 다른 확산 지점들도 훑어본다
  // (기준 피치를 최소 피치로 잡으면 안 됨 — 최소 피치에서는 어차피 LED가 촘촘해 확산의 이득이
  // 거의 안 보여서 "확산이 항상 손해"로 잘못 결론 나는 걸 실측으로 확인함). 더 나은 지점을
  // 찾으면 그 지점으로 solveXY를 다시 한 번만 더 돌린다 — 최악의 경우도 solveXY 2회로 끝남.
  let rMax = solveXY(spec, [level], GRID_SOLO, maxEffect);
  {
    const refP = rMax.pitchX, refPY = rMax.pitchY ?? rMax.pitchX;
    const refPadX = rMax.padX ?? 0, refPadY = rMax.padY ?? 0;
    const cheapUnifAt = (t) => {
      const p = t === 1 ? maxParams : lerpParams(level, minEx.params, maxParams, t);
      const e = t === 1 ? maxEffect : levelEffect({ levels: { [level]: p } }, level, depth);
      return evalField(spec, e, refP, refPY, GRID_SOLO, refPadX, refPadY).unif;
    };
    const N_SAMPLES = 5;
    let bestT = 1, bestCheapU = cheapUnifAt(1);
    for (let i = 0; i < N_SAMPLES - 1; i++) {
      const t = i / (N_SAMPLES - 1);
      const u = cheapUnifAt(t);
      if (u > bestCheapU) { bestCheapU = u; bestT = t; }
    }
    if (bestT !== 1) {
      const cand = lerpParams(level, minEx.params, maxParams, bestT);
      const candEffect = levelEffect({ levels: { [level]: cand } }, level, depth);
      const rCand = solveXY(spec, [level], GRID_SOLO, candEffect);
      if (rCand.feasible !== rMax.feasible ? rCand.feasible : (rCand.feasible ? rCand.leds < rMax.leds : rCand.U0 > rMax.U0)) {
        rMax = rCand; maxParams = cand; maxEffect = candEffect;
      }
    }
  }

  // L3처럼 위치 의존 edgeBoost 가 있는 레벨은 extremeDiffusionParams 의 mag() 프록시(수식만으로
  // 계산하는 근사치)가 실제 균일도와 어긋날 수 있다 — 테이퍼 폭(tw)과 보정 세기(boostMax)가
  // edgeAngle 에 대해 반대 방향으로 움직여, 진짜 최적 각도가 위 t-샘플(min↔max 직선 보간)에는
  // 없는 조합(예: 두께는 최대인데 각도는 중간)에 있는 경우가 실측으로 확인됨. 위 1단계 최선이
  // infeasible 이면, 그 지점에서 실제 evalField 로 스키마 후보값들을 다시 훑어(좌표하강) 더
  // 나은 조합이 있는지 확인한다.
  if (!rMax.feasible && maxEffect.edgeBoost) {
    const truePMin = bounds(spec).pMin;
    const schema = LEVEL_SCHEMA[level];
    const realUnif = (p) => evalField(spec, levelEffect({ levels: { [level]: p } }, level, depth), truePMin, truePMin, GRID_SOLO, 0, 0).unif;
    let bp = { ...maxParams }, bestU = realUnif(bp);
    for (let round = 0; round < 2; round++) {
      for (const f of schema.fields) {
        if (f.fixed) continue;
        const candidates = f.type === 'select' ? f.options
          : [f.min, f.max, ...Array.from({ length: 7 }, (_, i) => f.min + (f.max - f.min) * (i + 1) / 8)];
        for (const v of candidates) {
          const cand = { ...bp, [f.key]: v };
          const u = realUnif(cand);
          if (u > bestU) { bestU = u; bp = cand; }
        }
      }
    }
    if (bestU > realUnif(maxParams)) {
      const refinedEffect = levelEffect({ levels: { [level]: bp } }, level, depth);
      const rRefined = solveXY(spec, [level], GRID_SOLO, refinedEffect);
      if (rRefined.feasible || rRefined.U0 > rMax.U0) { rMax = rRefined; maxParams = bp; maxEffect = refinedEffect; }
    }
  }

  if (!rMax.feasible) {
    const rr = preferReasonableInfeasible(spec, maxEffect, rMax, GRID_SOLO);
    return {
      feasible: false, pitch: rr.pitch, leds: rr.leds, U0: rr.U0, params: maxParams,
      transmit: maxEffect.transmit, overhang: rr.overhang, fixtureX: rr.fixtureX, fixtureY: rr.fixtureY,
    };
  }

  // 2단계: 그 피치·오버행(=LED 개수)을 고정한 채, 그 지점에서만 필요한 최소 확산을 이진탐색으로
  // 찾는다(다시 탐색할 필요가 없으므로 solveXY 대신 단일 evalField 로 충분히 가볍다). minEx는
  // 1단계에서 이미 구해둔 것을 그대로 쓴다.
  const pX = rMax.pitchX, pY = rMax.pitchY ?? rMax.pitchX;
  const padX = rMax.padX ?? 0, padY = rMax.padY ?? 0;
  const unifAt = (t) => evalField(spec, effectAt(level, depth, minEx.params, maxParams, t), pX, pY, GRID_SOLO, padX, padY).unif;

  let lo = 0, hi = 1;
  if (unifAt(0) >= b.target) hi = 0;
  else {
    for (let i = 0; i < 10; i++) {
      const m = (lo + hi) / 2;
      if (unifAt(m) >= b.target) hi = m; else lo = m;
    }
  }

  const finalParams = lerpParams(level, minEx.params, maxParams, hi);
  const finalEff = effectAt(level, depth, minEx.params, maxParams, hi);
  const r = evalField(spec, finalEff, pX, pY, GRID_SOLO, padX, padY);
  const packed = pack(pX, pY, r, b.X, b.Y, r.unif >= b.target, b.target, finalEff, depth, padX, padY);
  return {
    feasible: packed.feasible, pitch: packed.pitch, leds: packed.leds, U0: packed.U0,
    params: finalParams, transmit: packed.transmit, overhang: packed.overhang,
    fixtureX: packed.fixtureX, fixtureY: packed.fixtureY,
  };
}

function effectAt(level, depth, minParams, maxParams, t) {
  return levelEffect({ levels: { [level]: lerpParams(level, minParams, maxParams, t) } }, level, depth);
}

function pack(pX, pY, r, X, Y, feasible, target, eff, depth, padX = 0, padY = 0) {
  const nx = centeredCount(X, pX, padX);
  const ny = centeredCount(Y, pY ?? pX, padY);
  return {
    pitchX: pX, pitchY: ny === 1 ? null : pY, pitch: pX, depth,
    leds: nx * ny, nx, ny, dim: ny === 1 ? '1D' : '2D', feasible, target,
    U0: r.unif, minAvg: r.minAvg, cv: r.cv, grad: r.grad,   // U0 필드 = min/max (표시 균일도)
    blurX: eff.blurX, blurY: eff.blurY, transmit: eff.transmit,
    padX, padY, fixtureX: X + 2 * padX, fixtureY: Y + 2 * padY,
    overhang: X > 0 ? (2 * padX) / X : 0,
  };
}
