// L2 확산근사 vs adding-doubling: node test/l2-diffusion.mjs  (spec §5.2)
import fs from 'node:fs';
import { diffusionTR, diffusionKernel, diffusionAngles } from '../src/engine/l2/diffusion.js';
import { radEdge, N_RAD, runSlab } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const ref = JSON.parse(fs.readFileSync(new URL('../src/engine/l2/data/ref-ad.json', import.meta.url)));

// τ' ≥ 20 (확산근사 적용 구간). 흡수 0: 절대오차 ≤ 0.01. 흡수 있음: spec V1 한도 0.02 —
// 확산이론은 얕은 경로가 많은 반사광의 흡수를 과대 추정(τ'=20, μa·t=0.02 에서 R −0.016, MC 는 AD 와 일치).
// 실소재 수준(μa·t ≤ 0.003)에서는 훨씬 작다. 한계는 가정 패널에 표기.
for (const [label, sel, lim] of [['흡수 0', (c) => c.muaT === 0, 0.01], ['흡수 μa·t=0.02', (c) => c.muaT > 0, 0.02]]) {
  let worst = 0, wc = null;
  for (const c of ref.cases.filter((c) => c.tauR >= 20 && sel(c))) {
    const a = diffusionTR(c.tauR, c.muaT, c.n, 1), d = diffusionTR(c.tauR, c.muaT, c.n, 'diffuse');
    const e = Math.max(Math.abs(a.T - c.UT1), Math.abs(a.R - c.UR1), Math.abs(d.T - c.UTU), Math.abs(d.R - c.URU));
    if (e > worst) { worst = e; wc = c; }
  }
  ok(worst <= lim, `확산근사 τ'≥20 ${label}: 최대 절대오차 ${worst.toFixed(4)} ≤ ${lim} (${wc && `τ'=${wc.tauR} n=${wc.n}`})`);
}
// 흡수 0 에너지 보존
{ const r = diffusionTR(50, 0, 1.59, 1); ok(Math.abs(r.T + r.R - 1) < 1e-12, 'μa=0 → T+R=1'); }
// 커널: 합 1, RMS 가 MC(독립 계산) 와 5% 이내 — τ'=20, g=0.9, n=1.59, 법선 입사
{
  const k = diffusionKernel(20, 1.59, 1), r = runSlab({ tau: 200, g: 0.9, n: 1.59, inc: 1, N: 20000, seed: 5 });
  const rms = (a) => { let s = 0, m = 0; for (let i = 0; i < N_RAD; i++) { s += a[i]; m += a[i] * ((radEdge(i) + radEdge(i + 1)) / 2) ** 2; } return Math.sqrt(m / s); };
  const s = k.reduce((p, v) => p + v, 0), rd = rms(k), rm = rms(r.rad);
  ok(Math.abs(s - 1) < 1e-9 && Math.abs(rd / rm - 1) <= 0.05, `커널 τ'=20 합=${s.toFixed(6)} RMS 확산 ${rd.toFixed(3)}t vs MC ${rm.toFixed(3)}t`);
}
// 각분포: 합 1
{ const a = diffusionAngles(1.59); ok(Math.abs(a.reduce((p, v) => p + v, 0) - 1) < 1e-9, '출사각 분포 합 1'); }

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
