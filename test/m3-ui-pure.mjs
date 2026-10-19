// CAD UI 순수 도우미(DOM 없이): node test/m3-ui-pure.mjs
import { treeNodes, partBadge, renderFeatureTree, treeHtml, toggleVisibility, esc as escT } from '../src/ui/m3/feature-tree.js';
import { calcLabel } from '../src/ui/m3/command-bar.js';
import { judgeText, lumCard, fmtU, buildLut, NO_DATA_RGB, DEFAULT_GUIDE } from '../src/ui/m3/results-panel.js';
import { checkLabels, statusWord, statusIcon, checkAria, isActivateKey, esc as escS } from '../src/ui/m3/status-bar.js';
import { ramp, NO_DATA } from '../src/ui/m3/colormap.js';
import { defaultLight, defaultObserve, defaultChecks } from '../src/engine/mech3d/defs.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { ok, done } from './mech3d-util.mjs';

const M = {
  name: 't', contacts: [{ a: 0, b: 1, mode: 'contact' }], checks: defaultChecks(),
  parts: [setPartMaterialParam(setPartMaterial(defaultPart(0, '커버', 1), 'milky'), 'milky', 3), setPartMaterial(defaultPart(1, '하우징', 1), 'opaque')],
  light: { ...defaultLight(), kind: 'manual' }, observe: { ...defaultObserve(), faces: [{ part: 0, face: 1 }] },
};
{ const N = treeNodes(M, { node: 'part:0', line: { kind: 'line', closed: false, length: 116, width: 16 } });
  ok(N.map((n) => n.id).join() === 'parts,part:0,part:1,light,leds,obs,target,contacts', `트리 노드: ${N.map((n) => n.id).join()}`);
  ok(N[1].badge === 'Milky 3.0' && N[1].sel && N[1].child && N[2].badge.startsWith('불투명') && N[3].badge === '직접 배치' && N[4].label === 'LED ×10' && N[4].badge === '균등'
    && N[5].badge === '직선 116×16' && N[6].badge === '0.80 / 0.80' && N[7].badge === '1', `배지: ${N.map((n) => n.badge).join(' | ')}`); }
{ const N = treeNodes({ ...M, light: defaultLight() }, { node: null, line: null });
  ok(!N.some((n) => n.id === 'leds') && N.find((n) => n.id === 'obs').badge === '인식 중' && N.find((n) => n.id === 'light').badge === '지정 안 함', '광원 없음 → LED 노드 없음, 라인 인식 중');
  const N2 = treeNodes({ ...M, observe: defaultObserve() }, { node: null, line: null });
  ok(N2.find((n) => n.id === 'obs').badge === '미지정', '관측면 없음 → 미지정'); }
ok(partBadge(setPartMaterial(defaultPart(0, 'p', 1), 'clear')).startsWith('투명 '), '투명 부품 배지 = 투명 + 투과율');
ok(calcLabel({ state: 'running' }) === '⏸ 계산 중' && calcLabel({ state: 'paused' }) === '▶ 계산 재개' && calcLabel({ state: 'done', reason: 'converged' }).includes('수렴')
  && calcLabel({ state: 'done', reason: 'max' }).includes('최대') && calcLabel(null) === '▶ 계산' && calcLabel({ state: 'error' }).includes('다시'), '계산 버튼 문구');
{ const N = treeNodes({ ...M, light: { ...defaultLight(), kind: 'manual', manual: { ...defaultLight().manual, pitch: 11.6000001 } } }, { node: null, line: { kind: 'zigzag', closed: false, length: 99.6, width: 7.4 } });
  ok(N.find((n) => n.id === 'leds').badge === '피치 11.6' && N.find((n) => n.id === 'obs').badge === 'zigzag 100×7', `피치 반올림 · 모르는 라인 종류: ${N.find((n) => n.id === 'leds').badge} / ${N.find((n) => n.id === 'obs').badge}`); }
{ const el = { innerHTML: '', addEventListener() {}, contains: () => false, ownerDocument: null, querySelectorAll: () => [] };
  const P = { ...M, parts: [{ ...M.parts[0], name: `<img src=x onerror="a()">&'` }] };
  renderFeatureTree(el, P, { node: null, line: null }, { onNode() {} });
  ok(!el.innerHTML.includes('<img') && el.innerHTML.includes('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;'), '부품 이름 escape');
  ok(escT(`<>"'&`) === '&lt;&gt;&quot;&#39;&amp;' && escS(`<>"'&`) === '&lt;&gt;&quot;&#39;&amp;', 'esc: 특수문자 5종 모두'); }
{ const h = treeHtml(M, { node: 'part:0', line: null });
  ok(/role="button" tabindex="0" aria-current="true" data-node="part:0"/.test(h) && (h.match(/aria-current/g) ?? []).length === 1 && (h.match(/role="button" tabindex="0"(?: aria-current="true")? data-node=/g) ?? []).length === treeNodes(M, { node: 'part:0', line: null }).length,
    '트리 노드: role=button · tabindex=0 · 선택 노드만 aria-current'); }
{ const N = treeNodes(M, { node: null, line: null, hidden: [1], hideLeds: false });
  ok(N[0].eye === 'all' && N[1].eye === 'on' && N[2].eye === 'off' && N.find((n) => n.id === 'leds').eye === undefined, '눈 단추: 숨긴 부품 off · 머리 = 모두 보기 · 직접 배치 LED 없음');
  ok(treeNodes(M, { node: null, line: null, hidden: [] })[0].eye === undefined, '숨긴 것 없으면 머리 눈 단추 없음');
  const h = treeHtml(M, { node: null, line: null, hidden: [1] });
  ok(/data-eye="part:1"[^>]*aria-pressed="false"/.test(h) && /class="m3-node child  hid"/.test(h), '눈 단추 HTML · 숨긴 행 흐리게');
  const stp = { ...M, light: { ...defaultLight(), kind: 'step', step: { leds: [0, 1], excluded: [] } } };
  ok(treeNodes(stp, { node: null, line: null, hideLeds: true }).find((n) => n.id === 'leds').eye === 'off', 'LED STEP 노드 눈 단추');
  const T = toggleVisibility;
  ok(JSON.stringify(T('part:1', false, 3, [], false)) === '{"hidden":[1],"hideLeds":false}' && JSON.stringify(T('part:1', false, 3, [1], false)) === '{"hidden":[],"hideLeds":false}'
    && JSON.stringify(T('part:1', true, 3, [], false)) === '{"hidden":[0,2],"hideLeds":true}' && JSON.stringify(T('parts', false, 3, [0, 2], true)) === '{"hidden":[],"hideLeds":false}'
    && JSON.stringify(T('leds', false, 3, [2], false)) === '{"hidden":[2],"hideLeds":true}' && JSON.stringify(T('leds', true, 3, [], true)) === '{"hidden":[0,1,2],"hideLeds":false}', 'toggleVisibility: 끄기·켜기·이것만·모두 보기·LED'); }
{ const cls = []; const el = { listeners: {}, addEventListener(k, f) { this.listeners[k] = f; }, contains: () => true, ownerDocument: null, querySelectorAll: () => [], set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } };
  let eye = null, node = null;
  renderFeatureTree(el, M, { node: null, line: null }, { onNode: (id) => { node = id; }, onEye: (id, only) => { eye = [id, only]; } });
  const tgt = (ds) => ({ closest: (q) => (q === '[data-eye]' ? (ds.eye ? { dataset: ds } : null) : { dataset: ds }) });
  el.listeners.click({ target: tgt({ eye: 'part:0', node: 'part:0' }), shiftKey: true, stopPropagation() {} });
  ok(eye?.[0] === 'part:0' && eye[1] === true && node === null, '눈 단추 클릭 → onEye(Shift), 노드 선택 안 함'); }
ok(statusWord('ok') === '양호' && statusWord('warn') === '경고' && statusWord('bad') === '불량' && statusWord('na') === '미계산' && statusWord('?') === '미계산'
  && statusIcon('ok') === '✓' && statusIcon('warn') === '!' && statusIcon('bad') === '✕' && statusIcon('na') === '–' && checkAria({ text: '살두께 0.50 mm', st: 'warn' }) === '살두께 0.50 mm — 경고', '배지 상태 단어 · 기호');
ok(isActivateKey({ key: 'Enter' }) && isActivateKey({ key: ' ' }) && !isActivateKey({ key: 'a' }) && !isActivateKey({ key: 'Tab' }), '활성화 키 = Enter/Space');
{ const L = buildLut(), n = NO_DATA_RGB;
  ok(L instanceof Uint8Array && L.length === 768 && [0, 1, 2].every((k) => L[k] === Math.round(ramp(0)[k] * 255) && L[765 + k] === Math.round(ramp(1)[k] * 255) && L[384 + k] === Math.round(ramp(128 / 255)[k] * 255)), '256단계 색 표 = ramp');
  ok(n.every((v, k) => v === Math.round(NO_DATA[k] * 255)), '자료 없음 색 = colormap NO_DATA'); }
ok(typeof DEFAULT_GUIDE === 'string' && DEFAULT_GUIDE.length > 0, '기본 안내 문구');
ok(calcLabel({ state: 'starting' }) === '⏸ 장면 준비' && calcLabel({ state: 'pending' }) === '⏸ 계산 중', "calc 'starting' = 장면 준비");
ok(JSON.stringify(judgeText(0.85, 0.8)) === '{"cls":"ok","text":"목표 0.80 · 합격"}' && judgeText(0.7, 0.8).cls === 'bad' && judgeText(0.7, 0.8).text === '목표 0.80 · 미달 −0.10' && judgeText(NaN, 0.8).cls === '', '판정 문구(합격·미달·값 없음)');
{ const st = { profile: Float64Array.from([1, 0.5, NaN]) };
  const rel = lumCard(st, { eff: 0.2, lum: null }, null), abs = lumCard(st, { eff: 0.2, lum: 1234.4 }, 1000), none = lumCard(st, { eff: 0.2, lum: 800 }, null);
  ok(rel.value === '75%' && rel.ratio === null && abs.value === '1234 cd/m²' && abs.pass === true && Math.abs(abs.ratio - 1.2344) < 1e-12 && none.pass === null && none.sub === '목표 없음',
    `평균 광량 카드: 상대 ${rel.value}, 절대 ${abs.value}(${abs.sub})`); }
{ const T = checkLabels({ interference: { status: 'bad', count: 2 }, reach: { status: 'ok', minReach: 0.92, minDist: 6.5 }, wall: { status: 'warn', min: 0.5 }, leak: { status: 'ok', ratio: 0.04 } });
  ok(T.map((t) => t.text).join(' | ') === 'LED–부품 간섭 2건 | LED–커버 6.5 mm · 도달 92% | 살두께 0.50 mm | 새는 빛 4%' && T.map((t) => t.st).join() === 'bad,ok,warn,ok', `점검 배지: ${T.map((t) => t.text).join(' | ')}`);
  ok(checkLabels({}).every((t) => t.st === 'na' && t.text.endsWith('–')) && checkLabels({ interference: { status: 'ok', count: 0 } })[0].text === 'LED–부품 간섭 없음', '점검 전 → 회색 –'); }
// 반올림: 판정과 표시가 엇갈리지 않게(좋을수록 큰 값은 내림, 작을수록 좋은 값은 올림, 미달 폭은 최소 0.01)
ok(fmtU(0.7999) === '0.79' && fmtU(0.92) === '0.92' && fmtU(0.29) === '0.29' && fmtU(1) === '1.00' && fmtU(NaN) === '–'
  && judgeText(0.7999, 0.8).text === '목표 0.80 · 미달 −0.01', `U 표시 내림 · 미달 폭: ${fmtU(0.7999)} / ${judgeText(0.7999, 0.8).text}`);
{ const st = { profile: Float64Array.from([1, 0.5]) }, a = lumCard(st, { lum: 999.7 }, 1000), e = lumCard({ profile: Float64Array.from([NaN, NaN]) }, null, null);
  ok(a.value === '999 cd/m²' && a.pass === false && a.sub.endsWith('미달 −1') && e.value === '–', `광량 내림·빈 프로파일: ${a.value} ${a.sub} / ${e.value}`); }
{ const T = checkLabels({ reach: { status: 'warn', minReach: 0.499, minDist: 6.5 }, wall: { status: 'warn', min: 0.7996 }, leak: { status: 'warn', ratio: 0.2004 } }), L7 = checkLabels({ leak: { status: 'ok', ratio: 0.07 } })[3].text;
  ok(T[1].text.endsWith('도달 49%') && T[2].text === '살두께 0.79 mm' && T[3].text === '새는 빛 21%' && L7 === '새는 빛 7%' && checkLabels({ reach: { status: 'ok', minReach: 1, minDist: null } })[1].text === 'LED–커버 가림',
    `점검 반올림: ${T.map((t) => t.text).join(' | ')} | ${L7}`); }
ok(judgeText(0.8004, 0.8009).cls === 'ok' && judgeText(0.7999, 0.8).cls === 'bad' && judgeText(0.8, 0.8).cls === 'ok' && judgeText(0.855, 0.8567).text === '목표 0.85 · 합격', '판정 = 표시(내림)값 비교, 목표도 내림 표시');
done();
