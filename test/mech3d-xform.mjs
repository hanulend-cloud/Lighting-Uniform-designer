// 강체 변환·기본값: node test/mech3d-xform.mjs
import { transformMesh, eulerMatrix, applyPoint, scaleMoveMesh, isIdentityXform } from '../src/engine/mech3d/xform.js';
import { setMech3dMesh, getMech3d, applyPartXforms, applyPartMods, redetectContacts, clearMech3d } from '../src/engine/mech3d/runtime.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { xformFromInput, xformEditor } from '../src/ui/mech3d-panel.js';
import { defaultLight, defaultObserve, migrateMech3d, SOLDER_R } from '../src/engine/mech3d/defs.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, mergeMeshes, ok, done } from './mech3d-util.mjs';

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
{ const info = { center0: [10, 5, 1], size0: [20, 10, 2], lim: { move: [[-3, 4], [-Infinity, Infinity], [0, 6]], size: [24, Infinity, 2], uniform: 1.2 } };
  const F = (xf, key, v, lock = false) => xformFromInput(xf, key, v, lock, info);
  ok(F(null, 'c0', 12).xf.offset.join() === '2,0,0' && !F(null, 'c0', 12).clamped, '중심 X 10 → 12 = 이동 +2');
  ok(F(null, 'c0', 20).xf.offset[0] === 4 && F(null, 'c0', 20).clamped && F(null, 'c2', 0).xf === null && F(null, 'c2', 0).clamped, '범위 밖 → 한계값(+4) · 아래로는 0 에서 막힘');
  ok(F(null, 'c1', -100).xf.offset[1] === -105 && !F(null, 'c1', -100).clamped, '장애물 없는 축은 제한 없음');
  ok(F(null, 'z0', 22).xf.scale.join() === '1.1,1,1' && F(null, 'z0', 30).xf.scale[0] === 1.2 && F(null, 'z0', 30).clamped, '크기 X 22mm → 배율 1.1 · 30 → 최대 24(1.2)');
  ok(F(null, 'z2', 3).clamped && F(null, 'z2', 3).xf === null && F(null, 'z2', 1).xf.scale[2] === 0.5, '크기 Z 최대 2(접촉) · 줄이기는 가능');
  const u = F(null, 'z0', 30, true);
  ok(u.clamped && u.xf.scale.every((v) => Math.abs(v - 1.2) < 1e-9), '비율 고정: 최대 1.2배');
  ok(F(null, 'c0', NaN).xf === null && !F(null, 'c0', NaN).clamped, 'NaN 무시');
  const h = xformEditor({ size: [20, 10, 2], xform: { offset: [2, 0, 0], scale: [1, 1, 1] } }, info, false);
  ok(h.includes('value="12.00"') && h.includes('min="9.00"') && h.includes('max="16.00"') && h.includes('9.00 ~ 16.00') && h.includes('— ~ —') && h.includes('24.00') && !h.includes('m3-xfhint') && !h.includes('m3-sub') && h.includes('위치 = 부품 외곽 중심'), '편집기: 현재 중심·가능 범위·최대 크기 표시(제목은 접는 구역 요약)');
  const hl = xformEditor({ size: [20, 10, 2] }, { ...info, lim: { ...info.lim, uniform: 1 } }, true);
  ok(hl.includes('m3-xfhint') && hl.includes('최대*') && hl.includes('max="20.00"'), '비율 고정으로 막히면 이유 안내'); }
{ setMech3dMesh('s', [boxMesh(0, 0, 0, 40, 10, 2)]); const raw = getMech3d();
  const mod = { frame: { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, dt: 0.5, h: 0, R: 1, centers: [], cell: 0.5 };
  ok(applyPartMods([{ shapeMod: mod }]) && Math.abs(meshVolume(getMech3d().parts[0].positions, getMech3d().parts[0].triangles) - 1000) < 1e-3 && getMech3d().raw === raw, 'shapeMod Δt 0.5 반영(부피 1000), 원본 유지');
  ok(!applyPartMods([{ shapeMod: mod }]), '같은 변경이면 다시 만들지 않음');
  ok(applyPartMods([{}]) && getMech3d() === raw, 'shapeMod 지우면 원본'); clearMech3d(); }
{ // 부품별 메모: 다른 부품만 바뀌면 이 부품은 다시 만들지 않음
  setMech3dMesh('s2', [boxMesh(0, 0, 0, 40, 10, 2), boxMesh(0, 20, 0, 10, 10, 2)]);
  const mod = { frame: { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, dt: 0.2, h: 0.5, R: 3, centers: [[10, 5], [30, 5]], cell: 0.5 };
  applyPartMods([{ shapeMod: mod }, {}]); const p0 = getMech3d().parts[0];
  applyPartMods([{ shapeMod: mod }, { xform: { offset: [1, 0, 0], scale: [1, 1, 1] } }]);
  ok(getMech3d().parts[0] === p0 && getMech3d().parts[1] !== getMech3d().raw.parts[1], '다른 부품 xform 변경 → 형상 부품은 그대로(메모)');
  clearMech3d(); }
{ // 비 2.5D(관측 방향 두 겹) 부품 → shapeMod 건너뜀(경고)
  const two = mergeMeshes([boxMesh(0, 0, 0, 40, 10, 1), boxMesh(0, 0, 2, 40, 10, 1)]);
  setMech3dMesh('s3', [two]); const raw = getMech3d();
  const mod = { frame: { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, dt: 0.5, h: 0, R: 1, centers: [], cell: 0.5 };
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  applyPartMods([{ shapeMod: mod }]); console.warn = warn;
  ok(warned === 1 && Math.abs(meshVolume(getMech3d().parts[0].positions, getMech3d().parts[0].triangles) - 800) < 1e-3 && getMech3d().raw === raw, `비 2.5D → 형상 변경 건너뜀 · 경고 ${warned}번`);
  clearMech3d(); }
done();
