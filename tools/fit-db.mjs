// 공용 실측소재 DB 생성: node tools/fit-db.mjs
// data/materials-db.src.json(측정 원자료) → 저장소 응답표로 피팅 → data/materials-db.json (fitted·validation 포함).
// 모델 선택(spec §13): HG 로 V6 통과면 HG. 실패하고 입자 사양(particle)이 있으면 Mie(소재별 MC) 로 다시 피팅하고
// 통과 시 Mie — 이때 소재별 응답표(sysTable)를 만들어 함께 저장한다. 응답표를 다시 만들면 이 스크립트도 다시 돌린다.
import fs from 'node:fs';
import { loadTable } from '../test/l2-util.mjs';
import { fitMaterial } from '../src/engine/l2/fit.js';
import { fitParticle, buildMieTable, checkTransition, BEADS, HOST } from '../src/engine/l2/mie-material.js';
import { validateEntry, f32ToB64 } from '../src/model/materials-db.js';
import { milkyFromMusR } from '../src/engine/l2/milky.js';

const table = loadTable();
const src = JSON.parse(fs.readFileSync(new URL('../data/materials-db.src.json', import.meta.url)));
const date = new Date().toISOString().slice(0, 10);
const entries = src.entries.map((e) => {
  const t0 = Date.now();
  const hg = fitMaterial(table, e);
  let out = { ...e, model: 'HG', fitted: { musR: hg.mat.musR, g: hg.mat.g, mua: hg.mat.mua, free: hg.free }, validation: { V6: hg.V6, V9: hg.V9 }, notes: hg.notes,
    fittedWith: { table: table.meta.created, date } };
  if (!hg.V6.ok && e.particle) {
    const bead = BEADS[e.particle.type], host = HOST[e.particle.host ?? 'PC'];
    const p = fitParticle(table, e, bead, host);
    const notes = [`HG 불일치(${hg.V6.note}) → Mie(${e.particle.type}${e.particle.assumed ? ' 가정' : ''}) 로 재피팅`, ...p.notes, ...p.fit.notes];
    if (p.fit.V6.ok) {
      const tauMax = Math.min(4, p.fit.mat.musR * 10);                    // 두께 10mm 까지 소재표로
      const sys = buildMieTable({ opt: p.opt, n: host.n, tauMax, N: 20000, seed: 11 });
      const V13 = checkTransition(sys.table, table, p.opt.g, host.n);
      out = { ...out, model: 'mie', n: host.n,
        fitted: { musR: p.fit.mat.musR, g: p.opt.g, mua: p.fit.mat.mua, free: p.fit.free },
        particle: { ...e.particle, nP: bead.nP, rho: bead.rho, d_um: p.d_um, dRange: p.dRange, phi: p.phi, wt: p.wt, mus: p.mus, x: p.opt.x, lambda_um: 0.55 },
        validation: { V6: p.fit.V6, V9: p.fit.V9, V13 }, notes,
        sysTable: { meta: sys.meta, b64: f32ToB64(sys.data) } };
    } else out.notes = [...out.notes, ...notes, `Mie 도 불일치(${p.fit.V6.note}) — HG 결과 유지`];
  }
  const err = validateEntry(out);
  if (err.length) throw new Error(`${e.id}: ${err.join(', ')}`);
  const pt = out.particle?.d_um ? ` · ${out.particle.type} d=${out.particle.d_um.toFixed(2)}µm(${out.particle.dRange.map((v) => v.toFixed(1)).join('~')}) ${(out.particle.wt * 100).toFixed(2)}wt%` : '';
  console.log(`${e.id}: [${out.model}] μs'=${out.fitted.musR.toFixed(4)}/mm g=${out.fitted.g.toFixed(4)} Milky=${milkyFromMusR(table, out.fitted.musR).toFixed(2)} V6 ${out.validation.V6.ok ? 'OK' : 'FAIL'}${pt} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return out;
});
fs.writeFileSync(new URL('../data/materials-db.json', import.meta.url), JSON.stringify({ version: 1, entries }, null, 1));
console.log('wrote data/materials-db.json', entries.length, 'entries');
