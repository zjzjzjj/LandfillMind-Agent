import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 捕获 console 错误
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  });

  try {
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 15000 });
  } catch (e: any) {
    console.log('NAV ERROR:', e.message);
  }

  // 1) 检查页面是否正常加载
  const title = await page.title();
  console.log('Title:', title);

  // 2) 查找按钮和链接
  const buttons = await page.$$eval('button, a', els => els.map(e => ({
    tag: e.tagName,
    text: (e.textContent ?? '').trim().slice(0, 30),
    visible: (e as HTMLElement).offsetParent !== null,
    zIndex: getComputedStyle(e).zIndex,
    pointerEvents: getComputedStyle(e).pointerEvents,
  })));
  console.log('Buttons/links:', buttons.length, 'total,', buttons.filter(b => b.visible).length, 'visible');

  // 3) 检查 hero 区按钮
  const heroBtn = await page.locator('button:has-text("开始 AI 快诊")').first();
  if (await heroBtn.count() > 0) {
    const before = await heroBtn.evaluate((el: any) => ({
      rect: el.getBoundingClientRect(),
      pointerEvents: getComputedStyle(el).pointerEvents,
      zIndex: getComputedStyle(el).zIndex,
    }));
    console.log('Hero button:', JSON.stringify(before));
  }

  // 4) 尝试点击 hero 按钮
  try {
    await page.locator('button:has-text("开始 AI 快诊")').first().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    console.log('After click URL:', page.url());
  } catch (e: any) {
    console.log('CLICK ERROR:', e.message.slice(0, 100));
  }

  // 5) 截图
  await page.screenshot({ path: 'C:/Users/21356/AppData/Local/Temp/home-test.png', fullPage: false });

  // 6) 输出 console 错误
  console.log('--- Errors ---');
  for (const e of errors.slice(0, 5)) console.log(e.slice(0, 200));

  await browser.close();
})();