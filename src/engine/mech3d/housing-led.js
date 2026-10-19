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
