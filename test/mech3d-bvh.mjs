// BVH 광선/박스 질의 vs 전수 탐색: node test/mech3d-bvh.mjs
import { buildBvh, intersectRay, queryBox, hitTriangle } from '../src/engine/mech3d/bvh.js';
import { boxMesh, rng, ok, done } from './mech3d-util.mjs';

const R = rng(7);
// 무작위 삼각형 3000개(100mm 공간, 크기 ≤ 5mm)
const nT = 3000, P = new Float32Array(nT * 9), T = new Uint32Array(nT * 3);
for (let t = 0; t < nT; t++) {
  const cx = R() * 100, cy = R() * 100, cz = R() * 100;
  for (let j = 0; j < 3; j++) { P[t * 9 + j * 3] = cx + (R() - 0.5) * 5; P[t * 9 + j * 3 + 1] = cy + (R() - 0.5) * 5; P[t * 9 + j * 3 + 2] = cz + (R() - 0.5) * 5; T[t * 3 + j] = t * 3 + j; }
}
const bvh = buildBvh(P, T);
function brute(ox, oy, oz, dx, dy, dz, tMin, tMax) {
  let best = tMax, hit = -1;
  for (let t = 0; t < nT; t++) { const s = hitTriangle(P, T, t, ox, oy, oz, dx, dy, dz); if (s >= tMin && s < best) { best = s; hit = t; } }
  return hit < 0 ? null : { t: best, tri: hit };
}
let mism = 0, hits = 0;
for (let i = 0; i < 2000; i++) {
  const th = Math.acos(2 * R() - 1), ph = 2 * Math.PI * R();
  const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  if (i % 50 === 0) { d[0] = 0; d[1] = 0; d[2] = 1; }   // 축 평행 광선(역수 Infinity) 포함
  const o = [R() * 100, R() * 100, R() * 100];
  const a = intersectRay(bvh, ...o, ...d, 1e-6, 80), b = brute(...o, ...d, 1e-6, 80);
  if (!!a !== !!b || (a && (Math.abs(a.t - b.t) > 1e-4))) mism++;
  if (b) hits++;
}
ok(mism === 0 && hits > 200, `무작위 광선 2000개: 불일치 ${mism}, 적중 ${hits}`);

// 상자 내부에서 +x 로 쏘면 +x 면(면 번호 5)에 t=1 로 적중
const box = boxMesh(0, 0, 0, 2, 2, 2), bb = buildBvh(box.positions, box.triangles);
const h = intersectRay(bb, 1, 1, 1, 1, 0, 0);
ok(h && Math.abs(h.t - 1) < 1e-9 && box.faceIds[h.tri] === 5, `상자 내부 +x 광선: t=${h?.t}, 면 ${h && box.faceIds[h.tri]}`);
ok(intersectRay(bb, 1, 1, 1, 1, 0, 0, 1e-6, 0.5) === null, 'tMax 이내 적중 없음 → null');

// 박스 질의: 질의 박스와 외곽이 겹치는 삼각형을 모두 포함(누락 없음)
const lo = [40, 40, 40], hi = [60, 60, 60], got = new Set(queryBox(bvh, lo, hi));
let miss = 0;
for (let t = 0; t < nT; t++) {
  let inside = true;
  for (let k = 0; k < 3; k++) {
    const vs = [P[t * 9 + k], P[t * 9 + 3 + k], P[t * 9 + 6 + k]];
    if (Math.max(...vs) < lo[k] || Math.min(...vs) > hi[k]) inside = false;
  }
  if (inside && !got.has(t)) miss++;
}
ok(miss === 0 && got.size > 0, `박스 질의: 후보 ${got.size}, 누락 ${miss}`);
ok(buildBvh(new Float32Array(0), new Uint32Array(0)) && intersectRay(buildBvh(new Float32Array(0), new Uint32Array(0)), 0, 0, 0, 1, 0, 0) === null, '빈 메쉬 → null');
done();
