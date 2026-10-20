// 3D 기구 광원·관측 지정 기본값 — spec 2026-10-14 §4·§5 (P3 계획 "데이터 모델"), 2026-10-15 m3-cad-ui(광속·목표·점검 기준).
export const SOLDER_R = { '백색': 0.8, '녹색': 0.3, '흑색': 0.05 };
export const LED_BODY_FINISH = { kind: 'whiteDiffuse', R: 0.8 };   // 백색 실리콘 패키지

export function defaultLight() {
  return {
    kind: 'none', solder: '백색',
    spec: { model: 'lambertian', beam: 120, sizeX: 2, sizeY: 2, fluxLm: 0 },   // fluxLm: LED 1개 광속(lm), 0 = 상대값
    step: null,
    manual: { pcb: { kind: 'depth', depth: 10 }, count: 10, pitch: 0, side: 'direct', rows: 1, rowGap: 0 },   // rows 1|2, rowGap = 열 간격 ±δ mm
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
  m.light.spec ??= defaultLight().spec;
  const f = Number(m.light.spec.fluxLm);
  m.light.spec.fluxLm = Number.isFinite(f) && f > 0 ? f : 0;
  m.observe.targetLum ??= null;
  m.observe.targetNoise ??= 0.02;
  m.checks = { ...defaultChecks(), ...(m.checks ?? {}) };
  // 열 배치(spec P4 §2.2b): rows 1|2(그 밖 = 1), rowGap 유한 ≥ 0(그 밖 = 0). 라인 반폭 제한은 배치 때
  const rowsOf = (o) => { const g = Number(o?.rowGap); return { rows: o?.rows === 2 ? 2 : 1, rowGap: Number.isFinite(g) && g > 0 ? g : 0 }; };
  if (m.light.manual && typeof m.light.manual === 'object') Object.assign(m.light.manual, rowsOf(m.light.manual));
  const st = m.light.step;   // LED STEP 가상 배치(spec P4 §2.2a): { count 정수 ≥ 1, pitch ≥ 0, rows, rowGap } | null
  if (st) {
    const v = st.virtual, c = Math.round(Number(v?.count)), p = Number(v?.pitch);
    st.virtual = v && typeof v === 'object' ? { count: Number.isFinite(c) && c >= 1 ? c : 1, pitch: Number.isFinite(p) && p > 0 ? p : 0, ...rowsOf(v) } : null;
  }
  // ④ 반사 소재(spec P4 §2.3d·§2.3e): finishCatalog = 배열만(mount 에서 DB 사용자 항목으로 이관) · 부품 reflMaterial = 불투명 + id 문자열 · coating = id 문자열 — 그 밖은 지움
  // (id 가 DB 에 있는지는 여기서 보지 않음 — 사용자 항목은 브라우저 DB 에만 있음. 없는 id 는 상한 없음으로 취급)
  if (m.finishCatalog != null && !Array.isArray(m.finishCatalog)) delete m.finishCatalog;
  const isId = (v) => typeof v === 'string' && v.length > 0;
  for (const p of Array.isArray(m.parts) ? m.parts : []) {
    if (!p) continue;
    if (p.reflMaterial != null && !(p.material?.kind === 'opaque' && isId(p.reflMaterial))) delete p.reflMaterial;
    if (p.coating != null && !isId(p.coating)) delete p.coating;
  }
  return m;
}
