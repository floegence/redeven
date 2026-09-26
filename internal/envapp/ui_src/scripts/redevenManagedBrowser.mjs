import process from 'node:process';
import path from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import readline from 'node:readline';

const profile = process.argv[2];
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let context;
try {
  const { chromium } = await import('playwright');
  if (!path.isAbsolute(profile)) throw new Error('invalid profile');
  const executablePath = process.argv[3];
  if (!executablePath || !path.isAbsolute(executablePath)) throw new Error('browser installation required');
  context = await chromium.launchPersistentContext(profile, { executablePath, chromiumSandbox: true, headless: true, viewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'] });
  // This launcher owns the process, not page decisions. A listener disables
  // Playwright's default auto-dismiss; the source host owns every dialog reply.
  context.on('dialog', () => {});
  const [port] = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
  if (!/^\d+$/u.test(port)) throw new Error('invalid endpoint');
  const session = await context.browser().newBrowserCDPSession();
  const downloads = path.join(profile, 'downloads');
  mkdirSync(downloads, { recursive: true, mode: 0o700 });
  // This process owns the entire managed profile. Files have opaque unique
  // names and survive browser shutdown; user Chrome download policy is untouched.
  await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
  emit({ type: 'ready', protocol_version: 2, endpoint: `http://127.0.0.1:${port}` });
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (line.length > 8192) break;
    const message = JSON.parse(line);
    try {
      const { targetInfos } = await session.send('Target.getTargets');
      const tabs = targetInfos.filter(target => target.type === 'page');
      if (message.command === 'inventory') emit({ id: message.id, tabs: tabs.map(tab => ({ id: tab.targetId, profile_id: tab.browserContextId || 'default', title: tab.title.slice(0, 512), url: tab.url, ...(tab.openerId ? { opener_tab_id: tab.openerId } : {}) })) });
      else if (message.command === 'new_tab') {
        if (tabs.length >= 128) throw new Error('tab limit');
        const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', background: true });
        const { targetInfo } = await session.send('Target.getTargetInfo', { targetId });
        emit({ id: message.id, tab: { id: targetId, profile_id: targetInfo.browserContextId || 'default', title: '', url: 'about:blank' } });
      } else throw new Error('invalid command');
    } catch {
      const disconnected = !context.browser().isConnected();
      emit({ id: message.id, error: disconnected ? 'MANAGED_BROWSER_DISCONNECTED' : 'MANAGED_BROWSER_COMMAND_FAILED' });
      if (disconnected) break;
    }
  }
} catch (error) { emit({ type: 'ready', protocol_version: 2, error: 'TARGET_SETUP_REQUIRED', reason: error?.code === 'ERR_MODULE_NOT_FOUND' ? 'browser_dependency_missing' : 'browser_launch_failed' }); process.exitCode = 1; }
finally { await context?.close(); }
