// ③ LGP 형상: node test/mech3d-shape-opt.mjs
import { frameHeights, deformPart, refineForBumps, bump, minThickness, shapeCandidates, isWatertight, refinedFor, heightsFor, memoStats } from '../src/engine/mech3d/shape-opt.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const frame = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] };   // 관측 = +z
const plate = boxMesh(0, 0, 0, 40, 10, 2);
{ const H = frameHeights(plate, frame, 0.5), z = H.at(20, 5);
  ok(Math.abs(z.zt - 2) < 1e-6 && Math.abs(z.zb) < 1e-6 && H.non25 === 0, `관측 좌표 높이: 윗면 2 · 아랫면 0 (${z.zt}, ${z.zb})`);
  ok(Math.abs(H.at(40, 10).zt - 2) < 1e-6, '외곽 점은 가장 가까운 칸 값'); }
{ // A-4 ①: 두께 오프셋 Δt = 0.5 → 부피 = 40·10·2.5, 윗면 고정
  const H = frameHeights(plate, frame, 0.5), m = deformPart(plate, frame, H, { dt: 0.5, h: 0, R: 1, centers: [] });
  const V = meshVolume(m.positions, m.triangles), zs = [];
  for (let i = 2; i < m.positions.length; i += 3) zs.push(m.positions[i]);
  ok(Math.abs(V - 1000) < 1e-3 && Math.max(...zs) === 2 && Math.abs(Math.min(...zs) + 0.5) < 1e-6 && m.faceIds === plate.faceIds, `Δt 0.5: 부피 ${V.toFixed(3)} = 1000, 윗면 고정`); }
{ // A-4 ②: 국부 포켓 h=0.5, R=4, 중심 2곳(높이맵 칸 중심에 맞춤) → 부피 = 800 − 2·h·∫bump = 800 − 2·0.5·(π R²(1/2 − 2/π²))
  const centers = [[10.25, 5.25], [30.25, 5.25]], R = 4, h = 0.5;
  const H = frameHeights(plate, frame, 0.5), ref = refineForBumps(plate, frame, centers, R, 0.25);
  const m = deformPart(ref, frame, H, { dt: 0, h, R, centers });
  const ib = Math.PI * R * R * (0.5 - 2 / (Math.PI * Math.PI)), want = 800 - 2 * h * ib, V = meshVolume(m.positions, m.triangles);
  ok(Math.abs(V / want - 1) < 0.005, `포켓 부피 ${V.toFixed(2)} ≈ 해석 ${want.toFixed(2)} (±0.5%)`);
  ok(isWatertight(m), '세분·변형 뒤 닫힌 메쉬(모든 모서리 = 삼각형 2개)');
  ok(Math.abs(bump(0) - 1) < 1e-12 && bump(1) === 0 && Math.abs(bump(0.5) - 0.5) < 1e-12, 'bump: 코사인 창');
  ok(Math.abs(minThickness(H, { dt: 0, h, R, centers }) - 1.5) < 1e-6, '최소 두께 = 2 − h'); }
{ const C = shapeCandidates({ t0: 2, pitch: 20, hasCenters: true });
  ok(C.length === 27 && C.some((c) => c.dt === -1 && c.h === -1 && c.R === 6) && C.some((c) => c.dt === 2 && c.h === 1 && c.R === 16), '후보 27개: Δt ∈ [−0.5t₀, t₀], h ∈ [−0.5t₀, 0.5t₀], R ∈ [0.3p, 0.8p]');
  ok(shapeCandidates({ t0: 2, pitch: 20, hasCenters: false }).length === 3, 'LED 중심 없음 → Δt 만 3개'); }
// ---- 리뷰 반영 ----
const grid40 = () => { const C = []; for (let j = 0; j < 5; j++) for (let i = 0; i < 8; i++) C.push([18.75 + 37.5 * i, 20 + 40 * j]); return C; };
const segD = (A, B, c) => { const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey, t = l2 > 0 ? Math.min(1, Math.max(0, ((c[0] - A[0]) * ex + (c[1] - A[1]) * ey) / l2)) : 0; return Math.hypot(A[0] + t * ex - c[0], A[1] + t * ey - c[1]); };
{ // Rivara 세분: 300×200×3 판, LED 40개(37.5×40 격자), R=15, hMax=R/8
  const big = boxMesh(0, 0, 0, 300, 200, 3), C = grid40(), R = 15, hMax = R / 8, H = frameHeights(big, frame, 0.5);
  const t0 = performance.now(), ref = refineForBumps(big, frame, C, R, hMax, { H }), ms = performance.now() - t0;
  const P = ref.positions, T = ref.triangles, pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  let bad = 0, minAng = 180;
  for (let t = 0; t < T.length; t += 3) {
    const v = [pt(T[t]), pt(T[t + 1]), pt(T[t + 2])];
    if (v.every((p) => 3 - p[2] < 1e-6)) continue;   // 윗면은 세분 대상 아님
    for (let e = 0; e < 3; e++) { const a = v[e], b = v[(e + 1) % 3]; if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > hMax * (1 + 1e-6) && C.some((c) => segD(a, b, c) < R)) bad++; }
    if (v.every((p) => Math.abs(p[2]) < 1e-9)) {
      const g = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3];
      if (C.some((c) => Math.hypot(g[0] - c[0], g[1] - c[1]) < R)) for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], u = [b[0] - a[0], b[1] - a[1]], w = [c[0] - a[0], c[1] - a[1]];
        minAng = Math.min(minAng, Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / Math.hypot(...u) / Math.hypot(...w)))) * 180 / Math.PI);
      }
    }
  }
  ok(bad === 0, `세분 수렴: 원판 안 hMax(${hMax}) 초과 모서리 ${bad}개`);
  ok(minAng >= 5, `원판 안 아랫면 최소각 ${minAng.toFixed(1)}° ≥ 5°`);
  ok(ms < 1500, `세분 시간 ${ms.toFixed(0)} ms < 1500 · 삼각형 ${T.length / 3}개`);
  ok(ref.faceIds.length === T.length / 3 && isWatertight(ref), '면 번호 삼각형마다 유지 · 닫힘 유지');
  const m = deformPart(ref, frame, H, { dt: 0, h: 0.5, R, centers: C });
  ok(isWatertight(m), '변형 뒤에도 닫힘'); }
{ // 1 ulp 어긋난 중복 정점(STEP 면별 정점) — 옆면 정점만 float32 1 ulp 밀기
  const pl = boxMesh(0, 0, 0, 300, 200, 3), f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  const up = (x) => { if (x === 0) return x; f32[0] = x; u32[0] += 1; return f32[0]; };
  for (let t = 0; t < pl.triangles.length / 3; t++) if (pl.faceIds[t] >= 2) for (let k = 0; k < 3; k++) { const i = pl.triangles[3 * t + k]; pl.positions[3 * i] = up(pl.positions[3 * i]); pl.positions[3 * i + 1] = up(pl.positions[3 * i + 1]); }
  const C = [[5, 100], [150, 195]], R = 15, H = frameHeights(pl, frame, 0.5);
  const ref = refineForBumps(pl, frame, C, R, R / 4, { H }), m = deformPart(ref, frame, H, { dt: 0.2, h: 0.5, R, centers: C });
  ok(ref.triangles.length > pl.triangles.length && isWatertight(ref) && isWatertight(m), `1 ulp 중복 정점: 세분(${ref.triangles.length / 3}개)·변형 뒤 닫힘`); }
{ // 메모: 후보 27개 → 세분 ≤ 3번, 높이맵 1번
  const pl = boxMesh(0, 0, 0, 120, 40, 2), C = [[20, 20], [60, 20], [100, 20]], s0 = memoStats();
  for (const c of shapeCandidates({ t0: 2, pitch: 40, hasCenters: true })) { heightsFor(pl, frame, 0.5); refinedFor(pl, frame, C, c.R, Math.max(0.1, c.R / 8)); }
  const s1 = memoStats();
  ok(s1.refine - s0.refine <= 3 && s1.heights - s0.heights === 1, `메모: 세분 ${s1.refine - s0.refine}번 · 높이맵 ${s1.heights - s0.heights}번 (후보 27개)`);
  ok(refinedFor(pl, frame, C, 12, 1.5) === refinedFor(pl, frame, C, 12, 1.5) && heightsFor(pl, frame, 0.5) === heightsFor(pl, frame, 0.5), '같은 인자 → 같은 객체'); }
{ // 방어: R ≤ 0 거부 · 살두께 0.05 하한 · 부피 다시 셈 · LED 중심에서도 최소 두께
  const H = frameHeights(plate, frame, 0.5);
  let threw = false; try { deformPart(plate, frame, H, { dt: 0, h: 0.5, R: 0, centers: [[10, 5]] }); } catch { threw = true; }
  ok(threw, 'LED 중심이 있는데 R ≤ 0 이면 예외');
  const m = deformPart(plate, frame, H, { dt: -5, h: 0, R: 1, centers: [] }), zs = [];
  for (let i = 2; i < m.positions.length; i += 3) zs.push(m.positions[i]);
  ok(2 - Math.min(...zs) >= 0.05 - 1e-6 && Math.max(...zs) === 2, `Δt −5(두께 2): 두께 하한 0.05 (아랫면 z ${Math.min(...zs).toFixed(3)})`);
  ok(Math.abs(m.volume - meshVolume(m.positions, m.triangles)) < 1e-9 && Math.abs(m.volume - 40 * 10 * 0.05) < 1e-3, `부피 다시 셈 ${m.volume.toFixed(3)} = 20`);
  ok(Math.abs(minThickness(H, { dt: 0, h: 0.5, R: 0.3, centers: [[10, 5]] }) - 1.5) < 1e-6, '칸 중심이 아닌 LED 중심에서도 최소 두께(좁은 포켓 1.5)'); }
done();
