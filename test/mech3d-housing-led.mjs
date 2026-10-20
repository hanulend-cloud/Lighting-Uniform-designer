// ④ 케이스 면 후보·⑤ LED 높이 범위(순수): node test/mech3d-housing-led.mjs
import { FINISH_GRADES, gradeOf, finishOptions, ledHeightRange, heightCandidates, DEFAULT_FINISH_CATALOG, catalogOf, finishCandidatesFor, setCatalogValue, setReflMaterial, finishLimit, partFinishEdit } from '../src/engine/mech3d/housing-led.js';
import { ok, done } from './mech3d-util.mjs';

const lab = (f) => `${f.kind === 'metal' ? 'M' : f.kind === 'whiteDiffuse' ? 'W' : f.kind}${Math.round((f.R ?? 0) * 100)}`;
{ const s = [...FINISH_GRADES].sort((a, b) => gradeOf(a) - gradeOf(b)).map(lab).join();
  ok(s === 'W85,M88,W90,W95,M95,W97', `등급 순서(반사율 오름차순, 같은 R 은 백색 먼저): ${s}`);
  ok(gradeOf({ kind: 'whiteDiffuse', R: 0.95 }) < gradeOf({ kind: 'metal', R: 0.95 }) && gradeOf({ kind: 'gloss' }) < gradeOf({ kind: 'whiteDiffuse', R: 0.85 }), '같은 R → 백색 우선 · R 없음(광택) = 최저'); }
{ const a = finishOptions({ kind: 'whiteDiffuse', R: 0.85 });
  ok(a.length === 6 && a.filter((f) => f.current).length === 1 && a[0].current && lab(a[0]) === 'W85', `현재(백색 85) = 목록 안 → 6개, 현재 표시: ${a.map((f) => lab(f) + (f.current ? '*' : '')).join()}`);
  const b = finishOptions({ kind: 'whiteDiffuse', R: 0.5 });
  ok(b.length === 7 && b[0].current && lab(b[0]) === 'W50' && b.slice(1).every((f) => !f.current), `현재(백색 50) 추가 → 7개 등급 순: ${b.map(lab).join()}`);
  const c = finishOptions({ kind: 'metal', R: 0.92 });
  ok(c.length === 7 && lab(c[3]) === 'M92' && c[3].current, `현재(경면 92) 가운데 정렬: ${c.map(lab).join()}`);
  ok(finishOptions(null).length === 6 && finishOptions(null).every((f) => !f.current), '현재 없음 → 등급 목록만'); }
{ const r = ledHeightRange({ up: 5, down: 2 });
  ok(Math.abs(r[0] + 1.7) < 1e-9 && Math.abs(r[1] - 4.7) < 1e-9, `범위 = [−(아래−0.3), 위−0.3]: ${r}`);
  const z = ledHeightRange({ up: 0.2, down: 0 });
  ok(Object.is(z[0], 0) && z[1] === 0, `여유보다 가까우면 0: ${z}`);
  const m = ledHeightRange({ up: Infinity, down: 1, margin: 0.5, max: 8 });
  ok(m[0] === -0.5 && m[1] === 8, `막힘 없음 → 상한 max: ${m}`); }
{ const h = heightCandidates([-1.7, 4.7], 7);
  ok(h.length === 7 && h.includes(0) && h[0] === -1.7 && h.at(-1) === 4.7 && h.every((v, i) => !i || v > h[i - 1]), `후보 7개(0 포함, 끝점 포함, 오름차순): ${h}`);
  const p = heightCandidates([0, 3], 7);
  ok(p.length === 7 && p[0] === 0 && p.at(-1) === 3, `위로만: ${p}`);
  ok(heightCandidates([0, 0], 7).join() === '0', '범위 없음 → [0]');
  const t = heightCandidates([-0.1, 6], 7);
  ok(t.length === 7 && t[0] === -0.1 && t.includes(0) && t.at(-1) === 6, `한쪽이 짧아도 양쪽 끝 포함: ${t}`); }
// ④ 소재별 반사율 상한(spec P4 §2.3d)
{ const C = DEFAULT_FINISH_CATALOG, ids = C.map((e) => e.id).join();
  ok(ids === 'abs-white,pc-white,pbt-white,pc-hr,al-raw,coat-white,coat-metal', `기본 카탈로그 id: ${ids}`);
  const pc = C.find((e) => e.id === 'pc-white'), cm = C.find((e) => e.id === 'coat-metal');
  ok(pc.kind === 'whiteDiffuse' && pc.R === 0.85 && pc.max === 0.9 && !pc.special && cm.special && cm.kind === 'metal' && cm.max === 0.95 && cm.R == null, '표 값(백색 PC 85/90 · 증착 특수 95)');
  ok(catalogOf({}).every((e, k) => e.max === C[k].max) && catalogOf(null).length === 7, '저장 없음 → 기본');
  const o = catalogOf({ finishCatalog: [{ id: 'pc-white', R: 0.88, max: 0.92 }, { id: 'zzz', R: 1, max: 1 }, { id: 'abs-white', R: 'x', max: 2 }] });
  ok(o.length === 7 && o[1].R === 0.88 && o[1].max === 0.92 && o[0].R === 0.82 && o[0].max === 0.85, `저장 값 덮어씀 · 잘못된 값 무시: ${JSON.stringify(o.slice(0, 2))}`);
  ok(catalogOf({ finishCatalog: [{ id: 'pc-white', R: 0.95, max: 0.9 }] })[1].R === 0.9, '기본 R > 상한 → 상한');
  const s1 = setCatalogValue(C, 'pc-white', 'max', 0.8);
  ok(s1.find((e) => e.id === 'pc-white').max === 0.8 && s1.find((e) => e.id === 'pc-white').R === 0.8 && s1.length === 7, '상한 낮추면 기본 R 도 따라 내림');
  const s2 = setCatalogValue(C, 'pc-white', 'R', 0.99);
  ok(s2.find((e) => e.id === 'pc-white').R === 0.9 && setCatalogValue(C, 'pc-hr', 'max', 1.5).find((e) => e.id === 'pc-hr').max === 1, '기본 R ≤ 상한 · 0~1 로 자름'); }
{ const C = DEFAULT_FINISH_CATALOG, W = (R) => ({ kind: 'whiteDiffuse', R });
  const a = finishCandidatesFor({ catalog: C, materialId: 'pc-white', current: W(0.85), allowSpecial: false });
  ok(a.map(lab).join() === 'W85,W90' && a[0].current && !a.some((f) => f.special), `백색 PC: 상한 90 까지 백색만: ${a.map(lab)}`);
  const b = finishCandidatesFor({ catalog: C, materialId: 'pc-white', current: W(0.85), allowSpecial: true });
  ok(b.map(lab).join() === 'W85,W90,M95,W97' && b.filter((f) => f.special).map((f) => f.coating).join() === 'coat-metal,coat-white', `특수 허용 → 상한 값으로 추가: ${b.map(lab)}`);
  const c = finishCandidatesFor({ catalog: C, materialId: 'abs-white', current: W(0.5), allowSpecial: false });
  ok(c.map(lab).join() === 'W50,W85' && c[0].current, `ABS(85): 현재 50 + 85: ${c.map(lab)}`);
  const d = finishCandidatesFor({ catalog: C, materialId: 'pc-hr', current: W(0.95), allowSpecial: true });
  ok(d.map(lab).join() === 'W85,W90,W95,M95,W97' && !d.find((f) => lab(f) === 'W97').special, `고반사 PC: 97 은 소재로 도달 → 특수 아님: ${d.map(lab)}`);
  const e = finishCandidatesFor({ catalog: C, materialId: 'al-raw', current: { kind: 'metal', R: 0.85 }, allowSpecial: false });
  ok(e.map(lab).join() === 'M85,M88', `알루미늄: 경면 88 까지: ${e.map(lab)}`);
  const f = finishCandidatesFor({ catalog: C, materialId: undefined, current: W(0.85), allowSpecial: true });
  ok(f.length === 6 && f.map(lab).join() === finishOptions(W(0.85)).map(lab).join(), '소재 미지정 → 기존 전체 등급(호환)');
  const g = finishCandidatesFor({ catalog: catalogOf({ finishCatalog: [{ id: 'pc-white', max: 0.95 }] }), materialId: 'pc-white', current: W(0.85) });
  ok(g.map(lab).join() === 'W85,W90,W95', `편집한 상한 반영: ${g.map(lab)}`); }
{ const C = DEFAULT_FINISH_CATALOG, p = { name: 'c', material: { kind: 'opaque' }, finish: { kind: 'whiteDiffuse', R: 0.9 }, faceFinish: { 3: { kind: 'black', R: 0.05 } }, coating: 'coat-white' };
  const q = setReflMaterial(p, 'abs-white', C);
  ok(q.reflMaterial === 'abs-white' && q.finish.kind === 'whiteDiffuse' && q.finish.R === 0.82 && !('coating' in q) && q.faceFinish[3].kind === 'black', '소재 선택 → 기본 R · 특수 표시 해제 · 면 덮어쓰기 유지');
  const al = setReflMaterial(p, 'al-raw', C);
  ok(al.finish.kind === 'metal' && al.finish.R === 0.85, '알루미늄 → 경면 85');
  const z = setReflMaterial(q, null, C);
  ok(!('reflMaterial' in z) && z.finish.R === 0.82, '미지정 → 소재만 지움');
  ok(finishLimit(q, C).max === 0.85 && finishLimit({ ...q, coating: 'coat-white' }, C).max === 0.97 && finishLimit({ finish: {} }, C) === null, '상한 = 특수 처리 > 소재 > 없음');
  const r1 = partFinishEdit(q, null, { kind: 'whiteDiffuse', R: 0.95 }, C);
  ok(r1.clamped && r1.max === 0.85 && r1.part.finish.R === 0.85, `상한 초과 → 상한으로: ${r1.part.finish.R}`);
  const r2 = partFinishEdit(q, null, { kind: 'whiteDiffuse', R: 0.6 }, C);
  ok(!r2.clamped && r2.part.finish.R === 0.6, '상한 이하 그대로');
  const r3 = partFinishEdit(q, null, { kind: 'metal', R: 0.95 }, C);
  ok(!r3.clamped && r3.part.finish.R === 0.95, '다른 종류는 자르지 않음');
  const r4 = partFinishEdit(z, null, { kind: 'whiteDiffuse', R: 0.99 }, C);
  ok(!r4.clamped && r4.part.finish.R === 0.99, '소재 미지정 → 아무 값');
  const r5 = partFinishEdit(q, 3, { kind: 'whiteDiffuse', R: 0.95 }, C);
  ok(r5.clamped && r5.part.faceFinish[3].R === 0.85, '면 덮어쓰기도 소재 상한');
  const cq = { ...q, coating: 'coat-white' };
  const r6 = partFinishEdit(cq, null, { kind: 'whiteDiffuse', R: 0.99 }, C);
  ok(r6.clamped && r6.max === 0.97 && r6.part.coating === 'coat-white', '특수 처리 부품 → 그 상한');
  const r7 = partFinishEdit(cq, null, { kind: 'metal', R: 0.88 }, C);
  ok(!('coating' in r7.part), '종류를 바꾸면 특수 표시 해제'); }
done();
