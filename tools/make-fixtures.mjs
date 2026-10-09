// 시험용 STEP 생성: node tools/make-fixtures.mjs → test/fixtures/*.stp
// cover-dome-rib.stp: 110×110 커버, 윗면 돔(구 R1500, 중심 3mm·모서리 ≈1mm), 바닥 X 방향 리브 2줄(폭 4·높이 2mm)
import fs from 'node:fs';
import initOpenCascade from 'opencascade.js/dist/node.js';
import { box, translate, shapesToStepText, fuseAll } from '../src/export/oc-build.js';

const oc = await initOpenCascade();
const op = (Cls, a, b) => { const m = new oc[Cls](a, b, new oc.Message_ProgressRange_1()); const s = m.Shape(); m.delete(); return s; };
const R = 1500;   // 반경 77.8mm(모서리)에서 처짐 2.0mm → 모서리 두께 ≈1mm
const sph = new oc.BRepPrimAPI_MakeSphere_5(new oc.gp_Pnt_3(55, 55, 3 - R), R).Shape();
const plate = op('BRepAlgoAPI_Common_3', box(oc, 110, 110, 5), sph);
const ribs = [translate(oc, box(oc, 110, 4, 2), 0, 33, -2), translate(oc, box(oc, 110, 4, 2), 0, 73, -2)];
const body = fuseAll(oc, [plate, ...ribs]);
fs.writeFileSync(new URL('../test/fixtures/cover-dome-rib.stp', import.meta.url), shapesToStepText(oc, [body]));
console.log('wrote test/fixtures/cover-dome-rib.stp');
