// STEP 불러오기 — 형상 몸체 spec 2026-10-10 §3.1 (G0). oc = 초기화된 opencascade.js 인스턴스(브라우저 Worker·Node 공용).
// STEP 텍스트 → 솔리드(여러 개면 체적 최대 1개) → 삼각 메시(위치 변환·면 방향 반영). 높이맵 변환은 heightfield.js(순수 JS).

function volumeOf(oc, shape) {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  const v = props.Mass(); props.delete();
  return Math.abs(v);
}

// linDefl: 메시 현 오차(mm) — 곡면 표본화 정확도. angDefl: 각도 오차(rad).
export function readStepMesh(oc, text, { linDefl = 0.01, angDefl = 0.1 } = {}) {
  const path = '/uds-import.stp';
  oc.FS.writeFile(path, text);
  const rd = new oc.STEPControl_Reader_1();
  const st = rd.ReadFile(path);
  if (st !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP 읽기 실패(형식 오류 또는 지원하지 않는 파일)');
  rd.TransferRoots(new oc.Message_ProgressRange_1());
  const root = rd.OneShape();
  const solids = [];
  for (const ex = new oc.TopExp_Explorer_2(root, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const s = oc.TopoDS.Solid_1(ex.Current());
    solids.push({ s, v: volumeOf(oc, s) });
  }
  if (!solids.length) throw new Error('STEP 에 솔리드가 없음(면·와이어만 있는 파일)');
  solids.sort((a, b) => b.v - a.v);
  const shape = solids[0].s;
  new oc.BRepMesh_IncrementalMesh_2(shape, linDefl, false, angDefl, false);
  const pos = [], tri = [];
  for (const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const face = oc.TopoDS.Face_1(ex.Current());
    const loc = new oc.TopLoc_Location_1();
    const h = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (h.IsNull()) continue;
    const T = h.get(), trsf = loc.Transformation(), base = pos.length / 3;
    for (let i = 1; i <= T.NbNodes(); i++) { const p = T.Node(i).Transformed(trsf); pos.push(p.X(), p.Y(), p.Z()); }
    const rev = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    for (let i = 1; i <= T.NbTriangles(); i++) {
      const t = T.Triangle(i), a = t.Value(1) - 1, b = t.Value(2) - 1, c = t.Value(3) - 1;
      if (rev) tri.push(base + a, base + c, base + b); else tri.push(base + a, base + b, base + c);
    }
    loc.delete();
  }
  rd.delete();
  return {
    positions: Float32Array.from(pos), triangles: Uint32Array.from(tri),
    solidCount: solids.length, volume: solids[0].v, droppedVolumes: solids.slice(1).map((x) => x.v),
  };
}
