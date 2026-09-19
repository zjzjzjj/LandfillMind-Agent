// 复制文档 + 构建 zip + 生成 manifest
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_PKG = 'E:\\Son of  the SEA\\SOE提交文件包';
const DST = 'E:\\Son of  the SEA\\260822';

console.log('=== LandfillMind 提交包 · 第二步：文档 + zip ===\n');

// 1. 复制所有 PDF 和 文档
const docs = [
  '1-说明文档.pdf',
  '3-人机协同履历表.pdf',
  '5-作品标题.txt',
  '6-作品简介.md',
  '6-作品简介.pdf',
  'CHANGELOG.md',
  '参赛技术说明文档-源稿.md',
  '视频脚本.md',
  '提交清单.txt',
];
for (const f of docs) {
  const s = path.join(SRC_PKG, f);
  const d = path.join(DST, f);
  if (fs.existsSync(s)) {
    fs.copyFileSync(s, d);
    console.log('  [✓] ' + f + ' (' + (fs.statSync(s).size / 1024).toFixed(1) + ' KB)');
  }
}

// 2. 生成占位视频说明（演示视频未录制）
const videoPlaceholder = '2-介绍视频-占位说明.txt';
const videoTxt = `2-介绍视频 · 占位说明
=============================

【当前状态】演示视频待录制（提交前补上）

【为什么占位】演示视频需真人录制（带旁白 + 操作演示），AI 助手无法生成真实视频。
建议在本地按"视频脚本.md"录制（≤2 分钟脚本已就绪）。

【录制步骤】
1. 双击桌面 "LandfillMind-启动" 快捷方式 → 服务自动启动
2. 浏览器开无痕窗口 → http://localhost:5173
3. 按视频脚本.md 录制（首页 + 3D 模拟 + AI 快诊 + AI 纠偏剧场 + 多智能体 + 一键应急）
4. 剪映自动字幕 → 校对 → 烧入
5. 文件命名 "2-介绍视频.mp4" 放入本目录
6. 重新打包 4-补充资料.zip

【video 脚本（≤ 2:05）】
详见 "视频脚本.md"

【画面清单】
00:00-00:10  开场：双引擎核心一句话
00:10-00:22  首页 + 3D 模型 12s
00:22-01:02  AI 快诊 + 班前交底 40s
01:02-01:32  AI 纠偏剧场 30s（⭐ 重点）
01:32-01:50  多智能体 + 追问 18s
01:50-02:00  一键应急海报 10s
02:00-02:05  结尾金句 5s

【质量要求】
- 格式 MP4（H.264）
- 时长 ≤ 2 分钟
- 大小 ≤ 500 MB
- 建议配字幕
`;
fs.writeFileSync(path.join(DST, videoPlaceholder), videoTxt, 'utf8');
console.log('  [✓] ' + videoPlaceholder);

// 3. 构建 4-补充资料.zip
const SUB = path.join(DST, '4-补充资料');
const ZIP = path.join(DST, '4-补充资料.zip');
console.log('\n=== 构建 4-补充资料.zip ===');

try {
  // 删除旧 zip
  if (fs.existsSync(ZIP)) fs.unlinkSync(ZIP);

  // 使用 PowerShell 的 Compress-Archive（Windows 内置）
  const psCmd = `Compress-Archive -Path '${SUB}\\*' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`;
  execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
  console.log('  [✓] ' + ZIP + ' (' + (fs.statSync(ZIP).size / 1024).toFixed(1) + ' KB)');
} catch (e) {
  console.log('  [!] PowerShell 失败: ' + e.message);
  console.log('  [!] 备用：用 7z / tar');
}

// 4. 统计所有文件
console.log('\n=== 提交包清单 ===\n');
console.log('┌────────────────────────────────────────────────┬──────────┬─────────┐');
console.log('│ 文件                                            │ 大小     │ 限制    │');
console.log('├────────────────────────────────────────────────┼──────────┼─────────┤');
const files = [
  { name: '1-说明文档.pdf',                    limit: '≤30 MB' },
  { name: '2-介绍视频-占位说明.txt',             limit: '（说明）' },
  { name: '3-人机协同履历表.pdf',                limit: '≤10 MB' },
  { name: '4-补充资料.zip',                      limit: '≤200 MB' },
  { name: '5-作品标题.txt',                      limit: '（文本）' },
  { name: '6-作品简介.md / 6-作品简介.pdf',       limit: '≤500 字' },
  { name: '参赛技术说明文档.md',                 limit: '（额外）' },
  { name: '视频脚本.md',                         limit: '（额外）' },
  { name: '提交清单.txt',                        limit: '（索引）' },
];
for (const f of files) {
  const fp = path.join(DST, f.name.split(' ')[0]);
  if (fs.existsSync(fp)) {
    const sz = fs.statSync(fp).size;
    const human = sz > 1024 * 1024 ? (sz / 1024 / 1024).toFixed(2) + ' MB' : (sz / 1024).toFixed(1) + ' KB';
    console.log('│ ' + f.name.padEnd(46) + ' │ ' + human.padStart(8) + ' │ ' + f.limit.padStart(7) + ' │');
  } else {
    console.log('│ ' + f.name.padEnd(46) + ' │  (missing) │ ' + f.limit.padStart(7) + ' │');
  }
}
console.log('└────────────────────────────────────────────────┴──────────┴─────────┘');

console.log('\n✓ 打包完成！' + DST);
console.log('\n下一步：');
console.log('  1. 打开 https://aicampus.3311csci.com/user/profile.html');
console.log('  2. 复制 5-作品标题.txt 内容 → 填入"作品标题"');
console.log('  3. 复制 6-作品简介.md 正文 → 填入"作品简介"');
console.log('  4. 上传 4 个 PDF/zip 文件');
console.log('  5. 录制 2-介绍视频.mp4 → 替换占位说明 → 重新打包');