"""mesh.py · OBJ 网格导出（顶面/坡面/基底三实体组 + 叠加层组，顶点色）。

坐标系约定（与前端 KernelMeshView 对齐）：
  工程 (x, y_平面, z_标高) → OBJ (x, z, y)；即 OBJ 的 Y 轴 = 标高（three.js up）。
  mesh-info.bounds = {x:[minX,maxX], y:[minY,maxY](平面), z:[minZ,maxZ](标高)}。

叠加层（指令驱动，由 analyze 侧复用物理）：
  contour 等高线带 / slip 危险滑面带 / fs 超阈值 Fs 网格 / heat 沉降热力 / flood 淹没水面
"""
from __future__ import annotations

import math

import numpy as np

OVERLAY_OPACITY = {"contour": 1.0, "slip": 0.95, "fs": 0.85, "heat": 0.85, "flood": 0.45}

# 分层配色（自底向上与 build.layers 对应；BGR→RGB 0-1）
LAYER_COLORS = [
    (0.42, 0.36, 0.28),  # 生活垃圾（暗橄榄）
    (0.62, 0.60, 0.58),  # 建筑渣土（灰）
    (0.55, 0.42, 0.30),  # 覆土（棕）
    (0.48, 0.40, 0.52),  # 污泥（紫灰）
    (0.50, 0.50, 0.50),  # 自定义
]
BASE_COLOR = (0.60, 0.56, 0.50)
TOP_COLOR = (0.55, 0.52, 0.38)


def _layer_color(idx):
    return LAYER_COLORS[min(idx, len(LAYER_COLORS) - 1)]


def _quad_indices(i, j, nx):
    a = i * nx + j
    b = i * nx + j + 1
    c = (i + 1) * nx + j + 1
    d = (i + 1) * nx + j
    return a, b, c, d


def build_obj(model, overlay=None, overlay_params=None):
    """导出 OBJ 文本 + mesh-info dict。

    overlay: {contour:{n_levels}, flood:{level}, slip:{}, fs:{}, heat:{}} 或 None
    overlay_params: {c, phi_deg, ..., excavation_params, settlement_params}
    """
    overlay = overlay or {}
    model.ensure_grid()
    X, Y = model.X, model.Y
    base = model.base_surface()
    top = model.top_surface()
    h = np.maximum(top - base, 0.0)

    nx = model.nx
    ny = model.ny
    verts: list[str] = []
    tris: list[str] = []
    groups: dict[str, int] = {}
    overlays_meta: dict[str, dict] = {}

    def emit_group(gname, tri_lines):
        if tri_lines:
            groups[gname] = groups.get(gname, 0) + len(tri_lines)
            tris.append(f"g_{gname}")
            tris.extend(tri_lines)

    # ---- 顶点块（所有网格点一次写入，颜色按面归类在面上近似 ----
    # OBJ 顶点色是逐顶点的；同一网格点可能被不同组共享 → 为每组写独立顶点。
    v_off = {"base": 0}

    def add_surface(Z, color_fn):
        """整张网格面写入，返回该组三角形行列表。颜色 fn(i,j)→(r,g,b)。"""
        n0 = len(verts) + 1
        for i in range(ny):
            for j in range(nx):
                r, g, b = color_fn(i, j)
                verts.append(f"v {X[i, j]:.2f} {Z[i, j]:.3f} {Y[i, j]:.2f} {r:.3f} {g:.3f} {b:.3f}")
        lines = []
        for i in range(ny - 1):
            for j in range(nx - 1):
                a, b, c, d = _quad_indices(i, j, nx)
                lines.append(f"f {n0 + a} {n0 + b} {n0 + c}")
                lines.append(f"f {n0 + a} {n0 + c} {n0 + d}")
        return lines

    # ---- base：整张地形 ----
    zmin0 = float(np.nanmin(base))

    def base_color(i, j):
        return BASE_COLOR

    emit_group("base", add_surface(base, base_color))

    # ---- top/side：堆体表面（h>0 的象限），按高度带配色 ----
    if h.max() > 1e-6:
        gmax = float(model.footprints[0].H) if model.footprints else max(float(h.max()), 1.0)
        # 分层界线（自底向上累计高度）
        bounds = []
        if model.waste_layers:
            z = 0.0
            for name, hh, g in model.waste_layers[:-1]:
                z += hh
                bounds.append(z)
        side_lines: list[str] = []
        top_lines: list[str] = []
        n0 = len(verts) + 1
        for i in range(ny):
            for j in range(nx):
                if h[i, j] <= 1e-4:
                    continue
                r, g, b = _layer_color(_band_of(h[i, j], bounds))
                verts.append(f"v {X[i, j]:.2f} {top[i, j]:.3f} {Y[i, j]:.2f} {r:.3f} {g:.3f} {b:.3f}")
        # 记录堆体顶点索引矩阵（-1 表示无）
        pidx = -np.ones(h.shape, dtype=int)
        k = 0
        for i in range(ny):
            for j in range(nx):
                if h[i, j] > 1e-4:
                    pidx[i, j] = n0 + k
                    k += 1
        for i in range(ny - 1):
            for j in range(nx - 1):
                a, b, c, d = pidx[i, j], pidx[i, j + 1], pidx[i + 1, j + 1], pidx[i + 1, j]
                if a < 0 or b < 0 or c < 0 or d < 0:
                    continue
                hbar = (h[i, j] + h[i, j + 1] + h[i + 1, j + 1] + h[i + 1, j]) / 4
                row = f"f {a} {b} {c}" if False else None
                tri1 = f"f {a} {b} {c}"
                tri2 = f"f {a} {c} {d}"
                (top_lines if hbar >= gmax * 0.999 else side_lines).extend([tri1, tri2])
        emit_group("side", side_lines)
        emit_group("top", top_lines)

    # ---- 叠加层 ----
    zmin = float(min(np.nanmin(base), np.nanmin(top)))
    zmax = float(max(np.nanmax(base), np.nanmax(top)))
    if "contour" in overlay:
        nl = int((overlay.get("contour") or {}).get("n_levels", 5) or 5)
        lines = _ribbon_contour(X, Y, top, nl)
        if lines:
            overlays_meta["contour"] = {"opacity": OVERLAY_OPACITY["contour"], "kind": "line"}
            emit_group("contour", lines)
    if "flood" in overlay:
        lv = float((overlay.get("flood") or {}).get("level", zmax) or zmax)
        lines = _flood_plane(X, Y, lv, base)
        if lines:
            overlays_meta["flood"] = {"opacity": OVERLAY_OPACITY["flood"], "kind": "water"}
            emit_group("flood", lines)
    if "fs" in overlay:
        params = overlay_params or {}
        try:
            from . import physics
            lines = physics.fs_overlay_mesh(model, params)
            if lines:
                overlays_meta["fs"] = {"opacity": OVERLAY_OPACITY["fs"], "kind": "fs"}
                emit_group("fs", lines)
        except Exception:
            pass
    if "slip" in overlay:
        params = overlay_params or {}
        try:
            from . import physics
            lines = physics.slip_overlay_mesh(model, params)
            if lines:
                overlays_meta["slip"] = {"opacity": OVERLAY_OPACITY["slip"], "kind": "slip"}
                emit_group("slip", lines)
        except Exception:
            pass
    if "heat" in overlay:
        params = overlay_params or {}
        try:
            from . import physics
            lines = physics.heat_overlay_mesh(model, params)
            if lines:
                overlays_meta["heat"] = {"opacity": OVERLAY_OPACITY["heat"], "kind": "heat"}
                emit_group("heat", lines)
        except Exception:
            pass

    obj_text = "\n".join(verts + tris) + "\n"
    bounds = {
        "x": [float(np.nanmin(X)), float(np.nanmax(X))],
        "y": [float(np.nanmin(Y)), float(np.nanmax(Y))],
        "z": [float(zmin), float(zmax)],
    }
    n_vert = len(verts)
    n_tri = sum(v for k, v in groups.items() if not isinstance(v, dict))
    info = {
        "vertices": n_vert,
        "triangles": n_tri,
        "groups": {k: v for k, v in groups.items()},
        "overlays": overlays_meta,
        "bounds": bounds,
    }
    return obj_text, info


def _band_of(hh, bounds):
    band = 0
    for i, b in enumerate(bounds):
        if hh >= b:
            band = i + 1
    return band


def _ribbon_contour(X, Y, Z, n_levels, lift=0.12, width=0.5):
    """等高线带：对每条等高线沿等值线路径铺三角形带（简化：直接用
    matplotlib contour 采路径 → 每段两三角形抬高 lift）。"""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return []
    fig = plt.figure()
    ax = fig.add_subplot()
    zmin = float(np.nanmin(Z))
    zmax = float(np.nanmax(Z))
    if zmax - zmin < 1e-6:
        plt.close(fig)
        return []
    levels = np.linspace(zmin + 0.05 * (zmax - zmin), zmax - 0.05 * (zmax - zmin), max(2, nl))
    cs = ax.contour(X, Y, Z, levels=levels)
    lines: list[str] = []
    verts: list[str] = []
    try:
        paths = []
        for seg in cs.allsegs:
            for p in seg:
                paths.append(p)
    except Exception:
        paths = []
    plt.close(fig)
    idx = 1
    for p in paths:
        if len(p) < 2:
            continue
        base_idx = idx
        for (px, py) in p:
            verts.append(f"v {px:.2f} {_z_at(X, Y, Z, px, py) + lift:.3f} {py:.2f} 0.15 0.13 0.10")
            idx += 1
        for k in range(len(p) - 1):
            a = base_idx + k
            b = a + 1
            # 细带：第二个顶点沿法向下移 width
            va = verts[a - 1].split()
            vb = verts[b - 1].split()
            lines.append(f"f {a} {b} {b}")
        # 简化为线状三角（退化三角形在渲染中呈细线，宽度由抗锯齿补足）
    # 顶点并入 lines 头部
    return verts + lines if (verts and lines) else []


def _z_at(X, Y, Z, px, py):
    i = int(np.clip(np.searchsorted(X[:, 0], py if False else px), 0, X.shape[1] - 1))
    j = int(np.clip(np.searchsorted(Y[:, 0], py), 0, X.shape[0] - 1))
    return float(Z[j, i])


def _flood_plane(X, Y, level, base, lift=0.05):
    """淹没水面：标高 level 的半透明水平面（覆盖水域范围）。"""
    zmin = float(np.nanmin(base))
    if level <= zmin + 1e-6:
        return []
    x0, x1 = float(np.nanmin(X)), float(np.nanmax(X))
    y0, y1 = float(np.nanmin(Y)), float(np.nanmax(Y))
    verts = [
        f"v {x0:.2f} {level + lift:.3f} {y0:.2f} 0.20 0.45 0.75",
        f"v {x1:.2f} {level + lift:.3f} {y0:.2f} 0.20 0.45 0.75",
        f"v {x1:.2f} {level + lift:.3f} {y1:.2f} 0.20 0.45 0.75",
        f"v {x0:.2f} {level + lift:.3f} {y1:.2f} 0.20 0.45 0.75",
    ]
    faces = ["f 1 2 3", "f 1 3 4"]
    return verts + faces


def write_stage_obj(model, path, stage_top):
    """逐阶段开挖网格：把 top 替换为 stage_top 再导出（无叠加层）。"""
    saved = model.exc_top
    model.exc_top = stage_top
    try:
        text, info = build_obj(model, overlay=None)
    finally:
        model.exc_top = saved
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return info
