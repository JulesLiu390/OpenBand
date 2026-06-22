import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

const readArg = (name) => {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];

  return undefined;
};

const chromePath =
  readArg('--chrome') ||
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = readArg('--port') || process.env.CDP_PORT || '9222';
const profileDir = resolve(readArg('--profile') || process.env.SUNO_PROFILE || 'suno-chrome-profile');
const url = readArg('--url') || process.env.SUNO_URL || 'https://suno.com/create';

try {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (response.ok) {
    console.log(`Chrome is already listening on http://127.0.0.1:${port}`);
    process.exit(0);
  }
} catch {
  // Port is not open yet.
}

if (!existsSync(chromePath)) {
  throw new Error(`Chrome not found at ${chromePath}`);
}

mkdirSync(profileDir, { recursive: true });

const child = spawn(
  chromePath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url
  ],
  {
    detached: true,
    stdio: 'ignore'
  }
);

child.unref();

console.log(`Opened Suno in Chrome with profile: ${profileDir}`);
console.log(`CDP endpoint: http://127.0.0.1:${port}`);
