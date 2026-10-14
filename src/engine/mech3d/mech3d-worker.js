// 3D 기구 STEP 불러오기 Worker — 입력 { text } → 진행 { stage } → 결과 { parts: [{ positions, triangles, faceIds, faceCount, volume }] } | { error }
import { loadOc } from '../shape/oc-loader.js';
import { readStepParts } from '../shape/step-import.js';

self.onmessage = async (ev) => {
  try {
    self.postMessage({ stage: 'OpenCASCADE 로드 중(첫 회 수십 초)…' });
    const oc = await loadOc();
    self.postMessage({ stage: 'STEP 해석·부품 메시 생성 중…' });
    const parts = readStepParts(oc, ev.data.text);
    const transfer = parts.flatMap((p) => [p.positions.buffer, p.triangles.buffer, p.faceIds.buffer]);
    self.postMessage({ parts }, transfer);
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
