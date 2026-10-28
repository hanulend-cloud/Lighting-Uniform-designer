// 측정 txt 파장 가중 설정 — 'V' = 눈 감도 V(λ) 만 · 'led' = V(λ) × LED 스펙트럼(그 LED 빛으로 본 밝기 기준).
// LED 스펙트럼 = 기본(일반 백색 LED 예시: 청색 칩 450 nm + 형광체 560 nm) 또는 사용자가 불러온 txt(파장 nm, 상대 세기). 브라우저 저장(모든 프로젝트 공용)
import { parseNumericTable } from '../engine/meas-txt.js';

export const WGT_KEY = 'uds.measWeight.v1';
// 일반 백색 LED(예시, 약 5000 K) — 380~780 nm 5 nm 간격, 최대 1
export const DEFAULT_LED_SPD = (() => {
  const g = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2), out = [];
  for (let nm = 380; nm <= 780; nm += 5) out.push({ nm, v: g(nm, 450, 10) + 0.62 * g(nm, 565, 55) });
  const mx = Math.max(...out.map((p) => p.v));
  return out.map((p) => ({ nm: p.nm, v: Math.round((p.v / mx) * 1e4) / 1e4 }));
})();
export const DEFAULT_LED_NAME = '일반 백색 LED (예시)';

// LED 스펙트럼 txt(순수) → { spd: [{nm, v}] (최대 1), name } | 오류
export function spdFromTxt(text, name = 'LED 스펙트럼') {
  const { rows } = parseNumericTable(text), pts = rows.filter((r) => r[0] >= 250 && r[0] <= 2500 && Number.isFinite(r[1])).map((r) => ({ nm: r[0], v: Math.max(0, r[1]) }));
  if (pts.length < 5) throw new Error('파장(nm), 세기 두 열이 5줄 이상 필요');
  const mx = Math.max(...pts.map((p) => p.v));
  if (!(mx > 0)) throw new Error('세기가 모두 0');
  return { spd: pts.sort((a, b) => a.nm - b.nm).map((p) => ({ nm: p.nm, v: p.v / mx })), name };
}
// 지금 설정 — { mode, spd(LED 모드일 때 가중에 씀), name }
export function loadWeighting() {
  try {
    const v = JSON.parse(localStorage.getItem(WGT_KEY) || 'null');
    if (v && (v.mode === 'V' || v.mode === 'led')) return { mode: v.mode, spd: Array.isArray(v.spd) && v.spd.length >= 5 ? v.spd : DEFAULT_LED_SPD, name: v.name || DEFAULT_LED_NAME, custom: Array.isArray(v.spd) };
  } catch {}
  return { mode: 'V', spd: DEFAULT_LED_SPD, name: DEFAULT_LED_NAME, custom: false };
}
export function saveWeighting(w) { try { localStorage.setItem(WGT_KEY, JSON.stringify({ mode: w.mode, ...(w.custom ? { spd: w.spd, name: w.name } : {}) })); } catch {} }
// readMeasTxt 에 넘길 가중 스펙트럼(V 만이면 null)
export const weightSpd = (w = loadWeighting()) => (w.mode === 'led' ? w.spd : null);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// 가중 고르기 줄(순수 HTML) — 측정값 양식·BSDF 창에 붙임
export function weightHtml(w = loadWeighting()) {
  return `<div class="m3-row m3-wgt" data-wgt><label title="파장별 측정값을 한 값으로 줄이는 기준">파장 가중</label><select data-wgt-mode aria-label="파장 가중">
      <option value="V"${w.mode === 'V' ? ' selected' : ''}>눈 감도 V(λ)</option><option value="led"${w.mode === 'led' ? ' selected' : ''}>V(λ) × LED 스펙트럼</option></select>
    ${w.mode === 'led' ? `<span class="mut" title="이 LED 빛으로 본 밝기 기준">${esc(w.name)}</span><label class="m3-file" title="LED 스펙트럼 txt(파장 nm, 상대 세기)">LED 스펙트럼 txt<input type="file" accept=".txt,.csv,.dat" data-wgt-spd hidden></label>${w.custom ? '<button type="button" class="m3-link" data-wgt-def>기본으로</button>' : ''}` : ''}</div>`;
}
// 가중 줄 배선(DOM) — 바뀌면 저장하고 그 줄만 다시 그림. onMsg(text) = 알림
export function wireWeight(root, onMsg = () => {}) {
  const box = root.querySelector('[data-wgt]'); if (!box) return;
  const redraw = (w) => { saveWeighting(w); box.outerHTML = weightHtml(w); wireWeight(root, onMsg); };
  box.querySelector('[data-wgt-mode]').onchange = (e) => { const w = loadWeighting(); w.mode = e.target.value; redraw(w); onMsg(w.mode === 'led' ? `파장 가중: V(λ) × ${w.name} — 다음에 불러오는 파장별 txt 부터` : '파장 가중: 눈 감도 V(λ)'); };
  const f = box.querySelector('[data-wgt-spd]');
  if (f) f.onchange = async () => {
    const file = f.files?.[0]; f.value = ''; if (!file) return;
    try { const r = spdFromTxt(await file.text(), file.name); redraw({ mode: 'led', spd: r.spd, name: r.name, custom: true }); onMsg(`LED 스펙트럼 "${r.name}" (${r.spd.length}점) — 다음에 불러오는 파장별 txt 부터`); } catch (e) { onMsg(`LED 스펙트럼 읽기 실패: ${e.message}`); }
  };
  const d = box.querySelector('[data-wgt-def]');
  if (d) d.onclick = () => { redraw({ mode: 'led', spd: DEFAULT_LED_SPD, name: DEFAULT_LED_NAME, custom: false }); onMsg(`LED 스펙트럼: ${DEFAULT_LED_NAME}`); };
}
