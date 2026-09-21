/**
 * ui/Primitives.tsx · 桌面控件的 Web 等价物
 *
 * 设计要点：**绑路径的控件自己订阅字段**（useField(path)），父组件不参与。
 * 于是左栏敲一个字符只重渲染那一个 <input>，整页（9 视图条 + 结果表 + 日志）
 * 不动。所有视觉类名走 skin.css 的 .lf-*。
 *
 * 对应关系：
 *   Grp   ← ttk.LabelFrame      Row ← 桌面 label(width=18)+控件 的一行
 *   Num/Txt/Sel/Chk/Area ← Entry/Combobox/Checkbutton/Text
 *   Btn   ← Small/普通/Accent 按钮     Tree ← ttk.Treeview
 */
import type { ReactNode } from 'react';
import { useField } from '../state/context';

// ---------------------------------------------------------------- 容器

/** 分组框（桌面 LabelFrame：白底 + 1px BORDER + ACCENT 标题） */
export function Grp({ title, children, note, style }: {
  title?: string; children: ReactNode; note?: string; style?: React.CSSProperties;
}) {
  return (
    <fieldset className="lf-frame mb-2" style={style}>
      {title && <legend>{title}</legend>}
      {note && <p className="lf-dim mb-1" style={{ lineHeight: 1.5 }}>{note}</p>}
      {children}
    </fieldset>
  );
}

/** 一行：左侧定宽标签 + 控件（桌面统一 label width=18） */
export function Row({ label, children, labelW = 118, tip }: {
  label?: string; children: ReactNode; labelW?: number; tip?: string;
}) {
  return (
    <div className="flex items-center gap-1 py-[3px]" title={tip}>
      {label !== undefined && (
        <span className="shrink-0" style={{ width: labelW, color: 'var(--text-primary)' }}>
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** 竖排（按钮行 / 说明） */
export function Col({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

// ---------------------------------------------------------------- 字段控件

/** 数字输入（value 存字符串：与桌面 StringVar 一致，空 = 未指定） */
export function Num({ path, width = 86, tip, step, placeholder, disabled }: {
  path: string; width?: number; tip?: string; step?: string;
  placeholder?: string; disabled?: boolean;
}) {
  const [v, set] = useField<string>(path);
  return (
    <input className="lf-input" style={{ width }} type="number" step={step}
           value={v ?? ''} placeholder={placeholder} disabled={disabled}
           title={tip} onChange={(e) => set(e.target.value)} />
  );
}

/** 文本输入 */
export function Txt({ path, width = 86, tip, placeholder, disabled }: {
  path: string; width?: number; tip?: string; placeholder?: string; disabled?: boolean;
}) {
  const [v, set] = useField<string>(path);
  return (
    <input className="lf-input" style={{ width }} type="text"
           value={v ?? ''} placeholder={placeholder} disabled={disabled}
           title={tip} onChange={(e) => set(e.target.value)} />
  );
}

/** 下拉。`options` 传 [值, 显示] 或纯值数组 */
export function Sel({ path, options, width = 128, tip, disabled }: {
  path: string;
  options: Array<string | [string, string]>;
  width?: number; tip?: string; disabled?: boolean;
}) {
  const [v, set] = useField<string>(path);
  const cur = v ?? '';
  return (
    <select className="lf-input" style={{ width }} value={cur} disabled={disabled}
            title={tip} onChange={(e) => set(e.target.value)}>
      {/* 值不在选项里（如工程导入带来别的取值）时补一个，免得静默改成首项 */}
      {cur !== '' && !options.some((o) => (Array.isArray(o) ? o[0] : o) === cur) && (
        <option value={cur}>{cur}</option>
      )}
      {options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return <option key={val} value={val}>{lab}</option>;
      })}
    </select>
  );
}

/** 复选（单框） */
export function Chk({ path, label, tip }: { path: string; label?: string; tip?: string }) {
  const [v, set] = useField<boolean>(path);
  return (
    <label className="flex items-center gap-1 cursor-pointer py-[3px]" title={tip}>
      <input type="checkbox" checked={Boolean(v)}
             onChange={(e) => set(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

/** 复选（裸框，配合外部 label） */
export function ChkBox({ path, tip }: { path: string; tip?: string }) {
  const [v, set] = useField<boolean>(path);
  return (
    <input type="checkbox" checked={Boolean(v)} title={tip}
           onChange={(e) => set(e.target.checked)} />
  );
}

/** 单选组（桌面 Radiobutton） */
export function Radios<T extends string>({ path, options, tip }: {
  path: string; options: Array<[T, string]>; tip?: string;
}) {
  const [v, set] = useField<T>(path);
  return (
    <div className="flex flex-wrap items-center gap-3" title={tip}>
      {options.map(([val, lab]) => (
        <label key={val} className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={v === val} onChange={() => set(val)} />
          <span>{lab}</span>
        </label>
      ))}
    </div>
  );
}

/** 多行文本（桌面 tk.Text：顶点坐标 / 分级开挖坡） */
export function Area({ path, rows = 5, tip, mono = true, width }: {
  path: string; rows?: number; tip?: string; mono?: boolean; width?: number;
}) {
  const [v, set] = useField<string>(path);
  return (
    <textarea
      className={`lf-input w-full ${mono ? 'lf-mono' : ''}`}
      style={{ width, resize: 'vertical' }}
      rows={rows} value={v ?? ''} title={tip}
      onChange={(e) => set(e.target.value)}
    />
  );
}

/** 数值滑杆（桌面 Scale：垂直夸张 0.5~6） */
export function Slider({ path, min, max, step = 0.1, width = 120, tip, fmt }: {
  path: string; min: number; max: number; step?: number;
  width?: number; tip?: string; fmt?: (v: number) => string;
}) {
  const [v, set] = useField<number>(path);
  const cur = typeof v === 'number' && Number.isFinite(v) ? v : min;
  return (
    <span className="flex items-center gap-2" title={tip}>
      <input type="range" style={{ width }} min={min} max={max} step={step}
             value={cur} onChange={(e) => set(parseFloat(e.target.value))} />
      <span className="lf-dim" style={{ minWidth: 34 }}>
        {fmt ? fmt(cur) : cur.toFixed(2)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- 按钮

export function Btn({ children, onClick, kind = 'normal', disabled, tip, width, type = 'button' }: {
  children: ReactNode; onClick?: () => void;
  kind?: 'normal' | 'accent' | 'sub'; disabled?: boolean; tip?: string;
  width?: number | string; type?: 'button' | 'submit';
}) {
  const cls = kind === 'accent' ? 'lf-btn lf-accent'
    : kind === 'sub' ? 'lf-subbtn' : 'lf-btn';
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled}
            title={tip} style={width !== undefined ? { width } : undefined}>
      {children}
    </button>
  );
}

/** 页签按钮（顶层页签 / 计算子页签 / 结果条页签） */
export function TabBtn({ label, active, onClick }: {
  label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={`lf-tab ${active ? 'lf-tab-on' : ''}`}
            onClick={onClick}>
      {label}
    </button>
  );
}

/** 折叠钮（桌面 ◀ 隐藏左栏 / ▣ 隐藏结果） */
export function FoldBtn({ label, onClick, tip }: {
  label: string; onClick: () => void; tip?: string;
}) {
  return (
    <button type="button" className="lf-fold" onClick={onClick} title={tip}>
      {label}
    </button>
  );
}

/** 竖分隔线 */
export function VSep() {
  return <span className="inline-block w-px h-4 mx-1.5 align-middle"
               style={{ background: 'var(--border)' }} />;
}

/** 右端灰字说明（桌面 DimBG.TLabel） */
export function Dim({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`lf-dim ${className}`}>{children}</span>;
}

/** 结果标签（桌面 lbl_* ：一行灰字结论） */
export function ResultLine({ text }: { text?: string | null }) {
  if (!text) return <p className="lf-dim mt-1.5">—</p>;
  return (
    <p className="mt-1.5" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
      {text}
    </p>
  );
}
