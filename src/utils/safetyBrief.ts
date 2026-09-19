// ========================
// 班前安全交底卡生成器（工友安全场景）
// 输入：AI 快诊结果（已归一化的 DiagnosisResult）→ 输出可打印/导出的 Markdown 交底卡
// 纯确定性模板，不依赖 LLM，离线可用
// ========================
import type { DiagnosisResult, RiskItem } from '../types';

const RISK_LABEL: Record<string, string> = {
  red: '重大风险', orange: '较大风险', yellow: '一般风险', blue: '较低风险', green: '正常',
};

/** 风险类型 → 工友可执行的安全要点（防护措施 / 应急处置） */
interface WorkerRule { guard: string[]; emergency: string[]; }
const RULES: { re: RegExp; rule: WorkerRule }[] = [
  {
    re: /边坡|滑坡|稳定|失稳/,
    rule: {
      guard: [
        '🚧 **离坡脚远点！**至少保持坡高 1.5 倍的距离（比如坡高 10 米，就离 15 米远）',
        '坡顶**禁止**停重型机械和堆东西',
        '雨后、地震后**先巡查**裂缝再干活，裂缝变大**立刻停工**',
        '坡面作业**必须系安全带**，旁边有人看着',
      ],
      emergency: [
        '🚨 **听到异响、看到裂缝变大、有石头滚落 → 立刻跑！**',
        '跑到安全区后**报告班长**，别回去拿东西',
      ],
    },
  },
  {
    re: /渗滤液|液位|导排|调节池/,
    rule: {
      guard: [
        '🌬️ **下井三步走**：①先通风 ②再用仪器检测 ③确认安全才下去！**绝对不能偷懒跳步！**',
        '😷 **必须戴防毒面具 + 系安全绳**，至少 2 人一起干，井口有人看着！',
        '雨天**优先巡查**导排系统，防止满溢外溢',
      ],
      emergency: [
        '💧 **发现泄漏或液位异常 → 立刻停止作业、围堵导流**',
        '人往上风向跑，通知值班人员启动应急抽排',
      ],
    },
  },
  {
    re: /甲烷|填埋气|CH4|爆炸/,
    rule: {
      guard: [
        '🔥 作业区**严禁明火与吸烟**，动火作业须审批并持续气体监测',
        '📱 随身携带**便携式 CH4 报警仪**，报警**立刻撤**',
        '密闭空间**先检测后进入**，保持强制通风',
      ],
      emergency: [
        '🔊 **报警器一响 → 停！断电！跑！**别关报警器（会产生火花），跑到安全区打电话报告',
        '禁止开关电气设备产生火花，防止引爆',
      ],
    },
  },
  {
    re: /H2S|硫化氢|臭气/,
    rule: {
      guard: [
        '😤 **戴好 H2S 报警仪**，两人以上结伴作业，**站上风向**',
        '进入低洼、井室、沟槽前**先检测**，超标**严禁进入**',
        '作业点配备**防毒面具与冲洗水源**',
      ],
      emergency: [
        '🆘 **发现有人中毒 → 先戴好面具再救人**，别把自己也搭进去！',
        '中毒人员移到通风处，拨打 120 急救电话',
      ],
    },
  },
  {
    re: /沉降|塌陷/,
    rule: {
      guard: [
        '📍 **保护沉降监测点**，禁止破坏',
        '重型机械与堆载**远离陡坎与沉降区**',
        '雨后检查地面有无**塌陷、裂缝**',
      ],
      emergency: [
        '🕳️ **发现明显沉降或塌陷 → 停止作业、设警戒并上报**',
      ],
    },
  },
  {
    re: /地下水|水质|污染/,
    rule: {
      guard: [
        '🚰 **保护监测井**，废液定点收集，禁止向场内倾倒化学品',
        '涉及开挖作业**先核对地下管线与监测设施位置**',
      ],
      emergency: [
        '⚠️ **发现水质异常 → 立即停止作业并上报**，配合评估扩散范围',
      ],
    },
  },
  {
    re: /高温|温度/,
    rule: {
      guard: [
        '☀️ **高温时段错峰作业**，配备饮用水与防暑药品',
        '关注工友身体状况，出现头晕恶心**立刻休息**',
      ],
      emergency: [
        '🏥 **中暑人员移至阴凉处降温**，重症立即送医',
      ],
    },
  },
];
/** 匹配风险规则；未命中时返回通用安全要求 */
function matchRule(item: RiskItem): WorkerRule {
  const hay = item.category + ' ' + item.title;
  for (const { re, rule } of RULES) if (re.test(hay)) return rule;
  return {
    guard: [
      '✅ **遵守现场安全操作规程**，正确佩戴个人防护用品（PPE）',
      '👷 **服从安全员指挥**，作业前确认环境安全',
    ],
    emergency: [
      '🚨 **发现异常立即停止作业、撤离并上报值班人员**',
    ],
  };
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 生成班前安全交底卡（Markdown） */
export function buildSafetyBrief(result: DiagnosisResult, siteName?: string): string {
  const risks = (result.risks ?? []).filter(r => r.level === 'red' || r.level === 'orange' || r.level === 'yellow');
  const name = siteName || '填埋场作业区';
  const overall = result.overallRisk ? RISK_LABEL[result.overallRisk] ?? result.overallRisk : '待评估';
  const lines: string[] = [];

  lines.push('# 班前安全交底卡');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push(`| 工程名称 | ${name} |`);
  lines.push(`| 交底日期 | ${today()} |`);
  lines.push(`| 综合风险 | ${overall} |`);
  lines.push(`| 交底性质 | 每日班前安全交底（依据 AI 快诊结果自动生成） |`);
  lines.push('');

  if (risks.length === 0) {
    lines.push('## 一、今日作业要点');
    lines.push('');
    lines.push('今日无重大/较大/一般风险项提示。仍需遵守现场安全操作规程，佩戴 PPE，服从安全员指挥。');
    lines.push('');
  } else {
    lines.push('## 一、今日作业风险提示');
    lines.push('');
    for (let i = 0; i < risks.length; i++) {
      const r = risks[i];
      const rule = matchRule(r);
      lines.push(`### ${i + 1}. ${r.title}（${RISK_LABEL[r.level] ?? r.level}）`);
      lines.push('');
      if (r.description) { lines.push(r.description); lines.push(''); }
      if (r.suggestion) { lines.push(`处置要点：${r.suggestion}`); lines.push(''); }
    }
  }

  lines.push('## 二、防护措施与作业要求');
  lines.push('');
  const seen = new Set<string>();
  for (const r of risks) {
    const rule = matchRule(r);
    for (const g of rule.guard) {
      if (seen.has(g)) continue;
      seen.add(g);
      lines.push(`- ${g}`);
    }
  }
  if (seen.size === 0) lines.push('- 遵守现场安全操作规程，正确佩戴个人防护用品（PPE）');
  lines.push('');

  lines.push('## 三、应急处置');
  lines.push('');
  const seenE = new Set<string>();
  for (const r of risks) {
    const rule = matchRule(r);
    for (const e of rule.emergency) {
      if (seenE.has(e)) continue;
      seenE.add(e);
      lines.push(`- ${e}`);
    }
  }
  if (seenE.size === 0) lines.push('- 发现异常立即停止作业、撤离并上报');
  lines.push('- 发生人身伤害：立即呼救、现场急救并拨打 120；保护现场并上报');
  lines.push('');

  const immediate = result.report?.actions?.immediate ?? [];
  if (immediate.length) {
    lines.push('## 四、今日重点行动项');
    lines.push('');
    immediate.slice(0, 5).forEach(a => lines.push(`- ${a}`));
    lines.push('');
  }

  lines.push('## 五、交底确认');
  lines.push('');
  lines.push('本人已接受上述安全交底，明确作业风险、防护措施与应急处置要求。');
  lines.push('');
  lines.push('| 交底人 | 接受人（班组） | 安全员 | 日期 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push('| ________ | ________ | ________ | ________ |');
  lines.push('');

  lines.push('## 六、💡 工友小贴士');
  lines.push('');
  lines.push('- 💧 **天热多喝水**，头晕恶心**立刻休息**');
  lines.push('- 📱 手机存好**值班电话**和**120**');
  lines.push('- 🆘 遇到危险**先保命**，东西可以再买，命只有一条！');
  lines.push('- 🤝 **互相关照**，看到工友有危险提醒一声');
  lines.push('- 📋 **有疑问就问**，不清楚的活不要干');
  lines.push('');

  return lines.join('\n');
}

export default { buildSafetyBrief };
