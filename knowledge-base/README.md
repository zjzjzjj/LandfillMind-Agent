# LandfillMind 知识库（Knowledge Base）

> 为 AI 智能体补充填埋场工程、环境岩土、安全应急领域的结构化资料，
> 蒸馏为可注入 KB 与训练样本的数据资产。

## 📊 资料盘点

| 文件 | 大小 | 记录/条目 | 来源 |
|---|---|---|---|
| `01-standards/standards-summary.json` | 30.9 KB | 10 部标准 | WebSearch + 政府文件 |
| `02-parameters/thresholds.json` | 22.2 KB | 113 个阈值 | 12 部规范交叉验证 |
| `03-formulas/formulas.json` | 33.6 KB | 25 个公式 | 学术文献 + 国标 |
| `03-formulas/formulas.md` | 22.9 KB | 公式文档 | 同上 |
| `04-cases/incidents.json` | 37.8 KB | 15 起真实事故（90 人遇难） | 国务院/政府调查报告 |
| `05-best-practices/safety-procedures.md` | 24.0 KB | 6 大场景 | GB 30871/51220 等 |
| `06-kb-data/kb-entries-expanded.ts` (Batch 1) | 19.6 KB | **35 条 KB 条目**（核心） | 综合蒸馏 |
| `06-kb-data/kb-entries-expanded-batch2.ts` | 21.8 KB | **30 条 KB 条目**（监测装备/应急/国际标准） | 综合蒸馏 |
| `06-kb-data/kb-entries-expanded-batch3.ts` | 22.5 KB | **26 条 KB 条目**（高级分析/工程实务/退役/特殊场地） | 综合蒸馏 |
| `06-kb-data/incident-anti-examples.ts` | 14.0 KB | **12 条反例集**（5-Why 蒸馏） | incidents.json |
| `06-kb-data/schema.json` | 2.3 KB | KB schema | — |
| `07-prompts/scenarios.ts` | 12.8 KB | **9 个 few-shot 训练场景** | 综合蒸馏 |

**总数据量**：~265 KB，**126 条 KB 条目**（已注入）+ **12 条事故反例** + **9 个训练场景**

---

## ✅ 已注入系统的资产

| 注入点 | 文件 | 增量 | 状态 |
|---|---|---|---|
| `server/kb.ts` | 知识库表 | **66 → 167 条**（+101 条，+153%） | ✅ 运行中 |
| `server/diagnose.ts` | 事故反例触发 | **12 条 5-Why 反例** 自动注入结论 + immediate | ✅ 测试通过（命中 7 条） |
| `src/utils/expertPrompts.ts` | 少样本训练 | **9 个真实场景** 注入 5 个专家角色 system prompt | ✅ 已加载 |

---

## 📂 目录结构

```
knowledge-base/
├── 01-standards/                            # 国标/行标摘要
│   └── standards-summary.json              # 10 部标准·核心阈值
├── 02-parameters/                           # 工程参数阈值
│   └── thresholds.json                     # 15 大类·113 个阈值
├── 03-formulas/                             # 计算公式
│   ├── formulas.json                       # 9 类·25 个公式·JSON 结构化
│   └── formulas.md                         # 文档版
├── 04-cases/                                # 真实事故案例
│   └── incidents.json                      # 15 起·5-Why·规范违反
├── 05-best-practices/                       # 作业最佳实践
│   └── safety-procedures.md                # 6 大场景·应急流程
├── 06-kb-data/                              # 结构化 KB 数据（可直接注入）
│   ├── schema.json                         # KB 条目 schema
│   └── kb-entries-expanded.ts              # ★ 35 条 KB 条目（合并到 server/kb.ts）
├── 07-prompts/                              # 训练提示词
│   └── scenarios.ts                        # ★ 9 个 few-shot 训练场景
└── README.md                                # 本文件
```

---

## 🎯 注入路径

### 路径 A：KB 表扩充（立即生效）

将 `06-kb-data/kb-entries-expanded.ts` 中的 35 条新条目合并到 `server/kb.ts`：

```typescript
// server/kb.ts 末尾追加：
import { EXPANDED_KB } from '../knowledge-base/06-kb-data/kb-entries-expanded';
const existingKeys = new Set(KB.map(e => e.key));
export const KB = [...KB, ...EXPANDED_KB.filter(e => !existingKeys.has(e.key))];
// KB 表从 66 → 101 条
```

### 路径 B：计算器阈值校准

将 `02-parameters/thresholds.json` 中的阈值覆盖 `server/calculate.ts` 中各计算器的 grade 判定逻辑：

```typescript
import thresholds from '../knowledge-base/02-parameters/thresholds.json';
const Fs = thresholds.slope_stability_Fs;
// 替换现有硬编码阈值
```

### 路径 C：多智能体 few-shot 训练

将 `07-prompts/scenarios.ts` 中的 9 个场景拼入 `src/utils/expertPrompts.ts` 各 agent 的 system prompt：

```typescript
import { TRAINING_SCENARIOS } from '../../knowledge-base/07-prompts/scenarios';
const examples = TRAINING_SCENARIOS.filter(s => s.agentKey === agentKey);
const systemPrompt = `${base}\n## 训练示例\n${examples.map(formatExample).join('\n')}`;
```

### 路径 D：双引擎验证增强

将 `04-cases/incidents.json` 中的事故根因（5-Why）蒸馏到 `server/diagnose.ts` 的 `verifyReportAgainstKernel` 中，作为反例参考。

---

## 📈 数据亮点

### 1. 阈值精校（阈值表新增覆盖）

| 类别 | 之前 | 现在 | 关键差异 |
|---|---|---|---|
| Fs 阈值 | 单一 1.30 | **运行期 1.30 / 封场后 1.20 / 地震 1.10** | 三档工况分级 |
| CH₄ 报警 | 单一阈值 | **1.25%/2.50%/5%/15%** 四级 | 区分预警/爆炸/撤离 |
| 渗滤液液位 | 无标准 | **2m/1m/0.3m** 三级 | 距衬层顶部 |
| 沉降速率 | 无 | **10/20/30 mm/天** 三色预警 | 与 CJJ 176 对齐 |
| H₂S | 笼统 | **5/10/100 ppm**（预警/撤离/IDLH） | 区分嗅觉疲劳 |

### 2. 公式补全（25 个新公式）

- 边坡：瑞典圆弧 + Bishop 简化 + Janbu + 拟静力 kh
- 渗滤液：HELP 模型 + 经验法 Q = C·A·I
- 填埋气：LandGEM 一阶衰减 + IPCC 经验 k
- 沉降：双曲线法 + 次压缩
- HDPE：应变 + 焊缝强度
- 复合衬垫：调和平均等效 K + Giroud 缺陷渗漏
- 地下水：Ogata-Banks 解析解 + 循环井半径
- 库容：矩形/台体/平均断面法

### 3. 案例蒸馏（15 起真实事故）

| 案例 | 类型 | 死亡 | 关键根因 |
|---|---|---|---|
| 深圳 12·20 (2015) | 滑坡 | 73 | 违规超高堆填 + 失稳 |
| 杭州天子岭 (2022) | H₂S 中毒 | 2 | 未戴 SCBA + 盲目施救 |
| 深圳下坪 (2019) | 暴雨滑坡 | — | 渗滤液水位抬升 |
| 北京安定 (2021) | 物体打击 | 1 | 安全距离不足 |
| 哈尔滨京环 (2021) | 溃坝 | — | 超库容运行 |
| …（共 15 起） | | 90 总计 | |

每起含：日期/位置/类型/伤亡/5-Why/教训/规范违反/来源 URL。

### 4. 安全流程（6 大场景）

- PPE / 气体监测 / 有限空间 / 动火
- 日常作业 / 监测频率 / 应急响应 / 封场 / 合规

---

## 🔧 已注入示例

将以下两个文件接入系统后效果立即可见：

### A. `06-kb-data/kb-entries-expanded.ts` → `server/kb.ts`

35 条新 KB 条目，覆盖原 KB 表未涉及的 25+ 关键概念（HDPE 规格、复合衬垫等效 K、双曲线沉降预测、有限空间 PPE 要求等）。

### B. `07-prompts/scenarios.ts` → `src/utils/expertPrompts.ts`

9 个真实场景的少样本学习，教会 LLM：
1. 引用具体国标条款（CJJ 176-2012 §4.5.5）
2. 给出数值计算步骤（Bishop 法 Fs）
3. 分级响应清单（立即/24h/72h）
4. 联系历史案例（天子岭 H₂S）
5. 给出可执行的工程量建议

---

## 📅 版本

- **v1.0** · 2026-08-22 · 初始结构建立，5 路并行搜索 + 数据蒸馏
- **v1.1** · 2026-08-22 · 知识库 3 批扩充（66 → 167 条）+ 事故反例（12 条 5-Why 蒸馏）+ 训练场景（9 个 few-shot）—— **总计 126 KB 条目已注入系统**
  - 10 部标准摘要
  - 113 个参数阈值
  - 25 个计算公式
  - 15 起真实事故案例
  - 6 大作业场景
  - 35 条 KB 条目
  - 9 个训练场景
  - 总计 ~210 KB 结构化数据资产

## 💡 后续优化方向

- [ ] 蒸馏更细的 few-shot（每 agent 至少 10 个场景）
- [ ] 加入英文学术文献作为补充（国际工程实践）
- [ ] 接入实时数据更新（每月检查标准更新）
- [ ] 用 LLM 生成 Q&A pairs 进一步扩充 KB
- [ ] 把阈值表导出为可视化卡片（PDF 应急手册）
