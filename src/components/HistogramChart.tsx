/**
 * HistogramChart · 纯 SVG 直方图（蒙特卡洛结果展示用）
 *
 * - 输入: samples: number[], bins?: number (默认 20)
 * - 自动计算 min/max/分箱
 * - 高亮 P5/P50/P95 三条分位线
 * - 可选叠加阈值线（threshold）+ 失败区域着色
 */
import { useMemo } from 'react';

interface HistogramChartProps {
  samples: number[];
  bins?: number;
  threshold?: { value: number; op: '<' | '<=' | '>' | '>='; color?: string };
  failColor?: string;     // 失败区域颜色
  passColor?: string;     // 通过区域颜色
  height?: number;
  className?: string;
  showStats?: boolean;
}

export function HistogramChart({
  samples,
  bins = 24,
  threshold,
  failColor = 'rgba(220, 38, 38, 0.55)',
  passColor = 'rgba(14, 165, 183, 0.6)',
  height = 200,
  className = '',
  showStats = true,
}: HistogramChartProps) {
  const stats = useMemo(() => {
    if (!samples.length) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    return { min, max, mean, p5: q(0.05), p50: q(0.50), p95: q(0.95), count: samples.length };
  }, [samples]);

  const histogram = useMemo(() => {
    if (!stats) return { binEdges: [] as number[], counts: [] as number[], binWidth: 0 };
    const { min, max } = stats;
    const width = (max - min) / bins || 1;
    const edges: number[] = [];
    for (let i = 0; i <= bins; i++) edges.push(min + i * width);
    const counts = new Array(bins).fill(0);
    for (const v of samples) {
      let idx = Math.floor((v - min) / width);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    }
    return { binEdges: edges, counts, binWidth: width };
  }, [stats, samples, bins]);

  if (!stats || !histogram.binEdges.length) {
    return (
      <div className={`text-xs text-center py-4 ${className}`} style={{ color: 'var(--text-muted)' }}>
        无数据
      </div>
    );
  }

  const W = 600;
  const H = height;
  const padL = 36, padR = 12, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const { counts, binWidth } = histogram;
  const maxCount = Math.max(...counts, 1);

  const xToPx = (v: number) => {
    const { min, max } = stats;
    return padL + ((v - min) / (max - min || 1)) * plotW;
  };
  const countToPx = (c: number) => padT + plotH - (c / maxCount) * plotH;

  // 阈值线与失败区域
  const thresholdPx = threshold ? xToPx(threshold.value) : null;
  const failRegion = (() => {
    if (!threshold) return null;
    const { value, op } = threshold;
    const { min, max } = stats;
    if (op === '<' || op === '<=') {
      // 失败 = 左侧
      const lo = Math.max(min, value);
      return { x: padL, w: xToPx(lo) - padL };
    } else {
      // 失败 = 右侧
      const hi = Math.min(max, value);
      return { x: xToPx(hi), w: padL + plotW - xToPx(hi) };
    }
  })();

  // 每个 bin 是否在失败侧（用于染色）
  const isBinFailed = (idx: number) => {
    if (!threshold) return false;
    const v = histogram.binEdges[idx] + binWidth / 2;
    const { op, value } = threshold;
    return (op === '<' && v < value) || (op === '<=' && v <= value) || (op === '>' && v > value) || (op === '>=' && v >= value);
  };

  // Y 轴 5 个刻度
  const yTicks = [0, maxCount * 0.25, maxCount * 0.5, maxCount * 0.75, maxCount];

  return (
    <div className={className}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="block">
        {/* 失败区域背景 */}
        {failRegion && (
          <rect
            x={failRegion.x} y={padT}
            width={failRegion.w} height={plotH}
            fill={failColor} fillOpacity="0.08"
          />
        )}
        {/* 网格线 */}
        {yTicks.map((t, i) => (
          <line key={i} x1={padL} y1={countToPx(t)} x2={padL + plotW} y2={countToPx(t)}
                stroke="var(--border)" strokeWidth={0.5} strokeDasharray="2,3" />
        ))}
        {/* 柱体 */}
        {counts.map((c, i) => {
          const x = padL + (i / bins) * plotW;
          const w = plotW / bins - 1;
          const y = countToPx(c);
          const h = padT + plotH - y;
          return (
            <rect
              key={i}
              x={x} y={y} width={Math.max(1, w)} height={h}
              fill={isBinFailed(i) ? failColor : passColor}
              rx={1.5}
            />
          );
        })}
        {/* 阈值线 */}
        {thresholdPx !== null && (
          <g>
            <line x1={thresholdPx} y1={padT} x2={thresholdPx} y2={padT + plotH}
                  stroke={threshold?.color || 'var(--text-primary)'} strokeWidth={1.5} strokeDasharray="4,3" />
            <text x={thresholdPx} y={padT - 2} textAnchor="middle"
                  fontSize={10} fill={threshold?.color || 'var(--text-primary)'}
                  fontFamily="ui-monospace, monospace">
              阈值 {threshold?.value}
            </text>
          </g>
        )}
        {/* 分位线 */}
        {[
          { v: stats.p5, label: 'P5', color: '#7c3aed' },
          { v: stats.p50, label: 'P50', color: '#0ea5b7' },
          { v: stats.p95, label: 'P95', color: '#7c3aed' },
        ].map((q) => {
          const x = xToPx(q.v);
          return (
            <g key={q.label}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH}
                    stroke={q.color} strokeWidth={1} strokeDasharray="2,2" />
              <text x={x} y={padT + plotH + 12} textAnchor="middle"
                    fontSize={9} fill={q.color}
                    fontFamily="ui-monospace, monospace">
                {q.label}={q.v.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* X 轴 */}
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH}
              stroke="var(--border)" strokeWidth={0.8} />
        <text x={padL} y={padT + plotH + 18} fontSize={9} fill="var(--text-muted)">
          {stats.min.toFixed(2)}
        </text>
        <text x={padL + plotW} y={padT + plotH + 18} textAnchor="end" fontSize={9} fill="var(--text-muted)">
          {stats.max.toFixed(2)}
        </text>
      </svg>
      {showStats && (
        <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          <div><span className="opacity-60">N</span> {stats.count}</div>
          <div><span className="opacity-60">μ</span> {stats.mean.toFixed(2)}</div>
          <div><span className="opacity-60">σ-range</span> [{stats.p5.toFixed(2)}, {stats.p95.toFixed(2)}]</div>
          <div><span className="opacity-60">fail</span> <span style={{ color: 'var(--risk-red, #dc2626)' }}>
            {threshold ? (counts.reduce((acc, c, i) => acc + (isBinFailed(i) ? c : 0), 0) / stats.count * 100).toFixed(1) : '-'}%
          </span></div>
        </div>
      )}
    </div>
  );
}

export default HistogramChart;
