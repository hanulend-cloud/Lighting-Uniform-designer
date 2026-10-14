// STEP 불러오기 전용 Web Worker — OpenCASCADE(≈58MB wasm, CDN)를 메인 UI 밖에서 로드·실행.
// 입력 { name, text } → 진행 { stage } → 결과 { mesh(positions, triangles), solidCount, volume, droppedVolumes } | { error }
import { readStepMesh } from './step-import.js';

import { loadOc } from './oc-loader.js';
self.onmessage = async (ev) => {
  try {
    self.postMessage({ stage: 'OpenCASCADE 로드 중(첫 회 수십 초)…' });
    const oc = await loadOc();
    self.postMessage({ stage: 'STEP 해석·메시 생성 중…' });
    const r = readStepMesh(oc, ev.data.text);
    self.postMessage({ result: r }, [r.positions.buffer, r.triangles.buffer]);
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
