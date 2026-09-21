/**
 * panels/BuildPanel.tsx · 左栏「建模」页（桌面 app.py:811-1169）
 *
 * 分组与桌面逐条对应：
 *   ① 建模方式（参数化生成 / 测点导入）
 *   ② 测点数据（points）或 ② 填埋单元（param，可多块合成）
 *   ③ 当前单元参数 · 形状（矩形 / 多边形）
 *   ③ 当前单元参数 · 堆体（含 各边坡比 / 分层填埋 两个嵌套组）
 *   ④ 计算网格与插值（两种方式共用）
 *   ⑤ 堆体顶面模式（points）
 *   ⑥ 三维显示
 *   底部 ▶ 一键生成三维模型 / ▶ 执行三维建模（测点插值）
 */
import { useMemo, useState } from 'react';
import { useTool } from '../state/context';
import { useField, useFormValue } from '../state/context';
import { useActions } from '../state/actions';
import { Area, Btn, Chk, Dim, Grp, Num, Radios, ResultLine, Row, Sel, VSep } from '../ui/Primitives';
import { ColDef, Hint, RowsEditor, Tree } from '../ui/TreeTable';
import { GRID_OPTIONS, INTERP_OPTIONS, LAYER_GAMMA, type CellRow } from '../spec/defaults';
import { slopeAngle, slopeRatio } from '../spec/geom';
import PolygonCanvas from '../../../components/PolygonCanvas';
import { arcsFromSparse, shapeToText, type ToeShape } from '../../../components/ToeShape';

const EDGE_NAMES_RECT = ['底边(南)', '右边(东)', '顶边(北)', '左边(西)'];

export default function BuildPanel() {
  const { k, form } = useTool();
  const a = useActions();
  // ⚠ 所有 hook 必须在顶层无条件调用 —— 下面这些值都按分支渲染，但读取要在外面
  const mode = useFormValue<string>('build.mode');
  const shape = useFormValue<string>('build.shape');
  const topMode = useFormValue<string>('build.topMode');
  const slopeN = useFormValue<string | number>('build.slopeN');
  const edgeSlopes = useFormValue<Array<number | null>>('build.edgeSlopes');
  const polyText = useFormValue<string>('build.polyText') ?? '';
  const polyArcs = useFormValue<string>('build.polyArcs') ?? '';
  const cells = useFormValue<CellRow[]>('build.cells') ?? [];
  const basePts = useFormValue<string>('build.basePtsText') ?? '';
  const topPts = useFormValue<string>('build.topPtsText') ?? '';
  const [result, setResult] = useState<string | null>(null);
  /** 画布编辑对象：'poly' = 单块坡脚线；数字 = 第几个单元的坡脚线；null = 关 */
  const [canvasFor, setCanvasFor] = useState<null | 'poly' | number>(null);
  const [cellSel, setCellSel] = useState<number | null>(null);
  /** 重挂载 PolygonCanvas 以重置视野（「适应视图」） */
  const [fitToken, setFitToken] = useState(0);

  /** 画布用的顶点（从 polyText 解析；两侧双向同步 —— 桌面同款） */
  const polyPoints = useMemo(() => parsePolyText(polyText), [polyText]);
  /** 当前画布对象的几何与坡比（单块 or 某个单元） */
  const editRow: CellRow | undefined =
    typeof canvasFor === 'number' ? cells[canvasFor] : undefined;
  const canvasPoints = editRow ? parsePolyText(editRow.poly || '') : polyPoints;
  const canvasArcJson = editRow ? (editRow.arcs ?? '') : polyArcs;
  const canvasSlopes = editRow ? (editRow.slopes ?? []) : (edgeSlopes ?? []);
  const canvasN = editRow ? Number(editRow.n) || Number(slopeN) || 4
    : Number(slopeN) || 4;
  const canvasH = editRow ? Number(editRow.height) || Number(form.get('build.height')) || 20
    : Number(form.get('build.height')) || 20;
  /** 画布里的"构图参考"：其它已建单元的轮廓（桌面同款淡色虚线） */
  const ghosts = typeof canvasFor === 'number'
    ? cells.map((c, i) => (i === canvasFor ? null
      : { name: c.name || `单元${i + 1}`, poly: parsePolyText(c.poly || '') }))
      .filter(Boolean) as Array<{ name: string; poly: number[][] }>
    : [];

  /** 画布回写：顶点文本仍是唯一真源，弧另存一份稀疏表 */
  function onShape(s: ToeShape) {
    const { polyText: pt, arcsJson } = shapeToText(s);
    if (typeof canvasFor === 'number') {
      const next = cells.map((c, i) => (i === canvasFor
        ? { ...c, poly: pt, arcs: arcsJson, slopes: s.slopes } : c));
      form.set('build.cells', next);
    } else {
      form.set('build.polyText', pt);
      form.set('build.polyArcs', arcsJson);
      form.set('build.edgeSlopes', s.slopes);
    }
  }

  const isPoints = mode === 'points';
  const isCells = !isPoints && shape === 'cells';
  const isPoly = !isPoints && shape === 'poly';

  /** 边数：矩形 4 条，多边形按顶点数 */
  const edgeCount = isCells ? 0 : (isPoly ? countVerts(polyText) : 4);
  const edgeNames = isPoly
    ? Array.from({ length: edgeCount }, (_, i) => `边${i + 1}`)
    : EDGE_NAMES_RECT;

  async function onBuild() {
    const r = await a.doBuild();
    setResult(r?.summary ?? null);
  }

  return (
    <div>
      {/* ① 建模方式 */}
      <Grp title="① 建模方式">
        <Radios path="build.mode" tip="参数化生成＝按规则形状解析建模；测点导入＝CSV 实测地形插值"
                options={[['param', '参数化生成（输入规则形状）'],
                          ['points', '测点导入（CSV 实测地形）']]} />
      </Grp>

      {/* ② 测点数据（points） */}
      {isPoints && (
        <Grp title="② 测点数据">
          <p className="lf-dim mb-1" style={{ lineHeight: 1.5 }}>
            基底测点必填（≥3 点）；顶面测点留空则按 ⑤ 的标高生成。
            每行 <span className="lf-mono">x,y</span> 或 <span className="lf-mono">x,y,z</span>。
          </p>
          <Row label="基底测点" tip="实测基底高程点，CSV 每行 x,y,z">
            <Dim>{countVerts(basePts)} 点</Dim>
          </Row>
          <Area path="build.basePtsText" rows={4} tip="每行一个测点：x,y,z（也支持从工具栏/菜单导入 CSV）" />
          <Row label="顶面测点">
            <Dim>{countVerts(topPts)} 点（可留空）</Dim>
          </Row>
          <Area path="build.topPtsText" rows={3} tip="当前堆体顶面实测点；留空则按 ⑤ 的顶面模式生成" />
        </Grp>
      )}

      {/* ② 填埋单元（param） */}
      {!isPoints && (
        <Grp title="② 填埋单元（可多块合成）">
          {isCells ? (
            <>
              <RowsEditor path="build.cells"
                height={4}
                selected={cellSel}
                onRowSelect={(i) => setCellSel(i)}
                cols={[
                  { key: 'name', label: '名称', w: 82 },
                  { key: 'shape', label: '形状', w: 56, type: 'sel', options: ['rect', 'poly'] },
                  // 底形两列：提示语早就写着「在自己的行里改 L/W（矩形）或
                  // 顶点文本（多边形）」，但这两列一直没建 —— 于是多单元几何
                  // 只能靠示例/导入带进来，用户在这张表里改不了任何形状
                  { key: 'L', label: '长L', w: 52, type: 'num' },
                  { key: 'W', label: '宽W', w: 52, type: 'num' },
                  { key: 'cx', label: '中心x', w: 56, type: 'num' },
                  { key: 'cy', label: '中心y', w: 56, type: 'num' },
                  { key: 'poly', label: '顶点 x,y（每行一个）', w: 150 },
                  { key: 'z0', label: '底面标高', w: 62, type: 'num' },
                  { key: 'height', label: '堆高m', w: 58, type: 'num' },
                  { key: 'designH', label: '设计堆高', w: 62, type: 'num' },
                  { key: 'n', label: '坡比', w: 50, type: 'num' },
                ]}
                blank={() => ({ name: `单元${cellNameSeq(form.get('build.cells'))}`,
                                shape: 'rect', poly: '', L: 300, W: 200,
                                cx: 0, cy: 0, z0: 0,
                                height: 20, designH: '', n: 4 })}
                extraButtons={
                  <Btn kind="sub" disabled={cellSel === null}
                       tip="在坡脚线画布上编辑该单元的底形：拖动顶点、逐边设坡比、把边改成圆弧"
                       onClick={() => cellSel !== null && setCanvasFor(cellSel)}>
                    ▣ 画布编辑选中单元
                  </Btn>
                }
              />
              <Hint>
                底形改矩形单元的 L/W，或多边形行的顶点文本（「顶点」列填
                <span className="lf-mono"> x,y</span> 每行一个）。
                设计堆高留空＝用堆高 H；填了则该单元按设计堆高分列「剩余库容」。
                想回到单块建模，把 ① 的建模方式切回参数化后在 ③ 选形状。
              </Hint>
              <Btn kind="sub" onClick={() => form.set('build.shape', 'rect')}
                   tip="切回单块（矩形）建模">
                ↩ 切回单块建模
              </Btn>
            </>
          ) : (
            <Btn kind="sub" onClick={() => form.set('build.shape', 'cells')}
                 tip="进入多单元表：每个单元可独立设底形/标高/堆高/坡比">
              ＋ 改为多单元（单元表）
            </Btn>
          )}
        </Grp>
      )}

      {/* ③ 形状 + 堆体（param 单块） */}
      {!isPoints && !isCells && (
        <>
          <Grp title="③ 当前单元参数 · 形状">
            <Radios path="build.shape"
                    options={[['rect', '矩形'], ['poly', '多边形']]} />
            {shape === 'rect' ? (
              <>
                <Row label="长 L (m)"><Num path="build.rectL" /></Row>
                <Row label="宽 W (m)"><Num path="build.rectW" /></Row>
                <Row label="中心 x (m)"><Num path="build.rectCx" /></Row>
                <Row label="中心 y (m)"><Num path="build.rectCy" /></Row>
                <Hint>（中心坐标 = 0 即原居中，底面标高在下方 ③ 堆体里）</Hint>
              </>
            ) : (
              <>
                <p className="lf-dim mb-1" style={{ lineHeight: 1.5 }}>
                  顶点坐标 x, y（每行一个 · 画布取点在此显示 · 此处输入亦同步到画布）：
                </p>
                <Area path="build.polyText" rows={6} tip="多边形底面顶点，逆时针或顺时针均可" />
                <div className="flex flex-wrap gap-1 mt-1">
                  <Btn kind="sub" tip="打开大画布：左键加点 · 点顶点拖动 · 点边选坡比/设弧 · 双击闭合 · 右键撤销 · 滚轮缩放 · 中键平移"
                       onClick={() => setCanvasFor('poly')}>
                    打开画布编辑…
                  </Btn>
                  <Btn kind="sub" tip="按当前顶点把画布视野贴边（不改变几何）"
                       onClick={() => { setCanvasFor('poly'); setFitToken((n) => n + 1); }}>
                    适应视图
                  </Btn>
                  <Btn kind="sub" onClick={() => {
                    form.set('build.polyText', '');
                    form.set('build.polyArcs', '');
                    form.set('build.edgeSlopes', []);
                  }}>清空</Btn>
                  <Btn kind="sub" tip="把顶点数同步到「各边坡比」的行数"
                       onClick={() => form.set('build.edgeSlopes',
                         new Array(countVerts(polyText)).fill(null))}>
                    ⟳ 同步边数
                  </Btn>
                </div>
              </>
            )}
          </Grp>

          <Grp title="③ 当前单元参数 · 堆体">
            <Row label="底面标高 z0 (m)"><Num path="build.z0" /></Row>
            <Row label="堆高 H (m)"><Num path="build.height" /></Row>
            {/* 坡比 ↔ 坡角双向换算（桌面用 trace 双向同步） */}
            <SlopeRatioRow />

            {/* 各边坡比（逐边覆盖·可选） */}
            <NestedFrame title="各边坡比（逐边覆盖 · 可选）">
              <p className="lf-dim mb-1" style={{ lineHeight: 1.5 }}>
                留空＝该边用统一坡比 1:{slopeN}；填了则以逐边为准。
              </p>
              {edgeNames.length === 0 ? (
                <Dim>先在 ③ 形状里给出多边形顶点</Dim>
              ) : (
                <div className="grid grid-cols-2 gap-x-2">
                  {edgeNames.map((nm, i) => (
                    <div key={i} className="flex items-center gap-1 py-[2px]">
                      <span className="shrink-0" style={{ width: 62 }}>{nm} 1:</span>
                      <EdgeSlopeInput index={i} />
                      <Dim>{edgeDeg(edgeSlopes?.[i])}</Dim>
                    </div>
                  ))}
                </div>
              )}
              <Btn kind="sub" onClick={() => form.set('build.edgeSlopes', [])}
                   tip="清空全部逐边坡比，所有边回到统一坡度">全部设为统一坡度</Btn>
            </NestedFrame>

            {/* 分层填埋（可选） */}
            <NestedFrame title="分层填埋（可选）">
              <Hint>
                每层为水平切片 · 行号即层数（自下而上，行号大者在上）。合计层高会写入堆高 H。
              </Hint>
              <RowsEditor path="build.layers"
                height={4}
                cols={[
                  { key: 'name', label: '层名', w: 92, type: 'sel',
                    options: Object.keys(LAYER_GAMMA) },
                  { key: 'h', label: '层高m', w: 60, type: 'num' },
                  { key: 'gamma', label: '容重kN/m³', w: 74, type: 'num' },
                ]}
                blank={() => ({ name: '生活垃圾', h: 8, gamma: LAYER_GAMMA['生活垃圾'] })}
                extraButtons={
                  <Btn kind="sub" tip="把各层高之和写入堆高 H"
                       onClick={() => {
                         const rows = form.get('build.layers') as Array<{ h: number }> | undefined;
                         const sum = (rows || []).reduce((s, r) => s + (Number(r.h) || 0), 0);
                         if (sum > 0) form.set('build.height', sum);
                       }}>
                    Σ 合计写入堆高
                  </Btn>
                }
              />
            </NestedFrame>
          </Grp>
        </>
      )}

      {/* ④ 计算网格与插值 */}
      <Grp title="④ 计算网格与插值（两种方式共用）">
        <Row label="网格分辨率 Nx=Ny：" tip="网格越密越精细，计算与出图越慢">
          <Sel path="build.gridNx" width={92}
               options={GRID_OPTIONS.map((n) => [String(n), String(n)])} />
        </Row>
        <Row label="插值方法：" tip="仅测点路线生效">
          <Sel path="build.interpMethod" width={168} options={INTERP_OPTIONS} />
        </Row>
        {isPoints && (
          <>
            <Row label="IDW 幂次" tip="反距离加权的幂次，越大越局部">
              <Num path="build.idwPower" width={70} />
            </Row>
            <Row label="IDW 邻居数" tip="参与插值的最近点数">
              <Num path="build.idwK" width={70} />
            </Row>
          </>
        )}
      </Grp>

      {/* ⑤ 堆体顶面模式（points） */}
      {isPoints && (
        <Grp title="⑤ 堆体顶面模式">
          <Radios path="build.topMode"
                  options={[['surface', '顶面散点插值（实际堆体）'],
                            ['level', '水平设计标高']]} />
          {topMode === 'level' && (
            <Row label="设计/封场标高 (m)"><Num path="build.designLevel" /></Row>
          )}
        </Grp>
      )}

      {/* ⑥ 三维显示 */}
      <DisplayGroup />

      {/* 主操作 */}
      <div className="mt-3">
        <Btn kind="accent" width="100%" disabled={Boolean(k.busy)}
             onClick={() => void onBuild()}>
          {isPoints ? '▶  执行三维建模（测点插值）' : '▶  一键生成三维模型'}
        </Btn>
        <ResultLine text={result} />
        {(mode === 'points' || shape === 'points') && (
          <Hint>测点路线：基底测点必填 ≥3 点；顶面测点留空则按 ⑤ 的标高生成。</Hint>
        )}
        <div className="flex gap-1 mt-2">
          <Btn kind="sub" onClick={() => void a.doBuild('plain')}>▶ 加载示例·平原型</Btn>
          <Btn kind="sub" onClick={() => void a.doBuild('valley')}>▶ 加载示例·山谷型</Btn>
        </div>
      </div>

      {/* 坡脚线大画布（桌面 Toplevel「多边形底面绘制 — 大画布」840×640） */}
      {canvasFor !== null && (
        <div className="lf-modal fixed inset-0 z-[110] flex items-center justify-center p-4"
             style={{ background: 'rgba(22,39,58,.45)' }}>
          <div className="flex flex-col"
               style={{ width: 940, height: 'min(700px, 92vh)', background: 'var(--bg-surface)',
                        border: '1px solid var(--border)' }}>
            <div className="flex items-center px-3 py-2 shrink-0 gap-2"
                 style={{ background: 'var(--lf-panel2)', borderBottom: '1px solid var(--border)' }}>
              <span className="lf-group-title">
                坡脚线绘制 — 大画布
                {typeof canvasFor === 'number' && ` · 单元「${editRow?.name || `单元${canvasFor + 1}`}」`}
              </span>
              <Dim>画的是**坡脚线**；虚线是坡比吃进去之后剩下的平台（可填到设计标高）</Dim>
              <div className="flex-1" />
              <Btn kind="accent" onClick={() => setCanvasFor(null)}>完成</Btn>
            </div>
            <div className="flex-1 min-h-0">
              <PolygonCanvas
                points={canvasPoints}
                fitToken={fitToken}
                arcs={arcsFromSparse(
                  canvasArcJson ? safeJson(canvasArcJson) : [], canvasPoints.length)}
                edgeSlopes={canvasSlopes}
                slopeN={canvasN}
                pileH={canvasH}
                ghostCells={ghosts}
                onShape={onShape}
                onChange={() => undefined}
                onClose={() => setCanvasFor(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 小件

/** 嵌套分组框（桌面 LabelFrame 套 LabelFrame） */
function NestedFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-2 rounded"
              style={{ border: '1px solid var(--border)', padding: '6px 8px 8px' }}>
      <legend style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{title}</legend>
      {children}
    </fieldset>
  );
}

/** 坡比 ↔ 坡角双向换算的一行（桌面 1:n ↔ ° trace 同步） */
function SlopeRatioRow() {
  const [n, setN] = useField<string | number>('build.slopeN');
  const nv = Number(n);
  return (
    <>
      <Row label="坡度 1:n" tip="坡比 1:n（水平:垂直）">
        <Num path="build.slopeN" width={70} />
      </Row>
      <Row label="坡角 (°)" tip="与坡比自动换算">
        <input className="lf-input" style={{ width: 70 }} type="number" step="0.01"
               value={Number.isFinite(nv) && nv > 0 ? slopeAngle(nv).toFixed(2) : ''}
               onChange={(e) => {
                 const deg = Number(e.target.value);
                 if (Number.isFinite(deg) && deg > 0 && deg < 90) setN(slopeRatio(deg));
               }} />
        <Dim className="ml-1">坡角/坡比自动换算</Dim>
      </Row>
    </>
  );
}

function EdgeSlopeInput({ index }: { index: number }) {
  const [arr, setArr] = useField<Array<number | null>>('build.edgeSlopes');
  const list = Array.isArray(arr) ? [...arr] : [];
  while (list.length <= index) list.push(null);
  const cur = list[index];
  return (
    <input className="lf-input" style={{ width: 56 }} type="number" step="0.1"
           placeholder="统一"
           value={cur === null || cur === undefined ? '' : cur}
           onChange={(e) => {
             const t = e.target.value.trim();
             const next = [...list];
             next[index] = t === '' ? null : Number(t);
             setArr(next);
           }} />
  );
}

function edgeDeg(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) <= 0) return '';
  return `${slopeAngle(Number(v)).toFixed(1)}°`;
}

/** ⑥ 三维显示（桌面 app.py:1081-1149） */
function DisplayGroup() {
  const { form } = useTool();
  // 全部在顶层读（下面按分支渲染，但 hook 不能写在条件里）
  const floodOn = useFormValue<boolean>('display.floodOn');
  const zexag = useFormValue<number>('display.zexag');
  const clipOn = useFormValue<boolean>('display.clipOn');
  const clipFrac = useFormValue<number>('display.clipFrac');
  const showContour = useFormValue<boolean>('display.showContour');
  const floodH = useFormValue<string>('display.floodH');
  void floodOn;
  return (
    <Grp title="⑥ 三维显示">
      <div className="flex flex-wrap gap-x-3">
        <Chk path="display.showBase" label="显示基底" tip="OBJ 的 base 组（桌面同名勾选）" />
        <Chk path="display.showTop" label="显示顶面" tip="OBJ 的 top 组" />
        <Chk path="display.showContour" label="顶面等高线" tip="需要内核导出等高线叠加层" />
      </div>
      <div className="flex flex-wrap gap-x-3">
        <Chk path="display.showSlip" label="危险滑面 (X光)" tip="用当前稳定性参数算临界圆弧，在三维里画红色条带" />
        <Chk path="display.showDanger" label="危险坡面 Fs" tip="无限边坡 Fs 着色（红=危险）" />
        <Chk path="display.showExcFs" label="开挖 Fs" tip="分层材料 + 水位口径；与「危险坡面 Fs」同时勾选时以开挖为准" />
        <Chk path="display.showHeat" label="沉降热力层" tip="差异沉降覆盖层（红=沉降大），需先有沉降参数" />
      </div>
      <Row label="淹没/填埋面 标高">
        <Chk path="display.floodOn" />
        <Num path="display.floodH" width={64} />
        <Btn kind="sub" tip="开启淹没面并按当前标高重导三维视图（等价桌面「应用」）"
             onClick={() => form.set('display.floodOn', Boolean(floodH))}>应用</Btn>
      </Row>
      <Row label="垂直夸张" labelW={72}
           tip="默认 1× 保真实比例，可微调观察（纯前端缩放，不重算）">
        <input type="range" style={{ width: 120 }} min={0.5} max={6} step={0.1}
               value={Number.isFinite(zexag) ? zexag : 1}
               onChange={(e) => form.set('display.zexag', parseFloat(e.target.value))} />
        <Dim>{Number(zexag || 1).toFixed(1)}×</Dim>
      </Row>
      <div className="flex flex-wrap items-center gap-x-3 mt-1">
        <Chk path="display.wire" label="线框" tip="查看器附加（桌面靠 matplotlib 无法线框）" />
        <Chk path="display.clipOn" label="剖切" tip="沿 X 向剖切" />
        {clipOn && (
          <input type="range" style={{ width: 110 }} min={0} max={1} step={0.01}
                 value={Number.isFinite(clipFrac) ? clipFrac : 0.5}
                 onChange={(e) => form.set('display.clipFrac', parseFloat(e.target.value))} />
        )}
        {showContour && <Dim>等高线由内核导出，重导需数秒</Dim>}
      </div>
    </Grp>
  );
}

// ---------------------------------------------------------------- 工具

/** 表单里存的弧表 JSON 可能被手改坏，坏值按"没有弧"处理而不是白屏 */
function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return []; }
}

/** 「＋添加」时新单元的名字序号 = 现有行数 + 1。
 *  早先写的是 `rows?.length ?? 0 + 1`：`??` 优先级低于 `+`，于是等于 `?? 1`，
 *  空表加出来的第一个单元叫「单元0」。 */
function cellNameSeq(rows: unknown): number {
  return (Array.isArray(rows) ? rows.length : 0) + 1;
}

function parsePolyText(text: string): number[][] {
  return (text || '').split(/[\n;]+/)
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,，\s]+/).map(Number))
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
    .map((p) => [p[0], p[1]]);
}

function countVerts(text: string): number {
  return (text || '').split(/[\n;]+/)
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => {
      const p = l.split(/[,，\s]+/).map(Number);
      return p.length >= 2 && p.every(Number.isFinite);
    }).length;
}


export { Tree, Hint, VSep };
export type { ColDef };
