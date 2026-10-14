// V3D-1: 3D MC vs S1(높이맵 MC, VS7M 검증됨) — Milky 평판 교차 검증: node test/mech3d-v1.mjs  (N=…, MILKY=… 로 조정)
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { makeScene, runBodyMC } from '../src/engine/shape/mc-body.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { ledSource } from '../src/engine/mech3d/sources.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartMaterialParam, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable(), W = 120, t = 2, depth = 12, rhoB = 0.8;
const milky = +(process.env.MILKY ?? 3), N = +(process.env.N ?? 600000), B = 10, RING = 5, NR = 6;
setMech3dMesh('v1', [boxMesh(-W / 2, -W / 2, depth - t, W, W, t), boxMesh(-200, -200, -1, 400, 400, 1)]);
const parts = [setPartMaterialParam(setPartMaterial(defaultPart(0, '판', 1), 'milky'), 'milky', milky), setPartFinish(defaultPart(1, 'PCB', 1), null, { kind: 'whiteDiffuse', R: rhoB })];
// 모델 차이: S1 은 격자 밖 = 측면 탈출, 3D PCB 400mm 는 판 밖으로 나간 빛 일부를 되돌림 → 윗면 총 +0.4%(PCB 를 120mm 로 맞추면 +0.07%, 1σ 이내)
const S3 = buildTraceScene(getMech3d(), { name: 'v1', parts, contacts: [] }, { table });
const o = S3.optics[0];

const rings = () => Array.from({ length: B }, () => new Float64Array(NR + 1));   // 배치별 [고리 0..NR-1, 윗면 총]
const add = (acc, b, x, y, w) => { const r = Math.hypot(x, y), k = Math.floor(r / RING); if (k < NR) acc[b][k] += w; acc[b][NR] += w; };

const a3 = rings(), a1 = rings(), per = Math.floor(N / B), src = ledSource({ x: 0, y: 0, z: 0 }), F = src.flux;   // 고리·총 = 광원 광속 대비 비율
let ms3 = 0, ms1 = 0;
for (let b = 0; b < B; b++) {
  const r3 = runMC3D(S3, { source: src, N: per, seed: 101 + b, onExit: (q, f, x, y, z, dx, dy, dz, w) => { if (q === 0 && f === 1) add(a3, b, x, y, w / F); } });
  ms3 += r3.ms;
  const hf = heightfieldFromFn(W, W, 0.5, () => 0, () => -t);
  const S1 = makeScene({ hf, ox: 0, oy: 0, depth, n: o.n, medium: { mus: o.mus, g: o.g, mua: o.mua }, rhoB, walls: null });
  const r1 = runBodyMC(S1, { leds: [{ x: 0, y: 0 }], led: { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 }, N: per, seed: 9001 + b, onExit: (x, y, w) => add(a1, b, x, y, w / F) });
  ms1 += r1.ms;
}
const stat = (acc, k) => { const v = acc.map((x) => x[k]), m = v.reduce((s, x) => s + x, 0) / B; return { m, se: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (B - 1) / B) }; };
console.log(`Milky ${milky}, N ${N}: 3D ${(ms3 / 1000).toFixed(1)}s, S1 ${(ms1 / 1000).toFixed(1)}s`);
for (let k = 0; k < NR; k++) {
  const x = stat(a3, k), y = stat(a1, k), d = x.m / y.m - 1, sig = Math.hypot(x.se, y.se) / y.m;
  ok(Math.abs(d) <= Math.max(0.03, 3 * sig), `V3D-1 고리 ${k * RING}~${(k + 1) * RING}mm: 3D ${x.m.toExponential(3)} / S1 ${y.m.toExponential(3)} (차 ${(d * 100).toFixed(2)}%, 3σ ${(3 * sig * 100).toFixed(2)}%)`);
}
const T3 = stat(a3, NR), T1 = stat(a1, NR);
ok(Math.abs(T3.m / T1.m - 1) <= 0.01, `V3D-1 윗면 총 출사: 3D ${T3.m.toFixed(4)} / S1 ${T1.m.toFixed(4)} (차 ${((T3.m / T1.m - 1) * 100).toFixed(2)}% ≤ 1%, σ ${(Math.hypot(T3.se, T1.se) / T1.m * 100).toFixed(2)}%)`);
done();
