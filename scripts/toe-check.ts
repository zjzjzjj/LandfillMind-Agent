/**
 * scripts/toe-check.ts · 坡脚线几何（ToeShape）的纯函数自检
 *
 * 为什么要有它：画布上的"预测坡顶/占地/库容"必须与 Python 内核同一个口径，
 * 否则用户在画布上看着对、建完模就不是了。这一层是纯函数，不用起浏览器
 * 也不用起服务，直接 `npx tsx scripts/toe-check.ts` 就能验。
 *
 * 与内核对照的那一步（platform_ring / _polygon_height_field 同参数跑一遍）
 * 见 scripts/toe-vs-kernel.py，两个一起才算闭环。
 */
import {
  arcFromPoints, arcsFromSparse, arcsToSparse, centroid, crestRings, densify,
  deleteVertex, distToSeg, insertVertex, pointInPoly, polyArea, sampleArc,
  shapeFromText, shapeToText, volumeEstimate, type ToeShape,
} from '../src/components/ToeShape';

let pass = 0, fail = 0;
function ok(cond: boolean, label: string, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function near(a: number, b: number, tol: number): boolean {
  return Number.isFinite(a) && Math.abs(a - b) <= tol;
}

function sq(L: number, W: number): number[][] {
  const l = L / 2, w = W / 2;
  return [[-l, -w], [l, -w], [l, w], [-l, w]];
}
function shapeOf(pts: number[][], o: Partial<ToeShape> = {}): ToeShape {
  return {
    pts, arcs: pts.map(() => null), slopes: pts.map(() => null),
    n: 4, H: 20, ...o,
  };
}

console.log('\n[1] 矩形坡脚 → 平台内缩（解析可核对）');
{
  // 300×200、H=20、1:4 → 每边内缩 H·n = 80 → 平台 140×40
  const s = shapeOf(sq(300, 200));
  const d = densify(s);
  ok(d.poly.length === 4 && d.slopes.length === 4, '无弧时加密保持原顶点数',
    `poly=${d.poly.length} slopes=${d.slopes.length}`);
  const rings = crestRings(d.poly, d.slopes, s.H);
  let A = rings.length ? polyArea(rings[0]) : 0;
  ok(rings.length === 1 && near(A, 140 * 40, 60), '平台面积 = 140×40（栅格取线，容一像素）',
    `${A.toFixed(1)} m²`);
  const c = rings[0] ? centroid(rings[0]) : [0, 0];
  ok(near(c[0], 0, 1e-6) && near(c[1], 0, 1e-6), '平台居中原点');
}

console.log('\n[2] 库容预览 vs 解析积分');
{
  // V = ∫₀^H (300-8z)(200-8z) dz = 1.2e6 - 8e5 + 64·(20³/3) = 570666.67
  const s = shapeOf(sq(300, 200));
  const d = densify(s);
  const V = volumeEstimate(d.poly, d.slopes, s.H, 400);
  ok(Math.abs(V - 570666.67) / 570666.67 < 0.01, '栅格求积误差 <1%',
    `${(V / 1e4).toFixed(1)} 万m³ vs 解析 57.1 万m³`);
  const V2 = volumeEstimate(d.poly, d.slopes, s.H, 120);
  ok(V2 > 0 && V2 < s.H * 300 * 200, '粗网格仍是正且有界',
    `${(V2 / 1e4).toFixed(1)} 万m³`);
}

console.log('\n[3] 逐边坡比（长短边不同坡）');
{
  // 坡比决定的是**垂直于该边**方向上的内缩距离 t = H·n：
  // 底/顶边（沿 x，坡比 1:2）→ y 方向各进 40；左/右边（沿 y，坡比 1:6）→ x 各进 120
  // → 平台 = (300-240) × (200-80) = 60×120
  const s = shapeOf(sq(300, 200), { slopes: [2, 6, 2, 6], n: 4 });
  const d = densify(s);
  ok(d.slopes.join(',') === '2,6,2,6', '逐边坡比原样带出', d.slopes.join(','));
  const rings = crestRings(d.poly, d.slopes, s.H);
  const A = rings.reduce((t, r) => t + polyArea(r), 0);
  ok(near(A, 60 * 120, 200), '平台 = 60×120（栅格容差）', `${A.toFixed(1)} m²`);
  // 反过来的那组（长边 1:6 → y 进 120 > 半高 100）应当吃光平台
  const s2 = shapeOf(sq(300, 200), { slopes: [6, 2, 6, 2], n: 4 });
  const d2 = densify(s2);
  ok(crestRings(d2.poly, d2.slopes, 20).length === 0, '长边过缓 → 平台被吃光');
}

console.log('\n[4] 圆弧边：三点定圆 + 弦差加密');
{
  const p1 = [-100, -100], p2 = [100, -100];
  const mid = [0, -160];                     // 向外鼓出去的弧
  const c = arcFromPoints(p1, mid, p2);
  ok(!!c, '三点定圆成功');
  if (c) {
    ok(near(Math.hypot(mid[0] - c.cx, mid[1] - c.cy), c.R, 1e-6), '中点在圆上');
    ok(near(Math.hypot(p1[0] - c.cx, p1[1] - c.cy), c.R, 1e-6), '起点在圆上');
    const segs = sampleArc(c, 64);
    const sag = Math.max(...segs.map((p) => distToSeg(p[0], p[1], p1, p2)))
      ;
    ok(sag > 55 && sag < 65, '弧确实鼓出约 60 m', `矢高≈${sag.toFixed(1)}`);
  }
  const s = shapeOf([[-100, -100], [100, -100], [100, 100], [-100, 100]],
    { arcs: [{ mx: 0, my: -160 }, null, null, null], H: 20, n: 4 });
  const d = densify(s, 0.05);
  ok(d.poly.length > 4, '弧边被加密出额外顶点', `${s.pts.length} → ${d.poly.length}`);
  ok(d.slopes.length === d.poly.length, 'slopes 与 poly 一一对应（内核硬要求）',
    `${d.slopes.length} == ${d.poly.length}`);
  ok(d.edgeOf.length === d.poly.length, 'edgeOf 同步长度');
  // 每条加密后子弦到母弧的距离必须 ≤ tol：抽查弧边的中点是否落在圆上
  if (c) {
    const arcPts = d.poly.filter((_, j) => d.edgeOf[j] === 0);
    const worst = Math.max(...arcPts.map((p) => Math.abs(
      Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.R)));
    ok(worst < 1e-6, '加密点全部精确落在圆弧上', `最大偏差 ${worst.toExponential(1)}`);
    // 弦差：子弦中点到弧的距离 ≤ tol
    let maxSag = 0;
    for (let j = 0; j + 1 < arcPts.length; j++) {
      const a = arcPts[j], b = arcPts[j + 1];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      maxSag = Math.max(maxSag, Math.abs(Math.hypot(m[0] - c.cx, m[1] - c.cy) - c.R));
    }
    ok(maxSag <= 0.05 + 1e-9, '弦差 ≤ tol=0.05 m', `${maxSag.toExponential(2)}`);
  }
}

console.log('\n[5] 退化与极端输入不能炸');
{
  const coll = arcFromPoints([0, 0], [5, 0], [10, 0]);
  ok(coll === null, '三点共线 → 按直线边处理');
  const dup = arcFromPoints([0, 0], [0, 0], [10, 0]);
  ok(dup === null, '重合点 → 按直线边处理');
  // 极小半径 + 大容差：矢高约束对半圆都成立，必须走 Δθ=π 分支且不发散
  const tiny = shapeOf([[0, 0], [1, 0], [1, 1], [0, 1]],
    { arcs: [{ mx: 0.5, my: 0.02 }, null, null, null], H: 5, n: 2 });
  const dt = densify(tiny, 5);
  ok(dt.poly.length < 4000 && dt.poly.length > 1, 'tol≥2R 分支不炸且不失控',
    `poly=${dt.poly.length}`);
  ok(dt.slopes.length === dt.poly.length, '极端情形 slopes 仍等长');
  const half = shapeOf([[0, 0], [200, 0], [200, 200], [0, 200]],
    { arcs: [{ mx: 100, my: -100 }, null, null, null], H: 20, n: 4 });
  const dh = densify(half, 0.05);
  ok(dh.poly.length <= 4 + 4000, '半圆弧顶点数被上限兜住', `poly=${dh.poly.length}`);
  ok(crestRings(dh.poly, dh.slopes, 20).length >= 0, '带弧的坡顶反演不抛异常');
  // tol ≥ 2R 时 acos(1−tol/R) 的定义域越界（会算出 NaN），必须走 Δθ=π 分支；
  // 之后仍受 maxStepDeg=15° 兜住，所以是一支支 15° 的弦而不是一整条
  const flat = densify(shapeOf([[0, 0], [200, 0], [200, 200], [0, 200]],
    { arcs: [{ mx: 100, my: -100 }, null, null, null], H: 20, n: 4 }), 250);
  const anyNaN = flat.poly.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]));
  ok(!anyNaN && flat.poly.length > 4 && flat.poly.length < 4004,
    '半圆弧 + 超大容差 → 不越 acos 定义域、顶点数受控', `poly=${flat.poly.length}`);
  // 坡太缓 → 平台被吃光 → 空环（界面上要显示"无平台"）
  const none = crestRings(sq(300, 200), [4, 4, 4, 4], 100);
  ok(none.length === 0, '堆高过大 → 无平台（返回空）');
  ok(volumeEstimate([], [], 20) === 0, '空多边形体积为 0 不 NaN');
  ok(Number.isFinite(volumeEstimate(sq(300, 200), [0, 4, 4, 4], 20)), '坏坡比 0 不 NaN');
}

console.log('\n[6] 凹多边形（L 形）');
{
  const L = [[0, 0], [300, 0], [300, 100], [150, 100], [150, 200], [0, 200]];
  const s = shapeOf(L, { H: 10, n: 2 });
  const d = densify(s);
  const rings = crestRings(d.poly, d.slopes, 10);
  const A = rings.length ? rings.reduce((s, r) => s + polyArea(r), 0) : 0;
  ok(A > 0 && A < polyArea(L), '凹地形的平台面积介于 0 与占地之间',
    `${A.toFixed(0)} < ${polyArea(L).toFixed(0)} m²`);
  ok(pointInPoly(10, 10, L) && !pointInPoly(290, 190, L), '射线法判内外正确');
}

console.log('\n[7] 顶点编辑的弧/坡比搬运');
{
  const base = shapeOf(sq(300, 200), { slopes: [6, 2, 6, 2] });
  const ins = insertVertex(base, 1, 0, 0);          // 在边 1（右边）上插一点
  ok(ins.pts.length === 5, '插点后顶点数 +1');
  ok(ins.slopes.length === 5, '插点后 slopes 同步 +1', ins.slopes.join(','));
  ok(ins.slopes[1] === 2 && ins.slopes[2] === 2, '拆出的两条边都继承母边坡比');
  ok(ins.slopes[0] === 6 && ins.slopes[3] === 6 && ins.slopes[4] === 2,
    '其余边的坡比没有串位', ins.slopes.join(','));
  const arced = shapeOf(sq(300, 200),
    { arcs: [null, { mx: 160, my: 0 }, null, null] });
  const ins2 = insertVertex(arced, 1, 0, 0);
  ok(ins2.arcs[1] !== null && ins2.arcs[2] === null,
    '插点后弧留在含母边起点的那半段');
  const del = deleteVertex(ins, 1);
  ok(del.pts.length === 4, '删点还原顶点数');
  ok(del.slopes.length === 4 && del.arcs.length === 4, '删点后数组等长',
    del.slopes.join(','));
  const delArc = deleteVertex(arced, 1);            // 删掉弧的终点
  ok(delArc.arcs[1] === null, '合并边上的弧定义被清空');
  ok(delArc.slopes[1] === null, '合并边坡比回退（无母值可留时为 null）',
    delArc.slopes.join(','));
  const keepN = deleteVertex(shapeOf(sq(300, 200), { slopes: [6, 2, 6, 2] }), 2);
  ok(keepN.slopes.includes(6) && keepN.slopes.includes(2), '删点不误伤其它边坡比',
    keepN.slopes.join(','));
  ok(deleteVertex(shapeOf(sq(300, 200)), 0).pts.length === 3, '四边形删到三角形');
  ok(deleteVertex(shapeOf([[0, 0], [10, 0], [0, 10]]), 0).pts.length === 3,
    '三角形不许再删（会不成面）');
}

console.log('\n[8] 表单文本 ↔ ToeShape 往返（polyText 是顶点唯一真源）');
{
  const s = shapeOf(sq(300, 200), { arcs: [{ mx: 0, my: -140 }, null, null, null] });
  const { polyText, arcsJson } = shapeToText(s);
  const back = shapeFromText(polyText, arcsJson, [6, null, 6, null], 4, 20);
  ok(back.pts.length === 4, '顶点文本往返 4 点');
  ok(back.arcs[1] === null && !!back.arcs[0], '弧往返');
  ok(back.arcs[0]!.my === -140, '弧中点数值往返', String(back.arcs[0]!.my));
  // 第 2、4 条边留空 = null（统一坡比），第 1、3 条边保住 6
  ok(JSON.stringify(back.slopes) === '[6,null,6,null]', '逐边坡比往返',
    JSON.stringify(back.slopes));
  ok(arcsToSparse(s.arcs).length === 1, '稀疏表只留有弧的边');
  ok(arcsFromSparse('[[9,1,1]]', 4).every((a) => a === null), '越界索引被丢弃');
  ok(arcsFromSparse('not json', 4).length === 4, '坏 JSON 不抛（回落全直线）');
  const s2 = shapeFromText(polyText + '\n999,999', '', [], 4, 20);
  ok(shapeToText(s2).polyText.split('\n').length === 5, '加一行顶点即生效');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} toe-check: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
