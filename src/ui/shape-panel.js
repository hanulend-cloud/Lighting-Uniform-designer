// 기구 그룹 — L3 몸체 출처(생성 평판 / 불러온 STEP) 제어와 형상 정보 (형상 몸체 spec §6).
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// h = { onFile(file), onFlip(), onRot(), onClear() }
export function mountShapeControls(el, h) {
  el.innerHTML = `
    <label class="shape-btn" title="기구설계 STEP(.stp/.step) — 가장 큰 솔리드 1개를 L3 몸체로 사용">STEP 불러오기<input type="file" accept=".stp,.step" hidden data-sh="file"></label>
    <button class="shape-btn" data-sh="flip" title="출광면(+Z)이 반대면 뒤집기 — X축 180° 회전">Z 뒤집기</button>
    <button class="shape-btn" data-sh="rot" title="XY 90° 회전">90°</button>
    <button class="shape-btn" data-sh="clear" title="불러온 형상 해제 — L1 두께의 생성 평판으로">평판으로</button>
    <span class="shape-info" data-sh="info"></span>`;
  el.querySelector('[data-sh="file"]').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) h.onFile(f); e.target.value = ''; });
  el.querySelector('[data-sh="flip"]').onclick = h.onFlip;
  el.querySelector('[data-sh="rot"]').onclick = h.onRot;
  el.querySelector('[data-sh="clear"]').onclick = h.onClear;
}

export function setShapeStatus(el, text, cls = '') {
  const s = el?.querySelector('[data-sh="info"]'); if (!s) return;
  s.className = `shape-info ${cls}`; s.textContent = text;
}

// info = runtime.bodyInfo(spec) | null, shape = spec.body.shape, l3On
export function renderShapeInfo(el, info, shape, l3On) {
  const s = el?.querySelector('[data-sh="info"]'); if (!s) return;
  const busy = s.classList.contains('busy');
  if (busy) return;
  ['flip', 'rot', 'clear'].forEach((k) => { el.querySelector(`[data-sh="${k}"]`).disabled = !info; });
  if (!info) { s.className = 'shape-info'; s.innerHTML = 'L3 몸체: 생성 평판(L1 두께)'; return; }
  s.className = 'shape-info';
  s.innerHTML = `L3 몸체: <b>${esc(info.name)}</b> ${info.size.x.toFixed(1)}×${info.size.y.toFixed(1)}×${info.size.z.toFixed(1)}mm · 두께 ${info.thk[0].toFixed(2)}~${info.thk[1].toFixed(2)}mm`
    + `${shape.flipZ ? ' · 뒤집힘' : ''}${shape.rot ? ` · ${shape.rot * 90}°` : ''}${l3On ? '' : ' · <span class="warn">L3 꺼짐 — 켜야 적용</span>'}`
    + `<span class="mut"> · 광학 계산 반영은 다음 단계(S1·S2) — 지금은 형상 표시만</span>`
    + info.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
}
