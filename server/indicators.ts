/**
 * indicators.ts — 指标提取层（多智能体重构·地基）
 *
 * 职责：把「自由文本场景 + 表单显式参数 + LLM 抽取兜底」统一成带**出处**的结构化指标集，
 * 供 diagnose.evaluateHazards 判定隐患、供 domains.ts 驱动工具调用。
 *
 * ── 分级原则（本模块的核心约定，勿破坏）─────────────────────────
 * 监测指标（MEASURED_FIELDS）与材料/设计参数（MATERIAL_FIELDS）区别对待：
 *
 *   监测指标：裂缝 / CH₄ / Cl⁻ / 水位 / 沉降 / Fs ……
 *     缺测就是缺测，**绝不用默认值补**。缺了 → 进 missing[]，对应隐患不产生、
 *     该维度等级随其余实测项走。这样才能保证"删掉场景里那句裂缝描述 → 卡片真的会变"。
 *
 *   材料/设计参数：γ / c / φ / 垃圾量 / 迁移距离 / 弥散系数 ……
 *     这类参数工程上有公认典型值，缺测时用典型值补齐并标 ESTIMATED，
 *     保证工具链仍可运行，同时在 UI 上明示"本项为估算值"。
 *
 * 出处三档：USER_DEFINED（表单显式）> FROM_TEXT（文本/LLM 提取）> ESTIMATED（典型值补齐）
 *
 * ── 单位归一化（本项目历史踩坑点）───────────────────────────────
 * 甲烷：SiteData.ch4 是**体积浓度 %vol**，而现场口语/监测仪常用 **%LEL**。
 *       100% LEL ≈ 5% vol → %vol = %LEL / 20。DEMO 场景的「35% LEL」= 1.75% vol。
 *       本模块统一归一化到 %vol，并把换算过程写进 note，禁止两者混用。
 * 面积：支持 ㎡ / 万㎡ / 公顷 / 亩；裂缝宽度支持 cm / mm。
 */

import { llmComplete } from './llm.js';
import type { SiteData } from './diagnose.js';

export type IndicatorOrigin = 'USER_DEFINED' | 'FROM_TEXT' | 'ESTIMATED';

export interface IndicatorValue {
  key: keyof SiteData;
  label: string;
  value: number;
  unit?: string;
  origin: IndicatorOrigin;
  /** FROM_TEXT 时保留命中的原文片段，供 UI 展示"这个数是从哪句话读出来的" */
  snippet?: string;
  /** 口径说明（单位换算 / 时间尺度假设等），有值即需在 UI 上提示 */
  note?: string;
}

export interface ExtractedIndicators {
  /** 实测 ∪ 估算（材料参数补齐后）——喂给 evaluateHazards 与工具链 */
  site: SiteData;
  /** 仅实测/用户提供，不含典型值补齐——用于统计置信度 */
  measuredSite: SiteData;
  origins: Partial<Record<keyof SiteData, IndicatorOrigin>>;
  measured: IndicatorValue[];
  estimated: IndicatorValue[];
  /** 缺测的监测指标（中文标签），用于 UI "本次缺少：…" 提示 */
  missing: string[];
  warnings: string[];
}

// ==================== 字段分类 ====================

/** 监测指标：缺测不补 */
export const MEASURED_FIELDS: Array<{ key: keyof SiteData; label: string; unit?: string }> = [
  { key: 'waterLevel', label: '渗滤液/地下水位埋深', unit: 'm' },
  { key: 'waterRiseRate', label: '水位上升速率', unit: 'm/月' },
  { key: 'leachateLevel', label: '渗滤液液位', unit: 'm' },
  { key: 'ch4', label: '甲烷浓度', unit: '%vol' },
  { key: 'h2s', label: 'H2S 浓度', unit: 'mg/m³' },
  { key: 'nh3', label: 'NH₃ 浓度', unit: 'mg/m³' },
  { key: 'settlementRate', label: '沉降速率', unit: 'mm/月' },
  { key: 'stabilityFactor', label: '稳定安全系数 Fs', unit: '—' },
  { key: 'crackLength', label: '最长裂缝长度', unit: 'm' },
  { key: 'crackWidth', label: '裂缝宽度', unit: 'cm' },
  { key: 'crackCount', label: '裂缝条数', unit: '条' },
  { key: 'clConcentration', label: 'Cl⁻ 实测浓度', unit: 'mg/L' },
  { key: 'clBackground', label: 'Cl⁻ 背景浓度', unit: 'mg/L' },
  { key: 'gwVelocity', label: '地下水流速', unit: 'm/d' },
  { key: 'temperature', label: '堆体温度', unit: '℃' },
  { key: 'landfillHeight', label: '堆体高度', unit: 'm' },
  { key: 'landfillLength', label: '填埋体长', unit: 'm' },
  { key: 'landfillWidth', label: '填埋体宽', unit: 'm' },
  { key: 'landfillArea', label: '填埋面积', unit: 'm²' },
  { key: 'landfillAge', label: '填埋龄期', unit: '年' },
  { key: 'rainfall', label: '年降雨量', unit: 'mm' },
  { key: 'slopeAngle', label: '坡角', unit: '°' },
  { key: 'nearbyBuildingDistance', label: '周边建筑距离', unit: 'm' },
];

/**
 * 材料/设计参数：缺测时用工程典型值补齐（标 ESTIMATED）。
 * `why` 会进 note，让用户知道这个数是怎么来的。
 */
export const MATERIAL_FIELDS: Array<{ key: keyof SiteData; label: string; unit?: string; typical: number; why: string }> = [
  { key: 'slopeGamma', label: '垃圾重度 γ', unit: 'kN/m³', typical: 11, why: '国内填埋场垃圾重度典型值 10~12 kN/m³' },
  { key: 'slopeC', label: '黏聚力 c', unit: 'kPa', typical: 15, why: '垃圾体黏聚力典型值 10~20 kPa' },
  { key: 'slopePhi', label: '内摩擦角 φ', unit: '°', typical: 35, why: '垃圾体内摩擦角典型值 30~40°' },
];

/** 甲烷换算：100% LEL ≈ 5% vol */
const LEL_TO_VOL = 5 / 100;

// ==================== 正则提取规格 ====================

interface GrabSpec {
  key: keyof SiteData;
  label: string;
  unit?: string;
  /** 依次尝试，命中即止；group1 = 数值，group2 = 可选单位 */
  patterns: RegExp[];
  /** 单位归一化：接收数值与命中的单位，返回 { value, unit, note } */
  normalize?: (n: number, unit: string) => { value: number; unit?: string; note?: string };
}

const GRAB_SPECS: GrabSpec[] = [
  // ---- 裂缝（三条独立规格：长度 / 宽度 / 条数）----
  {
    key: 'crackLength', label: '最长裂缝长度', unit: 'm',
    patterns: [
      /(?:最长|最大)\s*(?:裂缝)?\s*[:：]?\s*([\d.]+)\s*(m|米)/,
      /裂缝[^\d]{0,12}?([\d.]+)\s*(m|米)/,
    ],
  },
  {
    key: 'crackWidth', label: '裂缝宽度', unit: 'cm',
    patterns: [
      /(?:缝宽|宽度|宽)\s*[:：]?\s*([\d.]+)\s*(mm|毫米|cm|厘米)/,
      /裂缝[^\d]{0,16}?宽\s*([\d.]+)\s*(mm|毫米|cm|厘米)/,
    ],
    normalize: (n, unit) => /mm|毫米/.test(unit)
      ? { value: n / 10, unit: 'cm', note: `${n} mm 换算为 ${(n / 10).toFixed(2)} cm` }
      : { value: n, unit: 'cm' },
  },
  {
    key: 'crackCount', label: '裂缝条数', unit: '条',
    patterns: [
      /([\d.]+)\s*条\s*(?:裂缝|裂纹)/,
      /(?:裂缝|裂纹)\s*([\d.]+)\s*条/,
    ],
  },

  // ---- 甲烷：显式 %vol → 显式 %LEL → 裸数字（按 %LEL 计并注明）----
  {
    key: 'ch4', label: '甲烷浓度', unit: '%vol',
    patterns: [/甲烷[^\d]{0,10}?([\d.]+)\s*%\s*(?:vol|Vol|VOL|体积)/],
    normalize: (n) => ({ value: n, unit: '%vol' }),
  },
  {
    key: 'ch4', label: '甲烷浓度', unit: '%vol',
    patterns: [/甲烷[^\d]{0,10}?([\d.]+)\s*%\s*(?:LEL|lel)/],
    normalize: (n) => ({
      value: Math.round(n * LEL_TO_VOL * 100) / 100,
      unit: '%vol',
      note: `${n}% LEL → ${Math.round(n * LEL_TO_VOL * 100) / 100}% vol（100% LEL ≈ 5% vol）`,
    }),
  },
  {
    key: 'ch4', label: '甲烷浓度', unit: '%vol',
    patterns: [/甲烷[^\d]{0,10}?([\d.]+)\s*(?:%|)/],
    normalize: (n) => ({
      value: Math.round(n * LEL_TO_VOL * 100) / 100,
      unit: '%vol',
      note: `原文未注明 %vol/%LEL，按现场惯例以 %LEL 计：${n}% LEL → ${Math.round(n * LEL_TO_VOL * 100) / 100}% vol`,
    }),
  },

  // ---- 水位与渗滤液 ----
  {
    key: 'waterRiseRate', label: '水位上升速率', unit: 'm/月',
    patterns: [
      /水位[^\d]{0,10}?上升\s*([\d.]+)\s*(?:m|米)\s*[/／]\s*(?:月|mon|month)/,
      /水位[^\d]{0,10}?上升\s*([\d.]+)\s*(?:m|米)/,
    ],
    normalize: (n) => ({ value: n, unit: 'm/月' }),
  },
  {
    key: 'waterLevel', label: '水位埋深', unit: 'm',
    patterns: [/水位埋深\s*[:：]?\s*([\d.]+)\s*(m|米)/],
  },
  {
    key: 'leachateLevel', label: '渗滤液液位', unit: 'm',
    patterns: [/渗滤液液位\s*[:：]?\s*([\d.]+)\s*(m|米)/],
  },

  // ---- 地下水 Cl⁻ ----
  {
    key: 'clBackground', label: 'Cl⁻ 背景浓度', unit: 'mg/L',
    patterns: [
      /(?:背景|本底)[^\d]{0,6}?([\d.]+)\s*(mg\/L|mg\/l)/,
      /从\s*([\d.]+)\s*(mg\/L|mg\/l)/,
    ],
  },
  {
    key: 'clConcentration', label: 'Cl⁻ 实测浓度', unit: 'mg/L',
    patterns: [
      /(?:升至|升到|升高至|上升至|达到|实测)\s*([\d.]+)\s*(mg\/L|mg\/l)/,
      /氯离子[^\d]{0,16}?([\d.]+)\s*(mg\/L|mg\/l)/,
      /Cl⁻?[^\d]{0,12}?([\d.]+)\s*(mg\/L|mg\/l)/i,
    ],
  },
  {
    key: 'gwVelocity', label: '地下水流速', unit: 'm/d',
    patterns: [/(?:地下水流速|流速)\s*[:：]?\s*([\d.]+)\s*(m\/d|m\/天)/],
  },

  // ---- 其他监测项 ----
  {
    key: 'h2s', label: 'H2S 浓度', unit: 'mg/m³',
    patterns: [/(?:H2S|h2s|硫化氢)[^\d]{0,10}?([\d.]+)\s*(mg\/m³|mg\/m3|mg\/m\^3)/],
  },
  {
    key: 'nh3', label: 'NH₃ 浓度', unit: 'mg/m³',
    patterns: [/(?:NH3|nh3|氨气)[^\d]{0,10}?([\d.]+)\s*(mg\/m³|mg\/m3)/],
  },
  {
    key: 'settlementRate', label: '沉降速率', unit: 'mm/月',
    patterns: [/(?:沉降速率|沉降)\s*[:：]?\s*([\d.]+)\s*(mm|毫米)\s*[/／]\s*(?:月|mon)/],
  },
  {
    key: 'stabilityFactor', label: '稳定安全系数 Fs', unit: '—',
    patterns: [/(?:Fs|安全系数|稳定系数)\s*[:：=＝]?\s*([\d.]+)/],
  },
  {
    key: 'temperature', label: '堆体温度', unit: '℃',
    patterns: [/(?:温度|堆体温度)\s*[:：]?\s*([\d.]+)\s*(?:℃|°C|度)/],
  },

  // ---- 几何 / 规模 ----
  {
    key: 'landfillHeight', label: '堆体高度', unit: 'm',
    patterns: [
      /堆体(?:高|高度)\s*[:：]?\s*([\d.]+)\s*(m|米)/,
      /堆高\s*[:：]?\s*([\d.]+)\s*(m|米)/,
      /填埋(?:体)?高\s*[:：]?\s*([\d.]+)\s*(m|米)/,
    ],
  },
  {
    key: 'slopeAngle', label: '坡角', unit: '°',
    patterns: [/坡角\s*[:：]?\s*([\d.]+)\s*(?:°|度)/],
  },
  {
    key: 'landfillArea', label: '填埋面积', unit: 'm²',
    patterns: [/(?:填埋面积|占地面积|面积|占地)\s*[:：]?\s*([\d.]+)\s*(万㎡|万m²|万平方米|公顷|ha|亩|㎡|m²|平方米)/],
    normalize: (n, unit) => {
      if (/万/.test(unit)) return { value: n * 10000, unit: 'm²', note: `${n} 万㎡ = ${n * 10000} m²` };
      if (/公顷|ha/.test(unit)) return { value: n * 10000, unit: 'm²', note: `${n} 公顷 = ${n * 10000} m²` };
      if (/亩/.test(unit)) return { value: Math.round(n * 666.67), unit: 'm²', note: `${n} 亩 ≈ ${Math.round(n * 666.67)} m²` };
      return { value: n, unit: 'm²' };
    },
  },
  {
    key: 'landfillAge', label: '填埋龄期', unit: '年',
    patterns: [
      /(?:运营|已运营|填埋龄期|龄期)\s*[:：]?\s*([\d.]+)\s*(?:年|a|a年)/,
      /(?:填埋)\s*([\d.]+)\s*年/,
    ],
  },
  {
    key: 'rainfall', label: '年降雨量', unit: 'mm',
    patterns: [/(?:年降雨量|降雨量|年均降雨)\s*[:：]?\s*([\d.]+)\s*(mm|毫米)/],
  },
  {
    key: 'nearbyBuildingDistance', label: '周边建筑距离', unit: 'm',
    patterns: [/(?:周边建筑距离|距周边建筑|建筑距离)\s*[:：]?\s*([\d.]+)\s*(m|米)/],
  },
];

/** 坡比 1:n → 坡角（度）：单列，因为换算方向与其它规格相反 */
const SLOPE_RATIO_RE = /(?:坡比|坡度|边坡)\s*[:：]?\s*1\s*[:：]\s*([\d.]+)/;

// ==================== 文本提取 ====================

interface RawHit { key: keyof SiteData; label: string; unit?: string; value: number; snippet: string; note?: string }

function grabFromText(text: string): RawHit[] {
  const hits: RawHit[] = [];
  const taken = new Set<keyof SiteData>();
  for (const spec of GRAB_SPECS) {
    if (taken.has(spec.key)) continue;
    for (const re of spec.patterns) {
      const m = text.match(re);
      if (!m) continue;
      const n = parseFloat(m[1]);
      if (!Number.isFinite(n)) continue;
      const rawUnit = (m[2] ?? '').trim();
      const norm = spec.normalize ? spec.normalize(n, rawUnit) : { value: n, unit: spec.unit };
      hits.push({
        key: spec.key,
        label: spec.label,
        unit: norm.unit ?? spec.unit,
        value: norm.value,
        snippet: m[0].replace(/\s+/g, ' ').trim().slice(0, 60),
        note: norm.note ?? (spec.key === 'waterRiseRate' && !/[/／]\s*(?:月|mon)/.test(m[0])
          ? '原文未注明时间尺度，按 m/月 计'
          : undefined),
      });
      taken.add(spec.key);
      break;
    }
  }
  // 坡比 → 坡角（若尚未从"坡角 x°"取到）
  if (!taken.has('slopeAngle')) {
    const m = text.match(SLOPE_RATIO_RE);
    if (m) {
      const ratio = parseFloat(m[1]);
      if (Number.isFinite(ratio) && ratio > 0) {
        const deg = Math.round(Math.atan(1 / ratio) * 180 / Math.PI * 10) / 10;
        hits.push({
          key: 'slopeAngle', label: '坡角', unit: '°', value: deg,
          snippet: m[0].trim(), note: `坡比 1:${ratio} 换算为坡角 ${deg}°`,
        });
      }
    }
  }
  return hits;
}

// ==================== LLM 抽取兜底 ====================

const LLM_FIELDS = [...MEASURED_FIELDS, ...MATERIAL_FIELDS.map(f => ({ key: f.key, label: f.label, unit: f.unit }))];

async function grabFromLLM(text: string): Promise<RawHit[]> {
  const fieldList = LLM_FIELDS.map(f => `${f.key}(${f.label}${f.unit ? ' ' + f.unit : ''})`).join('、');
  try {
    const ai = await llmComplete([
      { role: 'system', content: '你是工程参数抽取器。只输出一个 JSON 对象，不要解释、不要 Markdown 代码块。未提到的字段一律不要出现在 JSON 里，禁止猜测填充。' },
      {
        role: 'user',
        content:
          `从下面的填埋场诊断场景中抽取**明确提到**的指标，输出 JSON。\n` +
          `可抽取字段：${fieldList}\n\n` +
          `规则：\n` +
          `1) 只输出场景里真实出现的数值，没提到就不要输出该字段（不要填默认值）\n` +
          `2) 甲烷若写 %LEL，请换算成 %vol 后输出到 ch4（100% LEL ≈ 5% vol）\n` +
          `3) 面积统一为 m²，裂缝宽度统一为 cm\n` +
          `4) 坡比（如 1:3）请换算成坡角（度）输出到 slopeAngle\n\n` +
          `场景：\n${text}\n\n` +
          `输出格式示例：{"crackLength": 12, "crackWidth": 3, "ch4": 1.75}`,
      },
    ], { maxTokens: 600, timeoutMs: 15000, retries: 1, temperature: 0 });
    if (!ai) return [];
    const m = ai.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const obj = JSON.parse(m[0]) as Record<string, unknown>;
    const out: RawHit[] = [];
    for (const f of LLM_FIELDS) {
      const v = obj[f.key as string];
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (!Number.isFinite(n)) continue;
      out.push({ key: f.key, label: f.label, unit: f.unit, value: n, snippet: '（AI 抽取）' });
    }
    return out;
  } catch {
    return [];  // 抽取失败不阻塞，缺测即缺测
  }
}

// ==================== 组装 ====================

const LABEL_OF = new Map<keyof SiteData, { label: string; unit?: string }>([
  ...MEASURED_FIELDS.map(f => [f.key, { label: f.label, unit: f.unit }] as const),
  ...MATERIAL_FIELDS.map(f => [f.key, { label: f.label, unit: f.unit }] as const),
]);

/** 表单显式参数：SiteData 字段直接同名传入；height / waterLevelDepth 为表单别名 */
export interface ExplicitParams extends Partial<SiteData> {
  height?: number;           // → landfillHeight
  waterLevelDepth?: number;  // → waterLevel
}

/**
 * 提取结果记忆化。
 * /api/multiagent 是 5 个并发请求（4 领域 + 总工），各自都会走一遍提取；
 * 场景文本很长、正则命中不足时 LLM 抽取会被重复触发，白烧配额。
 * 提取是 scenario+explicit 的纯函数，缓存安全。
 */
const EXTRACT_MEMO_MAX = 50;
const extractMemo = new Map<string, ExtractedIndicators>();

/**
 * 提取指标。优先级：显式表单 > 文本正则 > LLM 抽取；材料参数最后用典型值补齐。
 * 永不抛错——抽取失败等价于"该指标缺测"。
 */
export async function extractIndicators(
  scenario: string,
  explicit?: ExplicitParams | null,
): Promise<ExtractedIndicators> {
  const key = `${String(scenario ?? '')} ${JSON.stringify(explicit ?? null)}`;
  const hit = extractMemo.get(key);
  if (hit) {
    extractMemo.delete(key);      // LRU touch
    extractMemo.set(key, hit);
    return hit;
  }
  const out = await extractIndicatorsUncached(scenario, explicit);
  extractMemo.set(key, out);
  if (extractMemo.size > EXTRACT_MEMO_MAX) {
    const oldest = extractMemo.keys().next().value;
    if (oldest !== undefined) extractMemo.delete(oldest);
  }
  return out;
}

/** 清空提取缓存（演示现场换场景时可用） */
export function clearIndicatorMemo(): number {
  const size = extractMemo.size;
  extractMemo.clear();
  return size;
}

async function extractIndicatorsUncached(
  scenario: string,
  explicit?: ExplicitParams | null,
): Promise<ExtractedIndicators> {
  const text = String(scenario ?? '');
  const warnings: string[] = [];
  const origins: Partial<Record<keyof SiteData, IndicatorOrigin>> = {};
  const measured: IndicatorValue[] = [];
  const measuredSite: SiteData = {};

  const put = (key: keyof SiteData, value: number, origin: IndicatorOrigin, label: string, unit?: string, snippet?: string, note?: string) => {
    if (!Number.isFinite(value)) return;
    (measuredSite as Record<string, unknown>)[key] = value;
    origins[key] = origin;
    measured.push({ key, label, value, unit, origin, snippet, note });
  };

  // ① 显式表单参数
  //    表单的「堆体高度 / 水位埋深」不是 SiteData 字段名，需映射；slopeAngle 同名直接落。
  const FORM_ALIAS: Array<[string, keyof SiteData]> = [
    ['height', 'landfillHeight'],
    ['waterLevelDepth', 'waterLevel'],
  ];
  if (explicit) {
    const ex = explicit as Record<string, unknown>;
    for (const [formKey, siteKey] of FORM_ALIAS) {
      const v = ex[formKey];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const meta = LABEL_OF.get(siteKey);
      put(siteKey, v, 'USER_DEFINED', meta?.label ?? String(siteKey), meta?.unit);
    }
    for (const [k, v] of Object.entries(ex)) {
      const key = k as keyof SiteData;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (FORM_ALIAS.some(([fk]) => fk === k)) continue;   // 别名已处理
      if (!LABEL_OF.has(key)) continue;                    // 非 SiteData 字段，忽略
      const meta = LABEL_OF.get(key);
      put(key, v, 'USER_DEFINED', meta?.label ?? String(key), meta?.unit);
    }
  }

  // ② 文本正则（快路径）
  for (const hit of grabFromText(text)) {
    if (origins[hit.key] !== undefined) continue;   // 表单显式优先
    put(hit.key, hit.value, 'FROM_TEXT', hit.label, hit.unit, hit.snippet, hit.note);
  }

  // ③ LLM 抽取兜底：仅当监测指标命中不足时启用（省配额，正则能覆盖的场景不烧模型）
  const measuredKeys = new Set(measured.map(m => m.key));
  const criticalKeys: (keyof SiteData)[] = ['ch4', 'clConcentration', 'waterRiseRate', 'crackLength', 'settlementRate', 'h2s'];
  const hitCritical = criticalKeys.filter(k => measuredKeys.has(k)).length;
  if (text.trim() && hitCritical < 2) {
    const before = measured.length;
    for (const hit of await grabFromLLM(text)) {
      if (origins[hit.key] !== undefined) continue;
      put(hit.key, hit.value, 'FROM_TEXT', hit.label, hit.unit, hit.snippet, hit.note);
    }
    if (measured.length === before) {
      warnings.push('AI 抽取未补充到新指标（文本中可能确实未包含可识别数值）');
    }
  }

  // ④ 材料/设计参数典型值补齐（只补材料参数，绝不补监测指标）
  const estimated: IndicatorValue[] = [];
  const site: SiteData = { ...measuredSite };
  const missing: string[] = [];
  for (const f of MATERIAL_FIELDS) {
    if (typeof (site as Record<string, unknown>)[f.key] === 'number') continue;
    (site as Record<string, unknown>)[f.key] = f.typical;
    origins[f.key] = 'ESTIMATED';
    estimated.push({
      key: f.key, label: f.label, unit: f.unit,
      value: f.typical, origin: 'ESTIMATED',
      note: f.why,
    });
  }
  // 缺测的监测指标（不含"可选"的抽注井类字段）
  for (const f of MEASURED_FIELDS) {
    if (typeof (measuredSite as Record<string, unknown>)[f.key] !== 'number') missing.push(f.label);
  }

  return { site, measuredSite, origins, measured, estimated, missing, warnings };
}

// ==================== 置信度 ====================

/**
 * 领域置信度：
 *   measured     —— 该领域关心的指标全部实测
 *   estimated    —— 部分实测、部分缺测
 *   insufficient —— 一个实测都没有（该领域结论仅供参考）
 */
export function confidenceOf(
  fields: Array<keyof SiteData>,
  measuredKeys: Set<keyof SiteData>,
): 'measured' | 'estimated' | 'insufficient' {
  const hit = fields.filter(f => measuredKeys.has(f)).length;
  if (hit === 0) return 'insufficient';
  if (hit === fields.length) return 'measured';
  return 'estimated';
}

export const CONFIDENCE_LABEL: Record<'measured' | 'estimated' | 'insufficient', string> = {
  measured: '全部实测',
  estimated: '含估算值',
  insufficient: '数据不足',
};

export default { extractIndicators, clearIndicatorMemo, confidenceOf, MEASURED_FIELDS, MATERIAL_FIELDS, CONFIDENCE_LABEL };
