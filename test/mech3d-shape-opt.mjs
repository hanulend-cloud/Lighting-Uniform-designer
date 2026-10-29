// ③ LGP 형상: node test/mech3d-shape-opt.mjs
import { frameHeights, deformPart, refineForBumps, bump, minThickness, shapeCandidates, isWatertight, refinedFor, heightsFor, memoStats, pathFromLine, swOnPath, endW, lineVarH, shapeVarRanges, gridCandidates, ledEll, partFrame, curveAt, bottomAt, hasCurve, bumpCenters } from '../src/engine/mech3d/shape-opt.js';
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
  ok(shapeCandidates({ t0: 2, pitch: 20, hasCenters: false }).length === 3, 'LED 중심 없음 → Δt 만 3개');
  ok(C.some((c) => c.dt === 0 && c.h === 0), '후보에 현재 형상(Δt=0·h=0) 포함');
  ok(shapeCandidates({ t0: 2, pitch: 20, hasCenters: false }).map((c) => c.dt).join() === '-1,0,2', 'LED 중심 없음 → Δt {−1, 0, 2}'); }
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
// ---- ③ 길이·폭 형상 변수 e·c (spec §2.3a) ----
const xPath = { path: Array.from({ length: 41 }, (_, i) => [i, 5]), halfW: 5, closed: false };
{ const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const q = [[12, 8, 12, 3], [12.5, 2, 12.5, -3], [0, 5, 0, 0], [40, 5, 40, 0], [-2, 6, -2, 1]];
  ok(q.every(([x, y, s, w]) => near(swOnPath(xPath, x, y), [s, w])), `swOnPath: (12,8)→${swOnPath(xPath, 12, 8)} · (12.5,2)→${swOnPath(xPath, 12.5, 2)} · 끝 밖 (−2,6)→${swOnPath(xPath, -2, 6)}`);
  const ln = { length: 40, closed: false, width: 10, fromSW: (s, w) => [s, 5 + w], to3D: (x, y, h) => [x, y, h] }, P = pathFromLine(ln, frame);
  ok(P.path.length === 41 && P.halfW === 5 && P.closed === false && Math.abs(P.L - 40) < 1e-9 && near(P.path[12], [12, 5]), `pathFromLine: 1 mm 간격 ${P.path.length}점, L ${P.L}, 반폭 ${P.halfW}`);
  const lc = { length: 2 * Math.PI * 3, closed: true, width: 2, fromSW: (s, w) => [20 + (3 - w) * Math.cos(s / 3), 5 + (3 - w) * Math.sin(s / 3)], to3D: (x, y, h) => [x, y, h] }, Pc = pathFromLine(lc, frame);
  ok(Pc.closed && Pc.path.length === Math.ceil(lc.length) && Math.hypot(Pc.path[0][0] - Pc.path.at(-1)[0], Pc.path[0][1] - Pc.path.at(-1)[1]) > 0.5, `닫힌 라인: 끝점 중복 없음(${Pc.path.length}점)`);
  ok(endW(0, 40, 8) === 1 && endW(40, 40, 8) === 1 && Math.abs(endW(4, 40, 8) - 0.5) < 1e-12 && endW(8, 40, 8) === 0 && endW(20, 40, 8) === 0 && endW(-3, 40, 8) === 1, 'endW: 끝 1 · ℓ/2 0.5 · ℓ 안쪽 0 · 끝 밖 1');
  ok(endW(0, Pc.L, 8, true) === 0, '닫힌 경로 endW = 0');
  const H = frameHeights(plate, frame, 0.5), m = deformPart(refineForBumps(plate, frame, [], 1, 1, { H, hBottom: 1 }), frame, H, { dt: 0, h: 0, R: 1, centers: [], e: 0.5, c: 0, ell: 8, ...Pc });
  ok(Math.abs(m.volume - 800) < 1e-6, `닫힌 원 경로 + e 0.5: 부피 ${m.volume.toFixed(4)} = 800`); }
{ const H = frameHeights(plate, frame, 0.5), t0 = performance.now(), ref = refineForBumps(plate, frame, [], 1, 1, { H, hBottom: 1 }), ms = performance.now() - t0;
  const me = deformPart(ref, frame, H, { dt: 0, h: 0, R: 1, centers: [], e: 0.5, c: 0, ell: 8, ...xPath });
  ok(Math.abs(me.volume / 840 - 1) < 0.005 && isWatertight(me), `e 0.5, ℓ 8: 부피 ${me.volume.toFixed(2)} ≈ 840 (±0.5%, 아랫면 세분 hBottom 1 → ${ref.triangles.length / 3}개, ${ms.toFixed(0)} ms)`);
  const mc = deformPart(ref, frame, H, { dt: 0, h: 0, R: 1, centers: [], e: 0, c: -0.5, ell: 8, ...xPath });
  ok(Math.abs(mc.volume / (800 - 0.5 * 40 * 10 / 3) - 1) < 0.005 && isWatertight(mc), `c −0.5: 부피 ${mc.volume.toFixed(2)} ≈ 733.33 (±0.5%)`);
  ok(Math.abs(minThickness(H, { dt: 0, h: 0, R: 1, centers: [], e: 0, c: -0.5, ...xPath }) - 1.5) < 0.05, 'c −0.5: 최소 두께 ≈ 1.5(가장자리)');
  const C = [[10.25, 5.25]], r0 = refineForBumps(plate, frame, C, 4, 0.5, { H });
  const a = deformPart(r0, frame, H, { dt: 0.1, h: 0.3, R: 4, centers: C }), b = deformPart(r0, frame, H, { dt: 0.1, h: 0.3, R: 4, centers: C, e: 0, c: 0, ell: 8, ...xPath });
  ok(a.positions.length === b.positions.length && a.positions.every((v, i) => Object.is(v, b.positions[i])) && a.volume === b.volume, 'e = c = 0 → 경로가 있어도 deformPart 결과 비트 동일');
  ok(refineForBumps(plate, frame, C, 4, 0.5, { H, hBottom: 0 }).triangles.length === r0.triangles.length && refineForBumps(plate, frame, [], 4, 0.5, { H }) === plate, 'hBottom 0/없음 → 세분 기존과 같음');
  ok(lineVarH({ R: 6, e: 0.2, c: 0 }) === 3 && lineVarH({ R: 1, e: 0, c: -0.1 }) === 2 && lineVarH({ R: 6, e: 0, c: 0 }) === 0 && lineVarH({ R: 6 }) === 0, 'lineVarH: e·c ≠ 0 일 때만 max(R/2, 2)'); }
{ const r = shapeVarRanges({ t0: 2, pitch: 20, hasCenters: true }), r0 = shapeVarRanges({ t0: 2, pitch: 20, hasCenters: false });
  ok(r.e.join() === '-1,1' && r.c.join() === '-1,1' && r.dt.join() === '-1,2' && r.R.join() === '6,16' && !r0.h && !r0.R && r0.e.join() === '-1,1', 'shapeVarRanges: e·c ∈ ±0.5t₀, h·R 은 LED 중심 있을 때만');
  const G = gridCandidates(['e', 'c', 'R'], r), G1 = gridCandidates(['dt'], r0);
  ok(G.length === 27 && G.some((g) => g.e === 0 && g.c === 0 && g.dt === 0 && g.h === 0) && G.every((g) => g.dt === 0 && g.h === 0) && G.some((g) => g.e === -1 && g.c === 1 && g.R === 16), `gridCandidates: 3³ = ${G.length}, 현재 형상 포함, 고르지 않은 변수 0`);
  ok(G1.length === 3 && G1.map((g) => g.dt).join() === '-1,0,2' && G1.every((g) => g.e === 0 && g.c === 0 && g.h === 0 && g.R === 1), `gridCandidates(Δt, LED 없음): ${G1.map((g) => g.dt)}`);
  ok(gridCandidates([], r).length === 1 && gridCandidates(['R'], r).map((g) => g.R).join() === '6,11,16', '빈 선택 → 현재 형상 1개 · R 은 {lo, mid, hi}'); }
{ // 성능: 경로 2000점 × 정점 10만
  const path = Array.from({ length: 2000 }, (_, i) => [i * 0.5 * Math.cos(i * 0.002), i * 0.5 * Math.sin(i * 0.002)]), P = { path, halfW: 5, closed: false };
  const t0 = performance.now(); let acc = 0;
  for (let k = 0; k < 100000; k++) { const i = (k * 7919) % 2000, [x, y] = path[i]; acc += swOnPath(P, x + 3 * Math.sin(k), y + 3 * Math.cos(k))[1]; }
  const ms = performance.now() - t0;
  ok(ms < 1500 && Number.isFinite(acc), `swOnPath 10만 점 × 경로 2000점: ${ms.toFixed(0)} ms`); }
ok(ledEll({ pitch: 7, count: 5, L: 100 }) === 7 && ledEll({ count: 5, L: 100 }) === 20 && ledEll({ ss: [30, 10, 20, 40], L: 100 }) === 10 && ledEll({ count: 1, ss: [50], L: 100 }) === 25, 'ℓ = LED 피치: 피치 · 균등 L/n · 발광점 평균 간격 · 1개 L/4');
{ // 형상 기준 좌표 = 대상 부품 윗면 방향(2026-10-29) — 관측 좌표가 14.5° 기울어도(꺾인 확산판) 상자 도광판은 +z 기준이라
  // 옆면 칸이 얇게 잡히지 않음(전에는 0.36 mm → '변경 없음' 후보까지 살두께 탈락). 이미 맞으면 같은 객체 그대로
  const c = Math.cos(0.2531), s = Math.sin(0.2531), F = { u: [c, 0, s], v: [0, 1, 0], d: [-s, 0, c] }, box = boxMesh(8, 0, 6.5, 22, 400, 5.5);
  const G = partFrame(box, F), Ht = heightsFor(box, F, 0.5), Hg = heightsFor(box, G, 0.5), z0 = { dt: 0, h: 0, R: 1, centers: [], e: 0, c: 0 };
  ok(Math.abs(G.d[2] - 1) < 1e-9 && Math.abs(G.v[1] - 1) < 1e-9 && Math.abs(G.u[0] - 1) < 1e-9, `부품 기준 d = ${G.d.map((v) => v.toFixed(3))}`);
  ok(minThickness(Ht, z0) < 0.8 && Math.abs(minThickness(Hg, z0) - 5.5) < 1e-3, `최소 두께: 관측 기준 ${minThickness(Ht, z0).toFixed(2)} → 부품 기준 ${minThickness(Hg, z0).toFixed(2)} mm`);
  const F0 = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] };
  ok(partFrame(box, F0) === F0, '이미 윗면 방향 = 같은 좌표 객체(기존 결과 그대로)');
}
{ const { shapeBudget, SHAPE_SCHEDULE } = await import('../src/engine/mech3d/autodesign.js');
  const a = shapeBudget(0.107), b = shapeBudget(0.6), c = shapeBudget(0.01), d = shapeBudget(NaN);
  ok(Math.abs(a.k - 4.673) < 1e-3 && a.screen.N === 280374 && a.schedule[2][1] === Math.round(6e5 * a.k) && a.schedule[0][2] === 10000 && b.k === 1 && b.screen.N === 6e4 && c.k === 10 && d.k === 1 && d.schedule[1][1] === SHAPE_SCHEDULE[1][1],
    `③ 평가 광자 = 효율 반비례(효율 10.7% → ×${a.k.toFixed(2)}, 최대 ×10, 시간 ×4 까지)`); }
{ // 길이·폭 제어점 곡선(2026-10-29 형상 자유도) — Catmull-Rom: 제어점 통과 · 끝 밖은 끝값 · 닫힌 곡선은 주기
  const k = [0, 1, 0, -1, 0];
  ok(curveAt(k, 0) === 0 && Math.abs(curveAt(k, 0.25) - 1) < 1e-12 && Math.abs(curveAt(k, 0.75) + 1) < 1e-12 && curveAt(k, -1) === 0 && curveAt(k, 2) === 0 && curveAt([], 0.3) === 0 && curveAt([2], 0.7) === 2, '곡선: 제어점 통과 · 범위 밖 = 끝값');
  ok(Math.abs(curveAt([1, 2, 3, 4], 0, true) - 1) < 1e-12 && Math.abs(curveAt([1, 2, 3, 4], 1 / 4, true) - 2) < 1e-12 && Math.abs(curveAt([1, 2, 3, 4], 1, true) - 1) < 1e-12, '닫힌 곡선: t = i/n 에서 제어점, t = 1 → 처음');
  // 상자(라인 0~100 mm, 반폭 2) 아랫면: 길이 곡선 끝 +1(두꺼움) · 가운데 0, 폭 곡선 가장자리 −0.5 → 이동량 = 합
  const box = boxMesh(0, -2, 0, 100, 4, 3), F = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, H = heightsFor(box, F, 0.5);
  const P = { path: [[0, 0], [100, 0]], halfW: 2, closed: false, L: 100 }, prm = { dt: 0, h: 0, R: 1, centers: [], e: 0, c: 0, ...P, kL: [1, 0, 0, 0, 1], kW: [0, 0, -0.5] };
  const B = bottomAt(H, prm);
  ok(Math.abs(B(0, 0) - (0 - 1)) < 1e-9 && Math.abs(B(50, 0) - 0) < 1e-9 && Math.abs(B(50, 1.999) - 0.5) < 1e-3 && hasCurve(prm) && !hasCurve({ kL: [0, 0], kW: null }), `아랫면: 끝 ${B(0, 0)} · 가운데 ${B(50, 0)} · 폭 가장자리 ${B(50, 1.999).toFixed(3)}`);
  ok(lineVarH({ R: 3, kL: [0, 0.2] }) === 2 && lineVarH({ R: 3 }) === 0, '곡선이 있으면 아랫면 세분(2 mm)');
}
{ // 포켓(h)이 없으면 LED 둘레 세분 안 함 — 장면 삼각형 수
  const box = boxMesh(0, -2, 0, 100, 4, 3), F = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, cs = [[10, 0], [30, 0], [50, 0], [70, 0], [90, 0]];
  const n = (prm) => refinedFor(box, F, bumpCenters(prm), 4, 0.5, 0).triangles.length / 3;
  ok(bumpCenters({ h: 0, centers: cs }).length === 0 && n({ h: 0, centers: cs }) === box.triangles.length / 3 && n({ h: 0.5, centers: cs }) > 10 * box.triangles.length / 3, `h 0 → 세분 없음(${n({ h: 0, centers: cs })}) · h 0.5 → ${n({ h: 0.5, centers: cs })}`);
}
done();
