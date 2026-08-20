import { describe, expect, it } from 'vitest';

import { selectGatewayRuntimeArtifactPlan } from './gatewayRuntimeInitialization';

describe('Gateway Runtime artifact planning', () => {
  it('selects a bound custom build for source Desktop lifecycle updates', () => {
    expect(selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['published_release', 'custom_build'],
      sourceBuildAvailable: true,
      sourceCommit: 'abc123',
      desiredVersion: 'v0.0.0-dev',
      platform: 'darwin',
      architecture: 'arm64',
    })).toEqual({
      artifact_policy: 'custom_build',
      build_inputs: {
        architecture: 'arm64',
        commit: 'abc123',
        platform: 'darwin',
        source: 'desktop_source_build',
        version: 'v0.0.0-dev',
      },
    });
  });

  it('uses a published release only when a source build is unavailable', () => {
    expect(selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['published_release', 'custom_build'],
      sourceBuildAvailable: false,
      sourceCommit: 'abc123',
      desiredVersion: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
    })).toEqual({ artifact_policy: 'published_release' });
  });

  it('rejects lifecycle updates without an authorized artifact policy', () => {
    expect(() => selectGatewayRuntimeArtifactPlan({
      artifactPolicies: ['custom_build'],
      sourceBuildAvailable: false,
      sourceCommit: 'abc123',
      desiredVersion: 'v1.2.3',
      platform: 'linux',
      architecture: 'amd64',
    })).toThrow('does not expose an authorized Runtime artifact policy');
  });

});
