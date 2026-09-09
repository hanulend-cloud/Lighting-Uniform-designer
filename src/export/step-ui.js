// STEP 내보내기 — 메인 스레드 오케스트레이터. spec/combo/geom(main.js run()이 이미 계산한
// 것과 동일한 소스)을 받아 워커를 기동하고, 진행률 오버레이·확인 다이얼로그·다운로드를 맡는다.

import { estimateL5BumpCount } from './step-export.js';

const BUMP_WARN_THRESHOLD = 2000;

function overlay(text) {
  let el = document.getElementById('step-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'step-overlay';
    el.className = 'step-overlay';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  return el;
}
function hideOverlay() {
  const el = document.getElementById('step-overlay');
  if (el) el.hidden = true;
}

export function exportStep(spec, combo, geom, active) {
  const bumpCount = estimateL5BumpCount(spec, active);
  if (bumpCount > BUMP_WARN_THRESHOLD) {
    const ok = confirm(`돌기 ${bumpCount}개 — 계산에 시간이 오래 걸리거나 브라우저가 느려질 수 있습니다. 계속하시겠습니까?`);
    if (!ok) return;
  }

  const btn = document.getElementById('btn-step');
  if (btn) btn.disabled = true;   // 진행 중 재클릭(특히 키보드 Enter/Space) 방지 — 동시 워커 방지

  // module worker — step-worker.js가 opencascade.full.js(export default 로 끝나는 ES 모듈)를
  // import 하므로 classic worker(기본값)로는 로드가 안 됨.
  const worker = new Worker(new URL('./step-worker.js', import.meta.url), { type: 'module' });
  const el = overlay('STEP 생성 중…');

  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === 'progress') {
      el.textContent = `STEP 생성 중… (${msg.label} ${msg.done}/${msg.total})`;
    } else if (msg.type === 'done') {
      hideOverlay();
      if (btn) btn.disabled = false;
      const blob = new Blob([msg.stepText], { type: 'application/step' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fixture.stp';
      a.click();
      URL.revokeObjectURL(a.href);
      worker.terminate();
    } else if (msg.type === 'error') {
      hideOverlay();
      if (btn) btn.disabled = false;
      alert('STEP 생성 실패: ' + msg.message);
      console.error('STEP export failed:', msg.message);
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    hideOverlay();
    if (btn) btn.disabled = false;
    alert('STEP 생성 실패: ' + e.message);
    worker.terminate();
  };

  // structuredClone 불가 필드(함수 등)가 없는 순수 데이터만 전달.
  worker.postMessage({
    spec: JSON.parse(JSON.stringify(spec)),
    combo: { depth: combo.depth, pitchX: combo.pitchX, pitchY: combo.pitchY, padX: combo.padX, padY: combo.padY },
    geom: { leds: geom.leds, ledSize: geom.ledSize, l4HalfP: geom.l4HalfP, tags: geom.levelText.split(' + ').filter((t) => /^L\d$/.test(t)) },
  });
}
