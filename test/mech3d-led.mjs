// LED STEP 인식: node test/mech3d-led.mjs
import { findLeds, findEmitters, pcbIndex, faceInfo, refineEmitterFace, emitterFaceAway, autoLedGroup } from '../src/engine/mech3d/led-detect.js';
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

// --- 국소 PCB 방향 판정 ---
// 비대칭 옆면 발광 LED: 몸체 + (−x 쪽 돌기). 발광면 = 몸체 +x 면(5), PCB(윗면 z=0) 와 수직
const bump = (x0) => boxMesh(x0, -0.3, 0.2, 0.5, 0.6, 0.4);
const sideLed = mergeMeshes([boxMesh(-1.5, -1, 0, 3, 2, 0.8), bump(-2.0)]);
const sideMirror = mergeMeshes([boxMesh(-1.5, -1, 0, 3, 2, 0.8), bump(1.5)]);   // 발광 −x(면 4)
const pcb100 = boxMesh(-50, -10, -1, 100, 20, 1);
const sp = [pcb100, ...[0, -40, 40].map((x) => transformMesh(sideLed, [x, 0, 0.1], [0, 0, 0]))];
const emS = findEmitters(sp, [1, 2, 3], 1, 5, 0);
ok(emS.every((e) => e.face === 5 && !e.needsCheck && e.axis[0] > 0.99), `옆면 발광 LED x=0/−40/+40 → 기준 면 5, needsCheck 없음`);
const emM = findEmitters([pcb100, sideLed, transformMesh(sideMirror, [40, 0, 0.1], [0, 0, 0])], [1, 2], 1, 5, 0);
ok(emM[1].face === 4 && !emM[1].needsCheck && emM[1].axis[0] < -0.99, `거울상 LED(발광 −x) x=+40 → 면 ${emM[1].face}`);
const big = boxMesh(-2500, -10, -1, 5000, 20, 1);
const rotLed = transformMesh(led0, [2000, 0, 1.5], [10, 20, 30]);
const emR = findEmitters([big, led0, rotLed], [1, 2], 1, 7, 0);
ok(!emR[1].needsCheck && emR[1].face === 7, '5000mm PCB 위 x≈2000 회전 LED → needsCheck 없음');
const swapIds = (m, a, b) => ({ ...m, faceIds: Uint32Array.from(m.faceIds, (f) => (f === a ? b : f === b ? a : f)) });
const sym = boxMesh(-1, -1, 0, 2, 2, 1), pc2 = boxMesh(-20, -10, -1, 40, 20, 1);
const emT = findEmitters([pc2, sym, swapIds(transformMesh(sym, [10, 0, 0.1], [0, 0, 0]), 0, 1)], [1, 2], 1, 1, 0);
ok(!emT[1].needsCheck && emT[1].axis[2] > 0.99, '위발광 대칭 상자(상·하 id 교환) → 윗면');
const emY = findEmitters([pc2, sym, swapIds(transformMesh(sym, [10, 0, 0.1], [0, 0, 0]), 5, 0)], [1, 2], 1, 5, 0);   // 면 순서 일치 면이 기술자 불일치 → 재탐색, 사방 동점
ok(emY[1].needsCheck, '옆발광 대칭 상자(면 순서 불일치, 재탐색 동점) → needsCheck');
// 평범한 옆발광 상자 LED: 면 순서 일치 + ±x 동일 기술자여도 신뢰(동점 규칙은 재탐색에만)
const sbox = boxMesh(-1.5, -1, 0, 3, 2, 0.8);
const sb = [pcb100, ...[-40, 0, 40].map((x) => transformMesh(sbox, [x, 0, 0.1], [0, 0, 0]))];
const emP = findEmitters(sb, [1, 2, 3], 2, 5, 0);
ok(emP.every((e) => e.face === 5 && !e.needsCheck && e.axis[0] > 0.99), '평범한 옆발광 상자 LED x=−40/0/40 → 면 순서 일치 신뢰');

// 반구 돔 렌즈 LED(STEP 렌즈 돔): 곡면 면 중심은 렌즈 솔리드 안 → 법선 방향 표면(돔 꼭대기)에서 발광, needsCheck 없음
function domeMesh(cx, cy, z0, r, n = 24) {   // 닫힌 반구: 면 0 = 돔(바깥 법선), 면 1 = 바닥 원판(−z)
  const P = [], T = [], F = [], pt = (th, ph) => [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), z0 + r * Math.cos(th)];
  const add = (a, b, c, f) => { const i = P.length / 3; P.push(...a, ...b, ...c); T.push(i, i + 1, i + 2); F.push(f); };
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const t0 = (i / n) * Math.PI / 2, t1 = ((i + 1) / n) * Math.PI / 2, p0 = (j / (2 * n)) * 2 * Math.PI, p1 = ((j + 1) / (2 * n)) * 2 * Math.PI;
    if (i > 0) add(pt(t0, p0), pt(t1, p0), pt(t0, p1), 0);
    add(pt(t0, p1), pt(t1, p0), pt(t1, p1), 0);
    if (i === n - 1) add([cx, cy, z0], pt(t1, p1), pt(t1, p0), 1);
  }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 2 };
}
const domeLed = mergeMeshes([boxMesh(-1.75, -1.75, 0, 3.5, 3.5, 1.4), domeMesh(0, 0, 1.4, 1.4)]);   // 돔 = 면 6
const dp = [pcb100, ...[-20, 0, 20].map((x) => transformMesh(domeLed, [x, 0, 0], [0, 0, 0]))];
const emD = findEmitters(dp, [1, 2, 3], 1, 6);
ok(emD.every((e) => !e.needsCheck && e.axis[2] > 0.99 && Math.abs(e.pos[2] - 2.8) < 0.02), `돔 렌즈 LED → 돔 꼭대기에서 +z 발광(z ${emD[0].pos?.[2]?.toFixed(3)}), needsCheck 없음`);
ok(refineEmitterFace(domeLed, 1) === 6, '몸체 윗면 클릭 → 돔(가장 바깥 평행 면)');
// 도면 광원(PCB 가 기구 부품): 받치는 부품 반대쪽 면으로 — 옆면·아랫면을 눌러도 윗면(렌즈) 발광
const sup = boxMesh(-5, -5, -1, 10, 10, 1);
ok(emitterFaceAway(led0, 0, sup) === 7 && emitterFaceAway(led0, 4, sup) === 7 && emitterFaceAway(led0, 7, sup) === 7, '받침 부품 반대쪽: 아랫면·옆면·렌즈 클릭 → 렌즈 윗면(7)');
ok(emitterFaceAway(domeLed, 2, sup) === 6, '돔 LED 옆면 클릭 → 돔(6)');
// 자동 인식: PCB 위 돔 LED 6개 + 나사 2개(같은 모양 2개 — 개수 부족) + 확산판 → LED 6개, 발광면 = 돔
const scene = [boxMesh(-40, -5, -1, 80, 10, 1), boxMesh(-40, -5, 6, 80, 10, 3), ...[-25, -15, -5, 5, 15, 25].map((x) => transformMesh(domeLed, [x, 0, 0], [0, 0, 0])), boxMesh(-39, -4, -3, 1, 1, 2), boxMesh(38, -4, -3, 1, 1, 2)];
const au = autoLedGroup(scene);
ok(au && au.leds.join() === '2,3,4,5,6,7' && au.face === 6 && au.support === 0, `자동 인식: LED ${au?.leds.join()} · 면 ${au?.face} · 받침 ${au?.support}`);
ok(autoLedGroup(scene, { skip: new Set([2, 3, 4, 5, 6]) }) === null, '관측면 등으로 빠져 1개만 남으면 → 인식 안 함(같은 부품 2개 이상)');
// 같은 부품 2개 이상 + PCB 위 → LED. 2개만 있어도 인식, 키 큰 LED(높이 6 mm)도 PCB 에 닿아 있으면 인식
const two = autoLedGroup([scene[0], scene[1], transformMesh(domeLed, [-10, 0, 0], [0, 0, 0]), transformMesh(domeLed, [10, 0, 0], [0, 0, 0])]);
ok(two && two.leds.join() === '2,3' && two.face === 6 && two.support === 0, `PCB 위 같은 LED 2개 → 인식(${two?.leds.join()} · 면 ${two?.face})`);
const tall = boxMesh(-1.5, -1.5, 0, 3, 3, 6), tl = autoLedGroup([scene[0], scene[1], ...[-10, 0, 10].map((x) => transformMesh(tall, [x, 0, 0], [0, 0, 0]))]);
ok(tl && tl.leds.join() === '2,3,4' && tl.support === 0, `키 큰 LED(3×3×6) → 인식(${tl?.leds.join()} · 받침 ${tl?.support})`);
// 실제 도면: LED 가 PCB 위에 0.4 mm 떠 있음(패드·솔더 미모델) → 그래도 PCB 위 LED. 더 적은 반복 부품(나사 3개)보다 우선
const pad = autoLedGroup([scene[0], scene[1], ...[-25, -15, -5, 5, 15].map((x) => transformMesh(domeLed, [x, 0, 0.4], [0, 0, 0])), ...[-30, 0, 30].map((x) => boxMesh(x, -4, -3, 1, 1, 2))]);
ok(pad && pad.leds.join() === '2,3,4,5,6', `PCB 위 0.4 mm 뜬 LED 5개 → 인식(${pad?.leds.join()})`);
// 뺀 후보와 이유를 알려 줌(사용자에게 '왜 이것만?' 설명)
const farG = autoLedGroup([scene[0], scene[1], ...[-25, -15, -5, 5].map((x) => transformMesh(domeLed, [x, 0, 1.5], [0, 0, 0])), ...[-10, 10].map((x) => boxMesh(x - 1, 2, 0, 2, 2, 1))]);
ok(farG && farG.leds.length === 2 && farG.rejected?.[0]?.count === 4 && /PCB/.test(farG.rejected[0].why), `뺀 후보 보고: ${farG?.rejected?.map((r) => `${r.count}개 ${r.why}`).join(' · ')}`);
ok(autoLedGroup([scene[0], scene[1], ...[-25, -15, -5, 5].map((x) => transformMesh(domeLed, [x, 0, 2], [0, 0, 0]))]) === null, '떠 있는 반복 부품(받침 없음) → 인식 안 함');
done();
