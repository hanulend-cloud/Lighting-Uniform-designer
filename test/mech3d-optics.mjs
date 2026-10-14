// 3D 기구 부품 광학 물성: node test/mech3d-optics.mjs
import fs from 'node:fs';
import { partOptics, normalRow } from '../src/engine/mech3d/optics.js';
import { defaultPart, setPartMaterial, setPartMaterialParam } from '../src/engine/mech3d/materials.js';
import { l2Material, MUA_RESIN } from '../src/engine/l2/material.js';
import { milkyFromMusR } from '../src/engine/l2/milky.js';
import { createDb } from '../src/model/materials-db.js';
import { loadTable } from './l2-util.mjs';
import { ok, done } from './mech3d-util.mjs';

const table = loadTable();
const db = createDb(JSON.parse(fs.readFileSync(new URL('../data/materials-db.json', import.meta.url))).entries ?? []);
const ctx = { table, db };
const P = (kind, params = {}) => Object.entries(params).reduce((p, [k, v]) => setPartMaterialParam(p, k, v), setPartMaterial(defaultPart(0, 'p', 1), kind));
const rel = (a, b) => Math.abs(a / b - 1);

ok(partOptics(defaultPart(0, 'p', 1), ctx).transmissive === false, '불투명 → 비투과');
{
  const o = partOptics(P('clear'), ctx);
  ok(o.transmissive && o.n === 1.586 && o.mus === 0 && o.mua === 0, `투명(T=1): n ${o.n}, μs ${o.mus}, μa ${o.mua}`);
  const R0 = (0.586 / 2.586) ** 2, o2 = partOptics(P('clear', { T: 0.8, tRef: 2 }), ctx), x = Math.exp(-o2.mua * 2), Tslab = (1 - R0) ** 2 * x / (1 - R0 * R0 * x * x);
  ok(Math.abs(Tslab - 0.8) < 1e-12, `투명 착색 T80%@2mm: μa ${o2.mua.toFixed(5)}, 슬랩 다중반사 T ${Tslab.toFixed(12)}`);
  ok(partOptics(P('clear', { T: 0.95, tRef: 2 }), ctx).mua === 0, '투명 T ≥ 무흡수 슬랩 투과율 → μa 0');
}
{
  const o = partOptics(P('milky', { milky: 3 }), ctx), m = l2Material(table, 3, 1.586);
  ok(rel(o.mus, m.musR / (1 - m.g)) < 1e-12 && o.g === 0.9 && rel(o.mua, m.mua) < 1e-12 && o.phase === null, `추상 Milky 3: μs ${o.mus.toFixed(4)} = L2, g 0.9, HG`);
}
{
  const ent = db.get('covestro-dq5142'), milky = milkyFromMusR(table, ent.fitted.musR);
  const o = partOptics(P('milky', { dbId: ent.id, milky }), ctx);
  ok(rel(o.mus * (1 - o.g), ent.fitted.musR) < 1e-6 && o.g === ent.fitted.g && rel(o.mua, ent.fitted.mua) < 1e-6 && o.n === ent.n,
    `DB DQ5142(Milky ${milky.toFixed(2)}): μs' ${(o.mus * (1 - o.g)).toFixed(4)} = 피팅값, n ${o.n}`);
  ok(o.phase && Math.abs(o.phase.g - ent.fitted.g) < 0.01, `DB Mie 위상함수: g ${o.phase?.g.toFixed(4)} ≈ 피팅 g ${ent.fitted.g.toFixed(4)}`);
  const half = partOptics(P('milky', { dbId: ent.id, milky: milky / 2 }), ctx);
  ok(half.mus < o.mus && half.g === o.g && rel((half.mua - MUA_RESIN) / half.mus, (o.mua - MUA_RESIN) / o.mus) < 1e-6, 'Milky 를 낮추면 μs 와 입자분 μa 가 같은 비율로 줄고 g 는 그대로(농도)');
  const top = partOptics(P('milky', { dbId: ent.id, milky: 10 }), ctx);
  ok(Number.isFinite(top.mus) && Number.isFinite(top.mua) && top.mus > o.mus, `DB Milky 10: 유한값 μs ${top.mus.toFixed(3)}, μa ${top.mua.toFixed(5)}`);
}
{
  const o = partOptics(P('whiteTrans', { T: 0.1, tRef: 1.5 }), ctx);
  const q = table.query(o.mus * (1 - o.g) * 1.5, o.g, o.n, normalRow(table), 0);
  ok(Math.abs(q.Tb + q.Ts - 0.1) < 1e-3 && o.g === 0.9, `반투과 백색 T10%@1.5mm: 표 재계산 T ${(q.Tb + q.Ts).toFixed(4)}`);
}
done();
