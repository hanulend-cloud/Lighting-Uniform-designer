// 추적용 장면 — spec 2026-10-14 §6.1. 런타임 메쉬(rt = runtime.getMech3d())와 사용자 지정(mspec = spec.mech3d)을 합친다.
import { partOptics } from './optics.js';
import { resolveFinish } from './materials.js';

export function buildTraceScene(rt, mspec, ctx) {
  if (!rt || mspec.parts.length !== rt.parts.length) throw new Error('3D 기구: 부품 지정과 메쉬의 부품 수가 다름');
  const { positions: P, triangles: T, partOf, faceOf } = rt.combined;
  const nT = T.length / 3, normals = new Float32Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3] = nx / l; normals[t * 3 + 1] = ny / l; normals[t * 3 + 2] = nz / l;
  }
  const optics = mspec.parts.map((p) => partOptics(p, ctx));
  const fins = [], key = new Map(), finOf = new Uint16Array(nT);
  for (let t = 0; t < nT; t++) {
    const f = resolveFinish(mspec.parts[partOf[t]], faceOf[t]), k = `${f.kind}|${f.R ?? ''}`;
    if (!key.has(k)) { key.set(k, fins.length); fins.push(f); }
    finOf[t] = key.get(k);
  }
  // 맞붙은 면(P1 감지): '접촉' = 광학 접촉(contact), '공기층' = 얇은 공기막(film). 양방향 조회.
  const contact = new Map(), film = new Map();
  for (const c of mspec.contacts ?? []) {
    const m = c.mode === 'contact' ? contact : c.mode === 'air' ? film : null;
    if (!m) continue;
    m.set(`${c.a}|${c.faceA}`, { part: c.b, face: c.faceB });
    m.set(`${c.b}|${c.faceB}`, { part: c.a, face: c.faceA });
  }
  const finishOfFace = (part, face) => resolveFinish(mspec.parts[part], face);
  return { P, T, partOf, faceOf, normals, bvh: rt.bvh, optics, fins, finOf, contact, film, finishOfFace };
}
