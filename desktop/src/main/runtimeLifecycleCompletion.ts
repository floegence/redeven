import type {
  GatewayRuntimeArtifactMetadata,
  GatewayRuntimeOperation,
} from './gatewayClient';

export type RuntimeLifecyclePreparedArtifact = Readonly<{
  artifact: Buffer;
  metadata: GatewayRuntimeArtifactMetadata;
}>;

const RESPONSE_LOSS_OBSERVATION_ATTEMPTS = 240;

async function waitForOperationProgress(
  previousState: GatewayRuntimeOperation['state'],
  originalError: unknown,
  input: Readonly<{
    observe?: () => Promise<GatewayRuntimeOperation>;
    wait?: () => Promise<void>;
  }>,
): Promise<GatewayRuntimeOperation> {
  if (!input.observe) throw originalError;
  const wait = input.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 250)));
  for (let attempt = 0; attempt < RESPONSE_LOSS_OBSERVATION_ATTEMPTS; attempt += 1) {
    let observed: GatewayRuntimeOperation;
    try {
      observed = await input.observe();
    } catch {
      await wait();
      continue;
    }
    if (observed.state === previousState) throw originalError;
    if (
      observed.state === 'staging'
      || observed.state === 'fencing'
      || observed.state === 'committing'
      || observed.state === 'recovering'
    ) {
      await wait();
      continue;
    }
    return observed;
  }
  throw originalError;
}

export async function advanceGatewayRuntimeOperation(
  operation: GatewayRuntimeOperation,
  input: Readonly<{
    prepareArtifact: (operation: GatewayRuntimeOperation) => Promise<RuntimeLifecyclePreparedArtifact>;
    upload: (metadata: GatewayRuntimeArtifactMetadata, artifact: Buffer) => Promise<GatewayRuntimeOperation>;
    commit: () => Promise<GatewayRuntimeOperation>;
    observe?: () => Promise<GatewayRuntimeOperation>;
    wait?: () => Promise<void>;
  }>,
): Promise<GatewayRuntimeOperation> {
  let current = operation;
  if (current.state === 'awaiting_artifact') {
    if (current.kind !== 'update_runtime') {
      throw new Error('Gateway requested a Runtime artifact for an operation that does not install one.');
    }
    const prepared = await input.prepareArtifact(current);
    try {
      current = await input.upload(prepared.metadata, prepared.artifact);
    } catch (error) {
      current = await waitForOperationProgress('awaiting_artifact', error, input);
    }
  }
  if (current.state !== 'commit_ready') return current;
  try {
    return await input.commit();
  } catch (error) {
    return waitForOperationProgress('commit_ready', error, input);
  }
}
