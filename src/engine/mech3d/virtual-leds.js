// LED STEP 가상 배치 — spec P4 §2.2a. 기준 LED(제외 안 된 첫 LED)의 몸체·발광점을 관측 라인 위 개수·피치 위치로 복사한다.
// 라인 좌표 (s, w, h) 중 w·h 는 기준 값 유지, 접선 각 차이만큼 관측 방향 d 축으로 회전. 원래 LED 몸체(제외 포함)는 빼고 PCB·기타는 유지.
// parts: LED STEP 부품(월드 좌표 = offset·rot 적용 뒤), step: light.step, 반환 { parts, leds, pcb, emitters, ref }
import { ledSPositions } from './placement.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// 점 p 를 점 c 를 지나는 단위축 k 둘레로 각 a 만큼(Rodrigues)
export function rotateAbout(p, c, k, a) {
  const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], cs = Math.cos(a), sn = Math.sin(a), kd = dot(k, v);
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => c[i] + v[i] * cs + x[i] * sn + k[i] * kd * (1 - cs));
}
const rotDir = (d, k, a) => rotateAbout(d, [0, 0, 0], k, a);
const angle = (line, s) => { const [tx, ty] = line.tangentAt(s); return Math.atan2(ty, tx); };

export function virtualLayout({ parts, step, line, count, pitch = 0 }) {
  const ex = new Set(step.excluded ?? []), em = (step.emitters ?? []).find((e) => !e.needsCheck && !ex.has(e.part));
  if (!em) throw new Error('가상 배치: 기준이 될 LED 가 없음 — LED 발광면을 먼저 지정하세요');
  const ref = em.part, body = parts[ref], F = line.frame;
  const [x0, y0] = line.to2D(em.pos), [s0, w0] = line.toSW(x0, y0), base0 = line.to3D(x0, y0, 0);
  const h0 = dot([em.pos[0] - base0[0], em.pos[1] - base0[1], em.pos[2] - base0[2]], F.d), a0 = angle(line, s0);
  const ledSet = new Set(step.leds ?? []), keep = [], idx = new Map();
  parts.forEach((m, i) => { if (!ledSet.has(i)) { idx.set(i, keep.length); keep.push(m); } });
  const out = { parts: keep.slice(), leds: [], pcb: step.pcb >= 0 && idx.has(step.pcb) ? idx.get(step.pcb) : -1, emitters: [], ref };
  for (const s of ledSPositions(line, count, pitch)) {
    const [x, y] = line.fromSW(s, w0), p = line.to3D(x, y, h0), da = angle(line, s) - a0;
    const P = body.positions, Q = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const r = rotateAbout([P[i], P[i + 1], P[i + 2]], em.pos, F.d, da);
      Q[i] = r[0] - em.pos[0] + p[0]; Q[i + 1] = r[1] - em.pos[1] + p[1]; Q[i + 2] = r[2] - em.pos[2] + p[2];
    }
    const { bvh, ...rest } = body, k = out.parts.length;
    out.parts.push({ ...rest, positions: Q });
    out.leds.push(k);
    out.emitters.push({ part: k, s, pos: p, axis: rotDir(em.axis, F.d, da), xAxis: em.xAxis ? rotDir(em.xAxis, F.d, da) : em.xAxis });
  }
  return out;
}

// 원래/가상 배치를 하나로(순수) — step.virtual = { count, pitch } | null. line 이 없으면 원래 배치로 대신.
// 가상인데 기준 LED 가 없으면 원래 배치 + err. 반환 { parts, leds, pcb, excluded, emitters, virtual, ref?, err? }
export function stepLayoutOf({ parts, step, line }) {
  const ex = new Set(step.excluded ?? []), v = step.virtual ?? null;
  const orig = () => ({ parts, leds: step.leds ?? [], pcb: step.pcb ?? -1, excluded: step.excluded ?? [], emitters: (step.emitters ?? []).filter((e) => !e.needsCheck && !ex.has(e.part)), virtual: null });
  if (!v || !line) return orig();
  try {
    const r = virtualLayout({ parts, step, line, count: v.count, pitch: v.pitch });
    return { parts: r.parts, leds: r.leds, pcb: r.pcb, excluded: [], emitters: r.emitters, virtual: v, ref: r.ref };
  } catch (e) { return { ...orig(), err: e.message }; }
}
