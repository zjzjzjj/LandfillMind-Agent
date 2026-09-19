/**
 * SafetyFactorGauge · 边坡稳定安全系数 Fs 专用仪表盘
 *
 * 设计要点：
 * - 圆弧 300° 进度弧（不是整圆，留 60° 给文字）
 * - 阈值弧（1.0 / 1.3 / 1.5）用同色环文字标出
 * - 颜色按 CJJ 176-2012：Fs<1.0 红 / 1.0-1.2 橙 / 1.2-1.3 黄 / ≥1.3 绿
 * - 数字大字号 + 单位（无量纲）
 */
import { useEffect, useState } from 'react';

interface SafetyFactorGaugeProps {
  Fs: number;
  className?: string;
  size?: number;            // 整体尺寸（px），默认 200
  thresholds?: number[];    // 阈值点，默认 [1.0, 1.3, 1.5]
  min?: number;             // 最小刻度，默认 0.5
  max?: number;             // 最大刻度，默认 2.5
}

const COLOR_RED = '#dc2626';
const COLOR_ORANGE = '#ea580c';
const COLOR_YELLOW = '#ca8a04';
const COLOR_GREEN = '#16a34a';

function colorFor(Fs: number): string {
  if (Fs < 1.0) return COLOR_RED;
  if (Fs < 1.2) return COLOR_ORANGE;
  if (Fs < 1.3) return COLOR_YELLOW;
  return COLOR_GREEN;
}

function verdictFor(Fs: number): string {
  if (Fs < 1.0) return '失稳';
  if (Fs < 1.2) return '欠稳定';
  if (Fs < 1.3) return '基本稳定';
  if (Fs < 1.5) return '稳定';
  return '高安全裕度';
}

export function SafetyFactorGauge({
  Fs,
  className = '',
  size = 180,
  thresholds = [1.0, 1.3, 1.5],
  min = 0.5,
  max = 2.5,
}: SafetyFactorGaugeProps) {
  const [animated, setAnimated] = useState(min);
  useEffect(() => {
    const start = performance.now();
    const dur = 700;
    const from = animated;
    const to = Math.min(max, Math.max(min, Fs));
    function tick(now: number) {
      const p = Math.min((now - start) / dur, 1);
      setAnimated(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Fs]);

  // 几何：300° 弧（左 120° 到右 60°，留底部 60° 给文字）
  const cx = size / 2;
  const cy = size * 0.62;
  const r = size * 0.38;
  const startAngle = 120; // 度，从 -y 顺时针 120°
  const sweepAngle = 300; // 扫 300°，留底部 60° 给文字
  const [arcPath, arcLen] = (() => {
    const toRad = (d: number) => ((d - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(startAngle));
    const y1 = cy + r * Math.sin(toRad(startAngle));
    const x2 = cx + r * Math.cos(toRad(startAngle + sweepAngle));
    const y2 = cy + r * Math.sin(toRad(startAngle + sweepAngle));
    const largeArc = sweepAngle > 180 ? 1 : 0;
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    return [path, r * (sweepAngle * Math.PI) / 180];
  })();

  const valueToAngle = (v: number) => {
    const clamped = Math.min(max, Math.max(min, v));
    const t = (clamped - min) / (max - min);
    return startAngle + t * sweepAngle;
  };
  const valueAngle = valueToAngle(animated);
  const valueRad = (valueAngle - 90) * Math.PI / 180;
  const needleX = cx + r * Math.cos(valueRad);
  const needleY = cy + r * Math.sin(valueRad);

  const color = colorFor(Fs);
  const dashOffset = arcLen * (1 - (Math.min(max, Math.max(min, animated)) - min) / (max - min));

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`} style={{ width: size }}>
      <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} className="block">
        <defs>
          <linearGradient id="gauge-bg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={COLOR_RED} stopOpacity="0.15" />
            <stop offset="40%" stopColor={COLOR_ORANGE} stopOpacity="0.15" />
            <stop offset="55%" stopColor={COLOR_YELLOW} stopOpacity="0.15" />
            <stop offset="100%" stopColor={COLOR_GREEN} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {/* 背景弧 */}
        <path d={arcPath} fill="none" stroke="url(#gauge-bg)" strokeWidth={size * 0.08} strokeLinecap="round" />
        {/* 阈值刻度 */}
        {thresholds.map((t) => {
          const a = valueToAngle(t);
          const ar = (a - 90) * Math.PI / 180;
          const x1 = cx + (r - size * 0.04) * Math.cos(ar);
          const y1 = cy + (r - size * 0.04) * Math.sin(ar);
          const x2 = cx + (r + size * 0.04) * Math.cos(ar);
          const y2 = cy + (r + size * 0.04) * Math.sin(ar);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-muted)" strokeWidth={1.2} />
              <text
                x={cx + (r + size * 0.10) * Math.cos(ar)}
                y={cy + (r + size * 0.10) * Math.sin(ar)}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={size * 0.06}
                fill="var(--text-muted)"
                fontFamily="ui-monospace, monospace"
              >
                {t.toFixed(1)}
              </text>
            </g>
          );
        })}
        {/* 当前值弧 */}
        <path
          d={arcPath}
          fill="none"
          stroke={color}
          strokeWidth={size * 0.08}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke 250ms ease' }}
        />
        {/* 指针（点） */}
        <circle cx={needleX} cy={needleY} r={size * 0.025} fill={color} />
      </svg>
      <div className="flex flex-col items-center -mt-3">
        <div className="font-mono font-bold leading-none" style={{ color, fontSize: size * 0.22 }}>
          {animated.toFixed(2)}
        </div>
        <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>Fs · 安全系数</div>
        <div
          className="text-[10px] mt-1 px-2 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: color + '18', color }}
        >
          {verdictFor(Fs)}
        </div>
      </div>
    </div>
  );
}

export default SafetyFactorGauge;
