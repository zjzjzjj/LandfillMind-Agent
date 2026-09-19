// Re-shoot all 5 PPT screenshots, P3/P4 guaranteed to show post-run RESULTS
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://sea-agent-web-v2.onrender.com';
const OUT = 'E:/claude/figures/shots';

async function clickByText(page, re, label) {
  const els = await page.$$('button, a, [role="button"], li, .item, div');
  for (const el of els) {
    const t = (await el.innerText().catch(() => '')).trim();
    if (t && re.test(t) && t.length < 40) {
      await el.click().catch(() => {});
      console.log(`  clicked ${label}: "${t.slice(0, 30)}"`);
      return true;
    }
  }
  console.log(`  !! ${label} not found`);
  return false;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // ---------- 1. Home ----------
  try {
    console.log('--- home ---');
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, 'home.png') });
    console.log('  OK home.png');
  } catch (e) { console.log('  home FAIL:', e.message.slice(0, 150)); }

  // ---------- 2. Design: 堆体稳定 Fs WITH result ----------
  try {
    console.log('--- design Fs result ---');
    await page.goto(BASE + '/design', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3000);
    // select 堆体稳定 Fs calculator in the left nav
    await clickByText(page, /堆体稳定/, '堆体稳定 Fs nav');
    await page.waitForTimeout(1200);
    // click 开始计算
    let clicked = false;
    for (const b of await page.$$('button')) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/开始计算/.test(t)) { await b.click(); clicked = true; console.log('  clicked 开始计算'); break; }
    }
    if (!clicked) console.log('  !! 开始计算 not found');
    // wait for result panel
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      const html = await page.content();
      if (/计算结果|安全系数|Fs|正常|风险/.test(html) && /依据|规范|CJJ|kPa|结果/.test(html)) break;
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, 'design_result.png') });
    console.log('  OK design_result.png');
  } catch (e) { console.log('  design FAIL:', e.message.slice(0, 150)); }

  // ---------- 3. MultiAgent: real run until all agents finish ----------
  try {
    console.log('--- multiagent run ---');
    await page.goto(BASE + '/multi-agent', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(3000);
    const ta = await page.$('textarea');
    if (ta) {
      await ta.fill('某存量填埋场：堆体高28m，边坡1:2.5，运行12年，CH4浓度3.2%，渗滤液水位偏高，下游200m地下水Cl-为280mg/L，请评估现状风险');
      console.log('  scenario filled');
    }
    for (const b of await page.$$('button')) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/启动分析/.test(t)) { await b.click(); console.log('  clicked 启动分析'); break; }
    }
    console.log('  waiting for 5 agents (up to 150s)...');
    let done = false;
    for (let i = 0; i < 75; i++) {
      await page.waitForTimeout(2000);
      const html = await page.content();
      const doneCount = (html.match(/完成/g) || []).length;
      if (i % 5 === 4) console.log(`  ... ${(i + 1) * 2}s, 完成x${doneCount}`);
      if (doneCount >= 5 && !/思考中|分析中\.\.\./.test(html)) {
        await page.waitForTimeout(5000);
        done = true; break;
      }
    }
    console.log('  agents done:', done);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'multiagent_result.png') });
    console.log('  OK multiagent_result.png');
    await page.screenshot({ path: path.join(OUT, 'multiagent_result_full.png'), fullPage: true });
    console.log('  OK multiagent_result_full.png');
  } catch (e) { console.log('  multiagent FAIL:', e.message.slice(0, 150)); }

  // ---------- 4. Diagnose: 加载示例 → 开始诊断 → result ----------
  try {
    console.log('--- diagnose result ---');
    await page.goto(BASE + '/diagnose', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(2500);
    await clickByText(page, /加载示例/, '加载示例');
    await page.waitForTimeout(1000);
    let clicked = false;
    for (const b of await page.$$('button')) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/开始诊断/.test(t)) { await b.click(); clicked = true; console.log('  clicked 开始诊断'); break; }
    }
    if (!clicked) console.log('  !! 开始诊断 not found');
    for (let i = 0; i < 75; i++) {
      await page.waitForTimeout(2000);
      const html = await page.content();
      if (/综合研判报告|综合风险|诊断报告|处置建议/.test(html) && !/暂无诊断结果|诊断中/.test(html)) {
        console.log(`  result after ~${(i + 1) * 2}s`);
        await page.waitForTimeout(3000);
        break;
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'diagnose_result.png') });
    console.log('  OK diagnose_result.png');
  } catch (e) { console.log('  diagnose FAIL:', e.message.slice(0, 150)); }

  // ---------- 5. 3D simulator ----------
  try {
    console.log('--- simulator3d ---');
    await page.goto(BASE + '/3d-simulator', { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(OUT, 'simulator3d.png') });
    console.log('  OK simulator3d.png');
  } catch (e) { console.log('  simulator FAIL:', e.message.slice(0, 150)); }

  await browser.close();
  console.log('DONE-ALL');
})();
