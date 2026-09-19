/**
 * 共享 SVG 时程曲线（无第三方图表依赖 · hover 十字线取值）
 * 供 OgsSimPage（稳定化计算）与 DesignPage（计算中心过程曲线）复用。
 */

import { useState } from 'react';

export interface ChartSeries {
  name: string;
  unit?: string;
  varName?: string;
  points: { t: number; v: number }[];
}

/** 格式化数值：大数用万，小数保留精度，极小数用 ×10⁻ⁿ */
export const fmtAxisNum = (x: number) => {
  if (!Number.isFinite(x)) return '0';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e4) return (x / 1e4).toFixed(0) + '万';
  if (abs >= 100) return x.toFixed(0);
  if (abs >= 1) return x.toFixed(1);
  if (abs >= 0.01) return x.toFixed(2);
  if (abs >= 0.001) return x.toFixed(3);
  const exp = Math.floor(Math.log10(abs));
  const mantissa = x / Math.pow(10, exp);
  const superscript = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const expStr = String(Math.abs(exp)).split('').map(d => superscript[parseInt(d)]).join('');
  return `${mantissa.toFixed(1)}×10${exp < 0 ? '⁻' : ''}${expStr}`;
};

export function seriesColor(varName?: string): string {
  const MAP: Record<string, string> = {
    ch4_cum: '#3b82f6', co2_cum: '#10b981',
    ch4_rate: '#6366f1', co2_rate: '#14b8a6',
    deg_fast: '#ef4444', deg_slow: '#f97316', deg_vfa: '#8b5cf6', deg_bacteria: '#06b6d4',
    settle_curve: '#f59e0b', DISPLACEMENT_Y1: '#f59e0b',
    lfg_rate: '#6366f1', lfg_cum: '#3b82f6',
    advect_full: '#ef4444', advect_base: '#94a3b8',
    leach_monthly: '#0ea5e9',
  };
  return (varName && MAP[varName]) || '#06b6d4';
}

export function TimeSeriesChart({ series, height = 180 }: { series: ChartSeries; height?: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pts = series.points;
  if (!pts || pts.length < 2) return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>数据点不足</p>;
  const hoverPt = hoverIdx != null ? pts[hoverIdx] : null;
  const W = 460, H = height, PAD_L = 56, PAD_R = 12, PAD_T = 12, PAD_B = 32;
  const ts = pts.map((p) => p.t);
  const vs = pts.map((p) => p.v);
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const vMin = Math.min(...vs), vMax = Math.max(...vs);
  const tRange = tMax - tMin || 1;
  const vRange = vMax - vMin || 1;
  const X = (t: number) => PAD_L + (t - tMin) / tRange * (W - PAD_L - PAD_R);
  const Y = (v: number) => H - PAD_B - (v - vMin) / vRange * (H - PAD_T - PAD_B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const color = seriesColor(series.varName);

  // Y 轴刻度
  const yTicks: number[] = [];
  const yStep = vRange / 4;
  for (let i = 0; i <= 4; i++) yTicks.push(vMin + i * yStep);

  // X 轴刻度（智能步长）
  const xTicks: number[] = [];
  let xStep: number;
  if (tRange <= 10) xStep = 1;
  else if (tRange <= 50) xStep = 5;
  else if (tRange <= 200) xStep = 20;
  else if (tRange <= 1000) xStep = 100;
  else xStep = Math.ceil(tRange / 8 / 100) * 100;
  for (let t = Math.ceil(tMin / xStep) * xStep; t <= tMax; t += xStep) xTicks.push(t);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * W;
    if (x < PAD_L || x > W - PAD_R) { setHoverIdx(null); return; }
    const t = tMin + (x - PAD_L) / (W - PAD_L - PAD_R) * tRange;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].t - t);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHoverIdx(best);
  };

  const bubbleX = hoverPt ? Math.min(Math.max(X(hoverPt.t) - 52, PAD_L), W - PAD_R - 104) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair" role="img" aria-label={series.name}
         onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      {hoverPt && (
        <g>
          <line x1={X(hoverPt.t)} y1={PAD_T} x2={X(hoverPt.t)} y2={H - PAD_B} stroke={color} strokeOpacity="0.4" strokeDasharray="3,3" />
          <circle cx={X(hoverPt.t)} cy={Y(hoverPt.v)} r="4" fill="#fff" stroke={color} strokeWidth="2" />
          <rect x={bubbleX} y={PAD_T + 2} width="104" height="30" rx="4"
                fill="rgba(13,21,37,0.92)" stroke={color} strokeOpacity="0.5" />
          <text x={bubbleX + 52} y={PAD_T + 14} textAnchor="middle" fontSize="9" fill="#cbd5e1">
            t={fmtAxisNum(hoverPt.t)}
          </text>
          <text x={bubbleX + 52} y={PAD_T + 26} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>
            {fmtAxisNum(hoverPt.v)} {series.unit || ''}
          </text>
        </g>
      )}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={PAD_L} y1={Y(v)} x2={W - PAD_R} y2={Y(v)} stroke="var(--border)" strokeOpacity="0.5" strokeDasharray="2,3" />
          <text x={PAD_L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{fmtAxisNum(v)}</text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={X(t)} y1={H - PAD_B} x2={X(t)} y2={H - PAD_B + 3} stroke="var(--border)" />
          <text x={X(t)} y={H - PAD_B + 14} textAnchor="middle" fontSize="8" fill="var(--text-muted)">{fmtAxisNum(t)}</text>
        </g>
      ))}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--border)" />
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--border)" />
      <text x={W - PAD_R} y={H - PAD_B + 24} textAnchor="end" fontSize="8" fill="var(--text-muted)">时间</text>
      <text x={PAD_L - 4} y={PAD_T - 2} textAnchor="start" fontSize="8" fill="var(--text-muted)">{series.unit || ''}</text>
      <path d={line} fill="none" stroke={color} strokeWidth="2" />
      <circle cx={X(pts[0].t)} cy={Y(pts[0].v)} r="3" fill={color} />
      <circle cx={X(pts[pts.length - 1].t)} cy={Y(pts[pts.length - 1].v)} r="3" fill={color} opacity="0.6" />
      <text x={X(pts[pts.length - 1].t) + 4} y={Y(pts[pts.length - 1].v) - 4} fontSize="9" fontWeight="600" fill={color}>
        {fmtAxisNum(pts[pts.length - 1].v)}
      </text>
    </svg>
  );
}

export default TimeSeriesChart;
