import { describe, expect, it } from 'vitest';

import { bundledAgentExecutableName, resolveBundledAgentPath, resolveSettingsPreloadPath } from './paths';

describe('paths', () => {
  it('uses the packaged resources directory when the desktop app is bundled', () => {
    expect(resolveBundledAgentPath({
      isPackaged: true,
      resourcesPath: '/Applications/Redeven Desktop.app/Contents/Resources',
      appPath: '/Applications/Redeven Desktop.app/Contents/Resources/app.asar',
      platform: 'darwin',
    })).toBe('/Applications/Redeven Desktop.app/Contents/Resources/bin/redeven');
  });

  it('prefers the explicit development override', () => {
    expect(resolveBundledAgentPath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop',
      env: { REDEVEN_DESKTOP_AGENT_BINARY: '/tmp/redeven-dev' },
      existsSync: () => false,
      platform: 'linux',
    })).toBe('/tmp/redeven-dev');
  });

  it('falls back to the sibling repo binary during local development', () => {
    expect(resolveBundledAgentPath({
      isPackaged: false,
      resourcesPath: '/tmp/resources',
      appPath: '/repo/desktop',
      existsSync: (candidate) => candidate === '/repo/redeven',
      platform: 'linux',
    })).toBe('/repo/redeven');
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
});
