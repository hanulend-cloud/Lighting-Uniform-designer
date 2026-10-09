// STEP 불러오기 전용 Web Worker — OpenCASCADE(≈58MB wasm, CDN)를 메인 UI 밖에서 로드·실행.
// 입력 { name, text } → 진행 { stage } → 결과 { mesh(positions, triangles), solidCount, volume, droppedVolumes } | { error }
import { readStepMesh } from './step-import.js';

const OC_VERSION = '2.0.0-beta.b5ff984';
const OC_BASE = `https://cdn.jsdelivr.net/npm/opencascade.js@${OC_VERSION}/dist/`;
let ocPromise = null;
function loadOc() {
  if (!ocPromise) {
    ocPromise = import(/* webpackIgnore: true */ OC_BASE + 'opencascade.full.js').then((mod) =>
      mod.default({ locateFile: (p) => (p.endsWith('.wasm') ? OC_BASE + 'opencascade.full.wasm' : p) })
    ).catch((e) => { ocPromise = null; throw e; });
  }
  return ocPromise;
}

self.onmessage = async (ev) => {
  try {
    self.postMessage({ stage: 'OpenCASCADE 로드 중(첫 회 수십 초)…' });
    const oc = await loadOc();
    self.postMessage({ stage: 'STEP 해석·메시 생성 중…' });
    const r = readStepMesh(oc, ev.data.text);
    self.postMessage({ result: r }, [r.positions.buffer, r.triangles.buffer]);
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
