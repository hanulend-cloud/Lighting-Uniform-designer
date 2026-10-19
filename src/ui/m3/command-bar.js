// 명령 막대 — spec 2026-10-15 m3-cad-ui §2: 기구 불러오기 · LED 지정 · 관측면 · 단면 · 맞춤(F) · 계산 일시정지/재개 · 단축키 안내 · 평판 모드로
// h = { onImport(file), onLed(), onObs(), onSection(), onFit(), onToggleCalc(), onExit() }
export function calcLabel(calc) {
  switch (calc?.state) {
    case 'starting': return '⏸ 장면 준비';
    case 'running': case 'pending': return '⏸ 계산 중';
    case 'paused': return '▶ 계산 재개';
    case 'done': return calc.reason === 'converged' ? '✓ 수렴 — 다시 계산' : '✓ 최대 광자 — 다시 계산';
    case 'error': return '⟳ 다시 계산';
    default: return '▶ 계산';
  }
}
export function mountCommandBar(el, h) {
  el.innerHTML = `<button type="button" class="m3-btn" data-c="import" title="기구설계 STEP(.stp/.step) — 모든 부품을 불러와 바꿈">📂 기구 불러오기</button><input type="file" accept=".stp,.step" hidden data-c="file" aria-label="기구 STEP 파일 선택">
    <button type="button" data-c="led" aria-pressed="false">💡 LED 지정</button><button type="button" data-c="obs" aria-pressed="false">👁 관측면</button>
    <span class="m3-sep"></span><button type="button" data-c="sec" aria-pressed="false">✂ 단면</button><button type="button" data-c="fit" title="단축키 F">⤢ 맞춤(F)</button>
    <span class="m3-sep"></span><button type="button" data-c="calc">▶ 계산</button><button type="button" data-c="auto">✨ 자동설계</button>
    <span class="m3-hint">Esc 선택 해제 · 드래그 회전 · 휠 확대 · 우클릭/Shift 드래그 이동</span>
    <button type="button" data-c="exit">평판 모드로</button>`;
  const b = (k) => el.querySelector(`[data-c="${k}"]`);
  b('import').onclick = () => b('file').click();
  b('file').onchange = (e) => { const f = e.target.files?.[0]; if (f) h.onImport(f); e.target.value = ''; };
  b('led').onclick = () => h.onLed();
  b('obs').onclick = () => h.onObs();
  b('sec').onclick = () => h.onSection();
  b('fit').onclick = () => h.onFit();
  b('calc').onclick = () => h.onToggleCalc();
  b('auto').onclick = () => h.onAuto?.();
  b('exit').onclick = () => h.onExit();
  const toggle = (n, on) => {
    if (n.classList.contains('on') !== on) n.classList.toggle('on', on);
    const v = on ? 'true' : 'false';
    if (n.getAttribute('aria-pressed') !== v) n.setAttribute('aria-pressed', v);
  };
  return {
    update(S, calc) {
      toggle(b('led'), S.pick === 'led' || S.pick === 'ledx');
      toggle(b('obs'), S.pick === 'obs');
      toggle(b('sec'), !!S.section);
      const t = calcLabel(calc), cb = b('calc');
      if (cb.textContent !== t) cb.textContent = t;
    },
  };
}
