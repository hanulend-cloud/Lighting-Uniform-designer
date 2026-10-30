// 계산 수렴 진단(진단용): ㄱ자 Milky 확산 부품 + LED 40 → 왼쪽 위 출구(관측면) — 광자당 시간 · 관측면 도달률 · 잡음 수렴
// node test/bench-calc.mjs [Milky=2] [광자=200000]
import initOpenCascade from 'opencascade.js/dist/node.js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { setMech3dMesh, getMech3d, initialMech3dSpec } from '../src/engine/mech3d/runtime.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { tallyGeometry, tallyStats } from '../src/engine/mech3d/tally.js';
import { runChunk } from '../src/engine/mech3d/job.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { loadTable } from './l2-util.mjs';

const milky = +(process.argv[2] ?? 2), Ntot = +(process.argv[3] ?? 200000);
const def = fileURLToPath(new URL('./fixtures/bent-diffuser-40led.stp', import.meta.url));
const oc = await initOpenCascade();
if (!existsSync(def)) { const { buildBentShapes } = await import('./fixtures/bent-diffuser-40led.mjs'); const { shapesToStepText } = await import('../src/export/oc-build.js'); writeFileSync(def, shapesToStepText(oc, buildBentShapes(oc))); }
const parts = readStepParts(oc, readFileSync(def, 'utf8'));
setMech3dMesh('bent', parts);
const rt = getMech3d(), M = initialMech3dSpec();
// 부품 찾기: 확산 부품 = x 가 −5.5 부터 시작(왼쪽 세로 다리), LED = 작은 부품
const bb = rt.parts.map((p) => bounds(p.positions));
const dif = bb.findIndex((b) => Math.abs(b[0] + 5.5) < 0.01 && b[5] > 29.9);
M.parts[dif] = setPartMaterialParam(setPartMaterial(M.parts[dif], 'milky'), 'milky', milky);
const leds = bb.map((b, i) => (b[3] - b[0] < 5 && b[4] - b[1] < 5 ? i : -1)).filter((i) => i >= 0);
for (const i of leds) M.parts[i] = { ...M.parts[i], untrace: true };   // LED 몸체 = 광원(도면 광원처럼 추적 제외)
// 관측면 = 세로 다리 윗면(z = 30, +z)
const P = rt.parts[dif], T = P.triangles, fz = new Map();
for (let t = 0; t < T.length / 3; t++) { const z = [0, 1, 2].map((k) => P.positions[3 * T[3 * t + k] + 2]); if (z.every((v) => Math.abs(v - 30) < 1e-3)) fz.set(P.faceIds[t], true); }
const faces = [...fz.keys()].map((face) => ({ part: dif, face }));
M.observe.faces = faces; M.observe.dir = [0, 0, 1];
const line = recognizeLine(rt.parts, faces, [0, 0, 1]);
const obs = { ...M.observe, cell: null };
const G = tallyGeometry(line, obs);
const S = buildTraceScene(rt, M, { table: loadTable() });
const emitters = leds.map((i) => { const b = bb[i]; return { pos: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[5] + 0.01], axis: [0, 0, 1], xAxis: [1, 0, 0] }; });
console.log(`Milky ${milky} · LED ${emitters.length} · 관측면 ${faces.length}면 · 격자 ${G.ns}×${G.nw} (칸 ${(G.ds ?? 0).toFixed(2)} mm)`);
const B = 10, accs = [], cnts = []; let esc = 0, ms = 0, emitted = 0;
for (let b = 0; b < B; b++) {
  const r = runChunk({ S, line, obs, G, emitters, ledSpec: M.light.spec, N: Ntot / B, seed: 100 + b });
  accs.push(r.acc); cnts.push(r.cnt); esc += r.escObs; ms += r.ms; emitted += r.ledger.emitted;
}
const st = tallyStats(G, accs, { ...obs, targetLen: 0.8, targetWid: 0.8 }, cnts);
console.log(`광자 ${Ntot} · ${Math.round(ms)} ms (${Math.round(Ntot / ms * 1000)} 광자/s, 1 스레드) · 관측면 출사 ${(esc / emitted * 100).toFixed(1)}%`);
console.log(`칸 잡음 ${(st.relNoise * 100).toFixed(1)}% → 2% 까지 필요 광자 ≈ ${Math.round(Ntot * (st.relNoise / 0.02) ** 2).toLocaleString()} · 길이 균일도 ${st.Ulen.toFixed(2)} ± ${(st.seLen ?? 0).toFixed(3)} · 폭 균일도 ${st.Uwid?.toFixed(2)} ± ${(st.seWid ?? 0).toFixed(3)}`);
