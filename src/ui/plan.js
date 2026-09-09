// 평면 배치도 — 프로젝트.md §3 출력3 Top view.
// 자기 박스에 맞춰 X:Y 실물 비율로 표시. LED 배치 + 기구 형상 변화.

import { fitCanvas, PAD } from './canvas-util.js';

const C = {
  bg: '#0f1420', frame: '#5b6b86', margin: '#7c8aa0',
  led: '#ffcf3f',
  milky: 'rgba(180,220,255,0.10)', text: '#d7deea', dim: '#95a0b3',
};

export function drawPlan(canvas, g) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

  const { x: X, y: Y } = g.target;
  const v = g.view || { x0: 0, x1: X, y0: 0, y1: Y };
  const vw = v.x1 - v.x0, vh = v.y1 - v.y0;
  const availW = w - PAD.L - PAD.R, availH = h - PAD.T - PAD.B;
  const s = Math.min(availW / vw, availH / vh);   // 뷰 전체를 박스에 비율 유지 fit
  const ox0 = PAD.L + Math.max(0, (availW - vw * s) / 2);
  const oy0 = PAD.T + Math.max(0, (availH - vh * s) / 2);
  const px = (x) => ox0 + (x - v.x0) * s;
  const py = (y) => oy0 + (v.y1 - y) * s;
  const pxmm = s;                              // 패드·치수도 동일 스케일
  const bw = X * s, bh = Y * s;

  // L2 Milky 틴트 (전체)
  if (g.diffuseVisual) { ctx.fillStyle = C.milky; ctx.fillRect(px(0), py(Y), bw, bh); }

  // 기구물 외곽(오버행 있으면 타겟보다 큼, 타겟 중심 기준 대칭) — 점선
  if (g.fixture && (g.fixture.x > X + 0.01 || g.fixture.y > Y + 0.01)) {
    const padOvX = (g.fixture.x - X) / 2, padOvY = (g.fixture.y - Y) / 2;
    ctx.strokeStyle = C.frame; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
    ctx.strokeRect(px(-padOvX), py(Y + padOvY), g.fixture.x * s, g.fixture.y * s);
    ctx.setLineDash([]);
  }

  // 하우징(타겟 = 판정 영역)
  ctx.strokeStyle = C.frame; ctx.lineWidth = 2;
  ctx.strokeRect(px(0), py(Y), bw, bh);

  // 유효영역 (edge margin 5%)
  ctx.strokeStyle = C.margin; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.strokeRect(px(X * 0.05), py(Y * 0.95), bw * 0.9, bh * 0.9);
  ctx.setLineDash([]);

  // L4 — 실제 반경별 두께를 동심원 등고선으로 표시. SIDE VIEW(단면도)와 같은 l4Height() 함수를
  // 써서 두 뷰가 같은 형상을 그리도록 함 — 예전엔 여기 flat 패드 사각형만 그려서 SIDE VIEW의
  // 굴곡진(scalloped) 실제 형상과 안 맞아 보이는 문제가 있었음.
  if (g.l4Height && g.l4HalfP > 0) {
    const topZ = g.depth;
    const maxThk = topZ - g.l4Height(0);
    const minThk = topZ - g.l4Height(g.l4HalfP);
    const range = Math.max(0.01, maxThk - minThk);
    const RINGS = 14;
    for (const p of g.leds) {
      for (let k = RINGS; k >= 1; k--) {
        const rMm = (k / RINGS) * g.l4HalfP;
        const thk = topZ - g.l4Height(rMm);
        const t = Math.max(0, Math.min(1, (thk - minThk) / range));   // 0(얇음)~1(LED 바로 위, 두꺼움)
        ctx.fillStyle = `rgba(124,176,255,${(0.05 + 0.32 * t).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), Math.max(0.5, rMm * pxmm), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // L5 — 패턴 표시 (격자 점, 화면상 과장)
  if (g.patternVisual) {
    ctx.fillStyle = 'rgba(94,224,176,0.5)';
    for (let x = px(0) + 5; x < px(X); x += 9) for (let y = py(Y) + 5; y < py(0); y += 9) ctx.fillRect(x, y, 1.5, 1.5);
  }

  // LED
  const lw = Math.max(3, g.ledSize.x * pxmm * 1.6);
  ctx.fillStyle = C.led;
  for (const p of g.leds) ctx.fillRect(px(p.x) - lw / 2, py(p.y) - lw / 2, lw, lw);

  // 피치 치수 (X, Y)
  ctx.strokeStyle = C.dim; ctx.fillStyle = C.dim; ctx.lineWidth = 1; ctx.font = '11px system-ui';
  const xs = [...new Set(g.leds.map((p) => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(g.leds.map((p) => p.y))].sort((a, b) => a - b);
  if (xs.length >= 2) {
    const yy = py(ys[0]) + 13;
    ctx.beginPath(); ctx.moveTo(px(xs[0]), yy); ctx.lineTo(px(xs[1]), yy); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(`X ${(xs[1] - xs[0]).toFixed(0)}`, (px(xs[0]) + px(xs[1])) / 2, yy - 2);
  }
  if (ys.length >= 2) {
    const xx = px(xs[0]) - 13;
    ctx.beginPath(); ctx.moveTo(xx, py(ys[0])); ctx.lineTo(xx, py(ys[1])); ctx.stroke();
    ctx.save(); ctx.translate(xx - 3, (py(ys[0]) + py(ys[1])) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillText(`Y ${(ys[1] - ys[0]).toFixed(0)}`, 0, 0); ctx.restore();
  }

  ctx.fillStyle = C.text; ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`평면 배치 · 최종 적용: ${g.levelText}`, PAD.L, 15);
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  const pad = g.planShape ? ` · flat ${g.planShape.flatX}×${g.planShape.flatY}mm` : '';
  const grid = xs.length && ys.length ? ` (${xs.length}×${ys.length})` : '';
  ctx.fillText(`LED ${g.leds.length}개${grid} · ${g.dim} · ${X}×${Y}mm${pad}`, PAD.L, h - 7);
}
