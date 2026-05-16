import net from 'node:net';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

const hostAccessMocks = vi.hoisted(() => ({
  spawnLocalRuntimeHostCommand: vi.fn(),
}));

vi.mock('./runtimeHostAccess', async () => {
  const actual = await vi.importActual<typeof import('./runtimeHostAccess')>('./runtimeHostAccess');
  return {
    ...actual,
    spawnLocalRuntimeHostCommand: hostAccessMocks.spawnLocalRuntimeHostCommand,
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
  const kill = vi.fn(() => {
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
    placement: { kind: 'host_process', install_dir: '' },
    desktop_owner_id: 'desktop-owner',
    fallback_local_id: 'local-env',
  });
  writeHello(command.stdout);
  return task;
}

describe('runtimePlacementBridgeSession lifecycle', () => {
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

  it('closes the loopback proxy and active sockets when the bridge command exits', async () => {
    const command = createMockBridgeCommand();
    const session = await startMockedSession(command);
    const socket = await connectLoopback(session.local_ui_url);
    try {
      command.stdout.end();
      command.kill();
      await waitForClosedSocket(socket);

      expect(() => session.openStream('local_ui')).toThrow('Runtime Placement Bridge session is closed.');
    } finally {
      socket.destroy();
      await session.disconnect();
    }
  });
});
