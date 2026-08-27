export type DesktopPlatform = 'macos' | 'linux' | 'windows';

export type DesktopPlatformCapabilities = Readonly<{
  platform: DesktopPlatform;
  native_local_environment: boolean;
  native_host_runtime: boolean;
  native_container_runtime: boolean;
  wsl_environment: boolean;
  desktop_auto_update: 'supported' | 'unsupported';
}>;

export function resolveDesktopPlatformCapabilities(
  platform: NodeJS.Platform,
): DesktopPlatformCapabilities {
  if (platform === 'win32') {
    return Object.freeze({
      platform: 'windows',
      native_local_environment: false,
      native_host_runtime: false,
      native_container_runtime: false,
      wsl_environment: true,
      desktop_auto_update: 'unsupported',
    });
  }
  return Object.freeze({
    platform: platform === 'darwin' ? 'macos' : 'linux',
    native_local_environment: true,
    native_host_runtime: true,
    native_container_runtime: true,
    wsl_environment: false,
    desktop_auto_update: platform === 'darwin' ? 'supported' : 'unsupported',
  });
}
