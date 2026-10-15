// LED STEP 해석 — spec 2026-10-14 §4.1 (P3 설계 결정 1·2).
// 같은 LED = 회전 불변량(면 수 동일, 부피·표면적 ±1%, 중심 최대거리 ±0.05mm) 이 같은 솔리드.
// 발광면: 동일 인스턴스는 면 순서가 같으므로 기준 면 번호를 쓰고 기술자(면적·중심거리·법선각)로 검증, 불일치면 기술자 탐색.
import { meshVolume } from './mesh.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function triGeom(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return { area: len(n) / 2, n, c: [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3] };
}

// 캐시는 메쉬가 불변이라고 가정한다(positions 를 제자리 수정하면 무효).
const statsCache = new WeakMap();
export function meshStats(m) {
  if (statsCache.has(m)) return statsCache.get(m);
  const P = m.positions, T = m.triangles;
  let area = 0; const c = [0, 0, 0];
  for (let t = 0; t < T.length / 3; t++) { const g = triGeom(P, T, t); area += g.area; for (let k = 0; k < 3; k++) c[k] += g.area * g.c[k]; }
  for (let k = 0; k < 3; k++) c[k] /= area || 1;
  let rmax = 0;
  for (let i = 0; i < P.length; i += 3) rmax = Math.max(rmax, Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]));
  const s = { area, volume: meshVolume(P, T), center: c, rmax, faceCount: m.faceCount };
  statsCache.set(m, s);
  return s;
}

// 면 정보: 면적, 면적 가중 중심, 바깥 법선(면적 가중 평균), 면 안 장축 방향(삼각형별 정확한 면적 가중 2차 모멘트의 주축).
// 거의 등방(정사각형·원 등)이면 xAxis = null. 면적벡터 합이 면적의 1e-3 미만(닫힌·원통형 면)이면 degenerate = true.
export function faceInfo(m, face) {
  const P = m.positions, T = m.triangles, tris = [];
  let area = 0; const c = [0, 0, 0], n = [0, 0, 0];
  for (let t = 0; t < T.length / 3; t++) {
    if (m.faceIds[t] !== face) continue;
    const g = triGeom(P, T, t);
    area += g.area; tris.push(t);
    for (let k = 0; k < 3; k++) { c[k] += g.area * g.c[k]; n[k] += g.n[k] / 2; }
  }
  if (!area) return null;
  for (let k = 0; k < 3; k++) c[k] /= area;
  const degenerate = len(n) < 1e-3 * area;
  const nn = unit(n), r = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(sub(r, nn.map((x) => x * dot(r, nn)))), e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
  let sxx = 0, syy = 0, sxy = 0;
  for (const t of tris) {
    const A = triGeom(P, T, t).area, q = [];
    for (let j = 0; j < 3; j++) { const v = T[t * 3 + j] * 3, d = sub([P[v], P[v + 1], P[v + 2]], c); q.push([dot(d, e1), dot(d, e2)]); }
    const sx = q[0][0] + q[1][0] + q[2][0], sy = q[0][1] + q[1][1] + q[2][1];
    sxx += (A / 12) * (q[0][0] ** 2 + q[1][0] ** 2 + q[2][0] ** 2 + sx * sx);
    syy += (A / 12) * (q[0][1] ** 2 + q[1][1] ** 2 + q[2][1] ** 2 + sy * sy);
    sxy += (A / 12) * (q[0][0] * q[0][1] + q[1][0] * q[1][1] + q[2][0] * q[2][1] + sx * sy);
  }
  const tot = sxx + syy;
  let xAxis = null;
  if (Math.abs(sxx - syy) >= 1e-3 * tot || Math.abs(sxy) >= 1e-3 * tot) {
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    xAxis = unit([Math.cos(th) * e1[0] + Math.sin(th) * e2[0], Math.cos(th) * e1[1] + Math.sin(th) * e2[1], Math.cos(th) * e1[2] + Math.sin(th) * e2[2]]);
  }
  return { area, c, n: nn, xAxis, degenerate };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

export function findLeds(parts, ref) {
  const s0 = meshStats(parts[ref]);
  const out = [];
  parts.forEach((p, i) => {
    const s = meshStats(p);
    if (s.faceCount === s0.faceCount && close(s.volume, s0.volume, 0.01) && close(s.area, s0.area, 0.01) && Math.abs(s.rmax - s0.rmax) <= 0.05) out.push(i);
  });
  return out;
}

// PCB = LED 가 아닌 부품 중, 바운딩 박스가 어떤 LED 중심에서 (LED 최대 rmax) 이내인 최대 부피. 없으면 LED 아닌 최대 부피.
// 후보(LED 아닌 부품)가 하나도 없을 때만 -1 을 돌려준다(호출 쪽에서 PCB 없음으로 처리).
export function pcbIndex(parts, leds) {
  const set = new Set(leds), cents = leds.map((i) => meshStats(parts[i]).center);
  const rmax = leds.reduce((r, i) => Math.max(r, meshStats(parts[i]).rmax), 0);
  let best = -1, bv = -Infinity, nb = -1, nbv = -Infinity;
  parts.forEach((p, i) => {
    if (set.has(i)) return;
    const v = meshStats(p).volume;
    if (v > nbv) { nbv = v; nb = i; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], P = p.positions;
    for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[k + a]); hi[a] = Math.max(hi[a], P[k + a]); }
    const near = cents.some((c) => Math.hypot(...[0, 1, 2].map((a) => Math.max(lo[a] - c[a], 0, c[a] - hi[a]))) <= rmax);
    if (near && v > bv) { bv = v; best = i; }
  });
  return best >= 0 ? best : nb;
}

// 점 p 에서 삼각형 abc 까지 최근접점(Ericson, Real-Time Collision Detection)
function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
// LED 중심에서 PCB 메쉬 최근접점으로의 단위벡터 v (PCB 가 LED 를 어느 쪽에서 받치는가). 중심이 PCB 위면 null.
function towardLed(pcbMesh, p) {
  const P = pcbMesh.positions, T = pcbMesh.triangles;
  let best = Infinity, q = null;
  for (let t = 0; t < T.length / 3; t++) {
    const vtx = [0, 1, 2].map((j) => { const k = T[t * 3 + j] * 3; return [P[k], P[k + 1], P[k + 2]]; });
    const c = closestOnTri(p, vtx[0], vtx[1], vtx[2]), d = len(sub(p, c));
    if (d < best) { best = d; q = c; }
  }
  return best > 1e-9 ? unit(sub(p, q)) : null;
}
const INTO = -0.3, TIE = 0.1;

// 기준 LED(ref)의 발광면(face) → 인식된 LED 들의 발광 위치·축·가로축. pcb(선택) = pcbIndex 결과.
// PCB 방향 판정은 국소적: 각 LED 에서 PCB 최근접점으로의 방향 v 와 면 법선의 내적(n·v)이 INTO 미만이면 PCB 쪽 면.
// 면 순서 일치 면은 PCB 쪽이 아니면 신뢰. 아니면 기술자 일치 면 중 n·v 최대를 고름.
// 선택 면과 TIE 이내로 비슷한 후보가 또 있거나(대칭 형상), 최선이 PCB 쪽이면 추측하지 않고 needsCheck.
export function findEmitters(parts, leds, ref, face, pcb = -1) {
  const sRef = meshStats(parts[ref]), fRef = faceInfo(parts[ref], face);
  if (!fRef) throw new Error('발광면 정보를 읽을 수 없음');
  const dRef = len(sub(fRef.c, sRef.center)), aRef = dot(fRef.n, unit(sub(fRef.c, sRef.center)));
  const match = (st, fi) => fi && !fi.degenerate && close(fi.area, fRef.area, 0.02) && Math.abs(len(sub(fi.c, st.center)) - dRef) <= 0.05 && Math.abs(dot(fi.n, unit(sub(fi.c, st.center))) - aRef) <= 0.02;
  return leds.map((i) => {
    const st = meshStats(parts[i]), v = pcb >= 0 ? towardLed(parts[pcb], st.center) : null;
    const fi0 = faceInfo(parts[i], face), ok0 = match(st, fi0);
    const bad = { part: i, face: -1, needsCheck: true };
    const good = (f, fi) => ({ part: i, face: f, pos: fi.c, axis: fi.n, xAxis: fi.xAxis, needsCheck: false });
    if (!v) {   // PCB 정보 없음: 면 순서 일치 우선, 아니면 첫 기술자 일치 면
      if (ok0) return good(face, fi0);
      for (let k = 0; k < parts[i].faceCount; k++) { const c = faceInfo(parts[i], k); if (match(st, c)) return good(k, c); }
      return bad;
    }
    const cand = [];
    for (let k = 0; k < parts[i].faceCount; k++) { const c = k === face ? fi0 : faceInfo(parts[i], k); if (match(st, c)) cand.push({ f: k, fi: c, sc: dot(c.n, v) }); }
    let pick = ok0 ? cand.find((c) => c.f === face) : null;
    if (!pick || pick.sc < INTO) pick = cand.reduce((b, c) => (!b || c.sc > b.sc ? c : b), null);
    if (!pick || pick.sc < INTO || cand.some((c) => c !== pick && c.sc >= pick.sc - TIE)) return bad;
    return good(pick.f, pick.fi);
  });
}
