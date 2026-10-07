// Milky 사상: node test/l2-milky.mjs  (spec §4)
import { loadTable } from './l2-util.mjs';
import { milkyFromMusR, musRFromMilky, MILKY_REF } from '../src/engine/l2/milky.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();

ok(milkyFromMusR(table, 0) === 0 && milkyFromMusR(table, Infinity) === 10, '끝점: μs\'=0 → 0, ∞ → 10');
ok(musRFromMilky(table, 0) === 0 && musRFromMilky(table, 10) === Infinity, '역변환 끝점');
let prev = -1, mono = true;
for (let e = -4; e <= 6; e += 0.25) { const m = milkyFromMusR(table, 10 ** e); if (m < prev - 1e-6) mono = false; prev = m; }
ok(mono, 'μs\' 증가 → Milky 단조 증가');
let worst = 0;
for (let m = 0.25; m < 9.9; m += 0.25) worst = Math.max(worst, Math.abs(milkyFromMusR(table, musRFromMilky(table, m)) - m));
ok(worst <= 0.01, `정역 왕복 오차 ${worst.toFixed(4)} ≤ 0.01`);
const m5 = musRFromMilky(table, 5);
console.log(`  참고: Milky 5 → μs'=${m5.toFixed(3)}/mm (기준 ${MILKY_REF.t}mm 에서 산란으로 50% 차폐)`);

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
