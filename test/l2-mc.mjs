// L2 MC 슬래브 기준 대조: node test/l2-mc.mjs  (spec V2·V3·V5)
// 기준값은 iadpython(Prahl adding-doubling)으로 산출 — tools/gen-ref-ad.py 와 동일 조건.
import { runSlab, totals, pathBin, pathBinCenter, N_PATH } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// V5 van de Hulst 슬래브(a=0.9, b=2, g=0.75, n=1): AD Rd=0.09740, Tt=0.66096
{
  const o = totals(runSlab({ tau: 1.8, g: 0.75, n: 1, inc: 1, N: 200000, seed: 7 }), 0.2);
  ok(near(o.R, 0.09740, 0.005) && near(o.Tb + o.Ts, 0.66096, 0.005),
    `V5 van de Hulst R=${o.R.toFixed(4)}(0.0974) T=${(o.Tb + o.Ts).toFixed(4)}(0.6610)`);
}
// V3 투명 슬래브 해석해 T=(1−R)²/(1−R²)
{
  const n = 1.59, Rf = ((n - 1) / (n + 1)) ** 2, Tc = (1 - Rf) ** 2 / (1 - Rf * Rf);
  const o = totals(runSlab({ tau: 0, g: 0.9, n, inc: 1, N: 20000 }));
  ok(near(o.Tb, Tc, 0.0005) && o.Ts === 0, `V3 투명 슬래브 T=${o.Tb.toFixed(5)} (해석 ${Tc.toFixed(5)})`);
}
// V2 에너지 수지: 흡수 0 → T+R=1, 흡수 >0 → T+R<1
for (const tau of [0.5, 5, 50]) {
  const r = runSlab({ tau, g: 0.9, n: 1.59, inc: 0.7, N: 20000, seed: 3 });
  const o = totals(r), a = totals(r, 0.1);
  ok(near(o.Tb + o.Ts + o.R, 1, 0.005), `V2 τ=${tau} T+R=${(o.Tb + o.Ts + o.R).toFixed(4)}`);
  ok(a.Tb + a.Ts + a.R < o.Tb + o.Ts + o.R, `V2 τ=${tau} 흡수 적용 시 T+R 감소`);
}
// AD 직접 대조 (b=10, g=0.9, n=1.59): UR1 0.42620 UT1 0.57380 URU 0.47768 UTU 0.52232
{
  const on = totals(runSlab({ tau: 10, g: 0.9, n: 1.59, inc: 1, N: 100000, seed: 11 }));
  const od = totals(runSlab({ tau: 10, g: 0.9, n: 1.59, inc: 'diffuse', N: 100000, seed: 12 }));
  ok(near(on.R, 0.42620, 0.01) && near(on.Tb + on.Ts, 0.57380, 0.01), `AD 법선 R=${on.R.toFixed(4)} T=${(on.Tb + on.Ts).toFixed(4)}`);
  ok(near(od.R, 0.47768, 0.01) && near(od.Tb + od.Ts, 0.52232, 0.01), `AD 확산 R=${od.R.toFixed(4)} T=${(od.Tb + od.Ts).toFixed(4)}`);
}
// 경로길이 bin 경계
ok(pathBin(0) === 0 && pathBin(1e9) === N_PATH - 1 && pathBinCenter(0) > 0.5, '경로길이 bin 경계 처리');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
