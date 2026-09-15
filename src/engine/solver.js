// 자체 solver — 프로젝트.md §3.5
// 균일도 기준 = min/max (최소·최대 광량 위치 비율). 이 값이 목표 이상이 되도록 LED 배치.
// solveSolo / solveCombo 모두 동일한 X·Y 피치 독립 최적화(solveXY)를 사용 — 해상도만 다름.
// (참고용 단독 행과 실제 적용안이 다른 전략을 쓰면 LED 개수·균일도가 서로 달라져 혼동을 준다.)
// solveSolo : 저해상 — 난이도별 행 미리보기용 (5개를 매번 재계산해도 빠르게)
// solveCombo: 고해상 — 실제 적용될 최종안

import { computeField, computeCameraLuminance, evalGrid, ledCounts } from './directLit.js';
import { metrics, localGradient, centerMetrics, centerZoneFrac, RIM_TOL } from './uniformity.js';
import { combinedEffect, levelEffect, levelParams, LEVEL_SCHEMA, extremeDiffusionParams, lerpParams, effectiveEdgeMargin } from '../model/levels.js';

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
    edge: spec.goal.edgeMargin ?? 0,
    X: spec.target.xLen, Y: spec.target.yLen,
  };
}

// ok(p) 를 만족하는 "가장 성긴" p 찾기 — ok 가 p 에 단조가 아닐 때를 위한 탐색기.
// 끝 고정 LED 배치(directLit.anchoredAxis)에서 균일도는 피치≈깊이 근처에서 최고이고 그보다
// 촘촘해져도 가장자리 한계(경계 밖에 LED 가 없는 반평면 효과)로 다시 내려간다 — 즉 feasible
// 집합은 대개 하나의 구간 [pLo, pHi]. 성긴 쪽(pHi 위)은 리플이 줄어드는 단조 구간이므로
// "feasible 한 점 하나"와 "그보다 성긴 infeasible 점" 사이만 이진탐색하면 pHi 가 나온다.
// seed(≈깊이)에서 먼저 시험해 feasible 이면 위로 넓혀 가고, 아니면 pMax 부터 로그 간격으로
// 내려가며 첫 feasible 을 찾는다(예전 이진탐색은 단조 가정이라 이 구간을 통째로 놓쳤다 —
// 실측: 100×20 깊이 5 에서 p=6 이 86% 인데 61% 로 결론).
// 아래로 훑는 하한 = 깊이의 절반: LED 간격이 깊이보다 좁아지면 배열은 이미 연속 발광면과 같아
// (리플 ~e^{-2π·od/p}) 더 촘촘히 해도 리플은 안 줄고 가장자리(경계 밖 LED 없음의 반평면 한계)만
// 남는다 — 즉 균일도는 그 아래에서 내려가기만 하므로 더 훑어도 feasible 이 나올 수 없고, 촘촘한
// 평가는 비용만 크다(실측: 피치 6mm 1회 0.8s vs 15mm 0.2s).
// 결과에는 훑은 점들 중 "균일도 최고" 지점(bestP/bestU)도 함께 담는다 — 목표 미달일 때 대표안은
// 최소 피치가 아니라 목표에 가장 가까운 배치여야 하기 때문.
// 판정 등급(rank): 1 = 중심부(타겟 면적의 중심 95%, goal.centerArea) min/max ≥ 목표, 0 = 미달.
// 타겟 전체 min/max(unif, fullPass)와 테두리 초과 밝기(rimBright)는 참고값으로만 보고한다.
// 등급 1 인 배치 중 LED 가 가장 적은 것(같으면 전체 균일도가 높은 것)을 고른다 — "중심부가 목표를
// 만족하는 최소 LED 수" = 가장자리 LED 부터 빼는 원칙. 등급 1 이 없으면 중심부 균일도 최고 배치.
// LED 수 하한(N_MIN_LEDS)도 판정에 포함: 확산이 아주 강하면 LED 2~3개도 수치상 목표를 넘기지만
// 광원 몇 개에 전적으로 의존하는 설계는 공차 여유가 없어 비현실적. 예전엔 결과가 6개 미만일 때
// 피치 상한을 낮춰 재탐색했는데, 상한이 X·Y 양축에 같이 걸려 "1열 + X 만 촘촘"이라는 위상을
// 못 만들고(2열이 강제됨) 재탐색이 실패해 3개짜리 답이 그대로 나오는 문제가 실측(100×10 L5)됨.
// 다만 강확산(예: L5 최대)에서는 LED 를 늘릴수록 오히려 균일도가 내려가(경계 밖 LED 없음의 반평면
// 한계로 가장자리만 어두워짐 — 실측 100×10: 4개 75.8% → 6개 75.0%) 6개 이상으로는 목표를 못 채우는
// 경우가 있다. 그때는 하한 미만 배치를 "달성(하한 미만)"으로 보고한다: 등급 2 = 달성+하한 충족,
// 1 = 달성이지만 LED 수 하한 미만(belowMinLeds), 0 = 미달. 탐색은 등급 2 를 먼저 찾는다.
export const rankOf = (r, target) => (r.unifC >= target ? (r.leds >= N_MIN_LEDS ? 2 : 1) : 0);
// 훑기 순서는 항상 "성긴 쪽(pMax)부터 아래로": feasible 집합이 하나의 구간이 아니라 여러 섬으로
// 갈라질 수 있기 때문 — 열 수(위상)가 바뀌는 경계에서 균일도가 불연속이라, 예컨대 좁은 타겟에서
// "1열(성김) 가능 / 2열 불가 / 3열 가능"처럼 된다(실측: 100×10 깊이 7, L5 강확산). seed 근처에서
// 위로만 넓히면 seed 가 속한 섬(3열) 안에 갇혀 더 성긴 1열 섬을 놓친다. seed 위쪽은 성긴 배치라
// 평가가 싸므로(LED 수 ∝ 1/p²) 거친 간격(SCAN_COARSE)으로 훑고, seed 아래는 촘촘한 간격으로.
const SCAN_STEP = 1.15;
const SCAN_COARSE = 1.3;
const BISECT_TOL = 0.25;
function searchSparsest(evalAt, target, pMin, pMax, seed, need = 2, iters = 8) {
  let bestP = null, bestKey = -Infinity, bestRank = 0;
  const ok = (p) => {
    const r = evalAt(p), rk = rankOf(r, target);
    const key = rk * 10 + (rk >= 1 ? r.unif : r.unifC);   // 등급 우선, 같은 등급이면 균일도 최고(통과 시 전체, 미달 시 중심부)
    if (key > bestKey || (key === bestKey && p > bestP)) { bestKey = key; bestP = p; bestRank = rk; }
    return rk >= need;
  };
  // 이진탐색은 구간폭이 BISECT_TOL(mm) 아래로 좁아지면 멈춘다 — 최종 피치는 정수로 내림하므로 그 이상 정밀도는 낭비
  const bisect = (lo, hi) => { for (let i = 0; i < iters && hi - lo > BISECT_TOL; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } return lo; };
  const done = (p, feasible) => ({ p, feasible, bestP, bestRank });
  if (ok(pMax)) return done(pMax, true);
  const s0 = clamp(seed ?? pMin, pMin, pMax);
  let hiInf = pMax;
  for (let p = pMax / SCAN_COARSE; p > s0 * (1 + 1e-9); p /= SCAN_COARSE) {   // seed 위: 거친 간격
    if (ok(p)) return done(bisect(p, hiInf), true);
    hiInf = p;
  }
  if (ok(s0)) return done(bisect(s0, hiInf), true);
  hiInf = s0;
  const pFloor = Math.max(pMin, s0 / 2);
  for (let p = s0 / SCAN_STEP; p > pFloor * (1 + 1e-9); p /= SCAN_STEP) {     // seed 아래: 촘촘한 간격
    if (ok(p)) return done(bisect(p, hiInf), true);
    hiInf = p;
  }
  if (pFloor < s0 && ok(pFloor)) return done(bisect(pFloor, hiInf), true);
  return done(bestP, false);
}

// 판정 기준(spec.goal.metric)이 'lumin'(휘도)이면: 확산재가 있는 조합(blur>0)은 램버시안 근사로
// 휘도 ∝ 조도(L=E/π, 각도 무관, directLit.computeCameraLuminance 주석 참고)라 조도장을 그대로
// 써도 균일도 수치(비율)가 완전히 같다 — 그래서 이 경우엔 계산량이 훨씬 싼 computeField 를 그대로
// 쓴다. 확산재가 없는 조합(blur=0, 예: L1만 또는 L3/L4 형상만)은 그 반대로, 휘도가 조도와 근본적으로
// 다른 물리량(직접 시야 — LED 칩 이미지)이라 실제로 computeCameraLuminance 를 평가해야 한다 —
// 그 경우 "구조(피치·깊이)만으로 휘도 균일도를 확보"하는 게 물리적으로 거의 불가능함을(칩 크기
// 스케일까지 촘촘해지지 않는 한) 탐색이 정직하게 보여준다(= 확산재가 필요하다는 결론).
// coneDeg 는 히트맵 기본값과 맞춘 고정값 — 판정용이라 과도한 자유도를 늘리지 않는다.
const LUMIN_CONE_DEG = 10;
function evalField(spec, eff, pX, pY, gridN = GRID, padX = 0, padY = 0) {
  const g = evalGrid(spec, gridN);
  const usingCamera = spec.goal.metric === 'lumin' && !((eff.blurX ?? 0) > 0 || (eff.blurY ?? 0) > 0);
  const f = usingCamera
    ? computeCameraLuminance(spec, {
        depth: spec.space.depth, pitchX: pX, pitchY: pY, nx: g.nx, ny: g.ny,
        transmit: eff.transmit, decenterX: eff.decenterX ?? 0, decenterY: eff.decenterY ?? 0,
        padX, padY, coneDeg: LUMIN_CONE_DEG,
      })
    : computeField(spec, {
        depth: spec.space.depth, pitchX: pX, pitchY: pY, nx: g.nx, ny: g.ny,
        blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
        decenterX: eff.decenterX ?? 0, decenterY: eff.decenterY ?? 0, edgeBoost: eff.edgeBoost,
        padX, padY,
      });
  // L3(균일두께 용기)가 켜져 있으면 그 보강 폭만큼 판정 마진을 줄여, 보강 효과가 실제로 반영되게 함.
  // computeCameraLuminance 는 edgeBoost 를 반영하지 않으므로(범위 밖, directLit.js 주석 참고) 그
  // 경로에선 마진을 깎지 않는다 — 안 그러면 실제로는 없는 보강 효과가 있다고 가정하게 된다.
  const edge = usingCamera ? (spec.goal.edgeMargin ?? 0) : effectiveEdgeMargin(spec.goal.edgeMargin ?? 0, eff.edgeBoost);
  const m = metrics(f.field, f.nx, f.ny, edge);
  // 중심부(타겟 면적의 중심 centerArea; 베젤 마진이 더 크면 그것) — 1차 판정 기준
  const cz = centerZoneFrac(spec.goal.centerArea ?? 0.95);
  const cm = centerMetrics(f.field, f.nx, f.ny, Math.max(cz.fx, edge), Math.max(cz.fy, edge));
  return {
    unif: m.minMax,                                   // 타겟 전체 min/max (참고)
    unifC: cm.minMax, rimBright: cm.rimBright,        // 중심부 min/max, 테두리 초과 밝기
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

// 목표 미달로 최종 확정된 결과의 대표 피치는 항상 최소 피치(LED 최대)로 나오는데, 균일도가
// 어느 밀도부터 더 이상 좋아지지 않는다면(포화) 그 위의 LED 는 "더 넣으면 될 것"이란 잘못된
// 인상만 준다. 최소 피치부터 합리적 밀도(N_MIN_LEDS) 피치까지 로그 간격으로 훑어 최고 균일도의
// 0.5%p 안에 드는 가장 성긴 피치(무릎점)를 대표값으로 고른다 — 확산이 약할수록 무릎점이 촘촘한
// 쪽(≈깊이의 몇 배)으로 자연히 이동하므로 "깊이가 얕을수록 LED 가 점진적으로 늘어나는" 추세가
// 그대로 드러난다. solveXY/solveXYAt 내부 탐색(autoTuneLevel 의 참고 피치 선정 등)에는 절대
// 쓰지 않고, 사용자에게 보여줄 "최종 확정 infeasible" 결과에만 적용한다 — 내부에 섞으면 그
// 대체값이 다른 탐색의 기준점으로 다시 쓰여 전혀 다른(대개 더 나쁜) 결과로 튀는 문제가 실측으로
// 확인됨(L4/L5 auto 참고치 회귀).
function preferReasonableInfeasible(spec, eff, r, gridN) {
  if (r.feasible) return r;
  const { X, Y, pMin: truePMin, pMax: truePMax } = bounds(spec);
  const pFloor = Math.min(truePMax, Math.sqrt((X * Y) / N_MIN_LEDS));
  if (!(pFloor > truePMin && pFloor > r.pitchX + 0.01)) return r;
  const padX = r.padX ?? 0, padY = r.padY ?? 0;
  const KNEE_N = 7;
  const cands = [{ p: r.pitchX, u: r.U0c, res: null }];
  for (let i = 1; i <= KNEE_N; i++) {
    const p = r.pitchX * Math.pow(pFloor / r.pitchX, i / KNEE_N);
    const res = evalField(spec, eff, p, p, gridN, padX, padY);
    cands.push({ p, u: res.unifC, res });
  }
  const bestU = Math.max(...cands.map((c) => c.u));
  const knee = [...cands].reverse().find((c) => c.u >= bestU - 0.005);
  if (!knee.res) return r;
  return pack(spec, knee.p, knee.p, knee.res, X, Y, r.target, eff, spec.space.depth, padX, padY);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// 합리적 최소 LED 개수 — 이 미만이면(solveXY 참고) 피치 상한을 낮춰 재탐색한다.
const N_MIN_LEDS = 6;

// ---- 기구물 오버행(LED 배치 포함 전체 기구가 타겟 X·Y 각각 대비 최대 spec.opt.maxOverhang 비율까지 크게) 자동탐색 ----
// 오버행이 크면 가장자리 LED 지원이 늘어 균일도엔 유리하지만, 기구 자체가 커져 LED 수가 늘 수도
// 있어 무조건 유리하지 않다 — 몇 지점을 실제로 계산해 LED 수가 가장 적은(불가능하면 균일도가
// 가장 높은) 오버행을 고른다.
// 후보 폭은 "깊이(od)의 배수" mm 로 잡는다: 타겟 경계에서 어두워지는 폭은 타겟 크기와 무관하게
// LED→관찰면 거리(od)가 정한다(경계 안쪽 ≈od 폭에는 바깥쪽 지원 LED 가 없다 — 실측: 300×120
// 에서 깊이 12mm 는 오버행 ≈12mm, 깊이 30mm 는 ≈23~30mm 부터 타겟 전체 80% 달성). 각 축의
// 폭은 기구 크기 제한(타겟 대비 +maxOverhang, 각 변 = 절반)으로 잘린다 — 제한이 깊이보다
// 작은 짧은 축은 그만큼 가장자리 지원이 부족해지며, 그때는 깊이를 줄이거나 확산(L2~L5)이 필요.
const OVERHANG_DEPTH_STEPS = [0, 0.5, 1, 1.5, 2];
export function overhangCandidates(spec) {
  const { X, Y } = bounds(spec);
  const ov = clamp(spec.opt.maxOverhang ?? 0, 0, 1);
  const capX = ov * X / 2, capY = ov * Y / 2;
  const d = spec.space.depth;
  const seen = new Set(), out = [];
  for (const mm of OVERHANG_DEPTH_STEPS.map((k) => k * d).concat(Math.max(capX, capY))) {
    const c = { padX: Math.min(capX, mm), padY: Math.min(capY, mm) };
    const k = `${c.padX.toFixed(3)}|${c.padY.toFixed(3)}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out;
}
function solveXY(spec, active, gridN, effOverride, pMaxOverride) {
  const { X, Y } = bounds(spec);
  const cands = overhangCandidates(spec);
  let best = cands.length <= 1 ? solveXYAt(spec, active, gridN, effOverride, cands[0]?.padX ?? 0, cands[0]?.padY ?? 0, pMaxOverride) : (() => {
    let best = null;
    for (const { padX, padY } of cands) {
      const r = solveXYAt(spec, active, gridN, effOverride, padX, padY, pMaxOverride);
      if (!best) { best = r; continue; }
      const rk = (x) => (x.feasible ? (x.belowMinLeds ? 1 : 2) : 0);
      if (rk(r) !== rk(best)) { if (rk(r) > rk(best)) best = r; continue; }
      if (r.feasible) {                                              // 달성끼리: LED 최소 → 같으면 전체 균일도
        if (r.leds < best.leds || (r.leds === best.leds && r.U0 > best.U0)) best = r;
      } else if (r.U0c > best.U0c) best = r;                         // 미달끼리는 중심부 균일도 최고
    }
    return best;
  })();

  // ---- 안쪽 배치(음수 오버행) 탐색 ----
  // 열 수가 적은 축(≤ INSET_MAX_ROWS)에서는 최외곽 열의 위치가 곧 프로파일을 결정한다: 2열을 타겟
  // 양끝에 두면 중앙이 꺼지고, 너무 모으면 가장자리가 꺼지므로 최적은 그 사이(실측 100×6 깊이 7:
  // 양끝 y=0.2/5.8 → 81%, 안쪽 y=1.0/5.0 → 90.5%). 열이 많으면(≥4) 안쪽 열들이 중앙을 채우므로
  // 최외곽 열은 경계에 붙는 것이 맞고(가장자리 지원 최대), 이 탐색은 생략한다.
  // 들이는 폭 후보는 깊이(od) 배수: 프로파일 폭의 물리적 척도가 od 이기 때문.
  const od = spec.space.depth + 0.1;
  const INSET_MAX_ROWS = 3;
  const cmp = (r, b) => {
    const rk = (x) => (x.feasible ? (x.belowMinLeds ? 1 : 2) : 0);
    if (rk(r) !== rk(b)) return rk(r) > rk(b);
    if (r.feasible) return r.leds < b.leds || (r.leds === b.leds && r.U0 > b.U0);
    return r.U0c > b.U0c;
  };
  for (const axis of ['Y', 'X']) {
    const rows = axis === 'Y' ? best.ny : best.nx;
    const len = axis === 'Y' ? Y : X, size = axis === 'Y' ? spec.led.sizeY : spec.led.sizeX;
    if (!(rows >= 2 && rows <= INSET_MAX_ROWS)) continue;
    for (const k of [0.125, 0.25, 0.5]) {
      const pad = -k * od;
      if (len + 2 * pad - size <= 0) continue;                    // 허용폭 소멸
      const r = axis === 'Y'
        ? solveXYAt(spec, active, gridN, effOverride, best.padX, pad, pMaxOverride)
        : solveXYAt(spec, active, gridN, effOverride, pad, best.padY, pMaxOverride);
      if (cmp(r, best)) best = r;
    }
  }
  // LED 수 하한(N_MIN_LEDS)은 rankOf 에서 판정 조건으로 직접 다룬다(성긴 쪽부터 훑는 탐색이
  // 6개 미만 배치를 자연히 건너뛰고 그다음 성긴 배치를 고른다).
  return best;
}

// effOverride 를 주면 combinedEffect(spec, active) 대신 그 확산 효과를 그대로 사용
// (레벨 단독 자동탐색이 그 레벨 고유 파라미터로 만든 효과를 넣기 위함). pMaxOverride 를 주면
// bounds(spec)의 피치 상한 대신 그 값을 쓴다(합리적 LED 밀도 하한 재탐색용, solveXY 참고).
function solveXYAt(spec, active, gridN, effOverride, padX, padY, pMaxOverride) {
  const { maxD, target, pMin, pMax: boundPMax, X, Y } = bounds(spec);
  const pMax = pMaxOverride != null ? Math.max(pMin, Math.min(boundPMax, pMaxOverride)) : boundPMax;
  const eff = effOverride ?? combinedEffect(spec, maxD, active);
  const at = memoEval(spec, eff, gridN, padX, padY);
  const mk = (pX, pY, r) => pack(spec, pX, pY, r, X, Y, target, eff, maxD, padX, padY);
  const okXY = (pX, pY) => rankOf(at(pX, pY), target) >= 2;

  // 등방 탐색 — seed 는 깊이(LED→관찰면): 끝 고정 배치의 최적 피치가 그 근처(searchSparsest 참고)
  const iso = searchSparsest((p) => at(p, p), target, pMin, pMax, maxD + 0.1, 2);
  // 등급 2 가 없으면 대표안 = 훑은 점 중 최고 등급·최고 균일도 배치(하한 미만 달성이 있으면 그것)
  if (!iso.feasible) return mk(iso.bestP, iso.bestP, at(iso.bestP, iso.bestP));

  // 정수 확정: 내림한 정수가 feasible 이면 그것, 아니면(feasible 구간이 1mm 보다 좁음) 실수 피치 유지
  const pick = (p, ok) => { const f = Math.max(pMin, Math.floor(p)); return ok(f) ? f : p; };
  const pIso = pick(iso.p, (p) => okXY(p, p));
  const rIso = at(pIso, pIso);
  const isoCand = mk(pIso, pIso, rIso);

  // 근사 정사각(±5%) 타겟 + 등방 혼합 → 필드가 X/Y 대칭 → pX == pY 가 최적
  const squareSym = Math.abs(X - Y) / Math.max(X, Y) < 0.05
    && Math.abs(eff.blurX - eff.blurY) < 1e-6;
  if (squareSym) return isoCand;

  // 좌표 하강: 등방점에서 X·Y 를 번갈아 넓힌다(다른 축 고정 시 feasible 한 가장 성긴 피치).
  // 넓히는 쪽(성긴 쪽)은 리플 증가 방향이라 단조 — 현재 feasible 점을 seed 로 위로만 넓힌다.
  let pX = iso.p, pY = iso.p;
  for (let round = 0; round < 2; round++) {
    const nX = searchSparsest((p) => at(p, pY), target, pMin, pMax, pX, 2).p;
    const nY = searchSparsest((p) => at(nX, p), target, pMin, pMax, pY, 2).p;
    if (Math.abs(nX - pX) < 0.5 && Math.abs(nY - pY) < 0.5) { pX = nX; pY = nY; break; }
    pX = nX; pY = nY;
  }
  // 정수 확정 + 목표 '이상' 보장 — 혼합폭이 작은(리플이 큰) 축 = 병목 → 그 축부터 1mm 축소
  let iX = Math.max(pMin, Math.floor(pX));
  let iY = Math.max(pMin, Math.floor(pY));
  const tightenX = eff.blurX <= eff.blurY;
  let r = at(iX, iY), guard = 0;
  while (rankOf(r, target) < 2 && guard++ < 6) {
    const canX = iX > pMin, canY = iY > pMin;
    if (!canX && !canY) break;
    if (canX && (!canY || tightenX)) iX -= 1; else iY -= 1;
    r = at(iX, iY);
  }
  if (rankOf(r, target) < 2) { iX = pX; iY = pY; r = at(iX, iY); }   // 정수화로 구간을 벗어나면 실수 피치 유지
  const descCand = mk(iX, iY, r);

  if (descCand.belowMinLeds || !descCand.feasible) return isoCand;
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
    if (level !== 1 && LEVEL_SCHEMA[level]) {
      cur.auto = autoTuneLevel(spec, level);
      // 둘 다 미달이면 현재 슬라이더 값의 해가 자동탐색 해보다 나을 수 있다(자동탐색은 최소
      // 피치를 기준점으로 확산을 고르는데, 성긴 배치가 더 좋은 비단조 구간에선 그 기준점이
      // 나쁜 자리라서). "최소가능(자동)"이 현재값보다 못한 모순을 사용자에게 보이지 않도록
      // 현재 해를 자동 참고치로 채택한다.
      if (!cur.feasible && !cur.auto.feasible && cur.U0c > cur.auto.U0c) {
        cur.auto = {
          feasible: false, pitch: cur.pitch, pitchY: cur.pitchY, nx: cur.nx, ny: cur.ny, leds: cur.leds, U0: cur.U0, U0c: cur.U0c, params: levelParams(spec, level),
          transmit: cur.transmit, overhang: cur.overhang, fixtureX: cur.fixtureX, fixtureY: cur.fixtureY,
        };
      }
    }
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
      return evalField(spec, e, refP, refPY, GRID_SOLO, refPadX, refPadY).unifC;
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
      if (rCand.feasible !== rMax.feasible ? rCand.feasible : (rCand.feasible ? rCand.leds < rMax.leds : rCand.U0c > rMax.U0c)) {
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
    // 비교용 프록시 피치 = 깊이 근처(끝 고정 배치의 최적 피치 부근, searchSparsest 참고) — 예전엔
    // 최소 피치를 썼는데, 균일도가 피치에 단조가 아니어서 최소 피치는 최적점이 아니다.
    const { pMin: truePMin, pMax: truePMax } = bounds(spec);
    const pProxy = clamp(depth + 0.1, truePMin, truePMax);
    const schema = LEVEL_SCHEMA[level];
    const realUnif = (p) => evalField(spec, levelEffect({ levels: { [level]: p } }, level, depth), pProxy, pProxy, GRID_SOLO, 0, 0).unifC;
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
      if (rRefined.feasible || rRefined.U0c > rMax.U0c) { rMax = rRefined; maxParams = bp; maxEffect = refinedEffect; }
    }
  }

  if (!rMax.feasible) {
    const rr = preferReasonableInfeasible(spec, maxEffect, rMax, GRID_SOLO);
    return {
      feasible: false, pitch: rr.pitch, pitchY: rr.pitchY, nx: rr.nx, ny: rr.ny, leds: rr.leds, U0: rr.U0, U0c: rr.U0c, params: maxParams,
      transmit: maxEffect.transmit, overhang: rr.overhang, fixtureX: rr.fixtureX, fixtureY: rr.fixtureY,
    };
  }

  // 2단계: 그 피치·오버행(=LED 개수)을 고정한 채, 그 지점에서만 필요한 최소 확산을 이진탐색으로
  // 찾는다(다시 탐색할 필요가 없으므로 solveXY 대신 단일 evalField 로 충분히 가볍다). minEx는
  // 1단계에서 이미 구해둔 것을 그대로 쓴다.
  const pX = rMax.pitchX, pY = rMax.pitchY ?? rMax.pitchX;
  const padX = rMax.padX ?? 0, padY = rMax.padY ?? 0;
  const unifAt = (t) => evalField(spec, effectAt(level, depth, minEx.params, maxParams, t), pX, pY, GRID_SOLO, padX, padY).unifC;

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
  const packed = pack(spec, pX, pY, r, b.X, b.Y, b.target, finalEff, depth, padX, padY);
  return {
    feasible: packed.feasible, belowMinLeds: packed.belowMinLeds, pitch: packed.pitch, pitchY: packed.pitchY, nx: packed.nx, ny: packed.ny, leds: packed.leds, U0: packed.U0, U0c: packed.U0c,
    params: finalParams, transmit: packed.transmit, overhang: packed.overhang,
    fixtureX: packed.fixtureX, fixtureY: packed.fixtureY,
  };
}

function effectAt(level, depth, minParams, maxParams, t) {
  return levelEffect({ levels: { [level]: lerpParams(level, minParams, maxParams, t) } }, level, depth);
}

function pack(spec, pX, pY, r, X, Y, target, eff, depth, padX = 0, padY = 0) {
  const { nx, ny } = ledCounts(spec, pX, pY ?? pX, padX, padY);
  return {
    pitchX: pX, pitchY: ny === 1 ? null : pY, pitch: pX, depth,
    leds: nx * ny, nx, ny, dim: ny === 1 ? '1D' : '2D', target,
    feasible: rankOf(r, target) >= 1,                 // 중심부(95%) 목표 충족 = 판정
    belowMinLeds: rankOf(r, target) === 1,            // 달성이지만 LED 수 하한(N_MIN_LEDS) 미만
    centerBright: r.rimBright <= RIM_TOL,             // 참고: 밝기 최댓값이 중심부 안에 있음
    fullPass: r.unif >= target,                       // 참고: 타겟 전체 min/max 목표 충족
    U0: r.unif, U0c: r.unifC, rimBright: r.rimBright, // U0 = 전체 min/max, U0c = 중심부 min/max
    minAvg: r.minAvg, cv: r.cv, grad: r.grad,
    blurX: eff.blurX, blurY: eff.blurY, transmit: eff.transmit,
    padX, padY,                                        // 음수 = 최외곽 LED 열을 타겟 안쪽으로 들임(기구는 그대로)
    fixtureX: X + 2 * Math.max(0, padX), fixtureY: Y + 2 * Math.max(0, padY),
    overhang: X > 0 ? (2 * Math.max(0, padX)) / X : 0,
  };
}
