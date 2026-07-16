import { describe, expect, it } from 'vitest';

import { resolveEnvAppPluginUIEnabled } from './envAppBuildFeatures';

describe('Env App build features', () => {
  it('enables Plugin UI for the Vite development server', () => {
    expect(resolveEnvAppPluginUIEnabled('serve', undefined)).toBe(true);
    expect(resolveEnvAppPluginUIEnabled('serve', '0')).toBe(true);
  });

  it('enables Plugin UI for an explicitly marked development build', () => {
    expect(resolveEnvAppPluginUIEnabled('build', '1')).toBe(true);
  });

  it('keeps ordinary builds fail-closed', () => {
    expect(resolveEnvAppPluginUIEnabled('build', undefined)).toBe(false);
    expect(resolveEnvAppPluginUIEnabled('build', '')).toBe(false);
  });

  it.each(['0', 'true', 'yes', ' 1', '1 '])('rejects non-canonical build flag value %j', (value) => {
    expect(resolveEnvAppPluginUIEnabled('build', value)).toBe(false);
  });
});
