// 최적화 모니터 — 화면 안에 떠 있는 창(2026-10-29 A안). '현재 설계 계산' · '설계 인자 현황' · '자동설계·최적화' 칸을
// 원래 자리에서 이 창으로 옮겨(같은 DOM — 연결·갱신 그대로) 3D 를 다루는 동안에도 계속 보이게 한다. 닫으면 원래 자리로 되돌림.
// 끌어서 옮기기(머리) · 크기 조절(오른쪽 아래 모서리) · 접기(현재 설계 계산만). 열림·위치·크기·접힘 = 보는 사람별(uds.m3.mon)
const KEY = 'uds.m3.mon', MIN_W = 320, MIN_H = 160;
export const DEF_RECT = { x: null, y: 90, w: 460, h: 560 };   // x null = 오른쪽에 붙임

// 창이 화면 밖으로 나가지 않게(머리 줄은 늘 보이게) 위치·크기를 맞춤 — 순수
export function clampRect(r, vw, vh) {
  const w = Math.round(Math.max(MIN_W, Math.min(r.w ?? DEF_RECT.w, vw - 16))), h = Math.round(Math.max(MIN_H, Math.min(r.h ?? DEF_RECT.h, vh - 16)));
  const x0 = r.x == null ? vw - w - 16 : r.x;
  return { x: Math.round(Math.max(8, Math.min(x0, vw - w - 8))), y: Math.round(Math.max(8, Math.min(r.y ?? DEF_RECT.y, vh - 40))), w, h };
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

// host = 창을 붙일 곳(#mech3d-wrap — CSS 변수 상속), items = 옮길 칸들(차례대로), onChange(open) = 단추 표시 갱신
export function createMonitor({ host, items, onChange = () => {} }) {
  let st = { open: false, min: false, ...DEF_RECT, ...load() }, el = null, marks = [];
  const persist = () => save({ open: st.open, min: st.min, x: st.x, y: st.y, w: st.w, h: st.h });
  const place = () => { if (!el) return; const r = clampRect(st, innerWidth, innerHeight); Object.assign(st, r); el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.w}px`; el.style.height = st.min ? 'auto' : `${r.h}px`; };
  const kick = () => window.dispatchEvent(new Event('resize'));   // 옮긴 칸의 그래프·캔버스 크기 다시
  function build() {
    el = document.createElement('div');
    el.className = 'm3-mon'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '최적화 모니터');
    el.innerHTML = `<div class="m3-mon-hd" title="끌어서 옮기기"><b>📊 최적화 모니터</b><span class="m3-mon-sp"></span><button type="button" data-mon-min></button><button type="button" data-mon-close title="원래 자리로 되돌리기">✕ 닫기</button></div><div class="m3-mon-body"></div><div class="m3-mon-rs" title="크기 조절"></div>`;
    const hd = el.querySelector('.m3-mon-hd'), rs = el.querySelector('.m3-mon-rs');
    drag(hd, (dx, dy, s0) => { st.x = s0.x + dx; st.y = s0.y + dy; place(); }, (e) => !e.target.closest('button'));
    drag(rs, (dx, dy, s0) => { st.w = s0.w + dx; st.h = s0.h + dy; place(); }, () => !st.min, kick);
    el.querySelector('[data-mon-min]').onclick = () => setMin(!st.min);
    el.querySelector('[data-mon-close]').onclick = close;
    host.appendChild(el);
  }
  function drag(handle, onMove, ok, onEnd = () => {}) {
    handle.addEventListener('pointerdown', (e) => {
      if (!ok(e)) return;
      e.preventDefault(); handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, s0 = { ...st };
      const mv = (ev) => onMove(ev.clientX - x0, ev.clientY - y0, s0);
      const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); persist(); onEnd(); };
      handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  }
  function setMin(v) {
    st.min = v; persist();
    el.classList.toggle('min', v);
    const b = el.querySelector('[data-mon-min]'); b.textContent = v ? '▾ 펼치기' : '▴ 접기'; b.title = v ? '모든 칸 보기' : '현재 설계 계산만 남기기';
    place(); kick();
  }
  function open() {
    if (st.open && el) return;
    if (!el) build();
    const body = el.querySelector('.m3-mon-body');
    marks = items.filter(Boolean).map((it) => { const m = document.createComment('m3-mon'); it.before(m); body.appendChild(it); return [m, it]; });
    st.open = true; persist(); el.hidden = false; setMin(st.min); onChange(true);
    addEventListener('resize', place);
  }
  function close() {
    if (!st.open) return;
    for (const [m, it] of marks) { m.replaceWith(it); }
    marks = []; st.open = false; persist(); if (el) el.hidden = true; onChange(false);
    removeEventListener('resize', place); kick();
  }
  if (st.open) { st.open = false; queueMicrotask(open); }   // 지난번에 열어 둔 채였으면 다시 엶
  return { open, close, toggle: () => (st.open ? close() : open()), isOpen: () => st.open };
}
