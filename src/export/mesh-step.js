// 삼각형 메쉬(같은 자리 정점은 허용오차로 합침) → 꿰맨 솔리드 → STEP 문자열. P4 ③ 목업용(평면 삼각형 — 곡면 맞춤 없음, 같은 평면 삼각형은 합침)
import { pnt, triFace, sewMeshFaces, shapesToStepText } from './oc-build.js';
import { weld } from '../engine/mech3d/shape-opt.js';

export function meshToStepText(oc, mesh) {
  const P = mesh.positions, T = mesh.triangles, { id, rep } = weld(P), pts = new Map();
  const at = (c) => { let p = pts.get(c); if (!p) pts.set(c, (p = pnt(oc, rep[3 * c], rep[3 * c + 1], rep[3 * c + 2]))); return p; };
  const faces = [];
  let skipped = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = id[T[t]], b = id[T[t + 1]], c = id[T[t + 2]];
    if (a === b || b === c || c === a) { skipped++; continue; }
    const A = [rep[3 * a], rep[3 * a + 1], rep[3 * a + 2]], B = [rep[3 * b], rep[3 * b + 1], rep[3 * b + 2]], C = [rep[3 * c], rep[3 * c + 1], rep[3 * c + 2]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], w = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
    const cr = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    const e2 = Math.max(u[0] ** 2 + u[1] ** 2 + u[2] ** 2, v[0] ** 2 + v[1] ** 2 + v[2] ** 2, w[0] ** 2 + w[1] ** 2 + w[2] ** 2);
    if (cr / e2 < 1e-10) { skipped++; continue; }   // 퇴화(일직선) 삼각형
    try { faces.push(triFace(oc, at(a), at(b), at(c))); } catch { skipped++; }
  }
  for (const p of pts.values()) p.delete();   // 면이 좌표를 복사해 가짐
  const shape = sewMeshFaces(oc, faces);
  const text = shapesToStepText(oc, [shape]);   // 이름 인자 없음(oc-build.js:135) — name 은 파일 이름에만 씀
  shape.delete();
  return text;
}
