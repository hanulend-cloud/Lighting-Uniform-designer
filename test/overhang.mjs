// 오버행(LED 배치 포함 전체 기구가 타겟보다 커지는 폭) 탐색 테스트: node test/overhang.mjs
// 제약: 기구 크기 ≤ 타겟 X·Y 각각 × (1 + opt.maxOverhang) — 각 변 오버행 ≤ maxOverhang·len/2.
// 후보 폭은 깊이 배수 mm(가장자리 저하 폭은 깊이가 결정)이되 축별 캡에서 잘린다.
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { solveCombo, overhangCandidates } from '../src/engine/solver.js';
import { computeField } from '../src/engine/directLit.js';
import { metrics } from '../src/engine/uniformity.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

// 1) 후보 생성: 축별 캡 준수, 깊이 배수, 캡 자체 포함
// X·Y 캡이 서로 달라야(비정방형 타겟) 깊이 배수 후보들이 서로 다른 값으로 남는다 — 기본 스펙이
// 정방형(100×100)이라도 이 축별-클리핑 동작 자체는 별도 타겟으로 명시 검증한다.
{
  const spec = structuredClone(DEFAULT_SPEC);
  spec.target = { xLen: 300, yLen: 120, shape: 'flat' };  // 300×120, 깊이 12, 캡 10%
  const c = overhangCandidates(spec);
  const capX = 0.10 * 300 / 2, capY = 0.10 * 120 / 2;   // 15 / 6 mm
  ok(c.every((p) => p.padX <= capX + 1e-9 && p.padY <= capY + 1e-9), `모든 후보가 축별 캡 이내 (X≤${capX}, Y≤${capY}mm)`);
  ok(c.some((p) => p.padX === 0 && p.padY === 0), '오버행 0 후보 포함');
  ok(c.some((p) => Math.abs(p.padX - capX) < 1e-9 && Math.abs(p.padY - capY) < 1e-9), '캡 최대 후보 포함');
  ok(c.some((p) => Math.abs(p.padX - 6) < 1e-9 && Math.abs(p.padY - 6) < 1e-9), '깊이 0.5배(6mm) 후보 포함');
  spec.opt.maxOverhang = 0;
  ok(overhangCandidates(spec).length === 1, '캡 0 → 후보 1개(오버행 없음)');
}

// 2) 기본 스펙(마진 0 = 타겟 전체 판정): 결과 기구 크기가 축별 +10% 이내, 표시 균일도 = 판정 균일도
{
  const spec = structuredClone(DEFAULT_SPEC);
  const r = solveCombo(spec, [1]);
  ok(spec.goal.edgeMargin === 0, '기본 판정제외 마진 = 0 (타겟 전체)');
  ok(r.fixtureX <= 1.1 * spec.target.xLen + 1e-9 && r.fixtureY <= 1.1 * spec.target.yLen + 1e-9,
    `기구 ${r.fixtureX.toFixed(0)}×${r.fixtureY.toFixed(0)} ≤ 타겟 ×1.1 (feasible=${r.feasible}, U0 ${(r.U0 * 100).toFixed(1)}%, LED ${r.leds})`);
  const f = computeField(spec, { depth: spec.space.depth, pitchX: r.pitchX, pitchY: r.pitchY ?? r.pitchX, padX: r.padX, padY: r.padY, nx: 201 });
  const m = metrics(f.field, f.nx, f.ny, 0);
  ok(Math.abs(m.minMax - r.U0) < 0.03, `타겟 전체 min/max 재계산 ${(m.minMax * 100).toFixed(1)}% ≈ 판정 ${(r.U0 * 100).toFixed(1)}%`);
}

// 3) 캡 0 → 오버행 없음
{
  const spec = structuredClone(DEFAULT_SPEC);
  spec.opt.maxOverhang = 0;
  const r = solveCombo(spec, [1]);
  ok(r.padX === 0 && r.padY === 0, '캡 0 → 오버행 0');
}

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
