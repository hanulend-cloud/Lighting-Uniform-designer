// 3D 기구 — 광원 · LED · 관측면 · 목표 속성 편집기 (spec 2026-10-14 §4·§5, 2026-10-15 m3-cad-ui §2). 상태 없음.
// P3 의 renderLightPanel 을 피처 트리 노드별로 나눴다. 계산 버튼·결과 표시는 자동 점진 계산(결과 패널·상태 띠)으로 옮김.
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
const wirePick = (el, ui, h) => on(el, '[data-lp-pick]', 'click', (x) => h.onPick(ui.pick === x.dataset.lpPick ? null : x.dataset.lpPick));

// 광원 노드: 방식 + LED STEP(불러오기·발광면/제외 클릭·위치 보정) 또는 직접 배치(PCB·개수·피치·발광 방향)
// ui = { pick, ledInfo }, h = { onLightKind(k), onLedFile(file), onPick(mode|null), onStep(key,val), onManual(key,val) }
export function renderLightProps(el, m, ui, h) {
  const L = m.light, st = L.step, man = L.manual;
  const stepHtml = L.kind !== 'step' ? '' : `
    <div class="m3-row"><label class="shape-btn">LED STEP 불러오기<input type="file" accept=".stp,.step" hidden data-lp-file></label>
      ${st ? `<span class="mut">${esc(st.name)}</span>` : ''}</div>
    ${st ? `<div class="m3-row">${pickBtn(ui, 'led', 'LED 발광면 클릭')} ${pickBtn(ui, 'ledx', 'LED 제외/포함 클릭')} ${ui.ledInfo ? esc(ui.ledInfo) : st.emitters?.length ? `LED ${st.leds.length}개 인식됨` : '<span class="mut">LED 하나의 발광면(빛이 나오는 면)을 클릭하세요</span>'}${st.excluded?.length ? ` <span class="mut">· 제외 ${st.excluded.length}개</span>` : ''}</div>
    <div class="m3-row">위치 보정 x<input type="number" step="0.1" value="${st.offset[0]}" data-lp-step="ox"> y<input type="number" step="0.1" value="${st.offset[1]}" data-lp-step="oy"> z<input type="number" step="0.1" value="${st.offset[2]}" data-lp-step="oz">mm</div>
    <div class="m3-row">회전 X<input type="number" step="90" value="${st.rot[0]}" data-lp-step="rx"> Y<input type="number" step="90" value="${st.rot[1]}" data-lp-step="ry"> Z<input type="number" step="90" value="${st.rot[2]}" data-lp-step="rz">°</div>`
      : ui.ledInfo ? `<div class="m3-row">${esc(ui.ledInfo)}</div>` : ''}`;
  const manHtml = L.kind !== 'manual' ? '' : `
    <div class="m3-row">PCB <select data-lp-man="pcbKind"><option value="depth" ${sel(man.pcb.kind, 'depth')}>관측면 아래 깊이</option><option value="face" ${sel(man.pcb.kind, 'face')}>기구 면 클릭</option></select>
      ${man.pcb.kind === 'depth' ? `<input type="number" min="0.5" step="0.5" value="${man.pcb.depth}" data-lp-man="depth">mm` : `${pickBtn(ui, 'pcb', 'PCB 면 클릭')} ${man.pcb.part != null ? `<span class="mut">부품 ${man.pcb.part + 1} 면 #${man.pcb.face}</span>` : ''}`}</div>
    <div class="m3-row">개수<input type="number" min="1" step="1" value="${man.count}" data-lp-man="count"> 피치<input type="number" min="0" step="0.5" value="${man.pitch}" data-lp-man="pitch">mm <span class="mut">(0 = 균등)</span></div>
    <div class="m3-row">발광 <select data-lp-man="side"><option value="direct" ${sel(man.side, 'direct')}>직하(관측 방향)</option><option value="left" ${sel(man.side, 'left')}>측면 왼쪽</option><option value="right" ${sel(man.side, 'right')}>측면 오른쪽</option></select></div>`;
  el.innerHTML = `<div class="m3-h">속성 · 광원</div>
    <div class="m3-row"><select data-lp-kind><option value="none" ${sel(L.kind, 'none')}>지정 안 함</option><option value="step" ${sel(L.kind, 'step')}>LED STEP 불러오기</option><option value="manual" ${sel(L.kind, 'manual')}>관측 라인 따라 직접 배치</option></select></div>
    ${stepHtml}${manHtml}`;
  on(el, '[data-lp-kind]', 'change', (x) => h.onLightKind(x.value));
  on(el, '[data-lp-file]', 'change', (x) => { const f = x.files?.[0]; if (f) h.onLedFile(f); x.value = ''; });
  wirePick(el, ui, h);
  on(el, '[data-lp-step]', 'change', (x) => { const v = readNum(x); if (v != null) h.onStep(x.dataset.lpStep, v); });
  on(el, '[data-lp-man]', 'change', (x) => { const k = x.dataset.lpMan; if (k === 'pcbKind' || k === 'side') h.onManual(k, x.value); else { const v = readNum(x); if (v != null) h.onManual(k, v); } });
}

// LED 노드: 인식 상태 · 배광 · 지향각 · 발광면 크기 · 광속(lm/개, 0 = 상대값) · PCB 색
// ui = { pick, ledInfo }, h = { onLedSpec(key,val), onSolder(v), onPick(mode|null) }
export function renderLedProps(el, m, ui, h) {
  const L = m.light;
  if (L.kind === 'none') { el.innerHTML = '<div class="m3-h">속성 · LED</div><div class="mut">광원 노드에서 방식을 먼저 고르세요</div>'; return; }
  const st = L.step;
  const status = L.kind === 'step'
    ? (st?.emitters?.length ? `LED ${st.leds.length}개 인식${st.excluded?.length ? ` · 제외 ${st.excluded.length}개` : ''}` : '<span class="mut">LED 발광면을 아직 지정하지 않음</span>')
    : `직접 배치 ${L.manual.count}개`;
  el.innerHTML = `<div class="m3-h">속성 · LED</div>
    <div class="m3-row">${status}</div>
    ${L.kind === 'step' && st ? `<div class="m3-row">${pickBtn(ui, 'led', 'LED 발광면 클릭')} ${pickBtn(ui, 'ledx', 'LED 제외/포함 클릭')}</div>` : ''}
    ${ui.ledInfo ? `<div class="m3-row mut">${esc(ui.ledInfo)}</div>` : ''}
    <div class="m3-row"><label>배광</label><select data-lp-spec="model"><option value="lambertian" ${sel(L.spec.model, 'lambertian')}>램버시안</option><option value="gaussian" ${sel(L.spec.model, 'gaussian')}>가우시안</option></select>
      지향각<input type="number" min="10" max="170" step="5" value="${L.spec.beam}" data-lp-spec="beam">°</div>
    <div class="m3-row"><label>발광면</label><input type="number" min="0" step="0.1" value="${L.spec.sizeX}" data-lp-spec="sizeX">×<input type="number" min="0" step="0.1" value="${L.spec.sizeY}" data-lp-spec="sizeY">mm</div>
    <div class="m3-row"><label>광속</label><input type="number" min="0" step="1" value="${L.spec.fluxLm ?? 0}" data-lp-spec="fluxLm"> lm/개 <span class="mut">0 = 상대값(최대 대비 %)</span></div>
    <div class="m3-row"><label>PCB 색</label><select data-lp-solder>${['백색', '녹색', '흑색'].map((c) => `<option ${c === L.solder ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`;
  wirePick(el, ui, h);
  on(el, '[data-lp-spec]', 'change', (x) => { const k = x.dataset.lpSpec; if (k === 'model') h.onLedSpec(k, x.value); else { const v = readNum(x); if (v != null) h.onLedSpec(k, v); } });
  on(el, '[data-lp-solder]', 'change', (x) => h.onSolder(x.value));
}

// 관측면 노드: 면 클릭(추가/제거) · 라인 인식 결과 · 관측 방향 · 원뿔 · 집계 격자 · 가장자리 제외
// ui = { pick, lineInfo, lineErr, auto:{cellS,cellW,winS}|null, dir }, h = { onPick, onClearObs(), onRetryLine(), onObsDir(v|null), onObs(key, v|null) }
export function renderObserveProps(el, m, ui, h) {
  const O = m.observe;
  el.innerHTML = `<div class="m3-h">속성 · 관측면</div>
    <div class="m3-row">${pickBtn(ui, 'obs', '관측면 클릭(추가/제거)')} <span class="mut">면 ${O.faces.length}개</span> ${O.faces.length ? '<button data-lp-clear>비우기</button>' : ''}</div>
    ${ui.lineInfo ? `<div class="m3-row">${esc(ui.lineInfo)}</div>` : ''}
    ${ui.lineErr ? `<div class="m3-row"><span class="warn">${esc(ui.lineErr)}</span> <button data-lp-reline>라인 다시 인식</button></div>` : ''}
    ${O.faces.length ? `<div class="m3-row">관측 방향 ${O.dir ? '' : '<span class="mut">(자동: 면 평균 법선)</span>'} x<input type="number" step="0.1" value="${numIn(ui.dir?.[0], 3)}" data-lp-dir="0"> y<input type="number" step="0.1" value="${numIn(ui.dir?.[1], 3)}" data-lp-dir="1"> z<input type="number" step="0.1" value="${numIn(ui.dir?.[2], 3)}" data-lp-dir="2"> ${O.dir ? '<button data-lp-dirauto>자동</button>' : ''}</div>` : ''}
    <div class="m3-row">관측 원뿔 ±<input type="number" min="2" max="90" step="1" value="${O.cone}" data-lp-obs="cone">° <span class="mut">90 = 출사도(확산면 휘도), 좁히면 방향 휘도(잡음 큼)</span></div>
    <div class="m3-row">가장자리 제외<input type="number" min="0" step="0.1" value="${O.edgeExcl}" data-lp-obs="edgeExcl">mm</div>
    <div class="m3-row">s 구간<input type="number" min="0.2" step="0.5" value="${O.cellS ?? ''}" placeholder="${autoPh(ui.auto?.cellS)}" data-lp-obs="cellS" data-lp-auto>mm w 구간<input type="number" min="0.1" step="0.1" value="${O.cellW ?? ''}" placeholder="${autoPh(ui.auto?.cellW)}" data-lp-obs="cellW" data-lp-auto>mm 폭 판정 창<input type="number" min="1" step="1" value="${O.winS ?? ''}" placeholder="${autoPh(ui.auto?.winS)}" data-lp-obs="winS" data-lp-auto>mm <span class="mut">빈칸 = 자동</span></div>`;
  wirePick(el, ui, h);
  on(el, '[data-lp-obs]', 'change', (x) => { const v = readNum(x); if (v != null || 'lpAuto' in x.dataset) h.onObs(x.dataset.lpObs, v); });   // 자동 칸은 빈칸 = null
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

// 목표 노드: 균일도(길이·폭) · 평균 휘도 · 잡음 목표 · 설계 점검 기준
// h = { onTarget(key, v|null), onCheckParam(key, v) } — % 칸(data-lp-pct)은 0~1 로 바꿔 넘김
export function renderTargetProps(el, m, h) {
  const O = m.observe, C = m.checks;
  el.innerHTML = `<div class="m3-h">속성 · 목표</div>
    <div class="m3-row"><label>길이 U</label><input type="number" min="0" max="1" step="0.05" value="${O.targetLen}" data-lp-tgt="targetLen"></div>
    <div class="m3-row"><label>폭 U</label><input type="number" min="0" max="1" step="0.05" value="${O.targetWid}" data-lp-tgt="targetWid"></div>
    <div class="m3-row"><label>평균 휘도</label><input type="number" min="0" step="10" value="${O.targetLum ?? ''}" placeholder="없음" data-lp-tgt="targetLum" data-lp-auto> cd/m² <span class="mut">LED 광속 필요</span></div>
    <div class="m3-row"><label>잡음 목표</label><input type="number" min="0.2" max="20" step="0.5" value="${num((O.targetNoise ?? 0.02) * 100, 1)}" data-lp-tgt="targetNoise" data-lp-pct>% <span class="mut">이하가 되면 계산 멈춤</span></div>
    <div class="m3-sub">설계 점검 기준</div>
    <div class="m3-row"><label>최소 살두께</label><input type="number" min="0.1" step="0.1" value="${C.minWall}" data-lp-chk="minWall"> mm</div>
    <div class="m3-row"><label>최소 도달률</label><input type="number" min="0" max="100" step="5" value="${num(C.minReach * 100, 0)}" data-lp-chk="minReach" data-lp-pct>%</div>
    <div class="m3-row"><label>새는 빛 한도</label><input type="number" min="0" max="100" step="5" value="${num(C.maxLeak * 100, 0)}" data-lp-chk="maxLeak" data-lp-pct>%</div>`;
  const val = (x) => { const v = readNum(x); return v == null ? null : 'lpPct' in x.dataset ? v / 100 : v; };
  on(el, '[data-lp-tgt]', 'change', (x) => { const v = val(x); if (v != null || 'lpAuto' in x.dataset) h.onTarget(x.dataset.lpTgt, v); });
  on(el, '[data-lp-chk]', 'change', (x) => { const v = val(x); if (v != null) h.onCheckParam(x.dataset.lpChk, v); });
}
