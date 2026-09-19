/**
 * LLM 双通道统一入口（server 侧共享模块）
 *
 * 默认唯一通道：智谱 GLM 直连（默认 glm-4-flash-250414），免费档并发=1 串行队列
 * 可选通道：OpenRouter（配置 OPENROUTER_API_KEY 后启用），并发信号量上限 3
 *
 * 职责：
 *  1) resolveCfgForModel(model) —— 按模型 id 路由到正确通道
 *  2) enqueueLLM() —— GLM 串行队列；enqueueParallelLLM() —— OpenRouter 并发信号量
 *  3) llmComplete() —— 非流式文本完成：超时 + 退避重试 + 主备通道 fallback，
 *     永远返回 string | null，不抛错（null = 调用方走确定性模板兜底）
 */

// ============ 配置解析 ============
export interface CompatCfg {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
  label: string;
  kind: 'openrouter' | 'glm' | 'compat';
  concurrency: 'parallel' | 'serial';
}

function parseModelList(raw: string | undefined, fallback: string): string[] {
  const list = (raw ?? fallback).split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

/** OpenRouter 主通道配置 */
export function resolveOpenRouter(): CompatCfg | null {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const model = process.env.OPENROUTER_MODEL || 'dots-studio/dots-3-note-preview:free';
  return {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    model,
    models: parseModelList(process.env.OPENROUTER_MODELS, model),
    label: process.env.OPENROUTER_LABEL || 'OpenRouter',
    kind: 'openrouter',
    concurrency: 'parallel',
  };
}

/** 智谱 GLM 直连备通道（沿用 OPENAI_* 环境变量） */
export function resolveGlm(): CompatCfg | null {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = process.env.OPENAI_MODEL || 'glm-4-flash-250414';
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/$/, ''),
    model,
    models: parseModelList(process.env.OPENAI_MODELS, model),
    label: process.env.OPENAI_LABEL || '智谱 GLM（直连）',
    kind: 'glm',
    concurrency: 'serial',
  };
}

function legacyDeepSeek(): CompatCfg | null {
  if (!process.env.DEEPSEEK_API_KEY) return null;
  return {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '') + '/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat'],
    label: 'DeepSeek',
    kind: 'compat',
    concurrency: 'parallel',
  };
}

/** 兼容旧入口：OpenRouter 优先，其次 GLM 直连，最后旧 DEEPSEEK_* */
export function resolveCompat(): CompatCfg | null {
  return resolveOpenRouter() ?? resolveGlm() ?? legacyDeepSeek();
}

/** 全部可用通道（主 → 备） */
export function allProviders(): CompatCfg[] {
  return [resolveOpenRouter(), resolveGlm(), legacyDeepSeek()].filter(Boolean) as CompatCfg[];
}

/** 按模型 id 路由通道：deepseek/*、nvidia/*、z-ai/*、dots-studio/* → OpenRouter；glm-* 裸名 → GLM 直连 */
export function resolveCfgForModel(model: string | undefined): CompatCfg | null {
  if (!model || model === 'codebuddy') return resolveCompat();
  if (model.startsWith('deepseek/') || model.startsWith('nvidia/') || model.startsWith('z-ai/') || model.startsWith('dots-studio/')) {
    return resolveOpenRouter() ?? resolveCompat();
  }
  // 注：OpenRouter 上同一厂商可能有多种模型，按前缀路由即可，不再二次校验模型清单
  if (model.startsWith('glm')) {
    return resolveGlm() ?? resolveCompat();
  }
  return resolveCompat();
}

// ============ 回答详细度三档（max_tokens 映射 + 供应商钳制） ============
export type DetailLevel = 'brief' | 'standard' | 'detailed';

const PROVIDER_MAX_TOKENS: Record<CompatCfg['kind'], number> = {
  openrouter: 8192,
  glm: 4096,
  compat: 8192,
};

export function detailMaxTokens(detail: DetailLevel | undefined, kind?: CompatCfg['kind']): number {
  const base = detail === 'brief' ? 1500 : detail === 'standard' ? 4000 : 8000;
  return Math.min(base, PROVIDER_MAX_TOKENS[kind ?? 'compat']);
}

export function detailPromptSuffix(detail: DetailLevel | undefined): string {
  const formulaRule = '\n\n【公式写法】公式用工程可读写法（如 Fs = Στ / ΣQ 或 Fs = (c + γ·H·cos²β·tanφ) / (γ·H·sinβ·cosβ)），禁止 LaTeX 数学标记（分数/求和/上下标记号）。';
  switch (detail) {
    case 'brief':
      return '\n\n【输出详细度：摘要】只给要点与结论，全文控制在 500 字以内。' + formulaRule;
    case 'standard':
      return '\n\n【输出详细度：标准】分章节作答，包含关键数据、规范依据与处置建议，内容完整但精炼。' + formulaRule;
    default:
      return '\n\n【输出详细度：详细】请深度推理、详尽作答：按章节展开，给出数据依据、计算步骤、风险机理、规范条文精神与可执行的处置/监测建议；涉及数值时必须展示公式与参数代入过程，禁止泛泛而谈；目标篇幅 3000–8000 字。' + formulaRule;
  }
}

/** P1-4 修复：多智能体路径专用 maxTokens（相对 chat 路径 1500/4000/8000 缩放）
 *  MA 路径 prompt 较短、回答聚焦，无需与 chat 一致；brief=1200 / standard=1600 / detailed=3200
 *  同时叠加各通道 PROVIDER_MAX_TOKENS 钳制（GLM=4096、OpenRouter/compat=8192），避免单次请求过载。
 */
export function multiagentMaxTokens(detail: DetailLevel | undefined, kind?: CompatCfg['kind']): number {
  const base = detail === 'brief' ? 1200 : detail === 'detailed' ? 3200 : 1600;
  return Math.min(base, PROVIDER_MAX_TOKENS[kind ?? 'compat']);
}

// ============ 串行队列（GLM 免费档并发=1） ============
let serialTail: Promise<unknown> = Promise.resolve();
let serialPending = 0;
const MAX_SERIAL_DEPTH = 20;
const SERIAL_SPACING_MS = 300;

export function enqueueLLM<T>(fn: () => Promise<T>): Promise<T> {
  if (serialPending >= MAX_SERIAL_DEPTH) return Promise.reject(new Error('LLM 串行队列已满'));
  serialPending++;
  const run = serialTail.then(fn, fn);
  serialTail = run
    .catch(() => {})
    .then(() => new Promise(r => setTimeout(r, SERIAL_SPACING_MS)))
    .finally(() => { serialPending--; });
  return run;
}

// ============ 并行信号量（OpenRouter，上限 3） ============
let parallelActive = 0;
const PARALLEL_LIMIT = 3;
const parallelWaiters: (() => void)[] = [];
let parallelPending = 0;
const MAX_PARALLEL_DEPTH = 12;

export function enqueueParallelLLM<T>(fn: () => Promise<T>): Promise<T> {
  if (parallelPending >= MAX_PARALLEL_DEPTH) return Promise.reject(new Error('LLM 并行队列已满'));
  parallelPending++;
  const acquire = new Promise<void>(resolve => {
    const tryRun = () => {
      if (parallelActive < PARALLEL_LIMIT) {
        parallelActive++;
        resolve();
      } else {
        parallelWaiters.push(tryRun);
      }
    };
    tryRun();
  });
  return acquire.then(fn).finally(() => {
    parallelActive--;
    const next = parallelWaiters.shift();
    if (next) next();
    parallelPending--;
  });
}

/** 排队中的请求数（不含在飞的那个） */
export function llmQueueWaiting(): number { return Math.max(0, serialPending - 1); }
export function llmParallelWaiting(): number { return Math.max(0, parallelPending - parallelActive); }

// ============ 响应解析（兼容 content 为 string / 数组 / 空） ============
function extractContent(j: any): string | null {
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    const t = content.trim();
    return t || null;
  }
  if (Array.isArray(content)) {
    const t = content
      .map((seg: any) => (typeof seg === 'string' ? seg : seg?.text ?? seg?.content ?? ''))
      .join('')
      .trim();
    return t || null;
  }
  return null;
}

// ============ 非流式文本完成（主备通道 + 超时 + 重试 + fallback） ============
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface LLMCompleteOpts {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  models?: string[];
  /**
   * 外部取消信号（多智能体超时用）。
   * 不接信号的后果：Promise.race 超时只是"不再等待"，被放弃的请求仍占着串行队列
   * （GLM 免费档并发=1），后续请求只能排在它后面 → 雪崩式延迟。
   */
  signal?: AbortSignal;
}

async function completeOne(
  cfg: CompatCfg,
  model: string,
  messages: { role: string; content: string }[],
  opts?: LLMCompleteOpts,
): Promise<string | null> {
  const enqueue = cfg.concurrency === 'serial' ? enqueueLLM : enqueueParallelLLM;
  return enqueue(async () => {
    // 排队期间已被取消：直接放弃，不占用模型额度
    if (opts?.signal?.aborted) return null;
    let maxTokens = opts?.maxTokens ?? 300;
    for (let attempt = 0; attempt < (opts?.retries ?? 3); attempt++) {
      if (opts?.signal?.aborted) return null;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts?.timeoutMs ?? 25000);
      const onAbort = () => ac.abort();
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          stream: false,
          temperature: opts?.temperature ?? 0.3,
          max_tokens: maxTokens,
        };
        // 智谱通道显式关闭思考，避免 reasoning_content 占满 token 导致空正文
        if (cfg.kind === 'glm') body.thinking = { type: 'disabled' };
        const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: ac.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          const j: any = await resp.json();
          const text = extractContent(j);
          if (text) return text;
          await sleep(800); // 200 但无内容：瞬时故障重试
          continue;
        }
        const errText = await resp.text().catch(() => '');
        // max_tokens 超限 / 上下文过长：减半重试，最终自动降档不中断
        if (resp.status === 400 && /max_tokens|maximum context|context length|invalid_request_error/i.test(errText)) {
          if (maxTokens > 512) { maxTokens = Math.floor(maxTokens / 2); continue; }
          break;
        }
        const transient = resp.status === 429 || resp.status >= 500 || errText.includes('1305');
        if (!transient) break; // 401/403 等鉴权错误：直接换下一个模型
        await sleep(1200 * (attempt + 1));
      } catch {
        if (opts?.signal?.aborted) return null;   // 被取消：不再重试
        await sleep(800); // abort / 网络错误 → 重试
      } finally {
        clearTimeout(timer);
        opts?.signal?.removeEventListener('abort', onAbort);
      }
    }
    return null;
  }).catch(() => null);
}

export async function llmComplete(
  messages: { role: string; content: string }[],
  opts?: LLMCompleteOpts,
): Promise<string | null> {
  const providers = allProviders();
  if (providers.length === 0) return null;

  // 主通道模型链 → 备通道模型链；显式传 models 时按声明顺序
  const modelChain = opts?.models?.length
    ? opts.models
    : providers.flatMap(c => c.models);

  for (const model of modelChain) {
    const cfg = resolveCfgForModel(model);
    if (!cfg) continue;
    const text = await completeOne(cfg, model, messages, opts);
    if (text) return text;
  }
  return null; // 全链失败：调用方回退模板
}
