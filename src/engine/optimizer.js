// 1차 최적화 엔진 — 프로젝트.md §3.5
// coarse grid 탐색 → 제약 필터 → Pareto front → Top 2 선정

import { computeField } from './directLit.js';
import { metrics, localGradient } from './uniformity.js';
import { estimate } from './cost.js';
import { scatterMm } from '../model/geometry.js';

const GRID_N = 21; // 최적화용 저해상 격자 (미리보기는 별도 고해상)

export function optimize(spec) {
  const maxD = Math.max(3, spec.space.depth);
  const depthList = linspace(Math.max(3, maxD * 0.4), maxD, 3);
  const pitchList = linspace(spec.opt.pitchMin, spec.opt.pitchMax, 5);
  const levels = spec.opt.difficultyLevels ?? [1, 2, 3, 4, 5];
  const { U0, cvMax, gradMax } = spec.goal;

  const rows = [];
  for (const depth of depthList) {
    for (const pitch of pitchList) {
      for (const lvl of levels) {
        const blurMm = scatterMm(spec, lvl, depth);
        const f = computeField(spec, { depth, pitchX: pitch, pitchY: pitch, nx: GRID_N, ny: GRID_N, blurMm });
        const m = metrics(f.field);
        const grad = localGradient(f.field, f.nx, f.ny);
        const cost = estimate(spec, { ledCount: f.leds.length, difficultyLevel: lvl });
        rows.push({
          depth, pitch, level: lvl, dim: f.dim, ledCount: f.leds.length,
          U0: m.U0, cv: m.cv, grad, minMax: m.minMax,
          unitCost: cost.unit, difficulty: cost.difficultyScore, breakdown: cost.breakdown,
          feasible: m.U0 >= U0 && m.cv <= cvMax && grad <= gradMax,
        });
      }
    }
  }

  const feas = rows.filter(r => r.feasible);
  const pool = feas.length ? feas : rows;
  const pareto = paretoFront(pool);

  // Top 2: ① 최저비용 실현안  ② 균일도 여유 확보안 (§3.5)
  const byCost = [...pareto].sort((a, b) => a.unitCost - b.unitCost);
  const byU0 = [...pareto].sort((a, b) => b.U0 - a.U0);
  const top2 = uniq([byCost[0], byU0[0]]).slice(0, 2).map(tagReason);

  return { rows, pareto, top2, feasibleCount: feas.length, sensitivity: sensitivity(rows) };
}

function tagReason(r, i) {
  return { ...r, reason: i === 0 ? '최저비용 실현안' : '균일도 여유 확보안' };
}

function paretoFront(rows) {
  return rows.filter(r => !rows.some(o =>
    o !== r &&
    o.unitCost <= r.unitCost && o.difficulty <= r.difficulty && o.U0 >= r.U0 &&
    (o.unitCost < r.unitCost || o.difficulty < r.difficulty || o.U0 > r.U0)));
}

// 변수별 균일도 민감도 (범위 내 U0 변화폭)
function sensitivity(rows) {
  const span = (key) => {
    const by = new Map();
    for (const r of rows) {
      const k = r[key];
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r.U0);
    }
    const means = [...by.values()].map(a => a.reduce((x, y) => x + y, 0) / a.length);
    return Math.max(...means) - Math.min(...means);
  };
  return { pitch: span('pitch'), depth: span('depth'), level: span('level') };
}

function uniq(a) { return a.filter((v, i) => v && a.indexOf(v) === i); }
function linspace(a, b, n) { return Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1)); }
