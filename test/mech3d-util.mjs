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
