// ① Milky 재가중: node test/mech3d-reweight.mjs
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';
import { milkyGridOptics, rwCoeffs, rwFactor, essRatio, milkyAxis } from '../src/engine/mech3d/reweight.js';
import { plateFixture } from './m3-fixture.mjs';
import { composeScene, runChunk } from '../src/engine/mech3d/job.js';
import { tallyStats } from '../src/engine/mech3d/tally.js';
import { milkyRows, pickMilky, margin } from '../src/engine/mech3d/milky-search.js';

const table = loadTable();
const part = (i, kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(i, `p${i}`, 1), kind));
const scene = (meshes, parts) => { setMech3dMesh('t', meshes); return buildTraceScene(getMech3d(), { name: 't', parts, contacts: [] }, { table }); };
const beam = { flux: 1, sample: (r) => [4.5 + r(), 4.5 + r(), -1, 0, 0, 1] };

{ // 투명 판(두께 2) 수직 통과: 직진 탈출 광자의 L = 2, k = 0
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'clear', { T: 0.99 })]);
  let bad = 0, n = 0;
  runMC3D(S, { source: beam, N: 2000, seed: 3, track: 0, onEscape: (x, y, z, dx, dy, dz, w, p, tL, tK) => { if (dz > 0.999) { n++; if (Math.abs((tL - 2) % 4) > 1e-9 || tK !== 0) bad++; } } });
  ok(n > 1500 && bad === 0, `투명 판 직진: L=2+4m·k=0 (${n}개, 불일치 ${bad})`);
}
{ // Milky 판: 산란은 μs 포아송 과정 → E[k] = μs·E[L]
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'milky', { milky: 3 })]);
  let sk = 0, sL = 0;
  runMC3D(S, { source: beam, N: 20000, seed: 5, track: 0, onEscape: (x, y, z, dx, dy, dz, w, p, tL, tK) => { sk += tK; sL += tL; } });
  const mus = S.optics[0].mus, r = sk / (mus * sL);
  ok(Math.abs(r - 1) < 0.03, `Milky 3: Σk / (μs·ΣL) = ${r.toFixed(4)} (≈1)`);
}
{ // track 을 주지 않으면 tL·tK 는 undefined, 결과(ledger)는 track 과 비트 동일
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'milky', { milky: 3 })]);
  let undef = true;
  const a = runMC3D(S, { source: beam, N: 3000, seed: 9, onEscape: (...g) => { if (g[8] !== undefined) undef = false; } });
  const b = runMC3D(S, { source: beam, N: 3000, seed: 9, track: 0 });
  ok(undef && JSON.stringify(a.ledger) === JSON.stringify(b.ledger), 'track 없음 = 기존 동작, 같은 시드면 ledger 동일');
}
{ const p = part(0, 'milky', { milky: 3 }), ms = milkyAxis(3, 0.25, 9.9), G = milkyGridOptics(p, { table }, ms);
  ok(ms.length === 21 && ms[0] === 0.5 && ms[20] === 5.5 && ms.every((m, i) => !i || Math.abs(m - ms[i - 1] - 0.25) < 1e-9), `Milky 축: 기준 3 주변 21점 0.25 간격 (${ms[0]}~${ms[20]})`);
  ok(milkyAxis(1, 0.25, 9.9)[0] === 0.25 && milkyAxis(9, 0.25, 9.9).at(-1) === 9.9, 'Milky 축: 0.25 미만·9.9 초과는 잘라 범위 안으로 밀기');
  const base = G[ms.indexOf(3)], C = rwCoeffs(base, G);
  ok(Math.abs(rwFactor(C, ms.indexOf(3), 2.7, 13) - 1) < 1e-12 && G.every((g) => g.g === base.g), '기준점 가중치 = 1 · g 고정');
  const j = ms.indexOf(4), f = rwFactor(C, j, 2, 5), want = (G[j].mus / base.mus) ** 5 * Math.exp(-((G[j].mus + G[j].mua) - (base.mus + base.mua)) * 2);
  ok(Math.abs(f / want - 1) < 1e-12, `가중치 식 f = (μs'/μs)^k·e^{−Δμt·L}: ${f.toExponential(4)}`);
  const e = essRatio(new Float64Array([10, 10]), new Float64Array([10, 50]), 10);
  ok(Math.abs(e[0] - 1) < 1e-12 && Math.abs(e[1] - 0.2) < 1e-12, 'ESS 비율 = (Σf)²/(n·Σf²)');
  let thrown = ''; try { rwCoeffs({ mus: 0, mua: 0, g: 0.9 }, G); } catch (er) { thrown = er.message; }
  ok(/기준 Milky/.test(thrown), '기준 μs = 0 이면 재가중 불가 — 오류'); }
{ const F = plateFixture(table), ms = milkyAxis(3, 0.025), base = F.S.optics[0], fi = (v) => ms.findIndex((x) => Math.abs(x - v) < 1e-9);
  const grid = milkyGridOptics(F.mspec.parts[0], { table }, ms), C = rwCoeffs(base, grid), nCell = F.G.ns * F.G.nw;
  const B = 12, rwAccs = Array.from({ length: grid.length }, () => []);
  let n = 0; const sf = new Float64Array(grid.length), sf2 = new Float64Array(grid.length);
  for (let b = 0; b < B; b++) {
    const r = runChunk({ ...F, N: 25000, seed: 100 + b, rw: { part: 0, C } });
    for (let j = 0; j < grid.length; j++) rwAccs[j].push(r.rw.acc.slice(j * nCell, (j + 1) * nCell));
    n += r.rw.n; for (let j = 0; j < grid.length; j++) { sf[j] += r.rw.sf[j]; sf2[j] += r.rw.sf2[j]; }
    if (b === 0) ok(r.rw.acc.subarray(fi(3) * nCell, (fi(3) + 1) * nCell).every((v, k) => Math.abs(v - r.acc[k]) <= 1e-12 * Math.max(1, r.acc[k])), '기준 Milky 격자 지도 = 일반 집계');
  }
  const ess = essRatio(sf, sf2, n);
  for (const m of [2.8, 3.2]) {   // A-1: 기준 ±0.2 (재가중 창 = 기준 ±0.25, spec 개정)
    const j = fi(m), pm = { ...F.mspec, parts: [setPartMaterialParam(F.mspec.parts[0], 'milky', m)] };
    const S2 = composeScene({ rt: F.rt, mspec: pm, ledParts: null, table, db: null, line: F.line });
    const dir = Array.from({ length: B }, (_, b) => runChunk({ ...F, S: S2, N: 25000, seed: 900 + b }).acc);
    const a = tallyStats(F.G, rwAccs[j], F.obs), d = tallyStats(F.G, dir, F.obs);
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, se = (v) => Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1) / v.length);
    const zOf = (va, vd) => Math.abs(mean(va) - mean(vd)) / Math.hypot(se(va), se(vd));
    // (b) 총광량(유효 셀 합) — 편향에 가장 민감  (c) 길이 방향 행(i)별 Σ출사/Σ면적의 최대 z
    const tot = (x) => { let s = 0; for (let k = 0; k < nCell; k++) if (F.G.valid[k]) s += x[k]; return s; };
    const zTot = zOf(rwAccs[j].map(tot), dir.map(tot));
    let zRow = 0;
    for (let i = 0; i < F.G.ns; i++) {
      let ar = 0; for (let w = 0; w < F.G.nw; w++) if (F.G.valid[i * F.G.nw + w]) ar += F.G.area[i * F.G.nw + w];
      if (!(ar > 0)) continue;
      const row = (x) => { let s = 0; for (let w = 0; w < F.G.nw; w++) if (F.G.valid[i * F.G.nw + w]) s += x[i * F.G.nw + w]; return s / ar; };
      const va = rwAccs[j].map(row), vd = dir.map(row);
      if (mean(va) + mean(vd) > 0) zRow = Math.max(zRow, zOf(va, vd));
    }
    // (d) U 는 ≈0.05 로 가장 잡음 큰 최소 행에 좌우돼 편향 검출력이 낮다 — 느슨한 0.03
    const dU = Math.abs(a.Ulen - d.Ulen);
    ok(ess[j] >= 0.3 && zTot < 3 && zRow < 4 && dU <= 0.03, `A-1 Milky ${m}: ESS ${ess[j].toFixed(2)} · 총광량 z ${zTot.toFixed(2)} · 행 최대 z ${zRow.toFixed(2)} · U 재가중 ${a.Ulen.toFixed(3)} vs 직접 ${d.Ulen.toFixed(3)}`);
  } }
{ // 합성: 셀 1행(길이 10칸 × 폭 1칸), Milky 가 클수록 리플이 줄고 효율이 준다
  const G = { ns: 10, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 10, closed: false, winS: 5, area: new Float64Array(10).fill(1), valid: new Uint8Array(10).fill(1) };
  const obs = { targetLen: 0.8, targetWid: 0.5 };
  const ms = [1, 2, 3, 4, 5], amp = (m) => 0.5 / m, eff = (m) => 1 - 0.05 * m;
  const mk = (m) => Float64Array.from({ length: 10 }, (_, i) => eff(m) * (1 + amp(m) * Math.cos(i)));
  const batches = Array.from({ length: 4 }, () => { const a = new Float64Array(5 * 10); ms.forEach((m, j) => a.set(mk(m), j * 10)); return a; });
  const rows = milkyRows(G, obs, { milkies: ms, batches, ess: new Float64Array([1, 1, 1, 1, 0.1]), emitted: 10 });
  ok(rows.length === 5 && rows[4].trusted === false && rows[0].trusted, '행: ESS 0.1 은 믿지 않음');
  // U = (1−a)/(1+a) ≥ 0.8 ⇔ a ≤ 1/9 ⇔ m ≥ 4.5 → 믿는 행 중 통과 없음 → 가장 가까운 안 = Milky 4
  const p = pickMilky(rows, obs);
  ok(!p.feasible && p.best.milky === 4 && /Milky 4/.test(p.reason), `통과 없음 → 가장 가까운 안 Milky 4: ${p.reason}`);
  const obs2 = { targetLen: 0.6, targetWid: 0.5 };   // a ≤ 0.25 ⇔ m ≥ 2 → 보간 경계: m=1 (U 0.333) 과 m=2 (U 0.6) 사이 → 2
  const p2 = pickMilky(milkyRows(G, obs2, { milkies: ms, batches, ess: new Float64Array(5).fill(1), emitted: 10 }), obs2);
  ok(p2.feasible && Math.abs(p2.milky - 2) < 0.02 && p2.edge === null, `최소 Milky ≈ 2: ${p2.milky}`);
  const p3 = pickMilky(milkyRows(G, { targetLen: 0.2, targetWid: 0.1 }, { milkies: ms, batches, ess: new Float64Array(5).fill(1), emitted: 10 }), { targetLen: 0.2, targetWid: 0.1 });
  ok(p3.feasible && p3.milky === 1 && p3.edge === 'low', '창 맨 아래도 통과 → 더 낮은 쪽으로 기준 이동 신호(edge=low)');
  ok(margin({ Ulen: 0.7, Uwid: null }, obs) === 0.7 - 0.8, '폭 판정 없음(좁은 라인) → 길이만'); }
{ const a = milkyAxis(3); ok(a.length === 21 && Math.abs(a[0] - 2.75) < 1e-9 && Math.abs(a[20] - 3.25) < 1e-9, `milkyAxis(3) 기본 창 21점 2.75~3.25: ${a[0]}~${a[20]}`); }
done();
