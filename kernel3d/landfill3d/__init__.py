"""landfill3d — 填埋场三维建模分析计算内核（Landfill 3D Tool 重建版）。

对 LandfillMind Web 端的契约：
  1) stdin 桥  python -m landfill3d.cli   （module= 示例场快查 + physics 口径守卫）
  2) 文件桥    agent_bridge.py --input/--output/--workdir（action= 会话模式）

口径戳 stamp = {version, physics, kernel}；physics=v170 生产口径。
"""

VERSION = "1.7.2-rb"      # 重建版（rebuild）版本号
PHYSICS = "v170"          # 生产口径；v160 已废弃，守卫拦截
KERNEL_NAME = "landfill3d"

STAMP = {"version": VERSION, "physics": PHYSICS, "kernel": KERNEL_NAME}
