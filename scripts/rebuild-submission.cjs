// 重新打包提交包：复制最新 PDF + 重建 zip
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJ = 'E:\\Son of  the SEA\\260811\\sea-agent-web-v2';
const DST = 'E:\\Son of  the SEA\\260822';
const SUB = path.join(DST, '4-补充资料');
const ZIP = path.join(DST, '4-补充资料.zip');

console.log('=== 重新打包 LandfillMind 提交包 ===\n');

// 1. 复制最新 PDF
const copies = [
  { src: path.join(PROJ, '1-说明文档.pdf'),          dst: path.join(DST, '1-说明文档.pdf') },
  { src: path.join(PROJ, 'materials', '人机协同履历表.pdf'), dst: path.join(DST, '3-人机协同履历表.pdf') },
  { src: path.join(PROJ, '参赛技术说明文档.md'),     dst: path.join(DST, '参赛技术说明文档.md') },
  { src: path.join(PROJ, 'materials', '人机协同履历表.md'), dst: path.join(SUB, 'materials', '人机协同履历表.md') },
];
for (const { src, dst } of copies) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    const sz = fs.statSync(dst).size;
    console.log('  [✓] ' + path.basename(dst) + ' (' + (sz / 1024).toFixed(1) + ' KB)');
  }
}

// 2. 重建 zip
console.log('\n=== 重建 4-补充资料.zip ===');
try {
  if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);
  const psCmd = `Compress-Archive -Path '${SUB}\\*' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`;
  execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
  const sz = fs.statSync(ZIP).size;
  console.log('  [✓] ' + ZIP + ' (' + (sz / 1024).toFixed(1) + ' KB)');
} catch (e) {
  console.log('  [!] zip 失败: ' + e.message);
}

console.log('\n=== 完成 ===');
console.log('  1-说明文档.pdf:        ' + (fs.statSync(path.join(DST, '1-说明文档.pdf')).size / 1024).toFixed(1) + ' KB');
console.log('  3-人机协同履历表.pdf:  ' + (fs.statSync(path.join(DST, '3-人机协同履历表.pdf')).size / 1024).toFixed(1) + ' KB');
console.log('  4-补充资料.zip:        ' + (fs.statSync(ZIP).size / 1024).toFixed(1) + ' KB');