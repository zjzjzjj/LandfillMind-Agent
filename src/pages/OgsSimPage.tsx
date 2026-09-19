/**
 * OgsSimPage · 稳定化计算（OpenGeoSys 数值内核）
 *
 * 调用后端 /api/ogs/status + /api/ogs/run 运行求解：
 *   - 产气模拟（gas-production）：ADM1 式厌氧产甲烷模型，日分辨率时程
 *   - 沉降模拟（settlement）：OGS DEFORMATION 有限元求解
 * 展示求解摘要、关键指标卡片、时程曲线。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Loader2, RefreshCw, FlaskConical, ChevronDown, ChevronUp, Zap, TrendingUp, Wind, Box } from 'lucide-react';
import TimeSeriesChart, { seriesColor as getColor } from '../components/TimeSeriesChart';

interface OgsParamSpec { key: string; label: string; unit?: string; default: number; min?: number; max?: number; step?: number; hint?: string; }
interface OgsScenarioMeta { id: string; name: string; description: string; params: OgsParamSpec[]; }
interface OgsTimeSeries { name: string; unit?: string; varName?: string; points: { t: number; v: number }[]; }
interface OgsRunResult {
  ok: boolean; runId: string; scenario: string; scenarioName: string;
  params: Record<string, number>; elapsedMs: number; logTail?: string;
  simulationTime?: string; summary: string; timeSeries: OgsTimeSeries[];
  fileSummaries: Array<{ file: string; min: number; max: number; mean: number; points: number }>;
  error?: string;
}

/** 关键指标卡片 */
function MetricCard({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: string; unit?: string; color: string }) {
  return (
    <div className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '18' }}>
        {icon}
      </div>
      <div>
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</p>
        <p className="text-base font-bold font-mono" style={{ color }}>{value}{unit && <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-muted)' }}>{unit}</span>}</p>
      </div>
    </div>
  );
}

export default function OgsSimPage() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<OgsScenarioMeta[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [solverNative, setSolverNative] = useState(false);
  const [platform, setPlatform] = useState('');
  const [exePath, setExePath] = useState<string>('');
  const [selectedId, setSelectedId] = useState('gas-production');
  const [params, setParams] = useState<Record<string, number>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OgsRunResult | null>(null);
  const [error, setError] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/ogs/status').then((x) => x.json());
      setScenarios(r.scenarios ?? []);
      setAvailable(!!r.available);
      setSolverNative(!!r.solverNative);
      setPlatform(r.platform ?? '');
      setExePath(r.exe ?? '');
    } catch { setAvailable(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // 场景列表加载后，若当前选中项不在列表里，自动选中第一个
  useEffect(() => {
    if (scenarios.length > 0 && !scenarios.find(s => s.id === selectedId)) {
      setSelectedId(scenarios[0].id);
    }
  }, [scenarios, selectedId]);

  // 消费跨页联动：计算中心「联动」跳转带来的场景预选（ogs-prefill）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ogs-prefill');
      if (!raw) return;
      sessionStorage.removeItem('ogs-prefill');
      const pre = JSON.parse(raw) as { scenario?: string; params?: Record<string, number> };
      if (pre.scenario) setSelectedId(pre.scenario);
      if (pre.params && Object.keys(pre.params).length) setParams(prev => ({ ...prev, ...pre.params }));
    } catch { /* ignore */ }
  }, []);

  const scenario = scenarios.find((s) => s.id === selectedId);

  // 切场景时用默认参数初始化
  useEffect(() => {
    if (scenario) {
      const init: Record<string, number> = {};
      for (const p of scenario.params) init[p.key] = p.default;
      setParams(init);
    }
  }, [scenario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch('/api/ogs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: selectedId, params }),
      });
      const data = await r.json();
      if (r.ok && data.ok) setResult(data);
      else setError(data?.summary ?? data?.error ?? 'OGS 运行失败');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const setParam = (key: string, v: number) => setParams((prev) => ({ ...prev, [key]: v }));

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-6 pb-12" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="max-w-5xl mx-auto">
        {/* 页头 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <FlaskConical size={20} style={{ color: 'var(--primary)' }} /> 稳定化计算
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              确定性数值内核（ADM1 生化模型 · Terzaghi 固结理论，源自 OpenGeoSys 算例标定）· 非 LLM 推算
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-1 rounded-full font-mono"
                  style={{ backgroundColor: available ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                           color: available ? '#10b981' : '#ef4444', border: '1px solid currentColor' }}
                  title={solverNative ? '原生求解器在本平台可用' : `原生 ogs 求解器为 Windows 可执行文件，当前平台（${platform}）仅用解析内核`}>
              {available ? (solverNative ? '✓ 内核就绪（含原生求解器）' : '✓ 解析内核就绪') : '✗ 不可用'}
            </span>
            <button onClick={loadStatus} className="p-1.5 rounded-lg border" title="刷新状态"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {available === false && (
          <div className="rounded-xl border p-4 mb-4 text-sm" style={{ borderColor: '#f59e0b55', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)' }}>
            ⚠ 数值内核不可用。请在项目根目录 .env 设置 <code>OGS_EXE=你的ogs路径</code>。
            当前平台：<code>{platform}</code> · 尝试路径：<code>{exePath || '无'}</code>
          </div>
        )}

        {/* 场景选择 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {scenarios.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
                    className="rounded-xl border p-3 text-left transition-all"
                    style={{ borderColor: selectedId === s.id ? 'var(--primary)' : 'var(--border)',
                             backgroundColor: selectedId === s.id ? 'rgba(6,182,212,0.06)' : 'var(--bg-surface)',
                             boxShadow: selectedId === s.id ? '0 0 16px rgba(6,182,212,0.12)' : 'none' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</span>
                {selectedId === s.id && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--primary)' }} />}
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{s.description}</p>
            </button>
          ))}
        </div>

        {/* 参数表单 */}
        {scenario && (
          <div className="rounded-2xl border p-4 mb-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              {scenario.name} · 模拟参数
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scenario.params.map((p) => (
                <label key={p.key} className="block">
                  <span className="text-xs mb-1 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    {p.label}
                    {p.unit && <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>({p.unit})</span>}
                  </span>
                  <input
                    type="number"
                    value={params[p.key] ?? p.default}
                    step={p.step || 'any'}
                    min={p.min}
                    max={p.max}
                    onChange={(e) => setParam(p.key, parseFloat(e.target.value))}
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
                  />
                  {p.hint && <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.hint}</span>}
                </label>
              ))}
            </div>
            <button
              onClick={run}
              disabled={running || !available}
              className="mt-4 w-full py-2.5 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
              onMouseEnter={(e) => !running && (e.currentTarget.style.boxShadow = '0 0 20px rgba(6,182,212,0.4)')}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
            >
              {running ? (<><Loader2 size={15} className="animate-spin" /> {selectedId === 'gas-production' ? '产气预测计算中…' : '求解器中…'}</>)
                       : (<><Play size={15} /> 运行稳定化计算</>)}
            </button>
          </div>
        )}

        {/* 结果区 */}
        {error && (
          <div className="rounded-xl border p-3 mb-4 text-sm" style={{ borderColor: '#ef444455', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.06)' }}>
            {error}
          </div>
        )}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="rounded-2xl border p-5 mb-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: result.ok ? '#10b981' : '#ef4444' }} />
                  {result.scenarioName} · 求解结果
                  {result.ok && <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10b981' }}>正常收敛</span>}
                </h2>
                <div className="flex items-center gap-2">
                  {result.ok && (result.scenario === 'settlement' || result.scenario === 'gas-production') && (
                    <button
                      onClick={() => {
                        try {
                          sessionStorage.setItem('scene-ogs', JSON.stringify({
                            kind: 'ogs', scenario: result.scenario, scenarioName: result.scenarioName,
                            timeSeries: result.timeSeries, ts: Date.now(),
                          }));
                        } catch { /* ignore */ }
                        navigate('/3d-simulator');
                      }}
                      className="text-[10px] px-2.5 py-1 rounded-full border flex items-center gap-1 transition-colors"
                      style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                      title={result.scenario === 'settlement' ? '沉降时程驱动 3D 堆体下沉' : '产气强度驱动 3D 火炬'}
                    >
                      <Box size={11} /> 在 3D 中查看
                    </button>
                  )}
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    模拟 {result.simulationTime ?? '-'} · {result.elapsedMs > 0 ? `求解 ${result.elapsedMs}ms` : '确定性计算'}
                  </span>
                </div>
              </div>

              {/* 关键指标卡片（产气场景） */}
              {result.scenario === 'gas-production' && result.timeSeries.length > 0 && (() => {
                const ch4Cum = result.timeSeries.find(s => s.varName === 'ch4_cum');
                const co2Cum = result.timeSeries.find(s => s.varName === 'co2_cum');
                const ch4Rate = result.timeSeries.find(s => s.varName === 'ch4_rate');
                const ch4Total = result.timeSeries.find(s => s.varName === 'ch4_total');
                const co2Total = result.timeSeries.find(s => s.varName === 'co2_total');
                const finalCH4 = ch4Total?.points[ch4Total.points.length - 1]?.v ?? ch4Cum?.points[ch4Cum!.points.length - 1]?.v ?? 0;
                const finalCO2 = co2Total?.points[co2Total.points.length - 1]?.v ?? co2Cum?.points[co2Cum!.points.length - 1]?.v ?? 0;
                const peakRate = ch4Rate ? Math.max(...ch4Rate.points.map(p => p.v)) : 0;
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <MetricCard icon={<FlaskConical size={16} color="#3b82f6" />} label="CH₄ 累计产量" value={finalCH4.toFixed(0)} unit="万m³" color="#3b82f6" />
                    <MetricCard icon={<Wind size={16} color="#10b981" />} label="CO₂ 累计产量" value={finalCO2.toFixed(0)} unit="万m³" color="#10b981" />
                    <MetricCard icon={<TrendingUp size={16} color="#6366f1" />} label="CH₄ 日产峰值" value={peakRate.toFixed(2)} unit="万m³/d" color="#6366f1" />
                    <MetricCard icon={<Zap size={16} color="#f59e0b" />} label="发电潜力" value={((finalCH4 * 1e4 * 9.97) / 1000).toFixed(0)} unit="MWh" color="#f59e0b" />
                  </div>
                );
              })()}

              {/* 汇总文本 */}
              <pre className="text-[12px] font-mono whitespace-pre-wrap rounded-lg p-3 mb-4"
                   style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {result.summary}
              </pre>

              {/* 时程曲线（2列网格） */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                {result.timeSeries.map((s) => (
                  <div key={s.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                    <p className="text-[11px] font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(s.varName) }} />
                      {s.name}
                    </p>
                    <TimeSeriesChart series={s} />
                  </div>
                ))}
              </div>

              {/* 域统计 */}
              {result.fileSummaries.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                  {result.fileSummaries.slice(0, 3).map((f) => (
                    <div key={f.file} className="rounded-lg border p-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-mono mb-1 truncate" style={{ color: 'var(--text-muted)' }}>{f.file}</p>
                      <p className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        min {f.min.toExponential(2)} · max {f.max.toExponential(2)} · 节点 {f.points}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* 日志折叠 */}
              <button onClick={() => setLogOpen(!logOpen)} className="flex items-center gap-1.5 text-[11px]"
                      style={{ color: 'var(--text-muted)' }}>
                {logOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 求解日志
              </button>
              {logOpen && result.logTail && (
                <pre className="text-[10px] font-mono whitespace-pre-wrap rounded-lg p-3 mt-2 max-h-48 overflow-y-auto"
                     style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                  {result.logTail}
                </pre>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
