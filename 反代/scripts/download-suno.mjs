import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

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
  const match = text.match(pattern);
  return match ? match[1].trim() : undefined;
};

const sanitizeFilename = (value) => value.replace(/[\\/:*?"<>|]/g, '-');

const uniquePath = (path) => {
  if (args.includes('--overwrite') || !existsSync(path)) return path;

  const extension = extname(path);
  const base = path.slice(0, -extension.length);
  let candidate = path;
  let counter = 2;

  while (existsSync(candidate)) {
    candidate = `${base} ${counter}${extension}`;
    counter += 1;
  }

  return candidate;
};

const endpoint = readArg('--endpoint') || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const fromMd = readArg('--from-md') || readArg('--file') || process.env.SUNO_FILE;
const md = fromMd ? readFileSync(fromMd, 'utf8') : '';
const selectedBrief = section(md, 'Selected Brief') || '';
const title =
  readArg('--title') ||
  process.env.SUNO_TITLE ||
  selectedBrief.match(/"title_seed":\s*"([^"]+)"/)?.[1] ||
  'Static Fever';
const downloadDir = resolve(readArg('--dir') || process.env.SUNO_DOWNLOAD_DIR || 'downloads');
const index = Number.parseInt(readArg('--index') || process.env.SUNO_DOWNLOAD_INDEX || '0', 10);
const filenameArg = readArg('--filename') || process.env.SUNO_DOWNLOAD_FILENAME;

if (!Number.isInteger(index) || index < 0) {
  throw new Error(`Invalid --index value: ${index}`);
}

mkdirSync(downloadDir, { recursive: true });

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
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  const target = await page.evaluate(
    ({ title, index }) => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const rectOf = (el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        };
      };

      const songs = [...document.querySelectorAll('a[href*="/song/"]')]
        .filter(visible)
        .map((el) => ({
          text: normalize(el.textContent),
          href: el.href,
          rect: rectOf(el)
        }))
        .filter((song) => song.text === title)
        .sort((a, b) => a.rect.y - b.rect.y);

      const song = songs[index];
      if (!song) {
        return { error: `Could not find song "${title}" at index ${index}`, songs };
      }

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

      if (!menuButton) {
        return { error: `Could not find More options button for "${title}"`, song };
      }

      return { song, menuButton };
    },
    { title, index }
  );

  if (target.error) {
    throw new Error(`${target.error}\nVisible matches: ${JSON.stringify(target.songs || target.song || [])}`);
  }

  await page.mouse.click(
    target.menuButton.rect.x + target.menuButton.rect.width / 2,
    target.menuButton.rect.y + target.menuButton.rect.height / 2
  );
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Download' }).click({ timeout: 10_000 });
  await page.waitForTimeout(300);

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'MP3 Audio' }).click({ timeout: 10_000 });
  const download = await downloadPromise;

  const suggestedFilename = sanitizeFilename(download.suggestedFilename() || `${title}.mp3`);
  const targetFilename = sanitizeFilename(filenameArg || suggestedFilename || basename(target.song.href));
  const targetPath = uniquePath(join(downloadDir, targetFilename));
  await download.saveAs(targetPath);

  console.log(
    JSON.stringify(
      {
        title,
        index,
        songUrl: target.song.href,
        suggestedFilename,
        targetPath
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
