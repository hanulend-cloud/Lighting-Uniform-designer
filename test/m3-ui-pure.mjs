// CAD UI 순수 도우미(DOM 없이): node test/m3-ui-pure.mjs
import { treeNodes, partBadge, renderFeatureTree } from '../src/ui/m3/feature-tree.js';
import { calcLabel } from '../src/ui/m3/command-bar.js';
import { judgeText, lumCard, fmtU } from '../src/ui/m3/results-panel.js';
import { checkLabels } from '../src/ui/m3/status-bar.js';
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
{ const el = { innerHTML: '', querySelectorAll: () => [] };
  const P = { ...M, parts: [{ ...M.parts[0], name: '<img src=x onerror="a()">&' }] };
  renderFeatureTree(el, P, { node: null, line: null }, { onNode() {} });
  ok(!el.innerHTML.includes('<img') && el.innerHTML.includes('&lt;img src=x onerror=&quot;a()&quot;>&amp;'), '부품 이름 escape'); }
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
  ok(T[1].text.endsWith('도달 49%') && T[2].text === '살두께 0.79 mm' && T[3].text === '새는 빛 21%' && L7 === '새는 빛 7%' && checkLabels({ reach: { status: 'ok', minReach: 1, minDist: null } })[1].text === 'LED–커버 가림 · 도달 100%',
    `점검 반올림: ${T.map((t) => t.text).join(' | ')} | ${L7}`); }
done();
