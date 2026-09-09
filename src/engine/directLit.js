// 직하형(Direct-lit) 조도장 계산 — 프로젝트.md §Stage1
// 성능: 단일 LED 조도 커널을 1회 계산(근접장 분할 포함)하고,
//       배열/이미지 소스는 커널의 이중선형 보간 조회로 합산.

import {
  lambertianExponent, gaussianSigma, relIntensity, axialIntensityFromFlux, fresnelT,
} from './photometry.js';

const DEG = Math.PI / 180;

// 2D/3D(선형/평면) 자동 분류: Y폭이 '충분히' 좁을 때만 1D(1줄)
// (빔 커버폭의 절반 이내 — 가장자리까지 균일하려면 보수적으로)
export function classifyDimension(spec, od) {
  const yFill = 2 * od * Math.tan((spec.led.beamY / 2) * DEG);
  return spec.target.yLen <= 0.55 * yFill ? '1D' : '2D';
}

// offX/offY(mm): L2 De-center — LED 배열 전체를 타겟 중심에서 평행이동(배치 공차 검토용, 광학과 무관)
// padX/padY(mm): 기구물 오버행 — 타겟 경계 바깥으로 LED 배치 영역을 넓혀(가장자리 균일도
// 저하 보강), 판정 대상 타겟 자체는 그대로 [0,X]×[0,Y] 유지.
export function ledPositions(spec, pitchX, pitchY, offX = 0, offY = 0, padX = 0, padY = 0) {
  // 항상 X·Y 격자로 배치. 좁은 타겟이면 centered() 가 자연히 1열(또는 2열)을 준다.
  const xs = centered(spec.target.xLen, pitchX, padX).map((x) => x + offX);
  const ys = centered(spec.target.yLen, pitchY ?? pitchX, padY).map((y) => y + offY);
  const pos = [];
  for (const y of ys) for (const x of xs) pos.push({ x, y });
  return pos;
}

// LED 균등 배치. 타겟 영역 [0,len] (+ 오버행 pad 만큼 양쪽으로 확장) 안에 배치.
export function centeredCount(len, pitch, pad = 0) {
  return Math.max(1, Math.round((len + 2 * pad) / pitch));
}
function centered(len, pitch, pad = 0) {
  const total = len + 2 * pad;
  const inner = Math.max(1, Math.round(total / pitch));
  if (inner === 1) return [total / 2 - pad];
  const start = (total - (inner - 1) * pitch) / 2 - pad;
  const xs = [];
  for (let i = 0; i < inner; i++) xs.push(start + i * pitch);
  return xs;
}

function makeGrid(spec, dim, nx, ny) {
  // 필드는 전체 타겟 영역 [0,X]×[0,Y] 을 담는다 (표시가 단면도·평면도와 정렬됨).
  // 균일도 지표는 metrics/localGradient 에서 가장자리 마진을 제외해 계산.
  const x0 = 0, x1 = spec.target.xLen, y0 = 0, y1 = spec.target.yLen;
  const worldW = x1 - x0, worldH = y1 - y0;
  const NX = nx;
  // ny 미지정 시: 정사각 셀 유도 + Y 셀 ≤ 5mm (Y방향 LED 리플·가장자리 falloff 반영), 상한 200
  const NY = Math.max(2, ny ?? Math.min(200, Math.max(
    18,
    Math.round((NX - 1) * worldH / worldW) + 1,
    Math.round(worldH / 5) + 1,
  )));
  const stepX = worldW / Math.max(1, NX - 1);
  const stepY = worldH / (NY - 1);
  return { NX, NY, x0, x1, y0, y1, stepX, stepY };
}

// solver/판정용 격자 — 셀 크기 상한(mm) 기준으로 X·Y 해상도를 유도.
// 셀이 너무 크면(구 버전: X는 고정 개수라 300mm 타겟에서 ~10mm/셀) LED 사이 골짜기·
// LED 바로 위 피크를 놓쳐 균일도가 실제 조도분포(=히트맵)와 어긋나게 판정될 수 있다.
// solver 와 main 이 같은 cellMm 을 써야 판정/표시 균일도가 일치.
export function evalGrid(spec, cellMm) {
  const wW = spec.target.xLen, wH = spec.target.yLen;
  const nx = Math.max(24, Math.min(260, Math.round(wW / cellMm) + 1));
  const ny = Math.max(16, Math.min(260, Math.round(wH / cellMm) + 1));
  return { nx, ny };
}

// ---- 단일 LED 조도 커널 (dx, dy 오프셋 격자) ----
const _kcache = new Map();

function kernelFor(spec, od, grid) {
  const key = [
    od.toFixed(3), grid.NX, grid.NY, grid.stepX.toFixed(3),
    spec.led.beamX, spec.led.model, spec.led.fluxLm, spec.led.sizeX, spec.led.sizeY,
    spec.target.xLen, spec.target.yLen,
  ].join('|');
  let K = _kcache.get(key);
  if (!K) {
    K = buildKernel(spec, od, grid);
    if (_kcache.size > 48) _kcache.clear();
    _kcache.set(key, K);
  }
  return K;
}

function buildKernel(spec, od, grid) {
  const model = spec.led.model;
  const p = model === 'gaussian'
    ? { sigma: gaussianSigma(spec.led.beamX) }
    : { m: lambertianExponent(spec.led.beamX) };
  const I0 = axialIntensityFromFlux(spec.led.fluxLm, model, p);

  // 근접장: OD < 5·√(발광면적) 이면 발광면 3x3 분할
  const emit = Math.sqrt(spec.led.sizeX * spec.led.sizeY);
  const sub = od < 5 * emit ? 3 : 1;
  const subScale = 1 / (sub * sub);

  const { stepX, stepY, NY } = grid;
  const X = spec.target.xLen, Y = spec.target.yLen;
  const rx = Math.ceil((2 * X) / stepX);
  const ry = NY > 1 ? Math.ceil((2 * Y) / stepY) : 0;
  const kNx = 2 * rx + 1, kNy = 2 * ry + 1;
  const dxMin = -rx * stepX, dyMin = -ry * stepY;
  const data = new Float64Array(kNx * kNy);

  for (let b = 0; b < kNy; b++) {
    const dy = dyMin + b * stepY;
    for (let a = 0; a < kNx; a++) {
      const dx = dxMin + a * stepX;
      let E = 0;
      for (let sa = 0; sa < sub; sa++) for (let sb = 0; sb < sub; sb++) {
        const ox = sub === 1 ? 0 : (sa / (sub - 1) - 0.5) * spec.led.sizeX;
        const oy = sub === 1 ? 0 : (sb / (sub - 1) - 0.5) * spec.led.sizeY;
        const ddx = dx - ox, ddy = dy - oy;
        const d2 = ddx * ddx + ddy * ddy + od * od;
        const d = Math.sqrt(d2);
        const cos = od / d;
        const I = I0 * relIntensity(model, Math.acos(Math.min(1, cos)), p);
        E += (I * cos / d2) * subScale;   // 수평면 조도 (cos 입사 포함)
      }
      data[b * kNx + a] = E;
    }
  }
  return { data, kNx, kNy, dxMin, dyMin, stepX, stepY };
}

function sample(K, dx, dy) {
  let fa = (dx - K.dxMin) / K.stepX;
  let fb = K.kNy > 1 ? (dy - K.dyMin) / K.stepY : 0;
  if (fa < 0) fa = 0; else if (fa > K.kNx - 1) fa = K.kNx - 1;
  if (fb < 0) fb = 0; else if (fb > K.kNy - 1) fb = K.kNy - 1;
  const a0 = fa | 0, b0 = fb | 0;
  const a1 = a0 + 1 < K.kNx ? a0 + 1 : a0;
  const b1 = b0 + 1 < K.kNy ? b0 + 1 : b0;
  const ta = fa - a0, tb = fb - b0;
  const d = K.data, w = K.kNx;
  return d[b0 * w + a0] * (1 - ta) * (1 - tb) + d[b0 * w + a1] * ta * (1 - tb)
       + d[b1 * w + a0] * (1 - ta) * tb + d[b1 * w + a1] * ta * tb;
}

export function computeField(spec, opt) {
  const od = (opt.depth ?? opt.od) + 0.1;  // LED → 관찰면 = 기구물 상면 +0.1mm
  const dim = opt.dim || classifyDimension(spec, od);

  const leds = ledPositions(spec, opt.pitchX, opt.pitchY ?? opt.pitchX, opt.decenterX ?? 0, opt.decenterY ?? 0, opt.padX ?? 0, opt.padY ?? 0);
  let nx = opt.nx ?? 101;
  let ny = opt.ny;                                 // 미지정이면 makeGrid 가 정사각 셀로 유도
  if (opt.nx == null && leds.length > 800) nx = leds.length > 2500 ? 41 : 61;

  const grid = makeGrid(spec, dim, nx, ny);
  const K = kernelFor(spec, od, grid);

  const { NX, NY, x0, x1, y0, y1, stepX, stepY } = grid;
  const X = spec.target.xLen, Y = spec.target.yLen;
  const refl = opt.wallRefl ?? spec.body?.wallRefl ?? 0;   // 기구 측벽 반사
  // 측벽 위치 = 기구물 경계(오버행 padX/padY 만큼 타겟 밖) — 타겟 경계에 놓으면 오버행 LED 가
  // 벽 "바깥"에 있는 셈이 되어 이미지가 엉뚱한 곳에 생긴다.
  const wx0 = -(opt.padX ?? 0), wx1 = X + (opt.padX ?? 0);
  const wy0 = -(opt.padY ?? 0), wy1 = Y + (opt.padY ?? 0);

  // 소스 목록: 실제 LED + 측벽 1-bounce 이미지 (flat array: x, y, scale)
  const src = [];
  for (const l of leds) {
    src.push(l.x, l.y, 1);
    if (refl > 0) {
      src.push(2 * wx0 - l.x, l.y, refl, 2 * wx1 - l.x, l.y, refl,
              l.x, 2 * wy0 - l.y, refl, l.x, 2 * wy1 - l.y, refl);
    }
  }

  // 산란 blur (X/Y 개별, mm 단위는 호출측이 난이도별로 계산)
  const bX = opt.blurMmX ?? opt.blurMm ?? 0;
  const bY = opt.blurMmY ?? opt.blurMm ?? 0;

  // blur 커널이 타겟 경계를 넘어 뻗는 만큼 계산 범위를 양쪽으로 넓혀, 그 영역도 "실제로 거기
  // 있는 LED가 만드는 진짜(미확산) 조도"로 채운 뒤 블러하고, 다시 타겟 영역만 잘라낸다.
  // (예전엔 경계 밖을 아예 빛이 없는 것으로 취급(zero-padding)해 경계가 늘 어둡게, 그 전엔
  // 반대로 잘린 만큼을 재정규화해 경계가 늘 밝게 나오는 오류가 각각 있었다 — 둘 다 "밖에 뭐가
  // 있는지 모른다"를 임의로 가정한 게 문제였고, 실제로는 LED 위치를 이미 알고 있으니 그
  // 영역까지 정직하게 계산하면 양쪽 오류가 다 사라진다.)
  // 확장 폭은 셀 수로 캡: 3σ 그대로 쓰면(예: milky 강한 확산, 수백 mm) blurAxis 자체의 커널
  // 반경도 같이 커져(그 상한이 배열 크기이므로) 컨볼루션 비용이 격자 크기의 제곱에 가깝게
  // 늘어난다 — 실측으로 넓은 타겟+강한 확산 조합에서 계산 1회가 3초 가까이(작은 타겟 대비
  // 50배) 걸리는 걸 확인했다. 16셀 정도의 확장만으로도(실측 비교: 무제한 대비 오차 <0.2%p)
  // 경계 왜곡은 이미 거의 다 사라지므로, 이 캡으로 정확도 손실은 무시할 만한 수준을 유지하며
  // 속도를 크게 회복한다.
  const EX_CAP = 16;
  const exNX = stepX > 0 ? Math.min(EX_CAP, Math.ceil(3 * bX / stepX)) : 0;
  const exNY = NY > 1 && stepY > 0 ? Math.min(EX_CAP, Math.ceil(3 * bY / stepY)) : 0;
  const ENX = NX + 2 * exNX, ENY = NY + 2 * exNY;
  const ex0 = x0 - exNX * stepX, ey0 = y0 - exNY * stepY;

  const efield = new Float64Array(ENX * ENY);
  for (let j = 0; j < ENY; j++) {
    const py = ENY === 1 ? Y / 2 : ey0 + j * stepY;
    for (let i = 0; i < ENX; i++) {
      const px = ex0 + i * stepX;
      let E = 0;
      for (let s = 0; s < src.length; s += 3) E += src[s + 2] * sample(K, px - src[s], py - src[s + 1]);
      efield[j * ENX + i] = E;
    }
  }

  blurSeparable(efield, ENX, ENY, bX / stepX, bY / stepY);

  // 확장 계산분 중 원래 타겟 영역([0,X]×[0,Y])만 다시 잘라낸다.
  const field = new Float64Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const srcRow = (j + exNY) * ENX + exNX;
    for (let i = 0; i < NX; i++) field[j * NX + i] = efield[srcRow + i];
  }

  const T = fresnelT(spec.body?.n ?? 1) * (opt.transmit ?? 1);
  if (T !== 1) for (let k = 0; k < field.length; k++) field[k] *= T;

  // L3 균일두께 용기(라이트가이드) — 가장자리(둥근 모서리 cornerR)에 가까울수록 boostMax 까지
  // 밝기를 가산(위치 의존, 균일 blur 와 별개). 옆으로 향하던 빛이 테이퍼 경사면에서 정면으로
  // 꺾여 나가는 것의 1차 근사.
  if (opt.edgeBoost && opt.edgeBoost.tw > 0 && opt.edgeBoost.boostMax > 0) {
    applyEdgeBoost(field, NX, NY, x0, x1, y0, y1, X, Y, opt.edgeBoost);
  }

  return { field, nx: NX, ny: NY, stepX, stepY, dim, leds, depth: opt.depth ?? opt.od,
           extent: { x0, x1, y0, y1 } };
}

// 타겟 경계까지의 거리(둥근 모서리 cornerR 반영)가 tw 안쪽이면 경계에 가까울수록
// (1+boostMax)까지 밝기를 가산한다. 1D(ny===1)에서는 Y 경계는 고려하지 않는다(정사각 셀
// 유도 방식과 동일한 단순화).
function applyEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {
  const { tw, boostMax } = edge;
  const r = Math.min(Math.max(0, edge.cornerR ?? 0), tw);
  // 평균 대비 "절대량"으로 더한다(곱하지 않음) — 곱셈이면 이미 밝은 지점(예: X중앙·Y가장자리)이
  // 보정으로 오히려 새로운 최댓값이 되어 min/max 가 개선은커녕 악화되는 문제가 실측으로 확인됨.
  // 추가로: 가장자리 폭(tw)이 좁은 타겟(예: 100x20mm)에서는 boostMax 가 커질수록 보정량 자체가
  // 기존 최댓값을 넘어서 "새로운 최댓값"이 되어버려 wallThk 증가가 오히려 균일도를 악화시키는
  // 비단조 문제가 실측으로 확인됨. 보정값이 보정 전 필드의 최댓값을 넘지 않도록 캡을 씌워
  // "어두운 가장자리를 기존 밝기 수준까지만 채워준다"는 원래 취지를 벗어나지 않게 한다.
  let sum = 0, maxF = -Infinity;
  for (let k = 0; k < f.length; k++) { sum += f[k]; if (f[k] > maxF) maxF = f[k]; }
  const avg = f.length ? sum / f.length : 0;
  for (let j = 0; j < ny; j++) {
    const py = ny === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (ny - 1));
    const dy = ny === 1 ? Infinity : Math.min(py, Y - py);
    for (let i = 0; i < nx; i++) {
      const px = nx === 1 ? X / 2 : x0 + (x1 - x0) * (i / (nx - 1));
      const dx = Math.min(px, X - px);
      const edgeDist = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : Math.min(dx, dy);
      if (edgeDist < tw) {
        const t = edgeDist <= 0 ? 1 : 1 - edgeDist / tw;
        const idx = j * nx + i;
        f[idx] = Math.min(maxF, f[idx] + avg * boostMax * t);
      }
    }
  }
}

function blurSeparable(f, nx, ny, sx, sy) {
  if (sx > 0.3) blurAxis(f, nx, ny, sx, true);
  if (ny > 1 && sy > 0.3) blurAxis(f, nx, ny, sy, false);
}

function blurAxis(f, nx, ny, sigma, horiz) {
  const n = horiz ? nx : ny;
  // 커널 반경 상한 = 배열 크기(n-1) — 그 이상은 물리적으로 의미가 없다(전체 도메인을 넘는
  // 확산은 이미 "도메인 전체 평균"에 수렴). 예전엔 40셀로 고정돼 있었는데, 격자를 정밀화(1.5mm)
  // 하면서 40셀이 겨우 60mm에 불과해져 강한 확산(L2 milky 6+)에서 커널이 잘려 균일도가 오히려
  // 역전되는 버그가 있었다 — 격자 해상도에 무관하게 항상 도메인만큼은 커버하도록 수정.
  const r = Math.max(1, Math.min(n - 1, Math.ceil(sigma * 3)));
  const ker = new Float64Array(2 * r + 1);
  let s = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); ker[k + r] = v; s += v; }
  for (let k = 0; k < ker.length; k++) ker[k] /= s;
  const tmp = new Float64Array(f.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    // 경계 밖 탭 = 0(zero-padding, "타겟 밖에는 빛이 없다"를 그대로 반영) — 범위 밖 탭을
    // 유효 가중치만으로 재정규화(divide by wsum)하면 잘린 만큼을 "안쪽과 똑같이 밝았을 것"
    // 이라 가정하는 셈이 되어, 가장자리로 갈수록 오히려 값이 커지는(LED에서 먼 도메인 경계가
    // LED 바로 위보다 더 밝아지는) 정반대 결과가 실측으로 확인됨 — 전체 커널 가중치(s, 이미
    // 정규화됨)로 나눠 잘린 부분을 0으로 취급해야 한다. (이전엔 바깥쪽을 가장자리 값으로
    // 반복(clamp)해 커널이 배열보다 훨씬 클 때 수십 배 과대 반영되는 문제가 있었는데, 그 수정
    // 으로 "제외 후 재정규화"를 썼다가 이번엔 반대 방향 오류가 생긴 것 — zero-padding이 두
    // 문제 모두 없는 올바른 경계 조건.)
    const center = horiz ? i : j;
    let acc = 0;
    for (let k = -r; k <= r; k++) {
      const pos = center + k;
      if (pos < 0 || pos > n - 1) continue;
      const ii = horiz ? pos : i, jj = horiz ? j : pos;
      acc += f[jj * nx + ii] * ker[k + r];
    }
    tmp[j * nx + i] = acc;
  }
  f.set(tmp);
}
