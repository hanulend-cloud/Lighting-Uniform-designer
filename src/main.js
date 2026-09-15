// UI 배선 + 실시간 재계산 — 프로젝트.md §3 출력6
import { DEFAULT_SPEC, LEVEL_DEFAULTS } from './model/defaults.js';
import { buildGeometry, combinedEffect, activeLevels, effectiveEdgeMargin } from './model/geometry.js';
import { computeField, computeCameraLuminance, evalGrid } from './engine/directLit.js';
import { metrics, centerZoneFrac } from './engine/uniformity.js';
import { solveCombo, solvePerLevel, GRID } from './engine/solver.js';
import { PAD } from './ui/canvas-util.js';
import { drawSection } from './ui/section.js';
import { drawIso } from './ui/iso.js';
import { drawPlan } from './ui/plan.js';
import { drawHeatmap } from './ui/heatmap.js';
import { buildLevels, updateLevels, renderVerdict, drawProfiles } from './ui/analysis.js';
import { exportStep } from './export/step-ui.js';

const LS_KEY = 'uds.spec.v11';

// 좌측: 가장 기본적인 설계 조건만 — 그룹(타겟/LED/목표)으로 묶어 표시
// [path, label, unit, min, max, step]
const CONTROL_GROUPS = [
  { name: '타겟', items: [
    ['target.xLen', 'X', 'mm', 1, 2000, 1],
    ['target.yLen', 'Y', 'mm', 1, 2000, 1],
    ['space.depth', '깊이', 'mm', 3, 150, 1],
  ] },
  { name: 'LED', items: [
    ['led.sizeX', '크기X', 'mm', 0.2, 30, 0.1],
    ['led.sizeY', '크기Y', 'mm', 0.2, 30, 0.1],
    ['led.beamX', '지향각X', '°', 10, 180, 5],
    ['led.beamY', '지향각Y', '°', 10, 180, 5],
    ['led.fluxLm', '광속(0=상대값)', 'lm', 0, 500, 1],
  ] },
  { name: '목표', items: [
    ['goal.U0', '균일도', '', 0.30, 0.98, 0.01],
    ['goal.centerArea', '중심부 면적비', '', 0.50, 1.00, 0.01],
    ['goal.edgeMargin', '판정제외 마진', '', 0, 0.30, 0.01],
  ] },
  { name: '기구', items: [
    ['levels.1.thk', '몸체두께', 'mm', 0.5, 20, 0.5],
    ['opt.maxOverhang', '최대 오버행(비율)', '', 0, 0.5, 0.01],
    ['body.n', '몸체 굴절률(측벽반사)', '', 1.0, 1.9, 0.01],
  ] },
];

let spec = null;
let timer;
const $ = (s) => document.querySelector(s);

const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
function set(o, p, v) {
  const ks = p.split('.'); const last = ks.pop();
  ks.reduce((x, k) => (x[k] ??= {}, x[k]), o)[last] = v;
}

// ---- 좌측 폼 (타겟/LED/목표 그룹) ----
function buildForm() {
  const form = $('#controls');
  form.innerHTML = '';
  for (const { name, items } of CONTROL_GROUPS) {
    const grp = document.createElement('div'); grp.className = 'ctl-group';
    const gl = document.createElement('span'); gl.className = 'grp-label'; gl.textContent = name;
    grp.appendChild(gl);
    for (const [path, label, unit, min, max, step] of items) {
      const row = document.createElement('label'); row.className = 'ctl';
      row.title = `범위 ${min}~${max}${unit ? unit : ''}`;
      const span = document.createElement('span'); span.textContent = label;
      const input = document.createElement('input');
      input.type = 'number'; input.min = min; input.max = max; input.step = step;
      input.value = get(spec, path) ?? '';
      input.dataset.path = path;
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (Number.isNaN(v)) return;
        set(spec, path, v); schedule();
      });
      row.appendChild(span);
      if (unit) { const u = document.createElement('i'); u.textContent = unit; row.appendChild(u); }
      row.appendChild(input);
      grp.appendChild(row);
    }
    form.appendChild(grp);
  }
  $('#btn-reset').onclick = () => { spec = structuredClone(DEFAULT_SPEC); soloCache = {}; mount(); schedule(); };
  $('#btn-step').onclick = () => {
    if (!last) return;
    exportStep(spec, last.combo, last.geom, last.active);
  };
  $('#btn-export').onclick = exportJson;
  $('#file-import').onchange = importJson;
}

function onLevelParam(level, field, value) {
  spec.levels[level][field] = value;
  schedule();
}
function onToggleLevel(level, checked) {
  spec.levels[level].on = checked;
  schedule();
}

// ---- 단독 행 캐시 (해당 레벨/공통 조건 미변경 시 재사용) ----
let soloCache = {};
function soloRow(level) {
  const sig = JSON.stringify([
    spec.goal.U0, spec.target.xLen, spec.target.yLen, spec.space.depth,
    spec.led.beamX, spec.led.beamY, spec.led.sizeX, spec.led.sizeY, spec.body, spec.levels[level],
  ]);
  if (soloCache[level]?.sig === sig) return soloCache[level].r;
  const r = solvePerLevel(spec, { levels: [level] })[0];
  soloCache[level] = { sig, r };
  return r;
}

// '적용' — 그 레벨의 자동탐색 참고값을 실제 슬라이더(spec.levels)에 복사
function onApplyAuto(level, params) {
  spec.levels[level] = { ...spec.levels[level], ...params };
  buildLevels($('#levels'), spec, onToggleLevel, onLevelParam);
  schedule();
}

// ---- 재계산 ----
let autoHeat = false;  // 판정 격자를 정확도 우선(1.5mm)으로 낮춰 연산이 느려져 수동 렌더로 되돌림
let last = null;   // { spec 상태 파생값 } — 조도 렌더링 버튼용

function schedule() {
  clearTimeout(timer);
  $('#timing').textContent = '계산 대기 중…';
  timer = setTimeout(runAsync, 220);
}

// 판정 격자가 정확도 우선(1.5mm)이라 run() 이 수 초 걸릴 수 있다 — run() 자체는 동기라 그 사이
// 브라우저가 완전히 멈춘 것처럼 보이므로, 먼저 '계산 중' 을 그리고 페인트를 기다린 뒤 시작한다.
function runAsync() {
  $('#timing').textContent = '계산 중… (해상도 우선 설정이라 수 초 소요될 수 있음)';
  requestAnimationFrame(() => requestAnimationFrame(run));
}

function run() {
  persist();
  const t0 = performance.now();

  const active = activeLevels(spec);
  const activeSet = new Set(active);
  const tags = active.map((l) => `L${l}`);

  const combo = solveCombo(spec, active);
  const depth = combo.depth;
  const pitchX = combo.pitchX;
  // pitchY == null → 1행(1D)이 최적이라는 뜻. combo.pitchX로 대체하면 안 됨(엉뚱한 촘촘한 Y 피치로
  // 재해석되어 실제(예: 1행) 배치와 다른 여러 행이 그려지는 버그가 됨). anchoredAxis()는
  // pitch ≥ 2·usable 일 때만 1행을 낸다(usable = Y − LED크기, 대략) — target.yLen을 그대로 넣으면
  // LED 크기가 타겟 대비 작을수록(흔한 경우) 이 조건을 못 만족해 여전히 2행이 그려지는 버그가
  // 있었다(실측: 100×10mm, LED 1mm → usable 9mm, 2·usable=18 > yLen 10 → 조건 미충족).
  // Infinity는 항상 조건을 만족시켜 타겟 크기와 무관하게 1행을 확실히 강제한다.
  const pitchY = combo.pitchY ?? Infinity;
  const eff = combinedEffect(spec, depth, active);
  const common = {
    depth, pitchX, pitchY, blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
    decenterX: eff.decenterX, decenterY: eff.decenterY, edgeBoost: eff.edgeBoost,
    padX: combo.padX, padY: combo.padY,
  };

  // solveCombo 와 완전히 동일한 격자 → 표시 균일도 = 판정 균일도
  const eg = evalGrid(spec, GRID);
  const resEval = computeField(spec, { ...common, nx: eg.nx, ny: eg.ny });
  const edgeMargin = effectiveEdgeMargin(spec.goal.edgeMargin ?? 0, eff.edgeBoost);
  const m = metrics(resEval.field, resEval.nx, resEval.ny, edgeMargin);
  m.U0 = combo.U0;                    // 판정값과 완전 일치 보장
  resEval.metrics = m;
  resEval.edgeMargin = edgeMargin;    // 히트맵이 실제 판정 마진과 동일하게 표시하도록 전달
  // 중심부(경계에서 od 안쪽) — 1차 판정 영역. 히트맵에 영역·수치를 표시하도록 전달
  const cz = centerZoneFrac(spec.goal.centerArea ?? 0.95);
  const center = { fx: Math.max(cz.fx, edgeMargin), fy: Math.max(cz.fy, edgeMargin), areaFrac: spec.goal.centerArea ?? 0.95,
    U0c: combo.U0c, centerBright: combo.centerBright, fullPass: combo.fullPass };
  resEval.center = center;

  const geomFixture = { x: spec.target.xLen + 2 * Math.max(0, combo.padX ?? 0), y: spec.target.yLen + 2 * Math.max(0, combo.padY ?? 0) };
  resEval.fixture = geomFixture;      // 오버행이 있으면 LED가 타겟 밖까지 나가므로, 히트맵에도
                                       // "타겟보다 큰 기구 영역"을 점선으로 표시해 LED가 빨간
                                       // 타겟 경계 밖에 보이는 게 정상임을 알 수 있게 함.

  const geom = buildGeometry(spec, {
    depth, ledPitch: pitchX, ledPitchY: pitchY, active,
    decenterX: eff.decenterX, decenterY: eff.decenterY,
    padX: combo.padX, padY: combo.padY,
  });
  resEval.view = geom.view;
  drawIso($('#iso'), geom);
  drawPlan($('#plan'), geom);
  drawSection($('#section-mini'), geom, sizeVisuals(geom.view.x1 - geom.view.x0, '#section-mini'));
  drawProfiles($('#anprofile'), resEval, spec.goal.U0);

  const solo = [2, 3, 4, 5].map((l) => soloRow(l));
  updateLevels($('#levels'), solo, activeSet, spec.goal.U0, onApplyAuto);
  renderVerdict($('#verdict'), combo, tags, spec.goal);

  last = { common, m, depth, view: geom.view, edgeMargin, fixture: geomFixture, center };
  last.combo = combo; last.geom = geom; last.active = active; last.resEval = resEval;
  if (autoHeat) renderHeat();
  else $('#pane-heat').classList.add('stale');

  $('#timing').textContent =
    `연산 ${(performance.now() - t0).toFixed(0)} ms · 목표 균일도 ${(spec.goal.U0 * 100).toFixed(0)}% · 깊이 ${depth}mm`;
}

// 조도 히트맵 렌더 — 버튼 / 자동. 격자는 X·Y 정사각 셀이며 셀 크기는 최대 0.5mm(타겟이 작아
// 기존 220 분할 셀이 0.5mm 보다 작으면 그 더 작은 셀 유지). 총 셀 수는 HEAT_MAX_CELLS 로 캡
// (예: 2000×2000mm 타겟을 0.5mm 로 그리면 1600만 셀 → 브라우저가 멈춤).
const HEAT_CELL_MAX_MM = 0.5;
const HEAT_MAX_CELLS = 1.5e6;
function heatGrid(spec) {
  const X = spec.target.xLen, Y = spec.target.yLen;
  let cell = Math.min(HEAT_CELL_MAX_MM, X / 219);
  cell = Math.max(cell, Math.sqrt((X * Y) / HEAT_MAX_CELLS));
  return { nx: Math.max(2, Math.round(X / cell) + 1), ny: Math.max(2, Math.round(Y / cell) + 1), cell };
}
let lastHeat = null;   // 최종 렌더링된(res.field가 화면에 실제 쓰인) 결과 — 팝업 확대 시 재계산 없이 재사용
// 히트맵 단위. 'rel'/'lux'는 조도장(computeField) 그대로(숫자만 환산) — 색 패턴 불변(상수배).
// 'cdm2'(휘도)는 시야각(코원앵글)·시차를 반영한 별도 렌더링(computeCameraLuminance)이라 그림
// 자체가 달라진다. fluxLm=0(상대 모드)이면 lux/cd·m² 실단위가 무의미해 heatmap.js가 자동으로
// 상대값(%)으로 되돌린다(색은 cdm2 선택 시 여전히 시야각 렌더링을 쓴다 — 그게 이 모드의 핵심).
let heatUnit = 'rel';
let heatViewDist = 300, heatEyeSep = 100;   // 육안 시야각 렌더링(휘도) 파라미터 — 거리·눈간격(mm)
function heatOpt() { return { unit: heatUnit, fluxLm: spec.led.fluxLm ?? 0 }; }
function updateHeatTitle() {
  const label = { rel: '조도 히트맵', lux: '조도 히트맵 (lux)', cdm2: '휘도 히트맵 (육안 시야각, cd/m²)' }[heatUnit];
  const el = $('#heat-title');
  if (el) el.textContent = label;
  const eyeCtl = $('#heat-eye-ctl');
  if (eyeCtl) eyeCtl.hidden = heatUnit !== 'cdm2';
}
function renderHeat() {
  if (!last) return;
  const hg = heatGrid(spec);
  const res = computeField(spec, { ...last.common, nx: hg.nx, ny: hg.ny });
  res.metrics = last.m;
  res.edgeMargin = last.edgeMargin;
  res.view = last.view;
  res.fixture = last.fixture;
  res.center = last.center;
  res.cellMm = hg.cell;
  if (heatUnit === 'cdm2') {
    // 판정 수치(균일도%·중심부 등)는 조도 기준 그대로 두고, 화면에 그릴 필드·격자만 시야각
    // 렌더링으로 바꿔치기한다 — "실제 판정"과 "육안으로 어떻게 보이는가"를 분리해서 보여준다.
    const cam = computeCameraLuminance(spec, {
      ...last.common, nx: hg.nx, ny: hg.ny, viewDistanceMm: heatViewDist, eyeSpacingMm: heatEyeSep,
    });
    res.field = cam.field; res.nx = cam.nx; res.ny = cam.ny; res.extent = cam.extent;
  }
  lastHeat = res;
  drawHeatmap($('#heatmap'), res, sizeVisuals(last.view.x1 - last.view.x0, '#pane-heat'), heatOpt());
  $('#pane-heat').classList.remove('stale');
}

// X 스케일(px/mm) — 지정한 pane(ref)의 실제 폭 기준으로 계산 (호출부마다 자기 폭을 넘김).
function sizeVisuals(worldW, ref) {
  const w = $(ref).clientWidth || 300;
  return (w - PAD.L - PAD.R) / (worldW || spec.target.xLen);
}

// ---- 그래프 팝업 확대 ----
// 각 pane의 실제 canvas를 모달로 옮겨 그 canvas 자신의(커진) 크기로 다시 그린다 — 별도
// 복제본이 아니라 동일 엘리먼트를 재사용하므로, 닫을 때 원래 위치로 되돌리기만 하면 된다.
const ZOOM_PANES = [
  { pane: '#pane-iso', canvas: '#iso', title: '3D 입체도', kind: 'iso' },
  { pane: '#pane-heat', canvas: '#heatmap', title: '조도 히트맵', kind: 'heat' },
  { pane: '#pane-prof', canvas: '#anprofile', title: 'X·Y축 조도 프로파일', kind: 'profile' },
  { pane: '#pane-plan', canvas: '#plan', title: 'TOP VIEW · 평면 배치', kind: 'plan' },
  { pane: '#pane-section-mini', canvas: '#section-mini', title: 'SIDE VIEW · 단면 형상', kind: 'sectionMini' },
];
let zoomState = null; // { canvas, originalParent, originalNext, kind }

function redrawZoomKind(kind, canvas) {
  if (!last) return;
  const worldW = last.view.x1 - last.view.x0;
  switch (kind) {
    case 'sectionMini':
      drawSection(canvas, last.geom, sizeVisuals(worldW, refFor(canvas)));
      break;
    case 'iso': drawIso(canvas, last.geom); break;
    case 'plan': drawPlan(canvas, last.geom); break;
    case 'profile': if (last.resEval) drawProfiles(canvas, last.resEval, spec.goal.U0); break;
    case 'heat': if (lastHeat) drawHeatmap(canvas, lastHeat, 1e9, heatOpt()); break;
  }
}
// sizeVisuals는 컨테이너의 clientWidth를 읽으므로, canvas의 현재 부모(원래 pane 또는
// 확대 중이면 #zoom-slot)를 그대로 ref로 써서 어느 쪽이든 자기 크기에 맞게 그려지게 한다.
function refFor(canvas) { return '#' + canvas.parentElement.id; }

function openZoom(cfg) {
  const canvas = $(cfg.canvas);
  const modal = $('#zoom-modal');
  const slot = $('#zoom-slot');
  zoomState = { canvas, originalParent: canvas.parentNode, originalNext: canvas.nextSibling, kind: cfg.kind };
  $('#zoom-title').textContent = cfg.title;
  slot.appendChild(canvas);
  modal.hidden = false;
  // 레이아웃이 안정된 뒤(모달 크기 확정 후) 새 크기로 다시 그린다
  requestAnimationFrame(() => requestAnimationFrame(() => redrawZoomKind(cfg.kind, canvas)));
}

function closeZoom() {
  if (!zoomState) return;
  const { canvas, originalParent, originalNext, kind } = zoomState;
  originalParent.insertBefore(canvas, originalNext);
  $('#zoom-modal').hidden = true;
  zoomState = null;
  requestAnimationFrame(() => requestAnimationFrame(() => redrawZoomKind(kind, canvas)));
}

function setupZoom() {
  for (const cfg of ZOOM_PANES) {
    const pane = $(cfg.pane);
    if (!pane || pane.querySelector('.pane-zoom-btn')) continue;
    const btn = document.createElement('button');
    btn.className = 'pane-zoom-btn'; btn.title = '확대'; btn.textContent = '⤢';
    btn.addEventListener('click', (e) => { e.stopPropagation(); openZoom(cfg); });
    // 제목줄(pane-title)이 있으면 그 줄의 컨트롤 옆에, 없으면(단면·아이소) 우상단 오버레이로
    const ctl = pane.querySelector('.heat-ctl');
    const title = pane.querySelector('.pane-title');
    if (ctl) ctl.appendChild(btn);
    else if (title) title.appendChild(btn);
    else { btn.classList.add('overlay'); pane.appendChild(btn); }
  }
  $('#zoom-close').addEventListener('click', closeZoom);
  $('#zoom-modal').addEventListener('click', (e) => { if (e.target.id === 'zoom-modal') closeZoom(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && zoomState) closeZoom(); });
  window.addEventListener('resize', () => { if (zoomState) redrawZoomKind(zoomState.kind, zoomState.canvas); });
}

// ---- 저장/불러오기 ----
function persist() { try { localStorage.setItem(LS_KEY, JSON.stringify(spec)); } catch {} }
function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function exportJson() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }));
  a.download = 'uds-spec.json'; a.click(); URL.revokeObjectURL(a.href);
}
function importJson(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { spec = JSON.parse(r.result); migrate(spec); mount(); schedule(); } catch { alert('JSON 파싱 실패'); } };
  r.readAsText(f);
}

function mount() {
  buildForm();
  buildLevels($('#levels'), spec, onToggleLevel, onLevelParam);
  $('#heat-render').onclick = renderHeat;
  const auto = $('#heat-auto');
  auto.checked = autoHeat;
  auto.onchange = () => { autoHeat = auto.checked; if (autoHeat) renderHeat(); };
  const unitSel = $('#heat-unit');
  unitSel.value = heatUnit;
  unitSel.onchange = () => {
    heatUnit = unitSel.value;
    updateHeatTitle();
    // rel/lux는 조도장 그대로라 캐시(lastHeat)를 새 단위로 다시 그리기만 하면 된다. cdm2(휘도,
    // 시야각 렌더링)는 완전히 다른 필드가 필요해 재계산해야 한다.
    if (heatUnit === 'cdm2') renderHeat();
    else if (lastHeat) drawHeatmap($('#heatmap'), lastHeat, sizeVisuals(last.view.x1 - last.view.x0, '#pane-heat'), heatOpt());
  };
  const viewDistInput = $('#heat-viewdist'), eyeSepInput = $('#heat-eyesep');
  viewDistInput.value = heatViewDist; eyeSepInput.value = heatEyeSep;
  const onEyeParamChange = () => {
    heatViewDist = Math.max(30, parseFloat(viewDistInput.value) || 300);
    heatEyeSep = Math.max(0, parseFloat(eyeSepInput.value) || 0);
    if (heatUnit === 'cdm2') renderHeat();
  };
  viewDistInput.oninput = onEyeParamChange;
  eyeSepInput.oninput = onEyeParamChange;
  updateHeatTitle();
}

// 구버전 저장값 보정
function migrate(s) {
  s.levels ??= {};
  for (const l of [1, 2, 3, 4, 5]) {
    const cur = s.levels[l] || {};
    const def = LEVEL_DEFAULTS[l];
    s.levels[l] = Object.fromEntries(Object.keys(def).map((k) => [k, k in cur ? cur[k] : def[k]]));
  }
  s.levels[1].on = true;   // L1(몸체두께)은 필수 입력바 항목 — 더 이상 개별 토글이 없다
  s.preview ??= structuredClone(DEFAULT_SPEC.preview);
  if (s.preview.level == null) s.preview.level = 3;
  s.body ??= structuredClone(DEFAULT_SPEC.body);
  // ver<10 저장값은 판정제외 마진 5% 를 품고 있어 새 기본(0 = 타겟 전체 판정)을 덮어쓴다 —
  // 마진과 오버행 설정을 버리고 현재 기본값으로 시작한다. ver 10 에서 사용자가 직접 넣은 값은 유지.
  if (!(s.ver >= 10)) {
    if (s.opt) { delete s.opt.maxOverhang; delete s.opt.maxOverhangMm; }
    if (s.goal) delete s.goal.edgeMargin;
  }
  s.ver = DEFAULT_SPEC.ver;
  // opt.pitchMin은 UI로 편집하지 않는 내부 보조 하한값 — 구버전 저장값(예: 6mm 고정)이
  // LED 크기 기반 최소 피치를 덮어쓰지 않도록 항상 현재 기본값으로 갱신
  s.opt = { ...DEFAULT_SPEC.opt, ...(s.opt || {}), pitchMin: DEFAULT_SPEC.opt.pitchMin };
  s.goal = { ...DEFAULT_SPEC.goal, ...(s.goal || {}) };
}

// ---- 시작 ----
spec = load() || structuredClone(DEFAULT_SPEC);
migrate(spec);
mount();
setupZoom();
window.addEventListener('resize', schedule);
schedule();
// 레이아웃이 안정된 뒤 한 번 더 그리고 히트맵 초기 1회 렌더
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); run(); renderHeat(); }));
}
