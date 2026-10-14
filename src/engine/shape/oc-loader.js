// OpenCASCADE.js(≈58MB wasm, CDN) 로더 — Worker 공용. 실패하면 다음 호출에서 다시 시도한다.
export const OC_VERSION = '2.0.0-beta.b5ff984';
const OC_BASE = `https://cdn.jsdelivr.net/npm/opencascade.js@${OC_VERSION}/dist/`;
let ocPromise = null;
export function loadOc() {
  if (!ocPromise) {
    ocPromise = import(/* webpackIgnore: true */ OC_BASE + 'opencascade.full.js').then((mod) =>
      mod.default({ locateFile: (p) => (p.endsWith('.wasm') ? OC_BASE + 'opencascade.full.wasm' : p) })
    ).catch((e) => { ocPromise = null; throw e; });
  }
  return ocPromise;
}
