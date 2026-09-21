import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Square, ChevronDown, ChevronUp, Bot, User, AlertCircle, Loader2, FileDown, Lightbulb } from 'lucide-react';
import type { Message, ToolCall, Agent, ModelOption, PermissionMode, FollowUpItem } from '../types';
import { useDetailPref } from '../utils/detailPref';
import { buildChatMarkdown, downloadJSON, downloadText, timestampName } from '../utils/exporter';
import { FeedbackWidget } from '../components/FeedbackWidget';

// ========================
// 知识库检索增强 / 工程计算内核 卡片
//   注：兼容路径（GLM/兼容通道）下这是后端 RAG / 计算结果回放的 UI 展示；
//   仅在 CODEBUDDY_API_KEY 设置时才是 SDK 真实产出的工具调用循环。
//   type 字段（'kb' / 'calc'）由后端显式回传（kind）——UI 据此分类渲染。
//   v5：工具输出统一为 ToolRun 信封 { runId, tool, label, params, result, unit, grade, ... }，
//       此处 unwrapOutput 解包出 result 作为卡片 payload；KD 其余字段用于"参数与出处"展示。
// ========================
function unwrapOutput(output: unknown): { run: any; payload: any } {
  try {
    const parsed = typeof output === 'string' ? JSON.parse(output) : output;
    if (parsed && typeof parsed === 'object' && typeof parsed.runId === 'string' && 'result' in parsed && 'tool' in parsed) {
      return { run: parsed, payload: parsed.result };
    }
    return { run: null, payload: parsed };
  } catch {
    return { run: null, payload: output };
  }
}

const ORIGIN_LABEL: Record<string, string> = {
  USER_DEFINED: '用户指定', FROM_TEXT: '文本提取', ESTIMATED: '智能体估算', DEFAULT: '默认值', INVALID: '越界(取边界)',
};

function ToolCallCard({ tc }: { tc: ToolCall }) {
  // scene（AI 生成 3D 场景）/ model（智能体建模中枢）/ kernel（权威内核）默认展开——核心演示功能
  const kind: 'kb' | 'calc' | 'ogs' | 'scene' | 'kernel' | 'model' | 'diagnosis' | 'deep' | 'report' = tc.type
    ?? (tc.name === 'buildScene' ? 'scene'
      : tc.name === 'buildModel' ? 'model'
      : tc.name === 'kb_lookup' ? 'kb'
      : tc.name === 'ogs_sim' || tc.name === 'run_ogs_scenario' ? 'ogs'
      : tc.name === 'run_3d_kernel' ? 'kernel'
      : tc.name === 'calculate' || tc.name === 'run_diagnosis' || tc.name === 'analyze_site' ? 'calc'
      : tc.name === 'deep_analysis' ? 'deep'
      : 'kb');
  const [open, setOpen] = useState(() => kind === 'scene' || kind === 'model' || kind === 'kernel');
  const statusColor = tc.status === 'success' ? '#10b981' : tc.status === 'error' ? '#ef4444' : '#06b6d4';

  // 标题与图标按类型分类
  const headerLabel = kind === 'kb' ? '🔍 知识库检索增强'
    : kind === 'ogs' ? '🌐 稳定化计算（OpenGeoSys 求解）'
    : kind === 'scene' ? '🏗 AI 生成 3D 场景'
    : kind === 'kernel' ? '🧊 权威内核（Landfill 3D Tool）'
    : kind === 'model' ? '🧠 智能体建模中枢'
    : kind === 'diagnosis' ? '⚠ 场地风险诊断（双引擎）'
    : kind === 'deep' ? '🧠 多智能体深度分析'
    : '⚙ 工程计算（确定性内核）';

  // v5：统一解包 ToolRun 信封 → payload 为工具原生结果
  const { run, payload } = unwrapOutput(tc.output);

  // KB 输出：entries 数组的直接渲染（ref / clause 为引用徽章）
  let kbEntries: Array<{ title?: string; ref?: string; clause?: string }> | null = null;
  if (kind === 'kb' && payload !== undefined && Array.isArray(payload)) {
    kbEntries = payload as any;
  }

  // 计算输出：名 + 首条摘要 + 规范引用
  let calcSummary: { name?: string; analysis?: string; ref?: string } | null = null;
  if (kind === 'calc' && payload !== undefined && payload && typeof payload === 'object') {
    calcSummary = {
      name: payload.calcName ?? payload.name,
      analysis: payload.analysis,
      ref: payload.ref,
    };
  }

  // 稳定化计算输出：结构化运行结果
  let ogsResult: any = null;
  if (kind === 'ogs' && payload !== undefined) ogsResult = payload;

  // AI 生成 3D 场景输出：BuiltScene（geo / preset / snapshot / ogSummary）
  let sceneResult: any = null;
  if (kind === 'scene' && payload !== undefined) sceneResult = payload;

  // 权威内核输出：会话模式 { action, summary, stamp, data, figures, sceneHint, reportUrl }
  //                 或旧 module 快查模式 { stamp, result... }
  let kernelResult: any = null;
  if (kind === 'kernel' && payload !== undefined && payload && typeof payload === 'object') kernelResult = payload;

  // 建模中枢输出（旧会话兼容）：ModelBuilt（kind / title / summary / payload）
  let modelResult: any = null;
  if (kind === 'model' && payload !== undefined) modelResult = payload;

  // 双引擎诊断输出：DiagnosisResult（risks / overallRisk / report）
  let diagResult: any = null;
  if (kind === 'diagnosis' && payload !== undefined) diagResult = payload;

  // 多智能体建模卡片：风险等级 → 色点（与 MultiAgentPage GRADE_COLOR 一致）
  const MODEL_GRADE_COLOR: Record<string, string> = {
    green: '#16a34a', blue: '#2563eb', yellow: '#ca8a04', orange: '#ea580c', red: '#dc2626',
  };

  return (
    <div
      className="rounded-xl border overflow-hidden my-2"
      style={{ borderColor: 'var(--border)' }}
    >
      {/* 头部 */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ backgroundColor: 'var(--bg-elevated)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
        <span className="text-[11px] font-mono font-medium" style={{ color: 'var(--text-secondary)' }}>
          {headerLabel}
        </span>
        {tc.status === 'running' && <Loader2 size={11} className="animate-spin" style={{ color: statusColor }} />}
        {open ? <ChevronUp size={12} className="ml-auto" style={{ color: 'var(--text-muted)' }} />
               : <ChevronDown size={12} className="ml-auto" style={{ color: 'var(--text-muted)' }} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-2">
              {/* KB 类型：引用徽章 + 标题列表 */}
              {kind === 'kb' && kbEntries && kbEntries.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>引用规范</p>
                  <div className="flex flex-wrap gap-1.5">
                    {kbEntries.map((e, i) => (
                      <span key={'cite-' + i} className="chip" title={e.clause ?? ''}>
                        📖 {e.ref ?? '规范条目'}
                        {e.clause ? <span style={{ opacity: 0.7 }}> · {e.clause}</span> : null}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1">
                    {kbEntries.map((e, i) => (
                      e.title ? (
                        <div key={'t-' + i} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          · {e.title}
                        </div>
                      ) : null
                    ))}
                  </div>
                </div>
              )}

              {/* 计算类型：公式 + 规范引用 */}
              {kind === 'calc' && calcSummary && (
                <div>
                  {calcSummary.name && (
                    <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                      计算器：<span className="font-mono">{calcSummary.name}</span>
                    </p>
                  )}
                  {calcSummary.analysis && (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                         style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {calcSummary.analysis}
                    </pre>
                  )}
                  {calcSummary.ref && (
                    <span className="chip mt-1 inline-block" title={calcSummary.ref}>
                      📖 {calcSummary.ref}
                    </span>
                  )}
                </div>
              )}

              {/* 稳定化计算结果 */}
              {kind === 'ogs' && ogsResult && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                    场景：<span className="font-mono">{ogsResult.scenarioName ?? ogsResult.scenario}</span>
                    {ogsResult.ok ? <span className="ml-1.5 text-emerald-500">✓ 求解正常</span>
                                  : <span className="ml-1.5 text-rose-500">⚠ 未正常收敛</span>}
                  </p>
                  {ogsResult.summary && (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                         style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {ogsResult.summary}
                    </pre>
                  )}
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    求解耗时 {ogsResult.elapsedMs}ms · 模拟 {ogsResult.simulationTime ?? '-'}
                    {Array.isArray(ogsResult.timeSeries) && ogsResult.timeSeries.length > 0
                      ? ` · 时程输出 ${ogsResult.timeSeries.length} 组` : ''}
                  </p>
                  {ogsResult.ok && (ogsResult.scenario === 'settlement' || ogsResult.scenario === 'gas-production') && (
                    <button
                      onClick={() => {
                        try {
                          sessionStorage.setItem('scene-ogs', JSON.stringify({
                            kind: 'ogs', scenario: ogsResult.scenario, scenarioName: ogsResult.scenarioName,
                            timeSeries: ogsResult.timeSeries, ts: Date.now(),
                          }));
                        } catch { /* ignore */ }
                        window.open('/ogs-sim', '_blank');
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                      title={ogsResult.scenario === 'settlement' ? '沉降时程（稳定化计算页）' : '产气时程（稳定化计算页）'}
                    >
                      📈 查看时程曲线
                    </button>
                  )}
                </div>
              )}

              {/* AI 生成 3D 场景：BuiltScene 卡片（库容快照 + OGS 联动 + 打开仿真器） */}
              {kind === 'scene' && sceneResult && (
                <div className="space-y-1.5">
                  {sceneResult.snapshot?.desc && (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                         style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {sceneResult.snapshot.desc}
                    </pre>
                  )}
                  {sceneResult.ogSummary && (
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      🔥 联动稳定化计算：{sceneResult.ogSummary.scenario} 峰值{' '}
                      <span className="font-mono">{sceneResult.ogSummary.peakValue}{sceneResult.ogSummary.unit}</span>
                    </p>
                  )}
                </div>
              )}

              {/* 权威内核（Landfill 3D Tool）：会话模式 = 结论/口径/表格/图/简报/示意图场景 */}
              {kind === 'kernel' && kernelResult && (
                <div className="space-y-1.5">
                  {kernelResult.action ? (
                    <>
                      {kernelResult.summary && (
                        <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                             style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                          {kernelResult.summary}
                        </pre>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {kernelResult.stamp && (
                          <span className="chip" style={{ color: 'var(--text-muted)' }}>
                            内核 v{kernelResult.stamp.version} · 口径 {kernelResult.stamp.physics}/{kernelResult.stamp.kernel}
                          </span>
                        )}
                        {run?.grade && (
                          <span className="chip" style={{ color: MODEL_GRADE_COLOR[run.grade] ?? 'var(--text-secondary)', fontWeight: 700 }}>
                            {run.grade === 'red' ? '● 不满足/高风险' : run.grade === 'yellow' ? '● 需关注' : run.grade === 'green' ? '● 满足' : String(run.grade)}
                          </span>
                        )}
                        {typeof run?.elapsedMs === 'number' && (
                          <span className="chip" style={{ color: 'var(--text-muted)' }}>耗时 {(run.elapsedMs / 1000).toFixed(1)}s</span>
                        )}
                        {kernelResult.action === 'model' && (
                          <span className="chip" style={{ color: 'var(--primary)' }}>会话模型已就绪，可直接追问稳定性/沉降/污染分析</span>
                        )}
                      </div>
                      {/* 结果表（扫描表 / 污染五段表 / 开挖综合表通用形状 cols+rows） */}
                      {kernelResult.data?.table?.rows?.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                          <table className="w-full text-[10px]">
                            {Array.isArray(kernelResult.data.table.cols) && (
                              <thead>
                                <tr style={{ backgroundColor: 'var(--bg-input)' }}>
                                  {kernelResult.data.table.cols.map((c: unknown, i: number) => (
                                    <th key={i} className="px-2 py-1 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{String(c)}</th>
                                  ))}
                                </tr>
                              </thead>
                            )}
                            <tbody>
                              {kernelResult.data.table.rows.slice(0, 16).map((r: unknown, ri: number) => (
                                <tr key={ri} style={{ borderTop: '1px solid var(--border)' }}>
                                  {(Array.isArray(r) ? r : [r]).map((cell, ci) => (
                                    <td key={ci} className="px-2 py-1 font-mono" style={{ color: 'var(--text-secondary)' }}>
                                      {cell == null ? '' : typeof cell === 'number' ? +cell.toFixed(3) : String(cell)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {kernelResult.data.table.rows.length > 16 && (
                            <p className="px-2 py-1 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                              仅显示前 16 / {kernelResult.data.table.rows.length} 行，完整表格见对话正文与简报
                            </p>
                          )}
                        </div>
                      )}
                      {/* 关键数字（污染 key_numbers 等嵌套对象平铺） */}
                      {kernelResult.data?.key_numbers && (() => {
                        const leaves: Array<[string, unknown]> = [];
                        const walk = (o: any, p: string) => {
                          for (const [k, v] of Object.entries(o ?? {})) {
                            if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + k + '.');
                            else if (v != null && leaves.length < 16) leaves.push([p + k, v]);
                          }
                        };
                        walk(kernelResult.data.key_numbers, '');
                        return (
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {leaves.map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2 min-w-0">
                                <span className="truncate" style={{ color: 'var(--text-muted)' }} title={k}>{k}</span>
                                <span className="whitespace-nowrap">{typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      {/* 内核准确结果图（点击看原图） */}
                      {Array.isArray(kernelResult.figures) && kernelResult.figures.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {kernelResult.figures.map((f: any) => (
                            <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title={f.label}>
                              <img src={f.url} alt={f.label} loading="lazy"
                                   className="rounded-lg border max-h-40 object-contain"
                                   style={{ borderColor: 'var(--border)' }} />
                            </a>
                          ))}
                        </div>
                      )}
                      {(kernelResult.sceneHint || kernelResult.reportUrl || kernelResult.action) && (
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {kernelResult.action && (
                            <button
                              onClick={() => window.open('/3d-simulator', '_blank')}
                              className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                              style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                              title="真实三维模型查看器：直接渲染内核场地的顶面/坡面/基底网格，可旋转、剖切、开关图层"
                            >
                              🏔 真实三维模型 →
                            </button>
                          )}
                          <button
                            onClick={() => window.open('/tool', '_blank')}
                            className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            title="打开三维建模分析页（桌面工具同款布局：建模/库容/坡度/剖面/沉降/稳定性/污染/开挖，含真实三维网格与叠加层）"
                          >
                            🧰 三维建模分析
                          </button>
                          {kernelResult.reportUrl && (
                            <a
                              href={`${kernelResult.reportUrl}?dl=1`}
                              className="text-[10px] px-2.5 py-1 rounded-full border transition-colors inline-block"
                              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                            >
                              ⬇ 分析简报
                            </a>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    /* 旧 module 快查模式（示例场）：stamp + 原生结果 JSON 预览 */
                    <div className="space-y-1">
                      {kernelResult.stamp && (
                        <span className="chip text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          示例场快查 · 口径 {kernelResult.stamp.physics}/{kernelResult.stamp.kernel}
                        </span>
                      )}
                      <pre className="text-[10px] font-mono whitespace-pre-wrap rounded-lg p-2 overflow-x-auto"
                           style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', maxHeight: 200 }}>
                        {JSON.stringify(kernelResult, null, 1).slice(0, 1200)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* 双引擎诊断：综合风险 + 逐项风险 */}
              {kind === 'diagnosis' && diagResult && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                    综合风险：
                    <span style={{ color: MODEL_GRADE_COLOR[diagResult.overallRisk] ?? 'var(--text-primary)', fontWeight: 700 }}>
                      {diagResult.overallRisk ?? '—'}
                    </span>
                    {diagResult.dataCompleteness !== undefined && (
                      <span style={{ opacity: 0.7 }}> · 数据完整度 {(diagResult.dataCompleteness * 100).toFixed(0)}%</span>
                    )}
                  </p>
                  {Array.isArray(diagResult.risks) && diagResult.risks.map((r: any, i: number) => (
                    <div key={'risk-' + i} className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                        style={{ backgroundColor: MODEL_GRADE_COLOR[r.level] ?? '#94a3b8' }}
                      />
                      <span style={{ color: 'var(--text-primary)' }}>{r.category ?? r.title}</span>
                      {r.level ? <span className="chip mx-1">{r.level}</span> : null}
                      {r.suggestion ? <span className="opacity-80">{r.suggestion}</span> : null}
                    </div>
                  ))}
                </div>
              )}

              {/* 多智能体深度分析：4 领域 Agent 结论 + 综合评级 + 敏感性 */}
              {kind === 'deep' && payload && typeof payload === 'object' && (
                <div className="space-y-1.5">
                  {payload.fromCache && (
                    <p className="text-[10px] font-semibold" style={{ color: '#f59e0b' }}>⚡ 命中结果缓存，零模型成本秒回放</p>
                  )}
                  {Array.isArray(payload.agents) && payload.agents.map((a: any) => (
                    <div key={a.agent} className="flex items-start gap-1.5 text-[11px]"
                         style={{ color: 'var(--text-secondary)' }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
                            style={{ backgroundColor: MODEL_GRADE_COLOR[a.grade] ?? '#94a3b8' }} />
                      <span className="font-medium shrink-0" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                      <span className="chip shrink-0">{a.gradeLabel ?? a.grade}</span>
                      <span className="truncate">{(a.result ?? '').slice(0, 70)}</span>
                    </div>
                  ))}
                  {payload.overall && (
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      综合评级：
                      <span style={{ color: MODEL_GRADE_COLOR[payload.overall.grade] ?? 'var(--text-primary)', fontWeight: 700 }}>
                        {payload.overall.gradeLabel}
                      </span>
                      {payload.partial ? '（部分专家未完成）' : ''}
                    </p>
                  )}
                  <button
                    onClick={() => window.open('/multi-agent', '_blank')}
                    className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                    style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    title="打开多智能体深度分析页"
                  >
                    🧠 打开多智能体页 →
                  </button>
                </div>
              )}

              {/* 工程报告：预览 + 复制 Markdown / 下载 .md / 下载 .json */}
              {kind === 'report' && payload && typeof payload === 'object' && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {payload.title ?? '工程计算报告'} · 覆盖 {payload.runCount ?? 0} 条工具运行记录
                  </p>
                  {Array.isArray(payload.sections) && payload.sections.map((s: any, i: number) => (
                    <details key={'sec-' + i} className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <summary className="cursor-pointer font-medium" style={{ color: 'var(--text-primary)' }}>
                        {i + 1}. {s.title}
                      </summary>
                      <pre className="mt-1 font-mono whitespace-pre-wrap rounded-lg p-2 text-[10px]"
                           style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                        {String(s.content ?? '').slice(0, 900)}
                      </pre>
                    </details>
                  ))}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      onClick={() => {
                        try { navigator.clipboard.writeText(String(payload.markdown ?? '')); } catch { /* ignore */ }
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    >
                      📋 复制 Markdown
                    </button>
                    <button
                      onClick={() => downloadText(timestampName('report', 'md'), String(payload.markdown ?? ''))}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    >
                      ⬇ 下载 .md
                    </button>
                    <button
                      onClick={() => downloadJSON(timestampName('report', 'json'), payload)}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                    >
                      ⬇ 下载 .json
                    </button>
                  </div>
                </div>
              )}

              {/* 智能体建模中枢：按 model.kind 渲染 4 种子卡片（geo3d / ogs / calc / multiagent）（旧会话兼容） */}
              {kind === 'model' && modelResult && (
                <div className="space-y-1.5">
                  {modelResult.title && (
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {modelResult.title}
                      {modelResult.ok ? <span className="ml-1.5 text-emerald-500">✓ 模型已建立</span>
                                      : <span className="ml-1.5 text-rose-500">⚠ 模型未正常建立</span>}
                    </p>
                  )}
                  {modelResult.summary && (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                         style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {modelResult.summary}
                    </pre>
                  )}

                  {/* geo3d：库容快照 + 打开 3D 仿真器 */}
                  {modelResult.kind === 'geo3d' && modelResult.payload?.snapshot?.desc && (
                    <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                         style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                      {modelResult.payload.snapshot.desc}
                    </pre>
                  )}
                  {modelResult.kind === 'ogs' && modelResult.payload?.scenarioName && (
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      场景：<span className="font-mono">{modelResult.payload.scenarioName}</span>
                      {modelResult.payload.ok ? <span className="ml-1.5 text-emerald-500">✓ 求解正常</span>
                                              : <span className="ml-1.5 text-rose-500">⚠ 未正常收敛</span>}
                      {' · 求解耗时 '}{modelResult.payload.elapsedMs}ms
                      {Array.isArray(modelResult.payload.timeSeries)
                        ? ` · 时程输出 ${modelResult.payload.timeSeries.length} 组` : ''}
                    </p>
                  )}
                  {modelResult.kind === 'ogs' && (modelResult.payload?.scenario === 'settlement' || modelResult.payload?.scenario === 'gas-production') && (
                    <button
                      onClick={() => window.open('/ogs-sim', '_blank')}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                      title="到稳定化计算页查看时程曲线"
                    >
                      📈 查看时程曲线
                    </button>
                  )}

                  {/* calc：计算摘要 + 规范引用 + 打开计算中心 */}
                  {modelResult.kind === 'calc' && modelResult.payload?.name && (
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                      计算器：<span className="font-mono">{modelResult.payload.name}</span>
                    </p>
                  )}
                  {modelResult.kind === 'calc' && modelResult.payload?.ref && (
                    <span className="chip mt-1 inline-block" title={modelResult.payload.ref}>
                      📖 {modelResult.payload.ref}
                    </span>
                  )}
                  {modelResult.kind === 'calc' && (
                    <button
                      onClick={() => window.open('/design', '_blank')}
                      className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                      title="打开计算中心调整参数复算"
                    >
                      ⚙ 打开计算中心 →
                    </button>
                  )}

                  {/* multiagent：4 领域专家 + 综合评级 + 打开多智能体页 */}
                  {modelResult.kind === 'multiagent' && Array.isArray(modelResult.payload?.agents) && (
                    <div className="space-y-1">
                      {modelResult.payload.agents.map((a: any) => (
                        <div key={a.agent} className="flex items-center gap-1.5 text-[11px]"
                             style={{ color: 'var(--text-secondary)' }}>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: MODEL_GRADE_COLOR[a.grade] ?? '#94a3b8' }} />
                          <span className="font-medium shrink-0" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                          <span className="chip shrink-0">{a.gradeLabel ?? a.grade}</span>
                          <span className="truncate">{(a.result ?? '').slice(0, 60)}</span>
                        </div>
                      ))}
                      {modelResult.payload.overall && (
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          综合评级：
                          <span style={{ color: MODEL_GRADE_COLOR[modelResult.payload.overall.grade] ?? 'var(--text-primary)' }}>
                            {modelResult.payload.overall.gradeLabel}
                          </span>
                          {modelResult.partial ? '（部分专家未完成）' : ''}
                        </p>
                      )}
                      <button
                        onClick={() => window.open('/multi-agent', '_blank')}
                        className="text-[10px] px-2.5 py-1 rounded-full border transition-colors"
                        style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                        title="打开多智能体协同诊断页"
                      >
                        🧠 打开多智能体页 →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 检索关键词（KB） / 计算入参（计算） / 模拟参数（OGS） */}
              {tc.input && Object.keys(tc.input).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    {kind === 'kb' ? '检索关键词' : kind === 'ogs' ? '模拟参数' : '计算入参'}
                  </p>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                       style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                    {JSON.stringify(tc.input, null, 2)}
                  </pre>
                </div>
              )}

              {/* v5 参数与出处：ToolRun 信封内的参数表（单位 + 出处 + 越界标记） */}
              {run && Array.isArray(run.params) && run.params.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                    参数与出处
                    {run.elapsedMs !== undefined && <span style={{ opacity: 0.6 }}> · 耗时 {run.elapsedMs}ms</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {run.params.map((p: any, i: number) => (
                      <span
                        key={'p-' + i}
                        className="chip"
                        title={p.inRange ? '' : '超出合理范围，已按边界取值'}
                        style={p.inRange ? undefined : { borderColor: '#f59e0b', color: '#f59e0b' }}
                      >
                        {p.label}={p.value}{p.unit ?? ''}
                        <span style={{ opacity: 0.65 }}> · {ORIGIN_LABEL[p.origin] ?? p.origin}</span>
                      </span>
                    ))}
                  </div>
                  {run.warnings && run.warnings.length > 0 && (
                    <div className="mt-1 text-[10px]" style={{ color: '#f59e0b' }}>
                      {run.warnings.map((w: string, i: number) => (
                        <div key={'w-' + i}>⚠ {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 兜底：无法解析时仍显示原始 output */}
              {((kind === 'kb' && !kbEntries) || (kind === 'calc' && !calcSummary) || (kind === 'ogs' && !ogsResult) || (kind === 'scene' && !sceneResult) || (kind === 'model' && !modelResult) || (kind === 'diagnosis' && !diagResult)) && tc.output !== undefined && (
                <div>
                  <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>结果</p>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap rounded-lg p-2"
                       style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)' }}>
                    {typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ========================
// 追问引导卡片（P0-8 修复：来自 server/followUp.ts 的 follow_up SSE 事件）
//   折叠展开，显示建议补全的参数，点击"采纳建议"把问句回填到输入框
// ========================
function FollowUpCard({ items, onApply }: { items: FollowUpItem[]; onApply: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;

  // 类别 → 中文标签 + 配色（与 FOLLOW_UP_GUIDES 4 类语义对齐，不扩到 7 类）
  const kindMeta: Record<string, { label: string; color: string; icon: string }> = {
    slope: { label: '边坡稳定', color: '#10b981', icon: '⛰️' },
    leachate: { label: '渗滤液', color: '#3b82f6', icon: '💧' },
    settlement: { label: '沉降', color: '#8b5cf6', icon: '📉' },
    methane: { label: '填埋气/甲烷', color: '#f59e0b', icon: '🔥' },
    general: { label: '追问', color: '#06b6d4', icon: '🧠' },
  };

  return (
    <div
      className="rounded-xl border overflow-hidden my-2"
      style={{
        borderColor: 'rgba(245,158,11,0.5)',
        backgroundColor: 'rgba(245,158,11,0.06)',
        boxShadow: '0 0 12px rgba(245,158,11,0.15)',
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        style={{ backgroundColor: 'rgba(245,158,11,0.08)' }}
      >
        <Lightbulb size={13} style={{ color: '#f59e0b' }} />
        <span className="text-[11px] font-semibold" style={{ color: '#f59e0b' }}>
          ⚠ 智能追问 · 检测到可补充 {items.length} 项参数
        </span>
        {open ? <ChevronUp size={12} className="ml-auto" style={{ color: '#f59e0b' }} />
              : <ChevronDown size={12} className="ml-auto" style={{ color: '#f59e0b' }} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-2">
              {items.map((it, i) => {
                const meta = kindMeta[it.kind] ?? kindMeta.general;
                return (
                  <div
                    key={i}
                    className="rounded-lg p-2.5"
                    style={{
                      backgroundColor: 'var(--bg-elevated)',
                      borderLeft: `3px solid ${meta.color}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-sm">{meta.icon}</span>
                      <span className="text-[10px] font-semibold" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {it.prompt}
                    </p>
                    {it.hint && (
                      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        💡 {it.hint}
                      </p>
                    )}
                    <button
                      onClick={() => onApply(it.prompt)}
                      className="mt-1.5 text-[10px] px-2 py-1 rounded-md border transition-colors"
                      style={{ borderColor: meta.color, color: meta.color, backgroundColor: 'transparent' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = meta.color; e.currentTarget.style.color = '#fff'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = meta.color; }}
                    >
                      采纳建议 · 把问句回填到输入框
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ========================
// 消息气泡
// ========================
function MessageBubble({ msg, onApplyFollowUp, currentSessionId, currentAgentKey, selectedModel }: { msg: Message; onApplyFollowUp: (prompt: string) => void; currentSessionId: string; currentAgentKey: string; selectedModel: string }) {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* 头像 */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? 'var(--primary-glow)' : 'var(--bg-elevated)' }}
      >
        {isUser ? <User size={14} style={{ color: 'var(--primary)' }} />
                : <Bot size={14} style={{ color: 'var(--text-muted)' }} />}
      </div>

      {/* 内容 */}
      <div className={`flex-1 max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className="px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
          style={{
            backgroundColor: isUser ? 'var(--primary)' : 'var(--bg-surface)',
            color: isUser ? '#fff' : 'var(--text-primary)',
            borderBottomLeftRadius: isUser ? '0.75rem' : '0.25rem',
            borderBottomRightRadius: isUser ? '0.25rem' : '0.75rem',
          }}
        >
          {msg.content}
        </div>

        {msg.sources && ((msg.sources.kb?.length ?? 0) > 0 || (msg.sources.calcs?.length ?? 0) > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {msg.sources.kb?.map((s, i) => (
              <span key={'kb-' + i} className="chip">📚 {s.ref}</span>
            ))}
            {msg.sources.calcs?.map((c, i) => (
              <span key={'calc-' + i} className="chip">🧮 {c.name}</span>
            ))}
          </div>
        )}

        {/* 知识库检索增强 + 工程计算内核（兼容路径下为后端 RAG 结果回放） */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="w-full">
            {msg.toolCalls.map(tc => <ToolCallCard key={tc.id} tc={tc} />)}
          </div>
        )}

        {/* P0-8 修复：追问引导卡片（来自后端 follow_up SSE 事件） */}
        {msg.followUps && msg.followUps.length > 0 && (
          <div className="w-full">
            <FollowUpCard items={msg.followUps} onApply={onApplyFollowUp} />
          </div>
        )}

        {msg.error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mt-1">
            <AlertCircle size={12} />
            <span>{msg.error}</span>
          </div>
        )}

        {/* P3 用户反馈组件（仅 AI 消息） */}
        {!isUser && (
          <FeedbackWidget
            sessionId={currentSessionId}
            messageId={msg.id}
            agentKey={currentAgentKey}
            model={selectedModel}
          />
        )}
      </div>
    </motion.div>
  );
}

// ========================
// 权限弹窗
// ========================
function PermissionDialog({
  request, onAllow, onDeny,
}: {
  request: { tool: string; params: unknown };
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border"
      style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
    >
      <AlertCircle size={14} style={{ color: '#f59e0b' }} />
      <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
        Agent 请求调用工具：<span className="font-mono font-medium">{request.tool}</span>
      </span>
      <button onClick={onAllow} className="px-3 py-1 rounded-lg text-xs font-medium text-white"
              style={{ backgroundColor: '#10b981' }}>允许</button>
      <button onClick={onDeny} className="px-3 py-1 rounded-lg text-xs font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>拒绝</button>
    </motion.div>
  );
}

// ========================
// 主组件
// ========================
interface ChatPageProps {
  currentSession: any;
  models: ModelOption[];
  selectedModel: string;
  agents: Agent[];
  isLoading: boolean;
  inputValue: string;
  permissionRequest: { tool: string; params: unknown } | null;
  permissionMode: PermissionMode;
  onSendMessage: (text: string) => void;
  onStop: () => void;
  onInputChange: (val: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionAllow: (tool: string, params: unknown) => void;
  onPermissionDeny: (tool: string) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

export default function ChatPage({
  currentSession, models: _models, selectedModel, agents, isLoading, inputValue, permissionRequest,
  onSendMessage, onStop, onInputChange,
  onPermissionAllow, onPermissionDeny,
}: ChatPageProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = currentSession?.messages ?? [];
  const getAgent = (id: string) => agents.find(a => a.id === id);
  // 与 AppShell 逻辑保持一致：根据当前 session 的 agentId 取 agent
  const currentAgent = currentSession?.agentId ? getAgent(currentSession.agentId) : getAgent('default');
  const [detail, setDetail] = useDetailPref('chat');

  // 追问卡片"采纳建议"：把问句回填到输入框，由用户修改后发送
  const handleApplyFollowUp = (prompt: string) => {
    onInputChange(prompt);
    // 焦点回到输入框（让用户能继续编辑）
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // 首页"一键问 AI"带入的问题：挂载后自动发送一次
  const sendRef = useRef(onSendMessage);
  useEffect(() => { sendRef.current = onSendMessage; }, [onSendMessage]);
  useEffect(() => {
    const q = sessionStorage.getItem('chat-prefill');
    if (!q) return;
    // 先移除再同步发送：StrictMode 双挂载下第二次读取为 null，不会重复发送
    sessionStorage.removeItem('chat-prefill');
    sendRef.current(q);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = () => {
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Bot size={40} style={{ color: 'var(--border-accent)' }} />
            <p className="text-sm mt-3 font-medium" style={{ color: 'var(--text-muted)' }}>
              LandfillMind · 填埋场全周期工程智能体
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              说一句话即可调用 OGS 数值模拟、3D 建模、工程计算、多智能体深度分析与知识库
            </p>
            <div className="mt-5 flex flex-wrap gap-2 justify-center max-w-lg">
              {[
                '用 OGS 模拟 500 万吨填埋场 20 年产气量',
                '综合评估场地风险：裂缝12m、甲烷35%LEL',
                '建一个缓坡山谷型 500 万 m³ 的填埋场',
                '算一下边坡安全系数 Fs',
                '渗滤液液位超标怎么处理？',
              ].map((q, i) => (
                <button
                  key={i}
                  onClick={() => onSendMessage(q)}
                  className="chip cursor-pointer text-xs px-3 py-1.5"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg: Message) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onApplyFollowUp={handleApplyFollowUp}
              currentSessionId={currentSession?.id ?? ''}
              currentAgentKey={currentAgent?.id ?? ''}
              selectedModel={selectedModel}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* 权限弹窗 */}
      {permissionRequest && (
        <div className="px-6 pb-2">
          <PermissionDialog
            request={permissionRequest}
            onAllow={() => onPermissionAllow(permissionRequest.tool, permissionRequest.params)}
            onDeny={() => onPermissionDeny(permissionRequest.tool)}
          />
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 px-6 pb-5 pt-2 border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            <span className="text-[10px] font-semibold px-1.5" style={{ color: 'var(--text-muted)' }}>回答详细度</span>
            {([['brief', '摘要'], ['standard', '标准'], ['detailed', '详细']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDetail(key)}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all duration-150"
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
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>详细模式：回复更全面，生成时间更长</span>
          )}
          {messages.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => downloadText(timestampName('专家问答', 'md'), buildChatMarkdown(currentSession))}
                className="btn btn-ghost btn-sm"
              >
                <FileDown size={12} /> 导出 MD
              </button>
              <button
                onClick={() => downloadJSON(timestampName('专家问答', 'json'), currentSession)}
                className="btn btn-ghost btn-sm"
              >
                <FileDown size={12} /> 导出 JSON
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="输入问题，按 Enter 发送..."
            className="flex-1 px-4 py-2.5 rounded-xl text-sm resize-none border outline-none"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              maxHeight: '120px',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          />
          {isLoading ? (
            <button
              onClick={onStop}
              className="btn btn-ghost w-10 h-10 rounded-xl"
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className="btn btn-primary w-10 h-10 rounded-xl"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
