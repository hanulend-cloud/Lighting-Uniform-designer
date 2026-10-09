"""Mie 기준값 — miepython(Prahl) 으로 Qext·Qsca·g 와 위상함수 표본 → src/engine/l2/data/ref-mie.json (spec V10)
사용: pip install miepython ; python tools/gen-ref-mie.py
"""
import json, pathlib, datetime
import numpy as np
import miepython as mp

cases = []
for x in (0.1, 1.0, 5.0, 20.0, 50.0, 100.0):
    # miepython 은 m = n − ik 규약(흡수 = 음의 허수부), BHMIE(mie.js) 는 n + ik — 기록은 k ≥ 0 로 통일
    for n, k in ((1.05, 0.0), (0.94, 0.0), (1.2, 0.0), (0.90, 0.001)):
        m = complex(n, -k)
        qext, qsca, qback, g = (float(v) for v in mp.efficiencies_mx(m, x))
        mu = np.array([1.0, 0.99, 0.9, 0.5, 0.0, -0.5, -1.0])
        s1, s2 = mp.S1_S2(m, x, mu)
        i11 = [float(0.5 * (abs(a) ** 2 + abs(b) ** 2)) for a, b in zip(s1, s2)]
        cases.append(dict(x=x, mRe=n, mIm=k, qext=qext, qsca=qsca, g=g, mu=mu.tolist(),
                          i11rel=[v / i11[0] for v in i11]))   # 위상함수 모양(정면 기준 상대값)
out = dict(source='miepython %s (Prahl)' % mp.__version__, created=datetime.date.today().isoformat(), cases=cases)
p = pathlib.Path(__file__).resolve().parent.parent / 'src/engine/l2/data/ref-mie.json'
p.write_text(json.dumps(out, indent=1))
print('wrote', p, len(cases), 'cases')
