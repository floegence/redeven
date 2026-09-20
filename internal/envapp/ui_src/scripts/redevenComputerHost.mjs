import readline from 'node:readline';
import process from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { BrowserComputerController } from './computerBrowserController.mjs';

const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : undefined;
const cdpIndex = process.argv.indexOf('--cdp-url');
const cdpURL = cdpIndex >= 0 ? process.argv[cdpIndex + 1] : undefined;
const tabIndex = process.argv.indexOf('--tab-id');
const tabID = tabIndex >= 0 ? process.argv[tabIndex + 1] : undefined;
const contextIndex = process.argv.indexOf('--browser-context-id');
const browserContextID = contextIndex >= 0 ? process.argv[contextIndex + 1] : undefined;
const downloadIndex = process.argv.indexOf('--download-dir');
let downloadDirectory = downloadIndex >= 0 && process.argv.includes('--managed-attachment') ? process.argv[downloadIndex + 1] : undefined;
const executionLocation = cdpURL && !process.argv.includes('--managed-attachment') ? 'connected_browser' : `${process.platform}_headless_browser`;
let browser;
let context;
let page;
try {
  const { chromium } = await import('playwright');
  const resources = path.dirname(fileURLToPath(import.meta.url));
  const executableIndex = process.argv.indexOf('--browser-executable');
  const executablePath = executableIndex >= 0 ? process.argv[executableIndex + 1] : undefined;
  if (!cdpURL && !executablePath && existsSync(path.join(resources, 'manifest.json'))) throw new Error('BROWSER_INSTALLATION_REQUIRED');
  browser = cdpURL ? await chromium.connectOverCDP(cdpURL, { timeout: 20000, noDefaults: true }) : undefined;
  if (browser) {
    if (!tabID || !browserContextID) throw new Error('TAB_SELECTION_REQUIRED');
    for (const candidateContext of browser.contexts()) {
      for (const candidate of candidateContext.pages()) {
        const session = await candidateContext.newCDPSession(candidate);
        const { targetInfo } = await session.send('Target.getTargetInfo');
        await session.detach();
        if (targetInfo.targetId === tabID && (targetInfo.browserContextId || 'default') === browserContextID) {
          page = candidate; context = candidateContext; break;
        }
      }
      if (page) break;
    }
    if (!page) throw new Error('TAB_NOT_FOUND');
  } else {
    context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
  }
} catch (error) {
  // Startup diagnostics are closed codes: Playwright exceptions can contain
  // CDP credentials, process environment, or application page content.
  const code = cdpURL ? 'TARGET_CONNECTION_REQUIRED' : 'TARGET_SETUP_REQUIRED';
  const reason = error?.code === 'ERR_MODULE_NOT_FOUND' ? 'browser_dependency_missing' : cdpURL ? 'browser_connection_failed' : 'browser_launch_failed';
  process.stdout.write(JSON.stringify({ type: 'ready', protocol_version: 6, error: code, reason }) + '\n');
  if (!browser) await context?.close().catch(() => {});
  process.exit(1);
}


function response(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
const cdp = await context.newCDPSession(page);
if (!browser) {
  downloadDirectory = path.join(profile, 'downloads');
  await mkdir(downloadDirectory, { recursive: true, mode: 0o700 });
  const owner = await context.browser().newBrowserCDPSession();
  await owner.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDirectory, eventsEnabled: true });
}
if (downloadDirectory) {
  if (!path.isAbsolute(downloadDirectory)) throw new Error('INVALID_DOWNLOAD_DIRECTORY');
  cdp.resolveDownload = async id => {
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new Error('INVALID_DOWNLOAD');
    const file = path.join(downloadDirectory, id);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('INVALID_DOWNLOAD');
    return { path: file, size_bytes: stat.size };
  };
}
const frameSessions = new Map();
cdp.frameSessions = async () => {
  const sessions = [];
  // OOP frames must be queried through their own CDP session. Query them first
  // so their frame identity cannot be claimed by the parent session.
  for (const frame of [...page.frames()].reverse()) {
    if (frame === page.mainFrame()) continue;
    let session = frameSessions.get(frame);
    if (!session) {
      try { session = await context.newCDPSession(frame); frameSessions.set(frame, session); }
      catch { continue; } // In-process frames belong to the main session.
    }
    sessions.push(session);
  }
  sessions.push(cdp);
  return sessions;
};
const controller = new BrowserComputerController(cdp);
const semantic = controller.page;
await controller.initialize();
page.on('close', () => semantic.close());
page.on('framedetached', frame => { frameSessions.get(frame)?.detach().catch(() => {}); frameSessions.delete(frame); });
response({ type: 'ready', protocol_version: 6, capabilities: ['observe', 'interaction'], execution_location: executionLocation });
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('close', () => controller.cancel());
for await (const line of rl) {
  if (line.length > 262144) break;
  let request;
  try { request = JSON.parse(line); } catch { break; }
  const result = await controller.execute(request);
  response({ id: request.id, target_id: request.target_id, execution_location: executionLocation, ...result });
}
await semantic.releasePage();
if (browser) await browser.close();
else await context.close();
