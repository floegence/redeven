import { describe, expect, it } from 'vitest';

import {
  bundledAgentExecutableName,
  resolveBrowserPreloadPath,
  resolveBundledAgentPath,
  resolveSettingsPreloadPath,
} from './paths';

describe('paths', () => {
  it('uses the packaged resources directory when the desktop app is bundled', () => {
    expect(resolveBundledAgentPath({
      isPackaged: true,
      resourcesPath: '/Applications/Redeven Desktop.app/Contents/Resources',
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
      platform: 'darwin',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/bin/redeven');
  });

  it('uses the prepared desktop bundle during local development', () => {
    expect(resolveBundledAgentPath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop',
      existsSync: (candidate) => candidate === '/repo/desktop/.bundle/linux-amd64/redeven',
      platform: 'linux',
      arch: 'x64',
    })).toBe('/repo/desktop/.bundle/linux-amd64/redeven');
  });

  it('falls back to the parent desktop workspace bundle when appPath points to a nested build directory', () => {
    expect(resolveBundledAgentPath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop/dist',
      existsSync: (candidate) => candidate === '/repo/desktop/.bundle/linux-amd64/redeven',
      platform: 'linux',
      arch: 'x64',
    })).toBe('/repo/desktop/.bundle/linux-amd64/redeven');
  });

  it('uses a platform-specific executable name', () => {
    expect(bundledAgentExecutableName('linux')).toBe('redeven');
    expect(bundledAgentExecutableName('win32')).toBe('redeven.exe');
  });

  it('resolves the bundled settings preload script path', () => {
    expect(resolveSettingsPreloadPath({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/app.asar/dist/preload/settings.js');
  });

  it('resolves the bundled browser preload script path', () => {
    expect(resolveBrowserPreloadPath({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/app.asar/dist/preload/browser.js');
  });
});
