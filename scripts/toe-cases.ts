/**
 * scripts/toe-cases.ts · 把前端 ToeShape 各算子的结果打成**一行 JSON**
 *
 * 只为一件事：让内核仓库的 tools/toe-vs-kernel.py 能用**真内核函数**逐个对拍
 * （platform_ring / waste_volume / toe_arcs）。所以这个文件不是给人看的报告，
 * 输出必须只有一行 JSON、别的什么都不许 print。
 *
 * 前端自身的断言在 scripts/toe-check.ts。
 */
import {
  crestRings, densify, polyArea, shapeToText, volumeEstimate, type ToeShape,
} from '../src/components/ToeShape';

function sq(L: number, w: number): number[][] {
  const l = L / 2, h = w / 2;
  return [[-l, -h], [l, -h], [l, h], [-l, h]];
}
const LSHAPE = [[0, 0], [300, 0], [300, 100], [150, 100], [150, 200], [0, 200]];

/** 平台面积（前端场求值 + Marching Squares，与内核 platform_ring 同算法） */
function crestArea(shape: ToeShape): number {
  const d = densify(shape);
  const rings = crestRings(d.poly, d.slopes, shape.H);
  // 注意要**累加所有环**：凹形会把平台切成几块（内核侧同样是 sum(poly_area(r))）
  return rings.reduce((s, r) => s + polyArea(r), 0);
}
/** 库容预览（前端栅格求积） */
function volume(shape: ToeShape, grid = 400): number {
  const d = densify(shape);
  return volumeEstimate(d.poly, d.slopes, shape.H, grid);
}
function mk(pts: number[][], o: Partial<ToeShape> = {}): ToeShape {
  return { pts, arcs: pts.map(() => null), slopes: pts.map(() => null),
    n: 4, H: 20, ...o };
}

const crest = [
  { label: '矩形 300×200 · H=20 · 1:4', poly: sq(300, 200), n: 4, H: 20,
    jsArea: crestArea(mk(sq(300, 200))) },
  { label: '矩形 长短边异坡', poly: sq(300, 200), n: 4, H: 20,
    slopes: [2, 6, 2, 6], jsArea: crestArea(mk(sq(300, 200), { slopes: [2, 6, 2, 6] })) },
  { label: '山谷型凹口 L 形', poly: LSHAPE, n: 2, H: 10,
    jsArea: crestArea(mk(LSHAPE, { n: 2, H: 10 })) },
  { label: '坡太缓 → 无平台', poly: sq(300, 200), n: 4, H: 100,
    jsArea: crestArea(mk(sq(300, 200), { H: 100 })) },
];

const volumeCases = [
  { label: '矩形 300×200 · H=20 · 1:4', poly: sq(300, 200), n: 4, H: 20, grid: 151,
    jsVol: volume(mk(sq(300, 200))) },
  { label: '矩形 长短边异坡', poly: sq(300, 200), n: 4, H: 20, grid: 151,
    slopes: [2, 6, 2, 6],
    jsVol: volume(mk(sq(300, 200), { slopes: [2, 6, 2, 6] })) },
  { label: '凹口 L 形', poly: LSHAPE, n: 2, H: 10, grid: 151,
    jsVol: volume(mk(LSHAPE, { n: 2, H: 10 })) },
];

/**
 * 弧加密对拍（内核 toe_arcs 落地后这一段才有效）：
 * arcs 用**稀疏三元组** [母边序号, 中点x, 中点y] —— 与表单里 polyArcs 存的就
 * 是同一个格式，所以两边天然同构。
 */
const arcs = [
  ['底边外鼓弧', sq(300, 200), [[0, 0, -140]], 0.05],
  ['两条对边都是弧', sq(300, 200), [[0, 0, -140], [2, 0, 140]], 0.05],
  ['准半圆深鼓', sq(300, 200), [[1, 260, 0]], 0.05],
].map(([label, poly, list, tol]) => {
  const shape = mk(poly as number[][], {
    arcs: (() => {
      const arr = (poly as number[][]).map(() => null) as Array<{ mx: number; my: number } | null>;
      for (const e of list as Array<[number, number, number]>) arr[e[0]] = { mx: e[1], my: e[2] };
      return arr;
    })(),
    slopes: [2, 6, 2, 6],
  });
  const d = densify(shape, tol as number);
  return {
    label: label as string, poly: poly as number[][], arcs: list, tol: tol as number,
    jsSrcSlopes: shape.slopes.map((v) => v ?? shape.n),
    jsPoly: d.poly, jsSlopes: d.slopes, jsEdgeOf: d.edgeOf, jsArea: polyArea(d.poly),
    // 加密前粗折线的文本形式（回归用：确认 shapeToText 不吞弧）
    coarseText: shapeToText(shape).polyText.split('\n').length,
  };
});

process.stdout.write(JSON.stringify({ crest, volume: volumeCases, arcs }) + '\n');
