// LED 직접 배치: node test/mech3d-place.mjs
import { manualLeds, ledAtS, pcbPlaneMesh } from '../src/engine/mech3d/placement.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { buildBvh } from '../src/engine/mech3d/bvh.js';
import { topFaceMesh, rectTris, annulusTris, boxMesh, ok, done } from './mech3d-util.mjs';

const line100Pitch = (l, n) => l.length / n;
const faces = [{ part: 0, face: 1 }];
const strip = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 12)], faces, [0, 0, 1]);
{
  const L = manualLeds(strip, { count: 5, pitch: 20, side: 'direct', pcb: { kind: 'depth', depth: 10 } });
  const xs = L.map((e) => e.pos[0]).sort((a, b) => a - b);
  ok(L.length === 5 && xs.every((x, i) => Math.abs(x - (10 + 20 * i)) < 0.05) && xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - 20) < 1e-9) && L.every((e) => Math.abs(e.pos[1] - 3) < 1e-9 && Math.abs(e.pos[2] - 2) < 1e-9 && e.axis[2] === 1),
    `직선 5개 피치 20, 깊이 10 → z 2: x ${xs.map((x) => x.toFixed(1)).join(',')}`);
  const auto = manualLeds(strip, { count: 4, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } }).map((e) => e.pos[0]).sort((a, b) => a - b);
  ok(auto.every((x, i) => Math.abs(x - (12.5 + 25 * i)) < 0.05) && auto.every((x, i) => i === 0 || Math.abs(x - auto[i - 1] - line100Pitch(strip, 4)) < 1e-9), `피치 0 → 균등(길이/개수): ${auto.join()}`);
  const side = manualLeds(strip, { count: 1, pitch: 0, side: 'left', pcb: { kind: 'depth', depth: 10 } })[0];
  ok(Math.abs(Math.abs(side.axis[1]) - 1) < 1e-9 && Math.abs(side.axis[2]) < 1e-9, `측면 발광 축 ⟂ 라인·관측방향: ${side.axis.map((v) => v.toFixed(3))}`);
  let threw = false; try { manualLeds(strip, { count: 6, pitch: 30, side: 'direct', pcb: { kind: 'depth', depth: 10 } }); } catch { threw = true; }
  ok(threw, '배치 길이(5×30) > 라인 길이 → 오류');
  const pm = pcbPlaneMesh(strip, 10);
  ok(Math.abs(meshVolume(pm.positions, pm.triangles) - 120 * 26 * 1) < 1e-3 && Math.abs(Math.max(...pm.positions.filter((_, i) => i % 3 === 2)) - 2) < 1e-6, 'PCB 평면: 라인 외곽 +10mm, 두께 1, 윗면 = LED 높이');
}
{
  const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]);
  const L = manualLeds(ring, { count: 12, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } });
  const r = L.map((e) => Math.hypot(e.pos[0], e.pos[1])), gaps = L.map((e, i) => { const f = L[(i + 1) % 12]; return Math.hypot(f.pos[0] - e.pos[0], f.pos[1] - e.pos[1]); });
  ok(r.every((v) => Math.abs(v - 40) < 0.05) && Math.max(...gaps) - Math.min(...gaps) < 1e-6, `원 12개 균등: 반경 ${r[0].toFixed(3)}, 간격 ${gaps[0].toFixed(3)}`);
}
{   // PCB = 기구 부품 면(클릭): z=3 윗면 상자에 LED 를 내림
  const board = boxMesh(-10, -10, 0, 120, 30, 3), bvh = buildBvh(board.positions, board.triangles);
  const L = manualLeds(strip, { count: 3, pitch: 30, side: 'direct', pcb: { kind: 'face', part: 0, face: 1 } }, { parts: [{ ...board, bvh }] });
  ok(L.every((e) => Math.abs(e.pos[2] - 3) < 1e-6), `PCB 면 위 배치: z ${L.map((e) => e.pos[2].toFixed(3)).join()}`);
}
{   // 검증: 정수 개수·양의 깊이, 기울어진 PCB 면은 법선 방향으로 발광
  const thr = (o) => { try { manualLeds(strip, o); return false; } catch { return true; } };
  ok(thr({ count: 2.5, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } }) && thr({ count: 0, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } }), '개수가 정수 아니거나 0 → 오류');
  ok(thr({ count: 2, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 0 } }) && thr({ count: 2, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: -3 } }), '깊이 ≤ 0 → 오류');
  const a = (10 * Math.PI) / 180, zt = (x) => 3 + Math.tan(a) * (x - 50);   // y 축 둘레 10° 기울어진 판(윗면 face 1)
  const positions = Float32Array.from([-10, -10, zt(-10), 110, -10, zt(110), 110, 20, zt(110), -10, 20, zt(-10)]);
  const tilt = { positions, triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]), faceIds: Uint32Array.from([1, 1]), faceCount: 2 };
  const L = manualLeds(strip, { count: 2, pitch: 30, side: 'direct', pcb: { kind: 'face', part: 0, face: 1 } }, { parts: [{ ...tilt, bvh: buildBvh(tilt.positions, tilt.triangles) }] });
  const ang = L.map((e) => (Math.acos(Math.min(1, e.axis[2])) * 180) / Math.PI);
  ok(ang.every((v) => Math.abs(v - 10) < 1e-3) && L.every((e) => Math.abs(Math.hypot(...e.axis) - 1) < 1e-9 && e.axis[2] > 0), `기울어진 PCB 면(10°) → 발광 축 = 면 법선: ${ang.map((v) => v.toFixed(3))}°`);
}
{ const em = manualLeds(strip, { count: 3, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 4 } });
  const one = ledAtS(strip, em[1].s, { side: 'direct', pcb: { kind: 'depth', depth: 4 } });
  ok(JSON.stringify(one) === JSON.stringify(em[1]), 'ledAtS(s) = manualLeds 의 같은 s 결과'); }
{ // 폭 방향 2열(±δ): 같은 s 에 −δ, +δ · s 오름차순 · δ ≤ 반폭 − 0.5
  const pc = { kind: 'depth', depth: 4 }, near = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
  const L = manualLeds(strip, { count: 3, pitch: 20, side: 'direct', pcb: pc, rows: 2, rowGap: 2 }), s = [30, 50, 70];
  ok(L.length === 6 && L.every((e, k) => Math.abs(e.s - s[k >> 1]) < 1e-9 && near(e.pos, strip.fromSW(s[k >> 1], k & 1 ? 2 : -2)) && Math.abs(e.pos[2] - 8) < 1e-9),
    `2열 3개: 위치·순서 (y ${L.map((e) => e.pos[1].toFixed(2)).join()})`);
  const C = manualLeds(strip, { count: 1, pitch: 0, side: 'direct', pcb: pc, rows: 2, rowGap: 10 }), hw = strip.width / 2 - 0.5;
  ok(near(C[0].pos, strip.fromSW(C[0].s, -hw)) && near(C[1].pos, strip.fromSW(C[1].s, hw)), `열 간격 제한: ±${hw.toFixed(2)} (반폭 ${(strip.width / 2).toFixed(2)})`);
  const one = manualLeds(strip, { count: 3, pitch: 20, side: 'direct', pcb: pc, rows: 1, rowGap: 2 }), base = manualLeds(strip, { count: 3, pitch: 20, side: 'direct', pcb: pc });
  ok(JSON.stringify(one) === JSON.stringify(base), '1열이면 열 간격 무시 = 기존 결과');
  const w = ledAtS(strip, 40, { side: 'direct', pcb: pc }, null, 1.5);
  ok(near(w.pos, strip.fromSW(40, 1.5)), 'ledAtS w 오프셋 = fromSW(s, w)'); }
done();
