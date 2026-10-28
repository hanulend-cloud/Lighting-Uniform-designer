// 측정 txt 읽기: 각도별 BSDF · 파장별 BSDF(3열·표) · 파장별 투과율·반사율(V(λ) 가중)
import { readMeasTxt, photopicV, photopicAverage, measTxtSummary } from '../src/engine/meas-txt.js';
let fail = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
ok(near(photopicV(555), 0.99997, 0.01) && photopicV(300) === 0 && near(photopicV(505), (0.323 + 0.503) / 2), 'V(λ) 표·보간');
const flat = Array.from({ length: 41 }, (_, i) => `${380 + i * 10}\t88.5`).join('\n');
const s = readMeasTxt(`# 투과율\nnm\tT%\n${flat}`);
ok(s.kind === 'spectral' && near(s.value, 0.885) && !s.note, `파장별 투과율(% · 머리글·주석): ${measTxtSummary(s)}`);
const tilt = readMeasTxt('400,0.5\n550,0.9\n700,0.5');
ok(tilt.kind === 'spectral' && tilt.value > 0.8 && tilt.value < 0.9, `V(λ) 가중: 가운데(555 nm)에 무게 → ${tilt.value.toFixed(3)}`);
ok(readMeasTxt('450 0.9\n650 0.9').note.includes('400~700'), '좁은 범위 → 알림');
const a = readMeasTxt('0 1.0\n10 0.9\n-20 0.7\n60 0.1');
ok(a.kind === 'angle' && a.curve.length === 4 && a.curve[0].theta === 0 && a.curve[2].theta === 20, '각도별 BSDF(음수 각 = 절댓값, 정렬)');
const long = [];
for (const nm of [450, 550, 650]) for (const th of [0, 30, 60]) long.push(`${nm},${th},${(nm === 550 ? 2 : 1) * Math.cos(th * Math.PI / 180)}`);
const b = readMeasTxt(long.join('\n'));
ok(b.kind === 'spectralBsdf' && b.nWl === 3 && b.curve.length === 3 && b.curve[0].v > b.curve[2].v, `파장별 BSDF 3열 → V 가중 각분포: ${measTxtSummary(b)}`);
const b2 = readMeasTxt(long.map((l) => { const [n, t, v] = l.split(','); return `${t} ${n} ${v}`; }).join('\n'));
ok(b2.kind === 'spectralBsdf' && near(b2.curve[1].v, b.curve[1].v), '3열 순서(각도, 파장) 도 구분');
const mat = `deg\t450\t550\t650\n0\t1\t2\t1\n30\t0.8\t1.6\t0.8\n60\t0.5\t1\t0.5`;
const m = readMeasTxt(mat);
ok(m.kind === 'spectralBsdf' && m.curve.length === 3 && m.curve[0].theta === 0 && m.curve[0].v > 1, '표 형식(머리글 = 파장, 행 = 각도)');
const m2 = readMeasTxt(`nm\t0\t30\t60\n450\t1\t0.8\t0.5\n550\t2\t1.6\t1\n650\t1\t0.8\t0.5`);
ok(m2.kind === 'spectralBsdf' && near(m2.curve[1].v, m.curve[1].v), '표 형식(머리글 = 각도, 행 = 파장)');
let e1 = ''; try { readMeasTxt('hello'); } catch (e) { e1 = e.message; }
ok(e1.includes('숫자'), '숫자 없음 → 오류');
ok(near(photopicAverage([{ nm: 380, v: 1 }, { nm: 780, v: 1 }]).value, 1), '상수 → 그대로');
console.log(fail ? `${fail} FAIL` : 'all PASS'); process.exit(fail ? 1 : 0);
