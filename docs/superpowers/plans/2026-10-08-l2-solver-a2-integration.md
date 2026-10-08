# L2 Solver A2 — Tool Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the heuristic L2 blur in the running tool with the A1 engine (spec rev.4 §5.3–5.6, §7, §12 A2): physical field, 3-component luminance, tMin-constrained auto search, two badges, assumptions panel, PCB colour, migration.

**Architecture — PSF method (decided in planning, measured):** the cavity is linear and shift-invariant apart from the walls. So `cavity-solver` is run **once per material/geometry** for a single LED on an open domain (2× body size, no walls) → system PSF `K` (direct + scattered + recycled) and its ballistic part `Kball`, cached. `computeField` then superposes `K` at LED positions exactly like the existing illuminance kernel, with walls as mirror LEDs weighted by the milky wall reflectance `R_w = R_diff(μs', g, μa, t)`, plus the far TIR-guided tail spread uniformly over the body. Per-evaluation cost ≈ existing kernel superposition.

**Baseline (old L2, 100×100, depth 12, milky 6):** computeField 34 ms, solveCombo 605 ms, solvePerLevel(L2 incl. auto) 1756 ms. **Targets:** L2 computeField (PSF cached) ≤ 70 ms, solvePerLevel(L2) ≤ 2.6 s.

**Deviations from spec (with reason):**
- Direct-light wall images use the constant milky-wall reflectance `R_w` instead of the per-ray Fresnel weight (one image model for direct + recycled light; walls are milky resin).
- L4 + L2: slab thickness = L1 thickness (warning shown); L3 + L2: area-mean thickness from `l3BotZAt`.
- LED emitter size ignored inside the PSF (point source); near-field handled by supersampling the irradiance near the LED.

---

## Task 1: Runtime loader + material resolution
- Create `src/engine/l2/runtime.js`: `initL2(loader)` (create table, `validateTable` once, keep `{table, check, error}`), `l2State()`, `browserLoader(base)` (fetch meta/bin/ref-ad).
- Create `src/engine/l2/material.js`: `L2_G=0.9`, `MUA_RESIN=0.0005`, `KAPPA=1e-4`, `PCB_REFL={혼재:0.5, 백색:0.8, 녹색:0.3, 흑색:0.05}`, `l2Material(table, milky, n)` (Milky ≥ 10 capped at 9.999 → finite μs').
- `test/l2-util.mjs`: add `nodeLoader()`.

## Task 2: PSF
- `incident.js`: accept `intensity(cos)` function, `I0`, origin `x0,y0`, and supersample cells near the source when `h < 2·step` (flux-conserving near field).
- `cavity-solver.js`: option `uniformTail=false` → return `tail` (mass) instead of spreading it; energy balance includes it.
- Create `src/engine/l2/psf.js`: `systemPsf({table, mat, t, h, rhoB, intensity, I0, extentX, extentY, step})` → `{K, Kball, tailFlux, trans, fScat, check, qn, qd, rW}` (cached by key; odd cell count, LED at centre, ≤255 cells/axis). `fScat` = normal-radiance factor of scattered+recycled light from table angular distributions (Lambertian = 1/π). `normalRadianceFactor(ang)` added to `slab-table.js`.

## Task 3: computeField / computeCameraLuminance
- `directLit.js computeField`: if `opt.l2` → `l2Field()` (PSF superposition + milky wall images + uniform tail), then remaining blur (L5) / `opt.transmit` / edgeBoost as before; **no `fresnelT`** (inside MC). Returns `l2: {trans, fieldBall, fScat, check, warnings, info}`.
- `computeCameraLuminance`: if `opt.l2` → hotspot × `Tb(normal)` × `opt.transmit` (no fresnelT, no blur), plus `fieldBall/π` cone mix and `(field − fieldBall)·fScat`.
- Export `l2Describe(spec, depth)` (material, τ', HPA, trans, rW, checks, warnings) for the UI.

## Task 4: levels / solver
- `levels.js`: L2 schema milky 0~9.9 step 0.1 (`searchMax: 9.5`), adv `pcb` select (fixed); default milky 0, pcb '혼재'; `levelEffect` case 2 → `{blurX:0, blurY:0, transmit:1, l2:{milky, pcb}, decenter…}`; `combinedEffect` passes `l2`; `extremeDiffusionParams` magnitude adds `l2.milky`, candidates bounded by `searchMax`.
- `solver.js evalField`: pass `l2`, return `trans`, `l2ok`; `pack`: `transmit = r.trans ?? eff.transmit`, `l2`, `l2ok`; `autoTuneLevel(2)`: cap max milky by `goal.tMin` (bisection on PSF transmittance).
- `geometry.js:30` tint `milky > 0.5`.

## Task 5: UI + defaults + migration
- `defaults.js`: `ver: 13`, `goal.tMin: 0.5`.
- `main.js`: `await initL2(browserLoader())` before first run; form row `goal.tMin`; `migrate` ver<13 converts old milky (equal occlusion of the old transmittance, clamp ≤ 9) and sets a one-time notice; after `updateLevels` call `renderL2Panel`.
- Create `src/ui/l2-panel.js`: badges (계산 정합성 ✅/❌ with V-list tooltip, 실물 보정: 미보정), property line (Milky · μs′ · τ′ · 시스템 투과율 · HPA), warnings, collapsible assumptions panel.
- `analysis.js`: L2 card gets `<div class="lv-l2">`; verdict: `diffusing` includes L2, brightness warning when L2 and transmit < tMin, "신뢰 불가" status when `l2ok === false`.
- `styles.css`: small badge/panel styles.

## Task 6: Tests
- Create `test/l2-integration.mjs`: init + table check; Milky 0 hotspot = L1 hotspot × Tb0/fresnelT (±1%, SV6/V3); Milky↑ → transmittance↓ and same-pitch uniformity↑; PSF V2/V7; auto-tune respects tMin and ≤9.5; migration; luminance finite; performance targets.
- Existing tests that exercise L2 (`smoke.mjs`, `center.mjs`): add `initL2(nodeLoader())`; re-baseline expectations only where the old heuristic produced them, documenting the new physical value.
- `npm test`, `npm run test:l2`, browser check (default + L2 on, both metrics).

---

## Execution notes (2026-10-08)

| 항목 | 기준선(구 L2) | 결과 | 목표 |
|---|---|---|---|
| computeField (PSF 캐시) | 34 ms | 11 ms | ≤ 70 ms ✅ |
| solveCombo (default + L2 milky 5) | 605 ms | 257~444 ms | — ✅ |
| solvePerLevel(L2, auto 포함) | 1756 ms | ≈2.7~2.9 s | ≤ 2.6 s ⚠ (+10%) |
| 브라우저 1회 재계산 (L1+L2+L3) | ≈6.0 s | 1.97 s | ≤ 2 s ✅ |

Optimizations (all exact or identity-preserving, verified): paired complex FFT for band convolutions (err 1e-14);
closed-form frequency-domain recycling for the open-domain PSF (vs iterative ≤3e-5 rel, V2 ≤1e-13);
closed-form infinite-plane transmittance for the tMin search; LED+mirror splat + FFT convolution with the PSF
(cost independent of LED count, no image cutoff); Milky bisection stops at 0.05.
Rejected: coarser PSF grid (−2% accuracy for ~10% speed).

Validation: PSF superposition with mirror walls reproduces a full-body cavity solve within 1.1% (central mean),
min/max 0.397 vs 0.393 (`test/l2-integration.mjs`). The first comparison differed 7.5% because the reference
lacked direct-light wall reflections — fixed in the reference, not the solver.

Physics outcome to communicate: a milky slab spreads light laterally only ~its thickness plus PCB recycling over the
air gap, so pitch ≈ depth is still needed (OD/pitch ≈ 1). Old heuristic overstated diffusion
(e.g. 100×20 depth 7: 36 → 75 LEDs; default 100×100 L2: 49 → 100 LEDs). `smoke.mjs`/`center.mjs` re-baselined with
migrated Milky (old 10 → 8.2) and documented.

Browser: verified via DOM (badges, property line, L3 warning, verdict transmittance). Screenshots unavailable —
the pane was not drawing (requestAnimationFrame paused), an environment condition.
Dev server moved to port 5174 (5173 is used by another local app).
