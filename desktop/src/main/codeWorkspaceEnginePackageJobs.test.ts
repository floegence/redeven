import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopCodeWorkspacePackageJobStore } from './codeWorkspaceEnginePackageJobs';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function writePackage(data: Uint8Array): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-code-workspace-job-'));
  roots.push(root);
  const archivePath = path.join(root, 'package.tar.gz');
  await fs.writeFile(archivePath, data);
  return archivePath;
}

describe('DesktopCodeWorkspacePackageJobStore', () => {
  it('reads confirmed 1 MiB chunks without buffering the whole package', async () => {
    const archive = new Uint8Array((1024 * 1024) + 3);
    archive.fill(7);
    const archivePath = await writePackage(archive);
    const finishOperation = vi.fn();
    const operation = { controller: new AbortController() };
    const store = new DesktopCodeWorkspacePackageJobStore({ ttlMS: 60_000, finishOperation });
    store.add({
      jobID: 'job_1',
      archivePath,
      archiveSizeBytes: archive.byteLength,
      chunkSizeBytes: 1024 * 1024,
      createdAtMs: Date.now(),
      operation,
    });

    const first = await store.read('job_1', 0, 2 * 1024 * 1024);
    expect(first).toMatchObject({ ok: true, offset_bytes: 0, length_bytes: 1024 * 1024, done: false });
    expect(first.chunk).toHaveLength(1024 * 1024);

    const second = await store.read('job_1', 1024 * 1024, 1024 * 1024);
    expect(second).toMatchObject({ ok: true, offset_bytes: 1024 * 1024, length_bytes: 3, done: true });
    expect(second.chunk).toEqual(new Uint8Array([7, 7, 7]));
    expect(finishOperation).not.toHaveBeenCalled();
  });

  it('rejects out-of-range and canceled reads', async () => {
    const archivePath = await writePackage(new Uint8Array([1, 2, 3]));
    const operation = { controller: new AbortController() };
    const store = new DesktopCodeWorkspacePackageJobStore({ ttlMS: 60_000, finishOperation: () => undefined });
    store.add({ jobID: 'job_1', archivePath, archiveSizeBytes: 3, chunkSizeBytes: 1024 * 1024, createdAtMs: Date.now(), operation });

    await expect(store.read('job_1', 4, 1)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('out of range') });
    operation.controller.abort();
    await expect(store.read('job_1', 0, 1)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('canceled') });
  });

  it('expires jobs, aborts their operation, and releases operation ownership', async () => {
    const archivePath = await writePackage(new Uint8Array([1]));
    const finishOperation = vi.fn();
    const operation = { controller: new AbortController() };
    let now = 1_000;
    const store = new DesktopCodeWorkspacePackageJobStore({ ttlMS: 100, now: () => now, finishOperation });
    store.add({ jobID: 'job_1', archivePath, archiveSizeBytes: 1, chunkSizeBytes: 1, createdAtMs: now, operation });

    now += 101;
    store.prune();

    expect(operation.controller.signal.aborted).toBe(true);
    expect(finishOperation).toHaveBeenCalledOnce();
    await expect(store.read('job_1', 0, 1)).resolves.toMatchObject({ ok: false, message: expect.stringContaining('no longer available') });
  });

  it('disposes jobs and removes all jobs owned by a canceled operation', async () => {
    const archivePath = await writePackage(new Uint8Array([1]));
    const finishOperation = vi.fn();
    const operation = { controller: new AbortController() };
    const store = new DesktopCodeWorkspacePackageJobStore({ ttlMS: 60_000, finishOperation });
    store.add({ jobID: 'job_1', archivePath, archiveSizeBytes: 1, chunkSizeBytes: 1, createdAtMs: Date.now(), operation });
    expect(store.dispose('job_1')).toBe(true);
    expect(finishOperation).toHaveBeenCalledWith(operation);

    store.add({ jobID: 'job_2', archivePath, archiveSizeBytes: 1, chunkSizeBytes: 1, createdAtMs: Date.now(), operation });
    store.add({ jobID: 'job_3', archivePath, archiveSizeBytes: 1, chunkSizeBytes: 1, createdAtMs: Date.now(), operation });
    expect(store.removeForOperation(operation)).toBe(2);
    await expect(store.read('job_2', 0, 1)).resolves.toMatchObject({ ok: false });
    await expect(store.read('job_3', 0, 1)).resolves.toMatchObject({ ok: false });
  });
});
