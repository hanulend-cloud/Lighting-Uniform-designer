// shape-fast VS7 용 worker: 높이맵 몸체 MC → 노드 격자 출사도(쌍선형 분배 = 빠른 solver 와 같은 텐트 필터)
import { parentPort, workerData } from 'node:worker_threads';
import { makeScene, runBodyMC } from '../src/engine/shape/mc-body.js';

const { hf, ox, oy, depth, n, mua, rhoB, walls, leds, led, N, seed, grid, medium } = workerData;
const sc = makeScene({ hf, ox, oy, depth, n, medium: medium ?? { mus: 0, g: 0, mua }, rhoB, walls });
const { NX, NY, x0, y0, stepX, stepY } = grid, map = new Float64Array(NX * NY), wmap = new Float64Array(NX * NY), A = stepX * stepY;
// box = { rx, ry }: 쌍선형(텐트) 대신 격자점 주변 상자 안 출사만 → 점값 추정(가장자리 점에 벽 쪽 어두운 띠가 섞이지 않게)
const box = workerData.box ?? null, BA = box ? 4 * box.rx * box.ry : 0;
const res = runBodyMC(sc, { leds, led, N, seed, onExit: (x, y, w, fl) => {
  if (box) {
    const a = Math.round((x - x0) / stepX), b = NY > 1 ? Math.round((y - y0) / stepY) : 0;
    if (a < 0 || b < 0 || a >= NX || b >= NY || Math.abs(x - x0 - a * stepX) > box.rx || Math.abs(y - y0 - b * stepY) > box.ry) return;
    map[b * NX + a] += w / BA; if (fl & 8) wmap[b * NX + a] += w / BA;
    return;
  }
  const fa = (x - x0) / stepX, fb = (y - y0) / stepY, a0 = Math.floor(fa), b0 = Math.floor(fb), ta = fa - a0, tb = fb - b0;
  for (const [a, b, ww] of [[a0, b0, (1 - ta) * (1 - tb)], [a0 + 1, b0, ta * (1 - tb)], [a0, b0 + 1, (1 - ta) * tb], [a0 + 1, b0 + 1, ta * tb]]) {
    if (a >= 0 && b >= 0 && a < NX && b < NY) { map[b * NX + a] += (w * ww) / A; if (fl & 8) wmap[b * NX + a] += (w * ww) / A; }
  }
} });
parentPort.postMessage({ map, wmap, ledger: res.ledger, ms: res.ms });
