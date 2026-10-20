# 반사 소재 DB · 측정값 보완 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 부품 속성에서 소재를 골라 반사율을 정하고, 측정값으로 반사·투과 소재 DB 를 보완할 수 있게 한다.

**Spec:** `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md` §2.3e (+ §2.3d).

**공통 규칙:** `< /dev/null`, 한국어 UI·간결 주석, 커밋 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push 는 컨트롤러.

### Task 1: 반사 소재 DB 모델 + 연결
- `src/model/reflect-db.js`: `validateReflect(e)`, `createReflectDb(base, user, save)`(list/get/add/remove/update(user only)/exportJson/importJson — materials-db.js 와 같은 규칙: 공용과 같은 id 거부, 잘못된 항목 거부), `entryFromSamples({ name, kind, samples, Rmax? })` → status measured, R = 평균, Rmax = 입력 또는 최대, id = newId(name).
- `data/reflect-db.json`: 기존 DEFAULT_FINISH_CATALOG(housing-led.js) 내용을 항목 형식으로(status 'example', samples []).
- main.js: 시작 시 공용·사용자 불러오기(키 `uds.reflect.v1`), 앱(m3) ctx 에 `reflectDb()` 제공. housing-led.js 의 catalogOf(mspec) 를 `catalogOf(db)`(DB 목록 → 카탈로그 행)로 바꾸고 기존 호출부 전부 갱신. spec.mech3d.finishCatalog 가 있으면 사용자 항목으로 옮기고 삭제(migrate 또는 mount 에서 한 번).
- 시험: test/reflect-db.mjs(검증·추가·중복 거부·평균/최대·내보내기/불러오기·이전 이관) — package.json test:m3 에 추가.

### Task 2: 부품 속성 · DB 관리 화면
- 부품 속성(불투명, mech3d-panel.js reflRowHtml): 선택 목록 = DB 전체(그룹: 기본 / 사용자, 상태 배지), [＋ 측정값으로 소재 추가] 인라인 양식 → 등록 후 이 부품에 적용(setReflMaterial), 기본 항목 선택 중이면 [복사해서 수정].
- DB 관리(기존 catalogTableHtml 자리): 목록(이름·종류·R·상한·상태·측정 수), 사용자 항목 R/상한/이름 편집·삭제·측정값 추가, [내보내기] [불러오기](JSON 파일).
- 투과 부품 속성: [＋ 실측 데이터로 소재 추가] → 대화상자에 `renderAdvanced(el, ctx, desc)`(l2-advanced.js) 를 열고, 저장되면 dbList 갱신·이 부품 dbId 적용. 필요한 ctx(table, db, onDbChanged …)는 평판 모드 l2-panel.js 가 넘기는 것과 같게.
- 시험: m3-ui-pure 에 양식·목록 HTML, 부품 적용 순수 함수.

### Task 3: 브라우저 검증(컨트롤러)
- 케이스 부품: 소재 선택 → 반사율 자동, 측정값 85.5, 86.1, 85.8 로 "사내 백색 PC" 추가 → 적용(R 85.8 %, 상한 86.1 %), 새로고침 뒤 유지, 내보내기·불러오기, 자동설계 ④ 후보에 반영.
- 커버: 실측 맞춤 대화상자 열기·닫기.
