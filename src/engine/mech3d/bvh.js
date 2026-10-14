// 삼각형 메쉬 BVH — spec 2026-10-14 §3.1·§6.1. 중앙값 분할(최장 축), 잎 ≤ 4 삼각형.
// box: 노드별 [xmin,ymin,zmin,xmax,ymax,zmax], meta: 노드별 [잎이면 시작 / 내부면 오른쪽 자식, 잎 삼각형 수(0=내부)].
// 왼쪽 자식은 항상 id+1(깊이 우선 배치). 교차는 양면(앞·뒤 모두) — MC 추적은 매질 안팎을 모두 오간다.

export function buildBvh(positions, triangles, leafSize = 4) {
  const nT = triangles.length / 3;
  const lo = new Float32Array(nT * 3), hi = new Float32Array(nT * 3), c = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j < 3; j++) { const v = positions[triangles[t * 3 + j] * 3 + k]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo[t * 3 + k] = mn; hi[t * 3 + k] = mx; c[t * 3 + k] = (mn + mx) / 2;
  }
  const order = new Uint32Array(nT);
  for (let i = 0; i < nT; i++) order[i] = i;
  const box = [], meta = [];
  function build(s, e) {
    const id = meta.length / 2;
    const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    const ca = [Infinity, Infinity, Infinity], cb = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        if (lo[t * 3 + k] < a[k]) a[k] = lo[t * 3 + k];
        if (hi[t * 3 + k] > b[k]) b[k] = hi[t * 3 + k];
        if (c[t * 3 + k] < ca[k]) ca[k] = c[t * 3 + k];
        if (c[t * 3 + k] > cb[k]) cb[k] = c[t * 3 + k];
      }
    }
    box.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    meta.push(s, e - s);
    if (e - s <= leafSize) return id;
    let ax = 0;
    for (let k = 1; k < 3; k++) if (cb[k] - ca[k] > cb[ax] - ca[ax]) ax = k;
    if (!(cb[ax] - ca[ax] > 0)) return id;   // 중심이 모두 같음 → 잎
    const sub = Array.from(order.subarray(s, e)).sort((p, q) => c[p * 3 + ax] - c[q * 3 + ax]);
    order.set(sub, s);
    const m = (s + e) >> 1;
    build(s, m);
    const r = build(m, e);
    meta[id * 2] = r; meta[id * 2 + 1] = 0;
    return id;
  }
  build(0, nT);
  return { box: Float32Array.from(box), meta: Int32Array.from(meta), order, positions, triangles };
}

// Möller–Trumbore(양면). 적중 거리 t(음수 가능) 또는 −1(평행·빗나감). 마지막 적중의 무게중심 좌표는 hitUV 에.
export const hitUV = { u: 0, v: 0 };
export function hitTriangle(P, T, t, ox, oy, oz, dx, dy, dz) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const sx = ox - P[a], sy = oy - P[a + 1], sz = oz - P[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  hitUV.u = u; hitUV.v = v;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// 가장 가까운 적중 { t, tri, u, v } (tMin ≤ t < tMax) 또는 null. tri 는 원래 삼각형 번호. skipTri·skipTri2: 제외할 삼각형(직전 적중 면, 맞붙은 짝 면).
export function intersectRay(bvh, ox, oy, oz, dx, dy, dz, tMin = 1e-6, tMax = Infinity, skipTri = -1, skipTri2 = -1) {
  const { box, meta, order, positions: P, triangles: T } = bvh;
  if (!order.length) return null;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const stack = [0];
  let best = tMax, hit = -1, hu = 0, hv = 0;
  while (stack.length) {
    const n = stack.pop(), b = n * 6;
    let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
    let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz;
    if (w0 > w1) { const s = w0; w0 = w1; w1 = s; }
    // NaN(0·∞)은 비교가 모두 거짓 → 노드를 버리지 않는다(보수적)
    const near = Math.max(t0, u0, w0), far = Math.min(t1, u1, w1);
    if (far < near || far < tMin || near > best) continue;
    const cnt = meta[n * 2 + 1];
    if (cnt) {
      for (let i = meta[n * 2], e = i + cnt; i < e; i++) {
        const tri = order[i];
        if (tri === skipTri || tri === skipTri2) continue;
        const s = hitTriangle(P, T, tri, ox, oy, oz, dx, dy, dz);
        if (s >= tMin && s < best) { best = s; hit = tri; hu = hitUV.u; hv = hitUV.v; }
      }
    } else {
      stack.push(meta[n * 2], n + 1);   // 오른쪽 먼저 쌓아 왼쪽부터 방문
    }
  }
  return hit < 0 ? null : { t: best, tri: hit, u: hu, v: hv };
}

// 외곽이 [lo, hi] 박스와 겹치는 잎의 삼각형 번호들(후보 — 삼각형 자체 외곽은 호출자가 판단)
export function queryBox(bvh, lo, hi, out = []) {
  const { box, meta, order } = bvh;
  out.length = 0;
  if (!order.length) return out;
  const stack = [0];
  while (stack.length) {
    const n = stack.pop(), b = n * 6;
    if (box[b] > hi[0] || box[b + 3] < lo[0] || box[b + 1] > hi[1] || box[b + 4] < lo[1] || box[b + 2] > hi[2] || box[b + 5] < lo[2]) continue;
    const cnt = meta[n * 2 + 1];
    if (cnt) for (let i = meta[n * 2], e = i + cnt; i < e; i++) out.push(order[i]);
    else stack.push(meta[n * 2], n + 1);
  }
  return out;
}
