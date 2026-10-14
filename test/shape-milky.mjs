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
import { ledPositions, l2WallDelta } from '../src/engine/directLit.js';

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
  const P = +(process.env.PAD ?? 50);
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
        ox: c.geom.ox, oy: c.geom.oy, depth: 12, n, mua: mat.mua, medium, rhoB, walls: { ...c.geom.walls, mode: process.env.WALLMODE ?? 'absorb', R: process.env.WALLR ? +process.env.WALLR : fast.rW }, leds: c.leds, led, N: Nper, grid };
      const t0 = Date.now();
      const res = await Promise.all(Array.from({ length: NW }, (_, i) => new Promise((ok2, bad) => {
        const w = new Worker(new URL('./shape-mc-map-worker.mjs', import.meta.url), { workerData: { ...wd, seed: +(process.env.SEEDB ?? 71) + i * 7919 } });
        w.on('message', ok2); w.on('error', bad);
      })));
      const mc = new Float64Array(NX * NX); for (const r of res) for (let k = 0; k < mc.length; k++) mc[k] += r.map[k] / NW;
      // 블록(3×3 노드) 평균, 중심 80%
      const blocks = (f) => { const out = []; for (let J = 0; J + 2 < NX; J += 3) for (let I = 0; I + 2 < NX; I += 3) { const cxn = (I + 1) / (NX - 1), cyn = (J + 1) / (NX - 1); if (Math.abs(cxn - 0.5) > 0.4 || Math.abs(cyn - 0.5) > 0.4) continue; let v = 0; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) v += f[(J + b) * NX + I + a]; out.push(v / 9); } return out; };
      const st = (f) => { const v = blocks(f); return { mean: v.reduce((p, q) => p + q, 0) / v.length, U: Math.min(...v) / Math.max(...v) }; };
      // MC 지도 잡음은 U(=블록 min/max)를 낮게 편향시킨다(블록 상대 표준오차 ~0.8% → 700블록 min/max 로 −3%p 대).
      // 대칭 배치(LED·벽이 x·y 거울 + x↔y 대칭)는 8중 대칭 평균 지도로 판정 — 분산 1/8. (2026-10-13 진단: 원 51.8% vs 대칭 55.4%)
      const symm = (f) => { const o = new Float64Array(NX * NX), F = (i, j) => f[j * NX + i]; for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) { const I = NX - 1 - i, J = NX - 1 - j; o[j * NX + i] = (F(i, j) + F(I, j) + F(i, J) + F(I, J) + F(j, i) + F(J, i) + F(j, I) + F(J, I)) / 8; } return o; };
      const mcJ = c.symmetric ? symm(mc) : mc, sMraw = st(mc);
      const sF = st(fast.field), sM = st(mcJ), per = res.map((r) => st(c.symmetric ? symm(r.map) : r.map)), sdU = Math.sqrt(per.reduce((a, q) => a + (q.U - sM.U) ** 2, 0) / (NW - 1) / NW);
      // 잡음 맞춤 비교: MC 판정 지도(대칭 평균)의 블록별 표준오차를 워커 간 분산으로 구해, 같은 잡음을 PSF 블록에 입힌 U 기댓값과 비교
      // — min/max 의 잡음 편향(대칭 평균 후에도 ~1.5%p)을 양쪽에 같게 만들어 모델 차이만 남긴다.
      const bwJ = res.map((r) => blocks(c.symmetric ? symm(r.map) : r.map)), bmJ = blocks(mcJ), seJ = bmJ.map((m, k) => { let v = 0; for (const b of bwJ) v += (b[k] - m) ** 2; return Math.sqrt(v / (NW - 1) / NW) / m; });
      const noisyU = (f) => { const bF = blocks(f); let a = 12345, uN = 0; const ND = 400, u = () => ((a = (a * 1103515245 + 12345) >>> 0) + 0.5) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
        for (let d = 0; d < ND; d++) { let lo = Infinity, hi = 0; for (let k = 0; k < bF.length; k++) { const v = bF[k] * (1 + seJ[k] * gauss()); if (v < lo) lo = v; if (v > hi) hi = v; } uN += lo / hi / ND; } return uN; };
      const uN = noisyU(fast.field);
      let dm = Math.abs(sF.mean / sM.mean - 1), du = Math.abs(uN - sM.U), wallOut = null;
      if (process.env.DUMP) (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify({ mc: blocks(mcJ), raw: blocks(mc), psf: blocks(fast.field), se: seJ, wall: (() => { const wm = new Float64Array(NX * NX); for (const r of res) if (r.wmap) for (let k = 0; k < wm.length; k++) wm[k] += r.wmap[k] / NW; return blocks(c.symmetric ? symm(wm) : wm); })(), ledger: res.reduce((a, r) => { for (const q in r.ledger) a[q] = (a[q] ?? 0) + r.ledger[q] / NW; return a; }, {}) }));
      console.log(`   잡음 맞춤: PSF+MC잡음 U 기댓값 ${(uN * 100).toFixed(1)}% vs MC ${(sM.U * 100).toFixed(1)}% (PSF 무잡음 ${(sF.U * 100).toFixed(1)}%, 블록 표준오차 중앙값 ${([...seJ].sort((a, b) => a - b)[seJ.length >> 1] * 100).toFixed(2)}%)`);
      if (process.argv.includes('--map')) {
        const bF = blocks(process.env.MAPF === 'corr' && globalThis.__fc ? globalThis.__fc : fast.field), bM = blocks(mcJ), nb = Math.round(Math.sqrt(bF.length)), mF = bF.reduce((a, v) => a + v) / bF.length, mMm = bM.reduce((a, v) => a + v) / bM.length;
        for (let j = 0; j < nb; j += 2) console.log('   ' + Array.from({ length: nb }, (_, i) => ((bF[j * nb + i] / mF) / (bM[j * nb + i] / mMm)).toFixed(3)).filter((_, i) => i % 2 === 0).join(' ') + '   | MC/평균 ' + Array.from({ length: nb }, (_, i) => (bM[j * nb + i] / mMm).toFixed(2)).filter((_, i) => i % 2 === 0).join(' '));
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
      if (process.argv.includes('--noise')) {   // MC 블록 잡음: 워커 간 블록값 표준오차(상대) + 8중 대칭 평균 지도의 U(대칭 배치 전용)
        const bw = res.map((r) => blocks(r.map)), bm = blocks(mc), se = bm.map((m, k) => { let v = 0; for (const b of bw) v += (b[k] - m) ** 2; return Math.sqrt(v / (NW - 1) / NW) / m; }).sort((a, b) => a - b);
        const sym = new Float64Array(NX * NX), F = (f, i, j) => f[j * NX + i];
        for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) { const I = NX - 1 - i, J = NX - 1 - j; sym[j * NX + i] = (F(mc, i, j) + F(mc, I, j) + F(mc, i, J) + F(mc, I, J) + F(mc, j, i) + F(mc, J, i) + F(mc, j, I) + F(mc, J, I)) / 8; }
        const sS = st(sym);
        console.log(`   MC 블록 상대 표준오차: 중앙값 ${(se[se.length >> 1] * 100).toFixed(2)}% 최대 ${(se.at(-1) * 100).toFixed(2)}% | 8중 대칭 평균 MC U ${(sS.U * 100).toFixed(1)}% (원 ${(sM.U * 100).toFixed(1)}%)`);
      }
      if (process.argv.includes('--wallcorr2')) {   // 생산 경로 측벽 보정(directLit.l2WallDelta) 그대로: 열린 PSF 중첩(거울 없음) + ΔW
        const W = c.geom.walls, mode = process.env.WALLMODE ?? 'absorb', R = mode === 'absorb' ? 0 : fast.rW;
        const set = { mat, t: 3, h: 9, rhoB, table, psf: { rW: R, key: `vs7m|${c.name}|${milky}|${R}` } };
        const T0 = Date.now(), wd = l2WallDelta(set, c.leds, { intensity, I0: 1 }, { wx0: W.x0, wx1: W.x1, wy0: W.y0, wy1: W.y1 }, { NX, NY: NX, x0: 0, y0: 0, stepX: grid.stepX, stepY: grid.stepY });
        const f0 = milkyShapeField(c.geom, 12, c.leds, grid, { table, mat, rhoB, intensity, intensityKey: 'lam1', I0: 1, uniform: c.uniform, symmetric: c.symmetric, rWover: 0 });
        const fc = Float64Array.from(f0.field, (v, k) => Math.max(0, v + wd.d[k]));
        const sC = st(fc);
        console.log(`   확산벽 보정[생산 l2WallDelta ${Date.now() - T0}ms](R=${R.toFixed(3)}): 평균 ${(sC.mean / sM.mean).toFixed(4)}·U ${(sC.U * 100).toFixed(1)}%·잡음맞춤 ${(noisyU(fc) * 100).toFixed(1)}% (MC ${(sM.U * 100).toFixed(1)}%, 거울 LED 잡음맞춤 ${(uN * 100).toFixed(1)}%)`);
        wallOut = { dm: Math.abs(sC.mean / sM.mean - 1), du: Math.abs(noisyU(fc) - sM.U) };
      }
      if (process.argv.includes('--wallcorr')) {   // 벽 보정 시험: 필드 × [벽 접기 solve / 열린 solve(거울 광원)] — 거친 격자, 같은 이산화
        const W = c.geom.walls, cs = 2, nxw = Math.round((W.x1 - W.x0) / cs), nyw = Math.round((W.y1 - W.y0) / cs), tC = 3, hC = 12 - tC;
        const rWall = (process.env.WALLMODE ?? 'absorb') === 'absorb' ? 0 : fast.rW;
        const Ew = bandIrradiance({ sources: c.leds.map((l) => ({ x: l.x - W.x0, y: l.y - W.y0, I0: 1 })), intensity, h: hC, nx: nxw, ny: nyw, step: cs, table });
        const Sw = solveCavity({ E: Ew, nx: nxw, ny: nyw, step: cs, table, mat, t: tC, h: hC, rhoB, rW: rWall, walled: true });
        const mg = 100, nxo = nxw + 2 * mg / cs, nyo = nyw + 2 * mg / cs, src = [];
        for (const l of c.leds) { const x = l.x - W.x0 + mg, y = l.y - W.y0 + mg; src.push({ x, y, I0: 1 }); if (rWall > 0) src.push({ x: 2 * mg - x, y, I0: rWall }, { x: 2 * (mg + nxw * cs) - x, y, I0: rWall }, { x, y: 2 * mg - y, I0: rWall }, { x, y: 2 * (mg + nyw * cs) - y, I0: rWall }); }
        const Eo = bandIrradiance({ sources: src, intensity, h: hC, nx: nxo, ny: nyo, step: cs, table });
        const So = solveCavity({ E: Eo, nx: nxo, ny: nyo, step: cs, table, mat, t: tC, h: hC, rhoB, rW: 0 });
        const bil = (M, n, m, ox, x, y) => { const fa = (x - W.x0 + ox) / cs - 0.5, fb = (y - W.y0 + ox) / cs - 0.5, a = Math.floor(fa), b = Math.floor(fb), u = fa - a, v = fb - b; return (1 - u) * (1 - v) * M[b * n + a] + u * (1 - v) * M[b * n + a + 1] + (1 - u) * v * M[(b + 1) * n + a] + u * v * M[(b + 1) * n + a + 1]; };
        const fc = new Float64Array(NX * NX); for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) { const x = i * grid.stepX, y = j * grid.stepY; fc[j * NX + i] = fast.field[j * NX + i] * bil(Sw.M, nxw, nyw, 0, x, y) / Math.max(1e-30, bil(So.M, nxo, nyo, mg, x, y)); }
        const sC = st(fc);
        console.log(`   벽 보정 필드: 평균 ${(sC.mean / sM.mean).toFixed(4)}·U ${(sC.U * 100).toFixed(1)}% (MC ${(sM.U * 100).toFixed(1)}%) — 보정 전 ${(sF.U * 100).toFixed(1)}%`);
      }
      if (process.argv.includes('--ledger')) {
        let fi = 0; for (let k = 0; k < fast.field.length; k++) { const i = k % NX, j = (k / NX) | 0; fi += fast.field[k] * grid.stepX * grid.stepY * (i === 0 || i === NX - 1 ? 0.5 : 1) * (j === 0 || j === NX - 1 ? 0.5 : 1); }
        const L = res.reduce((a, r) => { for (const q in r.ledger) a[q] = (a[q] ?? 0) + r.ledger[q] / NW; return a; }, {});
        console.log(`   총 출사: 로컬 슬래브 ${fi.toFixed(3)} vs MC 상면 ${L.top.toFixed(3)} (방출 ${L.emitted.toFixed(3)}) · MC 벽 ${(L.wall / L.emitted).toFixed(4)} 측면 ${(L.side / L.emitted).toFixed(4)} PCB흡수 ${(L.pcb / L.emitted).toFixed(4)} 체적흡수 ${(L.absBody / L.emitted).toFixed(4)} | rW ${fast.rW.toFixed(3)} 투과 ${fast.trans.toFixed(3)}`);
      }
      console.log(`  ${c.name} Milky ${milky}: MC U ${(sM.U * 100).toFixed(1)}%${c.symmetric ? `(대칭 평균, 원 ${(sMraw.U * 100).toFixed(1)}%)` : ''} (σ ${(sdU * 100).toFixed(2)}%p, ${((Date.now() - t0) / 1000).toFixed(0)}s) | 로컬 슬래브 평균 ${(sF.mean / sM.mean).toFixed(4)}·U ${(sF.U * 100).toFixed(1)}% (${fast.ms.toFixed(0)}ms)`);
      if (wallOut) ({ dm, du } = wallOut);   // --wallcorr2: 생산 측벽 보정 필드로 판정
      ok(dm <= 0.03 && du <= 0.02, `VS7M${wallOut ? '(측벽 보정)' : ''} ${c.name} Milky ${milky}: 평균 차 ${(dm * 100).toFixed(2)}% (≤3%), 균일도 차 ${(du * 100).toFixed(2)}%p (≤2%p)`);
    }
  }
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
