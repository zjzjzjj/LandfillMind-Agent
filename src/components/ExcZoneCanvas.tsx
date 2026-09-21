/**
 * ExcZoneCanvas · 开挖分区画布（桌面开挖页画布的 Web 等价）
 *
 * 桌面交互：✂ 切割模式拖线切分区 / ⌣ 设坡比模式点边改坡比 / 一键切四区 /
 * 撤销上一刀 / 清空。这里同语义：SVG 画 footprint + 分区多边形 + 切割线，
 * 切割线列表（世界坐标）由父组件持有并送内核 zones 动作做**真几何切分**
 * （zones_from_cuts，与桌面同一引擎），本组件只管画与采点。
 *
 * 配色照桌面：分区填充循环 _ZONE_UI_FILL（app.py:237-238，7 色），
 * 底图轮廓虚线 #8d6e63、切割线 #d84315 + ✂、拖线中 #d32f2f。
 * 坐标：世界米制（x 右、y 上），自动按 outline ∪ zones 外扩适配 viewBox（y 翻转）。
 */
import { useCallback, useMemo, useRef, useState } from 'react';

export interface ZonePoly { name: string; poly: number[][] }

interface Props {
  outline: number[][] | null;
  zones: ZonePoly[];
  cuts: number[][][];                       // [[ [x0,y0],[x1,y1] ], ...]
  mode: 'cut' | 'slope';
  onAddCut: (line: number[][]) => void;
  onEdgeClick?: (zoneIdx: number, edgeIdx: number) => void;
  height?: number;
}

/** 桌面 _ZONE_UI_FILL（app.py:237-238）—— 分区填充循环 */
const ZONE_FILL = ['#bbdefb', '#c8e6c9', '#ffe0b2', '#f8bbd0',
                   '#d1c4e9', '#b2dfdb', '#ffccbc'];
const C_OUTLINE = '#8d6e63';
const C_CUT = '#d84315';
const C_DRAG = '#d32f2f';

export default function ExcZoneCanvas({
  outline, zones, cuts, mode, onAddCut, onEdgeClick, height = 300,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number[][] | null>(null);

  // viewBox：outline ∪ zones 的并集 bbox，外扩 6%
  const box = useMemo(() => {
    const pts: number[][] = [...(outline ?? []), ...zones.flatMap((z) => z.poly)];
    if (!pts.length) return { x: -100, y: -100, w: 200, h: 200 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const mx = Math.max((x1 - x0) * 0.06, 5), my = Math.max((y1 - y0) * 0.06, 5);
    return { x: x0 - mx, y: y0 - my, w: (x1 - x0) + mx * 2, h: (y1 - y0) + my * 2 };
  }, [outline, zones]);

  const toWorld = useCallback((clientX: number, clientY: number): number[] => {
    const el = svgRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    return [box.x + fx * box.w, box.y + box.h - fy * box.h]; // y 翻转：屏幕下=世界小
  }, [box]);

  const polyPts = (p: number[][]) => p.map((q) => `${q[0]},${-q[1]}`).join(' ');
  const sw = box.w / 400;                 // 线宽随尺度
  const totalVerts = zones.reduce((s, z) => s + z.poly.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <svg ref={svgRef} viewBox={`${box.x} ${-box.y - box.h} ${box.w} ${box.h}`}
             style={{
               width: '100%', height: '100%', display: 'block',
               cursor: mode === 'cut' ? 'crosshair' : 'pointer',
               background: 'var(--bg-surface)', touchAction: 'none',
             }}
             onPointerDown={(e) => {
               if (mode !== 'cut') return;
               const p = toWorld(e.clientX, e.clientY);
               setDrag([p, p]);
               (e.target as Element).setPointerCapture?.(e.pointerId);
             }}
             onPointerMove={(e) => {
               if (mode === 'cut' && drag) setDrag((d) => (d ? [d[0], toWorld(e.clientX, e.clientY)] : d));
             }}
             onPointerUp={(e) => {
               if (mode !== 'cut' || !drag) return;
               const end = toWorld(e.clientX, e.clientY);
               const len = Math.hypot(end[0] - drag[0][0], end[1] - drag[0][1]);
               if (len > box.w * 0.02) onAddCut([drag[0], end]);
               setDrag(null);
             }}>
          {/* 底图轮廓：虚线 #8d6e63 */}
          {outline && outline.length >= 3 && (
            <polygon points={polyPts(outline)}
                     fill="rgba(141,110,99,0.06)" stroke={C_OUTLINE}
                     strokeWidth={sw * 1.2}
                     strokeDasharray={`${box.w / 90} ${box.w / 180}`} />
          )}
          {/* 分区多边形 + 边中点（设坡比模式可点） */}
          {zones.map((z, i) => (
            <g key={`${z.name}-${i}`}>
              <polygon points={polyPts(z.poly)}
                       fill={ZONE_FILL[i % ZONE_FILL.length]} fillOpacity={0.55}
                       stroke="var(--primary)" strokeWidth={sw} />
              {z.poly.map((p, k) => {
                const q = z.poly[(k + 1) % z.poly.length];
                const mid: number[] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
                return (
                  <g key={k}>
                    {mode === 'slope' && (
                      // 桌面画布是「边中点的黄点」—— 必须是 circle，line 画不出点
                      <circle cx={mid[0]} cy={-mid[1]} r={Math.max(box.w / 90, 2.5)}
                              fill="#ca8a04" stroke="#fff" strokeWidth={sw * 0.6}
                              style={{ cursor: 'copy' }}
                              onClick={(ev) => { ev.stopPropagation(); onEdgeClick?.(i, k); }}>
                        <title>{`点此为该边指定坡比 1:n（${z.name} 第 ${k + 1} 条边）`}</title>
                      </circle>
                    )}
                  </g>
                );
              })}
              <text x={z.poly.reduce((a, p) => a + p[0], 0) / z.poly.length}
                    y={-z.poly.reduce((a, p) => a + p[1], 0) / z.poly.length}
                    fontSize={box.w / 38} fill="var(--text-primary)"
                    textAnchor="middle" style={{ userSelect: 'none' }}>
                {z.name}
              </text>
            </g>
          ))}
          {/* 切割线：#d84315 虚线 + ✂ */}
          {cuts.map((c, i) => (
            <g key={i}>
              <line x1={c[0][0]} y1={-c[0][1]} x2={c[1][0]} y2={-c[1][1]}
                    stroke={C_CUT} strokeWidth={sw * 1.4}
                    strokeDasharray={`${box.w / 60} ${box.w / 120}`} />
              <text x={c[1][0]} y={-c[1][1]} fontSize={box.w / 34} fill={C_CUT}
                    style={{ userSelect: 'none' }}>✂</text>
            </g>
          ))}
          {/* 拖线中：#d32f2f */}
          {drag && (
            <>
              <line x1={drag[0][0]} y1={-drag[0][1]} x2={drag[1][0]} y2={-drag[1][1]}
                    stroke={C_DRAG} strokeWidth={sw * 1.4} />
              <text x={drag[1][0]} y={-drag[1][1] - box.h * 0.02}
                    fontSize={box.w / 40} fill={C_DRAG} style={{ userSelect: 'none' }}>
                松开即切开这一刀（自动延长到边界）
              </text>
            </>
          )}
        </svg>
      </div>
      {/* 右上角统计（桌面画布同款）+ 操作提示 */}
      <p className="text-[11px] px-2 py-1 shrink-0"
         style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        {mode === 'cut'
          ? '✂ 切割中：在图上按住拖一条直线（每刀把现有分区各切一次）'
          : '⌣ 设坡比中：点分区边中点的黄点，为该边指定逐边坡比 1:n'}
        <span className="ml-2">
          切割线 {cuts.length} 条 · 分区 {zones.length} 个 · 底图 {outline ? 1 : 0} 块轮廓
          {totalVerts ? ` · 顶点 ${totalVerts} 个` : ''}
        </span>
      </p>
    </div>
  );
}
