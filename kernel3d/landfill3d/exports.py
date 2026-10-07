"""exports.py · 简报（txt）/ 汇总（xlsx、docx）/ 底层数据（csv）。"""
from __future__ import annotations

import os


def write_report_txt(model, action, summary, data, stamp, path):
    lines = [
        "Landfill 3D Tool · 分析简报",
        f"场地：{model.site_name}",
        f"动作：{action}",
        f"口径：physics={stamp.get('physics')}  kernel={stamp.get('kernel')}  v{stamp.get('version')}",
        "",
        "一、结论",
        f"  {summary}",
        "",
    ]
    table = (data or {}).get("table") or {}
    cols = table.get("cols") or []
    rows = table.get("rows") or []
    if cols:
        lines.append("二、结果表")
        lines.append("  " + " | ".join(str(c) for c in cols))
        for r in rows[:30]:
            lines.append("  " + " | ".join("" if v is None else str(v) for v in r))
        lines.append("")
    key = (data or {}).get("key_numbers") or {}
    if key:
        lines.append("三、关键数值")
        for k, v in list(key.items())[:20]:
            lines.append(f"  {k} = {v}")
        lines.append("")
    notes = (data or {}).get("notes") or []
    lines.append("注：本简报由确定性内核生成，数值唯一出处为 landfill3d 内核，引用请带口径戳。")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return os.path.getsize(path)


def _flat_tables(action, data, params):
    """把一次结果拆成若干 (sheet名, cols, rows)。"""
    d = data or {}
    out = []
    t = d.get("table") or {}
    if t.get("cols"):
        out.append((f"{action}-结果", t["cols"], t["rows"]))
    curve = d.get("curve") or {}
    if curve.get("levels_m"):
        rows = []
        for i, lv in enumerate(curve["levels_m"]):
            rows.append([lv,
                         (curve.get("volume_m3") or [None] * len(curve["levels_m"]))[i],
                         (curve.get("area_m2") or [None] * len(curve["levels_m"]))[i]])
        out.append((f"{action}-曲线", ["标高(m)", "数值1", "数值2"], rows))
    stages = d.get("stages")
    if isinstance(stages, list) and stages:
        rows = [[s.get("stage"), s.get("Fs"), s.get("removed_m3"), s.get("cut_volume_m3"),
                 "是" if s.get("worst") else ""] for s in stages]
        out.append(("逐阶段", ["阶段", "Fs", "累计挖方m³", "开挖量m³", "最危险"], rows))
    zones = d.get("zones")
    if isinstance(zones, list) and zones:
        rows = [[z.get("name"), len(z.get("poly") or []), z.get("order"),
                 z.get("temp_n"), str(z.get("levels"))] for z in zones]
        out.append(("分区", ["分区", "顶点数", "顺序", "临时坡", "分级"], rows))
    key = d.get("key_numbers") or {}
    if key:
        out.append(("关键数值", ["键", "值"], [[k, v] for k, v in key.items()]))
    if not out:
        out.append(("结果", ["指标", "数值"], [["summary", d.get("summary", "")]]))
    return out


def export_xlsx(model, action, data, params, path):
    from openpyxl import Workbook
    wb = Workbook()
    wb.remove(wb.active)
    for name, cols, rows in _flat_tables(action, data, params):
        ws = wb.create_sheet(name[:28] or "结果")
        ws.append([str(c) for c in cols])
        for r in rows[:5000]:
            ws.append([_cell(v) for v in r])
    # 汇总页
    ws = wb.create_sheet("汇总", 0)
    ws.append(["场地", model.site_name])
    ws.append(["堆体体积(m³)", round(model.volume_m3(), 1)])
    ws.append(["动作", action])
    ws.append(["summary", (data or {}).get("summary", "")])
    wb.save(path)
    return os.path.getsize(path)


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v
    s = str(v)
    return s[:500]


def export_docx(model, action, summary, data, params, path, stamp=None):
    from docx import Document
    doc = Document()
    doc.add_heading("Landfill 3D Tool · 分析汇总", 0)
    doc.add_paragraph(f"场地：{model.site_name}    动作：{action}")
    doc.add_paragraph(f"结论：{summary}")
    if stamp:
        doc.add_paragraph(f"口径：physics={stamp.get('physics')} kernel={stamp.get('kernel')} v{stamp.get('version')}")
    for name, cols, rows in _flat_tables(action, data, params)[:6]:
        doc.add_heading(name, 2)
        t = doc.add_table(rows=1, cols=len(cols))
        t.style = "Light Grid Accent 1"
        for i, c in enumerate(cols):
            t.rows[0].cells[i].text = str(c)
        for r in rows[:200]:
            cells = t.add_row().cells
            for i, v in enumerate(r[:len(cols)]):
                cells[i].text = "" if v is None else str(v)
    doc.save(path)
    return os.path.getsize(path)


def export_csv(model, action, view, sub, data, params, path):
    """当前图底层数据：按 view/sub 映射；无映射回退结果表。"""
    mapping = {
        ("storage", "storage_curve"): _csv_storage,
        ("section", "section"): _csv_section,
        ("slope", "slope_map"): _csv_slope,
        ("stability", "fs_grid"): _csv_sections,
        ("stability", "section_scan"): _csv_sections,
        ("excavation", "exc_fs_grid"): _csv_sections,
        ("contour", "contour"): _csv_grid,
    }
    fn = mapping.get((view, sub)) or mapping.get((view, None))
    rows, cols = None, None
    if fn:
        cols, rows = fn(model, params or {})
    if not rows:
        t = (data or {}).get("table") or {}
        cols = t.get("cols") or ["无数据"]
        rows = t.get("rows") or []
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        import csv
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows[:5000]:
            w.writerow(["" if v is None else v for v in r])
    return os.path.getsize(path)


def _csv_storage(model, params):
    from . import physics
    r = physics.analyze_storage(model, params)
    c = r["data"]["curve"]
    return ["填埋标高(m)", "累计库容(m³)", "库盆面积(m²)"], list(zip(
        c["levels_m"], c["volume_m3"], c["area_m2"]))


def _csv_section(model, params):
    from . import physics
    sec = (params or {}).get("section") or {}
    A = sec.get("A") or [model.domain[0], (model.domain[1] + model.domain[3]) / 2]
    B = sec.get("B") or [model.domain[2], (model.domain[1] + model.domain[3]) / 2]
    prof = physics.section_profile(model, A, B, int((params or {}).get("n", 240) or 240))
    return ["桩号(m)", "X", "Y", "基底标高", "顶面标高", "堆厚"], list(zip(
        [round(float(v), 1) for v in prof["s"]],
        [round(float(v), 1) for v in prof["x"]],
        [round(float(v), 1) for v in prof["y"]],
        [round(float(v), 2) for v in prof["base"]],
        [round(float(v), 2) for v in prof["top"]],
        [round(float(v), 2) for v in prof["thick"]]))


def _csv_slope(model, params):
    Z = model.top_surface()
    gy, gx = np_gradient(Z, model.gy, model.gx)
    import numpy as np
    slope = np.degrees(np.hypot(gx, gy))
    rows = []
    for i in range(0, model.ny, max(1, model.ny // 60)):
        for j in range(0, model.nx, max(1, model.nx // 60)):
            rows.append([round(float(model.X[i, j]), 1), round(float(model.Y[i, j]), 1),
                         round(float(slope[i, j]), 2)])
    return ["X", "Y", "坡度(°)"], rows


def _csv_sections(model, params):
    from . import physics
    r = physics.analyze_stability(model, params)
    rows = [[s.get("index"), s.get("station_m"), s.get("Fs")]
            for s in (r["data"].get("sections") or [])]
    return ["断面", "桩号(m)", "Fs"], rows


def _csv_grid(model, params):
    rows = []
    for i in range(0, model.ny, max(1, model.ny // 60)):
        for j in range(0, model.nx, max(1, model.nx // 60)):
            rows.append([round(float(model.X[i, j]), 1), round(float(model.Y[i, j]), 1),
                         round(float(model.top_surface()[i, j]), 2)])
    return ["X", "Y", "顶面标高"], rows


def np_gradient(Z, gy, gx):
    import numpy as np
    gyv, gxv = np.gradient(Z, gy, gx)
    return gyv, gxv
