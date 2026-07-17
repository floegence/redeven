import net from 'node:net';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const hostAccessMocks = vi.hoisted(() => ({
  spawnLocalRuntimeHostCommand: vi.fn(),
  spawnSSHRuntimeHostCommand: vi.fn(),
}));

vi.mock('./runtimeHostAccess', async () => {
  const actual = await vi.importActual<typeof import('./runtimeHostAccess')>('./runtimeHostAccess');
  return {
    ...actual,
    spawnLocalRuntimeHostCommand: hostAccessMocks.spawnLocalRuntimeHostCommand,
    spawnSSHRuntimeHostCommand: hostAccessMocks.spawnSSHRuntimeHostCommand,
  };
});

import {
  encodeRuntimePlacementBridgeFrame,
  readRuntimePlacementBridgeFrame,
} from './runtimePlacementBridgeProtocol';
import { startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import { DesktopSSHTransportInterruptedError } from './sshTransportManager';

function createMockBridgeCommand() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let settleClosed: (() => void) | null = null;
  let rejectClosed: ((error: Error) => void) | null = null;
  let settled = false;
  const closed = new Promise<void>((resolve, reject) => {
    settleClosed = resolve;
    rejectClosed = reject;
  });
  const settle = (error?: Error) => {
    if (settled) return;
    settled = true;
    stdout.end();
    stderr.end();
    stdin.end();
    if (error) {
      rejectClosed?.(error);
    } else {
      settleClosed?.();
    }
  };
  const kill = vi.fn((_signal?: NodeJS.Signals) => {
    settle();
  });
  return {
    stdin,
    stdout,
    stderr,
    closed,
    kill,
    interrupt: (error: Error) => settle(error),
  };
}

function writeHello(
  stdout: PassThrough,
  options: Readonly<{
    startedAtUnixMS?: number;
    runtimeVersion?: string;
    runtimeControlProtocolVersion?: string;
    desktopOwnerID?: string;
    runtimeControlToken?: string;
  }> = {},
): void {
  stdout.write(encodeRuntimePlacementBridgeFrame({
    type: 'hello',
    stream_id: 'bridge',
    payload: {
      protocol_version: 'redeven-desktop-bridge-v1',
      runtime_version: options.runtimeVersion ?? 'v0.0.0-test',
      started_at_unix_ms: options.startedAtUnixMS ?? 1778751234567,
      local_ui: {
        available: true,
        base_path: '/',
      },
      runtime_control: {
        available: true,
        protocol_version: options.runtimeControlProtocolVersion ?? 'redeven-runtime-control-v1',
        token: options.runtimeControlToken ?? 'runtime-control-token',
        desktop_owner_id: options.desktopOwnerID ?? 'desktop-owner',
      },
    },
  }));
}

function writeGatewayHello(
  stdout: PassThrough,
  options: Readonly<{
    stateRoot?: string;
    executablePath?: string;
    servicePID?: number;
    managedBridgeToken?: string;
  }> = {},
): void {
  stdout.write(encodeRuntimePlacementBridgeFrame({
    type: 'hello',
    stream_id: 'bridge',
    payload: {
      protocol_version: 'redeven-desktop-bridge-v1',
      runtime_version: 'v0.0.0-test',
      started_at_unix_ms: Date.now(),
      local_ui: { available: false, base_path: '/' },
      runtime_control: { available: false },
      gateway_service: {
        state_root: options.stateRoot ?? '/home/dev/.redeven/gateways/gw/state',
        executable_path: options.executablePath ?? '/home/dev/.redeven/gateway/managed/bin/redeven-gateway',
        service_pid: options.servicePID ?? 4242,
        managed_bridge_token: options.managedBridgeToken ?? 'managed-bridge-token',
      },
    },
  }));
}

function recoveryGate() {
  let release: (() => void) | null = null;
  const wait = vi.fn((_delayMS: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Canceled.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    release = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
  }));
  return {
    wait,
    release: () => release?.(),
  };
}

async function waitForCondition(condition: () => boolean, timeoutMS = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMS;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

async function connectLoopback(rawURL: string): Promise<net.Socket> {
  const url = new URL(rawURL);
  const socket = net.createConnection(Number(url.port), '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function readSocketUntilClose(socket: net.Socket): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.once('end', resolve);
    socket.once('close', resolve);
    socket.once('error', reject);
  });
  return Buffer.concat(chunks);
}

async function waitForClosedSocket(socket: net.Socket): Promise<void> {
  if (socket.destroyed) {
    return;
  }
  await new Promise<void>((resolve) => {
    socket.once('close', resolve);
  });
}

async function startMockedSession(command: ReturnType<typeof createMockBridgeCommand>) {
  hostAccessMocks.spawnLocalRuntimeHostCommand.mockImplementationOnce(() => command);
  const task = startRuntimePlacementBridgeSession({
    host_access: { kind: 'local_host' },
    placement: { kind: 'host_process', runtime_root: '' },
    desktop_owner_id: 'desktop-owner',
    fallback_local_id: 'local-env',
  });
  writeHello(command.stdout);
  return task;
}

async function startMockedSSHSession(
  command: ReturnType<typeof createMockBridgeCommand>,
  signal?: AbortSignal,
) {
  hostAccessMocks.spawnSSHRuntimeHostCommand.mockImplementationOnce((_manager, _ssh, _command, options) => {
    options?.signal?.addEventListener('abort', () => command.kill('SIGTERM'), { once: true });
    return command;
  });
  const task = startRuntimePlacementBridgeSession({
    host_access: {
      kind: 'ssh_host',
      ssh: {
        ssh_destination: 'los',
        ssh_port: 22,
        auth_mode: 'key_agent',
        connect_timeout_seconds: 10,
      },
    },
    placement: { kind: 'host_process', runtime_root: '~/.redeven' },
    runtime_binary_path: '~/.redeven',
    desktop_owner_id: 'desktop-owner',
    fallback_local_id: 'los',
    ssh_credential_scope: 'los',
    ssh_transport_manager: {
      acquire: vi.fn(),
      dispose: vi.fn(),
    },
    signal,
  });
  writeHello(command.stdout);
  return task;
}

async function bridgeHTTPRoundTrip(input: Readonly<{
  command: ReturnType<typeof createMockBridgeCommand>;
  localUIURL: string;
  request: string;
  expectedRequestLine: RegExp;
  response: string;
}>): Promise<Buffer> {
  const socket = await connectLoopback(input.localUIURL);
  try {
    socket.write(input.request);
    const openFrame = await readRuntimePlacementBridgeFrame(input.command.stdin);
    expect(openFrame?.header.type).toBe('stream_open');
    const streamID = openFrame?.header.stream_id ?? '';
    const dataFrame = await readRuntimePlacementBridgeFrame(input.command.stdin);
    expect(dataFrame?.payload.toString('latin1')).toMatch(input.expectedRequestLine);
    input.command.stdout.write(encodeRuntimePlacementBridgeFrame({
      type: 'stream_data',
      stream_id: streamID,
      payload: input.response,
    }));
    input.command.stdout.write(encodeRuntimePlacementBridgeFrame({
      type: 'stream_close',
      stream_id: streamID,
    }));
    return await readSocketUntilClose(socket);
  } finally {
    socket.destroy();
  }
}

describe('runtimePlacementBridgeSession lifecycle', () => {
  it('carries bridge runtime startup time into the session startup report', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSession(command);
    try {
      expect(session.startup.started_at_unix_ms).toBe(1778751234567);
    } finally {
      await session.disconnect();
    }
  });

  it('bridges loopback HTTP traffic through real placement bridge frames', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSession(command);
    const socket = await connectLoopback(session.local_ui_url);
    try {
      socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');

      const openFrame = await readRuntimePlacementBridgeFrame(command.stdin);
      expect(openFrame?.header.type).toBe('stream_open');
      const streamID = openFrame?.header.stream_id ?? '';
      expect(JSON.parse(openFrame?.payload.toString('utf8') ?? '{}')).toEqual({ surface: 'local_ui' });

      const dataFrame = await readRuntimePlacementBridgeFrame(command.stdin);
      expect(dataFrame?.header).toMatchObject({
        stream_id: streamID,
        type: 'stream_data',
      });
      expect(dataFrame?.payload.toString('latin1')).toMatch(/^GET \//u);

      command.stdout.write(encodeRuntimePlacementBridgeFrame({
        type: 'stream_data',
        stream_id: streamID,
        payload: 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
      }));
      command.stdout.write(encodeRuntimePlacementBridgeFrame({
        type: 'stream_close',
        stream_id: streamID,
      }));

      await expect(readSocketUntilClose(socket)).resolves.toEqual(Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
        'latin1',
      ));
    } finally {
      socket.destroy();
      await session.disconnect();
    }
  });

  it('bridges runtime-control provider-link traffic through real placement bridge frames', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSession(command);
    const socket = await connectLoopback(session.local_ui_url);
    try {
      socket.write('POST /__redeven_runtime_control/v1/provider-link/connect HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}');

      const openFrame = await readRuntimePlacementBridgeFrame(command.stdin);
      expect(openFrame?.header.type).toBe('stream_open');
      const streamID = openFrame?.header.stream_id ?? '';
      expect(JSON.parse(openFrame?.payload.toString('utf8') ?? '{}')).toEqual({ surface: 'runtime_control' });

      const dataFrame = await readRuntimePlacementBridgeFrame(command.stdin);
      expect(dataFrame?.header).toMatchObject({
        stream_id: streamID,
        type: 'stream_data',
      });
      expect(dataFrame?.payload.toString('latin1')).toMatch(/^POST \/v1\/provider-link\/connect HTTP\/1\.1/u);

      command.stdout.write(encodeRuntimePlacementBridgeFrame({
        type: 'stream_data',
        stream_id: streamID,
        payload: 'HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{"ok":true}',
      }));
      command.stdout.write(encodeRuntimePlacementBridgeFrame({
        type: 'stream_close',
        stream_id: streamID,
      }));

      await expect(readSocketUntilClose(socket)).resolves.toEqual(Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{"ok":true}',
        'latin1',
      ));
    } finally {
      socket.destroy();
      await session.disconnect();
    }
  });

  it('opens SSH Env App health, shell, asset, and WebSocket traffic through one placement bridge', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSSHSession(command);
    try {
      const healthResponse = await bridgeHTTPRoundTrip({
        command,
        localUIURL: session.local_ui_url,
        request: 'GET /api/local/runtime/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        expectedRequestLine: /^GET \/api\/local\/runtime\/health HTTP\/1\.1/u,
        response: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{"ok":true}',
      });
      expect(healthResponse.toString('latin1')).toContain('{"ok":true}');

      const shellResponse = await bridgeHTTPRoundTrip({
        command,
        localUIURL: session.local_ui_url,
        request: 'GET /_redeven_proxy/env/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        expectedRequestLine: /^GET \/_redeven_proxy\/env\/ HTTP\/1\.1/u,
        response: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 15\r\nConnection: close\r\n\r\n<div id="root">',
      });
      expect(shellResponse.toString('latin1')).toContain('<div id="root">');

      const assetResponse = await bridgeHTTPRoundTrip({
        command,
        localUIURL: session.local_ui_url,
        request: 'HEAD /_redeven_proxy/env/assets/index.js HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        expectedRequestLine: /^HEAD \/_redeven_proxy\/env\/assets\/index\.js HTTP\/1\.1/u,
        response: 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      });
      expect(assetResponse.toString('latin1')).toContain('HTTP/1.1 200 OK');

      const websocketResponse = await bridgeHTTPRoundTrip({
        command,
        localUIURL: session.local_ui_url,
        request: [
          'GET /api/local/runtime/events HTTP/1.1',
          'Host: 127.0.0.1',
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Key: test-websocket-key',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
        expectedRequestLine: /^GET \/api\/local\/runtime\/events HTTP\/1\.1/u,
        response: 'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      });
      expect(websocketResponse.toString('latin1')).toContain('101 Switching Protocols');

      expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledWith(
        expect.objectContaining({ acquire: expect.any(Function) }),
        expect.objectContaining({ ssh_destination: 'los' }),
        expect.arrayContaining(['sh', '-c']),
        expect.objectContaining({
          credentialScope: 'los',
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      await session.disconnect();
    }
  });

  it('keeps the loopback URL stable and resumes new requests after the same Runtime identity reconnects', async () => {
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
    const first = createMockBridgeCommand();
    const second = createMockBridgeCommand();
    const gate = recoveryGate();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockImplementationOnce((_manager, _ssh, _command, options) => {
        options.signal.addEventListener('abort', () => first.kill('SIGTERM'), { once: true });
        return first;
      })
      .mockImplementationOnce((_manager, _ssh, _command, options) => {
        options.signal.addEventListener('abort', () => second.kill('SIGTERM'), { once: true });
        writeHello(second.stdout);
        return second;
      });
    const task = startRuntimePlacementBridgeSession({
      host_access: {
        kind: 'ssh_host',
        ssh: {
          ssh_destination: 'los',
          ssh_port: 22,
          auth_mode: 'key_agent',
          connect_timeout_seconds: 10,
        },
      },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      runtime_binary_path: '~/.redeven',
      desktop_owner_id: 'desktop-owner',
      fallback_local_id: 'los',
      ssh_credential_scope: 'los',
      ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
      recovery_scheduler: { wait: gate.wait },
    });
    writeHello(first.stdout);
    const session = await task;
    const stableURL = session.local_ui_url;
    let sessionClosed = false;
    void session.closed.then(() => {
      sessionClosed = true;
    });
    const activeSocket = await connectLoopback(stableURL);
    activeSocket.on('error', () => undefined);
    try {
      activeSocket.write('GET /old HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      await readRuntimePlacementBridgeFrame(first.stdin);
      await readRuntimePlacementBridgeFrame(first.stdin);
      first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
      await waitForClosedSocket(activeSocket);
      await waitForCondition(() => gate.wait.mock.calls.length === 1);

      const unavailableSocket = await connectLoopback(stableURL);
      unavailableSocket.write('GET /during-recovery HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
      const unavailableResponse = await readSocketUntilClose(unavailableSocket);
      expect(unavailableResponse.toString('latin1')).toContain('HTTP/1.1 502 Bad Gateway');

      gate.release();
      await waitForCondition(() => hostAccessMocks.spawnSSHRuntimeHostCommand.mock.calls.length === 2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(session.local_ui_url).toBe(stableURL);
      expect(second.stdin.readableLength).toBe(0);
      expect(sessionClosed).toBe(false);

      const response = await bridgeHTTPRoundTrip({
        command: second,
        localUIURL: stableURL,
        request: 'GET /new HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n',
        expectedRequestLine: /^GET \/new HTTP\/1\.1/u,
        response: 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
      });
      expect(response.toString('latin1')).toContain('\r\n\r\nok');
    } finally {
      activeSocket.destroy();
      await session.disconnect();
    }
  });

  it('terminates Runtime recovery when the Runtime process identity changes', async () => {
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
    const first = createMockBridgeCommand();
    const second = createMockBridgeCommand();
    const gate = recoveryGate();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => {
        writeHello(second.stdout, { runtimeControlToken: 'replacement-token' });
        return second;
      });
    const task = startRuntimePlacementBridgeSession({
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'los', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
      },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      desktop_owner_id: 'desktop-owner',
      ssh_credential_scope: 'los',
      ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
      recovery_scheduler: { wait: gate.wait },
    });
    writeHello(first.stdout);
    const session = await task;
    first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
    await waitForCondition(() => gate.wait.mock.calls.length === 1);
    gate.release();
    await session.closed;
    expect(() => session.openStream('local_ui')).toThrow('Runtime Placement Bridge session is closed.');
    expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledTimes(2);
  });

  it('recovers a Gateway bridge only when its managed service identity is unchanged', async () => {
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
    const first = createMockBridgeCommand();
    const second = createMockBridgeCommand();
    const gate = recoveryGate();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => {
        writeGatewayHello(second.stdout);
        return second;
      });
    const task = startRuntimePlacementBridgeSession({
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'los', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
      },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      bridge_command_kind: 'gateway',
      require_local_ui: false,
      desktop_owner_id: 'desktop-owner',
      ssh_credential_scope: 'gateway-a',
      ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
      recovery_scheduler: { wait: gate.wait },
    });
    writeGatewayHello(first.stdout);
    const session = await task;
    try {
      first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
      await waitForCondition(() => gate.wait.mock.calls.length === 1);
      gate.release();
      await waitForCondition(() => hostAccessMocks.spawnSSHRuntimeHostCommand.mock.calls.length === 2);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stream = session.openStream('gateway_protocol');
      const frame = await readRuntimePlacementBridgeFrame(second.stdin);
      expect(frame?.header.type).toBe('stream_open');
      await stream.close();
    } finally {
      await session.disconnect();
    }
  });

  it('terminates Gateway recovery when the managed service PID changes', async () => {
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
    const first = createMockBridgeCommand();
    const second = createMockBridgeCommand();
    const gate = recoveryGate();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => {
        writeGatewayHello(second.stdout, { servicePID: 5252 });
        return second;
      });
    const task = startRuntimePlacementBridgeSession({
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'los', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
      },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      bridge_command_kind: 'gateway',
      require_local_ui: false,
      desktop_owner_id: 'desktop-owner',
      ssh_credential_scope: 'gateway-a',
      ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
      recovery_scheduler: { wait: gate.wait },
    });
    writeGatewayHello(first.stdout);
    const session = await task;
    first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
    await waitForCondition(() => gate.wait.mock.calls.length === 1);
    gate.release();
    await session.closed;
    expect(() => session.openStream('gateway_protocol')).toThrow('Runtime Placement Bridge session is closed.');
  });

  it('cancels pending bridge recovery when the session disconnects', async () => {
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
    const first = createMockBridgeCommand();
    const gate = recoveryGate();
    hostAccessMocks.spawnSSHRuntimeHostCommand.mockImplementationOnce(() => first);
    const task = startRuntimePlacementBridgeSession({
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'los', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 },
      },
      placement: { kind: 'host_process', runtime_root: '~/.redeven' },
      desktop_owner_id: 'desktop-owner',
      ssh_credential_scope: 'los',
      ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
      recovery_scheduler: { wait: gate.wait },
    });
    writeHello(first.stdout);
    const session = await task;
    first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
    await waitForCondition(() => gate.wait.mock.calls.length === 1);
    await session.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledTimes(1);
  });

  it('cancels the SSH bridge command and closes active proxy sockets', async () => {
    const command = createMockBridgeCommand();
    const abortController = new AbortController();
    const session = await startMockedSSHSession(command, abortController.signal);
    const socket = await connectLoopback(session.local_ui_url);
    try {
      abortController.abort();
      await session.closed;
      await waitForClosedSocket(socket);
      expect(command.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      socket.destroy();
      await session.disconnect();
    }
  });

  it('closes the loopback proxy and active sockets when the bridge command exits', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSession(command);
    const socket = await connectLoopback(session.local_ui_url);
    try {
      command.stdout.end();
      command.kill();
      await session.closed;
      await waitForClosedSocket(socket);

      expect(() => session.openStream('local_ui')).toThrow('Runtime Placement Bridge session is closed.');
    } finally {
      socket.destroy();
      await session.disconnect();
    }
  });
});
