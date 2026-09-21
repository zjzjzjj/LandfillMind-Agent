/**
 * KernelTool/index.tsx · 合并后的「三维建模分析」页（全屏）
 *
 * 这一页同时是**查看器**与**建模分析工作台** —— 原 /3d-simulator（Kernel3DPage）
 * 与 /tool（LandfillToolPage）两个入口合并到此，几何数据本来就同源。
 *
 * 布局照桌面 app.py 的骨架：
 *   菜单栏 → 品牌条(h=60) → 工具栏(h=46) → [左栏参数控制台 | 中央图形区 + 右侧结果条] → 状态栏(h=32)
 * 全屏接管（不套 AppShell），所以要在菜单栏里留「返回智能体」出口。
 *
 * 状态分两层：
 *   form  —— 表单（上百个字段），字段级订阅，见 state/store.ts
 *   ui    —— 布局（页签/视图/折叠/栏宽），低频
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ToolCtx, useTool } from './KernelTool/state/context';
import { createFieldStore } from './KernelTool/state/store';
import { useKernelRun } from './KernelTool/state/run';
import { defaultForm, defaultUi, type FormState, type UiState } from './KernelTool/spec/defaults';
import { fetchKernelInfo } from './KernelTool/state/api';
import './KernelTool/skin.css';

import MenuBar from './KernelTool/chrome/MenuBar';
import BrandBar from './KernelTool/chrome/BrandBar';
import Toolbar from './KernelTool/chrome/Toolbar';
import StatusBar from './KernelTool/chrome/StatusBar';
import ViewBar from './KernelTool/chrome/ViewBar';
import ResultRail from './KernelTool/chrome/ResultRail';
import FigureStage from './KernelTool/stage/FigureStage';
import BuildPanel from './KernelTool/panels/BuildPanel';
import CalcPanel from './KernelTool/panels/CalcPanel';
import PollutionPanel from './KernelTool/panels/PollutionPanel';
import ExcavationPanel from './KernelTool/panels/ExcavationPanel';
import { Dim, TabBtn } from './KernelTool/ui/Primitives';
import type { MeshApi } from '../components/KernelMeshView';

const MAIN_TABS = ['建模', '计算', '污染', '开挖'] as const;

export default function KernelToolPage() {
  // store 只建一次（严格模式下双调用 render 也不能重建，否则表单被清空）
  const form = useMemo(() => createFieldStore(defaultForm()), []);
  const ui = useMemo(() => createFieldStore(defaultUi()), []);
  const k = useKernelRun();

  const ctx = useMemo(() => ({ form, ui, k }), [form, ui, k]);

  const meshApi = useRef<MeshApi | null>(null);
  const [meshErr, setMeshErr] = useState('');
  const [help, setHelp] = useState<null | 'help' | 'about'>(null);

  // 内核自述（版本号 / 下拉选项 / 默认值）—— 一次拉取，作为对齐的单一来源
  useEffect(() => {
    void (async () => {
      const info = await fetchKernelInfo();
      if (info) {
        k.setKernelInfo(info);
        k.log(`内核已连接：v${info.landfill3d?.version ?? '?'}`
          + `（口径 ${info.landfill3d?.physics ?? '?'}，`
          + `${info.actions?.length ?? 0} 个动作 / ${info.figures?.length ?? 0} 张图）`, 'ok');
      } else {
        k.log('未能读取内核自述（/api/kernel3d/info）—— 下拉选项与默认值将缺失；'
          + '请检查 KERNEL3D_REPO_PATH 与 Python 解释器', 'err');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切走视图时停 rAF，省电省 CPU（三维视图才需要持续渲染）
  const view = ui.useValue<string>('view');
  const leftHidden = ui.useValue<boolean>('leftHidden');
  const mainTab = ui.useValue<string>('mainTab');
  const leftW = ui.useValue<number>('leftW');
  return (
    <ToolCtx.Provider value={ctx}>
      <div className="lf-light fixed inset-0 flex flex-col overflow-hidden">
        <MenuBar onHelp={() => setHelp('help')} onAbout={() => setHelp('about')} />
        <BrandBar />
        <Toolbar />

        <div className="flex flex-1 min-h-0">
          {/* 左栏参数控制台（桌面 minsize=360, width=400） */}
          {!leftHidden && (
            <>
              <div className="flex flex-col shrink-0 min-h-0"
                   style={{ width: leftW, background: 'var(--bg-surface)',
                            borderRight: '1px solid var(--border)' }}>
                <div className="flex items-end gap-0.5 px-2 pt-2 shrink-0">
                  {MAIN_TABS.map((t) => (
                    <TabBtn key={t} label={t} active={mainTab === t}
                            onClick={() => ui.set('mainTab', t)} />
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
                     style={{ borderTop: '1px solid var(--border)' }}>
                  {mainTab === '建模' && <BuildPanel />}
                  {mainTab === '计算' && <CalcPanel />}
                  {mainTab === '污染' && <PollutionPanel />}
                  {mainTab === '开挖' && <ExcavationPanel />}
                </div>
              </div>
              <Splitter path="leftW" min={320} max={680} side="left" />
            </>
          )}

          {/* 中央图形区 */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <ViewBar meshApi={meshApi} />
            {/* 三维网格为空/出错时的提示条（桌面是画布占位图 + 引导去建模） */}
            {view === '3d' && meshErr && (
              <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 text-[11px]"
                   style={{ background: 'var(--lf-warn-bg)', color: 'var(--lf-warn-fg)' }}>
                <span>三维模型不可用：{meshErr}</span>
                <button type="button" className="lf-fold" onClick={() => setMeshErr('')}>知道了</button>
              </div>
            )}
            <FigureStage
              meshApi={meshApi}
              onMeshStatus={() => setMeshErr('')}
              onMeshError={setMeshErr}
            />
          </div>

          {/* 右侧结果条（桌面固定 340px） */}
          <ResultRail />
        </div>

        <StatusBar />
      </div>

      {help && <InfoModal kind={help} onClose={() => setHelp(null)} />}
    </ToolCtx.Provider>
  );
}

/** 左右栏拖拽分隔（桌面 PanedWindow 的等价物） */
function Splitter({ path, min, max, side }: {
  path: string; min: number; max: number; side: 'left' | 'right';
}) {
  const { ui } = useTool();
  const [w, setW] = ui.useField<number>(path);
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const v = side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      setW(Math.max(min, Math.min(max, v)));
    };
    const up = () => { dragging.current = false; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [setW, min, max, side]);
  void w;
  return (
    <div className="w-[4px] shrink-0 cursor-col-resize"
         style={{ background: 'var(--border)' }}
         onMouseDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize'; }}
         title="拖动调整栏宽（桌面 PanedWindow）" />
  );
}

/** 帮助 / 关于（桌面是 messagebox，Web 用弹层） */
function InfoModal({ kind, onClose }: { kind: 'help' | 'about'; onClose: () => void }) {
  const { k } = useTool();
  const ver = k.info?.landfill3d?.version ?? '?';
  const physics = k.info?.landfill3d?.physics ?? '?';
  const kernel = k.info?.landfill3d?.kernel ?? '';
  return (
    <div className="lf-modal fixed inset-0 z-[120] flex items-center justify-center p-6"
         style={{ background: 'rgba(22,39,58,.45)' }} onClick={onClose}>
      <div className="max-w-[640px] max-h-[80vh] overflow-auto p-5"
           style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
           onClick={(e) => e.stopPropagation()}>
        <h2 className="lf-group-title mb-2">
          {kind === 'help' ? '使用说明' : '关于'}
        </h2>
        {kind === 'help' ? (
          <div className="text-[12px] leading-[1.8]" style={{ color: 'var(--text-primary)' }}>
            <p>本页是桌面工具 <b>填埋场三维建模分析工具</b> 的 Web 复刻，工作流与桌面一致：</p>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>左栏 <b>建模</b> 页设好底形/堆高/坡比（或点工具栏「▶ 示例工程」直接加载示例），
                  点 <b>▶ 一键生成三维模型</b>。</li>
              <li>切到 <b>计算</b> 页的五个子页（库容/坡度/剖面/沉降/稳定性），逐个点计算按钮出图。</li>
              <li><b>污染</b> 页跑产气—渗滤液—羽流全链路；<b>开挖</b> 页画切割线分区后应用开挖并算稳定性。</li>
              <li>中央图形区的 9 个视图按钮切换视图；子视图条切同一分析的不同图。</li>
              <li><b>⤓ 导出当前图</b> 出 PNG 300dpi / PDF / SVG 或底层数据 CSV；
                  <b>工程</b> 菜单导出 TXT / Word / Excel 报告。</li>
            </ol>
            <p className="mt-3">三维视图：左键旋转 · 右键缩放 · 滚轮缩放。
              左栏 ⑥ 三维显示 的开关会驱动内核重新导出网格（含等高线/滑面/Fs/热力层叠加）。</p>
            <p className="mt-2">快捷键：Ctrl+O 打开工程 · Ctrl+S 保存 · Ctrl+E 导出图片 ·
              Ctrl+R 执行建模 · F1 帮助。</p>
          </div>
        ) : (
          <div className="text-[12px] leading-[1.8]" style={{ color: 'var(--text-primary)' }}>
            <p><b>填埋场三维建模分析工具</b>（Web 版）</p>
            <p className="lf-mono mt-2">内核版本 v{ver} · 口径 {physics} · kernel {kernel}</p>
            <p className="mt-2">数值全部出自 Landfill 3D Tool Python 内核，经
              <span className="lf-mono"> /api/kernel3d/run</span> 直驱（确定性计算，落 tool_runs 可追溯）。</p>
            <p className="mt-2 lf-dim">本页与原「3D 模拟」查看器合并 —— 两者渲染的本就是同一份
              会话几何（model.obj）。</p>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="button" className="lf-btn lf-accent" onClick={onClose}>关闭</button>
        </div>
        <Dim className="mt-2">（桌面此处为 F1 帮助 / 关于对话框）</Dim>
      </div>
    </div>
  );
}

export { TabBtn };
