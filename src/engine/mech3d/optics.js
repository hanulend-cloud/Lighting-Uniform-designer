// 3D 기구 부품 소재 → 광학 물성 — spec 2026-10-14 §3.2, §6.1·§6.2(Milky 레벨 = 입자 농도: μs·μa 비례, 위상함수 고정).
// 반환: 불투명 { transmissive:false } / 투과성 { transmissive:true, n, mus, g, mua, phase(null = HG(g)) }
import { l2Material, L2_G, MUA_RESIN } from '../l2/material.js';
import { musRFromMilky } from '../l2/milky.js';
import { particleOptics } from '../l2/mie.js';
import { RESIN_N } from './materials.js';

// 표의 수직 입사 행(μ = cosθ 가 1 에 가장 가까운 각도 행)
export function normalRow(table) {
  const R = table.grids.rows; let best = 0;
  for (let k = 0; k < table.angleRows; k++) if (Math.abs(R[k] - 1) < Math.abs(R[best] - 1)) best = k;
  return best;
}

const phaseCache = new Map();
function miePhaseOf(ent) {
  if (!phaseCache.has(ent.id)) {
    const p = ent.particle;
    phaseCache.set(ent.id, particleOptics({ d_um: p.d_um, nP: p.nP, nH: ent.n, lambda_um: p.lambda_um ?? 0.55 }).phase);
  }
  return phaseCache.get(ent.id);
}

function whiteTransMusR(table, T, tRef, n) {
  const row = normalRow(table), Tof = (musR) => { const q = table.query(musR * tRef, L2_G, n, row, 0); return q.Tb + q.Ts; };
  if (Tof(0) <= T) return 0;
  let lo = Math.log(1e-6), hi = Math.log(1e4);
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (Tof(Math.exp(mid)) > T) lo = mid; else hi = mid; }
  return Math.exp(0.5 * (lo + hi));
}

export function partOptics(part, { table, db = null }) {
  const m = part.material;
  if (m.kind === 'opaque') return { transmissive: false };
  const n0 = RESIN_N[m.resin] ?? RESIN_N.PC;
  if (m.kind === 'clear') {
    const R0 = ((n0 - 1) / (n0 + 1)) ** 2;
    return { transmissive: true, n: n0, mus: 0, g: 0, mua: Math.max(0, -Math.log(Math.min(1, m.T / (1 - R0) ** 2)) / m.tRef), phase: null };
  }
  if (m.kind === 'whiteTrans') {
    const musR = whiteTransMusR(table, m.T, m.tRef, n0);
    return { transmissive: true, n: n0, mus: musR / (1 - L2_G), g: L2_G, mua: MUA_RESIN, phase: null };
  }
  // milky
  const ent = m.dbId ? db?.get(m.dbId) : null;
  if (!ent) {
    const a = l2Material(table, m.milky, n0);
    return { transmissive: true, n: n0, mus: a.musR / (1 - a.g), g: a.g, mua: a.mua, phase: null };
  }
  const musR = musRFromMilky(table, m.milky), f = ent.fitted;
  const mua = f.musR > 0 ? f.mua * (musR / f.musR) : MUA_RESIN;
  return { transmissive: true, n: ent.n, mus: musR / (1 - f.g), g: f.g, mua, phase: ent.model === 'mie' && ent.particle ? miePhaseOf(ent) : null };
}
