// 3D MC 추적기 — 에너지 보존(V3D-2)·접촉면 해석해(V3D-6)·전반사 도광: node test/mech3d-mc.mjs
import { runMC3D } from '../src/engine/mech3d/mc3d.js';
import { ledSource, combineSources } from '../src/engine/mech3d/sources.js';
import { buildTraceScene } from '../src/engine/mech3d/scene3d.js';
import { setMech3dMesh, getMech3d } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial, setPartMaterialParam, setPartFinish } from '../src/engine/mech3d/materials.js';
import { loadTable } from './l2-util.mjs';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const table = loadTable(), n = 1.586, R = ((n - 1) / (n + 1)) ** 2;
const part = (i, kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(i, `p${i}`, 1), kind));
const scene = (meshes, parts, contacts = []) => { setMech3dMesh('t', meshes); return buildTraceScene(getMech3d(), { name: 't', parts, contacts }, { table }); };
const beam = { flux: 1, sample: (r) => [4.5 + r(), 4.5 + r(), -1, 0, 0, 1] };   // 1×1mm 수직 평행광(z=−1 → +z)
const balance = (L) => Math.abs(L.emitted + L.rrGain - (L.escaped + L.absSurf + L.absVol + L.lost + L.rrLoss)) / L.emitted;
const transmit = (S, N = 200000) => { let up = 0; const res = runMC3D(S, { source: beam, N, seed: 11, onEscape: (x, y, z, dx, dy, dz, w) => { if (dz > 0) up += w; } }); return { T: up / res.ledger.emitted, L: res.ledger }; };

{   // V3D-6: 판 2장 광학 접촉 = 판 1장, 공기층(맞붙음·0.5mm 떨어짐) = 판 2장
  const T1 = (1 - R) / (1 + R), T2 = (1 - R) / (1 + 3 * R);
  const a = boxMesh(0, 0, 0, 10, 10, 2), b = boxMesh(0, 0, 2, 10, 10, 2), bFar = boxMesh(0, 0, 2.5, 10, 10, 2);
  const c = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'contact' }]));
  ok(Math.abs(c.T - T1) < 0.004, `V3D-6 광학 접촉: T ${c.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  const g = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode: 'air' }]));
  ok(Math.abs(g.T - T2) < 0.004, `V3D-6 맞붙은 공기층: T ${g.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const s = transmit(scene([a, bFar], [part(0, 'clear'), part(1, 'clear')]));
  ok(Math.abs(s.T - T2) < 0.004, `V3D-6 0.5mm 공기층: T ${s.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
  const one = transmit(scene([a], [part(0, 'clear')]));
  ok(Math.abs(one.T - T1) < 0.004, `판 1장: T ${one.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  ok([c, g, s, one].every((x) => x.L.lost === 0 && balance(x.L) < 1e-9), 'V3D-2(투명): 원장 보존, lost 0');
}
{   // 전반사 도광: 100×4×4 투명 바 끝면(x=0)에 30° 입사 → 옆면 누설 없음
  const S = scene([boxMesh(0, 0, 0, 100, 4, 4)], [part(0, 'clear')]);
  const a = Math.PI / 6, src = { flux: 1, sample: (r) => [-1, 1.5 + r(), 1.5 + r() - Math.tan(a), Math.cos(a), 0, Math.sin(a)] };
  let side = 0, end = 0;
  const res = runMC3D(S, { source: src, N: 50000, seed: 3, onExit: (q, f, x, y, z, dx, dy, dz, w) => { if (f === 5) end += w; else if (f !== 4) side += w; } });
  ok(side === 0 && end > 0.85 && balance(res.ledger) < 1e-9, `TIR 도광: 옆면 ${side}, 끝면 ${end.toFixed(3)}`);
}
{   // V3D-2(산란·흡수·반사): Milky 판 + 백색 PCB + 흑색 벽 + LED 2개
  // 부품끼리 면이 겹치지 않게 배치(겹친 면은 P1 접촉면 감지 + contacts 지정이 있어야 의미가 정해짐)
  const plate = boxMesh(-20, -20, 10, 40, 40, 2), pcb = boxMesh(-30, -30, -1, 60, 60, 1), wall = boxMesh(25, -30, 0.5, 2, 60, 12);
  const S = scene([plate, pcb, wall], [part(0, 'milky', { milky: 5 }), setPartFinish(defaultPart(1, 'pcb', 1), null, { kind: 'whiteDiffuse', R: 0.8 }), setPartFinish(defaultPart(2, 'wall', 1), null, { kind: 'black', R: 0.05 })]);
  const src = combineSources([ledSource({ x: -5, y: 0, z: 0 }), ledSource({ x: 5, y: 0, z: 0 })]);
  const res = runMC3D(S, { source: src, N: 40000, seed: 9 });
  const L = res.ledger;
  ok(balance(L) < 1e-9 && L.lost === 0 && L.absVol > 0 && L.absSurf > 0 && L.escaped > 0, `V3D-2: 오차 ${balance(L).toExponential(1)}, 탈출 ${(L.escaped / L.emitted).toFixed(3)}, 체적흡수 ${(L.absVol / L.emitted).toFixed(3)}, 면흡수 ${(L.absSurf / L.emitted).toFixed(3)}`);
  ok(Math.abs(src.flux - 2 * Math.PI) < 1e-9, `광원 광속 = LED 2개 × Lambert π: ${src.flux.toFixed(4)}`);
}
{   // 부분 겹침(접촉면 판정은 점 단위): a 20×20 위에 b 10×10
  const T1 = (1 - R) / (1 + R), a = boxMesh(0, 0, 0, 20, 20, 2), b = boxMesh(0, 0, 2, 10, 10, 2);
  const at = (x0, y0) => ({ flux: 1, sample: (r) => [x0 + r(), y0 + r(), -1, 0, 0, 1] });
  const run = (mode, src) => { let up = 0; const res = runMC3D(scene([a, b], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode }]), { source: src, N: 100000, seed: 4, onEscape: (x, y, z, dx, dy, dz, w) => { if (dz > 0) up += w; } }); return { T: up / res.ledger.emitted, L: res.ledger }; };
  for (const mode of ['air', 'contact']) {
    const o = run(mode, at(14, 14));
    ok(Math.abs(o.T - T1) < 0.004 && o.L.lost === 0 && balance(o.L) < 1e-9, `부분 겹침 ${mode}, b 바깥 광선: T ${o.T.toFixed(4)} (판 1장 ${T1.toFixed(4)}), lost ${o.L.lost}`);
  }
  const i = run('contact', at(4.5, 4.5));
  ok(Math.abs(i.T - T1) < 0.004 && i.L.lost === 0, `부분 겹침 contact, b 안쪽 광선: T ${i.T.toFixed(4)} (4mm 판 1장 ${T1.toFixed(4)})`);
}
{   // 미지정 맞닿은 판 = 광학 접촉(spec §3.4 기본), 부품 순서 무관
  const T1 = (1 - R) / (1 + R), a = boxMesh(0, 0, 0, 10, 10, 2), b = boxMesh(0, 0, 2, 10, 10, 2);
  const x = transmit(scene([a, b], [part(0, 'clear'), part(1, 'clear')]), 100000), y = transmit(scene([b, a], [part(0, 'clear'), part(1, 'clear')]), 100000);
  ok(Math.abs(x.T - T1) < 0.004 && Math.abs(y.T - T1) < 0.004 && x.L.lost === 0 && y.L.lost === 0, `미지정 맞닿음 → 접촉: T ${x.T.toFixed(4)} / 순서 반대 ${y.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
}
{   // 편광 Fresnel: 경사 입사 공기층·판 1장 해석해(비간섭, s/p 분리)
  const rsp = (c) => { const ct = Math.sqrt(1 - (1 - c * c) / (n * n)), rs = (c - n * ct) / (c + n * ct), rp = (n * c - ct) / (n * c + ct); return [rs * rs, rp * rp]; };
  const big = (z, dz) => boxMesh(0, 0, z, 100, 100, dz);
  for (const deg of [50, 70]) {
    const th = deg * Math.PI / 180, [Rs, Rp] = rsp(Math.cos(th));
    const T2 = 0.5 * ((1 - Rs) / (1 + 3 * Rs) + (1 - Rp) / (1 + 3 * Rp)), T1 = 0.5 * ((1 - Rs) / (1 + Rs) + (1 - Rp) / (1 + Rp));
    const src = { flux: 1, sample: (r) => [50 + r() - Math.tan(th), 50 + r(), -1, Math.sin(th), 0, Math.cos(th)] };
    const run = (S) => { let up = 0; const res = runMC3D(S, { source: src, N: 100000, seed: 5, onEscape: (x, y, z, dx, dy, dz, w) => { if (dz > 0) up += w; } }); return { T: up / res.ledger.emitted, L: res.ledger }; };
    const g = run(scene([big(0, 2), big(2, 2)], [part(0, 'clear'), part(1, 'clear')], [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 1e4, mode: 'air' }]));
    const s = run(scene([big(0, 2), big(2.5, 2)], [part(0, 'clear'), part(1, 'clear')]));
    const o = run(scene([big(0, 4)], [part(0, 'clear')]));
    ok(Math.abs(g.T - T2) < 0.006 && Math.abs(s.T - T2) < 0.006, `편광 ${deg}° 공기층: 맞붙음 ${g.T.toFixed(4)}, 0.5mm ${s.T.toFixed(4)} (해석 ${T2.toFixed(4)})`);
    ok(Math.abs(o.T - T1) < 0.006 && [g, s, o].every((x) => x.L.lost === 0 && balance(x.L) < 1e-9), `편광 ${deg}° 판 1장: T ${o.T.toFixed(4)} (해석 ${T1.toFixed(4)})`);
  }
}
{   // 광원 xAxis ∥ axis → 기본 직교축으로 대체
  const s = ledSource({ x: 0, y: 0, z: 0, axis: [1, 0, 0], xAxis: [2, 0, 0], sizeX: 1, sizeY: 1 }), r = (() => { let k = 1; return () => (k = (k * 16807) % 2147483647) / 2147483647; })();
  let bad = 0; for (let i = 0; i < 1000; i++) { const v = s.sample(r); if (!v.every(Number.isFinite) || v[3] < 0) bad++; }
  ok(bad === 0, `광원 xAxis ∥ axis: 비정상 샘플 ${bad}`);
}
{   // Milky 판이 불투명 백색 블록 위에 맞붙음(접촉·공기층): 면 근처 산란 뒤 OFF 이동이 면을 건너뛰면 lost 발생
  const plate = boxMesh(-20, -20, 2, 40, 40, 2), blk = boxMesh(-20, -20, 0, 40, 40, 2), src = ledSource({ x: 0, y: 0, z: 6, axis: [0, 0, -1] });
  for (const mode of ['contact', 'air']) {
    const S = scene([plate, blk], [part(0, 'milky', { milky: 5 }), setPartFinish(defaultPart(1, 'o', 1), null, { kind: 'whiteDiffuse', R: 0.9 })], [{ a: 0, faceA: 0, b: 1, faceB: 1, area: 1600, mode }]);
    const L = runMC3D(S, { source: src, N: 20000, seed: 4 }).ledger;
    ok(L.lost === 0 && balance(L) < 1e-9, `불투명 블록 위 Milky(${mode}): lost ${(L.lost / L.emitted).toExponential(1)}, 면흡수 ${(L.absSurf / L.emitted).toFixed(3)}`);
  }
}
{   // 얇은 부품(0.03~0.1mm): 짝 면 통과는 정확한 (부품, 면)만 — 얇은 판의 반대면을 건너뛰지 않음. 실제 0.03mm 공기 틈(미지정) = 판 2장
  const T1 = (1 - R) / (1 + R), T2 = (1 - R) / (1 + 3 * R);
  for (const th of [0.03, 0.045, 0.1]) for (const mode of [null, 'air']) {
    const x = transmit(scene([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2, 10, 10, th)], [part(0, 'clear'), part(1, 'clear')], mode ? [{ a: 0, faceA: 1, b: 1, faceB: 0, area: 100, mode }] : []), 100000), want = mode ? T2 : T1;
    ok(Math.abs(x.T - want) < 0.004 && x.L.lost === 0, `얇은 판 ${th}mm(${mode ?? '미지정=접촉'}): T ${x.T.toFixed(4)} (해석 ${want.toFixed(4)}), lost ${x.L.lost}`);
  }
  const g = transmit(scene([boxMesh(0, 0, 0, 10, 10, 2), boxMesh(0, 0, 2.03, 10, 10, 2)], [part(0, 'clear'), part(1, 'clear')]), 100000);
  ok(Math.abs(g.T - T2) < 0.004 && g.L.lost === 0, `실제 0.03mm 공기 틈(평면 판정 0.02mm 초과): T ${g.T.toFixed(4)} (판 2장 ${T2.toFixed(4)})`);
}
{   // 모서리 누설: 60° 도광 바(끝면 입사) — 마지막 적중 삼각형 제외(OFF 이동 없음)
  const S = scene([boxMesh(0, 0, 0, 100, 10, 2)], [part(0, 'clear')]), th = Math.PI / 3;
  const src = { flux: 1, sample: (r) => [-1, 4.5 + r(), 0.5 + r() - Math.tan(th), Math.cos(th), 0, Math.sin(th)] };
  let lost = 0; for (const seed of [7, 8, 9]) lost += runMC3D(S, { source: src, N: 100000, seed }).ledger.lost;
  ok(lost === 0, `60° 도광 바 30만 광자: lost ${lost}`);
}
done();
