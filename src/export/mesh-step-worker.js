// 메쉬 → STEP Worker (module worker — step-worker.js 와 같은 이유로 type:'module')
import { loadOc } from '../engine/shape/oc-loader.js';
import { meshToStepText } from './mesh-step.js';

self.onmessage = async (ev) => {
  try {
    const oc = await loadOc();
    self.postMessage({ type: 'done', stepText: meshToStepText(oc, ev.data.mesh) });
  } catch (e) { self.postMessage({ type: 'error', message: e.message ?? String(e) }); }
};
