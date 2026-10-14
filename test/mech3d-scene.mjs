// 추적용 장면 구성: node test/mech3d-scene.mjs
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable();
setMech3dMesh('s', [boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, 2)]);
const parts = [setPartMaterial(defaultPart(0, 'a', 200), 'clear'), setPartFinish(defaultPart(1, 'b', 200), 3, { kind: 'black', R: 0.05 })];
const S = buildTraceScene(getMech3d(), { name: 's', parts, contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'contact' }] }, { table });
ok(S.normals.length === 72 && Math.abs(S.normals[2] + 1) < 1e-6 && Math.abs(S.normals[3 * 2 + 2] - 1) < 1e-6, '삼각형 바깥 법선(−z 바닥, +z 윗면)');
ok(S.optics[0].transmissive && !S.optics[1].transmissive, '부품별 광학 물성');
const t1 = 12 + 2 * 3;   // 부품 1 의 면 3 첫 삼각형(결합 메쉬 번호)
ok(S.fins[S.finOf[t1]].kind === 'black' && S.fins[S.finOf[12]].kind === 'whiteDiffuse', '삼각형별 면 처리(덮어쓰기 반영)');
ok(S.contact.get('0|1')?.part === 1 && S.contact.get('1|0')?.part === 0 && S.contact.get('1|0')?.face === 1, '접촉면 양방향 조회');
const S2 = buildTraceScene(getMech3d(), { name: 's', parts, contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'air' }] }, { table });
ok(S2.contact.size === 0 && S2.film.get('0|1')?.part === 1 && S2.film.get('1|0')?.part === 0, "'공기층' 모드 = 공기막 조회(film), 광학 접촉 조회에서 제외");
let threw = false; try { buildTraceScene(getMech3d(), { name: 's', parts: [parts[0]], contacts: [] }, { table }); } catch { threw = true; }
ok(threw, '부품 수 불일치 → 오류');
done();
