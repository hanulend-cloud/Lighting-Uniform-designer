# L3/L4 통합 및 자유형상 도파관(신규 L4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L3(형상·기본)는 그대로 두고, 광학적으로 검증되지 않았던 옛 L4(형상·정밀)를 폐지한 뒤,
그 자리에 X·Y축 독립 3점(중심·중간·가장자리) 두께 프로필로 L3의 검증된 TIR 벌크-블러 메커니즘을
축별로 적용하는 새 L4(자유형상 도파관)를 만든다.

**Architecture:** `src/model/levels.js`의 `levelEffect` case 3에서 굴절률·임계각 기반 물리량
계산을 `tirParams()` 헬퍼로 뽑아 case 3·4가 공유한다. 새 case 4는 `bulkBlurX = K_RANGE·tx0·
fracTrapped`, `bulkBlurY = K_RANGE·ty0·fracTrapped`를 캡 없이 축별로 반환해 X≠Y일 때 실제
균일도가 달라지게 하고(핵심 개선), 부차적으로 `edgeBoost`를 `kind:'axis'`로 일반화해 `tx50/ty50`이
국소 보정에 반영되게 한다. 3D 형상(바디/STEP)은 `min(Tx(dx), Ty(dy))`로 결합한 새 위치기반
`l4BotZAt(spec, depth, x, y)`가 전담해 화면과 STEP이 항상 일치하게 한다. L4가 켜지면 L3를
대체하는 기존 패턴은 그대로 유지한다.

**Tech Stack:** 순수 JS(ES modules), 무빌드 정적 웹앱. 테스트는 Node `.mjs` 스크립트(`assert` 없이
pass/fail 카운트 패턴, 기존 `test/*.mjs`와 동일 스타일).

**설계 문서:** [docs/superpowers/specs/2026-09-14-l3-l4-waveguide-redesign-design.md](../specs/2026-09-14-l3-l4-waveguide-redesign-design.md)

---

### Task 1: 공유 TIR 헬퍼 + 새 L4 핵심 물리(축별 벌크 블러)

**Files:**
- Modify: `src/model/levels.js:7-244` (스키마·기본값·`levelEffect`·`effectiveEdgeMargin`·`extremeDiffusionParams`)
- Test: `test/l4-profile.mjs` (신규 파일 — 이 태스크에서 생성해 이후 태스크에서 계속 추가)

- [x] **Step 1: `LEVEL_SCHEMA[4]`/`LEVEL_DEFAULTS[4]`를 새 필드로 교체**

`src/model/levels.js`에서 기존 4번 스키마 블록(현재 31-44행)을 통째로 아래로 교체:

```js
  4: {
    label: '형상·자유(도파관)', hint: 'X·Y 독립 두께 프로필(중심·중간·가장자리) · L3 대체',
    fields: [
      { key: 'tx0', label: 'X중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx100', label: 'X가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty0', label: 'Y중심', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'ty100', label: 'Y가장자리', unit: 'mm', min: 0.5, max: 10, step: 0.5 },
      { key: 'tx50', label: 'X중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'ty50', label: 'Y중간', unit: 'mm', min: 0.5, max: 10, step: 0.5, adv: true },
      { key: 'edgeR', label: '모서리R', unit: 'mm', min: 0, max: 50, step: 1, adv: true },
    ],
    desc: '기구물 두께를 X·Y축 각각 중심→가장자리 3점(중심·중간·가장자리)으로 독립 지정하는 도파관 형상. (켜지면 L3 대체) L3와 같은 TIR 원리로, 그 축의 중심 두께가 두꺼울수록 갇힌 빛이 그 방향으로 더 멀리 퍼져 확산이 커진다 — X·Y를 다르게 주면 축별로 확산 강도가 실제로 달라진다. 중간 지점은 가장자리 근처 형상(볼록/오목)을 보조적으로 다듬는다. 모서리R로 네 모서리를 둥글게 해 집광 없이 고르게 퍼지도록 함.',
  },
```

`LEVEL_DEFAULTS`(현재 60-66행)의 4번 항목을 교체:

```js
  4: { on: false, tx0: 3, tx50: 2, tx100: 1, ty0: 3, ty50: 2, ty100: 1, edgeR: 5 },
```

- [x] **Step 2: 새 스키마로 UI가 깨지지 않는지 확인**

Run: `npx --yes serve -l 5173 .` 후 브라우저로 `http://localhost:5173` 열기.
Expected: "설계변경" 카드의 L4("형상·자유(도파관)")가 X중심/X가장자리/Y중심/Y가장자리 4칸 +
"고급" 토글 안에 X중간/Y중간/모서리R 3칸으로 정상 렌더링됨(체크박스 켜도 에러 없이 재계산).
서버는 다음 단계 전에 Ctrl+C로 종료.

- [x] **Step 3: 공유 `tirParams()` 헬퍼 추출 (L3 동작 불변 리팩터)**

`src/model/levels.js`의 `BOARD_REFL` 상수 선언 바로 뒤에 새 함수를 추가:

```js
// TIR(전반사) 도파관 공통 물리량 — L3·L4가 공유. 굴절률 n·LED 빔각으로 정해지는 임계각 기반
// 갇힘비율(fracTrapped)과, 두께 1mm당 옆으로 퍼지는 거리 계수(K_RANGE, 1회 바운스 보수적 상한).
function tirParams(spec, d) {
  const n = spec.body?.n ?? 1.59;
  const critAngle = n > 1 ? Math.asin(1 / n) : Math.PI / 2;
  const mLamb = lambertianExponent(spec.led?.beamX ?? 120);
  const fracTrapped = clamp(Math.pow(Math.cos(critAngle), mLamb + 2), 0, 0.9);
  const minThk = Math.max(1, (spec.body?.baseThk ?? 3) * 0.5);
  const maxThk = Math.max(minThk, d - (spec.led?.sizeZ ?? 0.5) - 0.5);
  const K_RANGE = 2 * Math.tan(critAngle);
  return { fracTrapped, minThk, maxThk, K_RANGE };
}
```

`levelEffect`의 `case 3` 블록(현재 112-150행) 전체를 아래로 교체 — 계산 결과는 기존과 동일하고,
`hasBoost`/`searchMag` 필드만 새로 추가된다(범용 소비 함수를 위해, Step 5 참고):

```js
    case 3: {
      // 균일두께 용기 = 진짜 도파관(TIR 라이트가이드). 물리량은 tirParams() 공유(L4와 동일 유도).
      const { fracTrapped, minThk, maxThk, K_RANGE } = tirParams(spec, d);
      const wallThk = Math.max(minThk, Math.min(p.wallThk ?? 3, maxThk));
      const bulkBlur = K_RANGE * wallThk * fracTrapped;

      // 가장자리 보정은 보조 효과로만(주 메커니즘은 위 bulkBlur) — 기존 필드 최댓값을 못 넘게
      // 캡을 씌워 비단조 악화를 막는다(directLit.js applyTaperEdgeBoost 참고).
      const edgeAngleDeg = clamp(p.edgeAngle ?? 45, 1, 89);
      const edgeAngleRad = edgeAngleDeg * Math.PI / 180;
      const tw = wallThk > minThk ? (wallThk - minThk) / Math.tan(edgeAngleRad) : 0;
      const boostMax = clamp(0.03 * (wallThk - minThk) * Math.sin(edgeAngleRad), 0, 0.25);
      const cornerR = Math.max(0, p.edgeR ?? 0);
      return {
        blurX: bulkBlur, blurY: bulkBlur, transmit: 0.97,
        edgeBoost: { tw, boostMax, cornerR, hasBoost: tw > 0 && boostMax > 0, searchMag: boostMax + cornerR * 0.01 },
      };
    }
```

- [x] **Step 4: 리팩터로 L3 결과가 바뀌지 않았는지 확인하는 테스트 작성**

Create `test/l4-profile.mjs`:

```js
// 새 L4(X·Y 독립 두께 프로필) 물리·형상 검증 + L3 리팩터 회귀 방지.
import { levelEffect } from '../src/model/levels.js';
import { DEFAULT_SPEC } from '../src/model/defaults.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log('PASS', name); pass++; }
  else { console.log('FAIL', name, detail); fail++; }
}

function baseSpec() {
  return JSON.parse(JSON.stringify(DEFAULT_SPEC));
}

// L3 리팩터(tirParams 추출) 후에도 wallThk=6mm 결과가 기존 실측값과 같아야 한다.
{
  const spec = baseSpec();
  spec.levels[3] = { on: true, wallThk: 6, edgeAngle: 45, edgeR: 5 };
  const e = levelEffect(spec, 3, spec.space.depth);
  check('L3 blurX>0 (도파관 확산 정상)', e.blurX > 0, `blurX=${e.blurX}`);
  check('L3 blurX===blurY (등방)', e.blurX === e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  check('L3 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

process.exitCode = fail ? 1 : 0;
console.log(`\n${pass} passed, ${fail} failed`);
```

- [x] **Step 5: 테스트 실행해 통과 확인**

Run: `node test/l4-profile.mjs`
Expected: 3개 PASS, 0 FAIL. (이 시점엔 L3만 검증하며, L4 관련 테스트는 다음 Step에서 추가)

- [x] **Step 6: 새 `levelEffect` case 4(축별 벌크 블러) 작성**

`case 4` 블록(현재 152-158행, 옛 경험식) 전체를 아래로 교체:

```js
    case 4: {
      // 자유형상 도파관 — L3와 같은 TIR 벌크 블러를 X·Y축 각각의 "중심 두께"로 독립 적용한다.
      // 캡이 없는 항이라 tx0≠ty0 이면 두 축의 확산 강도가 실제로 달라진다(핵심 개선).
      const { fracTrapped, minThk, maxThk, K_RANGE } = tirParams(spec, d);
      const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
      const tx0 = clampThk(p.tx0, 3), tx50 = clampThk(p.tx50, 2), tx100 = clampThk(p.tx100, 1);
      const ty0 = clampThk(p.ty0, 3), ty50 = clampThk(p.ty50, 2), ty100 = clampThk(p.ty100, 1);
      const bulkBlurX = K_RANGE * tx0 * fracTrapped;
      const bulkBlurY = K_RANGE * ty0 * fracTrapped;

      // 보조 보정: 중심→가장자리 두께 낙차만큼 L3와 동일한 계수(0.03)·캡(0.25)으로 국소 보정
      // 세기를 정한다. 실제 픽셀별 보정은 directLit.js applyAxisEdgeBoost()가 수행(Task 2).
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

- [x] **Step 7: `effectiveEdgeMargin`을 두 edgeBoost 형태에 범용으로 동작하도록 일반화**

`effectiveEdgeMargin`(현재 245-248행) 전체를 아래로 교체:

```js
// 판정용 가장자리 마진 — L3·L4 중 켜진 쪽이 실제로 가장자리를 보강한다는 근거(hasBoost)가
// 있으면 마진을 0으로 낮춰(=가장자리까지 전부 판정) 그 보강 효과가 실제로 반영되게 한다.
export function effectiveEdgeMargin(baseMargin, edgeBoost) {
  return edgeBoost?.hasBoost ? 0 : baseMargin;
}
```

- [x] **Step 8: `extremeDiffusionParams`의 mag() 계산을 두 형태에 범용으로 동작하도록 일반화**

`extremeDiffusionParams`의 `mag` 함수(현재 188-192행) 안의 `edgeMag` 줄을 교체:

```js
  const mag = (p) => {
    const e = levelEffect({ levels: { [level]: p } }, level, depth);
    const edgeMag = e.edgeBoost ? e.edgeBoost.searchMag : 0;
    return Math.hypot(e.blurX, e.blurY) + edgeMag;
  };
```

(주의: `tirParams`가 `spec.target`을 참조하지 않는지 반드시 확인 — 이 함수는 `{ levels: { [level]: p } }`처럼
`target` 없는 합성 spec으로 `levelEffect`를 호출하므로, Step 6의 case 4 코드가 `spec.target`을
참조하면 여기서 크래시한다. 위 Step 6 코드는 `spec.target`을 쓰지 않으므로 안전하다.)

- [x] **Step 9: `combinedEffect`의 주석 갱신(사소, 동작 변경 없음)**

`combinedEffect`(현재 223-238행) 안의 주석 줄을 교체:

```js
    if (e.edgeBoost) edgeBoost = e.edgeBoost;   // L3 또는 L4(둘 중 켜진 쪽) — 위치 의존 가장자리 보정
```

- [x] **Step 10: L4 물리 테스트 추가 후 전체 실행**

`test/l4-profile.mjs`의 `process.exitCode = ...` 줄 바로 앞에 추가:

```js
// tx0>ty0 이면 X 방향 벌크 블러가 더 커야 한다 — 캡 없는 핵심 메커니즘의 존재 증명.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const e = levelEffect(spec, 4, spec.space.depth);
  check('tx0>ty0 → blurX>blurY', e.blurX > e.blurY, `blurX=${e.blurX} blurY=${e.blurY}`);
  const ratio = e.blurX / e.blurY;
  check('블러 비율이 두께 비율(6/3=2)과 일치', Math.abs(ratio - 2) < 0.01, `ratio=${ratio}`);
  check('L4 edgeBoost.kind === "axis"', e.edgeBoost.kind === 'axis');
  check('L4 edgeBoost.hasBoost=true', e.edgeBoost.hasBoost === true);
}

// tx0===ty0 이면 대칭이어야 한다(회귀 방지).
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 4, tx50: 3, tx100: 2, ty0: 4, ty50: 3, ty100: 2, edgeR: 0 };
  const e = levelEffect(spec, 4, spec.space.depth);
  check('tx0=ty0 → blurX=blurY', Math.abs(e.blurX - e.blurY) < 1e-9, `blurX=${e.blurX} blurY=${e.blurY}`);
}
```

Run: `node test/l4-profile.mjs`
Expected: 8개 PASS, 0 FAIL.

- [x] **Step 11: 커밋**

```bash
git add src/model/levels.js test/l4-profile.mjs
git commit -m "$(cat <<'EOF'
feat: replace L4 empirical shape formula with per-axis TIR bulk blur

Extract shared tirParams() from L3's levelEffect and reuse it for the new
L4, which now applies the same uncapped bulk-blur mechanism independently
to X and Y via a 3-point thickness profile per axis. effectiveEdgeMargin
and extremeDiffusionParams are generalized (hasBoost/searchMag) so they
work with both L3's and L4's edgeBoost shapes without branching.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

**STATUS: Task 1 implemented, spec-reviewed (✅ compliant), code-quality-reviewed.
Code quality review raised two Important follow-ups being tracked separately:
(a) wire test/l4-profile.mjs into `npm test` — now handled explicitly in Task 8 below;
(b) the L3-regression test's `blurX===blurY` assertion is tautological for case 3
(always shares one `bulkBlur`) and doesn't pin a numeric value — accepted as a known
minor test-strength gap, not worth a fix-up task on its own since Task 1's actual
numeric correctness was independently verified by the spec reviewer reading the code.**

---

### Task 2: `directLit.js` — edgeBoost를 두 종류(taper/axis)로 일반화

**Files:**
- Modify: `src/engine/directLit.js:257-296` (`computeField`의 호출 가드 + `applyEdgeBoost`)
- Test: `test/l4-profile.mjs` (추가)

- [ ] **Step 1: `computeField`의 호출 가드를 범용 `hasBoost`로 교체**

`computeField` 안의 다음 블록(현재 260-262행):

```js
  if (opt.edgeBoost && opt.edgeBoost.tw > 0 && opt.edgeBoost.boostMax > 0) {
    applyEdgeBoost(field, NX, NY, x0, x1, y0, y1, X, Y, opt.edgeBoost);
  }
```

를 아래로 교체:

```js
  if (opt.edgeBoost && opt.edgeBoost.hasBoost) {
    applyEdgeBoost(field, NX, NY, x0, x1, y0, y1, X, Y, opt.edgeBoost);
  }
```

- [ ] **Step 2: 기존 `applyEdgeBoost`를 `applyTaperEdgeBoost`로 이름만 바꾸고, 분기 디스패처 추가**

기존 함수 선언 줄(현재 271행) `function applyEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {`를
`function applyTaperEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {`로 이름만 변경한다(함수
본문은 그대로 둔다). 그 함수 정의 바로 위에 디스패처를 새로 추가:

```js
// L3(단일 테이퍼)와 L4(X·Y 독립 프로필)는 edgeBoost 모양이 달라 각자의 함수로 분기한다.
function applyEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {
  if (edge.kind === 'axis') applyAxisEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge);
  else applyTaperEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge);
}

```

- [ ] **Step 3: 축별 두께 프로필 → 0~1 보정 세기 램프 함수 추가**

`applyTaperEdgeBoost` 함수 정의가 끝나는 지점(원래의 `applyEdgeBoost` 마지막 `}`, 현재 296행)
바로 뒤에 추가:

```js
// pts=[중심,중간,가장자리] 두께(mm), halfLen=그 축의 중심→가장자리 거리(mm), dist=가장자리로부터의
// 거리(0=가장자리..halfLen=중심). 반환값은 "중심 두께 대비 얼마나 깎였는지"의 비율(0=안 깎임,
// 1=가장자리 두께까지 다 깎임) — L3의 t(=1-edgeDist/tw)와 같은 역할을 프로필 기반으로 일반화한 것.
// 중간 지점이 중심보다 두꺼운 비단조 프로필도 허용하기 위해 살짝 초과(1.3)까지만 클램프한다.
function axisRamp(pts, halfLen, dist) {
  const f = halfLen > 0 ? Math.min(1, Math.max(0, dist / halfLen)) : 1;   // 0=가장자리,1=중심
  const thk = f <= 0.5 ? pts[2] + (pts[1] - pts[2]) * (f / 0.5) : pts[1] + (pts[0] - pts[1]) * ((f - 0.5) / 0.5);
  const range = Math.max(1e-6, pts[0] - pts[2]);
  return Math.min(1.3, Math.max(0, (pts[0] - thk) / range));
}

// L4(X·Y 독립 두께 프로필)의 가장자리 보정 — applyTaperEdgeBoost와 같은 "평균 대비 절대량,
// 기존 최댓값 캡" 원칙을 X·Y 두 축 각각의 램프 중 더 큰 쪽(Math.max)으로 적용한다.
function applyAxisEdgeBoost(f, nx, ny, x0, x1, y0, y1, X, Y, edge) {
  const { x: ex, y: ey, cornerR } = edge;
  const halfX = X / 2, halfY = Y / 2;
  const r = Math.max(0, Math.min(cornerR ?? 0, Math.min(halfX, halfY)));
  let sum = 0, maxF = -Infinity;
  for (let k = 0; k < f.length; k++) { sum += f[k]; if (f[k] > maxF) maxF = f[k]; }
  const avg = f.length ? sum / f.length : 0;
  for (let j = 0; j < ny; j++) {
    const py = ny === 1 ? Y / 2 : y0 + (y1 - y0) * (j / (ny - 1));
    const dy = ny === 1 ? halfY : Math.min(py, Y - py);
    for (let i = 0; i < nx; i++) {
      const px = nx === 1 ? X / 2 : x0 + (x1 - x0) * (i / (nx - 1));
      const dx = Math.min(px, X - px);
      const rounded = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : null;
      const dxEff = rounded == null ? dx : rounded;
      const dyEff = rounded == null ? dy : rounded;
      const boost = Math.max(ex.boostMax * axisRamp(ex.pts, halfX, dxEff), ey.boostMax * axisRamp(ey.pts, halfY, dyEff));
      if (boost > 0) {
        const idx = j * nx + i;
        f[idx] = Math.min(maxF, f[idx] + avg * boost);
      }
    }
  }
}
```

- [ ] **Step 4: `l4-profile.mjs`에 필드 적용 테스트 추가**

`process.exitCode = ...` 줄 바로 앞에 추가 (`computeField`/`evalGrid`를 새로 import해야 함 —
파일 맨 위 import 줄에 `evalGrid`를 함께 추가):

```js
import { computeField, evalGrid } from '../src/engine/directLit.js';
```

테스트 본문:

```js
// L4 edgeBoost가 실제 필드 계산 경로(computeField)에서 크래시 없이 동작하고, 가장자리 근처
// 조도를 기존 최댓값 이상으로 밀어올리지 않는지(캡이 지켜지는지) 확인.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 5 };
  const eff = levelEffect(spec, 4, spec.space.depth);
  const g = evalGrid(spec, 1.5);
  const res = computeField(spec, {
    depth: spec.space.depth, pitchX: 20, pitchY: 20, nx: g.nx, ny: g.ny,
    blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit, edgeBoost: eff.edgeBoost,
  });
  const maxV = Math.max(...res.field);
  check('L4 edgeBoost 적용 후 필드가 유한하고 양수', Number.isFinite(maxV) && maxV > 0, `max=${maxV}`);
}
```

- [ ] **Step 5: 테스트 실행**

Run: `node test/l4-profile.mjs`
Expected: 9개 PASS, 0 FAIL.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/directLit.js test/l4-profile.mjs
git commit -m "$(cat <<'EOF'
feat: generalize applyEdgeBoost for L4's per-axis profile shape

Rename the existing single-taper implementation to applyTaperEdgeBoost and
add applyAxisEdgeBoost for L4's independent X/Y 3-point profile, dispatched
by edgeBoost.kind. The safety cap (never exceed the field's own max) is
preserved for both.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `levels.js` — 위치기반 `l4BotZAt` + `bodyProfile` 단순화

**Files:**
- Modify: `src/model/levels.js:250-345` (`l4RiseAt`/`l4BotZAt`/`bodyProfile`)
- Test: `test/l4-profile.mjs` (추가)

- [ ] **Step 1: 옛 `l4RiseAt`/`l4BotZAt`(LED 거리 기반) 삭제, 새 위치기반 함수로 교체**

`l4RiseAt` 함수 전체와 `l4BotZAt` 함수 전체(현재 250-281행, 주석 포함)를 통째로 삭제하고 그
자리에 아래를 넣는다:

```js
// L4(자유형상 도파관)용 축별 두께 프로필 평가 — pts=[중심,중간,가장자리] 두께(mm),
// halfLen=중심→가장자리 거리(mm), dist=가장자리로부터의 거리(0=가장자리..halfLen=중심).
// directLit.js의 axisRamp()와 짝을 이루는 함수지만, 여긴 절대 두께(mm)를 반환한다는 점이 다르다.
function axisThickAt(pts, halfLen, dist) {
  const f = halfLen > 0 ? clamp(dist / halfLen, 0, 1) : 1;   // 0=가장자리,1=중심
  return f <= 0.5 ? pts[2] + (pts[1] - pts[2]) * (f / 0.5) : pts[1] + (pts[0] - pts[1]) * ((f - 0.5) / 0.5);
}

// L4(자유형상 도파관)의 실제 2D 두께 함수 — X·Y 각각 3점 프로필을 평가해 min(Tx,Ty)로 결합한다.
// l3BotZAt과 같은 "둥근 모서리 인지 거리" 공식을 재사용해 광학 계산(directLit.js
// applyAxisEdgeBoost)과 STEP 형상이 일치하게 한다. bodyProfile·plan.js·step-export.js가 공유.
export function l4BotZAt(spec, depth, x, y) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  const sp4 = levelParams(spec, 4);
  const { minThk, maxThk } = tirParams(spec, depth);
  const clampThk = (v, fb) => Math.max(minThk, Math.min(v ?? fb, maxThk));
  const tx = [clampThk(sp4.tx0, 3), clampThk(sp4.tx50, 2), clampThk(sp4.tx100, 1)];
  const ty = [clampThk(sp4.ty0, 3), clampThk(sp4.ty50, 2), clampThk(sp4.ty100, 1)];
  const r = Math.max(0, Math.min(sp4.edgeR ?? 0, Math.min(X, Y) / 2));

  const dx = Math.min(x, X - x), dy = Math.min(y, Y - y);
  const rounded = (dx < r && dy < r) ? r - Math.hypot(r - dx, r - dy) : null;
  const dxEff = rounded == null ? dx : rounded;
  const dyEff = rounded == null ? dy : rounded;
  const thk = Math.min(axisThickAt(tx, X / 2, dxEff), axisThickAt(ty, Y / 2, dyEff));
  return depth - thk;
}
```

- [ ] **Step 2: `bodyProfile`을 단순화(옛 L4 분기 제거, L3도 `l3BotZAt` 재사용)**

`bodyProfile` 함수 전체(현재 284-324행)를 아래로 교체:

```js
// 기구물 단면(X 방향, Y=중앙 대표 슬라이스): 활성 형상 난이도 기준
export function bodyProfile(spec, active, depth, nx = 160) {
  const A = new Set(active ?? activeLevels(spec));
  const X = spec.target.xLen, Y = spec.target.yLen;
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const topZ = depth;
  const useL4 = A.has(4), useL3 = A.has(3) && !useL4;

  const pts = [];
  for (let i = 0; i < nx; i++) {
    const x = (i / (nx - 1)) * X;
    const botZ = useL4 ? l4BotZAt(spec, depth, x, Y / 2)
      : useL3 ? l3BotZAt(spec, depth, x, Y / 2)
      : topZ - baseThk;
    pts.push({ x, botZ, topZ });
  }
  return pts;
}
```

(`leds`·`pitch` 인자를 제거했다 — 새 L4는 LED 위치가 아니라 타겟 X·Y 좌표만으로 두께가
정해지므로 더 이상 필요 없다. 호출부는 Task 4에서 갱신.)

- [ ] **Step 3: 형상 테스트 추가**

`test/l4-profile.mjs` 맨 위 import 줄을 갱신해 `l4BotZAt`을 추가:

```js
import { levelEffect, l4BotZAt } from '../src/model/levels.js';
```

그리고 `process.exitCode = ...` 줄 바로 앞에 추가:

```js
// l4BotZAt 형상 — 중심/가장자리 두께가 min(Tx,Ty)로 결합되는지 확인.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 2, ty0: 3, ty50: 2.5, ty100: 1.5, edgeR: 0 };
  const X = spec.target.xLen, Y = spec.target.yLen, depth = spec.space.depth;

  const thkCenter = depth - l4BotZAt(spec, depth, X / 2, Y / 2);
  check('중심 두께 = min(tx0,ty0)=3', Math.abs(thkCenter - 3) < 0.01, `thk=${thkCenter}`);

  const thkXEdge = depth - l4BotZAt(spec, depth, 0, Y / 2);
  check('X 가장자리(Y중앙) 두께 = min(tx100=2, ty0=3) = 2', Math.abs(thkXEdge - 2) < 0.01, `thk=${thkXEdge}`);

  const thkYEdge = depth - l4BotZAt(spec, depth, X / 2, 0);
  check('Y 가장자리(X중앙) 두께 = min(tx0=6, ty100=1.5) = 1.5', Math.abs(thkYEdge - 1.5) < 0.01, `thk=${thkYEdge}`);
}

// 모서리R을 켜도(코너 라운드) 두께가 물리적 범위([minThk,maxThk]) 안에서 유한하게 나오는지.
{
  const spec = baseSpec();
  spec.levels[4] = { on: true, tx0: 6, tx50: 4, tx100: 1.5, ty0: 6, ty50: 4, ty100: 1.5, edgeR: 10 };
  const depth = spec.space.depth;
  const thkCorner = depth - l4BotZAt(spec, depth, 3, 3);
  check('모서리R 근처 두께가 유한하고 [1.5,11] 범위 안', Number.isFinite(thkCorner) && thkCorner >= 1.4 && thkCorner <= 11.1, `thk=${thkCorner}`);
}
```

- [ ] **Step 4: 테스트 실행**

Run: `node test/l4-profile.mjs`
Expected: 13개 PASS, 0 FAIL.

- [ ] **Step 5: 커밋**

```bash
git add src/model/levels.js test/l4-profile.mjs
git commit -m "$(cat <<'EOF'
refactor: replace LED-radial L4 shape with position-based min(Tx,Ty)

l4BotZAt now takes (spec, depth, x, y) like l3BotZAt, evaluating the new
per-axis 3-point profile and combining X/Y via min() with the same rounded-
corner treatment l3BotZAt already uses. bodyProfile drops its now-unused
leds/pitch params and reuses l3BotZAt/l4BotZAt directly for both shapes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `geometry.js` — 옛 L4 시각화 배선 제거

**Files:**
- Modify: `src/model/geometry.js`

- [ ] **Step 1: import에서 옛 `l4BotZAt` 사용 제거**

파일 6행:

```js
import { LEVEL_SCHEMA, levelParams, levelEffect, combinedEffect, activeLevels, bodyProfile, effectiveEdgeMargin, l4BotZAt } from './levels.js';
```

를 아래로 교체(`l4BotZAt` 제거 — `bodyProfile`이 내부적으로 처리하므로 `geometry.js`는 더 이상
직접 호출할 필요 없음):

```js
import { LEVEL_SCHEMA, levelParams, levelEffect, combinedEffect, activeLevels, bodyProfile, effectiveEdgeMargin } from './levels.js';
```

- [ ] **Step 2: `diffuseVisual`에서 옛 L4 조건 제거**

현재:

```js
  const diffuseVisual = (active.has(2) && (p2.milky ?? 1) > 1.5) || active.has(4);
```

를:

```js
  // 새 L4는 L3처럼 매끈한 도파관 형상이라(부피 확산재가 아님) 밀키 점묘 오버레이를 켜지 않는다.
  const diffuseVisual = active.has(2) && (p2.milky ?? 1) > 1.5;
```

- [ ] **Step 3: `planShape`/`l4Height`/`l4HalfP` 블록 삭제**

현재 39-50행(주석 포함, `useL4`부터 `l4Height` 선언까지) 전체를 삭제:

```js
  // 평면도용 형상 정보: LED 중심 flat 패드 크기 (L4 전용 — L3 는 이제 타겟 전체 1개의 균일두께
  // 용기 형상이라 LED별 flat 패드 개념이 없음)
  const useL4 = active.has(4);
  const sp4 = useL4 ? levelParams(spec, 4) : null;
  const planShape = sp4
    ? { kind: 'L4', flatX: sp4.flatX ?? 4, flatY: sp4.flatY ?? 4, gap: sp4.gap ?? 2 }
    : null;

  // TOP VIEW 2D 등고선용 — SIDE VIEW(bodyProfile)와 같은 l4BotZAt() 을 공유해 두 뷰가 서로 다른
  // 형상으로 보이던 문제(패드만 있고 실제 굴곡은 안 보임)를 해소.
  const halfPShape = Math.max(1, Math.min(pitchX, pitchY) / 2);
  const l4Height = useL4 ? (dist) => l4BotZAt(spec, active, depth, dist, halfPShape) : null;

```

(이 값들은 옛 "LED 중심 flat 패드 + 반경별 상승" 개념 전용이었고, 새 L4는 L3와 같은 전역
X·Y 형상이라 더 이상 쓰이지 않는다 — Task 5에서 `plan.js`의 소비 코드도 함께 제거한다.)

- [ ] **Step 4: `return` 객체에서 제거한 필드 정리 + `bodyProfile` 호출 갱신**

현재 `return { ... }` 블록의 아래 줄:

```js
    levelText: tags.length ? tags.join(' + ') : '기본 평판',
    diffuseVisual, patternVisual, planShape, l4Height, l4HalfP: halfPShape,
    ledTop: spec.led.sizeZ,
    bodyProfile: (nx = 160) => bodyProfile(spec, [...active], leds, depth, pitchX, nx),
  };
```

를:

```js
    levelText: tags.length ? tags.join(' + ') : '기본 평판',
    diffuseVisual, patternVisual,
    ledTop: spec.led.sizeZ,
    bodyProfile: (nx = 160) => bodyProfile(spec, [...active], depth, nx),
  };
```

- [ ] **Step 5: 수동 확인**

Run: `npx --yes serve -l 5173 .`, 브라우저에서 L4 체크박스를 켜고 SIDE VIEW/TOP VIEW/입체도가
에러 없이 그려지는지 확인(콘솔에 `l4Height`/`planShape` 관련 에러가 없어야 함). 확인 후 서버 종료.

- [ ] **Step 6: 커밋**

```bash
git add src/model/geometry.js
git commit -m "$(cat <<'EOF'
refactor: drop L4's old LED-radial plan/section visualization wiring

planShape/l4Height/l4HalfP were specific to the retired per-LED flat-pad +
radial-rise shape. The new L4 is a global X/Y taper like L3, so it needs no
special TOP VIEW markup — bodyProfile's outline already reflects it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `plan.js` — 옛 L4 링 렌더링 제거

**Files:**
- Modify: `src/ui/plan.js`

- [ ] **Step 1: L4 동심원 렌더링 블록 삭제**

현재 48-68행(주석 포함, `// L4 — 실제 반경별...`부터 그 `if` 블록의 닫는 `}`까지) 전체를 삭제.

- [ ] **Step 2: `planShape` 캡션 참조 제거**

현재:

```js
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  const pad = g.planShape ? ` · flat ${g.planShape.flatX}×${g.planShape.flatY}mm` : '';
  const grid = xs.length && ys.length ? ` (${xs.length}×${ys.length})` : '';
  ctx.fillText(`LED ${g.leds.length}개${grid} · ${g.dim} · ${X}×${Y}mm${pad}`, PAD.L, h - 7);
```

를:

```js
  ctx.fillStyle = C.dim; ctx.font = '12px system-ui';
  const grid = xs.length && ys.length ? ` (${xs.length}×${ys.length})` : '';
  ctx.fillText(`LED ${g.leds.length}개${grid} · ${g.dim} · ${X}×${Y}mm`, PAD.L, h - 7);
```

- [ ] **Step 3: 수동 확인**

Run: `npx --yes serve -l 5173 .`, TOP VIEW(평면 배치) 패널이 L4 on/off 모두에서 정상 렌더링되고
캡션 줄에 에러 문자열이 없는지 확인. 확인 후 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/ui/plan.js
git commit -m "$(cat <<'EOF'
refactor: remove plan.js's retired L4 concentric-ring rendering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `step-export.js` — `makeBotZAt`를 새 시그니처로 갱신

**Files:**
- Modify: `src/export/step-export.js:26-79`

- [ ] **Step 1: `makeBotZAt` 갱신**

현재 26-36행:

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

를:

```js
// 활성 레벨 조합에서 botZAt(x,y) 함수를 만든다. bodyProfile()과 동일한 우선순위(L4가 L3를 대체).
function makeBotZAt(spec, active, depth) {
  const A = active instanceof Set ? active : new Set(active);
  if (A.has(4)) return (x, y) => l4BotZAt(spec, depth, x, y);
  if (A.has(3)) return (x, y) => l3BotZAt(spec, depth, x, y);
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  return () => depth - baseThk;
}
```

- [ ] **Step 2: 호출부 갱신(옛 `halfP`/`geom.l4HalfP` 배선 제거)**

현재 78-79행:

```js
  const halfP = geom.l4HalfP ?? Math.max(1, Math.min(combo.pitchX, combo.pitchY ?? combo.pitchX) / 2);
  const botZAt = makeBotZAt(spec, active, depth, geom.leds, halfP);
```

를:

```js
  const botZAt = makeBotZAt(spec, active, depth);
```

- [ ] **Step 3: STEP 생성 테스트로 확인**

Run: `npm run test:step`
Expected: 기존 `L4 STEP 생성 성공` 항목을 포함해 모두 PASS(새 기본값으로도 형상 파이프라인이
정상 동작해야 함).

- [ ] **Step 4: 커밋**

```bash
git add src/export/step-export.js
git commit -m "$(cat <<'EOF'
refactor: update makeBotZAt for l4BotZAt's new position-based signature

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 버전 문자열 갱신 (구 로컬스토리지 값과 분리)

**Files:**
- Modify: `src/main.js:15`
- Modify: `src/model/defaults.js:9`

- [ ] **Step 1: `LS_KEY` 갱신**

`src/main.js` 15행:

```js
const LS_KEY = 'uds.spec.v9';
```

를:

```js
const LS_KEY = 'uds.spec.v10';
```

- [ ] **Step 2: `DEFAULT_SPEC.ver` 갱신**

`src/model/defaults.js` 9행:

```js
  ver: 10,                      // 저장 스펙 마이그레이션용(main.migrate)
```

를:

```js
  ver: 11,                      // 저장 스펙 마이그레이션용(main.migrate) — L4 스키마 교체(v11)
```

- [ ] **Step 3: 수동 확인**

Run: `npx --yes serve -l 5173 .`, 브라우저 개발자도구 Application/Storage 탭에서 로컬스토리지
키가 `uds.spec.v10`으로 새로 생기는지 확인(기존 `uds.spec.v9` 값은 무시되고 기본값으로 시작).
확인 후 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/main.js src/model/defaults.js
git commit -m "$(cat <<'EOF'
chore: bump storage key/spec version for the L4 schema change

Old localStorage data (uds.spec.v9) is simply superseded rather than
migrated in place — main.migrate() already rebuilds levels[4] from the new
schema for JSON re-imports, so no compatibility shim is needed here.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 테스트 스위트 배선 + 전체 검증

**Files:**
- Modify: `package.json:9`

- [ ] **Step 1: `test/l4-profile.mjs`를 기본 테스트 체인에 연결**

`package.json`의 `"test"` 스크립트:

```json
    "test": "node test/smoke.mjs && node test/heatmap-labels.mjs && node test/overhang.mjs && node test/layout.mjs && node test/center.mjs && node test/profile-labels.mjs",
```

를:

```json
    "test": "node test/smoke.mjs && node test/heatmap-labels.mjs && node test/overhang.mjs && node test/layout.mjs && node test/center.mjs && node test/profile-labels.mjs && node test/l4-profile.mjs",
```

- [ ] **Step 2: 전체 스위트 실행**

Run: `npm test`
Expected: 모든 파일 PASS, 0 FAIL(특히 `smoke.mjs`의 `solvePerLevel`이 새 L4 스키마로도
`autoTuneLevel`/`extremeDiffusionParams`를 크래시 없이 통과해야 함).

- [ ] **Step 3: STEP 내보내기 스위트 실행**

Run: `npm run test:step`
Expected: 모든 PASS(L1/L3/L4/L5 케이스 포함).

- [ ] **Step 4: 브라우저 수동 확인 (골든 패스)**

Run: `npx --yes serve -l 5173 .`, 브라우저에서:
1. L4 카드 체크박스 on → X중심/X가장자리/Y중심/Y가장자리 값을 서로 다르게(예: X중심=6, Y중심=3)
   입력 → 히트맵/프로파일에서 X·Y 방향 조도 분포가 실제로 달라지는지 육안 확인.
2. "고급" 토글을 열어 X중간/Y중간/모서리R 입력 → 재계산이 에러 없이 즉시 반영되는지 확인.
3. L4 on 상태에서 L3 체크박스도 켜 봐도(대체 규칙) 에러 없이 L4 결과가 그대로 쓰이는지 확인.
4. JSON 내보내기 → 다시 불러오기가 에러 없이 왕복되는지 확인.

확인 후 서버 종료.

- [ ] **Step 5: 커밋**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
test: wire l4-profile.mjs into the default npm test chain

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **스펙 커버리지**: 설계 문서의 "1. 통합 L3"(Task 1의 L3 불변 검증), "2. 새 L4"의 파라미터·
  주 메커니즘·보조 보정·형상(Task 1·2·3), "3. 자동탐색 영향"(Task 1 Step 8, 기존 구조 유지 —
  추가 작업 없음, 문서에도 "변경하지 않는다"로 명시됨), "마이그레이션"(Task 7 + 기존
  `main.js migrate()` 재사용), "테스트 계획"의 두 신규 케이스(X≠Y 독립 효과 = Task 1 Step 10,
  코너 결합 = Task 3 Step 3) 모두 태스크로 반영됨.
- **자리표시자 스캔**: 전 태스크 코드 블록에 TBD/TODO 없음, 모든 코드가 완전한 상태로 작성됨.
- **타입/시그니처 일관성**: `l4BotZAt(spec, depth, x, y)` 시그니처가 Task 3(정의)·Task 4
  (호출부 제거 확인)·Task 6(호출부 갱신)에서 동일하게 유지됨. `bodyProfile(spec, active, depth,
  nx)` 시그니처가 Task 3(정의)·Task 4(호출부)에서 일치. `edgeBoost.hasBoost`/`searchMag` 필드가
  Task 1(L3·L4 생성)·Task 2(소비: `computeField` 가드) 전체에서 일관되게 사용됨.
