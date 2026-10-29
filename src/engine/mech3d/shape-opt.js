// ③ LGP 형상 — spec P4 §2.3. 관측 좌표계(u,v,d: d = 관측자 쪽) 에서 부품을 자유형 변형한다.
// 아랫면 이동량 D(x,y) = Δt − h·Σ bump(|p−c|/R)  (D>0 = 아래로 = 두꺼워짐, h>0 = LED 위 포켓)
// 정점 z' = z − w·D(x,y), w = (z_t − z)/(z_t − z_b) — 윗면(관측면 쪽) 고정, 아랫면만 움직이고 사이는 선형. 같은 자리 정점은 같은 결과라 닫힘 유지.
import { meshToHeightfield } from '../shape/heightfield.js';
import { meshVolume } from './mesh.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const bump = (r) => (r >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * r)));
export const toFrame = (F, p) => [dot(p, F.u), dot(p, F.v), dot(p, F.d)];
export const fromFrame = (F, q) => [0, 1, 2].map((k) => q[0] * F.u[k] + q[1] * F.v[k] + q[2] * F.d[k]);

// 형상 기준 좌표 — 대상 부품의 윗면(관측 쪽) 방향. 관측 좌표 F 의 d 쪽을 보는(n·d > minDot) 삼각형들의 면적 가중 법선 = d',
// v' = F.v 를 d' 에 수직으로, u' = v' × d'(F 와 같은 손잡이). 관측면이 기울거나 꺾여 있어도(예: 꺾인 확산판 → 14.5°) 상자형 도광판의
// 옆면이 비스듬히 잡혀 두께가 얇게 재지던 것(→ 모든 형상 후보 살두께 탈락, 2026-10-29) 방지. 이미 거의 같으면(d'·d > 0.9995) F 그대로
export function partFrame(mesh, F, minDot = 0.5) {
  const P = mesh.positions, T = mesh.triangles, n = [0, 0, 0];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
    if (l > 0 && (cx * F.d[0] + cy * F.d[1] + cz * F.d[2]) / l > minDot) { n[0] += cx; n[1] += cy; n[2] += cz; }   // 면적 가중(|cross| = 2·면적)
  }
  const nl = Math.hypot(...n); if (!(nl > 0)) return F;
  const d = n.map((x) => x / nl); if (dot(d, F.d) > 0.9995) return F;
  const pv = dot(F.v, d), v0 = F.v.map((x, k) => x - pv * d[k]), vl = Math.hypot(...v0); if (!(vl > 1e-9)) return F;
  const v = v0.map((x) => x / vl), u = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
  return { u, v, d };
}

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

// ---- 라인 좌표 (s, w) — spec §2.3a. 중심선 폴리라인(관측 좌표 [x,y], 1 mm 간격)·반폭·닫힘은 shapeMod 에 저장 ----
// 중심선 표본: line.fromSW(s,0) → line.to3D → 관측 좌표 [x,y]. 닫힌 라인은 끝점 중복 없이. L = 표본 폴리라인 길이
export function pathFromLine(line, F, step = 1) {
  const n = Math.max(1, Math.ceil(line.length / step)), path = [];
  for (let i = 0; i < (line.closed ? n : n + 1); i++) {
    const [x, y] = line.fromSW((line.length * i) / n, 0), q = toFrame(F, line.to3D(x, y, 0));
    path.push([q[0], q[1]]);
  }
  return { path, halfW: line.width / 2, closed: !!line.closed, L: pathIndex(path, !!line.closed).L };
}
// 선분 격자 버킷(셀 2 mm) — 경로 배열별 메모(WeakMap)
const PCELL = 2, pIdx = new WeakMap();
function pathIndex(path, closed) {
  let I = pIdx.get(path); if (I && I.closed === closed) return I;
  const n = path.length, ns = closed ? n : n - 1, cum = new Float64Array(ns + 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of path) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const nx = Math.max(1, Math.ceil((x1 - x0) / PCELL) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / PCELL) + 1), cells = new Map();
  for (let k = 0; k < ns; k++) {
    const a = path[k], b = path[(k + 1) % n]; cum[k + 1] = cum[k] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    const i0 = Math.floor((Math.min(a[0], b[0]) - x0) / PCELL), i1 = Math.floor((Math.max(a[0], b[0]) - x0) / PCELL);
    const j0 = Math.floor((Math.min(a[1], b[1]) - y0) / PCELL), j1 = Math.floor((Math.max(a[1], b[1]) - y0) / PCELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = j * nx + i, L = cells.get(c); if (L) L.push(k); else cells.set(c, [k]); }
  }
  I = { closed, n, ns, cum, L: cum[ns], x0, y0, nx, ny, cells }; pIdx.set(path, I);
  return I;
}
// 최근접 선분 투영 → [s, w] (s = 누적 길이, w = 진행 방향 왼쪽 +). 열린 경로의 끝 밖은 첫·끝 선분 연장(s < 0 또는 > L)
export function swOnPath(P, x, y) {
  const path = P.path, I = pathIndex(path, !!P.closed);
  if (!I.ns) return [0, 0];
  const ci = Math.floor((x - I.x0) / PCELL), cj = Math.floor((y - I.y0) / PCELL);
  const rMax = Math.max(Math.abs(ci), Math.abs(ci - I.nx + 1), Math.abs(cj), Math.abs(cj - I.ny + 1));
  let best = Infinity, bk = -1, bt = 0;
  const test = (k) => {
    const a = path[k], b = path[(k + 1) % I.n], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)) : 0;
    const d = Math.hypot(a[0] + t * ex - x, a[1] + t * ey - y);
    if (d < best || (d === best && k < bk)) { best = d; bk = k; bt = t; }
  };
  for (let r = 0; r <= rMax; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      if (j < 0 || j >= I.ny) continue;
      const step = j === cj - r || j === cj + r ? 1 : 2 * r;   // 고리 칸만
      for (let i = ci - r; i <= ci + r; i += Math.max(1, step)) {
        if (i < 0 || i >= I.nx) continue;
        const L = I.cells.get(j * I.nx + i); if (L) for (const k of L) test(k);
      }
    }
    if (best <= r * PCELL) break;   // 바깥 고리 선분은 r·셀 보다 멀다
  }
  const a = path[bk], b = path[(bk + 1) % I.n], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
  if (!(l > 0)) return [I.cum[bk], 0];
  const tr = ((x - a[0]) * ex + (y - a[1]) * ey) / (l * l), cr = (ex * (y - a[1]) - ey * (x - a[0])) / l;
  if (!I.closed && ((bk === 0 && tr < 0) || (bk === I.ns - 1 && tr > 1))) return [I.cum[bk] + tr * l, cr];
  return [I.cum[bk] + bt * l, cr < 0 ? -best : best];
}
// 끝단 창: 열린 경로 양 끝(길이 ell) 1 → 0 코사인. 닫힌 경로 0
export function endW(s, L, ell, closed = false) {
  if (closed || !(ell > 0)) return 0;
  const t = Math.max(0, Math.min(s, L - s));
  return t < ell ? 0.5 * (1 + Math.cos((Math.PI * t) / ell)) : 0;
}
// 아랫면 이동량 D = Δt − h·Σbump + e·endW(s) + c·min(1, (w/W½)²). e·c 가 0 이거나 경로가 없으면 (s,w) 생략(기존과 비트 동일)
const disp = (x, y, prm) => {
  const { dt, h, R, centers } = prm; let b = 0;
  for (const c of centers) b += bump(Math.hypot(x - c[0], y - c[1]) / R);
  let D = dt - h * b;
  const e = prm.e ?? 0, cc = prm.c ?? 0;
  if ((e || cc) && prm.path?.length) {
    const [s, w] = swOnPath(prm, x, y);
    if (e) D += e * endW(s, pathIndex(prm.path, !!prm.closed).L, prm.ell, prm.closed);
    if (cc) D += cc * Math.min(1, (w / prm.halfW) ** 2);
  }
  return D;
};
// 끝단 창 길이 ℓ = LED 피치: 피치 > 0 → 그 값 · 균등(count > 1) → L/count · 발광점 s 목록(LED STEP 원래) → 평균 간격 · LED 1개 → L/4
export function ledEll({ pitch = 0, count = 0, ss = null, L }) {
  if (pitch > 0) return pitch;
  if (count > 1) return L / count;
  const s = (ss ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  return s.length > 1 && s.at(-1) > s[0] ? (s.at(-1) - s[0]) / (s.length - 1) : L / 4;
}
// e·c 가 있으면 아랫면 세분 최대 변 max(R/2, 2 mm), 없으면 0(세분 안 함)
export const lineVarH = (prm) => ((prm.e ?? 0) || (prm.c ?? 0) ? Math.max((prm.R ?? 0) / 2, 2) : 0);

// 변형 메쉬(같은 삼각형·면 번호, 새 정점 위치). 부피는 다시 셈. 두께 하한 MIN_T(그 자리 D 를 자름)
// 주의: zt·zb 는 높이맵 칸 값 — 기울어진 윗면은 칸 안 기울기만큼(≈ slope·cell/2t) 만 고정됨(평판 가정)
export const MIN_T = 0.05;
export function deformPart(mesh, F, H, prm) {
  if (prm.centers?.length && !(prm.R > 0)) throw new Error('형상 변경: LED 중심이 있으면 R > 0 이어야 함');
  const P = mesh.positions, out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]), { zt, zb } = H.at(q[0], q[1]);
    const w = zt - zb > 1e-9 ? Math.min(1, Math.max(0, (zt - q[2]) / (zt - zb))) : 0;
    q[2] -= w * Math.max(MIN_T - (zt - zb), disp(q[0], q[1], prm));
    const p = fromFrame(F, q); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: out, volume: meshVolume(out, mesh.triangles) };
}

// 변형 아랫면 z_b'(x,y) = zb − D (deformPart 의 w = 1 정점과 같은 식, 두께 하한 포함)
export function bottomAt(H, prm) {
  return (x, y) => { const { zt, zb } = H.at(x, y); return zb - Math.max(MIN_T - (zt - zb), disp(x, y, prm)); };
}
// ③ STEP 곡면 입력 — 외곽 직사각형(관측 좌표 높이맵 채움률 ≥ 0.98)·윗면 평평(zt 편차 ≤ 0.01)·비 2.5D 0 일 때만, 아니면 null.
// 격자 간격 ≤ R/4(없으면 1 mm), 긴 축 ≤ 120·짧은 축 ≤ 60 점. 바깥으로 한 칸씩 더 표본(곡면이 외곽 상자보다 넓게 — 옆면은 상자가 자름)
export function splineInput(base, H, prm) {
  const F = prm.frame, P = base.positions, { hf, cx, cy, zmax } = H;
  if (H.non25 > 0) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  let all = 0, fill = 0, zlo = Infinity, zhi = -Infinity;
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
    const k = j * hf.nx + i, x = cx + hf.x0 + (i + 0.5) * hf.cell, y = cy + hf.y0 + (j + 0.5) * hf.cell;
    if (hf.mask[k]) { zlo = Math.min(zlo, hf.zt[k]); zhi = Math.max(zhi, hf.zt[k]); }
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    all++; if (hf.mask[k]) fill++;
  }
  if (!all || fill / all < 0.98 || zhi - zlo > 0.01) return null;
  const W = x1 - x0, L = y1 - y0, s = prm.R > 0 ? prm.R / 4 : 1, cap = (a, b) => (a >= b ? 120 : 60);
  const ix = Math.max(2, Math.min(cap(W, L) - 3, Math.ceil(W / s))), iy = Math.max(2, Math.min(cap(L, W) - 3, Math.ceil(L / s)));
  const nx = ix + 3, ny = iy + 3, dx = W / ix, dy = L / iy, gx = x0 - dx, gy = y0 - dy, z = new Float64Array(nx * ny), B = bottomAt(H, prm);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = B(gx + i * dx, gy + j * dy);
  return { frame: { u: [...F.u], v: [...F.v], d: [...F.d] }, rect: [x0, x1, y0, y1], zTop: zhi + zmax, grid: { nx, ny, x0: gx, dx, y0: gy, dy, z } };
}

// 최소 두께(관측 좌표, 마스크 칸 중심 + LED 중심) — 제약 점검용
export function minThickness(H, prm) {
  const { hf, cx, cy } = H; let mn = Infinity;
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
    const k = j * hf.nx + i; if (!hf.mask[k]) continue;
    const x = cx + hf.x0 + (i + 0.5) * hf.cell, y = cy + hf.y0 + (j + 0.5) * hf.cell;
    mn = Math.min(mn, hf.zt[k] - hf.zb[k] + disp(x, y, prm));
  }
  for (const c of prm.centers ?? []) { const { zt, zb } = H.at(c[0], c[1]); mn = Math.min(mn, zt - zb + disp(c[0], c[1], prm)); }
  return mn;
}

// 정점 합치기(허용오차 공간 해시, 이웃 27칸 탐색) → 대표 번호. tol 기본 = 1e-6·외곽 대각선
export function weldTol(P) {
  const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], P[i + k]); b[k] = Math.max(b[k], P[i + k]); }
  return P.length ? Math.max(1e-12, 1e-6 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) : 1e-12;
}
export function weld(P, tol = weldTol(P)) {
  const n = P.length / 3, id = new Int32Array(n), rep = [], grid = new Map(), t2 = tol * tol;
  const hk = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791));
  for (let v = 0; v < n; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], ix = Math.floor(x / tol), iy = Math.floor(y / tol), iz = Math.floor(z / tol);
    let found = -1;
    for (let dz = -1; dz <= 1 && found < 0; dz++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dx = -1; dx <= 1 && found < 0; dx++) {
      const L = grid.get(hk(ix + dx, iy + dy, iz + dz)); if (!L) continue;
      for (const c of L) { const ex = rep[3 * c] - x, ey = rep[3 * c + 1] - y, ez = rep[3 * c + 2] - z; if (ex * ex + ey * ey + ez * ez <= t2) { found = c; break; } }
    }
    if (found < 0) {
      found = rep.length / 3; rep.push(x, y, z);
      const k = hk(ix, iy, iz), L = grid.get(k); if (L) L.push(found); else grid.set(k, [found]);
    }
    id[v] = found;
  }
  return { id, rep, count: rep.length / 3 };
}

// LED 원판(반경 R) 부근 국부 세분 — Rivara 가장 긴 모서리 이분(최소각 ≥ 처음 최소각의 절반 정도로 유지).
// 표시: 길이 > hMax 이고 원판과 가까운(관측 평면 거리 < R) 모서리 + 원판 중심을 품은 삼각형의 가장 긴 모서리.
// 닫힘: 표시 모서리를 가진 삼각형은 자기 가장 긴 모서리도 표시(안정될 때까지) → 분할은 늘 가장 긴 모서리부터. 최대 40 회.
// 모서리·중점은 대표 정점(허용오차 합치기) 기준 — 1 ulp 어긋난 중복 정점도 중점 공유. 출력 정점은 (모서리, 면 번호)별로 따로(면별 정점 유지).
// opts.H(frameHeights) 가 있으면 세 정점 모두 윗면(w=0)인 삼각형은 표시를 만들지 않음(닫힘 전파로만 나뉨).
// opts.hBottom > 0 이면 (윗면 아닌) 삼각형의 가장 긴 모서리 > hBottom 도 표시 — e·c 항(넓고 매끈)용 고른 세분.
const EK = 67108864;   // 2^26 — 정수 모서리 키 a·EK + b (a<b)
const ekey = (a, b) => (a < b ? a * EK + b : b * EK + a);
export function refineForBumps(mesh, F, centers, R, hMax, opts = {}) {
  const hb2 = opts.hBottom > 0 ? opts.hBottom * opts.hBottom : Infinity;
  if (!centers.length && hb2 === Infinity) return mesh;
  const P = Array.from(mesh.positions), W = weld(mesh.positions), cid = Array.from(W.id), C = W.rep;
  let T = Array.from(mesh.triangles), Fi = Array.from(mesh.faceIds);
  const Q = [];   // 대표 정점별 관측 좌표(x, y)·윗면 여부
  const addQ = (c) => {
    const q = toFrame(F, [C[3 * c], C[3 * c + 1], C[3 * c + 2]]);
    Q.push(q[0], q[1], opts.H && opts.H.at(q[0], q[1]).zt - q[2] < 1e-6 ? 1 : 0);
  };
  for (let c = 0; c < W.count; c++) addQ(c);
  const len2 = (a, b) => { const x = C[3 * a] - C[3 * b], y = C[3 * a + 1] - C[3 * b + 1], z = C[3 * a + 2] - C[3 * b + 2]; return x * x + y * y + z * z; };
  const near2 = (a, b) => {   // 관측 평면 선분–점 거리 < R (원판 중 하나)
    const ax = Q[3 * a], ay = Q[3 * a + 1], bx = Q[3 * b], by = Q[3 * b + 1], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    const x0 = Math.min(ax, bx) - R, x1 = Math.max(ax, bx) + R, y0 = Math.min(ay, by) - R, y1 = Math.max(ay, by) + R;
    for (const c of centers) {
      if (c[0] < x0 || c[0] > x1 || c[1] < y0 || c[1] > y1) continue;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((c[0] - ax) * ex + (c[1] - ay) * ey) / l2)) : 0;
      if (Math.hypot(ax + t * ex - c[0], ay + t * ey - c[1]) < R) return true;
    }
    return false;
  };
  const inTri = (a, b, c, p) => {
    const s = (i, j) => (p[0] - Q[3 * j]) * (Q[3 * i + 1] - Q[3 * j + 1]) - (Q[3 * i] - Q[3 * j]) * (p[1] - Q[3 * j + 1]);
    const ar = (Q[3 * b] - Q[3 * a]) * (Q[3 * c + 1] - Q[3 * a + 1]) - (Q[3 * c] - Q[3 * a]) * (Q[3 * b + 1] - Q[3 * a + 1]);
    if (Math.abs(ar) < 1e-12) return false;   // 관측 방향으로 선(옆면)
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  // 가장 긴 모서리(대표 정점 기준, 같으면 키 큰 쪽 — 중복 삼각형도 같은 결과) → 0·1·2 (v0v1, v1v2, v2v0)
  const longest = (c, flag = null) => {
    let e = -1, le = -1, ke = -1;
    for (let k = 0; k < 3; k++) {
      const kk = ekey(c[k], c[(k + 1) % 3]); if (flag && !flag.has(kk)) continue;
      const l = len2(c[k], c[(k + 1) % 3]);
      if (l > le || (l === le && kk > ke)) { e = k; le = l; ke = kk; }
    }
    return e;
  };
  const h2 = hMax * hMax, tc = (t) => [cid[T[3 * t]], cid[T[3 * t + 1]], cid[T[3 * t + 2]]];
  let fresh = null;   // 지난 회차에 새로 생긴 삼각형(그 밖은 모서리가 그대로라 규칙을 다시 볼 필요 없음)
  for (let pass = 0; pass < 40; pass++) {
    const nT = T.length / 3, flag = new Set(), queue = [];
    const mark = (k) => { if (!flag.has(k)) { flag.add(k); queue.push(k); } };
    const check = (t) => {
      const v = tc(t);
      if (opts.H && Q[3 * v[0] + 2] && Q[3 * v[1] + 2] && Q[3 * v[2] + 2]) return;   // 윗면 — 세분 불필요
      let lmax = 0;
      for (let e = 0; e < 3; e++) {
        const a = v[e], b = v[(e + 1) % 3], l = len2(a, b);
        if (l > lmax) lmax = l;
        if (l > h2 && near2(a, b)) mark(ekey(a, b));
      }
      if ((lmax > h2 && centers.some((c) => inTri(v[0], v[1], v[2], c))) || lmax > hb2) { const e = longest(v); mark(ekey(v[e], v[(e + 1) % 3])); }
    };
    if (fresh) for (const t of fresh) check(t); else for (let t = 0; t < nT; t++) check(t);
    if (!flag.size) break;
    // 닫힘(Rivara): 모서리 → 삼각형 목록 + 작업 큐
    const adj = new Map();
    for (let t = 0; t < nT; t++) { const v = tc(t); for (let e = 0; e < 3; e++) { const k = ekey(v[e], v[(e + 1) % 3]), L = adj.get(k); if (L) L.push(t); else adj.set(k, [t]); } }
    while (queue.length) for (const t of adj.get(queue.pop()) ?? []) { const v = tc(t), e = longest(v); mark(ekey(v[e], v[(e + 1) % 3])); }
    // 분할: 표시 모서리 중 가장 긴 것을 이분하고 두 조각에 되풀이(1개 = 가장 긴 모서리, 2개 = 가장 긴 + 중점 대각선, 3개 = 4분할 꼴)
    const midC = new Map(), midV = new Map(), NT = [], NF = [];
    const midOf = (i, j, f) => {
      const a = cid[i], b = cid[j], k = ekey(a, b);
      let m = midC.get(k);
      if (m === undefined) { m = C.length / 3; C.push((C[3 * a] + C[3 * b]) / 2, (C[3 * a + 1] + C[3 * b + 1]) / 2, (C[3 * a + 2] + C[3 * b + 2]) / 2); addQ(m); midC.set(k, m); }
      const kv = `${k}|${f}`;   // (모서리, 면)
      let v = midV.get(kv);
      if (v === undefined) { v = P.length / 3; P.push(C[3 * m], C[3 * m + 1], C[3 * m + 2]); cid.push(m); midV.set(kv, v); }
      return v;
    };
    const emit = (x, y, z, f) => {
      const v = [x, y, z], e = longest([cid[x], cid[y], cid[z]], flag);
      if (e < 0) { NT.push(x, y, z); NF.push(f); return; }
      const a = v[e], b = v[(e + 1) % 3], o = v[(e + 2) % 3], m = midOf(a, b, f);
      emit(a, m, o, f); emit(m, b, o, f);
    };
    fresh = [];
    for (let t = 0; t < nT; t++) {
      const n0 = NT.length; emit(T[3 * t], T[3 * t + 1], T[3 * t + 2], Fi[t]);
      if (NT.length - n0 > 3) for (let k = n0; k < NT.length; k += 3) fresh.push(k / 3);
    }
    T = NT; Fi = NF;
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(Fi) };
}

// 닫힘 점검(허용오차 합치기 기준 모든 모서리가 정확히 2개 삼각형에 속함)
export function isWatertight(m) {
  const T = m.triangles, { id } = weld(m.positions), cnt = new Map();
  for (let t = 0; t < T.length; t += 3) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) { const k = ekey(id[T[t + i]], id[T[t + j]]); cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  for (const v of cnt.values()) if (v !== 2) return false;
  return true;
}

// 메모(작은 LRU) — 메쉬 객체별(WeakMap) × 나머지 인자 JSON. 후보 27개도 세분은 R 개수(3)번만
const LRU_N = 6, memoR = new WeakMap(), memoH = new WeakMap(), stats = { refine: 0, heights: 0 };
function lru(map, mesh, key, make) {
  let L = map.get(mesh); if (!L) map.set(mesh, (L = []));
  const i = L.findIndex((e) => e.k === key);
  if (i >= 0) { const [e] = L.splice(i, 1); L.push(e); return e.v; }
  const v = make(); L.push({ k: key, v }); if (L.length > LRU_N) L.shift();
  return v;
}
export const memoStats = () => ({ ...stats });
export function heightsFor(mesh, F, cell = 0.5) {
  return lru(memoH, mesh, JSON.stringify([F.u, F.v, F.d, cell]), () => { stats.heights++; return frameHeights(mesh, F, cell); });
}
export function refinedFor(mesh, F, centers, R, hMax, hBottom = 0) {
  return lru(memoR, mesh, JSON.stringify([F.u, F.v, F.d, centers, R, hMax, hBottom]), () => { stats.refine++; return refineForBumps(mesh, F, centers, R, hMax, { H: heightsFor(mesh, F, 0.5), hBottom }); });
}

// 후보 27개(3×3×3) — 범위는 spec §2.3 기본. LED 중심이 없으면 Δt 만 3개
// Δt·h 는 {lo, 0, hi} — 현재 형상(Δt=0·h=0)이 늘 후보에 들게(가운데 값 대신 0). R 은 {lo, 중간, hi}
export function shapeCandidates({ t0, pitch, hasCenters, ranges = null }) {
  const rd = (v) => Math.round(v * 1e4) / 1e4;
  const lin = ([a, b]) => [a, (a + b) / 2, b].map(rd);
  const withZero = ([a, b]) => [...new Set([a, 0, b].map(rd))].sort((x, y) => x - y);
  const r = ranges ?? { dt: [-0.5 * t0, 1.0 * t0], h: [-0.5 * t0, 0.5 * t0], R: [0.3 * pitch, 0.8 * pitch] };
  const out = [];
  for (const dt of withZero(r.dt)) {
    if (!hasCenters) { out.push({ dt, h: 0, R: 1 }); continue; }
    for (const h of withZero(r.h)) for (const R of lin(r.R)) out.push({ dt, h, R });
  }
  return out;
}

// ③ 변수 범위(spec §2.3a) — h·R 은 LED 중심이 있을 때만
export function shapeVarRanges({ t0, pitch, hasCenters }) {
  const r = { dt: [-0.5 * t0, 1.0 * t0], e: [-0.5 * t0, 0.5 * t0], c: [-0.5 * t0, 0.5 * t0] };
  if (hasCenters) { r.h = [-0.5 * t0, 0.5 * t0]; r.R = [0.3 * pitch, 0.8 * pitch]; }
  return r;
}
// 고른 변수의 3^k 격자 — {lo, 0, hi}(R 은 {lo, mid, hi}). 고르지 않은 변수는 0, R 은 mid(범위 없으면 1). 현재 형상(전부 0) 포함
// levels 5 = {lo, lo/2, 0, hi/2, hi} — 중간값까지(변수가 적을 때 autodesign 이 고름)
export function gridCandidates(vars, ranges, levels = 3) {
  const rd = (v) => Math.round(v * 1e4) / 1e4;
  const Rm = ranges.R ? rd((ranges.R[0] + ranges.R[1]) / 2) : 1;
  const lv = (lo, hi) => (levels === 5 ? [lo, lo / 2, 0, hi / 2, hi] : [lo, 0, hi]);
  const vals = (k) => (k === 'R' ? [ranges.R[0], (ranges.R[0] + ranges.R[1]) / 2, ranges.R[1]].map(rd) : [...new Set(lv(ranges[k][0], ranges[k][1]).map(rd))].sort((a, b) => a - b));
  let out = [{ dt: 0, h: 0, R: Rm, e: 0, c: 0 }];
  for (const k of vars) { if (!ranges[k]) continue; const V = vals(k); out = out.flatMap((g) => V.map((v) => ({ ...g, [k]: v }))); }
  return out;
}
