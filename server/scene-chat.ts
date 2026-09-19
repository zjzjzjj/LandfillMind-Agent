/**
 * scene-chat.ts — 3D 仿真器内嵌 AI 助手（建模 + 计算 + OGS 联动）
 *
 * 输入：用户自然语言 + 当前 GeoParams
 * 输出：结构化变更（新 geo / 预设 / 库容快照 / OGS 摘要+时序 / 计算器结果 / 自然语言回复）
 *
 * 能力（确定性优先，保证演示零失败）：
 *  - 显式建场：建/生成/创建 一个... → buildScene(natural) 全新建模（DEFAULT_GEO + 解析增量）
 *  - 相对调整：把堆体调高/调低/加大/缩小 → 当前值 ± 步进（clamp 边界内）
 *  - 绝对设定：堆体调到 1.4 / 设为 1.4 → 直接设值
 *  - 预设切换：小型场 / 大型场 / 默认 / 还原
 *  - OGS 联动：产气/沉降/降解 关键词 → runOgsScenario（返回摘要 + 完整时序供前端注入 3D）
 *  - 计算联动：边坡 Fs / 库容 / 渗滤液 / HDPE 等 关键词 → CALC_REGISTRY 执行
 *  - AI 回复：配置了 API Key 时用 llmComplete 生成自然语言；无 key / 失败自动回退模板
 */

import { clampGeo, GEO_PRESETS, estimateSite, DEFAULT_GEO } from './geo';
import type { GeoParams } from './geo';
import { hasSceneIntent, isExplicitSceneRequest, DEFAULT_NL_PARSER, buildScene } from './scene-builder.js';
import { detectOgsIntent, detectCalcIntent } from './augment.js';
import { runOgsScenario } from './ogs.js';
import type { OgsRunResult } from './ogs.js';
import { CALC_REGISTRY } from './routes/calc.js';
import { llmComplete } from './llm.js';

// ---------------- 字段映射（中文调整词 → GeoParams） ----------------
const FIELD_MAP: { re: RegExp; key: keyof GeoParams; label: string; step: number; isCount?: boolean }[] = [
  { re: /(堆体|堆高|堆填|垃圾堆|垃圾体|垃圾山)/, key: 'pileHeight', label: '堆体最大高度', step: 0.15 },
  { re: /(谷宽|谷底|山谷宽|山谷)/, key: 'valleyWidth', label: '谷底宽度', step: 0.15 },
  { re: /(垃圾坝|坝高|拦坝)/, key: 'damHeight', label: '垃圾坝高', step: 0.15 },
  { re: /(井距|导气井间距|气井间距)/, key: 'gasWellSpacing', label: '导气井间距', step: 0.15 },
  { re: /(调节池|渗滤液池|水池|池容)/, key: 'pondVolume', label: '调节池容积', step: 0.2 },
  { re: /(植被|树|绿化)/, key: 'treeDensity', label: '植被密度', step: 0.15 },
  { re: /(作业车辆|车辆数|车)/, key: 'vehicleCount', label: '作业车辆', step: 1, isCount: true },
  { re: /(库容|规模|容量)/, key: 'volumeScale', label: '库容规模', step: 0.2 },
];

function detectAdjustment(text: string): { field: typeof FIELD_MAP[number]; op: 'up' | 'down' | 'set'; value?: number } | null {
  const field = FIELD_MAP.find(f => f.re.test(text));
  if (!field) return null;
  // 绝对设定：调到/设为/设置成/改成/调成 + 数字（可选 ×倍）
  const setNum = text.match(/(?:调到|设为|设置成|改成|调成|设成)\s*([\d.]+)/) || text.match(/(?:调到|设为|设成)\s*([\d.]+)\s*[x倍×]/);
  if (setNum) {
    const v = parseFloat(setNum[1]);
    if (Number.isFinite(v)) return { field, op: 'set', value: v };
  }
  const up = /(调高|加大|放大|扩大|增高|增加|提高|提升|更高|更大|加高|加宽|加长|升高|多一点|大一点)/.test(text);
  const down = /(调低|减小|缩小|收窄|变窄|降低|放小|更小|更矮|减少|变小|压低|调矮|矮一点|小一点|小一点)/.test(text);
  if (up) return { field, op: 'up' };
  if (down) return { field, op: 'down' };
  return null;
}

function detectPreset(text: string): 'small' | 'large' | 'default' | null {
  if (/(小型场|小型填埋|小规模)/.test(text)) return 'small';
  if (/(大型场|大型填埋|大规模)/.test(text)) return 'large';
  if (/(默认|还原|重置|恢复初始|回到默认)/.test(text)) return 'default';
  return null;
}

function applyAdjustment(geo: GeoParams, adj: NonNullable<ReturnType<typeof detectAdjustment>>): GeoParams {
  const cur = geo[adj.field.key];
  let next: number;
  if (adj.op === 'set') next = adj.value!;
  else next = adj.op === 'up' ? cur + adj.field.step : cur - adj.field.step;
  if (adj.field.isCount) next = Math.round(next);
  return clampGeo({ ...geo, [adj.field.key]: next });
}

/** 从 OGS 时序抽速率日峰（位移类取绝对值最大沉降） */
function summarizeOgs(r: OgsRunResult): { scenario: string; scenarioName?: string; peakValue: number; unit: string } | null {
  const nameAndUnit = (s: { name?: string; varName?: string; unit?: string }) => `${s.name ?? ''} ${s.varName ?? ''} ${s.unit ?? ''}`;
  const rateSeries = r.timeSeries.find(s => /rate|速率|日峰/i.test(nameAndUnit(s))) ?? null;
  const series = rateSeries ?? r.timeSeries[0];
  const values = (series.points ?? []).map(p => p.v);
  if (!values.length) return null;
  const peak = values.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
  return { scenario: r.scenario, scenarioName: r.scenarioName, peakValue: peak, unit: series.unit ?? '' };
}

export interface SceneChatResult {
  ok: boolean;
  reply: string;
  geo?: GeoParams;
  preset?: string;
  snapshot?: ReturnType<typeof estimateSite>;
  ogSummary?: { scenario: string; scenarioName?: string; peakValue: number; unit: string };
  ogTimeSeries?: OgsRunResult['timeSeries'];
  calc?: { name: string; value?: unknown; unit?: string; grade?: string; analysis?: string; ref?: string; error?: string };
  changed: string[];
}

/** 仿真器内宽松建场判定：建/生成/创建/新建/搭 + (≤30 字) 场景名词 → 全新建模 */
function isBuildRequest(text: string): boolean {
  return /(建|生成|创建|新建|搭|做一个|重新建|再来一个|设计).{0,30}(填埋场|场地|场景|模型|沙盘|仿真|3d|三维)/i.test(text);
}

/** 计算/模拟显式意图词（用于区分"纯调整"与"要算"） */
const HAS_CALC_VERB = /算|计算|评估|验算|分析|检查|核算/;
const HAS_SIM_VERB = /模拟|仿真|数值|OGS|有限元/;

/** OGS 场景与计算器同名域重叠：产气→LandGEM / 沉降→双曲线 / 降解→衰减 */
const OGS_CALC_OVERLAP: Record<string, string> = {
  'gas-production': 'lfgYield',
  settlement: 'settlementHyper',
  degradation: 'decayCalc',
};

export async function handleSceneChat(message: string, currentGeo?: Partial<GeoParams>): Promise<SceneChatResult> {
  const text = (message ?? '').trim();
  const changed: string[] = [];
  let geo: GeoParams | undefined;
  let preset: string | undefined;
  let snapshot: ReturnType<typeof estimateSite> | undefined;
  let ogSummary: SceneChatResult['ogSummary'];
  let ogTimeSeries: OgsRunResult['timeSeries'] | undefined;
  let calc: SceneChatResult['calc'];

  // ================= 1) 场景变更 =================
  if (isBuildRequest(text)) {
    // 显式建场 → 全新建模（DEFAULT_GEO + 自然语言解析增量）
    const built = await buildScene({ intent: { kind: 'natural', text } }, {});
    geo = built.geo; preset = built.preset; snapshot = built.snapshot;
    changed.push(`重新建模（${built.snapshot.desc.split('\n')[1] ?? ''}）`);
  } else {
    const adj = detectAdjustment(text);
    const presetKey = detectPreset(text);
    if (adj) {
      const base = currentGeo ? clampGeo({ ...DEFAULT_GEO, ...currentGeo }) : { ...DEFAULT_GEO };
      const before = base[adj.field.key];
      geo = applyAdjustment(base, adj);
      const after = geo[adj.field.key];
      changed.push(adj.field.isCount
        ? `${adj.field.label}：${before} → ${after} 台`
        : `${adj.field.label}：${before.toFixed(2)}× → ${after.toFixed(2)}×`);
    } else if (presetKey) {
      const p = GEO_PRESETS.find(x => x.key === presetKey)!;
      geo = clampGeo({ ...DEFAULT_GEO, ...p.geo });
      preset = presetKey;
      changed.push(`切换到「${p.label}」`);
    } else if (hasSceneIntent(text)) {
      const partial = DEFAULT_NL_PARSER(text);
      if (Object.keys(partial).length) {
        const base = currentGeo ? clampGeo({ ...DEFAULT_GEO, ...currentGeo }) : { ...DEFAULT_GEO };
        geo = clampGeo({ ...base, ...partial });
        changed.push('已按描述调整模型参数');
      }
    }
  }
  if (geo) snapshot = snapshot ?? estimateSite(geo);

  // 纯 3D 调整（无"算/模拟"显式词）→ 只调模型，不触发计算/OGS
  const pureAdjustment = !!geo && !HAS_CALC_VERB.test(text) && !HAS_SIM_VERB.test(text);

  // ================= 2) OGS 联动 =================
  const ogsIntent = pureAdjustment ? null : detectOgsIntent(text);
  if (ogsIntent) {
    try {
      const r = await runOgsScenario(ogsIntent.scenario, ogsIntent.params);
      if (r.ok) {
        ogTimeSeries = r.timeSeries;
        const sum = summarizeOgs(r);
        if (sum) ogSummary = sum;
        changed.push(`已运行 OGS「${r.scenarioName ?? ogsIntent.scenario}」数值模拟`);
      } else {
        changed.push(`OGS「${ogsIntent.scenario}」本次未能完成（${r.error ?? '未知'}）`);
      }
    } catch (e: any) {
      changed.push(`OGS 运行失败（${e?.message ?? '未知'}）`);
    }
  }

  // ================= 3) 计算联动 =================
  const calcIntent = pureAdjustment ? null : detectCalcIntent(text);
  const calcSuppressedByOgs = !!ogsIntent && !!calcIntent && OGS_CALC_OVERLAP[ogsIntent.scenario] === calcIntent.name;
  if (calcIntent && !calcSuppressedByOgs && CALC_REGISTRY[calcIntent.name]) {
    try {
      const r: any = CALC_REGISTRY[calcIntent.name](calcIntent.params);
      calc = {
        name: calcIntent.name,
        value: typeof r?.value === 'number' ? r.value : undefined,
        unit: r?.unit,
        grade: r?.grade,
        analysis: r?.analysis,
        ref: r?.ref,
      };
      changed.push(`已调用计算器「${calcIntent.name}」`);
    } catch (e: any) {
      calc = { name: calcIntent.name, error: e?.message ?? '计算失败' };
    }
  }

  // ================= 4) AI 回复（LLM 优先，模板兜底） =================
  const reply = await composeReply(text, { geo, preset, snapshot, ogSummary, calc, changed });

  return { ok: true, reply, geo, preset, snapshot, ogSummary, ogTimeSeries, calc, changed };
}

async function composeReply(
  text: string,
  ctx: { geo?: GeoParams; preset?: string; snapshot?: ReturnType<typeof estimateSite>; ogSummary?: SceneChatResult['ogSummary']; calc?: SceneChatResult['calc']; changed: string[] },
): Promise<string> {
  // ---- 模板回复（零依赖，永远可用） ----
  const parts: string[] = [];
  if (!ctx.changed.length) {
    parts.push('我暂时没有识别到需要调整的场景参数。你可以试试：');
    parts.push('· 「把堆体调高」「谷底加宽」「把垃圾坝调低到 1.2」—— 调整 3D 模型');
    parts.push('· 「建一个缓坡山谷型 500 万 m³ 的填埋场」—— 重新建模');
    parts.push('· 「算一下边坡安全系数」「模拟产气」「跑一下沉降」—— 联动计算 / OGS');
    return parts.join('\n');
  }
  parts.push('已为你完成以下操作：');
  parts.push(...ctx.changed.map(c => '· ' + c));
  if (ctx.preset && ctx.preset !== 'default') parts.push(`· 当前预设：${ctx.preset}`);
  if (ctx.snapshot) parts.push(`· 库容约 ${ctx.snapshot.volumeWanM3} 万 m³，占地约 ${ctx.snapshot.areaHm2} hm²`);
  if (ctx.ogSummary) parts.push(`· OGS 峰值：${ctx.ogSummary.peakValue} ${ctx.ogSummary.unit}（${ctx.ogSummary.scenarioName ?? ctx.ogSummary.scenario}）`);
  if (ctx.calc && ctx.calc.value !== undefined) parts.push(`· 计算 ${ctx.calc.name}：${ctx.calc.value}${ctx.calc.unit ?? ''}（${ctx.calc.grade ?? '—'}）`);

  // ---- LLM 润色（可选增强：有 API Key 且成功才替换，失败静默回退模板） ----
  try {
    const sys = [
      '你是 LandfillMind 的 3D 场地建模助手。下面给出你对用户请求已执行的确定性操作摘要，',
      '请用一句简洁自然的中文回复用户（≤80 字），确认已完成并点出最关键结果，不要复述代码或列出所有细节：',
      JSON.stringify({ user: text.slice(0, 200), done: ctx.changed, snapshot: ctx.snapshot, ogSummary: ctx.ogSummary, calc: ctx.calc }),
    ].join('\n');
    const llm = await llmComplete([
      { role: 'system', content: sys },
      { role: 'user', content: text.slice(0, 300) },
    ], { maxTokens: 120, timeoutMs: 15000, retries: 1, temperature: 0.4 });
    if (llm && llm.trim()) return llm.trim();
  } catch { /* 回退模板 */ }
  return parts.join('\n');
}

export default { handleSceneChat };
