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
export function searchLeds({ G, obs, line, cand, maps, pitches = [0], pitchRange = null, nMax, emitted, milkies = null }) {
  const nCell = G.ns * G.nw, nJ = milkies ? milkies.length : 1, tried = [];
  let best = null;
  const better = (a, b) => !b || a.margin > b.margin || (a.margin === b.margin && a.eff > b.eff);
  for (let n = 1; n <= nMax; n++) {
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
        if (better(row, best)) best = row;
      }
    }
    if (hit) return { feasible: true, ...hit, reason: '', tried };
  }
  const b = best ?? { n: nMax, pitch: 0, j: 0, stats: null, eff: NaN, margin: -Infinity };
  const st = b.stats;
  return { feasible: false, ...b, n: nMax, tried, reason: `LED 최대 ${nMax}개에서도 길이 U ${st ? st.Ulen.toFixed(2) : '–'}${st?.Uwid == null ? '' : ` · 폭 U ${st.Uwid.toFixed(2)}`} — ${st && st.Uwid != null && st.Uwid - obs.targetWid < st.Ulen - obs.targetLen ? '폭 방향 확산 부족: ③ 형상 또는 Milky 상향 권장' : '길이 방향 리플: Milky 상향 또는 LED–커버 거리 확대 권장'}` };
}
