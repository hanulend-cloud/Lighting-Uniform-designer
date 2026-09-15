// 조도 히트맵 @ 관찰면(+0.1mm) — 프로젝트.md §3 출력5
// X·Y 동일 스케일로 패널에 꽉 차게 맞춰 그려 타겟의 실제 가로:세로 비율을 그대로 보여준다
// (넘치는 방향 없이 레터박스로 중앙 정렬 — 왜곡·잘림 없음).
// 필드는 타겟 [0,X]×[0,Y] 만 담고, 뷰 안의 해당 위치에 배치. 점선=균일도 계산영역.

import { fitCanvas, PAD } from './canvas-util.js';
import { LUX_PER_FIELD_UNIT, illuminanceToLuminance } from '../engine/photometry.js';

// field 값(내부 표현) → 선택한 단위의 숫자 문자열. 상대 모드(fluxLm<=0)거나 unit='rel'이면
// null(호출측이 기존처럼 %로 표시). 색 패턴 자체는 이 선택과 무관하게 항상 값/최댓값이다 —
// 단위 변환은 모든 픽셀에 같은 상수를 곱할 뿐이라 비율(그림)은 절대 바뀌지 않는다.
function absLabel(fieldValue, unit, fluxLm) {
  if (unit === 'rel' || !fluxLm || fluxLm <= 0) return null;
  const lux = fieldValue * LUX_PER_FIELD_UNIT;
  const v = unit === 'lux' ? lux : illuminanceToLuminance(lux);
  return `${v.toFixed(v < 10 ? 2 : 0)} ${unit === 'lux' ? 'lux' : 'cd/m²'}`;
}

export function drawHeatmap(canvas, res, pxmm, opt = {}) {
  const unit = opt.unit === 'lux' || opt.unit === 'cdm2' ? opt.unit : 'rel';
  const fluxLm = opt.fluxLm ?? 0;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.fillStyle = '#0f1420'; ctx.fillRect(0, 0, w, h);

  const { field, nx, ny } = res;
  const ex = res.extent;                         // 필드 범위 (보통 [0,X]×[0,Y])
  const view = res.view || { x0: ex.x0, x1: ex.x1, y0: ex.y0, y1: ex.y1 };
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  const eg = Math.min(0.3, Math.max(0, res.edgeMargin ?? 0));
  const hasOverhang = !!res.fixture && (res.fixture.x > ex.x1 - ex.x0 + 0.01 || res.fixture.y > ex.y1 - ex.y0 + 0.01);

  // X·Y 동일 스케일 — 패널 안에 다 들어오도록 축소만 하고(pxmm 초과 확대는 안 함), 레터박스 중앙 정렬.
  // 아래쪽엔 치수선 + 한 줄에 한 사실만(좁은 3분할 패널에서도 안 겹치게) — 실제로 그릴 줄 수만큼만 예약.
  const botLines = 3 + (hasOverhang ? 1 : 0) + (eg > 0 ? 1 : 0) + (res.center ? 1 : 0);
  const BOT = 35 + botLines * 14;
  const availW = w - PAD.L - PAD.R, availH = h - PAD.T - BOT;
  const s = Math.min(pxmm, availW / vw, availH / vh);
  const ox0 = PAD.L + Math.max(0, (availW - vw * s) / 2);
  const oy = PAD.T + Math.max(0, (availH - vh * s) / 2);
  const sx = (x) => ox0 + (x - view.x0) * s;
  const sy = (y) => oy + (view.y1 - y) * s;      // world y-up → screen y-down

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

  // 중심부(1차 판정 영역 = 경계에서 od 안쪽) — 청록 점선
  const cz = res.center;
  if (cz && (cz.fx > 0 || cz.fy > 0)) {
    ctx.strokeStyle = 'rgba(56,224,214,0.9)'; ctx.setLineDash([5, 3]); ctx.lineWidth = 1.2;
    ctx.strokeRect(ox + imgW * cz.fx, iy + imgH * cz.fy, imgW * (1 - 2 * cz.fx), imgH * (1 - 2 * cz.fy));
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

  // 최솟값 위치 마커 — 프로파일 그래프(중심을 지나는 단면 2개)는 모서리처럼 그 단면 밖에 있는
  // 진짜 최저점을 못 보여줄 수 있어, 판정 영역(res.center 있으면 그 기준, 없으면 마진) 안에서
  // 실제 최솟값 지점을 찾아 표시한다 — "그래프상 min%"과 "판정 수치"가 다를 때 이유를 바로 보여줌.
  {
    const cfx = res.center ? res.center.fx : eg, cfy = res.center ? res.center.fy : eg;
    const i0 = Math.round(cfx * (nx - 1)), i1 = Math.max(i0 + 1, nx - i0);
    const j0 = ny >= 6 ? Math.round(cfy * (ny - 1)) : 0, j1 = Math.max(j0 + 1, ny - j0);
    let minV = Infinity, mi = i0, mj = j0;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const v = field[j * nx + i];
      if (v < minV) { minV = v; mi = i; mj = j; }
    }
    if (Number.isFinite(minV) && minV < Infinity) {
      const wx = ex.x0 + (ex.x1 - ex.x0) * (nx > 1 ? mi / (nx - 1) : 0.5);
      const wy = ex.y0 + (ex.y1 - ex.y0) * (ny > 1 ? mj / (ny - 1) : 0.5);
      const mxp = sx(wx), myp = sy(wy);
      const drawMark = (lw, color) => {
        ctx.lineWidth = lw; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.arc(mxp, myp, 6, 0, 7); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mxp - 10, myp); ctx.lineTo(mxp - 3, myp);
        ctx.moveTo(mxp + 3, myp); ctx.lineTo(mxp + 10, myp);
        ctx.moveTo(mxp, myp - 10); ctx.lineTo(mxp, myp - 3);
        ctx.moveTo(mxp, myp + 3); ctx.lineTo(mxp, myp + 10);
        ctx.stroke();
      };
      drawMark(3.2, 'rgba(0,0,0,0.65)');   // 어떤 배경색 위에서도 보이도록 검은 테두리 먼저
      drawMark(1.4, '#ffffff');
      const abs = absLabel(minV, unit, fluxLm);
      const label = `최소 ${(minV / max * 100).toFixed(0)}%${abs ? ` (${abs})` : ''} @ (${wx.toFixed(0)}, ${wy.toFixed(0)})`;
      ctx.font = 'bold 11px system-ui';
      const tw = ctx.measureText(label).width;
      const lx = Math.min(Math.max(mxp - tw / 2 - 4, ox + 2), ox + imgW - tw - 8);
      const ly = myp > iy + imgH / 2 ? myp - 15 : myp + 15;
      ctx.fillStyle = 'rgba(15,20,32,0.85)';
      ctx.fillRect(lx - 2, ly - 11, tw + 8, 15);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
      ctx.fillText(label, lx + 2, ly + 1);
    }
  }

  const m = res.metrics || {};
  const ledCount = res.leds?.length ?? 0;
  // 패널이 좁아도(3분할 배치) 겹치지 않도록: 색·기호 범례처럼 매번 안 변하는 설명은 캔버스
  // title 툴팁(호버 시 표시)으로 옮기고, 화면에는 바뀌는 핵심 수치만 짧게 그린다.
  const uniText = res.center
    ? `중심부 균일도 ${(res.center.U0c * 100 || 0).toFixed(0)}% · 전체 ${(m.U0 * 100 || 0).toFixed(0)}%`
    : `균일도 ${(m.U0 * 100 || 0).toFixed(0)}%`;
  const maxAbs = absLabel(max, unit, fluxLm);
  ctx.fillStyle = '#9aa6bf'; ctx.font = '12px system-ui'; ctx.textAlign = 'right';
  ctx.fillText(`${uniText} · LED ${ledCount}개${maxAbs ? ` · 최대 ${maxAbs}` : ''}`, w - PAD.R, PAD.T - 6);
  canvas.title = [
    '빨강=타겟', res.center ? '청록점선=중심부(판정)' : null, eg > 0 ? '흰점선=계산영역' : null,
    eg > 0 ? '어둡게=판정제외 마진' : null, hasOverhang ? '회색점선=기구(오버행)' : null,
    showLedDots ? '●=LED' : 'LED점 생략(너무 촘촘함)', '⊕=판정영역 최솟값 지점',
    res.cellMm ? `격자 ${(+res.cellMm.toFixed(2))}mm` : null,
    unit !== 'rel' && !(fluxLm > 0) ? 'LED 광속(lm)을 0보다 크게 설정해야 실제 단위가 표시됩니다(현재 상대값)' : null,
  ].filter(Boolean).join(' · ');

  // ── 치수 표기 (mm) ─────────────────────────────────────────────────────────────
  // 타겟·계산영역·기구의 실제 크기를 숫자로 명시. 마진은 축별 "비율"(edgeMargin)이라 가로가 긴
  // 타겟에서는 X 마진(mm)이 Y 마진보다 훨씬 커서 좌우 어두운 띠가 넓게 보이는데, 그 사실을
  // 수치로 드러내 "가장자리가 불균일하다"는 오해를 막는다(어두운 띠는 실제 조도가 아니라 오버레이).
  const fmt = (v) => String(+v.toFixed(1));
  const tX = ex.x1 - ex.x0, tY = ex.y1 - ex.y0;
  const mXmm = tX * eg, mYmm = tY * eg;
  const cX = tX - 2 * mXmm, cY = tY - 2 * mYmm;
  const fx = res.fixture?.x ?? tX, fy = res.fixture?.y ?? tY;
  const ovX = Math.max(0, (fx - tX) / 2), ovY = Math.max(0, (fy - tY) / 2);

  // 외곽(기구 점선 포함) 기준 좌표
  const padOvXpx = hasOverhang ? ovX * s : 0, padOvYpx = hasOverhang ? ovY * s : 0;
  const left = ox - padOvXpx, bottom = iy + imgH + padOvYpx;

  // 타겟 가로 치수선 (아래) — 빨간 타겟 경계와 같은 폭
  const dimY = bottom + 9;
  ctx.strokeStyle = '#e11d2e'; ctx.fillStyle = '#e11d2e'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox, dimY); ctx.lineTo(ox + imgW, dimY);
  ctx.moveTo(ox, dimY - 4); ctx.lineTo(ox, dimY + 4);
  ctx.moveTo(ox + imgW, dimY - 4); ctx.lineTo(ox + imgW, dimY + 4);
  ctx.stroke();
  ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${fmt(tX)} mm`, ox + imgW / 2, dimY + 12);

  // 타겟 세로 치수선 (왼쪽)
  const dimX = left - 8;
  ctx.beginPath();
  ctx.moveTo(dimX, iy); ctx.lineTo(dimX, iy + imgH);
  ctx.moveTo(dimX - 4, iy); ctx.lineTo(dimX + 4, iy);
  ctx.moveTo(dimX - 4, iy + imgH); ctx.lineTo(dimX + 4, iy + imgH);
  ctx.stroke();
  ctx.save();
  ctx.translate(dimX - 4, iy + imgH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillText(`${fmt(tY)} mm`, 0, 0);
  ctx.restore();

  // (기구 크기는 아래 치수 목록에 이미 표기 — 상단 범례와 겹치던 별도 라벨은 제거)

  // 치수 텍스트 — 한 줄에 사실 하나씩(좁은 3분할 패널에서도 안 겹치게). 줄 수는 위 botLines와 일치.
  ctx.textAlign = 'left'; ctx.font = '11px system-ui';
  let ty = dimY + 26;
  ctx.fillStyle = '#e11d2e'; ctx.fillText(`타겟 ${fmt(tX)}×${fmt(tY)}mm`, PAD.L, ty); ty += 14;
  ctx.fillStyle = '#9aa6bf'; ctx.fillText(`기구 ${fmt(fx)}×${fmt(fy)}mm`, PAD.L, ty); ty += 14;
  if (hasOverhang) {
    ctx.fillText(`오버행 X ${fmt(ovX)} / Y ${fmt(ovY)}mm`, PAD.L, ty); ty += 14;
  }
  ctx.fillStyle = '#e8edf7'; ctx.fillText(`계산영역 ${fmt(cX)}×${fmt(cY)}mm`, PAD.L, ty); ty += 14;
  if (eg > 0) {
    ctx.fillStyle = '#9aa6bf';
    ctx.fillText(`판정제외 마진 ${(eg * 100).toFixed(0)}% = X ${fmt(mXmm)} / Y ${fmt(mYmm)}mm`, PAD.L, ty); ty += 14;
  }
  if (res.center) {
    const c = res.center;
    const cw = tX * (1 - 2 * c.fx), ch = tY * (1 - 2 * c.fy);
    ctx.fillStyle = 'rgba(56,224,214,0.95)';
    const flag = `${c.centerBright ? '' : ' ⚠테두리>중심'}${c.fullPass ? '' : ' ⚠전체미달'}`;
    ctx.fillText(`중심부(${((c.areaFrac ?? 0.95) * 100).toFixed(0)}%) ${fmt(cw)}×${fmt(ch)}mm · ${(c.U0c * 100).toFixed(1)}%${flag}`, PAD.L, ty);
    canvas.title += ` · 중심부 인셋 = 경계에서 X ${fmt(tX * c.fx)} / Y ${fmt(tY * c.fy)}mm 안쪽`;
  }
}

function turbo(t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const r = 34.61 + t * (1172.33 + t * (-10793.56 + t * (33300.12 + t * (-38394.49 + t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 + t * (-3574.96 + t * (2996.93 - t * 900.79))));
  const b = 27.2 + t * (3211.1 + t * (-15327.97 + t * (27814 + t * (-22569.18 + t * 6838.66))));
  return [cl(r), cl(g), cl(b)];
}
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
