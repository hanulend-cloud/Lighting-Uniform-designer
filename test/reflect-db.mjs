// 반사 소재 DB(spec P4 §2.3e): node test/reflect-db.mjs
import { readFileSync } from 'node:fs';
import { validateReflect, createReflectDb, entryFromSamples, reflectPatch, copyAsUser, migrateFinishCatalog, addSamples, parsePercents, entryFromForm, reflStatusText, MEAS_CONDS, uniqueReflId } from '../src/model/reflect-db.js';
import { DEFAULT_FINISH_CATALOG, catalogOf } from '../src/engine/mech3d/housing-led.js';
import { ok, done } from './mech3d-util.mjs';

const json = JSON.parse(readFileSync(new URL('../data/reflect-db.json', import.meta.url), 'utf8'));
const BASE = json.entries;
const near = (a, b) => Math.abs(a - b) < 1e-9;

// 공용 DB = 기본 소재표(예시)
{ ok(BASE.length === 7 && BASE.every((e) => !validateReflect(e).length && e.status === 'example' && e.samples.length === 0), `공용 DB 7개 모두 유효·예시: ${BASE.map((e) => validateReflect(e)).flat()}`);
  const a = catalogOf(BASE), b = catalogOf(null);
  ok(a.length === 7 && a.every((r, k) => r.id === b[k].id && r.name === b[k].name && r.kind === b[k].kind && r.R === b[k].R && r.max === b[k].max && !!r.special === !!b[k].special && r.short === b[k].short), 'JSON = DEFAULT_FINISH_CATALOG');
  ok(b.every((r) => r.status === 'example' && r.nSamples === 0) && DEFAULT_FINISH_CATALOG.length === 7, '대체 소재표(DB 없음) = 기본·예시'); }
// 검증
{ const g = { id: 'x', name: 'X', kind: 'whiteDiffuse', status: 'datasheet', R: 0.8, Rmax: 0.85, samples: [] };
  ok(!validateReflect(g).length, '정상 항목');
  const bad = [{ ...g, id: '' }, { ...g, name: '' }, { ...g, kind: 'gloss' }, { ...g, status: 'x' }, { ...g, R: 0.9 }, { ...g, Rmax: 1.2 }, { ...g, R: null },
    { ...g, samples: [{ R: 85 }] }, { ...g, status: 'measured' }, { ...g, samples: 'x' }, null];
  ok(bad.every((e) => validateReflect(e).length), `잘못된 항목 거부: ${bad.map((e) => validateReflect(e).length).join()}`);
  ok(!validateReflect({ ...g, special: true, R: null }).length && validateReflect({ ...g, special: true }).length, '특수 = R 없음'); }
// 측정값 → 항목
{ const e = entryFromSamples({ name: '사내 백색 PC', kind: 'whiteDiffuse', samples: [{ R: 0.855, cond: 'SCI 8°/d' }, { R: 0.861 }, { R: 0.858, note: 'n' }] });
  ok(e.status === 'measured' && near(e.R, 0.858) && near(e.Rmax, 0.861) && e.samples.length === 3 && e.id.startsWith('사내_백색_PC_') && !validateReflect(e).length, `평균 85.8 · 최대 86.1: ${JSON.stringify(e)}`);
  ok(e.samples.every((s) => typeof s.date === 'string' && 'cond' in s) && e.samples[0].cond === 'SCI 8°/d', '시료 형식(조건·날짜)');
  ok(near(entryFromSamples({ name: 'a', kind: 'metal', samples: [{ R: 0.8 }], Rmax: 0.9 }).Rmax, 0.9), '상한 입력값 우선');
  ok(validateReflect(entryFromSamples({ name: 'a', samples: [] })).length > 0, '측정값 없음 → 무효'); }
// DB: 추가·중복·수정·삭제·내보내기/불러오기
{ let saved = null;
  const db = createReflectDb(BASE, [{ id: 'bad' }], (l) => { saved = l; });
  ok(db.list().length === 7 && db.get('pc-white').origin === 'base', '잘못된 사용자 항목 제외');
  let threw = false; try { db.add({ ...BASE[0] }); } catch { threw = true; }
  ok(threw, '공용과 같은 id 거부');
  threw = false; try { db.add({ id: 'q', name: 'q', kind: 'metal', status: 'example', R: 2, Rmax: 2, samples: [] }); } catch { threw = true; }
  ok(threw, '잘못된 항목 거부');
  const e = entryFromSamples({ name: '사내', samples: [{ R: 0.85 }, { R: 0.87 }] });
  db.add(e);
  ok(db.list().length === 8 && db.get(e.id).origin === 'user' && saved.length === 1 && !('origin' in saved[0]), '사용자 추가 → 저장(origin 없음)');
  ok(db.update(e.id, { name: '사내2', Rmax: 0.9 }).name === '사내2' && db.get(e.id).Rmax === 0.9 && saved[0].name === '사내2', '사용자 항목 수정');
  threw = false; try { db.update('pc-white', { R: 0.5 }); } catch { threw = true; }
  ok(threw && db.get('pc-white').R === 0.85, '공용 항목 수정 거부');
  threw = false; try { db.update(e.id, { R: 0.95 }); } catch { threw = true; }
  ok(threw && db.get(e.id).R === 0.86, '수정 결과 무효 → 거부');
  const ex = db.exportJson('user'), all = JSON.parse(db.exportJson());
  ok(JSON.parse(ex).entries.length === 1 && all.entries.length === 8 && all.version === 1, '내보내기(사용자 / 전체)');
  const db2 = createReflectDb(BASE, [], () => {});
  const r = db2.importJson(JSON.stringify({ entries: [...JSON.parse(ex).entries, BASE[1], { id: 'z', name: 'z' }] }));
  ok(r.added.length === 1 && r.rejected.length === 2 && db2.get(e.id).name === '사내2', `불러오기 왕복 · 공용 중복·무효 거부: ${r.rejected}`);
  ok(!db.remove('pc-white') && db.remove(e.id) && db.list().length === 7 && saved.length === 0, '삭제 = 사용자만'); }
// 소재표 칸 고침 · 사용자 사본
{ const pc = BASE.find((e) => e.id === 'pc-white'), cw = BASE.find((e) => e.id === 'coat-white');
  const p1 = reflectPatch(pc, 'max', 0.8), p2 = reflectPatch(pc, 'R', 0.99), p3 = reflectPatch(cw, 'max', 1.5);
  ok(p1.Rmax === 0.8 && p1.R === 0.8 && p2.R === 0.9 && p3.Rmax === 1 && p3.R === null, '상한 낮추면 R 도 · R ≤ 상한 · 0~1 · 특수 R 없음');
  const c = copyAsUser(pc);
  ok(c.id !== pc.id && c.name === '백색 PC(일반 착색) (수정)' && c.R === 0.85 && !validateReflect(c).length && !('origin' in c), '사용자 사본'); }
// 프로젝트 소재표(finishCatalog) → 사용자 항목 이관
{ const db = createReflectDb(BASE, [], () => {});
  const m = { finishCatalog: [{ id: 'pc-white', R: 0.88, max: 0.92 }, { id: 'abs-white', R: 0.82, max: 0.85 }, { id: 'coat-white', R: null, max: 0.99 }, { id: 'zzz', R: 1, max: 1 }],
    parts: [{ reflMaterial: 'pc-white' }, { reflMaterial: 'abs-white', coating: 'coat-white' }, null] };
  const r = migrateFinishCatalog(m, db);
  const u = db.list().filter((e) => e.origin === 'user');
  ok(!('finishCatalog' in m) && r.moved.length === 2 && u.length === 2, `바뀐 행만 이관 · 소재표 삭제: ${JSON.stringify(r)}`);
  const pu = u.find((e) => e.name === '백색 PC(일반 착색) (프로젝트 값)'), cu = u.find((e) => e.name === '고반사 백색 도장·반사 시트 (프로젝트 값)');
  ok(pu && near(pu.R, 0.88) && near(pu.Rmax, 0.92) && !pu.special && cu?.special && cu.R === null && near(cu.Rmax, 0.99), '이관 값');
  ok(m.parts[0].reflMaterial === pu.id && m.parts[1].reflMaterial === 'abs-white' && m.parts[1].coating === cu.id, '부품 참조 → 새 id');
  const m2 = { finishCatalog: [{ id: 'pc-white', R: 0.88, max: 0.92 }], parts: [{ reflMaterial: 'pc-white' }] };
  const r2 = migrateFinishCatalog(m2, db);
  ok(db.list().length === 9 && m2.parts[0].reflMaterial === pu.id && r2.moved.length === 1, '같은 값이 이미 있으면 재사용');
  const m3 = { finishCatalog: [{ id: 'pc-white', R: 0.85, max: 0.9 }] };
  ok(migrateFinishCatalog(m3, db).moved.length === 0 && !('finishCatalog' in m3), '기본과 같으면 삭제만');
  const m4 = { parts: [] }; ok(migrateFinishCatalog(m4, db).moved.length === 0 && migrateFinishCatalog(null, db).moved.length === 0, '소재표 없음 → 그대로'); }
// catalogOf(DB) — 상태·측정 수
{ const db = createReflectDb(BASE, [], () => {});
  const e = entryFromSamples({ name: '사내', samples: [{ R: 0.85 }, { R: 0.87 }] }); db.add(e);
  const row = catalogOf(db).find((r) => r.id === e.id);
  ok(row && row.status === 'measured' && row.nSamples === 2 && near(row.R, 0.86) && near(row.max, 0.87) && row.origin === 'user' && catalogOf(db).length === 8, `DB 행: ${JSON.stringify(row)}`); }
// Task 2: 측정값 추가·양식 해석·상태 문구(spec P4 §2.3e)
{ const e = entryFromSamples({ name: '사내 백색 PC', samples: [{ R: 0.855 }, { R: 0.861 }] });
  const p = addSamples(e, [{ R: 0.858, cond: 'SCI 8°/d', note: 'n' }]);
  ok(p.samples.length === 3 && near(p.R, (0.855 + 0.861 + 0.858) / 3) && near(p.Rmax, 0.861) && p.status === 'measured' && p.samples[2].cond === 'SCI 8°/d' && /^\d{4}-\d\d-\d\d$/.test(p.samples[2].date), `addSamples: 합쳐 평균·최대 다시: ${JSON.stringify(p)}`);
  const p2 = addSamples(e, [{ R: 0.85 }], 0.9);
  ok(near(p2.Rmax, 0.9) && !validateReflect({ ...e, ...p2 }).length, 'addSamples: 상한 직접 입력');
  const ds = { ...e, status: 'datasheet', samples: [], R: 0.8, Rmax: 0.95 }, p3 = addSamples(ds, [{ R: 0.82 }]);
  ok(p3.status === 'measured' && near(p3.R, 0.82) && near(p3.Rmax, 0.82), 'addSamples: 데이터시트 항목 → 실측'); }
{ const a = parsePercents('85.5, 86.1;85.8 x 120 -1'), b = parsePercents('');
  ok(a.values.length === 3 && near(a.values[0], 0.855) && near(a.values[2], 0.858) && a.bad.join() === 'x,120,-1' && !b.values.length && !b.bad.length, `parsePercents: % → 0~1, 범위 밖 거부: ${JSON.stringify(a)}`); }
{ const f = entryFromForm({ name: '사내 백색 PC', kind: 'whiteDiffuse', values: '85.5, 86.1, 85.8', cond: 'SCI 8°/d', note: '시료 A', max: '' });
  ok(f.entry && !validateReflect(f.entry).length && near(f.entry.R, 0.858) && near(f.entry.Rmax, 0.861) && f.entry.samples.length === 3 && f.entry.samples.every((s) => s.cond === 'SCI 8°/d' && s.note === '시료 A'), `entryFromForm: R 85.8 % · 상한 86.1 %: ${JSON.stringify(f)}`);
  const g = entryFromForm({ name: 'm', kind: 'metal', values: '80', max: '90' });
  ok(g.entry.kind === 'metal' && near(g.entry.Rmax, 0.9), 'entryFromForm: 경면 · 상한 % 입력');
  ok(entryFromForm({ name: '', values: '80' }).error === '이름을 입력하세요' && /측정 반사율/.test(entryFromForm({ name: 'a', values: '' }).error) && /0~100/.test(entryFromForm({ name: 'a', values: '80, 101' }).error) && /상한/.test(entryFromForm({ name: 'a', values: '80, 85', max: '82' }).error), '양식 오류: 이름·값 없음·범위·상한 < 평균');
  ok(MEAS_CONDS.join() === 'SCI 8°/d,SCE 8°/d,0°/45°,기타', '측정 조건 목록'); }
{ ok(reflStatusText({ status: 'measured', nSamples: 3 }) === '실측 3회' && reflStatusText({ status: 'measured', samples: [1, 2] }) === '실측 2회' && reflStatusText({ status: 'datasheet' }) === '데이터시트' && reflStatusText({ status: 'example' }) === '예시', '상태 문구');
  const db = createReflectDb(BASE, [], () => {});
  ok(uniqueReflId(db, 'pc-white') === 'pc-white_' && uniqueReflId(db, 'zz') === 'zz', 'id 겹치면 _ 붙임'); }
done();
