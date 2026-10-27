// 명령 막대 — LED 지정 · 관측면 · 계산(일시정지/재개). 나머지는 상단 메뉴(2026-10-27 단순화)
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
  // 단순화(2026-10-27): 자주 쓰는 셋만 — 불러오기·단면·맞춤·평판 전환은 상단 메뉴, 자동설계는 아래 칸
  el.innerHTML = `<button type="button" data-c="led" aria-pressed="false">💡 LED 지정</button><button type="button" data-c="obs" aria-pressed="false">👁 관측면</button>
    <span class="m3-sep"></span><button type="button" data-c="calc">▶ 계산</button>`;
  const b = (k) => el.querySelector(`[data-c="${k}"]`);
  b('led').onclick = () => h.onLed();
  b('obs').onclick = () => h.onObs();
  b('calc').onclick = () => h.onToggleCalc();
  const toggle = (n, on) => {
    if (n.classList.contains('on') !== on) n.classList.toggle('on', on);
    const v = on ? 'true' : 'false';
    if (n.getAttribute('aria-pressed') !== v) n.setAttribute('aria-pressed', v);
  };
  return {
    update(S, calc) {
      toggle(b('led'), S.pick === 'led' || S.pick === 'ledx');
      toggle(b('obs'), S.pick === 'obs');
      const t = calcLabel(calc), cb = b('calc');
      if (cb.textContent !== t) cb.textContent = t;
    },
  };
}
