/**
 * state/run.ts · 内核执行器 + 结果池 + 日志 + 状态栏文案
 *
 * 结果池（pool）解决的问题：9 个主视图各有若干子视图，用户来回切换时不能
 * 丢结果、也不能重复跑内核。每次 run 成功后按 viewKey 写入池子；子视图切换
 * 只是换一个 fig 来显示。
 *
 * 日志分级与状态栏文案照桌面：info / ok / warn / err 四色，
 * 状态栏左段用 ACCENT 色（.lf-status）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Fig, KernelInfo, RunResult } from './api';
import { kernelRun } from './api';

export type LogKind = 'info' | 'ok' | 'warn' | 'err';
export interface LogLine { t: string; kind: LogKind; text: string }

export interface PoolEntry {
  figs: Fig[];
  /** 当前子视图键（桌面子视图条上的键） */
  sub?: string;
  table?: { cols?: string[]; rows?: unknown[][] } | null;
  summary?: string;
  grade?: string | null;
  stamp?: Record<string, string>;
  reportUrl?: string;
  curve?: { levels_m?: (number | null)[]; volume_m3?: (number | null)[]; area_m2?: (number | null)[] } | null;
  /** 结果时刻可选值（产气年份 / 羽流时刻 / 开挖阶段） */
  timeOpts?: {
    gas_years?: number[]; plume_days?: number[];
    gas_year_used?: number | null; plume_day_used?: number | null;
  } | null;
  files?: Array<{ kind: string; file: string; url: string }>;
  /** 逐阶段开挖的阶段数（阶段下拉用） */
  stageCount?: number;
  /** 上一次成功的调用（供「导出当前图」按原参数重算 + 缓存） */
  lastRun?: { action: string; params?: Record<string, unknown>; figures?: string[] | null };
  /** 出版件导出的缓存（同一视图重复导出直接下载，不重算内核） */
  exports?: Record<string, { url: string; file: string }>;
  /** 这次结果落池的时刻（ms）——「导出 TXT 报告」挑最近一次简报用 */
  lastAt?: number;
}

/** 一次 run 的结果要落在哪个视图的池子里 */
export interface RunMap {
  viewKey: string;
  sub?: string;
  /** 该视图的图键全集（子视图切换时按 fig.key 找） */
  figures?: string[];
  /** 额外要写进池子的字段（污染的时间游标、开挖阶段数等） */
  extra?: (r: RunResult) => Partial<PoolEntry>;
}

const MAX_LOGS = 200;

function nowText(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function useKernelRun() {
  const [pool, setPool] = useState<Partial<Record<string, PoolEntry>>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [status, setStatus] = useState('就绪 | 未建立模型 | 请导入测点或加载示例');
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<KernelInfo | null>(null);
  /** 建模成功后 bump：让 KernelMeshView 重拉 OBJ */
  const [meshKey, setMeshKey] = useState(0);
  /**
   * 会话号。工具页有自己的 sid（刷新后仍是同一份工程），但**三维查看器读的是
   * 全局活动会话指针**（最后建模成功的那个）。两者不同源时会出现「三维里明明
   * 有模型，一点计算就说请先建模」—— 所以挂载时要对齐一次（见下方 effect）。
   */
  const [sid, setSid] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined'
      ? localStorage.getItem('landfill3d-tool-sid') : null;
    const s = saved || `tool-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try { localStorage.setItem('landfill3d-tool-sid', s); } catch { /* 隐私模式 */ }
    return s;
  });

  const adoptSid = useCallback((next: string) => {
    if (!next || next === sid) return;
    setSid(next);
    try { localStorage.setItem('landfill3d-tool-sid', next); } catch { /* ignore */ }
  }, [sid]);

  const log = useCallback((text: string, kind: LogKind = 'info') => {
    setLogs((ls) => [...ls, { t: nowText(), kind, text }].slice(-MAX_LOGS));
  }, []);

  /**
   * 会话对齐：自己的会话还没有工程、而活动会话有时，接管活动会话。
   * 这样查看器与计算走同一个 sid，且"在对话里建模 → 来工具页继续算"这条
   * 主链路才成立（CHANGELOG v5.2 的定位）。若自己的会话已有工程则不动，
   * 免得覆盖用户在本页建了一半的场地。
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/kernel3d/mesh-info/active?sid=${encodeURIComponent(sid)}`);
        if (!alive || !r.ok) return;
        const j = await r.json();
        if (j?.sessionId && j.sessionId !== sid && j.activeSessionId) {
          adoptSid(String(j.sessionId));
          log(`已接管活动三维会话 ${String(j.sessionId).slice(0, 18)}…`
            + '（本页原会话还没有工程）', 'ok');
        }
      } catch { /* 对齐失败就用本地会话，不影响使用 */ }
    })();
    return () => { alive = false; };
    // 只在挂载时对齐一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setKernelInfo = useCallback((k: KernelInfo | null) => setInfo(k), []);

  /** 把内核的 notes/warnings 按分级写进日志 */
  const absorbNotes = useCallback((notes: string[] | undefined) => {
    for (const n of notes || []) {
      const kind: LogKind = /失败|错误|不可引用|跳过/.test(n) ? 'warn'
        : /完成|已|满足/.test(n) ? 'ok' : 'info';
      log(n, kind);
    }
  }, [log]);

  /**
   * 统一执行器。所有计算按钮都走它：
   *  1) POST /api/kernel3d/run（经 execTool 落 tool_runs）
   *  2) 成功 → 写结果池、刷新日志与状态栏
   *  3) action=model → bump meshKey、清空池子、切回 3D 视图
   */
  const run = useCallback(async (
    label: string,
    body: {
      action: string;
      spec?: Record<string, unknown>;
      params?: Record<string, unknown>;
      figures?: string[] | null;
      report?: boolean;
      fig_export?: { format: string; dpi?: number };
    },
    map: RunMap,
  ): Promise<RunResult | null> => {
    setBusy(label);
    setStatus(`${label} …`);
    log(`▶ ${label}`, 'info');
    const t0 = performance.now();
    try {
      const resp = await kernelRun(body.action, body, sid);
      const el = ((performance.now() - t0) / 1000).toFixed(1);
      if (!resp.ok || !resp.result) {
        // ⚠ execTool 的失败信封把原因放在 **warnings[0]**，ToolRun 上根本没有
        // `error` 字段（server/tools.ts:962-974）。只读 resp.error 的话每次内核
        // 失败都显示「未知错误」，真实原因（如 unsupported operand / 缺图层）
        // 只能去日志里翻 —— 这正是之前"污染与羽流报未知错误"的成因。
        const ws = resp.warnings || [];
        const msg = resp.error || resp.result?.summary || ws[0] || '未知错误';
        log(`✗ ${label} 失败：${msg}`, 'err');
        for (const w of ws.slice(1)) log(w, 'warn');
        setStatus(`${label} 失败 | ${msg}`.slice(0, 160));
        return null;
      }
      const r = resp.result;
      absorbNotes(resp.warnings);
      absorbNotes(r.notes);
      log(`✓ ${label}：${r.summary || '完成'}（${el}s）`, 'ok');
      const entry: PoolEntry = {
        figs: r.figures || [],
        sub: map.sub,
        table: r.data?.table ?? null,
        summary: r.summary,
        grade: r.grade ?? null,
        stamp: r.stamp,
        reportUrl: r.reportUrl,
        curve: r.data?.curve ?? null,
        timeOpts: r.data?.time_options ?? null,
        files: r.files,
        stageCount: typeof r.data?.stages === 'number' ? r.data.stages
          : (Array.isArray(r.data?.stage_table) ? r.data.stage_table.length : undefined),
        lastRun: { action: body.action, params: body.params, figures: body.figures },
        lastAt: Date.now(),
        ...(map.extra ? map.extra(r) : {}),
      };
      setPool((p) => {
        // 同视图重跑：新图覆盖同 key，旧子图（如逐阶段的分区阶段）保留
        const prev = p[map.viewKey];
        const merged = mergeFigs(prev?.figs, entry.figs);
        // ⚠ 只带图的调用（如「◧ 内核图」的 render）不该把上一次分析的
        //   结果表/汇总/简报冲掉 —— 早先它们是**无条件**覆盖的，于是切一次
        //   内核图，右侧「计算结果表」就空了。本次真产出了才覆盖。
        return {
          ...p,
          [map.viewKey]: {
            ...prev, ...entry,
            figs: merged,
            table: entry.table ?? prev?.table ?? null,
            summary: entry.summary || prev?.summary,
            reportUrl: entry.reportUrl ?? prev?.reportUrl,
            curve: entry.curve ?? prev?.curve ?? null,
            timeOpts: entry.timeOpts ?? prev?.timeOpts ?? null,
            files: entry.files?.length ? entry.files : prev?.files,
            stageCount: entry.stageCount ?? prev?.stageCount,
            sub: prev?.sub && !map.sub ? prev.sub : entry.sub,
            exports: {},   // 结果变了，旧的出版件缓存作废
          },
        };
      });
      setStatus(`模型就绪 | ${r.summary || '完成'}`.slice(0, 160));
      return r;
    } catch (e: any) {
      log(`✗ ${label} 异常：${e?.message ?? e}`, 'err');
      setStatus(`${label} 异常 | ${e?.message ?? e}`.slice(0, 160));
      return null;
    } finally {
      setBusy(null);
    }
  }, [absorbNotes, log, sid]);

  /** 供建模成功后由页面调用 */
  const afterBuild = useCallback((r: RunResult) => {
    setMeshKey((k) => k + 1);
    setPool({});
    const m = r.data?.model as Record<string, unknown> | undefined;
    if (m) {
      const vol = Number(m.volume_m3 || 0) / 1e4;
      setStatus(`模型就绪 | ${String(m.site_name ?? '')} | 体积 ${vol.toFixed(1)} 万m³`
        + ` | 网格 ${(m.grid as number[] | undefined)?.join('×') ?? ''}`);
    }
  }, []);

  return useMemo(() => ({
    sid, pool, setPool, logs, log, status, setStatus, busy,
    info, setKernelInfo, meshKey, setMeshKey, run, afterBuild,
  }), [sid, pool, logs, log, status, busy, info, setKernelInfo, meshKey, run, afterBuild]);
}

/** 按 fig.key 合并：新图覆盖同 key，旧图保留（分区阶段重跑只追加 exc_stage） */
export function mergeFigs(prev: Fig[] | undefined, next: Fig[] | undefined): Fig[] {
  const out = new Map<string, Fig>();
  for (const f of prev || []) out.set(f.key, f);
  for (const f of next || []) out.set(f.key, f);
  return [...out.values()];
}

export type KernelRunApi = ReturnType<typeof useKernelRun>;
