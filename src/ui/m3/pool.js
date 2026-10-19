// 3D 계산 Worker 풀 — main.js(P3) 에서 옮김. 0번 Worker 는 라인 인식에도 쓴다. 필요한 만큼 늘리고 유지(L2 표 재적재 방지).
// ports() = 점진 계산 제어기용 포트 [{ send(msg) → Promise<reply> }] (K = 논리 코어 수 − 1, 1~15 — 측정: 16스레드에서 8→15개면 ±5% 12초→9초)
// 풀은 app.js 가 한 번 만들어 3D↔평판 전환·다시 마운트에도 유지한다(Worker·L2 표 재적재 = 수 초 방지). warm() = K 개 미리 띄우기.
// l2Raw(): 메인이 이미 읽은 L2 원자료 { meta, data, refAD } — init 에 복사해 넘겨 Worker 마다 fetch·gzip 풀기를 건너뜀(없으면 Worker 가 받음)
const TIMEOUT = 10 * 60 * 1000;

export function createPool({ dbLists, l2Raw = () => null, onStatus = () => {} }) {
  const pending = new Map(), pool = [];
  let reqId = 0;
  function onMessage(e) {
    const d = e.data;
    if (d.id == null) { if (d.error) onStatus(`계산 Worker 초기화 실패: ${d.error}`); return; }
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
  function spawn() {
    const w = new Worker(new URL('../../engine/mech3d/mc3d-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = onMessage;
    w.onerror = (e) => { const msg = `계산 Worker 오류: ${e.message ?? e}`; onStatus(msg); drop(w, msg); };
    w.postMessage({ type: 'init', l2Base: new URL('../../engine/l2/data/', import.meta.url).href, l2: l2Raw() ?? undefined, db: dbLists() });
    return w;
  }
  const worker = (k = 0) => { while (pool.length <= k) pool.push(spawn()); return pool[k]; };
  const call = (w, msg) => new Promise((res, rej) => {
    const id = ++reqId;
    const timer = setTimeout(() => { if (pending.has(id)) drop(w, '계산 시간 초과(10분) — 다시 시도하세요'); }, TIMEOUT);
    pending.set(id, { res, rej, w, timer });
    w.postMessage({ ...msg, id });
  });
  const size = () => Math.max(1, Math.min(12, (navigator.hardwareConcurrency ?? 4) - 2));   // 화면(메인 스레드)·브라우저 몫으로 코어 2개 남김
  const ports = () => Array.from({ length: size() }, (_, k) => ({ send: (msg) => call(worker(k), msg) }));
  const warm = () => { for (let k = 0; k < size(); k++) worker(k); };
  const setDb = (db) => { for (const w of pool) w.postMessage({ type: 'db', db }); };   // 이미 뜬 Worker 의 소재 DB 갱신(새 Worker 는 init 에서)
  return { worker, call, killAll, ports, warm, setDb };
}
