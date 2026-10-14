// 3D MC 계면·면 처리: node test/mech3d-surface.mjs
import { fresnelInterface, lambert, reflectFinish } from '../src/engine/mech3d/surface.js';
import { rng } from '../src/engine/l2/mc-slab.js';
import { ok, done } from './mech3d-util.mjs';

const n = 1.586, R0 = ((n - 1) / (n + 1)) ** 2, near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
{
  const f = fresnelInterface(0, 0, -1, 0, 0, 1, 1, n);   // 위에서 아래로 수직 입사, 법선 +z
  ok(near(f.R, R0) && near(f.tz, -1) && near(f.rz, 1), `수직 입사 R=${f.R.toFixed(5)} (해석 ${R0.toFixed(5)}), 투과 방향 유지`);
}
{
  const s = Math.sin(Math.PI / 6), c = Math.cos(Math.PI / 6);
  const f = fresnelInterface(s, 0, -c, 0, 0, 1, 1, n), sinT = Math.hypot(f.tx, f.ty);
  ok(near(sinT, s / n, 1e-12) && f.tz < 0 && near(Math.hypot(f.tx, f.ty, f.tz), 1, 1e-12), `스넬: sinθt=${sinT.toFixed(6)} (해석 ${(s / n).toFixed(6)})`);
  const g = fresnelInterface(-f.tx, -f.ty, -f.tz, 0, 0, 1, n, 1);   // 역방향(매질→공기) 같은 각
  ok(near(g.R, f.R, 1e-12), `역방향 반사율 동일: ${g.R.toFixed(6)} = ${f.R.toFixed(6)}`);
}
{
  const a = Math.PI / 4, f = fresnelInterface(Math.sin(a), 0, Math.cos(a), 0, 0, 1, n, 1);   // 매질 안 45° → 임계각(39°) 초과
  ok(f.R === 1 && near(f.rz, -Math.cos(a)), '전반사(45°, n 1.586→1): R=1, 정반사');
}
{
  const f = fresnelInterface(0.3, 0.1, -Math.sqrt(0.9), 0, 0, 1, n, n);
  ok(near(f.R, 0) && near(f.tx, 0.3) && near(f.tz, -Math.sqrt(0.9)), '같은 굴절률(광학 접촉): 반사 0, 직진');
}
{
  const r = rng(3); let sc = 0, bad = 0; const K = 200000;
  for (let i = 0; i < K; i++) { const [x, y, z] = lambert(0, 0, 1, r); sc += z; if (z < 0 || Math.abs(Math.hypot(x, y, z) - 1) > 1e-9) bad++; }
  ok(bad === 0 && Math.abs(sc / K - 2 / 3) < 0.003, `Lambert: 평균 cosθ ${(sc / K).toFixed(4)} (해석 0.6667), 반구 밖 ${bad}`);
}
{
  const r = rng(5), K = 200000; let alive = 0, side = 0;
  for (let i = 0; i < K; i++) { const d = reflectFinish({ kind: 'whiteDiffuse', R: 0.85 }, 0, 0, -1, 0, 0, 1, r); if (d) { alive++; if (d[2] <= 0) side++; } }
  ok(Math.abs(alive / K - 0.85) < 0.004 && side === 0, `백색 확산 R85: 반사 ${(alive / K).toFixed(4)}, 입사 쪽 반구로만`);
  const m = reflectFinish({ kind: 'metal', R: 1 }, 0.6, 0, -0.8, 0, 0, 1, r);
  ok(m && near(m[0], 0.6) && near(m[2], 0.8), '금속 R100: 정반사');
  let bl = 0; for (let i = 0; i < K; i++) if (reflectFinish({ kind: 'black', R: 0.05 }, 0, 0, -1, 0, 0, 1, r)) bl++;
  const Fb = ((1.5 - 1) / 2.5) ** 2, expB = Fb + (1 - Fb) * 0.05;
  ok(Math.abs(bl / K - expB) < 0.003, `흑색 R5: 반사 ${(bl / K).toFixed(4)} (기대 ${expB.toFixed(4)} = 광택 Fresnel + 확산)`);
  const back = reflectFinish({ kind: 'whiteDiffuse', R: 1 }, 0, 0, 1, 0, 0, 1, r);   // 법선과 같은 쪽으로 오는 빛(안쪽에서 코팅에 닿음)
  ok(back && back[2] < 0, '안쪽에서 닿으면 안쪽 반구로 반사');
}
done();
