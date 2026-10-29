// 3D 계산 작업 — spec 2026-10-14 §6. 메인·Worker 공용(순수). 장면 = 기구 부품 + 광원 부품(LED STEP 의 PCB·LED 몸체, 또는 가상 PCB).
import { buildSceneMesh } from './runtime.js';
import { buildTraceScene } from './scene3d.js';
import { transformMesh } from './xform.js';
import { pcbPlaneMesh } from './placement.js';
import { defaultPart, setPartFinish } from './materials.js';
import { SOLDER_R, LED_BODY_FINISH } from './defs.js';
import { runMC3D } from './mc3d.js';
import { ledSource, combineSources } from './sources.js';
import { makeAccumulator } from './tally.js';
import { rng } from '../l2/mc-slab.js';
import { REC } from './gpu-trace.js';

// ledParts 는 변환 전 원본이고 composeScene 이 st.offset/rot 로 변환한다. emitters 는 이미 변환된 좌표여야 한다(xform.transformEmitters).
// rt: 기구 장면(getMech3d()), mspec: spec.mech3d, ledParts: LED STEP 원본 메쉬(없으면 null), line: 인식된 관측 라인(가상 PCB 용)
export function composeScene({ rt, mspec, ledParts, table, db, line }) {
  const L = mspec.light, extraMeshes = [], extraSpecs = [], solderFin = { kind: 'whiteDiffuse', R: SOLDER_R[L.solder] ?? 0.8 };
  const base = rt.parts.length;
  if (L.kind === 'step' && !ledParts) throw new Error('LED STEP 메쉬가 없음 — LED STEP 을 다시 불러오세요');
  if (L.kind === 'step') {
    const st = L.step, ledSet = new Set(st.leds);
    ledParts.forEach((m, i) => {
      extraMeshes.push(transformMesh(m, st.offset, st.rot));
      extraSpecs.push(setPartFinish(defaultPart(base + i, i === st.pcb ? 'PCB' : `LED ${i}`, 0), null, i === st.pcb ? solderFin : ledSet.has(i) ? LED_BODY_FINISH : { kind: 'whiteDiffuse', R: 0.5 }));
    });
  } else if (L.kind === 'manual' && L.manual.pcb.kind === 'depth') {
    extraMeshes.push(pcbPlaneMesh(line, L.manual.pcb.depth));
    extraSpecs.push(setPartFinish(defaultPart(base, 'PCB', 0), null, solderFin));
  }
  const rt2 = extraMeshes.length ? buildSceneMesh('job', [...rt.parts, ...extraMeshes]) : rt;
  return buildTraceScene(rt2, { ...mspec, parts: [...mspec.parts, ...extraSpecs] }, { table, db });
}

// 발광점 목록 → 합친 광원(runJob·runChunk 공용)
export function ledSources(emitters, ledSpec) {
  if (!emitters.length) throw new Error('광원이 없음 — LED 를 지정하세요');
  return combineSources(emitters.map((e) => ledSource({ x: e.pos[0], y: e.pos[1], z: e.pos[2], axis: e.axis, xAxis: e.xAxis, model: ledSpec.model, beam: ledSpec.beam, sizeX: ledSpec.sizeX, sizeY: ledSpec.sizeY })));
}

// 점진 계산 청크 — spec 2026-10-15 m3-cad-ui §4. runMC3D 1회(배치 하나)를 seed 그대로 돌린다.
// runJob 배치 b 와 같은 시드(seed·7919+b)·광자 수를 주면 acc·cnt·ledger 가 비트 단위로 같다(같은 콜백 순서).
// leak: 관측면이 아닌 면으로 탈출한 빛 — 탈출 광자의 마지막 출사 (부품, 면) 별 가중치 합. 출사 기록이 없으면(투과 부품을 거치지 않고 틈으로 바로) '-1|-1'.
// escObs: 마지막 출사가 관측면인 탈출 가중치(방향 무관). Σleak + escObs = ledger.escaped.
// rw = { part, C } | null — 있으면 Milky 부품 경로를 추적(track)해 격자별 지도(rw.acc: 격자 수 × 셀)·Σf·Σf²·n 을 함께 돌려준다(spec P4 §2.1)
export function runChunk({ S, line, obs, G, emitters, ledSpec, N, seed, rw = null }) {
  const src = ledSources(emitters, ledSpec), a = makeAccumulator(G, line, obs, rw ? { C: rw.C } : null);
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), leak = {}, paths = {};
  let lastPart = -1, lastFace = -1, lastP = -1, escObs = 0, curP = -1, seq = [], refl = false;
  const r = runMC3D(S, {
    source: src, N, seed, track: rw ? rw.part : -1,
    onExit(part, face, x, y, z, dx, dy, dz, w, p) { a.onExit(part, face, x, y, z, dx, dy, dz, w, p); lastPart = part; lastFace = face; lastP = p; },
    // 광경로: 광자가 들어간 부품 차례(투과 부품) · 불투명 면에서 반사됐는지
    onHit(part, face, x, y, z, dx, dy, dz, w, p, entering) {
      if (p !== curP) { curP = p; seq = []; refl = false; }
      if (!entering || part < 0) return;
      if (S.optics[part]?.transmissive) { if (seq[seq.length - 1] !== part && seq.length < 5) seq.push(part); } else refl = true;
    },
    onEscape(x, y, z, dx, dy, dz, w, p, tL, tK) {
      if (a.onEscape(x, y, z, dx, dy, dz, w, p, tL, tK) && curP === p) { const key = `${refl ? 'R' : ''}:${seq.join('>')}`; paths[key] = (paths[key] ?? 0) + w; }
      const k = lastP === p ? `${lastPart}|${lastFace}` : '-1|-1';
      if (faces.has(k)) escObs += w; else leak[k] = (leak[k] ?? 0) + w;
    },
  });
  return { acc: a.acc, cnt: a.cnt, ledger: r.ledger, leak, escObs, paths, ms: r.ms, rw: a.rw };
}

// 대표 광경로(3D 광경로 화살표) — 실제 MC 광자 중 경로 want('R:2>1' 형식, 기구 부품 nMech 미만만)로 관측면에 집계된 것을 모아
// 면 적중 횟수가 가운데(중앙값)인 광자 하나의 꺾인 길을 돌려준다: { pts:[발광점, 면 적중점…(마지막 = 관측면 출사점)], dir(나가는 방향), enter:[want 부품마다 처음 들어간 pts 번호] } | null.
// 체적 산란 점은 넣지 않는다(면과 면 사이 = 곧은 선) — 면에서 꺾이는 굴절·반사·내부 전반사가 보이게. batches × N 광자까지(모이면 멈춤)
export function samplePath({ S, line, obs, G, emitters, ledSpec, want, nMech = Infinity, N = 400, seed = 1, batches = 6, maxEvents = 4000, enough = 15 }) {
  const src0 = ledSources(emitters, ledSpec), found = [];
  for (let b = 0; b < batches && found.length < enough; b++) {
    const a = makeAccumulator(G, line, obs);
    let curP = -1, pts = [], seq = [], at = [], refl = false, start = null;
    const source = { ...src0, sample: (rnd) => { const s0 = src0.sample(rnd); start = [s0[0], s0[1], s0[2]]; return s0; } };
    runMC3D(S, {
      source, N, seed: seed * 7919 + b, maxEvents,
      onExit: a.onExit,
      onHit(part, face, x, y, z, dx, dy, dz, w, p, entering) {
        if (p !== curP) { curP = p; pts = [start]; seq = []; at = []; refl = false; }
        const l = pts[pts.length - 1]; if (!l || Math.abs(l[0] - x) + Math.abs(l[1] - y) + Math.abs(l[2] - z) > 1e-9) pts.push([x, y, z]);   // 짝 면 두 번 = 한 점
        if (!entering || part < 0) return;
        if (S.optics[part]?.transmissive) { if (seq[seq.length - 1] !== part && seq.length < 5) { seq.push(part); at.push(pts.length - 1); } } else refl = true;
      },
      onEscape(x, y, z, dx, dy, dz, w, p) {
        if (!a.onEscape(x, y, z, dx, dy, dz, w, p) || curP !== p) return;
        const key = `${refl ? 'R' : ''}:${seq.filter((q) => q < nMech).join('>')}`;
        if (key === want && found.length < enough) found.push({ pts, dir: [dx, dy, dz], enter: at.filter((_, k) => seq[k] < nMech) });
      },
    });
  }
  if (!found.length) return null;
  found.sort((u, v) => u.pts.length - v.pts.length);
  return found[Math.floor((found.length - 1) / 2)];
}

// GPU 청크 — runChunk 와 같은 결과 형식. 광원 표본은 CPU 가 뽑고(seed), GPU 가 추적한 광자별 기록(gpu-trace.js REC)을
// 같은 집계기에 차례로 넣는다(마지막 출사 → 탈출). gpu = createGpuTracer() 결과
export async function runChunkGpu(gpu, { S, line, obs, G, emitters, ledSpec, N, seed, rw = null }) {
  const src = ledSources(emitters, ledSpec), a = makeAccumulator(G, line, obs, rw ? { C: rw.C } : null), rnd = rng(seed);
  const starts = new Float32Array(N * 6);
  for (let p = 0; p < N; p++) starts.set(src.sample(rnd), p * 6);
  const w0 = src.flux / N, { rec, ms } = await gpu.trace(S, { starts, N, seed: (seed * 2654435761) >>> 0, track: rw ? rw.part : -1, w0, wMin: w0 * 1e-3 });
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), leak = {}, paths = {};
  const ledger = { emitted: w0 * N, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  let escObs = 0;
  for (let p = 0; p < N; p++) {
    const o = p * REC, ep = rec[o + 1];
    ledger.absSurf += rec[o + 18]; ledger.absVol += rec[o + 19]; ledger.lost += rec[o + 20]; ledger.rrLoss += rec[o + 21]; ledger.rrGain += rec[o + 22];
    if (ep >= 0) a.onExit(ep, rec[o + 2], rec[o + 3], rec[o + 4], rec[o + 5], 0, 0, 0, 0, p);
    if (rec[o] < 0.5) continue;
    const w = rec[o + 9];
    ledger.escaped += w;
    if (a.onEscape(0, 0, 0, rec[o + 6], rec[o + 7], rec[o + 8], w, p, rec[o + 10], rec[o + 11])) {
      const seq = []; for (let k = 0; k < 5; k++) if (rec[o + 13 + k] >= 0) seq.push(rec[o + 13 + k]);
      const key = `${rec[o + 12] > 0.5 ? 'R' : ''}:${seq.join('>')}`; paths[key] = (paths[key] ?? 0) + w;
    }
    const k = ep >= 0 ? `${ep}|${rec[o + 2]}` : '-1|-1';
    if (faces.has(k)) escObs += w; else leak[k] = (leak[k] ?? 0) + w;
  }
  return { acc: a.acc, cnt: a.cnt, ledger, leak, escObs, paths, ms, rw: a.rw, gpu: true };
}

// 시드 규약: 배치 b 는 seed*7919+b 를 쓴다. 여러 Worker 로 나눌 때는 Worker 마다 서로 다른 seed 를 주고(배치 시드가 겹치지 않게), 각자 batches 개 배치를 돌려 합친다.
// emitters: [{ pos, axis, xAxis }] (LED STEP 은 변환 적용 후 좌표), ledSpec: light.spec
export function runJob({ S, line, obs, G, emitters, ledSpec, N, seed, batches = 10 }) {
  const src = ledSources(emitters, ledSpec);
  const accs = [], cnts = [], ledger = { emitted: 0, escaped: 0, absSurf: 0, absVol: 0, lost: 0, rrLoss: 0, rrGain: 0 };
  let ms = 0;
  const per = Math.ceil(N / batches);
  for (let b = 0; b < batches; b++) {
    const a = makeAccumulator(G, line, obs);
    const r = runMC3D(S, { source: src, N: per, seed: seed * 7919 + b, onExit: a.onExit, onEscape: a.onEscape });
    accs.push(a.acc); cnts.push(a.cnt); ms += r.ms;
    for (const k in ledger) ledger[k] += r.ledger[k];
  }
  return { accs, cnts, ledger, ms };
}
