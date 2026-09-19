/**
 * model-builder.ts — 建模中枢（统一"智能体建模型"入口）
 *
 * 把原先散落在三处的"建模"能力收口为单一 buildModel 工具，从专家问答单入口触发：
 *   geo3d      → 3D 几何场地模型（buildScene，8 维 GeoParams）
 *   ogs        → 稳定化数值模型（产气 / 沉降 / 降解，确定性求解器）
 *   calc       → 工程计算模型（CALC_REGISTRY 专业计算器）
 *   multiagent → 多智能体协同诊断模型（4 领域专家 + 总工综合研判）
 *
 * 双通道（任一通道产出同一 ModelBuilt 结构，前端统一渲染"建模卡片"）：
 *   通道A · LLM 真 function calling（GLM/OpenRouter）：模型自主判断建哪种模型、自补参数
 *            → buildModelFromIntent(intent)
 *   通道B · 确定性规则兜底（任何模型都通）：detectModelIntent() 判定 + 参数规则解析
 *            → buildModelFromText(text, { reuse })
 */
import { buildScene, hasSceneIntent } from './scene-builder.js';
import { detectCalcIntent, detectOgsIntent, CALC_FORMULAS, type CalcSource, type OgsSource } from './augment.js';
import { CALC_REGISTRY } from './routes/calc.js';
import { runOgsScenario } from './ogs.js';
import { getCachedAgentRun, normalizeParams, type MAPeerResult } from './multiagent.js';

// ============ 类型 ============

export type ModelKind = 'geo3d' | 'ogs' | 'calc' | 'multiagent';

export interface ModelAgentResult {
  agent: string;
  name: string;
  grade: string;
  gradeLabel: string;
  result: string;
}

export interface ModelBuilt {
  kind: ModelKind;
  title: string;
  /** 简短文本摘要（通道A 可注入 LLM 上下文；前端作兜底展示） */
  summary: string;
  /** 前端卡片渲染数据（按 kind 结构固定） */
  payload: Record<string, unknown>;
  /** 一键跳转目标页 */
  navigateTo?: string;
  ok: boolean;
  /** 部分完成（如多智能体某专家超时）——不阻塞，标注即可 */
  partial?: boolean;
}

export interface ModelIntent {
  kind: ModelKind;
  /** 用户原始需求原文（规则/LLM 都回填，便于前端展示与追责） */
  text: string;
  /** 建模参数（结构随 kind） */
  params?: Record<string, unknown>;
}

export interface ModelBuilderDeps {
  /** 通道B 复用后端已跑的 calc/ogs 结果（避免 OGS 跑两遍烧 token） */
  reuse?: { calcs?: CalcSource[]; ogs?: OgsSource | null };
}

const KIND_TITLE: Record<ModelKind, string> = {
  geo3d: '🏗 3D 几何模型',
  ogs: '🌐 稳定化数值模型',
  calc: '⚙ 工程计算模型',
  multiagent: '🧠 多智能体诊断模型',
};

const AGENT_INFO: Record<string, { name: string; icon: string }> = {
  slope: { name: '边坡稳定', icon: '⛰️' },
  leachate: { name: '渗滤液', icon: '💧' },
  lfg: { name: '填埋气', icon: '🔥' },
  gw: { name: '地下水', icon: '🌊' },
  summary: { name: '综合研判', icon: '🎯' },
};

const GRADE_LABEL: Record<string, string> = {
  red: '危险', orange: '警示', yellow: '注意', blue: '关注', green: '正常',
};

// ============ 意图判定（通道B 规则 + 通道A 兜底） ============

/** 查询/咨询类负向词：排除"怎么算/是什么/要求多少"这类只问不建的请求 */
const QUERY_WORDS = /怎么|如何|多少|是什么|标准|规范|限值|要求|公式|定义|算一下|查一下|能不能|是否可以|有没有/;

/**
 * 顶层级"咨询句"拦截：问定义/要求/措施/解释的普通问答只走 KB，不触发建模卡片。
 * 典型误触发（实测）："什么是山谷型填埋场"(规模词撞建场规则)、"渗滤液怎么处理"/"HDPE膜怎么选"(撞计算器规则)。
 * 排除规则：命中咨询词 且 不含计算/模拟动词 → 直接判"无建模意图"。
 * 计算动词（怎么算/模拟/预测…）明确要"算/模拟"，即使含咨询词也放行（如"边坡 Fs 怎么算"仍走 calc）。
 */
const CONSULT_WORDS = /是什么|什么是|有哪些|哪些|哪个|如何选|怎么(选|处理|防止|检查|做|办|设计|评价|评估|看|判断|变化|影响)|有什么要求|有什么|要求|规定|标准|规范|注意|定义|含义|意思|解释|作用|区别|PDF|文档|下载|要不要/;
const COMPUTE_WORDS = /怎么算|算一下|算算|计算|估算|测算|求出|推求|模拟|仿真|预测|验算|复核|校核/;

/**
 * 保守判定自然语言 → 建模类型。返回 null = 无建模意图（普通问答，不打扰）。
 * 优先级：显式建场 > 多智能体协同诊断 > 数值模拟 > 工程计算。
 */
export function detectModelIntent(text: string): ModelKind | null {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return null;

  // 顶层级咨询拦截：只问不建（定义/要求/措施/解释）→ 不触发建模；明确要"算/模拟"的放行
  if (CONSULT_WORDS.test(t) && !COMPUTE_WORDS.test(t)) return null;

  // ① 建场意图（hasSceneIntent 内部含 isExplicitSceneRequest 动词规则 + 规模词/改参数规则；
  //    单用 isExplicit 的 10 字符宽度会漏判"建一个缓坡山谷型 500 万 m³ 的填埋场"这类长句）
  if (hasSceneIntent(t)) return 'geo3d';

  // ② 多智能体协同诊断（保守：明确协同词 / "综合·评估+场地" / 异常指标场景描述）
  if (/让(那些|这几位|几位)?(专家|智能体)|\bagent\b|多智能体|协同诊断|联合会诊|专家会诊/.test(t)) return 'multiagent';
  if (/(综合|整体|全面|专业).{0,8}(评估|诊断|分析|研判|体检|会诊)/.test(t)
      && /(场地|填埋场|堆体|厂区|库区|园区|垃圾)/.test(t)
      && !QUERY_WORDS.test(t)) return 'multiagent';
  if (/(风险|隐患).{0,8}(评估|排查|体检|诊断|研判)/.test(t)
      && /(场地|填埋场|堆体|厂区|库区)/.test(t)
      && !QUERY_WORDS.test(t)) return 'multiagent';
  if (/(裂缝|沉降|水位.{0,6}(上升|下降|抬升|升高)|氯离子|甲烷浓度|爆炸|超标|报警|预警).{0,24}(堆体|填埋场|场地|边坡|地下水)/
    .test(t) && !QUERY_WORDS.test(t)) return 'multiagent';

  // ③ 稳定化数值模拟（产气/沉降/降解）
  if (detectOgsIntent(t)) return 'ogs';

  // ④ 工程计算
  if (detectCalcIntent(t)) return 'calc';

  return null;
}

/** 规则路径的多智能体场景文本：完整原文即场景 */
export function detectMultiAgentScenario(text: string): string { return String(text ?? '').trim(); }

// ============ 各类模型的实际搭建 ============

/** 3D 几何模型：意图 → buildScene（与现有 scene-builder 同一落点）
 *  若用户同时要求数值模拟（产气/沉降："建个大库+同步算产气"），复用 aug 已跑结果做 OGS 联动 */
async function buildGeo3d(intent: ModelIntent, reuseOgs?: OgsSource | null): Promise<ModelBuilt> {
  const ogsIntent = detectOgsIntent(intent.text);
  // 联动：复用后端已跑的同一 OGS 场景摘要（峰值），避免重复求解阻塞建场
  let runOgs: ((scenario: string) => Promise<{ peakValue: number; unit: string } | null>) | undefined;
  if (ogsIntent && reuseOgs && reuseOgs.input.scenario === ogsIntent.scenario) {
    const r = reuseOgs.result;
    if (r.ok && Array.isArray(r.timeSeries) && r.timeSeries.length) {
      const rate = r.timeSeries.find((s: { name?: string; varName?: string; unit?: string; points?: { t: number; v: number }[] }) =>
        /rate|速率|日峰/i.test(`${s.name ?? ''} ${s.varName ?? ''} ${s.unit ?? ''}`)) ?? r.timeSeries[0];
      const vals = (rate?.points ?? []).map((p: { t: number; v: number }) => p.v);
      if (vals.length) {
        const peak = vals.reduce((a: number, b: number) => Math.abs(b) > Math.abs(a) ? b : a, 0);
        runOgs = async () => ({ peakValue: peak, unit: rate?.unit ?? '' });
      }
    }
  }
  const built = await buildScene(
    {
      intent: { kind: 'natural', text: intent.text },
      injectOgs: !!ogsIntent,
      ogsScenario: ogsIntent?.scenario as 'gas-production' | 'settlement' | 'degradation' | undefined,
    },
    runOgs ? { runOgs } : undefined,
  );
  return {
    kind: 'geo3d',
    title: KIND_TITLE.geo3d,
    summary: [
      built.snapshot.desc,
      built.ogSummary ? `联动稳定化计算：${built.ogSummary.scenario} 峰值 ${built.ogSummary.peakValue}${built.ogSummary.unit}` : '',
    ].filter(Boolean).join('\n'),
    payload: {
      geo: built.geo,
      preset: built.preset,
      snapshot: built.snapshot,
      ogSummary: built.ogSummary ?? null,
    },
    navigateTo: '/3d-simulator',
    ok: true,
  };
}

/** 稳定化数值模型：scenario → OGS 确定性求解器 */
async function buildOgs(text: string, reuse?: OgsSource | null): Promise<ModelBuilt> {
  const intent = detectOgsIntent(text);
  if (!intent) return { kind: 'ogs', title: KIND_TITLE.ogs, summary: '未识别数值模拟场景', payload: {}, ok: false };
  // 复用后端已跑的同一场景结果（避免重复求解 & 阻塞 LLM 流）
  if (reuse && reuse.input.scenario === intent.scenario) {
    return {
      kind: 'ogs',
      title: KIND_TITLE.ogs,
      summary: reuse.result.summary ?? '',
      payload: reuse.result as unknown as Record<string, unknown>,
      navigateTo: '/3d-simulator',
      ok: reuse.result.ok ?? false,
    };
  }
  const r = await runOgsScenario(intent.scenario, intent.params);
  return {
    kind: 'ogs',
    title: KIND_TITLE.ogs,
    summary: r.summary ?? '',
    payload: r as unknown as Record<string, unknown>,
    navigateTo: '/3d-simulator',
    ok: r.ok,
  };
}

/** 工程计算模型：计算器意图 → CALC_REGISTRY 执行 */
async function buildCalc(text: string, reuse?: CalcSource[]): Promise<ModelBuilt> {
  const intent = detectCalcIntent(text);
  if (!intent || !CALC_REGISTRY[intent.name]) {
    return { kind: 'calc', title: KIND_TITLE.calc, summary: '未识别计算器意图', payload: {}, ok: false };
  }
  // 通道B 复用 augment 已跑结果（同一 detectCalcIntent 规则，命中即一致性复用）
  if (reuse && reuse.length > 0 && reuse[0].name === intent.name) {
    const c = reuse[0];
    return {
      kind: 'calc',
      title: KIND_TITLE.calc,
      summary: c.result ?? '',
      payload: { name: c.name, formula: CALC_FORMULAS[c.name] ?? '', analysis: c.result ?? '', ref: c.ref ?? '' },
      navigateTo: '/design',
      ok: true,
    };
  }
  const r = CALC_REGISTRY[intent.name](intent.params);
  return {
    kind: 'calc',
    title: KIND_TITLE.calc,
    summary: r.analysis ?? '',
    payload: { name: intent.name, formula: CALC_FORMULAS[intent.name] ?? '', analysis: r.analysis ?? '', ref: r.ref ?? '' },
    navigateTo: '/design',
    ok: true,
  };
}

/** 多智能体协同诊断模型：4 领域专家并行 + 总工综合研判（带 LRU 缓存，重复场景秒回） */
async function buildMultiAgent(text: string): Promise<ModelBuilt> {
  const scenario = detectMultiAgentScenario(text) || '某填埋场综合风险评估';
  // 场景参数直接取默认（避免二次 LLM 抽取抢串行队列；MA 计算内核对参数不敏感）
  const params = normalizeParams(null);

  const timeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

  const domain = ['slope', 'leachate', 'lfg', 'gw'] as const;
  const runOne = async (agent: string, peers?: Record<string, MAPeerResult>) => {
    const { events } = await getCachedAgentRun(agent, scenario, params, 'standard', peers);
    const last = [...events].reverse().find(e => e.type === 'agent_result');
    return { agent, result: last?.result ?? '', grade: last?.grade ?? 'green' };
  };

  // 4 领域并行（60s 超时；任一失败不阻塞整体）
  const domainRes = (await timeout(Promise.all(domain.map(a => runOne(a))), 60_000)) ?? [];
  const peers: Record<string, MAPeerResult> = {};
  for (const d of domainRes) peers[d.agent] = { result: d.result, grade: d.grade };

  // 总工综合研判（携带同伴结论，40s 超时）
  let summary: { result: string; grade: string } | null = null;
  try {
    summary = await timeout(runOne('summary', peers), 40_000);
  } catch { /* ignore */ }

  const agents: ModelAgentResult[] = [
    ...domainRes.map(d => ({
      agent: d.agent,
      name: AGENT_INFO[d.agent]?.name ?? d.agent,
      grade: d.grade,
      gradeLabel: GRADE_LABEL[d.grade] ?? d.grade,
      result: d.result,
    })),
    ...(summary ? [{
      agent: 'summary' as const,
      name: AGENT_INFO.summary.name,
      grade: summary.grade,
      gradeLabel: GRADE_LABEL[summary.grade] ?? summary.grade,
      result: summary.result,
    } satisfies ModelAgentResult] : []),
  ];
  const overallGrade = summary?.grade ?? 'yellow';
  const partial = agents.length < domain.length;

  return {
    kind: 'multiagent',
    title: KIND_TITLE.multiagent,
    summary: `${agents.length}/5 专家完成 · 综合评级 ${GRADE_LABEL[overallGrade] ?? overallGrade}`,
    payload: {
      scenario,
      agents,
      overall: { grade: overallGrade, gradeLabel: GRADE_LABEL[overallGrade] ?? overallGrade },
    },
    navigateTo: '/multi-agent',
    ok: agents.length > 0,
    partial,
  };
}

// ============ 通道A：LLM 结构化 intent → 建模 ============

export async function buildModelFromIntent(intent: ModelIntent): Promise<ModelBuilt> {
  const kind = intent?.kind;
  const text = String(intent?.text ?? '');

  switch (kind) {
    case 'geo3d':
      return buildGeo3d(intent);
    case 'ogs':
      return buildOgs(text);
    case 'calc':
      return buildCalc(text);
    case 'multiagent':
      return buildMultiAgent(String(intent?.params?.scenario ?? text));
    default:
      return { kind, title: KIND_TITLE[kind] ?? '🧠 智能体建模', summary: '未识别的建模请求', payload: {}, ok: false };
  }
}

/** 通道A 的 OpenAI 兼容 function schema（GLM / OpenRouter 真 function calling） */
export const BUILD_MODEL_TOOL = {
  type: 'function',
  function: {
    name: 'buildModel',
    description:
      '建立填埋场专业模型（建模工具）。四类模型：\n' +
      '1) geo3d —— 3D 几何场地模型（建/生成/改 3D 场景、统筹堆体/库容/坝/井距/池容参数）。\n' +
      '2) ogs —— 稳定化数值模型（产气/沉降/降解 数值模拟，用户说"模拟/仿真产气、沉降"时）。\n' +
      '3) calc —— 工程计算模型（沿 Fs、库容、渗滤液产量、LandGEM 产气、污染物运移、沉降预测等专业计算器。\n' +
      '4) multiagent —— 多智能体协同诊断模型（评估/诊断 填埋场综合风险、异常指标会诊，4 位领域专家+总工综合研判。\n' +
      '当用户表达"建模型/建场景/模拟/评估诊断"类意图时调用；普通规范咨询（问标准/条文/定义）不要调用。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['geo3d', 'ogs', 'calc', 'multiagent'], description: '建模类型' },
        text: { type: 'string', description: '用户原始需求文本（如实回填，用于规则解析参数）' },
        params: {
          type: 'object',
          description: '建模参数（可选）：geo3d 传 { geo / preset / text }；ogs 传 { scenario }；calc 传 { name }；multiagent 传 { scenario }（场地诊断场景原文，如"某填埋场渗滤液水位上升0.8m，甲烷浓度35%LEL，请综合评估风险"）',
        },
      },
      required: ['kind', 'text'],
    },
  },
};

// ============ 通道B：规则判定 + 执行（复用后端已跑结果，不重复烧钱） ============

export async function buildModelFromText(
  text: string,
  deps?: ModelBuilderDeps,
): Promise<ModelBuilt | null> {
  if (!text) return null;
  const kind = detectModelIntent(text);
  if (!kind) return null;

  const reuseCalcs = deps?.reuse?.calcs ?? [];
  const reuseOgs = deps?.reuse?.ogs ?? null;

  switch (kind) {
    case 'geo3d':
      return buildGeo3d({ kind: 'geo3d', text }, reuseOgs);
    case 'ogs':
      return buildOgs(text, reuseOgs);
    case 'calc':
      return buildCalc(text, reuseCalcs);
    case 'multiagent':
      return buildMultiAgent(text);
    default:
      return null;
  }
}

export default {
  detectModelIntent,
  buildModelFromIntent,
  buildModelFromText,
  BUILD_MODEL_TOOL,
};