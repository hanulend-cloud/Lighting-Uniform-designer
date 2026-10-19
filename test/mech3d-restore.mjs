// 저장된 3D 설정 복원 판정: node test/mech3d-restore.mjs
import { matchesPending, restorePending } from '../src/engine/mech3d/restore.js';
import { defaultLight, defaultObserve, defaultChecks } from '../src/engine/mech3d/defs.js';
import { defaultPart, setPartMaterial } from '../src/engine/mech3d/materials.js';
import { validateLedStep } from '../src/ui/m3/leds.js';
import { ok, done } from './mech3d-util.mjs';

const fresh = () => ({
  name: 'a.stp',
  parts: [{ ...defaultPart(0, '부품 1', 100), size: [10, 10, 1] }, { ...defaultPart(1, '부품 2', 50), size: [5, 5, 2] }],
  contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 4, mode: 'contact' }, { a: 0, faceA: 2, b: 1, faceB: 3, area: 2, mode: 'contact' }],
  light: defaultLight(), observe: defaultObserve(), checks: defaultChecks(),
});
const pending = {
  name: 'a.stp',
  parts: [{ ...setPartMaterial(defaultPart(0, '커버', 100), 'milky'), size: [10, 10, 1], faceFinish: { 3: { kind: 'gloss' } }, xform: { scale: [1, 1, 1.2], move: [0, 0, 0.5] }, shapeMod: { R: 2 } },
    { ...defaultPart(1, '하우징', 50), size: [5, 5, 2] }],
  contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 4, mode: 'gap' }, { a: 0, faceA: 9, b: 1, faceB: 9, area: 1, mode: 'glued' }],
  light: { ...defaultLight(), kind: 'step', step: { name: 'led.stp', offset: [1, 2, 3], rot: [0, 0, 90], ref: { part: 2, face: 5 }, leds: [1, 2], excluded: [], pcb: 0, emitters: [], virtual: { count: 4, pitch: 3 } } },
  observe: { ...defaultObserve(), faces: [{ part: 0, face: 1 }], targetLum: 300 },
  checks: { ...defaultChecks(), minWall: 1.2 },
  autoDesign: { best: 7 },
};

{ const f = fresh();
  ok(matchesPending(pending, f.parts), '같은 부품 → 일치');
  const r = restorePending(pending, f);
  ok(r && r.parts[0].material.kind === 'milky' && r.parts[0].name === '커버', '소재·이름 복원');
  ok(r.parts[0].faceFinish[3]?.kind === 'gloss' && r.parts[0].xform.scale[2] === 1.2 && r.parts[0].shapeMod.R === 2, 'faceFinish·xform·shapeMod 복원');
  ok(r.contacts.length === 2 && r.contacts[0].mode === 'gap' && r.contacts[1].mode === 'contact', '접촉면: 같은 면 키는 mode 유지, 새 면은 기본');
  ok(r.light.kind === 'step' && r.light.step.ref.part === 2 && r.light.step.virtual.count === 4 && r.light.step.offset[2] === 3, 'LED STEP 설정 복원');
  ok(r.observe.faces.length === 1 && r.observe.targetLum === 300 && r.checks.minWall === 1.2 && r.autoDesign.best === 7, '관측·목표·점검·기타 복원');
  r.parts[0].xform.scale[2] = 9; ok(pending.parts[0].xform.scale[2] === 1.2, '원본(pending) 불변');
}
{ const f = fresh(); f.parts.pop();
  ok(!matchesPending(pending, f.parts) && restorePending(pending, f) === null, '부품 수 다름 → null'); }
{ const f = fresh(); f.parts[1].volume = 52;
  ok(restorePending(pending, f) === null, '부피 4% 차이 → null'); }
{ const f = fresh(); f.parts[1].volume = 50.3;
  ok(restorePending(pending, f) !== null, '부피 0.6% 차이 → 일치'); }
{ const f = fresh(); f.parts[0].size = [10, 12, 1];
  ok(restorePending(pending, f) === null, '크기 다름 → null'); }
ok(!matchesPending(null, []) && !matchesPending({ parts: [] }, []), '빈 입력 → 불일치');
// LED STEP 메쉬가 없을 때(저장소 비워짐): 기준 LED·제외·가상 배치·위치 보정은 남기고 인식 결과만 비움
{ const M = structuredClone(pending), S = {};
  M.light.step.excluded = [2]; M.light.step.emitters = [{ part: 1 }];
  const r = validateLedStep(M, S), st = M.light.step;
  ok(r.changed && S.ledInfo.includes('찾을 수 없음'), `메쉬 없음 안내: ${S.ledInfo}`);
  ok(st.ref?.part === 2 && st.virtual?.count === 4 && st.excluded[0] === 2 && st.offset[0] === 1, 'ref·virtual·excluded·offset 유지');
  ok(st.leds.length === 0 && st.emitters.length === 0 && st.pcb === -1, '인식 결과(leds·emitters·pcb)는 비움');
}
done();
