#!/usr/bin/env python3
"""agent_bridge.py · Landfill 3D Tool 文件桥入口。

用法（server/kernel3d.ts 调用方）：
  python agent_bridge.py --input in.json --output out.json --workdir runDir

成功/失败都写 out.json（ok=false 带可读 error）；stdout 只作日志兜底。
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from landfill3d import agent_cli  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--workdir", required=True)
    args = ap.parse_args()
    os.makedirs(args.workdir, exist_ok=True)
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        out = {"ok": False, "summary": f"in.json 解析失败：{e}", "error": str(e),
               "figures": [], "files": [], "notes": [], "elapsed_ms": 0}
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
        return 1
    result = agent_cli.run(cfg, args.workdir)
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, default=str)
    os.replace(tmp, args.output)
    # stdout 兜底通道：单行 JSON（CLI 落盘失败时服务端解析它）
    sys.stdout.write(json.dumps(result, ensure_ascii=False, default=str) + "\n")
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
