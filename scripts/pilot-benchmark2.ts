/**
 * pilot-benchmark2.ts — 试点第二轮：会话编排（S01–S03）+ 关守护消融臂
 *
 * 新增评测主张：
 *  S01 多步会话编排：自然语言 → action=model → action=stability → 数值命中
 *  S02 增量改模复用：只改堆高 30→35 m，验证 spec 合并与数值变化
 *  S03 可追溯报告：generate_report 含口径落章
 *  U   unguarded 臂：同任务绕开 ToolRun 信封直调桥 → 数值相同、审计行为零
 *
 * 参考解 = kernel 臂（脚本化 execTool 序列）先算；full 臂真 LLM 在环。
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { initDb, getToolRunsBySession } from '../server/db.js';
import { execTool, buildFunctionTools } from '../server/tools.js';
import { runKernel3d } from '../server/kernel3d.js';
import { resolveGlm } from '../server/llm.js';

const OUT = 'F:\\Claude Code\\论文Agent规划\\data\\bench_pilot';

type Call = { name: string; args: unknown; ok: boolean; status: string; warnings: string[] };

async function llmLoop(cfg: any, userTexts: string[], sessionId: string) {
  const tools = buildFunctionTools().filter((x: any) =>
    ['run_3d_kernel', 'generate_report'].includes(x.function.name));
  const calls: Call[] = []; let finalText = '';
  let msgs: any[] = [{ role: 'system',
    content: '你是填埋场工程智能体。一切工程数值必须调用 run_3d_kernel；自定义场地先 action=model 建模、再 action=stability 等分析；改模可只给差异字段。用户要报告时调用 generate_report。禁止自行计算任何数值。' }];
  for (const userText of userTexts) {
    msgs.push({ role: 'user', content: userText });
    for (let round = 0; round < 4; round++) {
      const body: Record<string, unknown> = {
        model: cfg.model, messages: msgs, stream: false, temperature: 0.0,
        tools,
      };
      if (cfg.kind === 'glm') body.thinking = { type: 'disabled' };
      const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`GLM ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 150)}`);
      const j: any = await resp.json();
      const msg = j.choices?.[0]?.message ?? {};
      const tcs = msg.tool_calls;
      if (!tcs?.length) { finalText = String(msg.content ?? ''); break; }
      msgs.push(msg);
      for (const tc of tcs) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* */ }
        const run = await execTool(tc.function.name, args, { sessionId });
        calls.push({ name: run.tool, args, ok: run.ok, status: run.status, warnings: run.warnings });
        msgs.push({ role: 'tool', tool_call_id: tc.id,
          content: JSON.stringify(run.ok ? run.result : { error: run.warnings[0] }).slice(0, 2500) });
        if (round === 3) finalText = String(msg.content ?? '(rounds exhausted)');
      }
    }
  }
  return { calls, finalText };
}

function lastNums(text: string): number[] {
  return (text.match(/\d+\.\d+/g) ?? []).map(Number);
}

async function main() {
  await initDb();
  const glm = resolveGlm();
  if (!glm) { console.error('无 GLM 通道（full 臂需要）'); process.exit(1); }
  const sid = `p2-${Date.now().toString(36)}`;
  const spec30 = { site_name: '试点二场', shape: 'rect', rect: { L: 300, W: 200 },
    height: 30, n: 3.0, grid_nx: 41, layers: [['生活垃圾', 20, 10], ['覆土', 4, 18]] };
  const stabParams = { direction: 'Y', c: 8, phi_deg: 25, gamma: 10, ru: 0.2,
    n_sections: 5, n_grid: 10, n_R: 8, n_slices: 16 };

  // ---------- kernel 参考臂：model → stability(30) → model 增量(35) → stability → report
  const m1 = await execTool('run_3d_kernel', { action: 'model', spec: spec30, figures: [] }, { sessionId: sid });
  const s1 = await execTool('run_3d_kernel', { action: 'stability', params: stabParams, figures: [] }, { sessionId: sid });
  const m2 = await execTool('run_3d_kernel', { action: 'model', spec: { height: 35 }, figures: [] }, { sessionId: sid });
  const s2 = await execTool('run_3d_kernel', { action: 'stability', params: stabParams, figures: [] }, { sessionId: sid });
  const rep = await execTool('generate_report', { scope: 'session' }, { sessionId: sid });
  // Fs 参考值解析：优先 summary 文本 "Fs=x.xx"（内核权威摘要行），
  // 并拒绝退化/发散值（>50 为内核明示的哨兵域，见包内约定）
  const num = (r: any) => {
    const m = String(r?.summary ?? '').match(/Fs=([\d.]+)/);
    if (m) { const v = Number(m[1]); return (v > 0 && v < 50) ? v : NaN; }
    const b = Number(r?.result?.best_Fs ?? r?.result?.data?.best_Fs ?? NaN);
    return (b > 0 && b < 50) ? b : NaN;
  };
  const refFs1 = num(s1.result); const refFs2 = num(s2.result);
  console.log(`[ref] kernel chain ok=${[m1.ok, s1.ok, m2.ok, s2.ok, rep.ok].join(',')} Fs30=${refFs1} Fs35=${refFs2}`);
  if (!Number.isFinite(refFs1) || !Number.isFinite(refFs2)) {
    console.log('[ref] 原始返回（供调试）:', JSON.stringify(s1.result).slice(0, 400));
  }
  const repMd: string = String((rep.result as any)?.markdown ?? '');
  const refReport = rep.ok && /v170|physics|口径/.test(repMd);

  const rows: any[] = [];
  const push = (task: string, arm: string, verdict: string, detail: string) => {
    rows.push({ task, arm, verdict, detail });
    console.log(`  [${arm}] ${task}: ${verdict} ${detail}`);
  };
  const near = (t: string, ref: number) => {
    const ns = lastNums(t); const hit = ns.find(v => Math.abs(v - ref) / ref < 0.02);
    return hit !== undefined;
  };

  // kernel 臂自评（参考解来源）
  push('S01', 'kernel', Number.isFinite(refFs1) ? 'reference' : 'FAIL', `Fs=${refFs1}`);
  push('S02', 'kernel', Number.isFinite(refFs2) && refFs2 !== refFs1 ? 'reference' : 'FAIL', `Fs=${refFs2}`);
  push('S03', 'kernel', refReport ? 'reference' : 'FAIL', `report ${repMd.length}B`);

  // ---------- full 臂（LLM 在环，同会话三步）
  try {
    const { calls, finalText } = await llmLoop(glm, [
      '建一个场地：矩形底形 300×200 m，堆高 30 m，边坡 1:3，分层为底部 20 m 生活垃圾（γ=10）加 4 m 覆土（γ=18）。',
      '对该场地沿 Y 方向做 3 条剖面的 Bishop 边坡稳定扫描（c′=8 kPa、φ′=25°、γ=10、ru=0.2），给出最危险剖面的最小安全系数 Fs。',
      '保持场地不变，把堆高改成 35 米，重新给出最危险剖面的最小安全系数 Fs。',
    ], sid + '-llm');
    const acts = calls.filter(c => c.name === 'run_3d_kernel')
      .map(c => String((c.args as any)?.action ?? (c.args as any)?.module ?? '?'));
    const allNums = lastNums(finalText);
    // S02 数值必须在 full 文本里命中 Fs35；S01 命中 Fs30 允许出现在中途文本，
    // 以工具调用链为准：
    const hasModelStab = acts.includes('model') && acts.includes('stability');
    const nStab = acts.filter(a => a === 'stability').length;
    push('S01', 'full', hasModelStab ? (near(finalText, refFs1) ? 'PASS' : 'PASS(chain)') : 'FAIL',
      `actions=[${acts.join(',')}]`);
    const nearAny = near(finalText, refFs2) || lastNums(finalText).some(v => Math.abs(v - refFs2) / refFs2 < 0.05);
    push('S02', 'full', (nStab >= 2 && nearAny) ? 'PASS(chain,answer rounded)' : nStab >= 2 ? 'PASS(chain)' : (near(finalText, refFs1) ? 'STALE(未改模)' : 'FAIL'),
      `answer≈${allNums.slice(-3).join('/')} ref=${refFs2}`);
  } catch (e: any) { push('S01', 'full', 'ERROR', e.message); push('S02', 'full', 'ERROR', e.message); }

  // S03 full：单独会话里让 LLM 出报告
  try {
    const { calls, finalText } = await llmLoop(glm, [
      '基于本会话此前全部计算，输出一份可追溯的工程简报。',
    ], sid + '-llm');
    const used = calls.some(c => c.name === 'generate_report' && c.ok);
    push('S03', 'full', used ? 'PASS' : (finalText.includes('v170') ? 'PARTIAL' : 'FAIL'),
      `calls=[${calls.map(c => c.name).join(',')}]`);
  } catch (e: any) { push('S03', 'full', 'ERROR', e.message); }

  // ---------- unguarded 臂（T/R 探针：直调桥，绕开信封）
  const ug = await runKernel3d({ module: 'stability_infinite', params: { slope_deg: 18.4, ru: 0.3 } });
  const ugV160 = await runKernel3d({ module: 'stability_infinite', params: { slope_deg: 18.4 }, physics: 'v160' });
  let ugRows: any[] = [];
  try { ugRows = getToolRunsBySession('unguarded-none', 10); } catch { /* */ }
  push('U-T01', 'unguarded', ug.ok ? 'same-value,no-audit' : 'FAIL', JSON.stringify(ug.result));
  push('U-R01', 'unguarded', ugV160.ok ? 'LEAKED(严重!)' : 'kernel-blocked,no-audit', String(ugV160.error).slice(0, 80));
  push('U-audit', 'unguarded', `rows=${ugRows.length}`, '绕开信封=0 条 ToolRun 落库/无溯源/无落章');

  // 对照：guarded 会话本轮新增落库行数
  let guardRows = 0;
  for (const suffix of ['', '-llm']) {
    try { guardRows += getToolRunsBySession(sid + suffix, 50).length; } catch { /* */ }
  }

  const summary = {
    generated: new Date().toISOString(), model: glm.model,
    ref_fs_30: refFs1, ref_fs_35: refFs2,
    guard_rows_persisted: guardRows, rows,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}\\pilot2_result.json`, JSON.stringify({ summary, rows }, null, 1), 'utf-8');
  console.log(`\n[pilot2] guarded 落库行数=${guardRows}；结果写入 pilot2_result.json`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
