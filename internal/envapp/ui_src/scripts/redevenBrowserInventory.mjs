import { chromium } from 'playwright';

// Endpoints are supplied by authenticated connection management. Model discovery
// uses only endpoints already connected by the Runtime. Detach leaves user tabs open.
try {
  const [endpoint, command = 'inventory', profile] = process.argv.slice(2);
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000, noDefaults: true });
  try {
    const session = await browser.newBrowserCDPSession();
    let { targetInfos } = await session.send('Target.getTargets');
    if (command === 'new_tab') {
      if (targetInfos.filter(target => target.type === 'page').length >= 128) throw new Error('INVENTORY_LIMIT');
      if (!profile || !targetInfos.some(target => target.type === 'page' && (target.browserContextId || 'default') === profile)) throw new Error('PROFILE_UNAVAILABLE');
      const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', background: true, ...(profile === 'default' ? {} : { browserContextId: profile }) });
      const { targetInfo } = await session.send('Target.getTargetInfo', { targetId });
      targetInfos = [targetInfo];
    } else if (command !== 'inventory') throw new Error('INVALID_COMMAND');
    const tabs = targetInfos.filter(target => target.type === 'page').map(tab => ({
      id: tab.targetId, profile_id: tab.browserContextId || 'default', title: tab.title.slice(0, 512), url: tab.url,
      ...(tab.openerId ? { opener_tab_id: tab.openerId } : {}),
    }));
    if (tabs.length > 128) throw new Error('INVENTORY_LIMIT');
    process.stdout.write(JSON.stringify({ protocol_version: 2, tabs }) + '\n');
  } finally { await browser.close(); }
} catch {
  process.stdout.write(JSON.stringify({ protocol_version: 2, error: 'TARGET_CONNECTION_REQUIRED' }) + '\n');
  process.exitCode = 1;
}
