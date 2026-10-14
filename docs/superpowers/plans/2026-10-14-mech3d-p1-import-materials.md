# 3D 기구 모드 P1 — 다중 부품 STEP 불러오기 · 소재/면 처리 지정 · 메쉬 BVH 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기구 STEP 의 모든 부품을 불러와 3D 뷰에 표시하고, 부품별 소재·면 처리와 부품 간 접촉면을 지정·저장할 수 있게 한다(계산은 P2). 아무것도 불러오지 않은 기본 상태는 기존 평판 모드 그대로다.

**Architecture:**
- **순수 JS 엔진 모듈** `src/engine/mech3d/`
  - `mesh.js`: 부피·결합·외곽
  - `bvh.js`: 광선/박스 질의
  - `materials.js`: 카탈로그·검증
  - `contacts.js`: 동일평면 접촉 면적
  - `runtime.js`: 상태·IndexedDB
  - 모두 Node 테스트로 검증한다.
- **STEP 해석:** 기존 `step-import.js` 에 `readStepParts` 를 추가하고, 전용 Worker 에서 실행한다.
- **UI:** three.js(CDN, importmap) 3D 뷰와 부품 패널을 `#mech3d-wrap` 섹션에 둔다. `spec.mode` 가 `'mech3d'` 일 때만 보인다.

**Tech Stack:**
- 무빌드 ES 모듈 웹앱
- opencascade.js 2.0.0-beta.b5ff984: Node 테스트는 devDependency, 브라우저는 jsdelivr CDN
- three.js 0.160.0 (jsdelivr CDN)
- 테스트는 `node test/*.mjs` (PASS/FAIL 출력, 실패 시 exit 1)

**Spec:** `docs/superpowers/specs/2026-10-14-3d-line-light-design.md` §3, §7(V3D-7), §8(P1)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| Create `src/engine/shape/oc-loader.js` | OpenCASCADE CDN 로더 (워커 3곳 공용, 중복 제거) |
| Modify `src/engine/shape/shape-worker.js` | 로더를 공용 모듈로 교체 |
| Modify `src/export/step-worker.js` | 로더를 공용 모듈로 교체 |
| Modify `src/engine/shape/step-import.js` | 공용 함수 분리 + `readStepParts` (부품별 메쉬 + B-rep 면 번호) |
| Create `src/engine/mech3d/mesh.js` | `meshVolume`, `combineParts`, `bounds` |
| Create `src/engine/mech3d/bvh.js` | `buildBvh`, `intersectRay`, `queryBox` |
| Create `src/engine/mech3d/materials.js` | 부품 소재·면 처리 카탈로그, 기본값, 검증 |
| Create `src/engine/mech3d/contacts.js` | 부품 간 접촉면 감지 (동일평면 삼각형 교차 면적) |
| Create `src/engine/mech3d/runtime.js` | 불러온 3D 기구 상태, 초기 spec 생성, IndexedDB 보관 |
| Create `src/engine/mech3d/mech3d-worker.js` | STEP → 부품 메쉬 Worker |
| Create `src/ui/mech3d-view.js` | three.js 3D 뷰 (부품 색, 선택 강조, 클릭 선택) |
| Create `src/ui/mech3d-panel.js` | 부품 목록, 소재·면 처리 편집, 접촉면 목록 |
| Modify `src/model/defaults.js` | `mode: 'flat'`, `mech3d: null` |
| Modify `src/main.js` | 불러오기, 모드 전환, 패널·뷰 연결, 복원 |
| Modify `index.html`, `styles.css` | 버튼, importmap, `#mech3d-wrap`, 스타일 |
| Create `test/mech3d-util.mjs` | 테스트용 상자 메쉬, 시드 난수 |
| Create `test/mech3d-mesh.mjs`, `test/mech3d-bvh.mjs`, `test/mech3d-materials.mjs`, `test/mech3d-contacts.mjs` | 단위 테스트 |
| Create `test/fixtures/mech3d-sample.mjs` | 샘플 기구(하우징·Milky 커버·도광 바·원기둥) 생성 + `.stp` 기록 |
| Create `test/mech3d-import.mjs` | OC 왕복 통합 테스트 (V3D-7, 접촉면) |
| Modify `package.json` | `test:mech3d` 스크립트 |

---

### Task 1: OpenCASCADE 로더 공용화

**Files:**
- Create: `src/engine/shape/oc-loader.js`
- Modify: `src/engine/shape/shape-worker.js:1-16`
- Modify: `src/export/step-worker.js:6-19`

- [ ] **Step 1: 공용 로더 작성**

```js
// OpenCASCADE.js(≈58MB wasm, CDN) 로더 — Worker 공용. 실패하면 다음 호출에서 다시 시도한다.
export const OC_VERSION = '2.0.0-beta.b5ff984';
const OC_BASE = `https://cdn.jsdelivr.net/npm/opencascade.js@${OC_VERSION}/dist/`;
let ocPromise = null;
export function loadOc() {
  if (!ocPromise) {
    ocPromise = import(/* webpackIgnore: true */ OC_BASE + 'opencascade.full.js').then((mod) =>
      mod.default({ locateFile: (p) => (p.endsWith('.wasm') ? OC_BASE + 'opencascade.full.wasm' : p) })
    ).catch((e) => { ocPromise = null; throw e; });
  }
  return ocPromise;
}
```

- [ ] **Step 2: shape-worker.js 교체.** `const OC_VERSION` 부터 `loadOc` 함수 끝까지를 다음 한 줄로 바꾼다.

```js
import { loadOc } from './oc-loader.js';
```

- [ ] **Step 3: step-worker.js 교체.** 같은 블록(`const OC_VERSION` ~ `loadOc` 끝)을 다음으로 바꾼다.

```js
import { loadOc } from '../engine/shape/oc-loader.js';
```

- [ ] **Step 4: 회귀 확인**

Run: `npm run test:shape`
Expected: 모든 줄 PASS, exit 0 (Node 테스트는 워커를 쓰지 않으므로 영향 없음 확인용)

- [ ] **Step 5: Commit**

```bash
git add src/engine/shape/oc-loader.js src/engine/shape/shape-worker.js src/export/step-worker.js
git commit -m "refactor(shape): share OpenCASCADE CDN loader across workers"
```

---

### Task 2: 메쉬 유틸 (부피·결합·외곽)

**Files:**
- Create: `test/mech3d-util.mjs`
- Create: `test/mech3d-mesh.mjs`
- Create: `src/engine/mech3d/mesh.js`

- [ ] **Step 1: 테스트 유틸 작성** (`test/mech3d-util.mjs`)

```js
// 3D 기구 모드 테스트 공용 — 바깥 법선(반시계) 상자 메쉬, 시드 난수, PASS/FAIL 집계.
export function boxMesh(x0, y0, z0, dx, dy, dz) {
  const P = [], T = [], F = [];
  const quad = (a, b, c, d, f) => { const i = P.length / 3; P.push(...a, ...b, ...c, ...d); T.push(i, i + 1, i + 2, i, i + 2, i + 3); F.push(f, f); };
  const x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0);   // −z
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 1);   // +z
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 2);   // −y
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 3);   // +y
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 4);   // −x
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 5);   // +x
  return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 6 };
}
export function rng(seed = 1) {   // mulberry32 — 테스트 입력 생성 전용(통계 품질 불필요)
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let fails = 0;
export const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };
export const done = () => { if (fails) { console.log(`${fails} FAIL`); process.exit(1); } console.log('all PASS'); };
```

- [ ] **Step 2: 실패하는 테스트 작성** (`test/mech3d-mesh.mjs`)

```js
// 3D 기구 메쉬 유틸: node test/mech3d-mesh.mjs
import { meshVolume, combineParts, bounds } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const a = boxMesh(0, 0, 0, 2, 3, 4);
ok(Math.abs(meshVolume(a.positions, a.triangles) - 24) < 1e-9, `상자 부피 24: ${meshVolume(a.positions, a.triangles)}`);
const flipped = Uint32Array.from(a.triangles); for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
ok(Math.abs(meshVolume(a.positions, flipped) + 24) < 1e-9, '면 방향 뒤집으면 부피 부호 반전');

const b = boxMesh(10, 0, 0, 1, 1, 1);
const c = combineParts([a, b]);
ok(c.triangles.length === 72 && c.positions.length === 144, `결합 크기: 삼각형 ${c.triangles.length / 3}, 정점 ${c.positions.length / 3}`);
ok(c.partOf[0] === 0 && c.partOf[12] === 1 && c.faceOf[13] === b.faceIds[1], '삼각형별 부품·면 번호');
ok(c.triangles[36] === a.positions.length / 3 + b.triangles[0], '두 번째 부품 정점 번호 오프셋');
ok(Math.abs(meshVolume(c.positions, c.triangles) - 25) < 1e-9, '결합 부피 = 합');
const bb = bounds(c.positions);
ok(bb.join() === [0, 0, 0, 11, 3, 4].join(), `외곽 ${bb.join()}`);
done();
```

- [ ] **Step 3: 실패 확인**

Run: `node test/mech3d-mesh.mjs`
Expected: `ERR_MODULE_NOT_FOUND` (mesh.js 없음)

- [ ] **Step 4: 구현** (`src/engine/mech3d/mesh.js`)

```js
// 3D 기구 메쉬 유틸 — spec 2026-10-14 §3.1. 부품 메쉬 = { positions(Float32 xyz), triangles(Uint32), faceIds(삼각형별 B-rep 면 번호) }.

// 닫힌 메쉬의 부호 부피(발산정리). 바깥 법선(반시계)이면 양수.
export function meshVolume(positions, triangles) {
  const P = positions;
  let v = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
       - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
       + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

// 부품들을 하나의 추적용 메쉬로 결합 — 삼각형별 부품 번호(partOf)·면 번호(faceOf) 유지
export function combineParts(parts) {
  let nV = 0, nT = 0;
  for (const p of parts) { nV += p.positions.length / 3; nT += p.triangles.length / 3; }
  const positions = new Float32Array(nV * 3), triangles = new Uint32Array(nT * 3);
  const partOf = new Uint16Array(nT), faceOf = new Uint32Array(nT);
  let v0 = 0, t0 = 0;
  parts.forEach((p, i) => {
    positions.set(p.positions, v0 * 3);
    for (let k = 0; k < p.triangles.length; k++) triangles[t0 * 3 + k] = p.triangles[k] + v0;
    const n = p.triangles.length / 3;
    partOf.fill(i, t0, t0 + n);
    faceOf.set(p.faceIds, t0);
    v0 += p.positions.length / 3; t0 += n;
  });
  return { positions, triangles, partOf, faceOf };
}

// 외곽 [xmin, ymin, zmin, xmax, ymax, zmax]
export function bounds(positions) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = positions[i + k];
    if (v < b[k]) b[k] = v;
    if (v > b[k + 3]) b[k + 3] = v;
  }
  return b;
}
```

- [ ] **Step 5: 통과 확인**

Run: `node test/mech3d-mesh.mjs`
Expected: 7개 PASS, `all PASS`

- [ ] **Step 6: Commit**

```bash
git add src/engine/mech3d/mesh.js test/mech3d-util.mjs test/mech3d-mesh.mjs
git commit -m "feat(mech3d): mesh volume, part combine, bounds"
```

---

### Task 3: BVH (광선 교차 · 박스 질의)

**Files:**
- Create: `test/mech3d-bvh.mjs`
- Create: `src/engine/mech3d/bvh.js`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-bvh.mjs`)

```js
// BVH 광선/박스 질의 vs 전수 탐색: node test/mech3d-bvh.mjs
import { buildBvh, intersectRay, queryBox, hitTriangle } from '../src/engine/mech3d/bvh.js';
import { boxMesh, rng, ok, done } from './mech3d-util.mjs';

const R = rng(7);
// 무작위 삼각형 3000개(100mm 공간, 크기 ≤ 5mm)
const nT = 3000, P = new Float32Array(nT * 9), T = new Uint32Array(nT * 3);
for (let t = 0; t < nT; t++) {
  const cx = R() * 100, cy = R() * 100, cz = R() * 100;
  for (let j = 0; j < 3; j++) { P[t * 9 + j * 3] = cx + (R() - 0.5) * 5; P[t * 9 + j * 3 + 1] = cy + (R() - 0.5) * 5; P[t * 9 + j * 3 + 2] = cz + (R() - 0.5) * 5; T[t * 3 + j] = t * 3 + j; }
}
const bvh = buildBvh(P, T);
function brute(ox, oy, oz, dx, dy, dz, tMin, tMax) {
  let best = tMax, hit = -1;
  for (let t = 0; t < nT; t++) { const s = hitTriangle(P, T, t, ox, oy, oz, dx, dy, dz); if (s >= tMin && s < best) { best = s; hit = t; } }
  return hit < 0 ? null : { t: best, tri: hit };
}
let mism = 0, hits = 0;
for (let i = 0; i < 2000; i++) {
  const th = Math.acos(2 * R() - 1), ph = 2 * Math.PI * R();
  const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  if (i % 50 === 0) { d[0] = 0; d[1] = 0; d[2] = 1; }   // 축 평행 광선(역수 Infinity) 포함
  const o = [R() * 100, R() * 100, R() * 100];
  const a = intersectRay(bvh, ...o, ...d, 1e-6, 80), b = brute(...o, ...d, 1e-6, 80);
  if (!!a !== !!b || (a && (Math.abs(a.t - b.t) > 1e-4))) mism++;
  if (b) hits++;
}
ok(mism === 0 && hits > 200, `무작위 광선 2000개: 불일치 ${mism}, 적중 ${hits}`);

// 상자 내부에서 +x 로 쏘면 +x 면(면 번호 5)에 t=1 로 적중
const box = boxMesh(0, 0, 0, 2, 2, 2), bb = buildBvh(box.positions, box.triangles);
const h = intersectRay(bb, 1, 1, 1, 1, 0, 0);
ok(h && Math.abs(h.t - 1) < 1e-9 && box.faceIds[h.tri] === 5, `상자 내부 +x 광선: t=${h?.t}, 면 ${h && box.faceIds[h.tri]}`);
ok(intersectRay(bb, 1, 1, 1, 1, 0, 0, 1e-6, 0.5) === null, 'tMax 이내 적중 없음 → null');

// 박스 질의: 질의 박스와 외곽이 겹치는 삼각형을 모두 포함(누락 없음)
const lo = [40, 40, 40], hi = [60, 60, 60], got = new Set(queryBox(bvh, lo, hi));
let miss = 0;
for (let t = 0; t < nT; t++) {
  let inside = true;
  for (let k = 0; k < 3; k++) {
    const vs = [P[t * 9 + k], P[t * 9 + 3 + k], P[t * 9 + 6 + k]];
    if (Math.max(...vs) < lo[k] || Math.min(...vs) > hi[k]) inside = false;
  }
  if (inside && !got.has(t)) miss++;
}
ok(miss === 0 && got.size > 0, `박스 질의: 후보 ${got.size}, 누락 ${miss}`);
ok(buildBvh(new Float32Array(0), new Uint32Array(0)) && intersectRay(buildBvh(new Float32Array(0), new Uint32Array(0)), 0, 0, 0, 1, 0, 0) === null, '빈 메쉬 → null');
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-bvh.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/bvh.js`)

```js
// 삼각형 메쉬 BVH — spec 2026-10-14 §3.1·§6.1. 중앙값 분할(최장 축), 잎 ≤ 4 삼각형.
// box: 노드별 [xmin,ymin,zmin,xmax,ymax,zmax], meta: 노드별 [잎이면 시작 / 내부면 오른쪽 자식, 잎 삼각형 수(0=내부)].
// 왼쪽 자식은 항상 id+1(깊이 우선 배치). 교차는 양면(앞·뒤 모두) — MC 추적은 매질 안팎을 모두 오간다.

export function buildBvh(positions, triangles, leafSize = 4) {
  const nT = triangles.length / 3;
  const lo = new Float32Array(nT * 3), hi = new Float32Array(nT * 3), c = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    let mn = Infinity, mx = -Infinity;
    for (let j = 0; j < 3; j++) { const v = positions[triangles[t * 3 + j] * 3 + k]; if (v < mn) mn = v; if (v > mx) mx = v; }
    lo[t * 3 + k] = mn; hi[t * 3 + k] = mx; c[t * 3 + k] = (mn + mx) / 2;
  }
  const order = new Uint32Array(nT);
  for (let i = 0; i < nT; i++) order[i] = i;
  const box = [], meta = [];
  function build(s, e) {
    const id = meta.length / 2;
    const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity];
    const ca = [Infinity, Infinity, Infinity], cb = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const t = order[i];
      for (let k = 0; k < 3; k++) {
        if (lo[t * 3 + k] < a[k]) a[k] = lo[t * 3 + k];
        if (hi[t * 3 + k] > b[k]) b[k] = hi[t * 3 + k];
        if (c[t * 3 + k] < ca[k]) ca[k] = c[t * 3 + k];
        if (c[t * 3 + k] > cb[k]) cb[k] = c[t * 3 + k];
      }
    }
    box.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    meta.push(s, e - s);
    if (e - s <= leafSize) return id;
    let ax = 0;
    for (let k = 1; k < 3; k++) if (cb[k] - ca[k] > cb[ax] - ca[ax]) ax = k;
    if (!(cb[ax] - ca[ax] > 0)) return id;   // 중심이 모두 같음 → 잎
    const sub = Array.from(order.subarray(s, e)).sort((p, q) => c[p * 3 + ax] - c[q * 3 + ax]);
    order.set(sub, s);
    const m = (s + e) >> 1;
    build(s, m);
    const r = build(m, e);
    meta[id * 2] = r; meta[id * 2 + 1] = 0;
    return id;
  }
  build(0, nT);
  return { box: Float32Array.from(box), meta: Int32Array.from(meta), order, positions, triangles };
}

// Möller–Trumbore(양면). 적중 거리 t(음수 가능) 또는 −1(평행·빗나감). 마지막 적중의 무게중심 좌표는 hitUV 에.
export const hitUV = { u: 0, v: 0 };
export function hitTriangle(P, T, t, ox, oy, oz, dx, dy, dz) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const sx = ox - P[a], sy = oy - P[a + 1], sz = oz - P[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  hitUV.u = u; hitUV.v = v;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// 가장 가까운 적중 { t, tri, u, v } (tMin ≤ t < tMax) 또는 null. tri 는 원래 삼각형 번호.
export function intersectRay(bvh, ox, oy, oz, dx, dy, dz, tMin = 1e-6, tMax = Infinity) {
  const { box, meta, order, positions: P, triangles: T } = bvh;
  if (!order.length) return null;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const stack = [0];
  let best = tMax, hit = -1, hu = 0, hv = 0;
  while (stack.length) {
    const n = stack.pop(), b = n * 6;
    let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
    let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz;
    if (w0 > w1) { const s = w0; w0 = w1; w1 = s; }
    // NaN(0·∞)은 비교가 모두 거짓 → 노드를 버리지 않는다(보수적)
    const near = Math.max(t0, u0, w0), far = Math.min(t1, u1, w1);
    if (far < near || far < tMin || near > best) continue;
    const cnt = meta[n * 2 + 1];
    if (cnt) {
      for (let i = meta[n * 2], e = i + cnt; i < e; i++) {
        const tri = order[i], s = hitTriangle(P, T, tri, ox, oy, oz, dx, dy, dz);
        if (s >= tMin && s < best) { best = s; hit = tri; hu = hitUV.u; hv = hitUV.v; }
      }
    } else {
      stack.push(meta[n * 2], n + 1);   // 오른쪽 먼저 쌓아 왼쪽부터 방문
    }
  }
  return hit < 0 ? null : { t: best, tri: hit, u: hu, v: hv };
}

// 외곽이 [lo, hi] 박스와 겹치는 잎의 삼각형 번호들(후보 — 삼각형 자체 외곽은 호출자가 판단)
export function queryBox(bvh, lo, hi, out = []) {
  const { box, meta, order } = bvh;
  out.length = 0;
  if (!order.length) return out;
  const stack = [0];
  while (stack.length) {
    const n = stack.pop(), b = n * 6;
    if (box[b] > hi[0] || box[b + 3] < lo[0] || box[b + 1] > hi[1] || box[b + 4] < lo[1] || box[b + 2] > hi[2] || box[b + 5] < lo[2]) continue;
    const cnt = meta[n * 2 + 1];
    if (cnt) for (let i = meta[n * 2], e = i + cnt; i < e; i++) out.push(order[i]);
    else stack.push(meta[n * 2], n + 1);
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-bvh.mjs`
Expected: 5개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/bvh.js test/mech3d-bvh.mjs
git commit -m "feat(mech3d): triangle BVH with ray and box queries"
```

---

### Task 4: 소재·면 처리 카탈로그

**Files:**
- Create: `test/mech3d-materials.mjs`
- Create: `src/engine/mech3d/materials.js`

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-materials.mjs`)

```js
// 3D 기구 소재·면 처리 카탈로그: node test/mech3d-materials.mjs
import { PART_KINDS, FINISH_KINDS, defaultPart, setPartMaterial, setPartFinish, resolveFinish, partIndex, validatePart } from '../src/engine/mech3d/materials.js';
import { ok, done } from './mech3d-util.mjs';

const p0 = defaultPart(0, '부품 1', 100);
ok(p0.material.kind === 'opaque' && p0.finish.kind === 'whiteDiffuse' && p0.finish.R === 0.85, '기본 부품 = 불투명 + 백색 확산 반사 85%');
ok(Object.keys(PART_KINDS).join() === 'milky,clear,whiteTrans,opaque', '부품 소재 4종');
ok(Object.keys(FINISH_KINDS).join() === 'gloss,whiteDiffuse,metal,black', '면 처리 4종(1단계)');

const m = setPartMaterial(p0, 'milky');
ok(m.material.kind === 'milky' && m.material.milky === 5 && m.material.dbId === '' && m.finish.kind === 'gloss', 'Milky 선택 → 면 처리 기본 광택');
ok(p0.material.kind === 'opaque', '원본 불변(새 객체 반환)');
ok(partIndex(m.material) === 1.586 && partIndex(setPartMaterial(p0, 'clear').material) === 1.586 && partIndex(p0.material) === null, '굴절률: PC 1.586, 불투명 null');

const f = setPartFinish(m, 3, { kind: 'black', R: 0.05 });
ok(resolveFinish(f, 3).kind === 'black' && resolveFinish(f, 2).kind === 'gloss', '면 3 만 흑색, 나머지는 부품 기본');
ok(resolveFinish(setPartFinish(f, 3, null), 3).kind === 'gloss', '면 덮어쓰기 해제(null)');
ok(setPartFinish(f, null, { kind: 'metal', R: 0.88 }).finish.kind === 'metal', '부품 기본 면 처리 변경');
ok(setPartMaterial(f, 'opaque').faceFinish && Object.keys(setPartMaterial(f, 'opaque').faceFinish).length === 0, '소재 바꾸면 면 덮어쓰기 초기화');

ok(validatePart(m).length === 0, '정상 부품 오류 없음');
ok(validatePart({ ...m, material: { ...m.material, milky: 11 } }).length === 1, 'Milky 11 → 오류');
ok(validatePart(setPartFinish(m, 0, { kind: 'black', R: 1.5 })).length === 1, '반사율 150% → 오류');
ok(validatePart({ ...setPartMaterial(p0, 'clear'), material: { kind: 'clear', resin: 'PC', T: 0, tRef: 2 } }).length === 1, '투과율 0 → 오류');
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-materials.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/materials.js`)

```js
// 3D 기구 모드 소재 카탈로그 — spec 2026-10-14 §3.2(부품 소재)·§3.3(면 처리). 화면 라벨·기본값·검증(순수 JS, 불변 갱신).
// 물리 해석(μs·g·μa 등)은 P2 추적기에서 이 값을 읽어 수행한다.
export const RESIN_N = { PC: 1.586, PMMA: 1.49 };

export const PART_KINDS = {
  milky: { label: 'Milky' },
  clear: { label: '투명' },
  whiteTrans: { label: '반투과 백색' },
  opaque: { label: '불투명' },
};

export const FINISH_KINDS = {
  gloss: { label: '광택', hasR: false },
  whiteDiffuse: { label: '백색 확산 반사', hasR: true, R: 0.85 },
  metal: { label: '금속 증착·크롬', hasR: true, R: 0.88 },
  black: { label: '흑색', hasR: true, R: 0.05 },
};

// T: 기준 두께 tRef(mm)에서의 투과율(0~1). milky: 0~10, dbId: 실측소재 DB id('' = 추상 Milky)
export function defaultMaterial(kind) {
  switch (kind) {
    case 'milky': return { kind, dbId: '', milky: 5, resin: 'PC' };
    case 'clear': return { kind, resin: 'PC', T: 1, tRef: 2 };
    case 'whiteTrans': return { kind, resin: 'PC', T: 0.1, tRef: 1.5 };
    case 'opaque': return { kind };
    default: throw new Error(`알 수 없는 소재 종류: ${kind}`);
  }
}

export function defaultFinish(kind, R) {
  const f = FINISH_KINDS[kind];
  if (!f) throw new Error(`알 수 없는 면 처리: ${kind}`);
  return f.hasR ? { kind, R: R ?? f.R } : { kind };
}

// 소재를 고르면 따라오는 면 처리 기본값: 불투명 = 백색 확산 반사, 그 외(빛이 들어가는 소재) = 광택
export function finishForMaterial(material) {
  return material.kind === 'opaque' ? defaultFinish('whiteDiffuse') : defaultFinish('gloss');
}

export function defaultPart(id, name, volume) {
  const material = defaultMaterial('opaque');
  return { id, name, volume, material, finish: finishForMaterial(material), faceFinish: {} };
}

export function setPartMaterial(part, kind) {
  const material = defaultMaterial(kind);
  return { ...part, material, finish: finishForMaterial(material), faceFinish: {} };
}

export function setPartMaterialParam(part, key, value) {
  return { ...part, material: { ...part.material, [key]: value } };
}

// face = null 이면 부품 기본 면 처리, 숫자면 그 면만 덮어쓰기(finish = null 이면 덮어쓰기 해제)
export function setPartFinish(part, face, finish) {
  if (face == null) return { ...part, finish };
  const faceFinish = { ...part.faceFinish };
  if (finish == null) delete faceFinish[face]; else faceFinish[face] = finish;
  return { ...part, faceFinish };
}

export function resolveFinish(part, face) { return part.faceFinish?.[face] ?? part.finish; }

// 빛이 내부로 들어가는 소재의 굴절률(불투명이면 null)
export function partIndex(material) {
  return material.kind === 'opaque' ? null : (RESIN_N[material.resin] ?? RESIN_N.PC);
}

export function validatePart(part) {
  const e = [], m = part.material;
  if (!PART_KINDS[m.kind]) e.push(`소재 종류 오류: ${m.kind}`);
  if (m.kind === 'milky' && !(m.milky >= 0 && m.milky <= 10)) e.push('Milky 는 0~10');
  if (m.kind === 'clear' || m.kind === 'whiteTrans') {
    if (!(m.T > 0 && m.T <= 1)) e.push('투과율은 0 초과 100% 이하');
    if (!(m.tRef > 0)) e.push('기준 두께는 0 초과');
  }
  if (m.resin != null && !RESIN_N[m.resin]) e.push(`수지 오류: ${m.resin}`);
  for (const f of [part.finish, ...Object.values(part.faceFinish ?? {})]) {
    const k = FINISH_KINDS[f?.kind];
    if (!k) e.push(`면 처리 오류: ${f?.kind}`);
    else if (k.hasR && !(f.R >= 0 && f.R <= 1)) e.push(`${k.label} 반사율은 0~100%`);
  }
  return e;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-materials.mjs`
Expected: 14개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/materials.js test/mech3d-materials.mjs
git commit -m "feat(mech3d): part material and surface finish catalog"
```

---

### Task 5: 접촉면 감지

**Files:**
- Create: `test/mech3d-contacts.mjs`
- Create: `src/engine/mech3d/contacts.js`

방법: 부품 A 의 삼각형마다 B 의 BVH 에서 겹치는 후보를 찾는다. 법선이 반대(내적 ≤ −0.98)이고 B 삼각형의 세 정점이 A 평면에서 gap 이내이면, A 평면에 투영해 두 삼각형의 교차 다각형 면적(Sutherland–Hodgman)을 더한다. 평면 접촉에서는 정확하다.

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-contacts.mjs`)

```js
// 부품 간 접촉면 감지: node test/mech3d-contacts.mjs
import { findContacts } from '../src/engine/mech3d/contacts.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const near = (x, y, e = 1e-3) => Math.abs(x - y) < e;
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, 2)]);
  ok(c.length === 1 && c[0].a === 0 && c[0].faceA === 1 && c[0].b === 1 && c[0].faceB === 0 && near(c[0].area, 100), `적층: ${JSON.stringify(c)}`);
}
ok(findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.5, 10, 10, 2)]).length === 0, '0.5mm 공기층 → 접촉 없음');
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.015, 10, 10, 2)]);
  ok(c.length === 1 && near(c[0].area, 100), '0.015mm (허용 0.02 이내) → 접촉');
}
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(5, 0, 2, 10, 10, 2)]);
  ok(c.length === 1 && near(c[0].area, 50), `절반 겹침: 면적 ${c[0]?.area}`);
}
{
  const c = findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(10, 0, 0, 10, 10, 2)]);
  ok(c.length === 1 && c[0].faceA === 5 && c[0].faceB === 4 && near(c[0].area, 20), `옆면 접촉: ${JSON.stringify(c)}`);
}
ok(findContacts([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(30, 0, 0, 1, 1, 1)]).length === 0, '떨어진 부품 → 없음');
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-contacts.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/contacts.js`)

```js
// 부품 간 광학 접촉면(이중사출·접착) 감지 — spec 2026-10-14 §3.4.
// 서로 다른 부품의 삼각형이 거리 ≤ gap, 법선 반대 → 같은 평면으로 보고 교차 면적을 (부품A, 면A, 부품B, 면B)별로 합산.
import { buildBvh, queryBox } from './bvh.js';
import { bounds } from './mesh.js';

const NDOT = -0.98, MIN_AREA = 0.01;

function triFrame(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const v = [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[c], P[c + 1], P[c + 2]]];
  const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(...n);
  return { v, n: len > 0 ? n.map((x) => x / len) : [0, 0, 0], area: len / 2 };
}

function planeBasis(n) {
  const r = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]];
  const l = Math.hypot(...u); u = u.map((x) => x / l);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, w };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const signedArea = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length]; s += x0 * y1 - x1 * y0; } return s / 2; };

// 볼록 다각형 poly 를 볼록 다각형 clip(반시계)으로 자른 면적
function clipArea(poly, clip) {
  let out = poly;
  for (let i = 0; i < clip.length && out.length; i++) {
    const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
    const side = (p) => (bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])]); }
    }
  }
  return out.length >= 3 ? Math.abs(signedArea(out)) : 0;
}

const overlaps = (A, B, m) => A[0] - m <= B[3] && B[0] - m <= A[3] && A[1] - m <= B[4] && B[1] - m <= A[4] && A[2] - m <= B[5] && B[2] - m <= A[5];

// parts: [{ positions, triangles, faceIds, bvh? }] → [{ a, faceA, b, faceB, area(mm²) }] (a < b)
export function findContacts(parts, { gap = 0.02 } = {}) {
  const bvhs = parts.map((p) => p.bvh ?? buildBvh(p.positions, p.triangles));
  const bb = parts.map((p) => bounds(p.positions));
  const acc = new Map(), cand = [];
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    if (!overlaps(bb[a], bb[b], gap)) continue;
    const A = parts[a], B = parts[b];
    for (let t = 0; t < A.triangles.length / 3; t++) {
      const fa = triFrame(A.positions, A.triangles, t);
      if (!fa.area) continue;
      const lo = [0, 1, 2].map((k) => Math.min(fa.v[0][k], fa.v[1][k], fa.v[2][k]) - gap);
      const hi = [0, 1, 2].map((k) => Math.max(fa.v[0][k], fa.v[1][k], fa.v[2][k]) + gap);
      queryBox(bvhs[b], lo, hi, cand);
      if (!cand.length) continue;
      const { u, w } = planeBasis(fa.n), d0 = dot(fa.n, fa.v[0]);
      let pa = fa.v.map((p) => [dot(p, u), dot(p, w)]);
      if (signedArea(pa) < 0) pa = pa.reverse();
      for (const tb of cand) {
        const fb = triFrame(B.positions, B.triangles, tb);
        if (!fb.area || dot(fa.n, fb.n) > NDOT) continue;
        if (fb.v.some((p) => Math.abs(dot(fa.n, p) - d0) > gap)) continue;
        let pb = fb.v.map((p) => [dot(p, u), dot(p, w)]);
        if (signedArea(pb) < 0) pb = pb.reverse();
        const ar = clipArea(pa, pb);
        if (ar <= 0) continue;
        const key = `${a}|${A.faceIds[t]}|${b}|${B.faceIds[tb]}`;
        acc.set(key, (acc.get(key) ?? 0) + ar);
      }
    }
  }
  return [...acc].filter(([, area]) => area >= MIN_AREA).map(([k, area]) => {
    const [a, faceA, b, faceB] = k.split('|').map(Number);
    return { a, faceA, b, faceB, area };
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-contacts.mjs`
Expected: 6개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/contacts.js test/mech3d-contacts.mjs
git commit -m "feat(mech3d): detect optical contact faces between parts"
```

---

### Task 6: 다중 부품 STEP 불러오기 + 샘플 기구 (V3D-7)

**Files:**
- Modify: `src/engine/shape/step-import.js` (전체 교체)
- Create: `test/fixtures/mech3d-sample.mjs`
- Create: `test/mech3d-import.mjs`
- Create (생성물): `test/fixtures/mech3d-sample.stp`

- [ ] **Step 1: 샘플 기구 생성기 작성** (`test/fixtures/mech3d-sample.mjs`)

```js
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
```

- [ ] **Step 2: 실패하는 테스트 작성** (`test/mech3d-import.mjs`)

```js
// 다중 부품 STEP 불러오기 왕복(V3D-7) + 샘플 기구 접촉면: node test/mech3d-import.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapesToStepText } from '../src/export/oc-build.js';
import { readStepParts, readStepMesh } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { findContacts } from '../src/engine/mech3d/contacts.js';
import { buildSampleShapes, SAMPLE } from './fixtures/mech3d-sample.mjs';
import { ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade();
const text = shapesToStepText(oc, buildSampleShapes(oc));
const t0 = performance.now();
const parts = readStepParts(oc, text);
ok(parts.length === 4, `부품 수 4: ${parts.length} (${(performance.now() - t0).toFixed(0)}ms)`);
parts.forEach((p, i) => {
  const vm = meshVolume(p.positions, p.triangles), e = Math.abs(vm / p.volume - 1);
  ok(Math.abs(p.volume / SAMPLE.volumes[i] - 1) < 1e-6 && e <= 0.005, `V3D-7 부품 ${i}: OC ${p.volume.toFixed(1)} / 메쉬 ${vm.toFixed(1)} mm³ (차 ${(e * 100).toFixed(3)}% ≤ 0.5%)`);
  ok(p.faceCount === SAMPLE.faceCounts[i] && Math.max(...p.faceIds) < p.faceCount && p.faceIds.length === p.triangles.length / 3, `부품 ${i} 면 ${p.faceCount}개, 삼각형별 면 번호`);
});
const c = findContacts(parts), sum = {};
for (const x of c) sum[`${x.a}|${x.b}`] = (sum[`${x.a}|${x.b}`] ?? 0) + x.area;
for (const [k, want] of Object.entries(SAMPLE.contactArea)) ok(Math.abs((sum[k] ?? 0) - want) < 0.05, `접촉 ${k}: ${(sum[k] ?? 0).toFixed(2)} / 기대 ${want} mm²`);
ok(!Object.keys(sum).some((k) => k.endsWith('|3') || k.startsWith('3|')), '떨어진 원기둥은 접촉 없음');
const legacy = readStepMesh(oc, text);
ok(legacy.solidCount === 4 && Math.abs(legacy.volume - SAMPLE.volumes[0]) < 1e-3 && legacy.droppedVolumes.length === 3, '기존 readStepMesh(L3 몸체) 동작 유지');
done();
```

- [ ] **Step 3: 실패 확인**

Run: `node test/mech3d-import.mjs`
Expected: `SyntaxError: ... does not provide an export named 'readStepParts'`

- [ ] **Step 4: step-import.js 교체** (기존 `readStepMesh` 의 반환값은 그대로 유지)

```js
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
```

- [ ] **Step 5: 통과 확인**

Run: `node test/mech3d-import.mjs`
Expected: 부품 수, 부품별 V3D-7·면 번호 8줄, 접촉 3줄, 원기둥, 기존 동작 → 모두 PASS, `all PASS`
(원기둥 V3D-7 이 0.5% 를 넘으면 `linDefl` 기본값을 낮추지 말고 FAIL 내용을 보고한다 — 기본값 변경은 L3 몸체에도 영향)

- [ ] **Step 6: 기존 STEP 불러오기 회귀**

Run: `npm run test:shape`
Expected: 모든 줄 PASS

- [ ] **Step 7: 샘플 STEP 생성 (브라우저 확인용)**

Run: `node test/fixtures/mech3d-sample.mjs`
Expected: `wrote test/fixtures/mech3d-sample.stp`

- [ ] **Step 8: Commit**

```bash
git add src/engine/shape/step-import.js test/fixtures/mech3d-sample.mjs test/fixtures/mech3d-sample.stp test/mech3d-import.mjs
git commit -m "feat(mech3d): import all STEP solids as parts with B-rep face ids (V3D-7)"
```

---

### Task 7: 3D 기구 런타임 + spec 기본값 + 테스트 스크립트

**Files:**
- Create: `src/engine/mech3d/runtime.js`
- Modify: `src/model/defaults.js:8-10` (`ver` 줄 다음에 두 줄 추가)
- Modify: `test/mech3d-import.mjs` (끝부분에 런타임 검사 추가)
- Modify: `package.json` (scripts)

- [ ] **Step 1: 실패하는 테스트 추가.** `test/mech3d-import.mjs` 의 `done();` 바로 앞에 넣고, 파일 상단 import 에 `import { setMech3dMesh, initialMech3dSpec, getMech3d } from '../src/engine/mech3d/runtime.js';` 를 추가한다.

```js
setMech3dMesh('sample.stp', parts);
const ms = initialMech3dSpec();
ok(getMech3d().combined.partOf.length === parts.reduce((s, p) => s + p.triangles.length / 3, 0) && getMech3d().bvh.order.length === getMech3d().combined.partOf.length, '런타임: 결합 메쉬·BVH 생성');
ok(ms.name === 'sample.stp' && ms.parts.length === 4 && ms.parts[0].name === '부품 1' && ms.parts[3].material.kind === 'opaque', '초기 spec: 부품 4개, 기본 소재 불투명');
ok(ms.parts[0].size.every((v, k) => Math.abs(v - [120, 20, 12][k]) < 1e-3), `초기 spec: 하우징 외곽 ${ms.parts[0].size.join('×')}`);
ok(ms.contacts.length === c.length && ms.contacts.every((x) => x.mode === 'contact'), '초기 spec: 접촉면 기본 = 광학 접촉');
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-import.mjs`
Expected: `ERR_MODULE_NOT_FOUND` (runtime.js)

- [ ] **Step 3: 런타임 구현** (`src/engine/mech3d/runtime.js`)

```js
// 3D 기구 런타임 — spec 2026-10-14 §3. 메쉬·BVH 는 여기(메모리 + IndexedDB), 사용자 지정(소재·면 처리·접촉면)은 spec.mech3d(JSON 저장).
import { combineParts, bounds } from './mesh.js';
import { buildBvh } from './bvh.js';
import { findContacts } from './contacts.js';
import { defaultPart } from './materials.js';

let scene = null;   // { name, parts: [{ positions, triangles, faceIds, faceCount, volume, bvh }], combined, bvh }

export function setMech3dMesh(name, rawParts) {
  const parts = rawParts.map((p) => ({ ...p, bvh: buildBvh(p.positions, p.triangles) }));
  const combined = combineParts(parts);
  scene = { name, parts, combined, bvh: buildBvh(combined.positions, combined.triangles) };
  return scene;
}
export function getMech3d() { return scene; }
export function clearMech3d() { scene = null; }

// 새로 불러온 기구의 사용자 지정 초기값(spec.mech3d)
export function initialMech3dSpec() {
  if (!scene) return null;
  return {
    name: scene.name,
    parts: scene.parts.map((p, i) => {
      const b = bounds(p.positions);
      return { ...defaultPart(i, `부품 ${i + 1}`, p.volume), size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]] };
    }),
    contacts: findContacts(scene.parts).map((c) => ({ ...c, mode: 'contact' })),
  };
}

// ---- IndexedDB 보관(브라우저 전용) — L3 몸체와 같은 DB, 다른 키 ----
const DB = 'uds-shape', STORE = 'body', KEY = 'mech3d';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function saveMech3dIDB() {
  if (typeof indexedDB === 'undefined' || !scene) return;
  const d = await idb();
  const parts = scene.parts.map(({ positions, triangles, faceIds, faceCount, volume }) => ({ positions, triangles, faceIds, faceCount, volume }));
  await new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ name: scene.name, parts }, KEY);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
export async function loadMech3dIDB() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const d = await idb();
    const v = await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(KEY); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return v ? setMech3dMesh(v.name, v.parts) : null;
  } catch { return null; }
}
```

- [ ] **Step 4: spec 기본값 추가.** `src/model/defaults.js` 의 `ver: 13,` 줄 바로 아래에 추가한다.

```js
  mode: 'flat',                 // 'flat'(평판 모드, 기본) | 'mech3d'(3D 기구 모드 — 기구 STEP 불러오면 전환, spec 2026-10-14)
  mech3d: null,                 // 3D 기구 사용자 지정 { name, parts[소재·면 처리], contacts[접촉면] } — 메쉬는 IndexedDB
```

- [ ] **Step 5: 테스트 스크립트 추가.** `package.json` scripts 의 `"test:l2"` 줄 앞에 추가한다.

```json
    "test:mech3d": "node test/mech3d-mesh.mjs && node test/mech3d-bvh.mjs && node test/mech3d-materials.mjs && node test/mech3d-contacts.mjs && node test/mech3d-import.mjs",
```

- [ ] **Step 6: 통과 확인**

Run: `npm run test:mech3d`
Expected: 5개 파일 모두 `all PASS`, exit 0

Run: `npm test`
Expected: exit 0 (defaults 변경 회귀 없음)

- [ ] **Step 7: Commit**

```bash
git add src/engine/mech3d/runtime.js src/model/defaults.js test/mech3d-import.mjs package.json
git commit -m "feat(mech3d): runtime state, initial spec, IndexedDB persistence"
```

---

### Task 8: STEP → 부품 Worker

**Files:**
- Create: `src/engine/mech3d/mech3d-worker.js`

- [ ] **Step 1: 구현**

```js
// 3D 기구 STEP 불러오기 Worker — 입력 { text } → 진행 { stage } → 결과 { parts: [{ positions, triangles, faceIds, faceCount, volume }] } | { error }
import { loadOc } from '../shape/oc-loader.js';
import { readStepParts } from '../shape/step-import.js';

self.onmessage = async (ev) => {
  try {
    self.postMessage({ stage: 'OpenCASCADE 로드 중(첫 회 수십 초)…' });
    const oc = await loadOc();
    self.postMessage({ stage: 'STEP 해석·부품 메시 생성 중…' });
    const parts = readStepParts(oc, ev.data.text);
    const transfer = parts.flatMap((p) => [p.positions.buffer, p.triangles.buffer, p.faceIds.buffer]);
    self.postMessage({ parts }, transfer);
  } catch (e) { self.postMessage({ error: String(e?.message ?? e) }); }
};
```

- [ ] **Step 2: 문법 확인**

Run: `node --check src/engine/mech3d/mech3d-worker.js`
Expected: 출력 없음, exit 0

- [ ] **Step 3: Commit**

```bash
git add src/engine/mech3d/mech3d-worker.js
git commit -m "feat(mech3d): STEP parts import worker"
```

---

### Task 9: three.js 3D 뷰

**Files:**
- Modify: `index.html` (`<head>` 에 importmap)
- Create: `src/ui/mech3d-view.js`

- [ ] **Step 1: importmap 추가.** `index.html` 의 `<link rel="stylesheet" href="./styles.css" />` 줄 바로 아래에 넣는다.

```html
  <script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }</script>
```

- [ ] **Step 2: 뷰 구현** (`src/ui/mech3d-view.js`)

```js
// 3D 기구 뷰 — spec 2026-10-14 §3. 부품을 소재 종류별 색으로 그리고, 선택 부품·면을 강조한다.
// 클릭(드래그 아님) → onPick({ part, face }) 또는 onPick(null). 회전·이동·확대는 OrbitControls(Z 위).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const KIND_COLOR = { milky: 0xdfe9f2, clear: 0x8cc8ff, whiteTrans: 0xf2efe6, opaque: 0x8a909c };
const KIND_OPACITY = { milky: 0.85, clear: 0.35, whiteTrans: 0.95, opaque: 1 };
const SEL_TINT = new THREE.Color(0xffb020), FACE_COLOR = new THREE.Color(0xff5a36);

export function createMech3dView(canvas, { onPick }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1420);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1e5);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(1, -1, 2); scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  let meshes = [], partsRef = [], kinds = [], sel = null;

  function resize() {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
  }
  new ResizeObserver(resize).observe(canvas);

  function colorize(i) {
    const m = meshes[i], p = partsRef[i], col = m.geometry.getAttribute('color');
    const base = new THREE.Color(KIND_COLOR[kinds[i]]);
    const partCol = sel?.part === i ? base.clone().lerp(SEL_TINT, 0.45) : base;
    const T = p.triangles;
    for (let t = 0; t < T.length / 3; t++) {
      const c = sel?.part === i && sel.face === p.faceIds[t] ? FACE_COLOR : partCol;
      for (let j = 0; j < 3; j++) col.setXYZ(T[t * 3 + j], c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    m.material.opacity = KIND_OPACITY[kinds[i]];
    m.material.transparent = KIND_OPACITY[kinds[i]] < 1;
  }

  // parts: 런타임 scene.parts, kindsOf: 부품별 소재 종류 배열
  function setParts(parts, kindsOf) {
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    partsRef = parts; kinds = kindsOf.slice();
    meshes = parts.map((p, i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.positions.length), 3));
      g.setIndex(new THREE.BufferAttribute(p.triangles, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, depthWrite: true }));
      m.userData.part = i;
      scene.add(m);
      return m;
    });
    meshes.forEach((_, i) => colorize(i));
    const box = new THREE.Box3(); meshes.forEach((m) => box.expandByObject(m));
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(r * 1.2, -r * 1.6, r * 1.3));
    camera.near = r / 100; camera.far = r * 100; camera.updateProjectionMatrix();
    controls.update(); resize();
  }

  function setKinds(kindsOf) { kinds = kindsOf.slice(); meshes.forEach((_, i) => colorize(i)); render(); }
  function setSelection(s) { sel = s; meshes.forEach((_, i) => colorize(i)); render(); }

  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const h = ray.intersectObjects(meshes, false)[0];
    if (!h) { onPick(null); return; }
    const part = h.object.userData.part;
    onPick({ part, face: partsRef[part].faceIds[h.faceIndex] });
  });

  return { setParts, setKinds, setSelection, render };
}
```

- [ ] **Step 3: 문법 확인**

Run: `node --check src/ui/mech3d-view.js`
Expected: 출력 없음, exit 0 (bare import 'three' 는 파싱만 하므로 통과)

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui/mech3d-view.js
git commit -m "feat(mech3d): three.js part viewer with part/face picking"
```

---

### Task 10: 부품 패널 (소재·면 처리·접촉면)

**Files:**
- Create: `src/ui/mech3d-panel.js`

- [ ] **Step 1: 구현**

```js
// 3D 기구 패널 — spec 2026-10-14 §3. 부품 목록 · 선택 부품의 소재/면 처리 · 선택 면 덮어쓰기 · 접촉면 목록.
// 상태는 갖지 않는다: m = spec.mech3d, sel = { part, face } | null, dbList = 실측소재 DB 목록, h = 이벤트 처리기.
import { PART_KINDS, FINISH_KINDS, RESIN_N, resolveFinish } from '../engine/mech3d/materials.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pct = (x) => Math.round(x * 1000) / 10;
const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label ?? k)}</option>`).join('');

function finishRow(f, scope, allowInherit) {
  const k = f ? FINISH_KINDS[f.kind] : null;
  return `<div class="m3-row"><select data-m3-finish="${scope}">
      ${allowInherit ? `<option value="" ${f ? '' : 'selected'}>부품 기본 따름</option>` : ''}${opts(FINISH_KINDS, f?.kind)}</select>
    ${k?.hasR ? `반사율 <input type="number" min="0" max="100" step="1" value="${pct(f.R)}" data-m3-finishr="${scope}">%` : ''}</div>`;
}

function materialParams(mat, dbList) {
  const resin = `<select data-m3-mat="resin">${Object.keys(RESIN_N).map((r) => `<option ${r === mat.resin ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  switch (mat.kind) {
    case 'milky':
      return `<div class="m3-row">소재 <select data-m3-mat="dbId"><option value="">추상 Milky</option>${dbList.map((e) => `<option value="${esc(e.id)}" ${e.id === mat.dbId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        Milky <input type="number" min="0" max="10" step="0.1" value="${mat.milky}" data-m3-mat="milky"></div>`;
    case 'clear':
      return `<div class="m3-row">${resin} 투과율 <input type="number" min="1" max="100" step="1" value="${pct(mat.T)}" data-m3-mat="T">% @ <input type="number" min="0.1" step="0.1" value="${mat.tRef}" data-m3-mat="tRef">mm</div>`;
    case 'whiteTrans':
      return `<div class="m3-row">${resin} 투과율 <input type="number" min="1" max="100" step="1" value="${pct(mat.T)}" data-m3-mat="T">% @ <input type="number" min="0.1" step="0.1" value="${mat.tRef}" data-m3-mat="tRef">mm</div>`;
    default:
      return '';
  }
}

function partEditor(p, sel, dbList) {
  const face = sel.face;
  return `<div class="m3-edit">
    <div class="m3-sub">${esc(p.name)} — 부품 소재</div>
    <div class="m3-row"><select data-m3-kind>${opts(PART_KINDS, p.material.kind)}</select></div>
    ${materialParams(p.material, dbList)}
    <div class="m3-sub">면 처리 (부품 기본)</div>
    ${finishRow(p.finish, 'part', false)}
    ${face != null ? `<div class="m3-sub">선택한 면 #${face}${p.faceFinish[face] ? ' · 덮어씀' : ''}</div>${finishRow(p.faceFinish[face] ?? null, 'face', true)}` : '<div class="mut">3D 뷰에서 면을 클릭하면 그 면만 다르게 지정할 수 있습니다</div>'}
  </div>`;
}

// h = { onSelect(part), onKind(part, kind), onMat(part, key, value), onFinish(part, face|null, finish|null), onContact(i, mode), onExit() }
export function renderMech3dPanel(el, m, sel, dbList, h) {
  const p = sel?.part != null ? m.parts[sel.part] : null;
  el.innerHTML = `
    <div class="m3-hd">3D 기구 <b>${esc(m.name)}</b> <button data-m3-exit>평판 모드로</button></div>
    <div class="m3-parts">${m.parts.map((q, i) => `<div class="m3-part ${i === sel?.part ? 'on' : ''}" data-m3-part="${i}">
      <span class="m3-kind k-${q.material.kind}">${PART_KINDS[q.material.kind].label}</span> ${esc(q.name)} <span class="mut">${q.size.map((v) => v.toFixed(1)).join('×')}mm · ${q.volume.toFixed(0)} mm³</span></div>`).join('')}</div>
    ${p ? partEditor(p, sel, dbList) : '<div class="mut">부품을 목록이나 3D 뷰에서 클릭하세요</div>'}
    <div class="m3-sub">접촉면 (체크 = 공기층 없음, 이중사출·접착)</div>
    <div class="m3-contacts">${m.contacts.length ? m.contacts.map((c, i) => `<label><input type="checkbox" data-m3-contact="${i}" ${c.mode === 'contact' ? 'checked' : ''}>
      ${esc(m.parts[c.a].name)} ↔ ${esc(m.parts[c.b].name)} · ${c.area.toFixed(1)} mm²</label>`).join('') : '<div class="mut">감지된 접촉면 없음</div>'}</div>`;

  el.querySelector('[data-m3-exit]').onclick = h.onExit;
  el.querySelectorAll('[data-m3-part]').forEach((d) => { d.onclick = () => h.onSelect(+d.dataset.m3Part); });
  el.querySelectorAll('[data-m3-contact]').forEach((c) => { c.onchange = () => h.onContact(+c.dataset.m3Contact, c.checked ? 'contact' : 'air'); });
  if (!p) return;
  const i = sel.part;
  el.querySelector('[data-m3-kind]').onchange = (e) => h.onKind(i, e.target.value);
  el.querySelectorAll('[data-m3-mat]').forEach((x) => {
    x.onchange = () => {
      const k = x.dataset.m3Mat;
      const v = k === 'T' ? +x.value / 100 : (k === 'milky' || k === 'tRef') ? +x.value : x.value;
      h.onMat(i, k, v);
    };
  });
  el.querySelectorAll('[data-m3-finish]').forEach((x) => {
    x.onchange = () => {
      const face = x.dataset.m3Finish === 'face' ? sel.face : null;
      const k = x.value;
      h.onFinish(i, face, k ? (FINISH_KINDS[k].hasR ? { kind: k, R: FINISH_KINDS[k].R } : { kind: k }) : null);
    };
  });
  el.querySelectorAll('[data-m3-finishr]').forEach((x) => {
    x.onchange = () => {
      const face = x.dataset.m3Finishr === 'face' ? sel.face : null;
      const cur = face == null ? p.finish : resolveFinish(p, face);
      h.onFinish(i, face, { ...cur, R: Math.min(1, Math.max(0, +x.value / 100)) });
    };
  });
}
```

- [ ] **Step 2: 문법 확인**

Run: `node --check src/ui/mech3d-panel.js`
Expected: 출력 없음, exit 0

- [ ] **Step 3: Commit**

```bash
git add src/ui/mech3d-panel.js
git commit -m "feat(mech3d): part panel for material, surface finish and contacts"
```

---

### Task 11: main.js 연결 · 모드 전환 · 복원

**Files:**
- Modify: `index.html:16` (헤더 버튼), `index.html:84` (`</main>` 앞 섹션)
- Modify: `styles.css` (끝에 추가)
- Modify: `src/main.js` (import, 핸들러, migrate, 시작부)

- [ ] **Step 1: index.html.** 헤더의 `불러오기` label 줄 바로 아래에 추가한다.

```html
      <label class="import" title="기구설계 STEP(.stp/.step) — 모든 부품을 불러와 3D 기구 모드로 전환">3D 기구 불러오기<input type="file" id="file-mech3d" accept=".stp,.step" hidden /></label>
```

`</main>` 바로 앞에 추가한다.

```html
    <section id="mech3d-wrap" hidden>
      <div class="pane col" id="pane-mech3d-panel"><div id="mech3d-panel"></div><div id="mech3d-status" class="muted"></div></div>
      <div class="pane" id="pane-mech3d-view"><canvas id="mech3d-canvas"></canvas></div>
    </section>
```

- [ ] **Step 2: styles.css 끝에 추가**

```css
/* 3D 기구 모드 (spec 2026-10-14) */
#mech3d-wrap { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 8px; min-height: 70vh; }
#mech3d-wrap[hidden] { display: none; }
#pane-mech3d-view canvas { width: 100%; height: 100%; min-height: 60vh; display: block; }
.m3-hd { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.m3-hd button { margin-left: auto; }
.m3-part { padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.m3-part.on { background: rgba(255, 176, 32, 0.18); }
.m3-kind { display: inline-block; min-width: 64px; font-size: 11px; padding: 1px 4px; border-radius: 3px; background: #2a3242; }
.m3-kind.k-milky { background: #3a4a5a; } .m3-kind.k-clear { background: #1f4766; } .m3-kind.k-whiteTrans { background: #55524a; }
.m3-sub { margin-top: 10px; font-size: 12px; opacity: 0.8; }
.m3-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
.m3-row input[type=number] { width: 64px; }
.m3-contacts label { display: block; font-size: 12px; margin: 2px 0; }
```

- [ ] **Step 3: main.js import 추가.** 기존 `import { exportStep } from './export/step-ui.js';` 줄 아래에 추가한다.

```js
import { setMech3dMesh, getMech3d, clearMech3d, initialMech3dSpec, saveMech3dIDB, loadMech3dIDB } from './engine/mech3d/runtime.js';
import { setPartMaterial, setPartMaterialParam, setPartFinish } from './engine/mech3d/materials.js';
import { renderMech3dPanel } from './ui/mech3d-panel.js';
```

- [ ] **Step 4: main.js 핸들러 추가.** `function clearShape() {...}` 블록 바로 아래에 추가한다.

```js
// ---- 3D 기구 모드 (spec 2026-10-14 §3) ----
let m3sel = null, m3view = null;
function applyMode() {
  const m3 = spec.mode === 'mech3d' && !!spec.mech3d && !!getMech3d();
  $('#mech3d-wrap').hidden = !m3;
  $('#design-wrap').hidden = m3;
  $('#results-wrap').hidden = m3;
  if (m3) renderMech3d();
}
async function renderMech3d(meshChanged = false) {
  const kinds = spec.mech3d.parts.map((p) => p.material.kind);
  if (!m3view) {
    const { createMech3dView } = await import('./ui/mech3d-view.js');
    m3view = createMech3dView($('#mech3d-canvas'), { onPick: (s) => { m3sel = s; renderMech3d(); } });
    meshChanged = true;
  }
  if (meshChanged) m3view.setParts(getMech3d().parts, kinds); else m3view.setKinds(kinds);
  m3view.setSelection(m3sel);
  renderMech3dPanel($('#mech3d-panel'), spec.mech3d, m3sel, materialDb()?.list() ?? [], {
    onSelect: (i) => { m3sel = { part: i, face: null }; renderMech3d(); },
    onKind: (i, k) => updPart(i, (p) => setPartMaterial(p, k)),
    onMat: (i, key, v) => updPart(i, (p) => setPartMaterialParam(p, key, v)),
    onFinish: (i, face, f) => updPart(i, (p) => setPartFinish(p, face, f)),
    onContact: (i, mode) => { spec.mech3d.contacts[i] = { ...spec.mech3d.contacts[i], mode }; persist(); },
    onExit: () => { spec.mode = 'flat'; persist(); applyMode(); schedule(); },
  });
}
function updPart(i, fn) {
  spec.mech3d.parts[i] = fn(spec.mech3d.parts[i]);
  persist(); renderMech3d();
}
function importMech3d(file) {
  const st = $('#mech3d-status');
  $('#mech3d-wrap').hidden = false; $('#design-wrap').hidden = true; $('#results-wrap').hidden = true;
  st.textContent = `${file.name} 읽는 중…`;
  file.text().then((text) => {
    const w = new Worker(new URL('./engine/mech3d/mech3d-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (m) => {
      if (m.data.stage) { st.textContent = m.data.stage; return; }
      w.terminate();
      if (m.data.error) { st.textContent = `불러오기 실패: ${m.data.error}`; applyMode(); return; }
      setMech3dMesh(file.name, m.data.parts);
      spec.mech3d = initialMech3dSpec();
      spec.mode = 'mech3d';
      m3sel = null;
      saveMech3dIDB().catch(() => {});
      persist();
      st.textContent = `불러옴: ${file.name} · 부품 ${m.data.parts.length}개 · 접촉면 ${spec.mech3d.contacts.length}개 — Milky 부품부터 지정하세요`;
      applyMode(); renderMech3d(true);
    };
    w.onerror = (e) => { w.terminate(); st.textContent = `불러오기 실패: ${e.message ?? e}`; applyMode(); };
    w.postMessage({ text });
  });
}
```

(`materialDb` 는 main.js 가 이미 `./engine/l2/runtime.js` 에서 import 하고 있다.)

- [ ] **Step 5: 파일 입력 연결.** `$('#btn-step').onclick = ...` 블록 바로 위에 추가한다.

```js
  $('#file-mech3d').onchange = (e) => { const f = e.target.files?.[0]; if (f) importMech3d(f); e.target.value = ''; };
```

- [ ] **Step 6: migrate 보강.** `migrate` 의 `s.body.shape ??= ...` 줄 아래에 추가한다.

```js
  s.mode ??= 'flat';
  s.mech3d ??= null;
```

- [ ] **Step 7: 시작 시 복원.** L3 몸체 복원 `if (spec.body.shape.source === 'step' ...) { ... }` 블록 바로 아래에 추가한다.

```js
// 3D 기구 복원(IndexedDB) — 메쉬가 없으면 평판 모드로
if (spec.mode === 'mech3d' && !(spec.mech3d && await loadMech3dIDB())) { spec.mode = 'flat'; spec.mech3d = null; }
```

파일 끝의 `schedule();` 바로 앞에 `applyMode();` 를 추가한다.

- [ ] **Step 8: 단위 회귀**

Run: `npm test && npm run test:mech3d`
Expected: 모두 exit 0

- [ ] **Step 9: Commit**

```bash
git add index.html styles.css src/main.js
git commit -m "feat(mech3d): 3D mechanism mode UI — import, part materials, mode switch, restore"
```

---

### Task 12: 브라우저 검증 + push

**Files:** 없음 (검증만, 문제 발견 시 해당 파일 수정 후 재검증)

- [ ] **Step 1: 미리보기 실행.** `preview_start` 로 `uds-alt`(포트 5180)를 시작한다.

- [ ] **Step 2: 기본 상태 확인.** 첫 화면이 평판 모드(기존 화면)인지 확인한다. `#mech3d-wrap` 은 숨겨져 있어야 하고, 콘솔 오류는 0건이어야 한다.

- [ ] **Step 3: 샘플 불러오기.** `#file-mech3d` 에 `test/fixtures/mech3d-sample.stp` 를 넣는다. 파일 입력 자동화가 안 되면 `javascript_tool` 로 fetch → `File` → `importMech3d` 경로를 같은 방식으로 실행한다.
  기대:
  - 상태 줄에 "부품 4개 · 접촉면 7개"가 표시된다 (커버-하우징 4 + 도광-하우징 2 + 커버-도광 1, 원기둥 0). 7이 아니면 면 쌍 목록을 보고하고 판단한다.
  - 3D 뷰에 4개 부품이 보인다.

- [ ] **Step 4: 지정 확인.**
  1. 목록에서 "부품 2"(커버)를 선택해 Milky / Milky 3.0 으로 지정한다. 3D 뷰의 색이 바뀌는지 확인한다.
  2. 3D 뷰에서 하우징 안쪽 면을 클릭해 면 덮어쓰기를 흑색 5% 로 지정한다.
  3. 새로고침한다. 3D 기구 모드와 지정 내용(소재, 면 덮어쓰기)이 복원되는지 확인한다.

- [ ] **Step 5: 평판 모드 복귀.** "평판 모드로"를 눌러 기존 화면과 계산이 정상인지 확인한다. 콘솔 오류는 0건이어야 한다.

- [ ] **Step 6: 증거 스크린샷** (3D 뷰 + 패널) 을 사용자에게 보인다.

- [ ] **Step 7: 실행 로그 기록 후 push.** 이 계획 문서 끝에 "실행 로그"(결과 수치, 발견·수정 사항)를 추가한다.

```bash
git add docs/superpowers/plans/2026-10-14-mech3d-p1-import-materials.md
git commit -m "docs(plan): mech3d P1 execution log"
git push origin master
```

---

## 범위 밖 (P2 이후)
- 광학 계산(3D MC) — P2. P1 의 소재 값은 저장·표시만 한다.
- LED 정의·관측면 선택·라인 인식 — P3.
- 3D 기구 모드에서 평판 계산 워커는 그대로 돌지만 화면에 보이지 않는다(P2 에서 3D 계산으로 교체).
- STEP 제품명 읽기(XCAF) — 이름은 "부품 N(부피순)". 필요해지면 별도 작업.

---

## 실행 로그 (2026-10-14, 서브에이전트 방식)
- 커밋: 28b3468(로더) 9b2bcd9(mesh) 426c87f(BVH) 82f5639(소재) 14d01d0(접촉) 88c6037(곡면 접촉 보강) da215f4(STEP 부품, V3D-7) dc13f9f(런타임) efaecd5·7e5678c·7e54090(워커·뷰·패널) 5437c25(뷰·패널 보강) d105eb9·9ef285f(main 연결·보강) + 최종 정리.
- V3D-7: 하우징·커버·도광 바 0.000%, 원기둥 0.041% (≤0.5%). 접촉 면적 528/48/464mm² = 해석값.
- 검토로 고친 것: 곡면 접촉(분할 다른 원통 미검출 → chord 허용 0.02mm·B 삼각형 중심 거리·NDOT −0.97; 32/48분할 313.65/314.16), 투명 부품 depthWrite, 패널 누락값 가드·입력 범위, 3D 뷰 이중 생성, 기본값·JSON 불러오기 후 모드 동기화, 불러오기 실패 처리, 3D 모드에서 평판 계산 중지, "3D 기구 보기" 복귀 버튼.
- 브라우저 확인(uds-alt 5180): 평판 기본 → 샘플 불러오기(부품 4·접촉면 7) → Milky 3 지정·면 #1 흑색 덮어쓰기 → 새로고침 복원 → 평판 복귀(재계산)·3D 복귀, 콘솔 오류 0. 발견·수정: main 2열 그리드에 3D 섹션이 300px 로 갇힘(grid-column 1/-1), 소재 배지 글자색.
- 남은 경미 항목(P2 반영): BVH tMin·단위 방향·할당 재사용, 큰 모델 클릭 시 전체 재착색, 부품 이름(XCAF) 미지원. 범위 밖: 3D 모드에서 상단 입력바(평판용)는 그대로 보임 — P3 에서 정리.
