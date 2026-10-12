// PSF 병렬 추적 풀(psf-pool.js) — 병렬 결과 = 순차 결과(비트 동일) + 속도 향상: node test/shape-pool.mjs
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { shapeField, clearPsfCache } from '../src/engine/shape/fast-body.js';
import { createPsfPool } from '../src/engine/shape/psf-pool.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { buildBodyGeometry } from '../src/engine/shape/body-geom.js';
import { ledPositions } from '../src/engine/directLit.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const K = Math.max(1, Math.min(7, os.cpus().length - 1));
const workers = Array.from({ length: K }, () => new Worker(new URL('../src/engine/shape/psf-worker.js', import.meta.url)));
const pool = createPsfPool(workers);

const led = { model: 'lambertian', beamX: 120, I0: 1 }, opt = { n: 1.59, mua: 0.0005, rhoB: 0.5 };
const grid = { NX: 67, NY: 67, x0: 0, y0: 0, stepX: 100 / 66, stepY: 100 / 66 };
const cases = [];
{ const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 13, 13); cases.push({ name: 'L3 테이퍼(앵커 격자)', geom: buildBodyGeometry(s, [1, 3], 12, { leds, pitchX: 13, pitchY: 13 }), leds, o: { symmetric: true } }); }
{ const s = structuredClone(DEFAULT_SPEC); s.levels[4].on = true; s.levels[3].on = false; const leds = ledPositions(s, 16, 16); cases.push({ name: 'L4 포켓(등급 앵커·실제 장면)', geom: buildBodyGeometry(s, [1, 4], 12, { leds, pitchX: 16, pitchY: 16 }), leds, o: { uniform: true, symmetric: true } }); }
{ const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 20, 20), hf = heightfieldFromFn(100, 100, 0.25, (x, y) => -((x * x + y * y) / 4000), (x) => (Math.abs(x - 15) < 2 ? -6 : -3));
  cases.push({ name: '돔·리브(LED 별 정확)', geom: { hf, ox: 50, oy: 50, walls: { x0: 0, x1: 100, y0: 0, y1: 100 }, imported: true, periodic: false, key: 'pool-dome', warnings: [] }, leds, o: { exact: true } }); }

for (const c of cases) {
  clearPsfCache();
  const a = shapeField(c.geom, 12, c.leds, led, grid, { ...opt, ...c.o, pool: null });
  clearPsfCache();
  const b = shapeField(c.geom, 12, c.leds, led, grid, { ...opt, ...c.o, pool });
  let md = 0; for (let k = 0; k < a.field.length; k++) md = Math.max(md, Math.abs(a.field[k] - b.field[k]) / Math.max(1e-300, Math.abs(a.field[k])));
  ok(md === 0, `${c.name}: 병렬(${pool.size}스레드) = 순차 — 최대 상대차 ${md.toExponential(1)} · ${a.ms.toFixed(0)}ms → ${b.ms.toFixed(0)}ms (×${(a.ms / b.ms).toFixed(1)}, PSF ${a.traced}개)`);
}
for (const w of workers) await w.terminate();
if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
