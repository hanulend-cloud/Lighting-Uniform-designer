// 관측 집계·판정 — spec 2026-10-14 §5 (P3 설계 결정 5·6).
// 광자가 관측면을 나간 지점을 기억했다가(onExit), 그 광자가 관측 방향 ±cone 으로 탈출(onEscape)하면 그 지점의 (s,w) 셀에 더한다.
// runMC3D 는 광자를 하나씩 끝까지 추적하므로, onEscape 직전의 마지막 onExit 가 그 광자의 마지막 출사다.

// 셀 면적은 래스터 마스크를 걸으며 구한다(곡선·테이퍼·꺾인 영역에서 (s,w) 셀의 실제 면적은 ds·cell 이 아님).
// w 격자 폭은 영역의 최대 국소 폭(래스터 거리장 최댓값) + 2칸. 유효 = 면적 ≥ 0.5·ds·cell.
export function tallyGeometry(line, obs) {
  const cell = obs.cell ?? 0.5, edge = obs.edgeExcl ?? 0.5, L = line.length, R = line.data.raster;
  const ns = Math.max(1, Math.round(L / cell)), ds = L / ns;
  let dtMax = 0; for (let k = 0; k < R.mask.length; k++) if (R.mask[k] && R.dt[k] > dtMax) dtMax = R.dt[k];
  const wMax = Math.max(line.width / 2, dtMax * R.cell) + 2 * cell, nw = Math.ceil((2 * wMax) / cell), w0 = -nw * cell / 2;
  const area = new Float64Array(ns * nw), pa = R.cell * R.cell, pixOk = new Uint8Array(R.nx * R.ny);
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const k = j * R.nx + i;
    if (!R.mask[k] || (R.dt[k] - 0.5) * R.cell < edge - 1e-9) continue;
    const [s, w] = line.toSW(R.x0 + (i + 0.5) * R.cell, R.y0 + (j + 0.5) * R.cell);
    if (!line.closed && (s < edge || s > L - edge)) continue;
    pixOk[k] = 1;
    let si = Math.floor(s / ds);
    if (line.closed) si = ((si % ns) + ns) % ns; else if (si < 0 || si >= ns) continue;
    const wj = Math.floor((w - w0) / cell);
    if (wj < 0 || wj >= nw) continue;
    area[si * nw + wj] += pa;
  }
  const valid = new Uint8Array(ns * nw);
  for (let k = 0; k < valid.length; k++) if (area[k] >= 0.5 * ds * cell) valid[k] = 1;
  // pixOk: 집계 가능한 래스터 픽셀(마스크 안, 경계에서 edgeExcl 이상, 열린 라인이면 끝 제외) — 집계기가 래스터 없이(Worker) 쓰도록 G 에 담음
  return { ns, nw, ds, cell, w0, valid, area, L, closed: line.closed, pix: { x0: R.x0, y0: R.y0, cell: R.cell, nx: R.nx, ny: R.ny }, pixOk };
}

export function makeAccumulator(G, line, obs) {
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), d = obs.dir ?? line.frame.d, cosC = Math.cos(((obs.cone ?? 10) * Math.PI) / 180);
  const R = G.pix, acc = new Float64Array(G.ns * G.nw), cnt = new Uint32Array(G.ns * G.nw);
  let lx = 0, ly = 0, lz = 0, has = false, lp = -1;
  return {
    acc, cnt,
    // p = 광자 번호(runMC3D 가 마지막 인자로 전달). 탈출 광자가 마지막 출사 광자와 같을 때만 집계 — 흡수·소실된 광자의 낡은 출사점을 쓰지 않는다.
    onExit(part, face, x, y, z, dx, dy, dz, w, p) { has = faces.has(`${part}|${face}`); lx = x; ly = y; lz = z; lp = p; },
    onEscape(x, y, z, dx, dy, dz, w, p) {
      if (!has || lp !== p) return;
      has = false;
      if (dx * d[0] + dy * d[1] + dz * d[2] < cosC) return;
      // 점을 래스터 픽셀 중심으로 맞춘 뒤 분류 — 면적(area)을 픽셀 단위로 센 것과 같은 이산화라서 편향이 없다.
      const [qx, qy] = line.to2D([lx, ly, lz]), pi = Math.floor((qx - R.x0) / R.cell), pj = Math.floor((qy - R.y0) / R.cell);
      if (pi < 0 || pj < 0 || pi >= R.nx || pj >= R.ny || !G.pixOk[pj * R.nx + pi]) return;   // 면적(area)과 같은 규칙 — 마스크 밖·제외 구역 광자는 세지 않음
      const [s, ww] = line.toSW(R.x0 + (pi + 0.5) * R.cell, R.y0 + (pj + 0.5) * R.cell);
      let i = Math.floor(s / G.ds);
      if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return;
      const j = Math.floor((ww - G.w0) / G.cell);
      if (j < 0 || j >= G.nw) return;
      acc[i * G.nw + j] += w; cnt[i * G.nw + j]++;
    },
  };
}

// accs: 배치별 누적(같은 광자 수). 값 = 셀 출사/면적(상대 휘도). 판정은 평균 지도, σ 는 배치 간 분산.
export function tallyStats(G, accs, obs, cnts = null) {
  const B = accs.length, nCell = G.ns * G.nw, area = G.area;
  let nValid = 0; for (let k = 0; k < nCell; k++) if (G.valid[k]) nValid++;
  if (nValid === 0) return { empty: true, profile: new Float64Array(G.ns).fill(NaN), map: new Float64Array(nCell), Ulen: 0, seLen: 0, Uwid: null, seWid: 0, sWorst: null, passLen: false, passWid: false, counted: 0, nbar: 0, noiseWarn: true };
  const colHas = new Uint8Array(G.nw); for (let k = 0; k < nCell; k++) if (G.valid[k]) colHas[k % G.nw] = 1;
  const narrow = colHas.reduce((a, b) => a + b, 0) < 2;
  const mean = new Float64Array(nCell);
  for (const a of accs) for (let k = 0; k < nCell; k++) if (G.valid[k]) mean[k] += a[k] / area[k] / B;
  const profileOf = (m) => {
    const p = new Float64Array(G.ns), wr = new Float64Array(G.ns).fill(NaN);
    for (let i = 0; i < G.ns; i++) {
      let s = 0, c = 0, mn = Infinity, mx = -Infinity;
      for (let j = 0; j < G.nw; j++) if (G.valid[i * G.nw + j]) { const v = m[i * G.nw + j]; s += v; c++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      p[i] = c ? s / c : NaN; if (c >= 2) wr[i] = mx > 0 ? mn / mx : 0;
    }
    return { p, wr };
  };
  const minmax = (arr) => { let mn = Infinity, mx = -Infinity; for (const v of arr) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } return mx > 0 ? mn / mx : 0; };
  const { p, wr } = profileOf(mean);
  const Ulen = minmax(p);
  let Uwid = Infinity, iW = 0; for (let i = 0; i < G.ns; i++) if (Number.isFinite(wr[i]) && wr[i] < Uwid) { Uwid = wr[i]; iW = i; }
  // 배치별 U 의 표준오차(잡음 지표)
  const per = accs.map((a) => { const m = Float64Array.from(a, (v, k) => (G.valid[k] ? v / area[k] : 0)); const q = profileOf(m); let uw = Infinity; for (const v of q.wr) if (Number.isFinite(v)) uw = Math.min(uw, v); return [minmax(q.p), uw]; });
  const se = (k, mu) => Math.sqrt(per.reduce((s, x) => s + (x[k] - mu) ** 2, 0) / Math.max(1, B - 1) / B);
  const mL = per.reduce((s, x) => s + x[0], 0) / B, mW = per.reduce((s, x) => s + x[1], 0) / B;
  const seLen = se(0, mL), seWid = narrow ? 0 : se(1, mW);
  let counted = 0; for (let k = 0; k < nCell; k++) if (G.valid[k] && mean[k] > 0) counted++;
  let nbar = 0;
  if (cnts) { let tot = 0; for (const c of cnts) for (let k = 0; k < nCell; k++) if (G.valid[k]) tot += c[k]; nbar = tot / nValid / B; }
  const nTol = (tg) => Math.max(0.01, 1 - tg) / 3, noisyN = cnts ? nbar <= 0 || 1 / Math.sqrt(nbar) > Math.min(nTol(obs.targetLen), nTol(obs.targetWid)) : false;
  const marginL = Math.abs(Ulen - obs.targetLen), marginW = narrow ? Infinity : Math.abs(Uwid - obs.targetWid);
  return {
    profile: p, map: mean, Ulen, seLen, Uwid: narrow || !Number.isFinite(Uwid) ? null : Uwid, seWid, sWorst: narrow || !Number.isFinite(Uwid) ? null : (iW + 0.5) * G.ds, narrow, nbar,
    passLen: Ulen >= obs.targetLen, passWid: narrow ? null : Uwid >= obs.targetWid, counted,
    noiseWarn: counted === 0 || B < 2 || noisyN || seLen * 3 > Math.max(0.01, marginL) || seWid * 3 > Math.max(0.01, marginW),
  };
}
