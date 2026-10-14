// 3D 기구 메쉬 유틸 — spec 2026-10-14 §3.1. 부품 메쉬 = { positions(Float32 xyz), triangles(Uint32), faceIds(삼각형별 B-rep 면 번호) }.

// 닫힌 메쉬의 부호 부피(발산정리). 바깥 법선(반시계)이면 양수.
export function meshVolume(positions, triangles) {
  const P = positions;
  let v = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
       - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
       + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

// 부품들을 하나의 추적용 메쉬로 결합 — 삼각형별 부품 번호(partOf)·면 번호(faceOf) 유지
export function combineParts(parts) {
  let nV = 0, nT = 0;
  for (const p of parts) { nV += p.positions.length / 3; nT += p.triangles.length / 3; }
  const positions = new Float32Array(nV * 3), triangles = new Uint32Array(nT * 3);
  const partOf = new Uint16Array(nT), faceOf = new Uint32Array(nT);
  let v0 = 0, t0 = 0;
  parts.forEach((p, i) => {
    positions.set(p.positions, v0 * 3);
    for (let k = 0; k < p.triangles.length; k++) triangles[t0 * 3 + k] = p.triangles[k] + v0;
    const n = p.triangles.length / 3;
    partOf.fill(i, t0, t0 + n);
    faceOf.set(p.faceIds, t0);
    v0 += p.positions.length / 3; t0 += n;
  });
  return { positions, triangles, partOf, faceOf };
}

// 외곽 [xmin, ymin, zmin, xmax, ymax, zmax]
export function bounds(positions) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k];
    if (v < b[k]) b[k] = v;
    if (v > b[k + 3]) b[k + 3] = v;
  }
  return b;
}
