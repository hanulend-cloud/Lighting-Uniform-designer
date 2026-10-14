// 중심부 우선 판정 테스트: node test/center.mjs
// 중심부 = 타겟 면적의 중심 95%(goal.centerArea) 영역 — 각 변 (1−√0.95)/2 ≈ 1.27% 안쪽. 목표 균일도는
// 중심부에서 판정하고 그중 LED 최소 배치를 고른다. 타겟 전체 min/max(fullPass)와 테두리 초과 밝기
// (rimBright)는 참고값으로 함께 보고한다.
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { metrics, centerZoneFrac } from '../src/engine/uniformity.js';
import { solveCombo } from '../src/engine/solver.js';
import { combinedEffect } from '../src/model/levels.js';
import { computeField, evalGrid } from '../src/engine/directLit.js';
import { initL2 } from '../src/engine/l2/runtime.js';
import { nodeLoader } from './l2-util.mjs';
await initL2(nodeLoader());   // L2 물리 solver 응답표 (spec 2026-10-07)

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

// 1) metrics 축별 마진: 4×4 필드, X 만 1셀 제외
{
  const nx = 4, ny = 4, f = new Float64Array(16).fill(1);
  f[0] = 0.1; f[3] = 0.1;              // 첫 행 양끝(X 가장자리) 어둡게
  const m = metrics(f, nx, ny, 0.34, 0);   // X 1셀 제외, Y 전체
  ok(Math.abs(m.minMax - 1) < 1e-9, `축별 마진(X만) 적용 → 가장자리 제외 min/max = ${m.minMax.toFixed(2)}`);
  const m2 = metrics(f, nx, ny, 0, 0.34);
  ok(m2.minMax < 0.2, `축별 마진(Y만) 적용 → X 가장자리 포함 min/max = ${m2.minMax.toFixed(2)}`);
}
// 2) 중심부 면적 95% → 축별 인셋 (1−√0.95)/2, 면적비 1 → 0
{
  const z = centerZoneFrac(0.95), f = (1 - Math.sqrt(0.95)) / 2;
  ok(Math.abs(z.fx - f) < 1e-12 && Math.abs(z.fy - f) < 1e-12, `면적 95% → 축별 인셋 ${(f * 100).toFixed(2)}% (${(z.fx * 100).toFixed(2)}%)`);
  ok(centerZoneFrac(1).fx === 0, '면적 100% → 인셋 0(타겟 전체)');
}
// 3) 사용자 L2 케이스(100×20, 깊이 7, 1mm 밀키 8.2, 측벽 Y 1mm): 중심부(95%)에서 목표 달성, 전체도 보고.
// 기준 재보정(2026-10-14, 형상 MC 점값 검증): 예전 목표 85%·LED ≤80 은 측벽을 '전 높이 거울'로 본 근사(가장자리 과대)의 산물.
// MC: 75개(피치 8×6) 중심부 77.5%, 115개 74.9% — 측벽 1mm 의 가장자리 줄이 상한이라 LED 를 늘려도 85% 불가.
// 48개(피치 10×10) MC 72.7% vs 확산벽 모델 74.4%. 목표 75% 로 판정 논리(중심부 우선·최소 LED)를 검사한다.
// 이 형상은 측벽이 슬래브 측방 확산 범위 안이라 가장자리 줄이 낙관(+~12%)될 수 있음 → 경고가 함께 나와야 한다.
{
  const spec = structuredClone(DEFAULT_SPEC);
  spec.target = { xLen: 100, yLen: 20, shape: 'flat' }; spec.goal.U0 = 0.75; spec.goal.edgeMargin = 0;
  spec.led.sizeX = 1; spec.led.sizeY = 1; spec.space.depth = 7; spec.levels[1].thk = 1;
  spec.levels[2] = { on: true, milky: 8.2, pcb: '혼재', decenterX: 0, decenterY: 0 };
  const r = solveCombo(spec, [1, 2]);
  ok(r.feasible && r.U0c >= 0.75, `중심부 목표 달성 (중심부 ${(r.U0c * 100).toFixed(1)}%, 전체 ${(r.U0 * 100).toFixed(1)}%)`);
  console.log(`  배치 ${r.nx}×${r.ny}, 피치 ${r.pitchX.toFixed(1)}×${(r.pitchY ?? r.pitchX).toFixed(1)}, LED ${r.leds}, 테두리 초과밝기 +${(r.rimBright * 100).toFixed(1)}%`);
  ok(r.leds <= 60, `중심부 목표를 만족하는 최소 LED (${r.leds} ≤ 60, 확산 측벽 물리 solver 기준)`);
  ok(r.l2ok === true, 'L2 계산 정합성 통과');
  ok(typeof r.fullPass === 'boolean', `타겟 전체 판정 참고값 보고 (fullPass=${r.fullPass})`);
  const eff = combinedEffect(spec, 7, [1, 2]), g = evalGrid(spec, 60);
  const f = computeField(spec, { depth: 7, pitchX: r.pitchX, pitchY: r.pitchY ?? r.pitchX, nx: g.nx, ny: g.ny, transmit: eff.transmit, padX: r.padX ?? 0, padY: r.padY ?? 0, l2: eff.l2 });
  ok(f.l2.warnings.some((w) => /측벽이 타겟 가장자리/.test(w)), `측벽 근접 경고 보고 (${f.l2.warnings.find((w) => /측벽/.test(w)) ?? '없음'})`);
}

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
