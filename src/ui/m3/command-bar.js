// 명령 막대 — spec 2026-10-15 m3-cad-ui §2: 기구 불러오기 · LED 지정 · 관측면 · 단면 · 맞춤(F) · 계산 일시정지/재개 · 단축키 안내 · 평판 모드로
// h = { onImport(file), onLed(), onObs(), onSection(), onFit(), onToggleCalc(), onExit() }
export function calcLabel(calc) {
  switch (calc?.state) {
    case 'running': case 'starting': case 'pending': return '⏸ 계산 중';
    case 'paused': return '▶ 계산 재개';
    case 'done': return calc.reason === 'converged' ? '✓ 수렴 — 다시 계산' : '✓ 최대 광자 — 다시 계산';
    case 'error': return '⟳ 다시 계산';
    default: return '▶ 계산';
  }
}
export function mountCommandBar(el, h) {
  el.innerHTML = `<label class="m3-btn" title="기구설계 STEP(.stp/.step) — 모든 부품을 불러와 바꿈">📂 기구 불러오기<input type="file" accept=".stp,.step" hidden data-c="file"></label>
    <button data-c="led">💡 LED 지정</button><button data-c="obs">👁 관측면</button>
    <span class="m3-sep"></span><button data-c="sec">✂ 단면</button><button data-c="fit" title="단축키 F">⤢ 맞춤(F)</button>
    <span class="m3-sep"></span><button data-c="calc">▶ 계산</button>
    <span class="m3-hint">Esc 선택 해제 · 드래그 회전 · 휠 확대 · 우클릭/Shift 드래그 이동</span>
    <button data-c="exit">평판 모드로</button>`;
  const b = (k) => el.querySelector(`[data-c="${k}"]`);
  b('file').onchange = (e) => { const f = e.target.files?.[0]; if (f) h.onImport(f); e.target.value = ''; };
  b('led').onclick = () => h.onLed();
  b('obs').onclick = () => h.onObs();
  b('sec').onclick = () => h.onSection();
  b('fit').onclick = () => h.onFit();
  b('calc').onclick = () => h.onToggleCalc();
  b('exit').onclick = () => h.onExit();
  return {
    update(S, calc) {
      b('led').classList.toggle('on', S.pick === 'led' || S.pick === 'ledx');
      b('obs').classList.toggle('on', S.pick === 'obs');
      b('sec').classList.toggle('on', !!S.section);
      b('calc').textContent = calcLabel(calc);
    },
  };
}
