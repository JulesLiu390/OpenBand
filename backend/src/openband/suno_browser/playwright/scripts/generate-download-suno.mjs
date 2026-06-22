import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const args = process.argv.slice(2);

const readArg = (name) => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];

  return undefined;
};

const section = (text, heading) => {
  const pattern = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  return text.match(pattern)?.[1]?.trim();
};

const sanitizeFilename = (value) => value.replace(/[\\/:*?"<>|]/g, '-');

const uniquePath = (path) => {
  if (args.includes('--overwrite') || !existsSync(path)) return path;

  const extension = extname(path);
  const base = path.slice(0, -extension.length);
  let counter = 2;
  let candidate = path;

  while (existsSync(candidate)) {
    candidate = `${base} ${counter}${extension}`;
    counter += 1;
  }

  return candidate;
};

const exportStorageState = async ({ endpoint, storageStatePath }) => {
  const cdpBrowser = await chromium.connectOverCDP(endpoint);

  try {
    const context = cdpBrowser.contexts()[0];
    if (!context) {
      throw new Error(`No browser context found at ${endpoint}`);
    }

    await context.storageState({ path: storageStatePath });
  } finally {
    await cdpBrowser.close();
  }
};

const fillAdvancedForm = async ({ page, title, style, lyrics, excludeStyles }) => {
  await page.getByRole('tab', { name: 'Advanced' }).click({ timeout: 30_000 });
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
};

const findSongAndMenu = async ({ page, title, index }) =>
  page.evaluate(
    ({ title, index }) => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const rectOf = (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };

      const songs = [...document.querySelectorAll('a[href*="/song/"]')]
        .filter(visible)
        .map((el) => ({ text: normalize(el.textContent), href: el.href, rect: rectOf(el) }))
        .filter((song) => song.text === title)
        .sort((a, b) => a.rect.y - b.rect.y);

      const song = songs[index];
      if (!song) return { error: `Could not find song "${title}" at index ${index}`, songs };

      const menuButtons = [...document.querySelectorAll('button[aria-label="More options"]')]
        .filter(visible)
        .map((el) => ({ rect: rectOf(el) }));
      const menuButton = menuButtons
        .filter((button) => Math.abs((button.rect.y + button.rect.height / 2) - (song.rect.y + song.rect.height / 2)) < 80)
        .sort(
          (a, b) =>
            Math.abs((a.rect.y + a.rect.height / 2) - (song.rect.y + song.rect.height / 2)) -
            Math.abs((b.rect.y + b.rect.height / 2) - (song.rect.y + song.rect.height / 2))
        )[0];

      if (!menuButton) return { error: `Could not find More options button for "${title}"`, song };

      const songCenterY = song.rect.y + song.rect.height / 2;
      const duration = [...document.querySelectorAll('body *')]
        .filter(visible)
        .map((el) => ({ text: normalize(el.textContent), rect: rectOf(el) }))
        .filter((candidate) => /^\d+[:：]\d{2}$/.test(candidate.text))
        .filter((candidate) => Math.abs((candidate.rect.y + candidate.rect.height / 2) - songCenterY) < 100)
        .sort(
          (a, b) =>
            Math.abs((a.rect.y + a.rect.height / 2) - songCenterY) -
            Math.abs((b.rect.y + b.rect.height / 2) - songCenterY)
        )[0];

      return { song, menuButton, duration: duration || null };
    },
    { title, index }
  );

const fromMd = readArg('--from-md') || readArg('--file') || process.env.SUNO_FILE;
if (!fromMd) {
  console.error('Missing --from-md. Example: npm run suno:generate-download -- --from-md 02-ghosts-on-the-boulevard.md');
  process.exit(1);
}

const md = readFileSync(fromMd, 'utf8');
const selectedBrief = section(md, 'Selected Brief') || '';
const title =
  readArg('--title') ||
  process.env.SUNO_TITLE ||
  selectedBrief.match(/"title_seed":\s*"([^"]+)"/)?.[1];
const style = readArg('--style') || process.env.SUNO_STYLE || section(md, 'Style Prompt');
const lyrics = readArg('--lyrics') || process.env.SUNO_LYRICS || section(md, 'Lyrics');
const excludeStyles = readArg('--exclude') || process.env.SUNO_EXCLUDE_STYLES;

if (!title || (!style && !lyrics)) {
  throw new Error(`Could not parse title/style/lyrics from ${fromMd}`);
}

const endpoint = readArg('--endpoint') || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const storageStatePath = resolve(readArg('--storage-state') || process.env.SUNO_STORAGE_STATE || 'suno-storage-state.json');
const downloadDir = resolve(readArg('--dir') || process.env.SUNO_DOWNLOAD_DIR || 'downloads');
const screenshotDir = resolve(readArg('--screenshots') || process.env.SUNO_SCREENSHOT_DIR || 'headless-screenshots');
const index = Number.parseInt(readArg('--index') || process.env.SUNO_DOWNLOAD_INDEX || '0', 10);
const timeoutMs = Number.parseInt(readArg('--timeout-ms') || process.env.SUNO_GENERATE_TIMEOUT_MS || '900000', 10);
const filenameArg = readArg('--filename') || process.env.SUNO_DOWNLOAD_FILENAME;
const skipCreate = args.includes('--skip-create') || process.env.SUNO_SKIP_CREATE === '1';

mkdirSync(downloadDir, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });

if (!existsSync(storageStatePath) || args.includes('--refresh-auth')) {
  await exportStorageState({ endpoint, storageStatePath });
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true
});

try {
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: storageStatePath,
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: join(screenshotDir, '01-loaded.png'), fullPage: true });

  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  if (/join suno|log in|couldn.t sign/i.test(bodyText) && !/Create|Advanced/i.test(bodyText)) {
    throw new Error(`Headless session does not look logged in. See ${join(screenshotDir, '01-loaded.png')}`);
  }

  if (!skipCreate) {
    await fillAdvancedForm({ page, title, style, lyrics, excludeStyles });
    await page.screenshot({ path: join(screenshotDir, '02-filled.png'), fullPage: true });

    const createButton = page.getByRole('button', { name: 'Create song' });
    await createButton.waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(750);

    const buttonState = await createButton.evaluate((button) => ({
      disabled: Boolean(button.disabled) || button.getAttribute('aria-disabled') === 'true',
      text: button.innerText,
      aria: button.getAttribute('aria-label')
    }));

    if (buttonState.disabled) {
      throw new Error(`Create button is disabled. See ${join(screenshotDir, '02-filled.png')}`);
    }

    await createButton.click();
    await page.waitForTimeout(5_000);
    await page.screenshot({ path: join(screenshotDir, '03-after-create.png'), fullPage: true });
  }

  const startedAt = Date.now();
  let target = null;

  while (Date.now() - startedAt < timeoutMs) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5_000);

    target = await findSongAndMenu({ page, title, index });

    if (!target.error && target.duration) break;

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    if (elapsedSeconds % 60 < 8) {
      await page.screenshot({ path: join(screenshotDir, `waiting-${elapsedSeconds}s.png`), fullPage: true });
    }

    await page.waitForTimeout(10_000);
  }

  target = await findSongAndMenu({ page, title, index });
  if (target.error) {
    await page.screenshot({ path: join(screenshotDir, 'error-before-download.png'), fullPage: true });
    throw new Error(`${target.error}. See ${join(screenshotDir, 'error-before-download.png')}`);
  }
  if (!target.duration) {
    await page.screenshot({ path: join(screenshotDir, 'error-not-finished.png'), fullPage: true });
    throw new Error(`Song "${title}" is visible but does not look finished yet. See ${join(screenshotDir, 'error-not-finished.png')}`);
  }

  await page.mouse.click(
    target.menuButton.rect.x + target.menuButton.rect.width / 2,
    target.menuButton.rect.y + target.menuButton.rect.height / 2
  );
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Download' }).click({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshotDir, '04-download-menu.png'), fullPage: true });

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'MP3 Audio' }).click({ timeout: 10_000 });
  const download = await downloadPromise;

  const suggestedFilename = sanitizeFilename(download.suggestedFilename() || `${title}.mp3`);
  const targetFilename = sanitizeFilename(filenameArg || suggestedFilename);
  const targetPath = uniquePath(join(downloadDir, targetFilename));
  await download.saveAs(targetPath);

  console.log(
    JSON.stringify(
      {
        headless: true,
        title,
        index,
        songUrl: target.song.href,
        duration: target.duration.text,
        suggestedFilename,
        targetPath,
        screenshots: screenshotDir
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
