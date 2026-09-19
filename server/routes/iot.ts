/**
 * routes/iot.ts · 从 server/index.ts 拆出的独立路由模块
 */

import { Router } from 'express';
import { snapshotReadings, onIotPublish } from '../iot.js';

export function iotRouter(): Router {
  const r = Router();
// ============ IoT 实时数据流 ============
// GET /api/iot/snapshot — 当前 5 个传感器快照（首屏）
r.get('/api/iot/snapshot', (_req, res) => {
  res.json({ ts: new Date().toISOString(), readings: snapshotReadings() });
});

// GET /api/iot/stream — SSE：先推 snapshot，再订阅 aedes 'publish' 实时转发
r.get('/api/iot/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  // 心跳保活（防反代断开）
  const ka = setInterval(() => {
    if (res.writableEnded) { clearInterval(ka); return; }
    try { res.write(':keepalive\n\n'); } catch { clearInterval(ka); }
  }, 15000);

  // 1) 立即推 snapshot
  res.write(`data: ${JSON.stringify({ type: 'snapshot', ts: new Date().toISOString(), readings: snapshotReadings() })}\n\n`);

  // 2) 订阅实时数据
  const off = onIotPublish((reading, topic) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify({ type: 'reading', topic, ts: reading.ts, reading })}\n\n`);
    } catch { /* ignore */ }
  });

  req.on('close', () => { clearInterval(ka); off(); });
});
  return r;
}
