// 상태 띠 — 설계 점검 배지 4개(클릭 → 3D 표식 강조) · 알림 문구. 계산 진행(신뢰도·광자)은 '광분포 시뮬레이션' 카드·명령줄 4단계에만(2026-10-29: 두 곳에 있어 헷갈림)
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// 색만으로 상태를 전하지 않는다: 상태 단어(스크린리더) + 작은 기호
export const STATUS_WORD = { ok: '양호', warn: '경고', bad: '불량', na: '미계산' };
export const STATUS_ICON = { ok: '✓', warn: '!', bad: '✕', na: '–' };
export const statusWord = (st) => STATUS_WORD[st] ?? STATUS_WORD.na;
export const statusIcon = (st) => STATUS_ICON[st] ?? STATUS_ICON.na;
export const checkAria = (x) => `${x.text} — ${statusWord(x.st)}`;
// Enter/Space 로 버튼처럼 활성화
export const isActivateKey = (e) => e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';

// 표시 반올림은 판정 쪽으로: 도달률·살두께(클수록 좋음)는 내림, 새는 빛(작을수록 좋음)은 올림
// C = { interference, reach, wall, leak } (checks.js 결과) → [{ id, st, text }]
export function checkLabels(C) {
  const I = C.interference, R = C.reach, W = C.wall, K = C.leak, na = (x) => !x || x.status === 'na';
  return [
    { id: 'interference', st: I?.status ?? 'na', text: na(I) ? 'LED–부품 간섭 –' : I.status === 'warn' ? `LED 포팅(투과 부품 안) ${I.count}건` : I.count ? `LED–부품 간섭 ${I.count}건` : 'LED–부품 간섭 없음' },
    { id: 'reach', st: R?.status ?? 'na', text: na(R) ? 'LED–커버 –' : R.minDist != null ? `LED–커버 ${R.minDist.toFixed(1)} mm · 도달 ${Math.floor(R.minReach * 100 + 1e-9)}%` : 'LED–커버 가림' },
    { id: 'wall', st: W?.status ?? 'na', text: na(W) ? '살두께 –' : `살두께 ${(Math.floor(W.min * 100 + 1e-9) / 100).toFixed(2)} mm` },
    { id: 'leak', st: K?.status ?? 'na', text: na(K) ? '새는 빛 –' : `새는 빛 ${Math.ceil(K.ratio * 100 - 1e-9)}%` },
  ];
}

// 띠는 1초마다 다시 그려지므로 뼈대를 한 번만 만들고 값이 바뀐 곳만 고친다(눌렀다 뗄 때 노드가 살아 있도록).
// 클릭/키 이벤트는 컨테이너에 한 번만 위임하고 핸들러는 최신 것을 참조한다.
const STATE_BY_EL = new WeakMap();
const setText = (n, v) => { if (n.textContent !== v) n.textContent = v; };
const setAttr = (n, k, v) => { if (n.getAttribute(k) !== v) n.setAttribute(k, v); };
const IDS = ['interference', 'reach', 'wall', 'leak'];
function init(el) {
  el.innerHTML = `<span class="mut m3-chkok" data-s="ok">✓ 설계 점검 이상 없음</span>
    ${IDS.map((id) => `<span class="m3-chk" role="button" tabindex="0" data-chk="${id}"><span class="m3-dot na"></span><span class="m3-ico" aria-hidden="true"></span><span data-t></span></span>`).join('')}
    <span class="m3-stxt" data-s="txt" hidden></span>`;
  const S = {
    h: null, txt: el.querySelector('[data-s="txt"]'),
    chk: Object.fromEntries(IDS.map((id) => { const n = el.querySelector(`[data-chk="${id}"]`); return [id, { n, dot: n.querySelector('.m3-dot'), ico: n.querySelector('.m3-ico'), t: n.querySelector('[data-t]') }]; })),
  };
  const fire = (e) => { const n = e.target.closest?.('[data-chk]'); if (n && el.contains(n)) S.h?.onCheck?.(n.dataset.chk); };
  el.addEventListener('click', fire);
  el.addEventListener('keydown', (e) => { if (!isActivateKey(e) || !e.target.closest?.('[data-chk]')) return; e.preventDefault(); fire(e); });
  STATE_BY_EL.set(el, S);
  return S;
}
// d = { calc(snapshot), targetNoise, checks, focus, text }, h = { onCheck(id) }
export function renderStatusBar(el, d, h) {
  const S = STATE_BY_EL.get(el) ?? init(el);
  S.h = h;
  for (const x of checkLabels(d.checks ?? {})) {
    const o = S.chk[x.id], on = d.focus === x.id, cls = `m3-chk${on ? ' on' : ''}`, show = x.st === 'warn' || x.st === 'bad';   // 문제일 때만 배지
    if (o.n.hidden !== !show) o.n.hidden = !show;
    if (o.n.className !== cls) o.n.className = cls;
    const dc = `m3-dot ${x.st}`;
    if (o.dot.className !== dc) o.dot.className = dc;
    setText(o.ico, statusIcon(x.st)); setText(o.t, x.text);
    setAttr(o.n, 'aria-label', checkAria(x)); setAttr(o.n, 'aria-pressed', on ? 'true' : 'false');
  }
  const anyBad = checkLabels(d.checks ?? {}).some((x) => x.st === 'warn' || x.st === 'bad'), okN = S.ok ?? (S.ok = el.querySelector('[data-s="ok"]'));
  if (okN && okN.hidden !== anyBad) okN.hidden = anyBad;
  const tx = d.text ? String(d.text) : '';
  setText(S.txt, tx);
  if (S.txt.hidden !== !tx) S.txt.hidden = !tx;
}
