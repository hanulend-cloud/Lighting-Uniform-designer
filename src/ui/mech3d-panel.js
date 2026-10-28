// 3D 기구 — 부품 속성(소재·면 처리·선택 면 덮어쓰기) · 접촉면 편집기 (spec 2026-10-14 §3, 2026-10-15 m3-cad-ui: 피처 트리 노드별).
// 상태는 갖지 않는다: m = spec.mech3d, sel = { part, face|null }, dbList = 실측소재 DB 목록, h = 이벤트 처리기.
import { PART_KINDS, FINISH_KINDS, RESIN_N, CLEAR_BASE, materialN, resolveFinish, setPartMaterial, setPartMaterialParam } from '../engine/mech3d/materials.js';
import { bounds, meshVolume } from '../engine/mech3d/mesh.js';
import { DEFAULT_FINISH_CATALOG, finishLimit } from '../engine/mech3d/housing-led.js';
import { MEAS_CONDS, reflStatusText, REFLECT_KINDS } from '../model/reflect-db.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const XF_LOCK = new WeakMap();   // 패널 요소 → 비율 고정 체크(세션 동안)
const REFL_FORM = new WeakMap();   // 패널 요소 → 반사 소재 추가 양식 { open, msg }
const CLEAR_FORM = new WeakMap();   // 패널 요소 → 투명 소재 측정값 양식 { addOpen, msg, part }
// 접는 구역(<details>) 열림 상태 — 세션 동안 구역 id 별로 기억(패널은 innerHTML 로 자주 다시 그려짐)
const SEC_OPEN = new Map();
let SEC_FACE = null;   // 마지막으로 본 선택 면('부품:면') — 새 면이 선택되면 '면 처리' 구역을 자동으로 연다
export const sectionOpen = (id) => SEC_OPEN.get(id) === true;
export function resetSections() { SEC_OPEN.clear(); SEC_FACE = null; PART_TAB = 'basic'; }
// 접는 구역 열림 기억 연결(다른 패널에서도 같은 모양·기억 — LED 속성 창)
export const wireSections = (el) => el.querySelectorAll('details[data-m3-sec]').forEach((d) => d.addEventListener('toggle', () => SEC_OPEN.set(d.dataset.m3Sec, d.open)));
export const secHtml = (id, title, summary, body) => `<details class="m3-sec" data-m3-sec="${id}"${sectionOpen(id) ? ' open' : ''}><summary><span class="m3-sec-t">${title}</span>${summary ? ` <span class="m3-sec-s">${summary}</span>` : ''}</summary><div class="m3-sec-b">${body}</div></details>`;
// 부품 속성 탭 — 'basic'(기본: 소재 고르기·측정값 입력·위치·크기) | 'detail'(상세: 면별 처리·가능 범위·접촉면·반사 소재 DB 관리). 세션 동안 기억
let PART_TAB = 'basic';
export const partTab = () => PART_TAB;
export function setPartTab(t) { PART_TAB = t === 'detail' ? 'detail' : 'basic'; }
const n1 = (v) => String(+(+v).toFixed(1));
const pct = (x) => Math.round(x * 1000) / 10;
const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label ?? k)}</option>`).join('');

// lim = 반사율 상한 { kind, max, entry } | null — 같은 종류일 때 R 칸 옆에 표시
function finishRow(f, scope, allowInherit, lim = null) {
  const k = f ? FINISH_KINDS[f.kind] : null, limTxt = lim && k?.hasR && f.kind === lim.kind ? ` <span class="mut">${lim.entry.special ? '특수 처리' : '소재'} 상한 ${pct(lim.max)}%</span>` : '';
  return `<div class="m3-row"><select data-m3-finish="${scope}" aria-label="${scope === 'face' ? '선택한 면' : '부품 기본'} 면 처리 종류">
      ${allowInherit ? `<option value="" ${f ? '' : 'selected'}>부품 기본 따름</option>` : ''}${opts(FINISH_KINDS, f?.kind)}</select>
    ${k?.hasR ? `반사율 <input type="number" min="0" max="100" step="1" value="${esc(pct(f.R))}" data-m3-finishr="${scope}" aria-label="반사율 %">%${limTxt}` : ''}</div>`;
}

// 투과 부품: 실측 맞춤 대화상자(평판 모드 l2-advanced) 열기 — spec P4 §2.3e
const FIT_BTN = '<button type="button" class="m3-link" data-m3-fitdlg title="BSDF(BTDF 각분포)·투과율·Haze 측정값 → 피팅 → 실측소재 DB 저장 → 이 부품에 적용">＋ BSDF 측정값</button>';
// 소재 종류 = 4 단추 분할 컨트롤(aria-pressed)
export function kindSegHtml(kind) {
  return `<div class="m3-seg" role="group" aria-label="부품 소재 종류">${Object.entries(PART_KINDS).map(([k, v]) => `<button type="button" data-m3-kind="${k}" aria-pressed="${k === kind ? 'true' : 'false'}">${esc(v.label)}</button>`).join('')}</div>`;
}
// 수지(바탕 소재) 고르기 — 굴절률을 함께 보임
const resinSel = (cur) => `<select data-m3-mat="resin" aria-label="수지">${CLEAR_BASE.map((e) => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>${esc(e.id)} · n ${e.n}</option>`).join('')}</select>`;
// 투명 소재 측정값 등록 양식(순수) — 굴절률·투과율(측정 두께) → 사용자 항목 등록하고 적용
export function clearAddFormHtml(msg = '') {
  return `<div class="m3-edit m3-refladd">
    <div class="m3-row"><label>이름</label><input data-m3-ca="name" placeholder="예: 사내 PC 2405"></div>
    <div class="m3-row"><label>바탕 수지</label><select data-m3-ca="base">${CLEAR_BASE.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></div>
    <div class="m3-row"><label>굴절률</label><input type="number" min="1.2" max="2.5" step="0.001" data-m3-ca="n" placeholder="빈칸 = 수지 값" aria-label="측정 굴절률"></div>
    <div class="m3-row"><label>투과율</label><input type="number" min="1" max="100" step="0.1" data-m3-ca="T" aria-label="측정 전광선 투과율 %"> % <label class="mut">두께</label><input type="number" min="0.1" step="0.1" value="2" data-m3-ca="t" aria-label="측정 두께 mm"> mm</div>
    <div class="m3-row"><label>메모</label><input data-m3-ca="note" placeholder="측정 장비·파장 등"></div>
    ${msg ? `<div class="m3-warn" role="status">${esc(msg)}</div>` : ''}
    <div class="m3-row"><button data-m3-caok>등록하고 적용</button><button data-m3-cacancel>취소</button></div></div>`;
}
// 투명 소재 측정값 DB 관리(순수, 상세 탭) — 칸을 바로 고침(바뀌면 그 소재를 쓰는 부품에 반영) · 삭제(쓰던 부품은 바탕 수지 기본값으로)
// used = { id: 쓰는 부품 수 }
export function clearDbHtml(list, used = {}) {
  if (!list.length) return '<div class="mut">등록한 측정값 없음 — 기본 탭의 [＋ 측정값 (굴절률·투과율)] 로 등록</div>';
  const row = (e) => `<div class="m3-cdb" data-m3-cdb="${esc(e.id)}">
    <div class="m3-row"><input data-m3-cdbk="name" value="${esc(e.name)}" aria-label="이름"><span class="mut">${used[e.id] ? `부품 ${used[e.id]}개 사용` : '미사용'}</span><button type="button" class="m3-link" data-m3-cdbdel="${esc(e.id)}">삭제</button></div>
    <div class="m3-row"><label>굴절률</label><input type="number" min="1.2" max="2.5" step="0.001" value="${esc(e.n)}" data-m3-cdbk="n" aria-label="굴절률"> <label class="mut">바탕</label><select data-m3-cdbk="base" aria-label="바탕 수지">${CLEAR_BASE.map((b) => `<option value="${b.id}"${b.id === e.base ? ' selected' : ''}>${esc(b.id)}</option>`).join('')}</select></div>
    <div class="m3-row"><label>투과율</label><input type="number" min="1" max="100" step="0.1" value="${esc(pct(e.T))}" data-m3-cdbk="T" aria-label="투과율 %">% <label class="mut">두께</label><input type="number" min="0.1" step="0.1" value="${esc(e.tRef)}" data-m3-cdbk="tRef" aria-label="측정 두께 mm"> mm</div>
    <div class="m3-row"><label>메모</label><input data-m3-cdbk="note" value="${esc(e.note ?? '')}" aria-label="메모"></div></div>`;
  return `<div class="mut m3-note">고치면 그 소재를 쓰는 부품에 바로 반영 · 모든 프로젝트 공용(이 브라우저)</div>${list.map(row).join('')}`;
}
// 투명 소재 고르기(순수) — 기본(일반값: 굴절률·투과율) / 측정(사용자) 그룹. 값 = 기본 수지 id | 사용자 id(u:…)
function clearSelHtml(mat, user) {
  const cur = mat.matId && user.some((e) => e.id === mat.matId) ? mat.matId : mat.resin;
  const opt = (e) => `<option value="${esc(e.id)}"${e.id === cur ? ' selected' : ''}>${esc(e.name)} · n ${e.n} · ${pct(e.T)}%</option>`;
  return `<select data-m3-clear aria-label="투명 소재"><optgroup label="기본 (일반값)">${CLEAR_BASE.map(opt).join('')}</optgroup>${user.length ? `<optgroup label="측정값 (사용자)">${user.map(opt).join('')}</optgroup>` : ''}${mat.matId && !user.some((e) => e.id === mat.matId) ? `<option value="" selected>없는 측정 소재 — 다시 고르세요</option>` : ''}</select>`;
}
// 기본 탭 소재(순수) — 소재 고르기와 측정값 입력은 모두 여기서(상세 탭에는 면별 처리·DB 관리만)
// Milky: 확산 값 · 실측 소재(BSDF 피팅) · 수지 · ＋ BSDF 측정값 / 투명: 소재(굴절률별 기본 DB·측정값) · 투과율 · ＋ 측정값 / 반투과 백색: 투과율 · 수지 / 불투명: 반사 소재 · 반사율 · ＋ 측정값
function basicMaterialHtml(p, dbList, catalog, sel = {}) {
  const mat = p.material;
  switch (mat.kind) {
    case 'milky': {
      const db = mat.dbId ? dbList.find((e) => e.id === mat.dbId) : null;
      return `<div class="m3-row"><label>확산 (Milky)</label><input type="number" min="0" max="10" step="0.1" value="${esc(mat.milky)}" data-m3-mat="milky" aria-label="Milky 값"> <span class="mut">높을수록 고르게 · 어두워짐</span></div>
        <div class="m3-row"><label>실측 소재</label><select data-m3-mat="dbId" aria-label="실측 소재(BSDF 피팅)"><option value="">없음 (추상 Milky)</option>${dbList.map((e) => `<option value="${esc(e.id)}" ${e.id === mat.dbId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        ${db ? `<div class="mut m3-note">굴절률 n ${esc(db.n)} · 산란 각분포는 측정값 피팅 — 확산 값은 농도처럼 조절</div>` : `<div class="m3-row"><label>수지</label>${resinSel(mat.resin)}</div>`}
        <div class="m3-links">${FIT_BTN}</div>`;
    }
    case 'clear': {
      const user = sel.clearList ?? [], f = CLEAR_FORM.get(sel.formEl ?? CLEAR_FORM);
      const open = f?.addOpen && f.part === sel.part;
      return `<div class="m3-row"><label>소재</label>${clearSelHtml(mat, user)}</div>
        <div class="m3-row"><label>굴절률</label><b>${materialN(mat)}</b>${Number.isFinite(mat.n) ? ' <span class="mut">측정값</span>' : ''}</div>
        <div class="m3-row"><label>투과율</label><input type="number" min="1" max="100" step="0.1" value="${esc(pct(mat.T))}" data-m3-mat="T" aria-label="투과율 %">% <span class="mut">두께</span><input type="number" min="0.1" step="0.1" value="${esc(mat.tRef)}" data-m3-mat="tRef" aria-label="투과율을 잰 두께 mm"> mm</div>
        <div class="m3-links"><button type="button" class="m3-link" data-m3-clearadd aria-expanded="${open ? 'true' : 'false'}" title="측정한 굴절률·투과율로 사용자 소재를 만들고 이 부품에 적용">＋ 측정값 (굴절률·투과율)</button></div>
        ${open ? clearAddFormHtml(f.msg) : ''}`;
    }
    case 'whiteTrans':
      return `<div class="m3-row"><label>투과율</label><input type="number" min="1" max="100" step="1" value="${esc(pct(mat.T))}" data-m3-mat="T" aria-label="투과율 %">% <span class="mut">두께</span><input type="number" min="0.1" step="0.1" value="${esc(mat.tRef)}" data-m3-mat="tRef" aria-label="투과율을 잰 두께 mm"> mm</div>
        <div class="m3-row"><label>수지</label>${resinSel(mat.resin)}</div>`;
    case 'opaque':
      return reflRowHtml(p, catalog, sel.reflForm ?? {});
    default: return '';
  }
}
// 실측소재 DB 항목을 투과 부품에 적용(순수) — Milky 가 아니면 Milky 로 바꾼 뒤 dbId(Milky 값은 app.js 가 피팅값으로)
export function partToDbMaterial(p, id) {
  const q = p.material?.kind === 'milky' ? p : setPartMaterial(p, 'milky');
  return setPartMaterialParam(q, 'dbId', id);
}

// 반사 소재(spec P4 §2.3d·§2.3e) — 불투명 부품만. 목록 = 반사 소재 DB(기본 / 사용자 그룹, 상태). 특수 처리는 자동설계 ④ 에서만(여기선 표시)
// form = { addOpen, msg } — [＋ 측정값으로 소재 추가] 인라인 양식
export function reflAddFormHtml(msg = '') {
  return `<div class="m3-edit m3-refladd">
    <div class="m3-row"><label>이름</label><input data-m3-ra="name" placeholder="예: 사내 백색 PC"></div>
    <div class="m3-row"><label>종류</label><select data-m3-ra="kind">${Object.entries(REFLECT_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="m3-row"><label>측정 반사율</label><input data-m3-ra="values" placeholder="85.5, 86.1, 85.8" aria-label="측정 반사율 %(쉼표로 여러 값)"> %</div>
    <div class="m3-row"><label>측정 조건</label><select data-m3-ra="cond">${MEAS_CONDS.map((c) => `<option>${c}</option>`).join('')}</select></div>
    <div class="m3-row"><label>메모</label><input data-m3-ra="note"></div>
    <div class="m3-row"><label>상한</label><input type="number" min="0" max="100" step="0.1" data-m3-ra="max" placeholder="측정 최대" aria-label="상한 %(빈칸 = 측정 최대)"> %</div>
    ${msg ? `<div class="m3-warn" role="status">${esc(msg)}</div>` : ''}
    <div class="m3-row"><button data-m3-raok>등록하고 적용</button><button data-m3-racancel>취소</button></div></div>`;
}
export function reflRowHtml(p, catalog = DEFAULT_FINISH_CATALOG, form = {}) {
  if (p.material?.kind !== 'opaque') return '';
  const coat = catalog.find((e) => e.id === p.coating && e.special), plain = catalog.filter((e) => !e.special);
  const cur = p.reflMaterial ? plain.find((e) => e.id === p.reflMaterial) : null, missing = p.reflMaterial && !cur;
  const opt = (e) => { const st = reflStatusText(e); return `<option value="${esc(e.id)}"${e.id === p.reflMaterial ? ' selected' : ''}>${esc(e.name)}${st ? ` · ${st}` : ''}</option>`; };
  const grp = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(opt).join('')}</optgroup>` : '');
  const base = plain.filter((e) => e.origin !== 'user'), user = plain.filter((e) => e.origin === 'user');
  const f = p.finish, fk = f ? FINISH_KINDS[f.kind] : null, lim = finishLimit(p, catalog);
  const rIn = fk?.hasR ? ` 반사율 <input type="number" min="0" max="100" step="1" value="${esc(pct(f.R))}" data-m3-finishr="part" aria-label="반사율 %">%${lim && f.kind === lim.kind ? ` <span class="mut">${lim.entry.special ? '특수 ' : ''}상한 ${pct(lim.max)}%</span>` : ''}` : '';
  return `<div class="m3-row"><label>반사 소재</label><select data-m3-refl aria-label="반사 소재"><option value=""${p.reflMaterial ? '' : ' selected'}>— 미지정 —</option>${missing ? `<option value="${esc(p.reflMaterial)}" selected>없는 소재(${esc(p.reflMaterial)}) — 다시 고르세요</option>` : ''}${grp('기본', base)}${grp('사용자', user)}</select>${rIn}${coat ? ` <span class="mut">특수: ${esc(coat.name)}</span>` : ''}</div>
    <div class="m3-links">${cur && cur.origin !== 'user' ? '<button type="button" class="m3-link" data-m3-reflcopy title="공용 항목은 고칠 수 없어 사용자 사본을 만들고 이 부품을 그 사본으로">복사해서 수정</button>' : ''}<button type="button" class="m3-link" data-m3-refladd aria-expanded="${form.addOpen ? 'true' : 'false'}" title="측정한 반사율로 사용자 소재를 만들고 이 부품에 적용">＋ 측정값</button></div>
    ${form.addOpen ? reflAddFormHtml(form.msg) : ''}`;
}

// 겹침 경고(순수) — 다른 부품·LED 와 겹칠 때만(간격·접촉은 문제가 아니므로 표시 안 함)
export function overlapWarnHtml(c) {
  const bad = c ? [...c.rows, ...(c.leds ?? [])].filter((r) => r.depth > 0) : [];
  return bad.length ? `<div class="m3-clash" role="alert">⚠ ${bad.map((r) => `${esc(r.name)}과 ${r.depth.toFixed(2)} mm 겹침`).join(' · ')} — 위치·크기를 고치세요</div>` : '';
}
// LED 까지 거리 한 줄(순수, 기본 탭) — 이 부품에서 가장 가까운 LED 발광점까지 · 축 방향(LED 가 비추는 방향) 거리. 가까우면 LED 위가 밝게 보이는 핫스팟
export function ledDistHtml(c) {
  if (!c?.ledMin) return '';
  const ax = c.ledAxial ? ` · 축 방향 <b>${n1(c.ledAxial.dist)} mm</b>` : '';
  return `<div class="m3-clr" title="가까울수록 LED 바로 위가 밝게 보이기 쉬움(핫스팟) · 멀수록 고르지만 어두워짐">LED까지 <b class="led">${n1(c.ledMin.dist)} mm</b> <span class="mut">(LED ${c.ledMin.led + 1})</span>${ax}</div>`;
}

// 크기·위치 구역 요약 — 위치(외곽 중심)·크기 mm, 형상 변경 표시
export function xfSummaryText(p, info) {
  const o = p.xform?.offset ?? [0, 0, 0], s = p.xform?.scale ?? [1, 1, 1], z0 = info?.size0 ?? p.size ?? [0, 0, 0];
  const pos = info?.center0 ? `위치 ${info.center0.map((c, k) => n1(c + o[k])).join(', ')} · ` : '';
  return `${pos}크기 ${z0.map((v, k) => n1(v * s[k])).join('×')}${p.shapeMod ? ' · 형상 변경됨' : ''}`;
}

// 추적 제외(untrace) 스위치 — 부품은 남기고 빛 계산에서만 뺌. 도면에서 광원으로 옮긴 부품은 안내만
export function untraceHtml(p) {
  if (p.role === 'light') return '<div class="m3-card m3-untrace on"><b>광원으로 사용 중</b> <span class="mut">이 부품은 광원 그룹으로 옮겨져 계산함 — 해제는 광원 노드에서</span></div>';
  return `<div class="m3-card m3-untrace${p.untrace ? ' on' : ''}"><label class="m3-sw"><input type="checkbox" data-m3-untrace${p.untrace ? ' checked' : ''}> 빛 계산에서 제외 <span class="mut">(삭제 아님 — 빛이 이 부품을 그냥 지나감)</span></label></div>`;
}
function partEditor(p, sel, dbList) {
  const face = sel.face, cat = sel.catalog ?? DEFAULT_FINISH_CATALOG, lim = finishLimit(p, cat), opaque = p.material.kind === 'opaque', tab = PART_TAB;
  // 면 처리(상세): 불투명 + 반사 소재 지정 → 종류는 소재가 정함 · 미지정 → 종류만 · 투과 부품 → 종류·반사율
  const partFin = !opaque ? finishRow(p.finish, 'part', false, lim)
    : p.reflMaterial ? '<div class="mut m3-note">면 처리 종류는 반사 소재가 정함(기본 탭)</div>' : `<div class="m3-row"><span class="mut">부품 기본</span><select data-m3-finish="part" aria-label="부품 기본 면 처리 종류">${opts(FINISH_KINDS, p.finish?.kind)}</select></div>`;
  const faceRow = face != null ? `<div class="m3-row"><span class="mut">선택한 면 #${face}${p.faceFinish[face] ? ' · 덮어씀' : ''}</span></div>${finishRow(p.faceFinish[face] ?? null, 'face', true, lim)}` : '';
  const nOver = Object.keys(p.faceFinish ?? {}).length;
  const dSum = [nOver ? `면 ${nOver}개 별도` : '', p.shapeMod ? '형상 변경됨' : '', p.coating ? '특수 처리' : ''].filter(Boolean).join(' · ');
  const tabs = `<div class="m3-tabs" role="tablist" aria-label="부품 속성">
    <button type="button" role="tab" data-m3-tab="basic" aria-selected="${tab === 'basic'}">기본</button>
    <button type="button" role="tab" data-m3-tab="detail" aria-selected="${tab === 'detail'}">상세${dSum ? ` <span class="m3-tab-s">${esc(dSum)}</span>` : ''}</button></div>`;
  const warn = `${overlapWarnHtml(sel.clearance)}${sel.xfMsg ? `<div class="m3-warn" role="status">${esc(sel.xfMsg)}</div>` : ''}`;
  const body = tab === 'basic'
    ? `${untraceHtml(p)}<div class="m3-card">${kindSegHtml(p.material.kind)}${basicMaterialHtml(p, dbList, cat, sel)}</div>
      <div class="m3-card"><div class="m3-sub">위치 · 크기 <span class="mut">mm</span></div>${xformEditor(p, sel.xfInfo, false, true)}${ledDistHtml(sel.clearance)}</div>`
    : `${secHtml('finish', '면 처리 (면별)', face != null ? `면 #${face} 선택` : nOver ? `면 ${nOver}개 덮어씀` : '', `${partFin}${faceRow}<div class="mut m3-note">3D 뷰에서 면을 클릭하면 그 면만 다르게 지정할 수 있습니다</div>`)}
      ${secHtml('xf', '크기·위치 상세 (가능 범위 · 비율 고정)', esc(xfSummaryText(p, sel.xfInfo)), xformEditor(p, sel.xfInfo, sel.lock))}
      ${secHtml('contact', '접촉면 (이 부품)', '', contactsForPartHtml(sel.contacts ?? [], sel.part, sel.names ?? []))}
      ${opaque ? secHtml('refldb', '반사 소재 DB (측정값 등록·관리)', '', '<div data-m3-refldb></div>') : ''}
      ${p.material.kind === 'clear' ? secHtml('cleardb', '투명 소재 측정값 DB (편집·삭제)', (sel.clearList ?? []).length ? `${sel.clearList.length}개` : '', clearDbHtml(sel.clearList ?? [], sel.clearUsed ?? {})) : ''}`;
  return `${warn}${tabs}<div class="m3-edit" role="tabpanel">${body}</div>`;
}

// 이 부품의 접촉면(순수) — 체크 = 공기층 없음(이중사출·접착). 번호 = 전체 접촉면 목록 위치
export function contactsForPartHtml(contacts, part, names) {
  const mine = contacts.map((c, i) => [c, i]).filter(([c]) => c.a === part || c.b === part);
  if (!mine.length) return '<div class="mut">이 부품에 닿은 다른 부품 없음</div>';
  return `<div class="mut m3-note">체크 = 공기층 없이 붙음(이중사출·접착)</div><div class="m3-contacts">${mine.map(([c, i]) => `<label><input type="checkbox" data-m3-contact="${i}" ${c.mode === 'contact' ? 'checked' : ''}> ${esc(names[c.a === part ? c.b : c.a] ?? '?')} · ${(c.area ?? 0).toFixed(1)} mm²</label>`).join('')}</div>`;
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
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
// 가능 범위 글자 — 무한은 '—'
const rangeText = (lo, hi) => `${Number.isFinite(lo) ? f2(lo) : '—'} ~ ${Number.isFinite(hi) ? f2(hi) : '—'}`;
// simple = 기본 탭: 위치·크기 숫자만(간섭 없는 범위는 입력이 자동으로 맞춤) + 원래대로. 가능 범위 표·비율 고정은 상세 탭
export function xformEditor(p, info, lock = false, simple = false) {
  const o = p.xform?.offset ?? [0, 0, 0], s = p.xform?.scale ?? [1, 1, 1], c0 = info?.center0 ?? [0, 0, 0], z0 = info?.size0 ?? p.size ?? [0, 0, 0], lim = info?.lim;
  const cen = [0, 1, 2].map((k) => c0[k] + o[k]), siz = [0, 1, 2].map((k) => z0[k] * s[k]);
  const cell = (key, v, lo, hi, label) => `<input type="number" step="0.1" value="${f2(v)}" data-m3-xf="${key}" aria-label="${label}"${Number.isFinite(lo) ? ` min="${f2(lo)}"` : ''}${Number.isFinite(hi) ? ` max="${f2(hi)}"` : ''}>`;
  const posLo = (k) => cen[k] + (lim?.move?.[k]?.[0] ?? -Infinity), posHi = (k) => cen[k] + (lim?.move?.[k]?.[1] ?? Infinity);
  const sizeHi = (k) => (lock ? siz[k] * (lim?.uniform ?? Infinity) : lim?.size?.[k] ?? Infinity);
  if (simple) return `<div class="m3-xf">
      <span></span><b>X</b><b>Y</b><b>Z</b>
      <span>위치</span>${[0, 1, 2].map((k) => cell(`c${k}`, cen[k], posLo(k), posHi(k), `위치 ${'XYZ'[k]} mm`)).join('')}
      <span>크기</span>${[0, 1, 2].map((k) => cell(`z${k}`, siz[k], MIN_SIZE, sizeHi(k), `크기 ${'XYZ'[k]} mm`)).join('')}
    </div>
    <div class="m3-row"><span class="mut">다른 부품과 겹치는 값은 자동으로 막힘</span> <button type="button" data-m3-xfreset ${p.xform ? '' : 'disabled'}>원래대로</button></div>`;
  return `<div class="mut m3-note">mm · 위치 = 부품 외곽 중심</div>
    <div class="m3-xf">
      <span></span><b>X</b><b>Y</b><b>Z</b>
      <span>위치</span>${[0, 1, 2].map((k) => cell(`c${k}`, cen[k], posLo(k), posHi(k), `위치 ${'XYZ'[k]} mm`)).join('')}
      <span class="mut">가능</span>${[0, 1, 2].map((k) => `<span class="m3-lim">${lim ? rangeText(posLo(k), posHi(k)) : '계산 중'}</span>`).join('')}
      <span>크기</span>${[0, 1, 2].map((k) => cell(`z${k}`, siz[k], MIN_SIZE, sizeHi(k), `크기 ${'XYZ'[k]} mm`)).join('')}
      <span class="mut">최대${lock ? '*' : ''}</span>${[0, 1, 2].map((k) => `<span class="m3-lim">${lim ? (Number.isFinite(sizeHi(k)) ? f2(sizeHi(k)) : '—') : '계산 중'}</span>`).join('')}
    </div>
    ${lock && lim && Number.isFinite(lim.uniform) && lim.uniform < 1.001 && (lim.size ?? []).some((v, k) => v > siz[k] + 0.01) ? '<div class="m3-xfhint">* 비율 고정 중 — 다른 축이 막혀 키울 수 없습니다. 고정을 끄면 축별로 키울 수 있습니다.</div>' : ''}
    <div class="m3-row"><label><input type="checkbox" data-m3-xflock ${lock ? 'checked' : ''}> 비율 고정</label>
      <button type="button" data-m3-xfreset ${p.xform ? '' : 'disabled'}>원래대로</button>
      <span class="mut">원본 ${z0.map((v) => v.toFixed(1)).join('×')}</span></div>`;
}

// 실제 장면 메쉬(크기·위치·형상 반영) 외곽 크기·부피
export function meshInfo(mesh) {
  const b = bounds(mesh.positions);
  return { size: [0, 1, 2].map((k) => b[k + 3] - b[k]), volume: Math.abs(meshVolume(mesh.positions, mesh.triangles)) };
}
// 속성 제목 — '부품 2 · 116×16×2 mm'(부피·형상 변경은 partHeaderText → 툴팁)
export function partTitleText(p, info) {
  const sc = p.xform?.scale ?? [1, 1, 1], size = info?.size ?? (p.size ?? []).map((v, k) => v * sc[k]);
  return `${p.name} · ${size.map(n1).join('×')} mm`;
}
// 속성 머리 — info = meshInfo(실제 메쉬) | null(없으면 원본 × 배율). shapeMod 가 있으면 ' · 형상 변경됨'
export function partHeaderText(p, info) {
  const sc = p.xform?.scale ?? [1, 1, 1];
  const size = info?.size ?? (p.size ?? []).map((v, k) => v * sc[k]), vol = info?.volume ?? (p.volume ?? 0) * sc[0] * sc[1] * sc[2];
  return `${size.map((v) => v.toFixed(1)).join('×')}mm · ${vol.toFixed(0)} mm³${p.shapeMod ? ' · 형상 변경됨' : ''}`;
}

// 부품 노드 — sel = { part, face|null, catalog? }, h = { onKind(part, kind), onMat(part, key, value), onFinish(part, face|null, finish|null), onReflMaterial(part, id|null) }
// 반사율 상한 자르기는 onFinish 쪽(partFinishEdit)
export function renderPartProps(el, m, sel0, dbList, h) {
  const sel = { ...sel0, formEl: el, lock: XF_LOCK.get(el.ownerDocument ?? XF_LOCK) ?? false, reflForm: REFL_FORM.get(el)?.part === sel0.part ? REFL_FORM.get(el) : {} };   // 비율 고정: 기본 꺼짐(한 치수만 바꾸는 경우가 대부분), 켜면 다시 그려도 유지
  const p = m.parts[sel.part];
  if (!p) { el.innerHTML = '<div class="mut">부품을 찾을 수 없음</div>'; return; }
  const fk = sel.face != null ? `${sel.part}:${sel.face}` : null;
  if (fk && fk !== SEC_FACE) { SEC_OPEN.set('finish', true); PART_TAB = 'detail'; }   // 새 면 선택 → 상세 탭 · 면 처리 구역 자동 열기
  SEC_FACE = fk;
  el.innerHTML = `<div class="m3-h m3-title" title="${esc(partHeaderText(p, sel.meshInfo ?? null))}">${esc(partTitleText(p, sel.meshInfo ?? null))}</div>${partEditor(p, sel, dbList)}`;
  const i = sel.part;
  el.querySelectorAll('[data-m3-tab]').forEach((b) => { b.onclick = () => { if (PART_TAB !== b.dataset.m3Tab) { PART_TAB = b.dataset.m3Tab; renderPartProps(el, m, sel0, dbList, h); } }; });
  el.querySelectorAll('details[data-m3-sec]').forEach((d) => d.addEventListener('toggle', () => SEC_OPEN.set(d.dataset.m3Sec, d.open)));
  el.querySelector('[data-m3-untrace]')?.addEventListener('change', (e) => h.onUntrace?.(i, e.target.checked));
  el.querySelectorAll('[data-m3-kind]').forEach((b) => { b.onclick = () => { if (b.dataset.m3Kind !== p.material.kind) h.onKind(i, b.dataset.m3Kind); }; });
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
  const refl = el.querySelector('[data-m3-refl]');
  if (refl) refl.onchange = () => h.onReflMaterial?.(i, refl.value || null);
  // 반사 소재 추가 양식(다시 그려도 열림 유지) · 복사해서 수정 · 투과 실측 대화상자
  const reform = (f) => { REFL_FORM.set(el, { ...f, part: i }); renderPartProps(el, m, sel0, dbList, h); };
  const radd = el.querySelector('[data-m3-refladd]');
  if (radd) radd.onclick = () => reform({ addOpen: !sel.reflForm.addOpen });
  const rcan = el.querySelector('[data-m3-racancel]');
  if (rcan) rcan.onclick = () => reform({});
  const rok = el.querySelector('[data-m3-raok]');
  if (rok) rok.onclick = () => {
    const f = {}; el.querySelectorAll('[data-m3-ra]').forEach((x) => { f[x.dataset.m3Ra] = x.value; });
    REFL_FORM.set(el, {});   // 성공하면 app 이 다시 그릴 때 양식이 닫히게(먼저 닫음)
    const err = h.onReflAdd?.(i, f);   // 오류 문구(양식 다시 열고 입력 유지) | 없음
    if (err) { REFL_FORM.set(el, { addOpen: true, msg: err, part: i }); renderPartProps(el, m, sel0, dbList, h); el.querySelectorAll('[data-m3-ra]').forEach((x) => { x.value = f[x.dataset.m3Ra] ?? ''; }); }
  };
  const rcp = el.querySelector('[data-m3-reflcopy]');
  if (rcp) rcp.onclick = () => h.onReflCopy?.(i, p.reflMaterial);
  el.querySelectorAll('[data-m3-fitdlg]').forEach((b) => { b.onclick = () => h.onFitDialog?.(i); });
  el.querySelectorAll('[data-m3-cdbk]').forEach((x) => { x.onchange = () => { const id = x.closest('[data-m3-cdb]').dataset.m3Cdb, err = h.onClearDb?.('edit', id, { key: x.dataset.m3Cdbk, value: x.value }); if (err) { x.setCustomValidity?.(err); x.reportValidity?.(); } }; });
  el.querySelectorAll('[data-m3-cdbdel]').forEach((b) => { b.onclick = () => { const e = (sel.clearList ?? []).find((x) => x.id === b.dataset.m3Cdbdel); if (globalThis.confirm?.(`"${e?.name ?? ''}" 측정값을 지울까요? 이 소재를 쓰는 부품은 바탕 수지의 기본값으로 돌아갑니다.`)) h.onClearDb?.('delete', b.dataset.m3Cdbdel); }; });
  const csel = el.querySelector('[data-m3-clear]');
  if (csel) csel.onchange = () => { if (csel.value) h.onClear?.(i, csel.value); };
  const cform = (f) => { CLEAR_FORM.set(el, { ...f, part: i }); renderPartProps(el, m, sel0, dbList, h); };
  const cadd = el.querySelector('[data-m3-clearadd]');
  if (cadd) cadd.onclick = () => cform({ addOpen: !(CLEAR_FORM.get(el)?.addOpen && CLEAR_FORM.get(el)?.part === i) });
  const ccan = el.querySelector('[data-m3-cacancel]');
  if (ccan) ccan.onclick = () => cform({});
  const cok = el.querySelector('[data-m3-caok]');
  if (cok) cok.onclick = () => {
    const f = {}; el.querySelectorAll('[data-m3-ca]').forEach((x) => { f[x.dataset.m3Ca] = x.value; });
    CLEAR_FORM.set(el, {});
    const err = h.onClearAdd?.(i, f);
    if (err) { CLEAR_FORM.set(el, { addOpen: true, msg: err, part: i }); renderPartProps(el, m, sel0, dbList, h); el.querySelectorAll('[data-m3-ca]').forEach((x) => { x.value = f[x.dataset.m3Ca] ?? ''; }); }
  };
  el.querySelectorAll('[data-m3-contact]').forEach((c) => { c.onchange = () => h.onContact?.(+c.dataset.m3Contact, c.checked ? 'contact' : 'air'); });
  sel0.afterRender?.(el);   // 붙여 그릴 것(반사 소재 DB 등)
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
