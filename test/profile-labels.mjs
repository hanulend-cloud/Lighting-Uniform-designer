// 조도 프로파일 차트 라벨 테스트 (브라우저 불필요): node test/profile-labels.mjs
// 가짜 canvas/ctx 로 fillText 를 기록해 % 눈금, mm 눈금, 최솟값 수치가 표기되는지 확인.
import { drawProfiles } from '../src/ui/analysis.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

function fakeCtx(texts) {
  const noop = () => {};
  return new Proxy({}, { get(_, k) { if (k === 'fillText') return (t) => texts.push(String(t)); if (k === 'measureText') return (t) => ({ width: t.length * 6 }); return noop; }, set() { return true; } });
}
const listeners = {};
const canvas = { width: 600, height: 240, getBoundingClientRect: () => ({ width: 600, height: 240 }), getContext: () => fakeCtx(texts), addEventListener: (n, f) => { listeners[n] = f; } };
let texts = [];
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { querySelector: () => null };

const nx = 41, ny = 9;
const field = new Float64Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) field[j * nx + i] = 100 - 20 * Math.abs(i / (nx - 1) - 0.5) - 10 * Math.abs(j / (ny - 1) - 0.5);
const leds = []; for (const y of [2, 10, 18]) for (let x = 5; x <= 95; x += 10) leds.push({ x, y });
const res = { field, nx, ny, extent: { x0: 0, x1: 100, y0: 0, y1: 20 }, leds, center: { fx: 0.0127, fy: 0.0127 } };
drawProfiles(canvas, res, 0.8);
const all = texts.join('\n');
ok(/^100%$/m.test(all) && /^90%$/m.test(all) && /^80%$/m.test(all), '세로축 % 눈금(100/90/80…) 표기');
ok(/X축 \(mm\)/.test(all) && /Y축 \(mm\)/.test(all), '가로축 mm 단위 표기');
ok(/^20$/m.test(all) && /^40$/m.test(all) && /^100$/m.test(all), 'X 위치 눈금 값(20/40/…/100) 표기');
ok(/min \d+\.\d% @ \d+\.\dmm/.test(all), '최솟값 수치와 위치(mm) 표기');
ok(/X축 \(mm\) @y=/.test(all) && /Y축 \(mm\) @x=/.test(all), '단면 위치(어느 행/열) 표기');
ok(typeof listeners.mousemove === 'function', '마우스 수치 읽기 리스너 등록');
// 다시 그려도 리스너는 한 번만
texts = []; drawProfiles(canvas, res, 0.8);
ok(Object.keys(listeners).length === 2, '리스너 중복 등록 없음');

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
