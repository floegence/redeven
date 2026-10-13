import { expect, it } from 'vitest';
import { normalizeDesktopRuntimeLinuxDistribution, normalizeDesktopRuntimePlatform } from './desktopRuntimePlatform';

it.each([
  ['Ubuntu', 'linux', 'ubuntu'], ['opensuse-tumbleweed', 'linux', 'opensuse-tumbleweed'],
  ['custom-linux', 'linux', 'custom-linux'], ['ubuntu', 'macos', undefined], ['debian', undefined, undefined],
  ['Ubuntu 24.04', 'linux', undefined], ['$(echo ubuntu)', 'linux', undefined], [42, 'linux', undefined],
])('normalizes only a Linux Runtime distribution ID %s on %s', (id, platform, expected) => {
  expect(normalizeDesktopRuntimeLinuxDistribution(id, platform)).toBe(expected);
});

it.each([
  ['darwin', 'macos'], ['mac', 'macos'], ['macos', 'macos'], ['osx', 'macos'],
  ['linux', 'linux'], ['wsl', 'linux'], ['win32', 'windows'], ['windows', 'windows'], ['win', 'windows'],
  ['  DARWIN ', 'macos'],
] as const)('normalizes reported OS %s to %s', (raw, expected) => {
  expect(normalizeDesktopRuntimePlatform(raw)).toBe(expected);
});
it.each([undefined, null, '', 'unknown', 'freebsd', 'linux/arm64', 'Ubuntu', 32, ['linux'], { toString: () => 'linux' }])(
  'discards unrecognized or non-string OS facts %#', raw => {
    expect(normalizeDesktopRuntimePlatform(raw)).toBeUndefined();
  },
);
