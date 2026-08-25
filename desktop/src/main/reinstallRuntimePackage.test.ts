import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeHostAccessExecutor } from './runtimeHostAccess';
import { createLocalRuntimeHostExecutor } from './runtimeHostAccess';
import { buildManagedSSHRuntimeProbeScript } from './sshRuntime';
import {
  MANAGED_RUNTIME_DIRECTORY_MODE,
  MANAGED_RUNTIME_EXECUTABLE_MODE,
  MANAGED_RUNTIME_METADATA_MODE,
  MANAGED_RUNTIME_STAMP_FILENAME,
  MANAGED_RUNTIME_STAMP_SCHEMA_VERSION,
} from './managedRuntimeSlot';
import {
  cleanupReinstallRuntimePackage,
  installReinstallRuntimePackage,
  prepareReinstallRuntimePackage,
  rollbackReinstallRuntimePackage,
  startReinstallRuntime,
  verifyReinstallRuntimeReady,
} from './reinstallRuntimePackage';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-reinstall-runtime-'));
  roots.push(root);
  return root;
}

async function runtimeArchive(root: string): Promise<Buffer> {
  const source = path.join(root, `runtime-package-${randomUUID()}`);
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'redeven'), '#!/bin/sh\necho redeven v1 abc\n');
  await fs.chmod(path.join(source, 'redeven'), 0o700);
  for (const companion of [
    '.redevplugin-release-artifacts-verified.json',
    'REDEVPLUGIN_THIRD_PARTY_NOTICES.md',
    'REDEVPLUGIN_RUNTIME.spdx.json',
    'redevplugin-runtime.provenance.json',
    'redevplugin-runtime.sig',
    'redevplugin-runtime.pem',
    'redevplugin-runtime',
  ]) {
    await fs.writeFile(path.join(source, companion), companion === 'redevplugin-runtime' ? '#!/bin/sh\n' : '{}');
  }
  await fs.chmod(path.join(source, 'redevplugin-runtime'), 0o700);
  const archive = path.join(root, `runtime-${randomUUID()}.tar.gz`);
  await execFile('tar', ['-czf', archive, '-C', source, '.']);
  return fs.readFile(archive);
}

function readyStatus(): string {
  return JSON.stringify({
    status: 'ready',
    local_ui_url: 'http://127.0.0.1:43123/',
    local_ui_urls: ['http://127.0.0.1:43123/'],
    local_ui_bridge_url: 'http://127.0.0.1:43124/',
    local_ui_bridge_token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    pid: 71,
    runtime_service: {
      runtime_version: 'v1',
      protocol_version: 'redeven-runtime-v2',
      compatibility_epoch: 9,
      compatibility: 'compatible',
      remote_enabled: false,
      open_readiness: { state: 'openable' },
      active_workload: {
        terminal_count: 0,
        session_count: 0,
        task_count: 0,
        port_forward_count: 0,
      },
    },
  });
}

function inventory(targetRoot: string, running: boolean): string {
  const binary = `${targetRoot}/runtime/managed/bin/redeven`;
  return JSON.stringify({
    schema_version: 1,
    target_root: targetRoot,
    inventory_digest: (running ? 'a' : 'b').repeat(64),
    instances: running ? [{
      pid: 71,
      process_started_at_unix_ms: 1_000,
      role: 'target_root_process',
      executable_path: binary,
      identity_status: 'verified',
      stop_authority: 'automatic',
    }] : [],
    summary: { automatic: running ? 1 : 0, blocked: 0 },
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('reinstall Runtime package', () => {
  it('marks the Runtime package task failed when preparation stops before transfer', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    await fs.mkdir(targetRoot);
    const progress: Array<{ status: string; phase: string }> = [];
    const executor = createLocalRuntimeHostExecutor();
    try {
      await expect(prepareReinstallRuntimePackage({
        executor,
        placement: { kind: 'host_process', runtime_root: targetRoot },
        target_root: targetRoot,
        operation_id: 'op-invalid-digest',
        release_tag: 'v1',
        commit: 'abc',
        platform: 'linux',
        architecture: 'amd64',
        strategy: 'desktop_upload',
        archive: Buffer.from('invalid'),
        archive_sha256: '0'.repeat(64),
        on_progress: (task) => progress.push(task),
      })).rejects.toThrow('Runtime archive digest changed before transfer.');
      expect(progress.at(-1)).toMatchObject({ status: 'failed', phase: 'transferring' });
    } finally {
      await executor.release();
    }
  });

  it('installs the standard managed slot and preserves a historical Gateway directory', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    const placement = { kind: 'host_process' as const, runtime_root: targetRoot };
    await fs.mkdir(path.join(targetRoot, 'runtime', 'managed'), { recursive: true });
    await fs.mkdir(path.join(targetRoot, 'gateway', 'managed'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'runtime-old');
    await fs.writeFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'gateway-old');
    const archive = await runtimeArchive(root);
    const executor = createLocalRuntimeHostExecutor();
    try {
      const prepared = await prepareReinstallRuntimePackage({
        executor,
        placement,
        target_root: targetRoot,
        operation_id: 'op-preserve',
        release_tag: 'v1',
        commit: 'abc',
        platform: 'linux',
        architecture: 'amd64',
        strategy: 'desktop_upload',
        archive,
        archive_sha256: createHash('sha256').update(archive).digest('hex'),
      });
      await installReinstallRuntimePackage(executor, placement, targetRoot, prepared, 'preserve_data');

      const managedRoot = path.join(targetRoot, 'runtime', 'managed');
      const stampPath = path.join(managedRoot, MANAGED_RUNTIME_STAMP_FILENAME);
      const stamp = await fs.readFile(stampPath, 'utf8');
      expect(stamp).toContain(`schema_version=${MANAGED_RUNTIME_STAMP_SCHEMA_VERSION}`);
      expect(stamp).toContain('managed_by=redeven-desktop');
      expect(stamp).toContain('slot_release_tag=v1');
      expect(stamp).toContain('commit=abc');
      expect((await fs.stat(path.join(targetRoot, 'runtime'))).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_DIRECTORY_MODE, 8));
      expect((await fs.stat(managedRoot)).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_DIRECTORY_MODE, 8));
      expect((await fs.stat(path.join(managedRoot, 'bin'))).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_DIRECTORY_MODE, 8));
      expect((await fs.stat(path.join(managedRoot, 'bin', 'redeven'))).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_EXECUTABLE_MODE, 8));
      expect((await fs.stat(path.join(managedRoot, 'bin', 'redevplugin-runtime'))).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_EXECUTABLE_MODE, 8));
      expect((await fs.stat(stampPath)).mode & 0o777).toBe(Number.parseInt(MANAGED_RUNTIME_METADATA_MODE, 8));
      expect((await fs.stat(path.join(managedRoot, 'bin', 'redevplugin-runtime.provenance.json'))).mode & 0o777)
        .toBe(Number.parseInt(MANAGED_RUNTIME_METADATA_MODE, 8));
      const normalProbe = await executor.run([
        'sh',
        '-c',
        buildManagedSSHRuntimeProbeScript(),
        'redeven-normal-runtime-probe',
        targetRoot,
        'v1',
      ]);
      expect(normalProbe.stdout).toContain('status=ready');
      await expect(fs.readFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'utf8'))
        .resolves.toBe('gateway-old');

      await rollbackReinstallRuntimePackage(executor, placement, targetRoot, prepared.operation_id);
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'utf8'))
        .resolves.toBe('runtime-old');
      await cleanupReinstallRuntimePackage(executor, placement, targetRoot, prepared.operation_id);
      await expect(fs.stat(prepared.staging_root)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await executor.release();
    }
  });

  it('does not send archive bytes for a remote install', async () => {
    const calls: Array<{ argv: readonly string[]; stdinData?: Buffer }> = [];
    const executor: RuntimeHostAccessExecutor = {
      host_access: {
        kind: 'ssh_host',
        ssh: { ssh_destination: 'ops@example.test', ssh_port: null, auth_mode: 'key_agent' },
      },
      run: vi.fn(async (argv, options) => {
        calls.push({ argv, stdinData: options?.stdinData });
        return {
          stdout: [
            'staging_root=/home/ops/.redeven.redeven-staging-op-remote-runtime',
            `archive_sha256=${'a'.repeat(64)}`,
            'archive_size_bytes=3',
            `executable_sha256=${'b'.repeat(64)}`,
            'reported_release_tag=v1',
            'reported_commit=abc',
          ].join('\n'),
          stderr: '',
        };
      }),
      release: vi.fn(async () => undefined),
    };

    await prepareReinstallRuntimePackage({
      executor,
      placement: { kind: 'host_process', runtime_root: '/home/ops/.redeven' },
      target_root: '/home/ops/.redeven',
      operation_id: 'op-remote',
      release_tag: 'v1',
      commit: 'abc',
      platform: 'linux',
      architecture: 'amd64',
      strategy: 'remote_install',
      archive_sha256: 'a'.repeat(64),
      remote_url: 'https://example.test/redeven-linux-amd64.tar.gz',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdinData).toBeUndefined();
    expect(calls[0]?.argv.join(' ')).toContain('remote_install');
    expect(calls[0]?.argv.join(' ')).toContain('redeven-linux-amd64.tar.gz');
  });

  it('starts an installed Runtime exactly once and verifies one current process', async () => {
    const targetRoot = '/home/ops/.redeven';
    let statusAttempts = 0;
    let processRunning = false;
    let serviceReady = false;
    const commands: string[] = [];
    const executor: RuntimeHostAccessExecutor = {
      host_access: { kind: 'local_host' },
      run: vi.fn(async (argv) => {
        const command = argv.join(' ');
        commands.push(command);
        if (command.includes('desktop-runtime-status')) {
          statusAttempts++;
          if (!serviceReady) {
            throw new Error('Runtime daemon is not running.');
          }
          return { stdout: readyStatus(), stderr: '' };
        }
        if (command.includes('desktop-target-process-inventory')) {
          return { stdout: inventory(targetRoot, processRunning), stderr: '' };
        }
        if (command.includes('redeven-reinstall-runtime-start')) {
          processRunning = true;
          return { stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected command: ${command}`);
      }),
      release: vi.fn(async () => undefined),
    };

    await startReinstallRuntime({
      executor,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      state_root: targetRoot,
    });
    expect(processRunning).toBe(true);
    expect(serviceReady).toBe(false);
    serviceReady = true;
    const first = await verifyReinstallRuntimeReady({
      executor,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      state_root: targetRoot,
      startup_timeout_ms: 1_000,
    });
    await startReinstallRuntime({
      executor,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      state_root: targetRoot,
    });
    const second = await verifyReinstallRuntimeReady({
      executor,
      placement: { kind: 'host_process', runtime_root: targetRoot },
      target_root: targetRoot,
      state_root: targetRoot,
      startup_timeout_ms: 1_000,
    });

    expect(first.process_count).toBe(1);
    expect(second.process_count).toBe(1);
    expect(commands[0]).toContain('desktop-target-process-inventory');
    expect(commands.filter((command) => command.includes('redeven-reinstall-runtime-start'))).toHaveLength(1);
    expect(statusAttempts).toBeGreaterThanOrEqual(2);
  });
});
