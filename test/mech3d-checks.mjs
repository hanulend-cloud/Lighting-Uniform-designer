// 설계 점검(합성 형상): node test/mech3d-checks.mjs
import { buildSceneMesh } from '../src/engine/mech3d/runtime.js';
import { defaultPart, setPartMaterial } from '../src/engine/mech3d/materials.js';
import { insidePart, triBoxOverlap, coneDirs, checkInterference, checkReach, checkThinWall, checkLeak, mergeLeak, runGeomChecks } from '../src/engine/mech3d/checks.js';
import { boxMesh, ok, done } from './mech3d-util.mjs';

const mk = (meshes, kinds) => ({ rt: buildSceneMesh('t', meshes), mspec: { parts: kinds.map((k, i) => setPartMaterial(defaultPart(i, `p${i}`, 1), k)) } });

{   // 기본 도구
  const b = buildSceneMesh('t', [boxMesh(0, 0, 0, 10, 10, 10)]).parts[0];
  ok(insidePart(b, [5, 5, 5]) && !insidePart(b, [15, 5, 5]) && !insidePart(b, [5, 5, -0.1]), 'insidePart: 광선 홀짝');
  ok(triBoxOverlap([0, 0, 0], [1, 1, 1], [-5, -5, 0.5], [5, -5, 0.5], [0, 5, 0.5]) && !triBoxOverlap([0, 0, 0], [1, 1, 1], [-5, -5, 1.5], [5, -5, 1.5], [0, 5, 1.5])
    && !triBoxOverlap([0, 0, 0], [1, 1, 1], [2, 2, -5], [2, 2, 5], [5, 5, 0]), '삼각형–상자 겹침(관통 / 위 / 옆)');
  const ds = coneDirs([0, 0, 1], 60, 64);
  ok(ds.length === 64 && ds.every((d) => Math.abs(Math.hypot(...d) - 1) < 1e-12 && d[2] >= 0.5 - 1e-12), 'coneDirs: 단위 벡터 64개, 반각 60° 안');
}
{   // ① 간섭: 바닥판(부품 0) + 리브(x 20~22, 부품 1). LED 1 발광점이 리브 안, LED 1 몸체가 리브와 겹침
  const { rt } = mk([boxMesh(-1, -1, -1, 42, 22, 1), boxMesh(20, 0, 0, 2, 20, 6)], ['opaque', 'opaque']);
  const em = [{ pos: [10, 10, 0], axis: [0, 0, 1] }, { pos: [21, 10, 2], axis: [0, 0, 1] }];
  const bodies = [{ led: 0, lo: [8.5, 8.5, 0], hi: [11.5, 11.5, 1] }, { led: 1, lo: [18.5, 8.5, 0], hi: [21.5, 11.5, 1] }];
  const r = checkInterference({ rt, emitters: em, bodies });
  ok(r.status === 'bad' && r.count === 2 && r.items.some((x) => x.kind === 'inside' && x.led === 1 && x.part === 1) && r.items.some((x) => x.kind === 'overlap' && x.led === 1 && x.part === 1) && !r.items.some((x) => x.led === 0),
    `간섭 검출: ${r.items.map((x) => `${x.kind} LED${x.led}→부품${x.part}`).join(', ')}`);
  const g = checkInterference({ rt, emitters: [em[0]], bodies: [bodies[0]] });
  ok(g.status === 'ok' && g.count === 0, '정상 배치(바닥판에 맞닿음): 오탐 없음');
  ok(checkInterference({ rt, emitters: [], bodies: [] }).status === 'na', 'LED 없음 → na');
  {   // 완전히 파묻힌 LED 몸체(발광점은 표면 위): 삼각형 겹침이 없어도 몸체 중심이 부품 안이면 간섭 1건
    const solid = buildSceneMesh('t', [boxMesh(0, 0, 0, 40, 40, 10)]);
    const b = checkInterference({ rt: solid, emitters: [{ pos: [20, 20, 10.5], axis: [0, 0, 1] }], bodies: [{ led: 0, lo: [18, 18, 3], hi: [22, 22, 5] }] });
    ok(b.status === 'bad' && b.count === 1 && b.items[0].kind === 'body-inside' && b.items[0].part === 0, `완전히 파묻힌 몸체: ${b.items.map((x) => x.kind).join(',')} ${b.count}건`);
  }
}
{   // ② 도달: 커버(20×20, z 10~12, 관측 부품 0), LED (10,10,0) +z 지향각 120°
  const cover = boxMesh(0, 0, 10, 20, 20, 2), em = [{ pos: [10, 10, 0], axis: [0, 0, 1] }], O = new Set([0]);
  const a = mk([cover], ['milky']), r1 = checkReach({ rt: a.rt, mspec: a.mspec, emitters: em, obsParts: O, beam: 120 });
  ok(r1.status === 'ok' && r1.minReach > 0.5 && Math.abs(r1.minDist - 10) < 1e-6, `가림 없음: 도달 ${(r1.minReach * 100).toFixed(0)}%, 거리 ${r1.minDist?.toFixed(3)}mm`);
  const b = mk([cover, boxMesh(4, 4, 3, 12, 12, 1)], ['milky', 'opaque']), r2 = checkReach({ rt: b.rt, mspec: b.mspec, emitters: em, obsParts: O, beam: 120 });
  ok(r2.status === 'warn' && r2.minReach < 0.5 && r2.minDist === null && r2.items[0].blocker === 1, `불투명 가림판: 도달 ${(r2.minReach * 100).toFixed(0)}% → 경고, 가린 부품 ${r2.items[0].blocker}`);
  const c = mk([cover, boxMesh(-5, -5, 5, 30, 30, 1)], ['milky', 'clear']), r3 = checkReach({ rt: c.rt, mspec: c.mspec, emitters: em, obsParts: O, beam: 120 });
  ok(r3.status === 'ok' && r3.minReach === r1.minReach && Math.abs(r3.minDist - 10) < 1e-6, '앞의 투과 부품(투명판)은 통과');
  ok(checkReach({ rt: a.rt, mspec: a.mspec, emitters: em, obsParts: new Set(), beam: 120 }).status === 'na', '관측면 없음 → na');
}
{   // ③ 살두께: 투과 부품만, 0.5mm 판 경고 / 2mm 정상 / 불투명 0.3mm 판은 대상 아님
  const t1 = mk([boxMesh(0, 0, 0, 20, 20, 0.5)], ['clear']), w1 = checkThinWall({ rt: t1.rt, mspec: t1.mspec });
  ok(w1.status === 'warn' && Math.abs(w1.min - 0.5) < 1e-4 && w1.part === 0 && w1.pos, `0.5mm 판: 최소 ${w1.min.toFixed(4)}mm → 경고`);
  const t2 = mk([boxMesh(0, 0, 0, 20, 20, 2), boxMesh(30, 0, 0, 20, 20, 0.3)], ['milky', 'opaque']), w2 = checkThinWall({ rt: t2.rt, mspec: t2.mspec });
  ok(w2.status === 'ok' && Math.abs(w2.min - 2) < 1e-4, `2mm 판 오탐 없음(최소 ${w2.min.toFixed(4)}), 불투명 0.3mm 판 제외`);
  const t3 = mk([boxMesh(0, 0, 0, 5, 5, 5)], ['opaque']);
  ok(checkThinWall({ rt: t3.rt, mspec: t3.mspec }).status === 'na', '투과 부품 없음 → na');
}
{   // ③-b 구 껍데기(극점에 퇴화 삼각형 다수): 면적 0 삼각형이 샘플을 채워 na 가 되면 안 됨
  const shell = (R, t, rings = 180, seg = 360) => {
    const P = [], T = [], F = [];
    const sphere = (r, flip) => {
      const base = P.length / 3;
      for (let i = 0; i <= rings; i++) for (let j = 0; j < seg; j++) { const th = (Math.PI * i) / rings, ph = (2 * Math.PI * j) / seg; const pole = i === 0 || i === rings; P.push(pole ? 0 : r * Math.sin(th) * Math.cos(ph), pole ? 0 : r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)); }   // 극점은 정확히 한 점(퇴화)
      for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
        const a = base + i * seg + j, b = base + i * seg + ((j + 1) % seg), c = base + (i + 1) * seg + j, d = base + (i + 1) * seg + ((j + 1) % seg);
        const tr = flip ? [[a, b, c], [b, d, c]] : [[a, c, b], [b, c, d]];
        for (const q of tr) { T.push(...q); F.push(flip ? 1 : 0); }
      }
    };
    sphere(R, false); sphere(R - t, true);
    return { positions: Float32Array.from(P), triangles: Uint32Array.from(T), faceIds: Uint32Array.from(F), faceCount: 2 };
  };
  const s3 = mk([shell(30, 3)], ['clear']), w3 = checkThinWall({ rt: s3.rt, mspec: s3.mspec });
  ok(w3.status === 'ok' && Math.abs(w3.min - 3) < 0.1, `구 껍데기 3mm(퇴화 삼각형 포함): 최소 ${w3.min?.toFixed(3)}mm, 상태 ${w3.status}`);
  const s5 = mk([shell(30, 0.5)], ['clear']), w5 = checkThinWall({ rt: s5.rt, mspec: s5.mspec });
  ok(w5.status === 'warn' && Math.abs(w5.min - 0.5) < 0.05, `구 껍데기 0.5mm → 경고(최소 ${w5.min?.toFixed(3)})`);
}
{   // ①-b 포팅 LED(투과 부품 안) = 경고, 불투명 안 = 불량, 제외 부품 = 무시, nRays 0 방어
  const body = boxMesh(0, 0, 0, 40, 40, 10), em = [{ pos: [20, 20, 5], axis: [0, 0, 1] }];
  const pt = mk([body], ['clear']), pq = mk([body], ['opaque']);
  const r1 = checkInterference({ rt: pt.rt, mspec: pt.mspec, emitters: em, bodies: [] }), r2 = checkInterference({ rt: pq.rt, mspec: pq.mspec, emitters: em, bodies: [] });
  ok(r1.status === 'warn' && r1.items[0].kind === 'potted' && r2.status === 'bad' && r2.items[0].kind === 'inside', `포팅: 투과 ${r1.status}/${r1.items[0]?.kind}, 불투명 ${r2.status}/${r2.items[0]?.kind}`);
  const r3 = checkInterference({ rt: pq.rt, mspec: pq.mspec, emitters: em, bodies: [{ led: 0, lo: [18, 18, 3], hi: [22, 22, 5] }], exclude: [0] });
  ok(r3.status === 'ok' && r3.count === 0, 'PCB 등 제외 부품(exclude)은 간섭에서 뺌');
  const z = mk([boxMesh(0, 0, 10, 20, 20, 2)], ['milky']);
  ok(checkReach({ rt: z.rt, mspec: z.mspec, emitters: [{ pos: [10, 10, 0], axis: [0, 0, 1] }], obsParts: new Set([0]), beam: 120, nRays: 0 }).items[0].reach <= 1, 'nRays 0 → 1 로 보정(NaN 없음)');
}
{   // ④ 새는 빛: 청크 결과 합산 → 비율·가장 큰 면
  const m = mergeLeak([{ leak: { '2|3': 0.3, '-1|-1': 0.05 }, ledger: { escaped: 1 } }, { leak: { '2|3': 0.1 }, ledger: { escaped: 1 } }]);
  const r = checkLeak({ ...m, maxLeak: 0.2 });
  ok(r.status === 'warn' && Math.abs(r.ratio - 0.225) < 1e-12 && r.worst.part === 2 && r.worst.face === 3 && Math.abs(r.worst.ratio - 0.2) < 1e-12, `새는 빛 ${(r.ratio * 100).toFixed(1)}% > 20% → 경고, 가장 큰 면 부품 2 면 3`);
  ok(checkLeak({ leak: { '1|0': 0.05 }, escaped: 1, maxLeak: 0.2 }).status === 'ok' && checkLeak({ leak: {}, escaped: 0 }).status === 'na', '5% → 정상, 탈출 없음 → na');
}
{   // 묶음 실행: 기준값은 mspec.checks
  const a = mk([boxMesh(0, 0, 10, 20, 20, 0.5)], ['milky']);
  a.mspec.checks = { minWall: 0.4, minReach: 0.5, maxLeak: 0.2 };
  const R = runGeomChecks({ rt: a.rt, mspec: a.mspec, emitters: [{ pos: [10, 10, 0], axis: [0, 0, 1] }], bodies: [], obsParts: new Set([0]), beam: 120 });
  ok(R.interference.status === 'ok' && R.reach.status === 'ok' && R.wall.status === 'ok' && Math.abs(R.wall.min - 0.5) < 1e-4, 'runGeomChecks: 최소 살두께 기준 0.4 이면 0.5mm 정상');
}
done();
