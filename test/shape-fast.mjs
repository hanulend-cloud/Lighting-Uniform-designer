// S2a 형상 몸체 빠른 solver(투명) 검증: node test/shape-fast.mjs [--quick] [--only=ID,..]
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { shapeField } from '../src/engine/shape/fast-body.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const QUICK = process.argv.includes('--quick');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const run = (id) => !only || only.split(',').includes(id);

function fresnelIndep(cosI, n1, n2) {
  const sinT = (n1 / n2) * Math.sqrt(1 - cosI * cosI);
  if (sinT >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT * sinT);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT), rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}
// 평판 반해석(VS1 과 같은 식): 반경 r 까지 누적 출사 광속 Φ(r) (cos^m, I0=1)
function plateCum(h, t, n, mua, m) {
  const K = 200000, pts = [];
  for (let i = 0; i < K; i++) {
    const th = ((i + 0.5) / K) * (Math.PI / 2), c = Math.cos(th), s = Math.sin(th);
    const dF = Math.pow(c, m) * 2 * Math.PI * s * (Math.PI / 2 / K), R = fresnelIndep(c, 1, n), T = 1 - R, sT = s / n, cT = Math.sqrt(1 - sT * sT);
    for (let k = 0; k < 6; k++) pts.push([h * Math.tan(th) + (2 * k + 1) * t * sT / cT, dF * T * T * R ** (2 * k) * Math.exp(-mua * t * (2 * k + 1) / cT)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const r = new Float64Array(pts.length), F = new Float64Array(pts.length);
  let acc = 0; pts.forEach(([rr, f], i) => { acc += f; r[i] = rr; F[i] = acc; });
  return (R) => { let lo = 0, hi = r.length - 1; if (R <= r[0]) return 0; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (r[md] <= R) lo = md; else hi = md; } return F[lo]; };
}
const plateGeom = (W, t, cell = 1) => ({ hf: heightfieldFromFn(W, W, cell, () => 0, () => -t), ox: W / 2, oy: W / 2, walls: { x0: 0, x1: W, y0: 0, y1: W } });

// ---- 평판 = 반해석 ----
if (run('PLATE')) {
  const W = 160, t = 2, depth = 8, n = 1.59, mua = 0.01, c = W / 2;
  const geom = plateGeom(W, t);
  const NX = 161, grid = { NX, NY: NX, x0: 0, y0: 0, stepX: 1, stepY: 1 };
  const res = shapeField(geom, depth, [{ x: c, y: c }], { model: 'lambertian', beamX: 120, I0: 1 }, grid, { n, mua, rhoB: 0, full: true, Nt: +(process.env.NT ?? 24), Np: 2 * +(process.env.NT ?? 24) });
  const cum = plateCum(depth - t, t, n, mua, 1);
  const Md = (r) => { const a = Math.max(0, r - 0.05), b = r + 0.05; return (cum(b) - cum(a)) / (Math.PI * (b * b - a * a)); };
  const tentM = (x, y) => { let v = 0; const Q = 16; for (let q = 0; q < Q; q++) for (let p = 0; p < Q; p++) { const u = -1 + (2 * (p + 0.5)) / Q, w = -1 + (2 * (q + 0.5)) / Q; v += (1 - Math.abs(u)) * (1 - Math.abs(w)) * Md(Math.hypot(x + u, y + w)); } return v * 4 / (Q * Q); };
  let e = 0; const rows = [];
  for (const [r0, r1] of [[0, 2], [2, 4], [4, 6], [6, 9], [9, 12], [12, 16], [16, 22], [22, 30]]) {
    // 노드 값 = 쌍선형 분배(텐트 필터, 폭 ±1 노드)의 기대값 — 해석 밀도 M(r) 를 같은 텐트로 적분해 비교
    let sv = 0, sa = 0;
    for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) {
      const r = Math.hypot(i - c, j - c); if (r < r0 || r >= r1) continue;
      sv += res.field[j * NX + i]; sa += tentM(i - c, j - c);
    }
    const fast = sv, ana = sa;
    e = Math.max(e, Math.abs(fast / ana - 1)); rows.push(`${r0}-${r1}:${(fast / ana).toFixed(4)}`);
  }
  console.log('  ' + rows.join(' '));
  const L = res.ledger;
  ok(e <= 0.01, `평판 출사도(광선관) vs 반해석: annulus 최대 오차 ${(e * 100).toFixed(2)}% (≤1%) · ${res.ms.toFixed(0)}ms · 장부 상면 ${(L.top / L.emitted).toFixed(4)} PCB ${(L.pcb / L.emitted).toFixed(4)} 폐합 ${(L.rest / L.emitted).toExponential(1)}`);
}

// ---- VS4: 수렴 — 각도 격자 2배(Nt 24 → 48)에서 중심 80% 평균·균일도 변화 ≤1% / ≤1%p (L3 테이퍼, L4 포켓) ----
if (run('VS4')) {
  const { DEFAULT_SPEC } = await import('../src/model/defaults.js');
  const { buildBodyGeometry } = await import('../src/engine/shape/body-geom.js');
  const { ledPositions } = await import('../src/engine/directLit.js');
  const led = { model: 'lambertian', beamX: 120, I0: 1 };
  for (const [name, lv] of [['L3 테이퍼', 3], ['L4 포켓', 4]]) {
    const s = structuredClone(DEFAULT_SPEC), depth = s.space.depth; if (lv === 4) { s.levels[4].on = true; s.levels[3].on = false; }
    const leds = ledPositions(s, 20, 20), geom = buildBodyGeometry(s, [1, lv], depth, { leds, pitchX: 20, pitchY: 20 });
    const NX = 41, grid = { NX, NY: NX, x0: 0, y0: 0, stepX: 100 / (NX - 1), stepY: 100 / (NX - 1) };
    const opt = { n: 1.59, mua: 0.0005, rhoB: 0.5, uniform: lv === 4, symmetric: true };
    const a = shapeField(geom, depth, leds, led, grid, { ...opt, Nt: 24 }), b = shapeField(geom, depth, leds, led, grid, { ...opt, Nt: 48 });
    const ids = []; for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) if (Math.abs(i / (NX - 1) - 0.5) <= 0.4 && Math.abs(j / (NX - 1) - 0.5) <= 0.4) ids.push(j * NX + i);
    const st = (f) => { const v = ids.map((k) => f[k]); return { mean: v.reduce((p, q) => p + q, 0) / v.length, U: Math.min(...v) / Math.max(...v) }; };
    const A = st(a.field), B = st(b.field), dm = Math.abs(A.mean / B.mean - 1), du = Math.abs(A.U - B.U);
    ok(dm <= 0.01 && du <= 0.01, `VS4 ${name}: Nt 24→48 평균 변화 ${(dm * 100).toFixed(2)}% (≤1%), 균일도 ${(A.U * 100).toFixed(1)}→${(B.U * 100).toFixed(1)}% (≤1%p) · ${a.ms.toFixed(0)}→${b.ms.toFixed(0)}ms`);
  }
}

// ---- VS7: 빠른 solver(앵커 PSF + 벽 거울) vs S1 MC (같은 높이맵·Fresnel 캐비티 벽·PCB ρ_b) ----
// 중심 80% 영역의 평균·균일도(min/max). 빠른 solver 의 정확 모드(LED 마다 실제 벽 포함 추적)도 함께 보고 — 근사 분해용.
if (run('VS7')) {
  const { Worker } = await import('node:worker_threads');
  const { DEFAULT_SPEC } = await import('../src/model/defaults.js');
  const { buildBodyGeometry } = await import('../src/engine/shape/body-geom.js');
  const { ledPositions } = await import('../src/engine/directLit.js');
  const NW = 16, Nper = QUICK ? 2.5e5 : 1.25e6, n = 1.59, mua = 0.0005, rhoB = +(process.env.RHOB ?? 0.5);
  const led = { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 };
  const cases = [], pick = process.env.CASE ? +process.env.CASE : -1;
  { // L1 평판 3mm(기준선 — 벽 거울·재순환 근사 점검), 피치 20
    const s = structuredClone(DEFAULT_SPEC), depth = s.space.depth, leds = ledPositions(s, 20, 20);
    cases.push({ name: 'L1 평판 3mm', geom: buildBodyGeometry(s, [1], depth, { leds, pitchX: 20, pitchY: 20 }), depth, leds, X: s.target.xLen, Y: s.target.yLen, opt: { uniform: true, symmetric: true } });
  }
  { // L3 테이퍼(기본 사양), 피치 20
    const s = structuredClone(DEFAULT_SPEC), depth = s.space.depth, A = [1, 3];
    const leds = ledPositions(s, 20, 20);
    cases.push({ name: 'L3 테이퍼 3→2→1mm', geom: buildBodyGeometry(s, A, depth, { leds, pitchX: 20, pitchY: 20 }), depth, leds, X: s.target.xLen, Y: s.target.yLen, opt: { uniform: false, symmetric: true } });
  }
  { // L4 포켓(국부 형상), 피치 20
    const s = structuredClone(DEFAULT_SPEC), depth = s.space.depth; s.levels[4].on = true; s.levels[3].on = false;
    const leds = ledPositions(s, 20, 20);
    cases.push({ name: 'L4 국부 포켓', geom: buildBodyGeometry(s, [1, 4], depth, { leds, pitchX: 20, pitchY: 20 }), depth, leds, X: s.target.xLen, Y: s.target.yLen, opt: { uniform: true, symmetric: true } });
  }
  { // 불러온 형상 대용: 돔 윗면(R2000, 모서리 −1.25mm) + 바닥 리브 2개(비대칭), 몸체 = 벽 사각형
    const X = 100, Y = 100, depth = 12, hf = heightfieldFromFn(100, 100, 0.25, (x, y) => -((x * x + y * y) / 4000), (x) => (Math.abs(x - 15) < 2 || Math.abs(x + 25) < 1.5 ? -6 : -3));
    const s = structuredClone(DEFAULT_SPEC), leds = ledPositions(s, 20, 20);
    cases.push({ name: '돔·리브(불러온 형상)', geom: { hf, ox: X / 2, oy: Y / 2, walls: { x0: 0, x1: X, y0: 0, y1: Y }, imported: true, periodic: false, key: 'vs7-dome', warnings: [] }, depth, leds, X, Y, opt: { exact: true } });   // 운영 정책: 불러온 몸체 = LED 별 실제 장면 추적(국부 리브를 앵커 평행이동으로 옮기면 −8%p)
  }
  for (const [ci, c] of cases.entries()) {
    if (pick >= 0 && ci !== pick) continue;
    const NX = +(process.env.NXV ?? 21), grid = { NX, NY: NX, x0: 0, y0: 0, stepX: c.X / (NX - 1), stepY: c.Y / (NX - 1) };
    const NTv = process.env.NT ? +process.env.NT : undefined, fast = shapeField(c.geom, c.depth, c.leds, led, grid, { n, mua, rhoB, ...c.opt, Nt: NTv });
    const fastS = shapeField(c.geom, c.depth, c.leds, led, grid, { n, mua, rhoB, ...c.opt, fidelity: 'search' });
    const exact = shapeField(c.geom, c.depth, c.leds, led, grid, { n, mua, rhoB, exact: true, Nt: NTv });
    const hfT = c.geom.hf, wd = { hf: { nx: hfT.nx, ny: hfT.ny, cell: hfT.cell, x0: hfT.x0, y0: hfT.y0, zt: Float64Array.from(hfT.zt), zb: Float64Array.from(hfT.zb), mask: hfT.mask },
      ox: c.geom.ox, oy: c.geom.oy, depth: c.depth, n, mua, rhoB, walls: { ...c.geom.walls, mode: 'fresnel', n }, leds: c.leds, led, N: Nper, grid };
    const res = await Promise.all(Array.from({ length: NW }, (_, i) => new Promise((ok2, bad) => {
      const w = new Worker(new URL('./shape-mc-map-worker.mjs', import.meta.url), { workerData: { ...wd, seed: 31 + i * 7919 } });
      w.on('message', ok2); w.on('error', bad);
    })));
    const mc = new Float64Array(NX * NX); for (const r of res) for (let k = 0; k < mc.length; k++) mc[k] += r.map[k] / NW;
    // 중심 80% 노드
    const ids = []; for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) if (Math.abs(i / (NX - 1) - 0.5) <= 0.4 && Math.abs(j / (NX - 1) - 0.5) <= 0.4) ids.push(j * NX + i);
    const stat = (f) => { const v = ids.map((k) => f[k]); const mean = v.reduce((a, b) => a + b, 0) / v.length; return { mean, U: Math.min(...v) / Math.max(...v) }; };
    const sF = stat(fast.field), sE = stat(exact.field), sM = stat(mc), sS = stat(fastS.field);
    const per = res.map((r) => stat(r.map)), sdU = Math.sqrt(per.reduce((a, q) => a + (q.U - sM.U) ** 2, 0) / (NW - 1) / NW);
    const dMean = Math.abs(sF.mean / sM.mean - 1), dU = Math.abs(sF.U - sM.U);
    if (process.argv.includes('--ledger')) {
      const Lm = res.reduce((a, r) => { for (const k in r.ledger) a[k] = (a[k] ?? 0) + r.ledger[k]; return a; }, {}), Le = exact.ledger;
      console.log(`   장부 MC 상면 ${(Lm.top / Lm.emitted).toFixed(4)} PCB ${(Lm.pcb / Lm.emitted).toFixed(4)} 벽 ${(Lm.wall / Lm.emitted).toFixed(4)} 측면 ${(Lm.side / Lm.emitted).toFixed(4)} 누설 ${(Lm.leak / Lm.emitted).toFixed(4)} | 정확 상면 ${(Le.top / Le.emitted).toFixed(4)} PCB ${(Le.pcb / Le.emitted).toFixed(4)} lost ${(Le.lost / Le.emitted).toFixed(4)} rest ${(Le.rest / Le.emitted).toFixed(4)}`);
    }
    console.log(`  ${c.name}: MC 평균 ${sM.mean.toExponential(3)} U ${(sM.U * 100).toFixed(1)}% (σ ${(sdU * 100).toFixed(2)}%p) | 정확모드 ${(sE.mean / sM.mean).toFixed(4)}·U ${(sE.U * 100).toFixed(1)}% | 빠른 ${(sF.mean / sM.mean).toFixed(4)}·U ${(sF.U * 100).toFixed(1)}% (PSF ${fast.traced}개, ${fast.ms.toFixed(0)}ms) | 탐색정밀도 ${(sS.mean / sM.mean).toFixed(4)}·U ${(sS.U * 100).toFixed(1)}% (${fastS.ms.toFixed(0)}ms)`);
    if (process.argv.includes('--map')) {
      console.log('   빠른/MC 비 (중심 80%, 행 = y):');
      for (let j = 2; j <= NX - 3; j += 2) console.log('   ' + Array.from({ length: NX - 4 }, (_, q) => q + 2).filter((i) => i % 2 === 0).map((i) => (fast.field[j * NX + i] / mc[j * NX + i]).toFixed(2)).join(' '));
      const am = (f) => { let mi = 0, ma = 0; for (const k of ids) { if (f[k] < f[mi] || mi === 0 && !ids.includes(0)) mi = k; if (f[k] > f[ma]) ma = k; } return [mi % NX, (mi / NX) | 0, ma % NX, (ma / NX) | 0]; };
      console.log(`   min/max 위치 MC ${am(mc)} 빠른 ${am(fast.field)}`);
    }
    ok(dMean <= 0.03 && dU <= 0.02, `VS7 ${c.name}: 평균 차 ${(dMean * 100).toFixed(2)}% (≤3%), 균일도 차 ${(dU * 100).toFixed(2)}%p (≤2%p)`);
  }
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
