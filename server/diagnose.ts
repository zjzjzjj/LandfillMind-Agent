import { enqueueLLM, detailMaxTokens, detailPromptSuffix, allProviders } from './llm.js';
import { readableFormula } from './formula.js';
import type { DetailLevel, CompatCfg } from './llm.js';
import * as calc from './calculate.js';

/**
 * 填埋场 / 地基隐患 AI 快诊 —— 诊断引擎
 *
 * 设计：双引擎
 *  1) 确定性阈值评估（evaluateHazards）：用环境岩土工程阈值把场地数据判成红/橙/黄/蓝，
 *     并对每项隐患调用 calculate.ts 生成「计算书」（公式/参数代入/结果），数字可靠不编造。
 *  2) LLM 详实报告（callDetailedReport）：基于结构化隐患 + 计算书，让模型输出分章节详实报告
 *     （项目概况、逐项分析、规范依据、分级处置、监测计划、总结论）。
 */

export type Severity = 'red' | 'orange' | 'yellow' | 'blue';

export interface SiteData {
  // 基本信息
  siteName?: string;
  landfillLength?: number;   // m
  landfillWidth?: number;    // m
  landfillHeight?: number;   // m（堆高）
  landfillAge?: number;      // 年（填埋龄期）
  coverType?: string;        // 覆盖层类型

  // 边坡计算参数（详实计算书用）
  slopeAngle?: number;       // 坡角 °
  slopeGamma?: number;       // 垃圾重度 kN/m³
  slopeC?: number;           // 黏聚力 kPa
  slopePhi?: number;         // 内摩擦角 °

  // 抽注井 / 注气井
  wellCount?: number;
  wellDepth?: number;        // m
  injectionPressure?: number; // kPa
  injectionRate?: number;     // Nm³/h
  pumpRate?: number;          // m³/d

  // 监测数据
  waterLevel?: number;        // 渗滤液/地下水位，相对填埋底埋深（m），越小越危险
  /**
   * 仅用于稳定安全系数计算的代表水位埋深（m，自堆顶起算）。
   * 与 waterLevel 分开的原因：waterLevel 是**实测监测值**，缺测时不得编造；
   * 而 Fs 计算必须有一个水位输入，缺测时可用典型工况代入并标注为估算，
   * 但**不得**让这个估算值去触发「渗滤液/地下水位」监测隐患判定。
   * 缺省时回退到 waterLevel ?? 0（保留历史行为）。
   */
  waterLevelForCalc?: number;
  waterRiseRate?: number;     // 水位上升速率 m/月
  h2s?: number;               // H2S 浓度 mg/m³
  nh3?: number;               // NH3 浓度 mg/m³
  ch4?: number;               // CH4 体积浓度 %（区域外迁移浓度）
  settlementRate?: number;    // 沉降速率 mm/月
  stabilityFactor?: number;   // 稳定安全系数 Fs（如有）
  temperature?: number;       // ℃

  // 堆体表面裂缝（滑坡/失稳前兆）
  crackLength?: number;       // 最长裂缝长度 m
  crackWidth?: number;        // 裂缝宽度 cm
  crackCount?: number;        // 裂缝条数

  // 地下水
  clConcentration?: number;   // Cl⁻ 实测 mg/L
  clBackground?: number;      // Cl⁻ 背景 mg/L
  gwVelocity?: number;        // 地下水流速 m/d

  // 渗滤液
  leachateLevel?: number;     // 渗滤液液位 m
  landfillArea?: number;      // 填埋面积 m²
  rainfall?: number;          // 年降雨量 mm

  // 周边
  nearbyBuildingDistance?: number; // 周边建筑距离 m
}

/** 计算书步骤（确定性内核生成，非 LLM 编造） */
export interface CalcStep {
  label: string;            // 步骤名，如「代入公式计算」
  formula: string;          // 公式
  detail: string;           // 参数代入 + 结果
}

export interface Hazard {
  type: string;            // 隐患类型
  severity: Severity;      // 严重度
  value?: string;          // 实测值描述
  threshold?: string;      // 阈值/判据描述
  mechanism?: string;      // 成因/机理
  reference?: string;      // 规范依据（要点）
  advice?: string;         // 处置建议（LLM 或默认）
  calc?: CalcStep[];       // 计算书（逐项详实）
}

export interface ReportSection {
  title: string;
  content: string;
}

/** AI 详实报告（分章节） */
export interface DetailedReport {
  overview: string;                          // 项目概况 + 风险总览
  sections: ReportSection[];                 // 逐项详实分析
  regulations: string[];                     // 规范依据
  actions: { immediate: string[]; shortTerm: string[]; longTerm: string[] };
  monitoring: string[];                      // 监测与应急计划
  conclusion: string;                        // 总结论
}

export interface DiagnosisResult {
  site: SiteData;
  hazards: Hazard[];
  overallRisk: Severity;
  report: DetailedReport;    // AI 分章节详实报告
  dataCompleteness: number;  // 0-1，已填字段比例
  warnings?: string[];
}

/** 严重度升序（唯一阈值口径来源：多智能体模块复用它做 worst-of 聚合，避免各写一套） */
export const SEVERITY_RANK: Record<Severity, number> = { blue: 0, yellow: 1, orange: 2, red: 3 };
const SEVERITY_LABEL: Record<Severity, string> = {
  red: '重大风险',
  orange: '较大风险',
  yellow: '一般风险',
  blue: '较低风险',
};

export function severityLabel(s: Severity): string {
  return SEVERITY_LABEL[s];
}

/** 内置示例数据（演示用，不依赖私有数据） */
export const EXAMPLE_SITE: SiteData = {
  siteName: '示例·某老龄填埋场东区',
  landfillLength: 220,
  landfillWidth: 160,
  landfillHeight: 28,
  landfillAge: 12,
  coverType: '临时覆盖（HDPE膜+土层）',
  wellCount: 18,
  wellDepth: 22,
  injectionPressure: 35,
  injectionRate: 60,
  pumpRate: 120,
  waterLevel: 2.5,
  waterRiseRate: 0.4,
  h2s: 12,
  nh3: 5,
  ch4: 3.5,
  settlementRate: 18,
  stabilityFactor: 1.15,
  temperature: 38,
  nearbyBuildingDistance: 60,
};

const NUMERIC_FIELDS: (keyof SiteData)[] = [
  'landfillLength', 'landfillWidth', 'landfillHeight', 'landfillAge', 'wellCount',
  'wellDepth', 'injectionPressure', 'injectionRate', 'pumpRate', 'waterLevel',
  'waterRiseRate', 'h2s', 'nh3', 'ch4', 'settlementRate', 'stabilityFactor',
  'temperature', 'nearbyBuildingDistance',
  'crackLength', 'crackWidth', 'crackCount',
  'slopeAngle', 'slopeGamma', 'slopeC', 'slopePhi',
  'clConcentration', 'clBackground', 'gwVelocity',
  'leachateLevel', 'landfillArea', 'rainfall',
  // 稳定计算代表水位：列入数值字段以保证 parseSiteData 不会把它存成字符串
  'waterLevelForCalc',
];

/**
 * 解析输入：支持
 *  - 结构化对象（前端直接传 JSON）
 *  - CSV 文本（字段名,数值；容错中英文别名）
 *  - "key: value" 或 "key=value" 多行文本
 */
export function parseSiteData(input: any): { site: SiteData; warnings: string[] } {
  const warnings: string[] = [];
  const site: SiteData = {};

  const setField = (key: keyof SiteData, raw: any) => {
    if (raw === undefined || raw === null || raw === '') return;
    if (NUMERIC_FIELDS.includes(key)) {
      const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
      if (!Number.isNaN(n)) (site as any)[key] = n;
    } else {
      (site as any)[key] = String(raw);
    }
  };

  // 1) 结构化对象
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const f of Object.keys(site) as (keyof SiteData)[]) void f;
    Object.keys(input).forEach(k => setField(k as keyof SiteData, input[k]));
    // 兼容 text 字段
    if (typeof input.text === 'string') parseText(String(input.text), setField, warnings);
    return { site, warnings };
  }

  // 2) 文本（CSV / 键值对）
  const text = typeof input === 'string' ? input : (input && input.text);
  if (typeof text === 'string') {
    parseText(text, setField, warnings);
  }

  if (Object.keys(site).length === 0) {
    warnings.push('未能从输入中解析出任何场地数据，请检查格式或改用表单录入。');
  }
  return { site, warnings };
}

function parseText(text: string, setField: (k: keyof SiteData, v: any) => void, warnings: string[]) {
  const alias: Record<string, keyof SiteData> = {
    '场地名称': 'siteName', 'siteName': 'siteName', 'name': 'siteName',
    '填埋体长': 'landfillLength', '长': 'landfillLength', 'length': 'landfillLength',
    '填埋体宽': 'landfillWidth', '宽': 'landfillWidth', 'width': 'landfillWidth',
    '填埋体高': 'landfillHeight', '堆高': 'landfillHeight', '高': 'landfillHeight', 'height': 'landfillHeight',
    '填埋龄期': 'landfillAge', '龄期': 'landfillAge', 'age': 'landfillAge',
    '覆盖层': 'coverType', 'coverType': 'coverType',
    '井数': 'wellCount', '抽注井数量': 'wellCount', 'wellCount': 'wellCount',
    '井深': 'wellDepth', 'wellDepth': 'wellDepth',
    '注气压力': 'injectionPressure', 'injectionPressure': 'injectionPressure',
    '注气量': 'injectionRate', 'injectionRate': 'injectionRate',
    '抽水量': 'pumpRate', 'pumpRate': 'pumpRate',
    '水位': 'waterLevel', 'waterLevel': 'waterLevel', '渗滤液水位': 'waterLevel',
    '水位上升速率': 'waterRiseRate', 'waterRiseRate': 'waterRiseRate',
    'h2s': 'h2s', 'H2S': 'h2s', '硫化氢': 'h2s',
    'nh3': 'nh3', 'NH3': 'nh3', '氨': 'nh3',
    'ch4': 'ch4', 'CH4': 'ch4', '甲烷': 'ch4',
    '沉降速率': 'settlementRate', 'settlementRate': 'settlementRate',
    '稳定安全系数': 'stabilityFactor', '安全系数': 'stabilityFactor', 'stabilityFactor': 'stabilityFactor', 'Fs': 'stabilityFactor',
    '温度': 'temperature', 'temperature': 'temperature',
    '周边建筑距离': 'nearbyBuildingDistance', 'nearbyBuildingDistance': 'nearbyBuildingDistance',
    // 堆体裂缝（滑坡前兆）
    '裂缝长度': 'crackLength', '最长裂缝': 'crackLength', 'crackLength': 'crackLength',
    '裂缝宽度': 'crackWidth', '缝宽': 'crackWidth', 'crackWidth': 'crackWidth',
    '裂缝条数': 'crackCount', 'crackCount': 'crackCount',
    // 地下水/渗滤液（补齐缺失别名，供"快诊"CSV 录入直达）
    '氯离子': 'clConcentration', 'Cl⁻': 'clConcentration', 'clConcentration': 'clConcentration',
    '氯离子背景': 'clBackground', 'clBackground': 'clBackground',
    '地下水流速': 'gwVelocity', 'gwVelocity': 'gwVelocity',
    '渗滤液液位': 'leachateLevel', 'leachateLevel': 'leachateLevel',
    '填埋面积': 'landfillArea', '面积': 'landfillArea', 'landfillArea': 'landfillArea',
    '年降雨量': 'rainfall', '降雨量': 'rainfall', 'rainfall': 'rainfall',
    // 边坡计算参数
    '坡角': 'slopeAngle', 'slopeAngle': 'slopeAngle', '坡度': 'slopeAngle',
    '垃圾重度': 'slopeGamma', 'slopeGamma': 'slopeGamma',
    '黏聚力': 'slopeC', '粘聚力': 'slopeC', 'slopeC': 'slopeC',
    '内摩擦角': 'slopePhi', 'slopePhi': 'slopePhi',
  };

  const lines = text.split(/[\n;]/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // CSV: 字段名,数值 或 字段名,数值,单位
    const csv = line.split(',');
    if (csv.length >= 2) {
      const key = csv[0].trim();
      const val = csv.slice(1).join(',').trim();
      const field = alias[key];
      if (field) { setField(field, val); continue; }
    }
    // 键值对: key: value / key=value
    const m = line.match(/^(.*?)[：:=]\s*(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim();
      const field = alias[key];
      if (field) { setField(field, val); continue; }
    }
  }
}

/** 确定性阈值评估：返回结构化隐患列表（severity 由工程阈值判定） */
export function evaluateHazards(site: SiteData): Hazard[] {
  const h: Hazard[] = [];

  // 1) 填埋场整体稳定安全系数（优先用 calculate 内核从参数计算，其次用直接给定的 Fs）
  {
    const H = site.landfillHeight, beta = site.slopeAngle, gamma = site.slopeGamma,
      c = site.slopeC, phi = site.slopePhi, w = site.waterLevel;
    // 稳定计算用的水位：优先取显式给定的代表水位（可为估算值），否则回退实测水位
    const wCalc = site.waterLevelForCalc ?? w;
    let Fs: number | undefined;
    let riskLevel: Severity | undefined;
    let calcSteps: CalcStep[] | undefined;
    if (typeof H === 'number' && typeof beta === 'number' && typeof gamma === 'number' && typeof c === 'number' && typeof phi === 'number') {
      const r = calc.calculateStabilityFactor(H, beta, wCalc ?? 0, gamma, phi, c);
      Fs = r.Fs; riskLevel = r.riskLevel;
      const alpha = beta * Math.PI / 180;
      const tanPhi = Math.tan(phi * Math.PI / 180);
      const driving = gamma * H * Math.sin(alpha) * Math.cos(alpha);
      const resisting = c + gamma * H * Math.cos(alpha) * Math.cos(alpha) * tanPhi;
      calcSteps = [
        { label: '整理计算参数', formula: 'H、β、γ、c、φ、水位埋深', detail: `H=${H}m，β=${beta}°，γ=${gamma}kN/m³，c=${c}kPa，φ=${phi}°，水位埋深≈${wCalc ?? 0}m${w === undefined && wCalc !== undefined ? '（估算代表水位，非实测）' : ''}` },
        { label: '简化条分法抗滑稳定', formula: 'Fs = (c + γ·H·cos²β·tanφ) / (γ·H·sinβ·cosβ)', detail: `滑动力 = γ·H·sinβ·cosβ = ${driving.toFixed(1)} kPa；抗滑力 = c + γ·H·cos²β·tanφ = ${resisting.toFixed(1)} kPa` },
        { label: '稳定系数与等级判定', formula: '运行期要求 Fs ≥ 1.30', detail: `Fs = ${Fs.toFixed(2)}${Fs >= 1.3 ? '，满足运行要求' : '，不满足运行要求'} → ${severityLabel(riskLevel)}` },
      ];
    } else if (typeof site.stabilityFactor === 'number') {
      Fs = site.stabilityFactor;
      riskLevel = Fs < 1.0 ? 'red' : Fs < 1.2 ? 'orange' : Fs < 1.5 ? 'yellow' : 'blue';
      calcSteps = [
        { label: '采用输入稳定系数', formula: 'Fs（现场/委托测算）', detail: `Fs = ${Fs}` },
        { label: '等级判定', formula: '运行期要求 Fs ≥ 1.30', detail: `Fs = ${Fs} → ${severityLabel(riskLevel)}` },
      ];
    }
    if (Fs !== undefined && riskLevel) {
      h.push({
        type: '填埋场整体稳定',
        severity: riskLevel,
        value: `Fs ≈ ${Fs}`,
        threshold: '运行期要求 Fs ≥ 1.30',
        mechanism: '垃圾体抗剪强度不足或渗滤液水位过高会显著降低稳定安全系数，易引发滑坡、失稳。',
        reference: 'CJJ 176-2012 §4.5 / GB 50330-2013 §5.2',
        advice: riskLevel === 'blue'
          ? '维持现状监测。'
          : '降低渗滤液水位、设置导排与坡面支护；必要时进行稳定化加固（如注浆、减重、放缓坡比、加密位移监测）。',
        calc: calcSteps,
      });
    }
  }

  // 2) 沉降速率
  if (typeof site.settlementRate === 'number') {
    const r = site.settlementRate;
    let sev: Severity = 'blue'; let thr = '';
    if (r > 30) { sev = 'red'; thr = '>30 mm/月'; }
    else if (r > 10) { sev = 'orange'; thr = '10–30 mm/月'; }
    else if (r > 3) { sev = 'yellow'; thr = '3–10 mm/月'; }
    else { sev = 'blue'; thr = '≤3 mm/月'; }
    h.push({
      type: '地表/堆体沉降',
      severity: sev,
      value: `${r} mm/月`,
      threshold: thr,
      mechanism: '有机垃圾降解、水位变化与荷载重分布引起沉降；过大沉降拉裂覆盖层与导排系统，诱发渗漏与臭气外逸。',
      reference: '填埋场稳定化场地利用相关标准对残余沉降速率提出限值要求。',
      advice: sev === 'blue'
        ? '纳入常规监测。'
        : '加密沉降监测与覆盖层巡检；对裂缝及时封盖，控制水位以减缓沉降。',
    });
  }

  // 2.5) 堆体表面裂缝（滑坡前兆：后缘拉张 → 侧翼剪切 → 前缘鼓胀）
  //      宽度反映贯穿性、长度反映延伸范围、条数反映密集程度；
  //      本项只按裂缝几何判定，与水位/沉降的耦合研判由交叉规则层负责。
  if (typeof site.crackLength === 'number' || typeof site.crackWidth === 'number' || typeof site.crackCount === 'number') {
    const len = site.crackLength ?? 0;
    const wid = site.crackWidth ?? 0;
    const cnt = site.crackCount ?? 0;
    let sev: Severity = 'blue'; let thr = '';
    if (wid >= 5 || len >= 20) { sev = 'red'; thr = '宽度≥5cm 或 长度≥20m（贯穿性长大裂缝）'; }
    else if (wid >= 3 || len >= 10 || cnt >= 3) { sev = 'orange'; thr = '宽度≥3cm 或 长度≥10m 或 条数≥3'; }
    else if (wid >= 1 || len >= 5) { sev = 'yellow'; thr = '宽度≥1cm 或 长度≥5m'; }
    else { sev = 'blue'; thr = '宽度<1cm 且 长度<5m（细微裂缝）'; }
    const parts: string[] = [];
    if (typeof site.crackLength === 'number') parts.push(`最长 ${len} m`);
    if (typeof site.crackWidth === 'number') parts.push(`宽 ${wid} cm`);
    if (typeof site.crackCount === 'number') parts.push(`${cnt} 条`);
    h.push({
      type: '堆体表面裂缝',
      severity: sev,
      value: parts.join('、') || '—',
      threshold: thr,
      mechanism: '堆体表面裂缝是滑坡的典型前兆：后缘拉张裂缝指示滑体已开始位移，侧翼剪切与前缘鼓胀进一步印证。裂缝同时成为降雨与地表水入渗的优先通道，抬升堆体内水位、降低有效应力，形成"裂缝—入渗—失稳"正反馈。',
      reference: 'CJJ 176 / GB 16889 对堆体表面巡查与裂缝处置提出要求；裂缝分级参照滑坡前兆判据。',
      advice: sev === 'red'
        ? '立即控制填埋作业与堆载，封闭裂缝防止地表水入渗，加密位移与水位监测，启动稳定复核与应急加固预案。'
        : sev === 'orange'
          ? '限期封闭裂缝并停止裂缝区堆载，复算稳定安全系数，加密位移/水位/沉降监测频次。'
          : '及时封填裂缝、加强坡面排水与日常巡查。',
      calc: [
        { label: '裂缝几何判定', formula: '宽度/长度/条数 分档', detail: `${parts.join('、') || '—'} → ${thr} → ${severityLabel(sev)}` },
        { label: '入渗通道影响', formula: '裂缝 → 地表水优先入渗 → 堆体内水位抬升 → 有效应力下降', detail: sev === 'blue' ? '裂缝细微，入渗影响有限，纳入常规巡查。' : '已形成优先入渗通道，需按上条处置措施封闭并复核稳定。' },
      ],
    });
  }

  // 3) H2S 臭气浓度
  if (typeof site.h2s === 'number') {
    const v = site.h2s;
    let sev: Severity = 'blue'; let thr = '';
    if (v > 10) { sev = 'red'; thr = '>10 mg/m³（敏感点异味与职业健康风险高）'; }
    else if (v > 1) { sev = 'orange'; thr = '1–10 mg/m³'; }
    else if (v > 0.1) { sev = 'yellow'; thr = '0.1–1 mg/m³'; }
    else { sev = 'blue'; thr = '≤0.1 mg/m³'; }
    h.push({
      type: '臭气（H2S）污染',
      severity: sev,
      value: `${v} mg/m³`,
      threshold: thr,
      mechanism: '厌氧降解产生 H2S 等恶臭气体；水位上升、覆盖层破损或导排不畅会加剧臭气外逸，影响周边与工友健康。',
      reference: '《恶臭污染物排放标准》GB 14554 对 H2S 等恶臭污染物厂界浓度提出限值。',
      advice: sev === 'blue'
        ? '维持监测。'
        : '强化注气驱水与气体收集（提高收集效率、保持负压）；修复覆盖层、增设除臭（生物滤池/化学洗涤）。',
    });
  }

  // 4) CH4 区域外迁移（爆炸/窒息）—— 六档分级，对齐 EXPERT_KNOWLEDGE.methane.levels
  //    normal ≤0.5 / attention ≤1 / warning ≤2.5 / alarm ≤5 / danger ≤15 / explosive >15（%vol）
  if (typeof site.ch4 === 'number') {
    const v = site.ch4;
    let sev: Severity = 'blue'; let thr = ''; let action = '';
    if (v > 15)      { sev = 'red';    thr = '>15%（爆炸区间以上，极高爆炸风险）'; action = '立即撤离至安全距离，启动应急预案'; }
    else if (v > 5)  { sev = 'red';    thr = '5–15%（爆炸区间，重大风险）';         action = '全员撤离，断电，禁止一切火源'; }
    else if (v > 2.5){ sev = 'orange'; thr = '2.5–5%（爆炸下限附近，较大风险）';   action = '停止作业，撤离非必要人员，启动应急抽气'; }
    else if (v > 1)  { sev = 'yellow'; thr = '1–2.5%（预警）';                     action = '启动通风，限制火源，人员佩戴报警仪'; }
    else if (v > 0.5){ sev = 'blue';   thr = '0.5–1%（关注）';                     action = '加密监测频次，排查泄漏源'; }
    else             { sev = 'blue';   thr = '≤0.5%（正常）';                       action = '常规监测'; }
    const lel = Math.round((v / 5) * 100); // 100% LEL ≈ 5% vol
    h.push({
      type: '甲烷迁移与爆炸风险',
      severity: sev,
      value: `区域外 CH₄ ≈ ${v}%`,
      threshold: thr,
      mechanism: '填埋气 CH₄ 迁移至填埋场边界外封闭空间（管沟、建筑周边）积聚，遇引火源有爆炸/窒息风险。',
      reference: 'GB 16889-2008 §6.1 / CJJ 176-2012 §6.1',
      advice: action,
      calc: [
        { label: '爆炸下限换算', formula: '100% LEL ≈ 5% vol（甲烷）', detail: `实测 ${v}% 体积浓度 ≈ ${lel}% LEL` },
        { label: '六档分级判定', formula: 'normal ≤0.5 / attention ≤1 / warning ≤2.5 / alarm ≤5 / danger ≤15 / explosive >15（%vol）', detail: `${v}% vol 落入「${thr.split('（')[0]}」区间 → ${severityLabel(sev)}（${action}）` },
      ],
    });
  }

  // 5) 渗滤液/地下水位（埋深判据 + 渗滤液产量计算书）
  if (typeof site.waterLevel === 'number') {
    const w = site.waterLevel; // 相对填埋底埋深
    let sev: Severity = 'blue'; let thr = '';
    if (w < 1) { sev = 'red'; thr = '埋深<1 m（接近库底，导排失效、稳定与臭气风险高）'; }
    else if (w < 3) { sev = 'orange'; thr = '埋深 1–3 m'; }
    else { sev = 'blue'; thr = '埋深≥3 m（较安全）'; }
    const calcSteps: CalcStep[] = [
      { label: '水位埋深判定', formula: '埋深越浅，孔隙水压力越高、稳定越不利', detail: `实测水位埋深 ≈ ${w}m → ${severityLabel(sev)}` },
    ];
    if (typeof site.landfillArea === 'number' && typeof site.rainfall === 'number') {
      const L = calc.calculateLeachate(site.landfillArea, site.rainfall, 0.3, site.landfillHeight ?? 0);
      calcSteps.push({ label: '渗滤液产量估算', formula: 'Q = C·A·I（经验公式，径流系数 C=0.3）', detail: L.analysis });
    }
    h.push({
      type: '渗滤液/地下水位',
      severity: sev,
      value: `水位埋深≈${w} m`,
      threshold: thr,
      mechanism: '水位过高抬高孔隙水压力、降低有效应力与稳定安全系数，并驱动臭气与渗滤液上逸。',
      reference: 'GB 16889-2008 §5.2',
      advice: sev === 'blue'
        ? '维持导排。'
        : '提升抽注井抽排能力、优化注采比；必要时增设深层导排盲沟降低水位。',
      calc: calcSteps,
    });
  }
  if (typeof site.waterRiseRate === 'number' && site.waterRiseRate > 0.2) {
    h.push({
      type: '水位上升趋势',
      severity: site.waterRiseRate > 0.5 ? 'orange' : 'yellow',
      value: `上升速率≈${site.waterRiseRate} m/月`,
      threshold: '>0.2 m/月 需关注',
      mechanism: '降水入渗、覆盖层渗漏或抽排不足导致水位持续上升，是稳定与臭气恶化的前兆。',
      reference: '运行期水位动态应纳入监测与调控。',
      advice: '核查覆盖层防渗与抽排系统，动态调整注采参数。',
    });
  }

  // 5.5) 地下水氯离子污染（Cl⁻ 超标 + 对流弥散预测计算书）
  if (typeof site.clConcentration === 'number') {
    const cl = site.clConcentration;
    const bg = site.clBackground ?? 50;
    const sev: Severity = cl > 250 ? 'orange' : (cl > bg * 2 ? 'yellow' : 'blue');
    const calcSteps: CalcStep[] = [
      { label: '实测与背景对比', formula: '超标倍数 = 实测 / 背景', detail: `Cl⁻ 实测 ${cl}mg/L，背景 ${bg}mg/L，超背景约 ${(cl / bg).toFixed(1)} 倍` },
      { label: '水质标准判定', formula: 'GB/T 14848 III类 Cl⁻ ≤ 250 mg/L', detail: `${cl}mg/L ${cl > 250 ? '>250，超 III 类标准' : '≤250，未超 III 类标准'} → ${severityLabel(sev)}` },
    ];
    if (typeof site.gwVelocity === 'number') {
      const adv = calc.advect(cl, site.gwVelocity, 200, 10);
      calcSteps.push({ label: '对流弥散下游预测', formula: 'C(x) = C0·exp(−v·x/D)（简化）', detail: `流速 v=${site.gwVelocity}m/d，下游 200m 预测浓度约 ${adv.value}mg/L` });
    }
    h.push({
      type: '地下水 Cl⁻ 污染',
      severity: sev,
      value: `Cl⁻ ≈ ${cl} mg/L`,
      threshold: 'GB/T 14848 III类 ≤ 250 mg/L',
      mechanism: '渗滤液渗漏或历史污染导致地下水中 Cl⁻ 升高，指示污染羽已向下游扩散。',
      reference: 'GB/T 14848-2017 / HJ 25.6-2019',
      advice: '加密下游监测井采样频次；开展同位素/水化学溯源调查；必要时布设阻隔墙或抽排井控制污染羽扩散。',
      calc: calcSteps,
    });
  }

  // 6) 填埋龄期（活跃/老龄）
  if (typeof site.landfillAge === 'number') {
    if (site.landfillAge < 5) {
      h.push({
        type: '填埋龄期（年轻填埋场）',
        severity: 'yellow',
        value: `龄期≈${site.landfillAge} 年`,
        threshold: '<5 年（产甲烷上升期，产气与沉降活跃）',
        mechanism: '年轻填埋场处于产气与沉降高峰，导排与气体收集系统负荷大。',
        reference: '稳定化进程与龄期相关。',
        advice: '强化气体收集与沉降监测，预留系统余量。',
      });
    } else if (site.landfillAge > 20) {
      h.push({
        type: '填埋龄期（老龄填埋场）',
        severity: 'yellow',
        value: `龄期≈${site.landfillAge} 年`,
        threshold: '>20 年（趋于稳定，但历史遗留隐患需排查）',
        mechanism: '老龄场整体趋稳，但可能存在早期防渗/导排标准偏低、局部未封场等遗留问题。',
        reference: '稳定化场地再利用相关标准。',
        advice: '开展场地环境隐患排查与封场评估，明确再利用边界。',
      });
    }
  }

  // 7) 周边建筑距离
  if (typeof site.nearbyBuildingDistance === 'number' && typeof site.landfillHeight === 'number') {
    if (site.nearbyBuildingDistance < site.landfillHeight) {
      h.push({
        type: '周边建筑安全距离',
        severity: 'orange',
        value: `建筑距离≈${site.nearbyBuildingDistance} m（堆高≈${site.landfillHeight} m）`,
        threshold: '小于堆高，需重点关注',
        mechanism: '建筑距离过近会增加甲烷迁移积聚、沉降影响与应急疏散难度。',
        reference: '填埋场选址与周边防护距离相关规范要点。',
        advice: '加强边界气体监测与主动抽排，评估防护距离合规性。',
      });
    }
  }

  return h;
}

/** 取隐患列表中的最高严重度（多智能体模块复用，保证两处 worst-of 口径一致） */
export function maxSeverity(list: Hazard[]): Severity {
  let max: Severity = 'blue';
  for (const x of list) if (SEVERITY_RANK[x.severity] > SEVERITY_RANK[max]) max = x.severity;
  return max;
}

/** 调用 OpenAI 兼容接口生成分章节详实报告（非流式；models 为 fallback 链，逐个尝试） */
export async function callDeepSeekAdvice(
  site: SiteData,
  hazards: Hazard[],
  models: string[],
  apiKey: string,
  baseUrl: string,
  detail: DetailLevel,
): Promise<DetailedReport> {
  const overallRisk = maxSeverity(hazards);

  const sys = `你是环境岩土工程专家，服务于"LandfillMind · 填埋场全周期智能体"。

## 专业知识背景
- 注气驱水技术：往填埋场注入气体（空气）把孔隙水"顶"出来，目标含水率降至≤30%
- 分段式循环抽注气：每2m一段，自上而下，≤4kPa，每段3-4天，井距10-15m
- 双孔隙度特性：垃圾裂隙+基质双套孔隙，大孔隙排水快，小孔隙慢
- 注气压力：2-8kPa有效，下限≥2kPa克服毛细阻力，上限≤8kPa防隆起
- 井间距：D=√3·R_eff（梅花形），推荐10-15m，六角形布井比方形效率高40%
- 间歇曝气：每天2-4h，VOC减排63%，节能80%

## 报告要求（务必详实、分章节）
- 结论先行，逐项展开；**引用"计算书"中的数字与公式，不得另造数据**
- 引用规范只写"标准号 + 要点精神"，不得编造具体条款号
- 处置建议按「立即 / 短期 / 长期」分级
- 输出严格 JSON（不要 Markdown 代码块，不要额外解释文字）` + detailPromptSuffix(detail);

  const hazardText = hazards.map(h => {
    const calcText = (h.calc || []).map(c => `    · ${c.label}：${c.formula} → ${c.detail}`).join('\n');
    return `【${h.type}】严重度=${severityLabel(h.severity)}｜实测=${h.value || '—'}｜判据=${h.threshold || '—'}｜机理=${h.mechanism || '—'}\n计算书：\n${calcText}`;
  }).join('\n\n');
  const siteText = Object.entries(site).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join('；');

  const user = `场地数据：${siteText}\n\n已识别隐患（含计算书）：\n\n${hazardText}\n\n请输出 JSON：{
  "overview": "项目概况与风险总览（1-2段，先给综合风险等级）",
  "sections": [{ "title": "逐项隐患名", "content": "详实分析：计算依据+风险机理+处置措施" }],
  "regulations": ["规范引用列表"],
  "actions": { "immediate": ["立即措施"], "shortTerm": ["短期措施"], "longTerm": ["长期措施"] },
  "monitoring": ["监测与应急计划条目"],
  "conclusion": "总结论"
}`;

  const fallbackReport = (): DetailedReport => {
    const regs = [...new Set(hazards.map(h => h.reference).filter(Boolean))] as string[];
    const urgent = hazards.filter(h => h.severity === 'red' || h.severity === 'orange').map(h => `${h.type}：${h.advice ?? ''}`).filter(Boolean);
    return {
      overview: `本次诊断共识别 ${hazards.length} 项隐患，综合风险等级：${severityLabel(overallRisk)}。`,
      sections: hazards.map(h => ({ title: h.type, content: `${h.mechanism || ''}${h.advice ? '处置建议：' + h.advice : ''}` })),
      regulations: regs,
      actions: { immediate: urgent, shortTerm: [], longTerm: [] },
      monitoring: [],
      conclusion: `综合风险等级：${severityLabel(overallRisk)}（确定性阈值评估）。`,
    };
  };

  // 无 API Key 时返回确定性兜底报告
  if (!apiKey) {
    const fb = fallbackReport();
    fb.overview = '（未配置 LLM API Key，以下为确定性阈值评估结果；在 .env 填入 OPENAI_API_KEY 可获得 AI 详实报告）\n' + fb.overview;
    return fb;
  }

  const normReport = (p: any): DetailedReport => ({
    overview: readableFormula(String(p.overview ?? '')),
    sections: Array.isArray(p.sections) ? p.sections.map((s: any) => ({ title: String(s.title ?? ''), content: readableFormula(String(s.content ?? '')) })) : [],
    regulations: Array.isArray(p.regulations) ? p.regulations.map((x: any) => readableFormula(String(x))) : [],
    actions: {
      immediate: Array.isArray(p.actions?.immediate) ? p.actions.immediate.map((x: any) => readableFormula(String(x))) : [],
      shortTerm: Array.isArray(p.actions?.shortTerm) ? p.actions.shortTerm.map((x: any) => readableFormula(String(x))) : [],
      longTerm: Array.isArray(p.actions?.longTerm) ? p.actions.longTerm.map((x: any) => readableFormula(String(x))) : [],
    },
    monitoring: Array.isArray(p.monitoring) ? p.monitoring.map((x: any) => readableFormula(String(x))) : [],
    conclusion: readableFormula(String(p.conclusion ?? '')),
  });

  // 双通道链：主通道（OpenRouter）→ 备通道（GLM 直连），任一通道可用即出报告
  const chain: { cfg: CompatCfg; model: string }[] = [];
  allProviders().forEach(cfg => {
    cfg.models.forEach(model => {
      if (!chain.some(x => x.model === model && x.cfg.baseUrl === cfg.baseUrl)) chain.push({ cfg, model });
    });
  });
  // 兼容旧入口显式传入的模型/Key（不在通道清单时兜底）
  if (!chain.length && models.length && apiKey && baseUrl) {
    chain.push({
      cfg: { apiKey, baseUrl, model: models[0], models, label: '默认', kind: 'compat', concurrency: 'serial' },
      model: models[0],
    });
  }

  // 宽松提取 JSON：支持 ```json 代码块 / 首尾大括号截取 / 双重编码解包
  const extractJson = (text: string): any | null => {
    const tryParse = (t: string): any => { try { return JSON.parse(t); } catch { return null; } };
    let v: any = tryParse(text);
    if (v === null) {
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) v = tryParse(fence[1]);
    }
    if (v === null) {
      const braces = text.match(/\{[\s\S]*\}/);
      if (braces) v = tryParse(braces[0]);
    }
    if (v === null) return null;
    // 部分模型偶发双重编码：整体报告作为字符串字段返回（如 {"overview":"{...}"}），递归解包
    for (let i = 0; i < 3; i++) {
      if (typeof v === 'string') {
        const inner = tryParse(v);
        if (inner === null) return null; // 普通文本，交给上层把原文放进 overview
        v = inner;
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const keys = Object.keys(v);
        if (keys.length === 1 && typeof v[keys[0]] === 'string') {
          const inner = tryParse(v[keys[0]]);
          if (inner && typeof inner === 'object') { v = inner; continue; }
        }
      }
      return v;
    }
    return v;
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let lastErr = '';

  for (const item of chain) {
    let maxTokens = detailMaxTokens(detail, item.cfg.kind);
    const url = `${item.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const payload = (m: string, withJsonMode: boolean) => JSON.stringify({
      model: m,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
      ...(item.cfg.kind === 'glm' ? { thinking: { type: 'disabled' } } : {}),   // 禁用推理思考，避免 reasoning_content 占满 token 截断 JSON
      ...(withJsonMode && item.cfg.kind !== 'glm' ? { response_format: { type: 'json_object' } } : {}),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const upstream = await enqueueLLM(() => fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${item.cfg.apiKey}` },
          body: payload(item.model, attempt === 0),
        }));
        if (upstream.ok) {
          const json = await upstream.json();
          const content: string = json?.choices?.[0]?.message?.content || '{}';
          const parsed = extractJson(content);
          if (!parsed) {
            // 模型未按 JSON 输出：把原文作为 overview 展示，不丢弃
            const fb = fallbackReport();
            fb.overview = content;
            return fb;
          }
          const r = normReport(parsed);
          // 关键字段为空时用兜底补齐，保证前端始终有可渲染内容
          if (!r.overview) r.overview = fallbackReport().overview;
          if (!r.sections.length) r.sections = fallbackReport().sections;
          if (!r.conclusion) r.conclusion = fallbackReport().conclusion;
          return r;
        }
        const errText = await upstream.text();
        lastErr = errText.slice(0, 200);
        // max_tokens 超限 / 上下文过长：减半重试，最终自动降档不中断
        if (upstream.status === 400 && /max_tokens|maximum context|context length|invalid_request_error|response_format|json_object/i.test(errText)) {
          if (maxTokens > 512) { maxTokens = Math.floor(maxTokens / 2); continue; }
          break;
        }
        const transient = upstream.status === 429 || upstream.status >= 500 || errText.includes('1305');
        if (!transient) break;
        await sleep(1200 * (attempt + 1));
      } catch (e: any) {
        lastErr = String(e?.message || '');
        await sleep(800);
      }
    }
  }
  const fb = fallbackReport();
  fb.overview = '（LLM 报告暂不可用：模型繁忙，请稍后重试；以下为确定性阈值评估结果）\n' + fb.overview;
  console.error('[diagnose] LLM 详实报告失败，回退确定性评估。lastErr:', lastErr);
  return fb;
}



// ============ AI 纠偏 · 计算内核交叉复核 ============
// 目的：LLM 详实报告生成后，用确定性计算内核的关键数值与风险项做交叉校验；
// 报告未引用内核数值 / 遗漏风险项时，系统按内核结论兜底纠偏并写入报告，
// 保证"AI 只解释不推翻内核"的工程可靠性。

export interface VerificationResult {
  consistent: boolean;   // 是否全部通过复核
  checked: number;       // 通过复核的隐患项数（关键数值被报告引用）
  total: number;         // 参与复核的隐患项数
  mismatches: string[];  // 复核发现并已纠偏的问题
}

/** 常见的整数阈值/年份，避免误报"未引用" */
const VERIFY_IGNORE = new Set(['10','30','50','100','365','2008','2009','2011','2012','2013','2018','2019','2020','2025','2026']);

export function verifyReportAgainstKernel(report: DetailedReport, hazards: Hazard[]): VerificationResult {
  const allText = [
    report?.overview ?? '',
    ...((report?.sections ?? []).map(s => `${s.title ?? ''} ${s.content ?? ''}`)),
    ...((report?.actions?.immediate ?? [])),
    ...((report?.actions?.shortTerm ?? [])),
    ...((report?.actions?.longTerm ?? [])),
    ...((report?.monitoring ?? [])),
    report?.conclusion ?? '',
  ].filter(Boolean).join('\n');

  const mismatches: string[] = [];
  let checked = 0;

  for (const h of hazards) {
    const label = severityLabel(h.severity);
    // 内核关键数值：优先取 value 与计算书中的数值
    const src = [h.value ?? '', ...((h.calc ?? []).map(c => `${c.detail ?? ''} ${c.formula ?? ''}`))].filter(Boolean).join(' ');
    const nums = Array.from(new Set(src.match(/\d+(?:\.\d+)?/g) ?? []))
      .filter(n => n.includes('.') || n.length >= 2)
      .filter(n => !VERIFY_IGNORE.has(n));
    const keyNums = nums.slice(0, 3);
    const typeMentioned = allText.includes(h.type);
    const citedAny = keyNums.some(n => allText.includes(n));

    if (keyNums.length === 0) {
      // 无内核数值可核对：检查风险项是否被报告覆盖
      if (!typeMentioned) {
        mismatches.push(`${h.type}（${label}）：AI 报告未覆盖该项，已按计算内核结论补入处置建议。`);
      } else {
        checked++;
      }
    } else if (!citedAny && !typeMentioned) {
      mismatches.push(`${h.type}（${label}）：AI 报告未引用内核关键数值（${keyNums.join(' / ')}），已按计算内核结论复核。`);
    } else {
      checked++;
    }
  }

  return { consistent: mismatches.length === 0, checked, total: hazards.length, mismatches };
}

// ====================================================================
// P2-3 真实事故反例注入（knowledge-base/06-kb-data/incident-anti-examples.ts）
// 12 条反例来自 incidents.json 的 5-Why 蒸馏 + standards_violated
// 命中规则：AI 报告提到 triggerKeywords 但未提及 mustIncludeNegativeSignals
//   → 追加"历史事故警示"到结论，强制把 lessons_learned 注入处置建议
// ====================================================================
import { INCIDENT_ANTI_EXAMPLES } from '../knowledge-base/06-kb-data/incident-anti-examples';
import { INCIDENT_ANTI_EXAMPLES_BATCH2 } from '../knowledge-base/06-kb-data/incident-anti-examples-batch2';

export interface IncidentMismatch {
  hazard: string;
  field: string;
  expected: string;
  reported: string;
  action: string;
  severity: string;
  incidentId: string;
  title: string;
}

function enrichWithIncidentLessons(report: DetailedReport, aiText: string): IncidentMismatch[] {
  const out: IncidentMismatch[] = [];
  for (const ex of [...INCIDENT_ANTI_EXAMPLES, ...INCIDENT_ANTI_EXAMPLES_BATCH2]) {
    const hits = ex.triggerKeywords.some(kw => aiText.includes(kw));
    if (!hits) continue;
    // 命中规则：触发关键词匹配即追加（即使 AI 已部分提及事故警示，也强制补全 5-Why 教训）
    //   反例集的价值在于"添加强制性 lessons_learned"，而非"挑刺 AI 没提到"
    out.push({
      hazard: ex.hazard,
      field: ex.field,
      expected: ex.expected,
      reported: '系统检测到与历史事故强相关场景，强制追加事故教训',
      action: ex.action,
      severity: ex.severity,
      incidentId: ex.incidentId,
      title: ex.title,
    });
  }
  if (out.length > 0) {
    console.log(`[incident-debug] matched ${out.length} of ${INCIDENT_ANTI_EXAMPLES.length + INCIDENT_ANTI_EXAMPLES_BATCH2.length} anti-examples:`, out.map(o => o.incidentId).join(', '));
  }
  return out;
}

/** 总入口 */
export async function runDiagnosis(
  input: any,
  models: string[],
  apiKey: string,
  baseUrl: string,
  detail?: DetailLevel,
): Promise<DiagnosisResult> {
  const { site, warnings } = parseSiteData(input);
  const hazards = evaluateHazards(site);
  const report = await callDeepSeekAdvice(site, hazards, models, apiKey, baseUrl, detail ?? 'detailed');

  // AI 纠偏：计算内核交叉复核（未引用内核数值/遗漏风险项 → 按内核结论兜底并写入报告）
  const verification = verifyReportAgainstKernel(report, hazards);
  if (verification.mismatches.length) {
    const note = '【系统纠偏 · 计算内核复核】\n' + verification.mismatches.map(m => '· ' + m).join('\n');
    report.conclusion = (report.conclusion ? report.conclusion + '\n\n' : '') + note;
    if (!report.actions.immediate.includes('按计算内核复核结论执行：' + verification.mismatches[0])) {
      report.actions.immediate.unshift('按计算内核复核结论执行，优先处置 ' + verification.mismatches.map(m => m.split('：')[0]).join('、') + '。');
    }
  }

  // P2-3 历史事故反例注入：AI 报告触发关键词但未引用事故 5-Why 警示 → 强制追加 lessons_learned
  const aiFullText = [
    report?.overview ?? '',
    ...((report?.sections ?? []).map(s => `${s.title ?? ''} ${s.content ?? ''}`)),
    ...((report?.actions?.immediate ?? [])),
    ...((report?.actions?.shortTerm ?? [])),
    ...((report?.actions?.longTerm ?? [])),
    ...((report?.monitoring ?? [])),
    report?.conclusion ?? '',
  ].join('\n');
  const incidentMismatches = enrichWithIncidentLessons(report, aiFullText);
  if (incidentMismatches.length) {
    const lessonNotes = incidentMismatches.map(m =>
      `· [${m.title}] ${m.expected}\n  强制措施：${m.action}`
    ).join('\n');
    const lessonTitle = `【系统反例警示 · ${incidentMismatches.length} 起历史事故教训】`;
    report.conclusion = (report.conclusion ? report.conclusion + '\n\n' : '') + lessonTitle + '\n' + lessonNotes;
    // 把每条事故的关键措施插入 immediate 列表（如尚未包含）
    for (const m of incidentMismatches) {
      const actionShort = m.action.split('；')[0]; // 取第一段
      if (actionShort && !report.actions.immediate.some(a => a.includes(m.incidentId))) {
        report.actions.immediate.unshift(`[${m.incidentId}] ${actionShort}`);
      }
    }
  }

  // 把反例警示挂到 verification.verification.mismatches（结构化字段）以便 UI 渲染
  const enrichedVerification = {
    consistent: verification.consistent && incidentMismatches.length === 0,
    checked: verification.checked,
    total: verification.total + incidentMismatches.length,
    mismatches: [
      ...verification.mismatches,
      ...incidentMismatches.map(m => `${m.title}（${m.hazard}）：${m.field}。AI 报告未引用事故根因警示，已按 lessons_learned 追加处置：${m.action.split('；')[0]}`),
    ],
    correctedAt: new Date().toISOString(),
    incidentLessons: incidentMismatches.map(m => ({ incidentId: m.incidentId, title: m.title, severity: m.severity, action: m.action })),
  } as any;

  const total = NUMERIC_FIELDS.length + 2; // 数值字段 + siteName + coverType
  const filled = NUMERIC_FIELDS.filter(f => typeof (site as any)[f] === 'number').length + (site.siteName ? 1 : 0) + (site.coverType ? 1 : 0);
  return {
    site,
    hazards,
    overallRisk: maxSeverity(hazards),
    report,
    dataCompleteness: Math.min(1, filled / total),
    verification: enrichedVerification as any,
    ...(warnings.length ? { warnings } as any : {}),
  } as DiagnosisResult;
}
