// LED 직접 배치 — spec 2026-10-14 §4.2. 관측 라인(line.js) 위 s 위치를 PCB(깊이 평면 또는 기구 부품 면)로 내린다.
// pcb: { kind:'depth', depth }(관측면 최저점에서 관측 방향 반대로 depth mm) | { kind:'face', part, face }(rt.parts[part] BVH 로 투영)
// 'face' 모드 + side 'direct': 발광 축 = 맞은 삼각형의 바깥 법선(관측 쪽으로 향하게 뒤집음) — 기울어진 PCB 면은 기울어진 채 발광.
// side: 'direct'(관측 방향) | 'left' | 'right'(라인 진행 방향 기준 측면 발광) — xAxis 는 라인 접선(패키지 가로축).
import { intersectRay } from './bvh.js';

export function ledSPositions(line, count, pitch) {
  if (!Number.isInteger(count) || count < 1) throw new Error('LED 개수는 1 이상의 정수');
  const L = line.length;
  if (line.closed) return Array.from({ length: count }, (_, i) => (i * L) / count);
  if (pitch > 0) {
    if ((count - 1) * pitch > L + 1e-9) throw new Error(`배치 길이 ${((count - 1) * pitch).toFixed(1)}mm 가 라인 길이 ${L.toFixed(1)}mm 보다 김`);
    return Array.from({ length: count }, (_, i) => L / 2 + (i - (count - 1) / 2) * pitch);
  }
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * L) / count);
}

export function manualLeds(line, { count, pitch = 0, side = 'direct', pcb }, rt = null) {
  if (pcb.kind === 'depth' && !(pcb.depth > 0)) throw new Error('PCB 깊이는 0 보다 커야 함');
  const F = line.frame, out = [];
  for (const s of ledSPositions(line, count, pitch)) {
    const [x, y] = line.fromSW(s, 0), [tx, ty] = line.tangentAt(s);
    let pos, hitN = null;
    if (pcb.kind === 'depth') pos = line.to3D(x, y, -pcb.depth);
    else {
      const top = line.to3D(x, y, 1e4), m = rt?.parts?.[pcb.part];
      if (!m) throw new Error('PCB 면 부품을 찾을 수 없음');
      const h = intersectRay(m.bvh, top[0], top[1], top[2], -F.d[0], -F.d[1], -F.d[2], 0, Infinity);
      if (!h || m.faceIds[h.tri] !== pcb.face) throw new Error(`s=${s.toFixed(1)}mm 아래에 선택한 PCB 면이 없음`);
      const a = m.triangles[3 * h.tri] * 3, b = m.triangles[3 * h.tri + 1] * 3, c = m.triangles[3 * h.tri + 2] * 3, P = m.positions;
      const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      hitN = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(...hitN) || 1, sg = hitN[0] * F.d[0] + hitN[1] * F.d[1] + hitN[2] * F.d[2] < 0 ? -1 : 1;
      hitN = hitN.map((v) => (sg * v) / nl);
      pos = [top[0] - h.t * F.d[0], top[1] - h.t * F.d[1], top[2] - h.t * F.d[2]];
    }
    const T3 = [tx * F.u[0] + ty * F.v[0], tx * F.u[1] + ty * F.v[1], tx * F.u[2] + ty * F.v[2]];
    const left = [F.d[1] * T3[2] - F.d[2] * T3[1], F.d[2] * T3[0] - F.d[0] * T3[2], F.d[0] * T3[1] - F.d[1] * T3[0]];
    const axis = side === 'left' ? left : side === 'right' ? left.map((v) => -v) : hitN ?? F.d.slice();
    out.push({ s, pos, axis, xAxis: T3 });
  }
  return out;
}

// 가상 PCB(깊이 지정): 관측 라인 외곽 + margin, 두께 1mm, 윗면 = LED 높이(관측면 최저점 − depth)
export function pcbPlaneMesh(line, depth, margin = 10) {
  const [bx0, by0, bx1, by1] = line.data.raster.bounds;   // 관측면 투영의 정확한 외곽
  const x0 = bx0 - margin, y0 = by0 - margin, x1 = bx1 + margin, y1 = by1 + margin;
  const c = (x, y, h) => line.to3D(x, y, h), top = -depth, bot = -depth - 1;
  const V = [c(x0, y0, bot), c(x1, y0, bot), c(x1, y1, bot), c(x0, y1, bot), c(x0, y0, top), c(x1, y0, top), c(x1, y1, top), c(x0, y1, top)];
  const Q = [[0, 3, 2, 1, 0], [4, 5, 6, 7, 1], [0, 1, 5, 4, 2], [3, 7, 6, 2, 3], [0, 4, 7, 3, 4], [1, 2, 6, 5, 5]];   // 바깥 반시계(관측 프레임 오른손계)
  const P = [], T = [], Fd = [];
  for (const [a, b, cc, d, f] of Q) { const i = P.length / 3; for (const k of [a, b, cc, d]) P.push(...V[k]); T.push(i, i + 1, i + 2, i, i + 2, i + 3); Fd.push(f, f); }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(Fd), faceCount: 6 };
}
