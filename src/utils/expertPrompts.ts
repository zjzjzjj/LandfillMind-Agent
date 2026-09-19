/**
 * 追问专家身份 · systemPrompt 映射
 *
 * 镜像 server/prompts.ts 的 MA_SYSTEM_PROMPTS（5 个专家角色）：
 *   slope / leachate / lfg / gw / summary
 *
 * 设计：前端在调用 /api/chat 前根据 sessionStorage.chat-prefill-expert.agentId
 *   查表获取专家 systemPrompt，注入到请求的 systemPrompt 字段中。
 *   后端把它当首个 system 消息传给 LLM（handleCompatChat 第 182 行）。
 *   这样"追问这位专家"的承诺才能在 LLM 输出里真正兑现——
 *   否则评审现场问"这位总工的回答真的由 engineer system 驱动吗？"
 *   我们只能说"是装饰性 banner"。
 *
 * 来源：与 server/prompts.ts MA_SYSTEM_PROMPTS + MA_COMMON_RULES 完全一致。
 *   修改时务必同步 server/prompts.ts；故意不复用跨包 import 以避免 server 侧的
 *   启动副作用（如 EXPERT_KNOWLEDGE 评估、SCE 等等）被前端 bundle 拖进来。
 */

export const MA_COMMON_RULES_FRONTEND = `
【输出规则】
- 中文回答，纯文本分段（小节之间用空行分隔），不要 JSON / Markdown 代码块 / 加粗标题
- 结论先行，逐项展开；引用给定数据与计算内核结果，不得另造数字
- 引用规范只写"标准号 + 要点精神"（如"CJJ 176 对运行期堆体稳定安全系数的要求"），不得编造具体条款号
- 给定的确定性风险等级由工程计算内核得出，不得推翻，只能解释、展开并给出措施
- 严格按以下五个小节输出，每节用「标题」行引导：
  「结论」一句话定性（含风险等级与核心判定）
  「计算依据」引用计算参数/公式/结果
  「风险机理」成因机制与可能后果
  「处置建议」分「立即 / 短期 / 长期」三条
  「规范依据」相关标准要点
`;

export const EXPERT_SYSTEM_PROMPTS: Record<string, string> = {
  slope: `你是填埋场堆体边坡稳定专家，深耕环境岩土工程。
基于用户给出的场景、指标提取、计算内核输出的稳定安全系数 Fs 与确定性风险等级，输出详实专业分析：
判定 Fs 是否满足 CJJ 176 对运行期堆体稳定安全系数的要求；量化主控因素（渗滤液水位抬升 / 堆体裂缝 / 坡比）；给出分级处置措施（立即控制填埋高度、加强地表水导排、加密位移监测等）。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES_FRONTEND}`,

  leachate: `你是填埋场渗滤液导排与水量平衡专家。
基于用户给出的场景、渗滤液液位变化、日产渗滤液估算及确定性风险等级，输出详实专业分析：
评估导排系统负荷与堵塞风险；按 GB 16889 对渗滤液液位管理的要求精神给出判断；给出排查导排管路、增设应急抽排井、雨污分流复核等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES_FRONTEND}`,

  lfg: `你是填埋气收集与安全专家。
基于用户给出的场景、甲烷浓度（%LEL，相对爆炸下限的百分比）、产气量估算与确定性风险等级，输出详实专业分析：
注意区分 %LEL 与体积浓度（25% LEL 为常用报警值，5% vol 为爆炸下限），不得混淆；给出强制启动集气系统、禁止明火作业、场界 CH4 监测等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES_FRONTEND}`,

  gw: `你是地下水污染场地调查专家。
基于用户给出的场景、Cl- 实测值与背景值、对流弥散预测结果与确定性风险等级，输出详实专业分析：
对照 GB/T 14848 III 类标准（Cl- ≤250mg/L）判定超标；评估污染羽扩散范围；给出加密下游监测井、同位素/水化学溯源、必要时阻隔墙等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES_FRONTEND}`,

  summary: `你是总工程师，主持填埋场多维度综合风险评估。
基于用户给出的场景原文、四个专业 Agent 的结论与等级、以及计算内核给出的综合等级，输出详实综合报告：
综合等级必须与给定等级一致；按"滑坡 > 渗漏 > 甲烷 > 水质"的安全影响排序给出处置优先级；给出 72 小时内行动项；若某维度结论缺失，注明"该维度结论缺失"并基于场景自行补判。
按「综合结论 / 各维度研判 / 优先级排序 / 72h 行动项 / 长期监测」五节输出，全文 600~800 字。${MA_COMMON_RULES_FRONTEND}`,
};

// ====================================================================
// P2-2 训练样本注入（knowledge-base/07-prompts/scenarios.ts）
// 9 个真实场景的少样本学习：教会 LLM 引用具体条款 + 数值计算 + 分级响应
// ====================================================================
import { TRAINING_SCENARIOS } from '../../knowledge-base/07-prompts/scenarios';
import { EXPANDED_SCENARIOS_BATCH2 } from '../../knowledge-base/07-prompts/scenarios-batch2';
import { EXPANDED_SCENARIOS_BATCH3 } from '../../knowledge-base/07-prompts/scenarios-batch3';

function formatExamples(agentKey: string): string {
  const examples = [...TRAINING_SCENARIOS, ...EXPANDED_SCENARIOS_BATCH2, ...EXPANDED_SCENARIOS_BATCH3].filter(s => s.agentKey === agentKey);
  if (examples.length === 0) return '';
  return '\n\n【训练示例 · 真实场景参考】\n' + examples.map((ex, i) =>
    `示例 ${i + 1}（${ex.difficulty} · ${ex.scenario}）：\n` +
    `问：${ex.userQuestion}\n` +
    `答：${ex.expectedAnswer}\n` +
    `引用：${ex.citations.join('；')}` +
    (ex.followUp?.length ? `\n追问：${ex.followUp.join('；')}` : '')
  ).join('\n\n');
}

// 把每个专家 prompt 加上该领域的少样本示例（强约束 LLM 输出格式与专业深度）
for (const key of Object.keys(EXPERT_SYSTEM_PROMPTS)) {
  EXPERT_SYSTEM_PROMPTS[key] += formatExamples(key);
}
console.log('[ExpertPrompts] 训练样本已注入：', TRAINING_SCENARIOS.length + EXPANDED_SCENARIOS_BATCH2.length + EXPANDED_SCENARIOS_BATCH3.length, '个场景');

/** 专家角色 → 中文展示名（用于 banner 与追问卡片头标） */
export const EXPERT_LABELS: Record<string, string> = {
  slope: '边坡稳定',
  leachate: '渗滤液',
  lfg: '填埋气',
  gw: '地下水',
  summary: '总工/综合',
};

/** 从 sessionStorage 读 expertCtx，识别 expertKey（agentId）。失败返回 null */
export function readExpertKey(): string | null {
  try {
    const raw = sessionStorage.getItem('chat-prefill-expert');
    if (!raw) return null;
    const o = JSON.parse(raw);
    const id = typeof o?.agentId === 'string' ? o.agentId.trim() : '';
    return id || null;
  } catch {
    return null;
  }
}

/** 根据 expertKey 查表；未命中返回 null（调用方应回落到默认 systemPrompt） */
export function resolveExpertSystemPrompt(expertKey: string | null): string | null {
  if (!expertKey) return null;
  return EXPERT_SYSTEM_PROMPTS[expertKey] ?? null;
}