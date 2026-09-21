/**
 * PolygonCanvas.tsx · **坡脚线**编辑器（桌面 app.py:1538-2075「多边形底面绘制 — 大画布」）
 *
 * 语义要先说清楚：在这里画的那条线是**坡脚线**（堆体底面与地面的交线），
 * 不是库顶边线。内核按 h(p)=min(H, min_i d(p,边_i)/n_i) 从坡脚向内放坡
 * (parametric.py:80-105)，于是真正能填到设计标高的"平台"是坡脚线被坡比
 * **吃进去**之后剩下的那一块 —— 300×200 的矩形配 H=20、1:4 时平台只占 9.7%。
 * 光看坡脚线看不出这件事，所以画布必须把平台反演出来（app.py:1806-1853 桌面
 * 就是这么做的，Web 端早先整块丢了）。
 *
 * 与开挖分区画布（ExcZoneCanvas）的分工：那个是**在已建好的模型上切分区**
 * （切割线送内核算真几何），这个是**定义坡脚线本身**。
 *
 * 交互（桌面同款 + Web 必要增项）：
 *   左键空白 加点 · 双击闭合 · 右键撤销 · 滚轮以光标为锚缩放 · 中键平移
 *   点顶点   选中并可**拖动**（松手才回写）· 点边   选中并就地改坡比
 *   选中边后「⌒ 设弧」再点一点 → 该边变成圆弧（三点定圆，按弦差加密进内核）
 *   Del 删顶点 · I 在选中边上插顶点 · A 设弧 · L 改直 · Esc 取消选中
 * 与桌面的**一处有意差异**：桌面"闭合后点空白 = 开始画新多边形"（app.py:2031
 * 清空 param_pts），这在 Web 上太容易误触（一次点偏就把画了半天的底形清了），
 * 改成点空白 = 取消选中，要重画请明按「清空」。
 *
 * 真源约定：顶点文本 build.polyText 仍是几何的唯一真源，弧另存一份稀疏表
 * build.polyArcs —— 这样手填顶点、导入工程、画布编辑三条路都能互通。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Dim } from '../pages/KernelTool/ui/Primitives';
import {
  arcFromPoints, centroid, crestRings, deleteVertex, densify, distToSeg,
  insertVertex, polyArea, resizeEdgeArrays, sampleArc, volumeEstimate,
  type ArcEdge, type ToeShape,
} from './ToeShape';

interface Props {
  /** 坡脚线顶点（世界米制 [[x,y],...]） */
  points: number[][];
  onChange: (pts: number[][]) => void;
  onClose?: () => void;
  /** 逐边坡比（与 points 同基；null = 该边用统一坡比） */
  edgeSlopes?: Array<number | null>;
  onEdgeSlope?: (idx: number, n: number | null) => void;
  /** 逐边弧定义（arcs[i] = 边 i 上另给的一点，三点定圆） */
  arcs?: (ArcEdge | null)[];
  /** 统一坡比与堆高：平台反演与读数要用 */
  slopeN?: number;
  pileH?: number;
  /** 其它已建单元的轮廓（桌面画布里的淡色虚线"构图参考"） */
  ghostCells?: Array<{ name: string; poly: number[][] }>;
  /** 一次性回写整份坡脚定义（给了就走这条；否则回落 onChange/onEdgeSlope） */
  onShape?: (s: ToeShape) => void;
  /** +1 → 适应视图（只改视野，不动几何） */
  fitToken?: number;
  height?: number | string;
}

interface View { x: number; y: number; w: number; h: number }
type Drag = { kind: 'v' | 'arc'; i: number; x: number; y: number } | null;

/** 世界坐标 bbox → viewBox（外扩 12%；退化时给默认视野） */
function fitView(pts: number[][]): View {
  if (pts.length === 0) return { x: -200, y: -150, w: 400, h: 300 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = Math.max((x1 - x0) * 0.12, 20), my = Math.max((y1 - y0) * 0.12, 20);
  return { x: x0 - mx, y: y0 - my, w: (x1 - x0) + mx * 2, h: (y1 - y0) + my * 2 };
}

export default function PolygonCanvas({
  points, onChange, onClose, edgeSlopes, onEdgeSlope, arcs, slopeN = 4,
  pileH = 20, ghostCells, onShape, fitToken = 0, height = '100%',
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ sx: number; sy: number; view: View } | null>(null);
  /** 最近几次"点击加点"的现场：{n 加点前的顶点数, x/y 那个点在哪}。
   *
   * 双击闭合会先后触发**两个** click（各加一个重合点）再 dblclick，所以闭合时
   * 要把它们退掉。判据必须是**位置**而不是时间：按时间窗（<400ms）会把用户
   * 手快时真正的最后一个顶点一起吞掉 —— 实测"连点四下 + 双击闭合"只剩三个点。
   * 现在只退回与双击落点重合的那些加点，快慢都不影响结果。 */
  const adds = useRef<Array<{ t: number; n: number; x: number; y: number }>>([]);
  const [view, setView] = useState<View>(() => fitView(points));
  const [selV, setSelV] = useState<number | null>(null);
  const [selE, setSelE] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [arcArm, setArcArm] = useState<number | null>(null);
  const [snap, setSnap] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ wx: number; wy: number; sx: number; sy: number }>(
    { wx: 0, wy: 0, sx: 0, sy: 0 });
  /**
   * **是否已闭合**是绘制状态，不能由"顶点数 ≥3"推出来。
   *
   * 曾经想当然地写成 `closed = points.length >= 3`，于是画到第 3 个点那一刻
   * 就自认为闭合了，第 4 下点击走的是"已选中时点空白 = 取消选中"分支 ——
   * 用户连点四下只得到 3 个顶点（浏览器实跑才暴露，静态检查看不出来）。
   * 现在：够 3 个点叫 `valid`（几何上成面），要不要按闭合后的规矩交互看 `isClosed`。
   */
  const [isClosed, setIsClosed] = useState(() => points.length >= 3);
  const valid = points.length >= 3;
  const closed = valid && isClosed;

  // ---------------------------------------------------------------- 几何

  const base: ToeShape = useMemo(() => ({
    pts: points,
    arcs: resizeEdgeArrays(arcs || [], points.length),
    slopes: resizeEdgeArrays(edgeSlopes || [], points.length),
    n: slopeN, H: pileH,
  }), [points, arcs, edgeSlopes, slopeN, pileH]);

  /** 拖动中的**临时**形状：只影响显示与实时读数，松手才回写表单 */
  const shape: ToeShape = useMemo(() => {
    if (!drag) return base;
    const pts = base.pts.map((p) => p.slice());
    const as = base.arcs.slice();
    if (drag.kind === 'v') pts[drag.i] = [drag.x, drag.y];
    else as[drag.i] = { mx: drag.x, my: drag.y };
    return { ...base, pts, arcs: as };
  }, [base, drag]);

  /** 送内核口径的折线（弧按 5cm 弦差加密；坡比同步展开） */
  const geo = useMemo(() => densify(shape), [shape]);
  const toeArea = useMemo(() => polyArea(geo.poly), [geo.poly]);
  /** 平台（坡顶）反演：与内核 platform_ring 同算法。
   *  拖动中降到 120 目（弧边加密后母边数多，280 目一帧要几十毫秒会掉帧），
   *  松手再按 280 目算一次精确的 —— 读数抖动一下换来跟手。 */
  const crest = useMemo(
    () => (closed ? crestRings(geo.poly, geo.slopes, shape.H, drag ? 120 : 280) : []),
    [closed, geo, shape.H, drag]);
  const crestArea = useMemo(() => crest.reduce((s, r) => s + polyArea(r), 0), [crest]);
  /** 库容预览要栅格求积（几毫秒），不跟着 pointermove 跑 */
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => {
    if (!closed) { setVol(null); return; }
    const h = window.setTimeout(
      () => setVol(volumeEstimate(geo.poly, geo.slopes, shape.H)), 260);
    return () => window.clearTimeout(h);
  }, [closed, geo, shape.H]);

  /** 每条母边的中点、外法向、坡比与弧（坡比片与弧把手都用它） */
  const edges = useMemo(() => {
    const M = shape.pts.length;
    if (M < 2) return [];
    const c = centroid(shape.pts);
    const out: Array<{
      i: number; mid: number[]; nx: number; ny: number; n: number;
      arc: ReturnType<typeof arcFromPoints>; d: number[][];
    }> = [];
    for (let i = 0; i < M; i++) {
      // 未闭合时最后一段（末点→首点）还没画出来，不算边
      if (i === M - 1 && !closed) continue;
      const a = shape.pts[i], b = shape.pts[(i + 1) % M];
      const raw = shape.arcs[i];
      const arc = raw ? arcFromPoints(a, [raw.mx, raw.my], b) : null;
      // 渲染分段按圆心角给（≈7.5° 一段），大弧不至于画成多边形
      const seg = arc
        ? sampleArc(arc, Math.max(6, Math.ceil(arc.sweep / (Math.PI / 24))))
        : [a, b];
      const half = arc ? arc.sweep / 2 : 0;
      const mid = arc
        ? [arc.cx + arc.R * Math.cos(arc.a0 + (arc.ccw ? half : -half)),
           arc.cy + arc.R * Math.sin(arc.a0 + (arc.ccw ? half : -half))]
        : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const L = Math.hypot(nx, ny) || 1;
      nx /= L; ny /= L;
      if ((mid[0] - c[0]) * nx + (mid[1] - c[1]) * ny < 0) { nx = -nx; ny = -ny; }
      const v = Number(shape.slopes[i]);
      out.push({ i, mid, nx, ny, n: Number.isFinite(v) && v > 0 ? v : shape.n,
        arc, d: seg });
    }
    return out;
  }, [shape, closed]);

  // ---------------------------------------------------------------- 视图变换

  /** 屏幕像素 ↔ 世界：preserveAspectRatio=meet 会留白，必须按真实缩放与偏移算，
   *  否则容器长宽比一偏，点击就落到别处（拖顶点/吸附对此很敏感） */
  const metrics = useCallback(() => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / view.w, r.height / view.h) || 1;
    return { r, s, ox: (r.width - view.w * s) / 2, oy: (r.height - view.h * s) / 2 };
  }, [view]);

  const toWorld = useCallback((clientX: number, clientY: number): number[] => {
    const m = metrics();
    if (!m) return [0, 0];
    return [view.x + (clientX - m.r.left - m.ox) / m.s,
      view.y + view.h - (clientY - m.r.top - m.oy) / m.s];
  }, [metrics, view]);

  const pxToWorld = useCallback((px: number) => {
    const m = metrics();
    return m ? px / m.s : px;
  }, [metrics]);

  /** 吸附：默认吸到副刻度（主步长的 1/5），按住 Alt 临时自由取点 */
  const gridStep = useMemo(() => niceStep(view.w / 8), [view.w]);
  const snapTo = useCallback((v: number, step: number) => Math.round(v / step) * step, []);
  const applySnap = useCallback((wx: number, wy: number, alt: boolean) => {
    if (alt || !snap) return [wx, wy];
    const s = gridStep / 5;
    return [snapTo(wx, s), snapTo(wy, s)];
  }, [snap, gridStep, snapTo]);

  // ---------------------------------------------------------------- 命中

  const pickVertex = useCallback((wx: number, wy: number, tol: number) => {
    let best: number | null = null, bd = tol;
    shape.pts.forEach((p, i) => {
      const d = Math.hypot(p[0] - wx, p[1] - wy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }, [shape]);

  const pickArcMid = useCallback((wx: number, wy: number, tol: number) => {
    let best: number | null = null, bd = tol;
    for (const e of edges) {
      if (!e.arc) continue;
      const d = Math.hypot(e.mid[0] - wx, e.mid[1] - wy);
      if (d < bd) { bd = d; best = e.i; }
    }
    return best;
  }, [edges]);

  const pickEdge = useCallback((wx: number, wy: number, tol: number) => {
    let best: number | null = null, bd = tol;
    for (const e of edges) {
      if (e.arc) {
        const dr = Math.abs(Math.hypot(wx - e.arc.cx, wy - e.arc.cy) - e.arc.R);
        // 只在弧所张的那个角范围内计距，否则圆心另一侧的空白也会命中
        const ang = Math.atan2(wy - e.arc.cy, wx - e.arc.cx);
        const rel = e.arc.ccw ? wrap2(ang - e.arc.a0) : wrap2(e.arc.a0 - ang);
        if (rel <= e.arc.sweep + 1e-9 && dr < bd) { bd = dr; best = e.i; }
      } else {
        const a = shape.pts[e.i], b = shape.pts[(e.i + 1) % shape.pts.length];
        const d = distToSeg(wx, wy, a, b);
        if (d < bd) { bd = d; best = e.i; }
      }
    }
    return best;
  }, [edges, shape]);

  // ---------------------------------------------------------------- 写回

  const emit = useCallback((s: ToeShape) => {
    if (onShape) { onShape(s); return; }
    onChange(s.pts.map((p) => [p[0], p[1]]));
    const src = edgeSlopes || [];
    s.slopes.forEach((v, i) => {
      if ((src[i] ?? null) !== (v ?? null)) onEdgeSlope?.(i, v ?? null);
    });
  }, [onShape, onChange, onEdgeSlope, edgeSlopes]);

  const note = (t: string) => { setMsg(t); window.setTimeout(() => setMsg(null), 2600); };

  const addPoint = (wx: number, wy: number) => {
    const pts = [...shape.pts, [wx, wy]];
    adds.current.push({ t: Date.now(), n: shape.pts.length, x: wx, y: wy });
    if (wx < view.x || wx > view.x + view.w || wy < view.y || wy > view.y + view.h) {
      setView(fitView(pts));
    }
    emit({ ...shape, pts,
      arcs: resizeEdgeArrays(shape.arcs, pts.length),
      slopes: resizeEdgeArrays(shape.slopes, pts.length) });
    setSelE(null);
    setSelV(pts.length - 1);
  };

  const closePoly = (at?: number[]) => {
    if (shape.pts.length < 3) { note('至少需要 3 个顶点才能闭合'); return; }
    // 退回与"闭合这一击"重合的点（双击会先触发两个 click，各加一个重合顶点）
    let keep = shape.pts.length;
    if (at) {
      const tol = pxToWorld(12);
      // 一次双击最多补出 2 个点 —— 有了这个上限，"在最后一个顶点上双击收尾"
      // 这种常见动作就不会把用户真正要的那个顶点也吞掉
      let dropped = 0;
      while (adds.current.length && dropped < 2
        && Date.now() - adds.current[adds.current.length - 1].t < 700) {
        const a = adds.current[adds.current.length - 1];
        const dd = Math.hypot(a.x - at[0], a.y - at[1]);
        if (!(dd <= tol)) break;         // NaN（调用方传了非坐标）也走这里 → 不退
        keep = Math.max(3, a.n);
        adds.current.pop();
        dropped++;
      }
    } else {
      adds.current = [];
    }
    setIsClosed(true);
    setSelV(null); setSelE(null);
    if (keep < shape.pts.length) {
      emit({ ...shape, pts: shape.pts.slice(0, keep),
        arcs: shape.arcs.slice(0, keep), slopes: shape.slopes.slice(0, keep) });
      note(`已闭合 · 退回双击补的 ${shape.pts.length - keep} 个点 · ${keep} 边形`);
    } else {
      note(`已闭合 · ${shape.pts.length} 边形`);
    }
  };

  const undo = () => {
    if (!shape.pts.length) return;
    adds.current = [];
    const pts = shape.pts.slice(0, -1);
    setIsClosed((c) => c && pts.length >= 3);
    emit({ ...shape, pts, arcs: resizeEdgeArrays(shape.arcs, pts.length),
      slopes: resizeEdgeArrays(shape.slopes, pts.length) });
    setSelV(null); setSelE(null);
  };

  const clearAll = () => {
    adds.current = [];
    setIsClosed(false);
    emit({ ...shape, pts: [], arcs: [], slopes: [] });
    setSelV(null); setSelE(null); setArcArm(null); setView(fitView([]));
  };

  const setSlope = (i: number, v: number | null) => {
    const slopes = shape.slopes.slice();
    while (slopes.length < shape.pts.length) slopes.push(null);
    slopes[i] = v;
    emit({ ...shape, slopes });
  };

  const doInsert = () => {
    if (selE === null) { note('先选中一条边，再插顶点'); return; }
    const e = edges.find((x) => x.i === selE);
    const at = e ? (Math.hypot(cursor.wx - e.mid[0], cursor.wy - e.mid[1]) < pxToWorld(60)
      ? [cursor.wx, cursor.wy] : e.mid) : null;
    if (!at) return;
    emit(insertVertex(shape, selE, at[0], at[1]));
    note('已插入顶点');
  };

  const doDelete = () => {
    if (selV === null) { note('先选中一个顶点'); return; }
    if (shape.pts.length <= 3) { note('三角形不能再删（至少 3 个顶点成面）'); return; }
    emit(deleteVertex(shape, selV));
    setSelV(null); setSelE(null);
  };

  const armArc = () => {
    if (selE === null) { note('先选中一条边，再点第三点定弧'); return; }
    setArcArm(selE);
    note(`边 ${selE + 1}：在画布上点一下弧要鼓到的位置`);
  };

  const straighten = () => {
    if (selE === null) return;
    const arcs = shape.arcs.slice();
    arcs[selE] = null;
    emit({ ...shape, arcs });
    note(`边 ${selE + 1} 已改回直线`);
  };

  // ---------------------------------------------------------------- 指针事件

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button === 1) {
      ev.preventDefault();
      panRef.current = { sx: ev.clientX, sy: ev.clientY, view };
      (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
      return;
    }
    if (ev.button !== 0) return;
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const tol = pxToWorld(9);
    const am = pickArcMid(wx, wy, tol);
    if (am !== null) {
      setSelE(am); setSelV(null);
      setDrag({ kind: 'arc', i: am, x: wx, y: wy });
    } else {
      const vi = pickVertex(wx, wy, tol);
      if (vi === null) return;                    // 空白交给 onClick 处理
      setSelV(vi); setSelE(null);
      setDrag({ kind: 'v', i: vi, x: wx, y: wy });
    }
    // 抓住指针：拖到画布外也不丢事件（松手才回写，中途不刺激表单）
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (panRef.current) {
      const m = metrics();
      const p = panRef.current;
      if (m) {
        setView({ ...p.view,
          x: p.view.x - (ev.clientX - p.sx) / m.s,
          y: p.view.y + (ev.clientY - p.sy) / m.s });
      }
      return;
    }
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const [sx, sy] = applySnap(wx, wy, ev.altKey);
    setCursor({ wx, wy, sx, sy });
    if (drag) setDrag({ ...drag, x: sx, y: sy });
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId);
    if (ev.button === 1) { panRef.current = null; return; }
    if (!drag) return;                            // 只是点了一下空白，没抓住任何东西
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const [sx, sy] = applySnap(wx, wy, ev.altKey);
    const pts = shape.pts.map((p) => p.slice());
    const arcs = shape.arcs.slice();
    if (drag.kind === 'v') {
      if (!pts[drag.i]) { setDrag(null); return; }
      pts[drag.i] = [sx, sy];
    } else {
      arcs[drag.i] = { mx: sx, my: sy };
    }
    emit({ ...shape, pts, arcs });
    setDrag(null);
  };

  const onClick = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const [px, py] = applySnap(wx, wy, ev.altKey);
    if (arcArm !== null) {                       // 弧取点：一次点击即完成
      const arcs = shape.arcs.slice();
      arcs[arcArm] = { mx: px, my: py };
      emit({ ...shape, arcs });
      setArcArm(null);
      note(`边 ${arcArm + 1} 已设为圆弧`);
      return;
    }
    const tol = pxToWorld(9);
    if (pickVertex(wx, wy, tol) !== null) return;         // pointerdown 已处理
    const ei = pickEdge(wx, wy, tol);
    if (ei !== null) { setSelE(ei); setSelV(null); return; }
    if (!closed) { addPoint(px, py); return; }   // 立即加点，不再等 220ms
    if (selV !== null || selE !== null) { setSelV(null); setSelE(null); return; }
    note('要重画整条坡脚线请按「清空」（点空白不再误清）');
  };

  // 滚轮以光标为锚缩放（React 的 onWheel 在部分浏览器是 passive，需原生监听）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = metrics();
      if (!m) return;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ax = view.x + (e.clientX - m.r.left - m.ox) / m.s;
      const ay = view.y + view.h - (e.clientY - m.r.top - m.oy) / m.s;
      const w2 = Math.max(view.w / f, 1e-3), h2 = Math.max(view.h / f, 1e-3);
      const fx = (e.clientX - m.r.left - m.ox) / (m.s * w2);
      const fy = 1 - (e.clientY - m.r.top - m.oy) / (m.s * h2);
      setView({ x: ax - fx * w2, y: ay - fy * h2, w: w2, h: h2 });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [metrics, view]);

  useEffect(() => { if (fitToken) setView(fitView(points)); }, [fitToken]); // eslint-disable-line

  // 键盘：Del 删顶点 / I 插顶点 / A 设弧 / L 改直 / Esc 取消
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;   // 别劫持正在打字的那个框
      if (e.key === 'Escape') { setSelV(null); setSelE(null); setArcArm(null); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); doDelete(); }
      else if (e.key === 'i' || e.key === 'I') doInsert();
      else if (e.key === 'a' || e.key === 'A') armArc();
      else if (e.key === 'l' || e.key === 'L') straighten();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------------------------------------------------------------- 绘制

  const sw = view.w / 500;
  const r = pxToWorld(4);
  const ticks = useMemo(() => buildTicks(view, gridStep), [view, gridStep]);
  const outline = geo.poly.map((p) => `${p[0]},${-p[1]}`).join(' ');
  const selE_ = selE !== null ? edges.find((e) => e.i === selE) : null;
  const curN = selE !== null ? (selE_?.n ?? shape.n) : shape.n;
  const curIsUniform = selE !== null && !(shape.slopes[selE] ?? null);
  const pct = toeArea > 0 ? (100 * crestArea / toeArea) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶栏 */}
      <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 flex-wrap"
           style={{ background: 'var(--lf-panel2)', borderBottom: '1px solid var(--border)' }}>
        <Btn kind="sub" onClick={undo} disabled={!points.length}>撤销</Btn>
        <Btn kind="sub" onClick={clearAll} disabled={!points.length}>清空</Btn>
        <Btn kind="sub" onClick={() => closePoly()}
             disabled={points.length < 3 || closed}>闭合多边形</Btn>
        <Btn kind="sub" onClick={() => setView(fitView(points))}>适应视图</Btn>
        <span className="mx-1" style={{ borderLeft: '1px solid var(--border)', height: 18 }} />
        <Btn kind="sub" onClick={doInsert} disabled={selE === null} tip="在选中边上插一个顶点（快捷键 I）">
          ＋ 插顶点
        </Btn>
        <Btn kind="sub" onClick={doDelete} disabled={selV === null} tip="删掉选中的顶点（Del）">
          ✕ 删顶点
        </Btn>
        <Btn kind="sub" onClick={armArc} disabled={selE === null}
             tip={arcArm !== null ? '再点一下画布上弧要鼓到的位置' : '把选中边改成圆弧：A 后再点第三点（按 5cm 弦差加密进内核）'}>
        ⌒ 设弧边
        </Btn>
        <Btn kind="sub" onClick={straighten} disabled={selE === null || !selE_?.arc} tip="改回直线（L）">
          ⌐ 改直
        </Btn>
        <label className="flex items-center gap-1 text-[11px] ml-1 cursor-pointer"
               title="默认吸附到副刻度；按住 Alt 可临时自由取点">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          吸附 {gridStep / 5} m
        </label>
        <div className="flex-1" />
        <Btn kind="sub" onClick={onClose} disabled={!onClose}>关闭</Btn>
        <Dim>{closed ? `已闭合 · ${points.length} 顶点` : `绘制中 · ${points.length} 顶点`}</Dim>
      </div>

      {/* 提示 / 读数行 */}
      <div className="px-3 py-1 shrink-0 text-[11px] flex flex-wrap items-center gap-x-3"
           style={{ color: 'var(--text-muted)' }}>
        {arcArm !== null
          ? <span style={{ color: 'var(--accent)' }}>▸ 弧边取点中：点第 {arcArm + 1} 条边要鼓到的位置</span>
          : <span>{closed ? '点顶点可拖动 · 点边可选坡度/设弧 · 双击闭合 · 右键撤销'
            : '左键加点 · 双击闭合 · 右键撤销 · 滚轮缩放 · 中键平移'}</span>}
        <span className="lf-mono">X={cursor.wx.toFixed(1)} Y={cursor.wy.toFixed(1)}</span>
        {snap && <span className="lf-mono" style={{ color: 'var(--primary)' }}>
          吸附 → {cursor.sx.toFixed(1)}, {cursor.sy.toFixed(1)}</span>}
        {msg && <span style={{ color: 'var(--accent)' }}>{msg}</span>}
      </div>

      {/* 画布 */}
      <div className="flex-1 min-h-0 px-2 pb-2 relative">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${-(view.y + view.h)} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: '100%', height, display: 'block',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            cursor: arcArm !== null ? 'copy' : 'crosshair', touchAction: 'none',
          }}
          onContextMenu={(e) => { e.preventDefault(); undo(); }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onClick}
          onDoubleClick={(e) => {
            const [wx, wy] = toWorld(e.clientX, e.clientY);
            const [sx, sy] = applySnap(wx, wy, e.altKey);
            closePoly([sx, sy]);
          }}
        >
          {/*
            所有装饰与几何图形都装进这一个 <g> 并关掉 pointer-events：
            命中一律靠坐标计算（pickVertex / pickEdge / pickArcMid），
            不靠 DOM 命中。不这么做的话，跟随光标的吸附十字准星会正好盖在
            点击位置上，把坡比片的点击整个吃掉（自动化实跑里表现为"点不动"）。
          */}
          <g style={{ pointerEvents: 'none' }}>
          {/* 网格 + 刻度 + X=0/Y=0 轴线（桌面的 CAD 坐标感） */}
          {ticks.v.map((t, i) => (
            <line key={`gv${i}`} x1={t} y1={-(view.y + view.h)} x2={t} y2={-view.y}
                  stroke="var(--border)" strokeWidth={sw * (t === 0 ? 1.2 : 0.35)} />
          ))}
          {ticks.h.map((t, i) => (
            <line key={`gh${i}`} x1={view.x} y1={-t} x2={view.x + view.w} y2={-t}
                  stroke="var(--border)" strokeWidth={sw * (t === 0 ? 1.2 : 0.35)} />
          ))}
          {ticks.v.map((t, i) => (
            <text key={`tv${i}`} x={t} y={-view.y + view.h * 0.028} fontSize={view.w / 70}
                  fill="var(--text-muted)" textAnchor="middle" className="lf-mono"
                  style={{ userSelect: 'none' }}>{fmtTick(t)}</text>
          ))}
          {ticks.h.map((t, i) => (
            <text key={`th${i}`} x={view.x + view.w * 0.006} y={-t - view.h * 0.012}
                  fontSize={view.w / 70} fill="var(--text-muted)" className="lf-mono"
                  style={{ userSelect: 'none' }}>{fmtTick(t)}</text>
          ))}

          {/* 其它已建单元：淡色虚线轮廓 + 名称（桌面同款"构图参考"） */}
          {(ghostCells || []).map((g, i) => g.poly.length >= 2 && (
            <g key={`gc${i}`} opacity={0.55}>
              <polygon points={g.poly.map((p) => `${p[0]},${-p[1]}`).join(' ')}
                       fill="none" stroke="var(--border)" strokeWidth={sw * 1.1}
                       strokeDasharray={`${sw * 4} ${sw * 4}`} />
              <text x={centroid(g.poly)[0]} y={-centroid(g.poly)[1]} fontSize={view.w / 78}
                    fill="var(--text-muted)" textAnchor="middle"
                    style={{ userSelect: 'none' }}>{g.name}</text>
            </g>
          ))}

          {/* 平台（坡顶）反演：虚线轮廓 + 填色，坡面环带就是它和坡脚之间那圈 */}
          {crest.map((ring, i) => (
            <polygon key={`cr${i}`} points={ring.map((p) => `${p[0]},${-p[1]}`).join(' ')}
                     fill="var(--lf-crest-fill)" fillOpacity={0.75}
                     stroke="var(--primary)" strokeWidth={sw * 1.1}
                     strokeDasharray={`${sw * 6} ${sw * 3}`} />
          ))}

          {/* 坡脚线本体（加密后的折线 = 内核真正拿到的几何） */}
          {geo.poly.length >= 2 && (closed
            ? <polygon points={outline} fill="var(--lf-foot-fill)" fillOpacity={0.55}
                       stroke="var(--accent)" strokeWidth={sw * 1.3} />
            : <polyline points={outline} fill="none" stroke="var(--accent)"
                        strokeWidth={sw * 1.3} />)}

          {/* 选中边加粗 */}
          {selE_ && (
            <polyline points={selE_.d.map((p) => `${p[0]},${-p[1]}`).join(' ')}
                      fill="none" stroke="var(--primary)" strokeWidth={sw * 2.8}
                      strokeLinecap="round" />
          )}

          {/* 顶点：可拖；顶点少时附坐标（桌面同款，多了不喧宾夺主） */}
          {shape.pts.map((p, i) => (
            <g key={`v${i}`}>
              <circle cx={p[0]} cy={-p[1]} r={i === selV ? r * 1.6 : r}
                      fill={i === selV ? 'var(--primary)' : 'var(--bg-surface)'}
                      stroke="var(--primary)" strokeWidth={sw} />
              {shape.pts.length <= 12 && (
                <text x={p[0] + r * 1.8} y={-p[1] - r} fontSize={view.w / 82}
                      fill="var(--text-muted)" className="lf-mono"
                      style={{ userSelect: 'none' }}>
                  {`(${p[0].toFixed(0)},${p[1].toFixed(0)})`}
                </text>
              )}
            </g>
          ))}

          {/* 弧中点把手（空心方块，可拖）。画在坡比片之前：两者偶尔重叠时，
              让坡比片（在更后面）拿到点击，把手仍可由 pointerdown 的坐标命中
              抓到 —— 命中判定本来就不走 DOM。 */}
          {edges.filter((e) => e.arc).map((e) => (
            <rect key={`am${e.i}`} x={e.mid[0] - r} y={-e.mid[1] - r}
                  width={r * 2} height={r * 2} fill="var(--bg-surface)"
                  stroke="var(--accent)" strokeWidth={sw * 1.2}
                  style={{ cursor: 'grab' }} />
          ))}

          {/* 吸附十字准星 */}
          {snap && (
            <g opacity={0.5} stroke="var(--primary)" strokeWidth={sw * 0.5}>
              <line x1={cursor.sx - r * 1.5} y1={-cursor.sy} x2={cursor.sx + r * 1.5} y2={-cursor.sy} />
              <line x1={cursor.sx} y1={-cursor.sy - r * 1.5} x2={cursor.sx} y2={-cursor.sy + r * 1.5} />
            </g>
          )}

          {/*
            各边坡比片：中点沿背离质心的法向外偏 —— 桌面 app.py:1736-1758 同款。
            这是**唯一**吃 DOM 点击的元素：既要从 pointer-events:none 的装饰组里
            挪出来单独开权限，又必须**留在最后**（画在最上层），否则顶点/弧把手
            会盖住它，那条边就点不动了。
          */}
          {closed && edges.map((e) => {
            const [cx, cy] = chipClamp(view, e.mid[0] + e.nx * pxToWorld(15),
                                        e.mid[1] + e.ny * pxToWorld(15));
            return (
              <text key={`chip${e.i}`} x={cx} y={-cy}
                    fontSize={view.w / 78}
                    fill={e.i === selE ? 'var(--primary)'
                      : (shape.slopes[e.i] ?? null) ? 'var(--accent)' : 'var(--text-muted)'}
                    fontWeight={e.i === selE ? 700 : (shape.slopes[e.i] ?? null) ? 600 : 400}
                    textAnchor="middle" className="lf-mono"
                    style={{ userSelect: 'none', cursor: 'pointer', pointerEvents: 'all' }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (arcArm === null) { setSelE(e.i); setSelV(null); }
                    }}>
                {`1:${round2(e.n)}${(shape.slopes[e.i] ?? null) ? '' : '*'}`}
              </text>
            );
          })}
          </g>
        </svg>

        {/* 左下角图例与面积读数（桌面 app.py:1835-1853） */}
        <div className="absolute left-4 bottom-5 text-[11px] leading-[1.6] pointer-events-none"
             style={{ color: 'var(--text-muted)', textShadow: '0 0 4px var(--bg-surface)' }}>
          <div className="flex items-center gap-1.5">
            <span style={{ display: 'inline-block', width: 22, height: 0,
                           borderTop: `2px solid var(--accent)` }} />
            <span>坡脚 {fmtArea(toeArea)}（画布所画）</span>
          </div>
          {closed && (crest.length
            ? (
              <div className="flex items-center gap-1.5">
                <span style={{ display: 'inline-block', width: 22, height: 0,
                               borderTop: '2px dashed var(--primary)' }} />
                <span>平台 {fmtArea(crestArea)}（{pct.toFixed(0)}%，填到 {round2(shape.H)} m）</span>
              </div>
            ) : (
              <div style={{ color: 'var(--lf-err)', fontWeight: 600 }}>
                无平台：堆高过大或坡比过缓
              </div>
            ))}
          {closed && vol !== null && (
            <div>库容 ≈ {(vol / 1e4).toFixed(1)} 万m³<span style={{ opacity: .75 }}>
              （画布口径，与内核 platform_ring / waste_volume 同式，对拍见
              tools/toe-vs-kernel.py）</span></div>
          )}
        </div>
      </div>

      {/* 就地编辑条：选中顶点 → 坐标；选中边 → 坡比 / 弧参数 */}
      {(selV !== null || selE !== null) && (
        <div className="px-3 py-2 shrink-0 flex items-center gap-2 flex-wrap"
             style={{ background: 'var(--lf-panel2)', borderTop: '1px solid var(--border)' }}>
          {selV !== null && (
            <>
              <span className="lf-group-title">顶点 {selV + 1}</span>
              <span>X</span>
              <Num2 value={shape.pts[selV]?.[0]} onSet={(v) => {
                const pts = shape.pts.map((p) => p.slice());
                pts[selV] = [v, pts[selV][1]];
                emit({ ...shape, pts });
              }} />
              <span>Y</span>
              <Num2 value={shape.pts[selV]?.[1]} onSet={(v) => {
                const pts = shape.pts.map((p) => p.slice());
                pts[selV] = [pts[selV][0], v];
                emit({ ...shape, pts });
              }} />
              <Btn kind="sub" onClick={doDelete}>✕ 删此顶点</Btn>
            </>
          )}
          {selE !== null && selE_ && (
            <>
              <span className="lf-group-title">边 {selE + 1}</span>
              <span className="lf-mono" style={{ color: 'var(--text-muted)' }}>
                ({selE_.mid[0].toFixed(1)}, {selE_.mid[1].toFixed(1)})
              </span>
              <span>坡角 1:</span>
              {/* ⚠ 不要 autoFocus：选中边会渲染这个框，一旦自动聚焦，
                  之后所有快捷键都被"别在输入框里劫持按键"的守卫挡掉
                  （Del/I/A/L 全部失灵，直到用户另点一处）。要改坡比点一下即可。 */}
              <input className="lf-input" style={{ width: 72 }} type="number" step="0.1"
                     defaultValue={curIsUniform ? '' : round2(curN)} placeholder="统一"
                     onKeyDown={(e) => {
                       if (e.key !== 'Enter') return;
                       const t = (e.target as HTMLInputElement).value.trim();
                       setSlope(selE, t === '' ? null : Number(t));
                       (e.target as HTMLInputElement).blur();
                     }} />
              {selE_.arc && (
                <Dim>R={selE_.arc.R.toFixed(1)} m · 圆心角 {(selE_.arc.sweep * 180 / Math.PI).toFixed(0)}°
                  · 矢高 {(selE_.arc.R * (1 - Math.cos(selE_.arc.sweep / 2))).toFixed(1)} m
                </Dim>
              )}
              <div className="flex-1" />
              <Btn kind="sub" onClick={armArc} tip="重设鼓出点（A）">⌒ 重设弧</Btn>
              <Btn kind="sub" onClick={straighten} disabled={!selE_.arc}>⌐ 改直</Btn>
              <Btn kind="sub" onClick={() => { setSlope(selE, null); }}
                   tip="清掉该边覆盖，回到统一坡比">清除坡比</Btn>
              <Btn kind="sub" onClick={() => setSelE(null)}>取消选中</Btn>
            </>
          )}
          <Dim className="w-full">回车生效 · 留空 = 该边用统一坡比 1:{round2(shape.n)}
            {' · '}带 * 的坡比片表示该边仍是统一坡比</Dim>
        </div>
      )}
    </div>
  );
}

function Num2({ value, onSet }: { value?: number; onSet: (v: number) => void }) {
  const [t, setT] = useState(value === undefined ? '' : String(round2(value)));
  useEffect(() => { setT(value === undefined ? '' : String(round2(value))); }, [value]);
  return (
    <input className="lf-input" style={{ width: 78 }} type="number" step="0.1" value={t}
           onChange={(e) => setT(e.target.value)}
           onKeyDown={(e) => {
             if (e.key !== 'Enter') return;
             const n = Number(t);
             if (Number.isFinite(n)) onSet(n);
           }}
           onBlur={() => { const n = Number(t); if (Number.isFinite(n)) onSet(n); }} />
  );
}

// ---------------------------------------------------------------- 工具

/**
 * 坡比片位置夹进视野内 —— 桌面 `_param_edge_entry_show` 也是把就地输入框
 * `min(max(mx + nx*26, 72), w-72)` 夹在画布里（app.py:1914-1915）。
 * 不夹的话，贴边/凹形的边会把标签推到可视区外：看着像"标签丢了"，
 * 而且点击会落到弹层底板上被吃掉（实跑中表现为那条边点不动）。
 */
function chipClamp(view: View, wx: number, wy: number): number[] {
  const mx = view.w * 0.03, my = view.h * 0.045;
  return [
    Math.min(Math.max(wx, view.x + mx), view.x + view.w - mx),
    Math.min(Math.max(wy, view.y + my), view.y + view.h - my),
  ];
}

function wrap2(a: number): number {
  const t = Math.PI * 2;
  return ((a % t) + t) % t;
}
function round2(v: number): number {
  return Math.round(Number(v) * 100) / 100;
}
function fmtArea(a: number): string {
  return `${a.toFixed(0)} m²`;
}
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}
function buildTicks(v: View, step: number): { v: number[]; h: number[] } {
  const vs: number[] = [], hs: number[] = [];
  const nv = Math.min(Math.ceil(v.w / step) + 1, 60);
  const nh = Math.min(Math.ceil(v.h / step) + 1, 60);
  const x0 = Math.ceil(v.x / step) * step;
  const y0 = Math.ceil(v.y / step) * step;
  for (let i = 0; i < nv; i++) vs.push(x0 + i * step);
  for (let i = 0; i < nh; i++) hs.push(y0 + i * step);
  return { v: vs, h: hs };
}
function fmtTick(t: number): string {
  return Math.abs(t) >= 1000 || (Math.abs(t) > 0 && Math.abs(t) < 1)
    ? t.toFixed(0) : String(+t.toFixed(2));
}
