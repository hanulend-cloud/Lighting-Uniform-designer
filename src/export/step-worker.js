// STEP 내보내기 전용 Web Worker — 무거운 OpenCASCADE 연산이 메인 UI를 멈추지 않게 분리.
// module worker(new Worker(url, {type:'module'})로 기동해야 함 — opencascade.full.js가
// `export default Module;`로 끝나는 ES 모듈이라 classic worker의 importScripts()로는 로드
// 자체가 SyntaxError로 실패함을 실제 파일을 받아 확인함.

import { buildStepForSpec } from './step-export.js';

import { loadOc } from '../engine/shape/oc-loader.js';

self.onmessage = async (ev) => {
  try {
    const { spec, combo, geom, active } = ev.data;
    const oc = await loadOc();
    const onProgress = (done, total, label) => self.postMessage({ type: 'progress', done, total, label });
    const r = buildStepForSpec(oc, spec, combo, geom, onProgress, active);
    self.postMessage({ type: 'done', stepText: r.stepText, solidCount: r.solidCount });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message ?? String(e) });
  }
};
