// 삼각형 메쉬 → STEP 솔리드: node test/mesh-step.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { meshToStepText } from '../src/export/mesh-step.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';
import { frameHeights, deformPart, refineForBumps } from '../src/engine/mech3d/shape-opt.js';

const oc = await initOpenCascade(), m = boxMesh(0, 0, 0, 40, 10, 2);
const text = meshToStepText(oc, m);
const back = readStepParts(oc, text);
ok(/ISO-10303-21/.test(text) && back.length === 1 && back[0].faceCount === 6 && Math.abs(meshVolume(back[0].positions, back[0].triangles) - 800) < 0.5, `STEP 왕복: 부품 1개, 같은 평면 합침(면 6개), 부피 ${back.length ? meshVolume(back[0].positions, back[0].triangles).toFixed(2) : '–'}`);
{ // 세분·변형 판 + 일직선(퇴화) 삼각형 1개 → STEP 왕복 부피 ±1%
  const frame = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, pl = boxMesh(0, 0, 0, 60, 40, 3), C = [[15, 20], [45, 20]], R = 9;
  const H = frameHeights(pl, frame, 0.5), d = deformPart(refineForBumps(pl, frame, C, R, R / 3, { H }), frame, H, { dt: 0.3, h: 0.8, R, centers: C });
  const nV = d.positions.length / 3, P = Float32Array.from([...d.positions, 0, 0, 3, 30, 0, 3, 60, 0, 3]);
  const mesh = { ...d, positions: P, triangles: Uint32Array.from([...d.triangles, nV, nV + 1, nV + 2]), faceIds: Uint32Array.from([...d.faceIds, 1]) };
  const want = meshVolume(d.positions, d.triangles), t0 = performance.now(), txt = meshToStepText(oc, mesh), ms = performance.now() - t0;
  const bk = readStepParts(oc, txt), got = bk.length === 1 ? meshVolume(bk[0].positions, bk[0].triangles) : NaN;
  ok(bk.length === 1 && Math.abs(got / want - 1) < 0.01, `세분·변형 판(삼각형 ${d.triangles.length / 3}개 + 퇴화 1개) STEP 왕복 부피 ${got.toFixed(2)} ≈ ${want.toFixed(2)} · ${ms.toFixed(0)} ms · ${(txt.length / 1024).toFixed(0)} KB`); }
done();
