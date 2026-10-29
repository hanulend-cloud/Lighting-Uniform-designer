// LED 지정 도우미 — main.js(P3) 에서 옮김(ledPartsNow·validateLedStep·recognizeLeds·applyStepRecognition·snapLedPick·currentEmitters).
// M = spec.mech3d, S = store.session. 캐시(LED 메쉬 변환·직접 배치 결과)는 모듈 안에 둔다.
import { getMech3d, getLedMesh, clearLedMesh } from '../../engine/mech3d/runtime.js';
import { meshStats, findLeds, findEmitters, pcbIndex, pickLedNearRay, refineEmitterFace, snapRadius } from '../../engine/mech3d/led-detect.js';
import { transformMesh } from '../../engine/mech3d/xform.js';
import { manualLeds } from '../../engine/mech3d/placement.js';
import { stepLayoutOf } from '../../engine/mech3d/virtual-leds.js';
import { validAdjust } from '../../engine/mech3d/led-adjust.js';
import { bounds } from '../../engine/mech3d/mesh.js';

let ledCache = [], manCache = null, layCache = [];
export function resetLedCaches() { ledCache = []; manCache = null; layCache = []; }
export const rawParts = (parts) => parts.map(({ positions, triangles, faceIds, faceCount, volume }) => ({ positions, triangles, faceIds, faceCount, volume }));

// LED STEP 부품(위치 보정 적용 — 화면·인식용, (메쉬, offset, rot) 별 캐시 3칸 LRU: 기구 최적화 ⑤ 후보·미리보기가 현재 위치를 밀어내지 않게). Worker 에는 원본을 보내고 composeScene 이 같은 변환을 한다
function stepPartsNow(M) {
  const st = M?.light?.step, lm = getLedMesh();
  if (!st || !lm?.parts?.length || lm.name !== st.name) return null;
  const key = JSON.stringify([st.offset, st.rot]);
  const c = ledCache.find((x) => x.raw === lm && x.key === key) ?? { raw: lm, key, parts: lm.parts.map((m) => transformMesh(m, st.offset, st.rot)) };
  ledCache = [c, ...ledCache.filter((x) => x !== c)].slice(0, 3);
  return c.parts;
}
// 원래/가상 배치 하나로(spec P4 §2.2a) → { parts, leds, pcb, excluded, emitters, virtual, err? } | null.
// 입력이 같으면 같은 객체(화면 meshKey 비교용). 캐시 4칸(LRU — 기구 최적화 복사본이 화면 항목을 밀어내지 않게). line 이 없으면 원래 배치(개별 조정 없음)
// LED 개별 조정(light.ledAdjust, 배치가 맞을 때만)은 line 이 있을 때 반영 — 결과 adjusted 면 parts 는 조정된 월드 좌표
export function stepLayout(M, line = null) {
  const st = M?.light?.step, parts = stepPartsNow(M);
  if (!st || !parts) return null;
  const adj = line ? validAdjust(M.light) : null, v = st.virtual && line ? st.virtual : null, ln = v || adj ? line : null;
  const key = JSON.stringify([st.leds, st.pcb, st.excluded, (st.emitters ?? []).map((e) => [e.part, e.pos, e.axis, e.xAxis, !!e.needsCheck]), v, adj]);
  let c = layCache.find((x) => x.parts === parts && x.line === ln && x.key === key);
  if (!c) c = { parts, line: ln, key, res: stepLayoutOf({ parts, step: { ...st, virtual: v }, line: ln, adjust: adj }) };
  layCache = [c, ...layCache.filter((x) => x !== c)].slice(0, 4);   // 최근 사용을 앞으로
  return c.res;
}
// 화면·간섭용 LED STEP 부품: line 을 주면 가상 배치 반영, 없으면 원래(인식·클릭 맞춤은 STEP 번호 기준이라 원래)
export function ledPartsNow(M, line = null) { return line ? stepLayout(M, line)?.parts ?? null : stepPartsNow(M); }
// 기준 LED 발광면 → LED·PCB·발광 위치 인식(변환된 메쉬 기준 → 월드 좌표). 상태는 바꾸지 않고 결과만 돌려준다
export function recognizeLeds(M, ref) {
  const parts = ledPartsNow(M);
  if (!parts) throw new Error('LED STEP 메쉬가 없음 — 다시 불러오세요');
  if (!(ref.part >= 0 && ref.part < parts.length)) throw new Error('기준 LED 번호가 범위 밖');
  const vol = (i) => parts[i].volume ?? meshStats(parts[i]).volume;
  const leds = findLeds(parts, ref.part), allLeds = leds.length === parts.length;   // 도면 광원 = 같은 LED 만(PCB 없음) — 부피 최대 판정은 수치 잡음
  if (!allLeds && parts.length > 1 && parts.every((_, i) => vol(i) <= vol(ref.part))) throw new Error('가장 큰 부품(PCB 로 보임)은 기준 LED 가 될 수 없음 — LED 렌즈 면을 클릭하세요');
  const pcb = pcbIndex(parts, leds);
  if (pcb === ref.part) throw new Error('PCB 로 인식된 부품은 기준 LED 가 될 수 없음');
  const emitters = findEmitters(parts, leds, ref.part, ref.face, pcb), bad = emitters.filter((e) => e.needsCheck).length;
  return { leds, pcb, emitters, info: `LED ${leds.length}개 인식${bad ? ` · ⚠ ${bad}개 발광면 확인 필요(제외됨)` : ''} · ${pcb >= 0 ? `PCB = LED STEP 부품 ${pcb + 1}` : 'PCB 없음'}` };
}
export function applyStepRecognition(M, S, st, ref) {
  const r = recognizeLeds(M, ref), same = st.ref && st.ref.part === ref.part;   // 같은 기준 LED(면만 보정)면 제외 목록 유지
  Object.assign(st, { ref, leds: r.leds, pcb: r.pcb, emitters: r.emitters, excluded: same ? (st.excluded ?? []).filter((i) => r.leds.includes(i)) : [] });
  S.ledInfo = r.info;
}
// 저장된 LED STEP 지정이 메모리의 LED 메쉬와 맞는지 확인 — 다르면 "다시 불러오기 필요" 상태로.
// 반환 { changed(저장 필요), status(상태 띠 문구) }
export function validateLedStep(M, S) {
  const st = M?.light?.step;
  if (!st) return { changed: false, status: '' };
  const lm = getLedMesh(), n = lm?.parts?.length ?? 0, inR = (i) => Number.isInteger(i) && i >= 0 && i < n;
  const ok = lm && lm.name === st.name && (st.leds ?? []).every(inR) && (st.pcb ?? -1) < n && (st.ref == null || inR(st.ref.part))
    && (st.emitters ?? []).every((e) => inR(e.part));
  if (ok) {
    if (!st.ref) return { changed: false, status: '' };
    // 저장된 발광 위치를 다시 검증: 기준 면을 가장 바깥 평행 면으로 보정하고 재인식(솔리드 안 발광 방지 포함)
    const parts = ledPartsNow(M), face = refineEmitterFace(parts[st.ref.part], st.ref.face), changed = face !== st.ref.face;
    try { applyStepRecognition(M, S, st, { part: st.ref.part, face }); return { changed, status: changed ? 'LED 발광면을 렌즈 윗면으로 보정함' : '' }; }
    catch (e) { st.emitters = []; S.ledInfo = `LED 재인식 실패: ${e.message} — LED 발광면을 다시 클릭하세요`; return { changed: false, status: '' }; }
  }
  if (lm && lm.name !== st.name) clearLedMesh();
  // 메쉬가 없거나 이름이 다르면 기준 LED(ref)·제외·가상 배치는 남긴다 — 같은 LED STEP 을 다시 불러오면 importLedStep 이 그 ref 로 재인식.
  // 같은 이름 메쉬인데 번호가 안 맞으면(다른 파일) ref 도 비움
  const keep = !lm || lm.name !== st.name;
  Object.assign(st, { ...(keep ? {} : { ref: null, excluded: [] }), leds: [], pcb: -1, emitters: [] });
  S.ledInfo = '저장된 LED STEP 을 찾을 수 없음 — 다시 불러오세요';
  return { changed: true, status: '' };
}
// LED 선택 맞춤: 빈 곳·PCB(가장 큰 LED STEP 부품)를 눌렀으면 클릭 광선에서 가까운 LED(와 발광면)로 바꾼다.
// 반환 = LED STEP 부품 번호 기준 { part, face, snapped } | null (nMech = 기구 부품 수, 그 이상 번호가 LED STEP 부품)
export function snapLedPick(M, s, nMech, needFace) {
  const parts = ledPartsNow(M);
  // 직접 맞힌 면은 평행한 가장 바깥 면으로 보정(몸체 윗면 → 렌즈 윗면). pickLedNearRay 결과는 이미 보정됨
  const direct = (i) => ({ part: i, face: needFace && parts ? refineEmitterFace(parts[i], s.face) : s.face, snapped: false });
  if (!parts || !s?.ray) return s?.part != null && s.part >= nMech ? direct(s.part - nMech) : null;
  const vol = (i) => parts[i].volume ?? meshStats(parts[i]).volume;
  const big = parts.reduce((b, _, i) => (vol(i) > vol(b) ? i : b), 0), hit = s.part != null && s.part >= nMech ? s.part - nMech : null;
  if (hit != null && (hit !== big || parts.length < 2)) return direct(hit);
  const r = pickLedNearRay(parts, parts.map((_, i) => i).filter((i) => i !== big), s.ray.o, s.ray.d, snapRadius(s.worldPerPixel), needFace ? big : -1);   // 반경 = max(5mm, 14px), 발광면 = 윗면 발광 가정
  if (!r || (needFace && r.face < 0)) return null;
  return { ...r, snapped: true };
}
// 계산에 쓸 발광점: LED STEP = 인식된 것 중 확인 필요·제외 뺀 것, 직접 배치 = 관측 라인 위 배치((라인, 설정, 기구) 별 캐시). 오류는 던진다
export function currentEmitters(M, line) {
  const L = M.light;
  if (L.kind === 'step') {
    const lay = stepLayout(M, line);
    if (lay) return lay.emitters;
    const ex = new Set(L.step?.excluded ?? []); return (L.step?.emitters ?? []).filter((e) => !e.needsCheck && !ex.has(e.part));   // 메쉬 없음
  }
  if (L.kind === 'manual' && line) {
    const adj = validAdjust(L), key = JSON.stringify([L.manual, adj]);   // 개별 조정(배치가 맞을 때만) 포함
    if (!manCache || manCache.line !== line || manCache.key !== key || manCache.rt !== getMech3d()) {
      let em = null, err = null;
      try { em = manualLeds(line, L.manual, getMech3d(), adj); } catch (e) { err = e; }
      manCache = { line, key, rt: getMech3d(), em, err };
    }
    if (manCache.err) throw manCache.err;
    return manCache.em;
  }
  return [];
}
// LED 몸체 외곽 상자(점검 ① 간섭) — 배치(원래/가상)의 LED 중 제외하지 않은 것
export function ledBodies(M, line = null) {
  const lay = M.light.kind === 'step' ? stepLayout(M, line) : null;
  if (!lay) return [];
  const ex = new Set(lay.excluded);
  return lay.leds.filter((i) => !ex.has(i) && lay.parts[i]).map((i) => { const b = bounds(lay.parts[i].positions); return { led: i, lo: b.slice(0, 3), hi: b.slice(3) }; });
}
