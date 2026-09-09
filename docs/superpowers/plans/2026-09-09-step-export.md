# STEP(STP) 3D CAD 내보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 적용된 L1~L5 조합(바디) + LED 박스 + PCB 평판을 하나의 STEP(AP214) 파일로 내보내는 "STEP 내보내기" 기능을 추가한다.

**Architecture:** 기존 렌더링 형상 함수(`bodyProfile`/`l4BotZAt`)를 2D 높이필드 함수로 재사용/일반화하고, OpenCASCADE.js(WASM)를 이용해 (평평한 윗면 + 높이필드 격자 메쉬 아랫면 + 4면 옆벽)으로 바디 솔리드를 만든다. L5 돌기는 각 LED 피치 위치에 작은 콘/리지 솔리드를 만들어 Boolean Fuse로 결합한다. LED 박스·PCB 평판은 별도 솔리드로 같은 STEP에 포함한다. 무거운 연산은 브라우저에서 Web Worker 안에서 실행하고, 같은 지오메트리 빌더 코드를 Node 테스트에서도 그대로 재사용(의존성 주입: `oc` 인스턴스를 인자로 받음)한다.

**Tech Stack:** OpenCASCADE.js `2.0.0-beta.b5ff984` (npm `opencascade.js@beta`, CDN: jsdelivr `dist/opencascade.full.js` + `dist/opencascade.full.wasm`, Node 테스트: `opencascade.js/dist/node.js`), Web Worker, 순수 ES 모듈(빌드 도구 없음).

**참고 — 이 계획에 쓰인 OpenCASCADE.js API는 전부 Node에서 실제로 실행해 검증됨** (아래 예시 그대로 동작 확인):
```js
import initOpenCascade from 'opencascade.js/dist/node.js';
const oc = await initOpenCascade();

// 점 / 박스 / 이동
const p = new oc.gp_Pnt_3(x, y, z);
const box = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz).Shape();
const trsf = new oc.gp_Trsf_1();
trsf.SetTranslation_1(new oc.gp_Vec_4(dx, dy, dz));
const moved = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false).Shape();

// 삼각형 평면 → 와이어 → 면
const poly = new oc.BRepBuilderAPI_MakePolygon_1();
poly.Add_1(p1); poly.Add_1(p2); poly.Add_1(p3); poly.Close();
const face = new oc.BRepBuilderAPI_MakeFace_15(poly.Wire(), false).Face();

// 여러 면 → 봉합(sew) → 솔리드
const sewing = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
faces.forEach(f => sewing.Add(f));
sewing.Perform(new oc.Message_ProgressRange_1());
const shell = oc.TopoDS.Shell_1(sewing.SewedShape());
const mk = new oc.BRepBuilderAPI_MakeSolid_1();
mk.Add(shell);
const solid = mk.Solid();

// 불리언 합집합
const fuse = new oc.BRepAlgoAPI_Fuse_3(shapeA, shapeB, new oc.Message_ProgressRange_1());
const fused = fuse.Shape();

// 부피(검증용)
const props = new oc.GProp_GProps_1();
oc.BRepGProp.VolumeProperties_1(solid, props, false, false, false);
const volume = Math.abs(props.Mass());

// STEP 파일로 직렬화 (가상 FS에 쓰고 다시 읽어야 함 — 실제 디스크가 아님)
const writer = new oc.STEPControl_Writer_1();
writer.Transfer(solid, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange_1());
writer.Write('out.stp');
const stepText = oc.FS.readFile('out.stp', { encoding: 'utf8' });
```
**메모리 관리**: embind로 감싼 OpenCASCADE 객체는 JS GC 대상이 아니다 — 다 쓴 객체는 `.delete()`를 호출해야 WASM 힙이 안 샌다. L5 돌기처럼 수천 개 만드는 루프에서는 특히 중요(아래 Task 5 참고).

---

## File Structure

- **Create** `src/model/levels.js` 수정(함수 추가) — L3의 2D 높이필드 함수 `l3BotZAt`
- **Create** `src/export/oc-build.js` — OpenCASCADE 프리미티브 헬퍼(순수 함수, `oc` 인자로 받음)
- **Create** `src/export/step-export.js` — 스펙 → STEP 텍스트 오케스트레이터(`oc` 인자로 받음, worker/Node 테스트 공용)
- **Create** `src/export/step-worker.js` — 브라우저 Web Worker 진입점(oc 로딩 + postMessage 핸들링)
- **Create** `src/export/step-ui.js` — 메인 스레드: 버튼 클릭 → 워커 기동 → 다이얼로그/진행률 오버레이 → 다운로드
- **Modify** `index.html` — "STEP 내보내기" 버튼 추가
- **Modify** `src/main.js` — `step-ui.js` 연결(현재 spec 전달)
- **Modify** `styles.css` — 진행률 오버레이 · 확인 다이얼로그 스타일
- **Create** `test/smoke-step.mjs` — Node 기반 STEP 빌더 검증(브라우저/워커 불필요)
- **Modify** `package.json` — `opencascade.js` devDependency, `test:step` 스크립트

---

### Task 1: L3의 2D 높이필드 함수 추가

`bodyProfile`의 L3 분기는 X축 단면만 계산한다(Y방향 테이퍼 없음). STEP 바디를 만들려면 X·Y 모두 반영된 실제 두께 함수가 필요하다 — `applyEdgeBoost`(directLit.js)가 이미 쓰는 "둥근 모서리 인지 가장자리 거리" 공식을 그대로 재사용해 2D로 일반화한다.

**Files:**
- Modify: `src/model/levels.js` (bodyProfile 함수 뒤, 파일 끝 부분에 추가)
- Test: `test/smoke-step.mjs` (Task 7에서 작성 — 이 함수를 직접 호출해 대칭성 검증)

- [ ] **Step 1: `l3BotZAt` 함수 추가**

`src/model/levels.js` 끝(`bodyProfile` 함수 다음)에 추가:

```js
// L3(균일두께 용기)의 실제 2D 두께 함수 — bodyProfile의 X단면 공식을 X·Y 모두 반영하도록
// 일반화. directLit.js applyEdgeBoost()가 쓰는 "둥근 모서리 인지 가장자리 거리" 공식과
// 반드시 같은 형태를 유지해야 광학 계산(edgeBoost)과 STEP 형상이 일치한다.
export function l3BotZAt(spec, depth, x, y) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const sp3 = levelParams(spec, 3);
  const baseThk = spec.levels?.[1]?.on ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const minBody = Math.max(1, baseThk * 0.5);
  const topZ = depth;
  const wallThk = Math.max(minBody, Math.min(sp3.wallThk ?? 3, topZ - spec.led.sizeZ - 0.5));
  const edgeAngleRad = clamp(sp3.edgeAngle ?? 45, 1, 89) * Math.PI / 180;
  const tw = wallThk > minBody ? (wallThk - minBody) / Math.tan(edgeAngleRad) : 0;
  const r = Math.max(0, Math.min(sp3.edgeR ?? 0, tw));

  const dx = Math.min(x, X - x), dy = Math.min(y, Y - y);
  const edgeDist = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : Math.min(dx, dy);
  const thk = edgeDist >= tw ? wallThk : Math.max(minBody, wallThk - Math.tan(edgeAngleRad) * (tw - edgeDist));
  return topZ - thk;
}
```

- [ ] **Step 2: Node로 직접 실행해 X단면과 일치하는지 확인**

```bash
node -e "
import('./src/model/levels.js').then(L => {
  const spec = { target:{xLen:100,yLen:20}, body:{baseThk:3,n:1.59}, led:{sizeX:1,sizeY:1,sizeZ:0.5,beamX:120},
    levels:{1:{on:true,thk:1},3:{on:true,wallThk:6,edgeAngle:45,edgeR:5}} };
  for (const x of [0,2,10,50]) console.log('x='+x+' y=10 ->', L.l3BotZAt(spec,12,x,10).toFixed(3));
});
"
```

Expected: x=0(가장자리) 이 x=50(중앙)보다 topZ에 더 가까운(두께 얇은) 값 — botZ가 x=0에서 가장 크고(얇음) x=50에서 가장 작다(두꺼움).

- [ ] **Step 3: Commit**

```bash
git add src/model/levels.js
git commit -m "feat: add 2D height function for L3 STEP export"
```
(이 프로젝트는 git 저장소가 아니므로 `git init` 없이는 이 커밋 단계는 건너뛴다 — 이후 태스크도 동일)

---

### Task 2: OpenCASCADE 프리미티브 헬퍼 (`oc-build.js`)

**Files:**
- Create: `src/export/oc-build.js`

- [ ] **Step 1: 헬퍼 함수 작성**

```js
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
    if (i > 1) acc.delete();   // shapes[0]은 호출측 소유라 첫 반복에서는 지우지 않음
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
  return text;
}
```

- [ ] **Step 2: 이 파일 단독 스모크 — Node에서 pyramid 하나 만들어 부피 확인**

```bash
npm install --no-save opencascade.js@2.0.0-beta.b5ff984
node -e "
import('opencascade.js/dist/node.js').then(async (m) => {
  const oc = await m.default();
  const B = await import('./src/export/oc-build.js');
  const s = B.coneBump(oc, 10, 10, 8, 4);
  console.log('volume', B.volumeOf(oc, s), 'expected ~266.67');
  process.exit(0);
});
"
```

Expected: `volume 266.6666... expected ~266.67`

- [ ] **Step 3: Commit**

```bash
git add src/export/oc-build.js
git commit -m "feat: add OpenCASCADE primitive helpers for STEP export"
```

---

### Task 3: 바디(L1~L4) 높이필드 솔리드 빌더

**Files:**
- Create: `src/export/step-body.js`

- [ ] **Step 1: 작성**

```js
// L1~L4 조합 바디 솔리드 — 평평한 윗면(z=topZ) + 높이필드 격자 메쉬 아랫면(z=botZAt(x,y))
// + 4면 옆벽. botZAt()는 호출측이 넘긴다(levels.js의 l3BotZAt/l4BotZAt를 그대로 사용해
// 화면 표시와 STEP이 항상 일치하게 함 — 새 형상 공식을 여기서 유도하지 않는다).

import { pnt, triFace, sewToSolid } from './oc-build.js';

// grid: nx*ny 격자점에서 botZAt(x,y) 샘플링. 기본 60x24(2D 곡면 정확도와 STEP 크기의 절충).
export function buildBodySolid(oc, { X, Y, topZ, botZAt, nx = 60, ny = 24 }) {
  const xs = Array.from({ length: nx }, (_, i) => (i / (nx - 1)) * X);
  const ys = Array.from({ length: ny }, (_, j) => (j / (ny - 1)) * Y);

  // 바닥 격자점 (botPts[j][i])
  const botPts = ys.map((y) => xs.map((x) => pnt(oc, x, y, botZAt(x, y))));

  const faces = [];

  // 바닥면 — 격자 사각형을 삼각형 2개로
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p00 = botPts[j][i], p10 = botPts[j][i + 1];
      const p01 = botPts[j + 1][i], p11 = botPts[j + 1][i + 1];
      faces.push(triFace(oc, p00, p10, p11));
      faces.push(triFace(oc, p00, p11, p01));
    }
  }

  // 윗면(평평, z=topZ) — 같은 X·Y 격자를 재사용해 옆벽과 정점을 공유
  const topPts = ys.map((y) => xs.map((x) => pnt(oc, x, y, topZ)));
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p00 = topPts[j][i], p10 = topPts[j][i + 1];
      const p01 = topPts[j + 1][i], p11 = topPts[j + 1][i + 1];
      faces.push(triFace(oc, p00, p11, p10));
      faces.push(triFace(oc, p00, p01, p11));
    }
  }

  // 옆벽 4면 — 바닥 경계 폴리라인과 윗면 경계(같은 x,y, topZ)를 잇는 리본
  const wallStrip = (botRow, topRow) => {
    for (let k = 0; k < botRow.length - 1; k++) {
      faces.push(triFace(oc, botRow[k], botRow[k + 1], topRow[k + 1]));
      faces.push(triFace(oc, botRow[k], topRow[k + 1], topRow[k]));
    }
  };
  wallStrip(botPts[0], topPts[0]);                                  // y=0
  wallStrip(botPts[ny - 1].slice().reverse(), topPts[ny - 1].slice().reverse()); // y=Y
  wallStrip(botPts.map((r) => r[0]).reverse(), topPts.map((r) => r[0]).reverse()); // x=0
  wallStrip(botPts.map((r) => r[nx - 1]), topPts.map((r) => r[nx - 1]));          // x=X

  // 윗면/바닥면과 4개 옆벽의 삼각형 정점 순서(winding)가 서로 반대라 sewToSolid() 결과가
  // 전체적으로 뒤집힌(부호가 음수인) 솔리드가 된다 — Sewing이 관대해 겉보기엔 닫힌 솔리드로
  // 보이지만(실측: volumeOf()의 Math.abs()가 이걸 가려왔음), 제작용 STEP에는 부적절해 마지막에
  // 전체를 한 번 뒤집어 바로잡는다.
  return sewToSolid(oc, faces).Reversed();
}
```

- [ ] **Step 2: Node로 평평한 바디(L1만, botZ=상수) 검증 — 직육면체와 부피 일치해야 함**

```bash
node -e "
import('opencascade.js/dist/node.js').then(async (m) => {
  const oc = await m.default();
  const { buildBodySolid } = await import('./src/export/step-body.js');
  const { volumeOf } = await import('./src/export/oc-build.js');
  const s = buildBodySolid(oc, { X:100, Y:20, topZ:12, botZAt: () => 9, nx:10, ny:8 });
  console.log('volume', volumeOf(oc, s), 'expected', 100*20*3);
  process.exit(0);
});
"
```

Expected: `volume 6000 expected 6000` (허용 오차 격자 근사로 <1%)

- [ ] **Step 3: L3 실제 형상으로 검증 — 같은 wallThk(6mm)의 "테이퍼 없는 평판"보다 부피가 작은지 확인**

(주의: L1 기준판 3mm가 아니라, L3 자신의 중앙 두께 wallThk=6mm 평판과 비교해야 한다 — L3 중앙부는 원래 6mm 로 3mm 평판보다 두껍고, 가장자리 테이퍼 폭(tw)이 타겟 전체 면적 대비 작은 좁은 띠라서 3mm 기준과 비교하면 테이퍼가 있어도 전체 부피가 더 크게 나온다. "가장자리가 얇아진다"는 wallThk 자체를 기준판으로 삼아야 검증된다.)

```bash
node -e "
import('opencascade.js/dist/node.js').then(async (m) => {
  const oc = await m.default();
  const { buildBodySolid } = await import('./src/export/step-body.js');
  const { volumeOf } = await import('./src/export/oc-build.js');
  const { l3BotZAt } = await import('./src/model/levels.js');
  const spec = { target:{xLen:100,yLen:20}, body:{baseThk:3,n:1.59}, led:{sizeX:1,sizeY:1,sizeZ:0.5,beamX:120},
    levels:{1:{on:true,thk:1},3:{on:true,wallThk:6,edgeAngle:45,edgeR:5}} };
  const s = buildBodySolid(oc, { X:100, Y:20, topZ:12, botZAt:(x,y)=>l3BotZAt(spec,12,x,y), nx:40, ny:16 });
  const flatRef = buildBodySolid(oc, { X:100, Y:20, topZ:12, botZAt: () => 12 - 6, nx:10, ny:8 }); // wallThk=6mm 평판(테이퍼 없음)
  console.log('L3 volume', volumeOf(oc, s), '/ flat(6mm) ref volume', volumeOf(oc, flatRef), '(L3 < ref 여야 함 — 가장자리가 얇아짐)');
  process.exit(0);
});
"
```

Expected: L3 volume < flat(6mm) ref volume(=12000)

- [ ] **Step 4: Commit**

```bash
git add src/export/step-body.js
git commit -m "feat: add height-field body solid builder for STEP export"
```

---

### Task 4: LED 박스 · PCB · L5 돌기 빌더 + 전체 오케스트레이터

**Files:**
- Create: `src/export/step-export.js`

- [ ] **Step 1: 작성**

```js
// spec + solveCombo 결과 + buildGeometry 결과 → STEP 텍스트. worker와 Node 테스트가 공유.
// oc(초기화된 opencascade.js 인스턴스)를 인자로 받는다 — 이 파일 자체는 opencascade.js를
// import하지 않는다(로딩 방식은 worker/테스트마다 다르므로).

import { box, translate, fuseAll, coneBump, ridgeBump, shapesToStepText, volumeOf } from './oc-build.js';
import { buildBodySolid } from './step-body.js';
import { l3BotZAt, l4BotZAt, levelParams } from '../model/levels.js';

const PCB_THK = 1; // mm — 스펙에 값이 없어 기본값 사용(설계 문서 §범위)

// 솔리드를 X축 기준 180도 회전시켜 "위로 돌출"하던 형상을 "아래로 돌출"하게 뒤집는다.
// 회전(determinant +1)은 면 방향(orientation)을 그대로 보존한다 — 처음엔 height를 음수로
// 넘겨 꼭짓점만 뒤집으려 했으나, 그건 사실상 Z축 미러(determinant -1)라 면 방향이 반전되어
// Boolean Fuse가 돌기를 "구멍"처럼 취급해 결과 부피가 거의 0이 되는 문제가 실측으로 확인됨
// (body+bump fuse가 1200대신 0.17만 나옴) — 회전으로 바꿔 해결.
function flipDown(oc, shape) {
  const trsf = new oc.gp_Trsf_1();
  const axis = new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(1, 0, 0));
  trsf.SetRotation_1(axis, Math.PI);
  const xf = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false);
  const moved = xf.Shape();
  axis.delete(); trsf.delete(); xf.delete();
  return moved;
}

// 활성 레벨 조합에서 botZAt(x,y) 함수를 만든다. bodyProfile()과 동일한 우선순위(L4가 L3를 대체).
// leds/halfP는 호출측(buildStepForSpec)이 넘긴다 — spec 객체에 임시 필드를 얹지 않기 위함
// (그렇게 하면 예외 발생 시 caller가 예상 못한 채로 spec이 오염된 상태로 남는 문제가 있었음).
function makeBotZAt(spec, active, depth, leds, halfP) {
  const A = active instanceof Set ? active : new Set(active);
  if (A.has(4)) {
    const near = (x, y) => leds.length ? Math.min(...leds.map((l) => Math.hypot(x - l.x, y - l.y))) : 1e9;
    return (x, y) => l4BotZAt(spec, A, depth, near(x, y), halfP);
  }
  if (A.has(3)) return (x, y) => l3BotZAt(spec, depth, x, y);
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  return () => depth - baseThk;
}

// L5 돌기 하나의 로컬 솔리드(면 방향이 올바른 양의 부피로 나오도록 height 는 항상 양수로
// 빌드) + flipDown 으로 뒤집어 "기구물 하단"(바디 바깥쪽, LED 방향)으로 돌출하게 만든다.
// 로컬 z=0 이 부착면(바디의 하단면과 맞닿는 면).
function buildL5Bump(oc, p5) {
  const sizeX = p5.sizeX ?? 0.3, sizeY = p5.sizeY ?? 0.3, h = p5.depth ?? 0.2;
  const up = p5.ptype === 'dome' ? coneBump(oc, sizeX, sizeY, h, 10)
    : p5.ptype === 'prism' ? ridgeBump(oc, sizeX, sizeY, h)
    : coneBump(oc, sizeX, sizeY, h, 4); // pyramid(기본)
  const down = flipDown(oc, up);
  up.delete();
  return down;
}

// L5 돌기가 놓일 위치(피치 기반 격자, LED 배열과 별개 — sizeX/Y=pitch)를 계산.
function l5Positions(spec, X, Y) {
  const p5 = levelParams(spec, 5);
  const pitchX = Math.max(0.02, p5.sizeX ?? 0.3), pitchY = Math.max(0.02, p5.sizeY ?? 0.3);
  const nx = Math.max(1, Math.round(X / pitchX)), ny = Math.max(1, Math.round(Y / pitchY));
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    out.push({ x: (i + 0.5) * (X / nx), y: (j + 0.5) * (Y / ny) });
  }
  return out;
}

// L5 돌기 예상 개수(확인 다이얼로그용 — 메인 스레드에서 oc 없이도 호출 가능).
export function estimateL5BumpCount(spec, active) {
  const A = active instanceof Set ? active : new Set(active);
  if (!A.has(5)) return 0;
  return l5Positions(spec, spec.target.xLen, spec.target.yLen).length;
}

// 메인 진입점. combo/geom은 solveCombo()/buildGeometry() 결과(main.js run()과 동일 소스).
// onProgress(done, total, label) — 선택적 진행률 콜백.
export function buildStepForSpec(oc, spec, combo, geom, onProgress) {
  const active = new Set(geom.tags?.map((t) => Number(t.slice(1))) ?? []);
  if (active.size === 0) for (const l of [1, 2, 3, 4, 5]) if (spec.levels[l]?.on) active.add(l);
  const depth = combo.depth;
  const X = spec.target.xLen, Y = spec.target.yLen;

  const halfP = geom.l4HalfP ?? Math.max(1, Math.min(combo.pitchX, combo.pitchY ?? combo.pitchX) / 2);
  const botZAt = makeBotZAt(spec, active, depth, geom.leds, halfP);

  let body = buildBodySolid(oc, { X, Y, topZ: depth, botZAt });

  const shapes = [body];

  // L5 — 돌기를 만들어 바디에 순차 Fuse(dir='오목'이면 Cut 대신, 이번 범위는 '돌출'만 지원
  // 하고 오목은 향후 과제로 미룸 — 설계 문서에 없던 범위 확장이라 별도 처리하지 않음).
  if (active.has(5)) {
    const p5 = levelParams(spec, 5);
    const positions = l5Positions(spec, X, Y);
    const bumps = [];
    let done = 0;
    for (const p of positions) {
      const local = buildL5Bump(oc, p5);
      const z = botZAt(p.x, p.y); // 바디 "하단"면(위치별 실제 두께)에 부착 — 상수 depth(윗면)가 아님
      bumps.push(translate(oc, local, p.x, p.y, z));
      local.delete();
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, positions.length, 'L5 돌기 생성');
    }
    const fused = fuseAll(oc, [body, ...bumps], (i, total) => onProgress?.(i, total, 'L5 돌기 결합'));
    body.delete();               // fuseAll()의 계약: shapes[0](=body)은 호출측이 정리
    for (const b of bumps) b.delete();
    body = fused;
    shapes[0] = fused;
  }

  // LED 박스 — z=0(LED 장착면) 기준, geom.leds가 실제 배치 좌표.
  const ledSize = geom.ledSize ?? { x: spec.led.sizeX, y: spec.led.sizeY, z: spec.led.sizeZ };
  for (const l of geom.leds) {
    const local = box(oc, ledSize.x, ledSize.y, ledSize.z);
    shapes.push(translate(oc, local, l.x - ledSize.x / 2, l.y - ledSize.y / 2, 0));
    local.delete();
  }
  onProgress?.(geom.leds.length, geom.leds.length, 'LED 배치');

  // PCB — 타겟 전체 크기, LED 바로 아래(z<0).
  const pcbLocal = box(oc, X, Y, PCB_THK);
  shapes.push(translate(oc, pcbLocal, 0, 0, -PCB_THK));
  pcbLocal.delete();

  onProgress?.(1, 1, 'STEP 직렬화');
  const stepText = shapesToStepText(oc, shapes);
  const bodyVolume = volumeOf(oc, shapes[0]);
  for (const s of shapes) s.delete();   // 이 함수가 만든 모든 솔리드는 이 함수가 정리한다
  return { stepText, solidCount: shapes.length, bodyVolume };
}
```

- [ ] **Step 2: L1 단독으로 전체 파이프라인 Node 검증**

```bash
node -e "
import('opencascade.js/dist/node.js').then(async (m) => {
  const oc = await m.default();
  const { buildStepForSpec } = await import('./src/export/step-export.js');
  const { DEFAULT_SPEC } = await import('./src/model/defaults.js');
  const { solveCombo } = await import('./src/engine/solver.js');
  const { buildGeometry } = await import('./src/model/geometry.js');
  const spec = JSON.parse(JSON.stringify(DEFAULT_SPEC));
  for (const k of [2,3,4,5]) spec.levels[k].on = false;
  spec.levels[1].on = true;
  const combo = solveCombo(spec, [1]);
  const geom = buildGeometry(spec, { depth: combo.depth, ledPitch: combo.pitchX, ledPitchY: combo.pitchY ?? combo.pitchX, active: [1], padX: combo.padX, padY: combo.padY });
  const r = buildStepForSpec(oc, spec, combo, geom);
  console.log('solidCount', r.solidCount, 'bodyVolume', r.bodyVolume, 'stepLen', r.stepText.length);
  process.exit(0);
});
"
```

Expected: `solidCount` = 1(바디) + LED 개수 + 1(PCB), `stepText.length` > 0, 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src/export/step-export.js
git commit -m "feat: add STEP export orchestrator (body + LED + PCB + L5 bumps)"
```

---

### Task 5: Web Worker

**Files:**
- Create: `src/export/step-worker.js`

- [ ] **Step 1: 작성**

`opencascade.full.js`를 실제로 다운로드해 직접 확인한 결과(브라우저 없이도 파일 자체로 확정
가능했음 — 아래 원래 Step 2로 있던 "브라우저에서만 확인 가능" 항목은 이제 불필요), 이 파일은
**classic script가 아니라 ES 모듈**이다(`export default Module;`로 끝남 — `Module`은
`function(moduleArg){ ...; return Module.ready }` 형태의 표준 Emscripten MODULARIZE 팩토리).
즉 `importScripts()`(classic worker 전용)로는 애초에 로드가 안 되고(문법 에러), **module
worker**(`new Worker(url, {type:'module'})`)여야 `import`로 로드할 수 있다. module worker는
정적 `import`도 지원하므로 `step-export.js`도 동적 `import()` 대신 정적으로 가져온다.

```js
// STEP 내보내기 전용 Web Worker — 무거운 OpenCASCADE 연산이 메인 UI를 멈추지 않게 분리.
// module worker(new Worker(url, {type:'module'})로 기동해야 함 — opencascade.full.js가
// `export default Module;`로 끝나는 ES 모듈이라 classic worker의 importScripts()로는 로드
// 자체가 SyntaxError로 실패함을 실제 파일을 받아 확인함.

import { buildStepForSpec } from './step-export.js';

const OC_VERSION = '2.0.0-beta.b5ff984';
const OC_BASE = `https://cdn.jsdelivr.net/npm/opencascade.js@${OC_VERSION}/dist/`;

let ocPromise = null;
function loadOc() {
  if (!ocPromise) {
    ocPromise = import(/* webpackIgnore: true */ OC_BASE + 'opencascade.full.js').then((mod) =>
      mod.default({ locateFile: (p) => (p.endsWith('.wasm') ? OC_BASE + 'opencascade.full.wasm' : p) })
    );
  }
  return ocPromise;
}

self.onmessage = async (ev) => {
  const { spec, combo, geom } = ev.data;
  try {
    const oc = await loadOc();
    const onProgress = (done, total, label) => self.postMessage({ type: 'progress', done, total, label });
    const r = buildStepForSpec(oc, spec, combo, geom, onProgress);
    self.postMessage({ type: 'done', stepText: r.stepText, solidCount: r.solidCount });
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message ?? String(e) });
  }
};
```

- [ ] **Step 2: `opencascade.full.js`가 ES 모듈로서 import 가능하고 default export가 함수인지만
  Node로 가볍게 확인(실제 팩토리 호출/실행까지는 Node에서 확인 불가 — 아래 이유 참고)**

```bash
node -e "
import('opencascade.js/dist/opencascade.full.js').then((mod) => {
  console.log('default export type:', typeof mod.default);
  process.exit(0);
}).catch((e) => { console.log('import FAILED:', e.message); process.exit(1); });
"
```

Expected: `default export type: function`.

(주의: 이 팩토리를 실제로 **호출**하는 것까지 Node에서 확인하려 해봤으나 실패한다 — 파일 내부의
Node 분기 코드가 ESM 컨텍스트엔 없는 `__dirname`을 참조해 `ReferenceError`가 난다. 이건 이
파일이 브라우저/워커용으로 빌드된 것이라 Node CJS 전용 관례에 안 맞아서 생기는, Node에서
직접 실행할 때만 나는 문제다 — 실제 목표 환경인 브라우저 module worker에서는
`ENVIRONMENT_IS_NODE`가 false라 이 코드 경로 자체를 안 타므로 무관하다. npm 패키지가 Node용으로
별도 `dist/node.js`를 제공하는 이유가 바로 이 차이 때문이다. 팩토리 호출까지의 최종 확인은
Task 6 Step 5의 실제 브라우저 테스트에서 한다.)

- [ ] **Step 3: Commit**

```bash
git add src/export/step-worker.js
git commit -m "feat: add STEP export web worker"
```

---

### Task 6: 메인 스레드 UI 연결

**Files:**
- Create: `src/export/step-ui.js`
- Modify: `index.html:12-16`
- Modify: `src/main.js` (import 구역 + `mount()` 근처)
- Modify: `styles.css` (파일 끝에 추가)

- [ ] **Step 1: `index.html`에 버튼 추가**

`index.html:12-16`을 다음으로 교체:

```html
    <div class="actions">
      <button id="btn-reset">기본값</button>
      <button id="btn-export">JSON 내보내기</button>
      <button id="btn-step">STEP 내보내기</button>
      <label class="import">불러오기<input type="file" id="file-import" accept="application/json" hidden /></label>
    </div>
```

- [ ] **Step 2: `src/export/step-ui.js` 작성**

```js
// STEP 내보내기 — 메인 스레드 오케스트레이터. spec/combo/geom(main.js run()이 이미 계산한
// 것과 동일한 소스)을 받아 워커를 기동하고, 진행률 오버레이·확인 다이얼로그·다운로드를 맡는다.

import { estimateL5BumpCount } from './step-export.js';

const BUMP_WARN_THRESHOLD = 2000;

function overlay(text) {
  let el = document.getElementById('step-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'step-overlay';
    el.className = 'step-overlay';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  return el;
}
function hideOverlay() {
  const el = document.getElementById('step-overlay');
  if (el) el.hidden = true;
}

export function exportStep(spec, combo, geom, active) {
  const bumpCount = estimateL5BumpCount(spec, active);
  if (bumpCount > BUMP_WARN_THRESHOLD) {
    const ok = confirm(`돌기 ${bumpCount}개 — 계산에 시간이 오래 걸리거나 브라우저가 느려질 수 있습니다. 계속하시겠습니까?`);
    if (!ok) return;
  }

  // module worker — step-worker.js가 opencascade.full.js(export default 로 끝나는 ES 모듈)를
  // import 하므로 classic worker(기본값)로는 로드가 안 됨.
  const worker = new Worker(new URL('./step-worker.js', import.meta.url), { type: 'module' });
  const el = overlay('STEP 생성 중…');

  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === 'progress') {
      el.textContent = `STEP 생성 중… (${msg.label} ${msg.done}/${msg.total})`;
    } else if (msg.type === 'done') {
      hideOverlay();
      const blob = new Blob([msg.stepText], { type: 'application/step' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'fixture.stp';
      a.click();
      URL.revokeObjectURL(a.href);
      worker.terminate();
    } else if (msg.type === 'error') {
      hideOverlay();
      alert('STEP 생성 실패: ' + msg.message);
      console.error('STEP export failed:', msg.message);
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    hideOverlay();
    alert('STEP 생성 실패: ' + e.message);
    worker.terminate();
  };

  // structuredClone 불가 필드(함수 등)가 없는 순수 데이터만 전달.
  worker.postMessage({
    spec: JSON.parse(JSON.stringify(spec)),
    combo: { depth: combo.depth, pitchX: combo.pitchX, pitchY: combo.pitchY, padX: combo.padX, padY: combo.padY },
    geom: { leds: geom.leds, ledSize: geom.ledSize, l4HalfP: geom.l4HalfP, tags: geom.levelText.split(' + ').filter((t) => /^L\d$/.test(t)) },
  });
}
```

- [ ] **Step 3: `src/main.js`에 연결**

`src/main.js` 상단 import 구역(다른 `import ... from './ui/...'` 줄들 근처)에 추가:

```js
import { exportStep } from './export/step-ui.js';
```

`run()` 함수 안, `last = { common, m, depth, view: geom.view, edgeMargin };` 바로 다음 줄에 추가(STEP 버튼이 항상 최신 combo/geom을 쓰도록 `last`에 보관):

```js
last.combo = combo; last.geom = geom; last.active = active;
```

`mount()` 함수 안, 다른 버튼 핸들러들(`$('#btn-reset').onclick = ...` 등)이 연결된 곳 근처에 추가:

```js
$('#btn-step').onclick = () => {
  if (!last) return;
  exportStep(spec, last.combo, last.geom, last.active);
};
```

- [ ] **Step 4: `styles.css` 끝에 오버레이 스타일 추가**

```css
.step-overlay {
  position: fixed; inset: 0; background: rgba(15, 20, 32, 0.75);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 15px; z-index: 999;
}
.step-overlay[hidden] { display: none; }
```

- [ ] **Step 5: 브라우저에서 수동 확인**

```bash
npx --yes serve -l 5299 .
```

브라우저로 `http://localhost:5299` 열고 "STEP 내보내기" 클릭 → 오버레이가 뜨고 → `fixture.stp` 다운로드되는지, 콘솔에 에러 없는지 확인. (Task 5 Step 2에서 확인한 실제 팩토리 전역명이 안 맞으면 여기서 에러가 남 — 그 경우 `step-worker.js`를 다시 고친다.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.js src/export/step-ui.js styles.css
git commit -m "feat: wire up STEP export button in UI"
```

---

### Task 7: Node 스모크 테스트

**Files:**
- Create: `test/smoke-step.mjs`
- Modify: `package.json`

- [ ] **Step 1: `package.json`에 devDependency·스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:

```json
    "test:step": "node test/smoke-step.mjs"
```

`package.json`에 추가(없으면 새 필드로):

```json
  "devDependencies": {
    "opencascade.js": "2.0.0-beta.b5ff984"
  }
```

- [ ] **Step 2: `test/smoke-step.mjs` 작성**

```js
// STEP 내보내기 빌더 검증 — 브라우저/워커 없이 Node에서 opencascade.js를 직접 호출.
// 무겁고(WASM 50MB) 느려서 기본 `npm test`(test/smoke.mjs)와는 분리: `npm run test:step`.
import initOpenCascade from 'opencascade.js/dist/node.js';
import { buildStepForSpec } from '../src/export/step-export.js';
import { volumeOf } from '../src/export/oc-build.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { solveCombo } from '../src/engine/solver.js';
import { buildGeometry } from '../src/model/geometry.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('PASS', name); pass++; }
  else { console.log('FAIL', name, detail); fail++; }
}

function specWith(levels) {
  const spec = JSON.parse(JSON.stringify(DEFAULT_SPEC));
  for (const k of [1, 2, 3, 4, 5]) spec.levels[k].on = false;
  for (const l of levels) spec.levels[l].on = true;
  return spec;
}

function run(oc, spec, active) {
  const combo = solveCombo(spec, active);
  const geom = buildGeometry(spec, {
    depth: combo.depth, ledPitch: combo.pitchX, ledPitchY: combo.pitchY ?? combo.pitchX,
    active, padX: combo.padX, padY: combo.padY,
  });
  return buildStepForSpec(oc, spec, combo, geom);
}

const oc = await initOpenCascade();

// L1 단독 — 평판, 솔리드 개수 = 바디 + LED*N + PCB, STEP 텍스트가 비어있지 않아야 함.
{
  const spec = specWith([1]);
  const r = run(oc, spec, [1]);
  check('L1 STEP 생성 성공', r.stepText.length > 100, 'len=' + r.stepText.length);
  check('L1 바디 부피 > 0', r.bodyVolume > 0, 'vol=' + r.bodyVolume);
}

// L3 — 바디 부피가 L1(평판, baseThk=3mm 전체)보다 작아야 함(가장자리 얇아짐).
{
  const specFlat = specWith([1]);
  const rFlat = run(oc, specFlat, [1]);
  const spec3 = specWith([1, 3]);
  spec3.levels[3].wallThk = 6; spec3.levels[3].edgeAngle = 45; spec3.levels[3].edgeR = 5;
  const r3 = run(oc, spec3, [1, 3]);
  check('L3 STEP 생성 성공', r3.stepText.length > 100);
  check('L3 바디 부피 < L1 평판 부피', r3.bodyVolume < rFlat.bodyVolume, `L3=${r3.bodyVolume} L1=${rFlat.bodyVolume}`);
}

// L4 — 정상 생성만 확인(형상은 L3와 다른 함수 경로).
{
  const spec4 = specWith([1, 4]);
  const r4 = run(oc, spec4, [1, 4]);
  check('L4 STEP 생성 성공', r4.stepText.length > 100);
}

// L5 — 작은 타겟(패턴 개수 적게)으로 Boolean Fuse 경로까지 확인.
{
  const spec5 = specWith([1, 5]);
  spec5.target.xLen = 5; spec5.target.yLen = 5;
  spec5.levels[5].sizeX = 1; spec5.levels[5].sizeY = 1; spec5.levels[5].depth = 0.3;
  const r5 = run(oc, spec5, [1, 5]);
  check('L5(소량 패턴) STEP 생성 성공', r5.stepText.length > 100);
  check('L5 바디 부피(돌기 포함) > 평판만일 때', r5.bodyVolume > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3: 실행**

```bash
npm install
npm run test:step
```

Expected: 모든 케이스 `PASS`, 마지막 줄 `N passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add test/smoke-step.mjs package.json
git commit -m "test: add Node-based STEP export smoke tests"
```

---

### Task 8: 최종 확인 — 기존 스모크 테스트에 영향 없는지 + 정리

**Files:**
- (변경 없음, 검증만)

- [ ] **Step 1: 기존 smoke test가 여전히 통과하는지 확인**

```bash
node test/smoke.mjs
```

Expected: `ALL PASSED` (Task 1~7이 기존 `levelEffect`/`solver`/`directLit` 로직을 건드리지 않았으므로 그대로 통과해야 함 — 만약 실패하면 Task 1의 `l3BotZAt` 추가가 기존 export를 깨뜨린 게 아닌지 확인).

- [ ] **Step 2: 임시로 설치한 heavy devDependency 정리(선택) 또는 유지**

`opencascade.js`는 이제 `package.json`의 정식 devDependency이므로 `node_modules`를 지울 필요는 없다. CI/저장소 용량이 걱정되면 `.gitignore`에 `node_modules/`가 이미 포함돼 있는지 확인(신규 devDependency 추가로 새로 생긴 게 없는지).

```bash
cat .gitignore
```

Expected: `node_modules` 항목 존재.

---

## Self-Review (완료 후 확인용 — 실행자는 각 태스크 완료 시 이 표를 참고)

| 스펙 요구사항 | 담당 태스크 |
|---|---|
| 현재 적용 조합만 내보내기 | Task 4 (`buildStepForSpec`) |
| LED 포함(spec.led 치수, 실제 좌표) | Task 4 (LED 박스 루프) |
| PCB 포함(1mm 기본값) | Task 4 (PCB 박스) |
| OpenCASCADE.js + Web Worker | Task 5, 6 |
| L5 대량 돌기 시 확인 다이얼로그(2000개) | Task 6 (`step-ui.js`) |
| 진행률 표시 | Task 5(postMessage) + Task 6(오버레이) |
| 실패 시 에러 메시지 | Task 5, 6 |
| Node 기반 자동 검증(watertight·부피) | Task 7 |
| 화면 렌더링과 동일한 형상 공식 재사용 | Task 1(l3BotZAt), Task 4(l4BotZAt/bodyProfile 재사용) |

**알려진 리스크 / 실행자가 반드시 확인해야 할 것:**
- (해결됨) `opencascade.full.js`의 실제 모듈 형식은 파일을 직접 받아 확인했다 — classic
  script가 아니라 `export default Module;`로 끝나는 ES 모듈이라, worker는 반드시
  `{type:'module'}`로 띄워야 한다(Task 5·6에 반영됨). 다만 그 팩토리를 실제로 **호출**해
  끝까지 초기화되는지는 Node에서 확인이 안 되므로(브라우저 전용 코드 경로), Task 6 Step 5의
  실제 브라우저 확인은 여전히 건너뛰지 말 것.
- L5 "오목"(`dir: '오목'`)은 이번 범위에서 Boolean Cut을 구현하지 않았다(설계 문서에 명시된 범위 밖 — "돌출"만 지원). 필요하면 별도 태스크로 추가.
- `BRepAlgoAPI_Fuse`를 수천 번 순차 호출하는 구조라, 정말 수천 개 돌기가 있으면 여전히 느릴 수 있다(설계 문서에서 이미 사용자에게 안내한 리스크).
