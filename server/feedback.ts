/**
 * LandfillMind · 用户反馈系统（E · 反馈闭环）
 *
 * 功能：
 *   1. 用户对 AI 回复打分（👍/👎 + 文字评论）
 *   2. 后端聚合统计（好评率/低分条目）
 *   3. 自动识别低分条目 → 生成 KB 蒸馏候选
 *
 * 数据流：
 *   用户点击 → POST /api/feedback → 内存存储（LRU + TTL，见下方实现）
 *   管理员查看 → GET /api/feedback/stats
 *   自动蒸馏 → /api/feedback/distill（自动用 LLM 生成改进版 KB 条目）
 */

import { v4 as uuidv4 } from 'uuid';

export type FeedbackRating = 'up' | 'down';

export interface DbFeedback {
  id: string;
  sessionId: string;
  messageId: string;
  rating: FeedbackRating;
  comment?: string;
  /** 反馈时的 agent key（slope/leachate/lfg/gw/summary/unknown） */
  agentKey?: string;
  /** 反馈时的模型 ID */
  model?: string;
  /** 该消息引用的 KB 条目 */
  kbRefs?: string[];
  /** AB test 变体（如果启用） */
  abVariant?: string;
  /** 时间戳 */
  createdAt: number;
}

/**
 * SQLite 表结构（参考设计，未落地——当前为内存实现，见下方注释）：
 *   CREATE TABLE feedback (
 *     id TEXT PRIMARY KEY,
 *     session_id TEXT,
 *     message_id TEXT,
 *     rating TEXT,
 *     comment TEXT,
 *     agent_key TEXT,
 *     model TEXT,
 *     kb_refs TEXT,    -- JSON array
 *     ab_variant TEXT,
 *     created_at INTEGER
 *   );
 */

// ===== 内存实现（生产可替换为 SQLite） =====
// M1 修复：带 LRU + TTL 的有界 Map（默认最多 5000 条，30 天自动过期）
const MAX_FEEDBACK_ENT = 5000;
const FEEDBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const memoryStore = new Map<string, DbFeedback>();
const distillStore = new Map<string, DistillCandidate>();

function evictExpired<T extends { createdAt?: number; updatedAt?: number }>(
  store: Map<string, T>, ttl: number,
): void {
  const now = Date.now();
  for (const [k, v] of store) {
    const t = v.createdAt ?? v.updatedAt;
    if (t && now - t > ttl) store.delete(k);
  }
}

export function saveFeedback(fb: Omit<DbFeedback, 'id' | 'createdAt'>): DbFeedback {
  const entry: DbFeedback = {
    ...fb,
    id: uuidv4(),
    createdAt: Date.now(),
  };
  // LRU 写入 + 容量上限
  memoryStore.set(entry.id, entry);
  if (memoryStore.size > MAX_FEEDBACK_ENT) {
    // 删除最旧的 10%（避免每次都从头删）
    const toDelete = Array.from(memoryStore.keys()).slice(0, Math.floor(MAX_FEEDBACK_ENT * 0.1));
    for (const k of toDelete) memoryStore.delete(k);
  }
  // 每 100 次写入触发一次过期清理（防累积）
  if (memoryStore.size % 100 === 0) evictExpired(memoryStore, FEEDBACK_TTL_MS);
  console.log(`[feedback] ${entry.rating === 'up' ? '👍' : '👎'} session=${entry.sessionId.slice(0, 8)} message=${entry.messageId.slice(0, 8)} (${memoryStore.size}/${MAX_FEEDBACK_ENT})`);
  return entry;
}

export function listFeedback(limit = 100): DbFeedback[] {
  evictExpired(memoryStore, FEEDBACK_TTL_MS); // 返回前清理
  return Array.from(memoryStore.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * 按天聚合反馈（用于趋势图）
 */
export function feedbackTrendByDay(days = 14): { date: string; up: number; down: number }[] {
  const now = Date.now();
  const buckets: Record<string, { up: number; down: number }> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = { up: 0, down: 0 };
  }
  for (const fb of memoryStore.values()) {
    const key = new Date(fb.createdAt).toISOString().slice(0, 10);
    if (buckets[key]) {
      buckets[key][fb.rating]++;
    }
  }
  return Object.entries(buckets).map(([date, v]) => ({ date, ...v }));
}

export function getFeedbackStats(): {
  total: number;
  up: number;
  down: number;
  upRate: number;
  downRate: number;
  recentTrend: 'up' | 'down' | 'flat';
  byAgent: Record<string, { up: number; down: number }>;
  lowScoreComments: DbFeedback[];
  /** 蒸馏候选：低分且有评论的（可触发自动 KB 改进） */
  distillCandidates: DbFeedback[];
} {
  const all = listFeedback(1000);
  const up = all.filter(f => f.rating === 'up').length;
  const down = all.filter(f => f.rating === 'down').length;
  const total = up + down;

  // 最近 10 条 vs 前 10 条对比 → 趋势
  const recent10 = all.slice(0, 10);
  const previous10 = all.slice(10, 20);
  const recentUpRate = recent10.length ? recent10.filter(f => f.rating === 'up').length / recent10.length : 0;
  const prevUpRate = previous10.length ? previous10.filter(f => f.rating === 'up').length / previous10.length : 0;
  const recentTrend = recentUpRate > prevUpRate + 0.1 ? 'up' : recentUpRate < prevUpRate - 0.1 ? 'down' : 'flat';

  // 按 agent 分组
  const byAgent: Record<string, { up: number; down: number }> = {};
  for (const f of all) {
    const k = f.agentKey || 'unknown';
    if (!byAgent[k]) byAgent[k] = { up: 0, down: 0 };
    byAgent[k][f.rating]++;
  }

  // 低分条目（按时间倒序）
  const lowScoreComments = all.filter(f => f.rating === 'down').slice(0, 20);

  // 蒸馏候选：低分 + 有评论 + 时间近（7 天内）
  const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
  const distillCandidates = all.filter(f =>
    f.rating === 'down' && f.comment && f.comment.length > 5 && f.createdAt > sevenDaysAgo
  );

  return {
    total,
    up,
    down,
    upRate: total ? up / total : 0,
    downRate: total ? down / total : 0,
    recentTrend,
    byAgent,
    lowScoreComments,
    distillCandidates,
  };
}

/**
 * 把反馈蒸馏为 KB 改进候选
 * （实际生产可调用 LLM 自动改写 KB 条目）
 */
export interface DistillCandidate {
  feedbackId: string;
  messageId: string;
  agentKey?: string;
  originalComment: string;
  suggestedFix?: string;
  status: 'pending' | 'in_progress' | 'done' | 'rejected';
  createdAt: number;
}

export function enqueueDistill(fb: DbFeedback, suggestedFix?: string): DistillCandidate {
  const c: DistillCandidate = {
    feedbackId: fb.id,
    messageId: fb.messageId,
    agentKey: fb.agentKey,
    originalComment: fb.comment ?? '',
    suggestedFix,
    status: 'pending',
    createdAt: Date.now(),
  };
  distillStore.set(c.feedbackId, c);
  return c;
}

export function listDistillCandidates(): DistillCandidate[] {
  return Array.from(distillStore.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 把蒸馏候选转成 KB 条目草案（占位函数，生产可调用 LLM）
 */
export function distillToKBEntry(c: DistillCandidate): {
  key: string;
  q: string;
  pro: string;
  easy: string;
  cite: string;
} | null {
  if (!c.originalComment || c.originalComment.length < 10) return null;
  // H3 修复：明确加括号，消除 ?? 与 + 的优先级歧义
  // 语义：suggestedFix 存在则用它，否则拼 "..." + 评论
  const proContent = c.suggestedFix ?? `基于用户反馈 #${c.feedbackId.slice(0, 8)} 的改进建议：${c.originalComment}`;
  return {
    key: `feedback-${c.feedbackId.slice(0, 8)}`,
    q: `[来自用户反馈] ${c.originalComment.slice(0, 50)}...`,
    pro: proContent,
    easy: '该条目来自用户低分反馈，待审核后加入 KB。',
    cite: 'user-feedback',
  };
}
