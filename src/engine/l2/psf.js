// L2 시스템 PSF — LED 1개가 만드는 상면 출사도(직진 + 산란 투과 + 재순환)를 캐비티 solver 로 한 번 계산해
// 캐시한다 (A2 PSF 방식). 벽 없는 열린 영역(기구 크기의 2배)에서 풀어 무한 평면 응답을 얻고, 실제 벽은
// directLit 가 거울 LED 로 더한다. 캐비티는 벽을 빼면 선형·이동불변이라 이 중첩은 같은 solver 의 결과와 같다.
import { solveCavity } from './cavity-solver.js';
import { bandIrradiance } from './incident.js';
import { checkResult } from './validator.js';
import { normalRadianceFactor } from './slab-table.js';

const cache = new Map();
const MAX_CELLS = 255;

// intensity(cos): LED 상대 광도(정면 1), I0: 정면 광도. extentX/Y: PSF 영역 크기(mm). step: 목표 격자(mm).
export function systemPsf({ table, mat, t, h, rhoB, intensity, intensityKey, I0, extentX, extentY, step }) {
  const s = Math.max(step, extentX / MAX_CELLS, extentY / MAX_CELLS);
  const odd = (v) => { const k = Math.max(3, Math.ceil(v)); return k % 2 ? k : k + 1; };
  const nx = odd(extentX / s), ny = odd(extentY / s);
  const key = [mat.musR, mat.g, mat.mua, mat.n, t, h, rhoB, intensityKey, I0, nx, ny, s].map((v) => (typeof v === 'number' ? v.toPrecision(6) : v)).join('|');
  const hit = cache.get(key);
  if (hit) return hit;

  const E = bandIrradiance({ sources: [{ x: (nx * s) / 2, y: (ny * s) / 2, I0 }], intensity, h: Math.max(h, 1e-3), nx, ny, step: s, table });
  const res = solveCavity({ E, nx, ny, step: s, table, mat, t, h, rhoB, rW: 0, uniformTail: false, gapRmax: Math.max(extentX, extentY) / 2 });
  const tauR = mat.musR * t, muaT = mat.mua * t;
  const qn = table.query(tauR, mat.g, mat.n, 0, muaT), qd = table.query(tauR, mat.g, mat.n, table.diffuseRow, muaT);
  const sum = (a) => a.reduce((p, v) => p + v, 0);
  const sS = sum(res.Mscat), sR = sum(res.Mrec);
  const fScat = sS + sR > 0 ? (sS * normalRadianceFactor(qn.ang) + sR * normalRadianceFactor(qd.ang)) / (sS + sR) : 1 / Math.PI;
  const K = (data) => ({ data, kNx: nx, kNy: ny, dxMin: -((nx - 1) / 2) * s, dyMin: -((ny - 1) / 2) * s, stepX: s, stepY: s });
  // 99% 에너지 반경 — 거울 LED 컷오프용
  const c = (nx - 1) / 2, cy = (ny - 1) / 2, tot = sum(res.M), rings = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) rings.push([Math.hypot(i - c, j - cy) * s, res.M[j * nx + i]]);
  rings.sort((a, b) => a[0] - b[0]);
  let acc = 0, r99 = rings.at(-1)[0];
  for (const [r, v] of rings) { acc += v; if (acc >= 0.99 * tot) { r99 = r; break; } }
  const out = {
    key, K: K(res.M), Kball: K(res.Mball), step: s,
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
    f[table.bandOf(c)] += intensity(c) * Math.sin(th);      // ∝ ∫ I(θ) dΩ (조도 입사각 = 방출각)
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
