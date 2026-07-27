import { describe, expect, it, vi } from 'vitest';
import {
  GIT_PATH_STATUS_MAX_UTF8_BYTES,
  GIT_PATH_STATUS_MAX_WIRE_BYTES,
  gitPathStatusWireBytes,
  partitionGitPathStatusRequests,
  queryGitWorkspacePathStatuses,
} from './gitWorkspacePathStatus';

describe('gitWorkspacePathStatus', () => {
  it('enforces count, UTF-8, and complete encoded request budgets', () => {
    expect(partitionGitPathStatusRequests('/repo', Array.from({ length: 65 }, (_, index) => `p${index}`))).toHaveLength(2);
    expect(partitionGitPathStatusRequests('/repo', [
      'a'.repeat(GIT_PATH_STATUS_MAX_UTF8_BYTES),
      'b',
    ])).toHaveLength(2);

    const escapedPaths = Array.from({ length: 64 }, (_, index) => `${index}/${'\u0001'.repeat(2_040)}`);
    const batches = partitionGitPathStatusRequests('/repo', escapedPaths, 'f'.repeat(64));
    expect(batches.length).toBeGreaterThan(1);
    for (const paths of batches) {
      expect(gitPathStatusWireBytes({
        repoRootPath: '/repo',
        paths,
        expectedWorkspaceRevision: 'f'.repeat(64),
      })).toBeLessThanOrEqual(GIT_PATH_STATUS_MAX_WIRE_BYTES);
    }
  });

  it.each([41302, 41305, 41307])('bisects budget code %s and binds the first successful revision', async (code) => {
    const calls: Array<{ paths: string[]; expectedWorkspaceRevision?: string }> = [];
    const call = vi.fn(async (request: { paths: string[]; expectedWorkspaceRevision?: string }) => {
      calls.push(request);
      if (request.paths.length > 1) throw Object.assign(new Error('budget'), { code });
      return {
        repoRootPath: '/repo',
        workspaceRevision: 'revision-a',
        items: [{ path: request.paths[0], section: 'unstaged' }],
      };
    });

    const result = await queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: ['a', 'b'],
      call,
    });

    expect(result.workspaceRevision).toBe('revision-a');
    expect(result.items).toHaveLength(2);
    expect(calls[1].expectedWorkspaceRevision).toBeUndefined();
    expect(calls[2].expectedWorkspaceRevision).toBe('revision-a');
  });

  it('degrades only an oversized single path and continues the scope', async () => {
    const result = await queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: ['too-large', 'ok'],
      call: async (request) => {
        if (request.paths.includes('too-large')) throw Object.assign(new Error('budget'), { code: 41307 });
        return {
          repoRootPath: '/repo',
          workspaceRevision: 'revision-a',
          items: [{ path: 'ok', section: 'unstaged' }],
        };
      },
    });
    expect(result.degradedPaths).toEqual(['too-large']);
    expect(result.items).toEqual([{ path: 'ok', section: 'unstaged' }]);
    expect(result.preempted).toBe(false);
  });

  it('does not send a single path whose escaped request exceeds the client wire budget', async () => {
    const escapedOversizedPath = '\u0001'.repeat(GIT_PATH_STATUS_MAX_UTF8_BYTES);
    const call = vi.fn(async (request: { paths: string[] }) => ({
      repoRootPath: '/repo',
      workspaceRevision: 'revision-a',
      items: [{ path: request.paths[0], section: 'unstaged' }],
    }));
    const result = await queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: [escapedOversizedPath, 'ok'],
      call,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0]).toEqual({ repoRootPath: '/repo', paths: ['ok'] });
    expect(result.degradedPaths).toEqual([escapedOversizedPath]);
    expect(result.items).toEqual([{ path: 'ok', section: 'unstaged' }]);
    expect(result.preempted).toBe(false);
  });

  it('preempts at a batch boundary without exposing a partial generation', async () => {
    let current = true;
    const call = vi.fn(async (request: { paths: string[] }) => {
      current = false;
      return {
        repoRootPath: '/repo',
        workspaceRevision: 'revision-old',
        items: request.paths.map((path) => ({ path, section: 'unstaged' })),
      };
    });

    const result = await queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: Array.from({ length: 65 }, (_, index) => `path-${index}`),
      call,
      shouldContinue: () => current,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      workspaceRevision: undefined,
      items: [],
      degradedPaths: [],
      preempted: true,
    });
  });

  it('discards a stale partial generation and retries fresh at most once', async () => {
    const stale = Object.assign(new Error('server text must not matter'), { code: 40901 });
    const onSnapshotStale = vi.fn();
    let generation = 0;
    const call = vi.fn(async (request: { paths: string[] }) => {
      if (request.paths.length === 64) generation += 1;
      if (generation === 1 && request.paths.length === 1) throw stale;
      return {
        repoRootPath: '/repo',
        workspaceRevision: generation === 1 ? 'revision-old' : 'revision-fresh',
        items: request.paths.map((path) => ({
          path: `${generation}:${path}`,
          section: 'unstaged',
        })),
      };
    });

    const result = await queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: Array.from({ length: 65 }, (_, index) => `path-${index}`),
      call,
      onSnapshotStale,
    });

    expect(onSnapshotStale).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledTimes(4);
    expect(result.preempted).toBe(false);
    expect(result.workspaceRevision).toBe('revision-fresh');
    expect(result.items).toHaveLength(65);
    expect(result.items.every((item) => item.path?.startsWith('2:'))).toBe(true);
  });

  it('does not retry a second stale generation', async () => {
    const stale = Object.assign(new Error('stale'), { code: 40901 });
    const onSnapshotStale = vi.fn();
    const call = vi.fn(async () => Promise.reject(stale));

    await expect(queryGitWorkspacePathStatuses({
      repoRootPath: '/repo',
      paths: ['a'],
      call,
      onSnapshotStale,
    })).rejects.toBe(stale);
    expect(call).toHaveBeenCalledTimes(2);
    expect(onSnapshotStale).toHaveBeenCalledTimes(1);
  });
});
