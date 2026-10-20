// LED STEP 배치 편집 — 불러온 STEP 배치에서 시작해 LED 추가·삭제·같은 간격·이동(spec m3-cad-ui §4b).
// 편집한 배치 = step.virtual = { positions: [{ s, w, dz }] } — w·dz 는 기준 LED(stepRefEmitter) 대비 폭·높이 오프셋(mm).
// 그리기는 virtualLayout(positions) 가 기준 LED 몸체·발광점을 각 위치로 복사. 배열 순서 = LED 번호(s 오름차순, 같은 s 면 w).
import { stepRefEmitter } from './virtual-leds.js';
import { wrapS } from './placement.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const TOL = 0.05;   // 같은 자리(열 묶음) 판정 mm
export const isPositionsLayout = (v) => !!v && Array.isArray(v.positions);
const sortP = (P) => P.slice().sort((a, b) => a.s - b.s || a.w - b.w);

// 발광점 위치 → 라인 좌표 (s, w, 높이 h)
function swh(line, pos) {
  const [x, y] = line.to2D(pos), [s, w] = line.toSW(x, y), b = line.to3D(x, y, 0);
  return { s, w, h: dot([pos[0] - b[0], pos[1] - b[1], pos[2] - b[2]], line.frame.d) };
}
// 지금 배치(stepLayoutOf 결과 — 제외·개별 조정 반영)를 위치 목록으로. step = light.step(기준 LED 를 정함)
// omit = 뺄 LED 번호(e.led) | null — 삭제
export function positionsFromLayout(lay, step, line, omit = null) {
  const ref = stepRefEmitter(step);
  if (!ref) throw new Error('기준이 될 LED 가 없음 — LED 발광면을 먼저 지정하세요');
  const r = swh(line, ref.pos);
  return sortP(lay.emitters.filter((e, i) => omit == null || (e.led ?? i) !== omit).map((e) => { const q = swh(line, e.pos); return { s: q.s, w: q.w - r.w, dz: q.h - r.h }; }));
}
// 같은 자리(s 차 ≤ TOL)끼리 묶음 — 2열이면 한 묶음에 2개
function groups(P) {
  const out = [];
  for (const q of sortP(P)) { const g = out[out.length - 1]; if (g && Math.abs(q.s - g.s) <= TOL) g.items.push(q); else out.push({ s: q.s, items: [q] }); }
  return out;
}
const avgDz = (g) => g.items.reduce((t, q) => t + q.dz, 0) / g.items.length;
// 추가: 가장 넓은 틈 가운데(열린 라인 = 이웃 LED 사이 틈과 라인 끝 여백 중, 닫힌 라인 = 이음매 넘는 틈 포함).
// 새 자리 = 가까운 묶음의 열(w) 마다 하나, 높이 = 양옆 평균. 반환 { positions(새 배열), index(새 LED 중 첫 번호) }
export function addPosition(P, line) {
  const G = groups(P), L = line.length;
  if (!G.length) { const positions = [{ s: line.closed ? 0 : L / 2, w: 0, dz: 0 }]; return { positions, index: 0 }; }
  let best = null;
  const cand = (len, s, a, b) => { if (!best || len > best.len + 1e-9) best = { len, s, a, b }; };
  for (let i = 0; i + 1 < G.length; i++) cand(G[i + 1].s - G[i].s, (G[i].s + G[i + 1].s) / 2, G[i], G[i + 1]);
  if (line.closed) { const a = G[G.length - 1], b = G[0]; cand(b.s + L - a.s, wrapS(line, (a.s + b.s + L) / 2), a, b); }
  else { cand(G[0].s, G[0].s / 2, G[0], G[0]); const z = G[G.length - 1]; cand(L - z.s, (z.s + L) / 2, z, z); }
  const dz = (avgDz(best.a) + avgDz(best.b)) / 2, near = Math.abs(best.a.s - best.s) <= Math.abs(best.b.s - best.s) ? best.a : best.b;
  const add = near.items.map((q) => ({ s: best.s, w: q.w, dz }));
  const positions = sortP([...P, ...add]);
  return { positions, index: positions.findIndex((q) => Math.abs(q.s - best.s) <= 1e-9) };
}
// 삭제: 번호 i 하나(새 배열)
export const removePosition = (P, i) => P.filter((_, k) => k !== i);
// 같은 간격: 개수(묶음)·열·높이 그대로, 자리만 균등. 열린 라인 = 양 끝 LED 고정 · 닫힌 라인 = 첫 LED 부터 L/n
export function alignPositions(P, line) {
  const G = groups(P), n = G.length;
  if (n < 2) return sortP(P);
  const s0 = G[0].s, step = line.closed ? line.length / n : (G[n - 1].s - s0) / (n - 1);
  return sortP(G.flatMap((g, i) => g.items.map((q) => ({ ...q, s: line.closed ? wrapS(line, s0 + i * step) : s0 + i * step }))));
}
