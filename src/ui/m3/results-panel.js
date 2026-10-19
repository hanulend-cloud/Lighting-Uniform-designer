// 결과 패널 — spec 2026-10-15 m3-cad-ui §2(시안 m3-ui-mockup 오른쪽):
// ① 2D 광량 분포(관측면 펼침 s×w) + 평균 광량(목표 대비)·광 효율 ② 길이 1D 프로파일(목표선) + 길이 U ③ 폭 1D 프로파일(최저 창) + 폭 U.
// update({ snap(progressive snapshot), observe(spec.mech3d.observe), message(안내 | '') })
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
// ys: 0~1(최대 대비, NaN = 구간 없음 → 선 끊김), tg: 목표 하한(빨간 점선). 모든 치수는 dpr 배
function drawPlot(cv, ys, tg, { x0, x1, xl }, dpr = 1) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pl = 34 * dpr, pb = 20 * dpr, pt = 4 * dpr, pr = 4 * dpr;
  x.clearRect(0, 0, W, H); x.strokeStyle = '#d9dde5'; x.lineWidth = dpr; x.strokeRect(pl, pt, W - pl - pr, H - pb - pt);
  x.fillStyle = '#6b7385'; x.font = `${11 * dpr}px sans-serif`;
  x.textAlign = 'right'; x.fillText('1.0', pl - 3 * dpr, pt + 10 * dpr); x.fillText('0', pl - 3 * dpr, H - pb);
  x.textAlign = 'left'; x.fillText(x0.toFixed(0), pl, H - 2 * dpr);
  x.textAlign = 'right'; x.fillText(`${x1.toFixed(0)} ${xl}`, W - pr, H - 2 * dpr);
  x.textAlign = 'left';
  const n = ys.length, X = (i) => pl + ((i + 0.5) / n) * (W - pl - pr), Y = (v) => pt + (1 - v) * (H - pb - pt);
  x.strokeStyle = '#1f6fd1'; x.lineWidth = 1.6 * dpr; x.beginPath();
  let pen = false;
  ys.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) x.lineTo(X(i), Y(v)); else { x.moveTo(X(i), Y(v)); pen = true; } });
  x.stroke();
  if (Number.isFinite(tg)) { x.strokeStyle = '#c8402f'; x.setLineDash([5 * dpr, 4 * dpr]); x.lineWidth = 1.3 * dpr; x.beginPath(); x.moveTo(pl, Y(tg)); x.lineTo(W - pr, Y(tg)); x.stroke(); x.setLineDash([]); }
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
  const RATIO = { map: 4, prof: 4, wprof: 5 };
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
    const pm = finiteMax(st.profile);
    drawPlot(q('prof'), Array.from(st.profile, (v) => v / pm), observe.targetLen, { x0: 0, x1: G.L, xl: 's (mm)' }, dpr);
    gauge('ul', st.Ulen, observe.targetLen);
    if (st.Uwid == null || !st.win) {
      clearCanvas(q('wprof')); resetGauge(q('uwg'));
      q('uw').textContent = '–'; q('uw').className = 'v'; q('uwj').textContent = '폭 판정 불가(폭이 격자 2칸 미만)'; q('wsub').textContent = '';
    } else {
      const wp = windowProfile(G, snap.sum, st.win[0], st.win[1]), wm = finiteMax(wp);
      drawPlot(q('wprof'), Array.from(wp, (v) => v / wm), observe.targetWid, { x0: G.w0, x1: G.w0 + G.nw * G.cell, xl: 'w (mm)' }, dpr);
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
