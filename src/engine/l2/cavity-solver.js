// L2 캐비티 재순환 solver — spec 2026-10-07 §5.3.
// 입력 E[b] = 슬래브 하면 입사 조도(각도 밴드별, 셀 값 = 면밀도), 출력 M = 상면 출사도(같은 단위).
//  (a) 비산란 직진 Tb·E  (b) 산란 투과 K_T ⊛ (Ts·E) + 원거리 tail 균일  (c) 재순환:
//  하면 반사 R·E → 갭 전달 P_h → 기판 ρ_b → P_h → 확산 입사 → (Td·K_Td) 투과, R_d 반사 반복.
// 벽: 외곽 밖 성분을 한 번 접어 넣음 × rW, 나머지는 누설. 에너지는 독립 집계해 V2 로 검사.
import { nextPow2, kernelSpectrum, convolve, fft2d, kernelSpectrumPair, convolvePair } from './fft.js';
import { radEdge, N_RAD, N_ANG, angEdgeDeg, KAPPA, N_KAP } from './mc-slab.js';
import { fresnelR } from '../photometry.js';
import { bandIrradiance } from './incident.js';

export const H_MIN = 0.2;
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

// 반경 분포(두께 단위 bin 분율) → 격자 커널(간격 s mm). 링 샘플로 질량 보존, 99.5% 반경에서 절단 후 합 1.
export function radialKernel(rad, tMm, s) {
  let cum = 0, kmax = N_RAD - 1;
  for (let k = 0; k < N_RAD; k++) { cum += rad[k]; if (cum >= 0.995) { kmax = k; break; } }
  const kr = Math.ceil((radEdge(kmax + 1) * tMm) / s), K = 2 * kr + 1, k = new Float64Array(K * K);
  for (let b = 0; b <= kmax; b++) {
    if (!(rad[b] > 0)) continue;
    const a2 = (radEdge(b) * tMm) ** 2, b2 = (radEdge(b + 1) * tMm) ** 2, NR = 4, NA = 48, m = rad[b] / (NR * NA);
    for (let ir = 0; ir < NR; ir++) {
      const r = Math.sqrt(a2 + ((ir + 0.5) / NR) * (b2 - a2));
      for (let ia = 0; ia < NA; ia++) {
        const th = (2 * Math.PI * (ia + 0.5)) / NA + b * 0.37;
        const x = Math.round((r * Math.cos(th)) / s), y = Math.round((r * Math.sin(th)) / s);
        k[(y + kr) * K + x + kr] += m;
      }
    }
  }
  const tot = sum(k);
  if (tot > 0) for (let i = 0; i < k.length; i++) k[i] /= tot; else k[kr * K + kr] = 1;
  return { k, kr };
}

// Lambertian 갭 전달 커널 P_h(r)=h²/(π(r²+h²)²) — 반경 CDF F=r²/(r²+h²) 링 분배, Rmax 절단(합 = F(Rmax)).
export function gapKernel(h, s, Rmax) {
  const kr = Math.ceil(Rmax / s), K = 2 * kr + 1, k = new Float64Array(K * K);
  const F = (r) => (r * r) / (r * r + h * h), r0 = Math.min(h, s) / 20, NRING = 80;
  k[kr * K + kr] += F(r0);
  let prev = r0;
  for (let i = 1; i <= NRING; i++) {
    const r1 = r0 * Math.pow(Rmax / r0, i / NRING), mass = F(r1) - F(prev), rm = Math.sqrt(0.5 * (prev * prev + r1 * r1));
    const NA = Math.max(8, Math.min(512, Math.ceil((2 * Math.PI * rm) / (0.5 * s))));
    for (let ia = 0; ia < NA; ia++) {
      const th = (2 * Math.PI * (ia + 0.5)) / NA + i * 0.37;
      const x = Math.round((rm * Math.cos(th)) / s), y = Math.round((rm * Math.sin(th)) / s);
      if (Math.abs(x) <= kr && Math.abs(y) <= kr) k[(y + kr) * K + x + kr] += mass / NA;
    }
    prev = r1;
  }
  return { k, kr };
}

function makeConv(dx, dy, kern) {
  const { k, kr } = kern, W = nextPow2(dx + 2 * kr + 1), H = nextPow2(dy + 2 * kr + 1);
  return { dx, dy, kr, W, H, spec: kernelSpectrum(k, kr, W, H), ksum: sum(k) };
}

function padIn(inp, dx, dy, kr, W, H) {
  const pad = new Float64Array(W * H);
  for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) pad[(j + kr) * W + i + kr] = inp[j * dx + i];
  return pad;
}
// 패딩 영역의 컨볼루션 결과 → 도메인으로 벽 접어넣기(rW). 반환 lost(벽 투과·접기 밖).
function foldInto(conv, W, H, kr, dx, dy, rW, out) {
  let lost = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = conv[y * W + x];
    if (v === 0) continue;
    const i = x - kr, j = y - kr;
    if (i >= 0 && i < dx && j >= 0 && j < dy) { out[j * dx + i] += v; continue; }
    const mi = i < 0 ? -1 - i : i >= dx ? 2 * dx - 1 - i : i;
    const mj = j < 0 ? -1 - j : j >= dy ? 2 * dy - 1 - j : j;
    if (mi >= 0 && mi < dx && mj >= 0 && mj < dy) { out[mj * dx + mi] += rW * v; lost += (1 - rW) * v; }
    else lost += v;
  }
  return lost;
}

// 도메인 입력 ⊛ 커널 → 벽 접어넣기(rW). { out, lost } — lost = 벽 투과·다중반사 밖·커널 절단분.
function foldConv(c, inp, rW) {
  const { dx, dy, kr, W, H } = c, out = new Float64Array(dx * dy);
  const conv = convolve(padIn(inp, dx, dy, kr, W, H), c.spec);
  const lost = (1 - c.ksum) * sum(inp) + foldInto(conv, W, H, kr, dx, dy, rW, out);
  return { out, lost };
}

// 서로 다른 커널 두 개를 복소 FFT 한 번으로(정확) — 밴드별 산란 투과용
function foldConvPair(dx, dy, ka, kb, inA, inB, rW) {
  const kr = Math.max(ka.kr, kb.kr), W = nextPow2(dx + 2 * kr + 1), H = nextPow2(dy + 2 * kr + 1);
  const [sa, sb] = kernelSpectrumPair(ka.k, ka.kr, kb.k, kb.kr, W, H);
  const [ca, cb] = convolvePair(padIn(inA, dx, dy, kr, W, H), padIn(inB, dx, dy, kr, W, H), sa, sb);
  const outA = new Float64Array(dx * dy), outB = new Float64Array(dx * dy);
  const lost = (1 - sum(ka.k)) * sum(inA) + (1 - sum(kb.k)) * sum(inB)
    + foldInto(ca, W, H, kr, dx, dy, rW, outA) + foldInto(cb, W, H, kr, dx, dy, rW, outB);
  return { outA, outB, lost };
}

function down(f, nx, ny, k) {
  const cx = Math.ceil(nx / k), cy = Math.ceil(ny / k), o = new Float64Array(cx * cy);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) o[((j / k) | 0) * cx + ((i / k) | 0)] += f[j * nx + i];
  return { o, cx, cy };
}

// 저해상(질량) → 고해상: 쌍선형 보간 후 총량 보존 재정규화
function up(c, cx, cy, k, nx, ny) {
  const f = new Float64Array(nx * ny), d = (i, j) => c[Math.min(cy - 1, Math.max(0, j)) * cx + Math.min(cx - 1, Math.max(0, i))];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = (i + 0.5) / k - 0.5, v = (j + 0.5) / k - 0.5, i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    f[j * nx + i] = (1 - fu) * (1 - fv) * d(i0, j0) + fu * (1 - fv) * d(i0 + 1, j0) + (1 - fu) * fv * d(i0, j0 + 1) + fu * fv * d(i0 + 1, j0 + 1);
  }
  const s0 = sum(c), s1 = sum(f);
  if (s1 > 0) for (let i = 0; i < f.length; i++) f[i] *= s0 / s1;
  return f;
}

// mat = { musR(1/mm), g, mua(1/mm), n }, t = 슬래브 두께 mm, h = 공기 갭 mm, rhoB = 기판 반사율, rW = 벽 유효 반사율
// uniformTail=false: 원거리 도광 성분을 퍼뜨리지 않고 res.tail(질량)로 돌려준다(PSF 용 — 호출측이 기구 면적에 분배).
// gapRmax: 갭 전달 커널 절단 반경(mm) — 기본 = 도메인 최대 치수.
// 경사 입사 측방 시프트(단일 광원 PSF 전용, center = 광원 위치 mm): 출사 중심이 입사점보다 바깥(r → R = r + sh(r)).
// 밀도 역매핑: out(R) = in(r)·(r/R)·(dr/dR) — 셀 질량 밀어내기(splat)는 중심 셀이 이웃을 받지 못해 축소가 안 되므로 쓰지 않는다.
// 격자 밖으로 나간 질량·보간 오차는 lost(= 입력합 − 출력합)로 장부에 넣는다. (형상 MC VS6 로 확인된 PSF 결함 수정)
function radialShift(f, nx, ny, step, center, sh) {
  const out = new Float64Array(f.length), d = 1e-3;
  let sIn = 0, sOut = 0, Rmax = 0;
  for (let k = 0; k < f.length; k++) sIn += f[k];
  const at = (x, y) => {   // 셀 중심 격자 쌍선형
    const fa = x / step - 0.5, fb = y / step - 0.5, a0 = Math.floor(fa), b0 = Math.floor(fb), ta = fa - a0, tb = fb - b0;
    let v = 0;
    if (a0 >= 0 && b0 >= 0 && a0 < nx && b0 < ny) v += (1 - ta) * (1 - tb) * f[b0 * nx + a0];
    if (a0 + 1 >= 0 && b0 >= 0 && a0 + 1 < nx && b0 < ny) v += ta * (1 - tb) * f[b0 * nx + a0 + 1];
    if (a0 >= 0 && b0 + 1 >= 0 && a0 < nx && b0 + 1 < ny) v += (1 - ta) * tb * f[(b0 + 1) * nx + a0];
    if (a0 + 1 >= 0 && b0 + 1 >= 0 && a0 + 1 < nx && b0 + 1 < ny) v += ta * tb * f[(b0 + 1) * nx + a0 + 1];
    return v;
  };
  for (const [x, y] of [[0, 0], [nx * step, 0], [0, ny * step], [nx * step, ny * step]]) Rmax = Math.max(Rmax, Math.hypot(x - center.x, y - center.y));
  // 이동량은 반경 R 만의 함수 → 1차원 표로 역사상 r(R)·야코비안 J(R) 을 한 번 풀고 셀은 선형 보간(셀마다 뉴턴 반복 제거)
  const M = Math.max(256, Math.ceil(Rmax / (step * 0.25))), dR = Rmax / M, rT = new Float64Array(M + 1), JT = new Float64Array(M + 1);
  const g0 = 1 + (sh(d) - sh(0)) / d; JT[0] = 1 / (g0 * g0); rT[0] = 0;
  let r = 0;
  for (let i = 1; i <= M; i++) {
    const R = i * dR;
    for (let it = 0; it < 30; it++) {   // r + sh(r) = R (단조) — 뉴턴(직전 해에서 시작)
      const F = r + sh(r) - R, lo = Math.max(0, r - d), dF = 1 + (sh(r + d) - sh(lo)) / (r + d - lo);
      const nr = Math.max(0, r - F / dF);
      if (Math.abs(nr - r) < 1e-10) { r = nr; break; }
      r = nr;
    }
    const lo = Math.max(0, r - d), dRdr = 1 + (sh(r + d) - sh(lo)) / (r + d - lo);
    rT[i] = r; JT[i] = (r / R) / dRdr;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const X = (i + 0.5) * step - center.x, Y = (j + 0.5) * step - center.y, R = Math.hypot(X, Y);
    const fi = Math.min(M - 1e-9, R / dR), i0 = Math.floor(fi), u = fi - i0;
    const rr = rT[i0] * (1 - u) + rT[i0 + 1] * u, J = JT[i0] * (1 - u) + JT[i0 + 1] * u;
    const k = R > 1e-9 ? rr / R : 0;
    const v = at(center.x + X * k, center.y + Y * k) * J;
    out[j * nx + i] = v; sOut += v;
  }
  return { out, lost: sIn - sOut };
}

// 반사광 착지 커널: 하면 탈출점의 측방 반경 분포 rr(두께 단위 radEdge bin) ⊕ 갭 h 를 지나는 수평 이동 h·tanθ(출사각 분포 ra,
// angEdge bin) 의 2D 분포(상대 방위 등방 가정), 셀 간격 s, 반경 kr 셀 정사각 격자. mass = 격자 안 질량(절단 손실 집계용).
const _land = new Map();
export function landingKernel(rr, ra, h, t, s, kr) {
  let hk = 0; for (let k = 0; k < rr.length; k++) hk = (hk * 31 + Math.round(rr[k] * 1e6)) % 1e9; for (let k = 0; k < ra.length; k++) hk = (hk * 31 + Math.round(ra[k] * 1e6)) % 1e9;
  const key = `${hk}|${h.toPrecision(6)}|${t.toPrecision(6)}|${s.toPrecision(6)}|${kr}`;
  const hit = _land.get(key); if (hit) return hit;
  const Rmax = (kr + 0.5) * s, dR = s / 4, NB = Math.ceil(Rmax / dR) + 1, rad = new Float64Array(NB);
  let tot = 0;
  for (let i = 0; i < rr.length; i++) {
    if (!(rr[i] > 0)) continue;
    const r1 = 0.5 * (radEdge(i) + radEdge(i + 1)) * t;
    for (let j = 0; j < ra.length; j++) {
      if (!(ra[j] > 0)) continue;
      const w = rr[i] * ra[j]; tot += w;
      const th = Math.min(89.9, 0.5 * (angEdgeDeg(j) + angEdgeDeg(j + 1))) * Math.PI / 180, d = h * Math.tan(th);
      for (let q = 0; q < 32; q++) {
        const ph = (Math.PI * (q + 0.5)) / 32, R = Math.sqrt(r1 * r1 + d * d + 2 * r1 * d * Math.cos(ph)), b = Math.floor(R / dR);
        if (b < NB) rad[b] += w / 32;
      }
    }
  }
  const K = 2 * kr + 1, k = new Float64Array(K * K);
  for (let b = 0; b < NB; b++) {
    if (!(rad[b] > 0)) continue;
    const R = (b + 0.5) * dR, NA = Math.max(8, Math.ceil((2 * Math.PI * R) / (0.3 * s)));
    for (let a = 0; a < NA; a++) {
      const ph = (2 * Math.PI * (a + 0.5)) / NA, x = Math.round((R * Math.cos(ph)) / s) + kr, y = Math.round((R * Math.sin(ph)) / s) + kr;
      if (x >= 0 && y >= 0 && x < K && y < K) k[y * K + x] += rad[b] / NA / (tot || 1);
    }
  }
  const out = { k, kr, mass: sum(k) };
  if (_land.size > 32) _land.delete(_land.keys().next().value);
  _land.set(key, out);
  return out;
}

// 표 v3 착지 분포(land: κ=t/h 격자별 h 단위 반경 분포)로 착지 커널 — 출사점·방향 상관 보존. κ 는 로그 보간(격자 밖은 끝값).
// 없으면(v2 표·확산근사 칸 섞임) 독립 합성 landingKernel 로 대체. acc = { rr, ra, land, landOk } (정규화된 분포).
export function landK(acc, h, t, s, kr) {
  if (!acc.landOk || globalThis.__noLandV3) return landingKernel(acc.rr, acc.ra, h, t, s, kr);
  const kap = t / Math.max(h, 1e-3), lk = Math.log(Math.min(KAPPA[N_KAP - 1], Math.max(KAPPA[0], kap)));
  let c = 0; while (c < N_KAP - 2 && lk > Math.log(KAPPA[c + 1])) c++;
  const u = Math.min(1, Math.max(0, (lk - Math.log(KAPPA[c])) / (Math.log(KAPPA[c + 1]) - Math.log(KAPPA[c]))));
  const K = 2 * kr + 1, k = new Float64Array(K * K);
  for (let b = 0; b < N_RAD; b++) {
    const m = (1 - u) * acc.land[c * N_RAD + b] + u * acc.land[(c + 1) * N_RAD + b];
    if (!(m > 0)) continue;
    const a2 = (radEdge(b) * h) ** 2, b2 = (radEdge(b + 1) * h) ** 2, NR = 4;
    for (let ir = 0; ir < NR; ir++) {
      const R = Math.sqrt(a2 + ((ir + 0.5) / NR) * (b2 - a2)), NA = Math.max(8, Math.ceil((2 * Math.PI * R) / (0.3 * s)));
      for (let a = 0; a < NA; a++) {
        const ph = (2 * Math.PI * (a + 0.5)) / NA + b * 0.37, x = Math.round((R * Math.cos(ph)) / s) + kr, y = Math.round((R * Math.sin(ph)) / s) + kr;
        if (x >= 0 && y >= 0 && x < K && y < K) k[y * K + x] += m / (NR * NA);
      }
    }
  }
  return { k, kr, mass: sum(k) };
}

// 두께 단계(로컬 슬래브, 형상 몸체 S2b): tMap(셀별 두께)이 있으면 입사 광속 가중 범위를 K 단계로 나누고 셀 가중을 선형(모자) 보간 —
// 단계별 응답(Tb·Ts·R·커널)을 입사 위치의 국소 두께로 합성한다. 범위가 평균의 2% 이내면 단일(평균) 단계.
function thicknessLevels(tMap, E, N, maxLevels = 5) {
  let sw = 0, st = 0, tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < N; i++) {
    let e = 0; for (const b of E) e += b[i];
    if (!(e > 0)) continue;
    sw += e; st += e * tMap[i];
    if (tMap[i] < tmin) tmin = tMap[i]; if (tMap[i] > tmax) tmax = tMap[i];
  }
  const tm = sw > 0 ? st / sw : tMap[0];
  if (!(tmax - tmin > 0.02 * tm)) return [{ t: tm, w: null }];
  const K = Math.max(2, Math.min(maxLevels, Math.ceil((tmax - tmin) / (0.1 * tm)) + 1)), T = Array.from({ length: K }, (_, k) => tmin + ((tmax - tmin) * k) / (K - 1));
  return T.map((tk, k) => {
    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const f = ((tMap[i] - tmin) / (tmax - tmin)) * (K - 1), d = Math.abs(f - k);
      w[i] = d < 1 ? 1 - d : 0;
    }
    return { t: tk, w };
  });
}

// PCB 위 단위 광속 램버시안 점광원(중심)의 1차 응답 커널 — T(상면 출사), R(PCB 로 되돌아온 조도 = P_h ⊛ 확산 반사 + 정반사 2r 사상).
// 재료·두께·갭·격자별 캐시. fAbs·fLost = 방출 대비 슬래브 흡수·누설 비율(장부용).
const _lambert = new Map();
function lambertKernels({ nx, ny, step, table, mat, t, h, tMap, maxLevels, center, gapRmax, landDd = null }) {
  let tk = 0; if (tMap) for (let i = 0; i < tMap.length; i += 97) tk = (tk * 31 + Math.round(tMap[i] * 1000)) % 1e9;
  const key = [table.phaseKey ?? 'HG', mat.musR, mat.g, mat.mua, mat.n, t, h, step, nx, ny, center.x, center.y, maxLevels, tk, landDd ? 'Ld' : ''].map((v) => (typeof v === 'number' ? +v.toPrecision(7) : v)).join('|');
  let L = _lambert.get(key);
  if (L) return L;
  const E = bandIrradiance({ sources: [{ x: center.x, y: center.y, I0: 1 / Math.PI }], intensity: (c) => c, h, nx, ny, step, table });
  const r = solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB: 0, rW: 0, uniformTail: false, gapRmax, center, tMap, maxLevels, returnD: true, lambertRecycle: false });
  const krL = Math.ceil(Math.min(31.6 * h, gapRmax ?? Math.max(nx, ny) * step) / step), ra = r.rAcc;
  const gL = ra && ra.w > 0 ? landK(accNorm(ra), h, t, step, krL) : null;
  const gk = makeConv(nx, ny, landDd ?? gL ?? gapKernel(h, step, Math.min(31.6 * h, gapRmax ?? Math.max(nx, ny) * step)));
  const pd = foldConv(gk, r.D0, 0), R = pd.out;
  if (r.S) for (let i = 0; i < R.length; i++) R[i] += r.S[i];
  // 커널은 밀도(1/mm², 단위 방출 광속당) — 이산 합성곱(밀도 × 셀 면적 = 광속)에 쓰도록 셀 면적 s² 를 곱해 둔다.
  // (빠뜨리면 재순환이 1/s² 배 — s=0.94mm 에서 ×1.13 과대, 투과 +4%)
  const a = step * step, T = Float64Array.from(r.M, (v) => v * a);
  for (let i = 0; i < R.length; i++) R[i] *= a;
  const eT = sum(T), eR = sum(R), fAbs = r.energy.slabAbs * a;
  L = { T, R, eT, eR, fAbs, fLost: Math.max(0, 1 - eT - eR - fAbs) };
  if (_lambert.size > 24) _lambert.delete(_lambert.keys().next().value);
  _lambert.set(key, L);
  return L;
}

function accNorm(a) {   // rAcc → landK 입력(정규화). 착지 분포는 모든 반사 기여가 v3 일 때만
  const w = a.w || 1, lw = a.lw || 1;
  return { rr: Float64Array.from(a.rr, (v) => v / w), ra: Float64Array.from(a.ra, (v) => v / w), land: Float64Array.from(a.land, (v) => v / lw), landOk: a.lw > 0 && a.lw > a.w * (1 - 1e-9) };
}
export function solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB, rW, uniformTail = true, gapRmax, center = null, tMap = null, maxLevels = 5, specSplit = true, rKern = null, rdKern = null, lambertRecycle = !!globalThis.__lambertRecycle, returnD = false, landD = null, landDd = null }) {
  const N = nx * ny;
  const levels = tMap ? thicknessLevels(tMap, E, N, maxLevels) : [{ t, w: null }];
  if (tMap) t = levels.length === 1 ? levels[0].t : t ?? levels[Math.floor(levels.length / 2)].t;   // 재순환 대표 두께(호출측 t = 입사 가중 평균 권장)
  const tauR = mat.musR * t, muaT = mat.mua * t;
  const qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const Mball = new Float64Array(N), Mscat = new Float64Array(N), Mrec = new Float64Array(N), D0 = new Float64Array(N);
  let input = 0, slabAbs = 0, leak = 0, boardAbs = 0, iterations = 0, tail = 0;

  const rAcc = { w: 0, rr: new Float64Array(N_RAD), ra: new Float64Array(N_ANG), land: new Float64Array(N_KAP * N_RAD), lw: 0 };   // 하면 반사의 측방·각·착지 분포(반사량 가중, 표 v2/v3)
  // (a) 직진 + 하면 반사, (b) 산란 투과 (밴드 2개씩 복소 FFT 한 번으로) — 두께 단계마다
  for (const L of levels) {
    const tk = L.t, qb = E.map((_, b) => table.query(mat.musR * tk, mat.g, mat.n, b, mat.mua * tk));
    const jobs = [], MbL = new Float64Array(N);
    for (let b = 0; b < E.length; b++) {
      let e = E[b];
      if (L.w) { const ew = new Float64Array(N); for (let i = 0; i < N; i++) ew[i] = e[i] * L.w[i]; e = ew; }
      const q = qb[b], se = sum(e);
      if (!(se > 0)) continue;
      input += se; slabAbs += (1 - q.Tb - q.Ts - q.R) * se;
      for (let i = 0; i < N; i++) { MbL[i] += q.Tb * e[i]; D0[i] += q.R * e[i]; }
      // 착지 분포(rRad·rAng·land)는 정반사 제외 탈출만의 분포 → 가중도 정반사 뺀 반사량. q.R(정반사 포함) 가중은 정반사가 큰
      // 스치는 입사 행(전방으로 멀리 착지)을 과대 가중해 재순환 원거리 꼬리를 키운다(진단 2026-10-13, Milky 6 3mm 60mm +20%).
      const wR = Math.max(0, q.R - (b < table.angleRows ? fresnelR(table.grids.rows[b], mat.n) : 0)) * se;
      if (q.rRadOk) { const w = wR; rAcc.w += w; for (let k = 0; k < N_RAD; k++) rAcc.rr[k] += w * q.rRad[k]; for (let k = 0; k < N_ANG; k++) rAcc.ra[k] += w * q.rAng[k]; }
      if (q.landOk) { const w = wR; rAcc.lw += w; for (let k = 0; k < N_KAP * N_RAD; k++) rAcc.land[k] += w * q.land[k]; }
      if (q.Ts > 0) jobs.push(scatJob(e, q, se, center ? b : -1, tk, qb));
    }
    if (center) {   // 직진 성분: 기하 시프트 t·tanθ' (입사각 = 광원 기하에서 정확)
      const n = mat.n, r = radialShift(MbL, nx, ny, step, center, (rr) => {
        const s1 = rr / Math.hypot(rr, Math.max(h, 1e-3)) / n; return tk * s1 / Math.sqrt(1 - s1 * s1);
      });
      MbL.set(r.out); leak += r.lost;
    }
    for (let i = 0; i < N; i++) Mball[i] += MbL[i];
    runJobs(jobs, Mscat);
  }
  // 행 b 의 산란 투과 평균 시프트 / 직진 시프트(t·tanθ') 비 — 행 0(수직)은 0/0 이라 행 1 값 사용
  function fwdRatio(b, tk, qb, med = false) {
    const bb = Math.max(1, b), c = table.grids.rows[bb], s1 = Math.sqrt(1 - c * c) / mat.n, q = qb?.[bb] ?? table.query(mat.musR * tk, mat.g, mat.n, bb, mat.mua * tk);
    return (med ? q.xMed : q.shift) / (s1 / Math.sqrt(1 - s1 * s1));
  }
  function scatJob(e, q, se, b = -1, tk = t, qb = null) {
    const near = 1 - q.radTail;
    let src = new Float64Array(N);
    for (let i = 0; i < N; i++) src[i] = q.Ts * near * e[i];
    let scale = 1;
    if (b >= 0) {
      // 출사 중심을 바깥으로 옮김: 셀 입사각(광원 기하)의 직진 시프트 t·tanθ' × 행의 전방 비(MC 평균 시프트 / 직진 시프트).
      // 작은 입사각도 r·(1 + t/(n·h)) 확대가 생기므로 행 상수 시프트(0° 행 = 0)로는 중심이 과집중된다(VS6).
      // 반경 분포(입사점 기준 |Δr|)는 2차 모멘트 보존 축소: <ρ²> = <r²> − shift_b² → 축척 √(<ρ²>/<r²>)
      const v3 = q.radCOk && !globalThis.__noRadC;   // 표 v3: 출사 중앙값 중심 + 그 기준 반경 분포(축척 불필요)
      const f = fwdRatio(b, tk, qb, v3), shift = q.shift * tk, hh = Math.max(h, 1e-3);
      const r = radialShift(src, nx, ny, step, center, (rr) => { const s1 = rr / Math.hypot(rr, hh) / mat.n; return f * tk * s1 / Math.sqrt(1 - s1 * s1); });
      src = r.out; leak += r.lost;
      let m2 = 0, m0 = 0;
      for (let k = 0; k < N_RAD; k++) { const rr = 0.5 * (radEdge(k) + radEdge(k + 1)) * tk * (q.radScale || 1); m2 += q.rad[k] * rr * rr; m0 += q.rad[k]; }
      if (m2 > 0) scale = Math.sqrt(Math.max(0.05, 1 - (shift * shift) / (m2 / m0)));
      if (v3) return finishJob(src, q, se, radialKernel(q.radC, tk * (q.radScale || 1), step));
    }
    return finishJob(src, q, se, radialKernel(q.rad, tk * (q.radScale || 1) * scale, step));   // 흡수 측방 축소 반영
  }
  function finishJob(src, q, se, kern) {
    const tm = q.Ts * q.radTail * se;                    // 슬래브 도광(원거리) 성분 — 균일 근사
    if (!uniformTail) tail += tm;
    return { src, kern, u: uniformTail ? tm / N : 0 };
  }
  function runJobs(list, target) {
    for (let k = 0; k < list.length; k += 2) {
      const a = list[k], b = list[k + 1];
      if (b) {
        const r = foldConvPair(nx, ny, a.kern, b.kern, a.src, b.src, rW);
        leak += r.lost;
        for (let i = 0; i < N; i++) target[i] += r.outA[i] + r.outB[i] + a.u + b.u;
      } else {
        const r = foldConv(makeConv(nx, ny, a.kern), a.src, rW);
        leak += r.lost;
        for (let i = 0; i < N; i++) target[i] += r.out[i] + a.u;
      }
    }
  }

  // (c) 재순환
  // 바닥 반사의 정반사 분리(단일 광원 PSF, 열린 영역): 슬래브 하면 Fresnel 정반사는 거울 방향으로 내려가 PCB 의 반경 2r 에 떨어진다
  // (램버시안으로 입사점 아래 P_h 로 퍼뜨리면 재순환이 LED 가까이 몰림 — 형상 MC 대비 Milky 3 중간거리 +5%·원거리 −15%, VS7M).
  // D0 = 확산(후방산란) 반사만 남기고, 정반사분 S 는 PCB 면에 직접(반경 ×2 사상) 넣는다.
  let S = null;
  if (center && specSplit && rW === 0 && h >= H_MIN && (rhoB > 0 || returnD)) {
    const Ds = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, r = Math.hypot((i + 0.5) * step - center.x, (j + 0.5) * step - center.y);
      let e = 0; for (const b of E) e += b[k];
      const v = Math.min(D0[k], e * fresnelR(h / Math.hypot(r, h), mat.n));
      Ds[k] = v; D0[k] -= v;
    }
    const r = radialShift(Ds, nx, ny, step, center, (rr) => rr);   // R = 2r
    S = r.out; leak += r.lost;
  }
  // 내부 반사(후방산란·도광 후 하면 탈출)의 측방 분포 rKern(두께 단위 반경 분포) — 있으면 입사점 대신 그 분포로 퍼뜨림
  if (rKern) { const r = foldConv(makeConv(nx, ny, radialKernel(rKern, t, step)), D0, rW); D0.set(r.out); leak += r.lost; }
  const sD0 = sum(D0) + (S ? sum(S) : 0);
  let Itot = null;
  // 재순환(단일 광원 PSF, 열린 영역): PCB 위 램버시안 점광원의 응답을 LED 와 같은 1차 투과 기계장치(입사각 밴드·바깥 이동·
  // 정반사 분리)로 계산한 커널 T_L(출사)·R_L(PCB 로 되돌아옴)로 닫힌 해 — B = B0/(1 − ρ R̂_L), M_rec = ρ T̂_L·B.
  // 예전 '확산(램버시안) 입사 + 입사점 출사' 재순환은 PCB 에서 비스듬히 들어오는 빛의 바깥 이동을 빠뜨려 재순환이
  // LED 가까이 몰렸다(형상 MC 대비 Milky 3: 중간거리 +4%, 원거리 −12%).
  let lambertDone = false;
  if (center && lambertRecycle && rW === 0 && rhoB > 0 && h >= H_MIN && sD0 > 0) {
    const L = lambertKernels({ nx, ny, step, table, mat, t, h, tMap, maxLevels, center, gapRmax, landDd });
    // 하면 내부 반사의 PCB 착지: landD(반사광 착지 커널: 측방 탈출 + h·tanθ, 질량 1) 가 있으면 그것, 없으면 램버시안 P_h
    const krL = Math.ceil(Math.min(31.6 * h, gapRmax ?? Math.max(nx, ny) * step) / step);
    const gL = rAcc.w > 0 ? landK(accNorm(rAcc), h, t, step, krL) : null;
    const gk = makeConv(nx, ny, landD ?? gL ?? gapKernel(h, step, Math.min(31.6 * h, gapRmax ?? Math.max(nx, ny) * step)));
    const pd = foldConv(gk, D0, 0); leak += pd.lost;
    const B0 = pd.out; if (S) for (let i = 0; i < N; i++) B0[i] += S[i];
    const kr = (Math.max(nx, ny) - 1) / 2, Wf = nextPow2(2 * Math.max(nx, ny) - 1), Hf = Wf;
    const asKernel = (m) => { const K = 2 * kr + 1, k = new Float64Array(K * K), ox = kr - (nx - 1) / 2, oy = kr - (ny - 1) / 2; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) k[(j + oy) * K + i + ox] = m[j * nx + i]; return kernelSpectrum(k, kr, Wf, Hf); };
    const sT = L.specT ??= asKernel(L.T), sR = L.specR ??= asKernel(L.R);
    const bRe = new Float64Array(Wf * Hf), bIm = new Float64Array(Wf * Hf);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) bRe[j * Wf + i] = B0[j * nx + i];
    fft2d(bRe, bIm, Wf, Hf, false);
    const mRe = new Float64Array(Wf * Hf), mIm = new Float64Array(Wf * Hf);
    for (let k = 0; k < Wf * Hf; k++) {
      const dr = 1 - rhoB * sR.re[k], di = -rhoB * sR.im[k], dd = dr * dr + di * di;
      const br = (bRe[k] * dr + bIm[k] * di) / dd, bi = (bIm[k] * dr - bRe[k] * di) / dd;   // B̂ = B̂0 / (1 − ρ R̂)
      bRe[k] = br; bIm[k] = bi;
      mRe[k] = rhoB * (sT.re[k] * br - sT.im[k] * bi); mIm[k] = rhoB * (sT.re[k] * bi + sT.im[k] * br);
    }
    fft2d(bRe, bIm, Wf, Hf, true); fft2d(mRe, mIm, Wf, Hf, true);
    let sBin = 0, sBall = 0, sMin = 0;
    for (let k = 0; k < Wf * Hf; k++) sBall += bRe[k];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = bRe[j * Wf + i]; sBin += v; const m = mRe[j * Wf + i]; Mrec[j * nx + i] = m; sMin += m; }
    // 장부: PCB 흡수 (1−ρ)ΣB(영역 안), 영역 밖 B = 누설, 램버시안 방출 ρΣB 의 운명 = 출사(영역 안 Mrec·밖 = 누설)·되돌림(B 에 포함)·흡수·누설
    boardAbs += (1 - rhoB) * sBin;
    leak += sBall - sBin;
    const em = rhoB * sBin;
    slabAbs += em * L.fAbs;
    leak += em * L.fLost + (em * L.eT - sMin);
    lambertDone = true;
  }
  if (!lambertDone && rhoB > 0 && sD0 > 0) {
    if (h < H_MIN) {                                     // 밀착: P_h = δ, 닫힌 해
      const g = rhoB / (1 - rhoB * qd.R);
      Itot = Float64Array.from(D0, (v) => v * g);
      boardAbs = (1 - rhoB) * (sD0 + qd.R * sum(Itot));
    } else {
      const f = Math.min(4, Math.max(1, Math.round(Math.max(h / 4, step) / step))), sc = f * step;
      let { o: Dc, cx, cy } = down(D0, nx, ny, f);
      // 갭 커널 반경: 99.9% 반경(31.6h) 과 기구 최대 치수 중 작은 값 — 그 밖은 벽을 여러 번 지나야 해
      // (벽 1회 접기 밖) 어차피 누설로 집계되므로 커널을 키워도 결과가 같고 FFT 만 커진다.
      const gk = gapKernel(h, sc, Math.min(31.6 * h, gapRmax ?? Math.max(nx, ny) * step));
      const Ic = new Float64Array(cx * cy);
      if (rW === 0) {
        // 벽 없는 열린 영역(PSF): 주파수 영역 닫힌 해 I = rho P^2 D / (1 - rho R_d P^2), B = P D + R_d P I.
        // 에너지는 독립 집계: 보드 흡수 (1-rho) sum B, 영역 밖 I 의 (1-R_d) 는 누설, 커널 절단은 공식으로.
        const kr = gk.kr, W = nextPow2(cx + 2 * kr + 1), H = nextPow2(cy + 2 * kr + 1), sp = kernelSpectrum(gk.k, kr, W, H);
        // 정반사분 S(이미 PCB 면): X = Ĝ_D·D + S, I = ρ P X / (1 − ρ P Q), B = X + Q I, Q = R_d·Ĝ_d.
        // Ĝ = 반사광 착지 커널(표 v2 의 측방 반경·출사각 분포 → 갭 h 에서 측방 + h·tanθ, 등방 상대 방위) — 하면에서 빠져나온 반사광은
        // 스치는 각도로 멀리 떨어진다(형상 MC 진단: 램버시안 P_h 는 재순환을 LED 가까이 몰아 Milky 3 중심 +27%·원거리 −15%).
        // 표 v1(분포 없음)·단일 광원 중심 없음(검증용 시프트 끔)이면 Ĝ = P (기존).
        const useLand = center && rAcc.w > 0 && qd.rRadOk;
        const GD = useLand ? landK(accNorm(rAcc), h, t, sc, kr) : null;
        const GDd = useLand ? landK({ rr: qd.rRad, ra: qd.rAng, land: qd.land, landOk: qd.landOk }, h, t, sc, kr) : null;
        const sGD = GD ? kernelSpectrum(GD.k, kr, W, H) : null, sGd = GDd ? kernelSpectrum(GDd.k, kr, W, H) : null;
        const ksum = sum(gk.k), dRe = padIn(Dc, cx, cy, kr, W, H), dIm = new Float64Array(W * H);
        fft2d(dRe, dIm, W, H, false);
        let sRe = null, sIm = null, sSum = 0;
        if (S) { const Sc = down(S, nx, ny, f).o; sSum = sum(Sc); sRe = padIn(Sc, cx, cy, kr, W, H); sIm = new Float64Array(W * H); fft2d(sRe, sIm, W, H, false); }
        // 확산 재입사의 반사 R_d 도 측방 분포 rdKern 이 있으면 R_d·K̂_Rd(k) (커널 스펙트럼)
        let kd = null;
        if (rdKern) { const rk = radialKernel(rdKern, t, f * step); const kk = new Float64Array((2 * kr + 1) ** 2), K2 = 2 * kr + 1, K1 = 2 * rk.kr + 1;
          for (let j = 0; j < K1; j++) for (let i = 0; i < K1; i++) { const a = i - rk.kr + kr, b = j - rk.kr + kr; if (a >= 0 && b >= 0 && a < K2 && b < K2) kk[b * K2 + a] += rk.k[j * K1 + i]; }
          kd = kernelSpectrum(kk, kr, W, H); }
        const iRe = new Float64Array(W * H), iIm = new Float64Array(W * H), bRe = new Float64Array(W * H), bIm = new Float64Array(W * H);
        for (let k = 0; k < W * H; k++) {
          const pr0 = sp.re[k], pi0 = sp.im[k];
          // Q = R_d·(Ĝ_d 또는 K̂d·P 또는 P)
          const qr = sGd ? qd.R * sGd.re[k] : kd ? qd.R * (kd.re[k] * pr0 - kd.im[k] * pi0) : qd.R * pr0;
          const qi = sGd ? qd.R * sGd.im[k] : kd ? qd.R * (kd.re[k] * pi0 + kd.im[k] * pr0) : qd.R * pi0;
          const pr = pr0, pi = pi0;
          // 분모 1 − ρ P Q
          const pqr = pr * qr - pi * qi, pqi = pr * qi + pi * qr;
          const dr = 1 - rhoB * pqr, di = -rhoB * pqi, dd = dr * dr + di * di;
          const gr = sGD ? sGD.re[k] : pr, gi = sGD ? sGD.im[k] : pi;
          const xr = gr * dRe[k] - gi * dIm[k] + (sRe ? sRe[k] : 0), xi = gr * dIm[k] + gi * dRe[k] + (sIm ? sIm[k] : 0);
          const nr = rhoB * (pr * xr - pi * xi), ni = rhoB * (pr * xi + pi * xr);
          const ir = (nr * dr + ni * di) / dd, ii = (ni * dr - nr * di) / dd;
          iRe[k] = ir; iIm[k] = ii;
          bRe[k] = xr + (qr * ir - qi * ii); bIm[k] = xi + (qr * ii + qi * ir);
        }
        if (globalThis.__dbgLand) {   // 진단: PCB 착지 X 맵(거친 격자)
          const xRe = new Float64Array(W * H), xIm = new Float64Array(W * H);
          for (let k = 0; k < W * H; k++) { const gr = sGD ? sGD.re[k] : sp.re[k], gi = sGD ? sGD.im[k] : sp.im[k]; xRe[k] = gr * dRe[k] - gi * dIm[k] + (sRe ? sRe[k] : 0); xIm[k] = gr * dIm[k] + gi * dRe[k] + (sIm ? sIm[k] : 0); }
          fft2d(xRe, xIm, W, H, true);
          const X = new Float64Array(cx * cy); for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) X[j * cx + i] = xRe[(j + kr) * W + i + kr];
          globalThis.__dbgLand = { X, cx, cy, sc };
        }
        fft2d(iRe, iIm, W, H, true); fft2d(bRe, bIm, W, H, true);
        const sB = sum(bRe), sIall = sum(iRe);
        let sIin = 0;
        for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { const v = iRe[(j + kr) * W + i + kr]; Ic[j * cx + i] = v; sIin += v; }
        boardAbs += (1 - rhoB) * sB;
        const gD = GD ? GD.mass : ksum, gd = GDd ? GDd.mass : ksum;   // 커널 절단 손실(착지 커널은 자체 질량)
        leak += (1 - qd.R) * (sIall - sIin) + (1 - gD) * (sD0 - sSum) + (1 - gd) * qd.R * sIall + (1 - ksum) * rhoB * sB;
        Itot = up(Ic, cx, cy, f, nx, ny);
      } else {
      const conv = makeConv(cx, cy, gk);
      for (iterations = 1; iterations <= 200; iterations++) {
        const B = foldConv(conv, Dc, rW); leak += B.lost;
        const sB = sum(B.out); boardAbs += (1 - rhoB) * sB;
        for (let i = 0; i < B.out.length; i++) B.out[i] *= rhoB;
        const I = foldConv(conv, B.out, rW); leak += I.lost;
        for (let i = 0; i < Ic.length; i++) { Ic[i] += I.out[i]; I.out[i] *= qd.R; }
        Dc = I.out;
        if (sum(Dc) < 1e-5 * sD0) break;
      }
      leak += sum(Dc);                                   // 미전파 잔여(≤1e-5, 누설로 집계)
      Itot = up(Ic, cx, cy, f, nx, ny);
      }
    }
    // 확산 재입사의 투과: 도착 위치의 국소 두께 단계로(재순환 반사 R_d·갭은 대표값 — 매끄러운 성분)
    for (const L of levels) {
      let Ik = Itot;
      if (L.w) { Ik = new Float64Array(N); for (let i = 0; i < N; i++) Ik[i] = Itot[i] * L.w[i]; }
      const qk = L.w ? table.query(mat.musR * L.t, mat.g, mat.n, table.diffuseRow, mat.mua * L.t) : qd, sI = sum(Ik);
      if (!(sI > 0)) continue;
      slabAbs += (1 - qk.Tb - qk.Ts - qk.R) * sI;
      for (let i = 0; i < N; i++) Mrec[i] += qk.Tb * Ik[i];
      if (qk.Ts > 0) runJobs([scatJob(Ik, qk, sI, -1, L.t)], Mrec);
    }
  }

  const M = new Float64Array(N);
  for (let i = 0; i < N; i++) M[i] = Mball[i] + Mscat[i] + Mrec[i];
  const top = sum(M), err = input > 0 ? Math.abs(input - (top + tail + boardAbs + slabAbs + leak)) / input : 0;
  return { M, Mball, Mscat, Mrec, tail, iterations, energy: { input, top, tail, boardAbs, slabAbs, leak, err }, ...(returnD ? { D0, S, rAcc } : {}) };
}
