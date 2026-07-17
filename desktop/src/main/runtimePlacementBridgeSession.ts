import { timingSafeEqual } from 'node:crypto';

import {
  buildRuntimePlacementBridgePlan,
  type RuntimePlacementBridgeCommandKind,
} from './runtimePlacementBridge';
import {
  spawnLocalRuntimeHostCommand,
  spawnSSHRuntimeHostCommand,
  type RuntimeHostStreamingCommand,
} from './runtimeHostAccess';
import {
  DesktopSSHRemoteCommandError,
  DesktopSSHTransportAuthenticationError,
  DesktopSSHTransportInterruptedError,
  DesktopSSHTransportUnavailableError,
  type DesktopSSHTransportManager,
} from './sshTransportManager';
import { startRuntimePlacementLoopbackProxy } from './runtimePlacementLoopbackProxy';
import type { StartupReport } from './startup';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
  DesktopRuntimeTargetID,
} from '../shared/desktopRuntimePlacement';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { RuntimeServiceSnapshot } from '../shared/runtimeService';
import {
  parseRuntimePlacementBridgeHello,
  parseRuntimePlacementBridgeStreamError,
  readRuntimePlacementBridgeFrame,
  runtimeControlEndpointFromBridgeHello,
  runtimePlacementBridgeStreamID,
  writeRuntimePlacementBridgeFrame,
  type RuntimePlacementBridgeHello,
  type RuntimePlacementBridgeSurface,
} from './runtimePlacementBridgeProtocol';

const DEFAULT_BRIDGE_RECOVERY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

type BridgeStreamCallbacks = {
  transport_id: number;
  onData?: (chunk: Buffer) => void | Promise<void>;
  onClose?: () => void;
  onError?: (error: Error) => void;
  ready?: Promise<void>;
  closed?: boolean;
  error?: Error;
};

type RuntimeBridgeIdentity = Readonly<{
  kind: 'runtime';
  started_at_unix_ms: number;
  runtime_version: string;
  runtime_control_protocol_version: string;
  desktop_owner_id: string;
  runtime_control_token: string;
}>;

type GatewayBridgeIdentity = Readonly<{
  kind: 'gateway';
  state_root: string;
  executable_path: string;
  service_pid: number;
  managed_bridge_token: string;
}>;

type BridgeProcessIdentity = RuntimeBridgeIdentity | GatewayBridgeIdentity;

type RemoteBridgeTransport = Readonly<{
  id: number;
  command: RuntimeHostStreamingCommand;
  hello: RuntimePlacementBridgeHello;
  identity: BridgeProcessIdentity | null;
}>;

export type RuntimePlacementBridgeStream = Readonly<{
  id: string;
  onData: (callback: (chunk: Buffer) => void | Promise<void>) => void;
  onClose: (callback: () => void) => void;
  onError: (callback: (error: Error) => void) => void;
  write: (chunk: Buffer) => Promise<void>;
  close: () => Promise<void>;
}>;

export type RuntimePlacementBridgeSessionHandle = Readonly<{
  openStream: (surface: RuntimePlacementBridgeSurface) => RuntimePlacementBridgeStream;
}>;

export type RuntimePlacementBridgeSession = RuntimePlacementBridgeSessionHandle & Readonly<{
  placement_target_id: DesktopRuntimeTargetID;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  hello: RuntimePlacementBridgeHello;
  startup: StartupReport;
  local_ui_url: string;
  runtime_control?: DesktopRuntimeControlEndpoint;
  runtime_service?: RuntimeServiceSnapshot;
  runtime_handle: DesktopSessionRuntimeHandle;
  closed: Promise<void>;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type StartRuntimePlacementBridgeSessionArgs = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path?: string;
  bridge_command_kind?: RuntimePlacementBridgeCommandKind;
  desktop_owner_id: string;
  require_local_ui?: boolean;
  ssh_password?: string;
  ssh_credential_scope?: string;
  ssh_transport_manager?: DesktopSSHTransportManager;
  fallback_local_id?: string;
  signal?: AbortSignal;
  recovery_scheduler?: Readonly<{
    backoff_ms?: readonly number[];
    wait?: (delayMS: number, signal: AbortSignal) => Promise<void>;
  }>;
}>;

class RuntimePlacementBridgeIdentityChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePlacementBridgeIdentityChangedError';
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function abortError(): Error {
  const error = new Error('Runtime Placement Bridge startup was canceled.');
  error.name = 'AbortError';
  return error;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function secureStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function runtimeBridgeIdentity(hello: RuntimePlacementBridgeHello): RuntimeBridgeIdentity {
  const startedAtUnixMS = Number(hello.started_at_unix_ms);
  const runtimeVersion = compact(hello.runtime_version);
  const protocolVersion = compact(hello.runtime_control.protocol_version);
  const desktopOwnerID = compact(hello.runtime_control.desktop_owner_id);
  const token = compact(hello.runtime_control.token);
  if (
    !Number.isInteger(startedAtUnixMS)
    || startedAtUnixMS <= 0
    || runtimeVersion === ''
    || !hello.runtime_control.available
    || protocolVersion === ''
    || desktopOwnerID === ''
    || token === ''
  ) {
    throw new RuntimePlacementBridgeIdentityChangedError(
      'Runtime Placement Bridge did not report the complete Runtime process identity.',
    );
  }
  return {
    kind: 'runtime',
    started_at_unix_ms: startedAtUnixMS,
    runtime_version: runtimeVersion,
    runtime_control_protocol_version: protocolVersion,
    desktop_owner_id: desktopOwnerID,
    runtime_control_token: token,
  };
}

function gatewayBridgeIdentity(hello: RuntimePlacementBridgeHello): GatewayBridgeIdentity {
  const gateway = hello.gateway_service;
  const stateRoot = compact(gateway?.state_root);
  const executablePath = compact(gateway?.executable_path);
  const servicePID = Number(gateway?.service_pid);
  const managedBridgeToken = compact(gateway?.managed_bridge_token);
  if (
    stateRoot === ''
    || executablePath === ''
    || !Number.isInteger(servicePID)
    || servicePID <= 0
    || managedBridgeToken === ''
  ) {
    throw new RuntimePlacementBridgeIdentityChangedError(
      'Runtime Placement Bridge did not report the complete managed Gateway service identity.',
    );
  }
  return {
    kind: 'gateway',
    state_root: stateRoot,
    executable_path: executablePath,
    service_pid: servicePID,
    managed_bridge_token: managedBridgeToken,
  };
}

function bridgeProcessIdentity(
  args: StartRuntimePlacementBridgeSessionArgs,
  hello: RuntimePlacementBridgeHello,
): BridgeProcessIdentity | null {
  if (args.host_access.kind !== 'ssh_host') {
    return null;
  }
  return (args.bridge_command_kind ?? 'runtime') === 'gateway'
    ? gatewayBridgeIdentity(hello)
    : runtimeBridgeIdentity(hello);
}

function bridgeProcessIdentityMatches(left: BridgeProcessIdentity, right: BridgeProcessIdentity): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'runtime' && right.kind === 'runtime') {
    return left.started_at_unix_ms === right.started_at_unix_ms
      && left.runtime_version === right.runtime_version
      && left.runtime_control_protocol_version === right.runtime_control_protocol_version
      && left.desktop_owner_id === right.desktop_owner_id
      && secureStringEqual(left.runtime_control_token, right.runtime_control_token);
  }
  if (left.kind === 'gateway' && right.kind === 'gateway') {
    return left.state_root === right.state_root
      && left.executable_path === right.executable_path
      && left.service_pid === right.service_pid
      && secureStringEqual(left.managed_bridge_token, right.managed_bridge_token);
  }
  return false;
}

function waitForRecovery(delayMS: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? abortError());
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, delayMS));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function spawnBridgeCommand(
  args: StartRuntimePlacementBridgeSessionArgs,
  signal: AbortSignal,
): Promise<RuntimeHostStreamingCommand> {
  const plan = buildRuntimePlacementBridgePlan({
    host_access: args.host_access,
    placement: args.placement,
    runtime_binary_path: args.runtime_binary_path,
    command_kind: args.bridge_command_kind,
  });
  const env = {
    REDEVEN_DESKTOP_OWNER_ID: compact(args.desktop_owner_id),
  };
  if (args.host_access.kind === 'ssh_host') {
    if (!args.ssh_transport_manager) {
      throw new Error('SSH bridge requires the Desktop SSH transport manager.');
    }
    return spawnSSHRuntimeHostCommand(args.ssh_transport_manager, args.host_access.ssh, plan.command, {
      env,
      sshPassword: args.ssh_password,
      credentialScope: args.ssh_credential_scope ?? '',
      signal,
    });
  }
  return spawnLocalRuntimeHostCommand(plan.command, { env, signal });
}

async function closeStreamingCommand(command: RuntimeHostStreamingCommand): Promise<void> {
  command.kill('SIGTERM');
  await command.closed.catch(() => undefined);
}

async function transportClosedReason(command: RuntimeHostStreamingCommand): Promise<Error> {
  try {
    await command.closed;
    return new RuntimePlacementBridgeIdentityChangedError(
      'Runtime Placement Bridge command ended; the original remote process generation is no longer available.',
    );
  } catch (error) {
    return normalizeError(error);
  }
}

async function openRemoteBridgeTransport(
  args: StartRuntimePlacementBridgeSessionArgs,
  signal: AbortSignal,
  id: number,
): Promise<RemoteBridgeTransport> {
  const command = await spawnBridgeCommand(args, signal);
  void command.closed.catch(() => undefined);
  try {
    const firstFrame = await readRuntimePlacementBridgeFrame(command.stdout);
    if (!firstFrame || firstFrame.header.type !== 'hello') {
      throw await transportClosedReason(command);
    }
    const hello = parseRuntimePlacementBridgeHello(firstFrame.payload);
    if (args.require_local_ui !== false && !hello.local_ui.available) {
      throw new RuntimePlacementBridgeIdentityChangedError(
        'Runtime Placement Bridge reported Local UI unavailable.',
      );
    }
    return {
      id,
      command,
      hello,
      identity: bridgeProcessIdentity(args, hello),
    };
  } catch (error) {
    await closeStreamingCommand(command);
    throw error;
  }
}

function transportFailureIsRecoverable(error: Error): boolean {
  return error instanceof DesktopSSHTransportInterruptedError
    || (
      error instanceof DesktopSSHTransportUnavailableError
      && !(error instanceof DesktopSSHTransportAuthenticationError)
    );
}

export async function startRuntimePlacementBridgeSession(
  args: StartRuntimePlacementBridgeSessionArgs,
): Promise<RuntimePlacementBridgeSession> {
  // IMPORTANT: Runtime Placement Bridge sessions are the only SSH host and
  // container Env App transport. Do not add published-port, host-network,
  // provider-card, or public Local UI fallback paths around this bridge.
  const sessionController = new AbortController();
  const abortSession = () => {
    if (!sessionController.signal.aborted) {
      sessionController.abort(args.signal?.reason ?? abortError());
    }
  };
  if (args.signal?.aborted) {
    abortSession();
    throw abortError();
  }
  args.signal?.addEventListener('abort', abortSession, { once: true });

  let nextTransportID = 1;
  let currentTransport: RemoteBridgeTransport | null = null;
  let proxyClose: (() => Promise<void>) | null = null;
  let closed = false;
  let recoveryTask: Promise<void> | null = null;
  const streams = new Map<string, BridgeStreamCallbacks>();
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const failActiveStreams = (error: Error) => {
    const callbacksList = [...streams.values()];
    streams.clear();
    for (const callbacks of callbacksList) {
      callbacks.error = error;
      callbacks.onError?.(error);
    }
  };

  const bridgeHandle: RuntimePlacementBridgeSessionHandle = {
    openStream: (surface) => {
      const transport = currentTransport;
      if (closed) {
        throw new Error('Runtime Placement Bridge session is closed.');
      }
      if (!transport) {
        throw new Error('Runtime Placement Bridge is unavailable.');
      }
      const streamID = runtimePlacementBridgeStreamID(surface);
      const callbacks: BridgeStreamCallbacks = { transport_id: transport.id };
      streams.set(streamID, callbacks);
      const ready = writeRuntimePlacementBridgeFrame(transport.command.stdin, {
        type: 'stream_open',
        stream_id: streamID,
        payload: { surface },
      }).catch((error: unknown) => {
        streams.delete(streamID);
        callbacks.error = normalizeError(error);
        callbacks.onError?.(callbacks.error);
        throw error;
      });
      callbacks.ready = ready;
      return {
        id: streamID,
        onData: (callback) => {
          callbacks.onData = callback;
        },
        onClose: (callback) => {
          callbacks.onClose = callback;
          if (callbacks.closed) {
            callback();
          }
        },
        onError: (callback) => {
          callbacks.onError = callback;
          if (callbacks.error) {
            callback(callbacks.error);
          }
        },
        write: async (chunk) => {
          await ready;
          if (
            closed
            || currentTransport?.id !== transport.id
            || !streams.has(streamID)
          ) {
            throw new Error('Runtime Placement Bridge stream is closed.');
          }
          await writeRuntimePlacementBridgeFrame(transport.command.stdin, {
            type: 'stream_data',
            stream_id: streamID,
            payload: chunk,
          });
        },
        close: async () => {
          await ready.catch(() => undefined);
          const wasOpen = streams.delete(streamID);
          if (closed || !wasOpen || currentTransport?.id !== transport.id) {
            return;
          }
          await writeRuntimePlacementBridgeFrame(transport.command.stdin, {
            type: 'stream_close',
            stream_id: streamID,
          });
        },
      };
    },
  };

  const settleBridgeSession = async (error?: Error) => {
    if (closed) {
      return;
    }
    closed = true;
    args.signal?.removeEventListener('abort', abortSession);
    if (!sessionController.signal.aborted) {
      sessionController.abort(error ?? new DOMException('Bridge session closed.', 'AbortError'));
    }
    const transport = currentTransport;
    currentTransport = null;
    failActiveStreams(error ?? new Error('Runtime Placement Bridge session is closed.'));
    await proxyClose?.().catch(() => undefined);
    await (transport ? closeStreamingCommand(transport.command) : Promise.resolve());
    resolveClosed();
  };

  const runFrameLoop = async (transport: RemoteBridgeTransport): Promise<void> => {
    let terminalError: Error;
    try {
      for (;;) {
        const frame = await readRuntimePlacementBridgeFrame(transport.command.stdout);
        if (!frame) {
          terminalError = await transportClosedReason(transport.command);
          break;
        }
        const callbacks = streams.get(frame.header.stream_id);
        if (!callbacks || callbacks.transport_id !== transport.id) {
          continue;
        }
        if (frame.header.type === 'stream_data') {
          await callbacks.onData?.(frame.payload);
        } else if (frame.header.type === 'stream_close') {
          streams.delete(frame.header.stream_id);
          callbacks.closed = true;
          callbacks.onClose?.();
        } else if (frame.header.type === 'stream_error') {
          streams.delete(frame.header.stream_id);
          const bridgeError = parseRuntimePlacementBridgeStreamError(frame.payload);
          callbacks.error = new Error(`${bridgeError.code}: ${bridgeError.message}`);
          callbacks.onError?.(callbacks.error);
        }
      }
    } catch (error) {
      terminalError = normalizeError(error);
    }
    if (closed || currentTransport?.id !== transport.id) {
      return;
    }
    currentTransport = null;
    failActiveStreams(new Error('Runtime Placement Bridge is temporarily unavailable.'));
    await closeStreamingCommand(transport.command);
    if (args.host_access.kind !== 'ssh_host' || !transportFailureIsRecoverable(terminalError)) {
      await settleBridgeSession(terminalError);
      return;
    }
    startRecovery();
  };

  const attachTransport = (transport: RemoteBridgeTransport) => {
    currentTransport = transport;
    void runFrameLoop(transport);
  };

  const recover = async (): Promise<void> => {
    const expectedIdentity = initialTransport.identity;
    if (!expectedIdentity) {
      await settleBridgeSession(new Error('Runtime Placement Bridge recovery requires a remote process identity.'));
      return;
    }
    const configuredBackoff = args.recovery_scheduler?.backoff_ms
      ?.map((delayMS) => Math.max(0, Number(delayMS)))
      .filter(Number.isFinite);
    const backoff = configuredBackoff && configuredBackoff.length > 0
      ? configuredBackoff
      : DEFAULT_BRIDGE_RECOVERY_BACKOFF_MS;
    const wait = args.recovery_scheduler?.wait ?? waitForRecovery;
    let attempt = 0;
    while (!closed && !sessionController.signal.aborted) {
      const delayMS = backoff[Math.min(attempt, backoff.length - 1)] ?? 30_000;
      attempt += 1;
      try {
        await wait(delayMS, sessionController.signal);
      } catch {
        return;
      }
      if (closed || sessionController.signal.aborted) {
        return;
      }
      try {
        const transport = await openRemoteBridgeTransport(
          args,
          sessionController.signal,
          nextTransportID++,
        );
        if (!transport.identity || !bridgeProcessIdentityMatches(expectedIdentity, transport.identity)) {
          await closeStreamingCommand(transport.command);
          throw new RuntimePlacementBridgeIdentityChangedError(
            'The remote Runtime or Gateway process identity changed while Desktop was reconnecting.',
          );
        }
        attachTransport(transport);
        return;
      } catch (error) {
        const normalized = normalizeError(error);
        if (
          normalized instanceof RuntimePlacementBridgeIdentityChangedError
          || normalized instanceof DesktopSSHRemoteCommandError
          || normalized instanceof DesktopSSHTransportAuthenticationError
        ) {
          await settleBridgeSession(normalized);
          return;
        }
        if (!transportFailureIsRecoverable(normalized)) {
          await settleBridgeSession(normalized);
          return;
        }
      }
    }
  };

  function startRecovery(): void {
    if (closed || recoveryTask) {
      return;
    }
    recoveryTask = recover().finally(() => {
      recoveryTask = null;
    });
  }

  let initialTransport: RemoteBridgeTransport;
  try {
    initialTransport = await openRemoteBridgeTransport(
      args,
      sessionController.signal,
      nextTransportID++,
    );
  } catch (error) {
    args.signal?.removeEventListener('abort', abortSession);
    if (!sessionController.signal.aborted) {
      sessionController.abort(error);
    }
    if (args.signal?.aborted) {
      throw abortError();
    }
    throw error;
  }

  const requireLocalUI = args.require_local_ui !== false;
  let proxy: Awaited<ReturnType<typeof startRuntimePlacementLoopbackProxy>> | null = null;
  try {
    if (requireLocalUI) {
      proxy = await startRuntimePlacementLoopbackProxy(bridgeHandle);
    }
  } catch (error) {
    await closeStreamingCommand(initialTransport.command);
    args.signal?.removeEventListener('abort', abortSession);
    throw error;
  }
  proxyClose = proxy?.close ?? null;
  attachTransport(initialTransport);

  const hello = initialTransport.hello;
  const localUIURL = proxy?.url ?? '';
  const runtimeControl = proxy ? runtimeControlEndpointFromBridgeHello(hello, proxy.url) : undefined;
  const runtimeService = hello.runtime_service;
  const placementTargetID = desktopRuntimeTargetID(
    args.host_access,
    args.placement,
    args.fallback_local_id,
  );
  const stop = async () => {
    await settleBridgeSession();
  };
  const startup: StartupReport = {
    local_ui_url: localUIURL,
    local_ui_urls: localUIURL ? [localUIURL] : [],
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    effective_run_mode: runtimeService?.effective_run_mode,
    remote_enabled: runtimeService?.remote_enabled,
    desktop_managed: true,
    desktop_owner_id: compact(args.desktop_owner_id),
    started_at_unix_ms: hello.started_at_unix_ms,
    runtime_service: runtimeService,
  };

  return {
    ...bridgeHandle,
    placement_target_id: placementTargetID,
    host_access: args.host_access,
    placement: args.placement,
    hello,
    startup,
    local_ui_url: localUIURL,
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    ...(runtimeService ? { runtime_service: runtimeService } : {}),
    runtime_handle: {
      runtime_kind: args.host_access.kind === 'ssh_host' ? 'ssh' : 'local_environment',
      lifecycle_owner: 'desktop',
      launch_mode: 'spawned',
      stop,
    },
    closed: closedPromise,
    disconnect: stop,
    stop,
  };
}
