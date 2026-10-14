// 부품 간 광학 접촉면(이중사출·접착) 감지 — spec 2026-10-14 §3.4.
// 서로 다른 부품의 삼각형이 거리 ≤ gap+chord(chord = 테셀레이션 허용오차), 법선 반대(내적 ≤ −0.97) → 같은 평면으로 보고 교차 면적을 (부품A, 면A, 부품B, 면B)별로 합산.
// 평면 접촉은 정확하고, 곡면 접촉은 근사(투영 면적, 테셀레이션 허용오차 이내)다.
import { buildBvh, queryBox } from './bvh.js';
import { bounds } from './mesh.js';

const NDOT = -0.97, MIN_AREA = 0.01;

function triFrame(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const v = [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]];
  const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(...n);
  return { v, n: len > 0 ? n.map((x) => x / len) : [0, 0, 0], area: len / 2 };
}

function planeBasis(n) {
  const r = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
  const l = Math.hypot(...u); u = u.map((x) => x / l);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, w };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const signedArea = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length]; s += x0 * y1 - x1 * y0; } return s / 2; };

// 볼록 다각형 poly 를 볼록 다각형 clip(반시계)으로 자른 면적
function clipArea(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
    const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])]); }
    }
  }
  return out.length >= 3 ? Math.abs(signedArea(out)) : 0;
}

const overlaps = (A, B, m) => A[0] - m <= B[3] && B[0] - m <= A[3] && A[1] - m <= B[4] && B[1] - m <= A[4] && A[2] - m <= B[5] && B[2] - m <= A[5];

// parts: [{ positions, triangles, faceIds, bvh? }] → [{ a, faceA, b, faceB, area(mm²) }] (a < b)
export function findContacts(parts, { gap = 0.02, chord = 0.02 } = {}) {
  const bvhs = parts.map((p) => p.bvh ?? buildBvh(p.positions, p.triangles));
  const bb = parts.map((p) => bounds(p.positions));
  const acc = new Map(), cand = [];
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    if (!overlaps(bb[a], bb[b], gap)) continue;
    const A = parts[a], B = parts[b];
    for (let t = 0; t < A.triangles.length / 3; t++) {
      const fa = triFrame(A.positions, A.triangles, t);
      if (!fa.area) continue;
      const lo = [0, 1, 2].map((k) => Math.min(fa.v[0][k], fa.v[1][k], fa.v[2][k]) - gap - chord);
      const hi = [0, 1, 2].map((k) => Math.max(fa.v[0][k], fa.v[1][k], fa.v[2][k]) + gap + chord);
      queryBox(bvhs[b], lo, hi, cand);
      if (!cand.length) continue;
      const { u, w } = planeBasis(fa.n), d0 = dot(fa.n, fa.v[0]);
      let pa = fa.v.map((p) => [dot(p, u), dot(p, w)]);
      if (signedArea(pa) < 0) pa = pa.reverse();
      for (const tb of cand) {
        const fb = triFrame(B.positions, B.triangles, tb);
        if (!fb.area || dot(fa.n, fb.n) > NDOT) continue;
        const cen = [0, 1, 2].map((k) => (fb.v[0][k] + fb.v[1][k] + fb.v[2][k]) / 3);   // 곡면은 정점이 A 평면에서 멀어질 수 있어 무게중심으로 판정(평면 접촉은 동일)
        if (Math.abs(dot(fa.n, cen) - d0) > gap + chord) continue;
        let pb = fb.v.map((p) => [dot(p, u), dot(p, w)]);
        if (signedArea(pb) < 0) pb = pb.reverse();
        const ar = clipArea(pa, pb);
        if (ar <= 0) continue;
        const key = `${a}|${A.faceIds[t]}|${b}|${B.faceIds[tb]}`;
        acc.set(key, (acc.get(key) ?? 0) + ar);
      }
    }
  }
  return [...acc].filter(([, area]) => area >= MIN_AREA).map(([k, area]) => {
    const [a, faceA, b, faceB] = k.split('|').map(Number);
    return { a, faceA, b, faceB, area };
  });
}
