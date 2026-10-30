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
const triBoxCache = new WeakMap();   // PCB 메쉬(불변 가정) → 삼각형별 AABB [minx,miny,minz,maxx,maxy,maxz]
function towardLed(pcbMesh, p) { const { d2, q } = closestOnMesh(pcbMesh, p); return d2 > 1e-18 ? unit(sub(p, q)) : null; }
// 메쉬 위 최근접점 q 와 거리² d2
function closestOnMesh(pcbMesh, p) {
  const P = pcbMesh.positions, T = pcbMesh.triangles, nT = T.length / 3;
  let B = triBoxCache.get(pcbMesh);
  if (!B) {
    B = new Float32Array(nT * 6);
    for (let t = 0; t < nT; t++) for (let a = 0; a < 3; a++) {
      const x = P[T[t * 3] * 3 + a], y = P[T[t * 3 + 1] * 3 + a], z = P[T[t * 3 + 2] * 3 + a];
      B[t * 6 + a] = Math.min(x, y, z); B[t * 6 + 3 + a] = Math.max(x, y, z);
    }
    triBoxCache.set(pcbMesh, B);
  }
  let best2 = Infinity, q = null;
  for (let t = 0; t < nT; t++) {
    const o = t * 6;
    const dx = Math.max(B[o] - p[0], 0, p[0] - B[o + 3]), dy = Math.max(B[o + 1] - p[1], 0, p[1] - B[o + 4]), dz = Math.max(B[o + 2] - p[2], 0, p[2] - B[o + 5]);
    if (dx * dx + dy * dy + dz * dz >= best2) continue;   // 이 삼각형은 현재 최선보다 멀 수밖에 없음
    const i0 = T[t * 3] * 3, i1 = T[t * 3 + 1] * 3, i2 = T[t * 3 + 2] * 3;
    const c = closestOnTri(p, [P[i0], P[i0 + 1], P[i0 + 2]], [P[i1], P[i1 + 1], P[i1 + 2]], [P[i2], P[i2 + 1], P[i2 + 2]]), d = sub(p, c), d2 = dot(d, d);
    if (d2 < best2) { best2 = d2; q = c; }
  }
  return { d2: best2, q };
}
// 도면 광원의 받침 부품: LED 몸체 중심에서 가장 가까운 부품 번호(skip 제외) — 보통 LED 가 올라앉은 PCB. 없으면 −1
export function supportPart(parts, led, skip = new Set()) {
  const c = meshStats(led).center;
  let best = Infinity, k = -1;
  parts.forEach((m, i) => { if (!m || skip.has(i)) return; const { d2 } = closestOnMesh(m, c); if (d2 < best) { best = d2; k = i; } });
  return k;
}
const INTO = -0.3, TIE = 0.1;

// 기준 LED(ref)의 발광면(face) → 인식된 LED 들의 발광 위치·축·가로축. pcb(선택) = pcbIndex 결과.
// PCB 방향 판정은 국소적: 각 LED 에서 PCB 최근접점으로의 방향 v 와 면 법선의 내적(n·v)이 INTO 미만이면 PCB 쪽 면.
// 면 순서 일치 면은 PCB 쪽이 아니면 그대로 신뢰. 아니면 기술자 일치 면 중 n·v 최대를 고름.
// 재탐색에서 선택 면과 TIE 이내로 비슷한 후보가 또 있거나(대칭 형상), 최선이 PCB 쪽이면 추측하지 않고 needsCheck.
export function findEmitters(parts, leds, ref, face, pcb = -1) {
  const sRef = meshStats(parts[ref]), fRef = faceInfo(parts[ref], face);
  if (!fRef) throw new Error('발광면 정보를 읽을 수 없음');
  const dRef = len(sub(fRef.c, sRef.center)), aRef = dot(fRef.n, unit(sub(fRef.c, sRef.center)));
  const match = (st, fi) => fi && !fi.degenerate && close(fi.area, fRef.area, 0.02) && Math.abs(len(sub(fi.c, st.center)) - dRef) <= 0.05 && Math.abs(dot(fi.n, unit(sub(fi.c, st.center))) - aRef) <= 0.02;
  return leds.map((i) => {
    const st = meshStats(parts[i]), v = pcb >= 0 ? towardLed(parts[pcb], st.center) : null;
    const fi0 = faceInfo(parts[i], face), ok0 = match(st, fi0);
    const bad = { part: i, face: -1, needsCheck: true };
    const good = (f, fi) => { const pos = emitPoint(parts[i], fi); return pos ? { part: i, face: f, pos, axis: fi.n, xAxis: fi.xAxis, needsCheck: false } : bad; };   // 발광점이 자기 솔리드 안에서 못 나오면 확인 필요
    if (!v) {   // PCB 정보 없음: 면 순서 일치 우선, 아니면 첫 기술자 일치 면
      if (ok0) return good(face, fi0);
      for (let k = 0; k < parts[i].faceCount; k++) { const c = faceInfo(parts[i], k); if (match(st, c)) return good(k, c); }
      return bad;
    }
    if (ok0 && dot(fi0.n, v) >= INTO) return good(face, fi0);   // 유효한 면 순서 일치는 그대로 신뢰(동점 규칙은 재탐색에만)
    const cand = [];
    for (let k = 0; k < parts[i].faceCount; k++) { const c = k === face ? fi0 : faceInfo(parts[i], k); if (match(st, c)) cand.push({ f: k, fi: c, sc: dot(c.n, v) }); }
    const pick = cand.reduce((b, c) => (!b || c.sc > b.sc ? c : b), null);
    if (!pick || pick.sc < INTO || cand.some((c) => c !== pick && c.sc >= pick.sc - TIE)) return bad;
    return good(pick.f, pick.fi);
  });
}

// 클릭 광선(o + t·d)에서 가까운 LED 와 그 발광면 고르기 — 작은 LED 를 정확히 못 눌러도(PCB·빈 곳 클릭) 맞춘다.
// 부품: 면적가중 중심이 카메라 앞(t > 0)이고 광선까지 수직거리 ≤ maxDist 인 후보 중 최근접.
// 면: 카메라를 향한 면(바깥 법선 · (−d) > 0.3) 중 중심이 광선에 가장 가까운 면, 0.05mm 이내 동률이면 카메라에 가까운(t 작은) 면.
const rayPerp = (p, o, d) => { const v = sub(p, o), t = dot(v, d); return { t, perp: len(sub(v, d.map((x) => x * t))) }; };
// pcb ≥ 0 이면(맞춤 선택) 발광면은 광선과 무관하게 윗면 발광 가정(topEmitterFace) — 비스듬한 시점에서 몸체 측면이 고르는 것을 막음.
export function pickLedNearRay(parts, candidates, origin, dir, maxDist = 5, pcb = -1) {
  const d = unit(dir);
  let part = -1, best = Infinity;
  for (const i of candidates) {
    const { t, perp } = rayPerp(meshStats(parts[i]).center, origin, d);
    if (t > 0 && perp <= maxDist && perp < best) { best = perp; part = i; }
  }
  if (part < 0) return null;
  if (pcb >= 0) return { part, face: topEmitterFace(parts, part, pcb) };
  const m = parts[part];
  let face = -1, bp = Infinity, bt = Infinity;
  for (let k = 0; k < m.faceCount; k++) {
    const fi = faceInfo(m, k);
    if (!fi || fi.degenerate || -dot(fi.n, d) <= 0.3) continue;
    const { t, perp } = rayPerp(fi.c, origin, d);
    if (perp < bp - 0.05 || (perp <= bp + 0.05 && t < bt)) { bp = Math.min(bp, perp); bt = t; face = k; }
  }
  return { part, face: face >= 0 ? refineEmitterFace(m, face) : face };
}

// 발광면 보정: 클릭한 면과 평행한 면(면적가중 법선 내적 > 0.95) 중 법선 방향으로 가장 바깥(dot(중심, n) 최대, 동률이면 넓은 면).
// 몸체 윗면(렌즈 둘레 고리)을 눌러도 렌즈 윗면을 발광면으로 — 몸체 윗면에서 쏘면 렌즈 솔리드 안에서 시작한다.
export function refineEmitterFace(mesh, face) {
  const f0 = faceInfo(mesh, face);
  if (!f0 || f0.degenerate) return face;
  let best = face, bd = dot(f0.c, f0.n), ba = f0.area;
  for (let k = 0; k < mesh.faceCount; k++) {
    if (k === face) continue;
    const fi = faceInfo(mesh, k);
    if (!fi || fi.degenerate || dot(fi.n, f0.n) <= 0.95) continue;
    const dk = dot(fi.c, f0.n);
    if (dk > bd + 1e-6 || (Math.abs(dk - bd) <= 1e-6 && fi.area > ba)) { best = k; bd = dk; ba = fi.area; }
  }
  return best;
}

// 발광점: 면 중심이 솔리드 밖이면 그대로. 곡면(돔 렌즈)은 면적 중심이 렌즈 안이라 → 법선 방향 첫 표면(돔 꼭대기). 못 나오면 null
function emitPoint(m, fi) {
  if (!insideOwn(m, fi.c, fi.n)) return fi.c;
  const t = rayHits(m, fi.c, fi.n)[0];
  if (t == null) return null;
  const q = [fi.c[0] + t * fi.n[0], fi.c[1] + t * fi.n[1], fi.c[2] + t * fi.n[2]];
  return insideOwn(m, q, fi.n) ? null : q;
}
function insideOwn(m, p, dir) { return rayHits(m, p, dir).length % 2 === 1; }
// p + 1e-4·dir(+미세 흔들기) 에서 dir 방향 광선이 메쉬 삼각형과 만나는 거리들(오름차순, Möller–Trumbore) — 홀수 개면 p 는 안
function rayHits(m, p, dir) {
  const P = m.positions, T = m.triangles, o = [p[0] + 1e-4 * dir[0] + 1.3e-5, p[1] + 1e-4 * dir[1] + 0.7e-5, p[2] + 1e-4 * dir[2] + 0.9e-5];   // 미세 흔들기: 면 중심이 삼각형 모서리 위면 두 번 세는 것 방지
  const hits = [];
  for (let t = 0; t < T.length / 3; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]], det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue;
    const sv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]], u = dot(sv, h) / det;
    if (u < 0 || u > 1) continue;
    const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]], v = dot(dir, q) / det;
    if (v < 0 || u + v > 1) continue;
    const th = dot(e2, q) / det;
    if (th > 0) hits.push(th + 1e-4);
  }
  return hits.sort((a, b) => a - b);
}

// 화면 기준 LED 맞춤 반경(mm): 클릭 지점 깊이의 화소당 mm × px, 최소 minMm. 값이 없으면 minMm
export function snapRadius(worldPerPixel, minMm = 5, px = 14) {
  return Number.isFinite(worldPerPixel) && worldPerPixel > 0 ? Math.max(minMm, px * worldPerPixel) : minMm;
}

// 윗면 발광 가정의 발광면: v = unit(LED 중심 − PCB 최근접점) 과 법선 내적이 가장 큰 면(> 0.7) → 가장 바깥 평행 면. 없으면 −1
export function topEmitterFace(parts, part, pcb) {
  const m = parts[part], v = towardLed(parts[pcb], meshStats(m).center);
  return v ? faceAlong(m, v) : -1;
}
// 도면 광원(PCB = 기구 부품): 클릭한 면이 받침 부품 반대쪽(법선 · v > 0.7)이면 그 면, 아니면(옆면·아랫면) 받침 반대쪽 면 → 가장 바깥 평행 면.
// 받침 판단 불가면 클릭 면 그대로(보정만)
export function emitterFaceAway(mesh, face, support) {
  const v = support ? towardLed(support, meshStats(mesh).center) : null, fi = faceInfo(mesh, face);
  if (!v || (fi && !fi.degenerate && dot(fi.n, v) > 0.7)) return refineEmitterFace(mesh, face);
  const f = faceAlong(mesh, v);
  return f >= 0 ? f : refineEmitterFace(mesh, face);
}
// 받침에서 LED 쪽 방향 v 와 법선 내적이 가장 큰 면(> 0.7) → 가장 바깥 평행 면. 없으면 −1
function faceAlong(m, v) {
  let face = -1, bd = 0.7;
  for (let k = 0; k < m.faceCount; k++) {
    const fi = faceInfo(m, k);
    if (!fi || fi.degenerate) continue;
    const dv = dot(fi.n, v);
    if (dv > bd) { bd = dv; face = k; }
  }
  return face >= 0 ? refineEmitterFace(m, face) : -1;
}

// 도면 광원 자동 인식(STEP 불러온 직후·[자동 선택]): 같은 모양이 2개 이상 반복되는 작은 부품(크기 ≤ maxDiag mm) 무리 중 가장 많은 것.
// 받침 부품(LED 에 닿아 있는 가장 가까운 부품 — PCB)이 있어야 하고, 발광면 = 받침 반대쪽 면. 못 찾으면 null.
// skip = 후보에서 뺄 부품 번호(관측면 부품 등). 반환 { leds, ref, face, support }
function bbox(m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], P = m.positions;
  for (let k = 0; k < P.length; k += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[k + a]); hi[a] = Math.max(hi[a], P[k + a]); }
  return { lo, hi };
}
// 반직선 o + t·d (t > 0) 이 상자 b 를 지나는지(slab)
function rayHitsBox(o, d, { lo, hi }) {
  let t0 = 1e-6, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo[a] || o[a] > hi[a]) return false; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}
// LED 메쉬의 꼭짓점 중 하나라도 받침 메쉬 표면에서 tol 이내 = PCB 위에 올라가 있음.
// tol = max(0.5 mm, LED 반경 × 0.3) — 실제 도면은 패드·솔더를 안 그려 LED 가 PCB 위에 조금 떠 있는 일이 흔함
function touches(led, sup, tol = Math.max(0.5, 0.3 * meshStats(led).rmax)) {
  const P = led.positions;
  for (let k = 0; k < P.length; k += 3) if (closestOnMesh(sup, [P[k], P[k + 1], P[k + 2]]).d2 <= tol * tol) return true;
  return false;
}
// 반환 { leds, ref, face, support, rejected:[{ count, why }] } — rejected = 더 많은데 뺀 반복 부품 무리와 이유(사용자 안내용). 못 찾으면 null
// why(선택) = 배열을 넘기면 못 찾았을 때도 뺀 후보·이유를 채워 줌
export function autoLedGroup(parts, { skip = new Set(), minCount = 2, maxDiag = 20, why = null } = {}) {
  const seen = new Set(), groups = [], rejected = why ?? [];
  parts.forEach((p, i) => {
    if (!p || seen.has(i) || skip.has(i)) return;
    const st = meshStats(p);
    const g = findLeds(parts, i).filter((k) => !skip.has(k));
    g.forEach((k) => seen.add(k));
    if (g.length < minCount) return;
    if (2 * st.rmax > maxDiag) { rejected.push({ count: g.length, why: `크기 ${(2 * st.rmax).toFixed(0)} mm — LED 로 보기엔 큼(≤ ${maxDiag} mm)` }); return; }
    groups.push({ g, vol: st.volume });
  });
  groups.sort((a, b) => b.g.length - a.g.length || a.vol - b.vol);
  for (const { g } of groups) {
    const ref = g[0], sup = supportPart(parts, parts[ref], new Set(g));
    if (sup < 0 || !touches(parts[ref], parts[sup])) { rejected.push({ count: g.length, why: 'PCB 위에 닿아 있지 않음(떠 있음)' }); continue; }
    const c = meshStats(parts[ref]).center, v = towardLed(parts[sup], c), face = v ? faceAlong(parts[ref], v) : -1;
    if (face < 0) { rejected.push({ count: g.length, why: 'PCB 반대쪽 면을 못 찾음' }); continue; }
    // 발광 방향 앞에 다른 부품(커버·확산판)이 있어야 LED — PCB 뒤에 붙은 나사·보스 등은 앞이 비어 있음
    const own = new Set([...g, sup]);
    if (parts.some((p, i) => p && !own.has(i) && rayHitsBox(c, v, bbox(p)))) return { leds: g, ref, face, support: sup, rejected: rejected.filter((r) => r.count > g.length) };
    rejected.push({ count: g.length, why: 'PCB 반대쪽(발광 방향) 앞에 커버·확산판이 없음' });
  }
  return null;
}
