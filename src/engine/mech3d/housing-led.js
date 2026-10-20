// ④ 케이스 면 처리 후보·⑤ LED 높이 범위(순수) — spec §2.3c
// 등급 = 반사율 오름차순, 같은 반사율이면 백색 먼저(가공 쉬움). R 없는 면(광택 등) = 최저
export const FINISH_GRADES = [
  { kind: 'whiteDiffuse', R: 0.85 }, { kind: 'whiteDiffuse', R: 0.90 }, { kind: 'whiteDiffuse', R: 0.95 }, { kind: 'whiteDiffuse', R: 0.97 },
  { kind: 'metal', R: 0.88 }, { kind: 'metal', R: 0.95 },
];
const KIND_RANK = { whiteDiffuse: 0, metal: 1 };
export const gradeOf = (f) => (f?.R ?? 0) * 1000 + (KIND_RANK[f?.kind] ?? 2);
const sameFinish = (a, b) => a?.kind === b?.kind && Math.abs((a?.R ?? 0) - (b?.R ?? 0)) < 1e-9;
// 후보 = 등급 목록 ∪ 현재(중복 제거) — 등급 순, 현재 것은 current: true
export function finishOptions(current) {
  const out = FINISH_GRADES.map((f) => ({ ...f, current: !!current && sameFinish(f, current) }));
  if (current && !out.some((f) => f.current)) out.push({ kind: current.kind, ...(current.R != null ? { R: current.R } : {}), current: true });
  return out.sort((a, b) => gradeOf(a) - gradeOf(b));
}
// ④ 반사 소재표(spec P4 §2.3d) — R = 소재 기본, max = 상한(특수 표면처리 없이 넘을 수 없음). special = 특수 처리(기본 R 없음, short = 비교표 문구)
export const DEFAULT_FINISH_CATALOG = [
  { id: 'abs-white', name: '백색 ABS', kind: 'whiteDiffuse', R: 0.82, max: 0.85 },
  { id: 'pc-white', name: '백색 PC(일반 착색)', kind: 'whiteDiffuse', R: 0.85, max: 0.90 },
  { id: 'pbt-white', name: '백색 PBT', kind: 'whiteDiffuse', R: 0.85, max: 0.90 },
  { id: 'pc-hr', name: '고반사 백색 PC 그레이드', kind: 'whiteDiffuse', R: 0.95, max: 0.97 },
  { id: 'al-raw', name: '알루미늄(무처리)', kind: 'metal', R: 0.85, max: 0.88 },
  { id: 'coat-white', name: '고반사 백색 도장·반사 시트', short: '고반사 도장', kind: 'whiteDiffuse', R: null, max: 0.97, special: true },
  { id: 'coat-metal', name: '은·알루미늄 증착', short: '금속 증착', kind: 'metal', R: null, max: 0.95, special: true },
];
// 소재표 = 반사 소재 DB(spec P4 §2.3e) 목록 → 행 { id, name, short, kind, R, max, special, status, nSamples, origin }.
// src = DB(list()) | 항목 배열 | 없음(→ 기본 소재표, Node 시험·DB 로드 실패 대비). 기본 R ≤ 상한
export function catalogOf(src) {
  const list = Array.isArray(src) ? src : typeof src?.list === 'function' ? src.list() : null;
  if (!list) return DEFAULT_FINISH_CATALOG.map((e) => ({ ...e, special: !!e.special, status: 'example', nSamples: 0, origin: 'base' }));
  return list.map((e) => ({ id: e.id, name: e.name, ...(e.short ? { short: e.short } : {}), kind: e.kind, R: e.special || e.R == null ? null : Math.min(e.R, e.Rmax), max: e.Rmax,
    special: !!e.special, status: e.status, nSamples: e.samples?.length ?? 0, origin: e.origin ?? 'base' }));
}
// ④ 후보 — 소재 종류 등급 중 R ≤ 상한 + 현재 + (허용 시) 특수 처리(상한 R, special · coating = id; 소재로 닿는 값이면 뺌). 소재 미지정 = finishOptions(호환)
export function finishCandidatesFor({ catalog = DEFAULT_FINISH_CATALOG, materialId, current, allowSpecial = false } = {}) {
  const mat = catalog.find((e) => e.id === materialId && !e.special);
  if (!mat) return finishOptions(current);
  const out = FINISH_GRADES.filter((f) => f.kind === mat.kind && f.R <= mat.max + 1e-9).map((f) => ({ ...f, current: !!current && sameFinish(f, current) }));
  if (current && !out.some((f) => f.current)) out.push({ kind: current.kind, ...(current.R != null ? { R: current.R } : {}), current: true });
  if (allowSpecial) for (const e of catalog.filter((x) => x.special)) {
    const f = { kind: e.kind, R: e.max };
    if (!out.some((g) => sameFinish(g, f))) out.push({ ...f, current: false, special: true, coating: e.id });
  }
  return out.sort((a, b) => gradeOf(a) - gradeOf(b));
}
// 부품 반사 소재 지정(id = null → 해제) — 지정 시 면 처리 = 소재 종류·기본 R, 특수 표시 해제(면 덮어쓰기는 유지)
export function setReflMaterial(part, id, catalog = DEFAULT_FINISH_CATALOG) {
  const e = catalog.find((x) => x.id === id && !x.special), q = { ...part };
  if (!e) { delete q.reflMaterial; return q; }
  delete q.coating;
  return { ...q, reflMaterial: e.id, finish: { kind: e.kind, R: e.R } };
}
// 부품 반사율 상한 { kind, max, entry } — 특수 처리 > 소재 > 없음(null)
export function finishLimit(part, catalog = DEFAULT_FINISH_CATALOG) {
  const e = catalog.find((x) => x.id === part?.coating && x.special) ?? catalog.find((x) => x.id === part?.reflMaterial && !x.special);
  return e ? { kind: e.kind, max: e.max, entry: e } : null;
}
// 부품 편집기 면 처리 고침(face = null → 부품 기본) — 같은 종류 R 이 상한 초과면 상한으로(clamped). 부품 기본 종류가 특수 처리와 달라지면 특수 표시 해제
export function partFinishEdit(part, face, f, catalog = DEFAULT_FINISH_CATALOG) {
  let q = { ...part };
  if (face == null && q.coating && f?.kind !== catalog.find((x) => x.id === q.coating)?.kind) delete q.coating;
  const lim = finishLimit(q, catalog), clamped = !!(lim && f && f.R != null && f.kind === lim.kind && f.R > lim.max + 1e-9);
  const g = clamped ? { ...f, R: lim.max } : f;
  q = face == null ? { ...q, finish: g && { ...g } } : { ...q, faceFinish: (() => { const ff = { ...q.faceFinish }; if (g == null) delete ff[face]; else ff[face] = { ...g }; return ff; })() };
  return { part: q, clamped, max: lim?.max ?? null };
}
// 간섭 없이 갈 수 있는 거리(up = 관측 방향 +, down = −) − 여유. 막힘 없음(Infinity) → max 로 자름
export function ledHeightRange({ up, down, margin = 0.3, max = 10 }) {
  const lim = (v) => Math.min(max, Math.max(0, (Number.isFinite(v) || v === Infinity ? v : 0) - margin));
  return [-lim(down) || 0, lim(up)];
}
// 후보 n 개(0 = 현재 포함, 양 끝 포함) — 0 을 뺀 n−1 개를 양쪽 길이 비율로 나눔(길이 있는 쪽은 최소 1)
export function heightCandidates([lo, hi], n = 7) {
  const rd = (v) => Math.round(v * 1e3) / 1e3, a = Math.max(0, -lo), b = Math.max(0, hi), eps = 1e-6;
  if (a < eps && b < eps) return [0];
  let kn = a < eps ? 0 : b < eps ? n - 1 : Math.min(n - 2, Math.max(1, Math.round(((n - 1) * a) / (a + b))));
  const kp = n - 1 - kn, out = [0];
  for (let i = 1; i <= kn; i++) out.push(rd((-a * i) / kn));
  for (let i = 1; i <= kp; i++) out.push(rd((b * i) / kp));
  return [...new Set(out)].sort((x, y) => x - y);
}
