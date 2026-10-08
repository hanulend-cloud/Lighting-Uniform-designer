// 실측소재 DB: node test/l2-db.mjs  (spec §6.3, SV2·SV8)
import fs from 'node:fs';
import { loadTable, nodeLoader } from './l2-util.mjs';
import { initL2, setMaterialDb } from '../src/engine/l2/runtime.js';
import { validateEntry, createDb, milkyOf, nearestByMilky } from '../src/model/materials-db.js';
import { milkyFromMusR } from '../src/engine/l2/milky.js';
import { fitMaterial } from '../src/engine/l2/fit.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { l2Describe } from '../src/engine/directLit.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();
await initL2(nodeLoader());

const mk = (id, musR, extra = {}) => ({ id, name: id, status: 'measured', n: 1.586, samples: [{ t: 2, T: 0.7, hpa: 40 }], fitted: { musR, g: 0.95, mua: 0.001 }, ...extra });

// 스키마
ok(validateEntry(mk('a', 0.3)).length === 0, '정상 항목 통과');
ok(validateEntry({ ...mk('b', 0.3), samples: [] }).length > 0 && validateEntry({ ...mk('c', 0.3), fitted: null }).length > 0
  && validateEntry({ ...mk('d', 0.3), samples: [{ t: 2, T: 70 }] }).length > 0, '시료 없음·계수 없음·T 범위(0~1) 위반 거부');

// 병합·추가·삭제·내보내기/불러오기
let saved = null;
const db = createDb([mk('base1', 0.2, { status: 'datasheet' }), { id: 'broken' }], [], (l) => { saved = l; });
ok(db.list().length === 1, '공용 DB 의 깨진 항목은 제외');
db.add(mk('u1', 1.0));
ok(db.list().length === 2 && saved.length === 1 && !('origin' in saved[0]), '사용자 항목 추가·저장(origin 필드 제외)');
let threw = false; try { db.add(mk('base1', 0.5)); } catch { threw = true; }
ok(threw, '공용 DB 와 같은 id 추가 거부');
const json = db.exportJson('all');
const db2 = createDb([mk('base1', 0.2, { status: 'datasheet' })], [], () => {});
const r = db2.importJson(json);
ok(r.added.includes('u1') && r.rejected.some((s) => s.startsWith('base1')), `불러오기: 사용자 항목 추가, 공용 중복 거부 (${r.added.length}/${r.rejected.length})`);
ok(db.remove('u1') && !db.remove('base1'), '사용자 항목만 삭제 가능');

// Milky 는 μs' 에서 파생, 가까운 소재
ok(Math.abs(milkyOf(table, mk('x', 0.8)) - milkyFromMusR(table, 0.8)) < 1e-12, 'Milky = μs\' 파생값(저장하지 않음)');
const near = nearestByMilky(table, [mk('lo', 0.05), mk('mid', 0.8), mk('hi', 5)], milkyFromMusR(table, 0.7));
ok(near.entry.id === 'mid', `가까운 소재 = mid (Milky 차 ${near.diff.toFixed(2)})`);

// 소재 선택 → 필드 계산이 그 계수를 사용
{
  const f = fitMaterial(table, { name: 'DQ5142', n: 1.586, samples: [{ t: 2, T: 0.65, hpa: 43 }] });
  const ent = { id: 'dq', name: 'DQ5142', status: 'datasheet', n: 1.586, samples: [{ t: 2, T: 0.65, hpa: 43 }], fitted: { musR: f.mat.musR, g: f.mat.g, mua: f.mat.mua }, validation: { V6: f.V6 } };
  setMaterialDb(createDb([ent], [], () => {}));
  const s = structuredClone(DEFAULT_SPEC); s.levels[2].on = true;
  const d = l2Describe(s, 12, { milky: 0, pcb: '혼재', material: 'dq' });
  ok(d.info.material?.id === 'dq' && Math.abs(d.info.musR - f.mat.musR) < 1e-12 && Math.abs(d.info.g - f.mat.g) < 1e-12, `소재 선택 → μs' ${d.info.musR.toFixed(3)}·g ${d.info.g.toFixed(3)} 사용, Milky ${d.info.milky.toFixed(2)}`);
  const u = l2Describe(s, 12, { milky: 3, pcb: '혼재', material: 'nope' });
  ok(!u.info.material && u.warnings.some((w) => w.includes('찾을 수 없음')), 'DB 에 없는 소재 → 추상 Milky + 경고');
}

// 공용 DB 파일(data/materials-db.json): 형식 유효, 데이터시트 항목 V6 통과 (SV2)
{
  const base = JSON.parse(fs.readFileSync(new URL('../data/materials-db.json', import.meta.url))).entries;
  ok(base.length >= 3 && base.every((e) => validateEntry(e).length === 0), `공용 DB ${base.length}건 형식 유효`);
  // DQ5122 는 HG 한계로 V6 불일치가 정답(test/l2-fit 참조) — UI 에 "보정 불일치" 로 표시돼야 한다
  for (const e of base) ok(!!e.validation?.V6?.ok === (e.id !== 'covestro-dq5122'), `  ${e.name}: Milky ${milkyOf(table, e).toFixed(2)} · V6 ${e.validation?.V6?.ok ? '통과' : '불일치'} (${e.validation?.V6?.note})`);
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
