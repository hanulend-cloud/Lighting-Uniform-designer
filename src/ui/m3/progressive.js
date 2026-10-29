// 점진 계산 제어기 — spec 2026-10-15 m3-cad-ui §4. 순수 로직: Worker 포트·타이머를 주입받아 Node 에서 시험한다.
// 포트 = { send(msg) → Promise<reply> } — 메시지는 mc3d-worker 의 'scene'·'chunk'(chunk-host.js 계약).
// 청크 c 의 시드 = seedBase·7919 + c (runJob 배치 시드 규약) → 배치 c % bins 에 모은다. 판정 통계는 배치별 (누적 × 기준 광자 수 ÷ 배치 광자 수).
// 적응형에서는 청크 c ≥ bins 를 보낸 광자가 가장 적은 배치에 넣는다(크기가 제각각이어도 배치 무게가 고르게).
// 청크 크기: 기본은 적응형 — 포트마다 minChunk 로 시작해 잰 속도로 다음 청크를 ≈chunkMs 분량으로(minChunk~maxChunk).
//   fixedChunk: true 면 chunkN 고정(runJob 과 비트 일치 시험용).
import { tallyStats } from '../../engine/mech3d/tally.js';

export const PROG_DEFAULTS = { chunkN: 25000, fixedChunk: false, minChunk: 1000, maxChunk: 50000, chunkMs: 500, bins: 10, targetNoise: 0.02, maxPhotons: 1e8, debounceMs: 500, tickMs: 1000, seedBase: 1, maxIgnored: 16, sceneTimeoutMs: 60000, chunkTimeoutMs: 30000 };
export const chunkSeed = (seedBase, c) => seedBase * 7919 + c;
const ledger0 = () => ({ emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 });

// 광 효율·휘도 — eff = Σ관측면 원뿔 안 출사 / 방출, 휘도 = fluxLm·nLeds·eff / (A[m²]·π·sin²cone) (Lambert 가정, cone 90° = spec 식)
export function photometry(G, sum, ledger, { fluxLm = 0, nLeds = 0, cone = 90 } = {}) {
  let tot = 0, area = 0;
  for (let k = 0; k < sum.length; k++) { tot += sum[k]; area += G.area[k]; }
  const eff = ledger.emitted > 0 ? tot / ledger.emitted : NaN;
  const s2 = Math.sin((Math.min(90, cone) * Math.PI) / 180) ** 2;
  const lum = fluxLm > 0 && nLeds > 0 && area > 0 && Number.isFinite(eff) ? (fluxLm * nLeds * eff) / (area * 1e-6 * Math.PI * s2) : null;
  return { eff, lum, area };
}

// job = { sceneKey, scene:{ mechParts, mspec, ledParts, lineData, G, obs, emitters }, G, obs, nLeds, fluxLm } 또는 그것을 돌려주는 함수(준비 안 됨 = null)
export function createProgressive({ ports, timers = globalThis, onUpdate = () => {}, opts = {} }) {
  const o = { ...PROG_DEFAULTS, ...opts };
  const cap = () => job?.maxPhotons ?? o.maxPhotons;   // 계산 한도 — 작업(화질)별, 없으면 기본
  let gen = 0, state = 'idle', reason = null, error = null, job = null, pendingJob = null, debounce = null, ticker = null;
  let paths = {}, bins, binIssued, ledger, leak, nextChunk, issued, retry, doneChunks, photons, ignored, snap, early, nMin, nMax;
  let wantPaused = false, disposed = false;   // wantPaused: 대기·시작 중 일시정지 요청 → 시작될 때 적용
  const busy = ports.map(() => 0);   // 포트별로 돌고 있는 펌프의 세대(0 = 쉼)
  const ready = ports.map(() => 0);  // 포트별로 장면이 준비된 세대 — 준비된 포트부터 바로 청크를 보낸다
  const size = ports.map(() => o.minChunk);   // 포트별 다음 청크 크기(적응형)
  const now = () => (typeof timers.now === 'function' ? timers.now() : globalThis.performance?.now?.() ?? Date.now());
  resetAcc();

  function resetAcc() { bins = Array.from({ length: o.bins }, () => null); binIssued = new Float64Array(o.bins); ledger = ledger0(); leak = {}; paths = {}; nextChunk = 0; issued = 0; retry = []; nMin = Infinity; nMax = 0; doneChunks = 0; photons = 0; ignored = 0; snap = null; early = false; }
  function stopTick() { if (ticker != null) { timers.clearInterval(ticker); ticker = null; } }
  function startTick() { stopTick(); ticker = timers.setInterval(onTick, o.tickMs); }
  const emit = () => { if (!disposed) onUpdate(snapshot()); };
  // 포트 응답에 제한 시간 — Worker 가 멈추면 'Worker 응답 없음' 으로 실패
  function send(port, msg, ms) {
    let id = null;
    const to = new Promise((_, rej) => { id = timers.setTimeout(() => rej(new Error(`Worker 응답 없음 (${msg.type} ${ms / 1000}초)`)), ms); });
    return Promise.race([port.send(msg), to]).finally(() => timers.clearTimeout(id));
  }

  // 물리 변경 — 진행 중 결과는 세대(gen)로 무효화하고 디바운스 뒤 새로 시작
  function restart(j) {
    if (disposed) return;
    gen++; stopTick();
    if (debounce != null) timers.clearTimeout(debounce);
    if (state === 'paused') wantPaused = true;   // 사용자 일시정지는 다시 시작 뒤에도 유지(여러 값을 고치는 동안)
    resetAcc(); job = null; pendingJob = j; state = 'pending'; reason = null; error = null;
    const g = gen;
    debounce = timers.setTimeout(() => { debounce = null; begin(g); }, o.debounceMs);
    emit();
  }
  async function begin(g) {
    let j;
    try { j = typeof pendingJob === 'function' ? pendingJob() : pendingJob; } catch (e) { fail(g, e); return; }
    pendingJob = null;
    if (!j) { state = 'idle'; reason = 'notReady'; emit(); return; }
    job = j; state = 'starting'; emit();
    size.fill(o.minChunk);
    // 포트마다 따로: 장면이 준비되는 대로 그 포트의 청크를 시작(느린 Worker 가 다른 Worker 를 붙잡지 않음)
    await Promise.all(ports.map(async (p, k) => {
      try { await send(p, { type: 'scene', sceneKey: j.sceneKey, ...j.scene }, o.sceneTimeoutMs); } catch (e) { fail(g, e); return; }
      if (g !== gen || state === 'error') return;
      ready[k] = g;
      if (state === 'starting') {
        if (wantPaused) { wantPaused = false; state = 'paused'; emit(); return; }
        state = 'running'; startTick(); emit();
      }
      if (state === 'running' && busy[k] !== g) pump(k, g);
    }));
  }
  function fail(g, e) { if (g !== gen) return; stopTick(); state = 'error'; error = String(e?.message ?? e); emit(); }
  function pumpAll(g) { ports.forEach((_, k) => { if (ready[k] === g && busy[k] !== g) pump(k, g); }); }
  // 다음 청크 크기 — 잰 계산 시간(Worker 의 r.ms, 없으면 왕복 시간)으로 ≈chunkMs 분량
  // GPU 포트(응답 gpu:true)는 한 번에 많이 보낼수록 빠름(청크마다 광원 표본·되읽기 비용) — 목표 시간 ×3, 상한 ×20
  function adapt(k, N, ms, gpu = false) {
    if (o.fixedChunk || !(ms > 0)) return;
    size[k] = Math.max(o.minChunk, Math.min(o.maxChunk * (gpu ? 20 : 1), Math.round((N / ms) * o.chunkMs * (gpu ? 3 : 1))));
  }
  // 포트 하나에 청크를 하나씩 보낸다(응답이 오면 다음 — Worker 에 청크를 쌓지 않아 새 장면은 진행 중 청크 1개만 기다림)
  async function pump(k, g) {
    busy[k] = g;
    try {
      while (g === gen && state === 'running' && (retry.length > 0 || issued < cap()) && !ports[k].off?.()) {   // off: GPU 사용 중 쉬는 CPU 포트
        // 버려진(장면 불일치) 청크 번호를 먼저 다시 쓴다 — 시드가 빈틈없이 이어져야 runJob 과 같은 배치가 됨
        let c, N, b;
        if (retry.length > 0) ({ c, N, b } = retry.shift());
        else { c = nextChunk++; N = Math.min(o.fixedChunk ? o.chunkN : size[k], cap() - issued); issued += N; b = pickBin(c); binIssued[b] += N; }
        let r;
        const t0 = now();
        try { r = await send(ports[k], { type: 'chunk', sceneKey: job.sceneKey, seed: chunkSeed(o.seedBase, c), N }, o.chunkTimeoutMs); } catch (e) { fail(g, e); return; }
        if (g !== gen) return;   // 그사이 다시 시작·취소됨 — 버림
        if (r.stale || r.sceneKey !== job.sceneKey) {
          retry.push({ c, N, b });
          if (++ignored > o.maxIgnored) { fail(g, new Error('Worker 장면이 맞지 않음 — 다시 계산하세요')); return; }
          continue;
        }
        adapt(k, N, Number.isFinite(r.ms) && r.ms > 0 ? r.ms : now() - t0, !!r.gpu);
        accumulate(b, N, r);
        if (state !== 'running') { snap = compute(); emit(); }                              // 일시정지·완료 뒤 도착한 청크
        else if (photons >= cap()) finish('max');
        else if (!early && bins.filter(Boolean).length >= 2) { early = true; onTick(); }   // 첫 지표는 1초를 기다리지 않음
      }
    } finally { if (busy[k] === g) busy[k] = 0; }
  }
  // 배치 고르기 — 고정 크기: c % bins(runJob 규약). 적응형: 보낸 광자가 가장 적은 배치(배치 무게를 고르게 → 잡음 추정이 덜 부풀음)
  function pickBin(c) {
    if (o.fixedChunk || c < o.bins) return c % o.bins;
    let b = 0; for (let i = 1; i < o.bins; i++) if (binIssued[i] < binIssued[b]) b = i;
    return b;
  }
  // 청크 결과는 광자 수와 무관하게 '광원 광속 1회분'(가중치 w0 = flux/N) — 광자 수 가중(f = N/chunkN)으로 더해야 크기가 다른 청크(적응형·GPU)가 섞여도
  // 배치 평균이 바르다(예전엔 청크 개수 가중 → GPU 큰 청크가 섞이면 배치 간 차가 커져 잡음이 수렴하지 않음, 2026-10-27). 고정 크기면 f = 1(runJob 과 비트 일치)
  function accumulate(b, N, r) {
    const n = r.acc.length, f = N / o.chunkN;
    const B = bins[b] ?? (bins[b] = { acc: new Float64Array(n), cnt: new Float64Array(n), n: 0, photons: 0 });
    for (let k = 0; k < n; k++) { B.acc[k] += r.acc[k] * f; B.cnt[k] += r.cnt[k]; }
    B.n++; B.photons += N; nMin = Math.min(nMin, N); nMax = Math.max(nMax, N);
    for (const key in ledger) ledger[key] += (r.ledger[key] ?? 0) * f;
    for (const key in r.leak ?? {}) leak[key] = (leak[key] ?? 0) + r.leak[key] * f;
    for (const key in r.paths ?? {}) paths[key] = (paths[key] ?? 0) + r.paths[key] * f;   // 광경로(관측면으로 나온 빛이 거친 부품 차례)
    photons += N; doneChunks++;
  }
  function compute() {
    const filled = bins.filter(Boolean);
    if (!job || filled.length < 2) return { stats: null, sum: null, photometry: null };
    // 배치를 광자 수로 정규화 — 기준 = 청크 평균 광자 수. 청크 크기가 모두 같으면 ÷ 청크 수(1개면 그대로 — runJob 과 비트 일치)
    // 배치 = chunkN 광자 1회분으로 정규화(acc 는 광자 수 가중으로 더했음). cnt 는 광자 수에 비례하므로 같은 비율. 고정 크기면 ÷ 청크 수
    const same = nMin === nMax && nMin === o.chunkN, ref = o.chunkN;
    const norm = (B, a) => (same ? (B.n === 1 ? a : a.map((v) => v / B.n)) : a.map((v) => v * (ref / B.photons)));
    const accs = filled.map((B) => norm(B, B.acc)), cnts = filled.map((B) => norm(B, B.cnt));
    const stats = tallyStats(job.G, accs, job.obs, cnts);
    const sum = new Float64Array(job.G.ns * job.G.nw);
    for (const B of filled) for (let k = 0; k < sum.length; k++) sum[k] += B.acc[k];
    return { stats, sum, photometry: photometry(job.G, sum, ledger, { fluxLm: job.fluxLm ?? 0, nLeds: job.nLeds ?? 0, cone: job.obs.cone ?? 90 }) };
  }
  function onTick() {
    if (!job) return;
    snap = compute();
    const rn = snap.stats?.relNoise;
    if (state === 'running' && doneChunks >= o.bins && rn != null && rn <= o.targetNoise) { finish('converged'); return; }
    emit();
  }
  function finish(r) { state = 'done'; reason = r; stopTick(); snap = compute(); emit(); }

  function pause() {
    if (state === 'pending' || state === 'starting') { wantPaused = true; return; }
    if (state !== 'running') return;
    state = 'paused'; stopTick(); emit();
  }
  function resume() {
    if (state === 'pending' || state === 'starting') { wantPaused = false; return; }
    if (state !== 'paused') return;
    state = 'running'; startTick(); emit(); pumpAll(gen);
  }
  // 목표만 바뀜 — 누적 데이터로 판정만 다시. 잡음 목표를 현재 잡음보다 낮추면(수렴 멈춤 상태) 계산 재개
  function setJudge({ obs = null, targetNoise = null, fluxLm = null } = {}) {
    if (targetNoise != null) o.targetNoise = targetNoise;
    if (job) {
      job = { ...job, obs: obs ? { ...job.obs, targetLen: obs.targetLen, targetWid: obs.targetWid } : job.obs, fluxLm: fluxLm ?? job.fluxLm };
      snap = compute();
      const rn = snap.stats?.relNoise;
      if (state === 'done' && reason === 'converged' && rn != null && rn > o.targetNoise && photons < cap()) {
        state = 'running'; reason = null; startTick(); emit(); pumpAll(gen); return;
      }
    }
    emit();
  }
  function cancel() {
    gen++; stopTick();
    if (debounce != null) { timers.clearTimeout(debounce); debounce = null; }
    job = null; pendingJob = null; wantPaused = false; resetAcc(); state = 'idle'; reason = null; error = null;
    emit();
  }
  // 화면 해제 — 알림 없이 취소하고, 이후 호출은 무시
  function dispose() { if (disposed) return; disposed = true; cancel(); }
  // 주의: bins[].acc 는 내부 누적 배열을 그대로 넘긴다(복사 비용 회피) — 소비자는 읽기만 하고 바꾸면 안 된다.
  function snapshot() {
    return {
      state, reason, error, photons, chunks: doneChunks, ignored, sceneKey: job?.sceneKey ?? null,
      stats: snap?.stats ?? null, sum: snap?.sum ?? null, photometry: snap?.photometry ?? null,
      ledger: { ...ledger }, leak: { ...leak }, paths: { ...paths }, bins: bins.map((b) => b && { acc: b.acc, n: b.n, photons: b.photons }),
      G: job?.G ?? null, obs: job?.obs ?? null, targetNoise: o.targetNoise,
    };
  }
  return { restart, pause, resume, cancel, dispose, setJudge, snapshot };
}
