// 관측 집계·판정 — spec 2026-10-14 §5 (P3 설계 결정 5·6).
// 광자가 관측면을 나간 지점을 기억했다가(onExit), 그 광자가 관측 방향 ±cone 으로 탈출(onEscape)하면 그 지점의 (s,w) 셀에 더한다.
// runMC3D 는 광자를 하나씩 끝까지 추적하므로, onEscape 직전의 마지막 onExit 가 그 광자의 마지막 출사다.

export function tallyGeometry(line, obs) {
  const cell = obs.cell ?? 0.5, edge = obs.edgeExcl ?? 0.5, L = line.length;
  const ns = Math.max(1, Math.round(L / cell)), ds = L / ns;
  const wMax = line.width / 2 + 2 * cell, nw = Math.ceil((2 * wMax) / cell), w0 = -nw * cell / 2;
  const valid = new Uint8Array(ns * nw);
  for (let i = 0; i < ns; i++) for (let j = 0; j < nw; j++) {
    const s = (i + 0.5) * ds, w = w0 + (j + 0.5) * cell, [x, y] = line.fromSW(s, w);
    if (!line.inside(x, y) || line.boundaryDist(x, y) < edge - 1e-9) continue;
    if (!line.closed && (s < edge || s > L - edge)) continue;
    valid[i * nw + j] = 1;
  }
  return { ns, nw, ds, cell, w0, valid, L, closed: line.closed };
}

export function makeAccumulator(G, line, obs) {
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), d = obs.dir, cosC = Math.cos(((obs.cone ?? 10) * Math.PI) / 180);
  const acc = new Float64Array(G.ns * G.nw);
  let lx = 0, ly = 0, lz = 0, has = false;
  return {
    acc,
    onExit(part, face, x, y, z) { has = faces.has(`${part}|${face}`); lx = x; ly = y; lz = z; },
    onEscape(x, y, z, dx, dy, dz, w) {
      if (!has) return;
      has = false;
      if (dx * d[0] + dy * d[1] + dz * d[2] < cosC) return;
      const [px, py] = line.to2D([lx, ly, lz]), [s, ww] = line.toSW(px, py);
      let i = Math.floor(s / G.ds);
      if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return;
      const j = Math.floor((ww - G.w0) / G.cell);
      if (j < 0 || j >= G.nw) return;
      acc[i * G.nw + j] += w;
    },
  };
}

// accs: 배치별 누적(같은 광자 수). 값 = 셀 출사/면적(상대 휘도). 판정은 평균 지도, σ 는 배치 간 분산.
export function tallyStats(G, accs, obs) {
  const B = accs.length, A = G.ds * G.cell, nCell = G.ns * G.nw;
  const mean = new Float64Array(nCell);
  for (const a of accs) for (let k = 0; k < nCell; k++) mean[k] += a[k] / A / B;
  const profileOf = (m) => {
    const p = new Float64Array(G.ns), wr = new Float64Array(G.ns).fill(NaN);
    for (let i = 0; i < G.ns; i++) {
      let s = 0, c = 0, mn = Infinity, mx = -Infinity;
      for (let j = 0; j < G.nw; j++) if (G.valid[i * G.nw + j]) { const v = m[i * G.nw + j]; s += v; c++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      p[i] = c ? s / c : NaN; if (c) wr[i] = mx > 0 ? mn / mx : 0;
    }
    return { p, wr };
  };
  const minmax = (arr) => { let mn = Infinity, mx = -Infinity; for (const v of arr) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } return mx > 0 ? mn / mx : 0; };
  const { p, wr } = profileOf(mean);
  const Ulen = minmax(p);
  let Uwid = Infinity, iW = 0; for (let i = 0; i < G.ns; i++) if (Number.isFinite(wr[i]) && wr[i] < Uwid) { Uwid = wr[i]; iW = i; }
  // 배치별 U 의 표준오차(잡음 지표)
  const per = accs.map((a) => { const m = Float64Array.from(a, (v) => v / A); const q = profileOf(m); let uw = Infinity; for (const v of q.wr) if (Number.isFinite(v)) uw = Math.min(uw, v); return [minmax(q.p), uw]; });
  const se = (k, mu) => Math.sqrt(per.reduce((s, x) => s + (x[k] - mu) ** 2, 0) / Math.max(1, B - 1) / B);
  const mL = per.reduce((s, x) => s + x[0], 0) / B, mW = per.reduce((s, x) => s + x[1], 0) / B;
  const seLen = se(0, mL), seWid = se(1, mW);
  let counted = 0; for (let k = 0; k < nCell; k++) if (G.valid[k] && mean[k] > 0) counted++;
  const marginL = Math.abs(Ulen - obs.targetLen), marginW = Math.abs(Uwid - obs.targetWid);
  return {
    profile: p, map: mean, Ulen, seLen, Uwid: Number.isFinite(Uwid) ? Uwid : 0, seWid, sWorst: (iW + 0.5) * G.ds,
    passLen: Ulen >= obs.targetLen, passWid: Uwid >= obs.targetWid, counted,
    noiseWarn: seLen * 3 > Math.max(0.01, marginL) || seWid * 3 > Math.max(0.01, marginW),
  };
}
