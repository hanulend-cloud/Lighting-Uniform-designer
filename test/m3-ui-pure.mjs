// CAD UI 순수 도우미(DOM 없이): node test/m3-ui-pure.mjs
import { treeNodes, partBadge, renderFeatureTree } from '../src/ui/m3/feature-tree.js';
import { calcLabel } from '../src/ui/m3/command-bar.js';
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
done();
