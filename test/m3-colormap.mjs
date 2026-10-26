// 관측면 색지도: node test/m3-colormap.mjs
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { tallyGeometry } from '../src/engine/mech3d/tally.js';
import { ramp, NO_DATA, extractFaces, subdivide, cellIndex, vertexCells, cellColors, buildObsOverlay } from '../src/ui/m3/colormap.js';
import { topFaceMesh, rectTris, boxMesh, ok, done } from './mech3d-util.mjs';

const top = topFaceMesh(rectTris(0, 0, 100, 6), 2), faces = [{ part: 0, face: 1 }];
const line = recognizeLine([top], faces, [0, 0, 1]), obs = { faces, dir: [0, 0, 1], cone: 90, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.8 };
const G = tallyGeometry(line, obs);
const area = (m) => {
  let a = 0; const P = m.positions, T = m.triangles, p = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  for (let t = 0; t < T.length; t += 3) {
    const A = p(T[t]), B = p(T[t + 1]), C = p(T[t + 2]), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
};
const maxEdge = (m) => {
  let e = 0; const P = m.positions, T = m.triangles, d = (i, j) => Math.hypot(P[3 * i] - P[3 * j], P[3 * i + 1] - P[3 * j + 1], P[3 * i + 2] - P[3 * j + 2]);
  for (let t = 0; t < T.length; t += 3) e = Math.max(e, d(T[t], T[t + 1]), d(T[t + 1], T[t + 2]), d(T[t + 2], T[t]));
  return e;
};

ok(ramp(0).every((v, k) => Math.abs(v - [0x20, 0x30, 0x6e][k] / 255) < 1e-12) && ramp(2).every((v, k) => Math.abs(v - [0xe0, 0x53, 0x2a][k] / 255) < 0.01), 'ramp: 0 = 남색, 1 이상 = 주황(시안 색 막대)');
{ const f = extractFaces(boxMesh(0, 0, 0, 10, 10, 10), new Set([1]));
  ok(f.triangles.length === 6 && f.positions.length === 12 && [0, 1, 2, 3].every((v) => f.positions[3 * v + 2] === 10), 'extractFaces: +z 면 = 삼각형 2개·정점 4개'); }
{ const m = extractFaces(top, new Set([1])), s = subdivide(m, 0.5), c = subdivide(m, 0.01, 1000);
  ok(Math.abs(area(s) - 600) < 0.01 && maxEdge(s) <= 0.5 + 1e-6 && s.triangles.length / 3 === 2 * 201 * 201, `subdivide: 면적 ${area(s).toFixed(4)} 보존, 최대 변 ${maxEdge(s).toFixed(4)} ≤ 0.5, 삼각형 ${s.triangles.length / 3}`);
  ok(c.triangles.length / 3 <= 1000 && c.triangles.length / 3 >= 2 && Math.abs(area(c) - 600) < 0.01, `subdivide 상한: ${c.triangles.length / 3} ≤ 1000`); }
{   // subdivide 상한: 원본 삼각형이 이미 상한보다 많으면 세분하지 않음(n=1), 가느다란 삼각형 하나가 n² 로 폭주하지 않음
  const many = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: Uint32Array.from(Array.from({ length: 30 }, () => [0, 1, 2]).flat()) };
  const r = subdivide(many, 0.01, 10);
  ok(r.triangles.length / 3 === 30, `원본 30개 > 상한 10 → 세분 없음(${r.triangles.length / 3}개)`);
  const sliver = { positions: Float32Array.from([0, 0, 0, 100, 0, 0, 0, 0.01, 0]), triangles: Uint32Array.from([0, 1, 2]) };
  const sl = subdivide(sliver, 0.5, 1000);
  ok(sl.triangles.length / 3 <= 1000 && sl.triangles.length / 3 >= 1, `가느다란 삼각형: ${sl.triangles.length / 3}개 ≤ 1000`);
}
{   // 유효 칸 중심 정점 → 그 칸(값 = 집계 지도), 폭 밖 정점 → 같은 s 행의 가장 가까운 유효 칸
  const pts = [], want = [];
  for (let i = 0; i < G.ns; i++) for (let j = 0; j < G.nw; j++) {
    const k = i * G.nw + j; if (!G.valid[k]) continue;
    const [x, y] = line.fromSW((i + 0.5) * G.ds, G.w0 + (j + 0.5) * G.cell); pts.push(...line.to3D(x, y, 0)); want.push(k);
  }
  const cells = vertexCells(Float32Array.from(pts), line, G), map = Float64Array.from({ length: G.ns * G.nw }, (_, k) => k + 1);
  ok(want.every((k, v) => cells[v] === k && map[cells[v]] === k + 1 && cellIndex(G, (Math.floor(k / G.nw) + 0.5) * G.ds, G.w0 + ((k % G.nw) + 0.5) * G.cell) === k), `유효 칸 중심 ${want.length}개 → 같은 칸, 값 = 집계 지도`);
  const i = 50; let jmax = -1; for (let j = 0; j < G.nw; j++) if (G.valid[i * G.nw + j]) jmax = j;
  const [x, y] = line.fromSW((i + 0.5) * G.ds, G.w0 + (G.nw - 0.5) * G.cell), out = vertexCells(Float32Array.from(line.to3D(x, y, 0)), line, G);
  ok(jmax >= 0 && out[0] === i * G.nw + jmax && cellIndex(G, -1, 0) === -1, `폭 밖 정점 → 행 ${i} 의 가장 가까운 유효 칸(w ${jmax}), 범위 밖 s → −1`);
  let kmax = -1; for (let k = 0; k < map.length; k++) if (G.valid[k]) kmax = k;
  const col = cellColors(Int32Array.from([kmax, -1]), map, G.valid), r1 = ramp(1);
  ok([0, 1, 2].every((c) => Math.abs(col[c] - r1[c]) < 1e-6 && Math.abs(col[3 + c] - NO_DATA[c]) < 1e-6), 'cellColors: 최대 칸 = 색 막대 끝, 칸 없음 = 회색');
}
{ const ov = buildObsOverlay([top], faces, line, G);
  ok(ov.triangles.length > 0 && ov.cells.length === ov.positions.length / 3 && Array.from(ov.cells).every((c) => c >= 0 && G.valid[c]) && Math.abs(ov.positions[2] - 2.01) < 1e-5,
    `덧그림 메쉬: 삼각형 ${ov.triangles.length / 3}, 모든 정점이 유효 칸, 관측 방향으로 0.01mm 앞(가상 검출면)`); }
done();
