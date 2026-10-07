// L2 테이블 자체검증: node test/l2-table.mjs  (spec V1·V3·V4·V11, 고장 주입)
import { loadTable, loadRefAD } from './l2-util.mjs';
import { validateTable } from '../src/engine/l2/validator.js';
import { createTable } from '../src/engine/l2/slab-table.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable(), ref = loadRefAD();

const v = validateTable(table, ref);
for (const c of v.checks) ok(c.ok, `${c.id} value=${typeof c.value === 'number' ? c.value.toFixed(4) : c.value} limit=${c.limit} ${c.note ?? ''}`);
ok(v.ok, '테이블 검증 전체 통과');

// 고장 주입: 산란 투과 채널 절반으로 손상 → V1 실패해야 함
{
  const bad = Float32Array.from(table._data);
  for (let i = 0; i < bad.length; i++) bad[i] *= (i % 260) >= 64 && (i % 260) < 128 ? 0.5 : 1;
  const vb = validateTable(createTable(table.meta, bad), ref);
  ok(!vb.ok && !vb.checks.find((c) => c.id === 'V1').ok, '고장 주입(테이블 손상) → V1 실패 감지');
}
// 범위 밖 플래그
ok(table.query(1, 0.5, 1.59, 0).outOfRange && table.query(1, 0.9, 1.40, 0).outOfRange && !table.query(1, 0.9, 1.59, 0).outOfRange, 'g·n 격자 밖 → outOfRange');
ok(table.bandOf(1) === 0 && table.bandOf(Math.cos(85 * Math.PI / 180)) === table.angleRows - 1, '입사 cos → 밴드');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
