// ③ STEP 곡면 솔리드 — 관측 좌표 격자(아랫면 z) → B-스플라인 면 → +d 돌출 ∩ 외곽 상자 → 월드 변환 → STEP. spec P4 §2.3b
// 실패(어떤 OCC 오류든)하면 partStepText 가 기존 삼각형 꿰매기로 대신한다.
import { pnt, shapesToStepText } from './oc-build.js';
import { meshToStepText } from './mesh-step.js';

export const SPLINE_FAIL_NOTE = '곡면 맞춤 실패 — 삼각형으로 내보냄';

// { frame:{u,v,d}, rect:[x0,x1,y0,y1], zTop, grid:{ nx, ny, x0, dx, y0, dy, z: 아랫면 z (관측 좌표, z[j·nx+i]) } }
export function splineToStepText(oc, { frame: F, rect: [x0, x1, y0, y1], zTop, grid: G }) {
  const { nx, ny, z } = G;
  if (!(nx >= 4 && ny >= 4) || z.length !== nx * ny || !z.every(Number.isFinite)) throw new Error('곡면 격자 이상');
  let zMin = Infinity; for (const v of z) zMin = Math.min(zMin, v);
  if (!(zTop > zMin)) throw new Error('곡면 두께 이상');
  const del = [];   // 다 쓰고 지울 OCC 객체
  const keep = (o) => (del.push(o), o);
  try {
    const Z = keep(new oc.TColStd_Array2OfReal_2(1, nx, 1, ny));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) Z.SetValue(i + 1, j + 1, z[j * nx + i]);
    // z = f(x, y) 근사(차수 3–8, C2, 허용 1 µm)
    const fit = keep(new oc.GeomAPI_PointsToBSplineSurface_5(Z, G.x0, G.dx, G.y0, G.dy, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-3));
    if (!fit.IsDone()) throw new Error('B-스플라인 근사 실패');
    const surf = keep(new oc.Handle_Geom_Surface_2(fit.Surface().get()));
    const mf = keep(new oc.BRepBuilderAPI_MakeFace_8(surf, 1e-6)), face = keep(mf.Face());
    const vec = keep(new oc.gp_Vec_4(0, 0, zTop - zMin + 1));   // 돌출 높이 > 두께 최대
    const mp = keep(new oc.BRepPrimAPI_MakePrism_1(face, vec, false, true)), prism = keep(mp.Shape());
    const pa = keep(pnt(oc, x0, y0, zMin - 1)), pb = keep(pnt(oc, x1, y1, zTop));
    const mb = keep(new oc.BRepPrimAPI_MakeBox_4(pa, pb)), boxS = keep(mb.Shape());
    const pr = keep(new oc.Message_ProgressRange_1()), cm = keep(new oc.BRepAlgoAPI_Common_3(prism, boxS, pr));
    if (cm.HasErrors && cm.HasErrors()) throw new Error('곡면 ∩ 상자 실패');
    const common = keep(cm.Shape()), E = oc.TopAbs_ShapeEnum, solids = [];
    for (const ex = keep(new oc.TopExp_Explorer_2(common, E.TopAbs_SOLID, E.TopAbs_SHAPE)); ex.More(); ex.Next()) solids.push(keep(oc.TopoDS.Solid_1(ex.Current())));
    if (solids.length !== 1) throw new Error(`곡면 솔리드 ${solids.length}개`);
    // 관측 → 월드: world = x·u + y·v + z·d (u,v,d 오른손 정규직교)
    const tr = keep(new oc.gp_Trsf_1()), { u, v, d } = F;
    tr.SetValues(u[0], v[0], d[0], 0, u[1], v[1], d[1], 0, u[2], v[2], d[2], 0);
    const xf = keep(new oc.BRepBuilderAPI_Transform_2(solids[0], tr, true)), world = keep(xf.Shape());
    return shapesToStepText(oc, [world]);
  } finally { for (const o of del.reverse()) try { o.delete(); } catch { /* 이미 지움 */ } }
}

// 워커·시험 공용: spline 있으면 곡면, 실패하면 메쉬 꿰매기 + note
export function partStepText(oc, { mesh, spline }) {
  if (spline) {
    try { return { stepText: splineToStepText(oc, spline) }; }
    catch (e) { return { stepText: meshToStepText(oc, mesh), note: SPLINE_FAIL_NOTE, error: e?.message ?? String(e) }; }
  }
  return { stepText: meshToStepText(oc, mesh) };
}
