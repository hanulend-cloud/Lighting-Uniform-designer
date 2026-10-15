// 라인 인식(V3D-5): node test/mech3d-line.mjs
import { recognizeLine, obsDirection, lineFromData, lightData } from '../src/engine/mech3d/line.js';
import { topFaceMesh, rectTris, annulusTris, ok, done } from './mech3d-util.mjs';

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
done();
