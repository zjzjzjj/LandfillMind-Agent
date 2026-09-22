/**
 * panels/ExcavationPanel.tsx · 左栏「开挖」页（桌面 app.py:2999-3194）
 *
 * ① 开挖分区（画布 + 分区表）  ② 分级开挖坡  ③ 材料分层
 * ④ 地下水位   ⑤ 计算参数      ⑥ 操作        ⑦ 分区开挖（逐阶段）
 *
 * 分区顶点由**内核算**（前端只给切割线），与桌面一致 —— 桌面也是把 cuts
 * 发给 excavation_zones 后拿回 zones 填表。
 */
import { useState } from 'react';
import { useTool, useFormValue } from '../state/context';
import { useActions } from '../state/actions';
import { Area, Btn, ChkBox, Dim, Grp, Num, ResultLine, Row, Sel, Txt } from '../ui/Primitives';
import { Hint, RowsEditor } from '../ui/TreeTable';
import ExcZoneCanvas from '../../../components/ExcZoneCanvas';
import { SCAN_DIRS, type ZoneRow } from '../spec/defaults';

export default function ExcavationPanel() {
  const { k, form, ui } = useTool();
  const a = useActions();
  const [r6, setR6] = useState<string | null>(null);
  const [r7, setR7] = useState<string | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const levelsText = useFormValue<string>('exc.levelsText');
  const zones = useFormValue<unknown[]>('exc.zones');
  const tempN = useFormValue<string>('exc.tempN');
  const stage = useFormValue<string>('exc.stage');
  const cuts = useFormValue<number[][][]>('exc.cuts');
  const canvasMode = (ui.useValue<string>('excMode') || 'cut') as 'cut' | 'slope';
  const outline = ui.useValue<number[][] | null>('excOutline') || null;

  const zoneRows = (zones as Array<{ name?: string; poly?: string }> | undefined) || [];
  const zoneName = (i: number) => zoneRows[i]?.name || `分区${i + 1}`;

  const geom = describeLevels(levelsText || '');

  return (
    <div>
      {/* ① 开挖分区 */}
      <Grp title="① 开挖分区（在底图上画切割线）">
        <Hint>分区顶点由内核按切割线计算；「一键切四区」= 过形心正交两刀。</Hint>
        <Btn kind="accent" width="100%" onClick={() => setCanvasOpen(true)}>
          ▣ 打开发开挖分区画布
        </Btn>
        <div className="flex flex-wrap gap-1 mt-1.5">
          <Btn kind="sub" onClick={() => void a.refreshZones({ four: true })}
               tip="过形心正交两刀，自动切成 4 个分区">⤾ 一键切四区</Btn>
          <Btn kind="sub" onClick={() => {
            const cuts = (form.get('exc.cuts') as number[][][] | undefined) || [];
            if (!cuts.length) { k.log('还没有切割线可撤销', 'warn'); return; }
            form.set('exc.cuts', cuts.slice(0, -1));
            void a.refreshZones();
          }} tip="删掉最后一刀重发（内核每次都从整块轮廓重切，无需真正撤销）">↶ 撤销上一刀</Btn>
          <Btn kind="sub" onClick={() => { form.set('exc.cuts', []); void a.refreshZones(); }}>
            清空切割线
          </Btn>
        </div>
        <Row label="临时边坡坡比 1:" labelW={126} tip="分区界面处放坡（未开挖一侧的临时坡）">
          <Num path="exc.tempN" width={64} />
          <Dim className="ml-1">(分区界面处放坡)</Dim>
        </Row>
        <RowsEditor path="exc.zones"
          height={4}
          cols={[
            { key: 'order', label: '序', w: 34, type: 'num' },
            { key: 'name', label: '分区', w: 74 },
            { key: 'poly', label: '顶点', w: 44, readonly: true },
            { key: 'topZ', label: '顶标高', w: 60, type: 'num' },
            { key: 'tempN', label: '临时坡', w: 56, type: 'num' },
            { key: 'levels', label: '分级', w: 76 },
            { key: 'cutToBase', label: '挖到基底', w: 52, type: 'chk',
              },
          ]}
          blank={() => ({ order: ((zones?.length as number) || 0) + 1, name: '新分区',
                          poly: '', topZ: null, tempN: Number(tempN) || 2,
                          levels: levelsText, cutToBase: false })} />
        <Hint>当前 {zones?.length || 0} 个分区。改完分区表后点「▶ 应用开挖」才会写进模型。
          勾「挖到基底」的分区: 坡面仍按分级剖面成型, 坑底直接削到基底标高。</Hint>
      </Grp>

      {/* ② 分级开挖坡 */}
      <Grp title="② 分级开挖坡 (每行 坡高, 坡比, 马道宽)">
        <Hint>每行一级，自下而上；例：6, 2.0, 3 表示坡高 6m、坡比 1:2、马道宽 3m。</Hint>
        <Area path="exc.levelsText" rows={4} tip="逗号分隔的「坡高, 坡比, 马道宽」，一行一级" />
        <ResultLine text={geom} />
      </Grp>

      {/* ③ 材料分层 */}
      <Grp title="③ 材料分层 (以高程为界, 自下而上自动排序)">
        <RowsEditor path="exc.layers"
          height={4}
          cols={[
            { key: 'name', label: '层名', w: 92 },
            { key: 'zTop', label: '层顶m', w: 58, type: 'num' },
            { key: 'zBot', label: '层底m', w: 58, type: 'num' },
            { key: 'gamma', label: 'γ', w: 50, type: 'num' },
            { key: 'c', label: "c'", w: 46, type: 'num' },
            { key: 'phi', label: "φ'", w: 44, type: 'num' },
          ]}
          blank={() => ({ name: '新土层', zTop: 0, zBot: -10, gamma: 18, c: 10, phi: 20 })} />
        <Hint>顺序需覆盖「开挖坡底 ~ 坡顶」全区间；开挖稳定性用这里的 c/φ，与稳定性页无关。</Hint>
      </Grp>

      {/* ④ 地下水位 */}
      <Grp title="④ 地下水位">
        <Row label="水位高程 (m)" labelW={126}><Num path="exc.waterLevel" placeholder="留空=无水压" /></Row>
        <Hint>留空 = 无水压（按总应力）。</Hint>
      </Grp>

      {/* ⑤ 计算参数 */}
      <Grp title="⑤ 计算参数">
        <Row label="水重度 γw (kN/m³)" labelW={126}><Num path="exc.gWater" /></Row>
        <Row label="Fs 阈值" labelW={126}><Num path="exc.thr" /></Row>
        <Row label="滑面下界深度 (m)" labelW={126}>
          <Num path="exc.depth" placeholder="留空=最大开挖深度" />
        </Row>
        <Row label="Bishop n_grid" labelW={126}><Num path="exc.nGrid" /></Row>
        <Row label="Bishop n_R" labelW={126}><Num path="exc.nR" /></Row>
        <label className="flex items-center gap-1 cursor-pointer py-[3px]">
          <ChkBox path="exc.scanOn" />
          <span>同时做断面扫描 (定位最危险断面, 较慢)</span>
        </label>
        <Row label="扫描剖面方向" labelW={126}>
          <Sel path="exc.scanDir" width={168} options={SCAN_DIRS} />
        </Row>
        <Row label="扫描剖面数" labelW={126}><Num path="exc.scanN" /></Row>
        <label className="flex items-center gap-1 cursor-pointer py-[3px]">
          <ChkBox path="exc.scanCoarse" />
          <span>粗扫 + 关键断面细扫 (更快)</span>
        </label>
      </Grp>

      {/* ⑥ 操作 */}
      <Grp title="⑥ 操作">
        <div className="flex flex-col gap-1">
          <Btn kind="accent" tip="把分区表里的开挖写进模型（多分区走整体设计面口径）"
               onClick={async () => setR6((await a.doBuild())?.summary ?? null)}>
            ▶ 应用开挖 (生成开挖后模型)
          </Btn>
          <Btn kind="sub" tip="清掉分区表后重建模型（按当前表单还原开挖前形态）"
               onClick={async () => setR6((await a.doUndoExc())?.summary ?? null)}>
            ↩ 取消开挖 (还原开挖前模型)
          </Btn>
          <Btn kind="accent" onClick={async () =>
            setR6((await a.doExcCalc())?.summary ?? null)}>
            ▶ 算开挖稳定性
          </Btn>
        </div>
        <ResultLine text={r6} />
      </Grp>

      {/* ⑦ 分区开挖（逐阶段） */}
      <Grp title="⑦ 分区开挖 (逐阶段验算)">
        <Hint>
          注：阶段 0 = 开挖前，阶段 k = 已挖完按序前 k 个分区；各阶段用同一条剖面，
          Fs 才可比。
        </Hint>
        <Row label="查看阶段" labelW={126}>
          {/* 阶段 0..K 共 stageCount 项（含"开挖前"）—— 旧版枚举 0..stageCount
              会多出一档越界项；工件齐时切换只换 3D+剖面图，不重跑内核 */}
          <select className="lf-input" style={{ width: 190 }}
                  value={stage || 'most'}
                  onChange={(e) => {
                    form.set('exc.stage', e.target.value);
                    void a.onStagePick(e.target.value);
                  }}>
            <option value="most">最不利（阶段 k）</option>
            {Array.from({ length: (k.pool.excavation?.stageCount || 0) },
              (_, i) => (
                <option key={i} value={String(i)}>
                  {i === 0 ? '阶段 0：开挖前' : `阶段 ${i}：已挖前 ${i} 个分区`}
                </option>))}
          </select>
        </Row>
        <Btn kind="accent" width="100%" onClick={async () => {
          const r = await a.doPhased(stage);
          setR7(r?.summary ?? null);
          ui.set('view', 'excavation');
        }}>
          ▶ 逐阶段开挖分析
        </Btn>
        <ResultLine text={r7} />
      </Grp>

      {/* 分区画布（桌面是 Toplevel 弹窗，Web 用弹层） */}
      {canvasOpen && (
        <div className="lf-modal fixed inset-0 z-[100] flex items-center justify-center"
             style={{ background: 'rgba(22,39,58,.45)' }}>
          <div className="flex flex-col"
               style={{ width: 900, height: 680, background: 'var(--bg-surface)',
                        border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 px-3 py-2 shrink-0"
                 style={{ background: 'var(--lf-panel2)', borderBottom: '1px solid var(--border)' }}>
              <span className="lf-group-title">开挖分区绘制 — 在已建好模型上划分分区</span>
              <Btn kind="sub" onClick={() => ui.set('excMode', canvasMode === 'cut' ? 'slope' : 'cut')}
                   tip="桌面画布的模式切换钮">
                {canvasMode === 'cut' ? '✂ 切割中' : '⌣ 设坡比中'}
              </Btn>
              <Btn kind="sub" onClick={() => void a.refreshZones({ four: true })}>⤾ 一键切四区</Btn>
              <Btn kind="sub" onClick={() => {
                if (!(cuts || []).length) { k.log('还没有切割线可撤销', 'warn'); return; }
                form.set('exc.cuts', (cuts || []).slice(0, -1));
                void a.refreshZones();
              }}>↶ 撤销上一刀</Btn>
              <Btn kind="sub" onClick={() => { form.set('exc.cuts', []); void a.refreshZones(); }}>
                清空切割线
              </Btn>
              <div className="flex-1" />
              <Btn kind="sub" onClick={async () => {
                const r = await a.doBuild();
                if (r) setCanvasOpen(false);
              }}>应用开挖</Btn>
              <Btn kind="sub" onClick={() => setCanvasOpen(false)}>关闭</Btn>
            </div>
            <div className="flex-1 min-h-0">
              <ExcZoneCanvas
                outline={outline}
                zones={zoneRows.map((z, i) => ({
                  name: z.name || `分区${i + 1}`,
                  poly: parsePolyText(z.poly || ''),
                }))}
                cuts={cuts || []}
                mode={canvasMode}
                onAddCut={(line) => {
                  form.set('exc.cuts', [...(cuts || []), line]);
                  void a.refreshZones();
                }}
                onEdgeClick={(zi, ei) => {
                  const raw = prompt(`分区「${zoneName(zi)}」第 ${ei + 1} 条边的临时坡比 1:n`
                    + '（留空 = 用该区「临时坡」）', '2');
                  if (raw === null) return;            // 取消不改任何东西
                  const zs = (form.get('exc.zones') as ZoneRow[] | undefined) || [];
                  const poly = parsePolyText(zs[zi]?.poly || '');
                  if (!poly.length) {
                    k.log(`分区「${zoneName(zi)}」没有顶点，无法逐边设坡比`, 'warn');
                    return;
                  }
                  const t = raw.trim();
                  const n = t === '' ? null : Number(t);
                  if (n !== null && (!Number.isFinite(n) || n <= 0)) {
                    k.log(`坡比「${t}」不是正数，未改动`, 'err');
                    return;
                  }
                  // 写进 slopes[ei]（早先写的是 edgeN —— 那个字段从没进过
                  // spec，于是「随下次应用开挖生效」是句空话）
                  const list = [...(zs[zi]?.slopes || [])];
                  while (list.length < poly.length) list.push(null);
                  list[ei] = n;
                  form.set('exc.zones', zs.map((z, i) => (i === zi ? { ...z, slopes: list } : z)));
                  k.log(`已为分区「${zoneName(zi)}」第 ${ei + 1} 条边设坡比`
                    + (n === null ? `（回到临时坡 1:${zs[zi]?.tempN ?? 2}）` : ` 1:${n}`)
                    + '（随下次「应用开挖」生效）', 'ok');
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 分区表里的顶点文本（每行 x,y）→ 多边形 */
function parsePolyText(text: string): number[][] {
  return (text || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,，\s]+/).map(Number))
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
    .map((p) => [p[0], p[1]]);
}

/** 分级开挖坡的几何回显（桌面 lbl_exc_geom 的等价物） */
function describeLevels(text: string): string | null {
  const rows = text.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,，\s]+/).map(Number))
    .filter((r) => r.length >= 2 && r.every(Number.isFinite));
  if (!rows.length) return null;
  const depth = rows.reduce((s, r) => s + r[0], 0);
  // 水平宽 = Σ(坡高×坡比 + 马道宽)
  const width = rows.reduce((s, r) => s + r[0] * r[1] + (r[2] ?? 0), 0);
  return `共 ${rows.length} 级 · 总深 ${depth.toFixed(1)} m · 坡顶线到坑底外缘水平宽 ${width.toFixed(1)} m`;
}

export { Txt };
