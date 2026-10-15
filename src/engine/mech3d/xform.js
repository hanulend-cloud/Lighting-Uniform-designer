// 메쉬 강체 변환 — LED STEP 위치 맞춤(spec §4.1: 이동 x,y,z · 축별 회전 각도). 회전 = Rz·Ry·Rx (deg), 이동은 회전 뒤.
export function eulerMatrix([rx, ry, rz]) {
  const [a, b, c] = [rx, ry, rz].map((d) => (d * Math.PI) / 180);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
}
export function applyPoint(R, p, t = [0, 0, 0]) {
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]];
}
export function applyDir(R, d) { return applyPoint(R, d); }
export function transformMesh(m, offset = [0, 0, 0], rot = [0, 0, 0]) {
  if (!offset.some(Boolean) && !rot.some(Boolean)) return m;
  const R = eulerMatrix(rot), P = new Float32Array(m.positions.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = applyPoint(R, [m.positions[i], m.positions[i + 1], m.positions[i + 2]], offset);
    P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2];
  }
  const { bvh, ...rest } = m;   // 위치가 바뀌었으므로 캐시된 BVH 는 버림
  return { ...rest, positions: P };
}

// 발광 위치·방향을 메쉬와 같은 강체 변환으로 옮긴다(위치 = 회전 뒤 이동, 방향 = 회전만). findEmitters(변환된 메쉬) 와 같은 결과.
export function transformEmitters(emitters, offset = [0, 0, 0], rot = [0, 0, 0]) {
  const R = eulerMatrix(rot);
  return emitters.map((e) => ({ ...e, pos: applyPoint(R, e.pos, offset), axis: applyDir(R, e.axis), xAxis: e.xAxis ? applyDir(R, e.xAxis) : e.xAxis }));
}
