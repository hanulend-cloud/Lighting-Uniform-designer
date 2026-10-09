// 공용 실측소재 DB 생성: node tools/fit-db.mjs
// data/materials-db.src.json(측정 원자료) → 저장소 응답표로 피팅(모델 선택: src/engine/l2/material-fit.js) → data/materials-db.json.
// 응답표를 다시 만들면 이 스크립트도 다시 돌려 커밋한다.
import fs from 'node:fs';
import { loadTable } from '../test/l2-util.mjs';
import { fitEntry } from '../src/engine/l2/material-fit.js';
import { validateEntry } from '../src/model/materials-db.js';
import { milkyFromMusR } from '../src/engine/l2/milky.js';

const table = loadTable();
const src = JSON.parse(fs.readFileSync(new URL('../data/materials-db.src.json', import.meta.url)));
const entries = src.entries.map((e) => {
  const t0 = Date.now(), out = fitEntry(table, e);
  const err = validateEntry(out);
  if (err.length) throw new Error(`${e.id}: ${err.join(', ')}`);
  const pt = out.particle?.d_um ? ` · ${out.particle.type} d=${out.particle.d_um.toFixed(2)}µm(${out.particle.dRange.map((v) => v.toFixed(1)).join('~')}) ${(out.particle.wt * 100).toFixed(2)}wt%` : '';
  console.log(`${e.id}: [${out.model}] μs'=${out.fitted.musR.toFixed(4)}/mm g=${out.fitted.g.toFixed(4)} Milky=${milkyFromMusR(table, out.fitted.musR).toFixed(2)} V6 ${out.validation.V6.ok ? 'OK' : 'FAIL'}${pt} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return out;
});
fs.writeFileSync(new URL('../data/materials-db.json', import.meta.url), JSON.stringify({ version: 1, entries }, null, 1));
console.log('wrote data/materials-db.json', entries.length, 'entries');
