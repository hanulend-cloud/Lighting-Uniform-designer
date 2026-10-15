// 관측면 → 라인 인식 — spec 2026-10-14 §5 (V3D-5). 순수 JS(메인·Worker 공용). 결과는 data(직렬화 가능) + 함수.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

export function viewFrame(d) {
  const n = unit(d), r = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit([r[0] - dot(r, n) * n[0], r[1] - dot(r, n) * n[1], r[2] - dot(r, n) * n[2]]);
  return { u, v: cross(n, u), d: n };
}

// 선택 면들의 면적 가중 평균 바깥 법선
export function obsDirection(parts, faces) {
  const n = [0, 0, 0], want = new Set(faces.map((f) => `${f.part}|${f.face}`));
  parts.forEach((m, pi) => {
    const P = m.positions, T = m.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      if (!want.has(`${pi}|${m.faceIds[t]}`)) continue;
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const c3 = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      n[0] += c3[0]; n[1] += c3[1]; n[2] += c3[2];
    }
  });
  return unit(n);
}

function project(parts, faces, F) {
  const want = new Set(faces.map((f) => `${f.part}|${f.face}`)), tris = [];
  let hMin = Infinity;
  parts.forEach((m, pi) => {
    const P = m.positions, T = m.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      if (!want.has(`${pi}|${m.faceIds[t]}`)) continue;
      for (let j = 0; j < 3; j++) {
        const v = T[t * 3 + j] * 3, p = [P[v], P[v + 1], P[v + 2]];
        tris.push(dot(p, F.u), dot(p, F.v)); hMin = Math.min(hMin, dot(p, F.d));
      }
    }
  });
  return { tris: Float64Array.from(tris), hMin };
}

function rasterize(tris) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < tris.length; i += 2) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]); }
  const cell = Math.max(0.05, Math.max(x1 - x0, y1 - y0) / 2000);
  const bounds = [x0, y0, x1, y1];
  x0 -= 3 * cell; y0 -= 3 * cell;
  const nx = Math.ceil((x1 - x0) / cell) + 4, ny = Math.ceil((y1 - y0) / cell) + 4, mask = new Uint8Array(nx * ny);
  for (let t = 0; t < tris.length; t += 6) {
    const ax = tris[t], ay = tris[t + 1], bx = tris[t + 2], by = tris[t + 3], cx = tris[t + 4], cy = tris[t + 5];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) mask[j * nx + i] = 1;
    }
  }
  return { x0, y0, cell, nx, ny, mask, bounds };
}

// 경계(밖 셀)까지 정확한 유클리드 거리(셀 단위, 셀 중심 간) — Felzenszwalb–Huttenlocher 분리형 EDT
// (chamfer 근사는 방향에 따라 최대 ~8% 과대 → 원형 띠 폭이 틀어짐)
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function distanceTransform(R) {
  const { nx, ny, mask } = R, g = new Float64Array(nx * ny), M = Math.max(nx, ny);
  const f = new Float64Array(M), d = new Float64Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] ? 1e20 : 0;
  for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = g[j * nx + i]; edt1d(f, ny, d, v, z); for (let j = 0; j < ny; j++) g[j * nx + i] = d[j]; }
  for (let j = 0; j < ny; j++) { for (let i = 0; i < nx; i++) f[i] = g[j * nx + i]; edt1d(f, nx, d, v, z); for (let i = 0; i < nx; i++) g[j * nx + i] = d[i]; }
  return Float32Array.from(g, Math.sqrt);
}

function thin({ nx, ny, mask }) {
  const im = Uint8Array.from(mask), del = [];
  const N = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? im[j * nx + i] : 0);
  for (let changed = true, it = 0; changed && it < 10000; it++) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!im[j * nx + i]) continue;
        const p = [N(i, j - 1), N(i + 1, j - 1), N(i + 1, j), N(i + 1, j + 1), N(i, j + 1), N(i - 1, j + 1), N(i - 1, j), N(i - 1, j - 1)];
        const B = p.reduce((a, b) => a + b, 0); if (B < 2 || B > 6) continue;
        let A = 0; for (let q = 0; q < 8; q++) if (!p[q] && p[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        del.push(j * nx + i);
      }
      for (const k of del) im[k] = 0;
      if (del.length) changed = true;
    }
  }
  return im;
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function neighbors(sk, nx, ny, k) {
  const i = k % nx, j = (k / nx) | 0, out = [];
  for (const [a, b] of NB) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && sk[jj * nx + ii]) out.push(jj * nx + ii); }
  return out;
}

function prune(sk, nx, ny, minLen) {
  for (let iter = 0; iter < 20; iter++) {
    let removed = false;
    for (let k = 0; k < sk.length; k++) {
      if (!sk[k] || neighbors(sk, nx, ny, k).length !== 1) continue;
      const branch = [k]; let prev = -1, cur = k, reachedJunction = false;
      while (branch.length < minLen) {
        const nb = neighbors(sk, nx, ny, cur).filter((q) => q !== prev && !branch.includes(q));
        if (nb.length !== 1) { reachedJunction = nb.length > 1; break; }
        if (neighbors(sk, nx, ny, nb[0]).length > 2) { reachedJunction = true; break; }
        prev = cur; cur = nb[0]; branch.push(cur);
      }
      if (reachedJunction && branch.length < minLen) { for (const q of branch) sk[q] = 0; removed = true; }
    }
    if (!removed) break;
  }
}

function bfsFarthest(sk, nx, ny, start, blocked = -1) {
  const prev = new Map([[start, -1]]), q = [start]; let last = start;
  for (let h = 0; h < q.length; h++) {
    const k = q[h]; last = k;
    for (const n of neighbors(sk, nx, ny, k)) if (n !== blocked && !prev.has(n)) { prev.set(n, k); q.push(n); }
  }
  const path = []; for (let k = last; k !== -1; k = prev.get(k)) path.push(k);
  return path.reverse();
}

function orderPath(sk, nx, ny) {
  const pix = []; for (let k = 0; k < sk.length; k++) if (sk[k]) pix.push(k);
  if (!pix.length) throw new Error('관측면에서 중심선을 찾지 못함(면이 너무 작거나 비어 있음)');
  const ends = pix.filter((k) => neighbors(sk, nx, ny, k).length === 1);
  if (!ends.length) {   // 닫힌 고리: 한 점을 막고 최장 경로 → 닫음
    const p0 = pix[0], nb = neighbors(sk, nx, ny, p0);
    const path = bfsFarthest(sk, nx, ny, bfsFarthest(sk, nx, ny, nb[0], p0).pop(), p0);
    return { path: [...path, p0], closed: true, branched: false };
  }
  const a = bfsFarthest(sk, nx, ny, ends[0]).pop(), path = bfsFarthest(sk, nx, ny, a);
  return { path, closed: false, branched: ends.length > 2 };
}

function smoothResample(pts, closed, win, step) {
  const n = pts.length / 2, sm = new Float64Array(pts.length), h = Math.max(1, Math.round(win));
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -h; k <= h; k++) { let j = i + k; if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue; sx += pts[2 * j]; sy += pts[2 * j + 1]; c++; }
    sm[2 * i] = sx / c; sm[2 * i + 1] = sy / c;
  }
  if (!closed) { sm[0] = pts[0]; sm[1] = pts[1]; sm[2 * n - 2] = pts[2 * n - 2]; sm[2 * n - 1] = pts[2 * n - 1]; }
  const m = closed ? n + 1 : n, cum = [0];
  for (let i = 1; i < m; i++) { const a = (i - 1) % n, b = i % n; cum.push(cum[i - 1] + Math.hypot(sm[2 * b] - sm[2 * a], sm[2 * b + 1] - sm[2 * a + 1])); }
  const L = cum[m - 1], K = Math.max(2, Math.round(L / step)), out = [];
  for (let k = 0, i = 1; k <= (closed ? K - 1 : K); k++) {
    const s = (k * L) / K;
    while (i < m - 1 && cum[i] < s) i++;
    const a = (i - 1) % n, b = i % n, t = (s - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    out.push(sm[2 * a] + t * (sm[2 * b] - sm[2 * a]), sm[2 * a + 1] + t * (sm[2 * b + 1] - sm[2 * a + 1]));
  }
  return out;
}

// 중심선 재중심. Zhang–Suen 은 꺾인 띠의 바깥 모서리 쪽(직각)으로 지나간다. 일정 폭 띠의 중심선은
// "안쪽(오목한 쪽) 경계에서 반폭만큼 떨어진 곡선"이므로(ㄱ자 안쪽 모서리 둘레 반경 W/2 원호),
// 각 점의 법선(넓게 평활한 곡선 기준) 위에서 dt ≥ thr 인 구간을 찾아 곡률 안쪽 끝에서 min(구간 반폭, c) 만큼 들어간 점을 쓴다.
// 곧은 구간·원호는 구간이 좁아(≈2·(dtMed−thr)+1 셀) 구간 중점 = 정확한 중심이 된다.
function recenter(pts, closed, dt, R, dtMed) {
  const n = pts.length / 2, cell = R.cell, thr = dtMed - 1, cap = 1.5 * cell;
  if (n < 3) return pts;
  const dtAt = (x, y) => {
    const fx = (x - R.x0) / cell - 0.5, fy = (y - R.y0) / cell - 0.5, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    const g = (ii, jj) => (ii >= 0 && jj >= 0 && ii < R.nx && jj < R.ny ? dt[jj * R.nx + ii] : 0);
    return (1 - a) * (1 - b) * g(i, j) + a * (1 - b) * g(i + 1, j) + (1 - a) * b * g(i, j + 1) + a * b * g(i + 1, j + 1);
  };
  const hw = Math.max(2, Math.round((dtMed * cell) / 0.25)), sm = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -hw; k <= hw; k++) { let j = i + k; if (closed) j = ((j % n) + n) % n; else if (j < 0 || j >= n) continue; sx += pts[2 * j]; sy += pts[2 * j + 1]; c++; }
    sm[2 * i] = sx / c; sm[2 * i + 1] = sy / c;
  }
  const idx = (i) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  const tan = (i) => { const a = idx(i - 1), b = idx(i + 1), tx = sm[2 * b] - sm[2 * a], ty = sm[2 * b + 1] - sm[2 * a + 1], l = Math.hypot(tx, ty) || 1; return [tx / l, ty / l]; };
  const range = dtMed * cell, step = cell / 4, K = Math.ceil(range / step), out = new Array(2 * n);
  for (let i = 0; i < n; i++) {
    out[2 * i] = pts[2 * i]; out[2 * i + 1] = pts[2 * i + 1];
    const [tx, ty] = tan(i), nxv = -ty, nyv = tx, ox = sm[2 * i], oy = sm[2 * i + 1];
    // dt ≥ thr 인 연속 구간 중 원점(t=0)에 가장 가까운 것
    let best = null, run = null;
    for (let q = -K; q <= K + 1; q++) {
      const t = q * step, inR = q <= K && dtAt(ox + t * nxv, oy + t * nyv) >= thr;
      if (inR) { if (!run) run = [t, t]; else run[1] = t; } else if (run) {
        const d = run[0] > 0 ? run[0] : run[1] < 0 ? -run[1] : 0;
        if (!best || d < best.d) best = { a: run[0], b: run[1], d };
        run = null;
      }
    }
    if (!best) continue;
    const ta = tan(i - hw), tb = tan(i + hw), turn = ta[0] * tb[1] - ta[1] * tb[0], h = Math.min((best.b - best.a) / 2, cap);
    const t = turn > 0 ? best.b - h : best.a + h;   // 왼쪽(+법선)으로 돌면 안쪽 = 구간의 + 끝
    out[2 * i] = ox + t * nxv; out[2 * i + 1] = oy + t * nyv;
  }
  return out;
}

// ---- 직렬화 가능한 data → 함수 객체 ----
export function lineFromData(data) {
  const { kind, closed, frame: F, raster: R, width } = data;
  const inside = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
  const boundaryDist = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); if (i < 0 || j < 0 || i >= R.nx || j >= R.ny) return 0; return Math.max(0, (R.dt[j * R.nx + i] - 0.5) * R.cell); };
  let length, toSW, fromSW, tangentAt;
  if (kind === 'line') {
    const [ax, ay] = data.a, [tx, ty] = data.t; length = data.length;
    toSW = (x, y) => [(x - ax) * tx + (y - ay) * ty, tx * (y - ay) - ty * (x - ax)];
    fromSW = (s, w) => [ax + s * tx - w * ty, ay + s * ty + w * tx];
    tangentAt = () => [tx, ty];
  } else if (kind === 'circle') {
    const [cx, cy] = data.c, Rr = data.r, th0 = data.th0, dir = data.dir; length = closed ? 2 * Math.PI * Rr : data.length;
    toSW = (x, y) => {
      const th = Math.atan2(y - cy, x - cx); let d = dir * (th - th0); d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (!closed && d > length / Rr + (2 * Math.PI - length / Rr) / 2) d -= 2 * Math.PI;
      return [d * Rr, dir * (Rr - Math.hypot(x - cx, y - cy))];   // 진행 방향 왼쪽(+) — 반시계 진행이면 안쪽이 왼쪽
    };
    fromSW = (s, w) => { const th = th0 + (dir * s) / Rr, r = Rr - dir * w; return [cx + r * Math.cos(th), cy + r * Math.sin(th)]; };
    tangentAt = (s) => { const th = th0 + (dir * s) / Rr; return [-dir * Math.sin(th), dir * Math.cos(th)]; };
  } else {
    const P = data.pts, n = P.length / 2, segs = closed ? n : n - 1, cum = new Float64Array(segs + 1);
    for (let i = 0; i < segs; i++) { const b = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(P[2 * b] - P[2 * i], P[2 * b + 1] - P[2 * i + 1]); }
    length = cum[segs];
    const B = Math.max(1, width), buckets = new Map(), key = (i, j) => i * 1048576 + j;
    for (let i = 0; i < segs; i++) {
      const b = (i + 1) % n;
      const i0 = Math.floor(Math.min(P[2 * i], P[2 * b]) / B), i1 = Math.floor(Math.max(P[2 * i], P[2 * b]) / B);
      const j0 = Math.floor(Math.min(P[2 * i + 1], P[2 * b + 1]) / B), j1 = Math.floor(Math.max(P[2 * i + 1], P[2 * b + 1]) / B);
      for (let a = i0; a <= i1; a++) for (let c = j0; c <= j1; c++) { const k = key(a, c); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
    }
    const seg = (i) => { const b = (i + 1) % n; return [P[2 * i], P[2 * i + 1], P[2 * b], P[2 * b + 1]]; };
    toSW = (x, y) => {
      const bi = Math.floor(x / B), bj = Math.floor(y / B);
      let best = Infinity, bs = 0, bw = 0;
      for (let r = 0; r < 64; r++) {
        for (let a = bi - r; a <= bi + r; a++) for (let c = bj - r; c <= bj + r; c++) {
          if (Math.max(Math.abs(a - bi), Math.abs(c - bj)) !== r) continue;
          for (const i of buckets.get(key(a, c)) ?? []) {
            const [x1, y1, x2, y2] = seg(i), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1e-12;
            const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)), fx = x1 + t * dx, fy = y1 + t * dy, dd = Math.hypot(x - fx, y - fy);
            if (dd < best) { best = dd; bs = cum[i] + t * Math.sqrt(l2); bw = Math.sign(dx * (y - fy) - dy * (x - fx)) * dd; }
          }
        }
        if (best <= (r - 1) * B) break;
      }
      return [bs, bw];
    };
    const at = (s) => {
      s = closed ? ((s % length) + length) % length : Math.max(0, Math.min(length, s));
      let lo = 0, hi = segs; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const [x1, y1, x2, y2] = seg(lo), l = Math.hypot(x2 - x1, y2 - y1) || 1e-12, t = (s - cum[lo]) / l;
      return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), tx: (x2 - x1) / l, ty: (y2 - y1) / l };
    };
    fromSW = (s, w) => { const a = at(s); return [a.x - w * a.ty, a.y + w * a.tx]; };
    tangentAt = (s) => { const a = at(s); return [a.tx, a.ty]; };
  }
  const to2D = (p) => [dot(p, F.u), dot(p, F.v)];
  const to3D = (x, y, h) => { const hh = data.hMin + h; return [x * F.u[0] + y * F.v[0] + hh * F.d[0], x * F.u[1] + y * F.v[1] + hh * F.d[1], x * F.u[2] + y * F.v[2] + hh * F.d[2]]; };
  return { kind, closed, length, width, branched: data.branched, frame: F, data, inside, boundaryDist, toSW, fromSW, tangentAt, to2D, to3D };
}

export function recognizeLine(parts, faces, dir) {
  const F = viewFrame(dir), { tris, hMin } = project(parts, faces, F);
  if (!tris.length) throw new Error('관측면이 선택되지 않음');
  const R = rasterize(tris), dt = distanceTransform(R);
  const sk = thin(R);
  const widths = []; for (let k = 0; k < sk.length; k++) if (sk[k]) widths.push(2 * (dt[k] - 0.5) * R.cell);
  widths.sort((a, b) => a - b);
  const width = widths[widths.length >> 1] ?? 0;
  prune(sk, R.nx, R.ny, Math.max(3, Math.round((0.6 * width) / R.cell)));
  const { path, closed, branched } = orderPath(sk, R.nx, R.ny);
  const raw = []; for (const k of path) raw.push(R.x0 + ((k % R.nx) + 0.5) * R.cell, R.y0 + (((k / R.nx) | 0) + 0.5) * R.cell);
  let pts = smoothResample(raw, closed, 0.25 / R.cell, 0.25);
  pts = smoothResample(recenter(pts, closed, dt, R, width / (2 * R.cell) + 0.5), closed, 1, 0.25);
  const insideR = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
  if (!closed) {   // 끝 접선 방향으로 영역 끝까지 연장
    const extend = (ix, jx, back) => {
      const n = pts.length / 2, k0 = back ? n - 1 : 0, k1 = back ? Math.max(0, n - 1 - Math.round(2 / 0.25)) : Math.min(n - 1, Math.round(2 / 0.25));
      let tx = pts[2 * k0] - pts[2 * k1], ty = pts[2 * k0 + 1] - pts[2 * k1 + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      let x = pts[2 * k0], y = pts[2 * k0 + 1]; const add = [];
      for (let q = 0; q < 1e5; q++) { const nx2 = x + tx * R.cell / 2, ny2 = y + ty * R.cell / 2; if (!insideR(nx2, ny2)) break; x = nx2; y = ny2; }
      // 래스터 셀 중심 기준 → 실제 경계는 반 셀 더 바깥
      x += tx * R.cell / 2; y += ty * R.cell / 2;
      add.push(x, y);
      return add;
    };
    const e = extend(0, 0, true), s = extend(0, 0, false);
    pts = [...s, ...pts, ...e];
  }
  const P = Float64Array.from(pts), n = P.length / 2;
  const data = { kind: 'path', closed, branched, frame: F, hMin, width, raster: { x0: R.x0, y0: R.y0, cell: R.cell, nx: R.nx, ny: R.ny, mask: R.mask, dt, bounds: R.bounds }, pts: P };
  // 직선 맞춤(열린 경로)
  if (!closed) {
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += P[2 * i]; my += P[2 * i + 1]; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const x = P[2 * i] - mx, y = P[2 * i + 1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), tx = Math.cos(th), ty = Math.sin(th);
    let dev = 0; for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(-ty * (P[2 * i] - mx) + tx * (P[2 * i + 1] - my)));
    if (dev <= Math.max(0.05, R.cell)) {
      const sgn = (P[2 * n - 2] - P[0]) * tx + (P[2 * n - 1] - P[1]) * ty >= 0 ? 1 : -1, t2 = [sgn * tx, sgn * ty];
      const s0 = (P[0] - mx) * t2[0] + (P[1] - my) * t2[1], s1 = (P[2 * n - 2] - mx) * t2[0] + (P[2 * n - 1] - my) * t2[1];
      return lineFromData({ ...data, kind: 'line', a: [mx + s0 * t2[0], my + s0 * t2[1]], t: t2, length: s1 - s0 });
    }
  }
  // 원 맞춤(Kasa)
  {
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1], z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], b = [Sxz, Syz, Sz];
    const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det3(A);
    if (Math.abs(D) > 1e-12) {
      const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? b[i] : v)));
      const a1 = det3(col(0)) / D, a2 = det3(col(1)) / D, a3 = det3(col(2)) / D;
      const cx = a1 / 2, cy = a2 / 2, r = Math.sqrt(a3 + cx * cx + cy * cy);
      let rms = 0; for (let i = 0; i < n; i++) rms += (Math.hypot(P[2 * i] - cx, P[2 * i + 1] - cy) - r) ** 2;
      rms = Math.sqrt(rms / n);
      const th0 = Math.atan2(P[1] - cy, P[0] - cx), thA = Math.atan2(P[3] - cy, P[2] - cx);
      const dir = Math.sin(thA - th0) >= 0 ? 1 : -1;
      let arc = 0; for (let i = 1; i < n; i++) { let d = Math.atan2(P[2 * i + 1] - cy, P[2 * i] - cx) - Math.atan2(P[2 * i - 1] - cy, P[2 * i - 2] - cx); d = Math.atan2(Math.sin(d), Math.cos(d)); arc += dir * d; }
      if (Number.isFinite(r) && rms <= Math.max(0.1, R.cell) && (closed || arc >= Math.PI / 6)) {
        return lineFromData({ ...data, kind: 'circle', c: [cx, cy], r, th0, dir, length: closed ? 2 * Math.PI * r : arc * r });
      }
    }
  }
  return lineFromData(data);
}
