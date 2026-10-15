// LED STEP 인식: node test/mech3d-led.mjs
import { findLeds, findEmitters, pcbIndex, faceInfo } from '../src/engine/mech3d/led-detect.js';
import { transformMesh, eulerMatrix, applyPoint } from '../src/engine/mech3d/xform.js';
import { boxMesh, mergeMeshes, ok, done } from './mech3d-util.mjs';

// LED: 몸체 3×2×0.8 + 렌즈 1×1×0.3(위) — 발광면 = 렌즈 윗면(면 번호 6+1 = 7)
const led0 = mergeMeshes([boxMesh(-1.5, -1, 0, 3, 2, 0.8), boxMesh(-0.5, -0.5, 0.8, 1, 1, 0.3)]);
const poses = [[[0, 0, 0], [0, 0, 0]], [[10, 0, 0], [0, 0, 37]], [[20, 5, 0], [0, 0, 90]], [[30, 0, 1], [90, 0, 0]], [[40, 0, 0], [0, 0, 180]]];
const parts = [boxMesh(-5, -10, -1, 60, 20, 1)];   // 0: PCB
for (const [t, r] of poses) parts.push(transformMesh(led0, t, r));
parts.push(boxMesh(50, 0, 0, 3, 2, 0.8));          // 몸체만 같은 크기 상자(다른 부품)
const leds = findLeds(parts, 1);
ok(leds.join() === '1,2,3,4,5', `동일 LED 인식(회전 포함): ${leds.join()}`);
ok(pcbIndex(parts, leds) === 0, 'PCB = LED 가 아닌 최대 부피');
const em = findEmitters(parts, leds, 1, 7);
let worst = 0;
em.forEach((e, k) => {
  const [t, r] = poses[k], R = eulerMatrix(r), ax = applyPoint(R, [0, 0, 1]), pos = applyPoint(R, [0, 0, 1.1], t);
  worst = Math.max(worst, Math.hypot(...e.axis.map((v, i) => v - ax[i])), Math.hypot(...e.pos.map((v, i) => v - pos[i])));
  if (e.needsCheck) worst = Infinity;
});
ok(worst < 1e-5, `발광면 전파: 축·위치 최대 오차 ${worst.toExponential(1)} (측면 자세 포함)`);
ok(Math.abs(faceInfo(parts[1], 7).area - 1) < 1e-6, '발광면 면적 1mm²');
// 면 순서가 다른 인스턴스(면 번호 섞음) → 기술자로 재탐색
const shuffled = { ...parts[2], faceIds: Uint32Array.from(parts[2].faceIds, (f) => (f === 7 ? 3 : f === 3 ? 7 : f)) };
const em2 = findEmitters([parts[0], parts[1], shuffled], [1, 2], 1, 7);
ok(em2[1].face === 3 && !em2[1].needsCheck, `면 순서 다름 → 기술자로 발광면 찾음(면 ${em2[1].face})`);
done();
