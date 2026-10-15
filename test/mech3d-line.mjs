// 라인 인식(V3D-5): node test/mech3d-line.mjs
import { recognizeLine, obsDirection, lineFromData } from '../src/engine/mech3d/line.js';
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
done();
