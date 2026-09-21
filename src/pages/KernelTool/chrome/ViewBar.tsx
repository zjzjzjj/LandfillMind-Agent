/**
 * chrome/ViewBar.tsx · 主视图切换条 + 子视图条（桌面 app.py:4007-4161）
 *
 * Row1  viewbar：9 个视图，当前项蓝底白字；右端两个折叠钮
 * Row2  toolsbar：俯视 / 侧视 / ↺ -30° / ↻ +30° + ⤓ 导出当前图（下拉）
 * Row3  标题行：左当前视图名，右灰字交互提示
 * Row4  子视图条：4 条互斥，带右端灰字说明与结果时刻下拉
 */
import { useEffect, useRef, useState } from 'react';
import { useTool, useUi, useUiValue } from '../state/context';
import { useFormValue, useField } from '../state/context';
import { useActions } from '../state/actions';
import { SUB_BARS, VIEWS, VIEW_TIPS, VIEW_LABEL } from '../spec/views';
import { Btn, Dim, FoldBtn, VSep } from '../ui/Primitives';
import type { MeshApi } from '../../../components/KernelMeshView';
import { SUB_DEFAULT } from '../spec/views';

export default function ViewBar({ meshApi, onFit }: {
  meshApi: React.MutableRefObject<MeshApi | null>;
  onFit?: () => void;
}) {
  const { k, ui, form } = useTool();
  const a = useActions();
  const [view, setView] = useUi<string>('view');
  const sub = useUiValue<Record<string, string>>('sub') || {};
  const leftHidden = useUiValue<boolean>('leftHidden');
  const bottomHidden = useUiValue<boolean>('bottomHidden');
  const kernelImage = useFormValue<boolean>('display.kernelImage');

  const bar = SUB_BARS[view as keyof typeof SUB_BARS];
  const curSub = sub[view] || SUB_DEFAULT[view as keyof typeof SUB_DEFAULT];
  const entry = k.pool[view];
  const timeOpts = entry?.timeOpts;
  const stageSel = useFormValue<string>('exc.stage');

  const setSub = (sk: string) => ui.set('sub', { ...sub, [view]: sk });

  return (
    <>
      {/* ---- Row1 主视图条 ---- */}
      <div className="lf-bar flex items-center gap-1 px-2 shrink-0 flex-wrap" style={{ paddingTop: 5, paddingBottom: 5 }}>
        {VIEWS.map((v) => (
          <button key={v.k} type="button" title={VIEW_TIPS[v.k]}
                  className={`lf-viewbtn ${view === v.k ? 'lf-viewbtn-on' : ''}`}
                  onClick={() => {
                    setView(v.k);
                    // 内核图是「3D 视图的另一种呈现」，切走就退出该模式，
                    // 免得切回来时还停在上一次的静态图上
                    if (v.k !== '3d') form.set('display.kernelImage', false);
                    void a.ensureRendered(v.k);
                  }}>
            {v.icon} {v.label}
          </button>
        ))}
        <div className="flex-1" />
        <FoldBtn label={bottomHidden ? '▣ 显示结果/日志' : '▣ 隐藏结果/日志'}
                 tip="折叠/展开右侧的结果表与运行日志"
                 onClick={() => ui.set('bottomHidden', !bottomHidden)} />
        <FoldBtn label={leftHidden ? '▶ 显示左栏' : '◀ 隐藏左栏'}
                 tip="折叠/展开左侧参数控制台"
                 onClick={() => ui.set('leftHidden', !leftHidden)} />
      </div>

      {/* ---- Row2 工具条（桌面 app.py:4037-4069） ---- */}
      <div className="lf-bar flex items-center gap-1.5 px-3 shrink-0" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <ViewTokens />
        <VSep />
        <Btn kind="sub" onClick={() => meshApi.current?.fit?.() || onFit?.()}
             tip="按当前模型的包围盒重新贴边取景（保持当前视角方向）—— 桌面靠窗口重绘自动贴边，Web 需要显式命令，故这是唯一的增项">
          ⊙ 适应视野
        </Btn>
        <div className="flex-1" />
        <ExportMenu onPick={(f) => void a.doFigureExport(f)} />
        <Btn kind="sub" onClick={() => void a.showKernelImage(!kernelImage)}
             tip="切到内核渲染的 matplotlib 三维图（需要严格对照桌面成图时用）">
          ◧ {kernelImage ? '交互图' : '内核图'}
        </Btn>
      </div>

      {/* ---- Row3 标题行 ---- */}
      <div className="flex items-center px-3 shrink-0"
           style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', paddingTop: 3, paddingBottom: 3 }}>
        <span className="lf-group-title">{VIEW_LABEL[view] || view}</span>
        <div className="flex-1" />
        <Dim>{view === '3d' ? '左键旋转 · 右键缩放 · 滚轮缩放' : '在左侧调整参数后，点对应页的计算按钮即可出图'}</Dim>
      </div>

      {/* ---- Row4 子视图条（互斥） ---- */}
      {bar && (
        <div className="lf-bar flex items-center gap-1 px-3 shrink-0 flex-wrap"
             style={{ paddingTop: 4, paddingBottom: 4 }}>
          {bar.buttons.map((b) => {
            const figs = Array.isArray(b.fig) ? b.fig : [b.fig];
            const has = figs.some((f) => entry?.figs?.some((x) => x.key === f));
            return (
              <button key={b.k} type="button"
                      className={`lf-subbtn ${curSub === b.k ? 'lf-subbtn-on' : ''}`}
                      disabled={!has}
                      title={has ? b.label : `${b.label}（先跑对应计算）`}
                      onClick={() => {
                        setSub(b.k);
                        if (b.k === 'exc_stage') void a.doPhased(stageSel);
                      }}>
                {b.label}
              </button>
            );
          })}
          <div className="flex-1" />
          {bar.timeAxis === 'stage' && (
            <StageSelect onPick={(v) => void a.doPhased(v)} />
          )}
          {bar.timeAxis === 'poll' && (
            <PollTimeSelect onPick={(gy, pd) => void a.doPollution(gy, pd)} opts={timeOpts} />
          )}
          {bar.hint && <Dim className="ml-2">{bar.hint}</Dim>}
        </div>
      )}
    </>
  );
}

/**
 * 俯视/侧视/↺/↻ 的视角 token（桌面 elev/azim 的 Web 对应物）。
 * 用自增 token 而不是直接存视角值 —— 同一方向连点两次也要生效。
 */
function ViewTokens() {
  const { ui } = useTool();
  const seq = useRef(0);
  const push = (kind: 'bird' | 'top' | 'front', dAzim?: number) => {
    seq.current += 1;
    ui.set('viewToken', { kind, token: seq.current, dAzim });
  };
  return (
    <>
      <Btn kind="sub" onClick={() => push('top')} tip="俯视（正上方投影）">俯视</Btn>
      <Btn kind="sub" onClick={() => push('front')} tip="侧视（正前方投影）">侧视</Btn>
      <Btn kind="sub" onClick={() => push('bird', -30)} tip="水平左旋 30°">↺ -30°</Btn>
      <Btn kind="sub" onClick={() => push('bird', 30)} tip="水平右旋 30°">↻ +30°</Btn>
    </>
  );
}

/** 「⤓ 导出当前图」下拉（桌面 app.py:4053-4064） */
function ExportMenu({ onPick }: { onPick: (f: 'png' | 'pdf' | 'svg' | 'csv') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const items: Array<[string, 'png' | 'pdf' | 'svg' | 'csv' | 'sep']> = [
    ['PNG 位图（300 dpi）', 'png'],
    ['PDF 矢量（字体嵌入）', 'pdf'],
    ['SVG 矢量（文字可编辑）', 'svg'],
    ['sep', 'sep'],
    ['底层数据 CSV…（当前图的数据表）', 'csv'],
  ];
  return (
    <div className="relative" ref={ref}>
      <Btn kind="sub" onClick={() => setOpen(!open)} tip="导出当前视图的出版件或底层数据">
        ⤓ 导出当前图
      </Btn>
      {open && (
        <div className="absolute right-0 top-full z-50 py-1 min-w-[220px]"
             style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      boxShadow: '0 4px 14px rgba(22,39,58,.16)' }}>
          {items.map(([label, f], i) => f === 'sep' ? (
            <div key={i} className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
          ) : (
            <button key={i} type="button"
                    className="block w-full text-left px-3 py-[5px] text-[12px]"
                    style={{ color: 'var(--text-primary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--lf-sel)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => { setOpen(false); onPick(f as 'png' | 'pdf' | 'svg' | 'csv'); }}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 开挖阶段下拉（桌面 cmb_exc_stage：值 = 阶段索引，None = 最不利阶段） */
function StageSelect({ onPick }: { onPick: (v: string) => void }) {
  const { k } = useTool();
  // 阶段只认 **form.exc.stage** 一处：早先这个下拉写 ui.excStage、「开挖」页 ⑦
  // 写 form.exc.stage，两处互看不见，下拉显示的阶段与真正算的阶段能不一致
  const [v, set] = useField<string>('exc.stage');
  const n = k.pool.excavation?.stageCount || 0;
  const opts: Array<[string, string]> = [['most', '最不利（阶段 k）']];
  for (let i = 0; i <= n; i++) {
    opts.push([String(i), i === 0 ? '阶段 0：开挖前' : `阶段 ${i}：已挖前 ${i} 个分区`]);
  }
  if (!n) return null;
  return (
    <select className="lf-input" style={{ width: 190 }}
            value={v || 'most'}
            onChange={(e) => { set(e.target.value); onPick(e.target.value); }}>
      {opts.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
    </select>
  );
}

/** 污染结果时刻下拉（桌面 cmb_poll_time：产气年份 / 羽流快照时刻） */
function PollTimeSelect({ onPick, opts }: {
  onPick: (gasYear?: number, plumeDay?: number) => void;
  opts?: {
    gas_years?: number[]; plume_days?: number[];
    gas_year_used?: number | null; plume_day_used?: number | null;
  } | null;
}) {
  const { ui } = useTool();
  const sub = useUiValue<Record<string, string>>('sub') || {};
  const pollTime = useUiValue<number | null>('pollTime');
  const cur = sub.pollution || 'gas_curve';
  const isPlume = cur === 'plume';
  const isGasField = cur === 'gas_field';
  if (!isPlume && !isGasField) return null;
  const list = isPlume ? (opts?.plume_days || []) : (opts?.gas_years || []);
  if (!list.length) return null;
  // 下拉必须反映**当前这张图画的是哪个时刻**：优先用户在页面上选的，
  // 否则用内核回带的实际取值（早先不受控，永远显示列表第一项）
  const used = isPlume ? opts?.plume_day_used : opts?.gas_year_used;
  const shown = pollTime ?? used ?? list[list.length - 1];
  return (
    <span className="flex items-center gap-1">
      <Dim>{isPlume ? '羽流时刻' : '产气强度年份'}</Dim>
      <select className="lf-input" style={{ width: 120 }}
              value={String(shown)}
              onChange={(e) => {
                const v = Number(e.target.value);
                ui.set('pollTime', v);
                if (isPlume) onPick(undefined, v); else onPick(v, undefined);
              }}>
        {list.map((x) => (
          <option key={x} value={x}>{isPlume ? `第 ${x} d` : `${x} 年`}</option>
        ))}
      </select>
    </span>
  );
}
