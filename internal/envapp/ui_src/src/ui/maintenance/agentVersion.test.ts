import { describe, expect, it } from 'vitest';

import { compareReleaseVersionCore, isReleaseVersion, resolvePreferredTargetVersion } from './agentVersion';

describe('agentVersion helpers', () => {
  it('accepts release tags with optional prerelease and build metadata', () => {
    expect(isReleaseVersion('v1.2.3')).toBe(true);
    expect(isReleaseVersion('v1.2.3-rc.1+build.7')).toBe(true);
    expect(isReleaseVersion('1.2.3')).toBe(false);
  });

  it('compares semver core only', () => {
    expect(compareReleaseVersionCore('v1.2.3', 'v1.2.4')).toBe(-1);
    expect(compareReleaseVersionCore('v1.2.3-rc.1', 'v1.2.3')).toBe(0);
    expect(compareReleaseVersionCore('v2.0.0', 'v1.9.9')).toBe(1);
  });

  it('prefers recommended_version before latest_version', () => {
    expect(resolvePreferredTargetVersion({ latest_version: 'v1.4.0', recommended_version: 'v1.3.9' })).toBe('v1.3.9');
    expect(resolvePreferredTargetVersion({ latest_version: 'v1.4.0', recommended_version: 'main' })).toBe('v1.4.0');
    expect(resolvePreferredTargetVersion({ latest_version: 'v1.4.0' })).toBe('v1.4.0');
    expect(resolvePreferredTargetVersion(null)).toBe('');
  });
});
