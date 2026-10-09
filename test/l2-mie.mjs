// Mie 모듈·임의 위상함수 MC: node test/l2-mie.mjs  (spec §13 V10, 샘플러, 농도 환산)
import fs from 'node:fs';
import { bhmie, miePhase, particleOptics, musFromVolumeFraction, volumeFractionFromMus, wtFromVolume, volumeFromWt } from '../src/engine/l2/mie.js';
import { runSlab, totals, rng } from '../src/engine/l2/mc-slab.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

// V10: miepython 기준 (x 0.1~100, m 0.9~1.2, 흡수 1수준)
{
  const ref = JSON.parse(fs.readFileSync(new URL('../src/engine/l2/data/ref-mie.json', import.meta.url)));
  let wq = 0, wp = 0;
  for (const c of ref.cases) {
    const r = bhmie(c.x, c.mRe, c.mIm, c.mu);
    const i11 = r.S1.map((s, j) => 0.5 * (s[0] ** 2 + s[1] ** 2 + r.S2[j][0] ** 2 + r.S2[j][1] ** 2));
    wq = Math.max(wq, Math.abs(r.qext / c.qext - 1), Math.abs(r.qsca / c.qsca - 1), Math.abs(r.g - c.g));
    wp = Math.max(wp, ...i11.map((v, j) => Math.abs(v / i11[0] - c.i11rel[j]) / Math.max(c.i11rel[j], 1e-12)));
  }
  ok(wq <= 1e-4, `V10 Qext·Qsca·g vs miepython 최대 상대오차 ${wq.toExponential(2)} ≤ 1e-4 (${ref.cases.length} 케이스)`);
  ok(wp <= 1e-3, `V10 위상함수 모양 최대 상대오차 ${wp.toExponential(2)} ≤ 1e-3`);
}

// 위상함수 표: 수치 ⟨cosθ⟩ = g, 샘플러 평균 = g
for (const x of [5, 36]) {
  const ph = miePhase(x, 1.49 / 1.586);
  const r = rng(9); let s = 0; const N = 400000;
  for (let i = 0; i < N; i++) s += ph.sample(r());
  ok(Math.abs(ph.gNum - ph.g) < 2e-3 && Math.abs(s / N - ph.g) < 3e-3, `x=${x}: g ${ph.g.toFixed(4)} · 표 적분 ${ph.gNum.toFixed(4)} · 샘플 평균 ${(s / N).toFixed(4)}`);
}

// MC 위상함수 훅: HG 를 표 샘플러로 넣으면 해석 HG 와 같은 결과(잡음 내)
{
  const g = 0.9, K = 4096;
  const sample = (u) => { const f = (1 - g * g) / (1 - g + 2 * g * u); return (1 + g * g - f * f) / (2 * g); };
  const a = totals(runSlab({ tau: 10, g, n: 1.59, inc: 1, N: 60000, seed: 4 }));
  const b = totals(runSlab({ tau: 10, g, n: 1.59, inc: 1, N: 60000, seed: 4, phase: { sample } }));
  ok(Math.abs(a.Tb + a.Ts - b.Tb - b.Ts) < 1e-12 && Math.abs(a.R - b.R) < 1e-12, '위상함수 훅 = 내장 HG (같은 시드 → 동일)');
}

// 농도 환산 왕복: wt% → φ → μs → φ → wt%
{
  const opt = particleOptics({ d_um: 4, nP: 1.49, nH: 1.586 });
  const w = 0.012, phi = volumeFromWt(w, 1.19, 1.20), mus = musFromVolumeFraction(opt, phi);
  const back = wtFromVolume(volumeFractionFromMus(opt, mus), 1.19, 1.20);
  ok(Math.abs(back - w) < 1e-12 && mus > 0, `농도 왕복 1.2 wt% → μs ${mus.toFixed(2)}/mm → ${(back * 100).toFixed(3)} wt%`);
}

// 입자 피팅: 직접 MC(Mie 위상함수)로 만든 합성 측정(1·2mm, T·R·곡선) → μs' 복원, 참 지름이 식별 범위 안
{
  const { fitParticle, BEADS, HOST } = await import('../src/engine/l2/mie-material.js');
  const { loadTable } = await import('./l2-util.mjs');
  const { hpaStats } = await import('../src/engine/l2/slab-table.js');
  const { N_ANG, angEdgeDeg } = await import('../src/engine/l2/mc-slab.js');
  const table = loadTable(), opt = particleOptics({ d_um: 3, nP: 1.49, nH: 1.586 }), mus = 8, mua = 0.001, DEG = Math.PI / 180;
  const synth = (t, seed) => {
    const rec = runSlab({ tau: mus * t, g: opt.g, n: 1.586, inc: 1, N: 100000, seed, phase: opt.phase });
    const o = totals(rec, mua * t), sA = rec.ang.reduce((a, v) => a + v, 0), ang = Array.from(rec.ang, (v) => v / sA), curve = [];
    for (let k = 1; k < N_ANG; k++) { const a = angEdgeDeg(k), b = angEdgeDeg(k + 1); curve.push({ theta: (a + b) / 2, v: (o.Ts * ang[k]) / (2 * Math.PI * (Math.cos(a * DEG) - Math.cos(b * DEG))) }); }
    return { t, T: o.Tb + o.Ts, R: o.R, hpa: hpaStats({ Tb: o.Tb, Ts: o.Ts, ang, nScat: sA }).hpa, curve, curveType: 'intensity' };
  };
  const t0 = performance.now();
  const r = fitParticle(table, { n: 1.586, samples: [synth(1, 31), synth(2, 32)] }, BEADS.PMMA, HOST.PC);
  const truthR = mus * (1 - opt.g), e = Math.abs(r.fit.mat.musR / truthR - 1);
  ok(e <= 0.1 && r.dRange[0] <= 3 && r.dRange[1] >= 3 && r.fit.V6.ok,
    `입자 피팅: μs' ${r.fit.mat.musR.toFixed(4)} / 참 ${truthR.toFixed(4)} (오차 ${(e * 100).toFixed(1)}%), d ${r.d_um.toFixed(2)}µm 범위 ${r.dRange.map((v) => v.toFixed(1)).join('~')} ∋ 3 (χ²min ${r.chi2min.toFixed(1)}, dof ${r.dof}, Δχ² ${r.dChi.toFixed(1)}), V6 ${r.fit.V6.note} [${((performance.now() - t0) / 1000).toFixed(0)} s]`);
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
