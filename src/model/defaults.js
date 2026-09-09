// 기본 입력 사양 + 비용 계수 + 최적화 범위
// 프로젝트.md §3. 단위: 길이 mm, 각도 deg, 광속 lm, 전력 W
// 확산판 없음 — 기구물(몰드 부품)이 최종 광학부품. 관찰면 = 기구물 상면 +0.1mm.

import { LEVEL_DEFAULTS } from './levels.js';
export { LEVEL_DEFAULTS };

export const DEFAULT_SPEC = {
  target:  { xLen: 300, yLen: 120, shape: 'flat' },
  goal:    { U0: 0.80, cvMax: 0.15, gradMax: 0.20, edgeMargin: 0.05 },
  led: {
    sizeX: 2, sizeY: 2, sizeZ: 0.5,
    beamX: 120, beamY: 120,
    model: 'lambertian',       // 'lambertian' | 'gaussian'
    fluxLm: 0,                  // 0 = 상대 조도 모드
    color: 'white',
  },
  space:   { depth: 12 },       // 최대 허용 깊이 (LED면 → 기구물 상면)
  body:    { baseThk: 3, n: 1.59, wallRefl: 0, material: 'PC' }, // 기준 두께·굴절률·측벽 반사(기본 0=무시)
  pattern: { pitchX: 3, rRadius: 0.5, rDepth: 0.25 }, // L5 미세패턴
  production:{ qty: 10000, targetUnitCost: 0 },
  power:   { wattage: 0, tjMax: 100 },

  // 현재안(미리보기): LED 피치 / 사용 깊이(≤ space.depth) / 기구 난이도 L1~L5
  preview: { ledPitch: 20, depth: 12, level: 3 },

  levels: structuredClone(LEVEL_DEFAULTS),

  // 비용·DFM 휴리스틱 (실측 단가로 교체 필요)
  cost: {
    ledUnit: 0.05,
    shapeBase: 0.30,
    shapeLevelMult: [1, 1.4, 2.0, 2.8, 4.0],       // L1~L5 (형상+소재+패턴 통합 난이도)
    moldPrice: [3000, 5000, 9000, 16000, 28000],   // ÷ 생산수량
    placeSec: 0.4,
    laborRatePerSec: 0.006,
    assemblyBase: 0.20,
    materialBase: 0.15,
    countPer1pt: 60,
  },

  // pitchMin은 보조 하한 — 실제 최소 피치는 LED 크기(led.sizeX/Y)+1mm가 결정.
  // maxOverhang: 기구물이 타겟보다 최대 이 비율만큼(X·Y 동일) 커지는 것까지 자동탐색 허용 —
  // 가장자리 LED 지원을 늘려 균일도 저하를 보강(0.10 = 최대 10%).
  opt: { pitchMin: 1, pitchMax: 80, maxOverhang: 0.10, difficultyLevels: [1, 2, 3, 4, 5], weightProfile: 'balanced' },
};
