// 3D 계산 Worker — 입력:
//   { type:'init', l2Base, db } → L2 표·소재 DB 로드
//   { type:'line', id, parts, faces, dir } → { id, lineData }  (전체 L.data — 래스터 포함. 메인이 tallyGeometry(G) 계산에 씀)
//   { type:'scene', id, sceneKey, mechParts, mspec, ledParts, lineData, G, obs, emitters } → { id, sceneKey, ready:true }
//   { type:'chunk', id, sceneKey, seed, N } → { id, sceneKey, acc, cnt, ledger, leak, escObs, ms } | { id, sceneKey, stale:true }
//     (spec 2026-10-15 m3-cad-ui §4 — 장면은 한 번 만들고 청크만 반복. chunk-host.js 계약)
//   오류: { id, error }
import { initL2, l2State, browserLoader, setMaterialDb } from '../l2/runtime.js';
import { createDb } from '../../model/materials-db.js';
import { recognizeLine } from './line.js';
import { makeChunkHost } from './chunk-host.js';

let ready = null, db = null;
const host = makeChunkHost({ getTable: () => l2State().table, getDb: () => db });
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      ready = initL2(browserLoader(m.l2Base));
      db = createDb(m.db?.base ?? [], m.db?.user ?? []);
      setMaterialDb(db);
      await ready;
      return;
    }
    if (m.type === 'line') {
      const L = recognizeLine(m.parts, m.faces, m.dir);
      self.postMessage({ id: m.id, lineData: L.data });
      return;
    }
    await ready;
    const out = host.handle(m);
    if (out) self.postMessage({ id: m.id, ...out.reply }, out.transfer);
  } catch (e) { self.postMessage({ id: m.id, error: String(e?.message ?? e) }); }
};
