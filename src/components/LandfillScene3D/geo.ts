/**
 * 三维填埋场几何参数 + 库容估算（纯数据/计算，与 Three.js 解耦）
 * 抽离到这里是为了让 SimulatorPage/HomePage 不必拉进 498KB Three.js 即可拿到 GeoParams/estimateSite
 */

// ---------------- 几何参数（standalone 强化版：8 个可调参数 + 4 个工程尺寸覆盖） ----------------
export interface GeoParams {
  valleyWidth: number;      // 谷底宽度缩放
  pileHeight: number;       // 堆高/层数缩放
  pondVolume: number;       // 调节池容积缩放
  gasWellSpacing: number;   // 导气井间距缩放
  damHeight: number;        // 垃圾坝高缩放
  treeDensity: number;      // 植被/绿化密度缩放
  vehicleCount: number;     // 作业车辆数量（0-8）
  volumeScale: number;      // 库容标定缩放（默认≈500 万 m³）
  // v5.1 工程尺寸（m/°）—— 可选，填了就优先于上面抽象缩放系数（仅堆体本体）
  siteLengthM?: number;     // 场地底长 L (m)，如 300
  siteWidthM?: number;      // 场地底宽 W (m)，如 200
  pileHeightM?: number;     // 堆体高度 H (m)，如 25
  slopeAngleDeg?: number;   // 边坡角 β (°)，如 26.6（=1:2），默认 18.4（=1:3）
}

/** 是否启用了工程尺寸（填了长/宽/高即视为"以实际尺寸建模"） */
export function hasEngDims(geo: Partial<GeoParams> | undefined): boolean {
  const g = geo ?? {};
  return typeof g.pileHeightM === 'number' && typeof g.siteLengthM === 'number' && typeof g.siteWidthM === 'number';
}

export type SceneQuality = 'auto' | 'low' | 'medium' | 'high';

export const DEFAULT_GEO: GeoParams = {
  valleyWidth: 1,
  pileHeight: 1,
  pondVolume: 1,
  gasWellSpacing: 1,
  damHeight: 1,
  treeDensity: 1,
  vehicleCount: 4,
  volumeScale: 1,
};

export const GEO_PRESETS: { key: string; label: string; geo: Partial<GeoParams> }[] = [
  { key: 'default', label: '默认 · 500万m³', geo: { ...DEFAULT_GEO } },
  { key: 'small', label: '小型场', geo: { volumeScale: 0.3, pileHeight: 0.7, valleyWidth: 0.72, pondVolume: 0.55, vehicleCount: 2 } },
  { key: 'large', label: '大型场', geo: { volumeScale: 1.6, pileHeight: 1.3, valleyWidth: 1.2, pondVolume: 1.7, vehicleCount: 6 } },
];

export function clampGeo(geo: GeoParams): GeoParams {
  const c = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  // 先展开原对象保留可选的工程尺寸字段（siteLengthM 等），再钳制 8 个缩放系数。
  // v5.1：收紧缩小下限（堆高≥0.75、谷宽≥0.75、库容≥0.5）——缩小倍率过高时
  // 薄层间距（0.07~0.55）接近深度精度极限会引发 z-fighting 闪烁。
  return {
    ...geo,
    valleyWidth: c(geo.valleyWidth, 0.75, 1.6),
    pileHeight: c(geo.pileHeight, 0.75, 1.8),
    pondVolume: c(geo.pondVolume, 0.4, 2.2),
    gasWellSpacing: c(geo.gasWellSpacing, 0.6, 1.5),
    damHeight: c(geo.damHeight, 0.5, 2.0),
    treeDensity: c(geo.treeDensity, 0.4, 1.6),
    vehicleCount: c(geo.vehicleCount, 0, 8),
    volumeScale: c(geo.volumeScale, 0.5, 2.2),
  };
}

// ---------------- 库容/占地估算（纯数值积分，不依赖 Three.js） ----------------
export interface SiteEstimate {
  volumeWanM3: string;
  areaHm2: string;
  desc: string;
}

/**
 * 估算库容 + 占地。完整计算依赖 LandfillScene3D 模块内的几何函数（liftN 等）；
 * 在 geo.ts 里只暴露"快照式"估算（基于默认几何 + 用户缩放系数的解析式近似），足以满足导出快照/表单展示。
 * 若需精确估算，应从 LandfillScene3D 内部调 estimateSite（同步读 CUR 状态）。
 */
export function estimateSite(geo: Partial<GeoParams> | undefined): SiteEstimate {
  const g = clampGeo({ ...DEFAULT_GEO, ...(geo ?? {}) });

  // ---- v5.1 工程尺寸模式：L×W×H×边坡角 → 截锥台（棱台）体积，真实库容 ----
  if (hasEngDims(g)) {
    const L = g.siteLengthM!;
    const W = g.siteWidthM!;
    const H = Math.max(1, Math.min(g.pileHeightM!, Math.min(L, W) * 0.35)); // 防"高宽比"崩坏
    const cot = g.slopeAngleDeg ? 1 / Math.tan((g.slopeAngleDeg * Math.PI) / 180) : 3; // 默认 1:3
    // 坡顶半宽不能为负：H·cot ≤ 底半宽 - 1
    const hMaxL = Math.max(0, L / 2 - 2) / cot;
    const hMaxW = Math.max(0, W / 2 - 2) / cot;
    const hEff = Math.min(H, hMaxL, hMaxW);
    const topL = Math.max(0, L - 2 * hEff * cot);
    const topW = Math.max(0, W - 2 * hEff * cot);
    const A_bot = L * W;
    const A_top = topL * topW;
    // 棱台体积 V = h/3·(A1 + A2 + √(A1·A2))
    const volM3 = (hEff / 3) * (A_bot + A_top + Math.sqrt(A_bot * A_top));
    const volWan = volM3 / 1e4;
    const areaHm2 = A_bot / 1e4;
    const desc =
      '类型：山谷型生活垃圾卫生填埋场（工程尺寸自定义）\n' +
      `场底：长 ${L.toFixed(0)} m × 宽 ${W.toFixed(0)} m\n` +
      `堆体高度：${H.toFixed(1)} m（棱台估算，边坡 ${g.slopeAngleDeg?.toFixed(1) ?? '18.4'}°，≈1:${(1 / Math.tan(((g.slopeAngleDeg ?? 18.4) * Math.PI) / 180)).toFixed(1)}）\n` +
      `设计库容：约 ${volWan.toFixed(0)} 万 m³（按棱台体积 ${
        hEff < H ? `，高度受边坡约束取 ${hEff.toFixed(1)}m` : ''
      }）\n` +
      `占地：约 ${areaHm2.toFixed(1)} hm²\n` +
      `（坡顶尺寸 ${topL.toFixed(0)} m × ${topW.toFixed(0)} m；3D 模型按真实尺寸比例绘制）`;
    return { volumeWanM3: volWan.toFixed(0), areaHm2: areaHm2.toFixed(1), desc };
  }

  // ---- 缩放系数模式（默认）----
  // 库容标定（v4.5 修正）：默认几何（谷宽 1×、堆高 1×、volumeScale 1.0）≈ 500 万 m³ 设计库容，
  // 与 scene-builder 解析器基准（volWan / 500 → volumeScale）完全一致。
  // 库容随谷底面积（谷宽²）× 堆高 × 库容系数实时联动：调整模型即见库容变化（物理口径）。
  const baseVolWan = 500;
  const baseAreaHm2 = 2.9;
  const volWan = baseVolWan * g.valleyWidth * g.valleyWidth * g.pileHeight * g.volumeScale;
  const areaHm2 = baseAreaHm2 * g.valleyWidth * g.valleyWidth;
  const desc =
    '类型：山谷型生活垃圾卫生填埋场（参数化缩放）\n' +
    `设计库容：约 ${volWan.toFixed(0)} 万 m³（库容系数 ${g.volumeScale.toFixed(2)} ×）\n` +
    `占地：约 ${areaHm2.toFixed(1)} hm²\n` +
    `谷宽缩放：${g.valleyWidth.toFixed(2)} ×，堆高缩放：${g.pileHeight.toFixed(2)} ×\n` +
    `坝高缩放：${g.damHeight.toFixed(2)} ×，井距缩放：${g.gasWellSpacing.toFixed(2)} ×\n` +
    `池容缩放：${g.pondVolume.toFixed(2)} ×，车辆：${g.vehicleCount} 台\n` +
    '（库容为设计值，随谷宽²×堆高×库容系数联动；3D 示意模型按比例缩放）';
  return { volumeWanM3: volWan.toFixed(0), areaHm2: areaHm2.toFixed(1), desc };
}

// ---------------- LandfillApi 接口（与组件同模块导出，便于导入） ----------------
export interface LandfillApi {
  setLayerVisible(layer: string, visible: boolean): void;
  setTransparent(on: boolean): void;
  applyClip(on: boolean, axis: 'x' | 'z', pos: number): void;
  view(name: 'bird' | 'dam' | 'top' | 'sec'): void;
  startRoaming(): void;
  stopRoaming(): void;
  capturePng(): string | null;
  /** 稳定化计算联动：把 OGS 场景结果（gas-production / settlement）注入场景 */
  applyOgsResult(scenario: string, series: Array<{ varName?: string; points: { t: number; v: number }[] }>): void;
}

// ============ 跨页信令：AI 生成的 3D 场景（scene-built 一次性信封） ============
//   v5.3 起**无消费者**：原本由 ChatPage 写入、/scene-classic（SimulatorPage）消费，
//   而后者已随两个 3D 入口合并而删除。保留读写函数是因为 HomePage 仍在用
//   LandfillScene3D 本体，将来若要做"AI 场景 → 场景页"的入口不必重写。
//   数据形状：{ geo, preset, snapshot, ogSummary?, navigateTo }（由 server/scene-builder 产出）
export const SCENE_BUILT_KEY = 'scene-built-v1';

export function writeSceneBuilt(payload: unknown): void {
  try { sessionStorage.setItem(SCENE_BUILT_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
}

export function readSceneBuilt<T = unknown>(): T | null {
  try {
    const raw = sessionStorage.getItem(SCENE_BUILT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SCENE_BUILT_KEY); // 读一次即消费
    return JSON.parse(raw) as T;
  } catch { return null; }
}
