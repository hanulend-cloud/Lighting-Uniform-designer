// S1 형상 몸체 MC 기준 추적기 검증 (spec 2026-10-10 §5 VS1·VS2·VS3·VS6): node test/shape-mc.mjs [--quick]
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { makeScene, traceRay, runBodyMC, ledFlux } from '../src/engine/shape/mc-body.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const QUICK = process.argv.includes('--quick');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const run = (id) => !only || only.split(',').includes(id);

// 독립 Fresnel(s·p 진폭식) — 구현(photometry.fresnelR)과 별개로 작성
function fresnelIndep(cosI, n1, n2) {
  const sinT = (n1 / n2) * Math.sqrt(1 - cosI * cosI);
  if (sinT >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT * sinT);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT), rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}

// ---- VS3: 단일 광선 해석식 (쐐기) ----
if (run('VS3')) {
  const n = 1.59, depth = 10, W = 20;
  let e3 = 0;
  for (const aDeg of [5, 20, 35, 45]) {
    const ta = Math.tan(aDeg * Math.PI / 180), a = aDeg * Math.PI / 180;
    const hf = heightfieldFromFn(W, W, 0.5, (x) => ta * x - 4, () => -7);   // 윗면 경사(x), 바닥 평탄
    const sc = makeScene({ hf, ox: 10, oy: 10, depth, n });
    const ev = traceRay(sc, [10.3, 10.1, 1], [0, 0, 1], 4);
    const bot = ev[0], top = ev[1];
    const errs = [Math.abs(bot.p[2] - (depth - 7)), Math.abs(bot.R - fresnelIndep(1, 1, n)), Math.abs(top.p[2] - (depth - 4 + ta * 0.3))];
    const Rt = fresnelIndep(Math.cos(a), n, 1);
    errs.push(Math.abs(top.R - Rt), Math.abs(top.cosI - Math.cos(a)));
    if (n * Math.sin(a) < 1) {
      const dv = Math.asin(n * Math.sin(a)) - a;                 // 편향각 → 출사 방향 (sin dv, 0, cos dv)
      errs.push(Math.abs(top.dOut[0] - Math.sin(dv)), Math.abs(top.dOut[1]), Math.abs(top.dOut[2] - Math.cos(dv)));
    } else {
      const N = [-Math.sin(a), 0, Math.cos(a)], dn = Math.cos(a);       // TIR: 정반사 d − 2(d·N)N
      errs.push(Math.abs(top.R - 1), Math.abs(top.dOut[0] - (0 - 2 * dn * N[0])), Math.abs(top.dOut[2] - (1 - 2 * dn * N[2])));
    }
    const e = Math.max(...errs); e3 = Math.max(e3, e);
    console.log(`  쐐기 ${aDeg}°: ${n * Math.sin(a) < 1 ? `편향 ${(Math.asin(n * Math.sin(a)) * 180 / Math.PI - aDeg).toFixed(3)}°` : 'TIR'}, 최대 오차 ${e.toExponential(1)}`);
  }
  ok(e3 <= 1e-9, `VS3 단일 광선(Snell·Fresnel·TIR·교점) 해석식 대비 최대 오차 ${e3.toExponential(1)} (≤1e-9)`);
}

// ---- VS3b: 측벽(마스크 경계 수직면) 단일 광선 + VS2b: 복잡 형상(돔·리브·구멍·Fresnel 캐비티 벽·밀키) 장부 ----
if (run('VS3')) {
  const n = 1.5, depth = 10;
  const hf = heightfieldFromFn(20, 20, 0.5, () => 0, () => -4);
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) if (hf.x0 + (i + 0.5) * hf.cell < -5) hf.mask[j * hf.nx + i] = 0;   // x < −5 는 몸체 없음
  const sc = makeScene({ hf, ox: 10, oy: 10, depth, n });
  const th = 30 * Math.PI / 180, d = [Math.cos(th), Math.sin(th), 0];             // 수평면 안에서 30° 입사
  const e = traceRay(sc, [2, 9, 8], d, 2)[0];
  const sinT = Math.sin(th) / n, cosT = Math.sqrt(1 - sinT * sinT);
  const err = Math.max(Math.abs(e.p[0] - 5), Math.abs(e.p[1] - (9 + 3 * Math.tan(th))), Math.abs(e.N[0] + 1), Math.abs(e.R - fresnelIndep(Math.cos(th), 1, n)),
    Math.abs(e.dOut[0] - cosT), Math.abs(e.dOut[1] - sinT), Math.abs(e.dOut[2]));
  ok(e.kind === 'side' && err <= 1e-9, `VS3 측벽(공기→몸체 30°): 교점·법선·R·굴절 오차 ${err.toExponential(1)} (≤1e-9)`);
}
if (run('VS2')) {
  const n = 1.59, depth = 9, X = 60, Y = 50;
  const hf = heightfieldFromFn(56, 46, 0.25, (x, y) => -((x * x + y * y) / (2 * 400)), (x) => (Math.abs(x - 8) < 1.5 ? -5 : -2.5));   // 돔 윗면 R400, 바닥 리브(폭 3, 깊이 2.5)
  for (let j = 0; j < hf.ny; j++) for (let i = 0; i < hf.nx; i++) {   // 관통 구멍 6×6
    const x = hf.x0 + (i + 0.5) * hf.cell, y = hf.y0 + (j + 0.5) * hf.cell;
    if (Math.abs(x + 12) < 3 && Math.abs(y - 6) < 3) hf.mask[j * hf.nx + i] = 0;
  }
  const sc = makeScene({ hf, ox: X / 2, oy: Y / 2, depth, n, medium: { mus: 8, g: 0.9, mua: 0.003 }, rhoB: 0.5, walls: { x0: 0, x1: X, y0: 0, y1: Y, mode: 'fresnel' } });
  const leds = []; for (let y = 5; y < Y; y += 10) for (let x = 5; x < X; x += 10) leds.push({ x, y });
  const led = { model: 'lambertian', beamX: 120, sizeX: 1, sizeY: 1, I0: 1 };
  const res = runBodyMC(sc, { leds, led, N: QUICK ? 2e4 : 1e5, seed: 3 });
  const L = res.ledger, sum = L.top + L.side + L.leak + L.wall + L.pcb + L.absBody + L.lost + L.rrLoss - L.rrGain, pc = (v) => (v / L.emitted * 100).toFixed(2);
  ok(Math.abs(sum / L.emitted - 1) <= 1e-9 && L.lost / L.emitted < 1e-4 && Math.abs(L.rrLoss - L.rrGain) / L.emitted <= 0.005 && L.leak > 0 && L.wall > 0,
    `VS2 복잡 형상 장부 폐합 ${Math.abs(sum / L.emitted - 1).toExponential(1)}, 갇힘 ${pc(L.lost)}%, 룰렛 ${pc(L.rrLoss - L.rrGain)}% — 상면 ${pc(L.top)}·구멍/누설 ${pc(L.leak)}·측면 ${pc(L.side)}·벽 ${pc(L.wall)}·PCB ${pc(L.pcb)}·흡수 ${pc(L.absBody)}% (${(res.ms / 1000).toFixed(1)}s)`);
}

// ---- VS1·VS2: 투명 평판 점광원 vs 반해석(2계면 Fresnel·흡수·내부 다중반사 급수) ----
if (run('VS1')) {
  const n = 1.59, t = 2, depth = 8, h = depth - t, mua = 0.01, W = 200, cx = 100;
  const hf = heightfieldFromFn(W, W, 1, () => 0, () => -t);
  const sc = makeScene({ hf, ox: cx, oy: cx, depth, n, medium: { mus: 0, g: 0, mua }, rhoB: 0, walls: null });
  const led = { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 };
  const N = QUICK ? 4e5 : 4e6;
  const exits = [];
  const res = runBodyMC(sc, { leds: [{ x: cx, y: cx }], led, N, seed: 7, onExit: (x, y, w, flags) => exits.push(Math.hypot(x - cx, y - cx), w, flags) });
  // 반해석: θ 미세 적분, k 번째 항(내부 반사 2k 회) 은 r_k = h·tanθ + (2k+1)·t·tanθ', 가중 T²R^{2k}·exp(−μa t(2k+1)/cosθ')
  const m = 1, K = 400000, terms = [];
  for (let i = 0; i < K; i++) {
    const th = ((i + 0.5) / K) * (Math.PI / 2), c = Math.cos(th), s = Math.sin(th);
    const dF = Math.pow(c, m) * 2 * Math.PI * s * (Math.PI / 2 / K);
    const R = fresnelIndep(c, 1, n), T = 1 - R, sT = s / n, cT = Math.sqrt(1 - sT * sT);
    for (let k = 0; k < 6; k++) terms.push(h * Math.tan(th) + (2 * k + 1) * t * sT / cT, dF * T * T * R ** (2 * k) * Math.exp(-mua * t * (2 * k + 1) / cT), k);
  }
  // 등광속 bin (직진 성분 기준 0~95%, 5% 간격)
  const dir = []; for (let q = 0; q < terms.length; q += 3) if (terms[q + 2] === 0) dir.push([terms[q], terms[q + 1]]);
  dir.sort((a, b) => a[0] - b[0]);
  const totD = dir.reduce((a, v) => a + v[1], 0), edges = [0];
  let acc = 0; for (const [r, f] of dir) { acc += f; if (acc >= totD * 0.05 * edges.length && edges.length < 20) edges.push(r); }
  const bin = (r) => { for (let b = edges.length - 2; b >= 0; b--) if (r >= edges[b]) return r < edges[b + 1] ? b : -1; return -1; };
  const B = edges.length - 1, aD = new Float64Array(B), aT = new Float64Array(B), mD = new Float64Array(B), mT = new Float64Array(B);
  for (let q = 0; q < terms.length; q += 3) { const b = bin(terms[q]); if (b >= 0) { aT[b] += terms[q + 1]; if (terms[q + 2] === 0) aD[b] += terms[q + 1]; } }
  for (let q = 0; q < exits.length; q += 3) { const b = bin(exits[q]); if (b >= 0) { mT[b] += exits[q + 1]; if (exits[q + 2] === 0) mD[b] += exits[q + 1]; } }
  let eD = 0, eT = 0;
  for (let b = 0; b < B; b++) { eD = Math.max(eD, Math.abs(mD[b] / aD[b] - 1)); eT = Math.max(eT, Math.abs(mT[b] / aT[b] - 1)); }
  const totA = terms.reduce((a, v, q) => (q % 3 === 1 ? a + v : a), 0), eTot = Math.abs(res.ledger.top / totA - 1);
  const tol = QUICK ? 0.03 : 0.01;
  ok(eD <= tol, `VS1 직진 출사도: 등광속 ${B} bin 최대 오차 ${(eD * 100).toFixed(2)}% (≤${tol * 100}%)`);
  ok(eT <= tol && eTot <= tol / 2, `VS1 전체(내부 다중반사 포함): bin 최대 ${(eT * 100).toFixed(2)}%, 총 출사 ${(eTot * 100).toFixed(3)}% (≤${tol * 100}%·${tol * 50}%)`);
  // VS2 장부
  const L = res.ledger, sum = L.top + L.side + L.leak + L.wall + L.pcb + L.absBody + L.lost + L.rrLoss - L.rrGain;
  ok(Math.abs(sum / L.emitted - 1) <= 1e-9 && Math.abs(L.rrLoss - L.rrGain) / L.emitted <= 0.005 && Math.abs(L.emitted / ledFlux(led) - 1) < 1e-9,
    `VS2 장부 폐합 ${Math.abs(sum / L.emitted - 1).toExponential(1)} (≤1e-9), 룰렛 순손익 ${((L.rrLoss - L.rrGain) / L.emitted * 100).toFixed(3)}% (≤0.5%) — 상면 ${(L.top / L.emitted * 100).toFixed(1)}%·PCB ${(L.pcb / L.emitted * 100).toFixed(1)}%·체적흡수 ${(L.absBody / L.emitted * 100).toFixed(2)}%·측면 ${(L.side / L.emitted * 100).toFixed(2)}%`);
  console.log(`  (${N.toExponential(0)} 광자, ${res.ms.toFixed(0)}ms)`);
}

// ---- VS6: 밀키 평판 MC vs L2 PSF solver (열린 영역 — PSF 가 가정하는 이동불변계) ----
// 단일 LED 반경 출사도(MC 16 worker, 반경 bin) 와 PSF 반경 평균을 비교하고, 둘을 같은 방식으로 LED 배열에
// 중첩해 중심 피치셀의 평균·균일도(min/max)를 비교한다(선형 중첩이므로 배열 MC 와 동치, 통계는 단일 LED 전체 사용).
if (run('VS6')) {
  const { Worker } = await import('node:worker_threads');
  const { loadTable } = await import('./l2-util.mjs');
  const { l2Material } = await import('../src/engine/l2/material.js');
  const { systemPsf } = await import('../src/engine/l2/psf.js');
  const table = loadTable();
  const n = 1.59, t = 2, depth = 10, h = depth - t, rhoB = 0.5, W = 200, dr = 0.5, nr = 160, pitch = 10;
  const led = { model: 'lambertian', beamX: 120, sizeX: 0, sizeY: 0, I0: 1 };
  const NW = 16, Nper = QUICK ? 6e4 : 2.4e5;
  const annA = (k) => Math.PI * (((k + 1) * dr) ** 2 - (k * dr) ** 2);
  for (const milky of (process.env.MILKY ? [+process.env.MILKY] : [3, 7])) {
    const mat = l2Material(table, milky, n), medium = { mus: mat.musR / (1 - mat.g), g: mat.g, mua: mat.mua };
    const psf = systemPsf({ table, mat, t, h, rhoB, intensity: (c) => c, intensityKey: 'lam1', I0: 1, extentX: W, extentY: W, step: 0.5 });
    // PSF 반경 광속: annulus 마다 극좌표 표본(반경 8 × 각 64, 면적 가중)에서 쌍선형 값의 평균 × 면적
    const K = psf.K, pH = new Float64Array(nr);
    const bil = (x, y) => {
      const fa = (x - K.dxMin) / K.stepX, fb = (y - K.dyMin) / K.stepY, a0 = Math.floor(fa), b0 = Math.floor(fb), ta = fa - a0, tb = fb - b0;
      if (a0 < 0 || b0 < 0 || a0 + 1 >= K.kNx || b0 + 1 >= K.kNy) return 0;
      const d = K.data, w = K.kNx;
      return d[b0 * w + a0] * (1 - ta) * (1 - tb) + d[b0 * w + a0 + 1] * ta * (1 - tb) + d[(b0 + 1) * w + a0] * (1 - ta) * tb + d[(b0 + 1) * w + a0 + 1] * ta * tb;
    };
    for (let k = 0; k < nr; k++) {
      let sv = 0, sw = 0;
      for (let m = 0; m < 8; m++) {
        const r = Math.sqrt((k * dr) ** 2 + ((m + 0.5) / 8) * (((k + 1) * dr) ** 2 - (k * dr) ** 2));   // 등면적 반경
        for (let a = 0; a < 64; a++) { const ph = (2 * Math.PI * (a + 0.5)) / 64 + m * 0.1; sv += bil(r * Math.cos(ph), r * Math.sin(ph)); sw++; }
      }
      pH[k] = (sv / sw) * annA(k);
    }
    const res = await Promise.all(Array.from({ length: NW }, (_, i) => new Promise((ok2, bad) => {
      const w = new Worker(new URL('./shape-mc-worker.mjs', import.meta.url), { workerData: { W, t, depth, n, medium, rhoB, led, N: Nper, seed: 101 + i * 7919, dr, nr } });
      w.on('message', ok2); w.on('error', bad);
    })));
    const mH = new Float64Array(nr); let top = 0, em = 0, ms = 0;
    for (const r of res) { for (let k = 0; k < nr; k++) mH[k] += r.hist[k] / NW; top += r.ledger.top; em += r.ledger.emitted; ms = Math.max(ms, r.ms); }
    // 배열 중첩(15×15, 피치 10) → 중심 셀 21×21 점
    const prof = (H) => (r) => { const f = r / dr - 0.5, k = Math.max(0, Math.min(nr - 2, Math.floor(f))), u = Math.max(0, Math.min(1, f - k)); return (H[k] / annA(k)) * (1 - u) + (H[k + 1] / annA(k + 1)) * u; };
    const field = (H) => {
      const M = prof(H), v = [];
      for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
        const x = (i / 20 - 0.5) * pitch, y = (j / 20 - 0.5) * pitch; let s = 0;
        for (let b = -7; b <= 7; b++) for (let a = -7; a <= 7; a++) s += M(Math.hypot(x - a * pitch, y - b * pitch));
        v.push(s);
      }
      const mean = v.reduce((p, q) => p + q, 0) / v.length;
      return { mean, U: Math.min(...v) / Math.max(...v) };
    };
    const fM = field(mH), fP = field(pH);
    const per = res.map((r) => field(r.hist)), sdMean = Math.sqrt(per.reduce((p, q) => p + (q.mean / fM.mean - 1) ** 2, 0) / (NW - 1) / NW);
    const sdU = Math.sqrt(per.reduce((p, q) => p + (q.U - fM.U) ** 2, 0) / (NW - 1) / NW);
    // 누적 광속 r ≤ 2·depth (커널 폭 비교)
    const cum = (H, R) => H.slice(0, Math.round(R / dr)).reduce((p, q) => p + q, 0);
    const eMean = Math.abs(fM.mean / fP.mean - 1), eU = Math.abs(fM.U - fP.U);
    console.log(`  Milky ${milky} (μs' ${mat.musR.toFixed(3)}/mm): 투과 MC ${(top / em).toFixed(4)} vs PSF ${psf.trans.toFixed(4)} (꼬리 ${(psf.tailFlux / psf.energy.input).toFixed(4)}) · r≤${2 * depth}mm 광속 MC ${cum(mH, 2 * depth).toFixed(4)} vs PSF ${cum(pH, 2 * depth).toFixed(4)} · ${NW}×${Nper.toExponential(0)} 광자 ${(ms / 1000).toFixed(0)}s`);
    if (process.argv.includes('--prof')) {
      const pM = prof(mH), pP = prof(pH);
      console.log('   r(mm)  MC     PSF    비');
      for (const r of [0.25, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 30, 40]) console.log(`   ${String(r).padStart(5)}  ${pM(r).toExponential(3)} ${pP(r).toExponential(3)} ${(pM(r) / pP(r)).toFixed(3)}`);
    }
    ok(eMean <= 0.03 && eU <= 0.02, `VS6 Milky ${milky}: 중심 피치셀 평균 차 ${(eMean * 100).toFixed(2)}% (σ ${(sdMean * 100).toFixed(2)}%, ≤3%), 균일도 MC ${(fM.U * 100).toFixed(1)}% vs PSF ${(fP.U * 100).toFixed(1)}% 차 ${(eU * 100).toFixed(2)}%p (σ ${(sdU * 100).toFixed(2)}%p, ≤2%p)`);
  }
}

if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
