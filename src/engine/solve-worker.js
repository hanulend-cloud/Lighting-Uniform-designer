// 계산 전용 Worker — 조합 탐색·판정 필드·레벨별 행·히트맵을 메인 스레드 밖에서 돌려 화면이 멈추지 않게 한다
// (형상 몸체 spec §4 S2 — 광선관 solver 는 탐색 1회 수 초). 메인과 같은 엔진 모듈을 그대로 쓴다.
// 메시지(메인 → Worker):
//   { type:'init', l2Base, db:{ base, user } }           L2 응답표 로드·검증 + 실측소재 DB
//   { type:'db', db:{ base, user } }                       소재 DB 갱신
//   { type:'body', body:{ name, positions, triangles, orient } | null }   불러온 L3 몸체(없으면 해제)
//   { type:'run', id, spec, active, evalGrid:{nx,ny}, soloLevels, resetSolo, heat:{nx,ny,unit,cone}|null }
//   { type:'heat', id, spec, common, heat:{nx,ny,unit,cone} }
// 응답: { type:'ready', l2 } · { type:'progress', id, phase, evals } · { type:'result', id, ... } · { type:'solo', id, solo } · { type:'heat', id, res } · { type:'error', id, message }
import { initL2, browserLoader, l2State, setMaterialDb } from './l2/runtime.js';
import { createDb } from '../model/materials-db.js';
import { setBodyMesh, clearBody } from './shape/runtime.js';
import { solveCombo, solvePerLevel, GRID } from './solver.js';
import { computeField, computeCameraLuminance } from './directLit.js';
import { combinedEffect } from '../model/levels.js';
import { createPsfPool } from './shape/psf-pool.js';

let ready = null, curId = 0, evals = 0, lastPost = 0, phase = '';
const soloCache = {};
const post = (m, tr) => self.postMessage(m, tr ?? []);
// 진행 표시: solver 의 평가마다 호출(최대 4회/초 전송)
globalThis.__progress = () => {
  evals++;
  const t = Date.now();
  if (t - lastPost > 250) { lastPost = t; post({ type: 'progress', id: curId, phase, evals }); }
};
const step = (id, p) => { curId = id; phase = p; lastPost = 0; post({ type: 'progress', id, phase, evals }); };

function heatField(spec, common, heat) {
  const res = computeField(spec, { ...common, nx: heat.nx, ny: heat.ny });
  if (heat.unit === 'lumin') {
    const cam = computeCameraLuminance(spec, { ...common, nx: heat.nx, ny: heat.ny, coneDeg: heat.cone, illumField: res.field });
    res.field = cam.field; res.nx = cam.nx; res.ny = cam.ny; res.extent = cam.extent;
  }
  return res;
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ready = (async () => {
        await initL2(browserLoader(m.l2Base));
        setMaterialDb(createDb(m.db?.base ?? [], m.db?.user ?? []));
        const st = l2State();
        post({ type: 'ready', l2: { error: st.error, ok: !!st.check?.ok }, pool: globalThis.__psfPool?.size ?? 1 });
      })();
      return;
    }
    if (m.type === 'pool') { if (self.crossOriginIsolated && m.ports?.length) globalThis.__psfPool = createPsfPool(m.ports); return; }   // 메인이 만든 보조 Worker 포트
    await ready;
    if (m.type === 'db') { setMaterialDb(createDb(m.db.base ?? [], m.db.user ?? [])); for (const k in soloCache) delete soloCache[k]; return; }
    if (m.type === 'body') {
      if (m.body) setBodyMesh(m.body.name, { positions: m.body.positions, triangles: m.body.triangles }, m.body.orient); else clearBody();
      for (const k in soloCache) delete soloCache[k];
      return;
    }
    if (m.type === 'run') {
      const { id, spec, active } = m, t0 = performance.now();
      evals = 0;
      if (m.resetSolo) for (const k in soloCache) delete soloCache[k];
      step(id, '설계안 탐색');
      const combo = solveCombo(spec, active);
      const depth = combo.depth, pitchX = combo.pitchX, pitchY = combo.pitchY ?? Infinity;
      const eff = combinedEffect(spec, depth, active);
      const common = {
        depth, pitchX, pitchY, blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
        decenterX: eff.decenterX, decenterY: eff.decenterY, edgeBoost: eff.edgeBoost, active: eff.active, shape: eff.shape,
        padX: combo.padX, padY: combo.padY, l2: eff.l2,
      };
      step(id, '판정 필드(정밀)');
      const resEval = computeField(spec, { ...common, nx: m.evalGrid.nx, ny: m.evalGrid.ny });
      // 설계안·히트맵을 먼저 보내고(화면 즉시 갱신), 레벨별 표는 이어서 계산해 따로 보낸다
      let heat = null;
      if (m.heat) { step(id, '히트맵'); heat = heatField(spec, common, m.heat); }
      const tr = [resEval.field.buffer]; if (heat && heat.field.buffer !== resEval.field.buffer) tr.push(heat.field.buffer);
      post({ type: 'result', id, combo, common, resEval, heat, ms: performance.now() - t0, evals, poolStats: globalThis.__psfPool?.stats }, tr);
      const solo = [];
      for (const level of m.soloLevels) {
        const sig = JSON.stringify([spec.goal, spec.target, spec.space.depth, spec.led, spec.body, spec.levels[level], spec.opt]);
        if (soloCache[level]?.sig !== sig) {
          step(id, `레벨별 표 L${level}`);
          soloCache[level] = { sig, r: solvePerLevel(spec, { levels: [level] })[0] };
        }
        solo.push(soloCache[level].r);
      }
      post({ type: 'solo', id, solo, ms: performance.now() - t0, evals });
      return;
    }
    if (m.type === 'heat') {
      const res = heatField(m.spec, m.common, m.heat);
      post({ type: 'heat', id: m.id, res }, [res.field.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: String(err?.stack ?? err) });
  }
};
