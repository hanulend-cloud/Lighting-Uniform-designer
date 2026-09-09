// 광도 분포 모델 (프로젝트.md §Stage1: Lambertian/Gaussian 선택)
// theta = LED 법선(+Z)으로부터의 각도 [rad]

const DEG = Math.PI / 180;

// I(theta) = cos^m(theta), 전각 FWHM 의 반각에서 I=0.5 가 되도록 m 산출
export function lambertianExponent(fwhmDeg) {
  const c = Math.cos((fwhmDeg / 2) * DEG);
  if (c <= 0 || c >= 1) return 1;
  return Math.log(0.5) / Math.log(c);
}

export function gaussianSigma(fwhmDeg) {
  return (fwhmDeg * DEG) / (2 * Math.sqrt(2 * Math.LN2));
}

// 상대 광도 (peak = 1)
export function relIntensity(model, theta, p) {
  if (theta >= Math.PI / 2) return 0;
  if (model === 'gaussian') return Math.exp(-(theta * theta) / (2 * p.sigma * p.sigma));
  return Math.pow(Math.max(0, Math.cos(theta)), p.m);
}

// 굴절률 n 슬래브의 2계면 수직입사 투과율 (프레넬)
export function fresnelT(n) {
  if (!n || n <= 1) return 1;
  const R = ((n - 1) / (n + 1)) ** 2;
  return (1 - R) * (1 - R);   // 진입 + 이탈
}

// 총 광속 Φ(lm) -> 축상 광도 I0(cd). fluxLm<=0 이면 상대 모드(I0=1)
export function axialIntensityFromFlux(fluxLm, model, p) {
  if (!fluxLm || fluxLm <= 0) return 1;
  if (model === 'gaussian') return fluxLm / (2 * Math.PI * p.sigma * p.sigma); // 소각 근사
  return (fluxLm * (p.m + 1)) / (2 * Math.PI);                                  // ∫cos^m dΩ = 2π/(m+1)
}
