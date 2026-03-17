import { chromium } from 'playwright';
import fs from 'node:fs';

const filePath = '/tmp/redeven-upload-demo.txt';
fs.writeFileSync(filePath, 'demo from playwright');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => console.log('console', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('pageerror', err.message));
page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/local/access') || url.includes('/_redeven_proxy/api/ai/uploads') || url.includes('/rpc')) {
    console.log('request', req.method(), url);
  }
});
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('/api/local/access') || url.includes('/_redeven_proxy/api/ai/uploads') || url.includes('/rpc')) {
    let body = '';
    try { body = await resp.text(); } catch {}
    console.log('response', resp.status(), url, body.slice(0, 400));
  }
});

await page.goto('http://192.168.31.120:23998/_redeven_proxy/env/', { waitUntil: 'networkidle' });
console.log('title', await page.title());

const pwd = page.locator('input[type="password"]');
if (await pwd.count()) {
  await pwd.fill('123');
  await page.getByRole('button', { name: /unlock/i }).click();
  await page.waitForLoadState('networkidle');
}

await page.waitForTimeout(2000);
console.log('textarea count', await page.locator('textarea').count());
const textarea = page.locator('textarea').first();
await textarea.fill('test upload');

const fileChooserPromise = page.waitForEvent('filechooser');
await page.getByTitle('Add attachments').first().click();
const fileChooser = await fileChooserPromise;
await fileChooser.setFiles(filePath);

await page.waitForTimeout(1000);

const sendBtn = page.locator('button[title="Send message"]').first();
console.log('send disabled', await sendBtn.isDisabled());
await sendBtn.click();
await page.waitForTimeout(5000);

const bodyText = await page.locator('body').innerText();
console.log('body snippet', bodyText.slice(0, 4000));

await page.screenshot({ path: '/tmp/repro_flower_upload.png', fullPage: true });
await browser.close();
