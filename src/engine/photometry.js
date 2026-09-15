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

// 공기(n=1) → 굴절률 n 매질 계면의 프레넬 반사율(비편광 = s·p 평균). cosI = 입사각의 코사인.
// 수직입사 ≈ ((n-1)/(n+1))² (PC 5%), 스침각으로 갈수록 1에 접근.
export function fresnelR(cosI, n) {
  if (!n || n <= 1) return 0;
  const c = cosI < 0 ? 0 : cosI > 1 ? 1 : cosI;
  const sinT = Math.sqrt(Math.max(0, 1 - c * c)) / n;
  const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
  const rs = (c - n * cosT) / (c + n * cosT);
  const rp = (cosT - n * c) / (cosT + n * c);
  return 0.5 * (rs * rs + rp * rp);
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

// directLit.js의 필드값은 광도(I0, cd)를 거리(od 등, mm 단위)로 나눠(E=I·cosθ/d²) 계산되므로
// fluxLm>0(절대 모드)일 때 단위가 cd/mm² 다 — 조도(lux=cd/m²)로 바꾸려면 (1000mm/m)²=1e6을
// 곱해야 한다. fluxLm<=0(상대 모드)일 때는 절대 단위가 의미 없으므로 호출측에서 이 값을
// 쓰지 않아야 한다(참고: 상대 모드는 field 값 자체가 임의 스케일이라 애초에 lux가 아님).
export const LUX_PER_FIELD_UNIT = 1e6;

// 램버시안 확산 출사면 가정: 그 면에 도달한 조도(E, lux)를 그대로 내보내는(투과율은 이미
// field 계산에 반영됨) 확산체의 휘도는 L(cd/m²) = E(lx)/π — 균일 확산판·디스플레이 백라이트
// 설계에서 표준적으로 쓰는 변환(비어링 램버트 법칙).
export function illuminanceToLuminance(lux) {
  return lux / Math.PI;
}
