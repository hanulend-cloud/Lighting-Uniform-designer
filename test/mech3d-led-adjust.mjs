// LED 개별 조정(spec m3-cad-ui §4a): node test/mech3d-led-adjust.mjs
import { layoutKeyOf, validAdjust, staleAdjust, adjustEmitters, adjustBodies, isAdjustWellFormed } from '../src/engine/mech3d/led-adjust.js';
import { manualLeds } from '../src/engine/mech3d/placement.js';
import { virtualLayout, stepLayoutOf } from '../src/engine/mech3d/virtual-leds.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { defaultLight, migrateMech3d } from '../src/engine/mech3d/defs.js';
import { currentEmitters, resetLedCaches } from '../src/ui/m3/leds.js';
import { topFaceMesh, rectTris, annulusTris, boxMesh, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }], near = (a, b, e = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < e);
const strip = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 12)], faces, [0, 0, 1]);
const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]);

{ // layoutKey: 개수·피치·열·가상 → 바뀜, 배광·광속·높이·제외 → 그대로
  const L = { ...defaultLight(), kind: 'manual' }, k0 = layoutKeyOf(L), cp = () => JSON.parse(JSON.stringify(L));
  const ch = (f) => { const x = cp(); f(x); return layoutKeyOf(x); };
  ok(ch((x) => { x.spec.beam = 60; x.spec.fluxLm = 5; x.manual.pcb.depth = 7; x.manual.side = 'left'; }) === k0, 'manual: 배광·광속·높이(depth)·측면 → 같은 key');
  ok(ch((x) => { x.manual.count = 11; }) !== k0 && ch((x) => { x.manual.pitch = 5; }) !== k0 && ch((x) => { x.manual.rows = 2; }) !== k0, 'manual: 개수·피치·열 → 다른 key');
  ok(ch((x) => { x.manual.rowGap = 3; }) === k0, '1열이면 열 간격은 무관');
  const S = { ...defaultLight(), kind: 'step', step: { name: 'a.stp', offset: [0, 0, 0], rot: [0, 0, 0], leds: [1, 2], excluded: [], pcb: 0, emitters: [], virtual: null } };
  const s0 = layoutKeyOf(S), cs = (f) => { const x = JSON.parse(JSON.stringify(S)); f(x); return layoutKeyOf(x); };
  ok(cs((x) => { x.step.excluded = [1]; x.step.offset = [0, 0, 2]; x.spec.beam = 90; }) === s0, 'step: 제외·offset(공통 높이)·배광 → 같은 key');
  ok(cs((x) => { x.step.virtual = { count: 3, pitch: 0, rows: 1, rowGap: 0 }; }) !== s0 && cs((x) => { x.step.name = 'b.stp'; }) !== s0 && cs((x) => { x.step.leds = [1, 2, 3]; }) !== s0, 'step: 가상·다른 파일·LED 인식 → 다른 key');
  ok(ch((x) => { x.kind = 'step'; }) !== k0, '종류 바뀜 → 다른 key');
  // validAdjust / staleAdjust
  const A = cp(); A.ledAdjust = { layoutKey: k0, items: { 2: { ds: 1, dz: 0 } } };
  ok(validAdjust(A)?.[2]?.ds === 1 && !staleAdjust(A), 'validAdjust: key 같으면 items');
  A.manual.count = 4;
  ok(validAdjust(A) === null && staleAdjust(A), 'key 다르면 null · stale');
  ok(validAdjust(L) === null && !staleAdjust(L), '조정 없음 → null, stale 아님');
}
{ // adjustEmitters 직선: ds 는 접선, dz 는 d
  const em = manualLeds(strip, { count: 3, pitch: 20, pcb: { kind: 'depth', depth: 4 } }), d = strip.frame.d;
  const [tx, ty] = strip.tangentAt(em[1].s), F = strip.frame, T = [0, 1, 2].map((k) => tx * F.u[k] + ty * F.v[k]);
  const out = adjustEmitters(em, { 1: { ds: 2, dz: 0.5 } }, strip, d);
  ok(out !== em && out[0] === em[0] && out[2] === em[2] && em[1].pos[2] === 8, '조정 안 한 LED·원본은 그대로(새 배열)');
  ok(near(out[1].pos, em[1].pos.map((v, k) => v + 2 * T[k] + 0.5 * d[k])), `ds 2 → 접선, dz 0.5 → d (${out[1].pos.map((v) => v.toFixed(3))})`);
  ok(Math.abs(out[1].s - (em[1].s + 2)) < 1e-9 && near(out[1].axis, em[1].axis), 's 갱신, 축 유지');
  const noS = adjustEmitters([{ part: 5, led: 0, pos: em[1].pos, axis: [0, 0, 1] }], { 0: { ds: -3, dz: 0 } }, strip, d);
  ok(near(noS[0].pos, em[1].pos.map((v, k) => v - 3 * T[k])) && noS[0].s === undefined, 's 없는 발광점(STEP 원래) → 위치에서 s 계산, e.led 번호 사용');
}
{ // adjustEmitters 원: 그 LED 위치의 접선 방향
  const em = manualLeds(ring, { count: 4, pcb: { kind: 'depth', depth: 4 } }), d = ring.frame.d;
  const out = adjustEmitters(em, { 1: { ds: 1, dz: 0 } }, ring, d), dv = out[1].pos.map((v, k) => v - em[1].pos[k]), p = em[1].pos;
  ok(Math.abs(Math.hypot(...dv) - 1) < 1e-6 && Math.abs(dv[0] * p[0] + dv[1] * p[1]) < 1e-3 * 40 && Math.abs(dv[2]) < 1e-9, `원: 이동 ⟂ 반지름(접선), 크기 1 (${dv.map((v) => v.toFixed(3))})`);
}
{ // adjustBodies: 선택한 LED 몸체만 이동, PCB·다른 LED 그대로
  const pcb = boxMesh(-5, -5, 0, 110, 16, 1), led = (x) => boxMesh(x - 1, 2, 1, 2, 2, 1.5), parts = [pcb, led(20), led(60)];
  const em = [{ part: 1, led: 0, pos: [20, 3, 2.5], axis: [0, 0, 1] }, { part: 2, led: 1, pos: [60, 3, 2.5], axis: [0, 0, 1] }];
  const out = adjustBodies(parts, [1, 2], { 1: { ds: 2, dz: 0.5 } }, strip, strip.frame.d, em);
  const T = adjustEmitters(em, { 1: { ds: 2, dz: 0.5 } }, strip, strip.frame.d)[1].pos.map((v, k) => v - em[1].pos[k]);
  const b0 = bounds(parts[2].positions), b1 = bounds(out[2].positions);
  ok(out[0] === pcb && out[1] === parts[1] && out[2] !== parts[2], 'PCB·조정 안 한 LED = 같은 객체');
  ok([0, 1, 2, 3, 4, 5].every((i) => Math.abs(b1[i] - b0[i] - T[i % 3]) < 1e-5), '몸체 이동 = 발광점 이동 벡터');
  // stepLayoutOf(원래) + adjust: 발광점·몸체 같이, led 번호 = step.leds 위치
  const step = { leds: [1, 2], pcb: 0, excluded: [], emitters: [{ part: 1, pos: [20, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }, { part: 2, pos: [60, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }] };
  const lay = stepLayoutOf({ parts, step, line: strip, adjust: { 1: { ds: 2, dz: 0.5 } } });
  ok(lay.adjusted && lay.emitters.map((e) => e.led).join() === '0,1' && near(lay.emitters[1].pos, [60 + T[0], 3 + T[1], 2.5 + T[2]]) && bounds(lay.parts[2].positions)[2] - b0[2] > 0.49, 'stepLayoutOf 원래: 발광점·몸체 평행 이동');
  const lx = stepLayoutOf({ parts, step: { ...step, excluded: [1] }, line: strip, adjust: { 1: { ds: 2, dz: 0 } } });
  ok(lx.emitters.length === 1 && lx.emitters[0].led === 1 && Math.abs(lx.emitters[0].pos[0] - 60 - T[0]) < 1e-6, '제외해도 번호 유지(LED 2 = 번호 1)');
  ok(!stepLayoutOf({ parts, step, line: strip }).adjusted, '조정 없으면 adjusted 아님');
  // 가상: s → s+ds 로 다시 놓고 높이 dz (몸체 포함)
  const v0 = virtualLayout({ parts, step, line: strip, count: 3, pitch: 10 }), v1 = virtualLayout({ parts, step, line: strip, count: 3, pitch: 10, adjust: { 2: { ds: 1.5, dz: 0.3 } } });
  const sh = v1.emitters[2].pos.map((v, k) => v - v0.emitters[2].pos[k]), vb0 = bounds(v0.parts[v0.leds[2]].positions), vb1 = bounds(v1.parts[v1.leds[2]].positions);
  ok(Math.abs(v1.emitters[2].s - v0.emitters[2].s - 1.5) < 1e-9 && Math.abs(sh[2] - 0.3) < 1e-6 && Math.abs(Math.hypot(sh[0], sh[1]) - 1.5) < 1e-6 && near(v1.emitters[0].pos, v0.emitters[0].pos), '가상: s+ds·h+dz, 다른 LED 그대로');
  ok([0, 1, 2, 3, 4, 5].every((i) => Math.abs(vb1[i] - vb0[i] - sh[i % 3]) < 1e-5) && v1.emitters.every((e, k) => e.led === k), '가상: 몸체 같이 이동 · led 번호 = 순서');
}
{ // currentEmitters(직접 배치) + ledAdjust, 오래된 key 무시
  resetLedCaches();
  const L = { ...defaultLight(), kind: 'manual', manual: { pcb: { kind: 'depth', depth: 4 }, count: 3, pitch: 20, side: 'direct', rows: 1, rowGap: 0 } };
  const M = { light: L }, e0 = currentEmitters(M, strip).map((e) => e.pos.slice());
  L.ledAdjust = { layoutKey: layoutKeyOf(L), items: { 0: { ds: 1, dz: 0.5 } } };
  const e1 = currentEmitters(M, strip), [tx, ty] = strip.tangentAt(30);
  ok(Math.abs(e1[0].pos[2] - e0[0][2] - 0.5) < 1e-9 && Math.abs(Math.hypot(e1[0].pos[0] - e0[0][0], e1[0].pos[1] - e0[0][1]) - 1) < 1e-9 && near(e1[1].pos, e0[1]), `직접 배치: LED 0 만 Δs 1·Δz 0.5 (캐시 key 에 조정 포함, tangent ${tx.toFixed(1)},${ty.toFixed(1)})`);
  L.manual.count = 4;
  const e2 = currentEmitters(M, strip), e2b = manualLeds(strip, L.manual);
  ok(e2.length === 4 && e2.every((e, k) => near(e.pos, e2b[k].pos)), '개수 바뀜 → 오래된 조정 무시');
}
{ // migrate: 올바른 ledAdjust 유지, 잘못된 것 삭제
  const mk = (a) => migrateMech3d({ light: { ...defaultLight(), ledAdjust: a }, parts: [] }).light.ledAdjust;
  ok(mk({ layoutKey: 'k', items: { 0: { ds: 1, dz: -0.5 }, 12: { ds: 0, dz: 2 } } })?.items?.[12]?.dz === 2, '올바른 조정 유지');
  ok(mk({ layoutKey: 'k', items: { 0: { ds: NaN, dz: 0 } } }) === undefined && mk({ layoutKey: 'k', items: { a: { ds: 1, dz: 0 } } }) === undefined
    && mk({ layoutKey: 3, items: {} }) === undefined && mk({ layoutKey: 'k', items: { '-1': { ds: 1, dz: 0 } } }) === undefined && mk('x') === undefined, '잘못된 조정(비유한·정수 아닌 키·key 문자열 아님) 삭제');
  ok(isAdjustWellFormed({ layoutKey: 'k', items: { 1.5: { ds: 1, dz: 0 } } }) === false, '소수 키 거부');
}
done();
