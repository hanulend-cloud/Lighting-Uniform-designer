// 샘플 LED STEP — 샘플 기구(mech3d-sample) 하우징 바닥(z=2) 위 PCB(116×12×0.5, z 2~2.5) + LED 10개(몸체 3×2×0.7 z 2.5~3.2 + 렌즈 1×1×0.3 z 3.2~3.5)
// LED 중심 x = 7.8 + 11.6·i (x=60 대칭), y = 10 → 도광 바(y 8~12, z 4~10) 바로 아래, 렌즈 윗면과 도광 바 사이 공기 0.5mm. 직접 실행: node test/fixtures/mech3d-led-sample.mjs
import { box, translate, shapesToStepText, fuseAll } from '../../src/export/oc-build.js';

export const LED_X = Array.from({ length: 10 }, (_, i) => 7.8 + i * 11.6);
export function buildLedShapes(oc) {
  const pcb = translate(oc, box(oc, 116, 12, 0.5), 2, 4, 2);
  const leds = LED_X.map((x) => fuseAll(oc, [translate(oc, box(oc, 3, 2, 0.7), x - 1.5, 9, 2.5), translate(oc, box(oc, 1, 1, 0.3), x - 0.5, 9.5, 3.2)]));
  return [pcb, ...leds];
}
if (process.argv[1]?.endsWith('mech3d-led-sample.mjs')) {
  const { default: initOpenCascade } = await import('opencascade.js/dist/node.js');
  const { writeFileSync } = await import('node:fs');
  const oc = await initOpenCascade();
  writeFileSync(new URL('./mech3d-led-sample.stp', import.meta.url), shapesToStepText(oc, buildLedShapes(oc)));
  console.log('wrote test/fixtures/mech3d-led-sample.stp');
}
