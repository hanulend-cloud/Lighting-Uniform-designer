// 기구 장면 준비(순수) — 부품별 BVH · 합친 메쉬 + BVH · (선택) 접촉면. 큰 기구(수십만~수백만 삼각형)에서 수 초가 걸리므로
// 불러오기·복원 Worker(mech3d-worker)에서 돌리고 결과를 넘겨받는다(화면 멈춤 방지). transfer = 넘길 ArrayBuffer 목록(중복 없음)
import { buildBvh } from './bvh.js';
import { combineParts } from './mesh.js';
import { findContacts } from './contacts.js';

export function prepScene(rawParts, { contacts = false } = {}) {
  const parts = rawParts.map((p) => (p.bvh ? p : { ...p, bvh: buildBvh(p.positions, p.triangles) }));
  const combined = combineParts(parts), bvh = buildBvh(combined.positions, combined.triangles);
  return { parts, combined, bvh, contacts: contacts ? findContacts(parts) : null };
}
export function prepTransfer(r) {
  const set = new Set();
  const add = (a) => { if (a?.buffer) set.add(a.buffer); };
  for (const p of r.parts) { add(p.positions); add(p.triangles); add(p.faceIds); add(p.bvh.box); add(p.bvh.meta); add(p.bvh.order); }
  for (const a of [r.combined.positions, r.combined.triangles, r.combined.partOf, r.combined.faceOf, r.bvh.box, r.bvh.meta, r.bvh.order]) add(a);
  return [...set];
}
