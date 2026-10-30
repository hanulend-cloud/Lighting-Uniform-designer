// 아래 칸 대시보드 — ① 기구 최적화 진행(6 항목 타일) ② 시뮬레이션 진행현황(수렴 그래프).
// 최적화: app.js 의 기구 최적화 io 가 progress(stage, frac, text) · evals(stage, [{label, Ulen, Uwid, ok, why}]) 를 부른다.
// 타일마다 상태(대기·진행 %·완료·건너뜀) · 시험 중 값 → 지금까지 최고 · 후보별 길이/폭 U 점 그래프(목표선) · 진행 막대.
// 시뮬레이션: 점진 계산 스냅숏마다 sample(snap, targetNoise) — 광자 수에 따른 잡음 %·길이/폭 U 추정과 진행률 %(잡음이 목표에 닿으면 100%).
import { calcLabel } from './command-bar.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 계산 순서대로(엔진: 위치 → 케이스 면 → 형상 → Milky, 2026-10-30) — 번호도 이 순서
export const STAGES = [['position', '① 위치'], ['housing', '② 케이스 면'], ['shape', '③ 형상'], ['milky', '④ Milky']];
// 기구 최적화 진행 단계 이름 → 타일(LED 배치·높이 = ② 기구 위치). 현재안·기준·검증 = 타일 없음(머리 줄 문구로만)
export const tileOf = (stage) => (stage === 'milky' || stage === 'shape' || stage === 'housing' ? stage : stage === 'leds' || stage === 'height' ? 'position' : null);
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');

// 후보 점 그래프(인라인 SVG, 순수) — 길이 U(파랑)·폭 U(초록) · 목표선(빨강 점선) · 최고 후보(동그라미)
export function evalSparkSvg(evals, tgLen, tgWid, bestIdx = -1, w = 220, h = 70) {
  const pts = evals.filter((e) => e.ok !== false && Number.isFinite(e.Ulen));
  if (!pts.length) return `<svg class="od-spark" viewBox="0 0 ${w} ${h}"><text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="od-none">후보 결과 없음</text></svg>`;
  const vals = pts.flatMap((e) => [e.Ulen, e.Uwid]).filter(Number.isFinite).concat([tgLen, tgWid].filter(Number.isFinite));
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.03) * 20) / 20), hi = Math.min(1, Math.ceil((Math.max(...vals) + 0.02) * 20) / 20) || 1;
  const n = evals.length, X = (i) => 6 + (n > 1 ? (i / (n - 1)) * (w - 12) : (w - 12) / 2), Y = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (h - 14);
  const line = (k, cls) => { const d = evals.map((e, i) => (e.ok !== false && Number.isFinite(e[k]) ? `${X(i).toFixed(1)},${Y(e[k]).toFixed(1)}` : null)).filter(Boolean); return d.length > 1 ? `<polyline class="${cls}" points="${d.join(' ')}"/>` : ''; };
  const dots = (k, cls) => evals.map((e, i) => (e.ok !== false && Number.isFinite(e[k]) ? `<circle class="${cls}" cx="${X(i).toFixed(1)}" cy="${Y(e[k]).toFixed(1)}" r="2"/>` : e.ok === false ? `<text class="od-x" x="${X(i).toFixed(1)}" y="${h - 6}" text-anchor="middle">×</text>` : '')).join('');
  const tg = (v, cls) => (Number.isFinite(v) ? `<line class="${cls}" x1="4" x2="${w - 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>` : '');
  const best = bestIdx >= 0 && evals[bestIdx] && Number.isFinite(evals[bestIdx].Ulen) ? `<circle class="od-best" cx="${X(bestIdx).toFixed(1)}" cy="${Y(evals[bestIdx].Ulen).toFixed(1)}" r="5"/>` : '';
  return `<svg class="od-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${tg(tgLen, 'od-tg')}${tg(tgWid, 'od-tg od-tg2')}${line('Ulen', 'od-l1')}${line('Uwid', 'od-l2')}${dots('Ulen', 'od-d1')}${dots('Uwid', 'od-d2')}${best}
    <text class="od-ax" x="2" y="10">${hi.toFixed(2)}</text><text class="od-ax" x="2" y="${h - 2}">${lo.toFixed(2)}</text></svg>`;
}
// 설계 인자 현황판(순수, 왼쪽 창 맨 아래) — S = 최적화 상태(null = 실행 전), nw = 지금 설계 { milky, milkyCap, leds, shape, on:{milky,position,shape}, Ulen, Uwid, tgLen, tgWid }
// 그래프 1개에 인자 3개: 시험 순서대로 후보의 길이 U(실선)·폭 U(점선)를 인자 색으로 · 목표선(빨강) · 지금 설계(회색) · 최고 후보(노란 원)
// 아래 인자별 한 줄(상태 · 지금 → 최고). 그래프는 .fb-plot 자리의 실제 크기로 factorChartSvg 가 그림(스크롤 없이 칸에 맞춤)
const FB_COL = { milky: '#3b82f6', position: '#f59e0b', shape: '#a855f7', housing: '#10b981' };
// cfg(k) → { on, box(체크 상자), opt(설정 html), why } — 줄 앞에서 바로 켜고 끔(2026-10-29, 최적화 타일에서 옮김). 없으면 표시만
export function factorBoardHtml(S, nw = {}, cfg = null) {
  const tl = S?.tgLen ?? nw.tgLen, tw = S?.tgWid ?? nw.tgWid;
  const row = (k, name, nowTxt) => {
    // 고정 = 적용까지 마친 항목 — 다음 실행에서 건드리지 않음. [다시 최적화] = 고정 풀고 다시 체크
    if (nw.locked?.[k]) return `<div class="fb-row fb-lock" title="최적화 결과를 적용함 — 다음 실행에서 이 값 그대로 씀"><span class="fb-lk">🔒</span><i class="fb-dot" style="background:${FB_COL[k]}"></i><b>${name}</b><span class="od-chip od-lockc">✓ 고정</span><span class="fb-val">${esc(nowTxt)} <button type="button" class="fb-redo" data-adunlock="${k}">다시 최적화</button></span></div>`;
    const c = cfg?.(k), t = S?.tiles?.[k], on = c ? !!c.on : t ? t.status !== 'off' : !!nw.on?.[k];
    const ev = (t?.evals ?? []).filter((e) => e.ok !== false && Number.isFinite(e.Ulen)); let b = null;
    for (const e of ev) if (!b || scoreOf(e, tl, tw) > scoreOf(b, tl, tw)) b = e;
    const chip = t && t.status !== 'off' ? { wait: '대기', run: `진행 ${Math.round(t.frac * 100)}%`, done: '완료' }[t.status] : on ? '켜짐' : '꺼짐';
    const txt = `지금 ${nowTxt}${b ? ` → ${b.label} (${f2(b.Ulen)}/${f2(b.Uwid)})` : ''}`;
    const box = c?.box ? `<label class="fb-sw" title="${esc(c.why || '최적화에 사용')}">${c.box}</label>` : '<span></span>';   // 빈 칸도 자리 유지(격자 5칸)
    return `<div class="fb-row${on ? '' : ' fb-off'}" title="${esc(txt)}">${box}<i class="fb-dot" style="background:${FB_COL[k]}"></i><b>${name}</b><span class="od-chip">${chip}</span><span class="fb-val"><span class="mut">지금</span> ${esc(nowTxt)}${b ? ` → <b>${esc(b.label)}</b> <span class="mut">(${f2(b.Ulen)}/${f2(b.Uwid)})</span>` : ''}</span></div>${c?.opt ? `<div class="fb-opt">${c.opt}</div>` : ''}`;   // 설정(① 대상 · ③ 형상 바꿀 부품 — 체크 전에도 골라 둠)
  };
  // 그래프는 오른쪽 모니터로(2026-10-30) — 여기는 입력(체크·옵션)과 상태만
  const nowOf = { position: nw.leds ?? '–', housing: nw.housing ?? '–', shape: nw.shape ?? '원래 형상', milky: Number.isFinite(nw.milky) ? `Milky ${f2(nw.milky)}` : '확산 부품 없음' };
  return `<div class="od-h">설계 인자 <span class="mut">체크 = 이번에 최적화 · 🔒 = 적용해서 고정</span> <span class="mut">${Number.isFinite(nw.Ulen) ? `지금 ${f2(nw.Ulen)}/${f2(nw.Uwid)}` : ''}</span></div>
    ${STAGES.map(([k, name]) => row(k, name, nowOf[k])).join('')}
    <div class="mut fb-hint">한 항목씩: 체크 → ▶ 실행 → [적용] = 🔒 고정 → 다음 항목 체크 → ▶ 실행</div>`;
}
// 인자 3개를 한 그래프로(순수) — W×H = 실제 px(글자가 늘어나지 않게). 가로 = 시험 순서(S.seq), 세로 = 균일도 U(목표·지금 포함 범위)
export function factorChartSvg(S, nw = {}, W = 240, H = 100) {
  const tl = S?.tgLen ?? nw.tgLen, tw = S?.tgWid ?? nw.tgWid, seq = S?.seq ?? [];
  const okE = (e) => e.ok !== false && Number.isFinite(e.Ulen);
  const vals = [...seq.filter(okE).flatMap((e) => [e.Ulen, e.Uwid]), tl, tw, nw.Ulen, nw.Uwid].filter(Number.isFinite);
  const lo = vals.length ? Math.max(0, Math.floor((Math.min(...vals) - 0.02) * 20) / 20) : 0, hi = vals.length ? Math.min(1, Math.ceil((Math.max(...vals) + 0.01) * 20) / 20) : 1;
  const x0 = 26, x1 = W - 6, y0 = 5, y1 = H - 13, Y = (v) => y0 + (1 - (v - lo) / (hi - lo || 1)) * (y1 - y0);
  const n = seq.length, step = n > 1 ? (x1 - x0) / (n - 1) : 0, X = (i) => x0 + (n > 1 ? i * step : (x1 - x0) / 2);
  const hl = (v, cls) => (Number.isFinite(v) ? `<line class="${cls}" x1="${x0}" x2="${x1}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>` : '');
  let body = '';
  if (seq.some(okE)) {
    let s0 = 0;   // 인자 구간 띠
    for (let i = 1; i <= n; i++) if (i === n || seq[i].k !== seq[s0].k) { const xa = Math.max(x0, X(s0) - step / 2), xb = Math.min(x1, X(i - 1) + step / 2); body += `<rect x="${xa.toFixed(1)}" y="${y0}" width="${Math.max(1, xb - xa).toFixed(1)}" height="${y1 - y0}" fill="${FB_COL[seq[s0].k] ?? '#888'}" opacity=".08"/>`; s0 = i; }
    body += hl(tl, 'od-tg') + hl(tw, 'od-tg od-tg2') + hl(nw.Ulen, 'od-now');
    let best = -1;
    seq.forEach((e, i) => { if (okE(e) && (best < 0 || scoreOf(e, tl, tw) > scoreOf(seq[best], tl, tw))) best = i; });
    for (const k of Object.keys(FB_COL)) {
      const idx = seq.map((e, i) => i).filter((i) => seq[i].k === k && okE(seq[i]));
      if (!idx.length) continue;
      const pl = (key, dash) => { const d = idx.filter((i) => Number.isFinite(seq[i][key])).map((i) => `${X(i).toFixed(1)},${Y(seq[i][key]).toFixed(1)}`); return d.length > 1 ? `<polyline points="${d.join(' ')}" fill="none" stroke="${FB_COL[k]}" stroke-width="1.6"${dash ? ' stroke-dasharray="3 2"' : ''}/>` : ''; };
      body += pl('Ulen', false) + pl('Uwid', true) + idx.map((i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(seq[i].Ulen).toFixed(1)}" r="2" fill="${FB_COL[k]}"/>`).join('');
    }
    let bb = null; const run = []; seq.forEach((e, i) => { if (okE(e) && (!bb || scoreOf(e, tl, tw) > scoreOf(bb, tl, tw))) bb = e; if (bb) run.push(`${X(i).toFixed(1)},${Y(bb.Ulen).toFixed(1)}`); });
    if (run.length > 1) body += `<polyline class="od-run" points="${run.join(' ')}" fill="none"/>`;   // 지금까지 최고(길이 U) — 계단처럼 오르는 선
    if (best >= 0) body += `<circle class="od-best" cx="${X(best).toFixed(1)}" cy="${Y(seq[best].Ulen).toFixed(1)}" r="5"><title>최고 ${esc(seq[best].label)} (${f2(seq[best].Ulen)}/${f2(seq[best].Uwid)})</title></circle>`;
    body += `<text class="od-ax" x="${x0}" y="${H - 2}">후보 1</text><text class="od-ax" x="${x1}" y="${H - 2}" text-anchor="end">${n}</text>`;
  } else body += hl(tl, 'od-tg') + hl(tw, 'od-tg od-tg2') + hl(nw.Ulen, 'od-now') + `<text class="od-none" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle">기구 최적화를 실행하면 후보 균일도가 그려짐</text>`;
  return `<svg class="fb-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#c7cfdb" stroke-width=".5"/>${body}<text class="od-ax" x="2" y="${y0 + 6}">${hi.toFixed(2)}</text><text class="od-ax" x="2" y="${y1}">${lo.toFixed(2)}</text></svg>`;
}
// 최적화 타일 전후 사양표(순수) — b0 = 실행 전 사양(factorNow), best = 그 항목 최고 후보 { label, Ulen, Uwid }. 바뀐 칸 강조 · 목표 통과 ✓/✕
const SPEC_NOW = { milky: (b) => (Number.isFinite(b.milky) ? `Milky ${f2(b.milky)}` : '–'), position: (b) => b.leds ?? '–', shape: (b) => b.shape ?? '원래 형상', housing: (b) => b.housing ?? '–' };
export function beforeAfterHtml(k, b0, best, tl, tw, n = 0) {
  if (!best) return '<div class="mut od-tx">쓸 수 있는 후보 없음</div>';
  const pass = (v, t) => (Number.isFinite(v) && Number.isFinite(t) ? (v + 1e-9 >= t ? ' <b class="od-ok">✓</b>' : ' <b class="od-bad">✕</b>') : '');
  const row = (name, a, b, extra = '') => `<tr><th>${name}</th><td>${a}</td><td class="${a !== b ? 'chg' : ''}">${b}${extra}</td></tr>`;
  return `<table class="od-ba"><tr><th></th><th>전</th><th>후</th></tr>
    ${row('사양', esc(SPEC_NOW[k]?.(b0) ?? '–'), esc(best.label))}
    ${row('길이 U', f2(b0.Ulen), f2(best.Ulen), pass(best.Ulen, tl))}
    ${row('폭 U', f2(b0.Uwid), f2(best.Uwid), pass(best.Uwid, tw))}</table><div class="mut od-tx">후보 ${n}개 중 최고 · 적용은 위 [적용]</div>`;
}
// 오른쪽 모니터(순수, 2026-10-30) — 진행 줄(계산 순서 · 고정/완료/진행/대기) · 지표 3개(지금까지 최고, 시작 대비) · 그래프 자리(.od-plot) · 기록(최고 갱신만)
// S = createOptDash 상태, sec = 걸린 초. 그래프는 자리 크기로 factorChartSvg 가 나중에 그림
export function monitorHtml(S, sec = 0) {
  const tl = S.tgLen, tw = S.tgWid, ok = (e) => e.ok !== false && Number.isFinite(e.Ulen);
  let best = null; for (const e of S.seq ?? []) if (ok(e) && (!best || scoreOf(e, tl, tw) > scoreOf(best, tl, tw))) best = e;
  const busy = S.ended == null && !S.stopped;
  const step = (cls, name, sub) => `<div class="om-st om-${cls}"><b>${name}</b><span>${sub}</span></div>`;
  const steps = [step(S.seq?.length || !busy ? 'done' : 'run', '현재안', S.seq?.length || !busy ? '✓' : '계산')];
  for (const [k, name] of STAGES) {
    const t = S.tiles[k];
    if (S.locked?.[k] && t.status === 'off') steps.push(step('lock', name, '고정 ✓'));
    else if (t.status === 'run') steps.push(step('run', name, `${Math.round(t.frac * 100)}%`));
    else if (t.status === 'done') steps.push(step('done', name, '✓'));
    else if (t.status === 'wait') steps.push(step('wait', name, '대기'));
  }
  steps.push(step(S.ended != null ? 'done' : 'wait', '검증', S.ended != null ? '✓' : ''));
  const b0 = S.before ?? {};
  const kpi = (label, tg, v, v0) => {
    const pass = Number.isFinite(v) && Number.isFinite(tg) ? (v + 1e-9 >= tg ? 'ok' : 'bad') : '';
    const d = Number.isFinite(v) && Number.isFinite(v0) ? v - v0 : NaN;
    return `<div class="om-k"><div class="mut">${label}${Number.isFinite(tg) ? ` · 목표 ${f2(tg)}` : ''}</div><b class="om-v ${pass}">${f2(v)}</b><div class="mut">시작 ${f2(v0)}${Number.isFinite(d) && Math.abs(d) >= 0.005 ? ` → ${d > 0 ? '▲' : '▼'}${f2(Math.abs(d))}` : ''}</div></div>`;
  };
  const effB = S.effBest, eff0 = b0.eff;
  const effK = `<div class="om-k"><div class="mut">광 효율</div><b class="om-v">${Number.isFinite(effB) ? `${(effB * 100).toFixed(1)}%` : Number.isFinite(eff0) ? `${(eff0 * 100).toFixed(1)}%` : '–'}</b><div class="mut">${Number.isFinite(effB) && Number.isFinite(eff0) ? `시작 ${(eff0 * 100).toFixed(1)}%` : Number.isFinite(eff0) ? '시작값 · 최적안은 끝나면' : ''}</div></div>`;
  const nm = Object.fromEntries(STAGES);
  const mmss = (t) => `${String((t / 60) | 0).padStart(2, '0')}:${String(t % 60 | 0).padStart(2, '0')}`;
  const log = (S.log ?? []).slice(-8).reverse().map((l) => `<div class="om-l"><span class="mut">${mmss(l.sec)}</span> ${esc(nm[l.k] ?? '')} ${esc(l.label)} → <b>${f2(l.Ulen)}/${f2(l.Uwid)}</b> <span class="od-ok">최고 갱신</span></div>`).join('');
  const nEval = (S.seq ?? []).length;
  return `<div class="od-h">${busy ? `진행 ${mmss(sec)}` : S.stopped ? '중지됨' : '끝남'} <span class="mut">· 시험한 후보 ${nEval}개${S.note ? ` · ${esc(S.note)}` : ''}</span></div>
    <div class="om-steps">${steps.join('<i class="om-ar">→</i>')}</div>
    <div class="om-kpi">${kpi('길이 U', tl, best?.Ulen ?? b0.Ulen, b0.Ulen)}${kpi('폭 U', tw, best?.Uwid ?? b0.Uwid, b0.Uwid)}${effK}</div>
    <div class="od-legend">색 = 항목 · 점 = 각 후보(길이 U) · 굵은 선 = 지금까지 최고 <i class="od-kt"></i>목표 <i style="border-color:#8a96a8"></i>시작</div>
    <div class="od-plot"></div>
    <div class="om-log"><div class="mut om-lh">기록 — 최고가 바뀐 순간</div>${log || '<div class="mut">아직 없음</div>'}</div>`;
}
// 후보의 점수(목표 대비 여유 — 둘 다 있으면 작은 쪽)
const scoreOf = (e, tl, tw) => (e.ok === false || !Number.isFinite(e.Ulen) ? -Infinity : Math.min(e.Ulen - tl, Number.isFinite(e.Uwid) && Number.isFinite(tw) ? e.Uwid - tw : Infinity));

// h = { config(k) → { on, html }(타일 머리의 켜기 스위치·설정), onSel(key, value) } — 실행 전·후에는 타일에서 항목을 고르고, 실행 중에는 진행을 봄
export function createOptDash(el, h = {}) {
  let S = null, raf = 0;
  const onChange = (e) => { const x = e.target.closest('[data-ad]'); if (!x || !h.onSel) return; const k = x.dataset.ad; h.onSel(k, x.type === 'checkbox' ? x.checked : x.tagName === 'SELECT' ? +x.value : x.value === '' ? NaN : +x.value); };
  el.addEventListener('change', onChange); h.board?.addEventListener('change', onChange);
  h.board?.addEventListener('click', (e) => { const b = e.target.closest('[data-adunlock]'); if (b) h.onUnlock?.(b.dataset.adunlock); });   // 🔒 고정 → [다시 최적화]   // 켜기·설정 = 설계 인자 현황 줄
  const blank = () => Object.fromEntries(STAGES.map(([k]) => [k, { status: 'off', frac: 0, text: '', evals: [] }]));
  function reset({ stages = {}, tgLen, tgWid, locked = {} } = {}) {
    S = { tiles: blank(), tgLen, tgWid, t0: performance.now(), cur: null, note: '', seq: [], log: [], locked, before: h.now?.() ?? {} };   // before = 실행 전 사양(타일 전후 비교) · locked = 고정 항목(진행 줄 표시)
    for (const [k] of STAGES) S.tiles[k].status = stages[k] ? 'wait' : 'off';
    draw();
  }
  // 보완 실행 — 새로 켠 항목을 '대기' 로(기존 결과는 남김)
  function addStages(stages, note = '') { if (!S) return; for (const [k] of STAGES) if (stages[k] && S.tiles[k].status === 'off') S.tiles[k].status = 'wait'; S.note = note; draw(); }
  function progress(stage, frac, text) {
    if (!S) return;
    const k = tileOf(stage);
    if (!k) { S.note = text ?? ''; draw(); return; }   // 현재안·검증 = 머리 줄 문구
    const t = S.tiles[k]; S.note = '';
    if (S.cur && S.cur !== k && S.tiles[S.cur].status === 'run') S.tiles[S.cur].status = 'done';
    S.cur = k; t.status = 'run'; t.frac = Math.max(0, Math.min(1, frac ?? 0)); t.text = text ?? '';
    draw();
  }
  function evals(stage, list) { if (!S) return; const k = tileOf(stage); if (!k) { S.verify = list[list.length - 1] ?? S.verify; draw(); return; } const t = S.tiles[k]; t.evals.push(...list); for (const e of list) { const q = { ...e, k }; S.seq.push(q); if (q.ok !== false && Number.isFinite(q.Ulen) && (!S.bestE || scoreOf(q, S.tgLen, S.tgWid) > scoreOf(S.bestE, S.tgLen, S.tgWid))) { S.bestE = q; S.log.push({ sec: (performance.now() - S.t0) / 1000, k, label: q.label, Ulen: q.Ulen, Uwid: q.Uwid }); } } if (t.status === 'off' || t.status === 'wait') t.status = 'run'; draw(); }
  function finish(ok, text = '', effBest = NaN) { if (!S) return; S.effBest = effBest; for (const [k] of STAGES) if (S.tiles[k].status === 'run') { S.tiles[k].status = 'done'; S.tiles[k].frac = 1; } S.note = text; S.ended = ok; draw(); }
  function draw() { if (raf) return; raf = setTimeout(() => { raf = 0; render(); renderBoard(); }, 40); }   // setTimeout: 화면이 숨겨져도(다른 탭) 갱신 — rAF 는 멈춤
  // 높이 조절 손잡이(.m3-fac-split)는 남기고 내용만 바꿈
  function renderBoard() { if (!h.board) return; let c = h.board.querySelector('.fb-body'); if (!c) { c = document.createElement('div'); c.className = 'fb-body'; h.board.appendChild(c); } const nw = h.now?.() ?? {}; c.innerHTML = factorBoardHtml(S, nw, h.config); }
  if (h.board && typeof ResizeObserver !== 'undefined') { let w0 = 0, h0 = 0; new ResizeObserver(() => { const b = h.board; if (b.clientWidth === w0 && b.clientHeight === h0) return; w0 = b.clientWidth; h0 = b.clientHeight; renderBoard(); }).observe(h.board); }   // 칸 크기가 바뀌면 그래프를 그 크기로 다시
  // 오른쪽 모니터 — 진행 줄 · 지표 · 그래프(자리 크기로) · 기록. 끝나도 그대로 남김(결과 카드는 위 #m3-auto)
  function render() {
    if (!S) { el.innerHTML = ''; return; }   // 실행 전 = 비움(항목 켜기는 왼쪽 설계 인자 체크)
    el.innerHTML = monitorHtml(S, (performance.now() - S.t0) / 1000);
    const p = el.querySelector('.od-plot');
    if (p && p.clientWidth > 40 && p.clientHeight > 30) p.innerHTML = factorChartSvg(S, { ...(S.before ?? {}), tgLen: S.tgLen, tgWid: S.tgWid }, p.clientWidth, p.clientHeight);
  }
  if (typeof ResizeObserver !== 'undefined') { let w0 = 0; new ResizeObserver(() => { if (el.clientWidth !== w0) { w0 = el.clientWidth; draw(); } }).observe(el); }
  if (typeof setInterval !== 'undefined') setInterval(() => { if (S && S.ended == null && !S.stopped && el.isConnected && el.offsetParent) draw(); }, 1000);   // 걸린 시간 갱신
  render(); renderBoard();
  function stop() { if (S) { S.stopped = true; draw(); } }
  // 고르기만 바뀜(실행 전) — 다시 그림. 실행 결과가 남아 있으면 그대로 두고 스위치만 갱신
  function refresh() { draw(); }
  function clear() { S = null; draw(); }
  return { reset, addStages, progress, evals, finish, stop, refresh, clear };
}

// 광경로 순위(순수) — paths = { 'R:2>1': 가중 합 } → [{ parts:[번호], refl, share }] 비중 큰 순(기구 부품만, 같은 경로 합침)
export function topPaths(paths, nMech, k = 3) {
  const m = new Map(); let tot = 0;
  for (const [key, w] of Object.entries(paths ?? {})) {
    const [r, sq] = key.split(':'), parts = (sq ? sq.split('>').map(Number) : []).filter((q) => q < nMech), refl = r === 'R', kk = `${refl ? 'R' : ''}:${parts.join('>')}`;
    tot += w; const o = m.get(kk) ?? { parts, refl, w: 0 }; o.w += w; m.set(kk, o);
  }
  return tot > 0 ? [...m.values()].sort((a, b) => b.w - a.w).slice(0, k).map((o) => ({ parts: o.parts, refl: o.refl, share: o.w / tot })) : [];
}
export const pathText = (p, names) => `LED → ${p.parts.map((q) => names[q] ?? `부품 ${q + 1}`).join(' → ')}${p.parts.length ? ' → ' : ''}관측면${p.refl ? ' (케이스 반사 포함)' : ''}`;
// 시뮬레이션 진행현황 — 광자 수에 따른 잡음(%)·U 추정 · 진행률(잡음이 목표에 닿으면 100%)
export function simPct(relNoise, target) { return Number.isFinite(relNoise) && relNoise > 0 ? Math.max(0, Math.min(100, (target / relNoise) ** 2 * 100)) : 0; }
// 남은 계산 예상(순수) — 오차는 광자 수의 제곱근에 반비례 → 필요 광자 = 지금 × (오차/목표)². 속도 = 최근 10초 광자 증가
const human = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString()}만` : String(Math.round(n)));
export function etaText(H, tgt) {
  const last = H[H.length - 1];
  if (!last || !(last.noise > tgt) || H.length < 3) return '';
  const need = last.ph * (last.noise / tgt) ** 2, ref = H.find((p) => last.t - p.t <= 10000) ?? H[0], rate = (last.ph - ref.ph) / Math.max(1e-3, (last.t - ref.t) / 1000);
  if (!(rate > 0)) return '';
  const sec = (need - last.ph) / rate, tm = sec < 90 ? `${Math.max(1, Math.round(sec))}초` : sec < 5400 ? `${Math.round(sec / 60)}분` : `${(sec / 3600).toFixed(1)}시간`;
  return ` · 필요 광자 ≈ ${human(need)} · 남은 ≈ ${tm}`;
}
// 빛 도달 진단(순수) — 관측면으로 나온 빛이 아주 적으면(< 1%) 빛이 실제로 어디로 갔는지 알려 줌: 많이 나간 곳(부품·면) · 흡수.
// ledger = 원장(emitted·escaped·absSurf·absVol), leak = { 'part|face': 관측면이 아닌 곳으로 나간 양 }('-1|-1' = 투과 부품을 거치지 않고 공기로)
export function reachDiag(ledger, leak, names = []) {
  const E = ledger?.emitted ?? 0;
  if (!(E > 0)) return null;
  const leakSum = Object.values(leak ?? {}).reduce((a, b) => a + b, 0), reach = Math.max(0, (ledger.escaped - leakSum) / E);
  if (reach >= 0.01) return null;
  const nm = (k) => { const [p, f] = k.split('|').map(Number); return p < 0 ? 'LED에서 바로 공기로(투과 부품을 거치지 않음)' : `${names[p] ?? `부품 ${p + 1}`} 면 #${f}`; };
  const top = Object.entries(leak ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${nm(k)} ${((v / E) * 100).toFixed(0)}%`);
  const abs = ((ledger.absSurf ?? 0) + (ledger.absVol ?? 0)) / E;
  const few = reach < 0.001;   // 0.1% 미만 = 설정 문제일 가능성 큼, 1% 미만 = 구조상 적음(계산이 오래 걸림)
  return { reach, html: `<b>관측면에 도착한 빛 ${(reach * 100).toFixed(few ? 3 : 2)}%</b> — ${few ? '거의 없음(설정 확인 필요)' : '매우 적음(계산이 오래 걸림)'}. 빛이 간 곳: ${top.join(' · ') || '–'}${abs > 0.05 ? ` · 흡수 ${(abs * 100).toFixed(0)}%` : ''}
    ${few ? '' : '<div class="mut">관측면 쪽을 뺀 바깥면을 반사 처리(불투명 백색)하면 도착 빛이 늘어 빨라집니다</div>'}<div class="mut">확인: ① 관측면 화살표가 빛이 나오는 바깥쪽을 향하는지 ② LED 노란 점선(발광 방향)이 부품 쪽을 향하는지 ③ 관측면이 다른 부품에 덮여 있지 않은지 — 3D 의 주황 면 = 가장 많이 새는 곳</div>` };
}
// 오른쪽 맨 위 카드(항상 보임) — onCtl = 계산 제어 단추(일시정지·재개·다시 계산). 광경로 목록은 접는 칸
export function createSimDash(el, { onCtl = null } = {}) {
  let H = [], tgt = 0.02, raf = 0, state = '', obs = null, P = [], names = [], reason = '';
  // names = 부품 이름, nMech = 기구 부품 수(LED STEP 부품 번호는 그 뒤 — 경로에서 뺌)
  let busy = false;   // 기구 최적화 중(점진 계산 일시정지)
  let diag = null;   // 빛 도달 진단(관측면 도달 < 1%)
  function sample(snap, targetNoise, observe, nm = names, nMech = nm.length, adBusy = false) {
    busy = adBusy; tgt = targetNoise ?? tgt; obs = observe ?? obs; state = snap?.state ?? ''; reason = snap?.reason ?? ''; names = nm; P = topPaths(snap?.paths, nMech);
    const ph = snap?.photons ?? 0, st = snap?.stats;
    diag = ph >= 50000 ? reachDiag(snap?.ledger, snap?.leak, nm) : null;
    if (!st || st.empty || !ph) { if (!ph) H = []; draw(); return; }
    if (H.length && ph < H[H.length - 1].ph) H = [];   // 장면이 바뀌어 다시 시작
    if (!H.length || ph > H[H.length - 1].ph) H.push({ ph, t: performance.now(), noise: st.relNoise, Ulen: st.Ulen, Uwid: st.Uwid });
    if (H.length > 400) H = H.filter((_, i) => i % 2 === 0 || i === H.length - 1);
    draw();
  }
  function draw() { if (raf) return; raf = setTimeout(() => { raf = 0; render(); }, 40); }   // setTimeout: 화면이 숨겨져도(다른 탭) 갱신 — rAF 는 멈춤
  function render() {
    const last = H[H.length - 1], pct = last ? simPct(last.noise, tgt) : 0;
    const w = 300, h = 70, x0 = 30, x1 = w - 30, y0 = 6, y1 = h - 14;
    let svg = '';
    if (H.length > 1) {
      const lp = (v) => Math.log10(Math.max(1, v)), a = lp(H[0].ph), b = lp(last.ph) || a + 1, X = (ph) => x0 + ((lp(ph) - a) / (b - a || 1)) * (x1 - x0);
      const nmax = Math.max(tgt * 2, ...H.map((p) => p.noise).filter(Number.isFinite)), YN = (v) => y0 + (1 - Math.min(1, v / nmax)) * (y1 - y0);
      const us = H.flatMap((p) => [p.Ulen, p.Uwid]).filter(Number.isFinite), ulo = Math.max(0, Math.floor((Math.min(...us) - 0.03) * 20) / 20), uhi = Math.min(1, Math.ceil((Math.max(...us) + 0.02) * 20) / 20), YU = (v) => y0 + (1 - (v - ulo) / (uhi - ulo || 1)) * (y1 - y0);
      const pl = (f, k) => H.filter((p) => Number.isFinite(p[k])).map((p) => `${X(p.ph).toFixed(1)},${f(p[k]).toFixed(1)}`).join(' ');
      svg = `<svg class="od-sim" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <line class="od-tg" x1="${x0}" x2="${x1}" y1="${YN(tgt).toFixed(1)}" y2="${YN(tgt).toFixed(1)}"/>
        <polyline class="od-ln" points="${pl(YN, 'noise')}"/><polyline class="od-l1" points="${pl(YU, 'Ulen')}"/><polyline class="od-l2" points="${pl(YU, 'Uwid')}"/>
        <text class="od-ax" x="2" y="${y0 + 8}">${(nmax * 100).toFixed(0)}%</text><text class="od-ax" x="2" y="${y1}">0%</text>
        <text class="od-ax" x="${x1 + 2}" y="${y0 + 8}">${uhi.toFixed(2)}</text><text class="od-ax" x="${x1 + 2}" y="${y1}">${ulo.toFixed(2)}</text>
        <text class="od-ax" x="${x0}" y="${h - 4}">광자 ${H[0].ph.toLocaleString()}</text><text class="od-ax" x="${x1}" y="${h - 4}" text-anchor="end">${last.ph.toLocaleString()} (로그)</text></svg>`;
    }
    const sTxt = { running: '계산 중', paused: '일시정지', done: reason === 'converged' ? '완료 — 목표 정확도 도달' : '계산 한도 도달 — 정확도 미달', pending: '대기', starting: '장면 준비' }[state] ?? state ?? '';
    const ctl = busy ? '기구 최적화 중' : calcLabel({ state, reason });
    // 틀은 한 번만 만들고 칸마다 바뀐 것만 고침 — 계산 중 갱신이 잦아도 단추 클릭·접는 칸이 끊기지 않게
    if (!el.querySelector('.od-simh')) {
      el.innerHTML = `<div class="od-h od-simh"><i class="m3-fl">4</i>광분포 시뮬레이션 <span class="mut" data-s="st"></span><span class="m3-ad-sp"></span>${onCtl ? '<button type="button" data-sim-ctl></button>' : ''}</div>
        <div class="od-pct"><b data-s="pct"></b><div class="od-bar od-bar-big" title="계산 오차가 목표에 닿으면 100%"><i data-s="bar"></i></div></div>
        <div class="od-row mut" data-s="row"></div><div class="od-diag" data-s="diag" hidden></div>
        <details class="od-more"><summary><span data-s="sum">정확도 그래프 · 광경로</span></summary><div data-s="svg"></div><div data-s="paths"></div></details>`;
      el.querySelector('[data-sim-ctl]')?.addEventListener('click', () => onCtl?.());
    }
    const set = (k, html) => { const n = el.querySelector(`[data-s="${k}"]`); if (n && n.innerHTML !== html) n.innerHTML = html; };
    set('st', busy ? '기구 최적화 중 — 일시정지(끝나면 이어서)' : esc(sTxt));
    const btn = el.querySelector('[data-sim-ctl]'); if (btn) { if (btn.textContent !== ctl) btn.textContent = ctl; btn.disabled = busy; }
    set('pct', `${pct.toFixed(0)}%`); el.querySelector('[data-s="bar"]').style.width = `${pct.toFixed(0)}%`;
    set('row', `오차 ${last && Number.isFinite(last.noise) ? `±${(last.noise * 100).toFixed(1)}%` : '–'} → 목표 ±${(tgt * 100).toFixed(1)}% · 광자 ${last ? last.ph.toLocaleString() : 0}${last ? ` · 길이 U ${f2(last.Ulen)} · 폭 U ${f2(last.Uwid)}` : ''}${state === 'running' ? etaText(H, tgt) : ''}`);
    const dg = el.querySelector('[data-s="diag"]'); if (dg) { dg.hidden = !diag; set('diag', diag?.html ?? ''); }
    set('svg', svg);
    // 접힌 줄에는 주 광경로 한 줄 요약, 펼치면 정확도(오차) 그래프 + 광경로 목록
    set('sum', P.length ? `정확도 그래프 · 광경로 <span class="mut">${(P[0].share * 100).toFixed(0)}% ${esc(pathText(P[0], names))}</span>` : '정확도 그래프 · 광경로');
    set('paths', P.length ? `<div class="od-paths">${P.map((p) => `<div class="od-path"><span class="od-pbar"><i style="width:${(p.share * 100).toFixed(0)}%"></i></span><b>${(p.share * 100).toFixed(0)}%</b> ${esc(pathText(p, names))}</div>`).join('')}</div>` : '');
  }
  render();
  return { sample, paths: () => P };
}
