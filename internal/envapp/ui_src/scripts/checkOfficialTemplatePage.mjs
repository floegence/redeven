import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { url, screenshot, authenticated } = JSON.parse(raw);
assert.equal(new URL(url).hostname, '127.0.0.1');
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const response = await page.goto(url);
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => globalThis.document.body.innerText.trim().length > 0 || globalThis.document.querySelector('canvas,video'));
  if (authenticated) assert.ok((await context.cookies()).length > 0, 'opening must establish an authenticated browser session');
  await page.reload();
  await page.waitForFunction(() => globalThis.document.body.innerText.trim().length > 0 || globalThis.document.querySelector('canvas,video'));
  await page.close();
  const reopened = await context.newPage();
  assert.equal((await reopened.goto(url)).status(), 200);
  await reopened.waitForFunction(() => globalThis.document.body.innerText.trim().length > 0 || globalThis.document.querySelector('canvas,video'));
  if (screenshot) await reopened.screenshot({ path: screenshot });
  console.log(JSON.stringify({ status: 'passed', page: await reopened.title(), reload: true, reopen: true, authenticated: Boolean(authenticated) }));
  await context.close();
} finally {
  await browser.close();
}
