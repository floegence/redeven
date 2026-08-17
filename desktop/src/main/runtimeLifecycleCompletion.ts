import type {
  GatewayRuntimeArtifactMetadata,
  GatewayRuntimeOperation,
} from './gatewayClient';

export type RuntimeLifecyclePreparedArtifact = Readonly<{
  artifact: Buffer;
  metadata: GatewayRuntimeArtifactMetadata;
}>;

export async function advanceGatewayRuntimeOperation(
  operation: GatewayRuntimeOperation,
  input: Readonly<{
    prepareArtifact: (operation: GatewayRuntimeOperation) => Promise<RuntimeLifecyclePreparedArtifact>;
    upload: (metadata: GatewayRuntimeArtifactMetadata, artifact: Buffer) => Promise<GatewayRuntimeOperation>;
    commit: () => Promise<GatewayRuntimeOperation>;
  }>,
): Promise<GatewayRuntimeOperation> {
  let current = operation;
  if (current.state === 'awaiting_artifact') {
    if (current.kind !== 'update_runtime') {
      throw new Error('Gateway requested a Runtime artifact for an operation that does not install one.');
    }
    const prepared = await input.prepareArtifact(current);
    current = await input.upload(prepared.metadata, prepared.artifact);
  }
  return current.state === 'commit_ready' ? input.commit() : current;
}
