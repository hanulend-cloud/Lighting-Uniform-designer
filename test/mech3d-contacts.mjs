// 부품 간 접촉면 감지: node test/mech3d-contacts.mjs
import { findContacts } from '../src/engine/mech3d/contacts.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const near = (x, y, e = 1e-3) => Math.abs(x - y) < e;
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, 2)]);
  ok(c.length === 1 && c[0].a === 0 && c[0].faceA === 1 && c[0].b === 1 && c[0].faceB === 0 && near(c[0].area, 100), `적층: ${JSON.stringify(c)}`);
}
ok(findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.5, 10, 10, 2)]).length === 0, '0.5mm 공기층 → 접촉 없음');
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.015, 10, 10, 2)]);
  ok(c.length === 1 && near(c[0].area, 100), '0.015mm (허용 0.02 이내) → 접촉');
}
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(5, 0, 2, 10, 10, 2)]);
  ok(c.length === 1 && near(c[0].area, 50), `절반 겹침: 면적 ${c[0]?.area}`);
}
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(10, 0, 0, 10, 10, 2)]);
  ok(c.length === 1 && c[0].faceA === 5 && c[0].faceB === 4 && near(c[0].area, 20), `옆면 접촉: ${JSON.stringify(c)}`);
}
ok(findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(30, 0, 0, 1, 1, 1)]).length === 0, '떨어진 부품 → 없음');
ok(findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.05, 10, 10, 2)]).length === 0, '0.05mm 틈 (gap+chord 0.04 초과) → 접촉 없음');
// 원기둥 측면(r=5, h=10) 메쉬: inward=true 이면 법선이 축 방향(관 내벽). 정점은 원 위(내접).
function cylSide(seg, inward) {
  const P = [], T = [], F = [], r = 5, h = 10;
  for (let i = 0; i < seg; i++) {
    const a0 = 2 * Math.PI * i / seg, a1 = 2 * Math.PI * (i + 1) / seg, n = P.length / 3;
    P.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0, r * Math.cos(a1), r * Math.sin(a1), h, r * Math.cos(a0), r * Math.sin(a0), h);
    if (inward) T.push(n, n + 2, n + 1, n, n + 3, n + 2); else T.push(n, n + 1, n + 2, n, n + 2, n + 3);
    F.push(0, 0);
  }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F) };
}
{
  const c = findContacts([cylSide(32, false), cylSide(48, true)]);
  const area = c.reduce((s, x) => s + x.area, 0), want = 2 * Math.PI * 5 * 10;
  ok(c.length === 1 && Math.abs(area - want) / want < 0.03, `동축 원기둥(32/48 분할) 곡면 접촉: ${area.toFixed(2)} vs ${want.toFixed(2)}`);
}
done();
