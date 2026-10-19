// 저장된 3D 설정 복원(브라우저 저장소가 비워져 메쉬만 사라진 경우) — 순수 판정 로직.
// pending = 메쉬 없이 남은 spec.mech3d, fresh = 다시 불러온 메쉬로 만든 initialMech3dSpec().
const TOL = 0.01;   // 부품 부피·크기 허용 오차(상대 1%)
const near = (a, b, abs = 0) => !(Number.isFinite(a) && Number.isFinite(b)) || Math.abs(a - b) <= Math.max(abs, TOL * Math.max(Math.abs(a), Math.abs(b)));

// meshParts: [{ volume?, size? }] — 부품 수가 같고, 양쪽에 있는 부피·크기가 1% 안이면 같은 기구
export function matchesPending(pending, meshParts) {
  const P = pending?.parts;
  if (!Array.isArray(P) || !Array.isArray(meshParts) || P.length !== meshParts.length || !P.length) return false;
  return P.every((p, i) => {
    const q = meshParts[i] ?? {};
    if (!near(p?.volume, q.volume)) return false;
    if (Array.isArray(p?.size) && Array.isArray(q.size)) return p.size.every((v, k) => near(v, q.size[k], 0.01));
    return true;
  });
}

const ckey = (c) => `${c.a}|${c.faceA}|${c.b}|${c.faceB}`;
// 같은 기구면 저장 설정을 새 메쉬 기준 spec 에 덮어써 돌려준다(아니면 null).
// 부품: 저장된 소재·면처리·xform·shapeMod·이름 + 새 메쉬의 id·volume·size. 접촉면: 새로 찾은 목록에 같은 면 키의 mode.
// light(LED STEP 포함)·observe·checks 등 그 밖의 최상위 값은 저장된 것을 그대로.
export function restorePending(pending, fresh) {
  if (!fresh || !matchesPending(pending, fresh.parts)) return null;
  const out = structuredClone(pending);
  out.name = fresh.name ?? out.name;
  out.parts = fresh.parts.map((p, i) => ({ ...structuredClone(pending.parts[i]), id: p.id, volume: p.volume, ...(p.size ? { size: p.size } : {}) }));
  const mode = new Map((pending.contacts ?? []).map((c) => [ckey(c), c.mode]));
  out.contacts = (fresh.contacts ?? []).map((c) => ({ ...c, mode: mode.get(ckey(c)) ?? c.mode }));
  return out;
}
