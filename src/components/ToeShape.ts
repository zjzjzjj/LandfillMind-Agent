/**
 * ToeShape.ts · 坡脚线（底面边界）的几何内核 —— 纯函数，零依赖，可在浏览器/Node 两侧跑
 *
 * 为什么单独一个文件：画布要做的不只是"画个多边形"，它得实时回答
 *   「这条坡脚线 + 各边坡比 + 这个堆高 → 坡顶/平台在哪、占地多少、能填多少」
 * 这三问，而这三问的口径**必须与 Python 内核逐字相同**，否则画布上看着对、
 * 建模完就不是了。内核侧的同一套口径是：
 *   parametric._polygon_height_field  h(p) = min(H, min_i d(p,seg_i)/n_i)
 *   parametric.platform_ring          平台 = {p : g(p) ≥ H}
 *   parametric.poly_area              shoelace
 *
 * 数据模型（承重决策）：内核只认**扁平折线** polygon(M,2) + slopes(M,)，
 * 因为它用 matplotlib.Path 判内外、用点到**线段**距离算高度场，两者都不认弧。
 * 所以圆弧是**编辑期概念**：这里保留弧的定义（弓高式：边 + 边上第三点），
 * 送内核前按弦差 tol 加密成折线，slopes 同步展开（加密后每条子弦继承母边的坡比）。
 * 加密由**内核做唯一一次**（toe_arcs.densify_arcs）；本文件的 densify 只为画布
 * 自己的渲染与预览服务 —— 两边同为纯函数、同参数，结果一致（浮点末位除外）。
 */

/** 弧边定义：边 i→i+1 上另给一点 (mx,my)，三点定圆弧（弓高式） */
export interface ArcEdge { mx: number; my: number }

/** 一段圆弧的解析表示 */
export interface Circle {
  cx: number; cy: number; R: number;
  a0: number; a1: number;      // 起末角（弧度，atan2 系）
  ccw: boolean;                // 从 a0 到 a1 的走向（经过中点那一侧）
  sweep: number;               // 圆心角 [0, 2π]
}

/** 一条坡脚线的完整定义 */
export interface ToeShape {
  pts: number[][];
  /** arcs[i] = 边 i（顶点 i→i+1）的弧定义；null/缺省 = 直线边 */
  arcs: (ArcEdge | null)[];
  /** slopes[i] = 边 i 的坡比 1:n；null = 用统一坡比 n */
  slopes: (number | null)[];
  /** 统一坡比 */
  n: number;
  /** 堆高 H (m) */
  H: number;
}

const TAU = Math.PI * 2;

/** 绕圈归一化到 [0, 2π) */
function wrap(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

/** 有向面积（CCW 为正） */
export function signedArea(poly: number[][]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** 多边形面积（shoelace，取绝对值）—— 与内核 parametric.poly_area 同式 */
export function polyArea(poly: number[][]): number {
  return Math.abs(signedArea(poly));
}

export function centroid(poly: number[][]): number[] {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  const n = poly.length || 1;
  return [x / n, y / n];
}

/**
 * 三点定圆弧：p1 → 中点 m → p2。
 *
 * 退化情形一律返回 null（调用方按直线边处理）：
 *  - 三点共线 / 两点重合（弦长为零）
 *  - 半径不物理（NaN / 无穷）
 * 走向判定：分别取 a0→am 与 am→a1 的**逆时针**角距，若两者之和等于 a0→a1 的
 * 逆时针角距，则中点落在逆时针那一侧。
 */
export function arcFromPoints(p1: number[], m: number[], p2: number[]): Circle | null {
  const [x1, y1] = p1, [xm, ym] = m, [x2, y2] = p2;
  const d = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;   // 共线
  const ux = ((x1 * x1 + y1 * y1) * (ym - y2) + (xm * xm + ym * ym) * (y2 - y1)
    + (x2 * x2 + y2 * y2) * (y1 - ym)) / d;
  const uy = ((x1 * x1 + y1 * y1) * (x2 - xm) + (xm * xm + ym * ym) * (x1 - x2)
    + (x2 * x2 + y2 * y2) * (xm - x1)) / d;
  const R = Math.hypot(x1 - ux, y1 - uy);
  if (!Number.isFinite(R) || R <= 1e-9) return null;
  const a0 = Math.atan2(y1 - uy, x1 - ux);
  const am = Math.atan2(ym - uy, xm - ux);
  const a1 = Math.atan2(y2 - uy, x2 - ux);
  const ccw = Math.abs(wrap(am - a0) + wrap(a1 - am) - wrap(a1 - a0)) < 1e-7;
  const sweep = ccw ? wrap(a1 - a0) : wrap(a0 - a1);
  return { cx: ux, cy: uy, R, a0, a1, ccw, sweep: sweep <= 1e-12 ? TAU : sweep };
}

/** 取弧上一串点（含起末），按屏幕需要细分 —— 画布渲染用它（不依赖 SVG 弧标志的左右手系） */
export function sampleArc(c: Circle, segments: number): number[][] {
  const n = Math.max(1, Math.round(segments));
  const out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const t = c.ccw ? c.a0 + (c.sweep * i) / n : c.a0 - (c.sweep * i) / n;
    out.push([c.cx + c.R * Math.cos(t), c.cy + c.R * Math.sin(t)]);
  }
  // 末点用真终点，避免浮点漂移到不了 p2
  out[out.length - 1] = [c.cx + c.R * Math.cos(c.a1), c.cy + c.R * Math.sin(c.a1)];
  return out;
}

/** 弧的"矢高"（弓高）：中点到弦的垂距，用于给用户回显半径/圆心角 */
export function arcBulge(c: Circle): number {
  return c.R * (1 - Math.cos(c.sweep / 2));
}

/**
 * 加密：把带弧的坡脚线展开成内核认的 (poly, slopes)。
 *
 * 每条弧边按**弦差 ≤ tol** 细分：圆心角上限 Δθ = 2·acos(1 − tol/R)
 * （弦的矢高 R(1−cos(Δθ/2)) ≤ tol 即为满足）。tol ≥ 2R 时矢高约束对半圆
 * 也成立，取 Δθ = π；再统一被 maxStepDeg 兜住，避免极小半径时炸出上万顶点。
 *
 * 返回的 slopes 与 poly **一一对应**（poly[j] 处的边 = 顶点 j→j+1）—— 内核
 * parametric._polygon_height_field 与 excavation.normalize_zone 都硬要求
 * 「个数 == 顶点数」，所以母边的坡比必须**按子弦数重复 k 次**。
 */
export function densify(shape: ToeShape, tol = 0.05, maxStepDeg = 15): {
  poly: number[][]; slopes: number[]; edgeOf: number[];
} {
  const M = shape.pts.length;
  const poly: number[][] = [];
  const slopes: number[] = [];
  const edgeOf: number[] = [];
  if (M < 2) return { poly: shape.pts.map((p) => p.slice()), slopes: [], edgeOf: [] };
  const maxStep = (maxStepDeg * Math.PI) / 180;
  const nOf = (i: number) => {
    const v = Number(shape.slopes?.[i]);
    return Number.isFinite(v) && v > 0 ? v : shape.n;
  };
  /** 往结果里追加一段（同时登记该子弦的坡比与母边序号） */
  const push = (p: number[], ei: number, ni: number) => {
    poly.push(p); slopes.push(ni); edgeOf.push(ei);
  };
  for (let i = 0; i < M; i++) {
    const a = shape.pts[i], b = shape.pts[(i + 1) % M];
    const ni = nOf(i);
    const arc = shape.arcs?.[i] ? arcFromPoints(a, [shape.arcs[i]!.mx, shape.arcs[i]!.my], b) : null;
    if (!arc) { push(a, i, ni); continue; }
    const ratio = tol / arc.R;
    const dMax = Math.min(ratio >= 2 ? Math.PI : 2 * Math.acos(1 - ratio), maxStep);
    const k = Math.max(1, Math.min(4000, Math.ceil(arc.sweep / dMax)));
    const seg = sampleArc(arc, k);
    for (let j = 0; j < k; j++) push(seg[j], i, ni);
    // 母边终点即下一条边的起点 —— 这里**不**追加，交给下一轮循环的 push(a)
  }
  return { poly, slopes, edgeOf };
}

/**
 * 预测坡顶（平台）轮廓 —— 画布上"坡脚线画完了，平台还剩多大"的答案。
 *
 * 内核的高度场是 h(p) = min(H, min_j d(p,seg_j)/n_j)，于是平台边界就是
 * g(p) = min_j d(p,seg_j)/n_j 的 **g = H 等值线**。
 *
 * ⚠ 这里**必须**按"到线段的最短距离"在场上一格一格求，不能用"每条边所在直线
 * 向内推 H·n 再做半平面裁剪"那种解析做法 —— 后者在**凹**多边形上错得离谱：
 * 反凹顶点之外，点到线段的距离是到**端点**的距离（比到支撑线大得多），
 * 于是解析法把平台多削掉一大块。实测凹口 L 形：解析 6600 m²、内核
 * platform_ring 26690 m²（占地 45000 m²）—— 差 4 倍，不是"差一点点"。
 * 这条等值线还可能是**多环**（凹形把平台切成几块），解析裁剪给不出来。
 *
 * 所以本函数是 parametric.platform_ring 的同一算法（栅格 + Marching Squares）
 * 的 TS 实现：同一个 g(p) 式子、同一条"多边形外置 -1 使等值线在内部闭合"的
 * 规则。逐位一致性由 tools/toe-vs-kernel.py 对拍把关。
 *
 * 空结果 = 无平台（堆太高或坡太缓，坡比把整个场地吃光了）。
 */
export function crestRings(poly: number[][], slopes: number[], H: number,
                           res = 280): number[][][] {
  const M = poly.length;
  if (M < 3 || !(H > 0)) return [];
  const n = new Array<number>(M);
  for (let i = 0; i < M; i++) {
    const v = Number(slopes[i]);
    n[i] = Number.isFinite(v) && v > 0 ? v : NaN;
  }
  if (n.some((v) => !Number.isFinite(v))) return [];
  const xs0 = Math.min(...poly.map((p) => p[0])), xs1 = Math.max(...poly.map((p) => p[0]));
  const ys0 = Math.min(...poly.map((p) => p[1])), ys1 = Math.max(...poly.map((p) => p[1]));
  if (!(xs1 > xs0) || !(ys1 > ys0)) return [];
  const R = Math.max(40, Math.min(600, res | 0));
  const dx = (xs1 - xs0) / (R - 1), dy = (ys1 - ys0) / (R - 1);
  // g[jy][jx]：与 np.meshgrid(xs, ys) 同序（z 形状 (len(ys), len(xs))）
  const g: Float64Array[] = [];
  for (let jy = 0; jy < R; jy++) {
    const py = ys0 + jy * dy;
    const row = new Float64Array(R);
    for (let jx = 0; jx < R; jx++) {
      const px = xs0 + jx * dx;
      if (!pointInPoly(px, py, poly)) { row[jx] = -1; continue; }   // 场外置负 → 等值线内部闭合
      let h = Infinity;
      for (let i = 0; i < M; i++) {
        const d = distToSeg(px, py, poly[i], poly[(i + 1) % M]) / n[i];
        if (d < h) h = d;
      }
      row[jx] = h;
    }
    g.push(row);
  }
  return marchingSquares(g, H, (jx, jy) => [xs0 + jx * dx, ys0 + jy * dy]);
}

/**
 * Marching Squares：在规则网格 z[jy][jx] 上取 level 等值线，拼成闭合环。
 *
 * 交点一律从**边的小端点**做线性插值算出，于是相邻两格对同一个交点得到逐位
 * 相同的坐标 —— 这是能把碎线段缝成环的前提。鞍点（case 5/10）用格心均值判
 * 连通方向（标准的渐近判定法），与 contourpy 的处理同类。
 */
export function marchingSquares(
  z: Float64Array[], level: number, at: (jx: number, jy: number) => number[],
): number[][][] {
  const ny = z.length, nx = z[0]?.length || 0;
  if (nx < 2 || ny < 2) return [];
  /** 边上的交点：kind 'H' 水平边（jx,jy)→(jx+1,jy)，'V' 竖直边 (jx,jy)→(jx,jy+1) */
  const hit = (kind: 'H' | 'V', jx: number, jy: number): number[] => {
    let ax: number, ay: number, bx: number, by: number, za: number, zb: number;
    if (kind === 'H') {
      const a = at(jx, jy), b = at(jx + 1, jy);
      [ax, ay] = a; [bx, by] = b; za = z[jy][jx]; zb = z[jy][jx + 1];
    } else {
      const a = at(jx, jy), b = at(jx, jy + 1);
      [ax, ay] = a; [bx, by] = b; za = z[jy][jx]; zb = z[jy + 1][jx];
    }
    const t = (level - za) / (zb - za || 1e-12);
    return [ax + t * (bx - ax), ay + t * (by - ay)];
  };
  const key = (kind: 'H' | 'V', jx: number, jy: number) => `${kind}${jx},${jy}`;
  const segs: Array<[string, string]> = [];
  const add = (a: ['H' | 'V', number, number], b: ['H' | 'V', number, number]) =>
    segs.push([key(a[0], a[1], a[2]), key(b[0], b[1], b[2])]);
  for (let jy = 0; jy < ny - 1; jy++) {
    for (let jx = 0; jx < nx - 1; jx++) {
      const b0 = z[jy][jx] >= level;        // 左下
      const b1 = z[jy][jx + 1] >= level;    // 右下
      const b2 = z[jy + 1][jx + 1] >= level;// 右上
      const b3 = z[jy + 1][jx] >= level;    // 左上
      const ci = (b0 ? 1 : 0) | (b1 ? 2 : 0) | (b2 ? 4 : 0) | (b3 ? 8 : 0);
      if (ci === 0 || ci === 15) continue;
      // 四条边上的交点（下/右/上/左）
      const E: ['H' | 'V', number, number][] = [
        ['H', jx, jy], ['V', jx + 1, jy], ['H', jx, jy + 1], ['V', jx, jy],
      ];
      const has = [b0 !== b1, b1 !== b2, b2 !== b3, b3 !== b0];
      const pts = [0, 1, 2, 3].filter((i) => has[i]);
      if (ci === 5 || ci === 10) {
        // 鞍点：两对交点，靠格心值决定怎么连
        const c = (z[jy][jx] + z[jy][jx + 1] + z[jy + 1][jx] + z[jy + 1][jx + 1]) / 4;
        const up = c >= level;
        if (ci === 5) { if (up) { add(E[0], E[3]); add(E[1], E[2]); } else { add(E[0], E[1]); add(E[2], E[3]); } }
        else { if (up) { add(E[0], E[1]); add(E[2], E[3]); } else { add(E[0], E[3]); add(E[1], E[2]); } }
        continue;
      }
      if (pts.length === 2) add(E[pts[0]], E[pts[1]]);
      else if (pts.length > 2) {
        // 退化（角点恰在 level 上）：按顺序两两配对，够稳就行
        for (let k = 0; k + 1 < pts.length; k += 2) add(E[pts[k]], E[pts[k + 1]]);
      }
    }
  }
  // 缝合成环：每个交点只属于一条网格边，故按边键取一次坐标、两边共用
  const coord = new Map<string, number[]>();
  const adj = new Map<string, string[]>();
  const atEdge = (k: string): number[] => {
    let c = coord.get(k);
    if (!c) {
      const [jx, jy] = k.slice(1).split(',').map(Number);
      c = hit(k[0] === 'H' ? 'H' : 'V', jx, jy);
      coord.set(k, c);
    }
    return c;
  };
  for (const [a, b] of segs) {
    atEdge(a); atEdge(b);
    const la = adj.get(a); if (la) la.push(b); else adj.set(a, [b]);
    const lb = adj.get(b); if (lb) lb.push(a); else adj.set(b, [a]);
  }
  const usedEdge = new Set<string>();
  const seenNode = new Set<string>();
  const rings: number[][][] = [];
  for (const start of adj.keys()) {
    if (seenNode.has(start)) continue;
    const ring: number[][] = [];
    let cur = start, prev = '', guard = 0;
    while (guard++ < 200000) {
      seenNode.add(cur);
      ring.push(atEdge(cur));
      const nb = (adj.get(cur) || [])
        .find((x) => x !== prev && !usedEdge.has(edgeKey(cur, x)));
      if (!nb) break;                       // 死端（退化情形）或已回到起点
      usedEdge.add(edgeKey(cur, nb));
      prev = cur; cur = nb;
      if (cur === start) break;             // 闭合：起点不重复入环
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
function edgeKey(a: string, b: string): string {
  return a < b ? a + '|' + b : b + '|' + a;
}

/**
 * 库容预览：直接按内核同一个闭式解做栅格求积
 *   V ≈ Σ min(H, min_j d(p,seg_j)/n_j) · ΔA   （多边形外取 0）
 * 与 parametric._polygon_height_field 逐式对应，只是网格比计算的 81~121 粗。
 * 所以它是"≈"，不是内核那个数 —— 界面上要标出来。
 */
export function volumeEstimate(poly: number[][], slopes: number[], H: number,
                               grid = 200): number {
  if (poly.length < 3 || !(H > 0)) return 0;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (!(x1 > x0) || !(y1 > y0)) return 0;
  const n = Math.max(40, Math.min(500, grid | 0));
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  const cell = dx * dy;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const px = x0 + (i + 0.5) * dx;
    for (let j = 0; j < n; j++) {
      const py = y0 + (j + 0.5) * dy;
      if (!pointInPoly(px, py, poly)) continue;
      let h = H;
      for (let k = 0; k < poly.length; k++) {
        const nk = Number(slopes[k]);
        if (!(nk > 0)) continue;
        const d = distToSeg(px, py, poly[k], poly[(k + 1) % poly.length]);
        const hk = d / nk;
        if (hk < h) h = hk;
      }
      v += h;
    }
  }
  return v * cell;
}

/** 射线法判内外（偶奇规则）—— 与 matplotlib.Path.contains_points 同口径 */
export function pointInPoly(px: number, py: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** 点到线段的最短距离（与内核 _point_segment_distance 同式） */
export function distToSeg(px: number, py: number, a: number[], b: number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = t > 1 ? 1 : t < 0 ? 0 : t;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** 把弧定义序列（与母边同基）收成可 JSON 化的稀疏表：只留有弧的边 */
export function arcsToSparse(arcs: (ArcEdge | null)[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  arcs.forEach((a, i) => { if (a) out.push([i, +a.mx.toFixed(3), +a.my.toFixed(3)]); });
  return out;
}

/** 稀疏表 → 稠密弧数组（长度按母边数补齐） */
export function arcsFromSparse(list: unknown, m: number): (ArcEdge | null)[] {
  const out: (ArcEdge | null)[] = Array.from({ length: m }, () => null);
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const i = Number(e[0]), mx = Number(e[1]), my = Number(e[2]);
    if (Number.isFinite(i) && i >= 0 && i < m && Number.isFinite(mx) && Number.isFinite(my)) {
      out[i] = { mx, my };
    }
  }
  return out;
}

/**
 * 母边数变了（加/删顶点、插点）时按**原位置**搬运弧与逐边坡比，
 * 避免"插一个点，后面所有边的弧和坡比集体串位"。
 */
export function resizeEdgeArrays<T>(
  arr: (T | null)[], m: number, at?: (i: number) => T | null,
): (T | null)[] {
  const out = Array.from({ length: m }, (_, i) => (i < arr.length ? arr[i] : null));
  if (at) for (let i = arr.length; i < m; i++) out[i] = at(i);
  return out;
}

/** 在第 edge 条边上、按投影位置插入一个新顶点（弧/坡比同步搬迁） */
export function insertVertex(shape: ToeShape, edge: number, px: number, py: number): ToeShape {
  const M = shape.pts.length;
  if (M < 2 || edge < 0 || edge >= M) return shape;
  const a = shape.pts[edge], b = shape.pts[(edge + 1) % M];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0.5;
  t = Math.min(0.95, Math.max(0.05, t));           // 别贴着端点插（会造出零长边）
  const np: number[] = [a[0] + t * dx, a[1] + t * dy];
  const pts = [...shape.pts.slice(0, edge + 1), np, ...shape.pts.slice(edge + 1)];
  // 母边 edge → 两条新边：弧只有一侧有定义时留在**含原点**的那一侧，
  // 否则弧会跳到没画过的那半段上去
  const arc = shape.arcs?.[edge] ?? null;
  const arcs = [
    ...shape.arcs.slice(0, edge), arc, null, ...shape.arcs.slice(edge + 1),
  ];
  const slopes = [
    ...shape.slopes.slice(0, edge + 1), shape.slopes[edge] ?? null, ...shape.slopes.slice(edge + 1),
  ];
  return { ...shape, pts, arcs: arcs.slice(0, pts.length), slopes: slopes.slice(0, pts.length) };
}

/**
 * 删顶点（弧/坡比同步收缩）。
 *
 * 删掉顶点 i 会把「边 i-1」与「边 i」合并成一条新边（a_{i-1}→p_{i+1}）：
 * 母边序号整体后移一位，所以数组是**去掉 index i 那一项**。合并出来的那条边
 * （新下标 (i-1) mod (M-1)）：
 *   - 坡比**保留**用户填过的值（先取原边 i-1，没有再取边 i）—— 抹掉等于偷偷
 *     改回统一坡比，用户会看不见自己填的数；
 *   - 弧必须**清空** —— 三点定圆的第三点已经不在新的边上了，留着会画出一条
 *     不经过任何现有顶点的怪弧。
 */
export function deleteVertex(shape: ToeShape, i: number): ToeShape {
  const M = shape.pts.length;
  if (M <= 3 || i < 0 || i >= M) return shape;
  const pts = shape.pts.filter((_, j) => j !== i);
  const merged = (i - 1 + pts.length) % pts.length;
  const shift = <T, >(arr: (T | null)[], keep: T | null): (T | null)[] => {
    const next = arr.filter((_, j) => j !== i);
    next[merged] = keep;
    return next;
  };
  const prev = shape.slopes[(i - 1 + M) % M];
  return {
    ...shape,
    pts,
    arcs: resizeEdgeArrays(shift<ArcEdge>(shape.arcs, null), pts.length),
    slopes: resizeEdgeArrays(
      shift<number>(shape.slopes, prev ?? shape.slopes[i] ?? null), pts.length),
  };
}

/** 读表单文本 → ToeShape（polyText 是顶点的唯一真源，弧另存一份稀疏表） */
export function shapeFromText(
  polyText: string, arcsJson: string | undefined,
  edgeSlopes: (number | null)[] | undefined, n: number, H: number,
): ToeShape {
  const pts = (polyText || '').split(/[\n;]+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,，\s]+/).map(Number))
    .filter((p) => p.length >= 2 && p.every(Number.isFinite))
    .map((p) => [p[0], p[1]]);
  let arcs: (ArcEdge | null)[] = [];
  try {
    arcs = arcsFromSparse(arcsJson ? JSON.parse(arcsJson) : [], pts.length);
  } catch { arcs = arcsFromSparse([], pts.length); }
  return {
    pts,
    arcs: resizeEdgeArrays(arcs, pts.length),
    slopes: resizeEdgeArrays((edgeSlopes || []).map((v) => v), pts.length),
    n, H,
  };
}

/** ToeShape → 写回表单（顶点文本 + 弧稀疏表 JSON） */
export function shapeToText(shape: ToeShape): { polyText: string; arcsJson: string } {
  const polyText = shape.pts.map((p) => `${+p[0].toFixed(2)},${+p[1].toFixed(2)}`).join('\n');
  const sp = arcsToSparse(shape.arcs);
  return { polyText, arcsJson: sp.length ? JSON.stringify(sp) : '' };
}
