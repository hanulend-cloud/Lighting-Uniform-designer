// 다중 부품 STEP 불러오기 왕복(V3D-7) + 샘플 기구 접촉면: node test/mech3d-import.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapesToStepText } from '../src/export/oc-build.js';
import { readStepParts, readStepMesh } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { findContacts } from '../src/engine/mech3d/contacts.js';
import { buildSampleShapes, SAMPLE } from './fixtures/mech3d-sample.mjs';
import { ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade();
const text = shapesToStepText(oc, buildSampleShapes(oc));
const t0 = performance.now();
const parts = readStepParts(oc, text);
ok(parts.length === 4, `부품 수 4: ${parts.length} (${(performance.now() - t0).toFixed(0)}ms)`);
parts.forEach((p, i) => {
  const vm = meshVolume(p.positions, p.triangles), e = Math.abs(vm / p.volume - 1);
  ok(Math.abs(p.volume / SAMPLE.volumes[i] - 1) < 1e-6 && e <= 0.005, `V3D-7 부품 ${i}: OC ${p.volume.toFixed(1)} / 메쉬 ${vm.toFixed(1)} mm³ (차 ${(e * 100).toFixed(3)}% ≤ 0.5%)`);
  ok(p.faceCount === SAMPLE.faceCounts[i] && Math.max(...p.faceIds) < p.faceCount && p.faceIds.length === p.triangles.length / 3, `부품 ${i} 면 ${p.faceCount}개, 삼각형별 면 번호`);
});
const c = findContacts(parts), sum = {};
for (const x of c) sum[`${x.a}|${x.b}`] = (sum[`${x.a}|${x.b}`] ?? 0) + x.area;
for (const [k, want] of Object.entries(SAMPLE.contactArea)) ok(Math.abs((sum[k] ?? 0) - want) < 0.05, `접촉 ${k}: ${(sum[k] ?? 0).toFixed(2)} / 기대 ${want} mm²`);
ok(!Object.keys(sum).some((k) => k.endsWith('|3') || k.startsWith('3|')), '떨어진 원기둥은 접촉 없음');
const legacy = readStepMesh(oc, text);
ok(legacy.solidCount === 4 && Math.abs(legacy.volume - SAMPLE.volumes[0]) < 1e-3 && legacy.droppedVolumes.length === 3, '기존 readStepMesh(L3 몸체) 동작 유지');
done();
