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
    ${xformEditor(p, sel.xfInfo, sel.lock)}${sel.xfMsg ? `<div class="m3-warn" role="status">${esc(sel.xfMsg)}</div>` : ''}
    ${clearanceHtml(sel.clearance)}
    ${face != null ? `<div class="m3-sub">선택한 면 #${face}${p.faceFinish[face] ? ' · 덮어씀' : ''}</div>${finishRow(p.faceFinish[face] ?? null, 'face', true)}` : '<div class="mut">3D 뷰에서 면을 클릭하면 그 면만 다르게 지정할 수 있습니다</div>'}
  </div>`;
}

// 크기·위치 조절(순수). info = { center0, size0, lim } — center0·size0: 원본 외곽 중심·크기(mm),
// lim: app.js 가 여유(tol)를 뺀 가능 범위 { move: [[−,+]×3](현재에서 이동량), size: [최대 mm×3], uniform: 비율 고정 최대 배수 } | null
// key = 'c0..2'(중심 위치 mm) | 'z0..2'(크기 mm). 범위를 넘으면 한계값으로 맞춘다 → { xf(null = 원래대로), clamped }
export const MIN_SIZE = 0.05;
export function xformFromInput(xf, key, v, lock, info) {
  const o = [...(xf?.offset ?? [0, 0, 0])], s = [...(xf?.scale ?? [1, 1, 1])], k = +key[1], { center0: c0, size0: z0, lim } = info;
  if (!Number.isFinite(v)) return { xf: xf ?? null, clamped: false };
  let clamped = false;
  const clamp = (x, lo, hi) => { const y = Math.min(hi, Math.max(lo, x)); if (y !== x) clamped = true; return y; };
  if (key[0] === 'c') {
    const cur = c0[k] + o[k], m = lim?.move?.[k] ?? [-Infinity, Infinity];
    o[k] = +(clamp(v, cur + m[0], cur + m[1]) - c0[k]).toFixed(4);
  } else {
    const cur = z0[k] * s[k];
    if (lock) {
      const f = clamp(Math.max(MIN_SIZE, v) / cur, Math.max(...[0, 1, 2].map((j) => MIN_SIZE / (z0[j] * s[j]))), lim?.uniform ?? Infinity);
      for (let j = 0; j < 3; j++) s[j] = +(s[j] * f).toFixed(6);
    } else s[k] = +(clamp(Math.max(MIN_SIZE, v), MIN_SIZE, lim?.size?.[k] ?? Infinity) / z0[k]).toFixed(6);
    if (v < MIN_SIZE) clamped = true;
  }
  const xf2 = o.every((x) => x === 0) && s.every((x) => x === 1) ? null : { offset: o, scale: s };
  return { xf: xf2, clamped };
}
// 간격 표(순수) — c = app.js clearanceOf 결과: { rows, leds, ledMin, ledAxial }
export function clearanceHtml(c) {
  if (!c) return '';
  const mm = (v) => `${v.toFixed(2)} mm`;
  const row = (r) => `<div class="m3-gap ${r.depth > 0 ? 'bad' : r.gap <= 0.02 ? 'touch' : ''}"><span>${esc(r.name)}</span><b>${r.depth > 0 ? '간섭' : r.gap <= 0.02 ? '접촉' : mm(r.gap)}</b></div>`;
  const led = c.ledMin ? `<div class="m3-gap led"><span>LED 최소 거리 (LED ${c.ledMin.led + 1})</span><b>${mm(c.ledMin.dist)}</b></div>` : '';
  const ax = c.ledAxial ? `<div class="m3-gap led"><span>LED 축 방향 (LED ${c.ledAxial.led + 1})</span><b>${mm(c.ledAxial.dist)}</b></div>` : '';
  return `<div class="m3-sub">간격 <span class="mut">(20 mm 안 · 3D 하늘색 선)</span></div>
    <div class="m3-gaps">${c.rows.map(row).join('') || '<div class="mut">20 mm 안에 다른 부품 없음</div>'}${c.leds.map(row).join('')}${led}${ax}</div>`;
}
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
// 가능 범위 글자 — 무한은 '—'
const rangeText = (lo, hi) => `${Number.isFinite(lo) ? f2(lo) : '—'} ~ ${Number.isFinite(hi) ? f2(hi) : '—'}`;
export function xformEditor(p, info, lock = true) {
  const o = p.xform?.offset ?? [0, 0, 0], s = p.xform?.scale ?? [1, 1, 1], c0 = info?.center0 ?? [0, 0, 0], z0 = info?.size0 ?? p.size ?? [0, 0, 0], lim = info?.lim;
  const cen = [0, 1, 2].map((k) => c0[k] + o[k]), siz = [0, 1, 2].map((k) => z0[k] * s[k]);
  const cell = (key, v, lo, hi, label) => `<input type="number" step="0.1" value="${f2(v)}" data-m3-xf="${key}" aria-label="${label}"${Number.isFinite(lo) ? ` min="${f2(lo)}"` : ''}${Number.isFinite(hi) ? ` max="${f2(hi)}"` : ''}>`;
  const posLo = (k) => cen[k] + (lim?.move?.[k]?.[0] ?? -Infinity), posHi = (k) => cen[k] + (lim?.move?.[k]?.[1] ?? Infinity);
  const sizeHi = (k) => (lock ? siz[k] * (lim?.uniform ?? Infinity) : lim?.size?.[k] ?? Infinity);
  return `<div class="m3-sub">크기·위치 <span class="mut">(mm · 위치 = 부품 외곽 중심)</span></div>
    <div class="m3-xf">
      <span></span><b>X</b><b>Y</b><b>Z</b>
      <span>위치</span>${[0, 1, 2].map((k) => cell(`c${k}`, cen[k], posLo(k), posHi(k), `위치 ${'XYZ'[k]} mm`)).join('')}
      <span class="mut">가능</span>${[0, 1, 2].map((k) => `<span class="m3-lim">${lim ? rangeText(posLo(k), posHi(k)) : '계산 중'}</span>`).join('')}
      <span>크기</span>${[0, 1, 2].map((k) => cell(`z${k}`, siz[k], MIN_SIZE, sizeHi(k), `크기 ${'XYZ'[k]} mm`)).join('')}
      <span class="mut">최대</span>${[0, 1, 2].map((k) => `<span class="m3-lim">${lim ? (Number.isFinite(sizeHi(k)) ? f2(sizeHi(k)) : '—') : '계산 중'}</span>`).join('')}
    </div>
    <div class="m3-row"><label><input type="checkbox" data-m3-xflock ${lock ? 'checked' : ''}> 비율 고정</label>
      <button type="button" data-m3-xfreset ${p.xform ? '' : 'disabled'}>원래대로</button>
      <span class="mut">원본 ${z0.map((v) => v.toFixed(1)).join('×')}</span></div>`;
}

// 부품 노드 — sel = { part, face|null }, h = { onKind(part, kind), onMat(part, key, value), onFinish(part, face|null, finish|null) }
export function renderPartProps(el, m, sel0, dbList, h) {
  const sel = { ...sel0, lock: XF_LOCK.get(el.ownerDocument ?? XF_LOCK) ?? true };   // 비율 고정 선택은 다시 그려도 유지
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
  lock?.addEventListener('change', () => { XF_LOCK.set(el.ownerDocument ?? XF_LOCK, lock.checked); renderPartProps(el, m, sel, dbList, h); });   // 최대 크기 표시가 바뀜
  el.querySelectorAll('[data-m3-xf]').forEach((x) => {
    x.onchange = () => {
      if (!sel.xfInfo) return;
      const r = xformFromInput(p.xform, x.dataset.m3Xf, +x.value, lock?.checked, sel.xfInfo);
      h.onXform?.(i, r.xf, r.clamped ? '간섭이 생기는 값이라 가능한 한계값으로 맞췄습니다' : '');
    };
  });
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
