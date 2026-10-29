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
// 편집한 배치(STEP 에서 추가·삭제 = positions, 자동설계 균등 = count·pitch)를 그리지 못했으면(오류·메쉬 없음) 배지 '배치 편집 실패' · 개수 = 원래
// eye: 보기 켜기/끄기 단추 — 'on' | 'off' (부품·LED 노드), 'all' (부품 머리: 숨긴 부품이 있을 때 "모두 보기")
export function treeNodes(M, S, lay) {
  const L = M.light, O = M.observe, out = [], hid = new Set(S.hidden ?? []);
  const node = (id, label, badge, child = false, kind = '', eye) => out.push({ id, label, badge, child, kind, sel: S.node === id, eye });
  node('target', '◎ 목표', `${Math.round(O.targetLen * 100)}% / ${Math.round(O.targetWid * 100)}%`);   // 맨 위 — 무엇을 맞출지 먼저
  node('parts', '▾ 부품', String(M.parts.length), false, '', hid.size || S.hideLeds ? 'all' : undefined);
  // 도면에서 광원으로 옮긴 부품 = '→ 광원'(보기는 광원 그룹이 함) · 추적 제외 = '제외 ·' 접두
  M.parts.forEach((p, i) => node(`part:${i}`, p.name, p.role === 'light' ? '→ 광원' : `${p.untrace ? '제외 · ' : ''}${partBadge(p)}`, true, p.role === 'light' ? 'led' : p.untrace ? 'off' : p.material.kind, p.role === 'light' ? undefined : hid.has(i) ? 'off' : 'on'));
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
// 눈 단추 처리(순수): id = 'parts' | 'part:i' | 'leds', only = Shift(이 부품만) → { hidden, hideLeds }
export function toggleVisibility(id, only, nParts, hidden = [], hideLeds = false) {
  const h = new Set(hidden);
  if (id === 'parts') return { hidden: [], hideLeds: false };
  if (id === 'leds' || id === 'light') return only ? { hidden: [...Array(nParts).keys()], hideLeds: false } : { hidden: [...h], hideLeds: !hideLeds };
  const i = +id.slice(5);
  if (only) return { hidden: [...Array(nParts).keys()].filter((k) => k !== i), hideLeds: true };
  if (h.has(i)) h.delete(i); else h.add(i);
  return { hidden: [...h].sort((a, b) => a - b), hideLeds };
}
const BOUND = new WeakMap();   // el → { h, html }  (이벤트는 컨테이너에 한 번만 위임, 핸들러는 최신 것)
const EYE = { on: ['👁', '보기 끄기 (Shift+클릭: 이 부품만 보기)', 'true'], off: ['◌', '보기 켜기 (Shift+클릭: 이 부품만 보기)', 'false'], all: ['👁', '모두 보기', 'false'] };
const eyeHtml = (n) => n.eye ? `<span class="m3-eye ${n.eye}" role="button" tabindex="0" data-eye="${esc(n.id)}" title="${EYE[n.eye][1]}" aria-label="${esc(n.label)} ${EYE[n.eye][1]}" aria-pressed="${EYE[n.eye][2]}">${EYE[n.eye][0]}</span>` : '';
export const treeHtml = (M, S, lay) => `<div class="m3-h">피처 트리</div>${treeNodes(M, S, lay).map((n) => `<div class="m3-node ${n.child ? 'child' : ''} ${n.sel ? 'sel' : ''} ${n.eye === 'off' ? 'hid' : ''}" role="button" tabindex="0"${n.sel ? ' aria-current="true"' : ''} data-node="${esc(n.id)}">${eyeHtml(n)}${esc(n.label)} <span class="${n.child ? `m3-badge k-${esc(n.kind)}` : 'b'}">${esc(n.badge)}</span></div>`).join('')}`;
export function renderFeatureTree(el, M, S, h, lay) {
  let B = BOUND.get(el);
  if (!B) {
    B = { h, html: null }; BOUND.set(el, B);
    const fire = (e) => {
      const y = e.target.closest?.('[data-eye]');   // 눈 단추: 선택하지 않고 보기만 전환
      if (y && el.contains(y)) { e.stopPropagation?.(); B.h?.onEye?.(y.dataset.eye, !!e.shiftKey); return; }
      const n = e.target.closest?.('[data-node]'); if (n && el.contains(n)) B.h?.onNode?.(n.dataset.node);
    };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => { if ((e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') || !e.target.closest?.('[data-node]')) return; e.preventDefault(); fire(e); });
  }
  B.h = h;
  const html = treeHtml(M, S, lay);
  if (html === B.html) return;
  B.html = html;
  const ae = el.ownerDocument?.activeElement, keep = ae && el.contains(ae) ? (ae.dataset?.eye != null ? `eye:${ae.dataset.eye}` : ae.dataset?.node) : null;   // 다시 그려도 키보드 초점 유지
  el.innerHTML = html;
  if (keep != null) (keep.startsWith('eye:') ? [...el.querySelectorAll('[data-eye]')].find((n) => `eye:${n.dataset.eye}` === keep) : [...el.querySelectorAll('[data-node]')].find((n) => n.dataset.node === keep))?.focus({ preventScroll: true });
}
