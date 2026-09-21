/**
 * tool-smoke.ts — v5 统一工具层冒烟测试（确定性内核，不依赖 LLM key）
 * 用法：npx tsx scripts/tool-smoke.ts
 * 验证：execTool 信封 / 参数出处 / 范围校验 / 工具结果完整性
 */
import { initDb } from '../server/db.js';
import { execTool, detectRuleToolCall, buildFunctionTools, TOOL_DEFS } from '../server/tools.js';
import { generateReport } from '../server/report.js';
import { resolveKernel3dBridge } from '../server/kernel3d.js';

async function main() {
  await initDb();
  console.log('== v5 Tool Layer Smoke Test ==\n');
  console.log(`已注册工具(${TOOL_DEFS.length}):`, TOOL_DEFS.map(t => t.name).join(', '));
  console.log('function tools schema 生成:', buildFunctionTools().length, '条\n');

  const cases: Array<{ name: string; raw: Record<string, unknown>; expectFail?: boolean; sid?: string }> = [
    { name: 'kb_lookup', raw: { query: '边坡稳定安全系数要求' } },
    { name: 'calculate', raw: { name: 'slopeFs', params: { H: 40, beta: 2.5, phi: 20 } } },
    { name: 'calculate', raw: { name: 'leachateCalc', params: { area: 99999, rainfall: 1200 } } }, // area 越界 → clamp + warning
    { name: 'run_ogs_scenario', raw: { scenario: 'gas-production', params: { wasteMass: 500, simYears: 20 } } },
    { name: 'run_ogs_scenario', raw: { scenario: 'settlement', params: {} } },
    { name: 'build_scene', raw: { intent: { kind: 'natural', text: '建一个缓坡山谷型 500 万 m³ 的填埋场' }, injectOgs: true, ogsScenario: 'gas-production' } },
    { name: 'analyze_site', raw: { volumeScale: 1.6, pileHeight: 1.3, valleyWidth: 1.2 } },
    { name: 'calculate', raw: { name: 'unknown_calc', params: {} }, expectFail: true }, // 失败信封
    { name: 'run_3d_kernel', raw: { module: 'stability_infinite', params: { slope_deg: 18.4, ru: 0.3 } } },
    { name: 'run_3d_kernel', raw: { module: 'settlement', params: {} } },
    { name: 'run_3d_kernel', raw: { module: 'stability_infinite', params: { slope_deg: 18.4 }, physics: 'v160' }, expectFail: true }, // 红队：口径守卫必须拦截
    { name: 'deep_analysis', raw: { scenario: '某填埋场运营 15 年，渗滤液水位上升 0.8m，甲烷 35% LEL，堆体裂缝 12m，地下水氯离子 50→280mg/L，请综合评估' } }, // 4 领域真调工具 + 敏感性
  ];

  // —— 三维内核会话模式（自定义场地）：先分析→引导，model→stability→pollution 链
  if (resolveKernel3dBridge()) {
    const ksid = `smoke-k3d-${Date.now().toString(36)}`;
    cases.push(
      { name: 'run_3d_kernel', sid: ksid, raw: { action: 'stability', params: { n_sections: 3 } }, expectFail: true }, // 未建模 → 引导语
      {
        name: 'run_3d_kernel', sid: ksid, raw: {
          action: 'model', figures: [],
          spec: { site_name: '冒烟场', shape: 'rect', rect: { L: 300, W: 200 }, height: 30, n: 3.0, grid_nx: 41, layers: [['生活垃圾', 20, 10], ['覆土', 4, 18]] },
        },
      },
      { name: 'run_3d_kernel', sid: ksid, raw: { action: 'stability', params: { c: 8, phi_deg: 25, gamma: 10, ru: 0.2, n_sections: 3, n_grid: 4, n_R: 3, n_slices: 8 } } },
      { name: 'run_3d_kernel', sid: ksid, raw: { action: 'model', figures: [], spec: { height: 35 } } }, // 增量改模（与上次合并）
      { name: 'run_3d_kernel', sid: ksid, raw: { action: 'pollution', figures: [], params: { fill_start_year: 2010, fill_end_year: 2015, horizon_years: 10, do_column: false, do_plume: false } } },
      { name: 'run_3d_kernel', sid: ksid, raw: { action: 'bogus' }, expectFail: true }, // 未知 action → 错误信封
    );
  } else {
    console.log('⚠ 未配置三维内核（KERNEL3D_REPO_PATH / agent_bridge.py），跳过会话模式用例\n');
  }

  let failed = 0;
  for (const c of cases) {
    const run = await execTool(c.name, c.raw, { sessionId: c.sid ?? 'smoke-test' });
    const okMark = run.ok ? '✅' : '❌';
    const params = run.params.map(p => `${p.key}=${p.value}(${p.origin}${p.inRange ? '' : '!RANGE'})`).join(' ');
    console.log(`${okMark} ${c.name} [${run.status}] ${run.elapsedMs}ms`);
    if (params) console.log(`    参数: ${params}`);
    if (run.warnings.length) console.log(`    警告: ${run.warnings.join('; ')}`);
    if (run.ok) {
      const r = run.result as any;
      const brief = r?.summary?.slice(0, 90) ?? r?.analysis?.slice(0, 90) ?? r?.snapshot?.desc?.split('\n')[1] ?? r?.scenarioName ?? JSON.stringify(r).slice(0, 90);
      console.log(`    结果: ${brief}${run.unit ? ' [' + run.unit + ']' : ''}${run.grade ? ' grade=' + run.grade : ''}`);
    } else {
      console.log(`    失败: ${run.warnings[0]}`);
    }
    if (Boolean(run.ok) === Boolean(c.expectFail)) failed++;
    console.log('');
  }

  // 规则兜底映射
  console.log('== 通道B 规则映射 ==');
  for (const t of [
    '算一下边坡安全系数，堆高 40m 坡角 1:2.5',
    '用 OGS 模拟 500 万吨填埋场 20 年产气',
    '建一个缓坡山谷型 500 万 m³ 的填埋场',
    '渗滤液怎么处理？',
    '综合评估某填埋场风险：裂缝12m、甲烷35%LEL、渗滤液水位上升0.8m',
  ]) {
    console.log(`  "${t.slice(0, 24)}…" →`, JSON.stringify(detectRuleToolCall(t)));
  }
  // 工程报告（从 tool_runs 可追溯记录组装）
  console.log('== 工程报告（generateReport） ==');
  const report = generateReport({});
  if (report) {
    console.log(`✅ 报告生成：${report.title} · ${report.runCount} 条记录`);
    console.log('   章节:', report.sections.map(s => s.title).join(' / '));
    const first = report.markdown.split('\n').slice(0, 6).join('\n');
    console.log(`   报告头:\n${first}`);
  } else {
    console.log('⚠ 无运行记录，跳过报告验证');
  }

  console.log(failed === 0 ? '\n✅ 全部通过' : `\n❌ ${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });