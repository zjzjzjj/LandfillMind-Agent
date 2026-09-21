/**
 * routes/kernel3d.ts · 三维内核（Landfill 3D Tool）供给层
 *
 * GET  /api/kernel3d/health       → 桥配置状态
 * GET  /api/kernel3d/mesh[/info]/active → 真实三维查看器的会话 OBJ 与元数据
 * POST /api/kernel3d/run          → 3D 工具面板的 GUI 数据通道（直驱内核，落 tool_runs）
 * GET  /api/kernel3d/project/active → 工程存档下载（等价桌面"另存工程"）
 * GET  /api/kernel3d/file/:sid/:run/:name → 白名单静态文件（卡片 PNG / report.txt / 工程存档）
 *   路径三段都过 ^[A-Za-z0-9._-]+$，resolve 后强制落在该 run 目录内（防穿越），
 *   扩展名白名单 png/pdf/svg/csv/txt/md/json/xlsx/docx；?dl=1 触发下载。
 *   （export 动作产出的 Excel/Word 就走这条路由发文件）
 *   注：正则不含 '@' —— 内核侧的导出文件名必须避开它，否则会被静默滤掉。
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import {
  kernel3dStatus, kernel3dSessionDir, hasSessionProject, getActiveKernelSession,
  markActiveKernelSession, runKernel3dAction, ensureKernelMesh,
  ensureKernelMeshViewport, getKernelMeshInfo,
  sessionProjectFile,
} from '../kernel3d.js';
import { execTool } from '../tools.js';

const SEG_OK = /^[A-Za-z0-9._-]+$/;
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // 桌面「⤓ 导出当前图」的出版件（v5.3 Web 对齐新增）
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function kernel3dRouter(): Router {
  const r = Router();

  r.get('/api/kernel3d/health', (_req, res) => {
    res.json({ ok: true, ...kernel3dStatus() });
  });

  /** 内核自述（动作/图注册表/下拉选项单一来源），Web 工具页动态拉取 */
  r.get('/api/kernel3d/info', async (_req, res) => {
    try {
      const run = await runKernel3dAction({ action: 'info', sessionId: 'info-cache' });
      res.json({ ok: run.ok, data: run.data, stamp: run.stamp, error: run.error });
    } catch (e: any) {
      res.status(503).json({ ok: false, error: e?.message ?? '内核不可用' });
    }
  });

  /** 真实三维查看器：活动会话 OBJ（改过模自动重导，刷新即最新） */
  r.get('/api/kernel3d/mesh/active', async (_req, res) => {
    try {
      const m = await ensureKernelMesh();
      if (!m.ok) return res.status(422).json({ ok: false, error: m.error });
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Kernel-Refreshed', m.refreshed ? '1' : '0');
      fs.createReadStream(m.objPath).pipe(res);
      return undefined;
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? '网格获取失败' });
    }
  });

  /**
   * 真实三维查看器：网格元数据（bounds/顶点数），供相机取景与信息栏。
   *
   * `?sid=` 可选：给了就查那个会话（工具页有自己的 sid），并回带**全局活动
   * 会话号**。工具页靠这两个值判断要不要"接管"活动会话 —— 查看器读的是活动
   * 会话指针，而计算走页面自己的 sid，两者不同源时会出现「三维里明明有模型，
   * 一点计算就说请先建模」。没有 sid 时行为与以前一致（只看活动会话）。
   */
  r.get('/api/kernel3d/mesh-info/active', (req, res) => {
    const want = String(req.query.sid ?? '').trim();
    const active = getActiveKernelSession();
    const mine = want && /^[A-Za-z0-9._-]{1,64}$/.test(want) && hasSessionProject(want);
    const sid = mine ? want : active;
    if (!sid || !hasSessionProject(sid)) {
      return res.status(422).json({ ok: false, error: '暂无活动三维模型 —— 先在智能体对话里建模' });
    }
    res.json({ ok: true, sessionId: sid, activeSessionId: active, info: getKernelMeshInfo(sid) });
  });

  /**
   * 三维视图的叠加层（桌面 ⑥三维显示）：按指令重导网格。
   *
   * body: {sid?, overlay: {contour:{n_levels}, flood:{level}, slip:{}, fs:{}, heat:{}}}
   * 走 POST 而不是 GET 查询串 —— 叠加层里带着稳定性/沉积参数（section、c、φ、
   * n_grid…），塞 URL 既长又难转义。重导后 model.obj 与 mesh-info.json 落盘，
   * 前端再走既有的 GET /mesh/active 取（叠加层不变时那条路径是纯缓存命中）。
   */
  r.post('/api/kernel3d/mesh/viewport', async (req, res) => {
    try {
      const sid = String(req.body?.sid ?? '').trim() || undefined;
      const overlay = req.body?.overlay;
      const spec = overlay && typeof overlay === 'object' && Object.keys(overlay).length
        ? (overlay as Record<string, unknown>) : null;
      const p = req.body?.params;
      const params = p && typeof p === 'object' ? (p as Record<string, unknown>) : null;
      const m = await ensureKernelMeshViewport(sid, spec, params);
      if (!m.ok) return res.status(422).json({ ok: false, error: m.error });
      res.json({ ok: true, sessionId: m.sid, refreshed: m.refreshed, info: m.info });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? '叠加层重导失败' });
    }
  });

  /** GUI 数据通道：3D 工具面板页直接驱动内核（不经 LLM），走统一 execTool 落库 */
  r.post('/api/kernel3d/run', async (req, res) => {
    try {
      const { action, spec, params, figures, with_report, report, fig_export, spec_mode, sid } = req.body ?? {};
      if (!action) return res.status(400).json({ ok: false, error: '缺少 action' });
      const raw: Record<string, unknown> = { action };
      if (spec != null) raw.spec = spec;
      if (params != null) raw.params = params;
      if (figures != null) raw.figures = figures;
      if (with_report || report) raw.with_report = true;
      // 出版件导出（桌面「⤓ 导出当前图」PNG 300dpi / PDF / SVG）
      if (fig_export != null) raw.fig_export = fig_export;
      // 工具页发的是完整 spec → 整份替换，不要增量合并（见 tools.ts 注释）
      if (spec_mode != null) raw.spec_mode = spec_mode;
      const run = await execTool('run_3d_kernel', raw, { sessionId: String(sid ?? 'tool-gui') });
      res.json(run);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? '执行失败' });
    }
  });

  /** 打开工程（等价桌面 文件→打开工程；参数化路线）：前端传解析好的 project JSON */
  r.post('/api/kernel3d/import', async (req, res) => {
    try {
      const sid = String(req.body?.sid ?? '').trim();
      const project = req.body?.project as Record<string, unknown> | undefined;
      if (!sid || !/^[A-Za-z0-9._-]{1,64}$/.test(sid)) {
        return res.status(400).json({ ok: false, error: '非法会话号' });
      }
      if (!project || typeof project !== 'object') {
        return res.status(400).json({ ok: false, error: '缺少工程对象' });
      }
      if (!(project.parametric && project.footprint_polygon)
        && !Array.isArray(project.base_points)) {
        return res.status(422).json({ ok: false, error: '工程文件既非参数化定义（footprint/cells）也不含基底测点（base_points），无法重建' });
      }
      const dir = kernel3dSessionDir(sid);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project), 'utf-8');
      const r = await runKernel3dAction({ action: 'mesh', sessionId: sid });
      if (!r.ok) {
        return res.status(422).json({ ok: false, error: `工程载入内核失败：${r.summary || r.error}` });
      }
      res.json({ ok: true, summary: r.summary, stamp: r.stamp });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message ?? '导入失败' });
    }
  });

  /** 工程存档下载（等价桌面「文件→另存工程」；Web 等价物 = 会话 project.json） */
  r.get('/api/kernel3d/project/active', (_req, res) => {
    const sid = getActiveKernelSession();
    if (!sid || !hasSessionProject(sid)) {
      return res.status(422).json({ ok: false, error: '暂无活动三维模型' });
    }
    const fp = sessionProjectFile(sid);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="landfill3d-project-${sid.slice(0, 8)}.json"`);
    fs.createReadStream(fp).pipe(res);
    return undefined;
  });

  // 白名单静态文件路由（必须挂在 /api 404 兜底之前，由 index.ts 挂载顺序保证）
  r.get('/api/kernel3d/file/:sid/:run/:name', (req, res) => {
    const { sid, run, name } = req.params;
    if (![sid, run, name].every((s) => SEG_OK.test(s))) {
      return res.status(400).json({ ok: false, error: '非法路径段' });
    }
    const ext = path.extname(name).toLowerCase();
    if (!TYPES[ext]) return res.status(403).json({ ok: false, error: '文件类型不允许' });
    const base = path.resolve(kernel3dSessionDir(sid), 'runs', run);
    const fp = path.resolve(base, name);
    if (!fp.startsWith(base + path.sep)) {
      return res.status(400).json({ ok: false, error: '路径越界' });
    }
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      return res.status(404).json({ ok: false, error: '文件不存在' });
    }
    res.setHeader('Content-Type', TYPES[ext]);
    res.setHeader('Content-Length', String(fs.statSync(fp).size));
    // 图片给前端 <img> 用（inline）；?dl=1 或文本类默认 attachment 方便另存
    if (req.query.dl === '1' || ext !== '.png') {
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    }
    fs.createReadStream(fp).pipe(res);
    return undefined;
  });

  return r;
}
