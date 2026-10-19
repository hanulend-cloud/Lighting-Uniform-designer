// ① Milky 재가중: node test/mech3d-reweight.mjs
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

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
done();
