// ② LED 개수·피치 — spec P4 §2.2. 후보 위치(1mm)마다 LED 1개의 관측 지도를 추적해 두고, (개수, 피치) 지도 = 위치별 지도 합(사이 위치는 이웃 두 후보 선형 보간).
// 빛은 선형 중첩이므로 보간 외에는 근사가 없다. 우선순위: 목표 만족 → 최소 개수 → (① 이 켜져 있으면) 최소 Milky → 효율.
import { ledSPositions } from './placement.js';
import { tallyStats } from './tally.js';
import { margin } from './milky-search.js';

export function candidatePositions(line, step = 1) {
  const L = line.length;
  if (line.closed) { const n = Math.max(1, Math.round(L / step)); return Array.from({ length: n }, (_, i) => (i * L) / n); }
  const n = Math.max(1, Math.round(L / step));
  return Array.from({ length: n + 1 }, (_, i) => (i * L) / n);
}
// s → [[후보 번호, 가중]…] (1개 또는 2개)
export function interpWeights(cand, s, closed = false, L = cand.at(-1)) {
  const n = cand.length, step = closed ? L / n : cand[1] - cand[0];
  let f = s / step;
  if (closed) f = ((f % n) + n) % n;
  const i = Math.min(n - 1, Math.max(0, Math.floor(f))), t = f - i;
  if (t < 1e-9) return [[i, 1]];
  const j = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
  return [[i, 1 - t], [j, t]];
}
// 위치 목록 → 합 지도(Float64Array). maps[c]: 후보 c 의 지도(셀 배열, 같은 길이). off: 지도 안 시작 위치(격자 j 의 칸)
export function layoutMap(cand, maps, positions, { closed = false, L, off = 0, len = maps[0].length } = {}) {
  const out = new Float64Array(len);
  for (const s of positions) for (const [c, w] of interpWeights(cand, s, closed, L ?? cand.at(-1))) {
    const m = maps[c];
    for (let k = 0; k < len; k++) out[k] += w * m[off + k];
  }
  return out;
}
// 피치 후보: 0(균등) + 사용자 범위 [min,max] 1mm 간격 중 (n−1)·p ≤ L. 닫힌 라인은 균등만
export function pitchOptions(line, n, range = null) {
  const out = [0];
  if (line.closed || !range || n < 2) return out;
  for (let p = Math.ceil(range.min); p <= range.max; p++) if ((n - 1) * p <= line.length + 1e-9) out.push(p);
  return out;
}
// maps[c] 길이 = nJ·셀(격자 지도) 또는 셀. milkies 가 있으면 격자 j 마다 판정(가장 작은 통과 Milky 선택)
// 반환 { feasible, n, pitch, j, stats, eff, margin, reason, tried:[{n, pitch, j, margin, eff}] }
export const NEAR_TOL = 0.01;
// ② 목표 미달일 때 가장 가까운 행(순수) — rows = 미달 행 { n, pitch, j, stats, eff, margin }
export function nearestRow(rows, obs, nMax) {
  // 가장 가까운 안: 여유가 최고값에서 NEAR_TOL 안인 것 중 LED 가 가장 적은 것(우선순위 = 개수 최소) → 효율
  //   여유가 같으면(다른 쪽 — 보통 폭 — 이 막음) 길이 목표를 넘는 가장 적은 개수, 길이도 못 넘으면 길이 여유가 최고에 가까운 가장 적은 개수
  //   여유·길이 U 가 NaN 인 행은 뺌(비교가 모두 거짓이라 순위를 흐림) · 같은 개수면 낮은 Milky(j) → 효율
  const R = rows.filter((r) => Number.isFinite(r.margin) && Number.isFinite(r.stats?.Ulen));
  const top = R.reduce((m, r) => Math.max(m, r.margin), -Infinity), C = R.filter((r) => r.margin >= top - NEAR_TOL);
  const mL = (r) => r.stats.Ulen - obs.targetLen, bestL = C.reduce((m, r) => Math.max(m, mL(r)), -Infinity), needL = bestL >= 0 ? 0 : bestL - NEAR_TOL;
  return C.filter((r) => mL(r) >= needL).sort((a, c) => a.n - c.n || a.j - c.j || c.eff - a.eff)[0] ?? { n: nMax, pitch: 0, j: 0, stats: null, eff: NaN, margin: -Infinity };
}
// spare = 통과 개수 다음 몇 개까지 더 평가해 tried 에만 기록(결과 불변 — 최종 검증 실패 시 대안용)
export function searchLeds({ G, obs, line, cand, maps, pitches = [0], pitchRange = null, nMax, emitted = 1, milkies = null, spare = 0 }) {   // emitted = 후보 지도 1개의 방출(방출 1 기준 지도면 1)
  const nCell = G.ns * G.nw, nJ = milkies ? milkies.length : 1, tried = [], rows = [];
  let found = null;
  for (let n = 1; n <= nMax; n++) {
    if (found && n > found.n + spare) break;
    let hit = null;
    for (const p of pitchRange ? pitchOptions(line, n, pitchRange) : pitches) {
      let pos; try { pos = ledSPositions(line, n, p); } catch { continue; }
      for (let j = 0; j < nJ; j++) {
        const sum = layoutMap(cand, maps, pos, { closed: line.closed, L: line.length, off: j * nCell, len: nCell });
        const st = tallyStats(G, [sum], obs);
        if (st.empty) continue;
        let tot = 0; for (let k = 0; k < nCell; k++) tot += sum[k];
        const row = { n, pitch: p, j, stats: st, eff: tot / (emitted * n), margin: margin(st, obs) };   // emitted = 후보 LED 1개 방출 → n 개면 n 배
        tried.push({ n, pitch: p, j, margin: row.margin, eff: row.eff });
        if (row.margin >= 0) {
          // 같은 n 안에서: 더 작은 Milky(j 작을수록 낮음) → 효율
          if (!hit || row.j < hit.j || (row.j === hit.j && row.eff > hit.eff)) hit = row;
          break;   // 이 피치에서는 가장 낮은 통과 Milky 를 찾았음
        }
        rows.push(row);
      }
    }
    if (hit && !found) found = hit;
  }
  if (found) return { feasible: true, ...found, reason: '', tried };
  const b = nearestRow(rows, obs, nMax);
  const st = b.stats;
  return { feasible: false, ...b, tried, reason: `LED ${nMax}개까지 늘려도 목표 미달 — 가장 가까운 ${b.n}개: 길이 U ${st ? st.Ulen.toFixed(2) : '–'}${st?.Uwid == null ? '' : ` · 폭 U ${st.Uwid.toFixed(2)}`} — ${st && st.Uwid != null && st.Uwid - obs.targetWid < st.Ulen - obs.targetLen ? '폭 방향 확산 부족: ③ 형상 또는 Milky 상향 권장' : '길이 방향 리플: Milky 상향 또는 LED–커버 거리 확대 권장'}` };
}

// ── 폭 방향 열(spec P4 §2.2b): 후보 = (s, w) 격자, 보간은 같은 w 줄 안 s 방향만 ──
// 후보 격자: w 줄마다(wOffsets 순서) candidatePositions(sStep) → [{s, w}] (w 줄이 이어서 놓임)
export function candidateGrid(line, { sStep = 2, wOffsets = [0] } = {}) {
  const S = candidatePositions(line, sStep);
  return wOffsets.flatMap((w) => S.map((s) => ({ s, w })));
}
const W_TOL = 1e-9, rowsCache = new WeakMap();
// w 줄별 { w, s:[…], idx:[…] } (격자 순서대로)
function wLines(cand) {
  let R = rowsCache.get(cand);
  if (R) return R;
  R = [];
  cand.forEach(({ s, w }, i) => { let r = R.find((q) => Math.abs(q.w - w) < W_TOL); if (!r) R.push((r = { w, s: [], idx: [] })); r.s.push(s); r.idx.push(i); });
  rowsCache.set(cand, R);
  return R;
}
// 위치 [{s, w}] → 합 지도. w 는 후보 격자에 정확히 있는 값만(없으면 오류)
export function layoutMap2(cand, maps, positions, { closed = false, L, off = 0, len = maps[0].length } = {}) {
  const R = wLines(cand), out = new Float64Array(len);
  for (const { s, w } of positions) {
    const r = R.find((q) => Math.abs(q.w - w) < W_TOL);
    if (!r) throw new Error(`후보 격자에 w = ${w}mm 줄이 없음`);
    for (const [c, a] of interpWeights(r.s, s, closed, L ?? r.s.at(-1))) {
      const m = maps[r.idx[c]];
      for (let k = 0; k < len; k++) out[k] += a * m[off + k];
    }
  }
  return out;
}
// 열 수·열 간격·개수·피치 탐색: 총 LED 수 오름차순 → 같은 총수면 1열 먼저 → 그 안에서 여유 최고 → 효율. gaps = 2열 열 간격 δ 목록(±δ 가 격자에 있어야 함)
// nMax = 총 LED 상한. 반환 { feasible, n(열당), rows, rowGap, pitch, total, stats, eff, margin, reason, tried:[{rows, rowGap, n, pitch, total, margin, eff}] }
// spare = 통과 총수 다음 몇 개 총수까지 더 평가해 tried 에만 기록(결과 불변)
export function searchLeds2({ G, obs, line, cand, maps, rowsOptions = [1, 2], gaps = [], pitches = [0], pitchRange = null, nMax, emitted = 1, spare = 0 }) {   // emitted: searchLeds 와 같음
  const nCell = G.ns * G.nw, tried = [], miss = [], RO = [...new Set(rowsOptions)].sort((a, b) => a - b);
  let found = null;
  for (let T = 1; T <= nMax; T++) {
    if (found && T > found.total + spare) break;
    for (const rows of RO) {
      if (found && T === found.total) break;   // 통과 총수: 1열 통과면 2열은 안 봄(기존과 같음)
      if (T % rows) continue;
      const n = T / rows;
      let hit = null;
      for (const g of rows === 1 ? [0] : gaps) for (const p of pitchRange ? pitchOptions(line, n, pitchRange) : pitches) {
        let ss; try { ss = ledSPositions(line, n, p); } catch { continue; }
        const ws = rows === 2 ? [-g, g] : [0], pos = ss.flatMap((s) => ws.map((w) => ({ s, w })));
        const sum = layoutMap2(cand, maps, pos, { closed: line.closed, L: line.length, len: nCell });
        const st = tallyStats(G, [sum], obs);
        if (st.empty) continue;
        let tot = 0; for (let k = 0; k < nCell; k++) tot += sum[k];
        const row = { n, rows, rowGap: rows === 2 ? g : 0, pitch: p, total: T, stats: st, eff: tot / (emitted * T), margin: margin(st, obs) };
        tried.push({ rows, rowGap: row.rowGap, n, pitch: p, total: T, margin: row.margin, eff: row.eff });
        if (row.margin >= 0) { if (!hit || row.margin > hit.margin || (row.margin === hit.margin && row.eff > hit.eff)) hit = row; }
        else if (!found) miss.push(row);
      }
      if (hit && !found) found = hit;
    }
  }
  if (found) return { feasible: true, ...found, reason: '', tried };
  // 가장 가까운 안: nearestRow 를 총수(n 자리)·열 수(j 자리 = rows − 1 → 같은 총수면 1열 먼저)로
  const b0 = nearestRow(miss.map((r) => ({ ...r, nRow: r.n, n: r.total, j: r.rows - 1 })), obs, nMax);
  const b = b0.nRow == null ? { ...b0, n: nMax, rows: 1, rowGap: 0, total: nMax } : { ...b0, n: b0.nRow };
  delete b.nRow; delete b.j;
  const st = b.stats, lay = b.rows === 2 ? `2열 × ${b.n}개(±${b.rowGap.toFixed(1)}mm)` : `${b.total}개`;
  return { feasible: false, ...b, tried, reason: `LED 총 ${nMax}개까지 늘려도 목표 미달 — 가장 가까운 ${lay}: 길이 U ${st ? st.Ulen.toFixed(2) : '–'}${st?.Uwid == null ? '' : ` · 폭 U ${st.Uwid.toFixed(2)}`} — ${st && st.Uwid != null && st.Uwid - obs.targetWid < st.Ulen - obs.targetLen ? '폭 방향 확산 부족: ③ 형상 또는 Milky 상향 권장' : '길이 방향 리플: Milky 상향 또는 LED–커버 거리 확대 권장'}` };
}
