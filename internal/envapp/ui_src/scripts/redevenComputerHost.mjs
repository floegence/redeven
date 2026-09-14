import readline from 'node:readline';
import process from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
const cdpIndex = process.argv.indexOf('--cdp-url');
const cdpURL = cdpIndex >= 0 ? process.argv[cdpIndex + 1] : undefined;
let browser;
let context;
let page;
try {
  const { chromium } = await import('playwright');
  const resources = path.dirname(fileURLToPath(import.meta.url));
  const browserConfig = path.join(resources, 'browser.json');
  let executablePath;
  if (existsSync(browserConfig)) {
    const configuration = JSON.parse(readFileSync(browserConfig, 'utf8'));
    executablePath = path.resolve(resources, configuration.executable);
    if (!executablePath.startsWith(resources + path.sep) || !existsSync(executablePath)) throw new Error('BROWSER_BINARY_MISSING');
  }
  browser = cdpURL ? await chromium.connectOverCDP(cdpURL, { timeout: 20000 }) : undefined;
  context = browser?.contexts()[0] ?? await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1280, height: 800 } });
  page = context.pages()[0] || await context.newPage();
} catch (error) {
  // Startup diagnostics are closed codes: Playwright exceptions can contain
  // CDP credentials, process environment, or application page content.
  const code = cdpURL ? 'TARGET_CONNECTION_REQUIRED' : 'TARGET_SETUP_REQUIRED';
  const reason = error?.code === 'ERR_MODULE_NOT_FOUND' ? 'browser_dependency_missing' : cdpURL ? 'browser_connection_failed' : 'browser_launch_failed';
  process.stdout.write(JSON.stringify({ type: 'ready', protocol_version: 1, error: code, reason }) + '\n');
  if (!browser) await context?.close().catch(() => {});
  process.exit(1);
}


function response(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function screenshot() { return { mime: 'image/png', data: (await page.screenshot({ type: 'png' })).toString('base64') }; }
async function safetySignals() {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    const active = document.activeElement;
    const activeType = active instanceof HTMLInputElement ? active.type.toLowerCase() : '';
    const secret = activeType === 'password' || activeType === 'tel' && /otp|code|verification/u.test(active.getAttribute('autocomplete') || '');
    const captcha = /captcha|i am not a robot|verify you are human|challenge/u.test(text);
    const login = /sign in|log in|登录|登陆/u.test(text) || Boolean(document.querySelector('input[type="password"]'));
    const injection = /ignore (all )?(previous|prior) instructions|system message|developer message/u.test(text);
    return { secret, captcha, login, injection, activeType };
  });
}

response({ type: 'ready', protocol_version: 1, capabilities: ['observe', 'interaction'], execution_location: 'linux_headless_browser' });

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let req;
  try { req = JSON.parse(line); } catch { response({ error: 'invalid request json' }); continue; }
  try {
    const args = req.args || {};
    const signals = await safetySignals();
    if (req.tool_name !== 'computer.screenshot' && req.tool_name !== 'computer.wait' && req.tool_name !== 'browser.navigate' && (signals.secret || signals.captcha || signals.injection || signals.login && req.tool_name === 'computer.type')) {
      response({ id: req.id, target_id: req.target_id, error: 'TAKEOVER_REQUIRED', safety: signals });
      continue;
    }
    let summary = req.tool_name;
    if (req.tool_name === 'browser.navigate') { await page.goto(String(args.url), { waitUntil: 'domcontentloaded' }); summary = `navigated to ${page.url()}`; }
    else if (req.tool_name === 'browser.back') { await page.goBack({ waitUntil: 'domcontentloaded' }); summary = 'navigated back'; }
    else if (req.tool_name === 'browser.reload') { await page.reload({ waitUntil: 'domcontentloaded' }); summary = 'reloaded page'; }
    else if (req.tool_name === 'computer.click') { await page.mouse.click(Number(args.x), Number(args.y)); summary = `clicked (${args.x}, ${args.y})`; }
    else if (req.tool_name === 'computer.double_click') { await page.mouse.dblclick(Number(args.x), Number(args.y)); summary = `double clicked (${args.x}, ${args.y})`; }
    else if (req.tool_name === 'computer.type') { await page.keyboard.type(String(args.text)); summary = 'typed text'; }
    else if (req.tool_name === 'computer.key') {
      const rawKey = String(args.key);
      const keyAliases = { ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta', esc: 'Escape', return: 'Enter', del: 'Delete', spacebar: ' ' };
      const key = keyAliases[rawKey.toLowerCase()] || rawKey;
      await page.keyboard.press(key); summary = `pressed ${key}`;
    }
    else if (req.tool_name === 'computer.scroll') { await page.mouse.wheel(Number(args.delta_x || 0), Number(args.delta_y || 0)); summary = 'scrolled'; }
    else if (req.tool_name === 'computer.wait') { await page.waitForTimeout(Math.min(30000, Math.max(0, Number(args.milliseconds || 0)))); summary = 'waited for page'; }
    else if (req.tool_name !== 'computer.screenshot') throw new Error(`unsupported tool ${req.tool_name}`);
    response({ id: req.id, target_id: req.target_id, execution_location: 'linux_headless_browser', result: { summary, url: page.url(), title: await page.title() }, screenshot: await screenshot() });
  } catch (error) { response({ id: req.id, target_id: req.target_id, error: String(error?.message || error) }); }
}
if (!browser) await context.close();
