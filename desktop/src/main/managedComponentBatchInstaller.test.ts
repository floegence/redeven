import { describe, expect, it, vi } from 'vitest';

import {
  prepareAndStageBatch,
  type ManagedComponentTask,
} from './managedComponentBatchInstaller';

const tasks: readonly ManagedComponentTask[] = [
  { component: 'gateway', strategy: 'desktop_upload', release_tag: 'v1', commit: 'abc', platform: 'linux', architecture: 'amd64' },
  { component: 'runtime', strategy: 'desktop_upload', release_tag: 'v1', commit: 'abc', platform: 'linux', architecture: 'amd64' },
];

function prepared(task: ManagedComponentTask) {
  return {
    task,
    staging_id: task.component,
    evidence: {
      archive_sha256: 'a'.repeat(64),
      archive_size_bytes: 128,
      executable_sha256: 'b'.repeat(64),
      reported_release_tag: task.release_tag,
      reported_commit: task.commit,
    },
    value: task.component,
  } as const;
}

describe('prepareAndStageBatch', () => {
  it('starts both component pipelines without waiting for either sibling', async () => {
    const started: string[] = [];
    let releaseGateway!: () => void;
    const gatewayReady = new Promise<void>((resolve) => { releaseGateway = resolve; });
    const result = prepareAndStageBatch(tasks, new AbortController().signal, vi.fn(), {
      run: async (task) => {
        started.push(task.component);
        if (task.component === 'gateway') await gatewayReady;
        return prepared(task);
      },
    });
    await Promise.resolve();
    expect(started).toEqual(['gateway', 'runtime']);
    releaseGateway();
    await expect(result).resolves.toMatchObject({ suite_manifest: {
      components: [{ component: 'gateway' }, { component: 'runtime' }],
    } });
  });

  it('cancels the sibling and discards partial staging after a failure', async () => {
    const discarded: string[] = [];
    let observedAbort = false;
    await expect(prepareAndStageBatch(tasks, new AbortController().signal, vi.fn(), {
      run: async (task, signal) => {
        if (task.component === 'gateway') throw new Error('gateway failed');
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true });
        });
        return prepared(task);
      },
      discard: async (batch) => { discarded.push(...batch.tasks.map((item) => item.task.component)); },
    })).rejects.toThrow('gateway failed');
    expect(observedAbort).toBe(true);
    expect(discarded).toEqual(['runtime']);
  });

  it('reports the initiating failure instead of an earlier task-order cancellation', async () => {
    await expect(prepareAndStageBatch(tasks, new AbortController().signal, vi.fn(), {
      run: async (task, signal) => {
        if (task.component === 'gateway') {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new DOMException('Gateway preparation was canceled.', 'AbortError');
        }
        await Promise.resolve();
        throw new Error('runtime build failed');
      },
    })).rejects.toThrow('runtime build failed');
  });

  it('discards a prepared sibling when the parent operation is canceled', async () => {
    const parent = new AbortController();
    const discarded: string[] = [];
    let releaseGateway!: () => void;
    const gatewayStarted = new Promise<void>((resolve) => { releaseGateway = resolve; });
    const operation = prepareAndStageBatch(tasks, parent.signal, vi.fn(), {
      run: async (task, signal) => {
        if (task.component === 'gateway') {
          await gatewayStarted;
          return prepared(task);
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('Canceled', 'AbortError');
      },
      discard: async (batch) => { discarded.push(...batch.tasks.map((item) => item.task.component)); },
    });
    await Promise.resolve();
    parent.abort(new Error('operation canceled'));
    releaseGateway();
    await expect(operation).rejects.toThrow('operation canceled');
    expect(discarded).toEqual(['gateway']);
  });

  it('rejects duplicate component tasks before starting any pipeline', async () => {
    const run = vi.fn();
    await expect(prepareAndStageBatch(
      [tasks[0]!, { ...tasks[0]!, strategy: 'remote_install' }],
      new AbortController().signal,
      vi.fn(),
      { run },
    )).rejects.toThrow('duplicate gateway');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a suite whose component metadata does not match', async () => {
    const run = vi.fn();
    await expect(prepareAndStageBatch(
      [tasks[0]!, { ...tasks[1]!, architecture: 'arm64' }],
      new AbortController().signal,
      vi.fn(),
      { run },
    )).rejects.toThrow('inconsistent release, commit, platform, or architecture metadata');
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects staged package evidence that does not match the batch identity', async () => {
    await expect(prepareAndStageBatch(
      [tasks[0]!],
      new AbortController().signal,
      vi.fn(),
      {
        run: async (task) => ({
          ...prepared(task),
          evidence: { ...prepared(task).evidence, reported_commit: 'wrong' },
        }),
      },
    )).rejects.toThrow('package identity does not match');
  });
});
