// 불러온 몸체(STEP) 런타임 — 형상 몸체 spec 2026-10-10 §3.1, §6.
// spec 에는 출처·방향만 저장(spec.body.shape = { source:'plate'|'step', name, flipZ, rot }) 하고, 메시는
// 브라우저 IndexedDB 에 보관해 새로고침 후에도 다시 쓴다(JSON 내보내기에는 형상이 들어가지 않음 — 안내).
import { meshToHeightfield, sampleHeightfield } from './heightfield.js';

let body = null;   // { name, mesh, orient, hf }

export function setBodyMesh(name, mesh, orient = { flipZ: false, rot: 0 }) {
  body = { name, mesh, orient: { ...orient }, hf: meshToHeightfield(mesh, { cell: 0.2, ...orient }) };
  return body;
}
export function reorientBody(orient) { if (body) setBodyMesh(body.name, body.mesh, orient); return body; }
export function getBody() { return body; }
export function clearBody() { body = null; }

// spec 상 불러온 몸체가 실제로 쓰이는가(L3 켜짐 + 출처 step + 메시 존재)
export function importedBodyActive(spec, active) {
  return !!(body && spec.body?.shape?.source === 'step' && (active ? new Set(active).has(3) : spec.levels?.[3]?.on));
}

// 툴 좌표 배치: 몸체 외곽 중심 = 타겟 중심, 윗면 최고점 = 깊이(LED→상면). 밖이면 null.
export function bodyHeightsAt(spec, depth, x, y) {
  if (!body) return null;
  const s = sampleHeightfield(body.hf, x - spec.target.xLen / 2, y - spec.target.yLen / 2);
  return s ? { top: depth + s.zt, bot: depth + s.zb } : null;
}

// 형상 정보·경고(기구설계자용)
export function bodyInfo(spec) {
  if (!body) return null;
  const { hf } = body, w = [];
  if (hf.size.x < spec.target.xLen - 0.01 || hf.size.y < spec.target.yLen - 0.01)
    w.push(`몸체 외곽(${hf.size.x.toFixed(1)}×${hf.size.y.toFixed(1)}mm)이 타겟(${spec.target.xLen}×${spec.target.yLen}mm)보다 작음 — 타겟 일부가 몸체 밖`);
  if (hf.stats.non25DFrac > 0) w.push(`2.5D 가 아닌 부분 ${(hf.stats.non25DFrac * 100).toFixed(1)}% (언더컷·리브·훅 등) — 최외곽 윗면·바닥으로 근사`);
  if (hf.stats.oddFrac > 0.01) w.push(`홀수 교차 ${(hf.stats.oddFrac * 100).toFixed(1)}% — 열린 면(솔리드가 아닌 부분) 의심, STEP 확인 필요`);
  // 살두께: 생성 평판과 같은 하한(levels.thicknessBounds: 기준두께의 절반, 최소 1mm) 미만 영역
  const wallMin = Math.max(1, (spec.body?.baseThk ?? 3) * 0.5);
  let thin = 0, tot = 0;
  for (let k = 0; k < hf.mask.length; k++) if (hf.mask[k]) { tot++; if (hf.zt[k] - hf.zb[k] < wallMin) thin++; }
  if (thin) w.push(`살두께 ${wallMin}mm 미만 영역 ${(thin / tot * 100).toFixed(1)}% (최소 ${hf.stats.thkMin.toFixed(2)}mm) — 성형·강도 검토 필요`);
  if (hf.size.z > spec.space.depth) w.push(`몸체 높이 ${hf.size.z.toFixed(1)}mm 가 깊이 ${spec.space.depth}mm 보다 큼 — LED 와 간섭`);
  return { name: body.name, size: hf.size, thk: [hf.stats.thkMin, hf.stats.thkMax], area: hf.stats.area, non25D: hf.stats.non25DFrac, cell: hf.cell, warnings: w };
}

// ---- IndexedDB 보관(브라우저 전용) ----
const DB = 'uds-shape', STORE = 'body', KEY = 'current';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveBodyIDB() {
  if (typeof indexedDB === 'undefined' || !body) return;
  const d = await idb();
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name: body.name, positions: body.mesh.positions, triangles: body.mesh.triangles }, KEY);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function loadBodyIDB(orient) {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return v ? setBodyMesh(v.name, { positions: v.positions, triangles: v.triangles }, orient) : null;
  } catch { return null; }
}
