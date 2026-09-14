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
  // 라벨(이름+단위)을 입력칸 위에 한 줄로, 입력칸은 그 아래 칸 너비 전체 — 그리드 셀 안에서
  // 라벨 길이에 상관없이 입력칸 크기가 항상 일정하게 커 보이도록.
  return `<label><span class="lv-f-lbl">${f.label}${f.unit ? `<i>${f.unit}</i>` : ''}</span>${inp}</label>`;
}

// HTML 속성(title 툴팁)에 안전하게 넣기 위한 최소 이스케이프
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// 한 번만 build. onToggle(l, checked) / onParam(l, f, v)
export function buildLevels(el, spec, onToggle, onParam) {
  el.innerHTML = ORDER.map((l) => {
    const s = LEVEL_SCHEMA[l];
    const v = { ...spec.levels[l] };
    const core = s.fields.filter((f) => !f.adv).map((f) => fieldHtml(l, f, v[f.key])).join('');
    const advList = s.fields.filter((f) => f.adv);
    const adv = advList.map((f) => fieldHtml(l, f, v[f.key])).join('');
    const tip = escAttr(s.hint + (s.desc ? `\n\n${s.desc}` : ''));
    return `<div class="lv" data-lv="${l}">
      <div class="lv-hd">
        <label class="lv-on"><input type="checkbox" data-l="${l}"${v.on ? ' checked' : ''}></label>
        <span class="lv-code">L${l}</span><span class="lv-nm">${s.label}</span>
        <span class="lv-info" title="${tip}">ⓘ</span>
        <span class="lv-badges">
          <span class="lv-badge" data-badge="${l}" title="LED 개수">—</span>
          <span class="lv-badge lv-badge-u" data-badge-u="${l}" title="균일도">—</span>
        </span>
      </div>
      <div class="lv-stats" data-pitch="${l}"></div>
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
    const ok = r.feasible ?? (r.U0 >= target);          // 중심부 우선 판정

    // 소제목(레벨명) 바로 옆에 LED 개수·균일도 상태를 배지 2개로 함께 표시 — 한눈에 판정 확인.
    const badge = row.querySelector('.lv-badge');
    badge.textContent = `${r.leds}개`;
    badge.className = `lv-badge ${ok ? 'ok' : 'ng'}`;

    const uTxt = ok ? (r.fullPass === false ? '전체미달' : '') : '미달';
    const badgeU = row.querySelector('.lv-badge-u');
    badgeU.textContent = `균일 ${((r.U0c ?? r.U0) * 100).toFixed(0)}%${uTxt ? ` ${uTxt}` : ''}`;
    badgeU.className = `lv-badge lv-badge-u ${ok ? 'ok' : 'ng'}`;
    badgeU.title = `중심부 ${((r.U0c ?? r.U0) * 100).toFixed(1)}% · 전체 ${(r.U0 * 100).toFixed(1)}%`;

    // 참고 수치(Pitch X·Y) — 입력칸과 겹치지 않게 작은 칩으로만 보조 표시
    const pitchChips = r.pitchY == null
      ? `<span class="lv-stat"><i>Pitch</i><b>${r.pitchX.toFixed(0)}</b>mm</span>`
      : `<span class="lv-stat"><i>Pitch X</i><b>${r.pitchX.toFixed(0)}</b>mm</span>
         <span class="lv-stat"><i>Pitch Y</i><b>${r.pitchY.toFixed(0)}</b>mm</span>`;
    row.querySelector('.lv-stats').innerHTML = pitchChips;

    const autoWrap = row.querySelector('.lv-auto-wrap');
    if (!r.auto) { autoWrap.innerHTML = ''; continue; }
    const a = r.auto;
    const aTag = a.feasible ? (a.belowMinLeds ? '최소가능(자동, LED 하한 미만)' : '최소가능(자동)') : '최대확산으로도 미달';
    autoWrap.innerHTML = `<span class="mut">${aTag} <b>${a.leds}</b>개 · 중심 ${((a.U0c ?? a.U0) * 100).toFixed(0)}% / 전체 ${(a.U0 * 100).toFixed(0)}%
      · ${fmtAutoParams(r.level, a.params)} · 투과율 ${(a.transmit * 100).toFixed(0)}%</span>
      <button class="lv-apply" data-l="${r.level}">적용</button>`;
    if (onApply) autoWrap.querySelector('.lv-apply').onclick = () => onApply(r.level, a.params);
  }
}

// 조합(활성) 결과 판정 — 달성/미달은 '균일도 = min/max (최대·최소 광량비)' 목표로 판정.
export function renderVerdict(el, combo, tags, goalSpec) {
  const met = combo.feasible;                       // 중심부(경계에서 깊이만큼 안쪽) 목표 충족
  el.className = met ? 'ok' : 'ng';
  const statusText = !met ? '목표 미달'
    : (combo.belowMinLeds ? '목표 달성 (LED 수 하한 미만)' : (combo.fullPass === false ? '중심부 달성 · 전체 미달(참고)' : '목표 달성'));
  const name = tags.length ? tags.join(' + ') : '기본 평판';
  const pitchVal = combo.pitchY == null
    ? `${combo.pitchX.toFixed(0)}<i>mm(선형)</i>`
    : `${combo.pitchX.toFixed(0)}<i>×</i>${combo.pitchY.toFixed(0)}<i>mm</i>`;
  const cvW = combo.cv > goalSpec.cvMax ? ' ⚠' : '';
  const gW = combo.grad > goalSpec.gradMax ? ' ⚠' : '';
  const T = (combo.transmit * 100).toFixed(0);
  const ledSub = met ? `<span class="mut">(${combo.nx}×${combo.ny})</span>` : '<span class="mut">(최소 피치로도 부족)</span>';
  const insetNote = (combo.padX < -0.001 || combo.padY < -0.001)
    ? `<div class="v-sub">최외곽 LED 열 안쪽 배치: X ${combo.padX < 0 ? (-combo.padX).toFixed(1) : 0} / Y ${combo.padY < 0 ? (-combo.padY).toFixed(1) : 0} mm (타겟 경계에서)</div>` : '';
  const overhangLine = combo.overhang > 0.001
    ? `<div class="v-sub">기구 크기 <b>${combo.fixtureX.toFixed(0)}×${combo.fixtureY.toFixed(0)}mm</b> (각 변 X +${combo.padX.toFixed(0)} / Y +${combo.padY.toFixed(0)}mm 오버행 = 타겟 대비 +${(2 * combo.padX / (combo.fixtureX - 2 * combo.padX) * 100).toFixed(0)}% / +${(2 * combo.padY / (combo.fixtureY - 2 * combo.padY) * 100).toFixed(0)}%)</div>`
    : '';
  // 최종(조합) 결과 — LED 개수 · Pitch X·Y · 균일도를 같은 비중의 카드 3개로 나란히 표시
  // ("공학적 OUT": 라벨+수치가 명확히 구분되는 스펙시트 형태).
  el.innerHTML = `
    <div class="v-hd">적용 조합: <b>${name}</b> · 목표 균일도(min/max, 중심부 우선) ${(combo.target * 100).toFixed(0)}%
      <span class="v-status ${met ? 'ok' : 'ng'}">${statusText}</span></div>
    <div class="v-stats">
      <div class="v-stat-box"><span class="lbl">LED 개수</span><span class="val">${combo.leds}<i>개</i></span>${ledSub}</div>
      <div class="v-stat-box"><span class="lbl">Pitch X·Y</span><span class="val">${pitchVal}</span></div>
      <div class="v-stat-box ${met ? 'ok' : 'ng'}"><span class="lbl">균일도(중심부)</span><span class="val">${((combo.U0c ?? combo.U0) * 100).toFixed(1)}<i>%</i></span><span class="mut">전체 ${(combo.U0 * 100).toFixed(1)}%</span></div>
    </div>
    <div class="v-sub">투과율 ${T}%</div>
    ${overhangLine}${insetNote}
    ${met ? '' : '<div class="v-sub hint">→ 오버행↑ · 확산 적용(L2 Milky·L3~5) · 깊이 조정</div>'}
    <div class="v-sub">참고 — min/avg ${(combo.minAvg * 100).toFixed(0)}% · CV ${(combo.cv * 100).toFixed(1)}%${cvW} · 인접변화율 ${(combo.grad * 100).toFixed(1)}%${gW}</div>`;
}

// X·Y 양방향 조도 프로파일 — 각 방향의 'LED열 위' + 'LED 사이' 라인. 세로축 %(최댓값 대비), 가로축 mm 눈금,
// LED 위치·중심부 경계·최솟값 수치 표시, 마우스 위치 수치 읽기.
export function drawProfiles(canvas, res, target) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, w, h);
  const { field, nx, ny, extent, leds } = res;
  // 세로축 = 최댓값 대비 %(히트맵 색 스케일·min/max 판정과 같은 기준). 예전 avg=1 정규화는 눈금
  // 숫자가 균일도 수치와 바로 연결되지 않아 수준 파악이 어려웠다.
  let maxAll = 0; for (let k = 0; k < field.length; k++) if (field[k] > maxAll) maxAll = field[k];
  if (!(maxAll > 0)) maxAll = 1;

  const near = (arr, c) => (arr.length ? arr.reduce((b, v) => (Math.abs(v - c) < Math.abs(b - c) ? v : b), arr[0]) : c);
  const cx = (extent.x0 + extent.x1) / 2, cy = (extent.y0 + extent.y1) / 2;
  const xs = [...new Set((leds || []).map((p) => p.x))].sort((a, b) => a - b);
  const ysL = [...new Set((leds || []).map((p) => p.y))].sort((a, b) => a - b);
  const toI = (x) => clamp(Math.round((x - extent.x0) / (extent.x1 - extent.x0) * (nx - 1)), 0, nx - 1);
  const toJ = (y) => (ny <= 1 ? 0 : clamp(Math.round((y - extent.y0) / (extent.y1 - extent.y0) * (ny - 1)), 0, ny - 1));
  const rowAt = (j) => { const r = []; for (let i = 0; i < nx; i++) r.push(field[j * nx + i] / maxAll * 100); return r; };
  const colAt = (i) => { const c = []; for (let j = 0; j < ny; j++) c.push(field[j * nx + i] / maxAll * 100); return c; };

  // X방향(행): LED 행 위 / 행 사이 — 위치는 타겟 X 좌표(mm)
  const ledY = near(ysL, cy);
  const rowP = ysL.length >= 2 ? ysL[1] - ysL[0] : 0;
  const xLed = rowAt(toJ(ledY));
  const xBtw = rowP ? rowAt(toJ(ledY + rowP / 2)) : null;
  // Y방향(열): LED 열 위 / 열 사이 — 위치는 타겟 Y 좌표(mm)
  const ledX = near(xs, cx);
  const colP = xs.length >= 2 ? xs[1] - xs[0] : 0;
  const yLed = colAt(toI(ledX));
  const yBtw = colP ? colAt(toI(ledX + colP / 2)) : null;

  const posX = Array.from({ length: nx }, (_, i) => extent.x0 + (extent.x1 - extent.x0) * (nx > 1 ? i / (nx - 1) : 0.5));
  const posY = Array.from({ length: ny }, (_, j) => extent.y0 + (extent.y1 - extent.y0) * (ny > 1 ? j / (ny - 1) : 0.5));

  const mn = (a) => Math.min(...a);
  const minAll = Math.min(mn(xLed), mn(yLed), xBtw ? mn(xBtw) : 100, yBtw ? mn(yBtw) : 100);
  const tPct = target * 100;
  const yMin = Math.max(0, Math.floor((Math.min(minAll, tPct) - 5) / 10) * 10);
  const yMax = 102;

  // 패널 2개(좌 X방향, 우 Y방향) — 각 패널에 % 눈금(왼쪽)·mm 눈금(아래)
  const TOP = 20, BOT = 30, LBL = 34, GAP = 14;
  const plotT = TOP, plotB = h - BOT;
  const half = (w - PAD.R - LBL * 2 - GAP) / 2;
  const panels = [
    { name: 'X', l: LBL, r: LBL + half, pos: posX, curves: [{ name: 'LED열', vals: xLed, color: '#5ee0b0' }, ...(xBtw ? [{ name: '사이', vals: xBtw, color: '#3f6c9c', dash: [4, 3] }] : [])],
      ledPos: xs, zone: res.center ? [extent.x0 + (extent.x1 - extent.x0) * res.center.fx, extent.x1 - (extent.x1 - extent.x0) * res.center.fx] : null,
      at: `y=${ledY.toFixed(1)}${xBtw ? ` / ${(ledY + rowP / 2).toFixed(1)}` : ''}mm` },
    { name: 'Y', l: LBL * 2 + half + GAP, r: w - PAD.R, pos: posY, curves: [{ name: 'LED열', vals: yLed, color: '#86b0ff' }, ...(yBtw ? [{ name: '사이', vals: yBtw, color: '#3f6c9c', dash: [4, 3] }] : [])],
      ledPos: ysL, zone: res.center ? [extent.y0 + (extent.y1 - extent.y0) * res.center.fy, extent.y1 - (extent.y1 - extent.y0) * res.center.fy] : null,
      at: `x=${ledX.toFixed(1)}${yBtw ? ` / ${(ledX + colP / 2).toFixed(1)}` : ''}mm` },
  ];
  const py = (v) => plotT + (plotB - plotT) * (1 - (v - yMin) / (yMax - yMin));
  const niceStep = (span, want = 6) => { const raw = span / want; const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };

  for (const P of panels) {
    const span = P.pos[P.pos.length - 1] - P.pos[0] || 1;
    const px = (v) => P.l + (v - P.pos[0]) / span * (P.r - P.l);
    P.px = px;
    // 배경 격자(10% 마다) + % 눈금
    ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = yMin; v <= 100; v += 10) {
      ctx.strokeStyle = v === 100 ? '#3a4560' : '#20293c'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(P.l, py(v)); ctx.lineTo(P.r, py(v)); ctx.stroke();
      ctx.fillStyle = '#7f8ba6'; ctx.fillText(`${v}%`, P.l - 3, py(v));
    }
    // mm 눈금(아래)
    const step = niceStep(span);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(P.pos[0] / step) * step; v <= P.pos[P.pos.length - 1] + 1e-9; v += step) {
      ctx.strokeStyle = '#20293c'; ctx.beginPath(); ctx.moveTo(px(v), plotT); ctx.lineTo(px(v), plotB); ctx.stroke();
      ctx.fillStyle = '#7f8ba6'; ctx.fillText(`${+v.toFixed(1)}`, px(v), plotB + 3);
    }
    // 중심부(판정 영역) 경계 — 청록 점선
    if (P.zone) {
      ctx.strokeStyle = 'rgba(56,224,214,0.7)'; ctx.setLineDash([3, 3]);
      for (const z of P.zone) { ctx.beginPath(); ctx.moveTo(px(z), plotT); ctx.lineTo(px(z), plotB); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // 목표선
    ctx.strokeStyle = '#e0b64a'; ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(P.l, py(tPct)); ctx.lineTo(P.r, py(tPct)); ctx.stroke(); ctx.setLineDash([]);
    // LED 위치 표시(아래 축의 작은 삼각형)
    ctx.fillStyle = 'rgba(255,207,63,0.9)';
    for (const q of P.ledPos) {
      if (q < P.pos[0] - 1e-9 || q > P.pos[P.pos.length - 1] + 1e-9) continue;
      ctx.beginPath(); ctx.moveTo(px(q), plotB); ctx.lineTo(px(q) - 3, plotB + 5); ctx.lineTo(px(q) + 3, plotB + 5); ctx.closePath(); ctx.fill();
    }
    // 곡선
    for (const c of P.curves) {
      ctx.strokeStyle = c.color; ctx.lineWidth = 1.8; ctx.setLineDash(c.dash || []);
      ctx.beginPath();
      c.vals.forEach((v, i) => { const x = px(P.pos[i]); i ? ctx.lineTo(x, py(v)) : ctx.moveTo(x, py(v)); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    // 최솟값 마커 + 수치(실선 곡선)
    const main = P.curves[0];
    let iMin = 0; main.vals.forEach((v, i) => { if (v < main.vals[iMin]) iMin = i; });
    const mx = px(P.pos[iMin]), my = py(main.vals[iMin]);
    ctx.fillStyle = main.color; ctx.beginPath(); ctx.arc(mx, my, 3, 0, 7); ctx.fill();
    ctx.font = '11px system-ui'; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = mx > (P.l + P.r) / 2 ? 'right' : 'left';
    ctx.fillText(`min ${main.vals[iMin].toFixed(1)}% @ ${P.pos[iMin].toFixed(1)}mm`, mx + (ctx.textAlign === 'left' ? 6 : -6), my - 6);
    // 헤더: 축 이름 · 단면 위치만 (min 수치는 곡선 위 마커 라벨과 중복이라 생략 — 좁은 패널에서도 안 겹치게)
    ctx.textAlign = 'left'; ctx.fillStyle = main.color;
    ctx.fillText(`${P.name}축 (mm) @${P.at}`, P.l, 13);
  }
  // 범례(고정 설명)는 패널이 좁으면 매번 겹치거나 잘리므로 캔버스 title 툴팁으로 옮기고,
  // 화면에는 짧은 안내만 남긴다.
  canvas.title = `세로축 = 최댓값 대비 % · 목표 ${tPct.toFixed(0)}% · 실선=LED열 ┄점선=LED사이 · ▲=LED 위치 · 청록점선=중심부 · 마우스를 올리면 수치 표시`;
  ctx.textAlign = 'center'; ctx.fillStyle = '#e0b64a'; ctx.font = '11px system-ui';
  ctx.fillText(`목표 ${tPct.toFixed(0)}% · 마우스 올리면 수치 표시`, w / 2, h - 3);

  // 마우스 위치의 수치 읽기 — 그린 데이터를 캔버스에 보관하고 리스너는 한 번만 단다
  canvas._prof = { panels, py, plotT, plotB, redraw: () => drawProfiles(canvas, res, target) };
  if (!canvas._profHooked) {
    canvas._profHooked = true;
    canvas.addEventListener('mousemove', (e) => {
      const d = canvas._prof; if (!d) return;
      const rect = canvas.getBoundingClientRect();
      const mxp = e.clientX - rect.left, myp = e.clientY - rect.top;
      d.redraw();
      const P = d.panels.find((p) => mxp >= p.l && mxp <= p.r);
      if (!P || myp < d.plotT || myp > d.plotB) return;
      const span = P.pos[P.pos.length - 1] - P.pos[0] || 1;
      const v = P.pos[0] + (mxp - P.l) / (P.r - P.l) * span;
      let i = 0; P.pos.forEach((q, k) => { if (Math.abs(q - v) < Math.abs(P.pos[i] - v)) i = k; });
      const c2 = canvas.getContext('2d');
      c2.strokeStyle = 'rgba(255,255,255,0.5)'; c2.setLineDash([2, 2]);
      c2.beginPath(); c2.moveTo(P.px(P.pos[i]), d.plotT); c2.lineTo(P.px(P.pos[i]), d.plotB); c2.stroke(); c2.setLineDash([]);
      const lines = [`${P.name} = ${P.pos[i].toFixed(1)} mm`, ...P.curves.map((c) => `${c.name} ${c.vals[i].toFixed(1)}%`)];
      c2.font = '11px system-ui'; c2.textAlign = 'left'; c2.textBaseline = 'top';
      const bw = 110, bh = 14 * lines.length + 6;
      const bx = Math.min(P.px(P.pos[i]) + 8, P.r - bw), by = d.plotT + 4;
      c2.fillStyle = 'rgba(15,20,32,0.92)'; c2.fillRect(bx, by, bw, bh);
      c2.strokeStyle = '#3a4560'; c2.strokeRect(bx, by, bw, bh);
      lines.forEach((t, k) => { c2.fillStyle = k === 0 ? '#e8edf7' : P.curves[k - 1].color; c2.fillText(t, bx + 5, by + 3 + 14 * k); });
    });
    canvas.addEventListener('mouseleave', () => { canvas._prof?.redraw(); });
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function line(ctx, arr, px, py, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  arr.forEach((v, i) => (i ? ctx.lineTo(px(i, arr.length), py(v)) : ctx.moveTo(px(i, arr.length), py(v))));
  ctx.stroke();
}
