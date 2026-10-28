// 부품 선택 기하 계산(간격 표·가능 범위)을 Worker 로 — app.js 가 결과를 기다리지 않고 화면을 먼저 그리고, 오면 다시 그림.
// 메쉬 배열(장면 부품 목록·LED STEP 메쉬)은 객체가 바뀔 때만 한 번 복사해 보냄(같은 목록은 key 로 가리킴)
let worker = null, reqId = 0;
const pending = new Map(), keyOf = { cur: new WeakMap(), raw: new WeakMap(), led: new WeakMap() };   // 역할별(같은 배열이 cur·raw 둘 다일 수 있음)
let nextKey = 1;
function w() {
  if (worker) return worker;
  worker = new Worker(new URL('../../engine/mech3d/geom-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
  worker.onerror = () => { for (const p of pending.values()) p({ error: '기하 계산 Worker 오류' }); pending.clear(); worker?.terminate(); worker = null; for (const r in keyOf) keyOf[r] = new WeakMap(); };   // 새 Worker 에는 다시 올림
  return worker;
}
// 목록을 Worker 에 올려 두고 key 를 돌려줌(이미 올렸으면 그대로)
function ensure(role, arr) {
  if (!arr) return null;
  let k = keyOf[role].get(arr);
  if (k) return k;
  k = nextKey++;
  keyOf[role].set(arr, k);
  w().postMessage({ type: 'parts', role, key: k, parts: arr.map((p) => (p ? { positions: p.positions, triangles: p.triangles } : null)) });
  return k;
}
// cur = 지금 장면 부품(변환 반영), raw = 원본 부품, led = LED STEP 메쉬 목록(없으면 []), i = 부품 번호, xf = 그 부품의 변환
export function geomQuery({ cur, raw, led, i, xf, emitters, limEmitters }) {
  const msg = { type: 'q', id: ++reqId, cur: ensure('cur', cur), raw: ensure('raw', raw), led: led?.length ? ensure('led', led) : null, i, xf: xf ?? null, emitters: (emitters ?? []).map((e) => ({ pos: e.pos, axis: e.axis })), limEmitters: (limEmitters ?? []).map((e) => ({ pos: e.pos, axis: e.axis })) };
  return new Promise((res) => { pending.set(msg.id, res); w().postMessage(msg); });
}
// 크기·위치 바꾸기 간섭 확인(limitXform)을 Worker 로 — { lx: { xf, limited, hit, t } } | { stale } | { error }
export function geomLimit({ cur, raw, led, i, oldXf, newXf, emitters }) {
  const msg = { type: 'lx', id: ++reqId, cur: ensure('cur', cur), raw: ensure('raw', raw), led: led?.length ? ensure('led', led) : null, i, oldXf: oldXf ?? null, newXf, emitters: (emitters ?? []).map((e) => ({ pos: e.pos, axis: e.axis })) };
  return new Promise((res) => { pending.set(msg.id, res); w().postMessage(msg); });
}
