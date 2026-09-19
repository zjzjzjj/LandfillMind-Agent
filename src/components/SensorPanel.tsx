/**
 * SensorPanel.tsx · 实时 IoT 传感器面板（数字孪生感知层）
 *
 * - 实时显示 5 个传感器数值 + 风险等级（绿/黄/橙/红）
 * - 与 useSensors hook 配套，无需 props 时使用内部订阅
 * - 接入模拟：可显示连接状态（在线/离线）；离线时只显示"等待数据"
 * - 动画：数值变化时数字轻微闪烁；告警卡片脉冲
 */

import { useSensors, type SensorReading, SENSOR_KEYS, SENSOR_META } from '../hooks/useSensors';
import { ChevronDown, ChevronUp, Radio } from 'lucide-react';
import { useState } from 'react';

const LEVEL_COLOR: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  green:  { bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.5)',  text: '#10b981', dot: '#10b981', label: '正常' },
  yellow: { bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.5)',  text: '#f59e0b', dot: '#f59e0b', label: '关注' },
  orange: { bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.6)',  text: '#f97316', dot: '#f97316', label: '警告' },
  red:    { bg: 'rgba(239,68,68,0.14)',   border: 'rgba(239,68,68,0.7)',   text: '#ef4444', dot: '#ef4444', label: '危险' },
};

function relTime(ts: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (diff < 5) return '刚刚';
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min 前`;
  return new Date(ts).toLocaleTimeString();
}

function SensorCard({ reading, keyName }: { reading?: SensorReading; keyName: string }) {
  const meta = SENSOR_META[keyName as keyof typeof SENSOR_META];
  const level = reading ? LEVEL_COLOR[reading.level] : LEVEL_COLOR.green;
  const isAlert = reading?.level === 'orange' || reading?.level === 'red';

  return (
    <div
      className="rounded-lg px-3 py-2.5 border transition-all"
      style={{
        background: level.bg,
        borderColor: reading ? level.border : 'var(--border)',
        animation: isAlert ? 'lm-pulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: reading ? level.dot : '#94a3b8' }}
          />
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {meta.label}
          </span>
        </div>
        {reading && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ background: level.dot, color: '#fff' }}>
            {level.label}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold font-mono" style={{ color: reading ? level.text : 'var(--text-muted)' }}>
          {reading ? reading.value.toFixed(meta.unit === 'm' ? 2 : 1) : '—'}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{meta.unit}</span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
          报警 ≥ {meta.warn}{meta.unit} · 危险 ≥ {meta.danger}{meta.unit}
        </span>
        <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
          {reading ? relTime(reading.ts) : '等待数据'}
        </span>
      </div>
    </div>
  );
}

export interface SensorPanelProps {
  /** 注入外部传感器数据（不传则内部自取 SSE） */
  sensors?: Partial<Record<string, SensorReading>>;
  isConnected?: boolean;
  /** 紧凑模式：只显示标题 + 当前等级（用于嵌入 3D 场景内） */
  compact?: boolean;
}

export function SensorPanel({ sensors: externalSensors, isConnected: externalConn, compact }: SensorPanelProps) {
  const local = useSensors();
  const sensors = externalSensors ?? local.sensors;
  const isConnected = externalConn ?? local.isConnected;
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    // 收起态：一行紧凑摘要（连接状态 + 5 色点 + 展开按钮）
    return (
      <div
        className="rounded-xl border px-3 py-2 flex items-center gap-2.5 backdrop-blur-sm cursor-pointer select-none"
        style={{ background: 'rgba(15,23,42,0.85)', borderColor: 'var(--border)' }}
        onClick={() => setCollapsed(false)}
        title="展开实时监测"
      >
        <Radio size={13} style={{ color: isConnected ? '#10b981' : '#94a3b8' }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>实时监测</span>
        <span className="flex gap-1">
          {SENSOR_KEYS.map(k => {
            const r = sensors[k];
            const c = r ? LEVEL_COLOR[r.level] : LEVEL_COLOR.green;
            return <span key={k} className="w-1.5 h-1.5 rounded-full" style={{ background: r ? c.dot : '#94a3b8' }} />;
          })}
        </span>
        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>{isConnected ? '已连接' : '离线'}</span>
        <ChevronUp size={13} style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex gap-1.5">
        {SENSOR_KEYS.map((k) => {
          const r = sensors[k];
          const c = r ? LEVEL_COLOR[r.level] : LEVEL_COLOR.green;
          return (
            <div
              key={k}
              className="w-2 h-2 rounded-full"
              style={{ background: r ? c.dot : '#94a3b8' }}
              title={`${SENSOR_META[k].label}: ${r ? `${r.value}${r.unit}` : '—'}`}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-3 space-y-2 backdrop-blur-sm"
      style={{ background: 'rgba(15,23,42,0.85)', borderColor: 'var(--border)' }}
    >
      {/* 标题 + 连接状态 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: isConnected ? '#10b981' : '#94a3b8', animation: isConnected ? 'lm-pulse 2s ease-in-out infinite' : undefined }}
          />
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            实时监测 · IoT
          </span>
        </div>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {isConnected ? '已连接' : '离线'}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 border transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          title="收起实时监测"
        >
          <ChevronDown size={11} /> 收起
        </button>
      </div>

      {/* 5 个传感器卡片 */}
      {SENSOR_KEYS.map((k) => (
        <SensorCard key={k} keyName={k} reading={sensors[k]} />
      ))}

      <style>{`
        @keyframes lm-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }
      `}</style>
    </div>
  );
}

export default SensorPanel;