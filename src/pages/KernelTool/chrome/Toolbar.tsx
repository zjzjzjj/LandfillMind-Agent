/**
 * chrome/Toolbar.tsx · 工具栏（桌面 app.py:691-720，h=46）
 *
 * 8 个按钮按桌面顺序；「▶ 执行建模」是 Accent 蓝底白字；右端灰字提示快捷键。
 * 「导入基底/顶面」除了工具栏，工程菜单里也有（桌面同款冗余）。
 */
import { useRef, useState } from 'react';
import { useTool } from '../state/context';
import { useFormValue } from '../state/context';
import { useActions } from '../state/actions';
import { Btn, VSep } from '../ui/Primitives';

export default function Toolbar() {
  const { k, form } = useTool();
  const a = useActions();
  const mode = useFormValue<string>('build.mode');
  const projRef = useRef<HTMLInputElement>(null);
  const ptsRef = useRef<HTMLInputElement>(null);
  const [ptsKind, setPtsKind] = useState<'base' | 'top'>('base');

  async function onPoints(file: File) {
    const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) { k.log('测点 CSV 为空', 'err'); return; }
    const body = /[a-zA-Z一-龥]/.test(lines[0]) ? lines.slice(1) : lines;
    const pts = body.map((l) => l.split(/[,，\t;]+/).map(Number))
      .filter((p) => p.length >= 2 && p.every(Number.isFinite));
    if (pts.length < 3) { k.log('测点至少需要 3 行有效 x,y(,z)', 'err'); return; }
    form.set(ptsKind === 'base' ? 'build.basePtsText' : 'build.topPtsText',
      pts.map((p) => p.join(',')).join('\n'));
    form.set('build.mode', 'points');
    k.log(`已导入${ptsKind === 'base' ? '基底' : '顶面'}测点 ${pts.length} 点`, 'ok');
  }

  const isPoints = mode === 'points';

  return (
    <div className="lf-bar flex items-center gap-1.5 px-3 shrink-0" style={{ height: 46 }}>
      <Btn onClick={() => void a.doBuild('plain')}
           tip="加载内置示例平原型填埋场（一期已封场 + 二期在填，含扩建区）">
        ▶ 示例工程
      </Btn>
      <Btn onClick={() => { setPtsKind('base'); ptsRef.current?.click(); }}
           tip="导入基底测点 CSV（等价桌面「▤ 导入基底」）">
        ▤ 导入基底
      </Btn>
      <Btn onClick={() => { setPtsKind('top'); ptsRef.current?.click(); }}
           tip="导入堆体顶面测点 CSV">
        ▤ 导入顶面
      </Btn>
      <VSep />
      <Btn kind="accent" onClick={() => void a.doBuild()}
           tip={isPoints ? '执行三维建模（测点插值）' : '一键生成三维模型'}>
        ▶ 执行建模
      </Btn>
      <Btn onClick={() => void a.doFigureExport('png')} tip="导出当前视图的图片（PNG 300dpi）">
        ◆ 导出图片
      </Btn>
      <Btn onClick={() => void a.doExportReport('txt')} tip="导出本次分析的文字简报">
        ≡ 导出报告
      </Btn>
      <VSep />
      <Btn onClick={a.doSaveProject} tip="下载工程存档（等价桌面「◉ 保存工程」）">
        ◉ 保存工程
      </Btn>
      <Btn onClick={() => projRef.current?.click()} tip="打开工程 JSON（等价桌面「⊗ 打开工程」）">
        ⊗ 打开工程
      </Btn>
      <div className="flex-1" />
      {k.busy && <span className="lf-dim">{k.busy} …</span>}
      <span className="lf-dim">Ctrl+O/S/E/R · F1 帮助</span>

      <input ref={projRef} type="file" accept=".json" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) void a.doImport(f);
             }} />
      <input ref={ptsRef} type="file" accept=".csv,.txt" className="hidden"
             onChange={(e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) void onPoints(f);
             }} />
    </div>
  );
}
