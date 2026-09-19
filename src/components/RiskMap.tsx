/**
 * 风险地图组件 · 工程平面图风格
 *
 * 底图为典型填埋场平面布置示意：填埋库区（堆体轮廓）、垃圾坝、渗滤液
 * 调节池、污水处理站、场内道路、地下水监测井、管理区大门，以及两个
 * 应急集合点（上风向 / 东侧出口）。风险区叠加于底图之上，疏散路线
 * 沿安全走廊（y=18% / 50% / 80%）绕行至最近的集合点，不再横穿库区。
 * 附指北针、比例尺与图例（左下角，避免遮挡右侧集合点）。
 */

import { useRef, useEffect, useState } from 'react';

export type RiskLevel = 'red' | 'orange' | 'yellow' | 'blue' | 'green';

interface RiskZone {
  id: string;
  label: string;
  level: RiskLevel;
  x: number;      // 0-100 百分比
  y: number;      // 0-100 百分比
  radius: number; // 0-100 百分比
  description?: string;
}

interface EscapeRoute {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

interface RiskMapProps {
  zones: RiskZone[];
  routes?: EscapeRoute[];
  siteName?: string;
  workerLocation?: { x: number; y: number };
  width?: number;
  height?: number;
}

const RISK_COLORS: Record<RiskLevel, string> = {
  red: 'rgba(220, 38, 38, 0.32)',
  orange: 'rgba(234, 88, 12, 0.32)',
  yellow: 'rgba(202, 138, 4, 0.30)',
  blue: 'rgba(37, 99, 235, 0.28)',
  green: 'rgba(22, 163, 74, 0.28)',
};

const RISK_BORDER_COLORS: Record<RiskLevel, string> = {
  red: '#dc2626',
  orange: '#ea580c',
  yellow: '#ca8a04',
  blue: '#2563eb',
  green: '#16a34a',
};

// 应急集合点（与 DiagnosisPage 适配层共用语义）
export const RALLY_POINTS = [
  { id: 'A', label: 'A 上风向集合点', x: 88, y: 13 },
  { id: 'B', label: 'B 东门集合点', x: 89, y: 82 },
];

/**
 * 疏散路线规划：风险点位 → 安全走廊（y=18/50/80）→ 最近集合点。
 * 代价 = 绕行距离 + 沿途穿越红/橙区惩罚；每条路线三段折线，绝不横穿库区中心。
 */
export function planEscapeRoutes(
  zones: Array<{ id: string; x: number; y: number; level: RiskLevel; radius?: number }>
): EscapeRoute[] {
  return zones
    .filter(z => z.level === 'red' || z.level === 'orange')
    .map((z) => {
      const r = z.radius ?? 12;
      const corridors = [18, 50, 80];
      const hotOthers = zones.filter(o => o.id !== z.id && (o.level === 'red' || o.level === 'orange'));
      let corridor = corridors[0], bestCost = Infinity;
      for (const cy of corridors) {
        const cross = hotOthers.filter(o =>
          Math.abs(o.y - cy) < (o.radius ?? 12) * 0.8 &&
          Math.min(o.x, z.x) < o.x && o.x < 92).length;
        const cost = Math.abs(cy - z.y) + cross * 60;
        if (cost < bestCost) { bestCost = cost; corridor = cy; }
      }
      // 集合点选择：A 在上（北），B 在下（南）；按走廊归属就近分配
      const rally = corridor <= 40 ? RALLY_POINTS[0] : RALLY_POINTS[1];
      const pts = [
        { x: z.x, y: Math.max(8, Math.min(90, z.y)) },        // 风险点外缘起步
        { x: Math.min(86, z.x + 6), y: corridor },            // 汇入安全走廊
        { x: 88, y: corridor },                               // 沿走廊向东
        { x: rally.x, y: rally.y },                           // 到达集合点
      ];
      return {
        id: `route-${z.id}`,
        label: `→ ${rally.label}`,
        color: '#16a34a',
        points: pts,
      };
    });
}

export function RiskMap({
  zones,
  routes = [],
  siteName = '填埋场作业区',
  workerLocation,
  width = 600,
  height = 400
}: RiskMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredZone, setHoveredZone] = useState<RiskZone | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    drawBaseMap(ctx, width, height, siteName);
    zones.forEach(zone => drawRiskZone(ctx, zone, width, height));
    routes.forEach(route => drawEscapeRoute(ctx, route, width, height));
    if (workerLocation) drawWorkerIcon(ctx, workerLocation.x, workerLocation.y, width, height);
    drawCompass(ctx, width);
    drawScaleBar(ctx, width, height);
    drawLegend(ctx, width, height);

  }, [zones, routes, workerLocation, width, height, siteName]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const found = zones.find(zone => {
      const dx = x - zone.x;
      const dy = y - zone.y;
      return Math.sqrt(dx * dx + dy * dy) <= zone.radius;
    });

    setHoveredZone(found || null);
  };

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredZone(null)}
        className="border rounded-lg shadow-sm"
        style={{ borderColor: 'var(--border)', cursor: 'crosshair', maxWidth: '100%' }}
      />

      {hoveredZone && (
        <div
          className="absolute px-3 py-2 rounded shadow-lg text-sm pointer-events-none"
          style={{
            left: `${Math.min(Math.max(hoveredZone.x, 15), 85)}%`,
            bottom: '10px',
            transform: 'translateX(-50%)',
            zIndex: 10,
            backgroundColor: 'var(--bg-surface)',
            border: `1px solid ${RISK_BORDER_COLORS[hoveredZone.level]}`,
            color: 'var(--text-primary)'
          }}
        >
          <div className="font-semibold">{hoveredZone.label}</div>
          {hoveredZone.description && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{hoveredZone.description}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== 底图：典型填埋场平面布置 ==================== */

function drawBaseMap(ctx: CanvasRenderingContext2D, W: number, H: number, siteName: string) {
  const px = (x: number) => (x / 100) * W;
  const py = (y: number) => (y / 100) * H;

  // 图纸底色
  ctx.fillStyle = '#f7f8f5';
  ctx.fillRect(0, 0, W, H);

  // 围栏边界（实测红线感：细双线）
  ctx.strokeStyle = '#9aa5a0';
  ctx.lineWidth = 1;
  ctx.strokeRect(px(3), py(4), px(94), py(92));
  ctx.strokeStyle = '#5f6f68';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([9, 4]);
  ctx.strokeRect(px(4.5), py(6), px(91), py(88));
  ctx.setLineDash([]);

  // ── 填埋库区（不规则五边形堆体轮廓）──
  const landfill: Array<[number, number]> = [
    [14, 26], [40, 18], [66, 22], [74, 42], [58, 58], [28, 56], [13, 40],
  ];
  ctx.beginPath();
  landfill.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
  ctx.closePath();
  ctx.fillStyle = '#e8e2d2';
  ctx.fill();
  ctx.strokeStyle = '#a99e83';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 库区内部等高示意线
  ctx.strokeStyle = 'rgba(169,158,131,0.45)';
  ctx.lineWidth = 1;
  for (const s of [0.72, 0.46]) {
    ctx.beginPath();
    landfill.forEach(([x, y], i) => {
      const cx = W / 2 + (px(x) - W / 2) * s, cy = H * 0.38 + (py(y) - H * 0.38) * s;
      i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.fillStyle = '#7d7358';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('填 埋 库 区', px(43), py(38));

  // ── 垃圾坝（库区下游边）──
  ctx.strokeStyle = '#8a7a5f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px(13), py(40));
  ctx.lineTo(px(28), py(56));
  ctx.lineTo(px(58), py(58));
  ctx.stroke();
  ctx.fillStyle = '#6f6248';
  ctx.font = '10px sans-serif';
  ctx.fillText('垃圾坝', px(34), py(61));

  // ── 渗滤液调节池 ──
  ctx.fillStyle = '#cfe3f5';
  ctx.fillRect(px(56), py(68), px(14), py(11));
  ctx.strokeStyle = '#5b8db8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px(56), py(68), px(14), py(11));
  ctx.fillStyle = '#33628c';
  ctx.fillText('渗滤液调节池', px(63), py(74));

  // ── 污水处理站 ──
  ctx.fillStyle = '#dbe7df';
  ctx.fillRect(px(77), py(64), px(10), py(8));
  ctx.strokeStyle = '#6f8f7c';
  ctx.strokeRect(px(77), py(64), px(10), py(8));
  ctx.fillStyle = '#4f6f5c';
  ctx.fillText('污水处理站', px(82), py(69));

  // ── 管理区 + 大门 ──
  ctx.fillStyle = '#efe6da';
  ctx.fillRect(px(6), py(12), px(9), py(7));
  ctx.strokeStyle = '#a8927a';
  ctx.strokeRect(px(6), py(12), px(9), py(7));
  ctx.fillStyle = '#8a7355';
  ctx.fillText('管理区', px(10.5), py(16));
  // 大门缺口 + 标注
  ctx.fillStyle = '#f7f8f5';
  ctx.fillRect(px(13.2), py(10.4), px(3), py(3));
  ctx.fillStyle = '#556';
  ctx.fillText('大门', px(8), py(9));

  // ── 场内道路（大门 → 库区南 → 处理站）──
  const road: Array<[number, number]> = [[16, 10.5], [22, 24], [34, 64], [54, 72], [77, 70]];
  ctx.strokeStyle = '#c9cec9';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  road.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
  ctx.stroke();
  ctx.strokeStyle = '#98a099';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.lineJoin = 'miter';
  // 道路中线
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  road.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
  ctx.stroke();
  ctx.setLineDash([]);

  // ── 地下水监测井（下游一线 3 口）──
  [['MW-1', 30, 82], ['MW-2', 44, 86], ['MW-3', 60, 83]].forEach(([label, x, y]) => {
    ctx.beginPath();
    ctx.arc(px(Number(x)), py(Number(y)), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.fillStyle = '#1e4fa3';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(label), px(Number(x)), py(Number(y)) + 15);
  });
  // 地下水流向箭头
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(px(70), py(80)); ctx.lineTo(px(88), py(76)); ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, px(70), py(80), px(88), py(76), '#2563eb');
  ctx.fillStyle = '#1e4fa3';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('地下水流向', px(79), py(84.5));

  // ── 应急集合点（旗帜）──
  for (const rp of RALLY_POINTS) drawRallyFlag(ctx, px(rp.x), py(rp.y), rp.label, W);

  // 标题
  ctx.fillStyle = '#374151';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(siteName, px(6), H - py(2));
}

function drawRallyFlag(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, canvasW = 600) {
  const rightEdge = x > (canvasW * 0.82);
  // 旗帜：靠近右缘时旗面朝左，文字放左侧，避免溢出画布
  const dir = rightEdge ? -1 : 1;
  ctx.strokeStyle = '#16a34a';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 22); ctx.stroke();
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.moveTo(x, y - 22); ctx.lineTo(x + dir * 16, y - 17); ctx.lineTo(x, y - 12);
  ctx.closePath(); ctx.fill();
  // 外圈强调
  ctx.strokeStyle = 'rgba(22,163,74,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#166534';
  ctx.font = 'bold 9px sans-serif';
  if (rightEdge) {
    ctx.textAlign = 'right';
    ctx.fillText(label, x - 14, y + 4);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 14, y + 4);
  }
}

/* ==================== 风险区（渐变 + 双圈） ==================== */

function drawRiskZone(
  ctx: CanvasRenderingContext2D,
  zone: RiskZone,
  width: number,
  height: number
) {
  const x = (zone.x / 100) * width;
  const y = (zone.y / 100) * height;
  const r = (zone.radius / 100) * Math.min(width, height);

  const grad = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
  grad.addColorStop(0, RISK_COLORS[zone.level].replace(/[\d.]+\)$/, '0.5)'));
  grad.addColorStop(1, RISK_COLORS[zone.level]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = RISK_BORDER_COLORS[zone.level];
  ctx.lineWidth = 2;
  ctx.stroke();

  // 外警示圈（红/橙加一圈斜纹警戒环）
  if (zone.level === 'red' || zone.level === 'orange') {
    ctx.save();
    ctx.strokeStyle = RISK_BORDER_COLORS[zone.level];
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 标签牌（白底黑字，可读性优于裸文本）
  ctx.font = 'bold 11px sans-serif';
  const tw = ctx.measureText(zone.label).width;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x - tw / 2 - 5, y + r - 6, tw + 10, 16);
  ctx.strokeStyle = RISK_BORDER_COLORS[zone.level];
  ctx.lineWidth = 1;
  ctx.strokeRect(x - tw / 2 - 5, y + r - 6, tw + 10, 16);
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'center';
  ctx.fillText(zone.label, x, y + r + 6);
}

/* ==================== 疏散路线（走廊折线 + 流动箭头） ==================== */

function drawEscapeRoute(
  ctx: CanvasRenderingContext2D,
  route: EscapeRoute,
  width: number,
  height: number
) {
  if (route.points.length < 2) return;

  // 底层白色描边提升与底图的对比度
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  strokePath(ctx, route.points, width, height, false);

  ctx.strokeStyle = route.color;
  ctx.lineWidth = 3.5;
  strokePath(ctx, route.points, width, height, true);

  // 路径中段方向箭头
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i], b = route.points[i + 1];
    const ax = (a.x / 100) * width, ay = (a.y / 100) * height;
    const bx = (b.x / 100) * width, by = (b.y / 100) * height;
    if (Math.hypot(bx - ax, by - ay) > 36) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      drawArrowHead(ctx, ax, ay, bx, by, route.color, mx, my);
    }
  }

  // 终点标牌（终点在画布右缘集合点附近时省略——旗标已带名称，避免叠字）
  const last = route.points[route.points.length - 1];
  const lx = (last.x / 100) * width, ly = (last.y / 100) * height;
  if (lx < width * 0.86) {
    ctx.fillStyle = route.color;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(route.label, lx - 12, ly + 4);
  }
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  W: number, H: number,
  dashed: boolean
) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dashed) ctx.setLineDash([10, 6]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (p.x / 100) * W, y = (p.y / 100) * H;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  color: string, atX?: number, atY?: number
) {
  const cx = atX ?? toX, cy = atY ?? toY;
  const headLen = 11;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  arrowTri(ctx, cx, cy, angle, headLen + 2);
  ctx.restore();
  void fromX; void fromY;
}

function arrowTri(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number) {
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath();
  ctx.moveTo(x + len * Math.cos(angle), y + len * Math.sin(angle));
  ctx.lineTo(x - len * Math.cos(angle - Math.PI / 6) * 0.7, y - len * Math.sin(angle - Math.PI / 6) * 0.7);
  ctx.lineTo(x - len * Math.cos(angle + Math.PI / 6) * 0.7, y - len * Math.sin(angle + Math.PI / 6) * 0.7);
  ctx.closePath();
  ctx.fill();
}

/* ==================== 工人位置 ==================== */

function drawWorkerIcon(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  width: number, height: number
) {
  const px = (x / 100) * width;
  const py = (y / 100) * height;

  // 定位光晕（同心圈）
  ctx.strokeStyle = 'rgba(59,130,246,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(59,130,246,0.25)';
  ctx.beginPath(); ctx.arc(px, py, 26, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = '#3b82f6';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  ctx.fillStyle = '#1e40af';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('您的位置', px, py - 31);
  // 连接线
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, py - 9); ctx.lineTo(px, py - 21); ctx.stroke();
}

/* ==================== 指北针 / 比例尺 / 图例 ==================== */

function drawCompass(ctx: CanvasRenderingContext2D, W: number) {
  const cx = W - 34, cy = 34, r = 17;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.2; ctx.stroke();
  // 北向指针（半红半黑菱形）
  ctx.fillStyle = '#dc2626';
  ctx.beginPath(); ctx.moveTo(cx, cy - r + 5); ctx.lineTo(cx - 5, cy + 3); ctx.lineTo(cx + 5, cy + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath(); ctx.moveTo(cx, cy + r - 6); ctx.lineTo(cx - 5, cy + 3); ctx.lineTo(cx + 5, cy + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - r + 2.5);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const x = W * 0.06, y = H - 14, seg = (W * 0.12) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x - 8, y - 16, W * 0.12 + 52, 26);
  ctx.strokeStyle = '#64748b';
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : '#475569';
    ctx.fillRect(x + i * seg, y - 6, seg, 5);
    ctx.strokeStyle = '#475569'; ctx.lineWidth = 1;
    ctx.strokeRect(x + i * seg, y - 6, seg, 5);
  }
  ctx.fillStyle = '#334155';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('0', x - 2, y + 8);
  ctx.fillText(`${Math.round(W * 0.06)} m`, x + seg * 2 + 4, y + 8);
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const items: { level: RiskLevel; label: string }[] = [
    { level: 'red', label: '高风险' },
    { level: 'orange', label: '较大风险' },
    { level: 'yellow', label: '一般风险' },
    { level: 'blue', label: '关注' },
    { level: 'green', label: '安全' },
  ];

  const boxW = 96, rowH = 17, pad = 8;
  const legendX = pad + 4;
  const legendY = height - items.length * rowH - pad * 2 - 30;

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(legendX, legendY, boxW, items.length * rowH + pad * 2);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, boxW, items.length * rowH + pad * 2);
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';

  items.forEach((item, i) => {
    const y = legendY + pad + i * rowH;
    ctx.fillStyle = RISK_COLORS[item.level];
    ctx.beginPath();
    ctx.arc(legendX + 12, y + 6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RISK_BORDER_COLORS[item.level];
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = '#334155';
    ctx.fillText(item.label, legendX + 25, y + 10);
  });
  ctx.restore();
}
