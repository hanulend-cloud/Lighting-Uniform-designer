// 피처 트리 — spec 2026-10-15 m3-cad-ui §2: 부품(소재 배지) · 광원(LED 개수·피치) · 관측면(라인 종류·길이·폭) · 목표 · 접촉면.
// 노드 id: 'parts' | 'part:i' | 'light' | 'leds' | 'obs' | 'target' | 'contacts'. 클릭 → h.onNode(id)
import { PART_KINDS } from '../../engine/mech3d/materials.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const LINE_KIND = { line: '직선', circle: '원', path: '곡선' };
export function partBadge(p) {
  const m = p.material, lab = PART_KINDS[m?.kind]?.label ?? '?';
  if (m.kind === 'milky') return +m.milky > 0 ? `${lab} ${(+m.milky).toFixed(1)}` : `${lab} 0 · 투명`;   // Milky 0 = 확산 없음(투명)
  if (m.kind === 'clear' || m.kind === 'whiteTrans') return `${lab} ${Math.round(m.T * 100)}%`;
  return p.finish?.R != null ? `${lab} ${Math.round(p.finish.R * 100)}%` : lab;
}
// M = spec.mech3d, S = store.session, lay = LED STEP 실제 배치(stepLayout 결과, 생략 = 모름) → [{ id, label, badge, child, kind, sel, eye? }]
// 편집한 배치(STEP 에서 추가·삭제 = positions, 기구 최적화 균등 = count·pitch)를 그리지 못했으면(오류·메쉬 없음) 배지 '배치 편집 실패' · 개수 = 원래
// eye: 보기 켜기/끄기 단추 — 'on' | 'off' (부품·LED 노드), 'all' (부품 머리: 숨긴 부품이 있을 때 "모두 보기")
export function treeNodes(M, S, lay) {
  const L = M.light, O = M.observe, out = [], hid = new Set(S.hidden ?? []);
  const node = (id, label, badge, child = false, kind = '', eye, extra = {}) => out.push({ id, label, badge, child, kind, sel: S.node === id || (S.multi ?? []).includes(id), eye, depth: child ? 1 : 0, ...extra });
  const fold = (k, def = false) => (S.fold?.[k] ?? def);   // 접힘 상태(세션) — 광원으로 옮긴 부품 묶음은 기본 접힘
  node('target', '◎ 목표', `${Math.round(O.targetLen * 100)}% / ${Math.round(O.targetWid * 100)}%`);   // 맨 위 — 무엇을 맞출지 먼저
  node('parts', '부품', String(M.parts.length), false, '', hid.size || S.hideLeds ? 'all' : undefined, { fold: fold('parts') ? 'closed' : 'open' });
  // 그룹(2026-10-30): 사용자 그룹(M.groups) = 첫 부품 자리에 머리 + 펼치면 부품(들여쓰기 2단) · 그룹 밖 광원으로 옮긴 부품 = 자동 묶음 '_light'(기본 접힘)
  const gOf = new Map(), G = [...(M.groups ?? [])];
  for (const g of G) for (const i of g.parts) if (i < M.parts.length && !gOf.has(i)) gOf.set(i, g);
  const lightFree = M.parts.map((p, i) => i).filter((i) => M.parts[i].role === 'light' && !gOf.has(i));
  if (lightFree.length) { const g = { id: '_light', name: '광원으로 옮긴 부품', parts: lightFree, auto: true }; G.push(g); for (const i of lightFree) gOf.set(i, g); }
  const shown = new Set();
  // 도면에서 광원으로 옮긴 부품 = '→ 광원'(보기는 광원 그룹이 함) · 추적 제외 = '제외 ·' 접두
  const partNode = (p, i, depth) => node(`part:${i}`, p.name, p.role === 'light' ? '→ 광원' : `${p.untrace ? '제외 · ' : ''}${partBadge(p)}`, true, p.role === 'light' ? 'led' : p.untrace ? 'off' : p.material.kind, p.role === 'light' ? undefined : hid.has(i) ? 'off' : 'on', { depth });
  if (!fold('parts')) M.parts.forEach((p, i) => {
    const g = gOf.get(i);
    if (!g) { partNode(p, i, 1); return; }
    if (shown.has(g.id)) return; shown.add(g.id);
    const mem = g.parts.filter((k) => k < M.parts.length), allHid = mem.length && mem.every((k) => hid.has(k)), closed = fold(g.id, !!g.auto);
    node(`group:${g.id}`, g.name, String(mem.length), true, 'group', g.auto ? undefined : allHid ? 'off' : 'on', { fold: closed ? 'closed' : 'open', depth: 1, auto: !!g.auto });
    if (!closed) for (const k of mem) partNode(M.parts[k], k, 2);
  });
  // 광원 머리 눈 단추 = 광원 그룹(LED 몸체·PCB·지향각) 한 번에 켜기/끄기
  node('light', '▾ 광원', L.kind === 'step' && L.step?.fromMech ? '3D 도면' : { none: '지정 안 함', step: 'LED STEP', manual: '직접 배치' }[L.kind], false, '', L.kind === 'step' ? (S.hideLeds ? 'off' : 'on') : undefined);
  if (L.kind !== 'none') {
    const ex = L.step?.excluded ?? [], vt = L.kind === 'step' ? L.step?.virtual : null;
    const failed = !!vt && lay !== undefined && !lay?.virtual && (!!lay?.err || !!S.line);   // 라인 대기 중은 실패 아님
    const nr = (o) => (Array.isArray(o.positions) ? o.positions.length : o.count * (o.rows === 2 ? 2 : 1)), rw = (o) => (o.rows === 2 ? `2열 × ${o.count}개` : `${o.count}개`);   // 총 LED = 열 수 × 열당 개수(spec P4 §2.2b)
    const n = vt && !failed ? (lay?.virtual ? lay.leds.length : nr(vt)) : L.kind === 'step' ? (L.step?.leds ?? []).filter((i) => !ex.includes(i)).length : nr(L.manual);
    const pit = (p) => (p > 0 ? `피치 ${+(+p).toFixed(1)}` : '균등');
    node('leds', `LED ×${n}`, L.kind === 'manual' ? (L.manual.rows === 2 ? `${rw(L.manual)} ${pit(L.manual.pitch)}` : pit(L.manual.pitch)) : failed ? '배치 편집 실패' : vt ? (Array.isArray(vt.positions) ? 'STEP 편집' : `자동 ${rw(vt)} ${pit(vt.pitch)}`) : `${L.spec.beam}°`, true, 'led', L.kind === 'step' ? (S.hideLeds ? 'off' : 'on') : undefined);
  }
  const ln = S.line;
  node('obs', '▾ 관측면', ln ? `${LINE_KIND[ln.kind] ?? ln.kind} ${ln.length.toFixed(0)}×${ln.width.toFixed(0)}` : O.faces.length ? '인식 중' : '미지정');
  return out;
}
// 그룹 연산(순수, 2026-10-30) — groups = [{ id, name, parts:[번호] }]. 새 그룹의 부품은 다른 그룹에서 빠지고, 빈 그룹은 지움
export function makeGroup(groups = [], parts, name) {
  const set = new Set(parts), n = groups.reduce((m, g) => Math.max(m, +String(g.id).replace(/\D/g, '') || 0), 0) + 1, id = `g${n}`;
  const rest = groups.map((g) => ({ ...g, parts: g.parts.filter((i) => !set.has(i)) })).filter((g) => g.parts.length);
  return { id, groups: [...rest, { id, name: name || `그룹 ${n}`, parts: [...set].sort((a, b) => a - b) }] };
}
export const ungroup = (groups = [], id) => groups.filter((g) => g.id !== id);
// 고른 부품을 모든 그룹에서 뺌(빈 그룹은 지움)
export const removeFromGroups = (groups = [], parts) => { const set = new Set(parts); return groups.map((g) => ({ ...g, parts: g.parts.filter((i) => !set.has(i)) })).filter((g) => g.parts.length); };
// Shift+클릭 범위 선택(순수) — order = 화면에 보이는 부품 노드 순서, from(기준) ~ to 사이 전부
export function rangeSelect(order, from, to) {
  const i = order.indexOf(from), j = order.indexOf(to);
  if (i < 0 || j < 0) return [to];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}
// 트리 우클릭 메뉴 항목(순수) — S.multi·S.node(우클릭한 노드가 선택에 포함된 뒤) 기준. k: group | out | ungroup | rename | eye
export function treeCtxItems(M, S, id) {
  const parts = [...new Set([...(S.multi ?? []), ...(S.node?.startsWith('part:') ? [S.node] : [])])].filter((x) => x.startsWith('part:')).map((x) => +x.slice(5));
  const inG = new Set((M.groups ?? []).flatMap((g) => g.parts)), out = [];
  if (id.startsWith('part:') && parts.length) {
    out.push({ k: 'group', label: parts.length > 1 ? `선택한 부품 ${parts.length}개 → 새 그룹` : '이 부품으로 새 그룹' });
    if (parts.some((i) => inG.has(i))) out.push({ k: 'out', label: '그룹에서 빼기' });
  }
  if (id.startsWith('group:') && id !== 'group:_light') out.push({ k: 'ungroup', label: '그룹 해제(부품은 그대로)' });
  if (id.startsWith('part:') || (id.startsWith('group:') && id !== 'group:_light')) out.push({ k: 'rename', label: '이름 바꾸기' });
  if (id.startsWith('part:') || id.startsWith('group:')) out.push({ k: 'eye', label: '보이기 / 숨기기' });
  return out;
}
// 그룹 부품 번호 — '_light' = 그룹 밖 광원으로 옮긴 부품(자동 묶음)
export function groupMembers(M, id) {
  if (id === '_light') { const inG = new Set((M.groups ?? []).flatMap((g) => g.parts)); return M.parts.map((p, i) => i).filter((i) => M.parts[i].role === 'light' && !inG.has(i)); }
  return ((M.groups ?? []).find((g) => g.id === id)?.parts ?? []).filter((i) => i < M.parts.length);
}
// 눈 단추 처리(순수): id = 'parts' | 'part:i' | 'group:g' | 'leds', only = Shift(이 부품만) → { hidden, hideLeds }. members = 그룹 부품(group: 일 때)
export function toggleVisibility(id, only, nParts, hidden = [], hideLeds = false, members = []) {
  const h = new Set(hidden);
  if (id === 'parts') return { hidden: [], hideLeds: false };
  if (id.startsWith('group:')) {   // 하나라도 보이면 모두 숨김, 다 숨었으면 모두 보임 · Shift = 이 그룹만 보기
    if (only) return { hidden: [...Array(nParts).keys()].filter((k) => !members.includes(k)), hideLeds: true };
    const anyShown = members.some((k) => !h.has(k));
    for (const k of members) { if (anyShown) h.add(k); else h.delete(k); }
    return { hidden: [...h].sort((a, b) => a - b), hideLeds };
  }
  if (id === 'leds' || id === 'light') return only ? { hidden: [...Array(nParts).keys()], hideLeds: false } : { hidden: [...h], hideLeds: !hideLeds };
  const i = +id.slice(5);
  if (only) return { hidden: [...Array(nParts).keys()].filter((k) => k !== i), hideLeds: true };
  if (h.has(i)) h.delete(i); else h.add(i);
  return { hidden: [...h].sort((a, b) => a - b), hideLeds };
}
const BOUND = new WeakMap();   // el → { h, html }  (이벤트는 컨테이너에 한 번만 위임, 핸들러는 최신 것)
const EYE = { on: ['👁', '보기 끄기 (Shift+클릭: 이 부품만 보기)', 'true'], off: ['◌', '보기 켜기 (Shift+클릭: 이 부품만 보기)', 'false'], all: ['👁', '모두 보기', 'false'] };
const eyeHtml = (n) => n.eye ? `<span class="m3-eye ${n.eye}" role="button" tabindex="0" data-eye="${esc(n.id)}" title="${EYE[n.eye][1]}" aria-label="${esc(n.label)} ${EYE[n.eye][1]}" aria-pressed="${EYE[n.eye][2]}">${EYE[n.eye][0]}</span>` : '';
// 노드: 접기 ▸/▾(data-fold) · 이름(data-lbl — 더블클릭 = 이름 바꾸기, 부품·사용자 그룹만) · 깊이(d1·d2 들여쓰기). 머리 = 그룹 단추
const caret = (n) => (n.fold ? `<span class="m3-fold" role="button" tabindex="-1" data-fold="${esc(n.id)}" aria-label="${n.fold === 'open' ? '접기' : '펼치기'}" aria-expanded="${n.fold === 'open'}">${n.fold === 'open' ? '▾' : '▸'}</span>` : '');
const renamable = (n) => n.id.startsWith('part:') || (n.id.startsWith('group:') && !n.auto);
export function treeHead() {   // 그룹 단추는 우클릭 메뉴로 옮김(2026-10-30)
  return '<div class="m3-h" title="클릭 = 속성 편집 · Ctrl+클릭 = 여러 개 · Shift+클릭 = 범위 · 우클릭 = 그룹 만들기·해제·이름 바꾸기">설계 트리 <span class="mut m3-tree-tip">우클릭 = 그룹</span></div>';
}
export const treeHtml = (M, S, lay) => `${treeHead(M, S)}${treeNodes(M, S, lay).map((n) => `<div class="m3-node ${n.child ? 'child' : ''} d${n.depth ?? 0}${n.id.startsWith('group:') ? ' grp' : ''} ${n.sel ? 'sel' : ''} ${n.eye === 'off' ? 'hid' : ''}" role="button" tabindex="0"${n.sel ? ' aria-current="true"' : ''} data-node="${esc(n.id)}">${caret(n)}${eyeHtml(n)}<span class="m3-lbl"${renamable(n) ? ' data-lbl title="더블클릭: 이름 바꾸기"' : ''}>${esc(n.label)}</span> <span class="${n.child && !n.id.startsWith('group:') ? `m3-badge k-${esc(n.kind)}` : 'b'}">${esc(n.badge)}</span></div>`).join('')}`;
// 작은 우클릭 메뉴(화면 고정 위치) — 바깥 클릭·Esc·창 벗어남 = 닫기
function ctxMenu(doc, x, y, items, onPick, host = doc.body) {   // host = 테마 변수를 물려받을 곳
  doc.querySelector('.m3-ctx')?.remove();
  const m = doc.createElement('div'); m.className = 'm3-ctx'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it) => `<button type="button" role="menuitem" data-k="${it.k}">${esc(it.label)}</button>`).join('');
  host.appendChild(m);
  const W = doc.defaultView, r = m.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x, W.innerWidth - r.width - 4))}px`; m.style.top = `${Math.max(4, Math.min(y, W.innerHeight - r.height - 4))}px`;
  const close = () => { m.remove(); doc.removeEventListener('pointerdown', away, true); doc.removeEventListener('keydown', key, true); W.removeEventListener('blur', close); };
  const away = (e) => { if (!m.contains(e.target)) close(); }, key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => { doc.addEventListener('pointerdown', away, true); doc.addEventListener('keydown', key, true); W.addEventListener('blur', close); });
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; close(); onPick(b.dataset.k); });
  m.querySelector('button')?.focus();
}
export function renderFeatureTree(el, M, S, h, lay) {
  let B = BOUND.get(el);
  if (!B) {
    B = { h, html: null }; BOUND.set(el, B);
    const fire = (e) => {
      if (e.target.classList?.contains?.('m3-ren')) return;   // 이름 고치는 중
      const t = e.target.closest?.('[data-tact]'); if (t?.dataset?.tact != null && el.contains(t)) { if (!t.disabled) B.h?.onTreeAct?.(t.dataset.tact); return; }   // ＋ 그룹 · 그룹 해제
      const f = e.target.closest?.('[data-fold]'); if (f?.dataset?.fold != null && el.contains(f)) { e.stopPropagation?.(); B.h?.onFold?.(f.dataset.fold); return; }   // 접기·펼치기
      const y = e.target.closest?.('[data-eye]');   // 눈 단추: 선택하지 않고 보기만 전환
      if (y && el.contains(y)) { e.stopPropagation?.(); B.h?.onEye?.(y.dataset.eye, !!e.shiftKey); return; }
      const n = e.target.closest?.('[data-node]'); if (n && el.contains(n)) B.h?.onNode?.(n.dataset.node, { multi: !!(e.ctrlKey || e.metaKey), range: !!e.shiftKey, order: partOrder() });   // Ctrl = 하나씩 더하기·빼기 · Shift = 범위
    };
    const partOrder = () => [...el.querySelectorAll('[data-node^="part:"]')].map((x) => x.dataset.node);
    el.addEventListener('click', fire);
    // 우클릭 메뉴 — 고르지 않은 노드면 그것만 고른 뒤, 고른 부품 수에 맞는 항목(새 그룹 · 그룹에서 빼기 · 그룹 해제 · 이름 · 보기)
    el.addEventListener('contextmenu', (e) => {
      const n = e.target.closest?.('[data-node]'); if (!n || !el.contains(n)) return;
      const id = n.dataset.node; if (!id.startsWith('part:') && !id.startsWith('group:')) return;
      e.preventDefault();
      B.h?.onCtxSelect?.(id);
      const items = treeCtxItems(B.M, B.S, id); if (!items.length) return;
      ctxMenu(el.ownerDocument, e.clientX, e.clientY, items, (k) => {
        if (k === 'rename') { const lb = [...el.querySelectorAll('[data-node]')].find((x) => x.dataset.node === id)?.querySelector('[data-lbl]'); if (lb) startRename(lb); }
        else if (k === 'eye') B.h?.onEye?.(id, false);
        else B.h?.onTreeAct?.(k);
      }, el.closest('#mech3d-wrap') ?? el.ownerDocument.body);
    });
    // 이름 더블클릭 → 그 자리 입력칸(Enter·바깥 클릭 = 저장, Esc = 취소) → h.onRename(id, 새 이름)
    el.addEventListener('dblclick', (e) => {
      const lb = e.target.closest?.('[data-lbl]'), n = lb?.closest('[data-node]'); if (!lb || !n || !el.contains(n)) return;
      e.preventDefault(); startRename(lb);
    });
    function startRename(lb) {
      const n = lb.closest('[data-node]'); B.editing = true;
      const old = lb.textContent, inp = el.ownerDocument.createElement('input');
      inp.className = 'm3-ren'; inp.value = old; inp.setAttribute('aria-label', '이름'); lb.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const end = (save) => { if (done) return; done = true; B.editing = false; const v = inp.value.trim(); B.html = null; if (save && v && v !== old) B.h?.onRename?.(n.dataset.node, v); else B.h?.onRedraw?.(); };
      inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') end(true); else if (k.key === 'Escape') end(false); });
      inp.addEventListener('blur', () => end(true));
    }
    el.addEventListener('keydown', (e) => { if ((e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') || !e.target.closest?.('[data-node]')) return; e.preventDefault(); fire(e); });
  }
  B.h = h; B.M = M; B.S = S;
  if (B.editing) return;   // 이름 고치는 중엔 다시 그리지 않음(입력칸 유지)
  const html = treeHtml(M, S, lay);
  if (html === B.html) return;
  B.html = html;
  const ae = el.ownerDocument?.activeElement, keep = ae && el.contains(ae) ? (ae.dataset?.eye != null ? `eye:${ae.dataset.eye}` : ae.dataset?.node) : null;   // 다시 그려도 키보드 초점 유지
  el.innerHTML = html;
  if (keep != null) (keep.startsWith('eye:') ? [...el.querySelectorAll('[data-eye]')].find((n) => `eye:${n.dataset.eye}` === keep) : [...el.querySelectorAll('[data-node]')].find((n) => n.dataset.node === keep))?.focus({ preventScroll: true });
}
