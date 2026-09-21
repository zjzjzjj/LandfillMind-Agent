# LandfillMind · 填埋场全周期工程智能体 v5.0

> **v5 架构**：以 **Tool 为中心**的工程智能体。一切工程能力（OGS 数值模拟 / 3D 建模 / 工程计算 / 多智能体深度分析 / 知识库 / 报告生成）都是可被对话动态调用的 Tool，由统一工具层（`server/tools.ts`）调度，带**参数出处、范围校验、运行记录落库（可追溯）**。专家问答模块已并入统一"智能体对话"。

## 核心能力

| 模块 | 说明 |
|------|------|
| **智能体对话（唯一入口）** | 说一句话即可调用全部工具：`用 OGS 模拟 500 万吨填埋场 20 年产气` / `综合评估场地风险` / `建一个缓坡山谷型 500 万 m³ 的填埋场` / `算一下边坡安全系数` |
| **统一工具层（v5）** | `run_ogs_scenario` / `build_scene` / `analyze_site` / `calculate` / `kb_lookup` / `run_diagnosis` / `deep_analysis` / `generate_report` / `run_3d_kernel`，统一 `ToolRun` 信封（参数出处 USER/FROM_TEXT/ESTIMATED/DEFAULT + 范围校验 + runId 可追溯） |
| **多智能体深度分析** | 任务型研究循环：Parameter Agent 参数阶段 → 4 领域 Agent（边坡/渗滤液/填埋气/地下水）**真实调用工程工具** → 总工综合研判（确定性最差等级 + **参数敏感性扫描**）→ LLM 报告；LRU 缓存 + 启动预热 |
| **AI 快诊** | 输入场地监测数据 → 双引擎诊断（确定性阈值 + LLM 解释）→ 红/橙/黄/蓝四级风险报告（`run_diagnosis` 工具） |
| **稳定化计算（OGS）** | 确定性数值内核：产气（ADM1）/ 降解 / 沉降（Terzaghi），可对话触发、可 GUI 操作，同一引擎 |
| **AI 生成 3D 场景** | 对话输入"建一个缓坡山谷型 500 万 m³ 的填埋场" → `build_scene` 工具 → 8 维 GeoParams。注：v5.3 起经典风格化示意场景页（`/scene-classic`）随两个 3D 入口合并而退役，卡片按钮改指 `/tool` 的内核真实几何 |
| **三维建模分析（核心）** | 侧边栏「三维建模分析」（`/tool`，**全屏**）= 桌面工具（Landfill 3D Tool v1.7.0）的 1:1 Web 复刻，**同时是查看器与建模分析工作台**（v5.3 起与原「3D 模拟」合并 —— 两者渲染的本就是同一份会话几何）。界面照桌面骨架：菜单栏（工程/帮助）+ 品牌条 + 工具栏 + [左栏参数控制台 400px ｜ 中央图形区 ｜ 右侧结果条 340px] + 状态栏；左栏四页签与桌面页一一对应（建模 / 计算[库容·坡度·剖面·沉降·稳定性] / 污染 / 开挖）；中央 9 视图条 + 子视图条 + three.js 真实三维网格（旋转/缩放/剖切/线框/垂直夸张/⑥三维显示 叠加层）；开挖页带**画布**（拖线切割/点边设坡比/一键四区/撤销，几何内核真算）、**逐阶段开挖**、**测点散点建模**（粘贴/CSV）、**打开与另存工程**、**导出当前图 PNG 300dpi / PDF / SVG / 底层数据 CSV**、Excel/Word 报告；计算直驱内核（`POST /api/kernel3d/run`，落 tool_runs，带口径戳），建模即时刷新三维 |
| **权威内核 3D Tool（同机）** | `run_3d_kernel` 两条分支：`module=` 内置示例场五模块快查（capacity/stability/settlement/pollution_chain，physics 口径守卫）；`action=` 自定义场地会话模式——对话建模/增量改模（rect/poly/多单元/分级开挖/内置示例场 `spec.demo`）→ 稳定性扫描 / 沉降 / 开挖 / 污染全链路，结果带**准确分析 PNG 图与可下载简报**，"在 3D 场景查看"改指 `/tool`。配置 `KERNEL3D_REPO_PATH` / `KERNEL3D_PY`（见 .env.example），未配置返回可读错误信封 |
| **工程报告** | `generate_report` 工具 / `POST /api/report`：从 tool_runs 可追溯记录组装报告（执行摘要/输入参数含出处/结果与分级），复制 Markdown / 下载 .md / .json |
| **实时 IoT 感知** | 嵌入式 MQTT broker + 5 个 mock 传感器（CH₄/H₂S/水位/沉降/温度），3D 仿真器实时监测面板按阈值分级 |
| **计算工具库（附属）** | 原"计算中心"降级为附属工具库；14 项计算器作为 `calculate` 工具的核心（参数元数据单一来源 `server/calc-meta.ts`） |

---

## 工具层架构（v5）

```text
智能体对话（唯一入口）
        │  单 agent 人格 + 模型选择
        ▼
Server · Tool Loop（真 function calling / 规则兜底）
        ▼
execTool(name, args, ctx)  ← 统一调度器（server/tools.ts）
   ├── run_ogs_scenario  → server/ogs.ts（OGS 确定性内核 + 原生 exe）
   ├── build_scene       → server/scene-builder.ts（8 维 GeoParams + OGS 联动）
   ├── analyze_site      → geo.ts estimateSite（库容/占地确定性分析）
   ├── calculate         → CALC_REGISTRY（14 计算器，参数元数据单源 calc-meta.ts）
   ├── kb_lookup         → retrieval.ts 混合检索
   ├── run_diagnosis     → diagnose.ts 双引擎
   ├── run_3d_kernel     → kernel3d.ts（module 快查走 stdin 桥；action 会话模式 spawn
   │                       Landfill 3D Tool/agent_bridge.py 文件桥 + 产物路由 /api/kernel3d/*）
   ├── deep_analysis     → multiagent.ts 多智能体深度分析（内部真调上述工具）
   └── generate_report   → report.ts（tool_runs → Markdown/sections）
        ▼
统一契约 ToolRun（参数出处 + 范围校验 + 结果 + 耗时）→ tool_runs 落库（可追溯）
```

- **参数出处**：`USER_DEFINED`（用户指定）/ `FROM_TEXT`（文本提取）/ `ESTIMATED`（智能体估算）/ `DEFAULT`（默认值）/ 越界自动收敛并告警
- **多智能体深做**：4 领域 Agent 不再"写死单点计算"，而是真实调用 `calculate` / `run_ogs_scenario` / `kb_lookup`，每一步产出可追溯步骤链；summary 含参数敏感性扫描
- **兼容**：无工具能力的模型（通道B 规则兜底）走同一 `execTool`，产出同构工具卡片，不误伤普通咨询

---

## 稳定化计算（确定性数值内核）

> 数值内核以 OpenGeoSys 5.5 官方算例（Data XCFei 三案例的 ADM1 生化反应模型）为基准复刻标定；Windows 本机可另调原生 `ogs.exe` 做有限元校核。全部场景**秒出结果、跨平台可部署**（Render Linux 容器同样可用）。

- **三大场景**：
  - `gas-production` 填埋气产气量 — ADM1 式厌氧产甲烷模型，CH₄/CO₂/H₂S/H₂ 全组分日分辨率曲线、累计产量、占比、发电/减排潜力
  - `degradation` 有机物降解 — 易/难降解纤维素、VFA、细菌浓度随时间的降解动力学曲线
  - `settlement` 堆体固结沉降 — Terzaghi 一维固结解析解 S(t)=S∞·[1−exp(−t/τ)]，刚度越大固结越快
- **对话触发**：智能体对话里输入 `模拟产气` / `有机物降解曲线` / `沉降模拟` → `run_ogs_scenario` 工具自动执行并注入 AI 回答
- **原生求解器（可选）**：Windows 下用仓库内置 `OGS/bin/ogs.exe`；Linux 容器自动降级为解析内核并在状态徽标注明

---

## AI 生成 3D 场景（v4.3）

在**专家问答**里输入建场/改场意图，系统自动生成 3D 场景参数（GeoParams）：

```text
"建一个缓坡山谷型 500 万 m³ 的填埋场"     → 山谷 1.2× + 缓坡 0.7× + 库容 500 万 m³
"把堆体放缓到 1:3"                        → 斜坡比 → 堆高 0.8×
"重新建一个大库 + 同步算产气"             → 大型 1.6× + OGS 产气峰值 899 万m³/d 注入
"自定义 valleyWidth=1.5, pileHeight=1.6"  → key=value 精确参数
```

- **双通道**：GLM/OpenRouter（默认）走确定性规则解析；CodeBuddy SDK 走真 function calling（`buildScene` 工具）
- **联动**：可选同步跑稳定化计算（OGS），把产气/沉降峰值注入场景卡片
  （v5.3：风格化场景页已退役，场景卡片的 3D 入口改指 `/tool` 的内核真实几何）
- **容错**：输出永远过 `clampGeo` 边界；规则解析失败退默认场景，不报错、不误伤普通问答

---

## 快速开始

```bash
# 1. 安装依赖
cd landfillmind
npm install

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env，填入 CODEBUDDY_API_KEY 或 DEEPSEEK_API_KEY

# 3. 启动（同时运行前后端）
npm run dev
# 前端：http://localhost:5173
# 后端：http://localhost:3000

# 4. 生产构建
npm run build
npm run server
```

### Docker 部署

```bash
docker build -t landfillmind .
docker run -d -p 3000:3000 \
  -e OPENROUTER_API_KEY=你的Key \
  -e DEEPSEEK_API_KEY=你的Key \
  landfillmind
```

---

## 技术栈

- **前端**：React 18 + TypeScript + Vite 5 + Tailwind CSS + Framer Motion + Three.js
- **后端**：Node.js + Express + tsx + sql.js (SQLite WASM)
- **AI**：智谱 GLM 直连（默认免费档）+ OpenRouter 可选（并行信号量 3 路）；CodeBuddy Agent SDK 已预埋接口待 CodeBuddy 主通道启用
- **通信**：SSE 流式推送

---

## 规范依据

覆盖 30+ 本国家/行业标准（版本口径与 knowledge-base 一致）：
`GB 16889-2008`（2024 版已发布，KB 保留 2008 关键阈值）· `CJJ 176-2012`（2025-09 废止，Fs 阈值仍被工程实践引用，见表 6.1.4 分档）· `HJ 25.1~25.6`（HJ 25.1/25.2 现行 2019 版）· `GB 36600-2018` · `GB/T 14848-2017` · `HJ 1106-2020` · `GB 55038-2025` · `AQ 4202-2008`

---

*文档版本：v4.5 ｜ 生成日期：2026-08-31*

## 上线地址（部署完成后填写）

- **Render（推荐）**：`https://landfillmind.onrender.com`
- **本地**（开发模式）：`http://localhost:5173`（前端）+ `http://localhost:3000`（后端 API）

