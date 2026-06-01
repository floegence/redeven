import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDesktopFlowerHostPlaintextSecretCodec,
  defaultDesktopFlowerHostPaths,
} from './desktopFlowerHostState';

type MockChild = EventEmitter & {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  exitCode: number | null;
  signalCode: string | null;
  kill: (signal: string) => boolean;
};

const spawnedChildren: MockChild[] = [];
const spawnCalls: Array<{
  executable: string;
  args: readonly string[];
  options: { env?: NodeJS.ProcessEnv };
}> = [];
let startupMode: 'ready' | 'blocked' = 'ready';
let startupAttached = false;
let secretResolverClosed = false;
let fetchStatusOK = true;

vi.mock('node:child_process', () => ({
  spawn: vi.fn((executable: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ executable, args, options });
    const child = new EventEmitter() as MockChild;
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((signal: string) => {
      child.signalCode = signal;
      setImmediate(() => child.emit('exit', null, signal));
      return true;
    });
    spawnedChildren.push(child);
    const reportIndex = args.indexOf('--startup-report-file');
    const reportFile = reportIndex >= 0 ? args[reportIndex + 1] : '';
    if (reportFile) {
      setImmediate(async () => {
        await fs.mkdir(path.dirname(reportFile), { recursive: true });
        await fs.writeFile(reportFile, JSON.stringify(startupMode === 'blocked'
          ? { status: 'blocked', code: 'flower_host_locked', message: 'Flower Host is already running.' }
          : { status: 'ready', host_id: 'host', base_url: 'http://127.0.0.1:12345', token: 'host-token', attached: startupAttached }));
      });
    }
    return child;
  }),
}));

vi.mock('./flowerHostSecretResolver', () => ({
  startFlowerHostSecretResolver: vi.fn(async () => ({
    baseURL: 'http://127.0.0.1:34567',
    token: 'resolver-token',
    close: async () => {
      secretResolverClosed = true;
    },
  })),
}));

beforeEach(() => {
  startupMode = 'ready';
  startupAttached = false;
  secretResolverClosed = false;
  fetchStatusOK = true;
  spawnedChildren.splice(0);
  spawnCalls.splice(0);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    if (String(input).endsWith('/v1/status') && fetchStatusOK) {
      return new Response(JSON.stringify({ ok: true, data: { status: { configured: true } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: false, error: 'host unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterEach(async () => {
  const bridge = await import('./flowerHostBridge');
  await bridge.shutdownFlowerHostBridge();
  vi.unstubAllGlobals();
});

function bridgeArgs(root: string) {
  return {
    executablePath: '/tmp/redeven-test',
    paths: defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored'),
    codec: createDesktopFlowerHostPlaintextSecretCodec(),
    tempRoot: root,
  };
}

describe('Flower Host bridge lifecycle', () => {
  it('passes secret resolver tokens through environment variables and stops the host on shutdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');

      const client = await bridge.ensureFlowerHostBridge(bridgeArgs(root));

      expect(client.baseURL).toBe('http://127.0.0.1:12345');
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.args).not.toContain('--auth-token');
      expect(spawnCalls[0]?.args).not.toContain('--secret-resolver-token');
      expect(spawnCalls[0]?.args).toContain('--secret-resolver-token-env');
      expect(spawnCalls[0]?.options.env?.REDEVEN_FLOWER_HOST_SECRET_RESOLVER_TOKEN).toBe('resolver-token');

      await bridge.shutdownFlowerHostBridge();

      expect(spawnedChildren[0]?.kill).toHaveBeenCalledWith('SIGTERM');
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces blocked startup reports with their specific reason', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupMode = 'blocked';
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.ensureFlowerHostBridge(bridgeArgs(root)))
        .rejects
        .toThrow('flower_host_locked: Flower Host is already running.');
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('attaches to an existing host without terminating the owner process on shutdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupAttached = true;
    try {
      const bridge = await import('./flowerHostBridge');

      const client = await bridge.ensureFlowerHostBridge(bridgeArgs(root));

      expect(client.baseURL).toBe('http://127.0.0.1:12345');
      expect(spawnedChildren[0]?.kill).toHaveBeenCalledTimes(1);
      await bridge.shutdownFlowerHostBridge();

      expect(spawnedChildren[0]?.kill).toHaveBeenCalledTimes(1);
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('restarts discovery when an attached host stops responding', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupAttached = true;
    try {
      const bridge = await import('./flowerHostBridge');

      await bridge.ensureFlowerHostBridge(bridgeArgs(root));
      fetchStatusOK = false;
      await expect(bridge.ensureFlowerHostBridge(bridgeArgs(root))).rejects.toThrow('Flower Host request failed with HTTP 503.');

      expect(spawnCalls).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
