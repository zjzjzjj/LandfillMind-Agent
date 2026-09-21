/**
 * chrome/MenuBar.tsx · 桌面菜单栏（工程 / 帮助）
 *
 * 菜单项逐条照抄 app.py:603-637。「退出」在 Web 上没有意义，换成
 * 「返回智能体」—— 这是全屏接管后唯一的出口（桌面靠关窗口）。
 * 快捷键与桌面一致：Ctrl+O/S/E/R、Ctrl+Shift+R、F1。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActions } from '../state/actions';
import { useTool } from '../state/context';

interface Item { label: string; onClick?: () => void; sep?: boolean; tip?: string }

export default function MenuBar({ onHelp, onAbout }: {
  onHelp: () => void; onAbout: () => void;
}) {
  const nav = useNavigate();
  const a = useActions();
  const { k, form } = useTool();
  const [open, setOpen] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const ptsRef = useRef<HTMLInputElement>(null);
  const [ptsKind, setPtsKind] = useState<'base' | 'top'>('base');

  // 点空白处收起
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pickPoints = (kind: 'base' | 'top') => {
    setPtsKind(kind);
    ptsRef.current?.click();     // 用同一个 CSV input，靠 ptsKind 区分回填到哪一栏
  };

  async function onPointsFile(file: File) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) { k.log('测点 CSV 为空', 'err'); return; }
    // 跳过表头（首行含非数字）
    const body = /[a-zA-Z一-龥]/.test(lines[0]) ? lines.slice(1) : lines;
    const pts = body.map((l) => l.split(/[,，\t;]+/).map(Number))
      .filter((p) => p.length >= 2 && p.every((v) => Number.isFinite(v)));
    if (pts.length < 3) { k.log('测点至少需要 3 行有效 x,y(,z)', 'err'); return; }
    const path = ptsKind === 'base' ? 'build.basePtsText' : 'build.topPtsText';
    form.set(path, pts.map((p) => p.join(',')).join('\n'));
    form.set('build.mode', 'points');
    k.log(`已导入${ptsKind === 'base' ? '基底' : '顶面'}测点 ${pts.length} 点（CSV）`, 'ok');
  }

  async function onOpenProject(file: File) {
    await a.doImport(file);
  }

  const items: Record<string, Item[]> = {
    工程: [
      { label: '加载示例 · 平原型 (多单元)', onClick: () => a.doBuild('plain') },
      { label: '加载示例 · 山谷型 (测点插值)', onClick: () => a.doBuild('valley') },
      { label: '', sep: true },
      { label: '导入基底测点 CSV…', onClick: () => pickPoints('base') },
      { label: '导入堆体顶面测点 CSV…', onClick: () => pickPoints('top') },
      { label: '', sep: true },
      { label: '保存工程 (.json)…', onClick: a.doSaveProject, tip: '等价桌面「另存工程」= 下载会话工程存档' },
      { label: '打开工程 (.json)…', onClick: () => projRef.current?.click() },
      { label: '', sep: true },
      { label: '导出当前视图图片 PNG…', onClick: () => a.doFigureExport('png') },
      { label: '导出分析报告 TXT…', onClick: () => a.doExportReport('txt') },
      { label: '导出 Word 报告 DOCX…（嵌图）', onClick: () => a.doExportReport('docx') },
      { label: '导出 Excel 汇总…（全部结果多表）', onClick: () => a.doExportReport('xlsx') },
      { label: '', sep: true },
      { label: '返回智能体', onClick: () => nav('/chat/new'), tip: '桌面此处为「退出」；Web 上改为回到智能体对话' },
    ],
    帮助: [
      { label: '使用说明', onClick: onHelp },
      { label: '关于', onClick: onAbout },
    ],
  };

  // 快捷键（桌面 app.py:588-594）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey && e.key !== 'F1') return;
      const key = e.key.toLowerCase();
      if (key === 'o') { e.preventDefault(); projRef.current?.click(); }
      else if (key === 's') { e.preventDefault(); a.doSaveProject(); }
      else if (key === 'e') { e.preventDefault(); a.doFigureExport('png'); }
      else if (key === 'r') { e.preventDefault(); void a.doBuild(); }
      else if (e.key === 'F1') { e.preventDefault(); onHelp(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [a, onHelp]);

  return (
    <div ref={barRef} className="flex items-center shrink-0 select-none"
         style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
      {Object.entries(items).map(([name, list]) => (
        <div key={name} className="relative">
          <button type="button"
                  className="px-3 py-1 text-[12px]"
                  style={{
                    background: open === name ? 'var(--lf-sel)' : 'transparent',
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={() => open && setOpen(name)}
                  onClick={() => setOpen(open === name ? null : name)}>
            {name}
          </button>
          {open === name && (
            <div className="absolute left-0 top-full z-50 py-1 min-w-[248px]"
                 style={{
                   background: 'var(--bg-surface)',
                   border: '1px solid var(--border)',
                   boxShadow: '0 4px 14px rgba(22,39,58,.16)',
                 }}>
              {list.map((it, i) => it.sep ? (
                <div key={i} className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
              ) : (
                <button key={i} type="button" title={it.tip}
                        className="block w-full text-left px-3 py-[5px] text-[12px]"
                        style={{ color: 'var(--text-primary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--lf-sel)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        onClick={() => { setOpen(null); it.onClick?.(); }}>
                  {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {/* 两个隐藏文件输入：工程 JSON / 测点 CSV */}
      <input ref={projRef} type="file" accept=".json" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) void onOpenProject(f);
             }} />
      <input ref={ptsRef} type="file" accept=".csv,.txt" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) void onPointsFile(f);
             }} />
    </div>
  );
}

/** 供 Toolbar 复用：触发测点 CSV 选择（默认基底） */
export function triggerPointsInput() {
  const el = document.querySelector<HTMLInputElement>('input[type=file][accept=".csv,.txt"]');
  el?.click();
}
