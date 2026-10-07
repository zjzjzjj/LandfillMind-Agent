"""style.py · 图件统一视觉风格。

所有图函数经由本模块出图：
  - apply_style()      rcParams 统一（字号/网格/去顶右 spine/调色板）
  - adaptive_figsize() 按数据纵横比自适应图幅（根治宽扁数据"带状大留白"）
  - finish(fig, site, title) 统一标题「场地名 · 图名」+ 右下角口径戳脚注
  - PALETTE            固定 10 色调色板（各图取色统一）
"""
from __future__ import annotations

import datetime as _dt

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

for _f in ["Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC"]:
    try:
        font_manager.findfont(_f, fallback_to_default=False)
        plt.rcParams["font.family"] = _f
        break
    except Exception:
        continue

APPLIED = False

PALETTE = {
    "primary": "#1f6fb2",   # 主蓝
    "red": "#c0392b",       # 危险/CH4
    "orange": "#e67e22",
    "yellow": "#f1c40f",
    "green": "#1e8449",
    "teal": "#148f77",
    "purple": "#8e44ad",
    "gray": "#7f8c8d",
    "dark": "#2c3e50",
    "brown": "#8a7a52",     # 堆体
}

FIG_LABEL_FOOT = "landfill3d v{version} · physics={physics} · {time}"


def apply_style() -> None:
    """幂等：全部 rcParams 只设一次。"""
    global APPLIED
    if APPLIED:
        return
    plt.rcParams.update({
        "figure.dpi": 150,
        "savefig.dpi": 150,
        "axes.titlesize": 12,
        "axes.titleweight": "bold",
        "axes.labelsize": 10,
        "axes.labelcolor": "#2c3e50",
        "axes.edgecolor": "#aab4be",
        "axes.linewidth": 0.9,
        "axes.grid": True,
        "grid.alpha": 0.25,
        "grid.linewidth": 0.6,
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "legend.fontsize": 8.5,
        "legend.framealpha": 0.92,
        "legend.edgecolor": "#c8d0d8",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.unicode_minus": False,
        "lines.linewidth": 1.6,
        "lines.markersize": 4,
    })
    APPLIED = True


def adaptive_figsize(dx: float, dy: float, base_w: float = 8.6,
                     h_min: float = 3.2, h_max: float = 7.0) -> tuple[float, float]:
    """按数据纵横比给 figsize：宽扁数据不再被压成横条（等 aspect 下的通病）。"""
    try:
        ratio = float(dy) / max(abs(float(dx)), 1e-9)
    except Exception:
        return (base_w, 5.0)
    h = base_w * max(ratio, 0.12) * 0.82   # 0.82：给标题/色条留边
    return (base_w, float(min(max(h, h_min), h_max)))


def finish(fig, site: str, title: str, stamp: dict | None = None,
           pad: float = 1.0) -> None:
    """统一标题 + 右下角口径戳脚注。所有图函数保存前调用。"""
    apply_style()
    full = f"{site} · {title}" if site else title
    fig.suptitle(full, fontsize=12, fontweight="bold", y=0.985)
    try:
        from . import STAMP
        st = stamp or STAMP
        foot = FIG_LABEL_FOOT.format(
            version=st.get("version", "?"), physics=st.get("physics", "?"),
            time=_dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
        fig.text(0.995, 0.005, foot, ha="right", va="bottom",
                 fontsize=6.5, color="#9aa5af")
    except Exception:
        pass
    fig.tight_layout(rect=(0, 0.022, 1, 0.96), pad=pad)


def save(fig, path: str, dpi: int = 150) -> None:
    fig.savefig(path, dpi=dpi)
    plt.close(fig)
