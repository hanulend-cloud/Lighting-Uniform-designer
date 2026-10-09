# Shape Body G0 — STEP Import Implementation Notes

Spec: `docs/superpowers/specs/2026-10-10-shape-body-solver-design.md` §3.1, §6, §7 G0.

## Delivered
- `src/engine/shape/step-import.js` — OCC: STEP → largest solid (others reported) → mesh (lin. deflection 0.01mm), face orientation & location applied.
- `src/engine/shape/heightfield.js` — mesh → 2.5D height map (cell 0.2mm, ≤1.5M cells): vertical-line/triangle crossings with
  top-left rule (no double counting on shared edges), z_t = max, z_b = min, crossings > 2 → non-2.5D fraction, odd crossings → open-shell suspicion.
  Orientation: flipZ (X-axis 180°, handedness kept), XY 90° steps. Origin = bbox centre, top max z = 0.
- `src/engine/shape/runtime.js` — current body, placement (bbox centre = target centre, top = depth), shape info & warnings
  (footprint < target, non-2.5D %, odd crossings, thin wall < max(1, baseThk/2) mm, height > depth), IndexedDB persistence.
- `src/engine/shape/shape-worker.js` — OCC from CDN in a module worker (same build as STEP export).
- UI: 기구 group [STEP 불러오기][Z 뒤집기][90°][평판으로] + info line; importing turns L3 on. Section view (`bodyProfile`) and plan view
  (thickness shading) draw the imported body. `spec.body.shape = {source, name, flipZ, rot}` (mesh not in JSON export).
- Fixture generator `tools/make-fixtures.mjs` → `test/fixtures/cover-dome-rib.stp` (dome R1500, ribs).

## Verification
- `npm run test:shape` (7/7): flat plate exact; dome top vs analytic sphere 0.0054mm; taper bottom 0.0010mm; tunnel non-2.5D 2.8% (exp. 3.0%);
  flipped file + flipZ identical; multi-solid picks largest; malformed file → clear error.
- Browser: fixture import via worker, info "110×110×5mm · 두께 0.99~4.89mm", thin-wall warning 4.1%, section shows dome/flat bottom,
  reload restores from IndexedDB.
- Finding during verification: first fixture (R1000 on 110mm) had a knife edge (sag 3.03mm > 3mm plate) — importer reported thickness 0 correctly;
  fixture fixed and a thin-wall warning added (useful DFM signal for mechanical designers).

## Not yet (by design)
- Optics still use the analytic L3 model — the UI states "광학 계산 반영은 다음 단계(S1·S2)". 3D iso view does not draw the imported body yet.
