// 자동설계 Worker io(가짜 포트): node test/m3-autodesign-run.mjs
import { createAdRunner } from '../src/ui/m3/autodesign-run.js';
import { ok, done } from './mech3d-util.mjs';

const nCell = 4;
const fakePorts = (log, delay = 0) => Array.from({ length: 3 }, (_, w) => ({ send: async (m) => {
  log.push(`${w}:${m.type}`);
  if (delay && m.type === 'chunk') await new Promise((res) => setTimeout(res, delay));
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
  ok(r.photons === 60000, '시간 제한 없음 = N 전부');
  R.cancel(); let thrown = ''; try { await R.trace(job, { N: 1000 }); } catch (e) { thrown = e.message; }
  ok(/중지/.test(thrown), 'cancel 뒤 호출 = 중지 오류'); }
{ // 시간 제한: 청크 5ms · 40ms 제한 → N 전에 멈추되 minN 이상, 실제 광자 수 보고
  const R = createAdRunner({ ports: fakePorts([], 5) }), job = { sceneKey: 'k2', scene: { G: { ns: 2, nw: 2 } } };
  const r = await R.trace(job, { N: 1e7, maxMs: 40, minN: 20000, chunkN: 2000, batches: 4 });
  ok(r.photons >= 20000 && r.photons < 1e6 && r.ledger.emitted === r.photons && r.batches.length === 4, `maxMs 40 → ${r.photons} 광자(≥ minN 20000)에서 멈춤`);
  const w = r.batches.map((b) => b[0]), tot = w.reduce((a, b) => a + b, 0), chunks = r.photons / 2000;
  ok(Math.abs(tot - chunks) < 1e-9 && w.every((v) => Math.abs(v - chunks / 4) < 1e-9), '배치 무게 정규화(합은 그대로)');
  const r2 = await R.trace(job, { N: 1e7, maxMs: 1, minN: 60000, chunkN: 2000, batches: 4 });
  ok(r2.photons >= 60000 && r2.photons < 70000, `minN 이 시간보다 우선: ${r2.photons}`); }
done();
