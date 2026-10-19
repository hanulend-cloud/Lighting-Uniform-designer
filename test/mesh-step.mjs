// 삼각형 메쉬 → STEP 솔리드: node test/mesh-step.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { meshToStepText } from '../src/export/mesh-step.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade(), m = boxMesh(0, 0, 0, 40, 10, 2);
const text = meshToStepText(oc, m);
const back = readStepParts(oc, text);
ok(/ISO-10303-21/.test(text) && back.length === 1 && Math.abs(meshVolume(back[0].positions, back[0].triangles) - 800) < 0.5, `STEP 왕복: 부품 1개, 부피 ${back.length ? meshVolume(back[0].positions, back[0].triangles).toFixed(2) : '–'}`);
done();
