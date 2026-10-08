// LED 점광원 → 슬래브 하면(z=h) 입사 조도의 각도 밴드 분해 — spec §5.3 ①.
// 격자: 셀 중심 (x0+(i+0.5)·step, y0+(j+0.5)·step). 조도 = I0·I(cosθ)·cosθ/r².
// intensity(cos) 를 주지 않으면 Lambertian^m. 광원 근처(r < 4·step)에서 h < 2·step 이면 셀을 8×8 로
// 부분 샘플링해 근접장 특이점(점 샘플이 셀 플럭스를 크게 틀리는 것)을 피한다.
export function bandIrradiance({ sources, m = 1, intensity, I0 = 1, h, nx, ny, step, table, x0 = 0, y0 = 0 }) {
  const Ifn = intensity ?? ((c) => Math.pow(c, m));
  const E = Array.from({ length: table.angleRows }, () => new Float64Array(nx * ny));
  const fine = h < 2 * step, near2 = (4 * step) ** 2, SS = 8;
  for (const s of sources) {
    const I = s.I0 ?? I0;
    for (let j = 0; j < ny; j++) {
      const cy = y0 + (j + 0.5) * step;
      for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * step;
        const ddx = cx - s.x, ddy = cy - s.y;
        if (fine && ddx * ddx + ddy * ddy < near2) {
          for (let b = 0; b < SS; b++) for (let a = 0; a < SS; a++) {
            const dx = ddx + ((a + 0.5) / SS - 0.5) * step, dy = ddy + ((b + 0.5) / SS - 0.5) * step;
            const r2 = dx * dx + dy * dy + h * h, c = h / Math.sqrt(r2);
            E[table.bandOf(c)][j * nx + i] += I * Ifn(c) * c / r2 / (SS * SS);
          }
        } else {
          const r2 = ddx * ddx + ddy * ddy + h * h, c = h / Math.sqrt(r2);
          E[table.bandOf(c)][j * nx + i] += I * Ifn(c) * c / r2;
        }
      }
    }
  }
  return E;
}
