// 3D 계산 Worker — 입력:
//   { type:'init', l2Base, db } → L2 표·소재 DB 로드
//   { type:'line', id, parts, faces, dir } → { id, lineData }  (전체 L.data — 래스터 포함. 메인이 tallyGeometry(G) 계산에 씀)
//   { type:'run', id, mechParts, mspec, ledParts, lineData, G, obs, emitters, N, seed, batches } → { id, accs, cnts, ledger, ms } | { id, error }
//     lineData = lightData(line)(래스터 mask/dt 제외), G = 메인이 계산한 tallyGeometry(line, obs)
import { initL2, l2State, browserLoader, setMaterialDb } from '../l2/runtime.js';
import { createDb } from '../../model/materials-db.js';
import { buildSceneMesh } from './runtime.js';
import { recognizeLine, lineFromData } from './line.js';
import { composeScene, runJob } from './job.js';

let ready = null, db = null;
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
    if (m.type === 'run') {
      await ready;
      const table = l2State().table;
      if (!table) throw new Error('L2 산란 응답표가 없음');
      const rt = buildSceneMesh('mech', m.mechParts), line = lineFromData(m.lineData);
      const S = composeScene({ rt, mspec: m.mspec, ledParts: m.ledParts, table, db, line });
      const r = runJob({ S, line, obs: m.obs, G: m.G, emitters: m.emitters, ledSpec: m.mspec.light.spec, N: m.N, seed: m.seed, batches: m.batches });
      self.postMessage({ id: m.id, accs: r.accs, cnts: r.cnts, ledger: r.ledger, ms: r.ms }, [...r.accs.map((a) => a.buffer), ...r.cnts.map((c) => c.buffer)]);
    }
  } catch (e) { self.postMessage({ id: m.id, error: String(e?.message ?? e) }); }
};
