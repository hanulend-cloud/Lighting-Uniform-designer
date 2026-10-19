# LED STEP 가상 배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LED STEP 을 불러온 상태에서도 기준 LED 의 몸체·발광점을 복사해 관측 라인을 따라 개수·피치대로 다시 놓을 수 있게 하고(가상 배치), 자동설계 ② 가 LED STEP 에서도 동작하게 한다.

**Architecture:** 순수 엔진 `virtual-leds.js` 가 (변환된 LED STEP 부품, 지정, 라인, 개수·피치) → 가상 부품·LED 번호·PCB·발광점을 만든다. `leds.js` 의 새 `stepLayout(M, line)` 이 원래/가상 배치를 하나로 돌려주고(캐시), 기존 `ledPartsNow`·`currentEmitters`·`ledBodies`·화면·작업 생성이 그것을 쓴다. Worker 에는 가상 부품을 월드 좌표 그대로 보내고 mspec 복사본의 offset·rot 를 0 으로 둬 `composeScene` 을 바꾸지 않는다.

**Tech Stack:** 바닐라 JS ES 모듈, Node 시험(`ok/done`), 기존 Worker 프로토콜.

**선행:** spec `docs/superpowers/specs/2026-10-19-p4-autodesign-design.md` §2.2a.

**공통 규칙:** 테스트는 `< /dev/null` 로 실행. 한국어 간결 주석. 커밋 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push 는 컨트롤러가 한다.

---

### Task 1: 가상 배치 엔진(`virtual-leds.js`)

**Files:**
- Create: `src/engine/mech3d/virtual-leds.js`
- Test: `test/mech3d-virtual-leds.mjs` (new) — `package.json` `test:mech3d` 끝에 ` && node test/mech3d-virtual-leds.mjs`

라인 API(`src/engine/mech3d/line.js` 의 라인 객체): `frame {u,v,d}`, `to2D([x,y,z]) → [x,y]`, `toSW(x,y) → [s,w]`, `fromSW(s,w) → [x,y]`, `to3D(x,y,h) → [x,y,z]`, `tangentAt(s) → [tx,ty]`, `length`, `closed`. 직선 라인 시험용은 `recognizeLine([topFaceMesh(rectTris(0,0,100,6),12)], faces, [0,0,1])` 패턴(`test/mech3d-place.mjs` 참고), 원 라인은 같은 파일의 `annulusTris` 패턴.

- [ ] **Step 1: 실패하는 시험 작성**

```js
// LED STEP 가상 배치: node test/mech3d-virtual-leds.mjs
import { virtualLayout, rotateAbout } from '../src/engine/mech3d/virtual-leds.js';
import { ledSPositions } from '../src/engine/mech3d/placement.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { bounds } from '../src/engine/mech3d/mesh.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';
// (test/mech3d-place.mjs 의 topFaceMesh·rectTris·annulusTris 도우미를 이 파일로 복사하거나 export 해서 쓴다)

const strip = /* 100×6 직선 라인, z = 12 관측면, 방향 +z */ null;
// LED STEP 부품: 0 = PCB(큰 판), 1·2 = LED 몸체(2×2×1.5), 3 = 기타(나사)
const pcb = boxMesh(-5, -5, 0, 110, 16, 1), led = (x) => boxMesh(x - 1, 2, 1, 2, 2, 1.5), screw = boxMesh(-4, -4, 1, 1, 1, 3);
const parts = [pcb, led(20), led(60), screw];
const step = { leds: [1, 2], pcb: 0, excluded: [], emitters: [{ part: 1, pos: [20, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }, { part: 2, pos: [60, 3, 2.5], axis: [0, 0, 1], xAxis: [1, 0, 0] }] };
{ const v = virtualLayout({ parts, step, line: strip, count: 5, pitch: 0 }), s = ledSPositions(strip, 5, 0);
  ok(v.parts.length === 2 + 5 && v.pcb === 0 && v.leds.join() === '2,3,4,5,6' && v.parts[1] === screw, '부품: PCB·기타 유지, 원래 LED 몸체 빼고 복사 5개 뒤에');
  ok(v.emitters.length === 5 && v.emitters.every((e, k) => Math.abs(e.pos[0] - s[k]) < 1e-6 && Math.abs(e.pos[1] - 3) < 1e-6 && Math.abs(e.pos[2] - 2.5) < 1e-6 && e.part === v.leds[k]), '발광점: s 위치, w·h 는 기준 LED 값');
  const b0 = bounds(led(20).positions), bk = bounds(v.parts[v.leds[2]].positions);
  ok([0, 1, 2, 3, 4, 5].every((i) => Math.abs(bk[i] - b0[i] - (i % 3 === 0 ? s[2] - 20 : 0)) < 1e-5), '몸체 복사 = 기준 몸체를 s 차이만큼 이동(직선)'); }
{ const v = virtualLayout({ parts, step: { ...step, excluded: [1] }, line: strip, count: 2, pitch: 30 });
  ok(Math.abs(v.emitters[1].pos[0] - v.emitters[0].pos[0] - 30) < 1e-6 && v.ref === 2, '제외된 LED 는 기준이 안 됨 → 다음 LED 가 기준, 피치 30'); }
{ const r = rotateAbout([1, 0, 0], [0, 0, 0], [0, 0, 1], Math.PI / 2);
  ok(Math.abs(r[0]) < 1e-12 && Math.abs(r[1] - 1) < 1e-12, 'rotateAbout: d 축 90°'); }
{ // 원 라인: 기준 LED 를 라인 위 다른 각으로 옮기면 xAxis 가 접선을 따라 돈다
  const ring = /* 반경 40 원 라인, 중심 (0,0), z = 12 */ null;
  const em = { part: 1, pos: [40, 0, 2.5], axis: [0, 0, 1], xAxis: [0, 1, 0] }, P = [pcb, boxMesh(39, -1, 1, 2, 2, 1.5)];
  const v = virtualLayout({ parts: P, step: { leds: [1], pcb: 0, excluded: [], emitters: [em] }, line: ring, count: 4, pitch: 0 });
  ok(v.emitters.every((e) => Math.abs(Math.hypot(e.pos[0], e.pos[1]) - 40) < 0.2 && Math.abs(e.xAxis[0] * e.pos[0] + e.xAxis[1] * e.pos[1]) < 0.05 * 40), '원 라인: 반경 유지, xAxis ⟂ 반지름(접선)'); }
done();
```

`strip`·`ring` 은 `test/mech3d-place.mjs` 의 생성 코드 그대로 쓴다(그 파일 10번째 줄 `strip`, 26번째 줄 `ring` — 반경·높이는 그 파일 값에 맞게 시험 숫자를 조정한다: 직선은 z 12 관측면이면 LED 높이 2.5 는 관측면 아래, 원 라인은 반경 37~43 의 고리라 중심선 반경 40).

- [ ] **Step 2: 실패 확인** — `node test/mech3d-virtual-leds.mjs < /dev/null` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — `src/engine/mech3d/virtual-leds.js`

```js
// LED STEP 가상 배치 — spec P4 §2.2a. 기준 LED(제외 안 된 첫 LED)의 몸체·발광점을 관측 라인 위 개수·피치 위치로 복사한다.
// 라인 좌표 (s, w, h) 중 w·h 는 기준 값 유지, 접선 각 차이만큼 관측 방향 d 축으로 회전. 원래 LED 몸체(제외 포함)는 빼고 PCB·기타는 유지.
// parts: LED STEP 부품(월드 좌표 = offset·rot 적용 뒤), step: light.step, 반환 { parts, leds, pcb, emitters, ref }
import { ledSPositions } from './placement.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// 점 p 를 점 c 를 지나는 단위축 k 둘레로 각 a 만큼(Rodrigues)
export function rotateAbout(p, c, k, a) {
  const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], cs = Math.cos(a), sn = Math.sin(a), kd = dot(k, v);
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => c[i] + v[i] * cs + x[i] * sn + k[i] * kd * (1 - cs));
}
const rotDir = (d, k, a) => rotateAbout(d, [0, 0, 0], k, a);
const angle = (line, s) => { const [tx, ty] = line.tangentAt(s); return Math.atan2(ty, tx); };

export function virtualLayout({ parts, step, line, count, pitch = 0 }) {
  const ex = new Set(step.excluded ?? []), em = (step.emitters ?? []).find((e) => !e.needsCheck && !ex.has(e.part));
  if (!em) throw new Error('가상 배치: 기준이 될 LED 가 없음 — LED 발광면을 먼저 지정하세요');
  const ref = em.part, body = parts[ref], F = line.frame;
  const [x0, y0] = line.to2D(em.pos), [s0, w0] = line.toSW(x0, y0), base0 = line.to3D(x0, y0, 0);
  const h0 = dot([em.pos[0] - base0[0], em.pos[1] - base0[1], em.pos[2] - base0[2]], F.d), a0 = angle(line, s0);
  const ledSet = new Set(step.leds ?? []), keep = [], idx = new Map();
  parts.forEach((m, i) => { if (!ledSet.has(i)) { idx.set(i, keep.length); keep.push(m); } });
  const out = { parts: keep.slice(), leds: [], pcb: step.pcb >= 0 && idx.has(step.pcb) ? idx.get(step.pcb) : -1, emitters: [], ref };
  for (const s of ledSPositions(line, count, pitch)) {
    const [x, y] = line.fromSW(s, w0), p = line.to3D(x, y, h0), da = angle(line, s) - a0;
    const P = body.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const r = rotateAbout([P[i], P[i + 1], P[i + 2]], em.pos, F.d, da);
      Q[i] = r[0] - em.pos[0] + p[0]; Q[i + 1] = r[1] - em.pos[1] + p[1]; Q[i + 2] = r[2] - em.pos[2] + p[2];
    }
    const { bvh, ...rest } = body, k = out.parts.length;
    out.parts.push({ ...rest, positions: Q });
    out.leds.push(k);
    out.emitters.push({ part: k, s, pos: p, axis: rotDir(em.axis, F.d, da), xAxis: em.xAxis ? rotDir(em.xAxis, F.d, da) : em.xAxis });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — `node test/mech3d-virtual-leds.mjs < /dev/null && npm run -s test:mech3d < /dev/null` → `all PASS`

- [ ] **Step 5: 커밋** — `feat(mech3d): LED STEP virtual layout — copy reference LED body/emitter along the line by count·pitch`

### Task 2: `stepLayout` 통합 + LED 노드 화면

**Files:**
- Modify: `src/ui/m3/leds.js` — 새 `stepLayout(M, line)`(원래/가상 하나로, 캐시 키 = [LED 메쉬, offset, rot, leds, pcb, excluded, emitters 위치, virtual, line 객체]): 반환 `{ parts, leds, pcb, excluded, emitters, virtual }`. `ledPartsNow(M, line)`·`currentEmitters(M, line)`(step 분기)·`ledBodies(M, line)` 이 이것을 쓴다(가상이면 excluded = []). line 이 없는데 가상이면 원래 배치로 대신한다.
- Modify: `src/ui/m3/app.js` — `ledPartsNow`·`ledBodies` 호출에 `S.line`(또는 실행 스냅샷의 line)을 넘긴다; `renderView` 의 kinds·제외 표시는 `stepLayout` 의 leds·pcb·excluded 를 쓴다; LED 제외 클릭(`ledx`)·발광면 다시 지정은 가상 배치 중 끈다(상태 문구 '가상 배치 중에는 원래 STEP 위치로 돌아가서 지정하세요'); `jobFor`: LED STEP + 가상이면 `ledParts = rawParts(가상 parts)`, mspec 복사본의 `light.step` = `{ ...step, offset:[0,0,0], rot:[0,0,0], leds, pcb, excluded: [], emitters, virtual: null }`.
- Modify: `src/ui/mech3d-light-panel.js` (`renderLedProps`) — LED STEP 이면 "배치" 행: [STEP 원래 위치] [가상 배치] 라디오, 가상이면 개수(정수 ≥ 1)·피치(mm, 0 = 균등) 입력 + [원래 STEP 위치로]. 처음 가상으로 바꿀 때 기본값 = 현재 LED 수, 피치 0. 핸들러: `onStepVirtual(v | null)` → `st.update('light', m => { m.light.step.virtual = v; })`.
- Modify: `src/ui/m3/feature-tree.js` — LED 노드 배지: 가상이면 `가상 ${count}개 ${pitch>0 ? `피치 ${pitch}` : '균등'}`, 개수는 `count`.
- Modify: `src/engine/mech3d/defs.js` `migrateMech3d` — `step.virtual` 이 없으면 null(있으면 count 정수 ≥1·pitch ≥0 로 정리).
- Tests: `test/m3-ui-pure.mjs`(배지·패널 순수 HTML), `test/m3-defs.mjs`(migrate), 가능하면 `stepLayout` 의 순수 부분 시험.

- [ ] 구현 → `npm run -s test:m3`, `npm run -s test:mech3d` 통과 → 커밋 `feat(m3): LED STEP virtual layout in UI — stepLayout, LED node toggle/count/pitch, job & view`

### Task 3: 자동설계 ② 를 LED STEP 에서

**Files:**
- Modify: `src/ui/m3/autodesign-panel.js` `stageAvailability` — LED STEP 이고 발광점이 있으면 ② 가능(`note: 'LED STEP — 기준 LED 를 복사해 가상 배치'`), 없으면 이유.
- Modify: `src/ui/m3/app.js` 자동설계 — `designScene`: LED STEP 이면 `M.light.step.virtual = { count, pitch }`; `cur.count/pitch` = 가상이면 그 값, 아니면 현재 LED 수·0(균등 아님 표시 '원래 위치'); `io.basis`: 후보 위치마다 `virtualLayout` 의 발광점 하나(몸체 없이 — 장면은 PCB·기타만: `virtualLayout({…, count: 0})` 에 해당하는 부품 목록을 쓰도록 `virtualLayout` 에 count 0 허용 추가 또는 `stepBaseParts` 도우미), `emitters` 덮어쓰기로 추적; 최종 verify 는 몸체 포함 전체 장면. `adApply`: LED STEP 이면 `step.virtual = { count, pitch }`(되돌리기 = 이전 virtual 값). 비교표 LED 칸: `LED STEP 원래 10개` → `가상 8개 피치 14` 식.
- Modify: `src/engine/mech3d/virtual-leds.js` — `count: 0` 이면 LED 몸체 없는 부품만 돌려준다(시험 추가).
- Tests: `test/m3-ui-pure.mjs` 가능 여부·비교표, `test/mech3d-virtual-leds.mjs` count 0.

- [ ] 구현 → 시험 통과 → 커밋 `feat(m3): auto-design ② in LED STEP mode via virtual layout`

### Task 4: 브라우저 검증(컨트롤러)
- LED 노드에서 가상 배치 전환 → 개수 6·피치 15 → 3D 에 LED 몸체 6개·발광 화살표, 계산 재시작, [원래 STEP 위치로] 복귀.
- 자동설계 ② (LED STEP) 실행 → 비교 → 적용(가상 배치 저장) → 되돌리기.
- 콘솔 오류 0, 실행 기록.

---

## 실행 기록 (2026-10-20)

| 작업 | 커밋 | 비고 |
|---|---|---|
| 1 엔진 | b95beab | 직선 strip 라인은 s 가 −x 방향(시험이 라인 API 기준으로 맞춤) |
| 2 화면 통합 | f86597f | 순수 핵심 `stepLayoutOf` 는 virtual-leds.js, 캐시 2칸(원래/가상) |
| 3 자동설계 ② | 5c66872 | 후보 지도 = 몸체 없이(PCB 유지), 최종 = 몸체 포함, ①/③ 만 돌릴 때 원래 배치 유지 |
| ② 가장 가까운 안 | be96624 · 7548f83 | **버그: 불가 판정 시 항상 최대 개수(n: nMax 덮어씀)** → 여유가 최고에 가까운 안 중 길이 목표를 넘는 가장 적은 개수 |

### 브라우저 검증 (샘플 + LED STEP 10개)
- LED 노드 [가상 배치] → 6개·피치 15: 배지 "가상 6개 피치 15", 3D·광량 분포에 6개, 계산 재시작. [원래 STEP 위치로] 복귀.
- 자동설계 ② (LED STEP, 목표 0.80/0.80): 29 초, 폭이 막아 35개(길이만 통과)도 현재보다 낫지 않음 → 현재안 유지 + 이유.
- 폭 목표 0.60 으로 임시 변경: 29.9 초, 최적 = 가상 14개 균등(길이 U 0.70→0.80, 폭 0.63). 적용 → `step.virtual = {14, 0}`, 되돌리기 → null(원래 10개). 목표는 0.80 으로 복구. 콘솔 오류 0.
