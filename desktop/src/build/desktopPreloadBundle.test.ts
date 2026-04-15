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
  it('produces self-contained utility and session preload bundles', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-desktop-preloads-'));
    tempDirs.push(outDir);

    await buildDesktopPreloads({
      desktopRoot: process.cwd(),
      outDir,
    });

    const utilityOutput = await fs.readFile(path.join(outDir, 'utility.js'), 'utf8');
    const sessionOutput = await fs.readFile(path.join(outDir, 'session.js'), 'utf8');

    expect(utilityOutput).toContain('redevenDesktopLauncher');
    expect(utilityOutput).toContain('redevenDesktopSettings');
    expect(utilityOutput).toContain('redevenDesktopShell');
    expect(utilityOutput).toContain('redevenDesktopStateStorage');
    expect(utilityOutput).not.toContain('redevenDesktopAskFlowerHandoff');
    expect(utilityOutput).not.toContain('redevenDesktopSessionContext');
    expect(utilityOutput).not.toMatch(/require\((['"])\.\//);

    expect(sessionOutput).toContain('redevenDesktopAskFlowerHandoff');
    expect(sessionOutput).toContain('redevenDesktopSessionContext');
    expect(sessionOutput).toContain('redevenDesktopShell');
    expect(sessionOutput).toContain('redevenDesktopStateStorage');
    expect(sessionOutput).not.toContain('redevenDesktopLauncher');
    expect(sessionOutput).not.toContain('redevenDesktopSettings');
    expect(sessionOutput).not.toMatch(/require\((['"])\.\//);
  });
});
