// 부품 선택 때의 기하 계산 Worker — 간격 표(partClearance)·축별 이동/크기 가능 범위(axisLimits).
// 큰 부품(수만~수십만 삼각형)에서 표본점마다 최근접점·광선·안쪽 판정을 하므로 수 초~수십 초 — 화면 스레드에서 돌리면 '페이지 응답 없음'.
// 메시지: { type:'parts', role:'cur'|'raw'|'led', key, parts:[{positions,triangles}|null] } — 역할마다 마지막 것만 보관(메모리)
//         { type:'lx', id, cur, raw, led, i, oldXf, newXf, emitters } → { id, lx: limitXform 결과 }
//         { type:'q', id, cur, raw, led, i, xf, emitters(간격용), limEmitters(가능 범위용 — LED STEP 일 때만) } → { id, clr, lim } | { id, stale:true }(그사이 장면이 바뀜) | { id, error }
import { partClearance, axisLimits, limitXform } from './clearance.js';

const store = {};   // role → { key, parts }
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'parts') { store[m.role] = { key: m.key, parts: m.parts }; return; }
  if (m.type !== 'q' && m.type !== 'lx') return;
  try {
    const cur = store.cur, raw = store.raw, led = store.led;
    if (cur?.key !== m.cur || raw?.key !== m.raw || (m.led && led?.key !== m.led)) { self.postMessage({ id: m.id, stale: true }); return; }
    const lp = m.led ? led.parts : [], em = m.emitters ?? [];
    if (m.type === 'lx') {   // 크기·위치 바꾸기: 새 간섭이 생기면 간섭 직전까지만(limitXform)
      self.postMessage({ id: m.id, lx: limitXform(raw.parts[m.i], m.oldXf ?? null, m.newXf, cur.parts.map((p, j) => (j === m.i ? null : p)), { ledParts: lp, emitters: em }) });
      return;
    }
    const clr = partClearance(cur.parts, m.i, { ledParts: lp, emitters: em });
    const lim = axisLimits(raw.parts[m.i], m.xf ?? null, cur.parts.map((p, j) => (j === m.i ? null : p)), { ledParts: lp, emitters: m.limEmitters ?? em });
    self.postMessage({ id: m.id, clr, lim });
  } catch (e) { self.postMessage({ id: m.id, error: String(e?.message ?? e) }); }
};
