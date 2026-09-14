// 히트맵 치수 라벨 테스트 (브라우저 불필요): node test/heatmap-labels.mjs
// 가짜 canvas/ctx 로 fillText 호출만 기록해 타겟·계산영역·기구 치수(mm) 가 표기되는지 확인.
import { drawHeatmap } from '../src/ui/heatmap.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail++; };

function fakeCtx(texts) {
  const noop = () => {};
  return new Proxy({}, {
    get(_, k) {
      if (k === 'fillText') return (t) => texts.push(String(t));
      if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'measureText') return (t) => ({ width: t.length * 6 });
      return noop;
    },
    set() { return true; },
  });
}
function fakeCanvas(texts, w = 600, h = 300) {
  return { width: w, height: h, getBoundingClientRect: () => ({ width: w, height: h }), getContext: () => fakeCtx(texts) };
}
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => fakeCanvas([]) };

const nx = 50, ny = 10;
const field = new Float64Array(nx * ny).fill(1);
const base = {
  field, nx, ny, extent: { x0: 0, x1: 1000, y0: 0, y1: 200 },
  leds: [{ x: 10, y: 100 }, { x: 60, y: 100 }], metrics: { U0: 0.78 }, edgeMargin: 0.05,
};

// 1) 오버행 있는 기구
{
  const texts = [];
  drawHeatmap(fakeCanvas(texts), { ...base, fixture: { x: 1040, y: 240 }, view: { x0: -20, x1: 1020, y0: -20, y1: 220 } }, 0.5);
  const all = texts.join('\n');
  ok(/타겟[^\n]*1000\s*[×x]\s*200/.test(all), '타겟 치수 1000×200 mm 표기');
  ok(/계산영역[^\n]*900\s*[×x]\s*180/.test(all), '계산영역 치수 900×180 mm 표기 (마진 5% 제외)');
  ok(/마진[^\n]*50[^\n]*10/.test(all), '마진 mm (X 50 / Y 10) 표기');
  ok(/기구[^\n]*1040\s*[×x]\s*240/.test(all), '기구 치수 1040×240 mm 표기');
  ok(/오버행[^\n]*20/.test(all), '오버행 20 mm 표기');
}
// 2) 오버행 없음(기구=타겟) → 기구 치수도 타겟과 같게 표기, 오버행 표기 없음
{
  const texts = [];
  drawHeatmap(fakeCanvas(texts), { ...base, fixture: { x: 1000, y: 200 } }, 0.5);
  const all = texts.join('\n');
  ok(/기구[^\n]*1000\s*[×x]\s*200/.test(all), '기구=타겟 일 때도 기구 치수 표기');
  ok(!/오버행 \d/.test(all), '오버행 없음 → 오버행 수치 미표기');
}
// 3) 마진 0 → 계산영역=타겟, 마진 표기 없음
{
  const texts = [];
  drawHeatmap(fakeCanvas(texts), { ...base, edgeMargin: 0, fixture: { x: 1000, y: 200 } }, 0.5);
  const all = texts.join('\n');
  ok(/계산영역[^\n]*1000\s*[×x]\s*200/.test(all), '마진 0 → 계산영역=타겟 치수');
}

console.log(fail ? `\n${fail} FAIL` : '\nALL PASS');
process.exit(fail ? 1 : 0);
