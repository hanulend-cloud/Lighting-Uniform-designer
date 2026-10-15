// 3D 기구 모드 상태 저장소 — spec 2026-10-15 m3-cad-ui §3.
// mspec = 저장 상태(spec.mech3d 객체 그대로), session = 세션 상태. update(tag, fn) → fn(mspec, session) 실행 → 구독자에게 tag 알림.
// 저장(persist)은 저장 상태 태그일 때만, delay(ms) 디바운스.
export const TAGS = ['material', 'light', 'observe', 'target', 'contacts', 'view', 'session'];
export const PHYSICS = new Set(['material', 'light', 'observe', 'contacts']);        // 계산 다시 시작
export const GEOM_CHECK = new Set(['material', 'light', 'observe', 'target']);       // 기하 점검 다시(target = 점검 기준값)
const PERSIST = new Set(['material', 'light', 'observe', 'target', 'contacts']);

export function initialSession() {
  return {
    node: null,          // 피처 트리 선택 노드 id ('parts' | 'part:i' | 'light' | 'leds' | 'obs' | 'target' | 'contacts')
    sel: null,           // 3D 선택 { part, face } (기구 부품만)
    pick: null,          // 클릭 모드 'obs' | 'led' | 'ledx' | 'pcb' | null
    line: null, lineErr: '', ledInfo: '', status: '',
    calc: null,          // 점진 계산 snapshot(progressive.js)
    view: 'iso',         // 'top' | 'front' | 'side' | 'iso'
    section: null,       // { axis:'x'|'y'|'z', pos, box:[6] } | null
    focusCheck: null,    // 강조할 점검 id
  };
}

export function createStore(mspec, { persist = () => {}, delay = 300, timers = globalThis } = {}) {
  const subs = new Set();
  let t = null, disposed = false;
  // 저장 오류·구독자 오류는 삼키고 기록만 — 한 곳의 실패가 다른 구독자·update 호출자를 막지 않게
  const save = () => { try { persist(); } catch (e) { console.error('[m3 store] 저장 실패', e); } };
  const store = {
    mspec, session: initialSession(),
    update(tag, fn) {
      if (!TAGS.includes(tag)) throw new Error(`알 수 없는 변경 태그: ${tag}`);
      if (disposed) return;
      if (fn) fn(store.mspec, store.session);
      if (PERSIST.has(tag)) {
        if (t != null) timers.clearTimeout(t);
        t = timers.setTimeout(() => { t = null; save(); }, delay);
      }
      for (const f of [...subs]) { try { f(tag); } catch (e) { console.error('[m3 store] 구독자 오류', e); } }
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    flush() { if (t != null) { timers.clearTimeout(t); t = null; save(); } },
    dispose() { try { store.flush(); } finally { disposed = true; subs.clear(); } },
  };
  return store;
}
