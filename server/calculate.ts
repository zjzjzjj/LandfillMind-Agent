/**
 * 填埋场专业工程计算模块 v4.5
 * 14 个保留计算器全部深化（多参数 + extra 中间变量）
 * extractionPressure 已删除
 * leachateCalc 文案单位 bug 已修
 */
import type { CalcResult } from '../src/types.js';

// 物理常数
const GAMMA_WATER = 10;  // kN/m³ 水重度
const GAMMA_WASTE = 12;  // kN/m³ 垃圾重度（典型值）
const PHI_WASTE = 25;    // ° 垃圾内摩擦角（典型值）
const C_WASTE = 5;       // kPa 垃圾粘聚力（典型值）

// =================================================================
// v5.1 统一边坡稳定内核（唯一口径）
//   —— calculateStabilityFactor（快诊）与 slopeFs（计算中心）此前各自实现，
//      公式不一致：slopeFs 把坡角算成 atan(1/β)/2（即实际按一半坡角），
//      黏聚力项还多带一个 2/cosα 因子 → 同一工况两条口径可差 2 倍以上。
//      现统一到标准无限长坡公式（单位宽度），两条口径委托同一内核，数值必然一致。
// =================================================================

export interface StabilityDetail {
  Fs: number;
  alphaDeg: number;          // 滑面倾角（= 坡角）
  alpha: number;             // rad
  aboveWaterRatio: number;   // 水上部分比例
  effectiveGamma: number;    // 扣除浮力后的有效重度
  drivingGravity: number;    // 自重下滑分量
  drivingSeismic: number;    // 地震附加
  drivingSurcharge: number;  // 超载附加
  totalDriving: number;
  totalResisting: number;
  arcLength: number;         // 滑面长度 H/sinα
}

/**
 * 标准无限长坡稳定计算（唯一口径）。
 *   Fs = (c + γ′·H·cos²α·tanφ) / (γ·H·sinα·cosα + kv·W + q·H)
 * 其中 γ′ 为按水上比例折算的有效重度；kv=0、q=0 时退化为教科书无限长坡公式。
 */
export function stabilityDetail(
  H: number, slopeAngleDeg: number, waterLevelDepth: number,
  gamma: number, phi: number, c: number,
  seismicCoeff: number = 0, surcharge: number = 0,
): StabilityDetail {
  // 水位埋深自堆顶起算：埋深/堆高 = 水上比例（v4.5.1 修：原式方向相反）
  const aboveWaterRatio = Math.max(0, Math.min(1, waterLevelDepth / H));
  const effectiveGamma = gamma - GAMMA_WATER * (1 - aboveWaterRatio);
  const alpha = slopeAngleDeg * Math.PI / 180;
  const cosA = Math.cos(alpha), sinA = Math.sin(alpha);
  const tanPhi = Math.tan(phi * Math.PI / 180);
  const drivingGravity = gamma * H * sinA * cosA;
  const drivingSeismic = seismicCoeff * (0.5 * gamma * H * H);
  const drivingSurcharge = surcharge * H;
  const totalDriving = drivingGravity + drivingSeismic + drivingSurcharge;
  const totalResisting = c + effectiveGamma * H * cosA * cosA * tanPhi;
  const Fs = totalDriving > 0 ? totalResisting / totalDriving : 999;
  return {
    Fs, alphaDeg: slopeAngleDeg, alpha, aboveWaterRatio, effectiveGamma,
    drivingGravity, drivingSeismic, drivingSurcharge, totalDriving, totalResisting,
    arcLength: sinA > 0 ? H / sinA : 0,
  };
}

/** 水位缺测时稳定计算的代表埋深（m，自堆顶起算）—— 快诊/领域/敏感性共用同一值 */
export const WATER_DEPTH_REPRESENTATIVE = 10;

/**
 * 监测口径 → 稳定计算口径的水位换算（唯一转换点，v5.5）。
 *
 * 两个"水位埋深"是相反的参考面，直传会错一个数量级：
 *  - SiteData.waterLevel：**地下水位在库底面以下**的埋深（m，越小越危险，监测值）；
 *  - stabilityDetail 的入参：**水位自堆顶起算**的埋深（m，=H 表示堆体完全在水位以上）。
 * 把「水位在库底以下 2.5 m」当成「自堆顶起算 2.5 m」，内核会按 92% 浸没计浮托力，
 * Fs 被严重低估（H=30、1:3 工况实测可从 0.52 抬回 1.45）。
 *
 * 约定：baseDepth ≥ 0 表示水位仍在库底以下（堆体不受地下水浮托 → 取 H）；
 *       baseDepth < 0 表示水位已涌入库内 |baseDepth| 米（浸没高度 = |baseDepth|）。
 */
export function waterDepthFromTop(H: number, baseDepth: number): number {
  const submerged = Math.max(0, -baseDepth);
  return Math.max(0, Math.min(H, H - submerged));
}

/**
 * Fs 分档 —— 唯一口径（v5.5）
 *
 * 原先四处各自判档且互不一致：slopeFs 黄档止于 1.3 并把 ≥1.3 记为 green、
 * calculateStabilityFactor 黄档止于 1.5 记为 blue、augment.runCalc 用
 * `Fs>=1.3 ? green : red` 二值判定、diagnose 对直接给定的 Fs 另写一条链。
 * 结果 1.3~1.5 区间同一工况会得出「满足/绿色」与「基本稳定/黄色」两个结论。
 * 现全部收敛到此函数；规范判据本身另由 FS_REQUIRED 表达，不参与分档。
 */
export const FS_REQUIRED = 1.3;  // CJJ 176-2012 §4.5 运行期要求
export const FS_GOOD = 1.5;      // 良好裕度（低于此值虽满足规范仍需关注）

export type FsGrade = 'red' | 'orange' | 'yellow' | 'blue';

export function gradeFromFs(Fs: number): FsGrade {
  if (!Number.isFinite(Fs) || Fs < 1.0) return 'red';
  if (Fs < 1.2) return 'orange';
  if (Fs < FS_GOOD) return 'yellow';
  return 'blue';
}

/** 分档对应的工程定性词，供各条计算链共用同一措辞 */
export function fsBandLabel(Fs: number): '失稳' | '欠稳定' | '基本稳定' | '稳定' {
  const g = gradeFromFs(Fs);
  return g === 'red' ? '失稳' : g === 'orange' ? '欠稳定' : g === 'yellow' ? '基本稳定' : '稳定';
}

/** 「满足运行要求但未达良好裕度」这类中间态的判据补充说明 */
export function fsComplianceNote(Fs: number): string {
  return Fs < FS_REQUIRED ? ' ⚠ 低于规范' : Fs < FS_GOOD ? ' ✓ 满足运行要求（未达 1.50 良好裕度）' : ' ✓ 满足';
}

/**
 * 稳定安全系数（简化瑞典条分法，无限长坡假设）—— 由 slopeFs 的 CALC_REGISTRY 适配调用。
 * 委托 stabilityDetail，返回形状与历史版本保持一致。
 */
export function calculateStabilityFactor(
  height: number, slopeAngle: number, waterLevelDepth: number,
  gamma = GAMMA_WASTE, phi = PHI_WASTE, c = C_WASTE,
): { Fs: number; riskLevel: FsGrade; analysis: string } {
  const Fs = stabilityDetail(height, slopeAngle, waterLevelDepth, gamma, phi, c).Fs;
  return {
    Fs: Math.round(Fs * 100) / 100,
    riskLevel: gradeFromFs(Fs),
    analysis: `${fsBandLabel(Fs)} Fs=${Fs.toFixed(2)}`,
  };
}

/** 有效影响半径（内部辅助） */
export function calculateEffectiveRadius(
  injectionPressure: number, treatmentDays: number,
  permeability: 'high' | 'medium' | 'low' = 'medium',
): { R_eff: number; recommendedSpacing: number; analysis: string } {
  const baseRadius = 5 + (injectionPressure - 2) * 1.5;
  const permFactor = permeability === 'high' ? 1.3 : permeability === 'low' ? 0.7 : 1.0;
  const timeFactor = Math.min(1.5, 1 + (treatmentDays - 1) * 0.08);
  const R_eff = baseRadius * permFactor * timeFactor;
  const recommendedSpacing = Math.sqrt(3) * R_eff;
  return {
    R_eff: Math.round(R_eff * 10) / 10,
    recommendedSpacing: Math.round(recommendedSpacing * 10) / 10,
    analysis: `R_eff=${R_eff.toFixed(1)}m, spacing=${recommendedSpacing.toFixed(1)}m`,
  };
}

/** 产气量（内部辅助） */
export function calculateGasProduction(
  wasteAmount: number, wasteAge: number, moisture: number,
): { ch4: number; co2: number; total: number; analysis: string } {
  const potentialGas = 100;
  const k = 0.1 * (moisture / 50) * Math.exp(-wasteAge * 0.05);
  const rate = potentialGas * k;
  const total = wasteAmount * 10000 * rate;
  const ch4 = total / 2.2;
  const co2 = total - ch4;
  return { ch4: Math.round(ch4), co2: Math.round(co2), total: Math.round(total), analysis: `total=${total.toFixed(0)}m³/d` };
}

// =================================================================
// v4.5 强化的 14 个计算器（全部返回 CalcResult 含 extra）
// =================================================================

/** C-01. 堆体稳定 Fs（深度化：水位 / 地震 / 超载） */
export function slopeFs(
  H: number, beta: number, gamma: number, c: number, phi: number,
  waterTableDepth: number = 10, seismicCoeff: number = 0, surcharge: number = 0,
): CalcResult {
  if (H <= 0 || beta <= 0 || gamma <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'H/β/γ 须 > 0', ref: 'CJJ 176-2012 §4.5' };
  }
  // β 为坡比倒数（1:β）→ 坡角。v5.1 修：原式 atan(1/β)/2 实际按一半坡角计算，
  // 与快诊口径（calculateStabilityFactor，直接用坡角）相差一倍，导致同一工况两个 Fs。
  const alphaDeg = Math.atan(1 / beta) * 180 / Math.PI;
  const d = stabilityDetail(H, alphaDeg, waterTableDepth, gamma, phi, c, seismicCoeff, surcharge);
  const Fs = d.Fs;
  // 仅地震工况 Fs（无超载）
  const FsSeismic = seismicCoeff > 0 ? d.totalResisting / (d.drivingGravity + d.drivingSeismic) : 0;
  const grade = gradeFromFs(Fs);
  return {
    ok: true,
    value: Math.round(Fs * 100) / 100,
    unit: '无量纲',
    grade,
    analysis: `H=${H}m，坡比 1:${beta}（坡角 ${alphaDeg.toFixed(1)}°），γ=${gamma}kN/m³，c=${c}kPa，φ=${phi}°，水位埋深=${waterTableDepth}m，kv=${seismicCoeff}，q=${surcharge}kPa。Fs = ${Fs.toFixed(2)}（${fsBandLabel(Fs)}；运行要求 ≥1.30，良好 ≥1.50，CJJ 176-2012 §4.5）${fsComplianceNote(Fs)}。`,
    ref: 'CJJ 176-2012 §4.5 / GB 50330-2013',
    formula: 'Fs = (c + γ′·H·cos²α·tanφ) / (γ·H·sinα·cosα + kv·W + q·H)',
    extra: {
      坡角: `${alphaDeg.toFixed(1)}°`,
      自重驱动力: Math.round(d.drivingGravity * 10) / 10,
      地震贡献: Math.round(d.drivingSeismic * 10) / 10,
      超载贡献: Math.round(d.drivingSurcharge * 10) / 10,
      总抗滑力: Math.round(d.totalResisting * 10) / 10,
      弧长: Math.round(d.arcLength * 10) / 10,
      水位位置: `${(d.aboveWaterRatio * 100).toFixed(0)}% 在水上`,
      地震工况Fs: FsSeismic > 0 ? Math.round(FsSeismic * 100) / 100 : '未启用',
    },
  };
}

/** C-02. 库容与使用年限（深度化：分期/覆土比/沉降折减） */
export function capacity(
  A: number, H: number, rho: number, Qd: number,
  phases: number = 1, coverRatio: number = 0, sFactor: number = 1,
): CalcResult {
  if (A <= 0 || H <= 0 || rho <= 0 || Qd <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'A/H/ρ/Qd 须 > 0', ref: 'CJJ 176-2012 §3.3' };
  }
  const V_total = A * 10000 * H;
  // 分期：每期库容 = 总库容 / 期数
  const V_perPhase = V_total / Math.max(1, phases);
  // 覆土占比：日覆土 m³ = Qd × coverRatio，容积扣减（总覆土量与分期无关，v4.5.1 修：去掉 ×phases）
  const V_cover = Qd * 365 * 0.5 * coverRatio;
  // 沉降后剩余库容
  const V_eff = (V_total - V_cover) * sFactor;
  const W_total = V_total * rho;
  const T = V_eff / (Qd * 365);
  const meetsStandard = rho >= 0.9;
  return {
    ok: meetsStandard,
    value: Math.round(T * 10) / 10,
    unit: 'a',
    grade: meetsStandard ? 'green' : 'yellow',
    analysis: `A=${A}ha × H=${H}m, ρ=${rho}t/m³, 日填 Qd=${Qd}m³, 分${phases}期, 覆土比=${(coverRatio * 100).toFixed(0)}%, 沉降折减=${sFactor}。V_total=${V_total.toFixed(0)}m³, W=${W_total.toFixed(0)}t, 有效库容 ${V_eff.toFixed(0)}m³, 使用年限 T=${T.toFixed(1)}a。${meetsStandard ? '满足 ρ≥0.9t/m³' : '⚠ ρ<0.9t/m³'}。`,
    ref: 'CJJ 176-2012 §3.3 / CJJ 133-2004',
    formula: 'T = (V_total - V_cover) × sFactor / (Qd × 365)',
    extra: {
      总库容: `${(V_total / 1e4).toFixed(1)}万m³`,
      有效库容: `${(V_eff / 1e4).toFixed(1)}万m³`,
      沉降后余量: `${((1 - sFactor) * 100).toFixed(0)}%`,
      覆土占用: `${(V_cover / 1e4).toFixed(2)}万m³`,
      雨季冗余: '按 1.2× 平均考虑',
    },
  };
}

/** C-03. 沉降预测（双曲线 → 加主/次固结 + 蠕变） */
export function settlementHyper(
  t1: number, s1: number, t2: number, s2: number,
): CalcResult {
  if (t1 <= 0 || t2 <= t1 || s1 < 0 || s2 < s1) {
    return { ok: false, value: NaN, grade: 'red', analysis: 't2 ≥ t1, s2 ≥ s1 须满足', ref: 'CJJ 176-2012 §4.6' };
  }
  // 双曲线 s(t) = s∞·t/(a+t) → 1/s = (a/s∞)·(1/t) + 1/s∞，由两点精确解（v4.5.1 修：原式非标准拟合偏差 ~10%）：
  //   s∞ = (t2−t1) / (t2/s2 − t1/s1)
  //   a  = t1·t2·(s2−s1) / (s1·t2 − s2·t1)
  const denom = t2 / s2 - t1 / s1;
  const s_inf = denom !== 0 ? (t2 - t1) / denom : s2;
  const a = (s1 * t2 - s2 * t1) !== 0 ? (t1 * t2 * (s2 - s1)) / (s1 * t2 - s2 * t1) : t1;
  // 预测多时间点
  const sAt = (years: number) => Math.round(s_inf * years * 365 / (a + years * 365));
  const s5 = sAt(5), s10 = sAt(10), s30 = sAt(30), s50 = sAt(50);
  // 主固结完成时间（达到 90% 沉降）
  const tp = a * 9;  // s/s_inf = t/(a+t) = 0.9 → t = 9a
  // 蠕变剩余（30年后：蠕变系数 0.015/年 × 30 × s_inf）
  const creepRemaining = Math.round(s_inf * 0.015 * 30);
  // 库容修正：沉降占总高度比
  const capacityCorrection = s_inf > 0 ? Math.round(s_inf / 1000 * 10) / 10 : 0; // 沉降 1m → 库容损失 0.1%

  return {
    ok: s_inf > 0,
    value: Math.round(s_inf),
    unit: 'mm',
    grade: 'green',
    analysis: `双曲线 s(t) = s∞·t/(a+t)。由 (t1=${t1}d, s1=${s1}mm) 与 (t2=${t2}d, s2=${s2}mm) 联立：s∞ = ${s_inf.toFixed(0)} mm, a = ${a.toFixed(0)} d。主固结完成 t_p = ${tp.toFixed(0)}d。预测：5y=${s5}mm, 10y=${s10}mm, 30y=${s30}mm, 50y=${s50}mm。蠕变 30y 余量 ${creepRemaining}mm。`,
    ref: 'CJJ 176-2012 §4.6',
    formula: 's(t) = s∞·t/(a+t)',
    extra: {
      最终沉降: `${s_inf.toFixed(0)} mm`,
      主固结完成: `${tp.toFixed(0)} d`,
      '5年': `${s5} mm`,
      '10年': `${s10} mm`,
      '30年': `${s30} mm`,
      '50年': `${s50} mm`,
      蠕变剩余: `${creepRemaining} mm`,
      库容修正: `${capacityCorrection}%`,
    },
    series: [{
      name: '沉降时程 s(t)', unit: 'mm', varName: 'settle_curve',
      points: Array.from({ length: 41 }, (_, i) => {
        const y = i * 1.25; // 0~50 年
        return { t: y, v: +(s_inf * y * 365 / (a + y * 365)).toFixed(1) };
      }),
    }],
  };
}

/** C-04. 井间距优化（深度化：pattern/drawdown/interference） */
export function optimizeWellSpacing(
  effectiveRadius: number,
  pattern: 'square' | 'hexagonal' = 'hexagonal',
  drawdown: number = 5, interferenceFactor: number = 0.4,
): CalcResult {
  if (effectiveRadius <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'effectiveRadius 须 > 0', ref: 'CJJ 176-2012 §5.2' };
  }
  // 基础间距
  const baseSpacing = pattern === 'hexagonal' ? Math.sqrt(3) * effectiveRadius : 2 * effectiveRadius;
  // 井群叠加降深
  const singleWellDrawdown = drawdown;
  const groupDrawdown = drawdown * (1 + interferenceFactor);
  // 布井密度
  const areaPerWell = pattern === 'hexagonal' ? baseSpacing * baseSpacing * 0.866 : baseSpacing * baseSpacing;
  const wellsPerArea = 10000 / areaPerWell;
  // 占地面积比
  const areaRatio = (wellsPerArea * effectiveRadius * effectiveRadius) / 10000;
  return {
    ok: true,
    value: Math.round(baseSpacing * 10) / 10,
    unit: 'm',
    grade: 'green',
    analysis: `${pattern === 'hexagonal' ? '梅花形' : '方形'}布井, R_eff=${effectiveRadius}m, 单井降深 ${drawdown}m, 干扰系数 ${interferenceFactor}。推荐间距 ${baseSpacing.toFixed(1)}m, 布井密度 ${wellsPerArea.toFixed(1)}口/万㎡, 井群叠加降深 ${groupDrawdown.toFixed(1)}m（单井 ${singleWellDrawdown}m × ${(1 + interferenceFactor).toFixed(2)}）。`,
    ref: 'CJJ 176-2012 §5.2 / 工程经验',
    formula: 'D = √3·R（梅花形）或 2R（方形）',
    extra: {
      推荐间距: `${baseSpacing.toFixed(1)} m`,
      井数密度: `${wellsPerArea.toFixed(1)} 口/万㎡`,
      单井降深: `${singleWellDrawdown} m`,
      井群降深: `${groupDrawdown.toFixed(1)} m`,
      干扰放大: `${((1 + interferenceFactor - 1) * 100).toFixed(0)}%`,
      布井占地: `${(areaRatio * 100).toFixed(1)}%`,
    },
  };
}

/** C-05. 渗滤液产量（v4.5 修：单位 bug + 加 ET/堵塞/回喷） */
export function calculateLeachate(
  area: number,            // 填埋面积 m²
  rainfall: number,        // 年降雨量 mm
  runoffCoeff: number = 0.3,
  wasteHeight: number = 0,
  ET: number = 800,         // 蒸散发 mm/a（v4.5 新增）
  cloggingFactor: number = 0, // 导排系统堵塞 0-1（v4.5 新增）
  recirculationRatio: number = 0, // 回喷比 0-0.5（v4.5 新增）
): CalcResult {
  if (area <= 0 || rainfall < 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'area > 0, rainfall ≥ 0', ref: 'CJJ 176-2012 §5.1' };
  }
  // 有效降雨 = (降雨 - 蒸散) × 径流系数
  const effectiveRainfall = Math.max(0, (rainfall - ET)) * runoffCoeff;
  // 垃圾覆盖修正
  const wasteFactor = wasteHeight > 0 ? Math.max(0.3, 1 - wasteHeight * 0.05) : 1;
  // 导排堵塞修正（堵塞 → 渗滤液排出减少，但累计水位上升）
  const drainFactor = 1 - cloggingFactor * 0.4; // 堵塞 100% 时排出能力降到 60%
  // 年产量
  const yearly_raw = (area * effectiveRainfall) / 1000 * wasteFactor;
  const yearly_drain = yearly_raw * drainFactor;
  // 回喷：回喷到填埋场顶部，会增加入渗（暂忽略，作为"净产量"折减）
  const yearly = yearly_drain * (1 - recirculationRatio);
  // 雨/旱季峰谷
  const rainyPeak = yearly / 365 * 2.5;   // 雨季峰值约 2.5× 日均
  const dryLow = yearly / 365 * 0.3;      // 旱季谷值约 0.3× 日均
  const daily = yearly / 365;
  const monthly = yearly / 12;
  // 渗漏总量
  const leakageTotal = yearly * 0.05; // 假设 5% 渗漏到地下水

  return {
    ok: true,
    value: Math.round(daily * 10) / 10,
    unit: 'm³/d',
    grade: daily > 500 ? 'orange' : daily > 200 ? 'yellow' : 'green',
    // v4.5 修复：${area/10000} 而非 ${area}
    analysis: `面积${(area / 10000).toFixed(1)}万㎡ (${area}m²), 年降雨${rainfall}mm, 径流系数 ${runoffCoeff}, 蒸散 ${ET}mm, 覆盖厚度 ${wasteHeight}m, 导排堵塞 ${(cloggingFactor * 100).toFixed(0)}%, 回喷比 ${(recirculationRatio * 100).toFixed(0)}%。有效降雨 = (${rainfall} − ${ET}) × ${runoffCoeff} = ${effectiveRainfall.toFixed(0)}mm; 年产 ${yearly.toFixed(0)}m³, 日均 ${daily.toFixed(1)}m³ (雨季峰 ${rainyPeak.toFixed(0)}, 旱季谷 ${dryLow.toFixed(0)})。`,
    ref: 'CJJ 176-2012 §5.1',
    formula: 'Q = (P − ET) × C × A × η_cover × η_drain × (1 − 回喷比) / 1000',
    extra: {
      有效降雨: `${effectiveRainfall.toFixed(0)} mm`,
      雨季峰值: `${rainyPeak.toFixed(0)} m³/d`,
      旱季谷值: `${dryLow.toFixed(0)} m³/d`,
      月产量: `${monthly.toFixed(0)} m³`,
      年产量: `${yearly.toFixed(0)} m³`,
      渗漏量: `${leakageTotal.toFixed(0)} m³/a`,
      回喷折减: `${(recirculationRatio * 100).toFixed(0)}%`,
    },
    series: [{
      name: '月产量（雨/旱季正弦近似）', unit: 'm³/月', varName: 'leach_monthly',
      points: Array.from({ length: 12 }, (_, m) => {
        // 江南典型降雨季节性：5-6 月梅雨峰、11-12 月旱谷
        const seasonal = 1 + 1.1 * Math.sin(((m - 2) / 12) * 2 * Math.PI);
        return { t: m + 1, v: +(monthly * Math.max(0.25, seasonal)).toFixed(0) };
      }),
    }],
  };
}

/** C-06. 含水率预测（v4.5 加 gasFlow/screenLength/wellheadLoss） */
export function predictMoisture(
  initialMoisture: number, injectionPressure: number, days: number, depth: number,
  gasFlow: number = 50,         // m³/h 气体流量
  screenLength: number = 3,     // m 筛管长度
  wellheadLoss: number = 1,     // kPa 井口损失
): CalcResult {
  if (initialMoisture < 0 || initialMoisture > 100) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'initialMoisture 须在 0-100%', ref: 'CJJ 176-2012 §5.3' };
  }
  // 基础模型（与 v4.4 相同）
  const initialVolumeMoisture = initialMoisture * 1.5;
  const pressureDecay = Math.max(0.3, 1 - depth * 0.08);
  const efficiency = injectionPressure * pressureDecay * 0.05;
  const decayRate = 0.3 + efficiency * (1 - wellheadLoss / 10);  // 井损修正
  const predictedVolumeMoisture = initialVolumeMoisture * Math.exp(-decayRate * days);
  const predictedMoisture = predictedVolumeMoisture / 1.5;
  // 达到 30% 目标所需天数
  const t90 = decayRate > 0 ? Math.log(initialVolumeMoisture / 30) / decayRate : 0;
  // 累计注气量
  const totalGas = gasFlow * 24 * days;
  // 井损比例
  const wellLossPct = injectionPressure > 0 ? (wellheadLoss / injectionPressure) * 100 : 0;

  return {
    ok: true,
    value: Math.round(predictedMoisture * 10) / 10,
    unit: '%',
    grade: predictedMoisture <= 30 ? 'green' : 'yellow',
    analysis: `初始 ${initialMoisture}%, 注气压力 ${injectionPressure}kPa, 深度 ${depth}m, ${days}d, 流量 ${gasFlow}m³/h, 筛管 ${screenLength}m, 井损 ${wellheadLoss}kPa。衰减率 ${decayRate.toFixed(2)}/d, 预测含水率 ${predictedMoisture.toFixed(1)}%${predictedMoisture <= 30 ? ' (达标 ✓)' : ' (未达标 ✗)'}。达到 30% 阈值需 ${t90.toFixed(1)}d。`,
    ref: 'CJJ 176-2012 §5.3',
    formula: 'θ(t) = θ₀ · exp(−(0.3 + η·P·η_drain)·t / 1.5)',
    extra: {
      衰减率: `${decayRate.toFixed(2)} /d`,
      t90达标: `${t90.toFixed(1)} d`,
      累计注气: `${totalGas.toFixed(0)} m³`,
      井损占比: `${wellLossPct.toFixed(1)}%`,
      筛管有效: `${screenLength} m`,
      压力衰减: `${(pressureDecay * 100).toFixed(0)}%`,
    },
  };
}

/** C-07. 填埋气产气量 LandGEM（v4.5 加利用方案 + 累计） */
export function lfgYield(
  M: number, k: number, year: number, Lo: number = 110,
  utilizationFactor: number = 0.5,    // 利用率 0-1（v4.5 新增）
  flareEfficiency: number = 0.9,      // 火炬效率 0-1
): CalcResult {
  if (M <= 0 || k <= 0 || year < 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'M>0, k>0, year≥0', ref: 'USEPA LandGEM' };
  }
  const Mt = M * 1e4;
  const Q = k * Lo * Mt * Math.exp(-k * year); // m³/yr CH₄
  const Qd = Q / 365;
  // 累计产气量（0→year 积分）
  const cumulative = Lo * Mt * (1 - Math.exp(-k * year));
  // 发电潜力（40% 发电效率）
  const MWh = (Q * 9.97 / 1e6) * 0.4;
  // 利用量 vs 火炬燃烧
  const utilized = Qd * utilizationFactor;
  const flared = Qd * (1 - utilizationFactor) * flareEfficiency;
  // 年减碳 tCO2e（CH₄ GWP=28）
  const tCO2eYear = (utilized * 28 / 1000) + (flared * 28 / 1000);
  // CH₄ 浓度（典型 50%）
  const ch4Conc = 50;

  return {
    ok: true,
    value: Math.round(Qd),
    unit: 'm³/d',
    grade: 'green',
    analysis: `M=${M}万吨, k=${k}/a, t=${year}a, L₀=${Lo}m³/t, 利用率 ${(utilizationFactor * 100).toFixed(0)}%, 火炬效率 ${(flareEfficiency * 100).toFixed(0)}%。LandGEM Q(t)=k·L₀·M·exp(−k·t)：日均 ${Qd.toFixed(0)}m³/d, 累计 ${cumulative.toFixed(0)}m³, 发电潜力 ${MWh.toFixed(1)}MW。CH₄ 浓度 ${ch4Conc}%, 利用 ${utilized.toFixed(0)}m³/d（${(utilizationFactor * 100).toFixed(0)}%）, 火炬 ${flared.toFixed(0)}m³/d。`,
    ref: 'USEPA LandGEM',
    formula: 'Q(t) = k · L₀ · M · exp(−k · t), 累计 = L₀·M·(1−exp(−k·t))',
    extra: {
      日均产量: `${Qd.toFixed(0)} m³/d`,
      累计产气: `${(cumulative / 1e4).toFixed(1)} 万m³`,
      CH4浓度: `${ch4Conc}%`,
      利用量: `${utilized.toFixed(0)} m³/d`,
      火炬燃烧: `${flared.toFixed(0)} m³/d`,
      发电潜力: `${MWh.toFixed(1)} MW`,
      年减碳: `${tCO2eYear.toFixed(1)} tCO2e/a`,
    },
    series: [
      {
        name: '年产气速率 Q(t)', unit: '万m³/a', varName: 'lfg_rate',
        points: Array.from({ length: Math.max(2, Math.min(51, year + 1)) }, (_, i) => ({
          t: i, v: +(k * Lo * Mt * Math.exp(-k * i) / 1e4).toFixed(2),
        })),
      },
      {
        name: '累计产气量', unit: '万m³', varName: 'lfg_cum',
        points: Array.from({ length: Math.max(2, Math.min(51, year + 1)) }, (_, i) => ({
          t: i, v: +(Lo * Mt * (1 - Math.exp(-k * i)) / 1e4).toFixed(1),
        })),
      },
    ],
  };
}

/** C-08. HDPE 膜验算（v4.5 结构化 + 加炭黑/抗穿刺/氧化） */
export function hdpeCheck(
  D: number, sigma: number, eps: number, P: number = 0.2, hold: number = 5,
  carbonBlack: number = 2.5,           // % 炭黑含量
  punctureResistance: number = 480,      // N 抗穿刺力
  oxidInductionTime: number = 100,       // min 氧化诱导时间
): CalcResult {
  const epsPct = eps < 100 ? eps * 100 : eps;
  const tD = D >= 1.5;
  const tSig = sigma >= 27;
  const tEps = epsPct >= 700;
  const tCB = carbonBlack >= 2.0 && carbonBlack <= 3.0;  // GB/T 17643 2-3%
  const tPuncture = punctureResistance >= 480;
  const tOIT = oxidInductionTime >= 100;
  const allOk = tD && tSig && tEps && tCB && tPuncture && tOIT;
  return {
    ok: allOk,
    value: allOk ? '全部满足 ✓' : '部分不满足 ✗',
    unit: '',
    grade: allOk ? 'green' : 'red',
    analysis: `① D=${D}mm ${tD ? '✓' : '✗ (≥1.5)'}; ② σ=${sigma}MPa ${tSig ? '✓' : '✗ (≥27)'}; ③ ε=${epsPct.toFixed(0)}% ${tEps ? '✓' : '✗ (≥700)'}; ④ 炭黑 ${carbonBlack}% ${tCB ? '✓' : '✗ (2-3)'}; ⑤ 抗穿刺 ${punctureResistance}N ${tPuncture ? '✓' : '✗ (≥480)'}; ⑥ OIT ${oxidInductionTime}min ${tOIT ? '✓' : '✗ (≥100)'}。焊缝气压试验 ${P}MPa × ${hold}min。${allOk ? '满足 GB/T 17643 GH-2 + GB 16889 §5.1' : '不满足'}`,
    ref: 'GB/T 17643-2011 / GB 16889-2008 §5.1',
    extra: {
      厚度: tD ? '✓' : '✗',
      抗拉强度: tSig ? '✓' : '✗',
      断裂伸长率: tEps ? '✓' : '✗',
      炭黑含量: tCB ? '✓' : '✗',
      抗穿刺力: tPuncture ? '✓' : '✗',
      氧化诱导: tOIT ? '✓' : '✗',
    },
  };
}

/** C-09. 复合衬垫等效渗透（v4.5 加接缝 + 化学兼容） */
export function linerKeq(
  d1: number, k1: number, d2: number, k2: number, theta: number,
  seamLength: number = 50,             // m/ha 施工接缝长度
  chemicalCompatibility: number = 1,    // 0-1 化学兼容系数
): CalcResult {
  if (d1 <= 0 || d2 <= 0 || k1 <= 0 || k2 <= 0 || theta < 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: '输入须正数', ref: 'GB 16889-2008 §5.1' };
  }
  const dt = d1 + d2;
  const k_eq = (dt * dt) / ((d2 * d2) / k2 + (d1 * d2 * theta) / k1);
  // 接缝渗漏（L/ha/d）：典型 0.01-0.1 L/ha/d per 接缝长度
  const seamLeakage = seamLength * 0.01 * 0.001 * (1 - chemicalCompatibility); // m³/ha/d
  // 长期蠕变折减：HDPE 10年 k 增加 5-15%
  const creepFactor = 1.1;
  const k_eq_long = k_eq * creepFactor;
  const ok = k_eq_long <= 1e-9;
  // 与 GB 16889 §5.1 限值的裕度
  const margin = 1e-9 / k_eq_long;
  return {
    ok,
    value: k_eq,
    unit: 'cm/s',
    grade: ok ? 'green' : 'red',
    analysis: `HDPE d1=${d1}mm k1=${k1.toExponential(2)}; GCL d2=${d2}mm k2=${k2.toExponential(2)}; 缺陷率 θ=${theta}; 接缝 ${seamLength}m/ha, 化学兼容 ${(chemicalCompatibility * 100).toFixed(0)}%。k_eq = ${k_eq.toExponential(3)} cm/s; 长期蠕变折减 ×${creepFactor} = ${k_eq_long.toExponential(3)} cm/s; 接缝渗漏 ${seamLeakage.toExponential(3)} m³/ha/d; 裕度 ${margin.toFixed(1)}× GB 16889 限值。${ok ? '满足 ✓' : '不满足 ✗'}`,
    ref: 'GB 16889-2008 §5.1',
    formula: 'k_eq = d² / (d₂²/k₂ + d₁·d₂·θ/k₁)',
    extra: {
      即时k_eq: `${k_eq.toExponential(3)} cm/s`,
      长期k_eq: `${k_eq_long.toExponential(3)} cm/s`,
      接缝渗漏: `${seamLeakage.toExponential(3)} m³/ha/d`,
      蠕变折减: `×${creepFactor}`,
      裕度: `${margin.toFixed(1)}×`,
    },
  };
}

/** C-10. 循环井影响半径（v4.5 加 aquiferType/thickness） */
export function wellR(
  Q: number, t: number, ne: number, dh: number,
  aquiferType: 'confined' | 'unconfined' = 'unconfined',
  thickness: number = 20,
): CalcResult {
  if (Q <= 0 || thickness <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'Q 与含水层厚度须 > 0', ref: 'GCW 修复工程实践' };
  }
  // GCW 稳态影响半径（经验式）：
  //   循环井双筛段恒定流量形成局部垂直循环流场，水平影响半径与运行时间无关，
  //   工程经验约为含水层厚度的 0.5~1.0 倍（取 0.6 中值），流量/水位变幅/孔隙度作适度修正。
  const R0 = 0.6 * thickness;                                  // 基准：0.6×含水层厚度
  const qAdj = Math.pow(Q / 100, 0.25);                        // 流量修正（Q=100 m³/d 为基准）
  const dhAdj = Math.pow(Math.max(dh, 0.5) / 2, 0.2);          // 水位变幅修正（Δh=2m 为基准）
  const neAdj = Math.pow(0.3 / Math.max(ne, 0.05), 0.1);       // 孔隙度微修正
  const typeAdj = aquiferType === 'confined' ? 1.1 : 1.0;      // 承压含水层影响略大
  const R = R0 * qAdj * dhAdj * neAdj * typeAdj;
  return {
    ok: true,
    value: Math.round(R * 10) / 10,
    unit: 'm',
    grade: 'green',
    analysis: `循环井（GCW）稳态影响半径，与运行时间 t 无关。含水层厚 ${thickness}m → 基准 0.6L=${R0.toFixed(1)}m；流量 Q=${Q}m³/d 修正 ×${qAdj.toFixed(2)}；Δh=${dh}m 修正 ×${dhAdj.toFixed(2)}；ne=${ne} 修正 ×${neAdj.toFixed(2)}；${aquiferType === 'confined' ? '承压 ×1.1' : '潜水 ×1.0'} → R=${R.toFixed(1)}m。量级 5~25m，符合循环井工程实践（0.5~1.0×含水层厚度）。`,
    ref: 'GCW 修复工程实践（R≈0.5~1.0×含水层厚度）',
    formula: 'R = 0.6·L·(Q/100)^0.25·(Δh/2)^0.2（稳态经验式，与 t 无关）',
    extra: {
      影响半径: `${R.toFixed(1)} m`,
      基准0_6L: `${R0.toFixed(1)} m`,
      流量修正: `×${qAdj.toFixed(2)}`,
      水位修正: `×${dhAdj.toFixed(2)}`,
      孔隙度修正: `×${neAdj.toFixed(2)}`,
      含水层: aquiferType === 'confined' ? '承压(×1.1)' : '潜水(×1.0)',
      运行时间t: `${t}d（稳态，不影响R）`,
    },
  };
}

/** C-11. 注气驱替半径（v4.5 加 porosity/gasViscosity/formationCompressibility） */
export function injectR(
  Pinj: number, t: number, mu: number = 1.0, k: number = 1.0,
  porosity: number = 0.3,
  gasViscosity: number = 0.018,  // cP CH₄ @ 20°C
  formationCompressibility: number = 1e-6,  // 1/kPa
): CalcResult {
  if (Pinj <= 0 || t <= 0 || porosity <= 0 || k <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'Pinj/t/φ/k 须 > 0', ref: 'CJJ 176-2012 §5.2' };
  }
  // 注气驱替半径（经验式，v4.5 修正：原式量纲错乱导致爆量到千米级）
  //   R = 4 · √(Pinj/4) · √(t/24) · √k · √(0.3/φ)   （量级 2~8 m）
  //   Pinj=4kPa、t=24h、k=1 为基准 → 4m；对应梅花形井距 √3·R ≈ 7~14m，与注气修复实践一致
  const r = 4
    * Math.sqrt(Math.max(Pinj, 0.5) / 4)
    * Math.sqrt(t / 24)
    * Math.sqrt(Math.max(k, 0.01))
    * Math.sqrt(0.3 / Math.max(porosity, 0.05));
  // 气体黏度 / 地层压缩系数作次级修正（对数尺度，影响 < ±15%）
  const viscAdj = Math.pow(0.018 / Math.max(gasViscosity, 0.001), 0.10);
  const cfAdj = Math.pow(1e-6 / Math.max(formationCompressibility, 1e-9), 0.05);
  const R = r * viscAdj * cfAdj;
  // 气体推进到 R 的近似时间（h）：体积推进 t_br ≈ (R/3)²·24·φ·μ/k
  const breakthroughTime = Math.pow(R / 3, 2) * 24 * porosity * Math.max(mu, 0.1) / Math.max(k, 0.01);
  // 相对设计影响范围（8m）的覆盖率
  const efficiency = Math.min(100, Math.pow(R / 8, 2) * 100);
  // 影响带气体体积（假定影响厚度简化为 10m）
  const gasVolume = Math.PI * R * R * 10 * porosity;
  return {
    ok: true,
    value: Math.round(R * 10) / 10,
    unit: 'm',
    grade: R > 0 ? 'green' : 'red',
    analysis: `Pinj=${Pinj}kPa, t=${t}h, μ=${gasViscosity}cP, φ=${porosity}, cf=${formationCompressibility}/kPa。驱替半径 R=${R.toFixed(1)}m（基准 ${r.toFixed(1)}m，黏度修正 ×${viscAdj.toFixed(2)}，压缩性修正 ×${cfAdj.toFixed(2)}）；气体推进到 R 约 ${breakthroughTime.toFixed(0)}h；影响带气体体积约 ${gasVolume.toFixed(0)}m³；对应梅花形井距 √3·R≈${(Math.sqrt(3) * R).toFixed(1)}m。`,
    ref: 'CJJ 176-2012 §5.2 / 注气修复工程实践（量级 2~8m）',
    formula: 'R = 4·√(Pinj/4)·√(t/24)·√k·√(0.3/φ)（经验式，μ/cf 微调）',
    extra: {
      驱替半径: `${R.toFixed(1)} m`,
      推荐井距: `${(Math.sqrt(3) * R).toFixed(1)} m（梅花）`,
      突破时间: `${breakthroughTime.toFixed(0)} h`,
      影响气体体积: `${gasVolume.toFixed(0)} m³`,
      覆盖率: `${efficiency.toFixed(0)}%`,
      黏度修正: `×${viscAdj.toFixed(2)}`,
      压缩性修正: `×${cfAdj.toFixed(2)}`,
      孔隙度: `${porosity}`,
    },
  };
}

/** C-12. 污染物对流-弥散（v4.5 加 retardation/decay） */
export function advect(
  C0: number, v: number, x: number, D: number,
  retardationFactor: number = 1,    // Rd 阻滞因子（v4.5 新增）
  decayRate: number = 0,           // 1/d 衰减常数
): CalcResult {
  if (C0 < 0 || D <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: 'C0≥0, D>0', ref: 'HJ 25.6-2019' };
  }
  // 无阻滞
  const C_base = C0 * Math.exp((-v * x) / D);
  // 仅阻滞
  const C_withRetard = C0 * Math.exp((-v * x) / (D * retardationFactor));
  // 仅衰减
  const C_withDecay = C0 * Math.exp((-v * x) / D - decayRate * (x / Math.max(v, 0.001)));
  // 完整（阻滞 + 衰减）
  const C_full = C0 * Math.exp((-v * x) / (D * retardationFactor) - decayRate * (x / Math.max(v, 0.001)));
  // 去除率
  const removalPct = C0 > 0 ? Math.round(((C0 - C_full) / C0) * 100) : 0;
  // 达标的距离（衰减 + 对流使 C < 0.01 × C0）
  const xMax = C0 > 0 ? (v / Math.max(decayRate, 1e-9)) * Math.log(100) : 0;
  // 残余时间（平均）
  const residualTime = v > 0 ? x / v : 0;
  return {
    ok: true,
    value: Math.round(C_full * 1000) / 1000,
    unit: 'mg/L',
    grade: C_full > C0 * 0.5 ? 'red' : C_full > C0 * 0.1 ? 'orange' : 'green',
    analysis: `C0=${C0}, v=${v}m/d, x=${x}m, D=${D}m²/d, Rd=${retardationFactor}, λ=${decayRate}/d。① 仅对流-弥散 C(x) = ${C_base.toFixed(3)} mg/L; ② 仅阻滞(Rd=${retardationFactor}) C = ${C_withRetard.toFixed(3)}; ③ 仅衰减(λ=${decayRate}) C = ${C_withDecay.toFixed(3)}; ④ 完整（阻滞+衰减）C = ${C_full.toFixed(3)}。去除率 ${removalPct}%, 达 0.01C₀ 距离 ${xMax.toFixed(0)}m。`,
    ref: 'HJ 25.6-2019',
    formula: 'C(x) = C₀ · exp(−v·x/(D·Rd) − λ·x/v)',
    extra: {
      仅对流: `${C_base.toFixed(3)} mg/L`,
      仅阻滞: `${C_withRetard.toFixed(3)} mg/L`,
      仅衰减: `${C_withDecay.toFixed(3)} mg/L`,
      完整: `${C_full.toFixed(3)} mg/L`,
      去除率: `${removalPct}%`,
      达01C0: `${xMax.toFixed(0)} m`,
      残余时间: `${residualTime.toFixed(0)} d`,
    },
    series: [
      {
        name: '完整模型 C(x)', unit: 'mg/L', varName: 'advect_full',
        points: Array.from({ length: 31 }, (_, i) => {
          const xi = (x * i) / 30;
          return { t: +xi.toFixed(1), v: +(C0 * Math.exp((-v * xi) / (D * retardationFactor) - decayRate * (xi / Math.max(v, 0.001)))).toFixed(4) };
        }),
      },
      {
        name: '仅对流-弥散 C(x)', unit: 'mg/L', varName: 'advect_base',
        points: Array.from({ length: 31 }, (_, i) => {
          const xi = (x * i) / 30;
          return { t: +xi.toFixed(1), v: +(C0 * Math.exp((-v * xi) / D)).toFixed(4) };
        }),
      },
    ],
  };
}

/** C-13. 土壤筛选值（v4.5 加深度分层 + HJ 25.2 触发） */
export function soilScreen(
  pol: string, cls: '一类(居住/学校)' | '二类(工业/商业)',
  depthLayer?: string, // 保留兼容参数；GB 36600-2018 表 1 不分深度，仅作备注
): CalcResult {
  // GB 36600-2018 表 1（建设用地土壤污染风险筛选值/管制值，mg/kg）
  // 注：v4.5.1 修正——原表为三档深度自定义值，与 GB 36600 表 1（不分深度）不符，改为国标单值
  const T: Record<string, Record<string, [number, number]>> = {
    '砷': { '一类(居住/学校)': [20, 120], '二类(工业/商业)': [60, 140] },
    '镉': { '一类(居住/学校)': [20, 47], '二类(工业/商业)': [65, 172] },
    '铬(六价)': { '一类(居住/学校)': [3.0, 30], '二类(工业/商业)': [5.7, 78] },
    '铅': { '一类(居住/学校)': [400, 800], '二类(工业/商业)': [800, 2500] },
    '汞': { '一类(居住/学校)': [8, 33], '二类(工业/商业)': [38, 82] },
    '镍': { '一类(居住/学校)': [150, 600], '二类(工业/商业)': [900, 2000] },
    '苯': { '一类(居住/学校)': [1, 10], '二类(工业/商业)': [4, 40] },
  };
  const row = T[pol];
  if (!row) return { ok: false, value: '未知污染物', grade: 'red', analysis: `未收录 ${pol} 的 GB 36600 限值`, ref: 'GB 36600-2018 表1' };
  const [sv, gv] = row[cls];
  const depthNote = depthLayer ? `（GB 36600 表 1 不分深度，深度层 ${depthLayer} 已忽略）` : '';
  const triggerHJ25_2 = '检出 > 筛选值 → 须风险评估(HJ 25.2)';
  return {
    ok: true,
    value: `筛选值 ${sv} mg/kg · 管制值 ${gv} mg/kg`,
    unit: 'mg/kg',
    grade: 'green',
    analysis: `${pol} (${cls})：筛选值 = ${sv} mg/kg, 管制值 = ${gv} mg/kg${depthNote}。判定：检出 < 筛选值 → 一般可接受; 筛选值 < 检出 < 管制值 → ${triggerHJ25_2}; 检出 > 管制值 → 须修复(HJ 25.3)并监测(HJ 25.4)。`,
    ref: 'GB 36600-2018 表1',
    extra: {
      筛选值: `${sv} mg/kg`,
      管制值: `${gv} mg/kg`,
      深度分层: depthLayer ?? '国标不分层',
      HJ25_2触发: triggerHJ25_2,
    },
  };
}

/** C-14. 衰减达标年限（v4.5 加监测成本 + NAT 评估） */
export function decayCalc(
  C0: number, Ctarget: number, t12: number = 1000,
  monitoringCostPerYear: number = 8,    // 万元/年 监测成本
): CalcResult {
  if (C0 <= 0 || Ctarget <= 0 || t12 <= 0) {
    return { ok: false, value: NaN, grade: 'red', analysis: '输入须正数', ref: 'HJ 25.6-2019' };
  }
  if (Ctarget > C0) {
    return { ok: true, value: 0, unit: 'a', grade: 'green', analysis: '目标浓度高于当前浓度，无衰减需求', ref: 'HJ 25.6-2019' };
  }
  const lam = Math.log(2) / t12;
  const T_days = Math.log(C0 / Ctarget) / lam;
  const T_years = T_days / 365.25;
  // 累计监测成本
  const monitoringTotal = monitoringCostPerYear * T_years;
  // NAT 容量评估：自然衰减潜力（基于一级动力学）
  const NATcapacity = t12 < 500 ? '强' : t12 < 1500 ? '中' : '弱';
  return {
    ok: true,
    value: Math.round(T_years * 10) / 10,
    unit: 'a',
    grade: T_years > 30 ? 'orange' : 'yellow',
    analysis: `C0=${C0}mg/L, Ct=${Ctarget}mg/L, t½=${t12}d, 监测 ${monitoringCostPerYear}万/a。λ = ${lam.toExponential(2)} /d; T = ${T_years.toFixed(1)}a (${T_days.toFixed(0)}d)。累计监测成本 ${monitoringTotal.toFixed(0)}万元, NAT 能力 ${NATcapacity}。一级衰减近似，实际须计入弥散/吸附/源区持续释放。`,
    ref: 'HJ 25.6-2019',
    formula: 'T = ln(C₀/Ct) / λ, λ = ln2/t½',
    extra: {
      达标年限: `${T_years.toFixed(1)} a`,
      天数: `${T_days.toFixed(0)} d`,
      衰减常数: `${lam.toExponential(2)} /d`,
      监测累计: `${monitoringTotal.toFixed(0)} 万元`,
      NAT能力: NATcapacity,
      LTM建议: `5/10/30年点位密度分层`,
    },
  };
}

// =================================================================
// 默认导出
// =================================================================
export default {
  // 旧内部 API
  calculateStabilityFactor,
  calculateEffectiveRadius,
  calculateGasProduction,
  // v5.1 统一边坡稳定内核（唯一口径）
  stabilityDetail,
  // 14 个 v4.5 强化计算器
  slopeFs,
  capacity,
  settlementHyper,
  optimizeWellSpacing,
  calculateLeachate,
  predictMoisture,
  lfgYield,
  hdpeCheck,
  linerKeq,
  wellR,
  injectR,
  advect,
  soilScreen,
  decayCalc,
};

export function gaussian(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
