// ① Milky 탐색 — spec P4 §2.1. 재가중 격자 지도(배치별) → 행 → 목표를 만족하는 최소 Milky(선형 보간).
import { tallyStats, windowProfile } from './tally.js';
import { ESS_MIN } from './reweight.js';

// 목표 여유: min(U길이 − 목표, U폭 − 목표). 폭 판정이 없으면(좁은 라인) 길이만
export const margin = (st, obs) => Math.min(st.Ulen - obs.targetLen, st.Uwid == null || obs.targetWid == null ? Infinity : st.Uwid - obs.targetWid);

// 프로파일 최저 칸의 위치 — 유효(유한) 범위 안 0~1(칸 하나면 0.5). 값 없으면 null
export function darkFrac(p) {
  let a = -1, b = -1, k = -1;
  for (let i = 0; i < p.length; i++) if (Number.isFinite(p[i])) { if (a < 0) a = i; b = i; if (k < 0 || p[i] < p[k]) k = i; }
  return k < 0 ? null : b > a ? (k - a) / (b - a) : 0.5;
}
// batches: 배치별 Float64Array(격자 수 × 셀), ess: 격자별 유효 표본 비율, emitted: 방출 총량(효율 분모)
// 반환 [{ milky, Ulen, Uwid, eff, ess, trusted, margin, map, profile, dark }] — dark = 가장 어두운 위치 { len(닫힌 경로 null), wid(최악 창, 좁은 라인 null) } 0~1
export function milkyRows(G, obs, { milkies, batches, ess, emitted }) {
  const nCell = G.ns * G.nw;
  return milkies.map((m, j) => {
    const accs = batches.map((a) => a.subarray(j * nCell, (j + 1) * nCell));
    const st = tallyStats(G, accs, obs);
    const sum = new Float64Array(nCell);
    let tot = 0; for (const a of accs) for (let k = 0; k < nCell; k++) { tot += a[k]; sum[k] += a[k]; }
    const dark = st.empty ? null : { len: G.closed ? null : darkFrac(st.profile), wid: st.win ? darkFrac(windowProfile(G, sum, st.win[0], st.win[1])) : null };
    return { milky: m, Ulen: st.Ulen, Uwid: st.Uwid, eff: emitted > 0 ? tot / emitted : NaN, ess: ess[j], trusted: ess[j] >= ESS_MIN && !st.empty, margin: st.empty ? -Infinity : margin(st, obs), map: st.map, profile: st.profile, dark };
  });
}

// 믿는 행에서 여유가 처음 0 이상이 되고 다음 믿는 행도 0 이상인 Milky(원 격자 이웃인 앞 행과 선형 보간). edge: 'low'(창 맨 아래부터 통과 — 더 낮게 볼 것) | 'high'(통과 없음 & 위로 여지) | null
export function pickMilky(rows, obs) {
  const R = rows.filter((r) => r.trusted), ix = R.map((r) => rows.indexOf(r));
  if (!R.length) return { feasible: false, best: null, milky: null, edge: null, reason: '믿을 수 있는 격자점이 없음 — 광자를 늘리세요' };
  const i = R.findIndex((r, k) => r.margin >= 0 && (k + 1 >= R.length || R[k + 1].margin >= 0));   // 통과가 이어져야 함(단발 잡음 무시)
  if (i < 0) {
    const best = R.reduce((a, b) => (b.margin > a.margin ? b : a));
    return { feasible: false, best, milky: best.milky, edge: 'high', reason: `Milky ${best.milky}에서도 길이 균일도 ${best.Ulen.toFixed(2)}${best.Uwid == null ? '' : ` · 폭 균일도 ${best.Uwid.toFixed(2)}`} — 목표 ${obs.targetLen.toFixed(2)}${best.Uwid == null ? '' : ` / ${obs.targetWid.toFixed(2)}`} 미달` };
  }
  if (i === 0) return { feasible: true, best: R[0], milky: R[0].milky, edge: 'low', reason: '' };
  if (ix[i] - ix[i - 1] !== 1) return { feasible: true, best: R[i], milky: R[i].milky, edge: null, reason: '' };   // 원 격자에서 이웃이 아니면 보간 안 함
  const a = R[i - 1], b = R[i], t = a.margin === b.margin ? 1 : -a.margin / (b.margin - a.margin);
  return { feasible: true, best: b, milky: Math.round((a.milky + t * (b.milky - a.milky)) * 100) / 100, edge: null, reason: '' };
}
