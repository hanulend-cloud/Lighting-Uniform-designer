// L2 "상세 property" 고급메뉴 — spec 2026-10-07 §6.4. 기본 화면은 Milky 만, 연결된 물성·BSDF·DB 는 여기서만.
//  · 보기: 현재 소재 물성, 예상 투과 각분포(+실측 겹침), 검증(V6·V9), 가까운 DB 소재
//  · DB: 목록/삭제(사용자 항목), 추가 입력(측정 → 피팅 → 저장), JSON 내보내기·불러오기, 예상 프로파일 CSV
import { predictSample, fitMaterial, parseAngleCsv, measuredShape } from '../engine/l2/fit.js';
import { N_ANG, angEdgeDeg } from '../engine/l2/mc-slab.js';
import { milkyOf, nearestByMilky, newId, STATUS } from '../model/materials-db.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const num = (v, d = 3) => (!Number.isFinite(v) ? '∞' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(d));

// 고정 골격(한 번만) + 동적 영역 갱신. 입력 중인 추가 폼이 재계산마다 지워지지 않도록 폼은 골격에 둔다.
export function renderAdvanced(el, ctx, desc) {
  if (el.dataset.built !== '1') build(el, ctx);
  el._ctx = ctx; el._desc = desc;
  renderView(el.querySelector('[data-adv-view]'), ctx, desc);
  renderDbList(el.querySelector('[data-adv-db]'), ctx);
}

function build(el, ctx) {
  el.dataset.built = '1';
  el.innerHTML = `
    <div data-adv-view></div>
    <h4>실측소재 DB</h4>
    <div data-adv-db></div>
    <div class="adv-btns">
      <button data-act="export">DB 내보내기(JSON)</button>
      <label class="adv-file">DB 불러오기<input type="file" accept=".json" data-act="import" hidden></label>
      <button data-act="profile">예상 각분포 CSV</button>
    </div>
    <details class="adv-add"><summary>소재 추가 입력 (측정 → 피팅 → 저장)</summary>
      <div class="adv-grid">
        <label>이름<input data-k="name" placeholder="예: 사내 확산 PC A"></label>
        <label>제조사<input data-k="vendor"></label>
        <label>굴절률 n<input data-k="n" type="number" step="0.01" value="1.586"></label>
        <label>상태<select data-k="status"><option value="measured">실측</option><option value="datasheet">데이터시트</option></select></label>
      </div>
      <table class="adv-samples"><thead><tr><th>두께 mm</th><th>전투과 T %</th><th>전반사 R %</th><th>Haze %</th><th>HPA °</th><th>투과 각분포 CSV</th><th>곡선 종류</th></tr></thead>
        <tbody>${[0, 1].map((i) => `<tr data-row="${i}">
          <td><input data-s="t" type="number" step="0.1" ${i === 0 ? 'value="2"' : ''}></td><td><input data-s="T" type="number" step="0.1"></td>
          <td><input data-s="R" type="number" step="0.1"></td><td><input data-s="haze" type="number" step="0.1"></td>
          <td><input data-s="hpa" type="number" step="0.5"></td><td><input data-s="curve" type="file" accept=".csv,.txt"></td>
          <td><select data-s="curveType"><option value="intensity">광도 I(θ)</option><option value="btdf">BTDF(θ)</option></select></td></tr>`).join('')}</tbody></table>
      <div class="mut">법선 입사 측정. 곡선 CSV = 각도(°), 값 두 열(크기 무관 — 모양만 사용, 0~75° 이상). 두께 2종이면 교차두께 검증(V9)까지 수행.</div>
      <div class="adv-btns"><button data-act="fit">피팅</button><button data-act="save" disabled>DB 저장</button></div>
      <div data-adv-fit></div>
    </details>`;
  el.addEventListener('click', (ev) => onClick(el, ev));
  el.querySelector('[data-act="import"]').addEventListener('change', (ev) => onImport(el, ev));
}

function renderView(v, ctx, desc) {
  if (!desc || desc.error) { v.innerHTML = '<div class="mut">L2 solver 없음</div>'; return; }
  const { info } = desc, { db } = ctx, table = desc.table ?? ctx.table;   // Mie 소재는 소재별 합성 응답표
  const mat = { musR: info.musR, g: info.g, mua: info.mua, n: info.n };
  const p = predictSample(table, mat, info.t);
  const ent = info.material ? db.get(info.material.id) : null;
  const near = !ent ? nearestByMilky(table, db.list(), info.milky) : null;
  const val = ent?.validation ?? {};
  v.innerHTML = `
    <table class="adv-props">
      <tr><th>소재</th><td>${ent ? `${esc(ent.name)} <span class="mut">(${STATUS[ent.status]}${ent.vendor ? ' · ' + esc(ent.vendor) : ''})</span>` : '추상 Milky (g=0.9 가정)'}</td></tr>
      <tr><th>Milky</th><td><b>${info.milky.toFixed(2)}</b> <span class="mut">— μs′ 에서 파생, 두께 무관</span></td></tr>
      <tr><th>산란계수 μs / μs′</th><td>${num(info.mus)} / ${num(info.musR)} mm⁻¹</td></tr>
      <tr><th>비대칭 g · 흡수 μa · n</th><td>${info.g.toFixed(3)} · ${num(info.mua, 2)} mm⁻¹ · ${info.n}</td></tr>
      <tr><th>현재 두께 ${info.t.toFixed(1)} mm</th><td>τ′ ${num(info.tauR)} · 판 단독 T ${pct(p.T)} / R ${pct(p.R)} · Haze ${pct(p.haze)} · HPA ${p.hpa.toFixed(0)}°</td></tr>
      <tr><th>시스템(캐비티 포함)</th><td>투과율 ${pct(info.trans)} · 측벽 반사 ${info.rW.toFixed(2)} · 기판 ${info.rhoB}</td></tr>
      ${ent ? `<tr><th>소재 검증</th><td>${badge(val.V6)} ${badge(val.V9)}${(ent.notes ?? []).map((n) => `<div class="mut">· ${esc(n)}</div>`).join('')}</td></tr>`
    : near ? `<tr><th>가까운 실측소재</th><td>${esc(near.entry.name)} (Milky ${near.milky.toFixed(2)}, 차 ${near.diff.toFixed(2)})</td></tr>` : ''}
    </table>
    <canvas class="adv-chart" width="420" height="150"></canvas>
    <div class="mut">투과 광도 각분포(정면 1 기준) — 실선: 현재 두께 예측${ent?.samples?.some((s) => s.curve) ? ' · 점: 실측, 점선: 그 두께의 예측' : ''}</div>`;
  drawChart(v.querySelector('canvas'), table, mat, info.t, ent);
}

const badge = (c) => (c ? `<span class="l2-badge ${c.ok ? 'ok' : 'ng'}" title="${esc(`${c.limit}\n${c.note}`)}">${c.id} ${c.ok ? '✅' : '❌'}</span>` : '');

function curveOf(table, mat, t) {
  const p = predictSample(table, mat, t), pts = [];
  for (let k = 1; k < N_ANG; k++) pts.push([(angEdgeDeg(k) + angEdgeDeg(k + 1)) / 2, p.I[k]]);
  const m = Math.max(...pts.filter(([a]) => a >= 2).map(([, v]) => v));
  return pts.map(([a, v]) => [a, m > 0 ? Math.min(1.2, v / m) : 0]);
}

function drawChart(cv, table, mat, t, ent) {
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, L = 30, B = 18;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#c9cfdb'; ctx.fillStyle = '#6b7487'; ctx.font = '10px sans-serif';
  for (const a of [0, 30, 60, 90]) { const x = L + (a / 90) * (W - L - 6); ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H - B); ctx.stroke(); ctx.fillText(`${a}°`, x - 8, H - 5); }
  for (const y of [0, 0.5, 1]) { const py = H - B - y * (H - B - 8); ctx.fillText(y.toFixed(1), 4, py + 3); }
  const X = (a) => L + (a / 90) * (W - L - 6), Y = (v) => H - B - v * (H - B - 8);
  const line = (pts, color, dash) => { ctx.strokeStyle = color; ctx.setLineDash(dash); ctx.beginPath(); pts.forEach(([a, v], i) => (i ? ctx.lineTo(X(a), Y(v)) : ctx.moveTo(X(a), Y(v)))); ctx.stroke(); ctx.setLineDash([]); };
  line(curveOf(table, mat, t), '#2f6fd6', []);
  for (const s of ent?.samples ?? []) {
    if (!s.curve?.length) continue;
    line(curveOf(table, mat, s.t), '#c96a26', [4, 3]);
    const val = (p) => (s.curveType === 'btdf' ? p.v * Math.cos((p.theta * Math.PI) / 180) : p.v);
    const ref = Math.max(...s.curve.filter((p) => p.theta >= 2).map(val));
    ctx.fillStyle = '#c96a26';
    for (const p of s.curve) ctx.fillRect(X(p.theta) - 1.5, Y(Math.min(1.2, val(p) / ref)) - 1.5, 3, 3);
  }
}

function renderDbList(d, ctx) {
  const { table, db } = ctx;
  const rows = db.list().map((e) => `<tr><td>${esc(e.name)}</td><td>${STATUS[e.status]}</td><td>${milkyOf(table, e).toFixed(2)}</td>
    <td>${num(e.fitted.musR)}</td><td>${e.fitted.g.toFixed(3)}</td><td>${badge(e.validation?.V6)} ${badge(e.validation?.V9)}</td>
    <td>${e.origin === 'user' ? `<button data-act="del" data-id="${esc(e.id)}">삭제</button>` : '<span class="mut">공용</span>'}</td></tr>`).join('');
  d.innerHTML = `<table class="adv-db"><thead><tr><th>소재</th><th>상태</th><th>Milky</th><th>μs′ mm⁻¹</th><th>g</th><th>검증</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="mut">없음</td></tr>'}</tbody></table>`;
}

async function readFile(inp) { const f = inp.files?.[0]; return f ? f.text() : null; }

async function collectEntry(el) {
  const q = (k) => el.querySelector(`.adv-grid [data-k="${k}"]`).value.trim();
  const samples = [];
  for (const tr of el.querySelectorAll('.adv-samples tbody tr')) {
    const g = (k) => tr.querySelector(`[data-s="${k}"]`);
    const t = parseFloat(g('t').value);
    if (!(t > 0)) continue;
    const s = { t };
    for (const k of ['T', 'R', 'haze']) { const v = parseFloat(g(k).value); if (Number.isFinite(v)) s[k] = v / 100; }
    const h = parseFloat(g('hpa').value); if (Number.isFinite(h)) s.hpa = h;
    const txt = await readFile(g('curve'));
    if (txt) { s.curve = parseAngleCsv(txt); s.curveType = g('curveType').value; }
    if (s.T != null || s.R != null || s.hpa != null || s.curve) samples.push(s);
  }
  return { name: q('name') || '이름 없음', vendor: q('vendor'), n: parseFloat(q('n')) || 1.586, status: q('status'), samples };
}

async function onClick(el, ev) {
  const act = ev.target?.dataset?.act; if (!act) return;
  const ctx = el._ctx, out = el.querySelector('[data-adv-fit]');
  if (act === 'fit') {
    const e = await collectEntry(el);
    if (!e.samples.length) { out.innerHTML = '<div class="l2-warn">측정값이 있는 시료가 없습니다(두께 + T/R/HPA/곡선 중 하나 이상).</div>'; return; }
    const bad = e.samples.find((s) => s.curve && !measuredShape(s));
    out.innerHTML = '<div class="mut">피팅 중…</div>';
    await new Promise((r) => setTimeout(r, 30));
    const f = fitMaterial(ctx.table, e);
    el._pending = { ...e, id: newId(e.name), fitted: { musR: f.mat.musR, g: f.mat.g, mua: f.mat.mua, free: f.free }, validation: { V6: f.V6, V9: f.V9 }, notes: f.notes,
      fittedWith: { table: ctx.table.meta.created, date: new Date().toISOString().slice(0, 10) } };
    out.innerHTML = `<div>μs′ <b>${num(f.mat.musR)}</b> mm⁻¹ · g ${f.mat.g.toFixed(3)}${f.free.g ? '' : '(고정)'} · μa ${num(f.mat.mua, 2)}${f.free.mua ? '' : '(고정)'} → <b>Milky ${f.milky.toFixed(2)}</b> ${badge(f.V6)} ${badge(f.V9)}</div>
      ${f.predictions.map((p) => `<div class="mut">t=${p.t}mm: 예측 T ${pct(p.pred.T)} R ${pct(p.pred.R)} Haze ${pct(p.pred.haze)} HPA ${p.pred.hpa.toFixed(1)}°</div>`).join('')}
      ${f.notes.map((n) => `<div class="mut">· ${esc(n)}</div>`).join('')}${bad ? '<div class="l2-warn">곡선 일부가 모양 비교에서 제외됨(75° 미만 또는 점 부족)</div>' : ''}
      ${f.V6.ok ? '' : '<div class="l2-warn">V6 불일치 — 이 모델로 측정을 재현하지 못합니다. 저장하면 "보정 불일치" 로 표시됩니다.</div>'}`;
    el.querySelector('[data-act="save"]').disabled = false;
  } else if (act === 'save' && el._pending) {
    try { ctx.db.add(el._pending); el._pending = null; el.querySelector('[data-act="save"]').disabled = true; out.innerHTML = '<div class="mut">저장했습니다.</div>'; ctx.onDbChanged(); }
    catch (e) { out.innerHTML = `<div class="l2-warn">저장 실패: ${esc(e.message)}</div>`; }
  } else if (act === 'del') {
    if (ctx.db.remove(ev.target.dataset.id)) ctx.onDbChanged();
  } else if (act === 'export') {
    download('uds-materials.json', ctx.db.exportJson('all'), 'application/json');
  } else if (act === 'profile') {
    const i = el._desc?.info; if (!i) return;
    const p = predictSample(ctx.table, { musR: i.musR, g: i.g, mua: i.mua, n: i.n }, i.t);
    const rows = ['theta_deg,intensity_rel_per_sr'];
    for (let k = 0; k < N_ANG; k++) rows.push(`${((angEdgeDeg(k) + angEdgeDeg(k + 1)) / 2).toFixed(1)},${p.I[k].toPrecision(5)}`);
    download(`uds-profile-milky${i.milky.toFixed(1)}-t${i.t}.csv`, `# Milky ${i.milky.toFixed(2)}, mu_s'=${i.musR}/mm, g=${i.g}, mu_a=${i.mua}/mm, n=${i.n}, t=${i.t}mm, normal incidence; T=${p.T.toFixed(4)} R=${p.R.toFixed(4)} (ballistic in first bin)\n${rows.join('\n')}\n`, 'text/csv');
  }
}

async function onImport(el, ev) {
  const txt = await readFile(ev.target); if (!txt) return;
  const out = el.querySelector('[data-adv-fit]');
  try { const r = el._ctx.db.importJson(txt); out.innerHTML = `<div class="mut">불러옴 ${r.added.length}건${r.rejected.length ? ` · 거부 ${r.rejected.length}건: ${esc(r.rejected.join('; '))}` : ''}</div>`; el._ctx.onDbChanged(); }
  catch (e) { out.innerHTML = `<div class="l2-warn">불러오기 실패: ${esc(e.message)}</div>`; }
  ev.target.value = '';
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
