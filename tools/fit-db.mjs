// 공용 실측소재 DB 생성: node tools/fit-db.mjs
// data/materials-db.src.json(측정 원자료) → 저장소 응답표로 피팅 → data/materials-db.json (fitted·validation 포함).
// 응답표를 다시 만들면 이 스크립트도 다시 돌려 커밋한다.
import fs from 'node:fs';
import { loadTable } from '../test/l2-util.mjs';
import { fitMaterial } from '../src/engine/l2/fit.js';
import { validateEntry } from '../src/model/materials-db.js';

const table = loadTable();
const src = JSON.parse(fs.readFileSync(new URL('../data/materials-db.src.json', import.meta.url)));
const entries = src.entries.map((e) => {
  const f = fitMaterial(table, e);
  const out = { ...e, fitted: { musR: f.mat.musR, g: f.mat.g, mua: f.mat.mua, free: f.free }, validation: { V6: f.V6, V9: f.V9 }, notes: f.notes,
    fittedWith: { table: table.meta.created, date: new Date().toISOString().slice(0, 10) } };
  const err = validateEntry(out);
  if (err.length) throw new Error(`${e.id}: ${err.join(', ')}`);
  console.log(`${e.id}: μs'=${f.mat.musR.toFixed(4)}/mm g=${f.mat.g.toFixed(3)} μa=${f.mat.mua.toPrecision(2)} Milky=${f.milky.toFixed(2)} V6 ${f.V6.ok ? 'OK' : 'FAIL'} (${f.V6.note})`);
  return out;
});
fs.writeFileSync(new URL('../data/materials-db.json', import.meta.url), JSON.stringify({ version: 1, entries }, null, 1));
console.log('wrote data/materials-db.json', entries.length, 'entries');
