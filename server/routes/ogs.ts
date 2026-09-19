/**
 * routes/ogs.ts · 从 server/index.ts 拆出的独立路由模块
 */

import { Router } from 'express';
import { getOgsStatus, listOgsScenarios, runOgsScenario, getOgsRunFiles } from '../ogs.js';

export function ogsRouter(): Router {
  const r = Router();
// ============ OGS (OpenGeoSys) 数值模拟 ============
// GET /api/ogs/status → 求解器可用性 + 场景列表
r.get('/api/ogs/status', (_req, res) => {
  const s = getOgsStatus();
  res.json({ ok: true, ...s });
});
// POST /api/ogs/run → { scenario, params } → 运行求解器返回结构化结果
r.post('/api/ogs/run', async (req, res) => {
  const { scenario, params = {} } = req.body ?? {};
  if (!scenario) {
    return res.status(400).json({ ok: false, error: '缺少 scenario', scenarios: listOgsScenarios().map((s) => s.id) });
  }
  try {
    const result = await runOgsScenario(String(scenario), params ?? {});
    if (result.ok) return res.json(result);
    return res.status(422).json(result);
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? 'OGS 运行异常' });
  }
});
// GET /api/ogs/runs/:id → 某次运行的输出文件清单（供前端展示/下载）
r.get('/api/ogs/runs/:id', (req, res) => {
  const files = getOgsRunFiles(req.params.id);
  if (!files) return res.status(404).json({ ok: false, error: 'run not found' });
  res.json({ ok: true, runId: req.params.id, files });
});
  return r;
}
