// 상태 띠 — spec 2026-10-15 m3-cad-ui §2: 신뢰도(잡음 ±%, 진행 막대) · 광자 수 · 계산 상태 · 설계 점검 배지 4개(클릭 → 3D 표식 강조) · 알림 문구
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const STATE = { idle: '대기', pending: '변경 감지…', starting: '장면 준비…', running: '계산 중', paused: '일시정지', error: '오류' };

// 표시 반올림은 판정 쪽으로: 도달률·살두께(클수록 좋음)는 내림, 새는 빛(작을수록 좋음)은 올림
// C = { interference, reach, wall, leak } (checks.js 결과) → [{ id, st, text }]
export function checkLabels(C) {
  const I = C.interference, R = C.reach, W = C.wall, K = C.leak, na = (x) => !x || x.status === 'na';
  return [
    { id: 'interference', st: I?.status ?? 'na', text: na(I) ? 'LED–부품 간섭 –' : I.count ? `LED–부품 간섭 ${I.count}건` : 'LED–부품 간섭 없음' },
    { id: 'reach', st: R?.status ?? 'na', text: na(R) ? 'LED–커버 –' : `LED–커버 ${R.minDist != null ? `${R.minDist.toFixed(1)} mm` : '가림'} · 도달 ${Math.floor(R.minReach * 100 + 1e-9)}%` },
    { id: 'wall', st: W?.status ?? 'na', text: na(W) ? '살두께 –' : `살두께 ${(Math.floor(W.min * 100 + 1e-9) / 100).toFixed(2)} mm` },
    { id: 'leak', st: K?.status ?? 'na', text: na(K) ? '새는 빛 –' : `새는 빛 ${Math.ceil(K.ratio * 100 - 1e-9)}%` },
  ];
}
// d = { calc(snapshot), targetNoise, checks, focus, text }, h = { onCheck(id) }
export function renderStatusBar(el, d, h) {
  const c = d.calc, rn = c?.stats?.relNoise, st = c?.state ?? 'idle';
  const prog = Number.isFinite(rn) && rn > 0 ? Math.min(1, d.targetNoise / rn) : 0;
  const stTxt = st === 'done' ? (c.reason === 'converged' ? '수렴 — 멈춤' : '최대 광자 — 멈춤') : STATE[st] ?? st;
  el.innerHTML = `<span class="m3-rel">신뢰도 <span class="m3-barw"><span class="m3-barf" style="width:${(prog * 100).toFixed(0)}%"></span></span>
      <b>${Number.isFinite(rn) ? `±${(rn * 100).toFixed(1)}%` : '–'}</b>
      <span class="mut">목표 ±${(d.targetNoise * 100).toFixed(1)}% · 광자 ${(c?.photons ?? 0).toLocaleString()} · ${esc(stTxt)}</span></span>
    <span class="mut">설계 점검</span>
    ${checkLabels(d.checks ?? {}).map((x) => `<span class="m3-chk ${d.focus === x.id ? 'on' : ''}" data-chk="${x.id}"><span class="m3-dot ${x.st}"></span>${esc(x.text)}</span>`).join('')}
    ${d.text ? `<span class="m3-stxt">${esc(d.text)}</span>` : ''}`;
  el.querySelectorAll('[data-chk]').forEach((x) => { x.onclick = () => h.onCheck(x.dataset.chk); });
}
