// 자동설계 카드 — spec P4 §3. 체크 3개(①②③) · ③ 대상 부품 · [실행]/[중지] · 진행 · 현재|최적 비교 · [적용][취소][되돌리기][STEP]
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');

// M = spec.mech3d, info.non25[i] = 부품 i 의 비 2.5D 비율(관측 방향, app 이 frameHeights 로 계산)
export function stageAvailability(M, info) {
  const milkyParts = M.parts.map((p, i) => (p.material.kind === 'milky' ? i : -1)).filter((i) => i >= 0);
  const shapeParts = M.parts.map((p, i) => (p.material.kind !== 'opaque' && (info.non25?.[i] ?? 1) <= 0.02 ? i : -1)).filter((i) => i >= 0);
  return {
    milky: milkyParts.length ? { ok: true, parts: milkyParts } : { ok: false, why: 'Milky 부품이 없음 — 부품 소재를 Milky 로 지정하세요' },
    leds: M.light.kind === 'manual' ? { ok: true } : { ok: false, why: M.light.kind === 'step' ? 'LED STEP 은 위치가 고정 — 직접 배치에서만 쓸 수 있음' : '광원을 직접 배치로 지정하세요' },
    shape: shapeParts.length ? { ok: true, parts: shapeParts } : { ok: false, why: '관측 방향으로 2.5D 인 투과 부품이 없음' },
  };
}
const ITEMS = [['milky', '① Milky 레벨'], ['leds', '② LED 개수·피치'], ['shape', '③ LGP 형상']];
export function autoCardHtml({ avail, sel, running, names = [], canRevert = false }) {
  const row = ([k, label]) => {
    const a = avail[k];
    return `<label class="m3-ad-item${a.ok ? '' : ' off'}"><input type="checkbox" data-ad="${k}"${sel[k] && a.ok ? ' checked' : ''}${a.ok ? '' : ' disabled'}> ${label}${a.ok ? '' : ` <span class="mut">— ${esc(a.why)}</span>`}</label>`;
  };
  const cap = (sel.milky && avail.milky.ok) || (sel.leds && avail.leds.ok) ? `<div class="m3-row">Milky 상한 <input type="number" min="0.5" max="9.9" step="0.5" value="${sel.milkyMax ?? 5}" data-ad="milkyMax"> <span class="mut">② 는 이 값(확산 최대)에서 개수를 정하고 ① 이 낮춤</span></div>` : '';
  const part = avail.shape.ok ? `<div class="m3-row">③ 대상 <select data-ad="shapePart">${avail.shape.parts.map((i) => `<option value="${i}"${i === sel.shapePart ? ' selected' : ''}>${esc(names[i] ?? `부품 ${i + 1}`)}</option>`).join('')}</select></div>` : '';
  const prog = running ? `<div class="m3-ad-prog"><div class="bar"><i style="width:${Math.round((running.frac ?? 0) * 100)}%"></i></div><span>${esc(running.text)}</span> <button type="button" data-ad="stop">중지</button></div>` : '';
  const any = ITEMS.some(([k]) => sel[k] && avail[k].ok);
  return `<div class="m3-h">자동설계 <span class="mut">체크한 항목만 바꿈 · 순서 ②→①→③</span></div>${ITEMS.map(row).join('')}${cap}${part}
    ${running ? prog : `<div class="m3-row"><button type="button" data-ad="run"${any ? '' : ' disabled'}>▶ 실행</button>${canRevert ? '<button type="button" data-ad="revert" title="마지막 적용 전 값으로">↶ 되돌리기</button>' : ''}<button type="button" data-ad="close">닫기</button></div>`}`;
}
// 비교표 — cur/best = { count, pitch, milky, Ulen, Uwid, eff, lum? }, shape = { dt, h, R } | null, stepLeds = LED STEP 발광점 수(직접 배치면 null)
// unchanged = 최종안이 현재안 그대로(나은 설계 없음) → 사유 표시 · [적용] 비활성
export function compareHtml({ cur, best, feasible, reason, shape, stepLeds = null, canRevert = false, unchanged = false }) {
  const tr = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td class="${a !== b ? 'chg' : ''}">${b}</td></tr>`;
  const led = (x) => (stepLeds != null ? `LED STEP ${stepLeds}개` : `${x.count}개 ${x.pitch > 0 ? `피치 ${x.pitch}` : '균등'}`);   // STEP 은 ② 불가 — 두 열 같음
  return `<div class="m3-h">${unchanged ? '현재안 유지' : feasible ? '최적안' : '가장 가까운 안'} <span class="mut">${esc(reason)}</span></div>
    <table class="m3-cmp"><tr><th></th><th>현재</th><th>최적</th></tr>
      ${tr('LED', led(cur), led(best))}
      ${tr('Milky', f2(cur.milky), f2(best.milky))}
      ${tr('길이 U', f2(cur.Ulen), f2(best.Ulen))}${tr('폭 U', f2(cur.Uwid), f2(best.Uwid))}
      ${tr('광 효율', `${f2(cur.eff * 100)}%`, `${f2(best.eff * 100)}%`)}
      ${shape ? tr('형상', '원본', `두께 ${shape.dt >= 0 ? '+' : ''}${f2(shape.dt)} · ${shape.h >= 0 ? '포켓' : '돌출'} ${f2(Math.abs(shape.h))} · R ${f2(shape.R)} mm`) : ''}
    </table>
    <div class="m3-row"><button type="button" data-ad="apply"${unchanged ? ' disabled title="현재안과 같음"' : ''}>적용</button><button type="button" data-ad="cancel">취소</button>${shape ? '<button type="button" data-ad="step">STEP 내보내기</button>' : ''}${canRevert ? '<button type="button" data-ad="revert">되돌리기</button>' : ''}</div>`;
}

// el 에 카드를 그리고 이벤트를 h 로 넘긴다. state = { avail, sel, running, result, names, canRevert }
export function renderAutoPanel(el, state, h) {
  el.innerHTML = state.result ? compareHtml({ ...state.result, canRevert: state.canRevert }) : autoCardHtml(state);
  el.querySelectorAll('[data-ad]').forEach((x) => {
    const k = x.dataset.ad;
    if (x.type === 'checkbox') x.onchange = () => h.onSel(k, x.checked);
    else if (x.tagName === 'SELECT' || x.type === 'number') x.onchange = () => h.onSel(k, +x.value);
    else x.onclick = () => h.onAction(k);
  });
}
