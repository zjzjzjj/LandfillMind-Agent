# 知识库扩充 · 收集协议（COLLECT-PROTOCOL）

> 2026-09-22 启动的"填埋场全领域文献/规范/KB 扩充"长程任务的统一作业规范。
> 每个收集子代理（collection agent）开工前必须先读本文件 + `existing-keys.txt`。

## 0. 铁律：反幻觉

本项目历史上出现过 **LLM 规范数值跨次漂移** 与 **参数被静默改写** 的事故，因此：

1. **只记录真实检索到的条目**。每一条文献/规范必须出现在你的 WebSearch 结果或你 WebFetch 的页面里；搜不到 = 不写，宁可少不可编。
2. **禁止编造 DOI、条文号、页码、作者**。不确定作者就写检索结果里出现的通讯作者/机构；不确定的 DOI 留空。
3. 每条记录带 `provenance`（确认它存在的 URL）和 `confidence`：
   - `verified`：在检索结果/页面里直接看到标题+关键信息；
   - `snippet-only`：只在搜索片段里露过面，细节不全。
4. **蒸馏进 KB 条目的 `pro` 字段的任何数值，必须有 `verified` 来源或属于教科书公认常识**；否则用定性表述。
5. 中文条目用中文记录，英文条目保留英文原题，`language` 字段区分。

## 1. 输出文件（每个代理恰好两个）

- `knowledge-base/08-references/raw/<domain>.json` — 文献/规范/书籍清单
- `knowledge-base/06-kb-data/kb-entries-<domain>.ts` — 蒸馏后的 KB 条目（数量见各自任务书）

**不要改动** `server/kb.ts`、README、其他批次的文件（中央合并由主控完成）。

### 1.1 references JSON 格式

```json
{
  "domain": "lfg",
  "collected_at": "2026-09-22",
  "agent": "collection agent 名",
  "references": [
    {
      "id": "lfg-001",
      "type": "journal | conference | book | standard | thesis | report | guideline | policy | website",
      "language": "zh | en",
      "title": "原题",
      "authors": "第一作者 等 / 机构（可不全，不得编）",
      "year": 2021,
      "venue": "期刊名/发布机构/会议名",
      "doi_or_url": "DOI 或 URL（没有留空）",
      "std_no": "仅标准类：如 GB 16889-2024",
      "status": "仅标准类：现行/即将实施/废止/征求意见；强制/推荐",
      "summary": "一句话：解决什么问题/给出什么结论",
      "key_values": "关键数值/限值（附条款），没有留空；必须 verified 才写",
      "provenance": "确认存在的 URL",
      "confidence": "verified | snippet-only"
    }
  ]
}
```

### 1.2 KB 条目 TS 格式（与既有批次完全一致）

```ts
/**
 * LandfillMind 知识库扩充 · <主题>批
 * 追加 N 条 KB 条目（m6 X 条 + m62 Y 条）
 * 覆盖范围：…（列出）
 * 命名约定：key 前缀 <前缀>-，去重由 server/kb.ts 合并逻辑保证。
 */

import type { KBEntry } from '@server/kb';

export const EXPANDED_KB_<DOMAIN_UPPER>: KBEntry[] = [
  {
    key: '<前缀>-xxx',            // 必须唯一，不与 existing-keys.txt 中 226 个 key 冲突
    module: 'm6',                 // m6=填埋场 / m62=地下水污染场地
    kw: ['渗滤液', 'xxx', 'yyy'], // 6-9 个关键词，含用户可能问到的中英文别名
    q: '口语化的问题？',
    pro: '专业回答：编号分点，给数值必须带出处；这是检索/推理的主字段。',
    easy: '给非专业人员的两三句大白话。',
    cite: 'GB 16889-2024 §7.x / 作者等 (年份) 期刊',
    clause: '条文原文要点摘录或论文核心结论一句话。',
    related: ['既有key或本批key'],
    // calc 字段一般省略（本项目计算器以既有为准）
  },
];
```

- `type KBEntry` 的完整接口见 `server/kb.ts` 顶部（key/module/kw/q/pro/easy/cite/clause/related/calc?）。
- **字符串里不得出现未转义单引号**；引用规范条款时用中文引号「」或直接去引号，避免 TS 语法错误。
- 写完后自己用 `node -e "require('fs').readFileSync(...)"` 之类不必跑，但**保证语法完整可编译**（主控会跑 `npm run typecheck`）。

## 2. 检索策略

- 每个子主题至少 2-3 组不同关键词（中英文交替）；标准类搜"标准名 + 现行 + 代替"；论文类搜"主题 + review/meta-analysis/案例/机理"。
- 优先来源：政府/标准馆（std.samr.gov.cn、生态环境部、住建部公告页）、期刊官网、ScienceDirect、MDPI、CNKI 摘要页、EPA/EU 官网。
- 目标条数见任务书；**接近目标时提高深度而不是注水**——每条 summary 要真的读过 snippet 后写。

## 3. KB 蒸馏规范

- 主题选"用户真的会问"的点：设计参数、限值、选型、故障处置、判据、公式思想。
- 与 existing-keys.txt 主题重复时**必须换角度**（更深、更新、数值修订），并考虑新 key。
- 若发现既有 66 条里引用的标准已被新版替代（如 GB 16889-2008→2024），不要改旧文件——在你的批次里新增"新版对照"条目并在 `pro` 里写明差异。
- 每条 pro 建议 150-400 字，密度对标 `kb-entries-expanded-batch4.ts`（先读它找感觉）。

## 4. 完成后返回（给主控的最终报告，越短越好）

1. 两个文件路径 + 条目数（references 条数 / KB 条数）
2. 发现的标准更新（"旧 KB 引用已过期"清单）—— 只列事实
3. 你认为最有价值的 3-5 条发现（一句话/条）
4. 未覆盖的缺口（诚实声明，供主控补派）
