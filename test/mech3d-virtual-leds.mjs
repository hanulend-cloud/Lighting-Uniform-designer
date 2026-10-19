// LED STEP 가상 배치: node test/mech3d-virtual-leds.mjs
import { virtualLayout, virtualEmittersAt, rotateAbout, stepLayoutOf } from '../src/engine/mech3d/virtual-leds.js';
import { ledSPositions } from '../src/engine/mech3d/placement.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { topFaceMesh, rectTris, annulusTris, boxMesh, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }];
const strip = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 12)], faces, [0, 0, 1]);
// LED STEP 부품: 0 = PCB(큰 판), 1·2 = LED 몸체(2×2×1.5), 3 = 기타(나사)
const pcb = boxMesh(-5, -5, 0, 110, 16, 1), led = (x) => boxMesh(x - 1, 2, 1, 2, 2, 1.5), screw = boxMesh(-4, -4, 1, 1, 1, 3);
const parts = [pcb, led(20), led(60), screw];
const step = { leds: [1, 2], pcb: 0, excluded: [], emitters: [{ part: 1, pos: [20, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }, { part: 2, pos: [60, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }] };
{ const v = virtualLayout({ parts, step, line: strip, count: 5, pitch: 0 }), s = ledSPositions(strip, 5, 0);
  ok(v.parts.length === 2 + 5 && v.pcb === 0 && v.leds.join() === '2,3,4,5,6' && v.parts[1] === screw, '부품: PCB·기타 유지, 원래 LED 몸체 빼고 복사 5개 뒤에');
  ok(v.emitters.length === 5 && v.emitters.every((e, k) => Math.abs(e.pos[0] - strip.fromSW(s[k], 0)[0]) < 1e-6 && Math.abs(e.pos[1] - 3) < 1e-6 && Math.abs(e.pos[2] - 2.5) < 1e-6 && e.part === v.leds[k]), '발광점: s 위치(이 직선 라인은 s 가 -x 방향), w·h 는 기준 LED 값');
  const b0 = bounds(led(20).positions), bk = bounds(v.parts[v.leds[2]].positions);
  ok([0, 1, 2, 3, 4, 5].every((i) => Math.abs(bk[i] - b0[i] - (i % 3 === 0 ? strip.fromSW(s[2], 0)[0] - 20 : 0)) < 1e-5), '몸체 복사 = 기준 몸체를 s 차이만큼 이동(직선)'); }
{ const v = virtualLayout({ parts, step: { ...step, excluded: [1] }, line: strip, count: 2, pitch: 30 });
  ok(Math.abs(Math.abs(v.emitters[1].pos[0] - v.emitters[0].pos[0]) - 30) < 1e-6 && v.ref === 2, '제외된 LED 는 기준이 안 됨 → 다음 LED 가 기준, 피치 30'); }
{ // count 0 = LED 몸체 없음(PCB·기타만) · 발광점 위치 지정(자동설계 ② 후보)
  const z = virtualLayout({ parts, step, line: strip, count: 0 });
  ok(z.parts.length === 2 && z.leds.length === 0 && z.emitters.length === 0 && z.pcb === 0 && z.parts[1] === screw, 'count 0: LED 몸체 없이 PCB·기타만');
  const full = virtualLayout({ parts, step, line: strip, count: 3, pitch: 10 }), s3 = full.emitters.map((e) => e.s);
  const at = virtualEmittersAt({ parts, step, line: strip, positions: s3 });
  ok(at.length === 3 && at.every((e, k) => e.part === null && e.pos.every((c, j) => Math.abs(c - full.emitters[k].pos[j]) < 1e-9) && e.axis.every((c, j) => Math.abs(c - full.emitters[k].axis[j]) < 1e-9)), 'virtualEmittersAt: 같은 s 면 전체 배치의 발광점과 같음(몸체 없음)');
  const p1 = virtualLayout({ parts, step, line: strip, positions: [s3[1]] });
  ok(p1.leds.length === 1 && p1.parts.length === 3 && Math.abs(p1.emitters[0].pos[0] - full.emitters[1].pos[0]) < 1e-9, 'positions: 지정한 s 에만 복사'); }
{ const r = rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
  ok(Math.abs(r[0]) < 1e-12 && Math.abs(r[1] - 1) < 1e-12, 'rotateAbout: d 축 90°'); }
{ // 원 라인: 기준 LED 를 라인 위 다른 각으로 옮기면 xAxis 가 접선을 따라 돈다
  const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]);
  const em = { part: 1, pos: [40, 0, 2.5], axis: [0, 0, 1], xAxis: [0, 1, 0] }, P = [pcb, boxMesh(39, -1, 1, 2, 2, 1.5)];
  const v = virtualLayout({ parts: P, step: { leds: [1], pcb: 0, excluded: [], emitters: [em] }, line: ring, count: 4, pitch: 0 });
  ok(v.emitters.every((e) => Math.abs(Math.hypot(e.pos[0], e.pos[1]) - 40) < 0.2 && Math.abs(e.xAxis[0] * e.pos[0] + e.xAxis[1] * e.pos[1]) < 0.05 * 40), '원 라인: 반경 유지, xAxis ⟂ 반지름(접선)'); }
{ // stepLayoutOf: 원래/가상 하나로
  const o = stepLayoutOf({ parts, step: { ...step, excluded: [2], virtual: null }, line: strip });
  ok(o.parts === parts && o.virtual === null && o.leds.join() === '1,2' && o.excluded.join() === '2' && o.emitters.length === 1 && o.emitters[0].part === 1 && o.pcb === 0, '원래 배치: 부품 그대로 · 제외 뺀 발광점');
  const n = stepLayoutOf({ parts, step: { ...step, virtual: { count: 3, pitch: 0 } }, line: null });
  ok(n.virtual === null && n.parts === parts, '라인 없음 → 원래 배치');
  const v = stepLayoutOf({ parts, step: { ...step, excluded: [1], virtual: { count: 3, pitch: 10 } }, line: strip });
  ok(v.virtual?.count === 3 && v.parts.length === 5 && v.leds.join() === '2,3,4' && v.excluded.length === 0 && v.emitters.length === 3 && v.ref === 2 && v.pcb === 0, '가상 배치: 복사 3개 · 제외 없음');
  const e = stepLayoutOf({ parts, step: { ...step, emitters: [], virtual: { count: 3, pitch: 0 } }, line: strip });
  ok(e.virtual === null && e.err && e.emitters.length === 0, '기준 LED 없음 → 원래 배치 + 오류 문구'); }
done();
