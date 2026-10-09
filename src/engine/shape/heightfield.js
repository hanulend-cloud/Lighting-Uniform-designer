// 메시 → 2.5D 높이맵 — 형상 몸체 spec 2026-10-10 §3.1 (G0).
// 격자 셀 중심의 수직선과 메시 삼각형의 교차를 모아 윗면 z_t(최대)·바닥 z_b(최소)를 만든다.
// 교차가 2개를 넘는 셀 = 비 2.5D(언더컷·터널·훅) → 비율 보고, 최외곽 두 교차로 근사.
// 좌표: 높이맵은 몸체 외곽(bbox) 중심이 원점, 윗면 최고점 z = 0(아래로 음수). 툴 좌표 배치는 placeHeightfield.

// 방향 보정: flipZ = X축 180° 회전(y→−y, z→−z, 손잡이 유지), rot = XY 90° 회전 횟수
export function orientPositions(pos, { flipZ = false, rot = 0 } = {}) {
  const out = new Float32Array(pos.length), r = ((rot % 4) + 4) % 4;
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (flipZ) { y = -y; z = -z; }
    for (let k = 0; k < r; k++) { const t = x; x = -y; y = t; }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

export function meshToHeightfield({ positions, triangles }, { cell = 0.2, maxCells = 1.5e6, flipZ = false, rot = 0 } = {}) {
  const p = orientPositions(positions, { flipZ, rot });
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < xmin) xmin = p[i]; if (p[i] > xmax) xmax = p[i];
    if (p[i + 1] < ymin) ymin = p[i + 1]; if (p[i + 1] > ymax) ymax = p[i + 1];
    if (p[i + 2] > zmax) zmax = p[i + 2];
  }
  const W = xmax - xmin, H = ymax - ymin;
  const c = Math.max(cell, Math.sqrt((W * H) / maxCells));
  const nx = Math.max(2, Math.ceil(W / c)), ny = Math.max(2, Math.ceil(H / c));
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  const x0 = -nx * c / 2, y0 = -ny * c / 2;                 // 셀 경계 원점(중심 정렬)
  const N = nx * ny, zt = new Float32Array(N).fill(-Infinity), zb = new Float32Array(N).fill(Infinity), cnt = new Uint8Array(N);
  // 셀별 교차를 모두 보관하지 않고 최대·최소·개수만 — 2.5D 판정과 근사에 충분
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, d = triangles[t + 2] * 3;
    const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - zmax;
    const bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - zmax;
    const dx = p[d] - cx, dy = p[d + 1] - cy, dz = p[d + 2] - zmax;
    const area2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);   // XY 투영 부호 면적×2
    if (Math.abs(area2) < 1e-12) continue;                          // 수직 면(측벽) — 수직선과 평행
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, dx) - x0) / c - 0.5)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, dx) - x0) / c - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, dy) - y0) / c - 0.5)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, dy) - y0) / c - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * c;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * c;
        // 무게중심 좌표 + top-left 규칙(공유 모서리 이중 계산 방지)
        let w0 = (bx - px) * (dy - py) - (by - py) * (dx - px);
        let w1 = (dx - px) * (ay - py) - (dy - py) * (ax - px);
        let w2 = (ax - px) * (by - py) - (ay - py) * (bx - px);
        if (area2 < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if ((w0 === 0 && !edgeOwns(bx, by, dx, dy, area2)) || (w1 === 0 && !edgeOwns(dx, dy, ax, ay, area2)) || (w2 === 0 && !edgeOwns(ax, ay, bx, by, area2))) continue;
        const s = Math.abs(area2), z = (w0 * az + w1 * bz + w2 * dz) / s, k = j * nx + i;
        if (z > zt[k]) zt[k] = z;
        if (z < zb[k]) zb[k] = z;
        if (cnt[k] < 255) cnt[k]++;
      }
    }
  }
  let inside = 0, non25 = 0, odd = 0, tmin = Infinity, tmax = -Infinity, zbMin = Infinity;
  const mask = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (cnt[k] >= 2) {
      mask[k] = 1; inside++;
      if (cnt[k] > 2) non25++;
      if (cnt[k] % 2) odd++;
      const th = zt[k] - zb[k];
      if (th < tmin) tmin = th; if (th > tmax) tmax = th;
      if (zb[k] < zbMin) zbMin = zb[k];
    } else { zt[k] = NaN; zb[k] = NaN; if (cnt[k] === 1) odd++; }
  }
  return {
    nx, ny, cell: c, x0, y0, zt, zb, cnt, mask,
    size: { x: W, y: H, z: -zbMin },
    stats: { area: inside * c * c, non25DFrac: inside ? non25 / inside : 0, oddFrac: (inside + odd) ? odd / (inside + odd) : 0, thkMin: tmin, thkMax: tmax },
  };
}

// top-left 규칙: 모서리 위의 점은 "윗변 또는 왼쪽 변" 일 때만 그 삼각형에 속함(감김 방향 보정)
function edgeOwns(x1, y1, x2, y2, area2) {
  let ex = x2 - x1, ey = y2 - y1;
  if (area2 < 0) { ex = -ex; ey = -ey; }
  return (ey === 0 && ex < 0) || ey > 0;
}

// 이중선형 표본: 셀 중심 격자. 밖이면 null
export function sampleHeightfield(hf, x, y) {
  const fx = (x - hf.x0) / hf.cell - 0.5, fy = (y - hf.y0) / hf.cell - 0.5;
  const i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0;
  let zt = 0, zb = 0, w = 0;
  for (const [i, j, ww] of [[i0, j0, (1 - u) * (1 - v)], [i0 + 1, j0, u * (1 - v)], [i0, j0 + 1, (1 - u) * v], [i0 + 1, j0 + 1, u * v]]) {
    if (i < 0 || j < 0 || i >= hf.nx || j >= hf.ny) continue;
    const k = j * hf.nx + i;
    if (!hf.mask[k] || ww <= 0) continue;
    zt += ww * hf.zt[k]; zb += ww * hf.zb[k]; w += ww;
  }
  return w > 0.5 ? { zt: zt / w, zb: zb / w } : null;
}
