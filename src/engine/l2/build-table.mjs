// L2 슬래브 응답 테이블 생성 (spec 2026-10-07 §5.2) — 오프라인 1회, 결과는 저장소에 커밋.
// 사용: node src/engine/l2/build-table.mjs [--quick] [--out <dir>]
//   --quick: 광자 수 축소(빌드 경로 점검용, 정확도 기준 미달) / 기본 출력: src/engine/l2/data/
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSlab } from './mc-slab.js';
import { packRecord, REC, SW_HI } from './slab-table.js';

const COS85 = Math.cos(85 * Math.PI / 180);
export const GRIDS = {
  tauR: [0, ...Array.from({ length: 31 }, (_, i) => 0.01 * Math.pow(SW_HI / 0.01, i / 30))],
  g: [0.6, 0.8, 0.9, 0.95],
  n: [1.49, 1.59, 1.70],
  rows: [...Array.from({ length: 9 }, (_, k) => 1 - k * (1 - COS85) / 8), 'diffuse'],
};

function photons(tauR, quick) {
  const base = quick ? 4000 : 200000, min = quick ? 500 : 10000;
  return Math.round(Math.min(base, Math.max(min, base / (1 + tauR))));
}

if (!isMainThread) {
  const { jobs, quick } = workerData;
  for (const j of jobs) {
    const rec = runSlab({ tau: j.tauR / (1 - j.g), g: j.g, n: j.n, inc: j.inc, N: photons(j.tauR, quick), seed: j.idx + 1 });
    const buf = packRecord(rec);
    parentPort.postMessage({ idx: j.idx, buf }, [buf.buffer]);
  }
} else {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const oi = args.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(here, 'data');
  const G = GRIDS, jobs = [];
  let idx = 0;
  for (const tauR of G.tauR) for (const g of G.g) for (const n of G.n) for (const inc of G.rows)
    jobs.push({ idx: idx++, tauR, g, n, inc });
  // 무거운 셀(고 τ')이 한 워커에 몰리지 않도록 라운드로빈 분배
  const nW = Math.max(1, os.cpus().length), buckets = Array.from({ length: nW }, () => []);
  jobs.forEach((j, i) => buckets[i % nW].push(j));
  const data = new Float32Array(jobs.length * REC);
  let done = 0; const t0 = Date.now();
  await Promise.all(buckets.map((b) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: b, quick } });
    w.on('message', (m) => {
      data.set(m.buf, m.idx * REC);
      if (++done % 200 === 0) console.log(`${done}/${jobs.length} cells, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    });
    w.on('error', rej); w.on('exit', res);
  })));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'slab-table.bin'), Buffer.from(data.buffer));
  const meta = { version: 1, rec: REC, grids: G, quick, cells: jobs.length, seconds: Math.round((Date.now() - t0) / 1000), created: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'slab-meta.json'), JSON.stringify(meta, null, 1));
  console.log(`wrote ${outDir} — ${jobs.length} cells in ${meta.seconds}s`);
}
