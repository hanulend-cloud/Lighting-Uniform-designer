// L2 카드 하단 패널 — spec 2026-10-07 §5.5·§5.6·§7.
// ① 배지 2종: "계산 정합성"(V 검사 — 물리식대로 계산됐는가) ≠ "실물 보정"(실제 제품과 맞는가, 기본 미보정)
// ② 물성 한 줄: Milky · μs′ · τ′ · 시스템 투과율 · HPA
// ③ 경고(격자 밖·두께 근사 등) ④ 가정 패널(접힘)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function renderL2Panel(el, desc, tMin) {
  if (!el) return;
  if (!desc || desc.error) {
    el.innerHTML = `<div class="l2-badges"><span class="l2-badge ng" title="${esc(desc?.error ?? '')}">계산 정합성 ❌ ${esc(desc?.error ?? 'L2 solver 없음')}</span></div>`;
    return;
  }
  const { check, info, warnings } = desc;
  const vList = check.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.id} ${typeof c.value === 'number' ? c.value.toPrecision(3) : ''} (한도 ${c.limit}) ${c.note ?? ''}`).join('\n');
  const okTip = '계산 정합성 = 산란 응답표가 독립 기준해(adding-doubling)·해석해와 일치하고 에너지가 보존되는지 자동 점검한 결과입니다.\n'
    + '실제 제품과의 일치를 보장하지 않습니다(→ 실물 보정 배지).\n\n' + vList;
  const calTip = '실물 보정: 실측 소재(BTDF/BRDF)나 LightTools·Speos 시스템 결과와 대조한 이력이 없습니다.\n'
    + '현재 Milky 는 추상 소재(g=0.9 가정)이며 결과는 설계 방향 판단용입니다.';
  const opaque = info.milky >= 9.95;
  const lowT = info.trans < tMin;
  el.innerHTML = `
    <div class="l2-badges">
      <span class="l2-badge ${check.ok ? 'ok' : 'ng'}" title="${esc(okTip)}">계산 정합성 ${check.ok ? '✅' : '❌ 신뢰 불가'}</span>
      <span class="l2-badge warn" title="${esc(calTip)}">실물 보정: 미보정</span>
    </div>
    <div class="l2-prop">Milky <b>${info.milky.toFixed(1)}</b> · μs′ ${fmt(info.musR)}/mm · 두께 ${info.t.toFixed(1)}mm(τ′ ${fmt(info.tauR)}) ·
      시스템 투과율 <b class="${lowT ? 'ng' : ''}">${(info.trans * 100).toFixed(0)}%</b> · HPA ${info.hpa.toFixed(0)}°</div>
    ${opaque ? '<div class="l2-warn">완전 차폐에 가까움 — 투과광이 거의 없습니다.</div>' : ''}
    ${lowT ? `<div class="l2-warn">밝기 경고: 시스템 투과율 ${(info.trans * 100).toFixed(0)}% &lt; 최소 ${(tMin * 100).toFixed(0)}%</div>` : ''}
    ${warnings.map((w) => `<div class="l2-warn">${esc(w)}</div>`).join('')}
    <details class="l2-assume"><summary>가정·한계 (계산 모델)</summary><ul>
      <li>소재: g=${info.g} (확산판 대표값), μa=${info.mua.toPrecision(2)}/mm (투명 PC + 산란제 흡수 임시값)</li>
      <li>LED 기판 반사율 ρ_b=${info.rhoB} (PCB 색 선택, 임시값) · 측벽 = 같은 밀키 수지, 확산 반사율 ${info.rW.toFixed(2)}</li>
      <li>공기 갭 h=${info.h.toFixed(1)}mm, 슬래브 두께 = L1 두께(L3 동시 사용 시 면적 평균)</li>
      <li>경사 입사의 측방 시프트 무시, 하면 정반사를 Lambertian 으로 근사, LED 발광면 크기 무시(점광원)</li>
      <li>판 안에 전반사로 갇혀 20t 이상 이동하는 빛은 기구 면적에 균일 분포로 근사</li>
      <li>고 Milky(τ′&gt;10) 는 확산근사 — 흡수가 클 때 반사율 최대 −0.6%p</li>
      <li>미반영: 파장 의존 산란(옐로링), 편광, 열, 표면 텍스처</li>
    </ul></details>`;
}

function fmt(v) { return !Number.isFinite(v) ? '∞' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2); }
