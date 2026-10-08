// L2 분석 방향(실측 → 계수 → Milky): node test/l2-fit.mjs  (spec §6.1, V6, V9)
// 합성 소재는 응답표를 거치지 않는 직접 MC(runSlab)로 만든다 — 피팅이 참 계수를 복원하는지 독립 확인.
import { loadTable } from './l2-util.mjs';
import { runSlab, totals, N_ANG, angEdgeDeg } from '../src/engine/l2/mc-slab.js';
import { fitMaterial, parseAngleCsv, predictSample } from '../src/engine/l2/fit.js';
import { hpaStats } from '../src/engine/l2/slab-table.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const table = loadTable();
const DEG = Math.PI / 180;

// 직접 MC 로 법선 입사 측정치 합성: T, R, HPA, 광도 곡선(bin 중심)
function synth({ musR, g, mua, n = 1.586 }, t, seed) {
  const rec = runSlab({ tau: (musR / (1 - g)) * t, g, n, inc: 1, N: 200000, seed });
  const o = totals(rec, mua * t);
  const sA = rec.ang.reduce((a, v) => a + v, 0);
  const q = { Tb: o.Tb, Ts: o.Ts, ang: Array.from(rec.ang, (v) => v / sA), nScat: sA };
  const curve = [];
  for (let k = 1; k < N_ANG; k++) {
    const a = angEdgeDeg(k), b = angEdgeDeg(k + 1), dO = 2 * Math.PI * (Math.cos(a * DEG) - Math.cos(b * DEG));
    curve.push({ theta: (a + b) / 2, v: (o.Ts * q.ang[k]) / dO });
  }
  return { t, T: o.Tb + o.Ts, R: o.R, hpa: hpaStats(q).hpa, curve, curveType: 'intensity' };
}

// 1) 합성 소재 2종 × 두께 1·2mm (T, R, 곡선) → 계수 복원 + V6 + V9
for (const truth of [{ musR: 0.6, g: 0.85, mua: 0.003 }, { musR: 2.0, g: 0.9, mua: 0.001 }]) {
  const entry = { name: 'synthetic', n: 1.586, samples: [synth(truth, 1, 11), synth(truth, 2, 12)] };
  const t0 = performance.now(); const f = fitMaterial(table, entry); const ms = performance.now() - t0;
  const e = Math.abs(f.mat.musR / truth.musR - 1);
  ok(e <= 0.1, `합성 μs'=${truth.musR}: 복원 ${f.mat.musR.toFixed(3)} (오차 ${(e * 100).toFixed(1)}%), g ${f.mat.g.toFixed(3)} / 참 ${truth.g}, μa ${f.mat.mua.toPrecision(2)} / 참 ${truth.mua}  [${ms.toFixed(0)} ms]`);
  ok(f.V6.ok, `  V6 재현: ${f.V6.note}`);
  ok(f.V9 && f.V9.ok, `  V9 교차두께: ${f.V9?.note}`);
  if (f.free.g) ok(Math.abs(f.mat.g - truth.g) <= 0.06, `  g 복원 ±0.06`);
}

// 2) 데이터시트만(T·HPA @2mm) — Covestro Makrolon DQ 브로셔: μa 고정, V6 재현
const DQ = [['DQ5122', 0.85, 19], ['DQ5142', 0.65, 43], ['DQ5162', 0.57, 56]];
let prevMilky = -1, mono = true;
for (const [name, T, hpa] of DQ) {
  const f = fitMaterial(table, { name, n: 1.586, samples: [{ t: 2, T, hpa }] });
  const p = f.predictions[0].pred;
  // DQ5122(HPA 19°·T 85%) 는 HG 위상함수로 재현 불가 — HG 에서는 T–HPA 관계가 g 와 거의 무관(유사성 법칙)해
  // HPA 19° 에서 T≈75% 가 한계. 좁은 전방 로브 + 낮은 손실은 큰 비드의 Mie 위상함수가 필요(단계 C).
  // 따라서 V6 이 "보정 불일치" 로 잡아내는 것이 정답 — 자체검증이 모델 한계를 숨기지 않는지 확인한다.
  const expectOk = name !== 'DQ5122';
  ok(f.V6.ok === expectOk, `${name}: V6 ${f.V6.ok ? '통과' : '불일치(예상: HG 한계)'} — T ${(p.T * 100).toFixed(1)}%(측정 ${(T * 100).toFixed(0)}%) HPA ${p.hpa.toFixed(1)}°(측정 ${hpa}°) → μs' ${f.mat.musR.toFixed(3)}/mm g ${f.mat.g.toFixed(2)} Milky ${f.milky.toFixed(2)}`);
  ok(!f.free.mua && f.notes.some((s) => s.includes('μa')), `  ${name}: R 미측정 → μa 고정 고지`);
  if (f.milky <= prevMilky) mono = false; prevMilky = f.milky;
}
ok(mono, 'DQ 확산 등급 순서(5122 < 5142 < 5162) = Milky 순서');

// 3) CSV 파서
{
  const c = parseAngleCsv('theta,intensity\n0, 1.0\n10\t0.9\n20;0.7\n# x\n');
  ok(c.length === 3 && c[2].theta === 20 && c[1].v === 0.9, 'CSV 파서(쉼표/탭/세미콜론, 헤더 무시)');
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
