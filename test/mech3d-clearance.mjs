// 부품 간격·간섭·제한: node test/mech3d-clearance.mjs
import { closestOnTri, meshGap, meshPenetration, partClearance, interferenceKeys, limitXform, axisLimits, travelDistance } from '../src/engine/mech3d/clearance.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
{ const q = closestOnTri([0.2, 0.2, 5], [0, 0, 0], [1, 0, 0], [0, 1, 0]), r = closestOnTri([2, 2, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
  ok(near(q[0], 0.2) && near(q[1], 0.2) && near(q[2], 0) && near(r[0], 0.5) && near(r[1], 0.5), '삼각형 최근접점: 내부 투영·모서리'); }
const A = boxMesh(0, 0, 0, 10, 10, 2);
{ const B = boxMesh(0, 0, 3.5, 10, 10, 2), g = meshGap(A, B);
  ok(g && near(g.gap, 1.5, 1e-5) && near(g.pa[2], 2, 1e-5) && near(g.pb[2], 3.5, 1e-5), `평행 면 간격 1.5: ${g?.gap}`);
  ok(meshGap(A, boxMesh(0, 0, 40, 10, 10, 2), 20) === null, '멀면(> 20mm) 없음');
  const C = boxMesh(12, 3, 0.5, 4, 4, 1);   // 옆으로 2mm
  ok(near(meshGap(A, C).gap, 2, 1e-5), '옆면 간격 2'); }
{ ok(meshPenetration(A, boxMesh(0, 0, 2, 10, 10, 2)) === null, '맞붙은 면(접촉)은 간섭 아님');
  const p = meshPenetration(A, boxMesh(2, 2, 1.5, 4, 4, 2));
  ok(p && p.depth > 0.4 && p.depth < 0.6, `0.5mm 파고듦: ${p?.depth}`);
  ok(meshPenetration(A, boxMesh(2, 2, 0.5, 2, 2, 1)) !== null, '완전히 안에 든 작은 상자 = 간섭');
  ok(meshPenetration(A, boxMesh(0, 0, 0, 10, 10, 2)) !== null, '같은 자리에 완전히 겹친 상자 = 간섭');
  const flip = (m) => { const T = Uint32Array.from(m.triangles); for (let t = 0; t < T.length; t += 6) { const x = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = x; } return { ...m, triangles: T }; };   // 감은 방향 일부 뒤집힘(STEP 메쉬)
  ok(meshPenetration(flip(A), flip(boxMesh(0, 0, 2, 10, 10, 2))) === null && meshPenetration(flip(A), flip(boxMesh(0, 0, 0, 10, 10, 2))) !== null, '감은 방향 뒤집힌 메쉬: 접촉 = 간섭 아님, 겹침 = 간섭');
  ok(meshPenetration(A, boxMesh(10, 0, 0, 10, 10, 2)) === null && meshPenetration(A, boxMesh(0, 0, -2, 10, 10, 2)) === null, '옆면·아랫면 접촉은 간섭 아님'); }
{ const parts = [A, boxMesh(0, 0, 3, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, 1)];   // 1 = 위 1mm 띄움 … 2 = 바로 위 접촉 + 1과 0mm
  const c = partClearance(parts, 0, { emitters: [{ pos: [5, 5, -3], axis: [0, 0, 1] }] });
  ok(c.parts[0].part === 2 && near(c.parts[0].gap, 0, 1e-6) && c.parts[0].depth === 0 && near(c.parts[1].gap, 1, 1e-5), '간격 표: 접촉 0 → 1mm 순');
  ok(near(c.ledMin.dist, 3, 1e-5) && near(c.ledAxial.dist, 3, 1e-5), `LED 거리 3mm (최근접·축): ${c.ledMin?.dist} ${c.ledAxial?.dist}`); }
{ const em = [{ pos: [5, 5, 1], axis: [0, 0, 1] }];
  ok(interferenceKeys(A, [], [], em).has('e:0') && !interferenceKeys(boxMesh(0, 0, 3, 10, 10, 2), [], [], em).size, '발광점이 부품 안 = 간섭'); }
{ // 커버(위, 1mm 띄움)를 아래로 3mm 옮기려 함 → 하우징에 닿기 직전(−1mm)까지만
  const cover = boxMesh(0, 0, 3, 10, 10, 2), r = limitXform(cover, null, { offset: [0, 0, -3], scale: [1, 1, 1] }, [A, null]);
  ok(r.limited && r.hit === 'p:0' && r.xf.offset[2] <= -0.97 && r.xf.offset[2] >= -1.03, `아래로 3mm → 약 −1mm 로 제한: ${r.xf?.offset}`);
  const ok2 = limitXform(cover, null, { offset: [0, 0, 2], scale: [1, 1, 1] }, [A, null]);
  ok(!ok2.limited && ok2.xf.offset[2] === 2, '위로는 제한 없음');
  // 두께 2배(중심 기준) → 아래로 1mm 커져 하우징에 닿음 → 1.98~2.0 사이 아님, 2배 미만으로 제한
  const sc = limitXform(cover, null, { offset: [0, 0, 0], scale: [1, 1, 3] }, [A, null]);
  ok(sc.limited && sc.xf.scale[2] > 1.9 && sc.xf.scale[2] < 2.05, `두께 3배 → 약 2배 로 제한: ${sc.xf?.scale}`);
  // 원래 겹쳐 있던 것은 막지 않음
  const pre = limitXform(boxMesh(0, 0, 1.5, 10, 10, 2), null, { offset: [1, 0, 0], scale: [1, 1, 1] }, [A, null]);
  ok(!pre.limited, '원래 있던 간섭은 그대로 허용(새 간섭만 막음)'); }
{ // 상자 안 칸(바닥 0..1, 벽 x=0..1·x=19..20) 에 블록(x 5..9, z 1..3) — 바닥에 접촉
  const floor = boxMesh(0, 0, 0, 20, 10, 1), wl = boxMesh(0, 0, 1, 1, 10, 5), wr = boxMesh(19, 0, 1, 1, 10, 5), blk = boxMesh(5, 2, 1, 4, 6, 2);
  ok(Math.abs(travelDistance(blk, [floor, wl, wr], [1, 0, 0], 1000) - 10) < 0.06, `+X 로 10mm 가면 오른 벽: ${travelDistance(blk, [floor, wl, wr], [1, 0, 0], 1000)}`);
  const L = axisLimits(blk, null, [floor, wl, wr]);
  ok(Math.abs(L.move[0][0] + 4) < 0.05 && Math.abs(L.move[0][1] - 10) < 0.05, `X 범위 −4 ~ +10: ${L.move[0]}`);
  ok(Math.abs(L.move[2][0]) < 0.05 && L.move[2][1] === Infinity && L.move[1][0] === -Infinity, `Z: 아래 0(바닥 접촉), 위 무한 · Y 무한: ${L.move[2]} ${L.move[1]}`);
  ok(Math.abs(L.size[0] - 12) < 0.1 && L.size[2] === 2 + 0 || Math.abs(L.size[2] - 2) < 0.05, `X 최대 크기 4+2·4=12 · Z 는 바닥 접촉이라 2: ${L.size}`);
  ok(Math.abs(L.uniform - 1) < 0.02, `비율 고정: 바닥에 닿아 더 못 키움: ${L.uniform}`);
  const L2 = axisLimits(blk, { offset: [0, 0, 1], scale: [1, 1, 1] }, [floor, wl, wr]);
  ok(Math.abs(L2.size[2] - 4) < 0.1 && Math.abs(L2.uniform - 2) < 0.05, `1mm 띄우면 Z 최대 4 · 비율 고정 2배(높이 반 1mm = 바닥까지 1mm): ${L2.size[2]} ${L2.uniform}`); }
done();
