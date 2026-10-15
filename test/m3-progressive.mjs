// 점진 계산 제어기(가짜 Worker 포트 + Worker 모의 동등성): node test/m3-progressive.mjs
import { createProgressive, chunkSeed, photometry } from '../src/ui/m3/progressive.js';
import { runJob } from '../src/engine/mech3d/job.js';
import { makeChunkHost } from '../src/engine/mech3d/chunk-host.js';
import { lightData } from '../src/engine/mech3d/line.js';
import { tallyStats } from '../src/engine/mech3d/tally.js';
import { loadTable } from './l2-util.mjs';
import { plateFixture } from './m3-fixture.mjs';
import { fakeTimers, settle } from './m3-timers.mjs';
import { ok, done } from './mech3d-util.mjs';

// 합성 집계 격자: s 4칸 × w 2칸, 모두 유효·면적 1mm²
const G = { ns: 4, nw: 2, ds: 1, cell: 1, w0: -1, valid: new Uint8Array(8).fill(1), area: new Float64Array(8).fill(1), L: 4, closed: false, winS: 2 };
const obs = { faces: [], cone: 90, targetLen: 0.8, targetWid: 0.8 };
const job = (k) => ({ sceneKey: `s${k}`, scene: { tag: k }, G, obs, nLeds: 2, fluxLm: 0 });
const LED = { emitted: 1, escaped: 0.5, absSurf: 0.5, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
// 응답: 첫 s 칸(셀 0,1) = 0.85, 나머지 1 — 시드마다 ±0.2% 흔들림 → 길이 U ≈ 0.85, 잡음 ≪ 2%
const make = (msg) => ({ sceneKey: msg.sceneKey, acc: Float64Array.from({ length: 8 }, (_, k) => (k < 2 ? 0.85 : 1) * (1 + 0.002 * Math.sin(msg.seed * 7 + k))), cnt: new Uint32Array(8).fill(10), ledger: { ...LED }, leak: { '0|0': 0.1 } });
// 수동 포트: 청크 응답을 시험이 직접 보냄
function manualPort() {
  const log = [], pend = [];
  return { log, pend, send(msg) { log.push(msg); return msg.type === 'scene' ? Promise.resolve({ sceneKey: msg.sceneKey, ready: true }) : new Promise((res, rej) => pend.push({ msg, res, rej })); } };
}
// 지연 포트: 청크마다 delay ms 뒤 make(msg) 로 응답
function delayedPort(T, delay = 100) {
  const log = [];
  return { log, send(msg) { log.push(msg); return msg.type === 'scene' ? Promise.resolve({ sceneKey: msg.sceneKey, ready: true }) : new Promise((res) => T.setTimeout(() => res(make(msg)), delay)); } };
}
const chunks = (p) => p.log.filter((m) => m.type === 'chunk');
const scenes = (p) => p.log.filter((m) => m.type === 'scene');
const OPT = { chunkN: 1000, bins: 10, debounceMs: 500, tickMs: 1000, maxPhotons: 1e9 };

{   // 디바운스 · 장면 · 시드 · 누적 · 이전 청크 무시 · 다른 sceneKey 무시 · 취소
  const T = fakeTimers(), a = manualPort(), b = manualPort(), ups = [];
  const P = createProgressive({ ports: [a, b], timers: T, onUpdate: (s) => ups.push(s.state), opts: OPT });
  P.restart(job(1)); await T.advance(200); P.restart(job(2)); await T.advance(499);   // 디바운스는 마지막 restart 부터 0.5초
  ok(a.log.length === 0 && P.snapshot().state === 'pending', '디바운스 중: 장면 안 보냄');
  await T.advance(1);
  ok(scenes(a).length === 1 && scenes(a)[0].sceneKey === 's2' && scenes(a)[0].tag === 2 && scenes(b).length === 1, '0.5초 뒤 마지막 작업의 장면만 모든 포트에');
  ok(chunks(a)[0].seed === chunkSeed(1, 0) && chunks(b)[0].seed === chunkSeed(1, 1) && chunks(a)[0].N === 1000 && P.snapshot().state === 'running', `청크 시드 7919·7920, 상태 running (${ups.join('>')})`);
  a.pend.shift().res(make(chunks(a)[0])); b.pend.shift().res(make(chunks(b)[0])); await T.advance(0);
  const s1 = P.snapshot();
  ok(s1.photons === 2000 && s1.chunks === 2 && s1.bins[0].n === 1 && s1.bins[1].n === 1 && s1.stats && Math.abs(s1.stats.Ulen - 0.85) < 0.01 && s1.leak['0|0'] === 0.2 && s1.ledger.emitted === 2,
    `누적: 광자 ${s1.photons}, 배치 2개 → 첫 지표 바로(Ulen ${s1.stats?.Ulen.toFixed(3)}), 새는 빛 합 ${s1.leak['0|0']}`);
  P.restart(job(3));   // 진행 중 청크(c=2,3)가 있는 상태에서 다시 시작
  a.pend.shift().res(make(chunks(a)[1])); b.pend.shift().res(make(chunks(b)[1])); await T.advance(0);
  ok(P.snapshot().photons === 0 && P.snapshot().state === 'pending', '다시 시작 전 청크 결과는 버림');
  await T.advance(500);
  const c3 = chunks(a).at(-1);
  ok(c3.sceneKey === 's3' && c3.seed === chunkSeed(1, 0), '새 장면 s3, 청크 번호 0부터');
  a.pend.shift().res({ ...make(c3), sceneKey: 's2' }); await T.advance(0);
  ok(P.snapshot().photons === 0 && P.snapshot().ignored === 1, '다른 sceneKey 응답 무시');
  P.cancel();
  const n = a.log.length;
  for (const x of [...a.pend.splice(0), ...b.pend.splice(0)]) x.res(make(x.msg));
  await T.advance(2000);
  ok(P.snapshot().state === 'idle' && P.snapshot().photons === 0 && a.log.length === n, '취소: idle, 남은 응답 무시, 새 청크 없음');
}
{   // 수렴 멈춤 · 목표만 바꾸면 판정만 · 광속 → 휘도 · 잡음 목표를 낮추면 재개
  const T = fakeTimers(), p = delayedPort(T);
  const P = createProgressive({ ports: [p], timers: T, opts: OPT });
  P.restart(job(1)); await T.advance(3000);
  const s = P.snapshot();
  ok(s.state === 'done' && s.reason === 'converged' && s.chunks >= 10 && s.chunks <= 25 && s.stats.relNoise <= 0.02 && s.stats.passLen === true,
    `수렴: 청크 ${s.chunks}, 잡음 ${(s.stats.relNoise * 100).toFixed(3)}%, 길이 U ${s.stats.Ulen.toFixed(3)} 합격`);
  const nScene = scenes(p).length, nCh = chunks(p).length;
  P.setJudge({ obs: { ...obs, targetLen: 0.9 } });
  const j = P.snapshot();
  ok(j.state === 'done' && j.stats.passLen === false && j.photons === s.photons && scenes(p).length === nScene && chunks(p).length === nCh, '목표 0.9: 판정만 다시(불합격), 계산·장면 그대로');
  ok(j.photometry.lum === null && Math.abs(photometry(G, j.sum, j.ledger).eff - j.photometry.eff) < 1e-15, '광속 0 → 휘도 없음(상대값), 효율 = Σ출사/방출');
  P.setJudge({ fluxLm: 10 });
  const L = P.snapshot().photometry;
  ok(L.lum > 0 && Math.abs(L.lum - (10 * 2 * L.eff) / (8e-6 * Math.PI)) < 1e-9 * L.lum, `광속 10 lm × 2개: 휘도 ${L.lum.toFixed(0)} cd/m² = Φ·eff/(A·π)`);
  ok(Math.abs(photometry(G, j.sum, j.ledger, { fluxLm: 10, nLeds: 2, cone: 30 }).lum - 4 * L.lum) < 1e-9 * L.lum, '원뿔 30°: sin²30° = 1/4 → 휘도 4배');
  P.setJudge({ targetNoise: 1e-6 });
  ok(P.snapshot().state === 'running', '잡음 목표를 현재 잡음보다 낮추면 계산 재개');
  P.cancel();
}
{   // 일시정지 · 재개
  const T = fakeTimers(), p = delayedPort(T);
  const P = createProgressive({ ports: [p], timers: T, opts: OPT });
  P.restart(job(1)); await T.advance(650);   // 500ms 시작 → 600ms 청크 0 완료, 청크 1 진행 중
  P.pause(); const n = chunks(p).length;
  await T.advance(1000);
  const s = P.snapshot();
  ok(s.state === 'paused' && s.chunks === 2 && chunks(p).length === n, `일시정지: 진행 중 청크만 받고(${s.chunks}개) 새 청크 없음`);
  P.resume(); await T.advance(150);
  ok(P.snapshot().state === 'running' && chunks(p).length > n, '재개: 청크 다시 보냄');
  P.cancel();
}
{   // 광자 상한
  const T = fakeTimers(), p = delayedPort(T);
  const P = createProgressive({ ports: [p], timers: T, opts: { ...OPT, maxPhotons: 4000 } });
  P.restart(job(1)); await T.advance(2000);
  const s = P.snapshot();
  ok(s.state === 'done' && s.reason === 'max' && s.photons === 4000 && chunks(p).length === 4, `광자 상한 4000: 청크 ${chunks(p).length}개 후 멈춤`);
}
{   // 준비 안 됨(작업 함수 null) · 작업 함수 오류
  const T = fakeTimers(), p = delayedPort(T);
  const P = createProgressive({ ports: [p], timers: T, opts: OPT });
  P.restart(() => null); await T.advance(500);
  ok(P.snapshot().state === 'idle' && P.snapshot().reason === 'notReady' && p.log.length === 0, '작업 없음 → idle/notReady, 메시지 없음');
  P.restart(() => { throw new Error('배치 길이 초과'); }); await T.advance(500);
  ok(P.snapshot().state === 'error' && /배치 길이/.test(P.snapshot().error), '작업 함수 오류 → error');
}
{   // 누적 동등성: 포트 2개(Worker 모의 = chunk-host)로 청크 10개 = runJob(seed 3, 배치 10) — 배치·판정 비트 일치
  const table = loadTable(), fx = plateFixture(table);
  const J = runJob({ S: fx.S, line: fx.line, obs: fx.obs, G: fx.G, emitters: fx.emitters, ledSpec: fx.ledSpec, N: 20000, seed: 3, batches: 10 });
  const hostPort = () => { const h = makeChunkHost({ getTable: () => table }); return { send: (m) => Promise.resolve().then(() => h.handle(m).reply) }; };
  const T = fakeTimers();
  const P = createProgressive({ ports: [hostPort(), hostPort()], timers: T, opts: { chunkN: 2000, bins: 10, maxPhotons: 20000, seedBase: 3, debounceMs: 500, tickMs: 1000 } });
  P.restart({ sceneKey: 'e1', scene: { mechParts: [fx.plate], mspec: fx.mspec, ledParts: null, lineData: lightData(fx.line), G: fx.G, obs: fx.obs, emitters: fx.emitters }, G: fx.G, obs: fx.obs, nLeds: 5, fluxLm: 0 });
  await T.advance(500); await settle(200);
  const s = P.snapshot(), ref = tallyStats(fx.G, J.accs, fx.obs, J.cnts);
  ok(s.state === 'done' && s.reason === 'max' && s.chunks === 10, `점진 계산 끝: 청크 ${s.chunks}개`);
  ok(s.bins.every((b, i) => b.n === 1 && b.acc.every((v, k) => v === J.accs[i][k])), '배치 10개 = runJob 배치(비트 일치)');
  ok(s.stats.Ulen === ref.Ulen && s.stats.Uwid === ref.Uwid && s.stats.relNoise === ref.relNoise && s.stats.sWorst === ref.sWorst,
    `판정 일치: 길이 U ${ref.Ulen.toFixed(4)}, 폭 U ${ref.Uwid?.toFixed(4)}, 잡음 ${(ref.relNoise * 100).toFixed(2)}%`);
  ok(Object.keys(J.ledger).every((k) => Math.abs(s.ledger[k] - J.ledger[k]) <= 1e-12 * Math.max(1, J.ledger[k])), '원장 합 일치(도착 순서 차이만)');
}
done();
