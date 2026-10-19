// 강체 변환·기본값: node test/mech3d-xform.mjs
import { transformMesh, eulerMatrix, applyPoint, scaleMoveMesh, isIdentityXform } from '../src/engine/mech3d/xform.js';
import { setMech3dMesh, getMech3d, applyPartXforms, redetectContacts, clearMech3d } from '../src/engine/mech3d/runtime.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { nextXform } from '../src/ui/mech3d-panel.js';
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
ok(O.faces.length === 0 && O.cone === 90 && O.cell == null && O.cellS == null && O.cellW == null && O.edgeExcl === 0.5 && O.targetLen === 0.8, '관측 기본값');
const old = { name: 'x', parts: [], contacts: [] };
ok(migrateMech3d(old).light.kind === 'none' && old.observe.faces.length === 0, '마이그레이션: 빠진 필드 채움');
const mb = { ...m, bvh: { x: 1 } };
ok(!('bvh' in transformMesh(mb, [1, 0, 0], [0, 0, 0])), '변환 사본은 캐시된 bvh 를 버림');

// 부품 크기·위치 조절 — 원본 외곽 중심 기준 축별 배율 뒤 이동
{ const b0 = { ...boxMesh(0, 0, 0, 2, 3, 4), volume: 24 }, q = scaleMoveMesh(b0, { scale: [2, 1, 0.5], offset: [10, 0, 0] }, [1, 1.5, 2]), bb = bounds(q.positions);
  ok([-1 + 10, 0, 1, 3 + 10, 3, 3].every((v, k) => Math.abs(bb[k] - v) < 1e-6) && Math.abs(meshVolume(q.positions, q.triangles) - 24) < 1e-4 && q.volume === 24 && q.faceIds === b0.faceIds, '배율 2·1·0.5 + 이동 10: 외곽·부피·면 번호');
  ok(scaleMoveMesh(b0, null, [0, 0, 0]) === b0 && isIdentityXform({ scale: [1, 1, 1], offset: [0, 0, 0] }) && !isIdentityXform({ scale: [1, 1, 1.1] }), '항등 = 원본');
  let err = ''; try { scaleMoveMesh(b0, { scale: [0, 1, 1] }, [0, 0, 0]); } catch (e) { err = e.message; } ok(/0보다/.test(err), '배율 0 거부'); }
{ const A = boxMesh(0, 0, 0, 10, 10, 2), B = boxMesh(0, 0, 2, 10, 10, 2);   // B 가 A 위에 맞붙음
  setMech3dMesh('t', [A, B]); const raw = getMech3d();
  const c0 = redetectContacts([]).map((c) => ({ ...c, mode: 'air' }));
  ok(c0.length >= 1, '맞붙은 두 상자 접촉면 감지');
  ok(applyPartXforms([null, { offset: [0, 0, 0.001], scale: [1, 1, 1] }]) && getMech3d() !== raw && getMech3d().raw === raw && getMech3d().parts[0] === raw.parts[0], '변환: 새 장면, 원본 유지, 안 바뀐 부품 재사용');
  ok(!applyPartXforms([null, { offset: [0, 0, 0.001], scale: [1, 1, 1] }]), '같은 변환이면 다시 만들지 않음');
  ok(redetectContacts(c0).length === c0.length && redetectContacts(c0).every((c) => c.mode === 'air'), '조금 옮겨도(간격 0.001) 접촉 유지 · 모드 유지');
  applyPartXforms([null, { offset: [0, 0, 5], scale: [1, 1, 1] }]);
  ok(redetectContacts(c0).length === 0, '떨어뜨리면 접촉면 사라짐');
  applyPartXforms([null, null]);
  ok(getMech3d() === raw, '원래대로 → 원본 장면');
  clearMech3d(); }
ok(nextXform(null, 's0', 2, true)?.scale.join() === '2,2,2' && nextXform(null, 's1', 2, false)?.scale.join() === '1,2,1' && nextXform(null, 'o2', 3, true)?.offset.join() === '0,0,3'
  && nextXform({ offset: [0, 0, 0], scale: [2, 1, 1] }, 's0', 1, false) === null && nextXform(null, 's0', 100, false).scale[0] === 10 && nextXform(null, 's0', NaN, false) === null, 'nextXform: 비율 고정·축별·이동·항등 → null·상한·NaN');
done();
