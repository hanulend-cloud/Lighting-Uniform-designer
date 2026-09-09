// OpenCASCADE.js 프리미티브 헬퍼 — 순수 함수, oc(초기화된 opencascade.js 인스턴스)를
// 인자로 받는다. 브라우저 워커와 Node 테스트가 이 파일을 그대로 공유한다.

export function pnt(oc, x, y, z) {
  return new oc.gp_Pnt_3(x, y, z);
}

// 3점(항상 평면) → 면
export function triFace(oc, p1, p2, p3) {
  const poly = new oc.BRepBuilderAPI_MakePolygon_1();
  poly.Add_1(p1); poly.Add_1(p2); poly.Add_1(p3); poly.Close();
  const wire = poly.Wire();
  const mk = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
  const face = mk.Face();
  poly.delete(); mk.delete(); wire.delete();
  return face;
}

// 4점(윗면처럼 실제 평면인 경우만) → 면
export function quadFace(oc, p1, p2, p3, p4) {
  const poly = new oc.BRepBuilderAPI_MakePolygon_1();
  poly.Add_1(p1); poly.Add_1(p2); poly.Add_1(p3); poly.Add_1(p4); poly.Close();
  const wire = poly.Wire();
  const mk = new oc.BRepBuilderAPI_MakeFace_15(wire, false);
  const face = mk.Face();
  poly.delete(); mk.delete(); wire.delete();
  return face;
}

// 면 목록 → 봉합(sew) → 닫힌 솔리드
export function sewToSolid(oc, faces) {
  const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  for (const f of faces) sewing.Add(f);
  sewing.Perform(new oc.Message_ProgressRange_1());
  const sewn = sewing.SewedShape();
  const shell = oc.TopoDS.Shell_1(sewn);
  const mk = new oc.BRepBuilderAPI_MakeSolid_1();
  mk.Add(shell);
  const solid = mk.Solid();
  sewing.delete(); mk.delete();
  return solid;
}

export function box(oc, dx, dy, dz) {
  const mk = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
  const shape = mk.Shape();
  mk.delete();
  return shape;
}

export function translate(oc, shape, dx, dy, dz) {
  const trsf = new oc.gp_Trsf_1();
  trsf.SetTranslation_1(new oc.gp_Vec_4(dx, dy, dz));
  const xf = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false);
  const moved = xf.Shape();
  trsf.delete(); xf.delete();
  return moved;
}

// 여러 솔리드를 순차적으로 하나로 합친다(빈 배열이면 null).
export function fuseAll(oc, shapes, onProgress) {
  if (shapes.length === 0) return null;
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    const fuse = new oc.BRepAlgoAPI_Fuse_3(acc, shapes[i], new oc.Message_ProgressRange_1());
    const next = fuse.Shape();
    fuse.delete();
    if (i > 1) acc.delete();   // don't delete shapes[0] (caller-owned) on first iteration
    acc = next;
    if (onProgress) onProgress(i, shapes.length - 1);
  }
  return acc;
}

export function volumeOf(oc, shape) {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  const v = Math.abs(props.Mass());
  props.delete();
  return v;
}

// 밑면 N각형(중심 0,0,0, 반경 half) + 꼭짓점(0,0,height) 을 갖는 뿔 솔리드.
// L5 pyramid(sides=4)/dome(sides=10, 곡면 근사) 모두 이 함수로 만든다.
// sides=4: 정확한 축 정렬 사각형 밑면(패킹용). 그 외: 타원(hx,hy)에 내접하는 N각형 근사
// (sizeX!==sizeY면 정다각형이 아닌 찌그러진 근사 형태이니 장식용 dome 등에만 쓸 것).
export function coneBump(oc, sizeX, sizeY, height, sides) {
  const hx = sizeX / 2, hy = sizeY / 2;
  const base = [];
  if (sides === 4) {
    // 정확한 사각형 네 모서리(축 정렬) — L5 돌기는 sizeX*sizeY footprint끼리 맞닿아야
    // 하므로(패킹) 밑면이 정확히 sizeX*sizeY 넓이의 축 정렬 사각형이어야 한다. 타원(ellipse)
    // 파라미터화(cos/sin)로는 위상을 아무리 돌려도 꼭짓점이 (±hx,±hy) 모서리에 닿지 않고
    // 항상 타원 위(모서리보다 안쪽)에 남으므로 — 실측(밑면 넓이가 절반인 마름모가 됨)으로
    // 확인되어 4각형만 별도 처리.
    base.push(pnt(oc, hx, hy, 0), pnt(oc, -hx, hy, 0), pnt(oc, -hx, -hy, 0), pnt(oc, hx, -hy, 0));
  } else {
    // dome 등 — 타원(반경 hx,hy)에 내접하는 N각형으로 둥근 느낌만 근사(축 정렬 여부는 무관).
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      base.push(pnt(oc, Math.cos(a) * hx, Math.sin(a) * hy, 0));
    }
  }
  const apex = pnt(oc, 0, 0, height);
  const faces = [];
  for (let i = 0; i < sides; i++) {
    faces.push(triFace(oc, base[i], base[(i + 1) % sides], apex));
  }
  // 밑면(다각형 팬 분할)
  for (let i = 1; i < sides - 1; i++) {
    faces.push(triFace(oc, base[0], base[i], base[i + 1]));
  }
  return sewToSolid(oc, faces);
}

// 삼각 리지(prism) — X축 방향으로 능선이 있는 텐트 모양. sizeX=능선 방향 길이, sizeY=폭.
export function ridgeBump(oc, sizeX, sizeY, height) {
  const hx = sizeX / 2, hy = sizeY / 2;
  const p = {
    a0: pnt(oc, -hx, -hy, 0), a1: pnt(oc, hx, -hy, 0),
    b0: pnt(oc, -hx, hy, 0), b1: pnt(oc, hx, hy, 0),
    ra: pnt(oc, -hx, 0, height), rb: pnt(oc, hx, 0, height),
  };
  const faces = [
    triFace(oc, p.a0, p.a1, p.rb), triFace(oc, p.a0, p.rb, p.ra),   // -Y 경사면
    triFace(oc, p.b1, p.b0, p.ra), triFace(oc, p.b1, p.ra, p.rb),   // +Y 경사면
    triFace(oc, p.a0, p.ra, p.b0),                                   // -X 삼각 마감
    triFace(oc, p.a1, p.b1, p.rb),                                   // +X 삼각 마감
    triFace(oc, p.a0, p.b0, p.b1), triFace(oc, p.a0, p.b1, p.a1),   // 바닥
  ];
  return sewToSolid(oc, faces);
}

// STEP 텍스트로 직렬화 — Emscripten 가상 FS에 쓰고 다시 읽어야 실제 파일 문자열을 얻는다.
export function shapesToStepText(oc, shapes) {
  const writer = new oc.STEPControl_Writer_1();
  const progress = new oc.Message_ProgressRange_1();
  for (const s of shapes) {
    writer.Transfer(s, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  }
  const fname = 'export.stp';
  writer.Write(fname);
  const text = oc.FS.readFile(fname, { encoding: 'utf8' });
  writer.delete();
  progress.delete();
  return text;
}
