/**
 * chrome/ResultRail.tsx · 右侧结果条（桌面 app.py:4174-4209，固定宽 340px）
 *
 * 桌面这里是**图右侧的固定列**，不是图下方的一条：
 * Notebook 两页签「计算结果表」/「运行日志」。
 * 注意「▣ 隐藏结果/日志」隐藏的就是这一列（不是图下方的条）。
 *
 * 结果表 = headings-only Treeview 的等价物：**动态列**，列头 PANEL2 底 +
 * ACCENT 字，行高 30；首列宽 130、其余 90（桌面 _fill_result 的口径）。
 */
import { useMemo } from 'react';
import { useTool, useUi } from '../state/context';
import { useUiValue } from '../state/context';
import { Dim, TabBtn } from '../ui/Primitives';
import { downloadTableCsv } from '../state/api';

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
        <table className="lf-table">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={i} style={{ minWidth: i === 0 ? 130 : 90 }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} onClick={() => ui.set('view', view)}>
                {r.map((v, j) => (
                  <td key={j}>{v === null || v === undefined || v === ''
                    ? <span className="lf-dim">—</span> : String(v)}</td>
                ))}
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
  const objInfo = k.pool['3d'];

  const stampText = useMemo(() => {
    const s = objInfo?.stamp;
    if (!s) return '';
    return [s.version && `v${s.version}`, s.physics, s.kernel].filter(Boolean).join(' · ');
  }, [objInfo]);

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
        {tab === 'table' ? <ResultTable /> : <LogPane />}
      </div>
      {(objInfo?.summary || stampText) && (
        <div className="px-2 py-1.5 shrink-0 text-[11px] leading-[1.6]"
             style={{ borderTop: '1px solid var(--border)' }}>
          {objInfo?.summary && (
            <p style={{ color: 'var(--text-primary)' }}>{objInfo.summary}</p>
          )}
          {stampText && <p className="lf-dim lf-mono">口径 {stampText}</p>}
        </div>
      )}
    </div>
  );
}
