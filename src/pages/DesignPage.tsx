/**
 * LandfillMind · 计算中心 v4.6（过程曲线 + 模块联动）
 *
 * 布局：左 240px 计算器列表 + 右 主区（单列流式）
 *   - 顶部条：标题 + 预设切换 + 立即计算按钮
 *   - 参数输入（单列，不撑宽）
 *   - 计算结果（KPI 卡 + 安全系数仪表）
 *   - 敏感性曲线
 *   - 公式推导（折叠）
 *   - 3 个聚合视图：场景对比 / 蒙特卡洛 / 成本估算（独立全宽视图）
 *
 * 主计算手动触发（"立即计算"按钮）；敏感性/蒙特卡洛/成本等辅助计算用 debounce
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calculator, Search, Sliders, GitCompare, Activity,
  ChevronRight, FileDown, RotateCcw, FileText, Sparkles,
  TrendingUp, ShieldAlert, BookOpen, Play, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { CalcResult } from '../types';
import {
  buildCalcMarkdown, downloadJSON, downloadText, openPrintableHtml, timestampName,
} from '../utils/exporter';
import { ResultInterpretation } from '../components/ResultInterpretation';
import { CalculationAnimation } from '../components/CalculationAnimation';
import { SafetyFactorGauge } from '../components/SafetyFactorGauge';
import { HistogramChart } from '../components/HistogramChart';
import TimeSeriesChart, { seriesColor } from '../components/TimeSeriesChart';
import { PRESETS, PRESET_LABELS, applyPreset, suggestVaryParam, estimateCost, type PresetName } from '../utils/calcPresets';
import { widePx } from '../utils/layout';
import { CALC_PARAM_META } from '../../server/calc-meta';

/** 联动跳转小按钮 */
function LinkChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] px-2 py-1 rounded-full border transition-colors"
      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
    >
      {label}
    </button>
  );
}

/** 敏感性分析专用曲线：X=参数取值，Y=结果值；标注基准点与规范参考线（CSS 变量自适应深浅主题） */
function SensitivityCurve({ xs, ys, baseX, baseValue, unit, refLine, height = 180 }: {
  xs: number[]; ys: number[]; baseX: number; baseValue: number; unit?: string; refLine?: number; height?: number;
}) {
  const W = 640, H = height, PAD_L = 52, PAD_R = 14, PAD_T = 12, PAD_B = 26;
  if (!xs.length || xs.length !== ys.length) return null;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys, refLine ?? Infinity), yMax = Math.max(...ys, refLine ?? -Infinity);
  const xR = xMax - xMin || 1, yR = yMax - yMin || 1;
  const X = (x: number) => PAD_L + (x - xMin) / xR * (W - PAD_L - PAD_R);
  const Y = (v: number) => H - PAD_B - (v - yMin) / yR * (H - PAD_T - PAD_B);
  const path = xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => yMin + f * yR);
  const xTickIdx = [0, Math.floor(xs.length / 2), xs.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="敏感性曲线">
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={PAD_L} y1={Y(v)} x2={W - PAD_R} y2={Y(v)} stroke="var(--border)" strokeOpacity="0.5" strokeDasharray="2,3" />
          <text x={PAD_L - 5} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">{v.toFixed(Math.abs(yR) < 0.1 ? 3 : 1)}</text>
        </g>
      ))}
      {xTickIdx.map((i) => (
        <text key={`x${i}`} x={X(xs[i])} y={H - PAD_B + 13} textAnchor="middle" fontSize="9" fill="var(--text-muted)">{xs[i].toFixed(2)}</text>
      ))}
      {refLine !== undefined && refLine >= yMin && refLine <= yMax && (
        <g>
          <line x1={PAD_L} y1={Y(refLine)} x2={W - PAD_R} y2={Y(refLine)} stroke="#dc2626" strokeWidth="1" strokeDasharray="6,4" opacity="0.7" />
          <text x={W - PAD_R} y={Y(refLine) - 4} textAnchor="end" fontSize="9" fill="#dc2626">限值 {refLine}</text>
        </g>
      )}
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--border)" />
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="var(--border)" />
      <path d={path} fill="none" stroke="#06b6d4" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={X(x)} cy={Y(ys[i])} r="2.5" fill="#06b6d4" />)}
      {/* 基准点 */}
      <circle cx={X(baseX)} cy={Y(baseValue)} r="4.5" fill="#f59e0b" stroke="var(--bg-surface)" strokeWidth="2" />
      <text x={X(baseX)} y={Y(baseValue) - 9} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="#f59e0b">
        {baseValue.toFixed(2)}{unit ? ' ' + unit : ''}
      </text>
      <text x={W - PAD_R} y={H - PAD_B + 24} textAnchor="end" fontSize="8.5" fill="var(--text-muted)">参数取值 →</text>
    </svg>
  );
}

// ============================================================
// 计算器清单
// ============================================================
const CALC_LIST = [
  { id: 'slopeFs',          name: '堆体稳定 Fs',         desc: '圆弧滑动法',                ref: 'CJJ 176 §4.5',         cat: '边坡' },
  { id: 'capacity',         name: '库容与年限',           desc: '填埋场库容估算',              ref: 'CJJ 176 §3.3',         cat: '容量' },
  { id: 'settlementHyper',  name: '沉降预测',             desc: '双曲线法',                   ref: 'CJJ 176 §4.6',         cat: '边坡' },
  { id: 'optimizeWellSpacing', name: '井间距优化',          desc: '抽水井最优井间距',            ref: 'CJJ 176 §5.2',         cat: '地下水' },
  { id: 'leachateCalc',     name: '渗滤液产量',           desc: '降雨入渗估算',                ref: 'CJJ 176 §5.1',         cat: '水气' },
  { id: 'moisturePredict',  name: '水量平衡',             desc: '入流-蒸散-径流-储量',          ref: 'CJJ 176 §5.3',         cat: '水气' },
  { id: 'lfgYield',         name: '填埋气产气量',         desc: 'LandGEM 一阶衰减',             ref: 'USEPA LandGEM',        cat: '水气' },
  // v4.5 移除 extractionPressure（占位实现 + 字段脱钩）
  { id: 'hdpeCheck',        name: 'HDPE 膜验算',          desc: 'HDPE 膜厚度/焊缝',            ref: 'GB/T 17643',           cat: '防渗' },
  { id: 'linerKeq',         name: '复合衬垫等效渗透',     desc: 'HDPE+GCL 等效 k',             ref: 'GB 16889 §5.1',        cat: '防渗' },
  { id: 'wellR',            name: '循环井影响半径',       desc: '地下水循环井影响范围',         ref: 'HJ 25.6',              cat: '地下水' },
  { id: 'injectR',          name: '注气驱替半径',         desc: '循环井注气影响半径',           ref: 'CJJ 176 §5.2',         cat: '地下水' },
  { id: 'advect',           name: '污染物对流-弥散',      desc: '地下水迁移浓度',               ref: 'HJ 25.6',              cat: '地下水' },
  { id: 'soilScreen',       name: '土壤筛选值',           desc: '建设用地风险筛选',             ref: 'GB 36600-2018',        cat: '地下水' },
  { id: 'decayCalc',        name: '衰减达标年限',         desc: '自然衰减达标',                 ref: 'HJ 25.6',              cat: '地下水' },
];

const COMPARE_ID = '__compare__';
const MONTE_ID = '__monte__';
const COST_ID = '__cost__';

// ============================================================
// 参数定义
// ============================================================
// 参数元数据单一来源：这里原本整份手抄了 server/calc-meta.ts 的 CALC_PARAM_META，
// 双源漂移已造成真实错误（ρ 被标成 kN/m³ 且默认 10，内核却按 t/m³ 与 0.9 判定）。
const PARAMS_MAP = CALC_PARAM_META;

const THRESHOLDS: Record<string, Array<{ min?: number; max?: number; label: string; color: string }>> = {
  slopeFs: [
    { max: 1.0, label: '失稳', color: '#dc2626' },
    { min: 1.0, max: 1.2, label: '欠稳定', color: '#ea580c' },
    { min: 1.2, max: 1.3, label: '基本稳定', color: '#ca8a04' },
    { min: 1.3, max: 1.5, label: '稳定', color: '#16a34a' },
    { min: 1.5, label: '高裕度', color: '#0891b2' },
  ],
  hdpeCheck: [
    { max: 1.5, label: '不达标', color: '#dc2626' },
    { min: 1.5, max: 2.0, label: '达标', color: '#16a34a' },
    { min: 2.0, label: '偏厚', color: '#0891b2' },
  ],
  linerKeq: [
    { min: 1e-7, label: '超标', color: '#dc2626' },
    { min: 1e-9, max: 1e-7, label: '合规', color: '#16a34a' },
    { max: 1e-9, label: '优秀', color: '#0891b2' },
  ],
};

const GRADE_COLOR: Record<string, string> = {
  red: '#dc2626', orange: '#ea580c', yellow: '#ca8a04', blue: '#2563eb', green: '#16a34a',
};

// ============================================================
// Hooks
// ============================================================
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function loadSavedParams(calcId: string): Record<string, number | string> | null {
  try {
    const raw = localStorage.getItem(`design.params.${calcId}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}
function saveParams(calcId: string, params: Record<string, number | string>) {
  try { localStorage.setItem(`design.params.${calcId}`, JSON.stringify(params)); } catch { /* ignore */ }
}

// ============================================================
// 主组件
// ============================================================
export default function DesignPage() {
  // ============= 状态 =============
  const [selected, setSelected] = useState<string>('slopeFs');
  // 聚合视图（对比/蒙特卡洛）跟随最近使用过的数值型计算器（字符串值计算器服务端无法采样，排除）
  const AGGREGATE_IDS = new Set([COMPARE_ID, MONTE_ID, COST_ID]);
  const STRING_VALUE_CALCS = new Set(['hdpeCheck', 'soilScreen']);
  const [lastNumericCalc, setLastNumericCalc] = useState<string>('slopeFs');
  const [preset, setPreset] = useState<PresetName>('standard');
  const [params, setParams] = useState<Record<string, number | string>>(() => defaultParams('slopeFs'));
  const [result, setResult] = useState<CalcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [calcTrigger, setCalcTrigger] = useState(0); // 立即计算按钮
  const [varyParam, setVaryParam] = useState<string>('H');
  const [sensitivity, setSensitivity] = useState<{ xs: number[]; ys: number[]; baseValue: number; baseX: number } | null>(null);
  const [showFormula, setShowFormula] = useState(false);
  const [compareScenarios, setCompareScenarios] = useState(() => [
    { label: '现状', params: applyPreset('slopeFs', 'standard') },
    { label: '加固后', params: applyPreset('slopeFs', 'conservative') },
  ]);
  const [compareResult, setCompareResult] = useState<any>(null);
  const [monteParams, setMonteParams] = useState<{ param: string; std: number }[]>([{ param: 'H', std: 5 }]);
  const [monteResult, setMonteResult] = useState<any>(null);
  const [costInputs, setCostInputs] = useState({ capacityM3: 300000, leachateM3PerYear: 10000, monitorWells: 8 });

  // 辅助计算（敏感性/蒙特卡洛/场景对比/成本）用 debounce；主计算由 calcTrigger 手动触发
  const debouncedMonteParams = useDebounce(monteParams, 500);
  const debouncedCompareScenarios = useDebounce(compareScenarios, 500);
  const debouncedCostInputs = useDebounce(costInputs, 300);

  // ============= 切换计算器 =============
  const handleSelect = useCallback((id: string) => {
    setSelected(id);
    setResult(null);
    setSensitivity(null);
    const saved = loadSavedParams(id);
    const initial = saved ?? applyPreset(id, preset);
    setParams(initial);
    setVaryParam(suggestVaryParam(id, initial));
    setCalcTrigger(t => t + 1); // 切换时立即算一次
  }, [preset]);

  const handlePresetChange = useCallback((p: PresetName) => {
    setPreset(p);
    if (selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return;
    const newParams = applyPreset(selected, p);
    setParams(newParams);
    setVaryParam(suggestVaryParam(selected, newParams));
    setCalcTrigger(t => t + 1);
  }, [selected]);

  const handleCalculate = useCallback(() => {
    setCalcTrigger(t => t + 1);
  }, []);

  // ============= 手动计算（不监听参数变化，只在 calcTrigger 或 selected 变化时触发） =============
  useEffect(() => {
    if (selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return;
    if (!params || Object.keys(params).length === 0) return;
    setLoading(true);
    saveParams(selected, params);
    fetch(`/api/calc/${selected}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.value !== 'undefined') {
          setResult(data as CalcResult);
        } else if (data?.error) {
          setResult({ ok: false, value: NaN, grade: 'red', analysis: `错误：${data.error}`, ref: '' } as CalcResult);
        }
      })
      .catch(err => setResult({ ok: false, value: NaN, grade: 'red', analysis: `网络错误：${err?.message ?? err}`, ref: '' } as CalcResult))
      .finally(() => setLoading(false));
  }, [selected, calcTrigger]);  // 不依赖 debouncedParams —— 只在切换/按钮触发

  // 敏感性：也只在 calcTrigger 时跑
  useEffect(() => {
    if (selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return;
    if (!varyParam || !params[varyParam]) return;
    fetch('/api/calc/sensitivity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selected, params, varyParam, n: 24 }),
    })
      .then(r => r.json())
      .then(d => { if (d?.xs) setSensitivity(d); })
      .catch(() => setSensitivity(null));
  }, [selected, params, varyParam, calcTrigger]);

  // 记录最近使用的数值型计算器（供聚合视图跟随）
  useEffect(() => {
    if (!AGGREGATE_IDS.has(selected) && !STRING_VALUE_CALCS.has(selected)) setLastNumericCalc(selected);
  }, [selected]);

  // 场景对比
  useEffect(() => {
    if (selected !== COMPARE_ID) return;
    if (debouncedCompareScenarios.length < 2) return;
    const baseParams = debouncedCompareScenarios[0].params;
    const sampleId = guessCalcId(baseParams);
    fetch('/api/calc/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sampleId, scenarios: debouncedCompareScenarios }),
    })
      .then(r => r.json())
      .then(d => setCompareResult(d?.results ?? []))
      .catch(() => setCompareResult(null));
  }, [selected, debouncedCompareScenarios]);

  // 蒙特卡洛
  useEffect(() => {
    if (selected !== MONTE_ID) return;
    if (debouncedMonteParams.length === 0) return;
    const calcId = lastNumericCalc;
    const baseParams = applyPreset(calcId, preset);
    const paramDist: Record<string, { mean: number; std: number }> = {};
    debouncedMonteParams.forEach(({ param, std }) => {
      const v = baseParams[param];
      if (typeof v === 'number') paramDist[param] = { mean: v, std };
    });
    const payload: Record<string, unknown> = { name: calcId, params: baseParams, paramDist, iterations: 500 };
    // 阈值：取该计算器阈值表中红色档上限；无阈值表则不传（服务端跳过失败概率）
    const redMax = THRESHOLDS[calcId]?.find(t => t.color === '#dc2626')?.max;
    if (redMax !== undefined) payload.threshold = { op: '<', value: redMax };
    fetch('/api/calc/montecarlo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then(d => setMonteResult(d))
      .catch(() => setMonteResult(null));
  }, [selected, debouncedMonteParams, preset, lastNumericCalc]);

  // ============= 工具 =============
  const guessCalcId = (params: Record<string, number | string>): string =>
    Object.keys(PARAMS_MAP).find(id => PARAMS_MAP[id].every(d => params[d.name] !== undefined)) ?? lastNumericCalc;
  const updateParam = (name: string, value: number | string) => {
    setParams(prev => ({ ...prev, [name]: value }));
  };

  const exportMd = () => {
    if (!result || selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return;
    const calcItem = CALC_LIST.find(c => c.id === selected);
    downloadText(timestampName('计算书', 'md'), buildCalcMarkdown(calcItem?.name ?? selected, calcItem?.ref ?? '', params, result));
  };
  const exportHtml = () => {
    if (!result || selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return;
    const calcItem = CALC_LIST.find(c => c.id === selected);
    openPrintableHtml(`${calcItem?.name ?? selected} · 计算书`, buildCalcMarkdown(calcItem?.name ?? selected, calcItem?.ref ?? '', params, result));
  };
  const exportJson = () => {
    const calcItem = CALC_LIST.find(c => c.id === selected);
    downloadJSON(timestampName('计算书', 'json'), { calcName: calcItem?.name, calcId: selected, params, result, sensitivity });
  };

  const groupedCalcs = useMemo(() => {
    const cats = ['边坡', '容量', '水气', '防渗', '地下水'] as const;
    const map: Record<string, typeof CALC_LIST> = {};
    cats.forEach(c => { map[c] = []; });
    CALC_LIST.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.desc.includes(search))
      .forEach(c => { (map[c.cat] ??= []).push(c); });
    return cats.map(c => ({ cat: c, items: map[c] || [] })).filter(g => g.items.length > 0);
  }, [search]);

  const selectedCalc = CALC_LIST.find(c => c.id === selected);
  const costResult = useMemo(() => estimateCost(debouncedCostInputs), [debouncedCostInputs]);

  // 公式步骤
  const formulaSteps = useMemo(() => {
    if (!result || selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID) return [];
    const steps: { label: string; formula: string; detail: string; result?: string }[] = [];
    const paramsDisplay = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ');
    steps.push({ label: '1. 输入参数', formula: `params = { ${paramsDisplay} }`, detail: '来自表单' });
    if (selected === 'slopeFs') {
      // v5.1：不再在前端重算公式（此前这里硬编码了一份含 atan(1/β)/2 的旧实现，
      // 与后端 slopeFs 是两套代码，改一处就会出现"结果卡与计算书不一致"）。
      // 计算书改为直接呈现后端返回的中间量 extra —— 全站唯一口径。
      const ex = (result as any).extra ?? {};
      const fsVal = (result as any).value;
      steps.push({ label: '2. 代入计算器', formula: 'POST /api/calc/slopeFs', detail: '后端 calculate.ts · 统一边坡稳定内核' });
      steps.push({ label: '3. 坡角换算', formula: '坡角 α = atan(1/β)（β 为坡比倒数 1:β）', detail: `α = ${ex['坡角'] ?? '—'}` });
      steps.push({
        label: '4. 滑动力（单位宽度）',
        formula: 'T = γ · H · sinα · cosα + kv · W + q · H',
        detail: `自重驱动力 = ${ex['自重驱动力'] ?? '—'} kPa；地震贡献 = ${ex['地震贡献'] ?? '—'}；超载贡献 = ${ex['超载贡献'] ?? '—'}`,
      });
      steps.push({
        label: '5. 抗滑力',
        formula: 'R = c + γ′ · H · cos²α · tanφ（γ′ 按水位位置折减浮力）',
        detail: `总抗滑力 = ${ex['总抗滑力'] ?? '—'} kPa；滑面长度 = ${ex['弧长'] ?? '—'} m；水位位置 = ${ex['水位位置'] ?? '—'}`,
      });
      steps.push({
        label: '6. 安全系数 Fs',
        formula: 'Fs = R / T；运行期要求 Fs ≥ 1.30（CJJ 176-2012 §4.5）',
        detail: `Fs = ${fsVal}`,
        result: `${Number(fsVal) >= 1.3 ? '✓ 满足' : '✗ 不满足'}`,
      });
    } else {
      steps.push({ label: '2. 代入计算器', formula: `POST /api/calc/${selected}`, detail: '后端 calculate.ts 已实现' });
      steps.push({ label: '3. 输出', formula: 'CalcResult { value, grade, analysis, ref }', detail: result.analysis?.slice(0, 60) ?? '' });
    }
    return steps;
  }, [selected, params, result]);

  const sensitivityData = useMemo(() => {
    if (!sensitivity) return [];
    return sensitivity.xs.map((x, i) => ({ date: String(x.toFixed(1)), up: sensitivity.ys[i] || 0, down: 0 }));
  }, [sensitivity]);

  // ============= 渲染 =============
  return (
    <div className="flex h-full w-full" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* 左侧 240px 固定栏：计算器列表 */}
      <aside
        className="flex-shrink-0 flex flex-col overflow-hidden w-[240px] 3xl:w-[272px]"
        style={{ backgroundColor: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
      >
        <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Calculator size={15} style={{ color: 'var(--primary)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>计算工具库</span>
            <span className="text-[10px] ml-auto px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              v5.0 · 附属工具库
            </span>
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full text-xs pl-7 pr-2 py-1.5 rounded outline-none border"
              style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pt-2 pb-8">
          {groupedCalcs.map(group => (
            <div key={group.cat} className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1" style={{ color: 'var(--text-muted)' }}>
                {group.cat}
              </div>
              <div className="space-y-0.5">
                {group.items.map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleSelect(c.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors"
                    style={{
                      backgroundColor: selected === c.id ? 'rgba(14,165,183,0.10)' : 'transparent',
                      color: selected === c.id ? 'var(--primary)' : 'var(--text-secondary)',
                      borderLeft: selected === c.id ? '2px solid var(--primary)' : '2px solid transparent',
                    }}
                  >
                    <div className="truncate font-medium">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="text-[10px] font-semibold uppercase tracking-widest px-2 py-1 mt-4 pb-2" style={{ color: 'var(--text-muted)' }}>
            高级分析
          </div>
          <div className="space-y-0.5 pb-10">
            <SideNavItem icon={<GitCompare size={12} />} label="场景对比" active={selected === COMPARE_ID} onClick={() => { setSelected(COMPARE_ID); setResult(null); setSensitivity(null); }} />
            <SideNavItem icon={<Activity size={12} />} label="蒙特卡洛" active={selected === MONTE_ID} onClick={() => { setSelected(MONTE_ID); setResult(null); setSensitivity(null); }} />
            <SideNavItem icon={<TrendingUp size={12} />} label="成本估算" active={selected === COST_ID} onClick={() => { setSelected(COST_ID); setResult(null); setSensitivity(null); }} />
          </div>
        </div>
      </aside>

      {/* 主区：单列流式 */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* 顶部条 */}
        <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-2 min-w-0">
            <Sliders size={14} style={{ color: 'var(--primary)' }} />
            <span className="text-sm 3xl:text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {selected === COMPARE_ID ? '场景对比' :
               selected === MONTE_ID ? '蒙特卡洛风险评估' :
               selected === COST_ID ? '运营成本估算' :
               selectedCalc?.name}
            </span>
            {selectedCalc && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {selectedCalc.ref}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {/* 预设 */}
            {(['conservative', 'standard', 'aggressive'] as PresetName[]).map(p => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                disabled={selected === COMPARE_ID || selected === MONTE_ID || selected === COST_ID}
                className="text-[10px] px-2 py-1 rounded font-medium transition-colors disabled:opacity-30"
                style={{
                  backgroundColor: preset === p ? PRESET_LABELS[p].color + '20' : 'var(--bg-elevated)',
                  color: preset === p ? PRESET_LABELS[p].color : 'var(--text-muted)',
                  border: preset === p ? `1px solid ${PRESET_LABELS[p].color}40` : '1px solid transparent',
                }}
                title={PRESET_LABELS[p].desc}
              >
                {PRESET_LABELS[p].name}
              </button>
            ))}
            {/* 立即计算按钮 */}
            {selected !== COMPARE_ID && selected !== MONTE_ID && selected !== COST_ID && (
              <button
                onClick={handleCalculate}
                disabled={loading}
                className="ml-2 text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50"
                style={{ backgroundColor: 'var(--primary)', color: '#fff' }}
              >
                {loading ? <Activity size={12} className="animate-spin" /> : <Play size={12} />}
                {loading ? '计算中' : '立即计算'}
              </button>
            )}
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl 3xl:max-w-[1560px] mx-auto px-6 3xl:px-8 py-6 pb-24 space-y-5">
            {selected === COMPARE_ID ? (
              <CompareModeFull scenarios={compareScenarios} setScenarios={setCompareScenarios} result={compareResult} calcName={guessCalcId(compareScenarios[0]?.params ?? {})} />
            ) : selected === MONTE_ID ? (
              <MonteCarloFull
                calcId={lastNumericCalc}
                paramKeys={(PARAMS_MAP[lastNumericCalc] ?? []).filter(p => p.type !== 'select' && p.default !== undefined).map(p => p.name)}
                params={monteParams} setParams={setMonteParams}
                preset={preset} result={monteResult}
              />
            ) : selected === COST_ID ? (
              <CostFull inputs={costInputs} setInputs={setCostInputs} result={costResult} />
            ) : (
              <SingleModeFull
                selected={selected}
                params={params}
                result={result}
                loading={loading}
                varyParam={varyParam}
                setVaryParam={setVaryParam}
                sensitivity={sensitivity}
                sensitivityData={sensitivityData}
                formulaSteps={formulaSteps}
                showFormula={showFormula}
                setShowFormula={setShowFormula}
                updateParam={updateParam}
                onExportMd={exportMd}
                onExportHtml={exportHtml}
                onExportJson={exportJson}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function defaultParams(calcId: string): Record<string, number | string> {
  const defs = PARAMS_MAP[calcId] ?? [];
  const obj: Record<string, number | string> = {};
  defs.forEach(p => { obj[p.name] = p.default ?? (p.type === 'select' ? (p.options?.[0] ?? '') : 0); });
  return obj;
}

function SideNavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center gap-1.5"
      style={{
        backgroundColor: active ? 'rgba(14,165,183,0.10)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--text-secondary)',
        borderLeft: active ? '2px solid var(--primary)' : '2px solid transparent',
      }}
    >
      <span className="opacity-70">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

// ============================================================
// 单计算器（主区）— 单列流式
// ============================================================
function SingleModeFull(props: {
  selected: string;
  params: Record<string, number | string>;
  result: CalcResult | null;
  loading: boolean;
  varyParam: string;
  setVaryParam: (v: string) => void;
  sensitivity: { xs: number[]; ys: number[]; baseValue: number; baseX: number } | null;
  sensitivityData: { date: string; up: number; down: number }[];
  formulaSteps: { label: string; formula: string; detail: string; result?: string }[];
  showFormula: boolean;
  setShowFormula: (v: boolean) => void;
  updateParam: (name: string, value: number | string) => void;
  onExportMd: () => void;
  onExportHtml: () => void;
  onExportJson: () => void;
}) {
  const { selected, params, result, loading, varyParam, setVaryParam, sensitivity, sensitivityData, formulaSteps, showFormula, setShowFormula, updateParam, onExportMd, onExportHtml, onExportJson } = props;
  const navigate = useNavigate();
  const defs = PARAMS_MAP[selected] ?? [];
  const isFs = selected === 'slopeFs';
  const FsValue = isFs && result && typeof result.value === 'number' ? result.value : null;
  const thresholds = THRESHOLDS[selected];

  return (
    <>
      {/* 1+2. 两栏：参数输入（左）+ 计算结果（右） */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4 3xl:gap-6">
        <Card title="参数输入" icon={<Sliders size={13} />} hint="修改后点「立即计算」">
          <div className="space-y-2">
            {defs.map(p => (
              <ParamField key={p.name} param={p} value={params[p.name]} onChange={v => updateParam(p.name, v)} />
            ))}
          </div>
          <button
            onClick={() => {
              const init: Record<string, number | string> = {};
              defs.forEach(p => { if (p.default !== undefined) init[p.name] = p.default; });
              Object.keys(init).forEach(k => updateParam(k, init[k]));
            }}
            className="mt-3 w-full py-1.5 rounded-lg text-[11px] border flex items-center justify-center gap-1 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <RotateCcw size={11} /> 恢复默认参数
          </button>
        </Card>

        {result && (
          <Card title="计算结果" icon={<Sparkles size={13} />}>
            {isFs && FsValue !== null ? (
              <div className="flex flex-col items-center py-2">
                <SafetyFactorGauge Fs={FsValue} size={200} />
                {result.ref && (
                  <div className="text-[10px] font-mono mt-3" style={{ color: 'var(--text-muted)' }}>
                    规范：{result.ref}
                  </div>
                )}
                <ResultExtras extra={result.extra} />
              </div>
            ) : thresholds && typeof result.value === 'number' ? (
              <ResultInterpretation
                value={result.value}
                unit={result.unit ?? ''}
                label={CALC_LIST.find(c => c.id === selected)?.name ?? '计算结果'}
                thresholds={thresholds}
                interpretation={result.analysis ?? ''}
                reference={result.ref}
              />
            ) : (
              <PlainResult result={result} />
            )}
            {/* extras：isFs 分支已内嵌；阈值分支的 ResultInterpretation 不含 extras，在此补渲染；字符串值走 PlainResult 已内嵌 */}
            {thresholds && !isFs && typeof result.value === 'number' && result.value !== undefined && <ResultExtras extra={result.extra} />}
          </Card>
        )}

        {!result && (
          <Card title="计算结果" icon={<Sparkles size={13} />}>
            <div className="text-center text-xs py-12" style={{ color: 'var(--text-muted)' }}>
              <Calculator size={28} className="mx-auto mb-2 opacity-30" />
              <p>输入参数后点「立即计算」</p>
            </div>
          </Card>
        )}
      </div>

      {/* 3. 过程曲线（后端 series 字段：沉降时程 / LandGEM 曲线 / 对流-弥散剖面 / 渗滤液月产量） */}
      {result?.series && result.series.length > 0 && (
        <Card title="过程曲线" icon={<TrendingUp size={13} />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {result.series.map((s: { name: string; unit?: string; varName?: string; points: { t: number; v: number }[] }) => (
              <div key={s.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
                <p className="text-[11px] font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seriesColor(s.varName) }} />
                  {s.name}{s.unit ? `（${s.unit}）` : ''}
                </p>
                <TimeSeriesChart series={s} height={widePx(160, 200)} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 3.5 联动：结果 → 其它模块 */}
      {result && result.ok !== false && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          <span className="text-[10px] mr-1" style={{ color: 'var(--text-muted)' }}>联动：</span>
          {(selected === 'lfgYield') && (
            <LinkChip label="🌐 在稳定化计算中细化（ADM1 全组分）" onClick={() => {
              try {
                sessionStorage.setItem('ogs-prefill', JSON.stringify({
                  scenario: 'gas-production',
                  params: { wasteMass: params.M ?? 500, simYears: params.year ?? 20 },
                }));
              } catch { /* ignore */ }
              navigate('/ogs-sim');
            }} />
          )}
          {(selected === 'settlementHyper') && (
            <LinkChip label="🏔 OGS 沉降时程（日分辨率）" onClick={() => {
              try {
                sessionStorage.setItem('ogs-prefill', JSON.stringify({ scenario: 'settlement', params: {} }));
              } catch { /* ignore */ }
              navigate('/ogs-sim');
            }} />
          )}
          {result.series && result.series.length > 0 && (
            <LinkChip label="📈 曲线数据问专家" onClick={() => {
              const lines = [
                `【计算中心 · ${CALC_LIST.find(c => c.id === selected)?.name}】`,
                `结果：${typeof result.value === 'number' ? result.value + ' ' + (result.unit ?? '') : result.value}`,
                result.formula ? `公式：${result.formula}` : '',
                '',
                '请解释该结果的工程含义，并讨论参数不确定性对结论的影响。',
              ].filter(Boolean).join('\n');
              try { sessionStorage.setItem('chat-prefill', lines); } catch { /* ignore */ }
              navigate('/chat/new');
            }} />
          )}
        </div>
      )}

      {/* 4. 敏感性分析（对所有数值型计算器开放） */}
      {typeof result?.value === 'number' && defs.some(p => typeof params[p.name] === 'number') && (
        <Card title="敏感性分析" icon={<TrendingUp size={13} />}>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>变分参数：</span>
            {defs.filter(p => typeof params[p.name] === 'number').map(p => (
              <button
                key={p.name}
                onClick={() => setVaryParam(p.name)}
                className="text-[10px] px-2 py-0.5 rounded font-mono"
                style={{
                  backgroundColor: varyParam === p.name ? 'var(--primary)' : 'var(--bg-elevated)',
                  color: varyParam === p.name ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          {sensitivity ? (
            <>
              <SensitivityCurve
                xs={sensitivity.xs}
                ys={sensitivity.ys}
                baseX={sensitivity.baseX}
                baseValue={sensitivity.baseValue}
                unit={typeof result.value === 'number' ? (result.unit ?? '') : ''}
                refLine={isFs ? 1.30 : undefined}
                height={widePx(180, 220)}
              />
              <div className="mt-2 text-[10px] font-mono flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
                <span>基准：{sensitivity?.baseX?.toFixed(2)} → {typeof result.value === 'number' ? result.value.toFixed(2) : ''}{isFs ? ' (Fs)' : ''}</span>
                {isFs && sensitivity && sensitivity.baseValue && sensitivity.baseValue < 1.3 && (
                  <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                    <ShieldAlert size={9} className="inline mr-0.5" />低于规范
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>计算中…</div>
          )}
        </Card>
      )}

      {/* 4. 公式推导（折叠） */}
      {formulaSteps.length > 0 && (
        <Card
          title="公式推导"
          icon={<BookOpen size={13} />}
          collapsible
          expanded={showFormula}
          onToggle={() => setShowFormula(!showFormula)}
        >
          <CalculationAnimation steps={formulaSteps} autoPlay={false} speed={800} title="" />
        </Card>
      )}

      {/* 5. 导出 */}
      {result && (
        <Card title="导出计算书" icon={<FileDown size={13} />}>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onExportMd} className="text-xs px-3 py-1.5 rounded border flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <FileDown size={11} /> Markdown
            </button>
            <button onClick={onExportHtml} className="text-xs px-3 py-1.5 rounded border flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <FileText size={11} /> HTML·PDF
            </button>
            <button onClick={onExportJson} className="text-xs px-3 py-1.5 rounded border flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <FileDown size={11} /> JSON
            </button>
          </div>
        </Card>
      )}
    </>
  );
}

function ParamField({ param, value, onChange }: { param: NonNullable<typeof PARAMS_MAP[string]>[number]; value: number | string | undefined; onChange: (v: number | string) => void }) {
  if (param.type === 'select') {
    return (
      <div>
        <label className="flex items-center justify-between mb-0.5">
          <span className="text-[11px] 3xl:text-xs" style={{ color: 'var(--text-secondary)' }}>{param.label}</span>
        </label>
        <select
          value={String(value ?? param.default ?? '')}
          onChange={e => onChange(e.target.value)}
          className="w-full text-xs 3xl:text-sm px-2 py-1 rounded outline-none border"
          style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          {(param.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  const numVal = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return (
    <div>
      <label className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] 3xl:text-xs" style={{ color: 'var(--text-secondary)' }}>{param.label}</span>
        {param.unit && <span className="text-[9px] 3xl:text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{param.unit}</span>}
      </label>
      <input
        type="number"
        value={Number.isFinite(numVal) ? numVal : ''}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        min={param.min} max={param.max} step={param.step ?? 'any'}
        className="w-full text-xs px-2 py-1 rounded outline-none border font-mono"
        style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
      />
    </div>
  );
}

function PlainResult({ result }: { result: CalcResult }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold font-mono" style={{ color: GRADE_COLOR[result.grade] ?? 'var(--text-primary)' }}>
          {typeof result.value === 'number' ? result.value.toFixed(2) : '-'}
        </span>
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{result.unit}</span>
      </div>
      <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{result.analysis}</p>
      {result.formula && (
        <div className="mt-2 rounded-lg px-3 py-2 text-[11px] font-mono"
             style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--primary)' }}>
          ƒ {result.formula}
        </div>
      )}
      {result.ref && (
        <div className="mt-2 pt-2 border-t text-[10px] font-mono" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          规范：{result.ref}
        </div>
      )}
      <ResultExtras extra={result.extra} />
    </div>
  );
}

/** v4.5 新增：展示 extra 中间变量网格 */
function ResultExtras({ extra }: { extra?: Record<string, number | string> }) {
  if (!extra || Object.keys(extra).length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="text-[10px] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
        中间变量 / 分解
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
        {Object.entries(extra).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-1 min-w-0">
            <span className="truncate" style={{ color: 'var(--text-muted)' }}>{k}</span>
            <span className="shrink-0 font-semibold" style={{ color: 'var(--text-primary)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 通用 Card 容器
// ============================================================
function Card({ title, icon, hint, collapsible, expanded, onToggle, children }: {
  title: string;
  icon?: React.ReactNode;
  hint?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  // 收起时只显示标题栏，不渲染内容
  const showContent = !collapsible || expanded;
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
        {icon && <span style={{ color: 'var(--primary)' }}>{icon}</span>}
        <span className="text-xs 3xl:text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>{title}</span>
        {hint && !collapsible && <span className="text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
        {collapsible && (
          <button onClick={onToggle} className="ml-auto p-0.5" style={{ color: 'var(--text-muted)' }} title={expanded ? '收起' : '展开'}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>
      {showContent && <div className="p-4">{children}</div>}
    </div>
  );
}

// ============================================================
// 场景对比（全宽视图）
// ============================================================
function CompareModeFull({ scenarios, setScenarios, result, calcName }: {
  scenarios: { label: string; params: Record<string, number | string> }[];
  setScenarios: (s: { label: string; params: Record<string, number | string> }[]) => void;
  result: any;
  calcName?: string;
}) {
  const update = (i: number, field: 'label' | string, value: string) => {
    setScenarios(scenarios.map((s, idx) => {
      if (idx !== i) return s;
      if (field === 'label') return { ...s, label: value };
      return { ...s, params: { ...s.params, [field]: parseFloat(value) || 0 } };
    }));
  };
  const add = () => setScenarios([...scenarios, { label: `场景 ${scenarios.length + 1}`, params: applyPreset('slopeFs', 'standard') }]);
  const remove = (i: number) => setScenarios(scenarios.filter((_, idx) => idx !== i));
  const setPreset = (i: number, p: PresetName) => {
    setScenarios(scenarios.map((s, idx) => idx === i ? { ...s, params: applyPreset('slopeFs', p) } : s));
  };

  return (
    <>
      <Card title={`场景对比 · ${calcName ? (CALC_LIST.find(c => c.id === calcName)?.name ?? calcName) : '自动识别'}`} icon={<GitCompare size={13} />} hint={`${scenarios.length} 个场景自动对比 · 跟随最近使用的计算器`}>
        <div className="space-y-3">
          {scenarios.map((sc, i) => (
            <div key={i} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-base)' }}>
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={sc.label}
                  onChange={e => update(i, 'label', e.target.value)}
                  className="text-sm font-semibold flex-1 px-2 py-1 rounded outline-none border"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                />
                <select
                  onChange={e => setPreset(i, e.target.value as PresetName)}
                  className="text-[10px] px-2 py-1 rounded border font-mono"
                  style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <option value="conservative">保守</option>
                  <option value="standard" selected>标准</option>
                  <option value="aggressive">激进</option>
                </select>
                {scenarios.length > 2 && (
                  <button onClick={() => remove(i)} className="text-[10px] px-1.5 py-1 rounded" style={{ color: '#dc2626' }}>删除</button>
                )}
              </div>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(sc.params).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[9px] font-mono mb-0.5" style={{ color: 'var(--text-muted)' }}>{k}</div>
                    <input
                      type="number" value={typeof v === 'number' ? v : 0}
                      onChange={e => update(i, k, e.target.value)} step="any"
                      className="w-full text-[11px] px-1.5 py-1 rounded outline-none border font-mono"
                      style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button onClick={add} className="text-xs px-3 py-1.5 rounded border mt-3" style={{ borderColor: 'var(--border)', color: 'var(--primary)' }}>
          + 添加场景
        </button>
      </Card>
      {result && (
        <Card title="对比结果" icon={<Sparkles size={13} />}>
          <div className="space-y-2">
            {result.map((r: any, i: number) => {
              const max = Math.max(...result.map((x: any) => x.value || 0), 0);
              const pct = max > 0 ? (r.value / max) * 100 : 0;
              const color = GRADE_COLOR[r.grade as string] ?? 'var(--text-secondary)';
              return (
                <div key={i} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-base)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                    <span className="text-base font-mono font-bold" style={{ color }}>{r.value?.toFixed(2)} {r.unit}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

// ============================================================
// 蒙特卡洛（全宽视图）
// ============================================================
function MonteCarloFull({ params, setParams, preset, result, calcId = 'slopeFs', paramKeys = ['H', 'beta', 'gamma', 'c', 'phi'] }: {
  params: { param: string; std: number }[];
  setParams: (p: { param: string; std: number }[]) => void;
  preset: PresetName;
  result: any;
  calcId?: string;
  paramKeys?: string[];
}) {
  const add = () => setParams([...params, { param: 'beta', std: 1 }]);
  const remove = (i: number) => setParams(params.filter((_, idx) => idx !== i));
  const update = (i: number, field: 'param' | 'std', value: string) => {
    setParams(params.map((p, idx) => idx === i ? { ...p, [field]: field === 'param' ? value : (parseFloat(value) || 0) } : p));
  };
  return (
    <>
      <Card title={`蒙特卡洛风险评估 · ${CALC_LIST.find(c => c.id === calcId)?.name ?? calcId}`} icon={<Activity size={13} />} hint={`预设：${PRESET_LABELS[preset].name}`}>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          给输入参数加正态扰动，模拟 500 次，看结果分布与失败概率（跟随最近使用的计算器）。
        </p>
        <div className="space-y-2">
          {params.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={p.param} onChange={e => update(i, 'param', e.target.value)}
                      className="text-xs px-2 py-1 rounded border font-mono"
                      style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                {(paramKeys.includes(p.param) ? paramKeys : [...paramKeys, p.param]).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>σ =</span>
              <input type="number" value={p.std} step="any" min="0"
                     onChange={e => update(i, 'std', e.target.value)}
                     className="w-24 text-xs px-2 py-1 rounded outline-none border font-mono"
                     style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
              {params.length > 1 && (
                <button onClick={() => remove(i)} className="text-[10px] px-1.5 py-1 rounded" style={{ color: '#dc2626' }}>×</button>
              )}
            </div>
          ))}
        </div>
        <button onClick={add} className="text-[10px] px-2 py-1 rounded border mt-2" style={{ borderColor: 'var(--border)', color: 'var(--primary)' }}>
          + 添加扰动参数
        </button>
      </Card>
      {result && (
        <Card title={`Fs 分布（${result.iterations} 次）`} icon={<Sparkles size={13} />}>
          <HistogramChart samples={result.samples} bins={28} threshold={{ value: 1.30, op: '<', color: '#dc2626' }} height={widePx(200, 240)} />
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>失败概率 P(Fs &lt; 1.30)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono" style={{ color: result.failProb > 0.1 ? '#dc2626' : result.failProb > 0.01 ? '#ea580c' : '#16a34a' }}>
                {(result.failProb * 100).toFixed(1)}%
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {result.failProb > 0.1 ? '⚠ 高风险，建议加固' : result.failProb > 0.01 ? '注意' : '✓ 满足规范'}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              <div>μ {result.mean.toFixed(2)}</div>
              <div>P5 {result.p5.toFixed(2)}</div>
              <div>P50 {result.p50.toFixed(2)}</div>
              <div>P95 {result.p95.toFixed(2)}</div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

// ============================================================
// 成本估算（全宽视图）
// ============================================================
function CostFull({ inputs, setInputs, result }: {
  inputs: { capacityM3: number; leachateM3PerYear: number; monitorWells: number };
  setInputs: (i: { capacityM3: number; leachateM3PerYear: number; monitorWells: number }) => void;
  result: { labor: number; energy: number; chemical: number; monitor: number; total: number };
}) {
  const max = Math.max(result.labor, result.energy, result.chemical, result.monitor, 1);
  const items = [
    { label: '人工', value: result.labor, color: '#0ea5b7' },
    { label: '能耗', value: result.energy, color: '#0891b2' },
    { label: '药剂', value: result.chemical, color: '#7c3aed' },
    { label: '检测', value: result.monitor, color: '#ea580c' },
  ];
  return (
    <Card title="运营成本估算（万元/年）" icon={<TrendingUp size={13} />}>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        简单经验模型：人工 / 能耗 / 药剂 / 检测 4 大类。输入库容、年渗滤液量、监测井数。
      </p>
      <div className="space-y-3 mb-4">
        <CostField label="总库容" unit="m³" value={inputs.capacityM3} onChange={v => setInputs({ ...inputs, capacityM3: v })} />
        <CostField label="年渗滤液产生量" unit="m³/a" value={inputs.leachateM3PerYear} onChange={v => setInputs({ ...inputs, leachateM3PerYear: v })} />
        <CostField label="监测井数量" unit="口" value={inputs.monitorWells} step="1" onChange={v => setInputs({ ...inputs, monitorWells: v })} />
      </div>
      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-base)' }}>
        <div className="text-3xl font-bold font-mono" style={{ color: 'var(--primary)' }}>
          {result.total.toFixed(1)} <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>万元/年</span>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {items.map(it => (
          <div key={it.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-secondary)' }}>{it.label}</span>
              <span className="font-mono font-semibold" style={{ color: it.color }}>{it.value.toFixed(1)} 万 ({((it.value / result.total) * 100).toFixed(0)}%)</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CostField({ label, unit, value, onChange, step }: { label: string; unit: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div>
      <label className="flex items-center justify-between mb-1">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{unit}</span>
      </label>
      <input type="number" value={value} step={step || "any"} min="0"
             onChange={e => onChange(parseFloat(e.target.value) || 0)}
             className="w-full text-sm px-3 py-1.5 rounded outline-none border font-mono"
             style={{ backgroundColor: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
    </div>
  );
}
