import { chromium } from 'playwright';

// This inventory is user-visible connection management, never a model tool.
// Closing a CDP connection must leave the user's browser and tabs running.
try {
  const endpoint = process.argv[2];
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15000, noDefaults: true });
  try {
    const tabs = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const session = await context.newCDPSession(page);
        try {
          const { targetInfo } = await session.send('Target.getTargetInfo');
          if (targetInfo.type !== 'page') continue;
          tabs.push({ id: targetInfo.targetId, profile_id: targetInfo.browserContextId || 'default', title: (await page.title()).slice(0, 512), url: page.url() });
        } finally { await session.detach(); }
        if (tabs.length >= 128) throw new Error('INVENTORY_LIMIT');
      }
    }
    process.stdout.write(JSON.stringify({ protocol_version: 2, tabs }) + '\n');
  } finally { await browser.close(); }
} catch {
  process.stdout.write(JSON.stringify({ protocol_version: 2, error: 'TARGET_CONNECTION_REQUIRED' }) + '\n');
  process.exitCode = 1;
}
