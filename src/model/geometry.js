// 기구물 구조 모델 — 프로젝트.md §Stage1
// 확산판 없음. 관찰면 = 기구물 상면(z = depth) + 0.1mm.
// 난이도별 물리/형상은 levels.js 에 위임. 활성 난이도 조합을 반영.

import { classifyDimension, ledPositions } from '../engine/directLit.js';
import { LEVEL_SCHEMA, levelParams, levelEffect, combinedEffect, activeLevels, bodyProfile, effectiveEdgeMargin } from './levels.js';

export { levelEffect, combinedEffect, activeLevels, LEVEL_SCHEMA, effectiveEdgeMargin };
export const scatterMm = (spec, level, depth) => levelEffect(spec, level, depth).blurX;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function buildGeometry(spec, opt = {}) {
  const depth = clamp(opt.depth ?? spec.space.depth, 3, spec.space.depth);
  const pitchX = opt.ledPitch ?? 20;
  const pitchY = opt.ledPitchY ?? pitchX;
  const active = new Set(opt.active ?? activeLevels(spec));
  const ledPadX = opt.padX ?? 0, ledPadY = opt.padY ?? 0;   // 기구물 오버행 — 타겟 밖 LED 배치 폭
  const leds = ledPositions(spec, pitchX, pitchY, opt.decenterX ?? 0, opt.decenterY ?? 0, ledPadX, ledPadY);
  const dim = new Set(leds.map((l) => l.y)).size === 1 ? '1D' : '2D';   // 실제 행 수로 판정

  // 표시 뷰 범위 = 타겟 영역[0,X]×[0,Y] + 여백(3% 또는 LED 오버행 중 더 큰 쪽 — 오버행 LED가
  // 프레임 밖으로 잘리지 않게)
  const X = spec.target.xLen, Y = spec.target.yLen;
  const padX = Math.max(X * 0.03, Math.max(0, ledPadX) * 1.15), padY = Math.max(Y * 0.03, Math.max(0, ledPadY) * 1.15);
  const view = { x0: -padX, x1: X + padX, y0: -padY, y1: Y + padY };

  const p2 = levelParams(spec, 2);
  const p5 = levelParams(spec, 5);
  // 새 L4는 L3처럼 매끈한 도파관 형상이라(부피 확산재가 아님) 밀키 점묘 오버레이를 켜지 않는다.
  const diffuseVisual = active.has(2) && (p2.milky ?? 1) > 1.5;
  const patternVisual = active.has(5)
    ? { type: p5.ptype || 'pyramid',
        sizeX: p5.sizeX ?? 0.3, sizeY: p5.sizeY ?? 0.3,
        pitchX: p5.sizeX ?? 0.3, pitchY: p5.sizeY ?? 0.3,   // pitch = 크기 (패킹)
        angleX: p5.angleX ?? 40, angleY: p5.angleY ?? 40,
        dir: p5.dir ?? '돌출', depth: p5.depth ?? 0.2 }
    : null;

  const tags = [...active].sort().map((l) => `L${l}`);

  return {
    dim, depth, pitch: pitchX, pitchX, pitchY: dim === '1D' ? null : pitchY, obsZ: depth + 0.1,
    beamX: spec.led.beamX, n: spec.body.n,
    leds,
    ledSize: { x: spec.led.sizeX, y: spec.led.sizeY, z: spec.led.sizeZ },
    target: { x: X, y: Y },
    fixture: { x: X + 2 * Math.max(0, ledPadX), y: Y + 2 * Math.max(0, ledPadY) },   // 음수 pad(안쪽 배치)는 기구를 줄이지 않음
    view,
    levelText: tags.length ? tags.join(' + ') : '기본 평판',
    diffuseVisual, patternVisual,
    ledTop: spec.led.sizeZ,
    bodyProfile: (nx = 160) => bodyProfile(spec, [...active], depth, nx),
  };
}
