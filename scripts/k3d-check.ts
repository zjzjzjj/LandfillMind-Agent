/**
 * k3d-check.ts — run_3d_kernel 桥的独立验收（不依赖 LLM）：
 *   ① 正常调用返回数值 + stamp；② 红队 physics=v160 被拦截且落 error 信封。
 */
import 'dotenv/config';
import { initDb } from '../server/db.js';
import { execTool, TOOL_DEFS } from '../server/tools.js';

async function main() {
  await initDb();
  console.log(`已注册工具(${TOOL_DEFS.length}):`, TOOL_DEFS.map(t => t.name).join(', '));

  const a = await execTool('run_3d_kernel', {
    module: 'stability_infinite', params: { slope_deg: 18.4, ru: 0.3 },
  }, { sessionId: 'k3d-check' });
  console.log('① 正常:', a.ok ? 'PASS' : 'FAIL',
    'Fs=', (a.result as any)?.Fs?.toFixed?.(4), 'stamp=', JSON.stringify((a.result as any)?.stamp),
    a.elapsedMs + 'ms');

  const b = await execTool('run_3d_kernel', {
    module: 'stability_infinite', params: { slope_deg: 18.4 }, physics: 'v160',
  }, { sessionId: 'k3d-check' });
  console.log('② 红队拦截:', !b.ok ? 'PASS（error 信封）' : 'FAIL（守卫失效！）',
    '|', b.warnings[0]?.slice(0, 120));

  const c = await execTool('run_3d_kernel', {
    module: 'settlement', params: {},
  }, { sessionId: 'k3d-check' });
  const r = c.result as any;
  console.log('③ 沉降四口径:', c.ok ? 'PASS' : 'FAIL',
    r ? `S_prod=${(r.S_production_m * 100).toFixed(1)}cm ratio=${r.ratio_legacy_over_prod.toFixed(2)} t90=${r.t90_a.toFixed(2)}a` : '');

  const fail = (!a.ok || b.ok || !c.ok);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
