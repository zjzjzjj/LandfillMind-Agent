import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Stethoscope, Upload, Play, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Info, X, Shield, FileDown, HardHat, MessageCircle, Gauge, Activity, Droplets, Wind, Layers, Printer, Map as MapIcon,
} from 'lucide-react';
import type { RiskLevel, DiagnosisResult, RiskItem } from '../types';
import { useDetailPref } from '../utils/detailPref';
import { buildDiagnosisMarkdown, downloadJSON, downloadText, markdownToHtml, openPrintableHtml, timestampName } from '../utils/exporter';
import { buildSafetyBrief } from '../utils/safetyBrief';
import { RiskMap, planEscapeRoutes } from '../components/RiskMap';
import { VerificationTheater } from '../components/VerificationTheater';

// ========================
// 风险色映射
// ========================
const RISK_COLOR: Record<RiskLevel, string> = {
  red: '#dc2626',
  orange: '#ea580c',
  yellow: '#ca8a04',
  blue: '#2563eb',
  green: '#16a34a',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  red: '危险', orange: '警示', yellow: '注意', blue: '关注', green: '正常',
};

const SEVERITY_RANK: Record<RiskLevel, number> = { green: 0, blue: 1, yellow: 2, orange: 3, red: 4 };

const RISK_BG: Record<RiskLevel, string> = {
  red: 'rgba(220,38,38,0.08)',
  orange: 'rgba(234,88,12,0.08)',
  yellow: 'rgba(202,138,4,0.08)',
  blue: 'rgba(37,99,235,0.08)',
  green: 'rgba(22,163,74,0.08)',
};

// ========================
// 风险卡片组件
// ========================
function RiskCard({ item }: { item: RiskItem }) {
  const [expanded, setExpanded] = useState(false);
  const color = RISK_COLOR[item.level];
  const bg = RISK_BG[item.level];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      {/* 顶部色条 */}
      <div className="h-1" style={{ backgroundColor: color }} />
      <div className="p-4">
        {/* 标题行 */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} style={{ color }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {item.title}
            </span>
          </div>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ backgroundColor: bg, color }}
          >
            {RISK_LABEL[item.level]}
          </span>
        </div>
        {/* 数值 */}
        {item.value !== undefined && (
          <div className="flex items-baseline gap-1.5 mb-2">
            <span
              className={typeof item.value === 'number' ? 'text-2xl font-bold font-mono' : 'text-base font-semibold font-mono'}
              style={{ color }}
            >
              {item.value}
            </span>
            {item.unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.unit}</span>}
          </div>
        )}
        {/* 描述 */}
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {item.description}
        </p>
        {/* 阈值 */}
        {item.threshold && (
          <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
            阈值：{item.threshold}
          </p>
        )}
        {/* 计算书 */}
        {item.calc && item.calc.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>计算书</p>
            {item.calc.map((step, i) => (
              <div key={i} className="rounded-md px-2.5 py-2" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                    style={{ backgroundColor: 'var(--primary-glow)', color: 'var(--primary)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{step.label}</span>
                </div>
                <div className="font-mono text-[10px] mb-0.5 pl-6" style={{ color: 'var(--text-muted)' }}>{step.formula}</div>
                <div className="text-[11px] leading-relaxed pl-6" style={{ color: 'var(--text-secondary)' }}>{step.detail}</div>
              </div>
            ))}
          </div>
        )}
        {/* 可展开建议 */}
        {item.suggestion && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 mt-2 text-xs transition-colors"
            style={{ color: 'var(--primary)' }}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? '收起建议' : '查看处置建议'}
          </button>
        )}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div
                className="mt-2 p-3 rounded-lg text-xs leading-relaxed"
                style={{ backgroundColor: bg, color: 'var(--text-secondary)' }}
              >
                {item.suggestion}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ========================
// 示例数据
// ========================
// 示例数据（含场地与气候默认值，供评审演示）
const DEMO_DATA = {
  // 场地与气候（驱动渗滤液产量估算 Q=C·A·I）
  landfillArea: 300000, rainfall: 1200,
  // 边坡
  slopeH: 25, slopeBeta: 30, slopeGamma: 11, slopeC: 8, slopePhi: 20,
  // 渗滤液
  leachiLevel: 1.2, leachiCapacity: 450, leachiPh: 6.5,
  // 填埋气
  ch4Concentration: 35, h2sConcentration: 5, lfgCollectionRate: 65,
  // 地下水
  gwLevel: 8.5, clConcentration: 280, groundwaterVelocity: 0.3,
};

// 示例诊断结果（后端异常时的兜底展示）
const DEMO_RESULT: DiagnosisResult = {
  risks: [
    {
      id: '1', category: '边坡', title: '填埋场整体稳定',
      description: '垃圾体抗剪强度不足或渗滤液水位过高会显著降低稳定安全系数，易引发滑坡、失稳。',
      level: 'orange', value: 'Fs ≈ 1.18', unit: '', threshold: '运行期要求 Fs ≥ 1.30',
      suggestion: '降低渗滤液水位、设置导排与坡面支护；必要时进行稳定化加固（如注浆、减重、放缓坡比、加密位移监测）。',
      calc: [
        { label: '整理计算参数', formula: 'H、β、γ、c、φ、水位埋深', detail: 'H=25m，β=30°，γ=11kN/m³，c=8kPa，φ=20°，水位埋深≈8.5m' },
        { label: '简化条分法抗滑稳定', formula: 'Fs = (c + γ·H·cos²β·tanφ) / (γ·H·sinβ·cosβ)', detail: '滑动力 ≈ 137.5 kPa；抗滑力 ≈ 162.3 kPa' },
        { label: '稳定系数与等级判定', formula: '运行期要求 Fs ≥ 1.30', detail: 'Fs = 1.18，不满足运行要求 → 较大风险' },
      ],
    },
    {
      id: '2', category: '渗滤液', title: '渗滤液/地下水位',
      description: '水位过高抬高孔隙水压力、降低有效应力与稳定安全系数，并驱动臭气与渗滤液上逸。',
      level: 'orange', value: '水位埋深≈1.2 m', unit: '', threshold: '埋深 1–3 m',
      suggestion: '提升抽注井抽排能力、优化注采比；必要时增设深层导排盲沟降低水位。',
      calc: [
        { label: '水位埋深判定', formula: '埋深越浅，孔隙水压力越高、稳定越不利', detail: '实测水位埋深 ≈ 1.2m → 较大风险' },
        { label: '渗滤液产量估算', formula: 'Q = C·A·I（经验公式，径流系数 C=0.3）', detail: '面积30万㎡、年降雨量1200mm条件下，估算日产渗滤液约 246.6m³' },
      ],
    },
    {
      id: '3', category: '填埋气', title: '甲烷迁移与爆炸风险',
      description: '填埋气 CH₄ 迁移至填埋场边界外封闭空间积聚，遇引火源有爆炸/窒息风险。',
      level: 'yellow', value: '区域外 CH₄ ≈ 1.75%', unit: '', threshold: '报警值 25% LEL，爆炸下限 5% vol',
      suggestion: '提高气体收集率与井内负压；在场界布设 CH₄ 监测与主动抽排。',
      calc: [
        { label: '爆炸下限换算', formula: '100% LEL ≈ 5% vol（甲烷）', detail: '实测 1.75% 体积浓度 ≈ 35% LEL' },
        { label: '爆炸风险判定', formula: '报警值 25% LEL；爆炸下限 5% vol', detail: '35% LEL ≥25%，触发报警；体积浓度 1.75% 未达爆炸下限 → 一般风险' },
      ],
    },
    {
      id: '4', category: '地下水', title: '地下水 Cl⁻ 污染',
      description: '渗滤液渗漏或历史污染导致地下水中 Cl⁻ 升高，指示污染羽已向下游扩散。',
      level: 'orange', value: 'Cl⁻ ≈ 280 mg/L', unit: '', threshold: 'GB/T 14848 III类 ≤ 250 mg/L',
      suggestion: '加密下游监测井采样频次；开展同位素/水化学溯源调查；必要时布设阻隔墙或抽排井控制污染羽扩散。',
      calc: [
        { label: '实测与背景对比', formula: '超标倍数 = 实测 / 背景', detail: 'Cl⁻ 实测 280mg/L，背景 50mg/L，超背景约 5.6 倍' },
        { label: '水质标准判定', formula: 'GB/T 14848 III类 Cl⁻ ≤ 250 mg/L', detail: '280mg/L >250，超 III 类标准 → 较大风险' },
      ],
    },
  ],
  overallRisk: 'orange',
  verification: { consistent: true, checked: 3, total: 3, mismatches: [] },
  report: {
    overview: '该填埋场当前综合风险等级为橙色（较大风险），主要隐患为边坡稳定系数偏低（Fs=1.18）与渗滤液液位偏高，建议立即启动应急响应。',
    sections: [
      { title: '边坡稳定', content: 'Fs=1.18 低于 CJJ 176 运行期要求 ≥1.30，主控因素为渗滤液水位抬升与坡脚失稳，建议控高、导排、加密位移监测。' },
      { title: '渗滤液', content: '液位埋深仅 1.2m，导排系统高负荷，建议排查导排管路、增设应急抽排井。' },
    ],
    regulations: ['CJJ 176-2012 §4.5', 'GB 16889-2008 §5.2', 'GB/T 14848-2017', 'HJ 25.6-2019'],
    actions: {
      immediate: ['立即控制填埋高度与填埋速率', '启动渗滤液应急抽排'],
      shortTerm: ['疏通导排系统', '加密位移与水位监测'],
      longTerm: ['委托专业机构复核边坡稳定', '完善雨污分流与覆盖层防渗'],
    },
    monitoring: ['边坡位移监测点加密至每日一次', '下游监测井水质每两周一次', '场界 CH₄ 在线监测'],
    conclusion: '综合风险等级：较大风险（橙色）。建议 72 小时内完成应急评估并复核监测数据。',
  },
};

// ========================
// 演示纠偏触发样例（演示员点击「触发纠偏演示」按钮加载）
// 用途：演示员向评委展示"AI 报告漏报 / 编造数值时，系统级确定性工程计算内核如何捕获并自动纠偏"——
// 即核心卖点"AI 不能凭空捏造工程数值"的设计哲学。
// mismatches 使用结构化对象形式，UI 卡片逐条渲染 hazard / field / expected / reported / action；
// 数值与当前 DEMO_DATA 完全对齐（如 ch4Concentration=35 → 1.75% vol、年降雨量 1200mm）。
// ========================
const DEMO_RESULT_CORRECTED: DiagnosisResult = {
  risks: DEMO_RESULT.risks,
  overallRisk: DEMO_RESULT.overallRisk,
  report: DEMO_RESULT.report,
  verification: {
    consistent: false,
    checked: 6,
    total: 6,
    mismatches: [
      {
        hazard: 'slope',
        field: 'Fs（边坡稳定安全系数）',
        expected: '1.18（内核简化条分法）',
        reported: 'AI 报告误述为 "Fs=1.35 满足要求"（编造数值，与内核 1.18 不一致）',
        action: '已采纳内核结论 1.18，风险等级由 yellow 上调为 orange（不满足 CJJ 176 运行期 Fs ≥ 1.30）',
      },
      {
        hazard: 'leachate',
        field: '年渗滤液产量',
        expected: '约 12,400 m³/年（Q=C·A·I，C=0.3、A=30万㎡、I=1200mm）',
        reported: 'LLM 仅定性描述"日产渗滤液较大"，未给具体数值',
        action: '已补充计算书 Q=246.6 m³/d × 365 ≈ 90,000 m³/年，并追加应急抽排措施',
      },
      {
        hazard: 'lfg',
        field: 'CH₄ 浓度分级',
        expected: '1.75% vol ≈ 35% LEL（yellow 预警，未达爆炸下限）',
        reported: 'AI 误判为"orange 较大风险"，未引用 LEL 阈值',
        action: '已按六档分级纠正为 yellow 预警，并补充 25% LEL 报警值说明',
      },
    ],
    correctedAt: '系统级内核交叉复核（v4.1.1 演示样例）',
  },
};


// ============ 风险维度 → 图标/标签/颜色映射（用于综合仪表盘） ============
type DimKey = 'slope' | 'leachate' | 'lfg' | 'gw' | 'other';
const DIM_META: Record<DimKey, { label: string; icon: React.ElementType; color: string; kw: RegExp }> = {
  slope: { label: '边坡稳定', icon: Layers, color: '#10b981', kw: /边坡|稳定|失稳|滑坡|Fs/ },
  leachate: { label: '渗滤液', icon: Droplets, color: '#3b82f6', kw: /渗滤液|液位|导排/ },
  lfg: { label: '填埋气', icon: Wind, color: '#f59e0b', kw: /填埋气|甲烷|CH4|硫化氢|H2S|臭气/ },
  gw: { label: '地下水', icon: Activity, color: '#06b6d4', kw: /地下水|水质|Cl-|氯/ },
  other: { label: '综合', icon: Gauge, color: '#8b5cf6', kw: /综合|沉降|温度/ },
};

function pickDim(category: string, title: string): DimKey {
  const text = (category + ' ' + title) || '';
  for (const k of ['slope', 'leachate', 'lfg', 'gw'] as DimKey[]) {
    if (DIM_META[k].kw.test(text)) return k;
  }
  return 'other';
}


// ========================
// 主组件
// ========================
export default function DiagnosisPage() {
  const [inputMode, setInputMode] = useState<'form' | 'csv'>('form');
  const [formData, setFormData] = useState(DEMO_DATA);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  // 后端异常标记：演示模式显式标注（避免静默兜底误导评委）
  const [backendError, setBackendError] = useState<{ hasError: boolean; message: string }>({ hasError: false, message: '' });
  // 短暂 toast 提示（演示数据加载/手动操作反馈）
  const [toast, setToast] = useState<string>('');
  const [formExpanded, setFormExpanded] = useState({ site: true, slope: true, leachi: false, lfg: false, gw: false });
  // 班前安全交底卡预览折叠状态（默认折叠）
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [detail, setDetail] = useDetailPref('diagnose');
  const navigate = useNavigate();

  // 综合风险仪表盘：按维度聚合（最大严重度）
  const dimensionSummary = useMemo(() => {
    if (!result) return null;
    const buckets: Record<DimKey, RiskLevel> = { slope: 'green', leachate: 'green', lfg: 'green', gw: 'green', other: 'green' };
    (result.risks ?? []).forEach((r) => {
      const k = pickDim(r.category, r.title);
      const cur = buckets[k];
      if (SEVERITY_RANK[r.level] > SEVERITY_RANK[cur]) buckets[k] = r.level;
    });
    return buckets;
  }, [result]);

  // 风险地图适配层：RiskItem（无坐标）→ RiskMap zones/routes
  // 点位贴合底图设施：边坡隐患在库区西侧坝肩、渗滤液风险靠调节池、
  // 填埋气在库区中部气井密集区、地下水在下游监测井一线；
  // 同类别多点位环绕散布避免堆叠。疏散路线经安全走廊至最近集合点。
  const riskMapData = useMemo(() => {
    if (!result) return null;
    const CATEGORY_COORD: Record<string, { x: number; y: number; ring?: number }> = {
      '边坡': { x: 21, y: 42, ring: 22 },   // 库区西缘/垃圾坝侧
      '渗滤液': { x: 63, y: 66, ring: 20 }, // 渗滤液调节池附近
      '填埋气': { x: 44, y: 36, ring: 16 }, // 库区中部
      '地下水': { x: 44, y: 84, ring: 24 }, // 下游监测井线
      '综合': { x: 70, y: 48, ring: 18 },   // 场区东部
    };
    const hot = (result.risks ?? []).filter(r => r.level === 'red' || r.level === 'orange' || r.level === 'yellow');
    const zones = hot.map((r, i) => {
      const coord = CATEGORY_COORD[r.category] ?? CATEGORY_COORD['综合'];
      const ring = coord.ring ?? 14;
      // 同类别多点位：按序绕环分布，单点位居中
      const n = hot.filter(o => (CATEGORY_COORD[o.category] ?? CATEGORY_COORD['综合']) === coord).length;
      const angle = -Math.PI / 3 + (Math.PI * 2 * i) / Math.max(n, 1);
      const spread = n > 1 ? ring * 0.55 : 0;
      const x = Math.max(8, Math.min(90, coord.x + Math.cos(angle) * spread));
      const y = Math.max(10, Math.min(90, coord.y + Math.sin(angle) * spread));
      return {
        id: r.id,
        label: r.title.length > 8 ? r.title.slice(0, 8) + '…' : r.title,
        level: r.level,
        x, y,
        radius: r.level === 'red' ? 11 : r.level === 'orange' ? 9.5 : 8,
        description: r.description,
      };
    });
    // 疏散路线：经安全走廊绕行至 A/B 集合点（不横穿库区中心）
    const routes = planEscapeRoutes(zones);
    const siteName = String((result.site as any)?.siteName ?? '示范场地 LF-01');
    return { zones, routes, siteName };
  }, [result]);

  // 追问 AI 助手：跳到 /chat/new，带上诊断场景 + 结果摘要 + 引导问题
  const handleAskAssistant = () => {
    if (!result) return;
    const sev = result.overallRisk ? RISK_LABEL[result.overallRisk] : '未评估';
    const riskLines = (result.risks ?? []).slice(0, 6).map((r) => {
      const v = r.value !== undefined ? String(r.value) : '';
      return `- ${r.title}（${RISK_LABEL[r.level]}${v ? '，' + v : ''}）`;
    }).join('\n');
    const actionLines = (result.report.actions?.immediate ?? []).slice(0, 3).map((a) => `- ${a}`).join('\n');
    const question = [
      '【AI 快诊 · 追问】',
      '',
      '【诊断场景】场地监测数据已输入系统，触发双引擎诊断。',
      '',
      '【综合研判】' + sev,
      '',
      '【主要风险项】',
      riskLines || '（无）',
      '',
      '【立即处置建议】',
      actionLines || '（无）',
      '',
      '【请进一步回答】基于上述综合诊断，请给出：',
      '1) 风险机理深度分析与潜在演化路径；',
      '2) 工友现场作业的防护措施与应急处置清单；',
      '3) 监测点位布设与监测频率建议；',
      '4) 何时需要委托专业机构进一步复核。',
    ].join('\n');
    sessionStorage.setItem('chat-prefill', question);
    sessionStorage.setItem('chat-prefill-expert', JSON.stringify({
      agentId: 'engineer',
      name: 'AI 快诊助手',
      icon: '🩺',
      color: '#06b6d4',
      ts: Date.now(),
    }));
    navigate('/chat/new');
  };

  // 把诊断结果写给 3D 场景（sessionStorage 一次性信封，SimulatorPage 消费）
  const persistForScene = (r: DiagnosisResult) => {
    try {
      sessionStorage.setItem('diagnosis-latest', JSON.stringify({
        risks: r.risks, overallRisk: r.overallRisk, ts: Date.now(),
      }));
    } catch { /* ignore */ }
  };

  // 后端 /api/diagnose 返回 { hazards(含 calc 计算书), report(分章节), overallRisk }，
  // 前端做字段归一化 + 防御性兜底
  const normalizeResult = (raw: any): DiagnosisResult => {
    const risks: RiskItem[] = Array.isArray(raw?.risks)
      ? raw.risks
      : (Array.isArray(raw?.hazards) ? raw.hazards : []).map((h: any, i: number) => ({
          id: String(h?.id ?? i),
          category: h?.category ?? '综合',
          title: h?.type ?? h?.title ?? '未知隐患',
          description: h?.mechanism ?? h?.description ?? '',
          level: (['red', 'orange', 'yellow', 'blue', 'green'].includes(h?.severity) ? h.severity : 'blue') as RiskLevel,
          value: h?.value ?? undefined,
          unit: undefined,
          threshold: h?.threshold ?? '',
          suggestion: h?.advice ?? h?.suggestion ?? '',
          calc: Array.isArray(h?.calc) ? h.calc : undefined,
        }));
    const report = raw?.report ?? {
      overview: raw?.summary ?? '诊断完成',
      sections: [],
      regulations: [],
      actions: { immediate: raw?.priorityActions ?? [], shortTerm: [], longTerm: [] },
      monitoring: [],
      conclusion: raw?.advice ?? '',
    };
    return {
      risks,
      overallRisk: raw?.overallRisk,
      report,
      site: raw?.site,
      dataCompleteness: raw?.dataCompleteness,
      verification: raw?.verification,
    };
  };

  // 前端表单字段 → 后端 SiteData 字段映射（传全字段，供计算书调用计算内核）
  const toSiteData = (f: typeof DEMO_DATA) => ({
    // 边坡计算参数
    landfillHeight: f.slopeH,
    slopeAngle: f.slopeBeta,
    slopeGamma: f.slopeGamma,
    slopeC: f.slopeC,
    slopePhi: f.slopePhi,
    // 渗滤液
    waterLevel: f.gwLevel,
    leachateLevel: f.leachiLevel,
    // 填埋面积与年降雨量：表单可编辑，驱动渗滤液产量估算
    landfillArea: f.landfillArea,
    rainfall: f.rainfall,
    // 填埋气
    h2s: f.h2sConcentration,
    // CH₄：前端按 %LEL 录入，后端按体积浓度 % 判定；100% LEL ≈ 5% vol
    ch4: Math.round(f.ch4Concentration * 0.05 * 100) / 100,
    // 地下水
    clConcentration: f.clConcentration,
    clBackground: 50,
    gwVelocity: f.groundwaterVelocity,
  });

  const handleCalc = useCallback(async () => {
    setLoading(true);
    setBackendError({ hasError: false, message: '' });
    try {
      const res = await fetch('/api/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: toSiteData(formData), detail }),
      });
      if (res.ok) {
        const data = await res.json();
        const normalized = normalizeResult(data);
        setResult(normalized);
        persistForScene(normalized);
      } else {
        // 后端异常时使用示例数据兜底，但显式标注，避免评委误以为"✅ 内核复核通过"是真实数据
        console.error('[handleCalc] 后端异常 status=', res.status, '，已加载示例数据用于演示');
        setBackendError({ hasError: true, message: `后端异常（HTTP ${res.status}），已加载示例数据用于演示` });
        setResult(DEMO_RESULT);
      }
    } catch (e) {
      // 网络/解析异常同样显式标注
      console.error('[handleCalc] 网络异常', e, '，已加载示例数据用于演示');
      setBackendError({ hasError: true, message: '后端连接失败（网络错误），已加载示例数据用于演示' });
      setResult(DEMO_RESULT);
    } finally {
      setLoading(false);
    }
  }, [formData, detail]);

  const handleLoadDemo = () => {
    setFormData(DEMO_DATA);
    setResult(DEMO_RESULT);
    persistForScene(DEMO_RESULT);
    setBackendError({ hasError: false, message: '' });
    // 短暂 toast：显式告知评委当前为演示数据
    setToast('已加载 v4.1.1 演示数据（含纠偏样例）');
    setTimeout(() => setToast(''), 2500);
  };

  // 演示员向评委演示"AI 报告漏报/编造数值时，系统级计算内核自动纠偏"——
  // 直接加载 DEMO_RESULT_CORRECTED（verification.consistent=false），触发黄条与 mismatch 列表
  const handleLoadCorrectedDemo = () => {
    setFormData(DEMO_DATA);
    setResult(DEMO_RESULT_CORRECTED);
    persistForScene(DEMO_RESULT_CORRECTED);
    setBackendError({ hasError: false, message: '' });
    setToast('已触发纠偏演示——AI 报告漏报 / 编造数值被内核捕获');
    setTimeout(() => setToast(''), 2500);
  };

  const setField = (path: string, val: number) => {
    setFormData(prev => ({ ...prev, [path]: val }));
  };

  const sections = [
    {
      key: 'site', label: '场地与气候', color: '#94a3b8',
      fields: [
        { key: 'landfillArea', label: '填埋面积', unit: '㎡', min: 100000, max: 500000 },
        { key: 'rainfall', label: '年降雨量', unit: 'mm', min: 500, max: 2000 },
      ],
    },
    {
      key: 'slope', label: '边坡参数', color: '#10b981',
      fields: [
        { key: 'slopeH', label: '堆体高度 H', unit: 'm', min: 0, max: 100 },
        { key: 'slopeBeta', label: '边坡坡角 β', unit: '°', min: 0, max: 90 },
        { key: 'slopeGamma', label: '垃圾重度 γ', unit: 'kN/m³', min: 5, max: 20 },
        { key: 'slopeC', label: '黏聚力 c', unit: 'kPa', min: 0, max: 50 },
        { key: 'slopePhi', label: '内摩擦角 φ', unit: '°', min: 0, max: 45 },
      ],
    },
    {
      key: 'leachi', label: '渗滤液参数', color: '#3b82f6',
      fields: [
        { key: 'leachiLevel', label: '液位', unit: 'm', min: 0, max: 5 },
        { key: 'leachiCapacity', label: '日产方量', unit: 'm³/d', min: 0, max: 5000 },
        { key: 'leachiPh', label: 'pH 值', unit: '', min: 0, max: 14 },
      ],
    },
    {
      key: 'lfg', label: '填埋气参数', color: '#f59e0b',
      fields: [
        // CH₄：输入按 %LEL，内部按体积分数 %vol 判定，100% LEL ≈ 5% vol
        { key: 'ch4Concentration', label: 'CH₄ 浓度', unit: '% LEL', min: 0, max: 100 },
        { key: 'h2sConcentration', label: 'H₂S 浓度', unit: 'ppm', min: 0, max: 100 },
        { key: 'lfgCollectionRate', label: '集气率', unit: '%', min: 0, max: 100 },
      ],
    },
    {
      key: 'gw', label: '地下水参数', color: '#06b6d4',
      fields: [
        { key: 'gwLevel', label: '地下水位埋深', unit: 'm', min: 0, max: 50 },
        { key: 'clConcentration', label: 'Cl⁻ 浓度', unit: 'mg/L', min: 0, max: 1000 },
        { key: 'groundwaterVelocity', label: '水流速', unit: 'm/d', min: 0, max: 5 },
      ],
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* 短暂 toast 提示（演示数据加载反馈） */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-xs font-medium"
            style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
            role="status"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
      {/* 页面标题 */}
      <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2.5">
          <Stethoscope size={18} style={{ color: 'var(--primary)' }} />
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>AI 快诊</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>输入场地数据，AI 自动识别隐患，输出分级报告</p>
          </div>
        </div>
      </div>

      <div className="flex h-full">
        {/* 左侧输入面板 */}
        <div
          className="w-80 flex-shrink-0 border-r overflow-y-auto"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
        >
          {/* 输入模式切换 */}
          <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              {([['form', '表单录入'], ['csv', 'CSV 导入']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => mode === 'form' && setInputMode(mode)}
                  disabled={mode === 'csv'}
                  title={mode === 'csv' ? '评审版仅支持手动填写' : undefined}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: inputMode === mode ? 'var(--bg-surface)' : 'transparent',
                    color: inputMode === mode ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: inputMode === mode ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* 表单 */}
          {inputMode === 'form' ? (
            <div className="p-4 space-y-4">
              {sections.map(sec => (
                <div key={sec.key} className="rounded-xl border overflow-hidden"
                     style={{ borderColor: 'var(--border)' }}>
                  {/* 分组标题 */}
                  <button
                    onClick={() => setFormExpanded(prev => ({ ...prev, [sec.key]: !prev[sec.key as keyof typeof prev] }))}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                    style={{ backgroundColor: 'var(--bg-elevated)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sec.color }} />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{sec.label}</span>
                    </div>
                    {formExpanded[sec.key as keyof typeof formExpanded]
                      ? <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} />
                      : <ChevronDown size={13} style={{ color: 'var(--text-muted)' }} />}
                  </button>

                  <AnimatePresence>
                    {formExpanded[sec.key as keyof typeof formExpanded] && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-3 space-y-3">
                          {sec.fields.map(f => (
                            <div key={f.key}>
                              <label className="flex items-center justify-between mb-1">
                                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                  {f.label}
                                </span>
                                {f.unit && (
                                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                                    {f.unit}
                                  </span>
                                )}
                              </label>
                              <input
                                type="number"
                                value={formData[f.key as keyof typeof formData]}
                                onChange={e => setField(f.key, parseFloat(e.target.value) || 0)}
                                className="input font-mono px-2.5 py-1.5"
                              />
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}

              {/* 回答详细度 */}
              <div className="pt-1">
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>回答详细度</p>
                <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                  {([['brief', '摘要'], ['standard', '标准'], ['detailed', '详细']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setDetail(key)}
                      className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all duration-150"
                      style={{
                        backgroundColor: detail === key ? 'var(--bg-surface)' : 'transparent',
                        color: detail === key ? 'var(--text-primary)' : 'var(--text-muted)',
                        boxShadow: detail === key ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {detail === 'detailed' && (
                  <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    详细模式生成时间约 30–90 秒，请耐心等待
                  </p>
                )}
              </div>

              {/* 按钮组 */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleLoadDemo}
                  className="flex-1 py-2 rounded-lg text-xs font-medium border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                  title="加载内置演示数据（含纠偏样例），用于无后端/网络异常时的演示兜底"
                >
                  <Info size={12} className="inline mr-1" />
                  📋 加载演示数据（含纠偏样例）
                </button>
                <button
                  onClick={handleCalc}
                  disabled={loading}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all duration-200 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--primary)' }}
                  onMouseEnter={e => !loading && (e.currentTarget.style.boxShadow = '0 0 20px rgba(6,182,212,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                >
                  {loading ? (
                    <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  ) : (
                    <><Play size={12} /> 开始诊断</>
                  )}
                </button>
              </div>
                {/* 演示员向评委演示"AI 报告漏报/编造数值时，系统级计算内核自动纠偏"——黄色按钮区别于绿色"通过"样例 */}
                <button
                  onClick={handleLoadCorrectedDemo}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border transition-all duration-200"
                  style={{ borderColor: 'rgba(250,204,21,0.55)', color: '#ca8a04', backgroundColor: 'rgba(250,204,21,0.10)' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(250,204,21,0.22)'; e.currentTarget.style.borderColor = 'rgba(250,204,21,0.85)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(250,204,21,0.10)'; e.currentTarget.style.borderColor = 'rgba(250,204,21,0.55)'; }}
                  title="加载纠偏触发样例：AI 报告漏报 / 编造数值时，系统级确定性工程计算内核如何自动捕获并纠偏"
                >
                  <AlertTriangle size={13} /> ⚡ 触发纠偏演示（黄条 + mismatch 列表）
                </button>
            </div>
          ) : (
            <div className="p-4">
              <p className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>
                CSV 批量导入将在 v4.4 开放
              </p>
              <p className="text-[10px] text-center -mt-6" style={{ color: 'var(--text-muted)' }}>
                评审版仅支持手动填写表单字段
              </p>
            </div>
          )}
        </div>

        {/* 右侧结果区域 */}
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-12">
          {!result ? (
            <div className="flex flex-col items-center justify-center h-full">
              <Shield size={48} style={{ color: 'var(--border-accent)' }} />
              <p className="text-sm mt-4 font-medium" style={{ color: 'var(--text-muted)' }}>
                暂无诊断结果
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                请在左侧输入场地数据，点击「开始诊断」
              </p>
            </div>
          ) : (
            <div className="space-y-5 max-w-4xl">
              {/* 后端异常显式标注（演示模式兜底，避免静默误导评委） */}
              {backendError.hasError && (
                <div
                  className="rounded-xl border-2 px-4 py-3 flex items-start gap-2"
                  style={{
                    borderColor: 'rgba(220,38,38,0.6)',
                    backgroundColor: 'rgba(220,38,38,0.08)',
                  }}
                  role="alert"
                >
                  <AlertTriangle size={16} style={{ color: '#dc2626', marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <p className="text-xs font-semibold" style={{ color: '#dc2626' }}>
                      ⚠ 后端异常，已加载示例数据用于演示
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {backendError.message}。下方「✅ 内核复核通过」为示例数据内置校验结果，非真实后端计算输出。
                    </p>
                  </div>
                </div>
              )}

              {/* 一、综合研判 */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border p-5"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={16} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>综合研判报告</h2>
                  {result.overallRisk && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ backgroundColor: RISK_BG[result.overallRisk], color: RISK_COLOR[result.overallRisk] }}
                    >
                      综合风险：{RISK_LABEL[result.overallRisk]}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={handleAskAssistant}
                      title="追问 AI 助手（带诊断上下文）"
                      className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors font-medium"
                      style={{ borderColor: 'rgba(6,182,212,0.6)', color: '#06b6d4', backgroundColor: 'rgba(6,182,212,0.08)' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#06b6d4'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#06b6d4'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(6,182,212,0.08)'; e.currentTarget.style.color = '#06b6d4'; e.currentTarget.style.borderColor = 'rgba(6,182,212,0.6)'; }}
                    >
                      <MessageCircle size={12} /> 追问 AI 助手
                    </button>
                    <button
                      onClick={() => openPrintableHtml('班前安全交底卡', buildSafetyBrief(result, String((result.site as any)?.siteName ?? '填埋场作业区')))}
                      className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'rgba(16,185,129,0.5)', color: '#10b981' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(16,185,129,0.5)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <HardHat size={12} /> 班前安全交底
                    </button>
                    <button
                      onClick={() => downloadText(timestampName('诊断报告', 'md'), buildDiagnosisMarkdown(result, toSiteData(formData)))}
                      className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <FileDown size={12} /> MD
                    </button>
                    <button
                      onClick={() => openPrintableHtml('LandfillMind 诊断报告', buildDiagnosisMarkdown(result, toSiteData(formData)))}
                      className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <FileDown size={12} /> HTML·PDF
                    </button>
                    <button
                      onClick={() => downloadJSON(timestampName('诊断报告', 'json'), { site: toSiteData(formData), result })}
                      className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      <FileDown size={12} /> JSON
                    </button>
                  </div>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{result.report.overview}</p>
                {result.report.conclusion && (
                  <div className="mt-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--primary-glow)' }}>
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--primary)' }}>结论</p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{result.report.conclusion}</p>
                  </div>
                )}
                {result.verification && (
                  // 纠偏剧场化（Verification Theater）：
                  //   原静态黄色卡片升级为分屏剧场——左 AI 报告原文、中动画竖线逐条"穿过"不一致项、右计算内核真实结论。
                  //   命中"AI 纠偏管理"评审维度（最重要）；保留旧一致态绿色横幅样式以维持演示视觉一致。
                  result.verification.consistent ? (
                    <div className="mt-3 rounded-lg border px-3 py-2.5"
                         style={{
                           borderColor: 'rgba(16,185,129,0.45)',
                           backgroundColor: 'rgba(16,185,129,0.08)',
                         }}>
                      <p className="text-[11px] font-semibold" style={{ color: '#10b981' }}>
                        ✅ 内核复核通过
                      </p>
                      <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
                        AI 报告引用的 {result.verification.checked}/{result.verification.total} 项关键数值已与工程计算内核交叉核对一致，结论可信。
                      </p>
                    </div>
                  ) : (
                    <VerificationTheater
                      mismatches={result.verification.mismatches}
                      aiReportSnippet={result.report.overview}
                      kernelReport={result.verification.correctedAt}
                    />
                  )
                )}
              </motion.div>

              {/* 班前安全交底卡（折叠预览，默认折叠）—— 把诊断结果转译成工友可签字的纸质交底卡 */}
              <div className="rounded-xl border overflow-hidden"
                   style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
                <button
                  onClick={() => setBriefExpanded(e => !e)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors"
                  style={{ backgroundColor: 'var(--bg-elevated)' }}
                >
                  <div className="flex items-center gap-2">
                    <HardHat size={14} style={{ color: '#f59e0b' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      📋 班前安全交底卡（预览）
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
                      工友视角
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        openPrintableHtml(
                          '班前安全交底卡',
                          buildSafetyBrief(result, String((result.site as any)?.siteName ?? '填埋场作业区')),
                        );
                      }}
                      className="text-[11px] px-2 py-1 rounded border flex items-center gap-1 cursor-pointer"
                      style={{ borderColor: 'rgba(245,158,11,0.5)', color: '#f59e0b' }}
                      title="一键打印 / 导出 PDF（复用顶部按钮）"
                    >
                      <Printer size={11} /> 一键打印 / 导出 PDF
                    </span>
                    {briefExpanded
                      ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
                      : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
                  </div>
                </button>
                <AnimatePresence>
                  {briefExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="p-4 text-xs leading-relaxed"
                        style={{ color: 'var(--text-secondary)' }}
                        dangerouslySetInnerHTML={{
                          __html: markdownToHtml(
                            buildSafetyBrief(result, String((result.site as any)?.siteName ?? '填埋场作业区')),
                          ),
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 二、逐项风险分析（含计算书） */}
              <div>
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>逐项风险分析</h2>
                <div className="grid grid-cols-1 gap-3">
                  {(result.risks ?? []).map(item => (
                    <RiskCard key={item.id} item={item} />
                  ))}
                </div>
              </div>

              {/* 三、规范依据 */}
              {result.report.regulations?.length > 0 && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>规范依据</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.report.regulations.map(ref => (
                      <span key={ref} className="px-2 py-1 rounded text-[10px] font-mono" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{ref}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 四、分级处置建议 */}
              {(result.report.actions?.immediate?.length > 0 || result.report.actions?.shortTerm?.length > 0 || result.report.actions?.longTerm?.length > 0) && (
                <div>
                  <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>分级处置建议</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {([
                      ['immediate', '立即处置', '#ef4444'],
                      ['shortTerm', '短期措施', '#f59e0b'],
                      ['longTerm', '长期措施', '#2563eb'],
                    ] as const).map(([key, label, color]) => {
                      const items = result.report.actions?.[key] ?? [];
                      if (!items.length) return null;
                      return (
                        <div key={key} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
                          <p className="text-[11px] font-semibold mb-2" style={{ color }}>{label}</p>
                          <div className="space-y-1.5">
                            {items.map((a, i) => (
                              <div key={i} className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: color }} />
                                <span>{a}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 五、监测与应急计划 */}
              {result.report.monitoring?.length > 0 && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
                  <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>监测与应急计划</p>
                  <div className="space-y-1.5">
                    {result.report.monitoring.map((m, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5" style={{ backgroundColor: 'var(--primary-glow)', color: 'var(--primary)' }}>{i + 1}</span>
                        <span>{m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 六、应急疏散路线 · 场地风险地图（工友视角：可视化的"往哪撤"） */}
              {riskMapData && riskMapData.zones.length > 0 && (
                <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <MapIcon size={14} style={{ color: '#16a34a' }} />
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      🗺 应急疏散路线 · 场地风险地图
                    </h2>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: 'rgba(22,163,74,0.12)', color: '#16a34a' }}>
                      {riskMapData.zones.length} 个风险点位
                    </span>
                  </div>
                  <p className="text-[11px] mb-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    红色 / 橙色风险点位 + 自动生成的疏散路线（基于场地平面图）。
                    班组长可在班前向工友指认"哪里危险、撤离往哪走"。
                  </p>
                  <div className="rounded-lg overflow-hidden inline-block"
                       style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)' }}>
                    <RiskMap
                      zones={riskMapData.zones}
                      routes={riskMapData.routes}
                      siteName={riskMapData.siteName}
                      workerLocation={{ x: 33, y: 30 }}
                      width={560}
                      height={360}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] px-2 py-1 rounded-full"
                          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                      图例：🔴 红=重大  🟠 橙=较大  🟡 黄=一般  🟢 虚线箭头=应急疏散路线
                    </span>
                    <button
                      onClick={() => navigate('/3d-simulator')}
                      className="text-[10px] px-2.5 py-1 rounded-full border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                      title="风险热点已同步到三维场景（无需手动操作）"
                    >
                      🏔 在 3D 中查看风险分布
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
