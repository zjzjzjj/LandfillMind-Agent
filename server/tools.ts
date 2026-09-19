/**
 * tools.ts — 统一工具层（v5 重构核心）
 *
 * 一切工程能力 = Tool。LLM 只做编排（真 function calling / 规则兜底），
 * 实际计算全部由确定性内核完成，并经统一契约（ToolRun）封装：
 *   参数出处（USER_DEFINED / FROM_TEXT / ESTIMATED / DEFAULT / INVALID）
 *   + 范围校验（Input Validation）
 *   + 结果信封（可追溯：runId / 参数 / 结果 / 耗时）
 *   + 运行记录落库（tool_runs 表，供工程报告与"结果怎么算出来的"追溯）
 *
 * 与旧通道的兼容：每个工具 exec 直接包装现有内核函数（ogs.ts / scene-builder.ts /
 * routes/calc.ts / retrieval.ts / diagnose.ts），不重写计算逻辑。
 */

import { runOgsScenario, listOgsScenarios } from './ogs.js';
import type { OgsRunResult } from './ogs.js';
import { buildScene } from './scene-builder.js';
import { estimateSite, DEFAULT_GEO } from './geo.js';
import type { GeoParams } from './geo.js';
import { hybridSearch } from './retrieval.js';
import { CALC_REGISTRY, CALC_FORMULAS } from './routes/calc.js';
import { CALC_PARAM_META, CALC_LABELS } from './calc-meta.js';
import { runDiagnosis } from './diagnose.js';
import { resolveCompat } from './llm.js';
import { runDeepAnalysis } from './multiagent.js';
import { generateReport } from './report.js';
import { runKernel3d } from './kernel3d.js';
import { saveToolRun } from './db.js';

// ==================== 类型 ====================

export type ParamOrigin = 'USER_DEFINED' | 'FROM_TEXT' | 'ESTIMATED' | 'DEFAULT' | 'INVALID';

export interface ToolParamMeta {
  key: string;
  label: string;
  unit?: string;
  default?: number | string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  hint?: string;
}

export interface ToolParam {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  origin: ParamOrigin;
  inRange: boolean;
}

/** 工具执行上下文：会话 ID + 长任务进度回调（SSE agent_step 用） */
export interface ToolCtx {
  sessionId?: string;
  onStep?: (step: { id: string; label: string; status?: 'running' | 'done' }) => void;
}

export interface ToolExecResult {
  result: unknown;
  /** 参数出处（默认取 def.meta 级解析结果；动态参数工具如 calculate/ogs 在此返回） */
  params?: ToolParam[];
  unit?: string;
  grade?: string;
  warnings?: string[];
}

export interface ToolDef {
  name: string;
  label: string;
  description: string;
  /** OpenAI 兼容 function schema 的 parameters 部分（properties + required） */
  inputSchema: Record<string, unknown>;
  inputRequired?: string[];
  /** 顶层参数元数据（用于自动 schema + 出处解析；动态参数工具可留空并在 exec 内自解析） */
  meta?: ToolParamMeta[];
  exec: (ctx: ToolCtx, values: Record<string, unknown>, raw: Record<string, unknown>) => Promise<ToolExecResult>;
}

export interface ToolRun {
  ok: boolean;
  runId: string;
  tool: string;
  toolLabel: string;
  params: ToolParam[];
  result: unknown;
  unit?: string;
  grade?: string;
  status: 'ok' | 'warning' | 'error';
  warnings: string[];
  elapsedMs: number;
  startedAt: number;
}

// ==================== 参数解析（出处 + 范围校验 + 边界收敛） ====================

/** 把用户原始参数解析为带出处的参数表；数值越界收敛到边界并标记 inRange=false */
export function resolveParams(
  meta: ToolParamMeta[],
  raw: Record<string, unknown>,
  hints?: { estimated?: Set<string> },
): ToolParam[] {
  const estimated = hints?.estimated ?? new Set<string>();
  return meta.map((m) => {
    const isNum = typeof m.default === 'number';
    if (isNum) {
      let value: number;
      let origin: ParamOrigin;
      const rv = raw?.[m.key];
      if (typeof rv === 'number' && Number.isFinite(rv)) {
        value = rv;
        origin = 'USER_DEFINED';
      } else if (typeof rv === 'string' && rv.trim() !== '') {
        const n = parseFloat(rv);
        if (Number.isFinite(n)) {
          value = n;
          origin = estimated.has(m.key) ? 'ESTIMATED' : 'FROM_TEXT';
        } else {
          value = m.default as number;
          origin = 'INVALID';
        }
      } else {
        value = m.default as number;
        origin = 'DEFAULT';
      }
      // 范围收敛（工程输入校验：越界按边界取值并告警）
      let inRange = true;
      if (m.min !== undefined && value < m.min) { value = m.min; inRange = false; }
      if (m.max !== undefined && value > m.max) { value = m.max; inRange = false; }
      if (!Number.isFinite(value)) { value = m.default as number; origin = 'INVALID'; inRange = false; }
      return { key: m.key, label: m.label, value, unit: m.unit, origin, inRange };
    }
    // 字符串/枚举参数
    if (typeof raw?.[m.key] === 'string' && String(raw[m.key]).trim() !== '') {
      return { key: m.key, label: m.label, value: String(raw[m.key]), unit: m.unit, origin: 'USER_DEFINED', inRange: true };
    }
    return {
      key: m.key, label: m.label,
      value: m.default !== undefined ? m.default : '',
      unit: m.unit, origin: 'DEFAULT', inRange: true,
    };
  });
}

function toValues(params: ToolParam[]): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const p of params) v[p.key] = p.value;
  return v;
}

// ==================== 工具注册表 ====================

const OGS_PARAM_META: Record<string, ToolParamMeta[]> = Object.fromEntries(
  listOgsScenarios().map((s) => [
    s.id,
    s.params.map((p) => ({ key: p.key, label: p.label, unit: p.unit, default: p.default, min: p.min, max: p.max, hint: p.hint })),
  ]),
);

const OGS_SCENARIO_ENUM = listOgsScenarios().map((s) => s.id);

export const GEO_PARAM_META: ToolParamMeta[] = [
  { key: 'valleyWidth', label: '谷底宽度缩放', default: 1, min: 0.6, max: 1.6 },
  { key: 'pileHeight', label: '堆体高度缩放', default: 1, min: 0.5, max: 1.8 },
  { key: 'pondVolume', label: '调节池容积缩放', default: 1, min: 0.4, max: 2.2 },
  { key: 'gasWellSpacing', label: '导气井间距缩放', default: 1, min: 0.6, max: 1.5 },
  { key: 'damHeight', label: '垃圾坝高缩放', default: 1, min: 0.5, max: 2.0 },
  { key: 'treeDensity', label: '植被密度缩放', default: 1, min: 0.4, max: 1.6 },
  { key: 'vehicleCount', label: '作业车辆数', default: 4, min: 0, max: 8, step: 1 },
  { key: 'volumeScale', label: '库容标定缩放', default: 1, min: 0.2, max: 2.2 },
];

/** 从 OGS 结果抽速率日峰（位移类取绝对值最大），供场景联动/报告摘要 */
export function summarizeOgsPeak(r: OgsRunResult): { peakValue: number; unit: string } | null {
  if (!r.ok || !r.timeSeries?.length) return null;
  const nameAndUnit = (s: { name?: string; varName?: string; unit?: string }) => `${s.name ?? ''} ${s.varName ?? ''} ${s.unit ?? ''}`;
  const rateSeries = r.timeSeries.find(s => /rate|速率|日峰/i.test(nameAndUnit(s))) ?? null;
  const series = rateSeries ?? r.timeSeries[0];
  const values = (series.points ?? []).map(p => p.v);
  if (!values.length) return null;
  const peak = values.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
  return { peakValue: peak, unit: series.unit ?? '' };
}

/** 结果信封抽取器：unit / grade / 摘要 */
function extractResultShape(r: unknown): { unit?: string; grade?: string; summary?: string } {
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    return {
      unit: typeof o.unit === 'string' ? o.unit : undefined,
      grade: typeof o.grade === 'string' ? o.grade : undefined,
      summary: typeof o.analysis === 'string' ? o.analysis.slice(0, 300) : undefined,
    };
  }
  return {};
}

// ==================== 工具定义 ====================

export const TOOL_DEFS: ToolDef[] = [
  // ---------- 知识库检索 ----------
  {
    name: 'kb_lookup',
    label: '规范知识库检索',
    description: '从规范知识库检索相关条目（GB/CJJ/HJ 等），返回规范依据与条款摘要。回答涉及规范条文、阈值、参数区间时必须先调用本工具，禁止编造条文号。',
    inputSchema: { query: { type: 'string', description: '检索关键词，如"边坡稳定安全系数要求"、"渗滤液液位管理"、"地下水III类限值"' } },
    inputRequired: ['query'],
    meta: [{ key: 'query', label: '检索关键词', default: '' }],
    exec: async (_ctx, values) => {
      const q = String(values.query ?? '').trim();
      if (!q) throw new Error('缺少检索关键词');
      const hits = await hybridSearch(q, 3);
      return {
        result: hits.map(e => ({
          key: e.key, cite: e.cite, title: e.q, clause: e.clause, detail: e.pro,
        })),
        params: [{ key: 'query', label: '检索关键词', value: q, origin: 'USER_DEFINED', inRange: true }],
      };
    },
  },

  // ---------- 工程计算器 ----------
  {
    name: 'calculate',
    label: '工程计算器',
    description:
      '调用专业工程计算器（TypeScript 快速估算档，结果标注 FAST_KERNEL）。' +
      '正式工程数值必须优先用权威内核工具 run_3d_kernel；本计算器仅用于秒级预估与无内核兜底。可用计算器：' +
      Object.entries(CALC_LABELS).map(([k, v]) => `${k}（${v}）`).join('、') +
      '。参数对象 params 的键见计算器说明，省略的用默认值；结果含 value/unit/grade/analysis/formula/ref。',
    inputSchema: {
      name: { type: 'string', enum: Object.keys(CALC_REGISTRY), description: '计算器名' },
      params: { type: 'object', description: `计算参数对象（键为参数名，值为数值）。各计算器参数：\n${Object.entries(CALC_PARAM_META).map(([k, ps]) => `${k}: ${ps.map(p => `${p.name}(${p.label}${p.unit ? ' ' + p.unit : ''})`).join('、')}`).join('\n')}` },
    },
    inputRequired: ['name'],
    meta: [],
    exec: async (_ctx, values, raw) => {
      // name/scenario 等顶层选择器在 def.meta 为空时不在 values 里 → 从 raw 取
      const name = String(raw?.name ?? values.name ?? '');
      const paramsRaw = (raw?.params ?? {}) as Record<string, unknown>;
      if (!CALC_REGISTRY[name]) {
        throw new Error(`未知计算器: ${name}，可用：${Object.keys(CALC_REGISTRY).join('、')}`);
      }
      const meta: ToolParamMeta[] = (CALC_PARAM_META[name] ?? []).map(p => ({
        key: p.name, label: p.label, unit: p.unit, default: p.default, min: p.min, max: p.max, step: p.step,
      }));
      const params = resolveParams(meta, paramsRaw, {});
      const effective = toValues(params) as Record<string, any>;
      const r = CALC_REGISTRY[name](effective);
      const withFormula = (r && typeof r === 'object' && !r.formula) ? { ...r, formula: CALC_FORMULAS[name] ?? '' } : r;
      const shape = extractResultShape(withFormula);
      return {
        result: { calcName: name, calcLabel: CALC_LABELS[name] ?? name, ...withFormula },
        params,
        unit: shape.unit,
        grade: shape.grade,
      };
    },
  },

  // ---------- OGS 数值模拟 ----------
  {
    name: 'run_ogs_scenario',
    label: 'OGS 稳定化数值模拟',
    description:
      '运行填埋场稳定化数值模拟（确定性内核，秒出结果）：gas-production 产气量（ADM1 厌氧模型，CH4/CO2/H2S/H2 日分辨率）、degradation 有机物降解动力学、settlement 堆体固结沉降（Terzaghi）。返回时程曲线、累计产量、峰值与收敛状态。',
    inputSchema: {
      scenario: { type: 'string', enum: OGS_SCENARIO_ENUM, description: '模拟场景：gas-production / degradation / settlement' },
      params: { type: 'object', description: `场景参数（键为参数名，省略用默认值）。各场景参数：\n${Object.entries(OGS_PARAM_META).map(([k, ps]) => `${k}: ${ps.map(p => `${p.key}(${p.label}${p.unit ? ' ' + p.unit : ''}, 默认${p.default})`).join('、')}`).join('\n')}` },
    },
    inputRequired: ['scenario'],
    meta: [],
    exec: async (ctx, values, raw) => {
      const scenario = String(raw?.scenario ?? values.scenario ?? 'gas-production');
      if (!OGS_PARAM_META[scenario]) throw new Error(`未知 OGS 场景: ${scenario}，可用：${OGS_SCENARIO_ENUM.join('、')}`);
      const paramsRaw = (raw?.params ?? {}) as Record<string, unknown>;
      const params = resolveParams(OGS_PARAM_META[scenario], paramsRaw, {});
      const effective = toValues(params) as Record<string, number>;
      ctx.onStep?.({ id: 'ogs-run', label: `运行 OGS「${scenario}」数值模拟…`, status: 'running' });
      const r = await runOgsScenario(scenario, effective);
      ctx.onStep?.({ id: 'ogs-run', label: `OGS 求解完成（${r.elapsedMs}ms，${r.ok ? '正常收敛' : '未正常终止'}）`, status: 'done' });
      const warnings: string[] = [];
      if (!r.ok) warnings.push(r.summary || r.error || 'OGS 求解未正常完成');
      const peak = summarizeOgsPeak(r);
      return {
        result: { scenario, scenarioName: r.scenarioName, summary: r.summary, timeSeries: r.timeSeries, peak, elapsedMs: r.elapsedMs, ok: r.ok },
        params,
        warnings,
        unit: peak?.unit,
      };
    },
  },

  // ---------- 3D 场景建模 ----------
  {
    name: 'build_scene',
    label: '3D 填埋场场景建模',
    description: '根据自然语言/参数生成填埋场 3D 场景（8 维 GeoParams：谷宽/堆高/池容/井距/坝高/植被/车辆/库容），返回几何参数、库容快照与可选 OGS 联动峰值。可选同步运行稳定化计算注入场景。',
    inputSchema: {
      intent: {
        type: 'object',
        description: '场景意图：preset(预设 small/large/default) / custom(自定义 GeoParams) / natural(自然语言描述)',
        properties: {
          kind: { type: 'string', enum: ['preset', 'custom', 'natural'] },
          key: { type: 'string', enum: ['small', 'large', 'default'], description: 'preset 时必填' },
          geo: { type: 'object', description: 'custom 时填 GeoParams 子集（valleyWidth 0.6-1.6 / pileHeight 0.5-1.8 / pondVolume 0.4-2.2 / gasWellSpacing 0.6-1.5 / damHeight 0.5-2.0 / treeDensity 0.4-1.6 / vehicleCount 0-8 / volumeScale 0.2-2.2）' },
          text: { type: 'string', description: 'natural 时必填，例："缓坡山谷型 500 万 m³ 的填埋场"' },
        },
        required: ['kind'],
      },
      injectOgs: { type: 'boolean', description: '是否同步运行稳定化计算并联动 3D（默认 false）' },
      ogsScenario: { type: 'string', enum: OGS_SCENARIO_ENUM, description: '联动场景，默认 gas-production' },
    },
    inputRequired: ['intent'],
    meta: GEO_PARAM_META,
    exec: async (_ctx, _values, raw) => {
      const intent = raw?.intent ?? { kind: 'natural', text: '' };
      const injectOgs = Boolean((raw as any)?.injectOgs);
      const ogsScenario = String((raw as any)?.ogsScenario ?? 'gas-production') as 'gas-production' | 'degradation' | 'settlement';
      const built = await buildScene(
        { intent: intent as any, injectOgs, ogsScenario },
        {
          runOgs: async (sc: string) => {
            const r = await runOgsScenario(sc, {});
            return summarizeOgsPeak(r);
          },
        },
      );
      const builtGeo = built.geo as unknown as Record<string, number>;
      const intentKind = String((intent as any)?.kind ?? 'natural');
      const customGeo = (intent as any)?.geo as Record<string, unknown> | undefined;
      // 参数出处：custom=用户指定、preset=预设应用、natural=规则估算（偏离默认视为 ESTIMATED）
      const params: ToolParam[] = GEO_PARAM_META.map((m) => {
        const v = builtGeo[m.key] ?? (m.default as number);
        let origin: ParamOrigin = 'DEFAULT';
        if (intentKind === 'custom') origin = customGeo && customGeo[m.key] !== undefined ? 'USER_DEFINED' : 'DEFAULT';
        else if (intentKind === 'preset') origin = 'FROM_TEXT';
        else origin = DEFAULT_GEO[m.key as keyof typeof DEFAULT_GEO] !== v ? 'ESTIMATED' : 'DEFAULT';
        return { key: m.key, label: m.label, value: v, unit: m.unit, origin, inRange: true };
      });
      return {
        result: built,
        params,
        unit: built.ogSummary?.unit,
        warnings: !built.ogSummary && injectOgs ? ['OGS 联动未产生结果（可能求解失败），场景仍已生成'] : [],
      };
    },
  },

  // ---------- 场地确定性分析（库容/占地） ----------
  {
    name: 'analyze_site',
    label: '场地库容/占地分析',
    description: '基于 8 维几何参数做确定性库容与占地估算（纯规则，不跑求解器）：设计库容（万 m³，随谷宽²×堆高×库容系数联动）、占地（hm²）。参数省略用默认值。',
    inputSchema: Object.fromEntries([
      ...GEO_PARAM_META.map((m) => [m.key, {
        type: 'number',
        description: `${m.label}${m.unit ? `（${m.unit}）` : ''}，范围 ${m.min}~${m.max}，默认 ${m.default}`,
        minimum: m.min, maximum: m.max,
      }]),
      ['preset', { type: 'string', enum: ['small', 'large', 'default'], description: '预设场景（覆盖单参数）' }],
    ]) as Record<string, unknown>,
    meta: GEO_PARAM_META,
    exec: async (_ctx, values) => {
      const preset = String(values.preset ?? '');
      let geo: Partial<GeoParams> = {};
      if (preset === 'small') geo = { volumeScale: 0.3, pileHeight: 0.7, valleyWidth: 0.72, pondVolume: 0.55, vehicleCount: 2 };
      else if (preset === 'large') geo = { volumeScale: 1.6, pileHeight: 1.3, valleyWidth: 1.2, pondVolume: 1.7, vehicleCount: 6 };
      for (const m of GEO_PARAM_META) {
        if (values[m.key] !== undefined && m.key !== 'preset') (geo as Record<string, unknown>)[m.key] = values[m.key];
      }
      const params = resolveParams(GEO_PARAM_META, geo as Record<string, unknown>, {});
      const snapshot = estimateSite(toValues(params) as Partial<GeoParams>);
      return { result: { snapshot, ...snapshot }, params, unit: '万m³' };
    },
  },

  // ---------- 双引擎诊断 ----------
  {
    name: 'run_diagnosis',
    label: '场地风险双引擎诊断',
    description: '对填埋场/地下水场地监测数据做双引擎诊断（确定性阈值 + AI 详实报告）：红/橙/黄/蓝四级风险、逐项计算书、处置与监测建议。输入监测数据对象。',
    inputSchema: {
      data: {
        type: 'object',
        description: '场地监测数据（键为字段名）：siteName 场地名、landfillHeight 堆高m、slopeAngle 坡角°、waterLevel 渗滤液/地下水位埋深m、waterRiseRate 水位上升速率m/月、ch4 甲烷体积浓度%、h2s H2S 浓度mg/m³、settlementRate 沉降速率mm/月、stabilityFactor 稳定安全系数 Fs、clConcentration 氯离子实测mg/L、clBackground 氯离子背景mg/L、leachateLevel 渗滤液液位m、rainfall 年降雨mm 等',
      },
    },
    inputRequired: ['data'],
    meta: [],
    exec: async (_ctx, values, raw) => {
      const data = (raw?.data ?? {}) as Record<string, unknown>;
      const cfg = resolveCompat();
      const result = await runDiagnosis(
        data,
        cfg?.models ?? ['glm-4-flash-250414'],
        cfg?.apiKey ?? '',
        cfg?.baseUrl ?? 'https://openrouter.ai/api/v1',
        'standard',
      );
      const grade = (result as any)?.overallRisk ?? (result as any)?.risks?.[0]?.level;
      return { result, grade: typeof grade === 'string' ? grade : undefined };
    },
  },

  // ---------- 多智能体深度分析（v5：4 领域 Agent 真调工具 + 总工研判 + 敏感性） ----------
  {
    name: 'deep_analysis',
    label: '多智能体深度分析',
    description:
      '对填埋场场地做多智能体深度分析：4 个领域 Agent（边坡稳定/渗滤液/填埋气/地下水）真实调用工程工具（计算器、OGS 数值模拟、知识库）+ 总工综合研判（含参数敏感性扫描）。' +
      '输入场地诊断场景描述（监测数据/异常指标）或关键参数；输出各领域结论、确定性综合评级与主导参数。',
    inputSchema: {
      scenario: { type: 'string', description: '场地诊断场景描述，如"某填埋场运营15年，渗滤液水位上升0.8m，甲烷35%LEL，堆体裂缝12m，地下水氯离子50→280mg/L"。场景文本能识别的指标不必重复传参。' },
      height: { type: 'number', description: '堆体高度 m（场景未提及时可省略，系统按典型堆高估算并标注）', minimum: 5, maximum: 60 },
      slopeAngle: { type: 'number', description: '坡角 °（省略则按典型坡角估算并标注）', minimum: 10, maximum: 60 },
      waterLevelDepth: { type: 'number', description: '水位埋深 m（省略则按典型工况估算并标注，且不参与水位监测隐患判定）', minimum: 0, maximum: 30 },
      crackLength: { type: 'number', description: '最长裂缝长度 m' },
      crackWidth: { type: 'number', description: '裂缝宽度 cm' },
      crackCount: { type: 'number', description: '裂缝条数' },
      ch4: { type: 'number', description: '区域外甲烷体积浓度 %vol（若原文为 %LEL 请换算：%vol = %LEL × 5 / 100）' },
      h2s: { type: 'number', description: 'H2S 浓度 mg/m³' },
      settlementRate: { type: 'number', description: '沉降速率 mm/月' },
      clConcentration: { type: 'number', description: 'Cl⁻ 实测浓度 mg/L' },
      clBackground: { type: 'number', description: 'Cl⁻ 背景浓度 mg/L' },
      landfillArea: { type: 'number', description: '填埋面积 m²' },
      rainfall: { type: 'number', description: '年降雨量 mm' },
      landfillAge: { type: 'number', description: '填埋龄期 年' },
      temperature: { type: 'number', description: '堆体温度 ℃' },
    },
    inputRequired: ['scenario'],
    // 不用顶层 meta：领域 Agent 实际使用的参数由提取层决定（文本提取/典型值估算），
    // 若在此声明默认值，工具卡片会显示"height=25(DEFAULT)"这类与实际取值不符的徽章。
    // 真实出处随结果返回（agents[].indicators[].origin 与 evidence[].params[].origin）。
    meta: [],
    exec: async (ctx, _values, raw) => {
      ctx.onStep?.({ id: 'deep-0', label: '启动多智能体深度分析（4 领域 Agent + 总工研判）…', status: 'running' });
      // 只传模型**实际给出**的参数（raw），不传 resolveParams 填好的默认值：
      // 否则 25/30/10 会被一律当成 USER_DEFINED，参数出处的追溯就失去意义。
      // 缺省值由提取层按"文本提取 > 典型值估算"补齐，并标 ESTIMATED。
      const extra: Record<string, number> = {};
      for (const k of [
        'height', 'slopeAngle', 'waterLevelDepth',
        'crackLength', 'crackWidth', 'crackCount', 'ch4', 'h2s', 'settlementRate',
        'clConcentration', 'clBackground', 'landfillArea', 'rainfall', 'landfillAge', 'temperature',
      ]) {
        const v = (raw as Record<string, unknown>)?.[k];
        const numVal = typeof v === 'number' ? v : parseFloat(String(v));
        if (Number.isFinite(numVal)) extra[k] = numVal;
      }
      const res = await runDeepAnalysis(
        { scenario: String(raw?.scenario ?? ''), ...extra },
        { onStep: (step) => ctx.onStep?.(step), sessionId: ctx.sessionId },
      );
      return { result: res, grade: res.overall.grade };
    },
  },

  // ---------- 工程报告（从 tool_runs 可追溯记录组装） ----------
  {
    name: 'generate_report',
    label: '工程报告生成',
    description:
      '把对话中已执行的工具运行记录（计算器 / OGS 模拟 / 3D 建模 / 深度分析）组装为工程报告：执行摘要、输入参数（含出处与单位）、结果与分级、可追溯记录。' +
      '输出 Markdown 与结构化 sections；当用户要求"出报告/导出报告/总结一下这次的计算"时调用。',
    inputSchema: {
      scope: { type: 'string', enum: ['session', 'recent'], description: '报告范围：session=当前会话全部工具运行（默认）；recent=最近 24 条' },
    },
    meta: [],
    exec: async (ctx, values, raw) => {
      const scope = String(values.scope ?? raw?.scope ?? 'session');
      const report = generateReport(scope === 'recent' ? {} : { sessionId: ctx.sessionId });
      if (!report) throw new Error('暂无可追溯的工具运行记录（请先让智能体执行计算/模拟/分析，再生成报告）');
      return { result: report };
    },
  },

  // ---------- 权威内核（Python Landfill 3D Tool v1.7.0，headless 桥）----------
  {
    name: 'run_3d_kernel',
    label: '权威内核（3D Tool，正式数值唯一出处）',
    description:
      '调用 Landfill 3D Tool Python 权威内核（v1.7.0，physics=v170 生产口径，1094 条算法断言全过，' +
      '含 GB/T 14848 达标判定与填埋场污染"源—迁移—受体"全链路）。一切正式工程数值必须出自本工具，' +
      'calculate 仅作快速估算。模块：capacity（库容/占地）/ stability_infinite（无限边坡 Fs，含 cos²α 严格式）' +
      ' / stability_scan（Bishop 断面扫描定位最危险剖面）/ settlement（四口径沉降+Terzaghi 时程 t50/t90/t99）' +
      ' / pollution_chain（产气—水量—缺陷渗漏—1D/2D 羽流—GB/T 14848 超标—敏感井时程—HJ610 主导因子）。' +
      'physics 只接受 v170；请求旧口径 v160 会被口径守卫拦截（除非显式 frozen_reference_ok=true 作基线对照）。' +
      '返回 result + notes（内核自证注记，必须转述给用户）。',
    inputSchema: {
      module: {
        type: 'string',
        enum: ['capacity', 'stability_infinite', 'stability_scan', 'settlement', 'pollution_chain'],
        description: '内核模块名',
      },
      params: {
        type: 'object',
        description:
          '模块参数对象。stability_infinite: {slope_deg 坡角°, thickness 覆盖/堆厚 m, c 粘聚力 kPa, phi_deg 内摩擦角°, gamma 重度 kN/m³, ru 孔压比}；' +
          'stability_scan: {direction "X"|"Y", n_sections 断面数, c, phi_deg}；' +
          'settlement: {waste_height m, gamma_waste, water_table_depth m, cv m²/a, drain_path m}；' +
          'pollution_chain: {plume_years 模拟年数(默认10), well_distance_m 井距足迹下游边 m, liner 衬垫名, collection_eff 收集率}；' +
          'capacity: 空对象 {}。缺省即库内"湿润区典型填埋场"默认值。',
      },
      physics: { type: 'string', description: '缺省 v170；传 v160 将被守卫拦截，除非同时 frozen_reference_ok=true' },
      frozen_reference_ok: { type: 'boolean', description: '显式授权以冻结旧基线做对照（非常规场景）' },
    },
    inputRequired: ['module'],
    meta: [],
    exec: async (ctx, _values, raw) => {
      const module = String(raw?.module ?? '');
      const params = (raw?.params ?? {}) as Record<string, unknown>;
      const cfg: Record<string, unknown> = { module, params };
      if (raw?.physics) cfg.physics = String(raw.physics);
      if (raw?.frozen_reference_ok) cfg.frozen_reference_ok = true;
      ctx.onStep?.({ id: 'k3d', label: `调用权威内核 ${module}（确定性计算中）…`, status: 'running' });
      const r = await runKernel3d(cfg);
      ctx.onStep?.({ id: 'k3d', label: `权威内核完成（${r.elapsedMs}ms${r.ok ? '' : '：守卫拦截/失败'}）`, status: 'done' });
      const paramsTags: ToolParam[] = [
        { key: 'module', label: '内核模块', value: module, origin: 'USER_DEFINED', inRange: true },
        ...Object.entries(params).map(([k, v]) => ({
          key: `params.${k}`, label: k,
          value: typeof v === 'number' ? v : String(v),
          origin: 'USER_DEFINED' as ParamOrigin, inRange: true,
        })),
      ];
      if (!r.ok) {
        // 守卫拦截/内核错误 → 抛错进 error 信封并落库（可审计的拦截事件）
        throw new Error(`权威内核拒绝/失败：${r.error ?? '未知错误'}（stamp=${r.stamp?.physics ?? '?'}）`);
      }
      const notes = (r.notes ?? []).slice(0, 20);
      const stampTag = r.stamp ? `physics=${r.stamp.physics}, kernel=${r.stamp.kernel}, v${r.stamp.version}` : '';
      return {
        result: { stamp: r.stamp, ...(r.result as object) },
        params: paramsTags,
        warnings: [
          ...(notes.length ? [`内核注记：${notes.join(' ｜ ')}`] : []),
          ...(r.result && (r.result as any).exceed_touch_downstream ? ['超标区触及计算域边界：面积与运移距离为下限'] : []),
        ],
        unit: module === 'stability_infinite' || module === 'stability_scan' ? '—' : undefined,
      };
    },
  },
];

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, t]));

/** 组装 OpenAI 兼容 function tool 列表（供 GLM/OpenRouter 真 function calling） */
export function buildFunctionTools(defs: ToolDef[] = TOOL_DEFS): unknown[] {
  return defs.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: {
        type: 'object',
        properties: d.inputSchema,
        required: d.inputRequired ?? [],
      },
    },
  }));
}

// ==================== 统一调度 ====================

let runSeq = 0;

/**
 * 执行工具：参数出处解析 → 范围校验 → 执行 → 组装 ToolRun 信封 → 落库。
 * 永不抛错（错误进 status='error' 信封），调用方（chat 循环/页面）按信封展示。
 */
export async function execTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolCtx = {},
): Promise<ToolRun> {
  const def = TOOL_MAP[name];
  const runId = `run-${Date.now().toString(36)}-${(++runSeq).toString(36)}`;
  const startedAt = Date.now();
  if (!def) {
    const fail: ToolRun = {
      ok: false, runId, tool: name, toolLabel: name, params: [],
      result: null, status: 'error', warnings: [`未知工具: ${name}`], elapsedMs: 0, startedAt,
    };
    try { saveToolRun(fail, ctx.sessionId); } catch { /* 落库失败不影响主流程 */ }
    return fail;
  }

  // 顶层参数出处解析（动态参数工具 def.meta 为空，由 exec 内部解析）
  const defParams = resolveParams(def.meta ?? [], rawArgs, {});
  const values = toValues(defParams) as Record<string, unknown>;

  try {
    const out = await def.exec(ctx, values, rawArgs);
    const params = out.params ?? defParams;
    const rangeWarn = (p: ToolParam) => `${p.label}（${p.value}）超出合理范围，已按边界取值`;
    const warnings = [
      ...defParams.filter(p => !p.inRange).map(rangeWarn),
      // 动态参数工具（calculate/ogs）的越界项在 exec 内部解析 → 从 out.params 再扫一遍
      ...(out.params ?? []).filter(p => !p.inRange).map(rangeWarn),
      ...(out.warnings ?? []),
    ];
    const shape = extractResultShape(out.result);
    const run: ToolRun = {
      ok: true,
      runId,
      tool: name,
      toolLabel: def.label,
      params,
      result: out.result,
      unit: out.unit ?? shape.unit,
      grade: out.grade ?? shape.grade,
      status: warnings.length ? 'warning' : 'ok',
      warnings,
      elapsedMs: Date.now() - startedAt,
      startedAt,
    };
    try { saveToolRun(run, ctx.sessionId); } catch { /* 落库失败不影响主流程 */ }
    return run;
  } catch (e: any) {
    const run: ToolRun = {
      ok: false,
      runId,
      tool: name,
      toolLabel: def.label,
      params: defParams,
      result: null,
      status: 'error',
      warnings: [e?.message ?? '工具执行失败'],
      elapsedMs: Date.now() - startedAt,
      startedAt,
    };
    try { saveToolRun(run, ctx.sessionId); } catch { /* 落库失败不影响主流程 */ }
    return run;
  }
}

// ==================== 规则兜底映射（通道B：无工具能力模型的同构工具卡片） ====================

import { detectCalcIntent, detectOgsIntent } from './augment.js';
import { hasSceneIntent } from './scene-builder.js';

export interface RuleToolCall {
  name: string;
  raw: Record<string, unknown>;
}

/**
 * 把用户文本映射为"规则命中的工具调用"（通道B 兜底）。
 * 与 detectModelIntent 相比这里更细粒度：直接映射到具体工具，产出同构工具卡片。
 */
/**
 * 判定"多智能体深度分析"请求（独立于 detectModelIntent —— 后者顶层咨询拦截
 * 会把"综合评估…"这类请求挡掉，因为 CONSULT_WORDS 含"评估"）。
 * 命中：综合/全面/整体/风险/隐患 + 评估/诊断/研判 + 场地词；或异常指标场景描述。
 */
function isDeepAnalysisRequest(t: string): boolean {
  if (/怎么|如何|多少|是什么|怎么算|公式|定义|查一下/.test(t)) return false;
  if (/(综合|整体|全面|专业|风险|隐患).{0,10}(评估|诊断|分析|研判|体检|会诊|报告)/.test(t)
    && /(场地|填埋场|堆体|厂区|库区|园区|垃圾|边坡|地下水)/.test(t)) return true;
  if (/(裂缝|沉降|水位.{0,6}(上升|下降|抬升|升高)|氯离子|甲烷浓度|爆炸|超标|报警|预警).{0,24}(堆体|填埋场|场地|边坡|地下水)/
    .test(t)) return true;
  return false;
}

export function detectRuleToolCall(text: string): RuleToolCall | null {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  // ① 明确"模拟/数值"意图 → OGS（最显式：模拟/仿真/产气/沉降/降解）
  const ogs = detectOgsIntent(t);
  if (ogs) return { name: 'run_ogs_scenario', raw: { scenario: ogs.scenario, params: ogs.params } };
  // ①' 多智能体协同诊断意图 → 深做分析（"综合评估/会诊/风险研判 场地"）
  if (isDeepAnalysisRequest(t)) return { name: 'deep_analysis', raw: { scenario: t } };
  // ② 显式计算动词命中计算器 → calculate（优先级高于建场规则；
  //    "算一下边坡安全系数，堆高40m 坡角 1:2.5" 不能被 hasSceneIntent 的斜坡比规则抢走）
  const calc = detectCalcIntent(t);
  if (calc && /算|计算|估算|验算|校核|复核|Fs|安全系数|库容|产气量|渗滤液|浓度|达标|衰减|半衰期/.test(t)) {
    return { name: 'calculate', raw: { name: calc.name, params: calc.params } };
  }
  // ③ 建场/改场意图 → 3D 场景建模
  if (hasSceneIntent(t)) return { name: 'build_scene', raw: { intent: { kind: 'natural', text: t } } };
  // ④ 其它计算器命中（无显式计算动词，但词组指向计算：如"堆体沉降量"）
  if (calc) return { name: 'calculate', raw: { name: calc.name, params: calc.params } };
  return null;
}

export default { TOOL_DEFS, TOOL_MAP, execTool, resolveParams, buildFunctionTools, detectRuleToolCall, summarizeOgsPeak, GEO_PARAM_META };