// 자동설계 카드 — spec P4 §3. 체크 3개(①②③) · ③ 대상 부품 · [실행]/[중지] · 진행 · 현재|최적 비교 · [적용][취소][되돌리기][STEP]
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');

// Milky 상한 입력 — 0.5~9.9 로 자름. 빈칸·0·음수·NaN = null(기본값)
export const clampCap = (v) => (Number.isFinite(v) && v > 0 ? Math.min(9.9, Math.max(0.5, v)) : null);
// 전체 진행률 — 단계 무게(현재안 5 · ② 35 · ① 35 · ③ 50 · 최종 10)를 켠 단계로 정규화. 순서 = 실행 순서
const STAGE_W = [['current', 5], ['leds', 35], ['milky', 35], ['shape', 50], ['verify', 10]];
export function overallFrac(stages, stage, frac) {
  const on = ([k]) => k === 'current' || k === 'verify' || !!stages?.[k];
  const ws = STAGE_W.filter(on), total = ws.reduce((s, [, w]) => s + w, 0), i = ws.findIndex(([k]) => k === stage);
  if (i < 0) return 0;
  const before = ws.slice(0, i).reduce((s, [, w]) => s + w, 0), f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
  return Math.min(1, (before + ws[i][1] * f) / total);
}
// 남은 시간 — 진행 10% 이상부터 경과 ÷ 진행률로 추정
export const etaText = (elapsedMs, frac) => (frac >= 0.1 && frac < 1 ? `남은 약 ${Math.max(1, Math.round((elapsedMs * (1 - frac)) / frac / 1000))}초` : '');
// 길이 프로파일 비교(현재 회색 · 최적 강조) — 각자 최댓값으로 정규화. NaN 칸은 건너뜀. 하나라도 없으면 ''
export function profileSvg(cur, best, W = 200, H = 48) {
  if (!cur?.length || !best?.length) return '';
  const line = (p, cls, color) => {
    let mx = 0; for (const v of p) if (Number.isFinite(v) && v > mx) mx = v;
    if (!(mx > 0)) return '';
    const n = Math.max(1, p.length - 1), pts = [];
    for (let i = 0; i < p.length; i++) if (Number.isFinite(p[i])) pts.push(`${((i / n) * W).toFixed(1)},${(H - 2 - (p[i] / mx) * (H - 4)).toFixed(1)}`);
    return `<polyline class="${cls}" points="${pts.join(' ')}" fill="none" style="stroke:${color};stroke-width:1.5"/>`;
  };
  const a = line(cur, 'cur', 'var(--m3-mut, #888)'), b = line(best, 'best', 'var(--m3-acc, #2a6)');
  if (!a || !b) return '';
  return `<div class="m3-row"><span class="mut">길이 프로파일(각 최대 = 1) · 회색 현재 · 색 최적</span></div><svg class="m3-ad-prof" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="길이 프로파일 현재 대 최적">${a}${b}</svg>`;
}

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
const progHtml = (running) => {
  const pct = Math.round((running.frac ?? 0) * 100);
  return `<div class="m3-ad-prog"><div class="bar" role="progressbar" aria-label="자동설계 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${esc(running.text)}</span> <button type="button" data-ad="stop">중지</button></div>`;
};
// noLine = 관측 라인 없음(실행 불가) · milkyPart = ① 대상 부품 번호. 실행 중에는 입력을 모두 비활성
export function autoCardHtml({ avail, sel, running, names = [], canRevert = false, noLine = false, milkyPart = null }) {
  const dis = running ? ' disabled' : '', pname = (i) => esc(names[i] ?? `부품 ${i + 1}`);
  const row = ([k, label]) => {
    const a = avail[k];
    return `<label class="m3-ad-item${a.ok ? '' : ' off'}"><input type="checkbox" data-ad="${k}"${sel[k] && a.ok ? ' checked' : ''}${a.ok ? dis : ' disabled'}> ${label}${a.ok ? '' : ` <span class="mut">— ${esc(a.why)}</span>`}</label>`;
  };
  const mTarget = sel.milky && avail.milky.ok && milkyPart != null ? `<div class="m3-row mut">① 대상: ${pname(milkyPart)}</div>` : '';
  const cap = (sel.milky && avail.milky.ok) || (sel.leds && avail.leds.ok) ? `<div class="m3-row">Milky 상한 <input type="number" min="0.5" max="9.9" step="0.5" value="${sel.milkyMax ?? 5}" data-ad="milkyMax" aria-label="Milky 상한"${dis}> <span class="mut">② 는 이 값(확산 최대)에서 개수를 정하고 ① 이 낮춤</span></div>` : '';
  const part = avail.shape.ok ? `<div class="m3-row">③ 대상 <select data-ad="shapePart" aria-label="③ 대상 부품"${dis}>${avail.shape.parts.map((i) => `<option value="${i}"${i === sel.shapePart ? ' selected' : ''}>${pname(i)}</option>`).join('')}</select></div>` : '';
  const any = ITEMS.some(([k]) => sel[k] && avail[k].ok);
  const run = `<button type="button" data-ad="run"${!any || noLine ? ' disabled' : ''}${noLine ? ' title="관측 라인이 없음"' : ''}>▶ 실행</button>`;
  return `<div class="m3-h">자동설계 <span class="mut">체크한 항목만 바꿈 · 순서 ②→①→③</span></div>${ITEMS.map(row).join('')}${mTarget}${cap}${part}
    ${running ? progHtml(running) : `<div class="m3-row">${run}${canRevert ? '<button type="button" data-ad="revert" title="마지막 적용 전 값으로">↶ 되돌리기</button>' : ''}<button type="button" data-ad="close">닫기</button></div>`}`;
}
const shapeText = (s) => `두께 ${s.dt >= 0 ? '+' : ''}${f2(s.dt)} · ${s.h >= 0 ? '포켓' : '돌출'} ${f2(Math.abs(s.h))} · R ${f2(s.R)} mm`;
// 비교표 — cur/best = { count, pitch, milky, Ulen, Uwid, eff, profile? }, shape = { dt, h, R } | null, cur.shape = 이미 적용된 형상(없으면 원본)
// stepLeds = LED STEP 발광점 수(직접 배치면 null) · unchanged = 최종안이 현재안 그대로(나은 설계 없음) → 사유 표시 · [적용] 비활성
export function compareHtml({ cur, best, feasible, reason, shape, stepLeds = null, canRevert = false, unchanged = false }) {
  const tr = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td class="${a !== b ? 'chg' : ''}">${b}</td></tr>`;
  const led = (x) => (stepLeds != null ? `LED STEP ${stepLeds}개` : `${x.count}개 ${x.pitch > 0 ? `피치 ${x.pitch}` : '균등'}`);   // STEP 은 ② 불가 — 두 열 같음
  const curShape = cur.shape ? `적용된 형상 · ${shapeText(cur.shape)}` : '원본';
  return `<div class="m3-h">${unchanged ? '현재안 유지' : feasible ? '최적안' : '가장 가까운 안'} <span class="mut">${esc(reason)}</span></div>
    <table class="m3-cmp"><tr><th></th><th>현재</th><th>최적</th></tr>
      ${tr('LED', led(cur), led(best))}
      ${tr('Milky', f2(cur.milky), f2(best.milky))}
      ${tr('길이 U', f2(cur.Ulen), f2(best.Ulen))}${tr('폭 U', f2(cur.Uwid), f2(best.Uwid))}
      ${tr('광 효율', `${f2(cur.eff * 100)}%`, `${f2(best.eff * 100)}%`)}
      ${shape || cur.shape ? tr('형상', curShape, shape ? shapeText(shape) : curShape) : ''}
    </table>${profileSvg(cur.profile, best.profile)}
    <div class="m3-row"><button type="button" data-ad="apply"${unchanged ? ' disabled title="현재안과 같음"' : ''}>적용</button><button type="button" data-ad="cancel">취소</button>${shape ? '<button type="button" data-ad="step">STEP 내보내기</button>' : ''}${canRevert ? '<button type="button" data-ad="revert">되돌리기</button>' : ''}</div>`;
}

// el 에 카드를 그리고 이벤트를 h 로 넘긴다. state = { avail, sel, running, result, names, canRevert, noLine, milkyPart }
// 실행 중 카드 구조가 같으면 진행 막대·문구만 바꿈(갱신마다 innerHTML 을 다시 만들지 않게)
export function renderAutoPanel(el, state, h) {
  const html = state.result ? compareHtml({ ...state.result, canRevert: state.canRevert }) : autoCardHtml(state);
  const key = state.result ? html : autoCardHtml({ ...state, running: state.running ? { frac: 0, text: '' } : null });
  const bar = state.running && !state.result && el._adKey === key ? el.querySelector('.m3-ad-prog .bar') : null;
  if (bar) {
    const pct = Math.round((state.running.frac ?? 0) * 100);
    bar.setAttribute('aria-valuenow', String(pct)); bar.firstElementChild.style.width = `${pct}%`;
    el.querySelector('.m3-ad-prog span').textContent = state.running.text ?? '';
    return;
  }
  el._adKey = key; el.innerHTML = html;
  el.querySelectorAll('[data-ad]').forEach((x) => {
    const k = x.dataset.ad;
    if (x.type === 'checkbox') x.onchange = () => h.onSel(k, x.checked);
    else if (x.tagName === 'SELECT' || x.type === 'number') x.onchange = () => h.onSel(k, x.value === '' ? NaN : +x.value);
    else x.onclick = () => h.onAction(k);
  });
}
