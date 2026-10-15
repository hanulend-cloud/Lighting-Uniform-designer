// 피처 트리 — spec 2026-10-15 m3-cad-ui §2: 부품(소재 배지) · 광원(LED 개수·피치) · 관측면(라인 종류·길이·폭) · 목표 · 접촉면.
// 노드 id: 'parts' | 'part:i' | 'light' | 'leds' | 'obs' | 'target' | 'contacts'. 클릭 → h.onNode(id)
import { PART_KINDS } from '../../engine/mech3d/materials.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const LINE_KIND = { line: '직선', circle: '원', path: '곡선' };
export function partBadge(p) {
  const m = p.material, lab = PART_KINDS[m?.kind]?.label ?? '?';
  if (m.kind === 'milky') return `${lab} ${(+m.milky).toFixed(1)}`;
  if (m.kind === 'clear' || m.kind === 'whiteTrans') return `${lab} ${Math.round(m.T * 100)}%`;
  return p.finish?.R != null ? `${lab} ${Math.round(p.finish.R * 100)}%` : lab;
}
// M = spec.mech3d, S = store.session → [{ id, label, badge, child, kind, sel }]
export function treeNodes(M, S) {
  const L = M.light, O = M.observe, out = [];
  const node = (id, label, badge, child = false, kind = '') => out.push({ id, label, badge, child, kind, sel: S.node === id });
  node('parts', '▾ 부품', String(M.parts.length));
  M.parts.forEach((p, i) => node(`part:${i}`, p.name, partBadge(p), true, p.material.kind));
  node('light', '▾ 광원', { none: '지정 안 함', step: 'LED STEP', manual: '직접 배치' }[L.kind]);
  if (L.kind !== 'none') {
    const ex = L.step?.excluded ?? [], n = L.kind === 'step' ? (L.step?.leds ?? []).filter((i) => !ex.includes(i)).length : L.manual.count;
    node('leds', `LED ×${n}`, L.kind === 'manual' ? (L.manual.pitch > 0 ? `피치 ${+(+L.manual.pitch).toFixed(1)}` : '균등') : `${L.spec.beam}°`, true, 'led');
  }
  const ln = S.line;
  node('obs', '▾ 관측면', ln ? `${LINE_KIND[ln.kind] ?? ln.kind} ${ln.length.toFixed(0)}×${ln.width.toFixed(0)}` : O.faces.length ? '인식 중' : '미지정');
  node('target', '◎ 목표', `${O.targetLen.toFixed(2)} / ${O.targetWid.toFixed(2)}`);
  node('contacts', '접촉면', String(M.contacts.length));
  return out;
}
export function renderFeatureTree(el, M, S, h) {
  el.innerHTML = `<div class="m3-h">피처 트리</div>${treeNodes(M, S).map((n) => `<div class="m3-node ${n.child ? 'child' : ''} ${n.sel ? 'sel' : ''}" data-node="${esc(n.id)}">${esc(n.label)} <span class="${n.child ? `m3-badge k-${n.kind}` : 'b'}">${esc(n.badge)}</span></div>`).join('')}`;
  el.querySelectorAll('[data-node]').forEach((d) => { d.onclick = () => h.onNode(d.dataset.node); });
}
