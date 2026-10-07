"""figs.py · matplotlib 图件（统一视觉风格，中文微软雅黑）。

23 个图键与前端 spec/views.ts 的 SUB_BARS / RENDERABLE 对齐：
  model3d / contour / slope_map / section / storage_curve /
  settlement_profile / settlement_plane / fs_grid / critical_arc /
  section_scan / monte_carlo / exc_arc / exc_levels / exc_fs_grid /
  exc_phases / exc_stage / gas_curve / gas_field / leachate / quality /
  column / plume_plan / plume_section

视觉规范（style.py）：
  - rcParams 统一字号/网格/spine；固定调色板
  - 标题一律「场地名 · 图名」，右下角口径戳脚注
  - 等比值图 adaptive_figsize 按数据纵横比自适应，消灭带状大留白
  - Fs 图 None=缺口注记、异常值截断显示；标注一律带底色 bbox 不压数据
"""
from __future__ import annotations

import math

import matplotlib.pyplot as plt
import numpy as np

from . import style
from .style import PALETTE, adaptive_figsize, apply_style, finish, save

FIG_LABELS = {
    "model3d": "三维模型", "contour": "顶面等高线", "slope_map": "坡度分级",
    "section": "剖面", "storage_curve": "库容曲线", "settlement_profile": "沉降深度剖面",
    "settlement_plane": "差异沉降平面", "fs_grid": "各断面最小 Fs", "critical_arc": "临界圆弧",
    "section_scan": "断面扫描", "monte_carlo": "Monte Carlo", "exc_arc": "开挖临界圆弧",
    "exc_levels": "开挖逐级坡", "exc_fs_grid": "开挖各断面最小 Fs", "exc_phases": "分区阶段",
    "exc_stage": "阶段剖面", "gas_curve": "产气时程", "gas_field": "产气强度",
    "leachate": "渗滤液水量", "quality": "水质曲线", "column": "柱穿透",
    "plume_plan": "羽流平面", "plume_section": "羽流剖面",
}


# ==========================================================================
# 几何类
# ==========================================================================

def fig_model3d(model, path, params=None):
    from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
    p = dict(params or {})
    X, Y = model.X, model.Y
    base = model.base_surface()
    top = model.top_surface()
    fig = plt.figure(figsize=(8.8, 5.6))
    ax = fig.add_subplot(111, projection="3d")
    zexag = float(p.get("zexag", 1) or 1)
    z0 = float(np.nanmin(base))
    if p.get("show_base", True):
        ax.plot_surface(X, Y, (base - z0) * zexag, cmap="terrain",
                        linewidth=0, antialiased=True, alpha=0.92)
    if p.get("show_top", True):
        h = top - base
        ax.plot_surface(X, Y, (top - z0) * zexag,
                        facecolors=plt.cm.YlOrBr(np.clip(h / max(h.max(), 1e-6), 0, 1)),
                        linewidth=0, antialiased=True)
    flood = p.get("flood_level")
    if flood is not None:
        try:
            fx = np.array([[X.min(), X.max()], [X.min(), X.max()]])
            fy = np.array([[Y.min(), Y.min()], [Y.max(), Y.max()]])
            fz = np.full((2, 2), (float(flood) - z0) * zexag)
            ax.plot_surface(fx, fy, fz, color=PALETTE["primary"], alpha=0.4)
        except Exception:
            pass
    dx = float(X.max() - X.min()); dy = float(Y.max() - Y.min())
    dz = float((top.max() - z0)) * zexag
    ax.set_box_aspect((1.0, dy / max(dx, 1e-9), max(dz / max(dx, 1e-9), 0.08)))
    ztop_plot = float(np.nanmax((top - z0) * zexag))
    ax.set_zticks(np.linspace(0, ztop_plot, 3))
    ax.view_init(elev=28, azim=-58)
    ax.set_xlabel("X (m)", labelpad=2); ax.set_ylabel("Y (m)", labelpad=2)
    ax.set_zlabel("标高 (m)", labelpad=2)
    ax.tick_params(labelsize=8, pad=1)
    ax.xaxis.pane.set_alpha(0.0); ax.yaxis.pane.set_alpha(0.0); ax.zaxis.pane.set_alpha(0.05)
    fig.subplots_adjust(left=0.02, right=0.98, top=0.94, bottom=0.10)
    finish(fig, model.site_name, "三维模型（表面颜色=堆体高度分带）")
    save(fig, path)


def fig_contour(model, path, params=None):
    p = dict(params or {})
    Z = model.top_surface() if str(p.get("contour_surface", "top")) == "top" else model.base_surface()
    x0, x1 = float(np.nanmin(model.X)), float(np.nanmax(model.X))
    y0, y1 = float(np.nanmin(model.Y)), float(np.nanmax(model.Y))
    fig, ax = plt.subplots(figsize=adaptive_figsize(x1 - x0, y1 - y0))
    cf = ax.contourf(model.X, model.Y, Z, levels=14, cmap="terrain")
    ax.contour(model.X, model.Y, Z, levels=14, colors="k", linewidths=0.3, alpha=0.5)
    cb = fig.colorbar(cf, ax=ax, label="标高 (m)", shrink=0.9)
    cb.ax.tick_params(labelsize=8)
    for fp in model.footprints:
        pts = np.asarray(fp.fine + [fp.fine[0]])
        ax.plot(pts[:, 0], pts[:, 1], color=PALETTE["red"], lw=1.2, alpha=0.85)
    ax.set_xlabel("X (m)"); ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    finish(fig, model.site_name, "顶面等高线（红=坡脚线）")
    save(fig, path)


def fig_slope_map(model, path, params=None):
    p = dict(params or {})
    Z = model.top_surface()
    gy, gx = np.gradient(Z, model.gy, model.gx)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    h = Z - model.base_surface()
    slope = np.where(h > 0.05, slope, np.nan)
    x0, x1 = float(np.nanmin(model.X)), float(np.nanmax(model.X))
    y0, y1 = float(np.nanmin(model.Y)), float(np.nanmax(model.Y))
    fig, ax = plt.subplots(figsize=adaptive_figsize(x1 - x0, y1 - y0))
    cf = ax.pcolormesh(model.X, model.Y, slope, cmap="RdYlGn_r",
                       vmin=0, vmax=max(30, float(np.nanmax(slope))), shading="gouraud")
    cb = fig.colorbar(cf, ax=ax, label="坡度 (°)", shrink=0.9)
    cb.ax.tick_params(labelsize=8)
    ma = p.get("max_allow_deg")
    if ma:
        try:
            cs = ax.contour(model.X, model.Y, slope, levels=[float(ma)], colors="b",
                            linewidths=1.2, linestyles="--")
            ax.annotate(f"允许坡度 {float(ma):g}°", (x1 * 0.98, y0 + (y1 - y0) * 0.04),
                        fontsize=8, color="b", ha="right")
        except Exception:
            pass
    ax.set_xlabel("X (m)"); ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    finish(fig, model.site_name, "坡度分级（堆体顶面）")
    save(fig, path)


def fig_section(model, path, params=None, prof=None, stage_tag=""):
    """剖面图：堆体填色 + 基底/顶面线 + 特征点标注（只在坡脚/坡顶/平台端标注）。"""
    p = dict(params or {})
    if prof is None:
        from . import physics
        if p.get("direction"):
            x0d, y0d, x1d, y1d = model.domain
            ym = (y0d + y1d) / 2
            A, B = [x0d, ym], [x1d, ym]
        elif p.get("A") and p.get("B"):
            A, B = list(p["A"]), list(p["B"])
        else:
            sec = p.get("section") or {}
            A = list(sec.get("A") or [model.domain[0], 0])
            B = list(sec.get("B") or [model.domain[2], 0])
        prof = physics.section_profile(model, A, B, int(p.get("n", 240) or 240))
    fig, ax = plt.subplots(figsize=(9.2, 4.4))
    s, bz, tz = prof["s"], prof["base"], prof["top"]
    th = tz - bz
    ax.fill_between(s, bz, tz, color=PALETTE["brown"], alpha=0.85, label="堆体")
    ax.plot(s, bz, "k-", lw=1.4, label="基底")
    ax.plot(s, tz, color=PALETTE["primary"], lw=1.6, label="顶面")
    # 特征点标注：坡脚（厚度起/止）、坡顶（最大厚度区两端）
    act = np.where(th > 0.1)[0]
    if len(act) > 4:
        i0, i1 = int(act[0]), int(act[-1])
        imax = int(np.argmax(th))
        feats = [(i0, f"坡脚 {th[i0]:.1f}m"), (i1, f"坡脚 {th[i1]:.1f}m"),
                 (imax, f"最大堆厚 {th[imax]:.1f}m")]
        # 平台段端点（厚度≈最大值的首末）
        plat = np.where(th > th[imax] * 0.98)[0]
        if len(plat) > 3 and plat[0] > i0 + 2 and plat[-1] < i1 - 2:
            feats.append((int(plat[0]), f"平台起 {th[plat[0]]:.1f}m"))
            feats.append((int(plat[-1]), f"平台止 {th[plat[-1]]:.1f}m"))
        for i, txt in feats:
            ax.annotate(txt, (s[i], tz[i]), xytext=(0, 9), textcoords="offset points",
                        ha="center", fontsize=7.5, color="#333",
                        bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="#ccc", alpha=0.85))
    ax.set_xlabel("桩号 (m)"); ax.set_ylabel("标高 (m)")
    ax.legend(fontsize=8, loc="lower right")
    ymin = float(np.nanmin(bz)) - 1
    ymax = float(np.nanmax(tz)) + max(2.5, (float(np.nanmax(tz)) - ymin) * 0.12)
    ax.set_ylim(ymin, ymax)
    finish(fig, model.site_name, f"剖面（A→B）{stage_tag}")
    save(fig, path)


def fig_storage_curve(model, path, params=None):
    from . import physics
    r = physics.analyze_storage(model, params or {})
    curve = r["data"]["curve"]
    lv = np.asarray([v for v in curve["levels_m"]], dtype=float)
    vol = np.asarray([v if v is not None else np.nan for v in curve["volume_m3"]], dtype=float)
    area = np.asarray([v if v is not None else np.nan for v in curve["area_m2"]], dtype=float)
    fig, ax1 = plt.subplots(figsize=(8.6, 5))
    l1, = ax1.plot(vol, lv, color=PALETTE["primary"], marker="o", ms=2.6, label="累计库容 V（下轴）")
    ax1.set_xlabel("累计库容（万m³）", color=PALETTE["primary"])
    ax1.set_ylabel("填埋标高 (m)", color=PALETTE["primary"])
    ax1.tick_params(axis="x", labelcolor=PALETTE["primary"])
    ax2 = ax1.twiny()
    l2, = ax2.plot(area, lv, color=PALETTE["red"], ls="--", lw=1.3, label="库盆面积 A（上轴）")
    ax2.set_xlabel("库盆面积（万m²）", color=PALETTE["red"])
    ax2.tick_params(axis="x", labelcolor=PALETTE["red"])
    for mk in (params or {}).get("curve_markers") or []:
        try:
            ax1.axhline(float(mk[0]), color=PALETTE["green"], ls="--", lw=1)
            ax1.annotate(str(mk[1]), (0.985, float(mk[0])), xycoords=("axes fraction", "data"),
                         fontsize=8, color=PALETTE["green"], ha="right", va="bottom",
                         bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="#bbb", alpha=0.85))
        except Exception:
            pass
    ax1.legend(handles=[l1, l2], fontsize=8, loc="lower right")
    ax1.grid(alpha=0.25)
    finish(fig, model.site_name, "库容曲线 V-h 与面积 A-h")
    save(fig, path)


def fig_settlement_profile(model, path, params=None):
    p = dict(params or {})
    layers = p.get("layers") or p.get("settlement_params", {}).get("layers") or [
        {"name": "素填土/耕植土", "thickness": 4, "Es_kPa": 2500},
        {"name": "粉质黏土", "thickness": 8, "Es_kPa": 4500},
        {"name": "强风化基岩", "thickness": 6, "Es_kPa": 18000}]
    Hw = float(p.get("waste_height", 20) or 20)
    gw = float(p.get("gamma_waste", 10) or 10)
    gs = float(p.get("gamma_soil", 18.5) or 18.5)
    depth, stress, cum = [0], [0.0], [0.0]
    S = 0.0
    z = 0.0
    for lay in layers:
        th = float(lay.get("thickness", lay.get("h", 0)) or 0)
        Es = float(lay.get("Es_kPa", lay.get("Es", 4500)) or 4500)
        nsub = max(1, int(round(th / 1.0)))
        step = th / nsub
        for k in range(nsub):
            s0 = gs * (z + step * (k + 0.5))          # 子层中点自重应力
            ds = gw * Hw
            S += ds * step / Es                        # 子层压缩量（Δσ·h/Es）
            depth.append(z + step * (k + 1))
            stress.append(s0)
            cum.append(S * 100)
        z += th
    fig, ax1 = plt.subplots(figsize=(7.4, 5))
    l1, = ax1.plot(stress, depth, color=PALETTE["primary"], label="自重应力 σ0 (kPa)")
    ax1.invert_yaxis()
    ax1.set_xlabel("有效自重应力 (kPa)", color=PALETTE["primary"])
    ax1.set_ylabel("深度 (m)")
    ax2 = ax1.twiny()
    l2, = ax2.plot(cum, depth, color=PALETTE["red"], label="累计沉降 (cm)")
    ax2.set_xlabel("累计沉降 (cm)", color=PALETTE["red"])
    ax1.legend(handles=[l1, l2], fontsize=8, loc="lower right")
    ax1.grid(alpha=0.25)
    finish(fig, model.site_name, "沉降-深度剖面（分层总和法）")
    save(fig, path)


def fig_settlement_plane(model, path, params=None):
    p = dict(params or {})
    Hw = float(p.get("waste_height", 20) or 20)
    gw = float(p.get("gamma_waste", 10) or 10)
    base = model.base_surface()
    h = np.maximum(model.top_surface() - base, 0.0)
    s = h * gw / 4500.0 * 100
    x0, x1 = float(np.nanmin(model.X)), float(np.nanmax(model.X))
    y0, y1 = float(np.nanmin(model.Y)), float(np.nanmax(model.Y))
    fig, ax = plt.subplots(figsize=adaptive_figsize(x1 - x0, y1 - y0))
    cf = ax.pcolormesh(model.X, model.Y, np.where(h > 0.05, s, np.nan),
                       cmap="YlOrRd", shading="gouraud")
    cb = fig.colorbar(cf, ax=ax, label="主固结沉降 (cm)", shrink=0.9)
    cb.ax.tick_params(labelsize=8)
    ax.set_xlabel("X (m)"); ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    finish(fig, model.site_name, "差异沉降平面分布")
    save(fig, path)


# ==========================================================================
# 稳定类（Fs 图统一：None=缺口注记、异常值截断、y 轴自适应）
# ==========================================================================

def _prep_fs_series(fss, threshold):
    """返回 (plot_vals, clipped_raw, ymax)：None→nan；>5×阈值截断到 cap 并记注记。"""
    cap = max(5.0 * threshold, threshold + 4.0)
    vals, clipped = [], []
    for f in fss:
        if f is None or (isinstance(f, float) and math.isnan(f)):
            vals.append(np.nan)
        elif f > cap:
            vals.append(cap)
            clipped.append(f)
        else:
            vals.append(float(f))
    ok = [v for v, raw in zip(vals, fss) if not math.isnan(v) and (raw is None or raw <= cap - 1e-6)]
    ymax = min(max(max(ok) * 1.3 if ok else 2.0, threshold * 1.8, 1.6), cap * 1.05)
    # 截断显示值钳到轴内（真值由调用方以 ↑数字 标注），避免画出 y 轴上限之外
    vals = [v if math.isnan(v) or v < ymax - 1e-6 else ymax * 0.94 for v in vals]
    return vals, clipped, ymax


def fig_fs_grid(model, path, params=None, exc=False):
    """Fs 网格：最危险断面的 Bishop 圆心网格热力图（xc × R，对 zc 取最小），
    ★ 标最优圆心 —— 与桌面「圆心网格 n_grid × 半径档 n_R」语义一致。"""
    from . import physics
    if exc:
        r = physics.analyze_excavation(model, params or {})
    else:
        r = physics.analyze_stability(model, params or {})
    d = r["data"]
    thr = float((params or {}).get("threshold", (params or {}).get("fs_threshold", 1.3)) or 1.3)
    gs = d.get("grid_scan")
    if not gs or not gs.get("fs"):
        # 无网格数据（如过薄场地）→ 回退柱状图
        fig_fs_bars(model, path, params, exc=exc)
        return
    xcs, Rs, fmat = gs["xc"], gs["R"], gs["fs"]
    cap = 5.0 * thr
    # 对 zc 取最小 → F[ci][ri]；None → nan；>cap 截断显示
    Fm = np.full((len(xcs), len(Rs)), np.nan)
    for ci in range(len(xcs)):
        for ri in range(len(Rs)):
            zs = [fmat[ci][zi][ri] for zi in range(len(gs["zc"]))
                  if fmat[ci][zi][ri] is not None]
            if zs:
                Fm[ci, ri] = min(min(zs), cap)
    valid = Fm[~np.isnan(Fm)]
    vmax = max(min(cap, float(np.nanmax(valid)) * 1.15), thr * 1.6, 1.6)
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    cmap = plt.cm.RdYlGn.copy()
    cmap.set_bad("#ececec")          # 无效圆心组合（滑面不成立）显示浅灰
    pc = ax.pcolormesh(Rs, xcs, np.clip(Fm, None, vmax), cmap=cmap,
                       vmin=max(thr - 0.8, 0.4), vmax=vmax, shading="nearest")
    cb = fig.colorbar(pc, ax=ax, label="Fs（圆心网格，对圆心高取最小）", shrink=0.9)
    cb.ax.tick_params(labelsize=8)
    n_invalid = int(np.isnan(Fm).sum())
    if n_invalid:
        ax.annotate(f"浅灰 = 无有效滑面（{n_invalid}/{Fm.size} 组合）", (0.02, 1.03),
                    xycoords="axes fraction", fontsize=7.5, color=PALETTE["gray"])
    try:
        cs = ax.contour(Rs, xcs, Fm, levels=[thr], colors="k", linewidths=1.0, linestyles="--")
        if len(cs.allsegs[0]) > 0:
            ax.annotate(f"Fs={thr:g} 等值线", (Rs[-1], xcs[-1]), fontsize=7.5, color="k",
                        ha="right", va="bottom")
    except Exception:
        pass
    best = d.get("best")
    if best and best.get("Fs") is not None:
        # ★ 画在**粗网格**的最优组合上（加密后的最优圆可能移出网格范围）
        bci, bri, bzi, fbest = None, None, None, None
        for ci in range(len(xcs)):
            for zi in range(len(gs["zc"])):
                for ri in range(len(Rs)):
                    f = gs["fs"][ci][zi][ri]
                    if f is not None and (fbest is None or f < fbest):
                        bci, bri, bzi, fbest = ci, ri, zi, f
        if bri is not None:
            ax.plot([Rs[bri]], [xcs[bci]], marker="*", ms=14,
                    color=PALETTE["red"], mec="k", mew=0.6)
            ax.annotate(f"粗网格最优 Fs={fbest:.3f}\n加密后 Fs={best['Fs']:.3f}",
                        (Rs[bri], xcs[bci]), xytext=(10, 8), textcoords="offset points",
                        fontsize=8, color=PALETTE["red"], fontweight="bold")
    ax.set_xlabel("滑弧半径 R (m)"); ax.set_ylabel("圆心 X (m)")
    finish(fig, model.site_name, ("开挖" if exc else "填埋") + "Fs 圆心网格（黑虚线=阈值）")
    save(fig, path)


def fig_fs_bars(model, path, params=None, exc=False):
    """Fs 柱状图（fs_grid 无网格数据时的回退）。"""
    from . import physics
    if exc:
        r = physics.analyze_excavation(model, params or {})
    else:
        r = physics.analyze_stability(model, params or {})
    secs = r["data"].get("sections") or []
    thr = float((params or {}).get("threshold", (params or {}).get("fs_threshold", 1.3)) or 1.3)
    fss = [s.get("Fs") for s in secs]
    vals, clipped, ymax = _prep_fs_series(fss, thr)
    fig, ax = plt.subplots(figsize=(8.6, 4.2))
    xs = list(range(1, len(vals) + 1))
    for xi, v in zip(xs, vals):
        raw = fss[xi - 1]
        clipped_here = raw is not None and not math.isnan(v) and raw > v + 1e-6
        if math.isnan(v):
            ax.annotate("过薄", (xi, ymax * 0.03), ha="center", fontsize=7.5,
                        color=PALETTE["gray"], rotation=90)
        elif clipped_here:
            ax.bar([xi], [v], color=PALETTE["gray"], width=0.62)
            ax.annotate(f"↑{raw:.0f}", (xi, v), ha="center", va="bottom",
                        fontsize=7, color=PALETTE["gray"])
        else:
            okc = PALETTE["primary"] if (v >= thr) else PALETTE["red"]
            ax.bar([xi], [v], color=okc, width=0.62)
    ax.axhline(thr, color=PALETTE["red"], ls="--", lw=1.1)
    ax.annotate(f"阈值 {thr:g}", (len(vals), thr), fontsize=8, color=PALETTE["red"],
                va="bottom", ha="right")
    ax.set_xlabel("断面序号"); ax.set_ylabel("Fs（断面最小，Bishop）")
    ax.set_ylim(0, ymax)
    ax.set_xticks(xs[::max(1, len(xs) // 16)])
    finish(fig, model.site_name, ("开挖" if exc else "填埋") + "各断面最小 Fs（灰=过薄/截断）")
    save(fig, path)


def fig_critical_arc(model, path, params=None, exc=False):
    from . import physics
    if exc:
        r = physics.analyze_excavation(model, params or {})
    else:
        r = physics.analyze_stability(model, params or {})
    best = r["data"].get("best")
    p = dict(params or {})
    direction = str(p.get("direction", p.get("scan_direction", "X")) or "X").upper()
    x0d, y0d, x1d, y1d = model.domain
    base = model.base_surface()
    top = model.top_surface()
    if direction == "X":
        y_probe = best["A"][1] if best and best.get("A") else (y0d + y1d) / 2
        iy = int(np.clip(np.searchsorted(model.gy, y_probe), 1, model.ny - 1)) - 1
        xs = model.gx; bz = base[iy]; tz = top[iy]
    else:
        x_probe = best["A"][0] if best and best.get("A") else (x0d + x1d) / 2
        ix = int(np.clip(np.searchsorted(model.gx, x_probe), 1, model.nx - 1)) - 1
        xs = model.gy; bz = base[:, ix]; tz = top[:, ix]
    span_x = float(xs[-1] - xs[0])
    zlo = float(min(np.nanmin(bz), (best["circle"][1] if best and best.get("circle") else 0))) - 2
    zhi = float(np.nanmax(tz)) + 2.5
    fig, ax = plt.subplots(figsize=adaptive_figsize(span_x, (zhi - zlo) * 2.2, base_w=9.0))
    ax.fill_between(xs, bz, tz, color=PALETTE["brown"], alpha=0.75, label="堆体")
    ax.plot(xs, bz, "k-", lw=1.2, label="基底")
    ax.plot(xs, tz, color=PALETTE["primary"], lw=1.3, label="顶面")
    if best and best.get("circle"):
        xc, zc, R = best["circle"]
        th_full = np.linspace(0, 2 * math.pi, 180)
        ax.plot(xc + R * np.cos(th_full), zc + R * np.sin(th_full),
                color=PALETTE["gray"], lw=0.9, ls=":", alpha=0.8)
        th = np.linspace(math.pi, 2 * math.pi, 90)  # 圆的下弧=滑面
        ax.plot(xc + R * np.cos(th), zc + R * np.sin(th), color=PALETTE["red"], lw=2.0,
                label=f"临界滑面 Fs={best['Fs']:.3f}")
        ax.plot([xc], [zc], marker="+", color=PALETTE["red"], ms=8, mew=1.6)
        ax.annotate(f"圆心 O", (xc, zc), xytext=(5, 4), textcoords="offset points",
                    fontsize=7.5, color=PALETTE["red"])
    ax.set_xlabel("桩号 (m)"); ax.set_ylabel("标高 (m)")
    ax.set_ylim(zlo, zhi)
    ax.legend(fontsize=8, loc="upper right")
    finish(fig, model.site_name, ("开挖" if exc else "") + "临界圆弧（虚线=整圆参考）")
    save(fig, path)


def fig_section_scan(model, path, params=None, exc=False):
    """断面扫描（双栏，对齐原版设计）：

    左：断面扫描布置 —— 坡脚线 + N 条断面线（灰），最危险断面红色高亮；
    右：各断面临界安全系数 —— Fs-桩号曲线 + 阈值 1.30/极限平衡 1.0 双参考线，
        最危险断面标注框，Fs>5 的边缘断面过滤并在底部注记（无工程意义）。
    标题带土力参数与 Fs_min（原版口径）。
    """
    from . import physics
    if exc:
        r = physics.analyze_excavation(model, params or {})
    else:
        r = physics.analyze_stability(model, params or {})
    d = r["data"]
    secs = d.get("sections") or []
    best = d.get("best")
    p = dict(params or {})
    thr = float(p.get("threshold", p.get("fs_threshold", 1.3)) or 1.3)
    c_v = float(p.get("c", 8) or 8)
    phi_v = float(p.get("phi_deg", 25) or 25)
    gamma_v = float(p.get("gamma", 10) or 10)
    ru_v = float(p.get("ru", 0.0) or 0.0)
    direction = str(p.get("direction", p.get("scan_direction", "X")) or "X").upper()
    fsmin = d["key_numbers"].get("Fs_min")
    axis_m = "Y" if direction == "X" else "X"

    fig, (axl, axr) = plt.subplots(1, 2, figsize=(12.4, 4.9),
                                    gridspec_kw={"width_ratios": [1, 1.25]})
    # ---- 左：断面扫描布置 ----
    for fp in model.footprints:
        pts = np.asarray(fp.fine + [fp.fine[0]])
        axl.plot(pts[:, 0], pts[:, 1], color=PALETTE["gray"], lw=1.0, alpha=0.85)
    for sec in secs:
        if sec.get("A") and sec.get("B"):
            axl.plot([sec["A"][0], sec["B"][0]], [sec["A"][1], sec["B"][1]],
                     color="#b9c4cf", lw=0.9, zorder=1)
    if best and best.get("A") and best.get("B"):
        axl.plot([best["A"][0], best["B"][0]], [best["A"][1], best["B"][1]],
                 color=PALETTE["red"], lw=2.2, zorder=3)
    # 图例（代理线）
    from matplotlib.lines import Line2D
    handles = [
        Line2D([], [], color=PALETTE["gray"], lw=1.2, label="坡脚线"),
        Line2D([], [], color="#b9c4cf", lw=1.2, label=f"断面线 ×{len(secs)}"),
    ]
    if best:
        handles.append(Line2D([], [], color=PALETTE["red"], lw=2.2,
                              label=f"最危险断面 #{best['index']}（第 {best['index'] + 1}/{len(secs)} 条）"))
    axl.legend(handles=handles, fontsize=8, loc="upper right")
    axl.set_xlabel("X (m)"); axl.set_ylabel("Y (m)")
    axl.set_aspect("equal")
    axl.set_title(f"断面扫描布置（剖面 ∥ {direction}，N={len(secs)}）", fontsize=10)
    # ---- 右：各断面临界安全系数 ----
    st = [s.get("station_m", i) for i, s in enumerate(secs)]
    fss = [s.get("Fs") for s in secs]
    plot_pts, thin_pts, n_gt5 = [], [], 0
    for xi, f in zip(st, fss):
        if f is None:
            thin_pts.append(xi)
        elif f > 5.0:
            n_gt5 += 1          # 边缘断面，无工程意义（原版口径：过滤 + 注记）
        else:
            plot_pts.append((xi, f))
    if plot_pts:
        axr.plot([a for a, _ in plot_pts], [b for _, b in plot_pts],
                 color=PALETTE["primary"], lw=1.4, alpha=0.85)
        axr.plot([a for a, _ in plot_pts], [b for _, b in plot_pts],
                 "o", ms=5, color=PALETTE["primary"])
    for xi in thin_pts:
        axr.plot([xi], [0.06], marker="x", ms=7, color=PALETTE["gray"])
    axr.axhline(thr, color=PALETTE["red"], ls="--", lw=1.2)
    axr.axhline(1.0, color=PALETTE["gray"], ls=":", lw=1.1)
    axr.annotate(f"阈值 Fs={thr:.2f}", (st[-1] if st else 1, thr), fontsize=8,
                 color=PALETTE["red"], va="bottom", ha="right")
    axr.annotate("极限平衡 Fs=1.0", (st[-1] if st else 1, 1.0), fontsize=8,
                 color=PALETTE["gray"], va="bottom", ha="right")
    if best and best.get("Fs") is not None and best["Fs"] <= 5.0:
        axr.annotate(f"最危险断面 #{best['index']}（第 {best['index'] + 1}/{len(secs)} 条）\n"
                     f"桩号 {best['station_m']:.0f} m，Fs={best['Fs']:.3f}",
                     (best["station_m"], best["Fs"]), xytext=(10, -34),
                     textcoords="offset points", fontsize=8, color=PALETTE["red"],
                     bbox=dict(boxstyle="round,pad=0.3", fc="white", ec=PALETTE["red"], alpha=0.9),
                     arrowprops=dict(arrowstyle="->", color=PALETTE["red"], lw=1.0))
    if thin_pts:
        axr.annotate(f"× = 堆体过薄（{len(thin_pts)} 断面）", (0.02, 0.04),
                     xycoords="axes fraction", fontsize=7.5, color=PALETTE["gray"])
    if n_gt5:
        axr.annotate(f"{n_gt5} 个断面 Fs>5（堆体边缘为主，无工程意义）", (0.5, 0.04),
                     xycoords="axes fraction", fontsize=7.5, color=PALETTE["gray"],
                     ha="center")
    ok_vals = [b for _, b in plot_pts] or [2.0]
    axr.set_ylim(0, max(max(ok_vals) * 1.35, thr * 2.0))
    if st:
        axr.set_xlim(min(st), max(st))
    axr.set_xlabel(f"桩号 ({axis_m} m)"); axr.set_ylabel("Fs (Bishop)")
    axr.set_title("各断面临界安全系数", fontsize=10)
    finish(fig, model.site_name,
           f"危险断面扫描 · c={c_v:g} kPa, φ={phi_v:g}°, γ={gamma_v:g} kN/m³, "
           f"ru={ru_v:.2f} · Fs_min = {fsmin:.3f}" if fsmin else "危险断面扫描")
    save(fig, path)


def fig_monte_carlo(model, path, params=None):
    from . import physics
    r = physics.analyze_stability(model, params or {})
    mc = r["data"].get("monte_carlo") or {}
    if not mc:
        mc = physics.monte_carlo(r["data"]["key_numbers"].get("Fs_min"), {"N": 1000})
    fig, ax = plt.subplots(figsize=(7.6, 4.4))
    rng = np.random.default_rng(7)
    fs_mean = mc.get("Fs_mean", 1.2)
    samples = rng.normal(fs_mean, max(abs(fs_mean) * 0.12, 0.02), mc.get("N", 1000))
    ax.hist(samples, bins=40, color=PALETTE["primary"], alpha=0.82, edgecolor="none")
    ax.axvline(1.0, color=PALETTE["red"], label="Fs=1")
    ax.axvline(fs_mean, color="k", ls="--", label=f"均值 {fs_mean:.2f}")
    ax.set_xlabel("Fs 抽样"); ax.set_ylabel("频数")
    ax.legend(fontsize=8)
    finish(fig, model.site_name,
           f"Monte Carlo：Pf={mc.get('Pf', 0) * 100:.2f}%  β={mc.get('beta', 0)}")
    save(fig, path)


def fig_exc_levels(model, path, params=None):
    """逐级坡：开挖后中剖面 + 分级台阶，逐级标注（坡高 h, 坡比 1:n, 马道 b）。"""
    p = dict(params or {})
    zones = (model.excavation_spec or [])
    fig, ax = plt.subplots(figsize=(8.6, 4.8))
    base = model.base_surface()
    top = model.top_surface()
    iy = model.ny // 2
    xs = model.gx
    ax.fill_between(xs, base[iy], top[iy], color=PALETTE["brown"], alpha=0.55, label="开挖后剖面")
    ax.plot(xs, base[iy], "k-", lw=1.0)
    ax.plot(xs, top[iy], color=PALETTE["primary"], lw=1.1)
    levels = None
    if zones:
        lv = zones[0].get("levels")
        if lv:
            levels = lv
    if levels:
        zc = float(np.nanmean(top[iy]))
        run = 0.0
        cum = 0.0
        for k, (hh, nn, bb) in enumerate(levels):
            try:
                hh, nn, bb = float(hh), float(nn), float(bb)
            except Exception:
                continue
            x0p, x1p = run, run + nn * hh
            ax.plot([x0p, x1p], [cum, cum + hh], color=PALETTE["red"], lw=2.2)
            ax.annotate(f"h={hh:g}m\n1:{nn:g}", ((x0p + x1p) / 2, (cum + cum + hh) / 2),
                        fontsize=7, color=PALETTE["red"], ha="left", va="center",
                        bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="#e5b", alpha=0.8))
            run = x1p
            cum += hh
            if bb > 0:
                ax.plot([run, run + bb], [cum, cum], color=PALETTE["red"], lw=2.2)
                ax.annotate(f"马道 {bb:g}m", (run + bb / 2, cum), xytext=(0, 6),
                            textcoords="offset points", fontsize=7, color=PALETTE["dark"],
                            ha="center")
                run += bb
    ax.set_title("")  # finish 统一加
    ax.set_xlabel("向内水平距 (m)"); ax.set_ylabel("标高 (m)")
    ax.legend(fontsize=8, loc="lower right")
    finish(fig, model.site_name, "开挖逐级坡（坡高 h · 坡比 1:n · 马道宽）")
    save(fig, path)


def fig_exc_phases(model, path, params=None, stages=None):
    fig, ax = plt.subplots(figsize=(8.4, 4.2))
    if stages:
        ks = [s["stage"] for s in stages]
        fss = [s.get("Fs") for s in stages]
        thr = float((params or {}).get("fs_threshold", 1.3) or 1.3)
        vals, clipped, ymax = _prep_fs_series(fss, thr)
        for k, v, raw in zip(ks, vals, fss):
            if math.isnan(v):
                continue
            ax.plot([k], [v], marker="o", ms=6,
                    color=PALETTE["red"] if v < thr else PALETTE["primary"])
            if raw is not None and raw > v + 1e-6:
                ax.annotate(f"↑{raw:.0f}", (k, v), fontsize=7, color=PALETTE["gray"],
                            ha="center", va="bottom")
        ax.plot(ks, [v if not math.isnan(v) else np.nan for v in vals], "-",
                color=PALETTE["primary"], lw=1.1, alpha=0.6)
        for s in stages:
            if s.get("worst") and s.get("Fs") is not None:
                ax.annotate("最危险", (s["stage"], s["Fs"]), xytext=(4, 8),
                            textcoords="offset points", color=PALETTE["red"], fontsize=9)
        ax.axhline(thr, color=PALETTE["red"], ls="--", lw=1.1)
        ax.annotate(f"阈值 {thr:g}", (ks[-1], thr), fontsize=8, color=PALETTE["red"],
                    va="bottom", ha="right")
        ax.set_ylim(0, ymax)
    ax.set_xlabel("开挖阶段"); ax.set_ylabel("Fs")
    finish(fig, model.site_name, "分区开挖逐阶段 Fs")
    save(fig, path)


def fig_exc_stage(model, path, params=None, stage_top=None, tag=""):
    fig_section(model, path, dict(params or {}, sec_segments=False), stage_tag=f"（阶段{tag}）")


# ==========================================================================
# 污染类
# ==========================================================================

def _pollution_series(model, params):
    from . import physics
    return physics.analyze_pollution(model, params or {})


def fig_gas_curve(model, path, params=None):
    """产气时程（双栏）：上=主产气 CH4 产生/排放 + CO2；下=臭气 H2S / NH3。"""
    r = _pollution_series(model, params)
    ser = r["data"]["series"]
    kn = r["data"]["key_numbers"]
    yrs = ser["years"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8.8, 6.4), sharex=True,
                                    gridspec_kw={"height_ratios": [3, 2]})
    ax1.plot(yrs, ser["ch4_gen_wan"], color=PALETTE["red"], lw=1.8, label="CH4 产生")
    ax1.plot(yrs, ser["ch4_emis_wan"], color=PALETTE["red"], ls="--", lw=1.2,
             label="CH4 排放（收集+氧化后）")
    ax1.plot(yrs, ser["co2_gen_wan"], color=PALETTE["primary"], lw=1.5,
             label="CO2（含好氧早期段）")
    ax1.fill_between(yrs, ser["ch4_emis_wan"], ser["ch4_gen_wan"],
                     color=PALETTE["red"], alpha=0.10, label="收集/氧化销毁量")
    ax1.set_ylabel("产气量（万m³/a）")
    py = kn.get("gas_peak_year")
    if py and py in yrs:
        ax1.axvline(py, color="gray", ls=":", lw=1)
        ax1.annotate(f"峰值 {kn.get('gas_peak_ch4_wan_m3y', 0):.0f} 万m³/a（{py} 年）",
                     (0.03, 0.92), xycoords="axes fraction", fontsize=8.5,
                     color="#333", va="top",
                     bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#ccc", alpha=0.9))
    ax1.legend(fontsize=8, loc="upper right")
    ax2.plot(yrs, ser["h2s_m3y"], color=PALETTE["green"], lw=1.6, label="H2S（臭气，峰提前）")
    ax2.plot(yrs, ser["nh3_m3y"], color=PALETTE["purple"], lw=1.6, label="NH3（臭气）")
    ax2.set_xlabel("年份"); ax2.set_ylabel("臭气产量（m³/a）")
    ax2.legend(fontsize=8, loc="upper right")
    finish(fig, model.site_name, "产气时程（LandGEM 式分气体动力学）")
    save(fig, path)


def fig_gas_field(model, path, params=None):
    """产气强度场：CH4 源强按堆厚分配（厚=垃圾多=产气多），动态范围真实。"""
    r = _pollution_series(model, params)
    to = r["data"]["time_options"]
    y = to.get("gas_year_used", 2015)
    ser = r["data"]["series"]
    idx = min(len(ser["years"]) - 1,
              max(0, ser["years"].index(y) if y in ser["years"] else len(ser["years"]) // 2))
    base = model.base_surface()
    h = np.maximum(model.top_surface() - base, 0.0)
    q = ser["ch4_gen_wan"][idx] * 1e4 if ser["ch4_gen_wan"] else 0.0
    hsum = float(np.nansum(h))
    flux = np.where(h > 0.05, q * h / max(hsum, 1e-9) / model._cell_area(), np.nan)
    x0, x1 = float(np.nanmin(model.X)), float(np.nanmax(model.X))
    y0, y1 = float(np.nanmin(model.Y)), float(np.nanmax(model.Y))
    fig, ax = plt.subplots(figsize=adaptive_figsize(x1 - x0, y1 - y0))
    cf = ax.pcolormesh(model.X, model.Y, flux, cmap="plasma", shading="gouraud",
                       vmin=0)
    cb = fig.colorbar(cf, ax=ax, label=f"CH4 单位面积源强（m³/(m²·a)）· {y} 年", shrink=0.9)
    cb.ax.tick_params(labelsize=8)
    for fp in model.footprints:
        pts = np.asarray(fp.fine + [fp.fine[0]])
        ax.plot(pts[:, 0], pts[:, 1], color="w", lw=0.9, alpha=0.7)
    comp = r["data"].get("gas_composition_peak") or {}
    ax.set_xlabel("X (m)"); ax.set_ylabel("Y (m)")
    ax.set_aspect("equal")
    finish(fig, model.site_name,
           f"产气强度场（峰值构成 CH4 {comp.get('ch4_pct', '—')}% / CO2 {comp.get('co2_pct', '—')}%）")
    save(fig, path)


def fig_leachate(model, path, params=None):
    """渗滤液水量（两行）：上=P/PET 柱+入渗线；下=渗滤液+累计（各自合适刻度）。"""
    r = _pollution_series(model, params)
    ser = r["data"]["series"]
    yrs = ser["years"]
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8.8, 6.2), sharex=True,
                                    gridspec_kw={"height_ratios": [2, 2.4]})
    ax1.bar(yrs, ser["p_mm"], width=0.62, color=PALETTE["primary"], alpha=0.85,
            label="降雨 P (mm/a)")
    ax1.bar(yrs, ser["pet_mm"], width=0.62, color=PALETTE["orange"], alpha=0.85,
            label="蒸散发 PET (mm/a)")
    if "percolation_mm_a" in r["data"]["key_numbers"]:
        pc = r["data"]["key_numbers"]["percolation_mm_a"]
        ax1.axhline(pc, color=PALETTE["teal"], ls="--", lw=1.2)
        ax1.annotate(f"入渗 {pc:.0f} mm/a", (yrs[-1], pc), ha="right", va="bottom",
                     fontsize=8, color=PALETTE["teal"])
    ax1.set_ylabel("水量 (mm/a)")
    ax1.legend(fontsize=8, loc="upper right", ncol=2)
    ax2.plot(yrs, ser["leachate_m3y"], color=PALETTE["green"], marker="o", ms=2.8,
             lw=1.8, label="渗滤液产量 (m³/a)")
    cum = np.cumsum(ser["leachate_m3y"]) / 1e4
    ax2.fill_between(yrs, 0, cum, color=PALETTE["gray"], alpha=0.15)
    ax2.plot(yrs, cum, color=PALETTE["dark"], ls=":", lw=1.2, label="累计 (万m³)")
    ax2.set_xlabel("年份"); ax2.set_ylabel("渗滤液 (m³/a · 累计万m³)")
    ax2.legend(fontsize=8, loc="upper left")
    ax2.set_xlim(yrs[0] - 1, yrs[-1] + 1)
    finish(fig, model.site_name, "渗滤液水量平衡（逐填埋年 cohort 月水量平衡）")
    save(fig, path)


def fig_quality(model, path, params=None):
    """渗滤液水质（产酸→产甲烷→稳定相）+ GB 16889-2008 表2 限值线（标签右端错位）。"""
    r = _pollution_series(model, params)
    ser = r["data"]["series"]
    yrs = ser["quality_years"]
    fig, ax = plt.subplots(figsize=(8.8, 5))
    ax.semilogy(yrs, ser["cod"], color=PALETTE["red"], lw=1.8, label="COD")
    ax.semilogy(yrs, ser["bod5"], color=PALETTE["orange"], lw=1.5, label="BOD5")
    ax.semilogy(yrs, ser["nh3n"], color=PALETTE["green"], lw=1.5, label="NH3-N")
    ax.semilogy(yrs, ser["cl"], color=PALETTE["primary"], ls="--", lw=1.2, label="Cl")
    limits = [("COD 100", 100, PALETTE["red"], 1.10),
              ("BOD5 30", 30, PALETTE["orange"], 1.16),
              ("NH3-N 25", 25, PALETTE["green"], 0.82)]
    for txt, v, c, fac in limits:
        ax.axhline(v, color=c, ls=":", lw=1.1, alpha=0.9)
        ax.annotate(f"GB16889 表2 {txt}", (yrs[-1], v * fac), fontsize=7.5, color=c,
                    ha="right", va="bottom",
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.75))
    ax.set_xlabel("封场后年数（龄期）"); ax.set_ylabel("mg/L")
    ax2 = ax.twinx()
    ax2.plot(yrs, ser["ph"], color=PALETTE["dark"], lw=1.2, alpha=0.7, label="pH（右轴）")
    ax2.set_ylabel("pH", color=PALETTE["dark"]); ax2.set_ylim(5, 9)
    ax2.spines["right"].set_visible(True)
    h1, l1 = ax.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, fontsize=8, loc="lower left")
    ax.set_ylim(10, None)
    finish(fig, model.site_name, "渗滤液水质（产酸→产甲烷→稳定相）")
    save(fig, path)


def fig_column(model, path, params=None):
    """一维柱穿透（Ogata-Banks 恒源解析解，含阻滞与一阶衰减）。"""
    from scipy.special import erfc
    p = dict(params or {})
    pp_src = _plume_params_src(p)
    vr_d = pp_src["v"] / max(pp_src["R"], 0.05)
    v_a = vr_d * 365.0                     # m/a
    D_a = (pp_src["aL"] * vr_d + pp_src["Dm"]) * 365.0   # m²/a
    L = float(p.get("aq_column_m", 0) or 0) or float(p.get("aq_downstream_m", 1000) or 1000) * 0.25
    lam_a = math.log(2.0) / (float(p.get("half_life_d") or 0) / 365.0) \
        if p.get("half_life_d") not in (None, "") and float(p.get("half_life_d") or 0) > 0 else 0.0
    ts = np.linspace(0.05, 200, 400)
    cc = []
    for t in ts:
        a1 = (L - v_a * t / pp_src["R"]) / (2.0 * math.sqrt(max(D_a * t, 1e-9)))
        c = 0.5 * erfc(max(-8, min(a1, 8)))
        e = v_a * L / max(D_a, 1e-9)
        if e < 60:
            a2 = (L + v_a * t / pp_src["R"]) / (2.0 * math.sqrt(max(D_a * t, 1e-9)))
            c += math.exp(e) * 0.5 * erfc(max(-8, min(a2, 8)))
        if lam_a > 0:
            c *= math.exp(-lam_a * L / max(v_a / pp_src["R"], 1e-9))
        cc.append(max(min(c, 1.5), 0.0))
    cc = np.array(cc)
    # 自适应 x 轴：曲线到达平台后不久截断，右半幅不再空白
    idx95 = int(np.argmax(cc >= 0.95)) if (cc >= 0.95).any() else len(ts) - 1
    xmax = float(min(ts[-1], max(ts[idx95] * 1.8, ts[idx95] + 8, 10)))
    mask = ts <= xmax
    fig, ax = plt.subplots(figsize=(7.8, 4.4))
    ax.plot(ts[mask], cc[mask], color=PALETTE["primary"], lw=1.8,
            label=f"L={L:.0f} m（αL={pp_src['aL']:g} m）")
    ax.axhline(0.05, color="gray", ls=":", lw=1)
    ax.axhline(0.95, color="gray", ls=":", lw=1)
    idx5 = int(np.argmax(cc >= 0.05)) if (cc >= 0.05).any() else -1
    if idx5 > 0:
        ax.axvline(ts[idx5], color=PALETTE["orange"], ls="--", lw=1)
        ax.annotate(f"初见穿透 {ts[idx5]:.0f} a", (ts[idx5], 0.32), fontsize=8,
                    color=PALETTE["orange"], rotation=90, va="center", ha="right",
                    xytext=(-3, 0), textcoords="offset points")
    if idx95 > 0 and ts[idx95] <= xmax:
        ax.axvline(ts[idx95], color=PALETTE["red"], ls="--", lw=1)
        ax.annotate(f"95% 置换 {ts[idx95]:.0f} a", (ts[idx95], 0.55), fontsize=8,
                    color=PALETTE["red"], rotation=90, va="center", ha="right",
                    xytext=(-3, 0), textcoords="offset points")
    ax.set_xlabel("时间 (a)"); ax.set_ylabel("C/C0")
    ax.set_ylim(0, 1.12); ax.set_xlim(0, xmax)
    ax.legend(fontsize=8, loc="lower right")
    finish(fig, model.site_name, "一维柱穿透（Ogata-Banks）")
    save(fig, path)


def _plume_params_src(p):
    from . import physics
    return physics._plume_params(dict(p or {}))


def fig_plume(model, path, params=None, section=False):
    """二维羽流（Domenico/BIOScreen 型筛选解）。

    平面图：C(x, y) 浓度场 + 超限白线 + 源区框；
    剖面图：C(x, t) 沿流向中心线时空图（浓度-距离-时间穿透）。
    """
    from . import physics
    p = dict(params or {})
    pp = physics._plume_params(p)
    day = p.get("plume_day")
    if day in (None, ""):
        days = p.get("plume_snapshot_days") or [3650]
        day = days[len(days) // 2] if isinstance(days, list) and days else 3650
    day = float(day)
    if not section:
        X, Y, C, pp = physics.plume_grid(p, day, nx=160, ny=80)
        x0, x1 = float(np.nanmin(X)), float(np.nanmax(X))
        y0, y1 = float(np.nanmin(Y)), float(np.nanmax(Y))
        fig, ax = plt.subplots(figsize=adaptive_figsize(x1 - x0, y1 - y0, base_w=8.8))
        cf = ax.pcolormesh(X, Y, C, cmap="jet", shading="auto",
                           vmin=0, vmax=max(pp["c0"], 1))
        cb = fig.colorbar(cf, ax=ax, label="C (mg/L)", shrink=0.9)
        cb.ax.tick_params(labelsize=8)
        try:
            ax.contour(X, Y, C, levels=[pp["threshold"]], colors="w", linewidths=1.4)
        except Exception:
            pass
        xs0, W = pp["x_src"], pp["W"]
        ax.add_patch(plt.Rectangle((xs0, -W / 2), max(pp["down"] * 0.01, 5), W,
                                    fill=False, edgecolor="lime", lw=1.6))
        ax.annotate("源区", (xs0 + 12, W / 2 + pp["lat"] * 0.06), fontsize=8,
                    color="w", va="bottom",
                    bbox=dict(boxstyle="round,pad=0.2", fc=(0, 0, 0, 0.55), ec="lime"))
        ax.annotate("地下水流向 →", (pp["down"] * 0.62, pp["lat"] * 0.9),
                    fontsize=9, color="w",
                    bbox=dict(boxstyle="round", fc=(0, 0, 0, 0.45), ec="none"))
        ax.set_xlabel("下游距离 (m)"); ax.set_ylabel("横向 (m)")
        ax.set_aspect("auto")
        finish(fig, model.site_name,
               f"羽流平面（第 {day:.0f} 天，白线=超限 {pp['threshold']:.0f} mg/L）")
    else:
        xs, ts, C, pp = physics.plume_centerline_time(
            p, t_max_day=min(float(p.get("plume_years", 30) or 30) * 365, 100 * 365))
        fig, ax = plt.subplots(figsize=(8.8, 4.8))
        cf = ax.pcolormesh(xs, ts / 365.0, C, cmap="jet", shading="auto",
                           vmin=0, vmax=max(pp["c0"], 1))
        cb = fig.colorbar(cf, ax=ax, label="C (mg/L)", shrink=0.9)
        cb.ax.tick_params(labelsize=8)
        try:
            ax.contour(xs, ts / 365.0, C, levels=[pp["threshold"]], colors="w", linewidths=1.4)
        except Exception:
            pass
        days_snap = p.get("plume_snapshot_days") or []
        for d in (days_snap if isinstance(days_snap, list) else [])[:4]:
            ax.axhline(d / 365.0, color="w", ls=":", lw=0.8, alpha=0.7)
        ax.set_xlabel("下游距离 (m)"); ax.set_ylabel("时间 (a)")
        finish(fig, model.site_name,
               f"羽流剖面（中心线 C-x-t，白线=超限 {pp['threshold']:.0f} mg/L）")
    save(fig, path)


# ==========================================================================
# 调度
# ==========================================================================

def render_figures(model, keys, workdir, params=None, dpi=150, fig_export=None):
    """渲一组图，返回 [{key,label,file,size}]。未知键跳过并返回注记。"""
    import os
    apply_style()
    out = []
    notes = []
    dispatch = {
        "model3d": lambda path, pp: fig_model3d(model, path, pp),
        "contour": lambda path, pp: fig_contour(model, path, pp),
        "slope_map": lambda path, pp: fig_slope_map(model, path, pp),
        "section": lambda path, pp: fig_section(model, path, pp),
        "storage_curve": lambda path, pp: fig_storage_curve(model, path, pp),
        "settlement_profile": lambda path, pp: fig_settlement_profile(model, path, pp),
        "settlement_plane": lambda path, pp: fig_settlement_plane(model, path, pp),
        "fs_grid": lambda path, pp: fig_fs_grid(model, path, pp, exc=False),
        "critical_arc": lambda path, pp: fig_critical_arc(model, path, pp, exc=False),
        "section_scan": lambda path, pp: fig_section_scan(model, path, pp),
        "monte_carlo": lambda path, pp: fig_monte_carlo(model, path, pp),
        "exc_arc": lambda path, pp: fig_critical_arc(model, path, pp, exc=True),
        "exc_levels": lambda path, pp: fig_exc_levels(model, path, pp),
        "exc_fs_grid": lambda path, pp: fig_fs_grid(model, path, pp, exc=True),
        "exc_phases": lambda path, pp: fig_exc_phases(model, path, pp,
                                                       stages=(pp or {}).get("_stages")),
        "exc_stage": lambda path, pp: fig_section(model, path, dict(pp or {}, sec_segments=False)),
        "gas_curve": lambda path, pp: fig_gas_curve(model, path, pp),
        "gas_field": lambda path, pp: fig_gas_field(model, path, pp),
        "leachate": lambda path, pp: fig_leachate(model, path, pp),
        "quality": lambda path, pp: fig_quality(model, path, pp),
        "column": lambda path, pp: fig_column(model, path, pp),
        "plume_plan": lambda path, pp: fig_plume(model, path, pp, section=False),
        "plume_section": lambda path, pp: fig_plume(model, path, pp, section=True),
    }
    for key in keys or []:
        fn = dispatch.get(str(key))
        if fn is None:
            notes.append(f"未知图键 {key}，已跳过")
            continue
        fname = f"{key}.png"
        path = os.path.join(workdir, fname)
        try:
            fn(path, params or {})
            out.append({"key": str(key), "label": FIG_LABELS.get(str(key), str(key)),
                        "file": fname, "size": os.path.getsize(path)})
        except Exception as e:  # 单图失败不毁整个 action
            notes.append(f"图 {key} 生成失败：{type(e).__name__}: {e}")
    return out, notes
