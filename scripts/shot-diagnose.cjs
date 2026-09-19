// Re-shoot diagnose page WITH real diagnosis result
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://sea-agent-web-v2.onrender.com';
const OUT = 'E:/claude/figures/shots';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  console.log('goto /diagnose');
  await page.goto(BASE + '/diagnose', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // list all buttons to find exact labels
  const btns = await page.$$('button');
  console.log(`buttons on page: ${btns.length}`);
  for (const b of btns) {
    const t = (await b.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    if (t) console.log(`  btn: "${t.slice(0, 40)}"`);
  }

  // click 开始诊断 (real run with example form values)
  let clicked = false;
  for (const b of btns) {
    const t = (await b.innerText().catch(() => '')).trim();
    if (/开始诊断/.test(t)) {
      console.log('>>> click 开始诊断');
      await b.click(); clicked = true; break;
    }
  }
  if (!clicked) { console.log('!! 开始诊断 not found'); }

  // poll for result (up to 150s; 详细模式 30-90s)
  console.log('waiting for diagnosis result...');
  let ok = false;
  for (let i = 0; i < 75; i++) {
    await page.waitForTimeout(2000);
    const html = await page.content();
    if (/综合风险|风险等级|诊断报告|处置建议|红|橙|黄|蓝/.test(html) && !/暂无诊断结果/.test(html)) {
      ok = true;
      console.log(`  result after ~${(i + 1) * 2}s`);
      await page.waitForTimeout(3000); // let animations settle
      break;
    }
    if (i % 10 === 9) console.log(`  ... ${(i + 1) * 2}s`);
  }
  console.log('result detected:', ok);

  // screenshot: viewport at result panel (right side), then full page
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'diagnose_result.png') });
  console.log('OK diagnose_result.png (viewport)');
  await page.screenshot({ path: path.join(OUT, 'diagnose_result_full.png'), fullPage: true });
  console.log('OK diagnose_result_full.png');

  await browser.close();
  console.log('DONE');
})();
