// L2 체적 산란 슬래브 Monte Carlo (spec 2026-10-07 §5.1).
// 1D 무한 슬래브, 두께 1(무차원 — 길이는 모두 두께 t 단위). 산란만 추적(μa=0)하고 흡수는 런타임에
// 경로길이 히스토그램으로 적용한다(T(μa) = Σ w·exp(−μa·t·L)). HG 위상함수, 상·하면 비편광 Fresnel
// (TIR 포함), 탈출 시 가중치 분할(탈출분 기록 + 반사분 계속 추적), Russian roulette.
// Node·브라우저 공용 순수 함수 — 외부 의존 없음.

import { fresnelR } from '../photometry.js';

// 경로길이(t 단위) 로그 bin — 흡수 런타임 적용용. [L_MIN, L_MAX] 를 N_PATH 개로 나눔.
export const N_PATH = 32;
export const L_MIN = 0.5, L_MAX = 1e5;
const LOG_LMIN = Math.log(L_MIN), DLOG_L = (Math.log(L_MAX) - LOG_LMIN) / N_PATH;
export function pathBin(L) {
  const k = Math.floor((Math.log(Math.max(L, L_MIN)) - LOG_LMIN) / DLOG_L);
  return k < 0 ? 0 : k >= N_PATH ? N_PATH - 1 : k;
}
export function pathBinCenter(k) { return Math.exp(LOG_LMIN + (k + 0.5) * DLOG_L); }

// 투과(산란 성분) 측방 반경 bin: 경계 r_k = R_MAX·(k/N_RAD)² — 중심부 해상도 우선.
export const N_RAD = 40, R_MAX = 20;
export function radEdge(k) { return R_MAX * (k / N_RAD) ** 2; }
function radBin(r) {
  const k = Math.floor(Math.sqrt(r / R_MAX) * N_RAD);
  return k >= N_RAD ? -1 : k;   // R_MAX 밖은 버림(가중치는 Ts 총량에는 포함)
}

// 반사광 PCB 착지 반경(갭 h 단위) 분포를 저장하는 κ = t/h 격자. 착지 = κ·(하면 출사점, t 단위) + tanθ·(출사 방위) —
// 출사점 이동과 출사 방향은 같은 쪽으로 상관(전방 산란)되어, 둘을 독립으로 합성하면 착지가 중심에 1.3배 몰린다(진단 2026-10-13).
export const KAPPA = [0.03, 0.1, 0.3, 1], N_KAP = KAPPA.length;

// 투과(산란 성분) 출사각(공기 중) bin: 0~10° 1° 간격 10개 + 10~90° 5° 간격 16개 = 26.
export const N_ANG = 26;
export function angEdgeDeg(k) { return k <= 10 ? k : 10 + (k - 10) * 5; }
function angBin(deg) {
  const k = deg < 10 ? Math.floor(deg) : 10 + Math.floor((deg - 10) / 5);
  return k >= N_ANG ? N_ANG - 1 : k;
}

// 내부(굴절률 n) → 공기 계면 반사율. cosIn = 내부 입사각 코사인. TIR 이면 1.
export function fresnelInternal(cosIn, n) {
  if (n <= 1) return 0;
  const s = n * Math.sqrt(Math.max(0, 1 - cosIn * cosIn));
  if (s >= 1) return 1;
  return fresnelR(Math.sqrt(1 - s * s), n);   // Fresnel 반사율은 계면 양방향 동일
}

// 재현 가능한 PRNG (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleHG(g, u) {
  if (Math.abs(g) < 1e-6) return 2 * u - 1;
  const f = (1 - g * g) / (1 - g + 2 * g * u);
  return (1 + g * g - f * f) / (2 * g);
}

// 결과 레코드 생성
export function emptyRecord() {
  return {
    photons: 0,
    Tb: new Float64Array(N_PATH),   // 비산란 투과 — 경로길이 bin 별 가중치
    Ts: new Float64Array(N_PATH),   // 산란 투과
    R: new Float64Array(N_PATH),    // 반사(정반사 포함)
    TbL: new Float64Array(N_PATH),  // 위 세 채널의 bin 별 Σw·L — bin 평균 경로길이로 흡수 적용(bin 폭 오차 제거)
    TsL: new Float64Array(N_PATH),
    RL: new Float64Array(N_PATH),
    TsR2: new Float64Array(N_PATH), // 산란 투과의 bin 별 Σw·r² — 흡수가 측방 확산 폭을 줄이는 효과(긴 경로 = 먼 출사) 보정용
    rad: new Float64Array(N_RAD),   // 산란 투과의 측방 반경 분포(가중치)
    ang: new Float64Array(N_ANG),   // 산란 투과의 공기 중 출사각 분포(가중치)
    rRad: new Float64Array(N_RAD),  // 하면 내부 탈출(반사, 정반사 제외)의 측방 반경 분포 — 재순환 착지 커널용(형상 MC 진단 2026-10-13)
    rAng: new Float64Array(N_ANG),  // 같은 빛의 공기 중 출사각 분포 — 스치는 각도로 나와 PCB 에 h·tanθ 만큼 멀리 떨어진다
    radC: new Float64Array(N_RAD),  // 산란 투과의 측방 반경 분포 — 출사 x 가중 중앙값(xMed, 0) 기준. 입사점 기준 rad 를 시프트·축척하면
                                    // 경사 입사의 전방 산란 덩어리가 도넛이 되어 중심이 꺼진다(얇은 우유빛 진단 2026-10-13).
                                    // 평균은 멀리 도광된 꼬리에 끌려가(약산란에서 직진 출사점의 2~3배) 역시 도넛 — 중앙값은 덩어리에 붙는다.
    xMed: 0,                        // 위 중심(두께 단위)
    land: new Float64Array(N_KAP * N_RAD),   // 반사광 착지 반경(h 단위, radEdge bin) — κ 별 N_RAD 블록
    shift: 0,                       // 산란 투과 가중 평균 x 시프트(입사 방위 방향) — 합계, 정규화 전
    lost: 0,                        // roulette 손실(기댓값 보존이라 ≈0, 진단용)
  };
}

// 슬래브 MC 실행.
//   tau: 산란 광학두께 μs·t,  g: HG 비대칭,  n: 굴절률
//   inc: 입사각(공기 중) 코사인 μ ∈ (0,1] 또는 'diffuse'(Lambertian 입사)
//   N: 광자 수,  seed: 난수 시드
// onEscape(ch, x, y, L, w, scattered): 선택 — 탈출 광자마다 호출(분석·검증용, 기본 없음)
// phase: 선택 — { sample(u) → cosθ } 임의 위상함수(예: Mie 표). 없으면 HG(g).
export function runSlab({ tau, g, n, inc, N, seed = 1, onEscape, phase }) {
  const rec = emptyRecord();
  const rnd = rng(seed);
  let tsBuf = new Float64Array(3 * 4096), tsN = 0;   // 산란 투과 탈출 (x, y, w) — 끝에서 평균 시프트 기준 반경 분포
  const W_MIN = 1e-4, ROULETTE = 10;
  for (let p = 0; p < N; p++) {
    // 입사 방향(공기)
    const muAir = inc === 'diffuse' ? Math.sqrt(rnd()) : inc;
    const Rf = fresnelR(muAir, n);
    rec.R[0] += Rf;                                // 하면 정반사(경로길이 0 — RL 에 기여 없음)
    let w = 1 - Rf;
    const sinT = Math.sqrt(1 - muAir * muAir) / n;
    let ux = sinT, uy = 0, uz = Math.sqrt(1 - sinT * sinT);
    let x = 0, y = 0, z = 0, L = 0, scattered = false;
    while (w > 0) {
      // 자유 행로
      const s = tau > 0 ? -Math.log(1 - rnd()) / tau : Infinity;
      const zNext = z + s * uz;
      if (zNext > 1 || zNext < 0) {
        // 경계까지 이동
        const sb = uz > 0 ? (1 - z) / uz : -z / uz;
        x += sb * ux; y += sb * uy; L += sb; z = uz > 0 ? 1 : 0;
        const cosIn = Math.abs(uz);
        const Ri = fresnelInternal(cosIn, n);
        const wEsc = w * (1 - Ri);
        if (wEsc > 0) {
          if (onEscape) onEscape(z === 1 ? 'T' : 'R', x, y, L, wEsc, scattered, ux, uy, uz);   // 내부 진행 방향(탈출 직전) — 공기 방향 = 수평 ×n
          const k = pathBin(L);
          if (z === 1) {
            if (scattered) {
              rec.Ts[k] += wEsc; rec.TsL[k] += wEsc * L; rec.TsR2[k] += wEsc * (x * x + y * y);
              const r = Math.hypot(x, y), kr = radBin(r);
              if (kr >= 0) rec.rad[kr] += wEsc;
              rec.shift += wEsc * x;
              if (tsN + 3 > tsBuf.length) { const b = new Float64Array(tsBuf.length * 2); b.set(tsBuf); tsBuf = b; }
              tsBuf[tsN++] = x; tsBuf[tsN++] = y; tsBuf[tsN++] = wEsc;
              const sOut = n * Math.sqrt(Math.max(0, 1 - cosIn * cosIn));
              rec.ang[angBin(Math.asin(Math.min(1, sOut)) * 180 / Math.PI)] += wEsc;
            } else { rec.Tb[k] += wEsc; rec.TbL[k] += wEsc * L; }
          } else {
            rec.R[k] += wEsc; rec.RL[k] += wEsc * L;
            const kr = radBin(Math.hypot(x, y)); if (kr >= 0) rec.rRad[kr] += wEsc;
            const ax = ux * n, ay = uy * n, s2 = ax * ax + ay * ay;
            if (s2 < 1) {
              const tn = 1 / Math.sqrt(1 - s2);
              for (let c = 0; c < N_KAP; c++) { const kl = radBin(Math.hypot(KAPPA[c] * x + ax * tn, KAPPA[c] * y + ay * tn)); if (kl >= 0) rec.land[c * N_RAD + kl] += wEsc; }
            }
            const sOut = n * Math.sqrt(Math.max(0, 1 - cosIn * cosIn));
            rec.rAng[angBin(Math.asin(Math.min(1, sOut)) * 180 / Math.PI)] += wEsc;
          }
        }
        w *= Ri;
        uz = -uz;                                   // 내부 반사
        if (w < W_MIN) { if (rnd() * ROULETTE < 1) w *= ROULETTE; else { rec.lost += w; w = 0; } }
        continue;
      }
      // 산란
      x += s * ux; y += s * uy; z = zNext; L += s; scattered = true;
      const ct = phase ? phase.sample(rnd()) : sampleHG(g, rnd()), st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const phi = 2 * Math.PI * rnd(), cp = Math.cos(phi), sp = Math.sin(phi);
      if (Math.abs(uz) > 0.99999) {
        ux = st * cp; uy = st * sp; uz = Math.sign(uz) * ct;
      } else {
        const tmp = Math.sqrt(1 - uz * uz);
        const nx = st * (ux * uz * cp - uy * sp) / tmp + ux * ct;
        const ny = st * (uy * uz * cp + ux * sp) / tmp + uy * ct;
        const nz = -st * cp * tmp + uz * ct;
        ux = nx; uy = ny; uz = nz;
      }
    }
  }
  let sw = 0;
  const idx = new Uint32Array(tsN / 3);
  for (let i = 0; i < idx.length; i++) { idx[i] = i; sw += tsBuf[3 * i + 2]; }
  idx.sort((a, b) => tsBuf[3 * a] - tsBuf[3 * b]);
  let xm = 0;
  for (let i = 0, c = 0; i < idx.length; i++) { c += tsBuf[3 * idx[i] + 2]; if (c >= 0.5 * sw) { xm = tsBuf[3 * idx[i]]; break; } }
  rec.xMed = xm;
  for (let i = 0; i < tsN; i += 3) { const kr = radBin(Math.hypot(tsBuf[i] - xm, tsBuf[i + 1])); if (kr >= 0) rec.radC[kr] += tsBuf[i + 2]; }
  rec.photons = N;
  return rec;
}

// Σ_k w_k·exp(−μa t·L̄_k), L̄_k = bin 평균 경로길이. w·wL 는 가중치 합·Σw·L (같은 길이 배열).
export function attenuate(w, wL, muaT) {
  let s = 0;
  for (let k = 0; k < w.length; k++) {
    if (w[k] <= 0) continue;
    s += muaT ? w[k] * Math.exp(-muaT * wL[k] / w[k]) : w[k];
  }
  return s;
}
// 흡수(μa·t)를 경로길이로 적용한 총량. muaT = μa·t (무차원).
export function totals(rec, muaT = 0) {
  const N = rec.photons;
  return {
    Tb: attenuate(rec.Tb, rec.TbL, muaT) / N,
    Ts: attenuate(rec.Ts, rec.TsL, muaT) / N,
    R: attenuate(rec.R, rec.RL, muaT) / N,
  };
}
