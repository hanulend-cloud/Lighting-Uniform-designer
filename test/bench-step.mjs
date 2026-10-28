// 큰 기구 STEP 불러오기 단계별 시간(진단용): node test/bench-step.mjs [파일.stp]
// 기본 파일 = test/fixtures/bent-diffuser-40led.stp(ㄱ자 확산 부품 400 mm + LED 40 — node test/fixtures/bent-diffuser-40led.mjs 로 생성)
import initOpenCascade from 'opencascade.js/dist/node.js';
import { readFileSync } from 'node:fs';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { buildSceneMesh } from '../src/engine/mech3d/runtime.js';
import { findContacts } from '../src/engine/mech3d/contacts.js';

const file = process.argv[2] ?? new URL('./fixtures/bent-diffuser-40led.stp', import.meta.url);
const oc = await initOpenCascade();
const text = readFileSync(file, 'utf8');
let t = performance.now();
const parts = readStepParts(oc, text);
console.log(`부품 ${parts.length}개 · STEP 해석+메쉬 ${Math.round(performance.now() - t)} ms`);
console.log(`삼각형: 부품별(앞 4개) ${parts.slice(0, 4).map((p) => p.triangles.length / 3).join(', ')} · 합계 ${parts.reduce((s, p) => s + p.triangles.length / 3, 0)}`);
t = performance.now(); const sc = buildSceneMesh('b', parts); console.log(`buildSceneMesh(BVH) ${Math.round(performance.now() - t)} ms`);
t = performance.now(); const c = findContacts(sc.parts); console.log(`findContacts ${Math.round(performance.now() - t)} ms · 접촉 ${c.length}`);
