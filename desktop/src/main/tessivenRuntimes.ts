import { RuntimeControlError } from './runtimeControlClient';
import type { HostMessage } from './tessivenHost';

export type TessivenRuntimeTarget = {
  runtime_ref: string;
  generation: string;
  identity?: string;
  name: string;
  source: string;
  location: 'current_device' | 'execution_machine';
  observed_at: string;
  registered: boolean;
  online: boolean | null;
  connected: boolean;
  authenticated: boolean | null;
  actions: string[];
  reason?: string;
};
export type TessivenRuntimeRequest = HostMessage['request'] & {
  generation?: string;
  identity?: string;
  request_id?: string;
  operation_id?: string;
};
export type TessivenRuntimePath = {
  target: TessivenRuntimeTarget;
  connect: (signal: AbortSignal, message: HostMessage) => Promise<unknown>;
  inspect: (
    request: TessivenRuntimeRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
  lifecycle?: (
    request: TessivenRuntimeRequest,
    signal: AbortSignal,
    permissions: HostMessage['permissions'],
    scope: HostMessage['scope'],
  ) => Promise<unknown>;
  business?: (message: HostMessage, signal: AbortSignal) => Promise<unknown>;
};
export type TessivenRuntimeInventory = {
  paths: TessivenRuntimePath[];
  sources: {
    source: string;
    location: string;
    state: string;
    name?: string;
    reason?: string;
  }[];
};

// The execution alias borrows the same registered owner and identity checks.
export function withExecutionRuntimePath(
  path: TessivenRuntimePath,
  executionRuntime: boolean,
): TessivenRuntimePath[] {
  if (!executionRuntime || path.target.runtime_ref === 'local:local') return [path];
  return [{
    ...path,
    target: { ...path.target, runtime_ref: 'local:local', location: 'execution_machine' },
    connect: async (signal, message) => ({
      ...((await path.connect(signal, message)) as object), runtime_ref: 'local:local',
    }),
    inspect: async (request, signal) => ({
      ...((await path.inspect(request, signal)) as object), runtime_ref: 'local:local',
    }),
    ...(path.lifecycle ? { lifecycle: async (request, signal, permissions, scope) => ({
      ...((await path.lifecycle!(request, signal, permissions, scope)) as object), runtime_ref: 'local:local',
    }) } : {}),
  }, path];
}
const mutation = (action: string) =>
  ['connect', 'start', 'stop', 'restart', 'update'].includes(action);
function denied(): never {
  throw new RuntimeControlError(
    'TESSIVEN_PERMISSION_DENIED',
    'Runtime operation permission denied.',
    403,
  );
}
function changed(): never {
  throw new RuntimeControlError(
    'TESSIVEN_RESOURCE_CONFLICT',
    'The selected Runtime path changed. Refresh and select it again.',
    409,
  );
}

// This is a stateless product adapter. Connection and operation ownership stay
// with the existing managers supplied by Desktop main.
export class TessivenRuntimes {
  constructor(
    private readonly inventory: (
      signal: AbortSignal,
    ) => Promise<TessivenRuntimeInventory>,
  ) {}
  async execute(message: HostMessage, signal: AbortSignal): Promise<unknown> {
    if (!message.permissions.read) denied();
    if (
      mutation(message.request.action) &&
      (!message.permissions.write || !message.permissions.execute)
    )
      denied();
    if (
      mutation(message.request.action) &&
      message.request.action !== 'connect' &&
      !message.permissions.admin
    )
      denied();
    signal.throwIfAborted();
    const inventory = await this.inventory(signal);
    signal.throwIfAborted();
    if (message.request.action === 'directory') {
      return {
        targets: inventory.paths.map((path) => ({
          ...path.target,
          actions: path.target.actions.filter(
            (action) =>
              !mutation(action) ||
              (message.permissions.write &&
                message.permissions.execute &&
                (action === 'connect' || message.permissions.admin)),
          ),
        })),
        sources: inventory.sources,
      };
    }
    const request = message.request as TessivenRuntimeRequest;
    const paths = inventory.paths.filter(
      (path) => path.target.runtime_ref === request.runtime_ref,
    );
    const path = paths.length === 1 ? paths[0] : undefined;
    if (!path)
      throw new RuntimeControlError(
        'TESSIVEN_TARGET_UNAVAILABLE',
        'This exact Runtime path is unavailable. Restore its registered connection in Desktop.',
        409,
      );
    if (
      request.action !== 'operation' &&
      (!request.generation ||
        request.generation !== path.target.generation ||
        (request.identity ?? '') !== (path.target.identity ?? ''))
    )
      changed();
    if (!path.target.actions.includes(request.action))
      throw new RuntimeControlError(
        'TESSIVEN_OPERATION_UNAVAILABLE',
        path.target.reason ?? 'This path does not support the operation.',
        409,
      );
    if (mutation(request.action) && !request.request_id)
      throw new RuntimeControlError(
        'TESSIVEN_INVALID_REQUEST',
        'An operation request ID is required.',
        400,
      );
    if (request.action === 'connect') return path.connect(signal, message);
    if (mutation(request.action)) {
      if (!path.lifecycle)
        throw new RuntimeControlError(
          'TESSIVEN_OPERATION_UNAVAILABLE',
          'Gateway application paths do not provide Runtime process control.',
          409,
        );
      return path.lifecycle(
        request,
        signal,
        message.permissions,
        message.scope,
      );
    }
    return path.inspect(request, signal);
  }
}
