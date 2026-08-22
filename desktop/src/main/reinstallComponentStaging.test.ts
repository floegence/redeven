import { createHash } from 'node:crypto';
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
import type { PreparedComponentBatch, ManagedComponentTask } from './managedComponentBatchInstaller';

const execFile = promisify(execFileCallback);
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-component-stage-'));
  roots.push(root);
  return root;
}

async function archiveFor(component: 'gateway' | 'runtime', root: string): Promise<Buffer> {
  const source = path.join(root, component + '-package');
  await fs.mkdir(source, { recursive: true });
  const product = component === 'gateway' ? 'redeven-gateway' : 'redeven';
  const binary = path.join(source, product);
  await fs.writeFile(binary, '#!/bin/sh\necho ' + product + ' v1 abc\n');
  await fs.chmod(binary, 0o700);
  if (component === 'runtime') {
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
  }
  const archive = path.join(root, component + '.tar.gz');
  await execFile('tar', ['-czf', archive, '-C', source, '.']);
  return fs.readFile(archive);
}

function task(component: 'gateway' | 'runtime', strategy: ManagedComponentTask['strategy'] = 'desktop_upload'): ManagedComponentTask {
  return { component, strategy, release_tag: 'v1', commit: 'abc', platform: 'linux', architecture: 'amd64' };
}

function batch(root: string, operationID: string): PreparedComponentBatch {
  const gateway = {
    component: 'gateway' as const,
    strategy: 'desktop_upload' as const,
    release_tag: 'v1',
    commit: 'abc',
    platform: 'linux',
    architecture: 'amd64',
    staging_id: path.join(root, '.redeven-staging-' + operationID + '-gateway'),
    archive_sha256: 'a'.repeat(64),
    archive_size_bytes: 1,
    executable_sha256: 'b'.repeat(64),
  };
  const runtime = { ...gateway, component: 'runtime' as const, staging_id: path.join(root, '.redeven-staging-' + operationID + '-runtime') };
  return { operation_id: operationID, tasks: [], suite_manifest: { release_tag: 'v1', commit: 'abc', platform: 'linux', architecture: 'amd64', components: [gateway, runtime] } };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
describe('reinstall component staging', () => {
  it('uploads and verifies Gateway and Runtime with separate staging roots', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    const executor = createLocalRuntimeHostExecutor();
    try {
      const gatewayArchive = await archiveFor('gateway', root);
      const runtimeArchive = await archiveFor('runtime', root);
      const common = { executor, placement: { kind: 'host_process' as const, runtime_root: targetRoot }, target_root: targetRoot, operation_id: 'op-upload' };
      const gateway = await stageManagedComponent({ ...common, task: task('gateway'), archive: gatewayArchive, archive_sha256: createHash('sha256').update(gatewayArchive).digest('hex') });
      const runtime = await stageManagedComponent({ ...common, task: task('runtime'), archive: runtimeArchive, archive_sha256: createHash('sha256').update(runtimeArchive).digest('hex') });
      expect(gateway.evidence.reported_commit).toBe('abc');
      expect(runtime.evidence.reported_release_tag).toBe('v1');
      await expect(fs.stat(gateway.staging_id)).resolves.toBeDefined();
      await expect(fs.stat(runtime.staging_id)).resolves.toBeDefined();
    } finally {
      await executor.release();
    }
  });

  it('does not send archive bytes to a remote-install target', async () => {
    const root = await tempRoot();
    const calls: Array<{ argv: readonly string[]; stdinData?: Buffer }> = [];
    const executor: RuntimeHostAccessExecutor = {
      host_access: { kind: 'ssh_host', ssh: { ssh_destination: 'ops@example.test', ssh_port: null, auth_mode: 'key_agent' } },
      run: vi.fn(async (argv, options) => {
        calls.push({ argv, stdinData: options?.stdinData });
        return { stdout: 'staging_root=' + root + '/stage\narchive_sha256=' + 'a'.repeat(64) + '\narchive_size_bytes=3\nexecutable_sha256=' + 'b'.repeat(64) + '\nreported_release_tag=v1\nreported_commit=abc\n', stderr: '' };
      }),
      release: vi.fn(async () => undefined),
    };
    await stageManagedComponent({ executor, placement: { kind: 'host_process', runtime_root: root }, target_root: root, operation_id: 'op-remote', task: task('gateway', 'remote_install'), archive_sha256: 'a'.repeat(64), remote_url: 'https://example.test/gateway.tar.gz' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdinData).toBeUndefined();
    expect(calls[0]?.argv.join(' ')).toContain('remote_install');
    expect(calls[0]?.argv.join(' ')).toContain('https://example.test/gateway.tar.gz');
  });

  it('requires both component manifests and rolls back both managed directories', async () => {
    const root = await tempRoot();
    const targetRoot = path.join(root, 'redeven');
    await fs.mkdir(path.join(targetRoot, 'gateway', 'managed'), { recursive: true });
    await fs.mkdir(path.join(targetRoot, 'runtime', 'managed'), { recursive: true });
    await fs.writeFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'gateway-old');
    await fs.writeFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'runtime-old');
    const executor = createLocalRuntimeHostExecutor();
    try {
      const gatewayArchive = await archiveFor('gateway', root);
      const runtimeArchive = await archiveFor('runtime', root);
      const operationID = 'op-transaction';
      const gateway = await stageManagedComponent({ executor, placement: { kind: 'host_process' as const, runtime_root: targetRoot }, target_root: targetRoot, operation_id: operationID, task: task('gateway'), archive: gatewayArchive, archive_sha256: createHash('sha256').update(gatewayArchive).digest('hex') });
      const runtime = await stageManagedComponent({ executor, placement: { kind: 'host_process' as const, runtime_root: targetRoot }, target_root: targetRoot, operation_id: operationID, task: task('runtime'), archive: runtimeArchive, archive_sha256: createHash('sha256').update(runtimeArchive).digest('hex') });
      const prepared: PreparedComponentBatch = { operation_id: operationID, tasks: [gateway, runtime], suite_manifest: { release_tag: 'v1', commit: 'abc', platform: 'linux', architecture: 'amd64', components: [gateway, runtime].map((item) => ({ ...item.task, staging_id: item.staging_id, ...item.evidence })) } };
      await activateManagedComponentBatch(executor, { kind: 'host_process', runtime_root: targetRoot }, targetRoot, prepared, 'preserve_data');
      await expect(fs.readFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'utf8')).rejects.toThrow();
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'utf8')).rejects.toThrow();
      await rollbackManagedComponentBatch(executor, { kind: 'host_process', runtime_root: targetRoot }, targetRoot, operationID);
      await expect(fs.readFile(path.join(targetRoot, 'gateway', 'managed', 'old'), 'utf8')).resolves.toBe('gateway-old');
      await expect(fs.readFile(path.join(targetRoot, 'runtime', 'managed', 'old'), 'utf8')).resolves.toBe('runtime-old');
      await cleanupManagedComponentBatch(executor, { kind: 'host_process', runtime_root: targetRoot }, targetRoot, operationID);
      await expect(fs.stat(path.join(targetRoot, '.redeven-staging-' + operationID + '-gateway'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await executor.release();
    }
  });

  it('rejects activation when the suite is incomplete', async () => {
    const root = await tempRoot();
    const executor = createLocalRuntimeHostExecutor();
    try {
      const incomplete = batch(root, 'op-incomplete');
      await expect(activateManagedComponentBatch(executor, { kind: 'host_process' as const, runtime_root: root }, root, { ...incomplete, suite_manifest: { ...incomplete.suite_manifest, components: [incomplete.suite_manifest.components[0]!] } }, 'wipe_data')).rejects.toThrow('Managed component suite is incomplete');
    } finally {
      await executor.release();
    }
  });
});
