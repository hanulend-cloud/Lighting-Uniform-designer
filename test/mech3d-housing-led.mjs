// ④ 케이스 면 후보·⑤ LED 높이 범위(순수): node test/mech3d-housing-led.mjs
import { FINISH_GRADES, gradeOf, finishOptions, ledHeightRange, heightCandidates } from '../src/engine/mech3d/housing-led.js';
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
done();
