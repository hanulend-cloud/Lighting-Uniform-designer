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

function rasterize(tris, cellOverride = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < tris.length; i += 2) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]); }
  const cell = cellOverride || Math.max(0.05, Math.max(x1 - x0, y1 - y0) / 2000);
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


const ERR_SPLIT = '선택한 관측면이 서로 떨어져 있음 — 이어진 면만 선택하세요';
const ERR_SHAPE = '관측면이 띠(라인) 모양이 아님 — 라인 형태의 면을 선택하세요';
const ERR_SHORT = '관측면이 너무 짧거나 띠 모양이 아님 — 라인 형태의 면을 선택하세요';

// 능선(dt 가 8 이웃 이상인 화소) dt 의 중앙값 × 2 = 대표 폭(mm). 작은 구멍·혹은 소수라 무시된다.
function ridgeWidth(R, dt) {
  const { nx, ny, mask, cell } = R, v = [];
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, d = dt[k]; if (!mask[k] || d < 1) continue;
    if (d >= dt[k - 1] && d >= dt[k + 1] && d >= dt[k - nx] && d >= dt[k + nx] && d >= dt[k - nx - 1] && d >= dt[k - nx + 1] && d >= dt[k + nx - 1] && d >= dt[k + nx + 1]) v.push(d);
  }
  if (!v.length) return 2 * cell;
  v.sort((a, b) => a - b); return 2 * v[v.length >> 1] * cell;
}
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 마스크 위상 정리: 전경 8-연결 성분(작은 조각 제거, 2개 이상이면 오류), 배경 4-연결로 구멍 수 계산(작은 구멍은 메움).
// 반환: { holes: [{ id, size(셀), ext(셀) }], lab(배경 성분 번호) } — 고리의 안쪽인지 작은 구멍인지는 폭을 안 뒤에 가른다
function cleanTopology(R) {
  const { nx, ny, mask } = R, N = nx * ny, lab = new Int32Array(N).fill(-1), q = new Int32Array(N), MIN = 25;
  const flood = (seed, id, val, nbrs) => {
    let h = 0, t = 0; q[t++] = seed; lab[seed] = id;
    while (h < t) {
      const k = q[h++], i = k % nx, j = (k / nx) | 0;
      for (const [a, b] of nbrs) {
        const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii; if (mask[kk] === val && lab[kk] < 0) { lab[kk] = id; q[t++] = kk; }
      }
    }
    return t;
  };
  const fg = []; let total = 0;
  for (let k = 0; k < N; k++) if (mask[k] && lab[k] < 0) { const s = flood(k, fg.length, 1, N8); fg.push(s); total += s; }
  if (!total) throw new Error('관측면에서 중심선을 찾지 못함(면이 너무 작거나 비어 있음)');
  const minFg = Math.max(MIN, 0.005 * total), keep = fg.map((s) => s >= minFg);
  if (keep.filter(Boolean).length > 1) throw new Error(ERR_SPLIT);
  for (let k = 0; k < N; k++) if (mask[k] && !keep[lab[k]]) mask[k] = 0;
  lab.fill(-1);
  const OUT = 0; let id = 1;
  for (let i = 0; i < nx; i++) for (const j of [0, ny - 1]) { const k = j * nx + i; if (!mask[k] && lab[k] < 0) flood(k, OUT, 0, N4); }
  for (let j = 0; j < ny; j++) for (const i of [0, nx - 1]) { const k = j * nx + i; if (!mask[k] && lab[k] < 0) flood(k, OUT, 0, N4); }
  const holes = [];
  for (let k = 0; k < N; k++) {
    if (mask[k] || lab[k] >= 0) continue;
    const hid = id++, s = flood(k, hid, 0, N4);
    if (s < MIN) { for (let h = 0; h < s; h++) mask[q[h]] = 1; continue; }   // 삼각분할 틈 같은 작은 구멍은 메움
    let i0 = Infinity, i1 = -1, j0 = Infinity, j1 = -1;
    for (let h = 0; h < s; h++) { const i = q[h] % nx, j = (q[h] / nx) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    holes.push({ id: hid, size: s, ext: Math.max(i1 - i0, j1 - j0) + 1 });
  }
  return { holes, lab };
}

// Zhang–Suen 세선화. 지울 수 있는 화소는 경계 화소뿐이므로 경계 후보 목록만 돈다(전체 주사와 결과 동일).
function thin({ nx, ny, mask }) {
  const im = Uint8Array.from(mask), inC = new Uint8Array(nx * ny);
  const N = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? im[j * nx + i] : 0);
  let cand = [];
  for (let k = 0; k < im.length; k++) {
    if (!im[k]) continue;
    const i = k % nx, j = (k / nx) | 0;
    if (N8.some(([a, b]) => !N(i + a, j + b))) { cand.push(k); inC[k] = 1; }
  }
  const p = new Uint8Array(8);
  for (let changed = true, it = 0; changed && it < 10000; it++) {
    changed = false;
    for (const step of [0, 1]) {
      const del = [];
      for (const k of cand) {
        if (!im[k]) continue;
        const i = k % nx, j = (k / nx) | 0;
        p[0] = N(i, j - 1); p[1] = N(i + 1, j - 1); p[2] = N(i + 1, j); p[3] = N(i + 1, j + 1); p[4] = N(i, j + 1); p[5] = N(i - 1, j + 1); p[6] = N(i - 1, j); p[7] = N(i - 1, j - 1);
        const B = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7]; if (B < 2 || B > 6) continue;
        let A = 0; for (let r = 0; r < 8; r++) if (!p[r] && p[(r + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        del.push(k);
      }
      if (!del.length) continue;
      changed = true;
      for (const k of del) im[k] = 0;
      for (const k of del) {
        const i = k % nx, j = (k / nx) | 0;
        for (const [a, b] of N8) { const ii = i + a, jj = j + b, kk = jj * nx + ii; if (N(ii, jj) && !inC[kk]) { inC[kk] = 1; cand.push(kk); } }
      }
      cand = cand.filter((k) => im[k]);
    }
  }
  return im;
}

// 8-최소 골격: 계단 화소(이웃이 3×3 고리 안에서 한 덩어리이고, 4-인접 배경 덩어리도 하나 = 단순점, 이웃 ≥ 2)를 지운다.
// 이렇게 하면 이웃 수 1 = 끝점, 2 = 선, ≥ 3 = 분기점으로 분류된다(교차수와 같음).
const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
function minimal8(sk, nx, ny) {
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? sk[j * nx + i] : 0), v = new Uint8Array(8), par = new Int8Array(8);
  const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  let pix = []; for (let k = 0; k < sk.length; k++) if (sk[k]) pix.push(k);
  for (let changed = true; changed;) {
    changed = false;
    for (const k of pix) {
      if (!sk[k]) continue;
      const i = k % nx, j = (k / nx) | 0; let B = 0;
      for (let r = 0; r < 8; r++) { v[r] = at(i + RING[r][0], j + RING[r][1]); B += v[r]; par[r] = r; }
      if (B < 2) continue;
      for (let a = 0; a < 8; a++) if (v[a]) for (let b = a + 1; b < 8; b++) if (v[b] && Math.abs(RING[a][0] - RING[b][0]) <= 1 && Math.abs(RING[a][1] - RING[b][1]) <= 1) par[find(a)] = find(b);
      let fgC = 0; for (let a = 0; a < 8; a++) if (v[a] && find(a) === a) fgC++;
      if (fgC !== 1) continue;
      let bgC = 0;   // 고리를 따라 이어진 배경 구간 중 4-이웃(짝수 번호)을 포함하는 것의 수
      for (let a = 0; a < 8; a++) {
        if (!v[a] && v[(a + 7) % 8]) { let has = false; for (let b = a; !v[b % 8] && b < a + 8; b++) if ((b % 8) % 2 === 0) has = true; if (has) bgC++; }
      }
      if (bgC !== 1) continue;
      sk[k] = 0; changed = true;
    }
    pix = pix.filter((k) => sk[k]);
  }
}

function neighbors(sk, nx, ny, k) {
  const i = k % nx, j = (k / nx) | 0, out = [];
  for (const [a, b] of N8) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && sk[jj * nx + ii]) out.push(jj * nx + ii); }
  return out;
}
const stepLen = (a, b, nx) => (a % nx !== b % nx && ((a / nx) | 0) !== ((b / nx) | 0) ? Math.SQRT2 : 1);

// 끝점에서 분기점까지 짧은 가지(< factor · 분기점의 국소 폭)를 지운다. 길이·폭 모두 셀 단위.
function prune(sk, nx, ny, dt, factor, dtMax) {
  for (let iter = 0; iter < 20; iter++) {
    let removed = false;
    for (let k = 0; k < sk.length; k++) {
      if (!sk[k] || neighbors(sk, nx, ny, k).length !== 1) continue;
      const branch = [k], seen = new Set(branch); let prev = -1, cur = k, len = 0, junction = -1;
      for (;;) {
        const nb = neighbors(sk, nx, ny, cur).filter((q) => q !== prev && !seen.has(q));
        if (nb.length !== 1) break;
        const nxt = nb[0];
        if (neighbors(sk, nx, ny, nxt).length > 2) { junction = nxt; len += stepLen(cur, nxt, nx); break; }
        len += stepLen(cur, nxt, nx); prev = cur; cur = nxt; branch.push(cur); seen.add(cur);
        if (len >= factor * 2 * dtMax) break;   // 어떤 분기점 폭보다도 긴 가지 → 진짜 끝
      }
      if (junction >= 0 && len < factor * 2 * dt[junction]) { for (const q of branch) sk[q] = 0; removed = true; }
    }
    if (!removed) break;
  }
}

// 골격 위 최단 거리(대각 √2) — 가장 먼 점과 경로
function geodesic(sk, nx, ny, start, blocked = -1) {
  const dist = new Map([[start, 0]]), prev = new Map([[start, -1]]), heap = [[0, start]];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let far = start;
  while (heap.length) {
    const [d, k] = pop(); if (d > dist.get(k)) continue;
    if (d > dist.get(far)) far = k;
    for (const n of neighbors(sk, nx, ny, k)) {
      if (n === blocked) continue;
      const nd = d + stepLen(k, n, nx);
      if (!dist.has(n) || nd < dist.get(n)) { dist.set(n, nd); prev.set(n, k); push([nd, n]); }
    }
  }
  const pathTo = (t) => { const p = []; for (let k = t; k !== -1 && k !== undefined; k = prev.get(k)) p.push(k); return p.reverse(); };
  return { far, dist, pathTo };
}

function orderPath(sk, nx, ny, closed) {
  let pix = []; for (let k = 0; k < sk.length; k++) if (sk[k]) pix.push(k);
  if (!pix.length) throw new Error('관측면에서 중심선을 찾지 못함(면이 너무 작거나 비어 있음)');
  const ends = pix.filter((k) => neighbors(sk, nx, ny, k).length === 1);
  if (closed) {
    const branched = ends.length > 0;
    const q = [...ends];   // 고리에 붙은 가지를 끝점부터 모두 벗겨 낸다
    while (q.length) { const k = q.pop(); if (!sk[k]) continue; const nb = neighbors(sk, nx, ny, k); if (nb.length <= 1) { sk[k] = 0; for (const n of nb) q.push(n); } }
    pix = pix.filter((k) => sk[k]);
    const p0 = pix.find((k) => neighbors(sk, nx, ny, k).length === 2);
    if (p0 === undefined) throw new Error(ERR_SHAPE);
    const [a, b] = neighbors(sk, nx, ny, p0), g = geodesic(sk, nx, ny, a, p0);
    if (!g.dist.has(b)) throw new Error(ERR_SHAPE);
    return { path: [p0, ...g.pathTo(b)], branched };
  }
  const a = geodesic(sk, nx, ny, ends[0] ?? pix[0]).far, g = geodesic(sk, nx, ny, a);
  return { path: g.pathTo(g.far), branched: ends.length > 2 };
}

// 열린 경로의 양 끝 다듬기: 끝의 모서리 가지(끝에서 잰 길이 < 1.8 × 국소 반폭)를 잘라 낸다. 셀 단위.
function trimEnds(path, nx, dt) {
  const n = path.length, cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + stepLen(path[i - 1], path[i], nx);
  let m0 = 0; while (m0 < n - 1 && cum[m0] < 1.8 * dt[path[m0]]) m0++;
  let m1 = n - 1; while (m1 > 0 && cum[n - 1] - cum[m1] < 1.8 * dt[path[m1]]) m1--;
  return m1 - m0 >= 4 ? path.slice(m0, m1 + 1) : path;
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


// 래스터 조회 도우미
function rasterOps(R, dt) {
  const { x0, y0, cell, nx, ny, mask } = R;
  const inside = (x, y) => { const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell); return i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1; };
  const g = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? dt[j * nx + i] : 0);
  const dtAt = (x, y) => {   // 셀 중심 값의 쌍선형 보간(셀 단위)
    const fx = (x - x0) / cell - 0.5, fy = (y - y0) / cell - 0.5, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    return (1 - a) * (1 - b) * g(i, j) + a * (1 - b) * g(i + 1, j) + (1 - a) * b * g(i, j + 1) + a * b * g(i + 1, j + 1);
  };
  const dtLoc = (x, y) => { const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell); let m = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) m = Math.max(m, g(i + a, j + b)); return m; };
  return { inside, dtAt, dtLoc };
}

// 중심선 재중심(국소 폭 기준).
// - 기본: 더 넓게 평활한 곡선의 법선을 따라 양쪽으로 영역 끝까지 가서(한쪽 최대 2·국소반폭 + 2셀) 단면의 중점.
//   곧은 띠·원호·테이퍼에서 정확한 중심(골격의 반 셀 치우침 없음).
// - 단면이 주변 단면 폭(이동 중앙값)보다 뚜렷이 길면(꺾인 모서리의 바깥 귀, 한쪽 혹): 앞뒤 정상 단면의 경계와 이어지는 쪽을
//   "참 경계"로 보고, 그 경계에서 안으로 들어가며 dt ≥ (기대 반폭 − 1셀) 인 첫 구간의 시작 + 1셀 점을 쓴다.
//   = 참 경계에서 기대 반폭만큼 떨어진 곡선. ㄱ자 안쪽 모서리에서는 반경 W/2 원호(일정 폭 띠의 중심선), 혹에서는 곧은 쪽 기준 중심.
function recenter(pts, closed, R, dt) {
  const n = pts.length / 2, cell = R.cell, { inside, dtAt, dtLoc } = rasterOps(R, dt), step = cell / 4;
  if (n < 3) return pts;
  const idx = (i) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  const ox = new Float64Array(n), oy = new Float64Array(n), nX = new Float64Array(n), nY = new Float64Array(n), tP = new Float64Array(n), tM = new Float64Array(n), hl = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    hl[i] = dtLoc(pts[2 * i], pts[2 * i + 1]) * cell;
    let k = Math.max(2, Math.round(Math.max(1, hl[i]) / 0.25));
    if (!closed) k = Math.min(k, i, n - 1 - i);
    let sx = 0, sy = 0; for (let q = -k; q <= k; q++) { const j = idx(i + q); sx += pts[2 * j]; sy += pts[2 * j + 1]; }
    ox[i] = sx / (2 * k + 1); oy[i] = sy / (2 * k + 1);
    const kk = Math.max(1, k), a = idx(i - kk), b = idx(i + kk);
    let tx = pts[2 * b] - pts[2 * a], ty = pts[2 * b + 1] - pts[2 * a + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    nX[i] = -ty; nY[i] = tx;
    if (!inside(ox[i], oy[i])) { ox[i] = pts[2 * i]; oy[i] = pts[2 * i + 1]; }
    const lim = 2 * hl[i] + 2 * cell;
    for (const s of [1, -1]) {
      let t = 0; while (t + step <= lim && inside(ox[i] + s * (t + step) * nX[i], oy[i] + s * (t + step) * nY[i])) t += step;
      if (t + step <= lim) t += step / 2;   // 마지막 안쪽 표본과 첫 바깥 표본의 가운데
      if (s > 0) tP[i] = t; else tM[i] = t;
    }
  }
  // 기대 폭 = 단면 길이의 이동 중앙값. 창은 ±max(4·국소반폭, 6·전체 폭) — 혹·패드(≲ 6W)보다 넓어야 중앙값이 혹을 무시한다.
  // 열린 경로는 창을 대칭으로 줄인다(테이퍼 끝에서 중앙값이 한쪽으로 치우치지 않게).
  const chord = Array.from({ length: n }, (_, i) => tP[i] + tM[i]), wExp = new Float64Array(n), bad = new Uint8Array(n);
  const Wg = [...chord].sort((a, b) => a - b)[n >> 1];
  for (let i = 0; i < n; i++) {
    let m = Math.max(8, Math.round(Math.max(4 * hl[i], 6 * Wg) / 0.25));
    if (closed) m = Math.min(m, (n - 1) >> 1); else m = Math.min(m, i, n - 1 - i);
    const win = []; for (let q = -m; q <= m; q++) win.push(chord[idx(i + q)]);
    win.sort((a, b) => a - b); wExp[i] = win[win.length >> 1];
    bad[i] = chord[i] > 1.05 * wExp[i] + 2 * cell ? 1 : 0;   // 5%: 꺾임 원호의 시작·끝(기운 단면)까지 잡는다
  }
  const out = new Array(2 * n), bnd = (i, s) => { const t = s > 0 ? tP[i] : -tM[i]; return [ox[i] + t * nX[i], oy[i] + t * nY[i]]; };
  for (let i = 0; i < n; i++) { const u = (tP[i] - tM[i]) / 2; out[2 * i] = ox[i] + u * nX[i]; out[2 * i + 1] = oy[i] + u * nY[i]; }   // 기본: 단면 중점
  // 넓어진 구간(연속한 bad 점들)을 한 덩어리로 처리
  const runs = [];
  if (bad.some((b) => !b)) {
    const g0 = closed ? bad.findIndex((b) => !b) : 0;
    for (let q = 0; q < n; q++) {
      const i = closed ? (g0 + q) % n : q;
      if (!bad[i]) continue;
      if (runs.length && runs[runs.length - 1].last === (closed ? (i - 1 + n) % n : i - 1)) runs[runs.length - 1].last = i;
      else runs.push({ first: i, last: i });
    }
  }
  const hermite = (P0, T0, P1, T1, t) => { const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2; return [h00 * P0[0] + h10 * T0[0] + h01 * P1[0] + h11 * T1[0], h00 * P0[1] + h10 * T0[1] + h01 * P1[1] + h11 * T1[1]]; };
  const bridges = [];
  for (const { first, last } of runs) {
    const cnt = closed ? ((last - first + n) % n) + 1 : last - first + 1;
    const jp = closed || first > 0 ? idx(first - 1) : -1, jn = closed || last < n - 1 ? idx(last + 1) : -1;
    if (jp < 0 && jn < 0) continue;
    // 한쪽 경계만 앞뒤 정상 단면의 경계와 어긋나면(ㄱ자 바깥 귀, 한쪽 혹) 맞는 쪽을 참 경계로 쓴다
    const dev = (i, s) => {
      const [bx, by] = bnd(i, s);
      let [ax, ay] = bnd(jp >= 0 ? jp : jn, s), dx, dy;
      if (jp >= 0 && jn >= 0) { const [cx, cy] = bnd(jn, s); dx = cx - ax; dy = cy - ay; } else { const j = jp >= 0 ? jp : jn; dx = nY[j]; dy = -nX[j]; }
      const l = Math.hypot(dx, dy); return l < 1e-9 ? Math.hypot(bx - ax, by - ay) : Math.abs(dx * (by - ay) - dy * (bx - ax)) / l;
    };
    const diffs = []; for (let q = 0; q < cnt; q++) { const i = idx(first + q); diffs.push(dev(i, 1) - dev(i, -1)); }
    diffs.sort((a, b) => a - b);
    const md = diffs[diffs.length >> 1];
    if (Math.abs(md) > 2 * cell) {
      const s = md < 0 ? 1 : -1;
      for (let q = 0; q < cnt; q++) {
        const i = idx(first + q), tb = s > 0 ? tP[i] : -tM[i], thr = wExp[i] / (2 * cell) - 0.5, span = tP[i] + tM[i];
        let a = -1;
        for (let d = 0; d <= span; d += step) { const t = tb - s * d; if (dtAt(ox[i] + t * nX[i], oy[i] + t * nY[i]) >= thr) { a = d; break; } }
        if (a < 0) continue;
        let b = a; while (b + step <= span && dtAt(ox[i] + (tb - s * (b + step)) * nX[i], oy[i] + (tb - s * (b + step)) * nY[i]) >= thr) b += step;
        const u = tb - s * (a + Math.min((b - a) / 2, cell));
        out[2 * i] = ox[i] + u * nX[i]; out[2 * i + 1] = oy[i] + u * nY[i];
      }
    } else if (jp >= 0 && jn >= 0) bridges.push([jp, jn, first, cnt]);   // 양쪽이 비슷하게 넓어짐(대칭 패드): 앞뒤 정상 중심선을 잇는다
  }
  // 이웃 점 사이 큰 가로 도약(긴 넓어짐의 시작·끝: 중점이 한 번에 옮겨감)도 폭 W 에 걸쳐 잇는다
  const kW = Math.max(2, Math.round(Wg / 2 / 0.25));
  for (let i = 1; i < (closed ? n + 1 : n); i++) {
    const a = idx(i - 1), b = idx(i);
    if (bad[a] || bad[b] || Math.hypot(out[2 * b] - out[2 * a], out[2 * b + 1] - out[2 * a + 1]) <= 0.25 + 4 * cell) continue;
    if (!closed && (i - 1 - kW < 0 || i + kW >= n)) continue;
    bridges.push([idx(i - 1 - kW), idx(i + kW), idx(i - kW), 2 * kW]);
  }
  for (const [jp, jn, first, cnt] of bridges) {
    const P0 = [out[2 * jp], out[2 * jp + 1]], P1 = [out[2 * jn], out[2 * jn + 1]], ch = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]);
    const tan = (j, d) => { const a = idx(j - 2 * d), b = j; const tx = d * (out[2 * b] - out[2 * a]), ty = d * (out[2 * b + 1] - out[2 * a + 1]), l = Math.hypot(tx, ty) || 1; return [(tx / l) * ch, (ty / l) * ch]; };
    const T0 = tan(jp, 1), T1 = tan(jn, -1);
    for (let q = 0; q < cnt; q++) { const i = idx(first + q), [x, y] = hermite(P0, T0, P1, T1, (q + 1) / (cnt + 1)); out[2 * i] = x; out[2 * i + 1] = y; }
  }
  // 뒤로 가는 점(지그재그) 제거
  const res = [out[0], out[1]];
  for (let i = 1; i < n; i++) {
    const px = res[res.length - 2], py = res[res.length - 1], tx = nY[i], ty = -nX[i];
    if ((out[2 * i] - px) * tx + (out[2 * i + 1] - py) * ty > 0.02) res.push(out[2 * i], out[2 * i + 1]);
  }
  return res;
}

// 등간격 점열의 국소 2차 회귀(Savitzky–Golay, 대칭 창 ±m 점; 열린 경로 끝은 창을 대칭으로 줄임)
function quadSmooth(pts, closed, m0) {
  const n = pts.length / 2, out = pts.slice();
  for (let i = 0; i < n; i++) {
    let m = closed ? Math.min(m0, (n - 1) >> 1) : Math.min(m0, i, n - 1 - i);
    if (m < 2) continue;
    {   // 급히 꺾이는 곳(ㄱ자 모서리 원호 R≈W/2)은 창을 줄인다: 창 안에서 방향이 20° 넘게 돌면 ±2 점
      const at = (q) => (closed ? (((i + q) % n) + n) % n : i + q), a = at(-m), b = at(-m + 1), c = at(m - 1), d = at(m);
      const t1 = Math.atan2(pts[2 * b + 1] - pts[2 * a + 1], pts[2 * b] - pts[2 * a]), t2 = Math.atan2(pts[2 * d + 1] - pts[2 * c + 1], pts[2 * d] - pts[2 * c]);
      if (Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1))) > 0.35) m = 2;
    }
    let S0 = 0, S2 = 0, S4 = 0, X = 0, Y = 0, QX = 0, QY = 0;
    for (let q = -m; q <= m; q++) { const j = closed ? (((i + q) % n) + n) % n : i + q, q2 = q * q; S0++; S2 += q2; S4 += q2 * q2; X += pts[2 * j]; Y += pts[2 * j + 1]; QX += q2 * pts[2 * j]; QY += q2 * pts[2 * j + 1]; }
    const D = S0 * S4 - S2 * S2; out[2 * i] = (S4 * X - S2 * QX) / D; out[2 * i + 1] = (S4 * Y - S2 * QY) / D;
  }
  return out;
}

// 열린 경로 끝 구간(연장점 + 겹침 2mm)의 국소 선형 회귀(호 길이 ±1mm). 연장점은 마지막 평활 뒤에 붙으므로
// 단면 중점의 ½셀 잡음이 그대로 남아 끝 선분을 수 도 기울인다 → 여기서 다듬는다(가운데 구간은 손대지 않음).
function endSmooth(pts, k0, k1, h = 1) {
  const n = pts.length / 2, cum = new Float64Array(n), out = pts.slice();
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  const det = (X) => X[0][0] * (X[1][1] * X[2][2] - X[1][2] * X[2][1]) - X[0][1] * (X[1][0] * X[2][2] - X[1][2] * X[2][0]) + X[0][2] * (X[1][0] * X[2][1] - X[1][1] * X[2][0]);
  // 곡률 항(s²)은 넓은 창(±2.5h)의 2차 맞춤에서 얻고, 위치·기울기는 좁은 창(±h)의 1차 맞춤으로 얻는다:
  // 1차만 쓰면 굽은 끝에서 가로로 치우쳐 구간 경계가 꺾이고, 2차만 쓰면 끝점 기울기가 잡음에 약하다.
  const quad = (i, H) => {
    const M = [0, 0, 0, 0, 0], bx = [0, 0, 0], by = [0, 0, 0];
    for (let j = 0; j < n; j++) { const s = cum[j] - cum[i]; if (s < -H) continue; if (s > H) break; let p = 1; for (let e = 0; e < 5; e++) { M[e] += p; p *= s; } for (let e = 0, q = 1; e < 3; e++, q *= s) { bx[e] += q * pts[2 * j]; by[e] += q * pts[2 * j + 1]; } }
    const A = [[M[0], M[1], M[2]], [M[1], M[2], M[3]], [M[2], M[3], M[4]]], D = det(A); if (M[0] < 5 || Math.abs(D) < 1e-12) return [0, 0];
    const c2 = (b) => det([[A[0][0], A[0][1], b[0]], [A[1][0], A[1][1], b[1]], [A[2][0], A[2][1], b[2]]]) / D;
    return [c2(bx), c2(by)];
  };
  const fit = (i) => {
    // 곡률 항은 양쪽 창이 다 들어가는 가장 가까운 점에서 잰다(끝에서 한쪽 창 2차 맞춤은 잡음을 크게 키움)
    let ic = i; while (ic < n - 1 && cum[ic] < 2.5 * h) ic++; while (ic > 0 && cum[n - 1] - cum[ic] < 2.5 * h) ic--;
    const [cx, cy] = quad(ic, 2.5 * h);
    let S = 0, Ss = 0, Sss = 0, Sx = 0, Sy = 0, Ssx = 0, Ssy = 0;
    for (let j = 0; j < n; j++) { const s = cum[j] - cum[i]; if (s < -h) continue; if (s > h) break; const x = pts[2 * j] - cx * s * s, y = pts[2 * j + 1] - cy * s * s; S++; Ss += s; Sss += s * s; Sx += x; Sy += y; Ssx += s * x; Ssy += s * y; }
    const D = S * Sss - Ss * Ss; if (S < 3 || Math.abs(D) < 1e-12) return;
    out[2 * i] = (Sx * Sss - Ss * Ssx) / D; out[2 * i + 1] = (Sy * Sss - Ss * Ssy) / D;
  };
  for (let i = 0; i < Math.min(n, k0); i++) fit(i);
  for (let i = Math.max(Math.min(n, k0), n - k1); i < n; i++) fit(i);
  return out;
}

// ---- 직렬화 가능한 data → 함수 객체 ----
// JSON 왕복(typed array → 일반 객체/배열)도 되살린다.
const revive = (a, T) => (a == null || a instanceof T ? a : T.from(Array.isArray(a) ? a : Object.values(a)));

// Worker 로 보낼 가벼운 data: 래스터 mask/dt 를 뺀다(toSW·fromSW·to2D·to3D 만 필요). 이 data 로 만든 객체의 inside/boundaryDist 는 오류.
export function lightData(L) {
  const d = L.data ?? L, { mask, dt, ...raster } = d.raster;
  return { ...d, raster };
}

export function lineFromData(data) {
  data = { ...data, pts: revive(data.pts, Float64Array), raster: { ...data.raster, mask: revive(data.raster.mask, Uint8Array), dt: revive(data.raster.dt, Float32Array) } };
  const { kind, closed, frame: F, raster: R, width } = data;
  const needR = () => { if (!R.mask || !R.dt) throw new Error('래스터 없음(lightData) — inside/boundaryDist 는 전체 data 에서만 쓸 수 있음'); };
  const inside = (x, y) => { needR(); const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
  const boundaryDist = (x, y) => { needR(); const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); if (i < 0 || j < 0 || i >= R.nx || j >= R.ny) return 0; return Math.max(0, (R.dt[j * R.nx + i] - 0.5) * R.cell); };
  // toSW 는 영역 밖 점에도 값을 낸다(가장 가까운 중심선 점 기준; 열린 경로는 s 를 [0,L] 로 자름). 영역 판정은 호출 쪽이 inside() 로 한다(tally 가 그렇게 함).
  // 꺾인 모서리 안쪽(오목한 쪽 꼭짓점에서 W/2 이내)은 여러 (s,w) 가 같은 점에 대응한다 → fromSW→toSW 왕복이 원래 (s,w) 로 돌아오지 않을 수 있다(가장 가까운 구간을 고름).
  // 급한 굽힘(굽힘 반경 ≤ W: 머리핀, R10 S자 등)도 같다: 안쪽(곡률 중심 쪽) |w| 가 국소 굽힘 반경에 가까우면 법선들이 모여 s 가 모호해진다
  // (|w| ≥ 0.8 × 국소 반경 영역은 (s,w) 정확도를 보장하지 않음). 바깥쪽과 |w| 가 작은 곳은 정상.
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
      let best = Infinity, bs = 0, bw = 0;
      const test = (i) => {
        const [x1, y1, x2, y2] = seg(i), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)), fx = x1 + t * dx, fy = y1 + t * dy, dd = Math.hypot(x - fx, y - fy);
        if (dd < best) { best = dd; bs = cum[i] + t * Math.sqrt(l2); bw = Math.sign(dx * (y - fy) - dy * (x - fx)) * dd; }
      };
      const bi = Math.floor(x / B), bj = Math.floor(y / B);
      let done = false;
      for (let r = 0; r < 64 && !done; r++) {
        for (let a = bi - r; a <= bi + r; a++) for (let c = bj - r; c <= bj + r; c++) {
          if (Math.max(Math.abs(a - bi), Math.abs(c - bj)) !== r) continue;
          for (const i of buckets.get(key(a, c)) ?? []) test(i);
        }
        if (best <= (r - 1) * B) done = true;
      }
      if (!done) for (let i = 0; i < segs; i++) test(i);   // 멀리 떨어진 점: 전수 탐색(조용한 (0,0) 방지)
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
  let R = rasterize(tris), topo = cleanTopology(R), dt = distanceTransform(R), W0 = ridgeWidth(R, dt);
  {   // 셀 상한 W/60(폭 방향 60 셀 이상) — 단 래스터 ≤ 4M 셀
    const want = Math.max(0.05, W0 / 60), ex = R.bounds[2] - R.bounds[0], ey = R.bounds[3] - R.bounds[1];
    if (R.cell > want * 1.001 && (ex / want + 7) * (ey / want + 7) <= 4e6) { R = rasterize(tris, want); topo = cleanTopology(R); dt = distanceTransform(R); W0 = ridgeWidth(R, dt); }
  }
  const cell = R.cell;
  // 구멍 가르기: 등가 지름 2·√(넓이/π) ≥ 띠 폭 W(능선 중앙값)인 구멍만 고리의 안쪽('닫힌 고리')으로 센다. 더 작은 구멍(나사 보스 등)은 중심선용 마스크에서만 메우고
  // (세선화·단면 중점), 원래 마스크는 inside()/boundaryDist() 에 그대로 둔다 → 집계는 구멍을 뺀다.
  const maskC = Uint8Array.from(R.mask), small = new Set(); let openings = 0;
  for (const h of topo.holes) { if (2 * Math.sqrt((h.size * cell * cell) / Math.PI) >= W0) openings++; else small.add(h.id); }
  if (openings > 1) throw new Error(ERR_SHAPE);
  if (small.size) for (let k = 0; k < maskC.length; k++) if (!maskC[k] && small.has(topo.lab[k])) maskC[k] = 1;
  const closed = openings === 1, RC = small.size ? { ...R, mask: maskC } : R, dtC = small.size ? distanceTransform(RC) : dt;
  let area = 0, dtMax = 0; for (let k = 0; k < dtC.length; k++) if (maskC[k]) { area++; if (dtC[k] > dtMax) dtMax = dtC[k]; }
  area *= cell * cell;
  if (area / (2 * dtMax * cell) ** 2 < 1.5) throw new Error(ERR_SHORT);   // 가로세로비 < 1.5: 판·덩어리·너무 짧은 조각(세선화 전에 거름)
  const sk = thin(RC);
  minimal8(sk, R.nx, R.ny);
  prune(sk, R.nx, R.ny, dtC, 1.2, dtMax);
  let { path, branched } = orderPath(sk, R.nx, R.ny, closed);
  if (!closed) path = trimEnds(path, R.nx, dtC);
  const widths = path.map((k) => 2 * dtC[k] * cell).sort((a, b) => a - b), width = widths[widths.length >> 1] ?? 0;
  const raw = []; for (const k of path) raw.push(R.x0 + ((k % R.nx) + 0.5) * cell, R.y0 + (((k / R.nx) | 0) + 0.5) * cell);
  let pts = smoothResample(raw, closed, 0.25 / cell, 0.25);
  // 두 번: 첫 결과(골격보다 곧은 중심선)의 법선으로 다시 재면 넓어진 구간 가장자리의 기운 단면이 없어진다
  // 마지막은 국소 2차 회귀(±1.5mm): 단면 중점의 ½셀 잡음을 지워 접선(toSW/fromSW 의 w 방향)을 안정시키되, 이동평균과 달리 호 반경을 줄이지 않는다
  for (let pass = 0; pass < 2; pass++) pts = smoothResample(recenter(pts, closed, RC, dtC), closed, pass ? 1 : 3, 0.25);
  pts = quadSmooth(pts, closed, 6);
  const { inside } = rasterOps(RC, dtC);
  let ext0 = [], ext1 = [];
  if (!closed) {
    // 다듬은 끝에서 영역 끝까지 연장: 0.25mm 씩 나아가며 그 자리 단면 중점으로 다시 맞춘다(호·테이퍼의 휨을 따라감).
    // 단면이 띠 폭보다 뚜렷이 길면(끝 모서리 부근) 그 뒤로는 마지막 접선으로 곧게 간다. 마지막은 반 셀 단위로 경계까지.
    const midAt = (x, y, nx_, ny_, lim) => {
      const st = cell / 4, t = [0, 0];
      for (const [q, s] of [[0, 1], [1, -1]]) {
        let u = 0; while (u + st <= lim && inside(x + s * (u + st) * nx_, y + s * (u + st) * ny_)) u += st;
        if (u + st > lim) return null;
        let lo = u, hi = u + st; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (inside(x + s * m * nx_, y + s * m * ny_)) lo = m; else hi = m; }   // 경계(셀 모서리)까지 이분
        t[q] = (lo + hi) / 2;
      }
      return [t[0] + t[1], (t[0] - t[1]) / 2];
    };
    const extend = (back) => {
      const n = pts.length / 2, m = Math.min(n - 1, 4), k0 = back ? n - 1 : 0, k1 = back ? n - 1 - m : m;
      let tx = pts[2 * k0] - pts[2 * k1], ty = pts[2 * k0 + 1] - pts[2 * k1 + 1]; let l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      let x = pts[2 * k0], y = pts[2 * k0 + 1]; const add = [], hist = [];   // hist: 접선 기준선(2mm)용 최근 점
      for (let q = Math.min(n - 1, 8); q >= 1; q--) { const k = back ? n - 1 - q : q; hist.push(pts[2 * k], pts[2 * k + 1]); }
      const w0 = midAt(x, y, -ty, tx, 4 * width + 4 * cell)?.[0] ?? width, lim = w0 + 2 * cell;
      for (let q = 0; q < 1e5; q++) {
        const x2 = x + 0.25 * tx, y2 = y + 0.25 * ty; if (!inside(x2, y2)) break;
        const c = midAt(x2, y2, -ty, tx, lim);
        if (!c || c[0] > 1.15 * w0 + 2 * cell || c[0] / 2 - Math.abs(c[1]) < 0.475 * w0 - cell) break;   // 단면이 끝면에 걸려 짧아지면(또는 끝 모서리에서 길어지면) 곧게
        // 가로 보정은 한 걸음에 ±max(셀, 0.05) 로 제한: 끝면에 걸린 단면(크게 치우침)이나 가장자리 잡음이 방향을 꺾지 못하게
        const cl = Math.max(cell, 0.05), u = Math.max(-cl, Math.min(cl, c[1]));
        const x3 = x2 - u * ty, y3 = y2 + u * tx; if (!inside(x3, y3)) break;
        hist.push(x, y); x = x3; y = y3; add.push(x, y);
        // 단면 중점의 양자화 잡음(±½셀)이 방향을 흔들지 않도록 2mm 전 점과 이은 방향을 쓴다
        // 끝 접선 = 최근 1mm 현의 방향 + 그 앞 1mm 현과의 차이의 절반(굽은 끝에서 현 방향이 뒤처지는 것 보정)
        const H = hist.length, p1x = hist[H - 8], p1y = hist[H - 7], p2x = hist[H - 16], p2y = hist[H - 15];
        if (p2x !== undefined) {
          const a1 = Math.atan2(y - p1y, x - p1x), a2 = Math.atan2(p1y - p2y, p1x - p2x), d = Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2)), th = a1 + d / 2;
          tx = Math.cos(th); ty = Math.sin(th);
        }
      }
      // 끝: 반 셀씩 나아간 뒤 마지막 안쪽~첫 바깥 사이를 이분해 마스크 경계(셀 모서리)를 찾는다 — 양 끝 같은 규칙
      for (let q = 1; q < 1e6; q++) { const x2 = x + (tx * cell) / 2, y2 = y + (ty * cell) / 2; if (!inside(x2, y2)) break; x = x2; y = y2; if (q % Math.max(1, Math.round(0.5 / cell)) === 0) add.push(x, y); }
      let lo = 0, hi = cell / 2; for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (inside(x + tx * m, y + ty * m)) lo = m; else hi = m; }
      add.push(x + tx * hi, y + ty * hi);
      return add;
    };
    ext1 = extend(true); ext0 = extend(false);
    const rev = []; for (let i = ext0.length - 2; i >= 0; i -= 2) rev.push(ext0[i], ext0[i + 1]);
    pts = endSmooth([...rev, ...pts, ...ext1], rev.length / 2 + 8, ext1.length / 2 + 8, 1);
  }
  const P = Float64Array.from(pts), n = P.length / 2;
  const data = { kind: 'path', closed, branched, frame: F, hMin, width, raster: { x0: R.x0, y0: R.y0, cell, nx: R.nx, ny: R.ny, mask: R.mask, dt, bounds: R.bounds }, pts: P };
  let result = null;
  if (!closed) {   // 직선 맞춤
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += P[2 * i]; my += P[2 * i + 1]; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const x = P[2 * i] - mx, y = P[2 * i + 1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), tx = Math.cos(th), ty = Math.sin(th);
    let dev = 0, ss = 0; for (let i = 0; i < n; i++) { const e = Math.abs(-ty * (P[2 * i] - mx) + tx * (P[2 * i + 1] - my)); dev = Math.max(dev, e); ss += e * e; }
    const tol = Math.max(0.05, cell);
    if (Math.sqrt(ss / n) <= tol && dev <= 3 * tol) {   // RMS ≤ tol, 최대 ≤ 3·tol (가장자리 잡음에 견딤)
      const sgn = (P[2 * n - 2] - P[0]) * tx + (P[2 * n - 1] - P[1]) * ty >= 0 ? 1 : -1, t2 = [sgn * tx, sgn * ty];
      const s0 = (P[0] - mx) * t2[0] + (P[1] - my) * t2[1], s1 = (P[2 * n - 2] - mx) * t2[0] + (P[2 * n - 1] - my) * t2[1];
      result = lineFromData({ ...data, kind: 'line', a: [mx + s0 * t2[0], my + s0 * t2[1]], t: t2, length: s1 - s0 });
    }
  }
  if (!result) {   // 원 맞춤(Kasa) — 열린 호는 맞춘 뒤 원을 따라 영역 끝까지 늘린다
    const C = pts, m = C.length / 2;
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (let i = 0; i < m; i++) { const x = C[2 * i], y = C[2 * i + 1], z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, m]], b = [Sxz, Syz, Sz];
    const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det3(A);
    if (m >= 3 && Math.abs(D) > 1e-12) {
      const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? b[i] : v)));
      const cx = det3(col(0)) / D / 2, cy = det3(col(1)) / D / 2, r = Math.sqrt(det3(col(2)) / D + cx * cx + cy * cy);
      let rms = 0; for (let i = 0; i < m; i++) rms += (Math.hypot(C[2 * i] - cx, C[2 * i + 1] - cy) - r) ** 2;
      rms = Math.sqrt(rms / m);
      const ang = (i) => Math.atan2(C[2 * i + 1] - cy, C[2 * i] - cx);
      const dir = Math.sin(ang(1) - ang(0)) >= 0 ? 1 : -1;
      let arc = 0; for (let i = 1; i < m; i++) { const d = ang(i) - ang(i - 1); arc += dir * Math.atan2(Math.sin(d), Math.cos(d)); }
      if (Number.isFinite(r) && rms <= Math.max(0.1, cell) && (closed || arc >= Math.PI / 6)) {
        let th0 = ang(0), len = 2 * Math.PI * r;
        if (!closed) {
          const dA = cell / 2 / r, on = (th) => inside(cx + r * Math.cos(th), cy + r * Math.sin(th));
          let a0 = 0; while (a0 < Math.PI && on(th0 - dir * (a0 + dA))) a0 += dA;
          let a1 = 0; while (a1 < Math.PI && on(th0 + dir * (arc + a1 + dA))) a1 += dA;
          // 경로 끝점은 이미 경계(반 셀 보정 포함) — 원 위에서 그 너머 안쪽으로 남은 부분만 더한다
          th0 -= dir * a0; len = (arc + a0 + a1) * r;
        }
        if (len < 2 * Math.PI * r) result = lineFromData({ ...data, kind: 'circle', c: [cx, cy], r, th0, dir, length: len });
        else if (closed) result = lineFromData({ ...data, kind: 'circle', c: [cx, cy], r, th0, dir, length: len });
      }
    }
  }
  result ??= lineFromData(data);
  if (area / (width * result.length) > 2) throw new Error(ERR_SHAPE);
  return result;
}
