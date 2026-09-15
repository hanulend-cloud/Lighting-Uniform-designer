// spec + solveCombo 결과 + buildGeometry 결과 → STEP 텍스트. worker와 Node 테스트가 공유.
// oc(초기화된 opencascade.js 인스턴스)를 인자로 받는다 — 이 파일 자체는 opencascade.js를
// import하지 않는다(로딩 방식은 worker/테스트마다 다르므로).

import { box, translate, fuseAll, coneBump, ridgeBump, shapesToStepText, volumeOf } from './oc-build.js';
import { buildBodySolid } from './step-body.js';
import { l3BotZAt, l4BotZAt, levelParams } from '../model/levels.js';

const PCB_THK = 1; // mm — 스펙에 값이 없어 기본값 사용(설계 문서 §범위)

// 솔리드를 X축 기준 180도 회전시켜 "위로 돌출"하던 형상을 "아래로 돌출"하게 뒤집는다.
// 회전(determinant +1)은 면 방향(orientation)을 그대로 보존한다 — 처음엔 height를 음수로
// 넘겨 꼭짓점만 뒤집으려 했으나, 그건 사실상 Z축 미러(determinant -1)라 면 방향이 반전되어
// Boolean Fuse가 돌기를 "구멍"처럼 취급해 결과 부피가 거의 0이 되는 문제가 실측으로 확인됨
// (body+bump fuse가 1200대신 0.17만 나옴) — 회전으로 바꿔 해결.
function flipDown(oc, shape) {
  const trsf = new oc.gp_Trsf_1();
  const axis = new oc.gp_Ax1_2(new oc.gp_Pnt_3(0, 0, 0), new oc.gp_Dir_4(1, 0, 0));
  trsf.SetRotation_1(axis, Math.PI);
  const xf = new oc.BRepBuilderAPI_Transform_2(shape, trsf, false);
  const moved = xf.Shape();
  axis.delete(); trsf.delete(); xf.delete();
  return moved;
}

// 활성 레벨 조합에서 botZAt(x,y) 함수를 만든다. bodyProfile()과 동일한 우선순위(L4가 L3를 대체).
function makeBotZAt(spec, active, depth, leds, halfP) {
  const A = active instanceof Set ? active : new Set(active);
  if (A.has(4)) {
    const near = (x, y) => leds.length ? Math.min(...leds.map((l) => Math.hypot(x - l.x, y - l.y))) : 1e9;
    return (x, y) => l4BotZAt(spec, A, depth, near(x, y), halfP);
  }
  if (A.has(3)) return (x, y) => l3BotZAt(spec, depth, x, y);
  const baseThk = A.has(1) ? (levelParams(spec, 1).thk ?? spec.body.baseThk) : spec.body.baseThk;
  return () => depth - baseThk;
}

// L5 돌기 하나의 로컬 솔리드(면 방향이 올바른 양의 부피로 나오도록 height 는 항상 양수로
// 빌드) + flipDown 으로 뒤집어 "기구물 하단"(바디 바깥쪽, LED 방향)으로 돌출하게 만든다.
// 로컬 z=0 이 부착면(바디의 하단면과 맞닿는 면).
function buildL5Bump(oc, p5) {
  const sizeX = p5.sizeX ?? 0.3, sizeY = p5.sizeY ?? 0.3, h = p5.depth ?? 0.2;
  const up = p5.ptype === 'dome' ? coneBump(oc, sizeX, sizeY, h, 10)
    : p5.ptype === 'prism' ? ridgeBump(oc, sizeX, sizeY, h)
    : coneBump(oc, sizeX, sizeY, h, 4); // pyramid(기본)
  const down = flipDown(oc, up);
  up.delete();
  return down;
}

// L5 돌기가 놓일 위치(피치 기반 격자, LED 배열과 별개 — sizeX/Y=pitch)를 계산.
function l5Positions(spec, X, Y) {
  const p5 = levelParams(spec, 5);
  const pitchX = Math.max(0.02, p5.sizeX ?? 0.3), pitchY = Math.max(0.02, p5.sizeY ?? 0.3);
  const nx = Math.max(1, Math.round(X / pitchX)), ny = Math.max(1, Math.round(Y / pitchY));
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    out.push({ x: (i + 0.5) * (X / nx), y: (j + 0.5) * (Y / ny) });
  }
  return out;
}

// L5 돌기 예상 개수(확인 다이얼로그용 — 메인 스레드에서 oc 없이도 호출 가능).
export function estimateL5BumpCount(spec, active) {
  const A = active instanceof Set ? active : new Set(active);
  if (!A.has(5)) return 0;
  return l5Positions(spec, spec.target.xLen, spec.target.yLen).length;
}

// 메인 진입점. combo/geom은 solveCombo()/buildGeometry() 결과(main.js run()과 동일 소스).
// onProgress(done, total, label) — 선택적 진행률 콜백.
export function buildStepForSpec(oc, spec, combo, geom, onProgress, activeIn) {
  const active = new Set(activeIn ?? []);
  if (active.size === 0) for (const l of [1, 2, 3, 4, 5]) if (spec.levels[l]?.on) active.add(l);
  const depth = combo.depth;
  const X = spec.target.xLen, Y = spec.target.yLen;

  const halfP = geom.l4HalfP ?? Math.max(1, Math.min(combo.pitchX, combo.pitchY ?? combo.pitchX) / 2);
  const botZAt = makeBotZAt(spec, active, depth, geom.leds, halfP);

  let body = buildBodySolid(oc, { X, Y, topZ: depth, botZAt });

  const shapes = [body];

  // L5 — 돌기를 만들어 바디에 순차 Fuse(dir='오목'이면 Cut 대신, 이번 범위는 '돌출'만 지원
  // 하고 오목은 향후 과제로 미룸 — 설계 문서에 없던 범위 확장이라 별도 처리하지 않음).
  if (active.has(5)) {
    const p5 = levelParams(spec, 5);
    const positions = l5Positions(spec, X, Y);
    const bumps = [];
    let done = 0;
    for (const p of positions) {
      const local = buildL5Bump(oc, p5);
      const z = botZAt(p.x, p.y); // 바디 "하단"면(위치별 실제 두께)에 부착 — 상수 depth(윗면)가 아님
      bumps.push(translate(oc, local, p.x, p.y, z));
      local.delete();
      done++;
      if (onProgress && done % 50 === 0) onProgress(done, positions.length, 'L5 돌기 생성');
    }
    const fused = fuseAll(oc, [body, ...bumps], (i, total) => onProgress?.(i, total, 'L5 돌기 결합'));
    body.delete();               // fuseAll()의 계약: shapes[0](=body)은 호출측이 정리
    for (const b of bumps) b.delete();
    body = fused;
    shapes[0] = fused;
  }

  // LED 박스 — z=0(LED 장착면) 기준, geom.leds가 실제 배치 좌표.
  const ledSize = geom.ledSize ?? { x: spec.led.sizeX, y: spec.led.sizeY, z: spec.led.sizeZ };
  for (const l of geom.leds) {
    const local = box(oc, ledSize.x, ledSize.y, ledSize.z);
    shapes.push(translate(oc, local, l.x - ledSize.x / 2, l.y - ledSize.y / 2, 0));
    local.delete();
  }
  onProgress?.(geom.leds.length, geom.leds.length, 'LED 배치');

  // PCB — 타겟 전체 크기, LED 바로 아래(z<0).
  const pcbLocal = box(oc, X, Y, PCB_THK);
  shapes.push(translate(oc, pcbLocal, 0, 0, -PCB_THK));
  pcbLocal.delete();

  onProgress?.(1, 1, 'STEP 직렬화');
  const stepText = shapesToStepText(oc, shapes);
  const bodyVolume = volumeOf(oc, shapes[0]);
  for (const s of shapes) s.delete();
  return { stepText, solidCount: shapes.length, bodyVolume };
}
