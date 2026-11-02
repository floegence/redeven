import process from 'node:process';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import readline from 'node:readline';

const profile = process.argv[2];
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let browser;
let session;
const downloads = new Set();
function classifyManagedBrowserLaunch(error) {
  const message = String(error?.message ?? '');
  if (error?.code === 'ERR_MODULE_NOT_FOUND' || /error while loading shared libraries|Host system is missing dependencies|cannot open shared object file/u.test(message)) return 'browser_dependency_missing';
  if (/No usable sandbox|Failed to move to new namespace|SUID sandbox helper|Running as root without --no-sandbox/u.test(message)) return 'browser_sandbox_unavailable';
  return 'browser_launch_failed';
}
try {
  const { chromium } = await import('playwright');
  if (!path.isAbsolute(profile)) throw new Error('invalid profile');
  const endpoint = process.argv[3];
  const address = new URL(endpoint);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port) throw new Error('invalid endpoint');
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000, noDefaults: true });
  // Decisions belong to the admitted source, including dialog replies.
  browser.contexts()[0].on('dialog', () => {});
  session = await browser.newBrowserCDPSession();
  session.on('Browser.downloadWillBegin', event => downloads.add(event.guid));
  session.on('Browser.downloadProgress', event => { if (event.state !== 'inProgress') downloads.delete(event.guid); });
  const downloadPath = path.join(profile, 'downloads');
  mkdirSync(downloadPath, { recursive: true, mode: 0o700 });
  // The Go Runtime owns the entire managed profile. Files have opaque unique
  // names and survive browser shutdown; user Chrome download policy is untouched.
  await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath, eventsEnabled: true });
  emit({ type: 'ready', protocol_version: 2, endpoint });
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (line.length > 8192) break;
    const message = JSON.parse(line);
    try {
      const { targetInfos } = await session.send('Target.getTargets');
      const tabs = targetInfos.filter(target => target.type === 'page');
      if (message.command === 'idle_status') emit({ id: message.id, idle: tabs.length === 0 && downloads.size === 0, tabs: [] });
      else if (message.command === 'inventory') emit({ id: message.id, tabs: tabs.map(tab => ({ id: tab.targetId, profile_id: tab.browserContextId || 'default', title: tab.title.slice(0, 512), url: tab.url, ...(tab.openerId ? { opener_tab_id: tab.openerId } : {}) })) });
      else if (message.command === 'new_tab') {
        if (tabs.length >= 128) throw new Error('tab limit');
        const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', background: true });
        const { targetInfo } = await session.send('Target.getTargetInfo', { targetId });
        emit({ id: message.id, tab: { id: targetId, profile_id: targetInfo.browserContextId || 'default', title: '', url: 'about:blank' } });
      } else throw new Error('invalid command');
    } catch {
      const disconnected = !browser.isConnected();
      emit({ id: message.id, error: disconnected ? 'MANAGED_BROWSER_DISCONNECTED' : 'MANAGED_BROWSER_COMMAND_FAILED' });
      if (disconnected) break;
    }
  }
} catch (error) { emit({ type: 'ready', protocol_version: 2, error: 'TARGET_SETUP_REQUIRED', reason: classifyManagedBrowserLaunch(error) }); process.exitCode = 1; }
finally {
  // Only this Go-owned browser is closed; personal browser adapters only detach.
  if (session && browser?.isConnected()) await session.send('Browser.close').catch(() => {});
  await browser?.close();
}
