# Changelog · LandfillMind 填埋场全周期智能体

## v5.1（2026-09-13 · 多智能体重构：从"4 条硬编码流水线"到"证据驱动 + 交叉研判"）

> **问题定性**：v5.0 的多智能体模块声称"4 领域 Agent 真实调用工程工具 + 总工研判"，
> 但工具算出的数字对评级**零影响**，评级完全由正则提取的指标驱动，而这些正则又都带
> DEMO 形状的兜底默认值。直接后果：**红、绿两个等级在整个模块内不可达**；
> 同一次运行里边坡卡片显示 `Fs=1.64（满足）`、总工敏感性显示 `基准 Fs=0.68`；
> 随机输入一个不含裂缝/氯离子的场景，界面照样写"提取场景指标：裂缝 12m、Cl⁻ 50→280mg/L"。
> 根因是阈值口径各写一套 —— 而 `server/diagnose.ts` 里**已经有做对的、且已导出的**版本。

### a. 架构：阈值收口到唯一来源

- **新增 `server/indicators.ts` 指标提取层**：显式表单 > 文本正则 > LLM 抽取 > 典型值估算，
  每项带出处（USER_DEFINED / FROM_TEXT / ESTIMATED）与命中原文片段。
  **监测指标缺测即缺测，绝不用默认值补**；只有材料/设计参数（γ/c/φ）允许典型值兜底。
- **新增 `server/domains.ts` 领域规格层**：4 段各 ~80 行的 if-else 换成声明式 `DomainSpec`，
  公共流程由 `runDomainAgent` 统一执行。加维度 = 加一条 spec。
- **新增 `server/cross-analysis.ts` 交叉研判层**：4 条确定性工程耦合规则
  （水位抬升×边坡失稳 / 渗滤液高负荷×Cl⁻超标 / 甲烷超限×敏感点邻近 / 沉降超限×裂缝），
  每条给出命中判据、耦合机理与联合处置，**不交给 LLM 自由发挥**。
- **评级唯一化**：领域等级一律取 `diagnose.evaluateHazards` 的隐患严重度
  （`deriveDomainResult` 是唯一定义处，领域 Agent 与总工汇总共用）→ 卡片与综合必然一致。
- **补 `diagnose.ts` 缺口**：`SiteData` 增加裂缝字段与「堆体表面裂缝」隐患规则
  （裂缝是滑坡前兆，此前 DEMO 场景里的 12m 裂缝**完全没被评估**）；
  导出 `SEVERITY_RANK` / `maxSeverity` 供多智能体复用。

### b. 统一边坡稳定内核（口径合并）

- `calculate.ts` 新增 `stabilityDetail()`：标准无限长坡公式，`calculateStabilityFactor`
  （快诊）与 `slopeFs`（计算中心）**委托同一内核**。
- **修 `slopeFs` 的 `atan(1/β)/2`**：叠加调用方的度数→坡比换算后，实际按**一半坡角**在算，
  Fs 系统性偏高。同工况下旧版 1.64、内核 0.68，相差 2 倍以上。
  （旁证：知识库提示词里写的 `α=arctan(1/3)≈18.43°` 本来就是不带 `/2` 的正确值。）
- `DesignPage` 删除前端的**第三份**公式实现，计算书改为呈现后端返回的中间量。

### c. 工具参数真正接线（"假多智能体"的根治）

| 领域 | v5.0（写死常量） | v5.1 |
|---|---|---|
| 边坡 | γ=11/c=15/φ=35 | 取指标，缺则典型值 + ESTIMATED |
| 渗滤液 | 面积30万㎡/降雨1200mm/径流0.3 | 面积（或长×宽）/降雨量/按覆盖类型推定 |
| 填埋气 | 垃圾量500万t/龄期10a | 面积×堆高×密度估算 / 填埋龄期 |
| 地下水 | C0=280/v=0.1/x=200/D=10 | Cl⁻实测 / 地下水流速 / 敏感点距离 |

→ 改场景重跑，卡片数字会随场景变化。

### d. 修掉的确定性缺陷

1. 领域等级改由 evaluateHazards 派生 → **红/绿两级可达**（旧实现二值逻辑永远出不了）
2. 地下水 Cl⁻ 等级**倒挂**修复（旧：`clConc>=clBg*2 → blue`，低于未超时的 yellow）
3. 总工不再用正则重算等级、而是取各领域真实等级（旧：两处阈值字面量会漂移）
4. 敏感性扫描与边坡卡片同源；「±20%」标签与实际扰动幅度一致（旧：水位用 ×0.6/×1.6）
5. 缺测的监测指标不再冒充"提取到的实测指标"（旧 `grab(re, 12)` 等兜底值）
6. `Number.isFinite(parseScenario().clConc)` 恒真的 FROM_TEXT 标注修复
7. `paramOrigin` 恒返回 USER_DEFINED 修复（normalizeParams 总会填默认值）
8. 分析失败不再伪装成 `'yellow'`，改为 `unknown`（数据不足）
9. `domainRes.every()` 空数组恒真 → 全失败时报"命中缓存"修复
10. `timeout()` 只 race 不取消 → 透传 `AbortSignal` 到 `llmComplete`，让出 GLM 串行队列
11. 缓存键漏 `detail` → 切"详细"会命中"摘要"缓存，修复
12. **预热一直失效**（根因是换行符，不是逻辑）：`DEMO_SCENARIO` 在 `server/multiagent.ts` 里是 LF、
    在 `src/pages/MultiAgentPage.tsx` 里是 CRLF，两处肉眼看"完全一致"、实际差 3 个字符，
    而缓存键按原文拼接 → 前端提交的键与预热写入的键永远对不上。
    修法不是"手动让两处一致"（换个编辑器又会漂移），而是**缓存键做空白归一化**
    （分析结果本就与空白无关），并对 CRLF/LF、缩进、尾随空格全部免疫。
    v5.0 曾用 origins 指纹"修"过这个问题，实际是南辕北辙（指纹本身还让预热对 `deep_analysis` 路径失效）。
13. `cachedAt` 用命中时刻冒充落缓存时刻，修复（改存真实落缓存时间）
14. `mk(...,'running')` 步骤永不置 done（对话页永久转圈），修复
15. `callTool` 不透传 sessionId → 深做分析的工具调用落 `session_id=NULL` 取不到，修复
16. `/api/multiagent` 从 body 解构了 `peerResults` 却**从未传给总工** → 总工一直盲汇总，修复
17. 领域间 site 隔离（旧：无隔离，边坡注入的典型堆高会串到填埋气估算）

### e. 前端

- 仪表盘新增 `unknown` 态：**未分析时不再显示"综合风险：正常"**（旧：初始恒全绿）
- 领域卡片新增数据置信度徽章、「本次缺少实测：…」提示条、命中隐患（判据+规范依据）、
  可展开的**证据链**（工具 / 入参含出处 / 结果 / 规范依据）
- 总工卡片新增**复合风险**区块（命中规则 + 判据 + 机理 + 联合处置）
- 导出报告补齐等级表、隐患判据、证据链、复合风险（旧：只有 LLM 散文）

### f. 自检

- `npm run smoke:multiagent`（新增 `scripts/multiagent-smoke.ts`）：20 条确定性断言，
  覆盖上述 1/3/4/5/6/8/11/12 等缺陷的防回归，**不依赖 LLM key** 即可运行。

### g. 验证记录（2026-09-13，Node 22.23.2 实机）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc -b` | ✅ 退出码 0 |
| 前端构建 | `npm run build` | ✅ 15.21s 产出 dist |
| 多智能体自检 | `npm run smoke:multiagent` | ✅ 20/20 |
| 工具层冒烟 | `npm run smoke:tools` | ✅ 全部通过 |
| 领域 Agent 端到端 | `POST /api/multiagent`（slope） | ✅ 出处徽章正确（USER_DEFINED/FROM_TEXT/ESTIMATED 三类并存），Fs=0.68，判 red |
| 总工 + 交叉研判 | `POST /api/multiagent`（summary） | ✅ 两条复合风险规则命中并给出判据；敏感性基准 Fs=0.68 **与边坡卡片同值** |
| 预热命中 | 重启后以**前端 CRLF 原文**请求 | ✅ 0.526s 命中，`cachedAt` 为真实落缓存时刻 |
| 详细度隔离 | 同一场景切 `detailed` | ✅ 未误命中 `standard` 缓存（旧版会） |
| 无 LLM 降级 | `smoke:tools` 的 deep_analysis（脚本不加载 .env） | ✅ 43ms 完整产出分级结论，走确定性模板 |

### ⚠ 口径变化提示

统一内核后**计算结果会变**（这是修复的目的，不是回归）：

- **DEMO 场景**：H=25m、β=30°、水位埋深 10m 下，边坡 Fs 由 `1.64` 变为 **`0.68`**，
  边坡等级变为**重大风险**，综合等级由"较大"变为**"重大"**。
  手工复核：即便取 c=0、φ=35° 的无黏聚力工况，30° 坡在 40% 浸水条件下 Fs 也仅 0.55，
  说明 0.68 是该公式的正常输出。
- **计算中心 `/api/calc/slopeFs`**：同一输入的 Fs 会明显下降（旧实现按一半坡角计算）。
  若既有报告引用了旧值，需要一并更新。

## v5.0（2026-09-07 · 以 Tool 为中心的工程智能体重构）

> **架构重塑**：从"按页面堆能力的 Agent"变为**以 Tool 为中心的工程智能体**。
> 一切工程能力（OGS / 3D 建模 / 工程计算 / 多智能体深度分析 / 知识库 / 报告）都是可被对话动态调用的 Tool，
> 统一由 `server/tools.ts` 调度，带**参数出处、范围校验、运行记录落库（可追溯）**。

### a. 统一工具层（新）

- **`server/tools.ts`**：`execTool` 统一调度器 + `ToolRun` 信封（runId / 参数出处 / 结果 / 耗时 / 警告）+ `resolveParams` 参数解析（USER_DEFINED / FROM_TEXT / ESTIMATED / DEFAULT，越界自动收敛并告警）
- **8 个工具注册**：`kb_lookup` / `calculate`（14 计算器）/ `run_ogs_scenario`（三场景）/ `build_scene`（8 维 GeoParams + OGS 联动）/ `analyze_site`（库容/占地）/ `run_diagnosis`（双引擎）/ `deep_analysis`（多智能体深做）/ `generate_report`（工程报告）
- **对话工具循环通用化**（`server/index.ts`）：通道A 真 function calling 按工具名分派；通道B 规则兜底映射到同一 `execTool`；SSE 事件带 `agent_step` 实时进度（"正在调用 OGS…"）
- **参数元数据单一来源** `server/calc-meta.ts`：14 计算器参数 label/unit/default/min/max 收敛（消灭 DesignPage 硬编码与注册表默认值双源漂移）
- **可追溯落库**：新表 `tool_runs`（`server/db.ts`）+ `POST /api/report` + `generate_report` 工具（Markdown / sections / JSON，含参数出处）
- `GET /api/tools/meta`：工具注册表对前端暴露

### b. 多智能体深度分析（重写 `server/multiagent.ts`）

- 从"4 个文案生成器"升级为**任务型研究循环**：
  - **Parameter Agent 阶段**：参数提取 + 出处标记
  - **领域 Agents 真实调用工具**：`slope`→calculate(slopeFs)、`leachate`→calculate(leachateCalc)、`lfg`→run_ogs_scenario(gas-production)+calculate(lfgYield) 交叉核对、`gw`→calculate(advect)，每一步产出可追溯步骤链
  - **summary 总工研判**：确定性最差等级 + **参数敏感性扫描**（单因素 ±20%，识别主导参数）+ LLM 综合报告
- `deep_analysis` 工具：对话内可直接触发（SSE 流式研究过程），LRU 缓存 + 启动预热保留，出处并入缓存 key 防污染

### c. 统一智能体对话（专家问答模块并入）

- 删除专家 persona 体系：`useAgents` 收敛单一工程智能体；删"追问专家"跳转与 `chat-prefill-expert`
- 聊天页 = 唯一前端入口（侧边栏置顶"智能体对话"）；工具卡片支持 OGS / 3D / 计算 / 诊断 / 深做 / 报告六类 + **参数与出处徽章**
- 计算中心降级为附属"计算工具库"（菜单置底，功能保留）

### d. 修复 / 工程

- **P0-1**：多智能体仪表盘恒全绿 → `agent_result` 的 grade 写入 state
- **P0-2**：adminAuth 硬编码开发 token → 未配置 ADMIN_TOKEN 时管理端点整体 503；token 比较改 `timingSafeEqual`、去 query 通道
- **P0-3**：db.ts 信号处理器抢跑丢 SIGTERM 前数据 → 落盘/清锁并入 gracefulShutdown
- `/api/agent-cache/clear` 加 adminAuth 保护；`/api/health` 版本号读 package.json（5.0.0）
- 冒烟脚本 `scripts/tool-smoke.ts`：8 工具信封 / 出处 / 越界 / 规则映射 / 报告生成全量自检

## v4.6（2026-08-31 · 3D 建模重构：梯级放坡堆体）

> 重构三维建模本体（非光影）：移除氛围雾，把原"垂直台阶平盒堆体"重建成**带 1:3 放坡的真实梯级堆体**。

### 建模重构
- **截锥台几何（tpGeometry）**：堆体每层为"顶面平台 + 四周 1:3 放坡"的截锥台，相邻层顶面形成作业平台（马道），整体呈真实填埋场放坡台阶形态
- **层间土壤覆盖带**：每层平台边缘加浅色土壤覆盖，形成水平分带（中间覆盖层）
- **作业面**：顶面一侧保留裸露垃圾单元（未覆土）+ 作业自卸车停在作业面上
- 终场覆盖（土壤层+植被层）保留在封场顶面
- **移除背景迷雾**（按用户要求），不再做光影类调整


## v4.5（2026-08-31 · 3D 模块全面升级：AI 对话建模 + 性能自适应 + 数字孪生）

> **仿真器内嵌 AI 建模助手：** 在 3D 仿真器里直接用自然语言调整模型、调用工程计算器与 OGS 数值模拟，结果实时可视化——建模 → 计算 → 模拟全部闭环在同一页面。

### a. 新增能力

- **AI 建模助手（server/scene-chat.ts + src/components/SceneChatPanel.tsx，全新）**
  - 仿真器右下角内嵌对话面板：输入自然语言即可调整 3D 模型
  - 意图路由：相对调整（把堆体调高/调低/扩大/缩小，当前值±步进）／绝对设定（调到 1.2）／预设切换（小型/大型/默认）／全新建模（建一个缓坡山谷型…）
  - 联动：检测到"产气/沉降/降解"自动跑 OGS 并注入 3D（火炬增强/堆体下沉）；检测到"边坡 Fs/库容/渗滤液/HDPE…"自动跑计算器
  - 智能消歧：纯调整不误触发计算；"模拟产气"只跑 OGS 不重复算 LandGEM
  - AI 回复：有 API Key 时 LLM 生成自然语言（"堆体已调高至 1.15 倍，产气峰值 899 万 m³/d"），无 key/失败自动回退模板
  - 结果卡片：3D 场景变更／OGS 峰值／计算器结果分色展示
- **性能自适应（画质三档）**：低/中/高/自动——pixelRatio / 抗锯齿 / Bloom / 阴影贴图 / 云量分级；仿真器左侧新增画质选择器；低档关 Bloom+阴影（软件渲染 FPS 2.2→2.7，真机 GPU 差异更大）
- **IoT 数字孪生感知层**：5 个传感器按真实世界坐标渲染为"地面锚环+立柱+发光点"，颜色随实时风险等级（绿/黄/橙/红）+呼吸脉冲；新增"实时传感器"图层开关；火炬高度由真实 CH₄(%LEL) 驱动、池体液位由渗压水位驱动
- **传感器面板收起/展开**：悬浮面板可收起为一行紧凑摘要（连接状态+5 色点）
- **健壮性**：页面隐藏暂停渲染（恢复不跳变）；WebGL 上下文丢失 preventDefault

### b. 修复 / 工程

- 3D 组件 quality 未进 effect 依赖导致切画质不生效 → 已修复
- 版本号残留 v4.2 统一为 v4.5（侧边栏/首页/设置/海报/诊断页）
- **库容标定修正（单独项）**：estimateSite 基准由旧 75.5 万 m³ 修正为 **500 万 m³**（与 scene-builder 解析器 volWan/500 基准一致），并让库容随谷宽²×堆高×库容系数实时联动——默认几何=500 万、调高堆体=575 万、缓坡山谷 500 万≈504 万、大型场≈1498 万；新增 6 条标定回归断言（scene 测试 47→53）
- **3D 模型按库容比例缩放（续）**：堆体线性尺寸乘 ∛volumeScale（库容立方根），使堆体体积严格随库容比例缩放——小型场 hx 42.7 / 默认 87.6 / 大型场 122.4，几何体积比与库容比吻合（≈0.12× / 1× / 2.92×）；谷底平台同步放大保证堆体坐落在平地上，覆盖/垃圾坝/风险层/标签随堆体自动联动
- 新增端点 POST /api/scene/chat（建模+计算+OGS 一站式）

### c. 演示路径（评审 90 秒）

```
打开「3D 模拟」→ 右下角 AI 建模助手
"把堆体调高"              → 模型实时重建（滑块 1.0→1.15）
"模拟一下产气"            → OGS 卡片：峰值 899 万 m³/d + 火炬增强注入 3D
"算一下边坡安全系数"      → 计算卡片：Fs=3.09
"建一个缓坡山谷型 500 万 m³ 的填埋场" → 全新建模
右上角实时监测面板 → 收起/展开 + 5 传感器风险色点
左侧「画质」低/中/高 切换
```


## v4.4（2026-08-31 · IoT 实时传感器 + 3D 渲染增强 + broker 启动修复）

> **数字孪生感知层落地：** 3D 仿真器右上角新增实时 IoT 传感器面板（嵌入式 MQTT broker + 5 个 mock 传感器），CH₄/H₂S/水位/沉降/温度五维数据流实时推送，按规范阈值自动分级（绿/黄/橙/红）。

### a. 新增能力

- **IoT 实时数据流（server/iot.ts + src/hooks/useSensors.ts + src/components/SensorPanel.tsx，全新）**
  - 嵌入式 aedes MQTT broker：动态端口探测（默认 1886，被占自动 +1）
  - 5 个 mock 传感器按真实量级定时发布：CH₄(%LEL) / H₂S(ppm) / 渗压水位(m) / 沉降(mm/d) / 堆体温度(℃)，含告警/危险阈值分级
  - 双端点：`/api/iot/snapshot`（首屏快照）+ `/api/iot/stream`（SSE 实时流，15s 心跳保活）
  - 前端 SensorPanel 悬浮于 3D 仿真器右上角：数值 + 风险色卡 + 连接状态 + 相对时间
- **3D 渲染电影感增强（src/components/LandfillScene3D.tsx）**
  - IBL 环境光：PMREMGenerator + RoomEnvironment 程序生成，PBR 材质即时反射，0 网络依赖
  - UnrealBloomPass 辉光：火炬/告警灯真实发光 + OutputPass 色调映射/sRGB 校正
  - 动画循环与截图导出统一走 composer 管线；resize 同步适配
- **测试**：`npm run test:iot`（10 条断言：阈值分级边界 / 数据形态 / 快照完整性 / 发布订阅回放 / 优雅关闭）

### b. 修复（P0 · broker 启动挂死）

- **aedes 1.x 必须经 `Aedes.createBroker()` 初始化**：原 `new Aedes()` 未初始化 persistence，broker 接受 TCP 连接但**不响应 MQTT 握手** → mock 发布端永远连不上 → `startIotBroker` 挂死 → **整个服务启动被卡死**。已改为 `createBroker()`，并给发布端连接加 3s 超时兜底（broker 异常时降级为快照数据流，不阻塞服务）。
- 版本号统一为 v4.4（package.json / README / 后端启动横幅）
- iot.ts 端口注释修正（1884 → 默认 1886）

### c. 演示路径

```
打开「3D 仿真器」→ 右上角实时监测面板：5 个传感器数值/风险色/连接状态实时跳动
"建一个缓坡山谷型 500 万 m³ 的填埋场" → AI 生成 3D 场景卡片 → 跳转渲染
```

## v4.3（2026-08-30 · AI 生成 3D 场景 · buildScene 落地）

> **差异化创新：说话就能建 3D 场。** 用户在专家问答里输入"建一个缓坡山谷型 500 万 m³ 的填埋场"，系统即把自然语言/结构化参数解析为 8 维几何参数（GeoParams），一键跳转三维仿真器渲染；可选同步触发稳定化计算（OGS）并把产气峰值注入场景卡片。

### a. 新增能力

- **AI 生成 3D 场景（server/scene-builder.ts，全新）**
  - 三态意图：`preset`（small/large 预设）/ `custom`（GeoParams 子集）/ `natural`（自然语言推荐）
  - 确定性规则解析器 `DEFAULT_NL_PARSER`（兜底 + 兼容通道主引擎）：
    - 斜坡比映射：`1:3` → 缓坡堆高 0.8×，`1:2` → 陡坡 1.4×
    - 中文数字：`五百万 m³` → volumeScale≈1.0
    - key=value 自定义：`谷宽=1.5 堆高=1.6`
    - 规模词：小型 0.3× / 大型 1.6× 等 8 维全覆盖
  - 输出永远过 `clampGeo`（绝不越界，验收 A5）；OGS 失败静默（不阻塞、不报错，验收 A4）
- **双通道接入（server/index.ts）**
  - **兼容通道（GLM/OpenRouter，默认）**：`hasSceneIntent` 保守判定 + 规则解析 → SSE 回放 `tool_call`(kind:'scene') + `tool_result`，无需真 function calling
  - **CodeBuddy SDK 通道**：`tools[]` 新增 `buildScene` 结构化工具体（含 8 维参数范围 schema），真 function calling 执行后回放
  - `runOgScenarioSummary`：跑 OGS 场景抽**速率系列日峰值**（gas 命中 ch4_rate=899 万m³/d / settlement 命中 -0.0199 m 最大沉降 / degradation 25.8 kg/m³，均与 OGS 黄金值一致）
- **前端**
  - `ChatPage` tool 卡片新增 **🏗 AI 生成 3D 场景** 类型：展示库容快照 + OGS 联动峰值 + "🏔 打开 3D 仿真器 →" 按钮
  - `SimulatorPage` 消费 `scene-built-v1` 跨页信令：跳转后按生成参数重建 3D + 顶部提示"🪄 AI 已生成…场景"
  - `src/types.ts` ToolCall.type 扩展 `'scene'`
- **测试**
- `npm run test:scene`：47 条断言（预设/clamp/natural/OGS 成败/中文数字/亿级/斜坡比/key=value/意图判定/疑问句拦截/NaN 消毒/bogus 兜底），累计 47 通过 / 0 失败

### b. 相对方案（E:\claude\LandfillMind-buildScene-Implementation-Plan.md）的修正

1. **文件指针修正**：本仓库的真正结构化 tools 数组在 `server/index.ts`（非 `prompts.ts`），`prompts.ts` 仅有文本工具约定 → 两处都已同步追加 buildScene
2. **默认通道补齐（评审关键）**：`/api/chat` 实际优先走 `handleCompatChat`（GLM/OpenRouter），原方案只改了 CodeBuddy 通道会导致演示翻车 → 现已为 comppat 通道加规则解析 + SSE 回放，**无 CODEBUDDY 也能演示**
3. **NL parser 增强**：补斜坡比 / 中文数字 / key=value / 翻转语序（"把堆体放缓到 1:3"）
4. **OGS 峰值语义**：抽速率系列日峰（非累计最大值），避免"累计 16457 万m³"冒充日峰

### c. 演示脚本（评审 90 秒）

```
"建一个缓坡山谷型 500 万 m³ 的填埋场"          → 山谷 1.2× + 缓坡 0.7× + 库容 500 万 → 卡片
"把堆体放缓到 1:3"                             → pileHeight 0.8×（斜坡比规则）
"重新建一个大库 + 同步算产气"                   → 大型 1.6× + OGS gas-production 峰值 899 万m³/d
"自定义 valleyWidth=1.5, pileHeight=1.6"       → key=value 精确参数
"bogus 文本"                                   → 默认场景兜底（不报错）
"填埋场渗滤液怎么处理"                          → 不误触发（hasSceneIntent 判定）
```

## v4.2（2026-08-18 · 评审前冲刺：12 项核心修复 + 2 项差异化创新）

> 评审前最后一轮迭代。相对于 v4.1.1 的全部改动：
> **P0 评审必改 8 项 + P1 加分项 4 项 + 2 项差异化创新点 + 1 项评审应急端点。**

### a. P0 评审必改（8 项）

- **P0-1 · AI 纠偏演示完整化**
  - 演示数据 `DEMO_RESULT_CORRECTED`（LLM 故意少报/漏报数值）+ 结构化 `VerificationMismatch` 类型（field / reported / expected / severity）
  - 诊断页右侧增加黄色"⚡ 触发纠偏演示"按钮，一键切换"正常演示 → 纠偏演示"模式
  - 视频脚本插入 30 秒纠偏剧场插段（1:50 - 2:40），与分屏剧场 UI 完全同步
- **P0-2 · 工具调用叙事统一**
  - `aug` 上下文改造：改为独立 `system` 消息注入（不再混入 user），避免 GLM 把"工具调用指令"误读为"用户问题"
  - `ToolCallCard` 组件重写：标题改为"📚 知识库检索增强"与"🧮 工程计算内核"，可视化"AI 真的会调用工具"
  - KB 引用徽章：每次工具返回后，结果前部渲染"📖 GB 16889-2008 §6.1"形式可点击徽章
- **P0-3 · AQ 4202 规范张冠李戴修正**
  - 排查 4 处错引：把误挂"AQ 4202"的条目全部替换为真实出处
    - 渗滤液导排 → **GB 16889-2008 §6.1**
    - 填埋气收集 → **CJJ 176-2012 §6.1**
    - 防火间距 → **GB 50016-2014 §5.4**
    - 其余 1 处按上下文修正
  - CH4 风险六档分级：`normal / attention / warning / alarm / danger / explosive`（替代原 4 档），按 LEL% 与体积分数双阈值映射
- **P0-4 · SimulatorPage 3 个无效滑杆删除**
  - 删除 `slopeRatio / tierHeight / floorSlope` 三个从未连入 3D 场景的"装饰性"滑杆
  - 保留真实联动滑杆（库容/谷宽/堆高/坝高/池容/井距/植被密度/车辆数共 8 个）
- **P0-5 · LRU 缓存污染单行修复 + 调试端点**
  - `multiagent.ts` 修复 1 行：缓存 key 增加 `qHash`，避免相同输入但不同追问历史的请求互相污染
  - 新增 `POST /api/agent-cache/clear`（评审日应急清空缓存用，无鉴权仅 dev 环境暴露）
- **P0-6 · 班前交底卡入口前置**
  - 首页 hero 区加红色全宽主按钮"📋 生成今日班前交底卡"，直达 DiagnosisPage
  - DiagnosisPage 内嵌交底卡预览卡片（不再 modal 弹层，可滚动查看完整 8 节）
  - `RiskMap` 组件新增应急疏散路线渲染（SVG path，红色箭头指向 3 个最近安全集结点）
- **P0-7 · DiagnosisPage 4 个演示翻车点**
  - `landfillArea` 与 `rainfall` 字段改为可编辑（之前只读，演示时改不动）
  - "导入 CSV" 按钮未选择文件时 `disabled`（之前点了报错）
  - `handleCalc` 显式捕获异常并 `toast.error` 提示，避免静默失败
  - `handleLoadDemo` 显式 `toast.success('已加载演示数据')`，演示员有视觉反馈
- **P0-8 · 追问链路接通**
  - 修复 `systemPrompt` 真切换：根据上下文是否来自多智能体报告，动态切换"领域专家" vs "通才" system
  - `server/followUp.ts` 从死代码复活：暴露 `buildFollowUpContext()` 接入 `/api/chat`
  - 新增 `FollowUpCard` 折叠卡 UI（追问链路 4 步：场景 → 专家结论 → 用户追问 → 追问回答）
  - 顶部 Banner 霓虹角标"🎯 多智能体协同追问中"（青色边框 + 脉冲动画）

### b. P1 加分项（4 项）

- **P1-1 · RAG 同义词 substring 扩展**
  - `expandQueryBySubstring(q)`：查询词先做同义词 substring 展开（如"垃圾汤" → "渗滤液"、"黑色金子" → "填埋气"）
  - `lookupKB` 与 `scoreKB` 接入：命中关键词全部计分，不再只匹配精确词
  - 8 条自检用例全 PASS（含"垃圾汤"、"黑色金子"、"老场子"、"黑水"等口语词）
- **P1-2 · 专家提示注入三件套**
  - `EXPERT_KNOWLEDGE`：每条 KB 注入 `{ key, clause, thresholds: KEY_THRESHOLDS_JSON }`（约 1.5KB）
  - `SCENARIO_ADVICE`：7 类场景路由（渗滤液/填埋气/边坡/地下水/HDPE/沉降/应急），每类挂专属引导问题
  - `EXPERT_GLOSSARY`：尾部追加 `GLOSSARY_HINT`（约 120B），规范术语→口语映射（"衬垫" → "防渗层"等）
- **P1-3 · cache_hit ⚡ 金色闪卡徽标**
  - `server/multiagent.ts` 增加 `cache_hit` 事件（SSE 流式 + JSON 端点双通道）
  - 新增 `GET /api/agent-cache/status` 返回 `{ size, hits, misses, hitRate, lastHit }`
  - MultiAgentPage 在 4 个 Agent 卡片上叠加金色"⚡ 缓存命中"闪卡徽标（首次跑不显示，复跑显示）
- **P1-4 · 多智能体 hybridSearch + detail 三档**
  - `kbRef` 由 `scoreKB` 改为 `hybridSearch(q, 3)`：融合关键词 + 同义词 substring + 向量余弦
  - `multiagentMaxTokens(detail)`：摘要 800 / 标准 1800 / 详细 3200 tokens，按用户详细度档位动态切
  - MultiAgentPage 顶部增加三档切换 UI（Tab 形式："📋 摘要 / 📊 标准 / 📚 详细"），实时透传到后端

### c. 差异化创新（2 项）

- **想法 1 · 纠偏剧场化 Verification Theater**（评审日直接加分）
  - 新建 `src/components/VerificationTheater.tsx`（394 行）
  - 三栏分屏剧场 UI：**左 AI 报告原文片段**（滚动高亮 mismatch 字段） / **中动画竖线**（逐条"穿过"不一致项的视觉隐喻） / **右计算内核真实结论**（hazard 卡片 + 计算书摘要）
  - 底部时间线步进（4 步：场景输入 → AI 出报告 → 内核复核 → 强制纠偏），可单步前进/后退/自动播放
  - 上下步控件 + 全部展开按钮 + mismatch 列表侧栏
- **想法 5 · 现场一键应急模式**（评审日现场演示加分）
  - 新建 `src/utils/emergencyPoster.ts`（510 行）
  - 5 节一体化海报：**① 诊断报告摘要** + **② 班前安全交底卡** + **③ 4×4 SVG 风险矩阵**（横轴严重度 / 纵轴概率） + **④ SVG 疏散路线**（红色箭头 + 3 集结点） + **⑤ 21×21 QR 码占位**（打印后用 A4 纸即可贴现场）
  - `HomePage` 加红色全宽主按钮"🆘 现场一键应急"，一键触发
  - `AnimatePresence` 全屏 modal 弹出海报预览
  - `<iframe srcDoc>` 原生浏览器打印，零依赖

### d. 冒烟测试结果

- **3 次 verdict clean**：TypeScript 0 错误 + Vite build 0 警告 + 全部 API 端点 HTTP 200
- **P1-1 同义词生效验证**：查询"垃圾汤"成功召回渗滤液相关 KB 条目（命中率 8/8）
- **P1-3 cache_hit 事件触发验证**：第 2 次跑同一组参数，4 个 Agent 卡片均显示⚡闪卡徽标
- **P1-4 detail 三档透传验证**：切到"详细"档，多智能体报告 token 数从 1820 提升到 3147
- **想法 5 海报输出验证**：`generateEmergencyPosterHtml()` 输出 23817 字节有效 HTML，浏览器原生打印 A4 排版正常

### e. 新增文件清单（4 项）

| 文件 | 行数 | 用途 |
|---|---:|---|
| `src/components/VerificationTheater.tsx` | 394 | 纠偏剧场分屏 UI |
| `src/utils/emergencyPoster.ts` | 510 | 现场应急海报生成器 |
| `src/utils/expertPrompts.ts` | 85 | 专家提示三件套（EXPERT_KNOWLEDGE / SCENARIO_ADVICE / GLOSSARY） |
| `server/followUp.ts` | 88 | 追问上下文构建（之前是死代码，现接通） |

### f. 修改文件清单（28 项）

后端（10）：`server/index.ts` / `server/multiagent.ts` / `server/llm.ts` / `server/prompts.ts` / `server/kb.ts` / `server/diagnose.ts` / `server/calculate.ts` / `server/db.ts` / `server/augment.ts` / `server/corrections.ts`

前端页面（7）：`src/pages/DiagnosisPage.tsx` / `src/pages/HomePage.tsx` / `src/pages/SimulatorPage.tsx` / `src/App.tsx` / `src/main.tsx` / `src/types.ts` / `src/utils/exporter.ts`

前端组件（4）：`src/components/CalculationAnimation.tsx` / `src/components/ResultInterpretation.tsx` / `src/components/RiskMap.tsx` / `src/components/Sidebar.tsx`（新增 VerificationTheater 接入）

前端 Hooks（3）：`src/hooks/useAgents.ts` / `src/hooks/useChat.ts` / `src/hooks/useSessions.ts`

配置（4）：`package.json` / `render.yaml` / `.env.example` / `tsconfig.json`

> 注：CHANGELOG.md、参赛技术说明文档.md、视频脚本.md、DEPLOY.md、README.md 由文档 Agent 同步维护，本节不重复列出。

### h. 评审现场应急

- **`POST /api/agent-cache/clear`** 调试端点可用于评审日 LLM 通道 5xx 时应急清空 LRU 缓存
- 仅在 `NODE_ENV !== 'production'` 时启用；生产环境静默 404（不影响安全）
- 评委手机 4G 网络抖动时，主持人可在浏览器 Console 直接 `fetch('/api/agent-cache/clear', {method:'POST'})` 重建缓存

---

## v4.1.1（2026-08-17 · 评审前修复版）

> 提交版本。相对于 v4.1.0 的全部改动：

### Bug 修复
- **HDPE 验算量纲兼容**：`hdpeCheck` 支持 `eps < 100` 视为小数（如 2 → 200%），保留 `eps ≥ 100` 视为百分数（如 700%）— 修复了前端表单默认 2 与计算内核判断 700% 的歧义。
- **删除 /api/permission 死调用**：GLM 通道无真正工具授权流，前端 `handlePermissionAllow/Deny` 改为 no-op（保留函数签名兼容未来 CodeBuddy 接入）。
- **路由 404 JSON 兜底**：`/api/*` 未匹配路径返回 JSON 而非 SPA fallback 的 HTML，避免前端 `fetch().json()` 抛错。

### 可靠性 / 演示健壮性
- **演示 IP 限流放宽**：Render `RATE_LIMIT_PER_MIN/Day/GLOBAL` 从 20/200/1000 提到 40/1000/5000。
- **IP 限流定期清理**：每 60 秒统一清除过期 ipMinute 记录与昨日 ipDay 记录，防止内存无界增长。
- **db 写 debounce**：所有 `persist()` 改为 `schedulePersist()` 合并为 1 秒批量写；新增 `persistNow()` 在优雅退出时立即落盘。
- **SSE keepalive**：每 15 秒发送 `:keepalive` 注释行，防止长对话场景下反代/浏览器断开。
- **SIGTERM 优雅退出**：监听 SIGTERM / SIGINT / unhandledRejection / uncaughtException，server.close + persistNow + 8 秒强杀兜底。

### 性能优化
- **three.js 懒加载**：`LandfillScene3D` 通过 React.lazy + Suspense 在 HomePage（hero 实时联动）和 SimulatorPage（3D 模拟）按需加载，主页 chunk 不再包含 498KB 的 Three.js，首屏体积显著下降。

### 文档统一（口径修复）
- SPEC.md 顶部加过期说明（与 v4.1 实际实现有偏差）。
- README.md 数字统一：KB 50→66、Calc 15→12、LLM 通道描述更新。
- 新增"实际能力 / API 接口"表格；新增"快速开始"段落。

### 已知遗留
- sql.js（非 better-sqlite3）—— sql.js WASM 在 Render 免费层无持久盘时自动降级为内存态；生产数据库建议后续切换 better-sqlite3。
- 单元测试 / CI 仍缺失——`scripts/eval-agent.ts` 端到端冒烟可作为 CI 第一步。

---

## v4.1.0（2026-08-11）

- 计算中心三栏布局 + 回答详细度三档（摘要/标准/详细）
- 全站导出（MD / HTML 浏览器打印 PDF / JSON）
- 3D 模拟页面 + 3D 场景视觉升级（贴图/天空/云）
- GLM-4-Flash 唯一通道
- 多智能体参数化 + 4 领域 Agent + 总结 Agent
- 6 大页面完整实现
- 67+ KB 条目（2026 新增专题）
