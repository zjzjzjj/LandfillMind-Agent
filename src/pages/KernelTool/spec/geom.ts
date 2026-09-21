/**
 * spec/geom.ts · 坡比 ↔ 坡角换算
 *
 * 桌面这一对是双向 trace 同步的（app.py:981 的「坡角/坡比自动换算」），
 * 内核 parametric 里也有同名的 slope_ratio_from_angle / slope_angle_from_ratio
 * （agent_cli.py 的 _scene_hint 就在用后者），换算定义必须一致：
 *   坡比 1:n  ↔  坡角 α = atan(1/n)
 */

/** 坡比 n（1:n 里的 n）→ 坡角（度） */
export function slopeAngle(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.atan(1 / n) * 180 / Math.PI;
}

/** 坡角（度）→ 坡比 n（保留 2 位，与桌面输入框精度一致） */
export function slopeRatio(deg: number): number {
  if (!Number.isFinite(deg) || deg <= 0 || deg >= 90) return NaN;
  return Math.round((1 / Math.tan(deg * Math.PI / 180)) * 100) / 100;
}
