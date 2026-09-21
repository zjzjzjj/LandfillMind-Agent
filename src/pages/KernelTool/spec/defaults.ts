/**
 * spec/defaults.ts · 表单状态结构与**桌面初值**
 *
 * 所有默认值逐项照抄桌面 app.py 的控件初值（分组见 ①~⑦），不要凭经验改：
 * 默认值本身就是口径的一部分（比如「允许坡度 18.4°」= 1:3，「设计标高 92」
 * 决定剩余库容，分层填埋三层合计 20m 会自动写进堆高 H）。
 */

/** 分层填埋一行（桌面 tree_layers：层数/层名/层高m/容重kN/m³） */
export interface LayRow { name: string; h: number; gamma: number }

/** 填埋单元一行（桌面 tree_cells：名称/形状/底面标高/堆高m/坡比） */
export interface CellRow {
  name: string; shape: 'rect' | 'poly';
  poly: string;              // 多边形顶点文本 "x,y" 每行一个
  /** 该单元的坡脚弧定义（同 build.polyArcs 的稀疏表 JSON） */
  arcs?: string;
  L: number; W: number;      // 矩形单元用
  /** 矩形单元中心（缺省原点）——不给的话多块矩形单元会全部叠在原地上 */
  cx?: number; cy?: number;
  z0: number; height: number; n: number;
  /** 逐边坡比（该单元每条边一个；null/缺省 = 全部用统一坡比 n）。
      示例场的各边是 1:1.5~1:5 大幅拉开的，重建时必须带回去。 */
  slopes?: Array<number | null>;
  /** 设计堆高（内核单元键 design_H）：高于 height 时该单元有剩余库容，
      驱动桌面「剩余库容」分列。空 = 不指定。 */
  designH?: string;
}

/** 地基压缩层一行（桌面 tree_soil：土层/厚m/Es/e0/Cc/σp/Cs） */
export interface SoilRow {
  name: string; h: number; Es: string; e0: string; Cc: string;
  sigmaP: string; Cs: string;
}

/** 开挖材料分层一行（桌面 tree_exc_lay：层名/层顶m/层底m/γ/c'/φ'） */
export interface ExcLayerRow {
  name: string; zTop: number; zBot: number;
  gamma: number; c: number; phi: number;
}

/** 开挖分区一行（桌面 tree_exc_zones：序/分区/顶点/级数/临时坡/深m/逐边） */
export interface ZoneRow {
  name: string;
  poly: string;              // "x,y" 每行一个顶点
  topZ: number | null;
  levels: string;            // "6,2,3;6,2,0" 或单区独立分级
  tempN: number;
  order: number;
  /** 逐边临时坡比（画布上点边中点设，长度 = 顶点数；null = 用 tempN）。
      内核 excavation.normalize_zone 要求「个数 == 顶点数且均为有限正数」。 */
  slopes?: Array<number | null>;
}

const DEMO_LAYERS: LayRow[] = [
  { name: '生活垃圾', h: 10, gamma: 10 },
  { name: '建筑渣土', h: 6, gamma: 18 },
  { name: '覆土', h: 4, gamma: 18 },
];

const DEMO_SOIL: SoilRow[] = [
  { name: '素填土/耕植土', h: 4.0, Es: '2500', e0: '', Cc: '', sigmaP: '', Cs: '' },
  { name: '粉质黏土', h: 8.0, Es: '4500', e0: '', Cc: '', sigmaP: '', Cs: '' },
  { name: '强风化基岩', h: 6.0, Es: '18000', e0: '', Cc: '', sigmaP: '', Cs: '' },
];

const DEMO_EXC_LAYERS: ExcLayerRow[] = [
  { name: '生活垃圾', zTop: 30, zBot: 0, gamma: 11, c: 8, phi: 25 },
  { name: '地基粉质黏土', zTop: 0, zBot: -30, gamma: 18.5, c: 25, phi: 18 },
];

/** 分层填埋（⑤ 顶面模式 → 分层填埋，桌面预填三层合计 20m） */
export const DEFAULT_LAYERS = DEMO_LAYERS;
/** 地基压缩层默认（桌面 DEMO_SOIL_LAYERS） */
export const DEFAULT_SOIL = DEMO_SOIL;
/** 开挖材料分层默认（桌面预填两层） */
export const DEFAULT_EXC_LAYERS = DEMO_EXC_LAYERS;

/** 网格分辨率可选项（桌面 Combobox readonly） */
export const GRID_OPTIONS = [41, 61, 81, 101, 121];
/** 插值方法：显示名 → 内核参数值 */
export const INTERP_OPTIONS: Array<[string, string]> = [
  ['线性 TIN (linear)', 'linear'],
  ['三次曲面 (cubic)', 'cubic'],
  ['反距离加权 (idw)', 'idw'],
  ['最近邻 (nearest)', 'nearest'],
];
/** 层类型 → 容重（桌面 LAYER_GAMMA） */
export const LAYER_GAMMA: Record<string, number> = {
  生活垃圾: 10, 建筑渣土: 18, 污泥: 12, 覆土: 18, 自定义: 12,
};
/** 断面扫描方向：显示文本 → direction 参数（桌面 SCAN_DIRS） */
export const SCAN_DIRS: Array<[string, string]> = [
  ['剖面 ∥ X (沿 Y 布置)', 'X'],
  ['剖面 ∥ Y (沿 X 布置)', 'Y'],
];

export interface FormState {
  build: {
    /** 桌面 var_build_mode：Param=参数化生成 / Points=测点导入 */
    mode: 'param' | 'points';
    siteName: string;
    /** 桌面 var_param_shape / cells / points 四选一 */
    shape: 'rect' | 'poly' | 'cells' | 'points';
    rectL: number; rectW: number; rectCx: number; rectCy: number;
    polyText: string;
    /** 坡脚线上的圆弧段：稀疏表 JSON `[[母边序号, 弧上一点x, y], ...]`。
        顶点仍以 polyText 为唯一真源，这里只多存"哪条边是弧、鼓到哪儿"；
        加密成折线由内核做（toe_arcs.densify_arcs），前端不重复生成几何。 */
    polyArcs: string;
    cellName: string;
    cells: CellRow[];
    z0: number; height: number; slopeN: number;
    /** 逐边坡比（逐边覆盖，可选）。null = 该边用统一坡比 */
    edgeSlopes: Array<number | null>;
    layers: LayRow[];
    gridNx: number;
    interpMethod: string; idwPower: number; idwK: number;
    /** 桌面 ⑤顶面模式：Surface 顶面散点插值 / Level 水平设计标高 */
    topMode: 'surface' | 'level';
    designLevel: number;
    /** 测点路线 */
    basePtsText: string; topPtsText: string;
  };
  /** 桌面 ⑥三维显示 */
  display: {
    showBase: boolean; showTop: boolean; showContour: boolean;
    showSlip: boolean; showDanger: boolean; showExcFs: boolean; showHeat: boolean;
    floodOn: boolean; floodH: string;
    zexag: number;
    /** 查看器附加（桌面靠鼠标，Web 需要显式按钮） */
    wire: boolean; clipOn: boolean; clipFrac: number;
    /** ◧ 内核图：切到内核渲染的 matplotlib 3D PNG（严格对照桌面时用） */
    kernelImage: boolean;
  };
  calc: {
    storage: { hStart: string; hEnd: string; step: string; designLevel: string; stages: string };
    slope: { surface: 'top' | 'base'; maxDeg: string };
    section: { Ax: string; Ay: string; Bx: string; By: string; labelSlopes: boolean };
    settle: {
      hW: string; gWaste: string; gSoil: string; waterTable: string;
      gWater: string; subH: string; soils: SoilRow[];
      cv: string; hdr: string; planeOn: boolean;
    };
    stab: {
      c: string; phi: string; ru: string; gamma: string; thr: string;
      mcOn: boolean; mcCsig: string; mcPhisig: string; mcGsig: string;
      mcN: string; mcDist: string;
      nGrid: string; nR: string;
      scanDir: string; scanN: string; scanCoarse: boolean;
    };
  };
  /** 污染页：①~⑤ 走 spec（窄化后的键），⑥ 高级参数走 adv */
  poll: {
    spec: Record<string, unknown>;
    adv: Record<string, unknown>;
    /** 单元填埋年表覆盖：{单元名: [起填年, 封场年]} */
    cellSchedule: Record<string, [number, number]>;
  };
  exc: {
    /** 分级开挖坡文本 "坡高, 坡比, 马道宽" 每行一级 */
    levelsText: string;
    layers: ExcLayerRow[];
    waterLevel: string;
    gWater: string; thr: string; depth: string; nGrid: string; nR: string;
    scanOn: boolean; scanDir: string; scanN: string; scanCoarse: boolean;
    tempN: string;
    zones: ZoneRow[];
    /** 开挖分区画布上的切割线：每刀 = 两端点 [[x0,y0],[x1,y1]] */
    cuts: number[][][];
    /** 阶段选择："most" 或阶段索引字符串 */
    stage: string;
  };
}

/** 桌面初值（app.py:811-1149 / 2345-2645 / 2648-2996 / 2999-3194） */
export function defaultForm(): FormState {
  return {
    build: {
      mode: 'param',
      siteName: '',
      shape: 'rect',
      rectL: 300, rectW: 200, rectCx: 0, rectCy: 0,
      polyText: '-150,-100\n150,-100\n150,100\n-150,100\n',
      polyArcs: '',
      cellName: '单元1',
      cells: [],
      z0: 0, height: 20, slopeN: 4,
      edgeSlopes: [],
      layers: DEMO_LAYERS.map((r) => ({ ...r })),
      gridNx: 101,
      interpMethod: 'linear', idwPower: 2, idwK: 12,
      topMode: 'surface',
      designLevel: 92,
      basePtsText: '', topPtsText: '',
    },
    display: {
      showBase: true, showTop: true, showContour: true,
      showSlip: false, showDanger: false, showExcFs: false, showHeat: false,
      floodOn: false, floodH: '80',
      zexag: 1.0,
      wire: false, clipOn: false, clipFrac: 0.5,
      kernelImage: false,
    },
    calc: {
      storage: { hStart: '45', hEnd: '102', step: '1.0', designLevel: '92',
                 stages: '55.0,62.0,69.0,76.0,83.0,92.0' },
      slope: { surface: 'top', maxDeg: '18.4' },
      section: { Ax: '20', Ay: '0', Bx: '380', By: '0', labelSlopes: true },
      settle: {
        hW: '20', gWaste: '10.0', gSoil: '18.5', waterTable: '',
        gWater: '9.8', subH: '1.0',
        soils: DEMO_SOIL.map((r) => ({ ...r })),
        cv: '', hdr: '', planeOn: false,
      },
      stab: {
        c: '8', phi: '25', ru: '0.2', gamma: '10', thr: '1.3',
        mcOn: false, mcCsig: '2.0', mcPhisig: '3.0', mcGsig: '0.5',
        mcN: '1000', mcDist: 'normal',
        nGrid: '12', nR: '10',
        scanDir: 'X', scanN: '11', scanCoarse: false,
      },
    },
    poll: {
      spec: {
        // ① 填埋进度
        fill_start_year: 2005, fill_end_year: 2015, horizon_years: 50,
        ch4_fraction: 0.5, collection_eff: 0, cover_oxidation: 0.1,
        lag_years: 1, temperature_c: 30, methane_availability: 1,
        // ② 气象与覆盖（气候分区/覆盖条件取内核下发的首项，留空由 UI 补）
        annual_P_mm: '', annual_PET_mm: '',
        // ③ 垃圾体与衬垫
        field_capacity: 0.35, initial_moisture_fraction: 0.5, k_waste_ms: 1e-5,
        defect_area_m2: 0.0001,
        // ④ 污染物与二维羽流
        do_plume: false, source_conc: '', half_life_d: '',
        plume_alpha_L: 10, plume_years: 30,
        // 含水层
        aq_K: 5, aq_b: 30, water_table_depth: 5, aq_porosity: 0.3,
        aq_gradient: 0.005, aq_upstream_m: 50, aq_downstream_m: 1000,
        aq_lateral_m: 150,
        // ⑤ 结果与风险
        do_risk: true, well_on: false,
        well_distance_m: 500, well_offset_m: 0, well_depth_m: 15,
      },
      adv: {},
      cellSchedule: {},
    },
    exc: {
      levelsText: '6, 2.0, 3\n6, 2.0, 3\n5, 2.5, 0',
      layers: DEMO_EXC_LAYERS.map((r) => ({ ...r })),
      waterLevel: '',
      gWater: '9.8', thr: '1.3', depth: '', nGrid: '10', nR: '8',
      scanOn: false, scanDir: 'X', scanN: '7', scanCoarse: true,
      tempN: '2.0',
      zones: [],
      cuts: [],
      stage: 'most',
    },
  };
}

/** UI 布局状态（与表单分开：变更频率与订阅者完全不同） */
export interface UiState {
  mainTab: '建模' | '计算' | '污染' | '开挖';
  calcSub: '库容' | '坡度' | '剖面' | '沉降' | '稳定性';
  view: string;
  /** 每视图当前子键（切视图不丢） */
  sub: Record<string, string>;
  leftHidden: boolean;
  bottomHidden: boolean;
  /** 左栏/右栏宽度（桌面 PanedWindow，默认 400 / 340） */
  leftW: number;
  rightW: number;
  /** 结果条当前页签 */
  resultTab: 'table' | 'log';
  /** 三维视角 token（俯视/侧视/↺/↻ 由它驱动 KernelMeshView） */
  viewToken: { kind: 'bird' | 'top' | 'front'; token: number; dAzim?: number } | null;
  /** 污染结果时刻下拉当前值（羽流快照日 / 产气强度年；下拉按它显示选中项） */
  pollTime: number | null;
  /** 开挖分区画布用的场地轮廓（由 zones 动作回带的 outline 缓存） */
  excOutline: number[][] | null;
  /** 开挖分区画布模式（桌面 ✂ 切割中 ⇄ ⌣ 设坡比中） */
  excMode: 'cut' | 'slope';
}

export function defaultUi(): UiState {
  return {
    mainTab: '建模',
    calcSub: '库容',
    view: '3d',
    sub: {},
    leftHidden: false,
    bottomHidden: false,
    leftW: 400,
    rightW: 340,
    resultTab: 'table',
    viewToken: null,
    pollTime: null,
    excOutline: null,
    excMode: 'cut',
  };
}
