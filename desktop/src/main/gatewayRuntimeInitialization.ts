import type { GatewayRuntimeArtifactPolicy } from './gatewayClient';

export type GatewayRuntimeArtifactPlan = Readonly<{
  artifact_policy: GatewayRuntimeArtifactPolicy;
  build_inputs?: Readonly<{
    architecture: string;
    commit: string;
    platform: string;
    source: 'desktop_source_build';
    version: string;
  }>;
}>;

export function selectGatewayRuntimeArtifactPlan(input: Readonly<{
  artifactPolicies: readonly GatewayRuntimeArtifactPolicy[];
  sourceBuildAvailable: boolean;
  sourceCommit: string;
  desiredVersion: string;
  platform: string;
  architecture: string;
}>): GatewayRuntimeArtifactPlan {
  if (input.sourceBuildAvailable && input.artifactPolicies.includes('custom_build')) {
    return {
      artifact_policy: 'custom_build',
      build_inputs: {
        architecture: input.architecture,
        commit: input.sourceCommit,
        platform: input.platform,
        source: 'desktop_source_build',
        version: input.desiredVersion,
      },
    };
  }
  if (input.artifactPolicies.includes('published_release')) {
    return { artifact_policy: 'published_release' };
  }
  throw new Error('This environment does not expose an authorized Runtime artifact policy.');
}
