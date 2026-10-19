// 3D 계산 Worker — 입력:
//   { type:'init', l2Base, l2?, db } → L2 표·소재 DB 로드 (l2 = 메인이 읽은 원자료 { meta, data, refAD } — 있으면 fetch 안 함)
//   { type:'db', db } → 소재 DB 교체(풀은 3D 모드를 나가도 유지되므로 다시 들어올 때 최신 DB 로)
//   { type:'line', id, parts, faces, dir } → { id, lineData }  (전체 L.data — 래스터 포함. 메인이 tallyGeometry(G) 계산에 씀)
//   { type:'scene', id, sceneKey, mechParts, mspec, ledParts, lineData, G, obs, emitters } → { id, sceneKey, ready:true }
//   { type:'chunk', id, sceneKey, seed, N, rw?:{part, milkies}, emitters? } → { id, sceneKey, acc, cnt, ledger, leak, escObs, ms, rw?:{acc, sf, sf2, n, milkies} } | { id, sceneKey, stale:true }
//     (spec 2026-10-15 m3-cad-ui §4 — 장면은 한 번 만들고 청크만 반복. chunk-host.js 계약)
//   오류: { id, error }
import { initL2, l2State, browserLoader, bufferLoader, setMaterialDb } from '../l2/runtime.js';
import { createDb } from '../../model/materials-db.js';
import { recognizeLine } from './line.js';
import { makeChunkHost } from './chunk-host.js';

let ready = null, db = null;
const host = makeChunkHost({ getTable: () => l2State().table, getDb: () => db });
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      ready = initL2(m.l2 ? bufferLoader(m.l2) : browserLoader(m.l2Base));
      db = createDb(m.db?.base ?? [], m.db?.user ?? []);
      setMaterialDb(db);
      await ready;
      return;
    }
    if (m.type === 'db') { db = createDb(m.db?.base ?? [], m.db?.user ?? []); setMaterialDb(db); return; }
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
