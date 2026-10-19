// 부품 간격·간섭 — 선택 부품 기준 이웃 부품과의 최소 간격, LED 거리, 크기·위치 조절 시 간섭 직전까지 제한.
// 간격: 표본점(정점 + 삼각형 중심) → 상대 메쉬 최근접점(BVH 상자 질의). 양방향 최솟값. 평행 면·정점 근접은 정확,
// 큰 삼각형의 모서리끼리 엇갈린 경우는 조금 크게 나올 수 있다(표본 한계).
// 간섭: 한 부품의 표본점이 다른 부품 솔리드 안이고 그 표면에서 tol(기본 0.02mm) 보다 깊을 때. 맞붙은 면(접촉)은 간섭 아님.
import { buildBvh, queryBox, intersectRay } from './bvh.js';
import { bounds } from './mesh.js';
import { insidePart } from './checks.js';
import { scaleMoveMesh, isIdentityXform } from './xform.js';

export const TOL = 0.02;

// 점 p 에서 삼각형 abc 위 최근접점 (Ericson, Real-Time Collision Detection 5.1.5)
export function closestOnTri(p, a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

const BVH = new WeakMap(), SAMPLES = new WeakMap(), BOX = new WeakMap();
const bvhOf = (m) => m.bvh ?? (BVH.get(m) || (BVH.set(m, buildBvh(m.positions, m.triangles)), BVH.get(m)));
const boxOf = (m) => BOX.get(m) || (BOX.set(m, bounds(m.positions)), BOX.get(m));
const solid = (m) => (m.bvh ? m : { ...m, bvh: bvhOf(m) });
// 표본점: 정점 + 삼각형 중심 (Float64Array xyz…) — 간격용
function samplesOf(m) {
  let s = SAMPLES.get(m);
  if (s) return s;
  const P = m.positions, T = m.triangles, nv = P.length / 3, nt = T.length / 3;
  s = new Float64Array((nv + nt) * 3);
  s.set(P);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) s[(nv + t) * 3 + k] = (P[3 * T[3 * t] + k] + P[3 * T[3 * t + 1] + k] + P[3 * T[3 * t + 2] + k]) / 3;
  SAMPLES.set(m, s);
  return s;
}
// 간섭용 표본점: 위 표본 + 삼각형 중심을 자기 안쪽으로 INSET 만큼 들인 점. 표면이 완전히 겹친 경우(같은 자리 두 부품)도
// 잡고, 맞붙은 면(접촉)의 안쪽 점은 상대 밖이라 오탐하지 않는다.
// 안쪽 방향은 삼각형마다 홀짝으로 정한다(STEP 메쉬는 면마다 감은 방향이 뒤집혀 있을 수 있음). 양수 배율·이동에는
// 변하지 않으므로 삼각형 배열(변환 사본과 공유)별로 한 번만 계산한다
const INSET = 0.05, INNER = new WeakMap(), SIDE = new WeakMap();
function insetSides(m) {
  let sd = SIDE.get(m.triangles);
  if (sd) return sd;
  const P = m.positions, T = m.triangles, nt = T.length / 3, ms = solid(m);
  sd = new Int8Array(nt);
  for (let t = 0; t < nt; t++) {
    const { c, n } = triCN(P, T, t);
    if (!n) continue;
    if (insidePart(ms, c.map((v, k) => v - INSET * n[k]))) sd[t] = 1;
    else if (insidePart(ms, c.map((v, k) => v + INSET * n[k]))) sd[t] = -1;
  }
  SIDE.set(m.triangles, sd);
  return sd;
}
function triCN(P, T, t) {
  const a = vtx(P, T[3 * t]), b = vtx(P, T[3 * t + 1]), c = vtx(P, T[3 * t + 2]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
  return { c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], n: l ? n.map((x) => x / l) : null };
}
function innerSamplesOf(m) {
  let s = INNER.get(m);
  if (s) return s;
  const base = samplesOf(m), P = m.positions, T = m.triangles, sd = insetSides(m), pts = [];
  for (let t = 0; t < sd.length; t++) {
    if (!sd[t]) continue;
    const { c, n } = triCN(P, T, t);
    pts.push(c[0] - sd[t] * INSET * n[0], c[1] - sd[t] * INSET * n[1], c[2] - sd[t] * INSET * n[2]);
  }
  s = new Float64Array(base.length + pts.length);
  s.set(base); s.set(pts, base.length);
  INNER.set(m, s);
  return s;
}
const boxDist = (b, p) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[3]), Math.max(b[1] - p[1], 0, p[1] - b[4]), Math.max(b[2] - p[2], 0, p[2] - b[5]));
const boxBoxDist = (a, b) => Math.hypot(Math.max(a[0] - b[3], 0, b[0] - a[3]), Math.max(a[1] - b[4], 0, b[1] - a[4]), Math.max(a[2] - b[5], 0, b[2] - a[5]));
const vtx = (P, i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];

// 메쉬 m 표면에서 점 p 의 최근접점 — r 안에서만(없으면 null). 반환 { d, q }
export function nearestOnMesh(m, p, r = Infinity, cand = []) {
  const P = m.positions, T = m.triangles, bv = bvhOf(m);
  let best = null, R = Number.isFinite(r) ? r : Math.max(1, boxDist(boxOf(m), p) * 2 + 1);
  for (let pass = 0; pass < 40; pass++) {
    queryBox(bv, [p[0] - R, p[1] - R, p[2] - R], [p[0] + R, p[1] + R, p[2] + R], cand);
    for (const t of cand) {
      const q = closestOnTri(p, vtx(P, T[3 * t]), vtx(P, T[3 * t + 1]), vtx(P, T[3 * t + 2])), d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (d <= R && (!best || d < best.d)) best = { d, q };
    }
    if (best || Number.isFinite(r)) return best;
    R *= 2;
  }
  return best;
}

// 두 메쉬의 최소 간격(≤ maxDist 일 때만) — { gap, pa, pb } | null
export function meshGap(A, B, maxDist = 20) {
  if (boxBoxDist(boxOf(A), boxOf(B)) > maxDist) return null;
  let best = maxDist, out = null;
  const cand = [];
  for (const [X, Y, flip] of [[A, B, false], [B, A, true]]) {
    const s = samplesOf(X), by = boxOf(Y);
    for (let i = 0; i < s.length; i += 3) {
      const p = [s[i], s[i + 1], s[i + 2]];
      if (boxDist(by, p) > best) continue;
      const h = nearestOnMesh(Y, p, best, cand);
      if (h && h.d < best) { best = h.d; out = flip ? { pa: h.q, pb: p } : { pa: p, pb: h.q }; }
    }
  }
  return out ? { gap: best, ...out } : null;
}

// A 가 B 를 파고든 깊이(양방향 표본점 중 상대 솔리드 안 + 표면에서 가장 먼 것) — { depth, pos } | null(tol 이하)
export function meshPenetration(A, B, tol = TOL) {
  const ba = boxOf(A), bb = boxOf(B);
  if (boxBoxDist(ba, bb) > 0) return null;
  let out = null;
  const cand = [];
  for (const [X, Y] of [[A, B], [B, A]]) {
    const s = innerSamplesOf(X), by = boxOf(Y), Ys = solid(Y);
    for (let i = 0; i < s.length; i += 3) {
      const p = [s[i], s[i + 1], s[i + 2]];
      if (boxDist(by, p) > 0) continue;
      const h = nearestOnMesh(Y, p, Infinity, cand);
      if (!h || h.d <= Math.max(tol, out?.depth ?? 0)) continue;   // 표면 근처(접촉면)·이미 더 깊은 것 있음
      if (insidePart(Ys, p)) out = { depth: h.d, pos: p };
    }
  }
  return out;
}

// 선택 부품 i 의 간격 표 — parts: 기구 부품(변환 반영), ledParts: LED STEP 메쉬(PCB·LED, 없으면 []), emitters: [{pos, axis}]
// 반환 { parts: [{ part, gap, pa, pb, depth }] (간격 순), leds: [{ part, gap, pa, pb, depth }], ledMin: { led, dist, pa, pb } | null, ledAxial: { led, dist } | null }
export function partClearance(parts, i, { ledParts = [], emitters = [], maxDist = 20 } = {}) {
  const me = parts[i], row = (m, j) => {
    const pen = meshPenetration(me, m);
    if (pen) return { part: j, gap: 0, depth: pen.depth, pa: pen.pos, pb: pen.pos };
    const g = meshGap(me, m, maxDist);
    return g ? { part: j, gap: g.gap, depth: 0, pa: g.pa, pb: g.pb } : null;
  };
  const list = parts.map((m, j) => (j === i ? null : row(m, j))).filter(Boolean).sort((a, b) => a.gap - b.gap || b.depth - a.depth);
  const leds = ledParts.map((m, j) => row(m, j)).filter(Boolean).sort((a, b) => a.gap - b.gap || b.depth - a.depth);
  let ledMin = null, ledAxial = null;
  const Ms = solid(me);
  emitters.forEach((e, k) => {
    const h = nearestOnMesh(me, e.pos);
    if (h && (!ledMin || h.d < ledMin.dist)) ledMin = { led: k, dist: h.d, pa: e.pos, pb: h.q };
    const al = Math.hypot(...e.axis) || 1, hit = intersectRay(Ms.bvh, e.pos[0], e.pos[1], e.pos[2], e.axis[0] / al, e.axis[1] / al, e.axis[2] / al, 1e-6);
    if (hit && (!ledAxial || hit.t < ledAxial.dist)) ledAxial = { led: k, dist: hit.t };
  });
  return { parts: list, leds, ledMin, ledAxial };
}

// 후보 메쉬가 일으키는 간섭 목록 — 키 'p:j'(기구 부품) | 'l:j'(LED STEP 메쉬) | 'e:k'(발광점이 부품 안)
export function interferenceKeys(cand, others, ledParts = [], emitters = [], tol = TOL) {
  const out = new Map();
  others.forEach((m, j) => { if (m && m !== cand) { const p = meshPenetration(cand, m, tol); if (p) out.set(`p:${j}`, p.depth); } });
  ledParts.forEach((m, j) => { const p = meshPenetration(cand, m, tol); if (p) out.set(`l:${j}`, p.depth); });
  const Cs = solid(cand), cb = boxOf(cand);
  emitters.forEach((e, k) => {
    const al = Math.hypot(...e.axis) || 1, q = e.pos.map((v, d) => v + (0.05 * e.axis[d]) / al);
    if (boxDist(cb, q) === 0 && insidePart(Cs, q)) out.set(`e:${k}`, 0);
  });
  return out;
}

const lerpXf = (a, b, t) => {
  const A = { offset: a?.offset ?? [0, 0, 0], scale: a?.scale ?? [1, 1, 1] }, B = { offset: b?.offset ?? [0, 0, 0], scale: b?.scale ?? [1, 1, 1] };
  const r = (x) => Math.round(x * 1e4) / 1e4;
  return { offset: A.offset.map((v, k) => r(v + (B.offset[k] - v) * t)), scale: A.scale.map((v, k) => r(v + (B.scale[k] - v) * t)) };
};
// 크기·위치 바꾸기를 간섭 직전까지 제한 — raw: 원본 부품 메쉬, others: 다른 기구 부품(현재, 자기 자리는 null)
// 원래 있던 간섭(포팅 LED·원본 모델의 겹침)은 문제 삼지 않고 새로 생기는 간섭만 막는다.
// 반환 { xf (null = 원래대로), limited, hit: 키 | null, t }
export function limitXform(raw, oldXf, newXf, others, { ledParts = [], emitters = [], tol = TOL, iters = 14 } = {}) {
  const b = boxOf(raw), c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  const at = (xf) => scaleMoveMesh(raw, isIdentityXform(xf) ? null : xf, c);
  const base = interferenceKeys(at(oldXf), others, ledParts, emitters, tol);
  const fresh = (xf) => { for (const k of interferenceKeys(at(xf), others, ledParts, emitters, tol).keys()) if (!base.has(k)) return k; return null; };
  const hit = fresh(newXf);
  if (!hit) return { xf: newXf, limited: false, hit: null, t: 1 };
  let lo = 0, hi = 1;
  for (let n = 0; n < iters; n++) { const m = (lo + hi) / 2; if (fresh(lerpXf(oldXf, newXf, m))) hi = m; else lo = m; }
  const xf = lerpXf(oldXf, newXf, lo);
  return { xf: isIdentityXform(xf) ? null : xf, limited: true, hit, t: lo };
}

// ---- 축별 한계(입력 전에 보여 주는 가능 범위) ----
// 움직이는 부품 표본: 삼각형 중심 + 세 꼭짓점을, 안쪽 법선 방향과 삼각형 중심 방향으로 INSET 씩 들인 점.
// 맞닿은 면을 따라 미끄러질 때 면과 같은 평면 위 광선(스침 교차)을 피한다(STEP 메쉬는 면마다 정점을 따로 가짐)
const MOVE = new WeakMap();
function moveSamplesOf(m) {
  let s = MOVE.get(m);
  if (s) return s;
  const P = m.positions, T = m.triangles, sd = insetSides(m), pts = [];
  for (let t = 0; t < sd.length; t++) {
    if (!sd[t]) continue;
    const { c, n } = triCN(P, T, t), q = c.map((v, k) => v - sd[t] * INSET * n[k]);
    pts.push(...q);
    for (let j = 0; j < 3; j++) {
      const v = vtx(P, T[3 * t + j]), w = [c[0] - v[0], c[1] - v[1], c[2] - v[2]], l = Math.hypot(...w) || 1;
      for (let k = 0; k < 3; k++) pts.push(v[k] - sd[t] * INSET * n[k] + (Math.min(INSET, l / 2) * w[k]) / l);
    }
  }
  s = Float64Array.from(pts);
  MOVE.set(m, s);
  return s;
}
// mov 를 방향 d(단위)로 옮길 때 처음 닿는 거리(≤ maxD) — 양방향 광선: mov 표본 → 장애물, 장애물 표본 → mov(−d), 발광점 → mov(−d)
export function travelDistance(mov, obstacles, d, maxD, emitters = []) {
  let best = maxD;
  const mb = boxOf(mov), Ms = solid(mov);
  const sweep = [0, 1, 2].map((k) => Math.min(mb[k], mb[k] + d[k] * maxD)).concat([0, 1, 2].map((k) => Math.max(mb[k + 3], mb[k + 3] + d[k] * maxD)));
  const ms = moveSamplesOf(mov);
  for (const o of obstacles) {
    if (!o || boxBoxDist(sweep, boxOf(o)) > 0) continue;
    const Os = solid(o), os = moveSamplesOf(o);
    for (let i = 0; i < ms.length; i += 3) { const h = intersectRay(Os.bvh, ms[i], ms[i + 1], ms[i + 2], d[0], d[1], d[2], 1e-6, best); if (h && h.t < best) best = h.t; }
    for (let i = 0; i < os.length; i += 3) { const h = intersectRay(Ms.bvh, os[i], os[i + 1], os[i + 2], -d[0], -d[1], -d[2], 1e-6, best); if (h && h.t < best) best = h.t; }
  }
  for (const e of emitters) { const h = intersectRay(Ms.bvh, e.pos[0], e.pos[1], e.pos[2], -d[0], -d[1], -d[2], 1e-6, best); if (h && h.t < best) best = h.t; }
  return best;
}
// 현재 xf 에서 축별로 간섭 없이 갈 수 있는 범위 — 반환 { move: [[−, +] ×3](mm, 이동량), size: [최대 크기 mm ×3], uniform: 비율 고정 최대 배수 }
// 장애물이 없으면 Infinity. 광선 후보 → limitXform 으로 확인·되물림(표본 사이로 빠지는 경우 보정)
export function axisLimits(raw, xf, others, { ledParts = [], emitters = [], maxD = 1000, tol = TOL } = {}) {
  const b = boxOf(raw), c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], size0 = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
  const X = { offset: [...(xf?.offset ?? [0, 0, 0])], scale: [...(xf?.scale ?? [1, 1, 1])] };
  const cur = scaleMoveMesh(raw, isIdentityXform(X) ? null : X, c);
  const base = interferenceKeys(cur, others, ledParts, emitters, tol);   // 원래 겹친 상대는 장애물에서 뺀다
  const obs = [...others.map((m, j) => (m && !base.has(`p:${j}`) ? m : null)), ...ledParts.map((m, j) => (base.has(`l:${j}`) ? null : m))];
  const ems = emitters.filter((_, k) => !base.has(`e:${k}`));
  const opt = { ledParts, emitters, tol };
  const confirm = (to) => limitXform(raw, X, to, others, opt);
  const move = [0, 1, 2].map((k) => [-1, 1].map((sg) => {
    const d = [0, 0, 0]; d[k] = sg;
    const D = travelDistance(cur, obs, d, maxD, ems);
    if (D >= maxD) return sg * Infinity;
    const to = { offset: X.offset.map((v, j) => (j === k ? v + sg * D : v)), scale: X.scale };
    return sg * D * confirm(to).t;
  }));
  const free = move.map(([lo, hi]) => Math.min(-lo, hi));   // 축 양쪽 중 가까운 쪽 — 중심 기준으로 양쪽이 같이 커짐
  const size = [0, 1, 2].map((k) => {
    const s = size0[k] * X.scale[k];
    if (!Number.isFinite(free[k])) return Infinity;
    const to = { offset: X.offset, scale: X.scale.map((v, j) => (j === k ? (s + 2 * free[k]) / size0[k] : v)) };
    const t = confirm(to).t;
    return s + 2 * free[k] * t;
  });
  const fr = Math.min(...[0, 1, 2].map((k) => (Number.isFinite(free[k]) ? 1 + (2 * free[k]) / (size0[k] * X.scale[k]) : Infinity)));
  const uniform = Number.isFinite(fr) ? 1 + (fr - 1) * confirm({ offset: X.offset, scale: X.scale.map((v) => v * fr) }).t : Infinity;
  return { move, size, uniform, center0: c, size0 };
}
