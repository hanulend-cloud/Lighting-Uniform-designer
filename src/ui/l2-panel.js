// L2 카드 하단 패널 — spec 2026-10-07 §5.5·§5.6·§6.3·§6.4·§7.
// ① 배지 2종: "계산 정합성"(V 검사 — 물리식대로 계산됐는가) ≠ "실물 보정"(실제 제품과 맞는가)
// ② 소재 선택(추상 Milky / 실측소재 DB) + Milky 눈금 막대(DB 소재 마커 ▼, 현재 값 ●)
// ③ 물성 한 줄 ④ 경고 ⑤ "상세 property ▸" 고급메뉴(접힘) ⑥ 가정 패널(접힘)
// 골격은 한 번만 만들고 재계산마다 동적 영역만 갱신한다(펼침 상태·입력 중인 폼 유지).
import { renderAdvanced } from './l2-advanced.js';
import { milkyOf, STATUS } from '../model/materials-db.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ctx = { table, db, materialId, onSelectMaterial(id), onDbChanged() }
export function renderL2Panel(el, desc, tMin, ctx) {
  if (!el) return;
  if (el.dataset.built !== '1') {
    el.dataset.built = '1';
    el.innerHTML = `<div data-l2-main></div>
      <details class="l2-adv"><summary>상세 property ▸</summary><div data-l2-adv></div></details>
      <details class="l2-assume"><summary>가정·한계 (계산 모델)</summary><div data-l2-assume></div></details>`;
    el.addEventListener('change', (ev) => {
      if (ev.target.matches('[data-l2-mat]')) el._ctx?.onSelectMaterial(ev.target.value);
    });
  }
  el._ctx = ctx;
  const main = el.querySelector('[data-l2-main]');
  if (!desc || desc.error) {
    main.innerHTML = `<div class="l2-badges"><span class="l2-badge ng" title="${esc(desc?.error ?? '')}">계산 정합성 ❌ ${esc(desc?.error ?? 'L2 solver 없음')}</span></div>`;
    return;
  }
  const { check, info, warnings } = desc;
  const vList = check.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.id} ${typeof c.value === 'number' ? c.value.toPrecision(3) : ''} (한도 ${c.limit}) ${c.note ?? ''}`).join('\n');
  const okTip = '계산 정합성 = 산란 응답표가 독립 기준해(adding-doubling)·해석해와 일치하고 에너지가 보존되는지 자동 점검한 결과입니다.\n'
    + '실제 제품과의 일치를 보장하지 않습니다(→ 실물 보정 배지).\n\n' + vList;
  const m = info.material;
  const cal = m ? (m.V6?.ok ? { cls: 'ok', txt: `실물 보정: 소재 보정됨 (${STATUS[m.status] ?? ''})`, tip: `${m.name} — 측정 재현(V6) 통과${m.V9 ? `, 교차두께(V9) ${m.V9.ok ? '통과' : '불일치'}` : ''}.\n시스템(캐비티·LED 배치) 실측 대조는 아직 없음.` }
    : { cls: 'ng', txt: '실물 보정: 보정 불일치', tip: `${m.name} — 측정 재현(V6) 실패: ${m.V6?.note ?? ''}` })
    : { cls: 'warn', txt: '실물 보정: 미보정', tip: '추상 Milky(g=0.9 가정) 사용 중 — 실측 소재를 선택하면 소재 단위로 보정됩니다.\nLightTools·Speos 시스템 대조 이력 없음.' };
  const opaque = info.milky >= 9.95, lowT = info.trans < tMin;
  const list = ctx.db?.list() ?? [];
  const opts = [`<option value="">추상 Milky (슬라이더)</option>`, ...list.map((e) => `<option value="${esc(e.id)}"${e.id === ctx.materialId ? ' selected' : ''}>${esc(e.name)} · Milky ${milkyOf(ctx.table, e).toFixed(1)} · ${STATUS[e.status]}${e.validation?.V6?.ok ? '' : ' ⚠'}</option>`)];
  main.innerHTML = `
    <div class="l2-badges">
      <span class="l2-badge ${check.ok ? 'ok' : 'ng'}" title="${esc(okTip)}">계산 정합성 ${check.ok ? '✅' : '❌ 신뢰 불가'}</span>
      <span class="l2-badge ${cal.cls}" title="${esc(cal.tip)}">${esc(cal.txt)}</span>
    </div>
    <div class="l2-matrow"><label>소재 <select data-l2-mat>${opts.join('')}</select></label></div>
    ${scaleBar(ctx, list, info.milky)}
    <div class="l2-prop">Milky <b>${info.milky.toFixed(1)}</b> · μs′ ${fmt(info.musR)}/mm · 두께 ${info.t.toFixed(1)}mm(τ′ ${fmt(info.tauR)}) ·
      시스템 투과율 <b class="${lowT ? 'ng' : ''}">${(info.trans * 100).toFixed(0)}%</b> · HPA ${info.hpa.toFixed(0)}°</div>
    ${opaque ? '<div class="l2-warn">완전 차폐에 가까움 — 투과광이 거의 없습니다.</div>' : ''}
    ${lowT ? `<div class="l2-warn">밝기 경고: 시스템 투과율 ${(info.trans * 100).toFixed(0)}% &lt; 최소 ${(tMin * 100).toFixed(0)}%</div>` : ''}
    ${warnings.map((w) => `<div class="l2-warn">${esc(w)}</div>`).join('')}`;
  const adv = el.querySelector('.l2-adv');
  if (adv.open) renderAdvanced(el.querySelector('[data-l2-adv]'), ctx, desc);
  adv.ontoggle = () => { if (adv.open) renderAdvanced(el.querySelector('[data-l2-adv]'), el._ctx, desc); };
  el.querySelector('[data-l2-assume]').innerHTML = `<ul>
      <li>소재: g=${info.g.toFixed(3)}, μa=${info.mua.toPrecision(2)}/mm ${m ? `(${esc(m.name)} 피팅값)` : '(추상 소재 임시값: g=0.9, 투명 PC + 산란제 흡수)'}</li>
      <li>LED 기판 반사율 ρ_b=${info.rhoB} (PCB 색 선택, 임시값) · 측벽 = 같은 밀키 수지, 확산 반사율 ${info.rW.toFixed(2)}</li>
      <li>공기 갭 h=${info.h.toFixed(1)}mm, 슬래브 두께 = L1 두께(L3 동시 사용 시 면적 평균)</li>
      <li>경사 입사의 측방 시프트 무시, 하면 정반사를 Lambertian 으로 근사, LED 발광면 크기 무시(점광원)</li>
      <li>판 안에 전반사로 갇혀 20t 이상 이동하는 빛은 기구 면적에 균일 분포로 근사</li>
      <li>고 Milky(τ′&gt;10) 는 확산근사 — 흡수가 클 때 반사율 최대 −0.6%p</li>
      <li>흡수가 측방 확산 폭을 줄이는 효과 무시(현실적 흡수 수준에서 영향 &lt;1%, test/l2-fit 참조)</li>
      <li>미반영: 파장 의존 산란(옐로링), 편광, 열, 표면 텍스처</li>
    </ul>`;
}

// 0~10 Milky 눈금 막대: DB 소재 ▼(이름 툴팁), 현재 값 ●
function scaleBar(ctx, list, cur) {
  const W = 300, x = (m) => 6 + (Math.min(10, Math.max(0, m)) / 10) * (W - 12);
  const marks = list.map((e) => { const mv = milkyOf(ctx.table, e); return `<g><title>${esc(e.name)} — Milky ${mv.toFixed(2)}</title><path d="M${x(mv) - 4},2 L${x(mv) + 4},2 L${x(mv)},9 Z" fill="${e.id === ctx.materialId ? '#c96a26' : '#8a93a6'}"/></g>`; }).join('');
  const ticks = Array.from({ length: 11 }, (_, i) => `<line x1="${x(i)}" y1="12" x2="${x(i)}" y2="${i % 5 ? 15 : 17}" stroke="#9aa1ad"/>${i % 5 ? '' : `<text x="${x(i) - 3}" y="27" font-size="9" fill="#6b7487">${i}</text>`}`).join('');
  return `<svg class="l2-scale" viewBox="0 0 ${W} 30" width="${W}" height="30" role="img" aria-label="Milky 눈금">
    <line x1="6" y1="12" x2="${W - 6}" y2="12" stroke="#9aa1ad"/>${ticks}${marks}
    <circle cx="${x(cur)}" cy="12" r="3.5" fill="#2f6fd6"><title>현재 Milky ${cur.toFixed(2)}</title></circle></svg>`;
}

function fmt(v) { return !Number.isFinite(v) ? '∞' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2); }
