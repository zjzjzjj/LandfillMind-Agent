"""geometry.py · 场地几何内核。

从 spec 建立场地模型（LandfillModel）：
  - 底面（地形）base(x,y)：rect/poly/cells → 平面 z0；points → 测点插值；demo → 山谷
  - 堆体顶面 top(x,y)：坡脚线内 h(p)=min(H, min_e d_e(p)/n_e)，逐边坡比，
    弧边先加密（与前端 ToeShape 同口径：三点圆弧、弦差 tol）
  - 分层填埋 layers[[名称,厚m,γ]]（自底向上）→ γ(z) 剖面与配色带
  - 开挖 excavation：分区、分级坡 levels[[坡高,坡比,马道]]、临时坡 temp_n、
    cut_to_base（挖到基底），top_z=None = 沿分区坡顶线采样
高度场口径注释（与 src/components/ToeShape.ts 对拍）：
  h(p) = min(H, min over edges (d_e / n_e))，d_e = p 到该坡顶线段的距离。
"""
from __future__ import annotations

import json
import math
from typing import Any

import numpy as np


# --------------------------------------------------------------------------
# 坡脚线：弧加密（三点圆弧，弦差 tol）+ slopes 展开
# --------------------------------------------------------------------------

def circle_from3(p1, p2, p3):
    """三点定圆。共线返回 None。"""
    (x1, y1), (x2, y2), (x3, y3) = p1, p2, p3
    d = 2.0 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-12:
        return None
    ux = ((x1**2 + y1**2) * (y2 - y3) + (x2**2 + y2**2) * (y3 - y1)
          + (x3**2 + y3**2) * (y1 - y2)) / d
    uy = ((x1**2 + y1**2) * (x3 - x2) + (x2**2 + y2**2) * (x1 - x3)
          + (x3**2 + y3**2) * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    return ux, uy, r


def densify_arc(p1, pm, p2, sagitta=0.5):
    """弧 p1→p2（弧上一点 pm）按弦差加密为折线，含首尾，不含 p1 本身。"""
    c = circle_from3(p1, pm, p2)
    if c is None:
        return [p2]
    ux, uy, r = c
    a1 = math.atan2(p1[1] - uy, p1[0] - ux)
    am = math.atan2(pm[1] - uy, pm[0] - ux)
    a2 = math.atan2(p2[1] - uy, p2[0] - ux)

    def norm(a):
        while a < 0:
            a += 2 * math.pi
        while a >= 2 * math.pi:
            a -= 2 * math.pi
        return a

    d1, dm = norm(am - a1), norm(a2 - a1)
    if dm == 0:
        return [p2]
    if abs(dm - d1) > abs(dm - (d1 - 2 * math.pi)):
        pass  # dm 保持
    # 定方向：am 落在 a1→a2 的短弧或长弧上，按夹角关系选
    if d1 <= dm:
        sweep = dm
    else:
        sweep = dm - 2 * math.pi
    # 弦差控制段数：sagitta ≈ r(1-cos(θ/2))
    half = abs(sweep) / 2
    if r > 0:
        seg = max(2, int(math.ceil(abs(sweep) / (2 * math.acos(max(-1.0, min(1.0, max(0.0, 1 - sagitta / r))))))))
    else:
        seg = 2
    seg = min(seg, 160)
    pts = []
    for i in range(1, seg + 1):
        a = a1 + sweep * i / seg
        pts.append((ux + r * math.cos(a), uy + r * math.sin(a)))
    # 末点强制为 p2（数值误差）
    pts[-1] = (p2[0], p2[1])
    return pts


def densify_polygon(poly, arcs=None, sagitta=0.5):
    """粗折线 + 稀疏弧表 [[母边序号, mx, my],...] → 加密后折线。

    返回 (fine_pts, parent_edge_of)：parent_edge_of[i] = 细点 i 所在母边序号。
    """
    n = len(poly)
    arcs = arcs or []
    arc_by_edge = {}
    for e in arcs:
        try:
            i, mx, my = int(e[0]), float(e[1]), float(e[2])
        except Exception:
            continue
        if 0 <= i < n:
            arc_by_edge[i] = (mx, my)
    pts: list[tuple[float, float]] = []
    parent: list[int] = []
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        pts.append((float(a[0]), float(a[1])))
        parent.append(i)
        if i in arc_by_edge:
            mx, my = arc_by_edge[i]
            for q in densify_arc((float(a[0]), float(a[1])), (mx, my),
                                 (float(b[0]), float(b[1])), sagitta):
                pts.append(q)
                parent.append(i)
    return pts, parent


def expand_slopes(slopes, n_edges, parent=None, default=4.0):
    """逐边坡比：长度补齐到边数、空位回退统一值；弧加密后沿母边展开。"""
    if slopes is None:
        return [float(default)] * n_edges
    out = []
    for i in range(n_edges):
        v = None
        if i < len(slopes) and slopes[i] is not None:
            try:
                v = float(slopes[i])
            except Exception:
                v = None
        if v is None or not (v > 0) or not math.isfinite(v):
            v = float(default)
        out.append(v)
    if parent is not None:
        out = [out[parent[i]] for i in range(len(parent))]
    return out


# --------------------------------------------------------------------------
# 距离场与高度场
# --------------------------------------------------------------------------

def seg_dist(px, py, ax, ay, bx, by):
    """点到线段距离（向量化）。"""
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    if L2 < 1e-18:
        return np.hypot(px - ax, py - ay)
    t = ((px - ax) * vx + (py - ay) * vy) / L2
    t = np.clip(t, 0.0, 1.0)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def inside_polygon(px, py, poly):
    """射线法，poly 为 (M,2)。matplotlib.Path 不可用时兜底。"""
    x = np.asarray(px, dtype=float)
    y = np.asarray(py, dtype=float)
    n = len(poly)
    inside = np.zeros(x.shape, dtype=bool)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        cross = (yi > y) != (yj > y)
        xint = (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi
        inside ^= cross & (x < xint)
        j = i
    return inside


def point_in_poly(px, py, poly):
    try:
        from matplotlib.path import Path
        return Path(np.asarray(poly, dtype=float)).contains_points(
            np.stack([np.asarray(px).ravel(), np.asarray(py).ravel()], axis=1)
        ).reshape(np.shape(px))
    except Exception:
        return inside_polygon(px, py, poly)


def height_field(px, py, fine_pts, slopes, H):
    """h(p) = min(H, min_e d_e(p)/n_e)。fine_pts 为闭合加密折线 (M,2)。"""
    h = np.full(np.shape(px), float(H))
    m = len(fine_pts)
    for i in range(m):
        ax, ay = fine_pts[i]
        bx, by = fine_pts[(i + 1) % m]
        d = seg_dist(px, py, ax, ay, bx, by)
        h = np.minimum(h, d / max(slopes[i], 1e-6))
    return np.minimum(h, float(H))


# --------------------------------------------------------------------------
# LandfillModel
# --------------------------------------------------------------------------

class Footprint:
    """一个填埋单元（或整体单一轮廓）的坡脚定义。"""

    def __init__(self, poly_coarse, z0, H, slopes, arcs=None, name="单元",
                 design_H=None):
        self.name = name
        self.poly_coarse = [(float(p[0]), float(p[1])) for p in poly_coarse]
        self.arcs = arcs or []
        self.fine, self.parent = densify_polygon(self.poly_coarse, self.arcs)
        self.slopes = expand_slopes(slopes, len(self.poly_coarse),
                                    self.parent if self.arcs else None)
        self.z0 = float(z0)
        self.H = float(H)
        self.design_H = float(design_H) if design_H else float(H)
        xs = [p[0] for p in self.fine]
        ys = [p[1] for p in self.fine]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))

    def height(self, px, py):
        return height_field(px, py, self.fine, self.slopes, self.H)

    def contains(self, px, py):
        return point_in_poly(px, py, self.fine)


class LandfillModel:
    """场地模型：底面 + 堆体 + 分层 + 开挖。所有分析动作共用。"""

    def __init__(self, spec: dict, workdir=None):
        self.spec = dict(spec)
        self.site_name = str(spec.get("site_name") or "未命名场地")
        self.demo = spec.get("demo")
        self.grid_nx = int(spec.get("grid_nx") or 101)
        self.footprints: list[Footprint] = []
        self.excavation_spec = spec.get("excavation") or []
        self.excavations: list[dict] = []
        self.waste_layers = self._parse_layers(spec.get("layers"))
        self.notes: list[str] = []
        self._build(spec)

    # ---- 入口 ----
    @staticmethod
    def _parse_layers(raw):
        out = []
        for row in raw or []:
            try:
                name = str(row[0])
                h = float(row[1])
                g = float(row[2])
            except Exception:
                continue
            if h > 0:
                out.append([name, h, g])
        return out

    def _build(self, spec):
        if self.demo == "valley":
            self._build_demo_valley(spec)
        elif self.demo == "plain":
            self._build_demo_plain(spec)
        elif str(spec.get("source") or spec.get("shape")) == "points":
            self._build_points(spec)
        elif str(spec.get("shape")) == "cells" and spec.get("cells"):
            self._build_cells(spec)
        elif spec.get("polygon"):
            poly = [(float(p[0]), float(p[1])) for p in spec["polygon"]]
            self._push_single(spec, poly)
        else:
            r = spec.get("rect") or {}
            L = float(r.get("L", 300) or 300)
            W = float(r.get("W", 200) or 200)
            cx = float(r.get("cx", 0) or 0)
            cy = float(r.get("cy", 0) or 0)
            poly = [(cx - L / 2, cy - W / 2), (cx + L / 2, cy - W / 2),
                    (cx + L / 2, cy + W / 2), (cx - L / 2, cy + W / 2)]
            self._push_single(spec, poly)
        self._apply_excavation(spec.get("excavation") or [])
        self.ensure_grid()

    def _push_single(self, spec, poly):
        z0 = float(spec.get("z0", 0) or 0)
        H = float(spec.get("height", 20) or 20)
        n = float(spec.get("n", 4) or 4)
        self.footprints.append(Footprint(poly, z0, H, spec.get("slopes"),
                                         spec.get("arcs"), self.site_name or "单元"))

    def _build_cells(self, spec):
        for i, c in enumerate(spec["cells"]):
            try:
                poly = [(float(p[0]), float(p[1])) for p in (c.get("poly") or [])]
            except Exception:
                continue
            if len(poly) < 3:
                L = float(c.get("L", 300) or 300)
                W = float(c.get("W", 200) or 200)
                cx = float(c.get("cx", 0) or 0)
                cy = float(c.get("cy", 0) or 0)
                poly = [(cx - L / 2, cy - W / 2), (cx + L / 2, cy - W / 2),
                        (cx + L / 2, cy + W / 2), (cx - L / 2, cy + W / 2)]
            fp = Footprint(poly, float(c.get("z0", 0) or 0),
                           float(c.get("height", 20) or 20), c.get("slopes"),
                           c.get("arcs"), str(c.get("name") or f"单元{i + 1}"),
                           c.get("design_H"))
            self.footprints.append(fp)

    def _build_points(self, spec):
        pts = np.asarray(spec.get("base_points") or [], dtype=float)
        if pts.ndim != 2 or pts.shape[0] < 3:
            raise ValueError("source=points 需要 base_points=[[x,y,z],…] 至少 3 点")
        self.points_base = pts
        self.points_top = (np.asarray(spec["top_points"], dtype=float)
                           if spec.get("top_points") else None)
        self.interp_method = str(spec.get("interp_method") or "linear")
        self.idw_power = float(spec.get("idw_power") or 2)
        self.idw_k = int(spec.get("idw_k") or 12)
        self.top_mode = str(spec.get("top_mode") or "surface")
        self.design_level = float(spec.get("design_level", 0) or 0)
        xs, ys = pts[:, 0], pts[:, 1]
        self.domain = (float(xs.min()), float(ys.min()),
                       float(xs.max()), float(ys.max()))
        # points 模式无坡脚线：堆体顶面由 top_points 插值（或水平设计标高）
        self._points_mode = True
        gx = self.grid_nx
        x0, y0, x1, y1 = self.domain
        dx = x1 - x0
        self.grid_ny = max(8, int(round(gx * (y1 - y0) / max(dx, 1e-9))))
        self.nx, self.ny = gx, self.grid_ny
        gxv = np.linspace(x0, x1, self.nx)
        gyv = np.linspace(y0, y1, self.ny)
        self.gx, self.gy = gxv, gyv
        self.X, self.Y = np.meshgrid(gxv, gyv)
        self.base = self._interp(pts, self.X, self.Y)
        if self.top_mode == "level":
            self.top = np.full_like(self.base, float(self.design_level))
            self.h = np.maximum(self.top - self.base, 0.0)
        elif self.points_top is not None and len(self.points_top) >= 3:
            self.top = self._interp(self.points_top, self.X, self.Y)
            self.h = np.maximum(self.top - self.base, 0.0)
        else:
            self.top = self.base.copy()
            self.h = np.zeros_like(self.base)
        self.exc_top = self.top.copy()
        return

    def _interp(self, pts, X, Y):
        """测点插值：linear → scipy griddata（缺 scipy 退 IDW）；idw/nearest 同理。"""
        method = self.interp_method
        try:
            if method == "nearest":
                from scipy.interpolate import NearestNDInterpolator
                f = NearestNDInterpolator((pts[:, 0], pts[:, 1]), pts[:, 2])
                z = f(X, Y)
            else:  # linear / cubic / idw 皆先试 scipy
                from scipy.interpolate import LinearNDInterpolator
                f = LinearNDInterpolator((pts[:, 0], pts[:, 1]), pts[:, 2])
                z = f(X, Y)
                if np.any(~np.isfinite(z)):
                    z = self._idw(pts, X, Y, z)
            return np.nan_to_num(np.asarray(z, dtype=float),
                                 nan=float(np.nanmean(pts[:, 2])))
        except Exception:
            return self._idw(pts, X, Y, None)

    def _idw(self, pts, X, Y, fill=None):
        p = float(self.idw_power)
        k = max(3, min(self.idw_k, len(pts)))
        out = np.zeros(X.shape)
        for i in range(X.shape[0]):
            for j in range(X.shape[1]):
                d = np.hypot(pts[:, 0] - X[i, j], pts[:, 1] - Y[i, j])
                idx = np.argsort(d)[:k]
                dk = np.maximum(d[idx], 1e-9)
                w = 1.0 / dk ** p
                out[i, j] = float(np.sum(w * pts[idx, 2]) / np.sum(w))
        return out

    # ---- 示例场 ----
    def _build_demo_plain(self, spec):
        gx = int(spec.get("grid_nx") or 101)
        spec2 = dict(spec)
        spec2.update({"shape": "rect", "rect": {"cx": 0, "cy": 0, "L": 300, "W": 200},
                      "z0": 0, "height": 20, "n": 4, "grid_nx": gx,
                      "site_name": "平原型示例填埋场"})
        self.spec = spec2
        self.demo_spec = spec2
        self._push_single(spec2, [(-150, -100), (150, -100), (150, 100), (-150, 100)])

    def _build_demo_valley(self, spec):
        """山谷型示例：三个单元沿谷地排布，逐边坡比 1:1.5~1:5。"""
        gx = int(spec.get("grid_nx") or 101)
        cells = [
            {"name": "一库区", "poly": [[-260, -70], [-60, -70], [-60, 70], [-260, 70]],
             "z0": 2, "height": 24, "n": 3,
             "slopes": [2.0, 5.0, 1.5, 3.0], "design_H": 30},
            {"name": "二库区", "poly": [[-60, -80], [90, -80], [90, 80], [-60, 80]],
             "z0": 4, "height": 30, "n": 3,
             "slopes": [2.5, 4.0, 2.0, 3.5], "design_H": 36},
            {"name": "三库区", "poly": [[90, -60], [250, -60], [250, 60], [90, 60]],
             "z0": 7, "height": 20, "n": 3,
             "slopes": [3.0, 4.5, 2.5, 4.0], "design_H": 26},
        ]
        spec2 = dict(spec)
        spec2.update({"shape": "cells", "cells": cells, "grid_nx": gx,
                      "site_name": "山谷型示例填埋场"})
        self.spec = spec2
        self.demo_spec = spec2
        self._build_cells(spec2)

    # ---- 网格 ----
    def ensure_grid(self):
        if hasattr(self, "X"):
            return
        x0 = y0 = x1 = y1 = None
        for fp in self.footprints:
            a, b, c, d = fp.bbox
            x0 = a if x0 is None else min(x0, a)
            y0 = b if y0 is None else min(y0, b)
            x1 = c if x1 is None else max(x1, c)
            y1 = d if y1 is None else max(y1, d)
        if x0 is None:
            x0, y0, x1, y1 = -200, -150, 200, 150
        # 出界余量 15%，等高线/坡度图更好看
        mx = (x1 - x0) * 0.15
        my = (y1 - y0) * 0.15
        x0, x1, y0, y1 = x0 - mx, x1 + mx, y0 - my, y1 + my
        nx = self.grid_nx
        ny = max(8, int(round(nx * (y1 - y0) / max(x1 - x0, 1e-9))))
        self.nx, self.ny = nx, ny
        self.gx = np.linspace(x0, x1, nx)
        self.gy = np.linspace(y0, y1, ny)
        self.X, self.Y = np.meshgrid(self.gx, self.gy)
        self.domain = (x0, y0, x1, y1)

    # ---- 底面 / 顶面 ----
    def base_surface(self):
        """底面（地形/衬层底板）z(x,y)。"""
        self.ensure_grid()
        if hasattr(self, "_points_mode"):
            return self.base
        z = np.full(self.X.shape, float(min(fp.z0 for fp in self.footprints)
                                       if self.footprints else 0.0))
        for fp in self.footprints:
            m = fp.contains(self.X, self.Y)
            z[m] = fp.z0
        return z

    def pile_height(self):
        """堆体高 h(x,y)（未开挖）。示例场做内部平滑：多单元衔接的屋脊在粗网格上
        会出锯齿尖刺，高斯磨平堆体内部、坡脚边界保持锐利（用腐蚀掩码保护）。"""
        self.ensure_grid()
        if hasattr(self, "_points_mode"):
            return self.h
        h = np.zeros(self.X.shape)
        for fp in self.footprints:
            hi = fp.height(self.X, self.Y)
            inside = fp.contains(self.X, self.Y)
            h = np.where(inside, np.maximum(h, hi), h)
        if getattr(self, "demo", None) and h.max() > 0:
            try:
                from scipy.ndimage import binary_erosion, gaussian_filter
                interior = binary_erosion(h > 0, iterations=3)
                hs = gaussian_filter(h, sigma=1.4)
                h = np.where(interior, np.minimum(hs, float(h.max())), h)
            except Exception:
                pass
        return h

    def surfaces(self):
        """返回 (base, top_raw, h)。top = base + h。"""
        base = self.base_surface()
        h = self.pile_height()
        if hasattr(self, "_points_mode"):
            return base, self.top.copy(), h
        return base, base + h, h

    # ---- 开挖 ----
    def _apply_excavation(self, zones_spec):
        if not zones_spec:
            self.exc_top = None
            return
        base, top, h = self.surfaces()
        exc_top = top.copy()
        removed_total = 0.0
        cell_area = self._cell_area()
        zones = sorted(zones_spec, key=lambda z: float(z.get("order", 0) or 0))
        for i, z in enumerate(zones):
            try:
                poly = np.asarray(z.get("poly") or [], dtype=float)
            except Exception:
                continue
            if poly.ndim != 2 or len(poly) < 3:
                continue
            inside = point_in_poly(self.X, self.Y, poly)
            if not inside.any():
                continue
            # top_z：None → 沿分区坡顶线（分区多边形顶点）采样现顶面取均值
            tz = z.get("top_z", None)
            if tz is None or not math.isfinite(float(tz if tz is not None else float("nan"))):
                edge_z = []
                for p in poly:
                    ix = int(np.clip(np.searchsorted(self.gx, p[0]), 1, self.nx - 1))
                    iy = int(np.clip(np.searchsorted(self.gy, p[1]), 1, self.ny - 1))
                    edge_z.append(float(exc_top[iy - 1:iy + 1, ix - 1:ix + 1].mean()))
                tz = float(np.mean(edge_z)) if edge_z else 0.0
            else:
                tz = float(tz)
            levels = []
            for lv in z.get("levels") or []:
                try:
                    hh, nn = float(lv[0]), float(lv[1])
                    bb = float(lv[2]) if len(lv) > 2 else 0.0
                except Exception:
                    continue
                levels.append((hh, nn, bb))
            if not levels:
                tn = float(z.get("temp_n", 2.0) or 2.0)
                levels = [(tz - float(min(fp.z0 for fp in self.footprints)), tn, 0.0)]
            temp_n = float(z.get("temp_n", 2.0) or 2.0)
            cut_to_base = bool(z.get("cut_to_base"))
            zone_slopes = z.get("slopes")
            # 分区坡顶线（粗折线 + 可选弧）；逐边临时坡比
            fine, parent = densify_polygon([(float(p[0]), float(p[1])) for p in poly],
                                           z.get("arcs"))
            sl = expand_slopes(zone_slopes, len(poly),
                               parent if z.get("arcs") else None, default=temp_n)
            # 挖深剖面：d(d_in) 分级坡 — 由边界向内逐级下降
            dmax_base = None
            if cut_to_base:
                z_in = self.base_surface()
                dmax_base = float(z_in[inside].mean())
            # 距分区边界距离 → 挖深
            dist_in = np.full(self.X.shape, np.inf)
            m = len(fine)
            for e_idx in range(m):
                ax, ay = fine[e_idx]
                bx, by = fine[(e_idx + 1) % m]
                dd = seg_dist(self.X, self.Y, ax, ay, bx, by)
                dist_in = np.minimum(dist_in, dd)
            n_edge = sl[min(0, len(sl) - 1)] if sl else temp_n
            depth = self._bench_depth(dist_in, levels, temp_n)
            new_top = np.full(self.X.shape, np.nan)
            target = tz - depth
            if dmax_base is not None:
                target = np.maximum(target, dmax_base)
            new_top[inside] = target[inside]
            cut = np.where(inside, np.maximum(exc_top - new_top, 0.0), 0.0)
            removed = float(np.nansum(cut) * cell_area)
            removed_total += removed
            vol_est = removed
            self.excavations.append({
                "name": str(z.get("name") or f"开挖区{i + 1}"),
                "index": i, "top_z": tz, "levels": levels,
                "temp_n": temp_n, "cut_to_base": cut_to_base,
                "removed_m3": vol_est,
            })
            exc_top = np.where(inside,
                               np.minimum(exc_top, np.where(np.isnan(new_top), exc_top, new_top)),
                               exc_top)
        self.exc_top = exc_top
        self.exc_removed_total = removed_total

    @staticmethod
    def _bench_depth(dist_in, levels, temp_n):
        """分级开挖挖深剖面：坡顶线向内，每级 [坡高 h, 坡比 n, 马道 b] ——
        水平 n*h 内深度 0→累计坡高，随后马道 b 段深度保持；级后用临时坡
        1:temp_n 继续下一段的简化口径与桌面台阶视觉一致。"""
        depth = np.zeros_like(np.asarray(dist_in, dtype=float))
        run = 0.0
        cum = 0.0
        for (hh, nn, bb) in levels:
            nn = max(nn, 0.1)
            w = nn * hh
            k = (dist_in >= run) & (dist_in < run + w)
            depth = np.where(k, cum + hh * (dist_in - run) / w, depth)
            run += w
            cum += hh
            if bb > 0:
                depth = np.where((dist_in >= run) & (dist_in < run + bb), cum, depth)
                run += bb
        depth = np.where(np.asarray(dist_in) >= run, cum, depth)
        return depth

    # ---- 工具 ----
    def _cell_area(self):
        dx = float(self.gx[1] - self.gx[0])
        dy = float(self.gy[1] - self.gy[0])
        return dx * dy

    def top_surface(self):
        base, top, h = self.surfaces()
        return self.exc_top if self.exc_top is not None else top

    def volume_m3(self):
        base, top, h = self.surfaces()
        top_now = self.top_surface()
        try:
            from scipy.integrate import simpson
            vol = simpson(simpson(np.clip(top_now - base, 0.0, None),
                                  x=self.gy, axis=0), x=self.gx)
            return float(vol)
        except Exception:
            return float(np.nansum(np.maximum(top_now - base, 0.0)) * self._cell_area())

    def footprint_polygons(self):
        return [fp.fine for fp in self.footprints]

    def gamma_profile(self):
        """分层容重 → [(z_from, z_to, gamma)] 自底向上（沿用 build.layers）。"""
        if not self.waste_layers:
            return [(0.0, 1e9, 10.0)]
        out = []
        z = 0.0
        for name, h, g in self.waste_layers:
            out.append((z, z + h, g))
            z += h
        out[-1] = (out[-1][0], 1e9, out[-1][2])
        return out

    def gamma_at(self, depth_below_top):
        for a, b, g in self.gamma_profile():
            if a <= depth_below_top < b:
                return g
        return self.gamma_profile()[-1][2]

    # ---- 工程存档 ----
    def project(self):
        """工程存档（桌面"另存工程"等价物）。analyze_* 由它重建。"""
        spec = dict(self.spec)
        proj = {
            "site_name": self.site_name,
            "spec": spec,
            "parametric": True,
            "param_z0": float(spec.get("z0", 0) or 0),
            "param_H": float(spec.get("height", 20) or 20),
            "param_n": float(spec.get("n", 4) or 4),
            "waste_layers": self.waste_layers,
            "grid_nx": self.grid_nx,
        }
        if getattr(self, "demo_spec", None):
            proj["demo"] = self.demo
        if self.footprints:
            if len(self.footprints) == 1:
                fp = self.footprints[0]
                proj["footprint_polygon"] = [[round(p[0], 3), round(p[1], 3)] for p in fp.fine]
                proj["cells"] = [{
                    "name": fp.name, "poly": proj["footprint_polygon"],
                    "poly_coarse": [[round(p[0], 3), round(p[1], 3)] for p in fp.poly_coarse],
                    "arcs": [list(a) for a in (fp.arcs or [])],
                    "z0": fp.z0, "height": fp.H, "n": fp.slopes[0] if fp.slopes else 4,
                    "slopes": list(fp.slopes[:len(fp.poly_coarse)]) if fp.slopes else None,
                }]
            else:
                proj["cells"] = []
                for fp in self.footprints:
                    proj["cells"].append({
                        "name": fp.name,
                        "poly": [[round(p[0], 3), round(p[1], 3)] for p in fp.fine],
                        "poly_coarse": [[round(p[0], 3), round(p[1], 3)] for p in fp.poly_coarse],
                        "arcs": [list(a) for a in (fp.arcs or [])],
                        "z0": fp.z0, "height": fp.H,
                        "n": fp.slopes[0] if fp.slopes else 4,
                        "slopes": list(fp.slopes[:len(fp.poly_coarse)]) if fp.slopes else None,
                    })
        if hasattr(self, "_points_mode"):
            proj.pop("parametric", None)
            proj["base_points"] = self.points_base.tolist()
            if self.points_top is not None:
                proj["top_points"] = self.points_top.tolist()
            proj["interp_method"] = self.interp_method
            proj["top_mode"] = self.top_mode
            proj["design_level"] = self.design_level
        if self.excavations:
            proj["excavation"] = self.excavation_spec
        return proj

    @classmethod
    def from_project(cls, project: dict):
        spec = dict(project.get("spec") or {})
        if not spec:
            if project.get("cells"):
                spec = {"shape": "cells",
                        "cells": [dict(c) for c in project["cells"]],
                        "grid_nx": int(project.get("grid_nx") or 101),
                        "site_name": project.get("site_name") or ""}
                for c in spec["cells"]:
                    c.setdefault("poly", c.get("poly"))
            elif project.get("footprint_polygon"):
                spec = {"shape": "poly", "polygon": project["footprint_polygon"],
                        "z0": project.get("param_z0", 0), "height": project.get("param_H", 20),
                        "n": project.get("param_n", 4),
                        "grid_nx": int(project.get("grid_nx") or 101),
                        "site_name": project.get("site_name") or ""}
            elif project.get("base_points"):
                spec = {"source": "points", "base_points": project["base_points"],
                        "top_points": project.get("top_points"),
                        "interp_method": project.get("interp_method", "linear"),
                        "top_mode": project.get("top_mode", "surface"),
                        "design_level": project.get("design_level", 0),
                        "grid_nx": int(project.get("grid_nx") or 101)}
        if project.get("waste_layers") and not spec.get("layers"):
            spec["layers"] = project["waste_layers"]
        if project.get("demo") and not spec:
            spec = {"demo": project["demo"]}
        spec.setdefault("grid_nx", int(project.get("grid_nx") or 101))
        return cls(spec)
