"""L2 기준해 생성 — Prahl adding-doubling(iadpython)으로 슬래브 R/T 산출 → src/engine/l2/data/ref-ad.json
사용: pip install iadpython ; python tools/gen-ref-ad.py
조건: n 1.49/1.59, g 0.8/0.9/0.95, τ' 0.05~1000, μa·t 0/0.02, 상·하 공기. (spec §5.5 V1)
"""
import json, pathlib, datetime
import iadpython as iad

cases = []
for n in (1.49, 1.59):
    for g in (0.8, 0.9, 0.95):
        for tauR in (0.05, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 200, 1000):
            for muaT in (0.0, 0.02):
                mus_t = tauR / (1 - g)
                b = mus_t + muaT
                a = mus_t / b
                s = iad.Sample(a=a, b=b, g=g, n=n, n_above=1.0, n_below=1.0, quad_pts=16)
                ur1, ut1, uru, utu = (float(v) for v in s.rt())
                cases.append(dict(n=n, g=g, tauR=tauR, muaT=muaT, UR1=ur1, UT1=ut1, URU=uru, UTU=utu))
out = dict(source='iadpython %s (Prahl adding-doubling), quad_pts=16' % iad.__version__,
           created=datetime.date.today().isoformat(), cases=cases)
p = pathlib.Path(__file__).resolve().parent.parent / 'src/engine/l2/data/ref-ad.json'
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(out, indent=1))
print('wrote', p, len(cases), 'cases')
