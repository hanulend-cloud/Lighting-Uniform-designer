// 3D 기구 광원·관측 지정 기본값 — spec 2026-10-14 §4·§5 (P3 계획 "데이터 모델"), 2026-10-15 m3-cad-ui(광속·목표·점검 기준).
export const SOLDER_R = { '백색': 0.8, '녹색': 0.3, '흑색': 0.05 };
export const LED_BODY_FINISH = { kind: 'whiteDiffuse', R: 0.8 };   // 백색 실리콘 패키지

export function defaultLight() {
  return {
    kind: 'none', solder: '백색',
    spec: { model: 'lambertian', beam: 120, sizeX: 2, sizeY: 2, fluxLm: 0 },   // fluxLm: LED 1개 광속(lm), 0 = 상대값
    step: null,
    manual: { pcb: { kind: 'depth', depth: 10 }, count: 10, pitch: 0, side: 'direct' },
  };
}
export function defaultObserve() {
  return { faces: [], dir: null, cone: 90, cell: null, cellS: null, cellW: null, winS: null, edgeExcl: 0.5, targetLen: 0.8, targetWid: 0.8, targetLum: null, targetNoise: 0.02 };
}
// 설계 점검 기준(spec 2026-10-15 §5): 최소 살두께 mm, 최소 도달률(0~1), 새는 빛 한도(0~1)
export function defaultChecks() {
  return { minWall: 0.8, minReach: 0.5, maxLeak: 0.2 };
}
export function migrateMech3d(m) {
  if (!m) return m;
  m.light ??= defaultLight();
  m.observe ??= defaultObserve();
  m.light.spec.fluxLm ??= 0;
  m.observe.targetLum ??= null;
  m.observe.targetNoise ??= 0.02;
  m.checks = { ...defaultChecks(), ...(m.checks ?? {}) };
  return m;
}
