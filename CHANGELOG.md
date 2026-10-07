# Changelog · LandfillMind 填埋场全周期智能体

## v5.5.1（2026-10-07 · 三维内核内置进仓库：不再依赖同机的另一个目录）

`landfill3d`（v1.7.2-rb）此前活在仓库外：`server/kernel3d.ts` 里硬编码一个 `E:\ZJU\ZJU\三维建模\...`
默认路径，靠 `.env` 的 `KERNEL3D_REPO_PATH` 指到同机另一份目录。三个后果：clone 下来不带内核就
是"未配置三维内核"；内核自身**没有任何版本控制**（改了没法回滚、没法比对）；DEPLOY.md 因此写明
内核"仅限同机部署"，云端 `/tool` 是空壳。本轮把内核收进仓库，并把镜像做成真能跑内核。

- **入库**：`kernel3d/agent_bridge.py` + `kernel3d/landfill3d/`（11 个 py，224KB / 4452 行）逐文件
  sha256 与源副本一致后提交；`kernel3d/requirements.txt` 记依赖（numpy/scipy/matplotlib + 可选
  openpyxl/python-docx，本机基线 Python 3.12.10）。`.gitignore` 补 `__pycache__/`、`*.pyc`，
  `.dockerignore` 同步。桌面 GUI（`app.py`）与 `test_agent_bridge.py` 本来就不在这份快照里，
  Web 端 `/tool` 已取代桌面界面 —— 内置的是 headless 内核，不是整个桌面工具。
- **路径解析**（`server/kernel3d.ts:33-46`）：`REPO` 默认改为 `import.meta.url` 相对解析到
  `../kernel3d`（顺带让 `RUNS_ROOT` 复用同一个 `HERE`）；`PY` 默认按平台取（win32=`py`，
  类 Unix=`python3`）。`KERNEL3D_REPO_PATH` 降级为"去调另一份内核副本"的调试开关，并且**故意**
  不做"指错了就静默退回内置"的兜底 —— 否则"改了内核却没生效"这类事会以更难查的形式再发生一次，
  现在得到的是 `configured:false` + 带内置路径的 hint。`kernel3d.ts` 两处"请更新 Landfill 3D Tool"
  与 `KernelToolPage` 的失败提示同步改成内置语义。
- **Docker**：production 阶段 `node:22-alpine` → `node:22-bookworm-slim`。musl 上
  numpy/scipy/matplotlib 没有可靠 wheel，装不上时表现是内核 `ModuleNotFound`，很难查，glibc 才稳。
  镜像里 `python3 -m venv /opt/venv` 装 `kernel3d/requirements.txt`（绕开 Debian 的
  externally-managed 限制），并装 `fonts-noto-cjk` —— `style.py` 的字体候选含
  `Noto Sans CJK SC`，缺字体时图照样生成、汉字全变方框，属于"看起来成功"的坏失败。
  `ENV KERNEL3D_PY=/opt/venv/bin/python`、`MPLCONFIGDIR=/tmp/matplotlib`（字体缓存要可写）；
  healthcheck 从 `wget` 改 Node 自带 `fetch`（slim 无 wget），非 root 用户改 `groupadd/useradd`。
  ⚠ **镜像未实机验证**（本机无 docker），构建期风险集中在 pip wheel 与 apt 源。
- **文档**：DEPLOY.md §5 的"仅限同机部署"作废，改写为内置 + 三条注意（CJK 字体、免费层 0.1 CPU
  跑不动重扫描、`data/kernel3d/sessions/` 无持久磁盘重启即失），§6 加一行"未找到三维内核"排查；
  README 的能力表/架构图/技术栈/快速开始四处同步；render.yaml 注明镜像已自带内核环境、无需配
  `KERNEL3D_*`。
- **验收**（本机，指向内置副本）：`tsc -b` 0 错；`/api/kernel3d/health` `configured:true`
  且 `repo` 落在仓库内 `kernel3d`；`info` 回 v1.7.2-rb / 14 actions / 23 figures；真实跑建模 +
  稳定性（Fs_min 1.925 → blue，`critical_arc` PNG HTTP 200 / 60KB，`key_numbers` 出数）；
  `smoke:tools` 全过；`k3d-check` 3/3（stdin 桥与口径守卫都走内置副本）；`landfill3d.audit`
  前三项 True（库容误差 1.94%、加密后 Fs 收敛差 0.012、Cc 法 90.39cm > Es 法 35.56cm）；
  `/tool` 品牌条显示 v1.7.2-rb（版本取自内核自述，不是前端硬编码）。
- **遗留**（下轮收，本轮不动）：`server/tools.ts` 给 LLM 看的工具说明仍写"v1.7.0"，与内核实装
  1.7.2-rb 漂移；内核侧的开挖记录累加、`cli.py` 库容矩形积分与 physics 的辛普森口径分裂等
  仍待处理。


## v5.5（2026-09-22 · 数值口径统一：同一工况不再出两个结论）

四类「同一输入、不同模块不同答案」的口径分裂逐项收口，全部落在确定性内核层，不改任何 LLM 提示词。

- **Fs 分档单一来源**: 新增 `calculate.gradeFromFs()`（<1.0 红 / <1.2 橙 / <1.5 黄 / ≥1.5 蓝，
  另出 `fsBandLabel` 失稳·欠稳定·基本稳定·稳定）。此前四处各自判档——`slopeFs` 黄档止于 1.3
  且 ≥1.3 记 green、`calculateStabilityFactor` 黄档止于 1.5 记 blue、`augment.runCalc` 用
  `Fs>=1.3 ? green : red` 二值、`diagnose` 对直给 Fs 再写一条链 → **1.3~1.5 区间同一工况
  在计算中心判「满足/绿」、在快诊判「基本稳定/黄」**。规范判据本身改由 `FS_REQUIRED=1.30`
  独立表达，analysis 文案同时给「运行要求 ≥1.30 / 良好 ≥1.50」。前端 `ChatPage` 补 blue/orange
  中文标签（此前 `String(grade)` 直接漏英文）。
- **计算器实现三份收敛**: `augment.runCalc` 原本按位置参数自调 `calculate.ts` 并自带一套默认值
  （slopeFs 取 γ=12，注册表取 γ=10）→ 同一句提问在引用卡片与工具卡片上算出两个 Fs；现整体委托
  `CALC_REGISTRY`。`CALC_FORMULAS` 在 augment 与 routes/calc 各存一份手抄，改为转发单一来源。
  `detectCalcIntent` 的 `soilScreen.cls` 由 '1'/'2' 改发注册表认得的完整档位串（否则委托后
  一律落到二类档）。
- **ρ 量纲错**: `capacity` 按 **t/m³** 使用 rho（`W=V·ρ` 求质量、`meetsStandard=rho>=0.9`），
  而元数据标 kN/m³ 且 default 10 / min 5 → **任何合法输入都 ≥0.9，达标判定永不失败**，总质量
  虚高 10 倍（10ha×30m 此前报 3000 万吨，现报 300 万吨）。单位改 t/m³、default 1.0、
  min 0.5、max 1.5、step 0.05，同步 routes/calc 默认值、`detectCalcIntent`、`calcPresets`
  三套预设。T 只依赖体积，使用年限不受影响。
- **水位参考面统一**: `waterLevel` 是「库底以下埋深」（监测值），`stabilityDetail` 要的是
  「自堆顶起算埋深」，此前 `diagnose` 与 `domains` 都把前者**直传**后者——H=28、1:3、
  水位在库底以下 2.5 m 的场地按 92% 浸没计浮托，Fs 从 1.46 被压到 0.18（黄 → 红）。
  新增唯一转换点 `calculate.waterDepthFromTop(H, baseDepth)`（水位在库底以下→堆体不受浮托取 H；
  涌入库内按浸没高度折算），快诊计算书步骤如实写明换算来源。参数标签改「水位埋深（自堆顶起算）」
  并加口径提示。缺测代表值统一到 `WATER_DEPTH_REPRESENTATIVE=10`（此前快诊按 0 m 全浸没、
  领域 Agent 按 10 m，同一缺测场地两个模块互相打脸）。
- **domains 交叉核对复位**: 边坡领域 Agent 一条链喂 `waterLevelForCalc`、另一条喂 `waterLevel`，
  再把两个 Fs 相比对 → 恒触发「计算器口径与稳定内核不一致，请核查参数换算」误报。现两条链
  取同一 `w`，该守卫恢复有效。
- **规范登记表纠错**: `standards.ts` 记「CJJ 176 已被 CJJ/T 273-2019 部分替代」——
  **CJJ/T 273-2019 实为《橡胶沥青路面技术标准》**，与填埋场无关；该错误还写进 `kb.ts` 的
  slopeStable 引用串，随对话回复直达用户（实测引用串可见）。已删除，`related` 里两处
  `CJJ/T 273` 改指 GB/T 18772-2017；HJ 25 现行版本按知识库核实口径改为
  「25.1~25.4-2019、25.5-2018」，25.6 未核实不作断言。
- **前端元数据去重**: `DesignPage` 的 `PARAMS_MAP` 是 `server/calc-meta.ts` 的整份手抄
  （ρ 的单位错误就是两份不同步的产物），改为直接引用权威定义，页面 −109 行；
  `ParamField` 开始消费 `step`。
- **useChat 两个交互 bug**: ①定稿 `finalMsg` 漏带 `followUps`，追问卡片在流结束瞬间消失；
  ②`error` 事件往 `assistantContent` 追加，而下一个 `text` 事件用 `cleanAssistantText(assistantRaw)`
  整体重算正文把它抹掉。改为 notice 单独累积、`setContent()` 统一合成。
- **文档对齐实现**: README 原写「Windows 本机可另调原生 ogs.exe 做有限元校核」——三场景均已挂
  `computeOnly`，`runOgsScenario` 在解析分支即 return，求解器分支不可达。改为如实标注「预留未接入」。
- 验证: typecheck + build 绿；`multiagent-smoke` 20/20；Fs 1.45 在 slopeFs / 稳定内核 / 快诊
  三条链同为 yellow；`POST /api/calc/slopeFs` 与 `/api/tools/meta` 实测已回新口径；浏览器实测
  计算中心表单（ρ t/m³ 0.5~1.5 step 0.05、水位标签）与库容计算 W=3000000t 正确、
  追问卡片流结束后仍在 DOM。

---

## v5.4（2026-09-22 · 开挖模块大修，配套内核 v1.7.1 开挖链路）

三大症状（划分不精确 / 开挖完模型没挖完 / 分阶段结果看不到不正确）逐项闭环：

- **划分**: `refreshZones` 把 ②分级/①临时坡随请求下发（旧版只发 cuts，内核默认
  `[[6,2,3],[6,2,0]]`+temp_n=2 回写覆盖用户设置，切一刀冲一次）；几何未变的行
  按序保留顶标高/分级/临时坡/挖到基底；画布底图支持多块真实轮廓（旧为
  cells[0]/含边距的域矩形）；面板 ① hint 注明边界按网格取整 ±半格。
- **建模消毒器补漏**: `normalizeL3dSpec` 此前重建分区只留 name/poly/top_z/levels
  —— `temp_n/order/slopes/cut_to_base` 在服务器就被丢掉，界面上设的临时坡、
  开挖顺序、逐边坡比从未到过内核。新增 `normalizeL3dZonesParam` 给
  phased/excavation/export 的 zones+stage 消毒（`top_z:''` → 键消失，旧版把
  `""` 送进 Python `float('')` 炸成"未知错误"）。
- **挖到基底**: 分区表新勾选列 `cutToBase`（chk 列型）→ `cut_to_base`；坡面
  按分级剖面、坑底直接削到基底。`buildSpec/doPhased` 同发。
- **分阶段**: `stageCount` 从 `data.stages` 数组推导（旧两条判据全落空，两个
  阶段下拉恒死）；选项枚举修越界（0..K 共 stageCount 项）；跑完自动把子视图
  切到「阶段剖面」（旧版画面永远停在上一次的 exc_arc）；「查看阶段」下拉改
  `onStagePick` —— 工件齐时纯切 UI（三维换 stage-k.obj + 剖面换对应 PNG），
  不再每次重跑内核；`doPhased` 的 zone 走 compact（'' 不再发键）。
- **3D**: `KernelMeshView` 收 `sid` 并把 /mesh-info、/mesh、viewport POST 全部
  按 sid 解析（旧版按全局活动会话指针，聊天路径建个模就能把本页换成未开挖
  模型）；新 `meshUrl/meshBounds` 通道加载阶段网格；routes 白名单加 `.obj`。
  内核侧坑底透明洞/满高 fringe 修复见内核 CHANGELOG v1.7.1。
- **导出**: `doExportReport` 补 `zones/phased/stage`（旧版 Word/Excel 里从来没有
  逐阶段结果）。
- 验证: typecheck+build 绿；k3d-check / check:toe(49) / 内核五套件 (439+35+257+
  117+448) 全过；内核行为探针 28/28（F:\Claude Code\开挖模块修复_260922）。

## v5.3（2026-09-20 · 两个 3D 入口合并为「三维建模分析」+ 桌面工具 1:1 对齐）

> v5.2 留下了两个 3D 入口：「3D 模拟（真实模型）」是纯查看器，「3D 建模工具」是
> 桌面移植的工作台 —— 但两者渲染的**本就是同一份会话几何**（`model.obj`），
> 是重复入口而非互补功能。本版本把它们合并为单一页面，并按桌面工具
> （Landfill 3D Tool v1.7.0）的界面与工作流逐项对齐。

- **合并与路由**：新增 `src/pages/KernelToolPage.tsx`（全屏接管，不套 AppShell，
  自带菜单栏/品牌条/工具栏/状态栏）；`/tool` 指向它，`/3d-simulator` 改为
  `Navigate to="/tool"` 重定向（旧书签与 `model-builder` 的 `navigateTo` 不 404）。
  侧边栏两行合为一行**「三维建模分析」**。删除 `Kernel3DPage.tsx` /
  `LandfillToolPage.tsx` / `SimulatorPage.tsx`（合并前的三份实现）。
- **页面结构**（`src/pages/KernelTool/`）：
  `chrome/` 菜单栏（工程 15 项 + 帮助）/ 品牌条（标题 + 4 chip，版本号从内核 info 取）/
  工具栏（8 按钮）/ 状态栏 / 视图条 / 结果条（340px **右列**：计算结果表 + 运行日志）；
  `panels/` 建模 · 计算（库容/坡度/剖面/沉降/稳定性）· 污染 · 开挖 四页签；
  `stage/` 中央图形区（three.js 交互图 ⇄ 内核 matplotlib 图 ⇄ 二维结果图）；
  `spec/` 视图与参数规格（默认值逐项照抄桌面）；`state/` 字段级 store + 动作层；
  `ui/` 桌面控件等价物。
- **亮色皮肤**：`skin.css` 的 `.lf-light` 作用域内重定义 CSS 变量为桌面色值
  （BG `#eef2f8` / PANEL `#ffffff` / ACCENT `#0d7fd6` / BORDER `#c3d0e0` …），
  并覆盖滚动条、`::selection`、`:focus-visible` 三处全局规则。不动全局主题，
  不影响其它页面。
- **状态组织**：表单上百个字段走 `FieldStore`（`useSyncExternalStore` 字段级订阅，
  零新依赖）—— 左栏敲一个字符只重渲染那一个 `<input>`，整页（9 视图条 + 结果表 +
  日志）不动。布局状态另用一个小 store；Context 只放低频的运行层（pool/logs/busy）。
- **三维视图**：`KernelMeshView` 扩展 `zexag`（垂直夸张）/ `groups`（实体组 +
  叠加组）/ `overlaySpec`+`overlayParams`（⑥三维显示 驱动内核重导网格）/ `apiRef`
  （↺↻ 旋转、适应视野）；修掉材质泄漏（原来只 dispose geometry 不 dispose material）
  与鼠标键位（对齐桌面「左键旋转 · 右键缩放 · 滚轮缩放」）；场景底色改读**挂载元素**
  的 CSS 变量（原来读 `documentElement`，作用域皮肤下会取到深色）。
- **新增后端通道** `POST /api/kernel3d/mesh/viewport`：按叠加层**指令**重导网格
  （需要算物理的那几层由内核复用分析侧构造，不在服务端另算）；`viewport.json`
  记指纹，改无关字段不会触发重导。文件路由放行 pdf/svg/csv。
- **配套内核改动**（Landfill 3D Tool 仓库，4 个 commit）：视图参数化、出版件导出
  （PNG 300dpi / PDF / SVG）、单剖面 Bishop、`data.best` 补 A/B 端点、三维叠加图层
  （新 `mesh_overlay.py`）、`spec.demo` 内置示例场、沉降 `gamma_water` 透传。
  **并修掉一个真 bug**：多分区开挖「存盘重开后静默退回」—— 桌面「应用开挖」与
  两条重载路径对 ≥2 区的口径不一致，实测同一分区表两边顶面差 12.0m（正是总开挖深度）。
- **`/scene-classic` 退役**：经典风格化示意场景随两个 3D 入口合并一并删除（路由、
  `SimulatorPage`，以及 ChatPage/DiagnosisPage/OgsSimPage 里指向它的按钮）。
  `LandfillScene3D.tsx` 本体保留（HomePage 仍在用）。对话页里指内核真实模型的按钮
  改指 `/tool`；**纯风格化场景的按钮是移除而非改指** —— 新页渲染的是内核真实几何，
  指过去会误导。
- **画布建模**（`src/components/PolygonCanvas.tsx`）：补上桌面的「多边形底面绘制 —
  大画布」（840×640 Toplevel）。交互逐条对齐：左键加点 · 点在已有边上可选中设坡角 ·
  双击闭合 · 右键撤销 · 滚轮缩放 · 中键平移；顶栏 撤销/清空/闭合多边形/适应视图/关闭；
  带网格与坐标刻度、顶点编号、光标世界坐标读数。选中的边就地弹 `1:n` 输入框写回
  逐边坡比（桌面 `_param_edge_entry_show`）。与顶点文本框**双向同步**。
- **修复：污染与羽流报「未知错误」**。两层问题叠加：
  ① 前端把 `plume_snapshot_days` 的列表默认值当逗号串发过去，内核原先不做类型
  检查，字符串一路带到羽流求解器才炸（`unsupported operand type(s) for /: 'str'
  and 'float'`）—— 只在开了羽流时才暴露。前端改为**按字段声明的 kind 解析**
  （L/C/B 转数字数组、C 校验 12 项、B 校验 4 项），内核侧也加了入口护栏给出可读
  报错。
  ② **错误本身看不见**：`execTool` 的失败信封把原因放在 `warnings[0]`，而 ToolRun
  上没有 `error` 字段（`server/tools.ts:962-974`），前端只读 `resp.error` → 于是
  每次内核失败都显示「未知错误」，真实原因只能去日志里翻。已改为优先取 warnings。
- **修复：逐边坡比的空位与长度**。内核要求坡比个数 == 顶点数且每条边为有限正数
  （桌面 `_edges_values()` 本就是「空/非法回退统一坡度」），前端原先原样发
  `[2, None, 3, None]` 或只填一行的 `[2]` 会被拒。`buildSpec` 现按边数补齐、
  空位回退统一坡比。
- **三维查看器的缩放与雾**（用户反馈）：去掉场景雾 —— 雾是按**到相机的距离**
  算的，一缩小整块地形就被背景色糊掉、越缩越看不清；原设计里雾是给"远处网格
  淡出托底"用的，但代价太大。改为限制缩放倍率把视野圈住：
  `OrbitControls.minDistance = 0.03×场宽` / `maxDistance = 2.2×场宽`
  （默认轴测取景距离约 1.0×场宽，往外留 2.2 倍够看场地与周边网格的关系）。
  顺带把 `near/far` 从"按某次取景距离"改成**按场地尺度**给 —— 相机现在能在
  0.03~2.2 倍之间自由缩放，取景距离只是其中一个点；贴着看时 near 太大会被裁，
  缩得远时 near 太小又会让抬高 0.1m 量级的叠加层深度精度不够而闪烁。
  实测：滚轮缩小 15 / 45 / 105 次的截图**字节完全相同**（到上限即夹住），
  且模型始终保持原色、不再被雾冲淡。

  一批只在真实交互里才暴露的问题：
  ① **会话不同源**：工具页有自己的 sid，三维查看器读的却是**全局活动会话指针**。
     新浏览器里两者不一致 → 画面里明明有模型，一点计算就报「请先建模」。现在
     页面加载时若自己的会话还没有工程就**接管活动会话**（查看器与计算同源，
     "在对话里建模 → 来工具页继续算"这条主链路才成立）。
  ② **模型类视图永不出图**：`FigureStage` 只按子视图条取图，而没有子视图条的
     四个视图（等高线/坡度/剖面/库容曲线）`subFigs` 恒空 → 计算成功、状态栏
     也对，画面却是「还没有结果」。现在按 `RENDERABLE` 点名取，并兜底池中首图。
  ③ **「应用开挖」被上一次的 demo 吞掉**：`run_3d_kernel` 的 model 分支默认
     **增量合并**，前端按整份表单发的 spec 缺 `demo` 键 → 上一次的
     `demo:"plain"` 被继承 → 把示例场原样重建、开挖根本没进去。新增
     `spec_mode:"replace"`（工具页专用，LLM 分支仍走增量改模）。
  ④ **示例场几何没回填表单**：桌面 `load_demo` 后会 `_restore_param_project`
     把示例参数灌回表单；Web 只回带了阶段标高/土层。于是加载示例后一按
     「应用开挖」就用表单里的默认 300×200 矩形替换了示例场。现在内核回带
     `data.demo.spec`（cells / polygon / points 三条路线，含逐边坡比），前端灌回。
  ⑤ **分区 `top_z` 为空时整区被静默丢弃**：`normalizeL3dSpec` 的过滤条件写了
     `Number.isFinite(e.top_z)`，而 `Number.isFinite(null) === false` —— 空
     `top_z` 恰恰是内核认的「由现有堆体顶面采样」。四个分区被全丢，开挖纹丝不动
     （实测示例场 513.9 万m³ 一点没变）。同时桥侧 `c.get("top_z", 0.0)` 的缺省
     也应是 `None` 而非 `0.0`。修好后应用开挖：513.9 → **317.1 万m³**，与在内核
     里直接调 `apply_excavation_model` 的结果完全一致。
- **羽流图排版重做**（配套内核 commit `7a2742a`，用户反馈"标签、图名挤在一起看不清"）：
  `plot_plume_plan/section` 的标题原是一行不折、由 6~9 段指标拼成（90~100 字符），
  右端压到 colorbar 顶标签；图例不透明坐在 axes 右下角盖住羽流；"地下水流向"
  文字探进标题带。Web 侧更严重（桥画布更矮 + `bbox_inches="tight"` 把溢出完整扩进
  PNG）。修在内核共享绘图函数里：标题折两行（指标一个不删）、图例外置到轴下方
  2 列、流向标注收进 axes 内部、colorbar `shrink=0.86` 让位；两图自管布局并登记进
  桌面 app.py 跳过名单（否则桌面统一 adjust 会冲掉边距，两边观感劈叉）。
  桌面 / Web / DOCX 附录三处同时受益；新增 14 条包围盒排版断言钉死防回潮。
- **四页大屏布局适配**（用户反馈"多智能体、计算工具库、首页等布局偏小"）：
  根因是全项目响应式在 lg(1024) 封顶（`xl:/2xl:` 0 命中），2.5K 屏上 1152/1024px
  的 max-w 把内容夹成中间窄带。新增 tailwind 断点 `3xl=1920px` + 共享令牌
  `src/utils/layout.ts`（`PAGE_MAXW` / `widePx`），首页 7 处容器 1152→1720、
  计算工具库 1024→1560 且左列与 SVG 图表同步放大、多智能体 1720、快诊结果区
  补上 `mx-auto`（原先连居中都没有）。**全部挂 `3xl:`，笔记本零变化**——
  像素对比实测：1366×768 下 design/multi/diagnose 三页与改前逐像素一致，
  home 仅数字滚动动画的时序差（平均像素差 0.0001）。

## v5.2（2026-09-19 · run_3d_kernel 会话模式：自定义场地三维内核 + 精确图回传 + 场景融合）

> v5.1 的 `run_3d_kernel` 只能在**内置示例场**上做单发快查（module 五分支），
> 用户报出自己场地的长宽/坡比/土参时内核帮不上。本版本给同一工具加
> `action=` 会话分支：对话建模 → 专项分析 → 准确结果图与简报 → 一键把真实
> 尺寸/时程送回三维仿真器（融合定位：内核出准确数字与剖面图，旧 three.js
> 场景继续承担"大规模示意图 + 周边环境关系"）。

- **`server/kernel3d.ts` 双通道**：保留旧 stdin 桥（`py -m landfill3d.cli`，
  pilot-benchmark / k3d-check 契约不动）；新增 `runKernel3dAction()` 文件桥
  —— spawn `py <KERNEL3D_REPO_PATH>/agent_bridge.py --input --output --workdir`
  （数组 argv 无 shell，空格/中文路径由 Node 转义；`py` 启动器超时用
  `taskkill /T /F` 杀进程树）。动作分级超时 60–300s（`KERNEL3D_TIMEOUT_MS` 覆盖）。
- **会话态**：`data/kernel3d/sessions/<sid>/{spec.json, project.json, runs/}`；
  `action=model` 增量改模（新字段覆盖、底形互斥清理、原子写）；分析类动作
  无模型时返回"先建模"引导错误；sceneHint 落盘回带（分析卡片也有场景按钮）。
- **新产物路由** `server/routes/kernel3d.ts`：`GET /api/kernel3d/health` +
  白名单文件路由（路径段正则 + resolve 包含校验 + 扩展名白名单 + `?dl=1`），
  限流豁免 GET；前端 `run_3d_kernel` 获得正式 kind `'kernel'`（旧版一直缺映射）。
- **卡片（ChatPage）**：结论 pre + 口径/grade/耗时 chips + 结果表（扫描/污染/
  开挖通用 cols+rows）+ key_numbers 平铺 + 内核 PNG（点开原图）+ ⬇分析简报；
  **「🏔 在 3D 场景查看」**：sceneHint → GeoParams 工程尺寸按真实长宽高坡角
  立堆体，污染 CH₄ 年序列→火炬强度（ch4_rate m³/d 换算）、沉降时程→堆体
  下沉（DISPLACEMENT_Y1 m），复用既有 scene-built / scene-ogs 双通道，
  仿真器侧代码零改动。
- **B 侧配套**（Landfill 3D Tool v1.7.1-unreleased）：新增 `agent_cli.py` +
  `agent_bridge.py` headless JSON CLI（含 physics 守卫、99.99 哨兵保护、
  NaN/大数组消毒），`test_agent_bridge.py` 35 项契约测试全过。
- **「内核工作台」升级为「3D 建模工具」整页移植（用户定调：不要视图集合，要工具本体）**：
  新页 `/tool`（侧边栏「3D 建模工具」）复刻桌面工具的界面结构与工作流——
  左列参数区 Notebook（**建模 | 计算[库容/坡度/剖面/沉降/稳定性] | 污染 | 开挖**，
  与桌面 tab 一一对应，含分层/单元/开挖区行编辑表），右列主视图区
  （**3D 真实网格 ⇄ 内核渲染图**切换）+ 结果表（对应桌面 Treeview）+
  状态卡 + 运行日志窗。计算走新 GUI 通道 `POST /api/kernel3d/run`
  （直驱 run_3d_kernel 会话动作，仍落 tool_runs）；B 侧为此新增
  `analyze_slope` / `analyze_section` 两个 CLI 动作（坡度统计/剖面坡比分段）。
  工程存档下载 = 桌面"另存工程"的 Web 等价。查看器核心抽为共享组件
  `KernelMeshView`（/3d-simulator 全屏页与 /tool 内嵌小窗共用）。
  旧 /kernel-studio 路由 301 到 /tool。**对齐升级（同日二版）**：主视图条改桌面同款
  9 视图（●三维模型 ◎等高线 ▲坡度 ┃剖面 ∿库容曲线 ▽沉降 ⚖稳定性 ◈开挖 ◉污染）
  + 各页子视图条（沉降：深度剖面/平面分布；稳定性：Fs网格/临界圆弧/断面扫描/Pf-β；
  开挖：开挖Fs/圆弧/逐级坡；污染：产气时程/渗滤液/水质/柱穿透/羽流平面·剖面）；
  工具条第二行（俯视/侧视/轴测、⤓导出当前图、库容曲线 CSV、▣/◀ 折叠）；
  建模页分组①~④（含**设计堆高 design_H、逐边坡比**）；库容页起始/终止/分层数/
  阶段标高列；沉降页 γsat/σp/Cs 全列 + 指定时程点 + 差异沉降平面勾选；稳定性页
  Bishop 分辨率 + 粗筛先行 + MC 分布类型；**污染页 ①~⑥ 全参数组**（下拉选项由
  内核 `GET /api/kernel3d/info` 动态下发——与桌面声明式规格表同一单一来源机制）；
  开挖页独立两步（▶应用开挖 / ↩取消开挖还原 / ▶算开挖稳定性）。
  文件菜单等价：打开工程 JSON（`POST /api/kernel3d/import`，参数化与测点两条路线均可
  重建并即时出网格）+ 另存工程下载。
- **「对齐桌面」三版补齐（同日）——原列差距全部落地**：
  ① **开挖画布**（`ExcZoneCanvas`，SVG）：✂ 按住拖线切割 / ⌣ 点边设逐边坡比 /
     ⊞ 一键切四区 / ↶ 撤销上一刀 / 清空——切割几何由内核 `zones` 动作
     （`zones_from_cuts`/`quadrant_cuts`）真算，分区表双向同步可手改；
  ② **阶段分区开挖**：新 CLI 动作 `analyze_excavation_phased`（run_phased +
     phased_summary），出「分区阶段 Fs-阶段曲线 / 阶段剖面」两子视图 + 阶段下拉
     （最不利/逐阶段，切换即时重渲）；
  ③ **成果导出**：CLI `export` 动作复用 `export_report.py`（与桌面同一代码）——
     Excel 汇总（库容+污染十表+开挖表）、Word 报告（【章节】+ 内嵌产气/渗滤液图）、
     当前图底层数据 CSV（`figure_rows` 映射，缺失时前端回退结果表；xlsx/docx 经
     文件路由下载，Content-Type 白名单已扩）；
  ④ **测点插值建模**：`_load_model` 支持测点路线工程重建（build_all + 开挖回挂），
     `build_model` 新增 `source=points`（base/top_points + 插值法 + 顶面模式 +
     设计标高），建模页 ②′ 支持粘贴/CSV 文件导入，打开工程自动回填测点；
  ⑤ **污染结果时刻**：analyze_pollution 返回 `time_options`（产气快照年份/羽流快照
     天数 + 实际使用值），状态栏年份/时刻下拉改值即重跑重渲（gas_field 产气强度
     平面、羽流平面按所选时刻出图，同桌面 cmb_poll_time 机制）。
  残余小差异：画布上分区轮廓的实时预览按最终 zones 结果重绘（非桌面逐帧布尔运算）、
  羽流剖面/平面的历史包络线开关未暴露（用高级参数 JSON 亦可覆盖）。
- **真实三维查看器**：
  `/3d-simulator` 改渲染新页 `Kernel3DPage`（three.js + OBJLoader，拖拽旋转/滚轮缩放、
  俯视-平面-正面预设、X 向剖切滑杆、线框、顶面/坡面/基底图层开关、信息栏显示真实
  场地尺寸与三角数），数据源为**内核导出的会话 OBJ**（B 侧新增 `mesh_export.py`：
  Zt/Zb 网格 + 足迹裙边 → g_top/g_side/g_base 三组带顶点色；`export_mesh` 动作，
  `build_model` 自动附带）。`GET /api/kernel3d/mesh[/info]/active` 端点在
  project.json 比网格新时自动重导。经典风格化场景**保留**于 `/scene-classic`
  （build_scene / OGS 联动 / 环境示意按钮全部重定向过去；内核卡片新增
  「🏔 真实三维模型」主按钮 + 降为次要的「🖼 环境示意场景」）。侧边栏「3D 模拟」
  改名「3D 模拟（真实模型）」。
- `.env.example` 增 `KERNEL3D_REPO_PATH / KERNEL3D_PY / KERNEL3D_TIMEOUT_MS` 说明；
  未配置时工具返回可读错误信封，其余功能不受影响。同机部署专用（spawn 模式），
  云端部署不含此能力。
- 验证：`npx tsc -b` 全绿（顺手修掉 kernel3d.ts 旧桥 4 处既有 TS18047）；
  execTool 层 8 用例（引导/建模/稳定/沉降+报告/污染/旧 module/红队 v160/
  互斥拒绝）与 HTTP 路由安全用例全过；`scripts/tool-smoke.ts` 已加会话链。

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
