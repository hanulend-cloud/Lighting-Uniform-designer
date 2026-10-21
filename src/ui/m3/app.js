// 3D 기구 모드 화면(CAD식) — spec 2026-10-15 m3-cad-ui §2·§3.
// main.js 는 mount(ctx) / unmount() / setStatus(t) / flush() / isMounted() 만 부른다.
// 저장 상태 = ctx.mspec(spec.mech3d), 세션 상태 = store.session. 흐름: store.update(tag) → onChange(tag)
//   observe → 관측 라인 다시 인식 · 물리 태그 → 점진 계산 재시작 · 기하 점검 태그 → 점검 ①②③ · target → 판정만 다시. 모두 다시 그림.
// 점진 계산 갱신(1초마다)은 store 알림 없이 결과 패널·상태 띠·색지도만 다시 그린다(입력 중 속성 패널이 다시 그려지지 않게).
import { getMech3d, getLedMesh, setLedMesh, saveLedIDB, applyPartMods, redetectContacts } from '../../engine/mech3d/runtime.js';
import { setPartMaterial, setPartMaterialParam } from '../../engine/mech3d/materials.js';
import { lineFromData, lightData, obsDirection } from '../../engine/mech3d/line.js';
import { tallyGeometry, tallyStats } from '../../engine/mech3d/tally.js';
import { bounds } from '../../engine/mech3d/mesh.js';
import { runGeomChecks, checkLeak } from '../../engine/mech3d/checks.js';
import { createStore, PHYSICS, GEOM_CHECK } from './store.js';
import { createProgressive } from './progressive.js';
import { createPool } from './pool.js';
import * as L from './leds.js';
import { buildObsOverlay, cellColors, extractFaces } from './colormap.js';
import { mountCommandBar } from './command-bar.js';
import { renderFeatureTree, toggleVisibility } from './feature-tree.js';
import { mountSplitter } from './splitter.js';
import { partClearance, limitXform, axisLimits, TOL } from '../../engine/mech3d/clearance.js';
import { renderPropertyPanel } from './property-panel.js';
import { meshInfo, partToDbMaterial } from '../mech3d-panel.js';
import { renderAdvanced } from '../l2-advanced.js';
import { defaultRowGap } from '../mech3d-light-panel.js';
import { positionsFromLayout, addPosition, alignPositions } from '../../engine/mech3d/led-edit.js';
import { createResultsPanel } from './results-panel.js';
import { renderStatusBar } from './status-bar.js';
import { createAdRunner } from './autodesign-run.js';
import { renderAutoPanel, stageAvailability, clampCap, overallFrac, etaText, reusableCurrent, defaultHousingPart, applyDz, applyFinish, capDefault, nextFinish, finishText } from './autodesign-panel.js';
import { ledHeightRange, heightCandidates, catalogOf, finishCandidatesFor, setReflMaterial, partFinishEdit } from '../../engine/mech3d/housing-led.js';
import { migrateFinishCatalog, reflectPatch, copyAsUser, entryFromForm, addSamples, parsePercents, uniqueReflId } from '../../model/reflect-db.js';
import { intersectRay } from '../../engine/mech3d/bvh.js';
import { runAutoDesign, shapeTotal } from '../../engine/mech3d/autodesign.js';
import { milkyRows } from '../../engine/mech3d/milky-search.js';
import { candidateGrid } from '../../engine/mech3d/basis.js';
import { ledAtS, clampRowGap, rowGapOptions } from '../../engine/mech3d/placement.js';
import { virtualEmittersAt, stepRefEmitter } from '../../engine/mech3d/virtual-leds.js';
import { heightsFor, deformPart, refinedFor, minThickness, shapeVarRanges, pathFromLine, swOnPath, ledEll, lineVarH, splineInput } from '../../engine/mech3d/shape-opt.js';
import { interferenceKeys, travelDistance } from '../../engine/mech3d/clearance.js';
import { scaleMoveMesh, isIdentityXform } from '../../engine/mech3d/xform.js';
import { defaultChecks } from '../../engine/mech3d/defs.js';
import { validAdjust } from '../../engine/mech3d/led-adjust.js';
import { beamSpec, ledOfHit, ledClashItems, dropStaleAdjust, setLedAdjust } from './led-select.js';

const $ = (s) => document.querySelector(s);
const VIEWS = [['top', '평면 (XY)'], ['front', '정면 (XZ)'], ['side', '측면 (YZ)'], ['iso', '등각']];
let A = null;       // 마운트 상태 { ctx, store, pool, prog, view, results, cmd, ... }
let viewP = null;   // 3D 뷰는 한 번만 만든다(같은 캔버스에 WebGL 문맥을 다시 만들지 않음)
// 계산 Worker 풀도 한 번만 — 3D↔평판 전환·다시 마운트에도 유지(Worker 시작·L2 표 적재 수 초 방지). resetWorkers() 로만 종료.
// sceneKey 는 모듈 전체에서 이어지는 번호 — 유지된 Worker 의 장면 캐시가 다른 마운트의 같은 이름과 섞이지 않게
let pool = null, sceneSeq = 0;
function getPool(ctx) {
  pool ??= createPool({ dbLists: ctx.dbLists, l2Raw: ctx.l2Raw ?? (() => null), onStatus: (t) => setStatus(t) });
  return pool;
}
export function resetWorkers() { pool?.killAll('계산 Worker 초기화'); }
// 시작 시 미리 띄우기(main.js — 3D 모드로 열 때 IndexedDB·화면 준비와 겹쳐 Worker 모듈·L2 표를 적재)
export function warmWorkers(ctx) { getPool(ctx).warm(); }

export const isMounted = () => !!A;
export function setStatus(t) { A?.store.update('session', (_, s) => { s.status = t; }); }
export function flush() { A?.store.flush(); }
export function importLed(file) { if (!A) return; if (A.store.mspec.light.kind !== 'step') A.store.update('light', (m) => { m.light.kind = 'step'; }); importLedStep(file); }   // 예제 프로젝트 — LED STEP 을 코드에서 불러옴(같은 이름이면 저장된 기준 LED 로 재인식)
// 상단 메뉴(main.js) → 3D 명령. 3D 화면이 아니면 false
export function command(id) {
  if (!A) return false;
  const h = cmdHandlers(), st = A.store, click = (sel) => document.querySelector(sel)?.click();
  switch (id) {
    case 'view:top': case 'view:front': case 'view:side': case 'view:iso': click(`#m3-views [data-view="${id.slice(5)}"]`); break;
    case 'theme': click('#m3-views [data-theme-toggle]'); break;
    case 'fit': h.onFit(); break;
    case 'section': h.onSection(); break;
    case 'show-all': st.update('view', (_, x) => { x.hidden = []; x.hideLeds = false; }); break;
    case 'deselect': st.update('session', (_, x) => { x.sel = null; x.ledSel = null; x.pick = null; x.focusCheck = null; }); break;
    case 'led-pick': h.onLed(); break;
    case 'obs-pick': h.onObs(); break;
    case 'target': st.update('session', (_, x) => { x.node = 'target'; x.sel = null; x.ledSel = null; }); break;
    case 'calc': h.onToggleCalc(); break;
    case 'auto': adSetOpen(true); break;
    case 'export-mech': exportMechStep(); break;
    default: return false;
  }
  return true;
}
export const theme = () => { try { return localStorage.getItem('uds.m3.theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
// 3D 기구 STEP 내보내기 — 지금 부품 메쉬(크기·위치·형상 수정 반영)를 부품마다 솔리드로(삼각형 근사 — 수정 안 한 부품은 원본 STEP 이 더 정확)
let mechStepBusy = false;
function exportMechStep() {
  const rt = getMech3d();
  if (!rt || mechStepBusy) return;
  const nTri = rt.parts.reduce((t, p) => t + p.triangles.length / 3, 0), name = String(A.store.mspec.name ?? 'mech').replace(/\.(stp|step)$/i, '').replace(/[/\\:*?"<>|]/g, '_');
  const w = new Worker(new URL('../../export/assembly-step-worker.js', import.meta.url), { type: 'module' });
  mechStepBusy = true;
  const end = () => { w.terminate(); mechStepBusy = false; };
  setStatus(`3D 기구 STEP 생성 중… 부품 ${rt.parts.length}개 · 삼각형 ${nTri}개${nTri > 60000 ? ' — 많아서 오래 걸릴 수 있음' : ''}`);
  w.onmessage = (ev) => {
    if (ev.data.type === 'done') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ev.data.stepText], { type: 'application/step' })); a.download = `${name}-uds.stp`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); setStatus('3D 기구 STEP 내보내기 완료 (수정 반영 · 삼각형 근사)'); }
    else setStatus(`STEP 실패: ${ev.data.message}`);
    end();
  };
  w.onerror = (e) => { setStatus(`STEP 실패: ${e.message ?? e}`); end(); };
  w.postMessage({ meshes: rt.parts.map((p) => ({ positions: p.positions, triangles: p.triangles })) });
}
globalThis.__m3 = () => A;   // 브라우저 점검용: __m3().prog.snapshot(), __m3().timing, __m3().checks

function getView() {
  viewP ??= import('../mech3d-view.js').then(({ createMech3dView }) => {
    const v = createMech3dView($('#mech3d-canvas'), { onPick: (s) => { if (A) onPick(s); }, gizmo: $('#m3-axes') });
    const el = $('#m3-views');
    el.innerHTML = VIEWS.map(([k, t]) => `<button data-view="${k}">${t}</button>`).join('') + '<button type="button" data-theme-toggle aria-pressed="false"></button>';
    el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { v.setView(b.dataset.view); A?.store.update('view', (_, s) => { s.view = b.dataset.view; }); }; });
    // 3D 배경 밝게/어둡게 — 보는 사람별 편의 설정(새로고침해도 유지)
    const tb = el.querySelector('[data-theme-toggle]'), vp = $('#mech3d-canvas').parentElement;
    const applyTheme = (t) => { v.setTheme(t); vp.dataset.theme = t; const wr = $('#mech3d-wrap'); if (wr) wr.dataset.theme = t; tb.textContent = t === 'dark' ? '☀ 밝게' : '☾ 어둡게'; tb.setAttribute('aria-pressed', String(t === 'dark')); tb.title = '3D 배경 밝게/어둡게'; };
    let t0 = 'light'; try { t0 = localStorage.getItem('uds.m3.theme') === 'dark' ? 'dark' : 'light'; } catch {}
    applyTheme(t0);
    tb.onclick = () => { const t = v.theme() === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('uds.m3.theme', t); } catch {} applyTheme(t); };
    return v;
  });
  return viewP;
}

// ---- 마운트 ----
// 반사 소재표 행 = 반사 소재 DB(없으면 기본 소재표)
const reflCat = () => catalogOf(A?.ctx.reflectDb?.() ?? null);
export async function mount(ctx) {
  mountSplitter(document.querySelector('.m3-main'));   // 좌·우 창 폭 끌어서 조절(한 번만 붙음)
  if (A && A.ctx.mspec === ctx.mspec) { A.ctx = ctx; return; }   // 같은 기구 — 그대로
  unmount();
  const pool = getPool(ctx);
  pool.setDb(ctx.dbLists()); pool.warm();   // 첫 작업 전에 Worker 를 띄워 L2 표를 적재(이미 떠 있으면 소재 DB 만 갱신)
  applyPartMods(ctx.mspec.parts);   // 저장된 부품 크기·위치 조절을 장면에 반영
  const store = createStore(ctx.mspec, { persist: ctx.persist });
  L.resetLedCaches();
  const v0 = L.validateLedStep(ctx.mspec, store.session);   // main.js:982 의 시작 시 검증을 여기서
  if (v0.status) store.session.status = v0.status;
  if (v0.changed) ctx.persist();
  // 프로젝트 소재표(finishCatalog, §2.3d) → 반사 소재 DB 사용자 항목으로 한 번 이관(spec P4 §2.3e)
  if (ctx.mspec.finishCatalog != null && ctx.reflectDb?.()) {
    const { moved } = migrateFinishCatalog(ctx.mspec, ctx.reflectDb());
    store.session.status = moved.length ? `프로젝트 반사 소재표 → 반사 소재 DB 사용자 항목 ${moved.length}개로 옮김(${moved.map((x) => x.name).join(', ')})` : store.session.status;
    ctx.persist();
  }
  const a = A = { ctx, store, pool, view: null, meshShown: null, lineKey: '', Gc: null, obsShown: null, checks: {}, markKey: '', timing: { start: 0, first: null, noise5: null } };
  a.prog = createProgressive({ ports: pool.ports(), onUpdate: onCalc, opts: { targetNoise: ctx.mspec.observe.targetNoise ?? 0.02 } });
  a.results = createResultsPanel($('#m3-res'));
  a.cmd = mountCommandBar($('#m3-cmd'), cmdHandlers());
  a.unsub = store.subscribe(onChange);
  a.keydown = onKey; window.addEventListener('keydown', onKey);
  const view = await getView();
  if (A !== a) return;   // 기다리는 사이 이탈
  a.view = view;
  view.setObsSurface(null); view.setCheckMarkers([]);
  renderAll();
  refreshLine();
  rerunGeomChecks();
  restartCalc();
}
export function unmount() {
  if (!A) return;
  const a = A; A = null;   // 먼저 비워서 cancel 의 onUpdate 가 그리지 않게
  a.ad?.runner?.cancel(); a.ad?.stepWorker?.terminate();
  $('#m3-auto').hidden = true;
  a.prog.dispose(); a.unsub(); a.store.dispose();   // 풀은 유지(진행 중 청크는 ≤0.5초 — 끝나면 버려짐)
  window.removeEventListener('keydown', a.keydown);
  if (a.view) { a.view.setObsSurface(null); a.view.setCheckMarkers([]); a.view.setSection(null); }
  $('#m3-legend').hidden = true;
}

// ---- 변경 처리 ----
function onChange(tag) {
  if (!A) return;
  const M = A.store.mspec;
  // 자동설계: 물리 편집이면 실행 중 = 중지(스냅샷과 어긋남), 결과 표시 중 = 결과 지움(옛 값 기준)
  const ad = A.ad;
  if (ad && PHYSICS.has(tag)) {
    if (ad.running && ad.runner && !ad.runner.stopped) { ad.runner.cancel(); A.store.session.status = '편집으로 자동설계를 중지함'; }
    else if (ad.result) { ad.result = null; A.meshShown = null; A.store.session.status = '값이 바뀌어 자동설계 결과를 지움'; }
  }
  if (tag === 'light') { const t = dropStaleAdjust(M.light); if (t) A.store.session.status = t; }   // 배치가 바뀌어 무효가 된 LED 개별 조정(spec §4a)
  if (tag === 'observe' || tag === 'material') refreshLine();   // material: 부품 크기·위치가 바뀌면 라인도 다시(키가 같으면 건너뜀)
  if (PHYSICS.has(tag)) restartCalc();
  if (tag === 'target') A.prog.setJudge({ obs: M.observe, targetNoise: M.observe.targetNoise ?? 0.02, fluxLm: M.light.spec.fluxLm ?? 0 });
  if (GEOM_CHECK.has(tag)) rerunGeomChecks();
  renderAll(tag);
}
function onKey(e) {
  if (!A || e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'Escape') A.store.update('session', (_, s) => { s.sel = null; s.ledSel = null; s.pick = null; s.focusCheck = null; });
  else if (e.key === 'f' || e.key === 'F') A.view?.fit();
}

// ---- 관측 라인 (main.js:266-282) — 관측면·방향이 바뀌면 Worker 0 에서 다시 인식 ----
async function refreshLine() {
  const st = A.store, O = st.mspec.observe, S = st.session, pool = A.pool, key = JSON.stringify([O.faces, O.dir, st.mspec.parts.map((p) => [p.xform ?? null, p.shapeMod ?? null])]);
  if (key === A.lineKey) return;
  A.lineKey = key; S.line = null; S.lineErr = '';
  if (!O.faces.length) return;
  const parts = L.rawParts(getMech3d().parts);
  try {
    const dir = O.dir ?? obsDirection(parts, O.faces);
    const r = await pool.call(pool.worker(0), { type: 'line', parts, faces: O.faces, dir });
    if (A?.store === st && key === A.lineKey) { S.line = lineFromData(r.lineData); afterLine(); }
  } catch (e) {
    if (A?.store === st && key === A.lineKey) { S.line = null; S.lineErr = `라인 인식 실패: ${e.message}`; afterLine(); }
  }
}
function afterLine() { restartCalc(); rerunGeomChecks(); A.store.update('session'); }

// ---- 점진 계산 ----
// 집계 격자 인자(빈칸 = 자동) — tally.js 계약: cellS·cellW·winS(null = 자동). 구버전 obs.cell 은 쓰지 않음 (main.js:284)
const tallyObs = (O, dir) => ({ ...O, dir, cell: null, cellS: O.cellS ?? null, cellW: O.cellW ?? null, winS: O.winS ?? null });
// 집계 격자 — (라인, cellS, cellW, winS, 가장자리 제외) 별로 캐시(계산 ≈60ms). 색지도 덧그림도 같은 캐시에 (main.js:286-290)
function geometry(obs) {
  const S = A.store.session, key = JSON.stringify([obs.cellS, obs.cellW, obs.winS, obs.edgeExcl]);
  if (!A.Gc || A.Gc.line !== S.line || A.Gc.key !== key) A.Gc = { line: S.line, key, G: tallyGeometry(S.line, obs), overlay: null };
  return A.Gc.G;
}
// 디바운스가 끝날 때 부르는 작업 생성기 — 라인·광원이 없으면 null(안내), 직접 배치 오류는 던짐(계산 실패로 표시)
// 작업 생성(현재 또는 자동설계 후보 설계) — M: spec.mech3d(복사본 가능), mechParts: 기구 메쉬(형상 후보면 바뀐 부품 포함)
// 자동설계는 실행 시작 때 스냅샷(line·G·obs)을 넘김 — 실행 중 라인이 바뀌어도 같은 기준
export function jobFor(M, mechParts, { emitters = null, line = null, G = null, obs = null } = {}) {
  const ln = line ?? A.store.session.line;
  if (!ln) return null;
  const em = emitters ?? L.currentEmitters(M, ln);
  if (!em.length) return null;
  const o = obs ?? tallyObs(M.observe, M.observe.dir ?? ln.frame.d), g = G ?? geometry(o);
  const isStep = M.light.kind === 'step' && getLedMesh(), lay = isStep ? L.stepLayout(M, ln) : null, ms = JSON.parse(JSON.stringify(M));
  let ledParts = isStep ? L.rawParts(getLedMesh().parts) : null;
  // 가상 배치·개별 조정(spec §4a): 부품은 이미 월드 좌표 → composeScene 이 다시 변환하지 않게 offset·rot = 0, 번호는 그 배치 기준
  if (lay?.virtual || lay?.adjusted) {
    ledParts = L.rawParts(lay.parts);
    ms.light.step = { ...ms.light.step, offset: [0, 0, 0], rot: [0, 0, 0], leds: lay.leds, pcb: lay.pcb, excluded: lay.excluded, emitters: JSON.parse(JSON.stringify(lay.emitters)), virtual: null };
  }
  return {
    sceneKey: `s${++sceneSeq}`, G: g, obs: o, nLeds: em.length, fluxLm: M.light.spec.fluxLm ?? 0,
    scene: { mechParts: L.rawParts(mechParts), mspec: ms, ledParts, lineData: lightData(ln), G: g, obs: o, emitters: em },
  };
}
// 속성 머리용 실제 메쉬 외곽·부피 — 메쉬 객체별 캐시(크기·위치·형상이 바뀌면 runtime 이 새 객체를 만듦)
const MESH_INFO = new WeakMap();
function partMeshInfo(i) {
  const m = getMech3d()?.parts?.[i];
  if (!m?.positions) return null;
  if (!MESH_INFO.has(m)) MESH_INFO.set(m, meshInfo(m));
  return MESH_INFO.get(m);
}
function makeJob() { return A ? jobFor(A.store.mspec, getMech3d().parts) : null; }
// 자동설계 중이면 미룸 — 점진 계산이 공유 Worker 에 장면을 보내면 실행이 '장면이 바뀜' 으로 실패. 끝나면 adRun 이 다시 부름
function restartCalc() {
  if (A.ad?.running) { A.ad.deferred = true; return; }
  A.timing = { start: 0, first: null, noise5: null }; A.prog.restart(makeJob);
}
function guidance(snap) {
  const M = A.store.mspec, S = A.store.session;
  if (snap.state === 'error') return `계산 실패: ${snap.error}`;
  if (!M.observe.faces.length) return '관측면을 지정하세요 — 명령 막대의 👁 관측면';
  if (!S.line) return S.lineErr || '관측 라인 인식 중…';
  if (snap.state === 'idle' && snap.reason === 'notReady') return '광원을 지정하세요 — 명령 막대의 💡 LED 지정';
  if (!snap.stats) return snap.state === 'pending' ? '' : '계산 시작 중…';
  if (snap.stats.empty) return '판정할 유효 셀이 없음 — 관측면이 너무 좁거나 가장자리 제외가 큼';
  return '';
}
function onCalc(snap) {
  if (!A) return;
  const S = A.store.session, M = A.store.mspec, T = A.timing, now = performance.now();
  S.calc = snap;
  if (snap.state === 'starting' && !T.start) T.start = now;   // 성능 기준(spec §6)은 장면 준비 시작부터
  if (T.start && snap.stats && T.first == null) T.first = (now - T.start) / 1000;
  if (T.start && snap.stats?.relNoise != null && snap.stats.relNoise <= 0.05 && T.noise5 == null) T.noise5 = (now - T.start) / 1000;
  updateLeakCheck(snap);
  A.results.update({ snap, observe: M.observe, message: guidance(snap) });
  paintObs(snap);
  A.cmd.update(S, snap);
  renderStatus();
}
// 관측면 색지도: 격자가 바뀌면 덧그림 메쉬를 다시 만들고, 갱신마다 색만 바꾼다
function paintObs(snap) {
  const v = A.view, Gc = A.Gc, st = snap.stats;
  if (!v) return;
  if (!st || st.empty || !Gc || snap.G !== Gc.G) {
    if (A.obsShown && snap.state !== 'running' && snap.state !== 'done' && snap.state !== 'paused') { v.setObsSurface(null); A.obsShown = null; $('#m3-legend').hidden = true; }
    return;
  }
  if (A.obsShown !== Gc) {
    Gc.overlay ??= buildObsOverlay(getMech3d().parts, A.store.mspec.observe.faces, A.store.session.line, Gc.G);
    v.setObsSurface({ ...Gc.overlay, dir: A.store.session.line.frame.d });   // dir: 큰 모델에서 덧그림을 더 띄움(buildObsOverlay 와 같은 방향)
    A.obsShown = Gc; $('#m3-legend').hidden = false;
  }
  v.setObsColors(cellColors(Gc.overlay.cells, st.map, Gc.G.valid));
}

// ---- 설계 점검 ----
function rerunGeomChecks() {
  const M = A.store.mspec, S = A.store.session, rt = getMech3d();
  if (!rt) return;
  let emitters = [];
  try { emitters = L.currentEmitters(M, S.line); } catch { emitters = []; }
  // LED STEP 의 PCB(합친 장면 번호 = 기구 부품 수 + pcb)는 LED 몸체와 늘 맞닿으므로 간섭 검사에서 뺀다
  const pcb = M.light.kind === 'step' ? L.stepLayout(M, S.line)?.pcb ?? -1 : -1, exclude = pcb >= 0 ? [rt.parts.length + pcb] : [];
  Object.assign(A.checks, runGeomChecks({ rt, mspec: M, emitters, bodies: L.ledBodies(M, S.line), obsParts: new Set(M.observe.faces.map((f) => f.part)), beam: M.light.spec.beam, exclude }));
  renderMarkers(); renderStatus();
}
function updateLeakCheck(snap) {
  const M = A.store.mspec;
  A.checks.leak = snap.ledger.escaped > 0 ? checkLeak({ leak: snap.leak, escaped: snap.ledger.escaped, maxLeak: M.checks?.maxLeak ?? 0.2 }) : { status: 'na', ratio: null, worst: null };
  const k = JSON.stringify([A.checks.leak.status, A.checks.leak.worst?.part, A.checks.leak.worst?.face]);
  if (k !== A.markKey) { A.markKey = k; renderMarkers(); }
}
// 3D 표식: ① 빨간 원(간섭) ② 거리선(LED 축 → 관측면, 도달 부족이면 주황 + 원) ③ 주황 원(가장 얇은 곳) ④ 주황 면(가장 많이 새는 면). 상태 띠 배지 클릭 = 크게
function renderMarkers() {
  if (!A?.view) return;
  const C = A.checks, f = A.store.session.focusCheck, M = A.store.mspec, rt = getMech3d(), out = [];
  const size = (id) => (f === id ? 20 : 12);
  for (const it of C.interference?.items ?? []) out.push({ type: 'ring', pos: it.pos, color: it.kind === 'potted' ? 0xffa000 : 0xff3b30, size: size('interference') });   // 포팅 LED(투과 부품 안) = 주황 경고
  for (const it of C.reach?.items ?? []) {
    const warn = it.reach < (M.checks?.minReach ?? 0.5), col = warn ? 0xffa000 : 0x4cd964;
    // LED 방향 = 화살표, 빛 원뿔(len = min(4, 0.4·간격))보다 1.6배 길게 — 단 닿는 면을 넘지 않게(간격의 90%)
    if (it.dist != null) out.push({ type: 'arrow', pos: it.pos, axis: it.axis, len: Math.min(1.6 * Math.min(4, 0.4 * it.dist), 0.9 * it.dist), color: col });
    if (warn || f === 'reach') out.push({ type: 'ring', pos: it.pos, color: col, size: size('reach') });
  }
  if (C.wall?.pos && (C.wall.status === 'warn' || f === 'wall')) out.push({ type: 'ring', pos: C.wall.pos, color: 0xffa000, size: size('wall') });
  const w = C.leak?.worst;
  if (w && w.part >= 0 && rt?.parts[w.part] && (C.leak.status === 'warn' || f === 'leak')) {
    const t = extractFaces(rt.parts[w.part], new Set([w.face]));
    out.push({ type: 'tris', positions: t.positions, triangles: t.triangles, color: 0xff8c1a, opacity: f === 'leak' ? 0.8 : 0.5 });
  }
  // 선택 부품의 간격 치수선: 이웃 부품(하늘색, 간섭은 빨강) · 가장 가까운 LED(초록)
  const cl = A.clrShown;
  if (cl) {
    for (const r of [...cl.rows, ...cl.leds]) {
      if (r.depth > 0) out.push({ type: 'ring', pos: r.pa, color: 0xff3b30, size: 14 });
      else if (r.gap > TOL) out.push({ type: 'line', a: r.pa, b: r.pb, color: 0x18a0fb });
    }
    if (cl.ledMin) out.push({ type: 'line', a: cl.ledMin.pa, b: cl.ledMin.pb, color: 0x2fbf4f });
  }
  A.view.setCheckMarkers(out);
}

// 간섭 상대 이름 — 키 'p:j'(기구 부품) | 'l:j'(LED STEP 메쉬) | 'e:k'(발광점)
function hitName(M, key, line = A.store.session.line) {
  const [k, j] = [key[0], +key.slice(2)];
  if (k === 'p') return M.parts[j]?.name ?? `부품 ${j + 1}`;
  if (k === 'l') {   // j = 배치(원래/가상) 번호 — 가상 LED 는 복사 순번
    const lay = L.stepLayout(M, line), i = lay?.virtual ? lay.leds.indexOf(j) : -1;
    return j === (lay?.pcb ?? M.light.step?.pcb) ? 'PCB' : `LED ${(i >= 0 ? i : j) + 1}`;
  }
  return `LED ${j + 1} 발광점`;
}
// 선택 부품의 크기·위치 가능 범위(캐시: 장면·부품·LED 가 같으면 재사용) — 표시·입력 제한용으로 여유 TOL 을 뺀다
function xformInfoOf(i) {
  const M = A.store.mspec, S = A.store.session, rt = getMech3d();
  if (!rt?.raw?.parts[i]) return null;
  const stp = M.light.kind === 'step', lp = (stp && L.ledPartsNow(M, S.line)) || [];
  let em = []; try { em = stp ? L.currentEmitters(M, S.line) : []; } catch { em = []; }
  const ek = JSON.stringify(em.map((e) => e.pos));
  if (A.xli && A.xli.rt === rt && A.xli.i === i && A.xli.lp === lp && A.xli.ek === ek) return A.xli.res;
  const raw = rt.raw.parts[i], r = axisLimits(raw, M.parts[i].xform ?? null, rt.parts.map((p, j) => (j === i ? null : p)), { ledParts: lp, emitters: em });
  // 0.01mm 단위로 안쪽 내림 — 맞닿음(간격 ≤ TOL)은 간섭이 아니므로 벽에 딱 맞는 치수(예: 16.00)도 입력 가능
  const cut = (v, sg) => (Number.isFinite(v) ? sg * Math.floor(Math.abs(v) * 100 + 1e-6) / 100 : v);
  const s = M.parts[i].xform?.scale ?? [1, 1, 1];
  const lim = {
    move: r.move.map(([lo, hi]) => [cut(lo, -1), cut(hi, 1)]),
    size: r.size.map((v, k) => (Number.isFinite(v) ? Math.max(r.size0[k] * s[k], cut(v, 1)) : v)),
    uniform: Number.isFinite(r.uniform) ? Math.max(1, Math.floor(r.uniform * 1e4) / 1e4) : r.uniform,
  };
  const res = { center0: r.center0, size0: r.size0, lim };
  A.xli = { rt, i, lp, ek, res };
  return res;
}
// 선택 부품의 간격 표(캐시: 장면·부품·LED 가 같으면 재사용)
function clearanceOf(i) {
  const M = A.store.mspec, S = A.store.session, rt = getMech3d();
  if (!rt?.parts[i]) return null;
  const lp = (M.light.kind === 'step' && L.ledPartsNow(M, S.line)) || [];
  let em = []; try { em = L.currentEmitters(M, S.line); } catch { em = []; }
  const ek = JSON.stringify(em.map((e) => [e.pos, e.axis]));
  if (A.clr && A.clr.rt === rt && A.clr.i === i && A.clr.lp === lp && A.clr.ek === ek) return A.clr.res;
  const r = partClearance(rt.parts, i, { ledParts: lp, emitters: em });
  const res = {
    i, rows: r.parts.map((x) => ({ ...x, name: M.parts[x.part]?.name ?? `부품 ${x.part + 1}` })),
    leds: r.leds.slice(0, 3).map((x) => ({ ...x, name: hitName(M, `l:${x.part}`) })),
    ledMin: r.ledMin, ledAxial: r.ledAxial,
  };
  A.clr = { rt, i, lp, ek, res };
  return res;
}

// ---- 자동설계(P4) ----
function adState() { return (A.ad ??= { open: (() => { try { return localStorage.getItem('uds.m3.autoOpen') === '1'; } catch { return false; } })(), sel: { milky: true, leds: false, shape: false, shapePart: -1, milkyMax: null, height: false, housing: false, housingPart: -1, housingSpecial: false, boost: true }, running: null, result: null, undo: null, milkyPart: null, runner: null, info: null, stepBusy: false, stepWorker: null }); }
function adInfo() {   // 부품별 비 2.5D 비율(관측 방향) — 라인이 있을 때만. (기구·라인) 별 캐시(높이맵 계산이 무거움)
  const st = adState(), S = A.store.session, rt = getMech3d();
  if (!st.info || st.info.rt !== rt || st.info.line !== S.line) st.info = { rt, line: S.line, non25: S.line && rt ? rt.parts.map((p) => heightsFor(p, S.line.frame, 0.5).non25) : [], boxes: rt ? rt.parts.map((p) => bounds(p.positions)) : [] };   // boxes = ④ 기본 대상용 외곽
  return st.info;
}
const adMilkyPart = (M, avail) => (avail.milky.ok ? (avail.milky.parts.find((i) => M.observe.faces.some((f) => f.part === i)) ?? avail.milky.parts[0]) : null);
const adClone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
// 자동설계 카드 펼침 상태 — 새로고침해도 기억(브라우저별 편의 설정)
const AD_OPEN_KEY = 'uds.m3.autoOpen';
function adSetOpen(v) { adState().open = v; try { localStorage.setItem(AD_OPEN_KEY, v ? '1' : '0'); } catch {} renderAuto(); }
function renderAuto() {
  const el = $('#m3-auto'), st = adState();
  el.hidden = false;   // 닫혀 있어도 한 줄 머리는 늘 보인다(메뉴가 사라진 것처럼 보이지 않게)
  if (!st.open) {
    el.innerHTML = '<button type="button" class="m3-ad-collapsed" data-ad="open" aria-expanded="false">✨ 자동설계 <span class="mut">— 펼치기 ▸</span></button>';
    el.querySelector('[data-ad="open"]').onclick = () => { adSetOpen(true); };
    return;
  }
  const M = A.store.mspec, avail = stageAvailability(M, adInfo());
  if (!st.running && !avail.shape.parts?.includes(st.sel.shapePart)) st.sel.shapePart = avail.shape.ok ? avail.shape.parts[0] : -1;   // 부품 소재·형상이 바뀌어 대상이 빠지면 첫 후보로
  if (!st.running && !avail.housing.parts?.includes(st.sel.housingPart)) { const k = defaultHousingPart(M, adInfo().boxes); st.sel.housingPart = avail.housing.ok ? (avail.housing.parts.includes(k) ? k : avail.housing.parts[0]) : -1; }   // ④ 기본 = 관측 부품을 감싸는 가장 큰 불투명 부품
  const mp = st.running ? st.milkyPart : adMilkyPart(M, avail), sel = { ...st.sel, milkyMax: st.sel.milkyMax ?? capDefault(st.sel, avail, mp != null ? M.parts[mp].material.milky : 0) };
  const hm = st.sel.housingPart >= 0 ? reflCat().find((e) => !e.special && e.id === M.parts[st.sel.housingPart]?.reflMaterial) : null;   // ④ 대상 반사 소재
  renderAutoPanel(el, { avail, sel, running: st.running, result: st.result, names: M.parts.map((p) => p.name), canRevert: !!st.undo, applied: st.undo ? st.applied ?? null : null, noLine: !A.store.session.line, milkyPart: mp, housingMat: hm ? { name: hm.name, max: hm.max } : null, catalog: reflCat() }, {
    onSel: (k, v) => { if (st.running) return; st.sel[k] = k === 'milkyMax' ? clampCap(v) : v; renderAuto(); },
    onAction: (k) => ({ run: adRunBoost, stop: adStop, close: () => adSetOpen(false), apply: adApply, cancel: adCancel, revert: adRevert, step: adStep })[k]?.(),
  });
}
function adStop() { const st = adState(); if (!st.running || !st.runner) return; st.runner.cancel(); setStatus('자동설계 중지됨'); }
// 실행 문맥 = 시작 때 스냅샷 { M0: mspec 복사, line, G, obs, rt: 기구 런타임, mp: ① 대상 부품 } — 평가·미리보기·적용이 모두 이것 기준
// 형상 원본 = 원본 메쉬 + 크기·위치 조절(이미 적용된 shapeMod 는 빼고 — 적용 때 shapeMod 를 바꿔 끼우므로 평가와 같게)
// 같은 (원본, xform) 이면 같은 객체 — 세분·높이맵 메모(메쉬 객체 기준)가 맞도록
function adBaseMesh(i, ctx) {
  const rt = ctx.rt, raw = (rt.raw ?? rt).parts[i], xf = ctx.M0.parts[i].xform;
  if (isIdentityXform(xf)) return raw;
  const st = adState(), k = JSON.stringify(xf), c = (st.base ??= [])[i];
  if (c && c.raw === raw && c.k === k) return c.mesh;
  const b = bounds(raw.positions), mesh = scaleMoveMesh(raw, xf, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
  st.base[i] = { raw, k, mesh };
  return mesh;
}
// 형상 후보 메쉬 — 세분은 메모(refinedFor: 후보 27개도 R 3개 → 세분 3번). hDiv = R/hMax(STEP 은 거칠게 3)
// hBottom = lineVarH(mod) — runtime.applyPartMods 와 같게(평가 형상 = 적용 형상)
const adShapeMesh = (base, mod, hDiv = 8) => deformPart(refinedFor(base, mod.frame, mod.centers, mod.R, Math.max(0.1, mod.R / hDiv), lineVarH(mod)), mod.frame, heightsFor(base, mod.frame, mod.cell), mod);
// ② 설계 → LED STEP 배치(step.virtual): Solver 위치 목록이면 { positions }(STEP 편집 배치), 아니면 균등 { count, pitch, rows, rowGap }
const stepVirtOf = (d, rw) => (d.positions ? { positions: d.positions.map((q) => ({ s: q.s, w: q.w ?? 0, dz: 0 })) } : { count: d.count, pitch: d.pitch, ...rw });
const samePos = (a, b) => JSON.stringify((a ?? null) && a.map((q) => [q.s, q.w ?? 0])) === JSON.stringify((b ?? null) && b.map((q) => [q.s, q.w ?? 0]));
// 설계 → (mspec 복사본, 기구 메쉬) — 형상은 후보 메쉬로 바꾼 부품 포함
function designScene(d, ctx) {
  const M = adClone(ctx.M0), rt = ctx.rt, mp = ctx.mp;
  if (mp != null && d.milky != null) M.parts[mp] = setPartMaterialParam(M.parts[mp], 'milky', d.milky);
  const rw = { rows: d.rows === 2 ? 2 : 1, rowGap: d.rows === 2 ? d.rowGap ?? 0 : 0 };   // 열 배치(spec P4 §2.2b) — d.rows 없음 = 1열
  if (M.light.kind === 'manual' && d.count != null) { Object.assign(M.light.manual, { count: d.count, pitch: d.pitch }, d.rows != null ? rw : {}); if (d.positions) M.light.manual.positions = d.positions; else delete M.light.manual.positions; }
  if (M.light.kind === 'step' && M.light.step && d.count != null && d.stepVirt) M.light.step.virtual = stepVirtOf(d, rw);   // Solver 위치 목록 = STEP 편집 배치
  if (d.finish) applyFinish(M, d.finish);   // ④ 그 부품 기본 면 처리
  if (d.dz) applyDz(M, d.dz, ctx.line.frame.d);   // ⑤ STEP offset(+발광점) / 직접 배치 깊이 — 가상 배치는 stepLayout 이 offset 을 따름
  let parts = rt.parts;
  if (d.shape) {
    const i = d.shape.part, mod = shapeModFor(d.shape, M, ctx.line), base = adBaseMesh(i, ctx);
    const mesh = adShapeMesh(base, mod);
    parts = rt.parts.map((p, j) => (j === i ? mesh : p)); M.parts[i].shapeMod = mod;
  }
  return { M, parts };
}
// LED 중심 = 그 설계(M: ② 가 바꾼 개수·피치 반영)의 발광점을 관측 평면에 투영
// e·c 용 중심선(관측 좌표 path·halfW·closed·L)과 ℓ(LED 피치: 직접·가상 배치 = 그 피치/균등 L/n, LED STEP 원래 = 발광점 평균 간격, 1개 = L/4)도 저장 — shapeMod 만으로 형상 결정
const adPaths = new WeakMap();   // 라인별 중심선 메모(후보마다 다시 표본하지 않게)
function shapeModFor({ dt, h, R, e = 0, c = 0 }, M, line) {
  const F = line.frame, em = L.currentEmitters(M, line);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const centers = em.map((x) => [dot(x.pos, F.u), dot(x.pos, F.v)]);
  let P = adPaths.get(line); if (!P) adPaths.set(line, (P = pathFromLine(line, F)));
  const lv = M.light.kind === 'step' ? M.light.step?.virtual ?? null : null, lay = M.light.kind === 'manual' ? M.light.manual : lv && !lv.positions ? lv : null;   // 편집한 배치 = 발광점 간격으로
  const ell = ledEll({ pitch: lay?.pitch ?? 0, count: lay?.count ?? 0, ss: centers.map(([x, y]) => swOnPath(P, x, y)[0]), L: P.L });
  return { frame: { u: F.u, v: F.v, d: F.d }, dt, h, R, e, c, centers, cell: 0.5, path: P.path, halfW: P.halfW, closed: P.closed, L: P.L, ell };
}
// 최종안의 LED 몸체가 기구 부품과 새로 겹치는 수(LED STEP) — 현재안에 이미 있던 겹침은 뺌. 0 = 없음
function designClash(d, ctx, M0, rt, line) {
  if (M0.light.kind !== 'step') return 0;
  try {
    const cnt = (M, mech) => { const lay = L.stepLayout(M, line); return (lay?.leds ?? []).filter((k) => lay.parts[k] && interferenceKeys(lay.parts[k], mech, [], []).size > 0).length; };
    const { M, parts } = designScene(d, ctx);
    return Math.max(0, cnt(M, parts) - cnt(M0, rt.parts));
  } catch { return 0; }
}
// LED 몸체 반폭(관측 평면 u·v 투영 중 큰 쪽의 반) — LED STEP = 기준 LED 몸체, 직접 배치 = 발광면 크기의 반. ② 끝벽·측벽 여유
function ledHalfWidth(M, line) {
  const F = line.frame, sp = M.light.spec ?? {};
  if (M.light.kind === 'step') {
    const ref = stepRefEmitter(M.light.step), P = ref ? L.ledPartsNow(M, null)?.[ref.part]?.positions : null;
    if (P) {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < P.length; i += 3) { const u = P[i] * F.u[0] + P[i + 1] * F.u[1] + P[i + 2] * F.u[2], v = P[i] * F.v[0] + P[i + 1] * F.v[1] + P[i + 2] * F.v[2]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      return Math.max(u1 - u0, v1 - v0) / 2;
    }
  }
  return Math.max(sp.sizeX ?? 2, sp.sizeY ?? 2) / 2;
}
const adJob = (M, parts, ctx, o = {}) => { const j = jobFor(M, parts, { line: ctx.line, G: ctx.G, obs: ctx.obs, ...o }); if (!j) throw new Error('LED 가 없음'); return j; };
const adEff = (r) => { let t = 0; for (const b of r.batches) for (const v of b) t += v; return t / r.ledger.emitted; };
// ⑤ 높이 범위 [아래, 위](관측 방향 d 이동량 mm) + gap(현재 발광점 → 관측 부품 +d 축 거리 최소, 모르면 NaN)
// LED STEP(원래·가상) = LED 부품(PCB 포함) 각각을 기구 부품에 대해 travelDistance(이미 겹친 상대는 뺌) · 직접 배치(깊이) = 발광점 ±d 광선
const rayT = (m, p, d) => (m?.bvh ? intersectRay(m.bvh, p[0], p[1], p[2], d[0], d[1], d[2], 1e-6, Infinity)?.t ?? Infinity : Infinity);
function adHeightInfo(M0, line, rt) {
  const d = line.frame.d, nd = d.map((v) => -v), mech = rt.parts, em = L.currentEmitters(M0, line);
  let up = Infinity, down = Infinity;
  if (M0.light.kind === 'step') {
    for (const p of L.ledPartsNow(M0, line) ?? []) {
      const pre = interferenceKeys(p, mech, [], []), obs = mech.map((m, j) => (pre.has(`p:${j}`) ? null : m));
      up = Math.min(up, travelDistance(p, obs, d, 10)); down = Math.min(down, travelDistance(p, obs, nd, 10));
    }
  } else for (const e of em) for (const m of mech) { up = Math.min(up, rayT(m, e.pos, d)); down = Math.min(down, rayT(m, e.pos, nd)); }
  const range = ledHeightRange({ up, down });
  if (M0.light.kind === 'manual') range[1] = Math.min(range[1], Math.max(0, M0.light.manual.pcb.depth - 0.3));   // 깊이 > 0 유지
  const op = [...new Set(M0.observe.faces.map((f) => f.part))];
  let gap = Infinity; for (const e of em) for (const i of op) gap = Math.min(gap, rayT(mech[i], e.pos, d));
  return { range, gap: Number.isFinite(gap) ? gap : NaN };
}
// 보완 자동 추가(목표 미달 시): 체크한 항목만으로 목표 미달이면 다른 항목을 더해 다시 실행 — 바꾸는 비용이 적은 순서:
// ④ 케이스 면(표면 처리) → ⑤ LED 높이(기구 치수) → ④+⑤ → ② LED 배치(PCB·LED 수) → ②+④ → ②+④+⑤. 처음 통과한 안에서 멈춤.
// 체크한 항목만의 결과는 base 로 결과 위에 남기고, 보완 실행이 실패·중지되면 직전 결과를 다시 보여 줌. 적용은 사용자가 정함
const BOOST_SETS = [['housing'], ['height'], ['housing', 'height'], ['leds'], ['leds', 'housing'], ['leds', 'housing', 'height']];
const BOOST_LABEL = { housing: '④ 케이스 면', height: '⑤ LED 높이', leds: '② LED 배치' };
async function adRunBoost() {
  const st = adState();
  let r = await adRun();
  if (!r || r.feasible || st.sel.boost === false || !st.result) return;
  const b0 = st.result, base = { Ulen: b0.best.Ulen, Uwid: b0.best.Uwid, milky: b0.best.milky, reason: b0.reason, unchanged: b0.unchanged };
  const avail = stageAvailability(A.store.mspec, adInfo()), checked = r.stages;
  const sets = BOOST_SETS.filter((set) => set.every((k) => !checked[k] && avail[k]?.ok));
  let good = b0;
  for (const [i, set] of sets.entries()) {
    const added = set.map((k) => BOOST_LABEL[k]);
    r = await adRun({ stages: { ...checked, ...Object.fromEntries(set.map((k) => [k, true])) }, added, base, step: `${i + 1}/${sets.length}` });
    if (!r) {   // 실패·중지 — 직전 결과를 다시 보여 줌
      if (A && !st.running) { st.result = { ...good, note: `보완(${added.join(' + ')}) 계산이 끝나지 못함 — 직전 결과를 표시` }; A.meshShown = null; renderView(); renderAuto(); }
      return;
    }
    good = st.result;
    if (r.feasible) return;
  }
}
async function adRun(opt = {}) {
  const a = A, st = adState(), S = A.store.session;
  if (!S.line || st.running) return null;
  if (/^자동설계 실패/.test(S.status ?? '')) setStatus('');   // 지난 실패 문구는 지움
  const M0 = adClone(A.store.mspec), line = S.line, rt = getMech3d();   // 실행 격리 — 편집은 실행을 중지시킴(onChange)
  const avail = stageAvailability(M0, adInfo()), stages = opt.stages ?? { milky: st.sel.milky && avail.milky.ok, leds: st.sel.leds && avail.leds.ok, shape: st.sel.shape && avail.shape.ok && avail.shape.parts.includes(st.sel.shapePart),
    height: st.sel.height && avail.height.ok, housing: st.sel.housing && avail.housing.ok && avail.housing.parts.includes(st.sel.housingPart) };
  st.milkyPart = adMilkyPart(M0, avail);
  const hpSel = avail.housing?.parts?.includes(st.sel.housingPart) ? st.sel.housingPart : defaultHousingPart(M0, adInfo().boxes);   // 보완으로 ④ 를 더했으면 기본 케이스 부품
  const obs = tallyObs(M0.observe, M0.observe.dir ?? line.frame.d), G = geometry(obs), sp = st.sel.shapePart, hp = stages.housing ? hpSel : -1;
  let hInfo = null; if (stages.height) { try { hInfo = adHeightInfo(M0, line, rt); } catch { stages.height = false; } }   // 범위 계산 실패 = ⑤ 생략
  const ctx = { M0, line, G, obs, rt, mp: st.milkyPart };
  const R = (st.runner = createAdRunner({ ports: A.pool.ports(), chunkTimeoutMs: 90000 }));   // 높은 Milky 청크는 30 초를 넘기기도 함
  // 같은 Worker 를 쓰므로 점진 계산은 멈춤 — 대기(디바운스) 중이면 장면을 곧 보내므로 취소. 사용자 일시정지 여부는 기억(끝나고 그대로)
  const snap0 = A.prog.snapshot(), ps = snap0.state, currentVerified = reusableCurrent(snap0, G);   // 수렴한 점진 결과 = 현재안(verify 생략)
  st.userPaused = ps === 'paused'; st.deferred = ['paused', 'running', 'pending', 'starting'].includes(ps);
  if (ps === 'pending') A.prog.cancel(); else A.prog.pause();
  st.running = { frac: 0, text: '준비' }; st.result = null; A.meshShown = null; renderView(); renderAuto();
  // LED STEP: 현재 = 가상이면 그 개수·피치, 아니면 현재 발광점 수·0(stepOrig = 원래 위치) · stepVirt = 설계가 가상 배치인가(② 가 STEP 에서 돌면 엔진이 true)
  const stp = M0.light.kind === 'step', sv0 = stp ? M0.light.step?.virtual ?? null : null, sv = sv0 && !sv0.positions ? sv0 : null;   // STEP 에서 편집한 배치(positions) = 원래 배치처럼 '현재 그대로'
  let nOrig = 0; if (stp && !sv) { try { nOrig = L.currentEmitters(M0, line).length; } catch { nOrig = 0; } }
  const rsrc = stp ? sv : M0.light.manual, rows = rsrc?.rows === 2 ? 2 : 1;   // 열 배치 — STEP 원래 위치 = 1열
  const cur = { milky: ctx.mp != null ? M0.parts[ctx.mp].material.milky : null, count: stp ? (sv ? sv.count : nOrig) : M0.light.manual?.count ?? 0, pitch: stp ? sv?.pitch ?? 0 : M0.light.manual?.pitch ?? 0, rows, rowGap: rows === 2 ? rsrc.rowGap ?? 0 : 0, shape: null, finish: null, dz: 0, ...(stp ? { stepOrig: !sv, stepVirt: !!sv } : {}) };
  ctx.cur = cur;
  // ④ 후보 = 반사 소재 상한 안(+ 특수 허용 시 특수 처리) — 소재 미지정 = 전체 등급(spec P4 §2.3d)
  const finCands = (k) => finishCandidatesFor({ catalog: reflCat(), materialId: M0.parts[k].reflMaterial, current: M0.parts[k].finish, allowSpecial: !!st.sel.housingSpecial });
  const finishCands = stages.housing ? finCands(hp) : null;
  const varTot = { height: (hInfo ? heightCandidates(hInfo.range, 7).length : 0) + 2, housing: (finishCands?.length ?? 0) + 2 }, varI = { height: 0, housing: 0 };   // 진행률 분모 = 1차 후보 + 정밀 2개
  const minWall = { ...defaultChecks(), ...(M0.checks ?? {}) }.minWall, t0 = performance.now();
  // ③ 변수 범위(Δt·h·R·e·c) — 엔진이 선별 → 격자 → 압축. 진행률 분모는 io.shapePlan 으로 받음(격자 크기 모르는 선별 중엔 최대 격자 27 로 어림)
  const shapeRanges = stages.shape ? shapeVarRanges({ t0: heightsFor(adBaseMesh(sp, ctx), line.frame, 0.5).t0, pitch: cur.count > 1 ? (cur.pitch > 0 ? cur.pitch : line.length / cur.count) : line.length, hasCenters: true }) : null;
  let shapeI = 0, shapeScr = 0, shapeTot = 1;
  const progress = (stage, frac, text) => {   // 전체 진행률(단계 무게) + 남은 시간
    if (A !== a || R.stopped) return;
    const f = overallFrac(stages, stage, frac), eta = etaText(performance.now() - t0, f);
    const tx = opt.added?.length ? `보완 ${opt.step ?? ''} (${opt.added.join(' + ')}) · ${text}` : text;
    st.running = { frac: f, text: eta ? `${tx} · ${eta}` : tx }; renderAuto();
  };
  const io = {
    progress,
    cancelled: () => R.stopped,
    shapePlan: ({ screen, total }) => { shapeScr = screen; shapeTot = Math.max(1, total ?? shapeTotal(screen, 27)); },
    async milkyRows(d, ms, { precise = false } = {}) {   // 재가중 기준 = 창 가운데. 시간 제한(Milky 4~5 는 광자당 ~10배) — 경계가 든 창은 정밀 재추적
      const { M: Md, parts } = designScene({ ...d, milky: ms[Math.floor(ms.length / 2)] }, ctx);
      const hi = ms[Math.floor(ms.length / 2)] >= 6;   // 높은 Milky 는 광자당 매우 느림 — 탐색 창은 최소 광자를 낮춤(정밀 창은 그대로)
      const r = await R.trace(adJob(Md, parts, ctx), { ...(precise ? { N: 3e6, maxMs: 6000 } : { N: 1.5e6, maxMs: 2000, minN: hi ? 5e4 : 1e5 }), rw: { part: ctx.mp, milkies: ms } });
      return milkyRows(G, obs, { milkies: ms, batches: r.rwBatches, ess: r.ess, emitted: r.ledger.emitted });
    },
    // ② 후보 = (s, w) 격자(spec P4 §2.2b): s 2 mm × w ∈ {0, ±δk}, δk = 0.2/0.27/0.33·W(반폭 − 0.5 로 자름) — 후보 수 ≈ (L/2+1)·7, 후보당 ≤ 1.2만 광자(60 s 예산)
    async basis(d) {   // ①·④ 를 함께 켜면 실행기가 d.milky = 거친 최고점 · d.finish = 최고 등급으로 넘김(§2.2c)
      const gaps = rowGapOptions(line), cand = candidateGrid(line, { sStep: 2, wOffsets: [0, ...gaps.flatMap((g) => [-g, g])] });
      const { M: Md, parts } = designScene({ ...d, rows: 1, rowGap: 0 }, ctx), ledHalf = ledHalfWidth(Md, line);
      let sets;
      if (Md.light.kind === 'step') {   // 기준 LED 발광점을 후보 위치로 · 장면은 LED 몸체 없이(PCB·기타만 = 가상 0개)
        sets = virtualEmittersAt({ parts: L.ledPartsNow(Md), step: Md.light.step, line, positions: cand }).map((e) => [e]);
        Md.light.step.virtual = { count: 0, pitch: 0 };
      } else sets = cand.map(({ s, w }) => [ledAtS(line, s, Md.light.manual, rt, w)]);
      // 시간 예산 60 s(spec §2.2c): 후보당 1.2만 광자, 넘치면 줄임(≥ 3000) — 지도는 후보마다 방출 1 기준(emitted = 1)
      const r = await R.traceEach(adJob(Md, parts, ctx, { emitters: sets[0] }), sets, { N: 12000, maxMs: 60000, minN: 3000, onProgress: (i, n) => progress('leds', i / n, `LED 위치 후보 시험 ${i}/${n}`) });
      // 간섭 방지: LED 몸체 반폭 + 0.3 mm 만큼 라인 끝에서 떨어지게(끝벽), 2열 간격도 반폭만큼 안쪽(측벽)
      const m = ledHalf + 0.3, gapsOk = gaps.filter((g) => !(line.width > 0) || g + m <= line.width / 2 + 1e-9);
      return { cand, maps: r.maps, emitted: r.emitted, gaps: gapsOk, sMargin: m };
    },
    async evalShapes(d, cands, N, maxMs = 2500) {   // 단계별 광자·시간 제한은 halving 일정(6만/20만/60만 · 2.5/4/6초)
      const out = [], base = adBaseMesh(sp, ctx), H = heightsFor(base, line.frame, 0.5);
      const others = rt.parts.map((p, j) => (j === sp ? null : p)), lp = (M0.light.kind === 'step' && L.ledPartsNow(designScene(d, ctx).M, ctx.line)) || [];   // ② 가 바꾼 가상 배치 몸체 포함
      // 기준 겹침 = '변화 없음' 형상(같은 세분·변형 경로)의 겹침 — 원본 메쉬로 재면 케이스 벽에 닿아 있는 부품(접촉)은
      // 세분 메쉬가 늘 '새 간섭' 으로 잡혀 모든 후보가 탈락했음(2026-10-21)
      const zc = { dt: 0, h: 0, R: cands[0]?.R ?? 1, e: 0, c: 0 }, zp = designScene({ ...d, shape: { part: sp, ...zc } }, ctx).parts[sp];
      const before = new Map(); for (const M of [interferenceKeys(base, others, lp, []), interferenceKeys(zp, others, lp, [])]) for (const [k, v] of M) before.set(k, Math.max(before.get(k) ?? 0, v ?? 0));   // 부품별 기존 겹침 깊이
      for (const c of cands) {
        if (R.stopped) break;
        progress('shape', Math.min(1, shapeI / shapeTot), shapeI < shapeScr ? `형상 변수 선별 ${shapeI + 1}/${shapeScr}` : `형상 후보 ${Math.min(shapeI + 1, shapeTot) - shapeScr}/${shapeTot - shapeScr}`); shapeI++;
        const { M: Md, parts } = designScene({ ...d, shape: { part: sp, ...c } }, ctx), mod = Md.parts[sp].shapeMod;
        const thin = minThickness(H, mod) < minWall;   // 칸 중심 + LED 중심
        const clash = !thin && [...interferenceKeys(parts[sp], others, lp, [])].some(([k, v]) => !before.has(k) || (v ?? 0) > before.get(k) + 0.05);   // 새 겹침 또는 기존보다 0.05 mm 넘게 깊어짐
        if (thin || clash) { out.push({ cand: c, ok: false, why: thin ? '살두께' : '간섭' }); continue; }
        const r = await R.trace(adJob(Md, parts, ctx), { N, maxMs, minN: Math.min(N, 3e4), batches: 4 }), stt = tallyStats(G, r.batches, obs);
        out.push({ cand: c, ok: !stt.empty, stats: stt, eff: adEff(r) });
      }
      return out;
    },
    async evalVariants(d, cands, N, maxMs = 2500) {   // ⑤ { dz } · ④ { finish } 후보 — 형상 평가와 같은 예산(간섭은 범위가 이미 피함)
      const out = [], stg = cands.length && 'dz' in cands[0] ? 'height' : 'housing', nm = stg === 'height' ? 'LED 높이' : '케이스 면';
      for (const c of cands) {
        if (R.stopped) break;
        if (stages[stg]) { const k = ++varI[stg]; progress(stg, Math.min(1, (k - 1) / varTot[stg]), `${nm} 후보 ${Math.min(k, varTot[stg])}/${varTot[stg]}`); }   // ① 보완 계산(④ 미선택)은 ① 진행률 그대로
        const { M: Md, parts } = designScene({ ...d, ...('dz' in c ? { dz: c.dz } : { finish: c.finish }) }, ctx);
        const r = await R.trace(adJob(Md, parts, ctx), { N, maxMs, minN: Math.min(N, 3e4), batches: 4 }), stt = tallyStats(G, r.batches, obs);
        out.push({ cand: c, ok: !stt.empty, stats: stt, eff: adEff(r) });
      }
      return out;
    },
    async verify(d) {   // 정밀 재판정(현재안·최종안): 200만 광자 또는 6초(≥ 30만) — 잡음 ≈ ±2%
      const { M: Md, parts } = designScene(d, ctx);
      const r = await R.trace(adJob(Md, parts, ctx), { N: 2e6, maxMs: 6000, minN: 3e5, batches: 10 });
      return { stats: tallyStats(G, r.batches, obs), eff: adEff(r) };
    },
  };
  // ① 보완 계산 — ④ 를 안 쓸 때만: 기본 케이스 부품의 면 처리 한 단계 위(최고 등급이면 생략)
  let housingProbe = null;
  if (stages.milky && !stages.housing && avail.housing?.ok) {
    const k = defaultHousingPart(M0, adInfo().boxes), nf = avail.housing.parts.includes(k) ? nextFinish(M0.parts[k].finish, finCands(k).filter((f) => !f.current)) : null;   // 소재 상한 안(특수 허용 시 특수 포함) — 없으면 안내 생략
    if (nf) housingProbe = { part: k, kind: nf.kind, R: nf.R, ...(nf.coating ? { coating: nf.coating } : {}) };
  }
  let res = null;
  try {
    res = await runAutoDesign({
      stages, obs, G, line, current: cur, milkyMax: st.sel.milkyMax ?? null, housingProbe, finishText: (f) => finishText(f, reflCat()), nMax: Math.max(1, Math.min(60, Math.floor(line.length / 2))), pitchRange: null, stepMode: stp,
      shapePart: sp, shapeRanges, currentVerified, heightRange: hInfo?.range ?? null, housingPart: hp, finishCands, ledsAtCurrentMilky: !!opt.added?.length,
    }, io);
  } catch (e) { if (A === a && !R.stopped) setStatus(`자동설계 실패: ${e.message}`); }
  if (A !== a) return;   // 그사이 이탈
  globalThis.__adLast = res;   // 진단용(콘솔에서 단계별 결과 확인)
  st.running = null; st.runner = null;
  if (res && !res.cancelled && !R.stopped) {
    const C = res.current;   // 현재안 = 최종안과 같은 추정기
    let nStep = null; if (M0.light.kind === 'step') { try { nStep = L.currentEmitters(M0, line).length; } catch { nStep = 0; } }
    const smI = sp >= 0 && M0.parts[sp]?.shapeMod ? sp : M0.parts.findIndex((p) => p.shapeMod), sm = smI >= 0 ? M0.parts[smI].shapeMod : null;   // 비교표 '현재' 열 — 이미 적용된 형상(표시만)
    st.result = { design: res.best, feasible: res.feasible, reason: res.reason, hint: res.hint ?? null, shape: res.best.shape ?? null, screen: res.steps?.find((x) => x.stage === 'shapeScreen')?.gains ?? null, stepLeds: nStep, unchanged: !!res.unchanged, ctx, stages,
      added: opt.added ?? [], base: opt.base ?? null, clash: designClash(res.best, ctx, M0, rt, line),
      finish: stages.housing ? (() => { const c = { ...M0.parts[hp].finish, ...(M0.parts[hp].coating ? { coating: M0.parts[hp].coating } : {}) }; return { cur: c, best: res.best.finish ?? c }; })() : null, height: stages.height && hInfo ? { dz: res.best.dz ?? 0, gap: hInfo.gap } : null,
      cur: { ...cur, shape: sm ? { dt: sm.dt, h: sm.h, R: sm.R, e: sm.e ?? 0, c: sm.c ?? 0 } : null, Ulen: C?.stats?.Ulen, Uwid: C?.stats?.Uwid, eff: C?.eff ?? NaN, profile: C?.stats?.profile ?? null },
      best: { ...res.best, ...(stp ? { stepOrig: !res.best.stepVirt } : {}), Ulen: res.verified.stats.Ulen, Uwid: res.verified.stats.Uwid, eff: res.verified.eff, profile: res.verified.stats.profile ?? null } };
  }
  // Worker 에 자동설계 장면이 올라가 있음 — 진행 중이던 계산·실행 중 편집은 다시 시작, 끝난 계산은 그대로.
  // restart 는 일시정지 상태를 이어가므로(wantPaused) 사용자가 멈춘 게 아니면 resume(대기 중 resume = 일시정지 요청 해제)
  if (st.deferred) { st.deferred = false; restartCalc(); if (st.userPaused) A.prog.pause(); else A.prog.resume(); }
  A.meshShown = null; renderView(); renderAuto();
  return res && !res.cancelled && !R.stopped && st.result ? { feasible: !!res.feasible, stages } : null;
}
// 비교 중 3D 미리보기 — 결과마다 한 번 만들어 둠(meshKey 비교용 객체)
function adPreview() {
  const r = A.ad?.result;
  if (!r) return null;
  if (!r.preview) { const { M, parts } = designScene(r.design, r.ctx); r.preview = { M, parts, raw: r.ctx.rt.raw }; }
  return r.preview;
}
function adCancel() { const st = adState(); st.result = null; A.meshShown = null; renderView(); renderAuto(); }
// 적용 = 바뀐 항목만 씀(① Milky 값이 다르면 · ② 를 돌렸고 개수·피치가 다르면(LED STEP = step.virtual) · ③ 형상). 되돌리기용으로 그 항목의 전체 복사본을 남김
function adApply() {
  const st = adState(), r = st.result, d = r?.design;
  if (!d || r.unchanged) return;
  const M = A.store.mspec, mp = r.ctx.mp, Lm = M.light.manual;
  const milkyCh = mp != null && d.milky != null && d.milky !== M.parts[mp].material.milky;
  const rw = { rows: d.rows === 2 ? 2 : 1, rowGap: d.rows === 2 ? d.rowGap ?? 0 : 0 }, rowsCh = (o) => (o?.rows === 2 ? 2 : 1) !== rw.rows || (rw.rows === 2 && o.rowGap !== rw.rowGap);   // 열 배치도 비교
  const lightCh = !!r.stages?.leds && M.light.kind === 'manual' && d.count != null && (d.count !== Lm.count || d.pitch !== Lm.pitch || rowsCh(Lm) || !samePos(d.positions, Lm.positions));
  const sv = M.light.kind === 'step' ? M.light.step?.virtual ?? null : null;   // LED STEP: 가상 배치로 바뀌었고 이전과 다르면
  const stepCh = !!r.stages?.leds && M.light.kind === 'step' && !!M.light.step && d.count != null && !!d.stepVirt && (!sv || (d.positions ? !samePos(d.positions, sv.positions) : sv.count !== d.count || sv.pitch !== d.pitch || rowsCh(sv)));
  const mod = d.shape ? adPreview().M.parts[d.shape.part].shapeMod : null;
  const fp = d.finish?.part, pf = fp != null ? M.parts[fp]?.finish : null, pc = fp != null ? M.parts[fp]?.coating ?? null : null;
  const finCh = fp != null && !(pf?.kind === d.finish.kind && (pf?.R ?? null) === (d.finish.R ?? null) && pc === (d.finish.coating ?? null));   // ④ 면 처리(특수 처리 표시 포함)가 다르면
  const dzCh = Math.abs(d.dz ?? 0) > 1e-9 && (M.light.kind === 'step' ? !!M.light.step : M.light.manual?.pcb?.kind === 'depth');   // ⑤ 이동 있음
  const undo = { milky: milkyCh ? [mp, adClone(M.parts[mp].material)] : null, manual: lightCh ? adClone(Lm) : null, stepVirt: stepCh ? { v: adClone(sv) } : null, shape: mod ? [d.shape.part, adClone(M.parts[d.shape.part].shapeMod ?? null)] : null,
    finish: finCh ? [fp, adClone(pf), pc] : null, dz: dzCh ? (M.light.kind === 'step' ? { step: adClone({ offset: M.light.step.offset, emitters: M.light.step.emitters }) } : { depth: M.light.manual.pcb.depth }) : null };
  const tm = new Date();
  st.applied = { ...r, catalog: reflCat(), at: `${tm.getHours()}:${String(tm.getMinutes()).padStart(2, '0')} 적용` };   // 적용 뒤 요약(이전 → 적용 후) — renderAutoPanel 이 compareHtml 과 같은 인자로 그림
  st.result = null; A.meshShown = null;
  if (undo.milky || undo.manual || undo.stepVirt || undo.shape || undo.finish || undo.dz) st.undo = undo;
  if (milkyCh) A.store.update('material', (m) => { m.parts[mp] = setPartMaterialParam(m.parts[mp], 'milky', d.milky); });
  if (lightCh) A.store.update('light', (m) => { Object.assign(m.light.manual, { count: d.count, pitch: d.pitch }, rw); if (d.positions) m.light.manual.positions = adClone(d.positions); else delete m.light.manual.positions; });
  if (stepCh) A.store.update('light', (m, x) => { m.light.step.virtual = stepVirtOf(d, rw); if (x.pick === 'led' || x.pick === 'ledx') x.pick = null; });   // 가상 중엔 발광면·제외 클릭 끔
  if (mod) A.store.update('material', (m) => { m.parts[d.shape.part].shapeMod = mod; applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  if (finCh) A.store.update('material', (m) => { applyFinish(m, d.finish); });
  if (dzCh) A.store.update('light', (m) => { applyDz(m, d.dz, r.ctx.line.frame.d); });   // STEP: 발광점도 같은 이동(재인식과 같음)
  renderAuto();
}
// 되돌리기 = 적용한 항목을 저장한 복사본으로 통째로 바꿈
function adRevert() {
  const st = adState(), u = st.undo;
  if (!u) return;
  st.undo = null; st.result = null; A.meshShown = null;
  if (u.milky) A.store.update('material', (m) => { m.parts[u.milky[0]] = { ...m.parts[u.milky[0]], material: adClone(u.milky[1]) }; });
  if (u.manual) A.store.update('light', (m) => { m.light.manual = adClone(u.manual); });
  if (u.stepVirt) A.store.update('light', (m) => { m.light.step.virtual = adClone(u.stepVirt.v); });   // null(원래 위치) 또는 이전 가상 값
  if (u.shape) A.store.update('material', (m) => { if (u.shape[1]) m.parts[u.shape[0]].shapeMod = adClone(u.shape[1]); else delete m.parts[u.shape[0]].shapeMod; applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  if (u.finish) A.store.update('material', (m) => { const q = { ...m.parts[u.finish[0]], finish: adClone(u.finish[1]) }; if (u.finish[2]) q.coating = u.finish[2]; else delete q.coating; m.parts[u.finish[0]] = q; });
  if (u.dz) A.store.update('light', (m) => { if (u.dz.step) Object.assign(m.light.step, adClone(u.dz.step)); else m.light.manual.pcb.depth = u.dz.depth; });
  renderView(); renderAuto();
}
function adStep() {
  const st = adState(), r = st.result, d = r?.design;
  if (!d?.shape || st.stepBusy) return;   // 생성 중 반복 클릭 무시
  const { M } = adPreview(), i = d.shape.part, name = M.parts[i].name, file = `${String(name ?? 'part').replace(/[/\\:*?"<>|]/g, '_')}-p4.stp`;
  const base = adBaseMesh(i, r.ctx), mod = M.parts[i].shapeMod, mesh = adShapeMesh(base, mod, 3), nTri = mesh.triangles.length / 3;   // 내보내기는 거친 세분(hMax = R/3) — 삼각형 수 줄임
  let spline = null; try { spline = splineInput(base, heightsFor(base, mod.frame, mod.cell), mod); } catch { /* 메쉬 경로 */ }   // 직사각형·평평한 윗면이면 B-스플라인 곡면 솔리드
  const w = new Worker(new URL('../../export/mesh-step-worker.js', import.meta.url), { type: 'module' });
  st.stepBusy = true; st.stepWorker = w;
  const end = () => { w.terminate(); if (st.stepWorker === w) { st.stepWorker = null; st.stepBusy = false; } };
  setStatus(spline ? 'STEP 생성 중… (곡면)' : nTri > 30000 ? `STEP 생성 중… 삼각형 ${nTri}개 — 많아서 오래 걸리거나 실패할 수 있음` : 'STEP 생성 중…');
  w.onmessage = (ev) => {
    if (ev.data.type === 'done') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ev.data.stepText], { type: 'application/step' })); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); setStatus(ev.data.note ? `STEP 내보내기 완료 — ${ev.data.note}` : 'STEP 내보내기 완료'); }
    else setStatus(`STEP 실패: ${ev.data.message}`);
    end();
  };
  w.onerror = (e) => { setStatus(`STEP 실패: ${e.message ?? e}`); end(); };
  w.postMessage({ mesh: { positions: mesh.positions, triangles: mesh.triangles }, spline, name });
}

// ---- 3D 클릭 (main.js:393-425) — 기구 부품 수(nMech) 이상인 번호는 LED STEP 부품 ----
function onPick(s) {
  const st = A.store, M = st.mspec, S = st.session, nMech = getMech3d().parts.length, pick = S.pick;
  const say = (t) => st.update('session', (_, x) => { x.status = t; });
  if (!pick && s) {   // LED 몸체·빛 원뿔 클릭 = LED 선택(spec §4a)
    const n = ledOfHit(s, nMech, M.light.kind === 'step' ? L.stepLayout(M, S.line) : null);
    if (n != null) { st.update('session', (_, x) => { x.ledSel = n; x.node = 'leds'; x.sel = null; }); return; }
  }
  if (s && s.part == null && pick !== 'led' && pick !== 'ledx') s = null;   // 선택 모드 빈 곳 클릭(광선만) — LED 모드에서만 씀
  if ((pick === 'led' || pick === 'ledx') && s && M.light.step?.virtual) { say('배치를 편집한 상태 — [STEP 원래대로] 뒤에 지정하세요'); return; }   // 클릭 번호 = 가상 부품
  if ((pick === 'led' || pick === 'ledx') && s && s.part != null && s.part < nMech) { say('LED STEP 부품(PCB·LED)을 클릭하세요 — 기구 부품은 이 모드에서 선택되지 않음'); return; }
  if (pick === 'obs' && s && s.part < nMech) {
    st.update('observe', (m) => {
      const k = m.observe.faces.findIndex((f) => f.part === s.part && f.face === s.face);
      if (k >= 0) m.observe.faces.splice(k, 1); else m.observe.faces.push({ part: s.part, face: s.face });
    });
    return;
  }
  if (pick === 'led' && s && M.light.step) {
    const p = L.snapLedPick(M, s, nMech, true);
    if (!p) { say('가까운 LED 를 찾지 못함 — LED 가까이를 클릭하세요'); return; }
    st.update('light', (m, x) => {
      try {
        L.applyStepRecognition(m, x, m.light.step, { part: p.part, face: p.face });
        if (p.snapped) x.ledInfo += ' (가까운 LED · 윗면 발광으로 가정 — 측면 발광 LED 는 확대해서 발광면을 직접 클릭)';
        x.pick = null; x.status = '';
      } catch (e) { x.ledInfo = `LED 인식 실패: ${e.message}`; }
    });
    return;
  }
  if (pick === 'ledx' && s && M.light.step) {
    const p = L.snapLedPick(M, s, nMech, false);
    if (!p) { say('가까운 LED 를 찾지 못함 — LED 가까이를 클릭하세요'); return; }
    st.update('light', (m, x) => {
      const stp = m.light.step, i = p.part; stp.excluded ??= []; x.status = '';
      const k = stp.excluded.indexOf(i); if (k >= 0) stp.excluded.splice(k, 1); else if (stp.leds.includes(i)) stp.excluded.push(i);
    });
    return;
  }
  if (pick === 'pcb' && s && s.part < nMech) { st.update('light', (m, x) => { m.light.manual.pcb = { kind: 'face', part: s.part, face: s.face }; x.pick = null; }); return; }
  st.update('session', (_, x) => { x.sel = s && s.part < nMech ? s : null; x.ledSel = null; if (x.sel) x.node = `part:${x.sel.part}`; });   // LED STEP 부품은 소재 편집 대상이 아님
}

// ---- 속성 편집 처리기 (main.js:348-361, 426-451) — 태그가 계산·점검 범위를 정한다 ----
function propHandlers() {
  const st = A.store, ctx = A.ctx;
  const part = (i, fn) => st.update('material', (m) => { m.parts[i] = fn(m.parts[i]); });
  return {
    onKind: (i, k) => part(i, (p) => setPartMaterial(p, k)),
    onMat: (i, key, v) => part(i, (p) => {
      let q = setPartMaterialParam(p, key, v);
      // DB 소재 선택: Milky 칸을 그 소재의 피팅 μs' 에 해당하는 값으로(Milky = 농도 — 이후 사용자가 조절)
      const ent = key === 'dbId' && v ? ctx.materialDb()?.get(v) : null, tbl = ctx.l2Table();
      if (ent && tbl) q = setPartMaterialParam(q, 'milky', Math.round(ctx.milkyFromMusR(tbl, ent.fitted.musR) * 100) / 100);
      return q;
    }),
    // 면 처리: 반사 소재(또는 특수 처리) 상한을 넘으면 상한으로 자르고 알림(spec P4 §2.3d)
    onFinish: (i, face, f) => st.update('material', (m, x) => {
      const r = partFinishEdit(m.parts[i], face, f, reflCat());
      m.parts[i] = r.part;
      if (r.clamped) x.status = `소재 상한(${Math.round(r.max * 100)}%) 초과 — 특수 표면처리는 자동설계 ④ 에서 허용`;
    }),
    onReflMaterial: (i, id) => st.update('material', (m) => { m.parts[i] = setReflMaterial(m.parts[i], id, reflCat()); }),
    // 측정값으로 반사 소재 추가(spec P4 §2.3e) — 사용자 항목 등록 후 이 부품에 적용. f = 양식 문자열(% 단위) → 오류 문구 | 없음
    onReflAdd: (i, f) => {
      const db = ctx.reflectDb?.(); if (!db) return '반사 소재 DB 없음';
      const r = entryFromForm(f); if (r.error) return r.error;
      const e = { ...r.entry, id: uniqueReflId(db, r.entry.id) };
      try { db.add(e); } catch (err) { return err.message; }
      st.update('material', (m, x) => { m.parts[i] = setReflMaterial(m.parts[i], e.id, reflCat()); x.status = `반사 소재 "${e.name}" 등록 · 적용(R ${pct1(e.R)}%, 상한 ${pct1(e.Rmax)}%)`; });
      return null;
    },
    // 공용 항목 → 사용자 사본 만들고 이 부품을 사본으로
    onReflCopy: (i, id) => {
      const db = ctx.reflectDb?.(), e = db?.get(id); if (!e) return;
      const c = copyAsUser(e); c.id = uniqueReflId(db, c.id);
      try { db.add(c); } catch (err) { setStatus(`복사 실패: ${err.message}`); return; }
      st.update('material', (m, x) => { m.parts[i] = setReflMaterial(m.parts[i], c.id, reflCat()); x.status = `사용자 사본 "${c.name}" 을 만들어 적용 — 목표 노드의 반사 소재 DB 에서 고칠 수 있습니다`; });
    },
    onFitDialog: (i) => openFitDialog(i),
    // 반사 소재 DB 관리(목표 노드) — 바뀐 뒤 다시 그림(부품 속성·자동설계 ④ 후보·카드). 오류 문구 | null
    onReflDb: (op, id, arg) => {
      const db = ctx.reflectDb?.(); if (!db) { setStatus('반사 소재 DB 없음'); return '반사 소재 DB 없음'; }
      if (op === 'export') { downloadText('uds-reflect.json', db.exportJson('all'), 'application/json'); setStatus('반사 소재 DB 를 uds-reflect.json 으로 내보냄'); return null; }
      let msg = '', err = null;
      try {
        if (op === 'rename') { db.update(id, { name: arg }); msg = `이름 바꿈: ${arg}`; }
        else if (op === 'samples') {
          const e = db.get(id), { values, bad } = parsePercents(arg?.values);
          if (bad.length || !values.length) err = bad.length ? `측정 반사율은 0~100 % 숫자: ${bad.join(', ')}` : '측정 반사율 %를 입력하세요';
          else { const q = db.update(id, addSamples(e, values.map((R) => ({ R, cond: arg.cond ?? '', note: arg.note ?? '' })))); msg = `"${q.name}" 측정 ${q.samples.length}회 · R ${pct1(q.R)}% · 상한 ${pct1(q.Rmax)}%`; }
        } else if (op === 'remove') { const e = db.get(id); if (db.remove(id)) msg = `"${e?.name ?? id}" 삭제 — 이 소재를 쓰던 부품은 "없는 소재" 로 표시`; }
        else if (op === 'copy') { const c = copyAsUser(db.get(id)); c.id = uniqueReflId(db, c.id); db.add(c); msg = `사용자 사본 "${c.name}" 을 만들었습니다`; }
        else if (op === 'import') { const r = db.importJson(arg); msg = `반사 소재 불러옴 ${r.added.length}건${r.rejected.length ? ` · 거부 ${r.rejected.length}건: ${r.rejected.join('; ')}` : ''}`; }
      } catch (e) { err = `반사 소재 DB ${op === 'import' ? '불러오기' : '고침'} 실패: ${e.message}`; }
      if (err) { setStatus(err); return err; }
      st.update('session', (_, x) => { x.status = msg || x.status; });
      return null;
    },
    // 크기·위치 조절: 장면을 바꾸고 접촉면을 다시 찾는다(같은 면 쌍은 모드 유지). xf = null → 원래대로
    // 새 간섭이 생기면 간섭 직전까지만 적용(limitXform). 직접 배치 LED 는 라인을 따라 다시 놓이므로 고정 LED(STEP)만 장애물
    onXform: (i, want, note = '') => st.update('material', (m, x) => {
      let xf = want;
      x.xfMsg = note ? { part: i, text: note } : null;
      if (xf) {
        const rt = getMech3d(), stp = m.light.kind === 'step';
        let em = []; try { em = stp ? L.currentEmitters(m, x.line) : []; } catch { em = []; }
        const r = limitXform(rt.raw.parts[i], m.parts[i].xform ?? null, xf, rt.parts.map((p, j) => (j === i ? null : p)), { ledParts: (stp && L.ledPartsNow(m, x.line)) || [], emitters: em });
        if (r.limited) { xf = r.xf; x.xfMsg = { part: i, text: `${hitName(m, r.hit, x.line)}과(와) 간섭 — 간섭 직전(입력의 ${Math.round(r.t * 100)}%)까지만 적용` }; }
      }
      if (xf) m.parts[i].xform = xf; else delete m.parts[i].xform;
      if (applyPartMods(m.parts)) m.contacts = redetectContacts(m.contacts);
    }),
    onContact: (i, mode) => st.update('contacts', (m) => { m.contacts[i] = { ...m.contacts[i], mode }; }),
    onLightKind: (k) => st.update('light', (m, x) => { m.light.kind = k; x.pick = null; }),
    onLedFile: (f) => importLedStep(f),
    onPick: (mode) => st.update('session', (_, x) => { x.pick = mode; }),
    onStep: (key, v) => st.update('light', (m, x) => {
      const s = m.light.step; (key[0] === 'o' ? s.offset : s.rot)['xyz'.indexOf(key[1])] = v;
      if (s.ref) { try { L.applyStepRecognition(m, x, s, s.ref); } catch (e) { s.emitters = []; x.ledInfo = `LED 인식 실패: ${e.message}`; } }
    }),
    // LED STEP 배치 편집(spec m3-cad-ui §4b): 지금 배치(제외·개별 이동 반영)를 위치 목록으로 굳힌 뒤 추가·같은 간격 | orig = STEP 원래대로
    onLedEdit: (op) => st.update('light', (m, x) => ledEdit(m, x, op)),
    onManual: (key, v) => st.update('light', (m, x) => {
      const Lm = m.light.manual;
      if (key === 'pcbKind') { Lm.pcb = v === 'depth' ? { kind: 'depth', depth: 10 } : { kind: 'face' }; if (x.pick === 'pcb') x.pick = null; }
      else if (key === 'depth') Lm.pcb.depth = v;
      else if (key === 'rows') { Lm.rows = v === 2 ? 2 : 1; if (Lm.rows === 2 && !(Lm.rowGap > 0)) Lm.rowGap = defaultRowGap(x.line); }   // 처음 2열 = 0.27·W
      else if (key === 'rowGap') { const g = x.line ? Math.floor(clampRowGap(x.line, v) * 10 + 1e-9) / 10 : Math.max(0, v); Lm.rowGap = g; if (g !== v) x.status = `열 간격 보정: ±${g}mm(관측 폭 안으로)`; }
      else Lm[key] = key === 'count' ? Math.max(1, Math.round(v)) : v;
      if (['count', 'pitch', 'rows', 'rowGap'].includes(key)) delete Lm.positions;   // 손으로 고치면 Solver 위치 목록은 버림
    }),
    onSolder: (v) => st.update('light', (m) => { m.light.solder = v; }),
    onLedSpec: (key, v) => st.update(key === 'fluxLm' ? 'target' : 'light', (m) => { m.light.spec[key] = v; }),   // 광속은 휘도 환산만 — 재계산 없음
    // LED 선택·속성(spec §4a)
    onLedSel: (n) => st.update('session', (_, x) => { x.ledSel = n; if (n != null) { x.node = 'leds'; x.sel = null; } }),
    onLedBeam: (a) => { const b = beamSpec(a); if (b) st.update('light', (m) => { Object.assign(m.light.spec, b); }); },   // 120 = 램버시안, 그 밖 = 가우시안
    onLedDist: (g) => ledDist(g),
    onLedAdjust: (n, adj) => st.update('light', (m) => { setLedAdjust(m.light, n, adj); }),
    // 이 LED 삭제: 원래 STEP = 제외 토글(번호 n = step.leds 위치) · 편집한 배치 = 목록에서 뺌
    onLedExclude: (n) => st.update('light', (m, x) => {
      const stp = m.light.step;
      if (stp?.virtual) { ledEdit(m, x, 'del', n); return; }
      const p = stp?.leds?.[n]; if (p == null) return;
      stp.excluded ??= []; const k = stp.excluded.indexOf(p); if (k >= 0) stp.excluded.splice(k, 1); else stp.excluded.push(p);
    }),
    onObs: (key, v) => st.update('observe', (m) => { m.observe[key] = v; }),
    onClearObs: () => st.update('observe', (m) => { m.observe.faces = []; }),
    onObsDir: (v) => st.update('observe', (m) => { m.observe.dir = v ? (() => { const l = Math.hypot(...v); return v.map((x) => x / l); })() : null; }),
    onRetryLine: () => { A.lineKey = ''; refreshLine(); },
    onTarget: (key, v) => st.update('target', (m) => { m.observe[key] = v; }),
    onCheckParam: (key, v) => st.update('target', (m) => { m.checks[key] = v; }),
    // 반사 소재표 — id = null → 기본값으로(저장 삭제). 계산에는 영향 없음(자동설계 ④ 후보·부품 편집기 상한만)
    // 반사 소재 DB 칸 고침(spec P4 §2.3e) — 사용자 항목은 그대로, 공용 항목은 사용자 사본 "… (수정)" 을 만들어 고침. 부품 반사율은 그대로(다음 편집부터 새 상한)
    onCatalog: (id, key, v) => st.update('session', (_, x) => {
      const db = A.ctx.reflectDb?.(), e = db?.get(id);
      if (!e) { x.status = '반사 소재 DB 없음'; return; }
      try {
        if (e.origin === 'user') db.update(id, reflectPatch(e, key, v));
        else { const c = copyAsUser(e); db.add({ ...c, ...reflectPatch(c, key, v) }); x.status = `공용 소재는 고칠 수 없어 사용자 사본 "${c.name}" 을 만들었습니다`; }
      } catch (err) { x.status = `반사 소재 고침 실패: ${err.message}`; }
    }),
  };
}
const pct1 = (v) => Math.round(v * 1000) / 10;
// 사용자 파일 저장(Blob 링크) — l2-advanced.js download 와 같은 방식
function downloadText(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
// 투과 부품 실측 맞춤 대화상자(spec P4 §2.3e) — 평판 모드 l2-advanced 화면을 그대로 띄움(같은 실측소재 DB).
// 저장되면 실측소재 목록 갱신(Worker 포함) · 이 부품에 그 소재 적용(투명·백색 투과 → Milky) · 닫음
function openFitDialog(i) {
  const ctx = A.ctx, db = ctx.materialDb?.(), table = ctx.l2Table?.();
  if (!db || !table) { setStatus('실측소재 DB·L2 응답표가 아직 준비되지 않았습니다'); return; }
  document.querySelector('.m3-fitdlg')?.remove();
  const name = String(A.store.mspec.parts[i]?.name ?? '').replace(/[<>&"]/g, ''), dlg = document.createElement('div');
  dlg.className = 'zoom-modal m3-fitdlg';
  dlg.innerHTML = `<div class="zoom-modal-inner" role="dialog" aria-modal="true" aria-label="실측 데이터로 소재 추가">
    <div class="zoom-modal-hd"><span>실측 데이터로 소재 추가 · ${name}</span><button data-fit-close>닫기</button></div>
    <div class="m3-fitdlg-body"><div class="mut">측정값을 넣고 [피팅] → [DB 저장] 하면 이 부품에 그 실측 소재가 적용됩니다.</div><div data-fit-adv></div></div></div>`;
  document.body.appendChild(dlg);
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  const close = () => { dlg.remove(); document.removeEventListener('keydown', onKey); };
  document.addEventListener('keydown', onKey);
  dlg.querySelector('[data-fit-close]').onclick = close;
  let saved = null;
  const wdb = Object.create(db);   // add 만 가로채 저장된 id 를 앎
  wdb.add = (e) => { db.add(e); saved = e.id; };
  const host = dlg.querySelector('[data-fit-adv]');
  const actx = {
    table, db: wdb, viewNote: '현재 소재 보기는 평판 모드에서 — 여기서는 측정 → 피팅 → 저장',
    onDbChanged: () => {
      pool?.setDb(ctx.dbLists()); ctx.onMaterialDbChanged?.();
      if (saved) {
        const id = saved; saved = null; close();
        A.store.update('material', (m, x) => {
          const ent = db.get(id);
          let q = partToDbMaterial(m.parts[i], id);
          if (ent) q = setPartMaterialParam(q, 'milky', Math.round(ctx.milkyFromMusR(table, ent.fitted.musR) * 100) / 100);
          m.parts[i] = q; x.status = `실측 소재 "${ent?.name ?? id}" 저장 · ${q.name} 에 적용`;
        });
        return;
      }
      // 삭제·불러오기 — 지워진 소재를 쓰던 부품은 추상 Milky 로
      const gone = A.store.mspec.parts.some((p) => p.material?.dbId && !db.get(p.material.dbId));
      A.store.update(gone ? 'material' : 'session', (m) => { for (const p of m.parts) if (p.material?.dbId && !db.get(p.material.dbId)) p.material = { ...p.material, dbId: '' }; });
      renderAdvanced(host, actx, null);
    },
  };
  renderAdvanced(host, actx, null);
  const add = host.querySelector('details.adv-add'); if (add) add.open = true;
}
// LED STEP 불러오기 (main.js:452-469)
function importLedStep(file) {
  const st = A.store, say = (t) => { if (A?.store === st) st.update('session', (_, x) => { x.ledInfo = t; }); };
  say(`${file.name} 읽는 중…`);
  file.text().then((text) => {
    const w = new Worker(new URL('../../engine/mech3d/mech3d-worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (m) => {
      if (m.data.stage) { say(m.data.stage); return; }
      w.terminate();
      if (m.data.error) { say(`불러오기 실패: ${m.data.error}`); return; }
      if (A?.store !== st) return;
      setLedMesh(file.name, m.data.parts); if (A?.ctx.canSave?.() !== false) saveLedIDB().catch(() => {}); L.resetLedCaches();
      st.update('light', (M, x) => {
        // 같은 이름의 LED STEP 을 다시 불러옴(저장소 비워짐 등) — 저장된 기준 LED·위치 보정·제외·가상 배치로 재인식
        const old = M.light.step;
        if (old?.ref && old.name === file.name) {
          M.light.step = { ...old, leds: [], pcb: -1, emitters: [] };
          try { L.applyStepRecognition(M, x, M.light.step, old.ref); x.ledInfo = `저장된 LED 지정 복원 — ${x.ledInfo}`; x.pick = null; x.node = 'leds'; return; }
          catch (e) { x.status = `저장된 LED 지정으로 인식 실패(${e.message}) — 새로 지정하세요`; }
        }
        M.light.step = { name: file.name, offset: [0, 0, 0], rot: [0, 0, 0], ref: null, leds: [], excluded: [], pcb: -1, emitters: [] };
        x.ledInfo = `부품 ${m.data.parts.length}개 — LED 하나의 발광면을 클릭하세요`; x.pick = 'led'; x.node = 'leds';   // 발광면·제외 클릭 버튼은 LED 노드에
      });
    };
    w.onerror = (e) => { w.terminate(); say(`불러오기 실패: ${e.message ?? e}`); };
    w.postMessage({ text });
  }).catch((e) => say(`불러오기 실패: ${e.message}`));
}
// 명령 막대
function cmdHandlers() {
  return {
    onImport: (f) => A.ctx.onImportMech3d(f),
    onLed: () => A.store.update('session', (m, x) => { const stp = m.light.kind === 'step' && m.light.step; x.node = stp ? 'leds' : 'light'; x.pick = stp && !stp.virtual ? (x.pick === 'led' ? null : 'led') : null; }),
    onObs: () => A.store.update('session', (_, x) => { x.node = 'obs'; x.pick = x.pick === 'obs' ? null : 'obs'; }),
    onSection: () => A.store.update('view', (_, x) => {
      if (x.section) { x.section = null; return; }
      const b = bounds(getMech3d().combined.positions);
      x.section = { axis: 'x', pos: (b[0] + b[3]) / 2, box: b };
    }),
    onFit: () => A.view?.fit(),
    onToggleCalc: () => {   // '⏸ 계산 중'(대기·장면 준비 포함) → 일시정지, 일시정지 → 재개, 그 밖(완료·오류·대기) → 다시 계산
      // 자동설계 중: 계산이 끝났거나 대기였으면(미룬 계산 없음) = 다시 계산 요청, 아니면 일시정지 여부를 뒤집음
      if (A.ad?.running) { const st = A.ad; st.userPaused = st.deferred ? !st.userPaused : false; st.deferred = true; setStatus(st.userPaused ? '자동설계가 끝나도 계산은 멈춰 둠' : '자동설계가 끝나면 계산 재개'); return; }
      const s = A.prog.snapshot().state;
      if (s === 'running' || s === 'pending' || s === 'starting') A.prog.pause(); else if (s === 'paused') A.prog.resume(); else restartCalc();
    },
    onAuto: () => adSetOpen(!adState().open),
    onExit: () => A.ctx.onExit(),
  };
}

// ---- LED 선택·속성(spec §4a) ----
// LED STEP 배치 편집(store.update 안에서) — op: add | align | del(n) | orig. 개별 이동(ledAdjust)은 위치 목록에 녹이고 지움
function ledEdit(m, x, op, n = null) {
  const stp = m.light.kind === 'step' ? m.light.step : null;
  if (!stp) return;
  if (op === 'orig') { stp.virtual = null; m.light.ledAdjust = null; x.ledSel = null; x.status = 'LED 를 STEP 원래 배치로 되돌림'; return; }
  const line = x.line, lay = line ? L.stepLayout(m, line) : null;
  if (!lay || lay.err) { x.status = `LED 배치를 편집할 수 없음: ${lay?.err ?? '관측면(라인)을 먼저 지정하세요'}`; return; }
  let P;
  try { P = positionsFromLayout(lay, stp, line, op === 'del' ? n : null); } catch (e) { x.status = e.message; return; }
  if (op === 'add') { const r = addPosition(P, line); P = r.positions; x.ledSel = r.index; x.node = 'leds'; x.sel = null; x.status = `LED 추가 — ${P.length}개(가장 넓은 빈자리)`; }
  else if (op === 'align') { P = alignPositions(P, line); x.status = `같은 간격으로 정렬 — ${P.length}개`; }
  else if (op === 'del') { if (!P.length) { x.status = '마지막 LED 는 삭제할 수 없음'; return; } x.ledSel = null; x.status = `LED 삭제 — ${P.length}개 남음`; }
  if ((x.pick === 'led' || x.pick === 'ledx')) x.pick = null;   // 편집한 배치에서는 발광면·제외 클릭 안 씀
  stp.virtual = { positions: P }; m.light.ledAdjust = null;
}
// 현재 배치의 LED 목록 — 번호 n: LED STEP(원래·가상) = lay.leds 위치(제외 LED 포함), 직접 배치 = 발광점 순서
// → { lay, em(계산 발광점), list:[{ n, part(배치 부품 번호|null), e(발광점|null), excluded }] }
function ledsNow(M = A.store.mspec, line = A.store.session.line) {
  let em = []; try { em = L.currentEmitters(M, line); } catch { em = []; }
  const lay = M.light.kind === 'step' ? L.stepLayout(M, line) : null;
  if (!lay) return { lay: null, em, list: em.map((e, n) => ({ n, part: null, e, excluded: false })) };
  const ex = new Set(lay.excluded ?? []), byN = new Map(em.map((e) => [e.led, e]));
  return { lay, em, list: lay.leds.map((p, n) => ({ n, part: p, e: byN.get(n) ?? null, excluded: ex.has(p) })) };
}
// 발광점별 커버(관측면 부품)까지 관측 방향 d 거리(못 찾음 = NaN) — (발광점 배열, 기구, 라인, 관측 부품) 별 캐시
function ledGaps(em, M = A.store.mspec) {
  const S = A.store.session, rt = getMech3d();
  if (!S.line || !rt || !em.length) return em.map(() => NaN);
  const op = [...new Set(M.observe.faces.map((f) => f.part))], k = op.join();
  const c = A.gapC;
  if (c && c.em === em && c.rt === rt && c.line === S.line && c.k === k) return c.gaps;
  const d = S.line.frame.d, gaps = em.map((e) => { let g = Infinity; for (const i of op) g = Math.min(g, rayT(rt.parts[i], e.pos, d)); return Number.isFinite(g) ? g : NaN; });
  A.gapC = { em, rt, line: S.line, k, gaps };
  return gaps;
}
const minFinite = (a) => a.reduce((m, v) => (Number.isFinite(v) && !(v >= m) ? v : m), NaN);
// LED 속성 창 정보 — { n, total, s(라인 위치), gap(최소 커버 거리), adj, excluded, clash:[문구] }
function ledUi(LS, n) {
  const M = A.store.mspec, S = A.store.session, it = LS.list[n];
  if (!it) return null;
  let pos = it.e?.pos ?? null;
  if (!pos && it.part != null && LS.lay?.parts[it.part]) { const b = bounds(LS.lay.parts[it.part].positions); pos = [0, 1, 2].map((k) => (b[k] + b[k + 3]) / 2); }
  const s = Number.isFinite(it.e?.s) ? it.e.s : pos && S.line ? S.line.toSW(...S.line.to2D(pos))[0] : NaN;
  const nm = (p) => M.parts[p]?.name ?? `부품 ${p + 1}`;
  const say = { inside: (p) => `발광점이 ${nm(p)} 안에 있음 — 간섭`, overlap: (p) => `LED 몸체가 ${nm(p)}과(와) 겹침 — 간섭`, 'body-inside': (p) => `LED 몸체가 ${nm(p)} 안에 있음 — 간섭` };
  const clash = [...new Set(ledClashItems(A.checks.interference?.items, n, LS.em, LS.lay).filter((x) => say[x.kind]).map((x) => say[x.kind](x.part)))];
  return { n, total: LS.list.length, s, gap: minFinite(ledGaps(LS.em)), adj: validAdjust(M.light)?.[n] ?? { ds: 0, dz: 0 }, excluded: it.excluded, clash };
}
// 커버까지 거리(공통) → 모든 LED 를 관측 방향으로 같은 양 이동(자동설계 ⑤ 와 같은 applyDz: STEP offset·발광점 / 직접 배치 깊이)
function ledDist(g) {
  const st = A.store, M = st.mspec, S = st.session;
  if (!S.line) return;
  if (M.light.kind === 'manual' && M.light.manual.pcb?.kind !== 'depth') return;
  const gap = minFinite(ledGaps(ledsNow().em));
  if (!Number.isFinite(gap)) { setStatus('LED 앞쪽에서 커버(관측면 부품)를 찾지 못함'); return; }
  let dz = gap - g, note = '';
  if (M.light.kind === 'manual') { const dp = M.light.manual.pcb.depth; if (dp - dz < 0.1) { dz = dp - 0.1; note = ' — 관측면 아래 깊이 0.1 mm 까지만'; } }
  if (Math.abs(dz) < 1e-6) return;
  st.update('light', (m, x) => { applyDz(m, dz, S.line.frame.d); x.status = `모든 LED 를 커버 쪽으로 ${dz > 0 ? '+' : ''}${dz.toFixed(2)} mm 옮김${note}`; });
}

// ---- 그리기 ----
function lineInfo() {
  const S = A.store.session, M = A.store.mspec, l = S.line;
  if (l) return `라인: ${{ line: '직선', circle: '원', path: '곡선' }[l.kind]}${l.closed ? '(닫힘)' : ''} · 길이 ${l.length.toFixed(1)}mm · 폭 ${l.width.toFixed(1)}mm${l.branched ? ' · ⚠ 갈래 있음(가장 긴 경로 사용)' : ''}`;
  return M.observe.faces.length && !S.lineErr ? '라인 인식 중…' : '';
}
// 자동 격자 값(표시용 — tally.js 규칙과 같음. w 칸은 최대 국소 폭 대신 라인 폭으로 근사) (main.js:376)
function autoGrid() { const l = A.store.session.line; return l ? { cellS: Math.max(1, l.length / 100), cellW: Math.max(0.5, l.width / 8), winS: Math.max(5, l.length / 10) } : null; }
function renderAll(tag = 'all') {
  const st = A.store, M = st.mspec, S = st.session;
  const LS = ledsNow(); A.ledTotal = LS.list.length;
  if (S.ledSel != null && !(S.ledSel < LS.list.length)) S.ledSel = null;   // 배치가 바뀌어 번호가 없어짐
  renderView();
  const lay = M.light.kind === 'step' ? L.stepLayout(M, S.line) : undefined;   // LED STEP 실제 배치(가상 실패 표시용)
  renderFeatureTree($('#m3-tree'), M, S, {
    onNode: (id) => st.update('session', (_, x) => { x.node = id; x.sel = id.startsWith('part:') ? { part: +id.slice(5), face: null } : null; if (id !== 'leds') x.ledSel = null; }),
    onEye: (id, only) => st.update('view', (m, x) => Object.assign(x, toggleVisibility(id, only, m.parts.length, x.hidden, x.hideLeds))),
  }, lay);
  const pi = S.node?.startsWith('part:') ? +S.node.slice(5) : -1, clr = pi >= 0 ? clearanceOf(pi) : null;
  if (clr !== A.clrShown) { A.clrShown = clr; renderMarkers(); }
  if (tag !== 'view') renderPropertyPanel($('#m3-props'), M, S, { dbList: A.ctx.materialDb()?.list() ?? [], catalog: reflCat(), auto: autoGrid(), dir: M.observe.dir ?? S.line?.frame.d, lineInfo: lineInfo(), clearance: clr, xfInfo: pi >= 0 ? xformInfoOf(pi) : null, meshInfo: pi >= 0 ? partMeshInfo(pi) : null, xfMsg: S.xfMsg?.part === pi ? S.xfMsg.text : '', lay: lay ?? null, led: S.node === 'leds' && S.ledSel != null ? ledUi(LS, S.ledSel) : null, ledTotal: LS.list.length }, propHandlers());
  if (tag === 'session' || tag === 'all') renderMarkers();
  A.cmd.update(S, S.calc);
  renderStatus();
  renderAuto();
}
function renderStatus() {
  const S = A.store.session, M = A.store.mspec;
  const lt = S.ledSel != null && A.ledTotal ? `LED ${S.ledSel + 1}/${A.ledTotal}` : '';
  renderStatusBar($('#m3-status'), { calc: S.calc, targetNoise: M.observe.targetNoise ?? 0.02, checks: A.checks, focus: S.focusCheck, text: lt && S.status ? `${lt} · ${S.status}` : lt || S.status }, {
    onCheck: (id) => A.store.update('session', (_, s) => { s.focusCheck = s.focusCheck === id ? null : id; }),
  });
}
// 3D 뷰 (main.js:336-373 의 뷰 부분) + 보기 버튼 · 단면 조절
function renderView() {
  const v = A.view, cur = getMech3d();
  if (!v || !cur) return;
  const M = A.store.mspec, S = A.store.session, stp = M.light.kind === 'step' ? M.light.step : null;
  const pv = adPreview();   // 자동설계 비교 중 = 최적안 미리보기(형상 메쉬·LED 위치)
  const lay = stp ? L.stepLayout(pv?.M ?? M, S.line) : null, lp = lay?.parts ?? null;   // 원래/가상 배치(캐시 객체) — 미리보기면 최적안 배치(몸체 = 화살표)
  const ledSet = new Set(lay?.leds ?? []), exSet = new Set(lay?.excluded ?? []);   // 제외된 LED 는 회색(불투명) — 발광 화살표도 빠짐
  const kinds = [...M.parts.map((p) => p.material.kind), ...(lp ?? []).map((_, i) => (i === lay.pcb ? 'pcb' : ledSet.has(i) && !exSet.has(i) ? 'led' : 'opaque'))];
  const meshKey = [pv ?? cur, lp];   // 기구·LED 메쉬(위치 보정 포함 — 캐시 객체)가 바뀌면 다시 그림. 카메라는 기구가 바뀔 때만 맞춤
  if (!A.meshShown || A.meshShown.some((x, i) => x !== meshKey[i])) {
    const keepCamera = !!A.meshShown && A.meshShown[0].raw === cur.raw;   // 크기·위치 조절만 바뀌면 카메라 유지
    if (A.meshShown?.[0].raw !== cur.raw) { S.hidden = []; S.hideLeds = false; }   // 다른 기구를 불러오면 보기 상태 초기화
    A.meshShown = meshKey; v.setParts([...(pv ?? cur).parts, ...(lp ?? [])], kinds, { keepCamera });
  } else v.setKinds(kinds);
  const hid = new Set(S.hidden), nMech = M.parts.length;
  v.setHidden((i) => (i < nMech ? hid.has(i) : S.hideLeds));
  const LS = ledsNow(pv?.M ?? M, S.line), body = !pv && S.ledSel != null ? LS.list[S.ledSel]?.part ?? null : null;
  v.setSelection(S.sel ?? (body != null && lp?.[body] ? { part: cur.parts.length + body, face: null } : null));   // 선택 LED 몸체 = 부품 선택처럼 강조
  const sp = (pv?.M ?? M).light.spec, half = sp.model === 'gaussian' ? sp.beam / 2 : 60, gaps = ledGaps(LS.em, pv?.M ?? M);
  const cones = LS.em.map((e, i) => ({ pos: e.pos, axis: e.axis, half, len: Number.isFinite(gaps[i]) ? Math.min(4, 0.4 * gaps[i]) : 4, n: e.led ?? i }));
  let line3d = null;
  if (S.line && S.node === 'obs') {   // 인식한 라인 중심선 — 관측면 노드를 골랐을 때만(평소엔 결과 색을 가림)
    const out = [], K = 200;
    for (let k = 0; k <= K; k++) { const s = (k / K) * S.line.length, [x, y] = S.line.fromSW(S.line.closed && k === K ? 0 : s, 0); out.push(...S.line.to3D(x, y, 0.3)); }
    line3d = Float32Array.from(out);
  }
  v.setOverlay({ obsFaces: M.observe.faces, line3d, cones, coneSel: pv ? null : S.ledSel });
  // 선택 모드: LED 발광면/제외 → LED STEP 부품만 클릭되고 기구물은 투시, 관측면·PCB 면 → 기구 부품만 클릭
  const nM = cur.parts.length, led = S.pick === 'led' || S.pick === 'ledx', mech = S.pick === 'obs' || S.pick === 'pcb';
  v.setPickMode(led ? (i) => i >= nM : mech ? (i) => i < nM : null, led ? (i) => i < nM : null);
  if (v.viewName() !== S.view) v.setView(S.view);
  $('#m3-views').querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));
  v.setSection(S.section);
  renderSectionCtl();
}
function renderSectionCtl() {
  const el = $('#m3-section'), sec = A.store.session.section;
  el.hidden = !sec;
  if (!sec) return;
  const b = sec.box, k = 'xyz'.indexOf(sec.axis), lo = b[k], hi = b[k + 3];
  el.innerHTML = `단면 <select data-s="axis">${['x', 'y', 'z'].map((a) => `<option ${a === sec.axis ? 'selected' : ''}>${a}</option>`).join('')}</select>
    <input type="range" min="${lo}" max="${hi}" step="${(hi - lo) / 200 || 0.1}" value="${sec.pos}" data-s="pos"> <b>${sec.pos.toFixed(1)}</b> mm`;
  el.querySelector('[data-s="axis"]').onchange = (e) => A.store.update('view', (_, s) => { const a = e.target.value, kk = 'xyz'.indexOf(a); s.section = { ...s.section, axis: a, pos: (b[kk] + b[kk + 3]) / 2 }; });
  el.querySelector('[data-s="pos"]').oninput = (e) => {   // 끄는 중에는 store 알림 없이 평면만(다시 그리면 슬라이더가 끊김)
    const s = A.store.session; s.section = { ...s.section, pos: +e.target.value };
    A.view.setSection(s.section); el.querySelector('b').textContent = s.section.pos.toFixed(1);
  };
}
