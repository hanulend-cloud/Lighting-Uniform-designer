# 3D 기구 모드 P3 — LED 정의 · 관측면 · 라인 인식 · 집계 계산 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D 기구 모드에서 사용자가 광원과 관측면을 정의하고, 계산 한 번으로 길이·폭 방향 균일도 판정을 얻는다.
- **광원:** LED STEP 을 불러와 LED 를 자동 인식하거나, 관측 라인을 따라 직접 배치한다.
- **관측면:** 3D 뷰에서 면을 클릭해 지정하고, 라인(직선·원·자유곡선)을 자동 인식한다.

**Architecture:** 순수 JS 엔진 모듈은 Node 테스트로 검증한다.

| 모듈 | 내용 |
|---|---|
| `led-detect.js` | LED 인식·발광면 전파 |
| `line.js` | 투영·래스터·세선화·경로·직선/원 맞춤, (s,w) 좌표 |
| `placement.js` | 직접 배치, PCB 평면 |
| `tally.js` | 관측 집계·판정 |
| `job.js` | 장면 합성·실행. 메인과 Worker 가 공용으로 쓴다 |

계산은 Worker 여러 개에 광자를 나눠 돌리고, 메인에서 배치별 결과를 합친다. UI 는 기존 3D 패널 아래에 "광원 · 관측 · 계산" 패널을 추가하고, 3D 뷰에 LED·관측면·라인 표시를 더한다.

**Tech Stack:** 무빌드 ES 모듈, three.js(CDN), Node 테스트(`node test/*.mjs`, PASS/FAIL, 실패 시 exit 1).

**Spec:** `docs/superpowers/specs/2026-10-14-3d-line-light-design.md` §4(LED 정의), §5(관측면·라인 인식), §6.1, §7(V3D-5), §8(P3)

---

## 설계 결정 (spec 대비 보완 — 실행 전 확인됨)

1. **LED 인식 기준을 회전 불변량으로 바꾼다.** spec 은 "외곽 크기 ±0.05mm" 이지만 축정렬 외곽은 회전하면 달라진다. 그래서 면 수가 같고, 부피·표면적이 ±1%, 중심에서 가장 먼 점까지 거리가 ±0.05mm 인 솔리드를 같은 LED 로 본다.
2. **발광면 전파는 면 번호로 한다.** 같은 STEP 의 동일 LED 인스턴스는 형상(TShape)을 공유하므로 면 순서가 같다. 그래서 기준 LED 의 발광면 번호를 그대로 쓰고, 면적·중심거리·법선 각으로 검증한다. 맞지 않으면 같은 기술자를 가진 면을 찾고, 그래도 없으면 "확인 필요"로 표시한다.
3. **LED 몸체와 PCB 를 장면에 넣는다.**
   - LED 몸체: 불투명, 백색 확산 80%(백색 실리콘 패키지)
   - PCB: 불투명, 솔더레지스트 색 반사율(백색 0.8 / 녹색 0.3 / 흑색 0.05)
   - 발광은 발광면 중심에서 법선 방향으로 시작한다.
4. **직접 배치의 PCB 위치**
   - "관측면 아래 깊이(mm)" 를 입력한 경우: 관측면 최저점에서 관측 방향 반대로 그 깊이만큼 내려간 평면에 가상 PCB 를 둔다.
   - 기구 부품의 면을 클릭한 경우: 그 면에 LED 를 놓는다.
5. **관측 집계는 탈출 시점에 한다.** `onExit` 로 관측면에서 나간 지점을 광자별로 기억해 두고, 그 광자가 관측 방향 ±cone 안으로 **탈출(onEscape)** 할 때만 그 지점에 집계한다. 내부 공기 틈 전이나, 다시 들어간 빛은 세지 않는다.
   - 한계: 관측면을 나온 뒤 불투명 부품(베젤)에 반사되어 탈출한 빛도 원래 출사점에 집계된다. 드물어서 P5 에서 필요하면 보완한다.
6. **판정 값**
   - 길이: s 구간별 (폭 방향 유효 셀 평균) 의 min/max
   - 폭: s 구간별 (유효 셀 min/max) 중 최저와 그 위치
   - 유효 셀: 영역 경계에서 edgeExcl(기본 0.5mm) 이상 안쪽이고, 열린 라인이면 양 끝 edgeExcl 도 뺀다.
   - 각 값에는 배치(10개) 표준오차를 같이 보고한다. MC 잡음은 min/max 를 낮게 편향시키므로, 오차가 크면 경고를 띄운다.
7. **관측 원뿔 기본값을 30° 로 한다(spec ±10° 에서 변경, 패널에서 조절 가능).** Lambert 에 가까운 확산면에서 ±10° 원뿔이 받는 빛은 sin²10° ≈ 3% 뿐이다. 그래서 20만 광자로는 0.5mm 셀마다 몇 개밖에 쌓이지 않아 판정이 잡음에 묻힌다.
   - ±30° 는 25% 를 받는다. 확산재(Milky)를 지난 빛은 방향 분포가 넓어서, ±10° 와 ±30° 의 균일도 차이는 작다.
   - 정확한 방향별 휘도는 P5 에서 **관측 방향 다음 사건 추정기(NEE)** 로 보완한다. 산란점에서 관측 방향으로 굴절해 나가는 기여를 결정론적으로 더하는 방식이다.

## 데이터 모델 (spec.mech3d 추가 필드)

```js
light: {
  kind: 'none' | 'step' | 'manual',
  solder: '백색' | '녹색' | '흑색',
  spec: { model: 'lambertian' | 'gaussian', beam: 120, sizeX: 2, sizeY: 2 },   // LED 배광·발광면(L1 LED 와 같은 정의)
  step: null | { name, offset: [0,0,0], rot: [0,0,0], ref: null | { part, face }, leds: [partIdx], excluded: [partIdx], pcb: partIdx | -1, emitters: [{ part, face, pos, axis, xAxis, needsCheck }] },
  manual: { pcb: { kind: 'depth', depth: 10 } | { kind: 'face', part, face }, count: 10, pitch: 0, side: 'direct' | 'left' | 'right' },
}
observe: { faces: [{ part, face }], dir: null | [x,y,z], cone: 30, cell: 0.5, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.8 }
```

LED STEP 메쉬는 IndexedDB(`uds-shape`/`body`/키 `mech3d-led`)에 둔다. 사용자 지정만 spec 에 저장한다.

## 파일 구조

| 파일 | 책임 |
|---|---|
| Create `src/engine/mech3d/defs.js` | light/observe 기본값, 솔더 반사율, 마이그레이션 |
| Create `src/engine/mech3d/xform.js` | 메쉬 강체 변환(이동·XYZ 오일러 회전) |
| Create `src/engine/mech3d/led-detect.js` | `meshStats`, `faceInfo`, `findLeds`, `findEmitters`, `pcbIndex` |
| Create `src/engine/mech3d/line.js` | `obsDirection`, `recognizeLine`, `lineFromData`, (s,w)↔2D↔3D |
| Create `src/engine/mech3d/placement.js` | `manualLeds`, `pcbPlaneMesh` |
| Create `src/engine/mech3d/tally.js` | `tallyGeometry`, `makeAccumulator`, `tallyStats` |
| Create `src/engine/mech3d/job.js` | `composeScene`, `runJob` (메인·Worker 공용) |
| Create `src/engine/mech3d/mc3d-worker.js` | 계산·라인 인식 Worker |
| Modify `src/engine/mech3d/runtime.js` | `buildSceneMesh`(전역 미변경 장면 생성), LED STEP 메쉬 보관·IDB, 초기 spec 에 light/observe |
| Modify `src/ui/mech3d-view.js` | 추가 부품(PCB·LED) 색, 관측면 강조, 라인·LED 화살표 오버레이, 변경 부품만 재착색 |
| Create `src/ui/mech3d-light-panel.js` | 광원·관측·계산 패널 |
| Modify `src/main.js` | 선택 모드(부품/LED/관측/PCB), LED STEP 불러오기, 라인 인식·계산 Worker 연결, 입력바 숨김 |
| Modify `index.html`, `styles.css` | 패널 자리·스타일 |
| Create `test/mech3d-xform.mjs`, `test/mech3d-led.mjs`, `test/mech3d-line.mjs`, `test/mech3d-place.mjs`, `test/mech3d-tally.mjs`, `test/mech3d-job.mjs` | 테스트 |
| Modify `test/mech3d-util.mjs` | `mergeMeshes`, 회전 행렬, 판 메쉬(평면 다각형 → 위·아래 면) |
| Create `test/fixtures/mech3d-led-sample.mjs` + `.stp` | 샘플 LED STEP(PCB + LED 10개, 샘플 기구 도광 바 아래) |
| Modify `package.json` | `test:mech3d` 에 빠른 테스트 추가 |

---

### Task 1: 공용 기본값 · 강체 변환 · 테스트 유틸

**Files:**
- Create: `src/engine/mech3d/defs.js`, `src/engine/mech3d/xform.js`, `test/mech3d-xform.mjs`
- Modify: `test/mech3d-util.mjs` (끝에 추가)

- [ ] **Step 1: 테스트 유틸 추가** (`test/mech3d-util.mjs` 끝)

```js
// 여러 닫힌 껍질을 한 부품으로(면 번호 이어 붙임)
export function mergeMeshes(list) {
  let nV = 0, nT = 0, nF = 0;
  for (const m of list) { nV += m.positions.length; nT += m.triangles.length; }
  const positions = new Float32Array(nV), triangles = new Uint32Array(nT), faceIds = new Uint32Array(nT / 3);
  let v = 0, t = 0;
  for (const m of list) {
    positions.set(m.positions, v);
    for (let k = 0; k < m.triangles.length; k++) triangles[t + k] = m.triangles[k] + v / 3;
    for (let k = 0; k < m.faceIds.length; k++) faceIds[t / 3 + k] = m.faceIds[k] + nF;
    v += m.positions.length; t += m.triangles.length; nF += m.faceCount;
  }
  return { positions, triangles, faceIds, faceCount: nF };
}
export const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
export const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
// 평면 다각형 띠(윗면만, z) — 관측면 테스트용. tris: [[x,y],[x,y],[x,y]] 목록, 모두 face 1
export function topFaceMesh(tris, z = 2) {
  const P = [], T = [], F = [];
  for (const tr of tris) { const i = P.length / 3; for (const [x, y] of tr) P.push(x, y, z); T.push(i, i + 1, i + 2); F.push(1); }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 2 };
}
export const rectTris = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1]], [[x0, y0], [x1, y1], [x0, y1]]];
export function annulusTris(cx, cy, r0, r1, n = 256) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
    const p = (r, t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    out.push([p(r0, a), p(r1, a), p(r1, b)], [p(r0, a), p(r1, b), p(r0, b)]);
  }
  return out;
}
```

- [ ] **Step 2: 실패하는 테스트 작성** (`test/mech3d-xform.mjs`)

```js
// 강체 변환·기본값: node test/mech3d-xform.mjs
import { transformMesh, eulerMatrix, applyPoint } from '../src/engine/mech3d/xform.js';
import { defaultLight, defaultObserve, migrateMech3d, SOLDER_R } from '../src/engine/mech3d/defs.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const R = eulerMatrix([0, 0, 90]);
const p = applyPoint(R, [10, 0, 0], [1, 2, 3]);
ok(Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1] - 12) < 1e-9 && Math.abs(p[2] - 3) < 1e-9, `Z 90° + 이동: ${p.map((v) => v.toFixed(6))}`);
const m = boxMesh(0, 0, 0, 2, 3, 4), t = transformMesh(m, [5, 0, 0], [30, 45, 60]);
ok(Math.abs(meshVolume(t.positions, t.triangles) - 24) < 1e-4 && t.faceIds === m.faceIds, '강체 변환: 부피·면 번호 보존');
ok(transformMesh(m, [0, 0, 0], [0, 0, 0]).positions === m.positions, '항등 변환은 원본 재사용');
const L = defaultLight(), O = defaultObserve();
ok(L.kind === 'none' && L.solder === '백색' && L.manual.count === 10 && SOLDER_R['녹색'] === 0.3, '광원 기본값');
ok(O.faces.length === 0 && O.cone === 30 && O.cell === 0.5 && O.edgeExcl === 0.5 && O.targetLen === 0.8, '관측 기본값');
const old = { name: 'x', parts: [], contacts: [] };
ok(migrateMech3d(old).light.kind === 'none' && old.observe.faces.length === 0, '마이그레이션: 빠진 필드 채움');
done();
```

- [ ] **Step 3: 실패 확인**

Run: `node test/mech3d-xform.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 4: 구현** (`src/engine/mech3d/xform.js`)

```js
// 메쉬 강체 변환 — LED STEP 위치 맞춤(spec §4.1: 이동 x,y,z · 축별 회전 각도). 회전 = Rz·Ry·Rx (deg), 이동은 회전 뒤.
export function eulerMatrix([rx, ry, rz]) {
  const [a, b, c] = [rx, ry, rz].map((d) => (d * Math.PI) / 180);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
}
export function applyPoint(R, p, t = [0, 0, 0]) {
  return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]];
}
export function applyDir(R, d) { return applyPoint(R, d); }
export function transformMesh(m, offset = [0, 0, 0], rot = [0, 0, 0]) {
  if (!offset.some(Boolean) && !rot.some(Boolean)) return m;
  const R = eulerMatrix(rot), P = new Float32Array(m.positions.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = applyPoint(R, [m.positions[i], m.positions[i + 1], m.positions[i + 2]], offset);
    P[i] = q[0]; P[i + 1] = q[1]; P[i + 2] = q[2];
  }
  return { ...m, positions: P };
}
```

- [ ] **Step 5: 구현** (`src/engine/mech3d/defs.js`)

```js
// 3D 기구 광원·관측 지정 기본값 — spec 2026-10-14 §4·§5 (P3 계획 "데이터 모델").
export const SOLDER_R = { '백색': 0.8, '녹색': 0.3, '흑색': 0.05 };
export const LED_BODY_FINISH = { kind: 'whiteDiffuse', R: 0.8 };   // 백색 실리콘 패키지

export function defaultLight() {
  return {
    kind: 'none', solder: '백색',
    spec: { model: 'lambertian', beam: 120, sizeX: 2, sizeY: 2 },
    step: null,
    manual: { pcb: { kind: 'depth', depth: 10 }, count: 10, pitch: 0, side: 'direct' },
  };
}
export function defaultObserve() {
  return { faces: [], dir: null, cone: 30, cell: 0.5, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.8 };
}
export function migrateMech3d(m) {
  if (!m) return m;
  m.light ??= defaultLight();
  m.observe ??= defaultObserve();
  return m;
}
```

- [ ] **Step 6: 통과 확인**

Run: `node test/mech3d-xform.mjs`
Expected: 6개 PASS, `all PASS`

- [ ] **Step 7: Commit**

```bash
git add src/engine/mech3d/xform.js src/engine/mech3d/defs.js test/mech3d-xform.mjs test/mech3d-util.mjs
git commit -m "feat(mech3d): rigid transform, light/observe defaults, test mesh helpers"
```

---

### Task 2: LED 인식 · 발광면 전파 (`led-detect.js`)

**Files:**
- Create: `test/mech3d-led.mjs`, `src/engine/mech3d/led-detect.js`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-led.mjs`)

```js
// LED STEP 인식: node test/mech3d-led.mjs
import { findLeds, findEmitters, pcbIndex, faceInfo } from '../src/engine/mech3d/led-detect.js';
import { transformMesh, eulerMatrix, applyPoint } from '../src/engine/mech3d/xform.js';
import { boxMesh, mergeMeshes, ok, done } from './mech3d-util.mjs';

// LED: 몸체 3×2×0.8 + 렌즈 1×1×0.3(위) — 발광면 = 렌즈 윗면(면 번호 6+1 = 7)
const led0 = mergeMeshes([boxMesh(-1.5, -1, 0, 3, 2, 0.8), boxMesh(-0.5, -0.5, 0.8, 1, 1, 0.3)]);
const poses = [[[0, 0, 0], [0, 0, 0]], [[10, 0, 0], [0, 0, 37]], [[20, 5, 0], [0, 0, 90]], [[30, 0, 1], [90, 0, 0]], [[40, 0, 0], [0, 0, 180]]];
const parts = [boxMesh(-5, -10, -1, 60, 20, 1)];   // 0: PCB
for (const [t, r] of poses) parts.push(transformMesh(led0, t, r));
parts.push(boxMesh(50, 0, 0, 3, 2, 0.8));          // 몸체만 같은 크기 상자(다른 부품)
const leds = findLeds(parts, 1);
ok(leds.join() === '1,2,3,4,5', `동일 LED 인식(회전 포함): ${leds.join()}`);
ok(pcbIndex(parts, leds) === 0, 'PCB = LED 가 아닌 최대 부피');
const em = findEmitters(parts, leds, 1, 7);
let worst = 0;
em.forEach((e, k) => {
  const [t, r] = poses[k], R = eulerMatrix(r), ax = applyPoint(R, [0, 0, 1]), pos = applyPoint(R, [0, 0, 1.1], t);
  worst = Math.max(worst, Math.hypot(...e.axis.map((v, i) => v - ax[i])), Math.hypot(...e.pos.map((v, i) => v - pos[i])));
  if (e.needsCheck) worst = Infinity;
});
ok(worst < 1e-5, `발광면 전파: 축·위치 최대 오차 ${worst.toExponential(1)} (측면 자세 포함)`);
ok(Math.abs(faceInfo(parts[1], 7).area - 1) < 1e-6, '발광면 면적 1mm²');
// 면 순서가 다른 인스턴스(면 번호 섞음) → 기술자로 재탐색
const shuffled = { ...parts[2], faceIds: Uint32Array.from(parts[2].faceIds, (f) => (f === 7 ? 3 : f === 3 ? 7 : f)) };
const em2 = findEmitters([parts[0], parts[1], shuffled], [1, 2], 1, 7);
ok(em2[1].face === 3 && !em2[1].needsCheck, `면 순서 다름 → 기술자로 발광면 찾음(면 ${em2[1].face})`);
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-led.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/led-detect.js`)

```js
// LED STEP 해석 — spec 2026-10-14 §4.1 (P3 설계 결정 1·2).
// 같은 LED = 회전 불변량(면 수 동일, 부피·표면적 ±1%, 중심 최대거리 ±0.05mm) 이 같은 솔리드.
// 발광면: 동일 인스턴스는 면 순서가 같으므로 기준 면 번호를 쓰고 기술자(면적·중심거리·법선각)로 검증, 불일치면 기술자 탐색.
import { meshVolume } from './mesh.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function triGeom(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return { area: len(n) / 2, n, c: [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3] };
}

const statsCache = new WeakMap();
export function meshStats(m) {
  if (statsCache.has(m)) return statsCache.get(m);
  const P = m.positions, T = m.triangles;
  let area = 0; const c = [0, 0, 0];
  for (let t = 0; t < T.length / 3; t++) { const g = triGeom(P, T, t); area += g.area; for (let k = 0; k < 3; k++) c[k] += g.area * g.c[k]; }
  for (let k = 0; k < 3; k++) c[k] /= area || 1;
  let rmax = 0;
  for (let i = 0; i < P.length; i += 3) rmax = Math.max(rmax, Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]));
  const s = { area, volume: meshVolume(P, T), center: c, rmax, faceCount: m.faceCount };
  statsCache.set(m, s);
  return s;
}

// 면 정보: 면적, 면적 가중 중심, 바깥 법선(면적 가중 평균), 면 안 장축 방향(정점 2×2 주성분)
export function faceInfo(m, face) {
  const P = m.positions, T = m.triangles;
  let area = 0; const c = [0, 0, 0], n = [0, 0, 0], vs = [];
  for (let t = 0; t < T.length / 3; t++) {
    if (m.faceIds[t] !== face) continue;
    const g = triGeom(P, T, t);
    area += g.area;
    for (let k = 0; k < 3; k++) { c[k] += g.area * g.c[k]; n[k] += g.n[k] / 2; }
    for (let j = 0; j < 3; j++) { const v = T[t * 3 + j] * 3; vs.push([P[v], P[v + 1], P[v + 2]]); }
  }
  if (!area) return null;
  for (let k = 0; k < 3; k++) c[k] /= area;
  const nn = unit(n), r = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(sub(r, nn.map((x) => x * dot(r, nn)))), e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
  let sxx = 0, syy = 0, sxy = 0;
  for (const v of vs) { const d = sub(v, c), x = dot(d, e1), y = dot(d, e2); sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const xAxis = unit([Math.cos(th) * e1[0] + Math.sin(th) * e2[0], Math.cos(th) * e1[1] + Math.sin(th) * e2[1], Math.cos(th) * e1[2] + Math.sin(th) * e2[2]]);
  return { area, c, n: nn, xAxis };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

export function findLeds(parts, ref) {
  const s0 = meshStats(parts[ref]);
  const out = [];
  parts.forEach((p, i) => {
    const s = meshStats(p);
    if (s.faceCount === s0.faceCount && close(s.volume, s0.volume, 0.01) && close(s.area, s0.area, 0.01) && Math.abs(s.rmax - s0.rmax) <= 0.05) out.push(i);
  });
  return out;
}

export function pcbIndex(parts, leds) {
  const set = new Set(leds); let best = -1, bv = -Infinity;
  parts.forEach((p, i) => { if (set.has(i)) return; const v = meshStats(p).volume; if (v > bv) { bv = v; best = i; } });
  return best;
}

// 기준 LED(ref)의 발광면(face) → 인식된 LED 들의 발광 위치·축·가로축
export function findEmitters(parts, leds, ref, face) {
  const sRef = meshStats(parts[ref]), fRef = faceInfo(parts[ref], face);
  if (!fRef) throw new Error('발광면 정보를 읽을 수 없음');
  const dRef = len(sub(fRef.c, sRef.center)), aRef = dot(fRef.n, unit(sub(fRef.c, sRef.center)));
  const match = (st, fi) => fi && close(fi.area, fRef.area, 0.02) && Math.abs(len(sub(fi.c, st.center)) - dRef) <= 0.05 && Math.abs(dot(fi.n, unit(sub(fi.c, st.center))) - aRef) <= 0.02;
  return leds.map((i) => {
    const st = meshStats(parts[i]);
    let f = face, fi = faceInfo(parts[i], face);
    if (!match(st, fi)) {
      f = -1; fi = null;
      for (let k = 0; k < parts[i].faceCount; k++) { const c = faceInfo(parts[i], k); if (match(st, c)) { f = k; fi = c; break; } }
    }
    return f < 0 ? { part: i, face: -1, needsCheck: true } : { part: i, face: f, pos: fi.c, axis: fi.n, xAxis: fi.xAxis, needsCheck: false };
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-led.mjs`
Expected: 5개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/led-detect.js test/mech3d-led.mjs
git commit -m "feat(mech3d): LED recognition by rotation invariants, emitter face propagation"
```

---

### Task 3: 관측면 → 라인 인식 (`line.js`, V3D-5)

**Files:**
- Create: `test/mech3d-line.mjs`, `src/engine/mech3d/line.js`

**알고리즘:**
1. 선택 면을 관측 방향 기준 평면 (u,v) 에 투영한다.
2. 래스터화한다. 셀 = max(0.05, 최대 외곽/2000) mm.
3. 경계까지 정확한 유클리드 거리 변환(EDT)을 구한다.
4. Zhang–Suen 세선화를 한다.
5. 짧은 가지(폭의 0.6배 미만)를 잘라낸다.
6. 경로를 정한다.
   - 끝점 0개: 닫힌 경로. 한 점을 빼고 최장 경로를 찾은 뒤 닫는다.
   - 끝점 ≥ 1개: 두 번 BFS 로 최장 경로를 찾는다(가지가 남으면 경고).
7. 이동평균(0.25mm)으로 계단을 지우고, 0.25mm 간격으로 재표본한다.
8. 열린 경로는 끝 접선 방향으로 영역 끝까지 연장한다.
9. 맞춤을 시도한다.
   - 직선: 최대 수직 잔차 ≤ max(0.05, 셀)
   - 원: RMS ≤ max(0.1, 셀), 닫혔거나 호 ≥ 30°
   - 맞으면 해석 형상으로 바꾼다.

**좌표:**
- s = 경로를 따라 간 거리(시작점 0).
- w = 진행 방향 왼쪽이 +.
- 높이 h = 관측 방향 성분에서 관측면 최저점을 뺀 값.

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-line.mjs`)

```js
// 라인 인식(V3D-5): node test/mech3d-line.mjs
import { recognizeLine, obsDirection, lineFromData } from '../src/engine/mech3d/line.js';
import { topFaceMesh, rectTris, annulusTris, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }];
// s 방향(어느 끝이 시작인지)·w 부호는 인식 결과에 따라 정해지므로, 첫 점으로 방향을 정해 나머지를 같은 방향으로 판정(열린 경로용)
function checkPoints(L, pts, label) {
  const sw = pts.map(([x, y]) => L.toSW(...L.to2D([x, y, 2])));
  const flipS = Math.abs(sw[0][0] - pts[0][2]) > Math.abs(L.length - sw[0][0] - pts[0][2]);
  const k = pts.findIndex((p) => p[3] !== 0), flipW = sw[k][1] * pts[k][3] < 0;
  let e = 0;
  sw.forEach(([s, w], i) => { e = Math.max(e, Math.abs((flipS ? L.length - s : s) - pts[i][2]), Math.abs((flipW ? -w : w) - pts[i][3])); });
  ok(e <= 0.2, `${label}: (s,w) 최대 오차 ${e.toFixed(3)}mm (≤0.2)`);
}

{   // 직선 띠 100×6
  const parts = [topFaceMesh(rectTris(0, 0, 100, 6))];
  const d = obsDirection(parts, faces);
  ok(Math.abs(d[2] - 1) < 1e-9, `관측 방향 = 면 법선 ${d.map((v) => v.toFixed(3))}`);
  const L = recognizeLine(parts, faces, d);
  ok(L.kind === 'line' && !L.closed && Math.abs(L.length - 100) <= 0.2 && Math.abs(L.width - 6) <= 0.2, `직선: ${L.kind}, 길이 ${L.length.toFixed(3)}, 폭 ${L.width.toFixed(3)}`);
  checkPoints(L, [[5, 3, 5, 0], [37, 4.5, 37, 1.5], [95, 1.5, 95, -1.5], [50, 3, 50, 0]], 'V3D-5 직선');
  const back = lineFromData(JSON.parse(JSON.stringify(L.data)));
  const a = L.toSW(...L.to2D([37, 4.5, 2])), b = back.toSW(...back.to2D([37, 4.5, 2]));
  ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, '직렬화 왕복(Worker 전달) 동일');
  const [x, y] = L.fromSW(37, 1.5), sw = L.toSW(x, y);
  ok(Math.abs(sw[0] - 37) < 1e-9 && Math.abs(sw[1] - 1.5) < 1e-9, 'fromSW ↔ toSW 역관계');
}
{   // 원형 링 R40, 폭 6
  const parts = [topFaceMesh(annulusTris(0, 0, 37, 43))];
  const L = recognizeLine(parts, faces, [0, 0, 1]);
  ok(L.kind === 'circle' && L.closed && Math.abs(L.length - 2 * Math.PI * 40) <= 0.2 && Math.abs(L.width - 6) <= 0.2, `원: ${L.kind}, 둘레 ${L.length.toFixed(3)} (해석 ${(2 * Math.PI * 40).toFixed(3)}), 폭 ${L.width.toFixed(3)}`);
  const s1 = L.toSW(...L.to2D([40, 0, 2]))[0], s2 = L.toSW(...L.to2D([40 * Math.cos(1), 40 * Math.sin(1), 2]))[0];
  const ds = Math.abs(((s2 - s1) % L.length + L.length) % L.length), want = 40;   // 1 rad 호 = 40mm (방향에 따라 L−40)
  ok(Math.min(Math.abs(ds - want), Math.abs(L.length - ds - want)) <= 0.2, `V3D-5 원: 1rad 호 길이 ${Math.min(ds, L.length - ds).toFixed(3)} (해석 40)`);
  const w = Math.abs(L.toSW(...L.to2D([0, 42, 2]))[1]);
  ok(Math.abs(w - 2) <= 0.2, `V3D-5 원: 폭 방향 |w| ${w.toFixed(3)} (해석 2)`);
}
{   // ㄱ자 띠: 가로 0..60×0..6 + 세로 54..60×6..46. 중심선 = 중앙축(medial axis): y=3 (x≤54) → 안쪽 모서리 (54,6) 둘레
    // 반경 3 의 1/4 원호 → x=57 (y≥6). 길이 = 54 + 1.5π + 40 = 98.712 (직각 꺾음 100 이 아님 — 폭 중심을 지키는 실제 중심선)
  const parts = [topFaceMesh([...rectTris(0, 0, 60, 6), ...rectTris(54, 6, 60, 46)])];
  const L = recognizeLine(parts, faces, [0, 0, 1]), arc = 54 + 1.5 * Math.PI;
  ok(L.kind === 'path' && !L.closed && Math.abs(L.length - (arc + 40)) <= 0.3, `ㄱ자: ${L.kind}, 길이 ${L.length.toFixed(3)} (중앙축 ${(arc + 40).toFixed(3)})`);
  checkPoints(L, [[20, 3, 20, 0], [40, 4, 40, 1], [57, 30, arc + 24, 0], [56, 40, arc + 34, 1]], 'V3D-5 ㄱ자(모서리 ±6mm 밖)');
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-line.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/line.js`)

```js
// 관측면 → 라인 인식 — spec 2026-10-14 §5 (V3D-5). 순수 JS(메인·Worker 공용). 결과는 data(직렬화 가능) + 함수.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };

export function viewFrame(d) {
  const n = unit(d), r = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit([r[0] - dot(r, n) * n[0], r[1] - dot(r, n) * n[1], r[2] - dot(r, n) * n[2]]);
  return { u, v: cross(n, u), d: n };
}

// 선택 면들의 면적 가중 평균 바깥 법선
export function obsDirection(parts, faces) {
  const n = [0, 0, 0], want = new Set(faces.map((f) => `${f.part}|${f.face}`));
  parts.forEach((m, pi) => {
    const P = m.positions, T = m.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      if (!want.has(`${pi}|${m.faceIds[t]}`)) continue;
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const c3 = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
      n[0] += c3[0]; n[1] += c3[1]; n[2] += c3[2];
    }
  });
  return unit(n);
}

function project(parts, faces, F) {
  const want = new Set(faces.map((f) => `${f.part}|${f.face}`)), tris = [];
  let hMin = Infinity;
  parts.forEach((m, pi) => {
    const P = m.positions, T = m.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      if (!want.has(`${pi}|${m.faceIds[t]}`)) continue;
      for (let j = 0; j < 3; j++) {
        const v = T[t * 3 + j] * 3, p = [P[v], P[v + 1], P[v + 2]];
        tris.push(dot(p, F.u), dot(p, F.v)); hMin = Math.min(hMin, dot(p, F.d));
      }
    }
  });
  return { tris: Float64Array.from(tris), hMin };
}

function rasterize(tris) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < tris.length; i += 2) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]); }
  const cell = Math.max(0.05, Math.max(x1 - x0, y1 - y0) / 2000);
  const bounds = [x0, y0, x1, y1];
  x0 -= 3 * cell; y0 -= 3 * cell;
  const nx = Math.ceil((x1 - x0) / cell) + 4, ny = Math.ceil((y1 - y0) / cell) + 4, mask = new Uint8Array(nx * ny);
  for (let t = 0; t < tris.length; t += 6) {
    const ax = tris[t], ay = tris[t + 1], bx = tris[t + 2], by = tris[t + 3], cx = tris[t + 4], cy = tris[t + 5];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell;
      const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) mask[j * nx + i] = 1;
    }
  }
  return { x0, y0, cell, nx, ny, mask, bounds };
}

// 경계(밖 셀)까지 정확한 유클리드 거리(셀 단위, 셀 중심 간) — Felzenszwalb–Huttenlocher 분리형 EDT
// (chamfer 근사는 방향에 따라 최대 ~8% 과대 → 원형 띠 폭이 틀어짐)
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function distanceTransform(R) {
  const { nx, ny, mask } = R, g = new Float64Array(nx * ny), M = Math.max(nx, ny);
  const f = new Float64Array(M), d = new Float64Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] ? 1e20 : 0;
  for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = g[j * nx + i]; edt1d(f, ny, d, v, z); for (let j = 0; j < ny; j++) g[j * nx + i] = d[j]; }
  for (let j = 0; j < ny; j++) { for (let i = 0; i < nx; i++) f[i] = g[j * nx + i]; edt1d(f, nx, d, v, z); for (let i = 0; i < nx; i++) g[j * nx + i] = d[i]; }
  return Float32Array.from(g, Math.sqrt);
}

function thin({ nx, ny, mask }) {
  const im = Uint8Array.from(mask), del = [];
  const N = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? im[j * nx + i] : 0);
  for (let changed = true, it = 0; changed && it < 10000; it++) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (!im[j * nx + i]) continue;
        const p = [N(i, j - 1), N(i + 1, j - 1), N(i + 1, j), N(i + 1, j + 1), N(i, j + 1), N(i - 1, j + 1), N(i - 1, j), N(i - 1, j - 1)];
        const B = p.reduce((a, b) => a + b, 0); if (B < 2 || B > 6) continue;
        let A = 0; for (let q = 0; q < 8; q++) if (!p[q] && p[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        del.push(j * nx + i);
      }
      for (const k of del) im[k] = 0;
      if (del.length) changed = true;
    }
  }
  return im;
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function neighbors(sk, nx, ny, k) {
  const i = k % nx, j = (k / nx) | 0, out = [];
  for (const [a, b] of NB) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && sk[jj * nx + ii]) out.push(jj * nx + ii); }
  return out;
}

function prune(sk, nx, ny, minLen) {
  for (let iter = 0; iter < 20; iter++) {
    let removed = false;
    for (let k = 0; k < sk.length; k++) {
      if (!sk[k] || neighbors(sk, nx, ny, k).length !== 1) continue;
      const branch = [k]; let prev = -1, cur = k, reachedJunction = false;
      while (branch.length < minLen) {
        const nb = neighbors(sk, nx, ny, cur).filter((q) => q !== prev && !branch.includes(q));
        if (nb.length !== 1) { reachedJunction = nb.length > 1; break; }
        if (neighbors(sk, nx, ny, nb[0]).length > 2) { reachedJunction = true; break; }
        prev = cur; cur = nb[0]; branch.push(cur);
      }
      if (reachedJunction && branch.length < minLen) { for (const q of branch) sk[q] = 0; removed = true; }
    }
    if (!removed) break;
  }
}

function bfsFarthest(sk, nx, ny, start, blocked = -1) {
  const prev = new Map([[start, -1]]), q = [start]; let last = start;
  for (let h = 0; h < q.length; h++) {
    const k = q[h]; last = k;
    for (const n of neighbors(sk, nx, ny, k)) if (n !== blocked && !prev.has(n)) { prev.set(n, k); q.push(n); }
  }
  const path = []; for (let k = last; k !== -1; k = prev.get(k)) path.push(k);
  return path.reverse();
}

function orderPath(sk, nx, ny) {
  const pix = []; for (let k = 0; k < sk.length; k++) if (sk[k]) pix.push(k);
  if (!pix.length) throw new Error('관측면에서 중심선을 찾지 못함(면이 너무 작거나 비어 있음)');
  const ends = pix.filter((k) => neighbors(sk, nx, ny, k).length === 1);
  if (!ends.length) {   // 닫힌 고리: 한 점을 막고 최장 경로 → 닫음
    const p0 = pix[0], nb = neighbors(sk, nx, ny, p0);
    const path = bfsFarthest(sk, nx, ny, bfsFarthest(sk, nx, ny, nb[0], p0).pop(), p0);
    return { path: [...path, p0], closed: true, branched: false };
  }
  const a = bfsFarthest(sk, nx, ny, ends[0]).pop(), path = bfsFarthest(sk, nx, ny, a);
  return { path, closed: false, branched: ends.length > 2 };
}

function smoothResample(pts, closed, win, step) {
  const n = pts.length / 2, sm = new Float64Array(pts.length), h = Math.max(1, Math.round(win));
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = -h; k <= h; k++) { let j = i + k; if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue; sx += pts[2 * j]; sy += pts[2 * j + 1]; c++; }
    sm[2 * i] = sx / c; sm[2 * i + 1] = sy / c;
  }
  if (!closed) { sm[0] = pts[0]; sm[1] = pts[1]; sm[2 * n - 2] = pts[2 * n - 2]; sm[2 * n - 1] = pts[2 * n - 1]; }
  const m = closed ? n + 1 : n, cum = [0];
  for (let i = 1; i < m; i++) { const a = (i - 1) % n, b = i % n; cum.push(cum[i - 1] + Math.hypot(sm[2 * b] - sm[2 * a], sm[2 * b + 1] - sm[2 * a + 1])); }
  const L = cum[m - 1], K = Math.max(2, Math.round(L / step)), out = [];
  for (let k = 0, i = 1; k <= (closed ? K - 1 : K); k++) {
    const s = (k * L) / K;
    while (i < m - 1 && cum[i] < s) i++;
    const a = (i - 1) % n, b = i % n, t = (s - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    out.push(sm[2 * a] + t * (sm[2 * b] - sm[2 * a]), sm[2 * a + 1] + t * (sm[2 * b + 1] - sm[2 * a + 1]));
  }
  return out;
}

// ---- 직렬화 가능한 data → 함수 객체 ----
export function lineFromData(data) {
  const { kind, closed, frame: F, raster: R, width } = data;
  const inside = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
  const boundaryDist = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); if (i < 0 || j < 0 || i >= R.nx || j >= R.ny) return 0; return Math.max(0, (R.dt[j * R.nx + i] - 0.5) * R.cell); };
  let length, toSW, fromSW, tangentAt;
  if (kind === 'line') {
    const [ax, ay] = data.a, [tx, ty] = data.t; length = data.length;
    toSW = (x, y) => [(x - ax) * tx + (y - ay) * ty, tx * (y - ay) - ty * (x - ax)];
    fromSW = (s, w) => [ax + s * tx - w * ty, ay + s * ty + w * tx];
    tangentAt = () => [tx, ty];
  } else if (kind === 'circle') {
    const [cx, cy] = data.c, Rr = data.r, th0 = data.th0, dir = data.dir; length = closed ? 2 * Math.PI * Rr : data.length;
    toSW = (x, y) => {
      const th = Math.atan2(y - cy, x - cx); let d = dir * (th - th0); d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (!closed && d > length / Rr + (2 * Math.PI - length / Rr) / 2) d -= 2 * Math.PI;
      return [d * Rr, dir * (Rr - Math.hypot(x - cx, y - cy))];   // 진행 방향 왼쪽(+) — 반시계 진행이면 안쪽이 왼쪽
    };
    fromSW = (s, w) => { const th = th0 + (dir * s) / Rr, r = Rr - dir * w; return [cx + r * Math.cos(th), cy + r * Math.sin(th)]; };
    tangentAt = (s) => { const th = th0 + (dir * s) / Rr; return [-dir * Math.sin(th), dir * Math.cos(th)]; };
  } else {
    const P = data.pts, n = P.length / 2, segs = closed ? n : n - 1, cum = new Float64Array(segs + 1);
    for (let i = 0; i < segs; i++) { const b = (i + 1) % n; cum[i + 1] = cum[i] + Math.hypot(P[2 * b] - P[2 * i], P[2 * b + 1] - P[2 * i + 1]); }
    length = cum[segs];
    const B = Math.max(1, width), buckets = new Map(), key = (i, j) => i * 1048576 + j;
    for (let i = 0; i < segs; i++) {
      const b = (i + 1) % n;
      const i0 = Math.floor(Math.min(P[2 * i], P[2 * b]) / B), i1 = Math.floor(Math.max(P[2 * i], P[2 * b]) / B);
      const j0 = Math.floor(Math.min(P[2 * i + 1], P[2 * b + 1]) / B), j1 = Math.floor(Math.max(P[2 * i + 1], P[2 * b + 1]) / B);
      for (let a = i0; a <= i1; a++) for (let c = j0; c <= j1; c++) { const k = key(a, c); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
    }
    const seg = (i) => { const b = (i + 1) % n; return [P[2 * i], P[2 * i + 1], P[2 * b], P[2 * b + 1]]; };
    toSW = (x, y) => {
      const bi = Math.floor(x / B), bj = Math.floor(y / B);
      let best = Infinity, bs = 0, bw = 0;
      for (let r = 0; r < 64; r++) {
        for (let a = bi - r; a <= bi + r; a++) for (let c = bj - r; c <= bj + r; c++) {
          if (Math.max(Math.abs(a - bi), Math.abs(c - bj)) !== r) continue;
          for (const i of buckets.get(key(a, c)) ?? []) {
            const [x1, y1, x2, y2] = seg(i), dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1e-12;
            const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)), fx = x1 + t * dx, fy = y1 + t * dy, dd = Math.hypot(x - fx, y - fy);
            if (dd < best) { best = dd; bs = cum[i] + t * Math.sqrt(l2); bw = Math.sign(dx * (y - fy) - dy * (x - fx)) * dd; }
          }
        }
        if (best <= (r - 1) * B) break;
      }
      return [bs, bw];
    };
    const at = (s) => {
      s = closed ? ((s % length) + length) % length : Math.max(0, Math.min(length, s));
      let lo = 0, hi = segs; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const [x1, y1, x2, y2] = seg(lo), l = Math.hypot(x2 - x1, y2 - y1) || 1e-12, t = (s - cum[lo]) / l;
      return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), tx: (x2 - x1) / l, ty: (y2 - y1) / l };
    };
    fromSW = (s, w) => { const a = at(s); return [a.x - w * a.ty, a.y + w * a.tx]; };
    tangentAt = (s) => { const a = at(s); return [a.tx, a.ty]; };
  }
  const to2D = (p) => [dot(p, F.u), dot(p, F.v)];
  const to3D = (x, y, h) => { const hh = data.hMin + h; return [x * F.u[0] + y * F.v[0] + hh * F.d[0], x * F.u[1] + y * F.v[1] + hh * F.d[1], x * F.u[2] + y * F.v[2] + hh * F.d[2]]; };
  return { kind, closed, length, width, branched: data.branched, frame: F, data, inside, boundaryDist, toSW, fromSW, tangentAt, to2D, to3D };
}

export function recognizeLine(parts, faces, dir) {
  const F = viewFrame(dir), { tris, hMin } = project(parts, faces, F);
  if (!tris.length) throw new Error('관측면이 선택되지 않음');
  const R = rasterize(tris), dt = distanceTransform(R);
  const sk = thin(R);
  const widths = []; for (let k = 0; k < sk.length; k++) if (sk[k]) widths.push(2 * (dt[k] - 0.5) * R.cell);
  widths.sort((a, b) => a - b);
  const width = widths[widths.length >> 1] ?? 0;
  prune(sk, R.nx, R.ny, Math.max(3, Math.round((0.6 * width) / R.cell)));
  const { path, closed, branched } = orderPath(sk, R.nx, R.ny);
  const raw = []; for (const k of path) raw.push(R.x0 + ((k % R.nx) + 0.5) * R.cell, R.y0 + (((k / R.nx) | 0) + 0.5) * R.cell);
  let pts = smoothResample(raw, closed, 0.25 / R.cell, 0.25);
  const insideR = (x, y) => { const i = Math.floor((x - R.x0) / R.cell), j = Math.floor((y - R.y0) / R.cell); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
  if (!closed) {   // 끝 접선 방향으로 영역 끝까지 연장
    const extend = (ix, jx, back) => {
      const n = pts.length / 2, k0 = back ? n - 1 : 0, k1 = back ? Math.max(0, n - 1 - Math.round(2 / 0.25)) : Math.min(n - 1, Math.round(2 / 0.25));
      let tx = pts[2 * k0] - pts[2 * k1], ty = pts[2 * k0 + 1] - pts[2 * k1 + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      let x = pts[2 * k0], y = pts[2 * k0 + 1]; const add = [];
      for (let q = 0; q < 1e5; q++) { const nx2 = x + tx * R.cell / 2, ny2 = y + ty * R.cell / 2; if (!insideR(nx2, ny2)) break; x = nx2; y = ny2; }
      // 래스터 셀 중심 기준 → 실제 경계는 반 셀 더 바깥
      x += tx * R.cell / 2; y += ty * R.cell / 2;
      add.push(x, y);
      return add;
    };
    const e = extend(0, 0, true), s = extend(0, 0, false);
    pts = [...s, ...pts, ...e];
  }
  const P = Float64Array.from(pts), n = P.length / 2;
  const data = { kind: 'path', closed, branched, frame: F, hMin, width, raster: { x0: R.x0, y0: R.y0, cell: R.cell, nx: R.nx, ny: R.ny, mask: R.mask, dt, bounds: R.bounds }, pts: P };
  // 직선 맞춤(열린 경로)
  if (!closed) {
    let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += P[2 * i]; my += P[2 * i + 1]; } mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const x = P[2 * i] - mx, y = P[2 * i + 1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), tx = Math.cos(th), ty = Math.sin(th);
    let dev = 0; for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(-ty * (P[2 * i] - mx) + tx * (P[2 * i + 1] - my)));
    if (dev <= Math.max(0.05, R.cell)) {
      const sgn = (P[2 * n - 2] - P[0]) * tx + (P[2 * n - 1] - P[1]) * ty >= 0 ? 1 : -1, t2 = [sgn * tx, sgn * ty];
      const s0 = (P[0] - mx) * t2[0] + (P[1] - my) * t2[1], s1 = (P[2 * n - 2] - mx) * t2[0] + (P[2 * n - 1] - my) * t2[1];
      return lineFromData({ ...data, kind: 'line', a: [mx + s0 * t2[0], my + s0 * t2[1]], t: t2, length: s1 - s0 });
    }
  }
  // 원 맞춤(Kasa)
  {
    let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0, Sz = 0;
    for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1], z = x * x + y * y; Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y; Sxz += x * z; Syz += y * z; Sz += z; }
    const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]], b = [Sxz, Syz, Sz];
    const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det3(A);
    if (Math.abs(D) > 1e-12) {
      const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? b[i] : v)));
      const a1 = det3(col(0)) / D, a2 = det3(col(1)) / D, a3 = det3(col(2)) / D;
      const cx = a1 / 2, cy = a2 / 2, r = Math.sqrt(a3 + cx * cx + cy * cy);
      let rms = 0; for (let i = 0; i < n; i++) rms += (Math.hypot(P[2 * i] - cx, P[2 * i + 1] - cy) - r) ** 2;
      rms = Math.sqrt(rms / n);
      const th0 = Math.atan2(P[1] - cy, P[0] - cx), thA = Math.atan2(P[3] - cy, P[2] - cx);
      const dir = Math.sin(thA - th0) >= 0 ? 1 : -1;
      let arc = 0; for (let i = 1; i < n; i++) { let d = Math.atan2(P[2 * i + 1] - cy, P[2 * i] - cx) - Math.atan2(P[2 * i - 1] - cy, P[2 * i - 2] - cx); d = Math.atan2(Math.sin(d), Math.cos(d)); arc += dir * d; }
      if (Number.isFinite(r) && rms <= Math.max(0.1, R.cell) && (closed || arc >= Math.PI / 6)) {
        return lineFromData({ ...data, kind: 'circle', c: [cx, cy], r, th0, dir, length: closed ? 2 * Math.PI * r : arc * r });
      }
    }
  }
  return lineFromData(data);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-line.mjs`
Expected: 11개 PASS, `all PASS`

V3D-5 가 0.2mm 를 넘으면 허용치를 바꾸지 않는다. 먼저 원인을 찾는다(superpowers:systematic-debugging). ㄱ자 모서리는 세선화가 중앙축 원호를 얼마나 잘 따르는지가 핵심이다. 모서리 뒤 점들의 오차가 같은 값만큼 밀려 있으면 모서리 원호 근사 문제다. 순서는 다음과 같다.
1. 끝점 연장(반 셀)
2. 평활 창
3. 가지치기 길이

`checkPoints` 의 방향 판정에 버그가 있으면 테스트를 고치고 이유를 보고한다.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/line.js test/mech3d-line.mjs
git commit -m "feat(mech3d): observation-face line recognition (skeleton, line/circle fit, s-w coords) — V3D-5"
```

---

### Task 4: 직접 배치 · PCB 평면 (`placement.js`)

**Files:**
- Create: `test/mech3d-place.mjs`, `src/engine/mech3d/placement.js`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-place.mjs`)

```js
// LED 직접 배치: node test/mech3d-place.mjs
import { manualLeds, pcbPlaneMesh } from '../src/engine/mech3d/placement.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { buildBvh } from '../src/engine/mech3d/bvh.js';
import { topFaceMesh, rectTris, annulusTris, boxMesh, ok, done } from './mech3d-util.mjs';

const faces = [{ part: 0, face: 1 }];
const strip = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 12)], faces, [0, 0, 1]);
{
  const L = manualLeds(strip, { count: 5, pitch: 20, side: 'direct', pcb: { kind: 'depth', depth: 10 } });
  const xs = L.map((e) => e.pos[0]).sort((a, b) => a - b);
  ok(L.length === 5 && xs.map((x) => x.toFixed(3)).join() === '10.000,30.000,50.000,70.000,90.000' && L.every((e) => Math.abs(e.pos[1] - 3) < 1e-9 && Math.abs(e.pos[2] - 2) < 1e-9 && e.axis[2] === 1),
    `직선 5개 피치 20, 깊이 10 → z 2: x ${xs.map((x) => x.toFixed(1)).join(',')}`);
  const auto = manualLeds(strip, { count: 4, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } }).map((e) => e.pos[0]).sort((a, b) => a - b);
  ok(auto.map((x) => x.toFixed(3)).join() === '12.500,37.500,62.500,87.500', `피치 0 → 균등(길이/개수): ${auto.join()}`);
  const side = manualLeds(strip, { count: 1, pitch: 0, side: 'left', pcb: { kind: 'depth', depth: 10 } })[0];
  ok(Math.abs(Math.abs(side.axis[1]) - 1) < 1e-9 && Math.abs(side.axis[2]) < 1e-9, `측면 발광 축 ⟂ 라인·관측방향: ${side.axis.map((v) => v.toFixed(3))}`);
  let threw = false; try { manualLeds(strip, { count: 6, pitch: 30, side: 'direct', pcb: { kind: 'depth', depth: 10 } }); } catch { threw = true; }
  ok(threw, '배치 길이(5×30) > 라인 길이 → 오류');
  const pm = pcbPlaneMesh(strip, 10);
  ok(Math.abs(meshVolume(pm.positions, pm.triangles) - 120 * 26 * 1) < 1e-3 && Math.abs(Math.max(...pm.positions.filter((_, i) => i % 3 === 2)) - 2) < 1e-6, 'PCB 평면: 라인 외곽 +10mm, 두께 1, 윗면 = LED 높이');
}
{
  const ring = recognizeLine([topFaceMesh(annulusTris(0, 0, 37, 43), 12)], faces, [0, 0, 1]);
  const L = manualLeds(ring, { count: 12, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 10 } });
  const r = L.map((e) => Math.hypot(e.pos[0], e.pos[1])), gaps = L.map((e, i) => { const f = L[(i + 1) % 12]; return Math.hypot(f.pos[0] - e.pos[0], f.pos[1] - e.pos[1]); });
  ok(r.every((v) => Math.abs(v - 40) < 0.05) && Math.max(...gaps) - Math.min(...gaps) < 1e-6, `원 12개 균등: 반경 ${r[0].toFixed(3)}, 간격 ${gaps[0].toFixed(3)}`);
}
{   // PCB = 기구 부품 면(클릭): z=3 윗면 상자에 LED 를 내림
  const board = boxMesh(-10, -10, 0, 120, 30, 3), bvh = buildBvh(board.positions, board.triangles);
  const L = manualLeds(strip, { count: 3, pitch: 30, side: 'direct', pcb: { kind: 'face', part: 0, face: 1 } }, { parts: [{ ...board, bvh }] });
  ok(L.every((e) => Math.abs(e.pos[2] - 3) < 1e-6), `PCB 면 위 배치: z ${L.map((e) => e.pos[2].toFixed(3)).join()}`);
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-place.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/placement.js`)

```js
// LED 직접 배치 — spec 2026-10-14 §4.2. 관측 라인(line.js) 위 s 위치를 PCB(깊이 평면 또는 기구 부품 면)로 내린다.
// pcb: { kind:'depth', depth }(관측면 최저점에서 관측 방향 반대로 depth mm) | { kind:'face', part, face }(rt.parts[part] BVH 로 투영)
// side: 'direct'(관측 방향) | 'left' | 'right'(라인 진행 방향 기준 측면 발광) — xAxis 는 라인 접선(패키지 가로축).
import { intersectRay } from './bvh.js';

export function ledSPositions(line, count, pitch) {
  if (!(count >= 1)) throw new Error('LED 개수는 1 이상');
  const L = line.length;
  if (line.closed) return Array.from({ length: count }, (_, i) => (i * L) / count);
  if (pitch > 0) {
    if ((count - 1) * pitch > L + 1e-9) throw new Error(`배치 길이 ${((count - 1) * pitch).toFixed(1)}mm 가 라인 길이 ${L.toFixed(1)}mm 보다 김`);
    return Array.from({ length: count }, (_, i) => L / 2 + (i - (count - 1) / 2) * pitch);
  }
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * L) / count);
}

export function manualLeds(line, { count, pitch = 0, side = 'direct', pcb }, rt = null) {
  const F = line.frame, out = [];
  for (const s of ledSPositions(line, count, pitch)) {
    const [x, y] = line.fromSW(s, 0), [tx, ty] = line.tangentAt(s);
    let pos;
    if (pcb.kind === 'depth') pos = line.to3D(x, y, -pcb.depth);
    else {
      const top = line.to3D(x, y, 1e4), m = rt?.parts?.[pcb.part];
      if (!m) throw new Error('PCB 면 부품을 찾을 수 없음');
      const h = intersectRay(m.bvh, top[0], top[1], top[2], -F.d[0], -F.d[1], -F.d[2], 0, Infinity);
      if (!h || m.faceIds[h.tri] !== pcb.face) throw new Error(`s=${s.toFixed(1)}mm 아래에 선택한 PCB 면이 없음`);
      pos = [top[0] - h.t * F.d[0], top[1] - h.t * F.d[1], top[2] - h.t * F.d[2]];
    }
    const T3 = [tx * F.u[0] + ty * F.v[0], tx * F.u[1] + ty * F.v[1], tx * F.u[2] + ty * F.v[2]];
    const left = [F.d[1] * T3[2] - F.d[2] * T3[1], F.d[2] * T3[0] - F.d[0] * T3[2], F.d[0] * T3[1] - F.d[1] * T3[0]];
    const axis = side === 'left' ? left : side === 'right' ? left.map((v) => -v) : F.d.slice();
    out.push({ s, pos, axis, xAxis: T3 });
  }
  return out;
}

// 가상 PCB(깊이 지정): 관측 라인 외곽 + margin, 두께 1mm, 윗면 = LED 높이(관측면 최저점 − depth)
export function pcbPlaneMesh(line, depth, margin = 10) {
  const [bx0, by0, bx1, by1] = line.data.raster.bounds;   // 관측면 투영의 정확한 외곽
  const x0 = bx0 - margin, y0 = by0 - margin, x1 = bx1 + margin, y1 = by1 + margin;
  const c = (x, y, h) => line.to3D(x, y, h), top = -depth, bot = -depth - 1;
  const V = [c(x0, y0, bot), c(x1, y0, bot), c(x1, y1, bot), c(x0, y1, bot), c(x0, y0, top), c(x1, y0, top), c(x1, y1, top), c(x0, y1, top)];
  const Q = [[0, 3, 2, 1, 0], [4, 5, 6, 7, 1], [0, 1, 5, 4, 2], [3, 7, 6, 2, 3], [0, 4, 7, 3, 4], [1, 2, 6, 5, 5]];   // 바깥 반시계(관측 프레임 오른손계)
  const P = [], T = [], Fd = [];
  for (const [a, b, cc, d, f] of Q) { const i = P.length / 3; for (const k of [a, b, cc, d]) P.push(...V[k]); T.push(i, i + 1, i + 2, i, i + 2, i + 3); Fd.push(f, f); }
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(Fd), faceCount: 6 };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-place.mjs`
Expected: 7개 PASS, `all PASS`

`pcbPlaneMesh` 는 래스터가 보관한 투영 외곽(`raster.bounds`, 정확값)에 margin 을 더한다.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/placement.js test/mech3d-place.mjs
git commit -m "feat(mech3d): manual LED placement along the observation line, virtual PCB plane"
```

---

### Task 5: 관측 집계 · 판정 (`tally.js`)

**Files:**
- Create: `test/mech3d-tally.mjs`, `src/engine/mech3d/tally.js`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-tally.mjs`)

```js
// 관측 집계: node test/mech3d-tally.mjs
import { tallyGeometry, makeAccumulator, tallyStats } from '../src/engine/mech3d/tally.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { rng } from '../src/engine/l2/mc-slab.js';
import { topFaceMesh, rectTris, ok, done } from './mech3d-util.mjs';

const line = recognizeLine([topFaceMesh(rectTris(0, 0, 100, 6), 2)], [{ part: 0, face: 1 }], [0, 0, 1]);
const obs = { faces: [{ part: 0, face: 1 }], dir: [0, 0, 1], cone: 10, cell: 0.5, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.5 };
const G = tallyGeometry(line, obs);
ok(G.ns === 200 && G.valid.reduce((a, b) => a + b, 0) === (200 - 2) * 10, `격자: s ${G.ns}칸, 유효 셀 ${G.valid.reduce((a, b) => a + b, 0)} (가장자리 0.5mm 제외 → 198×10)`);
// 합성 출사: 밝기 ∝ (20 + x) — 길이 방향 선형 경사, 폭 방향 균일
const r = rng(1), B = 10, accs = [];
for (let b = 0; b < B; b++) {
  const a = makeAccumulator(G, line, obs);
  for (let k = 0; k < 200000; k++) {
    const x = r() * 100, y = r() * 6, w = (20 + x) / 120;
    a.onExit(0, 1, x, y, 2, 0, 0, 1, w); a.onEscape(x, y, 2.5, 0, 0, 1, w);
    a.onExit(0, 1, x, y, 2, 0.5, 0, Math.sqrt(0.75), w); a.onEscape(x, y, 3, 0.5, 0, Math.sqrt(0.75), w);   // 30° → 원뿔(10°) 밖
    a.onExit(0, 0, x, y, 0, 0, 0, -1, w); a.onEscape(x, y, -1, 0, 0, 1, w);                                 // 관측면 아닌 면
    a.onEscape(x, y, 5, 0, 0, 1, w);                                                                        // 관측면 출사 기록 없음
  }
  accs.push(a.acc);
}
const S = tallyStats(G, accs, obs), want = (20 + 0.75) / (20 + 99.25);
ok(Math.abs(S.Ulen - want) < 0.01, `길이 방향 U ${S.Ulen.toFixed(4)} (해석 ${want.toFixed(4)}), σ ${S.seLen.toFixed(4)}`);
ok(S.Uwid > 0.7 && S.Uwid <= 1, `폭 방향 최저 U ${S.Uwid.toFixed(3)} @ s=${S.sWorst.toFixed(1)}mm (균일 + 셀 잡음)`);
const rr = S.profile[150] / S.profile[50], r2 = Math.max(rr, 1 / rr), want2 = (20 + 75.25) / (20 + 25.25);   // 라인 진행 방향과 무관하게 비교
ok(!S.passLen && S.profile.length === 200 && Math.abs(r2 / want2 - 1) < 0.03, `판정·프로파일(길이 ${S.passLen ? '합격' : '불합격'}, 75/25mm 비 ${r2.toFixed(3)} / 해석 ${want2.toFixed(3)})`);
ok(S.counted === 198 * 10 && S.noiseWarn === false, `집계 셀 ${S.counted}, 잡음 경고 없음(목표와의 여유가 3σ 보다 큼)`);
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-tally.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/tally.js`)

```js
// 관측 집계·판정 — spec 2026-10-14 §5 (P3 설계 결정 5·6).
// 광자가 관측면을 나간 지점을 기억했다가(onExit), 그 광자가 관측 방향 ±cone 으로 탈출(onEscape)하면 그 지점의 (s,w) 셀에 더한다.
// runMC3D 는 광자를 하나씩 끝까지 추적하므로, onEscape 직전의 마지막 onExit 가 그 광자의 마지막 출사다.

export function tallyGeometry(line, obs) {
  const cell = obs.cell ?? 0.5, edge = obs.edgeExcl ?? 0.5, L = line.length;
  const ns = Math.max(1, Math.round(L / cell)), ds = L / ns;
  const wMax = line.width / 2 + 2 * cell, nw = Math.ceil((2 * wMax) / cell), w0 = -nw * cell / 2;
  const valid = new Uint8Array(ns * nw);
  for (let i = 0; i < ns; i++) for (let j = 0; j < nw; j++) {
    const s = (i + 0.5) * ds, w = w0 + (j + 0.5) * cell, [x, y] = line.fromSW(s, w);
    if (!line.inside(x, y) || line.boundaryDist(x, y) < edge - 1e-9) continue;
    if (!line.closed && (s < edge || s > L - edge)) continue;
    valid[i * nw + j] = 1;
  }
  return { ns, nw, ds, cell, w0, valid, L, closed: line.closed };
}

export function makeAccumulator(G, line, obs) {
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), d = obs.dir, cosC = Math.cos(((obs.cone ?? 10) * Math.PI) / 180);
  const acc = new Float64Array(G.ns * G.nw);
  let lx = 0, ly = 0, lz = 0, has = false;
  return {
    acc,
    onExit(part, face, x, y, z) { has = faces.has(`${part}|${face}`); lx = x; ly = y; lz = z; },
    onEscape(x, y, z, dx, dy, dz, w) {
      if (!has) return;
      has = false;
      if (dx * d[0] + dy * d[1] + dz * d[2] < cosC) return;
      const [px, py] = line.to2D([lx, ly, lz]), [s, ww] = line.toSW(px, py);
      let i = Math.floor(s / G.ds);
      if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return;
      const j = Math.floor((ww - G.w0) / G.cell);
      if (j < 0 || j >= G.nw) return;
      acc[i * G.nw + j] += w;
    },
  };
}

// accs: 배치별 누적(같은 광자 수). 값 = 셀 출사/면적(상대 휘도). 판정은 평균 지도, σ 는 배치 간 분산.
export function tallyStats(G, accs, obs) {
  const B = accs.length, A = G.ds * G.cell, nCell = G.ns * G.nw;
  const mean = new Float64Array(nCell);
  for (const a of accs) for (let k = 0; k < nCell; k++) mean[k] += a[k] / A / B;
  const profileOf = (m) => {
    const p = new Float64Array(G.ns), wr = new Float64Array(G.ns).fill(NaN);
    for (let i = 0; i < G.ns; i++) {
      let s = 0, c = 0, mn = Infinity, mx = -Infinity;
      for (let j = 0; j < G.nw; j++) if (G.valid[i * G.nw + j]) { const v = m[i * G.nw + j]; s += v; c++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      p[i] = c ? s / c : NaN; if (c) wr[i] = mx > 0 ? mn / mx : 0;
    }
    return { p, wr };
  };
  const minmax = (arr) => { let mn = Infinity, mx = -Infinity; for (const v of arr) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } return mx > 0 ? mn / mx : 0; };
  const { p, wr } = profileOf(mean);
  const Ulen = minmax(p);
  let Uwid = Infinity, iW = 0; for (let i = 0; i < G.ns; i++) if (Number.isFinite(wr[i]) && wr[i] < Uwid) { Uwid = wr[i]; iW = i; }
  // 배치별 U 의 표준오차(잡음 지표)
  const per = accs.map((a) => { const m = Float64Array.from(a, (v) => v / A); const q = profileOf(m); let uw = Infinity; for (const v of q.wr) if (Number.isFinite(v)) uw = Math.min(uw, v); return [minmax(q.p), uw]; });
  const se = (k, mu) => Math.sqrt(per.reduce((s, x) => s + (x[k] - mu) ** 2, 0) / Math.max(1, B - 1) / B);
  const mL = per.reduce((s, x) => s + x[0], 0) / B, mW = per.reduce((s, x) => s + x[1], 0) / B;
  const seLen = se(0, mL), seWid = se(1, mW);
  let counted = 0; for (let k = 0; k < nCell; k++) if (G.valid[k] && mean[k] > 0) counted++;
  const marginL = Math.abs(Ulen - obs.targetLen), marginW = Math.abs(Uwid - obs.targetWid);
  return {
    profile: p, map: mean, Ulen, seLen, Uwid: Number.isFinite(Uwid) ? Uwid : 0, seWid, sWorst: (iW + 0.5) * G.ds,
    passLen: Ulen >= obs.targetLen, passWid: Uwid >= obs.targetWid, counted,
    noiseWarn: seLen * 3 > Math.max(0.01, marginL) || seWid * 3 > Math.max(0.01, marginW),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-tally.mjs`
Expected: 5개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/tally.js test/mech3d-tally.mjs
git commit -m "feat(mech3d): observation tally on (s,w) grid with length/width uniformity and batch SE"
```

---

### Task 6: 장면 합성 · 실행 (`job.js`, `runtime.js`) + 샘플 LED STEP

**Files:**
- Modify: `src/engine/mech3d/runtime.js`
- Create: `src/engine/mech3d/job.js`, `test/mech3d-job.mjs`, `test/fixtures/mech3d-led-sample.mjs`, `test/fixtures/mech3d-led-sample.stp`

- [ ] **Step 1: runtime.js 확장.** `setMech3dMesh` 를 순수 생성기 `buildSceneMesh` + 전역 설정으로 나눈다. 그리고 LED STEP 메쉬 보관과 초기 spec 필드를 추가한다. 파일의 `setMech3dMesh` 함수를 다음으로 바꾸고, 그 아래에 LED 보관 함수들을 추가한다. `initialMech3dSpec` 반환 객체에 `light: defaultLight(), observe: defaultObserve()` 를 추가한다(`import { defaultLight, defaultObserve } from './defs.js';`).

```js
// 전역을 바꾸지 않는 장면 메쉬 생성(계산 작업용) — 부품별 BVH + 결합 메쉬 + 결합 BVH
export function buildSceneMesh(name, rawParts) {
  const parts = rawParts.map((p) => (p.bvh ? p : { ...p, bvh: buildBvh(p.positions, p.triangles) }));
  const combined = combineParts(parts);
  return { name, parts, combined, bvh: buildBvh(combined.positions, combined.triangles) };
}
export function setMech3dMesh(name, rawParts) {
  scene = buildSceneMesh(name, rawParts);
  return scene;
}

// ---- LED STEP(PCB + LED) 메쉬 — 원본(변환 전) 보관, 위치 맞춤은 spec.mech3d.light.step.offset/rot ----
let ledScene = null;   // { name, parts: [{ positions, triangles, faceIds, faceCount, volume }] }
export function setLedMesh(name, parts) { ledScene = { name, parts }; return ledScene; }
export function getLedMesh() { return ledScene; }
export function clearLedMesh() { ledScene = null; }
export async function saveLedIDB() {
  if (typeof indexedDB === 'undefined' || !ledScene) return;
  const d = await idb();
  await new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(ledScene, 'mech3d-led'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function loadLedIDB() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get('mech3d-led'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return v ? setLedMesh(v.name, v.parts) : null;
  } catch { return null; }
}
```

- [ ] **Step 2: 샘플 LED STEP 생성기** (`test/fixtures/mech3d-led-sample.mjs`)

```js
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
```

`fuseAll(oc, shapes)` 의 실제 시그니처와 반환형(단일 솔리드인지)을 `src/export/oc-build.js:61` 에서 확인한다. 몸체+렌즈가 한 솔리드가 되지 않으면, 같은 모듈의 불리언 합집합 방식으로 맞추고 보고한다.

- [ ] **Step 3: 실패하는 테스트 작성** (`test/mech3d-job.mjs`)

```js
// 장면 합성·실행(샘플 기구 + 샘플 LED STEP, 관측면 = Milky 커버 윗면): node test/mech3d-job.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapesToStepText } from '../src/export/oc-build.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { setMech3dMesh, getMech3d, initialMech3dSpec } from '../src/engine/mech3d/runtime.js';
import { setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { findLeds, findEmitters, pcbIndex } from '../src/engine/mech3d/led-detect.js';
import { composeScene, runJob } from '../src/engine/mech3d/job.js';
import { recognizeLine, obsDirection } from '../src/engine/mech3d/line.js';
import { tallyGeometry, tallyStats } from '../src/engine/mech3d/tally.js';
import { buildSampleShapes } from './fixtures/mech3d-sample.mjs';
import { buildLedShapes } from './fixtures/mech3d-led-sample.mjs';
import { loadTable } from './l2-util.mjs';
import { ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade(), table = loadTable();
const mech = readStepParts(oc, shapesToStepText(oc, buildSampleShapes(oc)));
const ledParts = readStepParts(oc, shapesToStepText(oc, buildLedShapes(oc)));
setMech3dMesh('sample', mech);
const ms = initialMech3dSpec();
ms.parts[1] = setPartMaterialParam(setPartMaterial(ms.parts[1], 'milky'), 'milky', 3);   // 커버
ms.parts[2] = setPartMaterial(ms.parts[2], 'clear');                                      // 도광 바
// LED 인식: LED STEP 부품 중 PCB(최대 부피) 외 첫 LED 의 렌즈 윗면을 발광면으로
const ref = 1, refFace = (() => { let best = -1, z = -Infinity; const m = ledParts[ref]; for (let t = 0; t < m.triangles.length / 3; t++) { const zc = (m.positions[m.triangles[t * 3] * 3 + 2] + m.positions[m.triangles[t * 3 + 1] * 3 + 2] + m.positions[m.triangles[t * 3 + 2] * 3 + 2]) / 3; if (zc > z) { z = zc; best = m.faceIds[t]; } } return best; })();
const leds = findLeds(ledParts, ref), pcb = pcbIndex(ledParts, leds), em = findEmitters(ledParts, leds, ref, refFace);
ok(leds.length === 10 && pcb === 0 && em.every((e) => !e.needsCheck && Math.abs(e.axis[2] - 1) < 1e-6 && Math.abs(e.pos[2] - 3.5) < 1e-6), `샘플 LED STEP: LED ${leds.length}개, PCB 부품 ${pcb}, 발광 z ${em[0].pos[2].toFixed(3)}`);
ms.light = { ...ms.light, kind: 'step', step: { name: 'led', offset: [0, 0, 0], rot: [0, 0, 0], ref: { part: ref, face: refFace }, leds, pcb, emitters: em } };
// 관측면 = 커버(부품 1) 윗면: 법선 +z 이고 z 최대인 면
const coverTop = (() => { const m = mech[1]; let best = -1, z = -Infinity; for (let t = 0; t < m.triangles.length / 3; t++) { const zc = m.positions[m.triangles[t * 3] * 3 + 2]; if (zc > z) { z = zc; best = m.faceIds[t]; } } return best; })();
ms.observe = { ...ms.observe, faces: [{ part: 1, face: coverTop }] };
const dir = obsDirection(mech, ms.observe.faces), line = recognizeLine(mech, ms.observe.faces, dir);
ok(line.kind === 'line' && Math.abs(line.length - 116) <= 0.2 && Math.abs(line.width - 16) <= 0.2, `관측 라인: ${line.kind} ${line.length.toFixed(2)}×${line.width.toFixed(2)}`);
const S = composeScene({ rt: getMech3d(), mspec: ms, ledParts, table, db: null, line });
ok(S.optics.length === mech.length + ledParts.length && !S.optics[mech.length].transmissive, `장면 합성: 부품 ${S.optics.length}개(기구 ${mech.length} + LED STEP ${ledParts.length})`);
// 이 테스트는 판정 수치가 아니라 배선(장면·광원·집계)을 본다 — 잡음을 줄이려고 원뿔 60°
const obs = { ...ms.observe, dir, cone: 60 }, G = tallyGeometry(line, obs);
const t0 = Date.now(), r = runJob({ S, line, obs, G, emitters: em, ledSpec: ms.light.spec, N: 60000, seed: 1, batches: 10 });
const st = tallyStats(G, r.accs, obs);
ok(r.ledger.lost === 0 && st.counted > 1000 && st.Ulen > 0 && st.Ulen < 1 && st.Uwid > 0, `계산: ${((Date.now() - t0) / 1000).toFixed(1)}s, 길이 U ${st.Ulen.toFixed(3)}±${st.seLen.toFixed(3)}, 폭 최저 U ${st.Uwid.toFixed(3)} @ ${st.sWorst.toFixed(1)}mm, lost ${r.ledger.lost}`);
// 대칭 점검: 기구·LED 가 x=60 대칭 → 길이 프로파일 좌·우 절반 합이 같아야 함(잡음 ~1%)
const p = st.profile, n = p.length; let lh = 0, rh = 0;
for (let i = 0; i < n; i++) if (Number.isFinite(p[i])) { if (i < n / 2) lh += p[i]; else rh += p[i]; }
ok(Math.abs(lh / rh - 1) < 0.03, `좌우 대칭: 왼쪽/오른쪽 절반 합 비 ${(lh / rh).toFixed(4)}`);
done();
```

- [ ] **Step 4: 실패 확인**

Run: `node test/fixtures/mech3d-led-sample.mjs && node test/mech3d-job.mjs`
Expected: 첫 명령 `wrote …stp`, 둘째 `ERR_MODULE_NOT_FOUND` (job.js)

- [ ] **Step 5: 구현** (`src/engine/mech3d/job.js`)

```js
// 3D 계산 작업 — spec 2026-10-14 §6. 메인·Worker 공용(순수). 장면 = 기구 부품 + 광원 부품(LED STEP 의 PCB·LED 몸체, 또는 가상 PCB).
import { buildSceneMesh } from './runtime.js';
import { buildTraceScene } from './scene3d.js';
import { transformMesh } from './xform.js';
import { pcbPlaneMesh } from './placement.js';
import { defaultPart, setPartFinish } from './materials.js';
import { SOLDER_R, LED_BODY_FINISH } from './defs.js';
import { runMC3D } from './mc3d.js';
import { ledSource, combineSources } from './sources.js';
import { makeAccumulator } from './tally.js';

// rt: 기구 장면(getMech3d()), mspec: spec.mech3d, ledParts: LED STEP 원본 메쉬(없으면 null), line: 인식된 관측 라인(가상 PCB 용)
export function composeScene({ rt, mspec, ledParts, table, db, line }) {
  const L = mspec.light, extraMeshes = [], extraSpecs = [], solderFin = { kind: 'whiteDiffuse', R: SOLDER_R[L.solder] ?? 0.8 };
  const base = rt.parts.length;
  if (L.kind === 'step' && ledParts) {
    const st = L.step, ledSet = new Set(st.leds);
    ledParts.forEach((m, i) => {
      extraMeshes.push(transformMesh(m, st.offset, st.rot));
      extraSpecs.push(setPartFinish(defaultPart(base + i, i === st.pcb ? 'PCB' : `LED ${i}`, 0), null, i === st.pcb ? solderFin : ledSet.has(i) ? LED_BODY_FINISH : { kind: 'whiteDiffuse', R: 0.5 }));
    });
  } else if (L.kind === 'manual' && L.manual.pcb.kind === 'depth') {
    extraMeshes.push(pcbPlaneMesh(line, L.manual.pcb.depth));
    extraSpecs.push(setPartFinish(defaultPart(base, 'PCB', 0), null, solderFin));
  }
  const rt2 = extraMeshes.length ? buildSceneMesh('job', [...rt.parts, ...extraMeshes]) : rt;
  return buildTraceScene(rt2, { ...mspec, parts: [...mspec.parts, ...extraSpecs] }, { table, db });
}

// emitters: [{ pos, axis, xAxis }] (LED STEP 은 변환 적용 후 좌표), ledSpec: light.spec
export function runJob({ S, line, obs, G, emitters, ledSpec, N, seed, batches = 10 }) {
  if (!emitters.length) throw new Error('광원이 없음 — LED 를 지정하세요');
  const src = combineSources(emitters.map((e) => ledSource({ x: e.pos[0], y: e.pos[1], z: e.pos[2], axis: e.axis, xAxis: e.xAxis, model: ledSpec.model, beam: ledSpec.beam, sizeX: ledSpec.sizeX, sizeY: ledSpec.sizeY })));
  const accs = [], ledger = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  let ms = 0;
  const per = Math.ceil(N / batches);
  for (let b = 0; b < batches; b++) {
    const a = makeAccumulator(G, line, obs);
    const r = runMC3D(S, { source: src, N: per, seed: seed * 7919 + b, onExit: a.onExit, onEscape: a.onEscape });
    accs.push(a.acc); ms += r.ms;
    for (const k in ledger) ledger[k] += r.ledger[k];
  }
  return { accs, ledger, ms };
}
```

LED STEP 의 `emitters` 는 `findEmitters` 결과를 변환된 메쉬로 계산한 것이어야 한다. 이 테스트는 offset/rot 이 0 이라 원본과 같다. UI(Task 8)에서는 변환된 LED 메쉬로 `findEmitters` 를 다시 돌린다.

- [ ] **Step 6: 통과 확인**

Run: `node test/mech3d-job.mjs`
Expected: 5개 PASS, `all PASS`, 계산 시간 출력. 60000 광자에 60초를 넘으면 N 을 30000 으로 낮추고 보고한다.

- [ ] **Step 7: 회귀**

Run: `npm run test:mech3d`
Expected: exit 0. `runtime.js` 변경으로 import 테스트가 깨지지 않아야 한다.

- [ ] **Step 8: Commit**

```bash
git add src/engine/mech3d/runtime.js src/engine/mech3d/job.js test/mech3d-job.mjs test/fixtures/mech3d-led-sample.mjs test/fixtures/mech3d-led-sample.stp
git commit -m "feat(mech3d): scene composition with LED STEP/virtual PCB, batched observation run; LED sample fixture"
```

---

### Task 7: 계산·라인 Worker (`mc3d-worker.js`)

**Files:**
- Create: `src/engine/mech3d/mc3d-worker.js`

- [ ] **Step 1: 구현**

```js
// 3D 계산 Worker — 입력:
//   { type:'init', l2Base, db } → L2 표·소재 DB 로드
//   { type:'line', id, parts, faces, dir } → { id, lineData }
//   { type:'run', id, mechParts, mspec, ledParts, lineData, obs, emitters, N, seed, batches } → { id, accs, ledger, ms } | { id, error }
import { initL2, l2State, browserLoader, setMaterialDb } from '../l2/runtime.js';
import { createDb } from '../../model/materials-db.js';
import { buildSceneMesh } from './runtime.js';
import { recognizeLine, lineFromData } from './line.js';
import { composeScene, runJob } from './job.js';
import { tallyGeometry } from './tally.js';

let ready = null, db = null;
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') { ready = initL2(browserLoader(m.l2Base)); db = createDb(m.db?.base ?? [], m.db?.user ?? []); setMaterialDb(db); await ready; return; }
    if (m.type === 'line') {
      const L = recognizeLine(m.parts, m.faces, m.dir);
      self.postMessage({ id: m.id, lineData: L.data });
      return;
    }
    if (m.type === 'run') {
      await ready;
      const table = l2State().table;
      if (!table) throw new Error('L2 산란 응답표가 없음');
      const rt = buildSceneMesh('mech', m.mechParts), line = lineFromData(m.lineData);
      const S = composeScene({ rt, mspec: m.mspec, ledParts: m.ledParts, table, db, line });
      const G = tallyGeometry(line, m.obs);
      const r = runJob({ S, line, obs: m.obs, G, emitters: m.emitters, ledSpec: m.mspec.light.spec, N: m.N, seed: m.seed, batches: m.batches });
      self.postMessage({ id: m.id, accs: r.accs, ledger: r.ledger, ms: r.ms }, r.accs.map((a) => a.buffer));
    }
  } catch (e) { self.postMessage({ id: m.id, error: String(e?.message ?? e) }); }
};
```

`initL2`·`browserLoader`·`setMaterialDb`·`l2State` 의 실제 export 이름과 `browserLoader(base)` 시그니처를 `src/engine/l2/runtime.js` 에서 확인한다. 기존 `src/engine/solve-worker.js` 의 init 처리와 같은 방식으로 맞추고, 다르면 그쪽 패턴을 따른 뒤 보고한다.

- [ ] **Step 2: 문법 확인**

Run: `node --check src/engine/mech3d/mc3d-worker.js`
Expected: 출력 없음

- [ ] **Step 3: Commit**

```bash
git add src/engine/mech3d/mc3d-worker.js
git commit -m "feat(mech3d): worker for line recognition and batched 3D MC runs"
```

---

### Task 8: UI — 3D 뷰 확장 · 광원/관측/계산 패널 · main 연결

**Files:**
- Modify: `src/ui/mech3d-view.js`
- Create: `src/ui/mech3d-light-panel.js`
- Modify: `src/main.js`, `index.html`, `styles.css`

- [ ] **Step 1: 3D 뷰 확장** (`src/ui/mech3d-view.js`)
  - `KIND_COLOR`·`KIND_OPACITY` 에 `pcb: 0x2f6b3a`(불투명 1)와 `led: 0xffcf3f`(불투명 1)를 추가한다.
  - `colorize` 에서 관측면은 시안 `0x29d3e0` 으로 칠한다. 관측면 집합은 `obsSet.has(\`${i}|${face}\`)` 로 판정하고, 선택 면보다 우선순위가 낮다.
  - `createMech3dView` 안에 아래 오버레이 함수를 추가하고, return 객체에 `setOverlay` 를 추가한다.
  - `setKinds` 는 바뀐 부품만 재착색하도록 이전 kinds 와 비교한다.

```js
  let obsSet = new Set(), overlay = null;
  // over = { obsFaces:[{part,face}], line3d: Float32Array(x,y,z...) | null, arrows:[{pos,axis}] }
  function setOverlay(over) {
    obsSet = new Set((over.obsFaces ?? []).map((f) => `${f.part}|${f.face}`));
    if (overlay) { scene.remove(overlay); overlay.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    overlay = new THREE.Group();
    if (over.line3d?.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(over.line3d, 3));
      overlay.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x29d3e0, depthTest: false })));
    }
    for (const a of over.arrows ?? []) overlay.add(new THREE.ArrowHelper(new THREE.Vector3(...a.axis), new THREE.Vector3(...a.pos), 4, 0xffcf3f, 1.2, 0.8));
    overlay.renderOrder = 2;
    scene.add(overlay);
    meshes.forEach((_, i) => colorize(i)); render();
  }
```

`colorize` 의 색 결정 줄은 다음 순서로 바꾼다.

```js
      const sel = sel0?.part === i && sel0.face === p.faceIds[t];
      const c = sel ? FACE_COLOR : obsSet.has(`${i}|${p.faceIds[t]}`) ? OBS_COLOR : partCol;
```

이때 `sel0 = sel`(기존 선택 변수), `const OBS_COLOR = new THREE.Color(0x29d3e0)` 이다. 기존 `colorize` 에서 선택 변수명이 `sel` 이면 위의 지역 변수명 `sel` 과 겹치지 않게 `isSel` 로 바꾼다.

- [ ] **Step 2: 광원·관측·계산 패널** (`src/ui/mech3d-light-panel.js`)

```js
// 3D 기구 — 광원 · 관측면 · 계산 패널 (spec 2026-10-14 §4·§5). 상태 없음: m = spec.mech3d, ui = { pick, lineInfo, ledInfo, calc }, h = 처리기.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');

// ui.dir = 현재 관측 방향(자동이면 인식 라인의 법선). h = { onLightKind(k), onLedFile(file), onPick(mode|null), onStep(key,val), onManual(key,val), onSolder(v), onLedSpec(key,val), onObs(key,val), onObsDir(v|null), onClearObs(), onCalc(N) }
export function renderLightPanel(el, m, ui, h) {
  const L = m.light, O = m.observe, st = L.step, man = L.manual;
  const pickBtn = (mode, label) => `<button data-lp-pick="${mode}" class="${ui.pick === mode ? 'on' : ''}">${label}</button>`;
  const stepHtml = L.kind !== 'step' ? '' : `
    <div class="m3-row"><label class="shape-btn">LED STEP 불러오기<input type="file" accept=".stp,.step" hidden data-lp-file></label>
      ${st ? `<span class="mut">${esc(st.name)}</span>` : ''}</div>
    ${st ? `<div class="m3-row">${pickBtn('led', 'LED 발광면 클릭')} ${pickBtn('ledx', 'LED 제외/포함 클릭')} ${ui.ledInfo ? esc(ui.ledInfo) : '<span class="mut">LED 하나의 발광면(빛이 나오는 면)을 클릭하세요</span>'}${st.excluded?.length ? ` <span class="mut">· 제외 ${st.excluded.length}개</span>` : ''}</div>
    <div class="m3-row">위치 보정 x<input type="number" step="0.1" value="${st.offset[0]}" data-lp-step="ox"> y<input type="number" step="0.1" value="${st.offset[1]}" data-lp-step="oy"> z<input type="number" step="0.1" value="${st.offset[2]}" data-lp-step="oz"></div>
    <div class="m3-row">회전 X<input type="number" step="90" value="${st.rot[0]}" data-lp-step="rx"> Y<input type="number" step="90" value="${st.rot[1]}" data-lp-step="ry"> Z<input type="number" step="90" value="${st.rot[2]}" data-lp-step="rz">°</div>` : ''}`;
  const manHtml = L.kind !== 'manual' ? '' : `
    <div class="m3-row">PCB <select data-lp-man="pcbKind"><option value="depth" ${man.pcb.kind === 'depth' ? 'selected' : ''}>관측면 아래 깊이</option><option value="face" ${man.pcb.kind === 'face' ? 'selected' : ''}>기구 면 클릭</option></select>
      ${man.pcb.kind === 'depth' ? `<input type="number" min="0.5" step="0.5" value="${man.pcb.depth}" data-lp-man="depth">mm` : `${pickBtn('pcb', 'PCB 면 클릭')} ${man.pcb.part != null ? `<span class="mut">부품 ${man.pcb.part + 1} 면 #${man.pcb.face}</span>` : ''}`}</div>
    <div class="m3-row">개수<input type="number" min="1" step="1" value="${man.count}" data-lp-man="count"> 피치<input type="number" min="0" step="0.5" value="${man.pitch}" data-lp-man="pitch">mm <span class="mut">(0 = 균등)</span></div>
    <div class="m3-row">발광 <select data-lp-man="side"><option value="direct" ${man.side === 'direct' ? 'selected' : ''}>직하(관측 방향)</option><option value="left" ${man.side === 'left' ? 'selected' : ''}>측면 왼쪽</option><option value="right" ${man.side === 'right' ? 'selected' : ''}>측면 오른쪽</option></select></div>`;
  const res = ui.calc;
  el.innerHTML = `
    <div class="m3-sub">광원</div>
    <div class="m3-row"><select data-lp-kind><option value="none" ${L.kind === 'none' ? 'selected' : ''}>지정 안 함</option><option value="step" ${L.kind === 'step' ? 'selected' : ''}>LED STEP 불러오기</option><option value="manual" ${L.kind === 'manual' ? 'selected' : ''}>관측 라인 따라 직접 배치</option></select></div>
    ${stepHtml}${manHtml}
    ${L.kind === 'none' ? '' : `<div class="m3-row">배광 <select data-lp-spec="model"><option value="lambertian" ${L.spec.model === 'lambertian' ? 'selected' : ''}>램버시안</option><option value="gaussian" ${L.spec.model === 'gaussian' ? 'selected' : ''}>가우시안</option></select>
      지향각<input type="number" min="10" max="170" step="5" value="${L.spec.beam}" data-lp-spec="beam">° 발광면<input type="number" min="0" step="0.1" value="${L.spec.sizeX}" data-lp-spec="sizeX">×<input type="number" min="0" step="0.1" value="${L.spec.sizeY}" data-lp-spec="sizeY">mm
      PCB 색 <select data-lp-solder>${['백색', '녹색', '흑색'].map((c) => `<option ${c === L.solder ? 'selected' : ''}>${c}</option>`).join('')}</select></div>`}
    <div class="m3-sub">관측면</div>
    <div class="m3-row">${pickBtn('obs', '관측면 클릭(추가/제거)')} <span class="mut">면 ${O.faces.length}개</span> ${O.faces.length ? '<button data-lp-clear>비우기</button>' : ''}</div>
    ${ui.lineInfo ? `<div class="m3-row">${esc(ui.lineInfo)}</div>` : ''}
    ${O.faces.length ? `<div class="m3-row">관측 방향 ${O.dir ? '' : '<span class="mut">(자동: 면 평균 법선)</span>'} x<input type="number" step="0.1" value="${num(ui.dir?.[0], 3)}" data-lp-dir="0"> y<input type="number" step="0.1" value="${num(ui.dir?.[1], 3)}" data-lp-dir="1"> z<input type="number" step="0.1" value="${num(ui.dir?.[2], 3)}" data-lp-dir="2"> ${O.dir ? '<button data-lp-dirauto>자동</button>' : ''}</div>` : ''}
    <div class="m3-row">목표 균일도 길이<input type="number" min="0" max="1" step="0.05" value="${O.targetLen}" data-lp-obs="targetLen"> 폭<input type="number" min="0" max="1" step="0.05" value="${O.targetWid}" data-lp-obs="targetWid"> 가장자리 제외<input type="number" min="0" step="0.1" value="${O.edgeExcl}" data-lp-obs="edgeExcl">mm 관측 원뿔 ±<input type="number" min="2" max="90" step="1" value="${O.cone}" data-lp-obs="cone">°</div>
    <div class="m3-sub">계산</div>
    <div class="m3-row"><button data-lp-calc="200000">빠른 계산(20만)</button> <button data-lp-calc="1000000">정밀 계산(100만)</button></div>
    ${res ? `<div class="m3-res ${res.error ? 'err' : ''}">${res.error ? esc(res.error) : res.busy ? esc(res.busy) : `
      길이 방향 U <b>${num(res.Ulen, 3)}</b> ±${num(res.seLen, 3)} ${res.passLen ? '✓' : '✗'} ·
      폭 방향 최저 U <b>${num(res.Uwid, 3)}</b> ±${num(res.seWid, 3)} @ s=${num(res.sWorst)}mm ${res.passWid ? '✓' : '✗'}
      ${res.noiseWarn ? '<div class="warn">⚠ 잡음이 판정 여유보다 큼 — 정밀 계산 권장</div>' : ''}
      <div class="mut">${num(res.sec)}s · 광자 ${res.N.toLocaleString()} · 탈출 ${num(res.escape * 100, 1)}%</div>`}</div>` : ''}`;
  const on = (sel, ev, fn) => el.querySelectorAll(sel).forEach((x) => x.addEventListener(ev, () => fn(x)));
  on('[data-lp-kind]', 'change', (x) => h.onLightKind(x.value));
  on('[data-lp-file]', 'change', (x) => { const f = x.files?.[0]; if (f) h.onLedFile(f); x.value = ''; });
  on('[data-lp-pick]', 'click', (x) => h.onPick(ui.pick === x.dataset.lpPick ? null : x.dataset.lpPick));
  on('[data-lp-step]', 'change', (x) => { const v = +x.value; if (Number.isFinite(v)) h.onStep(x.dataset.lpStep, v); });
  on('[data-lp-man]', 'change', (x) => h.onManual(x.dataset.lpMan, x.dataset.lpMan === 'pcbKind' || x.dataset.lpMan === 'side' ? x.value : +x.value));
  on('[data-lp-spec]', 'change', (x) => h.onLedSpec(x.dataset.lpSpec, x.dataset.lpSpec === 'model' ? x.value : +x.value));
  on('[data-lp-solder]', 'change', (x) => h.onSolder(x.value));
  on('[data-lp-obs]', 'change', (x) => { const v = +x.value; if (Number.isFinite(v)) h.onObs(x.dataset.lpObs, v); });
  on('[data-lp-clear]', 'click', () => h.onClearObs());
  on('[data-lp-dir]', 'change', () => { const v = [0, 1, 2].map((k) => +el.querySelector(`[data-lp-dir="${k}"]`).value); if (v.every(Number.isFinite) && Math.hypot(...v) > 1e-6) h.onObsDir(v); });
  on('[data-lp-dirauto]', 'click', () => h.onObsDir(null));
  on('[data-lp-calc]', 'click', (x) => h.onCalc(+x.dataset.lpCalc));
}
```

- [ ] **Step 3: index.html.** `#mech3d-panel` div 바로 아래에 `<div id="mech3d-light"></div>` 를 추가한다.

- [ ] **Step 4: styles.css 끝에 추가**

```css
.m3-row button.on { background: #29d3e0; color: #062a2e; }
.m3-res { margin-top: 6px; padding: 6px; border-radius: 4px; background: rgba(41, 211, 224, 0.08); font-size: 12px; }
.m3-res.err { background: rgba(255, 90, 54, 0.12); }
#mech3d-light input[type=number] { width: 56px; }
```

- [ ] **Step 5: main.js 연결.** 다음을 추가·변경한다(기존 코드 형식을 따른다).

  **(a) import 추가**

```js
import { setLedMesh, getLedMesh, saveLedIDB, loadLedIDB } from './engine/mech3d/runtime.js';
import { migrateMech3d } from './engine/mech3d/defs.js';
import { findLeds, findEmitters, pcbIndex } from './engine/mech3d/led-detect.js';
import { transformMesh } from './engine/mech3d/xform.js';
import { lineFromData, obsDirection } from './engine/mech3d/line.js';
import { manualLeds } from './engine/mech3d/placement.js';
import { tallyGeometry, tallyStats } from './engine/mech3d/tally.js';
import { renderLightPanel } from './ui/mech3d-light-panel.js';
```

  **(b) 상태와 공용 함수.** `let m3sel = ...` 줄 아래에 추가한다.

```js
let m3pick = null, m3line = null, m3lineKey = '', m3calc = null, m3ledInfo = '', m3worker = null, m3reqId = 0;
const m3pending = new Map();
function m3w() {
  if (!m3worker) {
    m3worker = new Worker(new URL('./engine/mech3d/mc3d-worker.js', import.meta.url), { type: 'module' });
    m3worker.onmessage = (e) => { const p = m3pending.get(e.data.id); if (p) { m3pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data); } };
    m3worker.postMessage({ type: 'init', l2Base: new URL('./engine/l2/data/', import.meta.url).href, db: dbLists() });
  }
  return m3worker;
}
const m3call = (w, msg) => new Promise((res, rej) => { const id = ++m3reqId; m3pending.set(id, { res, rej }); w.postMessage({ ...msg, id }); });
const ledPartsNow = () => { const st = spec.mech3d.light.step, raw = getLedMesh()?.parts; return raw && st ? raw.map((m) => transformMesh(m, st.offset, st.rot)) : null; };
// 관측 라인: 관측면·방향이 바뀌면 Worker 에서 다시 인식
async function refreshLine() {
  const O = spec.mech3d.observe, key = JSON.stringify([O.faces, O.dir]);
  if (key === m3lineKey) return;
  m3lineKey = key; m3line = null;
  if (!O.faces.length) { renderMech3d(); return; }
  const parts = getMech3d().parts.map(({ positions, triangles, faceIds, faceCount }) => ({ positions, triangles, faceIds, faceCount }));
  const dir = O.dir ?? obsDirection(parts, O.faces);
  try { const r = await m3call(m3w(), { type: 'line', parts, faces: O.faces, dir }); if (key === m3lineKey) { m3line = lineFromData(r.lineData); renderMech3d(); } }
  catch (e) { m3line = null; $('#mech3d-status').textContent = `라인 인식 실패: ${e.message}`; renderMech3d(); }
}
function currentEmitters() {
  const L = spec.mech3d.light;
  if (L.kind === 'step') { const ex = new Set(L.step?.excluded ?? []); return (L.step?.emitters ?? []).filter((e) => !e.needsCheck && !ex.has(e.part)); }
  if (L.kind === 'manual' && m3line) return manualLeds(m3line, L.manual, getMech3d());
  return [];
}
```

  **(c) renderMech3d 확장.** 함수 첫 부분(`const kinds = …` 부터 `m3view.setSelection(m3sel);` 까지)을 다음으로 바꾼다.

```js
  await getView();
  const cur = getMech3d(), M = spec.mech3d, st = M.light.kind === 'step' ? M.light.step : null;
  const lp = st ? ledPartsNow() : null, ledSet = new Set(st?.leds ?? []);
  const exSet = new Set(st?.excluded ?? []);   // 제외된 LED 는 회색(불투명)으로 — 발광 화살표도 빠짐
  const kinds = [...M.parts.map((p) => p.material.kind), ...(lp ?? []).map((_, i) => (i === st.pcb ? 'pcb' : ledSet.has(i) && !exSet.has(i) ? 'led' : 'opaque'))];
  const meshKey = [cur, lp ? getLedMesh() : null, JSON.stringify(st ? [st.offset, st.rot] : null)];   // 기구·LED 메쉬·위치 보정이 바뀌면 다시 그림
  if (!m3meshShown || m3meshShown.some((v, i) => v !== meshKey[i])) { m3meshShown = meshKey; m3view.setParts([...cur.parts, ...(lp ?? [])], kinds); }
  else m3view.setKinds(kinds);
  m3view.setSelection(m3sel);
```

  그리고 기존 패널 호출 뒤에 아래를 덧붙인다. 아래 목록은 이 단계의 의도를 설명한 것이다.
  - 기존 `m3view.setParts(cur.parts, kinds)` 를 LED STEP 부품까지 포함하도록 바꾼다. `kinds` 뒤에 LED STEP 부품 종류(`'pcb'` 또는 `'led'`)를 붙이고, `parts` 는 `[...cur.parts, ...(ledPartsNow() ?? [])]` 로 한다.
  - 메쉬가 바뀌었는지 비교하는 `m3meshShown` 은 `cur` 와 LED 메쉬, offset/rot 키를 합친 문자열로 비교한다.
  - 그 뒤에 오버레이와 패널을 그린다.

```js
  const arrows = (() => { try { return currentEmitters().map((e) => ({ pos: e.pos, axis: e.axis })); } catch { return []; } })();
  const line3d = m3line ? Float32Array.from((() => { const out = [], K = 200; for (let k = 0; k <= K; k++) { const s = (k / K) * m3line.length, [x, y] = m3line.fromSW(m3line.closed && k === K ? 0 : s, 0); out.push(...m3line.to3D(x, y, 0.3)); } return out; })()) : null;
  m3view.setOverlay({ obsFaces: spec.mech3d.observe.faces, line3d, arrows });
  const li = m3line ? `라인: ${{ line: '직선', circle: '원', path: '곡선' }[m3line.kind]}${m3line.closed ? '(닫힘)' : ''} · 길이 ${m3line.length.toFixed(1)}mm · 폭 ${m3line.width.toFixed(1)}mm${m3line.branched ? ' · ⚠ 갈래 있음(가장 긴 경로 사용)' : ''}` : (spec.mech3d.observe.faces.length ? '라인 인식 중…' : '');
  renderLightPanel($('#mech3d-light'), spec.mech3d, { pick: m3pick, lineInfo: li, ledInfo: m3ledInfo, calc: m3calc, dir: spec.mech3d.observe.dir ?? m3line?.frame.d }, m3LightHandlers());
```

  **(d) 클릭 처리.** `getView` 의 `onPick` 을 `onPick: (s) => onM3Pick(s)` 로 바꾸고, 다음 함수를 추가한다. 기구 부품 수 `nMech = getMech3d().parts.length` 이상인 번호는 LED STEP 부품이다.

```js
function onM3Pick(s) {
  const nMech = getMech3d().parts.length, M = spec.mech3d;
  if (m3pick === 'obs' && s && s.part < nMech) {
    const k = M.observe.faces.findIndex((f) => f.part === s.part && f.face === s.face);
    if (k >= 0) M.observe.faces.splice(k, 1); else M.observe.faces.push({ part: s.part, face: s.face });
    persist(); refreshLine(); renderMech3d(); return;
  }
  if (m3pick === 'led' && s && s.part >= nMech) {
    const parts = ledPartsNow(), ref = s.part - nMech, leds = findLeds(parts, ref);
    const em = findEmitters(parts, leds, ref, s.face), bad = em.filter((e) => e.needsCheck).length;
    M.light.step = { ...M.light.step, ref: { part: ref, face: s.face }, leds, pcb: pcbIndex(parts, leds), emitters: em };
    m3ledInfo = `LED ${leds.length}개 인식${bad ? ` · ⚠ ${bad}개 발광면 확인 필요(제외됨)` : ''} · PCB = LED STEP 부품 ${M.light.step.pcb + 1}`;
    m3pick = null; persist(); renderMech3d(); return;
  }
  if (m3pick === 'ledx' && s && s.part >= nMech && M.light.step) {
    const st = M.light.step, i = s.part - nMech; st.excluded ??= [];
    const k = st.excluded.indexOf(i); if (k >= 0) st.excluded.splice(k, 1); else if (st.leds.includes(i)) st.excluded.push(i);
    persist(); renderMech3d(); return;
  }
  if (m3pick === 'pcb' && s && s.part < nMech) {
    M.light.manual.pcb = { kind: 'face', part: s.part, face: s.face };
    m3pick = null; persist(); renderMech3d(); return;
  }
  m3sel = s && s.part < nMech ? s : null;   // LED STEP 부품은 소재 편집 대상이 아님
  renderMech3d();
}
```

  **(e) 패널 처리기**

```js
function m3LightHandlers() {
  const M = spec.mech3d, L = M.light, upd = () => { m3calc = null; persist(); renderMech3d(); };
  const reEmit = () => { const st = L.step; if (st?.ref) { const parts = ledPartsNow(); st.leds = findLeds(parts, st.ref.part); st.emitters = findEmitters(parts, st.leds, st.ref.part, st.ref.face); st.pcb = pcbIndex(parts, st.leds); } };
  return {
    onLightKind: (k) => { L.kind = k; upd(); if (k === 'manual') refreshLine(); },
    onLedFile: (f) => importLedStep(f),
    onPick: (mode) => { m3pick = mode; renderMech3d(); },
    onStep: (key, v) => { const st = L.step; if (key[0] === 'o') st.offset['xyz'.indexOf(key[1])] = v; else st.rot['xyz'.indexOf(key[1])] = v; reEmit(); upd(); },
    onManual: (key, v) => { if (key === 'pcbKind') L.manual.pcb = v === 'depth' ? { kind: 'depth', depth: 10 } : { kind: 'face' }; else if (key === 'depth') L.manual.pcb.depth = v; else L.manual[key] = v; upd(); },
    onSolder: (v) => { L.solder = v; upd(); },
    onLedSpec: (key, v) => { L.spec[key] = v; upd(); },
    onObs: (key, v) => { M.observe[key] = v; upd(); },
    onClearObs: () => { M.observe.faces = []; m3line = null; m3lineKey = ''; upd(); },
    onObsDir: (v) => { M.observe.dir = v ? (() => { const l = Math.hypot(...v); return v.map((x) => x / l); })() : null; upd(); refreshLine(); },
    onCalc: (N) => runM3Calc(N),
  };
}
function importLedStep(file) {
  m3ledInfo = `${file.name} 읽는 중…`; renderMech3d();
  file.text().then((text) => {
    const w = new Worker(new URL('./engine/mech3d/mech3d-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (m) => {
      if (m.data.stage) { m3ledInfo = m.data.stage; renderMech3d(); return; }
      w.terminate();
      if (m.data.error) { m3ledInfo = `불러오기 실패: ${m.data.error}`; renderMech3d(); return; }
      setLedMesh(file.name, m.data.parts); saveLedIDB().catch(() => {});
      spec.mech3d.light.step = { name: file.name, offset: [0, 0, 0], rot: [0, 0, 0], ref: null, leds: [], excluded: [], pcb: -1, emitters: [] };
      m3ledInfo = `부품 ${m.data.parts.length}개 — LED 하나의 발광면을 클릭하세요`; m3pick = 'led';
      persist(); renderMech3d();
    };
    w.postMessage({ text });
  }).catch((e) => { m3ledInfo = `불러오기 실패: ${e.message}`; renderMech3d(); });
}
async function runM3Calc(N) {
  const M = spec.mech3d;
  try {
    if (!m3line) throw new Error('관측면을 먼저 지정하세요');
    const emitters = currentEmitters();
    if (!emitters.length) throw new Error('광원을 지정하세요');
    const K = Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 4) - 1)), t0 = performance.now();
    m3calc = { busy: `계산 중… (Worker ${K}개, 광자 ${N.toLocaleString()})` }; renderMech3d();
    const obs = { ...M.observe, dir: M.observe.dir ?? m3line.frame.d };
    const mechParts = getMech3d().parts.map(({ positions, triangles, faceIds, faceCount, volume }) => ({ positions, triangles, faceIds, faceCount, volume }));
    const ledParts = M.light.kind === 'step' ? getLedMesh()?.parts ?? null : null;
    const workers = Array.from({ length: K }, (_, k) => (k === 0 ? m3w() : (() => { const w = new Worker(new URL('./engine/mech3d/mc3d-worker.js', import.meta.url), { type: 'module' }); w.onmessage = m3worker.onmessage; w.postMessage({ type: 'init', l2Base: new URL('./engine/l2/data/', import.meta.url).href, db: dbLists() }); return w; })()));
    const res = await Promise.all(workers.map((w, k) => m3call(w, { type: 'run', mechParts, mspec: M, ledParts, lineData: m3line.data, obs, emitters, N: Math.ceil(N / K), seed: 1000 + k, batches: Math.max(2, Math.round(10 / K)) })));
    workers.slice(1).forEach((w) => w.terminate());
    const G = tallyGeometry(m3line, obs), accs = res.flatMap((r) => r.accs), st = tallyStats(G, accs, obs);
    const led = res.reduce((a, r) => { for (const k in r.ledger) a[k] = (a[k] ?? 0) + r.ledger[k]; return a; }, {});
    m3calc = { ...st, N, sec: (performance.now() - t0) / 1000, escape: led.escaped / led.emitted };
  } catch (e) { m3calc = { error: `계산 실패: ${e.message}` }; }
  renderMech3d();
}
```

  `runJob` 의 배치 수가 Worker 마다 `max(2, 10/K)` 이므로, 전체 배치는 K×그 값(≥ 10)이다. `ledParts` 는 원본을 보내고, 변환은 `composeScene` 에서 offset/rot 로 한다. `emitters` 는 메인에서 변환된 메쉬로 계산한 것이다.

  **(f) 모드와 저장 정리**
  - `applyMode` 에서 `$('#inputbar').hidden = m3;` 을 추가한다. 평판 입력바는 3D 모드에서 숨긴다.
  - `migrate` 의 `s.mech3d ??= null;` 다음 줄에 `if (s.mech3d) migrateMech3d(s.mech3d);` 를 추가한다.
  - 시작 시 3D 기구 복원 뒤에 `if (spec.mech3d?.light?.kind === 'step') await loadLedIDB();` 를 추가하고, 그 뒤에 `refreshLine()` 을 호출한다. `refreshLine` 은 `applyMode()` 이후에 한 번 부른다.
  - `importMech3d` 성공 시 새 기구는 `initialMech3dSpec()` 이 light/observe 기본값을 포함하므로 추가 작업이 없다. 다만 `m3line = null; m3lineKey = ''; m3calc = null;` 은 초기화한다.

- [ ] **Step 6: 정적 확인**

Run: `node --check src/main.js && node --check src/ui/mech3d-light-panel.js && node --check src/ui/mech3d-view.js && npm test && npm run test:mech3d`
Expected: 모두 exit 0

- [ ] **Step 7: Commit**

```bash
git add src/ui/mech3d-view.js src/ui/mech3d-light-panel.js src/main.js index.html styles.css
git commit -m "feat(mech3d): light/observation/calculation UI — LED STEP recognition, manual placement, face picking, line overlay, worker-pool run"
```

---

### Task 9: 테스트 스크립트 · 브라우저 검증 · 로그

**Files:**
- Modify: `package.json`

- [ ] **Step 1: package.json.** `test:mech3d` 끝에 ` && node test/mech3d-xform.mjs && node test/mech3d-led.mjs && node test/mech3d-line.mjs && node test/mech3d-place.mjs && node test/mech3d-tally.mjs` 를 덧붙인다. `test:mech3d-mc` 끝에는 ` && node test/mech3d-job.mjs` 를 덧붙인다. job 테스트는 계산을 포함해 느리다.

Run: `npm run test:mech3d && npm run test:mech3d-mc`
Expected: exit 0

- [ ] **Step 2: 브라우저 검증** (uds-alt 5180, 컨트롤러가 수행)
  1. 3D 기구 모드에서 `test/fixtures/mech3d-sample.stp` 를 불러온다.
  2. 커버를 Milky 3, 도광 바를 투명으로 지정한다.
  3. 광원 "LED STEP 불러오기" 로 `test/fixtures/mech3d-led-sample.stp` 를 불러오고, LED 렌즈 윗면을 클릭한다. "LED 10개 인식"과 노란 화살표 10개가 나와야 한다.
  4. "관측면 클릭" 으로 커버 윗면을 클릭한다. 시안 강조, 라인 "직선 · 길이 116 · 폭 16", 중심선 오버레이가 나와야 한다.
  5. "빠른 계산" 을 누른다. 길이/폭 U 와 판정이 표시되고 콘솔 오류가 없어야 한다.
  6. "LED 제외/포함 클릭" 으로 LED 1개를 제외한다. 화살표 9개, 회색 표시를 확인한다. 다시 포함한다.
  7. 관측 방향을 (0,0.2,1) 로 입력해 라인이 다시 인식되는지 확인하고, "자동" 으로 되돌린다.
  8. 광원을 "직접 배치"(깊이 8, 10개)로 바꿔 계산한다.
  9. 새로고침해 지정이 복원되는지 확인한다(LED STEP 메쉬 IDB 포함).
  10. 3D 모드에서 평판 입력바가 숨겨져 있어야 한다.
  11. 스크린샷을 남긴다.

- [ ] **Step 3: 실행 로그 기록, commit, push**

```bash
git add package.json docs/superpowers/plans/2026-10-15-mech3d-p3-leds-observe.md
git commit -m "docs(plan): mech3d P3 execution log; test scripts"
git push origin master
```

---

## 범위 밖 (P4 이후)
- 자동설계(Milky·개수/피치·두께·거리), 응답 재사용(후보 기저·Milky 재가중), 사건 예산: P4
- 결과 시각화((s,w) 휘도 지도, 길이·폭 프로파일 차트), 최종 판정 화면: P5. P3 은 숫자 판정만 보인다.
- 끝단 입광 도광 로드, 시보·인쇄: 별도 spec
- LED STEP 의 부품 이름(XCAF), "확인 필요" LED 의 개별 발광면 지정 UI: 필요 시 P5
