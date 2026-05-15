import type { Readable } from 'node:stream';

import {
  buildRuntimePlacementBridgePlan,
} from './runtimePlacementBridge';
import {
  spawnLocalRuntimeHostCommand,
  spawnSSHRuntimeHostCommand,
  type RuntimeHostStreamingCommand,
} from './runtimeHostAccess';
import { startRuntimePlacementLoopbackProxy } from './runtimePlacementLoopbackProxy';
import type { StartupReport } from './startup';
import type { DesktopSessionRuntimeHandle } from './sessionRuntime';
import type { DesktopRuntimeControlEndpoint } from '../shared/runtimeControl';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
  DesktopRuntimeTargetID,
} from '../shared/desktopRuntimePlacement';
import {
  desktopRuntimeTargetID,
} from '../shared/desktopRuntimePlacement';
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

type BridgeStreamCallbacks = {
  onData?: (chunk: Buffer) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  ready?: Promise<void>;
};

export type RuntimePlacementBridgeStream = Readonly<{
  id: string;
  onData: (callback: (chunk: Buffer) => void) => void;
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
  disconnect: () => Promise<void>;
  stop: () => Promise<void>;
}>;

export type StartRuntimePlacementBridgeSessionArgs = Readonly<{
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_binary_path?: string;
  desktop_owner_id: string;
  fallback_local_id?: string;
  signal?: AbortSignal;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function bindRecentLog(stream: Readable, onLog?: (chunk: string) => void): void {
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    onLog?.(chunk);
  });
}

function spawnBridgeCommand(args: StartRuntimePlacementBridgeSessionArgs): RuntimeHostStreamingCommand {
  const plan = buildRuntimePlacementBridgePlan({
    host_access: args.host_access,
    placement: args.placement,
    runtime_binary_path: args.runtime_binary_path,
  });
  const env = {
    REDEVEN_DESKTOP_OWNER_ID: compact(args.desktop_owner_id),
  };
  if (args.host_access.kind === 'ssh_host') {
    return spawnSSHRuntimeHostCommand(args.host_access.ssh, plan.command, {
      env,
      signal: args.signal,
    });
  }
  return spawnLocalRuntimeHostCommand(plan.command, {
    env,
    signal: args.signal,
  });
}

async function closeStreamingCommand(command: RuntimeHostStreamingCommand): Promise<void> {
  command.kill('SIGTERM');
  await command.closed.catch(() => undefined);
}

export async function startRuntimePlacementBridgeSession(
  args: StartRuntimePlacementBridgeSessionArgs,
): Promise<RuntimePlacementBridgeSession> {
  // IMPORTANT: Runtime Placement Bridge sessions are the only container runtime
  // access path. Do not add published-port, host-network, or provider-card
  // fallback paths around this bridge.
  const command = spawnBridgeCommand(args);
  void command.closed.catch(() => undefined);
  const streams = new Map<string, BridgeStreamCallbacks>();
  let closed = false;
  let proxyClose: (() => Promise<void>) | null = null;

  bindRecentLog(command.stderr);
  let hello: RuntimePlacementBridgeHello;
  try {
    const firstFrame = await readRuntimePlacementBridgeFrame(command.stdout);
    if (!firstFrame || firstFrame.header.type !== 'hello') {
      throw new Error('Runtime Placement Bridge did not send a hello frame.');
    }
    hello = parseRuntimePlacementBridgeHello(firstFrame.payload);
  } catch (error) {
    await closeStreamingCommand(command);
    throw error;
  }
  if (!hello.local_ui.available) {
    await closeStreamingCommand(command);
    throw new Error('Runtime Placement Bridge reported Local UI unavailable.');
  }

  void (async () => {
    for (;;) {
      const frame = await readRuntimePlacementBridgeFrame(command.stdout);
      if (!frame) {
        break;
      }
      const callbacks = streams.get(frame.header.stream_id);
      if (!callbacks) {
        continue;
      }
      if (frame.header.type === 'stream_data') {
        callbacks.onData?.(frame.payload);
      } else if (frame.header.type === 'stream_close') {
        streams.delete(frame.header.stream_id);
        callbacks.onClose?.();
      } else if (frame.header.type === 'stream_error') {
        streams.delete(frame.header.stream_id);
        const err = parseRuntimePlacementBridgeStreamError(frame.payload);
        callbacks.onError?.(new Error(`${err.code}: ${err.message}`));
      }
    }
    if (!closed) {
      closed = true;
      for (const callbacks of streams.values()) {
        callbacks.onClose?.();
      }
      streams.clear();
    }
  })().catch((error: unknown) => {
    closed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    for (const callbacks of streams.values()) {
      callbacks.onError?.(err);
    }
    streams.clear();
  });

  const bridgeHandle: RuntimePlacementBridgeSessionHandle = {
    openStream: (surface) => {
      if (closed) {
        throw new Error('Runtime Placement Bridge session is closed.');
      }
      const streamID = runtimePlacementBridgeStreamID(surface);
      const callbacks: BridgeStreamCallbacks = {};
      streams.set(streamID, callbacks);
      const ready = writeRuntimePlacementBridgeFrame(command.stdin, {
        type: 'stream_open',
        stream_id: streamID,
        payload: { surface },
      }).catch((error: unknown) => {
        streams.delete(streamID);
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
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
        },
        onError: (callback) => {
          callbacks.onError = callback;
        },
        write: async (chunk) => {
          await ready;
          await writeRuntimePlacementBridgeFrame(command.stdin, {
            type: 'stream_data',
            stream_id: streamID,
            payload: chunk,
          });
        },
        close: async () => {
          await ready.catch(() => undefined);
          streams.delete(streamID);
          await writeRuntimePlacementBridgeFrame(command.stdin, {
            type: 'stream_close',
            stream_id: streamID,
          });
        },
      };
    },
  };

  let proxy: Awaited<ReturnType<typeof startRuntimePlacementLoopbackProxy>>;
  try {
    proxy = await startRuntimePlacementLoopbackProxy(bridgeHandle);
  } catch (error) {
    await closeStreamingCommand(command);
    throw error;
  }
  proxyClose = proxy.close;
  const runtimeControl = runtimeControlEndpointFromBridgeHello(hello, proxy.url);
  const runtimeService = hello.runtime_service;
  const placementTargetID = desktopRuntimeTargetID(
    args.host_access,
    args.placement,
    args.fallback_local_id,
  );

  const disconnect = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await proxyClose?.().catch(() => undefined);
    for (const callbacks of streams.values()) {
      callbacks.onClose?.();
    }
    streams.clear();
    command.kill('SIGTERM');
    await command.closed.catch(() => undefined);
  };
  const stop = async () => {
    if (!closed) {
      await writeRuntimePlacementBridgeFrame(command.stdin, {
        type: 'shutdown_runtime',
        stream_id: 'bridge',
      }).catch(() => undefined);
    }
    await disconnect();
  };

  const startup: StartupReport = {
    local_ui_url: proxy.url,
    local_ui_urls: [proxy.url],
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    effective_run_mode: runtimeService?.effective_run_mode,
    remote_enabled: runtimeService?.remote_enabled,
    desktop_managed: true,
    desktop_owner_id: compact(args.desktop_owner_id),
    runtime_service: runtimeService,
  };

  return {
    ...bridgeHandle,
    placement_target_id: placementTargetID,
    host_access: args.host_access,
    placement: args.placement,
    hello,
    startup,
    local_ui_url: proxy.url,
    ...(runtimeControl ? { runtime_control: runtimeControl } : {}),
    ...(runtimeService ? { runtime_service: runtimeService } : {}),
    runtime_handle: {
      runtime_kind: args.host_access.kind === 'ssh_host' ? 'ssh' : 'local_environment',
      lifecycle_owner: 'desktop',
      launch_mode: 'spawned',
      stop,
    },
    disconnect,
    stop,
  };
}
