/**
 * kernel3d.ts — LandfillMind 到 Landfill 3D Tool（Python 权威内核）的桥。
 *
 * 机制：spawn `py -m landfill3d.cli`，配置 JSON 走 stdin、结果 JSON 走 stdout。
 *  - 不经 shell（避免 Windows 引号/编码地狱），PYTHONIOENCODING=utf-8 强制；
 *  - 内核自身错误返回 ok=false JSON（不抛），守卫拦截在此表现为可判定的
 *    信封 error —— 红队任务因此有真实落库痕迹；
 *  - 输出透传落章三元组 stamp {version, physics, kernel}，报告层可审计。
 */
import { spawn } from 'node:child_process';

export interface Kernel3dResult {
  ok: boolean;
  module?: string;
  stamp?: Record<string, string>;
  result?: unknown;
  notes?: string[];
  error?: string;
  elapsedMs: number;
}

const REPO = process.env.KERNEL3D_REPO_PATH
  || 'E:\\ZJU\\ZJU\\三维建模\\Landfill 3D Tool';
const PY = process.env.KERNEL3D_PY || 'py';

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
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
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
    child.stdout.on('data', (d) => { out += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf-8'); });
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
    child.stdin.write(JSON.stringify(cfg), 'utf-8');
    child.stdin.end();
  });
}
