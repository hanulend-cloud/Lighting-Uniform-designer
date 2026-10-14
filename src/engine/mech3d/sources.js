// 3D MC 광원 — spec 2026-10-14 §4.3. 반환 { flux, sample(rnd) → [x,y,z, dx,dy,dz] } (공기 중에서 출발).
import { _ledModel } from '../shape/mc-body.js';

// LED: 발광면 중심 (x,y,z), 배광 축 axis(발광면 법선), 패키지 가로축 xAxis(없으면 임의 직교). 배광 모델·각은 L1 과 같은 정의(I0 단위).
export function ledSource({ x, y, z, axis = [0, 0, 1], xAxis = null, model = 'lambertian', beam = 120, sizeX = 0, sizeY = 0, I0 = 1 }) {
  const lm = _ledModel({ model, beamX: beam });
  const al = Math.hypot(...axis), a = axis.map((v) => v / al);
  const perp = (w) => { const d = w[0] * a[0] + w[1] * a[1] + w[2] * a[2]; return [w[0] - d * a[0], w[1] - d * a[1], w[2] - d * a[2]]; };
  let u = xAxis ? perp(xAxis) : null;
  if (!u || Math.hypot(...u) < 1e-6 * Math.hypot(...xAxis)) u = perp(Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);   // xAxis ∥ axis → 기본 직교축
  const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  return {
    flux: I0 * lm.solid,
    sample(rnd) {
      const ct = lm.cosTheta(rnd()), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = 2 * Math.PI * rnd();
      const lx = st * Math.cos(ph), ly = st * Math.sin(ph);
      const ox = sizeX ? (rnd() - 0.5) * sizeX : 0, oy = sizeY ? (rnd() - 0.5) * sizeY : 0;
      return [
        x + ox * u[0] + oy * v[0] + 1e-5 * a[0], y + ox * u[1] + oy * v[1] + 1e-5 * a[1], z + ox * u[2] + oy * v[2] + 1e-5 * a[2],
        lx * u[0] + ly * v[0] + ct * a[0], lx * u[1] + ly * v[1] + ct * a[1], lx * u[2] + ly * v[2] + ct * a[2],
      ];
    },
  };
}

// 여러 광원 — 광속 비례로 선택
export function combineSources(list) {
  const flux = list.reduce((s, x) => s + x.flux, 0), cum = [];
  let c = 0; for (const x of list) { c += x.flux / flux; cum.push(c); }
  return {
    flux,
    sample(rnd) { const u = rnd(); let i = 0; while (i < cum.length - 1 && u > cum[i]) i++; return list[i].sample(rnd); },
  };
}
