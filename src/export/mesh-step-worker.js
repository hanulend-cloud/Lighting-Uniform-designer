// 메쉬 → STEP Worker (module worker — step-worker.js 와 같은 이유로 type:'module')
// 입력에 spline 이 있으면 B-스플라인 곡면 솔리드, 실패하면 메쉬 꿰매기 + note
import { loadOc } from '../engine/shape/oc-loader.js';
import { partStepText } from './spline-step.js';

self.onmessage = async (ev) => {
  try {
    const oc = await loadOc(), { mesh, spline } = ev.data, r = partStepText(oc, { mesh, spline });
    self.postMessage({ type: 'done', stepText: r.stepText, note: r.note, error: r.error });
  } catch (e) { self.postMessage({ type: 'error', message: e.message ?? String(e) }); }
};
