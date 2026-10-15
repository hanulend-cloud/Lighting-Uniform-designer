// 강체 변환·기본값: node test/mech3d-xform.mjs
import { transformMesh, eulerMatrix, applyPoint } from '../src/engine/mech3d/xform.js';
import { defaultLight, defaultObserve, migrateMech3d, SOLDER_R } from '../src/engine/mech3d/defs.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const R = eulerMatrix([0, 0, 90]);
const p = applyPoint(R, [10, 0, 0], [1, 2, 3]);
ok(Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1] - 12) < 1e-9 && Math.abs(p[2] - 3) < 1e-9, `Z 90° + 이동: ${p.map((v) => v.toFixed(6))}`);
const m = boxMesh(0, 0, 0, 2, 3, 4), t = transformMesh(m, [5, 0, 0], [30, 45, 60]);
ok(Math.abs(meshVolume(t.positions, t.triangles) - 24) < 1e-4 && t.faceIds === m.faceIds, '강체 변환: 부피·면 번호 보존');
ok(transformMesh(m, [0, 0, 0], [0, 0, 0]).positions === m.positions, '항등 변환은 원본 재사용');
const L = defaultLight(), O = defaultObserve();
ok(L.kind === 'none' && L.solder === '백색' && L.manual.count === 10 && SOLDER_R['녹색'] === 0.3, '광원 기본값');
ok(O.faces.length === 0 && O.cone === 30 && O.cell === 0.5 && O.edgeExcl === 0.5 && O.targetLen === 0.8, '관측 기본값');
const old = { name: 'x', parts: [], contacts: [] };
ok(migrateMech3d(old).light.kind === 'none' && old.observe.faces.length === 0, '마이그레이션: 빠진 필드 채움');
const mb = { ...m, bvh: { x: 1 } };
ok(!('bvh' in transformMesh(mb, [1, 0, 0], [0, 0, 0])), '변환 사본은 캐시된 bvh 를 버림');
done();
