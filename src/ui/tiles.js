// 수치 타일 + Top 2 옵션 카드

export function renderTiles(el, m, grad, goal, res, cost) {
  const pct = (x) => (x * 100).toFixed(0) + '%';
  const tile = (label, val, ok) =>
    `<div class="tile ${ok === undefined ? '' : ok ? 'ok' : 'ng'}">
       <span class="tv">${val}</span><span class="tl">${label}</span></div>`;

  el.innerHTML =
    tile('U0 (min/avg)', pct(m.U0), goal.U0.pass) +
    tile('CV(RMSE)', pct(m.cv), goal.cv.pass) +
    tile('국부 gradient', pct(grad), goal.grad.pass) +
    tile('E_min/E_max', pct(m.minMax)) +
    tile('LED 수량', res.leds.length) +
    tile('예상 단가', cost.unit.toFixed(2)) +
    tile('배열', res.dim) +
    tile('난이도 점수', cost.difficultyScore.toFixed(1));
}

export function renderTop2(el, summaryEl, opt, onPick) {
  el.innerHTML = opt.top2.map((r, i) => `
    <button class="opt" data-i="${i}">
      <b>${r.reason}</b>
      <span>피치 ${r.pitch.toFixed(0)}mm · 깊이 ${r.depth.toFixed(0)}mm · L${r.level} · LED ${r.ledCount}</span>
      <span>U0 ${(r.U0 * 100).toFixed(0)}% · CV ${(r.cv * 100).toFixed(0)}% · 단가 ${r.unitCost.toFixed(2)}</span>
    </button>`).join('') || '<p class="muted">조건을 만족하는 안 없음 (근접안 표시)</p>';

  el.querySelectorAll('.opt').forEach((b) => {
    b.onclick = () => onPick(opt.top2[+b.dataset.i]);
  });

  const s = opt.sensitivity;
  summaryEl.textContent =
    `실현안 ${opt.feasibleCount} / Pareto ${opt.pareto.length} · 민감도(U0) 피치 ${(s.pitch * 100).toFixed(0)}%p · 깊이 ${(s.depth * 100).toFixed(0)}%p · 난이도 ${(s.level * 100).toFixed(0)}%p`;
}
