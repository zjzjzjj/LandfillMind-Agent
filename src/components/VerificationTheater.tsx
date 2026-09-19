import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Cpu, ChevronLeft, ChevronRight, ShieldAlert, Sparkles, Maximize2 } from 'lucide-react';
import type { VerificationMismatch } from '../types';

// 兼容字符串 / 结构化对象：统一抽取字段供 UI 渲染
interface NormalizedMismatch {
  hazard: string;
  field: string;
  expected: string;
  reported: string;
  action: string;
}

function normalizeMismatch(m: string | VerificationMismatch, idx: number): NormalizedMismatch {
  if (typeof m === 'string') {
    return {
      hazard: 'general',
      field: `项 ${idx + 1}`,
      expected: '—',
      reported: m,
      action: '已按内核结论兜底纠偏',
    };
  }
  return {
    hazard: m.hazard || 'general',
    field: m.field || `项 ${idx + 1}`,
    expected: m.expected || '—',
    reported: m.reported || '—',
    action: m.action || '—',
  };
}

// 隐患类别映射：标签 + 配色（与 DiagnosisPage DIM_META 视觉对齐）
const HAZARD_META: Record<string, { label: string; color: string }> = {
  slope: { label: '边坡', color: '#10b981' },
  leachate: { label: '渗滤液', color: '#3b82f6' },
  lfg: { label: '填埋气', color: '#f59e0b' },
  gw: { label: '地下水', color: '#06b6d4' },
  summary: { label: '综合', color: '#8b5cf6' },
  general: { label: '通用', color: '#94a3b8' },
};

interface VerificationTheaterProps {
  /** 全部不一致项（字符串或结构化对象均可） */
  mismatches: Array<string | VerificationMismatch>;
  /** AI 报告原文片段（可选；用于左栏顶部补充展示） */
  aiReportSnippet?: string;
  /** 计算内核兜底结论（可选；用于右栏顶部补充展示） */
  kernelReport?: string;
}

/**
 * VerificationTheater：纠偏剧场化组件
 *  左侧 = AI 报告原文片段（黑玻璃感卡片）
 *  中部 = 动画竖线（framer-motion 逐条"穿过" mismatch 项）
 *  右侧 = 计算内核真实结论（黄色玻璃感卡片）
 *  底部 = 时间线 + 步进控件
 *
 *  目标：把 P0-1 已新增的结构化 VerificationMismatch 数据升级为
 *        评审现场"AI 报告 vs 内核结论"对抗式剧场，命中"AI 纠偏管理"评审维度。
 */
export function VerificationTheater({ mismatches, aiReportSnippet, kernelReport }: VerificationTheaterProps) {
  // 归一化数据：兼容 string | VerificationMismatch
  const items = useMemo(
    () => mismatches.map((m, i) => normalizeMismatch(m, i)),
    [mismatches],
  );

  // 当前步进：0..items.length-1；-1 表示"全部展开"概览
  const [activeIdx, setActiveIdx] = useState(0);
  // 剧场模式：'step' = 单步剧场；'all' = 全部展开（让评委一眼看到全貌）
  const [mode, setMode] = useState<'step' | 'all'>('step');

  // mismatch 列表变化时复位步进
  useEffect(() => {
    setActiveIdx(0);
    setMode('step');
  }, [mismatches.length]);

  if (items.length === 0) {
    return (
      <div className="mt-3 rounded-lg border px-3 py-2.5"
           style={{ borderColor: 'rgba(16,185,129,0.45)', backgroundColor: 'rgba(16,185,129,0.08)' }}>
        <p className="text-[11px] font-semibold" style={{ color: '#10b981' }}>✅ 内核复核通过</p>
        <p className="text-xs leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>
          AI 报告引用的关键数值已与工程计算内核交叉核对一致，结论可信。
        </p>
      </div>
    );
  }

  const current = items[Math.min(activeIdx, items.length - 1)];
  const currentMeta = HAZARD_META[current.hazard] || HAZARD_META.general;
  const showIdx = mode === 'all' ? -1 : activeIdx;

  return (
    <div
      className="mt-3 rounded-xl border overflow-hidden"
      style={{
        borderColor: 'rgba(245,158,11,0.55)',
        backgroundColor: 'rgba(245,158,11,0.04)',
        boxShadow: '0 6px 24px rgba(245,158,11,0.08)',
      }}
      role="region"
      aria-label="AI 纠偏剧场"
    >
      {/* ===== 顶部标题栏（30px · 数字徽章） ===== */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          height: 36,
          backgroundColor: 'rgba(245,158,11,0.10)',
          borderBottom: '1px solid rgba(245,158,11,0.30)',
        }}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} style={{ color: '#f59e0b' }} />
          <p className="text-[11px] font-semibold" style={{ color: '#f59e0b' }}>
            ⚠ 系统级纠偏 · 计算内核交叉复核剧场
          </p>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold"
          style={{ backgroundColor: 'rgba(245,158,11,0.20)', color: '#ca8a04' }}
        >
          {items.length} 处不一致
        </span>
      </div>

      {/* ===== 主区：分两栏 + 中间动画竖线 ===== */}
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_56px_1fr] gap-2 p-3">
        {/* 左栏：AI 报告原文片段（黑色玻璃感卡片） */}
        <motion.div
          key={`ai-${showIdx}`}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-lg border p-3 min-h-[140px]"
          style={{
            borderColor: 'rgba(148,163,184,0.45)',
            backgroundColor: 'rgba(15,23,42,0.55)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Bot size={13} style={{ color: '#94a3b8' }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
              AI 报告 · 原文片段
            </span>
            <span
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{
                backgroundColor: `${currentMeta.color}22`,
                color: currentMeta.color,
              }}
            >
              {currentMeta.label} · {current.field}
            </span>
          </div>
          {aiReportSnippet && (
            <p className="text-[10px] mb-2 italic" style={{ color: 'rgba(148,163,184,0.7)' }}>
              {aiReportSnippet}
            </p>
          )}
          {/* 当前条目的 AI 报告原文 */}
          <div className="rounded-md px-2 py-1.5"
               style={{ backgroundColor: 'rgba(15,23,42,0.7)', borderLeft: '2px solid #94a3b8' }}>
            <p className="text-[10px] mb-0.5" style={{ color: '#94a3b8' }}>AI 报告原文</p>
            <p className="text-xs leading-relaxed" style={{ color: '#e2e8f0' }}>{current.reported}</p>
          </div>
          {/* 其他条目的 AI 原文（概览模式 / 或步进模式下显示已过的） */}
          {mode === 'all' && (
            <div className="mt-2 space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="rounded px-2 py-1 text-[11px]"
                     style={{ backgroundColor: 'rgba(15,23,42,0.45)', color: '#cbd5e1' }}>
                  <span className="font-mono mr-1.5" style={{ color: '#94a3b8' }}>#{i + 1}</span>
                  {it.reported}
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* 中部：动画竖线 + 不一致项徽章（framer-motion 驱动） */}
        <div className="relative hidden md:flex flex-col items-center justify-center min-h-[140px]">
          {/* 背景竖线（轨道） */}
          <div
            className="absolute top-2 bottom-2 w-px"
            style={{ backgroundColor: 'rgba(245,158,11,0.25)' }}
          />
          {/* 动画竖线（从顶部滑下，"穿过"当前 mismatch） */}
          <motion.div
            className="absolute top-2 w-px"
            style={{ backgroundColor: '#f59e0b', boxShadow: '0 0 8px rgba(245,158,11,0.6)' }}
            initial={{ height: 0, top: 8 }}
            animate={{
              height: mode === 'all'
                ? 'calc(100% - 16px)'
                : `${((showIdx + 1) / items.length) * 100}%`,
              top: 8,
            }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
          {/* mismatch 圆点（沿竖线分布） */}
          {items.map((it, i) => {
            const meta = HAZARD_META[it.hazard] || HAZARD_META.general;
            const isActive = mode === 'all' || i === showIdx;
            const isPast = i < showIdx;
            return (
              <motion.div
                key={i}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15 + i * 0.08 }}
                className="relative z-10 my-1.5 w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-bold"
                style={{
                  backgroundColor: isActive ? meta.color : isPast ? 'rgba(245,158,11,0.6)' : 'rgba(15,23,42,0.7)',
                  color: isActive || isPast ? '#fff' : '#94a3b8',
                  border: `2px solid ${isActive ? meta.color : 'rgba(148,163,184,0.45)'}`,
                  boxShadow: isActive ? `0 0 12px ${meta.color}66` : 'none',
                  cursor: 'pointer',
                }}
                onClick={() => { setMode('step'); setActiveIdx(i); }}
                title={`${meta.label} · ${it.field}`}
              >
                {i + 1}
              </motion.div>
            );
          })}
        </div>

        {/* 右栏：计算内核真实结论（黄色玻璃感卡片） */}
        <motion.div
          key={`kernel-${showIdx}`}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-lg border p-3 min-h-[140px]"
          style={{
            borderColor: 'rgba(245,158,11,0.55)',
            backgroundColor: 'rgba(245,158,11,0.10)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Cpu size={13} style={{ color: '#f59e0b' }} />
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
              计算内核 · 真实结论
            </span>
            <span
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{
                backgroundColor: 'rgba(245,158,11,0.25)',
                color: '#ca8a04',
              }}
            >
              确定性 · 不可篡改
            </span>
          </div>
          {kernelReport && (
            <p className="text-[10px] mb-2 italic" style={{ color: 'rgba(245,158,11,0.7)' }}>
              {kernelReport}
            </p>
          )}
          {/* 当前条目的内核结论 */}
          <div className="rounded-md px-2 py-1.5"
               style={{ backgroundColor: 'rgba(245,158,11,0.18)', borderLeft: '2px solid #f59e0b' }}>
            <p className="text-[10px] mb-0.5" style={{ color: '#f59e0b' }}>内核真实结论</p>
            <p className="text-xs leading-relaxed font-semibold" style={{ color: '#1f2937' }}>{current.expected}</p>
          </div>
          {/* 系统处置（绿条） */}
          <div className="mt-1.5 rounded-md px-2 py-1.5"
               style={{ backgroundColor: 'rgba(16,185,129,0.10)', borderLeft: '2px solid #10b981' }}>
            <p className="text-[10px] mb-0.5" style={{ color: '#10b981' }}>系统级纠偏处置</p>
            <p className="text-[11px] leading-relaxed" style={{ color: '#065f46' }}>{current.action}</p>
          </div>
          {/* 概览模式：全部条目结论 */}
          {mode === 'all' && (
            <div className="mt-2 space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="rounded px-2 py-1 text-[11px]"
                     style={{ backgroundColor: 'rgba(245,158,11,0.10)', color: '#78350f' }}>
                  <span className="font-mono mr-1.5" style={{ color: '#ca8a04' }}>#{i + 1}</span>
                  {it.expected}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* ===== 底部时间线（3 圆点 + 时间线） + 控件 ===== */}
      <div
        className="px-3 py-2.5 flex items-center gap-2"
        style={{
          borderTop: '1px solid rgba(245,158,11,0.25)',
          backgroundColor: 'rgba(245,158,11,0.06)',
        }}
      >
        {/* 左下：上一步 */}
        <button
          onClick={() => { setMode('step'); setActiveIdx((i) => Math.max(0, i - 1)); }}
          disabled={mode === 'all' || activeIdx === 0}
          className="text-[10px] px-2 py-1 rounded border flex items-center gap-1 transition-colors disabled:opacity-40"
          style={{ borderColor: 'rgba(245,158,11,0.45)', color: '#ca8a04' }}
          onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.18)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <ChevronLeft size={11} /> ⏮ 上一步
        </button>

        {/* 中部：时间线 */}
        <div className="flex-1 flex items-center justify-center gap-1">
          {items.map((_, i) => {
            const isActive = mode === 'all' || i === activeIdx;
            const isPast = i < activeIdx && mode === 'step';
            return (
              <div key={i} className="flex items-center">
                <motion.div
                  className="w-2.5 h-2.5 rounded-full"
                  animate={{
                    backgroundColor: isActive ? '#f59e0b' : isPast ? '#10b981' : 'rgba(148,163,184,0.4)',
                    scale: isActive ? 1.3 : 1,
                  }}
                  transition={{ duration: 0.25 }}
                />
                {i < items.length - 1 && (
                  <div
                    className="w-6 h-px mx-0.5"
                    style={{
                      backgroundColor: isPast || (mode === 'all') || i < activeIdx
                        ? '#10b981' : 'rgba(148,163,184,0.3)',
                    }}
                  />
                )}
              </div>
            );
          })}
          <span className="ml-2 text-[10px] font-mono" style={{ color: '#ca8a04' }}>
            {mode === 'all'
              ? `全部展开 · ${items.length}/${items.length}`
              : `步进 ${activeIdx + 1}/${items.length}`}
          </span>
        </div>

        {/* 右下：下一步 / 全部展开 */}
        <button
          onClick={() => {
            if (mode === 'step' && activeIdx < items.length - 1) {
              setActiveIdx((i) => Math.min(items.length - 1, i + 1));
            } else {
              setMode(mode === 'all' ? 'step' : 'all');
            }
          }}
          className="text-[10px] px-2 py-1 rounded border flex items-center gap-1 transition-colors"
          style={{ borderColor: 'rgba(245,158,11,0.55)', color: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.22)'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(245,158,11,0.12)'; }}
        >
          {mode === 'all'
            ? (<><ChevronRight size={11} /> 收起剧场</>)
            : activeIdx < items.length - 1
              ? (<><ChevronRight size={11} /> ⏭ 下一步</>)
              : (<><Maximize2 size={11} /> 全部展开</>)}
        </button>
      </div>

      {/* ===== 底部说明条：剧场的"工程级 AI"哲学 ===== */}
      <AnimatePresence>
        {mode === 'all' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 flex items-start gap-1.5"
            style={{
              borderTop: '1px solid rgba(245,158,11,0.20)',
              backgroundColor: 'rgba(245,158,11,0.04)',
            }}
          >
            <Sparkles size={11} style={{ color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
            <p className="text-[10px] leading-relaxed" style={{ color: '#92400e' }}>
              <strong>工程级 AI 的核心：</strong>
              AI 不能凭空捏造工程数值。当 LLM 漏报 / 编造时，确定性计算内核自动捕获并按 GB 50330 / CJJ 176 / GB 16889 / AQ 4202 等规范条款兜底纠偏，UI 全程标注纠正来源。
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default VerificationTheater;