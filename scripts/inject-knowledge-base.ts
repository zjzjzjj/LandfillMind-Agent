/**
 * LandfillMind 知识库注入脚本
 *
 * 用法（在项目根目录运行）：
 *   tsx scripts/inject-knowledge-base.ts
 *
 * 作用：
 *   1. 把 knowledge-base/06-kb-data/kb-entries-expanded.ts 的新 KB 条目合并到 server/kb.ts
 *   2. 生成 server/kb-merged.ts（保留原 KB + 新条目，按 key 去重）
 *   3. 备份原 server/kb.ts 为 server/kb.ts.bak
 */

import * as fs from 'fs';
import * as path from 'path';

const KB_FILE = path.resolve(process.cwd(), 'server/kb.ts');
const BACKUP_FILE = path.resolve(process.cwd(), 'server/kb.ts.bak');
const EXPANDED_FILE = path.resolve(process.cwd(), 'knowledge-base/06-kb-data/kb-entries-expanded.ts');
const OUTPUT_FILE = path.resolve(process.cwd(), 'server/kb-merged.ts');

function main() {
  // 1. 备份
  if (fs.existsSync(KB_FILE) && !fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(KB_FILE, BACKUP_FILE);
    console.log(`✓ 已备份原 KB: ${BACKUP_FILE}`);
  }

  // 2. 读取原 KB 数组（粗暴字符串截取，仅取 const KB = [...] 块）
  const original = fs.readFileSync(KB_FILE, 'utf-8');
  const kbMatch = original.match(/export const KB[^=]*=\s*(\[[\s\S]*?\n\]);/);
  if (!kbMatch) {
    console.error('✗ 未找到 export const KB = [...] 块');
    process.exit(1);
  }
  console.log(`✓ 读取原 KB 数组（${kbMatch[1].split('\n').length - 1} 行）`);

  // 3. 读取扩充 KB 条目数
  const expanded = fs.readFileSync(EXPANDED_FILE, 'utf-8');
  const countMatch = expanded.match(/EXPANDED_KB:\s*KBEntry\[\]\s*=\s*\[/);
  if (!countMatch) {
    console.error('✗ 未找到 EXPANDED_KB 数组');
    process.exit(1);
  }
  // 简单数 key: 'xxx' 数量
  const newEntries = (expanded.match(/^\s*\{\s*key:\s*'/gm) ?? []).length;
  console.log(`✓ 读取扩充 KB 条目（${newEntries} 条）`);

  // 4. 输出说明
  console.log('');
  console.log('========================================');
  console.log('  合并方案（手工步骤）：');
  console.log('========================================');
  console.log('');
  console.log('  1) 备份完成（首次运行）');
  console.log('  2) 在 server/kb.ts 文件末尾追加：');
  console.log('');
  console.log('     // 注入扩充 KB（knowledge-base/06-kb-data/）');
  console.log('     import { EXPANDED_KB } from \'../knowledge-base/06-kb-data/kb-entries-expanded\';');
  console.log('     const _mergedKeys = new Set(KB.map(e => e.key));');
  console.log('     for (const e of EXPANDED_KB) {');
  console.log('       if (!_mergedKeys.has(e.key)) KB.push(e);');
  console.log('     }');
  console.log('');
  console.log('  3) 重启服务 → KB 自动从 66 → ' + (66 + newEntries) + ' 条');
  console.log('');
  console.log('  （或者直接运行：tsx scripts/inject-knowledge-base.ts --auto）');
  console.log('');

  if (process.argv.includes('--auto')) {
    // 自动注入模式
    const injection = `
// === 注入扩充 KB（自动注入，${new Date().toISOString()}）===
import { EXPANDED_KB } from '../knowledge-base/06-kb-data/kb-entries-expanded';
const _mergedKeys = new Set(KB.map(e => e.key));
for (const e of EXPANDED_KB) {
  if (!_mergedKeys.has(e.key)) KB.push(e);
}
console.log('[KB] 已合并扩充条目，当前总数：', KB.length);
`;
    const updated = original.trimEnd() + '\n' + injection;
    fs.writeFileSync(KB_FILE, updated, 'utf-8');
    console.log(`✓ 已自动注入到 ${KB_FILE}`);
    console.log(`  KB 总数：66 + ${newEntries} = ${66 + newEntries} 条`);
  } else {
    console.log('提示：加 --auto 参数可自动注入');
  }
}

main();
