// 3D 기구 모드 소재 카탈로그 — spec 2026-10-14 §3.2(부품 소재)·§3.3(면 처리). 화면 라벨·기본값·검증(순수 JS, 불변 갱신).
// 물리 해석(μs·g·μa 등)은 P2 추적기에서 이 값을 읽어 수행한다.
// 투명 소재 기본 DB(일반값, d선 589 nm 굴절률 · 2 mm 전광선 투과율(표면 반사 포함)) — 수지 id = RESIN_N 키
// 실제 부품은 등급·첨가제에 따라 다르므로 측정값이 있으면 사용자 항목(clearEntryFromForm)으로 등록해 씀
export const CLEAR_BASE = [
  { id: 'PC', name: 'PC (폴리카보네이트)', n: 1.586, T: 0.89, tRef: 2 },
  { id: 'PMMA', name: 'PMMA (아크릴)', n: 1.49, T: 0.92, tRef: 2 },
  { id: 'PS', name: 'PS (폴리스티렌)', n: 1.59, T: 0.88, tRef: 2 },
  { id: 'MS', name: 'MS (MMA-스티렌)', n: 1.564, T: 0.9, tRef: 2 },
  { id: 'COP', name: 'COP/COC (사이클로올레핀)', n: 1.53, T: 0.91, tRef: 2 },
  { id: 'PET', name: 'PET', n: 1.575, T: 0.88, tRef: 2 },
  { id: 'Glass', name: '유리 (BK7)', n: 1.517, T: 0.915, tRef: 2 },
  { id: 'Silicone', name: '실리콘 (광학용)', n: 1.41, T: 0.93, tRef: 2 },
];
export const RESIN_N = Object.fromEntries(CLEAR_BASE.map((e) => [e.id, e.n]));
// 부품 소재의 굴절률 — 측정값(material.n)이 있으면 그것, 없으면 수지 기본값
export const materialN = (m) => (Number.isFinite(m?.n) && m.n > 1 ? m.n : RESIN_N[m?.resin] ?? RESIN_N.PC);
// 투명 소재 고르기(불변) — 기본 항목: 수지 = id, 측정 굴절률 해제 · 사용자 항목: 수지 = 바탕 수지, n = 측정값. 둘 다 그 항목의 투과율·두께를 따름
export function applyClearEntry(part, e) {
  if (!e) return part;
  const { n, matId, ...m } = part.material, user = e.origin === 'user';
  const material = { ...m, resin: user ? (RESIN_N[e.base] ? e.base : 'PC') : e.id, ...(user ? { n: e.n, matId: e.id } : {}) };
  if (part.material.kind === 'clear') { material.T = e.T; material.tRef = e.tRef; }
  return { ...part, material };
}
// 측정값 양식 → 사용자 투명 소재 항목(순수). f = { name, base, n, T(%), t(mm), note } — 굴절률 빈칸 = 바탕 수지 값
export function clearEntryFromForm(f) {
  const name = String(f.name ?? '').trim(), base = RESIN_N[f.base] ? f.base : 'PC';
  if (!name) return { error: '이름을 넣으세요' };
  const n = String(f.n ?? '').trim() === '' ? RESIN_N[base] : +f.n, T = +f.T / 100, t = +f.t;
  if (!(n >= 1.2 && n <= 2.5)) return { error: '굴절률은 1.2 ~ 2.5' };
  if (!(T > 0 && T <= 1)) return { error: '투과율은 0 초과 100% 이하' };
  if (!(t > 0)) return { error: '측정 두께(mm)를 넣으세요' };
  return { entry: { id: `u:${name}`, name, base, n: Math.round(n * 10000) / 10000, T: Math.round(T * 10000) / 10000, tRef: t, note: String(f.note ?? '').trim(), origin: 'user' } };
}

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

// 반사 소재·특수 처리 표시(spec P4 §2.3d)는 면 처리가 기본값으로 돌아가므로 해제
export function setPartMaterial(part, kind) {
  const material = defaultMaterial(kind), { reflMaterial, coating, ...rest } = part;
  return { ...rest, material, finish: finishForMaterial(material), faceFinish: {} };
}

export function setPartMaterialParam(part, key, value) {
  return { ...part, material: { ...part.material, [key]: value } };
}

// face = null 이면 부품 기본 면 처리, 숫자면 그 면만 덮어쓰기(finish = null 이면 덮어쓰기 해제)
export function setPartFinish(part, face, finish) {
  if (face == null) return { ...part, finish: finish && { ...finish } };
  const faceFinish = { ...part.faceFinish };
  if (finish == null) delete faceFinish[face]; else faceFinish[face] = { ...finish };
  return { ...part, faceFinish };
}

export function resolveFinish(part, face) { return part.faceFinish?.[face] ?? part.finish; }

// 빛이 내부로 들어가는 소재의 굴절률(불투명이면 null)
export function partIndex(material) {
  return material.kind === 'opaque' ? null : materialN(material);
}

export function validatePart(part) {
  const e = [], m = part.material ?? {};
  if (!PART_KINDS[m.kind]) e.push(`소재 종류 오류: ${m.kind}`);
  if (m.kind === 'milky' && !(m.milky >= 0 && m.milky <= 10)) e.push('Milky 는 0~10');
  if (m.kind === 'clear' || m.kind === 'whiteTrans') {
    if (!(m.T > 0 && m.T <= 1)) e.push('투과율은 0 초과 100% 이하');
    if (!(m.tRef > 0)) e.push('기준 두께는 0 초과');
  }
  if (m.resin != null && !RESIN_N[m.resin]) e.push(`수지 오류: ${m.resin}`);
  if (m.n != null && !(m.n >= 1.2 && m.n <= 2.5)) e.push('굴절률은 1.2 ~ 2.5');
  for (const f of [part.finish, ...Object.values(part.faceFinish ?? {})]) {
    const k = FINISH_KINDS[f?.kind];
    if (!k) e.push(`면 처리 오류: ${f?.kind}`);
    else if (k.hasR && !(f.R >= 0 && f.R <= 1)) e.push(`${k.label} 반사율은 0~100%`);
  }
  return e;
}
