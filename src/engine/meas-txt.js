// 측정 txt 파일 읽기(순수) — 소재·표면 DB 를 측정값으로 만들 때 쓰는 4 가지 파일:
//   각도별 BSDF(각도, 값) · 파장별 BSDF(파장·각도·값: 3열 또는 표) · 파장별 투과율(파장, T) · 파장별 반사율(파장, R)
// 계산은 단색(파장 없음)이라 파장별 값은 명소시 시감도 V(λ) 가중 평균(사람 눈 밝기 기준, 380~780 nm)으로 한 값으로 줄인다.
// spd(LED 스펙트럼 [{nm, v}])를 주면 V(λ)×S(λ) 가중 — 그 LED 빛으로 본 밝기 기준
// 구분자 = 쉼표·탭·공백·세미콜론, 숫자가 아닌 줄(머리글·주석)은 건너뜀. % 값(최대 > 1.5)은 0~1 로 바꿈

// CIE 1924 명소시 시감도 V(λ), 380~780 nm 10 nm 간격
const V10 = [0.000039, 0.00012, 0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.09098, 0.13902, 0.20802, 0.323, 0.503, 0.71, 0.862, 0.954, 0.99495, 0.995, 0.952, 0.87, 0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107, 0.061, 0.032, 0.017, 0.00821, 0.004102, 0.002091, 0.001047, 0.00052, 0.000249, 0.00012, 0.00006, 0.00003, 0.000015];
export function photopicV(nm) {
  if (!(nm >= 380 && nm <= 780)) return 0;
  const x = (nm - 380) / 10, k = Math.min(39, Math.floor(x)), f = x - k;
  return V10[k] * (1 - f) + V10[k + 1] * f;
}
const isWl = (x) => x >= 250 && x <= 2500;   // 파장(nm)으로 볼 범위
const isAng = (x) => x >= -90 && x <= 90;

// 숫자 표 읽기 — 숫자로만 된 줄 = 행. 첫 줄이 '글자 + 숫자들'이면 머리글 숫자(표 형식의 열 이름)로 따로 돌려줌
export function parseNumericTable(text) {
  const rows = [];
  let head = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^[#%/]/.test(t)) continue;
    const cells = t.split(/[,\t; ]+/).filter(Boolean), nums = cells.map(Number);
    if (nums.length >= 2 && nums.every(Number.isFinite)) { rows.push(nums); continue; }
    // 머리글: 첫 칸이 글자이고 나머지가 숫자(예: "deg\t400\t450…")
    if (!rows.length && cells.length >= 3 && nums.slice(1).every(Number.isFinite)) head = nums.slice(1);
  }
  return { head, rows };
}
// 0~1 로(최댓값이 1.5 넘으면 % 로 봄)
const unitScale = (vals) => (Math.max(...vals) > 1.5 ? 0.01 : 1);

// 선형 보간(범위 밖 = 0) — p 는 nm 오름차순
function interp(p, nm) {
  if (!p?.length || nm < p[0].nm || nm > p[p.length - 1].nm) return 0;
  let k = 0; while (k < p.length - 2 && p[k + 1].nm < nm) k++;
  const a = p[k], b = p[k + 1] ?? a, f = b.nm > a.nm ? (nm - a.nm) / (b.nm - a.nm) : 0;
  return a.v + (b.v - a.v) * f;
}
// 파장별 값 → V(λ)(× spd) 가중 평균(1 nm 격자, 선형 보간). pts = [{ nm, v }] (v 0~1). 측정 범위가 400~700 nm 를 다 덮지 못하면 note
export function photopicAverage(pts, spd = null) {
  const S = spd ? [...spd].sort((a, b) => a.nm - b.nm) : null;
  const p = [...pts].filter((q) => Number.isFinite(q.nm) && Number.isFinite(q.v)).sort((a, b) => a.nm - b.nm);
  if (p.length < 2) return { value: p[0]?.v ?? NaN, note: '파장 점이 2개 미만' };
  const lo = Math.max(380, Math.ceil(p[0].nm)), hi = Math.min(780, Math.floor(p[p.length - 1].nm));
  let sw = 0, s = 0, j = 0;
  for (let nm = lo; nm <= hi; nm++) {
    while (j < p.length - 2 && p[j + 1].nm < nm) j++;
    const a = p[j], b = p[j + 1], f = b.nm > a.nm ? (nm - a.nm) / (b.nm - a.nm) : 0, v = a.v + (b.v - a.v) * Math.min(1, Math.max(0, f)), w = photopicV(nm) * (S ? interp(S, nm) : 1);
    sw += w; s += w * v;
  }
  const note = p[0].nm > 400 || p[p.length - 1].nm < 700 ? `측정 범위 ${p[0].nm}~${p[p.length - 1].nm} nm — 400~700 nm 를 다 덮지 않음` : '';
  return { value: sw > 0 ? s / sw : NaN, note };
}

// 파일 읽기(자동 구분). 반환 { kind, ... }
//   'angle'    : { curve: [{theta, v}] } — 각도별 BSDF(2열, 첫 열이 각도)
//   'spectral' : { value(0~1, V 가중), points: [{nm, v}], note } — 파장별 투과율·반사율(2열, 첫 열이 파장)
//   'spectralBsdf' : { curve: [{theta, v}](V 가중), nWl, note } — 파장별 BSDF(3열 파장·각도·값 순서 무관, 또는 표: 머리글 = 파장|각도)
export function readMeasTxt(text, { spd = null } = {}) {
  const { head, rows } = parseNumericTable(text);
  if (!rows.length) throw new Error('숫자 데이터가 없음');
  // 표 형식: 머리글 숫자가 있거나 열이 3개 넘음
  if (head && head.length === rows[0].length - 1 || rows[0].length > 3) {
    const cols = head ?? rows[0].slice(1), body = head ? rows : rows.slice(1);
    const colsWl = cols.every(isWl), rowsWl = body.every((r) => isWl(r[0]));
    if (!colsWl && !rowsWl) throw new Error('표의 머리글·첫 열 중 하나는 파장(nm)이어야 함');
    const trip = [];
    for (const r of body) r.slice(1).forEach((v, k) => trip.push(colsWl ? { nm: cols[k], th: r[0], v } : { nm: r[0], th: cols[k], v }));
    return spectralBsdf(trip, spd);
  }
  if (rows[0].length === 3) {
    const c0 = rows.every((r) => isWl(r[0])), c1 = rows.every((r) => isWl(r[1]));
    if (!c0 && !c1) throw new Error('3열 파일: 파장(nm) 열이 없음');
    return spectralBsdf(rows.map((r) => (c0 ? { nm: r[0], th: r[1], v: r[2] } : { nm: r[1], th: r[0], v: r[2] })), spd);
  }
  const x = rows.map((r) => r[0]), y = rows.map((r) => r[1]);
  if (x.every(isWl) && Math.max(...x) - Math.min(...x) > 20) {
    const k = unitScale(y), points = rows.map((r) => ({ nm: r[0], v: r[1] * k })), a = photopicAverage(points, spd);
    return { kind: 'spectral', value: a.value, points, note: a.note, led: !!spd };
  }
  if (x.every(isAng)) return { kind: 'angle', curve: rows.map((r) => ({ theta: Math.abs(r[0]), v: r[1] })).sort((a, b) => a.theta - b.theta) };
  throw new Error('첫 열이 각도(°)나 파장(nm)이 아님');
}
// 파장·각도·값 → 각도별 V(λ) 가중 곡선
function spectralBsdf(trip, spd = null) {
  const byTh = new Map();
  for (const t of trip) { if (!Number.isFinite(t.v) || !isAng(t.th)) continue; const k = Math.abs(t.th); if (!byTh.has(k)) byTh.set(k, []); byTh.get(k).push({ nm: t.nm, v: t.v }); }
  if (!byTh.size) throw new Error('각도 값이 없음');
  let note = '';
  const curve = [...byTh.entries()].map(([theta, pts]) => { const a = photopicAverage(pts, spd); note ||= a.note; return { theta, v: a.value }; }).filter((p) => Number.isFinite(p.v)).sort((a, b) => a.theta - b.theta);
  return { kind: 'spectralBsdf', curve, nWl: new Set(trip.map((t) => t.nm)).size, note, led: !!spd };
}
// 사람이 읽는 한 줄 요약
export function measTxtSummary(r) {
  if (r.kind === 'angle') return `각도별 BSDF ${r.curve.length}점 (${r.curve[0].theta}~${r.curve[r.curve.length - 1].theta}°)`;
  if (r.kind === 'spectralBsdf') return `파장별 BSDF ${r.nWl}파장 × ${r.curve.length}각도 → ${r.led ? 'V(λ)×LED' : 'V(λ)'} 가중 각분포${r.note ? ` · ${r.note}` : ''}`;
  return `파장별 ${r.points.length}점 → ${r.led ? 'V(λ)×LED' : 'V(λ)'} 가중 ${Math.round(r.value * 1000) / 10}%${r.note ? ` · ${r.note}` : ''}`;
}
