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
