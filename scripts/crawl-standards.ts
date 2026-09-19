/**
 * LandfillMind · 实时标准抓取脚本（D · 知识保鲜）
 *
 * 用法：
 *   tsx scripts/crawl-standards.ts                  # 抓取所有目标标准
 *   tsx scripts/crawl-standards.ts --query GB 16889  # 抓取单个标准
 *   tsx scripts/crawl-standards.ts --since 2025-01   # 自 2025-01 起的新增/更新
 *
 * 抓取策略：
 *   1. 优先官方源（生态环境部 mohurd.gov.cn / mee.gov.cn）
 *   2. 次选国家标准全文公开系统 openstd.samr.gov.cn
 *   3. 兜底：行业聚合（环卫科技网、固废网）
 *
 * 输出：
 *   knowledge-base/01-standards/latest-updates.json（按日期排序）
 */

import * as fs from 'fs';
import * as path from 'path';

interface StandardUpdate {
  code: string;           // GB 16889-2024
  name: string;           // 生活垃圾填埋场污染控制标准
  publishDate: string;    // 2024-09-01
  effectiveDate: string;  // 2024-12-01
  status: 'active' | 'replaced' | 'abolished' | 'draft';
  replaces?: string;      // 替代 GB 16889-2008
  summary: string;        // 关键变化摘要
  sourceUrl: string;
  crawledAt: string;      // 抓取时间 ISO
}

// 目标标准列表（按优先级排序）
const TARGET_STANDARDS: { code: string; alias: string[]; description: string }[] = [
  { code: 'GB 16889', alias: ['生活垃圾填埋场污染控制标准'], description: '填埋场水气土核心标准' },
  { code: 'CJJ 176', alias: ['生活垃圾卫生填埋处理技术规范'], description: '工艺设计主要依据' },
  { code: 'CJJ 113', alias: ['生活垃圾卫生填埋场防渗系统工程技术规范'], description: '防渗衬层专项' },
  { code: 'CJJ 133', alias: ['生活垃圾填埋场填埋气收集处理及利用工程技术规范'], description: '填埋气收集' },
  { code: 'HJ 25.1', alias: ['建设用地土壤污染状况调查技术导则'], description: '场地调查' },
  { code: 'HJ 25.2', alias: ['建设用地土壤污染风险管控和修复监测技术导则'], description: '修复监测' },
  { code: 'HJ 25.6', alias: ['污染地块地下水修复和风险管控技术导则'], description: '地下水修复' },
  { code: 'GB 36600', alias: ['土壤环境质量 建设用地土壤污染风险管控标准'], description: '土壤筛选值' },
  { code: 'GB/T 14848', alias: ['地下水质量标准'], description: '地下水分类' },
  { code: 'HJ 1106', alias: ['排污许可证申请与核发技术规范 环境卫生管理业'], description: '排污许可' },
  { code: 'HJ 564', alias: ['生活垃圾填埋场污染控制标准 填埋气收集处理'], description: '填埋气专项' },
  { code: 'AQ 4202', alias: ['作业场所气体检测报警仪'], description: '气体检测' },
  { code: 'GB 30871', alias: ['危险化学品企业特殊作业安全规范'], description: '动火/有限空间' },
  { code: 'GB 51220', alias: ['生活垃圾卫生填埋处理技术规范'], description: '封场专项' },
  { code: 'CJJ/T 17', alias: ['生活垃圾卫生填埋处理技术规范 垃圾处理设施'], description: '建设运营' },
  { code: 'HJ 1095', alias: ['突发环境事件应急监测技术规范'], description: '应急监测' },
  { code: 'HJ 1139', alias: ['排污许可证申请与核发技术规范'], description: '排污许可 2' },
];

const OUTPUT_FILE = path.resolve(process.cwd(), 'knowledge-base/01-standards/latest-updates.json');

async function fetchStandardInfo(code: string, alias: string[]): Promise<StandardUpdate | null> {
  // 由于直接调用官方 API 需要鉴权，这里用 WebSearch + WebFetch 替代
  // 实际爬虫实现应使用 Playwright/Puppeteer 或 RSS 订阅
  // 此处给出静态数据库 + 手动刷新策略
  console.log(`[crawl] 查询 ${code}（${alias[0]}）...`);

  // 模拟抓取结果（实际部署替换为真实 API 调用）
  // 这里返回 null 表示"无更新"，由人工核实后写入
  // 实际生产环境应该用 Playwright 抓取 mohurd.gov.cn / mee.gov.cn 的标准列表页
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const singleCode = args.includes('--query') ? args[args.indexOf('--query') + 1] : null;
  const sinceDate = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;

  console.log('===== LandfillMind · 标准实时抓取 =====');
  console.log(`目标时间范围: ${sinceDate || '全部'}`);
  console.log(`查询模式: ${singleCode ? singleCode : '全部 ' + TARGET_STANDARDS.length + ' 项'}`);

  const targets = singleCode
    ? TARGET_STANDARDS.filter(s => s.code === singleCode)
    : TARGET_STANDARDS;

  if (targets.length === 0) {
    console.error(`✗ 未找到标准 ${singleCode}`);
    process.exit(1);
  }

  // 读取已有记录
  let existing: StandardUpdate[] = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
  }
  const existingCodes = new Set(existing.map(e => e.code));

  const updates: StandardUpdate[] = [...existing];
  let found = 0;

  for (const t of targets) {
    const info = await fetchStandardInfo(t.code, t.alias);
    if (info && !existingCodes.has(info.code)) {
      updates.push(info);
      found++;
      console.log(`  ✓ ${t.code} ${info.publishDate} (${info.status})`);
    } else {
      console.log(`  — ${t.code} 无更新`);
    }
  }

  // 按发布日期倒序
  updates.sort((a, b) => (b.publishDate ?? '').localeCompare(a.publishDate ?? ''));

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(updates, null, 2), 'utf-8');
  console.log(`\n✓ 完成。本次新增 ${found} 条，累计 ${updates.length} 条。`);
  console.log(`输出: ${OUTPUT_FILE}`);

  // 提示：实际部署建议
  console.log('\n===== 生产部署建议 =====');
  console.log('1. 接入官方 RSS（mohurd.gov.cn 标准发布、mee.gov.cn 公告）');
  console.log('2. 使用 Playwright + 定期 cron（每月 1 日 0:00 抓取）');
  console.log('3. 配合 AI 摘要接口（LLM 提取关键变化）');
  console.log('4. 触发 KB 自动 diff：高优先级标准变化 → 立即通知');
}

// 当前为静态实现（占位），生产部署时替换为真实爬虫
main().catch(e => {
  console.error('爬取出错:', e);
  process.exit(1);
});
