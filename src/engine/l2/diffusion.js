// L2 고 Milky(τ' > 10) 확산근사 — spec 2026-10-07 §5.2. 슬래브 확산방정식 + 외삽경계(내부 Fresnel).
// 길이는 두께 t 단위. T 는 산란 투과(비산란 성분은 τ'≥10 에서 e^{-τ} 로 무시 가능), R 은 정반사 포함.
import { fresnelR } from '../photometry.js';
import { N_RAD, radEdge, N_ANG, angEdgeDeg } from './mc-slab.js';

const DEG = Math.PI / 180;

// 내부 반사 유효계수 R_eff(n) 경험식(Groenhuis 1983) → 외삽거리 계수 A = (1+R_eff)/(1−R_eff)
export function boundaryA(n) {
  const Reff = -1.440 / (n * n) + 0.710 / n + 0.668 + 0.0636 * n;
  return (1 + Reff) / (1 - Reff);
}

// 입사 조건 → 진입 Fresnel 반사율, 굴절 후 평균 cos(첫 산란 깊이 z0 보정)
function entry(n, inc) {
  if (inc !== 'diffuse') {
    const sinT = Math.sqrt(1 - inc * inc) / n;
    return { Rf: fresnelR(inc, n), meanCos: Math.sqrt(1 - sinT * sinT) };
  }
  let R = 0, C = 0; const K = 400;
  for (let i = 0; i < K; i++) {
    const mu = (i + 0.5) / K, w = 2 * mu / K;            // Lambertian 입사 확률
    const r = fresnelR(mu, n), sinT = Math.sqrt(1 - mu * mu) / n;
    R += r * w; C += (1 - r) * Math.sqrt(1 - sinT * sinT) * w;
  }
  return { Rf: R, meanCos: C / (1 - R) };
}

function geom(tauR, muaT, n, inc) {
  const { Rf, meanCos } = entry(n, inc);
  const mut = muaT + tauR;
  return { Rf, zb: 2 * boundaryA(n) / (3 * mut), z0: Math.min(meanCos / mut, 0.5) };
}

// 전광선 투과 T, 반사 R(정반사 포함). muaT = μa·t, inc = 공기 중 입사 cos 또는 'diffuse'.
export function diffusionTR(tauR, muaT, n, inc) {
  // 산란원 = 깊이 지수분포 p(z) = a·e^{−az}, a = μt'/⟨cos⟩ (평균 깊이 z0). 점광원(z0)보다 얕은 경로의
  // 흡수를 정확히 반영 — 흡수 시 반사율 과소 추정을 해소(AD 대비 오차 0.017 → 검증값 참조).
  // 1D Green 함수(양 외삽경계 0) 를 p(z) 로 적분한 닫힌 해. τ' ≥ 10 이라 z>1 꼬리(e^{−a})는 무시.
  const { Rf, zb, z0 } = geom(tauR, muaT, n, inc);
  const Lp = 1 + 2 * zb, a = 1 / z0;
  const k = Math.sqrt(3 * muaT * (muaT + tauR));
  let T, Rd;
  if (k < 1e-9) { T = (z0 + zb) / Lp; Rd = (1 + zb - z0) / Lp; }
  else {
    const S = Math.sinh(k * Lp);
    T = 0.5 * a * (Math.exp(k * zb) / (a - k) - Math.exp(-k * zb) / (a + k)) / S;
    Rd = 0.5 * a * (Math.exp(k * (1 + zb)) / (a + k) - Math.exp(-k * (1 + zb)) / (a - k)) / S;
  }
  return { T: (1 - Rf) * T, R: Rf + (1 - Rf) * Rd };
}

// 출사면(z=1) 측방 플럭스 반경 분포 — 이미지 소스 급수(흡수 무시, 형상만). mc-slab 반경 bin 형식, 합 1.
export function diffusionKernel(tauR, n, inc) {
  const { zb, z0 } = geom(tauR, 0, n, inc);
  const Lp = 1 + 2 * zb, M = 12;
  const J = (rho) => {
    let s = 0;
    for (let m = -M; m <= M; m++) {
      const dp = 1 - (2 * m * Lp + z0), dm = 1 - (2 * m * Lp - 2 * zb - z0);
      s += dp / Math.pow(rho * rho + dp * dp, 1.5) - dm / Math.pow(rho * rho + dm * dm, 1.5);
    }
    return s / (4 * Math.PI);
  };
  const out = new Float64Array(N_RAD);
  for (let k = 0; k < N_RAD; k++) {
    const a = radEdge(k), b = radEdge(k + 1), S = 16;
    let acc = 0;
    for (let i = 0; i < S; i++) { const r = a + (b - a) * (i + 0.5) / S; acc += J(r) * 2 * Math.PI * r * (b - a) / S; }
    out[k] = Math.max(0, acc);
  }
  const tot = out.reduce((p, v) => p + v, 0);
  for (let k = 0; k < N_RAD; k++) out[k] /= tot;
  return out;
}

// 내부 등방 방사휘도의 Fresnel 투과 출사각 분포(bin 별 파워 분율, 합 1)
export function diffusionAngles(n) {
  const out = new Float64Array(N_ANG);
  for (let k = 0; k < N_ANG; k++) {
    const a = angEdgeDeg(k) * DEG, b = angEdgeDeg(k + 1) * DEG, S = 16;
    let acc = 0;
    for (let i = 0; i < S; i++) {
      const th = a + (b - a) * (i + 0.5) / S;
      acc += (1 - fresnelR(Math.cos(th), n)) * Math.cos(th) * Math.sin(th) * (b - a) / S;
    }
    out[k] = acc;
  }
  const tot = out.reduce((p, v) => p + v, 0);
  for (let k = 0; k < N_ANG; k++) out[k] /= tot;
  return out;
}
