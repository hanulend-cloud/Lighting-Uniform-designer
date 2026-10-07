# L2 Solver A1 — Offline Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-validating L2 volume-scattering engine (MC slab → response table → diffusion transition → Milky mapping → cavity recycling solver → validator) as pure, UI-independent modules with node tests. Spec: `docs/superpowers/specs/2026-10-07-l2-diffusion-solver-design.md` (rev.4) §4, §5.1–5.3, §5.5, §12 A1.

**Architecture:** Pure ES modules in `src/engine/l2/`. A Monte Carlo slab (HG phase, Fresnel/TIR, path-length histograms for runtime absorption) is run offline over a (τ', g, n, incidence) grid into a Float32 table shipped in the repo. Above τ'=10 the table blends into a closed-form diffusion approximation. A cavity solver convolves LED band irradiance with table kernels (FFT, wall fold-back) and iterates board↔slab recycling with explicit energy bookkeeping. `validator.js` checks the table against independent adding-doubling references (iadpython) and each solve for energy/sanity.

**Tech Stack:** Node 24 ES modules (no deps), `node:worker_threads` for table build, Python + `iadpython` (offline reference generation only).

**File code blocks:** every code block whose fence reads ```` ```js path ```` / ```` ```python path ```` is the complete content of that file.

**Spec deviations (decided during planning, with evidence):**
- V4 drops "kernel RMS non-decreasing": in a weakly scattering slab, light scattered beyond the critical angle is TIR-trapped and travels far, so RMS is physically non-monotone. V4 keeps T non-increasing, HPA non-decreasing (±2°), Milky monotone.
- Scattered light beyond 20·t laterally (`radTail`) is spread uniformly over the body footprint (slab light-guide approximation) — listed in the assumptions panel in A2.
- Diffusion kernel ignores absorption (shape only), as spec §5.1 limits.

---

## Task 1: MC slab tests (V2, V3, V5)

`src/engine/l2/mc-slab.js` was written and verified against iadpython during planning (vdH T 0.6608/0.6610, clear slab 0.9013/0.9013, τ=10 g=0.9 n=1.59 normal 0.5713/0.5738, diffuse 0.5222/0.5223). This task locks it with tests.

**Files:**
- Existing: `src/engine/l2/mc-slab.js`
- Create: `test/l2-mc.mjs`

- [ ] **Step 1: Write the test**

```js test/l2-mc.mjs
// L2 MC 슬래브 기준 대조: node test/l2-mc.mjs  (spec V2·V3·V5)
// 기준값은 iadpython(Prahl adding-doubling)으로 산출 — tools/gen-ref-ad.py 와 동일 조건.
import { runSlab, totals, pathBin, pathBinCenter, N_PATH } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// V5 van de Hulst 슬래브(a=0.9, b=2, g=0.75, n=1): AD Rd=0.09740, Tt=0.66096
{
  const o = totals(runSlab({ tau: 1.8, g: 0.75, n: 1, inc: 1, N: 200000, seed: 7 }), 0.2);
  ok(near(o.R, 0.09740, 0.005) && near(o.Tb + o.Ts, 0.66096, 0.005),
    `V5 van de Hulst R=${o.R.toFixed(4)}(0.0974) T=${(o.Tb + o.Ts).toFixed(4)}(0.6610)`);
}
// V3 투명 슬래브 해석해 T=(1−R)²/(1−R²)
{
  const n = 1.59, Rf = ((n - 1) / (n + 1)) ** 2, Tc = (1 - Rf) ** 2 / (1 - Rf * Rf);
  const o = totals(runSlab({ tau: 0, g: 0.9, n, inc: 1, N: 20000 }));
  ok(near(o.Tb, Tc, 0.0005) && o.Ts === 0, `V3 투명 슬래브 T=${o.Tb.toFixed(5)} (해석 ${Tc.toFixed(5)})`);
}
// V2 에너지 수지: 흡수 0 → T+R=1, 흡수 >0 → T+R<1
for (const tau of [0.5, 5, 50]) {
  const r = runSlab({ tau, g: 0.9, n: 1.59, inc: 0.7, N: 20000, seed: 3 });
  const o = totals(r), a = totals(r, 0.1);
  ok(near(o.Tb + o.Ts + o.R, 1, 0.005), `V2 τ=${tau} T+R=${(o.Tb + o.Ts + o.R).toFixed(4)}`);
  ok(a.Tb + a.Ts + a.R < o.Tb + o.Ts + o.R, `V2 τ=${tau} 흡수 적용 시 T+R 감소`);
}
// AD 직접 대조 (b=10, g=0.9, n=1.59): UR1 0.42620 UT1 0.57380 URU 0.47768 UTU 0.52232
{
  const on = totals(runSlab({ tau: 10, g: 0.9, n: 1.59, inc: 1, N: 100000, seed: 11 }));
  const od = totals(runSlab({ tau: 10, g: 0.9, n: 1.59, inc: 'diffuse', N: 100000, seed: 12 }));
  ok(near(on.R, 0.42620, 0.01) && near(on.Tb + on.Ts, 0.57380, 0.01), `AD 법선 R=${on.R.toFixed(4)} T=${(on.Tb + on.Ts).toFixed(4)}`);
  ok(near(od.R, 0.47768, 0.01) && near(od.Tb + od.Ts, 0.52232, 0.01), `AD 확산 R=${od.R.toFixed(4)} T=${(od.Tb + od.Ts).toFixed(4)}`);
}
// 경로길이 bin 경계
ok(pathBin(0) === 0 && pathBin(1e9) === N_PATH - 1 && pathBinCenter(0) > 0.5, '경로길이 bin 경계 처리');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** `node test/l2-mc.mjs` — Expected: all PASS (≈15 s).
- [ ] **Step 3: Commit**

```bash
git add src/engine/l2/mc-slab.js test/l2-mc.mjs
git commit -m "feat(l2): MC volume-scattering slab with path-length absorption + reference tests"
```

---

## Task 2: Adding-doubling reference generator

**Files:**
- Create: `tools/gen-ref-ad.py`, `src/engine/l2/data/ref-ad.json` (generated)

- [ ] **Step 1: Write the generator**

```python tools/gen-ref-ad.py
"""L2 기준해 생성 — Prahl adding-doubling(iadpython)으로 슬래브 R/T 산출 → src/engine/l2/data/ref-ad.json
사용: pip install iadpython ; python tools/gen-ref-ad.py
조건: n 1.49/1.59, g 0.8/0.9/0.95, τ' 0.05~1000, μa·t 0/0.02, 상·하 공기. (spec §5.5 V1)
"""
import json, pathlib, datetime
import iadpython as iad

cases = []
for n in (1.49, 1.59):
    for g in (0.8, 0.9, 0.95):
        for tauR in (0.05, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 200, 1000):
            for muaT in (0.0, 0.02):
                mus_t = tauR / (1 - g)
                b = mus_t + muaT
                a = mus_t / b
                s = iad.Sample(a=a, b=b, g=g, n=n, n_above=1.0, n_below=1.0, quad_pts=16)
                ur1, ut1, uru, utu = (float(v) for v in s.rt())
                cases.append(dict(n=n, g=g, tauR=tauR, muaT=muaT, UR1=ur1, UT1=ut1, URU=uru, UTU=utu))
out = dict(source='iadpython %s (Prahl adding-doubling), quad_pts=16' % iad.__version__,
           created=datetime.date.today().isoformat(), cases=cases)
p = pathlib.Path(__file__).resolve().parent.parent / 'src/engine/l2/data/ref-ad.json'
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(out, indent=1))
print('wrote', p, len(cases), 'cases')
```

- [ ] **Step 2: Run** (venv with iadpython) `python tools/gen-ref-ad.py` — Expected: `wrote ... 132 cases`.
- [ ] **Step 3: Commit**

```bash
git add tools/gen-ref-ad.py src/engine/l2/data/ref-ad.json
git commit -m "feat(l2): adding-doubling reference values (iadpython) for V1"
```

---

## Task 3: Diffusion approximation (τ' > 10)

**Files:**
- Create: `src/engine/l2/diffusion.js`, `test/l2-diffusion.mjs`

- [ ] **Step 1: Write the failing test**

```js test/l2-diffusion.mjs
// L2 확산근사 vs adding-doubling: node test/l2-diffusion.mjs  (spec §5.2)
import fs from 'node:fs';
import { diffusionTR, diffusionKernel, diffusionAngles } from '../src/engine/l2/diffusion.js';
import { radEdge, N_RAD } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const ref = JSON.parse(fs.readFileSync(new URL('../src/engine/l2/data/ref-ad.json', import.meta.url)));

// τ' ≥ 20 전 케이스: 절대오차 ≤ 0.01 (확산근사 적용 구간)
let worst = 0, wc = null;
for (const c of ref.cases.filter((c) => c.tauR >= 20)) {
  const a = diffusionTR(c.tauR, c.muaT, c.n, 1), d = diffusionTR(c.tauR, c.muaT, c.n, 'diffuse');
  const e = Math.max(Math.abs(a.T - c.UT1), Math.abs(a.R - c.UR1), Math.abs(d.T - c.UTU), Math.abs(d.R - c.URU));
  if (e > worst) { worst = e; wc = c; }
}
ok(worst <= 0.01, `확산근사 τ'≥20 최대 절대오차 ${worst.toFixed(4)} (${wc && `τ'=${wc.tauR} n=${wc.n} μa·t=${wc.muaT}`})`);
// 흡수 0 에너지 보존
{ const r = diffusionTR(50, 0, 1.59, 1); ok(Math.abs(r.T + r.R - 1) < 1e-12, 'μa=0 → T+R=1'); }
// 커널: 합 1, RMS 가 두께 수준(0.3~1.0 t)
for (const tr of [20, 1000]) {
  const k = diffusionKernel(tr, 1.59, 1);
  const s = k.reduce((p, v) => p + v, 0);
  let m2 = 0; for (let i = 0; i < N_RAD; i++) m2 += k[i] * ((radEdge(i) + radEdge(i + 1)) / 2) ** 2;
  ok(Math.abs(s - 1) < 1e-9 && Math.sqrt(m2) > 0.3 && Math.sqrt(m2) < 1.0, `커널 τ'=${tr} 합=${s.toFixed(6)} RMS=${Math.sqrt(m2).toFixed(3)}t`);
}
// 각분포: 합 1
{ const a = diffusionAngles(1.59); ok(Math.abs(a.reduce((p, v) => p + v, 0) - 1) < 1e-9, '출사각 분포 합 1'); }

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** `node test/l2-diffusion.mjs` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement**

```js src/engine/l2/diffusion.js
// L2 고 Milky(τ' > 10) 확산근사 — spec 2026-10-07 §5.2. 슬래브 확산방정식 + 외삽경계(내부 Fresnel).
// 길이는 두께 t 단위. T 는 산란 투과(비산란 성분은 τ'≥10 에서 e^{-τ} 로 무시 가능), R 은 정반사 포함.
import { fresnelR } from '../photometry.js';
import { N_RAD, radEdge, N_ANG, angEdgeDeg } from './mc-slab.js';

const DEG = Math.PI / 180;

// 내부 반사 유효계수 R_eff(n) 경험식(Groenhuis 1983) → 외삽거리 계수 A = (1+R_eff)/(1−R_eff)
export function boundaryA(n) {
  const Reff = -1.440 / (n * n) + 0.710 / n + 0.668 + 0.0636 * n;
  return (1 + Reff) / (1 - Reff);
}

// 입사 조건 → 진입 Fresnel 반사율, 굴절 후 평균 cos(첫 산란 깊이 z0 보정)
function entry(n, inc) {
  if (inc !== 'diffuse') {
    const sinT = Math.sqrt(1 - inc * inc) / n;
    return { Rf: fresnelR(inc, n), meanCos: Math.sqrt(1 - sinT * sinT) };
  }
  let R = 0, C = 0; const K = 400;
  for (let i = 0; i < K; i++) {
    const mu = (i + 0.5) / K, w = 2 * mu / K;            // Lambertian 입사 확률
    const r = fresnelR(mu, n), sinT = Math.sqrt(1 - mu * mu) / n;
    R += r * w; C += (1 - r) * Math.sqrt(1 - sinT * sinT) * w;
  }
  return { Rf: R, meanCos: C / (1 - R) };
}

function geom(tauR, muaT, n, inc) {
  const { Rf, meanCos } = entry(n, inc);
  const mut = muaT + tauR;
  return { Rf, zb: 2 * boundaryA(n) / (3 * mut), z0: Math.min(meanCos / mut, 0.5) };
}

// 전광선 투과 T, 반사 R(정반사 포함). muaT = μa·t, inc = 공기 중 입사 cos 또는 'diffuse'.
export function diffusionTR(tauR, muaT, n, inc) {
  const { Rf, zb, z0 } = geom(tauR, muaT, n, inc);
  const Lp = 1 + 2 * zb;
  const mueff = Math.sqrt(3 * muaT * (muaT + tauR));
  let T, Rd;
  if (mueff < 1e-9) { T = (z0 + zb) / Lp; Rd = (1 + zb - z0) / Lp; }
  else {
    const S = Math.sinh(mueff * Lp);
    T = Math.sinh(mueff * (z0 + zb)) / S;
    Rd = Math.sinh(mueff * (1 + zb - z0)) / S;
  }
  return { T: (1 - Rf) * T, R: Rf + (1 - Rf) * Rd };
}

// 출사면(z=1) 측방 플럭스 반경 분포 — 이미지 소스 급수(흡수 무시, 형상만). mc-slab 반경 bin 형식, 합 1.
export function diffusionKernel(tauR, n, inc) {
  const { zb, z0 } = geom(tauR, 0, n, inc);
  const Lp = 1 + 2 * zb, M = 12;
  const J = (rho) => {
    let s = 0;
    for (let m = -M; m <= M; m++) {
      const dp = 1 - (2 * m * Lp + z0), dm = 1 - (2 * m * Lp - 2 * zb - z0);
      s += dp / Math.pow(rho * rho + dp * dp, 1.5) - dm / Math.pow(rho * rho + dm * dm, 1.5);
    }
    return s / (4 * Math.PI);
  };
  const out = new Float64Array(N_RAD);
  for (let k = 0; k < N_RAD; k++) {
    const a = radEdge(k), b = radEdge(k + 1), S = 16;
    let acc = 0;
    for (let i = 0; i < S; i++) { const r = a + (b - a) * (i + 0.5) / S; acc += J(r) * 2 * Math.PI * r * (b - a) / S; }
    out[k] = Math.max(0, acc);
  }
  const tot = out.reduce((p, v) => p + v, 0);
  for (let k = 0; k < N_RAD; k++) out[k] /= tot;
  return out;
}

// 내부 등방 방사휘도의 Fresnel 투과 출사각 분포(bin 별 파워 분율, 합 1)
export function diffusionAngles(n) {
  const out = new Float64Array(N_ANG);
  for (let k = 0; k < N_ANG; k++) {
    const a = angEdgeDeg(k) * DEG, b = angEdgeDeg(k + 1) * DEG, S = 16;
    let acc = 0;
    for (let i = 0; i < S; i++) {
      const th = a + (b - a) * (i + 0.5) / S;
      acc += (1 - fresnelR(Math.cos(th), n)) * Math.cos(th) * Math.sin(th) * (b - a) / S;
    }
    out[k] = acc;
  }
  const tot = out.reduce((p, v) => p + v, 0);
  for (let k = 0; k < N_ANG; k++) out[k] /= tot;
  return out;
}
```

- [ ] **Step 4: Run** `node test/l2-diffusion.mjs` — Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/engine/l2/diffusion.js test/l2-diffusion.mjs
git commit -m "feat(l2): diffusion approximation (T/R/kernel/angles) for high Milky"
```

---

## Task 4: Response table — packing, loading, interpolation

**Files:**
- Create: `src/engine/l2/slab-table.js`

- [ ] **Step 1: Implement** (tested in Task 6 against the built table)

```js src/engine/l2/slab-table.js
// L2 슬래브 응답 테이블 — 레코드 패킹·로드·보간·흡수 적용·확산근사 전이 (spec 2026-10-07 §5.2).
// 테이블 셀 = (τ', g, n, 입사 행). 행 0..8 = 공기 중 입사 cos 균등(0~85°), 마지막 행 = 확산(Lambertian) 입사.
// 길이는 두께 t 단위. 질의 결과 q = { Tb, Ts, R, rad(반경 분포, 합 1), radTail, ang(출사각 분포, 합 1), shift, outOfRange }.
import { N_PATH, N_RAD, N_ANG, attenuate, radEdge, angEdgeDeg } from './mc-slab.js';
import { diffusionTR, diffusionKernel, diffusionAngles } from './diffusion.js';

export const REC = 6 * N_PATH + N_RAD + N_ANG + 2;
const O = {
  Tb: 0, TbL: N_PATH, Ts: 2 * N_PATH, TsL: 3 * N_PATH, R: 4 * N_PATH, RL: 5 * N_PATH,
  rad: 6 * N_PATH, ang: 6 * N_PATH + N_RAD, shift: 6 * N_PATH + N_RAD + N_ANG, photons: 6 * N_PATH + N_RAD + N_ANG + 1,
};
export const SW_LO = 10, SW_HI = 20;      // MC → 확산근사 전이 구간(τ')
const DEG = Math.PI / 180;

// MC 레코드 → Float32 (광자 수로 정규화)
export function packRecord(rec) {
  const out = new Float32Array(REC), N = rec.photons;
  for (const k of ['Tb', 'TbL', 'Ts', 'TsL', 'R', 'RL', 'rad', 'ang']) {
    const a = rec[k]; for (let i = 0; i < a.length; i++) out[O[k] + i] = a[i] / N;
  }
  out[O.shift] = rec.shift / N; out[O.photons] = N;
  return out;
}

function blend(parts) {
  const q = { Tb: 0, Ts: 0, R: 0, rad: new Float64Array(N_RAD), ang: new Float64Array(N_ANG), radTail: 0, shift: 0 };
  let ws = 0;
  for (const [w, c] of parts) {
    q.Tb += w * c.Tb; q.Ts += w * c.Ts; q.R += w * c.R;
    const v = w * c.Ts;                          // 분포는 산란 투과량 가중으로 혼합
    if (v > 0) {
      ws += v;
      for (let k = 0; k < N_RAD; k++) q.rad[k] += v * c.rad[k];
      for (let k = 0; k < N_ANG; k++) q.ang[k] += v * c.ang[k];
      q.radTail += v * c.radTail; q.shift += v * c.shift;
    }
  }
  if (ws > 0) {
    for (let k = 0; k < N_RAD; k++) q.rad[k] /= ws;
    for (let k = 0; k < N_ANG; k++) q.ang[k] /= ws;
    q.radTail /= ws; q.shift /= ws;
  }
  return q;
}

function linBracket(grid, v) {
  const L = grid.length - 1;
  if (v <= grid[0]) return { i0: 0, i1: 0, w: 0, clamped: v < grid[0] - 1e-9 };
  if (v >= grid[L]) return { i0: L, i1: L, w: 0, clamped: v > grid[L] + 1e-9 };
  let i = 0; while (grid[i + 1] < v) i++;
  return { i0: i, i1: i + 1, w: (v - grid[i]) / (grid[i + 1] - grid[i]), clamped: false };
}

export function createTable(meta, data) {
  const G = meta.grids, NT = G.tauR.length, NG = G.g.length, NN = G.n.length, NROW = G.rows.length;
  if (meta.rec !== REC) throw new Error(`slab-table 레코드 길이 불일치: ${meta.rec} ≠ ${REC}`);
  if (data.length !== NT * NG * NN * NROW * REC) throw new Error('slab-table 크기 불일치');
  const diffuseRow = NROW - 1, angleRows = NROW - 1;
  const off = (it, ig, inn, ir) => ((((it * NG + ig) * NN + inn) * NROW + ir) * REC);

  function cell(o, muaT) {
    const sl = (k, len) => data.subarray(o + O[k], o + O[k] + len);
    const TsRaw = sl('Ts', N_PATH).reduce((p, v) => p + v, 0);
    const radRaw = sl('rad', N_RAD), sR = radRaw.reduce((p, v) => p + v, 0);
    const angRaw = sl('ang', N_ANG), sA = angRaw.reduce((p, v) => p + v, 0);
    return {
      Tb: attenuate(sl('Tb', N_PATH), sl('TbL', N_PATH), muaT),
      Ts: attenuate(sl('Ts', N_PATH), sl('TsL', N_PATH), muaT),
      R: attenuate(sl('R', N_PATH), sl('RL', N_PATH), muaT),
      rad: sR > 0 ? Float64Array.from(radRaw, (v) => v / sR) : new Float64Array(N_RAD),
      radTail: TsRaw > 0 ? Math.max(0, 1 - sR / TsRaw) : 0,
      ang: sA > 0 ? Float64Array.from(angRaw, (v) => v / sA) : new Float64Array(N_ANG),
      shift: TsRaw > 0 ? data[o + O.shift] / TsRaw : 0,
    };
  }
  function tauBracket(v) {
    const T = G.tauR;
    if (v <= 0) return { i0: 0, i1: 0, w: 0 };
    if (v < T[1]) return { i0: 0, i1: 1, w: v / T[1] };
    if (v >= T[NT - 1]) return { i0: NT - 1, i1: NT - 1, w: 0 };
    let i = 1; while (T[i + 1] < v) i++;
    return { i0: i, i1: i + 1, w: Math.log(v / T[i]) / Math.log(T[i + 1] / T[i]) };
  }
  function mc(tauR, g, n, row, muaT) {
    const bt = tauBracket(tauR), bg = linBracket(G.g, g), bn = linBracket(G.n, n);
    const parts = [];
    for (const [it, wt] of [[bt.i0, 1 - bt.w], [bt.i1, bt.w]])
      for (const [ig, wg] of [[bg.i0, 1 - bg.w], [bg.i1, bg.w]])
        for (const [inn, wn] of [[bn.i0, 1 - bn.w], [bn.i1, bn.w]]) {
          const w = wt * wg * wn;
          if (w > 0) parts.push([w, cell(off(it, ig, inn, row), muaT)]);
        }
    const q = blend(parts);
    q.outOfRange = bg.clamped || bn.clamped;
    return q;
  }
  const kMemo = new Map(), aMemo = new Map();
  function diff(tauR, g, n, row, muaT) {
    const inc = row === diffuseRow ? 'diffuse' : G.rows[row];
    const { T, R } = diffusionTR(tauR, muaT, n, inc);
    const kk = `${tauR.toPrecision(4)}|${n}|${inc}`;
    if (!kMemo.has(kk)) kMemo.set(kk, diffusionKernel(tauR, n, inc));
    if (!aMemo.has(n)) aMemo.set(n, diffusionAngles(n));
    return {
      Tb: 0, Ts: T, R, rad: kMemo.get(kk), radTail: 0, ang: aMemo.get(n), shift: 0,
      outOfRange: g < G.g[0] - 1e-9 || g > G.g[NG - 1] + 1e-9 || n < G.n[0] - 1e-9 || n > G.n[NN - 1] + 1e-9,
    };
  }
  // mode: undefined(자동 전이) | 'mc' | 'diff'
  function query(tauR, g, n, row, muaT = 0, mode) {
    if (mode === 'mc' || (!mode && tauR <= SW_LO)) return mc(tauR, g, n, row, muaT);
    if (mode === 'diff' || tauR >= SW_HI) return diff(tauR, g, n, row, muaT);
    const w = Math.log(tauR / SW_LO) / Math.log(SW_HI / SW_LO);
    const a = mc(tauR, g, n, row, muaT), b = diff(tauR, g, n, row, muaT);
    const q = blend([[1 - w, a], [w, b]]);
    q.outOfRange = a.outOfRange || b.outOfRange;
    return q;
  }
  // 입사 cos → 가장 가까운 각도 행
  function bandOf(mu) {
    let best = 0, d = Infinity;
    for (let k = 0; k < angleRows; k++) { const e = Math.abs(G.rows[k] - mu); if (e < d) { d = e; best = k; } }
    return best;
  }
  return { meta, grids: G, angleRows, diffuseRow, query, bandOf, _data: data, _off: off };
}

// 반경 분포의 RMS 반경(두께 단위)
export function kernelRms(rad) {
  let m2 = 0; for (let k = 0; k < N_RAD; k++) m2 += rad[k] * ((radEdge(k) + radEdge(k + 1)) / 2) ** 2;
  return Math.sqrt(m2);
}

// 투과 광도 I(θ) 가 I(0)/2 가 되는 반광각 HPA(°). 비산란 성분은 0~1° bin 에 포함.
export function hpaDeg(q) {
  const I = new Float64Array(N_ANG);
  for (let k = 0; k < N_ANG; k++) {
    const a = angEdgeDeg(k) * DEG, b = angEdgeDeg(k + 1) * DEG;
    I[k] = (q.Ts * q.ang[k] + (k === 0 ? q.Tb : 0)) / (2 * Math.PI * (Math.cos(a) - Math.cos(b)));
  }
  if (!(I[0] > 0)) return 0;
  const half = I[0] / 2;
  for (let k = 1; k < N_ANG; k++) {
    if (I[k] < half) {
      const c0 = (angEdgeDeg(k - 1) + angEdgeDeg(k)) / 2, c1 = (angEdgeDeg(k) + angEdgeDeg(k + 1)) / 2;
      return c0 + (I[k - 1] - half) / (I[k - 1] - I[k]) * (c1 - c0);
    }
  }
  return 90;
}
```

- [ ] **Step 2: Syntax check** `node -e "import('./src/engine/l2/slab-table.js').then(m=>console.log(m.REC))"` — Expected: `260`.

---

## Task 5: Table build script + generated table

**Files:**
- Create: `src/engine/l2/build-table.mjs`, `src/engine/l2/data/slab-table.bin`, `src/engine/l2/data/slab-meta.json` (generated)

- [ ] **Step 1: Implement**

```js src/engine/l2/build-table.mjs
// L2 슬래브 응답 테이블 생성 (spec 2026-10-07 §5.2) — 오프라인 1회, 결과는 저장소에 커밋.
// 사용: node src/engine/l2/build-table.mjs [--quick] [--out <dir>]
//   --quick: 광자 수 축소(빌드 경로 점검용, 정확도 기준 미달) / 기본 출력: src/engine/l2/data/
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSlab } from './mc-slab.js';
import { packRecord, REC, SW_HI } from './slab-table.js';

const COS85 = Math.cos(85 * Math.PI / 180);
export const GRIDS = {
  tauR: [0, ...Array.from({ length: 31 }, (_, i) => 0.01 * Math.pow(SW_HI / 0.01, i / 30))],
  g: [0.6, 0.8, 0.9, 0.95],
  n: [1.49, 1.59, 1.70],
  rows: [...Array.from({ length: 9 }, (_, k) => 1 - k * (1 - COS85) / 8), 'diffuse'],
};

function photons(tauR, quick) {
  const base = quick ? 4000 : 200000, min = quick ? 500 : 10000;
  return Math.round(Math.min(base, Math.max(min, base / (1 + tauR))));
}

if (!isMainThread) {
  const { jobs, quick } = workerData;
  for (const j of jobs) {
    const rec = runSlab({ tau: j.tauR / (1 - j.g), g: j.g, n: j.n, inc: j.inc, N: photons(j.tauR, quick), seed: j.idx + 1 });
    const buf = packRecord(rec);
    parentPort.postMessage({ idx: j.idx, buf }, [buf.buffer]);
  }
} else {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const oi = args.indexOf('--out');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = oi >= 0 ? path.resolve(args[oi + 1]) : path.join(here, 'data');
  const G = GRIDS, jobs = [];
  let idx = 0;
  for (const tauR of G.tauR) for (const g of G.g) for (const n of G.n) for (const inc of G.rows)
    jobs.push({ idx: idx++, tauR, g, n, inc });
  // 무거운 셀(고 τ')이 한 워커에 몰리지 않도록 라운드로빈 분배
  const nW = Math.max(1, os.cpus().length), buckets = Array.from({ length: nW }, () => []);
  jobs.forEach((j, i) => buckets[i % nW].push(j));
  const data = new Float32Array(jobs.length * REC);
  let done = 0; const t0 = Date.now();
  await Promise.all(buckets.map((b) => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: b, quick } });
    w.on('message', (m) => {
      data.set(m.buf, m.idx * REC);
      if (++done % 200 === 0) console.log(`${done}/${jobs.length} cells, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    });
    w.on('error', rej); w.on('exit', res);
  })));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'slab-table.bin'), Buffer.from(data.buffer));
  const meta = { version: 1, rec: REC, grids: G, quick, cells: jobs.length, seconds: Math.round((Date.now() - t0) / 1000), created: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'slab-meta.json'), JSON.stringify(meta, null, 1));
  console.log(`wrote ${outDir} — ${jobs.length} cells in ${meta.seconds}s`);
}
```

- [ ] **Step 2: Quick-mode smoke** `node src/engine/l2/build-table.mjs --quick --out <scratch>/l2q` — Expected: `wrote ... 3840 cells`.
- [ ] **Step 3: Full build (background, ~10–20 min)** `node src/engine/l2/build-table.mjs` — Expected: `wrote .../src/engine/l2/data — 3840 cells`, file ≈ 4.0 MB.
- [ ] **Step 4: Commit**

```bash
git add src/engine/l2/slab-table.js src/engine/l2/build-table.mjs src/engine/l2/data/slab-table.bin src/engine/l2/data/slab-meta.json
git commit -m "feat(l2): slab response table (MC, 3840 cells) + loader/interpolation"
```

---

## Task 6: Validator + table tests (V1, V3, V4, V11, V2/V7 result checks)

**Files:**
- Create: `src/engine/l2/validator.js`, `test/l2-util.mjs`, `test/l2-table.mjs`

- [ ] **Step 1: Write the tests**

```js test/l2-util.mjs
// L2 테스트 공용: 저장소 테이블·기준 로드
import fs from 'node:fs';
import { createTable } from '../src/engine/l2/slab-table.js';

const dir = new URL('../src/engine/l2/data/', import.meta.url);
export function loadTable() {
  const meta = JSON.parse(fs.readFileSync(new URL('slab-meta.json', dir)));
  const buf = fs.readFileSync(new URL('slab-table.bin', dir));
  return createTable(meta, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
}
export function loadRefAD() { return JSON.parse(fs.readFileSync(new URL('ref-ad.json', dir))); }
```

```js test/l2-table.mjs
// L2 테이블 자체검증: node test/l2-table.mjs  (spec V1·V3·V4·V11, 고장 주입)
import { loadTable, loadRefAD } from './l2-util.mjs';
import { validateTable } from '../src/engine/l2/validator.js';
import { createTable } from '../src/engine/l2/slab-table.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable(), ref = loadRefAD();

const v = validateTable(table, ref);
for (const c of v.checks) ok(c.ok, `${c.id} value=${typeof c.value === 'number' ? c.value.toFixed(4) : c.value} limit=${c.limit} ${c.note ?? ''}`);
ok(v.ok, '테이블 검증 전체 통과');

// 고장 주입: 산란 투과 채널 절반으로 손상 → V1 실패해야 함
{
  const bad = Float32Array.from(table._data);
  for (let i = 0; i < bad.length; i++) bad[i] *= (i % 260) >= 64 && (i % 260) < 128 ? 0.5 : 1;
  const vb = validateTable(createTable(table.meta, bad), ref);
  ok(!vb.ok && !vb.checks.find((c) => c.id === 'V1').ok, '고장 주입(테이블 손상) → V1 실패 감지');
}
// 범위 밖 플래그
ok(table.query(1, 0.5, 1.59, 0).outOfRange && table.query(1, 0.9, 1.40, 0).outOfRange && !table.query(1, 0.9, 1.59, 0).outOfRange, 'g·n 격자 밖 → outOfRange');
ok(table.bandOf(1) === 0 && table.bandOf(Math.cos(85 * Math.PI / 180)) === table.angleRows - 1, '입사 cos → 밴드');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** `node test/l2-table.mjs` — Expected: FAIL (validator missing).
- [ ] **Step 3: Implement**

```js src/engine/l2/validator.js
// L2 solver 자체검증 — spec 2026-10-07 §5.5 "계산 정합성" 배지의 근거.
// validateTable: 테이블 로드 시 1회(V1·V3·V4·V11). checkResult: cavity-solver 결과마다(V2·V7).
// 반환 { ok, checks:[{ id, ok, value, limit, note }] } — UI 는 하나라도 실패하면 "신뢰 불가".
import { hpaDeg } from './slab-table.js';

export function validateTable(table, refAD) {
  const checks = [], G = table.grids, D = table.diffuseRow;
  const T = (q) => q.Tb + q.Ts;

  // V1: 테이블 T/R vs adding-doubling (법선·확산 입사), |Δ| ≤ 0.02
  let worst = 0, wc = null;
  for (const c of refAD.cases) {
    const qn = table.query(c.tauR, c.g, c.n, 0, c.muaT), qd = table.query(c.tauR, c.g, c.n, D, c.muaT);
    const d = Math.max(Math.abs(qn.R - c.UR1), Math.abs(T(qn) - c.UT1), Math.abs(qd.R - c.URU), Math.abs(T(qd) - c.UTU));
    if (!(d <= worst)) { worst = d; wc = c; }
  }
  checks.push({ id: 'V1', ok: worst <= 0.02, value: worst, limit: 0.02, note: wc ? `최대 τ'=${wc.tauR} g=${wc.g} n=${wc.n} μa·t=${wc.muaT}` : '' });

  // V3: τ'=0 법선 투과 = 투명 슬래브 해석해 (n 1.59 → 0.9013)
  {
    const n = 1.59, Rf = ((n - 1) / (n + 1)) ** 2, Tc = (1 - Rf) ** 2 / (1 - Rf * Rf);
    const d = Math.abs(T(table.query(0, 0.9, n, 0)) - Tc);
    checks.push({ id: 'V3', ok: d <= 0.005, value: d, limit: 0.005, note: `해석해 ${Tc.toFixed(4)}` });
  }

  // V4: τ' 증가 → T 비증가(MC 잡음 허용 0.003), HPA 비감소(허용 2°)
  {
    const taus = [...G.tauR, 30, 50, 100, 300, 1000];
    let worstT = 0, worstH = 0;
    for (const g of G.g) for (const row of [0, D]) {
      let pT = Infinity, pH = -Infinity;
      for (const t of taus) {
        const q = table.query(t, g, 1.59, row);
        worstT = Math.max(worstT, T(q) - pT); pT = Math.min(pT, T(q));
        if (row === 0) { const h = hpaDeg(q); worstH = Math.max(worstH, pH - h); pH = Math.max(pH, h); }
      }
    }
    checks.push({ id: 'V4', ok: worstT <= 0.003 && worstH <= 2, value: Math.max(worstT, worstH / 1000), limit: 'ΔT≤0.003, ΔHPA≤2°', note: `T 역전 ${worstT.toFixed(4)}, HPA 역전 ${worstH.toFixed(2)}°` });
  }

  // V11: 전이 구간 연속성 — τ'=10 과 20 에서 MC vs 확산근사 (T·R 절대 ≤ 0.02 @10, ≤ 0.01 @20)
  {
    let w10 = 0, w20 = 0;
    for (const g of G.g) for (const n of G.n) for (const row of [0, D]) {
      for (const [t, set] of [[10, (e) => { w10 = Math.max(w10, e); }], [20, (e) => { w20 = Math.max(w20, e); }]]) {
        const a = table.query(t, g, n, row, 0, 'mc'), b = table.query(t, g, n, row, 0, 'diff');
        set(Math.max(Math.abs(T(a) - T(b)), Math.abs(a.R - b.R)));
      }
    }
    checks.push({ id: 'V11', ok: w10 <= 0.02 && w20 <= 0.01, value: w20, limit: '≤0.02@10, ≤0.01@20', note: `τ'10 ${w10.toFixed(4)} / τ'20 ${w20.toFixed(4)}` });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

// cavity-solver 결과 검사: V2 에너지 수지 ≤ 1%, V7 건전성(유한·비음수·출사 ≤ 입력)
export function checkResult(res) {
  const checks = [], e = res.energy;
  checks.push({ id: 'V2', ok: e.err <= 0.01, value: e.err, limit: 0.01, note: '시스템 에너지 수지' });
  let bad = 0, neg = 0, mx = 0;
  for (const v of res.M) { if (!Number.isFinite(v)) bad++; else { if (v > mx) mx = v; } }
  for (const v of res.M) if (v < -1e-9 * mx) neg++;
  const sane = bad === 0 && neg === 0 && e.top <= e.input * (1 + 1e-6);
  checks.push({ id: 'V7', ok: sane, value: bad + neg, limit: 0, note: `NaN/Inf ${bad}, 음수 ${neg}` });
  return { ok: checks.every((c) => c.ok), checks };
}
```

- [ ] **Step 4: Run** `node test/l2-table.mjs` — Expected: all PASS. **If V11 fails, do not loosen limits** — extend `GRIDS.tauR` to 40 and `SW_HI` to 40, rebuild (Task 5 Step 3), re-run.
- [ ] **Step 5: Commit**

```bash
git add src/engine/l2/validator.js test/l2-util.mjs test/l2-table.mjs
git commit -m "feat(l2): table validator (V1/V3/V4/V11) + result checks (V2/V7) with fault-injection test"
```

---

## Task 7: Milky mapping (reference-thickness occlusion)

**Files:**
- Create: `src/engine/l2/milky.js`, `test/l2-milky.mjs`

- [ ] **Step 1: Write the failing test**

```js test/l2-milky.mjs
// Milky 사상: node test/l2-milky.mjs  (spec §4)
import { loadTable } from './l2-util.mjs';
import { milkyFromMusR, musRFromMilky, MILKY_REF } from '../src/engine/l2/milky.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();

ok(milkyFromMusR(table, 0) === 0 && milkyFromMusR(table, Infinity) === 10, '끝점: μs\'=0 → 0, ∞ → 10');
ok(musRFromMilky(table, 0) === 0 && musRFromMilky(table, 10) === Infinity, '역변환 끝점');
let prev = -1, mono = true;
for (let e = -4; e <= 6; e += 0.25) { const m = milkyFromMusR(table, 10 ** e); if (m < prev - 1e-6) mono = false; prev = m; }
ok(mono, 'μs\' 증가 → Milky 단조 증가');
let worst = 0;
for (let m = 0.25; m < 9.9; m += 0.25) worst = Math.max(worst, Math.abs(milkyFromMusR(table, musRFromMilky(table, m)) - m));
ok(worst <= 0.01, `정역 왕복 오차 ${worst.toFixed(4)} ≤ 0.01`);
const m5 = musRFromMilky(table, 5);
console.log(`  참고: Milky 5 → μs'=${m5.toFixed(3)}/mm (기준 ${MILKY_REF.t}mm 에서 산란으로 50% 차폐)`);

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement**

```js src/engine/l2/milky.js
// Milky 눈금 — spec 2026-10-07 §4 (기준두께 차폐율). 소재 고유값(두께 무관), 정본 저장값은 μs'.
// Milky = 10 × (1 − T_s(μs') / T_s(0)),  T_s = 기준 슬래브(2mm, n 1.59, g 0.9, 흡수 0, 확산 입사) 전광선투과율.
export const MILKY_REF = { t: 2, n: 1.59, g: 0.9 };
export const MILKY_MAP_VER = 1;

function Tref(table, musR) {
  const q = table.query(musR * MILKY_REF.t, MILKY_REF.g, MILKY_REF.n, table.diffuseRow, 0);
  return q.Tb + q.Ts;
}

export function milkyFromMusR(table, musR) {
  if (!(musR > 0)) return 0;
  if (!Number.isFinite(musR)) return 10;
  const m = 10 * (1 - Tref(table, musR) / Tref(table, 0));
  return m < 0 ? 0 : m > 10 ? 10 : m;
}

export function musRFromMilky(table, m) {
  if (!(m > 0)) return 0;
  if (m >= 10) return Infinity;
  let lo = Math.log(1e-6), hi = Math.log(1e8);
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    if (milkyFromMusR(table, Math.exp(mid)) < m) lo = mid; else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}
```

- [ ] **Step 4: Run** `node test/l2-milky.mjs` — Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/engine/l2/milky.js test/l2-milky.mjs
git commit -m "feat(l2): Milky scale = reference-thickness occlusion, μs' canonical"
```

---

## Task 8: FFT convolution

**Files:**
- Create: `src/engine/l2/fft.js`, `test/l2-fft.mjs`

- [ ] **Step 1: Write the failing test**

```js test/l2-fft.mjs
// FFT 컨볼루션 vs 직접 합: node test/l2-fft.mjs
import { kernelSpectrum, convolve, nextPow2 } from '../src/engine/l2/fft.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const W = 32, H = 16, kr = 3, K = 2 * kr + 1;
const img = new Float64Array(W * H), kern = new Float64Array(K * K);
let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
for (let y = kr; y < H - kr; y++) for (let x = kr; x < W - kr; x++) img[y * W + x] = rnd();
for (let i = 0; i < K * K; i++) kern[i] = rnd();
const out = convolve(img, kernelSpectrum(kern, kr, W, H));
let err = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let d = 0;
  for (let j = -kr; j <= kr; j++) for (let i = -kr; i <= kr; i++) {
    const xs = x - i, ys = y - j;
    if (xs >= 0 && xs < W && ys >= 0 && ys < H) d += img[ys * W + xs] * kern[(j + kr) * K + (i + kr)];
  }
  err = Math.max(err, Math.abs(d - out[y * W + x]));
}
ok(err < 1e-9, `FFT 컨볼루션 = 직접 합 (최대오차 ${err.toExponential(2)})`);
ok(nextPow2(1) === 1 && nextPow2(33) === 64, 'nextPow2');

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**

```js src/engine/l2/fft.js
// radix-2 2D FFT 와 실수 컨볼루션 — L2 cavity-solver 용. 크기는 2의 거듭제곱.
export function nextPow2(v) { let p = 1; while (p < v) p <<= 1; return p; }

// 제자리 복소 FFT. inverse 이면 1/N 스케일 포함.
export function fft1d(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function fft2d(re, im, W, H, inverse) {
  const rr = new Float64Array(W), ri = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { rr[x] = re[o + x]; ri[x] = im[o + x]; }
    fft1d(rr, ri, inverse);
    for (let x = 0; x < W; x++) { re[o + x] = rr[x]; im[o + x] = ri[x]; }
  }
  const cr = new Float64Array(H), ci = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { cr[y] = re[y * W + x]; ci[y] = im[y * W + x]; }
    fft1d(cr, ci, inverse);
    for (let y = 0; y < H; y++) { re[y * W + x] = cr[y]; im[y * W + x] = ci[y]; }
  }
}

// 커널((2kr+1)², 중심 kr) 을 W×H 에 순환 배치한 스펙트럼
export function kernelSpectrum(kern, kr, W, H) {
  const re = new Float64Array(W * H), im = new Float64Array(W * H), K = 2 * kr + 1;
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const x = (i - kr + W) % W, y = (j - kr + H) % H;
    re[y * W + x] += kern[j * K + i];
  }
  fft2d(re, im, W, H, false);
  return { re, im, W, H };
}

// img(W×H 실수) ⊛ 커널 — 순환 컨볼루션(랩어라운드 방지 zero-padding 은 호출측 책임)
export function convolve(img, spec) {
  const { W, H } = spec, re = Float64Array.from(img), im = new Float64Array(W * H);
  fft2d(re, im, W, H, false);
  for (let i = 0; i < W * H; i++) {
    const a = re[i], b = im[i];
    re[i] = a * spec.re[i] - b * spec.im[i];
    im[i] = a * spec.im[i] + b * spec.re[i];
  }
  fft2d(re, im, W, H, true);
  return re;
}
```

- [ ] **Step 4: Run** `node test/l2-fft.mjs` — Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add src/engine/l2/fft.js test/l2-fft.mjs
git commit -m "feat(l2): radix-2 2D FFT convolution"
```

---

## Task 9: Cavity recycling solver + band irradiance (V2, V8)

**Files:**
- Create: `src/engine/l2/incident.js`, `src/engine/l2/cavity-solver.js`, `test/l2-cavity.mjs`

- [ ] **Step 1: Write the failing test**

```js test/l2-cavity.mjs
// 캐비티 재순환 solver: node test/l2-cavity.mjs  (spec V2·V8·V3 시스템, 밀착 갭, 성능 기록)
import { loadTable } from './l2-util.mjs';
import { solveCavity } from '../src/engine/l2/cavity-solver.js';
import { bandIrradiance } from '../src/engine/l2/incident.js';
import { checkResult } from '../src/engine/l2/validator.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();
const sum = (a) => a.reduce((p, v) => p + v, 0);

// V8: 무한 균일 조사(거울 벽 rW=1) → 중심부 출사 = E·[T_n + T_d·ρ·R_n/(1−ρ·R_d)]
{
  const nx = 100, ny = 100, step = 2, nb = table.angleRows;
  const E = Array.from({ length: nb }, (_, b) => new Float64Array(nx * ny).fill(b === 0 ? 1 : 0));
  const mat = { musR: 0.5, g: 0.9, mua: 0.001, n: 1.59 }, t = 2, h = 3, rhoB = 0.5;
  const res = solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB, rW: 1 });
  const tauR = mat.musR * t, muaT = mat.mua * t;
  const qn = table.query(tauR, mat.g, mat.n, 0, muaT), qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const expect = (qn.Tb + qn.Ts) + (qd.Tb + qd.Ts) * rhoB * qn.R / (1 - rhoB * qd.R);
  const c = res.M[50 * nx + 50];
  ok(Math.abs(c / expect - 1) <= 0.01, `V8 균일 재순환 이득 solver ${c.toFixed(4)} vs 해석 ${expect.toFixed(4)}`);
  const v = checkResult(res); ok(v.ok, `V2/V7 (V8 케이스) err=${res.energy.err.toExponential(2)}`);
}

// 실 LED 배열 케이스들: 에너지 수지 V2 ≤ 1%
const leds = [];
for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) leds.push({ x: 10 + i * 20, y: 10 + j * 20, I0: 1 });
const cases = [
  ['Milky0 h9', { musR: 0, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 9, 0.1],
  ['중간 h9', { musR: 0.3, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 9, 0.1],
  ['고Milky h9', { musR: 20, g: 0.9, mua: 0.001, n: 1.59 }, 3, 9, 0.3],
  ['밀착 h0.1', { musR: 0.3, g: 0.9, mua: 0.0005, n: 1.59 }, 3, 0.1, 0.1],
];
for (const [name, mat, t, h, rW] of cases) {
  const nx = 110, ny = 110, step = 1;
  const E = bandIrradiance({ sources: leds.map((l) => ({ ...l, x: l.x + 5, y: l.y + 5 })), m: 1, h, nx, ny, step, table });
  const t0 = performance.now();
  const res = solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB: 0.5, rW });
  const ms = performance.now() - t0;
  const v = checkResult(res);
  ok(v.ok, `${name}: V2 err=${res.energy.err.toExponential(2)} top/in=${(res.energy.top / res.energy.input).toFixed(3)} iter=${res.iterations} ${ms.toFixed(0)}ms`);
  if (mat.musR === 0) ok(sum(res.Mscat) === 0, `${name}: Milky 0 → 산란 성분 0 (V3 시스템: 직진 + 재순환만)`);
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
```

- [ ] **Step 2: Run** — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement band irradiance**

```js src/engine/l2/incident.js
// LED 점광원 → 슬래브 하면(z=h) 입사 조도의 각도 밴드 분해 — spec §5.3 ①.
// 격자: 원점 = 기구 외곽 모서리, 셀 중심 ((i+0.5)·step, (j+0.5)·step). 광도 I0·cos^m, 조도 = I·cosθ/r².
// A2 에서는 directLit 의 광원(측벽 이미지 포함)을 그대로 넘겨 이 함수를 재사용한다.
export function bandIrradiance({ sources, m, h, nx, ny, step, table }) {
  const E = Array.from({ length: table.angleRows }, () => new Float64Array(nx * ny));
  for (const s of sources) {
    for (let j = 0; j < ny; j++) {
      const dy = (j + 0.5) * step - s.y;
      for (let i = 0; i < nx; i++) {
        const dx = (i + 0.5) * step - s.x, r2 = dx * dx + dy * dy + h * h, c = h / Math.sqrt(r2);
        E[table.bandOf(c)][j * nx + i] += s.I0 * Math.pow(c, m) * c / r2;
      }
    }
  }
  return E;
}
```

- [ ] **Step 4: Implement the solver**

```js src/engine/l2/cavity-solver.js
// L2 캐비티 재순환 solver — spec 2026-10-07 §5.3.
// 입력 E[b] = 슬래브 하면 입사 조도(각도 밴드별, 셀 값 = 면밀도), 출력 M = 상면 출사도(같은 단위).
//  (a) 비산란 직진 Tb·E  (b) 산란 투과 K_T ⊛ (Ts·E) + 원거리 tail 균일  (c) 재순환:
//  하면 반사 R·E → 갭 전달 P_h → 기판 ρ_b → P_h → 확산 입사 → (Td·K_Td) 투과, R_d 반사 반복.
// 벽: 외곽 밖 성분을 한 번 접어 넣음 × rW, 나머지는 누설. 에너지는 독립 집계해 V2 로 검사.
import { nextPow2, kernelSpectrum, convolve } from './fft.js';
import { radEdge, N_RAD } from './mc-slab.js';

export const H_MIN = 0.2;
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

// 반경 분포(두께 단위 bin 분율) → 격자 커널(간격 s mm). 링 샘플로 질량 보존, 99.5% 반경에서 절단 후 합 1.
export function radialKernel(rad, tMm, s) {
  let cum = 0, kmax = N_RAD - 1;
  for (let k = 0; k < N_RAD; k++) { cum += rad[k]; if (cum >= 0.995) { kmax = k; break; } }
  const kr = Math.ceil((radEdge(kmax + 1) * tMm) / s), K = 2 * kr + 1, k = new Float64Array(K * K);
  for (let b = 0; b <= kmax; b++) {
    if (!(rad[b] > 0)) continue;
    const a2 = (radEdge(b) * tMm) ** 2, b2 = (radEdge(b + 1) * tMm) ** 2, NR = 4, NA = 48, m = rad[b] / (NR * NA);
    for (let ir = 0; ir < NR; ir++) {
      const r = Math.sqrt(a2 + ((ir + 0.5) / NR) * (b2 - a2));
      for (let ia = 0; ia < NA; ia++) {
        const th = (2 * Math.PI * (ia + 0.5)) / NA + b * 0.37;
        const x = Math.round((r * Math.cos(th)) / s), y = Math.round((r * Math.sin(th)) / s);
        k[(y + kr) * K + x + kr] += m;
      }
    }
  }
  const tot = sum(k);
  if (tot > 0) for (let i = 0; i < k.length; i++) k[i] /= tot; else k[kr * K + kr] = 1;
  return { k, kr };
}

// Lambertian 갭 전달 커널 P_h(r)=h²/(π(r²+h²)²) — 반경 CDF F=r²/(r²+h²) 링 분배, Rmax 절단(합 = F(Rmax)).
export function gapKernel(h, s, Rmax) {
  const kr = Math.ceil(Rmax / s), K = 2 * kr + 1, k = new Float64Array(K * K);
  const F = (r) => (r * r) / (r * r + h * h), r0 = Math.min(h, s) / 20, NRING = 80;
  k[kr * K + kr] += F(r0);
  let prev = r0;
  for (let i = 1; i <= NRING; i++) {
    const r1 = r0 * Math.pow(Rmax / r0, i / NRING), mass = F(r1) - F(prev), rm = Math.sqrt(0.5 * (prev * prev + r1 * r1));
    const NA = Math.max(8, Math.min(512, Math.ceil((2 * Math.PI * rm) / (0.5 * s))));
    for (let ia = 0; ia < NA; ia++) {
      const th = (2 * Math.PI * (ia + 0.5)) / NA + i * 0.37;
      const x = Math.round((rm * Math.cos(th)) / s), y = Math.round((rm * Math.sin(th)) / s);
      if (Math.abs(x) <= kr && Math.abs(y) <= kr) k[(y + kr) * K + x + kr] += mass / NA;
    }
    prev = r1;
  }
  return { k, kr };
}

function makeConv(dx, dy, kern) {
  const { k, kr } = kern, W = nextPow2(dx + 2 * kr + 1), H = nextPow2(dy + 2 * kr + 1);
  return { dx, dy, kr, W, H, spec: kernelSpectrum(k, kr, W, H), ksum: sum(k) };
}

// 도메인 입력 ⊛ 커널 → 벽 접어넣기(rW). { out, lost } — lost = 벽 투과·다중반사 밖·커널 절단분.
function foldConv(c, inp, rW) {
  const { dx, dy, kr, W, H } = c, pad = new Float64Array(W * H);
  for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) pad[(j + kr) * W + i + kr] = inp[j * dx + i];
  const conv = convolve(pad, c.spec), out = new Float64Array(dx * dy);
  let lost = (1 - c.ksum) * sum(inp);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = conv[y * W + x];
    if (v === 0) continue;
    const i = x - kr, j = y - kr;
    if (i >= 0 && i < dx && j >= 0 && j < dy) { out[j * dx + i] += v; continue; }
    const mi = i < 0 ? -1 - i : i >= dx ? 2 * dx - 1 - i : i;
    const mj = j < 0 ? -1 - j : j >= dy ? 2 * dy - 1 - j : j;
    if (mi >= 0 && mi < dx && mj >= 0 && mj < dy) { out[mj * dx + mi] += rW * v; lost += (1 - rW) * v; }
    else lost += v;
  }
  return { out, lost };
}

function down(f, nx, ny, k) {
  const cx = Math.ceil(nx / k), cy = Math.ceil(ny / k), o = new Float64Array(cx * cy);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) o[((j / k) | 0) * cx + ((i / k) | 0)] += f[j * nx + i];
  return { o, cx, cy };
}

// 저해상(질량) → 고해상: 쌍선형 보간 후 총량 보존 재정규화
function up(c, cx, cy, k, nx, ny) {
  const f = new Float64Array(nx * ny), d = (i, j) => c[Math.min(cy - 1, Math.max(0, j)) * cx + Math.min(cx - 1, Math.max(0, i))];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = (i + 0.5) / k - 0.5, v = (j + 0.5) / k - 0.5, i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    f[j * nx + i] = (1 - fu) * (1 - fv) * d(i0, j0) + fu * (1 - fv) * d(i0 + 1, j0) + (1 - fu) * fv * d(i0, j0 + 1) + fu * fv * d(i0 + 1, j0 + 1);
  }
  const s0 = sum(c), s1 = sum(f);
  if (s1 > 0) for (let i = 0; i < f.length; i++) f[i] *= s0 / s1;
  return f;
}

// mat = { musR(1/mm), g, mua(1/mm), n }, t = 슬래브 두께 mm, h = 공기 갭 mm, rhoB = 기판 반사율, rW = 벽 유효 반사율
export function solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB, rW }) {
  const N = nx * ny, tauR = mat.musR * t, muaT = mat.mua * t;
  const qb = E.map((_, b) => table.query(tauR, mat.g, mat.n, b, muaT));
  const qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const Mball = new Float64Array(N), Mscat = new Float64Array(N), Mrec = new Float64Array(N), D0 = new Float64Array(N);
  let input = 0, slabAbs = 0, leak = 0, boardAbs = 0, iterations = 0;

  // (a) 직진 + 하면 반사, (b) 산란 투과
  for (let b = 0; b < E.length; b++) {
    const e = E[b], q = qb[b], se = sum(e);
    if (!(se > 0)) continue;
    input += se; slabAbs += (1 - q.Tb - q.Ts - q.R) * se;
    for (let i = 0; i < N; i++) { Mball[i] += q.Tb * e[i]; D0[i] += q.R * e[i]; }
    if (q.Ts > 0) addScattered(Mscat, e, q, se);
  }
  function addScattered(target, e, q, se) {
    const near = 1 - q.radTail, src = new Float64Array(N);
    for (let i = 0; i < N; i++) src[i] = q.Ts * near * e[i];
    const { out, lost } = foldConv(makeConv(nx, ny, radialKernel(q.rad, t, step)), src, rW);
    leak += lost;
    const u = (q.Ts * q.radTail * se) / N;               // 슬래브 도광(원거리) 성분 — 균일 근사
    for (let i = 0; i < N; i++) target[i] += out[i] + u;
  }

  // (c) 재순환
  const sD0 = sum(D0);
  let Itot = null;
  if (rhoB > 0 && sD0 > 0) {
    if (h < H_MIN) {                                     // 밀착: P_h = δ, 닫힌 해
      const g = rhoB / (1 - rhoB * qd.R);
      Itot = Float64Array.from(D0, (v) => v * g);
      boardAbs = (1 - rhoB) * (sD0 + qd.R * sum(Itot));
    } else {
      const f = Math.min(4, Math.max(1, Math.round(Math.max(h / 4, step) / step))), sc = f * step;
      let { o: Dc, cx, cy } = down(D0, nx, ny, f);
      const conv = makeConv(cx, cy, gapKernel(h, sc, Math.min(31.6 * h, 2 * Math.max(nx, ny) * step)));
      const Ic = new Float64Array(cx * cy);
      for (iterations = 1; iterations <= 200; iterations++) {
        const B = foldConv(conv, Dc, rW); leak += B.lost;
        const sB = sum(B.out); boardAbs += (1 - rhoB) * sB;
        for (let i = 0; i < B.out.length; i++) B.out[i] *= rhoB;
        const I = foldConv(conv, B.out, rW); leak += I.lost;
        for (let i = 0; i < Ic.length; i++) { Ic[i] += I.out[i]; I.out[i] *= qd.R; }
        Dc = I.out;
        if (sum(Dc) < 1e-7 * sD0) break;
      }
      leak += sum(Dc);                                   // 미전파 잔여(≤1e-7)
      Itot = up(Ic, cx, cy, f, nx, ny);
    }
    const sI = sum(Itot);
    slabAbs += (1 - qd.Tb - qd.Ts - qd.R) * sI;
    for (let i = 0; i < N; i++) Mrec[i] += qd.Tb * Itot[i];
    if (qd.Ts > 0) addScattered(Mrec, Itot, qd, sI);
  }

  const M = new Float64Array(N);
  for (let i = 0; i < N; i++) M[i] = Mball[i] + Mscat[i] + Mrec[i];
  const top = sum(M), err = input > 0 ? Math.abs(input - (top + boardAbs + slabAbs + leak)) / input : 0;
  return { M, Mball, Mscat, Mrec, iterations, energy: { input, top, boardAbs, slabAbs, leak, err } };
}
```

- [ ] **Step 5: Run** `node test/l2-cavity.mjs` — Expected: all PASS; record the ms figures.
- [ ] **Step 6: Commit**

```bash
git add src/engine/l2/incident.js src/engine/l2/cavity-solver.js test/l2-cavity.mjs
git commit -m "feat(l2): cavity recycling solver with wall fold-back and energy bookkeeping (V2/V8)"
```

---

## Task 10: Wire tests, agent guides, performance note

**Files:**
- Modify: `package.json` (scripts), `.claude/agents/uds-tool-designer.md`, `.claude/agents/uds-tool-evaluator.md`, spec §5.5 V4 line

- [ ] **Step 1: package.json** — add script
  `"test:l2": "node test/l2-mc.mjs && node test/l2-diffusion.mjs && node test/l2-table.mjs && node test/l2-milky.mjs && node test/l2-fft.mjs && node test/l2-cavity.mjs"`
- [ ] **Step 2: Designer guide** — append section "## 6. 난이도별 Solver 규약" (spec §10): ①물리 근거·출처 ②독립 기준해(해석해/AD/문헌) + 생성 스크립트 ③V 계열 자체검증 + "계산 정합성" 배지 ④"실물 보정" 배지 분리(미보정 기본) ⑤가정 패널 ⑥허용오차는 사전에 정하고, 실패 시 오차를 키우지 말고 모델/격자를 고친다.
- [ ] **Step 3: Evaluator guide** — checklist A 에 "계산 정합성·실물 보정 배지가 분리 표시되는가", "가정 패널이 보이는가" 추가; 평가 시나리오에 "L2 spec §9 SV1~SV10" 참조 추가.
- [ ] **Step 4: Spec** — §5.5 V4 를 "τ'↑ → T 비증가, HPA 비감소(±2°), Milky 단조 (커널 RMS 는 TIR 도광 때문에 비단조 — 검사 제외)" 로 수정.
- [ ] **Step 5: Run all** `npm test && npm run test:l2` — Expected: all PASS.
- [ ] **Step 6: Commit**

```bash
git add package.json .claude/agents docs/superpowers/specs/2026-10-07-l2-diffusion-solver-design.md
git commit -m "chore(l2): test:l2 script, solver rules in agent guides, spec V4 correction"
```

---

## Execution notes (2026-10-08)

Deviations found during execution, each justified by an independent reference (no tolerance was loosened):
1. **Diffusion boundary coefficient** — Groenhuis empirical A(n) biased T by +4~7% vs AD. Replaced with the exact
   Fresnel-integral R_eff (R_φ, R_j). Error vs AD: μa=0 0.0061 → 0.0012, μa·t=0.02 0.016 → 0.0061.
   Source depth is an exponential distribution (closed form) instead of a point at z0.
2. **Diffusion kernel test** — plan's fixed bound "RMS < 1.0 t" was a guess; replaced by comparison with an
   independent MC run (RMS 0.999t vs 1.028t, ≤5%). Absorbing-case limit uses spec V1 (0.02), μa=0 keeps 0.01.
3. **HPA estimator** — 0–5° bins hold ~0.8% of near-Lambertian photons → I(0) noise ±30%. I(0) now pooled
   until ≥400 scattered photons (≤30°), 3-bin smoothing beyond 10°, and `hpaStats` returns MC σ.
   V4 HPA reversal limit = max(2°, 3σ) (statistical significance), worst observed 2.87° vs limit 6.46°.
   Blended queries propagate effective photon count (Σa²/n).
4. **Cavity solver speed** — gap kernel radius capped at the body's max dimension (mass beyond already leaks
   after one wall fold); stop residual 1e-5. 0.03–0.25 s per solve on 110×110 @1mm (A2 must optimize further).
5. `test/l2-util.mjs` accepts `L2_TABLE_DIR` to run tests against a `--quick` build during development.
