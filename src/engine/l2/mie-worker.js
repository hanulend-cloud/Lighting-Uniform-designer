// 브라우저 Web Worker — 입자(Mie) 소재 피팅은 수십 초~수 분 걸려 UI 를 멈추지 않도록 여기서 돈다.
// 입력 { meta, data(주 응답표), entry } → 진행 { progress } … → 결과 { result } | { error }
import { createTable } from './slab-table.js';
import { fitEntry } from './material-fit.js';

self.onmessage = (ev) => {
  try {
    const { meta, data, entry } = ev.data;
    const table = createTable(meta, data);
    const result = fitEntry(table, entry, { onProgress: (p) => self.postMessage({ progress: p }) });
    self.postMessage({ result });
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
