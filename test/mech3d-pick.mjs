// 가까운 LED 선택(작은 LED 를 정확히 못 눌러도 클릭 광선에서 가까운 LED·발광면으로 맞춤): node test/mech3d-pick.mjs
import { pickLedNearRay } from '../src/engine/mech3d/led-detect.js';
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
done();
