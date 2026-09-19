import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, RotateCcw, Camera, FileDown, MessageCircle, Link2 } from 'lucide-react';
// 常量/类型从纯模块 geo.ts 拿（不拉入 three.js）
import { DEFAULT_GEO, GEO_PRESETS, clampGeo, estimateSite, readSceneBuilt, hasEngDims } from '../components/LandfillScene3D/geo';
import type { GeoParams, LandfillApi, SceneQuality } from '../components/LandfillScene3D/geo';
// 组件本体懒加载（~500KB three.js）
const LandfillScene3D = lazy(() => import('../components/LandfillScene3D'));
import { buildSimSnapshotMarkdown, downloadDataUrl, downloadJSON, downloadText, timestampName } from '../utils/exporter';
import { SceneChatPanel } from '../components/SceneChatPanel';

const STORAGE_KEY = 'sim-geo-v2'; // v2: scale factor 范围重构（v1 的 10-60 m 工程值作废）

/** 跨页联动信封：AI 快诊 / 稳定化计算 / 专家对话 → 3D 场景 */
export interface SceneLink {
  kind: 'ogs';
  scenario: string;
  scenarioName?: string;
  timeSeries: Array<{ varName?: string; name?: string; points: { t: number; v: number }[] }>;
  ts: number;
}
export const SCENE_OGS_KEY = 'scene-ogs';
export function readSceneLink(): SceneLink | null {
  try {
    const raw = sessionStorage.getItem(SCENE_OGS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SCENE_OGS_KEY); // 读一次即消费
    return JSON.parse(raw) as SceneLink;
  } catch { return null; }
}

// slider 范围 = geo.ts clampGeo 的真实 min/max（scale factor，无量纲）
// 显示层在末尾标注等效工程值（基于 DEFAULT_GEO 的基准量）
const PARAM_FIELDS: { key: keyof GeoParams; label: string; min: number; max: number; step: number; engHint?: string }[] = [
  { key: 'pileHeight', label: '堆体最大高度 H', min: 0.75, max: 1.8, step: 0.05, engHint: '默认 ≈ 30 m · 范围 15–54 m（下限已收紧防闪烁）' },
  { key: 'valleyWidth', label: '谷底宽度 B', min: 0.75, max: 1.6, step: 0.05, engHint: '默认 ≈ 110 m · 范围 66–176 m（下限已收紧防闪烁）' },
  { key: 'damHeight', label: '垃圾坝高', min: 0.5, max: 2.0, step: 0.05, engHint: '默认 ≈ 8 m · 范围 4–16 m' },
  { key: 'gasWellSpacing', label: '导气井间距', min: 0.6, max: 1.5, step: 0.05, engHint: '默认 ≈ 45 m · 范围 27–68 m' },
  { key: 'pondVolume', label: '调节池容积', min: 0.4, max: 2.2, step: 0.05, engHint: '默认 ≈ 6,000 m³ · 范围 2,400–13,200 m³' },
];

// v5.1 工程尺寸（真实 m/°）—— 可选；填了就以实际尺寸建模并算库容（优先于上方缩放系数）
const ENG_FIELDS: { key: 'siteLengthM' | 'siteWidthM' | 'pileHeightM' | 'slopeAngleDeg'; label: string; unit: string; placeholder: string; min: number; max: number }[] = [
  { key: 'siteLengthM', label: '场地长 L', unit: 'm', placeholder: '300', min: 120, max: 400 },
  { key: 'siteWidthM', label: '场地宽 W', unit: 'm', placeholder: '200', min: 80, max: 240 },
  { key: 'pileHeightM', label: '堆体高度 H', unit: 'm', placeholder: '25', min: 5, max: 40 },
  { key: 'slopeAngleDeg', label: '边坡角 β', unit: '°', placeholder: '26.6（1:2）', min: 15, max: 45 },
];

function loadGeo(): GeoParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return clampGeo({ ...DEFAULT_GEO, ...JSON.parse(raw) });
  } catch {}
  return { ...DEFAULT_GEO };
}

export default function SimulatorPage() {
  const [geo, setGeo] = useState<GeoParams>(loadGeo);
  const sceneApi = useRef<LandfillApi | null>(null);
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [canvasHeight, setCanvasHeight] = useState(640);
  const [linkInfo, setLinkInfo] = useState<string | null>(null);
  const [quality, setQuality] = useState<SceneQuality>('auto');
  const navigate = useNavigate();

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(geo)); } catch {}
  }, [geo]);

  // 消费跨页联动：AI 快诊 / 稳定化计算 / 专家对话跳转过来时注入场景
  useEffect(() => {
    const link = readSceneLink();
    if (!link) return;
    let tries = 0;
    // 场景懒加载 + 重建是异步的，轮询等 apiRef 就绪
    const timer = setInterval(() => {
      tries++;
      if (sceneApi.current) {
        clearInterval(timer);
        sceneApi.current.applyOgsResult(link.scenario, link.timeSeries ?? []);
        setLinkInfo(`已注入${link.scenarioName ?? '稳定化计算'}结果：${link.scenario === 'settlement' ? '堆体按沉降时程可视化下沉（放大 60×）' : '火炬按产气强度增强'}`);
        setTimeout(() => setLinkInfo(null), 10000);
      } else if (tries > 40) {
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // 消费 AI 生成的 3D 场景（ChatPage buildScene 回执 → 跳转 /3d-simulator 后按生成参数重建）
  useEffect(() => {
    const built = readSceneBuilt<{
      geo?: Partial<GeoParams>;
      preset?: string;
      snapshot?: { desc?: string };
      ogSummary?: { scenario?: string; peakValue?: number; unit?: string };
    }>();
    if (!built || !built.geo) return;
    setGeo(clampGeo({ ...DEFAULT_GEO, ...built.geo }));
    const head = built.snapshot?.desc?.split('\n')[0] ?? '';
    setLinkInfo(
      `🪄 AI 已生成${built.preset && built.preset !== 'default' ? `「${built.preset}」` : ''}场景：${head}` +
      (built.ogSummary ? ` · 联动 OGS ${built.ogSummary.scenario ?? ''} 峰值 ${built.ogSummary.peakValue ?? ''}${built.ogSummary.unit ?? ''}` : '')
    );
    setTimeout(() => setLinkInfo(null), 12000);
  }, []);

  // 「询问 AI」：把当前场景参数 + 联动状态打包进对话预填
  const askAi = () => {
    const engText = hasEngDims(geo)
      ? `\n工程尺寸（真实值）：场地长 ${geo.siteLengthM} m × 场地宽 ${geo.siteWidthM} m × 堆体高 ${geo.pileHeightM} m，边坡角 ${geo.slopeAngleDeg ?? 18.4}°。`
      : '';
    const q = [
      '【来自 3D 场景的提问】',
      `当前三维填埋场参数：堆体高度 ${geo.pileHeight.toFixed(2)}×、谷底宽度 ${geo.valleyWidth.toFixed(2)}×、坝高 ${geo.damHeight.toFixed(2)}×、导气井间距 ${geo.gasWellSpacing.toFixed(2)}×、调节池容积 ${geo.pondVolume.toFixed(2)}×（均为相对默认工况的缩放系数）。`,
      engText,
      `估算库容 ${estimates.volumeWanM3} 万 m³，占地 ${estimates.areaHm2} hm²。`,
      linkInfo ? `（场景已注入：${linkInfo}）` : '',
      '请结合这些参数，从边坡稳定、渗滤液、填埋气收集三方面给出工程要点。',
    ].filter(Boolean).join('\n');
    try { sessionStorage.setItem('chat-prefill', q); } catch {}
    navigate('/chat/new');
  };

  useEffect(() => {
    const el = canvasWrap.current;
    if (!el) return;
    const update = () => {
      const h = el.clientHeight;
      if (h > 240) setCanvasHeight(h);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const estimates = useMemo(() => estimateSite(geo), [geo]);

  const updateField = (key: keyof GeoParams, value: number) => {
    setGeo(prev => clampGeo({ ...prev, [key]: value }));
  };

  /** 工程尺寸输入：留空 = 清除该尺寸（回退缩放系数模式） */
  const updateEngField = (key: keyof GeoParams, value: string) => {
    setGeo(prev => {
      const next: GeoParams = { ...prev };
      const rec = next as unknown as Record<string, unknown>;
      const v = value.trim() === '' ? undefined : parseFloat(value);
      if (v === undefined || !Number.isFinite(v)) {
        delete rec[key as string];
        return clampGeo(next);
      }
      rec[key as string] = v;
      return clampGeo(next);
    });
  };

  const applyPreset = (key: string) => {
    const preset = GEO_PRESETS.find(p => p.key === key);
    if (preset) setGeo(clampGeo({ ...DEFAULT_GEO, ...preset.geo }));
  };

  const capturePng = () => {
    const dataUrl = sceneApi.current?.capturePng();
    if (dataUrl) downloadDataUrl(timestampName('三维模拟', 'png'), dataUrl);
  };
  const exportMd = () => downloadText(timestampName('三维模拟快照', 'md'), buildSimSnapshotMarkdown(geo, estimates));
  const exportJson = () => downloadJSON(timestampName('三维模拟快照', 'json'), { params: geo, estimates });

  // 3D 助手 OGS 结果注入：场景可能因 geo 变化正在重建，轮询等 apiRef 就绪
  const applyOgsResult = (scenario: string, series: Array<{ varName?: string; points: { t: number; v: number }[] }>, label: string) => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (sceneApi.current) {
        clearInterval(timer);
        sceneApi.current.applyOgsResult(scenario, series);
        setLinkInfo(label);
        setTimeout(() => setLinkInfo(null), 10000);
      } else if (tries > 40) {
        clearInterval(timer);
      }
    }, 250);
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      {/* 页面标题 */}
      <div className="px-6 pt-5 pb-4 border-b shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-2.5">
          <Boxes size={18} style={{ color: 'var(--primary)' }} />
          <div>
            <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>3D 模拟</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>输入工程参数，实时生成可视化三维填埋场模型</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：参数面板 */}
        <div className="w-80 flex-shrink-0 border-r overflow-y-auto p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex gap-1.5 mb-4">
            {GEO_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* 画质三档：性能自适应（低端自动降档） */}
          <div className="flex items-center gap-1.5 mb-4 px-0.5">
            <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>画质</span>
            <div className="flex flex-1 gap-1">
              {(['auto', 'low', 'medium', 'high'] as SceneQuality[]).map(q => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className="flex-1 py-1 rounded-md text-[11px] border transition-colors"
                  style={{
                    borderColor: quality === q ? 'var(--primary)' : 'var(--border)',
                    color: quality === q ? 'var(--primary)' : 'var(--text-secondary)',
                    backgroundColor: quality === q ? 'rgba(99,102,241,0.10)' : 'transparent',
                  }}
                >
                  {{ auto: '自动', low: '低', medium: '中', high: '高' }[q]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {/* v5.1 工程尺寸（真实 m/°）—— 可选，填了优先于下方缩放系数 */}
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
              <p className="text-[10px] font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                工程尺寸（真实 m/°）
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ENG_FIELDS.map(f => {
                  const v = geo[f.key];
                  const active = typeof v === 'number' && Number.isFinite(v);
                  return (
                    <div key={f.key}>
                      <label className="flex items-center gap-1 text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>
                        {f.label}
                        {active && <span className="ml-auto text-[9px] font-mono" style={{ color: 'var(--primary)' }}>✓ 生效</span>}
                      </label>
                      <input
                        type="number"
                        value={active ? (v as number) : ''}
                        placeholder={f.placeholder}
                        min={f.min}
                        max={f.max}
                        onChange={e => updateEngField(f.key, e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg text-xs font-mono outline-none border transition-colors"
                        style={{
                          backgroundColor: 'var(--bg-input)',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                填长/宽/高即按真实尺寸建模并按棱台估算库容；边坡角留空 = 1:3（18.4°）。长/宽/高留空 = 用下方缩放系数。
              </p>
            </div>

            {PARAM_FIELDS.map(f => {
              const value = geo[f.key] as number;
              return (
                <div key={f.key}>
                  <label className="flex items-center justify-between mb-1.5">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{f.label}</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--primary)' }}>
                      {value.toFixed(2)}×
                    </span>
                  </label>
                  <input
                    type="range"
                    value={value}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    onChange={e => updateField(f.key, parseFloat(e.target.value))}
                    className="w-full"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{f.min}×</span>
                    <span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{f.max}×</span>
                  </div>
                  {f.engHint && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{f.engHint}</p>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setGeo({ ...DEFAULT_GEO })}
            className="mt-4 w-full py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-1.5 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <RotateCcw size={12} /> 恢复默认参数
          </button>

          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-elevated)' }}>
            <p className="text-[10px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>库容估算</p>
            <p className="text-[11px] leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>{estimates.desc}</p>
          </div>
        </div>

        {/* 右侧：三维模型 + 导出工具栏 */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div ref={canvasWrap} className="flex-1 min-h-0 overflow-hidden relative">
            <LandfillScene3D height={canvasHeight} geoParams={geo} apiRef={sceneApi} quality={quality} />
            {/* AI 建模助手：对话建模 + 计算 + OGS（右下角悬浮） */}
            <div className="absolute bottom-3 right-3 z-20">
              <SceneChatPanel currentGeo={geo} onApplyGeo={setGeo} onOgsResult={applyOgsResult} />
            </div>
          </div>
          {linkInfo && (
            <div className="shrink-0 px-5 py-2 border-b flex items-center gap-2 text-[11px]"
                 style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(16,185,129,0.08)', color: '#10b981' }}>
              <Link2 size={12} /> {linkInfo}
            </div>
          )}
          <div className="shrink-0 px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-surface)' }}>
            <span className="text-[11px] font-semibold mr-auto" style={{ color: 'var(--text-muted)' }}>
              库容 {estimates.volumeWanM3} 万 m³ · 占地 {estimates.areaHm2} hm²
            </span>
            <button
              onClick={askAi}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              title="把当前场景参数带入专家问答"
            >
              <MessageCircle size={12} /> 询问 AI
            </button>
            <button
              onClick={capturePng}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <Camera size={12} /> PNG 截图
            </button>
            <button
              onClick={exportMd}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <FileDown size={12} /> MD 快照
            </button>
            <button
              onClick={exportJson}
              className="text-[11px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <FileDown size={12} /> JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}