/**
 * LandfillMind · 真实事故反例集（Incident Anti-Examples）
 * 来源：knowledge-base/04-cases/incidents.json（15 起真实事故的 5-Why 根因蒸馏）
 * 用途：注入 verifyReportAgainstKernel，自动识别 AI 报告中"未提及历史教训"的高风险盲点
 *
 * 与现有 VerificationMismatch 字段对齐：
 *   { hazard, field, expected, reported, action }
 *   - hazard: 隐患类别（slope / leachate / lfg / gw / safety / operations）
 *   - field:  反例字段（如 "未提及Fs"、"未引用GB 14554"、"未强调PPE"）
 *   - expected: 反例警示（来自 5-Why 根因 + standards_violated）
 *   - reported: 占位（运行时检测报告是否缺失该字段）
 *   - action:  必须追加的处置建议（来自 lessons_learned + remediation_actions）
 */

export type IncidentHazardKey =
  | 'slope'        // 滑坡/边坡失稳
  | 'leachate'     // 渗滤液泄漏/超标
  | 'lfg'          // 填埋气爆炸/中毒
  | 'gw'           // 地下水污染
  | 'safety'       // 工友人身伤亡
  | 'operations'   // 作业违规/超库容
  | 'dam'          // 坝体/衬层失稳
  | 'cover'        // 覆盖/封场
  | 'compliance';  // 监管/许可缺失

export interface IncidentAntiExample {
  /** 引用自 incidents.json 的 ID，便于溯源 */
  incidentId: string;
  /** 简短标题（如 "深圳12·20滑坡"） */
  title: string;
  /** 类别键 */
  hazard: IncidentHazardKey;
  /** 触发关键词：检测 AI 报告是否命中相关话题 */
  triggerKeywords: string[];
  /** 必须命中的负面词（AI 若出现这些词说明已识别风险） */
  mustIncludeNegativeSignals?: string[];
  /** 反例字段名（用于 UI 展示） */
  field: string;
  /** 反例警示文本（来自 5-Why 蒸馏） */
  expected: string;
  /** 强制追加的处置建议（来自 lessons_learned 蒸馏） */
  action: string;
  /** 引用规范（用于显示在 UI） */
  citations: string[];
  /** 死亡/损失摘要 */
  severity: string;
}

export const INCIDENT_ANTI_EXAMPLES: IncidentAntiExample[] = [
  // ========== 1. 深圳 12·20 滑坡（73 死） ==========
  {
    incidentId: 'INC-2015-12-20-Shenzhen',
    title: '深圳光明新区"12·20"特别重大滑坡事故',
    hazard: 'slope',
    triggerKeywords: ['堆高', '堆填', '边坡', '稳定', '滑坡', '坡比', '马道'],
    field: '未提示"违规超高堆填"红线',
    expected: '深圳12·20 滑坡（73 死）：堆填体高度失控 + 含水量高 + 无支护 = 整体剪切破坏。运行期 Fs ≥ 1.30 是不可妥协的工程底线，违规堆填是滑坡的最常见根因。',
    action: '立即复核堆高是否超设计（堆高 > 30m 必须专项稳定性论证）；建立堆填速率红线（按月堆高 ≤ 5m 控制）；关键工况加密位移监测至 4h/次。',
    citations: ['GB 50421-2007', 'CJJ 17-2004 §3.0.1', '《安全生产法》§17'],
    severity: '73 死 / 直接经济损失 8.12 亿元',
  },

  // ========== 2. 杭州天子岭 H₂S 中毒（1 死 4 伤） ==========
  {
    incidentId: 'INC-2020-01-01-Hangzhou',
    title: '杭州天子岭"1·1"沼气窒息事故',
    hazard: 'lfg',
    triggerKeywords: ['甲烷', 'CH4', '硫化氢', 'H2S', '覆盖', '作业', '掀膜', '沼液', '调节池'],
    mustIncludeNegativeSignals: ['静风', '凌晨', '夜间', '凹地', '积聚'],
    field: '未警示"静风/夜间掀膜"的扩散条件风险',
    expected: '天子岭 1·1 事故：凌晨静风 + 凹地 + 掀开覆盖膜 = 高浓度填埋气瞬时释放致 1 死 4 伤。H₂S 在低浓度下麻痹嗅觉（越闻不到越危险），静风/夜间作业是填埋气积聚的典型条件。',
    action: '① 静风/夜间/雨后禁止掀膜作业；② 作业前 30min 内气体检测（CH₄ ≤ 1.25%、O₂ 19.5~21%、H₂S ≤ 10 mg/m³）；③ 必须配备正压式空气呼吸器；④ 现场监护人不得离开。',
    citations: ['GB 30871-2022', 'AQ 4202-2008', 'GBZ 2.1-2019', 'GB 14554-93'],
    severity: '1 死 4 伤 / 长期超负荷运行（峰值 10000 t/d vs 设计 3500 t/d）',
  },

  // ========== 3. 江门/南城/普洱等 H₂S 中毒系列 ==========
  {
    incidentId: 'INC-2018-04-Jiangmen',
    title: '广东江门"4·13"沼气中毒事故',
    hazard: 'safety',
    triggerKeywords: ['下井', '有限空间', '救援', '硫化氢', '盲目施救'],
    mustIncludeNegativeSignals: ['盲目', 'SCBA', '呼吸器'],
    field: '未强调"严禁盲目施救"',
    expected: '有限空间事故 60~80% 死亡由盲目施救导致。江门/南城/普洱/天子岭多起事故都是 1 人中毒 → 数人救援 → 全员死亡。救人者必须佩戴正压式空气呼吸器 + 救援三脚架 + 安全绳，否则会成为下一个遇难者。',
    action: '① 进入前 30 min 内强制气体检测；② 必须佩戴正压式 SCBA（不能用过滤式防毒面具替代）；③ 现场配备救援三脚架 + 安全绳；④ 监护人 + 应急救援装备就位；⑤ 严禁未经防护的盲目施救（GB 30871-2022）。',
    citations: ['GB 30871-2022', 'AQ 3021-2008', 'GBZ 2.1-2019'],
    severity: '多起 1~3 死 / 共同特征：未戴 SCBA + 盲目施救',
  },

  // ========== 4. 江西督察案例（渗滤液泄漏致地下水污染） ==========
  {
    incidentId: 'INC-2022-Jiangxi',
    title: '江西某填埋场渗滤液泄漏致地下水污染',
    hazard: 'leachate',
    triggerKeywords: ['衬层', '焊缝', '渗漏', '电学法', '双衬层', '监测井', '氨氮', 'Cl'],
    field: '未提示"衬层施工焊缝缺陷"是渗漏主因',
    expected: '江西督察案例：HDPE 焊缝缺陷 + 长期超库容运行 → 渗滤液渗漏 → 下游 Cl⁻ 从 25→380 mg/L（超 III 类 1.5 倍），NH₃-N 升至 5.8 mg/L（超 11.6 倍）。衬层完整性是渗滤液系统的生命线。',
    action: '① 启用双衬层电学法渗漏检测（每年 ≥ 2 次）；② 焊缝 100% 无损检测（电火花 / 真空 / 气压）；③ 严格执行库容红线，禁止超库容运行；④ 下游监测井加密至 1 次/周（HJ 1106-2020）。',
    citations: ['GB 16889-2008', 'HJ 1106-2020', 'GRI GM13', 'GB/T 14848-2017'],
    severity: '地下水 III 类指标大面积超标 / 督察整改',
  },

  // ========== 5. 北京安定物体打击 ==========
  {
    incidentId: 'INC-2021-Beijing',
    title: '北京安定填埋场"8·18"物体打击事故',
    hazard: 'operations',
    triggerKeywords: ['车辆', '作业', '指挥', '安全距离', '作业半径'],
    field: '未提示"作业人员与机械的安全距离"',
    expected: '安定事故：作业人员进入推土机作业半径 → 物体打击致死。作业半径内禁止人员，指挥人员必须站在可视范围 + 安全距离外。',
    action: '① 划定机械作业半径（推土机 ≥ 5m、压实机 ≥ 5m、自卸车 ≥ 8m）；② 设置物理隔离（警戒绳/围栏）；③ 指挥人员穿反光衣 + 持红旗；④ 进入前鸣笛 + 视觉确认。',
    citations: ['GB/T 33000-2016', 'CJJ 176-2012'],
    severity: '1 死 / 安全距离不足 + 指挥不当',
  },

  // ========== 6. 哈尔滨京环溃坝 ==========
  {
    incidentId: 'INC-2021-Harbin',
    title: '哈尔滨京环填埋场溃坝事故',
    hazard: 'dam',
    triggerKeywords: ['垃圾坝', '溃坝', '库容', '坝高', '坝体'],
    field: '未提示"超库容运行"是坝体失稳主因',
    expected: '京环事故：超库容运行 → 库内水位抬升 → 坝体剪切破坏 → 溃坝。超库容是坝体失稳的最常见根因，与深圳12·20 滑坡同源。',
    action: '① 库容达 80% 触发强制预警；② 坝体每月巡查（裂缝、渗流、位移）；③ 汛期前必须完成坝体稳定专项评估；④ 严禁超设计库容运行。',
    citations: ['CJJ 176-2012', 'SL 274-2001'],
    severity: '坝体失稳 / 影响周边居民',
  },

  // ========== 7. 深圳下坪管涌 / 暴雨滑坡 ==========
  {
    incidentId: 'INC-2019-Shenzhen-Xiaping',
    title: '深圳下坪填埋场"8·29"暴雨滑坡与管涌',
    hazard: 'slope',
    triggerKeywords: ['暴雨', '降雨', '截洪沟', '雨污分流', '管涌', '入渗'],
    field: '未提示"暴雨工况下渗滤液水位短时抬升"',
    expected: '下坪事故：暴雨 → 截洪沟堵塞 → 雨水进入堆体 → 渗滤液水位短时抬升 → 边坡 Fs 从 1.30 降至 1.10 以下 → 滑坡。暴雨后 12h 是滑坡高风险期。',
    action: '① 雨前 24h 完成截洪沟疏通；② 雨后 6h 内巡查（裂缝 / 渗水点 / 坡脚隆起）；③ 暴雨后 24h 加密位移监测至 2h/次；④ 必要时启动应急抽排 + 坡脚反压。',
    citations: ['CJJ 176-2012 §5.4', 'GB 16889-2024'],
    severity: '暴雨后失稳 / 应急抽排与反压',
  },

  // ========== 8. 莫旗尼尔基溺水 ==========
  {
    incidentId: 'INC-2017-Moqi',
    title: '莫旗尼尔基填埋场调节池溺水事故',
    hazard: 'safety',
    triggerKeywords: ['调节池', '水池', '边坡', '坠落', '溺水', '防护栏'],
    field: '未提示"调节池周边防护栏 / 救生设备"缺失',
    expected: '莫旗事故：调节池边坡湿滑 + 无防护栏 → 人员坠落 → 溺水。调节池属于 GB 30871-2022 定义的有限空间，必须配防护栏 + 救生圈 + 防坠落设施。',
    action: '① 调节池周边 1.2m 防护栏全覆盖；② 配置救生圈 + 安全绳（间距 ≤ 30m）；③ 醒目警示牌（"有限空间 严禁无防护进入"）；④ 雨后/湿滑环境加强巡查。',
    citations: ['GB 30871-2022', 'AQ 3021-2008'],
    severity: '1 死 / 防护设施缺失',
  },

  // ========== 9. 南宁平里触电 ==========
  {
    incidentId: 'INC-2022-Nanning',
    title: '南宁平里填埋场触电事故',
    hazard: 'safety',
    triggerKeywords: ['电', '电缆', '临时用电', '漏电保护', '潮湿'],
    field: '未提示"填埋场潮湿环境临时用电安全"',
    expected: '平里事故：临时电缆绝缘破损 + 潮湿环境 + 无漏电保护 → 触电。填埋场渗滤液/雨水环境普遍潮湿，临时用电必须使用漏电保护开关 + 防水电缆。',
    action: '① 临时电源必须接漏电保护（动作电流 ≤ 30 mA）；② 使用防水电缆 + 防潮插座；③ 漏电保护每日试验按钮检查；④ 潮湿场所使用安全电压（≤ 24V）或隔离变压器。',
    citations: ['GB/T 13869-2017', 'JGJ 46-2005'],
    severity: '1 死 / 临时用电管理缺失',
  },

  // ========== 10. 普遍教训：监管/许可缺失 ==========
  {
    incidentId: 'META-MULTIPLE',
    title: '多起事故共性：运营许可与监管缺失',
    hazard: 'compliance',
    triggerKeywords: ['许可证', '排污', '监管', '合规', '运行', '设计'],
    field: '未提及"排污许可证与运行合规"',
    expected: '深圳12·20 / 京环溃坝 / 多起督察案例均涉及无证运营、超规模运行、未批先建。HJ 1106-2020 要求填埋场必须有排污许可证 + 自监测方案，监管红线不可越。',
    action: '① 核查排污许可证是否有效 + 在执行期内；② 自监测方案按 HJ 1106-2020 执行（废水/地下水/废气频率）；③ 运行规模严禁超过设计能力；④ 重大变更需重新报批。',
    citations: ['HJ 1106-2020', '《排污许可管理条例》'],
    severity: '多起事故共性根因',
  },

  // ========== 11. 普遍教训：监测数据造假 / 瞒报 ==========
  {
    incidentId: 'META-DATA-INTEGRITY',
    title: '真实事故教训：监测数据完整性是底线',
    hazard: 'compliance',
    triggerKeywords: ['监测', '数据', '频率', '记录', '报告'],
    field: '未强调"监测数据真实性与频次"',
    expected: '多起督察案例显示，部分填埋场存在监测频次不足、数据弄虚作假、HJ 1106 自监测流于形式。生态环境部"清废行动"多次通报此类问题。',
    action: '① 自监测数据实时上传全国排污许可证管理信息平台；② 纸质 + 电子双轨记录 ≥ 5 年；③ 异常数据 24h 内补测 + 报告；④ 禁止人为干预监测设备。',
    citations: ['HJ 1106-2020', '《环境监测管理办法》'],
    severity: '行政拘留 / 罚款 / 吊销许可',
  },

  // ========== 12. 普遍教训：超规模运行 ==========
  {
    incidentId: 'META-OVERLOAD',
    title: '多起事故共性：超规模运行是滑坡/溃坝的温床',
    hazard: 'operations',
    triggerKeywords: ['库容', '填埋', '速率', '规模', '使用率'],
    field: '未提示"超规模运行"的复合风险',
    expected: '天子岭 10000 t/d vs 设计 3500 t/d、京环超库容、深圳渣土场违规堆填。多起事故的事前共性都是"超设计能力运行"，Fs 失稳、衬层击穿、坝体溃决的风险同步上升。',
    action: '① 建立库容/填埋量月度红线（达 80% 触发限流预警）；② 启用飞灰 / 炉渣分流减量；③ 必要时启动应急跨区协同处置。',
    citations: ['CJJ 176-2012', 'GB 16889-2008'],
    severity: '超规模是滑坡/溃坝的共同温床',
  },
];

/**
 * 注入用法：
 *   import { INCIDENT_ANTI_EXAMPLES } from '../knowledge-base/06-kb-data/incident-anti-examples';
 *   import type { VerificationMismatch } from './diagnose';
 *
 *   function enrichWithIncidentLessons(report, hazards, aiText) {
 *     const out: VerificationMismatch[] = [];
 *     for (const ex of INCIDENT_ANTI_EXAMPLES) {
 *       const hits = ex.triggerKeywords.some(kw => aiText.includes(kw));
 *       const missed = ex.mustIncludeNegativeSignals?.some(s => !aiText.includes(s));
 *       if (hits && missed) {
 *         out.push({
 *           hazard: ex.hazard,
 *           field: ex.field,
 *           expected: ex.expected,
 *           reported: 'AI 报告未引用该事故根因警示',
 *           action: ex.action,
 *         });
 *       }
 *     }
 *     return out;
 *   }
 */
