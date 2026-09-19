/** SceneChatPanel.tsx — 3D 仿真器内嵌 AI 建模助手（对话 → 建模 / 计算 / OGS 联动） */
import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, Loader2, Send, Sparkles, Boxes, Calculator, Flame, X } from 'lucide-react';
import type { GeoParams } from './LandfillScene3D/geo';

export interface SceneChatResult {
  ok: boolean;
  reply: string;
  geo?: GeoParams;
  preset?: string;
  snapshot?: { volumeWanM3?: string; areaHm2?: string; desc?: string };
  ogSummary?: { scenario?: string; scenarioName?: string; peakValue?: number; unit?: string };
  ogTimeSeries?: Array<{ varName?: string; points: { t: number; v: number }[] }>;
  calc?: { name?: string; value?: unknown; unit?: string; grade?: string; analysis?: string; ref?: string };
  changed: string[];
}

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards?: { kind: 'scene' | 'ogs' | 'calc'; title: string; body: string }[];
  loading?: boolean;
}

let uid = 0;
const nextId = () => ++uid;

const SUGGESTIONS = ['把堆体调高', '建一个大型场', '模拟一下产气', '算边坡安全系数'];

interface Props {
  currentGeo: GeoParams;
  onApplyGeo: (geo: GeoParams) => void;
  onOgsResult: (scenario: string, series: Array<{ varName?: string; points: { t: number; v: number }[] }>, label: string) => void;
}

export function SceneChatPanel({ currentGeo, onApplyGeo, onOgsResult }: Props) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [msgs, open]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMsgs(m => [...m, { id: nextId(), role: 'user', text }]);
    setMsgs(m => [...m, { id: nextId(), role: 'assistant', text: '正在处理…', loading: true }]);
    try {
      const resp = await fetch('/api/scene/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, currentGeo }),
      });
      const r = (await resp.json()) as SceneChatResult;
      const cards: ChatMsg['cards'] = [];
      // 场景变更
      if (r.geo) {
        onApplyGeo(r.geo);
        cards.push({
          kind: 'scene',
          title: r.preset && r.preset !== 'default' ? `场景 · ${r.preset}` : '3D 场景已更新',
          body: r.changed.filter(c => c.includes('→') || c.includes('重新建模') || c.includes('切换')).join('；')
            || (r.snapshot ? `库容约 ${r.snapshot.volumeWanM3} 万 m³` : '已应用'),
        });
      }
      // OGS 联动
      if (r.ogSummary && r.ogTimeSeries) {
        onOgsResult(r.ogSummary.scenario ?? 'gas-production', r.ogTimeSeries, `已注入 OGS「${r.ogSummary.scenarioName ?? r.ogSummary.scenario}」结果`);
        cards.push({
          kind: 'ogs',
          title: `OGS · ${r.ogSummary.scenarioName ?? r.ogSummary.scenario}`,
          body: `峰值 ${r.ogSummary.peakValue} ${r.ogSummary.unit}（已注入 3D 场景）`,
        });
      }
      // 计算器
      if (r.calc) {
        cards.push({
          kind: 'calc',
          title: `计算 · ${r.calc.name}`,
          body: r.calc.value !== undefined ? `${r.calc.value} ${r.calc.unit ?? ''}` + (r.calc.grade ? ` · ${r.calc.grade}` : '') : (r.calc.analysis ?? '已完成'),
        });
      }
      setMsgs(m => {
        const list = [...m];
        const last = list[list.length - 1];
        if (last.loading) {
          last.text = r.reply || '已完成。';
          last.loading = false;
          if (cards.length) last.cards = cards;
        }
        return list;
      });
    } catch (e: any) {
      setMsgs(m => {
        const list = [...m];
        const last = list[list.length - 1];
        if (last.loading) { last.text = '请求失败：' + (e?.message ?? '网络异常'); last.loading = false; }
        return list;
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-sm transition-colors"
        style={{ background: 'rgba(15,23,42,0.9)', borderColor: 'var(--primary)', color: 'var(--primary)' }}
      >
        <Sparkles size={14} /> AI 建模助手 <ChevronUp size={12} />
      </button>
    );
  }

  return (
    <div className="w-80 flex flex-col rounded-xl border shadow-2xl backdrop-blur-sm overflow-hidden"
      style={{ background: 'rgba(15,23,42,0.92)', borderColor: 'var(--border)' }}>
      {/* 标题 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--border)', background: 'rgba(99,102,241,0.12)' }}>
        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>AI 建模助手</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>对话建模 · 计算 · OGS</span>
        <button onClick={() => setOpen(false)} className="ml-auto p-0.5 rounded" style={{ color: 'var(--text-muted)' }} title="收起">
          <ChevronDown size={14} />
        </button>
      </div>

      {/* 消息区 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2.5" style={{ minHeight: 140, maxHeight: 320 }}>
        {msgs.length === 0 && (
          <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            用自然语言调整 3D 模型、调用计算与 OGS 模拟。试试：
            <div className="mt-1.5 flex flex-wrap gap-1">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="px-2 py-0.5 rounded-full border text-[10px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div className="max-w-[92%]">
              <div className="flex items-start gap-1.5">
                {m.role === 'assistant' && <Bot size={13} style={{ color: 'var(--primary)', marginTop: 2 }} />}
                <div className="px-2.5 py-1.5 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: m.role === 'user' ? 'rgba(99,102,241,0.18)' : 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}>
                  {m.loading ? (
                    <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 正在处理…</span>
                  ) : m.text}
                </div>
              </div>
              {/* 结果卡片 */}
              {m.cards?.map((c, i) => (
                <div key={i} className="mt-1.5 ml-5 rounded-lg border px-2.5 py-2"
                  style={{
                    borderColor: c.kind === 'ogs' ? 'rgba(249,115,22,0.5)' : c.kind === 'calc' ? 'rgba(16,185,129,0.5)' : 'var(--border)',
                    background: 'rgba(15,23,42,0.6)',
                  }}>
                  <div className="flex items-center gap-1 text-[10px] font-semibold mb-0.5"
                    style={{ color: c.kind === 'ogs' ? '#fb923c' : c.kind === 'calc' ? '#34d399' : 'var(--primary)' }}>
                    {c.kind === 'ogs' ? <Flame size={10} /> : c.kind === 'calc' ? <Calculator size={10} /> : <Boxes size={10} />}
                    {c.title}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.body}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t px-3 py-2 flex items-center gap-2" style={{ borderColor: 'var(--border)' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
          placeholder="例如：把堆体调高、模拟产气…"
          className="flex-1 bg-transparent outline-none text-xs px-1 py-1.5"
          style={{ color: 'var(--text-primary)', caretColor: 'var(--primary)' }}
        />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          className="p-1.5 rounded-lg flex items-center gap-1 text-[11px] font-medium"
          style={{ background: 'rgba(99,102,241,0.9)', color: '#fff', opacity: busy || !input.trim() ? 0.5 : 1 }}>
          <Send size={12} /> 发送
        </button>
      </div>
    </div>
  );
}

export default SceneChatPanel;
