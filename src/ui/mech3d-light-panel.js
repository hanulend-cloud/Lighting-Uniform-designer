// 3D 기구 — 광원 · 관측면 · 계산 패널 (spec 2026-10-14 §4·§5). 상태 없음: m = spec.mech3d, ui = { pick, lineInfo, ledInfo, calc, dir }, h = 처리기.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const numIn = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');   // number input 값(빈칸 허용)
const sel = (v, cur) => (v === cur ? 'selected' : '');

function resultHtml(res) {
  if (res.error) return esc(res.error);
  if (res.busy) return esc(res.busy);
  if (res.empty) return '판정할 유효 셀이 없음 — 관측면이 너무 좁거나 가장자리 제외가 큼';
  const wid = res.Uwid == null
    ? '폭 방향 <b>폭 판정 불가(폭이 격자 2칸 미만)</b>'
    : `폭 방향 최저 U <b>${num(res.Uwid, 3)}</b> ±${num(res.seWid, 3)} @ s=${num(res.sWorst)}mm ${res.passWid ? '✓' : '✗'}`;
  return `길이 방향 U <b>${num(res.Ulen, 3)}</b> ±${num(res.seLen, 3)} ${res.passLen ? '✓' : '✗'} · ${wid}
      ${res.noiseWarn ? '<div class="warn">⚠ 잡음이 판정 여유보다 큼 — 격자를 키우거나 정밀 계산 권장</div>' : ''}
      <div class="mut">${num(res.sec)}s · 광자 ${res.N.toLocaleString()} · 탈출 ${num(res.escape * 100, 1)}%${Number.isFinite(res.nbar) ? ` · 셀당 광자 ${num(res.nbar, 1)}개/배치` : ''}</div>`;
}

// h = { onLightKind(k), onLedFile(file), onPick(mode|null), onStep(key,val), onManual(key,val), onSolder(v), onLedSpec(key,val), onObs(key,val), onObsDir(v|null), onClearObs(), onCalc(N) }
export function renderLightPanel(el, m, ui, h) {
  const L = m.light, O = m.observe, st = L.step, man = L.manual;
  const pickBtn = (mode, label) => `<button data-lp-pick="${mode}" class="${ui.pick === mode ? 'on' : ''}">${label}</button>`;
  const stepHtml = L.kind !== 'step' ? '' : `
    <div class="m3-row"><label class="shape-btn">LED STEP 불러오기<input type="file" accept=".stp,.step" hidden data-lp-file></label>
      ${st ? `<span class="mut">${esc(st.name)}</span>` : ''}</div>
    ${st ? `<div class="m3-row">${pickBtn('led', 'LED 발광면 클릭')} ${pickBtn('ledx', 'LED 제외/포함 클릭')} ${ui.ledInfo ? esc(ui.ledInfo) : st.emitters?.length ? `LED ${st.leds.length}개 인식됨` : '<span class="mut">LED 하나의 발광면(빛이 나오는 면)을 클릭하세요</span>'}${st.excluded?.length ? ` <span class="mut">· 제외 ${st.excluded.length}개</span>` : ''}</div>
    <div class="m3-row">위치 보정 x<input type="number" step="0.1" value="${st.offset[0]}" data-lp-step="ox"> y<input type="number" step="0.1" value="${st.offset[1]}" data-lp-step="oy"> z<input type="number" step="0.1" value="${st.offset[2]}" data-lp-step="oz">mm</div>
    <div class="m3-row">회전 X<input type="number" step="90" value="${st.rot[0]}" data-lp-step="rx"> Y<input type="number" step="90" value="${st.rot[1]}" data-lp-step="ry"> Z<input type="number" step="90" value="${st.rot[2]}" data-lp-step="rz">°</div>`
      : ui.ledInfo ? `<div class="m3-row">${esc(ui.ledInfo)}</div>` : ''}`;
  const manHtml = L.kind !== 'manual' ? '' : `
    <div class="m3-row">PCB <select data-lp-man="pcbKind"><option value="depth" ${sel(man.pcb.kind, 'depth')}>관측면 아래 깊이</option><option value="face" ${sel(man.pcb.kind, 'face')}>기구 면 클릭</option></select>
      ${man.pcb.kind === 'depth' ? `<input type="number" min="0.5" step="0.5" value="${man.pcb.depth}" data-lp-man="depth">mm` : `${pickBtn('pcb', 'PCB 면 클릭')} ${man.pcb.part != null ? `<span class="mut">부품 ${man.pcb.part + 1} 면 #${man.pcb.face}</span>` : ''}`}</div>
    <div class="m3-row">개수<input type="number" min="1" step="1" value="${man.count}" data-lp-man="count"> 피치<input type="number" min="0" step="0.5" value="${man.pitch}" data-lp-man="pitch">mm <span class="mut">(0 = 균등)</span></div>
    <div class="m3-row">발광 <select data-lp-man="side"><option value="direct" ${sel(man.side, 'direct')}>직하(관측 방향)</option><option value="left" ${sel(man.side, 'left')}>측면 왼쪽</option><option value="right" ${sel(man.side, 'right')}>측면 오른쪽</option></select></div>`;
  const res = ui.calc;
  el.innerHTML = `
    <div class="m3-sub">광원</div>
    <div class="m3-row"><select data-lp-kind><option value="none" ${sel(L.kind, 'none')}>지정 안 함</option><option value="step" ${sel(L.kind, 'step')}>LED STEP 불러오기</option><option value="manual" ${sel(L.kind, 'manual')}>관측 라인 따라 직접 배치</option></select></div>
    ${stepHtml}${manHtml}
    ${L.kind === 'none' ? '' : `<div class="m3-row">배광 <select data-lp-spec="model"><option value="lambertian" ${sel(L.spec.model, 'lambertian')}>램버시안</option><option value="gaussian" ${sel(L.spec.model, 'gaussian')}>가우시안</option></select>
      지향각<input type="number" min="10" max="170" step="5" value="${L.spec.beam}" data-lp-spec="beam">° 발광면<input type="number" min="0" step="0.1" value="${L.spec.sizeX}" data-lp-spec="sizeX">×<input type="number" min="0" step="0.1" value="${L.spec.sizeY}" data-lp-spec="sizeY">mm
      PCB 색 <select data-lp-solder>${['백색', '녹색', '흑색'].map((c) => `<option ${c === L.solder ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`}
    <div class="m3-sub">관측면</div>
    <div class="m3-row">${pickBtn('obs', '관측면 클릭(추가/제거)')} <span class="mut">면 ${O.faces.length}개</span> ${O.faces.length ? '<button data-lp-clear>비우기</button>' : ''}</div>
    ${ui.lineInfo ? `<div class="m3-row">${esc(ui.lineInfo)}</div>` : ''}
    ${O.faces.length ? `<div class="m3-row">관측 방향 ${O.dir ? '' : '<span class="mut">(자동: 면 평균 법선)</span>'} x<input type="number" step="0.1" value="${numIn(ui.dir?.[0], 3)}" data-lp-dir="0"> y<input type="number" step="0.1" value="${numIn(ui.dir?.[1], 3)}" data-lp-dir="1"> z<input type="number" step="0.1" value="${numIn(ui.dir?.[2], 3)}" data-lp-dir="2"> ${O.dir ? '<button data-lp-dirauto>자동</button>' : ''}</div>` : ''}
    <div class="m3-row">목표 균일도 길이<input type="number" min="0" max="1" step="0.05" value="${O.targetLen}" data-lp-obs="targetLen"> 폭<input type="number" min="0" max="1" step="0.05" value="${O.targetWid}" data-lp-obs="targetWid"> 가장자리 제외<input type="number" min="0" step="0.1" value="${O.edgeExcl}" data-lp-obs="edgeExcl">mm</div>
    <div class="m3-row">관측 원뿔 ±<input type="number" min="2" max="90" step="1" value="${O.cone}" data-lp-obs="cone">° 격자<input type="number" min="0.2" step="0.1" value="${O.cell}" data-lp-obs="cell">mm <span class="mut">잡음이 크면 격자를 키우거나 정밀 계산</span></div>
    <div class="m3-sub">계산</div>
    <div class="m3-row"><button data-lp-calc="200000" ${res?.busy ? 'disabled' : ''}>빠른 계산(20만)</button> <button data-lp-calc="1000000" ${res?.busy ? 'disabled' : ''}>정밀 계산(100만)</button></div>
    ${res ? `<div class="m3-res ${res.error ? 'err' : ''}">${resultHtml(res)}</div>` : ''}`;
  const on = (q, ev, fn) => el.querySelectorAll(q).forEach((x) => x.addEventListener(ev, () => fn(x)));
  on('[data-lp-kind]', 'change', (x) => h.onLightKind(x.value));
  on('[data-lp-file]', 'change', (x) => { const f = x.files?.[0]; if (f) h.onLedFile(f); x.value = ''; });
  on('[data-lp-pick]', 'click', (x) => h.onPick(ui.pick === x.dataset.lpPick ? null : x.dataset.lpPick));
  on('[data-lp-step]', 'change', (x) => { const v = +x.value; if (Number.isFinite(v)) h.onStep(x.dataset.lpStep, v); });
  on('[data-lp-man]', 'change', (x) => { const k = x.dataset.lpMan; if (k === 'pcbKind' || k === 'side') h.onManual(k, x.value); else { const v = +x.value; if (Number.isFinite(v)) h.onManual(k, v); } });
  on('[data-lp-spec]', 'change', (x) => { const k = x.dataset.lpSpec; if (k === 'model') h.onLedSpec(k, x.value); else { const v = +x.value; if (Number.isFinite(v)) h.onLedSpec(k, v); } });
  on('[data-lp-solder]', 'change', (x) => h.onSolder(x.value));
  on('[data-lp-obs]', 'change', (x) => { const v = +x.value; if (Number.isFinite(v)) h.onObs(x.dataset.lpObs, x.dataset.lpObs === 'cell' ? Math.max(0.2, v) : v); });
  on('[data-lp-clear]', 'click', () => h.onClearObs());
  on('[data-lp-dir]', 'change', () => { const v = [0, 1, 2].map((k) => +el.querySelector(`[data-lp-dir="${k}"]`).value); if (v.every(Number.isFinite) && Math.hypot(...v) > 1e-6) h.onObsDir(v); });
  on('[data-lp-dirauto]', 'click', () => h.onObsDir(null));
  on('[data-lp-calc]', 'click', (x) => h.onCalc(+x.dataset.lpCalc));
}
