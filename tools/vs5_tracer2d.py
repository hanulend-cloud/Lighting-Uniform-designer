"""VS5 독립 추적기 — 압출 단면(y 방향 일정) 몸체 + 선광원(y 방향 무한 LED 열) 3D 몬테카를로.

형상 몸체 spec 2026-10-10 §5 VS5. JS 빠른 solver(src/engine/shape/fast-body.js)와 코드를 공유하지 않는 별도 구현:
기하(단면 꺾은선 교점), Fresnel(s·p 진폭식), Snell, Lambertian 광원, 흡수를 numpy 로 다시 작성했다.
JS 와 공유하는 것은 입력(단면 꼭짓점 목록·물성)뿐이다.

기하: 단면 윗면 z_t(x)·바닥 z_b(x) (꺾은선, 툴 좌표 mm), x ∈ [0, X] 에만 몸체. 몸체 외곽 측면(x=0, X)은 Fresnel 계면
(투과분 = 손실), 공기 영역의 x=0, X 평면 = 흡수 벽, PCB z=0 (ρ_b Lambertian), |y| > Y/2 로 나가면 손실(JS 격자 범위).
JS 높이맵과 같은 유효 기하를 쓰기 위해 '셀 중심 표본 → 꼭짓점 = 인접 셀 중심 평균' 꺾은선을 여기서 다시 계산한다.

사용: python tools/vs5_tracer2d.py case.json out.json
case.json: { "cases": [ { name, X, Y, depth, n, mua, rhoB, xs, cell, top:[[x,z]..], bot:[[x,z]..], N, seed, bins:{x0,x1,dx} } ] }
out.json : { name: { "M": [...], "x": [...], "ledger": {...} } }   M = 단위 선광원 광속당 출사도(1/mm), y 적분
"""
import json
import sys

import numpy as np


def pwl(vertices, x):
    v = np.asarray(vertices, float)
    return np.interp(x, v[:, 0], v[:, 1])


def effective_polyline(vertices, X, cell):
    """JS heightfieldFromFn + makeScene 와 같은 유효 꺾은선(독립 재계산): 셀 중심 표본, 꼭짓점 = 인접 셀 평균."""
    nx = int(round(X / cell))
    c = X / nx
    centers = (np.arange(nx) + 0.5) * c
    f = pwl(vertices, centers)
    corner = np.empty(nx + 1)
    corner[0], corner[-1] = f[0], f[-1]
    corner[1:-1] = 0.5 * (f[:-1] + f[1:])
    xs = np.arange(nx + 1) * c
    # 같은 직선 위 꼭짓점 병합(교점 계산량 감소, 기하 동일)
    keep = [0]
    for k in range(1, nx):
        a, b = keep[-1], k + 1
        z_line = corner[a] + (corner[b] - corner[a]) * (xs[k] - xs[a]) / (xs[b] - xs[a])
        if abs(z_line - corner[k]) > 1e-12:
            keep.append(k)
    keep.append(nx)
    return np.stack([xs[keep], corner[keep]], axis=1)


def fresnel(cos_i, n1, n2):
    sin_t2 = (n1 / n2) ** 2 * (1.0 - cos_i ** 2)
    tir = sin_t2 >= 1.0
    cos_t = np.sqrt(np.clip(1.0 - sin_t2, 0.0, 1.0))
    rs = (n1 * cos_i - n2 * cos_t) / (n1 * cos_i + n2 * cos_t)
    rp = (n2 * cos_i - n1 * cos_t) / (n2 * cos_i + n1 * cos_t)
    R = 0.5 * (rs * rs + rp * rp)
    R[tir] = 1.0
    return R, cos_t, tir


def segs_hit(px, pz, dx, dz, segs, tbest, kind_best, nbest, code):
    """꺾은선 선분들과 (x,z) 평면 교점 — 더 가까우면 갱신. 법선은 (−e_z, e_x)/|e|."""
    for (ax, az), (bx, bz) in zip(segs[:-1], segs[1:]):
        ex, ez = bx - ax, bz - az
        den = dx * ez - dz * ex
        ok = np.abs(den) > 1e-14
        den_s = np.where(ok, den, 1.0)
        qx, qz = ax - px, az - pz
        t = (qx * ez - qz * ex) / den_s
        s = (qx * dz - qz * dx) / den_s
        hit = ok & (t > 1e-9) & (s >= -1e-12) & (s <= 1 + 1e-12) & (t < tbest)
        if hit.any():
            L = np.hypot(ex, ez)
            tbest[hit] = t[hit]
            kind_best[hit] = code
            nbest[0][hit] = -ez / L
            nbest[1][hit] = ex / L


def run_case(cs):
    X, Y, depth, n, mua, rhoB, xs0 = cs["X"], cs["Y"], cs["depth"], cs["n"], cs["mua"], cs["rhoB"], cs["xs"]
    top = effective_polyline(cs["top"], X, cs["cell"])
    bot = effective_polyline(cs["bot"], X, cs["cell"])
    ztmax = top[:, 1].max()
    rng = np.random.default_rng(cs["seed"])
    b = cs["bins"]
    edges = np.arange(b["x0"], b["x1"] + 1e-9, b["dx"])
    hist = np.zeros(len(edges) - 1)
    cnt = np.zeros(len(edges) - 1)
    ns = cs.get("node_s", 0.25)
    nK = int(np.ceil((b["x1"] - b["x0"]) / ns)) + 8
    nodes = np.zeros(2 * nK + 1)   # 노드 x = xs + (k − nK)·ns, 쌍선형(텐트) 분배 — JS PSF 래스터와 같은 필터
    led = dict(emitted=0.0, top=0.0, pcb=0.0, wall=0.0, side=0.0, ylost=0.0, absb=0.0, stuck=0.0)
    N, batch = cs["N"], 200000
    TOP, BOT, XLO, XHI, PCB = 1, 2, 3, 4, 5
    for start in range(0, N, batch):
        m = min(batch, N - start)
        u1, u2 = rng.random(m), rng.random(m)
        ct = np.sqrt(1.0 - u1)                       # Lambertian cos θ
        st = np.sqrt(1.0 - ct * ct)
        ph = 2 * np.pi * u2
        dx, dy, dz = st * np.cos(ph), st * np.sin(ph), ct
        px, py, pz = np.full(m, float(xs0)), np.zeros(m), np.full(m, 1e-6)
        w = np.ones(m)
        inb = np.zeros(m, bool)
        alive = np.ones(m, bool)
        led["emitted"] += m
        for _ in range(400):
            idx = np.nonzero(alive)[0]
            if idx.size == 0:
                break
            x, z, ux, uy, uz, ib = px[idx], pz[idx], dx[idx], dy[idx], dz[idx], inb[idx]
            tb = np.full(idx.size, np.inf)
            kd = np.zeros(idx.size, int)
            nrm = [np.zeros(idx.size), np.zeros(idx.size)]
            segs_hit(x, z, ux, uz, top, tb, kd, nrm, TOP)
            segs_hit(x, z, ux, uz, bot, tb, kd, nrm, BOT)
            with np.errstate(divide="ignore", invalid="ignore"):
                t0 = np.where(ux < 0, -x / ux, np.inf)
                t1 = np.where(ux > 0, (X - x) / ux, np.inf)
                tp = np.where((uz < 0) & ~ib, -z / uz, np.inf)
            for tt, code, nx_ in ((t0, XLO, -1.0), (t1, XHI, 1.0)):
                h = (tt > 1e-9) & (tt < tb)
                tb[h] = tt[h]; kd[h] = code; nrm[0][h] = nx_; nrm[1][h] = 0.0
            h = (tp > 1e-9) & (tp < tb)
            tb[h] = tp[h]; kd[h] = PCB; nrm[0][h] = 0.0; nrm[1][h] = 1.0
            # 사건 없음: 공기 → 위로 탈출(윗면 밖), 몸체 → 수치 갇힘
            none = ~np.isfinite(tb)
            if none.any():
                ii = idx[none]
                led["stuck"] += w[ii][inb[ii]].sum()
                alive[ii] = False
            ok = ~none
            idx, tb, kd = idx[ok], tb[ok], kd[ok]
            nx_, nz_ = nrm[0][ok], nrm[1][ok]
            ib = inb[idx]
            # y 범위(JS 격자) 밖으로 나가는 구간이면 손실
            ynew = py[idx] + tb * dy[idx]
            yout = np.abs(ynew) > Y / 2
            if yout.any():
                led["ylost"] += w[idx[yout]].sum()
                alive[idx[yout]] = False
            keep = ~yout
            idx, tb, kd, nx_, nz_, ib = idx[keep], tb[keep], kd[keep], nx_[keep], nz_[keep], ib[keep]
            px[idx] += tb * dx[idx]; py[idx] += tb * dy[idx]; pz[idx] += tb * dz[idx]
            if mua > 0:
                a = np.where(ib, np.exp(-mua * tb), 1.0)
                led["absb"] += (w[idx] * (1 - a)).sum()
                w[idx] *= a
            # PCB (공기)
            sel = kd == PCB
            if sel.any():
                ii = idx[sel]
                led["pcb"] += (w[ii] * (1 - rhoB)).sum()
                if rhoB > 0:
                    w[ii] *= rhoB
                    v1, v2 = rng.random(ii.size), rng.random(ii.size)
                    c_ = np.sqrt(1 - v1); s_ = np.sqrt(v1); f_ = 2 * np.pi * v2
                    dx[ii], dy[ii], dz[ii] = s_ * np.cos(f_), s_ * np.sin(f_), c_
                    pz[ii] = 1e-9
                else:
                    alive[ii] = False
            # 공기의 x=0, X 평면: 흡수 벽
            sel = ((kd == XLO) | (kd == XHI)) & ~ib
            if sel.any():
                led["wall"] += w[idx[sel]].sum(); alive[idx[sel]] = False
            # 계면(윗면·바닥·몸체 측면)
            sel = (kd == TOP) | (kd == BOT) | (((kd == XLO) | (kd == XHI)) & ib)
            if sel.any():
                ii, k2, ib2 = idx[sel], kd[sel], ib[sel]
                Nx, Nz = nx_[sel], nz_[sel]
                ddx, ddy, ddz = dx[ii], dy[ii], dz[ii]
                dn = ddx * Nx + ddz * Nz
                Nx = np.where(dn > 0, -Nx, Nx); Nz = np.where(dn > 0, -Nz, Nz)   # 입사측 법선
                cos_i = np.clip(-(ddx * Nx + ddz * Nz), 0.0, 1.0)
                n1 = np.where(ib2, n, 1.0); n2 = np.where(ib2, 1.0, n)
                R, cos_t, tir = fresnel(cos_i, n1, n2)
                refl = rng.random(ii.size) < R
                eta = n1 / n2
                tx = eta * ddx + (eta * cos_i - cos_t) * Nx
                ty = eta * ddy
                tz = eta * ddz + (eta * cos_i - cos_t) * Nz
                rx, ry, rz = ddx + 2 * cos_i * Nx, ddy, ddz + 2 * cos_i * Nz
                # 윗면 탈출 기록
                exit_top = (k2 == TOP) & ib2 & ~refl
                if exit_top.any():
                    jj = ii[exit_top]
                    led["top"] += w[jj].sum()
                    hist += np.histogram(px[jj], bins=edges, weights=w[jj])[0]
                    cnt += np.histogram(px[jj], bins=edges)[0]
                    fpos = (px[jj] - xs0) / ns + nK
                    a0 = np.floor(fpos).astype(int)
                    t = fpos - a0
                    okn = (a0 >= 0) & (a0 + 1 < nodes.size)
                    np.add.at(nodes, a0[okn], (w[jj] * (1 - t))[okn])
                    np.add.at(nodes, a0[okn] + 1, (w[jj] * t)[okn])
                    alive[jj] = False
                side_out = ((k2 == XLO) | (k2 == XHI)) & ib2 & ~refl
                if side_out.any():
                    led["side"] += w[ii[side_out]].sum(); alive[ii[side_out]] = False
                tr = ~refl & ~exit_top & ~side_out
                dx[ii[refl]], dy[ii[refl]], dz[ii[refl]] = rx[refl], ry[refl], rz[refl]
                dx[ii[tr]], dy[ii[tr]], dz[ii[tr]] = tx[tr], ty[tr], tz[tr]
                inb[ii[tr]] = ~inb[ii[tr]]
                mv = refl | tr
                jj = ii[mv]
                px[jj] += 1e-9 * dx[jj]; pz[jj] += 1e-9 * dz[jj]
            # 위로 몸체 밖(공기, 윗면 최고점 위)으로 가는 광선은 다음 반복에서 사건 없음 → 종료
        led["stuck"] += w[alive].sum()
    M = hist / (N * b["dx"])
    return {"x": (0.5 * (edges[:-1] + edges[1:])).tolist(), "M": M.tolist(), "cnt": cnt.tolist(), "nodes": (nodes / N).tolist(), "nK": nK, "ns": ns, "ledger": {k: v / N for k, v in led.items()}}


def main():
    cases = json.load(open(sys.argv[1], encoding="utf-8"))["cases"]
    out = {c["name"]: run_case(c) for c in cases}
    json.dump(out, open(sys.argv[2], "w", encoding="utf-8"))


if __name__ == "__main__":
    main()
