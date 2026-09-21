/**
 * state/api.ts · 内核供给层封装（全部走既有 /api/kernel3d/*）
 *
 * 三条通道：
 *  - POST /api/kernel3d/run        GUI 直驱内核（经 execTool 落 tool_runs，不经 LLM）
 *  - POST /api/kernel3d/mesh/viewport  三维视图叠加层重导
 *  - GET  /api/kernel3d/{info,project/active,file/...}
 *
 * 一律不做重试/降级 —— 内核失败的错误信封本身带引导语，原样透出给用户看。
 */

export interface Fig { key: string; label: string; url: string; size: number }
export interface FileRef { kind: string; file: string; url: string }

export interface RunResult {
  action?: string;
  summary?: string;
  grade?: string | null;
  stamp?: Record<string, string>;
  data?: Record<string, any>;
  figures?: Fig[];
  files?: FileRef[];
  reportUrl?: string;
  notes?: string[];
}

export interface ToolRunResp {
  ok: boolean;
  status: string;
  grade?: string | null;
  result: RunResult | null;
  warnings?: string[];
  elapsedMs?: number;
  error?: string;
}

/** 内核自述（动作/图注册表/下拉选项/默认值的单一来源） */
export interface KernelInfo {
  actions?: string[];
  figures?: string[];
  options?: Record<string, string[]>;
  defaults?: Record<string, any>;
  landfill3d?: { version?: string; physics?: string; kernel?: string };
}

/** GUI 直驱：3D 工具面板的每一次计算都走这里 */
export async function kernelRun(
  action: string,
  body: {
    spec?: Record<string, unknown>;
    params?: Record<string, unknown>;
    figures?: string[] | null;
    report?: boolean;
    fig_export?: { format: string; dpi?: number };
  },
  sid: string,
): Promise<ToolRunResp> {
  const res = await fetch('/api/kernel3d/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action, sid, ...body,
      // action=model 时整份替换而非增量合并 —— 本页每次发的都是按当前表单
      // 组装的**完整** spec，走合并的话上一次留下的键（典型是 demo:"plain"）
      // 会被继承，"应用开挖"会把示例场原样重建、开挖根本没进去。
      ...(action === 'model' ? { spec_mode: 'replace' } : {}),
    }),
  });
  const j = (await res.json().catch(() => null)) as ToolRunResp | null;
  if (!j) throw new Error(`内核通道无响应（HTTP ${res.status}）`);
  return j;
}

/** 出版件导出（桌面「⤓ 导出当前图」）：PNG 300dpi / PDF / SVG / 底层数据 CSV */
export async function kernelExportFigure(
  action: string,
  figures: string[],
  params: Record<string, unknown>,
  fmt: 'png' | 'pdf' | 'svg',
  sid: string,
): Promise<ToolRunResp> {
  return kernelRun(action, {
    figures,
    params,
    fig_export: { format: fmt, dpi: 300 },
  }, sid);
}

/**
 * 三维视图叠加层：按指令重导网格（物理层由内核复用分析侧构造）。
 *
 * `params` 是**叠加层需要的那几项分析参数**（稳定性 c/φ/ru、沉降土层、
 * 开挖分层…）—— 前端显式挑好，服务端把它一起并入指纹，改无关字段不会
 * 触发重导。
 */
export async function kernelViewport(
  overlay: Record<string, unknown> | null,
  params: Record<string, unknown> | null,
  sid: string,
): Promise<{ ok: boolean; refreshed?: boolean; info?: Record<string, unknown>; error?: string }> {
  const res = await fetch('/api/kernel3d/mesh/viewport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, overlay, params }),
  });
  return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` })));
}

/** 内核自述（版本号也从这里取，不硬编码） */
export async function fetchKernelInfo(): Promise<KernelInfo | null> {
  try {
    const res = await fetch('/api/kernel3d/info');
    const j = await res.json();
    return (j?.data as KernelInfo) ?? null;
  } catch {
    return null;
  }
}

/** 打开工程：前端解析好的 project JSON 交给后端落盘并重建网格 */
export async function kernelImport(
  project: Record<string, unknown>,
  sid: string,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const res = await fetch('/api/kernel3d/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, project }),
  });
  return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` })));
}

/** 触发浏览器下载（带 ?dl=1 的静态文件路由） */
export function download(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url.includes('?') ? `${url}&dl=1` : `${url}?dl=1`;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 导出结果表为 CSV（无内核底层映射时的回退，与桌面「底层数据 CSV」区分） */
export function downloadTableCsv(cols: string[], rows: unknown[][], name = '结果表.csv'): void {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [cols.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
  // 加 BOM：Excel 打开中文 CSV 不乱码
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
