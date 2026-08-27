import { describe, expect, it } from 'vitest';

import { resolveDesktopPlatformCapabilities } from './desktopPlatformCapabilities';

describe('resolveDesktopPlatformCapabilities', () => {
  it('exposes only Desktop and WSL Environment support on Windows', () => {
    expect(resolveDesktopPlatformCapabilities('win32')).toEqual({
      platform: 'windows',
      native_local_environment: false,
      native_host_runtime: false,
      native_container_runtime: false,
      wsl_environment: true,
      desktop_auto_update: 'unsupported',
    });
  });

  it('keeps native runtime capabilities on existing platforms', () => {
    expect(resolveDesktopPlatformCapabilities('darwin')).toMatchObject({
      platform: 'macos',
      native_local_environment: true,
      native_host_runtime: true,
      native_container_runtime: true,
      wsl_environment: false,
    });
    expect(resolveDesktopPlatformCapabilities('linux')).toMatchObject({
      platform: 'linux',
      native_local_environment: true,
      native_host_runtime: true,
      native_container_runtime: true,
      wsl_environment: false,
    });
  });
});
