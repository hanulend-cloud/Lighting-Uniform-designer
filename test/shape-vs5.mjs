// VS5 — 빠른 solver(광선관 PSF) vs 독립 Python 3D 추적기(tools/vs5_tracer2d.py), 압출 단면 + 선광원:
// node test/shape-vs5.mjs [--quick]   기준(사전 고정): 출사 프로파일 bin(1mm) 별 ≤2% (|x − xs| ≤ 3·깊이, Python 상대 σ ≤ 0.5% bin)
// 필터: 두 쪽 모두 출사점을 0.25mm 노드에 쌍선형 분배(텐트) 후 1mm bin 합 — 날카로운 집광선이 bin 경계에 걸려도 같은 필터로 비교.
// 압출 형상은 y 방향 이동불변이라, LED 1개의 PSF 를 y 로 적분한 것이 곧 무한 선광원의 응답이다(중첩 근사 없음 — 추적기 자체 검증).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { heightfieldFromFn } from '../src/engine/shape/heightfield.js';
import { makeScene, _ledModel } from '../src/engine/shape/mc-body.js';
import { tracePsf } from '../src/engine/shape/fast-body.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };
const QUICK = process.argv.includes('--quick');
const pwl = (V, x) => { if (x <= V[0][0]) return V[0][1]; for (let k = 1; k < V.length; k++) if (x <= V[k][0]) { const [a, za] = V[k - 1], [b, zb] = V[k]; return za + ((zb - za) * (x - a)) / (b - a); } return V.at(-1)[1]; };

const depth = 12, n = 1.59, mua = 0.0005, X = 200, Y = 400, cell = 0.25;
const dome = []; for (let x = 0; x <= 200; x += 2) dome.push([x, 12 - ((x - 100) ** 2) / 4000]);
const ONLY = process.env.VS5_CASE;
const cases0 = [
  { name: '비대칭 테이퍼(바닥 1→3→1.5mm)', xs: 85, top: [[0, 12], [200, 12]], bot: [[0, 11], [100, 9], [200, 10.5]] },
  { name: '채널 렌즈(L4 단면: 패드 2.5mm·45° 경사)', xs: 100, top: [[0, 12], [200, 12]], bot: [[0, 9], [91.5, 9], [98, 2.5], [102, 2.5], [108.5, 9], [200, 9]] },
  { name: '돔 윗면(R2000)+바닥 리브', xs: 100, top: dome, bot: [[0, 9], [110, 9], [110.0001, 6], [113, 6], [113.0001, 9], [200, 9]] },
];
const cases = ONLY ? [cases0[+ONLY]] : cases0;
const N = QUICK ? 1e6 : 6e6, lm = _ledModel({ model: 'lambertian', beamX: 120 }), s = 0.25;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs5-'));

const caseJson = cases.map((c, i) => {
  const lo = c.xs - 3 * depth - 4 + 0.125, hi = c.xs + 3 * depth + 4 + 0.125;   // bin 경계는 노드 사이(노드 4개/bin)
  return { name: c.name, X, Y, depth, n, mua, rhoB: 0, xs: c.xs, cell, top: c.top, bot: c.bot, N, seed: 1000 + i, bins: { x0: lo, x1: hi, dx: 1 } };
});
fs.writeFileSync(path.join(tmp, 'case.json'), JSON.stringify({ cases: caseJson }));
const t0 = Date.now();
execFileSync('python', [new URL('../tools/vs5_tracer2d.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), path.join(tmp, 'case.json'), path.join(tmp, 'out.json')], { stdio: 'inherit' });
const py = JSON.parse(fs.readFileSync(path.join(tmp, 'out.json'), 'utf8'));
console.log(`  Python 독립 추적기 ${cases.length}건 × ${N.toExponential(0)} 광자: ${((Date.now() - t0) / 1000).toFixed(0)}s`);

for (const [i, c] of cases.entries()) {
  const hf = heightfieldFromFn(X, Y, cell, (x) => pwl(c.top, x + X / 2) - depth, (x) => pwl(c.bot, x + X / 2) - depth);
  const S = makeScene({ hf, ox: X / 2, oy: Y / 2, depth, n, medium: { mus: 0, g: 0, mua }, rhoB: 0, walls: { x0: 0, x1: X, y0: 0, y1: Y, mode: 'absorb' } });
  const ta = Date.now();
  const { G } = tracePsf(S, { x: c.xs, y: Y / 2 }, lm, 1, { Nt: 24, Np: 48, half: Y / 2 + 2, s, sSub: 0.5, secBlur: 0.1 });
  const ms = Date.now() - ta;
  // 선 프로파일: L(x) = ∫ PSF dy (단위 광속당)
  const L = new Float64Array(G.kn);
  for (let b = 0; b < G.kn; b++) for (let a = 0; a < G.kn; a++) L[a] += (G.top[b * G.kn + a] * s) / lm.solid;
  const P = py[c.name], cb = caseJson[i].bins;
  let worst = 0, cnt = 0, rows = [], all = [];
  for (let k = 0; k < P.M.length; k++) {
    const e0 = cb.x0 + k * cb.dx, e1 = e0 + cb.dx;
    let sv = 0, m = 0;
    for (let a = 0; a < G.kn; a++) { const x = c.xs + (a - G.kc) * s; if (x >= e0 && x < e1) { sv += L[a]; m++; } }
    // 같은 필터 비교: Python 도 출사점을 같은 0.25mm 노드에 쌍선형 분배(텐트) — bin 안 노드 합/폭
    let ref = 0; for (let q = 0; q < P.nodes.length; q++) { const x = c.xs + (q - P.nK) * P.ns; if (x >= e0 && x < e1) ref += P.nodes[q]; }
    ref /= cb.dx;
    const js = (sv / m), sig = P.cnt[k] > 0 ? 1 / Math.sqrt(P.cnt[k]) : 1;
    if (process.argv.includes('--all') && Math.abs(P.x[k] - c.xs) <= 3 * depth) all.push(`${(P.x[k] - c.xs).toFixed(1)}:${(js / ref).toFixed(3)}±${(sig * 100).toFixed(1)}`);
    if (Math.abs(P.x[k] - c.xs) > 3 * depth || sig > 0.005) continue;
    const e = Math.abs(js / ref - 1); cnt++;
    if (e > worst) worst = e;
    if (Math.abs(P.x[k] - c.xs) % 6 < 1) rows.push(`${(P.x[k] - c.xs).toFixed(1)}:${(js / ref).toFixed(3)}`);
  }
  const Lg = P.ledger;
  console.log(`  ${c.name}: Python 상면 ${Lg.top.toFixed(4)}·PCB ${Lg.pcb.toFixed(4)}·측면 ${Lg.side.toFixed(4)}·y밖 ${Lg.ylost.toFixed(4)}·갇힘 ${Lg.stuck.toExponential(1)} | PSF ${ms}ms`);
  console.log('   x−xs:JS/Py ' + rows.join(' '));
  if (all.length) console.log('   전체: ' + all.join(' '));
  ok(cnt > 20 && worst <= 0.02, `VS5 ${c.name}: ${cnt} bin 최대 차 ${(worst * 100).toFixed(2)}% (≤2%)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.log(`\n${fail} FAIL`); process.exit(1); }
console.log('\nall PASS');
