// ① Milky 재가중 — spec 2026-10-19 P4 §2.1. 기준 Milky m₀ 에서 추적한 광자를 다른 Milky m 의 기댓값으로 바꾸는 가중치.
// Milky = 입자 농도: 위상함수·g 고정, μs·μa 만 바뀐다(partOptics 규칙). 자유 비행은 μs 로 표본(mc3d), 흡수는 연속 가중 e^{−μa·t}.
// 그래서 경로 길이 L·산란 횟수 k 인 광자의 우도비 = (μs/μs₀)^k · e^{−(μs−μs₀)L} · e^{−(μa−μa₀)L}.
import { partOptics } from './optics.js';
import { MILKY_UI_MAX } from '../l2/material.js';

// 기준 m0 주변 n 점(간격 step). 범위 [step, MILKY_UI_MAX] 를 넘으면 창 전체를 안쪽으로 민다(점 수 유지)
export function milkyAxis(m0, step = 0.025, max = MILKY_UI_MAX, n = 21) {   // 기본 창 = 기준 ±0.25(ESS 한계, spec §2.1)
  const half = ((n - 1) / 2) * step;
  let lo = m0 - half;
  if (lo < step) lo = step;
  if (lo + 2 * half > max) lo = Math.max(step, max - 2 * half);
  return Array.from({ length: n }, (_, i) => Math.min(max, Math.round((lo + i * step) * 1e6) / 1e6));
}

// 부품(spec.mech3d.parts[i]) 의 Milky 를 바꿔 가며 광학값 — [{ milky, mus, mua, g }]
export function milkyGridOptics(part, { table, db = null }, milkies) {
  return milkies.map((m) => {
    const o = partOptics({ ...part, material: { ...part.material, milky: m } }, { table, db });
    return { milky: m, mus: o.mus, mua: o.mua, g: o.g };
  });
}

// 기준 광학값 base({mus, mua, g}) 와 격자 → 계수 { lr: ln(μs/μs₀), dm: Δ(μs+μa) }
export function rwCoeffs(base, grid) {
  if (!(base.mus > 0)) throw new Error('기준 Milky 의 μs 가 0 — 재가중은 Milky > 0 에서 시작해야 함');
  if (grid.some((g) => Math.abs(g.g - base.g) > 1e-9)) throw new Error('격자의 g 가 기준과 다름 — 재가중 불가');
  if (grid.some((g) => !(g.mus > 0))) throw new Error('격자 μs 가 0 — Milky > 0 이어야 함');
  const n = grid.length, lr = new Float64Array(n), dm = new Float64Array(n);
  grid.forEach((g, j) => { lr[j] = Math.log(g.mus / base.mus); dm[j] = g.mus + g.mua - (base.mus + base.mua); });
  return { n, lr, dm };
}
export const rwFactor = (C, j, L, k) => Math.exp(k * C.lr[j] - C.dm[j] * L);

// 유효 표본 비율 = (Σf)² / (n·Σf²) — 0.3 미만 격자점은 믿지 않음(spec §2.1)
export function essRatio(sf, sf2, n) {
  const out = new Float64Array(sf.length);
  for (let j = 0; j < sf.length; j++) out[j] = n > 0 && sf2[j] > 0 ? (sf[j] * sf[j]) / (n * sf2[j]) : 0;
  return out;
}
export const ESS_MIN = 0.3;
