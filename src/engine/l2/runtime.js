// L2 solver 런타임 — 응답 테이블을 한 번 로드·자체검증(validateTable)해 보관한다 (spec §5.5).
// 브라우저: main.js 가 시작 시 await initL2(browserLoader()). Node 테스트: initL2(nodeLoader()).
// 테이블이 없거나 검증 실패면 L2 결과는 "신뢰 불가"로 표시된다 — 옛 근사식으로 조용히 대체하지 않는다.
import { createTable } from './slab-table.js';
import { validateTable } from './validator.js';

let state = { table: null, check: null, error: 'L2 테이블 미로드' };

// loader(): Promise<{ meta, data: Float32Array, refAD }>
export async function initL2(loader) {
  try {
    const { meta, data, refAD } = await loader();
    const table = createTable(meta, data);
    state = { table, check: validateTable(table, refAD), error: null };
  } catch (e) {
    state = { table: null, check: null, error: `L2 테이블 로드 실패: ${e.message ?? e}` };
  }
  return state;
}

export function l2State() { return state; }

export function browserLoader(base = './src/engine/l2/data/') {
  return async () => {
    const get = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`${f} ${r.status}`); return r; };
    const [meta, bin, refAD] = await Promise.all([
      get('slab-meta.json').then((r) => r.json()),
      get('slab-table.bin').then((r) => r.arrayBuffer()),
      get('ref-ad.json').then((r) => r.json()),
    ]);
    return { meta, data: new Float32Array(bin), refAD };
  };
}

// 실측소재 DB(src/model/materials-db.js createDb 결과) — main.js 가 시작 시 주입. L2 소재 선택이 여기서 조회된다.
let materialDbRef = null;
export function setMaterialDb(db) { materialDbRef = db; }
export function materialDb() { return materialDbRef; }
