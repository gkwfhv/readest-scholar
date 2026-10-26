import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { adbShell } from '../src/__tests__/android/helpers/adb';
import { CdpPage, forwardWebViewDevtools, listPages } from '../src/__tests__/android/helpers/cdp';
import { APP_PKG, waitFor } from '../src/__tests__/android/helpers/reader';

const screenshotPath = process.argv[2];
if (!screenshotPath) throw new Error('pass the output PNG path');

const port = 9333;
await adbShell(`am force-stop ${APP_PKG}`);
await waitFor(
  async () => ((await adbShell(`pidof ${APP_PKG}`).catch(() => '')).trim() ? null : true),
  { timeoutMs: 15_000, label: 'previous app process exit' },
);
await new Promise((resolve) => setTimeout(resolve, 3_000));
await adbShell(`monkey -p ${APP_PKG} -c android.intent.category.LAUNCHER 1`);

let pagesSeen: string[] = [];
const target = await waitFor(
  async () => {
    await forwardWebViewDevtools(APP_PKG, port);
    const pages = await listPages(port);
    pagesSeen = pages.filter((page) => page.type === 'page').map((page) => page.url);
    return pages.find(
      (page) => page.type === 'page' && page.url.startsWith('http://tauri.localhost/'),
    );
  },
  { timeoutMs: 90_000, intervalMs: 500, label: 'app WebView page' },
).catch((error: unknown) => {
  throw new Error(`${String(error)}; CDP pages: ${JSON.stringify(pagesSeen)}`);
});

const page = await CdpPage.connect(port, target.id);
try {
  const state = await waitFor(
    () =>
      page.evaluate<{ text: string; width: number } | null>(`
        const library = document.querySelector('[aria-label="Your Library"]');
        if (!library) return null;
        return { text: library.textContent?.trim().slice(0, 160) ?? '', width: library.getBoundingClientRect().width };
      `),
    { timeoutMs: 90_000, intervalMs: 500, label: 'visible library layout' },
  ).catch(async (error: unknown) => {
    const location = await page
      .evaluate('return { url: location.href, text: document.body?.innerText?.slice(0, 300) };')
      .catch(() => null);
    const pid = await adbShell(`pidof ${APP_PKG}`).catch(() => '');
    throw new Error(`${String(error)}; pid: ${pid.trim()}; page: ${JSON.stringify(location)}`);
  });
  if (state.width < 200 || !state.text) {
    throw new Error(`library layout is empty or too narrow: ${JSON.stringify(state)}`);
  }
  console.log(`Library layout ready: ${JSON.stringify(state)}`);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const screenshot = execFileSync('adb', ['exec-out', 'screencap', '-p'], {
    maxBuffer: 8 * 1024 * 1024,
  });
  if (screenshot.length < 6_000) {
    throw new Error(`library screenshot appears blank: ${screenshot.length} bytes`);
  }
  writeFileSync(screenshotPath, screenshot);
} finally {
  page.close();
}
