// 슬래브 표 압축 코덱(2026-10-13): Float32 가수 12비트 반올림(상대 오차 ≤1.2e-4 ≪ MC 잡음 ~1e-3) + 바이트 평면 분리(shuffle)
// → gzip(Node zlib / 브라우저 DecompressionStream). 12.9MB → 4.3MB. gzip 은 환경별 호출측에서.
export const TABLE_ENCODING = 'f32m12-shuffle-gzip';
const KEEP = 12;

// Float32Array → 바이트 평면 분리된 Uint8Array(가수 반올림 포함)
export function packTable(f32) {
  const n = f32.length, u = new Uint32Array(Float32Array.from(f32).buffer), drop = 23 - KEEP, half = 1 << (drop - 1), mask = ~((1 << drop) - 1);
  for (let i = 0; i < n; i++) {
    const e = u[i] & 0x7f800000;
    if (e !== 0x7f800000) u[i] = ((u[i] + half) & mask) >>> 0;   // inf·NaN 은 그대로
  }
  const by = new Uint8Array(u.buffer), out = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) out[k * n + i] = by[4 * i + k];
  return out;
}

// 바이트 평면 → Float32Array
export function unpackTable(u8) {
  const n = u8.length / 4, by = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) by[4 * i + k] = u8[k * n + i];
  return new Float32Array(by.buffer);
}
