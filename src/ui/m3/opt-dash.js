// 아래 칸 대시보드 — ① 최적화 진행현황(6 항목 타일) ② 시뮬레이션 진행현황(수렴 그래프).
// 최적화: app.js 의 자동설계 io 가 progress(stage, frac, text) · evals(stage, [{label, Ulen, Uwid, ok, why}]) 를 부른다.
// 타일마다 상태(대기·진행 %·완료·건너뜀) · 시험 중 값 → 지금까지 최고 · 후보별 길이/폭 U 점 그래프(목표선) · 진행 막대.
// 시뮬레이션: 점진 계산 스냅숏마다 sample(snap, targetNoise) — 광자 수에 따른 잡음 %·길이/폭 U 추정과 진행률 %(잡음이 목표에 닿으면 100%).
import { calcLabel } from './command-bar.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const STAGES = [['milky', '① Milky'], ['position', '② 기구 위치 (LED 배치 · 높이)'], ['shape', '③ 기구 형상']];
// 자동설계 진행 단계 이름 → 타일(LED 배치·높이 = ② 기구 위치). 현재안·기준·검증 = 타일 없음(머리 줄 문구로만)
export const tileOf = (stage) => (stage === 'milky' || stage === 'shape' ? stage : stage === 'leds' || stage === 'height' ? 'position' : null);
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
const FB_COL = { milky: '#3b82f6', position: '#f59e0b', shape: '#a855f7' };
export function factorBoardHtml(S, nw = {}) {
  const tl = S?.tgLen ?? nw.tgLen, tw = S?.tgWid ?? nw.tgWid;
  const row = (k, name, nowTxt) => {
    const t = S?.tiles?.[k], on = t ? t.status !== 'off' : !!nw.on?.[k];
    const ev = (t?.evals ?? []).filter((e) => e.ok !== false && Number.isFinite(e.Ulen)); let b = null;
    for (const e of ev) if (!b || scoreOf(e, tl, tw) > scoreOf(b, tl, tw)) b = e;
    const chip = t ? { off: '미사용', wait: '대기', run: `진행 ${Math.round(t.frac * 100)}%`, done: '완료' }[t.status] : on ? '켜짐' : '꺼짐';
    const txt = `지금 ${nowTxt}${b ? ` → ${b.label} (${f2(b.Ulen)}/${f2(b.Uwid)})` : ''}`;
    return `<div class="fb-row${on ? '' : ' fb-off'}" title="${esc(txt)}"><i class="fb-dot" style="background:${FB_COL[k]}"></i><b>${name}</b><span class="od-chip">${chip}</span><span class="fb-val"><span class="mut">지금</span> ${esc(nowTxt)}${b ? ` → <b>${esc(b.label)}</b> <span class="mut">(${f2(b.Ulen)}/${f2(b.Uwid)})</span>` : ''}</span></div>`;
  };
  return `<div class="od-h">설계 인자 현황 <span class="mut">${Number.isFinite(nw.Ulen) ? `지금 ${f2(nw.Ulen)}/${f2(nw.Uwid)}` : ''}</span></div>
    <div class="od-legend">색 = 인자 · 실선 길이 U · 점선 폭 U <i class="od-kt"></i>목표 <i style="border-color:#8a96a8"></i>지금 <span style="color:#f0b400">○</span>최고</div>
    <div class="fb-plot"></div>
    ${row('milky', '① Milky', Number.isFinite(nw.milky) ? f2(nw.milky) : '확산 부품 없음')}${row('position', '② 위치', nw.leds ?? '–')}${row('shape', '③ 형상', nw.shape ?? '원래 형상')}`;
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
    if (best >= 0) body += `<circle class="od-best" cx="${X(best).toFixed(1)}" cy="${Y(seq[best].Ulen).toFixed(1)}" r="5"><title>최고 ${esc(seq[best].label)} (${f2(seq[best].Ulen)}/${f2(seq[best].Uwid)})</title></circle>`;
    body += `<text class="od-ax" x="${x0}" y="${H - 2}">후보 1</text><text class="od-ax" x="${x1}" y="${H - 2}" text-anchor="end">${n}</text>`;
  } else body += hl(tl, 'od-tg') + hl(tw, 'od-tg od-tg2') + hl(nw.Ulen, 'od-now') + `<text class="od-none" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle">자동설계를 실행하면 후보 균일도가 그려짐</text>`;
  return `<svg class="fb-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#c7cfdb" stroke-width=".5"/>${body}<text class="od-ax" x="2" y="${y0 + 6}">${hi.toFixed(2)}</text><text class="od-ax" x="2" y="${y1}">${lo.toFixed(2)}</text></svg>`;
}
// 후보의 점수(목표 대비 여유 — 둘 다 있으면 작은 쪽)
const scoreOf = (e, tl, tw) => (e.ok === false || !Number.isFinite(e.Ulen) ? -Infinity : Math.min(e.Ulen - tl, Number.isFinite(e.Uwid) && Number.isFinite(tw) ? e.Uwid - tw : Infinity));

// h = { config(k) → { on, html }(타일 머리의 켜기 스위치·설정), onSel(key, value) } — 실행 전·후에는 타일에서 항목을 고르고, 실행 중에는 진행을 봄
export function createOptDash(el, h = {}) {
  let S = null, raf = 0;
  el.addEventListener('change', (e) => { const x = e.target.closest('[data-ad]'); if (!x || !h.onSel) return; const k = x.dataset.ad; h.onSel(k, x.type === 'checkbox' ? x.checked : x.tagName === 'SELECT' ? +x.value : x.value === '' ? NaN : +x.value); });
  const blank = () => Object.fromEntries(STAGES.map(([k]) => [k, { status: 'off', frac: 0, text: '', evals: [] }]));
  function reset({ stages = {}, tgLen, tgWid } = {}) {
    S = { tiles: blank(), tgLen, tgWid, t0: performance.now(), cur: null, note: '', seq: [] };
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
  function evals(stage, list) { if (!S) return; const k = tileOf(stage); if (!k) { S.verify = list[list.length - 1] ?? S.verify; draw(); return; } const t = S.tiles[k]; t.evals.push(...list); S.seq.push(...list.map((e) => ({ ...e, k }))); if (t.status === 'off' || t.status === 'wait') t.status = 'run'; draw(); }
  function finish(ok, text = '') { if (!S) return; for (const [k] of STAGES) if (S.tiles[k].status === 'run') { S.tiles[k].status = 'done'; S.tiles[k].frac = 1; } S.note = text; S.ended = ok; draw(); }
  function draw() { if (raf) return; raf = setTimeout(() => { raf = 0; render(); renderBoard(); }, 40); }   // setTimeout: 화면이 숨겨져도(다른 탭) 갱신 — rAF 는 멈춤
  // 높이 조절 손잡이(.m3-fac-split)는 남기고 내용만 바꿈
  function renderBoard() { if (!h.board) return; let c = h.board.querySelector('.fb-body'); if (!c) { c = document.createElement('div'); c.className = 'fb-body'; h.board.appendChild(c); } const nw = h.now?.() ?? {}; c.innerHTML = factorBoardHtml(S, nw); const p = c.querySelector('.fb-plot'); if (p && p.clientWidth > 40 && p.clientHeight > 30) p.innerHTML = factorChartSvg(S, nw, p.clientWidth, p.clientHeight); }
  if (h.board && typeof ResizeObserver !== 'undefined') { let w0 = 0, h0 = 0; new ResizeObserver(() => { const b = h.board; if (b.clientWidth === w0 && b.clientHeight === h0) return; w0 = b.clientWidth; h0 = b.clientHeight; renderBoard(); }).observe(h.board); }   // 칸 크기가 바뀌면 그래프를 그 크기로 다시
  function render() {
    const idle = !S || S.ended != null || S.stopped;
    const head = !S ? `<div class="od-h">최적화 항목 <span class="mut">바꿀 항목을 켜고 [▶ 실행] — 실행하면 같은 타일에 진행·값 변화가 실시간으로 보입니다</span></div>` : '';
    if (!S) { el.innerHTML = `${head}<div class="od-grid">${STAGES.map(([k, name]) => { const c = h.config?.(k) ?? { on: false, html: '' }; return `<div class="od-tile ${c.on ? 'od-sel' : 'od-off'}"><div class="od-th"><b>${name}</b></div>${c.html}</div>`; }).join('')}</div>`; return; }
    const sec = ((performance.now() - S.t0) / 1000) | 0, nEval = STAGES.reduce((a, [k]) => a + S.tiles[k].evals.length, 0);
    const tile = ([k, name]) => {
      const t = S.tiles[k], ev = t.evals;
      let bi = -1, bs = -Infinity; ev.forEach((e, i) => { const s = scoreOf(e, S.tgLen, S.tgWid); if (s > bs) { bs = s; bi = i; } });
      const last = ev[ev.length - 1], best = bi >= 0 ? ev[bi] : null;
      const chip = { off: '미사용', wait: '대기', run: `진행 ${Math.round(t.frac * 100)}%`, done: '완료' }[t.status];
      const c = idle ? h.config?.(k) : null;   // 실행이 끝났으면 다시 고를 수 있게 스위치·설정을 같이
      return `<div class="od-tile od-${t.status}${c?.on ? ' od-sel' : ''}"><div class="od-th"><b>${name}</b><span class="od-chip">${chip}</span></div>${c ? c.html : ''}
        ${t.status === 'off' ? (c ? '' : '<div class="mut od-off">이번 실행에서 쓰지 않음</div>') : `
        <div class="od-row"><span class="mut">시험</span> ${last ? `${esc(last.label)} → ${f2(last.Ulen)}/${f2(last.Uwid)}${last.ok === false ? ` <span class="od-bad">${esc(last.why ?? '탈락')}</span>` : ''}` : '<span class="mut">–</span>'}</div>
        <div class="od-row"><span class="mut">최고</span> ${best ? `<b>${esc(best.label)}</b> → <b class="${bs >= 0 ? 'od-ok' : ''}">${f2(best.Ulen)}/${f2(best.Uwid)}</b>` : '<span class="mut">–</span>'} <span class="mut">· 후보 ${ev.length}개</span></div>
        ${evalSparkSvg(ev, S.tgLen, S.tgWid, bi)}
        <div class="od-bar"><i style="width:${Math.round((t.status === 'done' ? 1 : t.frac) * 100)}%"></i></div><div class="od-tx mut">${esc(t.text)}</div>`}</div>`;
    };
    el.innerHTML = `<div class="od-h">최적화 진행현황 <span class="mut">${S.ended == null ? `진행 ${sec}초` : S.ended ? '완료 — 목표 통과' : '완료 — 목표 미달'} · 시험한 후보 ${nEval}개 · 값 = 길이 U / 폭 U · 목표 ${f2(S.tgLen)}/${f2(S.tgWid)}</span>${S.verify && Number.isFinite(S.verify.Ulen) ? ` <span class="od-note">정밀 계산 ${esc(S.verify.label)} → ${f2(S.verify.Ulen)}/${f2(S.verify.Uwid)}</span>` : ''}${S.note ? ` <span class="od-note">${esc(S.note)}</span>` : ''}</div>
      <div class="od-legend"><i class="od-k1"></i>길이 U <i class="od-k2"></i>폭 U <i class="od-kt"></i>목표 <i class="od-kb"></i>최고</div>
      <div class="od-grid">${STAGES.map(tile).join('')}</div>`;
  }
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
// 오른쪽 맨 위 카드(항상 보임) — onCtl = 계산 제어 단추(일시정지·재개·다시 계산). 광경로 목록은 접는 칸
export function createSimDash(el, { onCtl = null } = {}) {
  let H = [], tgt = 0.02, raf = 0, state = '', obs = null, P = [], names = [], reason = '';
  // names = 부품 이름, nMech = 기구 부품 수(LED STEP 부품 번호는 그 뒤 — 경로에서 뺌)
  let busy = false;   // 자동설계 중(점진 계산 일시정지)
  function sample(snap, targetNoise, observe, nm = names, nMech = nm.length, adBusy = false) {
    busy = adBusy; tgt = targetNoise ?? tgt; obs = observe ?? obs; state = snap?.state ?? ''; reason = snap?.reason ?? ''; names = nm; P = topPaths(snap?.paths, nMech);
    const ph = snap?.photons ?? 0, st = snap?.stats;
    if (!st || st.empty || !ph) { if (!ph) H = []; draw(); return; }
    if (H.length && ph < H[H.length - 1].ph) H = [];   // 장면이 바뀌어 다시 시작
    if (!H.length || ph > H[H.length - 1].ph) H.push({ ph, noise: st.relNoise, Ulen: st.Ulen, Uwid: st.Uwid });
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
    const sTxt = { running: '계산 중', paused: '일시정지', done: '수렴 — 멈춤', pending: '대기', starting: '장면 준비' }[state] ?? state ?? '';
    const ctl = busy ? '자동설계 중' : calcLabel({ state, reason });
    // 틀은 한 번만 만들고 칸마다 바뀐 것만 고침 — 계산 중 갱신이 잦아도 단추 클릭·접는 칸이 끊기지 않게
    if (!el.querySelector('.od-simh')) {
      el.innerHTML = `<div class="od-h od-simh">현재 설계 계산 <span class="mut" data-s="st"></span><span class="m3-ad-sp"></span>${onCtl ? '<button type="button" data-sim-ctl></button>' : ''}</div>
        <div class="od-pct"><b data-s="pct"></b><div class="od-bar od-bar-big" title="계산 오차가 목표에 닿으면 100%"><i data-s="bar"></i></div></div>
        <div class="od-row mut" data-s="row"></div>
        <details class="od-more"><summary><span data-s="sum">수렴 그래프 · 광경로</span></summary><div data-s="svg"></div><div data-s="paths"></div></details>`;
      el.querySelector('[data-sim-ctl]')?.addEventListener('click', () => onCtl?.());
    }
    const set = (k, html) => { const n = el.querySelector(`[data-s="${k}"]`); if (n && n.innerHTML !== html) n.innerHTML = html; };
    set('st', busy ? '자동설계 중 — 일시정지(끝나면 이어서)' : esc(sTxt));
    const btn = el.querySelector('[data-sim-ctl]'); if (btn) { if (btn.textContent !== ctl) btn.textContent = ctl; btn.disabled = busy; }
    set('pct', `${pct.toFixed(0)}%`); el.querySelector('[data-s="bar"]').style.width = `${pct.toFixed(0)}%`;
    set('row', `오차 ${last && Number.isFinite(last.noise) ? `±${(last.noise * 100).toFixed(1)}%` : '–'} → 목표 ±${(tgt * 100).toFixed(1)}% · 광자 ${last ? last.ph.toLocaleString() : 0}${last ? ` · 길이 U ${f2(last.Ulen)} · 폭 U ${f2(last.Uwid)}` : ''}`);
    set('svg', svg);
    // 접힌 줄에는 주 광경로 한 줄 요약, 펼치면 수렴 그래프 + 광경로 목록
    set('sum', P.length ? `수렴 그래프 · 광경로 <span class="mut">${(P[0].share * 100).toFixed(0)}% ${esc(pathText(P[0], names))}</span>` : '수렴 그래프 · 광경로');
    set('paths', P.length ? `<div class="od-paths">${P.map((p) => `<div class="od-path"><span class="od-pbar"><i style="width:${(p.share * 100).toFixed(0)}%"></i></span><b>${(p.share * 100).toFixed(0)}%</b> ${esc(pathText(p, names))}</div>`).join('')}</div>` : '');
  }
  render();
  return { sample, paths: () => P };
}
