/**
 * scene-builder.ts — AI 生成 3D 场景：意图 → GeoParams 桥接
 *
 * 输入：自然语言 / preset key / GeoParams 子集 / OGS 联动开关
 * 输出：BuiltScene（{ geo, preset, snapshot, ogSummary?, ts }）
 * 行为：永远 clampGeo（绝不越界）、OGS 失败不抛错（ogSummary 留空）、非场景语返回空对象（不误触发）
 *
 * 设计原则：
 *  1) 与 three.js 完全解耦（仅依赖 geo.ts 的纯函数 + OGS 计算）
 *  2) 兼容通道（GLM/OpenRouter）没有真 function calling：走 DEFAULT_NL_PARSER 确定性规则，
 *     CodeBuddy SDK 通道则由 LLM 产出结构化 intent → 同一 buildScene 落点
 *  3) 规则解析失败（bogus 文本）→ 返回空对象，调用方据此判定"无场景意图"或走默认场景 clamp，不阻塞对话
 */

import {
  clampGeo, GEO_PRESETS, estimateSite, DEFAULT_GEO,
  type GeoParams,
} from './geo';

// ============ 输入 / 输出类型（与 prompts.ts / index.ts 工具声明一致） ============

export type SceneIntent =
  | { kind: 'preset'; key: 'small' | 'large' | 'default' }
  | { kind: 'custom'; geo: Partial<GeoParams> }
  | { kind: 'natural'; text: string };

export interface BuildSceneInput {
  intent: SceneIntent;
  /** 联动：是否同步跑稳定化计算（产气 / 沉降 / 降解）并注入 3D 场景 */
  injectOgs?: boolean;
  ogsScenario?: 'gas-production' | 'settlement' | 'degradation';
}

export interface BuiltScene {
  geo: GeoParams;
  preset: string;
  snapshot: ReturnType<typeof estimateSite>;
  ogSummary?: {
    scenario: string;
    peakValue: number;
    unit: string;
  };
  intentEcho: SceneIntent;
  ts: number;
}

export type NaturalLanguageParser = (text: string) => Partial<GeoParams>;
export type OgsRunner = (scenario: string) => Promise<{ peakValue: number; unit: string } | null>;

// ============ 场景意图判定 ============

/**
 * 保守判定用户是否在表达"建 / 改 3D 场景"意图。
 * 兼容通道无真 function calling，只能用这条规则决定要不要推 scene 卡片，
 * 避免普通知识问答（"填埋场渗滤液怎么处理"）被误触发。
 */
/**
 * 高置信"显式建场请求"：建场动词 + 场景名词同现。
 * 即使规则解析零命中（如"生成一个3D场景"），也应放行默认场景（评审 HIGH 修复）。
 */
export function isExplicitSceneRequest(text: string): boolean {
  const t = text.toLowerCase();
  return /(建|生成|创建|做出|搭|做一个|来个|给我|新建|设计).{0,10}(3[df]|三维|场景|场地|填埋场|模型|立体|仿真|沙盘)/.test(t);
}

/**
 * 场景意图判定（建 / 改 3D 场景）。保守性说明：
 * - 高置信（isExplicitSceneRequest）→ true，即使参数解析零命中
 * - 规则③规模词 → 排除疑问/查询语（"怎么算/如何/多少"），避免误触发普通问答
 */
export function hasSceneIntent(text: string): boolean {
  const t = text.toLowerCase();
  // ① 显式建场（高置信，单列以便 compat 通道放行裸请求）
  if (isExplicitSceneRequest(t)) return true;
  // 查询语负面词（规则②/②'/③ 共用）："怎么算/标准/规范/是什么"等是问句，不是建场/改场
  const QUERY = /怎么|如何|多少|标准|是什么|规范|限值|要求|是否|能否|公式|定义|算一下|查一下/;
  // ② 改参数类：动词 + 场景参数名（含"放缓/加陡"半参数动词）；排除"调节池容积标准"类名词短语
  if (/(改|调|设|换成|变成|做成|放缓|加陡|建成|调到|改到).{0,10}(堆体|堆高|谷宽|谷底宽度|坝高|井距|池容|库容|坡比|坡度)/.test(t) && !QUERY.test(t)) return true;
  // ②' 翻转语序："把堆体放缓到 1:3"（对象在前、动作在后）
  if (/把.{0,8}(堆体|堆高|谷宽|坝|井距|池容|库容|导气井|调节池).{0,8}(放缓|加陡|调到|改到|设|调)/.test(t) && !QUERY.test(t)) return true;
  // ②'' 斜坡比（1:3）与堆/坝/坡/谷 同现
  if (/1\s*[:：]\s*\d+(?:\.\d+)?/.test(t) && /(堆|坝|坡|谷)/.test(t)) return true;
  // ③ 规模词 + 场景名词 同现（排除疑问/查询语，防误触发，"填埋场库容500万m³怎么算"不算建场）
  if (/(小型|大型|中型|缓坡|陡坡|山谷型|库容|万\s*m)/.test(t)
      && /(填埋场|堆体|库区|场地|场景|坝|库)/.test(t)
      && !QUERY.test(t)) return true;
  // ④ 动作意图 + 规模词："我要个小型的" / "来个大库"
  if (/(要|来|做|给我|整|弄).{0,5}(小|大|中|超大).{0,4}(型|场|库)/.test(t)) return true;
  return false;
}

// ============ 中文数字（如"五百万"）转数值 ============

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 解析纯中文/阿拉伯数字串；仅接受中文数字与阿拉伯数字混合。无法解析返回 null */
export function cnToNum(s: string): number | null {
  const trimmed = s.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  if (!/^[零一二两三四五六七八九十百千万亿]+$/.test(trimmed)) return null;
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 1e8 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const ch of trimmed) {
    if (ch === '零') continue;
    const d = CN_DIGITS[ch];
    if (d !== undefined) { number = d; continue; }
    const u = unit[ch];
    if (!u) return null;
    if (u === 10000 || u === 1e8) {
      // 截断单位（万/亿）：段内可能已有值也可能为 0，禁止 ||1 兜底（否则"五百万"误 +1）
      section = (section + number) * u;
      total += section;
      section = 0;
      number = 0;
    } else {
      // 十/百/千：单位开头缺省视作 1（"十三" = 1×10 + 3）
      section += (number || 1) * u;
      number = 0;
    }
  }
  return total + section + number;
}

// ============ 8 维参数中文别名（用于 key=value 解析） ============

const GEO_KEY_ALIASES: Record<string, keyof GeoParams> = {
  valleyWidth: 'valleyWidth', 谷宽: 'valleyWidth', 谷底宽度: 'valleyWidth', 谷底宽: 'valleyWidth',
  pileHeight: 'pileHeight', 堆高: 'pileHeight', 堆体高度: 'pileHeight', 堆体: 'pileHeight', 坝后堆高: 'pileHeight',
  pondVolume: 'pondVolume', 池容: 'pondVolume', 调节池容积: 'pondVolume', 调节池: 'pondVolume', 容积: 'pondVolume',
  gasWellSpacing: 'gasWellSpacing', 井距: 'gasWellSpacing', 导气井间距: 'gasWellSpacing', 导气井: 'gasWellSpacing',
  damHeight: 'damHeight', 坝高: 'damHeight', 垃圾坝高: 'damHeight',
  treeDensity: 'treeDensity', 植被: 'treeDensity', 植被密度: 'treeDensity', 绿化: 'treeDensity',
  vehicleCount: 'vehicleCount', 车辆: 'vehicleCount', 车数: 'vehicleCount', 作业车辆: 'vehicleCount',
  volumeScale: 'volumeScale', 库容: 'volumeScale', 规模: 'volumeScale', 库容标定: 'volumeScale',
};

/** 宽松数值 clamp（volumeScale 等比例用） */
function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ============ 规则解析器（自然语言 → GeoParams 子集） ============

/**
 * 关键词 → GeoParams 规则解析。命中零条返回空对象 = 无场景意图。
 * 比初版方案增强：① 斜坡比（1:3 → 缓坡堆高）② 中文数字（"五百万"）③ key=value 自定义参数
 */
export const DEFAULT_NL_PARSER: NaturalLanguageParser = (text) => {
  const t = String(text ?? '').toLowerCase();
  const geo: Partial<GeoParams> = {};

  // ---------- 1) 斜坡比：1:3 / 1 : 2.5 / 1：2（缓→陡映射到堆高缩放） ----------
  const slopeMatch = t.match(/1\s*[:：/]\s*(\d+(?:\.\d+)?)/);
  if (slopeMatch) {
    const ratio = parseFloat(slopeMatch[1]);
    if (ratio <= 2) geo.pileHeight = 1.4;        // 1:2 陡坡（高堆）
    else if (ratio <= 2.5) geo.pileHeight = 1.1;
    else if (ratio <= 3) geo.pileHeight = 0.8;   // 1:3 缓坡
    else geo.pileHeight = 0.6;
  } else if (/缓坡|低坡|平缓|放缓|放缓堆体|gentle|smooth/.test(t)) {
    geo.pileHeight = 0.7;
  } else if (/陡坡|高堆|陡堆|加陡|steep|tall/.test(t)) {
    geo.pileHeight = 1.4;
  }

  // ---------- 2) 规模 / 体积：500 万 m³ / 2千万 m³ / 五百万方 / 3亿 m³ / 小型 / 大型 ----------
  let volWan: number | null = null;
  // (a) 纯阿拉伯"500万 m³"
  const volM = t.match(/(\d+(?:\.\d+)?)\s*万\s*m/);
  if (volM) volWan = parseFloat(volM[1]);
  // (b) 阿拉伯×汉字单位"2千万 m³ / 5亿 m³"（digit-first 需纯 we 捕获，覆盖改前 bug）
  if (volWan === null) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*([十百千]?)\s*(万|亿)\s*(?:m|立方|方)/);
    if (m) {
      const base = parseFloat(m[1]);
      const inter = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[m[2] ?? ''] ?? 1;
      // "2千万" = 2×1000 = 2000万；"5亿" = 5×1×10000 = 50000万
      volWan = m[3] === '亿' ? base * inter * 10000 : base * inter;
    }
  }
  // (c) 纯中文"五百万 m³ / 三亿 m³"
  if (volWan === null) {
    const cm = t.match(/([零一二两三四五六七八九十百千万亿]+)\s*(万|亿)\s*(?:m|立方|方)/);
    if (cm) {
      const cn = cnToNum(cm[1]);
      if (cn !== null) volWan = cm[2] === '亿' ? cn * 10000 : cn;
    }
  }
  if (volWan !== null && volWan > 0) {
    geo.volumeScale = clampNum(volWan / 500, 0.2, 2.2); // 基准 500 万 m³ → 1.0
  } else if (/中型|适中|medium/.test(t)) {
    geo.volumeScale = 1.0;
  } else if (/小型|小库|小场|small|mini/.test(t)) {
    geo.volumeScale = 0.3;
    if (geo.pileHeight === undefined) geo.pileHeight = 0.7;
  } else if (/大型|大库|大场|超大|large|mega|big/.test(t)) {
    geo.volumeScale = 1.6;
    if (geo.pileHeight === undefined) geo.pileHeight = 1.3;
  }

  // ---------- 3) 地形：山谷 / 平原 ----------
  if (/山谷|谷底|谷型|v 形谷|valley/.test(t)) {
    geo.valleyWidth = 1.2;
  } else if (/平原|平地|开阔|flat/.test(t)) {
    geo.valleyWidth = 0.8;
  }

  // ---------- 4) 坝高 / 池容 / 井距 ----------
  if (/高坝|抬高.{0,4}坝|坝高/.test(t)) geo.damHeight = 1.4;
  if (/大池|加大.{0,4}池|池容/.test(t)) geo.pondVolume = 1.5;
  if (/加密.{0,4}(井|根)|井距减小|加密导气/.test(t)) geo.gasWellSpacing = 0.75;

  // ---------- 5) 作业车辆 ----------
  if (/多车|繁忙|车多|many|busy/.test(t)) geo.vehicleCount = 6;
  else if (/少车|车少|少量车辆|few/.test(t)) geo.vehicleCount = 2;

  // ---------- 6) 自定义 key=value（英文键名或中文别名） ----------
  for (const [alias, key] of Object.entries(GEO_KEY_ALIASES)) {
    const re = new RegExp(`(?:^|[^\\w])${alias}\\s*[:=：]\\s*(\\d+(?:\\.\\d+)?)`, 'i');
    const m = t.match(re);
    if (m) {
      const raw = parseFloat(m[1]);
      if (key === 'vehicleCount') geo[key] = Math.round(raw);
      else geo[key] = raw;
    }
  }

  return geo;
};

// ============ 主函数 ============

export async function buildScene(
  input: BuildSceneInput,
  deps?: { nlParser?: NaturalLanguageParser; runOgs?: OgsRunner },
): Promise<BuiltScene> {
  // 防御：LLM（CodeBuddy 通道）可能传畸形 intent，统一归一为 natural 空文本 → 默认场景
  const intent: SceneIntent = input?.intent ?? { kind: 'natural', text: '' };
  let partial: Partial<GeoParams> = {};
  let preset = 'default';

  switch (intent.kind) {
    case 'preset': {
      // 先提取到局部变量，避免 union 判别式在箭头函数回调内收窄丢失
      const presetKey = intent.key;
      const found = GEO_PRESETS.find(p => p.key === presetKey);
      partial = found?.geo ?? {};
      preset = presetKey;
      break;
    }
    case 'custom': {
      // 消毒：仅保留有限数字字段。LLM（CodeBuddy）可能传字符串/NaN/越界值，
      // clampGeo 无 isFinite guard，裸传会传播 NaN 到 snapshot（审查 MED 修复）
      const clean: Partial<GeoParams> = {};
      for (const [k, v] of Object.entries(intent.geo ?? {})) {
        if (typeof v === 'number' && Number.isFinite(v)) (clean as Record<string, number>)[k] = v as number;
      }
      partial = clean;
      break;
    }
    case 'natural': {
      const parser = deps?.nlParser ?? DEFAULT_NL_PARSER;
      partial = parser(intent.text);
      // 规则解析命中零条（bogus 文本）→ 退化为默认场景，不报错（验收 A4）
      if (!Object.keys(partial).length) partial = { ...DEFAULT_GEO };
      preset = 'natural';
      break;
    }
  }

  // 2) clampGeo：无论输入来自 LLM 还是规则，输出永远在边界内
  const geo = clampGeo({ ...DEFAULT_GEO, ...partial });

  // 3) 库容 / 占地快照
  const snapshot = estimateSite(geo);

  // 4) 可选 OGS 联动：失败静默（ogSummary 留空），不阻塞场景生成
  let ogSummary: BuiltScene['ogSummary'];
  if (input?.injectOgs && deps?.runOgs) {
    const scenario = input?.ogsScenario ?? 'gas-production';
    try {
      const r = await deps.runOgs(scenario);
      if (r) ogSummary = { scenario, peakValue: r.peakValue, unit: r.unit };
    } catch { /* 静默 */ }
  }

  return { geo, preset, snapshot, ogSummary, intentEcho: intent, ts: Date.now() };
}

export default { isExplicitSceneRequest, hasSceneIntent, cnToNum, DEFAULT_NL_PARSER, buildScene };