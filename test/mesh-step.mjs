// 삼각형 메쉬 → STEP 솔리드: node test/mesh-step.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { meshToStepText, meshesToStepText } from '../src/export/mesh-step.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { meshVolume } from '../src/engine/mech3d/mesh.js';
import { boxMesh, mergeMeshes, ok, done } from './mech3d-util.mjs';
import { frameHeights, deformPart, refineForBumps, splineInput, lineVarH } from '../src/engine/mech3d/shape-opt.js';
import { splineToStepText, partStepText } from '../src/export/spline-step.js';

const oc = await initOpenCascade(), m = boxMesh(0, 0, 0, 40, 10, 2);
const text = meshToStepText(oc, m);
const back = readStepParts(oc, text);
ok(/ISO-10303-21/.test(text) && back.length === 1 && back[0].faceCount === 6 && Math.abs(meshVolume(back[0].positions, back[0].triangles) - 800) < 0.5, `STEP 왕복: 부품 1개, 같은 평면 합침(면 6개), 부피 ${back.length ? meshVolume(back[0].positions, back[0].triangles).toFixed(2) : '–'}`);
{ // 여러 부품 → 한 STEP(부품마다 솔리드) — 파일 메뉴 '3D 기구 STEP 내보내기'
  const t2 = meshesToStepText(oc, [boxMesh(0, 0, 0, 40, 10, 2), boxMesh(0, 0, 5, 20, 10, 3)]), b2 = readStepParts(oc, t2);
  ok(b2.length === 2 && Math.abs(meshVolume(b2[1].positions, b2[1].triangles) - 600) < 0.5, `여러 부품 STEP: ${b2.length}개, 두 번째 부피 ${b2[1] ? meshVolume(b2[1].positions, b2[1].triangles).toFixed(1) : '–'}`); }
{ // 세분·변형 판 + 일직선(퇴화) 삼각형 1개 → STEP 왕복 부피 ±1%
  const frame = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, pl = boxMesh(0, 0, 0, 60, 40, 3), C = [[15, 20], [45, 20]], R = 9;
  const H = frameHeights(pl, frame, 0.5), d = deformPart(refineForBumps(pl, frame, C, R, R / 3, { H }), frame, H, { dt: 0.3, h: 0.8, R, centers: C });
  const nV = d.positions.length / 3, P = Float32Array.from([...d.positions, 0, 0, 3, 30, 0, 3, 60, 0, 3]);
  const mesh = { ...d, positions: P, triangles: Uint32Array.from([...d.triangles, nV, nV + 1, nV + 2]), faceIds: Uint32Array.from([...d.faceIds, 1]) };
  const want = meshVolume(d.positions, d.triangles), t0 = performance.now(), txt = meshToStepText(oc, mesh), ms = performance.now() - t0;
  const bk = readStepParts(oc, txt), got = bk.length === 1 ? meshVolume(bk[0].positions, bk[0].triangles) : NaN;
  ok(bk.length === 1 && Math.abs(got / want - 1) < 0.01, `세분·변형 판(삼각형 ${d.triangles.length / 3}개 + 퇴화 1개) STEP 왕복 부피 ${got.toFixed(2)} ≈ ${want.toFixed(2)} · ${ms.toFixed(0)} ms · ${(txt.length / 1024).toFixed(0)} KB`); }
{ // ③ 곡면 솔리드: 40×10×2 판, 포켓 h=0.5 R=4 중심 2곳 → B-스플라인 아랫면 솔리드 1개, 부피 = 해석값 ±1 %
  const F = { u: [1, 0, 0], v: [0, 1, 0], d: [0, 0, 1] }, pl = boxMesh(0, 0, 0, 40, 10, 2), R = 4, C = [[10, 5], [30, 5]];
  const prm = { frame: F, dt: 0, h: 0.5, R, centers: C, cell: 0.5 }, H = frameHeights(pl, F, 0.5), inp = splineInput(pl, H, prm);
  ok(inp && inp.grid.nx * inp.grid.ny <= 120 * 60 && inp.zTop === 2, `곡면 조건 통과(직사각형·평평한 윗면) · 격자 ${inp?.grid.nx}×${inp?.grid.ny}`);
  const want = 800 - 2 * 0.5 * Math.PI * R * R * (0.5 - 2 / Math.PI ** 2), t0 = performance.now(), txt = splineToStepText(oc, inp), ms = performance.now() - t0;
  const bk = readStepParts(oc, txt), got = bk.length === 1 ? meshVolume(bk[0].positions, bk[0].triangles) : NaN;
  ok(bk.length === 1 && Math.abs(got / want - 1) < 0.01 && txt.length < 200 * 1024 && /B_SPLINE_SURFACE/.test(txt), `곡면 STEP 부피 ${got.toFixed(2)} ≈ 해석 ${want.toFixed(2)} (${((got / want - 1) * 100).toFixed(3)} %) · ${ms.toFixed(0)} ms · ${(txt.length / 1024).toFixed(0)} KB`);
  // c = −0.3 + 곧은 경로(y = 5) — 기준 = 세분 변형 메쉬 부피
  const pc = { ...prm, c: -0.3, path: Array.from({ length: 41 }, (_, i) => [i, 5]), halfW: 5, closed: false, L: 40, ell: 10 };
  const dm = deformPart(refineForBumps(pl, F, C, R, R / 8, { H, hBottom: Math.min(0.5, lineVarH(pc)) }), F, H, pc), wc = meshVolume(dm.positions, dm.triangles);
  const t1 = performance.now(), tc = splineToStepText(oc, splineInput(pl, H, pc)), mc = performance.now() - t1, bc = readStepParts(oc, tc), gc = bc.length === 1 ? meshVolume(bc[0].positions, bc[0].triangles) : NaN;
  ok(bc.length === 1 && Math.abs(gc / wc - 1) < 0.01 && tc.length < 200 * 1024, `곡면 STEP(c=−0.3) 부피 ${gc.toFixed(2)} ≈ 변형 메쉬 ${wc.toFixed(2)} · ${mc.toFixed(0)} ms · ${(tc.length / 1024).toFixed(0)} KB`);
  // 돌린 관측 좌표(u = +y, v = −x) → 월드 외곽이 원래 판과 같아야
  const G = { u: [0, 1, 0], v: [-1, 0, 0], d: [0, 0, 1] }, pr = boxMesh(-10, 0, 0, 10, 40, 2), Hr = frameHeights(pr, G, 0.5);
  const br = readStepParts(oc, splineToStepText(oc, splineInput(pr, Hr, { ...prm, frame: G }))), P = br[0]?.positions ?? [];
  const bb = [0, 1, 2].map((k) => { let a = Infinity, b = -Infinity; for (let i = k; i < P.length; i += 3) { a = Math.min(a, P[i]); b = Math.max(b, P[i]); } return [a, b]; });
  ok(br.length === 1 && Math.abs(bb[0][0] + 10) < 0.01 && Math.abs(bb[0][1]) < 0.01 && Math.abs(bb[1][1] - 40) < 0.01 && Math.abs(bb[2][1] - 2) < 0.01 && Math.abs(meshVolume(br[0].positions, br[0].triangles) / want - 1) < 0.01, `돌린 관측 좌표 → 월드 외곽 x[${bb[0]?.map((v) => v.toFixed(2))}] y[${bb[1]?.map((v) => v.toFixed(2))}] z[${bb[2]?.map((v) => v.toFixed(2))}]`);
  // 조건 밖: L 자(채움률 < 0.98) → null
  const Lm = mergeMeshes([boxMesh(0, 0, 0, 40, 5, 2), boxMesh(0, 5, 0, 5, 5, 2)]);
  ok(splineInput(Lm, frameHeights(Lm, F, 0.5), prm) === null, 'L 자 외곽 → 곡면 조건 밖(null)');
  // 실패 → 메쉬 꿰매기로 대신 + note
  const bad = { ...inp, grid: { ...inp.grid, z: new Float64Array(inp.grid.z.length).fill(NaN) } }, r = partStepText(oc, { mesh: pl, spline: bad });
  ok(r.note === '곡면 맞춤 실패 — 삼각형으로 내보냄' && readStepParts(oc, r.stepText).length === 1, `곡면 실패 → 삼각형 대신(note: ${r.note})`);
  const r2 = partStepText(oc, { mesh: pl, spline: inp });
  ok(!r2.note && /B_SPLINE_SURFACE/.test(r2.stepText), '곡면 성공 → note 없음'); }
done();
