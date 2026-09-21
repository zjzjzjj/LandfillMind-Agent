/**
 * utils/layout.ts · 超大屏（≥1920px，tailwind 3xl 断点）适配的共享令牌
 *
 * 背景：全站响应式原先止于 lg(1024)，2.5K+ 屏上首页/计算工具库/多智能体
 * 等页被 max-w 夹成中间一条窄带。规则：
 *  - 宽度类改动统一拼这个常量，挂的是 `3xl:`（≥1920px），
 *    1366/1440/1536 视口零变化；
 *  - 需要**数字 prop** 的高度（three.js / SVG 图表，Tailwind 类管不到）
 *    用 widePx()，口径与 3xl 断点一致。
 */

/** 页面主容器限宽：笔记本保持 max-w-6xl，≥1920 放宽到 1720px。
 *  使用方自己补 `px-*` / `py-*`（各区块垂直间距不同，不合并进常量）。 */
export const PAGE_MAXW = 'mx-auto max-w-6xl 3xl:max-w-[1720px]';

/** 3xl 断点像素值（与 tailwind.config.js 的 screens['3xl'] 保持一致） */
export const WIDE_BP = 1920;

/** 大屏取 wide 值、否则取 base —— 用于必须传数字的 prop（图表高度等）。
 *  读 window 是挂载时一次性的：跨断点拖窗口不会热更新，接受。 */
export function widePx(base: number, wide: number): number {
  if (typeof window === 'undefined') return base;
  return window.innerWidth >= WIDE_BP ? wide : base;
}
