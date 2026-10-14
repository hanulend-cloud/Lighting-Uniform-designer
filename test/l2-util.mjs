// L2 테스트 공용: 저장소 테이블·기준 로드
import fs from 'node:fs';
import { createTable } from '../src/engine/l2/slab-table.js';

import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { unpackTable, TABLE_ENCODING } from '../src/engine/l2/table-codec.js';
// 표 데이터: 압축(meta.encoding, slab-table.f32z) 또는 원시 Float32(slab-table.bin)
function readData(meta) {
  if (meta.encoding === TABLE_ENCODING) return unpackTable(new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL('slab-table.f32z', dir)))));
  const buf = fs.readFileSync(new URL('slab-table.bin', dir));
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
// L2_TABLE_DIR 로 다른 테이블(예: --quick 빌드) 지정 가능 — 개발 중 코드 경로 점검용
const dir = process.env.L2_TABLE_DIR ? pathToFileURL(process.env.L2_TABLE_DIR.replace(/[\/]?$/, '/'))
  : new URL('../src/engine/l2/data/', import.meta.url);
export function loadTable() {
  const meta = JSON.parse(fs.readFileSync(new URL('slab-meta.json', dir)));
  return createTable(meta, readData(meta));
}
export function loadRefAD() { return JSON.parse(fs.readFileSync(new URL('../src/engine/l2/data/ref-ad.json', import.meta.url))); }
// runtime.initL2 용 Node 로더
export function nodeLoader() {
  return async () => {
    const meta = JSON.parse(fs.readFileSync(new URL('slab-meta.json', dir)));
    return { meta, data: readData(meta), refAD: loadRefAD() };
  };
}
