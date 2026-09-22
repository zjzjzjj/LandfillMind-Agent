/**
 * 知识库文献索引合并脚本
 *
 * 用法（项目根目录）：
 *   npx tsx scripts/build-references-index.ts
 *
 * 作用：
 *   1. 读取 knowledge-base/08-references/raw/*.json（各收集代理产出的文献清单）
 *   2. 按 title 去重（跨批次同题文献合并、保留高 confidence）
 *   3. 输出总索引 knowledge-base/08-references/references.json
 *   4. 输出人类可读版 knowledge-base/08-references/references.md（按领域分组）
 *   5. 打印统计：领域 × 类型 × 语言 × confidence
 */

import * as fs from 'fs';
import * as path from 'path';

interface Ref {
  id: string;
  domain?: string;
  type: string;
  language: string;
  title: string;
  authors?: string;
  year?: number | string;
  venue?: string;
  doi_or_url?: string;
  std_no?: string;
  status?: string;
  summary?: string;
  key_values?: string;
  provenance?: string;
  confidence?: string;
  [k: string]: unknown;
}

const RAW_DIR = path.resolve(process.cwd(), 'knowledge-base/08-references/raw');
const OUT_JSON = path.resolve(process.cwd(), 'knowledge-base/08-references/references.json');
const OUT_MD = path.resolve(process.cwd(), 'knowledge-base/08-references/references.md');

const DOMAIN_LABEL: Record<string, string> = {
  'cn-standards': '中国标准/规范全集',
  'lfg': '填埋气（LFG）专题',
  'leachate': '渗滤液专题',
  'gas-dewatering': '注气驱水·渗滤液强化提取·多相流',
  'remediation': '污染治理·土壤地下水·非正规填埋场',
  'intl': '国际标准指南·英文专著·期刊会议',
  'books-cn': '中文教材专著·政策法规·行业数据',
};

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[\s\-—_·:：,，.。?？!！()（）\[\]【】"'“””]+/g, '').slice(0, 80);
}

function main() {
  if (!fs.existsSync(RAW_DIR)) { console.error(`✗ 目录不存在：${RAW_DIR}`); process.exit(1); }
  const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) { console.error('✗ raw/ 下没有 JSON 文件'); process.exit(1); }

  const byDomain: Record<string, Ref[]> = {};
  const seen = new Map<string, Ref>();
  let dup = 0, total = 0;

  for (const f of files) {
    const domain = f.replace(/\.json$/, '');
    let data: { references?: Ref[] };
    try {
      data = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    } catch (e) {
      console.error(`✗ 解析失败 ${f}: ${(e as Error).message}`);
      continue;
    }
    const refs = Array.isArray(data.references) ? data.references : [];
    for (const r of refs) {
      if (!r || !r.title) { console.warn(`⚠ ${f}: 跳过无 title 条目`); continue; }
      total++;
      const key = normTitle(r.title);
      const entry: Ref = { ...r, domain: r.domain || domain };
      const prev = seen.get(key);
      if (prev) {
        dup++;
        // 保留 confidence 更高者，合并 domain 标签
        const rank = (c?: string) => (c === 'verified' ? 2 : c === 'snippet-only' ? 1 : 0);
        if (rank(entry.confidence) > rank(prev.confidence)) {
          entry.domain = prev.domain === entry.domain ? entry.domain : `${prev.domain}+${entry.domain}`;
          seen.set(key, entry);
        }
        continue;
      }
      seen.set(key, entry);
    }
  }

  for (const r of seen.values()) {
    const d = (r.domain || 'misc').split('+')[0];
    (byDomain[d] = byDomain[d] || []).push(r);
  }

  // 重排 id（域内连续）
  for (const [d, list] of Object.entries(byDomain)) {
    list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'));
    list.forEach((r, i) => { r.id = `${d}-${String(i + 1).padStart(3, '0')}`; });
  }

  const allOrdered = Object.keys(byDomain)
    .sort((a, b) => (DOMAIN_LABEL[a] || a).localeCompare(DOMAIN_LABEL[b] || b, 'zh'))
    .flatMap(d => byDomain[d]);

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    _meta: {
      generated_at: new Date().toISOString().slice(0, 10),
      source: 'knowledge-base/08-references/raw/*.json（合并去重）',
      rebuild_cmd: 'npx tsx scripts/build-references-index.ts',
      total: allOrdered.length,
    },
    references: allOrdered,
  }, null, 2), 'utf8');
  console.log(`✓ ${OUT_JSON}`);

  const md: string[] = [
    '# LandfillMind 知识库 · 文献/规范/书籍总索引',
    '',
    `> 由 \`scripts/build-references-index.ts\` 自动生成（${new Date().toISOString().slice(0, 10)}）。`,
    `> 原始数据在 \`08-references/raw/\`，只增改原始文件后重跑脚本即可。`,
    '> 收录原则：**只记录真实检索到的条目**；confidence=snippet-only 的条目细节未全核，引用前请回源确认。',
    '',
    `**总计 ${allOrdered.length} 条**（合并去重前 ${total} 条，重复 ${dup} 条）`,
    '',
  ];
  for (const d of Object.keys(byDomain)) {
    const list = byDomain[d];
    const cnt = (t: string) => list.filter(r => r.type === t).length;
    md.push(`## ${DOMAIN_LABEL[d] || d}（${list.length} 条）`, '');
    md.push(`期刊 ${cnt('journal')} · 标准 ${cnt('standard')} · 专著 ${cnt('book')} · 指南/报告 ${cnt('guidance') + cnt('report') + cnt('guideline')} · 政策 ${cnt('policy')} · 学位论文 ${cnt('thesis')} · 会议 ${cnt('conference')} · 其他 ${list.length - cnt('journal') - cnt('standard') - cnt('book') - cnt('guidance') - cnt('report') - cnt('guideline') - cnt('policy') - cnt('thesis') - cnt('conference')}`, '');
    for (const r of list) {
      const tag = r.confidence === 'verified' ? '✅' : r.confidence === 'snippet-only' ? '🔹' : '⚪';
      const head = [
        `- ${tag} **${r.title}**`,
        r.authors ? ` — ${r.authors}` : '',
        r.year ? `（${r.year}）` : '',
        r.std_no ? ` \`${r.std_no}\`` : '',
        r.venue ? ` · ${r.venue}` : '',
      ].join('');
      md.push(head);
      if (r.status) md.push(`  - 状态：${r.status}`);
      if (r.summary) md.push(`  - ${r.summary}`);
      if (r.key_values) md.push(`  - 关键值：${r.key_values}`);
      if (r.doi_or_url) md.push(`  - 链接：${r.doi_or_url}`);
    }
    md.push('');
  }
  fs.writeFileSync(OUT_MD, md.join('\n'), 'utf8');
  console.log(`✓ ${OUT_MD}`);

  // 统计
  const stat = { type: {} as Record<string, number>, lang: {} as Record<string, number>, conf: {} as Record<string, number> };
  for (const r of allOrdered) {
    stat.type[r.type] = (stat.type[r.type] || 0) + 1;
    stat.lang[r.language] = (stat.lang[r.language] || 0) + 1;
    stat.conf[r.confidence || 'unknown'] = (stat.conf[r.confidence || 'unknown'] || 0) + 1;
  }
  console.log('—— 统计 ——');
  console.table(stat);
}

main();
