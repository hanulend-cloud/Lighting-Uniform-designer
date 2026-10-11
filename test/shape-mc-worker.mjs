// shape-mc 테스트용 worker: 평판 몸체 단일 LED MC → 반경 출사 광속 히스토그램 + 장부
import { parentPort, workerData } from 'node:worker_threads';
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { makeScene, runBodyMC } from '../src/engine/shape/mc-body.js';

const { W, t, depth, n, medium, rhoB, led, N, seed, dr, nr } = workerData;
const hf = heightfieldFromFn(W, W, 1, () => 0, () => -t);
const sc = makeScene({ hf, ox: W / 2, oy: W / 2, depth, n, medium, rhoB, walls: null });
const hist = new Float64Array(nr);
const res = runBodyMC(sc, { leds: [{ x: W / 2, y: W / 2 }], led, N, seed, onExit: (x, y, w) => {
  const k = Math.floor(Math.hypot(x - W / 2, y - W / 2) / dr); if (k < nr) hist[k] += w;
} });
parentPort.postMessage({ hist, ledger: res.ledger, ms: res.ms });
