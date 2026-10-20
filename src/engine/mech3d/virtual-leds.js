// LED STEP 가상 배치 — spec P4 §2.2a. 기준 LED(제외 안 된 첫 LED)의 몸체·발광점을 관측 라인 위 개수·피치 위치로 복사한다.
// 라인 좌표 (s, w, h) 중 w·h 는 기준 값 유지, 접선 각 차이만큼 관측 방향 d 축으로 회전. 원래 LED 몸체(제외 포함)는 빼고 PCB·기타는 유지.
// parts: LED STEP 부품(월드 좌표 = offset·rot 적용 뒤), step: light.step, 반환 { parts, leds, pcb, emitters, ref }
import { ledSPositions, clampRowGap, rowOffsets, wrapS } from './placement.js';
import { adjustEmitters, adjustBodies } from './led-adjust.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// 점 p 를 점 c 를 지나는 단위축 k 둘레로 각 a 만큼(Rodrigues)
export function rotateAbout(p, c, k, a) {
  const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], cs = Math.cos(a), sn = Math.sin(a), kd = dot(k, v);
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => c[i] + v[i] * cs + x[i] * sn + k[i] * kd * (1 - cs));
}
const rotDir = (d, k, a) => rotateAbout(d, [0, 0, 0], k, a);
const angle = (line, s) => { const [tx, ty] = line.tangentAt(s); return Math.atan2(ty, tx); };

// 가상 배치 기준 발광점 — 확인 필요·제외가 아닌 첫 발광점(엔진·UI 공통 규칙). 없으면 null
export function stepRefEmitter(step) {
  const ex = new Set(step?.excluded ?? []);
  return (step?.emitters ?? []).find((e) => !e.needsCheck && !ex.has(e.part)) ?? null;
}
// count 0 = LED 몸체 없는 부품만(자동설계 ② 후보 지도). positions = s 또는 {s, w}(w = 기준 w0 에서의 오프셋) 목록을 직접(개수·피치·열 대신),
// bodies false = 발광점만(part null). rows 2 → 같은 s 에 w0 − δ, w0 + δ(spec P4 §2.2b).
// adjust = ledAdjust.items | null — 번호(배치 순서) k 의 LED 를 s+ds, 높이 h0+dz 로(spec m3-cad-ui §4a). 발광점 led = 번호
export function virtualLayout({ parts, step, line, count, pitch = 0, positions = null, bodies = true, rows = 1, rowGap = 0, adjust = null }) {
  const em = stepRefEmitter(step);
  if (!em) throw new Error('가상 배치: 기준이 될 LED 가 없음 — LED 발광면을 먼저 지정하세요');
  const ref = em.part, body = parts[ref], F = line.frame;
  const [x0, y0] = line.to2D(em.pos), [s0, w0] = line.toSW(x0, y0), base0 = line.to3D(x0, y0, 0);
  const h0 = dot([em.pos[0] - base0[0], em.pos[1] - base0[1], em.pos[2] - base0[2]], F.d), a0 = angle(line, s0);
  const ledSet = new Set(step.leds ?? []), keep = [], idx = new Map();
  parts.forEach((m, i) => { if (!ledSet.has(i)) { idx.set(i, keep.length); keep.push(m); } });
  const out = { parts: keep.slice(), leds: [], pcb: step.pcb >= 0 && idx.has(step.pcb) ? idx.get(step.pcb) : -1, emitters: [], ref };
  const ws = rowOffsets(rows, rows === 2 ? clampRowGap(line, rowGap) : 0);
  const P0 = positions ? positions.map((q) => (typeof q === 'number' ? { s: q, w: 0 } : q)) : count === 0 ? [] : ledSPositions(line, count, pitch).flatMap((s) => ws.map((w) => ({ s, w })));
  for (const [k0, q] of P0.entries()) {
    const it = adjust?.[k0], s = it ? wrapS(line, q.s + it.ds) : q.s, dw = q.w;
    const [x, y] = line.fromSW(s, w0 + dw), p = line.to3D(x, y, h0 + (q.dz ?? 0) + (it ? it.dz : 0)),da = angle(line, s) - a0, e = { s, pos: p, axis: rotDir(em.axis, F.d, da), xAxis: em.xAxis ? rotDir(em.xAxis, F.d, da) : em.xAxis };
    if (!bodies) { out.emitters.push({ part: null, ...e }); continue; }
    const P = body.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const r = rotateAbout([P[i], P[i + 1], P[i + 2]], em.pos, F.d, da);
      Q[i] = r[0] - em.pos[0] + p[0]; Q[i + 1] = r[1] - em.pos[1] + p[1]; Q[i + 2] = r[2] - em.pos[2] + p[2];
    }
    const { bvh, ...rest } = body, k = out.parts.length;
    out.parts.push({ ...rest, positions: Q });
    out.leds.push(k);
    out.emitters.push({ part: k, led: k0, ...e });
  }
  return out;
}

// 기준 LED 발광점을 라인 위치 s 들로 옮긴 것(몸체 없음) — 자동설계 ② 후보마다 광원 하나
export const virtualEmittersAt = ({ parts, step, line, positions }) => virtualLayout({ parts, step, line, positions, bodies: false }).emitters;

// 원래/가상 배치를 하나로(순수) — step.virtual = { count, pitch, rows?, rowGap? } | null. line 이 없으면 원래 배치로 대신.
// 가상인데 기준 LED 가 없으면 원래 배치 + err. adjust = ledAdjust.items(validAdjust) | null — 원래 배치는 line 이 있어야 적용.
// 반환 { parts, leds, pcb, excluded, emitters(led = 번호), virtual, adjusted, ref?, err? } — adjusted 면 parts 는 조정 반영(월드 좌표)
export function stepLayoutOf({ parts, step, line, adjust = null }) {
  const ex = new Set(step.excluded ?? []), v = step.virtual ?? null, leds = step.leds ?? [];
  const orig = (adj = adjust) => {
    const em = (step.emitters ?? []).filter((e) => !e.needsCheck && !ex.has(e.part)).map((e) => ({ ...e, led: leds.indexOf(e.part) }));
    const r = { parts, leds, pcb: step.pcb ?? -1, excluded: step.excluded ?? [], emitters: em, virtual: null, adjusted: false };
    if (!adj || !line || !Object.keys(adj).length) return r;
    return { ...r, parts: adjustBodies(parts, leds, adj, line, line.frame.d, em), emitters: adjustEmitters(em, adj, line, line.frame.d), adjusted: true };
  };
  if (!v || !line) return orig();
  try {
    // v = { count, pitch, rows?, rowGap? }(자동설계 ② 의 균등 배치) | { positions:[{s,w,dz}] }(STEP 에서 편집한 배치, led-edit.js)
    const r = Array.isArray(v.positions) ? virtualLayout({ parts, step, line, positions: v.positions, adjust })
      : virtualLayout({ parts, step, line, count: v.count, pitch: v.pitch, rows: v.rows ?? 1, rowGap: v.rowGap ?? 0, adjust });
    return { parts: r.parts, leds: r.leds, pcb: r.pcb, excluded: [], emitters: r.emitters, virtual: v, adjusted: !!adjust && Object.keys(adjust).length > 0, ref: r.ref };
  } catch (e) { return { ...orig(null), err: e.message }; }   // 조정은 가상 배치 번호 기준 → 원래 배치에는 적용 안 함
}
