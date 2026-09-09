// 조도 히트맵 @ 관찰면(+0.1mm) — 프로젝트.md §3 출력5
// X·Y 동일 스케일로 패널에 꽉 차게 맞춰 그려 타겟의 실제 가로:세로 비율을 그대로 보여준다
// (넘치는 방향 없이 레터박스로 중앙 정렬 — 왜곡·잘림 없음).
// 필드는 타겟 [0,X]×[0,Y] 만 담고, 뷰 안의 해당 위치에 배치. 점선=균일도 계산영역.

import { fitCanvas, PAD } from './canvas-util.js';

export function drawHeatmap(canvas, res, pxmm) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, w, h);

  const { field, nx, ny } = res;
  const ex = res.extent;                         // 필드 범위 (보통 [0,X]×[0,Y])
  const view = res.view || { x0: ex.x0, x1: ex.x1, y0: ex.y0, y1: ex.y1 };
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;

  // X·Y 동일 스케일 — 패널 안에 다 들어오도록 축소만 하고(pxmm 초과 확대는 안 함), 레터박스 중앙 정렬
  const availW = w - PAD.L - PAD.R, availH = h - PAD.T - PAD.B;
  const s = Math.min(pxmm, availW / vw, availH / vh);
  const ox0 = PAD.L + Math.max(0, (availW - vw * s) / 2);
  const oy = PAD.T + Math.max(0, (availH - vh * s) / 2);
  const sx = (x) => ox0 + (x - view.x0) * s;
  const sy = (y) => oy + (view.y1 - y) * s;      // world y-up → screen y-down

  // 마진(res.edgeMargin, 계산영역 점선·어둡게 표시용) — 색 스케일 기준(max)은 마진과 무관하게
  // 화면에 보이는 전체 필드에서 구한다(마진 안으로만 잡으면 마진 밖 값이 더 밝을 때 화면에
  // 1.0(포화)을 넘는 색이 나올 수 있음).
  const eg = Math.min(0.3, Math.max(0, res.edgeMargin ?? 0.05));

  // 색 스케일 = v / max(필드 전체) — "최댓값 대비 상대 밝기". 예전엔 (v-min)/(max-min) 으로
  // min~max 구간을 컬러맵 전체(0~1)에 늘려 그렸는데, 이러면 균일도 93%(min이 max의 93%)처럼
  // 실제로는 밝기 차이가 7%뿐인 장면도 컬러맵 양끝(진한 파랑~새빨강, 심지어 거의 검정)을 전부
  // 훑어버려 마치 LED 사이가 새까맣게 꺼진 것처럼 보이는 문제가 실측(균일도 93% 장면)으로
  // 확인됨. v/max 기준으로 바꾸면 균일도가 실제 표시된 %(=min/max) 만큼만 컬러맵 아래쪽을 쓰게
  // 되어, 목표(80%+) 를 넘는 장면일수록 화면도 실제로 더 균일하게(색 변화가 좁게) 보인다.
  let max = -Infinity;
  for (let k = 0; k < field.length; k++) if (field[k] > max) max = field[k];
  if (max <= 0) max = 1;

  // 필드 이미지 (row 0 = world y0 = 아래 → tmp 에서 위아래 뒤집어 저장)
  const img = ctx.createImageData(nx, Math.max(1, ny));
  for (let j = 0; j < ny; j++) {
    const jj = ny - 1 - j;
    for (let i = 0; i < nx; i++) {
      const [r, gg, b] = turbo(field[j * nx + i] / max);
      const p = (jj * nx + i) * 4;
      img.data[p] = r; img.data[p + 1] = gg; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = nx; tmp.height = Math.max(1, ny);
  tmp.getContext('2d').putImageData(img, 0, 0);

  const ox = sx(ex.x0), imgW = (ex.x1 - ex.x0) * s;
  const iy = sy(ex.y1), imgH = (ex.y1 - ex.y0) * s;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, ox, iy, imgW, imgH);

  // 계산영역 밖(가장자리 마진) 살짝 어둡게 — 마진 0이면(예: L3 보강 활성) 전체가 계산영역이므로 생략
  const mx = imgW * eg, my = imgH * eg;
  if (eg > 0) {
    ctx.fillStyle = 'rgba(12,16,26,0.42)';
    ctx.fillRect(ox, iy, imgW, my);
    ctx.fillRect(ox, iy + imgH - my, imgW, my);
    ctx.fillRect(ox, iy + my, mx, imgH - 2 * my);
    ctx.fillRect(ox + imgW - mx, iy + my, mx, imgH - 2 * my);
  }

  // 기구 외곽(오버행으로 타겟보다 큰 경우) — 점선. 오버행이 있으면 LED가 빨간 타겟 경계 밖에
  // 찍혀 보이는 게 정상인데, 이 표시가 없으면 "타겟 범위와 안 맞는다"는 오해를 살 수 있어 추가.
  if (res.fixture && (res.fixture.x > ex.x1 - ex.x0 + 0.01 || res.fixture.y > ex.y1 - ex.y0 + 0.01)) {
    const padOvX = (res.fixture.x - (ex.x1 - ex.x0)) / 2 * s;
    const padOvY = (res.fixture.y - (ex.y1 - ex.y0)) / 2 * s;
    ctx.strokeStyle = 'rgba(124,138,160,0.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
    ctx.strokeRect(ox - padOvX, iy - padOvY, imgW + 2 * padOvX, imgH + 2 * padOvY);
    ctx.setLineDash([]);
  }

  // 목표 타겟 Size 경계 — 굵은 빨강으로 명확히 표시 (필드 범위 자체가 타겟 [0,X]×[0,Y]).
  ctx.strokeStyle = '#e11d2e'; ctx.lineWidth = 3; ctx.strokeRect(ox, iy, imgW, imgH);
  // 계산영역(마진 제외 판정 영역) 점선 — 실제 판정 마진과 동일. 마진 0(예: L3 보강 활성)이면
  // 타겟 경계와 완전히 겹치므로 굳이 겹쳐 그리지 않는다.
  if (eg > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.strokeRect(ox + mx, iy + my, imgW - 2 * mx, imgH - 2 * my);
    ctx.setLineDash([]);
  }

  // LED 위치 점 — LED가 많으면(피치가 좁아 점이 빽빽해지면) 불투명한 점들이 촘촘히 겹쳐
  // 그 아래의 매끄러운 색 그라디언트를 가려 마치 얼룩덜룩 불균일한 것처럼 보이는 착시가
  // 생긴다(실측 확인: 필드 자체는 완전히 매끄럽고 좌우 대칭인데, 점을 끄면 그 사실이 바로
  // 보임). 점 사이 화면 간격이 너무 좁아지면(약 4px 이하) 점을 생략하고 개수만 범례에 남긴다.
  const LED_DOT_MIN_SPACING_PX = 12;
  let minLedSpacingPx = Infinity;
  for (let k = 1; k < (res.leds?.length ?? 0); k++) {
    const d = Math.hypot(sx(res.leds[k].x) - sx(res.leds[k - 1].x), sy(res.leds[k].y) - sy(res.leds[k - 1].y));
    if (d > 0.01 && d < minLedSpacingPx) minLedSpacingPx = d;
  }
  const showLedDots = res.leds?.length && minLedSpacingPx >= LED_DOT_MIN_SPACING_PX;
  if (showLedDots) {
    ctx.fillStyle = 'rgba(255,207,63,0.85)';
    for (const p of res.leds) {
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 1.6, 0, 7); ctx.fill();
    }
  }

  const m = res.metrics || {};
  const ledCount = res.leds?.length ?? 0;
  ctx.fillStyle = '#9aa6bf'; ctx.font = '12px system-ui'; ctx.textAlign = 'right';
  const fixtureNote = res.fixture && (res.fixture.x > ex.x1 - ex.x0 + 0.01 || res.fixture.y > ex.y1 - ex.y0 + 0.01)
    ? ' · 회색점선=기구(오버행)' : '';
  const ledNote = showLedDots ? ' · ●=LED' : ' · LED점 생략(너무 촘촘함)';
  ctx.fillText(`균일도 ${(m.U0 * 100 || 0).toFixed(0)}% · LED ${ledCount}개 · 빨강=타겟 Size · 흰점선=계산영역${fixtureNote}${ledNote}`, w - PAD.R, PAD.T - 6);
}

function turbo(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = 34.61 + t * (1172.33 + t * (-10793.56 + t * (33300.12 + t * (-38394.49 + t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 + t * (-3574.96 + t * (2996.93 - t * 900.79))));
  const b = 27.2 + t * (3211.1 + t * (-15327.97 + t * (27814 + t * (-22569.18 + t * 6838.66))));
  return [cl(r), cl(g), cl(b)];
}
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
