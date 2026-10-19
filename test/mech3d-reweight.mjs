// ① Milky 재가중: node test/mech3d-reweight.mjs
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';
import { milkyGridOptics, rwCoeffs, rwFactor, essRatio, milkyAxis } from '../src/engine/mech3d/reweight.js';

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
done();
