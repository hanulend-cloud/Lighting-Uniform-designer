// GPU(WebGPU) 3D MC 추적기 — mc3d.runMC3D 와 같은 물리 규칙을 WGSL 로 옮긴 것. GPU 가 있으면 자동 사용, 없거나 실패하면 null(호출자가 CPU 로).
// 광원 표본(출발점·방향)은 CPU 가 뽑아 넘기고(sources.js 그대로), GPU 는 광자마다 끝까지 추적해 기록 1줄을 남긴다:
//   [0 탈출(1/0), 1 마지막 출사 부품(−1 없음), 2 그 면, 3-5 출사점, 6-8 탈출 방향, 9 탈출 가중치, 10 tL, 11 tK,
//    12 불투명 면 반사 여부, 13-17 들어간 투과 부품 차례(−1 빈칸), 18 면 흡수, 19 체적 흡수, 20 소실, 21 RR 손실, 22 RR 이득, 23 예비]
// 기록을 job.runChunkGpu 가 CPU 집계기(tally.makeAccumulator)에 그대로 넣으므로 집계·광경로·새는 빛 규칙은 CPU 와 같다.
// 정밀도: GPU 는 f32 — 좌표를 장면 중심 기준으로 옮기고 tMin = 2e-5 mm(CPU 1e-9)로 둔다. 결과는 CPU 와 잡음 범위에서 같다(시험: test/gpu-vs-cpu 브라우저 점검).
import { coinFlags } from './mc3d.js';

export const REC = 24;
const WG = 64;
const KIND = { whiteDiffuse: 0, metal: 1, black: 2, gloss: 3 };

const WGSL = /* wgsl */`
struct Prm {
  n: u32, base: u32, seed: u32, track: i32,
  w0: f32, wMin: f32, maxEvents: u32, nCon: u32,
  oP: u32, oNM: u32, oBOX: u32, oPH: u32,
  oOPT: u32, oFIN: u32, oT: u32, oTI: u32,
  oMETA: u32, oORD: u32, oCON: u32, nOrd: u32,
};
@group(0) @binding(0) var<uniform> prm: Prm;
@group(0) @binding(1) var<storage, read> F: array<f32>;
@group(0) @binding(2) var<storage, read> U: array<u32>;
@group(0) @binding(3) var<storage, read> SRC: array<f32>;
@group(0) @binding(4) var<storage, read_write> OUT: array<f32>;

const T_MIN: f32 = 2e-5;
const BIG: f32 = 1e30;
const PI: f32 = 3.14159265358979;
const COIN_GAP_PLANAR: f32 = 0.02; const COIN_GAP: f32 = 0.04; const COIN_PLANAR_DOT: f32 = -0.9999; const COIN_DOT: f32 = -0.97; const COIN_BOX: f32 = 0.05; const COIN_BARY: f32 = 1e-6;

var<private> rs: u32;
fn rnd() -> f32 {
  rs = rs * 747796405u + 2891336453u;
  var w = ((rs >> ((rs >> 28u) + 4u)) ^ rs) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w >> 8u) * (1.0 / 16777216.0);
}
fn hash(x0: u32) -> u32 { var x = x0; x = x ^ (x >> 16u); x = x * 0x7feb352du; x = x ^ (x >> 15u); x = x * 0x846ca68bu; x = x ^ (x >> 16u); return x; }

fn pos(v: u32) -> vec3f { let o = prm.oP + v * 3u; return vec3f(F[o], F[o + 1u], F[o + 2u]); }
fn nrm(t: u32) -> vec3f { let o = prm.oNM + t * 3u; return vec3f(F[o], F[o + 1u], F[o + 2u]); }
fn tv(t: u32, k: u32) -> u32 { return U[prm.oT + t * 3u + k]; }
fn tPart(t: u32) -> i32 { return i32(U[prm.oTI + t * 4u]); }
fn tFace(t: u32) -> i32 { return i32(U[prm.oTI + t * 4u + 1u]); }
fn tFin(t: u32) -> u32 { return U[prm.oTI + t * 4u + 2u]; }
fn tCoin(t: u32) -> bool { return U[prm.oTI + t * 4u + 3u] != 0u; }
// 부품 광학: [n, mus, g, mua], [투과(1/0), 위상표 번호(−1 = HG), 0, 0]
fn oN(q: i32) -> f32 { if (q < 0) { return 1.0; } return F[prm.oOPT + u32(q) * 8u]; }
fn oMus(q: i32) -> f32 { return F[prm.oOPT + u32(q) * 8u + 1u]; }
fn oG(q: i32) -> f32 { return F[prm.oOPT + u32(q) * 8u + 2u]; }
fn oMua(q: i32) -> f32 { return F[prm.oOPT + u32(q) * 8u + 3u]; }
fn oTr(q: i32) -> bool { return F[prm.oOPT + u32(q) * 8u + 4u] > 0.5; }
fn oPh(q: i32) -> i32 { return i32(F[prm.oOPT + u32(q) * 8u + 5u]); }
fn finKind(f: u32) -> u32 { return u32(F[prm.oFIN + f * 2u]); }
fn finR(f: u32) -> f32 { return F[prm.oFIN + f * 2u + 1u]; }

// ---- 교차 ----
var<private> hu: f32; var<private> hv: f32;
fn hitTri(t: u32, o: vec3f, d: vec3f) -> f32 {
  let a = pos(tv(t, 0u)); let e1 = pos(tv(t, 1u)) - a; let e2 = pos(tv(t, 2u)) - a;
  let p = cross(d, e2); let det = dot(e1, p);
  if (abs(det) < 1e-14) { return -1.0; }
  let inv = 1.0 / det; let s = o - a;
  let u = dot(s, p) * inv;
  if (u < 0.0 || u > 1.0) { return -1.0; }
  let q = cross(s, e1); let v = dot(d, q) * inv;
  if (v < 0.0 || u + v > 1.0) { return -1.0; }
  return dot(e2, q) * inv;
}
fn safeInv(x: f32) -> f32 { if (abs(x) < 1e-20) { return select(-1e20, 1e20, x >= 0.0); } return 1.0 / x; }
var<private> hitT: f32; var<private> hitI: i32;
fn intersect(o: vec3f, d: vec3f, tMax: f32, s1: i32, s2: i32) -> bool {
  hitT = tMax; hitI = -1;
  if (prm.nOrd == 0u) { return false; }
  let inv = vec3f(safeInv(d.x), safeInv(d.y), safeInv(d.z));
  var st: array<i32, 64>; var sp = 1; st[0] = 0;
  loop {
    if (sp <= 0) { break; }
    sp = sp - 1; let n = u32(st[sp]); let b = prm.oBOX + n * 6u;
    let lo = (vec3f(F[b], F[b + 1u], F[b + 2u]) - o) * inv; let hi = (vec3f(F[b + 3u], F[b + 4u], F[b + 5u]) - o) * inv;
    let mn = min(lo, hi); let mx = max(lo, hi);
    let near = max(max(mn.x, mn.y), mn.z); let far = min(min(mx.x, mx.y), mx.z);
    if (far < near || far < T_MIN || near > hitT) { continue; }
    let cnt = i32(U[prm.oMETA + n * 2u + 1u]); let first = i32(U[prm.oMETA + n * 2u]);
    if (cnt > 0) {
      for (var i = first; i < first + cnt; i = i + 1) {
        let tri = U[prm.oORD + u32(i)];
        if (i32(tri) == s1 || i32(tri) == s2) { continue; }
        let s = hitTri(tri, o, d);
        if (s >= T_MIN && s < hitT) { hitT = s; hitI = i32(tri); }
      }
    } else if (sp < 62) { st[sp] = first; st[sp + 1] = i32(n) + 1; sp = sp + 2; }
  }
  return hitI >= 0;
}
// 점 x 에서 tri 와 맞붙은 다른 부품 삼각형(없으면 −1) — mc3d.partnerAt 과 같은 규칙
var<private> partnerTol: f32;
fn partnerAt(tri: u32, x: vec3f) -> i32 {
  if (!tCoin(tri)) { return -1; }
  let q = tPart(tri); let Nt = nrm(tri);
  var best = -1; var bestD: f32 = BIG; partnerTol = 0.0;
  var st: array<i32, 64>; var sp = 1; st[0] = 0;
  loop {
    if (sp <= 0) { break; }
    sp = sp - 1; let n = u32(st[sp]); let b = prm.oBOX + n * 6u;
    if (F[b] > x.x + COIN_BOX || F[b + 3u] < x.x - COIN_BOX || F[b + 1u] > x.y + COIN_BOX || F[b + 4u] < x.y - COIN_BOX || F[b + 2u] > x.z + COIN_BOX || F[b + 5u] < x.z - COIN_BOX) { continue; }
    let cnt = i32(U[prm.oMETA + n * 2u + 1u]); let first = i32(U[prm.oMETA + n * 2u]);
    if (cnt > 0) {
      for (var i = first; i < first + cnt; i = i + 1) {
        let c = U[prm.oORD + u32(i)];
        if (tPart(c) == q) { continue; }
        let Nc = nrm(c); let dt = dot(Nt, Nc);
        if (dt > COIN_DOT) { continue; }
        let tol = select(COIN_GAP, COIN_GAP_PLANAR, dt <= COIN_PLANAR_DOT);
        let a = pos(tv(c, 0u)); let dist = dot(x - a, Nc);
        if (abs(dist) > tol || abs(dist) >= bestD) { continue; }
        let p = x - dist * Nc - a; let u = pos(tv(c, 1u)) - a; let v = pos(tv(c, 2u)) - a;
        let uu = dot(u, u); let uv = dot(u, v); let vv = dot(v, v); let pu = dot(p, u); let pv = dot(p, v); let den = uu * vv - uv * uv;
        if (!(den > 0.0)) { continue; }
        let s = (vv * pu - uv * pv) / den; let t = (uu * pv - uv * pu) / den;
        if (s < -COIN_BARY || t < -COIN_BARY || s + t > 1.0 + COIN_BARY) { continue; }
        best = i32(c); bestD = abs(dist); partnerTol = tol;
      }
    } else if (sp < 62) { st[sp] = first; st[sp + 1] = i32(n) + 1; sp = sp + 2; }
  }
  return best;
}
// 짝 면 모드: 1 = 광학 접촉, 2 = 공기막. contacts 지정 우선(접촉 → 공기막 순), 없으면 접촉
fn modeOf(q: i32, f: i32, q2: i32) -> u32 {
  var air = false;
  for (var i = 0u; i < prm.nCon; i = i + 1u) {
    let o = prm.oCON + i * 4u;
    if (i32(U[o]) == q && i32(U[o + 1u]) == f && i32(U[o + 2u]) == q2) { if (U[o + 3u] == 1u) { return 1u; } air = true; }
  }
  return select(1u, 2u, air);
}

// ---- 면 상호작용 ----
fn randPol(d: vec3f) -> vec3f {
  var a: vec3f; if (abs(d.z) < 0.9) { a = vec3f(-d.y, d.x, 0.0); } else { a = vec3f(0.0, -d.z, d.y); }
  a = normalize(a); let b = cross(d, a);
  let ph = 2.0 * PI * rnd(); return cos(ph) * a + sin(ph) * b;
}
fn lambert(M: vec3f) -> vec3f {
  let u1 = rnd(); let u2 = rnd(); let r = sqrt(u1); let ph = 2.0 * PI * u2;
  var t: vec3f; if (abs(M.z) < 0.9) { t = vec3f(-M.y, M.x, 0.0); } else { t = vec3f(0.0, -M.z, M.y); }
  t = normalize(t); let b = cross(M, t);
  return r * cos(ph) * t + r * sin(ph) * b + sqrt(max(0.0, 1.0 - u1)) * M;
}
fn fresnelR(d: vec3f, N: vec3f, n1: f32, n2: f32) -> f32 {
  var dn = dot(d, N); if (dn > 0.0) { dn = -dn; }
  let cosI = min(1.0, -dn); let eta = n1 / n2; let k = 1.0 - eta * eta * (1.0 - cosI * cosI);
  if (k <= 0.0) { return 1.0; }
  let cosT = sqrt(k);
  let rs_ = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT); let rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  return 0.5 * (rs_ * rs_ + rp * rp);
}
// 광자 상태(전역 private — 보조 함수가 고침)
var<private> d: vec3f; var<private> E: vec3f; var<private> Nn: vec3f;
var<private> ndir: vec3f; var<private> nE: vec3f; var<private> hasDir: bool; var<private> hasE: bool; var<private> absorbed: bool;
// reflectFinish: 입사 쪽 반구로 되돌리거나(hasDir) 흡수
fn reflectBy(f: u32, nInc: f32) {
  let dn = dot(d, Nn); let M = select(Nn, -Nn, dn > 0.0); let spec = d - 2.0 * dn * Nn;
  let k = finKind(f); let R = finR(f);
  if (k == 0u) { if (rnd() < R) { ndir = lambert(M); hasDir = true; hasE = false; } else { absorbed = true; } }
  else if (k == 1u) { if (rnd() < R) { ndir = spec; hasDir = true; hasE = false; } else { absorbed = true; } }
  else if (k == 2u) {
    let Fr = fresnelR(d, Nn, nInc, 1.5); let u = rnd();
    if (u < Fr) { ndir = spec; hasDir = true; hasE = false; }
    else if (u < Fr + (1.0 - Fr) * R) { ndir = lambert(M); hasDir = true; hasE = false; }
    else { absorbed = true; }
  } else { if (rnd() < fresnelR(d, Nn, nInc, 1.5)) { ndir = spec; hasDir = true; hasE = false; } else { absorbed = true; } }
}
fn polv(as_: f32, ap: f32, s: vec3f, k: vec3f) -> vec3f { let v = as_ * s + ap * cross(s, k); let l = length(v); if (l < 1e-12) { return s; } return v / l; }
// 편광 Fresnel n1 → n2 — 반사면 true. ndir·nE 설정
fn fresnel(n1: f32, n2: f32) -> bool {
  var dn = dot(d, Nn); var I = Nn; if (dn > 0.0) { I = -Nn; dn = -dn; }
  let cosI = min(1.0, -dn); let eta = n1 / n2; let r = d - 2.0 * dn * I;
  var s = cross(d, I); var sl = length(s);
  if (sl < 1e-9) { s = E; sl = length(s); if (sl == 0.0) { sl = 1.0; } }
  s = s / sl;
  let Es = dot(E, s); let Ep = dot(E, cross(s, d));
  let k = 1.0 - eta * eta * (1.0 - cosI * cosI);
  hasDir = true; hasE = true;
  if (k <= 0.0) { ndir = r; nE = polv(Es, Ep, s, r); return true; }
  let cosT = sqrt(k);
  let rs_ = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT); let rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  let ts = 2.0 * n1 * cosI / (n1 * cosI + n2 * cosT); let tp = 2.0 * n1 * cosI / (n2 * cosI + n1 * cosT);
  let t = eta * d + (eta * cosI - cosT) * I;
  let R = Es * Es * rs_ * rs_ + Ep * Ep * rp * rp;
  if (R >= 1.0 || rnd() < R) { ndir = r; nE = polv(rs_ * Es, rp * Ep, s, r); return true; }
  ndir = t; nE = polv(ts * Es, tp * Ep, s, t); return false;
}
// 공기막: nCur → 공기 → B(투과 nB 또는 불투명 면 처리 finB). 0 = A 로, 1 = B 로, 2 = 흡수
fn filmCross(nCur: f32, bTr: bool, nB: f32, finB: u32) -> u32 {
  if (fresnel(nCur, 1.0)) { return 0u; }
  for (var k = 0; k < 100; k = k + 1) {
    let sd = d; let se = E;
    d = ndir; E = nE;
    if (!bTr) {
      hasDir = false; reflectBy(finB, 1.0);
      if (absorbed) { d = sd; E = se; return 2u; }
      ndir = normalize(ndir); nE = randPol(ndir); hasE = true;
    } else if (!fresnel(1.0, nB)) { d = sd; E = se; return 1u; }
    d = ndir; E = nE;
    let back = !fresnel(1.0, nCur);
    d = sd; E = se;
    if (back) { return 0u; }
  }
  absorbed = true; return 2u;
}

// ---- 매질 스택 ----
var<private> stk: array<i32, 8>; var<private> sn: i32; var<private> stkOver: bool;
fn sTop() -> i32 { if (sn > 0) { return stk[sn - 1]; } return -1; }
fn sLast(v: i32) -> i32 { for (var i = sn - 1; i >= 0; i = i - 1) { if (stk[i] == v) { return i; } } return -1; }
fn sDel(i: i32) { for (var j = i; j < sn - 1; j = j + 1) { stk[j] = stk[j + 1]; } sn = sn - 1; }
fn sPush(v: i32) { if (sn < 8) { stk[sn] = v; sn = sn + 1; } else { stkOver = true; } }

// 광경로(들어간 투과 부품 차례 최대 5 · 불투명 면 반사)
var<private> seq: array<i32, 5>; var<private> nSeq: i32; var<private> refl: bool;
fn note(q: i32, entering: bool) {
  if (!entering || q < 0) { return; }
  if (oTr(q)) { if ((nSeq == 0 || seq[nSeq - 1] != q) && nSeq < 5) { seq[nSeq] = q; nSeq = nSeq + 1; } } else { refl = true; }
}
fn sampleHG(g: f32, u: f32) -> f32 {
  if (abs(g) < 1e-6) { return 2.0 * u - 1.0; }
  let f = (1.0 - g * g) / (1.0 - g + 2.0 * g * u); return (1.0 + g * g - f * f) / (2.0 * g);
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= prm.n) { return; }
  let p = prm.base + i;
  rs = hash(prm.seed ^ hash(p * 2654435761u + 1u));
  let so = p * 6u;
  var x = vec3f(SRC[so], SRC[so + 1u], SRC[so + 2u]);
  d = normalize(vec3f(SRC[so + 3u], SRC[so + 4u], SRC[so + 5u]));
  E = randPol(d);
  var w = prm.w0;
  var skipPA = -1; var skipFA = -1; var skipPB = -1; var skipFB = -1; var skipTol: f32 = 0.0; var skipX = vec3f(0.0); var skipN = vec3f(0.0);
  var lastTri = -1; var lastTri2 = -1;
  var tL: f32 = 0.0; var tK: f32 = 0.0;
  sn = 0; stkOver = false; nSeq = 0; refl = false;
  var exitPart = -1; var exitFace = -1; var exitX = vec3f(0.0);
  var esc = 0.0; var absS: f32 = 0.0; var absV: f32 = 0.0; var lost: f32 = 0.0; var rrL: f32 = 0.0; var rrG: f32 = 0.0;
  for (var e = 0u; ; e = e + 1u) {
    if (e > prm.maxEvents || stkOver) { lost = lost + w; break; }
    let cur = sTop();
    var sFree = BIG;
    if (cur >= 0 && oMus(cur) > 0.0) { sFree = -log(max(1.0 - rnd(), 1e-30)) / oMus(cur); }
    let h = intersect(x, d, sFree, lastTri, lastTri2);
    if (!h && sFree >= BIG) {
      if (cur >= 0) { lost = lost + w; break; }
      esc = 1.0; break;
    }
    let t = select(sFree, hitT, h);
    x = x + t * d;
    if (cur == prm.track && prm.track >= 0) { tL = tL + t; if (!h) { tK = tK + 1.0; } }
    if (cur >= 0 && oMua(cur) > 0.0) { let a = w * (1.0 - exp(-oMua(cur) * t)); absV = absV + a; w = w - a; }
    if (!h) {   // 체적 산란
      skipPA = -1; lastTri = -1; lastTri2 = -1;
      let ph = oPh(cur); var cth: f32;
      if (ph >= 0) { let tt = rnd() * 4096.0; let k = min(4095u, u32(tt)); let f = tt - f32(k); let o = prm.oPH + u32(ph) * 4097u + k; cth = F[o] + f * (F[o + 1u] - F[o]); }
      else { cth = sampleHG(oG(cur), rnd()); }
      let sth = sqrt(max(0.0, 1.0 - cth * cth)); let phi = 2.0 * PI * rnd(); let cp = cos(phi); let spp = sin(phi);
      if (abs(d.z) > 0.99999) { d = vec3f(sth * cp, sth * spp, sign(d.z) * cth); }
      else {
        let tmp = sqrt(1.0 - d.z * d.z);
        d = vec3f(sth * (d.x * d.z * cp - d.y * spp) / tmp + d.x * cth, sth * (d.y * d.z * cp + d.x * spp) / tmp + d.y * cth, -sth * cp * tmp + d.z * cth);
      }
      d = normalize(d); E = randPol(d);
    } else {
      let tri = u32(hitI); let q = tPart(tri); let face = tFace(tri);
      Nn = nrm(tri);
      let prevTri = lastTri;
      lastTri = hitI; lastTri2 = -1;
      if (skipPA >= 0 && ((q == skipPA && face == skipFA) || (q == skipPB && face == skipFB))
        && abs(dot(Nn, skipN)) > -COIN_DOT && abs(dot(x - skipX, skipN)) <= skipTol + 1e-5) { lastTri2 = prevTri; continue; }
      skipPA = -1;
      let entering = dot(d, Nn) < 0.0;
      hasDir = false; hasE = false; absorbed = false; var lostHere = false;
      let nCur = oN(cur);
      let tri2 = partnerAt(tri, x);
      note(q, entering); if (tri2 >= 0) { note(tPart(u32(tri2)), !entering); }
      if (tri2 >= 0) {
        let q2 = tPart(u32(tri2)); let triA = select(tri, u32(tri2), entering); let triB = select(u32(tri2), tri, entering);
        let A = tPart(triA); let B = tPart(triB);
        let mode = modeOf(q, face, q2);
        if (!oTr(A)) { lostHere = true; }
        else if (finKind(tFin(triA)) != 3u) { reflectBy(tFin(triA), nCur); }
        else if (oTr(B) && finKind(tFin(triB)) != 3u) { reflectBy(tFin(triB), nCur); }
        else if (mode == 1u) {
          if (!oTr(B)) { reflectBy(tFin(triB), nCur); }
          else if (!fresnel(nCur, oN(B))) { let k = sLast(A); if (k >= 0) { sDel(k); } sPush(B); }
        } else {
          let r = filmCross(nCur, oTr(B), oN(B), tFin(triB));
          if (r == 1u && oTr(B)) { let k = sLast(A); if (k >= 0) { sDel(k); } sPush(B); }
        }
        lastTri2 = tri2;
        skipPA = A; skipFA = tFace(triA); skipPB = B; skipFB = tFace(triB); skipTol = partnerTol; skipX = x; skipN = Nn;
      } else if (!oTr(q)) {
        if (entering) { reflectBy(tFin(tri), nCur); } else { lostHere = true; }
      } else if (select(sLast(q) < 0, sLast(q) >= 0, entering)) { lastTri2 = prevTri; }
      else if (finKind(tFin(tri)) != 3u) { reflectBy(tFin(tri), nCur); }
      else if (entering) { if (!fresnel(nCur, oN(q))) { sPush(q); } }
      else {
        var other = -1;
        for (var k = sn - 1; k >= 0; k = k - 1) { if (stk[k] != q) { other = stk[k]; break; } }
        if (!fresnel(nCur, oN(other))) {
          sDel(sLast(q));
          if (other >= 0 && sTop() != other) { sPush(other); }
          if (sn == 0) { exitPart = q; exitFace = face; exitX = x; }
        }
      }
      if (lostHere) { lost = lost + w; break; }
      if (absorbed) { absS = absS + w; break; }
      if (hasDir) {
        d = normalize(ndir);
        if (hasE) { E = nE; } else { E = randPol(d); }
      }
    }
    if (w < prm.wMin) {
      if (rnd() < 0.1) { rrG = rrG + 9.0 * w; w = w * 10.0; } else { rrL = rrL + w; break; }
    }
  }
  let o = i * ${REC}u;
  OUT[o] = esc; OUT[o + 1u] = f32(exitPart); OUT[o + 2u] = f32(exitFace);
  OUT[o + 3u] = exitX.x; OUT[o + 4u] = exitX.y; OUT[o + 5u] = exitX.z;
  OUT[o + 6u] = d.x; OUT[o + 7u] = d.y; OUT[o + 8u] = d.z; OUT[o + 9u] = select(0.0, w, esc > 0.5);
  OUT[o + 10u] = tL; OUT[o + 11u] = tK; OUT[o + 12u] = select(0.0, 1.0, refl);
  for (var k = 0; k < 5; k = k + 1) { OUT[o + 13u + u32(k)] = select(-1.0, f32(seq[k]), k < nSeq); }
  OUT[o + 18u] = absS; OUT[o + 19u] = absV; OUT[o + 20u] = lost; OUT[o + 21u] = rrL; OUT[o + 22u] = rrG; OUT[o + 23u] = 0.0;
}
`;

// GPU 를 찾아 추적기를 만든다. GPU 가 없거나 실패하면 null. 반환 { name, trace(S, opts) → Promise<{ rec, ms }>, lost }
export async function createGpuTracer() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return null;
  let adapter = null;
  try { adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { return null; }
  if (!adapter) return null;
  const lim = adapter.limits, info = adapter.info ?? {};
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize, maxBufferSize: lim.maxBufferSize } });
  let dead = false;
  device.lost.then(() => { dead = true; });
  const mod = device.createShaderModule({ code: WGSL });
  const ci = await mod.getCompilationInfo?.();
  const errs = ci?.messages?.filter((m) => m.type === 'error') ?? [];
  if (errs.length) throw new Error(`GPU 셰이더 오류: ${errs.map((m) => `${m.lineNum}:${m.message}`).join(' / ')}`);
  const pipe = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
  const scenes = new WeakMap();
  let slice0 = 4096;   // 슬라이스 크기 — 청크 사이에 기억(매 청크 4096 부터 다시 키우면 느림)
  const name = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ').trim() || 'GPU';

  // 장면 → GPU 버퍼(장면마다 한 번). 좌표는 장면 중심 기준(f32 정밀도)
  function upload(S) {
    if (scenes.has(S)) return scenes.get(S);
    const { P, T, normals: NM, partOf, faceOf, finOf, fins, optics, bvh } = S, nT = partOf.length, flag = coinFlags(S);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P[i + k]); hi[k] = Math.max(hi[k], P[i + k]); }
    const c = lo.map((v, k) => (Number.isFinite(v) ? (v + hi[k]) / 2 : 0));
    // 위상표(Mie) — 부품마다 번호
    const phs = [], phIdx = optics.map((o) => { if (!o.transmissive || !o.phase?.inv) return -1; let k = phs.indexOf(o.phase.inv); if (k < 0) { k = phs.length; phs.push(o.phase.inv); } return k; });
    const box = bvh.box.slice(); for (let n = 0; n < box.length; n += 6) for (let k = 0; k < 3; k++) { box[n + k] -= c[k]; box[n + 3 + k] -= c[k]; }
    const Pc = new Float32Array(P.length); for (let i = 0; i < P.length; i++) Pc[i] = P[i] - c[i % 3];
    const opt = new Float32Array(optics.length * 8);
    optics.forEach((o, q) => { if (o.transmissive) opt.set([o.n, o.mus, o.g, o.mua, 1, phIdx[q]], q * 8); else opt.set([1, 0, 0, 0, 0, -1], q * 8); });
    const fin = new Float32Array(fins.length * 2);
    fins.forEach((f, k) => { const kk = KIND[f.kind]; if (kk == null) throw new Error(`GPU: 알 수 없는 면 처리 ${f.kind}`); fin[k * 2] = kk; fin[k * 2 + 1] = f.R ?? 0; });
    const con = [];
    for (const [key, v] of S.contact) { const [a, f] = key.split('|').map(Number); con.push(a, f, v.part, 1); }
    for (const [key, v] of S.film) { const [a, f] = key.split('|').map(Number); con.push(a, f, v.part, 2); }
    // F(f32) = P · NM · BOX · PH · OPT · FIN, U(u32) = T · TI · META · ORD · CON
    const Fparts = [Pc, NM, box, ...phs.map((a) => Float32Array.from(a)), opt, fin];
    let off = 0; const fo = Fparts.map((a) => { const o = off; off += a.length; return o; });
    const F = new Float32Array(Math.max(4, off)); Fparts.forEach((a, k) => F.set(a, fo[k]));
    const TI = new Uint32Array(nT * 4); for (let t = 0; t < nT; t++) { TI[t * 4] = partOf[t]; TI[t * 4 + 1] = faceOf[t]; TI[t * 4 + 2] = finOf[t]; TI[t * 4 + 3] = flag[t]; }
    const Uparts = [Uint32Array.from(T), TI, new Uint32Array(bvh.meta.buffer.slice(0)), Uint32Array.from(bvh.order), Uint32Array.from(con)];
    off = 0; const uo = Uparts.map((a) => { const o = off; off += a.length; return o; });
    const Ub = new Uint32Array(Math.max(4, off)); Uparts.forEach((a, k) => Ub.set(a, uo[k]));
    const buf = (arr, usage) => { const b = device.createBuffer({ size: Math.max(16, arr.byteLength), usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, arr); return b; };
    const sc = {
      c, F: buf(F, GPUBufferUsage.STORAGE), U: buf(Ub, GPUBufferUsage.STORAGE),
      off: { oP: fo[0], oNM: fo[1], oBOX: fo[2], oPH: phs.length ? fo[3] : 0, oOPT: fo[3 + phs.length], oFIN: fo[4 + phs.length], oT: uo[0], oTI: uo[1], oMETA: uo[2], oORD: uo[3], oCON: uo[4] },
      nCon: con.length / 4, nOrd: bvh.order.length,
    };
    scenes.set(S, sc);
    return sc;
  }

  // starts: Float32Array(N·6) 광원 표본(원래 좌표). 슬라이스마다 ≈ targetMs 가 되게 나눠 보냄(GPU 감시 시간 초과 방지)
  async function trace(S, { starts, N, seed, track = -1, w0, wMin, maxEvents = 100000, targetMs = 120 }) {
    if (dead) throw new Error('GPU 장치를 잃음');
    const t0 = performance.now(), sc = upload(S);
    const st = new Float32Array(N * 6); for (let i = 0; i < N * 6; i++) st[i] = starts[i] - (i % 6 < 3 ? sc.c[i % 6] : 0);
    const src = device.createBuffer({ size: Math.max(16, st.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(src, 0, st);
    const outBytes = N * REC * 4, out = device.createBuffer({ size: Math.max(16, outBytes), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = device.createBuffer({ size: Math.max(16, outBytes), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const ub = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: { buffer: sc.F } }, { binding: 2, resource: { buffer: sc.U } },
      { binding: 3, resource: { buffer: src } }, { binding: 4, resource: { buffer: out } }] });
    const pb = new ArrayBuffer(80), pu = new Uint32Array(pb), pi = new Int32Array(pb), pf = new Float32Array(pb), O = sc.off;
    let base = 0, slice = slice0;
    try {
      while (base < N) {
        const n = Math.min(slice, N - base);
        pu[0] = n; pu[1] = base; pu[2] = seed >>> 0; pi[3] = track; pf[4] = w0; pf[5] = wMin; pu[6] = maxEvents; pu[7] = sc.nCon;
        pu.set([O.oP, O.oNM, O.oBOX, O.oPH, O.oOPT, O.oFIN, O.oT, O.oTI, O.oMETA, O.oORD, O.oCON, sc.nOrd], 8);
        device.queue.writeBuffer(ub, 0, pb);
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(pipe); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(Math.ceil(n / WG)); pass.end();
        // 출력은 슬라이스 자리(base)에 — 셰이더는 i = 슬라이스 안 번호로 쓰므로 여기서 옮김
        enc.copyBufferToBuffer(out, 0, rb, base * REC * 4, n * REC * 4);
        const ts = performance.now();
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();
        if (dead) throw new Error('GPU 장치를 잃음');
        const ms = performance.now() - ts;
        base += n;
        if (n >= slice) slice = slice0 = Math.max(1024, Math.min(1 << 20, Math.round(n * targetMs / Math.max(1, ms))));   // 다 찬 슬라이스로만 잼
      }
      await rb.mapAsync(GPUMapMode.READ);
      const rec = new Float32Array(rb.getMappedRange().slice(0));
      rb.unmap();
      for (let p = 0; p < N; p++) { const o = p * REC; if (rec[o + 1] >= 0) for (let k = 0; k < 3; k++) rec[o + 3 + k] += sc.c[k]; }
      return { rec, ms: performance.now() - t0 };
    } finally { src.destroy(); out.destroy(); rb.destroy(); ub.destroy(); }
  }
  return { name, trace, get lost() { return dead; } };
}
