/**
 * 三维填埋场几何参数 + 库容估算（纯数据/计算，与 Three.js 解耦）
 * 抽离到这里是为了让 SimulatorPage/HomePage 不必拉进 498KB Three.js 即可拿到 GeoParams/estimateSite
 */

// ---------------- 几何参数（standalone 强化版：8 个可调参数） ----------------
export interface GeoParams {
  valleyWidth: number;      // 谷底宽度缩放
  pileHeight: number;       // 堆高/层数缩放
  pondVolume: number;       // 调节池容积缩放
  gasWellSpacing: number;   // 导气井间距缩放
  damHeight: number;        // 垃圾坝高缩放
  treeDensity: number;      // 植被/绿化密度缩放
  vehicleCount: number;     // 作业车辆数量（0-8）
  volumeScale: number;      // 库容标定缩放（默认≈500 万 m³）
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
  return {
    valleyWidth: c(geo.valleyWidth, 0.6, 1.6),
    pileHeight: c(geo.pileHeight, 0.5, 1.8),
    pondVolume: c(geo.pondVolume, 0.4, 2.2),
    gasWellSpacing: c(geo.gasWellSpacing, 0.6, 1.5),
    damHeight: c(geo.damHeight, 0.5, 2.0),
    treeDensity: c(geo.treeDensity, 0.4, 1.6),
    vehicleCount: c(geo.vehicleCount, 0, 8),
    volumeScale: c(geo.volumeScale, 0.2, 2.2),
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

// ============ 跨页信令：AI 生成的 3D 场景（scene-built，仿 scene-ogs 一次性信封） ============
//   ChatPage 收到 buildScene 工具回执后写入，SimulatorPage 挂载时消费一次即移除。
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
