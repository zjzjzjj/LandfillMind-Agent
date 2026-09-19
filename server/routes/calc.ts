/**
 * routes/calc.ts · 从 server/index.ts 拆出的计算器路由模块
 * 导出 num / CALC_REGISTRY 供 index.ts 的 chat 工具路径与 health/bootstrap 使用
 */

import { Router } from 'express';
import * as calc from '../calculate.js';
import { gaussian } from '../calculate.js';

// ============ 计算器 ============
// num: 将输入宽松转为有限数字；缺失/非法时回退到默认值（避免透传把整个对象当位置参数导致 NaN）
export function num(v: any, def?: number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : (def ?? NaN);
}

export const CALC_REGISTRY: Record<string, (params: any) => any> = {
  // v4.5 全部走 calculate.ts 的新函数，extra 字段透传
  slopeFs: (p: any) => {
    const r = calc.slopeFs(
      num(p.H, 30), num(p.beta, 3), num(p.gamma, 10), num(p.c, 5), num(p.phi, 25),
      num(p.waterTableDepth, 10), num(p.seismicCoeff, 0), num(p.surcharge, 0),
    );
    return { ...r };
  },
  capacity: (p: any) => {
    const r = calc.capacity(
      num(p.A, 10), num(p.H, 30), num(p.rho, 10), num(p.Qd, 500),
      Math.max(1, num(p.phases, 1)), num(p.coverRatio, 0), num(p.sFactor, 1),
    );
    return { ...r };
  },
  settlementHyper: (p: any) => {
    const r = calc.settlementHyper(num(p.t1, 30), num(p.s1, 50), num(p.t2, 180), num(p.s2, 200));
    return { ...r };
  },
  optimizeWellSpacing: (p: any) => {
    const r = calc.optimizeWellSpacing(
      num(p.effectiveRadius, num(p.H, 30)),
      p.pattern ?? 'hexagonal',
      num(p.drawdown, 5),
      num(p.interferenceFactor, 0.4),
    );
    return { ...r };
  },
  leachateCalc: (p: any) => {
    // area 仍按"万㎡"输入，内部 ×10000 → m²
    const r = calc.calculateLeachate(
      num(p.area) * 10000, num(p.rainfall, 1200),
      num(p.runoffCoeff, 0.3), num(p.wasteHeight, 0),
      num(p.ET, 800), num(p.cloggingFactor, 0), num(p.recirculationRatio, 0),
    );
    return { ...r };
  },
  moisturePredict: (p: any) => {
    const r = calc.predictMoisture(
      num(p.initialMoisture, 60), num(p.injectionPressure, 15), num(p.days, 7), num(p.depth, 5),
      num(p.gasFlow, 50), num(p.screenLength, 3), num(p.wellheadLoss, 1),
    );
    return { ...r };
  },
  lfgYield: (p: any) => {
    const r = calc.lfgYield(
      num(p.M, 500), num(p.k, 0.1), num(p.year, 10), num(p.Lo, 170),
      num(p.utilizationFactor, 0.5), num(p.flareEfficiency, 0.9),
    );
    return { ...r };
  },
  hdpeCheck: (p: any) => {
    const r = calc.hdpeCheck(
      num(p.D, 1.5), num(p.sigma, 27), num(p.eps, 700),
      num(p.P, 0.2), num(p.hold, 5),
      num(p.carbonBlack, 2.5), num(p.punctureResistance, 480), num(p.oxidInductionTime, 100),
    );
    return { ...r };
  },
  linerKeq: (p: any) => {
    const r = calc.linerKeq(
      num(p.d1, 1.5), num(p.k1, 0.0000001), num(p.d2, 6), num(p.k2, 0.000000001), num(p.theta, 0.1),
      num(p.seamLength, 50), num(p.chemicalCompatibility, 1),
    );
    return { ...r };
  },
  wellR: (p: any) => {
    const r = calc.wellR(
      num(p.Q, 100), num(p.t, 30), num(p.ne, 0.3), num(p.dh, 2),
      p.aquiferType ?? 'unconfined', num(p.thickness, 20),
    );
    return { ...r };
  },
  injectR: (p: any) => {
    const r = calc.injectR(
      num(p.Pinj, 4), num(p.t, 24), num(p.mu, 1.0), num(p.k, 1.0),
      num(p.porosity, 0.3), num(p.gasViscosity, 0.018), num(p.formationCompressibility, 1e-6),
    );
    return { ...r };
  },
  advect: (p: any) => {
    const r = calc.advect(
      num(p.C0, 100), num(p.v, 0.1), num(p.x, 50), num(p.D, 10),
      num(p.retardationFactor, 1), num(p.decayRate, 0),
    );
    return { ...r };
  },
  soilScreen: (p: any) => {
    const r = calc.soilScreen(p.pol ?? '砷', p.cls ?? '一类(居住/学校)', p.depthLayer ?? '0.5-1.5');
    return { ...r };
  },
  decayCalc: (p: any) => {
    const r = calc.decayCalc(num(p.C0, 500), num(p.Ctarget, 50), num(p.t12, 1000), num(p.monitoringCostPerYear, 8));
    return { ...r };
  },
};

// 各计算器的规范公式（用于计算书"计算公式"章节，公式按规范/经验式给出）
// v5：导出供 tools.ts calculate 工具与报告生成共用（单一来源）
export const CALC_FORMULAS: Record<string, string> = {
  slopeFs: 'Fs = (c + γ′·H·cos²α·tanφ) / (γ·H·sinα·cosα + kv·W + q·H)，α = atan(1/β)；运行期要求 Fs ≥ 1.30（CJJ 176-2012 §4.5）',
  capacity: 'V = A·H·10⁴；使用年限 T = W / (Qd × 365)（CJJ 176-2012 §3.3）',
  hdpeCheck: 'D ≥ 1.5mm；σ ≥ 27MPa；ε ≥ 700%；焊缝气压 0.2MPa 持压 5min 压降 <10%（GB/T 17643-2011 / GB 16889-2008 §5.1）',
  wellR: 'R = 0.6·L·(Q/100)^0.25·(Δh/2)^0.2（GCW 稳态经验式，与 t 无关）',
  injectR: 'R = 4·√(Pinj/4)·√(t/24)·√k·√(0.3/φ)（经验式，量级 2~8m，副因子 μ/cf 微调）',
  leachateCalc: 'Q = A·P·C·η / 1000（A=面积㎡，P=年降雨mm，C=径流系数，η=覆盖折减）（CJJ 176-2012 §5.1）',
  lfgYield: 'Q(t) = k·L₀·M·exp(−k·t)（USEPA LandGEM 一阶衰减）',
  advect: 'C(x) = C0·exp(−v·x/D)（HJ 25.6-2019）',
  soilScreen: 'C ≤ GB 36600-2018 表1 筛选值/管制值',
  decayCalc: 'T = ln(C0/Ct) / λ；λ = ln2 / t½（HJ 25.6-2019）',
  linerKeq: 'k_eq = d_total² / (d₂²/k₂ + d₁·d₂·θ/k₁)；k_eq ≤ 1×10⁻⁹ cm/s（GB 16889-2008 §5.1）',
  settlementHyper: 's(t) = s∞·t / (a + t)（CJJ 176-2012 §4.6，双曲线法）',
  optimizeWellSpacing: 'D = √3·R（梅花形）或 2R（方形），井群叠加降深 = 单井 × (1+interference)',
  moisturePredict: 'ΔS = inflow − et − runoff；储水量上限 = storageMax（CJJ 176-2012 §5.3）',
  // v4.5 移除 extractionPressure（占位实现 + 字段脱钩）
};

// 单计算器路由放在最后（避免抢匹配 /api/calc/sensitivity 等保留路由）
// 见下：app.post('/api/calc/:name', ...)

export function calcRouter(): Router {
  const r = Router();
r.get('/api/calc', (_req, res) => {
  res.json({ count: Object.keys(CALC_REGISTRY).length, names: Object.keys(CALC_REGISTRY) });
});

// ============ v4.3 新增：敏感性分析 ============
// POST /api/calc/sensitivity
//   body: { name, params, varyParam, n?, range? }
//   → { xs, ys, baseValue, baseX, param, unit }
r.post('/api/calc/sensitivity', (req, res) => {
  const { name, params = {}, varyParam, n = 20, range } = req.body ?? {};
  if (!name || !CALC_REGISTRY[name]) {
    return res.status(400).json({ error: `未知计算器: ${name}`, available: Object.keys(CALC_REGISTRY) });
  }
  if (!varyParam) {
    return res.status(400).json({ error: '缺少 varyParam' });
  }
  const fn = CALC_REGISTRY[name];
  const baseX = num(params[varyParam], 1);
  let lo: number, hi: number;
  if (Array.isArray(range) && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
    [lo, hi] = range;
  } else {
    // 默认 baseX ± 50%，且下界 ≥ 0
    const half = Math.max(Math.abs(baseX) * 0.5, 1);
    lo = Math.max(0, baseX - half);
    hi = baseX + half;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const steps = Math.max(2, Math.min(50, Math.floor(n)));
  for (let i = 0; i < steps; i++) {
    const x = lo + (hi - lo) * (i / (steps - 1));
    xs.push(x);
    const testParams: any = { ...params, [varyParam]: x };
    try {
      const r = fn(testParams);
      const y = typeof r?.value === 'number' ? r.value : NaN;
      ys.push(y);
    } catch {
      ys.push(NaN);
    }
  }
  // 基准值（用原参数跑一次）
  let baseValue: number = NaN;
  try {
    const r0 = fn(params);
    baseValue = typeof r0?.value === 'number' ? r0.value : NaN;
  } catch { /* 保持 NaN */ }
  res.json({ xs, ys, baseValue, baseX, param: varyParam });
});

// ============ v4.3 新增：蒙特卡洛风险评估 ============
// POST /api/calc/montecarlo
//   body: { name, params, paramDist, threshold, iterations? }
//   → { samples, mean, p5, p50, p95, min, max, failProb, threshold, iterations }
r.post('/api/calc/montecarlo', (req, res) => {
  const {
    name, params = {},
    paramDist = {},
    threshold = { op: '<', value: 1.3 },
    iterations = 500,
  } = req.body ?? {};
  if (!name || !CALC_REGISTRY[name]) {
    return res.status(400).json({ error: `未知计算器: ${name}`, available: Object.keys(CALC_REGISTRY) });
  }
  if (!threshold || typeof threshold.value !== 'number' || !['<', '<=', '>', '>='].includes(threshold.op)) {
    return res.status(400).json({ error: 'threshold 必须是 {op, value} 且 op ∈ {<, <=, >, >=' });
  }
  const fn = CALC_REGISTRY[name];
  const N = Math.max(50, Math.min(2000, Math.floor(iterations)));
  const samples: number[] = [];
  let failCount = 0;
  // 对每个 paramDist 的 key，生成扰动后的参数
  const distKeys = Object.keys(paramDist);
  for (let i = 0; i < N; i++) {
    const sampleParams: any = { ...params };
    for (const k of distKeys) {
      const { mean, std } = paramDist[k] ?? {};
      if (typeof mean === 'number' && typeof std === 'number' && std > 0) {
        const base = num(params[k], mean);
        const perturbed = base + gaussian() * std;
        sampleParams[k] = Math.max(0, perturbed); // 物理量非负
      }
    }
    try {
      const r = fn(sampleParams);
      const v = typeof r?.value === 'number' ? r.value : null;
      if (v !== null) {
        samples.push(v);
        // 阈值判定
        const op = threshold.op;
        const tv = threshold.value;
        if ((op === '<' && v < tv) || (op === '<=' && v <= tv) || (op === '>' && v > tv) || (op === '>=' && v >= tv)) {
          failCount++;
        }
      }
    } catch { /* skip failed sample */ }
  }
  if (samples.length === 0) {
    return res.status(500).json({ error: '蒙特卡洛采样全部失败，请检查参数' });
  }
  // 排序取分位数
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  res.json({
    samples,
    mean,
    p5: q(0.05),
    p50: q(0.50),
    p95: q(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    failProb: failCount / samples.length,
    threshold: threshold.value,
    iterations: samples.length,
  });
});

// ============ v4.3 新增：场景对比 ============
// POST /api/calc/compare
//   body: { name, scenarios: [{ label, params }] }
//   → { results: [{ label, value, grade, unit, analysis }] }
r.post('/api/calc/compare', (req, res) => {
  const { name, scenarios = [] } = req.body ?? {};
  if (!name || !CALC_REGISTRY[name]) {
    return res.status(400).json({ error: `未知计算器: ${name}`, available: Object.keys(CALC_REGISTRY) });
  }
  if (!Array.isArray(scenarios) || scenarios.length < 2) {
    return res.status(400).json({ error: 'scenarios 至少 2 个' });
  }
  const fn = CALC_REGISTRY[name];
  const results = scenarios.map((sc: any) => {
    try {
      const r = fn(sc.params ?? {});
      return {
        label: String(sc.label ?? '未命名场景'),
        value: r?.value,
        unit: r?.unit,
        grade: r?.grade,
        analysis: r?.analysis,
      };
    } catch (e: any) {
      return { label: String(sc.label ?? '未命名场景'), error: e?.message ?? '计算失败' };
    }
  });
  res.json({ name, results });
});

// ============ 单计算器：放在最后（避免抢匹配 /api/calc/sensitivity/montecarlo/compare） ============
r.post('/api/calc/:name', (req, res) => {
  const { name } = req.params;
  // 保留路由名，让其他路由有机会处理
  if (['sensitivity', 'montecarlo', 'compare'].includes(name)) {
    return res.status(404).json({ error: `未知计算器: ${name}`, available: Object.keys(CALC_REGISTRY) });
  }
  const fn = CALC_REGISTRY[name];
  if (!fn) {
    return res.status(400).json({ error: `未知计算器: ${name}`, available: Object.keys(CALC_REGISTRY) });
  }
  try {
    const result = fn(req.body || {});
    if (result && typeof result === 'object' && !result.formula) result.formula = CALC_FORMULAS[name] ?? '';
    res.json({ name, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? '计算失败' });
  }
});
  return r;
}
