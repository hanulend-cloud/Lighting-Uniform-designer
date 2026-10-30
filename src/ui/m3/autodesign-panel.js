// 기구 최적화 카드 — spec P4 §3. 체크 5개(①~⑤) · ③·④ 대상 부품 · [실행]/[중지] · 진행 · 현재|최적 비교 · [적용][취소][되돌리기][STEP]
import { stepRefEmitter } from '../../engine/mech3d/virtual-leds.js';   // 가상 배치 기준 LED(엔진과 같은 규칙)
import { setPartFinish } from '../../engine/mech3d/materials.js';
import { FINISH_GRADES, gradeOf, DEFAULT_FINISH_CATALOG } from '../../engine/mech3d/housing-led.js';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');

// Milky 상한 입력 — 0.5~9.9 로 자름. 빈칸·0·음수·NaN = null(기본값)
export const clampCap = (v) => (Number.isFinite(v) && v > 0 ? Math.min(9.9, Math.max(0.5, v)) : null);
// 상한 기본값(입력 없음) — ① 만 = 9.9(균일도 최고점까지), ② 함께 = max(현재, 5)(② 기준 Milky · 계산 시간) — spec §2.1a
export const capDefault = (sel, avail, curMilky = 0) => (sel.leds && avail.leds?.ok ? Math.max(curMilky ?? 0, 5) : 9.9);
// ④ 보완 계산 후보 — 현재보다 높은 등급 중 가장 낮은 것(없으면 null)
// ④ 보완 안내용 면 처리: 같은 종류(없으면 백색)에서 반사율 +0.10 이상 중 가장 낮은 것, 없으면 그 종류 최고(현재보다 높을 때만).
//   실측: 백색 85 → 95 % 가 길이·폭 모두 개선, 경면 88 % 는 폭 U 를 낮춤 — 종류를 바꾸지 않는다
//   pool = 고를 수 있는 등급(소재 상한 안 · 특수 허용 시 특수 포함 — finishCandidatesFor), 기본 = 전체 등급
export const nextFinish = (cur, pool = FINISH_GRADES) => {
  const kind = cur?.kind === 'metal' ? 'metal' : 'whiteDiffuse', R = cur?.R ?? 0;
  const same = pool.filter((x) => x.kind === kind && x.R > R + 1e-9).sort((a, b) => a.R - b.R);
  return same.find((x) => x.R >= R + 0.1 - 1e-9) ?? same.at(-1) ?? null;
};
// 전체 진행률 — 단계 무게(현재안 5 · ② 35 · ⑤ 20 · ④ 20 · ① 35 · ③ 50 · 최종 10)를 켠 단계로 정규화. 순서 = 실행 순서
const STAGE_W = [['current', 5], ['leds', 35], ['height', 20], ['housing', 20], ['shape', 50], ['milky', 35], ['verify', 10]];   // 엔진 실행 순서와 같게
export function overallFrac(stages, stage, frac) {
  const on = ([k]) => k === 'current' || k === 'verify' || !!stages?.[k];
  const ws = STAGE_W.filter(on), total = ws.reduce((s, [, w]) => s + w, 0), i = ws.findIndex(([k]) => k === stage);
  if (i < 0) return 0;
  const before = ws.slice(0, i).reduce((s, [, w]) => s + w, 0), f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
  return Math.min(1, (before + ws[i][1] * f) / total);
}
// 남은 시간 — 진행 10% 이상부터 경과 ÷ 진행률로 추정
export const etaText = (elapsedMs, frac) => (frac >= 0.1 && frac < 1 ? `남은 약 ${Math.max(1, Math.round((elapsedMs * (1 - frac)) / frac / 1000))}초` : '');
// ① 현재안 재사용 — 점진 계산이 같은 장면(집계 격자 G 동일)에서 잡음 목표에 도달('done')했으면 { stats, eff }, 아니면 null
export function reusableCurrent(snap, G) {
  const s = snap?.stats, eff = snap?.photometry?.eff;
  if (snap?.state !== 'done' || !snap.sceneKey || snap.G !== G || !s || s.empty || !(s.relNoise <= snap.targetNoise) || !Number.isFinite(eff)) return null;
  return { stats: s, eff };
}
// 길이 프로파일 비교(현재 회색 · 최적 강조) — 각자 최댓값으로 정규화. NaN 칸은 건너뜀. 하나라도 없으면 ''
export function profileSvg(cur, best, W = 200, H = 48) {
  if (!cur?.length || !best?.length) return '';
  const line = (p, cls, color) => {
    let mx = 0; for (const v of p) if (Number.isFinite(v) && v > mx) mx = v;
    if (!(mx > 0)) return '';
    const n = Math.max(1, p.length - 1), pts = [];
    for (let i = 0; i < p.length; i++) if (Number.isFinite(p[i])) pts.push(`${((i / n) * W).toFixed(1)},${(H - 2 - (p[i] / mx) * (H - 4)).toFixed(1)}`);
    return `<polyline class="${cls}" points="${pts.join(' ')}" fill="none" style="stroke:${color};stroke-width:1.5"/>`;
  };
  const a = line(cur, 'cur', 'var(--m3-mut, #888)'), b = line(best, 'best', 'var(--m3-acc, #2a6)');
  if (!a || !b) return '';
  return `<div class="m3-row"><span class="mut">길이 프로파일(각 최대 = 1) · 회색 현재 · 색 최적</span></div><svg class="m3-ad-prof" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="길이 프로파일 현재 대 최적">${a}${b}</svg>`;
}

// M = spec.mech3d, info.non25[i] = 부품 i 의 비 2.5D 비율(관측 방향, app 이 frameHeights 로 계산)
export function stageAvailability(M, info) {
  const milkyParts = M.parts.map((p, i) => (p.material.kind === 'milky' ? i : -1)).filter((i) => i >= 0);
  const shapeParts = M.parts.map((p, i) => (p.material.kind !== 'opaque' && (info.non25?.[i] ?? 1) <= 0.02 ? i : -1)).filter((i) => i >= 0);
  const opaque = M.parts.map((p, i) => (p.material.kind === 'opaque' && p.role !== 'light' && !p.untrace ? i : -1)).filter((i) => i >= 0);   // ④ 대상 = 계산에 드는 불투명 부품(광원으로 옮긴 LED·추적 제외 부품 빼고)
  return {
    milky: milkyParts.length ? { ok: true, parts: milkyParts } : { ok: false, why: 'Milky 부품이 없음 — 부품 소재를 Milky 로 지정하세요' },
    leds: M.light.kind === 'manual' ? { ok: true } : M.light.kind === 'step' ? (stepRefEmitter(M.light.step) ? { ok: true, note: 'LED STEP — 기준 LED 를 복사해 개수·간격 조정' } : { ok: false, why: 'LED STEP — 기준이 될 LED 가 없음 · LED 발광면을 먼저 지정하세요' }) : { ok: false, why: '광원을 직접 배치로 지정하세요' },
    shape: shapeParts.length ? { ok: true, parts: shapeParts } : { ok: false, why: '관측 방향으로 2.5D 인 투과 부품이 없음' },
    height: heightAvail(M.light),
    housing: opaque.length ? { ok: true, parts: opaque } : { ok: false, why: '불투명 부품이 없음 — 케이스 부품 소재를 불투명으로 지정하세요' },
  };
}
// ⑤ 가능 여부 — 직접 배치(깊이) · LED STEP(발광점 있음). 기구 면 PCB 는 높이가 면으로 정해짐
function heightAvail(Lt) {
  if (Lt.kind === 'manual') return Lt.manual?.pcb?.kind === 'face' ? { ok: false, why: 'PCB 가 기구 면에 붙어 있음 — 높이는 기구 면으로 정해짐' } : { ok: true };
  if (Lt.kind === 'step') return stepRefEmitter(Lt.step) ? { ok: true } : { ok: false, why: 'LED STEP — LED 발광면을 먼저 지정하세요' };
  return { ok: false, why: '광원을 지정하세요' };
}
// ④ 기본 대상 — 관측 부품(첫 관측면) 외곽 상자를 포함하는 불투명 부품 중 외곽 부피 최대, 없으면 불투명 부품 중 최대, 없으면 −1. boxes[i] = [x0,y0,z0,x1,y1,z1]
export function defaultHousingPart(M, boxes) {
  const op = M.parts.map((p, i) => (p.material.kind === 'opaque' && boxes[i] ? i : -1)).filter((i) => i >= 0);
  if (!op.length) return -1;
  const vol = (b) => (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]), big = (is) => is.reduce((a, i) => (vol(boxes[i]) > vol(boxes[a]) ? i : a));
  const ob = boxes[M.observe?.faces?.[0]?.part], e = 1e-6;
  const inside = ob ? op.filter((i) => [0, 1, 2].every((k) => boxes[i][k] <= ob[k] + e && boxes[i][k + 3] >= ob[k + 3] - e)) : [];
  return big(inside.length ? inside : op);
}
// 면 처리 문구 — 백색 85% · 경면 88% · 광택 · 흑색 5%
const FIN_NAME = { whiteDiffuse: '백색', metal: '경면', black: '흑색', gloss: '광택' };
// coating = 특수 처리 id → ' (특수: 고반사 도장)' — catalog = 반사 소재표 행(DB, 사용자 특수 항목 포함)
const coatName = (id, catalog) => { const e = catalog.find((x) => x.id === id && x.special); return e ? e.short ?? e.name : null; };
export const finishText = (f, catalog = DEFAULT_FINISH_CATALOG) => (!f ? '–' : `${FIN_NAME[f.kind] ?? f.kind}${f.R != null ? ` ${Math.round(f.R * 100)}%` : ''}${coatName(f.coating, catalog) ? ` (특수: ${coatName(f.coating, catalog)})` : ''}`);
// ⑤ dz 적용(M = spec.mech3d, 바꿔서 돌려줌) — LED STEP: offset += dz·d, 저장된 발광점(월드 좌표)도 같이 이동 · 직접 배치(깊이): depth −= dz · 기구 면 PCB: 그대로
export function applyDz(M, dz, d) {
  if (!dz) return M;
  const Lt = M.light;
  if (Lt.kind === 'step' && Lt.step) {
    const mv = (p) => p.map((v, k) => v + dz * d[k]);
    Lt.step.offset = mv(Lt.step.offset ?? [0, 0, 0]);
    Lt.step.emitters = (Lt.step.emitters ?? []).map((e) => ({ ...e, pos: mv(e.pos) }));
  } else if (Lt.kind === 'manual' && Lt.manual?.pcb?.kind === 'depth') Lt.manual.pcb.depth -= dz;
  return M;
}
// ④ 면 처리 적용 — 그 부품의 기본 면 처리만 교체(면별 덮어쓰기 유지) · 특수 처리면 부품 coating = id, 아니면 해제
export function applyFinish(M, f) {
  if (!f) return M;
  const q = setPartFinish(M.parts[f.part], null, { kind: f.kind, ...(f.R != null ? { R: f.R } : {}) });
  if (f.coating) q.coating = f.coating; else delete q.coating;
  M.parts[f.part] = q;
  return M;
}
const ITEMS = [['milky', '① Milky 레벨'], ['leds', '② LED 개수·피치'], ['shape', '③ LGP 형상'], ['housing', '④ 케이스 면 처리'], ['height', '⑤ LED 높이(LED–커버 거리)']];
const progHtml = (running) => {
  const pct = Math.round((running.frac ?? 0) * 100);
  return `<div class="m3-ad-prog"><div class="bar" role="progressbar" aria-label="기구 최적화 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><span>${esc(running.text)}</span> <button type="button" data-ad="stop">중지</button></div>`;
};
// 최적화 타일(가운데 칸)의 켜기 스위치·항목 설정(순수) — 고르는 곳 = 진행을 보는 곳(아래 칸 대시보드와 한 자리)
// state = { avail, sel, running, names, milkyPart, housingMat } → { on, html }(html = 스위치 + 설정, 쓸 수 없으면 이유)
// 화면의 기구 최적화 = 3 항목: ① Milky · ② 기구 위치(= 엔진 ② LED 배치 + ⑤ LED 높이) · ③ 기구 형상. 케이스 반사율(④)은 부품 속성에서 직접
export const AD_ITEMS = [['milky', '① Milky', ['milky']], ['position', '② 기구 위치', ['leds', 'height']], ['shape', '③ 기구 형상', ['shape']], ['housing', '④ 케이스 면', ['housing']]];
export const TILE_NOTE = { position: 'LED 개수·피치·열과 LED–커버 거리(높이)', milky: 'Milky 값을 바꿔 균일도 최고점을 찾음(밝기는 줄어듦)', leds: 'LED 개수·피치·열을 바꿈', shape: '도광판 아랫면 형상(두께·끝단·가장자리)', housing: '케이스 반사율(소재 상한 안)', height: 'LED–커버 거리' };
export function tileConfigHtml(k, { avail, sel, running, names = [], milkyPart = null, housingMat = null }) {
  const pname = (i) => esc(names[i] ?? `부품 ${i + 1}`), dis = running ? ' disabled' : '';
  if (k === 'position') {   // ② 기구 위치 = LED 배치 + LED 높이(쓸 수 있는 것만)
    const okL = !!avail.leds?.ok, okH = !!avail.height?.ok;
    if (!okL && !okH) { const why = avail.leds?.why ?? avail.height?.why ?? ''; return { on: false, box: '<input type="checkbox" data-ad="position" disabled aria-label="② 기구 위치 사용">', opt: '', why, html: `<label class="od-sw off"><input type="checkbox" data-ad="position" disabled> 사용 안 함</label><div class="od-why mut">${esc(why)}</div>` }; }
    const on = !!(sel.leds || sel.height), why = `${okL ? 'LED 개수·피치·열' : ''}${okL && okH ? ' + ' : ''}${okH ? 'LED–커버 거리(높이)' : ''}${okL && avail.leds.note ? ` · ${avail.leds.note}` : ''}`;
    return { on, box: `<input type="checkbox" data-ad="position"${on ? ' checked' : ''}${dis} aria-label="② 기구 위치 사용">`, opt: '', why, html: `<label class="od-sw"><input type="checkbox" data-ad="position"${on ? ' checked' : ''}${dis}> ${on ? '사용' : '사용 안 함'}</label><div class="od-why mut">${esc(why)}</div>` };
  }
  const a = avail[k];
  if (!a) return { on: false, box: '', opt: '', why: '', html: '' };
  if (!a.ok) return { on: false, box: `<input type="checkbox" data-ad="${k}" disabled aria-label="${k} 사용">`, opt: '', why: a.why ?? '', html: `<label class="od-sw off"><input type="checkbox" data-ad="${k}" disabled> 사용 안 함</label><div class="od-why mut">${esc(a.why)}</div>` };
  const on = !!sel[k], sw = `<label class="od-sw"><input type="checkbox" data-ad="${k}"${on ? ' checked' : ''}${dis}> ${on ? '사용' : '사용 안 함'}</label>`;
  let opt = '';
  if (on && k === 'milky') opt = milkyPart != null ? `<div class="od-opt mut">대상: ${pname(milkyPart)}</div>` : '';   // 상한 입력칸은 뺌(2026-10-29) — 상한 = capDefault 자동
  if (k === 'shape') opt = `<div class="od-opt">형상 바꿀 부품 <select data-ad="shapePart" aria-label="③ 대상 부품"${dis}>${avail.shape.parts.map((i) => `<option value="${i}"${i === sel.shapePart ? ' selected' : ''}>${pname(i)}</option>`).join('')}</select></div>`;
  if (k === 'housing') opt = `<div class="od-opt">대상 <select data-ad="housingPart" aria-label="④ 대상 부품"${dis}>${avail.housing.parts.map((i) => `<option value="${i}"${i === sel.housingPart ? ' selected' : ''}>${pname(i)}</option>`).join('')}</select> <span class="mut">${housingMat ? `${esc(housingMat.name)} · 최대 ${Math.round(housingMat.max * 100)}%` : '소재 미지정'}</span></div>
    <label class="od-opt"><input type="checkbox" data-ad="housingSpecial"${sel.housingSpecial ? ' checked' : ''}${dis}> 특수 표면처리 허용</label>`;
  const why = `${TILE_NOTE[k] ?? ''}${a.note ? ` · ${a.note}` : ''}`;
  return { on, box: `<input type="checkbox" data-ad="${k}"${on ? ' checked' : ''}${dis} aria-label="${k} 사용">`, opt, why, html: `${sw}<div class="od-why mut">${esc(why)}</div>${opt}` };
}
// 기구 최적화 한 줄(대시보드 맨 위) — 켠 항목 · [▶ 실행] · [되돌리기] · [접기]. 실행 중 = 진행 막대 · [중지]. 항목 고르기는 아래 타일에서
// noLine = 관측 라인 없음(실행 불가)
export function autoCardHtml({ avail, sel, running, canRevert = false, noLine = false, applied = null }) {
  const on = AD_ITEMS.filter(([, , ks]) => ks.some((k) => sel[k] && avail[k]?.ok)).map(([, l]) => l.split(' ')[0]);
  const run = `<button type="button" class="m3-ad-run" data-ad="run"${!on.length || noLine ? ' disabled' : ''}${noLine ? ' title="관측 라인이 없음"' : ''}>▶ 실행</button>`;
  if (running) return `<div class="m3-ad-bar">${progHtml(running)}</div>`;
  return `<div class="m3-ad-bar">${run}<span class="m3-ad-on">${on.length ? `켠 항목 <b>${on.join(' ')}</b>` : '<span class="mut">위 설계 인자에서 바꿀 항목을 체크하세요</span>'}</span>${canRevert ? '<span class="m3-ad-sp"></span><button type="button" data-ad="revert" title="마지막 적용 전 값으로">↶ 되돌리기</button>' : ''}</div>${appliedHtml(applied)}`;
}
// 형상 문구 — 0 인 항 생략. e = 끝단 두께, c = 폭 가장자리 두께(+ 가장자리 두껍게 · − 얇게), h < 0 = 돌출
const sg = (v) => `${v >= 0 ? '+' : '−'}${f2(Math.abs(v))}`, nz = (v) => Number.isFinite(v) && Math.abs(v) >= 5e-5;
export function shapeText(s) {
  const t = [];
  if (nz(s.dt)) t.push(`두께 ${sg(s.dt)}`);
  if (nz(s.h)) t.push(`${s.h > 0 ? '포켓' : '돌출'} ${f2(Math.abs(s.h))} R ${Number.isFinite(s.R) ? s.R.toFixed(1) : '–'}`);
  if (nz(s.e)) t.push(`끝단 두께 ${sg(s.e)}`);
  if (nz(s.c)) t.push(`폭 가장자리 두께 ${sg(s.c)}`);
  const cv = (k) => { const v = (k ?? []).filter(nz); return v.length ? `${sg(Math.min(...k))}~${sg(Math.max(...k))}` : ''; };   // 곡선 = 제어점 최소~최대
  if (cv(s.kL)) t.push(`길이 두께 곡선 ${cv(s.kL)}`);
  if (cv(s.kW)) t.push(`폭 두께 곡선 ${cv(s.kW)}`);
  return t.length ? `${t.join(' · ')} mm` : '변경 없음';
}
// ③ 선별 요약 — 이득 ≥ 0.005 만 큰 순, 나머지는 '효과 없음' 으로 이름만
const VAR_NAME = { dt: '두께', h: '국부 형상', e: '끝단 두께', c: '폭 가장자리 두께' };
export function screenSummary(gains) {
  if (!gains) return '';
  const ks = Object.keys(VAR_NAME).filter((k) => k in gains), on = ks.filter((k) => gains[k] >= 0.005).sort((a, b) => gains[b] - gains[a]), off = ks.filter((k) => !on.includes(k));
  const head = on.length ? on.map((k) => `${VAR_NAME[k]} +${f2(gains[k])}`).join(' · ') : '모든 형상 변수';
  return `효과(선별): ${head}${off.length ? `${on.length ? ' — ' : ' '}${on.length ? off.map((k) => VAR_NAME[k]).join('·') + ' ' : ''}효과 없음` : ''}`;
}
// 비교표 — cur/best = { count, pitch, milky, Ulen, Uwid, eff, profile? }, shape = { dt, h, R, e?, c? } | null, cur.shape = 이미 적용된 형상(없으면 원본), screen = ③ 선별 이득 { dt, e, c, h? } | null
// stepLeds = LED STEP 발광점 수(직접 배치면 null) · STEP 이면 열마다 stepOrig(true = 원래 위치, false = 기준 LED 복사 배치) · unchanged = 최종안이 현재안 그대로(나은 설계 없음) → 사유 표시 · [적용] 비활성
// finish = ④ { cur, best }(면 처리) | null · height = ⑤ { dz, gap(현재 LED–커버 축 거리, NaN = 모름) } | null
// 바뀐 양(소수 2자리, 0.005 미만 = 없음) — Milky·U 는 값 차, 광 효율은 %p
// 화면에 보이는 값(소수 2자리)끼리의 차 — 표의 두 값과 어긋나지 않게
const dl = (a, b, k = 1, u = '') => { if (!Number.isFinite(a) || !Number.isFinite(b)) return ''; const d = +(b * k).toFixed(2) - +(a * k).toFixed(2); return Math.abs(d) >= 0.005 ? ` <span class="m3-dl">(${d > 0 ? '+' : ''}${d.toFixed(2)}${u})</span>` : ''; };
// 총 LED 수(2열 = 열 수 × 열당, 위치 목록 = 그 수)
const ledTotal = (x) => (x?.positions?.length ? x.positions.length : Number.isFinite(x?.count) ? x.count * (x.rows === 2 ? 2 : 1) : NaN);
// 비교표 줄(현재 → 최적/적용 후) — compareHtml 과 적용 뒤 요약(appliedHtml)이 같이 씀
const passMark = (v, t) => (Number.isFinite(v) && Number.isFinite(t) ? (v + 1e-9 >= t ? ' <b class="ok">✓</b>' : ' <b class="bad">✕</b>') : '');
// targets = { len, wid } — 균일도 줄에 목표·통과(✓/✕)
function cmpRows({ cur, best, shape, stepLeds = null, finish = null, height = null, catalog = DEFAULT_FINISH_CATALOG, targets: tg = null }) {
  const tr = (label, a, b, d = '') => `<tr><th>${label}</th><td>${a}</td><td class="${a !== b ? 'chg' : ''}">${b}${d}</td></tr>`;
  const lay = (x) => `${x.rows === 2 ? '2열 × ' : ''}${x.count}개 ${x.pitch > 0 ? `피치 ${x.pitch}` : '균등'}${x.rows === 2 ? ` (열 간격 ±${(x.rowGap ?? 0).toFixed(1)} mm)` : ''}`;   // 2열 = 열당 개수(spec P4 §2.2b)
  const led = (x) => (x.layoutText ? x.layoutText : stepLeds == null ? lay(x) : x.stepOrig === false ? `${lay(x)}` : `LED STEP 현재 ${x.count ?? stepLeds}개`);   // layoutText = ② 배치 Solver 문구(같은 피치/끝 압축/자유 배치) · STEP: stepOrig = 원래 STEP 위치
  const curShape = cur.shape ? `적용된 형상 · ${shapeText(cur.shape)}` : '원본';
  const tc = stepLeds != null && cur.stepOrig !== false ? stepLeds : ledTotal(cur), tb = best.stepOrig === true ? tc : ledTotal(best);
  const tot = Number.isFinite(tc) && Number.isFinite(tb) && tb !== tc ? ` <b class="m3-tot">· 총 ${tb}개 (${tb > tc ? '+' : ''}${tb - tc})</b>` : '';
  return `${tr('LED', led(cur), led(best), tot)}
      ${tr('Milky', f2(cur.milky), f2(best.milky), dl(cur.milky, best.milky))}
      ${tr(`길이 U${tg?.len != null ? ` <span class="mut">목표 ${f2(tg.len)}</span>` : ''}`, f2(cur.Ulen), f2(best.Ulen), `${dl(cur.Ulen, best.Ulen)}${passMark(best.Ulen, tg?.len)}`)}${tr(`폭 U${tg?.wid != null ? ` <span class="mut">목표 ${f2(tg.wid)}</span>` : ''}`, f2(cur.Uwid), f2(best.Uwid), `${dl(cur.Uwid, best.Uwid)}${passMark(best.Uwid, tg?.wid)}`)}
      ${tr('광 효율', `${f2(cur.eff * 100)}%`, `${f2(best.eff * 100)}%`, dl(cur.eff, best.eff, 100, '%p'))}
      ${shape || cur.shape ? tr('형상', curShape, shape ? shapeText(shape) : curShape) : ''}
      ${finish ? tr('케이스 면', finishText(finish.cur, catalog), finishText(finish.best ?? finish.cur, catalog)) : ''}
      ${height ? (() => { const now = Number.isFinite(height.gap) ? `현재 (커버까지 ${height.gap.toFixed(1)} mm)` : '현재'; return tr('LED 높이', now, nz(height.dz) ? `${sg(height.dz)} mm${Number.isFinite(height.gap) ? ` (커버까지 ${(height.gap - height.dz).toFixed(1)} mm)` : ''}` : now); })() : ''}`;
}
export function compareHtml(r) {
  const { cur, best, feasible, reason, shape, canRevert = false, unchanged = false, screen = null } = r;
  const bs = r.base, boost = r.added?.length ? `<div class="m3-boost">체크한 항목만으로는 목표 미달${bs ? ` (길이 U ${f2(bs.Ulen)} · 폭 U ${f2(bs.Uwid)}${bs.reason ? ` — ${esc(bs.reason)}` : ''})` : ''} → 보완 자동 추가: <b>${r.added.map(esc).join(' · ')}</b></div>` : '';
  const twoRow = best.rows === 2 && cur.rows !== 2 ? '<div class="m3-warn">2열 배치 = LED PCB 를 새로 설계해야 함</div>' : '';
  const effDrop = Number.isFinite(cur.eff) && Number.isFinite(best.eff) && best.eff - cur.eff <= -0.02 ? `<div class="m3-warn">광 효율 ${((cur.eff - best.eff) * 100).toFixed(1)}%p 감소 — 같은 LED 광속이면 그만큼 어두워짐</div>` : '';
  const clash = r.clash > 0 ? `<div class="m3-clash" role="alert">이 안은 LED 몸체가 부품과 겹침(${r.clash}개) — 조립 불가라 적용하지 않음</div>` : '';
  const note = r.note ? `<div class="m3-warn">${esc(r.note)}</div>` : '';
  return `<div class="m3-h">${unchanged ? '현재안 유지' : feasible ? '최적안' : '가장 가까운 안'} <span class="mut">${esc(reason)}</span></div>${note}${boost}${clash}
    <table class="m3-cmp"><tr><th></th><th>현재</th><th>최적</th></tr>
      ${cmpRows(r)}
    </table>${twoRow}${effDrop}${profileSvg(cur.profile, best.profile)}${screen ? `<div class="m3-row mut">${esc(screenSummary(screen))}</div>` : ''}
    <div class="m3-row"><button type="button" data-ad="apply"${unchanged ? ' disabled title="현재안과 같음"' : r.clash > 0 ? ' disabled title="LED 몸체가 부품과 겹침"' : ''}>적용</button>${altBtn(r)}<button type="button" data-ad="cancel">취소</button>${shape ? '<button type="button" data-ad="step">STEP 내보내기</button>' : ''}${canRevert ? '<button type="button" data-ad="revert">되돌리기</button>' : ''}</div>`;
}
// 적용 뒤에도 남는 요약(이전 → 적용 후) — applied = 적용한 결과(compareHtml 인자와 같은 꼴) + at(시각 문구)
export function appliedHtml(applied) {
  if (!applied) return '';
  return `<div class="m3-applied"><div class="m3-h">적용한 변경 <span class="mut">${esc(applied.at ?? '')} · 되돌리기 전까지 유지</span></div>
    <table class="m3-cmp"><tr><th></th><th>이전</th><th>적용 후</th></tr>${cmpRows(applied)}</table></div>`;
}

// el 에 카드를 그리고 이벤트를 h 로 넘긴다. state = { avail, sel, running, result, names, canRevert, noLine, milkyPart }
// 실행 중 카드 구조가 같으면 진행 막대·문구만 바꿈(갱신마다 innerHTML 을 다시 만들지 않게)
// '현재안 유지'인데 시험한 후보가 있으면(차이가 잡음 수준) [그래도 적용] — 후보 값을 함께 보임
const altBtn = (r) => (r.unchanged && r.alt ? `<button type="button" data-ad="applyAlt" title="찾은 후보가 현재안보다 계산 잡음 수준만큼만 나아 '현재안 유지'로 판정됨 — 그래도 바꾸려면">그래도 적용${r.alt.milky != null ? ` (Milky ${(+r.alt.milky).toFixed(2)})` : ''} · ${f2(r.alt.Ulen)}/${f2(r.alt.Uwid)}</button>` : '');
// Milky 조정 표(2026-10-29) — 마지막 ① Milky 단계 기록(뒤에서부터 연속 'milky' 단계, ② 기준 'ledsRef' 제외)의 Milky 별 길이 U·폭 U·광 효율.
// 같은 Milky 는 나중(정밀) 값 · 믿는(trusted) 행만 · Milky 오름차순. Milky 가 마지막 단계라 최종안의 다른 인자 그대로의 추정 — 순수
export function milkyTable(steps = []) {
  const m = new Map();
  let e = steps.length; while (e > 0 && (steps[e - 1]?.stage === 'guard' || steps[e - 1]?.stage === 'ledsVerify')) e--;   // 검증 뒤 기록(현재안 유지·② 재확인)은 건너뜀
  let i = e - 1; while (i >= 0 && steps[i]?.stage === 'milky' && steps[i].phase !== 'ledsRef') i--;
  for (const st of steps.slice(i + 1, e)) for (const r of st.rows ?? []) if (r.trusted && Number.isFinite(r.Ulen)) m.set((+r.milky).toFixed(2), { milky: +r.milky, Ulen: r.Ulen, Uwid: r.Uwid, eff: r.eff });
  return [...m.values()].sort((a, b) => a.milky - b.milky);
}
// 표 HTML — chosen = 최적화가 고른 Milky(강조). 줄마다 [적용](data-ad="applyMilky" data-v=Milky). 목표 통과 ✓/✕ · 효율 %
export function milkyTableHtml(rows, chosen, tg = {}) {
  if (!rows?.length) return '';
  // 줄 줄이기 — 간격 = max(0.25, 범위/10) 을 0.25 단위로, 격자마다 가장 가까운 행 + 최적 행(최대 ≈ 12줄)
  const lo = rows[0].milky, hi = rows.at(-1).milky, stp = Math.max(0.25, Math.ceil((hi - lo) / 10 / 0.25) * 0.25), pick = new Set();
  for (let g = Math.ceil(lo / stp) * stp; g <= hi + 1e-9; g += stp) pick.add(rows.reduce((a, r) => (Math.abs(r.milky - g) < Math.abs(a.milky - g) ? r : a)));
  const ch = rows.reduce((a, r) => (Math.abs(r.milky - chosen) < Math.abs(a.milky - chosen) ? r : a)); if (Math.abs(ch.milky - chosen) < 0.005) pick.add(ch);
  rows = rows.filter((r) => pick.has(r));
  const pm = (v, t) => (Number.isFinite(v) && Number.isFinite(t) ? (v + 1e-9 >= t ? ' <b class="ok">✓</b>' : ' <b class="bad">✕</b>') : '');
  const tr = (r) => { const sel = Math.abs(r.milky - chosen) < 0.005;
    return `<tr${sel ? ' class="sel"' : ''}><td>${r.milky.toFixed(2)}${sel ? ' <span class="mut">최적</span>' : ''}</td><td>${f2(r.Ulen)}${pm(r.Ulen, tg.len)}</td><td>${f2(r.Uwid)}${pm(r.Uwid, tg.wid)}</td><td>${Number.isFinite(r.eff) ? `${(r.eff * 100).toFixed(1)}%` : '–'}</td><td>${sel ? '' : `<button type="button" data-ad="applyMilky" data-v="${+r.milky.toFixed(2)}">적용</button>`}</td></tr>`; };
  return `<details class="m3-mtab"><summary>Milky 조정 <span class="mut">— 낮추면 광 효율↑ · 균일도↓ (다른 인자는 최적안 그대로의 추정)</span></summary>
    <table class="m3-cmp m3-cmp-s"><tr><th>Milky</th><th>길이 U</th><th>폭 U</th><th>광 효율</th><th></th></tr>${rows.map(tr).join('')}</table></details>`;
}
// 결과 카드(2026-10-29: 같은 내용이 여러 번 반복되던 것을 하나로) — 판정 한 단어 · 작은 비교표(바뀐 사양 + 길이 U·폭 U·광 효율) ·
// 한계 한 줄 · [적용] [그래도 적용] [취소] [자세히](프로파일·사유 전문 = 결과 창)
const KEEP_ROW = /<th>(길이 U|폭 U|광 효율)/;
export const limitText = (reason) => { const m = /한계:\s*([^·)]+)/.exec(String(reason ?? '')); return m ? m[1].trim() : ''; };
export function resultLineHtml(r) {
  const verdict = r.unchanged ? ['keep', '현재안 유지', '더 나은 안 없음'] : r.feasible ? ['ok', '목표 통과', '최적안을 찾음'] : ['bad', '목표 미달', '가장 가까운 안'];
  const rows = cmpRows(r).split('</tr>').filter((x) => x.includes('<tr>') && (x.includes('class="chg"') || KEEP_ROW.test(x))).map((x) => `${x}</tr>`).join('');
  const lim = limitText(r.reason), clash = r.clash > 0 ? `<div class="m3-clash" role="alert">LED 몸체가 부품과 겹침(${r.clash}개) — 적용 불가</div>` : '';
  return `<div class="m3-rcard ${verdict[0]}"><div class="m3-rcard-hd"><b class="m3-rv">${verdict[1]}</b><span class="mut">${verdict[2]}</span></div>
    <table class="m3-cmp m3-cmp-s"><tr><th></th><th>지금</th><th>최적 후보</th></tr>${rows}</table>${clash}
    ${lim ? `<div class="m3-rlim">💡 한계: ${esc(lim)}</div>` : ''}
    ${milkyTableHtml(r.milkyRows, r.best?.milky, r.targets ?? {})}
    <div class="m3-rbtn"><button type="button" data-ad="apply"${r.unchanged ? ' disabled title="현재안이 이미 최선(차이 없음)"' : r.clash > 0 ? ' disabled title="LED 몸체가 부품과 겹침"' : ''}>적용</button>${altBtn(r)}<button type="button" data-ad="cancel">취소</button>${r.clash > 0 ? '' : `<button type="button" data-ad="continue" title="${r.unchanged ? '지금 설계 그대로' : '이 안을 적용한 뒤'}, 체크했지만 이번에 돌리지 않은 항목(예: 위치·Milky)을 그 위에서 이어서 최적화">이 안에서 이어서 ▸</button>`}<span class="m3-ad-sp"></span><button type="button" data-ad="view" title="프로파일 비교·사유 전문">자세히 ▸</button></div></div>`;
}
// el 에 그리고 이벤트를 h 로 넘김. state = { avail, sel, running, result, resultOpen, … } — 결과가 있으면 한 줄 + (열림) 결과 창
export function renderAutoPanel(el, state, h) {
  const r = state.result, full = r ? compareHtml({ ...r, canRevert: state.canRevert, ...(state.catalog ? { catalog: state.catalog } : {}) }) : '';
  const html = r ? `${resultLineHtml(r)}${state.resultOpen ? `<div class="m3-rmodal" role="dialog" aria-modal="true" aria-label="기구 최적화 결과"><div class="m3-rmodal-in"><div class="m3-rmodal-hd"><b>기구 최적화 결과</b><span class="m3-ad-sp"></span><button type="button" data-ad="hide">닫기 (결과는 남음)</button></div>
      <div class="m3-rverdict ${r.unchanged ? '' : r.feasible ? 'ok' : 'bad'}">${r.unchanged ? `현재 설계보다 나은 안을 찾지 못함 — 현재안 유지${r.alt ? ' (찾은 후보와 차이가 계산 잡음 수준 — 원하면 [그래도 적용])' : ''}` : r.feasible ? '✓ 목표 통과' : '✕ 목표 미달 — 가장 가까운 안'}</div>${full}</div></div>` : ''}` : autoCardHtml(state);
  const key = r ? html : autoCardHtml({ ...state, running: state.running ? { frac: 0, text: '' } : null });
  const bar = state.running && !r && el._adKey === key ? el.querySelector('.m3-ad-prog .bar') : null;
  if (bar) {
    const pct = Math.round((state.running.frac ?? 0) * 100);
    bar.setAttribute('aria-valuenow', String(pct)); bar.firstElementChild.style.width = `${pct}%`;
    el.querySelector('.m3-ad-prog span').textContent = state.running.text ?? '';
    return;
  }
  el._adKey = key; el.innerHTML = html;
  el.querySelectorAll('[data-ad]').forEach((x) => {
    const k = x.dataset.ad;
    if (x.type === 'checkbox') x.onchange = () => h.onSel(k, x.checked);
    else if (x.tagName === 'SELECT' || x.type === 'number') x.onchange = () => h.onSel(k, x.value === '' ? NaN : +x.value);
    else x.onclick = () => h.onAction(k, x.dataset.v);   // data-v = 값(Milky 조정 표의 Milky)
  });
  const m = el.querySelector('.m3-rmodal');
  if (m) m.addEventListener('click', (e) => { if (e.target === m) h.onAction('hide'); });
}
