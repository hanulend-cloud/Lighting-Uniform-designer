// 3D 기구 STEP 불러오기 Worker — 입력 { text } → 진행 { stage } → 결과 { parts, prep: { parts(BVH 포함), combined, bvh, contacts } } | { error }
// 입력 { prep: 부품 메쉬 } = 복원용 장면 준비만 → { prep }
import { loadOc } from '../shape/oc-loader.js';
import { readStepParts } from '../shape/step-import.js';
import { prepScene, prepTransfer } from './scene-prep.js';

self.onmessage = async (ev) => {
  try {
    if (ev.data.prep) {   // 복원: 저장된 부품 메쉬 → BVH·합친 메쉬(접촉면은 저장된 설정에 있음)
      const r = prepScene(ev.data.prep);
      self.postMessage({ prep: r }, prepTransfer(r));
      return;
    }
    self.postMessage({ stage: 'OpenCASCADE 로드 중(첫 회 수십 초)…' });
    const oc = await loadOc();
    self.postMessage({ stage: 'STEP 해석·부품 메시 생성 중…' });
    const parts = readStepParts(oc, ev.data.text);
    const nT = parts.reduce((s, p) => s + p.triangles.length / 3, 0);
    self.postMessage({ stage: `부품 ${parts.length}개 · 삼각형 ${Math.round(nT / 1000)}천 개 — 충돌 검사 구조·접촉면 계산 중…` });
    const r = prepScene(parts, { contacts: true });   // 무거운 준비는 여기서(화면 스레드 멈춤 방지)
    self.postMessage({ parts: r.parts, prep: r }, prepTransfer(r));
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
