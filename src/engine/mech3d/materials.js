// 3D 기구 모드 소재 카탈로그 — spec 2026-10-14 §3.2(부품 소재)·§3.3(면 처리). 화면 라벨·기본값·검증(순수 JS, 불변 갱신).
// 물리 해석(μs·g·μa 등)은 P2 추적기에서 이 값을 읽어 수행한다.
export const RESIN_N = { PC: 1.586, PMMA: 1.49 };

export const PART_KINDS = {
  milky: { label: 'Milky' },
  clear: { label: '투명' },
  whiteTrans: { label: '반투과 백색' },
  opaque: { label: '불투명' },
};

export const FINISH_KINDS = {
  gloss: { label: '광택', hasR: false },
  whiteDiffuse: { label: '백색 확산 반사', hasR: true, R: 0.85 },
  metal: { label: '금속 증착·크롬', hasR: true, R: 0.88 },
  black: { label: '흑색', hasR: true, R: 0.05 },
};

// T: 기준 두께 tRef(mm)에서의 투과율(0~1). milky: 0~10, dbId: 실측소재 DB id('' = 추상 Milky)
export function defaultMaterial(kind) {
  switch (kind) {
    case 'milky': return { kind, dbId: '', milky: 5, resin: 'PC' };
    case 'clear': return { kind, resin: 'PC', T: 1, tRef: 2 };
    case 'whiteTrans': return { kind, resin: 'PC', T: 0.1, tRef: 1.5 };
    case 'opaque': return { kind };
    default: throw new Error(`알 수 없는 소재 종류: ${kind}`);
  }
}

export function defaultFinish(kind, R) {
  const f = FINISH_KINDS[kind];
  if (!f) throw new Error(`알 수 없는 면 처리: ${kind}`);
  return f.hasR ? { kind, R: R ?? f.R } : { kind };
}

// 소재를 고르면 따라오는 면 처리 기본값: 불투명 = 백색 확산 반사, 그 외(빛이 들어가는 소재) = 광택
export function finishForMaterial(material) {
  return material.kind === 'opaque' ? defaultFinish('whiteDiffuse') : defaultFinish('gloss');
}

export function defaultPart(id, name, volume) {
  const material = defaultMaterial('opaque');
  return { id, name, volume, material, finish: finishForMaterial(material), faceFinish: {} };
}

export function setPartMaterial(part, kind) {
  const material = defaultMaterial(kind);
  return { ...part, material, finish: finishForMaterial(material), faceFinish: {} };
}

export function setPartMaterialParam(part, key, value) {
  return { ...part, material: { ...part.material, [key]: value } };
}

// face = null 이면 부품 기본 면 처리, 숫자면 그 면만 덮어쓰기(finish = null 이면 덮어쓰기 해제)
export function setPartFinish(part, face, finish) {
  if (face == null) return { ...part, finish };
  const faceFinish = { ...part.faceFinish };
  if (finish == null) delete faceFinish[face]; else faceFinish[face] = finish;
  return { ...part, faceFinish };
}

export function resolveFinish(part, face) { return part.faceFinish?.[face] ?? part.finish; }

// 빛이 내부로 들어가는 소재의 굴절률(불투명이면 null)
export function partIndex(material) {
  return material.kind === 'opaque' ? null : (RESIN_N[material.resin] ?? RESIN_N.PC);
}

export function validatePart(part) {
  const e = [], m = part.material;
  if (!PART_KINDS[m.kind]) e.push(`소재 종류 오류: ${m.kind}`);
  if (m.kind === 'milky' && !(m.milky >= 0 && m.milky <= 10)) e.push('Milky 는 0~10');
  if (m.kind === 'clear' || m.kind === 'whiteTrans') {
    if (!(m.T > 0 && m.T <= 1)) e.push('투과율은 0 초과 100% 이하');
    if (!(m.tRef > 0)) e.push('기준 두께는 0 초과');
  }
  if (m.resin != null && !RESIN_N[m.resin]) e.push(`수지 오류: ${m.resin}`);
  for (const f of [part.finish, ...Object.values(part.faceFinish ?? {})]) {
    const k = FINISH_KINDS[f?.kind];
    if (!k) e.push(`면 처리 오류: ${f?.kind}`);
    else if (k.hasR && !(f.R >= 0 && f.R <= 1)) e.push(`${k.label} 반사율은 0~100%`);
  }
  return e;
}
