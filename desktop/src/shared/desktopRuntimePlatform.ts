import type { DesktopPlatform } from './desktopPlatformCapabilities';

export type DesktopRuntimePlatform = DesktopPlatform;

export type DesktopRuntimePlatformFacts = Readonly<{
  runtime_platform: DesktopRuntimePlatform;
  runtime_linux_distribution?: string;
}>;
export type DesktopRuntimePlatformFactsMap = Readonly<Record<string, DesktopRuntimePlatformFacts>>;

export function normalizeDesktopRuntimePlatformFactsMap(value: unknown): DesktopRuntimePlatformFactsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (!key || !raw || typeof raw !== 'object') return [];
    const fact = raw as Record<string, unknown>;
    const runtime_platform = normalizeDesktopRuntimePlatform(fact.runtime_platform);
    return runtime_platform ? [[key, { runtime_platform,
      runtime_linux_distribution: normalizeDesktopRuntimeLinuxDistribution(fact.runtime_linux_distribution, runtime_platform),
    }]] : [];
  }));
}

/** Keep only a Linux Runtime's os-release ID; names and ID_LIKE are not identity. */
export function normalizeDesktopRuntimeLinuxDistribution(value: unknown, platform: unknown): string | undefined {
  if (normalizeDesktopRuntimePlatform(platform) !== 'linux' || typeof value !== 'string') return undefined;
  const id = value.trim().toLowerCase();
  return /^[a-z0-9._-]{1,64}$/u.test(id) ? id : undefined;
}

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
