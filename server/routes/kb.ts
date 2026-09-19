/**
 * routes/kb.ts · 从 server/index.ts 拆出的独立路由模块
 */

import { Router } from 'express';
import { lookupKB, getKB } from '../kb.js';

export function kbRouter(): Router {
  const r = Router();
// ============ KB 检索 ============
r.post('/api/kb/search', (req, res) => {
  const { q, topK = 3 } = req.body as { q: string; topK?: number };
  if (!q) return res.status(400).json({ error: '缺少 query 参数' });
  const results = lookupKB(q, topK);
  res.json({ query: q, count: results.length, results });
});

r.get('/api/kb/:key', (req, res) => {
  const entry = getKB(req.params.key);
  if (!entry) return res.status(404).json({ error: 'KB 条目不存在' });
  res.json(entry);
});
  return r;
}
