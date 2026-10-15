// 청크 실행·새는 빛·Worker 장면 캐시(Node 모의): node test/mech3d-chunk.mjs
import { runJob, runChunk } from '../src/engine/mech3d/job.js';
import { makeChunkHost } from '../src/engine/mech3d/chunk-host.js';
import { lightData } from '../src/engine/mech3d/line.js';
import { loadTable } from './l2-util.mjs';
import { plateFixture } from './m3-fixture.mjs';
import { ok, done } from './mech3d-util.mjs';

const table = loadTable(), fx = plateFixture(table);
const base = { S: fx.S, line: fx.line, obs: fx.obs, G: fx.G, emitters: fx.emitters, ledSpec: fx.ledSpec };
const J = runJob({ ...base, N: 20000, seed: 3, batches: 10 });
const same = (a, b) => a.length === b.length && a.every((v, k) => v === b[k]);
{   // 누적 동등성: 청크 c(시드 3·7919+c, 2000개) = runJob 배치 c — 비트 일치
  const ch = Array.from({ length: 10 }, (_, c) => runChunk({ ...base, N: 2000, seed: 3 * 7919 + c }));
  ok(ch.every((r, c) => same(r.acc, J.accs[c]) && same(r.cnt, J.cnts[c])), '청크 10개 acc·cnt = runJob 배치 10개(비트 일치)');
  const led = ch.reduce((a, r) => { for (const k in r.ledger) a[k] = (a[k] ?? 0) + r.ledger[k]; return a; }, {});
  ok(Object.keys(J.ledger).every((k) => led[k] === J.ledger[k]), '원장 합 = runJob 원장(비트 일치)');
  // 새는 빛: 관측면(0|1) 은 없고, 판 아랫면(0|0)·틈으로 바로 나감(-1|-1) 은 있음. Σleak + escObs = escaped
  const r = ch[0], tot = Object.values(r.leak).reduce((a, b) => a + b, 0);
  ok(!('0|1' in r.leak) && r.leak['0|0'] > 0 && r.leak['-1|-1'] > 0, `새는 빛 면: ${Object.keys(r.leak).join(', ')}`);
  ok(Math.abs(tot + r.escObs - r.ledger.escaped) <= 1e-9 * r.ledger.escaped, `Σleak ${tot.toFixed(4)} + 관측면 ${r.escObs.toFixed(4)} = 탈출 ${r.ledger.escaped.toFixed(4)}`);
}
{   // Worker 장면 캐시(chunk-host): 장면 전 청크 = stale, 장면 후 청크 = runJob 배치 0, 다른 sceneKey = stale
  const host = makeChunkHost({ getTable: () => table, getDb: () => null });
  const scene = { type: 'scene', sceneKey: 'k1', mechParts: [fx.plate], mspec: fx.mspec, ledParts: null, lineData: lightData(fx.line), G: fx.G, obs: fx.obs, emitters: fx.emitters };
  ok(host.handle({ type: 'chunk', sceneKey: 'k1', seed: 1, N: 10 }).reply.stale === true, '장면 전 청크 → stale');
  const s = host.handle(scene);
  ok(s.reply.ready === true && s.reply.sceneKey === 'k1' && host.sceneKey === 'k1', '장면 메시지 → ready, sceneKey 기억');
  const c = host.handle({ type: 'chunk', sceneKey: 'k1', seed: 3 * 7919, N: 2000 });
  ok(same(c.reply.acc, J.accs[0]) && c.transfer.length === 2 && c.reply.leak && Number.isFinite(c.reply.escObs), 'host 청크 = runJob 배치 0, 전송 버퍼 2개');
  ok(host.handle({ type: 'chunk', sceneKey: 'k0', seed: 1, N: 10 }).reply.stale === true, '다른 sceneKey 청크 → stale');
  ok(host.handle({ type: 'line' }) === null, '모르는 메시지 → null(Worker 가 다른 처리기로)');
}
done();
