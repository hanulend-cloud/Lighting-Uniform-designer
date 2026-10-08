// 실측소재 DB — spec 2026-10-07 §6.3. Milky 축 위의 실소재 대응표.
// 정본 = 측정 원자료(samples) + 피팅 계수(fitted: μs'·g·μa·n). Milky 는 저장하지 않고 μs' 에서 파생한다
// (눈금 정의가 바뀌어도 DB 가 어긋나지 않게). 공용 기준 DB = 저장소 data/materials-db.json(git 공유),
// 사용자 추가분 = 브라우저 저장 + JSON 내보내기/불러오기(팀 공유 시 기준 DB 로 병합 커밋).
import { milkyFromMusR } from '../engine/l2/milky.js';

export const DB_VERSION = 1;
export const STATUS = { measured: '실측', datasheet: '데이터시트', example: '예시' };

export function validateEntry(e) {
  const err = [];
  if (!e || typeof e !== 'object') return ['항목 형식 아님'];
  if (!e.id || typeof e.id !== 'string') err.push('id 없음');
  if (!e.name) err.push('이름 없음');
  if (!STATUS[e.status]) err.push(`status 는 ${Object.keys(STATUS).join('|')}`);
  if (!(e.n >= 1.3 && e.n <= 1.8)) err.push('굴절률 n 범위(1.3~1.8) 밖');
  if (!Array.isArray(e.samples) || !e.samples.length) err.push('측정 시료 없음');
  else e.samples.forEach((s, i) => {
    if (!(s.t > 0)) err.push(`시료 ${i + 1}: 두께 t 없음`);
    for (const k of ['T', 'R', 'haze']) if (s[k] != null && !(s[k] >= 0 && s[k] <= 1)) err.push(`시료 ${i + 1}: ${k} 는 0~1`);
    if (s.T == null && s.R == null && s.hpa == null && !(s.curve?.length)) err.push(`시료 ${i + 1}: 측정값 없음`);
  });
  const f = e.fitted;
  if (!f || !(f.musR >= 0) || !(f.g >= -1 && f.g < 1) || !(f.mua >= 0)) err.push('피팅 계수(fitted) 없음');
  return err;
}

export function milkyOf(table, entry) { return milkyFromMusR(table, entry.fitted.musR); }

export function nearestByMilky(table, entries, m) {
  let best = null, d = Infinity;
  for (const e of entries) { const v = Math.abs(milkyOf(table, e) - m); if (v < d) { d = v; best = e; } }
  return best ? { entry: best, milky: milkyOf(table, best), diff: d } : null;
}

// base: 공용 DB 항목, user: 사용자 항목, save(userList): 사용자 저장 콜백
export function createDb(base = [], user = [], save = () => {}) {
  const baseList = base.filter((e) => !validateEntry(e).length).map((e) => ({ ...e, origin: 'base' }));
  let userList = user.filter((e) => !validateEntry(e).length).map((e) => ({ ...e, origin: 'user' }));
  const all = () => [...baseList, ...userList];
  return {
    list: all,
    get: (id) => all().find((e) => e.id === id) ?? null,
    add(entry) {
      const errs = validateEntry(entry);
      if (errs.length) throw new Error(errs.join(', '));
      if (baseList.some((e) => e.id === entry.id)) throw new Error('공용 DB 와 같은 id');
      userList = [...userList.filter((e) => e.id !== entry.id), { ...entry, origin: 'user' }];
      save(userList.map(strip));
    },
    remove(id) {
      if (!userList.some((e) => e.id === id)) return false;
      userList = userList.filter((e) => e.id !== id);
      save(userList.map(strip));
      return true;
    },
    exportJson: (which = 'all') => JSON.stringify({ version: DB_VERSION, entries: (which === 'user' ? userList : all()).map(strip) }, null, 1),
    importJson(text) {
      const d = JSON.parse(text), added = [], rejected = [];
      for (const e of d.entries ?? []) {
        if (baseList.some((b) => b.id === e.id)) { rejected.push(`${e.id}: 공용 DB 와 중복`); continue; }
        const errs = validateEntry(e);
        if (errs.length) { rejected.push(`${e.id ?? '?'}: ${errs.join(', ')}`); continue; }
        userList = [...userList.filter((u) => u.id !== e.id), { ...e, origin: 'user' }];
        added.push(e.id);
      }
      save(userList.map(strip));
      return { added, rejected };
    },
  };
}

const strip = ({ origin, ...e }) => e;

export function newId(name) {
  return `${String(name || 'mat').trim().replace(/[^\w가-힣-]+/g, '_').slice(0, 24)}_${Date.now().toString(36)}`;
}
