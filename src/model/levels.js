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
    desc: 'Milky resin 사용도. 1=투명(효과 없음), 10=최대(균일도≈100%·투과율 최저). De-center는 LED 배열 전체를 타겟 중심에서 X·Y로 밀어 배치 공차/비대칭을 검토하는 용도(광학 확산과는 무관, 배치만 이동).',
  },
  3: {
    label: '형상·기본', hint: '균일두께 용기(도파관/TIR 라이트가이드) · 중앙 평탄 + 가장자리 사출빼기 테이퍼',
    fields: [
      { key: 'wallThk', label: '두께', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'edgeAngle', label: '가장자리각도', unit: '°', min: 5, max: 85, step: 5 },
      { key: 'edgeR', label: '모서리R', unit: 'mm', min: 0, max: 50, step: 1 },
    ],
    desc: '기구물 전체가 하나의 균일두께(두께) 용기 형상 — 진짜 도파관(TIR). LED 방출광 중 임계각 밖으로 나가는 성분은 슬래브 안에서 전반사(TIR)로 갇혀 옆으로 퍼진다 — 두께가 두꺼울수록 더 멀리 퍼져 확산이 커짐(도파관 원리, 전역 효과). 가장자리는 사출빼기용 각도(가장자리각도)로 얇아지며 그 경사면이 갇힌 빛의 실제 탈출구라 국소적으로 더 밝아짐. 네 모서리는 모서리R로 둥글게 해 집광(핫스팟) 없이 고르게 퍼지도록 함.',
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
  3: { on: true, wallThk: 3, edgeAngle: 45, edgeR: 5 },
  4: { on: false, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 },
  5: { on: false, ptype: 'pyramid', sizeX: 0.3, sizeY: 0.3, angleX: 40, angleY: 40, dir: '돌출', depth: 0.2 },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const iso = (b, transmit) => ({ blurX: b, blurY: b, transmit });

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
      const t = clamp(((p.milky ?? 1) - 1) / 9, 0, 1);
      const b = t <= 0 ? 0 : Math.pow(t, 1.2) * d * (1 + 10 * t);   // t=1 → U0≈100%
      // De-center: 광학(확산)과는 무관 — LED 배열 전체를 타겟 중심에서 X·Y로 평행이동만.
      return { blurX: b, blurY: b, transmit: 1 - 0.9 * t, decenterX: p.decenterX ?? 0, decenterY: p.decenterY ?? 0 };
    }

    case 3: {
      // 균일두께 용기 = 진짜 도파관(TIR 라이트가이드). LED 방출광 중 임계각(굴절률 n 기준) 밖으로
      // 나가는 성분은 슬래브 안에서 전반사(TIR)로 갇혀 옆으로 퍼지다가 가장자리(테이퍼)나 표면에서
      // 빠져나간다 — 두 가지 효과로 모델링:
      //  ① 전역 확산(bulk blur): 갇히는 광량 비율(fracTrapped, Lambertian 각분포 적분)만큼을 두께에
      //     비례한 넓은 blur 로 재분배 — wallThk 가 두꺼울수록 갇힌 빛이 더 멀리 퍼져 확산이 커짐.
      //  ② 가장자리 보정(edgeBoost): 갇힌 빛이 실제로 빠져나가는 지점 = 테이퍼 경사면이라, 가장자리
      //     에 가까울수록 국소적으로 더 밝아짐(기존 로직 유지).
      const n = spec.body?.n ?? 1.59;
      const critAngle = n > 1 ? Math.asin(1 / n) : Math.PI / 2;
      const mLamb = lambertianExponent(spec.led?.beamX ?? 120);
      const fracTrapped = clamp(Math.pow(Math.cos(critAngle), mLamb + 2), 0, 0.9);

      const minThk = Math.max(1, (spec.body?.baseThk ?? 3) * 0.5);
      const wallThk = Math.max(minThk, p.wallThk ?? 3);
      // 반사당 측면 이동거리 계수 — 임계각으로 진행하는 광선이 슬래브 상·하면을 한 번 왕복(TIR
      // 1회 바운스)할 때 옆으로 이동하는 거리 = 2·두께·tan(임계각). 이 부피 자체엔 확산제·추출
      // 패턴이 없으므로(사용자 지정 형상: 매끈한 균일두께 용기 + 가장자리 테이퍼만) 갇힌 빛이
      // 여러 번 바운스해도 위쪽 면으로 새 나갈 통로가 없다 — "바운스 1회분" 거리를 보수적
      // 상한으로 삼는다(예전엔 이 계수를 4로 임의 고정해, 두께만 늘려도 몇 개 안 되는 LED로
      // 목표를 달성하는 비현실적인 결과가 나왔다 — 실측 지적으로 확인 후 물리량으로 교체).
      const K_RANGE = 2 * Math.tan(critAngle);
      const bulkBlur = K_RANGE * wallThk * fracTrapped;

      // 가장자리 보정은 보조 효과로만 — 너무 강하면(넓은 tw · 큰 boostMax) 이미 잘 밝던 지점까지
      // 밀어올려 그 자체가 새 최댓값이 되어 min/max 를 오히려 악화시킴을 실측으로 확인.
      // 주 메커니즘은 위 bulkBlur(검증된 단조 개선)이고, 이건 그 위에 얹는 작은 다듬기 정도로 제한.
      const edgeAngleDeg = clamp(p.edgeAngle ?? 45, 1, 89);
      const edgeAngleRad = edgeAngleDeg * Math.PI / 180;
      const tw = wallThk > minThk ? (wallThk - minThk) / Math.tan(edgeAngleRad) : 0;
      const boostMax = clamp(0.03 * (wallThk - minThk) * Math.sin(edgeAngleRad), 0, 0.25);
      const cornerR = Math.max(0, p.edgeR ?? 0);
      return { blurX: bulkBlur, blurY: bulkBlur, transmit: 0.97, edgeBoost: { tw, boostMax, cornerR } };
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
    const edgeMag = e.edgeBoost ? e.edgeBoost.boostMax + e.edgeBoost.cornerR * 0.01 : 0;
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
    if (e.edgeBoost) edgeBoost = e.edgeBoost;   // 현재는 L3 만 제공(위치 의존 가장자리 보정)
  }
  return { blurX: Math.sqrt(bx2), blurY: Math.sqrt(by2), transmit: T, decenterX, decenterY, edgeBoost, active: [...A] };
}

// 판정용 가장자리 마진 — L3(균일두께 용기)가 켜져 있으면 마진을 0으로 낮춰(=가장자리까지 전부
// 판정) 그 보강 효과가 실제로 반영되게 한다. boostMax 는 진짜 경계(거리 0)에서 최대이고 tw
// 지점에서는 0으로 사그라들므로, 마진을 tw 로만 줄이면 정작 보강이 강한 구간은 여전히 제외돼
// 버린다(실측 확인) — L3 가 있으면 그 근거로 경계까지 그대로 신뢰하고 평가한다.
// (L3 가 없으면 항상 기본 마진 그대로.)
export function effectiveEdgeMargin(baseMargin, edgeBoost) {
  if (!edgeBoost || !(edgeBoost.tw > 0) || !(edgeBoost.boostMax > 0)) return baseMargin;
  return 0;
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
  const X = spec.target.xLen;
  const ledTop = spec.led.sizeZ;
  const topZ = depth;
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const minBody = Math.max(1, baseThk * 0.5);

  const useL4 = A.has(4), useL3 = A.has(3) && !useL4;

  if (useL3) {
    // 균일두께 용기(라이트가이드): 중앙 평탄(wallThk) + 가장자리 사출빼기 테이퍼(edgeAngle).
    // X 단면이라 코너 R(2D)은 표시하지 않음 — 광학 계산(computeField)에서는 2D로 반영.
    const sp3 = levelParams(spec, 3);
    const wallThk = Math.max(minBody, Math.min(sp3.wallThk ?? 3, topZ - ledTop - 0.5));
    const edgeAngleRad = clamp(sp3.edgeAngle ?? 45, 1, 89) * Math.PI / 180;
    const tw = wallThk > minBody ? (wallThk - minBody) / Math.tan(edgeAngleRad) : 0;
    const pts3 = [];
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * X;
      const edx = Math.min(x, X - x);
      const thk = edx >= tw ? wallThk : Math.max(minBody, wallThk - Math.tan(edgeAngleRad) * (tw - edx));
      pts3.push({ x, botZ: topZ - thk, topZ });
    }
    return pts3;
  }

  // 이 아래는 L4(형상·정밀)만 해당 — L3 는 위에서 이미 반환됨. l4BotZAt() 이 실제 형상 계산을
  // 전담 — plan.js(TOP VIEW 2D 등고선)도 같은 함수를 써서 두 뷰가 어긋나지 않게 한다.
  const lxs = [...new Set(leds.map((l) => l.x))].sort((a, b) => a - b);
  const near = lxs.length ? (x) => Math.min(...lxs.map((v) => Math.abs(x - v))) : () => 1e9;
  const halfP = Math.max(1, pitch / 2);

  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = (i / (nx - 1)) * X;
    const botZ = useL4 ? l4BotZAt(spec, A, depth, near(x), halfP) : topZ - baseThk;
    pts.push({ x, botZ, topZ });
  }
  return pts;
}

// L3(균일두께 용기)의 실제 2D 두께 함수 — bodyProfile의 X단면 공식을 X·Y 모두 반영하도록
// 일반화. directLit.js applyEdgeBoost()가 쓰는 "둥근 모서리 인지 가장자리 거리" 공식과
// 반드시 같은 형태를 유지해야 광학 계산(edgeBoost)과 STEP 형상이 일치한다.
export function l3BotZAt(spec, depth, x, y) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const sp3 = levelParams(spec, 3);
  const baseThk = spec.levels?.[1]?.on ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const minBody = Math.max(1, baseThk * 0.5);
  const topZ = depth;
  const wallThk = Math.max(minBody, Math.min(sp3.wallThk ?? 3, topZ - spec.led.sizeZ - 0.5));
  const edgeAngleRad = clamp(sp3.edgeAngle ?? 45, 1, 89) * Math.PI / 180;
  const tw = wallThk > minBody ? (wallThk - minBody) / Math.tan(edgeAngleRad) : 0;
  const r = Math.max(0, Math.min(sp3.edgeR ?? 0, tw));

  const dx = Math.min(x, X - x), dy = Math.min(y, Y - y);
  const edgeDist = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : Math.min(dx, dy);
  const thk = edgeDist >= tw ? wallThk : Math.max(minBody, wallThk - Math.tan(edgeAngleRad) * (tw - edgeDist));
  return topZ - thk;
}
