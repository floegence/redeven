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

function createMockBridgeCommand() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let settleClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => {
    settleClosed = resolve;
  });
  const kill = vi.fn((_signal?: NodeJS.Signals) => {
    stdout.end();
    stderr.end();
    stdin.end();
    settleClosed?.();
  });
  return {
    stdin,
    stdout,
    stderr,
    closed,
    kill,
  };
}

function writeHello(stdout: PassThrough): void {
  stdout.write(encodeRuntimePlacementBridgeFrame({
    type: 'hello',
    stream_id: 'bridge',
    payload: {
      protocol_version: 'redeven-desktop-bridge-v1',
      runtime_version: 'v0.0.0-test',
      started_at_unix_ms: 1778751234567,
      local_ui: {
        available: true,
        base_path: '/',
      },
      runtime_control: {
        available: true,
        protocol_version: 'redeven-runtime-control-v1',
        token: 'runtime-control-token',
        desktop_owner_id: 'desktop-owner',
      },
    },
  }));
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
  hostAccessMocks.spawnSSHRuntimeHostCommand.mockImplementationOnce((_ssh, _command, options) => {
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
        expect.objectContaining({ ssh_destination: 'los' }),
        expect.arrayContaining(['sh', '-c']),
        expect.objectContaining({ signal: undefined }),
      );
    } finally {
      await session.disconnect();
    }
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
