// S2a — 형상 몸체 빠른 solver(투명) — 형상 몸체 spec 2026-10-10 §4.2. 결정론(잡음 없음).
// 앵커 LED 마다 광선관 PSF 를 추적하고 전 LED 에 평행이동 중첩한다. 기하·계면 코드는 S1(mc-body)과 공유.
//  주경로(꼭짓점 광선, 투과 우선·TIR 은 반사): 서명이 같은 사각형은 출사(또는 PCB 도달) 사각형에 균일 래스터,
//  아니면 2단 세분 후 꼭짓점 구적. 2차 가지(Fresnel 반사·내부 반사)는 사각형 중심 광선으로 가중 추적(점 분배).
//  PCB 에 닿은 빛은 1회 재순환: ρ_b·PCB 지도 ⊛ 갭 커널 P_h × 확산 투과 T_d.
import { _K as K, _nextEvent as nextEvent, _interface as iface, _ledModel as ledModel, makeScene } from './mc-body.js';
import { fresnelR } from '../photometry.js';
import { nextPow2, kernelSpectrum, convolve } from '../l2/fft.js';
import { rng } from '../l2/mc-slab.js';
import { sharedHf } from './psf-pool.js';

const OFF = 1e-7, END_TOP = 1, END_PCB = 2, END_LOST = 3;

// ---- 주경로(결정론) ----
// nrm: 계면 사건마다 면 법선(최대 NMAX 개) — 서명(사건 종류)이 같아도 다른 면(꺾임 양쪽)을 지나면 사상이 불연속이라
// 사각형을 보간하면 안 된다(VS5 채널 렌즈: 45° 경사/평탄 경계에서 ±40% 번짐). 면 법선 차 > 10° 면 불일치(꺾임)로 본다 — 원뿔·곡면처럼 연속 변화는 중점 검사가 담당.
const NMAX = 6, COS_TOL = Math.cos(10 * Math.PI / 180);
const pr = { end: 0, x: 0, y: 0, f: 0, sig: 0, nrm: null, nn: 0 };
function primary(S, px, py, pz, dx, dy, dz) {
  let inB = false, f = 1, sig = 0;
  const nrm = new Float64Array(3 * NMAX); let nn = 0;
  pr.nrm = nrm; pr.nn = 0;
  const rec = (E) => { if (nn < NMAX) { nrm[3 * nn] = E.nx; nrm[3 * nn + 1] = E.ny; nrm[3 * nn + 2] = E.nz; nn++; pr.nn = nn; } };
  // 손실 종료(탈출·흡수 벽·갇힘)도 실제 계보 투과율 f 를 돌려준다 — f=0 으로 주면 그 에너지가 '2차 몫'으로 넘어가
  // 2차 추적(주경로 계보는 집계 제외)에서 사라진다(VS5 채널 렌즈 0.4% 누수).
  for (let e = 0; e < 200; e++) {
    const E = nextEvent(S, px, py, pz, dx, dy, dz, inB, Infinity), t = E.t, kind = E.kind;
    if (!(t < Infinity)) break;
    px += t * dx; py += t * dy; pz += t * dz;
    if (inB && S.mua > 0) f *= Math.exp(-S.mua * t);
    if (kind === K.PCB) { pr.end = END_PCB; pr.x = px; pr.y = py; pr.f = f; pr.sig = sig * 13 + 2; return pr; }
    if (kind === K.ESC_SIDE || kind === K.ESC_UP) break;
    if (kind === K.WALL) {
      const W = S.walls;
      if (!W || W.mode !== 'fresnel') break;
      const Nx = E.nx, Ny = E.ny, dn = dx * Nx + dy * Ny;
      f *= fresnelR(Math.abs(dn), W.n ?? S.n); dx -= 2 * dn * Nx; dy -= 2 * dn * Ny; sig = sig * 13 + 5;
      px += OFF * Nx; py += OFF * Ny;
      continue;
    }
    rec(E);
    const c = iface(S.n, dx, dy, dz, E.nx, E.ny, E.nz, inB);
    if (kind === K.TOP && inB && c.R < 1) { pr.end = END_TOP; pr.x = px; pr.y = py; pr.f = f * (1 - c.R); pr.sig = sig * 13 + 1; return pr; }
    if (c.R < 1) { f *= 1 - c.R; dx = c.tx; dy = c.ty; dz = c.tz; inB = !inB; sig = sig * 13 + kind + 5; }
    else { dx = c.rx; dy = c.ry; dz = c.rz; sig = sig * 13 + 11; }
    px += OFF * dx; py += OFF * dy; pz += OFF * dz;
  }
  pr.end = END_LOST; pr.f = f; pr.sig = -1; return pr;
}

// ---- 2차 가지(중심 광선, 주경로 계보는 제외) ----
// 작은 가지는 버리지 않고 러시안 룰렛(생존 1/10, 가중 ×10) — 기댓값 보존. 하드 절단은 렌즈 형상에서 방출의 0.6% 를 잃었다(VS5).
// 난수는 PSF 마다 고정 시드(sink.rnd) — 같은 입력이면 같은 결과(결정론).
function secondary(S, o, d, w0, wCut, sink) {
  const rr = (w) => { if (sink.rnd() < 0.1) return w * 10; sink.rr += w; return 0; };
  const st = [[o[0], o[1], o[2], d[0], d[1], d[2], 0, w0, 1]];
  while (st.length) {
    let [px, py, pz, dx, dy, dz, inB, w, prim] = st.pop();
    for (let e = 0; ; e++) {
      if (e >= 400) { if (!prim) sink.lost += w; break; }   // 갇힘(수치) — 장부에 남김
      const E = nextEvent(S, px, py, pz, dx, dy, dz, !!inB, Infinity), t = E.t, kind = E.kind;
      if (!(t < Infinity)) { if (!prim) sink.lost += w; break; }
      px += t * dx; py += t * dy; pz += t * dz;
      if (inB && S.mua > 0) { const a = w * (1 - Math.exp(-S.mua * t)); if (!prim) sink.abs += a; w -= a; }
      if (kind === K.PCB) { if (!prim) sink.pcb(px, py, w); break; }
      if (kind === K.ESC_SIDE || kind === K.ESC_UP) { if (!prim) sink.lost += w; break; }
      if (kind === K.WALL) {
        const W = S.walls;
        if (!W || W.mode !== 'fresnel') { if (!prim) sink.lost += w; break; }
        const Nx = E.nx, Ny = E.ny, dn = dx * Nx + dy * Ny, R = fresnelR(Math.abs(dn), W.n ?? S.n);
        if (!prim) sink.lost += w * (1 - R);
        w *= R; dx -= 2 * dn * Nx; dy -= 2 * dn * Ny; px += OFF * Nx; py += OFF * Ny;
        if (w < wCut && !prim) { w = rr(w); if (!w) break; }
        continue;
      }
      const c = iface(S.n, dx, dy, dz, E.nx, E.ny, E.nz, !!inB);
      if (kind === K.TOP && inB) {
        const wt = w * (1 - c.R);
        if (wt > 0 && !prim) sink.top(px, py, wt);
        w -= wt; if (c.R < 1) prim = 0;                      // 탈출 후 남은 반사분은 2차
        dx = c.rx; dy = c.ry; dz = c.rz;
      } else if (c.R >= 1) { dx = c.rx; dy = c.ry; dz = c.rz; }
      else {
        const wr = w * c.R;                                    // 반사 가지 = 2차(주경로는 투과)
        const wk = wr >= wCut ? wr : wr > 0 ? rr(wr) : 0;
        if (wk > 0) st.push([px + OFF * c.rx, py + OFF * c.ry, pz + OFF * c.rz, c.rx, c.ry, c.rz, inB, wk, 0]);
        w -= wr; dx = c.tx; dy = c.ty; dz = c.tz; inB = inB ? 0 : 1;
      }
      px += OFF * dx; py += OFF * dy; pz += OFF * dz;
      if (w < wCut && !prim) { w = rr(w); if (!w) break; }
    }
  }
}

// ---- PSF 격자(LED 기준 오프셋, 밀도) ----
function makeGridK(half, s, out) {
  const kc = Math.ceil(half / s), kn = 2 * kc + 1;
  return { kc, kn, s, top: out?.top ?? new Float32Array(kn * kn), pcb: out?.pcb ?? new Float32Array(kn * kn) };
}
function splat(G, arr, x, y, m) {
  const fa = x / G.s + G.kc, fb = y / G.s + G.kc, a0 = Math.floor(fa), b0 = Math.floor(fb), ta = fa - a0, tb = fb - b0, d = m / (G.s * G.s);
  if (a0 < 0 || b0 < 0 || a0 + 1 >= G.kn || b0 + 1 >= G.kn) return false;
  arr[b0 * G.kn + a0] += d * (1 - ta) * (1 - tb); arr[b0 * G.kn + a0 + 1] += d * ta * (1 - tb);
  arr[(b0 + 1) * G.kn + a0] += d * (1 - ta) * tb; arr[(b0 + 1) * G.kn + a0 + 1] += d * ta * tb;
  return true;
}
// 광선관 사각형 분배: 광속은 (u, φ) 매개공간에서 균등(등광속 고리)이므로, 매개공간 m×m 균등 표본을 꼭짓점 쌍선형 사상으로
// 옮겨 각 표본 질량 P/m² 을 쌍선형 분배한다 — 질량 정확, 출사 밀도는 사상의 야코비안을 자동으로 따른다.
// uA·uB 를 주면 반경 방향 위치 보간을 √u 로(꼭짓점 근처 r∝θ∝√u — u 선형 보간은 중심을 과밀하게 만든다).
function raster(G, arr, xs, ys, P, uA = -1, uB = -1) {
  const sq = uA >= 0 && uB > uA, sA = sq ? Math.sqrt(uA) : 0, sB = sq ? Math.sqrt(uB) : 1;
  const e = Math.max(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]), Math.hypot(xs[2] - xs[1], ys[2] - ys[1]), Math.hypot(xs[3] - xs[2], ys[3] - ys[2]), Math.hypot(xs[0] - xs[3], ys[0] - ys[3]));
  const m = Math.max(1, Math.min(48, Math.ceil((2 * e) / G.s))), w = P / (m * m);
  let lost = 0;
  for (let b = 0; b < m; b++) {
    const v = (b + 0.5) / m;
    for (let a = 0; a < m; a++) {
      const up = (a + 0.5) / m, u = sq ? (Math.sqrt(uA + up * (uB - uA)) - sA) / (sB - sA) : up, c0 = (1 - u) * (1 - v), c1 = u * (1 - v), c2 = u * v, c3 = (1 - u) * v;
      if (!splat(G, arr, c0 * xs[0] + c1 * xs[1] + c2 * xs[2] + c3 * xs[3], c0 * ys[0] + c1 * ys[1] + c2 * ys[2] + c3 * ys[3], w)) lost += w;
    }
  }
  return lost;
}

// 앵커 LED 하나의 PSF. led: {x,y}, lm: ledModel, I0, opt: { Nt, Np, half, s, wCutRel }
// PSF 를 각도 고리 묶음 PSF_CHUNKS 개로 나눠 추적(묶음 c = i % PSF_CHUNKS 인 고리들) — 병렬 풀이 묶음 단위로 나눠 처리한다.
// 묶음 수·묶음별 룰렛 시드·합산 순서를 고정해 순차/병렬, 코어 수와 무관하게 결과가 비트 단위로 같다.
export const PSF_CHUNKS = 8;
export function tracePsf(S, led, lm, I0, opt = {}) {
  const kc = Math.ceil(opt.half / opt.s), kn = 2 * kc + 1, kk = kn * kn;
  const G = makeGridK(opt.half, opt.s, opt.out), ledger = { emitted: 0, top: 0, pcb: 0, lost: 0, abs: 0, rest: 0 };
  const tmp = { top: new Float32Array(kk), pcb: new Float32Array(kk) };
  for (let c = 0; c < PSF_CHUNKS; c++) {
    tmp.top.fill(0); tmp.pcb.fill(0);
    const r = tracePsfChunk(S, led, lm, I0, { ...opt, out: tmp }, c);
    for (let k = 0; k < kk; k++) { G.top[k] += tmp.top[k]; G.pcb[k] += tmp.pcb[k]; }
    for (const key in ledger) ledger[key] += r.ledger[key];
  }
  return { G, ledger };
}
export function tracePsfChunk(S, led, lm, I0, { Nt = 24, Np = 48, half, s, sSub = s, wCutRel = 1e-3, sub = 3, maxLevel = 4, rings = 'flux', subK = 2, noSecondary = false, secBlur, nsMax = 4, midCheck = true, out = null } = {}, chunk = 0) {
  const G = makeGridK(half, s, out), Ftot = I0 * lm.solid;
  const ledger = { emitted: 0, top: 0, pcb: 0, lost: 0, abs: 0 };
  const dirOf = (u, ph) => { const c = lm.cosTheta(Math.min(u, 1 - 1e-12)), sn = Math.sqrt(Math.max(0, 1 - c * c)); return [sn * Math.cos(ph), sn * Math.sin(ph), c]; };
  const o = [led.x, led.y, 1e-6];
  const prim = (u, ph) => { ledger.nPrim = (ledger.nPrim ?? 0) + 1; const d = dirOf(u, ph), r = primary(S, o[0], o[1], o[2], d[0], d[1], d[2]); return { end: r.end, x: r.x - led.x, y: r.y - led.y, f: r.f, sig: r.sig, nrm: r.nrm, nn: r.nn }; };
  // 꼭짓점 격자
  // 고리 = 등각(θ) 분할(중심 r∝θ 거의 선형 — 등광속 분할은 중심에서 r∝√u 라 사상이 비선형), 광속은 CDF 로 정확
  const U = Array.from({ length: Nt + 1 }, (_, i) => (rings === 'theta' ? lm.uOf((i / Nt) * 89.5 * Math.PI / 180) : Math.min(i / Nt, lm.uOf(89.5 * Math.PI / 180))));
  const C = [];   // 꼭짓점 행: 이 묶음의 고리(i, i+1)만 필요할 때 계산
  const row = (i) => (C[i] ??= Array.from({ length: Np }, (_, j) => prim(U[i], (2 * Math.PI * j) / Np)));
  const dep = (end, x, y, m) => {
    if (end === END_TOP) { if (splat(G, G.top, x, y, m)) ledger.top += m; else ledger.lost += m; }
    else if (end === END_PCB) { if (splat(G, G.pcb, x, y, m)) ledger.pcb += m; else ledger.lost += m; }
  };
  const quad = (uA, uB, pA, pB, c, F, level) => {
    const sameN = (q) => { if (q.nn !== c[0].nn) return false; for (let k = 0; k < q.nn; k++) { const a = q.nrm, b = c[0].nrm; if (a[3 * k] * b[3 * k] + a[3 * k + 1] * b[3 * k + 1] + a[3 * k + 2] * b[3 * k + 2] < COS_TOL) return false; } return true; };
    const same = c[0].end !== END_LOST && c.every((q) => q.sig === c[0].sig && q.end === c[0].end && sameN(q));
    // 같은 경로라도 사각형이 노드 2칸보다 크면 세분 — 꼭짓점 쌍선형 사상이 r(θ) 비선형(tanθ, 중심 √u)을 못 따라감
    const big = same && level < maxLevel && (uA === 0 || Math.max(Math.hypot(c[0].x - c[2].x, c[0].y - c[2].y), Math.hypot(c[1].x - c[3].x, c[1].y - c[3].y)) > Math.max(subK * sSub, 0.1 * Math.hypot(c[0].x + c[2].x, c[0].y + c[2].y) / 2));   // 먼 곳은 상대 크기   // uA=0: 꼭짓점 수렴(r∝√u) 고리
    // 중점 비선형 검사: 꼭짓점이 모여 있어도 내부가 접히는(집광·TIR 경계) 사각형은 쌍선형 보간이 틀린다 —
    // 중심 광선 출사점을 보간 예측과 비교해 어긋나면(또는 경로가 다르면) 세분(최대 maxLevel+2 단). VS5 채널 렌즈 경사부 −10% 해소.
    let mcPre = null;
    if (midCheck && same && !big && level < maxLevel + 2) {
      const um = (uA + uB) / 2, pm = (pA + pB) / 2;
      mcPre = prim(um, pm);
      const fr = uB > uA ? (Math.sqrt(um) - Math.sqrt(uA)) / (Math.sqrt(uB) - Math.sqrt(uA)) : 0.5;
      const ex = (1 - fr) * 0.5 * (c[0].x + c[3].x) + fr * 0.5 * (c[1].x + c[2].x), ey = (1 - fr) * 0.5 * (c[0].y + c[3].y) + fr * 0.5 * (c[1].y + c[2].y);
      const tol = Math.max(0.5 * sSub, 0.02 * Math.hypot(ex, ey));
      if (mcPre.sig !== c[0].sig || mcPre.end !== c[0].end || Math.hypot(mcPre.x - ex, mcPre.y - ey) > tol) {
        const m01 = prim(um, pA), m12 = prim(uB, pm), m23 = prim(um, pB), m30 = prim(uA, pm), mc = mcPre;
        quad(uA, um, pA, pm, [c[0], m01, mc, m30], F / 4, level + 1);
        quad(um, uB, pA, pm, [m01, c[1], m12, mc], F / 4, level + 1);
        quad(um, uB, pm, pB, [mc, m12, c[2], m23], F / 4, level + 1);
        quad(uA, um, pm, pB, [m30, mc, m23, c[3]], F / 4, level + 1);
        return;
      }
    }
    if (same && !big) {
      // 주경로 에너지: 꼭짓점 4(각 1/8) + 중심(1/2) 구적 — 경사 스침 입사처럼 f(Fresnel)가 급변하면 꼭짓점 평균은 치우친다
      const P = mcPre ? F * ((c[0].f + c[1].f + c[2].f + c[3].f) / 8 + mcPre.f / 2) : (F * (c[0].f + c[1].f + c[2].f + c[3].f)) / 4;
      const before = c[0].end === END_TOP ? G.top : G.pcb;
      const lost = raster(G, before, [c[0].x, c[1].x, c[2].x, c[3].x], [c[0].y, c[1].y, c[2].y, c[3].y], P, uA, uB);
      if (c[0].end === END_TOP) ledger.top += P - lost; else ledger.pcb += P - lost;
      ledger.lost += lost;
      return;
    }
    if (level < (same ? maxLevel : sub)) {
      const um = (uA + uB) / 2, pm = (pA + pB) / 2;
      const m01 = prim(um, pA), m12 = prim(uB, pm), m23 = prim(um, pB), m30 = prim(uA, pm), mc = prim(um, pm);
      quad(uA, um, pA, pm, [c[0], m01, mc, m30], F / 4, level + 1);
      quad(um, uB, pA, pm, [m01, c[1], m12, mc], F / 4, level + 1);
      quad(um, uB, pm, pB, [mc, m12, c[2], m23], F / 4, level + 1);
      quad(uA, um, pm, pB, [m30, mc, m23, c[3]], F / 4, level + 1);
      return;
    }
    for (const q of c) { if (q.end === END_LOST) ledger.lost += (F / 4) * q.f; else dep(q.end, q.x, q.y, (F / 4) * q.f); }
  };
  const wCut = (Ftot / (Nt * Np)) * wCutRel;
  // 2차 가지 출사(Fresnel 반사·내부 반사)는 별도 배열에 점 분배 후 σ = secBlur 가우시안으로 평활해 더한다(질량 보존).
  // 예전 '주경로 발자국 평행이동'은 경사 렌즈처럼 사상이 늘어난 사각형에서 2차 에너지를 수 mm 엉뚱하게 옮겼다(VS5 채널 렌즈 +60%).
  const sec = new Float32Array(G.kn * G.kn);
  const depSec = (end, x, y, m) => {
    if (end === END_TOP) { if (splat(G, sec, x, y, m)) ledger.top += m; else ledger.lost += m; }
    else dep(end, x, y, m);
  };
  const sink = {
    lost: 0, abs: 0, rr: 0, rnd: rng((((led.x * 73856093) ^ (led.y * 19349663)) + chunk * 83492791) >>> 0 || 1),
    top: (x, y, m) => depSec(END_TOP, x - led.x, y - led.y, m),
    pcb: (x, y, m) => depSec(END_PCB, x - led.x, y - led.y, m),
  };
  // 2차 가지는 꼭짓점 광선에서 추적(주경로와 같은 표본). 사각형마다 주경로가 실제로 분배한 E_p 외의 몫 Fq − E_p 를
  // 꼭짓점들에 (1 − f_k) 비례로 나눈다 → 꼭짓점 k 의 2차 추적 초기 가중 = (Fq − E_p)/Σ(1 − f_j) (사각형 내 공통).
  // 중심 광선 1개로 운반하면 렌즈 경사처럼 f 가 급변하는 곳에서 주경로 구적과 어긋나 에너지가 샌다(VS7 L4).
  // 2차 몫(주경로가 운반하지 못한 Fq − E_p)은 사각형 내부 층화 표본 ns×ns 로 운반: 표본 k 의 초기 가중 = rem/Σ(1 − f_j)
  // (표본별 (1 − f_k) 비례 — 주경로 구적과 에너지 정확 일치). ns 는 2차 몫 비율에 따라 1~4 (경사 스침 반사처럼 큰 곳은 촘촘히).
  if (chunk === 0) { const miss = Ftot * (1 - U[Nt]); ledger.emitted += miss; ledger.lost += miss; }   // 89.5° 밖(추적 안 함) = 손실
  for (let i = 0; i < Nt; i++) {
   if (i % PSF_CHUNKS !== chunk) continue;
   const Ci = row(i), Ci1 = row(i + 1);
   ledger.emitted += Ftot * (U[i + 1] - U[i]);
   for (let j = 0; j < Np; j++) {
    const j1 = (j + 1) % Np, pA = (2 * Math.PI * j) / Np, pB = (2 * Math.PI * (j + 1)) / Np;
    const cq = [Ci[j], Ci1[j], Ci1[j1], Ci[j1]];
    const Fq = (Ftot * (U[i + 1] - U[i])) / Np;
    const before = ledger.top + ledger.pcb + ledger.lost;
    quad(U[i], U[i + 1], pA, pB, cq, Fq, 0);
    const rem = Fq - (ledger.top + ledger.pcb + ledger.lost - before);
    if (!(rem > 0)) continue;
    if (noSecondary) { ledger.lost += rem; continue; }
    const frac = rem / Fq, ns = Math.min(nsMax, frac < 0.03 ? 1 : frac < 0.1 ? 2 : frac < 0.3 ? 3 : 4), pts = [];
    let den = 0;
    for (let b = 0; b < ns; b++) for (let a = 0; a < ns; a++) {
      const u = U[i] + ((a + 0.5) / ns) * (U[i + 1] - U[i]), ph = pA + ((b + 0.5) / ns) * (pB - pA), f = prim(u, ph).f;
      pts.push([u, ph, f]); den += 1 - f;
    }
    if (!(den > 1e-12)) { ledger.lost += rem; continue; }
    for (const [u, ph, f] of pts) if (f < 1) secondary(S, o, dirOf(u, ph), rem / den, wCut, sink);
   }
  }
  gaussBlur(sec, G.kn, (secBlur ?? 0.5 * sSub) / G.s);
  for (let k = 0; k < sec.length; k++) G.top[k] += sec[k];
  // 장부: rest = 주경로 흡수 등(진단용)
  ledger.lost += sink.lost; ledger.abs = sink.abs;
  ledger.rest = ledger.emitted - ledger.top - ledger.pcb - ledger.lost - ledger.abs;
  return { G, ledger };
}

// ---- 확산 투과(투명 평판, Lambertian 입사, 내부 다중반사·흡수) ----
export function diffuseT(n, t, mua) {
  let T = 0; const M = 400;
  for (let i = 0; i < M; i++) {
    const th = ((i + 0.5) / M) * (Math.PI / 2), c = Math.cos(th), s = Math.sin(th), R = fresnelR(c, n);
    const sT = s / n, cT = Math.sqrt(1 - sT * sT), a = Math.exp(-mua * t / cT);
    T += 2 * c * s * ((1 - R) * (1 - R) * a) / (1 - R * R * a * a) * (Math.PI / 2 / M);
  }
  return T;
}

// ---- 열린 영역 PSF 장면: 생성 몸체는 높이맵 가장자리를 복제해 벽 너머로 연장(측면·캐비티 벽 없음) ----
// 캐비티 벽은 중첩 단계에서 거울 LED(노드별 Fresnel)로 — L1·L2 와 같은 처리라 PSF 가 위치에 덜 묶인다.
export function openScene(geom, depth, n, mua, margin) {
  const src = geom.hf;
  if (geom.imported) return makeScene({ hf: src, ox: geom.ox, oy: geom.oy, depth, n, medium: { mus: 0, g: 0, mua }, rhoB: 0, walls: null });
  const m = Math.ceil(margin / src.cell), nx = src.nx + 2 * m, ny = src.ny + 2 * m, N = nx * ny;
  const zt = new Float64Array(N), zb = new Float64Array(N), mask = new Uint8Array(N).fill(1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const si = Math.min(src.nx - 1, Math.max(0, i - m)), sj = Math.min(src.ny - 1, Math.max(0, j - m)), k = sj * src.nx + si;
    zt[j * nx + i] = src.zt[k]; zb[j * nx + i] = src.zb[k];
  }
  const hf = { nx, ny, cell: src.cell, x0: src.x0 - m * src.cell, y0: src.y0 - m * src.cell, zt, zb, mask };
  return makeScene({ hf, ox: geom.ox, oy: geom.oy, depth, n, medium: { mus: 0, g: 0, mua }, rhoB: 0, walls: null });
}

// PSF 캐시: 형상 키 + 추적 위치 + 해상도·물성 (피치와 무관한 형상은 평가 간 그대로 재사용)
const _psfCache = new Map(), _sceneCache = new Map();
export function clearPsfCache() { _psfCache.clear(); _sceneCache.clear(); }

// ---- 전체: 형상 몸체 출사도 장 ----
// geom: body-geom 결과(imported·periodic 표시), grid: { NX, NY, x0, y0, stepX, stepY }, led: { model, beamX, I0 }
// opt: uniform(형상이 위치 불변 — L1 평판·L4 주기: PSF 1개, L4 는 중심에 가장 가까운 LED 위치에서), symmetric(거울 대칭 — 앵커 1/4만 추적),
//      anchorStep(비균일 형상 앵커 격자 간격), exact(검증용: LED 마다 실제 벽·측면 포함 추적)
// 정밀도: 'full'(최종안·표시) / 'search'(자동탐색 반복 — 각도 격자·세분·재순환 위상·가지 절단을 낮춤, 최종안은 full 로 재검증)
export const FIDELITY = {
  full: { Nt: 24, maxLevel: 4, sub: 3, midCheck: true, nsMax: 4, recQ: 2, recNt: 16, wCutRel: 1e-3 },
  search: { Nt: 16, maxLevel: 3, sub: 2, midCheck: false, nsMax: 1, recQ: 1, recNt: 12, wCutRel: 3e-3 },
};
export function shapeField(geom, depth, leds, led, grid, { n, mua = 0, rhoB = 0.5, fidelity = 'full', Nt, Np, uniform = false, symmetric = false, anchorStep, exact = false, pool = globalThis.__psfPool } = {}) {
  const FQ = FIDELITY[fidelity] ?? FIDELITY.full;
  Nt = Nt ?? FQ.Nt; Np = Np ?? 2 * Nt;
  const tq = { maxLevel: FQ.maxLevel, sub: FQ.sub, midCheck: FQ.midCheck, nsMax: FQ.nsMax, wCutRel: FQ.wCutRel };
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const lm = ledModel(led), I0 = led.I0 ?? 1;
  const { NX, NY, x0, y0, stepX, stepY } = grid;
  const Wx = geom.walls.x1 - geom.walls.x0, Wy = geom.walls.y1 - geom.walls.y0, wcx = (geom.walls.x0 + geom.walls.x1) / 2, wcy = (geom.walls.y0 + geom.walls.y1) / 2;
  // PSF 커널은 평가 간격의 1/2 격자에 만들고 평가 간격 텐트로 1회 사전 필터 — 노드 값 = 노드 중심 텐트 평균(MC 쌍선형 분배와 같은 필터).
  // 평가 격자에 바로 분배하면 LED 오프셋 쌍선형 보간과 겹쳐 텐트가 2중으로 걸려 국부 구조(L4 렌즈)가 퍼진다(VS7 에서 확인).
  const sE = Math.min(stepX, NY > 1 ? stepY : stepX), s = sE / 2, half = Math.hypot(Wx, Wy) + 2 * sE;
  // 분산 맞춤: 고운 격자 분배(텐트 s)·LED 오프셋 쌍선형(텐트 s)이 이미 분산 2·s²/6 을 더하므로 사전 필터 반폭 = √(간격² − 2s²)
  const pre = (st) => Math.sqrt(Math.max(0, st * st - 2 * s * s)) / s;
  const ledgerSum = { emitted: 0, top: 0, pcb: 0, lost: 0, abs: 0, rest: 0 };
  let traced = 0;
  const field = new Float64Array(NX * NY);
  // 갭(PCB → 몸체 바닥 평균) — 벽 반사 입사각·재순환에 사용
  let zbS = 0, thS = 0, cnt = 0;
  for (let k = 0; k < geom.hf.mask.length; k++) if (geom.hf.mask[k]) { zbS += depth + geom.hf.zb[k]; thS += geom.hf.zt[k] - geom.hf.zb[k]; cnt++; }
  const hGap = Math.max(0.2, zbS / cnt), tMean = thS / cnt;
  // wallAxis: 0 = 직접, 1 = X 벽 거울, 2 = Y 벽 거울 — 노드별 Fresnel 반사율(벽 입사각: 수평 수직성분 / 3D 길이, 높이 = 갭).
  // 커널 G.top 에는 PCB 재순환이 미리 구워져 있다(bakeRecycle) — LED·노드당 표본 1회.
  const addLed = (G, lx, ly, w, mx, my, wallAxis) => {
    const K = G.top, kn = G.kn, kc = G.kc, is = 1 / G.s;
    for (let b = 0; b < NY; b++) {
      const dy = y0 + b * stepY - ly, fb = my * dy * is + kc, b0 = Math.floor(fb);
      if (b0 < 0 || b0 + 1 >= kn) continue;
      const tb = fb - b0, r0 = b0 * kn, r1 = r0 + kn, row = b * NX;
      for (let a = 0; a < NX; a++) {
        const dx = x0 + a * stepX - lx, fa = mx * dx * is + kc, a0 = Math.floor(fa);
        if (a0 < 0 || a0 + 1 >= kn) continue;
        const ta = fa - a0;
        let f = w;
        if (wallAxis) f *= fresnelR((wallAxis === 1 ? Math.abs(dx) : Math.abs(dy)) / Math.sqrt(dx * dx + dy * dy + hGap * hGap), n);
        field[row + a] += f * ((K[r0 + a0] * (1 - ta) + K[r0 + a0 + 1] * ta) * (1 - tb) + (K[r1 + a0] * (1 - ta) + K[r1 + a0 + 1] * ta) * tb);
      }
    }
  };

  // ---- 장면(열린 영역 'open' / 실제 벽·측면 'real')과 PSF 추적 ----
  // 필요한 PSF 를 먼저 열거(enum)하고 풀이 있으면 한 번에 병렬 추적(raw), 없으면 필요할 때 순차 추적. 같은 입력 → 같은 결과.
  const margin = Math.max(20, 3 * depth);
  const sceneOf = (kind) => {
    const key = `${geom.key}|${kind}`;
    let S = _sceneCache.get(key);
    if (!S) {
      S = kind === 'open' ? openScene(geom, depth, n, mua, margin)
        : makeScene({ hf: geom.hf, ox: geom.ox, oy: geom.oy, depth, n, medium: { mus: 0, g: 0, mua }, rhoB: 0, walls: { ...geom.walls, mode: 'fresnel', n } });
      if (_sceneCache.size > 6) _sceneCache.clear();
      _sceneCache.set(key, S);
    }
    return S;
  };
  const lmL = ledModel({ model: 'lambertian', beamX: 120 });
  const recF = () => { const f0 = Math.max(1, Math.min(6, Math.floor(hGap / (2 * s)))); return f0 % 2 ? f0 : f0 - 1 || 1; };
  const ledOpts = { ...tq, Nt, Np, half, s, sSub: sE };
  // 재순환은 매끄러운 성분 — 가벼운 설정, 굽기와 같은 거친 간격(f·s ≤ h/2)으로 추적
  const recOpts = () => ({ maxLevel: 3, sub: 2, midCheck: false, nsMax: 1, wCutRel: 3e-3, Nt: FQ.recNt, Np: 2 * FQ.recNt, half, s: recF() * s, sSub: Math.max(sE, recF() * s) });
  const raw = new Map();        // 키 → { G, ledger } (일괄 추적 결과)
  let enumMode = false;
  const want = new Map();       // 키 → { kind, x, y, rec }
  const trace = (key, kind, x, y, rec) => {
    const hit = raw.get(key);
    if (hit) { raw.delete(key); return hit; }
    traced++;
    return rec ? tracePsf(sceneOf(kind), { x, y }, lmL, 1 / lmL.solid, recOpts()) : tracePsf(sceneOf(kind), { x, y }, lm, I0, ledOpts);
  };
  let recPos = [{ x: wcx, y: wcy }], phaseOf = null, recKind = 'open';
  const recPsf = (p) => {
    const key = `${geom.key}|rec|${fidelity}|${recKind}|${p.x.toFixed(3)},${p.y.toFixed(3)}|${stepX.toFixed(5)}|${stepY.toFixed(5)}|${half.toFixed(3)}|${n}|${mua}`;
    let Gp = _psfCache.get(key);
    if (Gp) return Gp;
    if (enumMode) { want.set(key, { kind: recKind, x: p.x, y: p.y, rec: true }); return null; }
    const r = trace(key, recKind, p.x, p.y, true);
    Gp = { kn: r.G.kn, kc: r.G.kc, s: r.G.s, top: r.G.top, Pp: r.ledger.pcb / r.ledger.emitted };
    if (_psfCache.size >= 64) _psfCache.delete(_psfCache.keys().next().value);
    _psfCache.set(key, Gp);
    return Gp;
  };
  const finish = (G) => {
    bakeRecycle(G, rhoB, rhoB > 0 ? { list: recPos.map(recPsf), phaseOf } : null, hGap);
    tentFilter(G, pre(stepX), NY > 1 ? pre(stepY) : 0);
  };
  const psfKey = (kind, x, y) => `${geom.key}|${kind}|${fidelity}|${x.toFixed(4)}|${y.toFixed(4)}|${Nt}|${Np}|${stepX.toFixed(5)}|${stepY.toFixed(5)}|${half.toFixed(3)}|${n}|${mua}|${led.model}|${led.beamX}|${I0}|${rhoB}`;
  let ledKind = 'open';
  const psfAt = (x, y) => {
    const gk = psfKey(ledKind, x, y);
    let G = _psfCache.get(gk);
    if (G) return G;
    if (enumMode) { want.set(gk, { kind: ledKind, x, y, rec: false }); return { pending: gk }; }
    const r = trace(gk, ledKind, x, y, false);
    for (const k in ledgerSum) ledgerSum[k] += r.ledger[k];
    G = r.G; finish(G);
    if (_psfCache.size >= 48) _psfCache.delete(_psfCache.keys().next().value);
    _psfCache.set(gk, G);
    return G;
  };

  // ---- LED → (PSF, 가중, 거울 부호) 사상 구성 (모드별) ----
  let images = true;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const lxs = [...new Set(leds.map((l) => r6(l.x)))].sort((a, b) => a - b), lys = [...new Set(leds.map((l) => r6(l.y)))].sort((a, b) => a - b);
  const buildWeights = () => {
    if (exact) {   // 검증·불러온 몸체: LED 마다 실제 장면(Fresnel 캐비티 벽·몸체 측면) 추적
      images = false; ledKind = 'real'; recKind = 'real';
      return (l) => [[psfAt(l.x, l.y), 1, 1, 1]];
    }
    // 주기 형상(L4 국부 렌즈): 경사가 빛을 몸체에 가두고(TIR) 그 빛이 몸체 외곽 측면에서 되돌아오므로 열린 영역 PSF + 거울
    // (공기 경로 Fresnel)로는 그 몫을 잃는다(VS7 L4 −4%). → LED 등급(벽에서 0·1번째 열, 내부)별 앵커를 실제 장면(캐비티 벽·
    // 외곽 측면 포함)에서 추적하고 같은 등급 LED 는 평행이동. 거울 대칭이면 1/4 만.
    // 탐색 정밀도는 열린 영역 단일 PSF + 거울(균일도 ±1%p, 평균은 −4% 까지 — 탐색 판정은 균일도), 최종안은 full 로 재검증
    if (fidelity === 'full' && geom.periodic && lxs.length * lys.length === leds.length && leds.length > 1) {
      images = false; ledKind = 'real'; recKind = 'real';
      const anc = (i, nn) => (nn <= 5 || i <= 1 || i >= nn - 2 ? i : Math.floor((nn - 1) / 2));
      const midL = { x: lxs[Math.floor((lxs.length - 1) / 2)], y: lys[Math.floor((lys.length - 1) / 2)] };
      const gx = lxs.length > 1 ? lxs[1] - lxs[0] : 0, gy = NY > 1 && lys.length > 1 ? lys[1] - lys[0] : 0, Q = FQ.recQ;
      if (gx > 0) {   // 재순환 위상(내부 LED 기준 단위 셀)
        recPos = []; for (let qj = 0; qj < (gy > 0 ? Q : 1); qj++) for (let qi = 0; qi < Q; qi++) recPos.push({ x: midL.x + (qi / Q) * gx, y: midL.y + (qj / Q) * gy });
        const ph = (d, g) => (g > 0 ? ((Math.round((((d % g) + g) % g) / g * Q) % Q)) : 0);
        phaseOf = (dx, dy) => ph(dy, gy) * Q + ph(dx, gx);
      }
      const Gs = new Map(), idx = new Map(lxs.map((v, k) => [v, k])), idy = new Map(lys.map((v, k) => [v, k]));
      return (l) => {
        let ai = anc(idx.get(r6(l.x)), lxs.length), aj = anc(idy.get(r6(l.y)), lys.length), mx = 1, my = 1;
        if (symmetric) { if (ai > (lxs.length - 1) / 2) { ai = lxs.length - 1 - ai; mx = -1; } if (aj > (lys.length - 1) / 2) { aj = lys.length - 1 - aj; my = -1; } }
        const key = ai * 100000 + aj;
        if (!Gs.has(key)) Gs.set(key, psfAt(lxs[ai], lys[aj]));
        return [[Gs.get(key), 1, mx, my]];
      };
    }
    ledKind = 'open'; recKind = 'open';
    if (uniform) {
      let a = { x: wcx, y: wcy };
      if (geom.periodic && leds.length) {
        a = leds.reduce((b, l) => (Math.hypot(l.x - wcx, l.y - wcy) < Math.hypot(b.x - wcx, b.y - wcy) ? l : b));
        // 재순환 위상: 단위 셀 위치마다 PCB Lambertian PSF — 포켓 반사분이 LED 주변 PCB 로 돌아와 그 렌즈를 다시 지나는
        // 위치 의존성을 보존(대표 위치 평균은 이를 지워 균일도를 과대평가, VS7 L4). PCB 지도는 오프셋의 셀 내 위상으로 나눈다.
        const gap = (key) => { let d = Infinity; for (const l of leds) { const v = Math.abs(l[key] - a[key]); if (v > 1e-6 && v < d) d = v; } return Number.isFinite(d) ? d : 0; };
        const gx = gap('x'), gy = NY > 1 ? gap('y') : 0, Q = FQ.recQ;
        if (gx > 0) {
          recPos = []; for (let qj = 0; qj < (gy > 0 ? Q : 1); qj++) for (let qi = 0; qi < Q; qi++) recPos.push({ x: a.x + (qi / Q) * gx, y: a.y + (qj / Q) * gy });
          const ph = (d, g) => (g > 0 ? ((Math.round((((d % g) + g) % g) / g * Q) % Q)) : 0);
          phaseOf = (dx, dy) => ph(dy, gy) * Q + ph(dx, gx);
        }
      }
      let one = null;
      return () => (one ??= [[psfAt(a.x, a.y), 1, 1, 1]]);
    }
    const step = anchorStep ?? Math.max(depth, Math.max(Wx, Wy) / 6);
    const Kx = Math.max(2, Math.min(8, Math.round(Wx / step))), Ky = NY > 1 ? Math.max(2, Math.min(8, Math.round(Wy / step))) : 1;
    const ax = Array.from({ length: Kx }, (_, k) => geom.walls.x0 + ((k + 0.5) / Kx) * Wx), ay = Array.from({ length: Ky }, (_, k) => geom.walls.y0 + ((k + 0.5) / Ky) * Wy);
    const Gs = new Map();
    const G_at = (i, j) => {
      let mi = i, mj = j, mx = 1, my = 1;
      if (symmetric) { if (i > (Kx - 1) / 2) { mi = Kx - 1 - i; mx = -1; } if (j > (Ky - 1) / 2) { mj = Ky - 1 - j; my = -1; } }
      const key = mi * 100 + mj;
      if (!Gs.has(key)) Gs.set(key, psfAt(ax[mi], ay[mj]));
      return [Gs.get(key), mx, my];
    };
    const lin = (arr, v) => {   // 앵커 좌표 쌍선형 가중(양끝 밖은 끝 앵커)
      if (arr.length === 1 || v <= arr[0]) return [[0, 1]];
      if (v >= arr.at(-1)) return [[arr.length - 1, 1]];
      const k = Math.min(arr.length - 2, Math.floor((v - arr[0]) / (arr[1] - arr[0]))), u = (v - arr[k]) / (arr[k + 1] - arr[k]);
      return [[k, 1 - u], [k + 1, u]];
    };
    return (l) => {
      const out = [];
      for (const [i, wi] of lin(ax, l.x)) for (const [j, wj] of lin(ay, l.y)) { if (wi * wj <= 0) continue; const [G, mx, my] = G_at(i, j); out.push([G, wi * wj, mx, my]); }
      return out;
    };
  };

  // 1) 열거 → 2) 일괄 병렬 추적(풀이 있고 2개 이상일 때) → 3) 실제 사상으로 합산
  if (pool && pool.size > 1) {
    enumMode = true;
    const wf = buildWeights();
    for (const l of leds) wf(l);
    if (rhoB > 0) recPos.forEach(recPsf);
    enumMode = false;
    const groups = new Map();
    for (const [key, w] of want) { const g = `${w.kind}|${w.rec ? 1 : 0}`; (groups.get(g) ?? groups.set(g, []).get(g)).push([key, w]); }
    for (const [, list] of groups) {
      const kind = list[0][1].kind, rec = list[0][1].rec;
      const desc = { key: `${geom.key}|${kind}`, kind, hf: sharedHf(geom.key, geom.hf), ox: geom.ox, oy: geom.oy, walls: geom.walls, imported: !!geom.imported, depth, n, mua, margin };
      // PSF 마다 고리 묶음 PSF_CHUNKS 개 작업 → 결과를 묶음 순서대로 합산(순차 tracePsf 와 같은 순서 — 비트 동일)
      const tasks = [];
      for (const [, w] of list) for (let c = 0; c < PSF_CHUNKS; c++) tasks.push({ x: w.x, y: w.y, led: rec ? { model: 'lambertian', beamX: 120 } : { model: led.model, beamX: led.beamX }, I0: rec ? 1 / lmL.solid : I0, opts: rec ? recOpts() : ledOpts, chunk: c });
      const res = pool.traceBatch(desc, tasks);
      list.forEach(([key], i) => {
        const r0 = res[i * PSF_CHUNKS], kk = r0.G.kn * r0.G.kn;
        const G = { kc: r0.G.kc, kn: r0.G.kn, s: r0.G.s, top: new Float32Array(kk), pcb: new Float32Array(kk) }, ledger = { emitted: 0, top: 0, pcb: 0, lost: 0, abs: 0, rest: 0 };
        for (let c = 0; c < PSF_CHUNKS; c++) {
          const r = res[i * PSF_CHUNKS + c];
          for (let k = 0; k < kk; k++) { G.top[k] += r.G.top[k]; G.pcb[k] += r.G.pcb[k]; }
          for (const q in ledger) ledger[q] += r.ledger[q];
        }
        raw.set(key, { G, ledger });
      });
      traced += list.length;
    }
  }
  const weightsOf = buildWeights();
  // 직접 + 캐비티 벽 거울(벽에서 3·depth 안의 LED — L1 과 같은 절단)
  const wCut = 3 * depth, { x0: wx0, x1: wx1, y0: wy0, y1: wy1 } = geom.walls;
  for (const l of leds) {
    for (const [G, w, mx, my] of weightsOf(l)) {
      addLed(G, l.x, l.y, w, mx, my, 0);
      if (!images) continue;
      if (l.x - wx0 < wCut) addLed(G, 2 * wx0 - l.x, l.y, w, -mx, my, 1);
      if (wx1 - l.x < wCut) addLed(G, 2 * wx1 - l.x, l.y, w, -mx, my, 1);
      if (NY > 1 && l.y - wy0 < wCut) addLed(G, l.x, 2 * wy0 - l.y, w, mx, -my, 2);
      if (NY > 1 && wy1 - l.y < wCut) addLed(G, l.x, 2 * wy1 - l.y, w, mx, -my, 2);
    }
  }
  const rec = rhoB > 0 ? { h: hGap, Td: diffuseT(n, tMean, mua), tMean } : null;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const st = (globalThis.__shapeStats ??= { calls: 0, traced: 0, ms: 0, leds: 0 }); st.calls++; st.traced += traced; st.ms += t1 - t0; st.leds += leds.length;
  return { field, traced, ledger: ledgerSum, rec, ms: t1 - t0 };
}

// 분리형 가우시안(σ = 셀 단위), 경계 밖은 버림(질량 대부분 내부 — 커널은 영역 대각선을 덮음)
function gaussBlur(A, kn, sig) {
  if (!(sig > 0.3)) return;
  const R = Math.ceil(3 * sig), wt = new Float64Array(2 * R + 1);
  let sum = 0; for (let k = -R; k <= R; k++) { wt[k + R] = Math.exp(-(k * k) / (2 * sig * sig)); sum += wt[k + R]; }
  for (let k = 0; k < wt.length; k++) wt[k] /= sum;
  const tmp = new Float32Array(A.length);
  for (let j = 0; j < kn; j++) for (let i = 0; i < kn; i++) { const v = A[j * kn + i]; if (!v) continue; for (let k = -R; k <= R; k++) { const ii = i + k; if (ii >= 0 && ii < kn) tmp[j * kn + ii] += v * wt[k + R]; } }
  A.fill(0);
  for (let j = 0; j < kn; j++) for (let i = 0; i < kn; i++) { const v = tmp[j * kn + i]; if (!v) continue; for (let k = -R; k <= R; k++) { const jj = j + k; if (jj >= 0 && jj < kn) A[jj * kn + i] += v * wt[k + R]; } }
}

// 텐트(삼각) 필터, 반폭 wx·wy (커널 셀 단위, 분리형) — 노드 값을 평가 간격 텐트 평균으로
function tentFilter(G, wx, wy) {
  const kn = G.kn, A = G.top, tmp = new Float32Array(A.length);
  const pass = (src, dst, w, horiz) => {
    const R = Math.max(0, Math.ceil(w) - 1), wt = [];
    let sum = 0; for (let k = -R; k <= R; k++) { const v = Math.max(0, 1 - Math.abs(k) / w); wt.push(v); sum += v; }
    for (let k = 0; k < wt.length; k++) wt[k] /= sum;
    for (let j = 0; j < kn; j++) for (let i = 0; i < kn; i++) {
      let v = 0;
      for (let k = -R; k <= R; k++) {
        const ii = horiz ? i + k : i, jj = horiz ? j : j + k;
        if (ii < 0 || jj < 0 || ii >= kn || jj >= kn) continue;
        v += wt[k + R] * src[jj * kn + ii];
      }
      dst[j * kn + i] = v;
    }
  };
  if (wx > 1) { pass(A, tmp, wx, true); A.set(tmp); }
  if (wy > 1) { pass(A, tmp, wy, false); A.set(tmp); }
}

// PCB 재순환 1회를 PSF 커널에 굽기: top += ρ_b·T_d·(pcb ⊛ P_h), P_h(r) = h²/(π(r²+h²)²) (Lambertian 갭 전달, 커널 격자 FFT).
// T_d = 평균 두께 평판 확산 투과(가정 패널). 커널 밖으로 나가는 분은 손실.
function bakeRecycle(G, rhoB, rec, h) {
  if (G.baked || !(rhoB > 0) || !rec) { G.baked = true; return; }
  // 거친 격자(중심 정렬, 홀수 f 배, f·s ≤ h/2)에서 합성곱: rec = ρ·Σ_q (PCB 밀도|위상 q ⊛ Gp_q.top)/(1 − ρ·P̄p) — 이후 반사는 기하급수 근사.
  // 범위: PCB 지도는 99.5% 질량 반경 R_A, 재순환 커널은 8h(P_h 꼬리 ~1e-4) — 출력은 R_A + 8h 안(밖은 무시할 만함)
  const kn = G.kn, kc = G.kc, f0 = Math.max(1, Math.min(6, Math.floor(h / (2 * G.s)))), f = f0 % 2 ? f0 : f0 - 1 || 1, cs = f * G.s, Ic = Math.floor(kc / f), cn = 2 * Ic + 1;
  const down = (arr) => {   // 박스 평균(밀도)
    const out = new Float64Array(cn * cn), hf = (f - 1) / 2;
    for (let J = 0; J < cn; J++) for (let I = 0; I < cn; I++) {
      let v = 0, c = 0;
      for (let dj = -hf; dj <= hf; dj++) for (let di = -hf; di <= hf; di++) {
        const i = kc + (I - Ic) * f + di, j = kc + (J - Ic) * f + dj;
        if (i < 0 || j < 0 || i >= kn || j >= kn) continue;
        v += arr[j * kn + i]; c++;
      }
      out[J * cn + I] = c ? v / c : 0;
    }
    return out;
  };
  const A = down(G.pcb);
  // 99.5% 질량 반경(셀 단위)
  const rad = []; let tot = 0;
  for (let J = 0; J < cn; J++) for (let I = 0; I < cn; I++) { const v = A[J * cn + I]; if (v > 0) { rad.push([Math.hypot(I - Ic, J - Ic), v]); tot += v; } }
  if (!(tot > 0)) { G.baked = true; return; }
  rad.sort((a, b) => a[0] - b[0]);
  let accm = 0, RA = rad.at(-1)[0];
  for (const [r, v] of rad) { accm += v; if (accm >= 0.995 * tot) { RA = r; break; } }
  const ra = Math.min(Ic, Math.ceil(RA) + 1), rk = Math.min(Ic, Math.ceil((8 * h) / cs)), ro = Math.min(Ic, ra + rk);
  const W = nextPow2(2 * ro + 1 + 2 * rk);
  const acc = new Float64Array(W * W);
  let Pp = 0;
  for (let q = 0; q < rec.list.length; q++) {
    const Gp = rec.list[q], sk = `spec|${W}|${f}|${rk}`;
    Pp += Gp.Pp / rec.list.length;
    Gp._spec ??= {};
    if (!Gp._spec[sk]) {
      const K2 = 2 * rk + 1, kb = new Float64Array(K2 * K2), is = 1 / Gp.s, T = Gp.top, k = Gp.kn;
      for (let J = -rk; J <= rk; J++) for (let I = -rk; I <= rk; I++) {
        const fa = I * cs * is + Gp.kc, fb = J * cs * is + Gp.kc, a0 = Math.floor(fa), b0 = Math.floor(fb), ta = fa - a0, tb = fb - b0;
        if (a0 < 0 || b0 < 0 || a0 + 1 >= k || b0 + 1 >= k) continue;
        kb[(J + rk) * K2 + I + rk] = ((T[b0 * k + a0] * (1 - ta) + T[b0 * k + a0 + 1] * ta) * (1 - tb) + (T[(b0 + 1) * k + a0] * (1 - ta) + T[(b0 + 1) * k + a0 + 1] * ta) * tb) * cs * cs;
      }
      Gp._spec[sk] = kernelSpectrum(kb, rk, W, W);
    }
    // 입력: 중심 기준 오프셋 (I−Ic, J−Ic) ∈ [−ra, ra] → 패드 위치 (·+ro)
    const pad = new Float64Array(W * W);
    let any = false;
    for (let J = -ra; J <= ra; J++) for (let I = -ra; I <= ra; I++) {
      const v = A[(J + Ic) * cn + I + Ic];
      if (!v || (rec.phaseOf && rec.phaseOf(I * cs, J * cs) !== q)) continue;
      pad[(J + ro) * W + I + ro] = v; any = true;
    }
    if (!any) continue;
    const out = convolve(pad, Gp._spec[sk]);
    for (let k2 = 0; k2 < out.length; k2++) acc[k2] += out[k2];
  }
  const g = rhoB / Math.max(1e-6, 1 - rhoB * Pp);
  // 출력 오프셋 [−ro, ro] → 고운 격자 쌍선형 복원
  const lo = Math.max(0, Math.ceil(kc - ro * f)), hi = Math.min(kn - 1, Math.floor(kc + ro * f));
  for (let j = lo; j <= hi; j++) {
    const fb = (j - kc) / f + ro, b0 = Math.max(0, Math.min(2 * ro - 1, Math.floor(fb))), tb = Math.max(0, Math.min(1, fb - b0));
    for (let i = lo; i <= hi; i++) {
      const fa = (i - kc) / f + ro, a0 = Math.max(0, Math.min(2 * ro - 1, Math.floor(fa))), ta = Math.max(0, Math.min(1, fa - a0));
      const o = b0 * W + a0;
      G.top[j * kn + i] += g * ((acc[o] * (1 - ta) + acc[o + 1] * ta) * (1 - tb) + (acc[o + W] * (1 - ta) + acc[o + W + 1] * ta) * tb);
    }
  }
  G.baked = true;
}
