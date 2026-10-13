import type { DesktopPlatform } from './desktopPlatformCapabilities';

export type DesktopRuntimePlatform = DesktopPlatform;

/** Normalize an OS reported by a Runtime into the small set used by Desktop UI. */
export function normalizeDesktopRuntimePlatform(value: unknown): DesktopRuntimePlatform | undefined {
  if (typeof value !== 'string') return undefined;
  const platform = value.trim().toLowerCase();
  switch (platform) {
    case 'darwin':
    case 'mac':
    case 'macos':
    case 'osx':
      return 'macos';
    case 'linux':
    case 'wsl':
      return 'linux';
    case 'win32':
    case 'windows':
    case 'win':
      return 'windows';
    default:
      return undefined;
  }
}
