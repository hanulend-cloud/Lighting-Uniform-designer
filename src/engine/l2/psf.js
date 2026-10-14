// L2 시스템 PSF — LED 1개가 만드는 상면 출사도(직진 + 산란 투과 + 재순환)를 캐비티 solver 로 한 번 계산해
// 캐시한다 (A2 PSF 방식). 벽 없는 열린 영역(기구 크기의 2배)에서 풀어 무한 평면 응답을 얻고, 실제 벽은
// directLit 가 거울 LED 로 더한다. 캐비티는 벽을 빼면 선형·이동불변이라 이 중첩은 같은 solver 의 결과와 같다.
import { solveCavity, twoScale } from './cavity-solver.js';
import { bandIrradiance } from './incident.js';
import { checkResult } from './validator.js';
import { normalRadianceFactor } from './slab-table.js';

const cache = new Map();
// 2단 격자: 가는 중앙 커널(fine)을 K 에 붙인다 — sampleK 가 중앙 범위 안이면 가는 격자를 읽는다
export function withFine(K, fine, field) {
  if (!fine) return K;
  const f = fine;
  K.fine = { data: f[field], kNx: f.nx, kNy: f.ny, dxMin: -((f.nx - 1) / 2) * f.s, dyMin: -((f.ny - 1) / 2) * f.s, stepX: f.s, stepY: f.s, hx: f.hx, hy: f.hy };
  return K;
}
// 셀 180: 거친 격자 + 커널 여백이 FFT 256 에 들어가게(255 면 512 로 넘어가 4배 느림). 중앙은 2단 격자의 가는 해가 담당 — 정확도 불변(배열 U 54.4%).
const MAX_CELLS = +(globalThis.__psfCells ?? 180);
// 경사 입사 측방 시프트(셀별 기하 + 행별 전방 비) — 형상 MC(VS6)로 확인된 물리. 끄기는 검증용
// (다광원 전체 캐비티 solve 와의 중첩 동등성 검사: 그 solve 에는 단일 광원 중심이 없어 시프트를 적용할 수 없다).
let lateralShift = true;
export function setLateralShift(on) { lateralShift = !!on; }

// intensity(cos): LED 상대 광도(정면 1), I0: 정면 광도. extentX/Y: PSF 영역 크기(mm). step: 목표 격자(mm).
export function systemPsf({ table, mat, t, h, rhoB, intensity, intensityKey, I0, extentX, extentY, step, fast = false }) {
  const key = [lateralShift ? 'S' : 'N', fast ? 'F1' : 'F2', table.phaseKey ?? 'HG', mat.musR, mat.g, mat.mua, mat.n, t, h, rhoB, intensityKey, I0, extentX, extentY, step].map((v) => (typeof v === 'number' ? v.toPrecision(6) : v)).join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const run = (s, nx, ny) => {
    const E = bandIrradiance({ sources: [{ x: (nx * s) / 2, y: (ny * s) / 2, I0 }], intensity, h: Math.max(h, 1e-3), nx, ny, step: s, table });
    return solveCavity({ E, nx, ny, step: s, table, mat, t, h, rhoB, rW: 0, uniformTail: false, gapRmax: Math.max(extentX, extentY) / 2, center: lateralShift ? { x: (nx * s) / 2, y: (ny * s) / 2 } : null });
  };
  const T0p = performance.now(), ts = twoScale(run, { extentX, extentY, step, maxCells: MAX_CELLS, single: fast }), { s, nx, ny, res } = ts;
  if (globalThis.__l2perf) { globalThis.__l2perf.psf++; globalThis.__l2perf.psfMs += performance.now() - T0p; }
  const tauR = mat.musR * t, muaT = mat.mua * t;
  const qn = table.query(tauR, mat.g, mat.n, 0, muaT), qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const sum = (a) => a.reduce((p, v) => p + v, 0);
  const sS = sum(res.Mscat), sR = sum(res.Mrec);
  const fScat = sS + sR > 0 ? (sS * normalRadianceFactor(qn.ang) + sR * normalRadianceFactor(qd.ang)) / (sS + sR) : 1 / Math.PI;
  const K = (data, fd) => withFine({ data, kNx: nx, kNy: ny, dxMin: -((nx - 1) / 2) * s, dyMin: -((ny - 1) / 2) * s, stepX: s, stepY: s }, ts.fine, fd);
  // 99% 에너지 반경 — 거울 LED 컷오프용
  const c = (nx - 1) / 2, cy = (ny - 1) / 2, tot = sum(res.M), rings = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) rings.push([Math.hypot(i - c, j - cy) * s, res.M[j * nx + i]]);
  rings.sort((a, b) => a[0] - b[0]);
  let acc = 0, r99 = rings.at(-1)[0];
  for (const [r, v] of rings) { acc += v; if (acc >= 0.99 * tot) { r99 = r; break; } }
  const out = {
    key, K: K(res.M, 'M'), Kball: K(res.Mball, 'Mball'), step: s,
    tailFlux: res.tail * s * s,                                   // 원거리 도광 성분(플럭스) — 기구 면적에 균일 분배
    trans: (res.energy.top + res.tail) / res.energy.input,        // 시스템 투과율(상면 출사 / 슬래브 하면 입사)
    fScat, qn, qd, rW: qd.R, r99, check: checkResult(res), energy: res.energy,
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

// 무한 평면 시스템 투과율(닫힌 해) — PSF 없이 tMin 탐색용. LED 광속을 입사각 밴드로 나눈 분율 f_b 로
// T_sys = Σ f_b(Tb+Ts)_b + T_d·ρ·Σ f_b R_b / (1 − ρ R_d). (PSF 는 여기에 커널 절단 손실 ~1% 만 다름)
export function systemTransFast({ table, mat, t, rhoB, intensity }) {
  const tauR = mat.musR * t, muaT = mat.mua * t, f = new Float64Array(table.angleRows);
  const K = 900;
  for (let i = 0; i < K; i++) {
    const th = ((i + 0.5) / K) * (Math.PI / 2), c = Math.cos(th);
    const [b0, b1, w1] = table.bandSplit(c), v = intensity(c) * Math.sin(th);   // ∝ ∫ I(θ) dΩ (조도 입사각 = 방출각)
    f[b0] += v * (1 - w1); f[b1] += v * w1;
  }
  const tot = f.reduce((a, v) => a + v, 0);
  let T = 0, R = 0;
  for (let b = 0; b < f.length; b++) {
    if (!(f[b] > 0)) continue;
    const q = table.query(tauR, mat.g, mat.n, b, muaT);
    T += (f[b] / tot) * (q.Tb + q.Ts); R += (f[b] / tot) * q.R;
  }
  const qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  return T + (qd.Tb + qd.Ts) * rhoB * R / (1 - rhoB * qd.R);
}
