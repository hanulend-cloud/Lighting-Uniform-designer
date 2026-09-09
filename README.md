# Uniform Design Simulator (UDS)

조명기구 **균일도 설계 1차 사양 엔진** — 염가화(최소 부품)·생산성·균일 품질의 Trade-off 최적안을 수식·휴리스틱으로 도출합니다.
설계 마스터 문서: [`프로젝트.md`](./프로젝트.md)

> **v0.1 / Phase 1**: 직하형(Direct-lit) 방식, 브라우저 단독 연산(무빌드). 엣지형 도광판·몬테카를로 렌더링은 Phase 2.

## 실행

정적 파일이라 서버만 있으면 됩니다.

```bash
# 방법 1
npx --yes serve .          # http://localhost:3000

# 방법 2
python -m http.server 5173 # http://localhost:5173
```

브라우저에서 위 주소를 엽니다. (ES module 이라 `file://` 직접 열기는 불가)

## 기능 (Phase 1)

| 영역 | 내용 |
|---|---|
| 광학 | 역제곱 + 배광(Lambertian/Gaussian), 근접장 발광면 분할 적분, 측벽 1-bounce(입사각별 프레넬 반사, 몸체 굴절률 기준), L2 확산 = 후방산란→기판 반사(0.5) 재순환 모델(blur ∝ 깊이)·투과율 |
| 균일도 | U0 = E_min/E_avg(1순위), CV(RMSE), 국부 gradient, E_min/E_max — 평가면: 출광면 바로 위 |
| 배열 | LED 2D/3D(선형/평면) 자동 분류, 피치·수량 산출 |
| 최적화 | coarse grid 탐색 → 제약 필터 → Pareto front → Top 2 (최저비용 / 균일도 여유), 민감도 |
| 비용 | LED·형상 난이도·금형 상각(÷생산수량)·조립 휴리스틱 (`src/model/defaults.js` 계수 조정) |
| I/O | 실시간 반영, 입력값 JSON 저장/불러오기, localStorage 자동 저장 |
| 내보내기 | STEP(AP214) 3D CAD 파일 내보내기 — 바디·LED·PCB 솔리드, Web Worker(OpenCASCADE.js)로 UI 안 멈추게 처리 |

## 구조

```
index.html · styles.css
src/
  model/defaults.js     입력 사양 + 비용 계수 + 탐색 범위
  engine/photometry.js  배광 모델
  engine/directLit.js   직하형 조도장 계산
  engine/uniformity.js  균일도 지표
  engine/cost.js        비용·DFM 휴리스틱
  engine/optimizer.js   1차 최적화 + Pareto + Top 2
  ui/heatmap.js         히트맵·프로파일 렌더
  main.js               UI 배선 + 실시간 재계산
  export/                내보내기(STEP) — OpenCASCADE.js 기반, 별도 문서: docs/superpowers/plans/2026-09-09-step-export.md
```

## 로드맵

- **Phase 1** (현재): 벤치마크 케이스에서 균일도 예측 오차 ±5%p 이내, Top 2 + 리포트 자동 생성
- **Phase 2**: 몬테카를로 광선추적 3D 검증, 기구 3D 형상·미세패턴 자동 최적화, 엣지형 도광판 모듈

## 보정 필요

확산 계수(L2: `src/model/levels.js` 의 기판 반사율 `BOARD_REFL`·후방산란율 0.9, L3~L5 blur 식), 비용 단가는 임시값입니다. 실측/해석해로 캘리브레이션하세요 (`프로젝트.md` §3.7).

## License

MIT — see [LICENSE](./LICENSE).
