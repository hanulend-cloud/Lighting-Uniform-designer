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
done();
