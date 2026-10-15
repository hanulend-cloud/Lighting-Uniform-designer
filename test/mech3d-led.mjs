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

// --- 리뷰 수정 ---
// 1) xAxis: 2×1 직사각형 면의 장축, 회전 후에도 정확. 정사각형은 null
const rect = boxMesh(-1, -0.5, 0, 2, 1, 1);                       // 윗면(face 1) 2×1, 장축 = x
const rr = transformMesh(rect, [3, 1, 0], [0, 0, 37]);
const longAx = [Math.cos(37 * Math.PI / 180), Math.sin(37 * Math.PI / 180), 0];
const dotA = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
ok(Math.abs(dotA(faceInfo(rect, 1).xAxis, [1, 0, 0])) > 0.9999, '직사각형 장축(원본)');
ok(Math.abs(dotA(faceInfo(rr, 1).xAxis, longAx)) > 0.9999, '직사각형 장축(37° 회전 후)');
ok(faceInfo(boxMesh(-1, -1, 0, 2, 2, 1), 1).xAxis === null, '정사각형 면 → xAxis null');
// 2) 대칭 면: 2×2×1 상자 LED, 기준 발광면 = 윗면(1). 면 번호 0·1 을 맞바꿔(윗면=0) 면 순서 일치가 바닥을 가리키게 함
const pcbB = boxMesh(-5, -5, -1, 30, 10, 1);
const b0 = boxMesh(-1, -1, 0, 2, 2, 1), b1 = transformMesh(b0, [10, 0, 0], [0, 0, 0]);
const b1s = { ...b1, faceIds: Uint32Array.from(b1.faceIds, (f) => (f === 1 ? 0 : f === 0 ? 1 : f)) };
const bp = [pcbB, b0, b1s];
const emB = findEmitters(bp, [1, 2], 1, 1, 0);
ok(emB[0].axis[2] > 0.99 && emB[1].face === 0 && !emB[1].needsCheck && emB[1].axis[2] > 0.99, `대칭 면: PCB 반대쪽(윗면) 선택(face ${emB[1].face}, axis z ${emB[1].axis?.[2]})`);
const emC = findEmitters([pcbB, led0], [1], 1, 0, 0);   // 비대칭 LED 의 바닥면(PCB 쪽) 을 기준으로 → 확인 필요
ok(emC.every((e) => e.needsCheck), 'PCB 를 향한 발광축 → needsCheck');
// 3) 닫힌 면(원통형) → degenerate
const cyl = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]), triangles: Uint32Array.from([0, 1, 2, 3, 4, 5]), faceIds: Uint32Array.from([0, 0]), faceCount: 1 };
ok(faceInfo(cyl, 0).degenerate === true, '법선 합 0 인 면 → degenerate');
ok(findEmitters([cyl], [0], 0, 0)[0].needsCheck, 'degenerate 발광면 → needsCheck');
// 4) pcbIndex: 큰 먼 부품보다 LED 근처 부품
const far = boxMesh(500, 500, 0, 100, 100, 100);
ok(pcbIndex([far, ...parts.slice(0, 6)], [2, 3, 4, 5, 6]) === 1, 'PCB = LED 근처의 최대 부피(먼 큰 부품 제외)');
ok(pcbIndex([far], []) === 0 && pcbIndex([parts[1]], [0]) === -1, 'pcbIndex: LED 없으면 최대 부피, 후보 없으면 -1');
done();
