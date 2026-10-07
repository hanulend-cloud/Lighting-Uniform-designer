// radix-2 2D FFT 와 실수 컨볼루션 — L2 cavity-solver 용. 크기는 2의 거듭제곱.
export function nextPow2(v) { let p = 1; while (p < v) p <<= 1; return p; }

// 제자리 복소 FFT. inverse 이면 1/N 스케일 포함.
export function fft1d(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function fft2d(re, im, W, H, inverse) {
  const rr = new Float64Array(W), ri = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) { rr[x] = re[o + x]; ri[x] = im[o + x]; }
    fft1d(rr, ri, inverse);
    for (let x = 0; x < W; x++) { re[o + x] = rr[x]; im[o + x] = ri[x]; }
  }
  const cr = new Float64Array(H), ci = new Float64Array(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { cr[y] = re[y * W + x]; ci[y] = im[y * W + x]; }
    fft1d(cr, ci, inverse);
    for (let y = 0; y < H; y++) { re[y * W + x] = cr[y]; im[y * W + x] = ci[y]; }
  }
}

// 커널((2kr+1)², 중심 kr) 을 W×H 에 순환 배치한 스펙트럼
export function kernelSpectrum(kern, kr, W, H) {
  const re = new Float64Array(W * H), im = new Float64Array(W * H), K = 2 * kr + 1;
  for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
    const x = (i - kr + W) % W, y = (j - kr + H) % H;
    re[y * W + x] += kern[j * K + i];
  }
  fft2d(re, im, W, H, false);
  return { re, im, W, H };
}

// img(W×H 실수) ⊛ 커널 — 순환 컨볼루션(랩어라운드 방지 zero-padding 은 호출측 책임)
export function convolve(img, spec) {
  const { W, H } = spec, re = Float64Array.from(img), im = new Float64Array(W * H);
  fft2d(re, im, W, H, false);
  for (let i = 0; i < W * H; i++) {
    const a = re[i], b = im[i];
    re[i] = a * spec.re[i] - b * spec.im[i];
    im[i] = a * spec.im[i] + b * spec.re[i];
  }
  fft2d(re, im, W, H, true);
  return re;
}
