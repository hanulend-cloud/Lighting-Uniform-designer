// 자동설계 Worker io(가짜 포트): node test/m3-autodesign-run.mjs
import { createAdRunner } from '../src/ui/m3/autodesign-run.js';
import { ok, done } from './mech3d-util.mjs';

const nCell = 4;
const fakePorts = (log) => Array.from({ length: 3 }, (_, w) => ({ send: async (m) => {
  log.push(`${w}:${m.type}`);
  if (m.type === 'scene') return { sceneKey: m.sceneKey, ready: true };
  const acc = new Float64Array(nCell).fill(1), ledger = { emitted: m.N, escaped: m.N / 2, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const out = { sceneKey: m.sceneKey, acc, cnt: new Uint32Array(nCell), ledger, leak: {}, escObs: 0, ms: 1 };
  if (m.rw) out.rw = { acc: new Float64Array(m.rw.milkies.length * nCell).fill(1), sf: new Float64Array(m.rw.milkies.length).fill(m.N), sf2: new Float64Array(m.rw.milkies.length).fill(m.N), n: m.N, milkies: m.rw.milkies };
  return out;
} }));
{ const log = [], R = createAdRunner({ ports: fakePorts(log) });
  const job = { sceneKey: 'k1', scene: { G: { ns: 2, nw: 2 } } };
  const r = await R.trace(job, { N: 60000, chunkN: 10000, batches: 4, rw: { part: 0, milkies: [1, 2] } });
  ok(log.filter((x) => x.endsWith('scene')).length === 3 && log.filter((x) => x.endsWith('chunk')).length === 6, '장면 Worker 마다 1번, 청크 6개(60000/10000)');
  ok(r.batches.length === 4 && r.rwBatches.length === 4 && r.rwBatches[0].length === 2 * nCell && r.ledger.emitted === 60000 && Math.abs(r.ess[0] - 1) < 1e-12, '배치 4개로 나눠 합침 · 격자 지도 · ESS');
  const c = await R.traceEach(job, [[{ pos: [0, 0, 0] }], [{ pos: [1, 0, 0] }]], { N: 5000 });
  ok(c.maps.length === 2 && c.maps[0] instanceof Float32Array && c.emitted === 5000, 'traceEach: 후보마다 지도(Float32), 후보당 방출');
  R.cancel(); let thrown = ''; try { await R.trace(job, { N: 1000 }); } catch (e) { thrown = e.message; }
  ok(/중지/.test(thrown), 'cancel 뒤 호출 = 중지 오류'); }
done();
