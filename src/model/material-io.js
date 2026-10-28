// 소재·표면 DB 내보내기·불러오기(순수 + 브라우저 저장) — 투명 소재 측정값(uds.clear.v1) 저장소와,
// 세 DB(실측 Milky = materials-db · 반사 소재 = reflect-db · 투명 측정값)를 한 파일로 묶는 꾸러미.
// 꾸러미 = { kind: 'uds-material-bundle', version, milky: [항목], reflect: [항목], clear: [항목] } — 사용자 항목만(기본 항목은 프로그램에 들어 있음)
import { RESIN_N } from '../engine/mech3d/materials.js';

export const CLEAR_KEY = 'uds.clear.v1';
export const BUNDLE_KIND = 'uds-material-bundle';

// 투명 측정 항목 검사(순수) — 오류 문구 목록
export function validateClear(e) {
  const err = [];
  if (!e || typeof e !== 'object') return ['항목 형식 아님'];
  if (!e.id || typeof e.id !== 'string') err.push('id 없음');
  if (!e.name) err.push('이름 없음');
  if (!(e.n >= 1.2 && e.n <= 2.5)) err.push('굴절률은 1.2 ~ 2.5');
  if (!(e.T > 0 && e.T <= 1)) err.push('투과율은 0~1');
  if (!(e.tRef > 0)) err.push('측정 두께 없음');
  if (e.base != null && !RESIN_N[e.base]) err.push(`바탕 수지 오류: ${e.base}`);
  return err;
}
export function loadClear() {
  try { const v = JSON.parse(localStorage.getItem(CLEAR_KEY) || '[]'); return Array.isArray(v) ? v.filter((e) => !validateClear(e).length) : []; } catch { return []; }
}
export function saveClear(list) { try { localStorage.setItem(CLEAR_KEY, JSON.stringify(list)); } catch {} }

export const clearExportJson = (list) => JSON.stringify({ kind: 'uds-clear-db', version: 1, entries: list }, null, 1);
// 불러오기(순수) — 같은 id 는 덮어씀 · 잘못된 항목은 거부. 반환 { list, added, rejected }
export function clearImport(entries, list) {
  const added = [], rejected = [];
  let out = [...list];
  for (const e of entries ?? []) {
    const errs = validateClear(e);
    if (errs.length) { rejected.push(`${e?.id ?? '?'}: ${errs.join(', ')}`); continue; }
    out = [...out.filter((u) => u.id !== e.id), { ...e, origin: 'user' }];
    added.push(e.id);
  }
  return { list: out, added, rejected };
}

// 꾸러미 만들기(순수) — 각 DB 의 exportJson('user') 결과(문자열)·투명 목록
export function bundleJson({ milky = '{"entries":[]}', reflect = '{"entries":[]}', clear = [] }) {
  return JSON.stringify({ kind: BUNDLE_KIND, version: 1, milky: JSON.parse(milky).entries ?? [], reflect: JSON.parse(reflect).entries ?? [], clear }, null, 1);
}
// 파일 읽기(순수) — 꾸러미 또는 DB 하나짜리 파일(항목 모양으로 구분). 반환 { milky, reflect, clear } (없는 DB = [])
export function parseMaterialFile(text) {
  const d = JSON.parse(text);
  if (d?.kind === BUNDLE_KIND) return { milky: d.milky ?? [], reflect: d.reflect ?? [], clear: d.clear ?? [] };
  const out = { milky: [], reflect: [], clear: [] };
  for (const e of d?.entries ?? []) {
    if (e && 'fitted' in e) out.milky.push(e);
    else if (e && 'Rmax' in e) out.reflect.push(e);
    else if (e && 'n' in e && 'T' in e) out.clear.push(e);
  }
  if (!out.milky.length && !out.reflect.length && !out.clear.length) throw new Error('소재 DB 파일이 아님(항목 없음)');
  return out;
}
