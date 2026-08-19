import type {
  GatewayRuntimeArtifactPolicy,
  GatewayRuntimeArtifactMetadata,
  GatewayRuntimeOperation,
  GatewayRuntimeOperationPrepareRequest,
  GatewayRuntimeOperationPrepareResponse,
} from './gatewayClient';
import {
  advanceGatewayRuntimeOperation,
  type RuntimeLifecyclePreparedArtifact,
} from './runtimeLifecycleCompletion';

type RuntimeInitializationCapability = Readonly<{
  target: Readonly<{
    lifecycle_target_id: string;
    target_generation: number;
  }>;
  compatibility: Readonly<{
    runtime_platform: 'linux' | 'darwin';
    runtime_architecture: 'amd64' | 'arm64';
    compatibility_epoch: number;
  }>;
  operations: readonly ('start' | 'stop' | 'restart' | 'update_runtime' | 'reconcile')[];
  artifact_policies: readonly ('published_release' | 'custom_build')[];
}>;

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

export type GatewayRuntimeInitializationInput = Readonly<{
  operationID: string;
  authorizedClientKeyID: string;
  gatewayEnvironmentID: string;
  desiredVersion: string;
  sourceCommit: string;
  sourceBuildAvailable: boolean;
  capability: RuntimeInitializationCapability;
  prepare: (request: GatewayRuntimeOperationPrepareRequest) => Promise<GatewayRuntimeOperationPrepareResponse>;
  confirm: (operation: GatewayRuntimeOperation) => Promise<GatewayRuntimeOperation>;
  prepareArtifact: (operation: GatewayRuntimeOperation) => Promise<RuntimeLifecyclePreparedArtifact>;
  upload: (
    metadata: GatewayRuntimeArtifactMetadata,
    artifact: Buffer,
  ) => Promise<GatewayRuntimeOperation>;
  commit: () => Promise<GatewayRuntimeOperation>;
  observe: () => Promise<GatewayRuntimeOperation>;
}>;

export async function initializeGatewayRuntime(
  input: GatewayRuntimeInitializationInput,
): Promise<GatewayRuntimeOperation> {
  if (!input.capability.operations.includes('update_runtime')) {
    throw new Error('This environment does not expose Runtime installation.');
  }
  if (!input.capability.artifact_policies.includes('published_release')) {
    throw new Error('This environment does not expose an authorized precompiled Runtime artifact.');
  }
  const artifactPlan: GatewayRuntimeArtifactPlan = { artifact_policy: 'published_release' };
  const prepared = await input.prepare({
    operation_id: input.operationID,
    authorized_client_key_id: input.authorizedClientKeyID,
    gateway_env_id: input.gatewayEnvironmentID,
    lifecycle_target_id: input.capability.target.lifecycle_target_id,
    target_generation: input.capability.target.target_generation,
    operation: 'update_runtime',
    desired_runtime: {
      version: input.desiredVersion,
      platform: input.capability.compatibility.runtime_platform,
      architecture: input.capability.compatibility.runtime_architecture,
      artifact_policy: artifactPlan.artifact_policy,
    },
    ...(artifactPlan.build_inputs ? { build_inputs: artifactPlan.build_inputs } : {}),
    idempotency_key: `runtime-initialization:${input.operationID}`,
  });
  let operation = prepared.operation;
  if (prepared.confirmation_required || operation.state === 'awaiting_confirmation') {
    operation = await input.confirm(operation);
  }
  operation = await advanceGatewayRuntimeOperation(operation, {
    prepareArtifact: input.prepareArtifact,
    upload: input.upload,
    commit: input.commit,
    observe: input.observe,
  });
  if (operation.state !== 'succeeded') {
    throw new Error(operation.failure?.message || `Runtime initialization stopped in ${operation.state}.`);
  }
  return operation;
}
