// 단면도 (hero) — 프로젝트.md §3 출력3 Side view
// LED 배치 + 지향각(점선) + 기구물 형상(난이도별) + 관찰면(+0.1mm).
// X축은 히트맵과 동일 매핑(PAD.L~w-PAD.R)으로 세로 정렬.

import { fitCanvas, PAD } from './canvas-util.js';

const C = {
  bg: '#0f1420', grid: '#20293c', wall: '#5b6b86', pcb: '#42506a',
  led: '#ffcf3f', beam: 'rgba(255,207,63,0.5)',
  body: 'rgba(96,165,250,0.30)', bodyEdge: '#7cb0ff',
  obs: '#5ee0b0', text: '#d7deea', dim: '#95a0b3',
};
const DEG = Math.PI / 180;

export function drawSection(canvas, g, pxmm) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

  const X = g.target.x;
  const vx0 = g.view ? g.view.x0 : 0;
  const zMax = Math.max(g.depth * 1.2, g.depth + 3);
  const plotH = h - PAD.T - PAD.B;
  const px = (x) => PAD.L + (x - vx0) * pxmm;      // X: 공유 스케일 (뷰 원점 기준, 히트맵과 동일)
  const pz = (z) => PAD.T + plotH - (z / zMax) * plotH;  // Z: 패널 높이에 맞춘 별도 스케일
  const xEnd = px(X);
  const zExag = ((plotH / zMax) / pxmm);           // Z 스케일 / X 스케일 배율

  // Z 눈금자 (mm)
  ctx.strokeStyle = C.grid; ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  ctx.textAlign = 'right'; ctx.lineWidth = 1;
  const zStep = niceStep(zMax, 5);
  for (let z = 0; z <= zMax + 0.001; z += zStep) {
    const y = pz(z);
    ctx.beginPath(); ctx.moveTo(PAD.L, y); ctx.lineTo(xEnd, y); ctx.stroke();
    ctx.fillText(z.toFixed(0), PAD.L - 4, y + 3);
  }

  // 기구 측벽
  ctx.strokeStyle = C.wall; ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(px(0), pz(g.depth)); ctx.lineTo(px(0), pz(0));
  ctx.lineTo(px(X), pz(0)); ctx.lineTo(px(X), pz(g.depth));
  ctx.stroke();

  // 지향각 (FWHM) 점선 콘 — 대표 LED 최대 6개
  const uxs = [...new Set(g.leds.map((l) => l.x))].sort((a, b) => a - b);
  const pick = pickN(uxs, 6);
  const spread = Math.tan((g.beamX / 2) * DEG) * (g.depth - g.ledSize.z);
  ctx.strokeStyle = C.beam; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  for (const x of pick) {
    ctx.beginPath();
    ctx.moveTo(px(x), pz(g.ledSize.z)); ctx.lineTo(px(x - spread), pz(g.depth));
    ctx.moveTo(px(x), pz(g.ledSize.z)); ctx.lineTo(px(x + spread), pz(g.depth));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // PCB + LED 칩
  ctx.strokeStyle = C.pcb; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px(0), pz(0)); ctx.lineTo(px(X), pz(0)); ctx.stroke();
  ctx.fillStyle = C.led;
  const lw = Math.max(3, g.ledSize.x * pxmm);
  for (const x of uxs) ctx.fillRect(px(x) - lw / 2, pz(g.ledSize.z) - 2, lw, Math.max(3, (g.ledSize.z / zMax) * plotH + 2));

  // 기구물 단면
  const prof = g.bodyProfile(160);
  ctx.beginPath();
  prof.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.botZ)) : ctx.moveTo(px(p.x), pz(p.botZ))));
  for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(px(prof[i].x), pz(prof[i].topZ));
  ctx.closePath();
  ctx.fillStyle = C.body; ctx.fill();
  ctx.strokeStyle = C.bodyEdge; ctx.lineWidth = 1.5; ctx.stroke();

  if (g.diffuseVisual) { ctx.save(); ctx.clip(); dots(ctx, PAD.L, PAD.T, xEnd - PAD.L, plotH); ctx.restore(); }

  // L5 미세패턴 — 기구물 하단(LED 대향면) 돌기/딤플 (화면상 과장 표시)
  if (g.patternVisual) {
    const { type, sizeX, angleX, dir, depth: patDepth } = g.patternVisual;
    const isRecess = dir === '오목';
    const botAt = (xmm) => {
      const t = xmm / X * (prof.length - 1);
      const i = Math.max(0, Math.min(prof.length - 2, Math.floor(t)));
      return prof[i].botZ + (prof[i + 1].botZ - prof[i].botZ) * (t - i);
    };
    const scrPitch = 9;                       // 화면상 과장 pitch (돌기가 크기=pitch 로 맞닿음)
    const fw = scrPitch * 0.9;
    // 깊이(mm, 실제값)를 화면 과장 높이로 변환 + 각도로 facet 형태 미세조정, 방향(돌출/오목)으로 부호 반전
    const fhMag = Math.max(3, Math.min(20, (patDepth ?? 0.2) * 40 + (fw / 2) * Math.tan((angleX ?? 40) * DEG) * 0.3));
    const fh = isRecess ? -fhMag : fhMag;
    ctx.strokeStyle = C.bodyEdge; ctx.fillStyle = isRecess ? 'rgba(255,150,120,0.28)' : 'rgba(124,176,255,0.30)'; ctx.lineWidth = 1;
    for (let sx = px(0) + scrPitch / 2; sx < xEnd - scrPitch / 2; sx += scrPitch) {
      const y0 = pz(botAt((sx - PAD.L) / pxmm + vx0));   // 기구물 하면 위치
      ctx.beginPath();
      if (type === 'dome') { ctx.arc(sx, y0, Math.abs(fh) < fw / 2 ? Math.abs(fh) : fw / 2, isRecess ? Math.PI : 0, isRecess ? 0 : Math.PI, isRecess); }
      else if (type === 'prism') { ctx.moveTo(sx - fw / 2, y0); ctx.lineTo(sx + fw / 2, y0 + fh); ctx.lineTo(sx + fw / 2, y0); }
      else { ctx.moveTo(sx - fw / 2, y0); ctx.lineTo(sx, y0 + fh); ctx.lineTo(sx + fw / 2, y0); } // 피라미드
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = C.dim; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`패턴: ${type} · ${dir ?? '돌출'} · 크기=pitch ${sizeX ?? 0.3}mm · 깊이 ${(patDepth ?? 0.2).toFixed(2)}mm · ${angleX ?? 40}° (하단, 과장 표시)`, PAD.L, h - 22);
  }

  // 관찰면 +0.1mm
  ctx.strokeStyle = C.obs; ctx.lineWidth = 1.5; ctx.setLineDash([7, 4]);
  ctx.beginPath(); ctx.moveTo(px(0), pz(g.obsZ)); ctx.lineTo(px(X), pz(g.obsZ)); ctx.stroke();
  ctx.setLineDash([]);

  // 라벨
  ctx.fillStyle = C.text; ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`단면도 · ${g.levelText}`, PAD.L, 15);
  ctx.fillStyle = C.obs; ctx.font = '12px system-ui'; ctx.textAlign = 'right';
  ctx.fillText(`관찰면 = 상면 +0.1mm`, xEnd, pz(g.obsZ) - 5);
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`깊이 ${g.depth.toFixed(0)}mm · 지향각 ${g.beamX}° · n=${g.n} · Z축 ×${zExag.toFixed(1)} 확대`, PAD.L, h - 7);
}

function pickN(a, n) {
  if (a.length <= n) return a;
  const o = [];
  for (let i = 0; i < n; i++) o.push(a[Math.round((i / (n - 1)) * (a.length - 1))]);
  return [...new Set(o)];
}
function dots(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(94,224,176,0.28)';
  for (let i = x; i < x + w; i += 6) for (let j = y; j < y + h; j += 6) ctx.fillRect(i, j, 1, 1);
}
function niceStep(range, target) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const c = [1, 2, 2.5, 5, 10].find((v) => v * p >= raw) || 10;
  return c * p;
}
