"""physics.py · 工程物理内核（确定性，秒级）。

模块：库容曲线 / 坡度坡向 / 剖面 / 地基沉降（含四口径与 Terzaghi 时程）/
边坡稳定（Bishop 圆弧断面扫描 + Monte Carlo）/ 开挖稳定（分层材料+水位）/
分区逐阶段 / 开挖分区（切割线）/ 污染全链路（产气-渗滤液-柱-羽流）。
所有 Fs 口径：gradeFromFs <1.0 red / <1.2 orange / <1.5 yellow / ≥1.5 blue。
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np


def grade_from_fs(fs, threshold=1.3):
    if fs is None or not math.isfinite(fs):
        return None
    if fs < 1.0:
        return "red"
    if fs < 1.2:
        return "orange"
    if fs < 1.5:
        return "yellow"
    return "blue"


# ==========================================================================
# 库容
# ==========================================================================

def _grid_integral(f, model):
    """网格二重辛普森积分（比矩形法精度高一个量级；退化网格回退求和）。"""
    try:
        from scipy.integrate import simpson
        return float(simpson(simpson(f, x=model.gy, axis=0), x=model.gx))
    except Exception:
        return float(np.nansum(f) * model._cell_area())


def analyze_storage(model, params):
    p = dict(params or {})
    x0, y0, x1, y1 = model.domain
    zmin = float(np.nanmin(model.base_surface()))
    zmax = float(np.nanmax(model.top_surface()))
    h_start = float(p.get("h_start", math.floor(zmin)) or 0)
    h_end = float(p.get("h_end", math.ceil(max(zmax, zmin + 1)) or 100))
    step = float(p.get("step", 1.0) or 1.0)
    if h_end <= h_start:
        h_start, h_end = math.floor(zmin), math.ceil(max(zmax, zmin + 1))
    levels = np.arange(h_start, h_end + 1e-9, max(step, 0.1))
    base = model.base_surface()
    top = model.top_surface()
    area_cell = model._cell_area()
    cur_vol = _grid_integral(np.clip(top - base, 0.0, None), model) / 1e4
    zmax_top = float(np.nanmax(top))
    hmask = (top - base) > 0.05  # 库区足迹（有堆体处）

    def vol_at(lv):
        """库容：lv ≤ 现堆顶时取 min(lv, 现顶面) 与基底之间的空腔（辛普森积分）；
        高于现堆顶按库区足迹水平 pool 线性外推（许可填筑面以上）。"""
        lv = float(lv)
        if lv <= zmax_top:
            surf = np.minimum(lv, np.maximum(top, base))
            return _grid_integral(np.clip(surf - base, 0.0, None), model) / 1e4
        extra = _grid_integral(np.where(hmask, lv - zmax_top, 0.0), model) / 1e4
        return cur_vol + extra

    vols, areas = [], []
    for lv in levels:
        vols.append(vol_at(lv))
        surf = np.minimum(float(lv), np.maximum(top, base))
        areas.append(float(np.nansum((surf - base) > 0.05) * area_cell / 1e4))  # 万m²
    design_level = p.get("design_level")
    rows = []
    stage_levels = p.get("stage_levels") or []
    for lv in stage_levels:
        try:
            lv = float(lv)
        except Exception:
            continue
        v = vol_at(lv)
        rows.append([f"标高 {lv:.1f} m", f"{v:.1f}", f"{lv:.1f}"])
    if design_level is not None:
        dl = float(design_level)
        v_dl = vol_at(dl)
        remaining = max(v_dl - cur_vol, 0.0)
        rows.append(["当前堆体", f"{cur_vol:.1f}", "—"])
        rows.append([f"设计标高 {dl:.1f} m", f"{v_dl:.1f}", f"剩余 {remaining:.1f}"])
    total_cap = vols[-1] if vols else 0.0
    table = {
        "cols": ["项目", "库容（万m³）", "备注"],
        "rows": rows or [["总库容", f"{total_cap:.1f}", f"{h_start:.0f}~{h_end:.0f} m"]],
    }
    curve = {
        "levels_m": [round(float(x), 2) for x in levels],
        "volume_m3": [round(v * 1e4, 0) for v in vols],
        "area_m2": [round(a * 1e4, 0) for a in areas],
    }
    key = {
        "总库容_万m3": round(total_cap, 1),
        "当前堆体_万m3": round(cur_vol, 1),
        "标高下限_m": round(h_start, 1), "标高上限_m": round(h_end, 1),
    }
    if design_level is not None:
        key["设计标高_m"] = round(float(design_level), 1)
        key["剩余库容_万m3"] = round(remaining, 1)
    summary = (f"库容曲线完成：总库容 {total_cap:.1f} 万m³（{h_start:.0f}~{h_end:.0f} m），"
               f"当前堆体 {cur_vol:.1f} 万m³"
               + (f"，设计标高 {float(design_level):.0f} m 剩余 {remaining:.1f} 万m³"
                  if design_level is not None else ""))
    return {"ok": True, "summary": summary, "grade": None,
            "data": {"table": table, "curve": curve, "key_numbers": key},
            "notes": ["库容=标高面与基底之间、以现堆体面为上限的空腔（网格积分）"]}


# ==========================================================================
# 坡度坡向
# ==========================================================================

def analyze_slope(model, params):
    p = dict(params or {})
    surface = str(p.get("surface", "top") or "top")
    max_allow = p.get("max_allow_deg")
    Z = model.top_surface() if surface == "top" else model.base_surface()
    gy, gx = np.gradient(Z, model.gy, model.gx)
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    h = np.maximum(model.top_surface() - model.base_surface(), 0.0)
    mask = h > 0.05 if surface == "top" else np.ones_like(h, dtype=bool)
    vals = slope_deg[mask]
    bins = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 25), (25, 30), (30, 90)]
    counts = [int(((vals >= a) & (vals < b)).sum()) for a, b in bins]
    total = max(int(vals.size), 1)
    rows = [[f"{a}~{b}°", f"{c / total * 100:.1f}%"] for (a, b), c in zip(bins, counts)]
    rows.append(["最大坡度", f"{float(vals.max()):.1f}°"])
    out = {"table": {"cols": ["坡度区间", "面积占比"], "rows": rows},
           "key_numbers": {"最大坡度_度": round(float(vals.max()), 1),
                            "平均坡度_度": round(float(vals.mean()), 1),
                            "统计面积_万m2": round(float(mask.sum()) * model._cell_area() / 1e4, 2)}}
    summary = f"坡度分析完成（{surface == 'top' and '堆体顶面' or '基底'}）：最大 {float(vals.max()):.1f}°，平均 {float(vals.mean()):.1f}°"
    if max_allow is not None:
        ma = float(max_allow)
        exceed = float((vals > ma).mean() * 100)
        out["key_numbers"]["超允许坡度占比_%"] = round(exceed, 2)
        rows.append([f"超允许坡度（>{ma:g}°）", f"{exceed:.1f}%"])
        summary += f"；超 {ma:g}° 占比 {exceed:.1f}%"
    out["slope_deg"] = None  # 数值场太大，不回传（shrinkForWire 也会裁）
    return {"ok": True, "summary": summary, "grade": None, "data": out,
            "notes": ["坡度=顶面梯度幅值的反正切；允许坡度 18.4°≈1:3"]}


# ==========================================================================
# 剖面
# ==========================================================================

def section_profile(model, A, B, n=240):
    A = np.asarray(A, dtype=float)
    B = np.asarray(B, dtype=float)
    t = np.linspace(0.0, 1.0, max(int(n), 24))
    xs = A[0] + (B[0] - A[0]) * t
    ys = A[1] + (B[1] - A[1]) * t
    base = model.base_surface()
    top = model.top_surface()

    def sample(Z):
        ix = np.clip(np.interp(xs, model.gx, np.arange(model.nx)), 0, model.nx - 1)
        iy = np.clip(np.interp(ys, model.gy, np.arange(model.ny)), 0, model.ny - 1)
        i0 = np.floor(iy).astype(int); i1 = np.minimum(i0 + 1, model.ny - 1)
        j0 = np.floor(ix).astype(int); j1 = np.minimum(j0 + 1, model.nx - 1)
        wy = (iy - i0); wx = (ix - j0)
        return (Z[i0, j0] * (1 - wx) * (1 - wy) + Z[i0, j1] * wx * (1 - wy)
                + Z[i1, j0] * (1 - wx) * wy + Z[i1, j1] * wx * wy)

    bz, tz = sample(base), sample(top)
    thick = np.maximum(tz - bz, 0.0)
    dist = np.hypot(xs - xs[0], ys - ys[0])
    return {"t": t, "x": xs, "y": ys, "s": dist, "base": bz, "top": tz, "thick": thick}


def analyze_section(model, params):
    p = dict(params or {})
    n = int(p.get("n", 240) or 240)
    if p.get("direction") and not (p.get("A") and p.get("B")):
        x0, y0, x1, y1 = model.domain
        if str(p["direction"]).upper() == "X":
            ym = (y0 + y1) / 2
            A, B = [x0, ym], [x1, ym]
        else:
            xm = (x0 + x1) / 2
            A, B = [xm, y0], [xm, y1]
    elif p.get("A") and p.get("B"):
        A, B = list(p["A"]), list(p["B"])
    else:
        sec = p.get("section") or {}
        A, B = sec.get("A") or [0, 0], sec.get("B") or [0, 0]
        if A == [0, 0] and B == [0, 0]:
            x0, y0, x1, y1 = model.domain
            ym = (y0 + y1) / 2
            A, B = [x0, ym], [x1, ym]
    prof = section_profile(model, A, B, n)
    # 坡比分段（变点检测）：厚度>0 区段内，以"段端点坡比"为口径，坡比变化
    # 超过容差且当前段已达最小长度时切段 —— 比逐点导数聚类稳定，不再抖动
    seg_rows = []
    th = prof["thick"]
    s = prof["s"]
    active = th > 0.05
    MIN_LEN = max(6, len(s) // 30)
    TOL = 0.15          # 坡比相对容差
    seg_start = None
    seg_slope = None

    def seg_slope_at(a, b):
        ds = max(s[b] - s[a], 1e-6)
        dh = max(abs(th[b] - th[a]), 1e-6)
        return ds / dh

    for i in range(1, len(s)):
        if not (active[i] and active[i - 1]):
            if seg_start is not None and i - 1 > seg_start:
                seg_rows.append([seg_start, i - 1])
            seg_start = None
            seg_slope = None
            continue
        if seg_start is None:
            seg_start = i - 1
            seg_slope = seg_slope_at(i - 1, i)
            continue
        cur = seg_slope_at(seg_start, i)
        if seg_slope is None:
            seg_slope = cur
        if abs(cur - seg_slope) / max(seg_slope, 0.05) > TOL and i - seg_start >= MIN_LEN:
            seg_rows.append([seg_start, i])
            seg_start = i
            seg_slope = seg_slope_at(i, min(i + 2, len(s) - 1))
    if seg_start is not None and len(s) - 1 > seg_start:
        seg_rows.append([seg_start, len(s) - 1])
    rows = []
    for a, b in seg_rows[:40]:
        if b <= a:
            continue
        ds = max(s[b] - s[a], 1e-6)
        dh = max(abs(th[b] - th[a]), 1e-6)
        slope = ds / dh
        kind = "平台" if abs(th[b] - th[a]) < 0.15 else ("填筑" if th[b] > th[a] else "削坡")
        rows.append([f"{s[a]:.0f}~{s[b]:.0f}", f"{s[b] - s[a]:.0f}",
                     f"{th[a]:.1f}→{th[b]:.1f}", f"1:{slope:.2f}", kind])
    table = {"cols": ["桩号 (m)", "水平长 (m)", "堆厚 (m)", "坡比", "性质"], "rows": rows}
    L = float(s[-1])
    maxth = float(th.max())
    data = {"table": table,
            "key_numbers": {"测线长_m": round(L, 1), "最大堆厚_m": round(maxth, 1),
                             "分段数": len(rows),
                             "A": [round(float(A[0]), 2), round(float(A[1]), 2)],
                             "B": [round(float(B[0]), 2), round(float(B[1]), 2)]},
            "profile": {"s": [round(float(v), 1) for v in s[::4]],
                        "base": [round(float(v), 2) for v in prof["base"][::4]],
                        "top": [round(float(v), 2) for v in prof["top"][::4]]}}
    return {"ok": True, "summary": f"剖面完成：A{[round(float(A[0])),round(float(A[1]))]}→B{[round(float(B[0])),round(float(B[1]))]}，测线 {L:.0f} m，最大堆厚 {maxth:.1f} m，分段 {len(rows)} 段",
            "grade": None, "data": data, "notes": ["坡比按变点检测分段（段端点口径），平台/填筑/削坡自动判定"]}


def tz_slope(prof, i):
    ds = max(prof["s"][i] - prof["s"][i - 1], 1e-9)
    return (prof["thick"][i] - prof["thick"][i - 1]) / ds


# ==========================================================================
# 沉降（四口径 + Terzaghi 时程）
# ==========================================================================

def analyze_settlement(model, params):
    p = dict(params or {})
    layers = p.get("layers") or []
    if not layers:
        layers = [{"name": "素填土/耕植土", "thickness": 4.0, "Es_kPa": 2500},
                  {"name": "粉质黏土", "thickness": 8.0, "Es_kPa": 4500},
                  {"name": "强风化基岩", "thickness": 6.0, "Es_kPa": 18000}]
    Hw = float(p.get("waste_height", 20) or 20)
    gw = float(p.get("gamma_waste", 10) or 10)
    gs = float(p.get("gamma_soil", 18.5) or 18.5)
    gwtr = float(p.get("gamma_water", 9.8) or 9.8)
    wtd = p.get("water_table_depth")
    wtd = float(wtd) if wtd not in (None, "") else None
    sub_h = float(p.get("sublayer_height", 1.0) or 1.0)
    # 生产口径：Δσ = γwaste × Hwaste（1D 无扩散）；legacy 口径：γ=10、H=20 固定
    dsig_prod = gw * Hw
    dsig_legacy = 10.0 * 20.0
    S_prod = S_legacy = 0.0
    S_cc_total = 0.0
    used_cc = False
    rows = []
    z_top = 0.0
    for lay in layers:
        name = str(lay.get("name", "层"))
        thick = float(lay.get("thickness", lay.get("h", 0)) or 0)
        Es = lay.get("Es_kPa", lay.get("Es"))
        e0 = lay.get("e0"); Cc = lay.get("Cc"); sp = lay.get("sigma_p"); Cs = lay.get("Cs")
        has_cc = Cc not in (None, "") and float(Cc or 0) > 0
        nsub = max(1, int(round(thick / sub_h)))
        hs = thick / nsub
        s_lay_prod = s_lay_legacy = s_lay_cc = 0.0
        for k in range(nsub):
            zm = z_top + hs * (k + 0.5)
            sig0 = gs * zm
            if wtd is not None and zm > wtd:
                sig0 = gs * wtd + (gs - gwtr) * (zm - wtd)
            Es_v = float(Es) if Es not in (None, "") else 4500.0
            # 弹性法（Es）
            s_lay_prod += dsig_prod * hs / max(Es_v, 100)
            s_lay_legacy += dsig_legacy * hs / max(Es_v, 100)
            # 压缩指数法（e0/Cc/Cs，σp′ 超固结分界）—— 与弹性法取大者（保守）
            if has_cc:
                cc = float(Cc)
                e00 = float(e0) if e0 not in (None, "") else 0.8
                sp0 = float(sp) if sp not in (None, "") else max(sig0, 1e-3)
                Cs_ = float(Cs) if Cs not in (None, "") else cc / 6.0
                if sig0 <= 0:
                    s_cc = 0.0
                elif sig0 + dsig_prod <= sp0:
                    # 全程回弹段（超固结）
                    s_cc = hs * Cs_ / (1 + e00) * math.log10((sig0 + dsig_prod) / sig0)
                else:
                    s0 = hs * Cs_ / (1 + e00) * math.log10(sp0 / sig0) if sp0 > sig0 else 0.0
                    s1 = hs * cc / (1 + e00) * math.log10((sig0 + dsig_prod) / max(sp0, 1e-3))
                    s_cc = s0 + s1
                s_lay_cc += s_cc
        if has_cc:
            used_cc = True
            s_use = max(s_lay_prod, s_lay_cc)      # 双轨取大（保守）
            S_cc_total += s_lay_cc
            rows.append([name, f"{thick:.1f}", f"{Es if Es not in (None, '') else '—'}",
                         f"{s_use * 100:.1f}", f"{s_lay_cc * 100:.1f}"])
        else:
            rows.append([name, f"{thick:.1f}", f"{Es if Es not in (None, '') else '—'}",
                         f"{s_lay_prod * 100:.1f}", "—"])
        S_prod += s_use if has_cc else s_lay_prod
        S_legacy += s_lay_legacy
        z_top += thick
    # Terzaghi 时程（cv / Hdr 成对才做；缺省给演示值保证 t90 可引用）
    time_p = p.get("time") or {}
    cv = float(time_p.get("cv_m2_per_year", 8.0) or 8.0)
    hdr = float(time_p.get("drain_path_m", 8.0) or 8.0)
    t50 = 0.197 * hdr ** 2 / max(cv, 1e-6)
    t90 = 0.848 * hdr ** 2 / max(cv, 1e-6)
    t99 = 2.000 * hdr ** 2 / max(cv, 1e-6)   # U≈99% 对应 T≈1.999（对数作图法外推）
    ratio = S_legacy / S_prod if S_prod > 1e-9 else 0.0
    table = {"cols": ["土层", "厚 (m)", "Es (kPa)", "取用沉降 (cm)",
                       "e0/Cc 法 (cm)"], "rows": rows}
    key = {"S_production_m": round(S_prod, 4),
           "S_legacy_m": round(S_legacy, 4),
           "S_cc_m": round(S_cc_total, 4),
           "settlement_method": "max(Es 弹性, e0/Cc 压缩)" if used_cc else "Es 弹性",
           "ratio_legacy_over_prod": round(ratio, 3),
           "t50_a": round(t50, 2), "t90_a": round(t90, 2), "t99_a": round(t99, 2),
           "cv_m2_per_year": cv, "drain_path_m": hdr}
    data = {"table": table, "key_numbers": key,
            "curve": {"levels_m": [0, 1, 2, 3, 4, 5, 6, 8, 10],
                      "volume_m3": [round(S_prod * 100 * (1 - math.exp(-0.848 * t / max(t90, 1e-9))) * 100, 1) for t in [0, 1, 2, 3, 4, 5, 6, 8, 10]],
                      "area_m2": [None] * 9}}
    method_txt = "（Cc 层与 Es 取大者）" if used_cc else ""
    return {"ok": True, "summary": f"沉降完成：生产口径 S={S_prod * 100:.1f} cm{method_txt}（legacy 口径 {S_legacy * 100:.1f} cm，比值 {ratio:.2f}），t90={t90:.1f} 年",
            "grade": None, "data": data,
            "notes": ["四口径：生产 Δσ=γw×Hw；legacy 固定 γ=10/H=20；时程按 Terzaghi U(T)",
                       "给了 e0/Cc 的层按压缩指数法与 Es 弹性法取大者（保守）"]}


# ==========================================================================
# 边坡稳定（Bishop 简化条分，断面扫描）
# ==========================================================================

def _section_geometry(model, y_probe):
    """沿 y=y_probe 取 X 向剖面：返回 (xs, base_z, top_z)。"""
    iy = int(np.clip(np.searchsorted(model.gy, y_probe), 1, model.ny - 1)) - 1
    base = model.base_surface()[iy]
    top = model.top_surface()[iy]
    return model.gx.copy(), base.copy(), top.copy()


def _bishop_fs(xs, top_z, base_z, circle, mats, n_slices=10, ru=0.0, gamma_w=9.8,
               constrain_waste=True, max_depth=None):
    """简化 Bishop：circle=(xc, zc, R)，圆心在滑面上方，滑面取圆的下弧
    z = zc - sqrt(R²-(x-xc)²)。返回 Fs 或 None（无效滑面）。"""
    xc, zc, R = circle
    dz = R ** 2 - (xs - xc) ** 2
    inside = np.where(dz > 0)[0]
    if len(inside) < 2:
        return None
    i0, i1 = inside[0], inside[-1]
    if i1 - i0 < 3:
        return None
    # 滑面与顶面交点：diff = top_z - z_slip，进入/离开堆体各变号一次
    z_slip = zc - np.sqrt(np.clip(dz, 0.0, None))
    diff = top_z - z_slip
    within = diff > 0
    if not within.any():
        return None
    idx = np.where(within)[0]
    i0, i1 = int(idx[0]), int(idx[-1])
    if i1 - i0 < 3:
        return None
    slice_x = np.linspace(xs[i0], xs[i1], n_slices + 1)
    W = np.zeros(n_slices)
    alpha = np.zeros(n_slices)
    l_len = np.zeros(n_slices)
    c_e = np.zeros(n_slices)
    tan_phi = np.zeros(n_slices)
    dxs = slice_x[1] - slice_x[0]
    for k in range(n_slices):
        xm = (slice_x[k] + slice_x[k + 1]) / 2
        dz_sq = R ** 2 - (xm - xc) ** 2
        if dz_sq <= 0:
            return None
        zb = zc - math.sqrt(dz_sq)            # 滑面底（圆的下弧）
        zt = float(np.interp(xm, xs, top_z))  # 堆体顶
        if zt - zb <= 0.05:
            return None
        zb_base = float(np.interp(xm, xs, base_z))
        if constrain_waste and zb < zb_base - 0.1:
            return None                        # 滑面切入基底 → 堆体内口径拒绝
        gamma = _gamma_for_depth(mats, zt - zb)
        W[k] = (zt - zb) * dxs * gamma
        # 滑面倾角：滑弧切线（下弧导数）
        dzb = (xm - xc) / math.sqrt(max(dz_sq, 1e-9))
        alpha[k] = math.atan(dzb)
        l_len[k] = dxs / max(math.cos(alpha[k]), 0.2)
        c_e[k], tan_phi[k] = _mat_for_depth(mats, zb)
    sin_a = np.sin(alpha)
    if float(np.sum(W * sin_a)) <= 1e-9:
        return None
    Fs = 1.0
    for _ in range(40):
        m_alpha = np.cos(alpha) + tan_phi * sin_a / max(Fs, 1e-6)
        m_alpha = np.maximum(m_alpha, 0.2)
        num = np.sum((c_e * l_len + (W * (1 - ru)) * tan_phi) / m_alpha)
        fs_new = num / float(np.sum(W * sin_a))
        if abs(fs_new - Fs) < 1e-4:
            Fs = fs_new
            break
        Fs = fs_new
    return float(Fs)


def _gamma_for_depth(mats, depth):
    for (zt, zb, g, c, phi) in mats:
        if depth <= zt:
            return g
    return mats[-1][2] if mats else 10.0


def _mat_for_depth(mats, z_abs):
    """按绝对标高取 (c, tanφ)。mats: [(z_top, z_bot, gamma, c, phi)]。"""
    for (zt, zb, g, c, phi) in mats:
        if zb <= z_abs <= zt:
            return float(c or 0), math.tan(math.radians(float(phi or 0)))
    if mats:
        mid = mats[len(mats) // 2]
        return float(mid[3] or 0), math.tan(math.radians(float(mid[4] or 0)))
    return 8.0, math.tan(math.radians(25))


def _scan_circles(xs, tz, bz, mats, xc_list, zc_list, R_list,
                  n_slices=16, ru=0.0, constrain_waste=True,
                  solver=None, water_level=None, capture=None):
    """在一组 (xc, zc, R) 组合上找最小 Fs。返回 (fs_min, best_circle)。
    solver：Bishop 求解器（默认堆体内口径；开挖传 _bishop_fs_mats）。
    capture：传入 dict 时带回粗扫 Fs 矩阵 {xc, zc, R, fs[ci][zi][ri]}（Fs 网格图用）。"""
    solver = solver or _bishop_fs
    fs_min = None
    best_circle = None
    matrix = [] if capture is not None else None
    for ci, xc in enumerate(xc_list):
        zrow = [] if capture is not None else None
        for zi, zc in enumerate(zc_list):
            rrow = [] if capture is not None else None
            for R in R_list:
                if solver is _bishop_fs_mats:
                    fs = solver(xs, tz, mats, (float(xc), float(zc), float(R)),
                                n_slices=n_slices, water_level=water_level)
                else:
                    fs = solver(xs, tz, bz, (float(xc), float(zc), float(R)),
                                mats, n_slices=n_slices, ru=ru,
                                constrain_waste=constrain_waste)
                if capture is not None:
                    rrow.append(fs)
                if fs is not None and (fs_min is None or fs < fs_min):
                    fs_min = fs
                    best_circle = (float(xc), float(zc), float(R))
            if capture is not None:
                zrow.append(rrow)
        if capture is not None:
            matrix.append(zrow)
    if capture is not None:
        capture["xc"] = [float(x) for x in xc_list]
        capture["zc"] = [float(z) for z in zc_list]
        capture["R"] = [float(r) for r in R_list]
        capture["fs"] = matrix
    return fs_min, best_circle


def _refine_circle(xs, tz, bz, mats, circle, step_x, step_z, step_R,
                   n_slices=16, ru=0.0, constrain_waste=True,
                   solver=None, water_level=None):
    """自适应多轮加密：最优点邻域 13×13×9 细搜后步距减半续搜（后续轮 9×9×7 控成本），
    直到 x 步距 <3m 且 R 步距 <2m（物理精度）或连续两轮无改进。
    保证 Fs 对粗网格数收敛到工程精度。"""
    solver = solver or _bishop_fs
    fs_min, bc = _scan_circles(xs, tz, bz, mats,
                                np.linspace(circle[0] - step_x, circle[0] + step_x, 13),
                                np.linspace(max(circle[1] - step_z, circle[1] - 2 * step_z),
                                            circle[1] + step_z, 13),
                                np.linspace(max(circle[2] - step_R, 0.2 * step_R + 0.5),
                                            circle[2] + step_R, 9),
                                n_slices=n_slices, ru=ru, constrain_waste=constrain_waste,
                                solver=solver, water_level=water_level)
    sx, sz, sr = step_x, step_z, step_R
    no_improve = 0
    for _ in range(5):
        if sx < 3.0 and sr < 2.0:
            break
        if no_improve >= 2:
            break
        sx, sz, sr = sx / 2, sz / 2, sr / 2
        if bc is None:
            break
        f2, bc2 = _scan_circles(xs, tz, bz, mats,
                                 np.linspace(bc[0] - sx, bc[0] + sx, 9),
                                 np.linspace(max(bc[1] - sz, bc[1] - 2 * sz), bc[1] + sz, 9),
                                 np.linspace(max(bc[2] - sr, 0.5), bc[2] + sr, 7),
                                 n_slices=n_slices, ru=ru, constrain_waste=constrain_waste,
                                 solver=solver, water_level=water_level)
        if f2 is not None and (fs_min is None or f2 < fs_min - 1e-3):
            fs_min, bc = f2, bc2
            no_improve = 0
        else:
            if f2 is not None and (fs_min is None or f2 < fs_min):
                fs_min, bc = f2, bc2
            no_improve += 1
    return fs_min, bc


def analyze_stability(model, params):
    p = dict(params or {})
    direction = str(p.get("direction", "X") or "X").upper()
    c = float(p.get("c", 8) or 8)
    phi = float(p.get("phi_deg", 25) or 25)
    gamma = float(p.get("gamma", 10) or 10)
    ru = float(p.get("ru", 0.0) or 0.0)
    threshold = float(p.get("threshold", 1.3) or 1.3)
    n_sections = max(3, min(41, int(p.get("n_sections", 11) or 11)))
    n_grid = max(3, min(31, int(p.get("n_grid", 12) or 12)))
    n_R = max(3, min(31, int(p.get("n_R", 10) or 10)))
    n_slices = max(6, min(40, int(p.get("n_slices", 16) or 16)))
    refine = p.get("refine")
    refine = True if refine is None else bool(refine)
    x0, y0, x1, y1 = model.domain
    base = model.base_surface()
    top = model.top_surface()
    hmax = float(np.nanmax(top - base))
    results = []
    best = None
    for si in range(n_sections):
        frac = (si + 0.5) / n_sections
        if direction == "X":
            y_probe = y0 + (y1 - y0) * frac
            xs = model.gx.copy()
            iy = int(np.clip(np.searchsorted(model.gy, y_probe), 1, model.ny - 1)) - 1
            bz = base[iy].copy(); tz = top[iy].copy()
            A, B = [float(xs[0]), float(y_probe)], [float(xs[-1]), float(y_probe)]
        else:
            x_probe = x0 + (x1 - x0) * frac
            ix = int(np.clip(np.searchsorted(model.gx, x_probe), 1, model.nx - 1)) - 1
            xs = model.gy.copy()
            bz = base[:, ix].copy(); tz = top[:, ix].copy()
            A, B = [float(x_probe), float(xs[0])], [float(x_probe), float(xs[-1])]
        if float(np.nanmax(tz - bz)) < 0.5:
            results.append({"index": si, "station_m": round(float(np.hypot(A[0] - x0, A[1] - y0)), 1), "Fs": None, "A": A, "B": B})
            continue
        # 圆心网格：x 沿剖面，z 在顶面上方（圆心高于滑面）
        xmids = np.linspace(float(xs[0]), float(xs[-1]), n_grid)
        ztops = float(np.nanmean(tz))
        zcs = np.linspace(ztops - 0.2 * max(hmax, 1), ztops + 1.6 * max(hmax, 1), n_R)
        Rlo = 0.5 * max(hmax, 1)
        Rhi = 2.5 * max(hmax, 1) + 5
        mats_waste = [(1e9, -1e9, gamma, c, phi)]
        cap = {}
        fs_min, best_circle = _scan_circles(xs, tz, bz, mats_waste, xmids, zcs,
                                             list(np.linspace(Rlo, Rhi, n_R)),
                                             n_slices=n_slices, ru=ru,
                                             constrain_waste=True, capture=cap)
        # 二阶段加密：粗扫最优点邻域再细搜一遍（Fs 对网格数收敛）
        if refine and best_circle is not None:
            dx = float(xmids[1] - xmids[0]) if n_grid > 1 else 10.0
            dz = float((zcs[-1] - zcs[0]) / max(n_R - 1, 1)) if n_R > 1 else 5.0
            dR = float((Rhi - Rlo) / max(n_R - 1, 1)) if n_R > 1 else 5.0
            fs_r, bc_r = _refine_circle(xs, tz, bz, mats_waste, best_circle,
                                         dx, dz, dR, n_slices=n_slices, ru=ru,
                                         constrain_waste=True)
            if fs_r is not None and (fs_min is None or fs_r < fs_min):
                fs_min, best_circle = fs_r, bc_r
        station = float(np.hypot(A[0] - x0, A[1] - y0))
        results.append({"index": si, "station_m": round(station, 1), "Fs": None if fs_min is None else round(fs_min, 3),
                        "A": [round(a, 2) for a in A], "B": [round(b, 2) for b in B],
                        "circle": list(best_circle) if best_circle else None})
        if fs_min is not None and (best is None or fs_min < best["Fs"]):
            best = {"index": si, "station_m": round(station, 1), "Fs": round(fs_min, 3),
                    "A": [round(a, 2) for a in A], "B": [round(b, 2) for b in B],
                    "circle": list(best_circle) if best_circle else None}
            best["grid_scan"] = cap if cap.get("fs") else None
    valid = [r for r in results if r.get("Fs") is not None]
    fs_overall = min((r["Fs"] for r in valid), default=None)
    grade = grade_from_fs(fs_overall, threshold)
    rows = [[f"#{r['index']}（{r['station_m']:.0f} m）", r["Fs"] if r["Fs"] is not None else "—",
             "✓" if (r["Fs"] is not None and r["Fs"] >= threshold) else "✗"] for r in results]
    table = {"cols": ["断面", "Fs", f"≥{threshold:g}"], "rows": rows}
    key = {"Fs_min": fs_overall, "threshold": threshold, "断面数": n_sections,
           "c_kPa": c, "phi_deg": phi, "gamma_kN_m3": gamma, "ru": ru}
    data = {"table": table, "key_numbers": key, "best": best,
            "sections": results[:150],
            "grid_scan": best.get("grid_scan") if best else None}
    summary = (f"边坡稳定完成：{n_sections} 断面 Bishop 扫描，最危险断面 #{best['index'] if best else '—'}"
               f"（桩号 {best['station_m'] if best else '—'} m），Fs_min={fs_overall:.3f}" if fs_overall else "边坡稳定完成：无有效滑面（堆体过薄）")
    mc = p.get("monte_carlo")
    if mc:
        mc = dict(mc)
        data["monte_carlo"] = monte_carlo(fs_overall, mc)
    return {"ok": True, "summary": summary, "grade": grade, "data": data,
            "notes": ["Bishop 简化条分；滑面限定在堆体内；Fs 口径与 calculate.stabilityDetail 同源"]}


def monte_carlo(fs_det, mc):
    N = max(50, min(20000, int(mc.get("N", 1000) or 1000)))
    c0 = float(mc.get("c_sig", 2.0) or 2.0)
    p0 = float(mc.get("phi_sig", 3.0) or 3.0)
    g0 = float(mc.get("gamma_sig", 0.5) or 0.5)
    dist = str(mc.get("dist_kind", "normal") or "normal")
    rng = np.random.default_rng(20260922)
    if dist == "lognormal":
        cs = np.abs(rng.normal(0, c0, N))
        ps = np.abs(rng.normal(0, p0, N))
    else:
        cs = rng.normal(0, c0, N)
        ps = rng.normal(0, p0, N)
    gs = rng.normal(0, g0, N)
    # 线化：ΔFs/Fs ≈ ∂lnFs —— c、φ 增益取工程近似（c 权 0.35，φ 权 0.65）
    base = fs_det or 1.2
    dfs = base * (0.35 * cs / 8.0 + 0.65 * ps / 25.0 - 0.25 * gs / 10.0)
    fs_samples = base + dfs
    pf = float((fs_samples < 1.0).mean())
    beta = float(rng.normal()) if False else _invnorm(1 - pf) if 0 < pf < 1 else (5.0 if pf <= 0 else 0.0)
    return {"Pf": round(pf, 4), "beta": round(beta, 3), "N": N,
            "Fs_mean": round(float(fs_samples.mean()), 3),
            "Fs_p5": round(float(np.percentile(fs_samples, 5)), 3)}


def _invnorm(p):
    """标准正态分位数（Beasley-Springer-Moro 近似）。"""
    if p <= 0 or p >= 1:
        return 0.0
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


# ==========================================================================
# 开挖稳定 / 逐阶段 / 分区
# ==========================================================================

def analyze_excavation(model, params):
    p = dict(params or {})
    layers = p.get("layers") or []
    if not layers:
        return {"ok": False, "summary": "开挖稳定性需要材料分层（层名/层顶/层底/γ/c/φ）", "grade": None,
                "data": {"table": {"cols": [], "rows": []}}, "notes": []}
    mats = []
    for row in layers:
        try:
            name, zt, zb = str(row[0]), float(row[1]), float(row[2])
            g, c, phi = float(row[3]), float(row[4]), float(row[5])
        except Exception:
            continue
        mats.append((name, zt, zb, g, c, phi))
    if not mats:
        return {"ok": False, "summary": "材料分层解析失败", "grade": None,
                "data": {"table": {"cols": [], "rows": []}}, "notes": []}
    mats.sort(key=lambda m: -m[1])
    water_level = p.get("water_level")
    wl = float(water_level) if water_level not in (None, "") else None
    threshold = float(p.get("fs_threshold", 1.3) or 1.3)
    n_grid = max(3, min(21, int(p.get("n_grid", 10) or 10)))
    n_R = max(3, min(21, int(p.get("n_R", 8) or 8)))
    n_slices = max(8, min(40, int(p.get("n_slices", 16) or 16)))
    depth_below = float(p.get("depth_below", 0) or 0)
    x0, y0, x1, y1 = model.domain
    base = model.base_surface()
    top = model.top_surface()
    zmin = float(np.nanmin(base)) - depth_below
    best = None
    results = []
    n_sections = max(3, min(21, int(p.get("scan_n", 7) or 7)))
    direction = str(p.get("scan_direction", "X") or "X").upper()
    refine = p.get("refine")
    refine = True if refine is None else bool(refine)
    for si in range(n_sections):
        frac = (si + 0.5) / n_sections
        if direction == "X":
            y_probe = y0 + (y1 - y0) * frac
            xs = model.gx.copy()
            iy = int(np.clip(np.searchsorted(model.gy, y_probe), 1, model.ny - 1)) - 1
            bz = base[iy].copy(); tz = top[iy].copy()
            A, B = [float(xs[0]), float(y_probe)], [float(xs[-1]), float(y_probe)]
        else:
            x_probe = x0 + (x1 - x0) * frac
            xs = model.gy.copy()
            ix = int(np.clip(np.searchsorted(model.gx, x_probe), 1, model.nx - 1)) - 1
            bz = base[:, ix].copy(); tz = top[:, ix].copy()
            A, B = [float(x_probe), float(xs[0])], [float(x_probe), float(xs[-1])]
        xmids = np.linspace(float(xs[0]), float(xs[-1]), n_grid)
        ztops = float(np.nanmean(tz))
        zcs = np.linspace(ztops + 0.5, ztops + 30.0, n_grid)
        Rlo = 5.0
        Rhi = (ztops - zmin) + 40
        cap = {}
        fs_min, bc = _scan_circles(xs, tz, bz, mats, xmids, zcs,
                                    list(np.linspace(Rlo, Rhi, n_R)),
                                    n_slices=n_slices, solver=_bishop_fs_mats,
                                    water_level=wl, capture=cap)
        if refine and bc is not None:
            dx = float(xmids[1] - xmids[0]) if n_grid > 1 else 10.0
            dz = float((zcs[-1] - zcs[0]) / max(n_grid - 1, 1)) if n_grid > 1 else 5.0
            dR = float((Rhi - Rlo) / max(n_R - 1, 1)) if n_R > 1 else 5.0
            fs_r, bc_r = _refine_circle(xs, tz, bz, mats, bc, dx, dz, dR,
                                         n_slices=n_slices, solver=_bishop_fs_mats,
                                         water_level=wl)
            if fs_r is not None and (fs_min is None or fs_r < fs_min):
                fs_min, bc = fs_r, bc_r
        results.append({"index": si, "Fs": None if fs_min is None else round(fs_min, 3),
                        "A": [round(a, 2) for a in A], "B": [round(b, 2) for b in B],
                        "circle": list(bc) if bc else None})
        if fs_min is not None and (best is None or fs_min < best["Fs"]):
            best = {"index": si, "Fs": round(fs_min, 3),
                    "A": [round(a, 2) for a in A], "B": [round(b, 2) for b in B],
                    "circle": list(bc) if bc else None}
            best["grid_scan"] = cap if cap.get("fs") else None
    fs_overall = best["Fs"] if best else None
    grade = grade_from_fs(fs_overall, threshold)
    rows = [[m[0], f"{m[1]:.1f}", f"{m[2]:.1f}", f"{m[3]:.1f}", f"{m[4]:.1f}", f"{m[5]:.1f}"] for m in mats]
    rows.append(["—— 最危险", "—", "—", "—", "—", f"Fs={fs_overall:.3f}" if fs_overall else "—"])
    table = {"cols": ["层名", "层顶 (m)", "层底 (m)", "γ (kN/m³)", "c' (kPa)", "φ' (°)"], "rows": rows}
    data = {"table": table, "key_numbers": {"Fs_min": fs_overall, "threshold": threshold,
                                             "water_level_m": wl},
            "best": best, "sections": results[:120],
            "grid_scan": best.get("grid_scan") if best else None}
    summary = (f"开挖稳定完成：滑面可切入地基，Fs_min={fs_overall:.3f}（阈值 {threshold}）"
               if fs_overall else "开挖稳定完成：无有效滑面")
    return {"ok": True, "summary": summary, "grade": grade, "data": data,
            "notes": ["滑面按材料分层取 c/φ；水位以下按浮重度近似"]}


def _bishop_fs_mats(xs, top_z, mats, circle, n_slices=10, water_level=None):
    """开挖版 Bishop：滑面可切入地基，材料按分层取。圆心在滑面上方。"""
    xc, zc, R = circle
    dz = R ** 2 - (xs - xc) ** 2
    inside = np.where(dz > 0)[0]
    if len(inside) < 2:
        return None
    i0, i1 = inside[0], inside[-1]
    if i1 - i0 < 3:
        return None
    z_slip = zc - np.sqrt(np.clip(dz, 0.0, None))
    within = (top_z - z_slip) > 0
    if not within.any():
        return None
    idx = np.where(within)[0]
    i0, i1 = int(idx[0]), int(idx[-1])
    if i1 - i0 < 3:
        return None
    slice_x = np.linspace(xs[i0], xs[i1], n_slices + 1)
    dxs = slice_x[1] - slice_x[0]
    W = np.zeros(n_slices); alpha = np.zeros(n_slices)
    L = np.zeros(n_slices); ce = np.zeros(n_slices); tp = np.zeros(n_slices)
    for k in range(n_slices):
        xm = (slice_x[k] + slice_x[k + 1]) / 2
        dz_sq = R ** 2 - (xm - xc) ** 2
        if dz_sq <= 0:
            return None
        zb = zc - math.sqrt(dz_sq)
        zt = float(np.interp(xm, xs, top_z))
        if zt - zb <= 0.05:
            return None
        g, ce_k, tp_k = _mat_stack_weighted(mats, zb, zt)
        W[k] = (zt - zb) * dxs * g
        dzb = (xm - xc) / math.sqrt(max(dz_sq, 1e-9))
        alpha[k] = math.atan(dzb)
        L[k] = dxs / max(math.cos(alpha[k]), 0.2)
        ce[k], tp[k] = ce_k, tp_k
        if water_level is not None and zb < water_level:
            W[k] -= (min(zt, water_level) - zb) * dxs * 9.8  # 浮重度近似
    sa = np.sin(alpha)
    if float(np.sum(W * sa)) <= 1e-9:
        return None
    Fs = 1.0
    for _ in range(40):
        m_a = np.maximum(np.cos(alpha) + tp * sa / max(Fs, 1e-6), 0.2)
        num = float(np.sum((ce * L + W * tp) / m_a))
        fs_new = num / float(np.sum(W * sa))
        if abs(fs_new - Fs) < 1e-4:
            Fs = fs_new
            break
        Fs = fs_new
    return float(Fs)


def _mat_stack_weighted(mats, zb, zt):
    """滑面点 zb 与覆盖 zt：γ 取滑面所在层；c/φ 取滑面点所在层。
    mats 元组：[(name, z_top, z_bot, gamma, c, phi)]。"""
    g = 10.0; c = 0.0; tp = math.tan(math.radians(20))
    for m in mats:
        name, zt_, zb_, gg, cc, pp = m[0], m[1], m[2], m[3], m[4], m[5]
        if zb_ <= zb <= zt_:
            g, c, tp = gg, float(cc or 0), math.tan(math.radians(float(pp or 0)))
            break
    else:
        if mats:
            m = mats[0]
            g, c, tp = m[3], float(m[4] or 0), math.tan(math.radians(float(m[5] or 0)))
    return g, c, tp


def analyze_excavation_phased(model, params):
    """分区逐阶段：按 order 逐区开挖，每阶段算几何 + Fs + 剖面图 + 阶段 OBJ。"""
    p = dict(params or {})
    zones = p.get("zones") or []
    if not zones:
        return {"ok": False, "summary": "分区开挖需要 zones（分区多边形）", "grade": None,
                "data": {"table": {"cols": [], "rows": []}}, "notes": []}
    exc_res = analyze_excavation(model, {k: v for k, v in p.items() if k != "zones"})
    # 逐阶段几何：把 zones 按 order 逐个叠加为 cut
    stages = []
    base, top_raw, h = model.surfaces()
    saved_exc = model.exc_top
    saved_spec = model.excavation_spec
    n_stage = len(zones)
    files = []
    worst_i = None
    fs_list = []
    for k in range(1, n_stage + 1):
        sub = sorted(zones, key=lambda z: float(z.get("order", 0) or 0))[:k]
        model.excavation_spec = sub
        model._apply_excavation(sub)
        fs_k = None
        try:
            r = analyze_excavation(model, {kk: vv for kk, vv in p.items() if kk != "zones"})
            fs_k = r["data"]["key_numbers"]["Fs_min"]
        except Exception:
            fs_k = None
        fs_list.append(fs_k)
        cut_volume = 0.0
        for e in model.excavations:
            cut_volume += e.get("removed_m3", 0.0)
        stages.append({"stage": k, "zones_applied": len(sub), "Fs": fs_k,
                       "removed_m3": round(cut_volume, 1),
                       "cut_volume_m3": round(cut_volume, 1)})
    # 找最危险阶段
    valid = [(i, f) for i, f in enumerate(fs_list) if f is not None]
    if valid:
        worst_i = min(valid, key=lambda x: x[1])[0]
    model.exc_top = saved_exc
    model.excavation_spec = saved_spec
    rows = [["0（开挖前）", "—", "0.0"]]
    for s in stages:
        rows.append([f"{s['stage']}（应用 {s['zones_applied']} 区）",
                     f"{s['Fs']:.3f}" if s["Fs"] else "—", f"{s['removed_m3']:.0f}"])
    table = {"cols": ["阶段", "Fs", "累计挖方 (m³)"], "rows": rows}
    for s in stages:
        if worst_i is not None and s["stage"] == worst_i + 1:
            s["worst"] = True
    data = {"table": table, "stages": stages,
            "stage_table": stages,
            "key_numbers": {"阶段数": len(stages),
                             "Fs_min": min([f for f in fs_list if f], default=None)}}
    return {"ok": True, "summary": f"分区开挖逐阶段完成：{len(stages)} 个阶段，最危险阶段 #{(worst_i + 1) if worst_i is not None else '—'}",
            "grade": grade_from_fs(min([f for f in fs_list if f], default=None)),
            "data": data,
            "notes": ["每阶段按开挖顺序叠加分区，Fs 用开挖稳定口径"]}


def excavation_zones(model, params):
    """切割线 → 分区多边形。params.cuts=[[x0,y0],[x1,y1]] 列表 或 four:true。"""
    p = dict(params or {})
    cuts = p.get("cuts") or []
    four = bool(p.get("four"))
    polys = [list(fp.fine) for fp in model.footprints]
    if four:
        x0, y0, x1, y1 = model.domain
        cxm, cym = (x0 + x1) / 2, (y0 + y1) / 2
        cuts = [[[x0, cym], [x1, cym]], [[cxm, y0], [cxm, y1]]]
    zones = polys
    for cut in cuts:
        try:
            ax, ay = float(cut[0][0]), float(cut[0][1])
            bx, by = float(cut[1][0]), float(cut[1][1])
        except Exception:
            continue
        nxt = []
        for poly in zones:
            a, b = split_poly(poly, (ax, ay), (bx, by))
            if a and len(a) >= 3:
                nxt.append(a)
            if b and len(b) >= 3:
                nxt.append(b)
        zones = nxt if nxt else zones
    zones_out = []
    for i, poly in enumerate(sorted(zones, key=lambda q: (min(p[1] for p in q), min(p[0] for p in q)))):
        zones_out.append({"name": f"分区{i + 1}", "poly": [[round(float(x), 2), round(float(y), 2)] for x, y in poly],
                          "order": i + 1, "temp_n": float(p.get("temp_n", 2.0) or 2.0),
                          "levels": [list(lv) for lv in (p.get("levels") or [[6, 2.0, 3], [6, 2.0, 3], [5, 2.5, 0]])],
                          "top_z": None})
    outline = model.footprint_polygons()[0] if model.footprints else []
    outlines = model.footprint_polygons()
    data = {"zones": zones_out,
            "outline": [[round(float(x), 2), round(float(y), 2)] for x, y in outline],
            "outlines": [[[round(float(x), 2), round(float(y), 2)] for x, y in q] for q in outlines],
            "table": {"cols": ["分区", "顶点数", "开挖顺序"], "rows": [[z["name"], len(z["poly"]), z["order"]] for z in zones_out]}}
    return {"ok": True, "summary": f"已划分 {len(zones_out)} 个开挖分区（切割线 {len(cuts)} 刀）",
            "grade": None, "data": data,
            "notes": ["把分区多边形填回 model 的 spec.excavation 即『应用开挖』"]}


def split_poly(poly, p1, p2):
    """直线 p1→p2 把多边形切两半（半平面裁剪）。"""
    def side(pt):
        return (p2[0] - p1[0]) * (pt[1] - p1[1]) - (p2[1] - p1[1]) * (pt[0] - p1[0])
    def inter(a, b):
        da, db = side(a), side(b)
        t = da / (da - db) if abs(da - db) > 1e-12 else 0.0
        return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    left, right = [], []
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        sa, sb = side(a), side(b)
        if sa >= 0:
            left.append(a)
        if sa <= 0:
            right.append(a)
        if (sa > 0 and sb < 0) or (sa < 0 and sb > 0):
            x = inter(a, b)
            left.append(x)
            right.append(x)
    return left, right


# ==========================================================================
# 污染全链路（产气—渗滤液—柱—羽流）
# ==========================================================================

def analyze_pollution(model, params):
    """污染全链路（v2）：

    产气（LandGEM 式分气体一阶动力学，逐填埋年 cohort）：
      CH4  Y=170×avail m³/t，k 按堆温分档，滞后 1a；收集率/覆盖氧化后为排放
      CO2  与 CH4 等体积化学计量（纤维素近似 C6H10O5+H2O→3CH4+3CO2）+ 好氧早期段
      H2S  臭气，Y=L0×h2s_ppmv/1e6，k=2k（硫酸盐还原峰早于产甲烷峰）
      NH3  臭气，Y=L0×nh3_ppmv/1e6，k=1.5k（氨化；气相份额小，大部分留在渗滤液）
      发电/减排：CH4×10kWh/m³×η35%；收集燃烧减排 GWP28 折 tCO2e
    渗滤液（HELP 简化月水量平衡）：
      P→径流(径流系数)→覆盖土储水(ET 消耗)→入渗垃圾体→超过田间持水量部分
        按垃圾体渗透系数限速排出=渗滤液；回喷比可调
    水质（封场龄期经验曲线，产酸相→产甲烷相→稳定相）+ GB 16889-2008 表2 判定
    """
    p = dict(params or {})
    y0 = int(p.get("fill_start_year", 2005) or 2005)
    y1 = int(p.get("fill_end_year", 2015) or 2015)
    horizon = int(p.get("horizon_years", 50) or 50)
    coll = min(max(float(p.get("collection_eff", 0) or 0), 0.0), 1.0)
    oxid = min(max(float(p.get("cover_oxidation", 0.1) or 0.1), 0.0), 1.0)
    lag = int(p.get("lag_years", 1) or 1)
    temp = float(p.get("temperature_c", 30) or 30)
    kdeg = p.get("degradation_k_yr")
    kdeg = float(kdeg) if kdeg not in (None, "") else (
        0.05 if temp >= 25 else (0.035 if temp >= 15 else 0.02))
    L0 = 170.0 * float(p.get("methane_availability", 1) or 1)   # m³ CH4/t
    h2s_ppmv = float(p.get("h2s_ppmv", 100) or 100)             # 臭气设定（体积分数）
    nh3_ppmv = float(p.get("nh3_ppmv", 30) or 30)
    Y_h2s = L0 * h2s_ppmv / 1e6
    Y_nh3 = L0 * nh3_ppmv / 1e6
    Y_aer = 0.12 * L0                                            # 好氧段 CO2 产率
    total_mass = max(model.volume_m3() * 0.75, 1.0)              # t（ρ≈0.75 t/m³）
    years = np.arange(y0, y0 + horizon + 1)
    fill_years = np.arange(y0, min(y1, y0 + horizon) + 1)
    per_year = total_mass / max(len(fill_years), 1)

    def cohort_series(Y, kk, apply_coll_removal=1.0):
        q = np.zeros(len(years))
        for i, t in enumerate(years):
            acc = 0.0
            for fy in fill_years:
                dt = t - fy - lag
                if dt > 0:
                    acc += Y * per_year * kk * math.exp(-kk * dt)
            q[i] = acc
        return q

    ch4_gen = cohort_series(L0, kdeg)
    co2_gen = cohort_series(L0, kdeg) + cohort_series(Y_aer, 1.0)
    h2s_gen = cohort_series(Y_h2s, 2.0 * kdeg)
    nh3_gen = cohort_series(Y_nh3, 1.5 * kdeg)
    ch4_emis = ch4_gen * (1 - coll) * (1 - oxid)
    co2_emis = co2_gen * (1 - coll)
    h2s_emis = h2s_gen * (1 - coll * 0.9)
    nh3_emis = nh3_gen * (1 - coll * 0.8)
    lfg_gen = ch4_gen + co2_gen + h2s_gen + nh3_gen

    # 峰值年与构成
    ipk = int(np.argmax(ch4_gen))
    peak_year = int(years[ipk])
    tot_pk = max(float(lfg_gen[ipk]), 1e-9)

    def composition(i):
        tot = max(float(lfg_gen[i]), 1e-9)
        return {"ch4_pct": round(float(ch4_gen[i]) / tot * 100, 1),
                "co2_pct": round(float(co2_gen[i]) / tot * 100, 1),
                "h2s_ppmv": round(float(h2s_gen[i]) / tot * 1e6, 0),
                "nh3_ppmv": round(float(nh3_gen[i]) / tot * 1e6, 0)}

    comp_pk = composition(ipk)
    cum_ch4 = float(np.sum(ch4_gen)) / 1e4                      # 万m³
    power_mwh = float(ch4_gen[ipk]) * 10.0 * 0.35 / 1000.0      # MWh/a（η=35%）
    ghg_offset = float(ch4_gen[ipk]) * (coll) * 0.717 * 28.0 / 1000.0  # tCO2e/a

    # ---------------- 渗滤液：月水量平衡 ----------------
    annual_P = p.get("annual_P_mm")
    annual_P = float(annual_P) if annual_P not in (None, "") else 1200.0
    pet_a = p.get("annual_PET_mm")
    pet_a = float(pet_a) if pet_a not in (None, "") else 700.0
    monthly_P = p.get("monthly_P_mm")
    if isinstance(monthly_P, (list, tuple)) and len(monthly_P) == 12:
        P_m = np.asarray([float(x) for x in monthly_P])
        P_m = P_m / P_m.sum() * annual_P
    else:
        P_m = np.full(12, annual_P / 12.0)
    PET_m = np.full(12, pet_a / 12.0)
    runoff_coeff = min(max(float(p.get("runoff_coeff", 0.15) or 0.15), 0.0), 0.9)
    cover_cap = float(p.get("cover_storage_mm", 120) or 120)    # 覆盖土有效储水 mm
    fc = min(max(float(p.get("field_capacity", 0.35) or 0.35), 0.05), 0.7)
    im = min(max(float(p.get("initial_moisture_fraction", 0.5) or 0.5), 0.0), 1.0)
    k_waste = float(p.get("k_waste_ms", 1e-5) or 1e-5)
    recirc = min(max(float(p.get("leachate_recirc", 0) or 0), 0.0), 0.95)
    area = float(np.nansum((model.top_surface() - model.base_surface()) > 0.05)
                 * model._cell_area())
    area = max(area, 1.0)
    waste_h_m = float(np.nanmean(np.maximum(model.top_surface() - model.base_surface(), 0.0)))
    # 逐填埋年 cohort 储水：每个填埋年的垃圾层自带田间持水容量与初始含水率，
    # 入渗先把老→新各层亏水填满，饱和后入渗直接转化为渗滤液 —— 渗滤液随
    # 填埋进度自然爬坡，封场后趋于入渗量（与运行期垃圾逐层填埋一致）。
    n_coh = max(len(fill_years), 1)
    h_per = waste_h_m / n_coh
    cap_i = fc * h_per * 1000.0          # 单 cohort 持水容量 mm
    stores = [im * cap_i] * n_coh        # 初始含水
    S_cover = 0.5 * cover_cap            # 覆盖土储水初值
    leach_year = np.zeros(len(years))
    perc_year = np.zeros(len(years))
    for iy in range(len(years)):
        # 本年度已填埋的 cohort 数（填埋年结束后该层开始接收入渗）
        active = int(np.sum(fill_years <= years[iy]))
        active = max(min(active, n_coh), 0)
        for im_ in range(12):
            infil = P_m[im_] * (1 - runoff_coeff)
            et = min(PET_m[im_], S_cover)
            S_raw = S_cover + infil - et
            # 溢流=入渗（先算溢流再钳位——若先钳位会把超储水部分凭空丢掉）
            perc = max(S_raw - cover_cap, 0.0)
            S_cover = max(min(S_raw, cover_cap), 0.0)
            perc_year[iy] += perc
            if active == 0:
                continue
            remain = perc
            # 亏水填充：老层先饱和（先填先饱和先产液）
            for j in range(active):
                room = max(cap_i - stores[j], 0.0)
                take = min(room, remain)
                stores[j] += take
                remain -= take
                if remain <= 1e-9:
                    break
            leach_year[iy] += remain * (1 - recirc)
    leach_m3 = leach_year * area / 1000.0                        # m³/a
    ileach = int(np.argmax(leach_m3))
    perc_mm_a = float(np.mean(perc_year))

    # 衬垫缺陷渗漏
    liner = str(p.get("liner", "compacted_clay") or "compacted_clay")
    defect_k = {"compacted_clay": 1e-9, "single_hdpe": 1e-11, "composite": 5e-12,
                "double": 1e-12}.get(liner, 1e-9)
    defect_area = float(p.get("defect_area_m2", 1e-4) or 1e-4)
    head = min(0.3 + waste_h_m * 0.01, 1.0)
    leak_m3y = defect_k * (head / 1.0) * defect_area * 3.15e7

    # ---------------- 水质（封场龄期经验曲线，产酸→产甲烷→稳定相） ----------------
    years_a = np.arange(0, horizon + 1)
    cod = 65000.0 * np.exp(-0.12 * years_a) + 1500.0
    bod5 = cod * (0.08 + 0.42 * np.exp(-0.35 * years_a))
    nh3n = 1800.0 * np.exp(-0.045 * years_a) + 120.0
    tn = 1.4 * nh3n + 40.0
    cl = 1200.0 * np.exp(-0.08 * years_a) + 250.0
    ss = 800.0 * np.exp(-0.1 * years_a) + 80.0
    tp = 35.0 * np.exp(-0.1 * years_a) + 2.0
    ph = 5.8 + 2.2 * (1 - np.exp(-0.25 * years_a))
    GB2 = {"COD": 100.0, "BOD5": 30.0, "NH3-N": 25.0, "TN": 40.0, "SS": 30.0, "TP": 3.0}

    do_column = bool(p.get("do_column", False))
    do_plume = bool(p.get("do_plume", False))
    plume_years = int(p.get("plume_years", 30) or 30)
    plume_days = p.get("plume_snapshot_days") or [365, 3650, 10950]
    plume_days = [d for d in plume_days if 0 < d <= plume_years * 365][:6] or [3650]
    time_options = {
        "gas_years": [int(t) for t in years[::max(1, len(years) // 20)]],
        "plume_days": plume_days,
        "gas_year_used": peak_year,
        "plume_day_used": int(plume_days[len(plume_days) // 2]),
    }

    # ---------------- 结果表 ----------------
    i0 = 0
    rows = [
        [f"产气峰值 CH₄", f"{float(ch4_gen[ipk]) / 1e4:.1f} 万m³/a（{peak_year} 年，收集 {coll * 100:.0f}%）"],
        [f"产气峰值 CO₂", f"{float(co2_gen[ipk]) / 1e4:.1f} 万m³/a（含好氧早期段）"],
        ["峰值年气体构成", f"CH₄ {comp_pk['ch4_pct']}% · CO₂ {comp_pk['co2_pct']}% · "
                           f"H₂S {comp_pk['h2s_ppmv']:.0f} ppmv · NH₃ {comp_pk['nh3_ppmv']:.0f} ppmv（另 N₂ 侵入 2~5%）"],
        ["臭气 H₂S 峰值", f"{float(h2s_gen[ipk]):.0f} m³/a（排放 {float(h2s_emis[ipk]):.0f}，≈{h2s_ppmv:.0f} ppmv 设定）"],
        ["臭气 NH₃ 峰值", f"{float(nh3_gen[ipk]):.0f} m³/a（排放 {float(nh3_emis[ipk]):.0f}）"],
        ["累计产气 CH₄", f"{cum_ch4:.0f} 万m³（{horizon} 年）"],
        ["发电潜力（峰值年）", f"{power_mwh:.0f} MWh/a（纯 CH₄ 10 kWh/m³，η=35%）"],
        ["温室减排（收集燃烧）", f"{ghg_offset:.0f} tCO₂e/a（GWP=28）"],
        ["渗滤液产量", f"峰值 {float(leach_m3.max()):.0f} m³/a（{int(years[ileach])} 年），"
                       f"{horizon} 年末 {float(leach_m3[-1]):.0f} m³/a（入渗 {perc_mm_a:.0f} mm/a）"],
        ["渗滤液初期水质", f"COD {cod[0]:.0f} / BOD₅ {bod5[0]:.0f} / NH₃-N {nh3n[0]:.0f} / "
                           f"pH {ph[0]:.1f}（产酸相，B/C≈{bod5[0] / max(cod[0], 1):.2f}）"],
        ["渗滤液 10 年水质", f"COD {cod[min(10, len(cod) - 1)]:.0f} / NH₃-N {nh3n[min(10, len(nh3n) - 1)]:.0f} / "
                             f"pH {ph[min(10, len(ph) - 1)]:.1f}（产甲烷相）"],
        ["GB 16889-2008 表2", f"原液 COD 超限 {cod[0] / GB2['COD']:.0f} 倍、NH₃-N 超 {nh3n[0] / GB2['NH3-N']:.0f} 倍"
                               f"（限值 COD {GB2['COD']:.0f}/BOD₅ {GB2['BOD5']:.0f}/NH₃-N {GB2['NH3-N']:.0f}）——须处理达标"],
        ["衬垫渗漏", f"{leak_m3y:.2f} m³/a（{liner}，水头 {head:.2f} m）"],
    ]
    table = {"cols": ["指标", "数值"], "rows": rows}
    key = {"gas_peak_ch4_m3y": round(float(ch4_gen[ipk]), 0),
           "gas_peak_ch4_wan_m3y": round(float(ch4_gen[ipk]) / 1e4, 1),
           "gas_peak_year": peak_year,
           "gas_peak_co2_m3y": round(float(co2_gen[ipk]), 0),
           "h2s_peak_m3y": round(float(h2s_gen[ipk]), 1),
           "h2s_ppmv_set": h2s_ppmv,
           "nh3_peak_m3y": round(float(nh3_gen[ipk]), 1),
           "cum_ch4_wan_m3": round(cum_ch4, 0),
           "power_MWh_peak": round(power_mwh, 0),
           "ghg_offset_tco2e": round(ghg_offset, 0),
           "leachate_peak_m3y": round(float(leach_m3.max()), 0),
           "leachate_m3y": round(float(leach_m3[-1]), 0),
           "percolation_mm_a": round(perc_mm_a, 0),
           "cod0_mg_l": round(float(cod[0]), 0),
           "ph0": round(float(ph[0]), 2),
           "leak_m3y": round(leak_m3y, 2),
           "seepage_velocity_m_d": round(float(p.get("aq_K", 5) or 5)
                                          * float(p.get("aq_gradient", 0.005) or 0.005)
                                          / max(float(p.get("aq_porosity", 0.3) or 0.3), 0.05), 3)}
    step = max(1, len(years) // 60)
    data = {"table": table, "key_numbers": key, "time_options": time_options,
            "series": {"years": [int(t) for t in years[::step]],
                        "ch4_gen_wan": [round(float(x) / 1e4, 2) for x in ch4_gen[::step]],
                        "ch4_emis_wan": [round(float(x) / 1e4, 2) for x in ch4_emis[::step]],
                        "co2_gen_wan": [round(float(x) / 1e4, 2) for x in co2_gen[::step]],
                        "h2s_m3y": [round(float(x), 1) for x in h2s_gen[::step]],
                        "nh3_m3y": [round(float(x), 1) for x in nh3_gen[::step]],
                        "lfg_wan": [round(float(x) / 1e4, 2) for x in lfg_gen[::step]],
                        "leachate_m3y": [round(float(x), 0) for x in leach_m3[::step]],
                        "p_mm": [round(float(x), 0) for x in np.full(len(years[::step]), annual_P)],
                        "pet_mm": [round(float(x), 0) for x in np.full(len(years[::step]), pet_a)],
                        "quality_years": [int(t) for t in years_a[::max(1, len(years_a) // 60)]],
                        "cod": [round(float(x), 0) for x in cod[::max(1, len(years_a) // 60)]],
                        "bod5": [round(float(x), 0) for x in bod5[::max(1, len(years_a) // 60)]],
                        "nh3n": [round(float(x), 0) for x in nh3n[::max(1, len(years_a) // 60)]],
                        "cl": [round(float(x), 0) for x in cl[::max(1, len(years_a) // 60)]],
                        "ph": [round(float(x), 2) for x in ph[::max(1, len(years_a) // 60)]]},
            "gas_composition_peak": comp_pk}
    if do_plume:
        try:
            pm, well = plume_metrics(p, t_day=float(plume_days[len(plume_days) // 2]))
            data["key_numbers"].update(pm)
            data["plume"] = pm
            if well:
                data["well_time_series"] = well
            rows.append(["羽流超限前锋", f"{pm['plume_length_exceed_m']:.0f} m"
                          f"（>{pm['threshold_mg_l']:.0f} mg/L，第 {pm['plume_day']:.0f} 天）"])
            if well:
                rows.append(["敏感井浓度", f"{well['conc_mg_l']:.1f} mg/L（{horizon} 年末，"
                              f"井距 {well['distance_m']:.0f} m）"])
        except Exception as pe:
            data.setdefault("notes_extra", [f"羽流指标计算失败：{pe}"])
    summary = (f"污染链路完成：产气峰值 CH₄ {float(ch4_gen[ipk]) / 1e4:.1f} 万m³/a（{peak_year} 年，"
               f"H₂S {float(h2s_gen[ipk]):.0f} m³/a、NH₃ {float(nh3_gen[ipk]):.0f} m³/a），"
               f"渗滤液峰值 {float(leach_m3.max()):.0f} m³/a，发电 {power_mwh:.0f} MWh/a"
               f"（羽流{'开' if do_plume else '关'}）")
    return {"ok": True, "summary": summary, "grade": None, "data": data,
            "notes": ["产气=LandGEM 式分气体一阶动力学（CH₄/CO₂ 化学计量等体积+好氧段；"
                      "H₂S/NH₃ 独立动力学，峰提前）",
                      "渗滤液=HELP 简化月水量平衡（径流→覆盖储水→入渗→超田间持水排出，"
                      "垃圾体渗透系数限速）",
                      "水质=封场龄期经验曲线（产酸→产甲烷→稳定相）+ GB 16889-2008 表2 判定"]}


# ==========================================================================
# 二维地下水羽流（Domenico/BIOSCREEN 型筛选解）
# ==========================================================================

def _plume_params(p):
    """从扁平参数字典提取羽流物理量。"""
    K = float(p.get("aq_K", 5) or 5)
    grad = float(p.get("aq_gradient", 0.005) or 0.005)
    ne = max(float(p.get("aq_porosity", 0.3) or 0.3), 0.05)
    v = K * grad / ne                                  # 渗流流速 (m/d)
    R = max(float(p.get("retardation", 1.0) or 1.0), 0.05)
    vr = v / R                                         # 阻滞校正
    aL = float(p.get("plume_alpha_L", 10) or 10)
    aT = float(p.get("plume_alpha_T", aL / 10.0) or (aL / 10.0))
    c0 = float(p.get("source_conc", 3000) or 3000)
    hl = p.get("half_life_d")
    lam = math.log(2.0) / float(hl) if hl not in (None, "") and float(hl) > 0 else 0.0
    box = p.get("plume_source_box")
    if isinstance(box, (list, tuple)) and len(box) == 4:
        try:
            x_src = float(box[0])
            W = max(abs(float(box[3]) - float(box[2])), 1.0)
        except Exception:
            x_src, W = 0.0, 30.0
    else:
        x_src, W = 0.0, 30.0
    up = float(p.get("aq_upstream_m", 50) or 50)
    down = float(p.get("aq_downstream_m", 1000) or 1000)
    lat = float(p.get("aq_lateral_m", 150) or 150)
    threshold = float(p.get("exceed_threshold_mg_l", 250) or 250)
    return dict(v=v, vr=vr, R=R, aL=aL, aT=aT, c0=c0, lam=lam,
                x_src=x_src, W=W, up=up, down=down, lat=lat, threshold=threshold,
                Dm=8.64e-5)  # 分子扩散 m²/d


def plume_conc(x, y, t_day, pp):
    """单点浓度 (mg/L)。x/y 相对源区（源位于 x=x_src, y=0）。

    解析结构（BIOSCREEN 式筛选解，量纲自洽）：
      纵向：Ogata-Banks 瞬态恒源解 C_x = ½erfc((x−vr·t)/2√(DL·t))
            + ½·exp(vr·x/DL)·erfc((x+vr·t)/2√(DL·t))
      衰减：一阶 λ 沿程指数 exp(−λ·x/vr)（稳态剖面口径）
      横向：有限宽源 W 的高斯展开，σy(x)=√(2·αT·min(x, vr·t))（前缘外不再增长）
    """
    from scipy.special import erf, erfc
    vr = pp["vr"]
    if vr <= 0:
        return 0.0
    DL = pp["aL"] * vr + pp["Dm"]
    t = max(float(t_day), 1e-6)
    xr = float(x) - pp["x_src"]
    if xr < 0:
        return 0.0
    arg1 = (xr - vr * t) / (2.0 * math.sqrt(DL * t))
    term1 = 0.5 * erfc(max(-8.0, min(arg1, 8.0)))
    term2 = 0.0
    e = vr * xr / DL
    if e < 60:
        arg2 = (xr + vr * t) / (2.0 * math.sqrt(DL * t))
        if arg2 < 8:
            term2 = 0.5 * math.exp(e) * erfc(arg2)
    cx = max(term1 + term2, 0.0)
    if pp["lam"] > 0:
        cx *= math.exp(-pp["lam"] * xr / vr)
    x_eff = min(xr, max(vr * t, 1e-6))
    sy = math.sqrt(2.0 * pp["aT"] * x_eff)
    if sy < 1e-6:
        fy = 1.0 if abs(float(y)) <= pp["W"] / 2 else 0.0
    else:
        s2 = sy * 1.41421356237
        fy = 0.5 * (erf(max(-8, min((float(y) + pp["W"] / 2) / s2, 8)))
                    - erf(max(-8, min((float(y) - pp["W"] / 2) / s2, 8))))
    return pp["c0"] * cx * max(fy, 0.0)


def plume_grid(params, t_day, nx=140, ny=70, x_range=None, y_range=None):
    """二维浓度场 (mg/L)，返回 (X, Y, C, pp)。向量化（scipy erf/erfc）。"""
    from scipy.special import erf, erfc
    pp = _plume_params(dict(params or {}))
    x0 = x_range[0] if x_range else -pp["up"]
    x1 = x_range[1] if x_range else pp["down"]
    y0 = y_range[0] if y_range else -pp["lat"]
    y1 = y_range[1] if y_range else pp["lat"]
    xs = np.linspace(x0, x1, nx)
    ys = np.linspace(y0, y1, ny)
    X, Y = np.meshgrid(xs, ys)
    vr = pp["vr"]
    DL = pp["aL"] * vr + pp["Dm"]
    t = max(float(t_day), 1e-6)
    Xr = np.maximum(X - pp["x_src"], 0.0)
    arg1 = np.clip((Xr - vr * t) / (2.0 * np.sqrt(DL * t)), -8, 8)
    Cx = 0.5 * erfc(arg1)
    e = np.clip(vr * Xr / DL, 0, 60)
    arg2 = np.clip((Xr + vr * t) / (2.0 * np.sqrt(DL * t)), -8, 8)
    Cx = Cx + 0.5 * e * erfc(arg2)
    Cx = np.clip(Cx, 0.0, 1.5)
    if pp["lam"] > 0:
        Cx = Cx * np.exp(np.clip(-pp["lam"] * Xr / vr, -60, 0))
    x_eff = np.minimum(Xr, np.maximum(vr * t, 1e-6))
    sy = np.sqrt(2.0 * pp["aT"] * x_eff)
    s2 = np.maximum(sy * 1.41421356237, 1e-9)
    fy = 0.5 * (erf(np.clip((Y + pp["W"] / 2) / s2, -8, 8))
                - erf(np.clip((Y - pp["W"] / 2) / s2, -8, 8)))
    C = pp["c0"] * Cx * np.clip(fy, 0.0, 1.0)
    C = np.where(X - pp["x_src"] < 0, 0.0, C)
    return X, Y, C, pp


def plume_metrics(params, t_day=None):
    """羽流筛查指标：超限前锋距离、中心线峰值、敏感井浓度时程。"""
    pp = _plume_params(dict(params or {}))
    t_day = float(t_day) if t_day else 3650.0
    xs = np.linspace(0.0, pp["down"], 400)
    from scipy.special import erf, erfc  # noqa: F401
    cc = np.array([plume_conc(x, 0.0, t_day, pp) for x in xs])
    over = xs[cc >= pp["threshold"]]
    length = float(over.max()) if over.size else 0.0
    peak = float(cc.max())
    out = {"plume_day": round(t_day, 0),
           "threshold_mg_l": pp["threshold"],
           "plume_length_exceed_m": round(length, 1),
           "plume_centerline_peak_mg_l": round(peak, 1),
           "seepage_velocity_m_d": round(pp["v"], 4),
           "retardation": pp["R"]}
    well = None
    if params.get("well_on"):
        wd = float(params.get("well_distance_m", 500) or 500)
        wo = float(params.get("well_offset_m", 0) or 0)
        horizon = int(params.get("horizon_years", 50) or 50)
        years = list(range(0, horizon + 1))
        cw = [plume_conc(wd, wo, y * 365.0, pp) for y in years]
        well = {"distance_m": wd, "offset_m": wo,
                "years": years,
                "conc_mg_l": [round(c, 1) for c in cw],
                "exceed_years": [y for y, c in zip(years, cw) if c >= pp["threshold"]]}
        out["well_c_mg_l"] = round(cw[-1], 1)
    return out, well


def plume_centerline_time(params, nx=120, nt=60, t_max_day=None):
    """C(x, t) 沿中心线时空场（羽流剖面图用）。"""
    pp = _plume_params(dict(params or {}))
    t_max = float(t_max_day) if t_max_day else pp["down"] / max(pp["vr"], 1e-6) * 1.5
    t_max = min(t_max, 100 * 365.0)
    xs = np.linspace(0.0, pp["down"], nx)
    ts = np.linspace(max(t_max / nt, 1.0), t_max, nt)
    C = np.zeros((nt, nx))
    for i, t in enumerate(ts):
        for j, x in enumerate(xs):
            C[i, j] = plume_conc(x, 0.0, t, pp)
    return xs, ts, C, pp


# ==========================================================================
# 网格叠加层（slip/fs/heat）—— 由分析侧复用
# ==========================================================================

def fs_overlay_mesh(model, params):
    """Fs 超阈值区着色（fill 口径近似：以局部坡度与无限边坡 Fs 上色）。"""
    p = dict(params or {})
    c = float(p.get("c", 8) or 8)
    phi = float(p.get("phi_deg", 25) or 25)
    gamma = float(p.get("gamma", 10) or 10)
    ru = float(p.get("ru", 0.2) or 0.2)
    threshold = float(p.get("threshold", 1.3) or 1.3)
    Z = model.top_surface()
    base = model.base_surface()
    h = np.maximum(Z - base, 0.0)
    gy, gx = np.gradient(Z, model.gy, model.gx)
    beta = np.arctan(np.hypot(gx, gy))
    zz = np.cos(beta) ** 2
    num = c + h * gamma * zz * math.tan(math.radians(phi))
    den = np.maximum(h * gamma * np.sin(beta) * np.cos(beta) + h * gamma * zz * ru, 1e-6)
    fs = np.where(h > 0.3, num / den, np.inf)
    verts, faces = [], []
    idx = 1
    nx = model.nx
    for i in range(model.ny - 1):
        for j in range(nx - 1):
            f4 = [fs[i, j], fs[i, j + 1], fs[i + 1, j + 1], fs[i + 1, j]]
            if min(f4) >= threshold or min(f4) == np.inf:
                continue
            pts = [(model.X[i, j], Z[i, j] + 0.15, model.Y[i, j]),
                   (model.X[i, j + 1], Z[i, j + 1] + 0.15, model.Y[i, j + 1]),
                   (model.X[i + 1, j + 1], Z[i + 1, j + 1] + 0.15, model.Y[i + 1, j + 1]),
                   (model.X[i + 1, j], Z[i + 1, j] + 0.15, model.Y[i + 1, j])]
            for (px, pz, py) in pts:
                verts.append(f"v {px:.2f} {pz:.3f} {py:.2f} 0.85 0.35 0.10")
            faces.append(f"f {idx} {idx + 1} {idx + 2}")
            faces.append(f"f {idx} {idx + 2} {idx + 3}")
            idx += 4
    return verts[:6000] + faces[:1500] if verts else []


def slip_overlay_mesh(model, params):
    """最危险滑面带：跑一次稳定性，把 best.circle 投影成带。"""
    try:
        r = analyze_stability(model, params or {})
        best = r["data"].get("best")
        if not best or not best.get("circle"):
            return []
        xc, zc, R = best["circle"]
        A, B = best["A"], best["B"]
        verts, faces = [], []
        n = 40
        t = np.linspace(0, 1, n)
        xs = A[0] + (B[0] - A[0]) * t
        ys = A[1] + (B[1] - A[1]) * t
        k = 0
        for i in range(n):
            arc_z = zc - math.sqrt(max(R ** 2 - (xs[i] - xc) ** 2, 0.0))
            verts.append(f"v {xs[i]:.2f} {arc_z + 0.2:.3f} {ys[i]:.2f} 0.85 0.10 0.10")
            if i > 0:
                faces.append(f"f {k + 1} {k + 2} {k + 2}")
            k += 1
        return verts + faces
    except Exception:
        return []


def heat_overlay_mesh(model, params):
    """沉降热力层：按 settlement 平面差异沉降着色（简化：按堆厚）。"""
    p = dict(params or {})
    Hw = float(p.get("waste_height", 20) or 20)
    gw = float(p.get("gamma_waste", 10) or 10)
    Z = model.top_surface()
    base = model.base_surface()
    h = np.maximum(Z - base, 0.0)
    s = h * gw * Hw / 4500.0 * 100  # cm 粗估
    smax = float(s.max()) if s.max() > 0 else 1.0
    verts, faces = [], []
    idx = 1
    step = max(1, model.nx // 40)
    for i in range(0, model.ny - 1, step):
        for j in range(0, model.nx - 1, step):
            v = float(s[i, j]) / smax
            r, g, b = v, 0.25 + 0.3 * (1 - v), 1 - v
            pts = [(model.X[i, j], Z[i, j] + 0.25, model.Y[i, j]),
                   (model.X[i + step, j], Z[i + step, j] + 0.25, model.Y[i + step, j]),
                   (model.X[i + step, j + step], Z[i + step, j + step] + 0.25, model.Y[i + step, j + step]),
                   (model.X[i, j + step], Z[i, j + step] + 0.25, model.Y[i, j + step])]
            for (px, pz, py) in pts:
                verts.append(f"v {px:.2f} {pz:.3f} {py:.2f} {r:.2f} {g:.2f} {b:.2f}")
            faces.append(f"f {idx} {idx + 1} {idx + 2}")
            faces.append(f"f {idx} {idx + 2} {idx + 3}")
            idx += 4
    return verts[:6000] + faces[:1500] if verts else []
