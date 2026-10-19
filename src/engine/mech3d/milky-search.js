// ① Milky 탐색 — spec P4 §2.1. 재가중 격자 지도(배치별) → 행 → 목표를 만족하는 최소 Milky(선형 보간).
import { tallyStats } from './tally.js';
import { ESS_MIN } from './reweight.js';

// 목표 여유: min(U길이 − 목표, U폭 − 목표). 폭 판정이 없으면(좁은 라인) 길이만
export const margin = (st, obs) => Math.min(st.Ulen - obs.targetLen, st.Uwid == null ? Infinity : st.Uwid - obs.targetWid);

// batches: 배치별 Float64Array(격자 수 × 셀), ess: 격자별 유효 표본 비율, emitted: 방출 총량(효율 분모)
// 반환 [{ milky, Ulen, Uwid, eff, ess, trusted, margin, map }]
export function milkyRows(G, obs, { milkies, batches, ess, emitted }) {
  const nCell = G.ns * G.nw;
  return milkies.map((m, j) => {
    const accs = batches.map((a) => a.subarray(j * nCell, (j + 1) * nCell));
    const st = tallyStats(G, accs, obs);
    let tot = 0; for (const a of accs) for (let k = 0; k < nCell; k++) tot += a[k];
    return { milky: m, Ulen: st.Ulen, Uwid: st.Uwid, eff: emitted > 0 ? tot / emitted : NaN, ess: ess[j], trusted: ess[j] >= ESS_MIN && !st.empty, margin: st.empty ? -Infinity : margin(st, obs), map: st.map, profile: st.profile };
  });
}

// 믿는 행에서 여유가 처음 0 이상이 되는 Milky(앞 행과 선형 보간). edge: 'low'(창 맨 아래부터 통과 — 더 낮게 볼 것) | 'high'(통과 없음 & 위로 여지) | null
export function pickMilky(rows, obs) {
  const R = rows.filter((r) => r.trusted);
  if (!R.length) return { feasible: false, best: null, milky: null, edge: null, reason: '믿을 수 있는 격자점이 없음 — 광자를 늘리세요' };
  const i = R.findIndex((r) => r.margin >= 0);
  if (i < 0) {
    const best = R.reduce((a, b) => (b.margin > a.margin ? b : a));
    return { feasible: false, best, milky: best.milky, edge: 'high', reason: `Milky ${best.milky}에서도 길이 U ${best.Ulen.toFixed(2)}${best.Uwid == null ? '' : ` · 폭 U ${best.Uwid.toFixed(2)}`} — 목표 ${obs.targetLen.toFixed(2)}${best.Uwid == null ? '' : ` / ${obs.targetWid.toFixed(2)}`} 미달` };
  }
  if (i === 0) return { feasible: true, best: R[0], milky: R[0].milky, edge: 'low', reason: '' };
  const a = R[i - 1], b = R[i], t = a.margin === b.margin ? 1 : -a.margin / (b.margin - a.margin);
  return { feasible: true, best: b, milky: Math.round((a.milky + t * (b.milky - a.milky)) * 100) / 100, edge: null, reason: '' };
}
