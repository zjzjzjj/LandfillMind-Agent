// Screenshot sea-agent-web-v2 key pages for PPT
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://sea-agent-web-v2.onrender.com';
const OUT = path.resolve(__dirname, '../../claude/figures/shots');

const PAGES = [
  { route: '/',            name: 'home',        wait: 3500, note: '首页 Hero + 功能卡' },
  { route: '/diagnose',    name: 'diagnose',    wait: 3000, note: 'AI 快诊表单' },
  { route: '/design',      name: 'design',      wait: 3000, note: '12 计算器三栏' },
  { route: '/multi-agent', name: 'multiagent',  wait: 3000, note: '5 专家协同' },
  { route: '/3d-simulator',name: 'simulator3d', wait: 6000, note: '3D 数字孪生' },
];

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 2,   // retina-quality for PPT
  });
  const page = await ctx.newPage();

  for (const p of PAGES) {
    try {
      console.log(`shot ${p.name} <- ${BASE}${p.route}`);
      await page.goto(BASE + p.route, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(p.wait);
      await page.screenshot({ path: path.join(OUT, `${p.name}.png`) });
      console.log(`  OK ${p.name}.png`);
    } catch (e) {
      console.log(`  FAIL ${p.name}: ${e.message.slice(0, 120)}`);
    }
  }

  // Diagnose page: try to load built-in example for a richer shot
  try {
    await page.goto(BASE + '/diagnose', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    // look for example/demo button
    const btns = await page.$$('button');
    for (const b of btns) {
      const t = (await b.innerText().catch(() => '')).trim();
      if (/示例|示例数据|内置|demo|example/i.test(t)) {
        console.log(`  clicking example button: "${t}"`);
        await b.click();
        await page.waitForTimeout(1500);
        break;
      }
    }
    await page.screenshot({ path: path.join(OUT, 'diagnose_filled.png') });
    console.log('  OK diagnose_filled.png');
  } catch (e) {
    console.log('  diagnose_filled FAIL:', e.message.slice(0, 120));
  }

  await browser.close();
  console.log('DONE');
})();
