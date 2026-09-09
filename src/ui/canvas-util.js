// 캔버스 유틸 — 백킹스토어를 표시 크기(DPR)에 맞춰 조정. 이후 좌표는 CSS 픽셀 기준.

// 단면도·히트맵이 공유하는 좌우 여백(px) → 세로 X축 정렬용
export const PAD = { L: 44, R: 14, T: 22, B: 24 };

export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width || canvas.width || 320));
  const h = Math.max(1, Math.round(r.height || canvas.height || 180));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// world(mm) → screen 등척 매핑 (X, Y 동일 px/mm, 중앙 정렬)
export function isoMap(w, h, worldW, worldH, padL, padR, padT, padB) {
  const s = Math.min((w - padL - padR) / worldW, (h - padT - padB) / worldH);
  return { s, ox: padL + ((w - padL - padR) - worldW * s) / 2, oy: padT + ((h - padT - padB) - worldH * s) / 2 };
}
