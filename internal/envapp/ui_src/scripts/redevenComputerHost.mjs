import readline from 'node:readline';
import process from 'node:process';
import { chromium } from 'playwright';

const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 } });
let page = context.pages()[0] || await context.newPage();

function response(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function screenshot() { return { mime: 'image/png', data: (await page.screenshot({ type: 'png' })).toString('base64') }; }

response({ type: 'ready', protocol_version: 1, capabilities: ['observe', 'interaction'], execution_location: 'linux_headless_browser' });

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let req;
  try { req = JSON.parse(line); } catch { response({ error: 'invalid request json' }); continue; }
  try {
    const args = req.args || {};
    let summary = req.tool_name;
    if (req.tool_name === 'browser.navigate') { await page.goto(String(args.url), { waitUntil: 'domcontentloaded' }); summary = `navigated to ${page.url()}`; }
    else if (req.tool_name === 'browser.back') { await page.goBack({ waitUntil: 'domcontentloaded' }); summary = 'navigated back'; }
    else if (req.tool_name === 'browser.reload') { await page.reload({ waitUntil: 'domcontentloaded' }); summary = 'reloaded page'; }
    else if (req.tool_name === 'computer.click') { await page.mouse.click(Number(args.x), Number(args.y)); summary = `clicked (${args.x}, ${args.y})`; }
    else if (req.tool_name === 'computer.double_click') { await page.mouse.dblclick(Number(args.x), Number(args.y)); summary = `double clicked (${args.x}, ${args.y})`; }
    else if (req.tool_name === 'computer.type') { await page.keyboard.type(String(args.text)); summary = 'typed text'; }
    else if (req.tool_name === 'computer.key') { await page.keyboard.press(String(args.key)); summary = `pressed ${args.key}`; }
    else if (req.tool_name === 'computer.scroll') { await page.mouse.wheel(Number(args.delta_x || 0), Number(args.delta_y || 0)); summary = 'scrolled'; }
    else if (req.tool_name === 'computer.wait') { await page.waitForTimeout(Math.min(30000, Math.max(0, Number(args.milliseconds || 0)))); summary = 'waited for page'; }
    else if (req.tool_name !== 'computer.screenshot') throw new Error(`unsupported tool ${req.tool_name}`);
    response({ id: req.id, target_id: req.target_id, execution_location: 'linux_headless_browser', result: { summary, url: page.url(), title: await page.title() }, screenshot: await screenshot() });
  } catch (error) { response({ id: req.id, target_id: req.target_id, error: String(error?.message || error) }); }
}
await context.close();
