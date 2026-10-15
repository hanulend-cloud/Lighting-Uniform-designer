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
done();
