// 소재 등록 피팅(모델 선택 포함) — tools/fit-db.mjs 와 브라우저 Web Worker 가 공용으로 쓴다 (spec §13).
// HG 로 V6 통과면 HG. 실패하고 입자 사양(particle)이 있으면 Mie 로 재피팅하고, 통과하면 소재별 응답표까지 만들어
// DB 항목(정본 = 측정 원자료 + 계수 + 검증 + 응답표)으로 돌려준다.
import { fitMaterial } from './fit.js';
import { fitParticle, buildMieTable, checkTransition, BEADS, HOST } from './mie-material.js';
import { f32ToB64 } from '../../model/materials-db.js';

export function fitEntry(table, e, { onProgress, date = new Date().toISOString().slice(0, 10) } = {}) {
  const hg = fitMaterial(table, e);
  let out = { ...e, model: 'HG', fitted: { musR: hg.mat.musR, g: hg.mat.g, mua: hg.mat.mua, free: hg.free }, validation: { V6: hg.V6, V9: hg.V9 },
    notes: hg.notes, fittedWith: { table: table.meta.created, date } };
  if (hg.V6.ok || !e.particle || !BEADS[e.particle.type]) return out;
  const bead = BEADS[e.particle.type], host = HOST[e.particle.host ?? 'PC'];
  onProgress?.({ stage: 'mie-fit', done: 0 });
  const p = fitParticle(table, e, bead, host, { onProgress: (n) => onProgress?.({ stage: 'mie-fit', done: n }) });
  const notes = [`HG 불일치(${hg.V6.note}) → Mie(${e.particle.type}${e.particle.assumed ? ' 가정' : ''}) 로 재피팅`, ...p.notes, ...p.fit.notes];
  if (!p.fit.V6.ok) return { ...out, notes: [...out.notes, ...notes, `Mie 도 불일치(${p.fit.V6.note}) — HG 결과 유지`] };
  onProgress?.({ stage: 'mie-table', done: 0 });
  const tauMax = Math.min(4, p.fit.mat.musR * 10);                    // 두께 10mm 까지 소재표로
  const sys = buildMieTable({ opt: p.opt, n: host.n, tauMax, N: 20000, seed: 11, onProgress: (f) => onProgress?.({ stage: 'mie-table', done: f }) });
  const V13 = checkTransition(sys.table, table, p.opt.g, host.n);
  return { ...out, model: 'mie', n: host.n,
    fitted: { musR: p.fit.mat.musR, g: p.opt.g, mua: p.fit.mat.mua, free: p.fit.free },
    particle: { ...e.particle, nP: bead.nP, rho: bead.rho, d_um: p.d_um, dRange: p.dRange, phi: p.phi, wt: p.wt, mus: p.mus, x: p.opt.x, lambda_um: 0.55,
      dependentScattering: p.dependentScattering },
    validation: { V6: p.fit.V6, V9: p.fit.V9, V13 }, notes,
    sysTable: { meta: sys.meta, b64: f32ToB64(sys.data) } };
}
