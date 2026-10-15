// 점진 계산 Worker 의 장면 캐시·청크 처리 — spec 2026-10-15 m3-cad-ui §4. 순수(Worker 와 Node 시험이 같이 씀).
// 'scene': 장면·BVH·관측 라인을 한 번 만들어 sceneKey 로 기억. 'chunk': 기억한 장면과 sceneKey 가 같을 때만 runChunk.
import { buildSceneMesh } from './runtime.js';
import { lineFromData } from './line.js';
import { composeScene, runChunk } from './job.js';

// getTable(): L2 산란 응답표, getDb(): 실측소재 DB(없으면 null)
export function makeChunkHost({ getTable, getDb = () => null }) {
  let cache = null;
  return {
    get sceneKey() { return cache?.sceneKey ?? null; },
    // 반환 { reply, transfer } — 처리할 메시지가 아니면 null
    handle(m) {
      if (m.type === 'run') return { reply: { error: 'run 메시지는 제거됨 — 점진 계산을 사용하세요' }, transfer: [] };   // 구 호출(main.js, Task 10 전)이 멈추지 않게
      if (m.type === 'scene') {
        if (cache?.sceneKey === m.sceneKey) return { reply: { sceneKey: m.sceneKey, ready: true }, transfer: [] };   // 같은 장면 — 다시 만들지 않음
        try {
          const table = getTable();
          if (!table) throw new Error('L2 산란 응답표가 없음');
          cache = null;   // 실패하면 이전 장면도 쓰지 않음
          const rt = buildSceneMesh('mech', m.mechParts), line = lineFromData(m.lineData);
          const S = composeScene({ rt, mspec: m.mspec, ledParts: m.ledParts, table, db: getDb(), line });
          cache = { sceneKey: m.sceneKey, S, line, G: m.G, obs: m.obs, emitters: m.emitters, ledSpec: m.mspec.light.spec };
          return { reply: { sceneKey: m.sceneKey, ready: true }, transfer: [] };
        } catch (e) { cache = null; return { reply: { sceneKey: m.sceneKey, error: String(e?.message ?? e) }, transfer: [] }; }
      }
      if (m.type === 'chunk') {
        if (!cache || cache.sceneKey !== m.sceneKey) return { reply: { sceneKey: m.sceneKey, stale: true }, transfer: [] };
        const { S, line, obs, G, emitters, ledSpec } = cache;
        const r = runChunk({ S, line, obs, G, emitters, ledSpec, N: m.N, seed: m.seed });
        return { reply: { sceneKey: m.sceneKey, acc: r.acc, cnt: r.cnt, ledger: r.ledger, leak: r.leak, escObs: r.escObs, ms: r.ms }, transfer: [r.acc.buffer, r.cnt.buffer] };
      }
      return null;
    },
  };
}
