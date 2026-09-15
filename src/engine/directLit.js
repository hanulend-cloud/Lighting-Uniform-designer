// 직하형(Direct-lit) 조도장 계산 — 프로젝트.md §Stage1
// 성능: 단일 LED 조도 커널을 1회 계산(근접장 분할 포함)하고,
//       배열/이미지 소스는 커널의 이중선형 보간 조회로 합산.

import {
  lambertianExponent, gaussianSigma, relIntensity, axialIntensityFromFlux, fresnelT, fresnelR,
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
  const xs = anchoredAxis(spec.target.xLen, pitchX, padX, spec.led.sizeX).map((x) => x + offX);
  const ys = anchoredAxis(spec.target.yLen, pitchY ?? pitchX, padY, spec.led.sizeY).map((y) => y + offY);
  const pos = [];
  for (const y of ys) for (const x of xs) pos.push({ x, y });
  return pos;
}

// LED 1축 배치 — 개수 n 을 정하고 타겟 중심 대칭으로 기구 경계(타겟 ±pad, LED 반폭 안쪽)까지
// 균등하게 펼친다. 피치 p 는 "간격 상한"이며 n = ceil(usable/p)+1, 실제 간격 = usable/(n−1) ≤ p.
// LED 개수 조절의 의미: n 을 늘리면(추가) 중심 대칭을 유지하며 촘촘해지고, n 을 줄이면(제거)
// 가장자리 지원이 먼저 줄어든다 — 판정은 중심부(타겟 면적의 중심 95%)에서 하므로 "중심부가
// 목표를 만족하는 최소 n" 을 찾는 것이 곧 "가장자리부터 뺀다"는 원칙이다. 같은 n 에서 피치를
// 경계까지 펼치는 이유: n 개로 낼 수 있는 가장자리 지원의 최대(피치를 줄여 중심에 몰면 같은
// 개수로 가장자리만 어두워진다 — 실측: 300×120 L1 230개 → 중심몰림 336개).
// 홀수 n 이면 중심에 LED, 짝수면 중심 양옆 대칭 — 중심에 LED 가 꼭 있어야 하는 것은 아니다.
// 성긴 쪽 위상: 피치 ≥ 허용폭(usable)이면 2열(양끝, 중심 비움), 피치 ≥ 2·허용폭이면 1열(중앙).
// 좁은 축(예: 100×11 타겟, 깊이 7)에서는 중심 1열보다 "양끝 2열 + X 피치 축소"가 같은 개수로
// 가장자리까지 더 균일하다 — 예전 규칙(허용폭 ≤ 피치 → 무조건 1열)은 2열 위상을 아예 탐색
// 대상에서 빼 버려 1열(중심)에서 3열로 건너뛰었다.
function anchoredAxis(len, pitch, pad, size) {
  const lo = -pad + size / 2, hi = len + pad - size / 2;
  const usable = hi - lo;
  if (!(usable > 0) || pitch >= 2 * usable) return [len / 2];
  const n = Math.ceil(usable / pitch - 1e-9) + 1;
  const pe = usable / (n - 1);
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(lo + i * pe);
  return xs;
}
export function ledCounts(spec, pitchX, pitchY, padX = 0, padY = 0) {
  return {
    nx: anchoredAxis(spec.target.xLen, pitchX, padX, spec.led.sizeX).length,
    ny: anchoredAxis(spec.target.yLen, pitchY ?? pitchX, padY, spec.led.sizeY).length,
  };
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
    od.toFixed(3), grid.NX, grid.NY, grid.stepX.toFixed(3), grid.stepY.toFixed(3),
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

  // opt.leds: LED 좌표 목록을 직접 준 경우(비균일 배치 실험·검증용) 그대로 사용
  const leds = opt.leds ?? ledPositions(spec, opt.pitchX, opt.pitchY ?? opt.pitchX, opt.decenterX ?? 0, opt.decenterY ?? 0, opt.padX ?? 0, opt.padY ?? 0);
  let nx = opt.nx ?? 101;
  let ny = opt.ny;                                 // 미지정이면 makeGrid 가 정사각 셀로 유도
  if (opt.nx == null && leds.length > 800) nx = leds.length > 2500 ? 41 : 61;

  const grid = makeGrid(spec, dim, nx, ny);
  const K = kernelFor(spec, od, grid);

  const { NX, NY, x0, x1, y0, y1, stepX, stepY } = grid;
  const X = spec.target.xLen, Y = spec.target.yLen;
  // 기구 측벽(캐비티 안쪽 = 투명 몸체 수지 벽, 공기→n 계면) 1-bounce 이미지. 반사율은 상수가
  // 아니라 프레넬: 이미지 소스→관찰점 광선이 벽면(수직면)에 닿는 입사각으로 매 샘플마다 계산
  // (cosI = 벽 법선 방향 성분 / 광선 길이). 옆으로 낮게 진행하는 빛(벽에 거의 수직 입사)은 5%
  // 정도만 돌아오고, 위로 가파르게 진행하는 빛(스침각 입사)일수록 많이 돌아온다.
  // 측벽 위치 = 기구물 경계(오버행 padX/padY 만큼 타겟 밖) — 타겟 경계에 놓으면 오버행 LED 가
  // 벽 "바깥"에 있는 셈이 되어 이미지가 엉뚱한 곳에 생긴다.
  const nBody = spec.body?.n ?? 1;
  // pad 가 음수(최외곽 LED 열을 타겟 안쪽으로 들인 배치)여도 기구 벽은 타겟 경계에 있다.
  const fpX = Math.max(0, opt.padX ?? 0), fpY = Math.max(0, opt.padY ?? 0);
  const wx0 = -fpX, wx1 = X + fpX;
  const wy0 = -fpY, wy1 = Y + fpY;

  // 직접광 소스(LED)와 벽 이미지(1=X벽, 2=Y벽)를 분리해서 담는다 — 벽 이미지는 아래에서 blur
  // 전이 아니라 후에 따로 더한다(이유는 벽 이미지 합산부 주석 참고). 벽에서 3·od 보다 먼 LED 의
  // 이미지는 생략: 벽 바로 앞 지점에서조차 상대 조도가 (1/(1+(L/od)²))² < 1%, 거기에 수직입사
  // 프레넬 5% 가 곱해져 0.05% 미만 — 대신 소스 수가 5배로 늘어 solve 전체가 수 배 느려지는 것
  // (실측: 스모크 테스트 80s → 10분 초과)을 막는다.
  const ledSrc = [];
  const wallSrc = [];
  const wCut = 3 * od;
  for (const l of leds) {
    ledSrc.push(l.x, l.y);
    if (nBody > 1) {
      if (l.x - wx0 < wCut) wallSrc.push(2 * wx0 - l.x, l.y, 1);
      if (wx1 - l.x < wCut) wallSrc.push(2 * wx1 - l.x, l.y, 1);
      if (l.y - wy0 < wCut) wallSrc.push(l.x, 2 * wy0 - l.y, 2);
      if (wy1 - l.y < wCut) wallSrc.push(l.x, 2 * wy1 - l.y, 2);
    }
  }
  const od2 = od * od;

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
      for (let s = 0; s < ledSrc.length; s += 2) {
        E += sample(K, px - ledSrc[s], py - ledSrc[s + 1]);
      }
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

  // 측벽(캐비티 안쪽 = 투명 몸체 수지 벽, 공기→n 계면) 1-bounce 이미지는 직접광 blur 이후에
  // 따로 더한다. 반사율은 상수가 아니라 프레넬: 이미지 소스→관찰점 광선이 벽면(수직면)에 닿는
  // 입사각으로 매 샘플마다 계산(cosI = 벽 법선 방향 성분 / 광선 길이) — 옆으로 낮게 진행하는
  // 빛(벽에 거의 수직 입사)은 5% 정도만 돌아오고, 위로 가파르게 진행하는 빛(스침각 입사)일수록
  // 많이 돌아온다.
  //
  // blur 전에 다른 소스들과 합쳐서 함께 블러링하면(예전 구현), L3처럼 blur 자체가 굵은 조합에서
  // 벽 근처의 좁은 반사 띠가 안쪽까지 넓게 퍼져 중심부보다 오히려 두드러지는 문제가 실측으로
  // 확인됨 — LED-벽 간격이 좁은(LED 반폭만 띄우는 기본 배치) 곳에서 특히 심하다. 벽 반사는
  // 매끈한 벽면의 정반사(specular) 근사라 L3/L2 의 "벌크 안에서 여러 번 갇혀 무작위로 퍼지는"
  // 확산과는 물리적으로 다른 경로이므로, 같은 blur 커널을 씌우는 것 자체가 두 메커니즘을
  // 섞는 것이었다. 이제 벽 반사는 직접광과 동일하게 그 자신의 1/r² 감쇠만 가지고 blur 없이
  // 더해져, L1 단독처럼 blur=0 인 경우와 동일한 세기로 좁게만 기여한다(L1 이 이 보강에 의존하는
  // 기존 테스트들과 결과가 같음을 확인).
  if (wallSrc.length) {
    for (let j = 0; j < NY; j++) {
      const py = NY === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (NY - 1));
      for (let i = 0; i < NX; i++) {
        const px = NX === 1 ? X / 2 : x0 + (x1 - x0) * (i / (NX - 1));
        let E = 0;
        for (let s = 0; s < wallSrc.length; s += 3) {
          const dx = px - wallSrc[s], dy = py - wallSrc[s + 1], kind = wallSrc[s + 2];
          const lateral = kind === 1 ? Math.abs(dx) : Math.abs(dy);
          const w = fresnelR(lateral / Math.sqrt(dx * dx + dy * dy + od2), nBody);
          E += w * sample(K, dx, dy);
        }
        field[j * NX + i] += E;
      }
    }
  }

  const T = fresnelT(spec.body?.n ?? 1) * (opt.transmit ?? 1);
  if (T !== 1) for (let k = 0; k < field.length; k++) field[k] *= T;

  // L3 균일두께 용기(라이트가이드) — 가장자리(둥근 모서리 cornerR)에 가까울수록 boostMax 까지
  // 밝기를 가산(위치 의존, 균일 blur 와 별개). 옆으로 향하던 빛이 테이퍼 경사면에서 정면으로
  // 꺾여 나가는 것의 1차 근사.
  if (opt.edgeBoost && opt.edgeBoost.hasBoost) {
    const halfP = Math.max(1, Math.min(opt.pitchX ?? X, opt.pitchY ?? opt.pitchX ?? Y) / 2);
    applyEdgeBoost(field, NX, NY, x0, x1, y0, y1, X, Y, opt.edgeBoost, leds, halfP);
  }

  return { field, nx: NX, ny: NY, stepX, stepY, dim, leds, depth: opt.depth ?? opt.od,
           extent: { x0, x1, y0, y1 } };
}

// 시야각(휘도) 렌더링 — computeField()의 조도(illuminance)는 "각 지점에 수평으로 놓인 센서가
// 받는 광량"이라 관측 위치와 무관하다(램버시안 확산이면 휘도도 L=E/π로 각도 무관 — 그래서
// 단순 /π 변환은 그림이 안 바뀐다). 실제 눈으로 볼 때는 다르다: 근접 시야(예: 30cm)에서는
// 시차(parallax) — 같은 화면 위치라도 눈이 어디 있느냐에 따라, 그 눈-화면 직선을 LED 평면까지
// 연장했을 때 실제로 "보게 되는" 자리가 달라진다.
//
// 처음 구현은 "LED 하나당 눈에 보이는 밝기 1개 값을 그 LED의 시차-투영 위치 한 점에만 찍었는데,
// 이러면 LED 자신의 넓은 지향각(cos^m 분포, 예: 120°)이 실제로 만드는 근접장 확산(=조도장이
// 매끈해 보이는 이유, buildKernel 이 이미 계산)을 통째로 버려서 화면 대부분이 0이고 LED 자리만
// 점점이 찍힌 부자연스러운 그림이 나왔다(실측 지적). 올바른 방법은 그 반대 방향이다 — 각
// 화면 픽셀(px,py)마다 "눈→그 픽셀 직선을 LED 평면까지 연장한 자리(lx,ly)"를 구해, 거기서
// computeField()와 완전히 같은 근접장 커널(buildKernel/sample, LED들의 지향각 확산을 그대로
// 반영)로 밝기를 구한다 — 조도장과 똑같이 매끈하게 퍼지되, 시차 때문에 "어디를 샘플링하는지"만
// 눈 위치에 따라 달라진다(가장자리로 갈수록 더 바깥쪽 LED 평면 위치를 보게 됨 — 눈이 가까울수록
// 이 어긋남이 커진다). 확산(레벨 blur)은 시점과 무관하게 동일한 물리(산란)이므로 그대로 적용.
// 양쪽 눈(eyeSpacingMm 간격) 각각 계산해 평균 — 양안 융합의 단순화. 벽 반사·L3/L4 edgeBoost는
// 이 렌더링에는 반영하지 않는다(범위 밖).
export function computeCameraLuminance(spec, opt) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const od = (opt.depth ?? opt.od) + 0.1;
  const leds = opt.leds ?? ledPositions(spec, opt.pitchX, opt.pitchY ?? opt.pitchX, opt.decenterX ?? 0, opt.decenterY ?? 0, opt.padX ?? 0, opt.padY ?? 0);
  const dim = opt.dim || classifyDimension(spec, od);
  const grid = makeGrid(spec, dim, opt.nx ?? 101, opt.ny);
  const K = kernelFor(spec, od, grid);
  const { NX, NY, x0, x1, y0, y1, stepX, stepY } = grid;

  const viewDist = Math.max(1, opt.viewDistanceMm ?? 300);
  const eyeSep = Math.max(0, opt.eyeSpacingMm ?? 100);
  const eyeZ = od + viewDist;
  const t = eyeZ / viewDist;                      // 뒤로(LED 평면까지) 투영하는 배율 = 1+od/viewDist
  const cx = X / 2, cy = Y / 2;
  const eyes = eyeSep > 0 ? [{ x: cx - eyeSep / 2, y: cy }, { x: cx + eyeSep / 2, y: cy }] : [{ x: cx, y: cy }];

  const field = new Float64Array(NX * NY);
  for (const eye of eyes) {
    const eyeField = new Float64Array(NX * NY);
    for (let j = 0; j < NY; j++) {
      const py = NY === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (NY - 1));
      for (let i = 0; i < NX; i++) {
        const px = x0 + (x1 - x0) * (i / (NX - 1));
        // 눈→(px,py) 직선을 LED 평면(z=0)까지 연장한 위치 — 시차로 실제 보게 되는 자리.
        const lx = eye.x + (px - eye.x) * t, ly = eye.y + (py - eye.y) * t;
        let E = 0;
        for (const l of leds) E += sample(K, lx - l.x, ly - l.y);
        eyeField[j * NX + i] = E;
      }
    }
    blurSeparable(eyeField, NX, NY, (opt.blurMmX ?? 0) / stepX, (opt.blurMmY ?? 0) / stepY);
    for (let k = 0; k < field.length; k++) field[k] += eyeField[k] / eyes.length;
  }

  const T = fresnelT(spec.body?.n ?? 1) * (opt.transmit ?? 1);
  if (T !== 1) for (let k = 0; k < field.length; k++) field[k] *= T;

  return { field, nx: NX, ny: NY, stepX, stepY, leds, depth: opt.depth ?? opt.od,
           extent: { x0, x1, y0, y1 }, viewDistanceMm: viewDist, eyeSpacingMm: eyeSep };
}

// 타겟 경계까지의 거리(둥근 모서리 cornerR 반영)가 tw 안쪽이면 경계에 가까울수록
// (1+boostMax)까지 밝기를 가산한다. 1D(ny===1)에서는 Y 경계는 고려하지 않는다(정사각 셀
// 유도 방식과 동일한 단순화).
// edgeBoost.kind==='axis'면 축별(X·Y 독립) 프로필 보정, 'radial'이면 LED 중심 기준 반경
// 보정, 그 외(taper)는 단일 경사면 보정 — 어느 레벨이 어느 모양을 만드는지는 levels.js 쪽
// 사정이라 여기선 모양으로만 분기한다.
function applyEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge, leds, halfP) {
  if (edge.kind === 'axis') applyAxisEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge);
  else if (edge.kind === 'radial') applyRadialEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge, leds, halfP);
  else applyTaperEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge);
}

function applyTaperEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {
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

// pts=[중심,중간,가장자리] 두께(mm), halfLen=그 축의 중심→가장자리 거리(mm), dist=가장자리로부터의
// 거리(0=가장자리..halfLen=중심). 반환값은 "가장자리 절반(중간→가장자리) 대비 얼마나 깎였는지"의
// 비율(0=중간 지점 이상, 1=가장자리 두께까지 다 깎임)이며, 중심측 절반(중심→중간)은 항상 0이다.
//
// 중심→가장자리 전체 구간(옛 구현)을 기준으로 램프를 잡으면, 중심-가장자리 두께 낙차가 큰
// 형상(예: tx0=9.7·tx100=1)에서 "깎인 비율"이 타겟 절반 내내 1에 가깝게 포화돼 applyTaperEdgeBoost
// 와 달리 보정 영역이 실제 가장자리 테이퍼 폭(tw)에 갇히지 못하고 타겟 절반 전체로 번진다.
// avg·boostMax(최대 25%)만큼 캡(=기존 최댓값)까지 끌어올리는 픽셀이 그만큼 넓어지면, 그 넓은
// 영역이 전부 캡값 근처의 평평한 "밝은 테두리"가 되어 — 정작 caps에 못 미치는 중심부가 상대적
// 으로 가장 어둡게 보이는 역전된(edge-bright/center-dark) 프로파일이 실측으로 확인됨. 옛 L3의
// tw(가장자리 테이퍼 폭)처럼 보정을 "가장자리에 진짜 가까운 절반"으로만 국한해 이 역전을 막는다.
function axisRamp(pts, halfLen, dist) {
  const f = halfLen > 0 ? Math.min(1, Math.max(0, dist / halfLen)) : 1;   // 0=가장자리,1=중심
  if (f > 0.5) return 0;   // 중심측 절반은 "벌크" — 보정 없음
  const thk = pts[2] + (pts[1] - pts[2]) * (f / 0.5);
  const range = Math.max(1e-6, pts[1] - pts[2]);
  return Math.min(1.3, Math.max(0, (pts[1] - thk) / range));
}

// L3(X·Y 독립 두께 프로필)의 가장자리 보정 — applyTaperEdgeBoost와 같은 "평균 대비 절대량,
// 기존 최댓값 캡" 원칙을 X·Y 두 축 각각의 램프 중 더 큰 쪽(Math.max)으로 적용한다. 두 축의
// dx/dy를 그대로(독립적으로) 쓴다 — 모서리에서 하나의 블렌드 거리로 합쳐버리면(예전 구현) X·Y
// 각자의 실제 거리와 무관하게 같은 값을 강제로 공유하게 돼, 이 레벨의 핵심 취지인 "축별 독립
// 효과"가 모서리 부근에서 깨진다. 모서리 자체는 두 축 램프 중 큰 쪽(Math.max)이 자연스럽게
// 반영하므로 별도 블렌드가 없어도 매끄럽다.
function applyAxisEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {
  const { x: ex, y: ey } = edge;
  const halfX = X / 2, halfY = Y / 2;
  let sum = 0, maxF = -Infinity;
  for (let k = 0; k < f.length; k++) { sum += f[k]; if (f[k] > maxF) maxF = f[k]; }
  const avg = f.length ? sum / f.length : 0;
  for (let j = 0; j < ny; j++) {
    const py = ny === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (ny - 1));
    const dy = ny === 1 ? halfY : Math.min(py, Y - py);
    for (let i = 0; i < nx; i++) {
      const px = nx === 1 ? X / 2 : x0 + (x1 - x0) * (i / (nx - 1));
      const dx = Math.min(px, X - px);
      const boost = Math.max(ex.boostMax * axisRamp(ex.pts, halfX, dx), ey.boostMax * axisRamp(ey.pts, halfY, dy));
      if (boost > 0) {
        const idx = j * nx + i;
        f[idx] = Math.min(maxF, f[idx] + avg * boost);
      }
    }
  }
}

// L4(형상·정밀)의 가장자리 보정 — LED 바로 위 flat 패드(반경 flatHalf) 밖, 다음 LED와의
// 중간 지점(halfP, 재료가 가장 얇아지는 곳)까지 선형으로 boostMax까지 올라간다. 실제
// l4RiseAt()의 호+직선 곡선을 그대로 재현하진 않지만(호 구간은 완만하게 시작하므로 선형은
// 다소 보수적인 근사), "flat 패드 밖은 0, 가장 얇은 지점은 최대"라는 핵심 방향은 같다.
// 가장 가까운 LED까지의 거리는 LED가 격자 배치라는 전제로 X·Y 각각 가장 가까운 LED
// 좌표를 독립적으로 찾아 hypot으로 합친다 — 격자(카티전 곱)에서는 이게 실제 최근접 LED와
// 정확히 같다(모든 X·Y 조합이 실재하므로), 그러면서도 LED 전체를 훑는 것보다 훨씬 싸다.
function applyRadialEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge, leds, halfP) {
  if (!leds || !leds.length) return;
  const { flatHalf, boostMax } = edge;
  const lxs = [...new Set(leds.map((l) => l.x))].sort((a, b) => a - b);
  const lys = [...new Set(leds.map((l) => l.y))].sort((a, b) => a - b);
  const hp = Math.max(flatHalf + 1e-6, halfP ?? 1);
  const nearest = (arr, v) => {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    const c1 = arr[lo], c0 = lo > 0 ? arr[lo - 1] : c1;
    return Math.abs(v - c0) <= Math.abs(v - c1) ? c0 : c1;
  };
  let sum = 0, maxF = -Infinity;
  for (let k = 0; k < f.length; k++) { sum += f[k]; if (f[k] > maxF) maxF = f[k]; }
  const avg = f.length ? sum / f.length : 0;
  for (let j = 0; j < ny; j++) {
    const py = ny === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (ny - 1));
    const nyv = nearest(lys, py);
    for (let i = 0; i < nx; i++) {
      const px = nx === 1 ? X / 2 : x0 + (x1 - x0) * (i / (nx - 1));
      const nxv = nearest(lxs, px);
      const dist = Math.hypot(px - nxv, py - nyv);
      const ramp = Math.min(1, Math.max(0, (dist - flatHalf) / (hp - flatHalf)));
      const boost = boostMax * ramp;
      if (boost > 0) {
        const idx = j * nx + i;
        f[idx] = Math.min(maxF, f[idx] + avg * boost);
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
