import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDesktopPreloads } from './desktopPreloadBundle';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (!tempDir) continue;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

describe('buildDesktopPreloads', () => {
  it('produces self-contained browser and settings preload bundles', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preloads-'));
    tempDirs.push(outDir);

    await buildDesktopPreloads({
      desktopRoot: process.cwd(),
      outDir,
    });

    const browserOutput = await fs.readFile(path.join(outDir, 'browser.js'), 'utf8');
    const settingsOutput = await fs.readFile(path.join(outDir, 'settings.js'), 'utf8');

    expect(browserOutput).toContain('redevenDesktopAskFlowerHandoff');
    expect(browserOutput).toContain('redevenDesktopLauncher');
    expect(browserOutput).toContain('redevenDesktopSessionContext');
    expect(browserOutput).toContain('redevenDesktopSettings');
    expect(browserOutput).toContain('redevenDesktopShell');
    expect(browserOutput).toContain('redevenDesktopStateStorage');
    expect(browserOutput).not.toMatch(/require\((['"])\.\//);

    expect(settingsOutput).toContain('redevenDesktopSettings');
    expect(settingsOutput).not.toMatch(/require\((['"])\.\//);
  });
});
