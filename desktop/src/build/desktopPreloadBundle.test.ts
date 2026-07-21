import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDesktopPreloads } from './desktopPreloadBundle';

const tempDirs: string[] = [];

function bundledRequireSpecifiers(output: string): string[] {
  return Array.from(output.matchAll(/\brequire\((['"])([^'"]+)\1\)/g), (match) => match[2] ?? '');
}

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
    expect(utilityOutput).toContain('redevenDesktopDownloads');
    expect(utilityOutput).toContain('redevenDesktopStateStorage');
    expect(utilityOutput).toContain('redevenDesktopLanguage');
    expect(utilityOutput).not.toContain('redevenDesktopAskFlowerHandoff');
    expect(utilityOutput).not.toContain('redevenDesktopSessionContext');
    expect(utilityOutput).not.toContain('node:module');
    expect(utilityOutput).not.toContain('createRequire');
    expect(utilityOutput).not.toMatch(/require\((['"])\.\//);
    expect([...new Set(bundledRequireSpecifiers(utilityOutput))]).toEqual(['electron']);

    expect(sessionOutput).toContain('redevenDesktopEmbeddedDragRegions');
    expect(sessionOutput).toContain('redevenDesktopSessionContext');
    expect(sessionOutput).toContain('redevenDesktopShell');
    expect(sessionOutput).toContain('redevenDesktopDownloads');
    expect(sessionOutput).toContain('redevenDesktopCodeWorkspace');
    expect(sessionOutput).toContain('redevenDesktopStateStorage');
    expect(sessionOutput).toContain('redevenDesktopLanguage');
    expect(sessionOutput).toContain('redevenDesktopTheme');
    expect(sessionOutput).not.toContain('redevenDesktopAskFlowerHandoff');
    expect(sessionOutput).not.toContain('redevenDesktopLauncher');
    expect(sessionOutput).not.toContain('redevenDesktopSettings');
    expect(sessionOutput).not.toContain('node:module');
    expect(sessionOutput).not.toContain('createRequire');
    expect(sessionOutput).not.toMatch(/require\((['"])\.\//);
    expect([...new Set(bundledRequireSpecifiers(sessionOutput))]).toEqual(['electron']);
  });
});
