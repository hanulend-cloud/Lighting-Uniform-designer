# L3/L4 스왑 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-09-14 재설계(`docs/superpowers/specs/2026-09-14-l3-l4-waveguide-redesign-design.md`)에서
기존 L4(형상·정밀: gap/flatX/flatY/angleX/angleY/rise/radiusX/radiusY, LED-radial 경험식)가
아무 곳에도 남지 않고 완전히 삭제된 채 새 L4(X·Y 독립 3점 두께 프로필, TIR bulk-blur)로
교체됐다. 사용자 요청은 "기존 L4 통합"이었지 "삭제"가 아니었다. 이 플랜은 (1) 기존 L4를
L4 슬롯에 그대로 복원하고, (2) 이번에 새로 만든 L4 기능(X·Y 독립 프로필)을 L3 슬롯으로
옮긴다 — 즉 L3/L4 콘텐츠를 스왑한다.

**Architecture:** `levels.js`의 `case 3`/`case 4` 물리식 본문을 서로 교체하고, 형상함수
`l4BotZAt`(신규 프로필, 현재 4번 슬롯)을 `l3BotZAt`으로 개명해 3번 슬롯 전용으로 만들며,
git 이력(`7afbd3e^`)에서 삭제된 기존 L4 형상함수(`l4RiseAt`+`l4BotZAt` 구서명)를 그대로
복원해 4번 슬롯에 되돌린다. `LEVEL_SCHEMA`/`LEVEL_DEFAULTS`의 3·4 항목도 같은 방식으로
콘텐츠를 스왑한다. `geometry.js`/`plan.js`/`step-export.js`/`step-ui.js`에서 기존 L4가 쓰던
LED-반경 기반 형상 시각화(평면 동심원, flat 패드 표시, milky 오버레이)를 git 이력에서
그대로 복원한다. `directLit.js`는 로직 변경 없이 이제 사실과 달라진 "L3/L4" 언급 주석만
레벨-번호에 의존하지 않는 표현으로 고친다.

**Tech Stack:** 순수 JS(ES modules), Node 기반 테스트 스크립트(`test/*.mjs`), opencascade.js
(STEP 내보내기, `npm run test:step`에서만 로드).

---

## 배경 조사 요약 (구현자가 다시 파지 않도록)

- 복원 대상 코드는 모두 git 이력에 그대로 남아 있다: `git show 7afbd3e^:src/model/levels.js`
  (스키마·물리식), `git diff 0475da5^..HEAD -- src/` (geometry.js/plan.js/step-export.js/
  step-ui.js가 지운 부분)에서 `-`로 시작하는 줄이 정확한 복원 대상이다. 이 플랜의 각 Task는
  그 내용을 이미 반영했다 — 다시 git log를 뒤질 필요 없음.
- `directLit.js`의 `applyEdgeBoost`/`applyTaperEdgeBoost`/`applyAxisEdgeBoost` 디스패치는
  `edge.kind`(문자열)로만 분기하는 레벨-번호 비의존 코드라 **로직 변경 불필요** — 스왑 후에도
  그대로 동작한다. 단, 주석이 "L3=테이퍼/L4=축프로필"이라고 잘못 단정하고 있어 스왑 후
  사실과 반대가 된다(L3=축프로필, L4=edgeBoost 없음) → 주석만 레벨-번호 비의존 표현으로 수정.
- `solver.js`/`analysis.js`/`heatmap.js`는 레벨 번호를 하드코딩하지 않고 `LEVEL_SCHEMA`/
  `activeLevels`/`combinedEffect`를 통해 범용으로 동작한다 — **수정 불필요**. `main.js`도
  필드명을 하드코딩하지 않는다(`migrate()`가 `LEVEL_DEFAULTS` 키 기준으로 자동 이관) —
  **로직 수정 불필요**, 저장 버전 문자열만 올린다.
- 복원 전 기존 L4는 테스트 커버리지가 전혀 없었다(`git show fa65220:test/l4-profile.mjs` →
  파일 자체가 존재하지 않았음). Task 8에서 새로 추가하는 L4 테스트는 신규 회귀 방지 테스트다.

---

## File Structure

- Modify: `src/model/levels.js` — 스키마·기본값·물리식·형상함수 스왑
- Modify: `src/model/geometry.js` — 기존 L4 평면 시각화 정보(planShape/l4Height/l4HalfP) 복원,
  `bodyProfile()` 호출 인자(leds/pitch) 복원
- Modify: `src/ui/plan.js` — 기존 L4 동심원 렌더링 복원
- Modify: `src/export/step-export.js` — `makeBotZAt()` 구서명(leds/halfP) 복원
- Modify: `src/export/step-ui.js` — `geom.l4HalfP` 워커 전달 복원
- Modify: `src/engine/directLit.js` — 주석만 수정(레벨-번호 비의존 표현)
- Modify: `src/main.js`, `src/model/defaults.js` — 저장 스펙 버전 재차 상향(스키마 3·4가 또
  바뀌므로 구버전 로컬스토리지 값과 섞이면 안 됨)
- Rename+Rewrite: `test/l4-profile.mjs` → `test/l3-l4-shapes.mjs` — L3(신규 프로필) 테스트는
  레벨 번호만 3으로 바꿔 유지, L4(복원) 테스트 신규 추가
- Modify: `test/smoke-step.mjs` — L3 STEP 테스트를 새 필드명(tx0 등)으로 갱신
- Modify: `package.json` — test 스크립트의 파일명 갱신

---

### Task 1: `levels.js` — LEVEL_SCHEMA 3·4 스왑

**Files:** Modify `src/model/levels.js:31-43` (현재 4번 항목), `src/model/levels.js:22-30`(현재
3번 항목)

- [ ] **Step 1:** `LEVEL_SCHEMA[3]`을 현재의 축-프로필 스키마 내용으로 바꾸되, 자기 자신을
  가리키던 "L3 대체" 문구를 제거한다(더 이상 대체 관계의 "대체하는 쪽"이 아니라 그 자체가
  L3이므로):

```js
  3: {
    label: '형상·자유(도파관)', hint: 'X·Y 독립 두께 프로필(중심·중간·가장자리) · 균일두께 도파관(TIR)',
    fields: [
      { key: 'tx0', label: 'X중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx100', label: 'X가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty0', label: 'Y중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty100', label: 'Y가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx50', label: 'X중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'ty50', label: 'Y중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'edgeR', label: '모서리R', unit: 'mm', min: 0, max: 50, step: 1, adv: true },
    ],
    desc: '기구물 두께를 X·Y축 각각 중심→가장자리 3점(중심·중간·가장자리)으로 독립 지정하는 균일두께 도파관(TIR) 형상. LED 방출광 중 임계각 밖으로 나가는 성분은 슬래브 안에서 전반사(TIR)로 갇혀 옆으로 퍼진다 — 그 축의 중심 두께가 두꺼울수록 갇힌 빛이 그 방향으로 더 멀리 퍼져 확산이 커진다(도파관 원리). X·Y를 다르게 주면 축별로 확산 강도가 실제로 달라진다. 중간 지점은 가장자리 근처 형상(볼록/오목)을 보조적으로 다듬는다. 모서리R로 네 모서리를 둥글게 해 집광(핫스팟) 없이 고르게 퍼지도록 함.',
  },
```

- [ ] **Step 2:** `LEVEL_SCHEMA[4]`를 git 이력의 원래 내용으로 복원(`git show 7afbd3e^:src/model/levels.js` 기준):

```js
  4: {
    label: '형상·정밀', hint: 'X·Y 각도/크기 개별 조정 (L3 대체)',
    fields: [
      { key: 'gap', label: 'Gap', unit: 'mm', min: 0.5, max: 15, step: 0.5 },
      { key: 'flatX', label: 'FlatX', unit: 'mm', min: 1, max: 40, step: 1 },
      { key: 'flatY', label: 'FlatY', unit: 'mm', min: 1, max: 40, step: 1 },
      { key: 'angleX', label: '각도X', unit: '°', min: 5, max: 85, step: 5 },
      { key: 'angleY', label: '각도Y', unit: '°', min: 5, max: 85, step: 5 },
      { key: 'rise', label: 'Gap확대', unit: 'mm', min: 0, max: 25, step: 1 },
      { key: 'radiusX', label: 'R(X)', unit: 'mm', min: 0, max: 15, step: 0.5, adv: true },
      { key: 'radiusY', label: 'R(Y)', unit: 'mm', min: 0, max: 15, step: 0.5, adv: true },
    ],
    desc: 'L3 형상의 전이부 경사각과 flat 크기를 X·Y로 개별 조정. (켜지면 L3 대체) LED 정면은 FLAT 유지, 그 바깥은 flat과 접선으로 이어지다 지정한 각도(angleX·Y)의 직선 경사로 자연스럽게(꺾임 없이) 이어지는 R(X)·R(Y) 라운드 전이 — R이 클수록 확산도 강화.',
  },
```

- [ ] **Step 3:** `LEVEL_DEFAULTS`도 스왑(3번은 신규 프로필 기본값을 `on: true`로 — 원래
  3번 슬롯이 늘 켜져 있던 기본 형상 자리였으므로, 4번은 `on: false`로 원상 복구):

```js
export const LEVEL_DEFAULTS = {
  1: { on: true, thk: 3 },
  2: { on: false, milky: 1, decenterX: 0, decenterY: 0 },
  3: { on: true, tx0: 3, tx50: 2, tx100: 1, ty0: 3, ty50: 2, ty100: 1, edgeR: 5 },
  4: { on: false, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 },
  5: { on: false, ptype: 'pyramid', sizeX: 0.3, sizeY: 0.3, angleX: 40, angleY: 40, dir: '돌출', depth: 0.2 },
};
```

---

### Task 2: `levels.js` — `levelEffect` case 3 / case 4 물리식 스왑

**Files:** Modify `src/model/levels.js:124-170`

- [ ] **Step 1:** `case 3`을 현재 `case 4`의 본문(축별 TIR bulk-blur)으로 교체하되, 자기
  참조("L3와 같은") 문구를 제거:

```js
    case 3: {
      // 균일두께 도파관(TIR) — X·Y축 각각의 "중심 두께"로 bulk-blur를 독립 적용한다. 캡이
      // 없는 항이라 tx0≠ty0 이면 두 축의 확산 강도가 실제로 달라진다(핵심 개선).
      const { fracTrapped, minThk, maxThk, K_RANGE } = tirParams(spec, d);
      const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
      const tx0 = clampThk(p.tx0, 3), tx50 = clampThk(p.tx50, 2), tx100 = clampThk(p.tx100, 1);
      const ty0 = clampThk(p.ty0, 3), ty50 = clampThk(p.ty50, 2), ty100 = clampThk(p.ty100, 1);
      const bulkBlurX = K_RANGE * tx0 * fracTrapped;
      const bulkBlurY = K_RANGE * ty0 * fracTrapped;

      // 보조 보정: 중심→가장자리 두께 낙차만큼 계수(0.03)·캡(0.25)으로 국소 보정 세기를
      // 정한다. 실제 픽셀별 보정은 directLit.js의 applyAxisEdgeBoost()가 이 edgeBoost.kind
      // ='axis'를 소비해 수행한다(computeField → applyEdgeBoost 디스패치).
      const boostMaxX = clamp(0.03 * (tx0 - tx100), 0, 0.25);
      const boostMaxY = clamp(0.03 * (ty0 - ty100), 0, 0.25);
      const cornerR = Math.max(0, p.edgeR ?? 0);
      return {
        blurX: bulkBlurX, blurY: bulkBlurY, transmit: 0.97,
        edgeBoost: {
          kind: 'axis',
          x: { pts: [tx0, tx50, tx100], boostMax: boostMaxX },
          y: { pts: [ty0, ty50, ty100], boostMax: boostMaxY },
          cornerR,
          hasBoost: boostMaxX > 0 || boostMaxY > 0,
          searchMag: boostMaxX + boostMaxY + cornerR * 0.01,
        },
      };
    }
```

- [ ] **Step 2:** `case 4`를 git 이력의 기존 경험식으로 복원:

```js
    case 4: {
      const rise = p.rise ?? 8;
      // R(radiusX/Y)만큼 flat→경사 전이가 둥글게(라운드) 이어져 광량 변화가 더 매끄러워짐 → 확산 보강.
      // (자동탐색이 각도·R 자유도로 LED수를 최소화할 때 R도 실제로 쓸 수 있는 손잡이가 되도록)
      const f = (ang, r) => 0.35 * rise + 0.007 * (ang ?? 45) * Math.sqrt(Math.max(0, rise)) + 0.05 * d + 0.15 * (r ?? 0);
      return { blurX: f(p.angleX, p.radiusX), blurY: f(p.angleY, p.radiusY), transmit: 0.95 };
    }
```

- [ ] **Step 3:** `tirParams()` 함수 바로 위 주석에서 "L3·L4가 공유" 문구를 고친다(이제 L4는
  TIR 물리량을 쓰지 않으므로 L3 전용):

```js
// TIR(전반사) 도파관 물리량 — L3(X·Y 독립 두께 프로필)가 사용. 굴절률 n·LED 빔각으로 정해지는
// 임계각 기반 갇힘비율(fracTrapped)과, 두께 1mm당 옆으로 퍼지는 거리 계수(K_RANGE, 1회 바운스
// 보수적 상한).
```

---

### Task 3: `levels.js` — 형상함수(`l3BotZAt`/`l4BotZAt`) 스왑

**Files:** Modify `src/model/levels.js:258-323` (현재 `axisThickAt`/`l4BotZAt`/`bodyProfile`/
`l3BotZAt` 전체 블록을 아래 내용으로 교체)

- [ ] **Step 1:** 현재 `l4BotZAt`(신규 min(Tx,Ty) 프로필, 4번 슬롯용)을 `l3BotZAt`으로 개명해
  3번 슬롯 전용으로 만들고, 기존(구) `l3BotZAt`(wallThk 테이퍼 식)은 삭제(더 이상 어떤
  레벨도 그 식을 쓰지 않음 — 대체된 것이 아니라 신규 프로필로 완전히 교체됨). 그 아래에
  기존 L4의 `l4RiseAt`/`l4BotZAt`(구서명)을 git 이력 그대로 복원. `bodyProfile()`도 구서명
  (`leds`, `pitch` 인자 포함)으로 복원해 L4 분기가 LED 위치를 다시 쓸 수 있게 한다:

```js
// L3(자유형상 도파관)용 축별 두께 프로필 평가 — pts=[중심,중간,가장자리] 두께(mm),
// halfLen=중심→가장자리 거리(mm), dist=가장자리로부터의 거리(0=가장자리..halfLen=중심).
// directLit.js의 axisRamp()와 짝을 이루는 함수지만, 여긴 절대 두께(mm)를 반환한다는 점이 다르다.
function axisThickAt(pts, halfLen, dist) {
  const f = halfLen > 0 ? clamp(dist / halfLen, 0, 1) : 1;   // 0=가장자리,1=중심
  return f <= 0.5 ? pts[2] + (pts[1] - pts[2]) * (f / 0.5) : pts[1] + (pts[0] - pts[1]) * ((f - 0.5) / 0.5);
}

// L3(자유형상 도파관)의 실제 2D 두께 함수 — X·Y 각각 3점 프로필을 평가해 min(Tx,Ty)로 결합한다.
// l3BotZAt과 짝을 이루는 directLit.js의 applyAxisEdgeBoost가 쓰는 "둥근 모서리 인지 거리"
// 공식과 반드시 같은 형태를 유지해야 광학 계산과 STEP 형상이 일치한다. bodyProfile·
// step-export.js가 공유.
export function l3BotZAt(spec, depth, x, y) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const sp3 = levelParams(spec, 3);
  const { minThk, maxThk } = tirParams(spec, depth);
  const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
  const tx = [clampThk(sp3.tx0, 3), clampThk(sp3.tx50, 2), clampThk(sp3.tx100, 1)];
  const ty = [clampThk(sp3.ty0, 3), clampThk(sp3.ty50, 2), clampThk(sp3.ty100, 1)];
  const r = Math.max(0, Math.min(sp3.edgeR ?? 0, Math.min(X, Y) / 2));

  const dx = Math.min(x, X - x), dy = Math.min(y, Y - y);
  const rounded = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : null;
  const dxEff = rounded == null ? dx : rounded;
  const dyEff = rounded == null ? dy : rounded;
  const thk = Math.min(axisThickAt(tx, X / 2, dxEff), axisThickAt(ty, Y / 2, dyEff));
  return depth - thk;
}

// L4: flatHalf 밖 반경 rel(mm, flat 경계로부터) 위치에서의 상승량(mm). bodyProfile(X 단면)과
// plan.js(2D 등고선 — TOP VIEW 가 실제 형상과 다르게 보이던 문제)가 공식을 공유해 두 뷰가
// 같은 형상을 그리도록 한다.
function l4RiseAt(sp, rel) {
  const riseMax = sp.rise ?? 8;
  const angle = clamp(sp.angleX ?? 45, 1, 85) * Math.PI / 180;
  const slope = Math.tan(angle);
  const radiusX = Math.max(0, sp.radiusX ?? 0);
  if (radiusX <= 0) return Math.min(riseMax, slope * rel);
  // 원호(flat과 접선) → 각도(angle)에 도달하면 직선 경사로 연속(탄젠트) 전환
  const relAtTangent = radiusX * Math.sin(angle);
  const riseAmt = rel <= relAtTangent
    ? radiusX - Math.sqrt(Math.max(0, radiusX * radiusX - rel * rel))
    : radiusX * (1 - Math.cos(angle)) + slope * (rel - relAtTangent);
  return Math.min(riseMax, riseAmt);
}

// L4 전체 높이(botZ, mm): LED 로부터의 거리(dist, mm — X 단면이면 |x-ledX|, 2D 등고선이면
// 실제 반경거리)에서의 기구물 하면 위치. bodyProfile 과 buildGeometry(plan.js 용) 가 공유.
export function l4BotZAt(spec, active, depth, dist, halfP) {
  const ledTop = spec.led.sizeZ;
  const topZ = depth;
  const A = active instanceof Set ? active : new Set(active);
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const minBody = Math.max(1, baseThk * 0.5);
  const sp = levelParams(spec, 4);
  const gap = clamp(sp.gap ?? 2, 0.5, Math.max(0.5, topZ - ledTop - minBody));
  const flatHalf = (sp.flatX ?? 4) / 2;
  if (dist <= flatHalf) return ledTop + gap;
  const rel = Math.min(dist - flatHalf, halfP);
  return Math.min(topZ - minBody, ledTop + gap + l4RiseAt(sp, rel));
}

// 기구물 단면(X 방향): 활성 형상 난이도 기준
export function bodyProfile(spec, active, leds, depth, pitch, nx = 160) {
  const A = new Set(active ?? activeLevels(spec));
  const X = spec.target.xLen, Y = spec.target.yLen;
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const topZ = depth;
  const useL4 = A.has(4), useL3 = A.has(3) && !useL4;

  const lxs = useL4 ? [...new Set(leds.map((l) => l.x))].sort((a, b) => a - b) : null;
  const near = useL4 ? (lxs.length ? (x) => Math.min(...lxs.map((v) => Math.abs(x - v))) : () => 1e9) : null;
  const halfP = useL4 ? Math.max(1, pitch / 2) : null;

  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = (i / (nx - 1)) * X;
    const botZ = useL4 ? l4BotZAt(spec, A, depth, near(x), halfP)
      : useL3 ? l3BotZAt(spec, depth, x, Y / 2)
      : topZ - baseThk;
    pts.push({ x, botZ, topZ });
  }
  return pts;
}
```

---

### Task 4: `geometry.js` — 기존 L4 시각화 정보 복원

**Files:** Modify `src/model/geometry.js`

- [ ] **Step 1:** import에 `l4BotZAt` 추가:

```js
import { LEVEL_SCHEMA, levelParams, levelEffect, combinedEffect, activeLevels, bodyProfile, effectiveEdgeMargin, l4BotZAt } from './levels.js';
```

- [ ] **Step 2:** `diffuseVisual` 계산에 `active.has(4)` 복원, `planShape`/`l4Height` 계산 블록
  복원, `bodyProfile` 호출에 `leds`/`pitchX` 인자 복원, 반환 객체에 `planShape`/`l4Height`/
  `l4HalfP` 추가. `buildGeometry()` 본문을 아래로 교체(주석 포함):

```js
  const p2 = levelParams(spec, 2);
  const p5 = levelParams(spec, 5);
  const diffuseVisual = (active.has(2) && (p2.milky ?? 1) > 1.5) || active.has(4);
  const patternVisual = active.has(5)
    ? { type: p5.ptype || 'pyramid',
        sizeX: p5.sizeX ?? 0.3, sizeY: p5.sizeY ?? 0.3,
        pitchX: p5.sizeX ?? 0.3, pitchY: p5.sizeY ?? 0.3,   // pitch = 크기 (패킹)
        angleX: p5.angleX ?? 40, angleY: p5.angleY ?? 40,
        dir: p5.dir ?? '돌출', depth: p5.depth ?? 0.2 }
    : null;

  // 평면도용 형상 정보: LED 중심 flat 패드 크기 (L4 전용 — L3 는 타겟 전체 1개의 형상이라
  // LED별 flat 패드 개념이 없음)
  const useL4 = active.has(4);
  const sp4 = useL4 ? levelParams(spec, 4) : null;
  const planShape = sp4
    ? { kind: 'L4', flatX: sp4.flatX ?? 4, flatY: sp4.flatY ?? 4, gap: sp4.gap ?? 2 }
    : null;

  // TOP VIEW 2D 등고선용 — SIDE VIEW(bodyProfile)와 같은 l4BotZAt() 을 공유해 두 뷰가 서로 다른
  // 형상으로 보이던 문제(패드만 있고 실제 굴곡은 안 보임)를 해소.
  const halfPShape = Math.max(1, Math.min(pitchX, pitchY) / 2);
  const l4Height = useL4 ? (dist) => l4BotZAt(spec, active, depth, dist, halfPShape) : null;

  const tags = [...active].sort().map((l) => `L${l}`);

  return {
    dim, depth, pitch: pitchX, pitchX, pitchY: dim === '1D' ? null : pitchY, obsZ: depth + 0.1,
    beamX: spec.led.beamX, n: spec.body.n,
    leds,
    ledSize: { x: spec.led.sizeX, y: spec.led.sizeY, z: spec.led.sizeZ },
    target: { x: X, y: Y },
    fixture: { x: X + 2 * Math.max(0, ledPadX), y: Y + 2 * Math.max(0, ledPadY) },   // 음수 pad(안쪽 배치)는 기구를 줄이지 않음
    view,
    levelText: tags.length ? tags.join(' + ') : '기본 평판',
    diffuseVisual, patternVisual, planShape, l4Height, l4HalfP: halfPShape,
    ledTop: spec.led.sizeZ,
    bodyProfile: (nx = 160) => bodyProfile(spec, [...active], leds, depth, pitchX, nx),
  };
```

---

### Task 5: `plan.js` — 기존 L4 동심원 렌더링 복원

**Files:** Modify `src/ui/plan.js`

- [ ] **Step 1:** `// L5 — 패턴 표시` 블록 바로 위(현재 유효영역 점선 렌더링 다음)에 기존 L4
  동심원 블록을 복원:

```js
  // L4 — 실제 반경별 두께를 동심원 등고선으로 표시. SIDE VIEW(단면도)와 같은 l4Height() 함수를
  // 써서 두 뷰가 같은 형상을 그리도록 함 — 예전엔 여기 flat 패드 사각형만 그려서 SIDE VIEW의
  // 굴곡진(scalloped) 실제 형상과 안 맞아 보이는 문제가 있었음.
  if (g.l4Height && g.l4HalfP > 0) {
    const topZ = g.depth;
    const maxThk = topZ - g.l4Height(0);
    const minThk = topZ - g.l4Height(g.l4HalfP);
    const range = Math.max(0.01, maxThk - minThk);
    const RINGS = 14;
    for (const p of g.leds) {
      for (let k = RINGS; k >= 1; k--) {
        const rMm = (k / RINGS) * g.l4HalfP;
        const thk = topZ - g.l4Height(rMm);
        const t = Math.max(0, Math.min(1, (thk - minThk) / range));   // 0(얇음)~1(LED 바로 위, 두꺼움)
        ctx.fillStyle = `rgba(124,176,255,${(0.05 + 0.32 * t).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px(p.x), py(p.y), Math.max(0.5, rMm * pxmm), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

```

- [ ] **Step 2:** 하단 라벨 텍스트에 `planShape` 기반 flat 크기 표시 복원:

```js
  ctx.fillStyle = C.text; ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
  ctx.fillText(`평면 배치 · 최종 적용: ${g.levelText}`, PAD.L, 15);
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  const pad = g.planShape ? ` · flat ${g.planShape.flatX}×${g.planShape.flatY}mm` : '';
  const grid = xs.length && ys.length ? ` (${xs.length}×${ys.length})` : '';
  ctx.fillText(`LED ${g.leds.length}개${grid} · ${g.dim} · ${X}×${Y}mm${pad}`, PAD.L, h - 7);
}
```

---

### Task 6: `step-export.js` / `step-ui.js` — 기존 L4 STEP 형상 경로 복원

**Files:** Modify `src/export/step-export.js`, `src/export/step-ui.js`

- [ ] **Step 1:** `step-export.js`의 `makeBotZAt()`을 구서명(leds/halfP)으로 복원하고
  `buildStepForSpec()`의 호출부도 맞춘다(`import`는 이미 `l3BotZAt, l4BotZAt, levelParams`
  전부 가져오고 있어 수정 불필요):

```js
// 활성 레벨 조합에서 botZAt(x,y) 함수를 만든다. bodyProfile()과 동일한 우선순위(L4가 L3를 대체).
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
```

그리고 `buildStepForSpec()` 안의 호출부(`const botZAt = makeBotZAt(spec, active, depth);`
를 포함한 두 줄)를 아래로 교체:

```js
  const halfP = geom.l4HalfP ?? Math.max(1, Math.min(combo.pitchX, combo.pitchY ?? combo.pitchX) / 2);
  const botZAt = makeBotZAt(spec, active, depth, geom.leds, halfP);
```

- [ ] **Step 2:** `step-ui.js`의 워커 `postMessage` 페이로드에 `l4HalfP` 복원:

```js
  worker.postMessage({
    spec: JSON.parse(JSON.stringify(spec)),
    combo: { depth: combo.depth, pitchX: combo.pitchX, pitchY: combo.pitchY, padX: combo.padX, padY: combo.padY },
    geom: { leds: geom.leds, ledSize: geom.ledSize, l4HalfP: geom.l4HalfP },
    active,
  });
```

---

### Task 7: `directLit.js` — 주석만 레벨-번호 비의존 표현으로 수정

**Files:** Modify `src/engine/directLit.js:271, 307, 316-317`

로직은 전혀 바뀌지 않는다(`edge.kind`로만 분기하므로 스왑과 무관하게 이미 정상 동작).
스왑 후 사실과 달라지는 주석 3곳만 고친다.

- [ ] **Step 1:** `applyEdgeBoost` 디스패처 위 주석(`// L3(단일 테이퍼)와 L4(X·Y 독립
  프로필)는 edgeBoost 모양이 달라 각자의 함수로 분기한다.`)을 레벨 번호 대신 모양 기준으로:

```js
// edgeBoost.kind==='axis'면 축별(X·Y 독립) 프로필 보정, 그 외(taper)는 단일 경사면 보정 —
// 어느 레벨이 어느 모양을 만드는지는 levels.js 쪽 사정이라 여기선 모양으로만 분기한다.
```

- [ ] **Step 2:** `axisRamp` 함수 설명 주석에서 `"L3의 t(=1-edgeDist/tw)와 같은 역할"`을
  함수명 기준으로 교체:

```js
// pts=[중심,중간,가장자리] 두께(mm), halfLen=그 축의 중심→가장자리 거리(mm), dist=가장자리로부터의
// 거리(0=가장자리..halfLen=중심). 반환값은 "중심 두께 대비 얼마나 깎였는지"의 비율(0=안 깎임,
// 1=가장자리 두께까지 다 깎임) — applyTaperEdgeBoost의 t(=1-edgeDist/tw)와 같은 역할을 프로필
// 기반으로 일반화한 것. 중간 지점이 중심보다 두꺼운 비단조 프로필도 허용하기 위해 살짝 초과
// (1.3)까지만 클램프한다.
```

- [ ] **Step 3:** `applyAxisEdgeBoost` 함수 설명 주석에서 `"L4(X·Y 독립 두께 프로필)"`을
  `"L3"`로 교체:

```js
// L3(X·Y 독립 두께 프로필)의 가장자리 보정 — applyTaperEdgeBoost와 같은 "평균 대비 절대량,
// 기존 최댓값 캡" 원칙을 X·Y 두 축 각각의 램프 중 더 큰 쪽(Math.max)으로 적용한다.
```

---

### Task 8: 저장 스펙 버전 상향

**Files:** Modify `src/main.js:15`, `src/model/defaults.js:9`

레벨 3·4 스키마가 또 한 번 바뀌므로(필드명이 서로 뒤바뀜), 구 로컬스토리지 값의 `levels[3]`/
`levels[4]`가 새 스키마의 필드와 우연히 겹쳐 잘못된 값으로 해석되지 않도록 버전을 올린다
(`migrate()`는 `LEVEL_DEFAULTS` 키 기준으로 모르는 필드를 자동 무시하므로 로직 변경은
불필요 — 버전 문자열만 올리면 된다).

- [ ] **Step 1:** `src/main.js:15`

```js
const LS_KEY = 'uds.spec.v11';
```

- [ ] **Step 2:** `src/model/defaults.js:9`

```js
  ver: 12,                      // 저장 스펙 마이그레이션용(main.migrate) — L3/L4 콘텐츠 스왑(v12)
```

---

### Task 9: 테스트 — `test/l4-profile.mjs` → `test/l3-l4-shapes.mjs`로 재작성

**Files:** Delete `test/l4-profile.mjs`, Create `test/l3-l4-shapes.mjs`

기존 신규-프로필 테스트는 레벨 번호만 4→3으로 바꿔 그대로 유지(물리식은 동일하게 옮겨졌을
뿐이므로). 복원된 L4(경험식)에 대한 신규 회귀 테스트를 추가한다(이 레벨은 이전에 테스트
커버리지가 전혀 없었다).

- [ ] **Step 1:** `test/l4-profile.mjs` 삭제, `test/l3-l4-shapes.mjs` 아래 내용으로 생성:

```js
// L3(X·Y 독립 두께 프로필, 자유형상 도파관) 물리·형상 검증 + L4(형상·정밀, 복원) 회귀 방지.
import { levelEffect, l3BotZAt, l4BotZAt, bodyProfile } from '../src/model/levels.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { computeField, evalGrid } from '../src/engine/directLit.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('PASS', name); pass++; }
  else { console.log('FAIL', name, detail); fail++; }
}

function baseSpec() {
  return JSON.parse(JSON.stringify(DEFAULT_SPEC));
}

// ---- L3(신규 축 프로필) ----

// tx0>ty0 이면 X 방향 벌크 블러가 더 커야 한다 — 캡 없는 핵심 메커니즘의 존재 증명.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('tx0>ty0 → blurX>blurY', e.blurX > e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  const ratio = e.blurX / e.blurY;
  check('블러 비율이 두께 비율(6/3=2)과 일치', Math.abs(ratio - 2) < 0.01, `ratio=${ratio}`);
  check('L3 edgeBoost.kind === "axis"', e.edgeBoost.kind === 'axis');
  check('L3 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

// tx0===ty0 이면 대칭이어야 한다(회귀 방지).
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 4, tx50: 3, tx100: 2, ty0: 4, ty50: 3, ty100: 2, edgeR: 0 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('tx0=ty0 → blurX=blurY', Math.abs(e.blurX - e.blurY) < 1e-9, `blurX=${e.blurX} blurY=${e.blurY}`);
}

// L3 edgeBoost가 실제 필드 계산 경로(computeField)에서 크래시 없이 동작하고, 가장자리 근처
// 조도를 기존 최댓값 이상으로 밀어올리지 않는지(캡이 지켜지는지) 확인. boost 유무 두 번 계산해
// 비교해야만 캡이 실제로 걸리는지를 검증할 수 있다.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 5 };
  const eff = levelEffect(spec, 3, spec.space.depth);
  const g = evalGrid(spec, 1.5);
  const commonOpt = {
    depth: spec.space.depth, pitchX: 20, pitchY: 20, nx: g.nx, ny: g.ny,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
  };
  const boosted = computeField(spec, { ...commonOpt, edgeBoost: eff.edgeBoost });
  const unboosted = computeField(spec, { ...commonOpt, edgeBoost: undefined });
  const boostedMax = Math.max(...boosted.field);
  const unboostedMax = Math.max(...unboosted.field);
  check('L3 edgeBoost 적용 후 필드가 유한하고 양수', Number.isFinite(boostedMax) && boostedMax > 0, `max=${boostedMax}`);
  check('L3 edgeBoost가 필드 최댓값을 넘어서지 않음(캡 유지)', boostedMax <= unboostedMax + 1e-9,
    `boostedMax=${boostedMax} unboostedMax=${unboostedMax}`);
}

// l3BotZAt 형상 — 중심/가장자리 두께가 min(Tx,Ty)로 결합되는지 확인.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const X = spec.target.xLen, Y = spec.target.yLen, depth = spec.space.depth;

  const thkCenter = depth - l3BotZAt(spec, depth, X / 2, Y / 2);
  check('중심 두께 = min(tx0,ty0)=3', Math.abs(thkCenter - 3) < 0.01, `thk=${thkCenter}`);

  const thkXEdge = depth - l3BotZAt(spec, depth, 0, Y / 2);
  check('X 가장자리(Y중앙) 두께 = min(tx100=2, ty0=3) = 2', Math.abs(thkXEdge - 2) < 0.01, `thk=${thkXEdge}`);

  const thkYEdge = depth - l3BotZAt(spec, depth, X / 2, 0);
  check('Y 가장자리(X중앙) 두께 = min(tx0=6, ty100=1.5) = 1.5', Math.abs(thkYEdge - 1.5) < 0.01, `thk=${thkYEdge}`);
}

// 모서리R을 켜도(코너 라운드) 두께가 물리적 범위([minThk,maxThk]) 안에서 유한하게 나오는지.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 10 };
  const depth = spec.space.depth;
  const thkCorner = depth - l3BotZAt(spec, depth, 3, 3);
  check('모서리R 근처 두께가 유한하고 [1.5,11] 범위 안', Number.isFinite(thkCorner) && thkCorner >= 1.4 && thkCorner <= 11.1, `thk=${thkCorner}`);
}

// bodyProfile()의 L3 분기가 l3BotZAt(spec,depth,x,Y/2)와 정확히 일치하는지(비정사각 타겟에서
// Y거리도 형상에 영향을 주는지) — 회귀 방지.
{
  const spec = baseSpec();
  spec.target.xLen = 100; spec.target.yLen = 30; // 비정사각: Y/2=15가 tw보다 작을 수 있는 케이스
  spec.levels[3] = { on: true, tx0: 8, tx50: 5, tx100: 1, ty0: 8, ty50: 5, ty100: 1, edgeR: 0 };
  spec.levels[4].on = false;
  const depth = spec.space.depth;
  const prof = bodyProfile(spec, [1, 3], [], depth, 20, 5);
  let allMatch = true;
  for (const p of prof) {
    const expected = l3BotZAt(spec, depth, p.x, spec.target.yLen / 2);
    if (Math.abs(p.botZ - expected) > 1e-9) allMatch = false;
  }
  check('bodyProfile L3 분기 = l3BotZAt(x, Y/2) 일치', allMatch);
}

// ---- L4(형상·정밀, 복원) ----

// rise가 커질수록 blur가 커지는(단조 증가) 기존 경험식이 복원되었는지, edgeBoost를 만들지
// 않는지(형상 캡 로직 미보유) 확인.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 };
  const eBase = levelEffect(spec, 4, spec.space.depth);
  check('L4 blurX>0 (경험식 정상)', eBase.blurX > 0, `blurX=${eBase.blurX}`);
  check('L4 edgeBoost 없음(형상 캡 로직 미보유)', eBase.edgeBoost === undefined);

  const spec2 = baseSpec();
  spec2.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 16, radiusX: 0, radiusY: 0 };
  const eRise = levelEffect(spec2, 4, spec.space.depth);
  check('rise↑ → blur↑ (단조)', eRise.blurX > eBase.blurX, `base=${eBase.blurX} rise16=${eRise.blurX}`);
}

// l4BotZAt 형상 — flat 반경 안쪽은 평평(gap), 밖은 각도만큼 botZ가 커짐(재료가 얇아짐).
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, gap: 2, flatX: 4, flatY: 4, angleX: 45, angleY: 45, rise: 8, radiusX: 0, radiusY: 0 };
  const depth = spec.space.depth;
  const A = new Set([1, 4]);
  const botZFlat = l4BotZAt(spec, A, depth, 0, 10);
  check('flat 중심(dist=0) botZ = ledTop+gap', Math.abs(botZFlat - (spec.led.sizeZ + 2)) < 1e-9, `botZ=${botZFlat}`);

  const botZFar = l4BotZAt(spec, A, depth, 10, 10);
  check('flat 밖(dist=halfP)에서 botZ가 커짐(재료가 얇아짐)', botZFar > botZFlat, `flat=${botZFlat} far=${botZFar}`);
}

process.exitCode = fail ? 1 : 0;
console.log(`\n${pass} passed, ${fail} failed`);
```

- [ ] **Step 2:** 실행해서 통과 확인

Run: `node test/l3-l4-shapes.mjs`
Expected: 모든 케이스 `PASS`, 마지막 줄 `N passed, 0 failed`

---

### Task 10: `test/smoke-step.mjs` L3 섹션을 새 필드명으로 갱신

**Files:** Modify `test/smoke-step.mjs:48-62`

- [ ] **Step 1:** `wallThk` 기반 L3 STEP 테스트를 `tx0`/`ty0` 기반으로 교체:

```js
// L3 — 중심(tx0=ty0=6mm)이 같은 두께의 "테이퍼 없는 평판"보다 부피가 작아야 함(가장자리가
// tx100/ty100=1mm로 얇아짐).
// (주의: L1 기본 baseThk=3mm 기준판과 비교하면 안 된다 — L3 중심부 자체가 6mm 로 이미
// 3mm보다 두꺼워서, 가장자리가 아무리 얇아져도 3mm 기준판보다 부피가 커질 수 있다. 이건
// Task 3 Step 3 에서 이미 한 번 겪은 것과 같은 종류의 착오라 여기서도 중심 두께(tx0/ty0)
// 자신을 기준판으로 삼는다.)
{
  const specFlat6 = specWith([1]);
  specFlat6.levels[1].thk = 6; // L3의 중심 두께(tx0=ty0=6mm)와 동일한 두께의 평판 기준
  const rFlat6 = run(oc, specFlat6, [1]);
  const spec3 = specWith([1, 3]);
  spec3.levels[3].tx0 = 6; spec3.levels[3].tx50 = 3.5; spec3.levels[3].tx100 = 1;
  spec3.levels[3].ty0 = 6; spec3.levels[3].ty50 = 3.5; spec3.levels[3].ty100 = 1;
  spec3.levels[3].edgeR = 5;
  const r3 = run(oc, spec3, [1, 3]);
  check('L3 STEP 생성 성공', r3.stepText.length > 100);
  check('L3 바디 부피 < 동일 두께 평판 부피', r3.bodyVolume < rFlat6.bodyVolume, `L3=${r3.bodyVolume} flat6mm=${rFlat6.bodyVolume}`);
}

// L4 — 정상 생성만 확인(형상은 L3와 다른 함수 경로, LED-반경 기반).
{
  const spec4 = specWith([1, 4]);
  const r4 = run(oc, spec4, [1, 4]);
  check('L4 STEP 생성 성공', r4.stepText.length > 100);
}
```

(L4 섹션 자체는 필드명을 하드코딩하지 않으므로 내용 변경 없음 — 위는 L3 섹션 바로 다음에
이어지는 기존 L4 섹션을 그대로 보여주기 위해 포함한 것으로, 실제로는 L3 섹션만 교체하면 됨.)

- [ ] **Step 2:** 실행해서 통과 확인(무겁고 느림 — opencascade.js WASM 로드)

Run: `npm run test:step`
Expected: `L1/L3/L4/L5` 관련 모든 케이스 `PASS`

---

### Task 11: `package.json` 테스트 스크립트 파일명 갱신

**Files:** Modify `package.json:9`

- [ ] **Step 1:**

```json
    "test": "node test/smoke.mjs && node test/heatmap-labels.mjs && node test/overhang.mjs && node test/layout.mjs && node test/center.mjs && node test/profile-labels.mjs && node test/l3-l4-shapes.mjs",
```

- [ ] **Step 2:** 전체 스위트 실행

Run: `npm test`
Expected: 모든 테스트 파일 `PASS`, 0 failed

---

### Task 12: 커밋

- [ ] **Step 1:**

```bash
git add src/model/levels.js src/model/geometry.js src/model/defaults.js src/ui/plan.js \
  src/export/step-export.js src/export/step-ui.js src/engine/directLit.js src/main.js \
  test/l3-l4-shapes.mjs test/smoke-step.mjs package.json
git rm test/l4-profile.mjs
git commit -m "fix: restore old L4 (precision shape), move new per-axis profile to L3

The 2026-09-14 L3/L4 redesign deleted the old L4 (gap/flatX/flatY/angleX/
angleY/rise/radiusX/radiusY, LED-radial empirical shape) outright instead of
folding it into L3 as requested, replacing it with a brand-new L4 feature.
Swap the two back: the old L4 is restored verbatim from git history into the
L4 slot, and this session's new per-axis 3-point thickness profile (built as
the new L4) now occupies L3, replacing L3's old wallThk/edgeAngle taper."
```

---

## Self-Review 체크리스트

- **스펙 커버리지:** LEVEL_SCHEMA/DEFAULTS 스왑(Task1) · levelEffect 스왑(Task2) · 형상함수
  스왑/복원(Task3) · geometry.js/plan.js/step-export.js/step-ui.js 시각화 복원(Task4-6) ·
  directLit.js 주석 정정(Task7) · 저장 버전 상향(Task8) · 테스트 갱신(Task9-10) · 스크립트
  갱신(Task11) — 배경 조사에서 식별한 모든 파일이 태스크로 커버됨.
- **플레이스홀더 스캔:** 모든 Step에 실제 코드 포함, "TODO"/"적절히 처리" 없음.
- **타입/시그니처 일관성:** `bodyProfile(spec, active, leds, depth, pitch, nx)` 시그니처가
  Task3(정의)·Task4(geometry.js 호출)·Task9(테스트 호출) 전부 동일. `l3BotZAt(spec, depth, x, y)`,
  `l4BotZAt(spec, active, depth, dist, halfP)`, `makeBotZAt(spec, active, depth, leds, halfP)`
  모두 Task3/6/9/10에서 일관.
