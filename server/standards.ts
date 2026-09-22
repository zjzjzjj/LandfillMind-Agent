export const STANDARD_VERSIONS = {
  'GB 16889': {
    current: 'GB 16889-2008',
    upcoming: 'GB 16889-2024（征求意见稿）',
    title: '生活垃圾填埋场污染控制标准',
    changes: [
      '渗滤液 COD 排放限值从 100mg/L 收紧至 80mg/L',
      '新增全氟化合物（PFOS/PFOA）限值',
      '甲烷排放限值从 500ppm 收紧至 200ppm'
    ],
    affectedKBKeys: ['siteSelect', 'linerSystem', 'leachateEffluent', 'methane']
  },
  'CJJ 176': {
    current: 'CJJ 176-2012',
    title: '生活垃圾卫生填埋场岩土工程技术规范',
    // v5.5 修正：此前记为「已被 CJJ/T 273-2019 部分替代」——CJJ/T 273-2019 实为
    // 《橡胶沥青路面技术标准》，与填埋场无关，该替代关系系张冠李戴，已删除。
    // 本仓库全部计算器仍按 CJJ 176-2012 条款引用；其废止/替代状态需查住建部现行公告后再定。
    changes: [
      '边坡稳定性计算采用圆弧滑动法（瑞典法/Bishop 简化法）',
      '运行期 Fs≥1.30、地震工况 Fs≥1.15、封场后长期 Fs≥1.20'
    ],
    affectedKBKeys: ['stormwater', 'leachateTreatment', 'slopeStability']
  },
  'HJ 25': {
    current: 'HJ 25.1~25.4-2019、HJ 25.5-2018',
    title: '建设用地土壤污染状况调查/评估/修复系列标准',
    // 2019-12-05 第 52 号公告同批发布 25.1~25.4，全部现行并代替 2014 版；
    // HJ 25.6 是否存在及其年份在本仓库内说法不一（计算器引 25.6-2019，
    // 旧版登记表引 25.1~25.6-2014），引用前需核对正式文本。
    changes: [
      '细化调查评估流程',
      '更新风险评估模型（增加暴露途径）',
      '修复目标值计算方法调整'
    ],
    affectedKBKeys: ['siteSurvey', 'healthRisk', 'soilScreen1']
  },
  'GB 36600': {
    current: 'GB 36600-2018',
    title: '土壤环境质量 建设用地土壤污染风险管控标准',
    status: '现行有效'
  },
  'GB/T 14848': {
    current: 'GB/T 14848-2017',
    title: '地下水质量标准',
    status: '现行有效'
  }
} as const;

export type StandardKey = keyof typeof STANDARD_VERSIONS;

/** 获取规范的完整引用文本 */
export function getStandardCite(key: StandardKey, includeChanges: boolean = false): string {
  const std = STANDARD_VERSIONS[key];
  let cite = std.current;
  if ('upcoming' in std && std.upcoming) {
    cite += `（注：${std.upcoming} 拟修订）`;
  }
  if ('replaced' in std && std.replaced) {
    cite += `（已被 ${std.replaced} 部分替代）`;
  }
  return cite;
}

/** 检查某条 KB 是否涉及规范更新 */
export function getAffectedStandards(kbKey: string): string[] {
  const affected: string[] = [];
  Object.entries(STANDARD_VERSIONS).forEach(([stdKey, std]) => {
    if ((std as any).affectedKBKeys && Array.isArray((std as any).affectedKBKeys) && (std as any).affectedKBKeys.includes(kbKey)) {
      affected.push(stdKey);
    }
  });
  return affected;
}
