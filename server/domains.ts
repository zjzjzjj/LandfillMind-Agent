/**
 * domains.ts — 领域 Agent 层（多智能体重构核心）
 *
 * 把原先 `multiagent.ts` 里 4 段各 ~80 行的 if-else 流水线，换成**声明式规格**：
 * 每个领域只描述差异（关心哪些指标 / 挑哪些隐患 / 调哪些工具 / 怎么兜底），
 * 参数阶段→工具链→评级→LLM 结论 的公共流程由 runDomainAgent 统一执行。
 * 加维度 = 加一条 spec，不再复制粘贴。
 *
 * ── 评级口径（本模块的唯一约定）─────────────────────────────
 * 领域等级**一律**取 diagnose.evaluateHazards 的隐患严重度，不再自己写阈值：
 *   · 最高严重度 = blue  → 全部达标；若指标全实测记 green（正常），否则记 blue（达标但数据不全）
 *   · yellow/orange/red  → 直接透传
 *   · 该领域指标一个都没实测 → unknown（数据不足，不参与综合聚合）
 * 这样红/绿两级才是可达的（旧实现的二值逻辑永远出不了红和绿）。
 *
 * ── 与旧实现的关键差异 ────────────────────────────────────
 * 1) 工具参数从**指标**来，不再写死常量（旧版渗滤液/填埋气/地下水三个领域的
 *    工具入参是硬编码的，改场景重跑数字一动不动）
 * 2) 缺测的监测指标不编造；确需计算输入时用典型值并在证据里标 ESTIMATED
 * 3) 每步的工具入参与结果都进 ToolEvidence，可追溯、可导出
 */

import type { SiteData, Hazard, Severity } from './diagnose.js';
import { evaluateHazards, maxSeverity, SEVERITY_RANK, severityLabel } from './diagnose.js';
import type { IndicatorValue } from './indicators.js';
import { confidenceOf } from './indicators.js';
import type { CrossFinding } from './cross-analysis.js';
import { MA_SYSTEM_PROMPTS, pickScenarioAdvice } from './prompts.js';
import { llmComplete, multiagentMaxTokens, detailPromptSuffix } from './llm.js';
import type { DetailLevel } from './llm.js';
import * as calc from './calculate.js';

// ==================== 基础类型 ====================

export type MAGrade = 'red' | 'orange' | 'yellow' | 'blue' | 'green' | 'unknown';

export interface MAStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface MAEvent {
  type: 'agent_start' | 'agent_step' | 'agent_result' | 'cache_hit' | 'error';
  agent?: string;
  step?: MAStep;
  result?: string;
  steps?: MAStep[];
  grade?: MAGrade;
  message?: string;
  cachedAt?: number;
  scenario?: string;
  cacheKey?: string;
  /** agent_result 附带的结构化结论（前端与汇总层可选消费，旧前端忽略即可） */
  finding?: DomainFinding;
  /** summary 事件附带的交叉研判结论（复合风险） */
  crossFindings?: CrossFinding[];
}

/** 同伴结论（保留旧字段以兼容既有前端与缓存） */
export interface MAPeerResult { result: string; grade?: string }

export type ParamOrigin = 'USER_DEFINED' | 'FROM_TEXT' | 'ESTIMATED' | 'DEFAULT' | 'COMPUTED';

export interface ToolParamOut {
  key: string;
  label: string;
  value: number;
  unit?: string;
  origin: ParamOrigin;
  /** origin=ESTIMATED 时说明典型值依据 */
  note?: string;
}

/** 一次工具调用的完整证据（可追溯：工具名 + 入参出处 + 结果 + 规范依据） */
export interface ToolEvidence {
  tool: string;
  label: string;
  params: ToolParamOut[];
  /** 非数值入参（如检索关键词）的展示文本 */
  paramsText?: string;
  ok: boolean;
  /** 关键结果一句话（用于步骤标签与证据表） */
  headline?: string;
  value?: string;
  unit?: string;
  ref?: string;
  warnings: string[];
}

/** 领域结论（结构化，非散文）——汇总与交叉研判都基于它 */
export interface DomainFinding extends MAPeerResult {
  domain: string;
  name: string;
  grade: MAGrade;
  confidence: 'measured' | 'estimated' | 'insufficient';
  /** 本领域用到的指标（含出处） */
  indicators: IndicatorValue[];
  /** 本领域缺测的指标标签 */
  missing: string[];
  hazards: Hazard[];
  evidence: ToolEvidence[];
  /** 一句话结论（确定性生成，非 LLM） */
  keyFinding: string;
}

export const GRADE_RANK: Record<MAGrade, number> = { green: 0, blue: 1, yellow: 2, orange: 3, red: 4, unknown: -1 };
export const GRADE_LABEL: Record<MAGrade, string> = {
  red: '重大风险', orange: '较大风险', yellow: '一般风险', blue: '较低风险', green: '正常', unknown: '数据不足',
};

export const AGENT_NAME: Record<string, string> = {
  slope: '边坡稳定', leachate: '渗滤液', lfg: '填埋气', gw: '地下水', summary: '综合研判',
};

export const CONFIDENCE_LABEL: Record<DomainFinding['confidence'], string> = {
  measured: '全部实测', estimated: '含估算值', insufficient: '数据不足',
};

// ==================== 工具调用（动态 import 打破 tools.ts 循环依赖） ====================

interface ToolRunBrief {
  ok: boolean; toolLabel: string; grade?: string; unit?: string; result: any; warnings: string[];
}

async function callToolRaw(
  name: string,
  raw: Record<string, unknown>,
  sessionId?: string,
): Promise<ToolRunBrief> {
  try {
    const { execTool } = await import('./tools.js');
    // 透传 sessionId：让深做分析的工具调用能落 tool_runs 并被 generate_report 取到
    const run = await execTool(name, raw, sessionId ? { sessionId } : {});
    return { ok: run.ok, toolLabel: run.toolLabel, grade: run.grade, unit: run.unit, result: run.result, warnings: run.warnings };
  } catch (e: any) {
    return { ok: false, toolLabel: name, result: null, warnings: [e?.message ?? '工具调用失败'] };
  }
}

/** 执行一次计算器并组装证据 */
export async function callCalc(
  calcName: string,
  params: ToolParamOut[],
  sessionId?: string,
): Promise<ToolEvidence> {
  const values: Record<string, number> = {};
  for (const p of params) values[p.key] = p.value;
  const brief = await callToolRaw('calculate', { name: calcName, params: values }, sessionId);
  const r = (brief.result ?? {}) as Record<string, unknown>;
  const value = typeof r.value === 'number' ? String(r.value) : (typeof r.Fs === 'number' ? String(r.Fs) : undefined);
  return {
    tool: `calculate(${calcName})`,
    label: brief.toolLabel,
    params,
    ok: brief.ok,
    headline: String(r.analysis ?? r.summary ?? '').slice(0, 120) || undefined,
    value,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
    ref: typeof r.ref === 'string' ? r.ref : undefined,
    warnings: brief.warnings,
  };
}

/** 执行一次 OGS 场景并组装证据 */
export async function callOgs(
  scenario: string,
  params: ToolParamOut[],
  sessionId?: string,
): Promise<ToolEvidence> {
  const values: Record<string, number> = {};
  for (const p of params) values[p.key] = p.value;
  const brief = await callToolRaw('run_ogs_scenario', { scenario, params: values }, sessionId);
  const r = (brief.result ?? {}) as Record<string, any>;
  const peak = r.peak as { peakValue?: number; unit?: string } | undefined;
  return {
    tool: `run_ogs_scenario(${scenario})`,
    label: brief.toolLabel,
    params,
    ok: brief.ok,
    headline: String(r.summary ?? '').slice(0, 120) || undefined,
    value: peak?.peakValue !== undefined ? String(peak.peakValue) : undefined,
    unit: peak?.unit,
    ref: 'OGS 5.5 ADM1 生化反应模型',
    warnings: brief.warnings,
  };
}

/** 执行一次知识库检索并组装证据 */
export async function callKb(query: string, sessionId?: string): Promise<ToolEvidence> {
  const brief = await callToolRaw('kb_lookup', { query }, sessionId);
  const hits = Array.isArray(brief.result) ? (brief.result as Array<Record<string, unknown>>) : [];
  return {
    tool: 'kb_lookup',
    label: brief.toolLabel,
    params: [],
    paramsText: `检索关键词「${query}」`,
    ok: brief.ok,
    headline: hits.slice(0, 3).map(h => String(h.title ?? h.q ?? '')).filter(Boolean).join('；').slice(0, 140) || undefined,
    ref: hits.slice(0, 3).map(h => String(h.cite ?? '')).filter(Boolean).join(' / ') || undefined,
    warnings: brief.warnings,
  };
}

// ==================== 参数取值助手 ====================

/** 从 SiteData 取一个数值 */
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * 取一个工具入参：优先实测/用户提供（出处取 ctx.origins），缺失时用典型值兜底并标 ESTIMATED。
 * 注意：**只有计算必需的输入**才允许兜底；监测指标本身不得兜底（由 indicators 层保证）。
 */
function param(
  ctx: DomainCtx,
  key: string, label: string, unit: string | undefined,
  srcKey: keyof SiteData, typical: number, why: string,
): ToolParamOut {
  const measured = n(ctx.measuredSite[srcKey]);
  if (measured !== undefined) {
    return { key, label, value: measured, unit, origin: ctx.origins[srcKey] ?? 'FROM_TEXT' };
  }
  return { key, label, value: typical, unit, origin: 'ESTIMATED', note: why };
}

/** 由实测值派生（而非直接取值）的入参 */
function derived(key: string, label: string, unit: string | undefined, value: number, note?: string): ToolParamOut {
  return { key, label, value, unit, origin: 'COMPUTED', note };
}

/** 常量入参（无指标来源，取计算器默认口径） */
function preset(key: string, label: string, unit: string | undefined, value: number, note?: string): ToolParamOut {
  return { key, label, value, unit, origin: 'DEFAULT', note };
}

/** 垃圾量估算参数（万吨）：面积 × 堆高 × 密度 */
const WASTE_DENSITY_T_PER_M3 = 0.9;

/** 填埋面积（m²）：优先面积字段，其次长×宽 */
function areaM2Of(ctx: DomainCtx): number | undefined {
  const a = n(ctx.measuredSite.landfillArea);
  if (a !== undefined) return a;
  const L = n(ctx.measuredSite.landfillLength), W = n(ctx.measuredSite.landfillWidth);
  return L !== undefined && W !== undefined ? L * W : undefined;
}

/** 垃圾量估算（万 t）：面积 × 堆高 × 密度 */
function wasteMassOf(ctx: DomainCtx): { value: number; note: string; heightEstimated: boolean } | undefined {
  const area = areaM2Of(ctx);
  if (area === undefined) return undefined;
  const measuredH = n(ctx.measuredSite.landfillHeight);
  const h = measuredH ?? 25;
  const tons = area * h * WASTE_DENSITY_T_PER_M3;
  return {
    value: Math.max(50, Math.round(tons / 10000)),
    note: `面积 ${Math.round(area)} m² × 堆高 ${h} m${measuredH === undefined ? '（堆高未实测，按典型 25 m）' : ''} × 密度 ${WASTE_DENSITY_T_PER_M3} t/m³`,
    heightEstimated: measuredH === undefined,
  };
}

// ==================== 领域上下文与规格 ====================

export interface DomainCtx {
  scenario: string;
  /** 工作副本：含材料参数估算，领域可在此注入计算输入（如 waterLevelForCalc） */
  site: SiteData;
  /** 仅实测/用户提供 */
  measuredSite: SiteData;
  measuredKeys: Set<keyof SiteData>;
  /** 每个指标的出处（USER_DEFINED / FROM_TEXT / ESTIMATED）——工具入参出处直接取这里 */
  origins: Partial<Record<keyof SiteData, ParamOrigin>>;
  /** 本领域关心的指标（已在 indicators 层提好出处） */
  indicators: IndicatorValue[];
  missing: string[];
  detail: DetailLevel;
  sessionId?: string;
  /** 超时取消信号：透传给 llmComplete，避免被放弃的请求继续占用串行队列 */
  signal?: AbortSignal;
}

export interface DomainSpec {
  id: string;
  name: string;
  promptKey: keyof typeof MA_SYSTEM_PROMPTS;
  /** 本领域关心的 SiteData 字段（用于置信度判定与"本次缺少"提示） */
  fields: (keyof SiteData)[];
  /** 从 evaluateHazards 的全量隐患里挑出本领域的 */
  pick: (hazards: Hazard[]) => Hazard[];
  /** 计算前的准备：可能往 site 注入计算输入，返回要展示的准备步骤文本 */
  prepare?: (ctx: DomainCtx) => string[];
  /** 工具链：返回可追溯证据 */
  tools: (ctx: DomainCtx) => Promise<ToolEvidence[]>;
  /** LLM 不可用时的确定性兜底结论 */
  fallback: (ctx: DomainCtx, hazards: Hazard[]) => string;
}

// ---------- 边坡稳定 ----------
// 沉降归入本领域：它表征堆体变形与完整性，与裂缝、稳定系数同属"堆体稳定性"范畴
// （diagnose 的「地表/堆体沉降」若不认领，会被评估却不出现在任何卡片上）
const SLOPE_HAZARD_TYPES = ['填埋场整体稳定', '堆体表面裂缝', '地表/堆体沉降'];

const slopeSpec: DomainSpec = {
  id: 'slope',
  name: '边坡稳定',
  promptKey: 'slope',
  fields: ['landfillHeight', 'slopeAngle', 'slopeGamma', 'slopeC', 'slopePhi', 'waterLevel', 'crackLength', 'crackWidth', 'crackCount', 'settlementRate', 'stabilityFactor'],
  pick: (hazards) => hazards.filter(h => SLOPE_HAZARD_TYPES.includes(h.type)),
  prepare: (ctx) => {
    const steps: string[] = [];
    const s = ctx.site;
    // 堆高/坡角：稳定计算的必需输入，缺测时按典型工况代入（标注 ESTIMATED，且记入 missing 提示）
    if (n(s.landfillHeight) === undefined) {
      s.landfillHeight = 25;
      steps.push('堆体高度未实测，按典型堆高 25 m 估算工况（ESTIMATED）');
    }
    if (n(s.slopeAngle) === undefined) {
      s.slopeAngle = 30;
      steps.push('坡角未实测，按典型坡角 30° 估算工况（ESTIMATED）');
    }
    // 稳定计算代表水位：只写 waterLevelForCalc，不写 waterLevel
    // —— 避免用估算值去触发「渗滤液/地下水位」监测隐患判定
    const measuredW = n(s.waterLevel);
    if (measuredW !== undefined) {
      // v5.5：waterLevel 是「库底以下埋深」，内核要「自堆顶起算埋深」，参考面相反必须换算
      s.waterLevelForCalc = calc.waterDepthFromTop(n(s.landfillHeight) ?? 25, measuredW);
      steps.push(`稳定计算水位由监测值 ${measuredW} m（库底${measuredW >= 0 ? `以下 ${measuredW} m → 堆体不受地下水浮托` : `高出库底 ${(-measuredW)} m`}）换算为自堆顶起算 ${s.waterLevelForCalc} m`);
    } else {
      s.waterLevelForCalc = calc.WATER_DEPTH_REPRESENTATIVE;
      steps.push(`水位埋深未实测，稳定计算按埋深 ${calc.WATER_DEPTH_REPRESENTATIVE} m 的代表工况代入（ESTIMATED，不参与水位监测隐患判定）`);
    }
    return steps;
  },
  tools: async (ctx) => {
    const s = ctx.site;
    const gamma = n(s.slopeGamma) ?? 11;
    const c = n(s.slopeC) ?? 15;
    const phi = n(s.slopePhi) ?? 35;
    const H = n(s.landfillHeight) ?? 25;
    const angle = n(s.slopeAngle) ?? 30;
    const w = n(s.waterLevelForCalc) ?? calc.WATER_DEPTH_REPRESENTATIVE;
    // 计算中心口径：β 传坡比倒数（1:β）；v5.1 起 slopeFs 已与隐患内核统一，两者必然同值
    const beta = Math.round(1 / Math.tan(angle * Math.PI / 180) * 100) / 100;
    const fsEv = await callCalc('slopeFs', [
      param(ctx, 'H', '堆体高度 H', 'm', 'landfillHeight', 25, '缺测时按典型堆高 25 m 估算工况'),
      derived('beta', '坡比倒数 1:β', undefined, beta, `由坡角 ${angle}° 换算`),
      param(ctx, 'gamma', '垃圾重度 γ', 'kN/m³', 'slopeGamma', 11, '国内填埋场垃圾重度典型值 10~12'),
      param(ctx, 'c', '黏聚力 c', 'kPa', 'slopeC', 15, '垃圾体黏聚力典型值 10~20'),
      param(ctx, 'phi', '内摩擦角 φ', '°', 'slopePhi', 35, '垃圾体内摩擦角典型值 30~40'),
      derived('waterTableDepth', '稳定计算水位埋深（自堆顶起算）', 'm', w, '由 prepare 阶段从监测水位换算或缺测代表值；与下方交叉核对用同一数值'),
    ], ctx.sessionId);
    const kbEv = await callKb('边坡稳定 安全系数 Fs CJJ 176 运行要求', ctx.sessionId);
    // 交叉核对：计算器口径与隐患内核口径。两条链现在吃**同一组**入参（w 与 β 均取自
    // 本函数上方），不一致即说明参数换算真的出了问题，须暴露。
    // v5.5 前水位一个取 waterLevelForCalc、一个取 waterLevel，恒会误报不一致。
    const kernel = Math.round(calc.stabilityDetail(H, angle, w, gamma, phi, c).Fs * 100) / 100;
    const calcFs = fsEv.value !== undefined ? parseFloat(fsEv.value) : NaN;
    if (Number.isFinite(calcFs) && Math.abs(calcFs - kernel) > 0.01) {
      fsEv.warnings = [...fsEv.warnings, `计算器口径 Fs=${calcFs} 与稳定内核 Fs=${kernel} 不一致，请核查参数换算`];
    } else {
      fsEv.value = String(kernel);
      fsEv.headline = `Fs = ${kernel}（运行要求 ≥1.30，CJJ 176）`;
    }
    return [fsEv, kbEv];
  },
  fallback: (ctx, hazards) => {
    const s = ctx.site;
    const H = n(s.landfillHeight) ?? 25, angle = n(s.slopeAngle) ?? 30;
    const w = n(s.waterLevelForCalc) ?? calc.WATER_DEPTH_REPRESENTATIVE;
    const Fs = Math.round(calc.stabilityDetail(H, angle, w, n(s.slopeGamma) ?? 11, n(s.slopePhi) ?? 35, n(s.slopeC) ?? 15).Fs * 100) / 100;
    const crack = hazards.find(h => h.type === '堆体表面裂缝');
    const parts = [`Fs=${Fs}（H=${H}m、坡角 ${angle}°、水位埋深 ${w}m），CJJ 176 运行期要求 ≥1.30，当前${Fs >= 1.3 ? '满足' : '不满足'}。`];
    if (crack) parts.push(`堆体裂缝：${crack.value ?? '—'}，判据「${crack.threshold ?? '—'}」。`);
    if (ctx.missing.length) parts.push(`本次缺少实测：${ctx.missing.slice(0, 4).join('、')}。`);
    return parts.join('');
  },
};

// ---------- 渗滤液 ----------
const LEACHATE_HAZARD_TYPES = ['渗滤液/地下水位', '水位上升趋势'];

const leachateSpec: DomainSpec = {
  id: 'leachate',
  name: '渗滤液',
  promptKey: 'leachate',
  fields: ['waterLevel', 'waterRiseRate', 'leachateLevel', 'landfillArea', 'rainfall', 'landfillHeight'],
  pick: (hazards) => hazards.filter(h => LEACHATE_HAZARD_TYPES.includes(h.type)),
  tools: async (ctx) => {
    const areaM2 = areaM2Of(ctx);
    const areaWan = areaM2 !== undefined ? Math.round(areaM2 / 10000 * 100) / 100 : undefined;
    const areaParam: ToolParamOut = areaWan !== undefined
      ? { key: 'area', label: '填埋面积', value: areaWan, unit: '万㎡', origin: n(ctx.measuredSite.landfillArea) !== undefined ? (ctx.origins.landfillArea ?? 'FROM_TEXT') : 'COMPUTED', note: n(ctx.measuredSite.landfillArea) !== undefined ? undefined : '由填埋体长×宽换算' }
      : { key: 'area', label: '填埋面积', value: 30, unit: '万㎡', origin: 'ESTIMATED', note: '缺测时按 30 万㎡ 典型规模' };
    const ev = await callCalc('leachateCalc', [
      areaParam,
      param(ctx, 'rainfall', '年降雨量', 'mm', 'rainfall', 1200, '缺测时按 1200 mm/a 典型值'),
      preset('runoffCoeff', '径流系数', undefined, 0.3, '按临时覆盖取 0.3'),
      param(ctx, 'wasteHeight', '垃圾覆盖厚度', 'm', 'landfillHeight', 0, '缺测时不额外计覆盖厚度'),
    ], ctx.sessionId);
    const kbEv = await callKb('渗滤液 液位 管理 导排 GB 16889', ctx.sessionId);
    return [ev, kbEv];
  },
  fallback: (ctx, hazards) => {
    const parts: string[] = [];
    const hz = hazards.map(h => `${h.type}判为${severityLabel(h.severity)}（${h.value ?? '—'}，判据 ${h.threshold ?? '—'}）`);
    parts.push(hz.length ? hz.join('；') + '。' : '本次未取得可判定的渗滤液/水位监测数据。');
    const lv = n(ctx.site.leachateLevel);
    if (lv !== undefined) parts.push(`渗滤液液位 ${lv} m。`);
    if (ctx.missing.length) parts.push(`本次缺少实测：${ctx.missing.slice(0, 4).join('、')}。`);
    return parts.join('');
  },
};

// ---------- 填埋气 ----------
const LFG_HAZARD_TYPES = ['甲烷迁移与爆炸风险', '臭气（H2S）污染', '填埋龄期（年轻填埋场）', '填埋龄期（老龄填埋场）', '周边建筑安全距离'];

const lfgSpec: DomainSpec = {
  id: 'lfg',
  name: '填埋气',
  promptKey: 'lfg',
  fields: ['ch4', 'h2s', 'nh3', 'landfillAge', 'landfillHeight', 'landfillArea', 'temperature'],
  pick: (hazards) => hazards.filter(h => LFG_HAZARD_TYPES.includes(h.type)),
  tools: async (ctx) => {
    const mass = wasteMassOf(ctx);
    const massParam = (key: string): ToolParamOut => mass
      ? { key, label: '垃圾量', value: mass.value, unit: '万t', origin: mass.heightEstimated ? 'ESTIMATED' : 'COMPUTED', note: mass.note }
      : { key, label: '垃圾量', value: 500, unit: '万t', origin: 'ESTIMATED', note: '缺测时按 500 万 t 典型规模' };
    const age = n(ctx.measuredSite.landfillAge);
    const ogEv = await callOgs('gas-production', [
      { ...massParam('wasteMass'), label: '堆体规模' },
      param(ctx, 'temperature', '堆体温度', '°C', 'temperature', 35, '产甲烷最适 30~40 °C'),
      age !== undefined
        ? derived('simYears', '模拟年限', 'a', Math.min(50, Math.max(1, Math.round(age))), `按填埋龄期 ${age} a`)
        : preset('simYears', '模拟年限', 'a', 10, '缺测时按 10 a 模拟'),
    ], ctx.sessionId);
    const lgEv = await callCalc('lfgYield', [
      massParam('M'),
      preset('k', '降解速率 k', '/a', 0.1),
      param(ctx, 'year', '填埋龄期', 'a', 'landfillAge', 10, '缺测时按 10 a 典型龄期'),
    ], ctx.sessionId);
    const kbEv = await callKb('填埋气 甲烷 收集 爆炸下限 GB 16889', ctx.sessionId);
    return [ogEv, lgEv, kbEv];
  },
  fallback: (ctx, hazards) => {
    const parts: string[] = [];
    const ch4 = n(ctx.site.ch4);
    if (ch4 !== undefined) parts.push(`区域外 CH₄ ≈ ${ch4}% vol（≈ ${Math.round(ch4 / 5 * 100)}% LEL，100% LEL ≈ 5% vol）。`);
    const hz = hazards.map(h => `${h.type}判为${severityLabel(h.severity)}（判据 ${h.threshold ?? '—'}）`);
    if (hz.length) parts.push(hz.join('；') + '。');
    if (ctx.missing.includes('甲烷浓度')) parts.push('本次未取得甲烷实测浓度，无法判定爆炸风险等级。');
    return parts.join('');
  },
};

// ---------- 地下水 ----------
const GW_HAZARD_TYPES = ['地下水 Cl⁻ 污染'];

const gwSpec: DomainSpec = {
  id: 'gw',
  name: '地下水',
  promptKey: 'gw',
  fields: ['clConcentration', 'clBackground', 'gwVelocity'],
  pick: (hazards) => hazards.filter(h => GW_HAZARD_TYPES.includes(h.type)),
  tools: async (ctx) => {
    const ev = await callCalc('advect', [
      param(ctx, 'C0', '源浓度 C0', 'mg/L', 'clConcentration', 280, '缺测时按渗滤液典型氯离子浓度 280 mg/L'),
      param(ctx, 'v', '地下水流速 v', 'm/d', 'gwVelocity', 0.1, '缺测时按 0.1 m/d 典型值'),
      param(ctx, 'x', '迁移距离 x', 'm', 'nearbyBuildingDistance', 200, '缺测时按 200 m（常规下游监测井距）'),
      preset('D', '弥散系数 D', 'm²/d', 10),
    ], ctx.sessionId);
    const kbEv = await callKb('地下水 污染 调查 HJ 25.6 氯离子 GB/T 14848', ctx.sessionId);
    return [ev, kbEv];
  },
  fallback: (ctx, hazards) => {
    const parts: string[] = [];
    const cl = n(ctx.site.clConcentration), bg = n(ctx.site.clBackground);
    if (cl !== undefined && bg !== undefined && bg > 0) {
      parts.push(`Cl⁻ 实测 ${cl} mg/L、背景 ${bg} mg/L，超背景约 ${(cl / bg).toFixed(1)} 倍；GB/T 14848 III 类限值 250 mg/L，当前${cl > 250 ? '已超标准' : '未超标准'}。`);
    } else if (cl !== undefined) {
      parts.push(`Cl⁻ 实测 ${cl} mg/L（未提供背景值，无法计算超标倍数）；GB/T 14848 III 类限值 250 mg/L。`);
    }
    const hz = hazards.map(h => `${h.type}判为${severityLabel(h.severity)}`);
    if (hz.length) parts.push(hz.join('；') + '。');
    if (ctx.missing.length) parts.push(`本次缺少实测：${ctx.missing.slice(0, 4).join('、')}。`);
    return parts.join('');
  },
};

export const DOMAIN_SPECS: DomainSpec[] = [slopeSpec, leachateSpec, lfgSpec, gwSpec];
export const DOMAIN_MAP: Record<string, DomainSpec> = Object.fromEntries(DOMAIN_SPECS.map(s => [s.id, s]));

// ==================== 评级 ====================

/**
 * 由隐患严重度推出领域等级。
 * blue 视为"全部达标"：指标全实测 → green（正常），否则 blue（达标但数据不全）。
 */
export function gradeFromHazards(
  hazards: Hazard[],
  confidence: DomainFinding['confidence'],
): MAGrade {
  if (confidence === 'insufficient') return 'unknown';
  const worst: Severity = hazards.length ? maxSeverity(hazards) : 'blue';
  if (worst === 'blue') return confidence === 'measured' ? 'green' : 'blue';
  return worst;
}

/**
 * 确定性推导某领域的结论（不调工具、不调 LLM）。
 *
 * 这是**领域等级的唯一定义处**：领域 Agent 与总工汇总都调用它，
 * 因此卡片上的等级与综合研判的等级必然一致（旧实现两处各写一套阈值，会漂移）。
 * 领域隔离：在自己的 site 浅拷贝上跑 prepare，避免互相污染。
 */
export function deriveDomainResult(
  spec: DomainSpec,
  ctx: DomainCtx,
): { grade: MAGrade; hazards: Hazard[]; confidence: DomainFinding['confidence']; prepareSteps: string[]; site: SiteData } {
  const site: SiteData = { ...ctx.site };
  const localCtx: DomainCtx = { ...ctx, site };
  const prepareSteps = spec.prepare ? spec.prepare(localCtx) : [];
  const hazards = spec.pick(evaluateHazards(site));
  const confidence = confidenceOf(spec.fields, ctx.measuredKeys);
  return { grade: gradeFromHazards(hazards, confidence), hazards, confidence, prepareSteps, site };
}

// ==================== 领域 Agent 运行器 ====================

/** 一句话结论（确定性生成，与 LLM 散文解耦） */
function buildKeyFinding(spec: DomainSpec, grade: MAGrade, hazards: Hazard[], missing: string[]): string {
  const top = hazards.length
    ? [...hazards].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0]
    : undefined;
  const base = top
    ? `${GRADE_LABEL[grade]}：${top.type}（${top.value ?? '—'}，判据 ${top.threshold ?? '—'}）`
    : `${GRADE_LABEL[grade]}：本领域未命中隐患规则`;
  return missing.length ? `${base}；缺少实测：${missing.slice(0, 3).join('、')}` : base;
}

/**
 * 运行单个领域 Agent，逐步 yield 事件。
 * 流程：参数阶段 → 准备（计算输入兜底）→ 工具链 → 确定性评级 → LLM 结论 → agent_result
 */
export async function* runDomainAgent(
  spec: DomainSpec,
  ctx: DomainCtx,
): AsyncGenerator<MAEvent> {
  const agent = spec.id;
  yield { type: 'agent_start', agent };

  // 领域隔离 + 确定性推导（prepare 会往 site 注入计算输入，因此必须用自己的拷贝，
  // 否则边坡注入的典型堆高会串到填埋气的垃圾量估算里）
  const derived = deriveDomainResult(spec, ctx);
  const c: DomainCtx = { ...ctx, site: derived.site };
  ctx = c;

  const steps: MAStep[] = [];
  const mk = (id: string, label: string, status: MAStep['status'] = 'done'): MAStep => {
    const s: MAStep = { id, label, status };
    steps.push(s);
    return s;
  };

  let grade: MAGrade = 'unknown';
  let result = '';
  const evidence: ToolEvidence[] = [];
  let hazards: Hazard[] = [];

  try {
    // —— 参数阶段：本领域用到的指标及出处 ——
    const own = ctx.indicators.filter(i => spec.fields.includes(i.key));
    const indText = own.length
      ? own.map(i => `${i.label}=${i.value}${i.unit ?? ''}（${i.origin}）`).join('，')
      : '（无实测指标）';
    yield { type: 'agent_step', agent, step: mk('0', `【参数阶段】${indText}`) };
    for (const i of own.filter(x => x.note)) {
      yield { type: 'agent_step', agent, step: mk(`0n-${String(i.key)}`, `口径说明：${i.label} — ${i.note}`) };
    }

    // —— 准备：计算输入兜底（如堆高/坡角/代表水位）——
    for (const [idx, label] of derived.prepareSteps.entries()) {
      yield { type: 'agent_step', agent, step: mk(`p${idx}`, label) };
    }

    // —— 工具链 ——
    yield { type: 'agent_step', agent, step: mk('t', '调用工程工具链', 'running') };
    const toolEv = await spec.tools(ctx);
    evidence.push(...toolEv);
    for (const [idx, ev] of toolEv.entries()) {
      const brief = ev.headline ? `：${ev.headline}` : (ev.value !== undefined ? `：${ev.value}${ev.unit ?? ''}` : '');
      yield { type: 'agent_step', agent, step: mk(`t${idx}`, `已调用 ${ev.tool}${ev.ok ? '' : '（失败）'}${brief}`) };
      for (const wmsg of ev.warnings) {
        yield { type: 'agent_step', agent, step: mk(`tw${idx}`, `⚠ ${wmsg}`) };
      }
    }

    // —— 确定性评级（唯一阈值源：diagnose.evaluateHazards，与总工汇总共用 deriveDomainResult）——
    hazards = derived.hazards;
    grade = derived.grade;
    const confidence = derived.confidence;
    const hazardText = hazards.length
      ? hazards.map(h => `${h.type}：${severityLabel(h.severity)}（${h.value ?? '—'}）`).join('；')
      : '未命中隐患规则';
    yield {
      type: 'agent_step', agent,
      step: mk('g', `确定性评级：${GRADE_LABEL[grade]}（${hazardText}）；数据置信度：${CONFIDENCE_LABEL[confidence]}`),
    };

    // —— LLM 专家结论 ——
    yield { type: 'agent_step', agent, step: mk('ai', 'AI 专家结论生成中…', 'running') };
    const keyFinding = buildKeyFinding(spec, grade, hazards, ctx.missing);
    const evidenceText = evidence.map(e => {
      const ps = e.params.map(p => `${p.label}=${p.value}${p.unit ?? ''}（${p.origin}）`).join('，');
      return `· ${e.tool}（${e.ok ? '成功' : '失败'}）：${ps}${e.value !== undefined ? ` → ${e.value}${e.unit ?? ''}` : ''}${e.headline ? `；${e.headline}` : ''}${e.ref ? `；依据：${e.ref}` : ''}`;
    }).join('\n');
    const hazardDetail = hazards.map(h => {
      const calcText = (h.calc ?? []).map(c => `    · ${c.label}：${c.formula} → ${c.detail}`).join('\n');
      return `【${h.type}】严重度=${severityLabel(h.severity)}｜实测=${h.value ?? '—'}｜判据=${h.threshold ?? '—'}｜机理=${h.mechanism ?? '—'}｜依据=${h.reference ?? '—'}\n${calcText}`;
    }).join('\n');

    const ai = await llmComplete([
      { role: 'system', content: MA_SYSTEM_PROMPTS[spec.promptKey] + detailPromptSuffix(ctx.detail) },
      {
        role: 'user',
        content: [
          `诊断场景：${ctx.scenario}`,
          '',
          `【本领域实测指标】${indText}`,
          ctx.missing.length ? `【本领域缺少的实测指标】${ctx.missing.join('、')}（不得据此编造结论，如结论受影响请明确说明）` : '',
          '',
          '【工程工具调用证据（不得另造数据）】',
          evidenceText || '（无）',
          '',
          '【确定性隐患判定（阈值由计算内核给出，不得改写严重度）】',
          hazardDetail || '本领域未命中隐患规则。',
          '',
          `【确定性评级】${GRADE_LABEL[grade]}（数据置信度：${CONFIDENCE_LABEL[confidence]}）`,
          '',
          `请给出${spec.name}专家的分析结论。`,
          pickScenarioAdvice(ctx.scenario),
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: multiagentMaxTokens(ctx.detail), timeoutMs: 30000, retries: 2, signal: ctx.signal });

    result = ai ?? spec.fallback(ctx, hazards);
    yield { type: 'agent_step', agent, step: mk('aidone', ai ? '专家结论已生成（AI 主通道）' : 'AI 通道暂不可用，输出确定性结论') };
  } catch (e: any) {
    yield { type: 'error', agent, message: e?.message ?? 'Agent 执行异常' };
    // 出错也给出确定性结论，不留空卡片
    grade = 'unknown';
    result = result || '本领域分析未能完成，请稍后重试或检查输入数据。';
  }

  yield {
    type: 'agent_result', agent,
    // 收尾：把仍然标记为 running 的步骤置为 done，避免前端/对话页留下永久转圈
    steps: steps.map(s => (s.status === 'running' ? { ...s, status: 'done' as const } : s)),
    result, grade,
    finding: {
      domain: spec.id, name: spec.name, grade,
      confidence: derived.confidence,
      indicators: ctx.indicators.filter(i => spec.fields.includes(i.key)),
      missing: ctx.missing,
      hazards, evidence,
      keyFinding: buildKeyFinding(spec, grade, hazards, ctx.missing),
      result,
    },
  };
}

export default { DOMAIN_SPECS, DOMAIN_MAP, runDomainAgent, gradeFromHazards, GRADE_RANK, GRADE_LABEL, AGENT_NAME };
