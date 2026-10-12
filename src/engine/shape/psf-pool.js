// 형상 PSF 병렬 추적 풀 — 형상 몸체 spec §4.2 S2 (속도). 탐색 코드는 동기식이므로, 호출 측(계산 Worker)이 PSF 작업 묶음을
// 보조 Worker 들에 나눠 주고 SharedArrayBuffer 로 결과를 받으며 Atomics.wait 로 기다린다(호출 측도 작업에 참여).
// 같은 입력 → 같은 결과(룰렛 난수는 PSF 위치 시드) — 순차/병렬 결과가 비트 단위로 같아야 한다(test/shape-pool.mjs).
// 브라우저에서는 교차 출처 격리(COOP/COEP, serve.py)일 때만 사용 — 아니면 fast-body 가 순차로 추적한다.
import { makeScene, _ledModel } from './mc-body.js';
import { tracePsfChunk, openScene } from './fast-body.js';

// 장면 기술자 → 장면(Worker 마다 캐시). desc: { key, kind:'open'|'real', hf, ox, oy, walls, imported, depth, n, mua, margin }
const scenes = new Map();
export function sceneFromDesc(d) {
  let S = scenes.get(d.key);
  if (S) return S;
  const geom = { hf: d.hf, ox: d.ox, oy: d.oy, walls: d.walls, imported: d.imported };
  S = d.kind === 'open'
    ? openScene(geom, d.depth, d.n, d.mua, d.margin)
    : makeScene({ hf: d.hf, ox: d.ox, oy: d.oy, depth: d.depth, n: d.n, medium: { mus: 0, g: 0, mua: d.mua }, rhoB: 0, walls: { ...d.walls, mode: 'fresnel', n: d.n } });
  if (scenes.size >= 4) scenes.delete(scenes.keys().next().value);
  scenes.set(d.key, S);
  return S;
}

const LED_KEYS = ['emitted', 'top', 'pcb', 'lost', 'abs', 'rest'];
// 작업 1개(PSF 1개의 고리 묶음 1개) 실행 → 공유 버퍼에 기록. task: { x, y, led:{model,beamX}, I0, opts, chunk }, out: { buf, led, kn }
export function runTask(desc, task, out) {
  const S = sceneFromDesc(desc), kk = out.kn * out.kn;
  const top = new Float32Array(out.buf, 0, kk), pcb = new Float32Array(out.buf, 4 * kk, kk);
  top.fill(0); pcb.fill(0);   // 버퍼는 묶음 간 재사용
  const r = tracePsfChunk(S, { x: task.x, y: task.y }, _ledModel(task.led), task.I0, { ...task.opts, out: { top, pcb } }, task.chunk ?? 0);
  const L = new Float64Array(out.led);
  LED_KEYS.forEach((k, i) => { L[i] = r.ledger[k] ?? 0; });
}

// 공유 높이맵(형상 키별 1회 복사)
const shared = new Map();
export function sharedHf(key, hf) {
  let h = shared.get(key);
  if (h) return h;
  const cp = (src, C) => { const a = new C(new SharedArrayBuffer(src.length * C.BYTES_PER_ELEMENT)); a.set(src); return a; };
  h = { nx: hf.nx, ny: hf.ny, cell: hf.cell, x0: hf.x0, y0: hf.y0, zt: cp(hf.zt, Float64Array), zb: cp(hf.zb, Float64Array), mask: cp(hf.mask, Uint8Array) };
  if (shared.size >= 6) shared.delete(shared.keys().next().value);
  shared.set(key, h);
  return h;
}

// workers: postMessage 가능한 보조 Worker 배열(브라우저 Worker / Node worker_threads)
export function createPsfPool(workers) {
  // 결과 버퍼 재사용(슬롯별 SharedArrayBuffer, 필요 시 키움) — 묶음마다 새로 할당하면 브라우저에서 할당·0채움 비용이 커진다.
  // 반환된 배열은 다음 traceBatch 호출 전까지만 유효(호출 측 fast-body 가 즉시 합산·복사).
  const slots = [];
  const slot = (i, bytes) => {
    let sl = slots[i];
    if (!sl || sl.buf.byteLength < bytes) { sl = slots[i] = { buf: new SharedArrayBuffer(bytes), led: new SharedArrayBuffer(8 * LED_KEYS.length) }; }
    return sl;
  };
  const stats = { caller: 0, total: 0 };
  return {
    size: workers.length + 1, stats,
    traceBatch(desc, tasks) {
      const n = tasks.length;
      const next = new Int32Array(new SharedArrayBuffer(4)), done = new Int32Array(new SharedArrayBuffer(4));
      const outs = tasks.map((t, i) => {
        const kc = Math.ceil(t.opts.half / t.opts.s), kn = 2 * kc + 1, sl = slot(i, 8 * kn * kn);
        return { kc, kn, s: t.opts.s, buf: sl.buf, led: sl.led };
      });
      const msg = { type: 'batch', desc, tasks, outs: outs.map((o) => ({ buf: o.buf, led: o.led, kn: o.kn })), next: next.buffer, done: done.buffer };
      if (n > 1) for (const w of workers) w.postMessage(msg);
      for (;;) {   // 호출 측도 참여
        const i = Atomics.add(next, 0, 1);
        if (i >= n) break;
        runTask(desc, tasks[i], msg.outs[i]);
        Atomics.add(done, 0, 1);
        stats.caller++;
      }
      stats.total += n;
      for (;;) {
        const d = Atomics.load(done, 0);
        if (d >= n) break;
        if (Atomics.wait(done, 0, d, 300000) === 'timed-out') throw new Error('PSF 풀 응답 없음(300s)');
      }
      return outs.map((o) => {
        const kk = o.kn * o.kn, L = new Float64Array(o.led), ledger = {};
        LED_KEYS.forEach((k, i) => { ledger[k] = L[i]; });
        return { G: { kc: o.kc, kn: o.kn, s: o.s, top: new Float32Array(o.buf, 0, kk), pcb: new Float32Array(o.buf, 4 * kk, kk) }, ledger };
      });
    },
  };
}

// 보조 Worker 쪽 처리기(psf-worker.js 가 사용)
export function handlePoolMessage(m) {
  if (m.type !== 'batch') return;
  const next = new Int32Array(m.next), done = new Int32Array(m.done), n = m.tasks.length;
  for (;;) {
    const i = Atomics.add(next, 0, 1);
    if (i >= n) break;
    runTask(m.desc, m.tasks[i], m.outs[i]);
    Atomics.add(done, 0, 1);
    Atomics.notify(done, 0);
  }
}
