// 결과 패널 — spec 2026-10-15 m3-cad-ui §2(시안 m3-ui-mockup 오른쪽):
// ① 2D 광량 분포(관측면 펼침 s×w) + 평균 광량(목표 대비)·광 효율 ② 길이 1D 프로파일(목표선) + 길이 U ③ 폭 1D 프로파일(최저 창) + 폭 U.
// update({ snap(progressive snapshot), observe(spec.mech3d.observe), message(안내 | ''), leds?: [{s, w}](LED 위치 — 프로파일 아래 표시) })
import { windowProfile } from '../../engine/mech3d/tally.js';
import { ramp, NO_DATA } from './colormap.js';

export const DEFAULT_GUIDE = '관측면을 지정하면 결과가 여기에 표시됩니다.';
// 표시 반올림은 판정과 엇갈리지 않게 한다: U·광량(클수록 좋음)은 내림, 미달 폭은 최소 한 자리(0.01 · 1 cd/m²)
const fl100 = (v) => Math.floor(v * 100 + 1e-9);
export const fmtU = (v) => (Number.isFinite(v) ? (fl100(v) / 100).toFixed(2) : '–');
const finiteMax = (a) => { let m = -Infinity; for (const v of a) if (Number.isFinite(v) && v > m) m = v; return m; };
// 판정도 표시된(내림) 값끼리 비교한다 — 화면에 0.80 / 목표 0.80 인데 "미달"이 뜨는 일이 없게
export function judgeText(v, tg) {
  if (!Number.isFinite(v)) return { cls: '', text: `목표 ${fmtU(tg)}` };
  const vi = fl100(v), ti = fl100(tg), ok = vi >= ti;
  return { cls: ok ? 'ok' : 'bad', text: `목표 ${fmtU(tg)} · ${ok ? '합격' : `미달 −${(Math.max(1, ti - vi) / 100).toFixed(2)}`}` };
}
// 평균 광량 카드: 광속이 있으면 cd/m²(목표 대비), 없으면 상대값(길이 프로파일 평균/최대)
export function lumCard(st, ph, targetLum) {
  if (ph?.lum != null && Number.isFinite(ph.lum)) {
    const ratio = targetLum > 0 ? ph.lum / targetLum : null, li = Math.floor(ph.lum + 1e-9), ti = Math.floor(targetLum + 1e-9), pass = ratio == null ? null : li >= ti;
    return { value: `${li} cd/m²`, sub: ratio == null ? '목표 없음' : `목표 ${ti} cd/m² · ${pass ? '합격' : `미달 −${Math.max(1, ti - li)}`}`, ratio, pass };
  }
  const p = Array.from(st?.profile ?? []).filter(Number.isFinite), mx = finiteMax(p), mean = p.reduce((a, b) => a + b, 0) / p.length;
  if (!p.length || !(mx > 0)) return { value: '–', sub: '최대 대비(LED 광속 입력 시 cd/m²)', ratio: null, pass: null };
  return { value: `${((mean / mx) * 100).toFixed(0)}%`, sub: '최대 대비(LED 광속 입력 시 cd/m²)', ratio: null, pass: null };
}

// 256단계 색 표(RGB, 0~255) — colormap.js 의 ramp 에서 한 번만 만든다
let LUT = null;
export function buildLut() {
  const t = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { const c = ramp(i / 255); t[3 * i] = Math.round(c[0] * 255); t[3 * i + 1] = Math.round(c[1] * 255); t[3 * i + 2] = Math.round(c[2] * 255); }
  return t;
}
export const NO_DATA_RGB = NO_DATA.map((v) => Math.round(v * 255));
const lutIndex = (t) => Math.max(0, Math.min(255, Math.round(t * 255)));

const IMG = new WeakMap();   // canvas → ImageData (같은 크기면 다시 만들지 않는다)
function drawMap(cv, G, map) {
  LUT ??= buildLut();
  const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  let img = IMG.get(cv);
  if (!img || img.width !== W || img.height !== H) { img = x.createImageData(W, H); IMG.set(cv, img); }
  let mx = 0; for (let k = 0; k < map.length; k++) if (G.valid[k] && map[k] > mx) mx = map[k];
  const d = img.data, si = new Int32Array(W), [nr, ng, nb] = NO_DATA_RGB;
  for (let i = 0; i < W; i++) si[i] = Math.min(G.ns - 1, Math.floor((i / W) * G.ns)) * G.nw;
  for (let j = 0; j < H; j++) {
    const wj = Math.min(G.nw - 1, Math.floor(((H - 1 - j) / H) * G.nw));   // 위 = +w
    for (let i = 0; i < W; i++) {
      const k = si[i] + wj, q = (j * W + i) * 4;
      if (G.valid[k] && mx > 0) { const l = lutIndex(map[k] / mx) * 3; d[q] = LUT[l]; d[q + 1] = LUT[l + 1]; d[q + 2] = LUT[l + 2]; }
      else { d[q] = nr; d[q + 1] = ng; d[q + 2] = nb; }
      d[q + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
}
// 1D 프로파일(v2 평판 화면 수준) — 세로 = 최대 대비 %(최저·목표 아래까지 자동 확대, 10% 격자), 가로 = mm 눈금 격자,
// 목표 하한(빨간 점선 + 값), LED 위치(아래 노란 삼각형), 최저점 표시(값·위치), 마우스 위치 읽기(hover = 칸 번호).
// curves = [{ ys(0~1, NaN = 끊김), color, dash?, name }] — 첫 곡선이 판정 대상(최저점 표시). 모든 치수는 dpr 배
const niceStep = (span, want) => { const raw = span / want, p = 10 ** Math.floor(Math.log10(raw)); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };
// 세로 범위(%): 최저·목표보다 5% 아래를 10% 단위로 내림, 위 = 102 — 순수
export function plotRange(curves, tg) {
  let mn = 100;
  for (const c of curves) for (const v of c.ys) if (Number.isFinite(v)) mn = Math.min(mn, v * 100);
  if (Number.isFinite(tg)) mn = Math.min(mn, tg * 100);
  return { y0: Math.max(0, Math.floor((mn - 5) / 10) * 10), y1: 102 };
}
const PL = 38, PR = 8;
function drawPlot(cv, curves, tg, { x0, x1, xl, leds = [] }, dpr = 1, hover = null) {
  cv._plot = { curves, tg, opt: { x0, x1, xl, leds }, dpr };
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pl = PL * dpr, pb = 30 * dpr, pt = 16 * dpr, pr = PR * dpr;
  const { y0, y1 } = plotRange(curves, tg), PW = W - pl - pr, PH = H - pb - pt;
  const Y = (v) => pt + (1 - (v * 100 - y0) / (y1 - y0)) * PH, XS = (sv) => pl + ((sv - x0) / (x1 - x0 || 1)) * PW;
  x.clearRect(0, 0, W, H);
  x.font = `${10.5 * dpr}px sans-serif`; x.lineWidth = dpr;
  // % 격자·눈금(10% — 범위가 넓으면 20%)
  const ystep = y1 - y0 > 60 ? 20 : 10;
  x.textAlign = 'right'; x.textBaseline = 'middle';
  for (let v = y0; v <= 100; v += ystep) {
    x.strokeStyle = v === 100 ? 'rgba(128,140,160,.55)' : 'rgba(128,140,160,.22)';
    x.beginPath(); x.moveTo(pl, Y(v / 100)); x.lineTo(W - pr, Y(v / 100)); x.stroke();
    x.fillStyle = '#8a93a6'; x.fillText(`${v}%`, pl - 4 * dpr, Y(v / 100));
  }
  // mm 눈금 격자(아래)
  const st = niceStep(x1 - x0 || 1, Math.max(3, Math.round(PW / (70 * dpr))));
  x.textAlign = 'center'; x.textBaseline = 'top';
  for (let v = Math.ceil(x0 / st - 1e-9) * st; v <= x1 + 1e-9; v += st) {
    x.strokeStyle = 'rgba(128,140,160,.18)'; x.beginPath(); x.moveTo(XS(v), pt); x.lineTo(XS(v), pt + PH); x.stroke();
    x.fillStyle = '#8a93a6'; x.fillText(`${+v.toFixed(1)}`, XS(v), pt + PH + 7 * dpr);
  }
  x.textAlign = 'right'; x.fillText(xl, W - pr, pt + PH + 18 * dpr);
  x.strokeStyle = 'rgba(128,140,160,.6)'; x.strokeRect(pl, pt, PW, PH);
  // LED 위치(아래 노란 삼각형)
  x.fillStyle = 'rgba(240,190,40,.95)';
  for (const q of leds) {
    if (q < x0 - 1e-9 || q > x1 + 1e-9) continue;
    const px = XS(q);
    x.beginPath(); x.moveTo(px, pt + PH); x.lineTo(px - 3.5 * dpr, pt + PH + 6 * dpr); x.lineTo(px + 3.5 * dpr, pt + PH + 6 * dpr); x.closePath(); x.fill();
  }
  // 목표 하한
  if (Number.isFinite(tg)) {
    x.strokeStyle = '#d9473a'; x.setLineDash([5 * dpr, 4 * dpr]); x.lineWidth = 1.3 * dpr;
    x.beginPath(); x.moveTo(pl, Y(tg)); x.lineTo(W - pr, Y(tg)); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#d9473a'; x.textAlign = 'left'; x.textBaseline = 'bottom'; x.fillText(`목표 ${(tg * 100).toFixed(0)}%`, pl + 4 * dpr, Y(tg) - 2 * dpr);
  }
  // 곡선(칸 가운데)
  for (const c of curves) {
    const n = c.ys.length, X = (i) => pl + ((i + 0.5) / n) * PW;
    x.strokeStyle = c.color; x.lineWidth = (c.dash ? 1.2 : 1.8) * dpr; x.setLineDash(c.dash ? c.dash.map((d) => d * dpr) : []);
    x.beginPath(); let pen = false;
    c.ys.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) x.lineTo(X(i), Y(v)); else { x.moveTo(X(i), Y(v)); pen = true; } });
    x.stroke(); x.setLineDash([]);
  }
  // 최저점(첫 곡선)
  const main = curves[0], n = main.ys.length, Xm = (i) => pl + ((i + 0.5) / n) * PW, at = (i) => x0 + ((i + 0.5) / n) * (x1 - x0);
  let im = -1; main.ys.forEach((v, i) => { if (Number.isFinite(v) && (im < 0 || v < main.ys[im])) im = i; });
  if (im >= 0) {
    x.fillStyle = '#d9473a'; x.beginPath(); x.arc(Xm(im), Y(main.ys[im]), 3.5 * dpr, 0, 2 * Math.PI); x.fill();
    const t = `최저 ${(main.ys[im] * 100).toFixed(1)}% @ ${at(im).toFixed(1)} mm`, right = Xm(im) > pl + PW * 0.6;
    x.textAlign = right ? 'right' : 'left'; x.textBaseline = 'top';
    x.fillText(t, Xm(im) + (right ? -6 : 6) * dpr, Math.min(Y(main.ys[im]) + 4 * dpr, pt + PH - 13 * dpr));
  }
  // 범례(곡선 2개 이상)
  if (curves.length > 1) {
    x.textAlign = 'right'; x.textBaseline = 'top'; let lx = W - pr - 4 * dpr;
    for (const c of [...curves].reverse()) {
      const w = x.measureText(c.name).width;
      x.fillStyle = '#8a93a6'; x.fillText(c.name, lx, 2 * dpr); lx -= w + 6 * dpr;
      x.strokeStyle = c.color; x.lineWidth = 1.5 * dpr; x.setLineDash(c.dash ? c.dash.map((d) => d * dpr) : []);
      x.beginPath(); x.moveTo(lx - 14 * dpr, 8 * dpr); x.lineTo(lx, 8 * dpr); x.stroke(); x.setLineDash([]); lx -= 22 * dpr;
    }
  }
  // 마우스 위치 읽기
  if (hover != null && hover >= 0 && hover < n) {
    const hx = Xm(hover);
    x.strokeStyle = 'rgba(128,140,160,.8)'; x.lineWidth = dpr; x.setLineDash([2 * dpr, 2 * dpr]); x.beginPath(); x.moveTo(hx, pt); x.lineTo(hx, pt + PH); x.stroke(); x.setLineDash([]);
    const lines = [`${xl.split(' ')[0]} = ${at(hover).toFixed(1)} mm`, ...curves.map((c) => `${c.name}: ${Number.isFinite(c.ys[hover]) ? `${(c.ys[hover] * 100).toFixed(1)}%` : '–'}`)];
    const bw = Math.max(...lines.map((l) => x.measureText(l).width)) + 10 * dpr, bh = lines.length * 13 * dpr + 6 * dpr;
    const bx = hx + bw + 8 * dpr > W - pr ? hx - bw - 6 * dpr : hx + 6 * dpr;
    x.fillStyle = 'rgba(20,26,38,.88)'; x.fillRect(bx, pt + 2 * dpr, bw, bh);
    x.fillStyle = '#e6ebf2'; x.textAlign = 'left'; x.textBaseline = 'top'; lines.forEach((l, k) => x.fillText(l, bx + 5 * dpr, pt + 5 * dpr + k * 13 * dpr));
  }
}
// 마우스를 올리면 그 칸의 값을 보여 줌(캔버스마다 한 번)
function wireHover(cv) {
  if (cv._hover) return;
  cv._hover = true;
  const idx = (e) => {
    const P = cv._plot; if (!P) return null;
    const r = cv.getBoundingClientRect(), pl = PL * P.dpr, pr = PR * P.dpr, px = (e.clientX - r.left) * (cv.width / r.width), n = P.curves[0].ys.length;
    const i = Math.floor(((px - pl) / (cv.width - pl - pr)) * n);
    return i >= 0 && i < n ? i : null;
  };
  cv.addEventListener('mousemove', (e) => { const P = cv._plot; if (P) drawPlot(cv, P.curves, P.tg, P.opt, P.dpr, idx(e)); });
  cv.addEventListener('mouseleave', () => { const P = cv._plot; if (P) drawPlot(cv, P.curves, P.tg, P.opt, P.dpr, null); });
}
const clearCanvas = (c) => c.getContext('2d').clearRect(0, 0, c.width, c.height);
const dprNow = () => Math.max(1, globalThis.devicePixelRatio || 1);
// 캔버스를 화면 크기 × DPR 로 맞춘다(가로세로 비는 만들 때의 비 유지). 크기가 바뀌면 true
function sizeCanvas(cv, ratio) {
  const cw = cv.clientWidth;
  if (!cw) return false;
  const W = Math.round(cw * dprNow()), H = Math.round(W / ratio);
  if (cv.width === W && cv.height === H) return false;
  cv.width = W; cv.height = H;
  return true;
}

export function createResultsPanel(el) {
  const gaugeHtml = (k) => `<div class="m3-gauge" data-r="${k}"><div class="f"></div><div class="tg"></div></div>`;
  el.innerHTML = `
    <div class="m3-msg" data-r="msg" hidden></div>
    <div class="m3-blk"><div class="m3-t">2D 광량 분포 (관측면 펼침) <span data-r="mapsub"></span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="map" width="600" height="150"></canvas>
        <div class="m3-m"><div class="l">평균 광량</div><div class="v" data-r="avg">–</div><div class="s" data-r="avgs"></div>${gaugeHtml('avgg')}
          <div class="l" style="margin-top:6px">광 효율</div><div class="v sm" data-r="eff">–</div><div class="s">관측면 원뿔 안 / LED 총 방출</div></div></div></div>
    <div class="m3-blk"><div class="m3-t">길이 방향 1D 프로파일 <span>폭 평균 · 빨간 점선 = 목표 하한</span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="prof" width="600" height="150"></canvas>
        <div class="m3-m"><div class="l">길이 균일도 U</div><div class="v" data-r="ul">–</div>${gaugeHtml('ulg')}<div class="s" data-r="ulj"></div></div></div></div>
    <div class="m3-blk"><div class="m3-t">폭 방향 1D 프로파일 <span data-r="wsub"></span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="wprof" width="600" height="120"></canvas>
        <div class="m3-m"><div class="l">폭 균일도 U</div><div class="v" data-r="uw">–</div>${gaugeHtml('uwg')}<div class="s" data-r="uwj"></div></div></div></div>`;
  const q = (k) => el.querySelector(`[data-r="${k}"]`);
  const RATIO = { map: 4, prof: 2.6, wprof: 3.2 };   // 프로파일은 눈금·읽기가 들어가도록 높게
  wireHover(q('prof')); wireHover(q('wprof'));
  let last = null;
  const fill = (g, pct, ok, tgPct) => {
    const f = g.querySelector('.f'), w = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
    if (f.style.width !== w) f.style.width = w;
    f.classList.toggle('ok', !!ok); f.classList.toggle('bad', !ok);
    const l = `${tgPct.toFixed(0)}%`, t = g.querySelector('.tg');
    if (t.style.left !== l) t.style.left = l;
  };
  const resetGauge = (g) => { g.querySelector('.f').style.width = '0%'; };
  const gauge = (key, v, tg) => {
    const j = judgeText(v, tg);
    q(key).textContent = fmtU(v); q(key).className = `v ${j.cls}`; q(`${key}j`).textContent = j.text;
    fill(q(`${key}g`), Number.isFinite(v) ? v * 100 : 0, j.cls === 'ok', tg * 100);
  };
  function clear(message) {
    for (const k of ['map', 'prof', 'wprof']) clearCanvas(q(k));
    for (const k of ['avg', 'eff', 'ul', 'uw']) { q(k).textContent = '–'; q(k).className = 'v'; }
    for (const k of ['avgs', 'ulj', 'uwj', 'mapsub', 'wsub']) q(k).textContent = '';
    for (const k of ['avgg', 'ulg', 'uwg']) resetGauge(q(k));
    q('avgg').hidden = true;
    q('msg').hidden = false; q('msg').textContent = message || DEFAULT_GUIDE;
  }
  function update(args) {
    last = args;
    const { snap, observe, message } = args, st = snap?.stats, G = snap?.G;
    el.querySelectorAll('.m3-blk').forEach((b) => b.classList.toggle('dim', !st || !!st.empty));
    if (!st || st.empty || !G) { clear(message); return; }
    q('msg').hidden = !message; q('msg').textContent = message || '';
    for (const k of Object.keys(RATIO)) sizeCanvas(q(k), RATIO[k]);
    const dpr = dprNow();
    q('mapsub').textContent = `s 0–${G.L.toFixed(0)} mm × w ${G.w0.toFixed(1)}–${(G.w0 + G.nw * G.cell).toFixed(1)} mm`;
    drawMap(q('map'), G, st.map);
    const pm = finiteMax(st.profile), leds = args.leds ?? [];
    drawPlot(q('prof'), [{ ys: Array.from(st.profile, (v) => v / pm), color: '#1f6fd1', name: '폭 평균' }], observe.targetLen, { x0: 0, x1: G.L, xl: 's (mm)', leds: leds.map((p) => p.s) }, dpr);
    gauge('ul', st.Ulen, observe.targetLen);
    if (st.Uwid == null || !st.win) {
      clearCanvas(q('wprof')); resetGauge(q('uwg'));
      q('uw').textContent = '–'; q('uw').className = 'v'; q('uwj').textContent = '폭 판정 불가(폭이 격자 2칸 미만)'; q('wsub').textContent = '';
    } else {
      // 판정 = 최저 창(실선), 비교 = 길이 전체 평균(점선) — 각자 최대 = 100%
      const wp = windowProfile(G, snap.sum, st.win[0], st.win[1]), wm = finiteMax(wp), wa = windowProfile(G, snap.sum, 0, G.ns), wam = finiteMax(wa);
      drawPlot(q('wprof'), [{ ys: Array.from(wp, (v) => v / wm), color: '#1f6fd1', name: `최저 창 s=${st.sWorst.toFixed(0)}` }, { ys: Array.from(wa, (v) => v / wam), color: '#3fae7a', dash: [4, 3], name: '길이 전체 평균' }],
        observe.targetWid, { x0: G.w0, x1: G.w0 + G.nw * G.cell, xl: 'w (mm)', leds: [...new Set(leds.map((p) => +p.w.toFixed(2)))] }, dpr);
      gauge('uw', st.Uwid, observe.targetWid);
      q('wsub').textContent = `최저 창 s = ${st.sWorst.toFixed(1)} mm`;
    }
    const lc = lumCard(st, snap.photometry, observe.targetLum);
    q('avg').textContent = lc.value; q('avgs').textContent = lc.sub; q('avg').className = `v ${lc.pass == null ? '' : lc.pass ? 'ok' : 'bad'}`;
    q('avgg').hidden = lc.ratio == null;
    if (lc.ratio != null) fill(q('avgg'), lc.ratio * 50, lc.pass, 50);   // 목표 = 가운데, 목표의 2배 = 가득
    const eff = snap.photometry?.eff;
    q('eff').textContent = Number.isFinite(eff) ? `${(eff * 100).toFixed(1)}%` : '–';
  }
  if (typeof ResizeObserver !== 'undefined') {
    let w0 = 0;
    new ResizeObserver(() => { const w = q('map').clientWidth; if (w && w !== w0) { w0 = w; if (last) update(last); } }).observe(el);
  }
  clear();
  return { update };
}
