// LED 점광원 → 슬래브 하면(z=h) 입사 조도의 각도 밴드 분해 — spec §5.3 ①.
// 격자: 원점 = 기구 외곽 모서리, 셀 중심 ((i+0.5)·step, (j+0.5)·step). 광도 I0·cos^m, 조도 = I·cosθ/r².
// A2 에서는 directLit 의 광원(측벽 이미지 포함)을 그대로 넘겨 이 함수를 재사용한다.
export function bandIrradiance({ sources, m, h, nx, ny, step, table }) {
  const E = Array.from({ length: table.angleRows }, () => new Float64Array(nx * ny));
  for (const s of sources) {
    for (let j = 0; j < ny; j++) {
      const dy = (j + 0.5) * step - s.y;
      for (let i = 0; i < nx; i++) {
        const dx = (i + 0.5) * step - s.x, r2 = dx * dx + dy * dy + h * h, c = h / Math.sqrt(r2);
        E[table.bandOf(c)][j * nx + i] += s.I0 * Math.pow(c, m) * c / r2;
      }
    }
  }
  return E;
}
