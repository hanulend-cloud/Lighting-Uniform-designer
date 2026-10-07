// Milky 눈금 — spec 2026-10-07 §4 (기준두께 차폐율). 소재 고유값(두께 무관), 정본 저장값은 μs'.
// Milky = 10 × (1 − T_s(μs') / T_s(0)),  T_s = 기준 슬래브(2mm, n 1.59, g 0.9, 흡수 0, 확산 입사) 전광선투과율.
export const MILKY_REF = { t: 2, n: 1.59, g: 0.9 };
export const MILKY_MAP_VER = 1;

function Tref(table, musR) {
  const q = table.query(musR * MILKY_REF.t, MILKY_REF.g, MILKY_REF.n, table.diffuseRow, 0);
  return q.Tb + q.Ts;
}

export function milkyFromMusR(table, musR) {
  if (!(musR > 0)) return 0;
  if (!Number.isFinite(musR)) return 10;
  const m = 10 * (1 - Tref(table, musR) / Tref(table, 0));
  return m < 0 ? 0 : m > 10 ? 10 : m;
}

export function musRFromMilky(table, m) {
  if (!(m > 0)) return 0;
  if (m >= 10) return Infinity;
  let lo = Math.log(1e-6), hi = Math.log(1e8);
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    if (milkyFromMusR(table, Math.exp(mid)) < m) lo = mid; else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}
