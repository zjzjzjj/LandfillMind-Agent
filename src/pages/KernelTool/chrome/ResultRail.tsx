/**
 * chrome/ResultRail.tsx · 右侧结果条（桌面 app.py:4174-4209，固定宽 340px）
 *
 * 结果条三段：
 *  1. 关键数值卡片（内核 data.key_numbers，最多展示 8 个，可展开）—— 重要数字
 *     不再埋在表格里；
 *  2. 计算结果表（数值列自动右对齐 + 斑马纹 + 长文本 title tooltip）；
 *  3. 汇总 + 口径戳（底部固定）。
 */
import { useMemo, useState } from 'react';
import { useTool, useUi, useUiValue } from '../state/context';
import { Dim, TabBtn } from '../ui/Primitives';
import { downloadTableCsv } from '../state/api';

const MAX_CARDS = 8;

/** 数值美化：数字加千分位，布尔/长文本截断 */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toLocaleString('en-US')
      : (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 })
          : String(Math.round(v * 1000) / 1000));
  }
  if (typeof v === 'boolean') return v ? '是' : '否';
  const s = String(v);
  return s.length > 42 ? s.slice(0, 40) + '…' : s;
}

function KeyCards({ kn }: { kn: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => Object.entries(kn)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, open ? 24 : MAX_CARDS), [kn, open]);
  const total = useMemo(() => Object.values(kn)
    .filter((v) => v !== null && v !== undefined && v !== '').length, [kn]);
  return (
    <div className="px-2 pt-2 shrink-0">
      <div className="grid grid-cols-2 gap-1">
        {entries.map(([k, v]) => (
          <div key={k} title={k}
               className="lf-kcard"
               style={{ background: 'var(--lf-panel2, #e8eff8)', borderRadius: 4,
                        padding: '4px 6px', border: '1px solid var(--border)' }}>
            <p className="lf-dim" style={{ fontSize: 9, lineHeight: 1.3, whiteSpace: 'nowrap',
                                           overflow: 'hidden', textOverflow: 'ellipsis' }}>{k}</p>
            <p className="lf-mono" style={{ fontSize: 11.5, lineHeight: 1.4,
                                             color: 'var(--text-primary)', fontWeight: 600 }}>
              {fmtVal(v)}
            </p>
          </div>
        ))}
      </div>
      {total > MAX_CARDS && (
        <button type="button" className="lf-fold mt-1"
                onClick={() => setOpen((o) => !o)}
                style={{ width: '100%', textAlign: 'center' }}>
          {open ? '收起关键数值 ▲' : `展开全部关键数值（${total}）▼`}
        </button>
      )}
    </div>
  );
}

export function LogPane() {
  const { k } = useTool();
  return (
    <div className="lf-log overflow-auto flex-1 min-h-0 p-2 text-[11px] leading-[1.7]"
         style={{ background: 'var(--lf-log-bg)' }}>
      {k.logs.length === 0 && <p className="lf-dim">（暂无日志）</p>}
      {k.logs.map((l, i) => (
        <div key={i} className={`lf-log-${l.kind} whitespace-pre-wrap break-all`}>
          <span className="lf-dim">{l.t} </span>{l.text}
        </div>
      ))}
    </div>
  );
}

export function ResultTable() {
  const { k, ui } = useTool();
  const view = useUiValue<string>('view');
  const entry = k.pool[view];
  const t = entry?.table;
  const cols = t?.cols || [];
  const rows = (t?.rows || []).slice(0, 300);

  // 数值列探测：样本里 60% 以上可解析为数字 → 右对齐等宽
  const numCol = useMemo(() => cols.map((_, j) => {
    const sample = rows.slice(0, 30).map((r) => r[j]);
    const hit = sample.filter((v) => v !== null && v !== undefined && v !== ''
      && !Number.isNaN(Number(String(v).replace(/[, %]/g, '')))).length;
    return sample.length > 0 && hit / sample.length >= 0.6;
  }), [cols, rows]);

  if (!cols.length) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-3">
        <Dim>（当前视图暂无结果表 —— 先在左侧点对应页的计算按钮）</Dim>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1 shrink-0"
           style={{ borderBottom: '1px solid var(--border)' }}>
        <Dim>{rows.length} 行{rows.length !== (t?.rows || []).length ? `（共 ${(t?.rows || []).length}）` : ''}</Dim>
        <div className="flex-1" />
        <button type="button" className="lf-fold"
                onClick={() => downloadTableCsv(cols, t?.rows || [], `${view}-结果表.csv`)}>
          ⤓ CSV
        </button>
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        <table className="lf-table lf-table-zebra">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} style={{ minWidth: i === 0 ? 120 : 88,
                                      textAlign: numCol[i] ? 'right' : 'left' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} onClick={() => ui.set('view', view)}>
                {r.map((v, j) => {
                  const s = v === null || v === undefined || v === '' ? null : String(v);
                  return (
                    <td key={j} title={s ?? undefined}
                        style={{ textAlign: s && numCol[j] ? 'right' : 'left' }}>
                      {s === null ? <span className="lf-dim">—</span> : s}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResultRail() {
  const { ui } = useTool();
  const [tab, setTab] = useUi<'table' | 'log'>('resultTab');
  const hidden = useUiValue<boolean>('bottomHidden');
  const { k } = useTool();
  const view = useUiValue<string>('view');
  const entry = k.pool[view] || k.pool['3d'];

  const stampText = useMemo(() => {
    const s = entry?.stamp;
    if (!s) return '';
    return [s.version && `v${s.version}`, s.physics, s.kernel].filter(Boolean).join(' · ');
  }, [entry]);

  if (hidden) return null;

  return (
    <div className="flex flex-col shrink-0 min-h-0"
         style={{ width: 340, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>
      <div className="flex items-end gap-1 px-2 pt-2 shrink-0">
        <TabBtn label="计算结果表" active={tab === 'table'} onClick={() => setTab('table')} />
        <TabBtn label="运行日志" active={tab === 'log'} onClick={() => setTab('log')} />
      </div>
      <div className="flex flex-col flex-1 min-h-0"
           style={{ borderTop: '1px solid var(--border)' }}>
        {tab === 'table' ? (
          <>
            {entry?.keyNumbers && Object.keys(entry.keyNumbers).length > 0 && (
              <KeyCards kn={entry.keyNumbers} />
            )}
            <ResultTable />
          </>
        ) : <LogPane />}
      </div>
      {(entry?.summary || stampText) && (
        <div className="px-2 py-1.5 shrink-0 text-[11px] leading-[1.6]"
             style={{ borderTop: '1px solid var(--border)' }}>
          {entry?.summary && (
            <p style={{ color: 'var(--text-primary)' }}>{entry.summary}</p>
          )}
          {stampText && <p className="lf-dim lf-mono">口径 {stampText}</p>}
        </div>
      )}
    </div>
  );
}
