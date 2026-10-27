// 3D 기구 — 광원 · LED · 관측면 · 목표 속성 편집기 (spec 2026-10-14 §4·§5, 2026-10-15 m3-cad-ui §2). 상태 없음.
// P3 의 renderLightPanel 을 피처 트리 노드별로 나눴다. 계산 버튼·결과 표시는 자동 점진 계산(결과 패널·상태 띠)으로 옮김.
import { stepRefEmitter } from '../engine/mech3d/virtual-leds.js';
import { clampRowGap, rowGapOptions } from '../engine/mech3d/placement.js';
import { catalogOf } from '../engine/mech3d/housing-led.js';
import { MEAS_CONDS, reflStatusText } from '../model/reflect-db.js';
import { secHtml, wireSections } from './mech3d-panel.js';
import { BEAM_PRESETS, beamPreset, ledStepSel } from './m3/led-select.js';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const numIn = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');   // number input 값(빈칸 허용)
const sel = (v, cur) => (v === cur ? 'selected' : '');
const autoPh = (v) => (Number.isFinite(v) ? `자동 ${v.toFixed(1)}` : '자동');
// 숫자 입력 읽기: 빈칸 → null, min/max 속성으로 자르기
function readNum(x) {
  if (x.value.trim() === '') return null;
  let v = +x.value;
  if (!Number.isFinite(v)) return null;
  if (x.min !== '') v = Math.max(+x.min, v);
  if (x.max !== '') v = Math.min(+x.max, v);
  return v;
}
const pickBtn = (ui, mode, label) => `<button data-lp-pick="${mode}" class="${ui.pick === mode ? 'on' : ''}">${label}</button>`;
const on = (el, q, ev, fn) => el.querySelectorAll(q).forEach((x) => x.addEventListener(ev, () => fn(x)));
// 기본 | 상세 탭(LED·관측면 노드) — 노드별로 세션 동안 기억. 부품 속성 탭과 같은 모양
const LP_TAB = { leds: 'basic', obs: 'basic' };
export const lpTab = (k) => LP_TAB[k];
export function setLpTab(k, t) { LP_TAB[k] = t === 'detail' ? 'detail' : 'basic'; }
const tabsHtml = (k, dSum = '') => `<div class="m3-tabs" role="tablist"><button type="button" role="tab" data-lp-tab="basic" aria-selected="${LP_TAB[k] === 'basic'}">기본</button><button type="button" role="tab" data-lp-tab="detail" aria-selected="${LP_TAB[k] === 'detail'}">상세${dSum ? ` <span class="m3-tab-s">${esc(dSum)}</span>` : ''}</button></div>`;
const wireTabs = (el, k, redraw) => on(el, '[data-lp-tab]', 'click', (x) => { if (LP_TAB[k] !== x.dataset.lpTab) { LP_TAB[k] = x.dataset.lpTab; redraw(); } });
const wirePick = (el, ui, h) => on(el, '[data-lp-pick]', 'click', (x) => h.onPick(ui.pick === x.dataset.lpPick ? null : x.dataset.lpPick));

// 폭 방향 열(spec P4 §2.2b) 입력(순수 HTML): 열 수 1|2 + (2열) 열 간격 ±δ. attr = 'man'(직접 배치) | 'virt'(가상 배치)
// line.width 가 있으면 상한 = 반폭 − 0.5 mm(배치 때 이 값으로 자름)
const gapMax = (line) => (line?.width ? Math.floor(clampRowGap(line, Infinity) * 10 + 1e-9) / 10 : null);
export function ledRowsHtml(o, line, attr) {
  const rows = o?.rows === 2 ? 2 : 1, max = gapMax(line), a = `data-lp-${attr}`;
  const gap = rows !== 2 ? '' : ` 열 간격 ±<input type="number" min="0" ${max != null ? `max="${max}" ` : ''}step="0.5" value="${o.rowGap ?? 0}" ${a}="rowGap" aria-label="열 간격 mm(중심선에서 ±)">mm <span class="mut">${max != null ? `중심선에서 ±δ · 최대 ±${max.toFixed(1)} mm(관측 폭 ${line.width.toFixed(1)} mm)` : '중심선에서 ±δ · 관측 폭 안으로 자름'}</span>`;
  return `<div class="m3-row">열 수 <select ${a}="rows" aria-label="LED 열 수"><option value="1" ${sel(rows, 1)}>1열</option><option value="2" ${sel(rows, 2)}>2열</option></select>${gap}</div>`;
}
// 2열로 처음 바꿀 때 열 간격 = 0.27·W(자동설계 ② 가운데 후보) · 라인 없으면 0
export const defaultRowGap = (line) => (line?.width ? rowGapOptions(line, [0.27])[0] ?? 0 : 0);
const rowsTxt = (o) => (o?.rows === 2 ? `2열 × ${o.count}개` : `${o.count}개`);

// 광원 노드: 방식 + LED STEP(불러오기·발광면/제외 클릭·위치 보정) 또는 직접 배치(PCB·개수·피치·발광 방향)
// ui = { pick, ledInfo, line? }, h = { onLightKind(k), onLedFile(file), onPick(mode|null), onStep(key,val), onManual(key,val) }
export function renderLightProps(el, m, ui, h) {
  const L = m.light, st = L.step, man = L.manual;
  const stepHtml = L.kind !== 'step' ? '' : `
    <div class="m3-row"><label class="shape-btn">LED STEP 불러오기<input type="file" accept=".stp,.step" hidden data-lp-file></label>
      ${st ? `<span class="mut">${esc(st.name)}</span>` : ''}</div>
    ${st ? `<div class="m3-row">${ui.ledInfo ? esc(ui.ledInfo) : st.emitters?.length ? `LED ${st.leds.length}개 인식됨` : '<span class="mut">LED 하나의 발광면(빛이 나오는 면)을 클릭하세요</span>'}${st.excluded?.length ? ` <span class="mut">· 제외 ${st.excluded.length}개</span>` : ''} <span class="mut">(발광면·제외 클릭은 LED 노드)</span></div>
    <div class="m3-row">위치 보정 x<input type="number" step="0.1" value="${st.offset[0]}" data-lp-step="ox"> y<input type="number" step="0.1" value="${st.offset[1]}" data-lp-step="oy"> z<input type="number" step="0.1" value="${st.offset[2]}" data-lp-step="oz">mm</div>
    <div class="m3-row">회전 X<input type="number" step="90" value="${st.rot[0]}" data-lp-step="rx"> Y<input type="number" step="90" value="${st.rot[1]}" data-lp-step="ry"> Z<input type="number" step="90" value="${st.rot[2]}" data-lp-step="rz">°</div>`
      : ui.ledInfo ? `<div class="m3-row">${esc(ui.ledInfo)}</div>` : ''}`;
  const manHtml = L.kind !== 'manual' ? '' : `
    <div class="m3-row">PCB <select data-lp-man="pcbKind"><option value="depth" ${sel(man.pcb.kind, 'depth')}>관측면 아래 깊이</option><option value="face" ${sel(man.pcb.kind, 'face')}>기구 면 클릭</option></select>
      ${man.pcb.kind === 'depth' ? `<input type="number" min="0.5" step="0.5" value="${man.pcb.depth}" data-lp-man="depth">mm` : `${pickBtn(ui, 'pcb', 'PCB 면 클릭')} ${man.pcb.part != null ? `<span class="mut">부품 ${man.pcb.part + 1} 면 #${man.pcb.face}</span>` : ''}`}</div>
    <div class="m3-row">개수<input type="number" min="1" step="1" value="${man.count}" data-lp-man="count"> 피치<input type="number" min="0" step="0.5" value="${man.pitch}" data-lp-man="pitch">mm <span class="mut">(0 = 균등)</span></div>
    ${ledRowsHtml(man, ui.line ?? null, 'man')}
    <div class="m3-row">발광 <select data-lp-man="side"><option value="direct" ${sel(man.side, 'direct')}>직하(관측 방향)</option><option value="left" ${sel(man.side, 'left')}>측면 왼쪽</option><option value="right" ${sel(man.side, 'right')}>측면 오른쪽</option></select></div>`;
  el.innerHTML = `<div class="m3-h">속성 · 광원</div>
    <div class="m3-row"><select data-lp-kind><option value="none" ${sel(L.kind, 'none')}>지정 안 함</option><option value="step" ${sel(L.kind, 'step')}>LED STEP 불러오기</option><option value="manual" ${sel(L.kind, 'manual')}>관측 라인 따라 직접 배치</option></select></div>
    ${stepHtml}${manHtml}`;
  on(el, '[data-lp-kind]', 'change', (x) => h.onLightKind(x.value));
  on(el, '[data-lp-file]', 'change', (x) => { const f = x.files?.[0]; if (f) h.onLedFile(f); x.value = ''; });
  wirePick(el, ui, h);
  on(el, '[data-lp-step]', 'change', (x) => { const v = readNum(x); if (v != null) h.onStep(x.dataset.lpStep, v); });
  wireManual(el, h);
}

// 가상 배치 개수 상한 = 자동설계 ② 와 같은 차수: max(1, min(200, ⌊L/2⌋)). 라인 없으면 200
export const virtCountMax = (line) => Math.max(1, Math.min(200, Math.floor((line?.length ?? 400) / 2)));
// 가상 배치 값 보정(순수): 개수 1~상한 정수 · 피치 ≥ 0, (개수−1)·피치 ≤ 라인 길이 · 닫힌 라인 = 피치 0(균등)
// 열: rows 1|2 · 2열 열 간격 0 이하 = 기본(0.27·W) · 상한 반폭 − 0.5 mm(0.1 내림) · 1열 = 0
export function clampVirtual(v, line = null) {
  const rows = v.rows === 2 ? 2 : 1, gm = gapMax(line);
  let rowGap = rows !== 2 ? 0 : Number.isFinite(v.rowGap) && v.rowGap > 0 ? v.rowGap : defaultRowGap(line);
  if (gm != null) rowGap = Math.min(rowGap, gm);
  const count = Math.min(virtCountMax(line), Math.max(1, Math.round(v.count)));
  let pitch = Math.max(0, Number.isFinite(v.pitch) ? v.pitch : 0);
  if (line?.closed) pitch = 0;
  else if (line && count > 1) pitch = Math.min(pitch, Math.floor((line.length / (count - 1)) * 10) / 10);
  return { count, pitch, rows, rowGap };
}
// LED STEP "배치" 행(순수 HTML, spec m3-cad-ui §4b): 불러온 STEP 배치에서 시작 — [+ LED 추가] [같은 간격으로] (+ 편집했으면 [STEP 원래대로]).
// line = 관측 라인 | null, n = 지금 빛을 내는 LED 수 | null. 삭제·이동은 LED 를 골라서(LED 속성 창)
export function stepLayoutRowHtml(st, line = null, n = null) {
  const v = st.virtual, ref = stepRefEmitter(st);
  const why = !ref ? 'LED 발광면을 먼저 지정하세요' : !line ? '관측면을 먼저 지정하세요(라인 인식 후 편집)' : '';
  const dis = why ? ` disabled title="${why}"` : '';
  const state = !v ? 'STEP 원래 배치' : Array.isArray(v.positions) ? 'STEP 에서 편집한 배치' : `자동설계 배치 ${rowsTxt(v)} ${v.pitch > 0 ? `피치 ${v.pitch}mm` : '균등'}`;
  return `<div class="m3-row">${n != null ? `LED ${n}개 · ` : ''}${state}</div>
    <div class="m3-row"><button type="button" data-lp-edit="add"${dis}>+ LED 추가</button> <button type="button" data-lp-edit="align"${dis}>같은 간격으로</button>${v ? ' <button type="button" data-lp-edit="orig">STEP 원래대로</button>' : ''}</div>
    <div class="m3-row mut">${why || '추가 = 가장 넓은 빈자리 가운데에 기준 LED 복사 · 삭제·이동은 LED 를 골라서'}</div>`;
}
// LED 노드 본문(순수 HTML): 인식 상태 · (LED STEP) 배치 · 배광 · 지향각 · 발광면 크기 · 광속(lm/개, 0 = 상대값) · PCB 색
// adv = LED 속성 창의 '배치·인식 (고급)' 구역 — 배치·배광·광속은 창 위쪽에 있으므로 뺀다
function ledNodeBodyHtml(m, ui, adv = false, showBeam = false) {   // showBeam = 노드 상세 탭(배광 모델·지향각 직접 입력)
  const L = m.light, st = L.step, v = L.kind === 'step' ? st?.virtual : null, lay = ui.lay ?? null;
  const nLed = (st?.leds ?? []).filter((i) => !(st.excluded ?? []).includes(i)).length;
  const failed = !!v && !lay?.virtual && (!!lay?.err || !!ui.line);   // 라인이 있는데 원래 배치로 돌아감(오류·메쉬 없음)
  const virtTxt = !v ? '' : lay?.virtual ? ` · 편집한 배치 ${lay.leds.length}개` : failed ? ` · <span class="warn">편집한 배치를 못 그림 — 원래 ${nLed}개로 계산</span>` : ' · 편집한 배치 <span class="mut">(관측 라인 대기)</span>';
  const status = L.kind === 'step'
    ? (st?.emitters?.length ? `LED ${st.leds.length}개 인식${st.excluded?.length ? ` · 제외 ${st.excluded.length}개` : ''}${virtTxt}` : `<span class="mut">LED 발광면을 아직 지정하지 않음</span>${virtTxt}`)
    : `직접 배치 ${rowsTxt(L.manual)}`;
  return `<div class="m3-row">${status}</div>
    ${failed ? `<div class="m3-row"><span class="warn">${esc(lay?.err ?? 'LED STEP 메쉬가 없음 — 다시 불러오세요')}</span></div>` : ''}
    ${!adv && L.kind === 'step' && st ? stepLayoutRowHtml(st, ui.line ?? null, lay?.emitters?.length ?? null) : ''}
    ${L.kind === 'step' && st ? (v ? '<div class="m3-row mut">배치를 편집한 상태 — 발광면 다시 지정·제외 클릭은 [STEP 원래대로] 뒤에</div>' : `<div class="m3-row">${pickBtn(ui, 'led', 'LED 발광면 클릭')} ${pickBtn(ui, 'ledx', 'LED 제외/포함 클릭')}</div>`) : ''}
    ${ui.ledInfo ? `<div class="m3-row mut">${esc(ui.ledInfo)}</div>` : ''}
    ${adv && !showBeam ? '' : `<div class="m3-row"><label>배광</label><select data-lp-spec="model"><option value="lambertian" ${sel(L.spec.model, 'lambertian')}>램버시안</option><option value="gaussian" ${sel(L.spec.model, 'gaussian')}>가우시안</option></select>
      지향각<input type="number" min="10" max="170" step="5" value="${L.spec.beam}" data-lp-spec="beam">°</div>`}
    <div class="m3-row"><label>발광면</label><input type="number" min="0" step="0.1" value="${L.spec.sizeX}" data-lp-spec="sizeX">×<input type="number" min="0" step="0.1" value="${L.spec.sizeY}" data-lp-spec="sizeY">mm</div>
    ${adv ? '' : `<div class="m3-row"><label>광속</label><input type="number" min="0" step="1" value="${L.spec.fluxLm ?? 0}" data-lp-spec="fluxLm"> lm/개 <span class="mut">0 = 상대값(최대 대비 %)</span></div>`}
    <div class="m3-row"><label>PCB 색</label><select data-lp-solder>${['백색', '녹색', '흑색'].map((c) => `<option ${c === L.solder ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`;
}
// LED 노드 기본 탭(순수) — 몇 개인지 · LED 고르기 · 빛 퍼짐(넓게/보통/좁게) · 밝기 · 배치(추가·같은 간격). 발광면 지정·배광 상세는 상세 탭
function ledBasicHtml(m, ui, nav) {
  const L = m.light, st = L.kind === 'step' ? L.step : null, lay = ui.lay ?? null, pre = beamPreset(L.spec);
  const n = st ? (lay?.emitters?.length ?? (st.leds ?? []).filter((i) => !(st.excluded ?? []).includes(i)).length) : (L.manual?.count ?? 0) * (L.manual?.rows === 2 ? 2 : 1);
  const seg = BEAM_PRESETS.map(([a, t]) => `<button type="button" data-lp-beam="${a}" aria-pressed="${pre === a ? 'true' : 'false'}">${t} ${a}°</button>`).join('');
  const ready = st ? !!st.emitters?.length : true;
  return `<div class="m3-card"><div class="m3-row"><b>LED ${n}개</b>${nav ? ` <span class="m3-ledsel">${nav}</span> <span class="mut">하나씩 보기 · 3D 에서 LED 클릭도 됨</span>` : ''}</div>
      ${!ready ? '<div class="m3-row warn">LED 발광면을 아직 지정하지 않음 — 상세 탭의 [LED 발광면 클릭]</div>' : ''}</div>
    <div class="m3-card"><div class="m3-sub">빛 퍼짐</div><div class="m3-seg m3-seg3" role="group" aria-label="빛 퍼짐">${seg}</div></div>
    <div class="m3-card"><div class="m3-row"><label>밝기</label><input type="number" min="0" step="1" value="${L.spec.fluxLm ?? 0}" data-lp-spec="fluxLm" aria-label="LED 1개 광속 lm"> lm/개 <span class="mut">0 = 상대값(%)</span></div></div>
    <div class="m3-card"><div class="m3-sub">배치</div>${st ? stepLayoutRowHtml(st, ui.line ?? null, n) : `<div class="m3-row">개수<input type="number" min="1" step="1" value="${L.manual.count}" data-lp-man="count" aria-label="LED 개수"> 피치<input type="number" min="0" step="0.5" value="${L.manual.pitch}" data-lp-man="pitch" aria-label="LED 피치 mm">mm <span class="mut">(0 = 균등)</span></div>`}</div>`;
}
// LED 고르기 ◀ ▶ (순수 HTML) — n = 선택 번호(0부터) | null, total = LED 수. 선택 없음: ◀ = 마지막, ▶ = 첫 LED
export function ledNavHtml(n, total) {
  const p = ledStepSel(n, total, -1), q = ledStepSel(n, total, 1);
  if (p == null) return '';
  return `<button type="button" data-lp-ledsel="${p}" title="이전 LED" aria-label="이전 LED">◀</button><button type="button" data-lp-ledsel="${q}" title="다음 LED" aria-label="다음 LED">▶</button>`;
}
const n2s = (v) => String(+(+v).toFixed(2));
// LED 속성 창(순수 HTML, spec m3-cad-ui §4a) — ui.led = { n, total, s, gap(현재 LED→커버 최소 간격, 모르면 NaN), adj:{ds,dz}, excluded, clash:[문구] }, ui.line
export function ledPanelHtml(m, ui) {
  const L = m.light, d = ui.led, st = L.kind === 'step' ? L.step : null, man = L.manual, pre = beamPreset(L.spec);
  const seg = BEAM_PRESETS.map(([a, t]) => `<button type="button" data-lp-beam="${a}" aria-pressed="${pre === a ? 'true' : 'false'}">${t} ${a}°</button>`).join('');
  const faceP = L.kind === 'manual' && man?.pcb?.kind === 'face', noGap = !Number.isFinite(d.gap);
  const dis = faceP ? 'PCB 를 기구 면으로 지정해서 높이는 그 면이 정함 — 광원 노드에서 "관측면 아래 깊이" 로 바꾸면 조절 가능' : noGap ? 'LED 앞쪽에서 커버(관측면 부품)를 찾지 못함' : '';
  const arrange = st ? stepLayoutRowHtml(st, ui.line ?? null, ui.lay?.emitters?.length ?? null)
    : `${man.positions?.length ? `<div class="m3-row mut">자동설계 배치 — 위치 ${man.positions.length}개(피치가 일정하지 않을 수 있음) · 개수·피치·열을 고치면 균등 배치로</div>` : ''}<div class="m3-row">개수<input type="number" min="1" step="1" value="${man.count}" data-lp-man="count" aria-label="LED 개수"> 피치<input type="number" min="0" step="0.5" value="${man.pitch}" data-lp-man="pitch" aria-label="LED 피치 mm">mm <span class="mut">(0 = 균등)</span></div>${ledRowsHtml(man, ui.line ?? null, 'man')}`;
  const adjOn = !!(d.adj?.ds || d.adj?.dz), canDel = !!st && (!st.virtual || (!!stepRefEmitter(st) && !!ui.line));   // 원래 배치 = 제외 토글, 편집한 배치 = 목록에서 삭제
  return `<div class="m3-h m3-title m3-ledh"><span>LED ${d.n + 1} · ${d.total}개 중 · 라인 위치 ${num(d.s, 1)} mm</span><span class="m3-ledsel">${ledNavHtml(d.n, d.total)}<button type="button" data-lp-ledsel="" title="LED 선택 해제(Esc)" aria-label="LED 선택 해제">✕</button></span></div>
    <div class="m3-card"><div class="m3-sub">배광 <span class="mut">(모든 LED 공통)</span></div>
      <div class="m3-seg m3-seg3" role="group" aria-label="배광">${seg}</div>
      <div class="m3-row">직접 입력 <input type="number" min="10" max="170" step="5" data-lp-beamc value="${pre === 'custom' ? L.spec.beam : ''}" aria-label="빛이 퍼지는 각도 °">° <span class="mut">빛이 퍼지는 각도(밝기 절반 기준)</span></div></div>
    <div class="m3-card"><div class="m3-sub">밝기 <span class="mut">(모든 LED 공통)</span></div>
      <div class="m3-row">광속 <input type="number" min="0" step="1" value="${L.spec.fluxLm ?? 0}" data-lp-spec="fluxLm" aria-label="LED 1개 광속 lm"> lm/개 <span class="mut">0 = 상대값(최대 대비 %)</span></div></div>
    <div class="m3-card"><div class="m3-sub">위치 — 전체 LED</div>
      <div class="m3-row">커버까지 거리 <input type="number" min="0" step="0.1" value="${numIn(d.gap, 1)}" data-lp-dist${dis ? ' disabled' : ''} aria-label="LED 에서 커버까지 거리 mm"> mm <span class="mut">${dis || '가장 가까운 LED 기준 · 바꾸면 모든 LED 높이를 함께 옮김'}</span></div>
      ${arrange}</div>
    <div class="m3-card"><div class="m3-sub">위치 — 이 LED만</div>
      <div class="m3-row">라인 방향 <input type="number" step="0.5" value="${n2s(d.adj?.ds ?? 0)}" data-lp-adj="ds" aria-label="이 LED 라인 방향 이동 mm"> mm 높이 <input type="number" step="0.1" value="${n2s(d.adj?.dz ?? 0)}" data-lp-adj="dz" aria-label="이 LED 높이 이동 mm"> mm ${adjOn ? '<button type="button" data-lp-adjreset>원래대로</button>' : ''}</div>
      <div class="m3-row mut">라인 방향 + = 라인 진행 쪽, 높이 + = 커버 쪽 · LED 추가·삭제·같은 간격 뒤에는 그 위치로 굳어짐</div>
      ${canDel ? `<div class="m3-row"><button type="button" data-lp-ledx>${d.excluded ? '이 LED 다시 넣기' : '이 LED 삭제'}</button> <span class="mut">${d.excluded ? '지금 빛을 내지 않음(삭제됨)' : st.virtual ? '배치에서 뺌' : '빛을 내지 않게 뺌(STEP 원래 몸체는 그대로)'}</span></div>` : ''}
      ${(d.clash ?? []).map((t) => `<div class="m3-clash" role="alert">${esc(t)}</div>`).join('')}</div>
    ${secHtml('ledadv', '배치·인식 (고급)', '', ledNodeBodyHtml(m, ui, true))}`;
}
// 직접 배치 입력 연결(광원 노드·LED 속성 창 공용)
const wireManual = (el, h) => on(el, '[data-lp-man]', 'change', (x) => { const k = x.dataset.lpMan; if (k === 'pcbKind' || k === 'side') h.onManual(k, x.value); else if (k === 'rows') h.onManual(k, +x.value); else { const v = readNum(x); if (v != null) h.onManual(k, v); } });
// LED 노드: ui.led 가 있으면 LED 속성 창(선택한 LED), 없으면 노드 내용 + LED 고르기 ◀ ▶
// ui = { pick, ledInfo, line?, lay?(stepLayout 결과 — 실제 배치·err), led?, ledTotal? }
// h = { onLedSpec(key,val), onSolder(v), onPick(mode|null), onLedEdit(add|align|orig), onManual(key,val), onLedSel(n|null), onLedBeam(°), onLedDist(mm), onLedAdjust(n, {ds,dz}|null), onLedExclude(n) }
export function renderLedProps(el, m, ui, h) {
  const L = m.light;
  if (L.kind === 'none') { el.innerHTML = '<div class="m3-h">속성 · LED</div><div class="mut">광원 노드에서 방식을 먼저 고르세요</div>'; return; }
  const d = ui.led ?? null;
  const nav = ledNavHtml(null, ui.ledTotal ?? 0);
  el.innerHTML = d ? ledPanelHtml(m, ui) : `<div class="m3-h">속성 · LED</div>${tabsHtml('leds')}<div class="m3-edit" role="tabpanel">${LP_TAB.leds === 'basic' ? ledBasicHtml(m, ui, nav) : ledNodeBodyHtml(m, ui, true, true)}</div>`;
  if (!d) wireTabs(el, 'leds', () => renderLedProps(el, m, ui, h));
  wireSections(el);
  wirePick(el, ui, h);
  on(el, '[data-lp-spec]', 'change', (x) => {
    const k = x.dataset.lpSpec;
    if (k === 'model') { h.onLedSpec(k, x.value); return; }
    const val = readNum(x);
    if (val != null) h.onLedSpec(k, val); else if (k === 'fluxLm') h.onLedSpec(k, 0);   // 광속 빈칸 = 0(상대값)
  });
  on(el, '[data-lp-solder]', 'change', (x) => h.onSolder(x.value));
  on(el, '[data-lp-edit]', 'click', (x) => h.onLedEdit?.(x.dataset.lpEdit));   // add | align | orig
  wireManual(el, h);
  on(el, '[data-lp-ledsel]', 'click', (x) => h.onLedSel?.(x.dataset.lpLedsel === '' ? null : +x.dataset.lpLedsel));
  on(el, '[data-lp-beam]', 'click', (x) => h.onLedBeam?.(+x.dataset.lpBeam));
  on(el, '[data-lp-beamc]', 'change', (x) => { const a = readNum(x); if (a != null) h.onLedBeam?.(a); });
  on(el, '[data-lp-dist]', 'change', (x) => { const g = readNum(x); if (g != null) h.onLedDist?.(g); });
  if (d) {
    on(el, '[data-lp-adj]', 'change', () => { const g = (k) => readNum(el.querySelector(`[data-lp-adj="${k}"]`)) ?? 0; h.onLedAdjust?.(d.n, { ds: g('ds'), dz: g('dz') }); });
    on(el, '[data-lp-adjreset]', 'click', () => h.onLedAdjust?.(d.n, null));
    on(el, '[data-lp-ledx]', 'click', () => h.onLedExclude?.(d.n));
  }
}

// 관측면 노드: 면 클릭(추가/제거) · 라인 인식 결과 · 관측 방향 · 원뿔 · 집계 격자 · 가장자리 제외
// ui = { pick, lineInfo, lineErr, auto:{cellS,cellW,winS}|null, dir }, h = { onPick, onClearObs(), onRetryLine(), onObsDir(v|null), onObs(key, v|null) }
export function renderObserveProps(el, m, ui, h) {
  const O = m.observe, R = ui.result ?? null, tab = LP_TAB.obs;
  const res = (v, tg) => (Number.isFinite(v) ? `<b class="${v + 1e-9 >= tg ? 'ok' : 'bad'}">${(Math.floor(v * 100 + 1e-9) / 100).toFixed(2)}</b> <span class="mut">${v + 1e-9 >= tg ? '목표 통과' : `목표까지 ${(tg - v).toFixed(2)}`}</span>` : '<span class="mut">계산 중</span>');
  const basic = `<div class="m3-card"><div class="m3-row">${pickBtn(ui, 'obs', '👁 관측면 클릭 (추가/제거)')} <span class="mut">면 ${O.faces.length}개</span> ${O.faces.length ? '<button data-lp-clear>비우기</button>' : ''}</div>
      <div class="m3-row mut">${O.faces.length ? '3D 의 하늘색 테두리 = 관측면 · 화살표 = 보는 방향' : '빛을 보는 면(예: 도광판 윗면)을 3D 에서 클릭하세요'}</div></div>
    <div class="m3-card"><div class="m3-sub">목표 균일도</div>
      <div class="m3-row"><label>길이 U</label><input type="number" min="0" max="1" step="0.05" value="${O.targetLen}" data-lp-tgt="targetLen" aria-label="길이 균일도 목표"> <label>폭 U</label><input type="number" min="0" max="1" step="0.05" value="${O.targetWid}" data-lp-tgt="targetWid" aria-label="폭 균일도 목표"></div></div>
    ${O.faces.length ? `<div class="m3-card"><div class="m3-sub">지금 결과</div><div class="m3-row"><label>길이 U</label>${res(R?.Ulen, O.targetLen)}</div><div class="m3-row"><label>폭 U</label>${res(R?.Uwid, O.targetWid)}</div></div>` : ''}`;
  const detail = `${ui.lineInfo ? `<div class="m3-row">${esc(ui.lineInfo)}</div>` : ''}
    ${ui.lineErr ? `<div class="m3-row"><span class="warn">${esc(ui.lineErr)}</span> <button data-lp-reline>라인 다시 인식</button></div>` : ''}
    ${O.faces.length ? `<div class="m3-row">보는 방향 ${O.dir ? '' : '<span class="mut">(자동: 면 법선)</span>'} x<input type="number" step="0.1" value="${numIn(ui.dir?.[0], 3)}" data-lp-dir="0"> y<input type="number" step="0.1" value="${numIn(ui.dir?.[1], 3)}" data-lp-dir="1"> z<input type="number" step="0.1" value="${numIn(ui.dir?.[2], 3)}" data-lp-dir="2"> ${O.dir ? '<button data-lp-dirauto>자동</button>' : ''}</div>` : ''}
    <div class="m3-row">관측 원뿔 ±<input type="number" min="2" max="90" step="1" value="${O.cone}" data-lp-obs="cone">° <span class="mut">90 = 확산면 밝기, 좁히면 정면 밝기(잡음 큼)</span></div>
    <div class="m3-row">가장자리 제외<input type="number" min="0" step="0.1" value="${O.edgeExcl}" data-lp-obs="edgeExcl">mm</div>
    <div class="m3-row">길이 칸<input type="number" min="0.2" step="0.5" value="${O.cellS ?? ''}" placeholder="${autoPh(ui.auto?.cellS)}" data-lp-obs="cellS" data-lp-auto>mm 폭 칸<input type="number" min="0.1" step="0.1" value="${O.cellW ?? ''}" placeholder="${autoPh(ui.auto?.cellW)}" data-lp-obs="cellW" data-lp-auto>mm 폭 판정 창<input type="number" min="1" step="1" value="${O.winS ?? ''}" placeholder="${autoPh(ui.auto?.winS)}" data-lp-obs="winS" data-lp-auto>mm <span class="mut">빈칸 = 자동</span></div>
    <div class="m3-row">계산 오차 목표<input type="number" min="0.2" max="20" step="0.5" value="${num((O.targetNoise ?? 0.02) * 100, 1)}" data-lp-tgt="targetNoise" data-lp-pct>% <span class="mut">이하가 되면 계산 멈춤</span></div>`;
  const dSum = [O.dir ? '방향 지정' : '', O.cone !== 90 ? `원뿔 ±${O.cone}°` : ''].filter(Boolean).join(' · ');
  el.innerHTML = `<div class="m3-h">속성 · 관측면</div>${tabsHtml('obs', dSum)}<div class="m3-edit" role="tabpanel">${tab === 'basic' ? basic : detail}</div>`;
  wireTabs(el, 'obs', () => renderObserveProps(el, m, ui, h));
  wirePick(el, ui, h);
  on(el, '[data-lp-obs]', 'change', (x) => { const v = readNum(x); if (v != null || 'lpAuto' in x.dataset) h.onObs(x.dataset.lpObs, v); });   // 자동 칸은 빈칸 = null
  on(el, '[data-lp-tgt]', 'change', (x) => { const v = readNum(x); if (v != null) h.onTarget?.(x.dataset.lpTgt, 'lpPct' in x.dataset ? v / 100 : v); });
  on(el, '[data-lp-clear]', 'click', () => h.onClearObs());
  on(el, '[data-lp-dir]', 'change', () => {
    const xs = [0, 1, 2].map((k) => el.querySelector(`[data-lp-dir="${k}"]`));
    if (xs.some((x) => x.value.trim() === '')) return;   // 세 칸 모두 있어야 함
    const v = xs.map((x) => +x.value);
    if (v.every(Number.isFinite) && Math.hypot(...v) > 1e-6) h.onObsDir(v);
  });
  on(el, '[data-lp-reline]', 'click', () => h.onRetryLine());
  on(el, '[data-lp-dirauto]', 'click', () => h.onObsDir(null));
}

// 반사 소재 DB 관리(spec P4 §2.3e, 목표 노드) — 이름·종류·R·상한·상태·측정 수. 사용자 항목 = 이름·R·상한 편집·측정값 추가·삭제,
// 공용 항목 = 읽기 전용 + [복사]. 특수 처리 = 상한만. ui = { addFor: 측정값 추가 중인 id }
const KIND_SHORT = { whiteDiffuse: '확산', metal: '경면' };
const pc0 = (v) => (v == null ? '—' : num(v * 100, 1).replace(/\.0$/, ''));
export function reflDbHtml(cat, ui = {}) {
  const cell = (e, k) => (e[k] == null ? '—' : e.origin !== 'user' ? pc0(e[k]) : `<input type="number" min="0" max="100" step="0.1" value="${pc0(e[k])}" data-lp-cat="${esc(e.id)}" data-lp-catk="${k}" aria-label="${esc(e.name)} ${k === 'R' ? '기본' : '상한'} 반사율">`);
  const row = (e) => {
    const u = e.origin === 'user', id = esc(e.id);
    const name = u ? `<input value="${esc(e.name)}" data-lp-catname="${id}" aria-label="소재 이름" size="12">` : esc(e.name);
    const act = u ? `<button data-lp-dbadd="${id}" title="측정값 추가">＋측정</button><button data-lp-dbdel="${id}" title="삭제">삭제</button>` : `<button data-lp-dbcopy="${id}" title="사용자 사본 만들기">복사</button>`;
    const add = u && ui.addFor === e.id ? `<tr><td colspan="7"><div class="m3-row">값 <input data-lp-addv placeholder="85.5, 86.1" size="10" aria-label="측정 반사율 %(쉼표로 여러 값)">% <select data-lp-addc aria-label="측정 조건">${MEAS_CONDS.map((c) => `<option>${c}</option>`).join('')}</select>
      메모 <input data-lp-addn size="8" aria-label="메모"> <button data-lp-addok="${id}">추가</button><button data-lp-addno>취소</button></div></td></tr>` : '';
    return `<tr><th>${e.special ? '특수 · ' : ''}${name}</th><td>${KIND_SHORT[e.kind] ?? e.kind}</td><td>${cell(e, 'R')}</td><td>${cell(e, 'max')}</td><td>${u ? '사용자 · ' : ''}${reflStatusText(e)}</td><td>${e.nSamples ?? 0}</td><td>${act}</td></tr>${add}`;
  };
  return `<div class="m3-sub">반사 소재 DB <span class="mut">반사율 % · 불투명 부품 상한 · 자동설계 ④ 후보 · 공용은 [복사] 후 수정</span></div>
    <div class="m3-cat-wrap"><table class="m3-cmp m3-cat"><tr><th>소재</th><th>종류</th><th>R</th><th>상한</th><th>상태</th><th>측정</th><th></th></tr>${cat.map(row).join('')}</table></div>
    <div class="m3-row"><button data-lp-dbexp>내보내기</button><label class="m3-file"><span>불러오기</span><input type="file" accept=".json,application/json" data-lp-dbimp hidden></label></div>`;
}
const DB_ADD = new WeakMap();   // 패널 요소 → 측정값 추가 중인 id

// 목표 노드: 균일도(길이·폭) · 평균 휘도 · 잡음 목표 · 설계 점검 기준
// h = { onTarget(key, v|null), onCheckParam(key, v), onCatalog(id, key, v), onReflDb(op, id?, arg?) } — % 칸(data-lp-pct)은 0~1 로 바꿔 넘김 · cat = 반사 소재표 행(catalogOf(DB))
// onReflDb op: 'rename'(id, 이름) · 'samples'(id, { values, cond, note } → 오류 문구|없음) · 'remove'(id) · 'copy'(id) · 'export' · 'import'(_, 텍스트)
// 목표 노드(쉽게): 길이·폭 균일도 % 두 칸 + (선택) 밝기 목표. 계산 오차·설계 점검 기준은 접는 구역. 반사 소재 DB 는 부품 상세 탭으로 옮김
export function renderTargetProps(el, m, h) {
  const O = m.observe, C = m.checks, pc = (v) => Math.round(v * 100);
  el.innerHTML = `<div class="m3-h">속성 · 목표</div>
    <div class="m3-card"><div class="m3-sub">균일도 목표 <span class="mut">가장 어두운 곳 ÷ 가장 밝은 곳</span></div>
      <div class="m3-row"><label>길이 방향</label><input type="number" min="0" max="100" step="5" value="${pc(O.targetLen)}" data-lp-tgt="targetLen" data-lp-pct aria-label="길이 방향 균일도 목표 %"> %</div>
      <div class="m3-row"><label>폭 방향</label><input type="number" min="0" max="100" step="5" value="${pc(O.targetWid)}" data-lp-tgt="targetWid" data-lp-pct aria-label="폭 방향 균일도 목표 %"> %</div></div>
    <div class="m3-card"><div class="m3-row"><label>밝기 목표</label><input type="number" min="0" step="10" value="${O.targetLum ?? ''}" placeholder="없음" data-lp-tgt="targetLum" data-lp-auto aria-label="평균 휘도 목표 cd/m²"> cd/m² <span class="mut">선택 · LED 밝기(lm) 입력 필요</span></div></div>
    ${secHtml('tgtadv', '계산 · 설계 점검 기준', '', `
      <div class="m3-row"><label>계산 오차 목표</label><input type="number" min="0.2" max="20" step="0.5" value="${num((O.targetNoise ?? 0.02) * 100, 1)}" data-lp-tgt="targetNoise" data-lp-pct>% <span class="mut">이하가 되면 계산 멈춤</span></div>
      <div class="m3-row"><label>최소 살두께</label><input type="number" min="0.1" step="0.1" value="${C.minWall}" data-lp-chk="minWall"> mm</div>
      <div class="m3-row"><label>최소 도달률</label><input type="number" min="0" max="100" step="5" value="${num(C.minReach * 100, 0)}" data-lp-chk="minReach" data-lp-pct>%</div>
      <div class="m3-row"><label>새는 빛 한도</label><input type="number" min="0" max="100" step="5" value="${num(C.maxLeak * 100, 0)}" data-lp-chk="maxLeak" data-lp-pct>%</div>`)}`;
  wireSections(el);
  const val = (x) => { const v = readNum(x); return v == null ? null : 'lpPct' in x.dataset ? v / 100 : v; };
  on(el, '[data-lp-tgt]', 'change', (x) => { const v = val(x); if (v != null || 'lpAuto' in x.dataset) h.onTarget(x.dataset.lpTgt, v); });
  on(el, '[data-lp-chk]', 'change', (x) => { const v = val(x); if (v != null) h.onCheckParam(x.dataset.lpChk, v); });
}
// 반사 소재 DB(편집·측정값 추가·복사·삭제·내보내기·불러오기) — 부품 상세 탭(불투명 부품)에 붙임. redraw = 다시 그리기(측정값 추가 양식 열고 닫기)
export function renderReflDb(el, cat, h, redraw) {
  el.innerHTML = reflDbHtml(cat, { addFor: DB_ADD.get(el) ?? null });
  on(el, '[data-lp-cat]', 'change', (x) => { const v = readNum(x); if (v != null) h.onCatalog?.(x.dataset.lpCat, x.dataset.lpCatk, v / 100); });
  const again = (id) => { DB_ADD.set(el, id); redraw ? redraw() : renderReflDb(el, cat, h); };
  on(el, '[data-lp-catname]', 'change', (x) => { if (x.value.trim()) h.onReflDb?.('rename', x.dataset.lpCatname, x.value.trim()); });
  on(el, '[data-lp-dbadd]', 'click', (x) => again(DB_ADD.get(el) === x.dataset.lpDbadd ? null : x.dataset.lpDbadd));
  on(el, '[data-lp-addno]', 'click', () => again(null));
  on(el, '[data-lp-addok]', 'click', (x) => {
    const g = (k) => el.querySelector(`[data-lp-${k}]`)?.value ?? '', f = { values: g('addv'), cond: g('addc'), note: g('addn') };
    DB_ADD.set(el, null);
    const err = h.onReflDb?.('samples', x.dataset.lpAddok, f);
    if (err) { again(x.dataset.lpAddok); el.querySelector('[data-lp-addv]').value = f.values; el.querySelector('[data-lp-addn]').value = f.note; }
  });
  on(el, '[data-lp-dbdel]', 'click', (x) => { const e = cat.find((c) => c.id === x.dataset.lpDbdel); if (globalThis.confirm?.(`"${e?.name ?? x.dataset.lpDbdel}" 을 반사 소재 DB 에서 삭제할까요? 이 소재를 쓰는 부품은 "없는 소재" 로 표시됩니다.`)) h.onReflDb?.('remove', x.dataset.lpDbdel); });
  on(el, '[data-lp-dbcopy]', 'click', (x) => h.onReflDb?.('copy', x.dataset.lpDbcopy));
  on(el, '[data-lp-dbexp]', 'click', () => h.onReflDb?.('export'));
  on(el, '[data-lp-dbimp]', 'change', async (x) => { const f = x.files?.[0]; if (!f) return; const t = await f.text(); x.value = ''; h.onReflDb?.('import', null, t); });
}
