// 장면 합성·실행(샘플 기구 + 샘플 LED STEP, 관측면 = Milky 커버 윗면): node test/mech3d-job.mjs
import initOpenCascade from 'opencascade.js/dist/node.js';
import { shapesToStepText } from '../src/export/oc-build.js';
import { readStepParts } from '../src/engine/shape/step-import.js';
import { setMech3dMesh, getMech3d, initialMech3dSpec } from '../src/engine/mech3d/runtime.js';
import { setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { findLeds, findEmitters, pcbIndex } from '../src/engine/mech3d/led-detect.js';
import { composeScene, runJob } from '../src/engine/mech3d/job.js';
import { recognizeLine, obsDirection } from '../src/engine/mech3d/line.js';
import { tallyGeometry, tallyStats } from '../src/engine/mech3d/tally.js';
import { buildSampleShapes } from './fixtures/mech3d-sample.mjs';
import { buildLedShapes } from './fixtures/mech3d-led-sample.mjs';
import { loadTable } from './l2-util.mjs';
import { ok, done } from './mech3d-util.mjs';

const oc = await initOpenCascade(), table = loadTable();
const mech = readStepParts(oc, shapesToStepText(oc, buildSampleShapes(oc)));
const ledParts = readStepParts(oc, shapesToStepText(oc, buildLedShapes(oc)));
setMech3dMesh('sample', mech);
const ms = initialMech3dSpec();
ms.parts[1] = setPartMaterialParam(setPartMaterial(ms.parts[1], 'milky'), 'milky', 3);   // 커버
ms.parts[2] = setPartMaterial(ms.parts[2], 'clear');                                      // 도광 바
// LED 인식: LED STEP 부품 중 PCB(최대 부피) 외 첫 LED 의 렌즈 윗면을 발광면으로
const ref = 1, refFace = (() => { let best = -1, z = -Infinity; const m = ledParts[ref]; for (let t = 0; t < m.triangles.length / 3; t++) { const zc = (m.positions[m.triangles[t * 3] * 3 + 2] + m.positions[m.triangles[t * 3 + 1] * 3 + 2] + m.positions[m.triangles[t * 3 + 2] * 3 + 2]) / 3; if (zc > z) { z = zc; best = m.faceIds[t]; } } return best; })();
const leds = findLeds(ledParts, ref), pcb = pcbIndex(ledParts, leds), em = findEmitters(ledParts, leds, ref, refFace, pcb);
ok(leds.length === 10 && pcb === 0 && em.every((e) => !e.needsCheck && Math.abs(e.axis[2] - 1) < 1e-6 && Math.abs(e.pos[2] - 3.5) < 1e-6), `샘플 LED STEP: LED ${leds.length}개, PCB 부품 ${pcb}, 발광 z ${em[0].pos[2].toFixed(3)}`);
ms.light = { ...ms.light, kind: 'step', step: { name: 'led', offset: [0, 0, 0], rot: [0, 0, 0], ref: { part: ref, face: refFace }, leds, pcb, emitters: em } };
// 관측면 = 커버(부품 1) 윗면: 법선 +z 이고 z 최대인 면
const coverTop = (() => { const m = mech[1]; let best = -1, z = -Infinity; for (let t = 0; t < m.triangles.length / 3; t++) { const z3 = [0, 1, 2].map((k) => m.positions[m.triangles[t * 3 + k] * 3 + 2]); if (Math.max(...z3) - Math.min(...z3) > 1e-6) continue; if (z3[0] > z) { z = z3[0]; best = m.faceIds[t]; } } return best; })();
ms.observe = { ...ms.observe, faces: [{ part: 1, face: coverTop }] };
const dir = obsDirection(mech, ms.observe.faces), line = recognizeLine(mech, ms.observe.faces, dir);
ok(line.kind === 'line' && Math.abs(line.length - 116) <= 0.2 && Math.abs(line.width - 16) <= 0.2, `관측 라인: ${line.kind} ${line.length.toFixed(2)}×${line.width.toFixed(2)}`);
const S = composeScene({ rt: getMech3d(), mspec: ms, ledParts, table, db: null, line });
ok(S.optics.length === mech.length + ledParts.length && !S.optics[mech.length].transmissive, `장면 합성: 부품 ${S.optics.length}개(기구 ${mech.length} + LED STEP ${ledParts.length})`);
// 이 테스트는 판정 수치가 아니라 배선(장면·광원·집계)을 본다 — 잡음을 줄이려고 원뿔 60°·셀 1mm·15만 광자(셀 0.5mm·6만 광자에서는 가장자리 셀 0 카운트로 폭 U=0 이 나옴)
const obs = { ...ms.observe, dir, cone: 60, cell: 1 }, G = tallyGeometry(line, obs);
const t0 = Date.now(), r = runJob({ S, line, obs, G, emitters: em, ledSpec: ms.light.spec, N: 150000, seed: 1, batches: 10 });
const st = tallyStats(G, r.accs, obs, r.cnts);
ok(r.ledger.lost === 0 && st.counted > 1000 && st.Ulen > 0 && st.Ulen < 1 && st.Uwid > 0, `계산: ${((Date.now() - t0) / 1000).toFixed(1)}s, 길이 U ${st.Ulen.toFixed(3)}±${st.seLen.toFixed(3)}, 폭 최저 U ${st.Uwid.toFixed(3)} @ ${st.sWorst.toFixed(1)}mm, lost ${r.ledger.lost}`);
// 대칭 점검: 기구·LED 가 x=60 대칭 → 길이 프로파일 좌·우 절반 합이 같아야 함(잡음 ~1%)
const p = st.profile, n = p.length; let lh = 0, rh = 0;
for (let i = 0; i < n; i++) if (Number.isFinite(p[i])) { if (i < n / 2) lh += p[i]; else rh += p[i]; }
ok(Math.abs(lh / rh - 1) < 0.03, `좌우 대칭: 왼쪽/오른쪽 절반 합 비 ${(lh / rh).toFixed(4)}`);
done();
