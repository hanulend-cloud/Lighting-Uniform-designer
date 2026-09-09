// UI 배선 + 실시간 재계산 — 프로젝트.md §3 출력6
import { DEFAULT_SPEC, LEVEL_DEFAULTS } from './model/defaults.js';
import { buildGeometry, combinedEffect, activeLevels, effectiveEdgeMargin } from './model/geometry.js';
import { computeField, evalGrid } from './engine/directLit.js';
import { metrics } from './engine/uniformity.js';
import { solveCombo, solvePerLevel, GRID } from './engine/solver.js';
import { PAD } from './ui/canvas-util.js';
import { drawSection } from './ui/section.js';
import { drawIso } from './ui/iso.js';
import { drawPlan } from './ui/plan.js';
import { drawHeatmap } from './ui/heatmap.js';
import { buildLevels, updateLevels, renderVerdict, drawProfiles } from './ui/analysis.js';
import { exportStep } from './export/step-ui.js';

const LS_KEY = 'uds.spec.v9';

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
  ] },
  { name: '목표', items: [
    ['goal.U0', '균일도', '', 0.30, 0.98, 0.01],
  ] },
  { name: '기구', items: [
    ['levels.1.thk', '몸체두께', 'mm', 0.5, 20, 0.5],
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
  // 재해석되어 실제(예: 1행) 배치와 다른 여러 행이 그려지는 버그가 됨) — Y 전체 길이를 넣어 1행을 강제.
  const pitchY = combo.pitchY ?? spec.target.yLen;
  const eff = combinedEffect(spec, depth, active);
  const common = {
    depth, pitchX, pitchY, blurMmX: eff.blurX, blurMmY: eff.blurY, transmit: eff.transmit,
    decenterX: eff.decenterX, decenterY: eff.decenterY, edgeBoost: eff.edgeBoost,
    padX: combo.padX, padY: combo.padY,
  };

  // solveCombo 와 완전히 동일한 격자 → 표시 균일도 = 판정 균일도
  const eg = evalGrid(spec, GRID);
  const resEval = computeField(spec, { ...common, nx: eg.nx, ny: eg.ny });
  const edgeMargin = effectiveEdgeMargin(spec.goal.edgeMargin ?? 0.05, eff.edgeBoost);
  const m = metrics(resEval.field, resEval.nx, resEval.ny, edgeMargin);
  m.U0 = combo.U0;                    // 판정값과 완전 일치 보장
  resEval.metrics = m;
  resEval.edgeMargin = edgeMargin;    // 히트맵이 실제 판정 마진과 동일하게 표시하도록 전달

  const geom = buildGeometry(spec, {
    depth, ledPitch: pitchX, ledPitchY: pitchY, active,
    decenterX: eff.decenterX, decenterY: eff.decenterY,
    padX: combo.padX, padY: combo.padY,
  });
  const pxmm = sizeVisuals(geom.view.x1 - geom.view.x0);
  resEval.view = geom.view;
  drawSection($('#section'), geom, pxmm);
  drawIso($('#iso'), geom);
  drawPlan($('#plan'), geom);
  drawSection($('#section-mini'), geom, sizeVisuals(geom.view.x1 - geom.view.x0, '#section-mini'));
  drawProfiles($('#anprofile'), resEval, spec.goal.U0);

  const solo = [2, 3, 4, 5].map((l) => soloRow(l));
  updateLevels($('#levels'), solo, activeSet, spec.goal.U0, onApplyAuto);
  renderVerdict($('#verdict'), combo, tags, spec.goal);

  last = { common, m, depth, view: geom.view, edgeMargin };
  last.combo = combo; last.geom = geom; last.active = active;
  if (autoHeat) renderHeat();
  else $('#pane-heat').classList.add('stale');

  $('#timing').textContent =
    `연산 ${(performance.now() - t0).toFixed(0)} ms · 목표 균일도 ${(spec.goal.U0 * 100).toFixed(0)}% · 깊이 ${depth}mm`;
}

// 조도 히트맵 렌더 (고해상, 정사각 셀 → LED 프로파일 X/Y 대칭) — 버튼 / 자동
function renderHeat() {
  if (!last) return;
  const res = computeField(spec, { ...last.common, nx: 220 });  // ny 미지정 → 정사각 셀
  res.metrics = last.m;
  res.edgeMargin = last.edgeMargin;
  res.view = last.view;
  drawHeatmap($('#heatmap'), res, sizeVisuals(last.view.x1 - last.view.x0));
  $('#pane-heat').classList.remove('stale');
}

// 공유 X 스케일(px/mm) — 단면도·히트맵·평면도가 같은 스케일을 쓰도록 정렬.
// 세 패널 모두 각 행에서 2분할된 동일 폭이므로 #pane-section 폭을 기준으로 삼는다.
// (기구 사양 카드의 작은 TOP·SIDE 축소판은 자기 폭 기준으로 별도 계산.)
function sizeVisuals(worldW, ref = '#pane-section') {
  const w = $(ref).clientWidth || 300;
  return (w - PAD.L - PAD.R) / (worldW || spec.target.xLen);
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
  // opt.pitchMin은 UI로 편집하지 않는 내부 보조 하한값 — 구버전 저장값(예: 6mm 고정)이
  // LED 크기 기반 최소 피치를 덮어쓰지 않도록 항상 현재 기본값으로 갱신
  s.opt = { ...DEFAULT_SPEC.opt, ...(s.opt || {}), pitchMin: DEFAULT_SPEC.opt.pitchMin };
  s.goal = { ...DEFAULT_SPEC.goal, ...(s.goal || {}) };
}

// ---- 시작 ----
spec = load() || structuredClone(DEFAULT_SPEC);
migrate(spec);
mount();
window.addEventListener('resize', schedule);
schedule();
// 레이아웃이 안정된 뒤 한 번 더 그리고 히트맵 초기 1회 렌더
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); run(); renderHeat(); }));
}
