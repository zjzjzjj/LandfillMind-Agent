/**
 * kernel3d.ts — LandfillMind 到三维内核 landfill3d（Python，v1.7.2-rb）的桥。
 *
 * 内核随仓库内置在 `kernel3d/`（agent_bridge.py + landfill3d 包），默认无需配置；
 * KERNEL3D_REPO_PATH 只在你想让应用去调另一份内核副本时才设（例如内核还在独立
 * 仓库里开发、想先验证再合入）。依赖见 kernel3d/requirements.txt。
 *
 * 两条通道：
 *   1) 旧 stdin 桥 runKernel3d(cfg)：spawn `py -m landfill3d.cli`，配置 JSON 走
 *      stdin、结果 JSON 走 stdout —— 快查五模块（demo 场地）与口径守卫语义，
 *      pilot-benchmark / k3d-check 依赖，契约不动。
 *   2) 会话模式 runKernel3dAction(opts)：spawn `py <repo>/agent_bridge.py
 *      --input in.json --output out.json` —— 自定义几何建模、会话工程、开挖、
 *      PNG 产物与报告（数据面只走文件，绕开 GBK/引号编码问题）。
 *
 * 共同纪律：
 *  - 不经 shell（避免 Windows 引号/编码地狱），PYTHONIOENCODING=utf-8 强制；
 *  - 内核自身错误返回 ok=false JSON（不抛），守卫拦截在此表现为可判定的
 *    信封 error —— 红队任务因此有真实落库痕迹；
 *  - 输出透传落章三元组 stamp {version, physics, kernel}，报告层可审计。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Kernel3dResult {
  ok: boolean;
  module?: string;
  stamp?: Record<string, string>;
  result?: unknown;
  notes?: string[];
  error?: string;
  elapsedMs: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 内核仓库根：默认用仓库内置的 `kernel3d/`（与 server/ 同级，随 git 一起走）。
 * KERNEL3D_REPO_PATH 只在你想让应用去调**另一份**内核副本时才设（对照实验、
 * 桌面工具新版本先行验证）；指到一个不存在的路径会得到 configured:false + hint，
 * 不会静默退回内置副本 —— 免得"改了内核没生效"这类事再发生一次。
 */
const REPO = process.env.KERNEL3D_REPO_PATH || path.resolve(HERE, '..', 'kernel3d');
/** 解释器：Windows 用 py 启动器，类 Unix（Docker / Render）用 python3；KERNEL3D_PY 覆盖 */
const PY = process.env.KERNEL3D_PY || (process.platform === 'win32' ? 'py' : 'python3');

/**
 * 内核子进程环境。
 *
 * 必须剥掉 VIRTUAL_ENV：`py` 启动器见到它就选当前激活的 venv，而 agent 自己的
 * `.venv` 里没有 numpy/scipy/matplotlib —— 于是在激活了 venv 的终端里跑
 * `npm run dev`，内核会以 `ModuleNotFoundError: No module named 'numpy'` 崩掉
 * （表现为一堆"内核输出非 JSON"，看着像内核坏了，其实是解释器选错）。
 * 剥掉之后 `py` 回到系统 Python（本机 3.14，带科学栈）。
 * 需要指定别的解释器就设 KERNEL3D_PY。
 */
function kernelSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  if (!process.env.KERNEL3D_PY) {
    delete env.VIRTUAL_ENV;
    // 双保险：把 venv 目录从 PATH 里摘掉
    const venv = process.env.VIRTUAL_ENV;
    if (venv && env.PATH) {
      const sep = process.platform === 'win32' ? ';' : ':';
      env.PATH = env.PATH.split(sep)
        .filter((p: string) => p && !p.toLowerCase().startsWith(venv.toLowerCase()))
        .join(sep);
    }
  }
  return env;
}

export function runKernel3d(
  cfg: Record<string, unknown>,
  timeoutMs = 300_000,
): Promise<Kernel3dResult> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(PY, ['-m', 'landfill3d.cli'], {
        cwd: REPO,
        env: kernelSpawnEnv(),
        windowsHide: true,
      });
    } catch (e: any) {
      resolve({ ok: false, error: `内核进程启动失败: ${e?.message}`, elapsedMs: Date.now() - t0 });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve({ ok: false, error: `内核调用超时（>${Math.round(timeoutMs / 1000)}s）`, elapsedMs: Date.now() - t0 });
    }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d.toString('utf-8'); });
    child.stderr?.on('data', (d) => { err += d.toString('utf-8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `spawn error: ${e?.message}`, elapsedMs: Date.now() - t0 });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        const j = JSON.parse(line) as Kernel3dResult;
        resolve({ ...j, elapsedMs: Date.now() - t0 });
      } catch {
        resolve({
          ok: false,
          error: `内核输出非 JSON（exit-close 解析失败）：${(err || out).slice(0, 200)}`,
          elapsedMs: Date.now() - t0,
        });
      }
    });
    child.stdin?.write(JSON.stringify(cfg), 'utf-8');
    child.stdin?.end();
  });
}

// ============================================================
// 会话模式（文件桥 agent_bridge.py / landfill3d.agent_cli）
// ============================================================
/**
 * run_3d_kernel 的 action= 模式：用户自定义几何建模 + 会话工程 + 专项分析
 * （stability/settlement/excavation/pollution/storage/render）。
 * PNG/报告落在 data/kernel3d/sessions/<sid>/runs/<runId>/，由
 * /api/kernel3d/file 白名单路由供给卡片。
 */

const RUNS_ROOT = path.resolve(HERE, '..', 'data', 'kernel3d');

export interface Kernel3dFigure {
  key: string;
  label: string;
  url: string;
  size: number;
}

export interface Kernel3dActionRun {
  ok: boolean;
  runId: string;
  action: string;
  summary: string;
  grade?: string | null;
  stamp?: Record<string, string>;
  data: unknown;
  sceneHint?: Record<string, unknown> | null;
  figures: Kernel3dFigure[];
  files: Array<{ kind: string; file: string; url: string }>;
  reportUrl?: string;
  notes: string[];
  elapsedMs: number;
  error?: string;
  logTail?: string;
}

/** 各 action 的耗时预算（慢扫描/羽流留余量），KERNEL3D_TIMEOUT_MS 覆盖 */
const ACTION_TIMEOUT_MS: Record<string, number> = {
  info: 30_000, build_model: 180_000, analyze_storage: 60_000,
  analyze_slope: 60_000, analyze_section: 60_000,
  analyze_stability: 240_000, analyze_settlement: 90_000,
  analyze_excavation: 180_000, analyze_excavation_phased: 420_000,
  excavation_zones: 60_000, analyze_pollution: 300_000,
  render: 180_000,
  // 带叠加图层（危险滑面/Fs/热力层）时会顺带跑一次稳定性或沉降分析,
  // 90s 不够 —— 与 analyze_stability 同一量级
  export_mesh: 240_000,
  export: 240_000,
};

export const KERNEL3D_ACTIONS = [
  'model', 'storage', 'slope', 'section', 'stability', 'settlement',
  'excavation', 'phased', 'zones', 'pollution', 'export', 'render', 'mesh',
] as const;

/** 工具 action 名 → CLI action 名 */
export function kernelActionToCli(action: string): string {
  if (action === 'model') return 'build_model';
  if (action === 'render' || action === 'info') return action;
  if (action === 'mesh') return 'export_mesh';
  if (action === 'zones') return 'excavation_zones';
  if (action === 'phased') return 'analyze_excavation_phased';
  if (action === 'export') return 'export';
  return `analyze_${action}`;
}

function sidSafe(sid: string | undefined): string {
  const s = String(sid ?? 'anon').replace(/[^A-Za-z0-9._-]/g, '_');
  return s.slice(0, 64) || 'anon';
}

export function kernel3dSessionDir(sid?: string): string {
  return path.join(RUNS_ROOT, 'sessions', sidSafe(sid));
}

/** 会话级几何 spec（"改模"增量合并的基底）；未建过返回 null */
export function loadSessionSpec(sid?: string): Record<string, unknown> | null {
  try {
    const p = path.join(kernel3dSessionDir(sid), 'spec.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

/** 浅合并：新键覆盖旧键；给了新底形描述时清掉另一种，避免 build 端歧义 */
export function mergeSpec(
  prev: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined) continue;
    if (k === 'rect') delete out.polygon;
    if (k === 'polygon') delete out.rect;
    if (k === 'cells' || k === 'shape') {
      delete out.rect; delete out.polygon;
    }
    out[k] = v;
  }
  return out;
}

function saveSessionFile(sid: string | undefined, name: string, content: string): void {
  const dir = kernel3dSessionDir(sid);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  // 原子替换：并行 tool call 同时写 spec.json 时不留半截文件
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, target);
}

export function saveSessionSpec(sid: string | undefined, spec: Record<string, unknown>): void {
  saveSessionFile(sid, 'spec.json', JSON.stringify(spec, null, 2));
}

/** 会话工程文件（build_model 成功后每次覆盖；analyze_* 以此为模型来源） */
export function sessionProjectFile(sid?: string): string {
  return path.join(kernel3dSessionDir(sid), 'project.json');
}

export function hasSessionProject(sid?: string): boolean {
  return fs.existsSync(sessionProjectFile(sid));
}

// ---------------- 活动会话指针（真实三维查看器 / 工具面板共用） ----------------
/** 哪个会话最近建过模，查看器/工具面板就显示谁的模型（active-session 指针）。 */
const ACTIVE_SESSION_FILE = path.join(RUNS_ROOT, 'active-session.txt');

export function markActiveKernelSession(sid: string): void {
  try {
    fs.mkdirSync(RUNS_ROOT, { recursive: true });
    fs.writeFileSync(ACTIVE_SESSION_FILE, sidSafe(sid), 'utf-8');
  } catch { /* 指针写失败不影响主流程 */ }
}

/** 返回有工程文件的最近建模会话；无则 null */
export function getActiveKernelSession(): string | null {
  try {
    const sid = fs.readFileSync(ACTIVE_SESSION_FILE, 'utf-8').trim();
    if (!sid) return null;
    return fs.existsSync(sessionProjectFile(sid)) ? sid : null;
  } catch { return null; }
}

// ---------------- 真实三维查看器（/3d-simulator）：会话 OBJ 供给 ----------------
/** 读取会话网格元数据（bounds/顶点数）；无 mesh-info 时从 OBJ 头注释兜底 */
export function getKernelMeshInfo(sid: string): Record<string, unknown> | null {
  const infoPath = path.join(kernel3dSessionDir(sid), 'mesh-info.json');
  try {
    if (fs.existsSync(infoPath)) return JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  } catch { /* fallthrough */ }
  return null;
}

/** 视图叠加层的请求指纹（记在 viewport.json，用来判断要不要重导网格） */
function viewportKey(overlay?: Record<string, unknown> | null,
                     params?: Record<string, unknown> | null): string {
  if (!overlay || !Object.keys(overlay).length) return '';
  // 键排序后序列化 —— 保证 {a,b} 与 {b,a} 同指纹。
  // params 只放**影响叠加几何的那些**（稳定性 c/φ、沉降土层…），前端显式挑好，
  // 免得用户改个无关字段就把整张网格重导一遍。
  const norm = (o: Record<string, unknown> | null | undefined) =>
    Object.keys(o || {}).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (o as Record<string, unknown>)[k]; return acc;
    }, {});
  return JSON.stringify({ overlay: norm(overlay), params: norm(params) });
}

function readViewportKey(sid: string): string {
  try {
    const p = path.join(kernel3dSessionDir(sid), 'viewport.json');
    if (!fs.existsSync(p)) return '';
    return String(JSON.parse(fs.readFileSync(p, 'utf-8'))?.key ?? '');
  } catch { return ''; }
}

function writeViewportKey(sid: string, key: string): void {
  try {
    fs.writeFileSync(path.join(kernel3dSessionDir(sid), 'viewport.json'),
      JSON.stringify({ key, at: new Date().toISOString() }), 'utf-8');
  } catch { /* 指纹写失败只是下次多重导一次 */ }
}

/**
 * 确保活动会话有最新网格 —— **只判 mtime**（GET /mesh/active 用）。
 *
 * 不看叠加指纹：叠加层由 POST /mesh/viewport 负责，若这里也用空指纹去比，
 * 会把刚建好的叠加层当场抹掉。返回 {sid, objPath, info, refreshed}。
 */
export async function ensureKernelMesh(sid?: string): Promise<
  { ok: false; error: string } | { ok: true; sid: string; objPath: string; info: Record<string, unknown> | null; refreshed: boolean }
> {
  const target = sid || getActiveKernelSession();
  if (!target || !hasSessionProject(target)) {
    return { ok: false, error: '暂无活动三维模型 —— 先在智能体对话里用 run_3d_kernel 建模（action=model）' };
  }
  const objPath = path.join(kernel3dSessionDir(target), 'model.obj');
  const projMtime = fs.statSync(sessionProjectFile(target)).mtimeMs;
  const objMtime = fs.existsSync(objPath) ? fs.statSync(objPath).mtimeMs : 0;
  let refreshed = false;
  if (objMtime < projMtime) {
    try {
      const r = await runKernel3dAction({ action: 'mesh', sessionId: target });
      if (!r.ok) return { ok: false, error: `网格导出失败：${r.summary || r.error || '未知错误'}` };
      refreshed = true;
    } catch (e: any) {
      return { ok: false, error: e?.message ?? '网格导出异常' };
    }
  }
  if (!fs.existsSync(objPath)) {
    return { ok: false, error: '网格文件缺失（内置内核没产出 model.obj —— kernel3d/ 副本被改动，还是会话产物已过期？）' };
  }
  return { ok: true, sid: target, objPath, info: getKernelMeshInfo(target), refreshed };
}

/**
 * 按**视图叠加层指令**确保网格 —— mtime 或叠加指纹任一变化就重导。
 *
 * overlay 是叠加层指令（不是数据）：{contour:{n_levels}, flood:{level},
 * slip:{}, fs:{}, heat:{}}。需要算物理的那几层由内核复用分析侧构造，
 * 服务端只负责透传与缓存失效判断。overlay=null 表示"要一张没有叠加的"。
 */
export async function ensureKernelMeshViewport(
  sid: string | undefined,
  overlay: Record<string, unknown> | null,
  overlayParams?: Record<string, unknown> | null,
): Promise<
  { ok: false; error: string } | { ok: true; sid: string; objPath: string; info: Record<string, unknown> | null; refreshed: boolean }
> {
  const target = sid || getActiveKernelSession();
  if (!target || !hasSessionProject(target)) {
    return { ok: false, error: '暂无活动三维模型 —— 先在智能体对话里用 run_3d_kernel 建模（action=model）' };
  }
  const objPath = path.join(kernel3dSessionDir(target), 'model.obj');
  const projMtime = fs.statSync(sessionProjectFile(target)).mtimeMs;
  const objMtime = fs.existsSync(objPath) ? fs.statSync(objPath).mtimeMs : 0;
  const wantKey = viewportKey(overlay, overlayParams);
  let refreshed = false;
  if (objMtime < projMtime || readViewportKey(target) !== wantKey) {
    try {
      const r = await runKernel3dAction({
        action: 'mesh', sessionId: target,
        params: wantKey ? { overlay, ...(overlayParams || {}) } : undefined,
      });
      if (!r.ok) return { ok: false, error: `网格导出失败：${r.summary || r.error || '未知错误'}` };
      writeViewportKey(target, wantKey);
      refreshed = true;
    } catch (e: any) {
      return { ok: false, error: e?.message ?? '网格导出异常' };
    }
  }
  if (!fs.existsSync(objPath)) {
    return { ok: false, error: '网格文件缺失（内置内核没产出 model.obj —— kernel3d/ 副本被改动，还是会话产物已过期？）' };
  }
  return { ok: true, sid: target, objPath, info: getKernelMeshInfo(target), refreshed };
}

function newRunDir(sid?: string): { runId: string; dir: string } {
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const dir = path.join(kernel3dSessionDir(sid), 'runs', runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

/** 会话产物清理：每会话保留最近 keep 次运行 + 7 天双限 */
export function pruneKernel3dRuns(sid?: string, keep = 30): void {
  try {
    const root = path.join(kernel3dSessionDir(sid), 'runs');
    if (!fs.existsSync(root)) return;
    const now = Date.now();
    const entries = fs.readdirSync(root)
      .map((name) => {
        const p = path.join(root, name);
        return { p, mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const e of entries.slice(keep)) fs.rmSync(e.p, { recursive: true, force: true });
    for (const e of entries) {
      if (now - e.mtime > 7 * 24 * 3600_000) fs.rmSync(e.p, { recursive: true, force: true });
    }
  } catch { /* 清理失败不影响主流程 */ }
}

/** 桥可用性（供 /api/kernel3d/health 与 exec 前置检查） */
export function resolveKernel3dBridge(): { py: string; bridge: string; repo: string } | null {
  const bridge = path.join(REPO, 'agent_bridge.py');
  if (!fs.existsSync(bridge)) return null;
  return { py: PY, bridge, repo: REPO };
}

export function kernel3dStatus() {
  const b = resolveKernel3dBridge();
  return {
    configured: Boolean(b),
    repo: REPO,
    python: PY,
    bridge: b ? b.bridge : path.join(REPO, 'agent_bridge.py'),
    hint: `未找到三维内核（内置副本应在 ${path.resolve(HERE, '..', 'kernel3d')}）。`
      + '内置副本缺失时先 `git checkout -- kernel3d`；确要指向别的副本再设 KERNEL3D_REPO_PATH。'
      + `当前解释器 ${PY}（Windows 默认 py，类 Unix 默认 python3，可用 KERNEL3D_PY 指定）`,
  };
}

/** 出口瘦身：递归截超长数组（SSE / tool_runs / 前端三方受益），空间场已在内核侧裁剪 */
function shrinkForWire(v: unknown, maxArr = 150): unknown {
  if (Array.isArray(v)) {
    return v.slice(0, maxArr).map((x) => shrinkForWire(x, maxArr));
  }
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = shrinkForWire(x, maxArr);
    return o;
  }
  return v;
}

/**
 * 会话模式执行：spawn `py <repo>/agent_bridge.py --input in.json --output out.json --workdir runDir`。
 * 数组 argv、无 shell —— Windows 下含空格/中文的双端路径由 Node 自动转义。
 * 超时杀进程树：py 是启动器（真 python.exe 是孙进程），单 child.kill() 会留僵尸。
 */
export async function runKernel3dAction(opts: {
  action: string;
  spec?: Record<string, unknown>;
  params?: Record<string, unknown>;
  figures?: string[] | null;
  report?: boolean;
  /** 出版件导出（桌面「⤓ 导出当前图」）：{format:'png'|'pdf'|'svg', dpi} */
  figExport?: { format: string; dpi?: number };
  sessionId?: string;
}): Promise<Kernel3dActionRun> {
  const t0 = Date.now();
  const cliAction = kernelActionToCli(opts.action);
  const ready = resolveKernel3dBridge();
  if (!ready) {
    throw new Error(kernel3dStatus().hint);
  }
  const sid = sidSafe(opts.sessionId);
  const { runId, dir } = newRunDir(sid);

  const inJson = path.join(dir, 'in.json');
  const outJson = path.join(dir, 'out.json');
  const cfg: Record<string, unknown> = { action: cliAction };
  if (opts.spec) cfg.spec = opts.spec;
  if (opts.params) cfg.params = opts.params;
  if (opts.figures != null) cfg.figures = opts.figures;
  if (opts.report) cfg.report = true;
  if (opts.figExport) cfg.fig_export = opts.figExport;
  if (cliAction !== 'build_model' && cliAction !== 'info') {
    cfg.project_file = sessionProjectFile(sid);
  }
  fs.writeFileSync(inJson, JSON.stringify(cfg), 'utf-8');

  const envTimeout = Number(process.env.KERNEL3D_TIMEOUT_MS || 0);
  const timeoutMs = envTimeout || ACTION_TIMEOUT_MS[cliAction] || 180_000;

  const { code, logTail, killed } = await new Promise<{ code: number | null; logTail: string; killed: boolean }>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ready.py, [ready.bridge, '--input', inJson, '--output', outJson, '--workdir', dir], {
        cwd: dir,
        env: kernelSpawnEnv(),
        windowsHide: true,
      });
    } catch (e: any) {
      resolve({ code: -1, logTail: `spawn 失败: ${e?.message}`, killed: false });
      return;
    }
    let buf = '';
    child.stdout?.on('data', (d) => { buf += d.toString('utf-8'); });
    child.stderr?.on('data', (d) => { buf += d.toString('utf-8'); });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      buf += `\n[spawn error] ${err.message}`;
      resolve({ code: -1, logTail: buf.slice(-2000), killed });
    });
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve({ code: c, logTail: buf.slice(-2000), killed });
    });
  });

  // 读 out.json（兜底：stdout 末行 JSON —— CLI 落盘失败时的降级通道）
  let env: Record<string, any> | null = null;
  try {
    if (fs.existsSync(outJson)) env = JSON.parse(fs.readFileSync(outJson, 'utf-8'));
  } catch { /* fallthrough */ }
  if (!env) {
    const lines = logTail.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i]);
        if (j && typeof j === 'object' && 'ok' in j) { env = j; break; }
      } catch { /* 继续找 */ }
    }
  }
  if (!env) {
    return {
      ok: false, runId, action: opts.action, elapsedMs: Date.now() - t0,
      summary: killed
        ? `失败：内核超时（>${Math.round(timeoutMs / 1000)}s），可减小 n_sections / grid_nx 或关闭 do_plume 后重试`
        : `失败：内核未产出结果（exit=${code}）`,
      data: null, figures: [], files: [], notes: [],
      error: killed ? 'timeout' : `agent_cli exit ${code}`,
      logTail,
    };
  }

  pruneKernel3dRuns(sid);

  // 成功后固化会话状态：build_model → 工程存档 + spec + sceneHint 快照 + OBJ 网格；
  // export_mesh → 刷新网格；analyze_* → 回带最近一次 sceneHint
  let sceneHint: Record<string, unknown> | null = env.scene_hint ?? null;
  const sceneFile = path.join(kernel3dSessionDir(sid), 'scene.json');
  const meshTarget = path.join(kernel3dSessionDir(sid), 'model.obj');
  const meshInfo = cliAction === 'build_model'
    ? ((env.data?.model as Record<string, unknown> | undefined)?.mesh ?? null)
    : cliAction === 'export_mesh' ? (env.data?.mesh ?? null) : null;
  if (env.ok && (cliAction === 'build_model' || cliAction === 'export_mesh')) {
    try {
      const src = path.join(dir, 'project.json');
      if (fs.existsSync(src)) fs.copyFileSync(src, sessionProjectFile(sid));
      if (opts.spec) saveSessionSpec(sid, opts.spec);
      if (env.scene_hint) fs.writeFileSync(sceneFile, JSON.stringify(env.scene_hint), 'utf-8');
      const srcObj = path.join(dir, 'model.obj');
      if (fs.existsSync(srcObj)) {
        fs.copyFileSync(srcObj, meshTarget);
        if (meshInfo) fs.writeFileSync(path.join(kernel3dSessionDir(sid), 'mesh-info.json'), JSON.stringify(meshInfo), 'utf-8');
        markActiveKernelSession(sid);
      } else if (fs.existsSync(sessionProjectFile(sid))) {
        markActiveKernelSession(sid);
      }
    } catch { /* 会话态失败不毁结果展示 */ }
  } else if (env.ok && !sceneHint) {
    try {
      if (fs.existsSync(sceneFile)) sceneHint = JSON.parse(fs.readFileSync(sceneFile, 'utf-8'));
    } catch { /* 无快照则不出按钮 */ }
  }

  const figures: Kernel3dFigure[] = (Array.isArray(env.figures) ? env.figures : [])
    .filter((f: any) => f?.file && /^[A-Za-z0-9._-]+$/.test(String(f.file)))
    .map((f: any) => ({
      key: String(f.key),
      label: String(f.label ?? f.key),
      url: `/api/kernel3d/file/${sid}/${runId}/${f.file}`,
      size: Number(f.size) || 0,
    }));
  const hasReport = (Array.isArray(env.files) ? env.files : [])
    .some((f: any) => f?.kind === 'report' && f?.file === 'report.txt');
  const files = (Array.isArray(env.files) ? env.files : [])
    .filter((f: any) => f?.file && /^[A-Za-z0-9._-]+$/.test(String(f.file)) && f?.kind !== 'project')
    .map((f: any) => ({
      kind: String(f.kind ?? 'file'), file: String(f.file),
      url: `/api/kernel3d/file/${sid}/${runId}/${f.file}`,
    }));

  return {
    ok: Boolean(env.ok),
    runId,
    action: opts.action,
    summary: String(env.summary ?? ''),
    grade: env.grade ?? null,
    stamp: env.landfill3d,
    data: shrinkForWire(env.data ?? null),
    sceneHint,
    figures,
    files,
    reportUrl: hasReport ? `/api/kernel3d/file/${sid}/${runId}/report.txt` : undefined,
    notes: Array.isArray(env.notes) ? env.notes.slice(0, 12).map(String) : [],
    elapsedMs: Number(env.elapsed_ms) || (Date.now() - t0),
    error: env.error ?? undefined,
    ...(killed ? { logTail: '本次曾被超时杀死后又产出结果，若再现请调小参数' } : {}),
  };
}
