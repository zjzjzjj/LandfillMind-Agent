/**
 * LandfillMind · KB 自动蒸馏脚本（I · 真实训练）
 *
 * 流程：
 *   1. 从 feedback 队列读取待蒸馏候选
 *   2. 用 LLM 把"用户低分反馈"蒸馏为完整 KB 条目
 *      - q: 自然语言提问
 *      - pro: 专业回答（200-400 字，含国标条款）
 *      - easy: 通俗解释
 *      - cite: 标准依据
 *      - kw: 3-6 个关键词
 *   3. 保存到 knowledge-base/06-kb-data/distilled-drafts.json（待人工 review）
 *   4. （可选）调用 /api/kb/search 验证新条目是否被检索到
 *
 * 用法：
 *   tsx scripts/distill-kb.ts                    # 处理所有 pending
 *   tsx scripts/distill-kb.ts --limit 5         # 限制处理数量
 *   tsx scripts/distill-kb.ts --dry-run         # 只打印不保存
 */

import * as fs from 'fs';
import * as path from 'path';

// ---- 配置 ----
const OPENROUTER_API = process.env.OPENAI_BASE_URL ?? 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.OPENAI_MODEL ?? 'deepseek/deepseek-chat-v3-0324:free';

interface DistillCandidate {
  feedbackId: string;
  messageId: string;
  agentKey?: string;
  originalComment: string;
  suggestedFix?: string;
  status: 'pending' | 'in_progress' | 'done' | 'rejected';
  createdAt: number;
}

interface KBEntryDraft {
  feedbackId: string;
  key: string;
  module: 'm6' | 'm62';
  q: string;
  pro: string;
  easy: string;
  cite: string;
  kw: string[];
  source: string;
  confidence: number;
  generatedAt: number;
}

// ---- 工具：获取待蒸馏候选 ----
async function fetchPendingCandidates(limit: number): Promise<DistillCandidate[]> {
  try {
    const fbRes = await fetch('http://localhost:3000/api/feedback/list?limit=100');
    const fbData = await fbRes.json();
    if (!fbData.ok) return [];
    const candidates: DistillCandidate[] = fbData.items
      .filter((f: any) => f.rating === 'down' && f.comment && f.comment.length > 5)
      .slice(0, limit)
      .map((f: any) => ({
        feedbackId: f.id,
        messageId: f.messageId,
        agentKey: f.agentKey,
        originalComment: f.comment,
        status: 'pending' as const,
        createdAt: f.createdAt,
      }));
    return candidates;
  } catch (e) {
    console.error('获取候选失败：', e);
    return [];
  }
}

// ---- LLM 蒸馏：将用户反馈转 KB 条目 ----
async function distillOne(c: DistillCandidate): Promise<KBEntryDraft | null> {
  const systemPrompt = `你是 LandfillMind 系统的知识库工程师，专精填埋场工程与环境岩土。
你的任务：把"用户对 AI 回复的低分评论"蒸馏为一条结构化的 KB 条目草案。

输出 JSON（严格遵守字段）：
{
  "key": "snake-case 唯一键（限 40 字符）",
  "module": "m6" | "m62",
  "q": "自然语言提问，50-100 字",
  "pro": "专业回答，200-400 字，必须引用至少 1 个国标条款（如 CJJ 176、GB 16889、HJ 25.6 等），给出具体数值阈值",
  "easy": "通俗解释，50-100 字",
  "cite": "标准依据（GB/CJJ/HJ 代码 + 要点精神）",
  "kw": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"]
}

要求：
1. 严格基于反馈内容生成，避免幻觉（无依据不要编造条款号）
2. pro 必须含"立即/短期/长期"分级响应
3. kw 3-6 个，覆盖核心术语`;

  const userPrompt = `用户反馈（${c.agentKey ?? 'unknown'} agent）：\n"${c.originalComment}"\n\n请蒸馏为 KB 条目 JSON。`;

  try {
    const resp = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 1000,
      }),
    });
    if (!resp.ok) {
      console.error(`LLM 调用失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      return null;
    }
    const data: any = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error('LLM 输出非 JSON：', content.slice(0, 200));
      return null;
    }

    return {
      feedbackId: c.feedbackId,
      key: parsed.key ?? `feedback-${c.feedbackId.slice(0, 8)}`,
      module: parsed.module === 'm62' ? 'm62' : 'm6',
      q: parsed.q ?? '',
      pro: parsed.pro ?? '',
      easy: parsed.easy ?? '',
      cite: parsed.cite ?? 'user-feedback',
      kw: Array.isArray(parsed.kw) ? parsed.kw.slice(0, 6) : [],
      source: `distilled-from-feedback-${c.feedbackId}`,
      confidence: 0.7,
      generatedAt: Date.now(),
    };
  } catch (e) {
    console.error('LLM 调用异常：', e);
    return null;
  }
}

// ---- 验证 KB 条目 ----
async function verifyEntry(draft: KBEntryDraft): Promise<{ found: boolean; rank: number | null }> {
  try {
    const res = await fetch('http://localhost:3000/api/kb/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: draft.q, topK: 5 }),
    });
    const data: any = await res.json();
    const matches = data.entries ?? [];
    const rank = matches.findIndex((e: any) => e.key === draft.key);
    return { found: rank >= 0, rank: rank >= 0 ? rank : null };
  } catch (e) {
    return { found: false, rank: null };
  }
}

// ---- 主流程 ----
async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 10;
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  console.log('===== LandfillMind · KB 蒸馏 =====');
  console.log(`模型：${MODEL}`);
  console.log(`限制：${limit} 条`);
  if (dryRun) console.log('[dry-run] 仅打印不保存');
  if (apply) console.log('[apply] 蒸馏完成后写入 kb-entries-distilled.ts');

  const candidates = await fetchPendingCandidates(limit);
  console.log(`待蒸馏候选：${candidates.length} 条\n`);

  if (candidates.length === 0) {
    console.log('✓ 没有待蒸馏的反馈');
    return;
  }

  const drafts: KBEntryDraft[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`[${i + 1}/${candidates.length}] ${c.feedbackId.slice(0, 8)} ... `);
    const draft = await distillOne(c);
    if (!draft) {
      console.log('✗ 蒸馏失败');
      failedCount++;
      continue;
    }
    // 验证
    const v = await verifyEntry(draft);
    console.log(`✓ key=${draft.key} | ${v.found ? 'rank ' + v.rank : '新条目'}`);
    drafts.push(draft);
    successCount++;
  }

  if (!dryRun && drafts.length > 0) {
    const outFile = path.resolve(process.cwd(), 'knowledge-base/06-kb-data/distilled-drafts.json');
    let existing: KBEntryDraft[] = [];
    if (fs.existsSync(outFile)) {
      existing = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    }
    const allDrafts = [...existing, ...drafts];
    fs.writeFileSync(outFile, JSON.stringify(allDrafts, null, 2), 'utf-8');
    console.log(`\n✓ 累计蒸馏草案：${allDrafts.length} 条`);
    console.log(`  保存到：${outFile}`);
    if (apply) {
      // --apply 模式：把草案追加到 server/kb.ts（追加到一个独立数组，运行时加载）
      const appliedFile = path.resolve(process.cwd(), 'knowledge-base/06-kb-data/kb-entries-distilled.ts');
      const distilEntries = drafts.map(d => `  {
    key: ${JSON.stringify(d.key)},
    module: ${JSON.stringify(d.module)},
    kw: ${JSON.stringify(d.kw)},
    q: ${JSON.stringify(d.q)},
    pro: ${JSON.stringify(d.pro)},
    easy: ${JSON.stringify(d.easy)},
    cite: ${JSON.stringify(d.cite)},
    related: [],
  },`).join('\n');
      const stub = `/**
 * 自动蒸馏的 KB 条目（由 scripts/distill-kb.ts --apply 生成）
 * 注入方式：在 server/kb.ts 中 import 本文件，把 DISTILLED_ENTRIES push 到 KB_ENTRIES。
 * 生成时间：${new Date().toISOString()}
 * 数量：${drafts.length} 条
 */
import type { KBEntry } from '../../../server/kb';

export const DISTILLED_ENTRIES: KBEntry[] = [
${distilEntries}
];
`;
      fs.writeFileSync(appliedFile, stub, 'utf-8');
      console.log(`  ✓ 已生成可注入文件：${appliedFile}`);
      console.log(`  下一步：在 server/kb.ts 加入：`);
      console.log(`    import { DISTILLED_ENTRIES } from '../knowledge-base/06-kb-data/kb-entries-distilled';`);
      console.log(`    for (const e of DISTILLED_ENTRIES) { if (!_mergedKBKeys.has(e.key)) KB_ENTRIES.push(e); }`);
    } else {
      console.log(`  下一步：人工 review 后运行：`);
      console.log(`    tsx scripts/distill-kb.ts --apply`);
    }
  } else {
    console.log(`\n[dry-run] 不会写入文件。本次成功 ${successCount} 条 / 失败 ${failedCount} 条`);
  }
}

main().catch(e => {
  console.error('蒸馏出错：', e);
  process.exit(1);
});
