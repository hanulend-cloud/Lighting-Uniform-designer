# ④ 케이스 면 처리 · ⑤ LED 높이 자동설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동설계에 ④ 케이스 면 처리(반사율·백색/경면)와 ⑤ LED–커버 거리(LED 높이)를 체크형 단계로 추가한다.

**Architecture:** 엔진(순수): `autodesign.js` 에 이산 후보 평가 단계 `pickVariant(cands, evalFn, obs, rule)`(6만 광자 전체 → 상위 2 정밀) 과 실행 순서 ② → ⑤ → ④ → ① → ③, 설계 객체에 `finish: {part, kind, R} | null`, `dz: number`. `housing-led.js`(새) 에 후보 생성 `finishOptions(current)`·등급 순서, 높이 범위 `ledHeightRange({...})`(clearance 의 travelDistance 활용) 순수 함수. 화면(app.js 자동설계 절·autodesign-panel.js): 체크박스 ④⑤, ④ 대상 부품 선택, designScene 이 finish·dz 반영, 적용·되돌리기, 비교표 행.

**Spec:** `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md` §2.3c.

**공통 규칙:** `< /dev/null`, 한국어 간결 주석, 커밋 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push 는 컨트롤러.

### Task 1: 엔진 — 후보·범위·단계(순수)
- `src/engine/mech3d/housing-led.js`: `FINISH_GRADES = [{kind:'whiteDiffuse',R:.85},{…,R:.90},{…,R:.95},{…,R:.97},{kind:'metal',R:.88},{kind:'metal',R:.95}]`, `gradeOf(f)`(등급 순서 = 반사율 오름차순, 같은 R 이면 백색 먼저), `finishOptions(current)` = 등급 목록 ∪ 현재(중복 제거, 등급 순 정렬); `ledHeightRange({ up, down, margin = 0.3 })` → [−max(0,down−margin), max(0,up−margin)], `heightCandidates([lo,hi], n=7)` (0 포함).
- `autodesign.js`: `pickVariant(cands, evalFn(cands,N,maxMs), obs, { prefer: 'lowestPassing' | 'best', keep: 2, N1: 6e4, N2: 3e5 })` → 1차 전체·2차 상위 keep 정밀 → 규칙대로 하나. runAutoDesign 에 stages.height(⑤: cfg.heightRange, io.evalVariants(d, cands, N, maxMs) — 후보는 `{dz}`), stages.housing(④: cfg.finishCands, 후보 `{finish}`) 를 ②와 ① 사이에 넣고 d 에 반영. sameDesign 에 dz·finish 포함. 진행률 단계 가중치 추가(autodesign-panel overallFrac: height 20, housing 20).
- 시험(test/mech3d-autodesign.mjs·새 test/mech3d-housing-led.mjs): 등급 순서, 후보에 현재 포함, 범위·여유, pickVariant 가 lowestPassing 에서 통과 후보 중 등급 최저를 고름, 통과 없으면 점수 최고, 실행 순서 ②→⑤→④→①→③(가짜 io 호출 순서 기록).

### Task 2: 화면 연결
- autodesign-panel.js: stageAvailability 에 height(직접 배치 기구 면 PCB 면 불가 이유), housing(불투명 부품 없으면 불가); 카드 체크박스 ④⑤ + ④ 대상 select(기본: 관측 부품을 둘러싼 가장 큰 불투명 부품 — 외곽 상자가 관측 부품 외곽을 포함하는 것 중 부피 최대, 없으면 불투명 부품 중 부피 최대); 비교표 행 `케이스 면  백색 85% → 백색 95%`, `LED 높이  현재 → +1.2 mm(커버까지 5.3 mm)`.
- app.js: designScene(d, ctx) 가 d.finish(그 부품 finish 교체)·d.dz(STEP: step.offset 에 dz·d 더함 + emitters 는 transformEmitters 로 함께 이동 / 가상 배치는 stepLayout 이 offset 을 따름 / 직접 배치 깊이: pcb.depth −= dz) 반영; 높이 범위 계산: STEP(원래·가상) = LED 부품 전체(PCB 포함)를 한 덩어리로 보고 clearance.travelDistance(+d, −d) 를 기구 부품에 대해(LED 부품 각각의 최소), 직접 배치 깊이 = 발광점에서 +d/−d 광선으로 첫 부품까지 최소; io.evalVariants 구현(후보마다 designScene → jobFor → R.trace, 형상 평가와 같은 예산 방식); adApply/adRevert 에 finish·dz(STEP offset / 직접 배치 depth) 추가, 되돌리기 정확히.
- 시험(test/m3-ui-pure.mjs): 가능 여부·기본 대상 선택 순수 함수·비교표 문구.

### Task 3: 브라우저 검증(컨트롤러)
- 샘플: ④ 만 → 현재 백색 85% 에서 목표 미달이면 등급 상향 추천/불가 이유, 적용·되돌리기. ⑤ 만 → 범위·추천 높이, 적용 시 LED 가 3D 에서 이동, 되돌리기. 시간 기록.
