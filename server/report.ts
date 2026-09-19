/**
 * report.ts — 工程报告生成器（v5）
 *
 * 从 tool_runs 记录（统一工具层落库）组装工程报告：
 *   执行摘要 / 输入参数（含出处与单位）/ 结果与分级 / 规范依据 / 版本与时间戳
 * 输出：Markdown + sections（前端渲染）+ 结构化 JSON（download）。
 * 供：
 *   - chat 内 generate_report 工具（后端）
 *   - POST /api/report（前端一键导出）
 *
 * 格式对齐方案 §22 报告结构（轻量版：逐步增强）。
 */

import { getToolRun, getToolRunsBySession, getRecentToolRuns } from './db.js';
import type { ToolRunRecord } from './db.js';

export interface ReportInput {
  /** 指定运行记录（默认最近 24 条） */
  runIds?: string[];
  /** 按会话取最近工具运行 */
  sessionId?: string;
  /** 报告标题后缀 */
  title?: string;
}

export interface ReportSection {
  title: string;
  content: string;
}

export interface ReportRecordView {
  runId: string;
  tool: string;
  toolLabel: string;
  status: string;
  grade: string | null;
  elapsedMs: number;
  paramsText: string;
  resultSummary: string;
  warnings: string[];
}

export interface EngineeringReport {
  title: string;
  markdown: string;
  sections: ReportSection[];
  runCount: number;
  generatedAt: string;
  records: ReportRecordView[];
}

const ORIGIN_LABEL: Record<string, string> = {
  USER_DEFINED: '用户指定', FROM_TEXT: '文本提取', ESTIMATED: '智能体估算', DEFAULT: '默认值', INVALID: '无效(取边界)',
};

const STATUS_LABEL: Record<string, string> = {
  ok: '成功', warning: '完成（有警告）', error: '失败',
};

function parseParams(json: string): Array<{ label: string; value: unknown; unit?: string; origin?: string; inRange?: boolean }> {
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function formatParams(params: Array<{ label: string; value: unknown; unit?: string; origin?: string; inRange?: boolean }>): string {
  if (!params.length) return '（无参数快照）';
  return params.map((p) =>
    `- ${p.label} = ${String(p.value)}${p.unit ?? ''}（${ORIGIN_LABEL[p.origin ?? ''] ?? p.origin ?? '—'}${p.inRange === false ? ' ⚠ 越界已修正' : ''}）`,
  ).join('\n');
}

function parseResult(json: string): { summary: string; warnings: string[] } {
  try {
    const r = JSON.parse(json);
    return {
      summary: typeof r.summary === 'string' ? r.summary : '',
      warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
    };
  } catch { return { summary: '', warnings: [] }; }
}

/** 组装工程报告；无记录返回 null */
export function generateReport(input: ReportInput = {}): EngineeringReport | null {
  let records: ToolRunRecord[] = [];
  if (Array.isArray(input.runIds) && input.runIds.length) {
    records = input.runIds.map((id) => getToolRun(id)).filter((r): r is ToolRunRecord => !!r);
  } else if (input.sessionId) {
    records = getToolRunsBySession(input.sessionId, 50);
  } else {
    records = getRecentToolRuns(24);
  }
  if (!records.length) return null;

  const generatedAt = new Date().toISOString();
  const views: ReportRecordView[] = records.map((r) => {
    const params = parseParams(r.params_json);
    const res = parseResult(r.result_summary);
    return {
      runId: r.id,
      tool: r.tool,
      toolLabel: r.tool_label ?? r.tool,
      status: r.status,
      grade: r.grade,
      elapsedMs: r.elapsed_ms,
      paramsText: formatParams(params),
      resultSummary: res.summary,
      warnings: res.warnings,
    };
  });

  // ---------- 章节 ----------
  const lines: string[] = [];
  lines.push(`# 工程计算报告 · ${input.title ?? 'LandfillMind 智能体'}`);
  lines.push('');
  lines.push(`> 生成时间：${generatedAt}`);
  lines.push(`> 覆盖工具运行记录：${records.length} 条（Tool Run · 可追溯）`);
  lines.push('');

  // 1) 执行摘要
  lines.push('## 1. 执行摘要');
  lines.push('');
  lines.push('| 工具 | 状态 | 分级 | 耗时 |');
  lines.push('| --- | --- | --- | --- |');
  for (const v of views) {
    lines.push(`| ${v.toolLabel} | ${STATUS_LABEL[v.status] ?? v.status} | ${v.grade ?? '—'} | ${v.elapsedMs}ms |`);
  }
  lines.push('');
  const execSummary = views
    .map(v => `${v.toolLabel}：${STATUS_LABEL[v.status] ?? v.status}${v.grade ? `（${v.grade}）` : ''}${v.resultSummary ? ' — ' + v.resultSummary.slice(0, 120) : ''}`)
    .join('\n');

  // 2) 输入参数（含出处）
  lines.push('## 2. 输入参数（含出处）');
  lines.push('');
  views.forEach((v, i) => {
    lines.push(`### 2.${i + 1} ${v.toolLabel}`);
    lines.push('');
    lines.push(v.paramsText);
    lines.push('');
  });
  const paramsSection = views.map(v => `### ${v.toolLabel}\n\n${v.paramsText}`).join('\n\n');

  // 3) 结果与分级
  lines.push('## 3. 结果与分级');
  lines.push('');
  views.forEach((v, i) => {
    if (!v.resultSummary && !v.warnings.length) return;
    lines.push(`### 3.${i + 1} ${v.toolLabel}（${STATUS_LABEL[v.status] ?? v.status}${v.grade ? ' · ' + v.grade : ''}）`);
    lines.push('');
    if (v.resultSummary) lines.push(v.resultSummary.trim());
    if (v.warnings.length) lines.push(`\n> 警告：${v.warnings.join('；')}`);
    lines.push('');
  });
  const resultSection = views
    .filter(v => v.resultSummary || v.warnings.length)
    .map(v => `### ${v.toolLabel}（${STATUS_LABEL[v.status] ?? v.status}${v.grade ? ' · ' + v.grade : ''}）\n\n${v.resultSummary || '(无摘要)'}${v.warnings.length ? '\n\n> 警告：' + v.warnings.join('；') : ''}`)
    .join('\n\n');

  // 4) 可追溯链（runId + 时间）
  lines.push('## 4. 可追溯记录');
  lines.push('');
  for (const v of views) {
    lines.push(`- \`${v.runId}\` · ${v.toolLabel} · ${STATUS_LABEL[v.status] ?? v.status}${v.grade ? ' · ' + v.grade : ''} · ${v.elapsedMs}ms`);
  }
  lines.push('');
  const traceSection = views.map(v => `- \`${v.runId}\` · ${v.toolLabel} · ${STATUS_LABEL[v.status] ?? v.status}${v.grade ? ' · ' + v.grade : ''} · ${v.elapsedMs}ms`).join('\n');

  const markdown = lines.join('\n');
  const sections: ReportSection[] = [
    { title: '执行摘要', content: execSummary },
    { title: '输入参数（含出处）', content: paramsSection },
    { title: '结果与分级', content: resultSection },
    { title: '可追溯记录', content: traceSection },
  ];

  return {
    title: input.title ?? '工程计算报告',
    markdown,
    sections,
    runCount: views.length,
    generatedAt,
    records: views,
  };
}

export default { generateReport };