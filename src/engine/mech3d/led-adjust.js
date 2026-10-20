// LED 개별 조정 — spec 2026-10-15 m3-cad-ui §4a. light.ledAdjust = { layoutKey, items: { [LED 번호]: { ds, dz } } }
// LED 번호: 직접 배치·가상 배치 = 배치 순서, LED STEP 원래 = step.leds 안 위치(제외해도 번호 유지).
// 적용: 직접·가상 = s 를 s+ds 로 다시 놓고 높이 +dz(placement/virtual-leds 가 처리), STEP 원래 = 발광점·몸체를 접선 ds·관측 방향 dz 로 평행 이동(여기).
import { transformMesh } from './xform.js';
import { bounds } from './mesh.js';

// 번호를 정하는 것만 — 개수·피치·열(·간격)·PCB 종류 / STEP 파일·인식된 LED·가상 배치. 배광·광속·높이(depth·offset)·측면·제외는 무관
export function layoutKeyOf(light) {
  const k = light?.kind ?? 'none', rg = (o) => (o?.rows === 2 ? { rows: 2, rowGap: Number(o.rowGap) || 0 } : { rows: 1, rowGap: 0 });
  if (k === 'manual') {
    const m = light.manual ?? {}, p = m.pcb ?? {};
    return JSON.stringify({ kind: k, count: m.count ?? null, pitch: Number(m.pitch) || 0, ...rg(m), pcb: p.kind === 'face' ? { kind: 'face', part: p.part, face: p.face } : { kind: p.kind ?? null } });
  }
  if (k === 'step') {
    const s = light.step ?? {}, v = s.virtual;
    return JSON.stringify({ kind: k, name: s.name ?? null, leds: s.leds ?? [], virtual: v ? { count: v.count, pitch: Number(v.pitch) || 0, ...rg(v) } : null });
  }
  return JSON.stringify({ kind: k });
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function isAdjustWellFormed(a) {
  if (!a || typeof a !== 'object' || typeof a.layoutKey !== 'string' || !a.items || typeof a.items !== 'object' || Array.isArray(a.items)) return false;
  return Object.entries(a.items).every(([key, it]) => /^\d+$/.test(key) && it && isNum(it.ds) && isNum(it.dz));
}
// 현재 배치에 맞는 조정 items | null(없음·오래됨·형식 오류)
export function validAdjust(light) {
  const a = light?.ledAdjust;
  return isAdjustWellFormed(a) && a.layoutKey === layoutKeyOf(light) ? a.items : null;
}
// 조정이 있는데 배치가 바뀌어 무효 → UI 가 알리고 삭제
export const staleAdjust = (light) => light?.ledAdjust != null && validAdjust(light) === null;

// 위치 pos(그 LED 의 s 를 알면 s) 에서 이동 벡터: ds·접선(3D) + dz·d
export function shiftAt(line, d, pos, s, { ds = 0, dz = 0 }) {
  const ss = isNum(s) ? s : line.toSW(...line.to2D(pos))[0], [tx, ty] = line.tangentAt(ss), F = line.frame;
  const T = [0, 1, 2].map((k) => tx * F.u[k] + ty * F.v[k]), n = Math.hypot(...T) || 1;
  return [0, 1, 2].map((k) => (ds * T[k]) / n + dz * d[k]);
}
// 발광점 평행 이동(새 배열, 조정한 것만 새 객체). 번호 = e.led ?? 배열 위치
export function adjustEmitters(emitters, adj, line, d = line.frame.d) {
  if (!adj) return emitters;
  return emitters.map((e, i) => {
    const it = adj[e.led ?? i];
    if (!it || (!it.ds && !it.dz)) return e;
    const v = shiftAt(line, d, e.pos, e.s, it), o = { ...e, pos: e.pos.map((c, k) => c + v[k]) };
    if (isNum(e.s)) o.s = e.s + it.ds;
    return o;
  });
}
// LED 몸체 평행 이동(새 배열, PCB·조정 안 한 것은 같은 객체). leds[번호] = 부품 번호, 이동 벡터는 그 LED 발광점(없으면 몸체 중심) 기준
export function adjustBodies(parts, leds, adj, line, d = line.frame.d, emitters = []) {
  if (!adj) return parts;
  const out = parts.slice();
  for (const [key, it] of Object.entries(adj)) {
    const p = leds[+key];
    if (!(p >= 0) || !out[p] || (!it.ds && !it.dz)) continue;
    const e = emitters.find((x) => x.part === p), b = e ? null : bounds(parts[p].positions);
    out[p] = transformMesh(parts[p], shiftAt(line, d, e ? e.pos : [0, 1, 2].map((k) => (b[k] + b[k + 3]) / 2), e?.s, it));
  }
  return out;
}
