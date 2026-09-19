/**
 * 计算中心 3 套预设参数（v4.5 14 个保留计算器）
 */
import type { CalcResult } from '../types';

export type PresetName = 'conservative' | 'standard' | 'aggressive';

export const PRESET_LABELS: Record<PresetName, { name: string; desc: string; color: string }> = {
  conservative: { name: '保守', desc: '偏安全、留大裕度', color: '#16a34a' },
  standard:     { name: '标准', desc: '工程典型值',     color: '#0ea5b7' },
  aggressive:   { name: '激进', desc: '偏经济、接近规范下限', color: '#ea580c' },
};

export const PRESETS: Record<string, Record<PresetName, Record<string, number | string>>> = {
  // ==================== 边坡 / 沉降 ====================
  slopeFs: {
    conservative: { H: 20, beta: 4, gamma: 10, c: 8, phi: 30, waterTableDepth: 15, seismicCoeff: 0, surcharge: 0 },
    standard:     { H: 30, beta: 3, gamma: 10, c: 5, phi: 25, waterTableDepth: 10, seismicCoeff: 0.05, surcharge: 0 },
    aggressive:   { H: 45, beta: 2, gamma: 11, c: 3, phi: 20, waterTableDepth: 5,  seismicCoeff: 0.1,  surcharge: 10 },
  },
  capacity: {
    conservative: { A: 15, H: 25, rho: 11, Qd: 400, phases: 1, coverRatio: 0.2, sFactor: 0.9 },
    standard:     { A: 10, H: 30, rho: 10, Qd: 500, phases: 2, coverRatio: 0.1, sFactor: 1 },
    aggressive:   { A: 8,  H: 40, rho: 9,  Qd: 700, phases: 3, coverRatio: 0.05, sFactor: 1 },
  },
  settlementHyper: {
    conservative: { t1: 30, s1: 30,  t2: 180, s2: 120 },
    standard:     { t1: 30, s1: 50,  t2: 180, s2: 200 },
    aggressive:   { t1: 30, s1: 80,  t2: 180, s2: 300 },
  },

  // ==================== 水气 ====================
  leachateCalc: {
    conservative: { area: 20, rainfall: 800,  runoffCoeff: 0.4, wasteHeight: 5, ET: 600,  cloggingFactor: 0.1, recirculationRatio: 0.1 },
    standard:     { area: 30, rainfall: 1200, runoffCoeff: 0.3, wasteHeight: 0, ET: 800,  cloggingFactor: 0,   recirculationRatio: 0 },
    aggressive:   { area: 50, rainfall: 1800, runoffCoeff: 0.2, wasteHeight: 0, ET: 1000, cloggingFactor: 0,   recirculationRatio: 0 },
  },
  moisturePredict: {
    conservative: { initialMoisture: 70, injectionPressure: 10, days: 14, depth: 3, gasFlow: 30,  screenLength: 5, wellheadLoss: 0.5 },
    standard:     { initialMoisture: 60, injectionPressure: 15, days: 7,  depth: 5, gasFlow: 50,  screenLength: 3, wellheadLoss: 1 },
    aggressive:   { initialMoisture: 50, injectionPressure: 25, days: 4,  depth: 8, gasFlow: 100, screenLength: 2, wellheadLoss: 2 },
  },
  lfgYield: {
    conservative: { M: 300, k: 0.05, year: 5,  Lo: 170, utilizationFactor: 0.3, flareEfficiency: 0.95 },
    standard:     { M: 500, k: 0.1,  year: 10, Lo: 170, utilizationFactor: 0.5, flareEfficiency: 0.9 },
    aggressive:   { M: 800, k: 0.2,  year: 15, Lo: 170, utilizationFactor: 0.7, flareEfficiency: 0.85 },
  },

  // ==================== 防渗 ====================
  hdpeCheck: {
    conservative: { D: 2.0, sigma: 27, eps: 700, P: 0.2, hold: 5, carbonBlack: 2.5, punctureResistance: 500, oxidInductionTime: 120 },
    standard:     { D: 1.5, sigma: 27, eps: 700, P: 0.2, hold: 5, carbonBlack: 2.5, punctureResistance: 480, oxidInductionTime: 100 },
    aggressive:   { D: 1.5, sigma: 30, eps: 600, P: 0.25, hold: 3, carbonBlack: 2.0, punctureResistance: 450, oxidInductionTime: 90 },
  },
  linerKeq: {
    conservative: { d1: 2.0, k1: 1e-10, d2: 8, k2: 1e-12, theta: 0.05, seamLength: 30, chemicalCompatibility: 1 },
    standard:     { d1: 1.5, k1: 1e-10, d2: 6, k2: 1e-11, theta: 0.1,  seamLength: 50, chemicalCompatibility: 1 },
    aggressive:   { d1: 1.5, k1: 1e-9,  d2: 5, k2: 1e-10, theta: 0.2,  seamLength: 80, chemicalCompatibility: 0.8 },
  },

  // ==================== 地下水 ====================
  wellR: {
    conservative: { Q: 50,  t: 60, ne: 0.3, dh: 1.5, aquiferType: 'unconfined', thickness: 15 },
    standard:     { Q: 100, t: 30, ne: 0.3, dh: 2.0, aquiferType: 'unconfined', thickness: 20 },
    aggressive:   { Q: 200, t: 15, ne: 0.4, dh: 3.0, aquiferType: 'confined',   thickness: 30 },
  },
  injectR: {
    conservative: { Pinj: 2, t: 48, mu: 1.2, k: 0.8, porosity: 0.25, gasViscosity: 0.02,  formationCompressibility: 5e-7 },
    standard:     { Pinj: 4, t: 24, mu: 1.0, k: 1.0, porosity: 0.3,  gasViscosity: 0.018, formationCompressibility: 1e-6 },
    aggressive:   { Pinj: 8, t: 12, mu: 0.8, k: 1.2, porosity: 0.35, gasViscosity: 0.015, formationCompressibility: 5e-6 },
  },
  advect: {
    conservative: { C0: 50,  v: 0.05, x: 30, D: 5, retardationFactor: 1.5, decayRate: 0 },
    standard:     { C0: 100, v: 0.1,  x: 50, D: 10, retardationFactor: 1,   decayRate: 0 },
    aggressive:   { C0: 200, v: 0.2,  x: 80, D: 20, retardationFactor: 1,   decayRate: 0.001 },
  },
  soilScreen: {
    conservative: { pol: '砷',       cls: '一类(居住/学校)', depthLayer: '0-0.5' },
    standard:     { pol: '砷',       cls: '二类(工业/商业)', depthLayer: '0.5-1.5' },
    aggressive:   { pol: '铬(六价)', cls: '二类(工业/商业)', depthLayer: '1.5+' },
  },
  decayCalc: {
    conservative: { C0: 200,  Ctarget: 20,  t12: 800,  monitoringCostPerYear: 5 },
    standard:     { C0: 500,  Ctarget: 50,  t12: 1000, monitoringCostPerYear: 8 },
    aggressive:   { C0: 1000, Ctarget: 100, t12: 1500, monitoringCostPerYear: 12 },
  },
  optimizeWellSpacing: {
    conservative: { effectiveRadius: 25, pattern: 'hexagonal', drawdown: 3, interferenceFactor: 0.3 },
    standard:     { effectiveRadius: 30, pattern: 'hexagonal', drawdown: 5, interferenceFactor: 0.4 },
    aggressive:   { effectiveRadius: 40, pattern: 'square',   drawdown: 8, interferenceFactor: 0.5 },
  },
};

export function applyPreset(calcId: string, preset: PresetName): Record<string, number | string> {
  return PRESETS[calcId]?.[preset] ?? {};
}

export const PRESET_DIST_STD_RATIO: Record<PresetName, number> = {
  conservative: 0.05,
  standard:     0.10,
  aggressive:   0.15,
};

export function suggestVaryParam(calcId: string, currentParams: Record<string, number | string>): string {
  const priority: Record<string, string> = {
    slopeFs: 'H',
    capacity: 'H',
    leachateCalc: 'rainfall',
    lfgYield: 'year',
    advect: 'x',
    decayCalc: 't12',
    settlementHyper: 't2',
    wellR: 't',
    injectR: 'Pinj',
  };
  if (priority[calcId]) return priority[calcId];
  for (const k of Object.keys(currentParams)) {
    if (typeof currentParams[k] === 'number') return k;
  }
  return '';
}

export function estimateCost(input: {
  capacityM3: number;
  leachateM3PerYear: number;
  monitorWells: number;
}): { labor: number; energy: number; chemical: number; monitor: number; total: number } {
  const labor = 30 * (input.capacityM3 / 10000);
  const energy = input.capacityM3 * 2 / 10000;
  const chemical = input.leachateM3PerYear * 30 / 10000;
  const monitor = 50 + input.monitorWells * 3;
  return {
    labor: Math.round(labor * 10) / 10,
    energy: Math.round(energy * 10) / 10,
    chemical: Math.round(chemical * 10) / 10,
    monitor: Math.round(monitor * 10) / 10,
    total: Math.round((labor + energy + chemical + monitor) * 10) / 10,
  };
}

export default PRESETS;
