// 설계변경 — L2~L5(선택·조합 가능)를 한 화면에 카드로 표시. L1(두께)은 광학과 무관해
// 필수 입력바(몸체두께)로 옮겨졌으므로 여기서는 다루지 않는다.
// 각 카드: 체크박스 on/off + 핵심 파라미터(항상 노출) + 고급 파라미터(토글로 접힘) + 결과.
import { fitCanvas, PAD } from './canvas-util.js';
import { LEVEL_SCHEMA } from '../model/levels.js';

const ORDER = [2, 3, 4, 5];

function fieldHtml(l, f, cur) {
  const inp = f.type === 'select'
    ? `<select data-l="${l}" data-f="${f.key}">${f.options.map((o) => `<option${o === cur ? ' selected' : ''}>${o}</option>`).join('')}</select>`
    : `<input type="number" data-l="${l}" data-f="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${cur ?? ''}">`;
  return `<label>${f.label}${f.unit ? `<i>${f.unit}</i>` : ''}${inp}</label>`;
}

// 한 번만 build. onToggle(l, checked) / onParam(l, f, v)
export function buildLevels(el, spec, onToggle, onParam) {
  el.innerHTML = ORDER.map((l) => {
    const s = LEVEL_SCHEMA[l];
    const v = { ...spec.levels[l] };
    const core = s.fields.filter((f) => !f.adv).map((f) => fieldHtml(l, f, v[f.key])).join('');
    const advList = s.fields.filter((f) => f.adv);
    const adv = advList.map((f) => fieldHtml(l, f, v[f.key])).join('');
    return `<div class="lv" data-lv="${l}">
      <div class="lv-hd">
        <label class="lv-on"><input type="checkbox" data-l="${l}"${v.on ? ' checked' : ''}></label>
        <span class="lv-code">L${l}</span><span class="lv-nm">${s.label}</span>
        <span class="lv-badge" data-badge="${l}">—</span>
      </div>
      <div class="lv-stats" data-pitch="${l}"></div>
      <div class="lv-role">${s.hint}</div>
      <div class="lv-f">${core}</div>
      ${advList.length ? `<span class="lv-adv-toggle" data-adv-toggle="${l}">고급 ▾</span>
      <div class="lv-f lv-f-adv" data-adv="${l}" hidden>${adv}</div>` : ''}
      <div class="lv-auto-wrap" data-auto="${l}"></div>
    </div>`;
  }).join('');

  el.querySelectorAll('.lv-on input').forEach((cb) => {
    cb.addEventListener('change', () => onToggle(+cb.dataset.l, cb.checked));
  });
  el.querySelectorAll('[data-f]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const l = +inp.dataset.l, f = inp.dataset.f;
      const sel = inp.tagName === 'SELECT';
      const val = sel ? inp.value : parseFloat(inp.value);
      if (!sel && Number.isNaN(val)) return;
      onParam(l, f, val);
    });
  });
  el.querySelectorAll('[data-adv-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = el.querySelector(`.lv-f-adv[data-adv="${btn.dataset.advToggle}"]`);
      panel.hidden = !panel.hidden;
      btn.textContent = panel.hidden ? '고급 ▾' : '고급 ▴';
    });
  });
}

// 자동탐색으로 찾은 레벨 고유 파라미터를 "필드명 값단위" 로 나열 (workability 판단용)
function fmtAutoParams(level, params) {
  const schema = LEVEL_SCHEMA[level];
  if (!schema || !params) return '';
  return schema.fields.map((f) => {
    const v = params[f.key];
    const shown = f.type === 'select' ? v : v.toFixed(f.step < 1 ? 1 : 0);
    return `${f.label} ${shown}${f.unit ?? ''}`;
  }).join(' · ');
}

// 매 계산: 카드별 단독 결과(= 현재 슬라이더 값 기준, 항상 반응) + 활성 표시 + 참고용 자동탐색치.
// onApply(level, params) 가 있으면 자동탐색 결과 옆에 '적용' 버튼을 붙여 슬라이더로 복사할 수 있게 한다.
export function updateLevels(el, solo, activeSet, target, onApply) {
  for (const r of solo) {
    const row = el.querySelector(`.lv[data-lv="${r.level}"]`);
    if (!row) continue;
    row.classList.toggle('on', activeSet.has(r.level));
    const ok = r.U0 >= target;

    const badge = row.querySelector('.lv-badge');
    badge.textContent = `${r.leds}개`;
    badge.className = `lv-badge ${ok ? 'ok' : 'ng'}`;

    // 단독 조건 결과 — LED개수(배지) 옆에 Pitch X·Y·균일도를 라벨 붙은 칩으로 나란히 표시
    // ("공학적 OUT"처럼 값을 바로 읽을 수 있게: 라벨은 작게, 수치는 굵게).
    const pitchChips = r.pitchY == null
      ? `<span class="lv-stat"><i>Pitch</i><b>${r.pitchX.toFixed(0)}</b>mm</span>`
      : `<span class="lv-stat"><i>Pitch X</i><b>${r.pitchX.toFixed(0)}</b>mm</span>
         <span class="lv-stat"><i>Pitch Y</i><b>${r.pitchY.toFixed(0)}</b>mm</span>`;
    const statsEl = row.querySelector('.lv-stats');
    statsEl.innerHTML = `${pitchChips}
      <span class="lv-stat ${ok ? 'ok' : 'ng'}"><i>균일도</i><b>${(r.U0 * 100).toFixed(0)}</b>%${ok ? '' : ' 미달'}</span>`;

    const autoWrap = row.querySelector('.lv-auto-wrap');
    if (!r.auto) { autoWrap.innerHTML = ''; continue; }
    const a = r.auto;
    const aTag = a.feasible ? '최소가능(자동)' : '최대확산으로도 미달';
    autoWrap.innerHTML = `<span class="mut">${aTag} <b>${a.leds}</b>개 · ${(a.U0 * 100).toFixed(0)}%
      · ${fmtAutoParams(r.level, a.params)} · 투과율 ${(a.transmit * 100).toFixed(0)}%</span>
      <button class="lv-apply" data-l="${r.level}">적용</button>`;
    if (onApply) autoWrap.querySelector('.lv-apply').onclick = () => onApply(r.level, a.params);
  }
}

// 조합(활성) 결과 판정 — 달성/미달은 '균일도 = min/max (최대·최소 광량비)' 목표로 판정.
export function renderVerdict(el, combo, tags, goalSpec) {
  const met = combo.feasible;
  el.className = met ? 'ok' : 'ng';
  const name = tags.length ? tags.join(' + ') : '기본 평판';
  const pitchVal = combo.pitchY == null
    ? `${combo.pitchX.toFixed(0)}<i>mm(선형)</i>`
    : `${combo.pitchX.toFixed(0)}<i>×</i>${combo.pitchY.toFixed(0)}<i>mm</i>`;
  const cvW = combo.cv > goalSpec.cvMax ? ' ⚠' : '';
  const gW = combo.grad > goalSpec.gradMax ? ' ⚠' : '';
  const T = (combo.transmit * 100).toFixed(0);
  const ledSub = met ? `<span class="mut">(${combo.nx}×${combo.ny})</span>` : '<span class="mut">(최소 피치로도 부족)</span>';
  const overhangLine = combo.overhang > 0.001
    ? `<div class="v-sub">기구 크기 <b>${combo.fixtureX.toFixed(0)}×${combo.fixtureY.toFixed(0)}mm</b> (타겟 대비 +${(combo.overhang * 100).toFixed(0)}%, 가장자리 보강용 오버행)</div>`
    : '';
  // 최종(조합) 결과 — LED 개수 · Pitch X·Y · 균일도를 같은 비중의 카드 3개로 나란히 표시
  // ("공학적 OUT": 라벨+수치가 명확히 구분되는 스펙시트 형태).
  el.innerHTML = `
    <div class="v-hd">적용 조합: <b>${name}</b> · 목표 균일도(min/max) ${(combo.target * 100).toFixed(0)}%
      <span class="v-status ${met ? 'ok' : 'ng'}">${met ? '목표 달성' : '목표 미달'}</span></div>
    <div class="v-stats">
      <div class="v-stat-box"><span class="lbl">LED 개수</span><span class="val">${combo.leds}<i>개</i></span>${ledSub}</div>
      <div class="v-stat-box"><span class="lbl">Pitch X·Y</span><span class="val">${pitchVal}</span></div>
      <div class="v-stat-box ${met ? 'ok' : 'ng'}"><span class="lbl">균일도</span><span class="val">${(combo.U0 * 100).toFixed(1)}<i>%</i></span></div>
    </div>
    <div class="v-sub">투과율 ${T}%</div>
    ${overhangLine}
    ${met ? '' : '<div class="v-sub hint">→ 측벽반사↑(기구) · 오버행↑ · 확산 적용(L2 Milky·L3~5) · 깊이 조정</div>'}
    <div class="v-sub">참고 — min/avg ${(combo.minAvg * 100).toFixed(0)}% · CV ${(combo.cv * 100).toFixed(1)}%${cvW} · 인접변화율 ${(combo.grad * 100).toFixed(1)}%${gW}</div>`;
}

// X·Y 양방향 조도 프로파일 — 각 방향의 'LED열 위' + 'LED 사이' 라인
export function drawProfiles(canvas, res, target) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, w, h);
  const { field, nx, ny, extent, leds } = res;
  const avg = res.metrics?.avg || (field.reduce((a, b) => a + b, 0) / field.length) || 1;

  const near = (arr, c) => (arr.length ? arr.reduce((b, v) => (Math.abs(v - c) < Math.abs(b - c) ? v : b), arr[0]) : c);
  const cx = (extent.x0 + extent.x1) / 2, cy = (extent.y0 + extent.y1) / 2;
  const xs = [...new Set((leds || []).map((p) => p.x))].sort((a, b) => a - b);
  const ysL = [...new Set((leds || []).map((p) => p.y))].sort((a, b) => a - b);
  const toI = (x) => clamp(Math.round((x - extent.x0) / (extent.x1 - extent.x0) * (nx - 1)), 0, nx - 1);
  const toJ = (y) => (ny <= 1 ? 0 : clamp(Math.round((y - extent.y0) / (extent.y1 - extent.y0) * (ny - 1)), 0, ny - 1));

  const rowAt = (j) => { const r = []; for (let i = 0; i < nx; i++) r.push(field[j * nx + i] / avg); return r; };
  const colAt = (i) => { const c = []; for (let j = 0; j < ny; j++) c.push(field[j * nx + i] / avg); return c; };

  // X방향 (행): LED 행 위 / 행 사이
  const ledY = near(ysL, cy);
  const rowP = ysL.length >= 2 ? ysL[1] - ysL[0] : 0;
  const xLed = rowAt(toJ(ledY));
  const xBtw = rowP ? rowAt(toJ(ledY + rowP / 2)) : null;

  // Y방향 (열): LED 열 위 / 열 사이
  const ledX = near(xs, cx);
  const colP = xs.length >= 2 ? xs[1] - xs[0] : 0;
  const yLed = colAt(toI(ledX));
  const yBtw = colP ? colAt(toI(ledX + colP / 2)) : null;

  const all = [...xLed, ...(xBtw || []), ...yLed, ...(yBtw || [])];
  const top = Math.max(1.35, Math.max(...all) * 1.05);
  const plotL = PAD.L, plotR = w - PAD.R, plotT = PAD.T, plotB = h - PAD.B;
  const midX = (plotL + plotR) / 2;
  const py = (v) => plotT + (plotB - plotT) * (1 - v / top);
  const pxIn = (i, n, l, r) => l + i / (n - 1) * (r - l);

  // 배경 격자 + 좌우 분할 + 목표선
  ctx.strokeStyle = '#20293c'; ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = plotT + (plotB - plotT) * k / 4; ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(midX, plotT); ctx.lineTo(midX, plotB); ctx.stroke();
  ctx.strokeStyle = '#e0b64a'; ctx.setLineDash([5, 3]);
  ctx.beginPath(); ctx.moveTo(plotL, py(target)); ctx.lineTo(plotR, py(target)); ctx.stroke(); ctx.setLineDash([]);

  const draw = (arr, l, r, color, dash) => {
    if (!arr) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash(dash || []);
    ctx.beginPath();
    arr.forEach((v, i) => { const x = pxIn(i, arr.length, l, r); i ? ctx.lineTo(x, py(v)) : ctx.moveTo(x, py(v)); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  draw(xBtw, plotL, midX - 4, '#3f6c9c', [4, 3]);
  draw(xLed, plotL, midX - 4, '#5ee0b0');
  draw(yBtw, midX + 4, plotR, '#3f6c9c', [4, 3]);
  draw(yLed, midX + 4, plotR, '#86b0ff');

  const mn = (a) => Math.min(...a);
  ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillStyle = '#5ee0b0'; ctx.fillText(`X축  (LED열 min ${(mn(xLed) * 100).toFixed(0)}% / 사이 ${xBtw ? (mn(xBtw) * 100).toFixed(0) + '%' : '–'})`, plotL, 13);
  ctx.fillStyle = '#86b0ff'; ctx.textAlign = 'right';
  ctx.fillText(`Y축  (LED열 min ${(mn(yLed) * 100).toFixed(0)}% / 사이 ${yBtw ? (mn(yBtw) * 100).toFixed(0) + '%' : '–'})`, plotR, 13);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e0b64a';
  ctx.fillText(`목표 ${(target * 100).toFixed(0)}% ·  실선=LED열  ┄점선=LED사이  (avg=1)`, midX, plotB + 16);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function line(ctx, arr, px, py, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  arr.forEach((v, i) => (i ? ctx.lineTo(px(i, arr.length), py(v)) : ctx.moveTo(px(i, arr.length), py(v))));
  ctx.stroke();
}
