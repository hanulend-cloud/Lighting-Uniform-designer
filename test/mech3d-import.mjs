// 다중 부품 STEP 불러오기 왕복(V3D-7) + 샘플 기구 접촉면: node test/mech3d-import.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapesToStepText } from '../src/export/oc-build.js';
import { readStepParts, readStepMesh } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { findContacts } from '../src/engine/mech3d/contacts.js';
import { setMech3dMesh, initialMech3dSpec, getMech3d } from '../src/engine/mech3d/runtime.js';
import { buildSampleShapes, SAMPLE } from './fixtures/mech3d-sample.mjs';
import { ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade();
const text = shapesToStepText(oc, buildSampleShapes(oc, { cylinder: true }));
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
setMech3dMesh('sample.stp', parts);
const ms = initialMech3dSpec();
ok(getMech3d().combined.partOf.length === parts.reduce((s, p) => s + p.triangles.length / 3, 0) && getMech3d().bvh.order.length === getMech3d().combined.partOf.length, '런타임: 결합 메쉬·BVH 생성');
ok(ms.name === 'sample.stp' && ms.parts.length === 4 && ms.parts[0].name === '부품 1' && ms.parts[3].material.kind === 'opaque', '초기 spec: 부품 4개, 기본 소재 불투명');
ok(ms.parts[0].size.every((v, k) => Math.abs(v - [120, 20, 12][k]) < 1e-3), `초기 spec: 하우징 외곽 ${ms.parts[0].size.join('×')}`);
ok(ms.contacts.length === c.length && ms.contacts.every((x) => x.mode === 'contact'), '초기 spec: 접촉면 기본 = 광학 접촉');
done();
