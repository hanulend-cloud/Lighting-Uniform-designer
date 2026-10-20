// 탭 동시 편집 잠금 — 같은 브라우저의 여러 탭이 localStorage(설정·소재 DB)를 서로 덮어쓰지 않게 한다.
//
// 방식(단일 편집 탭, 나머지 읽기 전용):
//  · 역할: 'pending'(시작 직후, 응답 대기) → 'editor' 또는 'readonly'.
//  · 시작하면 {hello} 를 알린다. 살아 있는 편집 탭(또는 먼저 연 대기 탭)이 {here} 로 답하면 읽기 전용.
//    WAIT ms 동안 답이 없으면 편집 탭이 된다. 대기 중 저장은 키별로 보류했다가 편집 탭이 되면 실행.
//  · 동시에 연 두 대기 탭은 id 가 작은(먼저 연) 쪽이 이긴다 — id 는 시작 시각 기반 문자열.
//  · [이 탭에서 편집하기] = take(): {take} 를 알리고 즉시 편집 탭이 된다. 받은 탭은 읽기 전용이 되며
//    이후 write() 가 모두 무시되므로 디바운스로 예약돼 있던 저장도 실제로는 쓰지 않는다(=취소).
//    main.js 는 take 직후 세션 플래그를 남기고 새로고침해, 최신 localStorage 를 다시 읽은 뒤
//    takeOnStart 로 시작한다(그 사이 새로 연 탭이 있어도 다시 take 를 알려 읽기 전용으로 돌림).
//  · 읽기 전용 탭은 화면 조작·계산은 그대로 되지만 write() 가 false 를 돌려주고 아무것도 쓰지 않는다.
//  · 편집 탭이 닫혀도 읽기 전용 탭은 자동 승격하지 않는다(안내 띠의 [새로고침]/[이 탭에서 편집하기]).
// channel 은 BroadcastChannel 과 같은 모양({postMessage, onmessage, close}) — 시험에선 fakeBus().
export const WAIT = 250;

export function createTabLock({ channel, id, timers = globalThis, wait = WAIT, takeOnStart = false, onChange = () => {} } = {}) {
  let role = 'pending';
  const held = new Map();   // 대기 중 보류한 저장(key → fn) — 마지막 것만
  const post = (m) => { try { channel?.postMessage({ ...m, id }); } catch {} };
  const set = (r) => {
    if (r === role) return;
    role = r;
    if (r === 'editor') { for (const fn of held.values()) { try { fn(); } catch (e) { console.error('[tab-lock] 저장 실패', e); } } }
    held.clear();
    onChange(r);
  };
  let tid = null;
  const settleRole = () => { tid = null; if (role === 'pending') set('editor'); };

  if (channel) {
    channel.onmessage = (ev) => {
      const m = ev?.data; if (!m || m.id === id) return;
      if (m.type === 'take') { set('readonly'); return; }
      if (m.type === 'hello') {
        if (role !== 'readonly') post({ type: 'here', role });
        if (role === 'pending' && m.id < id) set('readonly');   // 먼저 연 대기 탭이 이김
        return;
      }
      if (m.type === 'here' && role === 'pending') {
        if (m.role === 'editor' || (m.role === 'pending' && m.id < id)) set('readonly');
      }
    };
  }
  if (!channel) set('editor');
  else if (takeOnStart) { post({ type: 'take' }); set('editor'); }
  else { post({ type: 'hello' }); tid = timers.setTimeout(settleRole, wait); }

  return {
    get role() { return role; },
    canWrite: () => role === 'editor',
    // 저장 실행 게이트: 편집 탭이면 실행(true), 대기 중이면 보류(false), 읽기 전용이면 버림(false)
    write(key, fn) {
      if (role === 'editor') { fn(); return true; }
      if (role === 'pending') held.set(key, fn);
      return false;
    },
    take() { post({ type: 'take' }); set('editor'); },
    dispose() { if (tid != null) timers.clearTimeout(tid); try { if (channel) { channel.onmessage = null; channel.close?.(); } } catch {} },
  };
}

// BroadcastChannel 이 없을 때: localStorage 'storage' 이벤트로 같은 모양의 채널을 흉내 낸다.
export function storageChannel(win, key = 'uds.tablock.msg') {
  const ch = { onmessage: null,
    postMessage(data) { try { win.localStorage.setItem(key, JSON.stringify({ data, n: Math.random() })); } catch {} },
    close() { win.removeEventListener('storage', on); } };
  const on = (e) => { if (e.key !== key || !e.newValue) return; try { ch.onmessage?.({ data: JSON.parse(e.newValue).data }); } catch {} };
  win.addEventListener('storage', on);
  return ch;
}

export function openChannel(win = globalThis) {
  try { if (typeof win.BroadcastChannel === 'function') return new win.BroadcastChannel('uds-app'); } catch {}
  try { if (win.localStorage && win.addEventListener) return storageChannel(win); } catch {}
  return null;
}

// 시험용 버스: 보낸 쪽을 뺀 모든 채널에 비동기 전달(BroadcastChannel 과 같음)
export function fakeBus() {
  const chans = new Set();
  return { open() {
    const ch = { onmessage: null, closed: false,
      postMessage(data) { const msg = structuredClone(data); for (const c of chans) if (c !== ch) setImmediate(() => { if (!c.closed) c.onmessage?.({ data: msg }); }); },
      close() { ch.closed = true; chans.delete(ch); } };
    chans.add(ch); return ch;
  } };
}
