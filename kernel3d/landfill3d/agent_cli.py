"""agent_cli.py · 文件桥动作调度（agent_bridge.py 的实现体）。

契约（server/kernel3d.ts runKernel3dAction）：
  入参 in.json：{action, spec?, params?, figures?, report?, fig_export?, project_file?}
  出参 out.json：{ok, summary, grade?, landfill3d:stamp, data, scene_hint?,
                  figures:[{key,label,file,size}], files:[{kind,file}],
                  notes:[], elapsed_ms, error?}
  workdir 内产出：model.obj / project.json（build_model、export_mesh），
  各 figure PNG、report.txt、stage-k.obj、导出件。

文件名一律匹配 ^[A-Za-z0-9._-]+$（服务端白名单路由，注意不能含 '@'）。
"""
from __future__ import annotations

import json
import os
import time
import traceback

import numpy as np

from . import STAMP, geometry, physics


# ---------------------------------------------------------------- 模型加载

def _load_model(cfg):
    pf = cfg.get("project_file")
    if pf and os.path.exists(pf):
        with open(pf, "r", encoding="utf-8") as f:
            proj = json.load(f)
        return geometry.LandfillModel.from_project(proj)
    spec = cfg.get("spec")
    if spec:
        return geometry.LandfillModel(spec)
    raise ValueError("缺少模型来源（project_file 不存在且无 spec）")


def _mesh_payload(model, overlay=None, overlay_params=None):
    from . import mesh
    obj_text, info = mesh.build_obj(model, overlay=overlay, overlay_params=overlay_params)
    return obj_text, info


# ---------------------------------------------------------------- 动作实现

def act_build_model(cfg, workdir):
    spec = dict(cfg.get("spec") or {})
    if not spec:
        raise ValueError("action=model 需要 spec（shape=rect/poly/cells 或 source=points 或 demo）")
    model = geometry.LandfillModel(spec)
    # 工程存档 → workdir（服务端复制为会话 project.json）
    with open(os.path.join(workdir, "project.json"), "w", encoding="utf-8") as f:
        json.dump(model.project(), f, ensure_ascii=False)
    obj_text, info = _mesh_payload(model)
    with open(os.path.join(workdir, "model.obj"), "w", encoding="utf-8") as f:
        f.write(obj_text)
    vol = model.volume_m3()
    grid = [model.nx, model.ny]
    data = {"model": {"site_name": model.site_name, "volume_m3": round(vol, 0),
                       "grid": grid, "mesh": info}}
    notes = [f"建模完成：{len(model.footprints)} 个坡脚单元，网格 {model.nx}×{model.ny}"]
    if model.excavations:
        data["excavation"] = {"count": len(model.excavations),
                               "removed_m3": round(getattr(model, "exc_removed_total", 0.0), 1)}
        notes.append(f"已应用 {len(model.excavations)} 个开挖分区，累计挖方 "
                     f"{getattr(model, 'exc_removed_total', 0.0) / 1e4:.1f} 万m³")
    summary = (f"三维建模完成：{model.site_name}，体积 {vol / 1e4:.1f} 万m³，"
               f"网格 {grid[0]}×{grid[1]}")
    if getattr(model, "demo_spec", None):
        data["demo"] = {
            "spec": _demo_spec_for_form(model),
            "stage_levels": [55.0, 62.0, 69.0, 76.0, 83.0, 92.0],
            "soil_layers": [["素填土/耕植土", 4.0, 2500], ["粉质黏土", 8.0, 4500],
                             ["强风化基岩", 6.0, 18000]],
        }
        summary += "（示例工程）"
    figs, fnote = _render_requested(model, cfg, workdir)
    notes += fnote
    return {"ok": True, "summary": summary, "grade": None, "data": data,
            "figures": figs, "notes": notes}


def _demo_spec_for_form(model):
    spec = dict(model.spec)
    spec.pop("excavation", None)
    if model.footprints:
        if len(model.footprints) == 1:
            fp = model.footprints[0]
            spec.pop("polygon", None)
            spec["rect"] = _rect_of(fp.poly_coarse)
        else:
            spec.pop("rect", None)
            spec.pop("polygon", None)
            spec["cells"] = [{
                "name": fp.name,
                "poly": [[round(x, 2), round(y, 2)] for x, y in fp.poly_coarse],
                "z0": fp.z0, "height": fp.H, "n": round(fp.slopes[0], 2),
                "slopes": [round(s, 2) for s in fp.slopes[:len(fp.poly_coarse)]],
                "design_H": fp.design_H,
            } for fp in model.footprints]
    return spec


def _rect_of(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return {"cx": round((min(xs) + max(xs)) / 2, 2), "cy": round((min(ys) + max(ys)) / 2, 2),
            "L": round(max(xs) - min(xs), 2), "W": round(max(ys) - min(ys), 2)}


def act_export_mesh(cfg, workdir):
    model = _load_model(cfg)
    params = dict(cfg.get("params") or {})
    overlay = params.pop("overlay", None)
    obj_text, info = _mesh_payload(model, overlay=overlay, overlay_params=params)
    with open(os.path.join(workdir, "model.obj"), "w", encoding="utf-8") as f:
        f.write(obj_text)
    with open(os.path.join(workdir, "project.json"), "w", encoding="utf-8") as f:
        json.dump(model.project(), f, ensure_ascii=False)
    ov = ", ".join((info.get("overlays") or {}).keys()) or "无"
    return {"ok": True, "summary": f"网格导出完成：{info.get('vertices')} 顶点 / {info.get('triangles')} 三角面（叠加层：{ov}）",
            "grade": None, "data": {"mesh": info}, "notes": []}


def act_info(cfg, workdir):
    from . import figs
    data = {
        "actions": ["build_model", "analyze_storage", "analyze_slope", "analyze_section",
                     "analyze_stability", "analyze_settlement", "analyze_excavation",
                     "analyze_excavation_phased", "excavation_zones", "analyze_pollution",
                     "render", "export_mesh", "export", "info"],
        "figures": sorted(figs.FIG_LABELS.keys()),
        "figure_labels": figs.FIG_LABELS,
        "options": {
            "grid_options": [41, 61, 81, 101, 121],
            "interp_options": ["linear", "cubic", "idw", "nearest"],
            "scan_dirs": ["X", "Y"],
            "layer_gamma": {"生活垃圾": 10, "建筑渣土": 18, "污泥": 12, "覆土": 18, "自定义": 12},
            "climate_zones": ["湿润区（P=1200mm）", "半湿润区（P=800mm）", "干旱区（P=400mm）"],
            "liners": ["compacted_clay", "single_hdpe", "composite", "double"],
            "quality_kinds": ["常规（COD/Cl⁻/NH₄⁺）", "渗滤液原液", "地下水对照"],
            "covers": ["黏土覆盖 0.5m", "HDPE 复合覆盖", "土工膜+压实土"],
        },
        "defaults": {"storage": {"h_start": None, "step": 1.0},
                      "stab": {"c": 8, "phi_deg": 25, "ru": 0.2, "gamma": 10,
                                "threshold": 1.3, "n_sections": 11},
                      "pollution": {"annual_P_mm": 1200, "annual_PET_mm": 700,
                                     "fill_start_year": 2005, "fill_end_year": 2015,
                                     "horizon_years": 50}},
        "landfill3d": STAMP,
    }
    return {"ok": True, "summary": f"landfill3d v{STAMP['version']}（physics={STAMP['physics']}）",
            "grade": None, "data": data, "notes": []}


def _analyze_wrapper(fn):
    def inner(cfg, workdir):
        model = _load_model(cfg)
        params = cfg.get("params") or {}
        r = fn(model, params)
        figs, fnote = _render_requested(model, cfg, workdir, extra_params=params)
        notes = list(r.get("notes") or []) + fnote
        report_file = _write_report_if_requested(cfg, model, r, workdir)
        files = []
        if report_file:
            files.append({"kind": "report", "file": report_file})
        r.setdefault("data", {})
        r["data"].setdefault("notes", [])
        r["figures"] = figs
        r["files"] = files
        r["notes"] = notes[:12]
        return r
    return inner


def _render_requested(model, cfg, workdir, extra_params=None):
    keys = cfg.get("figures")
    if keys is None:
        return [], []
    from . import figs as F
    params = dict(cfg.get("params") or {})
    if extra_params:
        for k, v in extra_params.items():
            params.setdefault(k, v)
    fe = cfg.get("fig_export")
    out, notes = F.render_figures(model, keys, workdir, params=params)
    files = [{"kind": "figure", "file": f["file"]} for f in out]
    if fe and out:
        fmt = str(fe.get("format", "png"))
        dpi = int(fe.get("dpi", 300) or 300)
        for f in out:
            base = os.path.splitext(f["file"])[0]
            target = f"{base}.{fmt}"
            path = os.path.join(workdir, target)
            try:
                _rerender_at(F, model, f["key"], path, params, dpi)
                files.append({"kind": "figure_export", "file": target})
            except Exception as e:
                notes.append(f"出版件 {target} 导出失败：{e}")
    return out, notes


def _rerender_at(F, model, key, path, params, dpi):
    import os
    import matplotlib.pyplot as plt
    plt.rcParams["savefig.dpi"] = int(dpi)   # 出版件按请求 dpi 重渲
    try:
        dispatch = {
            "model3d": F.fig_model3d, "contour": F.fig_contour, "slope_map": F.fig_slope_map,
            "section": F.fig_section, "storage_curve": F.fig_storage_curve,
            "settlement_profile": F.fig_settlement_profile, "settlement_plane": F.fig_settlement_plane,
            "fs_grid": lambda p, pp: F.fig_fs_grid(model, p, pp, exc=False),
            "critical_arc": lambda p, pp: F.fig_critical_arc(model, p, pp, exc=False),
            "section_scan": F.fig_section_scan, "monte_carlo": F.fig_monte_carlo,
            "exc_arc": lambda p, pp: F.fig_critical_arc(model, p, pp, exc=True),
            "exc_levels": F.fig_exc_levels,
            "exc_fs_grid": lambda p, pp: F.fig_fs_grid(model, p, pp, exc=True),
            "gas_curve": F.fig_gas_curve, "gas_field": F.fig_gas_field,
            "leachate": F.fig_leachate, "quality": F.fig_quality, "column": F.fig_column,
            "plume_plan": lambda p, pp: F.fig_plume(model, p, pp, section=False),
            "plume_section": lambda p, pp: F.fig_plume(model, p, pp, section=True),
        }
        fn = dispatch.get(key)
        if fn is None:
            raise ValueError(f"未知图键 {key}")
        fn(path, params)
    finally:
        plt.rcParams["savefig.dpi"] = 150


def _write_report_if_requested(cfg, model, r, workdir):
    if not cfg.get("report"):
        return None
    from . import exports
    path = os.path.join(workdir, "report.txt")
    exports.write_report_txt(model, str(cfg.get("action", "")), r.get("summary", ""),
                             r.get("data") or {}, STAMP, path)
    return "report.txt"


def act_render(cfg, workdir):
    model = _load_model(cfg)
    figs, notes = _render_requested(model, cfg, workdir, extra_params=cfg.get("params") or {})
    return {"ok": True, "summary": f"渲染完成：{len(figs)} 张图", "grade": None,
            "data": {}, "figures": figs, "files": [], "notes": notes}


def act_export(cfg, workdir):
    model = _load_model(cfg)
    params = dict(cfg.get("params") or {})
    fmt = str(params.get("format", "csv") or "csv").lower()
    from . import exports
    # 汇总数据（供 xlsx/docx）：跑一次与 export 相关的轻量结果
    data = {"summary": "", "table": {}, "key_numbers": {}}
    try:
        r = physics.analyze_storage(model, {})
        data["key_numbers"].update(r["data"]["key_numbers"])
        data["summary"] = r["summary"]
    except Exception:
        pass
    files = []
    if fmt == "xlsx":
        name = "summary.xlsx"
        exports.export_xlsx(model, "export", data, params, os.path.join(workdir, name))
        files.append({"kind": "export", "file": name})
        summary = "已导出 Excel 汇总"
    elif fmt == "docx":
        name = "summary.docx"
        exports.export_docx(model, "export", data.get("summary", ""), data, params,
                            os.path.join(workdir, name), stamp=STAMP)
        files.append({"kind": "export", "file": name})
        summary = "已导出 Word 汇总"
    else:
        view = str(params.get("view", "") or "")
        sub = params.get("sub")
        name = "view-data.csv"
        exports.export_csv(model, view, view, sub, data, params, os.path.join(workdir, name))
        files.append({"kind": "export", "file": name})
        summary = f"已导出 {view or '当前视图'} 底层数据 CSV"
    return {"ok": True, "summary": summary, "grade": None, "data": {},
            "figures": [], "files": files, "notes": []}


def act_excavation_phased(cfg, workdir):
    model = _load_model(cfg)
    params = dict(cfg.get("params") or {})
    zones = params.get("zones") or []
    if not zones:
        raise ValueError("分区开挖需要 params.zones（分区多边形）")
    # 逐阶段：应用 zones[:k]，写 stage-k.obj 与阶段剖面 PNG
    stages = []
    files = []
    fig_keys = cfg.get("figures")
    saved_exc = getattr(model, "exc_top", None)
    saved_spec = model.excavation_spec
    worst_i = None
    fs_list = []
    for k in range(1, len(zones) + 1):
        sub = sorted(zones, key=lambda z: float(z.get("order", 0) or 0))[:k]
        model._apply_excavation(sub)
        fs_k = None
        try:
            er = physics.analyze_excavation(model, {kk: vv for kk, vv in params.items()
                                                     if kk not in ("zones",)})
            fs_k = er["data"]["key_numbers"]["Fs_min"]
        except Exception:
            fs_k = None
        fs_list.append(fs_k)
        removed = sum(e.get("removed_m3", 0.0) for e in model.excavations)
        obj_name = f"stage-{k}.obj"
        fig_name = f"exc-stage-{k}.png"
        from . import mesh
        info = mesh.write_stage_obj(model, os.path.join(workdir, obj_name), model.top_surface())
        from . import figs as F
        try:
            F.fig_section(model, os.path.join(workdir, fig_name),
                          {"sec_segments": False}, stage_tag=f"（阶段{k}）")
        except Exception:
            fig_name = None
        entry = {"stage": k, "Fs": fs_k, "Fs_arc": fs_k,
                  "removed_m3": round(removed, 1), "cut_volume_m3": round(removed, 1),
                  "mesh_file": obj_name, "mesh_bounds": (info or {}).get("bounds")}
        if fig_name:
            entry["section_png"] = fig_name
            files.append({"kind": "stage_figure", "file": fig_name})
        files.append({"kind": "stage_mesh", "file": obj_name})
        stages.append(entry)
    valid = [(i, f) for i, f in enumerate(fs_list) if f is not None]
    if valid:
        worst_i = min(valid, key=lambda x: x[1])[0]
        stages[worst_i]["worst"] = True
    model.exc_top = saved_exc
    model.excavation_spec = saved_spec
    rows = [["0（开挖前）", "—", "0.0"]]
    for s in stages:
        rows.append([f"{s['stage']}", f"{s['Fs']:.3f}" if s["Fs"] else "—", f"{s['removed_m3']:.0f}"])
    data = {"stages": stages,
             "table": {"cols": ["阶段", "Fs", "累计挖方 (m³)"], "rows": rows},
             "key_numbers": {"阶段数": len(stages),
                              "Fs_min": min([f for f in fs_list if f], default=None)}}
    figs, fnote = _render_requested(model, cfg, workdir,
                                     extra_params={**params, "_stages": stages})
    files += [{"kind": "figure", "file": f["file"]} for f in figs]
    summary = (f"分区开挖逐阶段完成：{len(stages)} 阶段，最危险阶段 #"
               f"{(worst_i + 1) if worst_i is not None else '—'}"
               + (f"，Fs_min={min(f for f in fs_list if f):.3f}" if any(fs_list) else ""))
    report_file = _write_report_if_requested(cfg, model, {"summary": summary, "data": data}, workdir)
    if report_file:
        files.append({"kind": "report", "file": report_file})
    return {"ok": True, "summary": summary,
             "grade": physics.grade_from_fs(min([f for f in fs_list if f], default=None)),
             "data": data, "figures": figs, "files": files,
             "notes": ["每阶段按开挖顺序叠加分区后重算几何与开挖稳定 Fs"] + fnote}


# ---------------------------------------------------------------- 主入口

HANDLERS = {
    "build_model": act_build_model,
    "export_mesh": act_export_mesh,
    "info": act_info,
    "render": act_render,
    "export": act_export,
    "analyze_excavation_phased": act_excavation_phased,
    "excavation_zones": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.excavation_zones(m, p))(cfg, wd),
    "analyze_storage": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_storage(m, p))(cfg, wd),
    "analyze_slope": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_slope(m, p))(cfg, wd),
    "analyze_section": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_section(m, p))(cfg, wd),
    "analyze_settlement": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_settlement(m, p))(cfg, wd),
    "analyze_stability": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_stability(m, p))(cfg, wd),
    "analyze_excavation": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_excavation(m, p))(cfg, wd),
    "analyze_pollution": lambda cfg, wd: _analyze_wrapper(
        lambda m, p: physics.analyze_pollution(m, p))(cfg, wd),
}


def run(cfg: dict, workdir: str) -> dict:
    t0 = time.time()
    action = str(cfg.get("action") or "")
    handler = HANDLERS.get(action)
    if handler is None:
        return {"ok": False, "summary": f"未知 action：{action}", "landfill3d": STAMP,
                "data": None, "figures": [], "files": [], "notes": [],
                "elapsed_ms": 0,
                "error": f"未知 action：{action}（可用 {', '.join(sorted(HANDLERS))}）"}
    try:
        r = handler(cfg, workdir)
        r.setdefault("ok", True)
        r.setdefault("summary", "")
        r.setdefault("grade", None)
        r.setdefault("data", {})
        r.setdefault("figures", [])
        r.setdefault("files", [])
        r.setdefault("notes", [])
        r["landfill3d"] = STAMP
        r["action"] = action
        r["elapsed_ms"] = int((time.time() - t0) * 1000)
        return r
    except Exception as e:
        return {"ok": False, "action": action, "summary": f"内核异常：{e}",
                "grade": None, "landfill3d": STAMP, "data": None, "figures": [],
                "files": [],
                "notes": [traceback.format_exc().splitlines()[-1]],
                "elapsed_ms": int((time.time() - t0) * 1000),
                "error": f"{type(e).__name__}: {e}"}
