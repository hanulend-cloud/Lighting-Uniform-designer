// L2 solver 자체검증 — spec 2026-10-07 §5.5 "계산 정합성" 배지의 근거.
// validateTable: 테이블 로드 시 1회(V1·V3·V4·V11). checkResult: cavity-solver 결과마다(V2·V7).
// 반환 { ok, checks:[{ id, ok, value, limit, note }] } — UI 는 하나라도 실패하면 "신뢰 불가".
import { hpaStats } from './slab-table.js';

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

  // V4: τ' 증가 → T 비증가(MC 잡음 허용 0.003), HPA 비감소 — 역전이 max(2°, 3σ) 를 넘으면 실패
  //     (σ = 두 추정치 MC 통계 불확도 합성. 근-Lambertian 평탄부에서 ±1~1.5° 요동은 통계 잡음)
  {
    const taus = [...G.tauR, 30, 50, 100, 300, 1000];
    let worstT = 0, worst = { ratio: 0, rev: 0, lim: 2, sig: 0 };
    for (const g of G.g) for (const row of [0, D]) {
      let pT = Infinity, pH = null;
      for (const t of taus) {
        const q = table.query(t, g, 1.59, row);
        worstT = Math.max(worstT, T(q) - pT); pT = Math.min(pT, T(q));
        if (row === 0) {
          const h = hpaStats(q);
          if (pH && pH.hpa > h.hpa) {
            const sig = Math.hypot(h.sigma, pH.sigma), lim = Math.max(2, 3 * sig), rev = pH.hpa - h.hpa;
            if (rev / lim > worst.ratio) worst = { ratio: rev / lim, rev, lim, sig };
          }
          if (!pH || h.hpa > pH.hpa) pH = h;
        }
      }
    }
    checks.push({ id: 'V4', ok: worstT <= 0.003 && worst.ratio <= 1, value: worstT, limit: 'ΔT≤0.003, ΔHPA≤max(2°,3σ)',
      note: `T 역전 ${worstT.toFixed(4)}, HPA 최대 역전 ${worst.rev.toFixed(2)}° (σ ${worst.sig.toFixed(2)}°, 한도 ${worst.lim.toFixed(2)}°)` });
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
