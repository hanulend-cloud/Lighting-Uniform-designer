// 소재·표면 DB 내보내기·불러오기(꾸러미 · 투명 측정값)
import { validateClear, clearImport, clearExportJson, bundleJson, parseMaterialFile, BUNDLE_KIND } from '../src/model/material-io.js';
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fail++; };
const A = { id: 'u:A', name: 'A', base: 'PC', n: 1.583, T: 0.885, tRef: 3, note: '' };
ok(!validateClear(A).length && validateClear({ ...A, n: 3 }).length && validateClear({ ...A, base: 'X' }).length && validateClear(null).length, '투명 항목 검사');
const r = clearImport([A, { ...A, id: 'u:B', T: 2 }], [{ ...A, n: 1.5 }]);
ok(r.list.length === 1 && r.list[0].n === 1.583 && r.added.join() === 'u:A' && r.rejected.length === 1, '투명 불러오기: 같은 id 덮어씀 · 잘못된 항목 거부');
ok(parseMaterialFile(clearExportJson([A])).clear.length === 1, '투명 내보내기 → 다시 읽기');
const b = bundleJson({ milky: JSON.stringify({ entries: [{ id: 'm1', fitted: {} }] }), reflect: JSON.stringify({ entries: [{ id: 'r1', Rmax: 0.9 }] }), clear: [A] });
const d = parseMaterialFile(b);
ok(JSON.parse(b).kind === BUNDLE_KIND && d.milky.length === 1 && d.reflect.length === 1 && d.clear.length === 1, '꾸러미: 세 DB 왕복');
const s = parseMaterialFile(JSON.stringify({ entries: [{ id: 'm', fitted: {} }, { id: 'r', Rmax: 1 }, A] }));
ok(s.milky.length === 1 && s.reflect.length === 1 && s.clear.length === 1, 'DB 하나짜리 파일도 항목 모양으로 구분');
let threw = false; try { parseMaterialFile('{"entries":[]}'); } catch { threw = true; }
ok(threw, '항목 없는 파일 → 오류');
console.log(fail ? `${fail} FAIL` : 'all PASS'); process.exit(fail ? 1 : 0);
