/**
 * ui/TreeTable.tsx · 桌面 ttk.Treeview 的两种等价物
 *
 *  Tree       —— 只读动态列表格（结果表 tree_res、单元填埋年表 tree_poll_cells）
 *               列头 PANEL2 底 + ACCENT 字，行高 30，选中底 #bcdcf7
 *  RowsEditor —— 可编辑行表（填埋单元 / 分层填埋 / 地基压缩层 / 开挖分区 /
 *               材料分层），带桌面那套 添加·删除·上移·下移·清空 按钮
 */
import { useState, type ReactNode } from 'react';
import { useTool, useField } from '../state/context';
import { Btn, Dim } from './Primitives';

/** 只读动态列表格 */
export function Tree({ cols, rows, empty = '（暂无数据）', maxRows, onRowClick, selected }: {
  cols: string[]; rows: unknown[][]; empty?: string;
  maxRows?: number; onRowClick?: (i: number) => void; selected?: number | null;
}) {
  const show = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <div className="overflow-auto flex-1 min-h-0">
      <table className="lf-table">
        <thead>
          <tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {show.length === 0 && (
            <tr><td colSpan={Math.max(1, cols.length)} className="lf-dim">{empty}</td></tr>
          )}
          {show.map((r, i) => (
            <tr key={i} className={selected === i ? 'lf-row-sel' : ''}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {r.map((v, j) => (
                <td key={j}>{v === null || v === undefined || v === ''
                  ? <span className="lf-dim">—</span> : String(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ColDef {
  key: string;
  label: string;
  /** 列宽 px（桌面 Treeview 每列都有明确 width） */
  w?: number;
  type?: 'text' | 'num' | 'sel' | 'chk';
  options?: string[];
  /** 只读列（如桌面的「序」「来源」） */
  readonly?: boolean;
  step?: string;
}

/**
 * 可编辑行表。
 *
 * path 指向 store 里的数组（如 'build.layers'）。改单元格 = 复制数组后整体写回，
 * 所以整表会在编辑时重渲染 —— 这些表最多几十行，代价可接受；左栏其余控件
 * 仍各自独立订阅，不受影响。
 */
export function RowsEditor({ path, cols, blank, extraButtons, height = 4, onRowSelect, selected }: {
  path: string;
  cols: ColDef[];
  /** 「添加」用的空白行 */
  blank: () => Record<string, unknown>;
  /** 额外按钮（桌面「全部设为统一坡度」这类） */
  extraButtons?: ReactNode;
  height?: number;
  onRowSelect?: (i: number | null) => void;
  selected?: number | null;
}) {
  const { form } = useTool();
  const [rows, setRows] = useField<Array<Record<string, unknown>>>(path);
  const [sel, setSel] = useState<number | null>(null);
  const list = Array.isArray(rows) ? rows : [];
  const cur = selected !== undefined ? selected : sel;
  const setCur = (i: number | null) => { setSel(i); onRowSelect?.(i); };

  const commit = (next: Array<Record<string, unknown>>) => setRows(next);

  const editCell = (rowIdx: number, key: string, v: unknown) => {
    const next = list.map((r, i) => (i === rowIdx ? { ...r, [key]: v } : r));
    commit(next);
  };

  return (
    <div>
      <div className="overflow-auto" style={{ maxHeight: 30 * height + 30 }}>
        <table className="lf-table">
          <thead>
            <tr>{cols.map((c) => (
              <th key={c.key} style={c.w ? { width: c.w } : undefined}>{c.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={cols.length} className="lf-dim">（暂无行）</td></tr>
            )}
            {list.map((r, i) => (
              <tr key={i} className={cur === i ? 'lf-row-sel' : ''}
                  onClick={() => setCur(i)}>
                {cols.map((c) => (
                  <td key={c.key} style={{ padding: 2 }}>
                    {c.readonly ? (
                      <span className="lf-dim">{String(r[c.key] ?? '—')}</span>
                    ) : c.type === 'chk' ? (
                      <input type="checkbox"
                             checked={!!r[c.key]}
                             onChange={(e) => editCell(i, c.key, e.target.checked)}
                             onClick={(e) => e.stopPropagation()} />
                    ) : c.type === 'sel' ? (
                      <select className="lf-input w-full" value={String(r[c.key] ?? '')}
                              onChange={(e) => editCell(i, c.key, e.target.value)}>
                        {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="lf-input w-full"
                             type={c.type === 'num' ? 'number' : 'text'}
                             step={c.step || 'any'}
                             value={String(r[c.key] ?? '')}
                             onChange={(e) => editCell(i, c.key, c.type === 'num'
                               ? e.target.value : e.target.value)} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        <Btn kind="sub" onClick={() => commit([...list, blank()])}>＋ 添加</Btn>
        <Btn kind="sub" disabled={cur === null}
             onClick={() => {
               if (cur === null) return;
               commit(list.filter((_, i) => i !== cur));
               setCur(null);
             }}>✕ 删除选中</Btn>
        <Btn kind="sub" disabled={cur === null || cur === 0}
             onClick={() => {
               if (cur === null || cur === 0) return;
               const n = [...list];
               [n[cur - 1], n[cur]] = [n[cur], n[cur - 1]];
               commit(n); setCur(cur - 1);
             }}>▲ 上移</Btn>
        <Btn kind="sub" disabled={cur === null || cur === list.length - 1}
             onClick={() => {
               if (cur === null || cur === list.length - 1) return;
               const n = [...list];
               [n[cur + 1], n[cur]] = [n[cur], n[cur + 1]];
               commit(n); setCur(cur + 1);
             }}>▼ 下移</Btn>
        <Btn kind="sub" disabled={list.length === 0}
             onClick={() => { commit([]); setCur(null); }}>清空</Btn>
        {extraButtons}
      </div>
    </div>
  );
}

/** 一行说明文字（桌面 Dim.TLabel，常用于表格下方） */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="lf-dim mt-1" style={{ lineHeight: 1.5 }}>{children}</p>;
}

export { Dim };
