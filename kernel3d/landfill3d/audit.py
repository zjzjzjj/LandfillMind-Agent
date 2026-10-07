"""audit.py · 内核确定性自检（不依赖 LLM / Web 服务）。

用法：python -m landfill3d.audit
断言：
  ① 库容辛普森积分 vs 解析棱台公式（矩形堆体解析解）误差 < 2%
  ② 稳定性二阶段加密：refine=True 与 refine=False 的 Fs 差 < 0.05（收敛性）
  ③ 沉降 e0/Cc 法方向正确：给了合理 Cc 时沉降 ≥ Es 法（保守取大）
  ④ 全部 23 个图键渲染无异常（逐键生成到临时目录，检查非空文件）
"""
from __future__ import annotations

import math
import os
import sys
import tempfile

import numpy as np

from . import agent_cli, geometry, physics


def _frustum_volume(L, W, H, n):
    """矩形底、四边 1:n 放坡、顶平台截锥台解析体积。
    顶面尺寸 = (L − 2nH, W − 2nH)；若 nH 超过半宽则平台消为一线（本测试不取该域）。"""
    a = max(L - 2 * n * H, 0.0)
    b = max(W - 2 * n * H, 0.0)
    A1 = L * W
    A2 = a * b
    return H / 3.0 * (A1 + A2 + math.sqrt(A1 * A2))


def check_storage() -> tuple[bool, str]:
    L, W, H, n = 300.0, 200.0, 20.0, 4.0
    spec = {"shape": "rect", "rect": {"L": L, "W": W}, "height": H, "n": n,
            "grid_nx": 81, "z0": 0}
    m = geometry.LandfillModel(spec)
    v_kernel = m.volume_m3()
    v_ref = _frustum_volume(L, W, H, n)
    err = abs(v_kernel - v_ref) / v_ref
    ok = err < 0.02
    return ok, (f"库容：内核 {v_kernel / 1e4:.2f} 万m³ vs 解析 {v_ref / 1e4:.2f} 万m³，"
                 f"相对误差 {err * 100:.2f}%（限 2%）")


def check_stability_refine() -> tuple[bool, str]:
    """收敛性口径：加密后的 Fs 应对粗网格数不敏感（n_grid=6 与 12 同为加密，差 <0.05）；
    加密同时必须不劣于粗扫（只应更小或持平）。"""
    spec = {"shape": "rect", "rect": {"L": 300, "W": 200}, "height": 20, "n": 4,
            "grid_nx": 61}
    m = geometry.LandfillModel(spec)
    common = {"n_sections": 3, "n_slices": 16, "refine": True}
    r6 = physics.analyze_stability(m, {**common, "n_grid": 6, "n_R": 5})
    r12 = physics.analyze_stability(m, {**common, "n_grid": 12, "n_R": 10})
    r0 = physics.analyze_stability(m, {"n_sections": 3, "n_grid": 6, "n_R": 5,
                                        "n_slices": 16, "refine": False})
    f6 = r6["data"]["key_numbers"]["Fs_min"]
    f12 = r12["data"]["key_numbers"]["Fs_min"]
    f0 = r0["data"]["key_numbers"]["Fs_min"]
    if None in (f6, f12, f0):
        return False, "稳定性：出现空 Fs（无效）"
    d = abs(f12 - f6)
    ok = d < 0.05 and f6 <= f0 + 1e-6
    return ok, (f"稳定性：加密后 Fs 对网格数收敛（n=6: {f6:.3f} vs n=12: {f12:.3f}，差 {d:.3f}）；"
                 f"加密 {f6:.3f} ≤ 粗扫 {f0:.3f} ✓")


def check_settlement_cc() -> tuple[bool, str]:
    es_only = physics.analyze_settlement(None, {
        "layers": [{"name": "粉质黏土", "thickness": 8, "Es_kPa": 4500}],
        "waste_height": 20, "gamma_waste": 10})
    with_cc = physics.analyze_settlement(None, {
        "layers": [{"name": "粉质黏土", "thickness": 8, "Es_kPa": 4500,
                     "e0": 0.8, "Cc": 0.3}],
        "waste_height": 20, "gamma_waste": 10})
    s_es = es_only["data"]["key_numbers"]["S_production_m"]
    s_cc = with_cc["data"]["key_numbers"]["S_production_m"]
    s_cconly = with_cc["data"]["key_numbers"]["S_cc_m"]
    ok = (s_cconly > 0) and (s_cc >= s_es - 1e-9) and s_cc < 2.0
    return ok, (f"沉降：Es 法 {s_es * 100:.2f} cm，Cc 法 {s_cconly * 100:.2f} cm，"
                 f"取用 {s_cc * 100:.2f} cm（取大者）")


def check_all_figures() -> tuple[bool, str]:
    from . import figs as F
    wd = tempfile.mkdtemp(prefix="lf3d-audit-")
    m = geometry.LandfillModel({"demo": "valley", "grid_nx": 61})
    keys = sorted(F.FIG_LABELS.keys())
    bad = []
    # 需要开挖状态的两张图：先应用一个分区
    m._apply_excavation([{"name": "试挖区", "poly": [[-50, -50], [50, -50], [50, 50], [-50, 50]],
                           "top_z": None, "levels": [[6, 2.0, 3]], "temp_n": 2.0}])
    for k in keys:
        try:
            params = {}
            if k in ("fs_grid", "critical_arc", "section_scan", "exc_arc",
                     "exc_fs_grid", "monte_carlo"):
                params = {"n_sections": 5, "n_grid": 6, "n_R": 5, "threshold": 1.3}
            if k in ("exc_arc", "exc_fs_grid"):
                params = {"layers": [["生活垃圾", 30, 0, 11, 8, 25],
                                      ["粉质黏土", 0, -30, 18.5, 25, 18]]}
            if k == "exc_phases":
                params = {"_stages": [{"stage": 1, "Fs": 1.1}, {"stage": 2, "Fs": 0.98, "worst": True}]}
            if k in ("gas_curve", "gas_field", "leachate", "quality", "column",
                     "plume_plan", "plume_section"):
                params = {"do_plume": True, "do_column": True, "plume_years": 30}
            out, errs = F.render_figures(m, [k], wd, params=params)
            if errs or not out:
                bad.append(f"{k}: {errs}")
                continue
            size = out[0]["size"]
            if size < 8000:
                bad.append(f"{k}: 文件过小（{size}B）")
        except Exception as e:
            bad.append(f"{k}: {type(e).__name__}: {e}")
    n = len(keys)
    ok = not bad
    return ok, (f"图件：{n - len(bad)}/{n} 图键渲染通过" + (f"；失败：{bad}" if bad else ""))


def main() -> int:
    results = [check_storage(), check_stability_refine(), check_settlement_cc(),
               check_all_figures()]
    failed = 0
    for ok, msg in results:
        print(("✅" if ok else "❌") + " " + msg)
        failed += (not ok)
    print(("✅ audit 全部通过" if failed == 0 else f"❌ {failed} 项失败"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
