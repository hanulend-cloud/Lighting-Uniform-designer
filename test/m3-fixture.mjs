// CAD UI 시험용 장면: Milky 판(100×6×2, 부품 0) 윗면(면 1) = 관측면, 아래 3mm 에 LED 5개(+z 발광).
import { buildSceneMesh } from '../src/engine/mech3d/runtime.js';
import { composeScene } from '../src/engine/mech3d/job.js';
import { recognizeLine } from '../src/engine/mech3d/line.js';
import { tallyGeometry } from '../src/engine/mech3d/tally.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { defaultLight, defaultObserve, defaultChecks } from '../src/engine/mech3d/defs.js';
import { boxMesh } from './mech3d-util.mjs';

export function plateFixture(table) {
  const plate = boxMesh(0, 0, 0, 100, 6, 2);
  const faces = [{ part: 0, face: 1 }];
  const mspec = {
    name: 't', contacts: [], checks: defaultChecks(),
    parts: [setPartMaterialParam(setPartMaterial(defaultPart(0, '판', 1), 'milky'), 'milky', 3)],
    light: { ...defaultLight(), kind: 'none' },
    observe: { ...defaultObserve(), faces, dir: [0, 0, 1] },
  };
  const rt = buildSceneMesh('t', [plate]), line = recognizeLine([plate], faces, [0, 0, 1]);
  const obs = { ...mspec.observe }, G = tallyGeometry(line, obs);
  const S = composeScene({ rt, mspec, ledParts: null, table, db: null, line });
  const emitters = [10, 30, 50, 70, 90].map((x) => ({ pos: [x, 3, -3], axis: [0, 0, 1], xAxis: [1, 0, 0] }));
  return { plate, mspec, rt, line, obs, G, S, emitters, ledSpec: mspec.light.spec };
}
