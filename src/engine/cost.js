// 휴리스틱 비용·DFM 모델 — 프로젝트.md §3.6
// 계수는 spec.cost (defaults.js) 에서 조정. 실측 단가 반영 필요.

export function estimate(spec, { ledCount, difficultyLevel }) {
  const C = spec.cost;
  const lvl = Math.min(5, Math.max(1, difficultyLevel));

  const led = ledCount * C.ledUnit;
  const shape = C.shapeBase * (C.shapeLevelMult[lvl - 1] ?? 1);   // 형상+소재+패턴 통합
  const mold = (C.moldPrice[lvl - 1] ?? 0) / Math.max(1, spec.production.qty);
  const assembly = ledCount * C.placeSec * C.laborRatePerSec + C.assemblyBase;
  const material = C.materialBase;

  const unit = led + shape + mold + assembly + material;
  const difficultyScore = Math.min(10, lvl * 1.6 + ledCount / C.countPer1pt);

  return {
    unit,
    breakdown: { led, shape, mold, assembly, material },
    difficultyScore,
  };
}

// 전력/효율 요약 (§3 출력8) — 상대 모드에서는 0
export function power(spec, ledCount) {
  const perLed = spec.power.wattage && ledCount ? spec.power.wattage / 1 : 0;
  const total = spec.power.wattage || 0;
  return { totalW: total, ledCount, perLedW: ledCount ? total / ledCount : 0 };
}
