// L2 테스트 공용: 저장소 테이블·기준 로드
import fs from 'node:fs';
import { createTable } from '../src/engine/l2/slab-table.js';

import { pathToFileURL } from 'node:url';
// L2_TABLE_DIR 로 다른 테이블(예: --quick 빌드) 지정 가능 — 개발 중 코드 경로 점검용
const dir = process.env.L2_TABLE_DIR ? pathToFileURL(process.env.L2_TABLE_DIR.replace(/[\/]?$/, '/'))
  : new URL('../src/engine/l2/data/', import.meta.url);
export function loadTable() {
  const meta = JSON.parse(fs.readFileSync(new URL('slab-meta.json', dir)));
  const buf = fs.readFileSync(new URL('slab-table.bin', dir));
  return createTable(meta, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}
export function loadRefAD() { return JSON.parse(fs.readFileSync(new URL('../src/engine/l2/data/ref-ad.json', import.meta.url))); }
// runtime.initL2 용 Node 로더
export function nodeLoader() {
  return async () => {
    const meta = JSON.parse(fs.readFileSync(new URL('slab-meta.json', dir)));
    const buf = fs.readFileSync(new URL('slab-table.bin', dir));
    return { meta, data: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), refAD: loadRefAD() };
  };
}
