// 칸 크기 조절 막대(2026-10-30) — 나란한 칸들(items) 사이에 끌기 막대를 넣어 비율을 바꿈.
// dir 'col' = 위아래로 쌓인 칸의 높이(가로 막대), 'row' = 좌우로 놓인 칸의 폭(세로 막대). 비율 = flex-grow — 전체 크기는 그대로(부모를 꽉 채움).
// 두 번 클릭 = 같은 크기. 비율은 보는 사람별(localStorage key). onChange = 크기가 바뀐 뒤(캔버스 다시 그리기 등)
export function mountSplit(items, { key, dir = 'col', min = 60, onChange = () => {} } = {}) {
  const els = items.filter(Boolean);
  if (els.length < 2 || els[0].dataset.split2) return null;
  els[0].dataset.split2 = '1';
  const load = () => { try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) && v.length === els.length && v.every((x) => x > 0) ? v : null; } catch { return null; } };
  const save = () => { try { localStorage.setItem(key, JSON.stringify(w)); } catch {} };
  let w = load() ?? els.map(() => 1);
  const size = (e) => (dir === 'col' ? e.getBoundingClientRect().height : e.getBoundingClientRect().width);
  const apply = () => els.forEach((e, i) => { e.style.flex = `${w[i]} 1 0`; if (dir === 'col') e.style.minHeight = '0'; else e.style.minWidth = '0'; });
  els.slice(0, -1).forEach((e, i) => {
    const h = document.createElement('div');
    h.className = `m3-psplit ${dir}`; h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', dir === 'col' ? 'horizontal' : 'vertical');
    h.title = `${dir === 'col' ? '위아래' : '좌우'}로 끌어 크기 조절 · 두 번 클릭 = 같은 크기`;
    h.addEventListener('pointerdown', (ev) => {
      const a0 = size(els[i]), b0 = size(els[i + 1]), s = w[i] + w[i + 1], p0 = dir === 'col' ? ev.clientY : ev.clientX;
      if (a0 + b0 < 2 * min) return;   // 칸이 숨었거나(접힘) 너무 작으면 끌지 않음 — 비율이 망가진 채 저장되던 것 방지
      ev.preventDefault(); h.setPointerCapture(ev.pointerId); h.classList.add('on');
      const mv = (m) => { const d = (dir === 'col' ? m.clientY : m.clientX) - p0, a = Math.max(min, Math.min(a0 + b0 - min, a0 + d)); w[i] = (s * a) / (a0 + b0); w[i + 1] = s - w[i]; apply(); onChange(); };
      const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); h.classList.remove('on'); save(); onChange(); };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('dblclick', () => { w = els.map(() => 1); apply(); save(); onChange(); });
    e.after(h);
  });
  apply();
  return { reset: () => { w = els.map(() => 1); apply(); save(); onChange(); } };
}
