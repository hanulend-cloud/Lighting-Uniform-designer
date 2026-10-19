// 3D 기구 런타임 — spec 2026-10-14 §3. 메쉬·BVH 는 여기(메모리 + IndexedDB), 사용자 지정(소재·면 처리·접촉면)은 spec.mech3d(JSON 저장).
import { combineParts, bounds } from './mesh.js';
import { buildBvh } from './bvh.js';
import { findContacts } from './contacts.js';
import { defaultPart } from './materials.js';
import { defaultLight, defaultObserve, defaultChecks } from './defs.js';
import { scaleMoveMesh, isIdentityXform } from './xform.js';
import { heightsFor, deformPart, refinedFor } from './shape-opt.js';

let raw = null, xkey = '', pmemo = [];   // raw = 불러온 원본 장면(변환 전) — IndexedDB 에는 원본만 보관. pmemo[i] = { raw, key, mesh } 부품별 메모(다른 부품만 바뀌면 다시 안 만듦)
let scene = null;   // { name, parts: [{ positions, triangles, faceIds, faceCount, volume, bvh }], combined, bvh }

// 전역을 바꾸지 않는 장면 메쉬 생성(계산 작업용) — 부품별 BVH + 결합 메쉬 + 결합 BVH
export function buildSceneMesh(name, rawParts) {
  const parts = rawParts.map((p) => (p.bvh ? p : { ...p, bvh: buildBvh(p.positions, p.triangles) }));
  const combined = combineParts(parts);
  return { name, parts, combined, bvh: buildBvh(combined.positions, combined.triangles) };
}
export function setMech3dMesh(name, rawParts) {
  raw = buildSceneMesh(name, rawParts); raw.raw = raw; xkey = ''; pmemo = [];
  scene = raw;
  return scene;
}
// 현재 장면(부품 크기·위치 조절 반영). scene.raw = 원본 장면(같은 기구인지 비교용)
export function getMech3d() { return scene; }
export function clearMech3d() { scene = raw = null; xkey = ''; pmemo = []; }
// 부품 변경 = 크기·위치(xform) → 형상(shapeMod, P4 ③) 순서. mods[i] = spec.mech3d.parts[i](xform·shapeMod 필드만 봄). 반환: 바뀌었는지
export function applyPartMods(mods) {
  if (!raw) return false;
  const xs = raw.parts.map((_, i) => {
    const x = isIdentityXform(mods?.[i]?.xform) ? null : mods[i].xform, s = mods?.[i]?.shapeMod ?? null;
    return x || s ? { x, s } : null;
  });
  const key = JSON.stringify(xs);
  if (key === xkey) return false;
  xkey = key;
  if (xs.every((x) => !x)) { scene = raw; return true; }
  const parts = raw.parts.map((p, i) => {
    if (!xs[i]) return p;
    const k = JSON.stringify(xs[i]), c = pmemo[i];
    if (c && c.raw === p && c.key === k) return c.mesh;
    let m = p;
    if (xs[i].x) { const b = bounds(p.positions); m = scaleMoveMesh(p, xs[i].x, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]); }
    const s = xs[i].s;
    if (s) {
      const H = heightsFor(m, s.frame, s.cell ?? 0.5);
      if (H.non25 > 0.02) console.warn(`부품 ${i}: 관측 방향 비 2.5D ${(H.non25 * 100).toFixed(1)}% — 형상 변경(shapeMod) 건너뜀`);
      else m = deformPart(refinedFor(m, s.frame, s.centers, s.R, Math.max(0.1, s.R / 8)), s.frame, H, s);
    }
    if (!m.bvh) m = { ...m, bvh: buildBvh(m.positions, m.triangles) };
    pmemo[i] = { raw: p, key: k, mesh: m };
    return m;
  });
  scene = buildSceneMesh(raw.name, parts); scene.raw = raw;
  return true;
}
// 구 호출(크기·위치만) — xforms[i] → { xform }
export const applyPartXforms = (xforms) => applyPartMods((xforms ?? []).map((x) => ({ xform: x })));
// 현재 장면으로 접촉면을 다시 찾는다 — 같은 면 쌍은 사용자가 고른 모드(접촉/공기층)를 유지
export function redetectContacts(old = []) {
  const mode = new Map(old.map((c) => [`${c.a}|${c.faceA}|${c.b}|${c.faceB}`, c.mode]));
  return findContacts(scene.parts).map((c) => ({ ...c, mode: mode.get(`${c.a}|${c.faceA}|${c.b}|${c.faceB}`) ?? 'contact' }));
}

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
  if (typeof indexedDB === 'undefined' || !raw) return;
  const d = await idb();
  const parts = raw.parts.map(({ positions, triangles, faceIds, faceCount, volume }) => ({ positions, triangles, faceIds, faceCount, volume }));
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name: raw.name, parts }, KEY);
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
