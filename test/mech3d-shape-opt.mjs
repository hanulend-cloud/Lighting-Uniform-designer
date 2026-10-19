// ③ LGP 형상: node test/mech3d-shape-opt.mjs
import { frameHeights, deformPart, refineForBumps, bump, minThickness, shapeCandidates, isWatertight } from '../src/engine/mech3d/shape-opt.js';
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
done();
