// 3D MC 면 상호작용 — spec 2026-10-14 §3.3·§6.1. 방향 d·법선 N 은 단위벡터(N 의 부호는 무관 — 입사 쪽을 내부에서 판정).

// 일반 계면 n1 → n2(비편광 Fresnel). 반환 { R, 반사 방향 r*, 굴절 방향 t* } — 전반사면 R = 1(t* 무의미).
export function fresnelInterface(dx, dy, dz, Nx, Ny, Nz, n1, n2) {
  let dn = dx * Nx + dy * Ny + dz * Nz, ix = Nx, iy = Ny, iz = Nz;
  if (dn > 0) { ix = -Nx; iy = -Ny; iz = -Nz; dn = -dn; }   // Ni: 입사 쪽 법선(d·Ni < 0)
  const cosI = Math.min(1, -dn), eta = n1 / n2;
  const rx = dx - 2 * dn * ix, ry = dy - 2 * dn * iy, rz = dz - 2 * dn * iz;
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k <= 0) return { R: 1, rx, ry, rz, tx: 0, ty: 0, tz: 0 };
  const cosT = Math.sqrt(k);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT), rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  const m = eta * cosI - cosT;
  return { R: 0.5 * (rs * rs + rp * rp), rx, ry, rz, tx: eta * dx + m * ix, ty: eta * dy + m * iy, tz: eta * dz + m * iz };
}

// 편광 계면 n1 → n2. E = 편광(전기장) 단위벡터 ⟂ d. s = d×Ni(입사면 법선), p = s×k(각 광선마다).
// R = |Es|²Rs + |Ep|²Rp. 반사·투과 각 갈래의 새 편광 er*, et* = (r|t)s·Es·s + (r|t)p·Ep·p 정규화. 전반사면 R = 1, |r| = 1(위상 무시).
export function fresnelPolarized(dx, dy, dz, ex, ey, ez, Nx, Ny, Nz, n1, n2) {
  let dn = dx * Nx + dy * Ny + dz * Nz, ix = Nx, iy = Ny, iz = Nz;
  if (dn > 0) { ix = -Nx; iy = -Ny; iz = -Nz; dn = -dn; }
  const cosI = Math.min(1, -dn), eta = n1 / n2;
  const rx = dx - 2 * dn * ix, ry = dy - 2 * dn * iy, rz = dz - 2 * dn * iz;
  let sx = dy * iz - dz * iy, sy = dz * ix - dx * iz, sz = dx * iy - dy * ix, sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-9) { sx = ex; sy = ey; sz = ez; sl = Math.hypot(sx, sy, sz) || 1; }   // 수직 입사: 입사면 임의 — s = E
  sx /= sl; sy /= sl; sz /= sl;
  const Es = ex * sx + ey * sy + ez * sz;
  const Ep = ex * (sy * dz - sz * dy) + ey * (sz * dx - sx * dz) + ez * (sx * dy - sy * dx);   // E·(s×d)
  const pol = (as, ap, kx, ky, kz) => {   // as·s + ap·(s×k), 정규화
    let x = as * sx + ap * (sy * kz - sz * ky), y = as * sy + ap * (sz * kx - sx * kz), z = as * sz + ap * (sx * ky - sy * kx);
    const l = Math.hypot(x, y, z);
    if (l < 1e-12) return [sx, sy, sz];
    return [x / l, y / l, z / l];
  };
  const k = 1 - eta * eta * (1 - cosI * cosI);
  if (k <= 0) {
    const [erx, ery, erz] = pol(Es, Ep, rx, ry, rz);
    return { R: 1, rx, ry, rz, tx: 0, ty: 0, tz: 0, erx, ery, erz, etx: 0, ety: 0, etz: 0 };
  }
  const cosT = Math.sqrt(k);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT), rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
  const ts = 2 * n1 * cosI / (n1 * cosI + n2 * cosT), tp = 2 * n1 * cosI / (n2 * cosI + n1 * cosT);
  const m = eta * cosI - cosT, tx = eta * dx + m * ix, ty = eta * dy + m * iy, tz = eta * dz + m * iz;
  const [erx, ery, erz] = pol(rs * Es, rp * Ep, rx, ry, rz), [etx, ety, etz] = pol(ts * Es, tp * Ep, tx, ty, tz);
  return { R: Es * Es * rs * rs + Ep * Ep * rp * rp, rx, ry, rz, tx, ty, tz, erx, ery, erz, etx, ety, etz };
}

// d 에 수직인 임의(균일 방위) 편광 단위벡터 — 방출·확산 반사·체적 산란 후 편광 해소
export function randomPolarization(dx, dy, dz, rnd) {
  let ax, ay, az;
  if (Math.abs(dz) < 0.9) { ax = -dy; ay = dx; az = 0; } else { ax = 0; ay = -dz; az = dy; }
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
  const ph = 2 * Math.PI * rnd(), c = Math.cos(ph), s = Math.sin(ph);
  return [c * ax + s * bx, c * ay + s * by, c * az + s * bz];
}

// 법선 M 쪽 반구의 코사인 가중 방향
export function lambert(Mx, My, Mz, rnd) {
  const u1 = rnd(), u2 = rnd(), r = Math.sqrt(u1), ph = 2 * Math.PI * u2;
  const a = r * Math.cos(ph), b = r * Math.sin(ph), c = Math.sqrt(Math.max(0, 1 - u1));
  let tx, ty, tz;
  if (Math.abs(Mz) < 0.9) { tx = -My; ty = Mx; tz = 0; } else { tx = 0; ty = -Mz; tz = My; }
  const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  const bx = My * tz - Mz * ty, by = Mz * tx - Mx * tz, bz = Mx * ty - My * tx;
  return [a * tx + b * bx + c * Mx, a * ty + b * by + c * My, a * tz + b * bz + c * Mz];
}

// 반사형 면 처리 — 입사 쪽 반구로 되돌리거나 흡수(null). fin = { kind, R }
//   whiteDiffuse: R 확률 Lambert / metal: R 확률 정반사 / black: 광택 Fresnel(n 1.5) 정반사 + 나머지의 R 확률 Lambert
//   gloss(불투명 부품): 흑색 광택 수지로 간주 — Fresnel(n 1.5) 정반사만
//   black·gloss 의 Fresnel 은 입사 매질 nInc → 1.5 (수지에 광학 접촉된 흑색 면은 정반사가 거의 0)
export function reflectFinish(fin, dx, dy, dz, Nx, Ny, Nz, rnd, nInc = 1) {
  const dn = dx * Nx + dy * Ny + dz * Nz;
  const Mx = dn > 0 ? -Nx : Nx, My = dn > 0 ? -Ny : Ny, Mz = dn > 0 ? -Nz : Nz;   // 입사 쪽 법선
  const spec = () => [dx - 2 * dn * Nx, dy - 2 * dn * Ny, dz - 2 * dn * Nz];
  switch (fin.kind) {
    case 'whiteDiffuse': return rnd() < fin.R ? lambert(Mx, My, Mz, rnd) : null;
    case 'metal': return rnd() < fin.R ? spec() : null;
    case 'black': {
      const F = fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nInc, 1.5).R, u = rnd();
      if (u < F) return spec();
      return u < F + (1 - F) * fin.R ? lambert(Mx, My, Mz, rnd) : null;
    }
    case 'gloss': return rnd() < fresnelInterface(dx, dy, dz, Nx, Ny, Nz, nInc, 1.5).R ? spec() : null;
    default: throw new Error(`알 수 없는 면 처리: ${fin.kind}`);
  }
}
