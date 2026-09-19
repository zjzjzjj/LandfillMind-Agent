/**
 * calc-meta.ts — 计算器参数元数据（单一来源，v5 重构）
 *
 * 收敛分散的参数定义：原 DesignPage.tsx 的 PARAMS_MAP（前端硬编码）与
 * CALC_REGISTRY 函数体内的默认值（server/routes/calc.ts）双源漂移，
 * 改为本文件作为唯一权威来源，供：
 *   - server/tools.ts 的 calculate 工具（参数出处 + 范围校验 + 前端渲染）
 *   - /api/calc/meta 端点（前端表单生成，替代 DesignPage 硬编码字段）
 *   - 工程报告（参数表含单位/出处）
 *
 * 字段与 DesignPage PARAMS_MAP 一一对应（name=参数 key，与 CALC_REGISTRY 一致）。
 * 修改计算器参数时必须同步这里与 routes/calc.ts 的默认值。
 */

export interface CalcParamMeta {
  name: string;
  label: string;
  unit?: string;
  default?: number | string;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  type?: 'number' | 'select';
  options?: string[];
  hint?: string;
}

export const CALC_PARAM_META: Record<string, CalcParamMeta[]> = {
  slopeFs: [
    { name: 'H', label: '堆体高度 H', unit: 'm', default: 30, min: 5, max: 60 },
    { name: 'beta', label: '坡角倒数 1:β', default: 3, min: 1, max: 5 },
    { name: 'gamma', label: '垃圾重度 γ', unit: 'kN/m³', default: 10, min: 5, max: 18 },
    { name: 'c', label: '黏聚力 c', unit: 'kPa', default: 5, min: 0, max: 20 },
    { name: 'phi', label: '内摩擦角 φ', unit: '°', default: 25, min: 0, max: 45 },
    { name: 'waterTableDepth', label: '地下水位埋深', unit: 'm', default: 10, min: 0, max: 30 },
    { name: 'seismicCoeff', label: '地震系数 kv', default: 0, min: 0, max: 0.3 },
    { name: 'surcharge', label: '堆顶超载 q', unit: 'kPa', default: 0, min: 0, max: 50 },
  ],
  capacity: [
    { name: 'A', label: '填埋面积', unit: 'ha', default: 10, min: 1, max: 50 },
    { name: 'H', label: '平均填埋深度', unit: 'm', default: 30, min: 5, max: 80 },
    { name: 'rho', label: '垃圾填埋密度', unit: 'kN/m³', default: 10, min: 5, max: 15 },
    { name: 'Qd', label: '日均垃圾填入量', unit: 'm³/d', default: 500, min: 50, max: 5000 },
    { name: 'phases', label: '填埋分期数', default: 1, min: 1, max: 5 },
    { name: 'coverRatio', label: '日覆土比', default: 0.1, min: 0, max: 0.5 },
    { name: 'sFactor', label: '沉降折减系数', default: 1, min: 0.7, max: 1 },
  ],
  settlementHyper: [
    { name: 't1', label: '观测时间 t1', unit: 'd', default: 30, min: 1, max: 365 },
    { name: 's1', label: '沉降量 s1', unit: 'mm', default: 50, min: 0, max: 500 },
    { name: 't2', label: '观测时间 t2', unit: 'd', default: 180, min: 30, max: 3650 },
    { name: 's2', label: '沉降量 s2', unit: 'mm', default: 200, min: 0, max: 2000 },
  ],
  optimizeWellSpacing: [
    { name: 'effectiveRadius', label: '有效影响半径', unit: 'm', default: 30, min: 5, max: 100 },
    { name: 'pattern', label: '布井方式', type: 'select', options: ['hexagonal', 'square'], default: 'hexagonal' },
    { name: 'drawdown', label: '单井降深', unit: 'm', default: 5, min: 0.5, max: 30 },
    { name: 'interferenceFactor', label: '井群干扰系数', default: 0.4, min: 0, max: 1 },
  ],
  leachateCalc: [
    { name: 'area', label: '填埋面积', unit: '万㎡', default: 30, min: 1, max: 200 },
    { name: 'rainfall', label: '年降雨量', unit: 'mm', default: 1200, min: 200, max: 3000 },
    { name: 'runoffCoeff', label: '径流系数', default: 0.3, min: 0.05, max: 0.9 },
    { name: 'wasteHeight', label: '垃圾覆盖厚度', unit: 'm', default: 0, min: 0, max: 20 },
    { name: 'ET', label: '蒸散发量', unit: 'mm', default: 800, min: 100, max: 1500 },
    { name: 'cloggingFactor', label: '导排堵塞', default: 0, min: 0, max: 1 },
    { name: 'recirculationRatio', label: '回喷比', default: 0, min: 0, max: 0.5 },
  ],
  moisturePredict: [
    { name: 'initialMoisture', label: '初始含水率', unit: '%', default: 60, min: 20, max: 90 },
    { name: 'injectionPressure', label: '注气压力', unit: 'kPa', default: 15, min: 5, max: 50 },
    { name: 'days', label: '处理天数', unit: 'd', default: 7, min: 1, max: 60 },
    { name: 'depth', label: '处理深度', unit: 'm', default: 5, min: 1, max: 30 },
    { name: 'gasFlow', label: '注气流量', unit: 'm³/h', default: 50, min: 5, max: 500 },
    { name: 'screenLength', label: '筛管长度', unit: 'm', default: 3, min: 0.5, max: 20 },
    { name: 'wellheadLoss', label: '井口损失', unit: 'kPa', default: 1, min: 0, max: 10 },
  ],
  lfgYield: [
    { name: 'M', label: '垃圾量', unit: '万吨', default: 500, min: 10, max: 5000 },
    { name: 'k', label: '降解速率 k', unit: '/a', default: 0.1, min: 0.01, max: 0.5 },
    { name: 'year', label: '填埋龄期', unit: 'a', default: 10, min: 0, max: 50 },
    { name: 'Lo', label: '产气潜力 L₀', unit: 'm³/t', default: 170, min: 50, max: 300 },
    { name: 'utilizationFactor', label: '利用率', default: 0.5, min: 0, max: 1 },
    { name: 'flareEfficiency', label: '火炬效率', default: 0.9, min: 0, max: 1 },
  ],
  hdpeCheck: [
    { name: 'D', label: '膜厚', unit: 'mm', default: 1.5, min: 0.5, max: 3 },
    { name: 'sigma', label: '最大应力', unit: 'MPa', default: 27, min: 10, max: 50 },
    { name: 'eps', label: '应变', unit: '%', default: 700, min: 100, max: 1000 },
    { name: 'P', label: '焊缝气压', unit: 'MPa', default: 0.2, min: 0.1, max: 0.5 },
    { name: 'hold', label: '持压时间', unit: 'min', default: 5, min: 1, max: 30 },
    { name: 'carbonBlack', label: '炭黑含量', unit: '%', default: 2.5, min: 0, max: 5 },
    { name: 'punctureResistance', label: '抗穿刺力', unit: 'N', default: 480, min: 0, max: 1000 },
    { name: 'oxidInductionTime', label: '氧化诱导时间', unit: 'min', default: 100, min: 0, max: 300 },
  ],
  linerKeq: [
    { name: 'd1', label: 'HDPE 厚度 d1', unit: 'mm', default: 1.5, min: 0.5, max: 3 },
    { name: 'k1', label: 'HDPE 渗透 k1', unit: 'cm/s', default: 1e-7, min: 0 },
    { name: 'd2', label: 'GCL 厚度 d2', unit: 'mm', default: 6, min: 2, max: 12 },
    { name: 'k2', label: 'GCL 渗透 k2', unit: 'cm/s', default: 1e-9, min: 0 },
    { name: 'theta', label: '缺陷率 θ', default: 0.1, min: 0, max: 0.5 },
    { name: 'seamLength', label: '接缝长度', unit: 'm/ha', default: 50, min: 0, max: 200 },
    { name: 'chemicalCompatibility', label: '化学兼容', default: 1, min: 0, max: 1 },
  ],
  wellR: [
    { name: 'Q', label: '抽注流量', unit: 'm³/d', default: 100, min: 10, max: 1000 },
    { name: 't', label: '运行时间', unit: 'd', default: 30, min: 1, max: 365 },
    { name: 'ne', label: '有效孔隙度', default: 0.3, min: 0.05, max: 0.5 },
    { name: 'dh', label: '水位变幅', unit: 'm', default: 2, min: 0.5, max: 10 },
    { name: 'aquiferType', label: '含水层', type: 'select', options: ['unconfined', 'confined'], default: 'unconfined' },
    { name: 'thickness', label: '含水层厚度', unit: 'm', default: 20, min: 1, max: 200 },
  ],
  injectR: [
    { name: 'Pinj', label: '注气压力', unit: 'kPa', default: 4, min: 0, max: 20 },
    { name: 't', label: '处理时间', unit: 'h', default: 24, min: 1, max: 200 },
    { name: 'mu', label: '动力黏度', default: 1, min: 0.1, max: 5 },
    { name: 'k', label: '渗透率系数', default: 1, min: 0.1, max: 5 },
    { name: 'porosity', label: '孔隙度', default: 0.3, min: 0.1, max: 0.5 },
    { name: 'gasViscosity', label: '气体黏度', unit: 'cP', default: 0.018, min: 0.01, max: 0.1 },
    { name: 'formationCompressibility', label: '地层压缩系数', unit: '1/kPa', default: 1e-6, min: 1e-7, max: 1e-4 },
  ],
  advect: [
    { name: 'C0', label: '源浓度 C0', unit: 'mg/L', default: 100, min: 0, max: 1000 },
    { name: 'v', label: '流速 v', unit: 'm/d', default: 0.1, min: 0, max: 5 },
    { name: 'x', label: '迁移距离 x', unit: 'm', default: 50, min: 0, max: 500 },
    { name: 'D', label: '弥散系数 D', unit: 'm²/d', default: 10, min: 0.1, max: 100 },
    { name: 'retardationFactor', label: '阻滞因子 Rd', default: 1, min: 1, max: 10 },
    { name: 'decayRate', label: '衰减常数 λ', unit: '1/d', default: 0, min: 0, max: 0.01 },
  ],
  soilScreen: [
    { name: 'pol', label: '污染物', type: 'select', options: ['砷', '镉', '铅', '汞', '镍', '苯', '铬(六价)'], default: '砷' },
    { name: 'cls', label: '用地类型', type: 'select', options: ['一类(居住/学校)', '二类(工业/商业)'], default: '一类(居住/学校)' },
    { name: 'depthLayer', label: '深度分层', type: 'select', options: ['0-0.5', '0.5-1.5', '1.5+'], default: '0.5-1.5' },
  ],
  decayCalc: [
    { name: 'C0', label: '初始浓度 C0', unit: 'mg/L', default: 500, min: 0, max: 5000 },
    { name: 'Ctarget', label: '目标浓度 Ct', unit: 'mg/L', default: 50, min: 0, max: 1000 },
    { name: 't12', label: '半衰期 t½', unit: 'd', default: 1000, min: 10, max: 10000 },
    { name: 'monitoringCostPerYear', label: '年监测成本', unit: '万元', default: 8, min: 0, max: 100 },
  ],
};

/** 从元数据派生默认参数表（供工具/前端一致使用） */
export function calcDefaults(name: string): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const p of CALC_PARAM_META[name] ?? []) {
    if (p.default !== undefined) out[p.name] = p.default;
  }
  return out;
}

/** 计算器中文显示名 */
export const CALC_LABELS: Record<string, string> = {
  slopeFs: '边坡稳定安全系数 Fs',
  capacity: '库容与使用年限',
  settlementHyper: '双曲线沉降预测',
  optimizeWellSpacing: '导气/注水井距优化',
  leachateCalc: '渗滤液产液量',
  moisturePredict: '含水率预测',
  lfgYield: '填埋气产量 LandGEM',
  hdpeCheck: 'HDPE 土工膜验算',
  linerKeq: '衬垫系统等效渗透系数',
  wellR: '抽注井有效影响半径',
  injectR: '注气有效影响半径',
  advect: '地下水污染物对流弥散',
  soilScreen: '土壤筛选值对照',
  decayCalc: '污染物自然衰减达标时间',
};

export default { CALC_PARAM_META, calcDefaults, CALC_LABELS };