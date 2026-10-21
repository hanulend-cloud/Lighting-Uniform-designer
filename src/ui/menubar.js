// 상단 메뉴 막대(파일·편집·보기·계산·설정·도움말) — 정의 → 드롭다운.
// menus = [{ label, items: [{ id, label, key?, enabled?(), checked?() } | '-'] }], run(id) = 항목 실행.
// 클릭으로 열고, 열린 동안 다른 메뉴 제목에 올리면 그 메뉴로 바뀜 · 바깥 클릭·Esc·항목 실행 = 닫힘. 열 때마다 enabled/checked 를 다시 계산
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function menuHtml(menus, open = -1) {
  return menus.map((m, i) => {
    const drop = i !== open ? '' : `<div class="mb-drop" role="menu">${m.items.map((it) => (it === '-' ? '<div class="mb-sep" role="separator"></div>'
      : `<button type="button" role="menuitem" class="mb-item" data-cmd="${esc(it.id)}"${it.enabled && !it.enabled() ? ' disabled' : ''}><span class="mb-chk">${it.checked?.() ? '✓' : ''}</span><span class="mb-lbl">${esc(it.label)}</span>${it.key ? `<span class="mb-key">${esc(it.key)}</span>` : ''}</button>`)).join('')}</div>`;
    return `<div class="mb-menu${i === open ? ' open' : ''}"><button type="button" class="mb-top" data-mb="${i}" aria-haspopup="menu" aria-expanded="${i === open}">${esc(m.label)}</button>${drop}</div>`;
  }).join('');
}

export function mountMenubar(el, menus, run) {
  let open = -1;
  const set = (i) => { open = i; el.innerHTML = menuHtml(menus, open); if (open >= 0) el.querySelector('.mb-item:not([disabled])')?.focus({ preventScroll: true }); };
  el.addEventListener('click', (e) => {
    e.stopPropagation();   // 다시 그리면 클릭한 버튼이 문서에서 빠짐 → 문서 쪽 '바깥 클릭' 으로 오인하지 않게
    const top = e.target.closest('.mb-top'), item = e.target.closest('.mb-item');
    if (top) { const i = +top.dataset.mb; set(open === i ? -1 : i); return; }
    if (item && !item.disabled) { const id = item.dataset.cmd; set(-1); run(id); }
  });
  el.addEventListener('mouseover', (e) => { const top = e.target.closest('.mb-top'); if (top && open >= 0 && +top.dataset.mb !== open) set(+top.dataset.mb); });
  document.addEventListener('click', (e) => { if (open >= 0 && !el.contains(e.target)) set(-1); });
  document.addEventListener('keydown', (e) => {
    if (open < 0) return;
    if (e.key === 'Escape') { set(-1); e.stopPropagation(); return; }
    const items = [...el.querySelectorAll('.mb-item:not([disabled])')], k = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(k + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); set((open + (e.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length); }
  }, true);
  set(-1);
  return { close: () => set(-1) };
}
