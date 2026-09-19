// Screenshot agent pages WITH analysis results
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://sea-agent-web-v2.onrender.com';
const OUT = 'E:/claude/figures/shots';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  // ============ 1. Diagnose with demo result ============
  try {
    console.log('--- diagnose result ---');
    await page.goto(BASE + '/diagnose', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    // click demo-result button
    const btns = await page.$$('button');
    let clicked = false;
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/加载演示数据并立即展示示例诊断报告/.test(t)) {
        console.log('  click demo-result:', t.slice(0, 30));
        await b.click(); clicked = true; break;
      }
    }
    if (!clicked) {
      for (const b of btns) {
        const t = (await b.innerText().catch(() => '')).trim();
        if (/一键加载演示|演示数据|示例诊断/.test(t)) {
          console.log('  click fallback:', t.slice(0, 30));
          await b.click(); clicked = true; break;
        }
      }
    }
    await page.waitForTimeout(3000);
    // scroll to result area (usually below form)
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'diagnose_result.png') });
    console.log('  OK diagnose_result.png');
    // also full-page version
    await page.screenshot({ path: path.join(OUT, 'diagnose_result_full.png'), fullPage: true });
    console.log('  OK diagnose_result_full.png');
  } catch (e) {
    console.log('  diagnose FAIL:', e.message.slice(0, 200));
  }

  // ============ 2. MultiAgent with real run ============
  try {
    console.log('--- multiagent run ---');
    await page.goto(BASE + '/multi-agent', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    // fill scenario textarea
    const ta = await page.$('textarea');
    if (ta) {
      await ta.fill('某存量填埋场：堆体高28m，边坡1:2.5，运行12年，CH4浓度3.2%，渗滤液水位偏高，下游200m地下水Cl-为280mg/L，请评估现状风险');
      console.log('  scenario filled');
    }
    // click 启动分析
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/启动分析/.test(t)) {
        console.log('  click:', t.slice(0, 20));
        await b.click(); break;
      }
    }
    // wait for results — poll for agent result cards (up to 120s)
    console.log('  waiting for agent results (up to 120s)...');
    let done = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const html = await page.content();
      // heuristic: agent result cards appear / streaming finished
      if (/综合风险|总工|结论|建议|完成/.test(html) && !/思考中|分析中\.\.\./.test(html)) {
        // give a bit more time for all agents
        await page.waitForTimeout(5000);
        done = true; break;
      }
      if (i % 10 === 9) console.log(`  ... ${(i+1)*2}s elapsed`);
    }
    console.log('  result detected:', done);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'multiagent_result.png') });
    console.log('  OK multiagent_result.png');
    await page.screenshot({ path: path.join(OUT, 'multiagent_result_full.png'), fullPage: true });
    console.log('  OK multiagent_result_full.png');
  } catch (e) {
    console.log('  multiagent FAIL:', e.message.slice(0, 200));
  }

  // ============ 3. Design with calc result ============
  try {
    console.log('--- design calc result ---');
    await page.goto(BASE + '/design', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/开始计算/.test(t)) {
        console.log('  click:', t.trim().slice(0, 15));
        await b.click(); break;
      }
    }
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(OUT, 'design_result.png') });
    console.log('  OK design_result.png');
    await page.screenshot({ path: path.join(OUT, 'design_result_full.png'), fullPage: true });
    console.log('  OK design_result_full.png');
  } catch (e) {
    console.log('  design FAIL:', e.message.slice(0, 200));
  }

  await browser.close();
  console.log('DONE');
})();
