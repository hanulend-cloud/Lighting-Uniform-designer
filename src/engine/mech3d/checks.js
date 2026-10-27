// 설계 점검 4종 — spec 2026-10-15 m3-cad-ui §5. 순수 함수(Node 시험). 상태: 'ok' | 'warn' | 'bad' | 'na'(대상 없음).
// rt = 런타임 장면(getMech3d(): parts[{positions,triangles,faceIds,bvh}], combined{partOf}, bvh), mspec = spec.mech3d.
// 기하 점검(①②③)은 값이 바뀌면 바로, 새는 빛(④)은 점진 계산 결과(runChunk 의 leak)로 한다.
import { intersectRay, queryBox } from './bvh.js';
import { defaultChecks } from './defs.js';
import { isUntraced } from './scene3d.js';

const PARITY_DIR = [0.48, 0.6, 0.64];   // 단위 벡터, 축·대각과 어긋나게(모서리 스침 줄임)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isTrans = (mspec, q) => (mspec.parts[q]?.material?.kind ?? 'opaque') !== 'opaque';
const vtx = (P, i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
function triInfo(P, T, t) {
  const a = vtx(P, T[3 * t]), b = vtx(P, T[3 * t + 1]), c = vtx(P, T[3 * t + 2]), n = cross(sub(b, a), sub(c, a)), l = Math.hypot(...n), ln = l || 1;   // 퇴화 삼각형은 area 0
  return { n: n.map((v) => v / ln), area: l / 2, c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3] };
}

// 점 p 가 닫힌 메쉬(부품) 안인가 — 반직선 교차 수의 홀짝
export function insidePart(part, p) {
  const [dx, dy, dz] = PARITY_DIR;
  let t0 = 1e-6, skip = -1, n = 0;
  for (let k = 0; k < 1000; k++) {
    const h = intersectRay(part.bvh, p[0], p[1], p[2], dx, dy, dz, t0, Infinity, skip);
    if (!h) break;
    n++; t0 = h.t + 1e-7; skip = h.tri;
  }
  return (n & 1) === 1;
}

// 삼각형–축정렬 상자 겹침(분리축 13개) — c: 상자 중심, h: 반 크기
export function triBoxOverlap(c, h, a, b, d) {
  const v0 = sub(a, c), v1 = sub(b, c), v2 = sub(d, c), e0 = sub(v1, v0), e1 = sub(v2, v1), e2 = sub(v0, v2);
  const sep = (ax) => {
    const p0 = dot(v0, ax), p1 = dot(v1, ax), p2 = dot(v2, ax), r = h[0] * Math.abs(ax[0]) + h[1] * Math.abs(ax[1]) + h[2] * Math.abs(ax[2]);
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };
  for (const e of [e0, e1, e2]) if (sep([0, -e[2], e[1]]) || sep([e[2], 0, -e[0]]) || sep([-e[1], e[0], 0])) return false;
  for (let k = 0; k < 3; k++) if (Math.min(v0[k], v1[k], v2[k]) > h[k] || Math.max(v0[k], v1[k], v2[k]) < -h[k]) return false;
  return !sep(cross(e0, e1));
}

// ① LED–부품 간섭: 발광점(축 방향 lift 띄움)이 부품 안 / LED 몸체 외곽 상자(tol 만큼 줄임)가 부품 삼각형과 겹침 — 각각 1건
// emitters: [{pos, axis}], bodies: [{led, lo:[3], hi:[3]}](LED STEP 의 LED 몸체 외곽, 월드 좌표)
// mspec 가 있으면 투과 부품 안의 발광점(포팅 LED)은 'potted' 경고. exclude: 검사에서 뺄 부품 번호(LED STEP 의 PCB 등)
export function checkInterference({ rt, mspec = null, emitters = [], bodies = [], tol = 0.02, lift = 0.05, exclude = [] }) {
  const ex = new Set(exclude);
  if (mspec) mspec.parts.forEach((p, i) => { if (isUntraced(p)) ex.add(i); });   // 추적 제외 부품은 간섭 판단에서도 뺌
  if (!emitters.length && !bodies.length) return { status: 'na', count: 0, items: [] };
  const items = [], cand = [];
  emitters.forEach((e, i) => {
    const al = Math.hypot(...e.axis) || 1, q = e.pos.map((v, k) => v + (lift * e.axis[k]) / al);
    rt.parts.forEach((part, p) => { if (!ex.has(p) && insidePart(part, q)) items.push({ led: i, part: p, kind: mspec && isTrans(mspec, p) ? 'potted' : 'inside', pos: e.pos }); });
  });
  for (const b of bodies) {
    const lo = b.lo.map((v) => v + tol), hi = b.hi.map((v) => v - tol);
    if (lo.some((v, k) => v > hi[k])) continue;
    const c = lo.map((v, k) => (v + hi[k]) / 2), h = lo.map((v, k) => (hi[k] - v) / 2);
    rt.parts.forEach((part, p) => {
      if (ex.has(p)) return;
      const P = part.positions, T = part.triangles;
      let hit = false;
      for (const t of queryBox(part.bvh, lo, hi, cand)) {
        if (triBoxOverlap(c, h, vtx(P, T[3 * t]), vtx(P, T[3 * t + 1]), vtx(P, T[3 * t + 2]))) { items.push({ led: b.led, part: p, kind: 'overlap', pos: c }); hit = true; break; }
      }
      // 표면과 겹치지 않아도 몸체가 부품 솔리드에 완전히 파묻힌 경우(중심이 부품 안)
      if (!hit && insidePart(part, c)) items.push({ led: b.led, part: p, kind: 'body-inside', pos: c });
    });
  }
  const bad = items.some((x) => x.kind !== 'potted');
  return { status: bad ? 'bad' : items.length ? 'warn' : 'ok', count: items.length, items };
}

// 축 axis 둘레 반각 halfDeg 원뿔 안 n 방향(cos 균등 + 황금각 나선, 결정적)
export function coneDirs(axis, halfDeg, n) {
  const al = Math.hypot(...axis), a = axis.map((v) => v / al), t = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = cross(a, t); const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const v = cross(a, u), c0 = Math.cos((halfDeg * Math.PI) / 180), ga = Math.PI * (3 - Math.sqrt(5)), out = [];
  for (let k = 0; k < n; k++) {
    const ct = 1 - ((1 - c0) * (k + 0.5)) / n, st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = k * ga;
    const d = [0, 1, 2].map((i) => st * Math.cos(ph) * u[i] + st * Math.sin(ph) * v[i] + ct * a[i]), l = Math.hypot(...d);
    out.push(d.map((x) => x / l));
  }
  return out;
}
// 광선을 따라가며 투과 부품은 통과, 관측 부품에 닿으면 'obs', 불투명 부품이면 'block', 빠져나가면 'miss'
function traceToObs(rt, mspec, obsParts, o, d) {
  let t0 = 1e-6, skip = -1;
  for (let k = 0; k < 64; k++) {
    const h = intersectRay(rt.bvh, o[0], o[1], o[2], d[0], d[1], d[2], t0, Infinity, skip);
    if (!h) return { hit: 'miss' };
    const q = rt.combined.partOf[h.tri];
    if (obsParts.has(q)) return { hit: 'obs', t: h.t };
    if (!isTrans(mspec, q) && !isUntraced(mspec.parts[q])) return { hit: 'block', part: q, t: h.t };   // 추적 제외 부품은 통과
    t0 = h.t + 1e-7; skip = h.tri;
  }
  return { hit: 'miss' };
}
// ② LED–커버 거리·도달: LED 마다 지향각 안 nRays 광선 중 관측 부품에 닿는 비율, 축 광선의 관측 부품까지 거리
export function checkReach({ rt, mspec, emitters = [], obsParts, beam = 120, nRays = 64, minReach = defaultChecks().minReach }) {
  if (!emitters.length || !obsParts?.size) return { status: 'na', minReach: null, minDist: null, items: [] };
  nRays = Math.max(1, nRays);
  const half = Math.min(89, beam / 2);
  const items = emitters.map((e, i) => {
    let n = 0; const blk = new Map();
    for (const d of coneDirs(e.axis, half, nRays)) {
      const r = traceToObs(rt, mspec, obsParts, e.pos, d);
      if (r.hit === 'obs') n++; else if (r.hit === 'block') blk.set(r.part, (blk.get(r.part) ?? 0) + 1);
    }
    const al = Math.hypot(...e.axis), ax = e.axis.map((v) => v / al), a = traceToObs(rt, mspec, obsParts, e.pos, ax);
    const blocker = blk.size ? [...blk].sort((x, y) => y[1] - x[1])[0][0] : null;
    return { led: i, pos: e.pos, axis: ax, reach: n / nRays, dist: a.hit === 'obs' ? a.t : null, blocker };
  });
  const mr = Math.min(...items.map((x) => x.reach)), ds = items.map((x) => x.dist).filter((x) => x != null);
  return { status: mr < minReach ? 'warn' : 'ok', minReach: mr, minDist: ds.length ? Math.min(...ds) : null, items };
}

// ③ 살두께: 투과 부품의 면적 상위 samples 개 삼각형 중심에서 −법선 광선 → 마주 보는(법선 내적 < −0.5) 같은 부품 면까지 거리의 최솟값
export function checkThinWall({ rt, mspec, minWall = defaultChecks().minWall, samples = 400 }) {
  let best = null; const items = [];
  rt.parts.forEach((part, p) => {
    if (!isTrans(mspec, p) || isUntraced(mspec.parts[p])) return;
    const P = part.positions, T = part.triangles, nT = T.length / 3, order = [];
    for (let t = 0; t < nT; t++) { const ar = triInfo(P, T, t).area; if (ar >= 1e-9) order.push([t, ar]); }   // 퇴화(면적 0) 삼각형 제외
    order.sort((x, y) => y[1] - x[1]);
    let mn = Infinity, at = null;
    for (const [t] of order.slice(0, samples)) {
      const { n, c } = triInfo(P, T, t), o = [c[0] - 1e-5 * n[0], c[1] - 1e-5 * n[1], c[2] - 1e-5 * n[2]];
      const h = intersectRay(part.bvh, o[0], o[1], o[2], -n[0], -n[1], -n[2], 1e-6, Infinity, t);
      if (!h || dot(triInfo(P, T, h.tri).n, n) > -0.5) continue;   // 마주 보지 않는 면(모서리·경사) — 두께로 보지 않음
      const th = h.t + 1e-5;
      if (th < mn) { mn = th; at = c; }
    }
    if (at) { items.push({ part: p, min: mn, pos: at }); if (!best || mn < best.min) best = { part: p, min: mn, pos: at }; }
  });
  if (!best) return { status: 'na', min: null, part: null, pos: null, items };
  return { status: best.min < minWall ? 'warn' : 'ok', ...best, items };
}

// ④ 새는 빛: 청크 결과({ leak, ledger }) 합산
export function mergeLeak(chunks) {
  const leak = {}; let escaped = 0;
  for (const c of chunks) { escaped += c.ledger.escaped; for (const k in c.leak) leak[k] = (leak[k] ?? 0) + c.leak[k]; }
  return { leak, escaped };
}
export function checkLeak({ leak, escaped, maxLeak = defaultChecks().maxLeak }) {
  if (!(escaped > 0)) return { status: 'na', ratio: null, worst: null };
  let tot = 0, wk = null, wv = 0;
  for (const k in leak) { tot += leak[k]; if (leak[k] > wv) { wv = leak[k]; wk = k; } }
  const [part, face] = wk ? wk.split('|').map(Number) : [null, null];
  return { status: tot / escaped > maxLeak ? 'warn' : 'ok', ratio: tot / escaped, worst: wk ? { part, face, ratio: wv / escaped } : null };
}

// 기하 점검 ①②③ 묶음 — 기준값은 mspec.checks(없으면 기본)
export function runGeomChecks({ rt, mspec, emitters = [], bodies = [], obsParts = new Set(), beam = 120, exclude = [] }) {
  const C = { ...defaultChecks(), ...(mspec.checks ?? {}) };
  return {
    interference: checkInterference({ rt, mspec, emitters, bodies, exclude }),
    reach: checkReach({ rt, mspec, emitters, obsParts, beam, minReach: C.minReach }),
    wall: checkThinWall({ rt, mspec, minWall: C.minWall }),
  };
}
