// STEP 불러오기 — 형상 몸체 spec 2026-10-10 §3.1 (G0) + 3D 기구 spec 2026-10-14 §3.1. oc = 초기화된 opencascade.js(브라우저 Worker·Node 공용).
// readStepMesh: 체적 최대 솔리드 1개(L3 몸체·높이맵용). readStepParts: 모든 솔리드를 부품별 메쉬로(3D 기구 모드).

function volumeOf(oc, shape) {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  const v = props.Mass(); props.delete();
  return Math.abs(v);
}

// STEP 텍스트 → 솔리드 목록(부피 내림차순). 호출자가 rd.delete() 책임.
function readSolids(oc, text) {
  const path = '/uds-import.stp';
  oc.FS.writeFile(path, text);
  const rd = new oc.STEPControl_Reader_1();
  const st = rd.ReadFile(path);
  if (st !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) { rd.delete(); throw new Error('STEP 읽기 실패(형식 오류 또는 지원하지 않는 파일)'); }
  rd.TransferRoots(new oc.Message_ProgressRange_1());
  const root = rd.OneShape();
  const solids = [];
  for (const ex = new oc.TopExp_Explorer_2(root, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const s = oc.TopoDS.Solid_1(ex.Current());
    solids.push({ s, v: volumeOf(oc, s) });
  }
  if (!solids.length) { rd.delete(); throw new Error('STEP 에 솔리드가 없음(면·와이어만 있는 파일)'); }
  solids.sort((a, b) => b.v - a.v);
  return { rd, solids };
}

// 솔리드 → 삼각 메쉬(위치 변환·면 방향 반영). faceIds = 삼각형별 B-rep 면 번호(TopExp 순서, 삼각화 없는 면도 번호 소비).
// linDefl: 메시 현 오차(mm) — 곡면 표본화 정확도. angDefl: 각도 오차(rad).
function meshSolid(oc, shape, linDefl, angDefl) {
  new oc.BRepMesh_IncrementalMesh_2(shape, linDefl, false, angDefl, false);
  const pos = [], tri = [], fid = [];
  let f = 0;
  for (const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next(), f++) {
    const face = oc.TopoDS.Face_1(ex.Current());
    const loc = new oc.TopLoc_Location_1();
    const h = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (h.IsNull()) { loc.delete(); continue; }
    const T = h.get(), trsf = loc.Transformation(), base = pos.length / 3;
    for (let i = 1; i <= T.NbNodes(); i++) { const p = T.Node(i).Transformed(trsf); pos.push(p.X(), p.Y(), p.Z()); }
    const rev = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    for (let i = 1; i <= T.NbTriangles(); i++) {
      const t = T.Triangle(i), a = t.Value(1) - 1, b = t.Value(2) - 1, c = t.Value(3) - 1;
      if (rev) tri.push(base + a, base + c, base + b); else tri.push(base + a, base + b, base + c);
      fid.push(f);
    }
    loc.delete();
  }
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tri), faceIds: Uint32Array.from(fid), faceCount: f };
}

export function readStepMesh(oc, text, { linDefl = 0.01, angDefl = 0.1 } = {}) {
  const { rd, solids } = readSolids(oc, text);
  const m = meshSolid(oc, solids[0].s, linDefl, angDefl);
  rd.delete();
  return {
    positions: m.positions, triangles: m.triangles,
    solidCount: solids.length, volume: solids[0].v, droppedVolumes: solids.slice(1).map((x) => x.v),
  };
}

// 모든 솔리드 → [{ positions, triangles, faceIds, faceCount, volume }] (부피 내림차순)
export function readStepParts(oc, text, { linDefl = 0.01, angDefl = 0.1 } = {}) {
  const { rd, solids } = readSolids(oc, text);
  const parts = solids.map(({ s, v }) => ({ ...meshSolid(oc, s, linDefl, angDefl), volume: v }));
  rd.delete();
  return parts;
}
