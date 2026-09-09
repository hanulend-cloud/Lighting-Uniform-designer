// 등각투상(입체) 뷰 — 기구물 박스(타겟 footprint를 깊이만큼 압출) + LED 배치를 3D처럼 표시.
// 형상 디테일(난이도별 단면)은 생략하고 박스+LED만 간단히 — 단면도/평면도의 보조 확인용.

import { fitCanvas, PAD } from './canvas-util.js';

const C = {
  bg: '#0f1420', edge: '#5b6b86', edgeTop: '#7cb0ff', top: 'rgba(96,165,250,0.16)',
  side: 'rgba(96,165,250,0.06)', led: '#ffcf3f', text: '#d7deea', dim: '#95a0b3',
};

const ANG = Math.PI / 6; // 30°
const CA = Math.cos(ANG), SA = Math.sin(ANG);
function proj(x, y, z) {
  return { sx: (x - y) * CA, sy: (x + y) * SA - z };
}

export function drawIso(canvas, g) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

  const X = g.target.x, Y = g.target.y, Z = g.depth;
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

  // 측면(오른쪽·앞쪽) 살짝 음영 → 입체감
  poly([c.bX0, c.bXY, c.tXY, c.tX0], C.side);
  poly([c.b0Y, c.bXY, c.tXY, c.t0Y], C.side);
  // 윗면(관찰면) 반투명
  poly([c.t00, c.tX0, c.tXY, c.t0Y], C.top);

  // 모서리
  [[c.b00, c.bX0], [c.bX0, c.bXY], [c.bXY, c.b0Y], [c.b0Y, c.b00]].forEach(([a, b]) => seg(a, b, C.edge, 1.5));
  [[c.b00, c.t00], [c.bX0, c.tX0], [c.bXY, c.tXY], [c.b0Y, c.t0Y]].forEach(([a, b]) => seg(a, b, C.edge, 1.5));
  [[c.t00, c.tX0], [c.tX0, c.tXY], [c.tXY, c.t0Y], [c.t0Y, c.t00]].forEach(([a, b]) => seg(a, b, C.edgeTop, 1.5));

  // LED 점
  ctx.fillStyle = C.led;
  for (const lp of ledPts) { const p = P(lp); ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }

  ctx.fillStyle = C.text; ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`입체뷰 · 최종 적용: ${g.levelText}`, PAD.L, 15);
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  ctx.fillText(`LED ${g.leds.length}개 · ${X}×${Y}×${Z.toFixed(0)}mm`, PAD.L, h - 7);
}
