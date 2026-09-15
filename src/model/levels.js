// 난이도별 파라미터 스키마 + 물리 효과(유효 혼합폭 X/Y·투과율) + 단면 형상.
// 각 난이도는 독립 체크박스로 on/off — 여러 개를 동시에 조합 가능.
// 프로젝트.md §Stage1. 계수는 캘리브레이션 대상.

import { lambertianExponent } from '../engine/photometry.js';

export const LEVEL_SCHEMA = {
  1: {
    label: '평판 두께', hint: '몸체 두께 (형상과 함께 적용 가능)',
    fields: [{ key: 'thk', label: '두께', unit: 'mm', min: 0.5, max: 20, step: 0.5 }],
    desc: '기구물 몸체 두께. 다른 난이도의 형상 위에도 함께 적용.',
  },
  2: {
    label: '확산소재', hint: 'Milky resin · 1=투명 ~ 10=최대확산',
    fields: [
      { key: 'milky', label: 'Milky', unit: '1~10', min: 1, max: 10, step: 0.5 },
      { key: 'decenterX', label: 'De-centerX', unit: 'mm', min: -30, max: 30, step: 1, adv: true },
      { key: 'decenterY', label: 'De-centerY', unit: 'mm', min: -30, max: 30, step: 1, adv: true },
    ],
    desc: 'Milky resin 사용도. 1=투명(효과 없음), 10=최대(후방산란→기판 반사 재순환으로 확산 최대·투과율 최저). 확산은 캐비티 깊이에 비례. De-center는 LED 배열 전체를 타겟 중심에서 X·Y로 밀어 배치 공차/비대칭을 검토하는 용도(광학 확산과는 무관, 배치만 이동).',
  },
  3: {
    label: '형상·자유(도파관)', hint: 'X·Y 독립 두께 프로필(중심·중간·가장자리) · 가장자리 경사 굴절만 유효',
    fields: [
      { key: 'tx0', label: 'X중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx100', label: 'X가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty0', label: 'Y중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty100', label: 'Y가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx50', label: 'X중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'ty50', label: 'Y중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'edgeR', label: '모서리R', unit: 'mm', min: 0, max: 50, step: 1, adv: true },
    ],
    desc: '기구물 두께를 X·Y축 각각 중심→가장자리 3점(중심·중간·가장자리)으로 독립 지정하는 투명 형상. 확산재가 없는 투명 소재는 평탄한 벌크 영역 자체로는 빛을 거의 퍼뜨리지 못한다(산란원이 없어 TIR로 갇힌 빛도 각도를 바꾸지 못함) — 실질적인 효과는 경사진 가장자리(중간→가장자리 구간)에서의 굴절 재방향뿐이라, tx100/ty100(가장자리 두께)이 작을수록 그 축의 가장자리가 국소적으로 밝아진다. X·Y를 다르게 주면 축별로 그 국소 보정이 달라진다. 모서리R로 네 모서리를 둥글게 해 집광(핫스팟) 없이 고르게 퍼지도록 함. 면적 전체의 확산은 이 레벨만으로는 한계가 있으니 L2(확산소재)를 함께 켜야 한다.',
  },
  4: {
    label: '형상·정밀', hint: 'X·Y 각도/크기 개별 조정 (L3 대체)',
    fields: [
      { key: 'gap', label: 'Gap', unit: 'mm', min: 0.5, max: 15, step: 0.5 },
      { key: 'flatX', label: 'FlatX', unit: 'mm', min: 1, max: 40, step: 1 },
      { key: 'flatY', label: 'FlatY', unit: 'mm', min: 1, max: 40, step: 1 },
      { key: 'angleX', label: '각도X', unit: '°', min: 5, max: 85, step: 5 },
      { key: 'angleY', label: '각도Y', unit: '°', min: 5, max: 85, step: 5 },
      { key: 'rise', label: 'Gap확대', unit: 'mm', min: 0, max: 25, step: 1 },
      { key: 'radiusX', label: 'R(X)', unit: 'mm', min: 0, max: 15, step: 0.5, adv: true },
      { key: 'radiusY', label: 'R(Y)', unit: 'mm', min: 0, max: 15, step: 0.5, adv: true },
    ],
    desc: 'L3 형상의 전이부 경사각과 flat 크기를 X·Y로 개별 조정. (켜지면 L3 대체) LED 정면은 FLAT 유지, 그 바깥은 flat과 접선으로 이어지다 지정한 각도(angleX·Y)의 직선 경사로 자연스럽게(꺾임 없이) 이어지는 R(X)·R(Y) 라운드 전이 — R이 클수록 확산도 강화.',
  },
  5: {
    label: '미세패턴', hint: '기구물 하단 돌기 · 크기=pitch(패킹), X·Y 각도',
    fields: [
      { key: 'ptype', label: '패턴', type: 'select', options: ['pyramid', 'dome', 'prism'], fixed: true },
      { key: 'sizeX', label: '크기X', unit: 'mm', min: 0.05, max: 3, step: 0.05 },
      { key: 'sizeY', label: '크기Y', unit: 'mm', min: 0.05, max: 3, step: 0.05 },
      { key: 'angleX', label: '각도X', unit: '°', min: 10, max: 80, step: 5 },
      { key: 'angleY', label: '각도Y', unit: '°', min: 10, max: 80, step: 5 },
      { key: 'dir', label: '방향', type: 'select', options: ['돌출', '오목'], adv: true },
      { key: 'depth', label: '깊이', unit: 'mm', min: 0.05, max: 2, step: 0.05, adv: true },
    ],
    desc: '기구물 하단(LED 대향면)의 미세 돌기(피라미드/반구/프리즘) 어레이. 돌기 크기가 곧 배열 pitch(맞닿게 배치). 각도로 산란 세기 조절. 방향(돌출/오목)·깊이로 형상과 산란 강도를 함께 조정. 형상과 병용 가능. 기본 패턴(pyramid)이 산란력이 가장 커 자동탐색의 기준 형상 — 크기·각도·깊이·방향만 최적화.',
  },
};

export const LEVEL_DEFAULTS = {
  1: { on: true, thk: 3 },
  2: { on: false, milky: 1, decenterX: 0, decenterY: 0 },
  3: { on: true, tx0: 3, tx50: 2, tx100: 1, ty0: 3, ty50: 2, ty100: 1, edgeR: 5 },
  4: { on: false, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 },
  5: { on: false, ptype: 'pyramid', sizeX: 0.3, sizeY: 0.3, angleX: 40, angleY: 40, dir: '돌출', depth: 0.2 },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const iso = (b, transmit) => ({ blurX: b, blurY: b, transmit });

// LED 기판 면(솔더마스크·부품·패턴 혼재)의 확산 반사율 — L2 재순환 확산의 기준값. 백색
// 반사시트를 가정하지 않고 보수적으로 잡음(사용자 지정). 입력 항목은 아니며 실측 시 캘리브레이션 대상.
const BOARD_REFL = 0.5;

// L3 두께(tx0/tx50/tx100 등)의 물리적 상·하한 — L3(X·Y 독립 두께 프로필)와 l3BotZAt(형상)가
// 공유. 하한은 몸체 최소 두께, 상한은 주어진 깊이 안에서 LED와 부딪히지 않는 최대 두께.
function thicknessBounds(spec, d) {
  const minThk = Math.max(1, (spec.body?.baseThk ?? 3) * 0.5);
  const maxThk = Math.max(minThk, d - (spec.led?.sizeZ ?? 0.5) - 0.5);
  return { minThk, maxThk };
}

export function levelParams(spec, level) {
  return { ...LEVEL_DEFAULTS[level], ...(spec?.levels?.[level] || {}) };
}

// 활성 난이도 목록
export function activeLevels(spec) {
  return [1, 2, 3, 4, 5].filter((l) => spec?.levels?.[l]?.on);
}

// 개별 난이도의 물리 효과 (blur X/Y mm + 투과율)
export function levelEffect(spec, level, depth) {
  const d = depth ?? spec.space.depth;
  const p = levelParams(spec, level);

  switch (+level) {
    case 1:
      // 클리어 평판: 광학적 확산 없음 (얇은 슬래브의 TIR 혼합은 무시 가능)
      return iso(0, 1);

    case 2: {
      // Milky resin = 부피 산란 확산재. 지배 메커니즘은 "후방산란 재순환": 확산재에 닿은 빛 중
      // R_d(=0.9t) 만큼이 캐비티로 되돌아가 LED 기판(BOARD_REFL)에 반사돼 다시 올라온다. 한 번
      // 왕복마다 Lambertian 2회 홉(↓d, ↑d) 만큼 옆으로 번지고(cos⁴ 조도의 HWHM=0.643h → σ≈0.546h,
      // 2홉 합산 σ₁≈0.77d), 왕복 횟수는 비율 ρ=R_d·BOARD_REFL 의 기하분포이므로 분산 합
      // σ²=σ₁²·ρ/(1-ρ) 를 단일 Gaussian 으로 근사한다. 출사광도 재순환만큼 회복: (1-R_d)/(1-ρ).
      // 판 두께 안의 전방산란(≈두께 수준, 1~3mm)은 이보다 훨씬 작아 생략.
      // 예전 공식(blur = milky·depth·11)은 blur 를 타겟보다 훨씬 크게 잡아 배열 전체가 하나의
      // 거대한 봉우리로 뭉개졌고, 그 결과 (a) 균일도가 피치에 무관해져 LED 수 결정이 무의미해지고
      // (b) 측벽 반사의 영향이 완전히 가려졌다 — 100×20mm 스트립 실측 비교로 확인.
      const t = clamp(((p.milky ?? 1) - 1) / 9, 0, 1);
      const Rd = 0.9 * t;
      const rho = Rd * BOARD_REFL;
      const b = 0.77 * d * Math.sqrt(rho / (1 - rho));
      // De-center: 광학(확산)과는 무관 — LED 배열 전체를 타겟 중심에서 X·Y로 평행이동만.
      return { blurX: b, blurY: b, transmit: (1 - Rd) / (1 - rho), decenterX: p.decenterX ?? 0, decenterY: p.decenterY ?? 0 };
    }

    case 3: {
      // 균일두께 도파관 — 광학적으로 유효한 산란원은 경사진 가장자리(테이퍼)에서의 굴절
      // 재방향뿐이다(Snell 굴절: 평탄면 기준으로는 임계각 밖이라 갇히던 광선도, 그 위치가
      // 기울어져 있으면 그 지점의 법선 기준 임계각 안에 들어 실제로 빠져나감 — edgeBoost가
      // 이 효과를 담당). 반면 평탄한 벌크 영역은 확산재·추출 패턴이 전혀 없는 매끈한 두
      // 평행면(TIR) 사이 공간이라, 갇힌 빛의 진행각을 바꿔줄 산란원이 없다 — 여러 번
      // 왕복해도 같은 각도로 계속 진행할 뿐 넓게 퍼지지 않는다(project.md §9: "산란은
      // 소재 haze·미세패턴·형상에서만 발생" — 여기서 "형상"은 경사면 굴절이지 매끈한
      // 평행판 자체의 확산이 아니다). 이전 버전은 중심 두께에 비례하는 bulk-blur를 벌크
      // 영역에도 적용했는데, 투명 소재만으로는 그 정도 확산이 실제로 나타나기 어렵다는
      // 지적(실사용 피드백)에 따라 제거한다 — 투명 소재는 형상(테이퍼)만으로 확산에 거의
      // 기여하지 못하고, 면적 전체의 확산을 원하면 L2(확산소재)가 필요하다.
      const { minThk, maxThk } = thicknessBounds(spec, d);
      const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
      const tx0 = clampThk(p.tx0, 3), tx50 = clampThk(p.tx50, 2), tx100 = clampThk(p.tx100, 1);
      const ty0 = clampThk(p.ty0, 3), ty50 = clampThk(p.ty50, 2), ty100 = clampThk(p.ty100, 1);

      // 보조 보정: 중심→가장자리 두께 낙차만큼 계수(0.03)·캡(0.06)으로 국소 보정 세기를
      // 정한다. 실제 픽셀별 보정은 directLit.js의 applyAxisEdgeBoost()가 이 edgeBoost.kind
      // ='axis'를 소비해 수행한다(computeField → applyEdgeBoost 디스패치).
      // 캡은 원래 0.25(구 L3와 동일)였으나, 낙차가 큰 프로파일(예: tx0≫tx100)에서 avg·boostMax가
      // 보정 전 필드의 자연스러운 변동폭보다 커져 보정 영역 대부분이 캡(=필드 최댓값)에 그대로
      // 붙어버리는 "평평한 최댓값 띠"를 만드는 문제가 실측으로 확인됨 — 축별 독립 램프를 도입한
      // 이후에도(타겟 중심 20mm 밖 전체가 캡에 닿아 중심이 상대적으로 눌려 보이는 정도) 남아 있어
      // 캡을 0.06으로 낮췄다(같은 스펙에서 캡에 붙는 셀 비율 67%→8%, 균일도는 93.0%→92.7%로
      // 거의 그대로 — 실측 스윕으로 확인).
      const boostMaxX = clamp(0.03 * (tx0 - tx100), 0, 0.06);
      const boostMaxY = clamp(0.03 * (ty0 - ty100), 0, 0.06);
      const cornerR = Math.max(0, p.edgeR ?? 0);
      return {
        blurX: 0, blurY: 0, transmit: 0.97,
        edgeBoost: {
          kind: 'axis',
          x: { pts: [tx0, tx50, tx100], boostMax: boostMaxX },
          y: { pts: [ty0, ty50, ty100], boostMax: boostMaxY },
          cornerR,
          hasBoost: boostMaxX > 0 || boostMaxY > 0,
          searchMag: boostMaxX + boostMaxY + cornerR * 0.01,
        },
      };
    }

    case 4: {
      const rise = p.rise ?? 8;
      // R(radiusX/Y)만큼 flat→경사 전이가 둥글게(라운드) 이어져 광량 변화가 더 매끄러워짐 → 확산 보강.
      // (자동탐색이 각도·R 자유도로 LED수를 최소화할 때 R도 실제로 쓸 수 있는 손잡이가 되도록)
      const f = (ang, r) => 0.35 * rise + 0.007 * (ang ?? 45) * Math.sqrt(Math.max(0, rise)) + 0.05 * d + 0.15 * (r ?? 0);
      return { blurX: f(p.angleX, p.radiusX), blurY: f(p.angleY, p.radiusY), transmit: 0.95 };
    }

    case 5: {
      const typeK = { pyramid: 1.0, dome: 0.78, prism: 0.55 }[p.ptype] ?? 0.8;
      const depthMag = p.depth ?? 0.2;
      const depthK = clamp(depthMag / 0.3, 0.3, 2.5);      // 깊이가 클수록(기준 0.3mm) 산란 강화
      const dirK = p.dir === '오목' ? 0.85 : 1.0;           // 오목(recess)은 빛이 덜 갇혀 산란이 소폭 약함
      // 돌기 크기 = 배열 pitch (맞닿게). 미세할수록 산란이 더 균질 → 약간 강화
      const f = (ang, sz) => {
        const cone = clamp(0.013 * (ang ?? 40) * typeK, 0, 1.3);   // facet 굴절 산란 반각
        const fine = 1 + 0.4 * clamp(1 - (sz ?? 0.3), 0, 1);
        return cone * d * fine * depthK * dirK;
      };
      return { blurX: f(p.angleX, p.sizeX), blurY: f(p.angleY, p.sizeY), transmit: 1 - 0.09 * typeK };
    }

    default:
      return iso(0, 1);
  }
}

// 레벨 고유 파라미터 자유도 안에서 확산(blur)을 최대/최소로 미는 값 탐색.
// levelEffect() 가 그리드 계산 없는 순수 수식이라 좌표하강으로도 충분히 빠르다.
// (필드/파라미터 상호작용을 가정하지 않는 범용 탐색 — 특정 공식의 단조성을 하드코딩하지 않음)
export function extremeDiffusionParams(level, depth, mode = 'max') {
  const schema = LEVEL_SCHEMA[level];
  if (!schema) return null;
  const better = mode === 'max' ? (a, b) => a > b : (a, b) => a < b;
  // L3처럼 균일 blur 대신 위치 의존 edge boost 로 기여하는 레벨도 있어, 그 크기(boostMax)를
  // 같은 비교축에 더해 자동탐색이 그 손잡이도 실제로 밀어볼 수 있게 한다(모서리R은 보조 가중치).
  const mag = (p) => {
    const e = levelEffect({ levels: { [level]: p } }, level, depth);
    const edgeMag = e.edgeBoost ? e.edgeBoost.searchMag : 0;
    return Math.hypot(e.blurX, e.blurY) + edgeMag;
  };

  let best = { ...LEVEL_DEFAULTS[level] };
  let bestMag = mag(best);
  for (let round = 0; round < 3; round++) {
    for (const f of schema.fields) {
      if (f.fixed) continue;   // 정책상 고정 필드(예: L5 기본 패턴=pyramid) — 기본값 그대로 유지
      const candidates = f.type === 'select'
        ? f.options
        : [f.min, f.max, ...Array.from({ length: 7 }, (_, i) => f.min + (f.max - f.min) * (i + 1) / 8)];
      for (const v of candidates) {
        const cand = { ...best, [f.key]: v };
        const m = mag(cand);
        if (better(m, bestMag)) { bestMag = m; best = cand; }
      }
    }
  }
  return { params: best, effect: levelEffect({ levels: { [level]: best } }, level, depth) };
}

// 두 파라미터 세트를 t(0~1)로 선형보간 (select 필드는 b 값 고정)
export function lerpParams(level, a, b, t) {
  const schema = LEVEL_SCHEMA[level];
  const out = {};
  for (const f of schema.fields) {
    out[f.key] = f.type === 'select' ? b[f.key] : a[f.key] + (b[f.key] - a[f.key]) * t;
  }
  return out;
}

// 활성 난이도들의 조합 효과: blur 는 제곱합(√Σb²), 투과율은 곱
export function combinedEffect(spec, depth, active) {
  const A = new Set(active ?? activeLevels(spec));
  let bx2 = 0, by2 = 0, T = 1, decenterX = 0, decenterY = 0, edgeBoost = null;
  for (const l of [1, 2, 3, 4, 5]) {
    if (!A.has(l)) continue;
    if (l === 3 && A.has(4)) continue;          // L4 가 L3 대체
    const e = levelEffect(spec, l, depth);
    bx2 += e.blurX * e.blurX;
    by2 += e.blurY * e.blurY;
    T *= e.transmit;
    decenterX += e.decenterX ?? 0;
    decenterY += e.decenterY ?? 0;
    if (e.edgeBoost) edgeBoost = e.edgeBoost;   // L3 또는 L4(둘 중 켜진 쪽) — 위치 의존 가장자리 보정
  }
  return { blurX: Math.sqrt(bx2), blurY: Math.sqrt(by2), transmit: T, decenterX, decenterY, edgeBoost, active: [...A] };
}

// 판정용 가장자리 마진 — L3·L4 중 켜진 쪽이 실제로 가장자리를 보강한다는 근거(hasBoost)가
// 있으면 마진을 0으로 낮춰(=가장자리까지 전부 판정) 그 보강 효과가 실제로 반영되게 한다.
export function effectiveEdgeMargin(baseMargin, edgeBoost) {
  return edgeBoost?.hasBoost ? 0 : baseMargin;
}

// L3(자유형상 도파관)용 축별 두께 프로필 평가 — pts=[중심,중간,가장자리] 두께(mm),
// halfLen=중심→가장자리 거리(mm), dist=가장자리로부터의 거리(0=가장자리..halfLen=중심).
// directLit.js의 axisRamp()와 짝을 이루는 함수지만, 여긴 절대 두께(mm)를 반환한다는 점이 다르다.
function axisThickAt(pts, halfLen, dist) {
  const f = halfLen > 0 ? clamp(dist / halfLen, 0, 1) : 1;   // 0=가장자리,1=중심
  return f <= 0.5 ? pts[2] + (pts[1] - pts[2]) * (f / 0.5) : pts[1] + (pts[0] - pts[1]) * ((f - 0.5) / 0.5);
}

// L3(자유형상 도파관)의 실제 2D 두께 함수 — X·Y 각각 3점 프로필을 평가해 min(Tx,Ty)로 결합한다.
// directLit.js의 applyAxisEdgeBoost가 쓰는 "둥근 모서리 인지 거리" 공식과 반드시 같은 형태를
// 유지해야 광학 계산과 STEP 형상이 일치한다. bodyProfile·step-export.js가 공유.
export function l3BotZAt(spec, depth, x, y) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const sp3 = levelParams(spec, 3);
  const { minThk, maxThk } = thicknessBounds(spec, depth);
  const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
  const tx = [clampThk(sp3.tx0, 3), clampThk(sp3.tx50, 2), clampThk(sp3.tx100, 1)];
  const ty = [clampThk(sp3.ty0, 3), clampThk(sp3.ty50, 2), clampThk(sp3.ty100, 1)];
  const r = Math.max(0, Math.min(sp3.edgeR ?? 0, Math.min(X, Y) / 2));

  const dx = Math.min(x, X - x), dy = Math.min(y, Y - y);
  const rounded = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : null;
  const dxEff = rounded == null ? dx : rounded;
  const dyEff = rounded == null ? dy : rounded;
  const thk = Math.min(axisThickAt(tx, X / 2, dxEff), axisThickAt(ty, Y / 2, dyEff));
  return depth - thk;
}

// L4: flatHalf 밖 반경 rel(mm, flat 경계로부터) 위치에서의 상승량(mm). bodyProfile(X 단면)과
// plan.js(2D 등고선 — TOP VIEW 가 실제 형상과 다르게 보이던 문제)가 공식을 공유해 두 뷰가
// 같은 형상을 그리도록 한다.
function l4RiseAt(sp, rel) {
  const riseMax = sp.rise ?? 8;
  const angle = clamp(sp.angleX ?? 45, 1, 85) * Math.PI / 180;
  const slope = Math.tan(angle);
  const radiusX = Math.max(0, sp.radiusX ?? 0);
  if (radiusX <= 0) return Math.min(riseMax, slope * rel);
  // 원호(flat과 접선) → 각도(angle)에 도달하면 직선 경사로 연속(탄젠트) 전환
  const relAtTangent = radiusX * Math.sin(angle);
  const riseAmt = rel <= relAtTangent
    ? radiusX - Math.sqrt(Math.max(0, radiusX * radiusX - rel * rel))
    : radiusX * (1 - Math.cos(angle)) + slope * (rel - relAtTangent);
  return Math.min(riseMax, riseAmt);
}

// L4 전체 높이(botZ, mm): LED 로부터의 거리(dist, mm — X 단면이면 |x-ledX|, 2D 등고선이면
// 실제 반경거리)에서의 기구물 하면 위치. bodyProfile 과 buildGeometry(plan.js 용) 가 공유.
export function l4BotZAt(spec, active, depth, dist, halfP) {
  const ledTop = spec.led.sizeZ;
  const topZ = depth;
  const A = active instanceof Set ? active : new Set(active);
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const minBody = Math.max(1, baseThk * 0.5);
  const sp = levelParams(spec, 4);
  const gap = clamp(sp.gap ?? 2, 0.5, Math.max(0.5, topZ - ledTop - minBody));
  const flatHalf = (sp.flatX ?? 4) / 2;
  if (dist <= flatHalf) return ledTop + gap;
  const rel = Math.min(dist - flatHalf, halfP);
  return Math.min(topZ - minBody, ledTop + gap + l4RiseAt(sp, rel));
}

// 기구물 단면(X 방향): 활성 형상 난이도 기준
export function bodyProfile(spec, active, leds, depth, pitch, nx = 160) {
  const A = new Set(active ?? activeLevels(spec));
  const X = spec.target.xLen, Y = spec.target.yLen;
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const topZ = depth;
  const useL4 = A.has(4), useL3 = A.has(3) && !useL4;

  const lxs = useL4 ? [...new Set(leds.map((l) => l.x))].sort((a, b) => a - b) : null;
  const near = useL4 ? (lxs.length ? (x) => Math.min(...lxs.map((v) => Math.abs(x - v))) : () => 1e9) : null;
  const halfP = useL4 ? Math.max(1, pitch / 2) : null;

  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = (i / (nx - 1)) * X;
    const botZ = useL4 ? l4BotZAt(spec, A, depth, near(x), halfP)
      : useL3 ? l3BotZAt(spec, depth, x, Y / 2)
      : topZ - baseThk;
    pts.push({ x, botZ, topZ });
  }
  return pts;
}
