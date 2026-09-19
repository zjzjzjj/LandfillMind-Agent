/**
 * LandfillMind · 管理员后台（P3 · E+G 监控面板）
 * 实时显示：
 *   - 知识库状态（条数 / 模块分布）
 *   - 用户反馈统计（好评率 / 趋势 / 按 agent 分布）
 *   - AB 测试对比（每个变体的曝光 / 转化率 / 权重）
 *   - 蒸馏候选队列（用户低分评论 + 自动生成 KB 草案）
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ThumbsUp, ThumbsDown, TrendingUp, TrendingDown, Minus, Brain, FlaskConical, Sparkles, Beaker, RefreshCw } from 'lucide-react';
import { FeedbackTrendChart, AgentPerformanceChart, ABVariantRadar, KnowledgeDistillGauge } from '../components/Charts';
import { AdminLoginGate, getStoredAdminToken } from '../components/AdminLoginGate';

interface FeedbackStat {
  total: number;
  up: number;
  down: number;
  upRate: number;
  downRate: number;
  recentTrend: 'up' | 'down' | 'flat';
  byAgent: Record<string, { up: number; down: number }>;
  lowScoreComments: any[];
  distillCandidates: any[];
}

interface ABStats {
  variants: Array<{
    id: string;
    name: string;
    description: string;
    weight: number;
    stats: { impressions: number; upCount: number; downCount: number };
    enabled: boolean;
  }>;
  totalFeedback: number;
  bestVariant: string | null;
  summary: string;
}

interface KBStats {
  total: number;
  m6: number;
  m62: number;
  cacheHits: any;
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [fb, setFb] = useState<FeedbackStat | null>(null);
  const [ab, setAB] = useState<ABStats | null>(null);
  const [kb, setKB] = useState<KBStats | null>(null);
  const [trend, setTrend] = useState<Array<{ date: string; up: number; down: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const refresh = async () => {
    setLoading(true);
    try {
      const token = getStoredAdminToken();
      const headers: Record<string, string> = {};
      if (token) headers['X-Admin-Token'] = token;
      const [fbRes, abRes, healthRes, trendRes] = await Promise.all([
        fetch('/api/feedback/stats', { headers }).then(r => r.json()),
        fetch('/api/ab/stats', { headers }).then(r => r.json()),
        fetch('/api/health').then(r => r.json()),
        fetch('/api/feedback/trend?days=14', { headers }).then(r => r.json()),
      ]);
      setFb(fbRes.stats);
      setAB(abRes.stats);
      setKB({
        total: healthRes.kbCount,
        m6: 0,
        m62: 0,
        cacheHits: null,
      });
      setTrend(trendRes.trend ?? []);
      setLastRefresh(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 登录门判断必须放在所有 hooks 之后：authenticated 翻转时若 hooks 数量变化，
  // React 会抛 "Rendered more hooks than during the previous render" 崩溃。
  // 因此全部 useState/useMemo/useEffect 声明在前，仅当通过登录后才渲染数据面板。
  useEffect(() => {
    if (authenticated) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const trendIcon = fb?.recentTrend === 'up' ? <TrendingUp size={14} className="text-emerald-400" />
    : fb?.recentTrend === 'down' ? <TrendingDown size={14} className="text-rose-400" />
    : <Minus size={14} className="text-slate-400" />;

  // P3-J 性能修复：useMemo 稳定图表 data 引用，避免 ECharts 每帧重建
  const agentPerfData = useMemo(() => {
    if (!fb?.byAgent) return [];
    return Object.entries(fb.byAgent).map(([agent, stats]) => ({
      agent,
      upRate: stats.up + stats.down > 0 ? stats.up / (stats.up + stats.down) * 100 : 0,
      total: stats.up + stats.down,
    }));
  }, [fb?.byAgent]);

  const abVariantData = useMemo(() => {
    if (!ab?.variants) return [];
    return ab.variants.map(v => ({
      id: v.id,
      name: v.name,
      impressions: v.stats.impressions,
      upCount: v.stats.upCount,
      downCount: v.stats.downCount,
    }));
  }, [ab?.variants]);

  const distillGauge = useMemo(() => ({
    distilled: fb?.distillCandidates.length ?? 0,
    total: Math.max(20, fb?.lowScoreComments.length ?? 20),
  }), [fb?.distillCandidates, fb?.lowScoreComments]);

  if (!authenticated) {
    return <AdminLoginGate onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-6 pb-12" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="max-w-6xl mx-auto pb-4">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              🛠 LandfillMind 管理员后台
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              知识库状态 · 用户反馈 · AB 测试 · 蒸馏队列
              <span className="ml-2">· 上次刷新：{lastRefresh.toLocaleTimeString()}</span>
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        {/* KB 状态卡 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={<Brain size={16} />}
            title="知识库条数"
            value={kb?.total ?? '—'}
            unit="条"
            color="#0ea5b7"
            subtitle="m6 + m62"
          />
          <StatCard
            icon={<ThumbsUp size={16} />}
            title="用户好评率"
            value={fb ? (fb.upRate * 100).toFixed(1) : '—'}
            unit="%"
            color={fb && fb.upRate >= 0.8 ? '#10b981' : '#f59e0b'}
            subtitle={`${fb?.total ?? 0} 条反馈`}
            extra={trendIcon}
          />
          <StatCard
            icon={<FlaskConical size={16} />}
            title="AB 测试变体"
            value={ab?.variants.length ?? '—'}
            unit="个"
            color="#7c3aed"
            subtitle="bandit 优选中"
          />
          <StatCard
            icon={<Sparkles size={16} />}
            title="蒸馏候选"
            value={fb?.distillCandidates.length ?? '—'}
            unit="条"
            color="#ea580c"
            subtitle="待生成 KB 草案"
          />
        </div>

        {/* J · ECharts 可视化区 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="md:col-span-2 rounded-2xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <TrendingUp size={14} /> 用户反馈趋势（14 天）
              </h2>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {fb ? `${fb.up} 👍 / ${fb.down} 👎` : '—'}
              </span>
            </div>
            <FeedbackTrendChart data={trend} />
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Sparkles size={14} /> KB 蒸馏覆盖率
            </h2>
            <KnowledgeDistillGauge distilled={distillGauge.distilled} total={distillGauge.total} />
          </div>
        </div>

        {/* 各 agent 反馈表现 + AB 雷达 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Beaker size={14} /> 各 agent 反馈表现
            </h2>
            <AgentPerformanceChart data={agentPerfData} />
          </div>

          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <FlaskConical size={14} /> AB 变体综合表现
            </h2>
            <ABVariantRadar data={abVariantData} />
          </div>
        </div>

        {/* AB 测试详情 */}
        <div className="rounded-2xl border p-5 mb-6" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <FlaskConical size={14} /> A/B 测试详情
            {ab?.bestVariant && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#7c3aed22', color: '#7c3aed' }}>
                当前最佳：{ab.bestVariant}
              </span>
            )}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {ab?.variants.map(v => {
              const total = v.stats.upCount + v.stats.downCount;
              const rate = total ? (v.stats.upCount / total * 100).toFixed(1) : '—';
              return (
                <div key={v.id} className="rounded-xl p-3 border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{v.name}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: '#7c3aed22', color: '#7c3aed' }}>
                      权重 {v.weight.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>{v.description}</p>
                  <div className="flex items-center justify-between text-[10px]">
                    <span style={{ color: 'var(--text-muted)' }}>曝光 {v.stats.impressions}</span>
                    <span style={{ color: rate === '—' ? 'var(--text-muted)' : parseFloat(rate) >= 80 ? '#10b981' : '#f59e0b' }}>
                      👍 {v.stats.upCount} / 👎 {v.stats.downCount} ({rate}%)
                    </span>
                  </div>
                  {total > 0 && (
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden flex" style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}>
                      <div className="h-full" style={{ width: `${v.stats.upCount / total * 100}%`, backgroundColor: '#10b981' }} />
                      <div className="h-full" style={{ width: `${v.stats.downCount / total * 100}%`, backgroundColor: '#f43f5e' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 反馈分布 + 蒸馏队列 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 按 agent 分布 */}
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Beaker size={14} /> 各 agent 反馈分布
            </h2>
            {fb?.byAgent && Object.keys(fb.byAgent).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(fb.byAgent).map(([agent, stats]) => {
                  const total = stats.up + stats.down;
                  const rate = total ? (stats.up / total * 100).toFixed(1) : '—';
                  return (
                    <div key={agent} className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{agent}</span>
                      <div className="flex-1 mx-3 h-1.5 rounded-full overflow-hidden flex" style={{ backgroundColor: 'rgba(0,0,0,0.06)' }}>
                        <div className="h-full" style={{ width: `${stats.up / total * 100}%`, backgroundColor: '#10b981' }} />
                      </div>
                      <span className="text-[10px] font-mono" style={{ color: parseFloat(rate) >= 80 ? '#10b981' : '#f59e0b' }}>
                        {rate}%
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
                暂无反馈数据，访问聊天页对 AI 回答点赞/点踩即可采集
              </p>
            )}
          </div>

          {/* 蒸馏队列 */}
          <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Sparkles size={14} /> KB 蒸馏候选队列
            </h2>
            {fb?.distillCandidates && fb.distillCandidates.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {fb.distillCandidates.slice(0, 10).map((c: any) => (
                  <div key={c.feedbackId} className="p-2 rounded-lg" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        #{c.feedbackId.slice(0, 8)}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#ea580c22', color: '#ea580c' }}>
                        {c.status}
                      </span>
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.originalComment}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
                没有低分反馈，蒸馏队列为空
              </p>
            )}
            <button
              onClick={async () => {
                const token = getStoredAdminToken();
                await fetch('/api/feedback/distill', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token ?? '' },
                  body: '{}',
                });
                refresh();
              }}
              className="mt-3 w-full py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              一键蒸馏候选为 KB 草案
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, unit, color, subtitle, extra }: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border p-4 relative overflow-hidden"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full opacity-10 blur-2xl" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5" style={{ color }}>
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-wide">{title}</span>
        </div>
        {extra}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-extrabold font-mono" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {subtitle && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
    </motion.div>
  );
}
