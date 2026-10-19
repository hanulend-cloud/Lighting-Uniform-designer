// 삼각형 메쉬(같은 자리 정점은 위치로 합침) → 꿰맨 솔리드 → STEP 문자열. P4 ③ 목업용(평면 삼각형 그대로 — 곡면 맞춤 없음)
import { pnt, triFace, sewToSolid, shapesToStepText } from './oc-build.js';

export function meshToStepText(oc, mesh) {
  const P = mesh.positions, T = mesh.triangles, pts = new Map();
  const at = (i) => {
    const k = `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`;
    if (!pts.has(k)) pts.set(k, pnt(oc, P[3 * i], P[3 * i + 1], P[3 * i + 2]));
    return pts.get(k);
  };
  const faces = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = at(T[t]), b = at(T[t + 1]), c = at(T[t + 2]);
    if (a === b || b === c || c === a) continue;   // 퇴화 삼각형
    faces.push(triFace(oc, a, b, c));
  }
  return shapesToStepText(oc, [sewToSolid(oc, faces)]);   // 이름 인자 없음(oc-build.js:135) — name 은 파일 이름에만 씀
}
