// 清理残留 + 重新打包
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DST = 'E:\\Son of  the SEA\\260822';

console.log('=== 清理 260822 目录 ===\n');
if (fs.existsSync(DST)) {
  // 先 rmSync 整个 DST 子目录
  for (const entry of fs.readdirSync(DST, { withFileTypes: true })) {
    try {
      fs.rmSync(path.join(DST, entry.name), { recursive: true, force: true });
      console.log('  [X] rmdir ' + entry.name);
    } catch (e) {
      console.log('  [!] skip ' + entry.name + ' (' + e.message + ')');
    }
  }
}

console.log('\n=== 重新创建 ===\n');
const SRC = 'E:\\Son of  the SEA\\260811\\sea-agent-web-v2';
const SUB = path.join(DST, '4-补充资料');

const dirs = [DST, SUB, path.join(SUB, 'src'), path.join(SUB, 'server'),
              path.join(SUB, 'scripts'), path.join(SUB, 'materials')];
for (const d of dirs) {
  fs.mkdirSync(d, { recursive: true });
  console.log('  [+] mkdir ' + path.basename(d));
}

const files = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
  'vite.config.ts', 'render.yaml', 'index.html',
  'README.md', 'DEPLOY.md', 'CHANGELOG.md',
  '参赛技术说明文档.md', '视频脚本.md',
  'start.bat', 'stop.bat', 'install-shortcut.ps1',
];
for (const f of files) {
  const s = path.join(SRC, f);
  const d = path.join(SUB, f);
  if (fs.existsSync(s)) {
    fs.copyFileSync(s, d);
    console.log('  [✓] ' + f);
  }
}

function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, e.name);
    const dp = path.join(d, e.name);
    if (e.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}
for (const dir of ['src', 'server', 'scripts', 'materials', 'knowledge-base']) {
  copyDir(path.join(SRC, dir), path.join(SUB, dir));
  console.log('  [✓] dir: ' + dir);
}

let total = 0; let count = 0;
function countSize(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    if (e.isDirectory()) countSize(fp);
    else { total += fs.statSync(fp).size; count++; }
  }
}
countSize(SUB);
console.log('\n=== 完成 ===');
console.log('  4-补充资料 大小: ' + (total / 1024).toFixed(1) + ' KB');
console.log('  文件数: ' + count);