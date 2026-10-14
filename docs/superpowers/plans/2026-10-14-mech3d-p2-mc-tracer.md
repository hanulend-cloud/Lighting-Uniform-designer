# 3D 기구 모드 P2 — 3D MC 추적기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P1 에서 정의한 3D 기구(부품 메쉬 + 소재·면 처리 + 접촉면)를 그대로 광선추적한다. 추적 대상은 Milky 체적 산란, 굴절·전반사, 반사 면 처리, 광학 접촉이고, 에너지 보존(V3D-2), 접촉면 해석해(V3D-6), 검증된 S1 추적기와의 일치(V3D-1)로 검증한다.

**Architecture:** `src/engine/mech3d/` 에 순수 JS 모듈 5개를 추가하고, 모두 Node 테스트로 검증한다.

| 모듈 | 내용 |
|---|---|
| `surface.js` | 계면 굴절·반사, 반사형 면 처리 |
| `optics.js` | 부품 소재 → μs·g·μa·n·위상함수 |
| `scene3d.js` | 런타임 메쉬 + spec.mech3d → 추적용 장면 |
| `sources.js` | LED 광원 |
| `mc3d.js` | 추적 루프. 매질 스택으로 중첩·접촉을 처리하고, 원장(ledger)을 기록한다 |

UI·Worker 병렬화는 P4/P5 에서 한다. P2 는 엔진과 검증까지만 한다.

**Tech Stack:** 무빌드 ES 모듈, Node 테스트(`node test/*.mjs`, PASS/FAIL, 실패 시 exit 1). 기존 L2 테이블(`test/l2-util.mjs` 의 `loadTable`)과 S1 추적기(`src/engine/shape/mc-body.js`)를 재사용한다.

**Spec:** `docs/superpowers/specs/2026-10-14-3d-line-light-design.md` §3.2–3.4, §6.1, §7(V3D-1·2·6), §8(P2)

---

## 물리 규칙 (모든 Task 공통)

**좌표·단위:** mm. 삼각형 법선은 부품 **바깥** 방향이다(P1 메쉬는 반시계 = 바깥).

**매질 스택**
- 광자가 들어가 있는 투과성 부품 번호를 스택으로 관리한다. 빈 스택은 공기(n=1)다.
- 현재 매질은 스택의 맨 위다.

**면 사건 (삼각형 tri, 부품 q, 면 f, 바깥 법선 N; 진입 = d·N < 0)**

1. **q 가 불투명**이면 q 의 면 처리 `reflectFinish` 로 반사하거나 흡수한다.
2. **q 가 투과성**일 때
   - **통과 규칙:** 진입인데 q 가 이미 스택에 있거나, 이탈인데 q 가 스택에 없으면 아무 일 없이 통과한다. 이는 겹친 접촉면이 두 번 잡히는 경우다.
   - **반사형 코팅:** 면 처리가 광택이 아니면(백색 확산·금속·흑색) 코팅으로 보고 `reflectFinish` 로 같은 쪽 반사 또는 흡수를 한다.
   - **광택 면에서 반대쪽 매질 결정**
     - 진입: 반대쪽은 q 다. 다만 (q, f) 가 접촉면이고 상대가 현재 매질이면, 접촉면을 반대 순서로 만난 경우다. 이때는 현재 매질을 pop 하고 q 로 들어간다.
     - 이탈: (q, f) 가 '접촉' 모드 접촉면이면 상대 부품이다. 상대가 불투명이면 그 부품 면의 처리로 반사한다. 접촉면이 아니면 q 를 뺀 스택의 맨 위(없으면 공기)다.
   - **공기막 진입:** 진입인데 현재 매질이 다른 투과성 부품이고 접촉 상대가 아니면, 공기막이 끼어 있는 경우다. `filmCross` 로 처리한다.
   - **공기막 이탈:** 이탈하는 면이 '공기층' 모드로 맞붙은 면(`film` 조회)이면, 상대 면이 같은 위치에 있다. 그 면은 출발점 이동(OFF) 때문에 다시 잡히지 않으므로 그 자리에서 `filmCross` 로 처리한다. 상대는 투과성이면 굴절률, 불투명이면 그 면 처리로 다룬다.
   - **Fresnel:** 반사율 R 로 확률 선택한다(가중치 불변). 투과하면 스택을 갱신한다. 이탈 후 스택이 비면 `onExit` 를 호출한다.
3. **불투명 q 인데 현재 매질과 '공기층' 모드로 맞붙은 면이면** 공기막을 거친다. `filmCross` 에서 상대는 q 의 면 처리다.

**`filmCross` (공기막 다중 반사):** 매질 A(현재) → 공기 → B 순서로 처리한다.
- A→공기 계면에서 반사되면 A 에 남는다.
- 투과하면 막 안에서 B 계면(B 의 Fresnel 또는 면 처리)과 A 계면을 번갈아 만나며, 어느 한쪽으로 투과하거나 흡수될 때까지 반복한다(최대 100회, 넘으면 흡수).
- 비간섭 다중 반사와 같으므로, 맞붙은 두 판의 투과율은 떨어진 두 판과 같아진다(V3D-6).

**체적:** 현재 매질의 μs > 0 이면 자유 경로를 샘플링하고 HG 또는 표(Mie) 위상함수로 산란한다. 흡수는 이동 거리만큼 가중치를 exp(−μa·t) 로 감쇠한다.

**탈출:** 교차가 없으면 공기 중에서 무한히 탈출한 것으로 보고 `onEscape` 를 호출한다. 매질 안에서 교차가 없으면 열린 메쉬이므로 `lost` 로 진단한다.

**수치(최종):** 사건 뒤에는 출발점을 이동하지 않고, 다음 교차에서 마지막에 맞은 삼각형(공존 전이면 두 삼각형)을 제외하며 tMin = 1e-9 이다(아래 실행 로그 참고 — 처음 계획의 OFF 방식은 모서리 누설·얇은 판 문제로 교체). 가중치 < `w0·1e-3` 이면 러시안 룰렛(생존 0.1, ×10)을 한다.

**원장 보존(V3D-2):** emitted + rrGain = escaped + absSurf + absVol + lost + rrLoss.

## 파일 구조

| 파일 | 책임 |
|---|---|
| Create `src/engine/mech3d/surface.js` | `fresnelInterface`(n1→n2 일반 계면), `lambert`, `reflectFinish` |
| Create `src/engine/mech3d/optics.js` | `partOptics(part, { table, db })` |
| Create `src/engine/mech3d/scene3d.js` | `buildTraceScene(rt, mspec, ctx)` |
| Create `src/engine/mech3d/sources.js` | `ledSource(opts)`, `combineSources(list)` |
| Create `src/engine/mech3d/mc3d.js` | `runMC3D(S, opts)` |
| Modify `src/engine/shape/mc-body.js:370` | (변경 없음 — `_ledModel` 이미 export, 재사용만) |
| Create `test/mech3d-surface.mjs`, `test/mech3d-optics.mjs`, `test/mech3d-scene.mjs`, `test/mech3d-mc.mjs`, `test/mech3d-v1.mjs` | 테스트 |
| Modify `package.json` | `test:mech3d` 에 빠른 테스트 추가, `test:mech3d-mc`(V3D-1, 느림) 신설 |
| Modify `src/main.js` | Milky 부품에서 DB 소재를 고르면 Milky 칸을 그 소재의 값으로 맞춤 |

---

### Task 1: 계면·면 처리 (`surface.js`)

**Files:**
- Create: `test/mech3d-surface.mjs`
- Create: `src/engine/mech3d/surface.js`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// 3D MC 계면·면 처리: node test/mech3d-surface.mjs
import { fresnelInterface, lambert, reflectFinish } from '../src/engine/mech3d/surface.js';
import { rng } from '../src/engine/l2/mc-slab.js';
import { ok, done } from './mech3d-util.mjs';

const n = 1.586, R0 = ((n - 1) / (n + 1)) ** 2, near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
{
  const f = fresnelInterface(0, 0, -1, 0, 0, 1, 1, n);   // 위에서 아래로 수직 입사, 법선 +z
  ok(near(f.R, R0) && near(f.tz, -1) && near(f.rz, 1), `수직 입사 R=${f.R.toFixed(5)} (해석 ${R0.toFixed(5)}), 투과 방향 유지`);
}
{
  const s = Math.sin(Math.PI / 6), c = Math.cos(Math.PI / 6);
  const f = fresnelInterface(s, 0, -c, 0, 0, 1, 1, n), sinT = Math.hypot(f.tx, f.ty);
  ok(near(sinT, s / n, 1e-12) && f.tz < 0 && near(Math.hypot(f.tx, f.ty, f.tz), 1, 1e-12), `스넬: sinθt=${sinT.toFixed(6)} (해석 ${(s / n).toFixed(6)})`);
  const g = fresnelInterface(-f.tx, -f.ty, -f.tz, 0, 0, 1, n, 1);   // 역방향(매질→공기) 같은 각
  ok(near(g.R, f.R, 1e-12), `역방향 반사율 동일: ${g.R.toFixed(6)} = ${f.R.toFixed(6)}`);
}
{
  const a = Math.PI / 4, f = fresnelInterface(Math.sin(a), 0, Math.cos(a), 0, 0, 1, n, 1);   // 매질 안 45° → 임계각(39°) 초과
  ok(f.R === 1 && near(f.rz, -Math.cos(a)), '전반사(45°, n 1.586→1): R=1, 정반사');
}
{
  const f = fresnelInterface(0.3, 0.1, -Math.sqrt(0.9), 0, 0, 1, n, n);
  ok(near(f.R, 0) && near(f.tx, 0.3) && near(f.tz, -Math.sqrt(0.9)), '같은 굴절률(광학 접촉): 반사 0, 직진');
}
{
  const r = rng(3); let sc = 0, bad = 0; const K = 200000;
  for (let i = 0; i < K; i++) { const [x, y, z] = lambert(0, 0, 1, r); sc += z; if (z < 0 || Math.abs(Math.hypot(x, y, z) - 1) > 1e-9) bad++; }
  ok(bad === 0 && Math.abs(sc / K - 2 / 3) < 0.003, `Lambert: 평균 cosθ ${(sc / K).toFixed(4)} (해석 0.6667), 반구 밖 ${bad}`);
}
{
  const r = rng(5), K = 200000; let alive = 0, side = 0;
  for (let i = 0; i < K; i++) { const d = reflectFinish({ kind: 'whiteDiffuse', R: 0.85 }, 0, 0, -1, 0, 0, 1, r); if (d) { alive++; if (d[2] <= 0) side++; } }
  ok(Math.abs(alive / K - 0.85) < 0.004 && side === 0, `백색 확산 R85: 반사 ${(alive / K).toFixed(4)}, 입사 쪽 반구로만`);
  const m = reflectFinish({ kind: 'metal', R: 1 }, 0.6, 0, -0.8, 0, 0, 1, r);
  ok(m && near(m[0], 0.6) && near(m[2], 0.8), '금속 R100: 정반사');
  let bl = 0; for (let i = 0; i < K; i++) if (reflectFinish({ kind: 'black', R: 0.05 }, 0, 0, -1, 0, 0, 1, r)) bl++;
  const Fb = ((1.5 - 1) / 2.5) ** 2, expB = Fb + (1 - Fb) * 0.05;
  ok(Math.abs(bl / K - expB) < 0.003, `흑색 R5: 반사 ${(bl / K).toFixed(4)} (기대 ${expB.toFixed(4)} = 광택 Fresnel + 확산)`);
  const back = reflectFinish({ kind: 'whiteDiffuse', R: 1 }, 0, 0, 1, 0, 0, 1, r);   // 법선과 같은 쪽으로 오는 빛(안쪽에서 코팅에 닿음)
  ok(back && back[2] < 0, '안쪽에서 닿으면 안쪽 반구로 반사');
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-surface.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/surface.js`)

```js
// 3D MC 면 상호작용 — spec 2026-10-14 §3.3·§6.1. 방향 d·법선 N 은 단위벡터(N 의 부호는 무관 — 입사 쪽을 내부에서 판정).
import { fresnelR } from '../photometry.js';

// 일반 계면 n1 → n2(비편광 Fresnel). 반환 { R, 반사 방향 r*, 굴절 방향 t* } — 전반사면 R = 1(t* 무의미).
export function fresnelInterface(dx, dy, dz, Nx, Ny, Nz, n1, n2) {
  let dn = dx * Nx + dy * Ny + dz * Nz, ix = Nx, iy = Ny, iz = Nz;
  if (dn > 0) { ix = -Nx; iy = -Ny; iz = -Nz; dn = -dn; }   // Ni: 입사 쪽 법선(d·Ni < 0)
  const cosI = Math.min(1, -dn), eta = n1 / n2;
  const rx = dx - 2 * dn * ix, ry = dy - 2 * dn * iy, rz = dz - 2 * dn * iz;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k <= 0) return { R: 1, rx, ry, rz, tx: 0, ty: 0, tz: 0 };
  const cosT = Math.sqrt(k);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT), rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  const m = eta * cosI - cosT;
  return { R: 0.5 * (rs * rs + rp * rp), rx, ry, rz, tx: eta * dx + m * ix, ty: eta * dy + m * iy, tz: eta * dz + m * iz };
}

// 법선 M 쪽 반구의 코사인 가중 방향
export function lambert(Mx, My, Mz, rnd) {
  const u1 = rnd(), u2 = rnd(), r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
  const a = r * Math.cos(ph), b = r * Math.sin(ph), c = Math.sqrt(Math.max(0, 1 - u1));
  let tx, ty, tz;
  if (Math.abs(Mz) < 0.9) { tx = -My; ty = Mx; tz = 0; } else { tx = 0; ty = -Mz; tz = My; }
  const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  const bx = My * tz - Mz * ty, by = Mz * tx - Mx * tz, bz = Mx * ty - My * tx;
  return [a * tx + b * bx + c * Mx, a * ty + b * by + c * My, a * tz + b * bz + c * Mz];
}

// 반사형 면 처리 — 입사 쪽 반구로 되돌리거나 흡수(null). fin = { kind, R }
//   whiteDiffuse: R 확률 Lambert / metal: R 확률 정반사 / black: 광택 Fresnel(n 1.5) 정반사 + 나머지의 R 확률 Lambert
//   gloss(불투명 부품): 흑색 광택 수지로 간주 — Fresnel(n 1.5) 정반사만
export function reflectFinish(fin, dx, dy, dz, Nx, Ny, Nz, rnd) {
  const dn = dx * Nx + dy * Ny + dz * Nz;
  const Mx = dn > 0 ? -Nx : Nx, My = dn > 0 ? -Ny : Ny, Mz = dn > 0 ? -Nz : Nz;   // 입사 쪽 법선
  const spec = () => [dx - 2 * dn * Nx, dy - 2 * dn * Ny, dz - 2 * dn * Nz];
  switch (fin.kind) {
    case 'whiteDiffuse': return rnd() < fin.R ? lambert(Mx, My, Mz, rnd) : null;
    case 'metal': return rnd() < fin.R ? spec() : null;
    case 'black': {
      const F = fresnelR(Math.min(1, Math.abs(dn)), 1.5), u = rnd();
      if (u < F) return spec();
      return u < F + (1 - F) * fin.R ? lambert(Mx, My, Mz, rnd) : null;
    }
    case 'gloss': return rnd() < fresnelR(Math.min(1, Math.abs(dn)), 1.5) ? spec() : null;
    default: throw new Error(`알 수 없는 면 처리: ${fin.kind}`);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-surface.mjs`
Expected: 10개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/surface.js test/mech3d-surface.mjs
git commit -m "feat(mech3d): general Fresnel interface, Lambert and reflective finishes"
```

---

### Task 2: 부품 광학 물성 (`optics.js`)

**Files:**
- Create: `test/mech3d-optics.mjs`
- Create: `src/engine/mech3d/optics.js`

규칙:

| 소재 | 물성 |
|---|---|
| 불투명 | `{ transmissive: false }` |
| 투명 | 총투과율 T @ tRef 에서 μa = −ln(min(1, T/(1−R0)²))/tRef (R0 = 수직 Fresnel). T=1 이면 μa=0. 산란 없음 |
| Milky | μs' = `musRFromMilky(table, milky)` (Milky 레벨 = 농도). DB 소재가 없으면 g = 0.9, μa = `l2Material` 과 같은 식, HG. DB 소재가 있으면 그 소재의 g, μa = fitted.mua × (μs'/fitted.musR), model 'mie' 이면 Mie 위상함수(`particleOptics(...).phase`) |
| 반투과 백색 | g 0.9, μa = MUA_RESIN. 기준 두께 tRef 에서 표의 **수직 입사** 총투과율(Tb+Ts) 이 T 가 되는 μs' 를 로그 이분탐색으로 찾음 |

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// 3D 기구 부품 광학 물성: node test/mech3d-optics.mjs
import fs from 'node:fs';
import { partOptics, normalRow } from '../src/engine/mech3d/optics.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { l2Material } from '../src/engine/l2/material.js';
import { milkyFromMusR } from '../src/engine/l2/milky.js';
import { createDb } from '../src/model/materials-db.js';
import { loadTable } from './l2-util.mjs';
import { ok, done } from './mech3d-util.mjs';

const table = loadTable();
const db = createDb(JSON.parse(fs.readFileSync(new URL('../data/materials-db.json', import.meta.url))).entries ?? []);
const ctx = { table, db };
const P = (kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(0, 'p', 1), kind));
const rel = (a, b) => Math.abs(a / b - 1);

ok(partOptics(defaultPart(0, 'p', 1), ctx).transmissive === false, '불투명 → 비투과');
{
  const o = partOptics(P('clear'), ctx);
  ok(o.transmissive && o.n === 1.586 && o.mus === 0 && o.mua === 0, `투명(T=1): n ${o.n}, μs ${o.mus}, μa ${o.mua}`);
  const R0 = (0.586 / 2.586) ** 2, o2 = partOptics(P('clear', { T: 0.8, tRef: 2 }), ctx), want = -Math.log(0.8 / (1 - R0) ** 2) / 2;
  ok(rel(o2.mua, want) < 1e-12, `투명 착색 T80%@2mm: μa ${o2.mua.toFixed(5)} (해석 ${want.toFixed(5)})`);
}
{
  const o = partOptics(P('milky', { milky: 3 }), ctx), m = l2Material(table, 3, 1.586);
  ok(rel(o.mus, m.musR / (1 - m.g)) < 1e-12 && o.g === 0.9 && rel(o.mua, m.mua) < 1e-12 && o.phase === null, `추상 Milky 3: μs ${o.mus.toFixed(4)} = L2, g 0.9, HG`);
}
{
  const ent = db.get('covestro-dq5142'), milky = milkyFromMusR(table, ent.fitted.musR);
  const o = partOptics(P('milky', { dbId: ent.id, milky }), ctx);
  ok(rel(o.mus * (1 - o.g), ent.fitted.musR) < 1e-6 && o.g === ent.fitted.g && rel(o.mua, ent.fitted.mua) < 1e-6 && o.n === ent.n,
    `DB DQ5142(Milky ${milky.toFixed(2)}): μs' ${(o.mus * (1 - o.g)).toFixed(4)} = 피팅값, n ${o.n}`);
  ok(o.phase && Math.abs(o.phase.g - ent.fitted.g) < 0.01, `DB Mie 위상함수: g ${o.phase?.g.toFixed(4)} ≈ 피팅 g ${ent.fitted.g.toFixed(4)}`);
  const half = partOptics(P('milky', { dbId: ent.id, milky: milky / 2 }), ctx);
  ok(half.mus < o.mus && half.g === o.g && rel(half.mua / half.mus, o.mua / o.mus) < 1e-6, 'Milky 를 낮추면 μs·μa 가 같은 비율로 줄고 g 는 그대로(농도)');
}
{
  const o = partOptics(P('whiteTrans', { T: 0.1, tRef: 1.5 }), ctx);
  const q = table.query(o.mus * (1 - o.g) * 1.5, o.g, o.n, normalRow(table), 0);
  ok(Math.abs(q.Tb + q.Ts - 0.1) < 1e-3 && o.g === 0.9, `반투과 백색 T10%@1.5mm: 표 재계산 T ${(q.Tb + q.Ts).toFixed(4)}`);
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-optics.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/optics.js`)

```js
// 3D 기구 부품 소재 → 광학 물성 — spec 2026-10-14 §3.2, §6.1·§6.2(Milky 레벨 = 입자 농도: μs·μa 비례, 위상함수 고정).
// 반환: 불투명 { transmissive:false } / 투과성 { transmissive:true, n, mus, g, mua, phase(null = HG(g)) }
import { l2Material, L2_G, MUA_RESIN } from '../l2/material.js';
import { musRFromMilky } from '../l2/milky.js';
import { particleOptics } from '../l2/mie.js';
import { RESIN_N } from './materials.js';

// 표의 수직 입사 행(μ = cosθ 가 1 에 가장 가까운 각도 행)
export function normalRow(table) {
  const R = table.grids.rows; let best = 0;
  for (let k = 0; k < table.angleRows; k++) if (Math.abs(R[k] - 1) < Math.abs(R[best] - 1)) best = k;
  return best;
}

const phaseCache = new Map();
function miePhaseOf(ent) {
  if (!phaseCache.has(ent.id)) {
    const p = ent.particle;
    phaseCache.set(ent.id, particleOptics({ d_um: p.d_um, nP: p.nP, nH: ent.n, lambda_um: p.lambda_um ?? 0.55 }).phase);
  }
  return phaseCache.get(ent.id);
}

function whiteTransMusR(table, T, tRef, n) {
  const row = normalRow(table), Tof = (musR) => { const q = table.query(musR * tRef, L2_G, n, row, 0); return q.Tb + q.Ts; };
  if (Tof(0) <= T) return 0;
  let lo = Math.log(1e-6), hi = Math.log(1e4);
  for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (Tof(Math.exp(mid)) > T) lo = mid; else hi = mid; }
  return Math.exp(0.5 * (lo + hi));
}

export function partOptics(part, { table, db = null }) {
  const m = part.material;
  if (m.kind === 'opaque') return { transmissive: false };
  const n0 = RESIN_N[m.resin] ?? RESIN_N.PC;
  if (m.kind === 'clear') {
    const R0 = ((n0 - 1) / (n0 + 1)) ** 2;
    return { transmissive: true, n: n0, mus: 0, g: 0, mua: Math.max(0, -Math.log(Math.min(1, m.T / (1 - R0) ** 2)) / m.tRef), phase: null };
  }
  if (m.kind === 'whiteTrans') {
    const musR = whiteTransMusR(table, m.T, m.tRef, n0);
    return { transmissive: true, n: n0, mus: musR / (1 - L2_G), g: L2_G, mua: MUA_RESIN, phase: null };
  }
  // milky
  const ent = m.dbId ? db?.get(m.dbId) : null;
  if (!ent) {
    const a = l2Material(table, m.milky, n0);
    return { transmissive: true, n: n0, mus: a.musR / (1 - a.g), g: a.g, mua: a.mua, phase: null };
  }
  const musR = musRFromMilky(table, m.milky), f = ent.fitted;
  const mua = f.musR > 0 ? f.mua * (musR / f.musR) : MUA_RESIN;
  return { transmissive: true, n: ent.n, mus: musR / (1 - f.g), g: f.g, mua, phase: ent.model === 'mie' && ent.particle ? miePhaseOf(ent) : null };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-optics.mjs`
Expected: 8개 PASS, `all PASS`. DB 항목 필드(`fitted`, `particle.d_um`, `particle.nP`, `model`)가 다르면 `data/materials-db.json` 의 실제 키에 맞추고 변경을 보고한다.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/optics.js test/mech3d-optics.mjs
git commit -m "feat(mech3d): part optical properties (clear, milky abstract/DB-Mie, white translucent)"
```

---

### Task 3: 추적용 장면 (`scene3d.js`)

**Files:**
- Create: `test/mech3d-scene.mjs`
- Create: `src/engine/mech3d/scene3d.js`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// 추적용 장면 구성: node test/mech3d-scene.mjs
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable();
setMech3dMesh('s', [boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, 2)]);
const parts = [setPartMaterial(defaultPart(0, 'a', 200), 'clear'), setPartFinish(defaultPart(1, 'b', 200), 3, { kind: 'black', R: 0.05 })];
const S = buildTraceScene(getMech3d(), { name: 's', parts, contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'contact' }] }, { table });
ok(S.normals.length === 72 && Math.abs(S.normals[2] + 1) < 1e-6 && Math.abs(S.normals[3 * 2 + 2] - 1) < 1e-6, '삼각형 바깥 법선(−z 바닥, +z 윗면)');
ok(S.optics[0].transmissive && !S.optics[1].transmissive, '부품별 광학 물성');
const t1 = 12 + 2 * 3;   // 부품 1 의 면 3 첫 삼각형(결합 메쉬 번호)
ok(S.fins[S.finOf[t1]].kind === 'black' && S.fins[S.finOf[12]].kind === 'whiteDiffuse', '삼각형별 면 처리(덮어쓰기 반영)');
ok(S.contact.get('0|1')?.part === 1 && S.contact.get('1|0')?.part === 0 && S.contact.get('1|0')?.face === 1, '접촉면 양방향 조회');
const S2 = buildTraceScene(getMech3d(), { name: 's', parts, contacts: [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'air' }] }, { table });
ok(S2.contact.size === 0 && S2.film.get('0|1')?.part === 1 && S2.film.get('1|0')?.part === 0, "'공기층' 모드 = 공기막 조회(film), 광학 접촉 조회에서 제외");
let threw = false; try { buildTraceScene(getMech3d(), { name: 's', parts: [parts[0]], contacts: [] }, { table }); } catch { threw = true; }
ok(threw, '부품 수 불일치 → 오류');
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-scene.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 구현** (`src/engine/mech3d/scene3d.js`)

```js
// 추적용 장면 — spec 2026-10-14 §6.1. 런타임 메쉬(rt = runtime.getMech3d())와 사용자 지정(mspec = spec.mech3d)을 합친다.
import { partOptics } from './optics.js';
import { resolveFinish } from './materials.js';

export function buildTraceScene(rt, mspec, ctx) {
  if (!rt || mspec.parts.length !== rt.parts.length) throw new Error('3D 기구: 부품 지정과 메쉬의 부품 수가 다름');
  const { positions: P, triangles: T, partOf, faceOf } = rt.combined;
  const nT = T.length / 3, normals = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
  }
  const optics = mspec.parts.map((p) => partOptics(p, ctx));
  const fins = [], key = new Map(), finOf = new Uint16Array(nT);
  for (let t = 0; t < nT; t++) {
    const f = resolveFinish(mspec.parts[partOf[t]], faceOf[t]), k = `${f.kind}|${f.R ?? ''}`;
    if (!key.has(k)) { key.set(k, fins.length); fins.push(f); }
    finOf[t] = key.get(k);
  }
  // 맞붙은 면(P1 감지): '접촉' = 광학 접촉(contact), '공기층' = 얇은 공기막(film). 양방향 조회.
  const contact = new Map(), film = new Map();
  for (const c of mspec.contacts ?? []) {
    const m = c.mode === 'contact' ? contact : film;
    m.set(`${c.a}|${c.faceA}`, { part: c.b, face: c.faceB });
    m.set(`${c.b}|${c.faceB}`, { part: c.a, face: c.faceA });
  }
  const finishOfFace = (part, face) => resolveFinish(mspec.parts[part], face);
  return { P, T, partOf, faceOf, normals, bvh: rt.bvh, optics, fins, finOf, contact, film, finishOfFace };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node test/mech3d-scene.mjs`
Expected: 6개 PASS, `all PASS`

- [ ] **Step 5: Commit**

```bash
git add src/engine/mech3d/scene3d.js test/mech3d-scene.mjs
git commit -m "feat(mech3d): trace scene (normals, optics, per-triangle finishes, contact map)"
```

---

### Task 4: 광원 + 추적 루프 (`sources.js`, `mc3d.js`) — V3D-2, V3D-6

**Files:**
- Create: `src/engine/mech3d/sources.js`
- Create: `src/engine/mech3d/mc3d.js`
- Create: `test/mech3d-mc.mjs`

해석해(V3D-6): 수직 입사 평행광이 무흡수 투명 판 N 장(사이 공기층)을 지날 때, 다중 반사(비간섭)를 포함한 투과율은 T = (1−R)/(1+(2N−1)R) 이다(R = 수직 Fresnel).
- 광학 접촉된 두 판 = 판 1장: (1−R)/(1+R)
- 공기층: (1−R)/(1+3R)

- [ ] **Step 1: 실패하는 테스트 작성** (`test/mech3d-mc.mjs`)

```js
// 3D MC 추적기 — 에너지 보존(V3D-2)·접촉면 해석해(V3D-6)·전반사 도광: node test/mech3d-mc.mjs
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { ledSource, combineSources } from '../src/engine/mech3d/sources.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartMaterialParam, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable(), n = 1.586, R = ((n - 1) / (n + 1)) ** 2;
const part = (i, kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(i, `p${i}`, 1), kind));
const scene = (meshes, parts, contacts = []) => { setMech3dMesh('t', meshes); return buildTraceScene(getMech3d(), { name: 't', parts, contacts }, { table }); };
const beam = { flux: 1, sample: (r) => [4.5 + r(), 4.5 + r(), -1, 0, 0, 1] };   // 1×1mm 수직 평행광(z=−1 → +z)
const balance = (L) => Math.abs(L.emitted + L.rrGain - (L.escaped + L.absSurf + L.absVol + L.lost + L.rrLoss)) / L.emitted;
const transmit = (S, N = 200000) => { let up = 0; const res = runMC3D(S, { source: beam, N, seed: 11, onEscape: (x, y, z, dx, dy, dz, w) => { if (dz > 0) up += w; } }); return { T: up / res.ledger.emitted, L: res.ledger }; };

{   // V3D-6: 판 2장 광학 접촉 = 판 1장, 공기층(맞붙음·0.5mm 떨어짐) = 판 2장
  const T1 = (1 - R) / (1 + R), T2 = (1 - R) / (1 + 3 * R);
  const a = boxMesh(0, 0, 0, 10, 10, 2), b = boxMesh(0, 0, 2, 10, 10, 2), bFar = boxMesh(0, 0, 2.5, 10, 10, 2);
  const c = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'contact' }]));
  ok(Math.abs(c.T - T1) < 0.004, `V3D-6 광학 접촉: T ${c.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  const g = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'air' }]));
  ok(Math.abs(g.T - T2) < 0.004, `V3D-6 맞붙은 공기층: T ${g.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const s = transmit(scene([a, bFar], [part(0, 'clear'), part(1, 'clear')]));
  ok(Math.abs(s.T - T2) < 0.004, `V3D-6 0.5mm 공기층: T ${s.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const one = transmit(scene([a], [part(0, 'clear')]));
  ok(Math.abs(one.T - T1) < 0.004, `판 1장: T ${one.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  ok([c, g, s, one].every((x) => x.L.lost === 0 && balance(x.L) < 1e-9), 'V3D-2(투명): 원장 보존, lost 0');
}
{   // 전반사 도광: 100×4×4 투명 바 끝면(x=0)에 30° 입사 → 옆면 누설 없음
  const S = scene([boxMesh(0, 0, 0, 100, 4, 4)], [part(0, 'clear')]);
  const a = Math.PI / 6, src = { flux: 1, sample: (r) => [-1, 1.5 + r(), 1.5 + r() - Math.tan(a), Math.cos(a), 0, Math.sin(a)] };
  let side = 0, end = 0;
  const res = runMC3D(S, { source: src, N: 50000, seed: 3, onExit: (q, f, x, y, z, dx, dy, dz, w) => { if (f === 5) end += w; else if (f !== 4) side += w; } });
  ok(side === 0 && end > 0.85 && balance(res.ledger) < 1e-9, `TIR 도광: 옆면 ${side}, 끝면 ${end.toFixed(3)}`);
}
{   // V3D-2(산란·흡수·반사): Milky 판 + 백색 PCB + 흑색 벽 + LED 2개
  // 부품끼리 면이 겹치지 않게 배치(겹친 면은 P1 접촉면 감지 + contacts 지정이 있어야 의미가 정해짐)
  const plate = boxMesh(-20, -20, 10, 40, 40, 2), pcb = boxMesh(-30, -30, -1, 60, 60, 1), wall = boxMesh(25, -30, 0.5, 2, 60, 12);
  const S = scene([plate, pcb, wall], [part(0, 'milky', { milky: 5 }), setPartFinish(defaultPart(1, 'pcb', 1), null, { kind: 'whiteDiffuse', R: 0.8 }), setPartFinish(defaultPart(2, 'wall', 1), null, { kind: 'black', R: 0.05 })]);
  const src = combineSources([ledSource({ x: -5, y: 0, z: 0 }), ledSource({ x: 5, y: 0, z: 0 })]);
  const res = runMC3D(S, { source: src, N: 40000, seed: 9 });
  const L = res.ledger;
  ok(balance(L) < 1e-9 && L.lost === 0 && L.absVol > 0 && L.absSurf > 0 && L.escaped > 0, `V3D-2: 오차 ${balance(L).toExponential(1)}, 탈출 ${(L.escaped / L.emitted).toFixed(3)}, 체적흡수 ${(L.absVol / L.emitted).toFixed(3)}, 면흡수 ${(L.absSurf / L.emitted).toFixed(3)}`);
  ok(Math.abs(src.flux - 2 * Math.PI) < 1e-9, `광원 광속 = LED 2개 × Lambert π: ${src.flux.toFixed(4)}`);
}
done();
```

- [ ] **Step 2: 실패 확인**

Run: `node test/mech3d-mc.mjs`
Expected: `ERR_MODULE_NOT_FOUND`

- [ ] **Step 3: 광원 구현** (`src/engine/mech3d/sources.js`)

```js
// 3D MC 광원 — spec 2026-10-14 §4.3. 반환 { flux, sample(rnd) → [x,y,z, dx,dy,dz] } (공기 중에서 출발).
import { _ledModel } from '../shape/mc-body.js';

// LED: 발광면 중심 (x,y,z), 배광 축 axis(발광면 법선), 패키지 가로축 xAxis(없으면 임의 직교). 배광 모델·각은 L1 과 같은 정의(I0 단위).
export function ledSource({ x, y, z, axis = [0, 0, 1], xAxis = null, model = 'lambertian', beam = 120, sizeX = 0, sizeY = 0, I0 = 1 }) {
  const lm = _ledModel({ model, beamX: beam });
  const al = Math.hypot(...axis), a = axis.map((v) => v / al);
  let u = xAxis ?? (Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  const ud = u[0] * a[0] + u[1] * a[1] + u[2] * a[2];
  u = [u[0] - ud * a[0], u[1] - ud * a[1], u[2] - ud * a[2]];
  const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  return {
    flux: I0 * lm.solid,
    sample(rnd) {
      const ct = lm.cosTheta(rnd()), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = 2 * Math.PI * rnd();
      const lx = st * Math.cos(ph), ly = st * Math.sin(ph);
      const ox = sizeX ? (rnd() - 0.5) * sizeX : 0, oy = sizeY ? (rnd() - 0.5) * sizeY : 0;
      return [
        x + ox * u[0] + oy * v[0] + 1e-5 * a[0], y + ox * u[1] + oy * v[1] + 1e-5 * a[1], z + ox * u[2] + oy * v[2] + 1e-5 * a[2],
        lx * u[0] + ly * v[0] + ct * a[0], lx * u[1] + ly * v[1] + ct * a[1], lx * u[2] + ly * v[2] + ct * a[2],
      ];
    },
  };
}

// 여러 광원 — 광속 비례로 선택
export function combineSources(list) {
  const flux = list.reduce((s, x) => s + x.flux, 0), cum = [];
  let c = 0; for (const x of list) { c += x.flux / flux; cum.push(c); }
  return {
    flux,
    sample(rnd) { const u = rnd(); let i = 0; while (i < cum.length - 1 && u > cum[i]) i++; return list[i].sample(rnd); },
  };
}
```

- [ ] **Step 4: 추적 루프 구현** (`src/engine/mech3d/mc3d.js`)

```js
// 3D MC 추적기 — spec 2026-10-14 §6.1. 부품 메쉬 장면(scene3d.buildTraceScene)을 확률 선택(가중 불변) 방식으로 추적.
// 매질 스택: 광자가 들어가 있는 투과성 부품(맨 위 = 현재 매질, 빈 스택 = 공기). 규칙은 P2 계획 "물리 규칙" 절 참고.
// onExit(part, face, x,y,z, dx,dy,dz, w): 투과성 부품에서 공기로 나갈 때. onEscape(x,y,z, dx,dy,dz, w): 공기 중 무한 탈출.
import { intersectRay } from './bvh.js';
import { fresnelInterface, reflectFinish } from './surface.js';
import { rng } from '../l2/mc-slab.js';

const OFF = 1e-5, T_MIN = 1e-7;

function sampleHG(g, u) {
  if (Math.abs(g) < 1e-6) return 2 * u - 1;
  const f = (1 - g * g) / (1 - g + 2 * g * u);
  return (1 + g * g - f * f) / (2 * g);
}

// 공기막(맞붙은 '공기층' 면): 매질 A(nA) 쪽에서 막에 닿음. B = { n }(투과성) | { fin }(불투명 면 처리).
// 막 안 다중 반사를 끝까지 풀어 { dir, into: 'A'|'B' } 또는 null(흡수) 반환.
function filmCross(dx, dy, dz, Nx, Ny, Nz, nA, B, rnd) {
  const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nA, 1);
  if (f.R >= 1 || rnd() < f.R) return { dir: [f.rx, f.ry, f.rz], into: 'A' };
  let d = [f.tx, f.ty, f.tz];
  for (let k = 0; k < 100; k++) {
    if (B.fin) { const r = reflectFinish(B.fin, d[0], d[1], d[2], Nx, Ny, Nz, rnd); if (!r) return null; d = r; }
    else {
      const g = fresnelInterface(d[0], d[1], d[2], Nx, Ny, Nz, 1, B.n);
      if (!(g.R >= 1 || rnd() < g.R)) return { dir: [g.tx, g.ty, g.tz], into: 'B' };
      d = [g.rx, g.ry, g.rz];
    }
    const h = fresnelInterface(d[0], d[1], d[2], Nx, Ny, Nz, 1, nA);
    if (!(h.R >= 1 || rnd() < h.R)) return { dir: [h.tx, h.ty, h.tz], into: 'A' };
    d = [h.rx, h.ry, h.rz];
  }
  return null;   // 막 안 무한 반사(수치) — 흡수로 처리
}

export function runMC3D(S, { source, N, seed = 1, onExit = null, onEscape = null, wMinRel = 1e-3, maxEvents = 100000 }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rnd = rng(seed), w0 = source.flux / N, wMin = w0 * wMinRel;
  const L = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  const { optics, normals: NM, partOf, faceOf, fins, finOf, contact, film } = S;
  const nOf = (q) => (q < 0 ? 1 : optics[q].n);
  const stack = [];
  for (let p = 0; p < N; p++) {
    L.emitted += w0;
    let [px, py, pz, dx, dy, dz] = source.sample(rnd), w = w0;
    stack.length = 0;
    for (let e = 0; ; e++) {
      if (e > maxEvents) { L.lost += w; break; }
      const cur = stack.length ? stack[stack.length - 1] : -1, med = cur >= 0 ? optics[cur] : null;
      const sFree = med && med.mus > 0 ? -Math.log(1 - rnd()) / med.mus : Infinity;
      const h = intersectRay(S.bvh, px, py, pz, dx, dy, dz, T_MIN, sFree);
      if (!h && !Number.isFinite(sFree)) {
        if (cur >= 0) { L.lost += w; break; }   // 매질 안에서 교차 없음 = 열린 메쉬(진단)
        L.escaped += w; if (onEscape) onEscape(px, py, pz, dx, dy, dz, w); break;
      }
      const t = h ? h.t : sFree;
      px += t * dx; py += t * dy; pz += t * dz;
      if (med && med.mua > 0) { const a = w * (1 - Math.exp(-med.mua * t)); L.absVol += a; w -= a; }
      if (!h) {   // 체적 산란
        const cth = med.phase ? med.phase.sample(rnd()) : sampleHG(med.g, rnd()), sth = Math.sqrt(Math.max(0, 1 - cth * cth));
        const phi = 2 * Math.PI * rnd(), cp = Math.cos(phi), sp = Math.sin(phi);
        if (Math.abs(dz) > 0.99999) { dx = sth * cp; dy = sth * sp; dz = Math.sign(dz) * cth; }
        else {
          const tmp = Math.sqrt(1 - dz * dz);
          const nx2 = sth * (dx * dz * cp - dy * sp) / tmp + dx * cth, ny2 = sth * (dy * dz * cp + dx * sp) / tmp + dy * cth, nz2 = -sth * cp * tmp + dz * cth;
          dx = nx2; dy = ny2; dz = nz2;
        }
      } else {
        const tri = h.tri, q = partOf[tri], face = faceOf[tri];
        const Nx = NM[tri * 3], Ny = NM[tri * 3 + 1], Nz = NM[tri * 3 + 2];
        const entering = dx * Nx + dy * Ny + dz * Nz < 0;
        let dir = null, absorbed = false;
        const reflectBy = (fin) => { const r = reflectFinish(fin, dx, dy, dz, Nx, Ny, Nz, rnd); if (r) dir = r; else absorbed = true; };
        // 공기막 결과 반영: into B 면 cur 를 빼고 b 로 들어감(b < 0 = 불투명이라 진입 없음)
        const viaFilm = (B, b) => {
          const r = filmCross(dx, dy, dz, Nx, Ny, Nz, nOf(cur), B, rnd);
          if (!r) { absorbed = true; return; }
          dir = r.dir;
          if (r.into === 'B' && b >= 0) { stack.splice(stack.lastIndexOf(cur), 1); stack.push(b); }
        };
        const fm = film.get(`${q}|${face}`);
        if (!optics[q].transmissive) {
          if (cur >= 0 && fm && fm.part === cur) viaFilm({ fin: fins[finOf[tri]] }, -1);   // 불투명 면과 공기막을 두고 맞붙음
          else reflectBy(fins[finOf[tri]]);
        }
        else if (entering ? stack.includes(q) : !stack.includes(q)) { /* 겹친 접촉면 — 통과 */ }
        else if (fins[finOf[tri]].kind !== 'gloss') reflectBy(fins[finOf[tri]]);   // 반사형 코팅(양면)
        else {
          const ct = contact.get(`${q}|${face}`);
          if (entering) {
            if (ct && ct.part === cur) {   // 접촉면을 상대 쪽 삼각형으로 먼저 만남: cur → q 직접 굴절
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nOf(cur), nOf(q));
              if (f.R >= 1 || rnd() < f.R) dir = [f.rx, f.ry, f.rz];
              else { dir = [f.tx, f.ty, f.tz]; stack.pop(); stack.push(q); }
            } else if (cur >= 0) viaFilm({ n: nOf(q) }, q);   // 다른 투과 부품 안에서 q 진입 = 맞붙은 공기막
            else {
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, 1, nOf(q));
              if (rnd() < f.R) dir = [f.rx, f.ry, f.rz]; else { dir = [f.tx, f.ty, f.tz]; stack.push(q); }
            }
          } else if (!ct && fm) {   // 공기막을 두고 맞붙은 상대 면이 같은 자리에 있음 — 여기서 함께 처리
            viaFilm(optics[fm.part].transmissive ? { n: nOf(fm.part) } : { fin: S.finishOfFace(fm.part, fm.face) }, optics[fm.part].transmissive ? fm.part : -1);
          } else {
            let other;
            if (ct) other = ct.part;
            else { other = -1; for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== q) { other = stack[i]; break; } }
            if (other >= 0 && !optics[other].transmissive) reflectBy(S.finishOfFace(other, ct.face));   // 불투명 부품과 맞닿은 면
            else {
              const f = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nOf(cur), nOf(other));
              if (f.R >= 1 || rnd() < f.R) dir = [f.rx, f.ry, f.rz];
              else {
                dir = [f.tx, f.ty, f.tz];
                stack.splice(stack.lastIndexOf(q), 1);
                if (other >= 0 && stack[stack.length - 1] !== other) stack.push(other);
                if (!stack.length && onExit) onExit(q, face, px, py, pz, f.tx, f.ty, f.tz, w);
              }
            }
          }
        }
        if (absorbed) { L.absSurf += w; break; }
        if (dir) {
          const l = Math.hypot(dir[0], dir[1], dir[2]);
          dx = dir[0] / l; dy = dir[1] / l; dz = dir[2] / l;
        }
      }
      px += OFF * dx; py += OFF * dy; pz += OFF * dz;
      if (w < wMin) {
        if (rnd() < 0.1) { L.rrGain += 9 * w; w *= 10; } else { L.rrLoss += w; break; }
      }
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { ledger: L, ms: t1 - t0 };
}
```

- [ ] **Step 5: 통과 확인**

Run: `node test/mech3d-mc.mjs`
Expected: 8개 PASS, `all PASS`

V3D-6 가 실패하면 기대값을 바꾸지 말고 superpowers:systematic-debugging 으로 원인을 찾는다. 먼저 의심할 곳은 스택 갱신과 공기막 2계면이다.

TIR 테스트에서 끝면이 0.85 미만이면 실패 원인을 보고한다. 해석 기대값은 입사면 투과(≈0.95) × 출사면 투과(≈0.95, 다중 반사 포함)이다.

- [ ] **Step 6: Commit**

```bash
git add src/engine/mech3d/sources.js src/engine/mech3d/mc3d.js test/mech3d-mc.mjs
git commit -m "feat(mech3d): 3D MC tracer with medium stack, contacts and finishes (V3D-2, V3D-6)"
```

---

### Task 5: S1 추적기와 교차 검증 (V3D-1)

**Files:**
- Create: `test/mech3d-v1.mjs`

같은 Milky 평판(120×120×2mm, 윗면 z=12), 백색 PCB(ρ 0.8, z=0), 중앙 Lambert LED 1개를 두 추적기로 계산해 비교한다.
- **3D 장면:** 판 + PCB(400×400 불투명 상자, 윗면 z=0)
- **S1 장면:** `makeScene` 높이맵 평판, 무한 PCB 평면, 벽 없음

비교 항목은 판 윗면 출사의 반경 분포(0~30mm, 5mm 고리 6개)와 윗면 총 출사다. 판정은 각 고리 차이 ≤ max(3%, 3σ), 총 출사 차이 ≤ 1% 이다. σ 는 두 결과의 배치(10개) 표준오차를 합친 값이다.

- [ ] **Step 1: 테스트 작성** (`test/mech3d-v1.mjs`)

```js
// V3D-1: 3D MC vs S1(높이맵 MC, VS7M 검증됨) — Milky 평판 교차 검증: node test/mech3d-v1.mjs  (N=…, MILKY=… 로 조정)
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { makeScene, runBodyMC } from '../src/engine/shape/mc-body.js';
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { ledSource } from '../src/engine/mech3d/sources.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartMaterialParam, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable(), W = 120, t = 2, depth = 12, rhoB = 0.8;
const milky = +(process.env.MILKY ?? 3), N = +(process.env.N ?? 600000), B = 10, RING = 5, NR = 6;
setMech3dMesh('v1', [boxMesh(-W / 2, -W / 2, depth - t, W, W, t), boxMesh(-200, -200, -1, 400, 400, 1)]);
const parts = [setPartMaterialParam(setPartMaterial(defaultPart(0, '판', 1), 'milky'), 'milky', milky), setPartFinish(defaultPart(1, 'PCB', 1), null, { kind: 'whiteDiffuse', R: rhoB })];
const S3 = buildTraceScene(getMech3d(), { name: 'v1', parts, contacts: [] }, { table });
const o = S3.optics[0];

const rings = () => Array.from({ length: B }, () => new Float64Array(NR + 1));   // 배치별 [고리 0..NR-1, 윗면 총]
const add = (acc, b, x, y, w) => { const r = Math.hypot(x, y), k = Math.floor(r / RING); if (k < NR) acc[b][k] += w; acc[b][NR] += w; };

const a3 = rings(), a1 = rings(), per = Math.floor(N / B);
let ms3 = 0, ms1 = 0;
for (let b = 0; b < B; b++) {
  const r3 = runMC3D(S3, { source: ledSource({ x: 0, y: 0, z: 0 }), N: per, seed: 101 + b, onExit: (q, f, x, y, z, dx, dy, dz, w) => { if (q === 0 && f === 1) add(a3, b, x, y, w / per); } });
  ms3 += r3.ms;
  const hf = heightfieldFromFn(W, W, 0.5, () => 0, () => -t);
  const S1 = makeScene({ hf, ox: 0, oy: 0, depth, n: o.n, medium: { mus: o.mus, g: o.g, mua: o.mua }, rhoB, walls: null });
  const r1 = runBodyMC(S1, { leds: [{ x: 0, y: 0 }], led: { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 }, N: per, seed: 9001 + b, onExit: (x, y, w) => add(a1, b, x, y, w / per) });
  ms1 += r1.ms;
}
const stat = (acc, k) => { const v = acc.map((x) => x[k]), m = v.reduce((s, x) => s + x, 0) / B; return { m, se: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (B - 1) / B) }; };
console.log(`Milky ${milky}, N ${N}: 3D ${(ms3 / 1000).toFixed(1)}s, S1 ${(ms1 / 1000).toFixed(1)}s`);
for (let k = 0; k < NR; k++) {
  const x = stat(a3, k), y = stat(a1, k), d = x.m / y.m - 1, sig = Math.hypot(x.se, y.se) / y.m;
  ok(Math.abs(d) <= Math.max(0.03, 3 * sig), `V3D-1 고리 ${k * RING}~${(k + 1) * RING}mm: 3D ${x.m.toExponential(3)} / S1 ${y.m.toExponential(3)} (차 ${(d * 100).toFixed(2)}%, 3σ ${(3 * sig * 100).toFixed(2)}%)`);
}
const T3 = stat(a3, NR), T1 = stat(a1, NR);
ok(Math.abs(T3.m / T1.m - 1) <= 0.01, `V3D-1 윗면 총 출사: 3D ${T3.m.toFixed(4)} / S1 ${T1.m.toFixed(4)} (차 ${((T3.m / T1.m - 1) * 100).toFixed(2)}% ≤ 1%)`);
done();
```

- [ ] **Step 2: 실행**

Run: `node test/mech3d-v1.mjs`
Expected: 7개 PASS, 소요 시간 출력. 단일 스레드라 수 분이 걸릴 수 있다. 3분을 넘으면 `N=300000` 으로 한 번 더 돌려 결과와 시간을 보고한다.

두 추적기의 차이가 기준을 넘으면 기준을 완화하지 말고 원인을 찾는다(superpowers:systematic-debugging). 차이가 나는 고리와 방향, 원장 비교가 출발점이다. 예상되는 모델 차이는 둘이다.
- **판 옆면 처리:** S1 은 높이맵 가장자리, 3D 는 상자 옆면이다. 중앙 30mm 에는 영향이 미미해야 한다.
- **PCB 크기:** S1 은 무한, 3D 는 400mm 다.

- [ ] **Step 3: Commit**

```bash
git add test/mech3d-v1.mjs
git commit -m "test(mech3d): V3D-1 cross-check 3D MC vs S1 height-field MC on a milky plate"
```

---

### Task 6: 테스트 스크립트 + DB 소재 선택 시 Milky 맞춤 + 로그

**Files:**
- Modify: `package.json` (scripts)
- Modify: `src/main.js` (renderMech3d 의 `onMat` 처리기)

- [ ] **Step 1: package.json.** `test:mech3d` 끝에 ` && node test/mech3d-surface.mjs && node test/mech3d-optics.mjs && node test/mech3d-scene.mjs && node test/mech3d-mc.mjs` 를 덧붙이고, 다음 스크립트를 추가한다.

```json
    "test:mech3d-mc": "node test/mech3d-v1.mjs",
```

- [ ] **Step 2: DB 소재를 고르면 Milky 를 그 소재의 값으로.** `src/main.js` 의 `renderMech3d` 안 `onMat` 줄을 다음으로 바꾼다. `milkyFromMusR` 는 `./engine/l2/milky.js` 에서, `l2State` 는 이미 import 된 `./engine/l2/runtime.js` 에서 가져온다(없으면 import 추가).

```js
    onMat: (i, key, v) => updPart(i, (p) => {
      let q = setPartMaterialParam(p, key, v);
      // DB 소재 선택: Milky 칸을 그 소재의 피팅 μs' 에 해당하는 값으로(Milky = 농도 — 이후 사용자가 조절)
      const ent = key === 'dbId' && v ? materialDb()?.get(v) : null, tbl = l2State().table;
      if (ent && tbl) q = setPartMaterialParam(q, 'milky', Math.round(milkyFromMusR(tbl, ent.fitted.musR) * 100) / 100);
      return q;
    }),
```

- [ ] **Step 3: 전체 테스트**

Run: `npm test && npm run test:mech3d`
Expected: 모두 exit 0

- [ ] **Step 4: Commit**

```bash
git add package.json src/main.js
git commit -m "feat(mech3d): test scripts for P2; DB material sets Milky to its fitted value"
```

- [ ] **Step 5: 실행 로그 기록 후 push.** 이 계획 문서 끝에 "실행 로그"를 추가한다. 내용은 V3D-1·2·6 수치, 3D/S1 소요 시간, 발견·수정 사항이다.

```bash
git add docs/superpowers/plans/2026-10-14-mech3d-p2-mc-tracer.md
git commit -m "docs(plan): mech3d P2 execution log"
git push origin master
```

---

## 범위 밖 (P3 이후)
- LED 정의(STEP 인식·직접 배치)·관측면·라인 인식·(s,w) 집계: P3. P2 의 `onExit` 가 그 집계의 입력이 된다.
- Worker 병렬 실행·응답 재사용(후보 기저·Milky 재가중)·자동설계: P4. 재가중을 하려면 광선별로 Milky 매질 경로 길이와 산란 횟수를 기록해야 하는데, 그 기록은 P4 에서 `runMC3D` 옵션으로 추가한다.
- 성능 최적화: BVH 결과 객체 재사용, 스택 사전 할당, 근접 자식 우선 순회. P4 의 성능 목표(V3D-P)와 함께 한다.
- 3D 모드에서 평판 입력바 숨김: P3.

---

## 실행 로그 (2026-10-15)

**커밋:** `9ccfaec` 추적기(V3D-2·6) → `0584fa6`·`bdcafe8`·`d48f8b7` 리뷰 수정 → `e5ed5a7` V3D-1 → `e0e1e17` 스크립트·DB Milky.

**V3D-1** (`node test/mech3d-v1.mjs`, Milky 3, N 600000, 배치 10) — 7/7 PASS, 전체 60 s(3D 29.1 s, S1 30.3 s, 단일 스레드)

| 고리 | 3D | S1 | 차 | 3σ |
|---|---|---|---|---|
| 0~5mm | 9.958e-2 | 9.978e-2 | −0.20% | 1.25% |
| 5~10mm | 1.785e-1 | 1.775e-1 | +0.58% | 0.97% |
| 10~15mm | 1.464e-1 | 1.470e-1 | −0.41% | 1.72% |
| 15~20mm | 1.048e-1 | 1.048e-1 | +0.01% | 1.96% |
| 20~25mm | 7.402e-2 | 7.366e-2 | +0.49% | 2.22% |
| 25~30mm | 5.300e-2 | 5.313e-2 | −0.23% | 1.92% |
| 윗면 총(광속 대비) | 0.7999 | 0.7964 | +0.43% (σ 0.07%) | 기준 ≤ 1% |

- 윗면 총 차 +0.43% 는 기준 안이지만 통계적으로 유의(≈6σ)해 원인을 확인했다.
  - 편광 아님: 일시적으로 Fresnel 을 비편광 평균으로 바꿔도 +0.52%.
  - **PCB 크기가 원인:** 3D PCB 를 400mm → 120mm(S1 격자 범위)로 맞추면 +0.07%(1σ 이내). S1 은 격자 밖을 측면 탈출로 끝내고, 3D 의 넓은 PCB 는 판 밖으로 나간 빛 일부를 판으로 되돌린다. 계획의 400mm 를 유지하고 테스트에 주석으로 남겼다.
- 테스트 표시를 광원 광속 대비 비율(w / flux)로 바꿨다(계획은 w / per — 판정에는 영향 없음). 총 출사 줄에 σ 를 추가했다.

**V3D-2 · V3D-6** (`node test/mech3d-mc.mjs`, 29 PASS, 36 s)
- V3D-6 광학 접촉 T 0.9036(해석 0.9023), 맞붙은 공기층 0.8246 / 0.5mm 공기층 0.8246(해석 0.8220), 판 1장 0.9029.
- V3D-2 원장 오차 2.7e-13(Milky 판 + 백색 PCB + 흑색 벽, LED 2개), 투명 장면 lost 0.
- 편광 공기층: 50° 0.7960(해석 0.7967), 70° 0.5972(해석 0.5981). 판 1장 50° 0.8742(0.8755), 70° 0.7139(0.7131).
- 얇은 판 0.03 / 0.045 / 0.1mm: 접촉 0.9036, 공기층 0.8248. 실제 0.03mm 틈(평면 판정 0.02mm 초과) 0.8248. 60° 도광 바 30만 광자 lost 0, 모서리 적중 lost 0.

**리뷰 중 수정한 사항**
- 접촉면 짝을 면 단위가 아닌 **점 단위**(같은 위치의 짝 삼각형)로 찾는다 — 부분 겹침 처리.
- **편광 Fresnel**(Jones 벡터): 방출·확산 반사·체적 산란 후에는 무작위 편광으로 해소한다. 비스듬한 입사에서 비편광 평균 대비 오차를 없앴다.
- **중첩 매질**: 스택으로 부품 안의 부품을 처리한다.
- **얇은 부품**: 정확히 같은 면의 짝은 건너뛰고, 평면 판정 간격은 0.02mm 이다.
- **직전 삼각형 제외**: 자기 교차를 막는다.
- **모서리 루프**: 모서리 적중 시 tMin 1e-9 와 삼각형 제외를 함께 써서 무한 반복을 막는다.
- 산란 뒤 출발점 이동(OFF) 제거: 면에서 1e-5mm 안쪽에서 산란한 광자가 그 면을 향하면 OFF 이동만으로 교차 검사 없이 면을 넘어 불투명 부품 안으로 들어가 lost 가 됐다(불투명 블록 위 Milky, lost 1.4e-4~5.3e-4). 이후 OFF 자체를 마지막 삼각형 제외 + tMin 1e-9 로 대체.

**Task 6 변경:** `test:mech3d` 에는 빠른 suite(mesh·bvh·materials·contacts·import·surface·optics·scene)만 두고, 느린 suite 는 `test:mech3d-mc` = `node test/mech3d-mc.mjs && node test/mech3d-v1.mjs`(약 1분 36초)로 분리했다. `src/main.js` 의 `onMat` 에서 DB 소재를 고르면 Milky 칸을 `milkyFromMusR(table, fitted.musR)`(소수 2자리)로 맞춘다. `npm test`, `test:mech3d`, `test:mech3d-mc` 모두 exit 0.
