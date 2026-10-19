# ③ 길이·폭 형상 변수 + ① 속도·표시·STEP 곡면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ③ 형상 최적화에 끝단 두께 e(길이 방향)·폭 방향 곡률 c 를 더하고 2단계 탐색(선별 → 압축)으로 고르며, ① 실행 시간을 30 초 안으로, 속성 패널 크기·부피를 실제 메쉬로, ③ STEP 을 B-스플라인 곡면 솔리드로 바꾼다.

**Architecture:** 엔진은 순수 모듈(Node 시험) — `shape-opt.js` 가 변위식에 e·c 항과 라인 좌표 (s,w) 계산(저장된 중심선 폴리라인)을 갖고, `autodesign.js` 에 선별 단계(`screenShapeVars`)를 둔다. 화면(app.js 자동설계 절)은 후보 생성·shapeMod 저장만 바꾼다. STEP 곡면은 `src/export/mesh-step.js` 옆 `spline-step.js` 에서 OCC 로 만든다.

**Tech Stack:** 바닐라 JS ES 모듈, Node 시험(`ok/done`), opencascade.js(full).

**선행:** spec `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md` §2.3a·§2.3b.

**공통 규칙:** 테스트는 `< /dev/null`. 한국어 간결 주석. 커밋 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push 는 컨트롤러.

---

### Task 1: 변위식에 e·c + 라인 좌표(`shape-opt.js`)

**Files:** Modify `src/engine/mech3d/shape-opt.js`; Test `test/mech3d-shape-opt.mjs`.

- 새 순수 함수
  - `pathFromLine(line, F, step = 1)` → `{ path: [[x,y]…], halfW, closed, L }` — 중심선을 1 mm 간격으로 표본(`line.fromSW(s,0)` → 3D `line.to3D(x,y,0)` → 관측 좌표 `toFrame(F, p)` 의 [x,y]). 닫힌 라인은 끝점 중복 없이.
  - `swOnPath(P, x, y)` → `[s, w]` — 폴리라인 최근접 선분 투영(누적 길이 s, 부호 있는 거리 w = 진행 방향 왼쪽 +). 닫힌 경로는 마지막→처음 선분 포함. 성능: 경로 점 ≤ 수천, 정점 수만 → 선분 격자 버킷(셀 = 2 mm)으로 후보 선분만 검사.
  - `endW(s, L, ell)` = 열린 경로에서 `t = min(s, L−s)`, `t < ell ? 0.5(1+cos(π t/ell)) : 0`; 닫힌 경로 0.
- `disp(x, y, prm)` 를 `dt − h·Σbump + (prm.e ?? 0)·endW + (prm.c ?? 0)·min(1, (w/halfW)²)` 로 확장. `prm.path` 가 없거나 e·c 가 0 이면 (s,w) 계산을 건너뛴다(기존과 비트 동일).
- `minThickness`·`deformPart` 는 새 disp 를 그대로 쓴다. `refineForBumps` 는 e·c 가 0 이 아니면 아랫면 전체 세분이 필요할 수 있다: e·c 항은 매끈하고 넓으니 세분 기준에 "w 방향 곡률" 대신 아랫면 삼각형 최대 변 ≤ `max(R/2, 2 mm)` 를 추가(해당 항이 0 이 아닐 때만).
- `shapeCandidates` 는 그대로 두고(호환), 새 `shapeVarRanges({ t0, pitch, hasCenters })` → `{ dt:[lo,hi], h:[lo,hi], R:[lo,hi], e:[lo,hi], c:[lo,hi] }` (h·R 은 hasCenters 일 때만), `gridCandidates(vars, ranges)` → 고른 변수의 {lo, 0(또는 R 은 mid), hi} 격자(고르지 않은 변수는 0, R 은 mid), 현재 형상(전부 0) 포함.
- 시험
  - 직선 판(40×10×2, 중심선 = x 축 방향): `pathFromLine` 대신 직접 만든 경로 `[[0,5],[1,5],…,[40,5]]`, halfW 5. `swOnPath` → (12, 5.0+? ) 같은 점 3개 정확값.
  - e = 0.5, ell = 8: 부피 = 800 + 2·0.5·10·∫₀⁸ endW ds = 800 + 10·(ell/2)·… (해석: ∫₀^ℓ 0.5(1+cos πt/ℓ) dt = ℓ/2 → 부피 증가 = 2·0.5·10·4 = 40) → 840 ±0.5 %.
  - c = −0.5 (가장자리 얇게): 부피 = 800 − 0.5·40·∫_{−5}^{5}(w/5)² dw = 800 − 0.5·40·(10/3) = 733.33 ±0.5 %.
  - e = c = 0 이면 deformPart 결과가 기존과 같음(같은 Float32 배열 값).
  - 닫힌 원 경로에서 endW = 0.
- 커밋: `feat(mech3d): shape vars — end thickness e and width curvature c (line-frame s,w from stored centreline)`

### Task 2: 2단계 탐색(`autodesign.js`)

**Files:** Modify `src/engine/mech3d/autodesign.js`; Test `test/mech3d-autodesign.mjs`.

- `screenShapeVars(evalFn, ranges, vars, obs, { N = 6e4, maxMs = 2500, eps = 0.01, keep = 3 })`:
  - 후보 = 현재 형상(전부 0, R mid) + 각 변수 v 의 lo·hi 하나씩(나머지 0/R mid). R 은 단독으로 의미 없으니 h 와 묶음(h 선별 때 R = mid).
  - `evalFn(cands, N, maxMs)` 한 번 호출 → 점수 `shapeScore` → 각 변수 이득 = max(score(lo), score(hi)) − score(현재). 이득 ≥ eps 인 변수 중 상위 keep 개를 고른다(h 를 고르면 R 도 포함).
  - 반환 `{ vars, gains, results }`.
- `runAutoDesign` ③: `cfg.shapeRanges` 가 있으면 선별 → 고른 변수 없으면 이유 '형상 변수의 효과가 잡음 수준 — 현재 형상 유지' 로 현재안 유지; 있으면 `gridCandidates` → `halving`. (`cfg.shapeCands` 만 있으면 기존 경로 — 호환.)
- 진행률: 선별 11개 + 압축 수를 합친 분모(`halvingTotal`)로.
- 시험(가짜 evalFn): c 만 효과가 있을 때 vars = ['c'], 격자 3개(현재 포함) → halving 결과 c ≠ 0; 효과 없음 → 현재안 유지 이유; h 선별 시 R 포함.
- 커밋: `feat(mech3d): ③ two-stage search — screen shape variables then halving on the selected grid`

### Task 3: 화면 연결(app.js 자동설계 절 + 비교표)

**Files:** Modify `src/ui/m3/app.js`, `src/ui/m3/autodesign-panel.js`; Test `test/m3-ui-pure.mjs`.

- `shapeModFor(shape, M, line)` → shapeMod 에 `e, c` 와 `pathFromLine(line, F)` 결과(`path, halfW, closed, L`), `ell = pitch`(LED 피치 — 직접 배치·가상 배치면 그 값, LED STEP 원래면 발광점 간 평균 간격, LED 1개면 L/4) 저장.
- `adRun` ③: `shapeRanges = shapeVarRanges({ t0, pitch, hasCenters })`, `cfg.shapeRanges` 로 넘김(cfg.shapeCands 는 넘기지 않음). io.evalShapes 는 후보 객체에 e·c 가 있어도 그대로 동작해야 함(designScene → shapeModFor).
- 비교표 형상 칸: `두께 +0.5 · 포켓 0.4 R 6 · 끝단 −0.3 · 폭곡률 +0.2 mm` 식(0 인 항 생략). 선별 결과(변수별 이득)를 결과 카드 아래 한 줄로: `효과: 폭곡률 +0.06 · 끝단 +0.02 (두께·국부 형상 효과 없음)`.
- 시험: 비교표 형상 문구, 선별 요약 문구.
- 커밋: `feat(m3): ③ length/width shape variables in auto-design UI`

### Task 4: ① 속도

**Files:** Modify `src/engine/mech3d/autodesign.js`(searchMilky), `src/ui/m3/app.js`(현재안 재사용, 예산); Test `test/mech3d-autodesign.mjs`.

- `runAutoDesign` 이 `cfg.currentVerified` 를 받으면 `io.verify(cfg.current)` 를 건너뛴다. app: 점진 계산 snapshot 이 state 'done' 이고 sceneKey 가 지금 장면이며 `relNoise ≤ targetNoise` 면 그 stats·eff 로 currentVerified 를 만든다.
- searchMilky 다음 기준점: 지금까지 기준점들의 (milky, best.margin) 로 할선 근(두 점 이상, 구간 [lo,hi] 안이면) — 아니면 이분. 기존 시험(기준 수 ≤ 8, 결과 ≈ 2.5) 유지 + 할선이 기준 수를 줄이는 시험.
- app: 탐색용 기준점 trace `{ N: 1.5e6, maxMs: 2000, minN: 1e5 }`.
- 커밋: `perf(m3): ① faster — reuse converged current result, secant re-basing, smaller exploratory budget`

### Task 5: 속성 패널 크기·부피

**Files:** Modify `src/ui/mech3d-panel.js`(renderPartProps 머리), `src/ui/m3/property-panel.js`, `src/ui/m3/app.js`(ui 에 실제 메쉬 외곽·부피 전달); Test `test/m3-ui-pure.mjs`.
- 머리 = 실제 장면 메쉬(getMech3d().parts[i]) 외곽 X×Y×Z·부피(`meshVolume`). shapeMod 가 있으면 뒤에 ` · 형상 변경됨`.
- 커밋: `fix(m3): part header shows actual mesh size/volume (size/position/shape applied)`

### Task 6: ③ STEP 곡면 솔리드

**Files:** Create `src/export/spline-step.js`; Modify `src/export/mesh-step-worker.js`(입력에 `spline` 있으면 곡면 경로), `src/ui/m3/app.js` adStep; Test `test/mesh-step.mjs`.
- 조건: 관측 좌표 높이맵 채움률(마스크 칸 / 외곽 칸) ≥ 0.98, 윗면 zt 편차 ≤ 0.01 mm, 비 2.5D 0.
- 만들기(OCC): 관측 좌표 직사각형 외곽 [x0,x1]×[y0,y1], 격자 nx×ny(간격 ≤ R/4, nx·ny ≤ 120×60)에서 변형 아랫면 z_b'(x,y)(= zb − D) 표본 → `TColgp_Array2OfPnt` → `GeomAPI_PointsToBSplineSurface` → 면 → `BRepPrimAPI_MakePrism`(+d 방향, 높이 = 두께 최대 + 1) → `BRepAlgoAPI_Common` 과 외곽 상자([x0,x1]×[y0,y1]×[zbMin−1, zt]) → 관측 좌표 → 월드 변환(gp_Trsf: u,v,d 기저 + 원점) → STEP.
- 실패하면(어떤 OCC 오류든) 기존 메쉬 꿰매기로 대신하고 상태 문구에 '곡면 맞춤 실패 — 삼각형으로 내보냄'.
- 시험(Node OCC): 40×10×2 판, 포켓 h=0.5 R=4 중심 2곳 → 곡면 솔리드 1개, 부피 = 해석값 ±1 %, STEP 크기 < 200 KB, 시간 기록.
- 커밋: `feat(export): ③ STEP as B-spline bottom solid for rectangular 2.5D parts (mesh fallback)`

### Task 7: 브라우저 검증(컨트롤러)
- ③ (커버, 새 변수) 실행 → 선별 요약·비교·적용·되돌리기, 시간.
- ① 시간(목표 ≤ 30 초).
- 속성 머리 크기·부피.
- STEP 곡면: 생성 시간·크기, 다시 읽어 부피 비교.
- 실행 기록.
