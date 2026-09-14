// 3D 입체뷰 — 기구물 박스(타겟 footprint를 깊이만큼 압출) + LED 배치. 드래그로 자유 회전.
// 형상 디테일(난이도별 단면)은 생략하고 박스+LED만 간단히 — 단면도/평면도의 보조 확인용.

import { fitCanvas, PAD } from './canvas-util.js';

const C = {
  bg: '#0f1420', edge: '#5b6b86', edgeTop: '#7cb0ff', top: 'rgba(96,165,250,0.16)',
  side: 'rgba(96,165,250,0.10)', bottom: 'rgba(15,20,32,0.55)', led: '#ffcf3f', text: '#d7deea', dim: '#95a0b3',
};

const DEG = Math.PI / 180;
const DEF_AZ = 35 * DEG, DEF_EL = 28 * DEG;
const EL_MAX = 87 * DEG;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ── 최소 3D 카메라: 방위각(az)·고도각(el) → 정규직교 카메라 기저(오른쪽·위·시선) ──
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function basisFor(az, el) {
  const ce = Math.cos(el), se = Math.sin(el);
  const eyeDir = { x: ce * Math.cos(az), y: ce * Math.sin(az), z: se };  // 타겟→카메라 단위벡터
  const right = norm(cross({ x: 0, y: 0, z: 1 }, eyeDir));               // world-up=Z 기준 오른쪽
  const camUp = norm(cross(eyeDir, right));
  return { eyeDir, right, camUp };
}

export function drawIso(canvas, g) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

  const st = canvas._iso ?? (canvas._iso = { az: DEF_AZ, el: DEF_EL });
  st.redraw = () => drawIso(canvas, g);
  hookDrag(canvas);

  const X = g.target.x, Y = g.target.y, Z = g.depth;
  const cx = X / 2, cy = Y / 2, cz = Z / 2;
  const basis = basisFor(st.az, st.el);
  const proj = (x, y, z) => {
    const p = { x: x - cx, y: y - cy, z: z - cz };
    return { sx: dot(p, basis.right), sy: -dot(p, basis.camUp), depth: dot(p, basis.eyeDir) };
  };

  const c = {
    b00: proj(0, 0, 0), bX0: proj(X, 0, 0), bXY: proj(X, Y, 0), b0Y: proj(0, Y, 0),
    t00: proj(0, 0, Z), tX0: proj(X, 0, Z), tXY: proj(X, Y, Z), t0Y: proj(0, Y, Z),
  };
  const ledZ = g.ledSize?.z || 0;
  const ledPts = g.leds.map((p) => proj(p.x, p.y, ledZ));

  const all = [...Object.values(c), ...ledPts];
  const minX = Math.min(...all.map((p) => p.sx)), maxX = Math.max(...all.map((p) => p.sx));
  const minY = Math.min(...all.map((p) => p.sy)), maxY = Math.max(...all.map((p) => p.sy));
  const availW = w - PAD.L - PAD.R, availH = h - PAD.T - PAD.B;
  const s = Math.min(availW / (maxX - minX || 1), availH / (maxY - minY || 1));
  const ox = PAD.L + (availW - (maxX - minX) * s) / 2 - minX * s;
  const oy = PAD.T + (availH - (maxY - minY) * s) / 2 - minY * s;
  const P = (p) => ({ x: ox + p.sx * s, y: oy + p.sy * s });

  const poly = (pts, fill) => {
    const pp = pts.map(P);
    ctx.beginPath(); ctx.moveTo(pp[0].x, pp[0].y);
    for (let i = 1; i < pp.length; i++) ctx.lineTo(pp[i].x, pp[i].y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const seg = (a, b, style, width) => {
    const pa = P(a), pb = P(b);
    ctx.strokeStyle = style; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  };

  // 6면 중 카메라를 향한(법선·시선 > 0) 면만, 먼 것부터(화가 알고리즘) 채워 입체감을 낸다.
  const faces = [
    { n: { x: 1, y: 0, z: 0 }, pts: [c.bX0, c.bXY, c.tXY, c.tX0], fill: C.side },
    { n: { x: -1, y: 0, z: 0 }, pts: [c.b00, c.b0Y, c.t0Y, c.t00], fill: C.side },
    { n: { x: 0, y: 1, z: 0 }, pts: [c.b0Y, c.bXY, c.tXY, c.t0Y], fill: C.side },
    { n: { x: 0, y: -1, z: 0 }, pts: [c.b00, c.bX0, c.tX0, c.t00], fill: C.side },
    { n: { x: 0, y: 0, z: 1 }, pts: [c.t00, c.tX0, c.tXY, c.t0Y], fill: C.top },
    { n: { x: 0, y: 0, z: -1 }, pts: [c.b00, c.bX0, c.bXY, c.b0Y], fill: C.bottom },
  ];
  const visible = faces.filter((f) => dot(f.n, basis.eyeDir) > 0.02);
  visible.sort((a, b) => (a.pts.reduce((s2, p) => s2 + p.depth, 0) - b.pts.reduce((s2, p) => s2 + p.depth, 0)));
  for (const f of visible) poly(f.pts, f.fill);

  // 모서리(12개, 항상 전부) — 반투명 면 너머로도 형상 윤곽을 알 수 있게.
  [[c.b00, c.bX0], [c.bX0, c.bXY], [c.bXY, c.b0Y], [c.b0Y, c.b00],
   [c.b00, c.t00], [c.bX0, c.tX0], [c.bXY, c.tXY], [c.b0Y, c.t0Y],
   [c.t00, c.tX0], [c.tX0, c.tXY], [c.tXY, c.t0Y], [c.t0Y, c.t00]].forEach(([a, b]) => seg(a, b, C.edge, 1.3));
  // 윗면(관찰면) 모서리는 강조색으로 한 번 더.
  [[c.t00, c.tX0], [c.tX0, c.tXY], [c.tXY, c.t0Y], [c.t0Y, c.t00]].forEach(([a, b]) => seg(a, b, C.edgeTop, 1.5));

  // LED 점
  ctx.fillStyle = C.led;
  for (const lp of ledPts) { const p = P(lp); ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }

  ctx.fillStyle = C.text; ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`3D 입체도 · 최종 적용: ${g.levelText}`, PAD.L, 15);
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  ctx.fillText(`LED ${g.leds.length}개 · ${X}×${Y}×${Z.toFixed(0)}mm`, PAD.L, h - 7);
  canvas.title = '드래그: 회전 · 더블클릭: 시점 초기화';
}

// 마우스/터치 드래그로 az(수평)·el(수직) 갱신 — 캔버스가 모달로 옮겨져도(팝업 확대) 리스너는
// 엘리먼트에 그대로 붙어 있어 계속 동작한다. 한 캔버스당 한 번만 건다(재호출 가드).
function hookDrag(canvas) {
  if (canvas._isoHooked) return;
  canvas._isoHooked = true;
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  let dragging = false, lastX = 0, lastY = 0;
  const start = (x, y) => { dragging = true; lastX = x; lastY = y; canvas.style.cursor = 'grabbing'; };
  const move = (x, y) => {
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY; lastX = x; lastY = y;
    const st = canvas._iso; if (!st) return;
    st.az += dx * 0.008;
    st.el = clamp(st.el - dy * 0.008, -EL_MAX, EL_MAX);
    st.redraw?.();
  };
  const end = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('mousedown', (e) => { start(e.clientX, e.clientY); e.preventDefault(); });
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener('touchmove', (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('dblclick', () => {
    const st = canvas._iso; if (!st) return;
    st.az = DEF_AZ; st.el = DEF_EL; st.redraw?.();
  });
}
