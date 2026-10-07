// 캐비티 재순환 solver: node test/l2-cavity.mjs  (spec V2·V8·V3 시스템, 밀착 갭, 성능 기록)
import { loadTable } from './l2-util.mjs';
import { solveCavity } from '../src/engine/l2/cavity-solver.js';
import { bandIrradiance } from '../src/engine/l2/incident.js';
import { checkResult } from '../src/engine/l2/validator.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();
const sum = (a) => a.reduce((p, v) => p + v, 0);

// V8: 무한 균일 조사(거울 벽 rW=1) → 중심부 출사 = E·[T_n + T_d·ρ·R_n/(1−ρ·R_d)]
{
  const nx = 100, ny = 100, step = 2, nb = table.angleRows;
  const E = Array.from({ length: nb }, (_, b) => new Float64Array(nx * ny).fill(b === 0 ? 1 : 0));
  const mat = { musR: 0.5, g: 0.9, mua: 0.001, n: 1.59 }, t = 2, h = 3, rhoB = 0.5;
  const res = solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB, rW: 1 });
  const tauR = mat.musR * t, muaT = mat.mua * t;
  const qn = table.query(tauR, mat.g, mat.n, 0, muaT), qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const expect = (qn.Tb + qn.Ts) + (qd.Tb + qd.Ts) * rhoB * qn.R / (1 - rhoB * qd.R);
  const c = res.M[50 * nx + 50];
  ok(Math.abs(c / expect - 1) <= 0.01, `V8 균일 재순환 이득 solver ${c.toFixed(4)} vs 해석 ${expect.toFixed(4)}`);
  const v = checkResult(res); ok(v.ok, `V2/V7 (V8 케이스) err=${res.energy.err.toExponential(2)}`);
}

// 실 LED 배열 케이스들: 에너지 수지 V2 ≤ 1%
const leds = [];
for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) leds.push({ x: 10 + i * 20, y: 10 + j * 20, I0: 1 });
const cases = [
  ['Milky0 h9', { musR: 0, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 9, 0.1],
  ['중간 h9', { musR: 0.3, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 9, 0.1],
  ['고Milky h9', { musR: 20, g: 0.9, mua: 0.001, n: 1.59 }, 3, 9, 0.3],
  ['밀착 h0.1', { musR: 0.3, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 0.1, 0.1],
];
for (const [name, mat, t, h, rW] of cases) {
  const nx = 110, ny = 110, step = 1;
  const E = bandIrradiance({ sources: leds.map((l) => ({ ...l, x: l.x + 5, y: l.y + 5 })), m: 1, h, nx, ny, step, table });
  const t0 = performance.now();
  const res = solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB: 0.5, rW });
  const ms = performance.now() - t0;
  const v = checkResult(res);
  ok(v.ok, `${name}: V2 err=${res.energy.err.toExponential(2)} top/in=${(res.energy.top / res.energy.input).toFixed(3)} iter=${res.iterations} ${ms.toFixed(0)}ms`);
  if (mat.musR === 0) ok(sum(res.Mscat) === 0, `${name}: Milky 0 → 산란 성분 0 (V3 시스템: 직진 + 재순환만)`);
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
