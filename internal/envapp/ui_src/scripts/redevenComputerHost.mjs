/* global document */

import readline from 'node:readline';
import process from 'node:process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
const cdpIndex = process.argv.indexOf('--cdp-url');
const cdpURL = cdpIndex >= 0 ? process.argv[cdpIndex + 1] : undefined;
const executionLocation = cdpURL ? 'connected_browser' : `${process.platform}_headless_browser`;
let browser;
let context;
let page;
let userInControl = false;
let controlSession = '';
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
async function safetyDecision() {
  // Inspect each frame in its own origin. Return only closed reason codes;
  // page content and field values never cross the helper boundary.
  const reasons = new Set();
  for (const frame of page.frames()) {
    try {
      const found = await frame.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        const inputs = [...document.querySelectorAll('input')].filter((input) => input.getClientRects().length > 0);
        const reasons = [];
        if (inputs.some((input) => input.type === 'password')) reasons.push('login', 'secret_input');
        if (inputs.some((input) => (input.autocomplete || '').split(/\s+/u).includes('one-time-code'))) reasons.push('otp', 'secret_input');
        if (/captcha|i am not a robot|verify you are human/u.test(text)) reasons.push('captcha');
        if (/ignore (all )?(previous|prior) instructions|system message|developer message/u.test(text)) reasons.push('prompt_injection');
        return reasons;
      });
      for (const reason of found) reasons.add(reason);
    } catch {
      // A detached or inaccessible frame is not evidence that capture is safe.
      reasons.add('unknown');
    }
  }
  return { level: reasons.size ? 'takeover' : 'routine', reason_codes: [...reasons], safe_to_capture: reasons.size === 0, safe_to_send_to_model: reasons.size === 0 };
}
function pauseForUser(req, safety, actionExecuted) {
 userInControl = true;
  response({ id: req.id, target_id: req.target_id, execution_location: executionLocation,
    result: { code: 'TAKEOVER_REQUIRED', action_executed: actionExecuted }, safety });
}

response({ type: 'ready', protocol_version: 1, capabilities: ['observe', 'interaction'], execution_location: executionLocation });

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let req;
  try { req = JSON.parse(line); } catch { response({ error: 'invalid request json' }); continue; }
  try {
    const args = req.args || {};

    // The Runtime has already admitted this canonical turn to the target's
    // exclusive lease. A new turn must not inherit an abandoned private page.
    // Keep connected user tabs untouched; only the managed context owns pages.
    const session = typeof req.session_id === 'string' ? req.session_id : '';
    if (session && controlSession && session !== controlSession && userInControl && !cdpURL) {
      const nextPage = await context.newPage();
      await page.close({ runBeforeUnload: false });
      page = nextPage;
      userInControl = false;
    }
    if (session) controlSession = session;

    const userInput = req.user_control === true;
    if (userInput) {
      if (!['computer.screenshot', 'computer.click', 'computer.key', 'computer.type', 'computer.scroll'].includes(req.tool_name)) {
        response({ id: req.id, target_id: req.target_id, error: 'TARGET_NOT_ALLOWED' });
        continue;
      }
      userInControl = true;
    } else {
      if (userInControl && req.return_control !== true) {
        pauseForUser(req, { level: 'takeover', reason_codes: ['user_control'], safe_to_capture: false, safe_to_send_to_model: false }, false);
        continue;
      }
      if (req.return_control === true && req.tool_name !== 'computer.screenshot') {
        response({ id: req.id, target_id: req.target_id, error: 'TARGET_NOT_ALLOWED' });
        continue;
      }
      const before = await safetyDecision();
      if (before.level === 'takeover') { pauseForUser(req, before, false); continue; }
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
    else if (req.tool_name === 'computer.drag') { const x1=Number(args.from_x), y1=Number(args.from_y), x2=Number(args.to_x), y2=Number(args.to_y); await page.mouse.move(x1,y1); await page.mouse.down(); await page.mouse.move(x2,y2,{steps:Math.max(1,Math.round(Number(args.duration_ms||0)/16))}); await page.mouse.up(); summary='dragged'; }
    else if (req.tool_name === 'computer.scroll') { await page.mouse.wheel(Number(args.delta_x || 0), Number(args.delta_y || 0)); summary = 'scrolled'; }
    else if (req.tool_name === 'computer.wait') { await page.waitForTimeout(Math.min(30000, Math.max(0, Number(args.milliseconds || 0)))); summary = 'waited for page'; }
    else if (req.tool_name !== 'computer.screenshot') throw new Error(`unsupported tool ${req.tool_name}`);
    if (userInput) {
      response({ id: req.id, target_id: req.target_id, execution_location: executionLocation, screenshot: await screenshot() });
      continue;
    }
    const executed = req.tool_name !== 'computer.screenshot';
    const after = await safetyDecision();
    if (after.level === 'takeover') {
      pauseForUser(req, after, executed);
      continue;
    }
    const frame = await screenshot();
    // Recheck after capture as navigation or page scripts may change the UI
    // during screenshot decoding. Discard the bytes if safety changed.
    const captured = await safetyDecision();
    if (captured.level === 'takeover') {
      pauseForUser(req, captured, executed);
      continue;
    }
    if (req.return_control === true) userInControl = false;
    response({ id: req.id, target_id: req.target_id, execution_location: executionLocation, result: { summary, url: page.url(), title: await page.title(), action_executed: executed }, safety: captured, screenshot: frame });
  } catch {
    const code = page.isClosed() ? (cdpURL ? 'TARGET_CONNECTION_REQUIRED' : 'TARGET_NOT_READY') : 'TARGET_ACTION_FAILED';
    response({ id: req.id, target_id: req.target_id, error: code });
  }
}
if (!browser) await context.close();
