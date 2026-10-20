// LED STEP 배치 편집(STEP 기준 추가·삭제·같은 간격·이동): node test/mech3d-led-edit.mjs
import { positionsFromLayout, addPosition, removePosition, alignPositions, isPositionsLayout } from '../src/engine/mech3d/led-edit.js';
import { stepLayoutOf } from '../src/engine/mech3d/virtual-leds.js';
import { layoutKeyOf } from '../src/engine/mech3d/led-adjust.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { topFaceMesh, rectTris, annulusTris, boxMesh, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }];
const strip = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 12)], faces, [0, 0, 1]);
const pcb = boxMesh(-5, -5, 0, 110, 16, 1), led = (x) => boxMesh(x - 1, 2, 1, 2, 2, 1.5);
const parts = [pcb, led(20), led(50), led(60)];
const emi = (p, x) => ({ part: p, pos: [x, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] });
const step = { leds: [1, 2, 3], pcb: 0, excluded: [], emitters: [emi(1, 20), emi(2, 50), emi(3, 60)] };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

{ // 원래 STEP 배치 → 위치 목록(s 오름차순, 기준 LED 대비 w·높이 0) — 그 목록으로 다시 놓으면 같은 발광점
  const lay = stepLayoutOf({ parts, step, line: strip }), P = positionsFromLayout(lay, step, strip);
  ok(P.length === 3 && P.every((q, i) => i === 0 || q.s > P[i - 1].s) && P.every((q) => near(q.w, 0) && near(q.dz, 0)), '원래 배치 → 위치 3개(s 순서, w·dz 0)');
  const v = stepLayoutOf({ parts, step: { ...step, virtual: { positions: P } }, line: strip });
  const xs = (l) => l.emitters.map((e) => e.pos[0]).sort((a, b) => a - b);
  ok(v.virtual && v.emitters.length === 3 && xs(v).every((x, i) => near(x, xs(lay)[i], 1e-6)) && v.emitters.every((e) => near(e.pos[2], 2.5)), '위치 목록 배치 = 원래 발광점 위치 그대로');
  ok(v.leds.length === 3 && v.parts.length === 1 + 3, '몸체: 원래 LED 빼고 기준 몸체 복사 3개');
  const o = positionsFromLayout(v, step, strip, 1);
  ok(o.length === 2 && !o.some((q) => near(q.s, P[1].s)), 'omit: 번호 1 LED 뺀 목록(삭제)'); }
{ // 제외 LED 는 목록에서 빠짐, 개별 조정(ds·dz)은 목록에 녹아듦
  const lay = stepLayoutOf({ parts, step: { ...step, excluded: [2] }, line: strip, adjust: { 2: { ds: 0, dz: 0.7 } } });
  const P = positionsFromLayout(lay, { ...step, excluded: [2] }, strip);
  ok(P.length === 2 && P.some((q) => near(q.dz, 0.7)), '제외 빠짐 · 높이 조정 dz 0.7 유지'); }
{ // 추가: 가장 넓은 틈 가운데(안쪽 틈 30 vs 끝 여백) — 열린 라인 0~100, LED 20·50·60(라인 s 기준)
  const P = [{ s: 20, w: 0, dz: 0 }, { s: 50, w: 0, dz: 0.2 }, { s: 60, w: 0, dz: 0 }];
  const r = addPosition(P, strip);
  ok(r.positions.length === 4 && near(r.positions[r.index].s, 80) && r.positions.every((q, i) => i === 0 || q.s >= r.positions[i - 1].s), '추가: 끝 여백 40(60→100) > 안쪽 틈 30 → 여백 가운데 80');
  const r2 = addPosition([{ s: 10, w: 0, dz: 0 }, { s: 50, w: 0, dz: 0.4 }, { s: 90, w: 0, dz: 0 }], strip);
  ok(near(r2.positions[r2.index].s, 30) && near(r2.positions[r2.index].dz, 0.2), '추가: 안쪽 틈 40 가운데 30 · 높이 = 양옆 평균');
  const r3 = addPosition([{ s: 50, w: 0, dz: 0 }], strip);
  ok(r3.positions.length === 2 && (near(r3.positions[r3.index].s, 25) || near(r3.positions[r3.index].s, 75)),'추가: 1개면 넓은 쪽 여백 가운데');
  const two = [{ s: 30, w: -1, dz: 0 }, { s: 30, w: 1, dz: 0 }, { s: 70, w: -1, dz: 0 }, { s: 70, w: 1, dz: 0 }];
  const r4 = addPosition(two, strip);
  ok(r4.positions.length === 6 && r4.positions.filter((q) => near(q.s, r4.positions[r4.index].s)).map((q) => q.w).sort().join() === '-1,1', '2열: 한 자리에 열마다 하나씩(같은 w)'); }
{ // 닫힌 라인: 이음매를 넘는 틈도 후보
  const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]), L = ring.length;
  const r = addPosition([{ s: 0.1 * L, w: 0, dz: 0 }, { s: 0.3 * L, w: 0, dz: 0 }], ring);
  ok(near(r.positions[r.index].s, 0.7 * L, 1e-6), '닫힌 라인: 0.3L→1.1L 틈(0.8L) 가운데 0.7L'); }
{ // 삭제 · 같은 간격(양 끝 LED 고정, 사이 균등)
  const P = [{ s: 20, w: 0, dz: 0 }, { s: 50, w: 0, dz: 0.3 }, { s: 60, w: 0, dz: 0 }];
  const d = removePosition(P, 1);
  ok(d.length === 2 && near(d[0].s, 20) && near(d[1].s, 60) && P.length === 3, '삭제: 그 번호만 빠짐(원본 그대로)');
  const a = alignPositions(P, strip);
  ok(a.map((q) => q.s).every((s, i) => near(s, [20, 40, 60][i])) && near(a[1].dz, 0.3), '같은 간격: 20·40·60, 높이 유지');
  const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]), L = ring.length;
  const ar = alignPositions([{ s: 0.1 * L, w: 0, dz: 0 }, { s: 0.2 * L, w: 0, dz: 0 }, { s: 0.7 * L, w: 0, dz: 0 }, { s: 0.8 * L, w: 0, dz: 0 }], ring);
  ok(ar.every((q, i) => near(q.s, ((0.1 + i * 0.25) % 1) * L, 1e-6)), '닫힌 라인 같은 간격: 첫 LED 부터 L/n'); }
{ // 배치 키 = 위치 목록 포함(개별 조정 번호가 목록 바뀌면 무효) · 형식 판별
  const k1 = layoutKeyOf({ kind: 'step', step: { ...step, virtual: { positions: [{ s: 1, w: 0, dz: 0 }] } } });
  const k2 = layoutKeyOf({ kind: 'step', step: { ...step, virtual: { positions: [{ s: 1, w: 0, dz: 0 }, { s: 5, w: 0, dz: 0 }] } } });
  ok(k1 !== k2, '배치 키: 위치 목록이 바뀌면 달라짐');
  ok(isPositionsLayout({ positions: [] }) && !isPositionsLayout({ count: 3, pitch: 0 }) && !isPositionsLayout(null), 'isPositionsLayout'); }
done();
