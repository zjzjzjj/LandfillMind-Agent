import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BrainCircuit, Play, ChevronDown, ChevronUp, CheckCircle2, Loader2, XCircle, Clock, SlidersHorizontal, FileDown, MessageSquare, Zap, Activity, GitMerge, FlaskConical, AlertTriangle, HelpCircle } from 'lucide-react';
import type { AgentStatus, ThinkingStep, MAGradeLevel, MADomainFinding, MACrossFinding } from '../types';
import { buildMultiAgentMarkdown, downloadJSON, downloadText, openPrintableHtml, timestampName } from '../utils/exporter';
import { useDetailPref } from '../utils/detailPref';
import { PAGE_MAXW } from '../utils/layout';

interface AgentInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
}

// 等级 → 颜色/背景/排名（仪表盘用）
// unknown = 该领域无实测数据，不定级；rank 取 -1，不参与综合聚合
const GRADE_RANK: Record<Grade, number> = { green: 0, blue: 1, yellow: 2, orange: 3, red: 4, unknown: -1 };
const GRADE_COLOR: Record<Grade, string> = {
  green: '#16a34a', blue: '#2563eb', yellow: '#ca8a04', orange: '#ea580c', red: '#dc2626',
  unknown: '#94a3b8',
};
const GRADE_BG: Record<Grade, string> = {
  red: 'rgba(220,38,38,0.10)',
  orange: 'rgba(234,88,12,0.10)',
  yellow: 'rgba(202,138,4,0.10)',
  blue: 'rgba(37,99,235,0.10)',
  green: 'rgba(22,163,74,0.10)',
  unknown: 'rgba(148,163,184,0.10)',
};
const GRADE_LABEL: Record<Grade, string> = {
  red: '重大', orange: '较大', yellow: '一般', blue: '较低', green: '正常', unknown: '数据不足',
};

/** 数据置信度标签（与后端 domains.ts CONFIDENCE_LABEL 对应） */
const CONFIDENCE_LABEL: Record<string, string> = {
  measured: '全部实测',
  estimated: '含估算值',
  insufficient: '数据不足',
};
/** 参数出处徽章 */
const ORIGIN_LABEL: Record<string, { text: string; color: string }> = {
  USER_DEFINED: { text: '用户指定', color: '#2563eb' },
  FROM_TEXT: { text: '文本提取', color: '#0891b2' },
  ESTIMATED: { text: '估算值', color: '#d97706' },
  COMPUTED: { text: '派生', color: '#7c3aed' },
  DEFAULT: { text: '默认值', color: '#64748b' },
};

type Grade = MAGradeLevel;
const AGENTS: AgentInfo[] = [
  { id: 'slope', name: '边坡稳定分析', icon: '⛰️', color: '#10b981', description: 'Fs 圆弧滑动 + CJJ 176 校核' },
  { id: 'leachate', name: '渗滤液诊断', icon: '💧', color: '#3b82f6', description: 'HELP 产量 + 导排评估' },
  { id: 'lfg', name: '填埋气监测', icon: '🔥', color: '#f59e0b', description: 'LandGEM + 爆炸极限' },
  { id: 'gw', name: '地下水评估', icon: '🌊', color: '#06b6d4', description: '水质对比 + 污染羽圈定' },
  { id: 'summary', name: '综合风险评估', icon: '🎯', color: '#8b5cf6', description: '多维度汇总 + 优先级排序' },
];

function StatusBadge({ status }: { status: AgentStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(6,182,212,0.1)', color: '#06b6d4' }}>
        <Loader2 size={9} className="animate-spin" />
        推理中
      </span>
    );
  }
  if (status === 'waiting') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}>
        <Clock size={9} />
        等待同伴
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
        <CheckCircle2 size={9} />
        完成
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
        <XCircle size={9} />
        错误
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
      待机
    </span>
  );
}

// P1-3 修复：LRU 缓存命中信息（前端在卡片右上角闪一个 ⚡ 闪卡徽标，让"零模型成本秒回放"工程亮点对评委可见）
interface CacheHitInfo {
  cachedAt: number;     // 后端落缓存时刻（ms）
  scenario: string;     // 命中的场景摘要（最多 80 字）
}

function AgentCard({
  agent, status, result, thinkingSteps, cacheHit, finding, onAskExpert,
}: {
  agent: AgentInfo;
  status: AgentStatus;
  result?: string;
  thinkingSteps: ThinkingStep[];
  cacheHit?: CacheHitInfo;
  /** 结构化结论（等级/置信度/隐患/证据链）——后端 agent_result.finding */
  finding?: MADomainFinding;
  onAskExpert?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const confidence = finding?.confidence;
  const confColor = confidence === 'measured' ? '#16a34a' : confidence === 'estimated' ? '#d97706' : '#94a3b8';
  const hazards = finding?.hazards ?? [];

  return (
    <div
      className="relative rounded-2xl border overflow-hidden transition-all duration-300"
      style={{
        borderColor: cacheHit ? '#fbbf24' : 'var(--border)',
        backgroundColor: 'var(--bg-surface)',
        boxShadow: cacheHit ? '0 0 18px rgba(251, 191, 36, 0.35)' : undefined,
      }}
    >
      {/* 顶部色条 */}
      <div className="h-0.5" style={{ backgroundColor: agent.color }} />

      <div className="p-4">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{agent.icon}</span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{agent.description}</p>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* P1-3 修复：⚡ 闪卡徽标——LRU 命中可视化（金色边框 + glow + 0.3s 渐入动画） */}
        <AnimatePresence>
          {cacheHit && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="mb-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border"
              style={{
                borderColor: '#fbbf24',
                color: '#f59e0b',
                backgroundColor: 'rgba(251, 191, 36, 0.08)',
                boxShadow: '0 0 12px rgba(251, 191, 36, 0.25) inset',
              }}
              title={`LRU 缓存命中 · 落缓存时刻 ${new Date(cacheHit.cachedAt).toLocaleTimeString()}`}
            >
              <Zap size={11} fill="#fbbf24" stroke="#fbbf24" />
              <span>命中 LRU 缓存（零模型成本秒回放）</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 进度条 */}
        {status === 'running' && (
          <div className="h-1 rounded-full overflow-hidden mb-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: agent.color }}
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 20, ease: 'linear' }}
            />
          </div>
        )}

        {/* 思维链 */}
        {thinkingSteps.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => setExpanded(e => !e)}
              className="flex items-center gap-1 text-[10px] mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              思维链 ({thinkingSteps.length} 步)
            </button>
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1">
                    {thinkingSteps.map((step, i) => (
                      <div key={step.id} className="flex items-start gap-2 text-[10px]">
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '8px' }}
                        >
                          {i + 1}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 数据置信度 + 缺测提示（缺测的监测指标绝不用默认值冒充实测） */}
        {finding && (
          <div className="mb-2 space-y-1.5">
            {confidence && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border"
                style={{ borderColor: confColor + '60', color: confColor, backgroundColor: confColor + '14' }}
              >
                <FlaskConical size={9} />
                数据置信度：{CONFIDENCE_LABEL[confidence] ?? confidence}
              </span>
            )}
            {finding.missing.length > 0 && (
              <div
                className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] leading-relaxed"
                style={{ backgroundColor: 'rgba(148,163,184,0.10)', color: 'var(--text-muted)' }}
              >
                <HelpCircle size={11} className="shrink-0 mt-0.5" />
                <span>本次缺少实测：{finding.missing.slice(0, 6).join('、')}{finding.missing.length > 6 ? ` 等 ${finding.missing.length} 项` : ''}</span>
              </div>
            )}
          </div>
        )}

        {/* 命中隐患（含判据与规范依据，可追溯） */}
        {hazards.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {hazards.map((h, i) => {
              const c = (GRADE_COLOR as Record<string, string>)[h.severity] ?? 'var(--text-muted)';
              return (
                <div key={i} className="px-2.5 py-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: `2px solid ${c}` }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{h.type}</span>
                    <span className="text-[10px] font-mono shrink-0" style={{ color: c }}>{(GRADE_LABEL as Record<string, string>)[h.severity] ?? h.severity}</span>
                  </div>
                  <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {h.value && <div>实测：{h.value}</div>}
                    {h.threshold && <div>判据：{h.threshold}</div>}
                    {h.reference && <div style={{ color: 'var(--text-muted)' }}>依据：{h.reference}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 证据链（工具 / 入参含出处 / 结果 / 规范依据） */}
        {finding && finding.evidence.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => setEvidenceOpen(o => !o)}
              className="flex items-center gap-1 text-[10px] mb-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {evidenceOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              证据链 ({finding.evidence.length} 次工具调用)
            </button>
            <AnimatePresence>
              {evidenceOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5">
                    {finding.evidence.map((e, i) => (
                      <div key={i} className="px-2 py-1.5 rounded-lg text-[10px]" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          {e.ok ? <CheckCircle2 size={9} style={{ color: '#16a34a' }} /> : <XCircle size={9} style={{ color: '#ef4444' }} />}
                          <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{e.tool}</span>
                        </div>
                        {e.params.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {e.params.map((p, j) => {
                              const o = ORIGIN_LABEL[p.origin] ?? { text: p.origin, color: '#64748b' };
                              return (
                                <span key={j} className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
                                  {p.label}={typeof p.value === 'number' ? Math.round(p.value * 100) / 100 : p.value}{p.unit ?? ''}
                                  <span className="ml-1" style={{ color: o.color }}>·{o.text}</span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {e.paramsText && <div style={{ color: 'var(--text-secondary)' }}>{e.paramsText}</div>}
                        {e.value !== undefined && <div style={{ color: 'var(--text-primary)' }}>结果：{e.value}{e.unit ?? ''}</div>}
                        {e.headline && <div style={{ color: 'var(--text-secondary)' }}>{e.headline}</div>}
                        {e.ref && <div style={{ color: 'var(--text-muted)' }}>依据：{e.ref}</div>}
                        {e.warnings.map((w, j) => (
                          <div key={j} className="flex items-start gap-1 mt-0.5" style={{ color: '#d97706' }}>
                            <AlertTriangle size={9} className="shrink-0 mt-0.5" />{w}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 结果 */}
        {result && (
          <div
            className="p-2.5 rounded-xl text-xs leading-relaxed whitespace-pre-line"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            {result}
          </div>
        )}

        {/* 追问这位专家：跳转对话页继续深挖 */}
        {status === 'success' && result && onAskExpert && (
          <button
            onClick={onAskExpert}
            className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium border transition-colors"
            style={{ borderColor: agent.color, color: agent.color, backgroundColor: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = agent.color; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = agent.color; }}
          >
            <MessageSquare size={11} /> 追问这位专家
          </button>
        )}
      </div>
    </div>
  );
}

// 演示场景（默认值，用户可修改后重新运行）
// 说明：服务端 server/multiagent.ts 有一份对应的 DEMO_SCENARIO 用于启动预热。
// 两处文本需保持**空白等价**（缓存键已做空白归一化，CRLF/LF 或缩进差异不会再导致预热失效）；
// 但实质内容若改动，两处都要改，否则预热的是另一个场景。
const DEMO_SCENARIO = `某填埋场运营 15 年，近期监测发现渗滤液水位上升 0.8m，
周边 200m 处地下水氯离子浓度从 50mg/L 升至 280mg/L，
堆体表面出现 3 条裂缝（最长 12m，宽 3cm），
甲烷浓度 35% LEL。请给出综合诊断报告。`;

export default function MultiAgentPage() {
  const navigate = useNavigate();

  // 各领域专家的追问引导问题（紧扣多智能体结论，避免"重新发明轮子"）
  const EXPERT_FOLLOWUP: Record<string, string> = {
    slope: '请基于你的边坡稳定分析，给出具体的加固措施（按立即/短期/长期排序），并估算工程量与工期。',
    leachate: '请基于你的渗滤液诊断，详细给出导排系统排查清单、应急抽排方案，以及雨污分流复核要点。',
    lfg: '请基于你的填埋气监测结论，给出强制集气/动火审批/场界监测的完整处置清单，并量化 CH4 控制目标。',
    gw: '请基于你的地下水评估，给出下游监测井加密布置方案、阻隔墙/水力控制可行性与溯源计划。',
    summary: '请把综合报告改写成给现场负责人的"72 小时行动表"：每项注明责任人、所需资源、判定标准。',
  };

  // 把当前 Agent 的结论作为上下文预填，跳转统一智能体对话（v5：不再注入专家 persona，走统一工具型 Agent）
  const handleAskExpert = (agentId: string, agentName: string, agentResult: string) => {
    const followUp = EXPERT_FOLLOWUP[agentId] ?? '请基于你的分析进一步展开。';
    const trimmedScenario = (scenario ?? '').trim().slice(0, 500);
    const trimmedResult = (agentResult ?? '').slice(0, 600);
    const question = [
      `【多智能体协同 · 深入 ${agentName}】`,
      '',
      '【诊断场景】',
      trimmedScenario,
      '',
      `【${agentName} 已得出的结论摘要】`,
      trimmedResult,
      '',
      '【请进一步回答】' + followUp,
    ].join('\n');
    // 仅写入问题预填（同一会话机制），不再写 chat-prefill-expert（专家 persona 已移除）
    sessionStorage.setItem('chat-prefill', question);
    navigate('/chat/new');
  };
  const [scenario, setScenario] = useState(DEMO_SCENARIO);
  const [running, setRunning] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramHeight, setParamHeight] = useState('25');
  const [paramAngle, setParamAngle] = useState('30');
  const [paramDepth, setParamDepth] = useState('10');
  // P1-4 修复：回答详细度三档（brief/standard/detailed），持久化到 localStorage 后透传到 /api/multiagent
  const [detail, setDetail] = useDetailPref('multiagent');
  // P1-3 修复：记录每个 agent 的 LRU 缓存命中信息，供 AgentCard 渲染 ⚡ 闪卡徽标
  //   重跑时由 handleRun 清空，保证徽标状态与最新一次运行对齐
  const [cacheHits, setCacheHits] = useState<Record<string, CacheHitInfo>>({});
  const [agentStates, setAgentStates] = useState<Record<string, { status: AgentStatus; result?: string; steps: ThinkingStep[]; grade?: Grade; finding?: MADomainFinding }>>({
    slope: { status: 'idle', steps: [] },
    leachate: { status: 'idle', steps: [] },
    lfg: { status: 'idle', steps: [] },
    gw: { status: 'idle', steps: [] },
    summary: { status: 'idle', steps: [] },
  });
  // 总工事件携带的交叉研判结论（复合风险）
  const [crossFindings, setCrossFindings] = useState<MACrossFinding[]>([]);

  // 仪表盘：按维度聚合 + 综合等级
  // 注意：unknown（无实测数据）与 idle（未分析）都不参与聚合，
  // 未分析时综合等级为 null —— 不再默认显示"正常"（旧实现初始全绿）
  const agentDashboard = useMemo(() => {
    const dimension: Record<string, Grade> = { slope: 'unknown', leachate: 'unknown', lfg: 'unknown', gw: 'unknown' };
    let overall: Grade | null = null;
    (['slope', 'leachate', 'lfg', 'gw'] as const).forEach((k) => {
      const g = agentStates[k]?.grade;
      if (!g) return;
      dimension[k] = g;
      if (g === 'unknown') return;
      if (overall === null || GRADE_RANK[g] > GRADE_RANK[overall]) overall = g;
    });
    // 颜色在此算好：overall 可空，JSX 里不能拿它当索引
    const overallColor = overall ? GRADE_COLOR[overall] : '#94a3b8';
    const overallBg = overall ? GRADE_BG[overall] : 'transparent';
    return { dimension, overall, overallColor, overallBg };
  }, [agentStates]);


  // 单个 Agent 的 SSE 消费（onResult 回调用于收集同伴结论，规避 setState 异步竞态）
  const runOne = async (
    id: string,
    onResult?: (result: string, grade?: string, finding?: MADomainFinding) => void,
    extraBody?: Record<string, unknown>,
  ) => {
    try {
      const res = await fetch('/api/multiagent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // P1-4 修复：detail 透传到 /api/multiagent，影响后端 maxTokens 与 promptSuffix
        body: JSON.stringify({ scenario, agent: id, detail, ...extraBody }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const raw of lines) {
          const trimmed = raw.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }
          if (ev.type === 'agent_step') {
            setAgentStates(prev => {
              const cur = prev[id];
              const steps = [...(cur.steps ?? []), ev.step];
              return { ...prev, [id]: { ...cur, steps } };
            });
          } else if (ev.type === 'agent_result') {
            onResult?.(ev.result ?? '', ev.grade, ev.finding);
            // P0 修复：agent_result 携带的 grade 写入 state，综合仪表盘才能反映真实风险等级
            //   （此前只写 status/result/steps，agentDashboard 读 (agentStates[k]).grade 恒为 undefined → 全绿）
            // v5.1：一并保存结构化 finding（等级/置信度/隐患/证据链）
            const g = ev.grade as Grade | undefined;
            setAgentStates(prev => ({
              ...prev,
              [id]: {
                status: 'success',
                result: ev.result,
                steps: ev.steps ?? prev[id].steps,
                grade: g ?? prev[id].grade,
                finding: ev.finding ?? prev[id].finding,
              },
            }));
            // 总工事件携带的交叉研判（复合风险）
            if (id === 'summary' && Array.isArray(ev.crossFindings)) {
              setCrossFindings(ev.crossFindings as MACrossFinding[]);
            }
          } else if (ev.type === 'error') {
            setAgentStates(prev => ({ ...prev, [id]: { ...prev[id], status: 'error' } }));
          } else if (ev.type === 'cache_hit') {
            // P1-3 修复：把 LRU 命中信息落到 cacheHits state，AgentCard 据此渲染 ⚡ 闪卡徽标
            setCacheHits(prev => ({
              ...prev,
              [id]: { cachedAt: ev.cachedAt ?? Date.now(), scenario: ev.scenario ?? '' },
            }));
          }
        }
      }
    } catch {
      setAgentStates(prev => ({ ...prev, [id]: { ...prev[id], status: 'error' } }));
    }
  };

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    // 瀑布式：4 个领域专家并行（GLM 通道在服务端串行排队），summary 先等待同伴
    const domainIds = ['slope', 'leachate', 'lfg', 'gw'];
    // P1-3 修复：每次新运行前清空 LRU 命中徽标，让"上一次命中/这次重算"状态对齐最新一轮结果
    setCacheHits({});
    setAgentStates({
      slope: { status: 'running', steps: [] },
      leachate: { status: 'running', steps: [] },
      lfg: { status: 'running', steps: [] },
      gw: { status: 'running', steps: [] },
      summary: { status: 'waiting', steps: [] },
    });

    // 场景参数：表单显式传参，留空字段由服务端智能抽取/默认值兜底
    const params = {
      height: paramHeight.trim() === '' ? undefined : parseFloat(paramHeight),
      slopeAngle: paramAngle.trim() === '' ? undefined : parseFloat(paramAngle),
      waterLevelDepth: paramDepth.trim() === '' ? undefined : parseFloat(paramDepth),
    };

  const peerResults: Record<string, { result: string; grade?: string }> = {};
  // 结构化结论一并回传：总工的交叉研判需要各领域的隐患与等级（只靠散文无法判定复合风险）
  const peerFindings: Record<string, MADomainFinding> = {};
    setCrossFindings([]);
    await Promise.all(
      domainIds.map(id => runOne(id, (result, grade, finding) => {
        peerResults[id] = { result, grade };
        if (finding) peerFindings[id] = finding;
      }, { params }))
    );

    // 4 个领域专家全部落定后，综合 Agent 携带同伴结论登场
    setAgentStates(prev => ({ ...prev, summary: { status: 'running', steps: [] } }));
    await runOne('summary', undefined, { peerResults, peerFindings, params });
    setRunning(false);
  };

  const hasResults = Object.values(agentStates).some(s => s.status === 'success' && s.result);
  // 导出条目带上等级/置信度/隐患/证据链（v5.1：导出报告不再只有 LLM 散文）
  const exportAgents = AGENTS.map(a => {
    const st = agentStates[a.id];
    const f = st.finding;
    return {
      name: a.name,
      icon: a.icon,
      status: st.status,
      result: st.result,
      gradeLabel: st.grade ? GRADE_LABEL[st.grade] : undefined,
      confidenceLabel: f?.confidence ? CONFIDENCE_LABEL[f.confidence] : undefined,
      keyFinding: f?.keyFinding,
      missing: f?.missing,
      hazards: f?.hazards,
      evidence: f?.evidence,
    };
  });
  const exportParams: Record<string, string> = {
    '堆体高度 H（m）': paramHeight.trim() || '留空（由场景文本提取 / 典型值估算）',
    '坡角 β（°）': paramAngle.trim() || '留空（由场景文本提取 / 典型值估算）',
    '水位埋深（m）': paramDepth.trim() || '留空（由场景文本提取 / 典型值估算）',
  };
  const exportMd = () => downloadText(timestampName('多智能体报告', 'md'), buildMultiAgentMarkdown(scenario, exportParams, exportAgents, crossFindings));
  const exportHtml = () => openPrintableHtml('多智能体联合诊断报告', buildMultiAgentMarkdown(scenario, exportParams, exportAgents, crossFindings));
  const exportJson = () => downloadJSON(timestampName('多智能体报告', 'json'), { scenario, params: exportParams, agents: exportAgents, crossFindings });

  return (
    <div className="flex-1 overflow-y-auto app-bg">
      {/* 顶部大标题 */}
      <div
        className="relative overflow-hidden hero-gradient"
      >
        <div className="hero-blob" style={{ width: 380, height: 380, background: 'rgba(124,58,237,0.5)', top: -120, right: -60 }} />
        <div className="hero-blob" style={{ width: 320, height: 320, background: 'rgba(14,165,183,0.5)', bottom: -110, left: -50, animationDelay: '2s' }} />
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="absolute inset-x-0 bottom-0 h-20" style={{ background: 'linear-gradient(to top, var(--bg-base), transparent)' }} />
        <div className="relative z-10 px-6 py-8 max-w-5xl mx-auto 3xl:max-w-6xl 3xl:py-12">
          <div className="flex items-center gap-2 mb-3">
            <BrainCircuit size={22} style={{ color: 'var(--primary)' }} />
            <h1 className="text-xl 3xl:text-3xl font-bold" style={{ color: '#ffffff' }}>多智能体协同</h1>
          </div>
          <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.85)' }}>
            5 个专业 Agent 并行推理，覆盖边坡/渗滤液/填埋气/地下水四大维度，思维链全程可见，综合报告一键生成。
          </p>
          {/* 场景输入 */}
          <div className="relative">
            <textarea
              value={scenario}
              onChange={e => setScenario(e.target.value)}
              rows={3}
              className="w-full p-3 rounded-xl text-sm resize-none border outline-none placeholder:text-slate-400"
              style={{
                backgroundColor: 'rgba(255,255,255,0.92)',
                borderColor: 'rgba(255,255,255,0.6)',
                color: '#0b2138',
              }}
              placeholder="输入诊断场景..."
            />
            <button
              onClick={handleRun}
              disabled={running}
              className="btn-gradient absolute bottom-3 right-3 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? '分析中...' : '启动分析'}
            </button>
          </div>

          {/* 场景参数（可选）：显式填参最稳，留空由服务端智能抽取 */}
          <div className="mt-3">
            <button
              onClick={() => setParamsOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.12)' }}
            >
              <SlidersHorizontal size={12} />
              场景参数（可选）
              {paramsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {!paramsOpen && (
              <span className="ml-3 text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                默认 H=25m、β=30°、水位埋深 10m；留空自动从文本智能抽取
              </span>
            )}
            <AnimatePresence>
              {paramsOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 grid grid-cols-3 gap-3 max-w-xl 3xl:max-w-2xl">
                    {[
                      { label: '堆体高度 H（m，5~60）', value: paramHeight, set: setParamHeight, ph: '25' },
                      { label: '坡角 β（°，10~60）', value: paramAngle, set: setParamAngle, ph: '30' },
                      { label: '水位埋深（m，0~30）', value: paramDepth, set: setParamDepth, ph: '10' },
                    ].map(f => (
                      <label key={f.label} className="block">
                        <span className="block text-[10px] mb-1" style={{ color: 'rgba(255,255,255,0.85)' }}>{f.label}</span>
                        <input
                          type="number"
                          value={f.value}
                          placeholder={f.ph}
                          onChange={e => f.set(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
                          style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: '#0b2138' }}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => { setParamHeight('25'); setParamAngle('30'); setParamDepth('10'); }}
                    className="mt-2 text-[10px] underline underline-offset-2"
                    style={{ color: 'rgba(255,255,255,0.85)' }}
                  >
                    恢复智能默认值
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* P1-4 修复：回答详细度三档（与 ChatPage 一致风格，持久化到 localStorage） */}
          <div className="mt-3 flex items-center gap-1 p-1 rounded-lg w-fit" style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}>
            <span className="text-[10px] font-semibold px-1.5" style={{ color: 'rgba(255,255,255,0.85)' }}>回答详细度</span>
            {([['brief', '摘要'], ['standard', '标准'], ['detailed', '详细']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDetail(key)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150"
                style={{
                  backgroundColor: detail === key ? 'rgba(255,255,255,0.92)' : 'transparent',
                  color: detail === key ? '#0b2138' : 'rgba(255,255,255,0.85)',
                  boxShadow: detail === key ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {label}
              </button>
            ))}
            {detail === 'detailed' && (
              <span className="ml-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>详细模式：回复更全面，生成时间更长</span>
            )}
          </div>
        </div>
      </div>

      {/* Agent 卡片网格 */}
      <div className={`${PAGE_MAXW} px-6 3xl:px-8 py-6`}>
        {agentDashboard && (
          <div
            className="rounded-2xl border p-5 mb-6 overflow-hidden relative"
            style={{
              borderColor: agentDashboard.overallColor + '40',
              background: `linear-gradient(135deg, var(--bg-surface) 0%, ${agentDashboard.overallBg} 100%)`,
            }}
          >
            {/* 顶部条：标题 + 综合风险等级大徽章 */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity size={16} style={{ color: agentDashboard.overall ? GRADE_COLOR[agentDashboard.overall] : 'var(--text-muted)' }} />
                <span className="text-sm 3xl:text-base font-semibold" style={{ color: 'var(--text-primary)' }}>综合仪表盘</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>4 维度风险等级聚合</span>
                {crossFindings.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}>
                    <GitMerge size={9} />复合风险 {crossFindings.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>综合风险</span>
                {agentDashboard.overall === null ? (
                  // 未分析（或各领域均无实测数据）时不显示等级 —— 旧实现初始恒显示"正常"，是误导
                  <div className="px-3 py-1.5 rounded-full text-sm font-bold"
                       style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                    {running ? '分析中…' : '未定级'}
                  </div>
                ) : (
                  <div
                    className="px-3 py-1.5 rounded-full text-sm font-bold flex items-center gap-1.5"
                    style={{ backgroundColor: GRADE_COLOR[agentDashboard.overall], color: '#ffffff' }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {GRADE_LABEL[agentDashboard.overall]}
                  </div>
                )}
              </div>
            </div>
            {/* 4 维度卡片 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {AGENTS.filter(a => a.id !== 'summary').map((a) => {
                const st = agentStates[a.id].status;
                const analyzed = st === 'success';
                const g = agentDashboard.dimension[a.id];
                const dimColor = analyzed ? GRADE_COLOR[g] : '#94a3b8';
                const rank = analyzed ? GRADE_RANK[g] : -1;
                return (
                  <div
                    key={a.id}
                    className="rounded-xl p-3.5 relative overflow-hidden transition-transform hover:-translate-y-0.5"
                    style={{
                      border: `1px solid ${dimColor}40`,
                      backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    {/* 顶部色条 */}
                    <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(90deg, ${a.color}, ${dimColor})` }} />
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">{a.icon}</span>
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                      </div>
                    </div>
                    <div
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold font-mono mb-2"
                      style={{ backgroundColor: analyzed ? GRADE_BG[g] : 'var(--bg-surface)', color: analyzed ? dimColor : 'var(--text-muted)' }}
                    >
                      {analyzed ? GRADE_LABEL[g] : (st === 'running' || st === 'waiting' ? '分析中' : '未分析')}
                    </div>
                    {/* 严重度进度条（5 段） */}
                    <div className="flex gap-1">
                      {(['green', 'blue', 'yellow', 'orange', 'red'] as Grade[]).map((s, i) => (
                        <div
                          key={i}
                          className="h-1.5 flex-1 rounded-full transition-colors"
                          style={{ backgroundColor: rank >= i ? GRADE_COLOR[s] : 'rgba(0,0,0,0.06)' }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* "各领域分析" 标题 + 导出按钮（仅结果就绪时显示） */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm 3xl:text-base font-semibold" style={{ color: 'var(--text-primary)' }}>各领域分析</h2>
          {hasResults && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold mr-1" style={{ color: 'var(--text-muted)' }}>导出</span>
              <button
                onClick={exportMd}
                className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <FileDown size={12} /> MD
              </button>
              <button
                onClick={exportHtml}
                className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <FileDown size={12} /> HTML·PDF
              </button>
              <button
                onClick={exportJson}
                className="text-[11px] px-2.5 py-1 rounded-lg border flex items-center gap-1 transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <FileDown size={12} /> JSON
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 3xl:gap-6">
          {AGENTS.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              status={agentStates[agent.id].status}
              result={agentStates[agent.id].result}
              thinkingSteps={agentStates[agent.id].steps}
              cacheHit={cacheHits[agent.id]}
              finding={agentStates[agent.id].finding}
              onAskExpert={() => handleAskExpert(agent.id, agent.name, agentStates[agent.id].result ?? '')}
            />
          ))}
        </div>

        {/* 综合报告 */}
        <AnimatePresence>
          {agentStates.summary.status === 'success' && agentStates.summary.result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 rounded-2xl border overflow-hidden"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="h-1" style={{ background: 'linear-gradient(90deg, #06b6d4, #8b5cf6)' }} />
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={16} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-sm 3xl:text-base font-semibold" style={{ color: 'var(--text-primary)' }}>综合诊断报告</h2>
                  {agentStates.summary.finding?.keyFinding && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{agentStates.summary.finding.keyFinding}</span>
                  )}
                </div>

                {/* 复合风险（交叉研判）：由确定性规则命中，非 LLM 自由发挥 */}
                {crossFindings.length > 0 && (
                  <div className="mb-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      <GitMerge size={12} style={{ color: '#8b5cf6' }} />
                      复合风险交叉研判（命中 {crossFindings.length} 条工程耦合判据）
                    </div>
                    {crossFindings.map((cf) => {
                      const c = (GRADE_COLOR as Record<string, string>)[cf.severity] ?? 'var(--text-muted)';
                      return (
                        <div key={cf.id} className="px-3 py-2.5 rounded-xl" style={{ backgroundColor: 'var(--bg-elevated)', borderLeft: `3px solid ${c}` }}>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>{cf.title}</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded shrink-0" style={{ backgroundColor: GRADE_BG[cf.severity as Grade] ?? 'transparent', color: c }}>
                              {(GRADE_LABEL as Record<string, string>)[cf.severity] ?? cf.severity}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {cf.basis.map((b, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>{b}</span>
                            ))}
                          </div>
                          <div className="text-[10px] leading-relaxed mb-1" style={{ color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>机理：</span>{cf.reasoning}
                          </div>
                          <div className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            <span style={{ color: 'var(--text-muted)' }}>联合处置：</span>{cf.advice}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className="p-3 rounded-xl text-xs 3xl:text-sm leading-relaxed whitespace-pre-line"
                  style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  {agentStates.summary.result}
                </div>
                {/* 追问总工：跳对话页继续深挖综合结论 */}
                <button
                  onClick={() => handleAskExpert('summary', '综合风险评估', agentStates.summary.result ?? '')}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium border transition-colors"
                  style={{ borderColor: '#8b5cf6', color: '#8b5cf6', backgroundColor: 'transparent' }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#8b5cf6'; e.currentTarget.style.color = '#fff'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#8b5cf6'; }}
                >
                  <MessageSquare size={11} /> 追问总工
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
