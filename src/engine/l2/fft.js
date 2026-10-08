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

// 실수 두 장을 복소 FFT 한 번으로: Z = FFT(a + i·b) → A[k] = (Z[k] + Z*[−k])/2, B[k] = (Z[k] − Z*[−k])/(2i).
function splitPair(re, im, W, H) {
  const N = W * H, Ar = new Float64Array(N), Ai = new Float64Array(N), Br = new Float64Array(N), Bi = new Float64Array(N);
  for (let y = 0; y < H; y++) {
    const yn = (H - y) % H;
    for (let x = 0; x < W; x++) {
      const k = y * W + x, kn = yn * W + ((W - x) % W);
      const zr = re[k], zi = im[k], cr = re[kn], ci = -im[kn];       // conj(Z[−k])
      Ar[k] = 0.5 * (zr + cr); Ai[k] = 0.5 * (zi + ci);
      Br[k] = 0.5 * (zi - ci); Bi[k] = -0.5 * (zr - cr);              // (Z − conj)/(2i)
    }
  }
  return [{ re: Ar, im: Ai, W, H }, { re: Br, im: Bi, W, H }];
}

// 두 커널의 스펙트럼을 FFT 한 번으로
export function kernelSpectrumPair(kA, krA, kB, krB, W, H) {
  const re = new Float64Array(W * H), im = new Float64Array(W * H);
  const place = (k, kr, arr) => {
    const K = 2 * kr + 1;
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) arr[((j - kr + H) % H) * W + ((i - kr + W) % W)] += k[j * K + i];
  };
  place(kA, krA, re); place(kB, krB, im);
  fft2d(re, im, W, H, false);
  return splitPair(re, im, W, H);
}

// (a ⊛ kA, b ⊛ kB) 를 FFT 2회(정·역)로 — 결과는 역변환의 실수부·허수부
export function convolvePair(a, b, sA, sB) {
  const { W, H } = sA, N = W * H, re = Float64Array.from(a), im = Float64Array.from(b);
  fft2d(re, im, W, H, false);
  const [A, B] = splitPair(re, im, W, H);
  for (let k = 0; k < N; k++) {
    const pr = A.re[k] * sA.re[k] - A.im[k] * sA.im[k], pi = A.re[k] * sA.im[k] + A.im[k] * sA.re[k];
    const qr = B.re[k] * sB.re[k] - B.im[k] * sB.im[k], qi = B.re[k] * sB.im[k] + B.im[k] * sB.re[k];
    re[k] = pr - qi; im[k] = pi + qr;                                 // P + i·Q
  }
  fft2d(re, im, W, H, true);
  return [re, im];
}
