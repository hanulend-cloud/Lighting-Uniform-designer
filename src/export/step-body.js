// L1~L4 조합 바디 솔리드 — 평평한 윗면(z=topZ) + 높이필드 격자 메쉬 아랫면(z=botZAt(x,y))
// + 4면 옆벽. botZAt()는 호출측이 넘긴다(levels.js의 l3BotZAt/l4BotZAt를 그대로 사용해
// 화면 표시와 STEP이 항상 일치하게 함 — 새 형상 공식을 여기서 유도하지 않는다).

import { pnt, triFace, sewToSolid } from './oc-build.js';

// grid: nx*ny 격자점에서 botZAt(x,y) 샘플링. 기본 60x24(2D 곡면 정확도와 STEP 크기의 절충).
export function buildBodySolid(oc, { X, Y, topZ, botZAt, nx = 60, ny = 24 }) {
  const xs = Array.from({ length: nx }, (_, i) => (i / (nx - 1)) * X);
  const ys = Array.from({ length: ny }, (_, j) => (j / (ny - 1)) * Y);

  // 바닥 격자점 (botPts[j][i])
  const botPts = ys.map((y) => xs.map((x) => pnt(oc, x, y, botZAt(x, y))));

  const faces = [];

  // 바닥면 — 격자 사각형을 삼각형 2개로
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p00 = botPts[j][i], p10 = botPts[j][i + 1];
      const p01 = botPts[j + 1][i], p11 = botPts[j + 1][i + 1];
      faces.push(triFace(oc, p00, p10, p11));
      faces.push(triFace(oc, p00, p11, p01));
    }
  }

  // 윗면(평평, z=topZ) — 같은 X·Y 격자를 재사용해 옆벽과 정점을 공유
  const topPts = ys.map((y) => xs.map((x) => pnt(oc, x, y, topZ)));
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p00 = topPts[j][i], p10 = topPts[j][i + 1];
      const p01 = topPts[j + 1][i], p11 = topPts[j + 1][i + 1];
      faces.push(triFace(oc, p00, p11, p10));
      faces.push(triFace(oc, p00, p01, p11));
    }
  }

  // 옆벽 4면 — 바닥 경계 폴리라인과 윗면 경계(같은 x,y, topZ)를 잇는 리본
  const wallStrip = (botRow, topRow) => {
    for (let k = 0; k < botRow.length - 1; k++) {
      faces.push(triFace(oc, botRow[k], botRow[k + 1], topRow[k + 1]));
      faces.push(triFace(oc, botRow[k], topRow[k + 1], topRow[k]));
    }
  };
  wallStrip(botPts[0], topPts[0]);                                  // y=0
  wallStrip(botPts[ny - 1].slice().reverse(), topPts[ny - 1].slice().reverse()); // y=Y
  wallStrip(botPts.map((r) => r[0]).reverse(), topPts.map((r) => r[0]).reverse()); // x=0
  wallStrip(botPts.map((r) => r[nx - 1]), topPts.map((r) => r[nx - 1]));          // x=X

  return sewToSolid(oc, faces).Reversed();
}
