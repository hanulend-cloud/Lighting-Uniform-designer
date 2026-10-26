// 관측면 색지도 — spec 2026-10-15 m3-cad-ui §2: 관측면 메쉬 정점 → (s,w) → 집계 지도 칸 값 → 색. 순수 함수(Node 시험).
// STEP 관측면은 삼각형이 커서(평면 = 2개) 정점 색으로는 분포가 안 보인다 → 집계 칸 크기까지 세분한 덧그림 메쉬를 만든다.
const STOPS = [[0x20, 0x30, 0x6e], [0x2a, 0x7b, 0xd5], [0x3f, 0xc1, 0x7a], [0xf2, 0xd3, 0x3c], [0xe0, 0x53, 0x2a]];
export const NO_DATA = [0.42, 0.45, 0.5];
// t(0~1) → [r,g,b](0~1) — 시안(m3-ui-mockup) 색 막대
export function ramp(t) {
  t = Math.max(0, Math.min(0.9999, t)) * 4;
  const i = Math.floor(t), f = t - i, a = STOPS[i], b = STOPS[i + 1];
  return [0, 1, 2].map((k) => (a[k] + f * (b[k] - a[k])) / 255);
}
// 부품 메쉬에서 면 번호 집합의 삼각형만(정점 번호 다시 매김)
export function extractFaces(mesh, faceSet) {
  const P = mesh.positions, T = mesh.triangles, F = mesh.faceIds, remap = new Map(), pos = [], tri = [];
  for (let t = 0; t < F.length; t++) {
    if (!faceSet.has(F[t])) continue;
    for (let j = 0; j < 3; j++) {
      const v = T[3 * t + j];
      let k = remap.get(v);
      if (k === undefined) { k = pos.length / 3; remap.set(v, k); pos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      tri.push(k);
    }
  }
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tri) };
}
// 삼각형마다 n×n 균등 세분(n = ⌈최대 변/maxEdge⌉). 합계가 maxTris 를 넘으면 maxEdge 를 1.25배씩 키운다. 감김 방향은 원래와 같다.
export function subdivide(m, maxEdge, maxTris = 200000) {
  const P = m.positions, T = m.triangles, nT = T.length / 3, Lmax = new Float64Array(nT);
  const d = (a, b) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
  for (let t = 0; t < nT; t++) { const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]; Lmax[t] = Math.max(d(a, b), d(b, c), d(c, a)); }
  let e = maxEdge;
  const nCap = Math.max(1, Math.floor(Math.sqrt(maxTris)));   // 삼각형 하나가 n² 로 폭주하지 않게
  const nOf = (t) => Math.min(nCap, Math.max(1, Math.ceil(Lmax[t] / e - 1e-9)));   // 각자 자기 최장 변으로
  for (;;) { let tot = 0; for (let t = 0; t < nT; t++) tot += nOf(t) ** 2; if (tot <= maxTris || tot === nT || e > 1e9) break; e *= 1.25; }   // tot === nT: 전부 n=1(더 줄일 수 없음)
  const pos = [], tri = [];
  for (let t = 0; t < nT; t++) {
    const n = nOf(t), A = 3 * T[3 * t], B = 3 * T[3 * t + 1], C = 3 * T[3 * t + 2], base = pos.length / 3;
    const id = (i, j) => base + (i * (2 * n + 3 - i)) / 2 + j;   // 행 i(0..n) 에 정점 n−i+1 개
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n;
      for (let k = 0; k < 3; k++) pos.push(P[A + k] + u * (P[B + k] - P[A + k]) + v * (P[C + k] - P[A + k]));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      tri.push(id(i, j), id(i + 1, j), id(i, j + 1));
      if (j < n - i - 1) tri.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
  }
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tri) };
}
// (s,w) → 집계 칸 번호(tally.js makeAccumulator 와 같은 규칙) 또는 −1
export function cellIndex(G, s, w) {
  let i = Math.floor(s / G.ds);
  if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return -1;
  const j = Math.floor((w - G.w0) / G.cell);
  if (j < 0 || j >= G.nw) return -1;
  return i * G.nw + j;
}
// (s,w) 의 칸이 유효하면 그 칸, 아니면 같은 s 행(없으면 가까운 행)의 가장 가까운 유효 칸 — 관측면 가장자리 정점용
function nearestValid(G, s, w) {
  let i = Math.floor(s / G.ds);
  i = G.closed ? ((i % G.ns) + G.ns) % G.ns : Math.max(0, Math.min(G.ns - 1, i));
  const j = Math.max(0, Math.min(G.nw - 1, Math.floor((w - G.w0) / G.cell)));
  if (G.valid[i * G.nw + j]) return i * G.nw + j;   // 자기 칸이 유효하면 바로
  for (let di = 0; di < G.ns; di++) {
    for (const sg of di ? [-1, 1] : [1]) {
      let ii = i + sg * di;
      if (G.closed) ii = ((ii % G.ns) + G.ns) % G.ns; else if (ii < 0 || ii >= G.ns) continue;
      let best = -1, bd = Infinity;
      for (let jj = 0; jj < G.nw; jj++) if (G.valid[ii * G.nw + jj] && Math.abs(jj - j) < bd) { bd = Math.abs(jj - j); best = ii * G.nw + jj; }
      if (best >= 0) return best;
    }
  }
  return -1;
}
// 정점 → 집계 칸 번호(격자마다 한 번만 구한다)
export function vertexCells(positions, line, G) {
  const n = positions.length / 3, out = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const [x, y] = line.to2D([positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]]), [s, w] = line.toSW(x, y);
    out[v] = nearestValid(G, s, w);
  }
  return out;
}
// 칸 값(map) → 정점 색(유효 칸 최대 대비, 같은 색 막대). 칸 없음(−1) = 회색
export function cellColors(cells, map, valid, out = null) {
  let mx = 0;
  for (let k = 0; k < map.length; k++) if (valid[k] && map[k] > mx) mx = map[k];
  const c = out ?? new Float32Array(cells.length * 3);
  for (let v = 0; v < cells.length; v++) {
    const k = cells[v], rgb = k >= 0 && mx > 0 ? ramp(map[k] / mx) : NO_DATA;
    c[3 * v] = rgb[0]; c[3 * v + 1] = rgb[1]; c[3 * v + 2] = rgb[2];
  }
  return c;
}
// 관측면 덧그림 메쉬: 관측면 삼각형을 min(ds, cell) 까지 세분, 관측 방향으로 lift 띄움, 정점별 칸 번호
// lift 0.01 mm: 관측면 = 고른 면을 면 방향으로 0.01 mm 앞에 그대로 투영한 가상 검출면(사용자 의견 2026-10-26) — 겹침 깜빡임은 polygonOffset 이 막음
export function buildObsOverlay(parts, faces, line, G, { maxTris = 200000, lift = 0.01 } = {}) {
  const byPart = new Map();
  for (const f of faces) { if (!byPart.has(f.part)) byPart.set(f.part, new Set()); byPart.get(f.part).add(f.face); }
  const maxEdge = Math.min(G.ds, G.cell), d = line.frame.d, pos = [], tri = [];
  for (const [p, set] of byPart) {
    const s = subdivide(extractFaces(parts[p], set), maxEdge, Math.floor(maxTris / byPart.size)), base = pos.length / 3;
    for (let k = 0; k < s.positions.length; k += 3) pos.push(s.positions[k] + lift * d[0], s.positions[k + 1] + lift * d[1], s.positions[k + 2] + lift * d[2]);
    for (const t of s.triangles) tri.push(t + base);
  }
  const positions = Float32Array.from(pos);
  return { positions, triangles: Uint32Array.from(tri), cells: vertexCells(positions, line, G) };
}
