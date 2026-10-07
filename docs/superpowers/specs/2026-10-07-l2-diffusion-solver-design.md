# L2 확산소재 Solver 재설계 — 설계 문서

- 날짜: 2026-10-07
- 대상: `src/model/levels.js` L2 분기, `src/engine/directLit.js` blur 경로
- 후속: 동일 패턴(전용 solver + 기준 + 자체검증)을 L3·L4 에 적용(별도 spec)

## 1. 배경·문제
현 L2 는 단일 Gaussian blur + 추정 재순환식(`Rd=0.9t`, `BOARD_REFL=0.5`, `σ≈0.77d·√(ρ/(1-ρ))`).
계수가 물리 유도가 아닌 추정값이고, 결과를 기준과 대조하는 장치가 없어 기구설계자가
결과를 신뢰할 근거가 없다(평가 이슈 E1).

## 2. 조사 결과 (근거)
| 항목 | 내용 | 출처 |
|---|---|---|
| 업계 표준 모델 | 확산 플라스틱 = 체적 산란(Mie 또는 HG 위상함수 + 평균자유행로). LightTools·Speos 동일 | LightTools white paper "Modeling diffuse plastic"; SPIE 13131 (Mini-LED BSD) |
| HG 파라미터 | 확산판 g ≈ 0.92~0.955, 2mm 단일 통과 투과 56~99% | USPTO 7789538, HG in MC (Jacques) |
| 기준해 | Adding-Doubling(Prahl): 슬래브 R/T 결정론 해, 고유오차 <3%. `iadpython` 사용 가능 | Prahl 1993, iadpython docs |
| 시스템 모델 | 직하형 BLU: LED별 확산 함수(LSF) 중첩 + 측벽 반사 → 상용 SW 대비 MAPE 0.5~0.7% | NCU 108585 |
| 소재 사양 | 벤더는 전광선투과율·Haze(ASTM D1003)·반광각 HPA(예 Makrolon DQ 19/43/56°) 제공 | Covestro DQ |

## 3. 결정 사항
- 접근: **C 하이브리드** — MC 로 계산한 슬래브 응답 테이블 + 결정론 캐비티 재순환 solver + 기준 자동 대조.
  (A 가우시안 재피팅: 근본 한계 동일 / B 매 평가 전체 MC: 자동탐색 수백 회에 느리고 노이즈)
- Milky 입력 유지, 범위 **0~10** (0=투명, 10=완전확산/불투명 수준 차폐).
- 실소재 등록: **각도-강도 CSV** 와 **데이터시트 수치(T·HPA·두께)** 둘 다 지원. BSDF 파일 파서는 후속.

## 4. Milky 정의 (차폐력 지표)
- **Milky = 10 × min(1, HPA / 60°)**
  HPA = 법선 입사 시 투과 광도 I(θ) 가 I(0) 의 1/2 이 되는 각. Lambertian 투과면 HPA=60° → 10.
  투명은 정투과 스파이크가 남아 HPA≈0 → 0 (LED 비침 = 차폐력 0).
- Milky 는 **두께 의존**: 같은 소재도 두꺼우면 Milky 상승. 몸체 두께(L1 thk) 변경 시 재계산.
- 추상 슬라이더 값 m → (g = 0.9 기본) 에서 HPA(τ)=6m° 를 만족하는 τ = μs·t 를 테이블 역보간.
- 참고 환산(검증 대상): DQ 19°/43°/56° → Milky ≈ 3.2 / 7.2 / 9.3.

## 5. 구성 요소

```
src/engine/l2/
  mc-slab.js        슬래브 MC (HG, Fresnel/TIR, 흡수) — Node·브라우저 공용 순수 함수
  build-table.mjs   오프라인 테이블 생성 스크립트 (node) → slab-table.bin + meta.json
  slab-table.js     테이블 로드·보간 (τ, g, n, θ_in) → T, R, 측방 커널, 각분포
  milky.js          Milky ↔ τ 변환, HPA 계산
  cavity-solver.js  캐비티 재순환 solver (FFT 주파수영역 닫힌 해)
  validator.js      V1~V6 자체검증 + 상태 객체
  ref-ad.json       iadpython 기준값 (오프라인 생성, 커밋)
src/model/materials.js  등록 소재 목록 + 피팅 (CSV / 데이터시트)
tools/gen-ref-ad.py     iadpython 으로 ref-ad.json 생성
```

### 5.1 슬래브 MC (`mc-slab.js`)
- 1D 무한 슬래브, 두께 1(무차원; 커널은 t 배수 단위). 입력 τ=μs·t, g, n, 알베도 a=0.999, 입사각 θ_in(공기 기준).
- 광자 가중치 + Russian roulette, HG 샘플링, 상/하면 Fresnel(편광 평균)·TIR 확률 분기.
- 출력: T_total, R_total, 투과 출사 위치 반경 히스토그램(입사점 기준, 평균 시프트 Δ 분리, 40 bin, r/t ≤ 20),
  법선 입사 투과 각분포 I(θ) 18 bin, 반사 총량. 에너지 수지 기록.

### 5.2 테이블 (`build-table.mjs`, `slab-table.js`)
- 격자: τ 32점(0 + log 0.05~300), g {0.6, 0.8, 0.9, 0.95}, n {1.49, 1.59, 1.70}, θ_in 9점(cos 균등 0~85°).
- 광자 수: 셀당 2×10⁵ (생성 시간 수 분, 1회). Float32 바이너리 ≈ 1MB 이내.
- 런타임 보간: τ 로그-선형, g·n·θ 선형.

### 5.3 캐비티 재순환 solver (`cavity-solver.js`)
- 기하: LED 기판 z=0, 공기 갭 h = depth − thk, 슬래브 두께 thk(L1), 관찰면 = 상면 +0.1mm.
- ① LED 직접 조도를 슬래브 하면(z=h)에서 입사각 밴드별로 분리(기존 LED 배광 모델 재사용).
- ② 1차 투과: M₁ = Σ_band K_T(band) ⊛ E_band.
- ③ 재순환: 반사분 R·E 는 슬래브 하면 Lambertian 방출 → 갭 전달 커널 P_h(r)=h²/(π(r²+h²)²) →
  기판 반사 ρ_b=0.5 → P_h → 확산 입사(T_diff, R_diff 는 θ 가중평균).
  주파수 영역 닫힌 해: Ĝ = 1 / (1 − ρ_b·R_diff·P̂_h²), M̂_rec = K̂_Td·ρ_b·P̂_h²·Ĝ·(R̂E).
- ④ 측벽: 거울 확장(이미지) × 벽 반사율(기존 프레넬 벽 근사와 동일 값).
- ⑤ 출력: 상면 출사도 M(x,y) → 조도. 휘도는 MC 각분포의 법선 성분 계수로 환산(Lambertian=1/π).
- 다른 난이도와 결합: L2 는 combinedEffect 의 blur/transmit 에서 제외하고 이 solver 로 처리,
  L5 등 나머지 blur 는 그 뒤에 기존대로 적용.
- 성능 목표: 100×100 타겟 1회 평가 ≤ 30ms (기존 자동탐색 총 시간 증가 ≤ 30%).

### 5.4 자체검증 (`validator.js`)
| ID | 검사 | 기준 | 시점 |
|---|---|---|---|
| V1 | 테이블 T/R vs Adding-Doubling(`ref-ad.json`, n 1.49/1.59, g 0.9, τ 0.5~50, 법선·확산 입사) | \|Δ\| ≤ 0.02 | 로드 시 + 테스트 |
| V2 | 에너지 수지: 슬래브 T+R+A=1 / 시스템 LED 광속 = 출사+흡수(기판·슬래브·벽) | ≤ 0.5% / ≤ 1% | 테스트 / 매 평가 |
| V3 | 극한: τ=0 → T=(1−R_F)²/(1−R_F²) (n=1.59 → 0.9013), Milky 0 결과 = L1 단독 | ≤ 0.5% / ≤ 1% | 로드 시 + 테스트 |
| V4 | 단조성: τ↑ → T 비증가, HPA 비감소, 커널 RMS 폭 비감소 | 위반 0 | 로드 시 |
| V5 | 문헌 벤치마크 van de Hulst 슬래브(a=0.9, τ=2, g=0.75, n=1) R_d, T_t — iadpython 으로 재확인한 값 | \|Δ\| ≤ 0.005 | 테스트 |
| V6 | 등록 소재 피팅 재현: HPA ±2°, T_total ±2%p, CSV 곡선 RMS ≤ 5% | 위반 시 "보정 불일치" | 등록 시 |
| V7 | 결과 건전성: NaN/음수 없음, 균일도 ∈ [0,1], 출사 ≤ 입력 | 위반 0 | 매 평가 |

- 상태 객체 `{ ok, checks:[{id, ok, value, limit}] }` 를 UI 로 전달.
- UI: L2 카드에 `solver 검증 ✅` 배지(호버 시 V별 값). 실패 시 ❌ + 판정 카드 "신뢰 불가" 로 표시, 정상 결과처럼 보이지 않게 함.

## 6. 실소재 등록 (`materials.js`)
- 입력 A(데이터시트): 두께 t_s, 전광선투과율 T, HPA (Haze 선택).
- 입력 B(CSV): `theta_deg, intensity` 열 + T, t_s.
- 피팅: 테이블 위에서 (τ, g) 2변수 격자→국소 탐색, 목적 = HPA·T(·곡선) 오차. 결과 μs = τ/t_s, g.
- 저장: spec 내 `materials[]` (JSON 저장/불러오기에 포함, `ver` 13 마이그레이션).
- 표시: 현재 두께에서 각 소재의 Milky 를 계산해 슬라이더 위 마커(▼ 소재A 2.5). 소재 선택 시 μs·g 고정 사용,
  추상 슬라이더 사용 시 가장 가까운 등록 소재명 표시.

## 7. UI 변경 (최소)
- L2 Milky: 범위 0~10, 기본 0. 저장 스펙 마이그레이션: 기존 1~10 값 → (m−1)/9×10. 솔버 자동탐색 범위도 0~10. 툴팁 "차폐력 지표: 0 투명 ~ 10 완전확산(HPA 60°)".
- 소재 선택 드롭다운 + "소재 등록" 버튼(모달: 데이터시트/CSV).
- 검증 배지. 투과율·Milky·HPA 를 결과 줄에 표시.

## 8. 테스트
- `test/l2-mc.mjs`: V2·V3·V5 (MC 직접 실행, 소수 광자로 빠르게 + 허용오차).
- `test/l2-table.mjs`: V1·V4 (테이블 vs ref-ad.json).
- `test/l2-cavity.mjs`: 시스템 에너지 수지, Milky 0 = L1 동일, Milky↑ → 균일도 비감소(같은 배치) 및 투과율 감소.
- `test/l2-material.mjs`: 합성 소재(알려진 τ,g)로 데이터시트·CSV 생성 → 피팅 복원 오차.
- 기존 테스트 전부 통과.

## 9. 설계 agent 지침 반영
`.claude/agents/uds-tool-designer.md` 에 "난이도별 Solver 규약" 추가:
각 L2/L3/L4 solver 는 ① 물리 근거·출처 ② 독립 기준해(해석해/AD/문헌) ③ V 계열 자체검증과 UI 배지
④ 기준 데이터 생성 스크립트를 반드시 갖춘다. 평가 agent 체크리스트 A 에 "solver 검증 배지" 항목 추가.

## 10. 범위 밖
- L3·L4 전용 solver (같은 패턴, 후속 spec)
- Speos/LightTools BSDF 파일 파서
- 실측 소재 데이터 확보·캘리브레이션 자체 (등록 기능만 제공)
- 파장/색 의존 산란(옐로링)
