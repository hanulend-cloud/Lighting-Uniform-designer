// 3D 기구 모드 테스트 공용 — 바깥 법선(반시계) 상자 메쉬, 시드 난수, PASS/FAIL 집계.
export function boxMesh(x0, y0, z0, dx, dy, dz) {
  const P = [], T = [], F = [];
  const quad = (a, b, c, d, f) => { const i = P.length / 3; P.push(...a, ...b, ...c, ...d); T.push(i, i + 1, i + 2, i, i + 2, i + 3); F.push(f, f); };
  const x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0);   // −z
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1);   // +z
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 2);   // −y
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 3);   // +y
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 4);   // −x
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 5);   // +x
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 6 };
}
export function rng(seed = 1) {   // mulberry32 — 테스트 입력 생성 전용(통계 품질 불필요)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let fails = 0;
export const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
export const done = () => { if (fails) { console.log(`${fails} FAIL`); process.exit(1); } console.log('all PASS'); };

// 여러 닫힌 껍질을 한 부품으로(면 번호 이어 붙임)
export function mergeMeshes(list) {
  let nV = 0, nT = 0, nF = 0;
  for (const m of list) { nV += m.positions.length; nT += m.triangles.length; }
  const positions = new Float32Array(nV), triangles = new Uint32Array(nT), faceIds = new Uint32Array(nT / 3);
  let v = 0, t = 0;
  for (const m of list) {
    positions.set(m.positions, v);
    for (let k = 0; k < m.triangles.length; k++) triangles[t + k] = m.triangles[k] + v / 3;
    for (let k = 0; k < m.faceIds.length; k++) faceIds[t / 3 + k] = m.faceIds[k] + nF;
    v += m.positions.length; t += m.triangles.length; nF += m.faceCount;
  }
  return { positions, triangles, faceIds, faceCount: nF };
}
export const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
export const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
// 평면 다각형 띠(윗면만, z) — 관측면 테스트용. tris: [[x,y],[x,y],[x,y]] 목록, 모두 face 1
export function topFaceMesh(tris, z = 2) {
  const P = [], T = [], F = [];
  for (const tr of tris) { const i = P.length / 3; for (const [x, y] of tr) P.push(x, y, z); T.push(i, i + 1, i + 2); F.push(1); }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 2 };
}
export const rectTris = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]];
export function annulusTris(cx, cy, r0, r1, n = 256) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
    const p = (r, t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    out.push([p(r0, a), p(r1, a), p(r1, b)], [p(r0, a), p(r1, b), p(r0, b)]);
  }
  return out;
}
