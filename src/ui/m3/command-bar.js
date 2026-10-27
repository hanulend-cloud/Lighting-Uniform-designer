// 명령 막대 — ① LED 지정 ② 관측면 지정 ③ 목표 설정(사용 순서). 나머지는 상단 메뉴. calcLabel = 계산 카드의 제어 단추 문구
// h = { onLed(), onObs(), onTarget() }
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
// 사용 순서대로 ① LED 지정 → ② 관측면 지정 → ③ 목표 설정(2026-10-27). 끝난 단계는 ✓. 계산 제어는 오른쪽 위 '현재 설계 계산' 카드로 옮김
export function stepState(M) {
  const L = M.light, led = L.kind === 'step' ? (L.step?.emitters?.length ?? 0) > 0 : L.kind === 'manual';
  const O = M.observe, tgOk = O.targetLen > 0 && O.targetWid > 0;   // 목표 둘 다 입력됨 = ✓
  return { led, obs: (O.faces?.length ?? 0) > 0, tgOk, tgt: `${Math.round(O.targetLen * 100)}% / ${Math.round(O.targetWid * 100)}%` };
}
export function mountCommandBar(el, h) {
  let lastStats = null;
  el.innerHTML = `<button type="button" class="m3-step" data-c="led" aria-pressed="false"><i>1</i> LED 지정</button><span class="m3-arrow">›</span>
    <button type="button" class="m3-step" data-c="obs" aria-pressed="false"><i>2</i> 관측면 지정</button><span class="m3-arrow">›</span>
    <button type="button" class="m3-step" data-c="tgt" aria-pressed="false"><i>3</i> 목표 설정 <span class="mut" data-tgt></span></button><span class="m3-now" data-now title="지금 계산 결과 — 길이 U / 폭 U (초록 = 목표 통과)"></span>`;
  const b = (k) => el.querySelector(`[data-c="${k}"]`);
  b('led').onclick = () => h.onLed();
  b('obs').onclick = () => h.onObs();
  b('tgt').onclick = () => h.onTarget();
  const toggle = (n, on) => {
    if (n.classList.contains('on') !== on) n.classList.toggle('on', on);
    const v = on ? 'true' : 'false';
    if (n.getAttribute('aria-pressed') !== v) n.setAttribute('aria-pressed', v);
  };
  return {
    // S = 세션, M = 설계(단계 완료 표시), stats = 지금 계산 결과(없으면 마지막 값 유지)
    update(S, M, stats) {
      if (stats !== undefined) lastStats = stats;
      toggle(b('led'), S.pick === 'led' || S.pick === 'ledx' || S.pick === 'mled');
      toggle(b('obs'), S.pick === 'obs');
      toggle(b('tgt'), S.node === 'target');
      if (!M) return;
      const st = stepState(M);
      [['led', st.led, '1'], ['obs', st.obs, '2'], ['tgt', st.tgOk, '3']].forEach(([k, d, n]) => { const x = b(k); x.classList.toggle('done', d); const i = x.querySelector('i'); if (i.textContent !== (d ? '✓' : n)) i.textContent = d ? '✓' : n; });
      const t = el.querySelector('[data-tgt]'); if (t.textContent !== st.tgt) t.textContent = st.tgt;
      // 옆에 지금 결과: 길이 U / 폭 U(%) — 목표 통과면 초록, 미달이면 빨강
      const n = el.querySelector('[data-now]'), s = lastStats, pc = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–');
      const html = s && !s.empty ? `현재 <b class="${s.Ulen >= M.observe.targetLen ? 'ok' : 'bad'}">${pc(s.Ulen)}</b> / <b class="${s.Uwid == null || s.Uwid >= M.observe.targetWid ? 'ok' : 'bad'}">${pc(s.Uwid)}</b>` : '<span class="mut">현재 –</span>';
      if (n.innerHTML !== html) n.innerHTML = html;
    },
  };
}
