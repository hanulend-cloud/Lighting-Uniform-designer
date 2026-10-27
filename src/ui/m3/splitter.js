// 3D 화면 좌·우 창 폭 조절 — .m3-main 의 열 경계에 끌기 손잡이 2개(왼쪽 창 | 3D | 오른쪽 창).
// 폭은 화면 비율(0~1)로 저장(uds.m3.split) — 창 크기가 바뀌어도 같은 비율. 3D 는 최소 MIN_VP px. 두 번 클릭 = 기본값. 좁은 화면(≤1024px)은 원래 배치
const KEY = 'uds.m3.split', DEF = { l: 260, r: 430 }, MIN = { l: 180, r: 260 }, MIN_VP = 280, NARROW = 1024;
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.l > 0 && v.l < 1 && v.r > 0 && v.r < 1 ? v : null; } catch { return null; } };
const save = (v) => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch {} };

// 비율 → px(전체 폭 W 안에서 최소 폭·3D 최소 폭을 지킴) — 순수
export function splitPx(W, frac) {
  let l = frac ? frac.l * W : DEF.l, r = frac ? frac.r * W : DEF.r;
  l = Math.max(MIN.l, l); r = Math.max(MIN.r, r);
  const over = l + r + MIN_VP - W;
  if (over > 0) { const k = Math.max(0, (W - MIN_VP) / (l + r)); l = Math.max(MIN.l, l * k); r = Math.max(MIN.r, r * k); }
  return { l: Math.round(l), r: Math.round(r) };
}

export function mountSplitter(main) {
  if (!main || main.dataset.split) return;
  main.dataset.split = '1';
  let frac = load();
  const apply = () => {
    const W = main.clientWidth;
    if (!W || window.innerWidth <= NARROW) { main.style.removeProperty('--m3-l'); main.style.removeProperty('--m3-r'); return; }
    const { l, r } = splitPx(W, frac);
    main.style.setProperty('--m3-l', `${l}px`); main.style.setProperty('--m3-r', `${r}px`);
  };
  const mk = (side) => {
    const h = document.createElement('div');
    h.className = `m3-split m3-split-${side}`; h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical');
    h.title = `${side === 'l' ? '왼쪽' : '오른쪽'} 창 폭 — 끌어서 조절 · 두 번 클릭 = 기본값`;
    h.addEventListener('pointerdown', (e) => {
      if (window.innerWidth <= NARROW) return;
      e.preventDefault(); h.setPointerCapture(e.pointerId); main.classList.add('m3-splitting');
      const box = main.getBoundingClientRect(), W = box.width, cur = splitPx(W, frac);
      const move = (ev) => {
        const x = ev.clientX - box.left, nl = side === 'l' ? x : cur.l, nr = side === 'r' ? W - x : cur.r;
        frac = { l: nl / W, r: nr / W }; apply();
      };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        main.classList.remove('m3-splitting');
        const p = splitPx(W, frac); frac = { l: p.l / W, r: p.r / W }; save(frac);
        window.dispatchEvent(new Event('resize'));   // 결과 그래프 다시 그리기
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('dblclick', () => { frac = null; save(null); apply(); window.dispatchEvent(new Event('resize')); });
    main.appendChild(h);
  };
  mk('l'); mk('r');
  new ResizeObserver(apply).observe(main);
  apply();
}

// 아래 칸(자동설계·대시보드) 높이 조절 — 위 경계 손잡이를 위아래로 끌기(uds.m3.dockH, px). 3D·결과 칸은 최소 MIN_MAIN 을 남김. 두 번 클릭 = 기본
// 키 바꿈: 기본 높이를 줄인 것(250 → 200, 2026-10-27)이 예전에 끌어 둔 값에 가려지지 않게
const DOCK_KEY = 'uds.m3.dockH2', DOCK_DEF = 200, DOCK_MIN = 120, MIN_MAIN = 240;
export const clampDock = (h, wrapH) => Math.round(Math.max(DOCK_MIN, Math.min(h, Math.max(DOCK_MIN, wrapH - MIN_MAIN - 90))));   // 90 = 명령줄·상태줄
export function mountDockSplitter(dock, wrap) {
  if (!dock || dock.dataset.split) return;
  dock.dataset.split = '1';
  let h = DOCK_DEF; try { const v = +localStorage.getItem(DOCK_KEY); if (v > 0) h = v; } catch {}
  const apply = () => { if (window.innerWidth <= NARROW) { dock.style.removeProperty('--m3-dock-h'); return; } dock.style.setProperty('--m3-dock-h', `${clampDock(h, wrap.clientHeight)}px`); };
  const hd = document.createElement('div');
  hd.className = 'm3-dock-split'; hd.setAttribute('role', 'separator'); hd.setAttribute('aria-orientation', 'horizontal'); hd.title = '아래 칸 높이 — 위아래로 끌어 조절 · 두 번 클릭 = 기본';
  hd.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= NARROW) return;
    e.preventDefault(); hd.setPointerCapture(e.pointerId); wrap.classList.add('m3-splitting-v');
    const y0 = e.clientY, h0 = dock.getBoundingClientRect().height;
    const move = (ev) => { h = clampDock(h0 - (ev.clientY - y0), wrap.clientHeight); apply(); };
    const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); wrap.classList.remove('m3-splitting-v'); try { localStorage.setItem(DOCK_KEY, String(h)); } catch {} window.dispatchEvent(new Event('resize')); };
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
  hd.addEventListener('dblclick', () => { h = DOCK_DEF; try { localStorage.removeItem(DOCK_KEY); } catch {} apply(); window.dispatchEvent(new Event('resize')); });
  dock.prepend(hd);
  new ResizeObserver(apply).observe(wrap);
  apply();
}

// 왼쪽 창 맨 아래 설계 인자 현황판 높이 조절 — 위 경계를 위아래로 끌기(uds.m3.facH, px). 부품 속성 칸은 최소 FAC_KEEP 을 남김. 두 번 클릭 = 기본
const FAC_KEY = 'uds.m3.facH', FAC_DEF = 220, FAC_MIN = 90, FAC_KEEP = 160;
export const clampFac = (h, colH) => Math.round(Math.max(FAC_MIN, Math.min(h, Math.max(FAC_MIN, colH - FAC_KEEP))));
export function mountFacSplitter(card, col) {
  if (!card || card.dataset.split) return;
  card.dataset.split = '1';
  let h = FAC_DEF; try { const v = +localStorage.getItem(FAC_KEY); if (v > 0) h = v; } catch {}
  const room = () => col.clientHeight - (col.firstElementChild?.offsetHeight ?? 0);   // 맨 위 피처 트리를 뺀 높이
  const apply = () => { if (window.innerWidth <= NARROW) { card.style.removeProperty('--m3-fac-h'); return; } card.style.setProperty('--m3-fac-h', `${clampFac(h, room())}px`); };
  const hd = document.createElement('div');
  hd.className = 'm3-fac-split'; hd.setAttribute('role', 'separator'); hd.setAttribute('aria-orientation', 'horizontal'); hd.title = '설계 인자 현황 높이 — 위아래로 끌어 조절 · 두 번 클릭 = 기본';
  hd.addEventListener('pointerdown', (e) => {
    if (window.innerWidth <= NARROW) return;
    e.preventDefault(); hd.setPointerCapture(e.pointerId); document.body.classList.add('m3-splitting-f');
    const y0 = e.clientY, h0 = card.getBoundingClientRect().height;
    const move = (ev) => { h = clampFac(h0 - (ev.clientY - y0), room()); apply(); };
    const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); document.body.classList.remove('m3-splitting-f'); try { localStorage.setItem(FAC_KEY, String(h)); } catch {} window.dispatchEvent(new Event('resize')); };
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });
  hd.addEventListener('dblclick', () => { h = FAC_DEF; try { localStorage.removeItem(FAC_KEY); } catch {} apply(); window.dispatchEvent(new Event('resize')); });
  card.prepend(hd);
  new ResizeObserver(apply).observe(col);
  apply();
}
