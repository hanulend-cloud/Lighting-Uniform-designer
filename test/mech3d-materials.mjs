// 3D 기구 소재·면 처리 카탈로그: node test/mech3d-materials.mjs
import { PART_KINDS, FINISH_KINDS, defaultPart, setPartMaterial, setPartFinish, resolveFinish, partIndex, validatePart } from '../src/engine/mech3d/materials.js';
import { ok, done } from './mech3d-util.mjs';

const p0 = defaultPart(0, '부품 1', 100);
ok(p0.material.kind === 'opaque' && p0.finish.kind === 'whiteDiffuse' && p0.finish.R === 0.85, '기본 부품 = 불투명 + 백색 확산 반사 85%');
ok(Object.keys(PART_KINDS).join() === 'milky,clear,whiteTrans,opaque', '부품 소재 4종');
ok(Object.keys(FINISH_KINDS).join() === 'gloss,whiteDiffuse,metal,black', '면 처리 4종(1단계)');

const m = setPartMaterial(p0, 'milky');
ok(m.material.kind === 'milky' && m.material.milky === 5 && m.material.dbId === '' && m.finish.kind === 'gloss', 'Milky 선택 → 면 처리 기본 광택');
ok(p0.material.kind === 'opaque', '원본 불변(새 객체 반환)');
ok(partIndex(m.material) === 1.586 && partIndex(setPartMaterial(p0, 'clear').material) === 1.586 && partIndex(p0.material) === null, '굴절률: PC 1.586, 불투명 null');

const f = setPartFinish(m, 3, { kind: 'black', R: 0.05 });
ok(resolveFinish(f, 3).kind === 'black' && resolveFinish(f, 2).kind === 'gloss', '면 3 만 흑색, 나머지는 부품 기본');
ok(resolveFinish(setPartFinish(f, 3, null), 3).kind === 'gloss', '면 덮어쓰기 해제(null)');
ok(setPartFinish(f, null, { kind: 'metal', R: 0.88 }).finish.kind === 'metal', '부품 기본 면 처리 변경');
ok(setPartMaterial(f, 'opaque').faceFinish && Object.keys(setPartMaterial(f, 'opaque').faceFinish).length === 0, '소재 바꾸면 면 덮어쓰기 초기화');

ok(validatePart(m).length === 0, '정상 부품 오류 없음');
ok(validatePart({ ...m, material: { ...m.material, milky: 11 } }).length === 1, 'Milky 11 → 오류');
ok(validatePart(setPartFinish(m, 0, { kind: 'black', R: 1.5 })).length === 1, '반사율 150% → 오류');
ok(validatePart({ ...setPartMaterial(p0, 'clear'), material: { kind: 'clear', resin: 'PC', T: 0, tRef: 2 } }).length === 1, '투과율 0 → 오류');
{
  const fin = { kind: 'black', R: 0.05 }, q = setPartFinish(m, null, fin);
  fin.R = 0.9;
  ok(q.finish.R === 0.05 && setPartFinish(m, 2, fin).faceFinish[2] !== fin, '면 처리는 복사 저장(원본 객체 변경 영향 없음)');
  let r; try { r = validatePart({ id: 1, name: 'x', finish: m.finish }); } catch { r = null; }
  ok(r && r.length >= 1, '소재 없는 부품 → 던지지 않고 오류 메시지');
}
done();
