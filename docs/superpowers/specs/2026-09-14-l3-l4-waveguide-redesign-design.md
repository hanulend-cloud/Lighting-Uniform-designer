# L3/L4 통합 및 자유형상 도파관(신규 L4) — 설계 문서

## 배경

현재 L3(형상·기본: `wallThk`/`edgeAngle`/`edgeR`)와 L4(형상·정밀:
`gap`/`flatX`/`flatY`/`angleX`/`angleY`/`rise`/`radiusX`/`radiusY`)는 서로
대체 관계(L4 on → L3 대체)인 두 개의 별도 "형상" 레벨이다. 실측 결과:

- L3의 LED 절감 효과는 사실상 `wallThk` 하나가 전부다. `bulkBlur =
  K_RANGE·wallThk·fracTrapped`([levels.js:131-139](../../../src/model/levels.js#L131-L139))만
  이 균일도에 단조적으로 기여하고, `fracTrapped`는 `wallThk`와 무관(n·LED
  beam각으로만 결정)이다.
- `edgeAngle`/`edgeR`이 만드는 `edgeBoost`는 위치 의존 국소 보정이지만
  "기존 필드 최댓값을 넘지 않는" 캡이 걸려 있어([directLit.js:274-279](../../../src/engine/directLit.js#L274-L279))
  설계상 항상 약한 보조 효과로 제한된다 — 독립적인 LED 절감 레버가 아니다.
- L4의 광학식(`levelEffect` case 4, [levels.js:152-157](../../../src/model/levels.js#L152-L157))은
  `angleX/Y·radiusX/Y·rise·depth`만 쓰는 순수 경험적(피팅) 수식이며 굴절률
  n·임계각과 무관하다. `flatX/flatY/gap`은 광학 계산에 전혀 반영되지 않고
  LED 배치 여유·바디 형상에만 쓰인다([geometry.js:44](../../../src/model/geometry.js#L44),
  [levels.js:276-277](../../../src/model/levels.js#L276-L277)). 즉 L4는 형상을
  바꿔도 물리적으로 검증된 메커니즘과 연결되어 있지 않아 사용자가 체감하는
  "확실한 확산 효과"가 없다.

두 레벨 모두 "형상"이라는 같은 목적을 위해 존재하지만 실질적 차별화가 없어
혼란만 준다. 이번 재설계로 (1) 검증된 메커니즘(wallThk)만 남긴 단순한 L3로
통합하고, (2) 그 메커니즘을 X·Y축 각각에 독립 적용해 진짜 형상 자유도와
확실한 광학 효과를 동시에 주는 새 L4를 설계한다.

## 범위

- 대상: `src/model/levels.js`(스키마·물리효과·단면형상),
  `src/engine/directLit.js`(edgeBoost 일반화), `src/model/geometry.js`(L4
  전용 형상 코드 제거), 관련 UI(`src/ui/analysis.js` 등 L4 필드 렌더링),
  export 경로(`src/export/*`)의 L4 참조.
- 제외: L1(평판 두께)·L2(확산소재)·L5(미세패턴)는 변경 없음. STEP 내보내기의
  로프트/필릿 근사 전략 자체는 유지하고, 새 형상 함수만 갈아 끼운다.
- 마이그레이션 없음: 저장된 구 spec의 `levels[4]` 필드(`gap/flatX/...`)는
  로드 시 무시한다. `LS_KEY`(현재 `uds.spec.v9`) 버전을 올려 구 로컬스토리지
  값과 섞이지 않게 한다. JSON 불러오기도 동일하게 알 수 없는 구 필드는 무시.

## 1. 통합 L3 (기존 유지, L4 폐지)

파라미터·물리모델 변경 없음 — `wallThk`/`edgeAngle`/`edgeR`,
`bulkBlur`+`edgeBoost` 공식 그대로. 제거할 것:

- `LEVEL_SCHEMA[4]`, `LEVEL_DEFAULTS[4]`
- `activeLevels`/`levelEffect`/`bodyProfile` 등에서 "L4가 L3 대체"
  분기(`if (l === 3 && A.has(4)) continue`, `useL4`/`useL3` 판정)
- L4 전용 형상 함수(`l4BotZAt` 계열)와 `geometry.js`의 `kind: 'L4'` 분기
- UI에서 L4 카드가 차지하던 자리는 새 L4로 대체(레벨 번호·2x2 배치 구조는
  유지)

## 2. 새 L4 — X·Y 독립 3점 두께 프로필

### 파라미터

축당 3점(중심 0%, 중간 50%, 가장자리 100%)을 X·Y 독립으로 입력받는다.
중심→가장자리 반쪽만 입력하고 반대쪽은 대칭으로 미러링한다. 총 6개 입력:

| 필드 | 의미 | 단위 | 범위(안) |
|---|---|---|---|
| `tx0` | X축 중심 두께 | mm | `[minThk, maxThk]` |
| `tx50` | X축 중간(50%) 두께 | mm | `[minThk, maxThk]` |
| `tx100` | X축 가장자리 두께 | mm | `[minThk, maxThk]` |
| `ty0`/`ty50`/`ty100` | Y축 동일 | mm | 〃 |
| `edgeR` | 모서리 라운드(기존 L3와 동일 의미, 재사용) | mm | 기존과 동일 |

`minThk`/`maxThk`는 기존 L3와 동일한 물리적 상한·하한 계산을 재사용한다
(`minThk = max(1, baseThk·0.5)`, `maxThk = depth - ledSizeZ - 0.5`). 세
점 사이는 구간별 선형 보간(piecewise-linear)이며, 단조 감소를 강제하지
않는다(중간 지점을 더 두껍게/얇게 설정하는 비단조 형상도 허용 — 이게
"형상 자유도"의 핵심).

### 광학 모델

**주 메커니즘(핵심 개선, 캡 없음)**: 오늘 L3에서 이미 검증된 공식을 축별로
독립 적용한다.

```
bulkBlurX = K_RANGE · tx0 · fracTrapped
bulkBlurY = K_RANGE · ty0 · fracTrapped
```

`computeField`가 이미 `blurMmX`/`blurMmY`를 독립적으로 받으므로
([directLit.js:205-206](../../../src/engine/directLit.js#L205-L206)) 새
계산 경로 추가 없이 `levelEffect` 반환값만 축별로 나누면 된다. `K_RANGE`·
`fracTrapped`는 기존 L3와 동일하게 `body.n`·LED beam각에서 유도한다(전역
입력이므로 X·Y 공용).

이 항은 캡이 없으므로 `tx0` ≠ `ty0`이면 X·Y 균일도가 실제로 다르게
나타난다 — "확실한 독립 효과"를 물리적으로 보장하는 부분이며, 이번
재설계의 존재 이유다.

**보조 보정(기존 edgeBoost 일반화)**: `applyEdgeBoost`를 1구간 선형(현재)에서
0→50%, 50→100% 2구간 piecewise로 확장해 `tx50`/`ty50`이 국소 형상(가장자리
근처의 볼록/오목)에 반영되도록 한다. 캡("기존 필드 최댓값을 넘지 않음")은
그대로 유지 — 이 항이 새로운 최댓값을 만들어 비단조 악화를 일으켰던 과거
버그([levels.js:274-279](../../../src/engine/directLit.js#L274-L279) 주석
참고)를 재현하지 않기 위해서다.

### 형상(바디/STEP 내보내기)

광학은 축별 근사를 쓰지만, 실제로 출력되는 solid는 하나의 일관된 높이장이어야
한다:

```
thickness(x, y) = min(Tx(edgeDistX), Ty(edgeDistY))
```

`Tx`/`Ty`는 각 축의 3점 piecewise-linear 프로필. 모서리는 기존 `cornerR`
방식(두 축 거리의 `hypot` 블렌드)을 재사용해 라운드 처리한다. `bodyProfile`/
STEP 로프트 단면 샘플링에는 이 `thickness(x,y)`를 그대로 사용하므로, 화면
표시와 STEP 형상이 항상 일치한다는 기존 원칙([STEP 설계 문서](2026-09-09-step-export-design.md)
40-42행)을 유지한다.

### 검토 후 기각한 대안

완전한 2D 로컬 두께장 기반 위치별 가변 블러(광학적으로 더 정합적 — 소스마다
자기 위치의 실제 두께로 산란 반경을 계산)는 입력이 바뀔 때마다 즉시
재계산해야 하는 이 앱의 특성상 공간가변 컨볼루션 비용이 급증할 위험이 있어
이번 버전에서는 보류한다. 대신 축별 독립 bulk-blur(계산량 증가 없음)로 같은
목표(형상에 따른 확실한 광학 차이)를 달성한다.

## 3. 자동탐색(auto-tune) 영향

- `extremeDiffusionParams`: 필드가 3개(L3)에서 6개(신규 L4)로 늘어도
  좌표하강 비용은 필드 수에 선형으로만 증가 — 실질적 성능 문제 없음.
- `autoTuneLevel`의 "확산 최소↔최대 1축 보간(5개 샘플)" 구조
  ([solver.js:322-363](../../../src/engine/solver.js#L322-L363))는 변경하지
  않는다. 참고치 품질은 기존과 동일 수준(더 정교한 다차원 탐색은 이번 범위
  밖).

## 마이그레이션

- `LS_KEY`(`src/main.js`) 버전 문자열을 올려 구 저장값과 분리한다.
- JSON 불러오기(`importJson`)는 `levels[4]`에 구 필드(`gap/flatX/...`)가
  와도 무시하고 새 스키마 기본값(`LEVEL_DEFAULTS[4]`)으로 채운다 — 별도
  변환 로직(호환 shim)은 만들지 않는다.

## 테스트 계획

- 기존 스모크 테스트(`test/smoke.mjs` 등)가 L4 관련 필드를 참조하는 부분을
  새 스키마에 맞게 갱신.
- 신규: `tx0 ≠ ty0`일 때 X·Y 방향 균일도(`unifC`/프로파일)가 실제로
  달라지는지 확인하는 케이스(축별 독립 효과가 살아있는지의 회귀 방지).
- 신규: `min(Tx, Ty)` 코너 결합이 `edgeR` 라운드와 함께 자연스러운
  솔리드(음수 두께·모순 없음)를 만드는지 형상 계산 단위 테스트.
