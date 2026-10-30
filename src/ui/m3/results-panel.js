import { mountSplit } from './pane-split.js';
// 결과 패널 — spec 2026-10-15 m3-cad-ui §2(시안 m3-ui-mockup 오른쪽):
// ① 2D 광량 분포(관측면 펼침 s×w) + 평균 광량(목표 대비)·광 효율 ② 길이 1D 프로파일(목표선) + 길이 균일도 ③ 폭 1D 프로파일(최저 창) + 폭 균일도.
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

// 1D 프로파일(v2 평판 화면 수준) — 세로 = 최대 대비 %(최저·목표 아래까지 자동 확대, 10% 격자), 가로 = mm 눈금 격자,
// 목표 하한(빨간 점선 + 값), LED 위치(아래 노란 삼각형), 최저점 표시(값·위치), 마우스 위치 읽기(hover = 칸 번호).
// curves = [{ ys(0~1, NaN = 끊김), color, dash?, name, raw?(평활 전 원자료 — 흐린 가는 선, 최저점·마우스 값은 원자료) }] — 첫 곡선이 판정 대상(최저점 표시). 모든 치수는 dpr 배
const niceStep = (span, want) => { const raw = span / want, p = 10 ** Math.floor(Math.log10(raw)); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };
// 세로 범위(%): 최저·목표보다 5% 아래를 10% 단위로 내림, 위 = 102 — 순수
export function plotRange(curves, tg) {
  let mn = 100;
  for (const c of curves) for (const v of c.raw ?? c.ys) if (Number.isFinite(v)) mn = Math.min(mn, v * 100);
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
    if (c.raw) {   // 원자료(흐린 가는 선) 위에 평활 곡선
      x.globalAlpha = 0.35; x.strokeStyle = c.color; x.lineWidth = dpr; x.setLineDash([]);
      x.beginPath(); let pn = false;
      c.raw.forEach((v, i) => { if (!Number.isFinite(v)) { pn = false; return; } if (pn) x.lineTo(X(i), Y(v)); else { x.moveTo(X(i), Y(v)); pn = true; } });
      x.stroke(); x.globalAlpha = 1;
    }
    x.strokeStyle = c.color; x.lineWidth = (c.dash ? 1.2 : 1.8) * dpr; x.setLineDash(c.dash ? c.dash.map((d) => d * dpr) : []);
    x.beginPath(); let pen = false;
    c.ys.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) x.lineTo(X(i), Y(v)); else { x.moveTo(X(i), Y(v)); pen = true; } });
    x.stroke(); x.setLineDash([]);
  }
  // 최저점(첫 곡선)
  const main = curves[0], mys = main.raw ?? main.ys, n = mys.length, Xm = (i) => pl + ((i + 0.5) / n) * PW, at = (i) => x0 + ((i + 0.5) / n) * (x1 - x0);
  let im = -1; mys.forEach((v, i) => { if (Number.isFinite(v) && (im < 0 || v < mys[im])) im = i; });
  if (im >= 0) {   // 최저점 = 원자료(판정과 같은 값)
    x.fillStyle = '#d9473a'; x.beginPath(); x.arc(Xm(im), Y(mys[im]), 3.5 * dpr, 0, 2 * Math.PI); x.fill();
    const t = `최저 ${(mys[im] * 100).toFixed(1)}% @ ${at(im).toFixed(1)} mm`, right = Xm(im) > pl + PW * 0.6;
    x.textAlign = right ? 'right' : 'left'; x.textBaseline = 'top';
    x.fillText(t, Xm(im) + (right ? -6 : 6) * dpr, Math.min(Y(mys[im]) + 4 * dpr, pt + PH - 13 * dpr));
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
    const lines = [`${xl.split(' ')[0]} = ${at(hover).toFixed(1)} mm`, ...curves.map((c) => `${c.name}: ${Number.isFinite(c.ys[hover]) ? `${(c.ys[hover] * 100).toFixed(1)}%${c.raw && Number.isFinite(c.raw[hover]) ? ` (원자료 ${(c.raw[hover] * 100).toFixed(1)}%)` : ''}` : '–'}`)];
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
// 2D 광량 분포(v2 평판 화면 수준) — 색 = 최대 대비 %(오른쪽 색 막대 눈금), s·w mm 눈금, LED 위치(노란 점),
// 최저점 표시(값·위치), 마우스 위치 읽기. equal = 가로세로 같은 축척(실제 비율, 확대 창에서 선택). 모든 치수는 dpr 배
// v = { G, map, leds:[{s,w}] } · cv._mapv 에 저장 → 마우스 읽기·확대 창이 다시 그림
const MAP_PAD = { l: 40, r: 64, t: 8, b: 30 }, EXAG_MAX = 8, PIN_COLOR = '#ff8a1f';
// 지도 배치(순수) — 한 줄(가로 = 길이 s, 1D 프로파일과 같은 가로축). 길고 좁은 관측면(예: 440 × 5.5 mm)은 상자 높이를 다 쓰면
// 폭이 수십 배 과장되므로 폭 확대를 EXAG_MAX 배까지만(띠 높이 최소 28 px) — 띠는 상자 가운데. (예전엔 여러 줄로 접었지만 1D 프로파일과 맞춰 보기 어려움)
// equal = 가로세로 같은 축척(확대 창에서 선택) — 줄 안에서 정확히 1:1.
// 반환 { ox, oy, PW, rowH, pitch, K, segL, w0, w1, L, xy(s, w) → [x, y], at(x, y) → [s, w] | null, exag(폭 과장 배수) }
export function mapLayout(G, W, H, dpr = 1, equal = false) {
  const w0 = G.w0, w1 = G.w0 + G.nw * G.cell, wd = w1 - w0 || 1, L = G.L;
  let ox = MAP_PAD.l * dpr, oy = MAP_PAD.t * dpr, PW = W - (MAP_PAD.l + MAP_PAD.r) * dpr;
  const PH = H - (MAP_PAD.t + MAP_PAD.b) * dpr, gap = 16 * dpr;
  const K = 1;
  const segL = L / K;
  let rowH = Math.min(PH, Math.max(28 * dpr, wd * (PW / L) * EXAG_MAX));
  if (!equal) oy += (PH - rowH) / 2;
  if (equal) { const sc = Math.min(PW / segL, rowH / wd), pw = segL * sc, rh = wd * sc; ox += (PW - pw) / 2; oy += K > 1 ? 0 : (PH - rh) / 2; PW = pw; rowH = rh; }
  const pitch = rowH + (K > 1 ? gap : 0);
  const rowOf = (s) => Math.max(0, Math.min(K - 1, Math.floor(s / segL - 1e-9)));
  const xy = (s, w) => { const r = rowOf(s); return [ox + ((s - r * segL) / segL) * PW, oy + r * pitch + ((w1 - w) / wd) * rowH]; };
  const at = (px, py) => {
    const r = Math.floor((py - oy) / pitch), y = py - oy - r * pitch;
    if (r < 0 || r >= K || y < 0 || y > rowH || px < ox || px > ox + PW) return null;
    return [r * segL + ((px - ox) / PW) * segL, w1 - (y / rowH) * wd];
  };
  return { ox, oy, PW, rowH, pitch, K, segL, w0, w1, L, xy, at, exag: rowH / wd / (PW / segL) };
}
// 1D 가로축을 값이 있는 칸 범위로 자름(모든 곡선 중 처음·마지막 유한 칸) — 관측면 밖(NaN) 칸 때문에 폭 프로파일 양끝이 비던 것(2026-10-29). 값이 없으면 그대로 — 순수
export function cropFinite(curves, x0, x1) {
  const n = curves[0]?.ys.length ?? 0; let a = n, b = -1;
  for (const c of curves) c.ys.forEach((v, k) => { if (Number.isFinite(v)) { a = Math.min(a, k); b = Math.max(b, k); } });
  if (b < 0 || (a === 0 && b === n - 1)) return { curves, x0, x1 };
  const dx = (x1 - x0) / n;
  return { curves: curves.map((c) => ({ ...c, ys: Array.from(c.ys).slice(a, b + 1), ...(c.raw ? { raw: Array.from(c.raw).slice(a, b + 1) } : {}) })), x0: x0 + a * dx, x1: x0 + (b + 1) * dx };
}
// 표시용 평활 — 가우스(σ 칸, ±3σ), NaN 칸은 건너뛰고 자리는 NaN 그대로. 판정(U)에는 쓰지 않음 — 순수
export function smoothCurve(ys, sigma) {
  const n = ys.length, out = new Array(n), R = Math.max(1, Math.ceil(3 * sigma));
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(ys[i])) { out[i] = NaN; continue; }
    let s = 0, w = 0;
    for (let k = Math.max(0, i - R); k <= Math.min(n - 1, i + R); k++) if (Number.isFinite(ys[k])) { const g = Math.exp(-((k - i) ** 2) / (2 * sigma * sigma)); s += g * ys[k]; w += g; }
    out[i] = s / w;
  }
  return out;
}
// 1D 평활 폭(칸, 순수, 2026-10-30) — 칸 잡음 relNoise 를 평활 뒤 ≈ 0.4% 로(가우스 σ 칸 평균 ≈ 2√π·σ 칸 → 잡음 /√(2√πσ)).
// 상한 = LED 피치/8 · 3 mm(실제 LED 리플은 남김), 하한 0.5칸. 전에는 1칸 고정이라 고화질(1.1 mm 칸)은 거의 안 다듬고 저화질(4.4 mm)은 리플까지 깎았음
export function smoothSigma({ relNoise, ds, pitch = null }) {
  const want = Number.isFinite(relNoise) && relNoise > 0 ? (relNoise / 0.004) ** 2 / (2 * Math.sqrt(Math.PI)) : 1;
  const capMm = Math.min(3, pitch > 0 ? pitch / 8 : 3);
  return Math.max(0.5, Math.min(want, capMm / ds));
}
// 2D 분포 TXT(탭 구분) — 머리말(#) + 첫 줄 s 칸 중심(mm), 다음 줄부터 w 칸 중심(위 = +w 부터)과 값(최대 대비 %, 관측면 밖 = 빈칸) — 순수
export function mapTxt(G, map, { name = '', quality = '', photons = null, noise = null } = {}) {
  let mx = 0; for (let k = 0; k < map.length; k++) if (G.valid[k] && map[k] > mx) mx = map[k];
  const f = (v) => String(+v.toFixed(3)), head = [
    '# UDS 2D 광량 분포 (관측면 펼침) — 값 = 최대 대비 % · 빈칸 = 관측면 밖',
    `# ${name ? `이름 ${name} · ` : ''}길이 s 0–${f(G.L)} mm · 폭 w ${f(G.w0)}–${f(G.w0 + G.nw * G.cell)} mm · 칸 ${G.ns} × ${G.nw} (${f(G.ds)} × ${f(G.cell)} mm)${quality ? ` · 화질 ${quality}` : ''}${photons ? ` · 광자 ${photons}` : ''}${Number.isFinite(noise) ? ` · 오차 ±${(noise * 100).toFixed(2)}%` : ''}`,
    ['w\\s(mm)', ...Array.from({ length: G.ns }, (_, i) => f((i + 0.5) * G.ds))].join('\t'),
  ];
  for (let j = G.nw - 1; j >= 0; j--) {
    const row = [f(G.w0 + (j + 0.5) * G.cell)];
    for (let i = 0; i < G.ns; i++) { const k = i * G.nw + j; row.push(G.valid[k] && mx > 0 ? ((map[k] / mx) * 100).toFixed(2) : ''); }
    head.push(row.join('\t'));
  }
  return head.join('\n') + '\n';
}
// 1D 프로파일 TXT(탭 구분) — 그림마다 '# 제목' + 머리줄(x 이름, 곡선 이름) + x 칸 중심과 곡선별 값(최대 대비 %, 원자료 raw 우선, 값 없음 = 빈칸).
// list = [{ title, v: { curves, opt:{ x0, x1, xl } } | null }] — v 없는 그림은 건너뜀 — 순수
export function profileTxt(list) {
  const f = (v) => String(+v.toFixed(3)), out = ['# UDS 1D 프로파일 — 값 = 최대 대비 %(평활 전 원자료) · 빈칸 = 값 없음'];
  for (const { title, v } of list) {
    if (!v?.curves?.length) continue;
    const { x0, x1, xl } = v.opt, n = v.curves[0].ys.length, dx = (x1 - x0) / n;
    out.push('', `# ${title}`, [xl, ...v.curves.map((c) => c.name)].join('\t'));
    for (let i = 0; i < n; i++) out.push([f(x0 + (i + 0.5) * dx), ...v.curves.map((c) => { const y = (c.raw ?? c.ys)[i]; return Number.isFinite(y) ? (y * 100).toFixed(2) : ''; })].join('\t'));
  }
  return out.join('\n') + '\n';
}
// 2D 에서 지정한 칸 (i, j) 을 지나는 1D 곡선 — along = 길이 방향(w 칸 j 고정), across = 폭 방향(s 칸 i 고정, 원형 라인이면 반경 방향).
// 각 곡선은 자기 최대 = 1, 관측면 밖 칸 = NaN(끊김) — 순수
export function pointProfiles(G, map, i, j) {
  const along = new Float64Array(G.ns), across = new Float64Array(G.nw);
  for (let a = 0; a < G.ns; a++) { const k = a * G.nw + j; along[a] = G.valid[k] ? map[k] : NaN; }
  for (let b = 0; b < G.nw; b++) { const k = i * G.nw + b; across[b] = G.valid[k] ? map[k] : NaN; }
  for (const c of [along, across]) { const m = finiteMax(c); for (let k = 0; k < c.length; k++) c[k] = m > 0 ? c[k] / m : NaN; }
  return { along, across };
}
// 2D 표시 폭 범위 = 관측면 안 칸이 하나라도 있는 w 줄(jA~jB)만 — 위아래 빈(회색) 띠를 잘라 1D 폭 프로파일과 같은 범위(2026-10-29)
const VIEWG = new WeakMap();
export function mapViewG(G) {
  if (VIEWG.has(G)) return VIEWG.get(G);
  let jA = G.nw, jB = -1;
  for (let i = 0; i < G.ns; i++) for (let j = 0; j < G.nw; j++) if (G.valid[i * G.nw + j]) { if (j < jA) jA = j; if (j > jB) jB = j; }
  const v = jB < 0 ? { ...G, jA: 0, jB: G.nw - 1 } : { ...G, w0: G.w0 + jA * G.cell, nw: jB - jA + 1, jA, jB };
  VIEWG.set(G, v); return v;
}
function mapBox(cv, G, dpr, equal) { return mapLayout(mapViewG(G), cv.width, cv.height, dpr, equal); }
export function drawMap(cv, v, dpr = 1, hover = null, equal = false) {
  cv._mapv = { v, dpr, equal };
  LUT ??= buildLut();
  const { G, map } = v, x = cv.getContext('2d'), W = cv.width, H = cv.height, B = mapBox(cv, G, dpr, equal), { ox, oy, PW, rowH, pitch, K, segL, w0, w1, L, xy } = B;
  x.clearRect(0, 0, W, H);
  let mx = 0; for (let k = 0; k < map.length; k++) if (G.valid[k] && map[k] > mx) mx = map[k];
  // 칸 그림(가로 = s, 세로 위 = +w) → 줄마다 잘라 붙임(전체 띠를 K 배 길이로 그리고 그 줄 영역만 보이게)
  const tmp = document.createElement('canvas'); tmp.width = G.ns; tmp.height = G.nw;
  const tx = tmp.getContext('2d'), img = tx.createImageData(G.ns, G.nw), d = img.data, [nr, ng, nb] = NO_DATA_RGB;
  let kMin = -1;
  for (let i = 0; i < G.ns; i++) for (let j = 0; j < G.nw; j++) {
    const k = i * G.nw + j, q = ((G.nw - 1 - j) * G.ns + i) * 4;
    if (G.valid[k] && mx > 0) { const l = lutIndex(map[k] / mx) * 3; d[q] = LUT[l]; d[q + 1] = LUT[l + 1]; d[q + 2] = LUT[l + 2]; if (kMin < 0 || map[k] < map[kMin]) kMin = k; }
    else { d[q] = nr; d[q + 1] = ng; d[q + 2] = nb; }
    d[q + 3] = 255;
  }
  tx.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = !!v.smooth || (PW * K) / G.ns > 6;   // 부드럽게 = 칸 중심 사이 선형 보간(칸 중심 값 = 원자료 그대로), 끄면 칸 그대로(칸이 크게 보일 때만 보간)
  x.font = `${10.5 * dpr}px sans-serif`;
  const ss = niceStep(segL, Math.max(2, Math.round(PW / (70 * dpr))));
  for (let r = 0; r < K; r++) {
    const ry = oy + r * pitch, s0 = r * segL, s1 = (r + 1) * segL;
    const VG = mapViewG(G);   // 빈 줄을 뺀 w 줄만(그림 위 = +w = 큰 j)
    x.save(); x.beginPath(); x.rect(ox, ry, PW, rowH); x.clip(); x.drawImage(tmp, 0, G.nw - 1 - VG.jB, G.ns, VG.nw, ox - r * PW, ry, PW * K, rowH); x.restore();
    x.strokeStyle = 'rgba(128,140,160,.7)'; x.lineWidth = dpr; x.strokeRect(ox, ry, PW, rowH);
    x.fillStyle = '#8a93a6'; x.textAlign = 'center'; x.textBaseline = 'top';   // s 눈금(줄 아래)
    for (let sv = Math.ceil(s0 / ss - 1e-9) * ss; sv <= s1 + 1e-9; sv += ss) {
      const px = ox + ((sv - s0) / segL) * PW;
      x.strokeStyle = 'rgba(128,140,160,.6)'; x.beginPath(); x.moveTo(px, ry + rowH); x.lineTo(px, ry + rowH + 3 * dpr); x.stroke();
      x.fillText(`${+sv.toFixed(1)}`, px, ry + rowH + 4 * dpr);
    }
  }
  const yEnd = oy + (K - 1) * pitch + rowH;
  x.fillStyle = '#8a93a6'; x.textAlign = 'right'; x.textBaseline = 'top';
  x.fillText(`s (mm)${B.exag > 1.6 ? ` · 폭 ×${B.exag.toFixed(1)} 확대` : ''}`, ox + PW, yEnd + 17 * dpr);
  // w 눈금(첫 줄 왼쪽)
  const ws = niceStep(w1 - w0, Math.max(2, Math.round(rowH / (28 * dpr)))), WY = (w) => oy + ((w1 - w) / (w1 - w0)) * rowH;
  x.textBaseline = 'middle'; x.strokeStyle = 'rgba(128,140,160,.6)';
  for (let w = Math.ceil(w0 / ws - 1e-9) * ws; w <= w1 + 1e-9; w += ws) { x.beginPath(); x.moveTo(ox - 3 * dpr, WY(w)); x.lineTo(ox, WY(w)); x.stroke(); x.fillText(`${+w.toFixed(1)}`, ox - 5 * dpr, WY(w)); }
  x.save(); x.translate(10 * dpr, oy + rowH / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.fillText('w (mm)', 0, 0); x.restore();
  // 색 막대(0~100%) + 최저 표시
  const cTop = MAP_PAD.t * dpr, PH = H - (MAP_PAD.t + MAP_PAD.b) * dpr, bx = W - (MAP_PAD.r - 12) * dpr, bw = 11 * dpr;
  for (let i = 0; i < PH; i++) { const l = lutIndex(1 - i / PH) * 3; x.fillStyle = `rgb(${LUT[l]},${LUT[l + 1]},${LUT[l + 2]})`; x.fillRect(bx, cTop + i, bw, 1.5); }
  x.strokeStyle = 'rgba(128,140,160,.7)'; x.strokeRect(bx, cTop, bw, PH);
  x.fillStyle = '#8a93a6'; x.textAlign = 'left'; x.textBaseline = 'middle';
  for (let p = 0; p <= 100; p += 20) x.fillText(`${p}%`, bx + bw + 4 * dpr, cTop + (1 - p / 100) * PH);
  if (kMin >= 0) {
    const t = map[kMin] / mx, i = Math.floor(kMin / G.nw), j = kMin % G.nw, cs = (i + 0.5) * G.ds, cw = w0 + (j + 0.5) * G.cell, [px, py] = xy(cs, cw);
    x.strokeStyle = '#ffffff'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.moveTo(bx - 4 * dpr, cTop + (1 - t) * PH); x.lineTo(bx + bw, cTop + (1 - t) * PH); x.stroke();
    x.beginPath(); x.arc(px, py, 5 * dpr, 0, 2 * Math.PI); x.stroke();
    const lbl = `최저 ${(t * 100).toFixed(1)}% (s ${cs.toFixed(1)}, w ${cw.toFixed(1)})`, right = px > ox + PW * 0.6;
    x.font = `600 ${10.5 * dpr}px sans-serif`; const tw = x.measureText(lbl).width, lx = right ? px - 8 * dpr - tw : px + 8 * dpr, ly = Math.max(oy + 2 * dpr, Math.min(yEnd - 15 * dpr, py - 7 * dpr));
    x.fillStyle = 'rgba(20,26,38,.75)'; x.fillRect(lx - 3 * dpr, ly - 1 * dpr, tw + 6 * dpr, 14 * dpr);
    x.fillStyle = '#ffffff'; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(lbl, lx, ly);
    x.font = `${10.5 * dpr}px sans-serif`;
  }
  // 지정 점(클릭) — 주황 십자선 + 점: 이 점을 지나는 길이·폭 1D 프로파일이 아래에 함께 나옴
  if (v.pin) {
    const [px, py] = xy(v.pin.s, v.pin.w);
    x.beginPath(); x.moveTo(px, oy); x.lineTo(px, oy + rowH); x.moveTo(ox, py); x.lineTo(ox + PW, py);
    x.strokeStyle = 'rgba(10,14,22,.85)'; x.lineWidth = 3.2 * dpr; x.stroke();   // 어두운 테두리 — 주황·빨강 분포 위에서도 보이게
    x.strokeStyle = PIN_COLOR; x.lineWidth = 1.3 * dpr; x.stroke();
    x.beginPath(); x.arc(px, py, 4 * dpr, 0, 2 * Math.PI); x.fillStyle = PIN_COLOR; x.fill(); x.strokeStyle = 'rgba(10,14,22,.9)'; x.lineWidth = 1.5 * dpr; x.stroke();
  }
  // 마우스 위치 읽기(칸 [i, j]) — 그 줄 안에서 십자선
  if (hover && mx > 0) {
    const [i, j] = hover, k = i * G.nw + j, cs = (i + 0.5) * G.ds, cw = w0 + (j + 0.5) * G.cell, val = G.valid[k] ? `${((map[k] / mx) * 100).toFixed(1)}%` : '관측면 밖';
    const [px, py] = xy(cs, cw), ry = oy + Math.max(0, Math.min(K - 1, Math.floor(cs / segL - 1e-9))) * pitch;
    x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = dpr; x.setLineDash([3 * dpr, 3 * dpr]);
    x.beginPath(); x.moveTo(px, ry); x.lineTo(px, ry + rowH); x.moveTo(ox, py); x.lineTo(ox + PW, py); x.stroke(); x.setLineDash([]);
    const lbl = `s ${cs.toFixed(1)} · w ${cw.toFixed(1)} mm · ${val}`, tw = x.measureText(lbl).width;
    const lx = Math.max(ox + 3 * dpr, px + tw + 14 * dpr > ox + PW ? px - tw - 10 * dpr : px + 6 * dpr);
    x.fillStyle = 'rgba(20,26,38,.88)'; x.fillRect(lx - 3 * dpr, ry + 3 * dpr, tw + 6 * dpr, 15 * dpr);
    x.fillStyle = '#e6ebf2'; x.textAlign = 'left'; x.textBaseline = 'top'; x.fillText(lbl, lx, ry + 5 * dpr);
  }
}
function wireMapHover(cv) {
  if (cv._mhover) return;
  cv._mhover = true;
  const cell = (e) => {
    const M = cv._mapv; if (!M) return null;
    const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height), b = mapBox(cv, M.v.G, M.dpr, M.equal);
    const sw = b.at(px, py); if (!sw) return null;
    const G = M.v.G, i = Math.floor(sw[0] / G.ds), j = Math.floor((sw[1] - G.w0) / G.cell);
    return i >= 0 && i < G.ns && j >= 0 && j < G.nw ? [i, j] : null;
  };
  cv.addEventListener('mousemove', (e) => { const M = cv._mapv; if (M) drawMap(cv, M.v, M.dpr, cell(e), M.equal); });
  cv.addEventListener('mouseleave', () => { const M = cv._mapv; if (M) drawMap(cv, M.v, M.dpr, null, M.equal); });
  cv.addEventListener('click', (e) => { const M = cv._mapv, c = cell(e); if (M && c) cv._onPin?.(c, M.v.G); });   // 클릭 = 그 점 프로파일 지정
}
const clearCanvas = (c) => c.getContext('2d').clearRect(0, 0, c.width, c.height);
const dprNow = () => Math.max(1, globalThis.devicePixelRatio || 1);
// 캔버스를 화면 크기 × DPR 로 맞춘다(가로세로 비는 만들 때의 비 유지). 크기가 바뀌면 true
// 넓은 화면(> 1024px) = 칸 높이에 맞춤(CSS 가 높이를 정함 — 결과 창이 스크롤 없이 한 화면), 좁은 화면 = 가로세로 비
function sizeCanvas(cv, ratio) {
  const cw = cv.clientWidth, ch = cv.clientHeight, fit = (globalThis.innerWidth ?? 0) > 1024 && ch > 40;
  if (!cw) return false;
  const W = Math.round(cw * dprNow()), H = fit ? Math.round(ch * dprNow()) : Math.round(W / ratio);
  if (cv.width === W && cv.height === H) return false;
  cv.width = W; cv.height = H;
  return true;
}

const QUALITY_OPTS = [['low', '저화질'], ['mid', '중화질'], ['high', '고화질']];   // 칸 수 100×8 · 200×12 · 400×16 — 높을수록 계산 오래(중 ≈2배 · 고 ≈4배 광자)
export function createResultsPanel(el, { onQuality = null, fileName = () => 'uds', onLeak = null } = {}) {
  const gaugeHtml = (k) => `<div class="m3-gauge" data-r="${k}"><div class="f"></div><div class="tg"></div></div>`;
  el.innerHTML = `
    <div class="m3-msg" data-r="msg" hidden></div>
    <div class="m3-blk"><div class="m3-t">2D 광량 분포 (관측면 펼침) <span><span data-r="mapsub"></span> <select data-r="quality" title="2D 분포·1D 프로파일 해상도 — 저 100×8칸(빠름) · 중 200×12칸(광자 ≈2배) · 고 400×16칸(광자 ≈4배)" aria-label="분포 화질">${QUALITY_OPTS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>  <button type="button" class="m3-zoom" data-zoom="map" title="큰 창으로 보기" aria-label="2D 광량 분포 확대">⤢</button></span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="map" width="600" height="200"></canvas>
        <div class="m3-m"><div class="l">평균 광량</div><div class="v" data-r="avg">–</div><div class="s" data-r="avgs"></div>${gaugeHtml('avgg')}
          <div class="l" style="margin-top:6px">광 효율</div><div class="v sm" data-r="eff">–</div><div class="s">관측면 원뿔 안 / LED 총 방출</div><button type="button" class="m3-leak" data-r="leak" hidden title="누르면 3D 에서 가장 많이 새는 면을 강조"></button></div></div></div>
    <div class="m3-blk"><div class="m3-t">길이 방향 1D 프로파일 <span><span data-r="psub">폭 평균 · 2D 클릭 = 그 점 기준 곡선 추가</span> · 빨간 점선 = 목표 하한 <button type="button" class="m3-zoom" data-zoom="prof" title="큰 창으로 보기" aria-label="길이 프로파일 확대">⤢</button></span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="prof" width="600" height="150"></canvas>
        <div class="m3-m"><div class="l">길이 균일도</div><div class="v" data-r="ul">–</div>${gaugeHtml('ulg')}<div class="s" data-r="ulj"></div></div></div></div>
    <div class="m3-blk"><div class="m3-t">폭 방향 1D 프로파일 <span><span data-r="wsub"></span> <button type="button" class="m3-zoom" data-zoom="wprof" title="큰 창으로 보기" aria-label="폭 프로파일 확대">⤢</button></span></div>
      <div class="m3-withm"><canvas class="m3-g" data-r="wprof" width="600" height="120"></canvas>
        <div class="m3-m"><div class="l">폭 균일도</div><div class="v" data-r="uw">–</div>${gaugeHtml('uwg')}<div class="s" data-r="uwj"></div></div></div></div>`;
  const q = (k) => el.querySelector(`[data-r="${k}"]`);
  const RATIO = { map: 2.6, prof: 2.6, wprof: 3.2 };   // 눈금·색 막대·읽기가 들어가도록 높게
  wireHover(q('prof')); wireHover(q('wprof')); wireMapHover(q('map'));
  // 지정 점(mm — 화질을 바꿔도 같은 위치). 같은 칸을 다시 누르면 해제
  let pin = null;
  const onPin = ([i, j], G) => { const s = (i + 0.5) * G.ds, w = G.w0 + (j + 0.5) * G.cell; pin = pin && Math.abs(pin.s - s) < G.ds / 2 && Math.abs(pin.w - w) < G.cell / 2 ? null : { s, w }; if (last) update(last); };
  q('map')._onPin = onPin;
  q('quality').onchange = (e) => onQuality?.(e.target.value);
  q('leak').onclick = () => onLeak?.();
  // 부드럽게 = 늘 켬(2026-10-30 체크박스 없앰) — 2D 는 칸 중심 사이 선형 보간, 1D 는 잡음에 맞춘 평활(smoothSigma) 위에 원자료(흐린 선). 판정·최저점은 원자료
  const saveTxt = (txt, tag) => {
    const nm = String(fileName() ?? 'uds'), a = document.createElement('a'), url = URL.createObjectURL(new Blob(['\ufeff' + txt], { type: 'text/plain;charset=utf-8' }));
    a.href = url; a.download = `${nm.replace(/[\\/:*?"<>|]/g, '_')}-${tag}.txt`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const txt2D = () => {
    const sn = last?.snap, st = sn?.stats; if (!st || st.empty || !sn.G) return;
    saveTxt(mapTxt(sn.G, st.map, { name: String(fileName() ?? 'uds'), quality: { low: '저', mid: '중', high: '고' }[last.observe?.quality ?? 'low'], photons: sn.photons, noise: st.relNoiseCell }), '2D분포');
  };
  const txt1D = (k = null) => { const ks = k ? [k] : ['prof', 'wprof'], L = ks.filter((x) => VIEW[x]); if (L.length) saveTxt(profileTxt(L.map((x) => ({ title: TITLE[x], v: VIEW[x] }))), k === 'wprof' ? '폭1D' : k === 'prof' ? '길이1D' : '1D프로파일'); };   // k = 그 그림만
  // 1D 표시: 부드럽게면 평활 곡선(σ 1칸) + 원자료(raw), 가로축은 값이 있는 범위로
  const sm = (c, sig) => ({ ...c, ys: smoothCurve(Array.from(c.ys), sig), raw: Array.from(c.ys) });
  const plotView = (curves, tg, opt, sig = 1) => { const c = cropFinite(curves.map((x) => sm(x, sig)), opt.x0, opt.x1); return { curves: c.curves, tg, opt: { ...opt, x0: c.x0, x1: c.x1 } }; };
  // 큰 창(⤢, 어느 그림에서 눌러도) — 2D(위) + 길이 1D·폭 1D(아래)를 한 화면에. 그림마다 [⤢ 이 그림만] ↔ [모두 보기], 2D·1D TXT 저장.
  // 계산이 이어지면 같이 갱신 · 2D 는 [실제 비율] 전환 · 2D 클릭 = 지정 점 · Esc(한 그림만 → 모두 → 닫기)·바깥 클릭·닫기
  const KINDS = ['map', 'prof', 'wprof'];
  const VIEW = { map: null, prof: null, wprof: null }, TITLE = { map: '2D 광량 분포 (관측면 펼침)', prof: '길이 방향 1D 프로파일', wprof: '폭 방향 1D 프로파일' };
  let big = null;
  const paint = (kind, cv, hover = null) => {
    const v = VIEW[kind], dpr = dprNow();
    if (!v) { clearCanvas(cv); return; }
    if (kind === 'map') drawMap(cv, v, dpr, hover, cv === big?.cvs.map ? big.equal : false);
    else drawPlot(cv, v.curves, v.tg, v.opt, dpr, hover);
  };
  const paintBig = () => {
    if (!big) return;
    for (const k of KINDS) {
      const cv = big.cvs[k]; if (!cv.offsetParent) continue;   // 숨긴 그림(한 그림만 보기)은 건너뜀
      const r = cv.getBoundingClientRect(), d = dprNow(), W = Math.round(r.width * d), H = Math.round(r.height * d);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      paint(k, cv);
    }
  };
  const closeBig = () => { if (!big) return; big.ro?.disconnect(); big.el.remove(); document.removeEventListener('keydown', big.key); window.removeEventListener('resize', big.rs); big = null; };
  const setFocus = (k) => {
    big.focus = k; if (k) big.grid.dataset.focus = k; else delete big.grid.dataset.focus;   // 속성이 있으면(빈 값도) 한 그림 배치
    big.grid.querySelectorAll('[data-big-one]').forEach((b) => { const on = b.dataset.bigOne === k; b.textContent = on ? '↙ 모두 보기' : '⤢ 이 그림만'; b.title = on ? '2D·1D 를 한 화면에' : '이 그림만 화면 가득'; });
    paintBig();
  };
  function openBig() {
    closeBig();
    const ov = document.createElement('div');
    ov.className = 'm3-big'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', '광량 분포 2D·1D');
    const cell = (k) => `<div class="m3-big-c" data-k="${k}"><div class="m3-big-ct"><b>${TITLE[k]}</b><span class="m3-big-sp"></span>${k === 'map' ? '<label class="m3-big-eq"><input type="checkbox" data-big-eq> 실제 비율</label>' : ''}<button type="button" data-big-txt="${k}" title="${k === 'map' ? '2D 분포 표(탭 구분, 최대 대비 %)' : `${TITLE[k]} 표(원자료 %, 지정 점 곡선 포함)`}">TXT</button><button type="button" data-big-one="${k}">⤢ 이 그림만</button></div><canvas class="m3-big-cv" data-big-cv="${k}"></canvas></div>`;
    ov.innerHTML = `<div class="m3-big-in"><div class="m3-big-hd"><b>광량 분포 — 2D · 1D</b><span class="mut" style="font-size:12px">2D 클릭 = 그 점 기준 1D 곡선(주황)</span><span class="m3-big-sp"></span><button type="button" data-big-close>닫기 (Esc)</button></div>
      <div class="m3-big-grid">${cell('map')}<div class="m3-big-row">${cell('prof')}${cell('wprof')}</div></div></div>`;
    document.body.appendChild(ov);
    const cvs = Object.fromEntries(KINDS.map((k) => [k, ov.querySelector(`[data-big-cv="${k}"]`)]));
    big = { el: ov, cvs, grid: ov.querySelector('.m3-big-grid'), focus: null, equal: false, key: (e) => { if (e.key === 'Escape') { if (big.focus) setFocus(null); else closeBig(); } }, rs: () => paintBig() };
    document.addEventListener('keydown', big.key); window.addEventListener('resize', big.rs);
    ov.addEventListener('click', (e) => {
      if (e.target === ov) { closeBig(); return; }
      const one = e.target.closest('[data-big-one]'); if (one) { setFocus(big.focus === one.dataset.bigOne ? null : one.dataset.bigOne); return; }
      const t = e.target.closest('[data-big-txt]'); if (t) (t.dataset.bigTxt === 'map' ? txt2D() : txt1D(t.dataset.bigTxt));   // 그림마다 그 그림의 표
    });
    ov.querySelector('[data-big-close]').onclick = closeBig;
    const eq = ov.querySelector('[data-big-eq]'); eq.onchange = () => { big.equal = eq.checked; paint('map', cvs.map); };
    wireMapHover(cvs.map); cvs.map._onPin = onPin; wireHover(cvs.prof); wireHover(cvs.wprof);
    // 창 안 크기 조절: 2D ↕ 1D(높이) · 길이 1D ↔ 폭 1D(폭) — 끌기 막대(비율 기억). 창 자체 = 오른쪽 아래 모서리(CSS resize)
    const C = (k) => ov.querySelector(`.m3-big-c[data-k="${k}"]`);
    mountSplit([C('map'), ov.querySelector('.m3-big-row')], { key: 'uds.m3.bigV', dir: 'col', min: 120, onChange: () => paintBig() });
    mountSplit([C('prof'), C('wprof')], { key: 'uds.m3.bigH', dir: 'row', min: 160, onChange: () => paintBig() });
    if (typeof ResizeObserver !== 'undefined') { big.ro = new ResizeObserver(() => paintBig()); big.ro.observe(ov.querySelector('.m3-big-in')); }
    setFocus(null);
  }
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-zoom]'); if (b) openBig(); });
  // 메인 결과 칸 높이 조절(2D · 길이 1D · 폭 1D 사이 끌기 막대) — 전체 높이는 그대로, 비율만(보는 사람별)
  mountSplit([...el.querySelectorAll(':scope > .m3-blk')], { key: 'uds.m3.resSplit', dir: 'col', min: 110, onChange: () => { if (last) update(last); } });
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
    VIEW.map = VIEW.prof = VIEW.wprof = null; if (big) for (const k of KINDS) clearCanvas(big.cvs[k]);
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
    if (observe && document.activeElement !== q('quality')) q('quality').value = observe.quality ?? 'low';
    el.querySelectorAll('.m3-blk').forEach((b) => b.classList.toggle('dim', !st || !!st.empty));
    if (!st || st.empty || !G) { clear(message); return; }
    q('msg').hidden = !message; q('msg').textContent = message || '';
    for (const k of Object.keys(RATIO)) sizeCanvas(q(k), RATIO[k]);
    const dpr = dprNow();
    const VG = mapViewG(G); q('mapsub').textContent = `s 0–${G.L.toFixed(0)} mm × w ${VG.w0.toFixed(1)}–${(VG.w0 + VG.nw * VG.cell).toFixed(1)} mm`;
    const pm = finiteMax(st.profile), leds = args.leds ?? [];
    // 지정 점 → 칸 (화질·관측면이 바뀌어 밖이면 해제)
    const pi = pin ? Math.floor(pin.s / G.ds) : -1, pj = pin ? Math.floor((pin.w - G.w0) / G.cell) : -1;
    if (pin && !(pi >= 0 && pi < G.ns && pj >= 0 && pj < G.nw)) pin = null;
    const pp = pin ? pointProfiles(G, st.map, pi, pj) : null, ring = G.closed ? '원주' : '길이', rad = G.closed ? '반경(폭)' : '폭';
    VIEW.map = { G, map: st.map, leds, pin, smooth: true };
    // 평활 폭: 길이 = 잡음·LED 피치(중앙 간격)에 맞춤, 폭 = 잡음·관측 폭/8 에 맞춤
    const ls = [...new Set(leds.map((p) => +(+p.s).toFixed(2)))].sort((a, b) => a - b), gp = ls.slice(1).map((v, i) => v - ls[i]).sort((a, b) => a - b), pitch = gp.length ? gp[Math.floor(gp.length / 2)] : null;
    const sigL = smoothSigma({ relNoise: st.relNoise, ds: G.ds, pitch }), sigW = smoothSigma({ relNoise: st.relNoise, ds: G.cell, pitch: G.nw * G.cell });
    VIEW.prof = plotView([{ ys: Array.from(st.profile, (v) => v / pm), color: '#1f6fd1', name: '폭 평균' }, ...(pp ? [{ ys: Array.from(pp.along), color: PIN_COLOR, name: `지정 점 w=${pin.w.toFixed(1)}` }] : [])], observe.targetLen, { x0: 0, x1: G.L, xl: 's (mm)', leds: leds.map((p) => p.s) }, sigL);
    q('psub').textContent = pin ? `폭 평균 + 지정 점(주황, ${ring} 방향) · 같은 점 다시 클릭 = 해제` : '폭 평균 · 2D 클릭 = 그 점 기준 곡선 추가';
    paint('map', q('map')); paint('prof', q('prof'));
    gauge('ul', st.Ulen, observe.targetLen);
    if (pp && (st.Uwid == null || !st.win)) {   // 폭 판정이 없어도 지정 점의 폭(원형 = 반경) 방향 곡선은 보여 줌
      VIEW.wprof = plotView([{ ys: Array.from(pp.across), color: PIN_COLOR, name: `지정 점 s=${pin.s.toFixed(1)}` }], null, { x0: G.w0, x1: G.w0 + G.nw * G.cell, xl: 'w (mm)', leds: [] }, sigW);
      paint('wprof', q('wprof')); resetGauge(q('uwg'));
      q('uw').textContent = '–'; q('uw').className = 'v'; q('uwj').textContent = '폭 판정 불가(폭이 격자 2칸 미만)'; q('wsub').textContent = `지정 점 s = ${pin.s.toFixed(1)} mm · ${rad} 방향`;
    } else if (st.Uwid == null || !st.win) {
      VIEW.wprof = null; clearCanvas(q('wprof')); resetGauge(q('uwg'));
      q('uw').textContent = '–'; q('uw').className = 'v'; q('uwj').textContent = '폭 판정 불가(폭이 격자 2칸 미만)'; q('wsub').textContent = '';
    } else {
      // 판정 = 최저 창(실선), 비교 = 길이 전체 평균(점선) — 각자 최대 = 100%
      const wp = windowProfile(G, snap.sum, st.win[0], st.win[1]), wm = finiteMax(wp), wa = windowProfile(G, snap.sum, 0, G.ns), wam = finiteMax(wa);
      VIEW.wprof = plotView([{ ys: Array.from(wp, (v) => v / wm), color: '#1f6fd1', name: `최저 창 s=${st.sWorst.toFixed(0)}` }, { ys: Array.from(wa, (v) => v / wam), color: '#3fae7a', dash: [4, 3], name: '길이 전체 평균' }, ...(pp ? [{ ys: Array.from(pp.across), color: PIN_COLOR, name: `지정 점 s=${pin.s.toFixed(1)}` }] : [])],
        observe.targetWid, { x0: G.w0, x1: G.w0 + G.nw * G.cell, xl: 'w (mm)', leds: [...new Set(leds.map((p) => +p.w.toFixed(2)))] }, sigW);
      paint('wprof', q('wprof'));
      gauge('uw', st.Uwid, observe.targetWid);
      q('wsub').textContent = `최저 창 s = ${st.sWorst.toFixed(1)} mm${pp ? ` · 지정 점 s = ${pin.s.toFixed(1)} mm(주황, ${rad} 방향)` : ''}`;
    }
    const lc = lumCard(st, snap.photometry, observe.targetLum);
    q('avg').textContent = lc.value; q('avgs').textContent = lc.sub; q('avg').className = `v ${lc.pass == null ? '' : lc.pass ? 'ok' : 'bad'}`;
    q('avgg').hidden = lc.ratio == null;
    if (lc.ratio != null) fill(q('avgg'), lc.ratio * 50, lc.pass, 50);   // 목표 = 가운데, 목표의 2배 = 가득
    const eff = snap.photometry?.eff;
    q('eff').textContent = Number.isFinite(eff) ? `${(eff * 100).toFixed(1)}%` : '–';
    const lk = args.leak ?? ''; if (q('leak').textContent !== lk) q('leak').textContent = lk; q('leak').hidden = !lk;   // 새는 빛(광 효율 아래)
    paintBig();   // 큰 창도 계산을 따라감
  }
  if (typeof ResizeObserver !== 'undefined') {
    let w0 = 0;
    new ResizeObserver(() => { const c = q('map'), w = c.clientWidth ? `${c.clientWidth}x${c.clientHeight}` : 0; if (w && w !== w0) { w0 = w; if (last) update(last); } }).observe(el);   // 폭·높이(아래 칸 높이 조절) 바뀌면 다시 그림
  }
  clear();
  return { update };
}
