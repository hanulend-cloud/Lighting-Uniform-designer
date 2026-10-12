// 형상 몸체 높이맵(툴 좌표) — 형상 몸체 spec 2026-10-10 §3.2, S2a.
// 활성 레벨 → 캐비티 벽 사각형을 덮는 2.5D 높이맵(heightfield.js 형식, Float64, 원점 = 사각형 중심).
//  - 생성 평판: 윗면 = depth(평탄), 바닥 = 기존 정본 수식(L4 가 L3 대체: l4BotZAt / l3BotZAt / L1 두께).
//  - 불러온 몸체(L3 = STEP): 높이맵 재표본 + L4 국부 형상 Δ_L4 = l4BotZAt − (depth − L1 두께).
// 반환 hf 는 makeScene 의 hf(높이 = depth 기준 상대값), ox·oy 는 높이맵 원점의 툴 좌표.
import { l3BotZAt, l4BotZFn, levelParams } from '../../model/levels.js';
import { importedBodyActive, getBody } from './runtime.js';
import { sampleHeightfield } from './heightfield.js';

// 최근접 LED 거리(2D) — 버킷 격자
function nearestFn(leds, cellSize) {
  if (!leds.length) return () => 1e9;
  const B = Math.max(1, cellSize), map = new Map(), key = (i, j) => i * 100003 + j;
  for (const l of leds) { const k = key(Math.floor(l.x / B), Math.floor(l.y / B)); (map.get(k) ?? map.set(k, []).get(k)).push(l); }
  return (x, y) => {
    const i0 = Math.floor(x / B), j0 = Math.floor(y / B);
    let best = Infinity;
    for (let r = 0; r < 6; r++) {
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        const L = map.get(key(i, j)); if (!L) continue;
        for (const l of L) { const d = Math.hypot(x - l.x, y - l.y); if (d < best) best = d; }
      }
      if (best <= r * B) break;
    }
    return Number.isFinite(best) ? best : 1e9;
  };
}

// opt: { leds, pitchX, pitchY, padX, padY, cell }
export function buildBodyGeometry(spec, active, depth, { leds = [], pitchX, pitchY, padX = 0, padY = 0, cell } = {}) {
  const A = active instanceof Set ? active : new Set(active);
  const X = spec.target.xLen, Y = spec.target.yLen;
  const fpX = Math.max(0, padX), fpY = Math.max(0, padY);
  const walls = { x0: -fpX, x1: X + fpX, y0: -fpY, y1: Y + fpY };
  const useL4 = A.has(4), useL3 = A.has(3) && !useL4;
  const thk1 = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  const halfP = Math.max(1, Math.min(pitchX ?? X, pitchY ?? pitchX ?? Y) / 2);
  const near = useL4 ? nearestFn(leds, 2 * halfP) : null;
  const l4z = useL4 ? l4BotZFn(spec, A, depth, halfP) : null;
  const imported = importedBodyActive(spec, [...A]);
  const warnings = [];

  if (imported) {
    const src = getBody().hf, c = src.cell, nx = src.nx, ny = src.ny, N = nx * ny;
    const zt = new Float64Array(N), zb = new Float64Array(N), mask = new Uint8Array(src.mask);
    const minBody = Math.max(1, (spec.body?.baseThk ?? 3) * 0.5);
    let clipped = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!mask[k]) continue;
      zt[k] = src.zt[k]; zb[k] = src.zb[k];
      if (useL4) {
        const x = X / 2 + src.x0 + (i + 0.5) * c, y = Y / 2 + src.y0 + (j + 0.5) * c;
        const d = l4z(near(x, y)) - (depth - thk1);
        let nb = zb[k] + d;
        if (nb > zt[k] - minBody) { nb = zt[k] - minBody; clipped++; }
        zb[k] = Math.max(zb[k], nb);
      }
    }
    if (useL4 && clipped) warnings.push(`L4 국부 형상이 살두께 하한(${minBody}mm)에 닿는 셀 ${clipped}개 — 하한으로 제한`);
    return { hf: { ...src, zt, zb, mask }, ox: X / 2, oy: Y / 2, walls, warnings, imported: true, periodic: false, key: `imp|${getBody().name}|${useL4 ? l4Key(spec, depth, halfP, leds) : ''}` };
  }

  // 생성 평판: 벽 사각형 전체
  const W = walls.x1 - walls.x0, H = walls.y1 - walls.y0;
  // 셀 크기 = 형상 변화 스케일: 평판 2mm(정확, 평면), L3 테이퍼 1mm(완만한 3점 프로필), L4 국부 형상 피치/40(0.2~0.5mm)
  const c = cell ?? Math.max(Math.sqrt((W * H) / 4e5), useL4 ? Math.min(0.5, Math.max(0.2, (2 * halfP) / 40)) : useL3 ? 1 : 2);
  // 정사각 셀(makeScene 가정): 셀 c 고정, 격자는 벽 사각형을 덮도록 최대 반 셀 바깥까지
  const nx = Math.max(2, Math.ceil(W / c - 1e-9)), ny = Math.max(2, Math.ceil(H / c - 1e-9)), N = nx * ny;
  const gx0 = walls.x0 - (nx * c - W) / 2, gy0 = walls.y0 - (ny * c - H) / 2;
  const zt = new Float64Array(N), zb = new Float64Array(N), mask = new Uint8Array(N).fill(1);
  let tmin = Infinity, tmax = -Infinity;
  for (let j = 0; j < ny; j++) {
    const y = gy0 + (j + 0.5) * c;
    for (let i = 0; i < nx; i++) {
      const x = gx0 + (i + 0.5) * c;
      const bot = useL4 ? l4z(near(x, y))
        : useL3 ? l3BotZAt(spec, depth, Math.min(X, Math.max(0, x)), Math.min(Y, Math.max(0, y)))
        : depth - thk1;
      const k = j * nx + i;
      zt[k] = 0; zb[k] = bot - depth;
      const th = -zb[k]; if (th < tmin) tmin = th; if (th > tmax) tmax = th;
    }
  }
  const hf = { nx, ny, cell: c, x0: -nx * c / 2, y0: -ny * c / 2, zt, zb, mask, size: { x: nx * c, y: ny * c, z: tmax }, stats: { thkMin: tmin, thkMax: tmax } };
  const key = `gen|${useL4 ? 'L4' : useL3 ? 'L3' : 'L1'}|${W}|${H}|${nx}|${ny}|${useL4 ? l4Key(spec, depth, halfP, leds) : useL3 ? JSON.stringify(levelParams(spec, 3)) : thk1}|${depth}`;
  return { hf, ox: (walls.x0 + walls.x1) / 2, oy: (walls.y0 + walls.y1) / 2, walls, warnings, imported: false, periodic: useL4, key };
}

function l4Key(spec, depth, halfP, leds) {
  return `${JSON.stringify(levelParams(spec, 4))}|${halfP}|${depth}|${leds.length}|${leds[0]?.x}|${leds[0]?.y}|${leds.at(-1)?.x}|${leds.at(-1)?.y}`;
}

// 높이맵 몸체가 사각형 전체를 덮는가(불러온 몸체는 작을 수 있음) — 정보용
export function bodyCovers(geom, x, y) {
  const s = sampleHeightfield(geom.hf, x - geom.ox, y - geom.oy);
  return !!s;
}
