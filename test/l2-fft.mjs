// FFT 컨볼루션 vs 직접 합: node test/l2-fft.mjs
import { kernelSpectrum, convolve, nextPow2 } from '../src/engine/l2/fft.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const W = 32, H = 16, kr = 3, K = 2 * kr + 1;
const img = new Float64Array(W * H), kern = new Float64Array(K * K);
let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
for (let y = kr; y < H - kr; y++) for (let x = kr; x < W - kr; x++) img[y * W + x] = rnd();
for (let i = 0; i < K * K; i++) kern[i] = rnd();
const out = convolve(img, kernelSpectrum(kern, kr, W, H));
let err = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let d = 0;
  for (let j = -kr; j <= kr; j++) for (let i = -kr; i <= kr; i++) {
    const xs = x - i, ys = y - j;
    if (xs >= 0 && xs < W && ys >= 0 && ys < H) d += img[ys * W + xs] * kern[(j + kr) * K + (i + kr)];
  }
  err = Math.max(err, Math.abs(d - out[y * W + x]));
}
ok(err < 1e-9, `FFT 컨볼루션 = 직접 합 (최대오차 ${err.toExponential(2)})`);
ok(nextPow2(1) === 1 && nextPow2(33) === 64, 'nextPow2');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
