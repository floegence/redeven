import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  connect as connectHTTP2,
  constants as HTTP2_CONSTANTS,
  type ClientHttp2Session,
  type ClientHttp2Stream,
  type IncomingHttpHeaders,
} from 'node:http2';
import { Duplex } from 'node:stream';

import {
  buildRuntimePlacementBridgePlan,
  type RuntimePlacementBridgeCommandKind,
} from './runtimePlacementBridge';
import {
  spawnLocalRuntimeHostCommand,
  spawnSSHRuntimeHostCommand,
  spawnWSLRuntimeHostCommand,
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
import type {
  DesktopSessionTransportRecoveryFailure,
  DesktopSessionTransportRecoverySnapshot,
} from '../shared/desktopSessionContextIPC';
import {
  parseRuntimePlacementBridgeHello,
  RUNTIME_PLACEMENT_BRIDGE_AUTHORITY,
  RUNTIME_PLACEMENT_BRIDGE_ERROR_CODE_HEADER,
  RUNTIME_PLACEMENT_BRIDGE_HELLO_PATH,
  RUNTIME_PLACEMENT_BRIDGE_MAX_CONTROL_RESPONSE_BYTES,
  RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BLOCK_BYTES,
  RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_PAIRS,
  RUNTIME_PLACEMENT_BRIDGE_MAX_SESSION_MEMORY_MB,
  RUNTIME_PLACEMENT_BRIDGE_SESSION_WINDOW_BYTES,
  RUNTIME_PLACEMENT_BRIDGE_STREAM_WINDOW_BYTES,
  runtimeControlEndpointFromBridgeHello,
  runtimePlacementBridgeStreamError,
  runtimePlacementBridgeSurfaceAuthority,
  type RuntimePlacementBridgeHello,
  type RuntimePlacementBridgeSurface,
} from './runtimePlacementBridgeProtocol';
import { normalizeDesktopPrivateBridgeToken } from './desktopPrivateBridge';

const DEFAULT_BRIDGE_RECOVERY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

type BridgeStreamCallbacks = {
  transport_id: number;
  request: ClientHttp2Stream;
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
  connection: Duplex;
  session: ClientHttp2Session;
  closed: Promise<Error>;
  markInbound: () => void;
  hello: RuntimePlacementBridgeHello;
  identity: BridgeProcessIdentity | null;
}>;

export type RuntimePlacementBridgeStream = Readonly<{
  id: string;
  onData: (callback: (chunk: Buffer) => void | Promise<void>) => void;
  onClose: (callback: () => void) => void;
  onError: (callback: (error: Error) => void) => void;
  write: (chunk: Buffer) => Promise<void>;
  closeWrite?: () => Promise<void>;
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
  closed: Promise<RuntimePlacementBridgeTermination>;
  getRecoverySnapshot: () => DesktopSessionTransportRecoverySnapshot;
  subscribeRecovery: (listener: (snapshot: DesktopSessionTransportRecoverySnapshot) => void) => () => void;
  requestRecoveryNow: () => boolean;
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type RuntimePlacementBridgeTermination = Readonly<
  | { kind: 'closed' }
  | { kind: 'failed'; failure: DesktopSessionTransportRecoveryFailure }
>;

export type StartRuntimePlacementBridgeSessionArgs = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path?: string;
  bridge_command_kind?: RuntimePlacementBridgeCommandKind;
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

class RuntimePlacementBridgeRemoteCommandEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimePlacementBridgeRemoteCommandEndedError';
  }
}

class RuntimePlacementBridgeHTTP2Error extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimePlacementBridgeHTTP2Error';
  }
}

class RuntimePlacementBridgeRetryNowError extends Error {
  constructor() {
    super('Runtime Placement Bridge retry requested.');
    this.name = 'RuntimePlacementBridgeRetryNowError';
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
  const token = compact(hello.runtime_control.token);
  if (
    !Number.isInteger(startedAtUnixMS)
    || startedAtUnixMS <= 0
    || runtimeVersion === ''
    || !hello.runtime_control.available
    || protocolVersion === ''
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
  if (args.host_access.kind === 'ssh_host') {
    if (!args.ssh_transport_manager) {
      throw new Error('SSH bridge requires the Desktop SSH transport manager.');
    }
    return spawnSSHRuntimeHostCommand(args.ssh_transport_manager, args.host_access.ssh, plan.command, {
      sshPassword: args.ssh_password,
      credentialScope: args.ssh_credential_scope ?? '',
      signal,
    });
  }
  if (args.host_access.kind === 'wsl_host') {
    return spawnWSLRuntimeHostCommand(args.host_access, plan.command, { signal });
  }
  return spawnLocalRuntimeHostCommand(plan.command, { signal });
}

async function closeStreamingCommand(command: RuntimeHostStreamingCommand): Promise<void> {
  command.kill('SIGTERM');
  await command.closed.catch(() => undefined);
}

function bridgeTransportTermination(
  command: RuntimeHostStreamingCommand,
  session: ClientHttp2Session,
): Promise<Error> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(error);
    };
    session.once('error', (error) => {
      finish(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge HTTP/2 session failed.',
        { cause: error },
      ));
    });
    session.once('goaway', (errorCode) => {
      finish(new RuntimePlacementBridgeHTTP2Error(
        `Runtime Placement Bridge HTTP/2 session received GOAWAY (${errorCode}).`,
      ));
    });
    session.once('close', () => {
      finish(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge HTTP/2 session closed.',
      ));
    });
    void command.closed.then(
      () => finish(new RuntimePlacementBridgeRemoteCommandEndedError(
        'Runtime Placement Bridge command ended; the original remote process generation is no longer available.',
      )),
      (error) => finish(normalizeError(error)),
    );
  });
}

function startHTTP2Keepalive(session: ClientHttp2Session): Readonly<{
  touch: () => void;
  stop: () => void;
}> {
  let stopped = false;
  let idleTimer: NodeJS.Timeout | null = null;
  let responseTimer: NodeJS.Timeout | null = null;
  const schedule = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(sendPing, 15_000);
    idleTimer.unref();
  };
  const touch = () => {
    if (!stopped) {
      schedule();
    }
  };
  const sendPing = () => {
    idleTimer = null;
    if (stopped || session.closed || session.destroyed || responseTimer) {
      return;
    }
    responseTimer = setTimeout(() => {
      responseTimer = null;
      session.destroy(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge HTTP/2 PING timed out.',
      ));
    }, 10_000);
    session.ping((error) => {
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
      if (error && !session.destroyed) {
        session.destroy(new RuntimePlacementBridgeHTTP2Error(
          'Runtime Placement Bridge HTTP/2 PING failed.',
          { cause: error },
        ));
        return;
      }
      touch();
    });
  };
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (responseTimer) {
      clearTimeout(responseTimer);
      responseTimer = null;
    }
  };
  session.on('remoteSettings', touch);
  session.on('ping', touch);
  session.on('goaway', touch);
  session.once('close', stop);
  schedule();
  return { touch, stop };
}

async function waitForHTTP2Connect(
  session: ClientHttp2Session,
  closed: Promise<Error>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw signal.reason ?? abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      session.off('connect', onConnect);
      signal.removeEventListener('abort', onAbort);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? abortError());
    };
    session.once('connect', onConnect);
    signal.addEventListener('abort', onAbort, { once: true });
    void closed.then((error) => {
      cleanup();
      reject(error);
    });
  });
}

function headerText(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return compact(Array.isArray(value) ? value[0] : value);
}

function readHTTP2ControlResponse(
  session: ClientHttp2Session,
  headers: Readonly<Record<string, string>>,
  markInbound?: () => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = session.request(headers, { endStream: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let responseHeaders: IncomingHttpHeaders | null = null;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };
    request.on('response', (nextHeaders) => {
      markInbound?.();
      responseHeaders = nextHeaders;
    });
    request.on('data', (chunk: Buffer | string) => {
      markInbound?.();
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > RUNTIME_PLACEMENT_BRIDGE_MAX_CONTROL_RESPONSE_BYTES) {
        request.close(HTTP2_CONSTANTS.NGHTTP2_CANCEL);
        settle(() => reject(new RuntimePlacementBridgeHTTP2Error(
          'Runtime Placement Bridge control response is too large.',
        )));
        return;
      }
      chunks.push(value);
    });
    request.once('error', (error) => {
      settle(() => reject(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge control request failed.',
        { cause: error },
      )));
    });
    request.once('end', () => {
      settle(() => {
        const status = Number(responseHeaders?.[':status'] ?? 0);
        if (status !== 200) {
          const code = responseHeaders
            ? headerText(responseHeaders, RUNTIME_PLACEMENT_BRIDGE_ERROR_CODE_HEADER)
            : '';
          const streamError = runtimePlacementBridgeStreamError(code);
          reject(new RuntimePlacementBridgeHTTP2Error(streamError.message));
          return;
        }
        resolve(Buffer.concat(chunks, bytes));
      });
    });
  });
}

function writeHTTP2Stream(stream: ClientHttp2Stream, chunk: Buffer): Promise<void> {
  if (chunk.length === 0 || stream.write(chunk)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('close', onClose);
      stream.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge HTTP/2 stream closed while writing.',
      ));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new RuntimePlacementBridgeHTTP2Error(
        'Runtime Placement Bridge HTTP/2 stream failed while writing.',
        { cause: error },
      ));
    };
    stream.once('drain', onDrain);
    stream.once('close', onClose);
    stream.once('error', onError);
  });
}

function streamingCommandConnection(command: RuntimeHostStreamingCommand): Duplex {
  // @types/node does not yet describe the documented readable/writable pair
  // accepted by Duplex.from(), so keep the cast at this single stdio boundary.
  return Duplex.from({
    readable: command.stdout,
    writable: command.stdin,
  } as unknown as Duplex);
}

async function openRemoteBridgeTransport(
  args: StartRuntimePlacementBridgeSessionArgs,
  signal: AbortSignal,
  id: number,
): Promise<RemoteBridgeTransport> {
  const command = await spawnBridgeCommand(args, signal);
  void command.closed.catch(() => undefined);
  const connection = streamingCommandConnection(command);
  const session = connectHTTP2(`http://${RUNTIME_PLACEMENT_BRIDGE_AUTHORITY}`, {
    createConnection: () => connection,
    maxSessionMemory: RUNTIME_PLACEMENT_BRIDGE_MAX_SESSION_MEMORY_MB,
    maxHeaderListPairs: RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_PAIRS,
    maxSendHeaderBlockLength: RUNTIME_PLACEMENT_BRIDGE_MAX_HEADER_BLOCK_BYTES,
    settings: {
      enablePush: false,
      initialWindowSize: RUNTIME_PLACEMENT_BRIDGE_STREAM_WINDOW_BYTES,
    },
  });
  session.setLocalWindowSize(RUNTIME_PLACEMENT_BRIDGE_SESSION_WINDOW_BYTES);
  const keepalive = startHTTP2Keepalive(session);
  const closed = bridgeTransportTermination(command, session);
  try {
    await waitForHTTP2Connect(session, closed, signal);
    const hello = parseRuntimePlacementBridgeHello(await readHTTP2ControlResponse(
      session,
      {
        ':method': 'GET',
        ':scheme': 'http',
        ':authority': RUNTIME_PLACEMENT_BRIDGE_AUTHORITY,
        ':path': RUNTIME_PLACEMENT_BRIDGE_HELLO_PATH,
      },
      keepalive.touch,
    ));
    if (args.require_local_ui !== false && !hello.local_ui.available) {
      throw new RuntimePlacementBridgeIdentityChangedError(
        'Runtime Placement Bridge reported Local UI unavailable.',
      );
    }
    return {
      id,
      command,
      connection,
      session,
      closed,
      markInbound: keepalive.touch,
      hello,
      identity: bridgeProcessIdentity(args, hello),
    };
  } catch (error) {
    keepalive.stop();
    session.destroy();
    connection.destroy();
    await closeStreamingCommand(command);
    throw error;
  }
}

function transportFailureIsRecoverable(error: Error): boolean {
  return error instanceof RuntimePlacementBridgeHTTP2Error
    || error instanceof RuntimePlacementBridgeRemoteCommandEndedError
    || error instanceof DesktopSSHRemoteCommandError
    || error instanceof DesktopSSHTransportInterruptedError
    || (
      error instanceof DesktopSSHTransportUnavailableError
      && !(error instanceof DesktopSSHTransportAuthenticationError)
    );
}

function recoveryBackoff(args: StartRuntimePlacementBridgeSessionArgs): readonly number[] {
  const configured = args.recovery_scheduler?.backoff_ms
    ?.map((delayMS) => Math.max(0, Number(delayMS)))
    .filter(Number.isFinite);
  return configured && configured.length > 0 ? configured : DEFAULT_BRIDGE_RECOVERY_BACKOFF_MS;
}

function recoveryFailureFromError(error: Error): DesktopSessionTransportRecoveryFailure {
  const code = error instanceof RuntimePlacementBridgeIdentityChangedError
    ? 'process_identity_changed'
    : error instanceof RuntimePlacementBridgeRemoteCommandEndedError || error instanceof DesktopSSHRemoteCommandError
      ? 'remote_command_ended'
      : error instanceof RuntimePlacementBridgeHTTP2Error
        ? 'transport_interrupted'
      : error instanceof DesktopSSHTransportAuthenticationError
        ? 'authentication_failed'
        : error instanceof DesktopSSHTransportInterruptedError
          ? 'transport_interrupted'
          : 'transport_unavailable';
  return Object.freeze({
    code,
    error_name: compact(error.name),
    technical_detail: compact(error.message),
  });
}

function freezeRecoverySnapshot(
  snapshot: DesktopSessionTransportRecoverySnapshot,
): DesktopSessionTransportRecoverySnapshot {
  return Object.freeze({
    ...snapshot,
    ...(snapshot.failure ? { failure: Object.freeze({ ...snapshot.failure }) } : {}),
    actions: Object.freeze([...snapshot.actions]),
  });
}

export async function startRuntimePlacementBridgeSession(
  args: StartRuntimePlacementBridgeSessionArgs,
): Promise<RuntimePlacementBridgeSession> {
  // IMPORTANT: Runtime Placement Bridge sessions are the only WSL host, SSH
  // host, and container Env App transport. Do not add published-port, host-network,
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
  let recoveryWaitController: AbortController | null = null;
  let recoveryRetryRequested = false;
  const streams = new Map<string, BridgeStreamCallbacks>();
  const recoveryListeners = new Set<(snapshot: DesktopSessionTransportRecoverySnapshot) => void>();
  const recoveryBackoffMS = recoveryBackoff(args);
  let recoverySnapshot = freezeRecoverySnapshot({
    generation: 0,
    revision: 0,
    phase: 'ready',
    attempt_count: 0,
    actions: [],
  });
  let resolveClosed!: (termination: RuntimePlacementBridgeTermination) => void;
  const closedPromise = new Promise<RuntimePlacementBridgeTermination>((resolve) => {
    resolveClosed = resolve;
  });

  const publishRecovery = (
    next: Omit<DesktopSessionTransportRecoverySnapshot, 'revision'>,
  ): DesktopSessionTransportRecoverySnapshot => {
    recoverySnapshot = freezeRecoverySnapshot({
      ...next,
      revision: recoverySnapshot.revision + 1,
    });
    for (const listener of recoveryListeners) {
      listener(recoverySnapshot);
    }
    return recoverySnapshot;
  };

  const failActiveStreams = (error: Error) => {
    const callbacksList = [...streams.values()];
    streams.clear();
    for (const callbacks of callbacksList) {
      callbacks.error = error;
      callbacks.request.close(HTTP2_CONSTANTS.NGHTTP2_CANCEL);
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
      const request = transport.session.request({
        ':method': 'CONNECT',
        ':authority': runtimePlacementBridgeSurfaceAuthority(surface),
      }, { endStream: false });
      const streamID = `${surface}-${randomUUID()}`;
      const callbacks: BridgeStreamCallbacks = { transport_id: transport.id, request };
      streams.set(streamID, callbacks);
      let readTail = Promise.resolve();
      let readySettled = false;
      let resolveReady!: () => void;
      let rejectReady!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      callbacks.ready = ready;
      const failStream = (error: Error) => {
        if (!readySettled) {
          readySettled = true;
          rejectReady(error);
        }
        if (callbacks.closed || callbacks.error) {
          return;
        }
        streams.delete(streamID);
        callbacks.error = error;
        callbacks.onError?.(error);
      };
      request.once('response', (headers) => {
        transport.markInbound();
        const status = Number(headers[':status'] ?? 0);
        if (status === 200) {
          readySettled = true;
          resolveReady();
          return;
        }
        const streamError = runtimePlacementBridgeStreamError(headerText(
          headers,
          RUNTIME_PLACEMENT_BRIDGE_ERROR_CODE_HEADER,
        ));
        failStream(new RuntimePlacementBridgeHTTP2Error(streamError.message));
        request.resume();
      });
      request.on('data', (chunk: Buffer | string) => {
        transport.markInbound();
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        request.pause();
        readTail = readTail.then(async () => {
          await callbacks.onData?.(value);
        }).catch((error: unknown) => {
          const normalized = normalizeError(error);
          failStream(normalized);
          request.close(HTTP2_CONSTANTS.NGHTTP2_CANCEL);
        }).finally(() => {
          if (!request.destroyed && !callbacks.error) {
            request.resume();
          }
        });
      });
      request.once('end', () => {
        transport.markInbound();
        void readTail.finally(() => {
          streams.delete(streamID);
          callbacks.closed = true;
          callbacks.onClose?.();
        });
      });
      request.once('error', (error) => {
        failStream(new RuntimePlacementBridgeHTTP2Error(
          'Runtime Placement Bridge HTTP/2 stream failed.',
          { cause: error },
        ));
      });
      let writeTail: Promise<void> = ready;
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
        write: (chunk) => {
          const writeTask = writeTail.then(async () => {
            if (
              closed
              || currentTransport?.id !== transport.id
              || !streams.has(streamID)
            ) {
              throw new Error('Runtime Placement Bridge stream is closed.');
            }
            await writeHTTP2Stream(request, chunk);
          });
          writeTail = writeTask.catch(() => undefined);
          return writeTask;
        },
        closeWrite: async () => {
          await writeTail.catch(() => undefined);
          if (!request.destroyed && !request.writableEnded) {
            request.end();
          }
        },
        close: async () => {
          const wasOpen = streams.delete(streamID);
          if (closed || !wasOpen || currentTransport?.id !== transport.id) {
            return;
          }
          request.close(HTTP2_CONSTANTS.NGHTTP2_CANCEL);
          await writeTail.catch(() => undefined);
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
    recoveryWaitController?.abort(error ?? new DOMException('Bridge session closed.', 'AbortError'));
    recoveryWaitController = null;
    const failure = error ? recoveryFailureFromError(error) : null;
    if (failure) {
      publishRecovery({
        generation: recoverySnapshot.generation || 1,
        phase: 'failed',
        attempt_count: recoverySnapshot.attempt_count,
        started_at_unix_ms: recoverySnapshot.started_at_unix_ms ?? Date.now(),
        failure,
        actions: ['open_connection_center'],
      });
    }
    // The bridge process owns every active proxy stream. Stop it before
    // waiting for proxy teardown so a lingering HTTP connection cannot hold
    // lifecycle completion open indefinitely.
    transport?.session.destroy();
    transport?.connection.destroy();
    transport?.command.kill('SIGTERM');
    failActiveStreams(error ?? new Error('Runtime Placement Bridge session is closed.'));
    await Promise.all([
      proxyClose?.().catch(() => undefined) ?? Promise.resolve(),
      transport?.command.closed.catch(() => undefined) ?? Promise.resolve(),
    ]);
    recoveryListeners.clear();
    resolveClosed(failure ? { kind: 'failed', failure } : { kind: 'closed' });
  };

  const runTransportLoop = async (transport: RemoteBridgeTransport): Promise<void> => {
    const terminalError = await transport.closed;
    if (closed || currentTransport?.id !== transport.id) {
      return;
    }
    currentTransport = null;
    if (args.host_access.kind === 'ssh_host' && transportFailureIsRecoverable(terminalError)) {
      const nextGeneration = recoverySnapshot.generation + 1;
      const firstDelayMS = recoveryBackoffMS[0] ?? DEFAULT_BRIDGE_RECOVERY_BACKOFF_MS[0];
      const now = Date.now();
      publishRecovery({
        generation: nextGeneration,
        phase: 'waiting',
        attempt_count: 0,
        started_at_unix_ms: now,
        next_attempt_at_unix_ms: now + firstDelayMS,
        failure: recoveryFailureFromError(terminalError),
        actions: ['retry_now'],
      });
    }
    failActiveStreams(new Error('Runtime Placement Bridge is temporarily unavailable.'));
    transport.session.destroy();
    transport.connection.destroy();
    await closeStreamingCommand(transport.command);
    if (sessionController.signal.aborted || args.signal?.aborted) {
      await settleBridgeSession();
      return;
    }
    if (args.host_access.kind !== 'ssh_host' || !transportFailureIsRecoverable(terminalError)) {
      await settleBridgeSession(terminalError);
      return;
    }
    startRecovery();
  };

  const attachTransport = (transport: RemoteBridgeTransport) => {
    currentTransport = transport;
    void runTransportLoop(transport);
  };

  const recover = async (): Promise<void> => {
    const expectedIdentity = initialTransport.identity;
    if (!expectedIdentity) {
      await settleBridgeSession(new Error('Runtime Placement Bridge recovery requires a remote process identity.'));
      return;
    }
    const wait = args.recovery_scheduler?.wait ?? waitForRecovery;
    let attempt = 0;
    while (!closed && !sessionController.signal.aborted) {
      const delayMS = recoveryBackoffMS[Math.min(attempt, recoveryBackoffMS.length - 1)] ?? 30_000;
      if (!recoveryRetryRequested) {
        publishRecovery({
          generation: recoverySnapshot.generation,
          phase: 'waiting',
          attempt_count: attempt,
          started_at_unix_ms: recoverySnapshot.started_at_unix_ms ?? Date.now(),
          next_attempt_at_unix_ms: Date.now() + delayMS,
          ...(recoverySnapshot.failure ? { failure: recoverySnapshot.failure } : {}),
          actions: ['retry_now'],
        });
        const waitController = new AbortController();
        recoveryWaitController = waitController;
        const abortWait = () => {
          if (!waitController.signal.aborted) {
            waitController.abort(sessionController.signal.reason ?? abortError());
          }
        };
        sessionController.signal.addEventListener('abort', abortWait, { once: true });
        try {
          await wait(delayMS, waitController.signal);
        } catch (error) {
          if (!(error instanceof RuntimePlacementBridgeRetryNowError)) {
            return;
          }
        } finally {
          sessionController.signal.removeEventListener('abort', abortWait);
          if (recoveryWaitController === waitController) {
            recoveryWaitController = null;
          }
        }
      }
      recoveryRetryRequested = false;
      if (closed || sessionController.signal.aborted) {
        return;
      }
      attempt += 1;
      publishRecovery({
        generation: recoverySnapshot.generation,
        phase: 'connecting',
        attempt_count: attempt,
        started_at_unix_ms: recoverySnapshot.started_at_unix_ms ?? Date.now(),
        ...(recoverySnapshot.failure ? { failure: recoverySnapshot.failure } : {}),
        actions: [],
      });
      try {
        const transport = await openRemoteBridgeTransport(
          args,
          sessionController.signal,
          nextTransportID++,
        );
        if (!transport.identity || !bridgeProcessIdentityMatches(expectedIdentity, transport.identity)) {
          transport.session.destroy();
          transport.connection.destroy();
          await closeStreamingCommand(transport.command);
          throw new RuntimePlacementBridgeIdentityChangedError(
            'The remote Runtime or Gateway process identity changed while Desktop was reconnecting.',
          );
        }
        attachTransport(transport);
        publishRecovery({
          generation: recoverySnapshot.generation,
          phase: 'ready',
          attempt_count: attempt,
          started_at_unix_ms: recoverySnapshot.started_at_unix_ms ?? Date.now(),
          recovered_at_unix_ms: Date.now(),
          actions: [],
        });
        return;
      } catch (error) {
        const normalized = normalizeError(error);
        if (
          normalized instanceof RuntimePlacementBridgeIdentityChangedError
          || normalized instanceof DesktopSSHTransportAuthenticationError
        ) {
          await settleBridgeSession(normalized);
          return;
        }
        if (!transportFailureIsRecoverable(normalized)) {
          await settleBridgeSession(normalized);
          return;
        }
        publishRecovery({
          generation: recoverySnapshot.generation,
          phase: 'waiting',
          attempt_count: attempt,
          started_at_unix_ms: recoverySnapshot.started_at_unix_ms ?? Date.now(),
          failure: recoveryFailureFromError(normalized),
          actions: ['retry_now'],
        });
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
    initialTransport.session.destroy();
    initialTransport.connection.destroy();
    await closeStreamingCommand(initialTransport.command);
    args.signal?.removeEventListener('abort', abortSession);
    throw error;
  }
  proxyClose = proxy?.close ?? null;
  attachTransport(initialTransport);

  const hello = initialTransport.hello;
  const localUIURL = proxy?.url ?? '';
  const localUIBridgeToken = requireLocalUI
    ? normalizeDesktopPrivateBridgeToken(hello.local_ui.bridge_token)
    : '';
  if (requireLocalUI && localUIBridgeToken === '') {
    await settleBridgeSession(new Error('Runtime Placement Bridge is missing private Local UI authorization.'));
    throw new Error('Runtime Placement Bridge is missing private Local UI authorization.');
  }
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
    ...(localUIURL ? { local_ui_bridge_url: localUIURL } : {}),
    ...(localUIBridgeToken ? { local_ui_bridge_token: localUIBridgeToken } : {}),
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    effective_run_mode: runtimeService?.effective_run_mode,
    remote_enabled: runtimeService?.remote_enabled,
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
      runtime_kind: args.host_access.kind === 'ssh_host'
        ? 'ssh'
        : args.host_access.kind === 'wsl_host'
          ? 'wsl'
          : 'local_environment',
      launch_mode: args.host_access.kind === 'wsl_host' ? 'wsl' : 'spawned',
      stop,
    },
    closed: closedPromise,
    getRecoverySnapshot: () => recoverySnapshot,
    subscribeRecovery: (listener) => {
      recoveryListeners.add(listener);
      listener(recoverySnapshot);
      return () => {
        recoveryListeners.delete(listener);
      };
    },
    requestRecoveryNow: () => {
      if (closed || recoverySnapshot.phase !== 'waiting') {
        return false;
      }
      recoveryRetryRequested = true;
      recoveryWaitController?.abort(new RuntimePlacementBridgeRetryNowError());
      return true;
    },
    disconnect: stop,
    stop,
  };
}
