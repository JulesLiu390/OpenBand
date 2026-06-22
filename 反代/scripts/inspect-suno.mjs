import { chromium } from 'playwright';

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const screenshotPath = process.env.SCREENSHOT || 'suno-create-logged-in.png';

const short = (value) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 180);

const browser = await chromium.connectOverCDP(endpoint);

try {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error(`No browser context found at ${endpoint}`);
  }

  const page =
    context.pages().find((candidate) => candidate.url().includes('suno.com/create')) ||
    context.pages().find((candidate) => candidate.url().includes('suno.com')) ||
    (await context.newPage());

  await page.bringToFront();
  if (!page.url().includes('suno.com/create')) {
    await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded' });
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const info = await page.evaluate(() => {
    const short = (value) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const elemInfo = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: short(el.innerText || el.textContent || el.getAttribute('aria-label') || ''),
        aria: short(el.getAttribute('aria-label')),
        role: short(el.getAttribute('role')),
        type: short(el.getAttribute('type')),
        placeholder: short(el.getAttribute('placeholder')),
        disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
        id: short(el.id),
        testId: short(el.getAttribute('data-testid') || el.getAttribute('data-test-id')),
        contenteditable: short(el.getAttribute('contenteditable')),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    };

    return {
      title: document.title,
      url: location.href,
      bodyText: short(document.body.innerText),
      buttons: [...document.querySelectorAll('button, [role="button"]')]
        .filter(isVisible)
        .map(elemInfo)
        .slice(0, 120),
      inputs: [...document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]')]
        .filter(isVisible)
        .map(elemInfo)
        .slice(0, 120)
    };
  });

  console.log(JSON.stringify({ screenshotPath, ...info }, null, 2));
} finally {
  if (typeof browser.disconnect === 'function') {
    await browser.disconnect();
  } else {
    await browser.close();
  }
}
