// 관측 집계·판정 — spec 2026-10-14 §5 (P3 설계 결정 5·6).
// 광자가 관측면을 나간 지점을 기억했다가(onExit), 그 광자가 관측 방향 ±cone 으로 탈출(onEscape)하면 그 지점의 (s,w) 셀에 더한다.
// runMC3D 는 광자를 하나씩 끝까지 추적하므로, onEscape 직전의 마지막 onExit 가 그 광자의 마지막 출사다.

// 격자: s 칸 = obs.cellS ?? max(1, L/100), w 칸 = obs.cellW ?? max(0.5, 최대폭/8). obs.cell 이 있으면 둘 다 그 값(구버전 호환).
// 셀 면적은 래스터 마스크를 걸으며 구한다(곡선·테이퍼·꺾인 영역에서 (s,w) 셀의 실제 면적은 ds·cw 가 아님).
// w 격자 폭은 영역의 최대 국소 폭(래스터 거리장 최댓값) + 2칸. 유효 = 면적 ≥ 0.5·ds·cw.
export function tallyGeometry(line, obs) {
  const edge = obs.edgeExcl ?? 0.5, L = line.length, R = line.data.raster;
  let dtMax = 0; for (let k = 0; k < R.mask.length; k++) if (R.mask[k] && R.dt[k] > dtMax) dtMax = R.dt[k];
  const maxHalf = Math.max(line.width / 2, dtMax * R.cell);
  const cellS = obs.cell ?? obs.cellS ?? Math.max(1, L / 100), cell = obs.cell ?? obs.cellW ?? Math.max(0.5, (2 * maxHalf) / 8);   // cell = w 칸
  const ns = Math.max(1, Math.round(L / cellS)), ds = L / ns;
  const nw = Math.ceil((2 * (maxHalf + 2 * cell)) / cell), w0 = -nw * cell / 2;
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
  return { ns, nw, ds, cell, w0, valid, area, L, closed: line.closed, winS: obs.winS ?? Math.max(5, L / 10), pix: { x0: R.x0, y0: R.y0, cell: R.cell, nx: R.nx, ny: R.ny }, pixOk };
}

// rw = { C: rwCoeffs 결과 } | null — 있으면 관측 셀에 집계되는 탈출마다 Milky 격자 j 별 가중 w·f_j 도 더한다(acc 와 같은 셀 배열을 격자 수만큼 이어 붙임)
export function makeAccumulator(G, line, obs, rw = null) {
  const faces = new Set(obs.faces.map((f) => `${f.part}|${f.face}`)), d = obs.dir ?? line.frame.d, cosC = Math.cos(((obs.cone ?? 10) * Math.PI) / 180);
  const R = G.pix, nCell = G.ns * G.nw, acc = new Float64Array(nCell), cnt = new Uint32Array(nCell);
  const C = rw?.C ?? null, nJ = C ? C.n : 0, racc = C ? new Float64Array(nJ * nCell) : null, sf = C ? new Float64Array(nJ) : null, sf2 = C ? new Float64Array(nJ) : null;
  let lx = 0, ly = 0, lz = 0, has = false, lp = -1, nRw = 0;
  const acc_ = {
    acc, cnt,
    get rw() { return C ? { acc: racc, sf, sf2, n: nRw } : null; },
    // p = 광자 번호(runMC3D 가 마지막 인자로 전달). 탈출 광자가 마지막 출사 광자와 같을 때만 집계 — 흡수·소실된 광자의 낡은 출사점을 쓰지 않는다.
    onExit(part, face, x, y, z, dx, dy, dz, w, p) { has = faces.has(`${part}|${face}`); lx = x; ly = y; lz = z; lp = p; },
    onEscape(x, y, z, dx, dy, dz, w, p, tL = 0, tK = 0) {   // tL/tK 는 runMC3D 의 track 옵션이 줌 — rw 인데 track 없으면 모든 f = 1
      if (!has || lp !== p) return;
      has = false;
      if (dx * d[0] + dy * d[1] + dz * d[2] < cosC) return;
      add(lx, ly, lz, w, tL, tK);
    },
  };
  // 점 → (s,w) 칸에 더함. 점을 래스터 픽셀 중심으로 맞춘 뒤 분류 — 면적(area)을 픽셀 단위로 센 것과 같은 이산화라서 편향이 없다.
  function add(lx, ly, lz, w, tL, tK) {
    {
      const [qx, qy] = line.to2D([lx, ly, lz]), pi = Math.floor((qx - R.x0) / R.cell), pj = Math.floor((qy - R.y0) / R.cell);
      if (pi < 0 || pj < 0 || pi >= R.nx || pj >= R.ny || !G.pixOk[pj * R.nx + pi]) return;   // 면적(area)과 같은 규칙 — 마스크 밖·제외 구역 광자는 세지 않음
      const [s, ww] = line.toSW(R.x0 + (pi + 0.5) * R.cell, R.y0 + (pj + 0.5) * R.cell);
      let i = Math.floor(s / G.ds);
      if (G.closed) i = ((i % G.ns) + G.ns) % G.ns; else if (i < 0 || i >= G.ns) return;
      const j = Math.floor((ww - G.w0) / G.cell);
      if (j < 0 || j >= G.nw) return;
      const k = i * G.nw + j;
      acc[k] += w; cnt[k]++;
      if (C) {
        nRw++;
        for (let g = 0; g < nJ; g++) { const f = Math.exp(tK * C.lr[g] - C.dm[g] * tL); racc[g * nCell + k] += w * f; sf[g] += f; sf2[g] += f * f; }
      }
    }
  }
  return acc_;
}

// accs: 배치별 누적(같은 광자 수). 값 = 셀 출사/면적(상대 휘도).
// 길이 U: s 칸별(폭 방향 유효 셀 면적가중 평균)의 min/max. 폭 U: s 창(길이 winS, 유효 s 범위를 균등 분할, 닫힌 경로는 순환)마다
//   창 평균 폭 프로파일(w 칸별 Σ출사/Σ면적, 창 안 면적이 가득 찬 값의 ≥ 50% 인 w 칸만)의 min/max 를 구하고 그 최저를 취한다.
// relNoise = 집계 칸별 (배치 간 표준편차/평균)/√B 의 중앙값 — min/max 의 낮은 쪽 편향을 만드는 칸 잡음의 크기.
export function tallyStats(G, accs, obs, cnts = null) {
  const B = accs.length, nCell = G.ns * G.nw, { ns, nw, ds, area, valid } = G;
  let nValid = 0; for (let k = 0; k < nCell; k++) if (valid[k]) nValid++;
  const empty = { empty: true, profile: new Float64Array(ns).fill(NaN), map: new Float64Array(nCell), Ulen: 0, seLen: null, Uwid: null, seWid: null, sWorst: null, passLen: false, passWid: false, counted: 0, nbar: 0, relNoise: null, noiseWarn: true, win: null };
  if (nValid === 0) return empty;
  // s 창 분할
  let i0 = 0, i1 = ns - 1;
  if (!G.closed) { while (i0 < ns && !rowHas(i0)) i0++; while (i1 > i0 && !rowHas(i1)) i1--; }
  function rowHas(i) { for (let j = 0; j < nw; j++) if (valid[i * nw + j]) return true; return false; }
  const span = G.closed ? ns : i1 - i0 + 1, wb = Math.max(1, Math.round((G.winS ?? 5) / ds)), nWin = Math.max(1, G.closed ? Math.round(ns / wb) : Math.floor(span / wb));
  const wins = Array.from({ length: nWin }, (_, k) => [i0 + Math.round((k * span) / nWin), i0 + Math.round(((k + 1) * span) / nWin)]);
  const analyze = (a) => {   // a: 합산 또는 배치 누적(Float64Array)
    const p = new Float64Array(ns).fill(NaN);
    for (let i = 0; i < ns; i++) { let s = 0, ar = 0; for (let j = 0; j < nw; j++) if (valid[i * nw + j]) { s += a[i * nw + j]; ar += area[i * nw + j]; } if (ar > 0) p[i] = s / ar; }
    let mn = Infinity, mx = -Infinity; for (const v of p) if (Number.isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    const Ulen = mx > 0 ? mn / mx : 0;
    let Uwid = Infinity, iWin = -1;
    wins.forEach(([s0, s1], wi) => {
      const col = [];
      for (let j = 0; j < nw; j++) {
        let s = 0, ar = 0; for (let i = s0; i < s1; i++) { const ii = i % ns, k = ii * nw + j; s += a[k]; ar += area[k]; }
        if (ar >= 0.5 * (s1 - s0) * ds * G.cell) col.push(s / ar);
      }
      if (col.length < 2) return;
      const cm = Math.min(...col), cx = Math.max(...col), u = cx > 0 ? cm / cx : 0;
      if (u < Uwid) { Uwid = u; iWin = wi; }
    });
    return { p, Ulen, Uwid: iWin < 0 ? null : Uwid, iWin };
  };
  const sum = new Float64Array(nCell); for (const a of accs) for (let k = 0; k < nCell; k++) sum[k] += a[k];
  const main = analyze(sum), narrow = main.Uwid === null;
  const mean = new Float64Array(nCell); for (let k = 0; k < nCell; k++) if (valid[k]) mean[k] = sum[k] / B / area[k];
  const per = accs.map(analyze);
  const sd = (k) => { const v = per.map((x) => x[k]).filter((x) => x !== null); if (v.length < 3) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1) / v.length); };
  const seLen = B < 3 ? null : sd('Ulen'), seWid = B < 3 || narrow ? null : sd('Uwid');
  let counted = 0; for (let k = 0; k < nCell; k++) if (valid[k] && sum[k] > 0) counted++;
  const rel = [];
  if (B >= 2) for (let k = 0; k < nCell; k++) if (valid[k] && sum[k] > 0) { let m = sum[k] / B, v = 0; for (const a of accs) v += (a[k] - m) ** 2; rel.push(Math.sqrt(v / (B - 1)) / m / Math.sqrt(B)); }
  rel.sort((x, y) => x - y); const relNoise = rel.length ? rel[rel.length >> 1] : null;
  let nbar = 0; if (cnts) { let tot = 0; for (const c of cnts) for (let k = 0; k < nCell; k++) if (valid[k]) tot += c[k]; nbar = tot / nValid / B; }
  const tol = Math.min(Math.max(0.01, 1 - obs.targetLen), Math.max(0.01, 1 - obs.targetWid));
  return {
    profile: main.p, map: mean, Ulen: main.Ulen, seLen, Uwid: main.Uwid, seWid, sWorst: narrow ? null : ((wins[main.iWin][0] + wins[main.iWin][1]) / 2) * ds, win: narrow ? null : wins[main.iWin], narrow, nbar, relNoise,
    passLen: main.Ulen >= obs.targetLen, passWid: narrow ? null : main.Uwid >= obs.targetWid, counted,
    noiseWarn: counted === 0 || B < 2 || relNoise === null || 3 * relNoise > tol,
  };
}

// 폭 방향 프로파일(창 평균) — tallyStats 의 폭 판정과 같은 규칙: s 칸 [s0, s1)(닫힌 경로는 순환) 의 w 칸별 Σ출사/Σ면적,
// 창 안 면적이 가득 찬 값의 ≥ 50% 인 칸만(아니면 NaN). a: 합산 누적(Float64Array, ns·nw).
export function windowProfile(G, a, s0, s1) {
  const { ns, nw, ds, area } = G, out = new Float64Array(nw).fill(NaN);
  for (let j = 0; j < nw; j++) {
    let s = 0, ar = 0;
    for (let i = s0; i < s1; i++) { const k = (i % ns) * nw + j; s += a[k]; ar += area[k]; }
    if (ar >= 0.5 * (s1 - s0) * ds * G.cell) out[j] = s / ar;
  }
  return out;
}
