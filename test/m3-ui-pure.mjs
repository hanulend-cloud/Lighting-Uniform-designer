// CAD UI 순수 도우미(DOM 없이): node test/m3-ui-pure.mjs
import { treeNodes, partBadge, renderFeatureTree, treeHtml, toggleVisibility, esc as escT } from '../src/ui/m3/feature-tree.js';
import { calcLabel } from '../src/ui/m3/command-bar.js';
import { judgeText, lumCard, fmtU, buildLut, NO_DATA_RGB, DEFAULT_GUIDE } from '../src/ui/m3/results-panel.js';
import { checkLabels, statusWord, statusIcon, checkAria, isActivateKey, esc as escS } from '../src/ui/m3/status-bar.js';
import { ramp, NO_DATA } from '../src/ui/m3/colormap.js';
import { defaultLight, defaultObserve, defaultChecks } from '../src/engine/mech3d/defs.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { setPartTab, meshInfo, partHeaderText, reflAddFormHtml, renderPartProps, materialPickHtml, ledDistHtml, partTitleText, xfSummaryText, sectionOpen, resetSections } from '../src/ui/mech3d-panel.js';
import { DEFAULT_FINISH_CATALOG, finishCandidatesFor, catalogOf } from '../src/engine/mech3d/housing-led.js';
import { reflDbHtml } from '../src/ui/mech3d-light-panel.js';
import { stepLayoutRowHtml, clampVirtual, virtCountMax, ledRowsHtml, defaultRowGap } from '../src/ui/mech3d-light-panel.js';
import { rowGapOptions } from '../src/engine/mech3d/placement.js';
import { ok, done } from './mech3d-util.mjs';
import { stageAvailability, autoCardHtml, tileConfigHtml, compareHtml, clampCap, overallFrac, etaText, profileSvg, shapeText, screenSummary, reusableCurrent, defaultHousingPart, finishText, applyDz, applyFinish, capDefault, nextFinish } from '../src/ui/m3/autodesign-panel.js';

const M = {
  name: 't', contacts: [{ a: 0, b: 1, mode: 'contact' }], checks: defaultChecks(),
  parts: [setPartMaterialParam(setPartMaterial(defaultPart(0, '커버', 1), 'milky'), 'milky', 3), setPartMaterial(defaultPart(1, '하우징', 1), 'opaque')],
  light: { ...defaultLight(), kind: 'manual' }, observe: { ...defaultObserve(), faces: [{ part: 0, face: 1 }] },
};
// 기구 최적화 왼쪽 칸 + 가운데 타일(항목 스위치·설정)을 합친 HTML — 카드 시험용
const card = (o) => autoCardHtml(o) + ['milky', 'leds', 'shape', 'housing', 'height'].map((k) => tileConfigHtml(k, o).html).join('');
{ const N = treeNodes(M, { node: 'part:0', line: { kind: 'line', closed: false, length: 116, width: 16 } });
  ok(N.map((n) => n.id).join() === 'target,parts,part:0,part:1,light,leds,obs' && N[0].badge === '80% / 80%', `트리 노드(목표 맨 위): ${N.map((n) => n.id).join()}`);
  N.shift();
  ok(N[1].badge === 'Milky 3.0' && N[1].sel && N[1].child && N[2].badge.startsWith('불투명') && N[3].badge === '직접 배치' && N[4].label === 'LED ×10' && N[4].badge === '균등'
    && N[5].badge === '직선 116×16 mm', `배지: ${N.map((n) => n.badge).join(' | ')}`); }
{ const N = treeNodes({ ...M, light: defaultLight() }, { node: null, line: null });
  ok(!N.some((n) => n.id === 'leds') && /인식 중$/.test(N.find((n) => n.id === 'obs').badge) && N.find((n) => n.id === 'light').badge === '지정 안 함', '광원 없음 → LED 노드 없음, 라인 인식 중');
  const N2 = treeNodes({ ...M, observe: defaultObserve() }, { node: null, line: null });
  ok(N2.find((n) => n.id === 'obs').badge === '미지정 — 클릭', '관측면 없음 → 미지정'); }
ok(partBadge(setPartMaterial(defaultPart(0, 'p', 1), 'clear')).startsWith('투명 '), '투명 부품 배지 = 투명 + 투과율');
ok(calcLabel({ state: 'running' }) === '⏸ 계산 중' && calcLabel({ state: 'paused' }) === '▶ 계산 재개' && calcLabel({ state: 'done', reason: 'converged' }).includes('완료')
  && calcLabel({ state: 'done', reason: 'max' }).includes('한도') && calcLabel(null) === '▶ 계산' && calcLabel({ state: 'error' }).includes('다시'), '계산 버튼 문구');
{ const N = treeNodes({ ...M, light: { ...defaultLight(), kind: 'manual', manual: { ...defaultLight().manual, pitch: 11.6000001 } } }, { node: null, line: { kind: 'zigzag', closed: false, length: 99.6, width: 7.4 } });
  ok(N.find((n) => n.id === 'leds').badge === '피치 11.6' && N.find((n) => n.id === 'obs').badge === 'zigzag 100×7 mm', `피치 반올림 · 모르는 라인 종류: ${N.find((n) => n.id === 'leds').badge} / ${N.find((n) => n.id === 'obs').badge}`); }
{ const el = { innerHTML: '', addEventListener() {}, contains: () => false, ownerDocument: null, querySelectorAll: () => [] };
  const P = { ...M, parts: [{ ...M.parts[0], name: `<img src=x onerror="a()">&'` }] };
  renderFeatureTree(el, P, { node: null, line: null }, { onNode() {} });
  ok(!el.innerHTML.includes('<img') && el.innerHTML.includes('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;'), '부품 이름 escape');
  ok(escT(`<>"'&`) === '&lt;&gt;&quot;&#39;&amp;' && escS(`<>"'&`) === '&lt;&gt;&quot;&#39;&amp;', 'esc: 특수문자 5종 모두'); }
{ const h = treeHtml(M, { node: 'part:0', line: null });
  ok(/role="button" tabindex="0" aria-current="true" data-node="part:0"/.test(h) && (h.match(/aria-current/g) ?? []).length === 1 && (h.match(/role="button" tabindex="0"(?: aria-current="true")? data-node=/g) ?? []).length === treeNodes(M, { node: 'part:0', line: null }).length,
    '트리 노드: role=button · tabindex=0 · 선택 노드만 aria-current'); }
{ const N = treeNodes(M, { node: null, line: null, hidden: [1], hideLeds: false }).filter((n) => n.id !== 'target');
  ok(N[0].eye === 'all' && N[1].eye === 'on' && N[2].eye === 'off' && N.find((n) => n.id === 'leds').eye === undefined, '눈 단추: 숨긴 부품 off · 머리 = 모두 보기 · 직접 배치 LED 없음');
  ok(treeNodes(M, { node: null, line: null, hidden: [] }).find((n) => n.id === 'parts').eye === undefined, '숨긴 것 없으면 머리 눈 단추 없음');
  const h = treeHtml(M, { node: null, line: null, hidden: [1] });
  ok(/data-eye="part:1"[^>]*aria-pressed="false"/.test(h) && /class="m3-node child d1  hid"/.test(h), '눈 단추 HTML · 숨긴 행 흐리게');
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
  ok(T.map((t) => t.text).join(' | ') === 'LED–부품 간섭 2건 | 살두께 0.50 mm' && T.map((t) => t.st).join() === 'bad,warn', `점검 배지(조립·성형만): ${T.map((t) => t.text).join(' | ')}`);
  ok(checkLabels({}).every((t) => t.st === 'na' && t.text.endsWith('–')) && checkLabels({ interference: { status: 'ok', count: 0 } })[0].text === 'LED–부품 간섭 없음', '점검 전 → 회색 –'); }
// 반올림: 판정과 표시가 엇갈리지 않게(좋을수록 큰 값은 내림, 작을수록 좋은 값은 올림, 미달 폭은 최소 0.01)
ok(fmtU(0.7999) === '0.79' && fmtU(0.92) === '0.92' && fmtU(0.29) === '0.29' && fmtU(1) === '1.00' && fmtU(NaN) === '–'
  && judgeText(0.7999, 0.8).text === '목표 0.80 · 미달 −0.01', `U 표시 내림 · 미달 폭: ${fmtU(0.7999)} / ${judgeText(0.7999, 0.8).text}`);
{ const st = { profile: Float64Array.from([1, 0.5]) }, a = lumCard(st, { lum: 999.7 }, 1000), e = lumCard({ profile: Float64Array.from([NaN, NaN]) }, null, null);
  ok(a.value === '999 cd/m²' && a.pass === false && a.sub.endsWith('미달 −1') && e.value === '–', `광량 내림·빈 프로파일: ${a.value} ${a.sub} / ${e.value}`); }
{ const { leakText } = await import('../src/ui/m3/status-bar.js');
  ok(checkLabels({ wall: { status: 'warn', min: 0.7996 } })[1].text === '살두께 0.79 mm' && leakText({ status: 'warn', ratio: 0.2004, worst: { part: 1, face: 5, ratio: 0.12 } }, ['케이스', '확산판']) === '새는 빛 21% · 주로 확산판 면 #5 12%'
    && leakText({ status: 'ok', ratio: 0.07, worst: { part: -1, face: -1, ratio: 0.07 } }) === '새는 빛 7% · 주로 틈으로 바로 7%' && leakText({ status: 'na' }) === '', '살두께 내림 · 새는 빛 문구(올림, 가장 많이 새는 면)'); }
ok(judgeText(0.8004, 0.8009).cls === 'ok' && judgeText(0.7999, 0.8).cls === 'bad' && judgeText(0.8, 0.8).cls === 'ok' && judgeText(0.855, 0.8567).text === '목표 0.85 · 합격', '판정 = 표시(내림)값 비교, 목표도 내림 표시');
{ const base = { parts: [{ material: { kind: 'milky' } }, { material: { kind: 'opaque' } }], light: { kind: 'manual' }, observe: { faces: [{ part: 0, face: 1 }] } };
  const a = stageAvailability(base, { non25: [0, 0.5] });
  ok(a.milky.ok && a.leds.ok && a.shape.ok && a.shape.parts.join() === '0', '가능: Milky 부품 있음 · 직접 배치 · 2.5D 부품만 ③ 대상');
  const b = stageAvailability({ ...base, light: { kind: 'step' }, parts: [{ material: { kind: 'clear' } }] }, { non25: [0.5] });
  ok(!b.milky.ok && /Milky 부품/.test(b.milky.why) && !b.leds.ok && /LED STEP/.test(b.leds.why) && /기준/.test(b.leds.why) && !b.shape.ok, '불가 이유: Milky 없음 · LED STEP 기준 LED 없음 · 2.5D 아님');
  const stepL = (emitters, excluded = []) => stageAvailability({ ...base, light: { kind: 'step', step: { leds: [1, 2], excluded, emitters } } }, { non25: [0, 0.5] }).leds;
  const s1 = stepL([{ part: 1 }, { part: 2 }]), s2 = stepL([{ part: 1, needsCheck: true }, { part: 2 }], [2]), s3 = stepL([{ part: 2 }], [1]);
  ok(s1.ok && s1.note === 'LED STEP — 기준 LED 를 복사해 개수·간격 조정' && !s2.ok && /기준/.test(s2.why) && s3.ok, 'LED STEP ②: 기준 발광점(확인 필요·제외 아님) 있으면 가능, 없으면 이유');
  ok(card({ avail: { ...a, leds: s1 }, sel: { leds: true }, running: null }).includes('기준 LED 를 복사해 개수·간격 조정'), '카드: LED STEP ② 안내 문구');
  const h = card({ avail: a, sel: { milky: true, leds: false, shape: false, shapePart: 0 }, running: null });
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
  const h1 = card({ avail: a, sel: { milky: true }, running: null }), h2 = card({ avail: a, sel: { milky: true, leds: true }, running: null });
  ok(!h1.includes('data-ad="milkyMax"') && !h2.includes('data-ad="milkyMax"'), '카드: Milky 상한 입력칸 없음(상한 = 자동)'); }
// ④ 보완 계산 후보: 현재보다 높은 등급(gradeOf) 중 가장 낮은 것 · 최고 등급이면 null
ok(nextFinish({ kind: 'whiteDiffuse', R: 0.85 })?.R === 0.95 && nextFinish({ kind: 'whiteDiffuse', R: 0.85 }).kind === 'whiteDiffuse' && nextFinish({ kind: 'whiteDiffuse', R: 0.9 })?.R === 0.97
  && nextFinish({ kind: 'metal', R: 0.88 })?.R === 0.95 && nextFinish({ kind: 'whiteDiffuse', R: 0.97 }) === null && nextFinish(null)?.R === 0.85 && nextFinish({ kind: 'gloss' })?.R === 0.85, '④ 보완 안내: 같은 종류 +0.10 이상 최저(백색 85→95, 90→97) · 최고면 없음');
ok(clampCap(12) === 9.9 && clampCap(0.1) === 0.5 && clampCap(3) === 3 && clampCap(0) === null && clampCap(-2) === null && clampCap(NaN) === null, 'Milky 상한: 0.5~9.9 로 자름 · 0/음수/NaN = 기본');
{ const all = { milky: true, leds: true, shape: true }, m = { milky: true };
  ok(overallFrac(m, 'current', 0) === 0 && Math.abs(overallFrac(m, 'milky', 0) - 5 / 50) < 1e-12 && Math.abs(overallFrac(m, 'milky', 0.5) - 22.5 / 50) < 1e-12 && overallFrac(m, 'verify', 1) === 1, '전체 진행률: 켠 단계만 정규화(① 만 = 5+35+10)');
  ok(Math.abs(overallFrac(all, 'shape', 0) - 40 / 135) < 1e-12 && overallFrac(all, 'shape', 2) <= 1 && overallFrac(m, 'shape', 0.5) === 0, '전체 진행률: 단계 순서(② → ③ → ①)·무게 · 꺼진 단계 = 0');
  const hh = { leds: true, height: true, housing: true, milky: true };
  ok(Math.abs(overallFrac(hh, 'height', 0) - 40 / 125) < 1e-12 && Math.abs(overallFrac(hh, 'housing', 0.5) - 70 / 125) < 1e-12 && Math.abs(overallFrac(hh, 'milky', 0) - 80 / 125) < 1e-12, '전체 진행률: ⑤ 높이·④ 케이스 면(각 20)은 ② 와 ① 사이');
  ok(etaText(5000, 0.05) === '' && etaText(10000, 0.5) === '남은 약 10초' && etaText(1000, 1) === '', `남은 시간: 10% 이후만 (${etaText(10000, 0.5)})`); }
{ const s = profileSvg([1, 2, NaN, 4], [3, 3, 3, 3]);
  ok((s.match(/<polyline/g) ?? []).length === 2 && s.includes('<svg') && profileSvg(null, [1]) === '' && profileSvg([], [1]) === '', '길이 프로파일 SVG: 선 2개 · 없으면 생략');
  const base = { parts: [{ material: { kind: 'milky' } }], light: { kind: 'manual' }, observe: { faces: [] } }, a = stageAvailability(base, { non25: [0] });
  const run = card({ avail: a, sel: { milky: true, shape: true, shapePart: 0 }, running: { frac: 0.4, text: 'x' }, names: ['LGP'], milkyPart: 0 });
  ok(/data-ad="milky" checked disabled/.test(run) && /data-ad="shapePart"[^>]*disabled/.test(run) && /role="progressbar"[^>]*aria-valuenow="40"/.test(run) && run.includes('대상: LGP'), '실행 중: 입력 비활성 · 진행 막대 aria · ① 대상 부품');
  const nl = card({ avail: a, sel: { milky: true }, running: null, noLine: true });
  ok(/data-ad="run" disabled title="관측 라인이 없음"/.test(nl), '라인 없음 → 실행 비활성');
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
  ok(stepLayoutRowHtml({ ...st, virtual: { count: 6, pitch: 15 } }, ln).includes('기구 최적화 배치 6개 피치 15mm'), '배치 행: 기구 최적화 균등 배치 표시');
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
  const h = card({ avail: a, sel: { height: true, housing: true, housingPart: 2 }, running: null, names: ['LGP', '케이스', '덮개'] });
  ok(h.includes('data-ad="height" checked') && h.includes('data-ad="housing" checked') && /<option value="2" selected>덮개/.test(h) && !/data-ad="run" disabled/.test(h) && tileConfigHtml('position', { avail: a, sel: { height: true } }).html.includes('data-ad="position" checked'), '카드: ⑤ 켜짐 = ② 기구 위치 사용 · 실행 가능');
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
  const h1 = card({ avail: a, sel: { housing: true, housingPart: 1, housingSpecial: true }, running: null, names: ['LGP', '케이스'], housingMat: { name: '백색 PC(일반 착색)', max: 0.9 } });
  const h0 = card({ avail: a, sel: { housing: true, housingPart: 1 }, running: null, names: ['LGP', '케이스'], housingMat: null });
  ok(h1.includes('백색 PC(일반 착색) · 최대 90%') && /data-ad="housingSpecial" checked/.test(h1) && h1.includes('특수 표면처리 허용'), '카드 ④: 소재·상한 · 특수 허용 체크');
  ok(h0.includes('소재 미지정') && /data-ad="housingSpecial"(?! checked)/.test(h0) && card({ avail: a, sel: { housing: false, housingPart: 1 }, running: null, names: ['LGP', '케이스'] }).includes('housingSpecial'), '카드 ④: 소재 미지정 안내 · 체크 전에도 대상·특수 설정(③ 형상과 같게)');
  { const { materialGroups } = await import('../src/engine/mech3d/material-pick.js');
    const G = materialGroups({ milky: [{ id: 'm1', name: 'DQ5122', n: 1.586 }], clear: [{ id: 'u:A', name: 'A', n: 1.58, T: 0.9, tRef: 2 }], refl: C });
    const r = materialPickHtml({ material: { kind: 'opaque' }, reflMaterial: 'pc-white' }, G), r0 = materialPickHtml({ material: { kind: 'milky', dbId: 'm1' } }, G);
    ok(/<option value="opaque:pc-white" selected>/.test(r) && !r.includes('coat-') && r.includes('<optgroup label="투명">') && r.includes('value="clear:u:A"') && r.includes('value="wt"') && /value="milky:m1" selected/.test(r0), '소재 고르기: DB 전체 · 종류별 묶음 · 지금 소재 선택');
    ok(materialPickHtml({ material: { kind: 'opaque' }, reflMaterial: 'gone' }, G).includes('<option value="" selected>없는 소재'), '소재 고르기: 지워진 DB 항목 → 없는 소재'); }
  const q = setPartMaterial({ ...defaultPart(0, 'c', 1), reflMaterial: 'pc-white', coating: 'coat-white' }, 'opaque');
  ok(!('reflMaterial' in q) && !('coating' in q), '소재 종류 바꾸면 반사 소재·특수 표시 해제');
  const t = reflDbHtml(catalogOf(null)), U = { ...catalogOf(null)[1], id: 'u1', name: '사내 PC', origin: 'user', status: 'measured', nSamples: 3 }, t1 = reflDbHtml([U]);
  ok(t.includes('반사 소재 DB') && !t.includes('data-lp-cat=') && t.includes('data-lp-dbcopy="pc-white"') && !t.includes('data-lp-dbdel') && t.includes('예시') && t.includes('85') && t.includes('data-lp-dbexp') && /type="file"[^>]*data-lp-dbimp|data-lp-dbimp[^>]*type="file"/.test(t), '소재 DB: 공용 = 읽기 전용 + [복사] · 내보내기·불러오기');
  ok(/data-lp-catname="u1"[^>]*value="사내 PC"|value="사내 PC"[^>]*data-lp-catname="u1"/.test(t1) && /data-lp-cat="u1" data-lp-catk="R"[^>]*value="85"|value="85"[^>]*data-lp-cat="u1" data-lp-catk="R"/.test(t1) && t1.includes('data-lp-catk="max"') && t1.includes('data-lp-dbadd="u1"') && t1.includes('data-lp-dbdel="u1"') && t1.includes('실측 3회') && !t1.includes('data-lp-addv'), '소재 DB: 사용자 = 이름·R·상한 편집 · 측정값 추가 · 삭제');
  const t2 = reflDbHtml([U], { addFor: 'u1' });
  ok(t2.includes('data-lp-addv') && t2.includes('data-lp-addok="u1"') && t2.includes('<option>SCI 8°/d</option>') && t2.includes('data-lp-addn'), '소재 DB: 측정값 추가 인라인(값 %·조건·메모)');
  const sp = reflDbHtml([{ ...catalogOf(null).find((e) => e.special), id: 'u2', origin: 'user' }]);
  ok(!/data-lp-cat="u2" data-lp-catk="R"/.test(sp) && /data-lp-cat="u2" data-lp-catk="max"/.test(sp) && sp.includes('특수'), '소재 DB: 특수 처리 = 상한만');
  const f0 = reflAddFormHtml(), fm = reflAddFormHtml('이름을 입력하세요');
  ok(fm.includes('data-m3-raok') && fm.includes('이름을 입력하세요') && ['name', 'kind', 'values', 'cond', 'note', 'max'].every((k) => f0.includes(`data-m3-ra="${k}"`)) && f0.includes('<option value="metal">경면</option>') && f0.includes('<option>0°/45°</option>'), '추가 양식: 이름·종류·값 %·조건·메모·상한');
  ok(finishText({ ...W(0.96), coating: 'u-coat' }, [...C, { id: 'u-coat', name: '사내 반사시트', kind: 'whiteDiffuse', R: null, max: 0.96, special: true }]) === '백색 96% (특수: 사내 반사시트)' && finishText({ ...W(0.97), coating: 'coat-white' }, C) === '백색 97% (특수: 고반사 도장)', '면 처리 문구: 사용자 특수 항목'); }

{ // 부품 속성 정리: 제목 · 소재 종류 분할 단추 · 간격 한 줄 · 접는 구역(다시 그려도 열림 유지)
  ok(partTitleText({ name: '부품 2', size: [116, 16, 2] }, null) === '부품 2 · 116×16×2 mm' && partTitleText({ name: 'a', size: [20, 5, 1], xform: { scale: [2, 2, 2] } }, { size: [40.04, 10, 2.25] }) === 'a · 40×10×2.3 mm', '제목: 이름 · 크기 mm(부피 없음)');
  const ld = ledDistHtml({ rows: [], leds: [], ledMin: { led: 2, dist: 3.46 }, ledAxial: { led: 2, dist: 3.1 } });
  ok(ld.includes('LED까지 <b class="led">3.5 mm</b>') && ld.includes('(LED 3)') && ld.includes('축 방향 <b>3.1 mm</b>') && ledDistHtml(null) === '' && ledDistHtml({ rows: [], leds: [], ledMin: null }) === '', 'LED 까지 거리 한 줄 · 없으면 표시 안 함');
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
  ok(/data-m3-tab="basic" aria-selected="true"/.test(html) && /value="opaque:pc-white" selected/.test(html) && html.includes('확산 반사 85% (최대 90%)') && !html.includes('data-m3-finishr') && html.includes('data-m3-xf="c0"') && html.includes('data-m3-xf="z2"')
    && !html.includes('data-m3-sec=') && !html.includes('data-m3-xflock') && !html.includes('data-m3-refladd') && !html.includes('data-m3-kind') && !html.includes('가장 가까운') && html.includes('LED까지 <b class="led">1.5 mm</b>'), '기본 탭: 소재 이름 고르기 · 물성 한 줄(읽기 전용) · 위치·크기 · LED 까지 거리 + 경고');
  renderPartProps(el, P, { ...sel, admin: true }, [], {});
  ok(html.includes('data-m3-finishr="part"') && html.includes('상한 90%') && html.includes('관리자'), '관리자 모드: 숫자 물성 칸(반사율·상한)');
  setPartTab('detail'); renderPartProps(el, P, sel, [], {});
  ok(['xf', 'finish'].every((k) => html.includes(`data-m3-sec="${k}"`)) && !html.includes('data-m3-sec="gap"') && !/<details[^>]* open/.test(html) && html.includes('<summary>'), '구역: 크기·위치 · 면 처리 = 기본 닫힘 · 간격 상세 없음');
  ok(html.includes('>부품 2 · ') || html.includes(`>${P.parts[1].name} · `), '제목 = 이름 · 크기');
  ok(!html.includes('data-m3-pick') && !html.includes('data-m3-refladd') && !html.includes('data-m3-sec="refldb"') && html.includes('면 처리 종류는 반사 소재가 정함') && !html.includes('data-m3-finish="part"'), '상세 탭: 소재 고르기·DB 구역 없음 · 종류 선택 숨김');
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
  ok(html.includes('data-m3-finish="part"'), '반사 소재 미지정 → 면 처리 구역에 종류 선택');
  renderPartProps(el, P, { ...sel, part: 0 }, [], {});
  ok(!html.includes('data-m3-mat="dbId"') && !html.includes('data-m3-fitdlg') && !html.includes('data-m3-mat="milky"'), 'Milky 상세: 소재 고르기 없음(기본 탭으로)');
  setPartTab('basic'); renderPartProps(el, P, { ...sel, part: 0 }, [], {});
  ok(html.includes('data-m3-mat="milky"') && html.includes('확산 정도') && /value="milky" selected/.test(html) && !html.includes('data-m3-mat="dbId"') && !html.includes('data-m3-fitdlg') && !html.includes('data-m3-mat="resin"'), 'Milky 기본: 소재 이름 + 확산 정도(Milky 값)만');
  renderPartProps(el, P, { ...sel, part: 0, admin: true }, [], {});
  ok(html.includes('data-m3-mat="resin"'), 'Milky 관리자: 수지 칸');
  { const Q = { ...P, parts: [{ ...P.parts[0], material: { kind: 'clear', resin: 'PMMA', T: 0.92, tRef: 2 } }, P.parts[1]] };
    renderPartProps(el, Q, { ...sel, part: 0, clearList: [{ id: 'u:사내 PC', name: '사내 PC', base: 'PC', n: 1.585, T: 0.88, tRef: 3, origin: 'user' }] }, [], {});
    ok(/value="clear:PMMA" selected/.test(html) && html.includes('사내 PC (측정)') && html.includes('굴절률 1.49 · 투과율 92%') && !html.includes('data-m3-clearadd') && !html.includes('data-m3-mat="T"'), '투명 기본: 굴절률별 기본·측정 소재 이름 · 물성 한 줄');
    const Q2 = { ...Q, parts: [{ ...Q.parts[0], material: { kind: 'clear', resin: 'PC', n: 1.585, matId: 'u:사내 PC', T: 0.88, tRef: 3 } }, P.parts[1]] };
    renderPartProps(el, Q2, { ...sel, part: 0, clearList: [{ id: 'u:사내 PC', name: '사내 PC', base: 'PC', n: 1.585, T: 0.88, tRef: 3, origin: 'user' }] }, [], {});
    ok(/value="clear:u:사내 PC" selected/.test(html) && html.includes('굴절률 1.585 · 투과율 88% (3 mm) · 측정값'), '투명: 측정 소재 선택 · 측정 굴절률 표시'); }
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
{ // 최적화·시뮬레이션 대시보드(순수)
  const { tileOf, evalSparkSvg, simPct, STAGES } = await import('../src/ui/m3/opt-dash.js');
  ok(STAGES.length === 4 && tileOf('milky') === 'milky' && tileOf('leds') === 'position' && tileOf('height') === 'position' && tileOf('shape') === 'shape' && tileOf('verify') === null && tileOf('housing') === 'housing', `4 타일(Milky · 기구 위치 · 기구 형상 · 케이스 면) · 단계 → 타일`);
  const sv = evalSparkSvg([{ label: 'a', Ulen: 0.7, Uwid: 0.6 }, { label: 'b', ok: false, why: '간섭' }, { label: 'c', Ulen: 0.82, Uwid: 0.81 }], 0.8, 0.8, 2);
  ok(sv.includes('od-l1') && sv.includes('od-d1') && sv.includes('od-best') && sv.includes('od-tg') && sv.includes('×'), '후보 그래프: 점·최고·목표·탈락(×)');
  ok(evalSparkSvg([], 0.8, 0.8).includes('후보 결과 없음'), '후보 없음');
  ok(simPct(0.04, 0.02) === 25 && simPct(0.02, 0.02) === 100 && simPct(0.01, 0.02) === 100 && simPct(NaN, 0.02) === 0, `진행률 = (목표/오차)² (${simPct(0.04, 0.02)})`); }
{ // 아래 칸 높이: 최소 120 · 3D·결과 칸 최소 240(+명령·상태줄 90) 남김
  const { clampDock } = await import('../src/ui/m3/splitter.js');
  ok(clampDock(250, 900) === 250 && clampDock(50, 900) === 120 && clampDock(800, 900) === 570 && clampDock(300, 400) === 120, `clampDock: ${[clampDock(250, 900), clampDock(50, 900), clampDock(800, 900), clampDock(300, 400)]}`); }
{ // 광경로 순위(순수): 기구 부품만 · 같은 경로 합침 · 비중 순
  const { topPaths, pathText } = await import('../src/ui/m3/opt-dash.js');
  const t = topPaths({ ':2>1': 50, 'R:2>1': 25, ':2>1>5': 10, 'R:2>1>2>1': 15 }, 3);
  ok(t.length === 3 && t[0].share === 0.6 && t[0].parts.join() === '2,1' && !t[0].refl && t[1].refl && pathText(t[0], ['a', 'b', 'c']) === 'LED → c → b → 관측면', `topPaths: ${JSON.stringify(t.map((x) => [x.parts.join('>'), x.refl, x.share]))}`); }
done();

{ const { clearDbHtml } = await import('../src/ui/mech3d-panel.js');
  const h = clearDbHtml([{ id: 'u:A', name: 'A<', base: 'PMMA', n: 1.49, T: 0.9, tRef: 2, note: '' }], { 'u:A': 2 });
  console.log(h.includes('data-m3-cdb="u:A"') && h.includes('부품 2개 사용') && h.includes('value="1.49"') && h.includes('A&lt;') && h.includes('data-m3-cdbdel') && clearDbHtml([]).includes('등록한 측정값 없음') ? 'PASS 투명 측정값 DB 관리 표' : (process.exitCode = 1, 'FAIL 투명 측정값 DB 관리 표')); }
{ const { materialGroups, pickOf, materialSummary } = await import('../src/engine/mech3d/material-pick.js');
  const ok4 = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
  ok4(pickOf({ material: { kind: 'milky', dbId: '' } }) === 'milky' && pickOf({ material: { kind: 'clear', resin: 'PMMA' } }) === 'clear:PMMA' && pickOf({ material: { kind: 'clear', resin: 'PC', matId: 'u:A' } }) === 'clear:u:A' && pickOf({ material: { kind: 'whiteTrans' } }) === 'wt' && pickOf({ material: { kind: 'opaque' }, reflMaterial: 'x' }) === 'opaque:x', '소재 고르기 id');
  ok4(materialSummary({ material: { kind: 'clear', resin: 'PMMA', T: 0.92, tRef: 2 } }) === '굴절률 1.49 · 투과율 92% (2 mm)' && materialSummary({ material: { kind: 'opaque' }, reflMaterial: 'gone', finish: { kind: 'whiteDiffuse', R: 0.8 } }, { refl: [] }).includes('없는 소재'), '물성 한 줄');
  ok4(materialGroups({}).length === 4 && materialGroups({}).every((g) => g.items.length > 0), '목록 묶음 4개'); }
{ const { resultLineHtml } = await import('../src/ui/m3/autodesign-panel.js');
  const ok5 = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) process.exitCode = 1; };
  const base = { unchanged: true, feasible: true, cur: { Ulen: 0.83, Uwid: 0.8 }, best: { Ulen: 0.83, Uwid: 0.8 }, targets: { len: 0.8, wid: 0.8 } };
  const a = resultLineHtml({ ...base, alt: { design: { milky: 2.47 }, milky: 2.47, Ulen: 0.84, Uwid: 0.8 } }), b = resultLineHtml(base);
  ok5(/data-ad="apply" disabled/.test(a) && a.includes('data-ad="applyAlt"') && a.includes('그래도 적용 (Milky 2.47) · 0.84/0.80') && !b.includes('applyAlt'), '현재안 유지 + 찾은 후보 → [그래도 적용]'); }
{ const { etaText } = await import('../src/ui/m3/opt-dash.js');
  const H = [{ ph: 1e6, t: 0, noise: 0.1 }, { ph: 2e6, t: 5000, noise: 0.07 }, { ph: 3e6, t: 10000, noise: 0.0577 }];
  const e = etaText(H, 0.02);
  console.log(e.includes('필요 광자 ≈ 2,497만') && e.includes('남은 ≈ 2분') && etaText([{ ph: 1, t: 0, noise: 0.01 }], 0.02) === '' ? 'PASS 남은 계산 예상(필요 광자·시간)' : (process.exitCode = 1, `FAIL 남은 계산 예상: ${e}`)); }
{ const { mapLayout } = await import('../src/ui/m3/results-panel.js');
  const G = { w0: -2.75, nw: 8, cell: 0.6875, L: 440, ns: 110 }, a = mapLayout(G, 600, 180, 1), b = mapLayout({ w0: -12, nw: 8, cell: 3, L: 116, ns: 100 }, 600, 180, 1);
  const [x, y] = a.xy(250, 1), back = a.at(x, y);
  console.log(a.K === 1 && a.exag <= 8.01 && a.rowH >= 28 && a.rowH < 142 && Math.abs(back[0] - 250) < 1e-6 && Math.abs(back[1] - 1) < 1e-6 && b.K === 1 && b.rowH === 142 ? `PASS 2D 지도: 한 줄 · 길고 좁은 면은 폭 ×${a.exag.toFixed(1)} 까지(띠 ${a.rowH.toFixed(0)} px) · 넓은 면은 상자 가득 · 좌표 왕복` : (process.exitCode = 1, `FAIL 2D 지도 ${a.K} ${a.exag} ${a.rowH} ${b.rowH}`)); }
{ const { reachDiag } = await import('../src/ui/m3/opt-dash.js');
  const L = { emitted: 1, escaped: 0.7, absSurf: 0.2, absVol: 0.1 }, d = reachDiag(L, { '1|5': 0.5, '-1|-1': 0.15, '2|0': 0.0495 }, ['케이스', '확산판', '커버']);
  console.log(d && d.html.includes('관측면에 도착한 빛 0.050%') && d.html.includes('거의 없음') && d.html.includes('확산판 면 #5 50%') && d.html.includes('LED에서 바로 공기로') && d.html.includes('흡수 30%') && reachDiag(L, { '1|5': 0.3 }, []) === null ? 'PASS 빛 도달 진단(관측면 < 1% → 빛이 간 곳)' : (process.exitCode = 1, `FAIL 빛 도달 진단 ${d?.html}`)); }
{ const { pointProfiles } = await import('../src/ui/m3/results-panel.js');
  // 3×2 격자(k = i·nw + j), 칸 (1,0) 은 관측면 밖 → NaN. 각 곡선은 자기 최대 = 1
  const G = { ns: 3, nw: 2, valid: [1, 1, 0, 1, 1, 1] }, map = [2, 4, 9, 8, 1, 6];
  const p = pointProfiles(G, map, 2, 1), q0 = pointProfiles(G, map, 1, 0);
  const near = (a, b) => a.length === b.length && a.every((v, k) => (Number.isNaN(b[k]) ? Number.isNaN(v) : Math.abs(v - b[k]) < 1e-9));
  console.log(near(p.along, [4 / 8, 8 / 8, 6 / 8]) && near(p.across, [1 / 6, 1]) && near(q0.along, [2 / 2, NaN, 1 / 2]) && near(q0.across, [NaN, 1]) ? 'PASS 지정 점 프로파일: 길이(w 고정)·폭(s 고정) 곡선 · 관측면 밖 = 끊김' : (process.exitCode = 1, `FAIL 지정 점 프로파일 ${JSON.stringify([...p.along])} ${JSON.stringify([...q0.across])}`)); }
{ const { cropFinite, smoothCurve, mapTxt } = await import('../src/ui/m3/results-panel.js');
  // 폭 프로파일 가로축 = 값이 있는 칸 범위로(양끝 NaN 칸 잘라냄 — 모든 곡선 기준)
  const c = cropFinite([{ ys: [NaN, 0.5, 1, NaN] }, { ys: [NaN, NaN, 0.8, NaN] }], -2, 2);
  const okC = c.x0 === -1 && c.x1 === 1 && c.curves[0].ys.length === 2 && c.curves[1].ys[0] !== c.curves[1].ys[0] && c.curves[1].ys[1] === 0.8 && cropFinite([{ ys: [NaN, NaN] }], 0, 1).x1 === 1;
  // 평활(표시용): 가우스 σ 칸, NaN 은 건너뛰고 자리 유지, 상수는 그대로, 튀는 점은 줄어듦
  const sm = smoothCurve([1, 1, 1, 2, 1, 1, 1, NaN, 1], 1);
  const okS = Math.abs(smoothCurve([0.7, 0.7, 0.7], 1)[1] - 0.7) < 1e-12 && sm[3] < 1.6 && sm[3] > 1 && Number.isNaN(sm[7]) && Math.abs(sm[8] - 1) < 1e-9;
  // 2D TXT: 머리말 + w(위→아래) × s 표, 최대 = 100(%), 관측면 밖 = 빈칸
  const G = { ns: 2, nw: 2, ds: 5, cell: 1, w0: -1, L: 10, valid: [1, 1, 0, 1] }, t = mapTxt(G, [1, 2, 9, 4], { name: 'x' }), rows = t.split('\n');
  const okT = t.startsWith('#') && rows.some((r) => r === 'w\\s(mm)\t2.5\t7.5') && rows.some((r) => r === '0.5\t50.00\t100.00') && rows.some((r) => r === '-0.5\t25.00\t');
  console.log(okC && okS && okT ? 'PASS 폭 범위 맞춤 · 표시 평활(σ칸, NaN 유지) · 2D 분포 TXT' : (process.exitCode = 1, `FAIL 폭/평활/TXT ${okC} ${okS} ${okT} ${JSON.stringify(sm)} ${JSON.stringify(rows)}`)); }
{ const { mapViewG } = await import('../src/ui/m3/results-panel.js');
  const G = { ns: 2, nw: 4, cell: 1, w0: -2, valid: [0, 1, 1, 0, 0, 0, 1, 0] }, v = mapViewG(G), e = mapViewG({ ns: 1, nw: 2, cell: 1, w0: 0, valid: [0, 0] });
  console.log(v.w0 === -1 && v.nw === 2 && v.jA === 1 && v.jB === 2 && mapViewG(G) === v && e.nw === 2 && e.jA === 0 ? 'PASS 2D 표시 폭 = 값 있는 w 줄만' : (process.exitCode = 1, `FAIL 2D 폭 ${JSON.stringify(v)}`)); }
{ const { profileTxt } = await import('../src/ui/m3/results-panel.js');
  // 1D TXT: 그림마다 머리말 + x 칸 중심 · 곡선별 %(원자료 raw 우선, 없음 = 빈칸)
  const t = profileTxt([{ title: '길이 방향 1D', v: { curves: [{ name: '폭 평균', ys: [0.9, 1], raw: [0.8, 1] }, { name: 'B', ys: [NaN, 0.5] }], opt: { x0: 0, x1: 10, xl: 's (mm)' } } }, { title: '폭', v: null }]);
  const L = t.split('\n');
  console.log(L.includes('# 길이 방향 1D') && L.includes('s (mm)\t폭 평균\tB') && L.includes('2.5\t80.00\t') && L.includes('7.5\t100.00\t50.00') && !t.includes('# 폭') ? 'PASS 1D 프로파일 TXT(원자료 %, 없는 그림 생략)' : (process.exitCode = 1, `FAIL 1D TXT ${JSON.stringify(L)}`)); }
{ const { clampRect } = await import('../src/ui/m3/monitor.js');
  // 처음 = 오른쪽에 붙임, 화면 밖으로 끈 창 = 안으로, 너무 큰 창 = 화면 크기로, 너무 작은 창 = 최소 크기
  const a = clampRect({ x: null, y: 90, w: 460, h: 560 }, 1600, 900), b = clampRect({ x: 5000, y: -50, w: 460, h: 560 }, 1600, 900), c = clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, 1000, 700), d = clampRect({ x: 10, y: 10, w: 10, h: 10 }, 1000, 700);
  console.log(a.x === 1124 && a.y === 90 && b.x === 1132 && b.y === 8 && c.w === 984 && c.h === 684 && d.w === 320 && d.h === 160 ? 'PASS 시뮬레이션 모니터 창 위치·크기 맞춤' : (process.exitCode = 1, `FAIL 모니터 ${JSON.stringify([a, b, c, d])}`)); }
{ const { factorBoardHtml, beforeAfterHtml } = await import('../src/ui/m3/opt-dash.js');
  // 설계 인자 현황: 줄 앞 체크 상자(켜기·끄기), 켠 항목만 설정 줄, 못 쓰는 항목 = 비활성
  const cfg = (k) => ({ milky: { on: true, box: '<input type="checkbox" data-ad="milky" checked>', opt: '<div class="od-opt">상한</div>', why: 'Milky' }, position: { on: false, box: '<input type="checkbox" data-ad="position">', opt: '', why: '' }, shape: { on: false, box: '<input type="checkbox" data-ad="shape" disabled>', opt: '', why: '확산 부품 없음' } })[k];
  const h = factorBoardHtml(null, { milky: 2 }, cfg);
  const okB = h.includes('data-ad="milky" checked') && h.includes('data-ad="position"') && h.includes('data-ad="shape" disabled') && (h.match(/class="fb-opt"/g) ?? []).length === 1 && h.includes('title="확산 부품 없음"');
  // 최적화 타일 전후: 사양·길이 균일도·폭 균일도, 바뀐 칸 강조, 목표 통과 ✓/✕
  const t = beforeAfterHtml('milky', { milky: 2, Ulen: 0.58, Uwid: 0.64 }, { label: 'Milky 3.50', Ulen: 0.82, Uwid: 0.71 }, 0.8, 0.8, 7);
  const okT = t.includes('Milky 2.00') && t.includes('<td class="chg">Milky 3.50') && /0\.82 <b class="od-ok">✓/.test(t) && /0\.71 <b class="od-bad">✕/.test(t) && t.includes('후보 7개') && beforeAfterHtml('shape', {}, null).includes('후보 없음');
  console.log(okB && okT ? 'PASS 설계 인자 현황 체크(켜기·설정) · 최적화 타일 전후 사양표' : (process.exitCode = 1, `FAIL 인자 체크/전후 ${okB} ${okT} ${t}`)); }
{ const { flowState } = await import('../src/ui/m3/command-bar.js');
  // 흐름 4 광분포 시뮬레이션 → 5 기구 최적화: 계산 중 % · 완료 통과/미달 · 미달이면 5 '필요' · 최적화 진행 중
  const M = { observe: { targetLen: 0.8, targetWid: 0.8, targetNoise: 0.01 } }, st = (a, b) => ({ Ulen: a, Uwid: b });
  const r1 = flowState({ state: 'running', stats: { relNoise: 0.02 } }, st(0.58, 0.64), M), r2 = flowState({ state: 'done' }, st(0.58, 0.64), M), r3 = flowState({ state: 'done' }, st(0.85, 0.9), M), r4 = flowState({ state: 'done' }, st(0.58, 0.64), M, { running: true });
  console.log(r1.sim.text === '계산 중 50% · 58% / 64%' && r1.opt.text === '시뮬레이션 뒤' && r2.sim.cls === 'bad' && r2.sim.done && r2.opt.cls === 'need' && r3.sim.cls === 'ok' && r3.opt.done && r4.opt.text === '진행 중' && flowState(null, null, M).sim.text === '–'
    ? 'PASS 흐름 4 광분포 시뮬레이션 · 5 기구 최적화 상태' : (process.exitCode = 1, `FAIL 흐름 ${JSON.stringify([r1, r2, r3, r4])}`)); }
{ const { resultLineHtml, limitText } = await import('../src/ui/m3/autodesign-panel.js');
  // 결과 카드: 판정 한 단어 · 비교표 = 바뀐 사양 + 길이 균일도·폭 균일도·광 효율(안 바뀐 LED 줄 없음) · 한계 한 줄 · [자세히]
  const r = { unchanged: false, feasible: false, reason: '목표 미달 (균일도 최고 … · 한계: 길이 방향 — 끝단이 가장 어두움 · ④ 케이스)', targets: { len: 0.8, wid: 0.8 },
    cur: { count: 40, pitch: 10, milky: 1.43, Ulen: 0.61, Uwid: 0.6, eff: 0.107 }, best: { count: 40, pitch: 10, milky: 1.8, Ulen: 0.66, Uwid: 0.62, eff: 0.1 } };
  const h = resultLineHtml(r);
  console.log(h.includes('m3-rcard bad') && h.includes('목표 미달') && h.includes('<th>Milky') && !h.includes('<th>LED') && h.includes('<th>길이 균일도') && h.includes('<th>광 효율') && h.includes('💡 한계: 길이 방향 — 끝단이 가장 어두움') && h.includes('data-ad="view"') && limitText('없음') === ''
    ? 'PASS 기구 최적화 결과 카드(판정·바뀐 사양만·한계 한 줄)' : (process.exitCode = 1, `FAIL 결과 카드 ${h}`)); }
{ const { milkyTable, milkyTableHtml } = await import('../src/ui/m3/autodesign-panel.js');
  // Milky 조정 표: 마지막 Milky 단계 기록(뒤에서부터 연속 'milky', ② 기준 'ledsRef' 제외)만 · 같은 Milky 는 정밀(나중) 값 · 믿는 행만 · Milky 오름차순
  const row = (m, u, w, e, t = true) => ({ milky: m, Ulen: u, Uwid: w, eff: e, trusted: t });
  const steps = [{ stage: 'milky', phase: 'ledsRef', rows: [row(9, 0.1, 0.1, 0.01)] }, { stage: 'leds' }, { stage: 'shape' },
    { stage: 'milky', phase: 'coarse', rows: [row(1, 0.6, 0.6, 0.11), row(3, 0.75, 0.7, 0.08), row(5, 0.8, 0.79, 0.05, false)] }, { stage: 'milky', phase: 'peak', precise: true, rows: [row(3, 0.78, 0.74, 0.081), row(3.5, 0.81, 0.8, 0.07)] }];
  const T = milkyTable(steps), h = milkyTableHtml(T, 3.5, { len: 0.8, wid: 0.8 });
  const many = Array.from({ length: 80 }, (_, k) => row(+(0.25 + k * 0.025).toFixed(3), 0.5, 0.5, 0.1)), hm = milkyTableHtml(many, 1.43, {});
  console.log((hm.match(/<tr/g) ?? []).length <= 14 && hm.includes('1.43 <span') && T.map((r) => `${r.milky}:${r.Ulen}`).join() === '1:0.6,3:0.78,3.5:0.81' && h.includes('data-ad="applyMilky" data-v="1"') && /class="sel"[^]*3\.50/.test(h) && h.includes('8.1%') && milkyTable([{ stage: 'shape' }]).length === 0 && milkyTable([...steps, { stage: 'guard' }]).length === 3
    ? 'PASS Milky 조정 표(마지막 Milky 단계만·정밀 값 우선·믿는 행·적용 단추)' : (process.exitCode = 1, `FAIL Milky 조정 표 ${JSON.stringify(T)} ${h}`)); }
{ const { shapeText } = await import('../src/ui/m3/autodesign-panel.js');
  const t = shapeText({ dt: 0, h: 0, e: 0, c: 0, kL: [0.6, -0.23, -0.14, -0.23, 0.6], kW: [0, 0, 0] });
  console.log(t === '길이 두께 곡선 −0.23~+0.60 mm' ? 'PASS 형상 문구: 길이 두께 곡선(제어점 최소~최대) · 0 곡선 생략' : (process.exitCode = 1, `FAIL 형상 문구 ${t}`)); }
{ const { resultLineHtml } = await import('../src/ui/m3/autodesign-panel.js');
  const base = { feasible: false, reason: '', targets: { len: 0.8, wid: 0.8 }, cur: { milky: 1, Ulen: 0.6, Uwid: 0.6, eff: 0.1 }, best: { milky: 2, Ulen: 0.7, Uwid: 0.6, eff: 0.09 } };
  const a = resultLineHtml(base), b = resultLineHtml({ ...base, unchanged: true }), c = resultLineHtml({ ...base, clash: 2 });
  console.log(a.includes('data-ad="continue"') && b.includes('지금 설계 그대로') && !c.includes('data-ad="continue"') ? 'PASS 결과 카드 [이 안에서 이어서] — 현재안 유지도(적용 없이), 겹침 = 없음' : (process.exitCode = 1, 'FAIL 이어서 단추')); }
{ const { treeNodes, makeGroup, ungroup, groupMembers, toggleVisibility } = await import('../src/ui/m3/feature-tree.js');
  const P = (name, role) => ({ ...setPartMaterial(defaultPart(0, name, 1), 'opaque'), ...(role ? { role } : {}) });
  const MM = { ...M, parts: [P('A'), P('B'), P('C'), P('D'), P('L1', 'light'), P('L2', 'light')], groups: [{ id: 'g1', name: '커버류', parts: [1, 2] }] };
  const ids = (S) => treeNodes(MM, { node: null, line: null, ...S }).map((n) => n.id).filter((i) => i.startsWith('part') || i.startsWith('group'));
  // 그룹은 첫 부품 자리에 · 펼침 = 부품 들여쓰기(depth 2) · 접힘 = 숨김 · 광원으로 옮긴 부품 = 자동 묶음(기본 접힘)
  const N = treeNodes(MM, { node: null, line: null }), g = N.find((n) => n.id === 'group:g1');
  const okT = ids({}).join() === 'parts,part:0,group:g1,part:1,part:2,part:3,group:_light' && g.fold === 'open' && g.badge === '2' && N.find((n) => n.id === 'part:1').depth === 2
    && ids({ fold: { g1: true } }).join() === 'parts,part:0,group:g1,part:3,group:_light' && ids({ fold: { _light: false } }).includes('part:5') && ids({ fold: { parts: true } }).join() === 'parts';
  // 그룹 만들기: 다른 그룹에서 빼고, 빈 그룹은 지움 · 풀기 · 멤버
  const a = makeGroup(MM.groups, [2, 3], '새 그룹'), b = ungroup(a.groups, 'g1');
  const okG = a.groups.find((x) => x.id === 'g1').parts.join() === '1' && a.groups.find((x) => x.id === a.id).parts.join() === '2,3' && b.length === 1 && makeGroup([{ id: 'g1', name: 'x', parts: [1] }], [1], 'y').groups.length === 1
    && groupMembers(MM, 'g1').join() === '1,2' && groupMembers(MM, '_light').join() === '4,5';
  // 그룹 눈: 하나라도 보이면 모두 숨김, 다 숨었으면 모두 보임
  const v1 = toggleVisibility('group:g1', false, 6, [1], false, [1, 2]), v2 = toggleVisibility('group:g1', false, 6, [1, 2, 3], false, [1, 2]);
  const okV = v1.hidden.join() === '1,2' && v2.hidden.join() === '3';
  console.log(okT && okG && okV ? 'PASS 부품 그룹: 트리(펼침·접힘·자동 광원 묶음) · 만들기·풀기 · 그룹 보기 전환' : (process.exitCode = 1, `FAIL 부품 그룹 ${okT} ${okG} ${okV} ${ids({})}`)); }
{ const { stageAvailability } = await import('../src/ui/m3/autodesign-panel.js');
  const P = (role, untrace) => ({ ...setPartMaterial(defaultPart(0, 'x', 1), 'opaque'), ...(role ? { role } : {}), ...(untrace ? { untrace } : {}) });
  const a = stageAvailability({ parts: [P(), P('light'), P(null, true), P()], light: { kind: 'manual' }, observe: { faces: [] } }, { non25: [0, 0, 0, 0] });
  console.log(a.housing.parts.join() === '0,3' ? 'PASS ④ 대상 부품: 광원으로 옮긴 LED·추적 제외 부품 빼고' : (process.exitCode = 1, `FAIL ④ 대상 ${a.housing.parts}`)); }
{ const { smoothSigma } = await import('../src/ui/m3/results-panel.js');
  // 평활 폭(칸) = 잡음에 맞춰(잡음 1% → 평활 후 ≈ 0.4%) · 상한 = LED 피치/8 · 3 mm · 하한 0.5칸 — 화질(칸 크기)이 달라도 mm 로는 같게
  const lo = smoothSigma({ relNoise: 0.01, ds: 4.4, pitch: 23 }), hi = smoothSigma({ relNoise: 0.01, ds: 1.1, pitch: 23 });
  const okMm = hi * 1.1 > 1 && lo * 4.4 <= 23 / 8 + 1e-9;   // 고화질은 1 mm 넘게(전: 1.1 mm 고정 1칸), 저화질은 피치/8 이하(전: 4.4 mm — 리플 절반 깎음)
  console.log(hi * 1.1 <= 23 / 8 + 1e-9 && hi > 1 && lo >= 0.5 && smoothSigma({ relNoise: 0.002, ds: 1, pitch: 23 }) === 0.5 && smoothSigma({ relNoise: 0.05, ds: 1, pitch: null }) === 3 && okMm
    ? `PASS 1D 평활 폭: 고화질 ${(hi * 1.1).toFixed(2)} mm · 저화질 ${(lo * 4.4).toFixed(2)} mm (피치 23 → 상한 2.9 mm)` : (process.exitCode = 1, `FAIL 평활 폭 ${lo} ${hi}`)); }
{ // 기구 최적화 창(2026-10-30): 계산 순서(위치 → 케이스 면 → 형상 → Milky) · 적용한 항목 = 고정(다시 최적화 단추) · 오른쪽 모니터(진행 줄·지표·기록)
  const { STAGES, factorBoardHtml, monitorHtml } = await import('../src/ui/m3/opt-dash.js');
  const order = STAGES.map(([k]) => k).join();
  const b = factorBoardHtml(null, { locked: { position: { txt: 'LED 17개' } }, leds: 'LED 17개', on: {} }, (k) => ({ on: false, box: `<input type="checkbox" data-ad="${k}">`, opt: '', why: '' }));
  const okLock = /✓ 고정/.test(b) && b.includes('data-adunlock="position"') && !b.includes('data-ad="position"') && b.includes('data-ad="shape"');
  const S = { tgLen: 0.8, tgWid: 0.8, t0: 0, tiles: { position: { status: 'done', frac: 1, evals: [] }, housing: { status: 'off', evals: [] }, shape: { status: 'run', frac: 0.46, evals: [] }, milky: { status: 'off', evals: [] } },
    seq: [{ k: 'position', label: '1열 17개', Ulen: 0.84, Uwid: 0.81 }], before: { Ulen: 0.55, Uwid: 0.62 }, log: [{ sec: 92, k: 'position', label: '1열 17개', Ulen: 0.84, Uwid: 0.81 }], locked: { milky: true } };
  const m = monitorHtml(S, 130);
  const okMon = m.indexOf('① 위치') < m.indexOf('③ 형상') && m.includes('46%') && /고정/.test(m) && m.includes('0.84') && m.includes('▲0.29') && m.includes('1열 17개') && m.includes('od-plot');
  console.log(order === 'position,housing,shape,milky' && okLock && okMon ? 'PASS 기구 최적화 창: 계산 순서 · 고정 항목 · 모니터(진행 줄·지표·기록)' : (process.exitCode = 1, `FAIL 최적화 창: ${order} lock ${okLock} mon ${okMon}`)); }
{ // 트리 우클릭 메뉴(2026-10-30): 고른 부품 수에 맞는 항목 · 그룹에서 빼기 · Shift 범위 선택
  const { treeCtxItems, removeFromGroups, rangeSelect } = await import('../src/ui/m3/feature-tree.js');
  const M = { parts: [{}, {}, {}, {}], groups: [{ id: 'g1', name: '그룹 1', parts: [1, 2] }] };
  const a = treeCtxItems(M, { node: 'part:3', multi: ['part:0', 'part:3'] }, 'part:3').map((x) => x.k);
  const b = treeCtxItems(M, { node: 'part:1', multi: [] }, 'part:1').map((x) => x.k);
  const c = treeCtxItems(M, { node: 'group:g1', multi: [] }, 'group:g1').map((x) => x.k);
  const lab = treeCtxItems(M, { node: 'part:3', multi: ['part:0', 'part:3'] }, 'part:3')[0].label;
  const r = removeFromGroups(M.groups, [2]), r2 = removeFromGroups(M.groups, [1, 2]);
  const rg = rangeSelect(['part:0', 'part:1', 'part:2', 'part:3'], 'part:1', 'part:3');
  const ok = a.join() === 'group,rename,eye' && /2개/.test(lab) && b.join() === 'group,out,rename,eye' && c.join() === 'ungroup,rename,eye' && r[0].parts.join() === '1' && r2.length === 0 && rg.join() === 'part:1,part:2,part:3';
  console.log(ok ? 'PASS 트리 우클릭 메뉴: 그룹 만들기(N개)·그룹에서 빼기·그룹 해제·이름·보기 · Shift 범위 선택' : (process.exitCode = 1, `FAIL 우클릭 메뉴 ${a} | ${b} | ${c} | ${lab} | ${JSON.stringify(r)} | ${rg}`)); }
