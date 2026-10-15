// 결과 패널 — spec 2026-10-15 m3-cad-ui §2(시안 m3-ui-mockup 오른쪽):
// ① 2D 광량 분포(관측면 펼침 s×w) + 평균 광량(목표 대비)·광 효율 ② 길이 1D 프로파일(목표선) + 길이 U ③ 폭 1D 프로파일(최저 창) + 폭 U.
// update({ snap(progressive snapshot), observe(spec.mech3d.observe), message(안내 | '') })
import { windowProfile } from '../../engine/mech3d/tally.js';
import { ramp } from './colormap.js';

// 표시 반올림은 판정과 엇갈리지 않게 한다: U·광량(클수록 좋음)은 내림, 미달 폭은 최소 한 자리(0.01 · 1 cd/m²)
export const fmtU = (v) => (Number.isFinite(v) ? (Math.floor(v * 100 + 1e-9) / 100).toFixed(2) : '–');
const finiteMax = (a) => { let m = -Infinity; for (const v of a) if (Number.isFinite(v) && v > m) m = v; return m; };
export function judgeText(v, tg) {
  if (!Number.isFinite(v)) return { cls: '', text: `목표 ${tg.toFixed(2)}` };
  const ok = v >= tg;
  return { cls: ok ? 'ok' : 'bad', text: `목표 ${tg.toFixed(2)} · ${ok ? '합격' : `미달 −${Math.max(0.01, tg - v).toFixed(2)}`}` };
}
// 평균 광량 카드: 광속이 있으면 cd/m²(목표 대비), 없으면 상대값(길이 프로파일 평균/최대)
export function lumCard(st, ph, targetLum) {
  if (ph?.lum != null && Number.isFinite(ph.lum)) {
    const ratio = targetLum > 0 ? ph.lum / targetLum : null;
    return { value: `${Math.floor(ph.lum + 1e-9)} cd/m²`, sub: ratio == null ? '목표 없음' : `목표 ${targetLum} cd/m² · ${ratio >= 1 ? '합격' : `미달 −${Math.max(1, Math.ceil(targetLum - ph.lum - 1e-9))}`}`, ratio, pass: ratio == null ? null : ratio >= 1 };
  }
  const p = Array.from(st?.profile ?? []).filter(Number.isFinite), mx = finiteMax(p), mean = p.reduce((a, b) => a + b, 0) / p.length;
  if (!p.length || !(mx > 0)) return { value: '–', sub: '최대 대비(LED 광속 입력 시 cd/m²)', ratio: null, pass: null };
  return { value: `${((mean / mx) * 100).toFixed(0)}%`, sub: '최대 대비(LED 광속 입력 시 cd/m²)', ratio: null, pass: null };
}

function drawMap(cv, G, map) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, img = x.createImageData(W, H);
  let mx = 0; for (let k = 0; k < map.length; k++) if (G.valid[k] && map[k] > mx) mx = map[k];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const si = Math.min(G.ns - 1, Math.floor((i / W) * G.ns)), wj = Math.min(G.nw - 1, Math.floor(((H - 1 - j) / H) * G.nw)), k = si * G.nw + wj;   // 위 = +w
    const c = G.valid[k] && mx > 0 ? ramp(map[k] / mx).map((v) => Math.round(v * 255)) : [236, 238, 242];
    const q = (j * W + i) * 4; img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}
// ys: 0~1(최대 대비, NaN = 구간 없음 → 선 끊김), tg: 목표 하한(빨간 점선)
function drawPlot(cv, ys, tg, { x0, x1, xl }) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pl = 34, pb = 20;
  x.clearRect(0, 0, W, H); x.strokeStyle = '#d9dde5'; x.lineWidth = 1; x.strokeRect(pl, 4, W - pl - 4, H - pb - 4);
  x.fillStyle = '#6b7385'; x.font = '18px sans-serif'; x.fillText('1.0', 2, 18); x.fillText('0', 14, H - pb);
  x.fillText(x0.toFixed(0), pl, H - 2); x.fillText(`${x1.toFixed(0)} ${xl}`, W - 120, H - 2);
  const n = ys.length, X = (i) => pl + ((i + 0.5) / n) * (W - pl - 4), Y = (v) => 4 + (1 - v) * (H - pb - 4);
  x.strokeStyle = '#1f6fd1'; x.lineWidth = 2.5; x.beginPath();
  let pen = false;
  ys.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } if (pen) x.lineTo(X(i), Y(v)); else { x.moveTo(X(i), Y(v)); pen = true; } });
  x.stroke();
  if (Number.isFinite(tg)) { x.strokeStyle = '#c8402f'; x.setLineDash([8, 6]); x.lineWidth = 2; x.beginPath(); x.moveTo(pl, Y(tg)); x.lineTo(W - 4, Y(tg)); x.stroke(); x.setLineDash([]); }
}
const clearCanvas = (c) => c.getContext('2d').clearRect(0, 0, c.width, c.height);

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
  const fill = (g, pct, ok, tgPct) => { g.querySelector('.f').style.width = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`; g.querySelector('.f').style.background = ok ? 'var(--m3-ok)' : 'var(--m3-bad)'; g.querySelector('.tg').style.left = `${tgPct.toFixed(0)}%`; };
  const resetGauge = (g) => { g.querySelector('.f').style.width = '0%'; };
  const gauge = (key, v, tg) => {
    const j = judgeText(v, tg);
    q(key).textContent = fmtU(v); q(key).className = `v ${j.cls}`; q(`${key}j`).textContent = j.text;
    fill(q(`${key}g`), Number.isFinite(v) ? v * 100 : 0, j.cls === 'ok', tg * 100);
  };
  function clear() {
    for (const k of ['map', 'prof', 'wprof']) clearCanvas(q(k));
    for (const k of ['avg', 'eff', 'ul', 'uw']) { q(k).textContent = '–'; q(k).className = 'v'; }
    for (const k of ['avgs', 'ulj', 'uwj', 'mapsub', 'wsub']) q(k).textContent = '';
    for (const k of ['avgg', 'ulg', 'uwg']) resetGauge(q(k));
    q('avgg').hidden = true;
  }
  function update({ snap, observe, message }) {
    const st = snap?.stats, G = snap?.G;
    q('msg').hidden = !message; q('msg').textContent = message || '';
    el.querySelectorAll('.m3-blk').forEach((b) => b.classList.toggle('dim', !st || !!st.empty));
    if (!st || st.empty || !G) { clear(); return; }
    q('mapsub').textContent = `s 0–${G.L.toFixed(0)} mm × w ${G.w0.toFixed(1)}–${(G.w0 + G.nw * G.cell).toFixed(1)} mm`;
    drawMap(q('map'), G, st.map);
    const pm = finiteMax(st.profile);
    drawPlot(q('prof'), Array.from(st.profile, (v) => v / pm), observe.targetLen, { x0: 0, x1: G.L, xl: 's (mm)' });
    gauge('ul', st.Ulen, observe.targetLen);
    if (st.Uwid == null || !st.win) {
      clearCanvas(q('wprof')); resetGauge(q('uwg'));
      q('uw').textContent = '–'; q('uw').className = 'v'; q('uwj').textContent = '폭 판정 불가(폭이 격자 2칸 미만)'; q('wsub').textContent = '';
    } else {
      const wp = windowProfile(G, snap.sum, st.win[0], st.win[1]), wm = finiteMax(wp);
      drawPlot(q('wprof'), Array.from(wp, (v) => v / wm), observe.targetWid, { x0: G.w0, x1: G.w0 + G.nw * G.cell, xl: 'w (mm)' });
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
  return { update };
}
