// ⑤ 기구 최적화 창 — 화면 안에 떠 있는 창(2026-10-29). 기본 화면에는 설계와 ④ 광분포 시뮬레이션만 두고,
// 기구 최적화에 관한 칸('설계 인자 현황' · 기구 최적화 실행·항목·결과)은 처음부터 이 창 안에 옮겨 둔다(같은 DOM — 연결·갱신 그대로).
// 명령줄 [5 기구 최적화] 로 열고 닫음(닫으면 숨김 — 기본 화면으로 돌아가지 않음). 끌어서 옮기기(머리) · 크기 조절(오른쪽 아래) · 접기(실행 줄만).
// 열림·위치·크기·접힘 = 보는 사람별(uds.m3.opt)
const KEY = 'uds.m3.opt', MIN_W = 320, MIN_H = 160;
export const DEF_RECT = { x: null, y: 80, w: 1040, h: 680 };   // x null = 오른쪽에 붙임 · 넓게(왼쪽 설계 인자 | 오른쪽 실행·진행, 2026-10-30)
const LAY = 2;   // 창 배치 판 — 예전(세로 쌓기, 폭 540) 저장값은 위치·크기를 새 기본으로

// 창이 화면 밖으로 나가지 않게(머리 줄은 늘 보이게) 위치·크기를 맞춤 — 순수
export function clampRect(r, vw, vh) {
  const w = Math.round(Math.max(MIN_W, Math.min(r.w ?? DEF_RECT.w, vw - 16))), h = Math.round(Math.max(MIN_H, Math.min(r.h ?? DEF_RECT.h, vh - 16)));
  const x0 = r.x == null ? vw - w - 16 : r.x;
  return { x: Math.round(Math.max(8, Math.min(x0, vw - w - 8))), y: Math.round(Math.max(8, Math.min(r.y ?? DEF_RECT.y, vh - 40))), w, h };
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

// host = 창을 붙일 곳(#mech3d-wrap — CSS 변수 상속), items = 창에 담을 칸들(차례대로), onChange(open) = 단추 표시 갱신
export function createMonitor({ host, items, onChange = () => {} }) {
  const sv = load(), old = sv.lay !== LAY;
  let st = { open: false, min: false, ...DEF_RECT, ...(old ? { open: sv.open, min: sv.min } : sv) };
  const persist = () => save({ lay: LAY, open: st.open, min: st.min, x: st.x, y: st.y, w: st.w, h: st.h });
  const el = document.createElement('div');
  const place = () => { const r = clampRect(st, innerWidth, innerHeight); Object.assign(st, r); el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.w}px`; el.style.height = st.min ? 'auto' : `${r.h}px`; };
  const kick = () => window.dispatchEvent(new Event('resize'));   // 담은 칸의 그래프·캔버스 크기 다시
  el.className = 'm3-mon'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '기구 최적화');
  el.innerHTML = `<div class="m3-mon-hd" title="끌어서 옮기기"><b><i class="m3-fl">5</i>기구 최적화</b><span class="mut m3-mon-flow" title="④ 광분포 시뮬레이션이 목표 미달이면 여기서 Milky·LED 위치·형상 후보를 찾고 [적용] → ④ 가 다시 계산해 검증">④ 결과 미달 → 후보 탐색 → 적용 → ④ 재검증</span><span class="m3-mon-sp"></span><button type="button" data-mon-min></button><button type="button" data-mon-close title="창 닫기(진행 중인 최적화는 계속)">✕ 닫기</button></div><div class="m3-mon-body"></div><div class="m3-mon-rs" title="크기 조절"></div>`;
  const body = el.querySelector('.m3-mon-body');
  for (const it of items.filter(Boolean)) body.appendChild(it);   // 기본 화면에서 빼서 창 안으로(닫아도 여기 그대로)
  host.appendChild(el);
  drag(el.querySelector('.m3-mon-hd'), (dx, dy, s0) => { st.x = s0.x + dx; st.y = s0.y + dy; place(); }, (e) => !e.target.closest('button'));
  drag(el.querySelector('.m3-mon-rs'), (dx, dy, s0) => { st.w = s0.w + dx; st.h = s0.h + dy; place(); }, () => !st.min, kick);
  el.querySelector('[data-mon-min]').onclick = () => setMin(!st.min);
  el.querySelector('[data-mon-close]').onclick = () => close();
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
    const b = el.querySelector('[data-mon-min]'); b.textContent = v ? '▾ 펼치기' : '▴ 접기'; b.title = v ? '모든 칸 보기' : '실행 줄만 남기기';
    place(); kick();
  }
  function open() {
    if (st.open) return;
    st.open = true; persist(); el.hidden = false; setMin(st.min); onChange(true);
    addEventListener('resize', place);
  }
  function close() {
    if (!st.open) return;
    st.open = false; persist(); el.hidden = true; onChange(false);
    removeEventListener('resize', place);
  }
  if (st.open) { st.open = false; queueMicrotask(open); }   // 지난번에 열어 둔 채였으면 다시 엶
  return { open, close, toggle: () => (st.open ? close() : open()), isOpen: () => st.open, el };
}
