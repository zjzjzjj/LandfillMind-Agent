import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('PAGE: ' + e.message.slice(0, 200)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CON: ' + m.text().slice(0, 200));
  });

  await page.goto('http://localhost:5173/chat/new', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 截图
  await page.screenshot({ path: 'C:/Users/21356/AppData/Local/Temp/chat-debug.png', fullPage: true });

  // 检查页面是否真的渲染了
  const html = await page.content();
  const hasCodeBlocks = html.includes('<pre>') || html.includes('<code class="language-');
  const hasInput = await page.locator('textarea, input[type="text"]').count();
  console.log('Has code block in DOM:', hasCodeBlocks);
  console.log('Text inputs:', hasInput);
  console.log('Errors:', errors.slice(0, 10).join('\n--\n'));

  await browser.close();
})();