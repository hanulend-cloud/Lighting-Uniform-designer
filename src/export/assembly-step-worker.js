// 3D 기구 전체 → STEP Worker(파일 메뉴 '3D 기구 STEP 내보내기') — 부품 메쉬(수정 반영)를 부품마다 솔리드로 꿰매 한 파일로
import { loadOc } from '../engine/shape/oc-loader.js';
import { meshesToStepText } from './mesh-step.js';

self.onmessage = async (ev) => {
  try {
    const oc = await loadOc();
    self.postMessage({ type: 'done', stepText: meshesToStepText(oc, ev.data.meshes) });
  } catch (e) { self.postMessage({ type: 'error', message: e.message ?? String(e) }); }
};
