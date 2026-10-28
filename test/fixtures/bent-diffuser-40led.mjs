// 큰 기구 성능 시험용 STEP — ㄱ자로 휜 긴 확산 부품(길이 400, 단면 폭 30·높이 20, 두께 2, 꺾임 곡률) + LED 40개(10 mm 피치, 렌즈 돔) + PCB + 하우징.
// 사용자가 말한 실제 도면 구조(부품 ≈ 48개, LED 40)를 흉내 냄 — 곡면이 400 mm 로 길어 고정 0.01 mm 테셀레이션이면 삼각형이 폭증하는지 확인.
// 직접 실행: node test/fixtures/bent-diffuser-40led.mjs → test/fixtures/bent-diffuser-40led.stp
import { box, translate, fuseAll, shapesToStepText } from '../../src/export/oc-build.js';

const L = 400;
// y 축을 따라 L 만큼 뻗는 사분 원통 껍질(꺾임) — 중심 (cx, cz), 반지름 r0~r1, 각도 a0 부터 90°
function quarterTube(oc, cx, cz, r0, r1, a0) {
  const ax = (r) => new oc.gp_Ax2_2(new oc.gp_Pnt_3(cx, 0, cz), new oc.gp_Dir_4(0, 1, 0), new oc.gp_Dir_4(Math.cos(a0), 0, Math.sin(a0)));
  const outer = new oc.BRepPrimAPI_MakeCylinder_4(ax(r1), r1, L, Math.PI / 2).Shape(), inner = new oc.BRepPrimAPI_MakeCylinder_4(ax(r0), r0, L, Math.PI / 2).Shape();
  const cut = new oc.BRepAlgoAPI_Cut_3(outer, inner, new oc.Message_ProgressRange_1()); const s = cut.Shape(); cut.delete(); return s;
}
export function buildBentShapes(oc) {
  // ㄱ자 확산 부품: 아래 가로 다리(z 4~6, x 8~30) + 꺾임(중심 (8, 14), r 8~10) + 왼쪽 세로 다리(x -2~0, z 14~24)… 빛은 왼쪽 위 입구로
  const legH = translate(oc, box(oc, 22, L, 2), 8, 0, 4);
  const bend = quarterTube(oc, 8, 14, 8, 10, Math.PI);   // 180°→270°(왼쪽 아래 사분면)
  const legV = translate(oc, box(oc, 2, L, 10), -2, 0, 14);
  const diffuser = fuseAll(oc, [legH, bend, legV]);
  // LED 40개: 몸체 3.5×3.5×1.4 + 반구 렌즈(r 1.4)
  const leds = [];
  for (let k = 0; k < 40; k++) {
    const y = 5 + k * 10, body = translate(oc, box(oc, 3.5, 3.5, 1.4), 17, y - 1.75, 1.6);
    const sph = new oc.BRepPrimAPI_MakeSphere_7(new oc.gp_Pnt_3(18.75, y, 3.0), 1.4, 0, Math.PI / 2).Shape();
    leds.push(fuseAll(oc, [body, sph]));
  }
  const pcb = translate(oc, box(oc, 30, L, 1.6), 4, 0, 0);
  // 하우징: 바닥 + 오른쪽 벽 + 둥근 모서리(사분 원통, r 4~6)
  const floor = translate(oc, box(oc, 34, L, 2), 2, 0, -2), wall = translate(oc, box(oc, 2, L, 24), 36, 0, 2);
  const round = quarterTube(oc, 30, 2, 4, 6, -Math.PI / 2);
  const housing = fuseAll(oc, [floor, wall, round]);
  return [housing, diffuser, pcb, ...leds];
}

if (process.argv[1]?.endsWith('bent-diffuser-40led.mjs')) {
  const { default: initOpenCascade } = await import('opencascade.js/dist/node.js');
  const { writeFileSync } = await import('node:fs');
  const oc = await initOpenCascade();
  const text = shapesToStepText(oc, buildBentShapes(oc));
  writeFileSync(new URL('./bent-diffuser-40led.stp', import.meta.url), text);
  console.log(`wrote test/fixtures/bent-diffuser-40led.stp (${(text.length / 1e6).toFixed(2)} MB)`);
}
