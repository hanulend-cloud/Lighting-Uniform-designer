// STEP 불러오기 → 2.5D 높이맵 (형상 몸체 spec §3.1, G0): node test/shape-import.mjs
// 시험 형상은 OpenCASCADE 로 직접 만들어 STEP 텍스트로 쓴 뒤 다시 불러온다(실제 사용 경로와 동일). 해석해와 대조.
import initOpenCascade from 'opencascade.js/dist/node.js';
import { box, translate, shapesToStepText, fuseAll } from '../src/export/oc-build.js';
import { buildBodySolid } from '../src/export/step-body.js';
import { readStepMesh } from '../src/engine/shape/step-import.js';
import { meshToHeightfield, sampleHeightfield } from '../src/engine/shape/heightfield.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const oc = await initOpenCascade();
const roundTrip = (shapes, opt) => readStepMesh(oc, shapesToStepText(oc, shapes), opt);
const op = (Cls, a, b) => { const m = new oc[Cls](a, b, new oc.Message_ProgressRange_1()); const s = m.Shape(); m.delete(); return s; };
// 검사 격자: 외곽에서 margin 안쪽 점들의 최대 오차
function maxErr(hf, fnTop, fnBot, W, H, margin = 1) {
  let e = 0, n = 0;
  for (let y = -H / 2 + margin; y <= H / 2 - margin; y += 1.7) for (let x = -W / 2 + margin; x <= W / 2 - margin; x += 1.7) {
    const s = sampleHeightfield(hf, x, y); if (!s) { e = Infinity; continue; }
    e = Math.max(e, fnTop ? Math.abs(s.zt - fnTop(x, y)) : 0, fnBot ? Math.abs(s.zb - fnBot(x, y)) : 0); n++;
  }
  return { e, n };
}

// 1) 평판 110×110×3
{
  const m = roundTrip([box(oc, 110, 110, 3)]);
  const hf = meshToHeightfield(m, { cell: 0.25 });
  const { e } = maxErr(hf, () => 0, () => -3, 110, 110);
  ok(e < 1e-4 && hf.stats.non25DFrac === 0 && Math.abs(hf.stats.area / (110 * 110) - 1) < 0.01,
    `평판: 윗면 0·바닥 −3 오차 ${e.toExponential(1)}, 면적 ${hf.stats.area.toFixed(0)}mm², 비2.5D ${hf.stats.non25DFrac}`);
}
// 2) 돔 윗면: 상자 ∩ 구(R=1000, 정점 z=3 → 가장자리로 갈수록 낮아지는 곡면, 모서리 0.5mm)
{
  const R = 1000, zTop = 3;   // 모서리 높이 √(R²−50²−50²)−(R−3) ≈ 0.5mm > 0 → 외곽은 정사각형 유지
  const sph = new oc.BRepPrimAPI_MakeSphere_5(new oc.gp_Pnt_3(50, 50, zTop - R), R).Shape();
  const s = op('BRepAlgoAPI_Common_3', box(oc, 100, 100, 5), sph);
  const m = roundTrip([s]);
  const hf = meshToHeightfield(m, { cell: 0.25 });
  const top = (x, y) => Math.sqrt(R * R - x * x - y * y) - R;    // 정점 = 0
  const { e } = maxErr(hf, top, () => -zTop, 100, 100);
  ok(e < 0.02, `돔 윗면(구 R1000): 해석 대비 최대 오차 ${e.toFixed(4)}mm (≤0.02, 메시 현오차 0.01 + 표본)`);
}
// 3) 테이퍼 바닥(기존 STEP 빌더): 두께 중심 4mm → 가장자리 1mm (X 방향 선형)
{
  const X = 80, Y = 40, topZ = 10;
  const botZAt = (x) => topZ - (1 + 3 * (1 - Math.abs(x - X / 2) / (X / 2)));
  const s = buildBodySolid(oc, { X, Y, topZ, botZAt, nx: 80, ny: 8 });
  const hf = meshToHeightfield(roundTrip([s]), { cell: 0.25 });
  const { e } = maxErr(hf, () => 0, (x) => -(1 + 3 * (1 - Math.abs(x) / (X / 2))), X, Y, 2);
  ok(e < 0.03 && hf.stats.thkMax > 3.9 && hf.stats.thkMin < 1.2, `테이퍼 바닥: 오차 ${e.toFixed(4)}mm, 두께 ${hf.stats.thkMin.toFixed(2)}~${hf.stats.thkMax.toFixed(2)}mm`);
}
// 4) 비 2.5D: 판(100×60×6)에 Y 방향 관통 터널(지름 3mm) → 터널 투영 면적 비율만큼 탐지
{
  const ax = new oc.gp_Ax2_3(new oc.gp_Pnt_3(50, -1, 3), new oc.gp_Dir_4(0, 1, 0));
  const cyl = new oc.BRepPrimAPI_MakeCylinder_3(ax, 1.5, 62).Shape();
  const s = op('BRepAlgoAPI_Cut_3', box(oc, 100, 60, 6), cyl);
  const hf = meshToHeightfield(roundTrip([s]), { cell: 0.2 });
  const expect = 3 / 100;
  ok(Math.abs(hf.stats.non25DFrac - expect) < 0.006 && hf.stats.oddFrac < 0.005,
    `비 2.5D 탐지: 터널 ${(hf.stats.non25DFrac * 100).toFixed(2)}% (예상 ${(expect * 100).toFixed(1)}%), 홀수 교차 ${(hf.stats.oddFrac * 100).toFixed(2)}%`);
}
// 5) 방향 보정: X축 180° 뒤집힌 파일 + flipZ = 원본과 동일(돔 대신 바닥 리브가 있는 판으로 비대칭 확인)
{
  const plate = box(oc, 60, 40, 3), rib = translate(oc, box(oc, 4, 40, 2), 28, 0, -2);
  const body = fuseAll(oc, [plate, rib]);
  const tr = new oc.gp_Trsf_1(); tr.SetRotation_1(new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(1, 0, 0)), Math.PI);
  const flipped = new oc.BRepBuilderAPI_Transform_2(body, tr, false).Shape();
  const a = meshToHeightfield(roundTrip([body]), { cell: 0.25 }), b = meshToHeightfield(roundTrip([flipped]), { cell: 0.25, flipZ: true });
  const { e } = maxErr(b, (x, y) => sampleHeightfield(a, x, y).zt, (x, y) => sampleHeightfield(a, x, y).zb, 60, 40, 1);
  const rib0 = sampleHeightfield(a, 0, 0).zb, plain = sampleHeightfield(a, 15, 0).zb;
  ok(e < 1e-3 && Math.abs(rib0 + 5) < 1e-3 && Math.abs(plain + 3) < 1e-3, `방향 보정 flipZ: 원본과 차 ${e.toExponential(1)}, 리브 바닥 ${rib0.toFixed(2)}·일반 ${plain.toFixed(2)}`);
}
// 6) 솔리드 여러 개 → 체적 최대 1개 선택 + 나머지 보고
{
  const m = roundTrip([box(oc, 50, 50, 3), translate(oc, box(oc, 10, 10, 2), 100, 0, 0)]);
  ok(m.solidCount === 2 && Math.abs(m.volume - 7500) < 1 && m.droppedVolumes.length === 1, `다중 솔리드: ${m.solidCount}개 중 최대(${m.volume.toFixed(0)}mm³) 선택`);
}
// 7) 잘못된 파일 → 명확한 오류
{
  let msg = ''; try { readStepMesh(oc, 'not a step file'); } catch (e) { msg = e.message; }
  ok(msg.includes('STEP'), `형식 오류 메시지: ${msg}`);
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
