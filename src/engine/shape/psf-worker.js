// PSF 병렬 추적 보조 Worker — psf-pool.js 의 작업 묶음을 공유 카운터로 나눠 처리(브라우저 Worker · Node worker_threads 공용)
import { handlePoolMessage } from './psf-pool.js';

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof WorkerGlobalScope !== 'undefined') {
  // 브라우저: 메인 페이지가 만든 Worker 에 계산 Worker 와 연결된 MessagePort 를 넘겨준다(중첩 Worker 는 부모가 Atomics.wait 로
  // 막혀 있는 동안 메시지를 못 받아 풀이 놀았다 — 실측 호출 측 320/320). 포트로 오는 작업 묶음을 처리.
  self.onmessage = (e) => {
    if (e.data?.type === 'port') e.data.port.onmessage = (m) => handlePoolMessage(m.data);
    else handlePoolMessage(e.data);
  };
} else {
  const { parentPort } = await import('node:worker_threads');
  parentPort.on('message', handlePoolMessage);
}
