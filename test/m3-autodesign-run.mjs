// 기구 최적화 Worker io(가짜 포트): node test/m3-autodesign-run.mjs
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
  ok(c.maps.length === 2 && c.maps[0] instanceof Float32Array && c.emitted === 1 && Math.abs(c.maps[0][0] - 1 / 5000) < 1e-9, 'traceEach: 후보마다 지도(Float32) · 방출 1 기준 정규화(emitted = 1)');
  ok(r.photons === 60000, '시간 제한 없음 = N 전부');
  R.cancel(); let thrown = ''; try { await R.trace(job, { N: 1000 }); } catch (e) { thrown = e.message; }
  ok(/중지/.test(thrown), 'cancel 뒤 호출 = 중지 오류'); }
{ // traceEach 시간 예산(spec §2.2c): 가짜 시계 1 광자/ms · 포트 1개 — 후보마다 광자 = min(N, 남은 예산/남은 후보, ≥ minN), 지도는 후보 자신의 방출로 정규화
  let t = 0; const Ns = [], prog = [];
  const port = { send: async (m) => { if (m.type === 'scene') return { sceneKey: m.sceneKey, ready: true };
    Ns.push(m.N); t += m.N;   // 같은 응답 모양(광자 수에 비례) — 정규화하면 같아야 함
    return { sceneKey: m.sceneKey, acc: Float64Array.from({ length: nCell }, (_, i) => 0.5 * m.N * (i + 1)), cnt: new Uint32Array(nCell), ledger: { emitted: m.N, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 }, ms: m.N }; } };
  const R = createAdRunner({ ports: [port], now: () => t }), job = { sceneKey: 'kb', scene: { G: { ns: 2, nw: 2 } } }, sets = [0, 1, 2, 3].map((x) => [{ pos: [x, 0, 0] }]);
  const c = await R.traceEach(job, sets, { N: 12000, maxMs: 30000, minN: 3000, onProgress: (i, n) => prog.push(`${i}/${n}`) });
  ok(Ns.join() === '12000,6000,6000,6000' && c.emitted === 1, `예산 30 s: 후보 광자 ${Ns.join(' · ')}`);
  ok(c.maps.every((m) => [...m].every((v, i) => Math.abs(v - 0.5 * (i + 1)) < 1e-6)), '광자 수가 달라도 정규화 지도는 같음');
  ok(prog.join() === '1/4,2/4,3/4,4/4', `후보별 진행 ${prog.join(' ')}`);
  Ns.length = 0; t = 0;
  await R.traceEach(job, sets, { N: 12000, maxMs: 15000, minN: 3000 });
  ok(Ns.join() === '12000,3000,3000,3000', `예산 부족 → 하한 3000: ${Ns.join(' · ')}`); }
{ // 시간 제한: 청크 5ms · 40ms 제한 → N 전에 멈추되 minN 이상, 실제 광자 수 보고
  const R = createAdRunner({ ports: fakePorts([], 5) }), job = { sceneKey: 'k2', scene: { G: { ns: 2, nw: 2 } } };
  const r = await R.trace(job, { N: 1e7, maxMs: 40, minN: 20000, chunkN: 2000, batches: 4 });
  ok(r.photons >= 20000 && r.photons < 1e6 && r.ledger.emitted === r.photons && r.batches.length === 4, `maxMs 40 → ${r.photons} 광자(≥ minN 20000)에서 멈춤`);
  const w = r.batches.map((b) => b[0]), tot = w.reduce((a, b) => a + b, 0), chunks = r.photons / 2000;
  ok(Math.abs(tot - chunks) < 1e-9 && w.every((v) => Math.abs(v - chunks / 4) < 1e-9), '배치 무게 정규화(합은 그대로)');
  const r2 = await R.trace(job, { N: 1e7, maxMs: 1, minN: 60000, chunkN: 2000, batches: 4 });
  ok(r2.photons >= 60000 && r2.photons < 70000, `minN 이 시간보다 우선: ${r2.photons}`); }
{ // 응답 없는 Worker → 시간 제한 오류(작게 주입)
  const hang = [{ send: async (m) => (m.type === 'scene' ? { ready: true } : new Promise(() => {})) }];
  const R = createAdRunner({ ports: hang, chunkTimeoutMs: 30, sceneTimeoutMs: 30 }), t = Date.now();
  let msg = ''; try { await R.trace({ sceneKey: 'h', scene: { G: { ns: 2, nw: 2 } } }, { N: 5000 }); } catch (e) { msg = e.message; }
  ok(/응답 없음 \(chunk/.test(msg) && Date.now() - t < 1000, `멈춘 Worker → 시간 제한 오류: ${msg}`);
  const R2 = createAdRunner({ ports: [{ send: () => new Promise(() => {}) }], sceneTimeoutMs: 20 });
  msg = ''; try { await R2.trace({ sceneKey: 'h2', scene: { G: { ns: 2, nw: 2 } } }, { N: 5000 }); } catch (e) { msg = e.message; }
  ok(/응답 없음 \(scene/.test(msg), `장면 응답 없음 → 오류: ${msg}`); }
{ // 한 Worker 실패 → 다른 Worker 도 새 청크를 보내지 않음, 첫 오류를 던짐
  const log = [], good = fakePorts(log, 5).slice(0, 2);
  const bad = { send: async (m) => { if (m.type === 'scene') return { ready: true }; log.push('bad:chunk'); throw new Error('Worker 고장'); } };
  const R = createAdRunner({ ports: [...good, bad] });
  let msg = ''; try { await R.trace({ sceneKey: 'f', scene: { G: { ns: 2, nw: 2 } } }, { N: 1e6, chunkN: 1000, batches: 4 }); } catch (e) { msg = e.message; }
  await new Promise((res) => setTimeout(res, 30));
  const n = log.filter((x) => x.endsWith('chunk')).length;
  ok(msg === 'Worker 고장' && n <= 3, `실패 Worker → 첫 오류 · 나머지 중단(청크 ${n}개만 보냄)`); }
{ // 기다리는 중 cancel → 바로 '중지'
  const R = createAdRunner({ ports: [{ send: async (m) => (m.type === 'scene' ? { ready: true } : new Promise(() => {})) }] });
  const p = R.trace({ sceneKey: 'c', scene: { G: { ns: 2, nw: 2 } } }, { N: 5000 }).catch((e) => e.message);
  await new Promise((res) => setTimeout(res, 10)); const t = Date.now(); R.cancel();
  const msg = await p;
  ok(/중지/.test(msg) && Date.now() - t < 200, `대기 중 cancel → 즉시 중지: ${msg}`); }
done();
