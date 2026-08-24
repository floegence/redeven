import { describe, expect, it, vi } from 'vitest';

import { prepareAndStageBatch, type ManagedComponentTask } from './managedComponentBatchInstaller';

const runtimeTask: ManagedComponentTask = {
  component: 'runtime',
  strategy: 'desktop_upload',
  release_tag: 'v1',
  commit: 'abc',
  platform: 'linux',
  architecture: 'amd64',
};

describe('prepareAndStageBatch', () => {
  it('prepares a Runtime-only batch with its manifest', async () => {
    const result = await prepareAndStageBatch([runtimeTask], new AbortController().signal, vi.fn(), {
      run: async (task) => ({
        task,
        staging_id: 'runtime-staging',
        evidence: {
          archive_sha256: 'a'.repeat(64),
          archive_size_bytes: 1,
          executable_sha256: 'b'.repeat(64),
          reported_release_tag: task.release_tag,
          reported_commit: task.commit,
        },
        value: 'runtime-staging',
      }),
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.task.component).toBe('runtime');
    expect(result.runtime_manifest.components).toHaveLength(1);
  });

  it('rejects duplicate Runtime tasks before staging', async () => {
    const run = vi.fn();
    await expect(prepareAndStageBatch([runtimeTask, runtimeTask], new AbortController().signal, vi.fn(), { run }))
      .rejects.toThrow('duplicate runtime');
    expect(run).not.toHaveBeenCalled();
  });
});
