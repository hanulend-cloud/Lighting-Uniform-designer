// 3D 기구 샘플 — 백색 U 하우징(120×20×12, 벽 2mm) + Milky 커버(116×16×2, z10~12) + 투명 도광 바(116×4×6, z4~10)
// + 떨어진 원기둥(r3, h10). 커버는 하우징 안벽 4면과, 도광 바는 커버 아랫면·하우징 x 안벽 2면과 맞닿는다.
// 직접 실행하면 test/fixtures/mech3d-sample.stp 를 쓴다(브라우저 확인용): node test/fixtures/mech3d-sample.mjs
import { box, translate, shapesToStepText } from '../../src/export/oc-build.js';

export function buildSampleShapes(oc) {
  const cut = new oc.BRepAlgoAPI_Cut_3(box(oc, 120, 20, 12), translate(oc, box(oc, 116, 16, 12), 2, 2, 2), new oc.Message_ProgressRange_1());
  const housing = cut.Shape(); cut.delete();
  const cover = translate(oc, box(oc, 116, 16, 2), 2, 2, 10);
  const guide = translate(oc, box(oc, 116, 4, 6), 2, 8, 4);
  const cyl = new oc.BRepPrimAPI_MakeCylinder_3(new oc.gp_Ax2_3(new oc.gp_Pnt_3(60, -10, 0), new oc.gp_Dir_4(0, 0, 1)), 3, 10).Shape();
  return [housing, cover, guide, cyl];
}
// 기대값(해석): 부피와 접촉 면적
export const SAMPLE = {
  volumes: [120 * 20 * 12 - 116 * 16 * 10, 116 * 16 * 2, 116 * 4 * 6, Math.PI * 9 * 10],
  faceCounts: [11, 6, 6, 3],
  contactArea: { '0|1': 2 * 116 * 2 + 2 * 16 * 2, '0|2': 2 * 4 * 6, '1|2': 116 * 4 },
};

if (process.argv[1]?.endsWith('mech3d-sample.mjs')) {   // 직접 실행했을 때만(테스트에서 import 하면 건너뜀)
  const { default: initOpenCascade } = await import('opencascade.js/dist/node.js');
  const { writeFileSync } = await import('node:fs');
  const oc = await initOpenCascade();
  writeFileSync(new URL('./mech3d-sample.stp', import.meta.url), shapesToStepText(oc, buildSampleShapes(oc)));
  console.log('wrote test/fixtures/mech3d-sample.stp');
}
