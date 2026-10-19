# P4 자동설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3D 기구 모드에서 체크한 항목(① Milky, ② LED 개수·피치, ③ LGP 형상)만 최적화하고, 현재안과 최적안을 비교한 뒤 적용·되돌리기·STEP 내보내기를 할 수 있게 한다.

**Architecture:** 엔진은 순수 모듈로 만들어 Node 에서 시험한다.
- ① 재가중: 광자마다 Milky 부품 안의 경로 길이 L 과 산란 횟수 k 를 기록하고, 한 번의 추적으로 Milky 격자 21점의 지도를 동시에 집계한다.
- ② 후보 응답 합산: LED 후보 위치(1mm 간격)별로 LED 1개의 지도를 추적해 두고, 개수·피치 조합의 지도는 이 지도들의 합으로 즉시 만든다.
- ③ 형상: 고른 부품을 관측 방향 기준으로 자유형 변형한다(윗면 고정, 아랫면을 두께 오프셋 Δt·LED 위 국부 형상 h·R 만큼). 후보 27개를 단계적 압축(27→6→2)으로 고른다.

모든 최종안은 일반 점진 계산으로 다시 판정한다. Worker 프로토콜은 기존 `scene`/`chunk` 를 확장한다(`chunk.rw`, `chunk.emitters`).

**Tech Stack:** 바닐라 JS ES 모듈(무빌드), Web Worker, three.js(기존 뷰), opencascade.js(STEP), Node 시험(`node test/*.mjs`, 의존성 없는 `ok/done` 도우미).

**선행 문서:** spec `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md`, CAD UI spec `2026-10-15-m3-cad-ui-design.md`.

**공통 규칙 (모든 작업)**
- 테스트 실행은 반드시 `< /dev/null` 로 stdin 을 닫는다. Git Bash 에서 stdin 이 열려 있으면 node 가 멈춘다.
- 주석·UI 문구는 한국어로, 주변 코드의 밀도와 관용구를 따른다.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 를 붙인다.
- 작업마다 커밋한다. push 는 단계(Phase) 끝에 한 번 한다.

---

## 파일 구조

| 파일 | 책임 | 새/수정 |
|---|---|---|
| `src/engine/mech3d/mc3d.js` | `track` 옵션: 광자별 지정 부품 안 경로 길이·산란 횟수 → `onEscape(…, p, tL, tK)` | 수정 |
| `src/engine/mech3d/reweight.js` | Milky 격자 광학값, 가중치 계수(lr, dm), 유효 표본 비율 | 새 |
| `src/engine/mech3d/tally.js` | `makeAccumulator(G, line, obs, rw)` — 격자별 지도·Σf·Σf² | 수정 |
| `src/engine/mech3d/job.js` | `runChunk({…, rw})` → `rw` 결과 동봉 | 수정 |
| `src/engine/mech3d/chunk-host.js` | `chunk.rw = { part, milkies }`, `chunk.emitters` 덮어쓰기 | 수정 |
| `src/engine/mech3d/milky-search.js` | 격자 지도 → 행(Milky, U, 효율, ESS) → 최소 Milky·가장 가까운 안 | 새 |
| `src/engine/mech3d/placement.js` | `ledAtS(line, s, opts, rt)` 분리(manualLeds 가 사용) | 수정 |
| `src/engine/mech3d/basis.js` | 후보 위치, 보간 합산, 개수·피치 탐색 | 새 |
| `src/engine/mech3d/shape-opt.js` | 관측 좌표계 높이맵, 국부 세분, 자유형 변형, 두께 점검, 후보 27개 | 새 |
| `src/engine/mech3d/runtime.js` | `applyPartXforms` 가 `shapeMod` 도 반영 | 수정 |
| `src/engine/mech3d/autodesign.js` | 단계 실행기(②→①→③), 점수, 단계적 압축, 결과 객체 — io 주입 | 새 |
| `src/export/mesh-step.js` · `src/export/mesh-step-worker.js` | 삼각형 메쉬 → STEP 솔리드 | 새 |
| `src/ui/m3/autodesign-run.js` | Worker 풀로 io 구현(장면·청크·검증) | 새 |
| `src/ui/m3/autodesign-panel.js` | 자동설계 카드, 진행, 비교, 적용·취소·되돌리기·STEP | 새 |
| `src/ui/m3/app.js` · `command-bar.js` · `styles.css` | 버튼·연결·점진 계산 일시정지 | 수정 |
| `test/mech3d-reweight.mjs` · `test/mech3d-basis.mjs` · `test/mech3d-shape-opt.mjs` · `test/mech3d-autodesign.mjs` · `test/mesh-step.mjs` | 시험 | 새 |

---

## Phase 0 — spec 보완

### Task 0: spec 수정(부호·저장 방식·메모리)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md`

- [ ] **Step 1: §2.3 변형식 부호 바로잡기.** 기존 `z_b' −= h · bump(r/R)` 는 "h + = 포켓" 과 반대다. 아래로 바꾼다.

```markdown
- 변형(관측면 반대쪽 = 아랫면만, 관측 좌표 z = 관측자 쪽 +):
  - 아랫면 이동량 D(x,y) = Δt − h · Σ_LED bump(|p − c|/R)  (D > 0 = 아랫면이 내려감 = 두꺼워짐)
  - z_b' = z_b − D. h > 0 = 포켓(LED 위가 얇아짐), h < 0 = 돌출.
  - 방법: 자유형 변형(FFD) — 정점 p 의 z' = z − w·D(x,y), w = (z_t − z)/(z_t − z_b) (윗면 w=0 고정, 아랫면 w=1).
    원본 메쉬를 LED 원판(반경 R) 부근만 모서리 기준으로 세분(이웃 삼각형과 어긋남 없음)해 곡면을 표현한다.
```

- [ ] **Step 2: §2.3 끝에 저장 방식 추가.**

```markdown
- 적용 저장: `spec.mech3d.parts[i].shapeMod = { frame:{u,v,d}, dt, h, R, centers:[[x,y]…], cell }`.
  런타임은 원본 메쉬 → xform → shapeMod 순서로 다시 만든다(되돌리기 = shapeMod 삭제).
```

- [ ] **Step 3: §2.2 비용 줄 아래에 메모리 규칙 추가.**

```markdown
- 메모리: 후보 지도는 Float32 로 보관한다. ① 이 켜져 있으면 후보마다 Milky 격자 지도를 함께 보관한다(배치 없이 합계만 — 노이즈는 최종 재판정이 맡는다).
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-10-19-p4-autodesign-design.md
git commit -m "docs(spec): P4 — pocket sign, FFD deformation, shapeMod storage, basis memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase A — ① Milky 재가중

### Task 1: mc3d 경로 추적(`track`)

**Files:**
- Modify: `src/engine/mech3d/mc3d.js` (options line 44, photon start ~line 97, step ~line 108–110, escape line 105)
- Test: `test/mech3d-reweight.mjs` (new)

- [ ] **Step 1: 실패하는 시험 작성** — `test/mech3d-reweight.mjs`

```js
// ① Milky 재가중: node test/mech3d-reweight.mjs
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable();
const part = (i, kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(i, `p${i}`, 1), kind));
const scene = (meshes, parts) => { setMech3dMesh('t', meshes); return buildTraceScene(getMech3d(), { name: 't', parts, contacts: [] }, { table }); };
const beam = { flux: 1, sample: (r) => [4.5 + r(), 4.5 + r(), -1, 0, 0, 1] };

{ // 투명 판(두께 2) 수직 통과: 직진 탈출 광자의 L = 2, k = 0
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'clear', { T: 0.99 })]);
  let bad = 0, n = 0;
  runMC3D(S, { source: beam, N: 2000, seed: 3, track: 0, onEscape: (x, y, z, dx, dy, dz, w, p, tL, tK) => { if (dz > 0.999) { n++; if (Math.abs(((tL - 2) % 4)) > 1e-9 || tK !== 0) bad++;   // 내부 Fresnel 왕복 m 회 → L = 2 + 4m } } });
  ok(n > 1500 && bad === 0, `투명 판 직진: L=2+4m·k=0 (${n}개, 불일치 ${bad})`);
}
{ // Milky 판: 산란은 μs 포아송 과정 → E[k] = μs·E[L]
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'milky', { milky: 3 })]);
  let sk = 0, sL = 0;
  runMC3D(S, { source: beam, N: 20000, seed: 5, track: 0, onEscape: (x, y, z, dx, dy, dz, w, p, tL, tK) => { sk += tK; sL += tL; } });
  const mus = S.optics[0].mus, r = sk / (mus * sL);
  ok(Math.abs(r - 1) < 0.03, `Milky 3: Σk / (μs·ΣL) = ${r.toFixed(4)} (≈1)`);
}
{ // track 을 주지 않으면 tL·tK 는 undefined, 결과(ledger)는 track 과 비트 동일
  const S = scene([boxMesh(0, 0, 0, 10, 10, 2)], [part(0, 'milky', { milky: 3 })]);
  let undef = true;
  const a = runMC3D(S, { source: beam, N: 3000, seed: 9, onEscape: (...g) => { if (g[8] !== undefined) undef = false; } });
  const b = runMC3D(S, { source: beam, N: 3000, seed: 9, track: 0 });
  ok(undef && JSON.stringify(a.ledger) === JSON.stringify(b.ledger), 'track 없음 = 기존 동작, 같은 시드면 ledger 동일');
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null`
Expected: FAIL (첫 시험 — tL 이 undefined)

- [ ] **Step 3: 구현** — `src/engine/mech3d/mc3d.js`

머리 주석 `(onExit/onEscape 마지막 인자 p = 광자 번호)` 아래에 한 줄 추가:

```js
// track = 부품 번호(기본 −1 = 끔): 광자가 그 부품을 현재 매질로 지난 경로 길이 tL·체적 산란 횟수 tK 를 세어 onEscape(…, p, tL, tK) 로 넘김(P4 Milky 재가중)
```

옵션 서명:

```js
export function runMC3D(S, { source, N, seed = 1, onExit = null, onEscape = null, wMinRel = 1e-3, maxEvents = 100000, track = -1 }) {
```

광자 시작부(`let lastTri = -1, lastTri2 = -1;` 다음 줄):

```js
    let tL = 0, tK = 0;   // track 부품 안 경로 길이·산란 횟수
```

탈출 줄(현재 `L.escaped += w; if (onEscape) onEscape(px, py, pz, dx, dy, dz, w, p); break;`):

```js
        L.escaped += w; if (onEscape) { if (track >= 0) onEscape(px, py, pz, dx, dy, dz, w, p, tL, tK); else onEscape(px, py, pz, dx, dy, dz, w, p); } break;
```

이동 직후(`px += t * dx; py += t * dy; pz += t * dz;` 다음 줄):

```js
      if (cur === track && track >= 0) { tL += t; if (!h) tK++; }   // 매질 안 이동(체적 산란으로 끝나면 산란 1회)
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null && npm run -s test:mech3d-mc < /dev/null`
Expected: `all PASS` (기존 MC 시험 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/mc3d.js test/mech3d-reweight.mjs
git commit -m "feat(mech3d): MC track option — per-photon path length and scatter count in one part

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 재가중 계수(`reweight.js`)

**Files:**
- Create: `src/engine/mech3d/reweight.js`
- Test: `test/mech3d-reweight.mjs` (append)

- [ ] **Step 1: 실패하는 시험 추가** — `done();` 앞에

```js
import { milkyGridOptics, rwCoeffs, rwFactor, essRatio, milkyAxis } from '../src/engine/mech3d/reweight.js';
{ const p = part(0, 'milky', { milky: 3 }), ms = milkyAxis(3, 0.25, 9.9), G = milkyGridOptics(p, { table }, ms);
  ok(ms.length === 21 && ms[0] === 0.5 && ms[20] === 5.5 && ms.every((m, i) => !i || Math.abs(m - ms[i - 1] - 0.25) < 1e-9), `Milky 축: 기준 3 주변 21점 0.25 간격 (${ms[0]}~${ms[20]})`);
  ok(milkyAxis(1, 0.25, 9.9)[0] === 0.25 && milkyAxis(9, 0.25, 9.9).at(-1) === 9.9, 'Milky 축: 0.25 미만·9.9 초과는 잘라 범위 안으로 밀기');
  const base = G[ms.indexOf(3)], C = rwCoeffs(base, G);
  ok(Math.abs(rwFactor(C, ms.indexOf(3), 2.7, 13) - 1) < 1e-12 && G.every((g) => g.g === base.g), '기준점 가중치 = 1 · g 고정');
  const j = ms.indexOf(4), f = rwFactor(C, j, 2, 5), want = (G[j].mus / base.mus) ** 5 * Math.exp(-((G[j].mus + G[j].mua) - (base.mus + base.mua)) * 2);
  ok(Math.abs(f / want - 1) < 1e-12, `가중치 식 f = (μs'/μs)^k·e^{−Δμt·L}: ${f.toExponential(4)}`);
  const e = essRatio(new Float64Array([10, 10]), new Float64Array([10, 50]), 10);
  ok(Math.abs(e[0] - 1) < 1e-12 && Math.abs(e[1] - 0.2) < 1e-12, 'ESS 비율 = (Σf)²/(n·Σf²)');
  let thrown = ''; try { rwCoeffs({ mus: 0, mua: 0, g: 0.9 }, G); } catch (er) { thrown = er.message; }
  ok(/기준 Milky/.test(thrown), '기준 μs = 0 이면 재가중 불가 — 오류'); }
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null`
Expected: FAIL — `Cannot find module …/reweight.js`

- [ ] **Step 3: 구현** — `src/engine/mech3d/reweight.js`

```js
// ① Milky 재가중 — spec 2026-10-19 P4 §2.1. 기준 Milky m₀ 에서 추적한 광자를 다른 Milky m 의 기댓값으로 바꾸는 가중치.
// Milky = 입자 농도: 위상함수·g 고정, μs·μa 만 바뀐다(partOptics 규칙). 자유 비행은 μs 로 표본(mc3d), 흡수는 연속 가중 e^{−μa·t}.
// 그래서 경로 길이 L·산란 횟수 k 인 광자의 우도비 = (μs/μs₀)^k · e^{−(μs−μs₀)L} · e^{−(μa−μa₀)L}.
import { partOptics } from './optics.js';
import { MILKY_UI_MAX } from '../l2/material.js';

// 기준 m0 주변 n 점(간격 step). 범위 [step, MILKY_UI_MAX] 를 넘으면 창 전체를 안쪽으로 민다(점 수 유지)
export function milkyAxis(m0, step = 0.025, max = MILKY_UI_MAX, n = 21) {   // 기본 창 = 기준 ±0.25(ESS 한계, spec §2.1)
  const half = ((n - 1) / 2) * step;
  let lo = m0 - half;
  if (lo < step) lo = step;
  if (lo + 2 * half > max) lo = Math.max(step, max - 2 * half);
  return Array.from({ length: n }, (_, i) => Math.min(max, Math.round((lo + i * step) * 1e6) / 1e6));
}

// 부품(spec.mech3d.parts[i]) 의 Milky 를 바꿔 가며 광학값 — [{ milky, mus, mua, g }]
export function milkyGridOptics(part, { table, db = null }, milkies) {
  return milkies.map((m) => {
    const o = partOptics({ ...part, material: { ...part.material, milky: m } }, { table, db });
    return { milky: m, mus: o.mus, mua: o.mua, g: o.g };
  });
}

// 기준 광학값 base({mus, mua, g}) 와 격자 → 계수 { lr: ln(μs/μs₀), dm: Δ(μs+μa) }
export function rwCoeffs(base, grid) {
  if (!(base.mus > 0)) throw new Error('기준 Milky 의 μs 가 0 — 재가중은 Milky > 0 에서 시작해야 함');
  if (grid.some((g) => Math.abs(g.g - base.g) > 1e-9)) throw new Error('격자의 g 가 기준과 다름 — 재가중 불가');
  const n = grid.length, lr = new Float64Array(n), dm = new Float64Array(n);
  grid.forEach((g, j) => { lr[j] = Math.log(g.mus / base.mus); dm[j] = g.mus + g.mua - (base.mus + base.mua); });
  return { n, lr, dm };
}
export const rwFactor = (C, j, L, k) => Math.exp(k * C.lr[j] - C.dm[j] * L);

// 유효 표본 비율 = (Σf)² / (n·Σf²) — 0.3 미만 격자점은 믿지 않음(spec §2.1)
export function essRatio(sf, sf2, n) {
  const out = new Float64Array(sf.length);
  for (let j = 0; j < sf.length; j++) out[j] = n > 0 && sf2[j] > 0 ? (sf[j] * sf[j]) / (n * sf2[j]) : 0;
  return out;
}
export const ESS_MIN = 0.3;
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null`
Expected: `all PASS`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/reweight.js test/mech3d-reweight.mjs
git commit -m "feat(mech3d): Milky reweighting coefficients, axis and ESS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: 집계기·청크에 재가중 지도 추가 + A-1 검증

**Files:**
- Modify: `src/engine/mech3d/tally.js:34-60` (`makeAccumulator`)
- Modify: `src/engine/mech3d/job.js:42-57` (`runChunk`)
- Test: `test/mech3d-reweight.mjs` (append)

> **실행 중 개정(커밋 3a4e812):** 이 장면은 Milky 1 차이에 μs 가 약 2.2배라 ±1 재가중은 ESS ≈ 0 이다. A-1 은 기준 3 ±0.2(2.8·3.2), `milkyAxis(3, 0.025)`, 배치 12개, 판정 = ESS ≥ 0.3 · 총광량 z < 3 · 길이 프로파일 행 최대 z < 4 · |ΔU| ≤ 0.03 으로 바꿨다. 아래 원안 코드는 기록용.

- [ ] **Step 1: 실패하는 시험 추가** (A-1: 재가중 지도 vs 그 Milky 직접 계산). `test/m3-fixture.mjs` 의 `plateFixture` 를 쓴다(Milky 3 판 + LED 5개).

```js
import { plateFixture } from './m3-fixture.mjs';
import { composeScene, runChunk } from '../src/engine/mech3d/job.js';
import { tallyStats } from '../src/engine/mech3d/tally.js';
{ const F = plateFixture(table), ms = milkyAxis(3), base = F.S.optics[0];
  const grid = milkyGridOptics(F.mspec.parts[0], { table }, ms), C = rwCoeffs(base, grid), nCell = F.G.ns * F.G.nw;
  const B = 8, rwAccs = Array.from({ length: grid.length }, () => []);
  let n = 0; const sf = new Float64Array(grid.length), sf2 = new Float64Array(grid.length);
  for (let b = 0; b < B; b++) {
    const r = runChunk({ ...F, N: 25000, seed: 100 + b, rw: { part: 0, C } });
    for (let j = 0; j < grid.length; j++) rwAccs[j].push(r.rw.acc.slice(j * nCell, (j + 1) * nCell));
    n += r.rw.n; for (let j = 0; j < grid.length; j++) { sf[j] += r.rw.sf[j]; sf2[j] += r.rw.sf2[j]; }
    if (b === 0) ok(r.rw.acc.subarray(ms.indexOf(3) * nCell, (ms.indexOf(3) + 1) * nCell).every((v, k) => Math.abs(v - r.acc[k]) <= 1e-12 * Math.max(1, r.acc[k])), '기준 Milky 격자 지도 = 일반 집계');
  }
  const ess = essRatio(sf, sf2, n);
  for (const m of [2, 4]) {   // Milky ±1 (A-1)
    const j = ms.indexOf(m), pm = { ...F.mspec, parts: [setPartMaterialParam(F.mspec.parts[0], 'milky', m)] };
    const S2 = composeScene({ rt: F.rt, mspec: pm, ledParts: null, table, db: null, line: F.line });
    const dir = Array.from({ length: B }, (_, b) => runChunk({ ...F, S: S2, N: 25000, seed: 900 + b }).acc);
    const a = tallyStats(F.G, rwAccs[j], F.obs), d = tallyStats(F.G, dir, F.obs);
    let worst = 0, cnt = 0;
    for (let k = 0; k < nCell; k++) {
      if (!F.G.valid[k] || !(d.map[k] > 0)) continue;
      const va = rwAccs[j].map((x) => x[k] / F.G.area[k]), vd = dir.map((x) => x[k] / F.G.area[k]);
      const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, se = (v) => Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1) / v.length);
      const z = Math.abs(mean(va) - mean(vd)) / Math.hypot(se(va), se(vd)); worst = Math.max(worst, z); cnt++;
    }
    ok(ess[j] >= 0.3 && Math.abs(a.Ulen - d.Ulen) <= 0.02, `A-1 Milky ${m}: ESS ${ess[j].toFixed(2)} · U 재가중 ${a.Ulen.toFixed(3)} vs 직접 ${d.Ulen.toFixed(3)}`);
    ok(worst < 4.5, `A-1 Milky ${m}: 셀 평균 차 최대 ${worst.toFixed(2)}σ (셀 ${cnt}개 — 다중 비교라 4.5σ)`);
  } }
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null`
Expected: FAIL — `r.rw` undefined

- [ ] **Step 3: 구현 — 집계기.** `src/engine/mech3d/tally.js` 의 `makeAccumulator` 를 아래로 바꾼다(기존 동작은 `rw` 없을 때 그대로).

```js
// rw = { C: rwCoeffs 결과 } | null — 있으면 관측 셀에 집계되는 탈출마다 Milky 격자 j 별 가중 w·f_j 도 더한다(acc 와 같은 셀 배열을 격자 수만큼 이어 붙임)
export function makeAccumulator(G, line, obs, rw = null) {
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), d = obs.dir ?? line.frame.d, cosC = Math.cos(((obs.cone ?? 10) * Math.PI) / 180);
  const R = G.pix, nCell = G.ns * G.nw, acc = new Float64Array(nCell), cnt = new Uint32Array(nCell);
  const C = rw?.C ?? null, nJ = C ? C.n : 0, racc = C ? new Float64Array(nJ * nCell) : null, sf = C ? new Float64Array(nJ) : null, sf2 = C ? new Float64Array(nJ) : null;
  let lx = 0, ly = 0, lz = 0, has = false, lp = -1, nRw = 0;
  return {
    acc, cnt,
    get rw() { return C ? { acc: racc, sf, sf2, n: nRw } : null; },
    // p = 광자 번호(runMC3D 가 마지막 인자로 전달). 탈출 광자가 마지막 출사 광자와 같을 때만 집계 — 흡수·소실된 광자의 낡은 출사점을 쓰지 않는다.
    onExit(part, face, x, y, z, dx, dy, dz, w, p) { has = faces.has(`${part}|${face}`); lx = x; ly = y; lz = z; lp = p; },
    onEscape(x, y, z, dx, dy, dz, w, p, tL = 0, tK = 0) {
      if (!has || lp !== p) return;
      has = false;
      if (dx * d[0] + dy * d[1] + dz * d[2] < cosC) return;
      // 점을 래스터 픽셀 중심으로 맞춘 뒤 분류 — 면적(area)을 픽셀 단위로 센 것과 같은 이산화라서 편향이 없다.
      const [qx, qy] = line.to2D([lx, ly, lz]), pi = Math.floor((qx - R.x0) / R.cell), pj = Math.floor((qy - R.y0) / R.cell);
      if (pi < 0 || pj < 0 || pi >= R.nx || pj >= R.ny || !G.pixOk[pj * R.nx + pi]) return;   // 면적(area)과 같은 규칙 — 마스크 밖·제외 구역 광자는 세지 않음
      const [s, ww] = line.toSW(R.x0 + (pi + 0.5) * R.cell, R.y0 + (pj + 0.5) * R.cell);
      let i = Math.floor(s / G.ds);
      if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return;
      const j = Math.floor((ww - G.w0) / G.cell);
      if (j < 0 || j >= G.nw) return;
      const k = i * G.nw + j;
      acc[k] += w; cnt[k]++;
      if (C) {
        nRw++;
        for (let g = 0; g < nJ; g++) { const f = Math.exp(tK * C.lr[g] - C.dm[g] * tL); racc[g * nCell + k] += w * f; sf[g] += f; sf2[g] += f * f; }
      }
    },
  };
}
```

- [ ] **Step 4: 구현 — 청크.** `src/engine/mech3d/job.js` 의 `runChunk` 를 바꾼다.

```js
// rw = { part, C } | null — 있으면 Milky 부품 경로를 추적(track)해 격자별 지도(rw.acc: 격자 수 × 셀)·Σf·Σf²·n 을 함께 돌려준다(spec P4 §2.1)
export function runChunk({ S, line, obs, G, emitters, ledSpec, N, seed, rw = null }) {
  const src = ledSources(emitters, ledSpec), a = makeAccumulator(G, line, obs, rw ? { C: rw.C } : null);
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), leak = {};
  let lastPart = -1, lastFace = -1, lastP = -1, escObs = 0;
  const r = runMC3D(S, {
    source: src, N, seed, track: rw ? rw.part : -1,
    onExit(part, face, x, y, z, dx, dy, dz, w, p) { a.onExit(part, face, x, y, z, dx, dy, dz, w, p); lastPart = part; lastFace = face; lastP = p; },
    onEscape(x, y, z, dx, dy, dz, w, p, tL, tK) {
      a.onEscape(x, y, z, dx, dy, dz, w, p, tL, tK);
      const k = lastP === p ? `${lastPart}|${lastFace}` : '-1|-1';
      if (faces.has(k)) escObs += w; else leak[k] = (leak[k] ?? 0) + w;
    },
  });
  return { acc: a.acc, cnt: a.cnt, ledger: r.ledger, leak, escObs, ms: r.ms, rw: a.rw };
}
```

- [ ] **Step 5: 통과 확인 + 회귀**

Run: `node test/mech3d-reweight.mjs < /dev/null && npm run -s test:m3 < /dev/null && npm run -s test:mech3d-mc < /dev/null`
Expected: `all PASS` (mech3d-chunk 의 "청크 누적 = 일괄 비트 일치" 포함)

- [ ] **Step 6: 커밋**

```bash
git add src/engine/mech3d/tally.js src/engine/mech3d/job.js test/mech3d-reweight.mjs
git commit -m "feat(mech3d): reweighted Milky-grid maps in accumulator/chunk; A-1 check vs direct MC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Worker 청크 확장(`rw`, `emitters`)

**Files:**
- Modify: `src/engine/mech3d/chunk-host.js`
- Modify: `src/engine/mech3d/mc3d-worker.js` (머리 주석만)
- Test: `test/mech3d-chunk.mjs` (append before `done()`)

- [ ] **Step 1: 실패하는 시험 추가**

```js
{ // P4: chunk.rw = { part, milkies } → 격자 지도 동봉, chunk.emitters = 발광점 덮어쓰기(후보 위치 LED 1개)
  const F = plateFixture(table), host = makeChunkHost({ getTable: () => table });
  host.handle({ type: 'scene', sceneKey: 'p4', mechParts: [F.plate], mspec: F.mspec, ledParts: null, lineData: lightData(F.line), G: F.G, obs: F.obs, emitters: F.emitters });
  const r = host.handle({ type: 'chunk', sceneKey: 'p4', seed: 7, N: 3000, rw: { part: 0, milkies: [2.5, 3, 3.5] } }).reply;
  const nCell = F.G.ns * F.G.nw;
  ok(r.rw && r.rw.acc.length === 3 * nCell && r.rw.sf.length === 3 && r.rw.n > 0 && r.rw.milkies.join() === '2.5,3,3.5', '청크 rw: 격자 3점 지도·Σf·n');
  const one = host.handle({ type: 'chunk', sceneKey: 'p4', seed: 7, N: 3000, emitters: [F.emitters[2]] }).reply;
  const all = host.handle({ type: 'chunk', sceneKey: 'p4', seed: 7, N: 3000 }).reply;
  const mid = (a) => { let s = 0; for (let i = Math.floor(F.G.ns * 0.45); i < Math.ceil(F.G.ns * 0.55); i++) for (let j = 0; j < F.G.nw; j++) s += a[i * F.G.nw + j]; return s; };
  ok(one.acc.some((v) => v > 0) && Math.abs(all.ledger.emitted / one.ledger.emitted - 5) < 1e-9 && mid(one.acc) / one.ledger.emitted > mid(all.acc) / all.ledger.emitted, 'chunk.emitters: 가운데 LED 1개만 — 방출 = LED 1개 몫(combineSources 는 광속 합), 가운데에 몰림');
}
```

(파일 머리에서 `plateFixture`·`lightData` 를 이미 쓰지 않으면 import 를 추가한다: `import { plateFixture } from './m3-fixture.mjs';`, `import { lightData } from '../src/engine/mech3d/line.js';`)

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-chunk.mjs < /dev/null`
Expected: FAIL — `r.rw` undefined

- [ ] **Step 3: 구현** — `src/engine/mech3d/chunk-host.js`

import 에 추가:

```js
import { milkyGridOptics, rwCoeffs } from './reweight.js';
```

`cache = {…}` 줄에 `mspec: m.mspec` 를 넣는다:

```js
          cache = { sceneKey: m.sceneKey, S, line, G: m.G, obs: m.obs, emitters: m.emitters, ledSpec: m.mspec.light.spec, mspec: m.mspec };
```

`chunk` 처리를 바꾼다:

```js
      if (m.type === 'chunk') {
        if (!cache || cache.sceneKey !== m.sceneKey) return { reply: { sceneKey: m.sceneKey, stale: true }, transfer: [] };
        const { S, line, obs, G, ledSpec } = cache, emitters = m.emitters ?? cache.emitters;   // P4 ②: 후보 위치 LED 만
        let rw = null;
        if (m.rw) {   // P4 ①: 기준 = 장면의 그 부품 광학값, 격자 = 같은 부품의 Milky 만 바꾼 값
          const grid = milkyGridOptics(cache.mspec.parts[m.rw.part], { table: getTable(), db: getDb() }, m.rw.milkies);
          rw = { part: m.rw.part, C: rwCoeffs(S.optics[m.rw.part], grid) };
        }
        const r = runChunk({ S, line, obs, G, emitters, ledSpec, N: m.N, seed: m.seed, rw });
        const reply = { sceneKey: m.sceneKey, acc: r.acc, cnt: r.cnt, ledger: r.ledger, leak: r.leak, escObs: r.escObs, ms: r.ms };
        const transfer = [r.acc.buffer, r.cnt.buffer];
        if (r.rw) { reply.rw = { ...r.rw, milkies: m.rw.milkies }; transfer.push(r.rw.acc.buffer); }
        return { reply, transfer };
      }
```

`src/engine/mech3d/mc3d-worker.js` 머리 주석의 chunk 줄을 바꾼다:

```js
//   { type:'chunk', id, sceneKey, seed, N, rw?:{part, milkies}, emitters? } → { id, sceneKey, acc, cnt, ledger, leak, escObs, ms, rw?:{acc, sf, sf2, n, milkies} } | { id, sceneKey, stale:true }
```

- [ ] **Step 4: 통과 확인**

Run: `npm run -s test:m3 < /dev/null`
Expected: `all PASS`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/chunk-host.js src/engine/mech3d/mc3d-worker.js test/mech3d-chunk.mjs
git commit -m "feat(mech3d): chunk protocol — rw (Milky grid) and per-chunk emitter override

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Milky 탐색(`milky-search.js`)

**Files:**
- Create: `src/engine/mech3d/milky-search.js`
- Test: `test/mech3d-reweight.mjs` (append)

- [ ] **Step 1: 실패하는 시험 추가** — 합성 지도로 탐색 규칙만 시험한다.

```js
import { milkyRows, pickMilky, margin } from '../src/engine/mech3d/milky-search.js';
{ // 합성: 셀 1행(길이 10칸 × 폭 1칸), Milky 가 클수록 리플이 줄고 효율이 준다
  const G = { ns: 10, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 10, closed: false, winS: 5, area: new Float64Array(10).fill(1), valid: new Uint8Array(10).fill(1) };
  const obs = { targetLen: 0.8, targetWid: 0.5 };
  const ms = [1, 2, 3, 4, 5], amp = (m) => 0.5 / m, eff = (m) => 1 - 0.05 * m;
  const mk = (m) => Float64Array.from({ length: 10 }, (_, i) => eff(m) * (1 + amp(m) * Math.cos(i)));
  const batches = Array.from({ length: 4 }, () => { const a = new Float64Array(5 * 10); ms.forEach((m, j) => a.set(mk(m), j * 10)); return a; });
  const rows = milkyRows(G, obs, { milkies: ms, batches, ess: new Float64Array([1, 1, 1, 1, 0.1]), emitted: 10 });
  ok(rows.length === 5 && rows[4].trusted === false && rows[0].trusted, '행: ESS 0.1 은 믿지 않음');
  // U = (1−a)/(1+a) ≥ 0.8 ⇔ a ≤ 1/9 ⇔ m ≥ 4.5 → 믿는 행 중 통과 없음 → 가장 가까운 안 = Milky 4
  const p = pickMilky(rows, obs);
  ok(!p.feasible && p.best.milky === 4 && /Milky 4/.test(p.reason), `통과 없음 → 가장 가까운 안 Milky 4: ${p.reason}`);
  const obs2 = { targetLen: 0.6, targetWid: 0.5 };   // a ≤ 0.25 ⇔ m ≥ 2 → 보간 경계: m=1 (U 0.333) 과 m=2 (U 0.6) 사이 → 2
  const p2 = pickMilky(milkyRows(G, obs2, { milkies: ms, batches, ess: new Float64Array(5).fill(1), emitted: 10 }), obs2);
  ok(p2.feasible && Math.abs(p2.milky - 2) < 0.02 && p2.edge === null, `최소 Milky ≈ 2: ${p2.milky}`);
  const p3 = pickMilky(milkyRows(G, { targetLen: 0.2, targetWid: 0.1 }, { milkies: ms, batches, ess: new Float64Array(5).fill(1), emitted: 10 }), { targetLen: 0.2, targetWid: 0.1 });
  ok(p3.feasible && p3.milky === 1 && p3.edge === 'low', '창 맨 아래도 통과 → 더 낮은 쪽으로 기준 이동 신호(edge=low)');
  ok(margin({ Ulen: 0.7, Uwid: null }, obs) === 0.7 - 0.8, '폭 판정 없음(좁은 라인) → 길이만'); }
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/mech3d/milky-search.js`

```js
// ① Milky 탐색 — spec P4 §2.1. 재가중 격자 지도(배치별) → 행 → 목표를 만족하는 최소 Milky(선형 보간).
import { tallyStats } from './tally.js';
import { ESS_MIN } from './reweight.js';

// 목표 여유: min(U길이 − 목표, U폭 − 목표). 폭 판정이 없으면(좁은 라인) 길이만
export const margin = (st, obs) => Math.min(st.Ulen - obs.targetLen, st.Uwid == null ? Infinity : st.Uwid - obs.targetWid);

// batches: 배치별 Float64Array(격자 수 × 셀), ess: 격자별 유효 표본 비율, emitted: 방출 총량(효율 분모)
// 반환 [{ milky, Ulen, Uwid, eff, ess, trusted, margin, map }]
export function milkyRows(G, obs, { milkies, batches, ess, emitted }) {
  const nCell = G.ns * G.nw;
  return milkies.map((m, j) => {
    const accs = batches.map((a) => a.subarray(j * nCell, (j + 1) * nCell));
    const st = tallyStats(G, accs, obs);
    let tot = 0; for (const a of accs) for (let k = 0; k < nCell; k++) tot += a[k];
    return { milky: m, Ulen: st.Ulen, Uwid: st.Uwid, eff: emitted > 0 ? tot / emitted : NaN, ess: ess[j], trusted: ess[j] >= ESS_MIN && !st.empty, margin: st.empty ? -Infinity : margin(st, obs), map: st.map, profile: st.profile };
  });
}

// 믿는 행에서 여유가 처음 0 이상이 되는 Milky(앞 행과 선형 보간). edge: 'low'(창 맨 아래부터 통과 — 더 낮게 볼 것) | 'high'(통과 없음 & 위로 여지) | null
export function pickMilky(rows, obs) {
  const R = rows.filter((r) => r.trusted);
  if (!R.length) return { feasible: false, best: null, milky: null, edge: null, reason: '믿을 수 있는 격자점이 없음 — 광자를 늘리세요' };
  const i = R.findIndex((r) => r.margin >= 0);
  if (i < 0) {
    const best = R.reduce((a, b) => (b.margin > a.margin ? b : a));
    return { feasible: false, best, milky: best.milky, edge: 'high', reason: `Milky ${best.milky}에서도 길이 U ${best.Ulen.toFixed(2)}${best.Uwid == null ? '' : ` · 폭 U ${best.Uwid.toFixed(2)}`} — 목표 ${obs.targetLen.toFixed(2)}${best.Uwid == null ? '' : ` / ${obs.targetWid.toFixed(2)}`} 미달` };
  }
  if (i === 0) return { feasible: true, best: R[0], milky: R[0].milky, edge: 'low', reason: '' };
  const a = R[i - 1], b = R[i], t = a.margin === b.margin ? 1 : -a.margin / (b.margin - a.margin);
  return { feasible: true, best: b, milky: Math.round((a.milky + t * (b.milky - a.milky)) * 100) / 100, edge: null, reason: '' };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-reweight.mjs < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋 + push (Phase A 끝)**

```bash
git add src/engine/mech3d/milky-search.js test/mech3d-reweight.mjs package.json
git commit -m "feat(mech3d): Milky search over reweighted grid (min Milky, nearest design, edge signal)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

(같은 커밋에서 `package.json` 의 `test:mech3d-mc` 끝에 ` && node test/mech3d-reweight.mjs` 를 덧붙인다.)

---

## Phase B — ② LED 개수·피치

### Task 6: `ledAtS` 분리

**Files:**
- Modify: `src/engine/mech3d/placement.js:18-44`
- Test: `test/mech3d-place.mjs` (append)

- [ ] **Step 1: 실패하는 시험 추가**

```js
import { ledAtS } from '../src/engine/mech3d/placement.js';
{ const em = manualLeds(strip, { count: 3, pitch: 0, side: 'direct', pcb: { kind: 'depth', depth: 4 } });
  const one = ledAtS(strip, em[1].s, { side: 'direct', pcb: { kind: 'depth', depth: 4 } });
  ok(JSON.stringify(one) === JSON.stringify(em[1]), 'ledAtS(s) = manualLeds 의 같은 s 결과'); }
```

(`strip` 은 이 파일 10번째 줄에서 만든 직선 라인이다.)

- [ ] **Step 2: 실패 확인** — `node test/mech3d-place.mjs < /dev/null` → FAIL (`ledAtS` 없음)

- [ ] **Step 3: 구현** — `manualLeds` 루프 몸통을 함수로 뺀다.

```js
// 라인 위 s 한 곳의 LED — manualLeds 와 P4 ② 후보 위치가 같이 씀. 반환 { s, pos, axis, xAxis }
export function ledAtS(line, s, { side = 'direct', pcb }, rt = null) {
  const F = line.frame;
  const [x, y] = line.fromSW(s, 0), [tx, ty] = line.tangentAt(s);
  let pos, hitN = null;
  if (pcb.kind === 'depth') pos = line.to3D(x, y, -pcb.depth);
  else {
    const top = line.to3D(x, y, 1e4), m = rt?.parts?.[pcb.part];
    if (!m) throw new Error('PCB 면 부품을 찾을 수 없음');
    const h = intersectRay(m.bvh, top[0], top[1], top[2], -F.d[0], -F.d[1], -F.d[2], 0, Infinity);
    if (!h || m.faceIds[h.tri] !== pcb.face) throw new Error(`s=${s.toFixed(1)}mm 아래에 선택한 PCB 면이 없음`);
    const a = m.triangles[3 * h.tri] * 3, b = m.triangles[3 * h.tri + 1] * 3, c = m.triangles[3 * h.tri + 2] * 3, P = m.positions;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    hitN = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...hitN) || 1, sg = hitN[0] * F.d[0] + hitN[1] * F.d[1] + hitN[2] * F.d[2] < 0 ? -1 : 1;
    hitN = hitN.map((v) => (sg * v) / nl);
    pos = [top[0] - h.t * F.d[0], top[1] - h.t * F.d[1], top[2] - h.t * F.d[2]];
  }
  const T3 = [tx * F.u[0] + ty * F.v[0], tx * F.u[1] + ty * F.v[1], tx * F.u[2] + ty * F.v[2]];
  const left = [F.d[1] * T3[2] - F.d[2] * T3[1], F.d[2] * T3[0] - F.d[0] * T3[2], F.d[0] * T3[1] - F.d[1] * T3[0]];
  const axis = side === 'left' ? left : side === 'right' ? left.map((v) => -v) : hitN ?? F.d.slice();
  return { s, pos, axis, xAxis: T3 };
}

export function manualLeds(line, { count, pitch = 0, side = 'direct', pcb }, rt = null) {
  if (pcb.kind === 'depth' && !(pcb.depth > 0)) throw new Error('PCB 깊이는 0 보다 커야 함');
  return ledSPositions(line, count, pitch).map((s) => ledAtS(line, s, { side, pcb }, rt));
}
```

- [ ] **Step 4: 통과 확인** — `npm run -s test:mech3d < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/placement.js test/mech3d-place.mjs
git commit -m "refactor(mech3d): ledAtS — single LED at line position (shared by manual placement and P4 basis)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: 후보 응답 합산·개수 탐색(`basis.js`) + A-3

**Files:**
- Create: `src/engine/mech3d/basis.js`
- Test: `test/mech3d-basis.mjs` (new)

- [ ] **Step 1: 실패하는 시험 작성** — `test/mech3d-basis.mjs`

```js
// ② LED 개수·피치(후보 응답 합산): node test/mech3d-basis.mjs
import { candidatePositions, interpWeights, layoutMap, searchLeds, pitchOptions } from '../src/engine/mech3d/basis.js';
import { ok, done } from './mech3d-util.mjs';

const line = { length: 100, closed: false };
{ const c = candidatePositions(line, 1);
  ok(c.length === 101 && c[0] === 0 && c[100] === 100, '열린 라인 후보: 0~L 1mm 간격, 양 끝 포함');
  const cc = candidatePositions({ length: 100, closed: true }, 1);
  ok(cc.length === 100 && cc[99] === 99, '닫힌 라인 후보: 균등(끝 = 처음)');
  const w = interpWeights(c, 10.25);
  ok(w.length === 2 && w[0][0] === 10 && Math.abs(w[0][1] - 0.75) < 1e-12 && w[1][0] === 11 && Math.abs(w[1][1] - 0.25) < 1e-12, '후보 사이 위치 = 이웃 두 후보 선형 보간'); }
{ // A-3 합성: s 칸 100 · 폭 1칸. 후보 c 의 지도 = 가우시안(σ=6). 등간격 n 개의 리플 U 를 해석적으로 계산해 최소 n 과 비교
  const G = { ns: 100, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 100, closed: false, winS: 10, area: new Float64Array(100).fill(1), valid: new Uint8Array(100).fill(1) };
  const sig = 6, cand = candidatePositions(line, 1);
  const maps = cand.map((s) => Float32Array.from({ length: 100 }, (_, i) => Math.exp(-(((i + 0.5) - s) ** 2) / (2 * sig * sig))));
  const U = (n) => { const ss = Array.from({ length: n }, (_, i) => ((i + 0.5) * 100) / n), p = Array.from({ length: 100 }, (_, i) => ss.reduce((a, s) => a + Math.exp(-(((i + 0.5) - s) ** 2) / (2 * sig * sig)), 0)); return Math.min(...p) / Math.max(...p); };
  const obs = { targetLen: 0.7, targetWid: 0 };
  let want = 1; while (U(want) < 0.7) want++;
  const r = searchLeds({ G, obs, line, cand, maps, pitches: [0], nMax: 40, emitted: 1 });
  ok(r.feasible && r.n === want && r.pitch === 0, `A-3 최소 개수: 찾음 ${r.n} = 해석 ${want}`);
  const sum = layoutMap(cand, maps, [25, 75.5]);
  ok(Math.abs(sum[25] - (maps[25][25] + 0.5 * maps[75][25] + 0.5 * maps[76][25])) < 1e-6, 'layoutMap = 위치별 보간 지도 합');
  const none = searchLeds({ G, obs: { targetLen: 0.999, targetWid: 0 }, line, cand, maps, pitches: [0], nMax: 5, emitted: 1 });
  ok(!none.feasible && none.n === 5 && /LED 최대 5개/.test(none.reason), `불가 → 가장 가까운 안: ${none.reason}`); }
{ const p = pitchOptions({ length: 100, closed: false }, 5, { min: 10, max: 30 });
  ok(p[0] === 0 && p.includes(10) && p.includes(25) && !p.includes(26), '피치 후보: 0(균등) + 범위 1mm 간격, (n−1)·p ≤ L 만');
  ok(pitchOptions({ length: 100, closed: true }, 5, { min: 10, max: 30 }).join() === '0', '닫힌 라인은 균등만'); }
done();
```

- [ ] **Step 2: 실패 확인** — `node test/mech3d-basis.mjs < /dev/null` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/mech3d/basis.js`

```js
// ② LED 개수·피치 — spec P4 §2.2. 후보 위치(1mm)마다 LED 1개의 관측 지도를 추적해 두고, (개수, 피치) 지도 = 위치별 지도 합(사이 위치는 이웃 두 후보 선형 보간).
// 빛은 선형 중첩이므로 보간 외에는 근사가 없다. 우선순위: 목표 만족 → 최소 개수 → (① 이 켜져 있으면) 최소 Milky → 효율.
import { ledSPositions } from './placement.js';
import { tallyStats } from './tally.js';
import { margin } from './milky-search.js';

export function candidatePositions(line, step = 1) {
  const L = line.length;
  if (line.closed) { const n = Math.max(1, Math.round(L / step)); return Array.from({ length: n }, (_, i) => (i * L) / n); }
  const n = Math.max(1, Math.round(L / step));
  return Array.from({ length: n + 1 }, (_, i) => (i * L) / n);
}
// s → [[후보 번호, 가중]…] (1개 또는 2개)
export function interpWeights(cand, s, closed = false, L = cand.at(-1)) {
  const n = cand.length, step = closed ? L / n : cand[1] - cand[0];
  let f = s / step;
  if (closed) f = ((f % n) + n) % n;
  const i = Math.min(n - 1, Math.max(0, Math.floor(f))), t = f - i;
  if (t < 1e-9) return [[i, 1]];
  const j = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
  return [[i, 1 - t], [j, t]];
}
// 위치 목록 → 합 지도(Float64Array). maps[c]: 후보 c 의 지도(셀 배열, 같은 길이). off: 지도 안 시작 위치(격자 j 의 칸)
export function layoutMap(cand, maps, positions, { closed = false, L, off = 0, len = maps[0].length } = {}) {
  const out = new Float64Array(len);
  for (const s of positions) for (const [c, w] of interpWeights(cand, s, closed, L ?? cand.at(-1))) {
    const m = maps[c];
    for (let k = 0; k < len; k++) out[k] += w * m[off + k];
  }
  return out;
}
// 피치 후보: 0(균등) + 사용자 범위 [min,max] 1mm 간격 중 (n−1)·p ≤ L. 닫힌 라인은 균등만
export function pitchOptions(line, n, range = null) {
  const out = [0];
  if (line.closed || !range || n < 2) return out;
  for (let p = Math.ceil(range.min); p <= range.max; p++) if ((n - 1) * p <= line.length + 1e-9) out.push(p);
  return out;
}
// maps[c] 길이 = nJ·셀(격자 지도) 또는 셀. milkies 가 있으면 격자 j 마다 판정(가장 작은 통과 Milky 선택)
// 반환 { feasible, n, pitch, j, stats, eff, margin, reason, tried:[{n, pitch, j, margin, eff}] }
export function searchLeds({ G, obs, line, cand, maps, pitches = [0], pitchRange = null, nMax, emitted, milkies = null }) {
  const nCell = G.ns * G.nw, nJ = milkies ? milkies.length : 1, tried = [];
  let best = null;
  const better = (a, b) => !b || a.margin > b.margin || (a.margin === b.margin && a.eff > b.eff);
  for (let n = 1; n <= nMax; n++) {
    let hit = null;
    for (const p of pitchRange ? pitchOptions(line, n, pitchRange) : pitches) {
      let pos; try { pos = ledSPositions(line, n, p); } catch { continue; }
      for (let j = 0; j < nJ; j++) {
        const sum = layoutMap(cand, maps, pos, { closed: line.closed, L: line.length, off: j * nCell, len: nCell });
        const st = tallyStats(G, [sum], obs);
        if (st.empty) continue;
        let tot = 0; for (let k = 0; k < nCell; k++) tot += sum[k];
        const row = { n, pitch: p, j, stats: st, eff: tot / (emitted * n), margin: margin(st, obs) };   // emitted = 후보 LED 1개 방출 → n 개면 n 배
        tried.push({ n, pitch: p, j, margin: row.margin, eff: row.eff });
        if (row.margin >= 0) {
          // 같은 n 안에서: 더 작은 Milky(j 작을수록 낮음) → 효율
          if (!hit || row.j < hit.j || (row.j === hit.j && row.eff > hit.eff)) hit = row;
          break;   // 이 피치에서는 가장 낮은 통과 Milky 를 찾았음
        }
        if (better(row, best)) best = row;
      }
    }
    if (hit) return { feasible: true, ...hit, reason: '', tried };
  }
  const b = best ?? { n: nMax, pitch: 0, j: 0, stats: null, eff: NaN, margin: -Infinity };
  const st = b.stats;
  return { feasible: false, ...b, n: nMax, tried, reason: `LED 최대 ${nMax}개에서도 길이 U ${st ? st.Ulen.toFixed(2) : '–'}${st?.Uwid == null ? '' : ` · 폭 U ${st.Uwid.toFixed(2)}`} — ${st && st.Uwid != null && st.Uwid - obs.targetWid < st.Ulen - obs.targetLen ? '폭 방향 확산 부족: ③ 형상 또는 Milky 상향 권장' : '길이 방향 리플: Milky 상향 또는 LED–커버 거리 확대 권장'}` };
}
```

- [ ] **Step 4: 통과 확인** — `node test/mech3d-basis.mjs < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/basis.js test/mech3d-basis.mjs
git commit -m "feat(mech3d): LED basis — candidate positions, interpolated layout sum, min-count search (A-3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: A-2 — 후보 합산 vs 다중 LED 직접 계산

**Files:**
- Test: `test/mech3d-basis.mjs` (append)

- [ ] **Step 1: 시험 추가** (구현 없이 통과해야 하는 검증 시험 — 실패하면 Task 6~7 을 고친다)

```js
import { loadTable } from './l2-util.mjs';
import { plateFixture } from './m3-fixture.mjs';
import { runChunk } from '../src/engine/mech3d/job.js';
{ // 판 장면(LED 5개 위치 10·30·50·70·90): 후보 지도(위치마다 LED 1개, 같은 광자/LED) 합 vs 5개 직접
  const F = plateFixture(loadTable()), nCell = F.G.ns * F.G.nw, B = 6, N1 = 20000;
  const at = (x) => ({ pos: [x, 3, -3], axis: [0, 0, 1], xAxis: [1, 0, 0] });
  const per = (em, b, N) => runChunk({ ...F, emitters: em, N, seed: 500 + b }).acc;
  // combineSources 는 광속을 더한다(LED 5개 = 방출 5배) → 단일 LED 지도 5개의 합 = 5개 직접 지도(나누기 없음)
  const sumB = Array.from({ length: B }, (_, b) => { const s = new Float64Array(nCell); for (const x of [10, 30, 50, 70, 90]) { const a = per([at(x)], b * 10 + x, N1); for (let k = 0; k < nCell; k++) s[k] += a[k]; } return s; });
  const dirB = Array.from({ length: B }, (_, b) => per(F.emitters, 1000 + b, N1));
  let worst = 0;
  for (let k = 0; k < nCell; k++) {
    if (!F.G.valid[k]) continue;
    const a = sumB.map((x) => x[k]), d = dirB.map((x) => x[k]);
    const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, se = (v) => Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1) / v.length);
    if (mean(d) <= 0) continue;
    worst = Math.max(worst, Math.abs(mean(a) - mean(d)) / Math.hypot(se(a), se(d)));
  }
  ok(worst < 4.5, `A-2 후보 합 = 다중 LED 직접: 셀 최대 ${worst.toFixed(2)}σ`); }
```

- [ ] **Step 2: 실행** — `node test/mech3d-basis.mjs < /dev/null` → `all PASS`

- [ ] **Step 3: 커밋 + push (Phase B 끝)**

```bash
git add test/mech3d-basis.mjs package.json
git commit -m "test(mech3d): A-2 basis sum equals direct multi-LED MC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

(같은 커밋에서 `package.json` 의 `test:mech3d-mc` 끝에 ` && node test/mech3d-basis.mjs` 를 덧붙인다.)

---

## Phase C — ③ LGP 형상

### Task 9: 관측 좌표계 높이맵·변형·세분(`shape-opt.js`) + A-4

**Files:**
- Create: `src/engine/mech3d/shape-opt.js`
- Test: `test/mech3d-shape-opt.mjs` (new)

- [ ] **Step 1: 실패하는 시험 작성** — `test/mech3d-shape-opt.mjs`

```js
// ③ LGP 형상: node test/mech3d-shape-opt.mjs
import { frameHeights, deformPart, refineForBumps, bump, minThickness, shapeCandidates, isWatertight } from '../src/engine/mech3d/shape-opt.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const frame = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] };   // 관측 = +z
const plate = boxMesh(0, 0, 0, 40, 10, 2);
{ const H = frameHeights(plate, frame, 0.5), z = H.at(20, 5);
  ok(Math.abs(z.zt - 2) < 1e-6 && Math.abs(z.zb) < 1e-6 && H.non25 === 0, `관측 좌표 높이: 윗면 2 · 아랫면 0 (${z.zt}, ${z.zb})`);
  ok(Math.abs(H.at(40, 10).zt - 2) < 1e-6, '외곽 점은 가장 가까운 칸 값'); }
{ // A-4 ①: 두께 오프셋 Δt = 0.5 → 부피 = 40·10·2.5, 윗면 고정
  const H = frameHeights(plate, frame, 0.5), m = deformPart(plate, frame, H, { dt: 0.5, h: 0, R: 1, centers: [] });
  const V = meshVolume(m.positions, m.triangles), zs = [];
  for (let i = 2; i < m.positions.length; i += 3) zs.push(m.positions[i]);
  ok(Math.abs(V - 1000) < 1e-3 && Math.max(...zs) === 2 && Math.abs(Math.min(...zs) + 0.5) < 1e-6 && m.faceIds === plate.faceIds, `Δt 0.5: 부피 ${V.toFixed(3)} = 1000, 윗면 고정`); }
{ // A-4 ②: 국부 포켓 h=0.5, R=4, 중심 2곳(높이맵 칸 중심에 맞춤) → 부피 = 800 − 2·h·∫bump = 800 − 2·0.5·(π R²(1/2 − 2/π²))
  const centers = [[10.25, 5.25], [30.25, 5.25]], R = 4, h = 0.5;
  const H = frameHeights(plate, frame, 0.5), ref = refineForBumps(plate, frame, centers, R, 0.25);
  const m = deformPart(ref, frame, H, { dt: 0, h, R, centers });
  const ib = Math.PI * R * R * (0.5 - 2 / (Math.PI * Math.PI)), want = 800 - 2 * h * ib, V = meshVolume(m.positions, m.triangles);
  ok(Math.abs(V / want - 1) < 0.005, `포켓 부피 ${V.toFixed(2)} ≈ 해석 ${want.toFixed(2)} (±0.5%)`);
  ok(isWatertight(m), '세분·변형 뒤 닫힌 메쉬(모든 모서리 = 삼각형 2개)');
  ok(Math.abs(bump(0) - 1) < 1e-12 && bump(1) === 0 && Math.abs(bump(0.5) - 0.5) < 1e-12, 'bump: 코사인 창');
  ok(Math.abs(minThickness(H, { dt: 0, h, R, centers }) - 1.5) < 1e-6, '최소 두께 = 2 − h'); }
{ const C = shapeCandidates({ t0: 2, pitch: 20, hasCenters: true });
  ok(C.length === 27 && C.some((c) => c.dt === -1 && c.h === -1 && c.R === 6) && C.some((c) => c.dt === 2 && c.h === 1 && c.R === 16), '후보 27개: Δt ∈ [−0.5t₀, t₀], h ∈ [−0.5t₀, 0.5t₀], R ∈ [0.3p, 0.8p]');
  ok(shapeCandidates({ t0: 2, pitch: 20, hasCenters: false }).length === 3, 'LED 중심 없음 → Δt 만 3개'); }
done();
```

- [ ] **Step 2: 실패 확인** — `node test/mech3d-shape-opt.mjs < /dev/null` → FAIL

- [ ] **Step 3: 구현** — `src/engine/mech3d/shape-opt.js`

```js
// ③ LGP 형상 — spec P4 §2.3. 관측 좌표계(u,v,d: d = 관측자 쪽) 에서 부품을 자유형 변형한다.
// 아랫면 이동량 D(x,y) = Δt − h·Σ bump(|p−c|/R)  (D>0 = 아래로 = 두꺼워짐, h>0 = LED 위 포켓)
// 정점 z' = z − w·D(x,y), w = (z_t − z)/(z_t − z_b) — 윗면(관측면 쪽) 고정, 아랫면만 움직이고 사이는 선형. 같은 자리 정점은 같은 결과라 닫힘 유지.
import { meshToHeightfield } from '../shape/heightfield.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const bump = (r) => (r >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * r)));
export const toFrame = (F, p) => [dot(p, F.u), dot(p, F.v), dot(p, F.d)];
export const fromFrame = (F, q) => [0, 1, 2].map((k) => q[0] * F.u[k] + q[1] * F.v[k] + q[2] * F.d[k]);

// 관측 좌표 높이맵 — at(x,y) = { zt, zb } (마스크 밖이면 가장 가까운 칸). non25 = 비 2.5D 칸 비율
export function frameHeights(mesh, F, cell = 0.5) {
  const P = mesh.positions, Q = new Float32Array(P.length);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]);
    Q[i] = q[0]; Q[i + 1] = q[1]; Q[i + 2] = q[2];
    xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); zmax = Math.max(zmax, q[2]);
  }
  const hf = meshToHeightfield({ positions: Q, triangles: mesh.triangles }, { cell });
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;   // meshToHeightfield 의 원점(외곽 중심, z 최고 = 0)
  const masked = []; for (let k = 0; k < hf.mask.length; k++) if (hf.mask[k]) masked.push(k);
  function at(x, y) {
    let i = Math.floor((x - cx - hf.x0) / hf.cell), j = Math.floor((y - cy - hf.y0) / hf.cell);
    i = Math.min(hf.nx - 1, Math.max(0, i)); j = Math.min(hf.ny - 1, Math.max(0, j));
    let k = j * hf.nx + i;
    if (!hf.mask[k]) {   // 가장 가까운 마스크 칸
      let bd = Infinity, bk = -1;
      for (const m of masked) { const di = (m % hf.nx) - i, dj = Math.floor(m / hf.nx) - j, dd = di * di + dj * dj; if (dd < bd) { bd = dd; bk = m; } }
      k = bk;
    }
    return { zt: hf.zt[k] + zmax, zb: hf.zb[k] + zmax };
  }
  return { at, hf, cx, cy, zmax, non25: hf.stats.non25DFrac, t0: (() => { let s = 0; for (const m of masked) s += hf.zt[m] - hf.zb[m]; return masked.length ? s / masked.length : 0; })() };
}

const disp = (x, y, { dt, h, R, centers }) => { let b = 0; for (const c of centers) b += bump(Math.hypot(x - c[0], y - c[1]) / R); return dt - h * b; };

// 변형 메쉬(같은 삼각형·면 번호, 새 정점 위치). 부피는 다시 셈
export function deformPart(mesh, F, H, prm) {
  const P = mesh.positions, out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const q = toFrame(F, [P[i], P[i + 1], P[i + 2]]), { zt, zb } = H.at(q[0], q[1]);
    const w = zt - zb > 1e-9 ? Math.min(1, Math.max(0, (zt - q[2]) / (zt - zb))) : 0;
    q[2] -= w * disp(q[0], q[1], prm);
    const p = fromFrame(F, q); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: out };
}

// 최소 두께(관측 좌표, 마스크 칸 중심) — 제약 점검용
export function minThickness(H, prm) {
  const { hf, cx, cy } = H; let mn = Infinity;
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {
    const k = j * hf.nx + i; if (!hf.mask[k]) continue;
    const x = cx + hf.x0 + (i + 0.5) * hf.cell, y = cy + hf.y0 + (j + 0.5) * hf.cell;
    mn = Math.min(mn, hf.zt[k] - hf.zb[k] + disp(x, y, prm));
  }
  return mn;
}

// LED 원판(반경 R) 부근 국부 세분 — 모서리 기준(모서리 끝점만으로 결정 → 이웃 삼각형과 어긋남 없음).
// 표시 모서리: 길이 > hMax 이고 원판과 가까운(관측 평면 거리 < R) 모서리 + 원판 중심을 품은 삼각형의 가장 긴 모서리. 1·2·3 분할 패턴, 최대 14 회.
// 같은 자리 정점(면마다 따로 있는 STEP 정점)은 위치 키로 합쳐 중점을 공유한다.
export function refineForBumps(mesh, F, centers, R, hMax) {
  if (!centers.length) return mesh;
  let P = Array.from(mesh.positions), T = Array.from(mesh.triangles), Fi = Array.from(mesh.faceIds);
  const key = (i) => `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`;
  const pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const near2 = (a, b) => {   // 관측 평면 선분–점 거리 < R (원판 중 하나)
    const A = toFrame(F, a), B = toFrame(F, b);
    for (const c of centers) {
      const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey, t = l2 > 0 ? Math.min(1, Math.max(0, ((c[0] - A[0]) * ex + (c[1] - A[1]) * ey) / l2)) : 0;
      if (Math.hypot(A[0] + t * ex - c[0], A[1] + t * ey - c[1]) < R) return true;
    }
    return false;
  };
  const inTri = (a, b, c, p) => { const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]); const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  for (let pass = 0; pass < 14; pass++) {
    const ek = (i, j) => { const a = key(i), b = key(j); return a < b ? `${a}#${b}` : `${b}#${a}`; };
    const flag = new Set();
    for (let t = 0; t < T.length; t += 3) {
      const v = [T[t], T[t + 1], T[t + 2]], E = [[0, 1], [1, 2], [2, 0]];
      let longest = -1, lmax = 0;
      for (let e = 0; e < 3; e++) {
        const a = pt(v[E[e][0]]), b = pt(v[E[e][1]]), l = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (l > lmax) { lmax = l; longest = e; }
        if (l > hMax && near2(a, b)) flag.add(ek(v[E[e][0]], v[E[e][1]]));
      }
      if (lmax > hMax) {
        const A = toFrame(F, pt(v[0])), B = toFrame(F, pt(v[1])), C = toFrame(F, pt(v[2]));
        if (centers.some((c) => inTri(A, B, C, c))) flag.add(ek(v[E[longest][0]], v[E[longest][1]]));
      }
    }
    if (!flag.size) break;
    const mid = new Map(), NT = [], NF = [];
    const midOf = (i, j) => { const k = ek(i, j); if (!mid.has(k)) { mid.set(k, P.length / 3); P.push((P[3 * i] + P[3 * j]) / 2, (P[3 * i + 1] + P[3 * j + 1]) / 2, (P[3 * i + 2] + P[3 * j + 2]) / 2); } return mid.get(k); };
    for (let t = 0, f = 0; t < T.length; t += 3, f++) {
      const [a, b, c] = [T[t], T[t + 1], T[t + 2]], fa = flag.has(ek(a, b)), fb = flag.has(ek(b, c)), fc = flag.has(ek(c, a)), n = fa + fb + fc, id = Fi[f];
      const push = (...tri) => { NT.push(...tri); NF.push(id); };
      if (n === 0) push(a, b, c);
      else if (n === 3) { const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a); push(a, ab, ca); push(ab, b, bc); push(ca, bc, c); push(ab, bc, ca); }
      else if (n === 1) { if (fa) { const m = midOf(a, b); push(a, m, c); push(m, b, c); } else if (fb) { const m = midOf(b, c); push(a, b, m); push(a, m, c); } else { const m = midOf(c, a); push(a, b, m); push(m, b, c); } }
      else {   // 2개: 돌려서 (a,b)·(b,c) 가 표시된 꼴로
        let [x, y, z] = fa && fb ? [a, b, c] : fb && fc ? [b, c, a] : [c, a, b];
        const m1 = midOf(x, y), m2 = midOf(y, z);
        push(m1, y, m2); push(x, m1, m2); push(x, m2, z);
      }
    }
    T = NT; Fi = NF;
  }
  const { bvh, ...rest } = mesh;
  return { ...rest, positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(Fi) };
}

// 닫힘 점검(위치 키 기준 모든 모서리가 정확히 2개 삼각형에 속함)
export function isWatertight(m) {
  const P = m.positions, T = m.triangles, key = (i) => `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`, cnt = new Map();
  for (let t = 0; t < T.length; t += 3) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) { const a = key(T[t + i]), b = key(T[t + j]), k = a < b ? `${a}#${b}` : `${b}#${a}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  for (const v of cnt.values()) if (v !== 2) return false;
  return true;
}

// 후보 27개(3×3×3) — 범위는 spec §2.3 기본. LED 중심이 없으면 Δt 만 3개
export function shapeCandidates({ t0, pitch, hasCenters, ranges = null }) {
  const lin = ([a, b]) => [a, (a + b) / 2, b].map((v) => Math.round(v * 1e4) / 1e4);
  const r = ranges ?? { dt: [-0.5 * t0, 1.0 * t0], h: [-0.5 * t0, 0.5 * t0], R: [0.3 * pitch, 0.8 * pitch] };
  const out = [];
  for (const dt of lin(r.dt)) {
    if (!hasCenters) { out.push({ dt, h: 0, R: 1 }); continue; }
    for (const h of lin(r.h)) for (const R of lin(r.R)) out.push({ dt, h, R });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — `node test/mech3d-shape-opt.mjs < /dev/null` → `all PASS`. 부피 시험이 0.5% 를 넘으면 `hMax` 를 0.25 → 0.15 로 줄여 본 뒤, 그래도 넘으면 `bump` 적분식을 다시 확인한다(∫₀^R 0.5(1+cos πr/R)·2πr dr = πR²(1/2 − 2/π²)).

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/shape-opt.js test/mech3d-shape-opt.mjs
git commit -m "feat(mech3d): LGP shape FFD — frame heightfield, conforming local refinement, thickness, 27 candidates (A-4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: 런타임 `shapeMod` 반영

**Files:**
- Modify: `src/engine/mech3d/runtime.js` (`applyPartXforms`)
- Modify: `src/ui/m3/app.js` (`applyPartXforms(...)` 호출 3곳 — `mount`, `onXform`, 새 shape 적용)
- Test: `test/mech3d-xform.mjs` (append)

- [ ] **Step 1: 실패하는 시험 추가**

```js
import { applyPartMods } from '../src/engine/mech3d/runtime.js';
{ setMech3dMesh('s', [boxMesh(0, 0, 0, 40, 10, 2)]); const raw = getMech3d();
  const mod = { frame: { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, dt: 0.5, h: 0, R: 1, centers: [], cell: 0.5 };
  ok(applyPartMods([{ shapeMod: mod }]) && Math.abs(meshVolume(getMech3d().parts[0].positions, getMech3d().parts[0].triangles) - 1000) < 1e-3 && getMech3d().raw === raw, 'shapeMod Δt 0.5 반영(부피 1000), 원본 유지');
  ok(!applyPartMods([{ shapeMod: mod }]), '같은 변경이면 다시 만들지 않음');
  ok(applyPartMods([{}]) && getMech3d() === raw, 'shapeMod 지우면 원본'); clearMech3d(); }
```

- [ ] **Step 2: 실패 확인** — `node test/mech3d-xform.mjs < /dev/null` → FAIL

- [ ] **Step 3: 구현** — `runtime.js`: `applyPartXforms(xforms)` 를 일반화한다. 기존 이름은 호환용으로 남긴다.

```js
import { frameHeights, deformPart, refineForBumps } from './shape-opt.js';

// 부품 변경 = 크기·위치(xform) → 형상(shapeMod, P4 ③) 순서. mods[i] = spec.mech3d.parts[i](xform·shapeMod 필드만 봄)
export function applyPartMods(mods) {
  if (!raw) return false;
  const xs = raw.parts.map((_, i) => {
    const x = isIdentityXform(mods?.[i]?.xform) ? null : mods[i].xform, s = mods?.[i]?.shapeMod ?? null;
    return x || s ? { x, s } : null;
  });
  const key = JSON.stringify(xs);
  if (key === xkey) return false;
  xkey = key;
  if (xs.every((x) => !x)) { scene = raw; return true; }
  const parts = raw.parts.map((p, i) => {
    if (!xs[i]) return p;
    let m = p;
    if (xs[i].x) { const b = bounds(p.positions); m = scaleMoveMesh(p, xs[i].x, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]); }
    const s = xs[i].s;
    if (s) {
      const H = frameHeights(m, s.frame, s.cell ?? 0.5);
      m = deformPart(refineForBumps(m, s.frame, s.centers, s.R, Math.max(0.1, s.R / 8)), s.frame, H, s);
    }
    return m;
  });
  scene = buildSceneMesh(raw.name, parts); scene.raw = raw;
  return true;
}
// 구 호출(크기·위치만) — xforms[i] → { xform }
export const applyPartXforms = (xforms) => applyPartMods((xforms ?? []).map((x) => ({ xform: x })));
```

`src/ui/m3/app.js`: `applyPartXforms(ctx.mspec.parts.map((p) => p.xform))` 와 `applyPartXforms(m.parts.map((p) => p.xform))` 를 각각 `applyPartMods(ctx.mspec.parts)`, `applyPartMods(m.parts)` 로 바꾸고 import 를 `applyPartMods` 로 바꾼다. 같은 파일 `refreshLine` 의 키에 `p.shapeMod ?? null` 을 더한다:

```js
key = JSON.stringify([O.faces, O.dir, st.mspec.parts.map((p) => [p.xform ?? null, p.shapeMod ?? null])]);
```

- [ ] **Step 4: 통과 확인** — `node test/mech3d-xform.mjs < /dev/null && npm run -s test:m3 < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/runtime.js src/ui/m3/app.js test/mech3d-xform.mjs
git commit -m "feat(mech3d): runtime applies stored shapeMod after size/position (P4 ③ apply/revert)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: 메쉬 → STEP 내보내기

**Files:**
- Create: `src/export/mesh-step.js`, `src/export/mesh-step-worker.js`
- Test: `test/mesh-step.mjs` (new)

- [ ] **Step 1: 실패하는 시험 작성** — `test/mesh-step.mjs`

```js
// 삼각형 메쉬 → STEP 솔리드: node test/mesh-step.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { meshToStepText } from '../src/export/mesh-step.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade(), m = boxMesh(0, 0, 0, 40, 10, 2);
const text = meshToStepText(oc, m);
const back = readStepParts(oc, text);
ok(/ISO-10303-21/.test(text) && back.length === 1 && Math.abs(meshVolume(back[0].positions, back[0].triangles) - 800) < 0.5, `STEP 왕복: 부품 1개, 부피 ${back.length ? meshVolume(back[0].positions, back[0].triangles).toFixed(2) : '–'}`);
done();
```

- [ ] **Step 2: 실패 확인** — `node test/mesh-step.mjs < /dev/null` → FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/export/mesh-step.js`

```js
// 삼각형 메쉬(같은 자리 정점은 위치로 합침) → 꿰맨 솔리드 → STEP 문자열. P4 ③ 목업용(평면 삼각형 그대로 — 곡면 맞춤 없음)
import { pnt, triFace, sewToSolid, shapesToStepText } from './oc-build.js';

export function meshToStepText(oc, mesh) {
  const P = mesh.positions, T = mesh.triangles, pts = new Map();
  const at = (i) => {
    const k = `${Math.round(P[3 * i] * 1e5)}|${Math.round(P[3 * i + 1] * 1e5)}|${Math.round(P[3 * i + 2] * 1e5)}`;
    if (!pts.has(k)) pts.set(k, pnt(oc, P[3 * i], P[3 * i + 1], P[3 * i + 2]));
    return pts.get(k);
  };
  const faces = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = at(T[t]), b = at(T[t + 1]), c = at(T[t + 2]);
    if (a === b || b === c || c === a) continue;   // 퇴화 삼각형
    faces.push(triFace(oc, a, b, c));
  }
  return shapesToStepText(oc, [sewToSolid(oc, faces)]);   // 이름 인자 없음(oc-build.js:135) — name 은 파일 이름에만 씀
}
```

`src/export/mesh-step-worker.js`:

```js
// 메쉬 → STEP Worker (module worker — step-worker.js 와 같은 이유로 type:'module')
import { loadOc } from '../engine/shape/oc-loader.js';
import { meshToStepText } from './mesh-step.js';

self.onmessage = async (ev) => {
  try {
    const oc = await loadOc();
    self.postMessage({ type: 'done', stepText: meshToStepText(oc, ev.data.mesh) });
  } catch (e) { self.postMessage({ type: 'error', message: e.message ?? String(e) }); }
};
```

- [ ] **Step 4: 통과 확인** — `node test/mesh-step.mjs < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋 + push (Phase C 끝)**

```bash
git add src/export/mesh-step.js src/export/mesh-step-worker.js test/mesh-step.mjs package.json
git commit -m "feat(export): triangle mesh to STEP solid (P4 ③ mock-up export)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

(`package.json` 의 `test:mech3d` 끝에 ` && node test/mech3d-shape-opt.mjs`, `test:mech3d-mc` 끝에 ` && node test/mesh-step.mjs` 를 덧붙인다.)

---

## Phase D — 실행기·화면

### Task 12: 단계 실행기(`autodesign.js`) — io 주입, 순수

**Files:**
- Create: `src/engine/mech3d/autodesign.js`
- Test: `test/mech3d-autodesign.mjs` (new)

io 계약(UI 가 Worker 로 구현, 시험은 가짜로 구현):

| io 함수 | 입력 | 반환 |
|---|---|---|
| `milkyRows(design, milkies)` | 현재 설계, 격자 | `milkyRows` 결과(`milky-search.js`) |
| `basis(design)` | 현재 설계(① 이 켜져 있으면 milky = 상한) | `{ cand, maps, emitted }`(maps[c] = Float32Array 셀 지도, emitted = 후보 LED 1개 방출) |
| `evalShapes(design, cands, N)` | 설계, 형상 후보, 후보당 광자 | `[{ cand, stats, eff, ok, why }]`(제약 위반 = ok:false) |
| `verify(design)` | 설계 | `{ stats, eff, lum }`(일반 점진 계산, 잡음 목표까지) |
| `progress(stage, frac, text)` | — | — |
| `cancelled()` | — | boolean |

`design = { milky, count, pitch, shape: null | { part, dt, h, R } }`, `cfg = { stages: { milky, leds, shape }, obs, line, G, nMax, pitchRange, milkyMax, shapePart, shapeCands, schedule }`.

- [ ] **Step 1: 실패하는 시험 작성** — `test/mech3d-autodesign.mjs`

```js
// P4 단계 실행기(가짜 io): node test/mech3d-autodesign.mjs
import { runAutoDesign, shapeScore, halving } from '../src/engine/mech3d/autodesign.js';
import { ok, done } from './mech3d-util.mjs';

const obs = { targetLen: 0.8, targetWid: 0.6 };
const st = (Ulen, Uwid) => ({ Ulen, Uwid, empty: false });
// 가짜 재가중 행: U(m) = 0.5 + 0.12·m → 목표 0.8 경계 = Milky 2.5 (창 = 기준 ±0.25)
const rowsOf = (ms, U = (m) => 0.5 + 0.12 * m) => ms.map((m) => ({ milky: m, Ulen: U(m), Uwid: 0.9, eff: 1 - m / 20, ess: 1, trusted: true, margin: Math.min(U(m) - 0.8, 0.3) }));
{ // ① 만: 기준 3 → 창 전체 통과 → 이분 탐색으로 내려가 경계 2.5 를 찾음 → 최종 검증
  const bases = [], calls = [];
  const io = { milkyRows: async (d, ms) => { bases.push(ms[10]); return rowsOf(ms); }, verify: async (d) => { calls.push(d.milky); return { stats: st(0.81, 0.9), eff: 0.8 }; }, progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3, count: 5, pitch: 0, shape: null }, milkyMax: 5 }, io);
  ok(r.feasible && Math.abs(r.best.milky - 2.5) < 0.03 && calls.at(-1) === r.best.milky && bases.length <= 8 && bases[1] < bases[0], `① 이분 탐색: 기준 ${bases.map((b) => b.toFixed(2)).join(' → ')} → 최소 Milky ${r.best.milky}`); }
{ // 상한까지 미달(U 가 천천히 오름) → 가장 가까운 안 = 상한 근처 + 상한 안내
  const io = { milkyRows: async (d, ms) => rowsOf(ms, (m) => 0.6 + 0.01 * m), verify: async () => ({ stats: st(0.6, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3 }, milkyMax: 5 }, io);
  ok(!r.feasible && /상한 5/.test(r.reason) && r.best.milky >= 4.9, `불가: ${r.reason}`); }
{ // ②+①: 후보 지도는 Milky 상한(5)에서 추적, 최소 개수 뒤 ① 이 Milky 를 낮춤
  let basisMilky = null;
  const G = { ns: 2, nw: 1, ds: 1, cell: 1, w0: -0.5, L: 2, closed: false, winS: 5, area: new Float64Array([1, 1]), valid: new Uint8Array([1, 1]) };
  const io = { basis: async (d) => { basisMilky = d.milky; return { cand: [0, 1, 2], maps: [0, 1, 2].map(() => Float32Array.from([1, 1])), emitted: 1 }; }, milkyRows: async (d, ms) => rowsOf(ms), verify: async () => ({ stats: st(0.9, 0.9), eff: 1 }), progress() {}, cancelled: () => false };
  const r = await runAutoDesign({ stages: { milky: true, leds: true }, obs: { targetLen: 0.8, targetWid: 0 }, current: { milky: 3, count: 5, pitch: 0 }, milkyMax: 5, G, line: { length: 2, closed: false }, nMax: 4 }, io);
  ok(basisMilky === 5 && r.best.count === 1 && Math.abs(r.best.milky - 2.5) < 0.03, `②: 상한 ${basisMilky} 에서 최소 ${r.best.count}개 → ① Milky ${r.best.milky}`); }
{ // 단계적 압축: 27 → 6 → 2 → 1, 각 단계 광자 수 증가
  const seen = [];
  const evalFn = async (cands, N) => { seen.push([cands.length, N]); return cands.map((c) => ({ cand: c, stats: st(0.7 + c.k / 100, 0.9), eff: 0.5 + c.k / 1000, ok: c.k !== 26 })); };
  const best = await halving(Array.from({ length: 27 }, (_, k) => ({ k })), evalFn, obs, [[27, 3e4], [6, 1e5], [2, 3e5]]);
  ok(seen.map((x) => x.join(':')).join(',') === '27:30000,6:100000,2:300000' && best.cand.k === 25, `압축 27→6→2: 최고 k=${best.cand.k}(제약 위반 26 제외)`);
  ok(shapeScore({ stats: st(0.85, 0.7), eff: 0.4, ok: true }, obs) > shapeScore({ stats: st(0.79, 0.9), eff: 0.9, ok: true }, obs), '점수: 목표 만족이 우선, 그다음 효율'); }
{ // 중지
  const io = { milkyRows: async () => { throw new Error('불리면 안 됨'); }, progress() {}, cancelled: () => true };
  const r = await runAutoDesign({ stages: { milky: true }, obs, current: { milky: 3 } }, io);
  ok(r.cancelled === true, '중지 → cancelled'); }
done();
```

- [ ] **Step 2: 실패 확인** — `node test/mech3d-autodesign.mjs < /dev/null` → FAIL

- [ ] **Step 3: 구현** — `src/engine/mech3d/autodesign.js`

```js
// P4 자동설계 단계 실행기 — spec §1·§2. 순서 ② → ① → ③, 체크 안 한 항목은 현재 값 고정. 계산은 io 가 맡는다(Worker / 시험 가짜).
// ① 재가중 창은 기준 ±0.25(ESS 한계, spec §2.1) — 창 밖은 이분 탐색으로 기준을 옮긴다. ② 는 Milky 상한에서 최소 개수를 구한 뒤 ① 이 낮춘다.
// 결과 { feasible, best(design), steps:[{stage, …}], reason, verified, cancelled }
import { milkyAxis } from './reweight.js';
import { pickMilky, margin } from './milky-search.js';
import { searchLeds } from './basis.js';

export const MILKY_STEP = 0.025, MILKY_ITERS = 8;
export const shapeScore = (r, obs) => (!r.ok ? -Infinity : margin(r.stats, obs) >= 0 ? 1 + r.eff : Math.min(r.stats.Ulen / obs.targetLen, r.stats.Uwid == null ? Infinity : r.stats.Uwid / obs.targetWid));

// 단계적 압축: schedule = [[남길 수(첫 단계는 전체), 광자 수]…]. 각 단계 결과 점수로 다음 단계 후보를 줄임
export async function halving(cands, evalFn, obs, schedule = [[27, 3e4], [6, 1e5], [2, 3e5]], cancelled = () => false) {
  let pool = cands, last = null;
  for (let s = 0; s < schedule.length; s++) {
    if (cancelled()) return null;
    const res = (await evalFn(pool, schedule[s][1])).filter((r) => r.ok).sort((a, b) => shapeScore(b, obs) - shapeScore(a, obs));
    if (!res.length) return null;
    last = res[0];
    pool = res.slice(0, schedule[s + 1]?.[0] ?? 1).map((r) => r.cand);
  }
  return last;
}

// ① Milky: 구간 [0.25, 상한] 이분 탐색 — 창 전체 통과면 위쪽 끝을 창 아래로, 전부 미달이면 아래쪽 끝을 창 위로. 중지 = null
async function searchMilky(d, cfg, io, steps, mCap) {
  let lo = 0.25, hi = mCap, m0 = Math.min(hi, Math.max(lo, d.milky ?? hi)), found = null, nearest = null;
  for (let it = 0; it < MILKY_ITERS; it++) {
    if (io.cancelled?.()) return null;
    io.progress?.('milky', it / MILKY_ITERS, `Milky 재가중 (기준 ${m0.toFixed(2)})`);
    const ms = milkyAxis(m0, MILKY_STEP, mCap), rows = await io.milkyRows(d, ms), pick = pickMilky(rows, cfg.obs);
    steps.push({ stage: 'milky', base: m0, rows, pick });
    if (pick.feasible) {
      found = pick;
      if (pick.edge !== 'low' || ms[0] <= lo + 1e-9) break;   // 창 안에서 경계를 찾음 / 더 내려갈 곳 없음
      hi = ms[0];
    } else {
      if (!pick.best) break;   // 믿을 격자점 없음
      if (!nearest || pick.best.margin > nearest.best.margin) nearest = pick;
      lo = ms.at(-1);
      if (lo >= hi - 1e-9) break;   // 상한까지 미달
    }
    m0 = (lo + hi) / 2;
  }
  return { found, nearest };
}

export async function runAutoDesign(cfg, io) {
  const { stages, obs } = cfg, steps = [], mCap = cfg.milkyMax ?? Math.max(cfg.current?.milky ?? 0, 5);
  let d = { ...cfg.current }, feasible = true, reason = '';
  const stop = () => io.cancelled?.();
  if (stop()) return { cancelled: true };
  if (stages.leds) {   // ② — ① 이 켜져 있으면 Milky 상한(확산 최대)에서 최소 개수
    io.progress?.('leds', 0, 'LED 후보 위치 추적');
    if (stages.milky) d = { ...d, milky: mCap };
    const B = await io.basis(d);
    if (stop()) return { cancelled: true };
    const r = searchLeds({ G: cfg.G, obs, line: cfg.line, cand: B.cand, maps: B.maps, pitchRange: cfg.pitchRange ?? null, nMax: cfg.nMax, emitted: B.emitted });
    steps.push({ stage: 'leds', ...r });
    d = { ...d, count: r.n, pitch: r.pitch };
    if (!r.feasible) { feasible = false; reason = r.reason; }
  }
  if (stages.milky) {   // ① — (②가 고른 개수에서) 목표를 만족하는 최소 Milky
    const m = await searchMilky(d, cfg, io, steps, mCap);
    if (!m) return { cancelled: true };
    if (m.found) d = { ...d, milky: m.found.milky };
    else { feasible = false; d = { ...d, milky: m.nearest?.milky ?? d.milky }; reason = `${m.nearest?.reason ?? '믿을 수 있는 격자점이 없음'} — Milky 상한 ${mCap} 을 올리거나 ②·③ 을 함께 쓰세요`; }
  }
  if (stages.shape && cfg.shapeCands?.length) {   // ③
    io.progress?.('shape', 0, `형상 후보 ${cfg.shapeCands.length}개 평가`);
    const best = await halving(cfg.shapeCands, (cands, N) => io.evalShapes(d, cands, N), obs, cfg.schedule, stop);
    if (stop()) return { cancelled: true };
    steps.push({ stage: 'shape', best });
    if (best) {
      d = { ...d, shape: { part: cfg.shapePart, ...best.cand } };
      if (margin(best.stats, obs) < 0) { feasible = false; reason = `형상 최적안도 목표 미달 — 길이 U ${best.stats.Ulen.toFixed(2)}${best.stats.Uwid == null ? '' : ` · 폭 U ${best.stats.Uwid.toFixed(2)}`}`; }
      else { feasible = true; reason = ''; }
    } else { feasible = false; reason = '제약(살두께·간섭)을 만족하는 형상 후보가 없음 — 범위를 줄이세요'; }
  }
  if (stop()) return { cancelled: true };
  io.progress?.('verify', 0, '최종안 정밀 재계산');
  const verified = await io.verify(d);
  return { feasible, best: d, steps, reason, verified, cancelled: false };
}
```

- [ ] **Step 4: 통과 확인** — `node test/mech3d-autodesign.mjs < /dev/null` → `all PASS`. (첫 시험 경로: 기준 3 창 [2.75, 3.25] 전체 통과 → hi 2.75 → 기준 1.5 창 전부 미달 → lo 1.75 → 기준 2.25 … → 창 안에 경계 2.5.)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/mech3d/autodesign.js test/mech3d-autodesign.mjs package.json
git commit -m "feat(mech3d): auto-design stage runner (②→①→③, re-basing, successive halving, final verify)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`package.json` 의 `test:mech3d` 끝에 ` && node test/mech3d-autodesign.mjs` 를 덧붙인다.)

### Task 13: Worker io 구현(`autodesign-run.js`)

**Files:**
- Create: `src/ui/m3/autodesign-run.js`
- Modify: `src/ui/m3/app.js` (`makeJob` 을 `jobFor(M, mechParts)` 로 일반화)
- Test: `test/m3-autodesign-run.mjs` (new — 가짜 포트, `test/m3-progressive.mjs` 의 가짜 포트 방식 그대로)

- [ ] **Step 1: app.js 일반화.** `makeJob()` 을 아래 두 함수로 나눈다(기존 호출 `A.prog.restart(makeJob)` 은 그대로 동작).

```js
// 작업 생성(현재 또는 자동설계 후보 설계) — M: spec.mech3d(복사본 가능), mechParts: 기구 메쉬(형상 후보면 바뀐 부품 포함)
export function jobFor(M, mechParts, { emitters = null } = {}) {
  const S = A.store.session;
  if (!S.line) return null;
  const em = emitters ?? L.currentEmitters(M, S.line);
  if (!em.length) return null;
  const obs = tallyObs(M.observe, M.observe.dir ?? S.line.frame.d), G = geometry(obs);
  const ledParts = M.light.kind === 'step' && getLedMesh() ? L.rawParts(getLedMesh().parts) : null;
  return {
    sceneKey: `s${++sceneSeq}`, G, obs, nLeds: em.length, fluxLm: M.light.spec.fluxLm ?? 0,
    scene: { mechParts: L.rawParts(mechParts), mspec: JSON.parse(JSON.stringify(M)), ledParts, lineData: lightData(S.line), G, obs, emitters: em },
  };
}
function makeJob() { return A ? jobFor(A.store.mspec, getMech3d().parts) : null; }
```

- [ ] **Step 2: 실패하는 시험 작성** — `test/m3-autodesign-run.mjs`

```js
// 자동설계 Worker io(가짜 포트): node test/m3-autodesign-run.mjs
import { createAdRunner } from '../src/ui/m3/autodesign-run.js';
import { ok, done } from './mech3d-util.mjs';

const nCell = 4;
const fakePorts = (log) => Array.from({ length: 3 }, (_, w) => ({ send: async (m) => {
  log.push(`${w}:${m.type}`);
  if (m.type === 'scene') return { sceneKey: m.sceneKey, ready: true };
  const acc = new Float64Array(nCell).fill(1), ledger = { emitted: m.N, escaped: m.N / 2, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const out = { sceneKey: m.sceneKey, acc, cnt: new Uint32Array(nCell), ledger, leak: {}, escObs: 0, ms: 1 };
  if (m.rw) out.rw = { acc: new Float64Array(m.rw.milkies.length * nCell).fill(1), sf: new Float64Array(m.rw.milkies.length).fill(m.N), sf2: new Float64Array(m.rw.milkies.length).fill(m.N), n: m.N, milkies: m.rw.milkies };
  return out;
} }));
{ const log = [], R = createAdRunner({ ports: fakePorts(log) });
  const job = { sceneKey: 'k1', scene: { G: { ns: 2, nw: 2 } } };
  const r = await R.trace(job, { N: 60000, chunkN: 10000, batches: 4, rw: { part: 0, milkies: [1, 2] } });
  ok(log.filter((x) => x.endsWith('scene')).length === 3 && log.filter((x) => x.endsWith('chunk')).length === 6, '장면 Worker 마다 1번, 청크 6개(60000/10000)');
  ok(r.batches.length === 4 && r.rwBatches.length === 4 && r.rwBatches[0].length === 2 * nCell && r.ledger.emitted === 60000 && Math.abs(r.ess[0] - 1) < 1e-12, '배치 4개로 나눠 합침 · 격자 지도 · ESS');
  const c = await R.traceEach(job, [[{ pos: [0, 0, 0] }], [{ pos: [1, 0, 0] }]], { N: 5000 });
  ok(c.maps.length === 2 && c.maps[0] instanceof Float32Array && c.emitted === 5000, 'traceEach: 후보마다 지도(Float32), 후보당 방출');
  R.cancel(); let thrown = ''; try { await R.trace(job, { N: 1000 }); } catch (e) { thrown = e.message; }
  ok(/중지/.test(thrown), 'cancel 뒤 호출 = 중지 오류'); }
done();
```

- [ ] **Step 3: 실패 확인** — `node test/m3-autodesign-run.mjs < /dev/null` → FAIL

- [ ] **Step 4: 구현** — `src/ui/m3/autodesign-run.js`

```js
// 자동설계 Worker io — spec P4 §2. 기존 scene/chunk 프로토콜(chunk-host.js)을 그대로 쓰고 rw·emitters 만 덧붙인다.
// trace(job, {N, chunkN, batches, rw}) → 배치별 합 + 격자 지도 + ESS. traceEach(job, emitterSets, {N}) → 후보마다 지도(②).
import { essRatio } from '../../engine/mech3d/reweight.js';

export function createAdRunner({ ports }) {
  let stopped = false, seed = 7001;
  const check = () => { if (stopped) throw new Error('자동설계 중지'); };
  async function prepare(job) {
    check();
    await Promise.all(ports.map((p) => p.send({ type: 'scene', sceneKey: job.sceneKey, ...job.scene })));
  }
  // 청크 목록을 Worker 들에 나눠 돌림(빈 Worker 가 다음 청크를 가져감)
  async function runAll(job, chunks, onReply) {
    let next = 0;
    await Promise.all(ports.map(async (p) => {
      while (next < chunks.length) {
        check();
        const k = next++, r = await p.send({ type: 'chunk', sceneKey: job.sceneKey, seed: seed++, ...chunks[k] });
        if (r.stale) throw new Error('장면이 바뀜 — 다시 실행하세요');
        onReply(k, r);
      }
    }));
  }
  // chunkN 기본 = Worker 마다 청크 2개쯤(후보당 광자가 적어도 모든 Worker 가 일하게)
  async function trace(job, { N, chunkN = Math.max(2000, Math.ceil(N / (2 * ports.length))), batches = 8, rw = null }) {
    await prepare(job);
    const nCell = job.scene.G.ns * job.scene.G.nw, nC = Math.max(1, Math.ceil(N / chunkN));
    const B = Array.from({ length: batches }, () => new Float64Array(nCell)), RB = rw ? Array.from({ length: batches }, () => new Float64Array(rw.milkies.length * nCell)) : null;
    const ledger = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 }, sf = rw ? new Float64Array(rw.milkies.length) : null, sf2 = rw ? new Float64Array(rw.milkies.length) : null;
    let n = 0;
    await runAll(job, Array.from({ length: nC }, () => ({ N: Math.ceil(N / nC), ...(rw ? { rw } : {}) })), (k, r) => {
      const b = k % batches;
      for (let i = 0; i < nCell; i++) B[b][i] += r.acc[i];
      for (const key in ledger) ledger[key] += r.ledger[key];
      if (rw) { for (let i = 0; i < RB[b].length; i++) RB[b][i] += r.rw.acc[i]; for (let j = 0; j < sf.length; j++) { sf[j] += r.rw.sf[j]; sf2[j] += r.rw.sf2[j]; } n += r.rw.n; }
    });
    return { batches: B, rwBatches: RB, ledger, ess: rw ? essRatio(sf, sf2, n) : null };
  }
  // 후보마다 발광점 묶음 하나 → 지도(Float32, 격자면 격자 수 × 셀). emitted = 후보당 방출(모든 후보 같은 N)
  async function traceEach(job, emitterSets, { N = 20000, rw = null } = {}) {
    await prepare(job);
    const maps = new Array(emitterSets.length);
    let emitted = 0;
    await runAll(job, emitterSets.map((em) => ({ N, emitters: em, ...(rw ? { rw } : {}) })), (k, r) => {
      maps[k] = Float32Array.from(rw ? r.rw.acc : r.acc);
      emitted = r.ledger.emitted;
    });
    return { maps, emitted };
  }
  return { trace, traceEach, cancel() { stopped = true; }, get stopped() { return stopped; } };
}
```

- [ ] **Step 5: 통과 확인** — `node test/m3-autodesign-run.mjs < /dev/null && npm run -s test:m3 < /dev/null` → `all PASS`

- [ ] **Step 6: 커밋**

```bash
git add src/ui/m3/autodesign-run.js src/ui/m3/app.js test/m3-autodesign-run.mjs package.json
git commit -m "feat(m3): auto-design Worker io (batched trace with Milky grid, per-candidate basis trace); jobFor()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`package.json` 의 `test:m3` 끝에 ` && node test/m3-autodesign-run.mjs` 를 덧붙인다.)

### Task 14: 자동설계 카드·비교·적용(`autodesign-panel.js` + app 연결)

**Files:**
- Create: `src/ui/m3/autodesign-panel.js`
- Modify: `src/ui/m3/command-bar.js` (버튼 `data-c="auto"` ✨ 자동설계)
- Modify: `src/ui/m3/app.js` (io 조립, 일시정지, 적용·되돌리기, STEP)
- Modify: `index.html` (결과 패널 위 `<div id="m3-auto" hidden></div>` — `#m3-res` 바로 앞)
- Modify: `styles.css`
- Test: `test/m3-ui-pure.mjs` (append — 순수 HTML·가능 여부 함수)

- [ ] **Step 1: 실패하는 시험 추가** — `test/m3-ui-pure.mjs`

```js
import { stageAvailability, autoCardHtml, compareHtml } from '../src/ui/m3/autodesign-panel.js';
{ const base = { parts: [{ material: { kind: 'milky' } }, { material: { kind: 'opaque' } }], light: { kind: 'manual' }, observe: { faces: [{ part: 0, face: 1 }] } };
  const a = stageAvailability(base, { non25: [0, 0.5] });
  ok(a.milky.ok && a.leds.ok && a.shape.ok && a.shape.parts.join() === '0', '가능: Milky 부품 있음 · 직접 배치 · 2.5D 부품만 ③ 대상');
  const b = stageAvailability({ ...base, light: { kind: 'step' }, parts: [{ material: { kind: 'clear' } }] }, { non25: [0.5] });
  ok(!b.milky.ok && /Milky 부품/.test(b.milky.why) && !b.leds.ok && /LED STEP/.test(b.leds.why) && !b.shape.ok, '불가 이유: Milky 없음 · LED STEP 위치 고정 · 2.5D 아님');
  const h = autoCardHtml({ avail: a, sel: { milky: true, leds: false, shape: false, shapePart: 0 }, running: null });
  ok(h.includes('data-ad="milky" checked') && h.includes('data-ad="run"') && !h.includes('disabled data-ad="milky"'), '카드: 체크 상태·실행 버튼');
  const c = compareHtml({ cur: { count: 5, pitch: 0, milky: 3, Ulen: 0.62, Uwid: 0.7, eff: 0.6 }, best: { count: 4, pitch: 0, milky: 3.5, Ulen: 0.81, Uwid: 0.72, eff: 0.55 }, feasible: true, reason: '', shape: null });
  ok(c.includes('LED') && c.includes('4') && c.includes('0.81') && c.includes('data-ad="apply"') && c.includes('data-ad="cancel"'), '비교표: 현재 | 최적 · 적용·취소'); }
```

- [ ] **Step 2: 실패 확인** — `node test/m3-ui-pure.mjs < /dev/null` → FAIL

- [ ] **Step 3: 구현 — 순수 부분과 마운트.** `src/ui/m3/autodesign-panel.js`

```js
// 자동설계 카드 — spec P4 §3. 체크 3개(①②③) · ③ 대상 부품 · [실행]/[중지] · 진행 · 현재|최적 비교 · [적용][취소][되돌리기][STEP]
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');

// M = spec.mech3d, info.non25[i] = 부품 i 의 비 2.5D 비율(관측 방향, app 이 frameHeights 로 계산)
export function stageAvailability(M, info) {
  const milkyParts = M.parts.map((p, i) => (p.material.kind === 'milky' ? i : -1)).filter((i) => i >= 0);
  const shapeParts = M.parts.map((p, i) => (p.material.kind !== 'opaque' && (info.non25?.[i] ?? 1) <= 0.02 ? i : -1)).filter((i) => i >= 0);
  return {
    milky: milkyParts.length ? { ok: true, parts: milkyParts } : { ok: false, why: 'Milky 부품이 없음 — 부품 소재를 Milky 로 지정하세요' },
    leds: M.light.kind === 'manual' ? { ok: true } : { ok: false, why: M.light.kind === 'step' ? 'LED STEP 은 위치가 고정 — 직접 배치에서만 쓸 수 있음' : '광원을 직접 배치로 지정하세요' },
    shape: shapeParts.length ? { ok: true, parts: shapeParts } : { ok: false, why: '관측 방향으로 2.5D 인 투과 부품이 없음' },
  };
}
const ITEMS = [['milky', '① Milky 레벨'], ['leds', '② LED 개수·피치'], ['shape', '③ LGP 형상']];
export function autoCardHtml({ avail, sel, running, names = [] }) {
  const row = ([k, label]) => {
    const a = avail[k];
    return `<label class="m3-ad-item${a.ok ? '' : ' off'}"><input type="checkbox" data-ad="${k}"${sel[k] && a.ok ? ' checked' : ''}${a.ok ? '' : ' disabled'}> ${label}${a.ok ? '' : ` <span class="mut">— ${esc(a.why)}</span>`}</label>`;
  };
  const cap = (sel.milky && avail.milky.ok) || (sel.leds && avail.leds.ok) ? `<div class="m3-row">Milky 상한 <input type="number" min="0.5" max="9.9" step="0.5" value="${sel.milkyMax ?? 5}" data-ad="milkyMax"> <span class="mut">② 는 이 값(확산 최대)에서 개수를 정하고 ① 이 낮춤</span></div>` : '';
  const part = avail.shape.ok ? `<div class="m3-row">③ 대상 <select data-ad="shapePart">${avail.shape.parts.map((i) => `<option value="${i}"${i === sel.shapePart ? ' selected' : ''}>${esc(names[i] ?? `부품 ${i + 1}`)}</option>`).join('')}</select></div>` : '';
  const prog = running ? `<div class="m3-ad-prog"><div class="bar"><i style="width:${Math.round((running.frac ?? 0) * 100)}%"></i></div><span>${esc(running.text)}</span> <button type="button" data-ad="stop">중지</button></div>` : '';
  const any = ITEMS.some(([k]) => sel[k] && avail[k].ok);
  return `<div class="m3-h">자동설계 <span class="mut">체크한 항목만 바꿈 · 순서 ②→①→③</span></div>${ITEMS.map(row).join('')}${cap}${part}
    ${running ? prog : `<div class="m3-row"><button type="button" data-ad="run"${any ? '' : ' disabled'}>▶ 실행</button><button type="button" data-ad="close">닫기</button></div>`}`;
}
// 비교표 — cur/best = { count, pitch, milky, Ulen, Uwid, eff, lum? }, shape = { dt, h, R } | null
export function compareHtml({ cur, best, feasible, reason, shape, canRevert = false }) {
  const tr = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td class="${a !== b ? 'chg' : ''}">${b}</td></tr>`;
  return `<div class="m3-h">${feasible ? '최적안' : '가장 가까운 안'} <span class="mut">${esc(reason)}</span></div>
    <table class="m3-cmp"><tr><th></th><th>현재</th><th>최적</th></tr>
      ${tr('LED', `${cur.count}개 ${cur.pitch > 0 ? `피치 ${cur.pitch}` : '균등'}`, `${best.count}개 ${best.pitch > 0 ? `피치 ${best.pitch}` : '균등'}`)}
      ${tr('Milky', f2(cur.milky), f2(best.milky))}
      ${tr('길이 U', f2(cur.Ulen), f2(best.Ulen))}${tr('폭 U', f2(cur.Uwid), f2(best.Uwid))}
      ${tr('광 효율', `${f2(cur.eff * 100)}%`, `${f2(best.eff * 100)}%`)}
      ${shape ? tr('형상', '원본', `두께 ${shape.dt >= 0 ? '+' : ''}${f2(shape.dt)} · ${shape.h >= 0 ? '포켓' : '돌출'} ${f2(Math.abs(shape.h))} · R ${f2(shape.R)} mm`) : ''}
    </table>
    <div class="m3-row"><button type="button" data-ad="apply">적용</button><button type="button" data-ad="cancel">취소</button>${shape ? '<button type="button" data-ad="step">STEP 내보내기</button>' : ''}${canRevert ? '<button type="button" data-ad="revert">되돌리기</button>' : ''}</div>`;
}

// el 에 카드를 그리고 이벤트를 h 로 넘긴다. state = { avail, sel, running, result, names, canRevert }
export function renderAutoPanel(el, state, h) {
  el.innerHTML = state.result ? compareHtml({ ...state.result, canRevert: state.canRevert }) : autoCardHtml(state);
  el.querySelectorAll('[data-ad]').forEach((x) => {
    const k = x.dataset.ad;
    if (x.type === 'checkbox') x.onchange = () => h.onSel(k, x.checked);
    else if (x.tagName === 'SELECT' || x.type === 'number') x.onchange = () => h.onSel(k, +x.value);
    else x.onclick = () => h.onAction(k);
  });
}
```

- [ ] **Step 4: 명령 막대 버튼.** `src/ui/m3/command-bar.js` 17번째 줄(계산 버튼) 뒤에 `<button type="button" data-c="auto">✨ 자동설계</button>` 를 넣고, 27번째 줄 `b('calc').onclick = …` 아래에 `b('auto').onclick = () => h.onAuto?.();` 를 넣는다.

- [ ] **Step 5: app.js 연결.** 아래를 `app.js` 끝(“3D 클릭” 절 앞)에 넣는다. 필요한 import: `import { createAdRunner } from './autodesign-run.js'; import { runAutoDesign } from '../../engine/mech3d/autodesign.js'; import { renderAutoPanel, stageAvailability } from './autodesign-panel.js'; import { milkyRows } from '../../engine/mech3d/milky-search.js'; import { candidatePositions } from '../../engine/mech3d/basis.js'; import { ledAtS, manualLeds } from '../../engine/mech3d/placement.js'; import { frameHeights, deformPart, refineForBumps, minThickness, shapeCandidates } from '../../engine/mech3d/shape-opt.js'; import { interferenceKeys } from '../../engine/mech3d/clearance.js'; import { tallyStats } from '../../engine/mech3d/tally.js'; import { setPartMaterialParam } from '../../engine/mech3d/materials.js';`

```js
// ---- 자동설계(P4) ----
function adState() { return (A.ad ??= { open: false, sel: { milky: true, leds: false, shape: false, shapePart: -1, milkyMax: null }, running: null, result: null, undo: null }); }
function adInfo() {   // 부품별 비 2.5D 비율(관측 방향) — 라인이 있을 때만
  const S = A.store.session, rt = getMech3d();
  return { non25: S.line ? rt.parts.map((p) => frameHeights(p, S.line.frame, 0.5).non25) : [] };
}
function renderAuto() {
  const el = $('#m3-auto'), st = adState();
  el.hidden = !st.open;
  if (!st.open) return;
  const M = A.store.mspec, avail = stageAvailability(M, adInfo());
  if (st.sel.shapePart < 0 && avail.shape.ok) st.sel.shapePart = avail.shape.parts[0];
  renderAutoPanel(el, { avail, sel: st.sel, running: st.running, result: st.result, names: M.parts.map((p) => p.name), canRevert: !!st.undo }, {
    onSel: (k, v) => { st.sel[k] = v; renderAuto(); },
    onAction: (k) => ({ run: adRun, stop: () => st.runner?.cancel(), close: () => { st.open = false; renderAuto(); }, apply: adApply, cancel: () => { st.result = null; A.view && renderView(); renderAuto(); }, revert: adRevert, step: adStep })[k]?.(),
  });
}
// 설계 → (mspec 복사본, 기구 메쉬) — 형상은 후보 메쉬로 바꾼 부품 포함
function designScene(d) {
  const M = JSON.parse(JSON.stringify(A.store.mspec)), S = A.store.session, rt = getMech3d();
  const mp = adState().milkyPart;
  if (mp != null && d.milky != null) M.parts[mp] = setPartMaterialParam(M.parts[mp], 'milky', d.milky);
  if (M.light.kind === 'manual') { M.light.manual.count = d.count; M.light.manual.pitch = d.pitch; }
  let parts = rt.parts;
  if (d.shape) { const mod = shapeModFor(d.shape, M); parts = rt.parts.map((p, i) => (i === d.shape.part ? deformPart(refineForBumps(p, mod.frame, mod.centers, mod.R, Math.max(0.1, mod.R / 8)), mod.frame, frameHeights(p, mod.frame, 0.5), mod) : p)); M.parts[d.shape.part].shapeMod = mod; }
  return { M, parts, S };
}
// LED 중심 = 그 설계(M: ② 가 바꾼 개수·피치 반영)의 발광점을 관측 평면에 투영
function shapeModFor({ dt, h, R }, M = A.store.mspec) {
  const S = A.store.session, F = S.line.frame, em = L.currentEmitters(M, S.line);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { frame: { u: F.u, v: F.v, d: F.d }, dt, h, R, centers: em.map((e) => [dot(e.pos, F.u), dot(e.pos, F.v)]), cell: 0.5 };
}
async function adRun() {
  const st = adState(), M = A.store.mspec, S = A.store.session;
  if (!S.line) return;
  const avail = stageAvailability(M, adInfo()), stages = { milky: st.sel.milky && avail.milky.ok, leds: st.sel.leds && avail.leds.ok, shape: st.sel.shape && avail.shape.ok };
  st.milkyPart = avail.milky.ok ? (avail.milky.parts.find((i) => M.observe.faces.some((f) => f.part === i)) ?? avail.milky.parts[0]) : null;
  const R = (st.runner = createAdRunner({ ports: A.pool.ports() }));
  A.prog.pause();
  st.running = { frac: 0, text: '준비' }; st.result = null; renderAuto();
  const cur = { milky: st.milkyPart != null ? M.parts[st.milkyPart].material.milky : null, count: M.light.manual?.count ?? 0, pitch: M.light.manual?.pitch ?? 0, shape: null };
  const obs = tallyObs(M.observe, M.observe.dir ?? S.line.frame.d), G = geometry(obs);
  const io = {
    progress: (stage, frac, text) => { st.running = { frac, text }; renderAuto(); },
    cancelled: () => R.stopped,
    async milkyRows(d, ms) {
      const { M: Md, parts } = designScene({ ...d, milky: ms[10] });
      const r = await R.trace(jobFor(Md, parts), { N: 1500000, rw: { part: st.milkyPart, milkies: ms } });   // ≈5초(15 Worker)
      return milkyRows(G, obs, { milkies: ms, batches: r.rwBatches, ess: r.ess, emitted: r.ledger.emitted });
    },
    async basis(d) {   // ① 이 켜져 있으면 실행기가 d.milky = 상한으로 넘김
      const { M: Md, parts } = designScene(d);
      const cand = candidatePositions(S.line, 1), sets = cand.map((s) => [ledAtS(S.line, s, Md.light.manual, getMech3d())]);
      const r = await R.traceEach(jobFor(Md, parts, { emitters: sets[0] }), sets, { N: 20000 });
      return { cand, maps: r.maps, emitted: r.emitted };
    },
    async evalShapes(d, cands, N) {
      const out = [];
      for (const c of cands) {
        if (R.stopped) break;
        const dd = { ...d, shape: { part: st.sel.shapePart, ...c } }, { M: Md, parts } = designScene(dd);
        const H = frameHeights(getMech3d().parts[st.sel.shapePart], S.line.frame, 0.5), mod = Md.parts[st.sel.shapePart].shapeMod;
        const thin = minThickness(H, mod) < (Md.checks?.minWall ?? 0.8);
        const others = getMech3d().parts.map((p, j) => (j === st.sel.shapePart ? null : p));
        const lp = (Md.light.kind === 'step' && L.ledPartsNow(Md)) || [];
        const before = interferenceKeys(getMech3d().parts[st.sel.shapePart], others, lp, []), after = interferenceKeys(parts[st.sel.shapePart], others, lp, []);
        const clash = [...after.keys()].some((k) => !before.has(k));
        if (thin || clash) { out.push({ cand: c, ok: false, why: thin ? '살두께' : '간섭' }); continue; }
        const r = await R.trace(jobFor(Md, parts), { N, batches: 4 });
        const stt = tallyStats(G, r.batches, obs); let tot = 0; for (const b of r.batches) for (const v of b) tot += v;
        out.push({ cand: c, ok: !stt.empty, stats: stt, eff: tot / r.ledger.emitted });
      }
      return out;
    },
    async verify(d) {   // 정밀 재판정: 고정 200만 광자(샘플에서 잡음 ≈ ±2%, 점진 계산 목표와 같은 수준)
      const { M: Md, parts } = designScene(d);
      const r = await R.trace(jobFor(Md, parts), { N: 2000000, batches: 10 });
      const stt = tallyStats(G, r.batches, obs); let tot = 0; for (const b of r.batches) for (const v of b) tot += v;
      return { stats: stt, eff: tot / r.ledger.emitted };
    },
  };
  const H0 = stages.shape ? frameHeights(getMech3d().parts[st.sel.shapePart], S.line.frame, 0.5) : null;
  const pitchNow = cur.count > 1 ? (cur.pitch > 0 ? cur.pitch : S.line.length / cur.count) : S.line.length;
  try {
    const res = await runAutoDesign({
      stages, obs, G, line: S.line, current: cur, milkyMax: st.sel.milkyMax ?? Math.max(cur.milky ?? 0, 5), nMax: Math.max(1, Math.min(60, Math.floor(S.line.length / 2))), pitchRange: null,
      shapePart: st.sel.shapePart, shapeCands: stages.shape ? shapeCandidates({ t0: H0.t0, pitch: pitchNow, hasCenters: true }) : [],
    }, io);
    st.running = null;
    if (res.cancelled) { st.result = null; }
    else {
      const curStats = A.store.session.calc?.stats;
      st.result = { design: res.best, feasible: res.feasible, reason: res.reason, shape: res.best.shape,
        cur: { ...cur, Ulen: curStats?.Ulen, Uwid: curStats?.Uwid, eff: A.store.session.calc?.photometry?.eff ?? NaN },
        best: { ...res.best, Ulen: res.verified.stats.Ulen, Uwid: res.verified.stats.Uwid, eff: res.verified.eff } };
    }
  } catch (e) { st.running = null; st.result = null; setStatus(`자동설계 실패: ${e.message}`); }
  A.prog.resume();
  renderAuto();
}
function adApply() {
  const st = adState(), d = st.result?.design;
  if (!d) return;
  const M = A.store.mspec;
  st.undo = { milky: st.milkyPart != null ? [st.milkyPart, M.parts[st.milkyPart].material.milky] : null, manual: M.light.manual ? { ...M.light.manual } : null, shape: d.shape ? [d.shape.part, M.parts[d.shape.part].shapeMod ?? null] : null };
  if (st.milkyPart != null && d.milky != null) A.store.update('material', (m) => { m.parts[st.milkyPart] = setPartMaterialParam(m.parts[st.milkyPart], 'milky', d.milky); });
  if (M.light.kind === 'manual') A.store.update('light', (m) => { m.light.manual.count = d.count; m.light.manual.pitch = d.pitch; });
  if (d.shape) A.store.update('material', (m) => { m.parts[d.shape.part].shapeMod = shapeModFor(d.shape); applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  st.result = null; renderAuto();
}
function adRevert() {
  const st = adState(), u = st.undo;
  if (!u) return;
  if (u.milky) A.store.update('material', (m) => { m.parts[u.milky[0]] = setPartMaterialParam(m.parts[u.milky[0]], 'milky', u.milky[1]); });
  if (u.manual) A.store.update('light', (m) => { Object.assign(m.light.manual, u.manual); });
  if (u.shape) A.store.update('material', (m) => { if (u.shape[1]) m.parts[u.shape[0]].shapeMod = u.shape[1]; else delete m.parts[u.shape[0]].shapeMod; applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  st.undo = null; renderAuto();
}
function adStep() {
  const d = adState().result?.design;
  if (!d?.shape) return;
  const { parts, M } = designScene(d), mesh = parts[d.shape.part];
  const w = new Worker(new URL('../../export/mesh-step-worker.js', import.meta.url), { type: 'module' });
  setStatus('STEP 생성 중…');
  w.onmessage = (ev) => {
    if (ev.data.type === 'done') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ev.data.stepText], { type: 'application/step' })); a.download = `${M.parts[d.shape.part].name}-p4.stp`; a.click(); URL.revokeObjectURL(a.href); setStatus('STEP 내보내기 완료'); }
    else setStatus(`STEP 실패: ${ev.data.message}`);
    w.terminate();
  };
  w.postMessage({ mesh: { positions: mesh.positions, triangles: mesh.triangles }, name: M.parts[d.shape.part].name });
}
```

연결:
- `cmdHandlers()` 에 `onAuto: () => { const st = adState(); st.open = !st.open; renderAuto(); }` 를 추가한다.
- `renderAll()` 끝에 `renderAuto();` 를 추가한다.
- 현재안 효율은 점진 계산 snapshot 의 `photometry.eff`(progressive.js `snapshot()`)를 쓴다 — 위 코드의 `A.store.session.calc?.photometry?.eff`.
- 비교 중 3D 미리보기: `st.result` 가 있으면 `renderView` 에서 `designScene(st.result.design).parts` 로 `v.setParts(…, { keepCamera: true })` 를 부른다. 취소·적용 때 `A.meshShown = null` 로 원래 장면을 다시 그리게 한다.

- [ ] **Step 6: 스타일** — `styles.css`

```css
#m3-auto { border-bottom: 1px solid var(--m3-line); padding: 8px 10px; font-size: 12px; }
#m3-auto[hidden] { display: none; }
.m3-ad-item { display: block; margin: 2px 0; } .m3-ad-item.off { color: var(--m3-mut); }
.m3-ad-prog { display: flex; gap: 6px; align-items: center; margin: 6px 0; } .m3-ad-prog .bar { flex: 1; height: 6px; background: #e6e9ef; border-radius: 3px; overflow: hidden; } .m3-ad-prog .bar i { display: block; height: 100%; background: var(--m3-acc); }
.m3-cmp { width: 100%; border-collapse: collapse; margin: 4px 0; } .m3-cmp th, .m3-cmp td { padding: 2px 4px; text-align: left; border-bottom: 1px solid var(--m3-line); } .m3-cmp td.chg { color: var(--m3-acc); font-weight: 600; }
```

- [ ] **Step 7: 시험·회귀** — `npm run -s test:m3 < /dev/null && npm run -s test:mech3d < /dev/null` → `all PASS`

- [ ] **Step 8: 커밋**

```bash
git add src/ui/m3/autodesign-panel.js src/ui/m3/command-bar.js src/ui/m3/app.js index.html styles.css test/m3-ui-pure.mjs
git commit -m "feat(m3): auto-design card — stage checks, run/stop, compare, apply/cancel/revert, STEP export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: 브라우저 검증(A-5·A-6·A-7) + 실행 기록

**Files:**
- Modify: `docs/superpowers/plans/2026-10-19-p4-autodesign.md` (끝에 "실행 기록" 절)

- [ ] **Step 1: 미리보기 서버.** `preview_start { name: "uds-alt" }` 로 띄운다(이미 떠 있으면 다시 쓴다). 3D 모드에서 샘플을 불러온다. 커버 Milky 3, 가이드 투명, 관측면 = 커버 윗면.
- [ ] **Step 2: ①만 (A-7·A-6).** 광원을 직접 배치 5개로 둔다. [✨ 자동설계] 에서 ① 만 체크하고 [실행] → 진행 막대 → 비교표가 나오는지 본다. ≤ 30초(A-6). [적용] 하면 커버 Milky 가 바뀌고 계산이 다시 시작되는지, [되돌리기] 하면 원래 값으로 돌아오는지 확인한다.
- [ ] **Step 3: ①+② (A-6 ≤ 90초).** LED 개수가 줄거나 같고, 길이·폭 U 가 목표 이상인지 확인한다. 불가하면 "가장 가까운 안" 과 이유가 나오는지 본다.
- [ ] **Step 4: ③ (A-5·A-6 ≤ 3분).** 대상 = 가이드(투명, 2.5D)로 두고 실행한다. 최적안 길이 U 가 현재안보다 높은지(A-5), 비교 중 3D 미리보기가 바뀐 형상인지 본다. [STEP 내보내기] 로 파일을 받아, 같은 화면의 [📂 기구 불러오기] 대신 Node 로 `readStepParts` 를 돌려 부품 1개가 읽히는지 확인한다.
- [ ] **Step 5: LED STEP 모드.** ② 가 비활성이고 이유 문구가 보이는지 확인한다.
- [ ] **Step 6: 콘솔 오류 0** (`read_console_messages onlyErrors`), 스크린샷을 남긴다.
- [ ] **Step 7: 실행 기록 작성** — 이 문서 끝에 시간·결과·남은 일을 적고 커밋·push 한다.

```bash
git add docs/superpowers/plans/2026-10-19-p4-autodesign.md
git commit -m "docs(plan): P4 auto-design execution log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

---

## spec 대응표 (자체 검토)

| spec | 작업 |
|---|---|
| §1 체크 3개·순서 ②→①→③·고정 | Task 12, 14 |
| §2.1 재가중·21점·ESS 0.3·기준 재설정 최대 3 | Task 1–5, 12 |
| §2.2 후보 1mm·보간 합산·최소 n·피치 범위·비용 | Task 6–8, 13 |
| §2.3 높이맵·변형·범위·27→6→2·제약·STEP | Task 9–11, 12, 14 |
| §2.4 정밀 재판정 | Task 12(`verify`), 13 |
| §3 화면: 카드·진행·중지·비교·3D 미리보기·적용·취소·되돌리기·불가 사유 | Task 14 |
| §5 A-1…A-7 | A-1 Task 3 · A-2 Task 8 · A-3 Task 7 · A-4 Task 9 · A-5·A-6·A-7 Task 15 |

---

## 실행 기록 (2026-10-19, 서브에이전트 방식)

| 작업 | 커밋 | 비고 |
|---|---|---|
| 0 spec 보완 | 98104ce | 포켓 부호, FFD, shapeMod 저장, 메쉬 STEP |
| 1 MC track | a4ddeda | 투명 판 시험: 내부 Fresnel 왕복으로 L = 2 + 4m |
| 2 재가중 계수 | dfe6935 | |
| 3 재가중 지도 + A-1 | e2e5bd8 · 3a4e812 | **실측: Milky 1 차이에 μs ≈ 2.2배 → ESS ≥ 0.3 은 기준 ±0.25 뿐** → spec 개정(창 ±0.25 + 이분 탐색) |
| 4 청크 rw·emitters | 6dcf7dd | combineSources 는 광속 합 |
| 5 Milky 탐색 | 644e008 | milkyAxis 기본 간격 0.025 |
| Phase A 검토 수정 | 2a18313 · 787d0a5 | 장면 DB 고정, 지속 경계, 입력 검증, A-1 판정(총광량 z·행 z·ΔU ≤ 0.03) |
| 6 ledAtS | b04233d | |
| 7 basis + A-3 | bdc6023 | 열린 라인 끝단 손실로 U ≈ 0.54 포화 → 목표 0.5, 해석 최소 8개 = 탐색 8개 |
| 8 A-2 | 0f12583 · fb5f8d1 | 총광량 z 0.39 · 행 최대 z 3.44 |
| 9 형상 FFD + A-4 | 94e9f33 | 포켓 부피 오차 0.001 % |
| 10 런타임 shapeMod | 1b80f67 | |
| 11 메쉬 STEP | 097af23 | |
| Phase C 검토 수정 | ad3623e · d72268d | 정점 용접 + Rivara 세분(300×200 판: 16만→6만 삼각형, 2.8 s→0.3 s, 최소각 0.01°→33.7°), 메모, 두께 하한, STEP 견고화 |
| 12 실행기 | edafb8c | 이분 탐색, ② 는 Milky 상한에서 |
| 13 Worker io | 3c6ab2c | jobFor() |
| 14 화면 | 7f13b56 | 오른쪽 열 `.m3-right`(카드 + 결과) |
| 브라우저 1차 수정 | 0290a39 · 685ef15 · 157321d | 시간 예산 추적, 현재안 같은 추정기, 실행 뒤 계산 재개, 실행 중 편집 보류, LED STEP 표시, 적용 뒤 되돌리기 |
| 브라우저 2차 수정 | 5a6967b · 5de5d17 · e0a42f0 | 형상 후보에 현재 형상 포함, 평활 U 로 순위, **현재안보다 나쁘면 추천 안 함**, 최종 문구 = 재계산 값 |

### 브라우저 검증 (샘플 3부품 + LED STEP 10개, Worker 15개)
- ① 만: 38 초(1차 5 분 → 시간 예산 도입). 상한 5 안에서 목표(0.80/0.80) 불가 → 가장 가까운 안 Milky 3.65 + 이유. 적용 → Milky 3.65, 되돌리기 동작.
- ③ (커버): 85 초. 현재 길이/폭 U 0.73/0.67 → 최적 0.72/0.70, 효율 62.5→65.0 % (폭이 제약이라 채택). 적용 → shapeMod 저장·삼각형 7.3만·윗면 z 12 고정·LED 위 z 10, 되돌리기 → 원래 메쉬.
- ② (직접 배치 10개로 임시 전환): 59 초, 더 나은 배치 없음 → 현재안 유지 + 이유. 광원은 LED STEP 으로 되돌림.
- LED STEP 모드에서 ② 비활성·이유 표시, 실행 뒤 점진 계산 자동 재개, 콘솔 오류 0.
- A-6 목표 대비: ① 38 s(목표 30 s, 근접), ② 59 s(≤ 90 s), ③ 85 s(≤ 3 분).

### 남은 일
- STEP 내보내기 버튼은 브라우저에서 내려받기를 실행하지 않았다(Node 왕복 시험만 통과).
- 속성 패널 머리의 크기·부피 표시는 shapeMod 를 반영하지 않는다(원본·배율 기준).
- ① 시간 30 초 목표에 약간 못 미침 — 높은 Milky 기준점의 최소 광자 수 조정 여지.
| 최종 검토 수정 | e9f2a8c · 785532f | 실행 스냅샷·편집 시 자동 중지·결과 무효화, Worker 시간 제한·공동 중단, 상한 검증, 진행률(단계 가중)·남은 시간·프로파일 비교, 적용/되돌리기 대칭, 접근성 |

- 최종 브라우저 확인: 실행 중 입력 잠금, "남은 약 61초", Milky 편집 → "편집으로 자동설계를 중지함" 후 계산 재개, 콘솔 오류 0. 시험 중 바꾼 값(커버 Milky)은 원래 2 로 되돌림.
