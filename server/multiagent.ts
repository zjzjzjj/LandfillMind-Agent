/**
 * multiagent.ts — 多智能体深度分析编排层（v5.1 重构）
 *
 * 本模块只做**编排**，不再承载领域逻辑与阈值：
 *   · 指标提取     → indicators.ts（出处 + 缺测语义）
 *   · 阈值与隐患   → diagnose.ts   （唯一口径，evaluateHazards）
 *   · 领域 Agent   → domains.ts    （声明式规格 + 公共运行器）
 *   · 交叉研判     → cross-analysis.ts（确定性复合风险规则）
 *
 * 流程：
 *   scenario + 表单参数
 *     → extractIndicators（一次提取，四领域共用）
 *     → 4 领域 Agent 并行（各自调工具 → evaluateHazards 定级 → LLM 散文）
 *     → 总工：本地重建各领域结论 → 交叉研判 → worst-of 综合 → 敏感性 → LLM 报告
 *
 * ── 修复的既有缺陷（详见 CHANGELOG）───────────────────────────
 *   · 领域等级改由 evaluateHazards 派生 → 红/绿两级可达（旧实现二值逻辑永远出不了）
 *   · 地下水 Cl⁻ 等级不再倒挂（旧：超背景 2 倍记 blue，低于未超时的 yellow）
 *   · 总工汇总不再用正则重算等级，而是取各领域真实等级 → 卡片与综合必然一致
 *   · 敏感性扫描与边坡卡片同源（calc.stabilityDetail）→ 同一次运行只有一个 Fs
 *   · 缺测的监测指标不再用 DEMO 形状的默认值冒充"提取到的实测指标"
 *   · 缓存 key 计入 detail（旧：切"详细"会命中"摘要"缓存）
 *   · 预热与真实请求的 key 不再错位（旧：deep_analysis 路径的 origins 指纹导致预热全废）
 *   · 失败不再伪装成 'yellow'，改为 unknown（数据不足）
 *   · 领域间 site 隔离，避免边坡注入的典型堆高串到填埋气估算
 *   · 超时透传 AbortSignal，不再让被放弃的请求占住串行队列
 */

import * as calc from './calculate.js';
import { llmComplete, multiagentMaxTokens, detailPromptSuffix } from './llm.js';
import type { DetailLevel } from './llm.js';
import { MA_SYSTEM_PROMPTS, pickScenarioAdvice } from './prompts.js';
import { extractIndicators } from './indicators.js';
import type { ExtractedIndicators, ExplicitParams } from './indicators.js';
import { severityLabel } from './diagnose.js';
import type { Hazard, SiteData } from './diagnose.js';
import {
  DOMAIN_SPECS, DOMAIN_MAP, runDomainAgent, deriveDomainResult,
  GRADE_RANK, GRADE_LABEL, AGENT_NAME, CONFIDENCE_LABEL,
} from './domains.js';
import type {
  MAEvent, MAStep, MAGrade, MAPeerResult, DomainFinding, DomainCtx,
} from './domains.js';
import { evaluateCross, overallGrade, CROSS_RULES } from './cross-analysis.js';
import type { CrossFinding } from './cross-analysis.js';

// 类型与常量的透传（前端与后端其它模块历史上从这里 import）
export type {
  MAEvent, MAStep, MAGrade, MAPeerResult, DomainFinding, ToolEvidence, ToolParamOut, ParamOrigin,
} from './domains.js';
export { GRADE_RANK, GRADE_LABEL, AGENT_NAME };
export type { CrossFinding } from './cross-analysis.js';

// ==================== 场景参数（对外契约保持不变） ====================

/** 边坡计算场景参数（可由前端表单、文本正则或 LLM 抽取提供） */
export interface MASceneParams {
  height?: number;          // 堆体高度 m（默认 25）
  slopeAngle?: number;      // 坡角 °（默认 30）
  waterLevelDepth?: number; // 水位埋深 m（默认 10）
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 填默认值 + 区间收敛（保持既有对外语义；仅供 API/缓存键使用） */
export function normalizeParams(p?: MASceneParams | null): Required<MASceneParams> {
  const pick = (v: number | undefined, fb: number, min: number, max: number): number =>
    (typeof v === 'number' && Number.isFinite(v)) ? clamp(v, min, max) : fb;
  return {
    height: pick(p?.height, 25, 5, 60),
    slopeAngle: pick(p?.slopeAngle, 30, 10, 60),
    waterLevelDepth: pick(p?.waterLevelDepth, 10, 0, 30),
  };
}

/**
 * 仅保留**用户真正提供**的参数（不填默认值）+ 区间收敛。
 *
 * 旧实现的问题是 normalizeParams 总会填上默认值，于是下游把 25/30/10 一律当成
 * USER_DEFINED —— 用户没碰过的默认值也显示为"用户指定"，追溯失去意义。
 * 提取层只应看到"确实给过的参数"，缺的由文本提取/典型值接管。
 */
function explicitForExtraction(p?: MASceneParams | Partial<SiteData> | null): ExplicitParams | undefined {
  const src = (p ?? {}) as Record<string, unknown>;
  const out: ExplicitParams = {};
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const h = num(src.height) ?? num(src.landfillHeight);
  const a = num(src.slopeAngle);
  const d = num(src.waterLevelDepth) ?? num(src.waterLevel);
  if (h !== undefined) out.height = clamp(h, 5, 60);
  if (a !== undefined) out.slopeAngle = clamp(a, 10, 60);
  if (d !== undefined) out.waterLevelDepth = clamp(d, 0, 30);
  // 其余 SiteData 字段直接透传（供对话路径/前端带结构化入参）
  for (const k of [
    'landfillArea', 'landfillLength', 'landfillWidth', 'rainfall', 'landfillAge',
    'crackLength', 'crackWidth', 'crackCount',
    'clConcentration', 'clBackground', 'gwVelocity', 'h2s', 'nh3', 'settlementRate', 'temperature',
    'slopeGamma', 'slopeC', 'slopePhi', 'stabilityFactor',
  ] as const) {
    const v = num(src[k]);
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 路由层入口：表单/文本正则优先，缺失时用 LLM 结构化 JSON 抽取兜底（返回边坡三参数） */
export async function extractSceneParams(
  scenario: string,
  explicit?: MASceneParams | null,
): Promise<Required<MASceneParams>> {
  const ind = await extractIndicators(String(scenario ?? ''), explicitForExtraction(explicit));
  const site = ind.site;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return normalizeParams({
    height: num(site.landfillHeight),
    slopeAngle: num(site.slopeAngle),
    waterLevelDepth: num(site.waterLevelForCalc ?? site.waterLevel),
  });
}

// ==================== 上下文构建 ====================

/** 由提取结果构建领域上下文（导出供自检脚本构造确定性断言） */
export function buildDomainCtx(
  scenario: string,
  ind: ExtractedIndicators,
  detail: DetailLevel = 'standard',
  sessionId?: string,
  signal?: AbortSignal,
): DomainCtx {
  return {
    scenario,
    site: { ...ind.site },
    measuredSite: ind.measuredSite,
    measuredKeys: new Set(ind.measured.map(m => m.key)),
    origins: ind.origins,
    // 实测 + 估算都带上：领域可按 spec.fields 过滤，标 ESTIMATED 的材料参数对用户是透明的
    indicators: [...ind.measured, ...ind.estimated],
    missing: ind.missing,
    detail,
    sessionId,
    signal,
  };
}

const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ==================== 总工综合研判（含交叉研判 + 敏感性扫描） ====================

/**
 * 敏感性扫描：单因素 ±20%，确定性内核。
 * 与边坡领域**同源**（都用 calc.stabilityDetail），因此基准 Fs 与边坡卡片必然一致
 * —— 旧实现此处走 calculateStabilityFactor、卡片走 slopeFs，同一次运行出现两个 Fs。
 */
export function sensitivityScan(ctx: DomainCtx): { baseFs: number; text: string; items: Array<{ label: string; delta: number }> } {
  const slope = DOMAIN_MAP.slope;
  if (!slope) return { baseFs: NaN, text: '', items: [] };
  const d = deriveDomainResult(slope, ctx);
  const s = d.site;
  const H = n(s.landfillHeight) ?? 25;
  const angle = n(s.slopeAngle) ?? 30;
  const w = n(s.waterLevelForCalc) ?? 10;
  const gamma = n(s.slopeGamma) ?? 11;
  const phi = n(s.slopePhi) ?? 35;
  const c = n(s.slopeC) ?? 15;

  type ProbeKey = 'height' | 'slopeAngle' | 'waterLevel';
  const fAt = (k: ProbeKey, v: number): number => calc.stabilityDetail(
    k === 'height' ? v : H,
    k === 'slopeAngle' ? v : angle,
    k === 'waterLevel' ? v : w,
    gamma, phi, c,
  ).Fs;

  const baseFs = fAt('height', H);
  // 统一 ±20%（旧实现水位埋深用的是 ×0.6/×1.6，却把标签写成"±20%"）
  const probes: Array<{ label: string; key: ProbeKey; lo: number; hi: number }> = [
    { label: '堆体高度 H', key: 'height', lo: H * 0.8, hi: H * 1.2 },
    { label: '坡角 β', key: 'slopeAngle', lo: clamp(angle * 0.8, 10, 60), hi: clamp(angle * 1.2, 10, 60) },
    { label: '水位埋深', key: 'waterLevel', lo: clamp(w * 0.8, 0, 30), hi: clamp(w * 1.2, 0, 30) },
  ];
  const items = probes
    .map(p => ({ label: p.label, delta: Math.abs(fAt(p.key, p.hi) - fAt(p.key, p.lo)) }))
    .sort((a, b) => b.delta - a.delta);
  const text = items.length
    ? `${items[0].label} 主导（Fs 变化 ${items[0].delta.toFixed(2)}），其次 ${items[1]?.label ?? '—'}（${(items[1]?.delta ?? 0).toFixed(2)}）`
    : '';
  return { baseFs: Math.round(baseFs * 100) / 100, text, items };
}

async function* runSummaryAgent(
  ctx: DomainCtx,
  peerResults?: Record<string, MAPeerResult>,
  peerFindings?: Record<string, DomainFinding>,
): AsyncGenerator<MAEvent> {
  const agent = 'summary';
  yield { type: 'agent_start', agent };
  const steps: MAStep[] = [];
  const mk = (id: string, label: string, status: MAStep['status'] = 'done'): MAStep => {
    const s: MAStep = { id, label, status };
    steps.push(s);
    return s;
  };

  let grade: MAGrade = 'unknown';
  let result = '';
  let cross: CrossFinding[] = [];

  try {
    // —— 本地重建各领域结论：确定性、不依赖前端回传（前端旧版只传散文，无法做交叉研判）——
    const findings: Record<string, DomainFinding> = {};
    for (const spec of DOMAIN_SPECS) {
      const d = deriveDomainResult(spec, ctx);
      findings[spec.id] = {
        domain: spec.id, name: spec.name, grade: d.grade, confidence: d.confidence,
        indicators: ctx.indicators.filter(i => spec.fields.includes(i.key)),
        missing: ctx.missing,
        hazards: d.hazards,
        evidence: peerFindings?.[spec.id]?.evidence ?? [],
        keyFinding: d.hazards.length
          ? d.hazards.map(h => `${h.type}（${severityLabel(h.severity)}）`).join('；')
          : '未命中隐患规则',
        result: '',
      };
    }
    // 合并上层/前端带来的信息（结构化优先，散文其次）
    if (peerFindings) {
      for (const [k, f] of Object.entries(peerFindings)) {
        if (!findings[k]) continue;
        findings[k] = { ...findings[k], ...f, hazards: f.hazards?.length ? f.hazards : findings[k].hazards };
      }
    } else if (peerResults) {
      for (const [k, p] of Object.entries(peerResults)) {
        if (!findings[k]) continue;
        if (p.result) findings[k].result = p.result;
        if (p.grade && p.grade in GRADE_RANK) findings[k].grade = p.grade as MAGrade;
      }
    }

    const gradeLine = DOMAIN_SPECS
      .map(s => `${s.name}：${GRADE_LABEL[findings[s.id].grade]}（${CONFIDENCE_LABEL[findings[s.id].confidence]}）`)
      .join(' ｜ ');
    yield { type: 'agent_step', agent, step: mk('1', `接收各领域确定性评级：${gradeLine}`) };

    // —— 交叉研判（确定性规则）——
    cross = evaluateCross(findings, ctx.site);
    if (cross.length) {
      for (const [idx, cf] of cross.entries()) {
        yield { type: 'agent_step', agent, step: mk(`x${idx}`, `【复合风险】${cf.title} → ${GRADE_LABEL[cf.severity]}；判据：${cf.basis.join(' ∧ ')}`) };
      }
    } else {
      yield { type: 'agent_step', agent, step: mk('x', `未命中复合风险规则（已核 ${CROSS_RULES.length} 条工程耦合判据）`) };
    }

    // —— 综合等级：各领域 worst-of + 交叉研判 ——
    const ov = overallGrade(findings, cross);
    grade = ov.grade;
    yield {
      type: 'agent_step', agent,
      step: mk('2', `确定性综合评级：${GRADE_LABEL[grade]}${ov.basis === 'insufficient' ? '（各领域均无实测数据，无法定级）' : ''}`),
    };

    // —— 敏感性扫描 ——
    let sens: { baseFs: number; text: string } = { baseFs: NaN, text: '' };
    try {
      sens = sensitivityScan(ctx);
      if (sens.text) {
        yield { type: 'agent_step', agent, step: mk('3', `【敏感性】${sens.text}（单因素 ±20%，确定性内核；基准 Fs=${sens.baseFs}）`) };
      }
    } catch { /* 敏感性失败不阻塞 */ }

    // —— LLM 综合报告 ——
    yield { type: 'agent_step', agent, step: mk('4', '总工综合研判中…', 'running') };
    const peerText = DOMAIN_SPECS.map(s => {
      const f = findings[s.id];
      const hz = f.hazards.map(h => `　· ${h.type}：${severityLabel(h.severity)}｜实测 ${h.value ?? '—'}｜判据 ${h.threshold ?? '—'}`).join('\n');
      return `【${s.name}｜${GRADE_LABEL[f.grade]}｜数据置信度：${CONFIDENCE_LABEL[f.confidence]}】\n${f.result || f.keyFinding}${hz ? '\n' + hz : ''}`;
    }).join('\n\n');
    const crossText = cross.length
      ? cross.map(c => `【${c.title}】等级=${GRADE_LABEL[c.severity]}\n　判据：${c.basis.join(' ∧ ')}\n　机理：${c.reasoning}\n　联合处置：${c.advice}`).join('\n\n')
      : '未命中复合风险规则。';

    const fallback = [
      `综合风险等级：${GRADE_LABEL[grade]}。`,
      cross.length ? `命中 ${cross.length} 条复合风险规则，最高为「${cross[0].title}」（${GRADE_LABEL[cross[0].severity]}）。` : '',
      sens.text ? `参数敏感性：${sens.text}（基准 Fs=${sens.baseFs}）。` : '',
      `处置优先级：${grade === 'red' || grade === 'orange' ? '按上列复合风险的联合处置措施执行，72 小时内完成应急评估并复核监测数据。' : '维持常规监测与巡检，按领域结论逐项落实。'}`,
    ].filter(Boolean).join('');

    const ai = await llmComplete([
      { role: 'system', content: (MA_SYSTEM_PROMPTS.summary ?? '') + detailPromptSuffix(ctx.detail) },
      {
        role: 'user',
        content: [
          `诊断场景：${ctx.scenario}`,
          '',
          '【四个专业领域的确定性评级与结论（等级由计算内核判定，不得改写）】',
          peerText,
          '',
          '【复合风险交叉研判（确定性规则命中结果，须在报告中体现）】',
          crossText,
          '',
          sens.text ? `【参数敏感性扫描】${sens.text}（单因素 ±20%；基准 Fs=${sens.baseFs}）` : '',
          '',
          `【确定性综合等级】${GRADE_LABEL[grade]}${ov.basis === 'insufficient' ? '（数据不足）' : ''}`,
          ctx.missing.length ? `【本次缺少的实测指标】${ctx.missing.join('、')}（如影响结论请明确说明）` : '',
          '',
          '请输出综合研判报告（含处置优先级与 72 小时行动项）。',
          pickScenarioAdvice(ctx.scenario),
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: multiagentMaxTokens(ctx.detail), timeoutMs: 35000, retries: 2, signal: ctx.signal });

    result = ai ?? fallback;
    yield { type: 'agent_step', agent, step: mk('5', ai ? '综合报告已生成（AI 主通道）' : 'AI 通道暂不可用，输出确定性结论') };
  } catch (e: any) {
    yield { type: 'error', agent, message: e?.message ?? '总工研判异常' };
    grade = 'unknown';
    result = result || '综合研判未能完成。';
  }

  const summaryFinding: DomainFinding = {
    domain: 'summary', name: AGENT_NAME.summary ?? '综合研判',
    grade, confidence: 'estimated',
    indicators: ctx.indicators, missing: ctx.missing,
    hazards: [], evidence: [],
    keyFinding: `综合等级 ${GRADE_LABEL[grade]}${cross.length ? `；命中 ${cross.length} 条复合风险规则` : ''}`,
    result,
  };

  yield {
    type: 'agent_result', agent,
    steps: steps.map(s => (s.status === 'running' ? { ...s, status: 'done' as const } : s)),
    result, grade, crossFindings: cross, finding: summaryFinding,
  };
}

// ==================== 统一入口（保持既有签名） ====================

/** 运行单个 Agent，逐步 yield 事件 */
export async function* runAgent(
  agent: string,
  scenario: string,
  opts?: {
    peerResults?: Record<string, MAPeerResult>;
    peerFindings?: Record<string, DomainFinding>;
    params?: MASceneParams | null;
    detail?: DetailLevel;
    /** 已提取好的指标（编排层传入可避免重复提取） */
    indicators?: ExtractedIndicators;
    sessionId?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<MAEvent> {
  const detail: DetailLevel = opts?.detail ?? 'standard';
  const text = String(scenario ?? '');
  let ind: ExtractedIndicators;
  try {
    ind = opts?.indicators ?? await extractIndicators(text, explicitForExtraction(opts?.params));
  } catch (e: any) {
    yield { type: 'error', agent, message: `指标提取失败：${e?.message ?? '未知错误'}` };
    return;
  }
  const ctx = buildDomainCtx(text, ind, detail, opts?.sessionId, opts?.signal);

  const spec = DOMAIN_MAP[agent];
  if (spec) {
    yield* runDomainAgent(spec, ctx);
    return;
  }
  if (agent === 'summary') {
    yield* runSummaryAgent(ctx, opts?.peerResults, opts?.peerFindings);
    return;
  }
  yield { type: 'error', agent, message: `未知 Agent：${agent}（可用：${[...DOMAIN_SPECS.map(s => s.id), 'summary'].join('、')}）` };
}

// ==================== 结果缓存（LRU） ====================

const AGENT_CACHE_MAX = 20;
/** key → { events, cachedAt }。cachedAt 是**真正的落缓存时刻**（旧实现用命中时刻冒充） */
export const agentCache = new Map<string, { events: MAEvent[]; cachedAt: number }>();

/**
 * 缓存键：agent + 场景 + 表单参数 + 详细度。
 *
 * 场景文本做**空白归一化**后再入键。原因：同一段场景在不同文件里可能因编辑器/版本控制
 * 变成 CRLF 或 LF，而分析结果（正则都是 \s*、LLM 也不敏感）与空白无关。若按原文入键，
 * 服务端预热用 LF、前端提交用 CRLF，键就永远对不上——这正是 v5.0 预热一直失效的原因：
 * `DEMO_SCENARIO` 在 server/multiagent.ts 里是 LF、在 src/pages/MultiAgentPage.tsx 里是 CRLF，
 * 两处看似"完全一致"，实际差 3 个字符。
 *
 * v5.1 另两项变动：
 *   ① 计入 detail —— 旧实现切"详细"模式会命中"摘要"缓存，用户以为切了却拿到旧短结论
 *   ② 去掉 origins 指纹 —— 出处现在由 scenario+explicit 确定性推导，两侧自然一致；
 *      旧实现预热不传 origins、deep_analysis 恒传 org=UUU，导致预热对该路径完全无效
 */
export function agentCacheKey(
  agent: string,
  scenario: string,
  params: Required<MASceneParams>,
  detail?: DetailLevel,
): string {
  const normalizedScene = String(scenario ?? '').replace(/\s+/g, ' ').trim();
  return `${agent}|${JSON.stringify(params)}|${detail ?? 'standard'}|${normalizedScene}`;
}

function cacheFingerprint(
  agent: string,
  scenario: string,
  params: Required<MASceneParams>,
  detail?: DetailLevel,
  peerResults?: Record<string, MAPeerResult>,
  peerFindings?: Record<string, DomainFinding>,
): string {
  // 摘要的缓存键必须区分同伴结论：只按长度区分会撞键，
  // 把上一次的综合报告重放给这一次的领域结论（改场景重跑时尤其明显）
  let peers = '';
  if (agent === 'summary') {
    const pf = peerFindings ? Object.keys(peerFindings).sort() : [];
    if (pf.length) {
      peers = '|pf=' + hash32(pf.map(k => `${k}:${peerFindings![k]?.grade ?? ''}:${(peerFindings![k]?.keyFinding ?? '').length}`).join(','));
    } else if (peerResults && Object.keys(peerResults).length) {
      peers = '|pr=' + hash32(Object.keys(peerResults).sort()
        .map(k => `${k}:${peerResults[k]?.grade ?? ''}:${peerResults[k]?.result ?? ''}`).join(''));
    }
  }
  return agentCacheKey(agent, scenario, params, detail) + peers;
}

/** 32 位字符串哈希（FNV-1a 变体）——仅用于缓存键，不需密码学强度 */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

/** 按 agent+场景+参数+详细度 命中缓存直接重放，未命中则完整执行并写入缓存（LRU） */
export async function getCachedAgentRun(
  agent: string,
  scenario: string,
  params: Required<MASceneParams>,
  detail?: DetailLevel,
  peerResults?: Record<string, MAPeerResult>,
  opts?: { peerFindings?: Record<string, DomainFinding>; sessionId?: string; signal?: AbortSignal },
): Promise<{ events: MAEvent[]; fromCache: boolean; cachedAt?: number }> {
  const key = cacheFingerprint(agent, scenario, params, detail, peerResults, opts?.peerFindings);
  const hit = agentCache.get(key);
  if (hit) {
    agentCache.delete(key);      // LRU touch
    agentCache.set(key, hit);
    const cacheHitEvent: MAEvent = {
      type: 'cache_hit', agent, cachedAt: hit.cachedAt,
      scenario: scenario.slice(0, 80), cacheKey: key,
    };
    return { events: [cacheHitEvent, ...hit.events], fromCache: true, cachedAt: hit.cachedAt };
  }
  const events: MAEvent[] = [];
  for await (const ev of runAgent(agent, scenario, {
    params, detail, peerResults,
    peerFindings: opts?.peerFindings,
    sessionId: opts?.sessionId,
    signal: opts?.signal,
  })) {
    events.push(ev);
  }
  // 出错或被取消的运行不入缓存（否则错误态/半截结果会被重放给下一次演示）
  if (events.some(e => e.type === 'error') || opts?.signal?.aborted) return { events, fromCache: false };
  agentCache.set(key, { events, cachedAt: Date.now() });
  if (agentCache.size > AGENT_CACHE_MAX) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  return { events, fromCache: false };
}

// ==================== 演示场景预热 ====================

export const DEMO_SCENARIO = `某填埋场运营 15 年，近期监测发现渗滤液水位上升 0.8m，
周边 200m 处地下水氯离子浓度从 50mg/L 升至 280mg/L，
堆体表面出现 3 条裂缝（最长 12m，宽 3cm），
甲烷浓度 35% LEL。请给出综合诊断报告。`;

/** 预热用的表单参数（与前端 MultiAgentPage 的输入框默认值一致 → 缓存键与首跑一致） */
const DEMO_PARAMS: Required<MASceneParams> = { height: 25, slopeAngle: 30, waterLevelDepth: 10 };

export async function warmAgentCache(): Promise<void> {
  const detail: DetailLevel = 'standard';   // 与前端 useDetailPref('multiagent') 的默认值一致
  const parallel = process.env.WARM_AGENT_CACHE_PARALLEL === '1';
  const domainIds = DOMAIN_SPECS.map(s => s.id);

  const warmOne = async (id: string) => {
    try {
      await getCachedAgentRun(id, DEMO_SCENARIO, DEMO_PARAMS, detail);
    } catch (e: any) {
      console.error(`[multiagent] 预热 ${id} 失败:`, e?.message);
    }
  };

  if (parallel) {
    await Promise.all(domainIds.map(warmOne));
    console.log(`[multiagent] 演示场景缓存预热完成（${domainIds.length} 个领域 Agent · 并发）`);
  } else {
    for (const id of domainIds) {
      await warmOne(id);
      console.log(`[multiagent] 预热 ${id} 完成`);
    }
    console.log(`[multiagent] 演示场景缓存预热完成（${domainIds.length} 个领域 Agent · 串行）`);
  }
}

// ==================== deep_analysis 工具执行体 ====================

export interface DeepAnalysisResult {
  scenario: string;
  agents: Array<{
    agent: string; name: string; grade: string; gradeLabel: string; result: string;
    confidence?: string; keyFinding?: string; hazards?: Hazard[]; evidence?: DomainFinding['evidence'];
    indicators?: DomainFinding['indicators']; missing?: string[];
  }>;
  crossFindings: CrossFinding[];
  overall: { grade: string; gradeLabel: string; basis: 'worst-of' | 'insufficient' };
  partial: boolean;
  fromCache: boolean;
}

/**
 * deep_analysis 入参：除场景文本外，可带结构化监测/几何数据。
 * 一律只传"确切给出"的字段——缺省由提取层按"文本提取 > 典型值估算"补齐并标注出处。
 */
export interface DeepAnalysisInput {
  scenario?: string;
  height?: number;          // → landfillHeight
  slopeAngle?: number;
  waterLevelDepth?: number; // → waterLevel
  crackLength?: number;
  crackWidth?: number;
  crackCount?: number;
  ch4?: number;             // %vol（若为 %LEL 由调用方换算）
  h2s?: number;
  settlementRate?: number;
  clConcentration?: number;
  clBackground?: number;
  landfillArea?: number;
  rainfall?: number;
  landfillAge?: number;
  temperature?: number;
}

/**
 * 深度多智能体分析：4 领域真调工具 + 总工研判（含交叉研判与敏感性）。
 * onStep：把运行事件实时转发给上层（SSE 流式）；缓存命中同样回放全部步骤。
 */
export async function runDeepAnalysis(
  raw: DeepAnalysisInput,
  ctx?: { onStep?: (step: { id: string; label: string; status?: 'running' | 'done' }) => void; sessionId?: string },
): Promise<DeepAnalysisResult> {
  const scenario = String(raw?.scenario ?? '').trim() || DEMO_SCENARIO;
  const params = normalizeParams({
    height: n(raw?.height), slopeAngle: n(raw?.slopeAngle), waterLevelDepth: n(raw?.waterLevelDepth),
  });

  // 先做一次提取以预热记忆化：否则 4 个领域并发启动时会各自触发一次 LLM 抽取
  await extractIndicators(scenario, explicitForExtraction(raw));

  // 领域批次超时：透传 AbortSignal，超时即取消未完成的 LLM 调用，
  // 不让它们继续占住 GLM 串行队列把总工请求排到后面（旧实现只 race 不取消）
  const ac = new AbortController();
  const deadline = setTimeout(() => ac.abort(), 60_000);

  const runOne = async (agent: string) => {
    const { events, fromCache } = await getCachedAgentRun(agent, scenario, params, 'standard', undefined, {
      sessionId: ctx?.sessionId,
      signal: ac.signal,
    });
    for (const ev of events) {
      if (ev.type === 'agent_step' && ev.step && ctx?.onStep) {
        ctx.onStep({
          id: `${agent}-${ev.step.id}`,
          label: `[${AGENT_NAME[agent] ?? agent}] ${ev.step.label}`,
          status: ev.step.status === 'running' ? 'running' : 'done',
        });
      }
    }
    const last = [...events].reverse().find(e => e.type === 'agent_result');
    return {
      agent,
      result: last?.result ?? '',
      grade: (last?.grade ?? 'unknown') as MAGrade,
      finding: last?.finding,
      fromCache,
    };
  };

  // 注：getCachedAgentRun 内部传 signal 给各领域 Agent，
  // 超时后 abort 会让排队中/进行中的 llmComplete 立即返回 null，从而让出串行队列。
  const domainRes = await Promise.all(DOMAIN_SPECS.map(s => runOne(s.id)));
  clearTimeout(deadline);

  const peers: Record<string, MAPeerResult> = {};
  const peerFindings: Record<string, DomainFinding> = {};
  for (const d of domainRes) {
    peers[d.agent] = { result: d.result, grade: d.grade };
    if (d.finding) peerFindings[d.agent] = d.finding;
  }

  let summary: { result: string; grade: MAGrade; crossFindings: CrossFinding[]; basis: 'worst-of' | 'insufficient' } | null = null;
  try {
    const { events } = await getCachedAgentRun('summary', scenario, params, 'standard', peers, {
      peerFindings,
      sessionId: ctx?.sessionId,
    });
    for (const ev of events) {
      if (ev.type === 'agent_step' && ev.step && ctx?.onStep) {
        ctx.onStep({
          id: `summary-${ev.step.id}`,
          label: `[${AGENT_NAME.summary}] ${ev.step.label}`,
          status: ev.step.status === 'running' ? 'running' : 'done',
        });
      }
    }
    const last = [...events].reverse().find(e => e.type === 'agent_result');
    if (last) {
      const g = (last.grade ?? 'unknown') as MAGrade;
      // 综合等级直接取总工事件的 grade（由 overallGrade 确定性给出），不在此处再兜底成中间等级；
      // unknown 即"各领域均无实测数据"，对应 basis=insufficient
      summary = {
        result: last.result ?? '', grade: g,
        crossFindings: last.crossFindings ?? [],
        basis: g === 'unknown' ? 'insufficient' : 'worst-of',
      };
    }
  } catch { /* 总工失败：overall 落 unknown，不伪装成中间等级 */ }

  const agents = [
    ...domainRes.map(d => ({
      agent: d.agent,
      name: AGENT_NAME[d.agent] ?? d.agent,
      grade: d.grade,
      gradeLabel: GRADE_LABEL[d.grade] ?? d.grade,
      result: d.result,
      confidence: d.finding?.confidence,
      keyFinding: d.finding?.keyFinding,
      hazards: d.finding?.hazards,
      evidence: d.finding?.evidence,
      indicators: d.finding?.indicators,
      missing: d.finding?.missing,
    })),
    ...(summary ? [{
      agent: 'summary',
      name: AGENT_NAME.summary,
      grade: summary.grade,
      gradeLabel: GRADE_LABEL[summary.grade] ?? summary.grade,
      result: summary.result,
      keyFinding: summary.crossFindings.length ? `命中 ${summary.crossFindings.length} 条复合风险规则` : undefined,
    }] : []),
  ];

  const overallGradeValue: MAGrade = summary?.grade ?? 'unknown';
  // 覆盖度：有产出的领域数（旧实现用 agents.length 与领域数比较，summary 会被错误计入）
  const domainProduced = domainRes.filter(d => d.result).length;
  return {
    scenario,
    agents,
    crossFindings: summary?.crossFindings ?? [],
    overall: { grade: overallGradeValue, gradeLabel: GRADE_LABEL[overallGradeValue], basis: summary?.basis ?? 'insufficient' },
    partial: domainProduced < DOMAIN_SPECS.length,
    // 空数组 .every() 恒真 → 旧实现在全部失败时报"命中缓存"，此处显式判空
    fromCache: domainRes.length > 0 && domainRes.every(d => d.fromCache),
  };
}

export default {
  runAgent, getCachedAgentRun, extractSceneParams, normalizeParams, buildDomainCtx,
  runDeepAnalysis, sensitivityScan, DEMO_SCENARIO, warmAgentCache, agentCache,
};
