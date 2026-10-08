// L2 테이블 자체검증: node test/l2-table.mjs  (spec V1·V3·V4·V11, 고장 주입)
import { loadTable, loadRefAD } from './l2-util.mjs';
import { validateTable } from '../src/engine/l2/validator.js';
import { createTable, REC } from '../src/engine/l2/slab-table.js';
import { runSlab } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable(), ref = loadRefAD();

const v = validateTable(table, ref);
for (const c of v.checks) ok(c.ok, `${c.id} value=${typeof c.value === 'number' ? c.value.toFixed(4) : c.value} limit=${c.limit} ${c.note ?? ''}`);
ok(v.ok, '테이블 검증 전체 통과');

// 고장 주입: 산란 투과 채널 절반으로 손상 → V1 실패해야 함
{
  const bad = Float32Array.from(table._data);
  for (let i = 0; i < bad.length; i++) bad[i] *= (i % REC) >= 64 && (i % REC) < 128 ? 0.5 : 1;
  const vb = validateTable(createTable(table.meta, bad), ref);
  ok(!vb.ok && !vb.checks.find((c) => c.id === 'V1').ok, '고장 주입(테이블 손상) → V1 실패 감지');
}
// 흡수에 의한 측방 축소(radScale) — 직접 MC(광자별 L·r) 와 비교 ±2%
{
  const tauR = 5, g = 0.9, muaT = 0.0264;   // 추상 소재 기본 흡수의 4배 수준(t=3mm)
  let w0 = 0, r0 = 0, w1 = 0, r1 = 0;
  runSlab({ tau: tauR / (1 - g), g, n: 1.59, inc: 1, N: 40000, seed: 21, onEscape: (ch, x, y, L, w, sc) => {
    if (ch !== 'T' || !sc) return; const a = Math.exp(-muaT * L), r2 = x * x + y * y; w0 += w; r0 += w * r2; w1 += w * a; r1 += w * a * r2; } });
  const ref = Math.sqrt((r1 / w1) / (r0 / w0)), got = table.query(tauR, g, 1.59, 0, muaT).radScale;
  ok(Math.abs(got / ref - 1) <= 0.02, `흡수 측방 축소 radScale ${got.toFixed(4)} vs 직접 MC ${ref.toFixed(4)}`);
}
// 범위 밖 플래그
ok(table.query(1, 0.5, 1.59, 0).outOfRange && table.query(1, 0.9, 1.40, 0).outOfRange && !table.query(1, 0.9, 1.59, 0).outOfRange, 'g·n 격자 밖 → outOfRange');
ok(table.bandOf(1) === 0 && table.bandOf(Math.cos(85 * Math.PI / 180)) === table.angleRows - 1, '입사 cos → 밴드');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
