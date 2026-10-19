// 3D 기구 모드 화면(CAD식) — spec 2026-10-15 m3-cad-ui §2·§3.
// main.js 는 mount(ctx) / unmount() / setStatus(t) / flush() / isMounted() 만 부른다.
// 저장 상태 = ctx.mspec(spec.mech3d), 세션 상태 = store.session. 흐름: store.update(tag) → onChange(tag)
//   observe → 관측 라인 다시 인식 · 물리 태그 → 점진 계산 재시작 · 기하 점검 태그 → 점검 ①②③ · target → 판정만 다시. 모두 다시 그림.
// 점진 계산 갱신(1초마다)은 store 알림 없이 결과 패널·상태 띠·색지도만 다시 그린다(입력 중 속성 패널이 다시 그려지지 않게).
import { getMech3d, getLedMesh, setLedMesh, saveLedIDB, applyPartMods, redetectContacts } from '../../engine/mech3d/runtime.js';
import { setPartMaterial, setPartMaterialParam, setPartFinish } from '../../engine/mech3d/materials.js';
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
import { partClearance, limitXform, axisLimits, TOL } from '../../engine/mech3d/clearance.js';
import { renderPropertyPanel } from './property-panel.js';
import { createResultsPanel } from './results-panel.js';
import { renderStatusBar } from './status-bar.js';
import { createAdRunner } from './autodesign-run.js';
import { renderAutoPanel, stageAvailability } from './autodesign-panel.js';
import { runAutoDesign } from '../../engine/mech3d/autodesign.js';
import { milkyRows } from '../../engine/mech3d/milky-search.js';
import { candidatePositions } from '../../engine/mech3d/basis.js';
import { ledAtS } from '../../engine/mech3d/placement.js';
import { frameHeights, deformPart, refineForBumps, minThickness, shapeCandidates } from '../../engine/mech3d/shape-opt.js';
import { interferenceKeys } from '../../engine/mech3d/clearance.js';
import { scaleMoveMesh, isIdentityXform } from '../../engine/mech3d/xform.js';
import { defaultChecks } from '../../engine/mech3d/defs.js';

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
globalThis.__m3 = () => A;   // 브라우저 점검용: __m3().prog.snapshot(), __m3().timing, __m3().checks

function getView() {
  viewP ??= import('../mech3d-view.js').then(({ createMech3dView }) => {
    const v = createMech3dView($('#mech3d-canvas'), { onPick: (s) => { if (A) onPick(s); }, gizmo: $('#m3-axes') });
    const el = $('#m3-views');
    el.innerHTML = VIEWS.map(([k, t]) => `<button data-view="${k}">${t}</button>`).join('');
    el.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { v.setView(b.dataset.view); A?.store.update('view', (_, s) => { s.view = b.dataset.view; }); }; });
    return v;
  });
  return viewP;
}

// ---- 마운트 ----
export async function mount(ctx) {
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
  a.ad?.runner?.cancel();
  a.prog.dispose(); a.unsub(); a.store.dispose();   // 풀은 유지(진행 중 청크는 ≤0.5초 — 끝나면 버려짐)
  window.removeEventListener('keydown', a.keydown);
  if (a.view) { a.view.setObsSurface(null); a.view.setCheckMarkers([]); a.view.setSection(null); }
  $('#m3-legend').hidden = true;
}

// ---- 변경 처리 ----
function onChange(tag) {
  if (!A) return;
  const M = A.store.mspec;
  if (tag === 'observe' || tag === 'material') refreshLine();   // material: 부품 크기·위치가 바뀌면 라인도 다시(키가 같으면 건너뜀)
  if (PHYSICS.has(tag)) restartCalc();
  if (tag === 'target') A.prog.setJudge({ obs: M.observe, targetNoise: M.observe.targetNoise ?? 0.02, fluxLm: M.light.spec.fluxLm ?? 0 });
  if (GEOM_CHECK.has(tag)) rerunGeomChecks();
  renderAll(tag);
}
function onKey(e) {
  if (!A || e.target.closest?.('input, select, textarea')) return;
  if (e.key === 'Escape') A.store.update('session', (_, s) => { s.sel = null; s.pick = null; s.focusCheck = null; });
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
export function jobFor(M, mechParts, { emitters = null } = {}) {
  const S = A.store.session;
  if (!S.line) return null;
  const em = emitters ?? L.currentEmitters(M, S.line);
  if (!em.length) return null;
  const obs = tallyObs(M.observe, M.observe.dir ?? S.line.frame.d), G = geometry(obs);
  const ledParts = M.light.kind === 'step' && getLedMesh() ? L.rawParts(getLedMesh().parts) : null;
  return {
    sceneKey: `s${++sceneSeq}`, G, obs, nLeds: em.length, fluxLm: M.light.spec.fluxLm ?? 0,
    scene: { mechParts: L.rawParts(mechParts), mspec: JSON.parse(JSON.stringify(M)), ledParts, lineData: lightData(S.line), G, obs, emitters: em },
  };
}
function makeJob() { return A ? jobFor(A.store.mspec, getMech3d().parts) : null; }
function restartCalc() { A.timing = { start: 0, first: null, noise5: null }; A.prog.restart(makeJob); }
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
  const pcb = M.light.kind === 'step' ? M.light.step?.pcb ?? -1 : -1, exclude = pcb >= 0 ? [rt.parts.length + pcb] : [];
  Object.assign(A.checks, runGeomChecks({ rt, mspec: M, emitters, bodies: L.ledBodies(M), obsParts: new Set(M.observe.faces.map((f) => f.part)), beam: M.light.spec.beam, exclude }));
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
    if (it.dist != null) out.push({ type: 'line', a: it.pos, b: it.pos.map((v, k) => v + it.axis[k] * it.dist), color: col });
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
function hitName(M, key) {
  const [k, j] = [key[0], +key.slice(2)];
  if (k === 'p') return M.parts[j]?.name ?? `부품 ${j + 1}`;
  if (k === 'l') return j === M.light.step?.pcb ? 'PCB' : `LED ${j + 1}`;
  return `LED ${j + 1} 발광점`;
}
// 선택 부품의 크기·위치 가능 범위(캐시: 장면·부품·LED 가 같으면 재사용) — 표시·입력 제한용으로 여유 TOL 을 뺀다
function xformInfoOf(i) {
  const M = A.store.mspec, S = A.store.session, rt = getMech3d();
  if (!rt?.raw?.parts[i]) return null;
  const stp = M.light.kind === 'step', lp = (stp && L.ledPartsNow(M)) || [];
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
  const lp = (M.light.kind === 'step' && L.ledPartsNow(M)) || [];
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
function adState() { return (A.ad ??= { open: false, sel: { milky: true, leds: false, shape: false, shapePart: -1, milkyMax: null }, running: null, result: null, undo: null, milkyPart: null, runner: null, info: null }); }
function adInfo() {   // 부품별 비 2.5D 비율(관측 방향) — 라인이 있을 때만. (기구·라인) 별 캐시(높이맵 계산이 무거움)
  const st = adState(), S = A.store.session, rt = getMech3d();
  if (!st.info || st.info.rt !== rt || st.info.line !== S.line) st.info = { rt, line: S.line, non25: S.line && rt ? rt.parts.map((p) => frameHeights(p, S.line.frame, 0.5).non25) : [] };
  return st.info;
}
const adMilkyPart = (M, avail) => (avail.milky.ok ? (avail.milky.parts.find((i) => M.observe.faces.some((f) => f.part === i)) ?? avail.milky.parts[0]) : null);
function renderAuto() {
  const el = $('#m3-auto'), st = adState();
  el.hidden = !st.open;
  if (!st.open) return;
  const M = A.store.mspec, avail = stageAvailability(M, adInfo());
  if (st.sel.shapePart < 0 && avail.shape.ok) st.sel.shapePart = avail.shape.parts[0];
  const mp = adMilkyPart(M, avail), sel = { ...st.sel, milkyMax: st.sel.milkyMax ?? Math.max(mp != null ? M.parts[mp].material.milky : 0, 5) };
  renderAutoPanel(el, { avail, sel, running: st.running, result: st.result, names: M.parts.map((p) => p.name), canRevert: !!st.undo }, {
    onSel: (k, v) => { st.sel[k] = v; renderAuto(); },
    onAction: (k) => ({ run: adRun, stop: () => st.runner?.cancel(), close: () => { st.open = false; renderAuto(); }, apply: adApply, cancel: adCancel, revert: adRevert, step: adStep })[k]?.(),
  });
}
// 형상 원본 = 원본 메쉬 + 크기·위치 조절(이미 적용된 shapeMod 는 빼고 — 적용 때 shapeMod 를 바꿔 끼우므로 평가와 같게)
function adBaseMesh(i) {
  const rt = getMech3d(), raw = (rt.raw ?? rt).parts[i], xf = A.store.mspec.parts[i].xform;
  if (isIdentityXform(xf)) return raw;
  const b = bounds(raw.positions);
  return scaleMoveMesh(raw, xf, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
}
// 설계 → (mspec 복사본, 기구 메쉬) — 형상은 후보 메쉬로 바꾼 부품 포함
function designScene(d) {
  const M = JSON.parse(JSON.stringify(A.store.mspec)), S = A.store.session, rt = getMech3d(), mp = adState().milkyPart;
  if (mp != null && d.milky != null) M.parts[mp] = setPartMaterialParam(M.parts[mp], 'milky', d.milky);
  if (M.light.kind === 'manual' && d.count != null) { M.light.manual.count = d.count; M.light.manual.pitch = d.pitch; }
  let parts = rt.parts;
  if (d.shape) {
    const i = d.shape.part, mod = shapeModFor(d.shape, M), base = adBaseMesh(i);
    const mesh = deformPart(refineForBumps(base, mod.frame, mod.centers, mod.R, Math.max(0.1, mod.R / 8)), mod.frame, frameHeights(base, mod.frame, mod.cell), mod);
    parts = rt.parts.map((p, j) => (j === i ? mesh : p)); M.parts[i].shapeMod = mod;
  }
  return { M, parts, S };
}
// LED 중심 = 그 설계(M: ② 가 바꾼 개수·피치 반영)의 발광점을 관측 평면에 투영
function shapeModFor({ dt, h, R }, M = A.store.mspec) {
  const S = A.store.session, F = S.line.frame, em = L.currentEmitters(M, S.line);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { frame: { u: F.u, v: F.v, d: F.d }, dt, h, R, centers: em.map((e) => [dot(e.pos, F.u), dot(e.pos, F.v)]), cell: 0.5 };
}
const adJob = (M, parts, o) => { const j = jobFor(M, parts, o); if (!j) throw new Error('LED 가 없음'); return j; };
const adEff = (r) => { let t = 0; for (const b of r.batches) for (const v of b) t += v; return t / r.ledger.emitted; };
async function adRun() {
  const a = A, st = adState(), M = A.store.mspec, S = A.store.session;
  if (!S.line || st.running) return;
  const avail = stageAvailability(M, adInfo()), stages = { milky: st.sel.milky && avail.milky.ok, leds: st.sel.leds && avail.leds.ok, shape: st.sel.shape && avail.shape.ok };
  st.milkyPart = adMilkyPart(M, avail);
  const R = (st.runner = createAdRunner({ ports: A.pool.ports() }));
  A.prog.pause();   // 같은 Worker 를 쓰므로 점진 계산은 멈춤(끝나면 장면을 다시 보냄)
  st.running = { frac: 0, text: '준비' }; st.result = null; A.meshShown = null; renderView(); renderAuto();
  const cur = { milky: st.milkyPart != null ? M.parts[st.milkyPart].material.milky : null, count: M.light.manual?.count ?? 0, pitch: M.light.manual?.pitch ?? 0, shape: null };
  const obs = tallyObs(M.observe, M.observe.dir ?? S.line.frame.d), G = geometry(obs), sp = st.sel.shapePart;
  const minWall = { ...defaultChecks(), ...(M.checks ?? {}) }.minWall;
  const io = {
    progress: (stage, frac, text) => { if (A !== a) return; st.running = { frac, text }; renderAuto(); },
    cancelled: () => R.stopped,
    async milkyRows(d, ms) {   // 재가중 기준 = 창 가운데
      const { M: Md, parts } = designScene({ ...d, milky: ms[Math.floor(ms.length / 2)] });
      const r = await R.trace(adJob(Md, parts), { N: 1500000, rw: { part: st.milkyPart, milkies: ms } });   // ≈5초(15 Worker)
      return milkyRows(G, obs, { milkies: ms, batches: r.rwBatches, ess: r.ess, emitted: r.ledger.emitted });
    },
    async basis(d) {   // ① 이 켜져 있으면 실행기가 d.milky = 상한으로 넘김
      const { M: Md, parts } = designScene(d);
      const cand = candidatePositions(S.line, 1), sets = cand.map((s) => [ledAtS(S.line, s, Md.light.manual, getMech3d())]);
      const r = await R.traceEach(adJob(Md, parts, { emitters: sets[0] }), sets, { N: 20000 });
      return { cand, maps: r.maps, emitted: r.emitted };
    },
    async evalShapes(d, cands, N) {
      const out = [], base = adBaseMesh(sp), H = frameHeights(base, S.line.frame, 0.5);
      const others = getMech3d().parts.map((p, j) => (j === sp ? null : p)), lp = (M.light.kind === 'step' && L.ledPartsNow(M)) || [];
      const before = interferenceKeys(base, others, lp, []);
      for (const c of cands) {
        if (R.stopped) break;
        const { M: Md, parts } = designScene({ ...d, shape: { part: sp, ...c } }), mod = Md.parts[sp].shapeMod;
        const thin = minThickness(H, mod) < minWall;
        const clash = !thin && [...interferenceKeys(parts[sp], others, lp, []).keys()].some((k) => !before.has(k));
        if (thin || clash) { out.push({ cand: c, ok: false, why: thin ? '살두께' : '간섭' }); continue; }
        const r = await R.trace(adJob(Md, parts), { N, batches: 4 }), stt = tallyStats(G, r.batches, obs);
        out.push({ cand: c, ok: !stt.empty, stats: stt, eff: adEff(r) });
      }
      return out;
    },
    async verify(d) {   // 정밀 재판정: 고정 200만 광자(잡음 ≈ ±2%, 점진 계산 목표와 같은 수준)
      const { M: Md, parts } = designScene(d);
      const r = await R.trace(adJob(Md, parts), { N: 2000000, batches: 10 });
      return { stats: tallyStats(G, r.batches, obs), eff: adEff(r) };
    },
  };
  const H0 = stages.shape ? frameHeights(adBaseMesh(sp), S.line.frame, 0.5) : null;
  const pitchNow = cur.count > 1 ? (cur.pitch > 0 ? cur.pitch : S.line.length / cur.count) : S.line.length;
  let res = null;
  try {
    res = await runAutoDesign({
      stages, obs, G, line: S.line, current: cur, milkyMax: st.sel.milkyMax ?? Math.max(cur.milky ?? 0, 5), nMax: Math.max(1, Math.min(60, Math.floor(S.line.length / 2))), pitchRange: null,
      shapePart: sp, shapeCands: stages.shape ? shapeCandidates({ t0: H0.t0, pitch: pitchNow, hasCenters: true }) : [],
    }, io);
  } catch (e) { if (A === a && !R.stopped) setStatus(`자동설계 실패: ${e.message}`); }
  if (A !== a) return;   // 그사이 이탈
  st.running = null; st.runner = null;
  if (res && !res.cancelled) {
    const C = A.store.session.calc;
    st.result = { design: res.best, feasible: res.feasible, reason: res.reason, shape: res.best.shape ?? null,
      cur: { ...cur, Ulen: C?.stats?.Ulen, Uwid: C?.stats?.Uwid, eff: C?.photometry?.eff ?? NaN },
      best: { ...res.best, Ulen: res.verified.stats.Ulen, Uwid: res.verified.stats.Uwid, eff: res.verified.eff } };
  }
  // Worker 에 자동설계 장면이 올라가 있음 — 진행 중이던(일시정지된) 계산은 다시 시작(사용자 일시정지는 유지), 끝난 계산은 그대로
  if (A.prog.snapshot().state === 'paused' || A.prog.snapshot().state === 'running') restartCalc();
  A.meshShown = null; renderView(); renderAuto();
}
// 비교 중 3D 미리보기 — 결과마다 한 번 만들어 둠(meshKey 비교용 객체)
function adPreview() {
  const r = A.ad?.result;
  if (!r) return null;
  if (!r.preview) { const { M, parts } = designScene(r.design); r.preview = { M, parts, raw: getMech3d().raw }; }
  return r.preview;
}
function adCancel() { const st = adState(); st.result = null; A.meshShown = null; renderView(); renderAuto(); }
function adApply() {
  const st = adState(), d = st.result?.design;
  if (!d) return;
  const M = A.store.mspec, mod = d.shape ? adPreview().M.parts[d.shape.part].shapeMod : null;
  st.undo = { milky: st.milkyPart != null ? [st.milkyPart, M.parts[st.milkyPart].material.milky] : null, manual: M.light.kind === 'manual' ? { ...M.light.manual } : null, shape: d.shape ? [d.shape.part, M.parts[d.shape.part].shapeMod ?? null] : null };
  st.result = null; A.meshShown = null;
  if (st.milkyPart != null && d.milky != null) A.store.update('material', (m) => { m.parts[st.milkyPart] = setPartMaterialParam(m.parts[st.milkyPart], 'milky', d.milky); });
  if (M.light.kind === 'manual') A.store.update('light', (m) => { m.light.manual.count = d.count; m.light.manual.pitch = d.pitch; });
  if (mod) A.store.update('material', (m) => { m.parts[d.shape.part].shapeMod = mod; applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  renderAuto();
}
function adRevert() {
  const st = adState(), u = st.undo;
  if (!u) return;
  st.undo = null; A.meshShown = null;
  if (u.milky) A.store.update('material', (m) => { m.parts[u.milky[0]] = setPartMaterialParam(m.parts[u.milky[0]], 'milky', u.milky[1]); });
  if (u.manual) A.store.update('light', (m) => { Object.assign(m.light.manual, u.manual); });
  if (u.shape) A.store.update('material', (m) => { if (u.shape[1]) m.parts[u.shape[0]].shapeMod = u.shape[1]; else delete m.parts[u.shape[0]].shapeMod; applyPartMods(m.parts); m.contacts = redetectContacts(m.contacts); });
  renderAuto();
}
function adStep() {
  const d = adState().result?.design;
  if (!d?.shape) return;
  const { parts, M } = adPreview(), mesh = parts[d.shape.part], name = M.parts[d.shape.part].name;
  const w = new Worker(new URL('../../export/mesh-step-worker.js', import.meta.url), { type: 'module' });
  setStatus('STEP 생성 중…');
  w.onmessage = (ev) => {
    if (ev.data.type === 'done') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ev.data.stepText], { type: 'application/step' })); a.download = `${name}-p4.stp`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); setStatus('STEP 내보내기 완료'); }
    else setStatus(`STEP 실패: ${ev.data.message}`);
    w.terminate();
  };
  w.onerror = (e) => { setStatus(`STEP 실패: ${e.message ?? e}`); w.terminate(); };
  w.postMessage({ mesh: { positions: mesh.positions, triangles: mesh.triangles }, name });
}

// ---- 3D 클릭 (main.js:393-425) — 기구 부품 수(nMech) 이상인 번호는 LED STEP 부품 ----
function onPick(s) {
  const st = A.store, M = st.mspec, S = st.session, nMech = getMech3d().parts.length, pick = S.pick;
  const say = (t) => st.update('session', (_, x) => { x.status = t; });
  if (s && s.part == null && pick !== 'led' && pick !== 'ledx') s = null;   // 선택 모드 빈 곳 클릭(광선만) — LED 모드에서만 씀
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
  st.update('session', (_, x) => { x.sel = s && s.part < nMech ? s : null; if (x.sel) x.node = `part:${x.sel.part}`; });   // LED STEP 부품은 소재 편집 대상이 아님
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
    onFinish: (i, face, f) => part(i, (p) => setPartFinish(p, face, f)),
    // 크기·위치 조절: 장면을 바꾸고 접촉면을 다시 찾는다(같은 면 쌍은 모드 유지). xf = null → 원래대로
    // 새 간섭이 생기면 간섭 직전까지만 적용(limitXform). 직접 배치 LED 는 라인을 따라 다시 놓이므로 고정 LED(STEP)만 장애물
    onXform: (i, want, note = '') => st.update('material', (m, x) => {
      let xf = want;
      x.xfMsg = note ? { part: i, text: note } : null;
      if (xf) {
        const rt = getMech3d(), stp = m.light.kind === 'step';
        let em = []; try { em = stp ? L.currentEmitters(m, x.line) : []; } catch { em = []; }
        const r = limitXform(rt.raw.parts[i], m.parts[i].xform ?? null, xf, rt.parts.map((p, j) => (j === i ? null : p)), { ledParts: (stp && L.ledPartsNow(m)) || [], emitters: em });
        if (r.limited) { xf = r.xf; x.xfMsg = { part: i, text: `${hitName(m, r.hit)}과(와) 간섭 — 간섭 직전(입력의 ${Math.round(r.t * 100)}%)까지만 적용` }; }
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
    onManual: (key, v) => st.update('light', (m, x) => {
      const Lm = m.light.manual;
      if (key === 'pcbKind') { Lm.pcb = v === 'depth' ? { kind: 'depth', depth: 10 } : { kind: 'face' }; if (x.pick === 'pcb') x.pick = null; }
      else if (key === 'depth') Lm.pcb.depth = v;
      else Lm[key] = key === 'count' ? Math.max(1, Math.round(v)) : v;
    }),
    onSolder: (v) => st.update('light', (m) => { m.light.solder = v; }),
    onLedSpec: (key, v) => st.update(key === 'fluxLm' ? 'target' : 'light', (m) => { m.light.spec[key] = v; }),   // 광속은 휘도 환산만 — 재계산 없음
    onObs: (key, v) => st.update('observe', (m) => { m.observe[key] = v; }),
    onClearObs: () => st.update('observe', (m) => { m.observe.faces = []; }),
    onObsDir: (v) => st.update('observe', (m) => { m.observe.dir = v ? (() => { const l = Math.hypot(...v); return v.map((x) => x / l); })() : null; }),
    onRetryLine: () => { A.lineKey = ''; refreshLine(); },
    onTarget: (key, v) => st.update('target', (m) => { m.observe[key] = v; }),
    onCheckParam: (key, v) => st.update('target', (m) => { m.checks[key] = v; }),
  };
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
      setLedMesh(file.name, m.data.parts); saveLedIDB().catch(() => {}); L.resetLedCaches();
      st.update('light', (M, x) => {
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
    onLed: () => A.store.update('session', (m, x) => { const stp = m.light.kind === 'step' && m.light.step; x.node = stp ? 'leds' : 'light'; x.pick = stp ? (x.pick === 'led' ? null : 'led') : null; }),
    onObs: () => A.store.update('session', (_, x) => { x.node = 'obs'; x.pick = x.pick === 'obs' ? null : 'obs'; }),
    onSection: () => A.store.update('view', (_, x) => {
      if (x.section) { x.section = null; return; }
      const b = bounds(getMech3d().combined.positions);
      x.section = { axis: 'x', pos: (b[0] + b[3]) / 2, box: b };
    }),
    onFit: () => A.view?.fit(),
    onToggleCalc: () => {   // '⏸ 계산 중'(대기·장면 준비 포함) → 일시정지, 일시정지 → 재개, 그 밖(완료·오류·대기) → 다시 계산
      const s = A.prog.snapshot().state;
      if (s === 'running' || s === 'pending' || s === 'starting') A.prog.pause(); else if (s === 'paused') A.prog.resume(); else restartCalc();
    },
    onAuto: () => { const st = adState(); st.open = !st.open; renderAuto(); },
    onExit: () => A.ctx.onExit(),
  };
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
  renderView();
  renderFeatureTree($('#m3-tree'), M, S, {
    onNode: (id) => st.update('session', (_, x) => { x.node = id; x.sel = id.startsWith('part:') ? { part: +id.slice(5), face: null } : null; }),
    onEye: (id, only) => st.update('view', (m, x) => Object.assign(x, toggleVisibility(id, only, m.parts.length, x.hidden, x.hideLeds))),
  });
  const pi = S.node?.startsWith('part:') ? +S.node.slice(5) : -1, clr = pi >= 0 ? clearanceOf(pi) : null;
  if (clr !== A.clrShown) { A.clrShown = clr; renderMarkers(); }
  if (tag !== 'view') renderPropertyPanel($('#m3-props'), M, S, { dbList: A.ctx.materialDb()?.list() ?? [], auto: autoGrid(), dir: M.observe.dir ?? S.line?.frame.d, lineInfo: lineInfo(), clearance: clr, xfInfo: pi >= 0 ? xformInfoOf(pi) : null, xfMsg: S.xfMsg?.part === pi ? S.xfMsg.text : '' }, propHandlers());
  if (tag === 'session' || tag === 'all') renderMarkers();
  A.cmd.update(S, S.calc);
  renderStatus();
  renderAuto();
}
function renderStatus() {
  const S = A.store.session, M = A.store.mspec;
  renderStatusBar($('#m3-status'), { calc: S.calc, targetNoise: M.observe.targetNoise ?? 0.02, checks: A.checks, focus: S.focusCheck, text: S.status }, {
    onCheck: (id) => A.store.update('session', (_, s) => { s.focusCheck = s.focusCheck === id ? null : id; }),
  });
}
// 3D 뷰 (main.js:336-373 의 뷰 부분) + 보기 버튼 · 단면 조절
function renderView() {
  const v = A.view, cur = getMech3d();
  if (!v || !cur) return;
  const M = A.store.mspec, S = A.store.session, stp = M.light.kind === 'step' ? M.light.step : null;
  const lp = stp ? L.ledPartsNow(M) : null, ledSet = new Set(stp?.leds ?? []), exSet = new Set(stp?.excluded ?? []);   // 제외된 LED 는 회색(불투명) — 발광 화살표도 빠짐
  const kinds = [...M.parts.map((p) => p.material.kind), ...(lp ?? []).map((_, i) => (i === stp.pcb ? 'pcb' : ledSet.has(i) && !exSet.has(i) ? 'led' : 'opaque'))];
  const pv = adPreview();   // 자동설계 비교 중 = 최적안 미리보기(형상 메쉬·LED 위치)
  const meshKey = [pv ?? cur, lp];   // 기구·LED 메쉬(위치 보정 포함 — 캐시 객체)가 바뀌면 다시 그림. 카메라는 기구가 바뀔 때만 맞춤
  if (!A.meshShown || A.meshShown.some((x, i) => x !== meshKey[i])) {
    const keepCamera = !!A.meshShown && A.meshShown[0].raw === cur.raw;   // 크기·위치 조절만 바뀌면 카메라 유지
    if (A.meshShown?.[0].raw !== cur.raw) { S.hidden = []; S.hideLeds = false; }   // 다른 기구를 불러오면 보기 상태 초기화
    A.meshShown = meshKey; v.setParts([...(pv ?? cur).parts, ...(lp ?? [])], kinds, { keepCamera });
  } else v.setKinds(kinds);
  const hid = new Set(S.hidden), nMech = M.parts.length;
  v.setHidden((i) => (i < nMech ? hid.has(i) : S.hideLeds));
  v.setSelection(S.sel);
  let arrows = [];
  try { arrows = L.currentEmitters(pv?.M ?? M, S.line).map((e) => ({ pos: e.pos, axis: e.axis })); } catch { arrows = []; }
  let line3d = null;
  if (S.line && S.node === 'obs') {   // 인식한 라인 중심선 — 관측면 노드를 골랐을 때만(평소엔 결과 색을 가림)
    const out = [], K = 200;
    for (let k = 0; k <= K; k++) { const s = (k / K) * S.line.length, [x, y] = S.line.fromSW(S.line.closed && k === K ? 0 : s, 0); out.push(...S.line.to3D(x, y, 0.3)); }
    line3d = Float32Array.from(out);
  }
  v.setOverlay({ obsFaces: M.observe.faces, line3d, arrows });
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
