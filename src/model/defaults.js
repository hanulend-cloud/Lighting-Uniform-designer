// 기본 입력 사양 + 비용 계수 + 최적화 범위
// 프로젝트.md §3. 단위: 길이 mm, 각도 deg, 광속 lm, 전력 W
// 확산판 없음 — 기구물(몰드 부품)이 최종 광학부품. 관찰면 = 기구물 상면 +0.1mm.

import { LEVEL_DEFAULTS } from './levels.js';
export { LEVEL_DEFAULTS };

export const DEFAULT_SPEC = {
  ver: 10,                      // 저장 스펙 마이그레이션용(main.migrate)
  target:  { xLen: 100, yLen: 100, shape: 'flat' },
  // edgeMargin: 균일도 판정에서 제외할 가장자리 비율(축별). 0 = 타겟 전체에서 균일도를 확보한다
  // (기본). 베젤이 타겟 가장자리를 가리는 제품이면 그 폭만큼 올려 판정을 완화할 수 있다.
  // centerArea: 균일도 1차 판정 영역 = 타겟 면적의 중심 이 비율(0.95 → 각 변 1.27% 씩 안쪽).
  goal:    { U0: 0.80, cvMax: 0.15, gradMax: 0.20, edgeMargin: 0, centerArea: 0.95 },
  led: {
    sizeX: 2, sizeY: 2, sizeZ: 0.5,
    beamX: 120, beamY: 120,
    model: 'lambertian',       // 'lambertian' | 'gaussian'
    fluxLm: 0,                  // 0 = 상대 조도 모드
    color: 'white',
  },
  space:   { depth: 12 },       // 최대 허용 깊이 (LED면 → 기구물 상면)
  body:    { baseThk: 3, n: 1.59, material: 'PC' }, // 기준 두께·굴절률(측벽 프레넬 반사·상면 투과율에 사용)
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
  // maxOverhang: LED 배치를 포함한 전체 기구 크기가 타겟 X·Y 각각의 크기 대비 최대 이 비율까지만
  // 커지도록 허용(0.10 → 기구 ≤ 1.1·X × 1.1·Y, 각 변 +5%). 가장자리 조도 저하 폭은 깊이(LED→
  // 관찰면)가 정하므로 후보는 깊이 배수 mm 로 잡되(solver.overhangCandidates) 축별로 이 캡에서
  // 잘린다 — 짧은 축은 캡이 깊이보다 작을 수 있고, 그러면 타겟 전체 판정에서 목표를 못 채운다.
  opt: { pitchMin: 1, pitchMax: 80, maxOverhang: 0.10, difficultyLevels: [1, 2, 3, 4, 5], weightProfile: 'balanced' },
};
