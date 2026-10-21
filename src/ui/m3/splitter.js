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
