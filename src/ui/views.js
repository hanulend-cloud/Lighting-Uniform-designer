// 기구 구조 도면 — 프로젝트.md §3 출력3 (2D Top / 2D Side)
// 모든 도면 X:Y(또는 X:Z) 실물 비율 유지. Side view 는 LED 지향각을 점선으로 표시.

import { fitCanvas, isoMap } from './canvas-util.js';

const COL = {
  bg: '#0e1116', frame: '#4a5568', target: '#7c8aa0',
  led: '#ffd23f', beam: 'rgba(255,210,63,0.55)',
  body: 'rgba(90,170,255,0.28)', bodyEdge: '#5aa2ff',
  diffuser: '#8fe3c9', text: '#c9d1d9', dim: '#8b95a3', pcb: '#3d4756',
};
const DEG = Math.PI / 180;

// ---------- TOP VIEW ----------
export function drawTopView(canvas, g) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);

  const { x: X, y: Y } = g.target;
  const pad = 26;
  const { s, ox, oy } = isoMap(w, h, X, Y, pad);       // 실물 X:Y
  const px = (x) => ox + x * s;
  const py = (y) => oy + (Y - y) * s;

  ctx.fillStyle = 'rgba(143,227,201,0.10)';
  ctx.fillRect(px(0), py(Y), X * s, Y * s);
  ctx.strokeStyle = COL.frame; ctx.lineWidth = 2;
  ctx.strokeRect(px(0), py(Y), X * s, Y * s);

  ctx.strokeStyle = COL.target; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  ctx.strokeRect(px(X * 0.05), py(Y * 0.95), X * 0.9 * s, Y * 0.9 * s);
  ctx.setLineDash([]);

  const lw = Math.max(3, g.ledSize.x * s);
  ctx.fillStyle = COL.led;
  for (const p of g.leds) ctx.fillRect(px(p.x) - lw / 2, py(p.y) - lw / 2, lw, lw);

  const row0 = g.leds.filter((p) => p.y === g.leds[0].y).sort((a, b) => a.x - b.x);
  if (row0.length >= 2) {
    const y = py(row0[0].y) + 15;
    ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px(row0[0].x), y); ctx.lineTo(px(row0[1].x), y); ctx.stroke();
    ctx.fillStyle = COL.dim; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`pitch ${g.pitch.toFixed(1)}`, (px(row0[0].x) + px(row0[1].x)) / 2, y - 3);
  }

  ctx.fillStyle = COL.text; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`Top view · ${X}×${Y} mm · ${g.dim} 배열 · LED ${g.leds.length}개`, 8, 15);
}

// ---------- SIDE VIEW ----------
export function drawSideView(canvas, g) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, w, h);

  const X = g.target.x;
  const zTop = Math.max(g.depth, g.baseThk + 4);
  const pad = 30;

  // 등척 우선. 너무 납작하면 Z 만 정수배 확대(라벨 표기)
  const sx = (w - 2 * pad) / X;
  let sz = sx, exag = 1;
  if (sz * zTop < (h - 2 * pad) * 0.42) {
    exag = Math.max(1, Math.round((h - 2 * pad) * 0.72 / (sz * zTop)));
    sz = sx * exag;
  }
  if (sz * zTop > h - 2 * pad) sz = (h - 2 * pad) / zTop;

  const X0 = pad, Zb = h - pad;
  const px = (x) => X0 + x * sx;
  const pz = (z) => Zb - z * sz;

  // 반사판 측벽
  if (g.reflector.on) {
    ctx.strokeStyle = COL.frame; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px(0), pz(g.depth)); ctx.lineTo(px(0), pz(0));
    ctx.lineTo(px(X), pz(0)); ctx.lineTo(px(X), pz(g.depth));
    ctx.stroke();
  }

  // LED 지향각 (FWHM) — 점선 콘. 대표 LED 최대 5개
  const uxAll = [...new Set(g.leds.map((l) => l.x))].sort((a, b) => a - b);
  const pick = pickN(uxAll, 5);
  const half = (g.beamX / 2) * DEG;
  const spread = Math.tan(half) * (g.depth - g.ledSize.z);
  ctx.strokeStyle = COL.beam; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  for (const x of pick) {
    ctx.beginPath();
    ctx.moveTo(px(x), pz(g.ledSize.z)); ctx.lineTo(px(x - spread), pz(g.depth));
    ctx.moveTo(px(x), pz(g.ledSize.z)); ctx.lineTo(px(x + spread), pz(g.depth));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (pick.length) {
    ctx.fillStyle = COL.beam; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${g.beamX}°`, px(pick[pick.length - 1]) + 14, pz(g.ledSize.z) - 6);
  }

  // PCB
  ctx.strokeStyle = COL.pcb; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(px(0), pz(0)); ctx.lineTo(px(X), pz(0)); ctx.stroke();

  // LED 칩
  ctx.fillStyle = COL.led;
  for (const x of uxAll) {
    ctx.fillRect(px(x) - (g.ledSize.x * sx) / 2, pz(g.ledSize.z),
      Math.max(2, g.ledSize.x * sx), g.ledSize.z * sz + 1);
  }

  // 기구 몸체 단면
  const prof = g.bodyProfile(180);
  ctx.beginPath();
  prof.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.bottomZ)) : ctx.moveTo(px(p.x), pz(p.bottomZ))));
  for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(px(prof[i].x), pz(prof[i].topZ));
  ctx.closePath();
  ctx.fillStyle = COL.body; ctx.fill();
  ctx.strokeStyle = COL.bodyEdge; ctx.lineWidth = 1.5; ctx.stroke();

  if (g.level === 4) { ctx.save(); ctx.clip(); hatch(ctx, 0, 0, w, h, 'rgba(143,227,201,0.35)', 7); ctx.restore(); }
  if (g.level >= 5 && g.pattern) {
    ctx.strokeStyle = COL.bodyEdge; ctx.lineWidth = 1;
    const pp = Math.max(2, g.pattern.pitch);
    const topZ = prof[prof.length >> 1].topZ;
    for (let x = 0; x < X; x += pp) {
      ctx.beginPath();
      ctx.moveTo(px(x), pz(topZ));
      ctx.lineTo(px(x + pp / 2), pz(topZ + g.pattern.depth * 6));
      ctx.lineTo(px(x + pp), pz(topZ));
      ctx.stroke();
    }
  }

  // 확산판 + 관찰(출광)면
  ctx.strokeStyle = COL.diffuser; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(px(0), pz(g.depth)); ctx.lineTo(px(X), pz(g.depth)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COL.text; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`확산판 ×${g.diffuser.count} · 관찰면 = 출광면 바로 위`, px(0) + 4, pz(g.depth) - 4);

  dimArrow(ctx, px(X) + 12, pz(0), px(X) + 12, pz(g.depth), `깊이 ${g.depth.toFixed(0)} mm`);

  ctx.fillStyle = COL.text; ctx.font = '12px system-ui';
  ctx.fillText(`Side view · ${g.levelText}${exag > 1 ? `  (Z ×${exag} 확대)` : '  (등척)'}`, 8, 15);
}

// ---------- helpers ----------
function pickN(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i / (n - 1)) * (arr.length - 1))]);
  return [...new Set(out)];
}
function hatch(ctx, x, y, wd, ht, color, step) {
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  for (let i = -ht; i < wd + ht; i += step) {
    ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + ht, y + ht); ctx.stroke();
  }
}
function dimArrow(ctx, x1, y1, x2, y2, label) {
  ctx.strokeStyle = COL.dim; ctx.fillStyle = COL.dim; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  for (const [x, y, d] of [[x1, y1, 1], [x2, y2, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 5 * d); ctx.lineTo(x + 3, y + 5 * d); ctx.fill();
  }
  ctx.save(); ctx.translate((x1 + x2) / 2 + 4, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(label, 0, 0); ctx.restore();
}
