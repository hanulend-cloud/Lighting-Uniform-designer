// 반사 소재 DB — spec P4 §2.3e. 투과 실측소재 DB(materials-db.js)와 같은 구조:
// 공용 기본 = data/reflect-db.json(git 공유), 사용자 추가분 = 브라우저 저장(uds.reflect.v1) + JSON 내보내기/불러오기.
// 항목 { id, name, short?, kind: whiteDiffuse|metal, status, R(특수 = null), Rmax, special?, samples: [{ R, cond, note, date }] } — 반사율 0~1
import { STATUS, newId } from './materials-db.js';
import { DEFAULT_FINISH_CATALOG } from '../engine/mech3d/housing-led.js';

export const REFLECT_VERSION = 1;
export const REFLECT_KINDS = { whiteDiffuse: '확산', metal: '경면' };
const in01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

export function validateReflect(e) {
  const err = [];
  if (!e || typeof e !== 'object') return ['항목 형식 아님'];
  if (!e.id || typeof e.id !== 'string') err.push('id 없음');
  if (!e.name) err.push('이름 없음');
  if (!REFLECT_KINDS[e.kind]) err.push(`kind 는 ${Object.keys(REFLECT_KINDS).join('|')}`);
  if (!STATUS[e.status]) err.push(`status 는 ${Object.keys(STATUS).join('|')}`);
  if (!in01(e.Rmax)) err.push('상한 Rmax 는 0~1');
  if (e.special) { if (e.R != null) err.push('특수 처리는 기본 R 없음'); }
  else if (!in01(e.R)) err.push('반사율 R 은 0~1');
  else if (in01(e.Rmax) && e.R > e.Rmax + 1e-9) err.push('R 이 상한보다 큼');
  if (!Array.isArray(e.samples)) err.push('samples 배열 아님');
  else {
    e.samples.forEach((s, i) => { if (!in01(s?.R)) err.push(`측정 ${i + 1}: R 은 0~1`); });
    if (e.status === 'measured' && !e.samples.length) err.push('실측인데 측정값 없음');
  }
  return err;
}

const strip = ({ origin, ...e }) => e;

// base: 공용 항목, user: 사용자 항목, save(userList): 사용자 저장 콜백
export function createReflectDb(base = [], user = [], save = () => {}) {
  const baseList = base.filter((e) => !validateReflect(e).length).map((e) => ({ ...e, origin: 'base' }));
  let userList = user.filter((e) => !validateReflect(e).length && !baseList.some((b) => b.id === e.id)).map((e) => ({ ...e, origin: 'user' }));
  const all = () => [...baseList, ...userList];
  const put = (e) => { userList = [...userList.filter((u) => u.id !== e.id), { ...strip(e), origin: 'user' }]; };
  const persist = () => save(userList.map(strip));
  return {
    list: all,
    get: (id) => all().find((e) => e.id === id) ?? null,
    add(entry) {
      const errs = validateReflect(entry);
      if (errs.length) throw new Error(errs.join(', '));
      if (baseList.some((e) => e.id === entry.id)) throw new Error('공용 DB 와 같은 id');
      put(entry); persist();
    },
    // 사용자 항목만 — patch 를 합친 결과가 무효면 거부(id 는 바꾸지 않음)
    update(id, patch) {
      const cur = userList.find((e) => e.id === id);
      if (!cur) throw new Error(baseList.some((e) => e.id === id) ? '공용 항목은 수정 불가 — 사본을 만드세요' : '항목 없음');
      const next = { ...strip(cur), ...patch, id };
      const errs = validateReflect(next);
      if (errs.length) throw new Error(errs.join(', '));
      userList = userList.map((e) => (e.id === id ? { ...next, origin: 'user' } : e));
      persist();
      return next;
    },
    remove(id) {
      if (!userList.some((e) => e.id === id)) return false;
      userList = userList.filter((e) => e.id !== id);
      persist();
      return true;
    },
    exportJson: (which = 'all') => JSON.stringify({ version: REFLECT_VERSION, entries: (which === 'user' ? userList : all()).map(strip) }, null, 1),
    importJson(text) {
      const d = JSON.parse(text), added = [], rejected = [];
      for (const e of d.entries ?? []) {
        if (baseList.some((b) => b.id === e?.id)) { rejected.push(`${e.id}: 공용 DB 와 중복`); continue; }
        const errs = validateReflect(e);
        if (errs.length) { rejected.push(`${e?.id ?? '?'}: ${errs.join(', ')}`); continue; }
        put(e); added.push(e.id);
      }
      persist();
      return { added, rejected };
    },
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const rd = (v) => Math.round(v * 1e6) / 1e6;
// 측정값 → 실측 항목: R = 평균, Rmax = 입력(0~1) 또는 측정 최대. 측정값 없으면 R = NaN(검증에서 거부)
export function entryFromSamples({ name, kind = 'whiteDiffuse', samples = [], Rmax } = {}) {
  const ss = samples.map((s) => ({ R: Number(s?.R), cond: s?.cond ?? '', note: s?.note ?? '', date: s?.date ?? today() }));
  const Rs = ss.map((s) => s.R);
  const R = Rs.length ? rd(Rs.reduce((a, b) => a + b, 0) / Rs.length) : NaN;
  return { id: newId(name), name, kind, status: 'measured', R, Rmax: Rmax != null && in01(Number(Rmax)) ? Number(Rmax) : Rs.length ? Math.max(...Rs) : NaN, samples: ss };
}

// 소재표 한 칸 고침(key = 'R' | 'max', 0~1 로 자름) → update 용 { R, Rmax }. 상한을 내리면 R 도 따라 내림
export function reflectPatch(e, key, v) {
  const x = Math.min(1, Math.max(0, Number(v) || 0));
  if (key === 'max') return { Rmax: x, R: e.special || e.R == null ? null : Math.min(e.R, x) };
  return { R: e.special ? null : Math.min(x, e.Rmax), Rmax: e.Rmax };
}

// 공용 항목 → 사용자 사본(새 id, 이름 + suffix)
export function copyAsUser(e, suffix = ' (수정)') {
  const name = `${e.name}${suffix}`, { origin, ...rest } = e;
  return { ...rest, id: newId(name), name, samples: [...(e.samples ?? [])] };
}

// 프로젝트 소재표(spec.mech3d.finishCatalog = [{ id, R, max }], §2.3d) → 사용자 항목 "… (프로젝트 값)" 이관 후 삭제.
// 기본과 다른 행만 옮기고, 그 id 를 가리키던 부품 reflMaterial·coating 을 새 id 로. 같은 이름·값 사용자 항목이 있으면 재사용
export function migrateFinishCatalog(m, db, defaults = DEFAULT_FINISH_CATALOG) {
  const moved = [];
  if (!m || m.finishCatalog == null || !db) return { moved };
  const saved = Array.isArray(m.finishCatalog) ? m.finishCatalog : [], map = {};
  for (const e of defaults) {
    const o = saved.find((x) => x?.id === e.id);
    if (!o) continue;
    const num = (v) => (v == null || v === '' ? NaN : Number(v));
    const max = in01(num(o.max)) ? num(o.max) : e.max, R = e.special ? null : Math.min(max, in01(num(o.R)) ? num(o.R) : e.R);
    if (Math.abs(max - e.max) < 1e-9 && (e.special || Math.abs(R - e.R) < 1e-9)) continue;
    const name = `${e.name} (프로젝트 값)`;
    let ent = db.list().find((u) => u.origin === 'user' && u.name === name && u.kind === e.kind && Math.abs(u.Rmax - max) < 1e-9 && (e.special ? u.R == null : Math.abs(u.R - R) < 1e-9));
    if (!ent) {
      let id = newId(name);
      while (db.get(id)) id += '_';
      ent = { id, name, ...(e.short ? { short: e.short } : {}), kind: e.kind, status: 'example', R, Rmax: max, ...(e.special ? { special: true } : {}), samples: [] };
      db.add(ent);
    }
    map[e.id] = ent.id;
    moved.push({ from: e.id, to: ent.id, name });
  }
  for (const p of Array.isArray(m.parts) ? m.parts : []) {
    if (!p) continue;
    if (map[p.reflMaterial]) p.reflMaterial = map[p.reflMaterial];
    if (map[p.coating]) p.coating = map[p.coating];
  }
  delete m.finishCatalog;
  return { moved };
}
