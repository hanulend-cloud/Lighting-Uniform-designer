// 3D 계산 Worker 풀 — main.js(P3) 에서 옮김. 0번 Worker 는 라인 인식에도 쓴다. 필요한 만큼 늘리고 유지(L2 표 재적재 방지).
// ports() = 점진 계산 제어기용 포트 [{ send(msg) → Promise<reply> }] (K = 논리 코어 수 − 1, 1~15 — 측정: 16스레드에서 8→15개면 ±5% 12초→9초)
// 풀은 app.js 가 한 번 만들어 3D↔평판 전환·다시 마운트에도 유지한다(Worker·L2 표 재적재 = 수 초 방지). warm() = K 개 미리 띄우기.
// l2Raw(): 메인이 이미 읽은 L2 원자료 { meta, data, refAD } — init 에 복사해 넘겨 Worker 마다 fetch·gzip 풀기를 건너뜀(없으면 Worker 가 받음)
// GPU: 마지막 Worker 가 GPU 를 찾아(WebGPU) 있으면 GPU 로 추적, 없으면 그 Worker 도 CPU 로 계산 — 포트 수는 같다. gpu() = { ok, name, error } | null(확인 중)
const TIMEOUT = 10 * 60 * 1000;
// localStorage uds.gpu = '0' 이면 GPU 를 쓰지 않음(비교·문제 해결용)
const gpuAllowed = () => { try { return !!globalThis.navigator?.gpu && localStorage.getItem('uds.gpu') !== '0'; } catch { return !!globalThis.navigator?.gpu; } };

export function createPool({ dbLists, l2Raw = () => null, onStatus = () => {}, onGpu = () => {} }) {
  const pending = new Map(), pool = [];
  let gpu = null;
  let reqId = 0, loadFails = 0;   // 모듈 로드 실패로 다시 띄운 횟수(무한 반복 방지)
  const lastScene = [];   // 포트별 마지막 장면 메시지 — 새로 띄운 Worker 에 다시 보냄
  function onMessage(e) {
    const d = e.data;
    if (d.id == null) { if (d.gpu) { gpu = d.gpu; onGpu(gpu); } else if (d.error) onStatus(`계산 Worker 초기화 실패: ${d.error}`); return; }
    const p = pending.get(d.id);
    if (p) { pending.delete(d.id); clearTimeout(p.timer); d.error ? p.rej(new Error(d.error)) : p.res(d); }
  }
  // Worker 를 풀에서 빼고 종료, 그 Worker 에 걸린 호출은 모두 실패 처리(다음 호출 때 새로 만든다)
  function drop(w, msg) {
    w.terminate();
    const k = pool.indexOf(w); if (k >= 0) pool.splice(k, 1);
    for (const [id, p] of pending) if (p.w === w) { pending.delete(id); clearTimeout(p.timer); p.rej(new Error(msg)); }
  }
  function killAll(msg) { for (const w of pool.slice()) drop(w, msg); }
  function spawn(k) {
    const w = new Worker(new URL('../../engine/mech3d/mc3d-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = onMessage;
    // 오류: 메시지 없는 Event = 모듈 파일을 못 받음(서버 혼잡 등) → 같은 자리에 새 Worker(걸린 호출은 '다시 시도 가능'으로 실패 → ports.send 가 장면부터 다시 보냄). 그 밖·반복 실패 = 알리고 뺌
    w.onerror = (e) => {
      const k2 = pool.indexOf(w);
      if (!e.message && k2 >= 0 && ++loadFails <= 6) {
        w.terminate(); pool[k2] = spawn(k2);
        for (const [id, p] of pending) if (p.w === w) { pending.delete(id); clearTimeout(p.timer); p.rej(Object.assign(new Error('계산 Worker 다시 띄움(파일 받기 실패)'), { retry: true })); }
        return;
      }
      const msg = `계산 Worker 오류: ${e.message || '모듈을 불러오지 못함 — 새로고침(Ctrl+F5)'}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`; onStatus(msg); drop(w, msg);
    };
    w.postMessage({ type: 'init', l2Base: new URL('../../engine/l2/data/', import.meta.url).href, l2: l2Raw() ?? undefined, db: dbLists(), gpu: k === size() - 1 && gpuAllowed() });
    return w;
  }
  const worker = (k = 0) => { while (pool.length <= k) pool.push(spawn(pool.length)); return pool[k]; };
  const call = (w, msg) => new Promise((res, rej) => {
    const id = ++reqId;
    const timer = setTimeout(() => { if (pending.has(id)) drop(w, '계산 시간 초과(10분) — 다시 시도하세요'); }, TIMEOUT);
    pending.set(id, { res, rej, w, timer });
    w.postMessage({ ...msg, id });
  });
  const size = () => Math.max(1, Math.min(15, (navigator.hardwareConcurrency ?? 4) - 1));   // 메인 스레드(화면) 몫으로 코어 1개 남김 — 12개로 줄이면 ±5% 가 10초 목표를 넘음(실측 14.8초)
  // GPU 를 쓰면 CPU Worker 는 (논리 코어/2 − 2)개만 — 실측(16스레드·Intel Gen-9): CPU 14개 7.6만/s, GPU+CPU 6개 14만/s, GPU+CPU 14개 8.2만/s
  // (CPU 가 많으면 GPU 를 먹이는 Worker·전력 몫이 모자람). off() = 이 포트는 쉼(계산 루프가 다음 청크를 보내지 않음)
  const cpuWithGpu = () => Math.max(1, Math.floor((navigator.hardwareConcurrency ?? 4) / 2) - 2);
  // 포트 보내기 — Worker 를 다시 띄웠으면(retry) 잠깐 쉬고 장면부터 다시 보낸 뒤 같은 요청(최대 3번)
  const sendK = async (k, msg) => {
    if (msg.type === 'scene') lastScene[k] = msg;
    for (let n = 0; ; n++) {
      try { return await call(worker(k), msg); } catch (e) {
        if (!e.retry || n >= 3) throw e;
        await new Promise((r) => setTimeout(r, 300 * (n + 1)));
        if (msg.type !== 'scene' && lastScene[k]) await call(worker(k), lastScene[k]);
      }
    }
  };
  const ports = () => Array.from({ length: size() }, (_, k) => ({ send: (msg) => sendK(k, msg), gpu: k === size() - 1, off: () => !!gpu?.ok && k < size() - 1 && k >= cpuWithGpu() }));
  const warm = () => { for (let k = 0; k < size(); k++) worker(k); };
  const setDb = (db) => { for (const w of pool) w.postMessage({ type: 'db', db }); };   // 이미 뜬 Worker 의 소재 DB 갱신(새 Worker 는 init 에서)
  return { worker, call, killAll, ports, warm, setDb, gpu: () => (gpuAllowed() ? gpu : { ok: false, name: null, error: globalThis.navigator?.gpu ? '설정에서 끔' : null }), cpuWorkers: () => (gpu?.ok ? cpuWithGpu() : size()) };
}
