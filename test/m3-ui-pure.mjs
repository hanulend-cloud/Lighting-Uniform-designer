// CAD UI 순수 도우미(DOM 없이): node test/m3-ui-pure.mjs
import { treeNodes, partBadge, renderFeatureTree, treeHtml, toggleVisibility, esc as escT } from '../src/ui/m3/feature-tree.js';
import { calcLabel } from '../src/ui/m3/command-bar.js';
import { judgeText, lumCard, fmtU, buildLut, NO_DATA_RGB, DEFAULT_GUIDE } from '../src/ui/m3/results-panel.js';
import { checkLabels, statusWord, statusIcon, checkAria, isActivateKey, esc as escS } from '../src/ui/m3/status-bar.js';
import { ramp, NO_DATA } from '../src/ui/m3/colormap.js';
import { defaultLight, defaultObserve, defaultChecks } from '../src/engine/mech3d/defs.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { setPartTab, clearanceHtml, meshInfo, partHeaderText, reflRowHtml, reflAddFormHtml, partToDbMaterial, renderPartProps, kindSegHtml, clearanceSummaryHtml, partTitleText, xfSummaryText, sectionOpen, resetSections } from '../src/ui/mech3d-panel.js';
import { DEFAULT_FINISH_CATALOG, finishCandidatesFor, catalogOf } from '../src/engine/mech3d/housing-led.js';
import { reflDbHtml } from '../src/ui/mech3d-light-panel.js';
import { stepLayoutRowHtml, clampVirtual, virtCountMax, ledRowsHtml, defaultRowGap } from '../src/ui/mech3d-light-panel.js';
import { rowGapOptions } from '../src/engine/mech3d/placement.js';
import { ok, done } from './mech3d-util.mjs';
import { stageAvailability, autoCardHtml, compareHtml, clampCap, overallFrac, etaText, profileSvg, shapeText, screenSummary, reusableCurrent, defaultHousingPart, finishText, applyDz, applyFinish, capDefault, nextFinish } from '../src/ui/m3/autodesign-panel.js';

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
{ const h = clearanceHtml({ rows: [{ name: '<b>', gap: 0, depth: 0.5 }, { name: '커버', gap: 0.01, depth: 0 }, { name: '가이드', gap: 1.234, depth: 0 }], leds: [], ledMin: { led: 2, dist: 3.5 }, ledAxial: null });
  ok(h.includes('<b>간섭</b>') && h.includes('접촉') && h.includes('1.23 mm') && h.includes('LED 최소 거리 (LED 3)') && h.includes('&lt;b>') && !h.includes('LED 축') && !h.includes('m3-sub'), '간격 표: 간섭·접촉·간격·LED·escape(제목은 접는 구역)');
  ok(clearanceHtml(null) === '' && clearanceHtml({ rows: [], leds: [], ledMin: null, ledAxial: null }).includes('20 mm 안에 다른 부품 없음'), '간격 표: 없음'); }
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
{ const base = { parts: [{ material: { kind: 'milky' } }, { material: { kind: 'opaque' } }], light: { kind: 'manual' }, observe: { faces: [{ part: 0, face: 1 }] } };
  const a = stageAvailability(base, { non25: [0, 0.5] });
  ok(a.milky.ok && a.leds.ok && a.shape.ok && a.shape.parts.join() === '0', '가능: Milky 부품 있음 · 직접 배치 · 2.5D 부품만 ③ 대상');
  const b = stageAvailability({ ...base, light: { kind: 'step' }, parts: [{ material: { kind: 'clear' } }] }, { non25: [0.5] });
  ok(!b.milky.ok && /Milky 부품/.test(b.milky.why) && !b.leds.ok && /LED STEP/.test(b.leds.why) && /기준/.test(b.leds.why) && !b.shape.ok, '불가 이유: Milky 없음 · LED STEP 기준 LED 없음 · 2.5D 아님');
  const stepL = (emitters, excluded = []) => stageAvailability({ ...base, light: { kind: 'step', step: { leds: [1, 2], excluded, emitters } } }, { non25: [0, 0.5] }).leds;
  const s1 = stepL([{ part: 1 }, { part: 2 }]), s2 = stepL([{ part: 1, needsCheck: true }, { part: 2 }], [2]), s3 = stepL([{ part: 2 }], [1]);
  ok(s1.ok && s1.note === 'LED STEP — 기준 LED 를 복사해 개수·간격 조정' && !s2.ok && /기준/.test(s2.why) && s3.ok, 'LED STEP ②: 기준 발광점(확인 필요·제외 아님) 있으면 가능, 없으면 이유');
  ok(autoCardHtml({ avail: { ...a, leds: s1 }, sel: { leds: true }, running: null }).includes('기준 LED 를 복사해 개수·간격 조정'), '카드: LED STEP ② 안내 문구');
  const h = autoCardHtml({ avail: a, sel: { milky: true, leds: false, shape: false, shapePart: 0 }, running: null });
  ok(h.includes('data-ad="milky" checked') && h.includes('data-ad="run"') && !h.includes('disabled data-ad="milky"'), '카드: 체크 상태·실행 버튼');
  ok(autoCardHtml({ avail: a, sel: { milky: true }, running: null, canRevert: true }).includes('data-ad="revert"') && !h.includes('data-ad="revert"'), '카드: 적용 뒤에만 되돌리기');
  const c = compareHtml({ cur: { count: 5, pitch: 0, milky: 3, Ulen: 0.62, Uwid: 0.7, eff: 0.6 }, best: { count: 4, pitch: 0, milky: 3.5, Ulen: 0.81, Uwid: 0.72, eff: 0.55 }, feasible: true, reason: '', shape: null });
  ok(c.includes('LED') && c.includes('4') && c.includes('0.81') && c.includes('data-ad="apply"') && c.includes('data-ad="cancel"'), '비교표: 현재 | 최적 · 적용·취소');
  const cs = compareHtml({ cur: { count: 10, pitch: 0, stepOrig: true, milky: 2, Ulen: 0.6, Uwid: 0.7, eff: 0.5 }, best: { count: 10, pitch: 0, stepOrig: true, milky: 3, Ulen: 0.8, Uwid: 0.7, eff: 0.4 }, feasible: true, reason: '', shape: null, stepLeds: 10 });
  ok((cs.match(/LED STEP 현재 10개/g) ?? []).length === 2 && !cs.includes('균등'), '비교표: LED STEP 원래 위치 유지 = 두 열 모두 LED STEP 현재 10개');
  const cv = compareHtml({ cur: { count: 10, pitch: 0, stepOrig: true, milky: 2, Ulen: 0.6, Uwid: 0.7, eff: 0.5 }, best: { count: 8, pitch: 14, stepOrig: false, milky: 2, Ulen: 0.8, Uwid: 0.7, eff: 0.5 }, feasible: true, reason: '', shape: null, stepLeds: 10 });
  const cg = compareHtml({ cur: { count: 6, pitch: 0, stepOrig: false, milky: 2, Ulen: 0.6, Uwid: 0.7, eff: 0.5 }, best: { count: 5, pitch: 0, stepOrig: false, milky: 2, Ulen: 0.8, Uwid: 0.7, eff: 0.5 }, feasible: true, reason: '', shape: null, stepLeds: 6 });
  ok(cv.includes('<td>LED STEP 현재 10개</td>') && cv.includes('8개 피치 14') && cg.includes('6개 균등') && cg.includes('5개 균등'), '비교표: LED STEP 원래 → 가상 개수·피치(0 = 균등)');
  const cu = compareHtml({ cur: { count: 5, pitch: 0, milky: 3, Ulen: 0.75, Uwid: 0.9, eff: 0.6 }, best: { count: 5, pitch: 0, milky: 3, Ulen: 0.75, Uwid: 0.9, eff: 0.6 }, feasible: false, reason: '현재안보다 나은 설계를 찾지 못함 — 현재안 유지', shape: null, unchanged: true });
  ok(cu.includes('현재안 유지') && /data-ad="apply"[^>]*disabled/.test(cu) && !/data-ad="apply"[^>]*disabled/.test(c), '비교표: 현재안 유지 → 사유 표시 · 적용 비활성'); }
{ // Milky 상한 기본: ① 만 = 9.9 · ② 함께 = max(현재, 5) · 카드 값도 같음
  const a = { milky: { ok: true }, leds: { ok: true }, shape: { ok: false } };
  ok(capDefault({ milky: true }, a, 3) === 9.9 && capDefault({ milky: true, leds: true }, a, 3) === 5 && capDefault({ milky: true, leds: true }, a, 6) === 6 && capDefault({ milky: true, leds: true }, { ...a, leds: { ok: false } }, 3) === 9.9, 'Milky 상한 기본: ① 만 9.9 · ② 함께 5');
  const h1 = autoCardHtml({ avail: a, sel: { milky: true }, running: null }), h2 = autoCardHtml({ avail: a, sel: { milky: true, leds: true }, running: null });
  ok(h1.includes('value="9.9" data-ad="milkyMax"') && h1.includes('Milky 상한'), '카드: ① 만 → 상한 9.9');
  ok(h2.includes('value="5" data-ad="milkyMax"'), '카드: ② 함께 → 상한 5'); }
// ④ 보완 계산 후보: 현재보다 높은 등급(gradeOf) 중 가장 낮은 것 · 최고 등급이면 null
ok(nextFinish({ kind: 'whiteDiffuse', R: 0.85 })?.R === 0.95 && nextFinish({ kind: 'whiteDiffuse', R: 0.85 }).kind === 'whiteDiffuse' && nextFinish({ kind: 'whiteDiffuse', R: 0.9 })?.R === 0.97
  && nextFinish({ kind: 'metal', R: 0.88 })?.R === 0.95 && nextFinish({ kind: 'whiteDiffuse', R: 0.97 }) === null && nextFinish(null)?.R === 0.85 && nextFinish({ kind: 'gloss' })?.R === 0.85, '④ 보완 안내: 같은 종류 +0.10 이상 최저(백색 85→95, 90→97) · 최고면 없음');
ok(clampCap(12) === 9.9 && clampCap(0.1) === 0.5 && clampCap(3) === 3 && clampCap(0) === null && clampCap(-2) === null && clampCap(NaN) === null, 'Milky 상한: 0.5~9.9 로 자름 · 0/음수/NaN = 기본');
{ const all = { milky: true, leds: true, shape: true }, m = { milky: true };
  ok(overallFrac(m, 'current', 0) === 0 && Math.abs(overallFrac(m, 'milky', 0) - 5 / 50) < 1e-12 && Math.abs(overallFrac(m, 'milky', 0.5) - 22.5 / 50) < 1e-12 && overallFrac(m, 'verify', 1) === 1, '전체 진행률: 켠 단계만 정규화(① 만 = 5+35+10)');
  ok(Math.abs(overallFrac(all, 'shape', 0) - 75 / 135) < 1e-12 && overallFrac(all, 'shape', 2) <= 1 && overallFrac(m, 'shape', 0.5) === 0, '전체 진행률: 단계 순서·무게 · 꺼진 단계 = 0');
  const hh = { leds: true, height: true, housing: true, milky: true };
  ok(Math.abs(overallFrac(hh, 'height', 0) - 40 / 125) < 1e-12 && Math.abs(overallFrac(hh, 'housing', 0.5) - 70 / 125) < 1e-12 && Math.abs(overallFrac(hh, 'milky', 0) - 80 / 125) < 1e-12, '전체 진행률: ⑤ 높이·④ 케이스 면(각 20)은 ② 와 ① 사이');
  ok(etaText(5000, 0.05) === '' && etaText(10000, 0.5) === '남은 약 10초' && etaText(1000, 1) === '', `남은 시간: 10% 이후만 (${etaText(10000, 0.5)})`); }
{ const s = profileSvg([1, 2, NaN, 4], [3, 3, 3, 3]);
  ok((s.match(/<polyline/g) ?? []).length === 2 && s.includes('<svg') && profileSvg(null, [1]) === '' && profileSvg([], [1]) === '', '길이 프로파일 SVG: 선 2개 · 없으면 생략');
  const base = { parts: [{ material: { kind: 'milky' } }], light: { kind: 'manual' }, observe: { faces: [] } }, a = stageAvailability(base, { non25: [0] });
  const run = autoCardHtml({ avail: a, sel: { milky: true, shape: true, shapePart: 0 }, running: { frac: 0.4, text: 'x' }, names: ['LGP'], milkyPart: 0 });
  ok(/data-ad="milky" checked disabled/.test(run) && /data-ad="milkyMax"[^>]*disabled/.test(run) && /data-ad="shapePart"[^>]*disabled/.test(run) && /role="progressbar"[^>]*aria-valuenow="40"/.test(run) && run.includes('① 대상: LGP'), '실행 중: 입력 비활성 · 진행 막대 aria · ① 대상 부품');
  const nl = autoCardHtml({ avail: a, sel: { milky: true }, running: null, noLine: true });
  ok(/data-ad="run" disabled title="관측 라인이 없음"/.test(nl) && /aria-label="Milky 상한"/.test(nl), '라인 없음 → 실행 비활성 · 상한 aria-label');
  const c = compareHtml({ cur: { count: 5, pitch: 0, milky: 3, Ulen: 0.6, Uwid: 0.7, eff: 0.5, shape: { dt: 0, h: 0.2, R: 3 }, profile: [1, 2] }, best: { count: 5, pitch: 0, milky: 3, Ulen: 0.8, Uwid: 0.7, eff: 0.5, profile: [2, 2] }, feasible: true, reason: '', shape: null });
  ok(c.includes('적용된 형상') && (c.match(/<polyline/g) ?? []).length === 2, '비교표: 적용된 형상 · 프로파일 SVG');
  const t1 = shapeText({ dt: 0.5, h: 0.4, R: 6, e: -0.3, c: 0.2 }), t2 = shapeText({ dt: 0, h: -0.25, R: 4.5, e: 0, c: -0.1 });
  ok(t1 === '두께 +0.50 · 포켓 0.40 R 6.0 · 끝단 두께 −0.30 · 폭 가장자리 두께 +0.20 mm' && t2 === '돌출 0.25 R 4.5 · 폭 가장자리 두께 −0.10 mm' && shapeText({ dt: 0, h: 0, R: 3, e: 0, c: 0 }) === '변경 없음' && shapeText({ dt: 0.1, h: 0, R: 1 }) === '두께 +0.10 mm', `형상 문구: ${t1} / ${t2}`);
  const s1 = screenSummary({ dt: 0.001, e: 0.02, c: 0.06, h: -0.01 }), s2 = screenSummary({ dt: 0, e: 0.002, c: 0 });
  ok(s1 === '효과(선별): 폭 가장자리 두께 +0.06 · 끝단 두께 +0.02 — 두께·국부 형상 효과 없음' && s2 === '효과(선별): 모든 형상 변수 효과 없음' && screenSummary(null) === '', `선별 요약: ${s1} / ${s2}`);
  const cx = compareHtml({ cur: { count: 5, pitch: 0, milky: 3, Ulen: 0.6, Uwid: 0.7, eff: 0.5 }, best: { count: 5, pitch: 0, milky: 3, Ulen: 0.8, Uwid: 0.7, eff: 0.5 }, feasible: true, reason: '', shape: { dt: 0, h: 0, R: 3, e: 0, c: 0.2 }, screen: { dt: 0, e: 0, c: 0.06 } });
  ok(cx.includes('폭 가장자리 두께 +0.20 mm') && cx.includes('효과(선별): 폭 가장자리 두께 +0.06') && !cx.includes('곡률'), '비교표: 형상 칸 · 선별 요약 줄'); }
{ // LED STEP 배치 편집(spec m3-cad-ui §4b): 배지 · 배치 행
  const st = { name: 'a.stp', offset: [0, 0, 0], rot: [0, 0, 0], leds: [1, 2, 3], excluded: [3], pcb: 0, emitters: [{ part: 1 }], virtual: null };
  const node = (s) => treeNodes({ ...M, light: { ...defaultLight(), kind: 'step', step: s } }, { node: null, line: null }).find((n) => n.id === 'leds');
  ok(node(st).label === 'LED ×2' && node(st).badge === '120°', `원래 위치 배지: ${node(st).label} ${node(st).badge}`);
  const a = node({ ...st, virtual: { count: 6, pitch: 15 } }), b = node({ ...st, virtual: { count: 4, pitch: 0 } }), c = node({ ...st, virtual: { positions: [{ s: 1, w: 0, dz: 0 }, { s: 9, w: 0, dz: 0 }, { s: 20, w: 0, dz: 0 }] } });
  ok(a.label === 'LED ×6' && a.badge === '자동 6개 피치 15' && b.badge === '자동 4개 균등' && c.label === 'LED ×3' && c.badge === 'STEP 편집', `배지: ${a.label} ${a.badge} / ${b.badge} / ${c.label} ${c.badge}`);
  const ln = { length: 100, closed: false, width: 6 };
  const h0 = stepLayoutRowHtml(st, ln, 2), h1 = stepLayoutRowHtml({ ...st, virtual: { positions: [] } }, ln), h2 = stepLayoutRowHtml({ ...st, emitters: [] }, ln), h3 = stepLayoutRowHtml(st, null);
  ok(h0.includes('LED 2개 · STEP 원래 배치') && /data-lp-edit="add">\+ LED 추가/.test(h0) && /data-lp-edit="align"/.test(h0) && !/data-lp-edit="orig"/.test(h0), '배치 행: 원래 = 추가·같은 간격 · 원래대로 없음');
  ok(h1.includes('STEP 에서 편집한 배치') && /data-lp-edit="orig">STEP 원래대로/.test(h1), '배치 행: 편집 → STEP 원래대로');
  ok(/data-lp-edit="add" disabled title="LED 발광면을 먼저 지정하세요"/.test(h2) && /data-lp-edit="add" disabled title="관측면을 먼저/.test(h3), '발광면·라인 없으면 편집 비활성 + 이유');
  ok(/data-lp-edit="add" disabled/.test(stepLayoutRowHtml({ ...st, emitters: [{ part: 3 }] }, ln)) && /data-lp-edit="add" disabled/.test(stepLayoutRowHtml({ ...st, emitters: [{ part: 1, needsCheck: true }] }, ln)), '편집 활성 = 엔진 기준 규칙(제외·확인 필요 발광점만 → 비활성)');
  ok(stepLayoutRowHtml({ ...st, virtual: { count: 6, pitch: 15 } }, ln).includes('자동설계 배치 6개 피치 15mm'), '배치 행: 자동설계 균등 배치 표시');
  ok(virtCountMax({ length: 1000 }) === 200 && virtCountMax({ length: 1 }) === 1 && virtCountMax(null) === 200, '개수 상한: max(1, min(200, ⌊L/2⌋))');
  const c1 = clampVirtual({ count: 5, pitch: 40 }, { length: 100, closed: false }), c2 = clampVirtual({ count: 999, pitch: 3 }, { length: 100, closed: true }), c3 = clampVirtual({ count: 2.4, pitch: -1 }, null);
  ok(c1.count === 5 && c1.pitch === 25 && c2.count === 50 && c2.pitch === 0 && c3.count === 2 && c3.pitch === 0, `clampVirtual: (n−1)·p ≤ L · 닫힌 = 균등 · 상한 (${JSON.stringify([c1, c2, c3])})`);
  // 실제 배치로 배지·개수: 성공 = 복사 수, 실패(오류) = 원래 개수 + '배치 편집 실패', 라인 대기 = 요청값
  const vs = { ...st, virtual: { count: 6, pitch: 15 } }, nodeL = (S, lay) => treeNodes({ ...M, light: { ...defaultLight(), kind: 'step', step: vs } }, S, lay).find((n) => n.id === 'leds');
  const okL = nodeL({ node: null, line: { kind: 'line', length: 100, width: 5 } }, { virtual: vs.virtual, leds: [3, 4, 5, 6, 7, 8] }), bad = nodeL({ node: null, line: { kind: 'line', length: 100, width: 5 } }, { virtual: null, leds: [1, 2, 3], err: '배치 길이 초과' }), wait = nodeL({ node: null, line: null }, { virtual: null, leds: [1, 2, 3] });
  ok(okL.label === 'LED ×6' && okL.badge === '자동 6개 피치 15' && bad.label === 'LED ×2' && bad.badge === '배치 편집 실패' && wait.badge === '자동 6개 피치 15', `배지: ${okL.badge} / ${bad.label} ${bad.badge} / ${wait.badge}`); }
{ // ① 현재안 재사용: 같은 장면(G)에서 수렴('done', relNoise ≤ 목표)한 점진 결과만
  const G = { ns: 1 }, stats = { Ulen: 0.8, Uwid: 0.7, relNoise: 0.015 }, snap = { state: 'done', sceneKey: 's3', G, stats, photometry: { eff: 0.6 }, targetNoise: 0.02 };
  const r = reusableCurrent(snap, G);
  ok(r && r.stats === stats && r.eff === 0.6, '수렴한 결과 → { stats, eff }');
  ok(reusableCurrent({ ...snap, state: 'paused' }, G) === null && reusableCurrent({ ...snap, stats: { ...stats, relNoise: 0.03 } }, G) === null && reusableCurrent(snap, { ns: 1 }) === null && reusableCurrent({ ...snap, sceneKey: null }, G) === null && reusableCurrent({ ...snap, photometry: null }, G) === null, '미수렴·다른 장면·결과 없음 → null'); }
{ // 속성 머리: 실제 메쉬 외곽·부피(크기·위치·형상 반영) + 형상 변경 표시
  const box = (a, b, c) => ({ positions: Float32Array.from([0,0,0, a,0,0, a,b,0, 0,b,0, 0,0,c, a,0,c, a,b,c, 0,b,c]), triangles: Uint32Array.from([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]) });
  const mi = meshInfo(box(40, 10, 2));
  ok(mi.size.join() === '40,10,2' && Math.abs(mi.volume - 800) < 1e-6, `meshInfo: ${mi.size} · ${mi.volume}`);
  const p = { name: 'a', size: [20, 5, 1], volume: 100, xform: { scale: [2, 2, 2] } };
  ok(partHeaderText(p, mi) === '40.0×10.0×2.0mm · 800 mm³', `머리: ${partHeaderText(p, mi)}`);
  ok(partHeaderText({ ...p, shapeMod: { dt: 0.2 } }, mi) === '40.0×10.0×2.0mm · 800 mm³ · 형상 변경됨', '형상 변경됨');
  ok(partHeaderText(p, null) === '40.0×10.0×2.0mm · 800 mm³', '메쉬 없음 → 원본 × 배율'); }
{ // ④ 케이스 면 · ⑤ LED 높이 — 가능 여부 · 기본 대상 · 비교표 문구 · dz/면 처리 적용
  const parts = [{ material: { kind: 'milky' } }, { material: { kind: 'opaque' } }, { material: { kind: 'opaque' } }];
  const man = (pcb) => stageAvailability({ parts, light: { kind: 'manual', manual: { pcb } }, observe: { faces: [{ part: 0, face: 1 }] } }, { non25: [0, 1, 1] });
  const a = man({ kind: 'depth', depth: 5 }), b = man({ kind: 'face', part: 1, face: 2 });
  ok(a.height.ok && a.housing.ok && a.housing.parts.join() === '1,2' && !b.height.ok && b.height.why === 'PCB 가 기구 면에 붙어 있음 — 높이는 기구 면으로 정해짐', '⑤ 직접 배치: 깊이 = 가능 · 기구 면 PCB = 불가 이유 · ④ 불투명 부품 목록');
  const stepA = (emitters) => stageAvailability({ parts: [{ material: { kind: 'milky' } }], light: { kind: 'step', step: { leds: [1], emitters } }, observe: { faces: [] } }, { non25: [0] });
  const c = stepA([]), d = stepA([{ part: 1 }]);
  ok(!c.housing.ok && /불투명/.test(c.housing.why) && !c.height.ok && /발광면/.test(c.height.why) && d.height.ok, '④ 불투명 없음 → 불가 · ⑤ LED STEP 발광점 없음 → 불가, 있으면 가능');
  const h = autoCardHtml({ avail: a, sel: { height: true, housing: true, housingPart: 2 }, running: null, names: ['LGP', '케이스', '덮개'] });
  ok(h.includes('data-ad="height" checked') && h.includes('LED 높이(LED–커버 거리)') && h.includes('케이스 면 처리') && /<option value="2" selected>덮개/.test(h) && h.includes('②→⑤→④→①→③') && !/data-ad="run" disabled/.test(h), '카드: ④⑤ 체크 · ④ 대상 선택 · 실행 순서');
  const M = { parts, observe: { faces: [{ part: 0, face: 1 }] } };
  const box0 = [0, 0, 0, 10, 10, 2], small = [-1, -1, -1, 11, 11, 3], big = [-5, -5, -5, 15, 15, 5], far = [100, 0, 0, 200, 100, 50];
  ok(defaultHousingPart(M, [box0, small, big]) === 2 && defaultHousingPart(M, [box0, small, far]) === 1 && defaultHousingPart(M, [box0, far, [0, 0, 0, 1, 1, 1]]) === 1
    && defaultHousingPart({ ...M, parts: [parts[0]] }, [box0]) === -1 && defaultHousingPart({ ...M, observe: { faces: [] } }, [box0, small, big]) === 2, '④ 기본 대상: 관측 부품을 감싸는 불투명 중 최대 → 없으면 불투명 최대 → 없으면 −1');
  ok(finishText({ kind: 'whiteDiffuse', R: 0.85 }) === '백색 85%' && finishText({ kind: 'metal', R: 0.88 }) === '경면 88%' && finishText({ kind: 'gloss' }) === '광택' && finishText(null) === '–', '면 처리 문구');
  const cur = { count: 5, pitch: 0, milky: 3, Ulen: 0.6, Uwid: 0.7, eff: 0.5 }, best = { ...cur, Ulen: 0.8 };
  const ch = compareHtml({ cur, best, feasible: true, reason: '', shape: null, finish: { cur: { kind: 'whiteDiffuse', R: 0.85 }, best: { kind: 'whiteDiffuse', R: 0.95 } }, height: { dz: 1.2, gap: 6.5 } });
  const c0 = compareHtml({ cur, best, feasible: true, reason: '', shape: null, height: { dz: -0.5, gap: NaN } }), c1 = compareHtml({ cur, best, feasible: true, reason: '', shape: null, height: { dz: 0, gap: 6.5 } });
  ok(ch.includes('<tr><th>케이스 면</th><td>백색 85%</td><td class="chg">백색 95%</td></tr>') && ch.includes('<tr><th>LED 높이</th><td>현재 (커버까지 6.5 mm)</td><td class="chg">+1.20 mm (커버까지 5.3 mm)</td></tr>')
    && c0.includes('<td class="chg">−0.50 mm</td>') && c1.includes('<th>LED 높이</th><td>현재 (커버까지 6.5 mm)</td><td class="">현재 (커버까지 6.5 mm)</td>') && !c1.includes('케이스 면') && !compareHtml({ cur, best, feasible: true, reason: '', shape: null }).includes('LED 높이'), `비교표: 케이스 면 · LED 높이 행`);
  const S = { light: { kind: 'step', step: { offset: [1, 0, 0], rot: [0, 0, 0], emitters: [{ part: 1, pos: [0, 0, 1], axis: [0, 0, 1] }] } } };
  applyDz(S, 1.5, [0, 0, 1]);
  const D = { light: { kind: 'manual', manual: { pcb: { kind: 'depth', depth: 5 } } } }, Fc = { light: { kind: 'manual', manual: { pcb: { kind: 'face', part: 1, face: 2 } } } };
  applyDz(D, 1.5, [0, 0, 1]); applyDz(Fc, 1.5, [0, 0, 1]);
  ok(S.light.step.offset.join() === '1,0,1.5' && S.light.step.emitters[0].pos.join() === '0,0,2.5' && S.light.step.emitters[0].axis.join() === '0,0,1' && D.light.manual.pcb.depth === 3.5 && !('depth' in Fc.light.manual.pcb), 'dz 적용: STEP offset·발광점 함께 이동 · 깊이 −= dz · 기구 면 PCB 그대로');
  const P = { parts: [{ finish: { kind: 'gloss' }, faceFinish: {} }, { finish: { kind: 'whiteDiffuse', R: 0.85 }, faceFinish: { 3: { kind: 'black', R: 0.05 } } }] };
  applyFinish(P, { part: 1, kind: 'metal', R: 0.95 });
  ok(P.parts[1].finish.kind === 'metal' && P.parts[1].finish.R === 0.95 && P.parts[1].faceFinish[3].kind === 'black' && P.parts[0].finish.kind === 'gloss', '면 처리 적용: 기본 면만 교체 · 면별 덮어쓰기 유지'); }
{ // LED 열 배치(spec P4 §2.2b): 열 수·열 간격 입력 · 배지 · 비교표 · 열 간격 후보
  const ln = { length: 116, closed: false, width: 16 };
  const r1 = ledRowsHtml({ rows: 1, rowGap: 0 }, ln, 'man'), r2 = ledRowsHtml({ rows: 2, rowGap: 5 }, ln, 'man'), rv = ledRowsHtml({ rows: 2, rowGap: 4.3 }, null, 'virt');
  ok(/data-lp-man="rows"/.test(r1) && /<option value="1" selected>1열/.test(r1) && !/data-lp-man="rowGap"/.test(r1), '열 입력: 1열 = 열 간격 칸 없음');
  ok(/<option value="2" selected>2열/.test(r2) && /max="7.5"[^>]*value="5" data-lp-man="rowGap"/.test(r2) && r2.includes('최대 ±7.5 mm'), `열 입력: 2열 = 열 간격 ±δ · 최대 = 반폭 − 0.5 (${r2.match(/<span class="mut">[^<]*/)?.[0]})`);
  ok(/value="4.3" data-lp-virt="rowGap"/.test(rv) && !/max=/.test(rv), '열 입력: 가상 배치(data-lp-virt) · 라인 없으면 상한 없음');
  const st = { name: 'a.stp', offset: [0, 0, 0], rot: [0, 0, 0], leds: [1, 2, 3], excluded: [], pcb: 0, emitters: [{ part: 1 }], virtual: { count: 10, pitch: 0, rows: 2, rowGap: 5 } };
  const cv = clampVirtual({ count: 10, pitch: 0, rows: 2, rowGap: 20 }, ln), cd = clampVirtual({ count: 10, pitch: 0, rows: 2, rowGap: 0 }, ln), c1 = clampVirtual({ count: 10, pitch: 0, rows: 1, rowGap: 5 }, ln);
  ok(cv.rows === 2 && cv.rowGap === 7.5 && cd.rowGap === 4.3 && c1.rows === 1 && c1.rowGap === 0, `clampVirtual 열: 상한 ${cv.rowGap} · 0 → 기본 ${cd.rowGap}(0.27·W) · 1열 = 0`);
  ok(defaultRowGap(ln) === 4.3 && JSON.stringify(rowGapOptions(ln)) === '[3.2,4.3,5.2]' && JSON.stringify(rowGapOptions({ width: 2 })) === '[0.4,0.5]' && rowGapOptions({ width: 0.5 }).length === 0, `열 간격 후보 0.2/0.27/0.33·W (${rowGapOptions(ln)}) · 상한으로 자르고 중복 제거`);
  const man = treeNodes({ ...M, light: { ...defaultLight(), kind: 'manual', manual: { ...defaultLight().manual, count: 10, rows: 2, rowGap: 5 } } }, { node: null, line: null }).find((n) => n.id === 'leds');
  const vt = treeNodes({ ...M, light: { ...defaultLight(), kind: 'step', step: st } }, { node: null, line: null }).find((n) => n.id === 'leds');
  ok(man.label === 'LED ×20' && man.badge === '2열 × 10개 균등' && vt.label === 'LED ×20' && vt.badge === '자동 2열 × 10개 균등', `배지: ${man.label} ${man.badge} / ${vt.label} ${vt.badge}`);
  const e = { milky: 2, Ulen: 0.8, Uwid: 0.7, eff: 0.5 };
  const cm = compareHtml({ cur: { ...e, count: 10, pitch: 0, rows: 1 }, best: { ...e, count: 10, pitch: 0, rows: 2, rowGap: 5 }, feasible: true, reason: '', shape: null });
  const cs = compareHtml({ cur: { ...e, count: 10, pitch: 0, stepOrig: true }, best: { ...e, count: 10, pitch: 0, stepOrig: false, rows: 2, rowGap: 5 }, feasible: true, reason: '', shape: null, stepLeds: 10 });
  ok(cm.includes('<td>10개 균등</td>') && cm.includes('2열 × 10개 균등 (열 간격 ±5.0 mm)') && cs.includes('LED STEP 현재 10개') && cs.includes('<td class="chg">2열 × 10개 균등 (열 간격 ±5.0 mm)'), '비교표: 2열 × n개 (열 간격 ±δ) · STEP 현재 → 2열'); }
{ // ④ 소재별 반사율 상한(spec P4 §2.3d) — 문구·안내 후보·적용·카드·부품 편집기·소재표
  const C = DEFAULT_FINISH_CATALOG, W = (R) => ({ kind: 'whiteDiffuse', R });
  ok(finishText({ ...W(0.97), coating: 'coat-white' }) === '백색 97% (특수: 고반사 도장)' && finishText({ kind: 'metal', R: 0.95, coating: 'coat-metal' }) === '경면 95% (특수: 금속 증착)' && finishText({ ...W(0.9), coating: 'zz' }) === '백색 90%', '면 처리 문구: 특수 처리 표시');
  const e = { count: 5, pitch: 0, milky: 3, Ulen: 0.6, Uwid: 0.7, eff: 0.5 };
  const cc = compareHtml({ cur: e, best: e, feasible: true, reason: '', shape: null, finish: { cur: W(0.85), best: { ...W(0.97), coating: 'coat-white' } } });
  ok(cc.includes('<tr><th>케이스 면</th><td>백색 85%</td><td class="chg">백색 97% (특수: 고반사 도장)</td></tr>'), '비교표: 백색 85% → 백색 97% (특수: 고반사 도장)');
  const pool = (allowSpecial) => finishCandidatesFor({ catalog: C, materialId: 'pc-white', current: W(0.85), allowSpecial }).filter((f) => !f.current);
  const n1 = nextFinish(W(0.85), pool(false)), n2 = nextFinish(W(0.9), pool(false)), n3 = nextFinish(W(0.85), pool(true));
  ok(n1?.R === 0.9 && n2 === null && n3?.R === 0.97 && n3.coating === 'coat-white', `① 보완 안내: 소재 상한 안(85→90, 90→없음) · 특수 허용 → 97 특수: ${JSON.stringify([n1, n2, n3])}`);
  const P = { parts: [{ finish: W(0.85), faceFinish: {}, reflMaterial: 'pc-white' }] };
  applyFinish(P, { part: 0, ...W(0.97), coating: 'coat-white' });
  const c1 = P.parts[0].coating; applyFinish(P, { part: 0, ...W(0.9) });
  ok(c1 === 'coat-white' && !('coating' in P.parts[0]) && P.parts[0].finish.R === 0.9 && !('coating' in P.parts[0].finish) && P.parts[0].reflMaterial === 'pc-white', '적용: 특수 처리 → coating 저장 · 일반 등급 → 해제');
  const a = { milky: { ok: false, why: 'x' }, leds: { ok: false, why: 'x' }, shape: { ok: false, why: 'x' }, height: { ok: false, why: 'x' }, housing: { ok: true, parts: [1] } };
  const h1 = autoCardHtml({ avail: a, sel: { housing: true, housingPart: 1, housingSpecial: true }, running: null, names: ['LGP', '케이스'], housingMat: { name: '백색 PC(일반 착색)', max: 0.9 } });
  const h0 = autoCardHtml({ avail: a, sel: { housing: true, housingPart: 1 }, running: null, names: ['LGP', '케이스'], housingMat: null });
  ok(h1.includes('백색 PC(일반 착색) · 상한 90%') && /data-ad="housingSpecial" checked/.test(h1) && h1.includes('특수 표면처리 허용 (고반사 도장·시트·증착)'), '카드 ④: 소재·상한 · 특수 허용 체크');
  ok(h0.includes('반사 소재 미지정') && /data-ad="housingSpecial"(?! checked)/.test(h0) && !autoCardHtml({ avail: a, sel: { housing: false }, running: null }).includes('housingSpecial'), '카드 ④: 소재 미지정 안내 · ④ 끄면 없음');
  const r = reflRowHtml({ material: { kind: 'opaque' }, reflMaterial: 'pc-white' }, C), r0 = reflRowHtml({ material: { kind: 'opaque' } }, C);
  ok(/<option value="pc-white" selected>/.test(r) && (r.match(/<option/g) ?? []).length === 6 && !r.includes('coat-') && r0.includes('<option value="" selected>— 미지정 —'), '부품 편집기: 반사 소재(미지정 + 일반 5개)');
  ok(reflRowHtml({ material: { kind: 'milky' } }, C) === '', '불투명 아님 → 반사 소재 없음');
  const q = setPartMaterial({ ...defaultPart(0, 'c', 1), reflMaterial: 'pc-white', coating: 'coat-white' }, 'opaque');
  ok(!('reflMaterial' in q) && !('coating' in q), '소재 종류 바꾸면 반사 소재·특수 표시 해제');
  const t = reflDbHtml(catalogOf(null)), U = { ...catalogOf(null)[1], id: 'u1', name: '사내 PC', origin: 'user', status: 'measured', nSamples: 3 }, t1 = reflDbHtml([U]);
  ok(t.includes('반사 소재 DB') && !t.includes('data-lp-cat=') && t.includes('data-lp-dbcopy="pc-white"') && !t.includes('data-lp-dbdel') && t.includes('예시') && t.includes('85') && t.includes('data-lp-dbexp') && /type="file"[^>]*data-lp-dbimp|data-lp-dbimp[^>]*type="file"/.test(t), '소재 DB: 공용 = 읽기 전용 + [복사] · 내보내기·불러오기');
  ok(/data-lp-catname="u1"[^>]*value="사내 PC"|value="사내 PC"[^>]*data-lp-catname="u1"/.test(t1) && /data-lp-cat="u1" data-lp-catk="R"[^>]*value="85"|value="85"[^>]*data-lp-cat="u1" data-lp-catk="R"/.test(t1) && t1.includes('data-lp-catk="max"') && t1.includes('data-lp-dbadd="u1"') && t1.includes('data-lp-dbdel="u1"') && t1.includes('실측 3회') && !t1.includes('data-lp-addv'), '소재 DB: 사용자 = 이름·R·상한 편집 · 측정값 추가 · 삭제');
  const t2 = reflDbHtml([U], { addFor: 'u1' });
  ok(t2.includes('data-lp-addv') && t2.includes('data-lp-addok="u1"') && t2.includes('<option>SCI 8°/d</option>') && t2.includes('data-lp-addn'), '소재 DB: 측정값 추가 인라인(값 %·조건·메모)');
  const sp = reflDbHtml([{ ...catalogOf(null)[5], id: 'u2', origin: 'user' }]);
  ok(!/data-lp-cat="u2" data-lp-catk="R"/.test(sp) && /data-lp-cat="u2" data-lp-catk="max"/.test(sp) && sp.includes('특수'), '소재 DB: 특수 처리 = 상한만');
  // 부품 속성: 그룹·상태·없는 소재·복사·추가 양식
  const CU = [...catalogOf(null), U];
  const g = reflRowHtml({ material: { kind: 'opaque' }, reflMaterial: 'u1' }, CU);
  ok(g.includes('<optgroup label="기본">') && g.includes('<optgroup label="사용자">') && /<option value="u1" selected>사내 PC · 실측 3회/.test(g) && g.includes('백색 ABS · 예시') && !g.includes('data-m3-reflcopy') && g.includes('data-m3-refladd'), '반사 소재: 기본/사용자 그룹 · 상태 · [＋ 측정값으로 소재 추가]');
  ok(r.includes('data-m3-reflcopy') && !r0.includes('data-m3-reflcopy'), '반사 소재: 기본 항목 선택 → [복사해서 수정]');
  const gm = reflRowHtml({ material: { kind: 'opaque' }, reflMaterial: 'gone-1' }, C);
  ok(/<option value="gone-1" selected>없는 소재\(gone-1\) — 다시 고르세요/.test(gm) && gm.includes('— 미지정 —</option>') && !/value="" selected/.test(gm), '반사 소재: DB 에 없는 id → 없는 소재 표시');
  const fm = reflRowHtml({ material: { kind: 'opaque' } }, C, { addOpen: true, msg: '이름을 입력하세요' }), f0 = reflAddFormHtml();
  ok(fm.includes('data-m3-raok') && fm.includes('이름을 입력하세요') && ['name', 'kind', 'values', 'cond', 'note', 'max'].every((k) => f0.includes(`data-m3-ra="${k}"`)) && f0.includes('<option value="metal">경면</option>') && f0.includes('<option>0°/45°</option>') && !r.includes('data-m3-raok'), '추가 양식: 이름·종류·값 %·조건·메모·상한');
  ok(finishText({ ...W(0.96), coating: 'u-coat' }, [...C, { id: 'u-coat', name: '사내 반사시트', kind: 'whiteDiffuse', R: null, max: 0.96, special: true }]) === '백색 96% (특수: 사내 반사시트)' && finishText({ ...W(0.97), coating: 'coat-white' }, C) === '백색 97% (특수: 고반사 도장)', '면 처리 문구: 사용자 특수 항목');
  // 투과 부품에 실측 소재 적용 — 투명·백색 투과 → Milky 로
  const mk = partToDbMaterial({ ...defaultPart(0, 'a', 1), material: { kind: 'milky', dbId: '', milky: 2, resin: 'PC' } }, 'm1'), cl = partToDbMaterial(setPartMaterial(defaultPart(0, 'b', 1), 'clear'), 'm1');
  ok(mk.material.dbId === 'm1' && mk.material.milky === 2 && cl.material.kind === 'milky' && cl.material.dbId === 'm1', '실측 소재 적용: Milky 유지 · 투명 → Milky'); }
{ // 부품 속성 정리: 제목 · 소재 종류 분할 단추 · 간격 한 줄 · 접는 구역(다시 그려도 열림 유지)
  ok(partTitleText({ name: '부품 2', size: [116, 16, 2] }, null) === '부품 2 · 116×16×2 mm' && partTitleText({ name: 'a', size: [20, 5, 1], xform: { scale: [2, 2, 2] } }, { size: [40.04, 10, 2.25] }) === 'a · 40×10×2.3 mm', '제목: 이름 · 크기 mm(부피 없음)');
  const seg = kindSegHtml('opaque');
  ok((seg.match(/<button/g) ?? []).length === 4 && seg.includes('data-m3-kind="opaque" aria-pressed="true"') && seg.includes('data-m3-kind="milky" aria-pressed="false"') && seg.includes('>반투과 백색<') && seg.includes('role="group"'), '소재 종류: 4 단추 · aria-pressed');
  const cs = (rows, leds = [], ledMin = null) => clearanceSummaryHtml({ rows, leds, ledMin, ledAxial: null });
  const touch = cs([{ name: '부품 2', gap: 0, depth: 0 }, { name: '커버', gap: 3, depth: 0 }], [], { led: 0, dist: 1.5 });
  ok(touch.includes('가장 가까운: 부품 2 <b class="touch">접촉</b>') && touch.includes('LED까지 <b class="led">1.5 mm</b>'), '간격 한 줄: 접촉 · LED 거리');
  ok(cs([{ name: '커버', gap: 3.04, depth: 0 }, { name: '가이드', gap: 1.26, depth: 0 }]).includes('가장 가까운: 가이드 <b class="">1.3 mm</b>') && !cs([{ name: 'x', gap: 1, depth: 0 }]).includes('LED'), '간격 한 줄: 가장 가까운 간격 · LED 없음');
  ok(cs([{ name: '커버', gap: 0, depth: 0 }, { name: '<b>', gap: 0, depth: 0.3 }]).includes('&lt;b> <b class="bad">간섭</b>'), '간격 한 줄: 간섭 우선(빨강) · escape');
  ok(cs([]).includes('20 mm 안에 다른 부품 없음') && cs([], [{ name: 'LED 1', gap: 0.8, depth: 0 }]).includes('LED 1 <b class="">0.8 mm</b>') && clearanceSummaryHtml(null) === '', '간격 한 줄: 없음 · LED 부품');
  ok(xfSummaryText({ size: [20, 10, 2], xform: { offset: [2, 0, 0], scale: [1, 1, 3] }, shapeMod: {} }, { center0: [10, 5, 1], size0: [20, 10, 2] }) === '위치 12, 5, 1 · 크기 20×10×6 · 형상 변경됨' && xfSummaryText({ size: [20, 10, 2] }, null) === '크기 20×10×2', '크기·위치 요약');
  resetSections();
  const secs = {}; let html = '';
  const el = { ownerDocument: null, querySelector: () => null, set innerHTML(v) { html = v; }, get innerHTML() { return html; },
    querySelectorAll: (q) => (q === 'details[data-m3-sec]' ? [...html.matchAll(/data-m3-sec="(\w+)"/g)].map(([, id]) => (secs[id] = { dataset: { m3Sec: id }, open: false, addEventListener(k, fn) { this[k] = fn; } })) : []) };
  const P = { ...M, parts: [M.parts[0], { ...M.parts[1], reflMaterial: 'pc-white', finish: { kind: 'whiteDiffuse', R: 0.85 } }] };
  const clr = { rows: [{ name: '커버', gap: 0, depth: 0 }], leds: [], ledMin: { led: 0, dist: 1.5 }, ledAxial: null };
  const sel = { part: 1, face: null, clearance: clr, xfInfo: { center0: [0, 0, 0], size0: [10, 10, 2], lim: null }, catalog: catalogOf(null), meshInfo: null };
  renderPartProps(el, P, sel, [], {});
  // 기본 탭(처음): 소재 종류 · 반사 소재 · 반사율(최대) · 위치·크기 숫자만 · 경고 한 줄 — 접는 구역·가능 범위·비율 고정 없음
  ok(/data-m3-tab="basic" aria-selected="true"/.test(html) && html.includes('data-m3-refl') && html.includes('data-m3-finishr="part"') && html.includes('이 소재 최대') && html.includes('data-m3-xf="c0"') && html.includes('data-m3-xf="z2"')
    && !html.includes('data-m3-sec=') && !html.includes('data-m3-xflock') && !html.includes('data-m3-refladd') && html.includes('가장 가까운: 커버'), '기본 탭: 쉬운 항목만(소재 · 반사율 · 위치·크기) + 경고');
  setPartTab('detail'); renderPartProps(el, P, sel, [], {});
  ok(['xf', 'finish', 'gap'].every((k) => html.includes(`data-m3-sec="${k}"`)) && !/<details[^>]* open/.test(html) && html.includes('<summary>'), '구역: 크기·위치 · 면 처리 · 간격 상세 = 기본 닫힘');
  ok(html.includes('>부품 2 · ') || html.includes(`>${P.parts[1].name} · `), '제목 = 이름 · 크기');
  ok(html.includes('data-m3-refl') && html.includes('data-m3-finishr="part"') && html.includes('상한 ') && !html.includes('data-m3-finish="part"') && html.includes('가장 가까운: 커버'), '불투명 + 반사 소재: 본 줄 = 소재 · 반사율 · 상한, 종류 선택 숨김');
  secs.xf.open = true; secs.xf.toggle();
  renderPartProps(el, P, sel, [], {});
  ok(/data-m3-sec="xf" open/.test(html) && !/data-m3-sec="gap" open/.test(html) && sectionOpen('xf'), '열린 구역: 다시 그려도 열림 유지(1)');
  renderPartProps(el, P, sel, [], {});
  ok(/data-m3-sec="xf" open/.test(html), '열린 구역: 다시 그려도 열림 유지(2)');
  secs.xf.open = false; secs.xf.toggle(); renderPartProps(el, P, sel, [], {});
  ok(!/data-m3-sec="xf" open/.test(html), '닫으면 닫힘 유지');
  renderPartProps(el, P, { ...sel, face: 3 }, [], {});
  ok(/data-m3-sec="finish" open/.test(html) && html.includes('선택한 면 #3') && html.includes('data-m3-finish="face"'), '면 선택 → 면 처리 구역 자동 열기');
  const P0 = { ...P, parts: [P.parts[0], { ...P.parts[1], reflMaterial: undefined }] }; renderPartProps(el, P0, sel, [], {});
  ok(html.includes('data-m3-finish="part"') && html.includes('— 미지정 —'), '반사 소재 미지정 → 면 처리 구역에 종류 선택');
  renderPartProps(el, P, { ...sel, part: 0 }, [], {});
  ok(html.includes('data-m3-mat="dbId"') && html.includes('data-m3-fitdlg') && html.includes('＋ 실측 데이터') && !html.includes('data-m3-mat="milky"'), 'Milky 상세: 실측 소재 · 수지 · 실측 링크');
  setPartTab('basic'); renderPartProps(el, P, { ...sel, part: 0 }, [], {});
  ok(html.includes('data-m3-mat="milky"') && html.includes('확산 (Milky)') && html.includes('data-m3-kind="milky" aria-pressed="true"') && !html.includes('data-m3-fitdlg'), 'Milky 기본: 확산 값 하나');
  resetSections(); }
{ // 좌·우 창 폭 조절(splitter): 기본 260/430 · 비율 → px · 최소 폭 · 3D 최소 280px
  const { splitPx } = await import('../src/ui/m3/splitter.js');
  const d = splitPx(1400, null), a = splitPx(1000, { l: 0.3, r: 0.4 }), b = splitPx(1000, { l: 0.05, r: 0.05 }), c = splitPx(900, { l: 0.5, r: 0.5 });
  ok(d.l === 260 && d.r === 430 && a.l === 300 && a.r === 400 && b.l === 180 && b.r === 260 && 900 - c.l - c.r >= 280 - 1, `splitPx: ${JSON.stringify([d, a, b, c])}`);
}
{ // 1D 프로파일 세로 범위: 최저·목표보다 5% 아래를 10% 단위로 내림
  const { plotRange } = await import('../src/ui/m3/results-panel.js');
  const a = plotRange([{ ys: [1, 0.79, NaN, 0.9] }], 0.8), b = plotRange([{ ys: [1, 0.3] }], 0.8), c = plotRange([{ ys: [1, 0.95] }], null);
  ok(a.y0 === 70 && a.y1 === 102 && b.y0 === 20 && c.y0 === 90, `plotRange: ${[a.y0, b.y0, c.y0]}`); }
done();
