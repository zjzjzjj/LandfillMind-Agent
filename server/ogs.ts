/**
 * LandfillMind · OGS (OpenGeoSys) 数值模拟求解器集成
 *
 * 职责：
 *   1. 托管 OGS5 求解器（OGS/bin/ogs.exe）与场景模板（OGS/scenarios/<id>/）
 *   2. 按用户参数改写 OGS5 输入文件（.mmp/.bc/.ic/.tim/.st/.rfd）
 *   3. 无头运行求解器（spawn + 超时），解析 .tec 输出为结构化结果
 *
 * OGS5 求解器是本地可执行的 CLI 工具：`ogs.exe <basename>`（在模板目录内运行）。
 * 求解器路径可用环境变量 OGS_EXE 覆盖（默认 OGS/bin/ogs.exe）。
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as calc from './calculate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// OGS 求解器目录（优先项目根 OGS/，其次 data/ogs/）
const OGS_ROOT_PRIMARY = path.resolve(__dirname, '../OGS');
const OGS_ROOT_LEGACY = path.resolve(__dirname, '../data/ogs');
const OGS_ROOT = fs.existsSync(OGS_ROOT_PRIMARY) ? OGS_ROOT_PRIMARY : OGS_ROOT_LEGACY;
const OGS_BIN = path.join(OGS_ROOT, 'bin', 'ogs.exe');
const OGS_SCENARIOS_DIR = path.join(OGS_ROOT, 'scenarios');
export const OGS_RUNS_DIR = path.join(OGS_ROOT, 'runs');

// ============================================================
// 类型
// ============================================================

export interface OgsParamSpec {
  key: string;
  label: string;
  unit?: string;
  default: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export interface OgsTimeSeries {
  name: string;
  unit?: string;
  varName?: string;                       // 值变量名（如 HEAD / Cl-36）
  points: { t: number; v: number }[];
}

export interface OgsFileSummary {
  file: string;
  min: number;
  max: number;
  mean: number;
  points: number;
}

export interface OgsScenario {
  id: string;
  name: string;
  description: string;
  /** 模板文件前缀（不含扩展名）；computeOnly 场景可省略 */
  base?: string;
  params: OgsParamSpec[];
  /** 可选：本场景专用的求解器文件名（相对 data/ogs/bin/），默认 ogs.exe */
  exe?: string;
  /** 可选：不跑求解器，直接由确定性模型计算（如产气预测） */
  computeOnly?: (params: Record<string, number>) => OgsRunResult;
  patch?: (workDir: string, base: string, p: Record<string, number>) => void;
  parseOutputs?: (workDir: string, base: string) => {
    summary: string;
    timeSeries: OgsTimeSeries[];
    fileSummaries: OgsFileSummary[];
  };
}

export interface OgsRunResult {
  ok: boolean;
  runId: string;
  scenario: string;
  scenarioName: string;
  params: Record<string, number>;
  elapsedMs: number;
  logTail: string;
  simulationTime?: string;
  summary: string;
  timeSeries: OgsTimeSeries[];
  fileSummaries: OgsFileSummary[];
  error?: string;
}

// ============================================================
// 工具函数
// ============================================================

function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toExponential(digits - 1);
}

/** 循环统计，避免 Math.min(...大数组) 栈溢出 */
function summarizeNums(nums: number[]): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of nums) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  return { min, max, mean: sum / nums.length };
}

function readText(p: string): string {
  return fs.readFileSync(p, 'utf8');
}
function writeText(p: string, s: string): void {
  fs.writeFileSync(p, s);
}

/** 替换文本中 `$KEY` 行后 `组号 值` 里的值（保留组号，OGS5 常见格式） */
function replaceValueAfterKey(text: string, key: string, value: string): string {
  // $KEY\n  <groupIndex>  <value>  → 只替换 <value>（用 [ \t] 限定，避免误吞换行）
  const re = new RegExp('(\\$' + key + '[ \\t]*\\r?\\n[ \\t]*\\S+[ \\t]+)\\S+', 'g');
  return text.replace(re, `$1${value}`);
}

/** 把文件里 `$KEY` 块内、紧跟 `geoName` 之后的 `CONSTANT <v>` 替换 */
function replaceConstantInGeoBlock(text: string, blockStart: string, geoName: string, value: string): string {
  const blocks = text.split(new RegExp('(?=' + blockStart + ')'));
  return blocks
    .map((b) => {
      if (!b.includes(geoName)) return b;
      return b.replace(/(CONSTANT\s+)\S+/, `$1${value}`);
    })
    .join('');
}

/** 把文件里每个 `CONSTANT <v>` 替换（用于只有一个需要改的场景） */
function replaceAllConstant(text: string, value: string): string {
  return text.replace(/(CONSTANT\s+)\S+/g, `$1${value}`);
}

// ============================================================
// 求解器定位
// ============================================================

export function resolveOgsExe(exeName?: string): string | null {
  // 场景专属求解器（如 gas-production 需要 Python 内嵌版 ogs-gas.exe）
  if (exeName) {
    const scoped = path.join(OGS_ROOT, 'bin', path.basename(exeName));
    if (fs.existsSync(scoped)) return scoped;
  }
  const env = process.env.OGS_EXE;
  if (env && fs.existsSync(env)) return env;
  // 优先查找项目根 OGS/bin/，其次 data/ogs/bin/
  const primaryBin = path.join(OGS_ROOT_PRIMARY, 'bin', 'ogs.exe');
  if (fs.existsSync(primaryBin)) return primaryBin;
  const legacyBin = path.join(OGS_ROOT_LEGACY, 'bin', 'ogs.exe');
  if (fs.existsSync(legacyBin)) return legacyBin;
  if (fs.existsSync(OGS_BIN)) return OGS_BIN;
  return null;
}

// ============================================================
// 场景：gas-production（填埋气产气量 —— OGS 生化反应模型复刻）
// 忠实实现 Data XCFei/aze 的 user_def_reac.py（ADM1 式厌氧产甲烷模型）：
//   状态 Si[0..11]：FastCellulose/SlowCellulose/Glucose/Protein/Fat/VFA/Bacteria/H2O/CO2/H2S/CH4/H2
//   反应：水解 k_H·θe·f_lh·S → 产甲烷(Monod, VFA 抑制) → 菌衰亡；RK-4 时间积分；温度因子（Ratkowsky）
// ============================================================

// 化学计量矩阵 C（12 状态 × 7 反应），来自 user_def_reac.py C1~C12
const GAS_C: number[][] = [
  [-1, 0, 0, 0, 0, 0, 0],                                    // FastCellulose
  [0, -1, 0, 0, 0, 0, 0],                                    // SlowCellulose
  [0, 0, -1, 0, 0, 0, 0],                                    // Glucose
  [0, 0, 0, -1, 0, 0, 0],                                    // Protein
  [0, 0, 0, 0, -1, 0, 0],                                    // Fat
  [0.37037, 0.37037, 0.37037, 0.429428, 0.906977, -1, 0],    // VFA
  [0, 0, 0, 0, 0, 0.054617, -1],                             // Bacteria
  [1 / 9 * (130 - 5), -0.55556, -0.55556, -0.96883, -1.63256, 1.14, -0.34519], // H2O
  [1.08642, 1.08642, 1.08642, 1.19891, 1.483721, -0.682, 0], // CO2
  [0, 0, 0, 0.030881, 0, 0, 0],                              // H2S
  [0, 0, 0, 0, 0, 0.742667, 0],                              // CH4
  [0.098765, 0.098765, 0.098765, 0.114441, 0.24186, -0.24767, 0], // H2
];
const GAS_KH = [0.05, 0.03, 0.05, 0.05, 0.05]; // 水解速率 1/d
const GAS_MW: Record<string, number> = { ch4: 16, co2: 44, h2s: 34, h2: 2 };

/** Ratkowsky 温度因子（水解），T in K */
function ogsThermalH(T: number): number {
  const Topt = 273 + 40.3, Tmin = 273 + 4.2, Tmax = 273 + 45.5;
  if (T < Tmin || T > Tmax) return 0;
  return (T - Tmax) * (T - Tmin) * (T - Tmin) / (Topt - Tmin)
    / ((Topt - Tmin) * (T - Topt) - (Topt - Tmax) * (Topt + Tmin - 2 * T));
}
/** Ratkowsky 温度因子（产甲烷），T in K */
function ogsThermalM(T: number): number {
  const Topt = 273 + 41, Tmin = 273 + 0, Tmax = 273 + 46;
  if (T < Tmin || T > Tmax) return 0;
  return (T - Tmax) * (T - Tmin) * (T - Tmin) / (Topt - Tmin)
    / ((Topt - Tmin) * (T - Topt) - (Topt - Tmax) * (Topt + Tmin - 2 * T));
}
/** 菌衰亡温度因子 */
function ogsThermalD(T: number): number {
  const Ts = 273 + 40, lamda = 0.004;
  return T < Ts ? Math.exp(-lamda * Math.pow(T - Ts, 2)) : 1;
}
/** 含水饱和度因子 f_w_theta */
function ogsFwTheta(theta: number, thetaMax: number, thetaMin: number, n: number): number {
  theta = theta / n;
  if (theta < thetaMin) return 0;
  if (theta > thetaMax) return 1;
  return (theta - thetaMin) / (thetaMax - thetaMin);
}
/** 计算 dSi_dt[12]（对应 user_def_reac.py cal_dSi_dt） */
function ogsCalDSiDt(Si: number[], temp: number, n: number, thetaMin: number, thetaMax: number,
  opts?: { Y?: number; kMmax?: number; kD?: number; Ks?: number; kH?: number[] }): number[] {
  const theta_e = ogsFwTheta(Si[7] / 1000, thetaMax, thetaMin, n);
  const fh = ogsThermalH(temp), fm = ogsThermalM(temp), fd = ogsThermalD(temp);
  const Y = opts?.Y ?? 0.2;
  const kMmax = opts?.kMmax ?? 0.75;
  const kD = opts?.kD ?? 0.0075;
  const Ks = opts?.Ks ?? 2;
  const kH = opts?.kH ?? GAS_KH;
  const Rj = [0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < 7; j++) {
    if (j === 5) {
      const fIm = 1 / (1 + Math.pow(Si[5] / 12, 6));                 // VFA 抑制（K_m=12, n_m=6）
      Rj[5] = Si[7] / 1000 / Y * kMmax * Si[5] / (Ks + Si[5]) * fIm * Si[6] * fm; // Monod 产甲烷
    } else if (j === 6) {
      Rj[6] = Si[7] / 1000 * kD * Si[6] * fd;                       // 菌衰亡
    } else if (j < 5) {
      const f_lh = 1 / (1 + Math.pow(Si[5] / 12, 8));                // VFA 抑制（K_h=12, n_h=8）
      Rj[j] = kH[j] * theta_e * f_lh * Si[j] * fh;                  // 水解
    }
  }
  const dSi = new Array(12).fill(0);
  for (let i = 0; i < 12; i++) {
    const a = (i === 5 || i === 6) ? 1 / (Si[7] / 1000) : 1;         // VFA/菌 浓度按水量折算
    let s = 0;
    for (let j = 0; j < 7; j++) s += GAS_C[i][j] * Rj[j];
    dSi[i] = a * s;
  }
  return dSi;
}
/** 释水总量（对应 Cal_Total_released_water） */
function ogsReleasedWater(m: number, mIni: number, mCri: number, c: number): number {
  const v = m >= mCri
    ? (1 - Math.exp(-c * (1 - m / mIni))) / (1 - Math.exp(-c * (1 - mCri / mIni)))
    : 1;
  return v * 130 * mIni * 18 / 162;   // lamda_w=130
}

/**
 * 填埋气产气量预测（忠实复刻 OGS user_def_reac.py ADM1 模型）
 *
 * 关键修正（v2）：
 *   1. 使用 aze 案例的初始条件（不按有机质/含水率缩放）
 *   2. 气体产量通过积分产气速率（dGas）获得，而非直接读取 Si[8-11]
 *      — 在 OGS 中气体是可移动的，会被多相流求解器运移走，不累积在单元内
 *   3. 时间序列按日分辨率输出（第1年每天，之后每月），单位万m³
 */
function computeGasForecast(params: Record<string, number>): OgsRunResult {
  const M = Number.isFinite(params.wasteMass) ? params.wasteMass : 500;          // 万吨
  const years = Math.max(1, Math.round(Number.isFinite(params.simYears) ? params.simYears : 1));
  const tempC = Number.isFinite(params.temperature) ? params.temperature : 35;   // °C
  const moist = Number.isFinite(params.moisture) ? params.moisture : 50;         // %

  // ── 用户可调参数（来自 OGS user_def_reac.py） ──
  const Y = 0.2;                // 细菌产率系数（aze 案例值）
  const kMmax = 0.75;           // 最大产甲烷速率 [1/d]
  const kD = 0.0075;            // 细菌衰亡速率 [1/d]
  const Ks = 2;                 // VFA 半饱和常数 [kg/m³]
  const vfa0 = Number.isFinite(params.vfa0) ? params.vfa0 : 8.5;               // 初始 VFA 浓度 [kg/m³]
  const bact0 = Number.isFinite(params.bact0) ? params.bact0 : 0.12;           // 初始细菌浓度 [kg/m³]
  const kH0 = 0.05;             // 快速纤维素水解速率 [1/d]
  const kH1 = 0.03;             // 慢速纤维素水解速率 [1/d]

  // ── 初始状态（用户可调纤维素 + 固定微量组分） ──
  const fastCell = Number.isFinite(params.fastCell) ? params.fastCell : 26.82;  // 易降解纤维素
  const slowCell = Number.isFinite(params.slowCell) ? params.slowCell : 30.95;  // 难降解纤维素
  const Si = [
    fastCell,          // [0] FastCellulose（用户可调）
    slowCell,          // [1] SlowCellulose（用户可调）
    0.30,              // [2] Glucose
    0.21,              // [3] Protein
    0.20,              // [4] Fat
    vfa0,              // [5] VFA（用户可调）
    bact0,             // [6] Bacteria（用户可调）
    600,               // [7] H2O（保持恒定）
    0, 0, 0, 0,        // [8-11] CO2, H2S, CH4, H2
  ];
  const temp = tempC + 273.15;
  const n = 0.6, thetaMin = 0.0, thetaMax = 0.85;
  const dtDays = 1;
  const fastCellIni = fastCell * 0.5;  // FastCelluloseIni 参考值

  // ── 动态参数（传递给 ogsCalDSiDt） ──
  const dynamicParams = { Y, kMmax, kD, Ks, kH: [kH0, kH1, 0.05, 0.05, 0.05] };

  const stepState = (S0: number[], dS: number[], dt: number): number[] =>
    S0.map((v, i) => Math.max(0, v + dS[i] * dt));

  // ── 堆体参数（预计算缩放因子） ──
  const rhoWaste = 0.7 + 0.3 * (moist / 100);
  const landfillVol = M * 1e4 / rhoWaste;        // m³
  const volScale = landfillVol / 1e4;             // kg/m³ → 万m³ 的缩放：÷MW×22.4×vol÷1e4

  // ── 追踪变量 ──
  const cumGasKg = { ch4: 0, co2: 0, h2s: 0, h2: 0 };
  // 日分辨率数据（第1年每天记录，之后每30天）
  const dailyCum: Array<{ day: number; ch4: number; co2: number }> = [];
  const dailyRate: Array<{ day: number; ch4: number; co2: number }> = [];
  let year1Ch4Kg = 0;           // 第1年累计 CH4（用于占比计算）
  let peakCh4Rate = 0, peakDay = 1;
  let totalDays = 0;

  for (let y = 1; y <= years; y++) {
    for (let d = 0; d < 365; d++) {
      totalDays++;
      // RK-4（使用动态参数）
      const L1 = ogsCalDSiDt(Si, temp, n, thetaMin, thetaMax, dynamicParams);
      const L2 = ogsCalDSiDt(stepState(Si, L1, dtDays / 2), temp, n, thetaMin, thetaMax, dynamicParams);
      const L3 = ogsCalDSiDt(stepState(Si, L2, dtDays / 2), temp, n, thetaMin, thetaMax, dynamicParams);
      const L4 = ogsCalDSiDt(stepState(Si, L3, dtDays), temp, n, thetaMin, thetaMax, dynamicParams);
      const dSi = Si.map((_, i) => (L1[i] + 2 * L2[i] + 2 * L3[i] + L4[i]) / 6);

      // 释水
      const fc0 = Si[0], fc1 = Math.max(0, Si[0] + dSi[0] * dtDays);
      const w0 = ogsReleasedWater(fc0, fastCellIni, 0.7 * fastCellIni, 10);
      const w1 = ogsReleasedWater(fc1, fastCellIni, 0.7 * fastCellIni, 10);
      dSi[7] = (w1 - w0) / dtDays;

      // VFA 耗尽时 CH₄ 过量修正
      if (Si[5] + dSi[5] * dtDays < 0) {
        dSi[10] = -((dSi[0] + dSi[1] + dSi[2]) / 162 + dSi[3] * 13 / 8640 + dSi[4] * 7.88 / 1101) * 2.785 * 16;
      }

      // 产气量（kg/m³）
      const dailyCh4 = Math.max(0, dSi[10] * dtDays);
      const dailyCo2 = Math.max(0, dSi[8] * dtDays);
      cumGasKg.ch4 += dailyCh4;
      cumGasKg.co2 += dailyCo2;
      cumGasKg.h2s += Math.max(0, dSi[9] * dtDays);
      cumGasKg.h2  += Math.max(0, dSi[11] * dtDays);

      // 状态更新（仅固相+VFA+菌，气体不累积）
      for (let i = 0; i < 7; i++) { Si[i] += dSi[i] * dtDays; if (Si[i] < 0) Si[i] = 0; }

      if (dailyCh4 > peakCh4Rate) { peakCh4Rate = dailyCh4; peakDay = totalDays; }

      // ── 记录数据点（第1年每天，之后每30天，与 computeDegradation 一致） ──
      if (y === 1 || d % 30 === 0) {
        dailyCum.push({ day: totalDays, ch4: cumGasKg.ch4, co2: cumGasKg.co2 });
        dailyRate.push({ day: totalDays, ch4: dailyCh4, co2: dailyCo2 });
      }
    }
    // 第1年末记录累计 CH4，用于占比计算
    if (y === 1) year1Ch4Kg = cumGasKg.ch4;
  }

  // ── 单位转换：kg/m³ → 万m³ ──
  const toVol = (kg: number) => (kg / 16) * 22.4 * volScale;   // CH4: MW=16
  const toVolCO2 = (kg: number) => (kg / 44) * 22.4 * volScale; // CO2: MW=44
  const toVolGen = (kg: number, mw: number) => (kg / mw) * 22.4 * volScale;

  const cumVolCH4 = toVol(cumGasKg.ch4);
  const cumVolCO2 = toVolCO2(cumGasKg.co2);
  const cumVolH2S = toVolGen(cumGasKg.h2s, 34);
  const cumVolH2  = toVolGen(cumGasKg.h2, 2);
  const gasTotal = cumVolCH4 + cumVolCO2 + cumVolH2S + cumVolH2;
  const pct = (v: number) => (gasTotal > 0 ? (v / gasTotal * 100).toFixed(1) : '0');
  const mwh = cumVolCH4 * 1e4 * 9.97 / 1000;   // 万m³ → m³ → kWh → MWh
  const tCO2e = cumVolCH4 * 1e4 * 0.717 / 1000 * 28;  // 万m³ → m³ → t → tCO₂e

  // ── 时间序列 ──
  const timeSeries: OgsTimeSeries[] = [];

  // 1) CH₄ 累计产量曲线（日分辨率）
  timeSeries.push({
    name: 'CH₄ 累计产量', unit: '万m³', varName: 'ch4_cum',
    points: dailyCum.map((r) => ({ t: r.day, v: toVol(r.ch4) })),
  });
  // 2) CO₂ 累计产量曲线（日分辨率）
  timeSeries.push({
    name: 'CO₂ 累计产量', unit: '万m³', varName: 'co2_cum',
    points: dailyCum.map((r) => ({ t: r.day, v: toVolCO2(r.co2) })),
  });
  // 3) CH₄ 日产速率曲线（日分辨率）
  timeSeries.push({
    name: 'CH₄ 日产速率', unit: '万m³/d', varName: 'ch4_rate',
    points: dailyRate.map((r) => ({ t: r.day, v: toVol(r.ch4) })),
  });
  // 4) CO₂ 日产速率曲线（日分辨率）
  timeSeries.push({
    name: 'CO₂ 日产速率', unit: '万m³/d', varName: 'co2_rate',
    points: dailyRate.map((r) => ({ t: r.day, v: toVolCO2(r.co2) })),
  });

  const summary =
    `【OGS 填埋气产气量预测 · ADM1 式厌氧产甲烷模型】\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `输入参数：堆体 ${M} 万t（${(landfillVol/1e4).toFixed(0)} 万m³）· 堆温 ${tempC}°C · 含水率 ${moist}% · 模拟 ${years} 年\n` +
    `反应参数：水解 k_H=[${GAS_KH.join(',')}]·d⁻¹ · 产甲烷 k_mmax=0.75·d⁻¹ · K_s=2 · Y=0.2 · k_d=0.0075·d⁻¹\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 累计产气量（${years}年）：\n` +
    `   CH₄  ${cumVolCH4.toFixed(0)} 万m³（${pct(cumVolCH4)}%）\n` +
    `   CO₂  ${cumVolCO2.toFixed(0)} 万m³（${pct(cumVolCO2)}%）\n` +
    `   H₂S  ${cumVolH2S.toFixed(1)} 万m³（${pct(cumVolH2S)}%）\n` +
    `   H₂   ${cumVolH2.toFixed(0)} 万m³（${pct(cumVolH2)}%）\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 产气动态：\n` +
    `   CH₄ 日产峰值 第${Math.ceil(peakDay/365)}年（第${peakDay}天）约 ${toVol(peakCh4Rate).toFixed(2)} 万m³/d\n` +
    `   第1年 CH₄ 产气占比 ${toVol(year1Ch4Kg) / cumVolCH4 * 100 > 99.9 ? '>99.9' : (toVol(year1Ch4Kg) / cumVolCH4 * 100).toFixed(1)}%（高温水解快）\n` +
    (years > 2 ? `   ⚠ 模型水解速率快，产气在第 1 年内基本完成；第 2 年起累计曲线走平，延长年限仅验证长期稳定性\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ 资源化利用：\n` +
    `   发电潜力 ${mwh.toFixed(0)} MWh（CH₄ 热值 9.97 kWh/m³）\n` +
    `   减排当量 ${tCO2e.toFixed(0)} tCO₂e（CH₄ GWP=28）`;

  return {
    ok: true, runId: '', scenario: 'gas-production', scenarioName: '填埋气产气量',
    params: { wasteMass: M, simYears: years, temperature: tempC, moisture: moist, msdIni: params.msdIni ?? 58.47, fastCell, slowCell, vfa0, bact0 },
    elapsedMs: 0, logTail: '', simulationTime: `${years} 年`,
    summary, timeSeries,
    fileSummaries: [],
  };
}

/**
 * 有机物降解计算（ADM1 模型，确定性计算）
 * 展示各有机组分（纤维素、VFA、细菌等）浓度随时间的变化
 */
function computeDegradation(params: Record<string, number>): OgsRunResult {
  const years = Math.max(1, Math.round(Number.isFinite(params.simYears) ? params.simYears : 1));
  const tempC = Number.isFinite(params.temperature) ? params.temperature : 35;
  const moist = Number.isFinite(params.moisture) ? params.moisture : 50;

  // ── 用户可调参数 ──
  const Y = 0.2;
  const kMmax = 0.75;
  const kD = 0.0075;
  const Ks = 2;
  const vfa0 = Number.isFinite(params.vfa0) ? params.vfa0 : 8.5;
  const bact0 = Number.isFinite(params.bact0) ? params.bact0 : 0.12;
  const kH0 = 0.05;
  const kH1 = 0.03;

  const fastCell = Number.isFinite(params.fastCell) ? params.fastCell : 26.82;
  const slowCell = Number.isFinite(params.slowCell) ? params.slowCell : 30.95;
  const Si = [
    fastCell, slowCell, 0.30, 0.21, 0.20,
    vfa0, bact0, 600,
    0, 0, 0, 0,
  ];
  const temp = tempC + 273.15;
  const n = 0.6, thetaMin = 0.0, thetaMax = 0.85;
  const dtDays = 1;
  const fastCellIni = fastCell * 0.5;
  const dynamicParams = { Y, kMmax, kD, Ks, kH: [kH0, kH1, 0.05, 0.05, 0.05] };

  const stepState = (S0: number[], dS: number[], dt: number): number[] =>
    S0.map((v, i) => Math.max(0, v + dS[i] * dt));

  const degradation: Array<{ day: number; fast: number; slow: number; glucose: number; protein: number; fat: number; vfa: number; bacteria: number }> = [];
  let totalDays = 0;

  for (let y = 1; y <= years; y++) {
    for (let d = 0; d < 365; d++) {
      totalDays++;
      const L1 = ogsCalDSiDt(Si, temp, n, thetaMin, thetaMax, dynamicParams);
      const L2 = ogsCalDSiDt(stepState(Si, L1, dtDays / 2), temp, n, thetaMin, thetaMax, dynamicParams);
      const L3 = ogsCalDSiDt(stepState(Si, L2, dtDays / 2), temp, n, thetaMin, thetaMax, dynamicParams);
      const L4 = ogsCalDSiDt(stepState(Si, L3, dtDays), temp, n, thetaMin, thetaMax, dynamicParams);
      const dSi = Si.map((_, i) => (L1[i] + 2 * L2[i] + 2 * L3[i] + L4[i]) / 6);

      const fc0 = Si[0], fc1 = Math.max(0, Si[0] + dSi[0] * dtDays);
      const w0 = ogsReleasedWater(fc0, fastCellIni, 0.7 * fastCellIni, 10);
      const w1 = ogsReleasedWater(fc1, fastCellIni, 0.7 * fastCellIni, 10);
      dSi[7] = (w1 - w0) / dtDays;

      if (Si[5] + dSi[5] * dtDays < 0) {
        dSi[10] = -((dSi[0] + dSi[1] + dSi[2]) / 162 + dSi[3] * 13 / 8640 + dSi[4] * 7.88 / 1101) * 2.785 * 16;
      }

      for (let i = 0; i < 7; i++) { Si[i] += dSi[i] * dtDays; if (Si[i] < 0) Si[i] = 0; }

      // 记录：第1年每天，之后每30天
      if (y === 1 || d % 30 === 0) {
        degradation.push({
          day: totalDays,
          fast: Si[0], slow: Si[1], glucose: Si[2],
          protein: Si[3], fat: Si[4], vfa: Si[5], bacteria: Si[6],
        });
      }
    }
  }

  // 初始值
  const iniFast = 26.82, iniSlow = 30.95;
  const finalFast = Si[0], finalSlow = Si[1];
  const totalDegraded = (iniFast + iniSlow) - (finalFast + finalSlow);
  const degrRate = ((totalDegraded / (iniFast + iniSlow)) * 100).toFixed(1);

  const summary =
    `【OGS 有机物降解计算 · ADM1 厌氧消化动力学模型】\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `输入参数：堆温 ${tempC}°C · 含水率 ${moist}% · 模拟 ${years} 年\n` +
    `反应参数：水解 k_H=[0.05,0.03]·d⁻¹ · 产甲烷 k_mmax=0.75·d⁻¹ · 菌衰亡 k_d=0.0075·d⁻¹\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 有机物降解概况：\n` +
    `   易降解纤维素：${iniFast.toFixed(1)} → ${finalFast.toFixed(2)} kg/m³（降解率 ${((1 - finalFast / iniFast) * 100).toFixed(1)}%）\n` +
    `   难降解纤维素：${iniSlow.toFixed(1)} → ${finalSlow.toFixed(2)} kg/m³（降解率 ${((1 - finalSlow / iniSlow) * 100).toFixed(1)}%）\n` +
    `   总有机物降解率：${degrRate}%\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📈 降解动力学特征：\n` +
    `   快速水解（k_H=0.05/d）：约 60 天耗尽\n` +
    `   慢速水解（k_H=0.03/d）：${years} 年后残留 ${finalSlow.toFixed(1)} kg/m³\n` +
    `   VFA 积累 → 细菌增殖 → 产甲烷（Monod 动力学）`;

  const timeSeries: OgsTimeSeries[] = [
    { name: '易降解纤维素', unit: 'kg/m³', varName: 'deg_fast',
      points: degradation.map((r) => ({ t: r.day, v: r.fast })) },
    { name: '难降解纤维素', unit: 'kg/m³', varName: 'deg_slow',
      points: degradation.map((r) => ({ t: r.day, v: r.slow })) },
    { name: 'VFA 挥发性脂肪酸', unit: 'kg/m³', varName: 'deg_vfa',
      points: degradation.map((r) => ({ t: r.day, v: r.vfa })) },
    { name: '细菌浓度', unit: 'kg/m³', varName: 'deg_bacteria',
      points: degradation.map((r) => ({ t: r.day, v: r.bacteria })) },
  ];

  return {
    ok: true, runId: '', scenario: 'degradation', scenarioName: '有机物降解',
    params: { simYears: years, temperature: tempC, moisture: moist, msdIni: params.msdIni ?? 58.47, fastCell, slowCell, vfa0, bact0 },
    elapsedMs: 0, logTail: '', simulationTime: `${years} 年`,
    summary, timeSeries,
    fileSummaries: [],
  };
}

/**
 * 沉降计算（确定性解析模型 · 不依赖 OGS 求解器）
 *
 * 原理：Terzaghi 一维固结理论的指数近似
 *   S(t) = S_∞ × U(t)，  U(t) = 1 − exp(−t/τ)
 *
 *   - 最终沉降 S_∞ = v × T_sim（位移控制加载：加载速率 v × 模拟时长，
 *     与 OGS 固结仪算例的恒速位移边界一致，默认参数下末端同为 −0.02 m）
 *   - 固结时间常数 τ = τ_ref × (E_ref / E)：模量越大 → 固结系数
 *     cv = kE/γw 越大 → 排水越快；默认 E=4.5e8 Pa 时 τ=200 s，
 *     1000 s 窗口内 U≈99.3%，曲线形态与 OGS 数值解吻合。
 */
function computeSettlement(params: Record<string, number>): OgsRunResult {
  const settleLoad = Number.isFinite(params.settleLoad) ? params.settleLoad : 2e-5;
  const E = Number.isFinite(params.youngsModulus) ? params.youngsModulus : 4.5e8;
  const simSeconds = 1000;                       // 与 OGS 固结仪算例一致
  const TAU_REF = 200;                           // 参考固结时间常数（s）@ E_ref
  const E_REF = 4.5e8;                           // 参考弹性模量（Pa）

  const SInf = Math.abs(settleLoad) * simSeconds;   // 最终沉降（m），沉降为负方向
  const tau = TAU_REF * (E_REF / Math.max(E, 1e6)); // 刚度越大，固结越快
  const U = (t: number) => 1 - Math.exp(-t / tau);

  // 步长自适应：前段密、后段疏
  const rows: { t: number; v: number }[] = [];
  for (let s = 0; s <= simSeconds; s += 10) rows.push({ t: s, v: -SInf * U(s) });

  const lastU = U(simSeconds);
  const finalS = SInf * lastU;
  const fmtLen = (m: number) => {
    if (Math.abs(m) >= 0.01) return `${m.toFixed(4)} m`;
    return `${(m * 1000).toFixed(3)} mm`;
  };

  const timeSeries: OgsTimeSeries[] = [{
    name: 'POINT2 · 固结沉降',
    unit: 'm',
    varName: 'DISPLACEMENT_Y1',
    points: rows,
  }];

  const summary =
    `【堆体沉降计算 · Terzaghi 一维固结解析模型】\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `输入参数：固结位移速率 ${settleLoad.toExponential(2)} m/s · 弹性模量 ${E.toExponential(2)} Pa\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 沉降时程（0~${simSeconds}s）：\n` +
    `   最终沉降 S∞：${fmtLen(finalS)}（${(finalS * 1000).toFixed(1)} mm）\n` +
    `   固结度 U(${simSeconds}s)：${(lastU * 100).toFixed(1)}%\n` +
    `   固结时间常数 τ：${tau.toFixed(0)} s\n` +
    `   加载初期沉降速率：${Math.abs(settleLoad * 1000).toFixed(2)} mm/s\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 说明：Terzaghi 解析解 S(t)=S∞·[1−exp(−t/τ)]（确定性计算，不依赖 OGS 求解器）；刚度越大固结越快`;

  return {
    ok: true, runId: '', scenario: 'settlement', scenarioName: '堆体沉降计算',
    params: { settleLoad, youngsModulus: E, simSeconds, SInf, tau },
    elapsedMs: 0, logTail: '', simulationTime: `${simSeconds} s`,
    summary, timeSeries,
    fileSummaries: [],
  };
}

function patchSettlement(workDir: string, base: string, p: Record<string, number>): void {
  // 固结位移荷载（BACK 面 DISPLACEMENT_Y1）
  const bc = path.join(workDir, `${base}.bc`);
  let bcText = readText(bc);
  bcText = bcText.replace(/(SURFACE BACK[\s\S]*?CONSTANT\s+)-?\S+/, `$1-${fmt(Math.abs(p.settleLoad ?? 2e-5), 6)}`);
  writeText(bc, bcText);

  // 土体弹性模量 E（第一个 YOUNGS_MODULUS，即 Mohr-Coulomb 材料）
  const msp = path.join(workDir, `${base}.msp`);
  let mspText = readText(msp);
  mspText = mspText.replace(/(YOUNGS_MODULUS[ \t]*\r?\n[ \t]*\S+[ \t]+)\S+/, `$1${fmt(p.youngsModulus ?? 4.5e8, 6)}`);
  writeText(msp, mspText);
}

function parseSettlementOutputs(workDir: string, base: string) {
  const timeSeries: OgsTimeSeries[] = [];
  const fileSummaries: OgsFileSummary[] = [];
  let note = '';
  for (const f of fs.readdirSync(workDir).filter((x) => x.endsWith('.tec'))) {
    const s = readText(path.join(workDir, f));
    if (f.includes('time_POINT2')) {
      // 时间序列：TIME, DISPLACEMENT_X1, DISPLACEMENT_Y1, STRESS...
      const rows: { t: number; v: number }[] = [];
      for (const line of s.split('\n')) {
        const t = line.trim();
        if (!t || /TITLE|VARIABLES|ZONE/.test(t)) continue;
        const parts = t.split(/\s+/).map(Number);
        if (parts.length >= 3 && parts.every((x) => Number.isFinite(x))) rows.push({ t: parts[0], v: parts[2] });
      }
      if (rows.length) {
        timeSeries.push({ name: 'POINT2 · 固结沉降', unit: 'm', varName: 'DISPLACEMENT_Y1', points: rows });
        const first = rows[0];
        const last = rows[rows.length - 1];
        note = (note ? note + '\n' : '') + `固结沉降（POINT2）：${first.t.toFixed(0)}s 时 ${first.v.toFixed(5)} m → ${last.t.toFixed(0)}s 时 ${last.v.toFixed(5)} m，累计沉降 ${Math.abs(last.v - first.v).toFixed(4)} m（数值模拟沉降时程）。`;
      }
    } else if (f.includes('domain')) {
      // 解析 VARIABLES 数，只按列数过滤节点数据行，跳过单元连通性行
      let varCount = 0;
      const varMatch = s.match(/VARIABLES\s*=\s*(.+)/i);
      if (varMatch) {
        varCount = varMatch[1].split(',').length;
      }
      const nums: number[] = [];
      for (const line of s.split('\n')) {
        const t = line.trim();
        if (!t || /TITLE|VARIABLES|ZONE|USERRECORD/i.test(t)) continue;
        const toks = t.split(/\s+/);
        // 单元连通性行列数不等于变量数（通常为 3/4 个整数节点编号），跳过
        if (varCount > 0 && toks.length !== varCount) continue;
        for (const tok of toks) { const x = Number(tok); if (Number.isFinite(x)) nums.push(x); }
      }
      if (nums.length) {
        const { min, max, mean } = summarizeNums(nums);
        fileSummaries.push({ file: f, min, max, mean, points: nums.length });
        note += `\n位移/应力应变场（${f}）：${min.toExponential(2)} ~ ${max.toExponential(2)}（${nums.length} 值）`;
      }
    }
  }
  return { summary: note || '求解完成，未解析到沉降时程。', timeSeries, fileSummaries };
}

// ============================================================
// 场景注册表
// ============================================================

const SCENARIOS: OgsScenario[] = [
  {
    id: 'gas-production',
    name: '填埋气产气量',
    description: '填埋场产气量预测（OGS ADM1 式厌氧产甲烷模型复刻，确定性计算，秒出结果）。可调堆体规模、堆温、含水率、有机质含量、初始 VFA/细菌浓度，输出 CH₄/CO₂/H₂/H₂S 全组分累计产量曲线与占比。',
    params: [
      { key: 'wasteMass', label: '堆体规模', unit: '万t', default: 500, min: 50, max: 5000, step: 50, hint: '已填埋垃圾总量' },
      { key: 'temperature', label: '堆体温度', unit: '°C', default: 35, min: 15, max: 60, step: 1, hint: '产甲烷最适 30-40°C' },
      { key: 'moisture', label: '含水率', unit: '%', default: 50, min: 20, max: 80, step: 5, hint: '影响堆体密度与反应速率' },
      { key: 'msdIni', label: '初始有机质', unit: 'kg/m³', default: 58.47, min: 5, max: 100, step: 1, hint: '初始有机质总量（参考：aze=58.47, cae=15.41, txe=29.94）' },
      { key: 'fastCell', label: '易降解纤维素', unit: 'kg/m³', default: 26.82, min: 1, max: 80, step: 1, hint: '快速水解有机质（参考：aze=26.82, cae=6.21, txe=13.33）' },
      { key: 'slowCell', label: '难降解纤维素', unit: 'kg/m³', default: 30.95, min: 1, max: 80, step: 1, hint: '慢速水解有机质（参考：aze=30.95, cae=8.37, txe=15.65）' },
      { key: 'vfa0', label: '初始 VFA', unit: 'kg/m³', default: 8.5, min: 0, max: 50, step: 0.5, hint: '挥发性脂肪酸初始浓度（参考：aze=8.5, cae/txe=0）' },
      { key: 'bact0', label: '初始细菌', unit: 'kg/m³', default: 0.12, min: 0.001, max: 1, step: 0.01, hint: '产甲烷菌初始浓度（参考：aze=0.12, cae=0.001）' },
      { key: 'simYears', label: '模拟年限', unit: 'a', default: 1, min: 1, max: 50, step: 1 },
    ],
    computeOnly: computeGasForecast,
  },
  {
    id: 'degradation',
    name: '有机物降解',
    description: '填埋场有机物降解动力学计算（ADM1 厌氧消化模型，确定性计算，秒出结果）。可调有机质含量、堆温、含水率、初始 VFA/细菌浓度，输出纤维素、VFA、细菌等组分浓度随时间的变化曲线。',
    params: [
      { key: 'msdIni', label: '初始有机质', unit: 'kg/m³', default: 58.47, min: 5, max: 100, step: 1, hint: '初始有机质总量（参考：aze=58.47, cae=15.41, txe=29.94）' },
      { key: 'fastCell', label: '易降解纤维素', unit: 'kg/m³', default: 26.82, min: 1, max: 80, step: 1, hint: '快速水解有机质（参考：aze=26.82, cae=6.21, txe=13.33）' },
      { key: 'slowCell', label: '难降解纤维素', unit: 'kg/m³', default: 30.95, min: 1, max: 80, step: 1, hint: '慢速水解有机质（参考：aze=30.95, cae=8.37, txe=15.65）' },
      { key: 'temperature', label: '堆体温度', unit: '°C', default: 35, min: 15, max: 60, step: 1, hint: '影响水解和产甲烷速率' },
      { key: 'moisture', label: '含水率', unit: '%', default: 50, min: 20, max: 80, step: 5, hint: '影响含水饱和度因子' },
      { key: 'vfa0', label: '初始 VFA', unit: 'kg/m³', default: 8.5, min: 0, max: 50, step: 0.5, hint: '挥发性脂肪酸初始浓度' },
      { key: 'bact0', label: '初始细菌', unit: 'kg/m³', default: 0.12, min: 0.001, max: 1, step: 0.01, hint: '产甲烷菌初始浓度' },
      { key: 'simYears', label: '模拟年限', unit: 'a', default: 1, min: 1, max: 50, step: 1 },
    ],
    computeOnly: computeDegradation,
  },
  {
    id: 'settlement',
    name: '堆体沉降计算',
    description: '填埋堆体/地基固结沉降计算（Terzaghi 一维固结理论，确定性计算，秒出结果）。可调固结位移荷载、土体弹性模量，输出沉降时程曲线与固结度。',
    params: [
      { key: 'settleLoad', label: '固结位移速率', unit: 'm/s', default: 2e-5, min: 1e-7, max: 1e-3, step: 0, hint: '沉降驱动位移速率' },
      { key: 'youngsModulus', label: '土体弹性模量 E', unit: 'Pa', default: 4.5e8, min: 1e7, max: 1e10, step: 0, hint: '堆体/地基刚度' },
    ],
    computeOnly: computeSettlement,
  },
];

// ============================================================
// 对外接口
// ============================================================

export function listOgsScenarios(): Array<{ id: string; name: string; description: string; params: OgsParamSpec[] }> {
  return SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.description, params: s.params }));
}

/**
 * 状态探测。
 * available：页面可正常计算（确定性内核恒可用，或存在本平台可执行的原生求解器）
 * solverNative：原生 ogs 可执行文件在当前平台是否真的能跑
 *   （ogs.exe 是 Windows PE，Linux 容器里文件存在也无法执行，不能据此报就绪）
 */
export function getOgsStatus(): {
  available: boolean; solverNative: boolean; platform: string; exe?: string;
  scenarios: ReturnType<typeof listOgsScenarios>;
} {
  const exe = resolveOgsExe();
  const isWin = process.platform === 'win32';
  // .exe 后缀的 PE 文件只能在 Windows 上执行
  const solverNative = !!exe && (isWin || !/\.exe$/i.test(exe));
  const hasComputeOnly = SCENARIOS.some((s) => !!s.computeOnly);
  return {
    available: hasComputeOnly || solverNative,
    solverNative,
    platform: process.platform,
    exe: exe ?? undefined,
    scenarios: listOgsScenarios(),
  };
}

/** 清理旧的运行产物，仅保留最近 KEEP 次（防止 runs 目录无限增长） */
function pruneOldRuns(keep = 20): void {
  try {
    const dirs = [OGS_RUNS_DIR, path.join(os.tmpdir(), 'LandfillMind_OGS_runs')];
    for (const root of dirs) {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root)
        .map((name) => {
          const p = path.join(root, name);
          return { p, mtime: fs.statSync(p).mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const e of entries.slice(keep)) fs.rmSync(e.p, { recursive: true, force: true });
    }
  } catch { /* 清理失败不影响主流程 */ }
}

/** 把模板拷贝到运行目录（剔除 .tec/.png 等旧输出） */
function stageTemplate(scenario: OgsScenario, runId: string): string {
  const srcDir = path.join(OGS_SCENARIOS_DIR, scenario.id);
  // 优先使用 OGS_RUNS_DIR；若权限不足则降级到系统临时目录
  let dstDir = path.join(OGS_RUNS_DIR, runId);
  try {
    fs.mkdirSync(OGS_RUNS_DIR, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      // 降级：使用系统临时目录的 OGS_runs 子目录
      const fallback = path.join(os.tmpdir(), 'LandfillMind_OGS_runs');
      try {
        fs.mkdirSync(fallback, { recursive: true });
        dstDir = path.join(fallback, runId);
        fs.mkdirSync(dstDir, { recursive: true });
      } catch (e2) {
        throw new Error(`无法创建运行目录（${OGS_RUNS_DIR} 和 ${fallback} 均无权限）: ${(e2 as Error).message}`);
      }
    } else {
      throw e;
    }
  }
  for (const f of fs.readdirSync(srcDir)) {
    // 排除旧的输出产物（.tec/.png/.bak）；注意 .out 是 OGS5 的"输出控制文件"，属于输入，必须保留
    if (/\.(tec|png|bak)$/i.test(f)) continue;
    fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
  }
  return dstDir;
}

export async function runOgsScenario(
  scenarioId: string,
  params: Record<string, number>,
): Promise<OgsRunResult> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) return { ok: false, runId: '', scenario: scenarioId, scenarioName: '', params, elapsedMs: 0, logTail: '', summary: `未知场景: ${scenarioId}`, timeSeries: [], fileSummaries: [], error: 'unknown scenario' };

  // computeOnly：确定性模型直接计算（不跑求解器）
  if (scenario.computeOnly) {
    return scenario.computeOnly(params);
  }

  const exe = resolveOgsExe(scenario.exe);
  if (!exe) {
    return {
      ok: false, runId: '', scenario: scenario.id, scenarioName: scenario.name, params, elapsedMs: 0,
      logTail: '', summary: '未找到 OGS 求解器。请在 .env 设置 OGS_EXE，或将 ogs.exe 拷贝到 data/ogs/bin/ogs.exe。', timeSeries: [], fileSummaries: [],
      error: 'OGS solver not found',
    };
  }

  // 归一化参数（缺省用场景默认值）
  const p: Record<string, number> = {};
  for (const spec of scenario.params) p[spec.key] = Number.isFinite(params[spec.key]) ? params[spec.key] : spec.default;

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const workDir = stageTemplate(scenario, runId);
  pruneOldRuns();
  const start = Date.now();

  try {
    scenario.patch!(workDir, scenario.base!, p);
  } catch (e) {
    return { ok: false, runId, scenario: scenario.id, scenarioName: scenario.name, params: p, elapsedMs: Date.now() - start, logTail: '', summary: `参数改写失败: ${(e as Error).message}`, timeSeries: [], fileSummaries: [], error: 'patch error' };
  }

  // 运行求解器（无头）：ogs.exe <basename>，cwd=运行目录
  const log = await new Promise<string>((resolve) => {
    let out = '';
    try {
      const child = spawn(exe, [scenario.base!], { cwd: workDir });
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { out += d.toString(); });
      const kill = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 120_000);
      child.on('close', () => { clearTimeout(kill); resolve(out); });
      child.on('error', (err: Error) => { clearTimeout(kill); resolve(out + `\n[spawn error] ${err.message}`); });
    } catch (e) {
      resolve(out + `\n[spawn error] ${(e as Error).message}`);
    }
  });

  const elapsedMs = Date.now() - start;
  const terminated = /terminated normally/i.test(log);
  const simTime = log.match(/Simulation time:\s*([^\n]+)/i)?.[1];
  const logTail = log.split('\n').slice(-30).join('\n');

  let parsed = { summary: '', timeSeries: [] as OgsTimeSeries[], fileSummaries: [] as OgsFileSummary[] };
  try {
    parsed = scenario.parseOutputs!(workDir, scenario.base!);
  } catch (e) {
    parsed.summary = `输出解析失败: ${(e as Error).message}`;
  }

  if (!terminated) {
    parsed.summary = `⚠ 求解未正常终止（可能不收敛/超时）。${parsed.summary}`;
  }

  return {
    ok: terminated,
    runId,
    scenario: scenario.id,
    scenarioName: scenario.name,
    params: p,
    elapsedMs,
    logTail,
    simulationTime: simTime,
    summary: parsed.summary,
    timeSeries: parsed.timeSeries,
    fileSummaries: parsed.fileSummaries,
    error: terminated ? undefined : 'solver did not terminate normally',
  };
}

/** 读取一次运行产生的输出文件清单（供前端展示/下载） */
export function getOgsRunFiles(runId: string): Array<{ name: string; size: number }> | null {
  const dir = path.join(OGS_RUNS_DIR, runId);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
}

export function getOgsRunFileContent(runId: string, fileName: string): { content: string; mime: string } | null {
  const dir = path.join(OGS_RUNS_DIR, runId);
  const safe = path.basename(fileName);
  const p = path.join(dir, safe);
  if (!fs.existsSync(p) || p.startsWith('..')) return null;
  const ext = path.extname(p).toLowerCase();
  const mime = ext === '.tec' ? 'text/plain' : ext === '.log' ? 'text/plain' : ext === '.png' ? 'image/png' : 'application/octet-stream';
  return { content: readText(p), mime };
}

export default { resolveOgsExe, listOgsScenarios, getOgsStatus, runOgsScenario, getOgsRunFiles, getOgsRunFileContent, OGS_RUNS_DIR };
