// ② LED 배치 Solver — spec docs/superpowers/specs/2026-10-20-led-layout-solver-design.md
// 후보 지도(방출 1 기준, (s, w) 격자) 를 더해 배치를 즉시 평가. 총 LED 수 오름차순 → 같은 총수면 1열 → 2열,
// 열당 개수 n 마다 단계식: 1 같은 피치 + 끝 여백 → 2 끝 압축 → 3 자유 위치(대칭 쌍 좌표 하강). 앞 단계 통과면 멈춤.
import { layoutMap2, nearestRow } from './basis.js';
import { tallyStats } from './tally.js';
import { margin } from './milky-search.js';

export const SNAP = 0.25;   // 라인 가운데 기준 격자(대칭 쌍 간격 = 0.5 mm 단위)
const KIND_ORDER = { uniform: 0, endCompress: 1, free: 2 };
const RATIOS = [0.15, 0.3, 0.45, 0.6], HOPELESS = -0.12, FREE_STEPS = [2, 1, 0.5], FREE_ROUNDS = 6;

const snapS = (s, L) => L / 2 + Math.round((s - L / 2) / SNAP) * SNAP;
const better = (a, b) => !b || a.margin > b.margin + 1e-9 || (Math.abs(a.margin - b.margin) <= 1e-9 && a.eff > b.eff);
// m = 라인 양 끝 여유(LED 몸체 반폭 + 틈 — 끝벽 간섭 방지)
const okGaps = (ss, minGap, L, m = 0) => ss.every((s, i) => s >= m - 1e-9 && s <= L - m + 1e-9 && (i === 0 || s - ss[i - 1] >= minGap - 1e-9));

// 열린 라인 같은 피치: 끝 여백 e(첫 LED s), 가운데 대칭
export function uniformPositions(L, n, e) {
  if (n === 1) return [L / 2];
  const p = (L - 2 * e) / (n - 1);
  return Array.from({ length: n }, (_, i) => e + i * p);
}
// 끝 압축: 간격 g_k ∝ 1 − a·t_k², t_k = 가운데에서 떨어진 정도(0~1), 합 = L − 2e
export function compressedPositions(L, n, e, a) {
  if (n < 3) return uniformPositions(L, n, e);
  const h = (n - 2) / 2, w = Array.from({ length: n - 1 }, (_, k) => 1 - a * (h > 0 ? Math.abs(k - h) / h : 0) ** 2), tot = w.reduce((x, y) => x + y, 0), sc = (L - 2 * e) / tot;
  const out = [e]; for (const g of w) out.push(out[out.length - 1] + g * sc);
  return out;
}
const gapsText = (ss) => { if (ss.length < 2) return ''; const g = ss.slice(1).map((s, i) => s - ss[i]); return [g[Math.floor((g.length - 1) / 2)], g[0]].map((x) => x.toFixed(1)); };
// 결과 한 줄 문구(비교표·이유)
export function layoutText(r) {
  const head = r.rows === 2 ? `2열 × ${r.n}개` : `${r.n}개`, ss = [...new Set(r.positions.map((q) => q.s))].sort((a, b) => a - b);
  if (r.kind === 'uniform') return `${head} 같은 피치 ${ss.length > 1 ? (ss[1] - ss[0]).toFixed(1) : '–'} mm${r.rows === 2 ? ` (열 간격 ±${r.rowGap.toFixed(1)} mm)` : ''}`;
  const [c, e] = gapsText(ss);
  return `${head} ${r.kind === 'endCompress' ? '끝 압축' : '자유 배치'} ${c ?? '–'}→${e ?? '–'} mm${r.rows === 2 ? ` (열 간격 ±${r.rowGap.toFixed(1)} mm)` : ''}`;
}

// 반환 { feasible, n, rows, rowGap, total, positions:[{s,w}], kind, pitch, endMargin, ratio, stats, eff, margin, reason, alts:[…], evals }
// safety = 통과 판정 여유(기저 추정은 광자 잡음이 있어 검증에서 0 근처 통과가 뒤집힘 — 이만큼 넘는 배치만 통과로 봄)
export function solveLayout({ G, obs, line, cand, maps, rowsOptions = [1, 2], gaps = [], nMax, emitted = 1, minGap = 2, pitchRange = null, timeBudget = 20000, now = () => Date.now(), safety = 0, sMargin = 0 }) {
  const sm = line.closed ? 0 : Math.max(0, sMargin);   // 끝 여유: 첫·끝 LED 중심 ≥ sm(몸체가 끝벽에 닿지 않게)
  const L = line.length, closed = !!line.closed, nCell = G.ns * G.nw, t0 = now(), RO = [...new Set(rowsOptions)].sort((a, b) => a - b);
  const gMin = Math.max(minGap, pitchRange?.min ?? 0);
  let evals = 0;
  const ev = (ss, rows, g, kind, extra = {}) => {
    const ws = rows === 2 ? [-g, g] : [0], pos = ss.flatMap((s) => ws.map((w) => ({ s, w })));
    const sum = layoutMap2(cand, maps, pos, { closed, L, len: nCell }), st = tallyStats(G, [sum], obs);
    evals++;
    if (st.empty) return null;
    let tot = 0; for (let k = 0; k < nCell; k++) tot += sum[k];
    const ss2 = [...ss];
    return { n: ss.length, rows, rowGap: rows === 2 ? g : 0, total: pos.length, positions: pos, ss: ss2, kind, stats: st, eff: tot / (emitted * pos.length), margin: margin(st, obs), pitch: 0, endMargin: null, ratio: null, ...extra };
  };
  // 단계 1: 같은 피치(끝 여백 격자 1 mm → 최고점 ±1 mm 를 0.25 mm) · 닫힌 라인 = L/n 균등(시작 위치 4개)
  function stage1(n, rows, g) {
    let best = null;
    if (closed) {
      for (let k = 0; k < 4; k++) { const s0 = (k * L) / (4 * n), r = ev(Array.from({ length: n }, (_, i) => snapS(s0 + (i * L) / n, L) % L).sort((a, b) => a - b), rows, g, 'uniform', { pitch: 0 }); if (r && better(r, best)) best = r; }
      return best;
    }
    if (n === 1) return ev([snapS(L / 2, L)], rows, g, 'uniform', { pitch: 0, endMargin: L / 2 });
    let eLo = sm, eHi = (L - (n - 1) * gMin) / 2;
    if (pitchRange) { eLo = Math.max(eLo, (L - (n - 1) * pitchRange.max) / 2); eHi = Math.min(eHi, (L - (n - 1) * pitchRange.min) / 2); }
    if (eHi < eLo - 1e-9) return null;
    const tryE = (e) => { const ss = uniformPositions(L, n, e).map((s) => snapS(s, L)); if (!okGaps(ss, gMin, L, sm)) return; const r = ev(ss, rows, g, 'uniform', { pitch: +(ss[1] - ss[0]).toFixed(2), endMargin: ss[0] }); if (r && better(r, best)) best = r; };
    for (let e = eLo; e <= eHi + 1e-9; e += 1) tryE(e);
    tryE(eHi);
    if (best) { const c = best.endMargin; for (let e = Math.max(eLo, c - 1); e <= Math.min(eHi, c + 1) + 1e-9; e += SNAP) tryE(e); }
    return best;
  }
  // 단계 2: 끝 압축(열린 라인, n ≥ 4) — 비율 a × 끝 여백 격자(1 mm)
  function stage2(n, rows, g) {
    if (closed || n < 4) return null;
    let best = null;
    for (const a of RATIOS) for (let e = sm; e <= L / 2; e += 1) {
      const ss = compressedPositions(L, n, e, a).map((s) => snapS(s, L));
      if (!okGaps(ss, gMin, L, sm)) continue;
      const r = ev(ss, rows, g, 'endCompress', { endMargin: ss[0], ratio: a });
      if (r && better(r, best)) best = r;
    }
    return best;
  }
  // 단계 3: 자유 위치 — 대칭 쌍(i, n−1−i)을 ±δ 로 옮겨 여유가 좋아지면 받아들임(열린 라인)
  function stage3(start, rows, g) {
    if (closed || !start || start.n < 2) return null;
    let cur = { ...start, kind: 'free' }, ss = [...start.ss];
    const n = ss.length;
    for (let round = 0; round < FREE_ROUNDS; round++) {
      let moved = false;
      for (const dl of FREE_STEPS) for (let i = 0; i < Math.floor(n / 2); i++) for (const sg of [-1, 1]) {
        const tr = ss.slice(); tr[i] = snapS(tr[i] + sg * dl, L); tr[n - 1 - i] = snapS(L - tr[i], L);
        if (!okGaps(tr, gMin, L, sm)) continue;
        const r = ev(tr, rows, g, 'free', { endMargin: tr[0] });
        if (r && better(r, cur)) { cur = r; ss = tr; moved = true; }
      }
      if (!moved || now() - t0 > timeBudget) break;
    }
    return cur.ss === start.ss ? null : cur;
  }
  function solveN(n, rows, g) {
    const s1 = stage1(n, rows, g);
    if (!s1 || s1.margin >= safety || s1.margin < HOPELESS + safety || now() - t0 > timeBudget) return s1;
    const s2 = stage2(n, rows, g);
    if (s2 && s2.margin >= safety) return s2;
    const s3 = stage3(better(s2 ?? s1, s1) && s2 ? s2 : s1, rows, g);
    return [s1, s2, s3].filter(Boolean).reduce((a, b) => (better(b, a) ? b : a));
  }
  const rank = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.margin - a.margin || b.eff - a.eff;
  let found = null, foundT = 0, timedOut = false;
  const pass = [], miss = [], spare = [];
  for (let T = 1; T <= nMax; T++) {
    if (found && T > foundT + 1) break;
    if (now() - t0 > timeBudget) { timedOut = true; break; }
    const atT = [];
    for (const rows of RO) {
      if (T % rows) continue;
      if (!found && atT.some((r) => r.rows < rows)) break;   // 같은 총수: 1열 통과면 2열은 안 봄
      for (const g of rows === 1 ? [0] : gaps) { const r = solveN(T / rows, rows, g); if (r) (r.margin >= safety ? atT : miss).push(r); }
    }
    atT.sort(rank);
    if (!found && atT.length) { found = atT[0]; foundT = T; pass.push(...atT.slice(1)); }
    else if (found) spare.push(...atT);
  }
  const strip = ({ ss, ...r }) => r;
  if (found) return { feasible: true, ...strip(found), reason: '', alts: [...pass, ...spare].slice(0, 2).map(strip), evals };
  const b0 = nearestRow(miss.map((r) => ({ ...r, nRow: r.n, n: r.total, j: r.rows - 1 })), obs, nMax);
  if (b0.nRow == null) return { feasible: false, n: nMax, rows: 1, rowGap: 0, total: nMax, positions: [], kind: 'uniform', pitch: 0, stats: null, eff: NaN, margin: -Infinity, reason: '평가할 수 있는 배치가 없음 — 관측면·LED 를 확인하세요', alts: [], evals };
  const b = strip({ ...b0, n: b0.nRow }); delete b.nRow; delete b.j;
  const st = b.stats, wid = st?.Uwid != null && st.Uwid - obs.targetWid < st.Ulen - obs.targetLen;
  const reason = `${timedOut ? '시간 제한 안에서' : `LED 총 ${nMax}개까지`} 배치를 바꿔도 목표 미달 — 가장 가까운 ${layoutText(b)}: 길이 U ${st.Ulen.toFixed(2)}${st.Uwid == null ? '' : ` · 폭 U ${st.Uwid.toFixed(2)}`} — ${wid ? '폭 방향 확산 부족: ③ 형상 또는 Milky 상향 권장' : '길이 방향 리플·끝 어두움: Milky 상향 또는 LED–커버 거리 확대 권장'}`;
  return { feasible: false, ...b, reason, alts: [], evals };
}
