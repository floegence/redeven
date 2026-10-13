import { expect, it } from 'vitest';
import { normalizeDesktopRuntimePlatform } from './desktopRuntimePlatform';

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
