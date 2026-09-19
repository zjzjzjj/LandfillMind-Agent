/**
 * 常见误诊纠正 - 引导用户提供更准确的信息
 */

interface MisdiagnosisPattern {
  /** 用户可能说的话（正则） */
  pattern: RegExp;
  /** 可能的真实含义 */
  likelyMeaning: string;
  /** 引导用户澄清的问题 */
  clarifyingQuestion: string;
  /** 不同方向的后续引导 */
  followUp?: Record<string, string>;
}

export const COMMON_MISDIAGNOSIS: MisdiagnosisPattern[] = [
  {
    pattern: /地下水超标|地下水污染|地下水有问题/,
    likelyMeaning: '用户可能混淆了"地下水水质超标"和"渗滤液泄漏"',
    clarifyingQuestion: '您是指：\n① **地下水监测井水质超标**（需要排查防渗系统）\n还是\n② **渗滤液处理后排放超标**（需要检查处理工艺）\n\n两者原因和处理方式不同，请告诉我具体情况。',
    followUp: {
      '①': '地下水超标需排查：防渗系统完整性、渗漏检测、污染源控制。请提供超标指标和浓度。',
      '②': '渗滤液排放超标需检查：处理工艺运行状况、膜污染程度、药剂投加量。请提供 COD、氨氮等具体数值。',
    },
  },
  {
    pattern: /边坡不稳|滑坡风险|坡要塌/,
    likelyMeaning: '用户可能未区分"边坡变形"和"边坡失稳"',
    clarifyingQuestion: '您观察到的是：\n① **坡面裂缝/隆起等变形迹象**（现场巡查发现）\n还是\n② **安全系数 Fs 计算不足**（设计验算问题）\n\n请告诉我您手头有什么数据。',
    followUp: {
      '①': '坡面变形需：现场巡查记录、监测点加密、限制坡顶荷载。请提供裂缝位置、宽度、发展情况。',
      '②': 'Fs 不足需加固设计。请提供坡角、土体重度、黏聚力、内摩擦角等参数，我帮您计算。',
    },
  },
  {
    pattern: /甲烷超标|CH4超标|沼气太多/,
    likelyMeaning: '用户可能未说明是哪个场景的限值',
    clarifyingQuestion: '甲烷限值因场景不同：\n① **作业面** ≤ 1.25%（GB 16889-2008 §6.1）\n② **覆盖层外** ≤ 5%（GB 16889）\n③ **建筑内** ≤ 0.5%（GB 50016）\n\n您指的是哪个位置的浓度？',
    followUp: {
      '①': '作业面甲烷超标需：立即停止作业、强制通风、排查泄漏源。',
      '②': '覆盖层外超标需：检查覆盖层密封性、气体收集系统效率。',
      '③': '建筑内超标需：立即撤离、禁止火源、检查建筑防气措施。',
    },
  },
  {
    pattern: /渗滤液太多|液位太高|水排不出去/,
    likelyMeaning: '用户可能未区分"渗滤液液位"和"渗滤液产量"',
    clarifyingQuestion: '您说的是：\n① **堆体内渗滤液液位高**（导排系统不畅）\n还是\n② **渗滤液处理能力跟不上产量**（调节池满）\n\n两者的处理方式不同。',
    followUp: {
      '①': '液位高需检查：导排层淤堵、抽排井运行状况、地下水顶托。',
      '②': '处理能力不足需：优化工艺参数、增加处理设施、雨季应急调蓄。',
    },
  },
  {
    pattern: /沉降太大|地陷了|地面下沉/,
    likelyMeaning: '用户可能未说明沉降类型和速率',
    clarifyingQuestion: '沉降需要更多信息：\n① **瞬时沉降**（施工期快速沉降）\n② **主固结**（有机物降解导致）\n③ **次固结**（长期蠕变）\n\n请提供：当前沉降速率（mm/月）、堆体高度、填埋龄期。',
  },
];

/**
 * 检测用户输入是否匹配常见误诊模式
 * @param query 用户输入
 * @returns 匹配的纠正建议，或 null
 */
export function matchCorrection(query: string): MisdiagnosisPattern | null {
  for (const pattern of COMMON_MISDIAGNOSIS) {
    if (pattern.pattern.test(query)) {
      return pattern;
    }
  }
  return null;
}
