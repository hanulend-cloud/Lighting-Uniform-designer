// Mie 산란(구형 입자) — Bohren & Huffman BHMIE 알고리즘(Draine 판) 포팅. spec 2026-10-07 §6.2, V10.
// x = 2π·r·n_host/λ (크기변수), m = n_p/n_host (+ i·k, 흡수). 반환: Qext, Qsca, g, 위상함수 표·샘플러.
// 검증: tools/gen-ref-mie.py(miepython) 기준값과 상대오차 ≤ 1e-4 (test/l2-mie.mjs).

// 복소수 [re, im]
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const scl = (a, s) => [a[0] * s, a[1] * s];
const abs2 = (a) => a[0] * a[0] + a[1] * a[1];

// 계수 an, bn 과 효율 — mu 배열이 주어지면 S1·S2 도
export function bhmie(x, mRe, mIm = 0, mu = null) {
  const m = [mRe, mIm], mx = mul(m, [x, 0]);
  const nstop = Math.floor(x + 4.05 * Math.cbrt(x) + 2);
  const nmx = Math.max(nstop, Math.ceil(Math.hypot(mx[0], mx[1]))) + 15;
  const D = new Array(nmx + 1).fill(null).map(() => [0, 0]);
  for (let n = nmx; n >= 2; n--) { const nm = div([n, 0], mx); D[n - 1] = sub(nm, div([1, 0], add(D[n], nm))); }
  let psi0 = Math.cos(x), psi1 = Math.sin(x), chi0 = -Math.sin(x), chi1 = Math.cos(x);
  let xi1 = [psi1, -chi1];
  let qsca = 0, qext = 0, gsca = 0, an1 = null, bn1 = null;
  const K = mu ? mu.length : 0;
  const S1 = mu ? Array.from({ length: K }, () => [0, 0]) : null, S2 = mu ? Array.from({ length: K }, () => [0, 0]) : null;
  const pi0 = new Float64Array(K), pi1 = new Float64Array(K).fill(1);
  for (let n = 1; n <= nstop; n++) {
    const en = n, fn = (2 * en + 1) / (en * (en + 1));
    const psi = (2 * en - 1) * psi1 / x - psi0, chi = (2 * en - 1) * chi1 / x - chi0;
    const xi = [psi, -chi];
    const da = add(div(D[n], m), [en / x, 0]), db = add(mul(m, D[n]), [en / x, 0]);
    const an = div(sub(scl(da, psi), [psi1, 0]), sub(mul(da, xi), xi1));
    const bn = div(sub(scl(db, psi), [psi1, 0]), sub(mul(db, xi), xi1));
    qsca += (2 * en + 1) * (abs2(an) + abs2(bn));
    qext += (2 * en + 1) * (an[0] + bn[0]);
    gsca += fn * (an[0] * bn[0] + an[1] * bn[1]);
    if (n > 1) gsca += ((en - 1) * (en + 1) / en) * (an1[0] * an[0] + an1[1] * an[1] + bn1[0] * bn[0] + bn1[1] * bn[1]);
    if (mu) {
      for (let j = 0; j < K; j++) {
        const pi = pi1[j], tau = en * mu[j] * pi - (en + 1) * pi0[j];
        S1[j] = add(S1[j], scl(add(scl(an, pi), scl(bn, tau)), fn));
        S2[j] = add(S2[j], scl(add(scl(an, tau), scl(bn, pi)), fn));
        const pn = ((2 * en + 1) * mu[j] * pi - (en + 1) * pi0[j]) / en;   // π_{n+1}
        pi0[j] = pi; pi1[j] = pn;
      }
    }
    an1 = an; bn1 = bn;
    psi0 = psi1; psi1 = psi; chi0 = chi1; chi1 = chi; xi1 = [psi1, -chi1];
  }
  const g = (2 * gsca) / qsca;
  return { qsca: (2 / (x * x)) * qsca, qext: (2 / (x * x)) * qext, g, S1, S2, nstop };
}

// 위상함수 표 + 역CDF 샘플러. 각도 격자는 전방부를 촘촘히(θ = π·s², s 균등) — 큰 입자의 좁은 전방 피크 해상.
export function miePhase(x, mRe, mIm = 0, K = 2400) {
  const th = Float64Array.from({ length: K }, (_, i) => Math.PI * (i / (K - 1)) ** 2);
  const mu = Array.from(th, Math.cos);
  const r = bhmie(x, mRe, mIm, mu);
  const p = Float64Array.from({ length: K }, (_, j) => 0.5 * (abs2(r.S1[j]) + abs2(r.S2[j])));
  // CDF over μ (1 → −1): ∫ p dΩ ∝ ∫ p dμ
  const cdf = new Float64Array(K);
  for (let j = 1; j < K; j++) cdf[j] = cdf[j - 1] + 0.5 * (p[j] + p[j - 1]) * (mu[j - 1] - mu[j]);
  const tot = cdf[K - 1];
  for (let j = 0; j < K; j++) cdf[j] /= tot;
  // ⟨cosθ⟩ 수치 검산(= g 와 일치해야 함)
  let gNum = 0;
  for (let j = 1; j < K; j++) gNum += 0.5 * (p[j] * mu[j] + p[j - 1] * mu[j - 1]) * (mu[j - 1] - mu[j]);
  gNum /= tot;
  // 균등 u 역CDF 표(4096) — MC 샘플링 O(1)
  const NU = 4096, inv = new Float64Array(NU + 1);
  let j = 1;
  for (let k = 0; k <= NU; k++) {
    const u = k / NU;
    while (j < K - 1 && cdf[j] < u) j++;
    const f = cdf[j] > cdf[j - 1] ? (u - cdf[j - 1]) / (cdf[j] - cdf[j - 1]) : 0;
    inv[k] = mu[j - 1] + f * (mu[j] - mu[j - 1]);
  }
  const sample = (u) => { const t = u * NU, k = Math.min(NU - 1, t | 0), f = t - k; return inv[k] + f * (inv[k + 1] - inv[k]); };
  return { theta: th, p: Float64Array.from(p, (v) => v / tot), cdf, g: r.g, gNum, qsca: r.qsca, qext: r.qext, sample, inv };
}

// 입자 사양 → 단일 산란 특성. d_um: 지름 µm, nP·kP: 입자 굴절률, nH: 모재, lambda_um: 파장
export function particleOptics({ d_um, nP, kP = 0, nH, lambda_um = 0.55 }) {
  const x = Math.PI * d_um * nH / lambda_um;
  const ph = miePhase(x, nP / nH, kP / nH);
  const area = Math.PI * (d_um / 2) ** 2 * 1e-6;                  // mm²
  return { x, m: nP / nH, g: ph.g, qsca: ph.qsca, qext: ph.qext, sigmaS: ph.qsca * area, sigmaA: (ph.qext - ph.qsca) * area,
    vol: (Math.PI / 6) * (d_um * 1e-3) ** 3, phase: ph };          // σ: mm², vol: mm³
}

// 농도 ↔ μs (독립 산란, φ ≤ ~10 vol%). φ: 체적분율, rho: g/cm³
export function musFromVolumeFraction(opt, phi) { return (phi / opt.vol) * opt.sigmaS; }        // 1/mm
export function volumeFractionFromMus(opt, mus) { return (mus / opt.sigmaS) * opt.vol; }
export function wtFromVolume(phi, rhoP, rhoH) { return (phi * rhoP) / (phi * rhoP + (1 - phi) * rhoH); }
export function volumeFromWt(w, rhoP, rhoH) { return (w / rhoP) / (w / rhoP + (1 - w) / rhoH); }
