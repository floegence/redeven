import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { url, screenshot, authenticated, desktop } = JSON.parse(raw);
assert.equal(new URL(url).hostname, '127.0.0.1');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ready = async page => page.waitForFunction(isDesktop => {
    if (!isDesktop) return globalThis.document.body.innerText.trim().length > 0;
    for (const canvas of globalThis.document.querySelectorAll('canvas')) {
      if (canvas.width < 640 || canvas.height < 400) continue;
      const context = canvas.getContext('2d');
      if (!context) continue;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set(); let visible = 0;
      for (let index = 0; index < pixels.length; index += 400) {
        if (pixels[index + 3] && pixels[index] + pixels[index + 1] + pixels[index + 2] > 60) visible++;
        colors.add((pixels[index] >> 4) * 256 + (pixels[index + 1] >> 4) * 16 + (pixels[index + 2] >> 4));
      }
      if (colors.size > 24 && visible > pixels.length / 4000) return true;
    }
    return Array.from(globalThis.document.querySelectorAll('video')).some(video => video.videoWidth >= 640 && video.readyState >= 2);
  }, Boolean(desktop), { timeout: 120000 });
  const page = await context.newPage();
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await ready(page);
  if (authenticated) assert.ok((await context.cookies()).length > 0, 'opening must establish an authenticated browser session');
  await page.reload();
  await ready(page);
  await page.close();
  const reopened = await context.newPage();
  assert.equal((await reopened.goto(url)).status(), 200);
  await ready(reopened);
  if (screenshot) await reopened.screenshot({ path: screenshot });
  console.log(JSON.stringify({ status: 'passed', page: await reopened.title(), reload: true, reopen: true, authenticated: Boolean(authenticated), desktopPainted: Boolean(desktop) }));
  await context.close();
} finally {
  await browser.close();
}
