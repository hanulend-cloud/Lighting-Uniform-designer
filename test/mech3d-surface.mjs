// 3D MC 계면·면 처리: node test/mech3d-surface.mjs
import { fresnelInterface, fresnelPolarized, lambert, reflectFinish } from '../src/engine/mech3d/surface.js';
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
{   // 편광 Fresnel: s/p 분해, 브루스터각, E ⟂ 진행 방향 유지, 비편광 평균 = fresnelInterface
  const a = Math.PI / 4, d = [Math.sin(a), 0, -Math.cos(a)];
  const u = fresnelInterface(...d, 0, 0, 1, 1, n);
  const s = fresnelPolarized(...d, 0, 1, 0, 0, 0, 1, 1, n), p = fresnelPolarized(...d, Math.cos(a), 0, Math.sin(a), 0, 0, 1, 1, n);
  ok(near(0.5 * (s.R + p.R), u.R) && s.R > p.R, `편광 Fresnel 45°: Rs ${s.R.toFixed(4)} Rp ${p.R.toFixed(4)} 평균 = 비편광 ${u.R.toFixed(4)}`);
  const b = Math.atan(n), db = [Math.sin(b), 0, -Math.cos(b)], pb = fresnelPolarized(...db, Math.cos(b), 0, Math.sin(b), 0, 0, 1, 1, n);
  const perp = (E, D) => Math.abs(E[0] * D[0] + E[1] * D[1] + E[2] * D[2]);
  ok(pb.R < 1e-12 && perp([pb.etx, pb.ety, pb.etz], [pb.tx, pb.ty, pb.tz]) < 1e-12 && perp([p.erx, p.ery, p.erz], [p.rx, p.ry, p.rz]) < 1e-12, `브루스터각 p 편광 R ${pb.R.toExponential(1)}, E ⟂ d`);
  const m = Math.SQRT1_2, mx = fresnelPolarized(...d, m * Math.cos(a), m, m * Math.sin(a), 0, 0, 1, 1, n);
  ok(near(mx.R, 0.5 * (s.R + p.R)) && Math.abs(mx.ery) ** 2 / (mx.erx ** 2 + mx.ery ** 2 + mx.erz ** 2) > 0.5, '45° 혼합 편광: R = 평균, 반사광은 s 우세');
}
{   // 흑색·광택 면 처리의 정반사는 입사 매질 굴절률 기준(수지에 접착 → 거의 0)
  const r = rng(5), K = 200000; let air = 0, res = 0;
  for (let i = 0; i < K; i++) { if (reflectFinish({ kind: 'gloss' }, 0, 0, -1, 0, 0, 1, r)) air++; if (reflectFinish({ kind: 'gloss' }, 0, 0, -1, 0, 0, 1, r, n)) res++; }
  ok(Math.abs(air / K - 0.04) < 0.003 && res / K < 0.002, `광택 불투명 정반사: 공기 쪽 ${(air / K).toFixed(4)}, 수지(n ${n}) 쪽 ${(res / K).toFixed(5)}`);
}
done();
