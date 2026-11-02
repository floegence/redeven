import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDesktopMain } from './build-main.mjs';

test('published themes, CSS and cache execute from a relocated bundle without packages or network', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redeven-offline-main-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../src/main', import.meta.url));
  const entry = path.join(root, 'fixture.ts');
  writeFileSync(entry, `
    import { DesktopResourceCache } from ${JSON.stringify(path.join(source, 'desktopResourceCache.ts'))};
    import { sessionRestartDocumentURL } from ${JSON.stringify(path.join(source, 'sessionRestartDocument.ts'))};
    import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from ${JSON.stringify(path.join(source, 'desktopTheme.ts'))};
    export async function verify(directory) {
      const cache = new DesktopResourceCache(directory, 10);
      await cache.set('one', 'old', '123456');
      await cache.set('two', 'new', '123456');
      if (await cache.get('one', 'old') !== null || await cache.get('two', 'new') !== '123456') throw new Error('Cache budget failed');
      const theme = { source: 'dark', resolvedTheme: 'dark', activeShellTheme: 'forest', shellThemes: { version: 1, light: 'mist', dark: 'forest' }, window: desktopWindowThemeSnapshotForShellTheme('forest'), semantic: desktopSemanticPaletteForShellTheme('forest') };
      const html = decodeURIComponent(sessionRestartDocumentURL({ label: 'Offline', stage: 'restarting', locale: 'en-US', theme }).split(',')[1]);
      if (!html.includes('floe-window-status') || !html.includes('background: var(--background)')) throw new Error('Published offline styles missing');
    }
  `);
  const outfile = path.join(root, 'standalone.cjs');
  const result = await buildDesktopMain({ entryPoint: entry, outfile, report: false });
  assert.ok(!Object.values(result.metafile.outputs).flatMap(output => output.imports).some(item => item.path.startsWith('@floegence/floe-webapp-core')));
  const relocated = path.join(root, 'relocated.cjs');
  renameSync(outfile, relocated);
  execFileSync(process.execPath, ['--no-global-search-paths', '-e', `
    const fail = () => { throw new Error('Network access forbidden in offline fixture'); };
    require('node:net').Socket.prototype.connect = fail;
    global.fetch = fail;
    require(process.argv[1]).verify(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
  `, relocated, path.join(root, 'state')], { cwd: root, env: { PATH: '/usr/bin:/bin', HOME: root, NODE_PATH: '' }, timeout: 15000 });
});
