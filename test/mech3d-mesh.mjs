// 3D 기구 메쉬 유틸: node test/mech3d-mesh.mjs
import { meshVolume, combineParts, bounds } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const a = boxMesh(0, 0, 0, 2, 3, 4);
ok(Math.abs(meshVolume(a.positions, a.triangles) - 24) < 1e-9, `상자 부피 24: ${meshVolume(a.positions, a.triangles)}`);
const flipped = Uint32Array.from(a.triangles); for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
ok(Math.abs(meshVolume(a.positions, flipped) + 24) < 1e-9, '면 방향 뒤집으면 부피 부호 반전');

const b = boxMesh(10, 0, 0, 1, 1, 1);
const c = combineParts([a, b]);
ok(c.triangles.length === 72 && c.positions.length === 144, `결합 크기: 삼각형 ${c.triangles.length / 3}, 정점 ${c.positions.length / 3}`);
ok(c.partOf[0] === 0 && c.partOf[12] === 1 && c.faceOf[13] === b.faceIds[1], '삼각형별 부품·면 번호');
ok(c.triangles[36] === a.positions.length / 3 + b.triangles[0], '두 번째 부품 정점 번호 오프셋');
ok(Math.abs(meshVolume(c.positions, c.triangles) - 25) < 1e-9, '결합 부피 = 합');
const bb = bounds(c.positions);
ok(bb.join() === [0, 0, 0, 11, 3, 4].join(), `외곽 ${bb.join()}`);
done();
