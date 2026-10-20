// 3D 기구 기본값·보정(CAD UI): node test/m3-defs.mjs
import { defaultLight, defaultObserve, defaultChecks, migrateMech3d } from '../src/engine/mech3d/defs.js';
import { ok, done } from './mech3d-util.mjs';

ok(defaultLight().spec.fluxLm === 0, 'LED 광속 기본 0(상대값)');
const o = defaultObserve();
ok(o.targetLum === null && o.targetNoise === 0.02 && o.cone === 90, `관측 기본: 목표 휘도 없음, 잡음 목표 2%, 원뿔 90° (${JSON.stringify(o)})`);
ok(JSON.stringify(defaultChecks()) === '{"minWall":0.8,"minReach":0.5,"maxLeak":0.2}', '점검 기준 기본값');
const old = {
  light: { kind: 'none', solder: '백색', spec: { model: 'lambertian', beam: 120, sizeX: 2, sizeY: 2 }, step: null, manual: { pcb: { kind: 'depth', depth: 10 }, count: 10, pitch: 0, side: 'direct' } },
  observe: { faces: [], dir: null, cone: 30, edgeExcl: 0.5, targetLen: 0.7, targetWid: 0.6 },
};
migrateMech3d(old);
ok(old.light.spec.fluxLm === 0 && old.observe.targetNoise === 0.02 && old.observe.targetLum === null && old.observe.targetLen === 0.7 && old.observe.cone === 30 && old.checks.minWall === 0.8,
  'P3 저장값 보정: 새 필드만 채우고 기존 값 유지');
{   // 보정 방어: spec 없음, 잘못된 광속
  const a = { light: { kind: 'none', solder: '백색' }, observe: {} }; migrateMech3d(a);
  ok(a.light.spec.model === 'lambertian' && a.light.spec.fluxLm === 0, 'light.spec 없는 저장값 → 기본 spec');
  const bad = [-5, NaN, 'x', Infinity].map((v) => { const m = { light: { spec: { fluxLm: v } }, observe: {} }; migrateMech3d(m); return m.light.spec.fluxLm; });
  const good = { light: { spec: { fluxLm: 12.5 } }, observe: {} }; migrateMech3d(good);
  ok(bad.every((v) => v === 0) && good.light.spec.fluxLm === 12.5, 'fluxLm: 음수·비수·무한 → 0, 정상값 유지');
}
{ // LED STEP 가상 배치 정리
  const mk = (v) => { const m = { light: { spec: {}, step: { name: 'a', ...(v === undefined ? {} : { virtual: v }) } }, observe: {} }; migrateMech3d(m); return m.light.step.virtual; };
  const a = mk(undefined), b = mk({ count: 6.4, pitch: 15 }), c = mk({ count: 0, pitch: -3 }), d = mk({ count: 'x', pitch: NaN }), e = mk('bad');
  ok(a === null && b.count === 6 && b.pitch === 15 && c.count === 1 && c.pitch === 0 && d.count === 1 && d.pitch === 0 && e === null, `step.virtual 정리: ${JSON.stringify([a, b, c, d, e])}`);
  const n = { light: { spec: {}, step: null }, observe: {} }; migrateMech3d(n);
  ok(n.light.step === null, 'step 없음 → 그대로'); }
{ // 열 배치(rows 1|2, rowGap ≥ 0) 정리 — 직접 배치·가상 배치
  ok(defaultLight().manual.rows === 1 && defaultLight().manual.rowGap === 0, '직접 배치 기본 1열·간격 0');
  const mk = (man, v) => { const m = { light: { spec: {}, manual: man, step: { virtual: v } }, observe: {} }; migrateMech3d(m); return m.light; };
  const a = mk({ count: 5 }, { count: 3, pitch: 0 }), b = mk({ count: 5, rows: 2, rowGap: 4 }, { count: 3, rows: 2, rowGap: 3.5 }), c = mk({ count: 5, rows: 3, rowGap: -1 }, { count: 3, rows: 'x', rowGap: NaN });
  ok(a.manual.rows === 1 && a.manual.rowGap === 0 && a.step.virtual.rows === 1 && a.step.virtual.rowGap === 0, '없으면 1열·0');
  ok(b.manual.rows === 2 && b.manual.rowGap === 4 && b.step.virtual.rows === 2 && b.step.virtual.rowGap === 3.5, '2열·간격 유지');
  ok(c.manual.rows === 1 && c.manual.rowGap === 0 && c.step.virtual.rows === 1 && c.step.virtual.rowGap === 0, `잘못된 값 → 1열·0: ${JSON.stringify([c.manual, c.step.virtual])}`); }
done();
