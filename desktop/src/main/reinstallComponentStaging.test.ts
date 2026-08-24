import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalRuntimeHostExecutor, type RuntimeHostAccessExecutor } from './runtimeHostAccess';
import {
  activateManagedComponentBatch,
  cleanupManagedComponentBatch,
  rollbackManagedComponentBatch,
  stageManagedComponent,
} from './reinstallComponentStaging';
import type {
  ManagedComponentTask,
  PreparedComponent,
  PreparedComponentBatch,
} from './managedComponentBatchInstaller';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-runtime-stage-'));
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

function runtimeTask(strategy: ManagedComponentTask['strategy'] = 'desktop_upload'): ManagedComponentTask {
  return {
    component: 'runtime',
    strategy,
    release_tag: 'v1',
    commit: 'abc',
    platform: 'linux',
    architecture: 'amd64',
  };
}

function runtimeBatch(operationID: string, runtime: PreparedComponent): PreparedComponentBatch {
  return {
    operation_id: operationID,
    tasks: [runtime],
    runtime_manifest: {
      release_tag: 'v1',
      commit: 'abc',
      platform: 'linux',
      architecture: 'amd64',
      components: [{
        ...runtime.task,
        staging_id: runtime.staging_id,
        ...runtime.evidence,
      }],
    },
  };
}

async function stageRuntime(
  executor: RuntimeHostAccessExecutor,
  targetRoot: string,
  operationID: string,
): Promise<PreparedComponent> {
  const archive = await runtimeArchive(path.dirname(targetRoot));
  return stageManagedComponent({
    executor,
    placement: { kind: 'host_process', runtime_root: targetRoot },
    target_root: targetRoot,
    operation_id: operationID,
    task: runtimeTask(),
    archive,
    archive_sha256: createHash('sha256').update(archive).digest('hex'),
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Runtime-only reinstall staging', () => {
  it('stages and verifies only the Runtime package', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    const executor = createLocalRuntimeHostExecutor();
    try {
      const runtime = await stageRuntime(executor, targetRoot, 'op-upload');
      expect(runtime.task.component).toBe('runtime');
      expect(runtime.evidence).toMatchObject({
        reported_release_tag: 'v1',
        reported_commit: 'abc',
      });
      expect(runtime.staging_id).toBe(`${targetRoot}.redeven-staging-op-upload-runtime`);
      await expect(fs.stat(runtime.staging_id)).resolves.toBeDefined();
      await expect(fs.stat(`${targetRoot}.redeven-staging-op-upload-gateway`))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await executor.release();
    }
  });

  it('does not send archive bytes for a remote Runtime install', async () => {
    const root = await tempRoot();
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
            `staging_root=${root}/stage`,
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

    await stageManagedComponent({
      executor,
      placement: { kind: 'host_process', runtime_root: root },
      target_root: root,
      operation_id: 'op-remote',
      task: runtimeTask('remote_install'),
      archive_sha256: 'a'.repeat(64),
      remote_url: 'https://example.test/redeven-linux-amd64.tar.gz',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdinData).toBeUndefined();
    expect(calls[0]?.argv.join(' ')).toContain('remote_install');
    expect(calls[0]?.argv.join(' ')).toContain('redeven-linux-amd64.tar.gz');
  });

  it('replaces and rolls back Runtime without touching a historical Gateway directory', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    const placement = { kind: 'host_process' as const, runtime_root: targetRoot };
    await fs.mkdir(path.join(targetRoot, 'runtime', 'managed'), { recursive: true });
    await fs.mkdir(path.join(targetRoot, 'gateway', 'managed'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'runtime-old');
    await fs.writeFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'gateway-old');
    const executor = createLocalRuntimeHostExecutor();
    const operationID = 'op-preserve';
    try {
      const runtime = await stageRuntime(executor, targetRoot, operationID);
      await activateManagedComponentBatch(
        executor,
        placement,
        targetRoot,
        runtimeBatch(operationID, runtime),
        'preserve_data',
      );
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'utf8')).rejects.toThrow();
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'bin', 'redeven'), 'utf8'))
        .resolves.toContain('redeven v1 abc');
      await expect(fs.readFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'utf8'))
        .resolves.toBe('gateway-old');

      await rollbackManagedComponentBatch(executor, placement, targetRoot, operationID);
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'utf8'))
        .resolves.toBe('runtime-old');
      await expect(fs.readFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'utf8'))
        .resolves.toBe('gateway-old');

      await cleanupManagedComponentBatch(executor, placement, targetRoot, operationID);
      await expect(fs.stat(`${targetRoot}.redeven-staging-${operationID}-runtime`))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await executor.release();
    }
  });

  it('restores an interrupted preserve replacement before retrying the same operation', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    const placement = { kind: 'host_process' as const, runtime_root: targetRoot };
    await fs.mkdir(path.join(targetRoot, 'runtime', 'managed'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'runtime', 'managed', 'original'), 'runtime-original');
    const executor = createLocalRuntimeHostExecutor();
    const operationID = 'op-resume';
    try {
      const first = await stageRuntime(executor, targetRoot, operationID);
      await activateManagedComponentBatch(executor, placement, targetRoot, runtimeBatch(operationID, first), 'preserve_data');
      const second = await stageRuntime(executor, targetRoot, operationID);
      await activateManagedComponentBatch(executor, placement, targetRoot, runtimeBatch(operationID, second), 'preserve_data');
      await rollbackManagedComponentBatch(executor, placement, targetRoot, operationID);
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'original'), 'utf8'))
        .resolves.toBe('runtime-original');
    } finally {
      await executor.release();
    }
  });

  it('rejects a batch without the Runtime component', async () => {
    const root = await tempRoot();
    const executor = createLocalRuntimeHostExecutor();
    try {
      const missingRuntime: PreparedComponentBatch = {
        operation_id: 'op-empty',
        tasks: [],
        runtime_manifest: {
          release_tag: 'v1',
          commit: 'abc',
          platform: 'linux',
          architecture: 'amd64',
          components: [],
        },
      };
      await expect(activateManagedComponentBatch(
        executor,
        { kind: 'host_process', runtime_root: root },
        root,
        missingRuntime,
        'wipe_data',
      )).rejects.toThrow('Managed Runtime component is unavailable');
    } finally {
      await executor.release();
    }
  });
});
