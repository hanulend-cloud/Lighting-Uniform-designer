// 속성 패널 — spec 2026-10-15 m3-cad-ui §2: 피처 트리에서 고른 노드의 편집기만 보인다(기존 편집기를 노드별로 재사용).
// ui = { dbList, catalog(반사 소재표 행), auto, dir, lineInfo, meshInfo(고른 부품 실제 메쉬 외곽·부피) }, h = app.js propHandlers()
import { renderPartProps, renderContactsProps } from '../mech3d-panel.js';
import { catalogOf } from '../../engine/mech3d/housing-led.js';
import { renderLightProps, renderLedProps, renderObserveProps, renderTargetProps } from '../mech3d-light-panel.js';

export function renderPropertyPanel(el, M, S, ui, h) {
  const id = S.node ?? 'parts';
  if (id.startsWith('part:')) {
    const i = +id.slice(5);
    renderPartProps(el, M, { part: i, face: S.sel?.part === i ? S.sel.face : null, clearance: ui.clearance, xfMsg: ui.xfMsg, xfInfo: ui.xfInfo, meshInfo: ui.meshInfo ?? null, catalog: ui.catalog ?? catalogOf(null) }, ui.dbList, h);
    return;
  }
  switch (id) {
    case 'light': renderLightProps(el, M, { pick: S.pick, ledInfo: S.ledInfo, line: S.line }, h); return;
    case 'leds': renderLedProps(el, M, { pick: S.pick, ledInfo: S.ledInfo, line: S.line, lay: ui.lay ?? null, led: ui.led ?? null, ledTotal: ui.ledTotal ?? 0 }, h); return;
    case 'obs': renderObserveProps(el, M, { pick: S.pick, lineInfo: ui.lineInfo, lineErr: S.lineErr, auto: ui.auto, dir: ui.dir }, h); return;
    case 'target': renderTargetProps(el, M, h, ui.catalog ?? catalogOf(null)); return;
    case 'contacts': renderContactsProps(el, M, h); return;
    default: el.innerHTML = '<div class="m3-h">부품</div><div class="mut">부품을 피처 트리나 3D 뷰에서 고르면 소재·면 처리를 편집합니다.</div>';
  }
}
