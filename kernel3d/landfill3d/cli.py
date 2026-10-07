"""cli.py · stdin 桥入口（module= 内置示例场快查 + physics 口径守卫）。

契约（server/kernel3d.ts runKernel3d）：
  spawn `python -m landfill3d.cli`（cwd=内核仓库根），配置 JSON 走 stdin，
  结果**单行 JSON** 走 stdout：{ok, module?, stamp?, result?, notes?, error?}。

模块：capacity / stability_infinite / stability_scan / settlement / pollution_chain。
守卫：physics 只接受 v170（或缺省）；传 v160 且未显式 frozen_reference_ok=true
      → ok=false（红队用例 k3d-check.ts ② 依赖该行为）。
"""
from __future__ import annotations

import json
import math
import sys

from . import STAMP, geometry, physics


def _demo_model():
    spec = {"demo": "valley", "grid_nx": 61}
    return geometry.LandfillModel(spec)


def handle(cfg: dict) -> dict:
    module = str(cfg.get("module") or "")
    params = cfg.get("params") or {}
    phys = str(cfg.get("physics") or STAMP["physics"])
    frozen = bool(cfg.get("frozen_reference_ok"))
    notes = []
    if phys != STAMP["physics"] and not frozen:
        return {"ok": False, "module": module, "stamp": STAMP,
                "error": f"口径守卫：请求的 physics={phys} 已废弃，生产口径为 "
                         f"{STAMP['physics']}（如需冻结旧基线对照，请显式传 frozen_reference_ok=true）"}
    if phys != STAMP["physics"] and frozen:
        notes.append(f"已显式授权冻结旧口径 {phys}（基线对照，不用于正式结论）")

    try:
        if module == "capacity":
            m = _demo_model()
            base, top, h = m.surfaces()
            v = float(np_nansum(np.maximum(top - base, 0)) * m._cell_area())
            result = {
                "volume_m3": round(v, 0),
                "volume_wan_m3": round(v / 1e4, 1),
                "footprint_m2": round(float(_area(m)), 0),
                "height_m": max((fp.H for fp in m.footprints), default=0),
            }
            notes.append("capacity=示例山谷场现状堆体几何体积（网格积分）")
            return {"ok": True, "module": module, "stamp": STAMP, "result": result, "notes": notes}

        if module == "stability_infinite":
            slope_deg = float(params.get("slope_deg", 18.4) or 18.4)
            thickness = float(params.get("thickness", 10) or 10)
            c = float(params.get("c", 8) or 8)
            phi = float(params.get("phi_deg", 25) or 25)
            gamma = float(params.get("gamma", 10) or 10)
            ru = float(params.get("ru", 0.2) or 0.2)
            beta = math.radians(slope_deg)
            # 无限边坡严格式（cos²α）：Fs=(c + γH·cos²α·tanφ)/(γH·sinα·cosα + γH·cos²α·ru)
            num = c + gamma * thickness * (math.cos(beta) ** 2) * math.tan(math.radians(phi))
            den = gamma * thickness * math.sin(beta) * math.cos(beta) * (1 + ru)
            fs = num / den if den > 1e-9 else None
            grade = physics.grade_from_fs(fs)
            notes.append("无限边坡严格式含 cos²α；Fs 分档 <1.0 red/<1.2 orange/<1.5 yellow/≥1.5 blue")
            return {"ok": True, "module": module, "stamp": STAMP,
                    "result": {"Fs": round(fs, 4) if fs else None, "grade": grade,
                                "slope_deg": slope_deg, "thickness_m": thickness,
                                "c_kPa": c, "phi_deg": phi, "gamma_kN_m3": gamma, "ru": ru},
                    "notes": notes}

        if module == "stability_scan":
            m = _demo_model()
            p = dict(params)
            p.setdefault("n_sections", 5)
            p.setdefault("n_grid", 6)
            p.setdefault("n_R", 4)
            r = physics.analyze_stability(m, p)
            result = {"Fs_min": r["data"]["key_numbers"]["Fs_min"],
                       "best": r["data"].get("best"), "grade": r.get("grade")}
            return {"ok": True, "module": module, "stamp": STAMP, "result": result,
                    "notes": notes + r.get("notes", [])}

        if module == "settlement":
            r = physics.analyze_settlement(None, params)
            # 四口径字段平铺（k3d-check ③ 读 S_production_m / ratio_legacy_over_prod / t90_a）
            result = dict(r["data"]["key_numbers"])
            result["summary"] = r["summary"]
            return {"ok": True, "module": module, "stamp": STAMP, "result": result,
                    "notes": notes + r.get("notes", [])}

        if module == "pollution_chain":
            m = _demo_model()
            r = physics.analyze_pollution(m, params)
            result = dict(r["data"]["key_numbers"])
            result["summary"] = r["summary"]
            result["table"] = r["data"]["table"]
            result["time_options"] = r["data"]["time_options"]
            return {"ok": True, "module": module, "stamp": STAMP, "result": result,
                    "notes": notes + r.get("notes", [])}

        return {"ok": False, "module": module, "stamp": STAMP,
                "error": f"未知 module：{module}（可用 capacity/stability_infinite/stability_scan/settlement/pollution_chain）"}
    except Exception as e:  # 内核自身错误也回 ok=false JSON（不抛）
        return {"ok": False, "module": module, "stamp": STAMP,
                "error": f"内核异常：{type(e).__name__}: {e}"}


def _area(m):
    import numpy as np
    base = m.base_surface()
    top = m.top_surface()
    return float(np.nansum((top - base) > 0.05) * m._cell_area())


def np_nansum(a):
    import numpy as np
    return float(np.nansum(a))


def main() -> None:
    try:
        raw = sys.stdin.read()
        cfg = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        print(json.dumps({"ok": False, "stamp": STAMP, "error": f"入参 JSON 解析失败：{e}"}))
        return
    out = handle(cfg)
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")


if __name__ == "__main__":
    main()
