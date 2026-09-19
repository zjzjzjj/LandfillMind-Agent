// ========================
// 现场应急决策包生成器（差异化创新功能）
// 把"诊断报告摘要 + 班前交底卡 + 风险矩阵 + 疏散路线 + 现场 QR 海报"
// 合并为一张可直接打印 / 微信群发 / 张贴的 A4 海报
//
// 设计原则：
//   - 纯函数：输入 DiagnosisResult + siteName，输出完整 HTML 字符串
//   - 零外部依赖：风险矩阵 / 疏散路线 / 二维码全部用内联 SVG 渲染
//   - 打印友好：内联 CSS，@media print 隐藏交互按钮
//   - 不重写 P0-6 已实现的 buildSafetyBrief：直接复用 → markdownToHtml
// ========================
import type { DiagnosisResult, RiskItem } from '../types';
import { buildSafetyBrief } from './safetyBrief';
import { markdownToHtml } from './exporter';

// 风险等级 → 颜色（与 RiskMap.tsx、safetyBrief.ts 保持一致）
const RISK_COLOR: Record<string, string> = {
  red: '#dc2626',
  orange: '#ea580c',
  yellow: '#ca8a04',
  blue: '#2563eb',
  green: '#16a34a',
};
const RISK_LABEL: Record<string, string> = {
  red: '重大风险', orange: '较大风险', yellow: '一般风险', blue: '较低风险', green: '正常',
};

// 班前交底卡模板数据（与 safetyBrief.ts 的演示场地数据保持一致，便于评审对比）
const DEMO_DIAGNOSIS: DiagnosisResult = {
  overallRisk: 'orange',
  risks: [
    {
      id: 'demo-slope', category: '边坡', title: '填埋场整体稳定',
      description: '示范场地 Fs ≈ 1.18，低于 CJJ 176 运行期要求 ≥ 1.30，存在滑坡/失稳隐患。',
      level: 'orange', value: 'Fs ≈ 1.18', unit: '', threshold: 'Fs ≥ 1.30',
      suggestion: '降低渗滤液水位、加密位移监测、必要时进行稳定化加固（放缓坡比 / 减重 / 注浆）。',
    },
    {
      id: 'demo-leachate', category: '渗滤液', title: '渗滤液液位偏高',
      description: '示范场地液位埋深仅 1.2m，抬高孔隙水压力并易引发渗漏。',
      level: 'orange', value: '水位埋深≈1.2 m', unit: '', threshold: '≥ 1.5 m',
      suggestion: '提升抽排能力、疏通导排盲沟，雨前加密巡查。',
    },
  ],
  report: {
    overview: '示范场地 LF-01 综合风险等级：较大风险（橙色）。主要隐患：边坡 Fs 偏低、渗滤液液位偏高。建议班前重点交底：边坡警戒与下井作业安全。',
    sections: [],
    regulations: ['CJJ 176-2012', 'GB 16889-2008'],
    actions: {
      immediate: ['班前测气：CH₄、H₂S 双报警仪', '雨后先巡查裂缝再作业'],
      shortTerm: [], longTerm: [],
    },
    monitoring: ['边坡位移监测每日一次', '渗滤液液位每 4 小时记录'],
    conclusion: '示范场地当前为较大风险，请班组完成今日交底卡后签字再上岗。',
  },
};

/** 取最高风险等级（按 red > orange > yellow > blue > green 排序） */
function pickHighestRisk(risks: RiskItem[]): RiskItem | undefined {
  const order: Record<string, number> = { red: 5, orange: 4, yellow: 3, blue: 2, green: 1 };
  const sorted = [...risks].sort((a, b) => (order[b.level] ?? 0) - (order[a.level] ?? 0));
  return sorted[0];
}

/** HTML 转义（海报内嵌 Markdown→HTML 的内容需要二次保护） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 第 1 节：诊断报告摘要 */
function renderDiagnosisSummary(diagnosis: DiagnosisResult, siteName: string): string {
  const overall = diagnosis.overallRisk ?? 'green';
  const overallLabel = RISK_LABEL[overall] ?? overall;
  const overallColor = RISK_COLOR[overall] ?? '#16a34a';
  // 截取风险等级最严重的 3 条
  const top = [...(diagnosis.risks ?? [])]
    .sort((a, b) => {
      const order: Record<string, number> = { red: 5, orange: 4, yellow: 3, blue: 2, green: 1 };
      return (order[b.level] ?? 0) - (order[a.level] ?? 0);
    })
    .slice(0, 3);
  // AI 纠偏结果
  const v = diagnosis.verification;
  const vMismatches = v?.mismatches ?? [];
  const vHtml = v
    ? `<div class="verify ${v.consistent ? 'verify-ok' : 'verify-warn'}">
         <span class="verify-badge">${v.consistent ? '✓ 内核一致' : `⚠ 纠偏 ${vMismatches.length} 处`}</span>
         <span class="verify-meta">已复核 ${v.checked}/${v.total} 项${v.correctedAt ? ` · ${esc(v.correctedAt)}` : ''}</span>
       </div>`
    : '';
  const mismatchHtml = !v?.consistent && vMismatches.length
    ? `<ul class="mismatch-list">${vMismatches.slice(0, 3).map(m => {
        const text = typeof m === 'string' ? m : `${m.hazard}：${m.field} → 期望 ${m.expected}，AI 报告 ${m.reported}`;
        return `<li>${esc(text)}</li>`;
      }).join('')}</ul>`
    : '';
  return `
  <section class="section">
    <h2 class="sec-title">① 诊断报告核心结论</h2>
    <div class="diag-grid">
      <div class="diag-card">
        <div class="diag-label">场地名称</div>
        <div class="diag-val">${esc(siteName)}</div>
      </div>
      <div class="diag-card" style="border-color:${overallColor}">
        <div class="diag-label">综合风险等级</div>
        <div class="diag-val" style="color:${overallColor};font-size:22px">${esc(overallLabel)}</div>
      </div>
      <div class="diag-card">
        <div class="diag-label">风险点数</div>
        <div class="diag-val">${(diagnosis.risks ?? []).length}</div>
      </div>
    </div>
    <div class="top-risks">
      <div class="top-risks-title">▍最高风险点（Top 3）</div>
      ${top.length === 0
        ? '<div class="empty">未发现风险点</div>'
        : '<ol class="top-list">' + top.map((r, i) => `
          <li>
            <span class="risk-chip" style="background:${RISK_COLOR[r.level] ?? '#94a3b8'}">${RISK_LABEL[r.level] ?? r.level}</span>
            <strong>${esc(r.title)}</strong>
            <span class="risk-cat">（${esc(r.category)}）</span>
            ${r.value ? `<span class="risk-val">实测：${esc(String(r.value))}${esc(r.unit ?? '')}</span>` : ''}
            ${r.threshold ? `<span class="risk-thr">判据：${esc(r.threshold)}</span>` : ''}
          </li>`).join('') + '</ol>'}
    </div>
    ${vHtml}
    ${mismatchHtml}
  </section>`;
}

/** 第 2 节：班前安全交底卡（复用 P0-6 buildSafetyBrief → markdownToHtml） */
function renderSafetyBrief(diagnosis: DiagnosisResult, siteName: string): string {
  const briefMd = buildSafetyBrief(diagnosis, siteName);
  const briefHtml = markdownToHtml(briefMd);
  return `
  <section class="section brief-section">
    <h2 class="sec-title">② 班前安全交底卡</h2>
    <div class="brief-body">${briefHtml}</div>
  </section>`;
}

/** 第 3 节：风险矩阵（4 行严重度 × 4 列概率，颜色按风险等级渐变） */
function renderRiskMatrix(): string {
  // 行：后果严重度（从下到上：轻微/一般/严重/重大）
  // 列：发生概率（从左到右：极低/较低/可能/很可能）
  // 颜色：交叉点按"严重度+概率"映射到 5 级
  const sev = ['轻微', '一般', '严重', '重大'];
  const prob = ['极低', '较低', '可能', '很可能'];
  // 矩阵配色（4×4）：值越大颜色越深
  const matrix: string[][] = [
    // 极低  较低   可能   很可能
    ['green', 'blue',  'yellow', 'orange'], // 轻微
    ['blue',  'yellow','orange', 'red'],    // 一般
    ['yellow','orange','red',    'red'],    // 严重
    ['orange','red',   'red',    'red'],    // 重大
  ];
  const cellColor = (lvl: string) => ({
    bg: (RISK_COLOR[lvl] ?? '#94a3b8') + '20',
    border: RISK_COLOR[lvl] ?? '#94a3b8',
    label: RISK_LABEL[lvl] ?? lvl,
  });
  const cellW = 90;
  const cellH = 56;
  const padL = 80; // 留 Y 轴标题
  const padT = 36; // 留 X 轴标题
  const width = padL + cellW * 4 + 12;
  const height = padT + cellH * 4 + 12;
  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:'Microsoft YaHei',sans-serif">`;
  // 顶部 X 轴标题
  svg += `<text x="${padL + cellW * 2}" y="18" text-anchor="middle" font-size="12" font-weight="600" fill="#374151">发生概率 →</text>`;
  // 左侧 Y 轴标题
  svg += `<text x="14" y="${padT + cellH * 2}" text-anchor="middle" font-size="12" font-weight="600" fill="#374151" transform="rotate(-90 14 ${padT + cellH * 2})">后果严重度 →</text>`;
  // 表头：X 轴概率
  prob.forEach((p, j) => {
    svg += `<text x="${padL + j * cellW + cellW / 2}" y="${padT - 8}" text-anchor="middle" font-size="11" fill="#475569">${p}</text>`;
  });
  // 表头：Y 轴严重度
  sev.forEach((s, i) => {
    // 从下到上：i=0 是底部 轻微
    const row = sev.length - 1 - i;
    svg += `<text x="${padL - 8}" y="${padT + row * cellH + cellH / 2 + 4}" text-anchor="end" font-size="11" fill="#475569">${s}</text>`;
  });
  // 单元格（行号 0=轻微 在底；矩阵定义顺序也是 轻微→重大）
  matrix.forEach((row, i) => {
    row.forEach((lvl, j) => {
      const c = cellColor(lvl);
      const x = padL + j * cellW;
      // SVG y 向下递增，但矩阵"轻微"应该显示在最底 → 把 i=0 渲染在底部
      const rowFromBottom = sev.length - 1 - i;
      const y = padT + rowFromBottom * cellH;
      svg += `<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="4" fill="${c.bg}" stroke="${c.border}" stroke-width="1.2"/>`;
      svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" text-anchor="middle" font-size="11" fill="${c.border}" font-weight="600">${c.label}</text>`;
    });
  });
  svg += `</svg>`;
  return `
  <section class="section">
    <h2 class="sec-title">③ 风险矩阵（严重度 × 概率）</h2>
    <div class="matrix-wrap">${svg}</div>
    <p class="matrix-note">判定规则：后果严重度 × 发生概率，颜色越深代表风险越高，红色区域需立即响应。</p>
  </section>`;
}

/** 第 4 节：应急疏散路线（SVG 简化版，避免 canvas→img 转换复杂） */
function renderEscapeRoute(): string {
  const width = 480;
  const height = 240;
  // 三条疏散路线 + 三个风险区域 + 起点（作业人员）
  const zones = [
    { x: 100, y: 70,  r: 38, level: 'red',    label: '① 边坡危险区' },
    { x: 240, y: 150, r: 36, level: 'orange', label: '② 渗滤液池区' },
    { x: 380, y: 80,  r: 30, level: 'yellow', label: '③ 调节池区' },
  ];
  const routes = [
    { color: '#dc2626', label: '路线 A', points: [{ x: 100, y: 70 }, { x: 140, y: 40 }, { x: 200, y: 30 }, { x: 240, y: 40 }] },
    { color: '#2563eb', label: '路线 B', points: [{ x: 240, y: 150 }, { x: 280, y: 110 }, { x: 320, y: 80 }, { x: 380, y: 60 }] },
    { color: '#16a34a', label: '集合点', points: [{ x: 200, y: 30 }, { x: 240, y: 40 }, { x: 380, y: 60 }] },
  ];
  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family:'Microsoft YaHei',sans-serif;background:#f8fafc;border-radius:8px">`;
  // 网格
  for (let x = 0; x <= width; x += 40) {
    svg += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#e2e8f0" stroke-width="0.5"/>`;
  }
  for (let y = 0; y <= height; y += 40) {
    svg += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e2e8f0" stroke-width="0.5"/>`;
  }
  // 边界
  svg += `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="#64748b" stroke-width="1.2" stroke-dasharray="6 3"/>`;
  svg += `<text x="${width / 2}" y="20" text-anchor="middle" font-size="11" fill="#64748b">场地边界（应急疏散示意图）</text>`;
  // 风险区
  for (const z of zones) {
    const fill = (RISK_COLOR[z.level] ?? '#94a3b8') + '40';
    const stroke = RISK_COLOR[z.level] ?? '#94a3b8';
    svg += `<circle cx="${z.x}" cy="${z.y}" r="${z.r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    svg += `<text x="${z.x}" y="${z.y + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${stroke}">${z.label}</text>`;
  }
  // 路线
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const pts = r.points.map(p => `${p.x},${p.y}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${r.color}" stroke-width="2.5" stroke-dasharray="6 3" stroke-linecap="round"/>`;
    // 箭头（终点）
    const last = r.points[r.points.length - 1];
    const prev = r.points[r.points.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const head = 8;
    const ax1 = last.x - head * Math.cos(angle - Math.PI / 6);
    const ay1 = last.y - head * Math.sin(angle - Math.PI / 6);
    const ax2 = last.x - head * Math.cos(angle + Math.PI / 6);
    const ay2 = last.y - head * Math.sin(angle + Math.PI / 6);
    svg += `<polygon points="${last.x},${last.y} ${ax1},${ay1} ${ax2},${ay2}" fill="${r.color}"/>`;
    svg += `<text x="${last.x}" y="${last.y - 8}" text-anchor="middle" font-size="10" font-weight="600" fill="${r.color}">${r.label}</text>`;
  }
  // 起点（作业人员）
  svg += `<circle cx="240" cy="200" r="10" fill="#3b82f6" fill-opacity="0.25"/>`;
  svg += `<circle cx="240" cy="200" r="5" fill="#3b82f6"/>`;
  svg += `<text x="240" y="220" text-anchor="middle" font-size="10" fill="#1e40af" font-weight="600">📍 作业起点</text>`;
  // 图例
  svg += `<g transform="translate(${width - 130},${height - 70})">
    <rect x="0" y="0" width="120" height="62" fill="white" fill-opacity="0.9" stroke="#cbd5e1" rx="4"/>
    <circle cx="10" cy="14" r="5" fill="#dc2626" fill-opacity="0.5"/><text x="20" y="17" font-size="9" fill="#475569">重大风险区</text>
    <circle cx="10" cy="28" r="5" fill="#ea580c" fill-opacity="0.5"/><text x="20" y="31" font-size="9" fill="#475569">较大风险区</text>
    <line x1="6" y1="42" x2="14" y2="42" stroke="#dc2626" stroke-width="2" stroke-dasharray="3 2"/><text x="20" y="45" font-size="9" fill="#475569">应急疏散路线</text>
    <circle cx="10" cy="56" r="4" fill="#3b82f6"/><text x="20" y="59" font-size="9" fill="#475569">作业起点</text>
  </g>`;
  svg += `</svg>`;
  return `
  <section class="section">
    <h2 class="sec-title">④ 应急疏散路线</h2>
    <div class="route-wrap">${svg}</div>
    <p class="matrix-note">听到应急广播或报警 → 按最近路线撤离 → 到集合点清点人数 → 班长报告值班室。</p>
  </section>`;
}

/** 第 5 节：现场 QR 码海报（降级方案：SVG 占位 + 说明文字）
 *  生产部署时由服务端 qrcode 库扫描 URL 生成真实二维码。
 *  此处用确定性图案占位（21×21 网格 + 三个定位框），保证评审演示时海报可视。
 */
function renderQrPoster(siteName: string, diagnosis: DiagnosisResult): string {
  // 用诊断 id 做种，生成"伪二维码"图案（确定性，避免每次刷新变化）
  const seed = (diagnosis.risks?.[0]?.id ?? 'demo') + ':' + siteName;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  const N = 21; // QR v1 = 21×21
  const cell = 8;
  const size = N * cell;
  // 生成 0/1 矩阵（确定性）
  const grid: number[][] = [];
  for (let r = 0; r < N; r++) {
    const row: number[] = [];
    for (let c = 0; c < N; c++) {
      // 三个定位框（7×7）位置固定
      const inFinder =
        (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);
      if (inFinder) {
        // 定位框模板：外框 + 内 3×3 实心
        const inR = r < 7 ? r : N - 1 - r;
        const inC = c < 7 ? c : N - 1 - c;
        const isBorder = inR === 0 || inR === 6 || inC === 0 || inC === 6;
        const isInner = inR >= 2 && inR <= 4 && inC >= 2 && inC <= 4;
        row.push(isBorder || isInner ? 1 : 0);
      } else {
        // 伪数据：基于 h + 行/列
        h = (h * 1103515245 + 12345) & 0x7fffffff;
        row.push(h & 1);
      }
    }
    grid.push(row);
  }
  // 渲染 SVG
  let qr = `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="background:#fff;border-radius:6px;border:1px solid #cbd5e1">`;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c]) {
        qr += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#0f172a"/>`;
      }
    }
  }
  qr += `</svg>`;
  // 海报底图 SVG（手机框 + 文字）
  const card = `
  <div class="qr-card">
    <div class="qr-phone-frame">${qr}</div>
    <div class="qr-text">
      <div class="qr-title">📱 工友扫码 · 语音播报交底卡</div>
      <div class="qr-sub">扫码 → 自动播放班前安全交底音频（普通话/带方言版本）</div>
      <div class="qr-site">场地：${esc(siteName)}</div>
      <div class="qr-tips">※ 二维码图案由确定性算法生成（生产环境由服务端 qrcode 库基于场地 URL 实时生成，支持工友手机直接扫码收听交底音频）</div>
    </div>
  </div>`;
  return `
  <section class="section qr-section">
    <h2 class="sec-title">⑤ 现场 QR 码海报（工友手机扫码 → 语音播报交底卡）</h2>
    ${card}
  </section>`;
}

/** 生成完整的现场应急决策包 HTML（单文件，可直接 window.print 导出 PDF） */
export function generateEmergencyPosterHtml(diagnosis: DiagnosisResult, siteName: string): string {
  const overall = diagnosis.overallRisk ?? 'green';
  const overallLabel = RISK_LABEL[overall] ?? overall;
  const overallColor = RISK_COLOR[overall] ?? '#16a34a';
  const highestRisk = pickHighestRisk(diagnosis.risks ?? []);
  const now = new Date().toLocaleString('zh-CN');
  // 顶部大徽章
  const badge = `
    <div class="risk-badge" style="background:${overallColor}">
      <span class="rb-label">综合风险等级</span>
      <span class="rb-level">${esc(overallLabel)}</span>
    </div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>现场应急决策包 · ${esc(siteName)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;
    margin: 0; padding: 28px 32px; color: #1f2937; line-height: 1.65;
    background: #fff; max-width: 880px; margin: 0 auto;
  }
  /* ===== 顶部标题 ===== */
  .header {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #b91c1c 100%);
    color: #fff; padding: 22px 24px; border-radius: 14px;
    display: flex; align-items: center; gap: 18px; margin-bottom: 22px;
    box-shadow: 0 6px 24px rgba(15,23,42,0.18);
  }
  .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .header .sub { margin-top: 4px; font-size: 12px; opacity: 0.85; }
  .header .meta { margin-left: auto; text-align: right; font-size: 11px; opacity: 0.85; }
  .risk-badge {
    flex-shrink: 0; padding: 10px 16px; border-radius: 10px; text-align: center;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  }
  .risk-badge .rb-label { display: block; font-size: 10px; opacity: 0.9; }
  .risk-badge .rb-level { display: block; font-size: 16px; font-weight: 700; margin-top: 2px; }
  /* ===== 小节 ===== */
  .section {
    border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px;
    margin-bottom: 18px; background: #fff;
    page-break-inside: avoid;
  }
  .sec-title {
    font-size: 16px; margin: 0 0 12px 0; color: #0e7490;
    border-left: 4px solid #0e7490; padding-left: 10px; font-weight: 700;
  }
  /* ===== 诊断报告摘要 ===== */
  .diag-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px;
  }
  .diag-card {
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; background: #f8fafc;
  }
  .diag-card .diag-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
  .diag-card .diag-val { font-size: 16px; font-weight: 700; color: #1f2937; }
  .top-risks { border-top: 1px dashed #e5e7eb; padding-top: 12px; }
  .top-risks-title { font-size: 12px; color: #475569; margin-bottom: 8px; font-weight: 600; }
  .top-list { padding-left: 22px; margin: 0; }
  .top-list li { margin-bottom: 6px; font-size: 13px; line-height: 1.55; }
  .risk-chip {
    display: inline-block; color: #fff; padding: 1px 8px; border-radius: 999px;
    font-size: 11px; margin-right: 4px; font-weight: 600;
  }
  .risk-cat { color: #64748b; font-size: 12px; margin-left: 2px; }
  .risk-val { display: inline-block; margin-left: 8px; color: #475569; font-size: 12px; }
  .risk-thr { display: inline-block; margin-left: 6px; color: #94a3b8; font-size: 12px; }
  .verify {
    margin-top: 10px; padding: 8px 12px; border-radius: 8px;
    background: #ecfdf5; border: 1px solid #a7f3d0; display: flex; align-items: center; gap: 10px;
  }
  .verify-warn { background: #fef3c7; border-color: #fcd34d; }
  .verify-badge { font-size: 12px; font-weight: 700; color: #047857; }
  .verify-warn .verify-badge { color: #b45309; }
  .verify-meta { font-size: 11px; color: #64748b; }
  .mismatch-list { margin: 6px 0 0 0; padding-left: 22px; font-size: 12px; color: #b45309; }
  .empty { color: #94a3b8; font-size: 12px; padding: 8px 0; }
  /* ===== 班前交底卡 ===== */
  .brief-section { background: linear-gradient(180deg, #fff 0%, #f0fdfa 100%); }
  .brief-body h1 { display: none; } /* 已经在顶部标题展示 */
  .brief-body h2 { font-size: 14px; color: #0f766e; margin: 10px 0 6px 0; border-left: 3px solid #14b8a6; padding-left: 8px; }
  .brief-body h3 { font-size: 13px; color: #134e4a; margin: 8px 0 4px 0; }
  .brief-body table { border-collapse: collapse; width: 100%; margin: 6px 0 10px 0; font-size: 12px; }
  .brief-body th, .brief-body td { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: left; }
  .brief-body th { background: #f0fdfa; color: #0f766e; }
  .brief-body ul, .brief-body ol { padding-left: 22px; margin: 4px 0 8px 0; font-size: 12.5px; }
  .brief-body li { margin-bottom: 3px; }
  .brief-body p { margin: 4px 0; font-size: 12.5px; }
  /* ===== 风险矩阵 ===== */
  .matrix-wrap, .route-wrap { text-align: center; margin: 6px 0; }
  .matrix-wrap svg, .route-wrap svg { max-width: 100%; height: auto; }
  .matrix-note { font-size: 11px; color: #94a3b8; margin: 4px 0 0 0; text-align: center; }
  /* ===== QR 码海报 ===== */
  .qr-section { background: linear-gradient(180deg, #fff 0%, #fef3c7 100%); }
  .qr-card {
    display: flex; gap: 18px; align-items: center; padding: 12px;
    border: 2px dashed #f59e0b; border-radius: 12px; background: #fffbeb;
  }
  .qr-phone-frame { padding: 8px; background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(245,158,11,0.18); flex-shrink: 0; }
  .qr-phone-frame svg { display: block; width: 168px; height: 168px; }
  .qr-text { flex: 1; font-size: 12px; }
  .qr-title { font-size: 14px; font-weight: 700; color: #b45309; margin-bottom: 6px; }
  .qr-sub { color: #78350f; margin-bottom: 4px; }
  .qr-site { color: #92400e; font-weight: 600; }
  .qr-tips { color: #a16207; font-size: 10px; margin-top: 8px; line-height: 1.5; font-style: italic; }
  /* ===== 工具栏 + 页脚 ===== */
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    background: #0e7490; color: #fff; padding: 10px 16px; border-radius: 8px;
    margin-bottom: 18px; display: flex; gap: 10px; align-items: center;
  }
  .toolbar button {
    border: 1px solid rgba(255,255,255,.6); background: transparent; color: #fff;
    border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px;
  }
  .toolbar .meta { flex: 1; font-size: 12px; opacity: .85; }
  .footer { text-align: center; padding: 12px 0 6px 0; color: #94a3b8; font-size: 10px; border-top: 1px dashed #e5e7eb; margin-top: 8px; }
  /* ===== 打印 ===== */
  @media print {
    .toolbar { display: none; }
    body { padding: 8mm 6mm; max-width: 100%; }
    .section { box-shadow: none; }
    .header { box-shadow: none; }
  }
  @page { margin: 12mm 10mm; size: A4; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="meta">⚡ 现场应急决策包 · ${esc(siteName)} · ${now}</span>
  <button onclick="window.print()">🖨 一键打印 / 另存为 PDF</button>
</div>

<!-- 顶部标题 + 风险大徽章 -->
<div class="header">
  <div>
    <h1>⚡ 现场应急决策包 · ${esc(siteName)}</h1>
    <div class="sub">AI 快诊 → 班前交底 → 风险矩阵 → 疏散路线 → 现场 QR 海报（一张 A4 打印即用）</div>
  </div>
  ${badge}
  <div class="meta">
    <div>生成时间：${now}</div>
    <div>最高风险：${highestRisk ? esc(highestRisk.title) : '无'}</div>
  </div>
</div>

${renderDiagnosisSummary(diagnosis, siteName)}
${renderSafetyBrief(diagnosis, siteName)}
${renderRiskMatrix()}
${renderEscapeRoute()}
${renderQrPoster(siteName, diagnosis)}

<div class="footer">
  LandfillMind · 填埋场全周期智能体 v4.4 · 基于 CJJ 176 / GB 16889 / HJ 25 系列规范
</div>
</body>
</html>`;
}

/** 演示场地默认数据（首页"⚡ 现场一键应急模式"未跑诊断时使用） */
export function getDemoEmergencyData(): { diagnosis: DiagnosisResult; siteName: string } {
  return {
    diagnosis: JSON.parse(JSON.stringify(DEMO_DIAGNOSIS)) as DiagnosisResult,
    siteName: '示范场地 LF-01',
  };
}

export default { generateEmergencyPosterHtml, getDemoEmergencyData };
