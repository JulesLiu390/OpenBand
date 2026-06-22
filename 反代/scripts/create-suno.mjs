import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);

const readArg = (name) => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];

  return undefined;
};

const hasFlag = (name) => args.includes(name);
const section = (text, heading) => {
  const pattern = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(pattern);
  return match ? match[1].trim() : undefined;
};

const endpoint = readArg('--endpoint') || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const fromMd = readArg('--from-md') || readArg('--file') || process.env.SUNO_FILE;
const md = fromMd ? readFileSync(fromMd, 'utf8') : '';
const selectedBrief = section(md, 'Selected Brief') || '';
const prompt = readArg('--prompt') || process.env.SUNO_PROMPT;
const style = readArg('--style') || process.env.SUNO_STYLE || section(md, 'Style Prompt') || prompt;
const lyrics = readArg('--lyrics') || process.env.SUNO_LYRICS || section(md, 'Lyrics');
const title =
  readArg('--title') ||
  process.env.SUNO_TITLE ||
  (selectedBrief.match(/"title_seed":\s*"([^"]+)"/)?.[1] ?? undefined);
const excludeStyles = readArg('--exclude') || process.env.SUNO_EXCLUDE_STYLES;
const shouldClick = hasFlag('--click') || process.env.SUNO_CLICK === '1';
const screenshotPath =
  readArg('--screenshot') ||
  process.env.SCREENSHOT ||
  (shouldClick ? 'suno-after-create.png' : 'suno-after-advanced-fill.png');

if (!style && !lyrics) {
  console.error(
    'Missing content. Example: npm run suno:create -- --style "neon synthwave, midnight rain" --lyrics "[Verse]\\n..."'
  );
  process.exit(1);
}

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
  await page.getByRole('tab', { name: 'Advanced' }).click({ timeout: 10_000 });
  await page.waitForTimeout(1_000);

  if (lyrics) {
    const lyricsBox = page.locator('textarea[data-testid="lyrics-textarea"]:visible');
    await lyricsBox.waitFor({ state: 'visible', timeout: 30_000 });
    await lyricsBox.fill(lyrics);
  }

  if (style) {
    const styleBox = page.locator('textarea:visible:not([data-testid="lyrics-textarea"])').first();
    await styleBox.waitFor({ state: 'visible', timeout: 30_000 });
    await styleBox.fill(style);
  }

  if (excludeStyles) {
    await page.locator('input[placeholder="Exclude styles"]:visible').first().fill(excludeStyles);
  }

  if (title) {
    await page.locator('input[placeholder="Song Title (Optional)"]:visible').first().fill(title);
  }

  const createButton = page.getByRole('button', { name: 'Create song' });
  await createButton.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(750);

  let buttonState = await createButton.evaluate((button) => ({
    disabled: Boolean(button.disabled) || button.getAttribute('aria-disabled') === 'true',
    text: button.innerText,
    aria: button.getAttribute('aria-label')
  }));

  if (buttonState.disabled && style && !lyrics) {
    await page.getByRole('button', { name: 'Instrumental' }).click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(750);
    buttonState = await createButton.evaluate((button) => ({
      disabled: Boolean(button.disabled) || button.getAttribute('aria-disabled') === 'true',
      text: button.innerText,
      aria: button.getAttribute('aria-label')
    }));
  }

  if (shouldClick) {
    if (buttonState.disabled) {
      throw new Error(`Create button is still disabled after filling the prompt: ${JSON.stringify(buttonState)}`);
    }
    await createButton.click();
    await page.waitForTimeout(5_000);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(
    JSON.stringify(
      {
        clicked: shouldClick,
        createButton: buttonState,
        fromMd: fromMd || null,
        prompt,
        style,
        lyrics: lyrics ? '[provided]' : null,
        title: title || null,
        excludeStyles: excludeStyles || null,
        screenshotPath,
        url: page.url()
      },
      null,
      2
    )
  );
} finally {
  if (typeof browser.disconnect === 'function') {
    await browser.disconnect();
  } else {
    await browser.close();
  }
}
