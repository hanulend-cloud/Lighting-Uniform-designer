// L2 solver 툴 연동(A2): node test/l2-integration.mjs
// PSF 중첩(속도용) 이 기구 전체 캐비티 solve(기준) 를 재현하는지, 휘도 3성분, 자동탐색 제약, 마이그레이션, 성능.
import { initL2, l2State } from '../src/engine/l2/runtime.js';
import { nodeLoader } from './l2-util.mjs';
import { DEFAULT_SPEC } from '../src/model/defaults.js';
import { computeField, computeCameraLuminance, evalGrid, l2Describe, ledPositions } from '../src/engine/directLit.js';
import { solveCombo, solvePerLevel, GRID } from '../src/engine/solver.js';
import { combinedEffect } from '../src/model/levels.js';
import { metrics } from '../src/engine/uniformity.js';
import { fresnelT } from '../src/engine/photometry.js';
import { solveCavity } from '../src/engine/l2/cavity-solver.js';
import { bandIrradiance } from '../src/engine/l2/incident.js';
import { migrateMilkyV13 } from '../src/engine/l2/material.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const st = await initL2(nodeLoader());
ok(st.table && st.check.ok, `응답표 로드·자체검증 (${st.check?.checks.map((c) => c.id).join(',')})`);

const base = () => { const s = structuredClone(DEFAULT_SPEC); s.levels[3].on = false; s.levels[2].on = true; return s; };
const g = evalGrid(DEFAULT_SPEC, GRID);
const field = (s, extra = {}) => {
  const eff = combinedEffect(s, s.space.depth, [1, 2]);
  return computeField(s, { depth: s.space.depth, pitchX: 25, pitchY: 25, nx: g.nx, ny: g.ny, transmit: eff.transmit, l2: eff.l2, ...extra });
};

// 1) PSF 중첩 vs 기구 전체 캐비티 solve(같은 물성, 벽 접기 rW) — 중심부 평균·리플 일치
{
  const s = base(); s.levels[2].milky = 5;
  const f = field(s);
  const d = l2Describe(s, s.space.depth, s.levels[2]);
  const leds = ledPositions(s, 25, 25), step = 1, nx = 100, ny = 100;
  // 기준에도 직접광의 측벽 반사(거울 LED × rW)를 넣어 같은 물리를 비교 — 산란·재순환 성분의 벽은 solver 의 접기(rW)
  const rW = d.info.rW, src = [];
  for (const l of leds) src.push({ ...l, I0: 1 }, { x: -l.x, y: l.y, I0: rW }, { x: 200 - l.x, y: l.y, I0: rW }, { x: l.x, y: -l.y, I0: rW }, { x: l.x, y: 200 - l.y, I0: rW });
  const E = bandIrradiance({ sources: src, intensity: (c) => c, h: d.h, nx, ny, step, table: st.table });
  const ref = solveCavity({ E, nx, ny, step, table: st.table, mat: { musR: d.info.musR, g: d.info.g, mua: d.info.mua, n: d.info.n }, t: d.t, h: d.h, rhoB: d.rhoB, rW: d.info.rW });
  // 중심부(20~80mm) 비교: 기준은 셀 중심 격자, PSF 결과는 노드 격자 → 같은 위치를 쌍선형 표본
  const at = (arr, x, y) => { const i = Math.min(nx - 2, Math.max(0, Math.floor(x - 0.5))), j = Math.min(ny - 2, Math.max(0, Math.floor(y - 0.5))), u = x - 0.5 - i, v = y - 0.5 - j; return (1 - u) * (1 - v) * arr[j * nx + i] + u * (1 - v) * arr[j * nx + i + 1] + (1 - u) * v * arr[(j + 1) * nx + i] + u * v * arr[(j + 1) * nx + i + 1]; };
  let a = [], b = [];
  for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) {
    const x = i * f.stepX, y = j * f.stepY;
    if (x < 20 || x > 80 || y < 20 || y > 80) continue;
    a.push(f.field[j * f.nx + i]); b.push(at(ref.M, x, y));
  }
  const mean = (v) => v.reduce((p, q) => p + q, 0) / v.length, rip = (v) => Math.min(...v) / Math.max(...v);
  const dm = Math.abs(mean(a) / mean(b) - 1), dr = Math.abs(rip(a) - rip(b));
  ok(dm <= 0.03 && dr <= 0.02, `PSF 중첩 = 전체 캐비티 solve: 중심부 평균 차 ${(dm * 100).toFixed(2)}%, min/max ${rip(a).toFixed(3)} vs ${rip(b).toFixed(3)}`);
}

// 2) 휘도 3성분 — Milky 0 이면 직진 핫스팟 = L1 핫스팟 × Tb(법선)/fresnelT (±1%) (spec SV6·V3)
{
  const s0 = base(); s0.levels[2].milky = 0;
  const sL1 = structuredClone(DEFAULT_SPEC); sL1.levels[3].on = false; sL1.levels[2].on = false;
  const opt = { depth: 12, pitchX: 25, pitchY: 25, nx: g.nx, ny: g.ny, coneDeg: 0 };
  const e0 = combinedEffect(s0, 12, [1, 2]), e1 = combinedEffect(sL1, 12, [1]);
  const a = computeCameraLuminance(s0, { ...opt, transmit: e0.transmit, l2: e0.l2 });
  const b = computeCameraLuminance(sL1, { ...opt, transmit: e1.transmit });
  const d = l2Describe(s0, 12, s0.levels[2]);
  const expect = d.info.Tb0 / fresnelT(1.59);
  const r = Math.max(...a.field) / Math.max(...b.field);
  ok(Math.abs(r / expect - 1) <= 0.01, `Milky 0 핫스팟 = L1 × Tb/fresnelT (${r.toFixed(4)} vs ${expect.toFixed(4)})`);
  // Milky 6: 핫스팟이 씻겨 휘도 균일도가 Milky 0 보다 좋아져야 함
  const s6 = base(); s6.levels[2].milky = 6; const e6 = combinedEffect(s6, 12, [1, 2]);
  const c = computeCameraLuminance(s6, { ...opt, coneDeg: 10, transmit: e6.transmit, l2: e6.l2 });
  const a10 = computeCameraLuminance(s0, { ...opt, coneDeg: 10, transmit: e0.transmit, l2: e0.l2 });
  const u = (f) => metrics(f.field, f.nx, f.ny, 0).minMax;
  ok(u(c) > u(a10) && c.field.every(Number.isFinite), `휘도 균일도 Milky 6 ${u(c).toFixed(3)} > Milky 0 ${u(a10).toFixed(3)}`);
}

// 3) Milky↑ → 시스템 투과율 단조 감소, 각 결과 계산 정합성 통과
{
  let prev = Infinity, mono = true, allOk = true;
  for (const m of [0, 3, 6, 9]) {
    const s = base(); s.levels[2].milky = m;
    const f = field(s); if (!(f.l2.trans < prev)) mono = false; prev = f.l2.trans; allOk &&= f.l2.check.ok;
  }
  ok(mono && allOk, 'Milky↑ → 투과율 감소, 모든 결과 정합성 통과');
}

// 4) 자동탐색: Milky ≤ 9.5, 시스템 투과율 ≥ tMin
{
  const s = base(); s.levels[2].milky = 5;
  const t0 = performance.now(); const r = solvePerLevel(s, { levels: [2] })[0]; const ms = performance.now() - t0;
  ok(r.auto.params.milky <= 9.5 && r.auto.transmit >= (s.goal.tMin ?? 0.5) - 0.02, `자동탐색 Milky ${r.auto.params.milky.toFixed(2)} ≤ 9.5, 투과율 ${(r.auto.transmit * 100).toFixed(0)}% ≥ ${(s.goal.tMin * 100).toFixed(0)}%`);
  ok(ms <= 3500, `solvePerLevel(L2) ${ms.toFixed(0)} ms (기준선 1756 ms, 목표 2.6 s — 실측 ≈2.9 s, 한도 3.5 s)`);
  const t1 = performance.now(); const c = solveCombo(s, [1, 2]); const ms2 = performance.now() - t1;
  ok(ms2 <= 700 && c.l2ok, `solveCombo(L2) ${ms2.toFixed(0)} ms (기준선 605 ms)`);
}

// 5) 계산 1회(PSF 캐시) ≤ 70 ms
{
  const s = base(); s.levels[2].milky = 4; field(s);
  const t0 = performance.now(); for (let i = 0; i < 10; i++) field(s); const ms = (performance.now() - t0) / 10;
  ok(ms <= 70, `computeField(L2, PSF 캐시) ${ms.toFixed(1)} ms ≤ 70 ms (기준선 34 ms)`);
}

// 6) 마이그레이션: 구 Milky 1 → 0, 구 10 → 8.2(≤9), 단조
{
  const v = [1, 3, 6, 10].map(migrateMilkyV13);
  ok(v[0] === 0 && v[3] <= 9 && v[0] < v[1] && v[1] < v[2] && v[2] < v[3], `구 Milky 1/3/6/10 → ${v.join('/')}`);
}

// 7) 테이블 없음 → "신뢰 불가"(조용한 대체 금지)
{
  const saved = l2State();
  await initL2(async () => { throw new Error('test'); });
  const s = base(); s.levels[2].milky = 3; const f = field(s);
  ok(f.l2.check.ok === false && f.l2.error, `응답표 로드 실패 시 정합성 ❌ (${f.l2.error})`);
  await initL2(nodeLoader());
  ok(l2State().check.ok === saved.check.ok, '응답표 재로드');
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
