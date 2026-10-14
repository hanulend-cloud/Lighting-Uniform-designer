// 3D MC 추적기 — 에너지 보존(V3D-2)·접촉면 해석해(V3D-6)·전반사 도광: node test/mech3d-mc.mjs
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { ledSource, combineSources } from '../src/engine/mech3d/sources.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartMaterialParam, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable(), n = 1.586, R = ((n - 1) / (n + 1)) ** 2;
const part = (i, kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(i, `p${i}`, 1), kind));
const scene = (meshes, parts, contacts = []) => { setMech3dMesh('t', meshes); return buildTraceScene(getMech3d(), { name: 't', parts, contacts }, { table }); };
const beam = { flux: 1, sample: (r) => [4.5 + r(), 4.5 + r(), -1, 0, 0, 1] };   // 1×1mm 수직 평행광(z=−1 → +z)
const balance = (L) => Math.abs(L.emitted + L.rrGain - (L.escaped + L.absSurf + L.absVol + L.lost + L.rrLoss)) / L.emitted;
const transmit = (S, N = 200000) => { let up = 0; const res = runMC3D(S, { source: beam, N, seed: 11, onEscape: (x, y, z, dx, dy, dz, w) => { if (dz > 0) up += w; } }); return { T: up / res.ledger.emitted, L: res.ledger }; };

{   // V3D-6: 판 2장 광학 접촉 = 판 1장, 공기층(맞붙음·0.5mm 떨어짐) = 판 2장
  const T1 = (1 - R) / (1 + R), T2 = (1 - R) / (1 + 3 * R);
  const a = boxMesh(0, 0, 0, 10, 10, 2), b = boxMesh(0, 0, 2, 10, 10, 2), bFar = boxMesh(0, 0, 2.5, 10, 10, 2);
  const c = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'contact' }]));
  ok(Math.abs(c.T - T1) < 0.004, `V3D-6 광학 접촉: T ${c.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  const g = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'air' }]));
  ok(Math.abs(g.T - T2) < 0.004, `V3D-6 맞붙은 공기층: T ${g.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const s = transmit(scene([a, bFar], [part(0, 'clear'), part(1, 'clear')]));
  ok(Math.abs(s.T - T2) < 0.004, `V3D-6 0.5mm 공기층: T ${s.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const one = transmit(scene([a], [part(0, 'clear')]));
  ok(Math.abs(one.T - T1) < 0.004, `판 1장: T ${one.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  ok([c, g, s, one].every((x) => x.L.lost === 0 && balance(x.L) < 1e-9), 'V3D-2(투명): 원장 보존, lost 0');
}
{   // 전반사 도광: 100×4×4 투명 바 끝면(x=0)에 30° 입사 → 옆면 누설 없음
  const S = scene([boxMesh(0, 0, 0, 100, 4, 4)], [part(0, 'clear')]);
  const a = Math.PI / 6, src = { flux: 1, sample: (r) => [-1, 1.5 + r(), 1.5 + r() - Math.tan(a), Math.cos(a), 0, Math.sin(a)] };
  let side = 0, end = 0;
  const res = runMC3D(S, { source: src, N: 50000, seed: 3, onExit: (q, f, x, y, z, dx, dy, dz, w) => { if (f === 5) end += w; else if (f !== 4) side += w; } });
  ok(side === 0 && end > 0.85 && balance(res.ledger) < 1e-9, `TIR 도광: 옆면 ${side}, 끝면 ${end.toFixed(3)}`);
}
{   // V3D-2(산란·흡수·반사): Milky 판 + 백색 PCB + 흑색 벽 + LED 2개
  // 부품끼리 면이 겹치지 않게 배치(겹친 면은 P1 접촉면 감지 + contacts 지정이 있어야 의미가 정해짐)
  const plate = boxMesh(-20, -20, 10, 40, 40, 2), pcb = boxMesh(-30, -30, -1, 60, 60, 1), wall = boxMesh(25, -30, 0.5, 2, 60, 12);
  const S = scene([plate, pcb, wall], [part(0, 'milky', { milky: 5 }), setPartFinish(defaultPart(1, 'pcb', 1), null, { kind: 'whiteDiffuse', R: 0.8 }), setPartFinish(defaultPart(2, 'wall', 1), null, { kind: 'black', R: 0.05 })]);
  const src = combineSources([ledSource({ x: -5, y: 0, z: 0 }), ledSource({ x: 5, y: 0, z: 0 })]);
  const res = runMC3D(S, { source: src, N: 40000, seed: 9 });
  const L = res.ledger;
  ok(balance(L) < 1e-9 && L.lost === 0 && L.absVol > 0 && L.absSurf > 0 && L.escaped > 0, `V3D-2: 오차 ${balance(L).toExponential(1)}, 탈출 ${(L.escaped / L.emitted).toFixed(3)}, 체적흡수 ${(L.absVol / L.emitted).toFixed(3)}, 면흡수 ${(L.absSurf / L.emitted).toFixed(3)}`);
  ok(Math.abs(src.flux - 2 * Math.PI) < 1e-9, `광원 광속 = LED 2개 × Lambert π: ${src.flux.toFixed(4)}`);
}
done();
