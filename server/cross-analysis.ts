/**
 * cross-analysis.ts — 交叉研判层（多智能体"真协作"的落地）
 *
 * 前四个领域 Agent 各自独立判定隐患后，本模块用**确定性规则**识别跨领域的复合风险。
 * 规则不交给 LLM 自由发挥，原因有二：
 *   1) 工程耦合关系（水位↑→孔隙水压力↑→Fs↓）是可陈述、可复核的，写死才经得起追问
 *   2) LLM 每次可能给出不同说法，而"为什么判定为复合风险"必须每次一致
 *
 * 每条规则都可在 UI 上展示"命中了哪条规则"，答辩时可直接回答复合风险的判据来源。
 */

import type { SiteData, Hazard, Severity } from './diagnose.js';
import { SEVERITY_RANK } from './diagnose.js';
import type { DomainFinding, MAGrade } from './domains.js';
import { GRADE_RANK } from './domains.js';

export interface CrossFinding {
  id: string;
  title: string;
  /** 涉及的领域 id */
  domains: string[];
  severity: MAGrade;
  /** 耦合机理（确定性陈述） */
  reasoning: string;
  /** 联合处置建议 */
  advice: string;
  /** 命中的判据（用于 UI 溯源，如「水位上升趋势=较大风险 ∧ 边坡稳定=重大风险」） */
  basis: string[];
}

export interface CrossRule {
  id: string;
  title: string;
  domains: string[];
  /** 命中判定 */
  when: (f: Record<string, DomainFinding>, site: SiteData) => boolean;
  /** 命中后给出等级与判据描述 */
  judge: (f: Record<string, DomainFinding>, site: SiteData) => { severity: MAGrade; basis: string[] };
  reasoning: string;
  advice: string;
}

type FindingMap = Record<string, DomainFinding>;

/** 某领域是否命中指定类型且不低于给定严重度的隐患 */
function hasHazard(f: FindingMap, domain: string, type: string, minSev: Severity = 'yellow'): Hazard | undefined {
  return f[domain]?.hazards?.find(
    h => h.type === type && SEVERITY_RANK[h.severity] >= SEVERITY_RANK[minSev],
  );
}

/** 取两个领域等级中较重者；unknown/green 不参与抬升 */
function heavier(a: MAGrade, b: MAGrade): MAGrade {
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

// ==================== 规则表 ====================

export const CROSS_RULES: CrossRule[] = [
  {
    id: 'water-level-slope-coupling',
    title: '水位抬升 × 边坡稳定不足（同源复合风险）',
    domains: ['leachate', 'slope'],
    when: (f) => !!hasHazard(f, 'leachate', '水位上升趋势') && !!hasHazard(f, 'slope', '填埋场整体稳定'),
    judge: (f) => {
      const l = hasHazard(f, 'leachate', '水位上升趋势')!;
      const s = hasHazard(f, 'slope', '填埋场整体稳定')!;
      const sev = (SEVERITY_RANK[l.severity] >= SEVERITY_RANK[s.severity] ? l.severity : s.severity) as MAGrade;
      return {
        severity: sev,
        basis: [`渗滤液·水位上升趋势=${l.severity}（${l.value ?? '—'}）`, `边坡·整体稳定=${s.severity}（${s.value ?? '—'}）`],
      };
    },
    reasoning: '堆体内水位抬升 → 孔隙水压力升高 → 有效应力下降 → 抗滑力降低，是稳定安全系数跌落的主导路径。二者并非两个独立隐患，而是同一物理过程的因与果，因此不应分别按单因素处置。',
    advice: '把"降水位"作为首要工程措施：优先提升抽排能力、疏通导排盲沟、封堵地表水入渗通道；在 Fs 恢复至 1.30 以上之前，停止裂缝区堆载并加密位移与水位同步监测（建议位移与水位同频次观测，便于建立相关关系）。',
  },
  {
    id: 'seepage-pathway',
    title: '渗滤液高负荷 × 地下水 Cl⁻ 超标（疑似防渗层渗漏通道）',
    domains: ['leachate', 'gw'],
    when: (f) => {
      const lea = hasHazard(f, 'leachate', '渗滤液/地下水位') ?? hasHazard(f, 'leachate', '水位上升趋势');
      return !!lea && !!hasHazard(f, 'gw', '地下水 Cl⁻ 污染');
    },
    judge: (f) => {
      const lea = hasHazard(f, 'leachate', '渗滤液/地下水位') ?? hasHazard(f, 'leachate', '水位上升趋势')!;
      const gw = hasHazard(f, 'gw', '地下水 Cl⁻ 污染')!;
      const sev = (SEVERITY_RANK[lea.severity] >= SEVERITY_RANK[gw.severity] ? lea.severity : gw.severity) as MAGrade;
      return {
        severity: sev,
        basis: [`渗滤液·液位/水位=${lea.severity}（${lea.value ?? '—'}）`, `地下水·Cl⁻=${gw.severity}（${gw.value ?? '—'}）`],
      };
    },
    reasoning: '堆内渗滤液量偏高与下游地下水 Cl⁻ 超标同时出现，指向"渗滤液→防渗层/覆盖层→地下水"的贯通路径。Cl⁻ 化学性质稳定、不被吸附降解，是渗漏通道最灵敏的示踪指标，两者并存时渗漏假设的置信度显著高于任一单项。',
    advice: '开展渗漏通道专项探测（高密度电法/自然电位/示踪试验）；同步核查防渗膜完整性、导排盲沟堵塞与雨污分流；下游加密监测井并增设分层取样，圈定污染羽范围后再确定阻隔或抽排方案。',
  },
  {
    id: 'gas-migration-exposure',
    title: '甲烷超限 × 周边敏感点邻近（迁移积聚风险）',
    domains: ['lfg'],
    when: (f) => !!hasHazard(f, 'lfg', '甲烷迁移与爆炸风险', 'orange'),
    judge: (f) => {
      const g = hasHazard(f, 'lfg', '甲烷迁移与爆炸风险', 'orange')!;
      const b = hasHazard(f, 'lfg', '周边建筑安全距离');
      return {
        severity: (SEVERITY_RANK[g.severity] >= 2 ? g.severity : 'orange') as MAGrade,
        basis: [
          `填埋气·甲烷迁移=${g.severity}（${g.value ?? '—'}）`,
          b ? `填埋气·周边建筑安全距离=${b.severity}（${b.value ?? '—'}）` : '周边建筑距离未知（未提供，风险敞口无法闭合）',
        ],
      };
    },
    reasoning: 'CH₄ 达到爆炸下限附近浓度时，风险取决于是否具备"迁移路径 + 积聚空间 + 点火源"三要素。周边敏感点越近，CH₄ 经覆盖层破损、管沟、地层裂隙迁移并在地下车库/管廊/建筑物周边积聚的可能性越高，爆炸与窒息后果越严重。',
    advice: '强制启动集气系统并维持负压运行；对场界、管沟、建筑物周边开展 CH₄ 浓度网格化监测；作业区严禁明火与切割作业，落实动火审批与便携式报警仪佩戴；核查周边建筑的通风与防爆措施。',
  },
  {
    id: 'settlement-crack',
    title: '沉降超限 × 堆体裂缝（差异沉降拉裂）',
    domains: ['slope'],
    when: (f) => !!hasHazard(f, 'slope', '地表/堆体沉降') && !!hasHazard(f, 'slope', '堆体表面裂缝'),
    judge: (f) => {
      const s = hasHazard(f, 'slope', '地表/堆体沉降')!;
      const c = hasHazard(f, 'slope', '堆体表面裂缝')!;
      const sev = (SEVERITY_RANK[s.severity] >= SEVERITY_RANK[c.severity] ? s.severity : c.severity) as MAGrade;
      return {
        severity: sev,
        basis: [`地表/堆体沉降=${s.severity}（${s.value ?? '—'}）`, `堆体裂缝=${c.severity}（${c.value ?? '—'}）`],
      };
    },
    reasoning: '有机质降解、水位变化与荷载重分布引起的不均匀沉降，会在堆体与覆盖层中产生拉应力，当拉应变超过材料的极限拉应变时形成拉张裂缝。裂缝又成为地表水入渗的优先通道，进一步加剧沉降与稳定恶化，形成正反馈。',
    advice: '建立沉降-裂缝联合监测（沉降标 + 裂缝计同步观测），判定裂缝是否为差异沉降所致；对裂缝及时封填并铺设防渗层阻断入渗；控制堆载速率，避免在沉降活跃区继续堆高。',
  },
];

// ==================== 评估 ====================

/**
 * 评估所有交叉规则，返回命中的复合风险（按严重度降序）。
 * 单个领域 unknown（数据不足）时，涉及它的规则不命中——避免用缺失数据虚构复合风险。
 */
export function evaluateCross(findings: FindingMap, site: SiteData): CrossFinding[] {
  const out: CrossFinding[] = [];
  for (const rule of CROSS_RULES) {
    // 任一相关领域数据不足 → 该规则不判定（宁可漏报，不可在缺数据时下复合结论）
    if (rule.domains.some(d => findings[d] && findings[d].confidence === 'insufficient')) continue;
    let hit = false;
    try {
      hit = rule.when(findings, site);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    try {
      const { severity, basis } = rule.judge(findings, site);
      out.push({ id: rule.id, title: rule.title, domains: rule.domains, severity, reasoning: rule.reasoning, advice: rule.advice, basis });
    } catch {
      /* 单条规则异常不影响整体 */
    }
  }
  return out.sort((a, b) => GRADE_RANK[b.severity] - GRADE_RANK[a.severity]);
}

/** 综合等级 = 各领域（排除 unknown）+ 交叉研判的最重者 */
export function overallGrade(findings: FindingMap, cross: CrossFinding[]): { grade: MAGrade; basis: 'worst-of' | 'insufficient' } {
  const domainList = Object.values(findings).map(f => f.grade);
  const measured = domainList.filter(g => g !== 'unknown');
  if (measured.length === 0) return { grade: 'unknown', basis: 'insufficient' };
  // 起点必须是 green（rank 0）而不是 blue：否则全部领域"正常"会被抬成"较低风险"
  let worst: MAGrade = 'green';
  for (const g of measured) worst = heavier(worst, g);
  for (const c of cross) worst = heavier(worst, c.severity);
  return { grade: worst, basis: 'worst-of' };
}

export const CROSS_RULE_COUNT = CROSS_RULES.length;

export default { CROSS_RULES, evaluateCross, overallGrade, CROSS_RULE_COUNT };
