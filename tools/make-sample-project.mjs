// 예제 3D 프로젝트(평판 구조 + LED STEP 10개 1열) 설정 파일 생성: node tools/make-sample-project.mjs
// 기구 = test/fixtures/mech3d-sample.stp, LED = test/fixtures/mech3d-led-sample.stp. 결과 data/sample-project.json 은 시작 화면 [예제 프로젝트] 가 씀.
import { readFileSync, writeFileSync } from 'node:fs';
const { default: initOpenCascade } = await import('opencascade.js/dist/node.js');
const { readStepParts } = await import('../src/engine/shape/step-import.js');
const { setMech3dMesh, initialMech3dSpec, applyPartMods, redetectContacts } = await import('../src/engine/mech3d/runtime.js');
const { setPartMaterial } = await import('../src/engine/mech3d/materials.js');
const oc = await initOpenCascade();
const parts = readStepParts(oc, readFileSync('test/fixtures/mech3d-sample.stp', 'utf8'));
setMech3dMesh('mech3d-sample.stp', parts);
const ms = initialMech3dSpec();
// 부품 1 = 케이스(불투명 · 반사 소재 PC 고반사 95%), 부품 2 = 도광판(Milky 2), 부품 3 = 투명 커버(크기·위치 조정)
ms.parts[0] = { ...ms.parts[0], finish: { kind: 'whiteDiffuse', R: 0.95 }, reflMaterial: 'pc-hr' };
ms.parts[1] = { ...setPartMaterial(ms.parts[1], 'milky'), name: ms.parts[1].name }; ms.parts[1].material = { ...ms.parts[1].material, milky: 2, resin: 'PC' };
ms.parts[2] = setPartMaterial(ms.parts[2], 'clear'); ms.parts[2].xform = { offset: [0, 0, 2.33], scale: [0.9875, 3.9875, 0.191667] };
if (applyPartMods(ms.parts)) ms.contacts = redetectContacts(ms.contacts);
ms.observe = { ...ms.observe, faces: [{ part: 1, face: 5 }], targetLen: 0.8, targetWid: 0.8 };
ms.light = { ...ms.light, kind: 'step', step: { name: 'mech3d-led-sample.stp', offset: [0, 0, 0], rot: [0, 0, 0], ref: { part: 7, face: 10 }, leds: [], excluded: [], pcb: -1, emitters: [], virtual: null } };
writeFileSync('data/sample-project.json', JSON.stringify({ about: '평판 구조 + LED STEP 10개 1열 — 케이스 PC 고반사 95%, 도광판 Milky 2, 목표 0.80/0.80', mech: 'test/fixtures/mech3d-sample.stp', led: 'test/fixtures/mech3d-led-sample.stp', mech3d: ms }, null, 1));
console.log('parts', ms.parts.map((p) => `${p.name}:${p.material.kind}`).join(' '), 'contacts', ms.contacts.length);
