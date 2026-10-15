// LED STEP 해석 — spec 2026-10-14 §4.1 (P3 설계 결정 1·2).
// 같은 LED = 회전 불변량(면 수 동일, 부피·표면적 ±1%, 중심 최대거리 ±0.05mm) 이 같은 솔리드.
// 발광면: 동일 인스턴스는 면 순서가 같으므로 기준 면 번호를 쓰고 기술자(면적·중심거리·법선각)로 검증, 불일치면 기술자 탐색.
import { meshVolume } from './mesh.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function triGeom(P, T, t) {
  const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return { area: len(n) / 2, n, c: [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3] };
}

const statsCache = new WeakMap();
export function meshStats(m) {
  if (statsCache.has(m)) return statsCache.get(m);
  const P = m.positions, T = m.triangles;
  let area = 0; const c = [0, 0, 0];
  for (let t = 0; t < T.length / 3; t++) { const g = triGeom(P, T, t); area += g.area; for (let k = 0; k < 3; k++) c[k] += g.area * g.c[k]; }
  for (let k = 0; k < 3; k++) c[k] /= area || 1;
  let rmax = 0;
  for (let i = 0; i < P.length; i += 3) rmax = Math.max(rmax, Math.hypot(P[i] - c[0], P[i + 1] - c[1], P[i + 2] - c[2]));
  const s = { area, volume: meshVolume(P, T), center: c, rmax, faceCount: m.faceCount };
  statsCache.set(m, s);
  return s;
}

// 면 정보: 면적, 면적 가중 중심, 바깥 법선(면적 가중 평균), 면 안 장축 방향(정점 2×2 주성분)
export function faceInfo(m, face) {
  const P = m.positions, T = m.triangles;
  let area = 0; const c = [0, 0, 0], n = [0, 0, 0], vs = [];
  for (let t = 0; t < T.length / 3; t++) {
    if (m.faceIds[t] !== face) continue;
    const g = triGeom(P, T, t);
    area += g.area;
    for (let k = 0; k < 3; k++) { c[k] += g.area * g.c[k]; n[k] += g.n[k] / 2; }
    for (let j = 0; j < 3; j++) { const v = T[t * 3 + j] * 3; vs.push([P[v], P[v + 1], P[v + 2]]); }
  }
  if (!area) return null;
  for (let k = 0; k < 3; k++) c[k] /= area;
  const nn = unit(n), r = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(sub(r, nn.map((x) => x * dot(r, nn)))), e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
  let sxx = 0, syy = 0, sxy = 0;
  for (const v of vs) { const d = sub(v, c), x = dot(d, e1), y = dot(d, e2); sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const xAxis = unit([Math.cos(th) * e1[0] + Math.sin(th) * e2[0], Math.cos(th) * e1[1] + Math.sin(th) * e2[1], Math.cos(th) * e1[2] + Math.sin(th) * e2[2]]);
  return { area, c, n: nn, xAxis };
}

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));

export function findLeds(parts, ref) {
  const s0 = meshStats(parts[ref]);
  const out = [];
  parts.forEach((p, i) => {
    const s = meshStats(p);
    if (s.faceCount === s0.faceCount && close(s.volume, s0.volume, 0.01) && close(s.area, s0.area, 0.01) && Math.abs(s.rmax - s0.rmax) <= 0.05) out.push(i);
  });
  return out;
}

export function pcbIndex(parts, leds) {
  const set = new Set(leds); let best = -1, bv = -Infinity;
  parts.forEach((p, i) => { if (set.has(i)) return; const v = meshStats(p).volume; if (v > bv) { bv = v; best = i; } });
  return best;
}

// 기준 LED(ref)의 발광면(face) → 인식된 LED 들의 발광 위치·축·가로축
export function findEmitters(parts, leds, ref, face) {
  const sRef = meshStats(parts[ref]), fRef = faceInfo(parts[ref], face);
  if (!fRef) throw new Error('발광면 정보를 읽을 수 없음');
  const dRef = len(sub(fRef.c, sRef.center)), aRef = dot(fRef.n, unit(sub(fRef.c, sRef.center)));
  const match = (st, fi) => fi && close(fi.area, fRef.area, 0.02) && Math.abs(len(sub(fi.c, st.center)) - dRef) <= 0.05 && Math.abs(dot(fi.n, unit(sub(fi.c, st.center))) - aRef) <= 0.02;
  return leds.map((i) => {
    const st = meshStats(parts[i]);
    let f = face, fi = faceInfo(parts[i], face);
    if (!match(st, fi)) {
      f = -1; fi = null;
      for (let k = 0; k < parts[i].faceCount; k++) { const c = faceInfo(parts[i], k); if (match(st, c)) { f = k; fi = c; break; } }
    }
    return f < 0 ? { part: i, face: -1, needsCheck: true } : { part: i, face: f, pos: fi.c, axis: fi.n, xAxis: fi.xAxis, needsCheck: false };
  });
}
