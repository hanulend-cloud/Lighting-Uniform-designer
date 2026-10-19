// 자동설계 Worker io — spec P4 §2. 기존 scene/chunk 프로토콜(chunk-host.js)을 그대로 쓰고 rw·emitters 만 덧붙인다.
// trace(job, {N, chunkN, batches, rw}) → 배치별 합 + 격자 지도 + ESS. traceEach(job, emitterSets, {N}) → 후보마다 지도(②).
import { essRatio } from '../../engine/mech3d/reweight.js';

export function createAdRunner({ ports }) {
  let stopped = false, seed = 7001;
  const check = () => { if (stopped) throw new Error('자동설계 중지'); };
  async function prepare(job) {
    check();
    await Promise.all(ports.map((p) => p.send({ type: 'scene', sceneKey: job.sceneKey, ...job.scene })));
  }
  // 청크 목록을 Worker 들에 나눠 돌림(빈 Worker 가 다음 청크를 가져감)
  async function runAll(job, chunks, onReply) {
    let next = 0;
    await Promise.all(ports.map(async (p) => {
      while (next < chunks.length) {
        check();
        const k = next++, r = await p.send({ type: 'chunk', sceneKey: job.sceneKey, seed: seed++, ...chunks[k] });
        if (r.stale) throw new Error('장면이 바뀜 — 다시 실행하세요');
        onReply(k, r);
      }
    }));
  }
  // chunkN 기본 = Worker 마다 청크 2개쯤(후보당 광자가 적어도 모든 Worker 가 일하게)
  async function trace(job, { N, chunkN = Math.max(2000, Math.ceil(N / (2 * ports.length))), batches = 8, rw = null }) {
    await prepare(job);
    const nCell = job.scene.G.ns * job.scene.G.nw, nC = Math.max(1, Math.ceil(N / chunkN));
    const B = Array.from({ length: batches }, () => new Float64Array(nCell)), RB = rw ? Array.from({ length: batches }, () => new Float64Array(rw.milkies.length * nCell)) : null;
    const ledger = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 }, sf = rw ? new Float64Array(rw.milkies.length) : null, sf2 = rw ? new Float64Array(rw.milkies.length) : null;
    let n = 0;
    await runAll(job, Array.from({ length: nC }, () => ({ N: Math.ceil(N / nC), ...(rw ? { rw } : {}) })), (k, r) => {
      const b = k % batches;
      for (let i = 0; i < nCell; i++) B[b][i] += r.acc[i];
      for (const key in ledger) ledger[key] += r.ledger[key];
      if (rw) { for (let i = 0; i < RB[b].length; i++) RB[b][i] += r.rw.acc[i]; for (let j = 0; j < sf.length; j++) { sf[j] += r.rw.sf[j]; sf2[j] += r.rw.sf2[j]; } n += r.rw.n; }
    });
    return { batches: B, rwBatches: RB, ledger, ess: rw ? essRatio(sf, sf2, n) : null };
  }
  // 후보마다 발광점 묶음 하나 → 지도(Float32, 격자면 격자 수 × 셀). emitted = 후보당 방출(모든 후보 같은 N)
  async function traceEach(job, emitterSets, { N = 20000, rw = null } = {}) {
    await prepare(job);
    const maps = new Array(emitterSets.length);
    let emitted = 0;
    await runAll(job, emitterSets.map((em) => ({ N, emitters: em, ...(rw ? { rw } : {}) })), (k, r) => {
      maps[k] = Float32Array.from(rw ? r.rw.acc : r.acc);
      emitted = r.ledger.emitted;
    });
    return { maps, emitted };
  }
  return { trace, traceEach, cancel() { stopped = true; }, get stopped() { return stopped; } };
}
