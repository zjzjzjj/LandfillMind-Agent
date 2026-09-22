/**
 * stage/FigureStage.tsx · 中央图形区（桌面 app.py:4163-4172 的 matplotlib 画布）
 *
 * 三种呈现，互斥：
 *  1. 3D 交互视图（默认）—— KernelMeshView，叠加层由内核按 ⑥三维显示 导出
 *  2. ◧ 内核图 —— 内核渲染的 matplotlib 三维 PNG（严格对照桌面成图时用）
 *  3. 二维结果图 —— 当前子视图的 PNG（PNG 池里按 fig.key 取）
 *
 * 无数据时给桌面同款占位图（圆圈 marker + 文案），不是空白。
 */
import { useMemo, type MutableRefObject } from 'react';
import KernelMeshView, { type MeshApi, type MeshStatus } from '../../../components/KernelMeshView';
import { useTool, useFormValue, useUiValue } from '../state/context';
import { useActions } from '../state/actions';
import { KERNEL_3D_FIG, RENDERABLE, SUB_BARS, VIEW_LABEL, type ViewKey } from '../spec/views';
import { Dim } from '../ui/Primitives';

/** 桌面同款占位图：圆圈 marker + 文案（app.py:5888-5904） */
export function Placeholder({ text }: { text?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6"
         style={{ background: 'var(--bg-base)' }}>
      <div className="rounded-full"
           style={{ width: 56, height: 56, border: '3px solid var(--border)' }} />
      <p style={{ color: 'var(--text-muted)' }}>
        {text || '暂无内容'}
      </p>
      <Dim>参数在左侧调整后，点击对应页的计算按钮即可出图</Dim>
    </div>
  );
}

export default function FigureStage({
  meshApi, onMeshStatus, onMeshError,
}: {
  meshApi: MutableRefObject<MeshApi | null>;
  onMeshStatus?: (s: MeshStatus) => void;
  onMeshError?: (msg: string) => void;
}) {
  const { k, form } = useTool();
  const a = useActions();
  const view = useUiValue<string>('view');
  const sub = useUiValue<Record<string, string>>('sub') || {};
  const kernelImage = useFormValue<boolean>('display.kernelImage');
  const wire = useFormValue<boolean>('display.wire');
  const clipOn = useFormValue<boolean>('display.clipOn');
  const clipFrac = useFormValue<number>('display.clipFrac');
  const zexag = useFormValue<number>('display.zexag');
  const showBase = useFormValue<boolean>('display.showBase');
  const showTop = useFormValue<boolean>('display.showTop');
  const showContour = useFormValue<boolean>('display.showContour');
  const showSlip = useFormValue<boolean>('display.showSlip');
  const showDanger = useFormValue<boolean>('display.showDanger');
  const showExcFs = useFormValue<boolean>('display.showExcFs');
  const showHeat = useFormValue<boolean>('display.showHeat');
  const floodOn = useFormValue<boolean>('display.floodOn');
  const viewToken = useUiValue<{ kind: 'bird' | 'top' | 'front'; token: number; dAzim?: number } | null>('viewToken');

  const entry = k.pool[view];
  const bar = SUB_BARS[view as keyof typeof SUB_BARS];
  const curSubKey = sub[view];
  const subBtn = bar?.buttons.find((b) => b.k === curSubKey);
  const subFigs = subBtn ? (Array.isArray(subBtn.fig) ? subBtn.fig : [subBtn.fig]) : [];

  /**
   * 当前该显示哪张图。
   *
   * ⚠ 没有子视图条的四个**模型类视图**（等高线/坡度/剖面/库容曲线）也必须有图 ——
   * 它们各自只有一张（RENDERABLE 里点名）。早先只按子视图条取，这四类视图的
   * curFig 恒为 null，于是「计算成功、状态栏也对，画面却是'还没有结果'」。
   * 取不到时兜底用池子里的第一张（model3d 这类单图视图也走这条）。
   */
  const curFig = useMemo(() => {
    const want = subFigs.length
      ? subFigs
      : (RENDERABLE[view as ViewKey]?.fig ? [RENDERABLE[view as ViewKey]!.fig] : []);
    const hit = want.map((f) => entry?.figs?.find((x) => x.key === f)).find(Boolean);
    return hit ?? entry?.figs?.[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, subFigs.join(','), view]);

  /**
   * 叠加层的**分析参数**也必须进依赖。
   *
   * 早先只订阅了几个显示开关，于是改「淹没标高」或改稳定性的 c/φ、改沉降土层
   * 之后，三维里的等高线/Fs/热力层纹丝不动 —— 要反勾一次复选框才刷新。
   * 这里整棵表单订阅一次是安全的：KernelMeshView 按 JSON 串比较决定要不要重
   * 拉网格，值没真变时一次内核也不会多打。
   */
  const st = form.useAll();
  /**
   * 叠加层指令。⚠ 淹没面标高必须算进这里：内核从 `overlaySpec.flood.level` 取
   * 高度，而 overlayParams 里没有这个键，不并进来的话改标高要重勾一次
   * 「淹没/填埋面」才刷新（早先就是这样）。
   */
  const overlaySpec = useMemo(() => {
    const ov = a.overlaySpec(st.display);
    if (!ov) return null;
    const lv = Number(st.display.floodH);
    if (st.display.floodOn && Number.isFinite(lv) && ov.flood) {
      return { ...ov, flood: { ...ov.flood, level: lv } };
    }
    return ov;
  }, [a, st]);
  const overlayParams = useMemo(() => a.overlayParams(st), [a, st]);

  const groups = useMemo(() => {
    const g: Record<string, boolean> = {
      top: showTop, side: true, base: showBase, contour: showContour,
    };
    if (showSlip) g.slip = true;
    if (showDanger || showExcFs) g.fs = true;
    if (showHeat) g.heat = true;
    if (floodOn) g.flood = true;
    return g;
  }, [showTop, showBase, showContour, showSlip, showDanger, showExcFs, showHeat, floodOn]);

  const is3d = view === '3d';
  const kernelFig = entry?.figs?.find((f) => f.key === KERNEL_3D_FIG);
  // ---- 逐阶段工件 (P3)：ui.stage3d 命中时 3D 吃该阶段 OBJ、阶段剖面吃该
  // 阶段 PNG —— 下拉切换变成纯 UI 操作, 不再重跑内核 ----
  const stage3dIdx = useUiValue<number | null>('stage3d');
  const stageRes = k.pool['excavation']?.stageRes || [];
  const stageHit = stage3dIdx != null
    ? stageRes.find((s) => s.stage === stage3dIdx) : undefined;
  const stageFigUrl = !is3d && view === 'excavation'
    && (sub[view] || 'exc_phases') === 'exc_stage'
    ? stageHit?.figUrl : undefined;

  return (
    <div className="relative flex-1 min-h-0" style={{ background: 'var(--bg-base)' }}>
      {is3d && !kernelImage && (
        <KernelMeshView
          reloadKey={k.meshKey}
          sid={k.sid}
          meshUrl={stageHit?.meshUrl ?? null}
          meshBounds={stageHit?.bounds ?? null}
          wire={wire}
          clipOn={clipOn}
          clipFrac={clipFrac}
          zexag={zexag}
          groups={groups}
          view={viewToken}
          overlaySpec={overlaySpec}
          overlayParams={overlayParams}
          apiRef={meshApi}
          onStatus={(s) => {
            onMeshStatus?.(s);
            if (s.phase === 'empty' || s.phase === 'error') onMeshError?.(s.err);
          }}
        />
      )}

      {is3d && kernelImage && (
        kernelFig ? (
          <img src={kernelFig.url} alt="内核三维图"
               className="absolute inset-0 w-full h-full object-contain" />
        ) : (
          <Placeholder text="内核三维图还没生成 —— 点一次「执行建模」或「导出当前图」" />
        )
      )}

      {!is3d && (curFig || stageFigUrl ? (
        <img src={stageFigUrl ?? curFig!.url} alt={stageHit ? `阶段 ${stageHit.stage} 剖面` : (curFig?.label ?? '')}
             className="absolute inset-0 w-full h-full object-contain" />
      ) : (
        <Placeholder text={`「${VIEW_LABEL[view] || view}」还没有结果`} />
      ))}

      {/* 忙指示（桌面没有，但内核动作可能跑几十秒，需要可见反馈） */}
      {k.busy && (
        <div className="absolute right-3 top-3 px-3 py-1.5 text-[11px] rounded"
             style={{ background: 'var(--lf-panel2, #e3ebf5)', border: '1px solid var(--border)',
                      color: 'var(--primary)' }}>
          {k.busy} … 计算中
        </div>
      )}
    </div>
  );
}
