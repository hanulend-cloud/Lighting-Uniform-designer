// ③ LGP 형상 — spec P4 §2.3. 관측 좌표계(u,v,d: d = 관측자 쪽) 에서 부품을 자유형 변형한다.
// 아랫면 이동량 D(x,y) = Δt − h·Σ bump(|p−c|/R)  (D>0 = 아래로 = 두꺼워짐, h>0 = LED 위 포켓)
// 정점 z' = z − w·D(x,y), w = (z_t − z)/(z_t − z_b) — 윗면(관측면 쪽) 고정, 아랫면만 움직이고 사이는 선형. 같은 자리 정점은 같은 결과라 닫힘 유지.
import { meshToHeightfield } from '../shape/heightfield.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const bump = (r) => (r >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * r)));
export const toFrame = (F, p) => [dot(p, F.u), dot(p, F.v), dot(p, F.d)];
export const fromFrame = (F, q) => [0, 1, 2].map((k) => q[0] * F.u[k] + q[1] * F.v[k] + q[2] * F.d[k]);

// 관측 좌표 높이맵 — at(x,y) = { zt, zb } (마스크 밖이면 가장 가까운 칸). non25 = 비 2.5D 칸 비율
export function frameHeights(mesh, F, cell = 0.5) {
  const P = mesh.positions, Q = new Float32Array(P.length);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]);
    Q[i] = q[0]; Q[i + 1] = q[1]; Q[i + 2] = q[2];
    xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); zmax = Math.max(zmax, q[2]);
  }
  const hf = meshToHeightfield({ positions: Q, triangles: mesh.triangles }, { cell });
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;   // meshToHeightfield 의 원점(외곽 중심, z 최고 = 0)
  const masked = []; for (let k = 0; k < hf.mask.length; k++) if (hf.mask[k]) masked.push(k);
  // 마스크 밖 칸 → 가까운 마스크 칸 번호(다중 출발 BFS, 8-이웃 근사). 한 번만 O(칸)
  const near = new Int32Array(hf.mask.length).fill(-1), queue = new Int32Array(hf.mask.length);
  let qh = 0, qt = 0;
  for (const m of masked) { near[m] = m; queue[qt++] = m; }
  while (qh < qt) {
    const k = queue[qh++], i = k % hf.nx, j = (k - i) / hf.nx;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= hf.nx || jj >= hf.ny) continue;
      const kk = jj * hf.nx + ii; if (near[kk] < 0) { near[kk] = near[k]; queue[qt++] = kk; }
    }
  }
  function at(x, y) {
    let i = Math.floor((x - cx - hf.x0) / hf.cell), j = Math.floor((y - cy - hf.y0) / hf.cell);
    i = Math.min(hf.nx - 1, Math.max(0, i)); j = Math.min(hf.ny - 1, Math.max(0, j));
    const k = near[j * hf.nx + i];
    if (k < 0) return { zt: 0, zb: 0 };   // 빈 높이맵
    return { zt: hf.zt[k] + zmax, zb: hf.zb[k] + zmax };
  }
  return { at, hf, cx, cy, zmax, non25: hf.stats.non25DFrac, t0: (() => { let s = 0; for (const m of masked) s += hf.zt[m] - hf.zb[m]; return masked.length ? s / masked.length : 0; })() };
}

const disp = (x, y, { dt, h, R, centers }) => { let b = 0; for (const c of centers) b += bump(Math.hypot(x - c[0], y - c[1]) / R); return dt - h * b; };

// 변형 메쉬(같은 삼각형·면 번호, 새 정점 위치). 부피는 다시 셈
export function deformPart(mesh, F, H, prm) {
  const P = mesh.positions, out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]), { zt, zb } = H.at(q[0], q[1]);
    const w = zt - zb > 1e-9 ? Math.min(1, Math.max(0, (zt - q[2]) / (zt - zb))) : 0;
    q[2] -= w * disp(q[0], q[1], prm);
    const p = fromFrame(F, q); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: out };
}

// 최소 두께(관측 좌표, 마스크 칸 중심) — 제약 점검용
export function minThickness(H, prm) {
  const { hf, cx, cy } = H; let mn = Infinity;
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
    const k = j * hf.nx + i; if (!hf.mask[k]) continue;
    const x = cx + hf.x0 + (i + 0.5) * hf.cell, y = cy + hf.y0 + (j + 0.5) * hf.cell;
    mn = Math.min(mn, hf.zt[k] - hf.zb[k] + disp(x, y, prm));
  }
  return mn;
}

// LED 원판(반경 R) 부근 국부 세분 — 모서리 기준(모서리 끝점만으로 결정 → 이웃 삼각형과 어긋남 없음).
// 표시 모서리: 길이 > hMax 이고 원판과 가까운(관측 평면 거리 < R) 모서리 + 원판 중심을 품은 삼각형의 가장 긴 모서리. 1·2·3 분할 패턴, 최대 14 회.
// 같은 자리 정점(면마다 따로 있는 STEP 정점)은 위치 키로 합쳐 중점을 공유한다.
export function refineForBumps(mesh, F, centers, R, hMax) {
  if (!centers.length) return mesh;
  let P = Array.from(mesh.positions), T = Array.from(mesh.triangles), Fi = Array.from(mesh.faceIds);
  const key = (i) => `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`;
  const pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const near2 = (a, b) => {   // 관측 평면 선분–점 거리 < R (원판 중 하나)
    const A = toFrame(F, a), B = toFrame(F, b);
    for (const c of centers) {
      const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey, t = l2 > 0 ? Math.min(1, Math.max(0, ((c[0] - A[0]) * ex + (c[1] - A[1]) * ey) / l2)) : 0;
      if (Math.hypot(A[0] + t * ex - c[0], A[1] + t * ey - c[1]) < R) return true;
    }
    return false;
  };
  const inTri = (a, b, c, p) => { const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  for (let pass = 0; pass < 14; pass++) {
    const ek = (i, j) => { const a = key(i), b = key(j); return a < b ? `${a}#${b}` : `${b}#${a}`; };
    const flag = new Set();
    for (let t = 0; t < T.length; t += 3) {
      const v = [T[t], T[t + 1], T[t + 2]], E = [[0, 1], [1, 2], [2, 0]];
      let longest = -1, lmax = 0;
      for (let e = 0; e < 3; e++) {
        const a = pt(v[E[e][0]]), b = pt(v[E[e][1]]), l = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (l > lmax) { lmax = l; longest = e; }
        if (l > hMax && near2(a, b)) flag.add(ek(v[E[e][0]], v[E[e][1]]));
      }
      if (lmax > hMax) {
        const A = toFrame(F, pt(v[0])), B = toFrame(F, pt(v[1])), C = toFrame(F, pt(v[2]));
        if (centers.some((c) => inTri(A, B, C, c))) flag.add(ek(v[E[longest][0]], v[E[longest][1]]));
      }
    }
    if (!flag.size) break;
    const mid = new Map(), NT = [], NF = [];
    const midOf = (i, j) => { const k = ek(i, j); if (!mid.has(k)) { mid.set(k, P.length / 3); P.push((P[3 * i] + P[3 * j]) / 2, (P[3 * i + 1] + P[3 * j + 1]) / 2, (P[3 * i + 2] + P[3 * j + 2]) / 2); } return mid.get(k); };
    for (let t = 0, f = 0; t < T.length; t += 3, f++) {
      const [a, b, c] = [T[t], T[t + 1], T[t + 2]], fa = flag.has(ek(a, b)), fb = flag.has(ek(b, c)), fc = flag.has(ek(c, a)), n = fa + fb + fc, id = Fi[f];
      const push = (...tri) => { NT.push(...tri); NF.push(id); };
      if (n === 0) push(a, b, c);
      else if (n === 3) { const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a); push(a, ab, ca); push(ab, b, bc); push(ca, bc, c); push(ab, bc, ca); }
      else if (n === 1) { if (fa) { const m = midOf(a, b); push(a, m, c); push(m, b, c); } else if (fb) { const m = midOf(b, c); push(a, b, m); push(a, m, c); } else { const m = midOf(c, a); push(a, b, m); push(m, b, c); } }
      else {   // 2개: 돌려서 (a,b)·(b,c) 가 표시된 꼴로
        let [x, y, z] = fa && fb ? [a, b, c] : fb && fc ? [b, c, a] : [c, a, b];
        const m1 = midOf(x, y), m2 = midOf(y, z);
        push(m1, y, m2); push(x, m1, m2); push(x, m2, z);
      }
    }
    T = NT; Fi = NF;
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(Fi) };
}

// 닫힘 점검(위치 키 기준 모든 모서리가 정확히 2개 삼각형에 속함)
export function isWatertight(m) {
  const P = m.positions, T = m.triangles, key = (i) => `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`, cnt = new Map();
  for (let t = 0; t < T.length; t += 3) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) { const a = key(T[t + i]), b = key(T[t + j]), k = a < b ? `${a}#${b}` : `${b}#${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  for (const v of cnt.values()) if (v !== 2) return false;
  return true;
}

// 후보 27개(3×3×3) — 범위는 spec §2.3 기본. LED 중심이 없으면 Δt 만 3개
export function shapeCandidates({ t0, pitch, hasCenters, ranges = null }) {
  const lin = ([a, b]) => [a, (a + b) / 2, b].map((v) => Math.round(v * 1e4) / 1e4);
  const r = ranges ?? { dt: [-0.5 * t0, 1.0 * t0], h: [-0.5 * t0, 0.5 * t0], R: [0.3 * pitch, 0.8 * pitch] };
  const out = [];
  for (const dt of lin(r.dt)) {
    if (!hasCenters) { out.push({ dt, h: 0, R: 1 }); continue; }
    for (const h of lin(r.h)) for (const R of lin(r.R)) out.push({ dt, h, R });
  }
  return out;
}
