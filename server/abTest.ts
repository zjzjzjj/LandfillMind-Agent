/**
 * LandfillMind · A/B 测试框架（G · 强化学习式 prompt 调优）
 *
 * 思路（简化版 bandit）：
 *   1. 多个 prompt 变体并存（baseline + 优化变体）
 *   2. 每个新会话随机分配到一个变体
 *   3. 通过用户反馈（E 系统）累积 reward
 *   4. 根据 Epsilon-Greedy / UCB1 策略动态调整分配权重
 *   5. 优胜变体作为下一阶段基线
 *
 * 真实 RL 升级路径：
 *   - 用历史反馈作为 reward signal
 *   - 用 bandit 策略自动选择最优变体
 *   - 周/月级别自动重训 prompt（结合 incidents + KB）
 */

export type VariantId = 'baseline' | 'v2-expert' | 'v3-formal';

export interface PromptVariant {
  id: VariantId;
  name: string;
  description: string;
  /**
   * 在基础专家 prompt 之上追加的强化指令
   */
  enhancement: string;
  /**
   * 该变体的优先级权重（越高越常被选中，UCB1 会动态调整）
   */
  weight: number;
  /**
   * 该变体收到的反馈统计
   */
  stats: {
    impressions: number;  // 被选中的次数
    upCount: number;
    downCount: number;
  };
  enabled: boolean;
}

/**
 * 内置变体定义
 */
const VARIANTS: Record<VariantId, PromptVariant> = {
  baseline: {
    id: 'baseline',
    name: '基线（当前默认）',
    description: 'MA_COMMON_RULES_FRONTEND 标准输出',
    enhancement: '',
    weight: 1.0,
    stats: { impressions: 0, upCount: 0, downCount: 0 },
    enabled: true,
  },
  'v2-expert': {
    id: 'v2-expert',
    name: 'v2 专家级（加强引用条款 + 数值）',
    description: '要求 LLM 引用具体国标条款号 + 数值阈值 + 5-Why 反例关联',
    enhancement: `
【强化指令】
1. 必须引用至少 2 个具体国标条款（如"按 CJJ 176-2012 §4.5.5"）
2. 关键阈值必须给出具体数值（如"Fs ≥ 1.30"而非"需要达到较高值"）
3. 关联历史事故：若场景与某起事故相似，主动引用（如"参照深圳 12·20 教训"）
4. 强制按"立即/24h/72h/长期"四档分级响应
`,
    weight: 1.0,
    stats: { impressions: 0, upCount: 0, downCount: 0 },
    enabled: true,
  },
  'v3-formal': {
    id: 'v3-formal',
    name: 'v3 工程报告级（强结构化输出）',
    description: '要求完整章节格式 + 计算步骤展示 + 风险矩阵',
    enhancement: `
【强化指令】
1. 输出必须包含：结论 / 计算依据 / 风险机理 / 处置建议（分立即/短期/长期）/ 规范依据 五大节
2. 计算步骤必须给出公式 + 变量代入（用纯文本，避免 LaTeX）
3. 风险机理包含：直接原因 → 间接原因 → 系统原因（5-Why 风格）
4. 处置建议必须量化（如"启用 2 台 50 m³/h 抽排泵"）
5. 规范依据写明标准号 + 章节号 + 关键阈值
`,
    weight: 1.0,
    stats: { impressions: 0, upCount: 0, downCount: 0 },
    enabled: true,
  },
};

/**
 * 选择变体（Epsilon-Greedy with decay）
 * 探索率随样本量衰减：前 100 次 20% 探索，之后 5%
 */
export function selectVariant(): PromptVariant {
  const enabled = Object.values(VARIANTS).filter(v => v.enabled);
  if (enabled.length === 0) return VARIANTS.baseline;

  const totalImpressions = enabled.reduce((s, v) => s + v.stats.impressions, 0);
  const epsilon = totalImpressions < 100 ? 0.2 : 0.05;

  if (Math.random() < epsilon) {
    // 探索：随机选
    return enabled[Math.floor(Math.random() * enabled.length)];
  }

  // 利用：UCB1 选择
  let best: PromptVariant | null = null;
  let bestScore = -Infinity;
  const logTotal = Math.log(Math.max(2, totalImpressions));
  for (const v of enabled) {
    const n = Math.max(1, v.stats.impressions);
    const total = Math.max(1, v.stats.upCount + v.stats.downCount);
    const successRate = total > 0 ? v.stats.upCount / total : 0.5;
    const ucb = successRate + Math.sqrt(2 * logTotal / n);
    if (ucb > bestScore) {
      bestScore = ucb;
      best = v;
    }
  }
  return best ?? VARIANTS.baseline;
}

export function getAllVariants(): PromptVariant[] {
  return Object.values(VARIANTS);
}

export function getVariant(id: VariantId): PromptVariant {
  return VARIANTS[id];
}

/**
 * 记录反馈（被 feedback.ts 调用）
 */
export function recordFeedback(variantId: VariantId, rating: 'up' | 'down'): void {
  const v = VARIANTS[variantId];
  if (!v) return;
  if (rating === 'up') v.stats.upCount++;
  else v.stats.downCount++;
  // 更新权重（成功率高 → 权重 +5%）
  const total = Math.max(1, v.stats.upCount + v.stats.downCount);
  const rate = v.stats.upCount / total;
  v.weight = Math.max(0.1, Math.min(2.0, rate * 2));
}

/**
 * 记录曝光（每次使用某个变体时）
 */
export function recordImpression(variantId: VariantId): void {
  const v = VARIANTS[variantId];
  if (!v) return;
  v.stats.impressions++;
}

/**
 * 获取变体的 systemPrompt 增强文本
 */
export function getVariantEnhancement(variantId: VariantId): string {
  return VARIANTS[variantId]?.enhancement ?? '';
}

/**
 * 输出 A/B 测试统计
 */
export function getABStats(): {
  variants: PromptVariant[];
  totalFeedback: number;
  bestVariant: VariantId | null;
  summary: string;
} {
  const variants = getAllVariants();
  const totalFeedback = variants.reduce((s, v) => s + v.stats.upCount + v.stats.downCount, 0);
  const ranked = [...variants].filter(v => v.stats.impressions > 5);
  ranked.sort((a, b) => {
    const ra = a.stats.upCount / Math.max(1, a.stats.upCount + a.stats.downCount);
    const rb = b.stats.upCount / Math.max(1, b.stats.upCount + b.stats.downCount);
    return rb - ra;
  });
  const bestVariant = ranked[0]?.id ?? null;

  const lines: string[] = [];
  for (const v of variants) {
    const total = v.stats.upCount + v.stats.downCount;
    const rate = total ? (v.stats.upCount / total * 100).toFixed(1) : 'N/A';
    lines.push(`  ${v.id}: 曝光 ${v.stats.impressions} | 👍 ${v.stats.upCount} / 👎 ${v.stats.downCount} | 好评率 ${rate}% | 权重 ${v.weight.toFixed(2)}`);
  }
  const summary = `总反馈 ${totalFeedback} 条\n` + lines.join('\n') + (bestVariant ? `\n\n当前最佳变体: ${bestVariant}` : '\n\n样本量不足，暂无最佳变体');

  return { variants, totalFeedback, bestVariant, summary };
}
