// LED 선택·속성 창(spec m3-cad-ui §4a) 순수 도우미: node test/m3-led-panel.mjs
import { beamPreset, beamSpec, ledOfHit, ledClashItems, dropStaleAdjust, ledStepSel, setLedAdjust } from '../src/ui/m3/led-select.js';
import { ledPanelHtml, ledNavHtml } from '../src/ui/mech3d-light-panel.js';
import { layoutKeyOf, validAdjust } from '../src/engine/mech3d/led-adjust.js';
import { defaultLight } from '../src/engine/mech3d/defs.js';
import { ok, done } from './mech3d-util.mjs';

// 배광 프리셋 ↔ 모델
ok(beamPreset({ model: 'lambertian', beam: 120 }) === 120 && beamPreset({ model: 'lambertian', beam: 77 }) === 120, '램버시안 = 넓게 120°');
ok(beamPreset({ model: 'gaussian', beam: 90 }) === 90 && beamPreset({ model: 'gaussian', beam: 60 }) === 60, '가우시안 90/60 = 보통/좁게');
ok(beamPreset({ model: 'gaussian', beam: 45 }) === 'custom' && beamPreset({ model: 'gaussian', beam: 120 }) === 'custom', '그 밖 = 직접 입력');
ok(JSON.stringify(beamSpec(120)) === '{"model":"lambertian","beam":120}' && JSON.stringify(beamSpec(90)) === '{"model":"gaussian","beam":90}', '120 → 램버시안, 그 밖 → 가우시안');
ok(beamSpec(5).beam === 10 && beamSpec(400).beam === 170 && beamSpec(NaN) === null, '각도 10~170 으로 자름 · 숫자 아님 = null');

// 3D 클릭 → LED 번호
const lay = { leds: [2, 3, 5], pcb: 0, excluded: [3] };
ok(ledOfHit({ led: 4 }, 3, lay) === 4, '원뿔 클릭 = 그 번호');
ok(ledOfHit({ part: 3 + 5 }, 3, lay) === 2 && ledOfHit({ part: 3 + 3 }, 3, lay) === 1, 'LED 몸체 = lay.leds 안 위치(제외 LED 도 번호 유지)');
ok(ledOfHit({ part: 3 + 0 }, 3, lay) === null && ledOfHit({ part: 1 }, 3, lay) === null && ledOfHit(null, 3, lay) === null && ledOfHit({ part: 4 }, 3, null) === null, 'PCB·기구 부품·빈 곳·배치 없음 = null');

// 간섭 항목 중 그 LED 것: 발광점 항목 led = 발광점 배열 위치 → e.led, 몸체 항목 led = 부품 번호 → lay.leds 위치
{ const em = [{ led: 0 }, { led: 2 }], items = [{ led: 1, part: 0, kind: 'inside' }, { led: 5, part: 1, kind: 'overlap' }, { led: 2, part: 1, kind: 'overlap' }];
  const r = ledClashItems(items, 2, em, lay);
  ok(r.length === 2 && r[0].kind === 'inside' && r[1].part === 1 && r[1].led === 5, `LED 3 간섭 = 발광점 1건 + 몸체 1건 (${r.length})`);
  ok(ledClashItems(items, 0, [{}, {}], null).length === 0 && ledClashItems(items, 1, [{}, {}], null).length === 1, '직접 배치(번호 = 발광점 위치)'); }

// 오래된 개별 조정 지우기
{ const Lt = { ...defaultLight(), kind: 'manual' };
  ok(dropStaleAdjust(Lt) === '', '조정 없음 = 그대로');
  Lt.ledAdjust = { layoutKey: layoutKeyOf(Lt), items: { 2: { ds: 1, dz: 0 } } };
  ok(dropStaleAdjust(Lt) === '' && Lt.ledAdjust, '배치 그대로 = 유지');
  Lt.manual.count = 12;
  ok(dropStaleAdjust(Lt) === '배치가 바뀌어 개별 LED 조정을 지웠습니다' && !('ledAdjust' in Lt), '배치가 바뀜 = 알림 후 삭제'); }

// 개별 조정 쓰기: 0·null = 그 항목 삭제, 비면 ledAdjust 삭제, 오래된 조정 위에 쓰면 새로
{ const Lt = { ...defaultLight(), kind: 'manual' };
  setLedAdjust(Lt, 2, { ds: 2, dz: 0 });
  ok(validAdjust(Lt)?.[2]?.ds === 2 && Lt.ledAdjust.layoutKey === layoutKeyOf(Lt), '저장 = 현재 layoutKey');
  setLedAdjust(Lt, 4, { ds: 0, dz: -0.5 });
  ok(Object.keys(Lt.ledAdjust.items).join() === '2,4', '두 LED');
  setLedAdjust(Lt, 2, null); setLedAdjust(Lt, 4, { ds: 0, dz: 0 });
  ok(!('ledAdjust' in Lt), '모두 원래대로 = ledAdjust 삭제');
  Lt.ledAdjust = { layoutKey: 'old', items: { 1: { ds: 3, dz: 3 } } };
  setLedAdjust(Lt, 0, { ds: 1, dz: 0 });
  ok(Object.keys(Lt.ledAdjust.items).join() === '0' && Lt.ledAdjust.layoutKey === layoutKeyOf(Lt), '오래된 조정은 버리고 새로'); }

// ◀ ▶
ok(ledStepSel(null, 10, 1) === 0 && ledStepSel(null, 10, -1) === 9 && ledStepSel(9, 10, 1) === 0 && ledStepSel(0, 10, -1) === 9 && ledStepSel(3, 10, 1) === 4 && ledStepSel(0, 0, 1) === null, '◀ ▶ 순환 · 없음 = null');

// LED 속성 창 HTML
const line = { length: 120, closed: false, width: 16 };
const man = { light: { ...defaultLight(), kind: 'manual' } };
const led = (o = {}) => ({ n: 2, total: 10, s: 35, gap: 6.25, adj: { ds: 0, dz: 0 }, excluded: false, clash: [], ...o });
{ const h = ledPanelHtml(man, { led: led(), line });
  ok(h.includes('LED 3 · 10개 중 · 라인 위치 35.0 mm'), '머리');
  ok(/data-lp-ledsel="1"[^>]*>◀/.test(h) && /data-lp-ledsel="3"[^>]*>▶/.test(h), '◀ ▶ = 이전·다음 번호');
  ok(/data-lp-beam="120" aria-pressed="true"/.test(h) && /data-lp-beam="90" aria-pressed="false"/.test(h) && /data-lp-beam="60" aria-pressed="false"/.test(h), '120 = 넓게 눌림');
  ok(h.includes('넓게 120°') && h.includes('보통 90°') && h.includes('좁게 60°') && h.includes('빛이 퍼지는 각도(밝기 절반 기준)') && !h.includes('램버시안') && !h.includes('가우시안'), '쉬운 말 · 모델 이름 숨김');
  ok(/data-lp-spec="fluxLm"/.test(h) && h.includes('lm/개') && h.includes('0 = 상대값'), '광속');
  ok(/value="6.3" data-lp-dist/.test(h) && !/data-lp-dist[^>]*disabled/.test(h), `커버까지 거리 = 현재 최소 간격 (${h.match(/value="[^"]*" data-lp-dist/)?.[0]})`);
  ok(/data-lp-man="count"/.test(h) && /data-lp-man="pitch"/.test(h) && /data-lp-man="rows"/.test(h), '배치(개수·피치·열)');
  ok(/data-lp-adj="ds"[^>]*value="0"|value="0"[^>]*data-lp-adj="ds"/.test(h) && /data-lp-adj="dz"/.test(h) && !/data-lp-adjreset/.test(h), '이 LED만 입력 · 조정 없으면 [원래대로] 없음');
  ok(!/data-lp-ledx/.test(h), '직접 배치 = 제외 토글 없음');
  ok(h.includes('배치·인식 (고급)') && /<details class="m3-sec" data-m3-sec="ledadv"/.test(h), '고급 접는 구역');
  ok(!/m3-clash/.test(h), '간섭 없음 = 빨간 줄 없음'); }
{ const h = ledPanelHtml({ light: { ...man.light, spec: { ...man.light.spec, model: 'gaussian', beam: 90 } } }, { led: led(), line });
  ok(/data-lp-beam="90" aria-pressed="true"/.test(h) && /data-lp-beam="120" aria-pressed="false"/.test(h) && /data-lp-beamc[^>]*value=""/.test(h), '90 = 보통 눌림, 직접 입력 빈칸');
  const hc = ledPanelHtml({ light: { ...man.light, spec: { ...man.light.spec, model: 'gaussian', beam: 45 } } }, { led: led(), line });
  ok(!/aria-pressed="true"/.test(hc) && /data-lp-beamc[^>]*value="45"/.test(hc), '45 = 직접 입력(버튼 안 눌림)'); }
{ const h = ledPanelHtml(man, { led: led({ adj: { ds: 2, dz: -0.5 }, clash: ['커버와 간섭'] }), line });
  ok(/value="2"[^>]*data-lp-adj="ds"/.test(h) && /value="-0.5"[^>]*data-lp-adj="dz"/.test(h) && /data-lp-adjreset/.test(h), '조정 값 · [원래대로]');
  ok(/class="m3-clash"[^>]*>[^<]*커버와 간섭/.test(h), '이 LED 간섭 = 빨간 줄'); }
{ const face = { light: { ...man.light, manual: { ...man.light.manual, pcb: { kind: 'face', part: 1, face: 2 } } } };
  const h = ledPanelHtml(face, { led: led(), line });
  ok(/data-lp-dist[^>]*disabled/.test(h) && h.includes('PCB 를 기구 면으로 지정'), '면 PCB = 거리 입력 비활성 + 이유'); }
{ const st = { name: 'a.stp', leds: [1, 2], pcb: 0, excluded: [], emitters: [{ part: 1, pos: [0, 0, 0], axis: [0, 0, 1] }], offset: [0, 0, 0], rot: [0, 0, 0], virtual: null };
  const ms = { light: { ...defaultLight(), kind: 'step', step: st } };
  const h = ledPanelHtml(ms, { led: led({ total: 2, n: 1 }), line });
  ok(/data-lp-ledx/.test(h) && h.includes('이 LED 제외'), 'LED STEP 원래 = 제외 토글');
  ok(ledPanelHtml(ms, { led: led({ total: 2, n: 1, excluded: true }), line }).includes('이 LED 포함'), '제외된 LED = 포함 토글');
  ok(/data-lp-vmode/.test(h) && (h.match(/name="lp-vmode"/g) ?? []).length === 2, 'STEP 배치 행 한 번만(라디오 이름 겹침 없음)');
  const hv = ledPanelHtml({ light: { ...ms.light, step: { ...st, virtual: { count: 4, pitch: 0, rows: 1, rowGap: 0 } } } }, { led: led({ total: 4 }), line });
  ok(!/data-lp-ledx/.test(hv) && /data-lp-virt="count"/.test(hv), '가상 배치 = 제외 토글 없음 · 개수 입력'); }
// 노드 창(선택 없음) 의 LED 고르기 줄
ok(/data-lp-ledsel="9"[^>]*>◀/.test(ledNavHtml(null, 10)) && /data-lp-ledsel="0"[^>]*>▶/.test(ledNavHtml(null, 10)) && ledNavHtml(null, 0) === '', '선택 없음: ◀ = 마지막, ▶ = 첫 LED · LED 없음 = 줄 없음');
done();
