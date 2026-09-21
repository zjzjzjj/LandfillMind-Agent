/**
 * spec/views.ts · 视图注册表（与桌面 app.py 同词同序）
 *
 * 9 个主视图 + 4 条子视图条 + 视图提示语，文字全部照抄桌面：
 *   主视图  VIEW_TABS      app.py:167-170
 *   提示语  VIEW_TIPS      app.py:191-201
 *   子视图条                app.py:4081-4161
 *
 * ⚠ 子视图的 `fig` 是**内核图键**（agent_cli._FIG_LABELS 的 23 个键之一），
 *  不是桌面子视图条的键。桌面自己的 `arc`/`mc`/`plane`/`exc_fs` 是它内部叫法，
 *  与内核键不同源 —— 这里只对齐**中文标签**，键名一律用内核键，避免多一层
 *  翻译（翻译层漏一处就会静默丢子图）。唯一例外是污染的 `plume`：桌面是
 *  **一个**按钮，按 plume_mode 画平面或剖面，故这里也合成一个。
 */

/** 主视图（顺序即 viewbar 顺序） */
export const VIEWS = [
  { k: '3d', label: '三维模型', icon: '●' },
  { k: 'contour', label: '等高线', icon: '◎' },
  { k: 'slope', label: '坡度', icon: '▲' },
  { k: 'section', label: '剖面', icon: '┃' },
  { k: 'storage', label: '库容曲线', icon: '∿' },
  { k: 'settle', label: '沉降估算', icon: '▽' },
  { k: 'stability', label: '稳定性', icon: '⚖' },
  { k: 'excavation', label: '开挖稳定性', icon: '◈' },
  { k: 'pollution', label: '污染分析', icon: '◉' },
] as const;

export type ViewKey = (typeof VIEWS)[number]['k'];

export const VIEW_LABEL: Record<string, string> = Object.fromEntries(
  VIEWS.map((v) => [v.k, v.label]));

/** 视图提示语（hover tooltip），照抄桌面 VIEW_TIPS */
export const VIEW_TIPS: Record<string, string> = {
  '3d': '三维场地模型：左键拖动旋转，滚轮缩放',
  contour: '堆体顶面等高线（填色）图',
  slope: '坡度分级分布图（超允许坡度区标注）',
  section: '沿 A–B 测线的基底/顶面/堆体厚度剖面',
  storage: '库容曲线 V-h 与库盆面积 A-h 双纵轴',
  settle: '沉降-深度剖面（细分层 σ0/Δσ 应力 + 累计沉降）与差异沉降平面分布',
  stability: '无限边坡 Fs · Bishop 圆弧临界 · Monte Carlo Pf/β',
  excavation: '开挖稳定性：滑面可切入地基 · 分层强度与水位 · 逐级坡 · 分区逐阶段',
  pollution: '污染分析：产气时程与强度 · 渗滤液水量与水质 · 柱穿透 · 二维地下水羽流',
};

export interface SubBtn {
  /** UI 跟踪用的键（桌面子视图条的键） */
  k: string;
  label: string;
  /** 对应的内核图键；数组表示按模式二选一（污染「羽流」） */
  fig: string | string[];
}

export interface SubBar {
  buttons: SubBtn[];
  /** 右端灰字说明（桌面 DimBG.TLabel） */
  hint?: string;
  /** 右端是否带结果时刻下拉（产气年份 / 羽流时刻 / 开挖阶段） */
  timeAxis?: 'poll' | 'stage';
}

/** 4 条子视图条（仅对应主视图时显示，互斥） */
export const SUB_BARS: Partial<Record<ViewKey, SubBar>> = {
  stability: {
    hint: '滑面限定在垃圾堆体内 · 开挖另见「开挖」视图',
    buttons: [
      { k: 'fs_grid', label: 'Fs 网格', fig: 'fs_grid' },
      { k: 'arc', label: '临界圆弧', fig: 'critical_arc' },
      { k: 'scan', label: '断面扫描', fig: 'section_scan' },
      { k: 'mc', label: 'P_f / β', fig: 'monte_carlo' },
    ],
  },
  excavation: {
    hint: '滑面可切入基底以下 · 分层强度 + 地下水位',
    timeAxis: 'stage',
    buttons: [
      { k: 'exc_fs', label: '开挖Fs', fig: 'exc_fs_grid' },
      { k: 'exc_arc', label: '开挖圆弧', fig: 'exc_arc' },
      { k: 'exc_levels', label: '逐级坡', fig: 'exc_levels' },
      { k: 'exc_phases', label: '分区阶段', fig: 'exc_phases' },
      { k: 'exc_stage', label: '阶段剖面', fig: 'exc_stage' },
    ],
  },
  settle: {
    buttons: [
      { k: 'profile', label: '深度剖面', fig: 'settlement_profile' },
      { k: 'plane', label: '平面分布', fig: 'settlement_plane' },
    ],
  },
  pollution: {
    timeAxis: 'poll',
    buttons: [
      { k: 'gas_curve', label: '产气时程', fig: 'gas_curve' },
      { k: 'gas_field', label: '产气强度', fig: 'gas_field' },
      { k: 'leachate', label: '渗滤液水量', fig: 'leachate' },
      { k: 'quality', label: '水质曲线', fig: 'quality' },
      { k: 'column', label: '柱穿透', fig: 'column' },
      // 桌面是一个「羽流」钮，按 plume_mode 出平面或剖面 —— 这里同款
      { k: 'plume', label: '羽流', fig: ['plume_plan', 'plume_section'] },
    ],
  },
};

/** 各子视图条首次点开时的默认子键（桌面默认值） */
export const SUB_DEFAULT: Partial<Record<ViewKey, string>> = {
  stability: 'fs_grid',
  excavation: 'exc_arc',
  settle: 'profile',
  pollution: 'gas_curve',
};

/**
 * 模型类视图：没有分析结果时按当前工程**即时渲图**（与桌面共享同一模型）。
 * 值 = render 动作要的 figure 键 + 该视图特有的 render 参数。
 */
export const RENDERABLE: Partial<Record<ViewKey, {
  fig: string;
  params?: Record<string, unknown>;
}>> = {
  // 桌面等高线视图画的是**顶面**（app.py:5716「基底多平坦无等高线」）
  contour: { fig: 'contour', params: { contour_surface: 'top' } },
  slope: { fig: 'slope_map' },
  section: { fig: 'section', params: { sec_segments: true } },
  storage: { fig: 'storage_curve' },
};

/** 「◧ 内核图」用的 matplotlib 3D 图键（严格对照桌面时的兜底） */
export const KERNEL_3D_FIG = 'model3d';
