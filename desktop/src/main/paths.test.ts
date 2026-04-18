import { describe, expect, it } from 'vitest';

import {
  bundledRuntimeExecutableName,
  resolveBundledRuntimePath,
  resolveSessionPreloadPath,
  resolveUtilityPreloadPath,
  resolveWelcomeRendererPath,
} from './paths';

describe('paths', () => {
  it('uses the packaged resources directory when the desktop app is bundled', () => {
    expect(resolveBundledRuntimePath({
      isPackaged: true,
      resourcesPath: '/Applications/Redeven Desktop.app/Contents/Resources',
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
      platform: 'darwin',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/bin/redeven');
  });

  it('uses the prepared desktop bundle during local development', () => {
    expect(resolveBundledRuntimePath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop',
      existsSync: (candidate) => candidate === '/repo/desktop/.bundle/linux-amd64/redeven',
      platform: 'linux',
      arch: 'x64',
    })).toBe('/repo/desktop/.bundle/linux-amd64/redeven');
  });

  it('falls back to the parent desktop workspace bundle when appPath points to a nested build directory', () => {
    expect(resolveBundledRuntimePath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop/dist',
      existsSync: (candidate) => candidate === '/repo/desktop/.bundle/linux-amd64/redeven',
      platform: 'linux',
      arch: 'x64',
    })).toBe('/repo/desktop/.bundle/linux-amd64/redeven');
  });

  it('uses a platform-specific executable name', () => {
    expect(bundledRuntimeExecutableName('linux')).toBe('redeven');
    expect(bundledRuntimeExecutableName('win32')).toBe('redeven.exe');
  });

  it('resolves the bundled utility preload script path', () => {
    expect(resolveUtilityPreloadPath({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/app.asar/dist/preload/utility.js');
  });

  it('resolves the bundled session preload script path', () => {
    expect(resolveSessionPreloadPath({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/app.asar/dist/preload/session.js');
  });

  it('resolves the bundled welcome renderer path', () => {
    expect(resolveWelcomeRendererPath({
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/app.asar/dist/welcome/index.html');
  });
});
