// 3D 기구 런타임 — spec 2026-10-14 §3. 메쉬·BVH 는 여기(메모리 + IndexedDB), 사용자 지정(소재·면 처리·접촉면)은 spec.mech3d(JSON 저장).
import { combineParts, bounds } from './mesh.js';
import { buildBvh } from './bvh.js';
import { findContacts } from './contacts.js';
import { defaultPart } from './materials.js';
import { defaultLight, defaultObserve, defaultChecks } from './defs.js';

let scene = null;   // { name, parts: [{ positions, triangles, faceIds, faceCount, volume, bvh }], combined, bvh }

// 전역을 바꾸지 않는 장면 메쉬 생성(계산 작업용) — 부품별 BVH + 결합 메쉬 + 결합 BVH
export function buildSceneMesh(name, rawParts) {
  const parts = rawParts.map((p) => (p.bvh ? p : { ...p, bvh: buildBvh(p.positions, p.triangles) }));
  const combined = combineParts(parts);
  return { name, parts, combined, bvh: buildBvh(combined.positions, combined.triangles) };
}
export function setMech3dMesh(name, rawParts) {
  scene = buildSceneMesh(name, rawParts);
  return scene;
}
export function getMech3d() { return scene; }
export function clearMech3d() { scene = null; }

// 새로 불러온 기구의 사용자 지정 초기값(spec.mech3d)
export function initialMech3dSpec() {
  if (!scene) return null;
  return {
    name: scene.name,
    parts: scene.parts.map((p, i) => {
      const b = bounds(p.positions);
      return { ...defaultPart(i, `부품 ${i + 1}`, p.volume), size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]] };
    }),
    contacts: findContacts(scene.parts).map((c) => ({ ...c, mode: 'contact' })),
    light: defaultLight(), observe: defaultObserve(), checks: defaultChecks(),
  };
}

// ---- IndexedDB 보관(브라우저 전용) — L3 몸체와 같은 DB, 다른 키 ----
const DB = 'uds-shape', STORE = 'body', KEY = 'mech3d';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveMech3dIDB() {
  if (typeof indexedDB === 'undefined' || !scene) return;
  const d = await idb();
  const parts = scene.parts.map(({ positions, triangles, faceIds, faceCount, volume }) => ({ positions, triangles, faceIds, faceCount, volume }));
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name: scene.name, parts }, KEY);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function loadMech3dIDB() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return v ? setMech3dMesh(v.name, v.parts) : null;
  } catch { return null; }
}

// ---- LED STEP(PCB + LED) 메쉬 — 원본(변환 전) 보관, 위치 맞춤은 spec.mech3d.light.step.offset/rot ----
let ledScene = null;   // { name, parts: [{ positions, triangles, faceIds, faceCount, volume }] }
export function setLedMesh(name, parts) { ledScene = { name, parts }; return ledScene; }
export function getLedMesh() { return ledScene; }
export function clearLedMesh() { ledScene = null; }
export async function saveLedIDB() {
  if (typeof indexedDB === 'undefined' || !ledScene) return;
  const d = await idb();
  await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(ledScene, 'mech3d-led'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function loadLedIDB() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get('mech3d-led'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return v ? setLedMesh(v.name, v.parts) : null;
  } catch { return null; }
}
