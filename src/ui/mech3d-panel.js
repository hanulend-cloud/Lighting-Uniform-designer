// 3D 기구 — 부품 속성(소재·면 처리·선택 면 덮어쓰기) · 접촉면 편집기 (spec 2026-10-14 §3, 2026-10-15 m3-cad-ui: 피처 트리 노드별).
// 상태는 갖지 않는다: m = spec.mech3d, sel = { part, face|null }, dbList = 실측소재 DB 목록, h = 이벤트 처리기.
import { PART_KINDS, FINISH_KINDS, RESIN_N, resolveFinish } from '../engine/mech3d/materials.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const XF_LOCK = new WeakMap();   // 패널 요소 → 비율 고정 체크(세션 동안)
const pct = (x) => Math.round(x * 1000) / 10;
const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label ?? k)}</option>`).join('');

function finishRow(f, scope, allowInherit) {
  const k = f ? FINISH_KINDS[f.kind] : null;
  return `<div class="m3-row"><select data-m3-finish="${scope}">
      ${allowInherit ? `<option value="" ${f ? '' : 'selected'}>부품 기본 따름</option>` : ''}${opts(FINISH_KINDS, f?.kind)}</select>
    ${k?.hasR ? `반사율 <input type="number" min="0" max="100" step="1" value="${esc(pct(f.R))}" data-m3-finishr="${scope}">%` : ''}</div>`;
}

function materialParams(mat, dbList) {
  const resin = `<select data-m3-mat="resin">${Object.keys(RESIN_N).map((r) => `<option ${r === mat.resin ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  switch (mat.kind) {
    case 'milky':
      return `<div class="m3-row">소재 <select data-m3-mat="dbId"><option value="">추상 Milky</option>${dbList.map((e) => `<option value="${esc(e.id)}" ${e.id === mat.dbId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        Milky <input type="number" min="0" max="10" step="0.1" value="${esc(mat.milky)}" data-m3-mat="milky"></div>`;
    case 'clear':
      return `<div class="m3-row">${resin} 투과율 <input type="number" min="1" max="100" step="1" value="${esc(pct(mat.T))}" data-m3-mat="T">% @ <input type="number" min="0.1" step="0.1" value="${esc(mat.tRef)}" data-m3-mat="tRef">mm</div>`;
    case 'whiteTrans':
      return `<div class="m3-row">${resin} 투과율 <input type="number" min="1" max="100" step="1" value="${esc(pct(mat.T))}" data-m3-mat="T">% @ <input type="number" min="0.1" step="0.1" value="${esc(mat.tRef)}" data-m3-mat="tRef">mm</div>`;
    default:
      return '';
  }
}

function partEditor(p, sel, dbList) {
  const face = sel.face;
  return `<div class="m3-edit">
    <div class="m3-sub">${esc(p.name)} — 부품 소재</div>
    <div class="m3-row"><select data-m3-kind>${opts(PART_KINDS, p.material.kind)}</select></div>
    ${materialParams(p.material, dbList)}
    <div class="m3-sub">면 처리 (부품 기본)</div>
    ${finishRow(p.finish, 'part', false)}
    ${xformEditor(p)}
    ${face != null ? `<div class="m3-sub">선택한 면 #${face}${p.faceFinish[face] ? ' · 덮어씀' : ''}</div>${finishRow(p.faceFinish[face] ?? null, 'face', true)}` : '<div class="mut">3D 뷰에서 면을 클릭하면 그 면만 다르게 지정할 수 있습니다</div>'}
  </div>`;
}

// 크기·위치 조절(순수): 입력 하나를 바꾼 새 xform. key = 'o0..2'(이동 mm) | 's0..2'(배율), lock = 비율 고정
export function nextXform(xf, key, v, lock) {
  const o = [...(xf?.offset ?? [0, 0, 0])], s = [...(xf?.scale ?? [1, 1, 1])], k = +key[1];
  if (!Number.isFinite(v)) return xf ?? null;
  if (key[0] === 'o') o[k] = v;
  else {
    const nv = Math.min(10, Math.max(0.1, v));
    if (lock) { const r = nv / s[k]; for (let j = 0; j < 3; j++) s[j] = Math.min(10, Math.max(0.1, +(s[j] * r).toFixed(4))); s[k] = nv; } else s[k] = nv;
  }
  return o.every((x) => x === 0) && s.every((x) => x === 1) ? null : { offset: o, scale: s };
}
function xformEditor(p) {
  const o = p.xform?.offset ?? [0, 0, 0], s = p.xform?.scale ?? [1, 1, 1], sz = p.size ?? [0, 0, 0];
  const cell = (key, v, step) => `<input type="number" step="${step}" value="${esc(+v.toFixed(4))}" data-m3-xf="${key}" aria-label="${key[0] === 'o' ? '이동' : '배율'} ${'XYZ'[+key[1]]}">`;
  return `<div class="m3-sub">크기·위치 <span class="mut">(원본 외곽 중심 기준)</span></div>
    <div class="m3-xf">
      <span></span><b>X</b><b>Y</b><b>Z</b>
      <span>이동 mm</span>${[0, 1, 2].map((k) => cell(`o${k}`, o[k], 0.1)).join('')}
      <span>배율</span>${[0, 1, 2].map((k) => cell(`s${k}`, s[k], 0.05)).join('')}
      <span>크기 mm</span>${[0, 1, 2].map((k) => `<span class="mut">${(sz[k] * s[k]).toFixed(1)}</span>`).join('')}
    </div>
    <div class="m3-row"><label><input type="checkbox" data-m3-xflock checked> 비율 고정</label>
      <button type="button" data-m3-xfreset ${p.xform ? '' : 'disabled'}>원래대로</button></div>`;
}

// 부품 노드 — sel = { part, face|null }, h = { onKind(part, kind), onMat(part, key, value), onFinish(part, face|null, finish|null) }
export function renderPartProps(el, m, sel, dbList, h) {
  const p = m.parts[sel.part];
  if (!p) { el.innerHTML = '<div class="mut">부품을 찾을 수 없음</div>'; return; }
  const sc = p.xform?.scale ?? [1, 1, 1];
  el.innerHTML = `<div class="m3-h">속성 · ${esc(p.name)} <span class="mut">${(p.size ?? []).map((v, k) => (v * sc[k]).toFixed(1)).join('×')}mm · ${((p.volume ?? 0) * sc[0] * sc[1] * sc[2]).toFixed(0)} mm³</span></div>${partEditor(p, sel, dbList)}`;
  const i = sel.part;
  el.querySelector('[data-m3-kind]').onchange = (e) => h.onKind(i, e.target.value);
  el.querySelectorAll('[data-m3-mat]').forEach((x) => {
    x.onchange = () => {
      const k = x.dataset.m3Mat;
      let v = x.value;
      if (k === 'T') v = Math.min(1, Math.max(0.01, +x.value / 100));
      else if (k === 'milky') v = Math.min(10, Math.max(0, +x.value));
      else if (k === 'tRef') v = Math.max(0.1, +x.value);
      if (typeof v === 'number' && Number.isNaN(v)) return;
      h.onMat(i, k, v);
    };
  });
  const lock = el.querySelector('[data-m3-xflock]');
  if (lock) lock.checked = XF_LOCK.get(el) ?? true;   // 다시 그려도 비율 고정 선택 유지
  lock?.addEventListener('change', () => XF_LOCK.set(el, lock.checked));
  el.querySelectorAll('[data-m3-xf]').forEach((x) => { x.onchange = () => h.onXform?.(i, nextXform(p.xform, x.dataset.m3Xf, +x.value, lock?.checked)); });
  const rs = el.querySelector('[data-m3-xfreset]');
  if (rs) rs.onclick = () => h.onXform?.(i, null);
  el.querySelectorAll('[data-m3-finish]').forEach((x) => {
    x.onchange = () => {
      const face = x.dataset.m3Finish === 'face' ? sel.face : null;
      const k = x.value;
      h.onFinish(i, face, k ? (FINISH_KINDS[k].hasR ? { kind: k, R: FINISH_KINDS[k].R } : { kind: k }) : null);
    };
  });
  el.querySelectorAll('[data-m3-finishr]').forEach((x) => {
    x.onchange = () => {
      const face = x.dataset.m3Finishr === 'face' ? sel.face : null;
      if (Number.isNaN(+x.value)) return;
      const cur = face == null ? p.finish : resolveFinish(p, face);
      h.onFinish(i, face, { ...cur, R: Math.min(1, Math.max(0, +x.value / 100)) });
    };
  });
}

// 접촉면 노드 — h = { onContact(i, 'contact'|'air') }
export function renderContactsProps(el, m, h) {
  el.innerHTML = `<div class="m3-h">속성 · 접촉면 <span class="mut">(체크 = 공기층 없음, 이중사출·접착)</span></div>
    <div class="m3-contacts">${m.contacts.length ? m.contacts.map((c, i) => `<label><input type="checkbox" data-m3-contact="${i}" ${c.mode === 'contact' ? 'checked' : ''}>
      ${esc(m.parts[c.a]?.name ?? '?')} ↔ ${esc(m.parts[c.b]?.name ?? '?')} · ${(c.area ?? 0).toFixed(1)} mm²</label>`).join('') : '<div class="mut">감지된 접촉면 없음</div>'}</div>`;
  el.querySelectorAll('[data-m3-contact]').forEach((c) => { c.onchange = () => h.onContact(+c.dataset.m3Contact, c.checked ? 'contact' : 'air'); });
}
