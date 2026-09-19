/**
 * 填埋场智能体专业知识库 · 精简索引版
 *
 * 来源：v7 单 HTML Demo（38 条 KB）已迁入 `server/kb.ts`，本文件保留：
 *   ① 诊断阈值表（确定性阈值评估）
 *   ② 7 类场景化建议模板（依工程阶段组织）
 *   ③ 与原 prompts.ts 兼容的精简专家术语词典（术语速查）
 *   ④ 给 Agent 的 systemPrompt 工具调用约定
 *
 * 设计：诊断引擎跑 `kb.ts.lookupKB()` 做条目命中，`SCENARIO_ADVICE` 做场景建议。
 */

// ============= 1. 诊断阈值表（确定性规则，prompt 注入） =============

export const EXPERT_KNOWLEDGE = {
  diagnosis: {
    // 注气相关
    injectionPressure: {
      low: { threshold: 2, unit: 'kPa', label: '低于有效驱替下限' },
      high: { threshold: 8, unit: 'kPa', label: '超过安全上限' },
      optimal: { min: 2, max: 8, unit: 'kPa', label: '有效驱动范围' },
    },
    // 含水率相关
    moistureContent: {
      target: { threshold: 30, unit: '%', label: '高效筛分阈值' },
      excavation: { threshold: 40, unit: '%', label: '可开挖阈值' },
    },
    // 井间距
    wellSpacing: {
      optimal: { target: 12, unit: 'm', label: '推荐井距' },
      max: { threshold: 15, unit: 'm', label: '最大井距' },
    },
    // 分段参数
    segmentLength: {
      optimal: { target: 2, unit: 'm', label: '推荐分段长度' },
    },
    // 处理周期
    segmentDays: {
      optimal: { target: 4, unit: '天', label: '每段处理天数' },
    },
    // 堆体稳定安全系数
    stabilityFactor: {
      // 分工况阈值
      operating: { threshold: 1.30, label: '运行工况', cite: 'CJJ 176-2012 §4.5' },
      seismic: { threshold: 1.15, label: '地震工况', cite: 'GB 50011-2010' },
      longTerm: { threshold: 1.20, label: '长期工况', cite: 'GB 50330-2013' },
      temporary: { threshold: 1.15, label: '临时开挖', cite: 'JGJ 120-2012' },
      // 细分行动阈值
      actions: {
        safe: { min: 1.50, label: '安全', action: '常规监测', color: 'green' },
        acceptable: { min: 1.30, label: '可接受', action: '加密监测，排查隐患', color: 'blue' },
        marginal: { min: 1.15, label: '临界', action: '限制荷载，准备加固方案', color: 'yellow' },
        unsafe: { min: 1.0, label: '不安全', action: '立即卸载，启动加固', color: 'orange' },
        failure: { max: 1.0, label: '失稳', action: '紧急撤离，抢险加固', color: 'red' },
      },
    },
    // 甲烷浓度
    methane: {
      // 浓度分级（体积百分比）
      levels: {
        normal: { max: 0.5, label: '正常', color: 'green', action: '常规监测' },
        attention: { max: 1.0, label: '关注', color: 'blue', action: '加密监测频次，排查泄漏源' },
        warning: { max: 2.5, label: '预警', color: 'yellow', action: '启动通风，限制火源，人员佩戴报警仪' },
        alarm: { max: 5.0, label: '报警', color: 'orange', action: '停止作业，撤离非必要人员，启动应急抽气' },
        danger: { max: 15.0, label: '危险', color: 'red', action: '全员撤离，断电，禁止一切火源' },
        explosive: { min: 15.0, label: '爆炸风险', color: 'red', action: '立即撤离至安全距离，启动应急预案' },
      },
      // 场景区分
      scenarios: {
        coverOuter: { limit: 5.0, cite: 'GB 16889-2008 §6.1', label: '覆盖层外' },
        workface: { limit: 1.25, cite: 'GB 16889-2008 §6.1', label: '作业面' },
        building: { limit: 0.5, cite: 'GB 50016-2014 §5.4', label: '建筑内' },
        tunnel: { limit: 0.5, cite: 'CJJ 176-2012 §6.3', label: '管廊/隧道' },
      },
      // 趋势预警（ppm/天）
      trend: {
        rapidRise: { rate: 50, label: '快速上升', action: '立即排查泄漏源' },
      },
      // 保留原有字段以兼容
      explosiveLow: { threshold: 5, unit: '%', label: '爆炸下限 LEL' },
      explosiveHigh: { threshold: 15, unit: '%', label: '爆炸上限 UEL' },
      coverLimit: { threshold: 5, unit: '%', label: '覆盖层外限值' },
      workfaceLimit: { threshold: 1.25, unit: '%', label: '作业面限值' },
      buildingLimit: { threshold: 0.5, unit: '%', label: '建筑内限值' },
    },
    // 渗滤液排放标准（GB 16889-2008 表 2）
    leachateEffluent: {
      // 分级排放标准（GB 16889-2008 表 2 vs 表 3）
      table2: { // 一般地区
        COD: { threshold: 100, unit: 'mg/L', label: 'COD' },
        BOD5: { threshold: 30, unit: 'mg/L', label: 'BOD₅' },
        NH3N: { threshold: 25, unit: 'mg/L', label: '氨氮' },
        TN: { threshold: 40, unit: 'mg/L', label: '总氮' },
        SS: { threshold: 30, unit: 'mg/L', label: 'SS' },
        pH: { min: 6, max: 9, label: 'pH 6~9' },
      },
      table3: { // 敏感地区（更严格）
        COD: { threshold: 60, unit: 'mg/L', label: 'COD' },
        BOD5: { threshold: 20, unit: 'mg/L', label: 'BOD₅' },
        NH3N: { threshold: 8, unit: 'mg/L', label: '氨氮' },
        TN: { threshold: 20, unit: 'mg/L', label: '总氮' },
        SS: { threshold: 30, unit: 'mg/L', label: 'SS' },
        pH: { min: 6, max: 9, label: 'pH 6~9' },
      },
      // 2024 征求意见稿拟收紧值
      draft2024: {
        COD: { threshold: 80, unit: 'mg/L', label: 'COD' },
        PFOS: { threshold: 0.00004, unit: 'mg/L', label: '全氟辛烷磺酸' },
        PFOA: { threshold: 0.0004, unit: 'mg/L', label: '全氟辛酸' },
      },
      // 处理工艺推荐阈值
      treatmentTrigger: {
        COD: { threshold: 500, unit: 'mg/L', advice: '建议纳滤+反渗透' },
        NH3N: { threshold: 50, unit: 'mg/L', advice: '建议吹脱+生物脱氮' },
      },
      // 保留原有字段以兼容
      COD: { threshold: 100, unit: 'mg/L', label: 'COD' },
      BOD5: { threshold: 30, unit: 'mg/L', label: 'BOD₅' },
      NH3N: { threshold: 25, unit: 'mg/L', label: '氨氮' },
      TN: { threshold: 40, unit: 'mg/L', label: '总氮' },
      SS: { threshold: 30, unit: 'mg/L', label: 'SS' },
      pH: { min: 6, max: 9, label: 'pH 6~9' },
    },
    // 地下水水质（GB/T 14848-2017 Ⅲ类）
    gwQuality: {
      // GB/T 14848-2017 分级
      levels: {
        I: { label: '优良', color: 'green', description: '可直接饮用' },
        II: { label: '良好', color: 'blue', description: '可直接饮用' },
        III: { label: '较好', color: 'blue', description: '处理后可饮用' },
        IV: { label: '较差', color: 'yellow', description: '不可饮用，农业灌溉' },
        V: { label: '极差', color: 'red', description: '不可直接接触' },
      },
      // Ⅲ类标准限值（常用水质评价基准）
      classIII: {
        pH: { min: 6.5, max: 8.5, label: 'pH' },
        hardness: { threshold: 450, unit: 'mg/L', label: '总硬度' },
        nitrate: { threshold: 20, unit: 'mg/L', label: '硝酸盐' },
        fluoride: { threshold: 1.0, unit: 'mg/L', label: '氟化物' },
        arsenic: { threshold: 0.01, unit: 'mg/L', label: '砷' },
        lead: { threshold: 0.01, unit: 'mg/L', label: '铅' },
        cadmium: { threshold: 0.005, unit: 'mg/L', label: '镉' },
        chromium6: { threshold: 0.05, unit: 'mg/L', label: '六价铬' },
      },
      // 污染判定倍数
      pollutionThreshold: {
        minor: { multiplier: 1.5, label: '轻微超标' },
        moderate: { multiplier: 3, label: '中度超标' },
        severe: { multiplier: 10, label: '严重超标' },
      },
      // 保留原有字段
      pH: { min: 6.5, max: 8.5 },
      hardness: { threshold: 450, unit: 'mg/L' },
      nitrate: { threshold: 20, unit: 'mg/L' },
      fluoride: { threshold: 1.0, unit: 'mg/L' },
    },
    // 土壤筛选值（GB 36600-2018 一类用地，mg/kg）
    soilScreen1: {
      As: { screen: 20, control: 120 },
      Cd: { screen: 20, control: 47 },
      Pb: { screen: 400, control: 800 },
      Hg: { screen: 8, control: 33 },
      Ni: { screen: 150, control: 600 },
      benzene: { screen: 1.0, control: 10 },
    },
    // 健康风险（HJ 25.3 附录 / USEPA RAGS）
    healthRisk: {
      carcinogenic: { threshold: 1e-6, label: '致癌风险 R ≤ 1×10⁻⁶' },
      nonCarcinogenic: { threshold: 1, label: '非致癌 HQ ≤ 1' },
    },
  },

  // ============= 风险类型（与 KB.m6 / m62 中的 riskTypes 对应） =============

  riskTypes: [
    {
      type: '注气压力异常',
      mechanism: '压力过低(<2kPa)无法克服毛细阻力驱替；压力过高(>8kPa)可能超过上覆压力导致堆体隆起',
      advice: '调整注气压力至2-8kPa范围；检查井结构密封性',
    },
    {
      type: '气体短路逸散',
      mechanism: '气体沿浅层优势通道（高渗区）溜走，深层（>6m）低渗区无法被有效驱动',
      advice: '采用分段式循环抽注气工艺，逐段处理；优化分段长度和顺序',
    },
    {
      type: '深层驱水效率低',
      mechanism: '6-8m深层垃圾含水率驱替效果差于浅层（2-4m），大孔隙先排水后形成低渗区',
      advice: '增加处理周期；采用强曝气配合；评估是否需要辅助降水措施',
    },
    {
      type: '井间驱水不均',
      mechanism: '井间距过大导致驱水盲区，六角形布井比方形效率高约40%',
      advice: '优化井间距至10-15m；优先采用六角形/梅花形布井',
    },
  ],
} as const;

// ============= 1.1 关键阈值速查（精简 JSON，给 Agent systemPrompt 末尾注入） =============
// 设计动机：MA_SYSTEM_PROMPTS 历史只串了 MA_COMMON_RULES，LLM 凭印象写阈值表是幻觉源头；
// 这里把 EXPERT_KNOWLEDGE.diagnosis 各项核心阈值压成 ~1.2KB JSON 单行字符串，
// 直接拼到每个 agent 的 systemPrompt 末尾，约束 LLM 引用"标准号 + 具体数值"。
export const KEY_THRESHOLDS_JSON = JSON.stringify({
  stable: {
    operating: 'Fs≥1.30（CJJ 176-2012 §4.5 运行工况）',
    seismic: 'Fs≥1.15（GB 50011-2010 地震工况）',
    longTerm: 'Fs≥1.20（GB 50330-2013 长期工况）',
    temporary: 'Fs≥1.15（JGJ 120-2012 临时开挖）',
  },
  methane: {
    coverOuter: '≤5.0%vol（GB 16889-2008 §6.1 覆盖层外）',
    workface: '≤1.25%vol（GB 16889-2008 §6.1 作业面）',
    building: '≤0.5%vol（GB 50016-2014 §5.4 建筑内）',
    tunnel: '≤0.5%vol（CJJ 176-2012 §6.3 管廊/隧道）',
    alarmLEL: '25%LEL（≈1.25%vol 体积浓度）',
    explosiveRange: '5%~15%vol（爆炸下限~上限）',
  },
  leachateTable2: {
    COD: '≤100 mg/L', BOD5: '≤30 mg/L', NH3N: '≤25 mg/L',
    TN: '≤40 mg/L', SS: '≤30 mg/L', pH: '6~9',
    cite: 'GB 16889-2008 表 2（一般地区）',
  },
  gwClassIII: {
    pH: '6.5~8.5', hardness: '≤450 mg/L', nitrate: '≤20 mg/L',
    fluoride: '≤1.0 mg/L', arsenic: '≤0.01 mg/L',
    lead: '≤0.01 mg/L', chromium6: '≤0.05 mg/L',
    cite: 'GB/T 14848-2017 Ⅲ类',
  },
  injection: {
    pressure: '2~8 kPa（最佳 2~4 kPa）',
    wellSpacing: '10~15 m（六角形/梅花形 D=√3·R_eff）',
    segmentLen: '2 m/段（自上而下）',
    targetMoisture: '≤30%（滚筒筛）/ ≤40%（可开挖）',
    injectPumpingRatio: '注抽比 1:1.1~1.5',
  },
  liner: {
    hdpe: '≥1.5 mm（GB 16889-2008 §5.1）',
    k_eq: '≤1×10⁻⁹ cm/s（复合衬垫等效）',
    clay: 'k≤10⁻⁷ cm/s（天然衬里包气带）',
    sigma: '≥27 MPa；ε≥700%',
  },
  soilScreen1: {
    As: '筛选 20 / 管制 120 mg/kg',
    Cd: '筛选 20 / 管制 47',
    Pb: '筛选 400 / 管制 800',
    Hg: '筛选 8 / 管制 33',
    Ni: '筛选 150 / 管制 600',
    benzene: '筛选 1.0 / 管制 10',
    cite: 'GB 36600-2018 一类用地',
  },
  healthRisk: {
    carcinogenic: 'R ≤ 1×10⁻⁶（HJ 25.3 致癌风险）',
    nonCarcinogenic: 'HQ ≤ 1（非致癌风险）',
  },
});

// ============= 2. 7 类场景化建议（与 KB.m6 / m62 对齐） =============

export const SCENARIO_ADVICE = {
  /** 场景 1：选址核查 */
  siteSelect: {
    goal: '满足 GB 16889 / CJJ 176 选址硬约束，避开敏感目标',
    steps: [
      '1. 距离核查：与饮用水源地≥2000m、与居民区≥800m（HJ 25.1 环评）',
      '2. 库容核查：≥50万 m³ 且使用年限≥10年（GB 16889 §4）',
      '3. 地质核查：避开活动断层、岩溶发育区、地下水补给区',
      '4. 天然衬里：包气带 k≤10⁻⁷ cm/s（GB 16889 §4）',
      '5. 抗震核查：基本烈度Ⅵ度以上须抗震设防',
    ],
    keyMetrics: ['距离', '库容', '渗透系数', '抗震烈度'],
  },

  /** 场景 2：开挖筛分前预处理（基于注气驱水研究） */
  beforeExcavation: {
    goal: '将垃圾含水率降至 30% 以下（滚筒筛高效运行阈值）',
    steps: [
      '1. 场地勘察：确定垃圾分布、龄期、含水率初始值',
      '2. 布井设计：按 10-15m 井距、六角形/梅花形布井（D=√3·R_eff）',
      '3. 分段施工：每 2m 一段，自上而下处理（克服气体短路）',
      '4. 参数控制：注气压力 2-8kPa（最优 2-4kPa），注抽比 1:1.1-1.5',
      '5. 监测调整：每段 3-4 天，根据含水率调整',
    ],
    keyMetrics: ['含水率', '注气压力', '抽气负压', '处理时间'],
  },

  /** 场景 3：存量垃圾开采 */
  mining: {
    goal: '安全、高效开采存量垃圾',
    steps: [
      '1. 稳定性评估：堆体稳定安全系数 Fs≥1.30（运行）/1.15（地震）',
      '2. 降水预处理：水位降至安全深度，避免滑裂',
      '3. 边坡防护：控制暴露面积和坡比（≥1:3）',
      '4. 臭气控制：负压抽气（≥20m³/min）+生物滤池',
      '5. 分区开采：从主导风向侧开始，控制单元作业≤5000m²、高≤5m',
    ],
    keyMetrics: ['稳定安全系数', '水位', '暴露面积', '臭气浓度'],
  },

  /** 场景 4：老旧填埋场封场 */
  closure: {
    goal: '达标封场 + 长期稳定',
    steps: [
      '1. 现状调查：评估剩余库容、渗漏风险（衬垫电学检测）',
      '2. 堆体整形：边坡整形、压实（双曲线法预测沉降）',
      '3. 防渗系统：HDPE 膜 ≥1.5mm + GCL 或 ≥60cm 压实黏土（k≤10⁻⁷）',
      '4. 气体收集：导排井+燃烧/利用（LandGEM 估算产气量）',
      '5. 封场覆盖：植被30cm+保护30cm+排水30cm+防渗+排气30cm（多层）',
      '6. 验收：编制《封场方案》（提前1年）→报批→专家组验收→发证',
    ],
    keyMetrics: ['沉降速率', '渗滤液量', 'CH₄产气量', '边坡稳定性'],
  },

  /** 场景 5：封场后长期监测 LTM */
  ltm: {
    goal: '封场后 ≥30 年长期监测 + 维护基金',
    steps: [
      '1. 监测井布设：≥3 井（上下游均有），分层成井',
      '2. 监测项 5 类：渗滤液/地下水/填埋气/沉降/地表水',
      '3. 频率：前 5 年强化（第1年季度、第2-3年半年、4-5年年度），后25年每5年1次',
      '4. 维护基金：按封场投资 10~15% 计提',
      '5. 趋势分析：M-K + Sen slope；≥3~5 年达标方可申请闭场',
    ],
    keyMetrics: ['监测井数', '采样频率', '趋势斜率', '维护基金'],
  },

  /** 场景 6：污染场地修复（地下水/土壤） */
  remediation: {
    goal: 'HJ 25.6 / HJ 25.3 修复达标（GB 36600 / GB/T 14848 Ⅲ类）',
    steps: [
      '1. CSM 建立：源-径-受三要素+地质/水文/迁移参数（HJ 25.1）',
      '2. 调查分阶段：初查（沿流向3井）→详查（网格30~100m）→边界井（HJ 25.2）',
      '3. 修复技术比选：ISCO（5类药剂）/ PRB（ZVI墙）/ SVE（VOC）/ MNA（自然衰减）/ 抽提回灌',
      '4. 健康风险评估：四步法（HJ 25.3 附录），致癌 R≤10⁻⁶、非致癌 HQ≤1',
      '5. LTM：修复后≥3~5 年达标方可闭场（HJ 25.4）',
    ],
    keyMetrics: ['风险商 HQ', '致癌风险 R', '衰减半衰期 t½', 'PRB 厚度 b'],
  },

  /** 场景 7：应急响应（漏失 / 火灾 / 恶臭） */
  emergency: {
    goal: '衬垫破损漏失 / 阴燃火灾 / 恶臭投诉的应急处置',
    steps: [
      '1. 漏失应急四步：切断进料→监测井加密（30~50m）→抽提回灌→HJ 25 系列联动',
      '2. 阴燃火灾：注水浸没 7~14d + 注浆封堵 + 压实覆盖；500m 警戒',
      '3. 恶臭投诉：24h 现场核实 / 3d 书面回复；负压抽气≥20m³/min + 喷除臭剂',
      '4. 事故报告：向生态环境、住建部门报告，配合 HJ 25.1 调查',
      '5. 恢复评估：开挖检查阴燃范围，重做覆盖与气体收集',
    ],
    keyMetrics: ['监测井距', '注水天数', '警戒距离', '报告时限'],
  },
} as const;

/** 把 SCENARIO_ADVICE 子项格式化为可注入 user prompt 的纯文本段落（约 300~500 字） */
function adviceToString(a: { goal: string; steps: readonly string[]; keyMetrics: readonly string[] }): string {
  return [
    '【场景化建议】',
    `目标：${a.goal}`,
    '步骤：',
    ...a.steps,
    `关键指标：${a.keyMetrics.join('、')}`,
  ].join('\n');
}

/**
 * 按场景原文关键词路由到最相关的 SCENARIO_ADVICE 段落
 * 设计：multiagent 入口调用一次，按用户问题语义挑一条注入到对应 agent 的 user prompt，
 * 避免一次性把全部场景建议塞给 LLM（节省 token & 减少幻觉）
 */
export function pickScenarioAdvice(scenario: string): string {
  const t = scenario || '';
  // 应急（最高优先：阴燃/火灾/恶臭/漏失/抢险）
  if (/(应急|阴燃|火灾|恶臭|漏失|泄漏|抢险|疏散)/.test(t)) return adviceToString(SCENARIO_ADVICE.emergency);
  // 修复（污染场地/ISCO/PRB/SVE/MNA/HJ 25 系列）
  if (/(修复|污染场地|异位|原位|ISCO|PRB|SVE|MNA|HJ\s*25\.6|HJ\s*25\.4)/.test(t)) return adviceToString(SCENARIO_ADVICE.remediation);
  // 封场
  if (/(封场|终场|封场方案)/.test(t)) return adviceToString(SCENARIO_ADVICE.closure);
  // 长期监测
  if (/(长期监测|LTM|闭场后|维护基金)/.test(t)) return adviceToString(SCENARIO_ADVICE.ltm);
  // 存量开采
  if (/(开采|存量|mining|存量垃圾)/.test(t)) return adviceToString(SCENARIO_ADVICE.mining);
  // 选址
  if (/(选址|场址选择|新场|拟建)/.test(t)) return adviceToString(SCENARIO_ADVICE.siteSelect);
  // 开挖筛分 / 注气驱水（命中关键词）
  if (/(开挖|筛分|注气|驱水|驱替|分段|滚筒筛|预处理)/.test(t)) return adviceToString(SCENARIO_ADVICE.beforeExcavation);
  // 兜底：当前 4 类 Agent 多对应"运营期填埋场综合诊断"语义，回退 beforeExcavation 通用流程
  return adviceToString(SCENARIO_ADVICE.beforeExcavation);
}

// ============= 3. 精简专家术语词典（给 Agent prompt 注入） =============

export const EXPERT_GLOSSARY: Record<string, string> = {
  // 核心概念
  '注气驱水': '往填埋场垃圾堆体里注入气体（空气），用气体把孔隙里的水"顶"出来、降低含水率，让垃圾变干，好筛分、少臭气。目标：质量含水率从初始50%~65%降至≤30%。',
  '分段式循环抽注气': '把一口井的处理深度切成若干段（如每2m一段），从深层往浅层逐段"下部注气+上部同步抽气"，形成局部循环气流，强迫气体覆盖低渗区、避免沿浅层"近道"溜走。推荐工艺：分段2m、自上而下、≤4kPa、每段3~4天、井距10~15m。',
  '双孔隙度': '垃圾裂隙+基质双套孔隙致持水曲线双峰，是驱水效率的物质基础。大孔隙（裂隙）排水快，小孔隙（基质）排水慢，形成双峰特征。',
  '气体短路逸散': '气体沿浅层优势通道溜走、深层不动，是全段式注气的致命缺陷。分段工艺正是为克服它而设计。',
  '有效影响半径': '以含水率降至40%的边界定义有效影响半径R_eff。井距设计依据：D=√3·R_eff（梅花形布井）。',
  'CSM': '场地概念模型 = 源(Source)→迁移路径(Pathway)→受体(Receptor) 的完整链路，HJ 25.1 调查的灵魂图。',
  'DRASTIC': '地下水脆弱性 7 因子加权打分（D5/R4/A3/S2/T1/I5/C3），>150 为高脆弱区。',
  'PRB': '可渗透反应墙——垂直流向地下挖沟填 ZVI 零价铁，水流过墙体被还原脱氯（如 TCE→乙烯）。墙厚 0.5~2m、寿命 10~30 年。',
  'SVE': '土壤气相抽提——往包气带打井抽气把 VOC 带出来。要求：亨利常数>0.01、渗透率>10⁻¹³ m²、包气带>1m。',
  'ISCO': '原位化学氧化——5 大药剂：过硫酸盐/芬顿/高锰酸盐/臭氧/过氧化钙。先做 SOD 土柱实验再定药量。',
  'MNA': '监控自然衰减——三要素：≥2年 M-K 趋势下降 + 衰减机制明确 + 受体保护。不适合 NAPL 源区。',
  'LTM': '长期监测——封场后≥30 年（重点污染源）；修复后≥3~5 年达标方可闭场。',
  'HELP模型': '美国 EPA 水量平衡模型，用于估算填埋场渗滤液产量（mm/a）。',
  'LandGEM': '美国 EPA 填埋气产气一阶衰减模型：Q(t)=k·L₀·M·exp(−k·t)。',
  'BISHOP法': '简化 Bishop 条分法——堆体稳定 Fs 验算的常用方法。Fs<1.30 须加固。',

  // 关键参数
  '注气压力': '注气压力上限≤8kPa（防止超过上覆压力导致堆体隆起），下限≥2kPa才能克服毛细阻力有效驱替（垃圾进气值约0.1~0.5kPa）。',
  '目标含水率': '质量含水率≤30%（滚筒筛高效运行阈值），体积含水率降至40%定义为"可开挖阈值"。',
  '孔隙气压衰减': '孔隙气压径向衰减率1.2kPa/m（峰值态）、0.8kPa/m（稳态）；深层孔隙气压低于浅层。',

  // 工艺参数
  '注抽比': '注抽流量比1:1.1~1:1.5（保持系统微负压）；抽气负压=注气压力×0.6~0.8。',
  '间歇曝气': '每天2~4h间歇曝气比连续曝气：VOC排放-63%，能耗-80%。交替厌氧-缺氧-好氧条件，菌群多样性高于纯好氧。',

  // 井结构
  '循环抽注井': '同轴双通道井的硬件设计：内管注气+环空抽气+筛管+封隔器，一口井同时注抽。分段式高压注气端头（上/下密封器+中部开孔管）把各段封住。',
};

/**
 * 口语化术语翻译提示（注入 /api/chat 的 RAG 增强末尾）
 * 设计：现场用户常用"瓦斯/沼液/污油"等口语术语，LLM 应当自动映射到规范表述"甲烷/渗滤液/渗漏油"等，
 * 这里给一个轻量提示串，避免把整个 16 项 GLOSSARY 都塞进上下文（节省 token）
 */
export const EXPERT_GLOSSARY_HINT =
  '【术语提示】用户可能使用口语化术语（如"瓦斯/沼液/渗油/渗漏油"），请在解释时自动翻译为规范表述（"甲烷/渗滤液/渗漏"等），保持专业性。';

// ============= 4. Agent 工具调用约定（systemPrompt 注入） =============

export const AGENT_TOOL_USAGE = `
【重要工具约定】

你（工程科研助手）有以下工具可用：

1. \`kb_lookup(query: string, topK?: number)\`
   - 用途：在 50 条规范知识库（GB 16889 / CJJ 176 / HJ 25 系列 / HJ 1106 / GB 36600 / GB/T 14848 / GB 55038 / AQ 4202 等 30+ 本规范）中按关键词检索
   - **何时必须调用**：用户问题涉及规范条文、阈值、限值、条款编号时
   - 返回：topK 条 KB 条目（含规范编号、条款摘要、专业表述、平易表述）

2. \`calculate(name: string, params: Record<string, number | string>)\`
   - 可用计算器（12 项，对应 KB 中的 calc 字段）：
     - slopeFs / calculateStabilityFactor  —— 堆体稳定 Fs（圆弧法简化）
     - injectR / calculateEffectiveRadius  —— 注气驱替半径（经验式）
     - leachateCalc / calculateLeachate   —— 渗滤液产量（HELP 简化）
     - lfgYield / calculateGasProduction   —— 填埋气产气量（LandGEM）
     - wellR                              —— 循环井影响半径
     - advect                             —— 污染物对流—弥散浓度
     - soilScreen                         —— 土壤筛选值/管制值（GB 36600）
     - decayCalc                          —— 衰减半衰期与达标年限
     - linerKeq                           —— 复合衬垫等效渗透系数验算
     - hdpeCheck                          —— HDPE 膜厚度与焊缝验算
     - settlementHyper                    —— 沉降双曲线预测
     - capacity                           —— 库容与使用年限
   - **何时必须调用**：用户问题涉及数值计算、参数验算、安全系数评估时

3. \`run_diagnosis(siteData)\`
   - 用途：对填埋场/地基隐患做"双引擎"诊断（确定性阈值 + LLM 解释）
   - 输入：SiteData 对象（含 land 长宽高、井、水位、沉降、H2S、CH4 等）
   - 返回：hazards[]、overallRisk、priorityActions[]

4. \`buildScene(intent: { kind: 'preset' | 'custom' | 'natural', key?: string, geo?: object, text?: string })\`
   - 用途：**3D 场景生成**。用户要求"建/生成/创建 3D 场景、填埋场模型、调整堆体/坝/井/池参数"时调用
   - intent.kind：'preset'（key 填 small/large）/'custom'（geo 填 GeoParams 子集）/'natural'（text 填自然语言，如"缓坡山谷型 500 万 m³ 的填埋场"，推荐）
   - **何时必须调用**：用户表达建场意图（含"建/生成/改 3D、堆体、库容、坝、山谷"等词）时
   - 联动：用户同时要求产气/沉降/降解模拟时，intent 同级加 injectOgs=true 与 ogsScenario='gas-production'|'settlement'|'degradation'

【铁律】
- 涉及规范条文编号（如 GB 16889 §5.1）必须调用 \`kb_lookup\` 获取，禁止凭空捏造
- 涉及数值（Fs / k_eq / 产气量 / 沉降）必须调用对应 \`calculate\`，禁止估算后写为"约 X"
- 工具结果以引用卡片呈现给用户（系统已配置 ToolCallsCollapse 组件）
- 规范引用必标版本年号（GB 16889-2008，不是 GB 16889）
- 心理/权益类问题须"人文兜底+转专业机构"，本系统不替代心理/法律咨询
`;

/* ==================== 多智能体专家角色 prompts ====================
 * 供 server/multiagent.ts 使用。共性约束（MA_COMMON_RULES）：
 * 中文、结论先行、字数控制、规范只写"标准号+要点精神"不编造条款号、
 * 给定的确定性风险等级由计算内核得出——不得推翻，只能解释与展开。
 */
export const MA_COMMON_RULES = `
【输出规则】
- 中文回答，纯文本分段（小节之间用空行分隔），不要 JSON / Markdown 代码块 / 加粗标题
- 结论先行，逐项展开；引用给定数据与计算内核结果，不得另造数字
- 引用规范只写"标准号 + 要点精神"（如"CJJ 176 对运行期堆体稳定安全系数的要求"），不得编造具体条款号
- 如需引用规范阈值（Fs、k_eq、CH₄ 限值、COD 排放、Ⅲ类地下水限值等），请优先使用【关键阈值速查】表中的具体数值与条款号，与计算内核保持一致
- 给定的确定性风险等级由工程计算内核得出，不得推翻，只能解释、展开并给出措施
- 严格按以下五个小节输出，每节用「标题」行引导：
  「结论」一句话定性（含风险等级与核心判定）
  「计算依据」引用计算参数/公式/结果
  「风险机理」成因机制与可能后果
  「处置建议」分「立即 / 短期 / 长期」三条
  「规范依据」相关标准要点
`;

export const MA_SYSTEM_PROMPTS: Record<string, string> = {
  slope: `你是填埋场堆体边坡稳定专家，深耕环境岩土工程。
基于用户给出的场景、指标提取、计算内核输出的稳定安全系数 Fs 与确定性风险等级，输出详实专业分析：
判定 Fs 是否满足 CJJ 176 对运行期堆体稳定安全系数的要求；量化主控因素（渗滤液水位抬升 / 堆体裂缝 / 坡比）；给出分级处置措施（立即控制填埋高度、加强地表水导排、加密位移监测等）。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES}

【关键阈值速查】
${KEY_THRESHOLDS_JSON}`,

  leachate: `你是填埋场渗滤液导排与水量平衡专家。
基于用户给出的场景、渗滤液液位变化、日产渗滤液估算及确定性风险等级，输出详实专业分析：
评估导排系统负荷与堵塞风险；按 GB 16889 对渗滤液液位管理的要求精神给出判断；给出排查导排管路、增设应急抽排井、雨污分流复核等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES}

【关键阈值速查】
${KEY_THRESHOLDS_JSON}`,

  lfg: `你是填埋气收集与安全专家。
基于用户给出的场景、甲烷浓度（%LEL，相对爆炸下限的百分比）、产气量估算与确定性风险等级，输出详实专业分析：
注意区分 %LEL 与体积浓度（25% LEL 为常用报警值，5% vol 为爆炸下限），不得混淆；给出强制启动集气系统、禁止明火作业、场界 CH4 监测等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES}

【关键阈值速查】
${KEY_THRESHOLDS_JSON}`,

  gw: `你是地下水污染场地调查专家。
基于用户给出的场景、Cl- 实测值与背景值、对流弥散预测结果与确定性风险等级，输出详实专业分析：
对照 GB/T 14848 III 类标准（Cl- ≤250mg/L）判定超标；评估污染羽扩散范围；给出加密下游监测井、同位素/水化学溯源、必要时阻隔墙等分级措施。
全文 300~400 字，每节内容详实、可落地。${MA_COMMON_RULES}

【关键阈值速查】
${KEY_THRESHOLDS_JSON}`,

  summary: `你是总工程师，主持填埋场多维度综合风险评估。
基于用户给出的场景原文、四个专业 Agent 的结论与等级、以及计算内核给出的综合等级，输出详实综合报告：
综合等级必须与给定等级一致；按"滑坡 > 渗漏 > 甲烷 > 水质"的安全影响排序给出处置优先级；给出 72 小时内行动项；若某维度结论缺失，注明"该维度结论缺失"并基于场景自行补判。
按「综合结论 / 各维度研判 / 优先级排序 / 72h 行动项 / 长期监测」五节输出，全文 600~800 字。${MA_COMMON_RULES}

【关键阈值速查】
${KEY_THRESHOLDS_JSON}`,
};

export default {
  EXPERT_GLOSSARY,
  EXPERT_GLOSSARY_HINT,
  EXPERT_KNOWLEDGE,
  KEY_THRESHOLDS_JSON,
  SCENARIO_ADVICE,
  pickScenarioAdvice,
  AGENT_TOOL_USAGE,
  MA_SYSTEM_PROMPTS,
};
