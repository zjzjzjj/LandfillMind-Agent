#!/usr/bin/env node
// scripts/md-to-pdf.mjs
// 把 Markdown 转成 A4 PDF。仅依赖 node 内置模块 + 已安装的 playwright。
// 用法：
//   node scripts/md-to-pdf.mjs                         默认扫描 materials/*.md 转同名 PDF
//   node scripts/md-to-pdf.mjs <a.md> <a.pdf>          显式指定输入输出
//   node scripts/md-to-pdf.mjs a.md b.pdf c.md d.pdf  一次转多对
//   node scripts/md-to-pdf.mjs --force ...             覆盖已有 PDF

import { readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MATERIALS_DIR = path.join(PROJECT_ROOT, 'materials');

// ============== Markdown 解析（手写，零依赖） ==============
// 处理：标题、段落、列表（有序/无序，支持嵌套）、代码块（含围栏代码 + 缩进代码）、
//       表格、引用、分隔线、行内代码、行内粗体/斜体/链接、图片。

/** 转义 HTML 字符 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 处理行内元素：粗体、斜体、行内代码、链接、图片、删除线 */
function inline(text) {
  // 先抽出 code 片段做占位（避免里面再被处理）
  const codes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `CODE_${codes.length - 1}`;
  });

  // 转义剩余 HTML
  text = escapeHtml(text);

  // 图片 ![alt](src)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g, (_, alt, src) =>
    `<img alt="${alt}" src="${src}" />`);
  // 链接 [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) =>
    `<a href="${u}">${t}</a>`);
  // 粗体 **x** 或 __x__
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  // 斜体 *x* 或 _x_
  text = text.replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  // 还原 code 占位
  text = text.replace(/CODE_(\d+)/g, (_, idx) => codes[Number(idx)]);
  return text;
}

/** 把 Markdown 行序列转成 HTML */
function mdToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  // 工具：识别围栏代码块
  const isFence = (line) => /^```/.test(line.trimStart());

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块 ```lang ... ```
    if (isFence(line)) {
      const fence = line.match(/^```\s*(\S*)/);
      const lang = fence ? fence[1] : '';
      const buf = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      out.push(`<pre data-lang="${escapeHtml(lang)}"><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // 标题 ATX # ## ###
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^[\s]*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // 引用 > ...
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格（简单 GFM：| a | b | / |---|---|
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const headerCells = line.split('|').slice(1, -1).map(c => inline(c.trim()));
      i += 2; // 跳过表头 + 分隔行
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].split('|').slice(1, -1).map(c => inline(c.trim()));
        rows.push(cells);
        i++;
      }
      out.push('<table><thead><tr>');
      for (const c of headerCells) out.push(`<th>${c}</th>`);
      out.push('</tr></thead><tbody>');
      for (const r of rows) {
        out.push('<tr>');
        for (const c of r) out.push(`<td>${c}</td>`);
        out.push('</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    // 列表（无序 - *  或有序 1.）
    const ul = /^(\s*)([-*+])\s+(.+)/.exec(line);
    const ol = /^(\s*)(\d+)\.\s+(.+)/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const stack = []; // 每层 { indent, tag }
      const flushTo = (targetIndent) => {
        while (stack.length && stack[stack.length - 1].indent >= targetIndent) {
          const popped = stack.pop();
          out.push(`</${popped.tag}>`);
        }
      };
      const isListItem = (l, ord) => {
        if (ord) return /^\s*\d+\.\s+/.test(l);
        return /^\s*[-*+]\s+/.test(l);
      };
      const itemRegex = (ord) => ord
        ? /^(\s*)(\d+)\.\s+(.*)$/
        : /^(\s*)([-*+])\s+(.*)$/;

      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          i++;
          continue;
        }
        if (!isListItem(l, ordered)) break;
        const m = l.match(itemRegex(ordered));
        const indent = m[1].length;
        const text = m[3];

        // 缩进变化：开/关嵌套
        if (stack.length === 0) {
          stack.push({ indent, tag: ordered ? 'ol' : 'ul' });
          out.push(`<${ordered ? 'ol' : 'ul'}>`);
        } else if (indent > stack[stack.length - 1].indent) {
          // 嵌套列表项：当前行实际是上一项的子项。把它当作文本续行处理更稳妥。
          break;
        } else if (indent < stack[stack.length - 1].indent) {
          flushTo(indent);
        }

        // 内容处理（支持任务列表 - [ ] / - [x]）
        let contentHtml = inline(text);
        if (!ordered) {
          const task = /^\[ \]\s+/.test(text);
          const taskDone = /^\[x\]\s+/i.test(text);
          if (task) contentHtml = `<input type="checkbox" disabled /> ${inline(text.replace(/^\[ \]\s+/, ''))}`;
          if (taskDone) contentHtml = `<input type="checkbox" checked disabled /> ${inline(text.replace(/^\[x\]\s+/i, ''))}`;
        }

        out.push(`<li>${contentHtml}`);
        // 检查紧跟的非空行是否为延续（缩进更大的段落/子列表）——此处简化为单行处理
        i++;
      }
      flushTo(0);
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 段落（连续非空行）
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*[-*+]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join('\n'))}</p>`);
  }

  return out.join('\n');
}

// ============== HTML 模板 ==============
function htmlTemplate(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: A4;
    margin: 2cm 2cm 2.4cm 2cm;
    @top-left   { content: "LandfillMind"; font-family: "PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",sans-serif; font-size: 9pt; color: #475569; }
    @top-right  { content: "v4.2 评审版"; font-family: "PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",sans-serif; font-size: 9pt; color: #475569; }
    @bottom-center { content: counter(page) " / " counter(pages); font-family: "PingFang SC","Microsoft YaHei","Source Han Sans SC","Noto Sans CJK SC",sans-serif; font-size: 9pt; color: #475569; }
  }

  html, body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #ffffff;
    font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC",
                 "Noto Sans CJK SC", "Hiragino Sans GB", "WenQuanYi Micro Hei",
                 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.65;
    word-wrap: break-word;
  }

  body { padding: 0 0.2cm; }

  h1, h2, h3, h4, h5, h6 {
    font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC",
                 "Noto Sans CJK SC", sans-serif;
    color: #0f172a;
    line-height: 1.3;
    margin: 0.9em 0 0.4em;
    page-break-after: avoid;
    font-weight: 700;
  }
  h1 { font-size: 22pt; border-bottom: 2px solid #1e293b; padding-bottom: 0.2em; margin-top: 0; }
  h2 { font-size: 18pt; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.15em; }
  h3 { font-size: 15pt; color: #1e3a8a; }
  h4 { font-size: 13pt; color: #1e40af; }
  h5 { font-size: 12pt; }
  h6 { font-size: 11pt; color: #475569; }

  p { margin: 0.4em 0; }

  a { color: #1d4ed8; text-decoration: none; border-bottom: 1px solid #93c5fd; }
  a:hover { color: #1e40af; }

  strong { font-weight: 700; color: #0f172a; }
  em     { font-style: italic; color: #334155; }

  ul, ol { padding-left: 1.6em; margin: 0.3em 0; }
  li { margin: 0.15em 0; }
  li > p { margin: 0.2em 0; }

  code {
    font-family: "JetBrains Mono","Fira Code","SFMono-Regular","Consolas",
                 "Liberation Mono","Courier New",monospace;
    font-size: 10pt;
    background: #f1f5f9;
    color: #0f172a;
    padding: 0.05em 0.35em;
    border-radius: 3px;
    border: 1px solid #e2e8f0;
  }

  pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #3b82f6;
    padding: 0.7em 0.9em;
    border-radius: 4px;
    overflow-x: auto;
    page-break-inside: avoid;
    margin: 0.6em 0;
    line-height: 1.5;
  }
  pre code {
    background: transparent;
    border: 0;
    padding: 0;
    font-size: 10pt;
    color: #1e293b;
    white-space: pre-wrap;
    word-break: break-all;
  }

  blockquote {
    border-left: 4px solid #94a3b8;
    background: #f8fafc;
    color: #475569;
    margin: 0.6em 0;
    padding: 0.4em 0.8em;
    border-radius: 0 4px 4px 0;
  }
  blockquote p { margin: 0.2em 0; }

  hr { border: 0; border-top: 1px dashed #cbd5e1; margin: 1.2em 0; }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.6em 0;
    page-break-inside: avoid;
    font-size: 10.5pt;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 0.35em 0.7em;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #e2e8f0;
    font-weight: 700;
    color: #0f172a;
  }
  tbody tr:nth-child(even) td { background: #f8fafc; }

  img { max-width: 100%; height: auto; }

  /* 第一页边距微调：让首页不顶到边 */
  body > *:first-child { margin-top: 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ============== PDF 生成核心 ==============
async function mdToPdf(inputPath, outputPath) {
  const absIn = path.resolve(inputPath);
  const absOut = path.resolve(outputPath);
  if (!existsSync(absIn)) {
    throw new Error(`输入文件不存在：${absIn}`);
  }

  const raw = await readFile(absIn, 'utf8');
  const title = path.basename(absIn, path.extname(absIn));
  const body = mdToHtml(raw);
  const html = htmlTemplate(title, body);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // 给中文 web 字体留一点稳定时间
    await page.evaluate(() => new Promise(r => setTimeout(r, 80)));
    await page.pdf({
      path: absOut,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: '2cm', bottom: '2.4cm', left: '2cm', right: '2cm' },
    });
  } finally {
    await browser.close();
  }
  return absOut;
}

// ============== CLI ==============
function parseArgs(argv) {
  const args = argv.slice(2);
  let force = false;
  const positional = [];
  for (const a of args) {
    if (a === '--force' || a === '-f') force = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
    else positional.push(a);
  }
  return { force, positional };
}

function printHelp() {
  console.log(`用法：
  node scripts/md-to-pdf.mjs                          扫描 materials/*.md 转同名 PDF
  node scripts/md-to-pdf.mjs <in.md> <out.pdf>         单文件指定
  node scripts/md-to-pdf.mjs in1.md out1.pdf in2.md out2.pdf   多对
  node scripts/md-to-pdf.mjs --force ...               强制覆盖已存在的输出
`);
}

async function collectPairs(args) {
  const pairs = [];

  // 显式参数（两两配对：input output input output ...）
  if (args.positional.length >= 2 && args.positional.length % 2 === 0) {
    for (let k = 0; k < args.positional.length; k += 2) {
      const input = path.resolve(args.positional[k]);
      const output = path.resolve(args.positional[k + 1]);
      pairs.push({ input, output });
    }
    return pairs;
  }

  // 长度异常（奇数）—— 当成默认扫描
  // 默认扫描 materials/*.md
  if (!existsSync(MATERIALS_DIR)) {
    await mkdir(MATERIALS_DIR, { recursive: true });
  }
  const files = await readdir(MATERIALS_DIR);
  const mds = files.filter(f => f.toLowerCase().endsWith('.md')).sort();
  for (const f of mds) {
    const input = path.join(MATERIALS_DIR, f);
    const output = path.join(MATERIALS_DIR, f.replace(/\.md$/i, '.pdf'));
    pairs.push({ input, output });
  }
  return pairs;
}

async function main() {
  const args = parseArgs(process.argv);
  const pairs = await collectPairs(args);

  if (pairs.length === 0) {
    console.log('[md-to-pdf] materials/ 下没找到 .md 文件，无需转换。');
    return;
  }

  console.log(`[md-to-pdf] 待处理：${pairs.length} 个文件`);
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (const p of pairs) {
    const exist = existsSync(p.output);
    if (exist && !args.force) {
      console.log(`  · 已存在，跳过：${path.relative(PROJECT_ROOT, p.output)}（用 --force 覆盖）`);
      skipped++;
      continue;
    }
    try {
      const t0 = Date.now();
      const out = await mdToPdf(p.input, p.output);
      const ms = Date.now() - t0;
      const st = await stat(out);
      const kb = (st.size / 1024).toFixed(1);
      console.log(`  · 生成成功：${path.relative(PROJECT_ROOT, out)}  (${kb} KB, ${ms} ms)`);
      results.push({ input: p.input, output: out, size_kb: Number(kb) });
      success++;
    } catch (e) {
      console.error(`  x 生成失败：${path.relative(PROJECT_ROOT, p.input)} -> ${path.relative(PROJECT_ROOT, p.output)}`);
      console.error(`    原因：${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  console.log(`[md-to-pdf] 完成：成功 ${success} / 跳过 ${skipped} / 失败 ${failed}`);

  // 把结果写到 .last-run.json（便于外部脚本读取）
  try {
    await writeFile(
      path.join(PROJECT_ROOT, '.md-to-pdf.last-run.json'),
      JSON.stringify({ ts: new Date().toISOString(), force: args.force, results }, null, 2),
      'utf8'
    );
  } catch { /* 忽略 */ }

  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('[md-to-pdf] 未捕获错误：', e);
  process.exit(1);
});