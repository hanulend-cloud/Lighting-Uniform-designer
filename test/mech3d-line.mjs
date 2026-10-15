// 라인 인식(V3D-5): node test/mech3d-line.mjs
import { recognizeLine, obsDirection, lineFromData, lightData } from '../src/engine/mech3d/line.js';
import { topFaceMesh, rectTris, annulusTris, rng, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }];
// s 방향(어느 끝이 시작인지)·w 부호는 인식 결과에 따라 정해지므로, 첫 점으로 방향을 정해 나머지를 같은 방향으로 판정(열린 경로용)
function checkPoints(L, pts, label) {
  const sw = pts.map(([x, y]) => L.toSW(...L.to2D([x, y, 2])));
  const flipS = Math.abs(sw[0][0] - pts[0][2]) > Math.abs(L.length - sw[0][0] - pts[0][2]);
  const k = pts.findIndex((p) => p[3] !== 0), flipW = sw[k][1] * pts[k][3] < 0;
  let e = 0;
  sw.forEach(([s, w], i) => { e = Math.max(e, Math.abs((flipS ? L.length - s : s) - pts[i][2]), Math.abs((flipW ? -w : w) - pts[i][3])); });
  ok(e <= 0.2, `${label}: (s,w) 최대 오차 ${e.toFixed(3)}mm (≤0.2)`);
}

{   // 직선 띠 100×6
  const parts = [topFaceMesh(rectTris(0, 0, 100, 6))];
  const d = obsDirection(parts, faces);
  ok(Math.abs(d[2] - 1) < 1e-9, `관측 방향 = 면 법선 ${d.map((v) => v.toFixed(3))}`);
  const L = recognizeLine(parts, faces, d);
  ok(L.kind === 'line' && !L.closed && Math.abs(L.length - 100) <= 0.2 && Math.abs(L.width - 6) <= 0.2, `직선: ${L.kind}, 길이 ${L.length.toFixed(3)}, 폭 ${L.width.toFixed(3)}`);
  checkPoints(L, [[5, 3, 5, 0], [37, 4.5, 37, 1.5], [95, 1.5, 95, -1.5], [50, 3, 50, 0]], 'V3D-5 직선');
  const back = lineFromData(JSON.parse(JSON.stringify(L.data)));
  const a = L.toSW(...L.to2D([37, 4.5, 2])), b = back.toSW(...back.to2D([37, 4.5, 2]));
  ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, '직렬화 왕복(Worker 전달) 동일');
  const [x, y] = L.fromSW(37, 1.5), sw = L.toSW(x, y);
  ok(Math.abs(sw[0] - 37) < 1e-9 && Math.abs(sw[1] - 1.5) < 1e-9, 'fromSW ↔ toSW 역관계');
}
{   // 원형 링 R40, 폭 6
  const parts = [topFaceMesh(annulusTris(0, 0, 37, 43))];
  const L = recognizeLine(parts, faces, [0, 0, 1]);
  ok(L.kind === 'circle' && L.closed && Math.abs(L.length - 2 * Math.PI * 40) <= 0.2 && Math.abs(L.width - 6) <= 0.2, `원: ${L.kind}, 둘레 ${L.length.toFixed(3)} (해석 ${(2 * Math.PI * 40).toFixed(3)}), 폭 ${L.width.toFixed(3)}`);
  const s1 = L.toSW(...L.to2D([40, 0, 2]))[0], s2 = L.toSW(...L.to2D([40 * Math.cos(1), 40 * Math.sin(1), 2]))[0];
  const ds = Math.abs(((s2 - s1) % L.length + L.length) % L.length), want = 40;   // 1 rad 호 = 40mm (방향에 따라 L−40)
  ok(Math.min(Math.abs(ds - want), Math.abs(L.length - ds - want)) <= 0.2, `V3D-5 원: 1rad 호 길이 ${Math.min(ds, L.length - ds).toFixed(3)} (해석 40)`);
  const w = Math.abs(L.toSW(...L.to2D([0, 42, 2]))[1]);
  ok(Math.abs(w - 2) <= 0.2, `V3D-5 원: 폭 방향 |w| ${w.toFixed(3)} (해석 2)`);
}
{   // ㄱ자 띠: 가로 0..60×0..6 + 세로 54..60×6..46. 중심선 = 중앙축(medial axis): y=3 (x≤54) → 안쪽 모서리 (54,6) 둘레
    // 반경 3 의 1/4 원호 → x=57 (y≥6). 길이 = 54 + 1.5π + 40 = 98.712 (직각 꺾음 100 이 아님 — 폭 중심을 지키는 실제 중심선)
  const parts = [topFaceMesh([...rectTris(0, 0, 60, 6), ...rectTris(54, 6, 60, 46)])];
  const L = recognizeLine(parts, faces, [0, 0, 1]), arc = 54 + 1.5 * Math.PI;
  ok(L.kind === 'path' && !L.closed && Math.abs(L.length - (arc + 40)) <= 0.3, `ㄱ자: ${L.kind}, 길이 ${L.length.toFixed(3)} (중앙축 ${(arc + 40).toFixed(3)})`);
  checkPoints(L, [[20, 3, 20, 0], [40, 4, 40, 1], [57, 30, arc + 24, 0], [56, 40, arc + 34, 1]], 'V3D-5 ㄱ자(모서리 ±6mm 밖)');
}
// ---- 견고성(리뷰 C1–C3, I1–I4, M1, M5) ----
const rot = (tris, a) => tris.map((tr) => tr.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]));
// 중심선 c(t), 법선 nrm(t), 왼쪽/오른쪽 반폭 hl(t)/hr(t) 인 띠 삼각형
function strip(N, c, nrm, hl, hr) {
  const P = (k) => { const t = k / N, [x, y] = c(t), [nx, ny] = nrm(t); return [[x + hl(t) * nx, y + hl(t) * ny], [x - hr(t) * nx, y - hr(t) * ny]]; };
  const tris = []; for (let k = 0; k < N; k++) { const [a1, a2] = P(k), [b1, b2] = P(k + 1); tris.push([a1, a2, b2], [a1, b2, b1]); }
  return tris;
}
const recog = (tris) => recognizeLine([topFaceMesh(tris)], faces, [0, 0, 1]);
const maxDev = (L, f, keep = () => true) => { let m = 0; for (let k = 0; k <= 2000; k++) { const [x, y] = L.fromSW((L.length * k) / 2000, 0); if (keep(x, y)) m = Math.max(m, Math.abs(f(x, y))); } return m; };
for (const deg of [10, 30, 60]) {   // C1: 회전한 직선 띠
  const a = (deg * Math.PI) / 180, L = recog(rot(rectTris(0, -3, 100, 3), a));
  ok(L.kind === 'line' && !L.closed && Math.abs(L.length - 100) <= 0.2 && Math.abs(L.width - 6) <= 0.05, `직선 ${deg}°: ${L.kind}, closed=${L.closed}, 길이 ${L.length.toFixed(3)}, 폭 ${L.width.toFixed(3)} (6±0.05)`);
  const R = (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  checkPoints(L, [[...R(5, 0), 5, 0], [...R(37, 1.5), 37, 1.5], [...R(95, -1.5), 95, -1.5], [...R(50, 0), 50, 0]], `V3D-5 직선 ${deg}°`);
}
for (const deg of [30, 90, 120, 180]) {   // C1/C2: 열린 호 R30 폭 6
  const A = (deg * Math.PI) / 180, L = recog(strip(360, (t) => [30 * Math.cos(A * t), 30 * Math.sin(A * t)], (t) => [Math.cos(A * t), Math.sin(A * t)], () => 3, () => 3));
  ok(!L.closed && Math.abs(L.length - 30 * A) <= 0.2, `호 ${deg}°: ${L.kind}, closed=${L.closed}, 길이 ${L.length.toFixed(3)} (해석 ${(30 * A).toFixed(3)})`);
  const P = (r, th) => [r * Math.cos(th), r * Math.sin(th)];
  checkPoints(L, [[...P(31.5, A / 4), 7.5 * A, -1.5], [...P(30, A / 2), 15 * A, 0], [...P(28.5, (3 * A) / 4), 22.5 * A, 1.5]], `V3D-5 호 ${deg}°`);
}
{   // C3/I1: 대칭 테이퍼 4→10
  const L = recog(strip(200, (t) => [100 * t, 0], () => [0, 1], (t) => 2 + 3 * t, (t) => 2 + 3 * t));
  const d = maxDev(L, (x, y) => y);
  ok(!L.closed && Math.abs(L.length - 100) <= 0.3 && d <= 0.1, `테이퍼 4→10: ${L.kind}, 길이 ${L.length.toFixed(3)}, 중심선 최대 편차 ${d.toFixed(3)} (≤0.1)`);
}
{   // C3: 폭이 다른 ㄱ자(가로 6, 세로 10) — 모서리에서 먼 곳은 각 팔의 중심선
  const L = recog([...rectTris(0, 0, 60, 6), ...rectTris(50, 6, 60, 46)]);
  const d1 = maxDev(L, (x, y) => y - 3, (x) => x < 40), d2 = maxDev(L, (x) => x - 55, (x, y) => y > 16);
  ok(!L.closed && d1 <= 0.2 && d2 <= 0.2, `ㄱ자 6/10: 가로 팔 편차 ${d1.toFixed(3)}, 세로 팔 편차 ${d2.toFixed(3)} (≤0.2)`);
}
{   // M5: 한쪽 혹(10×6)
  const L = recog([...rectTris(0, -3, 100, 3), ...rectTris(45, 3, 55, 9)]);
  const d = maxDev(L, (x, y) => y, (x) => x < 40 || x > 60);
  let mono = true, prev = null, sg = 0;
  for (let k = 0; k <= 2000; k++) { const x = L.fromSW((L.length * k) / 2000, 0)[0]; if (prev !== null && Math.abs(x - prev) > 1e-9) { const s = Math.sign(x - prev); if (sg && s !== sg) mono = false; sg = s; } prev = x; }
  ok(!L.closed && d <= 0.05 && mono && Math.abs(L.length - 100) <= 1, `혹: 혹 밖 편차 ${d.toFixed(3)} (≤0.05), 단조=${mono}, 길이 ${L.length.toFixed(3)} (100±1)`);
}
{   // I2: 떨어진 두 면
  let msg = '';
  try { recog([...rectTris(0, 0, 50, 6), ...rectTris(0, 20, 50, 26)]); } catch (e) { msg = e.message; }
  ok(/떨어져/.test(msg), `떨어진 두 면 → 오류: ${msg || '(없음)'}`);
}
{   // I4: 300×300 판 → 5 s 안에 거부
  const t0 = performance.now(); let msg = '';
  try { recog(rectTris(0, 0, 300, 300)); } catch (e) { msg = e.message; }
  const dt = (performance.now() - t0) / 1000;
  ok(/띠/.test(msg) && dt <= 5, `300×300 판 → 오류 ${dt.toFixed(2)}s: ${msg || '(없음)'}`);
}
{   // I3: path 종류 JSON 왕복 + 가벼운 data
  const L = recog([...rectTris(0, 0, 60, 6), ...rectTris(54, 6, 60, 46)]);
  const back = lineFromData(JSON.parse(JSON.stringify(L.data))), lite = lineFromData(JSON.parse(JSON.stringify(lightData(L))));
  let e = 0; for (const [x, y] of [[20, 3], [40, 4], [57, 30], [56, 40], [58, 3]]) for (const M of [back, lite]) { const a = L.toSW(x, y), b = M.toSW(x, y); e = Math.max(e, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
  let threw = false; try { lite.inside(20, 3); } catch { threw = true; }
  ok(back.kind === 'path' && e < 1e-9 && back.inside(20, 3) && threw && !('mask' in lightData(L).raster), `path JSON 왕복 오차 ${e}, lightData 래스터 제외·inside 오류=${threw}`);
}
// ---- 재검토(N1–N3, b–d) ----
// 참 중심선 c(t) → 촘촘한 꺾은선(호 길이 s 로 조회)
function truth(c, N = 20000) {
  const P = []; for (let k = 0; k <= N; k++) P.push(c(k / N));
  const cum = [0]; for (let k = 1; k <= N; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
  const at = (s) => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } const l = cum[hi] - cum[lo] || 1e-12, t = (s - cum[lo]) / l, tx = (P[hi][0] - P[lo][0]) / l, ty = (P[hi][1] - P[lo][1]) / l; return [P[lo][0] + t * (P[hi][0] - P[lo][0]), P[lo][1] + t * (P[hi][1] - P[lo][1]), tx, ty]; };
  return { L: cum[N], at };
}
// 참 중심선을 따라 (s, w = f·반폭) 표본 → checkPoints 형식 [x, y, s, w]
function samples(T, half, { skip = () => false, fr = [0, 0.4, -0.4, 0.8, -0.8], margin = 0.5, step = 1 } = {}) {
  const out = [];
  for (let s = margin; s <= T.L - margin; s += step) { if (skip(s)) continue; const [x, y, tx, ty] = T.at(s); for (const f of fr) { const w = f * half; out.push([x - w * ty, y + w * tx, s, w]); } }
  return out;
}
// 참 중심선 + 양쪽 반폭 h 의 띠, 가장자리 N 분할, 꼭짓점 흔들림 ±jit
function jstrip(T, h, N, jit = 0, seed = 1) {
  const r = rng(seed), J = () => (r() * 2 - 1) * jit, E = [];
  for (let k = 0; k <= N; k++) { const [x, y, tx, ty] = T.at(Math.min((T.L * k) / N, T.L - 1e-9)); E.push([[x - h * ty + J(), y + h * tx + J()], [x + h * ty + J(), y - h * tx + J()]]); }
  const tris = []; for (let k = 0; k < N; k++) { const [a1, a2] = E[k], [b1, b2] = E[k + 1]; tris.push([a1, a2, b2], [a1, b2, b1]); }
  return tris;
}
const Lw = 54 + 1.5 * Math.PI + 40, Lc = (t) => { const s = t * Lw; if (s <= 54) return [s, 3]; if (s <= 54 + 1.5 * Math.PI) { const th = -Math.PI / 2 + (s - 54) / 3; return [54 + 3 * Math.cos(th), 6 + 3 * Math.sin(th)]; } return [57, 6 + s - 54 - 1.5 * Math.PI]; };
for (let deg = 0; deg <= 90; deg += 5) {   // N1: 회전한 ㄱ자, w = 0, ±0.4, ±0.8 × 반폭 (모서리 ±8.5mm 제외)
  const a = (deg * Math.PI) / 180, R = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const T = truth((t) => R(Lc(t))), L = recog(rot([...rectTris(0, 0, 60, 6), ...rectTris(54, 6, 60, 46)], a));
  ok(Math.abs(L.length - Lw) <= 0.3, `ㄱ자 ${deg}°: 길이 ${L.length.toFixed(3)} (${Lw.toFixed(3)}±0.3)`);
  checkPoints(L, samples(T, 3, { skip: (s) => Math.abs(s - 56.36) < 8.5 }), `V3D-5 ㄱ자 ${deg}°`);
}
{   // N1: 가장자리 흔들림(1000 분할) — 직선은 여전히 'line', (s,w) ≤ 0.2
  const cases = [['직선', truth((t) => [100 * t, 0], 100)], ['직선 30°', truth((t) => [100 * t * Math.cos(0.5236), 100 * t * Math.sin(0.5236)], 100)], ['호 R30 120°', truth((t) => [30 * Math.cos(2.0944 * t), 30 * Math.sin(2.0944 * t)])]];
  for (const [lab, T] of cases) for (const j of [0.02, 0.05]) {
    const L = recog(jstrip(T, 3, 1000, j, 11));
    if (lab !== '호 R30 120°') ok(L.kind === 'line', `흔들림 ±${j} ${lab}: ${L.kind} (line)`);
    checkPoints(L, samples(T, 3), `V3D-5 흔들림 ±${j} ${lab}`);
  }
}
{   // N1: 혹 30° 회전(혹 ±10mm 밖), S자 R30
  const a = Math.PI / 6, T = truth((t) => [100 * t * Math.cos(a), 100 * t * Math.sin(a)], 100);
  checkPoints(recog(rot([...rectTris(0, -3, 100, 3), ...rectTris(45, 3, 55, 9)], a)), samples(T, 3, { skip: (s) => s > 40 && s < 60 }), 'V3D-5 혹 30°');
  const c = (t) => (t < 0.5 ? [30 * Math.sin(Math.PI * t), 30 - 30 * Math.cos(Math.PI * t)] : [60 - 30 * Math.sin(Math.PI * (1 - t)), 30 + 30 * Math.cos(Math.PI * (1 - t))]);
  const S = truth(c);
  checkPoints(recog(jstrip(S, 3, 400)), samples(S, 3), 'V3D-5 S자 R30');
}
{   // N2: 양쪽 대칭 원형 패드 D20
  const L = recog([...rectTris(0, -3, 100, 3), ...annulusTris(50, 0, 0.001, 10, 128)]);
  let d = 0; for (let x = 40; x <= 60; x += 0.5) d = Math.max(d, Math.abs(L.fromSW(L.toSW(x, 0)[0], 0)[1]));
  ok(!L.closed && d <= 0.2 && Math.abs(L.length - 100) <= 1, `대칭 패드 D20: 패드 중심선 |y| 최대 ${d.toFixed(3)} (≤0.2), 길이 ${L.length.toFixed(3)} (100±1)`);
}
for (const len of [10, 20, 30]) {   // N2: 한쪽 혹(폭 12, 길이 10/20/30)
  const L = recog([...rectTris(0, -3, 100, 3), ...rectTris(50 - len / 2, 3, 50 + len / 2, 9)]);
  const d = maxDev(L, (x, y) => y, (x) => Math.abs(x - 50) > len / 2 + 6);
  let mono = true, prev = null, sg = 0;
  for (let k = 0; k <= 2000; k++) { const x = L.fromSW((L.length * k) / 2000, 0)[0]; if (prev !== null && Math.abs(x - prev) > 1e-9) { const s = Math.sign(x - prev); if (sg && s !== sg) mono = false; sg = s; } prev = x; }
  ok(mono && Math.abs(L.length - 100) <= 1 && d <= 0.05, `한쪽 혹 ${len}mm: 단조=${mono}, 길이 ${L.length.toFixed(3)} (100±1), 혹 밖 편차 ${d.toFixed(3)} (≤0.05)`);
}
for (const rh of [0.5, 1.5, 3]) {   // N3: 띠 안의 작은 구멍(나사 보스) — 고리 아님, 집계에서는 구멍 제외
  const cx = 50, cy = 5, sq = 4, tris = [...rectTris(0, 0, cx - sq, 10), ...rectTris(cx + sq, 0, 100, 10), ...rectTris(cx - sq, 0, cx + sq, cy - sq), ...rectTris(cx - sq, cy + sq, cx + sq, 10)];
  const sqp = (t) => { const m = Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t))); return [cx + (sq * Math.cos(t)) / m, cy + (sq * Math.sin(t)) / m]; }, cp = (t) => [cx + rh * Math.cos(t), cy + rh * Math.sin(t)];
  for (let k = 0; k < 128; k++) { const a = (2 * Math.PI * k) / 128, b = (2 * Math.PI * (k + 1)) / 128; tris.push([cp(a), sqp(a), sqp(b)], [cp(a), sqp(b), cp(b)]); }
  let L = null, msg = ''; try { L = recog(tris); } catch (e) { msg = e.message; }
  const d = L ? maxDev(L, (x, y) => y - 5) : NaN;
  ok(L && L.kind === 'line' && !L.closed && d <= 0.05 && !L.inside(cx, cy), `구멍 r${rh}: ${L ? `${L.kind}, 중심선 편차 ${d.toFixed(3)} (≤0.05), inside(구멍 중심)=${L.inside(cx, cy)}` : msg}`);
}
{   // (c) 짧은 창 10×6 은 통과, (d) 양 끝 대칭(축 정렬 100×6: 끝점 정확)
  let L = null, msg = ''; try { L = recog(rectTris(0, 0, 10, 6)); } catch (e) { msg = e.message; }
  ok(L && Math.abs(L.length - 10) <= 0.2, `짧은 창 10×6: ${L ? `${L.kind}, 길이 ${L.length.toFixed(3)}` : msg}`);
  L = recog(rectTris(0, -3, 100, 3));
  const s0 = L.toSW(0, 0)[0], s1 = L.toSW(100, 0)[0], e = Math.max(Math.abs(Math.min(s0, s1)), Math.abs(Math.max(s0, s1) - 100), Math.abs(L.length - 100));
  ok(e <= 0.01, `양 끝 대칭: s(0,0)=${s0.toFixed(4)}, s(100,0)=${s1.toFixed(4)}, 길이 ${L.length.toFixed(4)} (오차 ≤0.01)`);
}
{   // (b) 경주로 260+R20 폭 6 — 셀 상한 W/60 → (s,w) < 0.1 (닫힌 경로: 표본 사이 s 차이로 판정)
  const Ls = 260, Rc = 20, Pt = 2 * Ls + 2 * Math.PI * Rc;
  const c = (t) => { let s = t * Pt; if (s < Ls) return [s, -Rc]; s -= Ls; if (s < Math.PI * Rc) { const a = -Math.PI / 2 + s / Rc; return [Ls + Rc * Math.cos(a), Rc * Math.sin(a)]; } s -= Math.PI * Rc; if (s < Ls) return [Ls - s, Rc]; s -= Ls; const a = Math.PI / 2 + s / Rc; return [Rc * Math.cos(a), Rc * Math.sin(a)]; };
  const T = truth(c, 40000), E = []; for (let k = 0; k < 2400; k++) { const [x, y, tx, ty] = T.at((T.L * k) / 2400); E.push([[x - 3 * ty, y + 3 * tx], [x + 3 * ty, y - 3 * tx]]); }
  const tris = []; for (let k = 0; k < 2400; k++) { const [a1, a2] = E[k], [b1, b2] = E[(k + 1) % 2400]; tris.push([a1, a2, b2], [a1, b2, b1]); }
  const t0 = performance.now(), L = recog(tris), ms = performance.now() - t0;
  const P = samples(T, 3, { step: 2.7 }), sw = P.map(([x, y]) => L.toSW(x, y));
  let dir = 0; for (let i = 5; i < P.length; i += 5) { let d = sw[i][0] - sw[i - 5][0]; d -= L.length * Math.round(d / L.length); dir += Math.sign(d); }
  const k = P.findIndex((p) => p[3] !== 0), fw = sw[k][1] * P[k][3] < 0 ? -1 : 1, sg = dir < 0 ? -1 : 1;
  let e = 0; P.forEach((p, i) => { let ds = sg * (sw[i][0] - sw[0][0]) - (p[2] - P[0][2]); ds -= L.length * Math.round(ds / L.length); e = Math.max(e, Math.abs(ds), Math.abs(fw * sw[i][1] - p[3])); });
  ok(L.closed && e < 0.1, `경주로 260+R20: 셀 ${L.data.raster.cell.toFixed(3)}, (s,w) 최대 오차 ${e.toFixed(3)} (<0.1), ${ms.toFixed(0)}ms`);
}
done();
