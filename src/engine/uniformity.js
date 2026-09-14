// 균일도 지표 — 프로젝트.md §Stage1 (관찰면 = 출광면 바로 위)
// 필드는 전체 타겟 영역을 담고, 지표는 가장자리 마진(edgeFrac)을 뺀 유효영역에서 계산.

// 유효영역 인덱스 범위 [i0, i1) x [j0, j1) — 축별 제외 비율(edgeFrac: X, edgeFracY: Y, 미지정이면 X 와 같게)
function region(nx, ny, edgeFrac, edgeFracY) {
  const f = Math.min(0.34, Math.max(0, edgeFrac || 0));
  const fy = Math.min(0.34, Math.max(0, edgeFracY ?? f));
  const i0 = Math.round(f * (nx - 1));
  let j0 = 0, j1 = ny;
  if (ny >= 6) j0 = Math.round(fy * (ny - 1));
  j1 = ny - j0;
  return [i0, Math.max(i0 + 1, nx - i0), j0, Math.max(j0 + 1, j1)];
}

// 중심부 = 타겟 면적의 중심 areaFrac(기본 95%) 영역. 각 축을 √areaFrac 로 축소한 동심 직사각형이므로
// 축별 인셋 비율 = (1 − √areaFrac)/2 (95% → 각 변 1.27%). 판정(균일도)은 이 영역에서 하고, 바깥
// 5% 는 가장자리로 본다. (goal.centerArea 로 조절)
export function centerZoneFrac(areaFrac = 0.95) {
  const a = Math.min(1, Math.max(0.01, areaFrac));
  const f = (1 - Math.sqrt(a)) / 2;
  return { fx: f, fy: f };
}
// 테두리 밝음 판정: 중심부 우선 설계는 밝기 최댓값이 중심부 안에 있어야 한다(가장자리로 갈수록
// 완만히 떨어지는 프로파일). 허용치 0 = "전체 최댓값 ∈ 중심부" 그 자체이며 임의 상수가 아니다.
// (1% 같은 허용치를 두면 테두리가 0.9% 밝은 3행 배치와 중심이 최댓값인 4행 배치를 구분 못 한다.)
export const RIM_TOL = 0;
// 중심부 판정: 중심부 min/max, 테두리 초과 밝기(전체 max / 중심부 max − 1)
export function centerMetrics(field, nx, ny, fx, fy) {
  const [i0, i1, j0, j1] = region(nx, ny, fx, fy);
  let mn = Infinity, mxC = -Infinity, mxAll = -Infinity;
  for (let k = 0; k < field.length; k++) if (field[k] > mxAll) mxAll = field[k];
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const v = field[j * nx + i]; if (v < mn) mn = v; if (v > mxC) mxC = v; }
  return { minMax: mxC > 0 ? mn / mxC : 0, rimBright: mxC > 0 ? Math.max(0, mxAll / mxC - 1) : 0 };
}

export function metrics(field, nx, ny, edgeFrac = 0, edgeFracY) {
  // 유효영역 값 수집
  let vals;
  if (!nx) {
    vals = field instanceof Float64Array ? field.slice() : Float64Array.from(field);
  } else {
    const [i0, i1, j0, j1] = region(nx, ny, edgeFrac, edgeFracY);
    vals = new Float64Array((i1 - i0) * (j1 - j0));
    let k = 0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) vals[k++] = field[j * nx + i];
  }
  const n = vals.length;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  const avg = sum / n;
  let sq = 0;
  for (const v of vals) sq += (v - avg) * (v - avg);
  const std = Math.sqrt(sq / n);

  // 리터럴 min/max — 시뮬레이션은 노이즈 없는 결정론적 계산이라 "측정 이상치 제외" 전제가
  // 성립하지 않는다. 예전엔 상하위 3% 백분위로 완화했으나, 격자 해상도를 1.5mm로 올린 뒤
  // 3%가 수백~수천 셀이 되어 실제 타겟면 상당 부분이 목표 미달인데도 "달성"으로 오판정되는
  // 문제가 실측(기본 스펙 기준 판정 80.2% vs 실제 72.9%)으로 확인되어 리터럴 값으로 되돌림.
  return {
    min, max, avg,
    U0: avg > 0 ? min / avg : 0,
    cv: avg > 0 ? std / avg : 0,
    minMax: max > 0 ? min / max : 0,       // = '최소광량 / 최대광량' (리터럴)
  };
}

// 인접 격자점 간 최대 상대 변화 (유효영역 내)
export function localGradient(field, nx, ny, edgeFrac = 0) {
  const [i0, i1, j0, j1] = region(nx, ny, edgeFrac);
  const at = (i, j) => field[j * nx + i];
  let sum = 0, n = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { sum += at(i, j); n++; }
  const avg = sum / n || 1;
  let g = 0;
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    if (i + 1 < i1) g = Math.max(g, Math.abs(at(i, j) - at(i + 1, j)) / avg);
    if (j + 1 < j1) g = Math.max(g, Math.abs(at(i, j) - at(i, j + 1)) / avg);
  }
  return g;
}

export function evaluateGoal(m, grad, goal) {
  return {
    U0: { value: m.U0, target: goal.U0, pass: m.U0 >= goal.U0 },
    cv: { value: m.cv, target: goal.cvMax, pass: m.cv <= goal.cvMax },
    grad: { value: grad, target: goal.gradMax, pass: grad <= goal.gradMax },
    all: m.U0 >= goal.U0 && m.cv <= goal.cvMax && grad <= goal.gradMax,
  };
}
