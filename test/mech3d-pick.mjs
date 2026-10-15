// 가까운 LED 선택(작은 LED 를 정확히 못 눌러도 클릭 광선에서 가까운 LED·발광면으로 맞춤): node test/mech3d-pick.mjs
import { pickLedNearRay, refineEmitterFace, snapRadius, findEmitters, faceInfo } from '../src/engine/mech3d/led-detect.js';
import { transformMesh } from '../src/engine/mech3d/xform.js';
import { boxMesh, mergeMeshes, ok, done } from './mech3d-util.mjs';

// LED: 몸체 3×2×0.8 + 렌즈 1×1×0.3(위) — 렌즈 윗면 = 면 7
const led0 = mergeMeshes([boxMesh(-1.5, -1, 0, 3, 2, 0.8), boxMesh(-0.5, -0.5, 0.8, 1, 1, 0.3)]);
const parts = [boxMesh(-5, -10, -1, 60, 20, 1), transformMesh(led0, [0, 0, 0], [0, 0, 0]), transformMesh(led0, [20, 0, 0], [0, 0, 0])];
const cands = [1, 2];

// 위에서, LED(20,0) 중심에서 1mm 벗어난 광선 → LED 2 의 렌즈 윗면(몸체 윗면과 거리 같음 → 카메라에 가까운 렌즈)
let r = pickLedNearRay(parts, cands, [21, 0, 50], [0, 0, -1]);
ok(r && r.part === 2 && r.face === 7, `위에서 1mm 빗나간 클릭 → LED ${r?.part} 면 ${r?.face}`);
// 10mm 떨어진 광선 → 없음
r = pickLedNearRay(parts, cands, [10, 10, 50], [0, 0, -1]);
ok(r === null, '10mm 떨어진 클릭 → 선택 없음');
// 카메라 뒤쪽 LED 는 고르지 않음
r = pickLedNearRay(parts, cands, [20, 0, -50], [0, 0, -1]);
ok(r === null, '카메라 뒤 LED 는 선택 안 함');
// 측면 발광 패키지(렌즈가 −x 를 향함), −x 쪽에서 +x 방향으로 본 광선 → 카메라를 향한 렌즈 윗면
const side = [boxMesh(-5, -10, -1, 60, 20, 1), transformMesh(led0, [0, 0, 2], [0, -90, 0])];
r = pickLedNearRay(side, [1], [-30, 1, 2], [1, 0, 0]);
ok(r && r.part === 1 && r.face === 7, `측면 발광 패키지 → 면 ${r?.face}(카메라 쪽 렌즈 면)`);
// 같은 패키지를 위에서 보면 렌즈 면(법선 −x)은 카메라를 향하지 않음 → 몸체 윗면 쪽(렌즈 아님)
r = pickLedNearRay(side, [1], [0, 0, 50], [0, 0, -1]);
ok(r && r.face !== 7, `측면 패키지를 위에서 → 렌즈 아닌 면 ${r?.face}`);

// 발광면 보정: 클릭한 면과 평행(법선 내적 > 0.95)한 면 중 법선 방향으로 가장 바깥 면
ok(refineEmitterFace(parts[2], 1) === 7 && Math.abs(faceInfo(parts[2], 7).c[2] - 1.1) < 1e-6, `몸체 윗면 클릭 → 렌즈 윗면 ${refineEmitterFace(parts[2], 1)}`);
ok(refineEmitterFace(side[1], 1) === 7, `측면 패키지 몸체 −x 면 → 렌즈 −x 면 ${refineEmitterFace(side[1], 1)}`);
const plain = boxMesh(0, 0, 0, 3, 2, 1);
ok(refineEmitterFace(plain, 1) === 1, '단순 상자 LED → 같은 면');
// 안쪽 발광 방지: 몸체 윗면(렌즈 속)을 발광면으로 주면 needsCheck
const emIn = findEmitters(parts, cands, 1, 1, 0);
ok(emIn.every((e) => e.needsCheck), `발광 위치가 LED 솔리드 안 → 확인 필요(${emIn.filter((e) => e.needsCheck).length}/${emIn.length})`);
const emOk = findEmitters(parts, cands, 1, 7, 0);
ok(emOk.every((e) => !e.needsCheck), '렌즈 윗면 → 정상');
// 화면 기준 맞춤 반경: max(5mm, 14px × 화소당 mm). 값이 없으면 5mm
ok(snapRadius(0.1) === 5 && Math.abs(snapRadius(1) - 14) < 1e-9 && snapRadius(undefined) === 5 && snapRadius(NaN) === 5, `맞춤 반경 ${snapRadius(0.1)} / ${snapRadius(1)} / ${snapRadius(undefined)}`);
// 멀리서 본 경우(화소당 1mm): 9.4mm 빗나간 클릭도 LED 선택(고정 5mm 면 없음)
r = pickLedNearRay(parts, cands, [8, 5, 50], [0, 0, -1], snapRadius(1));
ok(r && r.part === 1 && pickLedNearRay(parts, cands, [8, 5, 50], [0, 0, -1]) === null, `화소당 1mm → 9.4mm 빗나간 클릭도 LED ${r?.part}`);
done();
