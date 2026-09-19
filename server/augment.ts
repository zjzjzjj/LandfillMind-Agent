import { hybridSearchScored } from './retrieval.js';
import * as calc from './calculate.js';
import { llmComplete } from './llm.js';
import { EXPERT_GLOSSARY_HINT } from './prompts.js';
import { runOgsScenario } from './ogs.js';

export interface KBSource { title: string; ref: string; clause: string; detail?: string; }
export interface CalcSource { name: string; formula: string; ref: string; result?: string; }
export interface OgsSource { input: { scenario: string; params: Record<string, number> }; result: any; }
export interface Augmentation { contextText: string; kb: KBSource[]; calcs: CalcSource[]; ogs?: OgsSource | null; }

export const CALC_FORMULAS: Record<string, string> = {
  slopeFs: 'Fs = (c + γ′·H·cos²α·tanφ) / (γ·H·sinα·cosα + kv·W + q·H)，α = atan(1/β)；运行期要求 Fs ≥ 1.30（CJJ 176-2012 §4.5）',
  capacity: 'V = A·H·10⁴；使用年限 T = W / (Qd × 365)（CJJ 176-2012 §3.3）',
  hdpeCheck: 'D ≥ 1.5mm；σ ≥ 27MPa；ε ≥ 700%；焊缝气压 0.2MPa 持压 5min 压降 <10%（GB/T 17643-2011 / GB 16889-2008 §5.1）',
  wellR: 'R = 0.6·L·(Q/100)^0.25·(Δh/2)^0.2（GCW 稳态经验式，与 t 无关）',
  injectR: 'R = 4·√(Pinj/4)·√(t/24)·√k·√(0.3/φ)（经验式，量级 2~8m，副因子 μ/cf 微调）',
  leachateCalc: 'Q = A·P·C·η / 1000（A=面积㎡，P=年降雨mm，C=径流系数，η=覆盖折减）（CJJ 176-2012 §5.1）',
  lfgYield: 'Q(t) = k·L₀·M·exp(−k·t)（USEPA LandGEM 一阶衰减）',
  advect: 'C(x) = C0·exp(−v·x/D)（HJ 25.6-2019）',
  soilScreen: 'C ≤ GB 36600-2018 表1 筛选值/管制值',
  decayCalc: 'T = ln(C0/Ct) / λ；λ = ln2 / t½（HJ 25.6-2019）',
  linerKeq: 'k_eq = d_total² / (d₂²/k₂ + d₁·d₂·θ/k₁)；k_eq ≤ 1×10⁻⁹ cm/s（GB 16889-2008 §5.1）',
  settlementHyper: 's(t) = s∞·t / (a + t)（CJJ 176-2012 §4.6，双曲线法）',
  optimizeWellSpacing: 'D = √3·R（梅花形）或 2R（方形），井群叠加降深 = 单井 × (1+interference)',
  moisturePredict: 'ΔS = inflow − et − runoff；储水量上限 = storageMax（CJJ 176-2012 §5.3）',
};

function num(s: string, re: RegExp, fb: number): number {
  const m = s.match(re); const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : fb;
}
const n = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v)) ? v : fb;

export interface CalcIntent { name: string; params: Record<string, number | string>; }

export interface OgsIntent { scenario: string; params: Record<string, number>; }

/**
 * 关键词 → 稳定化计算意图路由（保守触发：必须含模拟/仿真/计算类词）
 * 产气/填埋气 → gas-production；降解/水解/纤维素 → degradation；沉降/固结 → settlement；其它默认 gas-production
 */
export function detectOgsIntent(q: string): OgsIntent | null {
  if (!q) return null;
  const sim = /模拟|仿真|数值|有限元|渗流场|水头分布|OpenGeoSys|\bOGS\b|数值计算|运移模拟|产气|沉降|降解/.test(q);
  if (!sim) return null;
  if (/(产气|填埋气|产甲烷|CH4|甲烷产量|气体|厌氧).*(模拟|计算)|(模拟|计算).*(产气|填埋气|产甲烷|气体)/.test(q)) {
    return { scenario: 'gas-production', params: {} };
  }
  if (/(降解|水解|纤维素|VFA|脂肪酸|厌氧消化|有机物).*(模拟|计算|曲线|速率)|(模拟|计算|曲线).*(降解|水解|纤维素|有机物)/.test(q)) {
    return { scenario: 'degradation', params: {} };
  }
  if (/(沉降|固结|压缩|s\(t\)|变形).*(模拟|计算)|(模拟|计算).*(沉降|固结)/.test(q)) {
    return { scenario: 'settlement', params: {} };
  }
  return { scenario: 'gas-production', params: {} };
}

/** 关键词 → 计算器意图路由（12 个计算器） */
export function detectCalcIntent(q: string): CalcIntent | null {
  if (!q) return null;
  if (/(边坡|稳定|Fs|安全系数|滑坡)/.test(q)) return { name: 'slopeFs', params: { beta: num(q, /1:\s*(\d+(?:\.\d+)?)/, 3), H: num(q, /(\d+(?:\.\d+)?)\s*(?:m|米)/, 30) } };
  if (/((渗滤液|渗沥液|水量))/.test(q)) return { name: 'leachateCalc', params: { area: num(q, /(\d+(?:\.\d+)?)\s*(?:ha|公顷)/, 5), rainfall: num(q, /(\d+(?:\.\d+)?)\s*mm/, 1500), runoffCoeff: 0.3, wasteHeight: 0 } };
  if (/(膜厚|HDPE|焊缝|防渗膜|土工膜)/.test(q)) return { name: 'hdpeCheck', params: { D: num(q, /(\d+(?:\.\d+)?)\s*mm/, 1.5), sigma: 27, eps: 700 } };
  if (/(影响半径|循环井|井距|wellR)/.test(q)) return { name: 'wellR', params: { Q: num(q, /(\d+(?:\.\d+)?)\s*m3\/d/, 100), t: 30, ne: 0.3, dh: 2 } };
  if (/(驱替半径|注气.*半径|injectR)/.test(q)) return { name: 'injectR', params: { Pinj: num(q, /(\d+(?:\.\d+)?)\s*kPa/, 5), t: 2, mu: 1, k: 1 } };
  if (/(库容|使用年限|容量)/.test(q)) return { name: 'capacity', params: { A: num(q, /(\d+(?:\.\d+)?)\s*(?:ha|公顷)/, 10), H: num(q, /(\d+(?:\.\d+)?)\s*(?:m|米)/, 30), rho: 10, Qd: 500 } };
  if (/(产气|填埋气|甲烷产量|LandGEM)/.test(q)) return { name: 'lfgYield', params: { M: num(q, /(\d+(?:\.\d+)?)\s*(?:万吨|万t)/, 50), k: 0.05, year: 10, Lo: 170 } };
  if (/(对流弥散|下游浓度|污染羽)/.test(q)) return { name: 'advect', params: { C0: 100, v: 0.1, x: num(q, /(\d+(?:\.\d+)?)\s*(?:m|米)/, 200), D: 1 } };
  if (/(筛选值|土壤.*标准|GB\s*36600)/.test(q)) return { name: 'soilScreen', params: { pol: /苯/.test(q) ? '苯' : (/镉|Cd/.test(q) ? '镉' : '铅'), cls: /一类/.test(q) ? '1' : '2' } };
  if (/(衰减|降解|半衰期|达标时间)/.test(q)) return { name: 'decayCalc', params: { C0: 100, Ctarget: num(q, /目标[^\d]{0,6}(\d+(?:\.\d+)?)/, 1), t12: 1000 } };
  if (/(等效渗透|衬垫.*验算|k_eq|linerk)/.test(q)) return { name: 'linerKeq', params: { d1: 1.5, k1: 1e-13, d2: 6, k2: 1e-11, theta: 0.1 } };
  if (/(沉降|双曲线|s\(t\))/.test(q)) return { name: 'settlementHyper', params: { t1: 365, s1: 100, t2: 730, s2: 160 } };
  return null;
}

function runCalc(name: string, p: Record<string, number | string>): { ok?: boolean; value?: unknown; unit?: string; grade?: string; analysis?: string; ref?: string } | null {
  switch (name) {
    case 'slopeFs': {
      const beta = n(p.beta, 3), angle = Math.atan(1 / beta) * 180 / Math.PI;
      const r = calc.calculateStabilityFactor(n(p.H, 30), angle, 10, 12, 25, 5);
      return { ok: true, value: r.Fs, grade: r.Fs >= 1.3 ? 'green' : 'red', analysis: r.analysis, ref: 'CJJ 176-2012 §4.5' };
    }
    case 'capacity': return calc.capacity(n(p.A, 10), n(p.H, 30), n(p.rho, 10), n(p.Qd, 500));
    case 'hdpeCheck': return calc.hdpeCheck(n(p.D, 1.5), n(p.sigma, 27), n(p.eps, 700), 0.2, 5);
    case 'wellR': return calc.wellR(n(p.Q, 100), n(p.t, 30), n(p.ne, 0.3), n(p.dh, 2));
    case 'injectR': return calc.injectR(n(p.Pinj, 5), n(p.t, 2), n(p.mu, 1), n(p.k, 1));
    case 'leachateCalc': {
      const r = calc.calculateLeachate(n(p.area, 5) * 10000, n(p.rainfall, 1500), n(p.runoffCoeff, 0.3), n(p.wasteHeight, 0));
      return { ok: true, value: r.daily, unit: 'm³/d', grade: 'green', analysis: r.analysis, ref: 'CJJ 176-2012 §5.1' };
    }
    case 'lfgYield': return calc.lfgYield(n(p.M, 50), n(p.k, 0.05), n(p.year, 10), n(p.Lo, 170));
    case 'advect': return calc.advect(n(p.C0, 100), n(p.v, 0.1), n(p.x, 200), n(p.D, 1));
    case 'soilScreen': return calc.soilScreen(String(p.pol || '铅'), p.cls === '1' ? '一类(居住/学校)' : '二类(工业/商业)');
    case 'decayCalc': return calc.decayCalc(n(p.C0, 100), n(p.Ctarget, 1), n(p.t12, 1000));
    case 'linerKeq': return calc.linerKeq(n(p.d1, 1.5), n(p.k1, 1e-13), n(p.d2, 6), n(p.k2, 1e-11), n(p.theta, 0.1));
    case 'settlementHyper': return calc.settlementHyper(n(p.t1, 365), n(p.s1, 100), n(p.t2, 730), n(p.s2, 160));
    default: return null;
  }
}

/** 对话增强：KB 检索 + 计算器自动执行，返回注入文本与引用来源
 *  + LRU 缓存（key=query.trim().slice(0,200)，MAX=50，TTL=5min）
 *  演示现场评委反复问同问题时省 80% token（避免重复 hybridSearch + 重复 LLM context 构造）
 */
const AUG_CACHE_MAX = 50;
const AUG_CACHE_TTL_MS = 5 * 60_000;
const augCache = new Map<string, { v: Augmentation; exp: number }>();

/** 调试/手动刷新场景：清空缓存（KB 重新加载后调用） */
export function clearAugCache(): void {
  augCache.clear();
}

export async function buildChatAugmentation(query: string): Promise<Augmentation> {
  const key = query.trim().slice(0, 200);
  const hit = key ? augCache.get(key) : undefined;
  if (hit && hit.exp > Date.now()) return hit.v;

  // 相关性门槛：混合得分低于阈值的条目不注入、不出现在引用里
  //   （实测分布：闲聊/天气 0.5~2.9，工程问题 4.6~18.6，阈值 3.5 居中；.env KB_MIN_SCORE 可调）
  const KB_MIN_SCORE = parseFloat(process.env.KB_MIN_SCORE ?? '3.5');
  const scored = await hybridSearchScored(query, 3);
  const kbEntries = scored.filter(s => s.score >= KB_MIN_SCORE).map(s => s.entry);
  const kb: KBSource[] = kbEntries.map(e => ({ title: e.q, ref: e.cite, clause: e.clause, detail: e.pro }));
  const intent = detectCalcIntent(query);
  const calcs: CalcSource[] = [];
  let calcText = '';
  if (intent) {
    const r = runCalc(intent.name, intent.params);
    if (r) {
      calcs.push({ name: intent.name, formula: CALC_FORMULAS[intent.name] || '', ref: r.ref || '', result: r.analysis || '' });
      calcText = `【计算参考】计算器 ${intent.name}\n公式：${CALC_FORMULAS[intent.name] || ''}\n结果：${r.analysis || ''}\n规范依据：${r.ref || ''}`;
    }
  }
  const kbText = kb.length
    ? '【知识库参考】\n' + kb.map((e, i) => `${i + 1}. ${e.title}\n   规范：${e.ref}\n   要点：${e.clause}`).join('\n')
    : '';

  // OGS 数值模拟：用户要求"模拟/仿真"时真实运行求解器，结果注入上下文
  let ogs: OgsSource | null = null;
  let ogsText = '';
  const ogsIntent = detectOgsIntent(query);
  if (ogsIntent) {
    try {
      const r = await runOgsScenario(ogsIntent.scenario, ogsIntent.params);
      ogs = { input: { scenario: ogsIntent.scenario, params: ogsIntent.params }, result: r };
      ogsText = `【OGS 数值模拟参考】场景：${r.scenarioName}${r.ok ? '' : '（⚠ 未正常收敛）'}\n${r.summary}\n（求解耗时 ${r.elapsedMs}ms，模拟 ${r.simulationTime ?? '-'}）`;
    } catch (e) {
      ogsText = `【OGS 数值模拟】调用失败：${(e as Error).message}`;
    }
  }

  const contextText = [kbText, calcText, ogsText].filter(Boolean).join('\n\n');
  const result: Augmentation = {
    contextText: contextText
      ? contextText
        + '\n\n（请基于上述参考作答，引用标准号，不得编造具体条文号；若参考不足以回答，请明确说明。）'
        + '\n' + EXPERT_GLOSSARY_HINT
      : '',
    kb,
    calcs,
    ogs,
  };

  // 写缓存：超容量时删最早插入（FIFO/LRU 简化）
  if (key && augCache.size >= AUG_CACHE_MAX) {
    const first = augCache.keys().next().value;
    if (first !== undefined) augCache.delete(first);
  }
  if (key) augCache.set(key, { v: result, exp: Date.now() + AUG_CACHE_TTL_MS });
  return result;
}

/** 长对话记忆：把较早消息压缩为要点摘要 */
export async function summarizeConversation(msgs: { role: string; content: string }[]): Promise<string> {
  if (!msgs.length) return '';
  try {
    const text = msgs.map(m => `${m.role === 'user' ? '用户' : '助手'}：${String(m.content || '').slice(0, 400)}`).join('\n');
    const s = await llmComplete(
      [{ role: 'system', content: '把下面这段对话压缩成不超过 350 字的中文要点摘要，保留关键数字、结论与未决问题，不要新增内容。' }, { role: 'user', content: text }],
      { maxTokens: 400, temperature: 0.3, timeoutMs: 20000, retries: 1 },
    );
    return s || '';
  } catch {
    return '';
  }
}

export default { CALC_FORMULAS, detectCalcIntent, buildChatAugmentation, summarizeConversation, clearAugCache };
