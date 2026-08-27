import {
  createServer as createHTTP2Server,
  type IncomingHttpHeaders,
  type ServerHttp2Session,
  type ServerHttp2Stream,
} from 'node:http2';
import net from 'node:net';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION } from './runtimePlacementBridgeProtocol';
import { startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import {
  DesktopSSHTransportAuthenticationError,
  DesktopSSHTransportInterruptedError,
} from './sshTransportManager';

type MockBridgeCommand = Awaited<ReturnType<typeof createMockBridgeCommand>>;

type MockBridgeOptions = Readonly<{
  startedAtUnixMS?: number;
  runtimeControlToken?: string;
  onConnect?: (stream: ServerHttp2Stream, authority: string) => boolean;
}>;

async function createMockBridgeCommand(options: MockBridgeOptions = {}) {
  const server = createHTTP2Server({
    settings: { enablePush: false, maxConcurrentStreams: 64 },
  });
  const sessions = new Set<ServerHttp2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
  });
  server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    const method = String(headers[':method'] ?? '');
    const authority = String(headers[':authority'] ?? '');
    const path = String(headers[':path'] ?? '');
    if (method === 'GET' && authority === 'redeven-placement' && path === '/redeven/placement/v1/hello') {
      stream.respond({ ':status': 200, 'content-type': 'application/json' });
      stream.end(JSON.stringify({
        protocol_version: RUNTIME_PLACEMENT_BRIDGE_PROTOCOL_VERSION,
        runtime_version: 'v0.12.0-test',
        started_at_unix_ms: options.startedAtUnixMS ?? 1778751234567,
        local_ui: {
          available: true,
          base_path: '/',
          bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
        runtime_control: {
          available: true,
          protocol_version: 'redeven-runtime-control-v2',
          token: options.runtimeControlToken ?? 'runtime-control-token',
        },
      }));
      return;
    }
    if (method !== 'CONNECT' || !['local-ui', 'runtime-control', 'gateway-protocol'].includes(authority)) {
      stream.respond({ ':status': 404, 'x-redeven-placement-error-code': 'SURFACE_UNAVAILABLE' });
      stream.end();
      return;
    }
    if (options.onConnect?.(stream, authority)) {
      return;
    }
    stream.respond({ ':status': 200 });
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('end', () => {
      const request = Buffer.concat(chunks).toString('latin1');
      const body = request.includes('HTTP/1.1') ? authority : 'invalid-request';
      stream.end([
        'HTTP/1.1 200 OK',
        `Content-Length: ${Buffer.byteLength(body)}`,
        'Connection: close',
        '',
        body,
      ].join('\r\n'));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock bridge did not listen on TCP.');
  }
  const socket = net.createConnection(address.port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  const stderr = new PassThrough();
  let settled = false;
  let resolveClosed!: () => void;
  let rejectClosed!: (error: Error) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  const finish = (error?: Error) => {
    if (settled) {
      return;
    }
    settled = true;
    for (const session of sessions) {
      session.destroy();
    }
    socket.destroy();
    server.close();
    stderr.end();
    if (error) {
      rejectClosed(error);
    } else {
      resolveClosed();
    }
  };
  socket.once('close', () => finish());
  const kill = vi.fn((_signal?: NodeJS.Signals) => finish());
  return {
    stdin: socket,
    stdout: socket,
    stderr,
    closed,
    kill,
    interrupt: (error: Error) => finish(error),
    goaway: () => {
      for (const session of sessions) {
        session.goaway();
      }
    },
  };
}

function sshArgs(wait: (delayMS: number, signal: AbortSignal) => Promise<void> = async () => undefined) {
  return {
    host_access: {
      kind: 'ssh_host' as const,
      ssh: {
        ssh_destination: 'los',
        ssh_port: 22,
        auth_mode: 'key_agent' as const,
        connect_timeout_seconds: 10,
      },
    },
    placement: { kind: 'host_process' as const, runtime_root: '~/.redeven' },
    runtime_binary_path: '~/.redeven',
    fallback_local_id: 'los',
    ssh_credential_scope: 'los',
    ssh_transport_manager: { acquire: vi.fn(), dispose: vi.fn() },
    recovery_scheduler: { wait },
  };
}

async function startLocalSession(command: MockBridgeCommand) {
  hostAccessMocks.spawnLocalRuntimeHostCommand.mockResolvedValueOnce(command);
  return startRuntimePlacementBridgeSession({
    host_access: { kind: 'local_host' },
    placement: { kind: 'host_process', runtime_root: '' },
    fallback_local_id: 'local-env',
  });
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
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('end', resolve);
    socket.once('close', resolve);
    socket.once('error', reject);
  });
  return Buffer.concat(chunks);
}

async function waitForCondition(condition: () => boolean, timeoutMS = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMS;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

beforeEach(() => {
  hostAccessMocks.spawnLocalRuntimeHostCommand.mockReset();
  hostAccessMocks.spawnSSHRuntimeHostCommand.mockReset();
});

describe('runtime placement HTTP/2 session lifecycle', () => {
  it('uses one exec and one HTTP/2 session while loopback connections become independent streams', async () => {
    const command = await createMockBridgeCommand();
    const session = await startLocalSession(command);
    try {
      expect(session.startup.started_at_unix_ms).toBe(1778751234567);
      const first = await connectLoopback(session.local_ui_url);
      const second = await connectLoopback(session.local_ui_url);
      const firstResponseTask = readSocketUntilClose(first);
      const secondResponseTask = readSocketUntilClose(second);
      first.end('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
      second.end('GET /two HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
      const [firstResponse, secondResponse] = await Promise.all([
        firstResponseTask,
        secondResponseTask,
      ]);
      expect(firstResponse.toString('latin1')).toContain('\r\n\r\nlocal-ui');
      expect(secondResponse.toString('latin1')).toContain('\r\n\r\nlocal-ui');
      expect(hostAccessMocks.spawnLocalRuntimeHostCommand).toHaveBeenCalledTimes(1);
    } finally {
      await session.disconnect();
    }
  });

  it('lets stream B complete while stream A is blocked, then resets only stream A', async () => {
    const command = await createMockBridgeCommand({
      onConnect: (stream, authority) => {
        stream.respond({ ':status': 200 });
        if (authority === 'local-ui') {
          stream.pause();
        } else {
          stream.on('data', () => undefined);
          stream.once('end', () => stream.end('pong'));
        }
        return true;
      },
    });
    const session = await startLocalSession(command);
    try {
      const blocked = session.openStream('local_ui');
      const blockedWrite = blocked.write(Buffer.alloc(2 * 1024 * 1024, 0x61));
      let blockedCompleted = false;
      void blockedWrite.finally(() => {
        blockedCompleted = true;
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(blockedCompleted).toBe(false);

      const fast = session.openStream('runtime_control');
      const response = new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        fast.onData((chunk) => {
          chunks.push(chunk);
        });
        fast.onClose(() => resolve(Buffer.concat(chunks).toString('utf8')));
        fast.onError(reject);
      });
      await fast.write(Buffer.from('ping'));
      await fast.closeWrite?.();
      await expect(response).resolves.toBe('pong');
      expect(blockedCompleted).toBe(false);

      await blocked.close();
      await blockedWrite.catch(() => undefined);
      expect(session.getRecoverySnapshot().phase).toBe('ready');
      expect(hostAccessMocks.spawnLocalRuntimeHostCommand).toHaveBeenCalledTimes(1);
    } finally {
      await session.disconnect();
    }
  });

  it('recovers GOAWAY with exactly one new exec and preserves the loopback URL', async () => {
    const first = await createMockBridgeCommand();
    const second = await createMockBridgeCommand();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const session = await startRuntimePlacementBridgeSession(sshArgs());
    const stableURL = session.local_ui_url;
    try {
      first.goaway();
      await waitForCondition(() => hostAccessMocks.spawnSSHRuntimeHostCommand.mock.calls.length === 2);
      await waitForCondition(() => session.getRecoverySnapshot().phase === 'ready'
        && session.getRecoverySnapshot().generation === 1);
      expect(session.local_ui_url).toBe(stableURL);
      expect(first.kill).toHaveBeenCalledTimes(1);
    } finally {
      await session.disconnect();
    }
  });

  it('recovers a normally ended remote exec instead of creating a second recovery owner', async () => {
    const first = await createMockBridgeCommand();
    const second = await createMockBridgeCommand();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const session = await startRuntimePlacementBridgeSession(sshArgs());
    try {
      first.kill('SIGTERM');
      await waitForCondition(() => hostAccessMocks.spawnSSHRuntimeHostCommand.mock.calls.length === 2);
      await waitForCondition(() => session.getRecoverySnapshot().phase === 'ready'
        && session.getRecoverySnapshot().generation === 1);
      expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledTimes(2);
    } finally {
      await session.disconnect();
    }
  });

  it('fails closed when recovery reaches a different Runtime process identity', async () => {
    const first = await createMockBridgeCommand();
    const replacement = await createMockBridgeCommand({ runtimeControlToken: 'replacement-token' });
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(replacement);
    const session = await startRuntimePlacementBridgeSession(sshArgs());
    first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
    await expect(session.closed).resolves.toMatchObject({
      kind: 'failed',
      failure: { code: 'process_identity_changed' },
    });
    expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledTimes(2);
  });

  it('stops recovery immediately on authentication failure', async () => {
    const first = await createMockBridgeCommand();
    hostAccessMocks.spawnSSHRuntimeHostCommand
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new DesktopSSHTransportAuthenticationError('Authentication failed.'));
    const session = await startRuntimePlacementBridgeSession(sshArgs());
    first.interrupt(new DesktopSSHTransportInterruptedError('los:22', 1));
    await expect(session.closed).resolves.toMatchObject({
      kind: 'failed',
      failure: { code: 'authentication_failed' },
    });
    expect(hostAccessMocks.spawnSSHRuntimeHostCommand).toHaveBeenCalledTimes(2);
  });

  it('disconnects the HTTP/2 session, exec, and active loopback sockets once', async () => {
    const command = await createMockBridgeCommand({
      onConnect: (stream) => {
        stream.respond({ ':status': 200 });
        return true;
      },
    });
    const session = await startLocalSession(command);
    const socket = await connectLoopback(session.local_ui_url);
    socket.on('error', () => undefined);
    socket.write('GET /held HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await session.disconnect();
    await waitForCondition(() => socket.destroyed);
    expect(command.kill).toHaveBeenCalledTimes(1);
    await expect(session.closed).resolves.toEqual({ kind: 'closed' });
  });
});
