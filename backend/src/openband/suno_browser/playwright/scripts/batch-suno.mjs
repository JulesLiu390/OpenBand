import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);

const optionsWithValues = new Set([
  '--batch',
  '--dir',
  '--endpoint',
  '--files',
  '--poll-ms',
  '--screenshots',
  '--storage-state',
  '--max-scrolls',
  '--submit-gap-ms',
  '--timeout-ms',
  '--versions'
]);

const readArg = (name) => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];

  return undefined;
};

const positionalArgs = () => {
  const values = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!arg.includes('=') && optionsWithValues.has(arg)) index += 1;
      continue;
    }
    values.push(arg);
  }

  return values;
};

const section = (text, heading) => {
  const pattern = new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  return text.match(pattern)?.[1]?.trim();
};

const sanitizeFilename = (value) => value.replace(/[\\/:*?"<>|]/g, '-');

const slugify = (value) =>
  sanitizeFilename(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

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

const parseDuration = (value) => {
  const match = (value || '').trim().match(/^(\d+)[:：](\d{2})$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const exportStorageState = async ({ endpoint, storageStatePath }) => {
  const cdpBrowser = await chromium.connectOverCDP(endpoint);

  try {
    const context = cdpBrowser.contexts()[0];
    if (!context) throw new Error(`No browser context found at ${endpoint}`);
    await context.storageState({ path: storageStatePath });
  } finally {
    await cdpBrowser.close();
  }
};

const parseSongFile = (file, index) => {
  const md = readFileSync(file, 'utf8');
  const selectedBrief = section(md, 'Selected Brief') || '';
  const title = selectedBrief.match(/"title_seed":\s*"([^"]+)"/)?.[1];
  const style = section(md, 'Style Prompt');
  const lyrics = section(md, 'Lyrics');

  if (!title || (!style && !lyrics)) {
    throw new Error(`Could not parse title/style/lyrics from ${file}`);
  }

  return {
    index,
    file,
    title,
    style,
    lyrics,
    slug: `${String(index + 1).padStart(2, '0')}-${slugify(title || basename(file))}`,
    beforeUrls: new Set(),
    completedRows: [],
    selectedRow: null,
    status: 'pending'
  };
};

const fillAdvancedForm = async ({ page, task }) => {
  await page.getByRole('tab', { name: 'Advanced' }).click({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  if (task.lyrics) {
    const lyricsBox = page.locator('textarea[data-testid="lyrics-textarea"]:visible');
    await lyricsBox.waitFor({ state: 'visible', timeout: 30_000 });
    await lyricsBox.fill(task.lyrics);
  }

  if (task.style) {
    const styleBox = page.locator('textarea:visible:not([data-testid="lyrics-textarea"])').first();
    await styleBox.waitFor({ state: 'visible', timeout: 30_000 });
    await styleBox.fill(task.style);
  }

  await page.locator('input[placeholder="Song Title (Optional)"]:visible').first().fill(task.title);
};

const scrollSongListToTop = async ({ page }) =>
  page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const scroller =
      [...document.querySelectorAll('body *')]
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            visible(el) &&
            rect.x > 550 &&
            rect.width > 300 &&
            rect.height > 300 &&
            el.scrollHeight > el.clientHeight + 40 &&
            /auto|scroll/.test(style.overflowY)
          );
        })
        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ||
      document.scrollingElement ||
      document.documentElement;

    scroller.scrollTop = 0;
    return {
      top: scroller.scrollTop,
      max: Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    };
  });

const scrollSongListDown = async ({ page }) =>
  page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const scroller =
      [...document.querySelectorAll('body *')]
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            visible(el) &&
            rect.x > 550 &&
            rect.width > 300 &&
            rect.height > 300 &&
            el.scrollHeight > el.clientHeight + 40 &&
            /auto|scroll/.test(style.overflowY)
          );
        })
        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0] ||
      document.scrollingElement ||
      document.documentElement;

    const before = scroller.scrollTop;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(max, before + Math.max(400, Math.floor(scroller.clientHeight * 0.85)));

    return {
      before,
      after: scroller.scrollTop,
      max,
      atBottom: scroller.scrollTop >= max - 2
    };
  });

const getVisibleRowsForTitle = async ({ page, title }) =>
  page.evaluate((title) => {
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

    const durations = [...document.querySelectorAll('body *')]
      .filter(visible)
      .map((el) => ({ text: normalize(el.textContent), rect: rectOf(el) }))
      .filter((candidate) => /^\d+[:：]\d{2}$/.test(candidate.text));

    const menuButtons = [...document.querySelectorAll('button[aria-label="More options"]')]
      .filter(visible)
      .map((el) => ({ rect: rectOf(el) }));

    return [...document.querySelectorAll('a[href*="/song/"]')]
      .filter(visible)
      .map((el) => ({ text: normalize(el.textContent), href: el.href, rect: rectOf(el) }))
      .filter((song) => song.text === title && song.rect.x > 600)
      .sort((a, b) => a.rect.y - b.rect.y)
      .map((song) => {
        const centerY = song.rect.y + song.rect.height / 2;
        const duration = durations
          .filter((candidate) => Math.abs((candidate.rect.y + candidate.rect.height / 2) - centerY) < 100)
          .sort(
            (a, b) =>
              Math.abs((a.rect.y + a.rect.height / 2) - centerY) -
              Math.abs((b.rect.y + b.rect.height / 2) - centerY)
          )[0];
        const menuButton = menuButtons
          .filter((button) => Math.abs((button.rect.y + button.rect.height / 2) - centerY) < 80)
          .sort(
            (a, b) =>
              Math.abs((a.rect.y + a.rect.height / 2) - centerY) -
              Math.abs((b.rect.y + b.rect.height / 2) - centerY)
          )[0];

        return {
          ...song,
          duration: duration?.text || null,
          durationSeconds: duration
            ? Number(duration.text.replace('：', ':').split(':')[0]) * 60 +
              Number(duration.text.replace('：', ':').split(':')[1])
            : null,
          menuButton: menuButton || null
        };
      });
  }, title);

const getRowsForTitle = async ({ page, title, maxScrolls = 40 }) => {
  const rowsByHref = new Map();
  await scrollSongListToTop({ page });
  await page.waitForTimeout(500);

  for (let scanStep = 0; scanStep < maxScrolls; scanStep += 1) {
    const visibleRows = await getVisibleRowsForTitle({ page, title });
    for (const row of visibleRows) {
      const previous = rowsByHref.get(row.href);
      if (!previous || (!previous.duration && row.duration) || (!previous.menuButton && row.menuButton)) {
        rowsByHref.set(row.href, { ...row, scanStep });
      }
    }

    const state = await scrollSongListDown({ page });
    if (state.atBottom || state.after === state.before) break;
    await page.waitForTimeout(350);
  }

  return [...rowsByHref.values()].sort((a, b) => a.scanStep - b.scanStep || a.rect.y - b.rect.y);
};

const revealRowByHref = async ({ page, title, href, maxScrolls = 40 }) => {
  await scrollSongListToTop({ page });
  await page.waitForTimeout(500);

  for (let scanStep = 0; scanStep < maxScrolls; scanStep += 1) {
    const visibleRows = await getVisibleRowsForTitle({ page, title });
    const row = visibleRows.find((candidate) => candidate.href === href);
    if (row) return { ...row, scanStep };

    const state = await scrollSongListDown({ page });
    if (state.atBottom || state.after === state.before) break;
    await page.waitForTimeout(350);
  }

  return null;
};

const downloadRow = async ({ page, task, row, downloadDir, screenshotDir }) => {
  if (!row.menuButton) throw new Error(`No menu button for ${task.title}`);

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  await page.mouse.click(row.menuButton.rect.x + row.menuButton.rect.width / 2, row.menuButton.rect.y + row.menuButton.rect.height / 2);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Download' }).click({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(screenshotDir, task.slug, 'download-menu.png'), fullPage: true });

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'MP3 Audio' }).click({ timeout: 10_000 });
  const download = await downloadPromise;
  const suggestedFilename = sanitizeFilename(download.suggestedFilename() || `${task.title}.mp3`);
  const targetPath = uniquePath(join(downloadDir, suggestedFilename));

  await download.saveAs(targetPath);
  return { suggestedFilename, targetPath };
};

const filesArg = readArg('--files');
const files = filesArg ? filesArg.split(',').map((file) => file.trim()).filter(Boolean) : positionalArgs();

if (files.length === 0) {
  console.error('Missing markdown files. Example: npm run suno:batch -- 01-static-fever.md 02-ghosts-on-the-boulevard.md');
  process.exit(1);
}

const tasks = files.map(parseSongFile);
const duplicateTitles = tasks
  .map((task) => task.title)
  .filter((title, index, titles) => titles.indexOf(title) !== index);

if (duplicateTitles.length > 0) {
  throw new Error(`Duplicate titles are not supported in one batch: ${[...new Set(duplicateTitles)].join(', ')}`);
}

const endpoint = readArg('--endpoint') || process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const storageStatePath = resolve(readArg('--storage-state') || process.env.SUNO_STORAGE_STATE || 'suno-storage-state.json');
const batchName =
  readArg('--batch') ||
  process.env.SUNO_BATCH_NAME ||
  new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const downloadRoot = resolve(readArg('--dir') || process.env.SUNO_DOWNLOAD_DIR || 'downloads');
const downloadDir = args.includes('--flat-dir') ? downloadRoot : join(downloadRoot, batchName);
const screenshotRoot = resolve(readArg('--screenshots') || process.env.SUNO_SCREENSHOT_DIR || 'headless-screenshots');
const screenshotDir = join(screenshotRoot, batchName);
const versionsNeeded = Number.parseInt(readArg('--versions') || process.env.SUNO_BATCH_VERSIONS || '2', 10);
const submitGapMs = Number.parseInt(readArg('--submit-gap-ms') || process.env.SUNO_BATCH_SUBMIT_GAP_MS || '3000', 10);
const pollMs = Number.parseInt(readArg('--poll-ms') || process.env.SUNO_BATCH_POLL_MS || '15000', 10);
const timeoutMs = Number.parseInt(readArg('--timeout-ms') || process.env.SUNO_BATCH_TIMEOUT_MS || '1200000', 10);
const maxScrolls = Number.parseInt(readArg('--max-scrolls') || process.env.SUNO_BATCH_MAX_SCROLLS || '40', 10);
const dryRun = args.includes('--dry-run');
const skipSubmit = args.includes('--skip-submit') || process.env.SUNO_BATCH_SKIP_SUBMIT === '1';

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        batchName,
        downloadDir,
        screenshotDir,
        submitGapMs,
        versionsNeeded,
        maxScrolls,
        skipSubmit,
        files: tasks.map((task) => ({
          file: task.file,
          title: task.title,
          styleChars: task.style?.length || 0,
          lyricsChars: task.lyrics?.length || 0
        }))
      },
      null,
      2
    )
  );
  process.exit(0);
}

mkdirSync(downloadDir, { recursive: true });
mkdirSync(screenshotDir, { recursive: true });
for (const task of tasks) {
  mkdirSync(join(screenshotDir, task.slug), { recursive: true });
}

if (!existsSync(storageStatePath) || args.includes('--refresh-auth')) {
  await exportStorageState({ endpoint, storageStatePath });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: storageStatePath,
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  await page.goto('https://suno.com/create', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: join(screenshotDir, 'batch-loaded.png'), fullPage: true });

  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  if (/join suno|log in|couldn.t sign/i.test(bodyText) && !/Create|Advanced/i.test(bodyText)) {
    throw new Error(`Headless session does not look logged in. See ${join(screenshotDir, 'batch-loaded.png')}`);
  }

  for (const task of tasks) {
    const rows = await getRowsForTitle({ page, title: task.title, maxScrolls });
    task.beforeUrls = skipSubmit ? new Set() : new Set(rows.map((row) => row.href));
    if (skipSubmit) task.status = 'submitted';
  }

  for (const task of tasks) {
    if (skipSubmit) continue;

    try {
      await fillAdvancedForm({ page, task });
      await page.screenshot({ path: join(screenshotDir, task.slug, 'filled.png'), fullPage: true });

      const createButton = page.getByRole('button', { name: 'Create song' });
      await createButton.waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForTimeout(750);

      const buttonState = await createButton.evaluate((button) => ({
        disabled: Boolean(button.disabled) || button.getAttribute('aria-disabled') === 'true',
        text: button.innerText,
        aria: button.getAttribute('aria-label')
      }));

      if (buttonState.disabled) throw new Error(`Create button is disabled: ${JSON.stringify(buttonState)}`);

      await createButton.click();
      task.status = 'submitted';
      await page.waitForTimeout(1_500);
      await page.screenshot({ path: join(screenshotDir, task.slug, 'submitted.png'), fullPage: true });
      await sleep(submitGapMs);
    } catch (error) {
      task.status = 'submit_failed';
      task.error = error.message;
      await page.screenshot({ path: join(screenshotDir, task.slug, 'error-submit.png'), fullPage: true }).catch(() => {});
      throw error;
    }
  }

  const startedAt = Date.now();
  let lastWaitingScreenshotAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(5_000);

    for (const task of tasks.filter((candidate) => candidate.status !== 'ready')) {
      const rows = await getRowsForTitle({ page, title: task.title, maxScrolls });
      const newRows = rows.filter((row) => !task.beforeUrls.has(row.href));
      const completedRows = newRows
        .filter((row) => row.duration && row.durationSeconds !== null && row.menuButton)
        .sort((a, b) => b.durationSeconds - a.durationSeconds);

      task.completedRows = completedRows;
      if (completedRows.length >= versionsNeeded) {
        task.selectedRow = completedRows[0];
        task.status = 'ready';
      }
    }

    if (tasks.every((task) => task.status === 'ready')) break;

    if (Date.now() - lastWaitingScreenshotAt >= 60_000) {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      for (const task of tasks.filter((candidate) => candidate.status !== 'ready')) {
        await page.screenshot({ path: join(screenshotDir, task.slug, `waiting-${elapsedSeconds}s.png`), fullPage: true }).catch(() => {});
      }
      lastWaitingScreenshotAt = Date.now();
    }

    await sleep(pollMs);
  }

  const notReady = tasks.filter((task) => task.status !== 'ready');
  if (notReady.length > 0) {
    for (const task of notReady) {
      await page.screenshot({ path: join(screenshotDir, task.slug, 'error-not-ready.png'), fullPage: true }).catch(() => {});
      task.error = `Only found ${task.completedRows.length}/${versionsNeeded} completed new versions`;
    }
    throw new Error(`Timed out waiting for: ${notReady.map((task) => `${task.title} (${task.error})`).join(', ')}`);
  }

  const results = [];
  for (const task of tasks) {
    let selected = null;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(3_000 + attempt * 1_000);

      selected = await revealRowByHref({ page, title: task.title, href: task.selectedRow.href, maxScrolls });
      if (selected) break;
    }

    if (!selected) {
      await page.screenshot({ path: join(screenshotDir, task.slug, 'error-selected-row-missing.png'), fullPage: true }).catch(() => {});
      throw new Error(`Selected row disappeared before download: ${task.title}`);
    }
    const downloadResult = await downloadRow({ page, task, row: selected, downloadDir, screenshotDir });
    task.status = 'downloaded';
    results.push({
      file: task.file,
      title: task.title,
      selectedDuration: task.selectedRow.duration,
      selectedSeconds: task.selectedRow.durationSeconds,
      songUrl: task.selectedRow.href,
      ...downloadResult
    });
  }

  console.log(
    JSON.stringify(
      {
        headless: true,
        batchName,
        downloadDir,
        screenshotDir,
        submitted: tasks.length,
        results
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
