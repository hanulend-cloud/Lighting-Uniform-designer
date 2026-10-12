// S2b 밀키 + 형상 로컬 슬래브 PSF 검증: node test/shape-milky.mjs [--quick] [--only=REG,VS7M]
//  REG : 평판(균일 두께)에서 로컬 슬래브 PSF = 기존 L2 PSF(systemPsf) — 같은 물리·같은 solver 의 회귀
//  VS7M: S1 MC(체적 산란·Fresnel·실제 형상) 대비 — LED 영역 중심 80% 블록(3×3 노드) 평균 ≤3%, 균일도(min/max) ≤2%p
//        벽은 LED 배열 밖 50mm(흡수) — 형상 고유 물리 검증. 벽 근처 L2 벽 모델 편향(+3~4%)은 별도 과제(--fullcav 진단).
import { Worker } from 'node:worker_threads';
import { loadTable } from './l2-util.mjs';
import { l2Material } from '../src/engine/l2/material.js';
import { systemPsf } from '../src/engine/l2/psf.js';
import { solveCavity } from '../src/engine/l2/cavity-solver.js';
import { bandIrradiance } from '../src/engine/l2/incident.js';
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { milkyPsf, milkyShapeField } from '../src/engine/shape/milky-body.js';
import { buildBodyGeometry } from '../src/engine/shape/body-geom.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { ledPositions } from '../src/engine/directLit.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const QUICK = process.argv.includes('--quick');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const run = (id) => !only || only.split(',').includes(id);
const table = loadTable(), n = 1.59, rhoB = +(process.env.RHOB ?? 0.5), intensity = (c) => c;

if (run('REG')) {
  for (const milky of [3, 7]) {
    const mat = l2Material(table, milky, n), t = 2, depth = 10, W = 200;
    const geom = { hf: heightfieldFromFn(W, W, 1, () => 0, () => -t), ox: W / 2, oy: W / 2, walls: { x0: 0, x1: W, y0: 0, y1: W }, key: `reg${milky}` };
    const a = systemPsf({ table, mat, t, h: depth - t, rhoB, intensity, intensityKey: 'lam1', I0: 1, extentX: 200, extentY: 200, step: 1 });
    const b = milkyPsf(geom, depth, { x: 100, y: 100 }, { table, mat, rhoB, intensity, intensityKey: 'lam1', I0: 1, extentX: 200, extentY: 200, step: 1 });
    let md = 0, mx = 0; for (const v of a.K.data) mx = Math.max(mx, v);
    for (let k = 0; k < a.K.data.length; k++) if (a.K.data[k] > 1e-3 * mx) md = Math.max(md, Math.abs(b.K.data[k] / a.K.data[k] - 1));
    ok(md < 1e-6 && Math.abs(b.trans / a.trans - 1) < 1e-9, `REG Milky ${milky} 평판: 로컬 슬래브 PSF = L2 PSF (최대 상대차 ${md.toExponential(1)}, 투과 ${b.trans.toFixed(4)})`);
  }
}

if (run('VS7M')) {
  const NW = 16, led = { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 };
  const cases = [], pick = process.env.CASE ? +process.env.CASE : -1;
  const mk = (name, geom, leds, uniform, symmetric) => cases.push({ name, geom, leds, uniform, symmetric });
  // 벽을 LED 배열에서 50mm 밖에 둔다(오버행 pad 50) — S2b 형상 물리(로컬 슬래브)만 검증. 벽 근처는 L2 벽 모델 과제(별도).
  const P = 50;
  { const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 20, 20); mk('L1 평판 3mm(기준선)', buildBodyGeometry(s, [1], 12, { leds, pitchX: 20, pitchY: 20, padX: P, padY: P }), leds, true, true); }
  { const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 20, 20); mk('L3 테이퍼', buildBodyGeometry(s, [1, 3], 12, { leds, pitchX: 20, pitchY: 20, padX: P, padY: P }), leds, false, true); }
  { const s = structuredClone(DEFAULT_SPEC); s.levels[4].on = true; s.levels[3].on = false; const leds = ledPositions(s, 20, 20); mk('L4 포켓', buildBodyGeometry(s, [1, 4], 12, { leds, pitchX: 20, pitchY: 20, padX: P, padY: P }), leds, true, true); }
  { const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 20, 20), hf = heightfieldFromFn(200, 200, 0.25, (x, y) => -((x * x + y * y) / 16000), (x) => (Math.abs(x - 15) < 2 ? -6 : -3));
    mk('돔·리브', { hf, ox: 50, oy: 50, walls: { x0: -P, x1: 100 + P, y0: -P, y1: 100 + P }, imported: true, periodic: false, key: 'm-dome' }, leds, false, false); }
  { const s = structuredClone(DEFAULT_SPEC); s.levels[1].thk = 1.5; const leds = ledPositions(s, 20, 20); mk('L1 평판 1.5mm', buildBodyGeometry(s, [1], 12, { leds, pitchX: 20, pitchY: 20, padX: P, padY: P }), leds, true, true); }
  const milkies = process.env.MILKY ? [+process.env.MILKY] : [3, 6];
  for (const [ci, c] of cases.entries()) {
    if (pick >= 0 && ci !== pick) continue;
    for (const milky of milkies) {
      const mat = l2Material(table, milky, n), medium = { mus: mat.musR / (1 - mat.g), g: mat.g, mua: mat.mua };
      const NX = 67, grid = { NX, NY: NX, x0: 0, y0: 0, stepX: 100 / (NX - 1), stepY: 100 / (NX - 1) };
      const fast = milkyShapeField(c.geom, 12, c.leds, grid, { table, mat, rhoB, intensity, intensityKey: 'lam1', I0: 1, uniform: c.uniform, symmetric: c.symmetric, rWover: (process.env.WALLMODE ?? 'absorb') === 'absorb' ? 0 : undefined, anchorStep: process.env.ANCHOR ? +process.env.ANCHOR : undefined });
      const hfT = c.geom.hf, Nper = +(process.env.NPER ?? (QUICK ? 4e4 : 8e5)) / (milky > 4 ? 2 : 1);
      const wd = { hf: { nx: hfT.nx, ny: hfT.ny, cell: hfT.cell, x0: hfT.x0, y0: hfT.y0, zt: Float64Array.from(hfT.zt), zb: Float64Array.from(hfT.zb), mask: hfT.mask },
        ox: c.geom.ox, oy: c.geom.oy, depth: 12, n, mua: mat.mua, medium, rhoB, walls: { ...c.geom.walls, mode: process.env.WALLMODE ?? 'absorb', R: fast.rW }, leds: c.leds, led, N: Nper, grid };
      const t0 = Date.now();
      const res = await Promise.all(Array.from({ length: NW }, (_, i) => new Promise((ok2, bad) => {
        const w = new Worker(new URL('./shape-mc-map-worker.mjs', import.meta.url), { workerData: { ...wd, seed: 71 + i * 7919 } });
        w.on('message', ok2); w.on('error', bad);
      })));
      const mc = new Float64Array(NX * NX); for (const r of res) for (let k = 0; k < mc.length; k++) mc[k] += r.map[k] / NW;
      // 블록(3×3 노드) 평균, 중심 80%
      const blocks = (f) => { const out = []; for (let J = 0; J + 2 < NX; J += 3) for (let I = 0; I + 2 < NX; I += 3) { const cxn = (I + 1) / (NX - 1), cyn = (J + 1) / (NX - 1); if (Math.abs(cxn - 0.5) > 0.4 || Math.abs(cyn - 0.5) > 0.4) continue; let v = 0; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) v += f[(J + b) * NX + I + a]; out.push(v / 9); } return out; };
      const st = (f) => { const v = blocks(f); return { mean: v.reduce((p, q) => p + q, 0) / v.length, U: Math.min(...v) / Math.max(...v) }; };
      const sF = st(fast.field), sM = st(mc), per = res.map((r) => st(r.map)), sdU = Math.sqrt(per.reduce((a, q) => a + (q.U - sM.U) ** 2, 0) / (NW - 1) / NW);
      const dm = Math.abs(sF.mean / sM.mean - 1), du = Math.abs(sF.U - sM.U);
      if (process.argv.includes('--map')) {
        const bF = blocks(fast.field), bM = blocks(mc), nb = Math.round(Math.sqrt(bF.length));
        for (let j = 0; j < nb; j += 2) console.log('   ' + Array.from({ length: nb }, (_, i) => (bF[j * nb + i] / bM[j * nb + i]).toFixed(2)).filter((_, i) => i % 2 === 0).join(' '));
      }
      if (process.argv.includes('--fullcav')) {   // 진단: 벽 접기를 재순환 단계마다 하는 전체 캐비티 solve(평판 전용)
        const t = 3, h = 9, stp = 1, nx = 100, rWc = process.env.WALLMODE === 'absorb' ? 0 : fast.rW, src = [];
        for (const l of c.leds) src.push({ ...l, I0: 1 }, { x: -l.x, y: l.y, I0: rWc }, { x: 200 - l.x, y: l.y, I0: rWc }, { x: l.x, y: -l.y, I0: rWc }, { x: l.x, y: 200 - l.y, I0: rWc });
        const E = bandIrradiance({ sources: src, intensity, h, nx, ny: nx, step: stp, table });
        const ref = solveCavity({ E, nx, ny: nx, step: stp, table, mat, t, h, rhoB, rW: rWc });
        const at = (x, y) => { const i = Math.min(nx - 2, Math.max(0, Math.floor(x - 0.5))), j = Math.min(nx - 2, Math.max(0, Math.floor(y - 0.5))), u = x - 0.5 - i, v = y - 0.5 - j; return (1 - u) * (1 - v) * ref.M[j * nx + i] + u * (1 - v) * ref.M[j * nx + i + 1] + (1 - u) * v * ref.M[(j + 1) * nx + i] + u * v * ref.M[(j + 1) * nx + i + 1]; };
        const fc = new Float64Array(NX * NX); for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) fc[j * NX + i] = at(i * grid.stepX, j * grid.stepY);
        const sC = st(fc);
        console.log(`   전체 캐비티 solve(벽 접기): 평균 ${(sC.mean / sM.mean).toFixed(4)}·U ${(sC.U * 100).toFixed(1)}%`);
        // 결합: 열린 영역 PSF 중첩(거울 없음) × [벽 solve / 열린 solve(영역 확장, 크롭)]
        const mg = 60, nxo = nx + 2 * mg, srcO = c.leds.map((l) => ({ x: l.x + mg, y: l.y + mg, I0: 1 }));
        const EO = bandIrradiance({ sources: srcO, intensity, h, nx: nxo, ny: nxo, step: stp, table });
        const op = solveCavity({ E: EO, nx: nxo, ny: nxo, step: stp, table, mat, t, h, rhoB, rW: 0 });
        const atO = (x, y) => { const xx = x + mg, yy = y + mg, i = Math.floor(xx - 0.5), j = Math.floor(yy - 0.5), u = xx - 0.5 - i, v = yy - 0.5 - j; return (1 - u) * (1 - v) * op.M[j * nxo + i] + u * (1 - v) * op.M[j * nxo + i + 1] + (1 - u) * v * op.M[(j + 1) * nxo + i] + u * v * op.M[(j + 1) * nxo + i + 1]; };
        const fo = milkyShapeField(c.geom, 12, c.leds, grid, { table, mat, rhoB, intensity, intensityKey: 'lam1', I0: 1, uniform: c.uniform, symmetric: c.symmetric, rWover: 0 });
        const comb = new Float64Array(NX * NX); for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; comb[k] = fo.field[k] * fc[k] / Math.max(1e-30, atO(i * grid.stepX, j * grid.stepY)); }
        const sB = st(comb);
        console.log(`   결합(PSF 열린 × 벽/열린 비): 평균 ${(sB.mean / sM.mean).toFixed(4)}·U ${(sB.U * 100).toFixed(1)}%`);
      }
      if (process.argv.includes('--ledger')) {
        let fi = 0; for (let k = 0; k < fast.field.length; k++) { const i = k % NX, j = (k / NX) | 0; fi += fast.field[k] * grid.stepX * grid.stepY * (i === 0 || i === NX - 1 ? 0.5 : 1) * (j === 0 || j === NX - 1 ? 0.5 : 1); }
        const L = res.reduce((a, r) => { for (const q in r.ledger) a[q] = (a[q] ?? 0) + r.ledger[q] / NW; return a; }, {});
        console.log(`   총 출사: 로컬 슬래브 ${fi.toFixed(3)} vs MC 상면 ${L.top.toFixed(3)} (방출 ${L.emitted.toFixed(3)}) · MC 벽 ${(L.wall / L.emitted).toFixed(4)} 측면 ${(L.side / L.emitted).toFixed(4)} PCB흡수 ${(L.pcb / L.emitted).toFixed(4)} 체적흡수 ${(L.absBody / L.emitted).toFixed(4)} | rW ${fast.rW.toFixed(3)} 투과 ${fast.trans.toFixed(3)}`);
      }
      console.log(`  ${c.name} Milky ${milky}: MC U ${(sM.U * 100).toFixed(1)}% (σ ${(sdU * 100).toFixed(2)}%p, ${((Date.now() - t0) / 1000).toFixed(0)}s) | 로컬 슬래브 평균 ${(sF.mean / sM.mean).toFixed(4)}·U ${(sF.U * 100).toFixed(1)}% (${fast.ms.toFixed(0)}ms)`);
      ok(dm <= 0.03 && du <= 0.02, `VS7M ${c.name} Milky ${milky}: 평균 차 ${(dm * 100).toFixed(2)}% (≤3%), 균일도 차 ${(du * 100).toFixed(2)}%p (≤2%p)`);
    }
  }
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
