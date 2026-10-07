// L2 캐비티 재순환 solver — spec 2026-10-07 §5.3.
// 입력 E[b] = 슬래브 하면 입사 조도(각도 밴드별, 셀 값 = 면밀도), 출력 M = 상면 출사도(같은 단위).
//  (a) 비산란 직진 Tb·E  (b) 산란 투과 K_T ⊛ (Ts·E) + 원거리 tail 균일  (c) 재순환:
//  하면 반사 R·E → 갭 전달 P_h → 기판 ρ_b → P_h → 확산 입사 → (Td·K_Td) 투과, R_d 반사 반복.
// 벽: 외곽 밖 성분을 한 번 접어 넣음 × rW, 나머지는 누설. 에너지는 독립 집계해 V2 로 검사.
import { nextPow2, kernelSpectrum, convolve } from './fft.js';
import { radEdge, N_RAD } from './mc-slab.js';

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

// 도메인 입력 ⊛ 커널 → 벽 접어넣기(rW). { out, lost } — lost = 벽 투과·다중반사 밖·커널 절단분.
function foldConv(c, inp, rW) {
  const { dx, dy, kr, W, H } = c, pad = new Float64Array(W * H);
  for (let j = 0; j < dy; j++) for (let i = 0; i < dx; i++) pad[(j + kr) * W + i + kr] = inp[j * dx + i];
  const conv = convolve(pad, c.spec), out = new Float64Array(dx * dy);
  let lost = (1 - c.ksum) * sum(inp);
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
  return { out, lost };
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
export function solveCavity({ E, nx, ny, step, table, mat, t, h, rhoB, rW }) {
  const N = nx * ny, tauR = mat.musR * t, muaT = mat.mua * t;
  const qb = E.map((_, b) => table.query(tauR, mat.g, mat.n, b, muaT));
  const qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const Mball = new Float64Array(N), Mscat = new Float64Array(N), Mrec = new Float64Array(N), D0 = new Float64Array(N);
  let input = 0, slabAbs = 0, leak = 0, boardAbs = 0, iterations = 0;

  // (a) 직진 + 하면 반사, (b) 산란 투과
  for (let b = 0; b < E.length; b++) {
    const e = E[b], q = qb[b], se = sum(e);
    if (!(se > 0)) continue;
    input += se; slabAbs += (1 - q.Tb - q.Ts - q.R) * se;
    for (let i = 0; i < N; i++) { Mball[i] += q.Tb * e[i]; D0[i] += q.R * e[i]; }
    if (q.Ts > 0) addScattered(Mscat, e, q, se);
  }
  function addScattered(target, e, q, se) {
    const near = 1 - q.radTail, src = new Float64Array(N);
    for (let i = 0; i < N; i++) src[i] = q.Ts * near * e[i];
    const { out, lost } = foldConv(makeConv(nx, ny, radialKernel(q.rad, t, step)), src, rW);
    leak += lost;
    const u = (q.Ts * q.radTail * se) / N;               // 슬래브 도광(원거리) 성분 — 균일 근사
    for (let i = 0; i < N; i++) target[i] += out[i] + u;
  }

  // (c) 재순환
  const sD0 = sum(D0);
  let Itot = null;
  if (rhoB > 0 && sD0 > 0) {
    if (h < H_MIN) {                                     // 밀착: P_h = δ, 닫힌 해
      const g = rhoB / (1 - rhoB * qd.R);
      Itot = Float64Array.from(D0, (v) => v * g);
      boardAbs = (1 - rhoB) * (sD0 + qd.R * sum(Itot));
    } else {
      const f = Math.min(4, Math.max(1, Math.round(Math.max(h / 4, step) / step))), sc = f * step;
      let { o: Dc, cx, cy } = down(D0, nx, ny, f);
      // 갭 커널 반경: 99.9% 반경(31.6h) 과 기구 최대 치수 중 작은 값 — 그 밖은 벽을 여러 번 지나야 해
      // (벽 1회 접기 밖) 어차피 누설로 집계되므로 커널을 키워도 결과가 같고 FFT 만 커진다.
      const conv = makeConv(cx, cy, gapKernel(h, sc, Math.min(31.6 * h, Math.max(nx, ny) * step)));
      const Ic = new Float64Array(cx * cy);
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
    const sI = sum(Itot);
    slabAbs += (1 - qd.Tb - qd.Ts - qd.R) * sI;
    for (let i = 0; i < N; i++) Mrec[i] += qd.Tb * Itot[i];
    if (qd.Ts > 0) addScattered(Mrec, Itot, qd, sI);
  }

  const M = new Float64Array(N);
  for (let i = 0; i < N; i++) M[i] = Mball[i] + Mscat[i] + Mrec[i];
  const top = sum(M), err = input > 0 ? Math.abs(input - (top + boardAbs + slabAbs + leak)) / input : 0;
  return { M, Mball, Mscat, Mrec, iterations, energy: { input, top, boardAbs, slabAbs, leak, err } };
}
