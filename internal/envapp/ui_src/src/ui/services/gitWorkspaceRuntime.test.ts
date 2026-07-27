import { describe, expect, it, vi } from 'vitest';
import {
  executeWorkspaceEffect,
  getGitCapabilityMode,
  getGitWorkspaceWatermark,
  isGitOperationPlanStale,
  probeGitCapabilities,
  publishGitWorkspaceInvalidation,
  subscribeGitWorkspaceInvalidation,
} from './gitWorkspaceRuntime';

const capable = {
  workspaceRevisionV1: true,
  workspacePathStatusV1: true,
  workspaceDirectoryScopeV1: true,
  stashSectionDiffV1: true,
};

describe('gitWorkspaceRuntime', () => {
  it('isolates capability state by client identity and only caches terminal modes', async () => {
    const first = {};
    const second = {};
    expect(await probeGitCapabilities(first, async () => capable)).toBe('capable');
    expect(getGitCapabilityMode(first)).toBe('capable');
    expect(getGitCapabilityMode(second)).toBe('unknown');

    const transient = Object.assign(new Error('offline'), { code: -1 });
    expect(await probeGitCapabilities(second, async () => Promise.reject(transient))).toBe('transient');
    expect(await probeGitCapabilities(second, async () => capable)).toBe('capable');
  });

  it('treats only capability 404 as legacy', async () => {
    const client = {};
    expect(await probeGitCapabilities(client, async () => Promise.reject(Object.assign(new Error(), { code: 404 })))).toBe('legacy');
  });

  it('caches a successful probe that lacks the complete bounded workspace contract as legacy', async () => {
    const client = {};
    const getCapabilities = vi.fn(async () => ({ ...capable, workspacePathStatusV1: false }));
    expect(await probeGitCapabilities(client, getCapabilities)).toBe('legacy');
    expect(await probeGitCapabilities(client, getCapabilities)).toBe('legacy');
    expect(getCapabilities).toHaveBeenCalledTimes(1);
  });

  it('retains repo and global watermarks after listeners unsubscribe', () => {
    const client = {};
    const listener = vi.fn();
    const unsubscribe = subscribeGitWorkspaceInvalidation(client, listener);
    publishGitWorkspaceInvalidation(client, '/repo/a');
    expect(getGitWorkspaceWatermark(client, '/repo/a')).toBe(1);
    expect(getGitWorkspaceWatermark(client, '/repo/b')).toBe(0);
    unsubscribe();
    publishGitWorkspaceInvalidation(client);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getGitWorkspaceWatermark(client, '/repo/a')).toBe(2);
    expect(getGitWorkspaceWatermark(client, '/repo/b')).toBe(2);
  });

  it('publishes invalidation after success, error, and unknown outcomes', async () => {
    const client = {};
    const listener = vi.fn();
    subscribeGitWorkspaceInvalidation(client, listener);

    await expect(executeWorkspaceEffect({ clientIdentity: client, repoHint: '/repo', effect: async () => 'ok' })).resolves.toBe('ok');
    await expect(executeWorkspaceEffect({ clientIdentity: client, repoHint: '/repo', effect: async () => { throw new Error('failed'); } })).rejects.toThrow('failed');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getGitWorkspaceWatermark(client, '/repo')).toBe(2);
  });

  it('classifies plan staleness from the structured code and operation context only', () => {
    expect(isGitOperationPlanStale({ code: 409, message: 'localized or redacted' }, 'mergeBranch')).toBe(true);
    expect(isGitOperationPlanStale({ code: 409, message: 'unrelated text' }, 'deleteBranch')).toBe(true);
    expect(isGitOperationPlanStale({ code: 400, message: 'merge plan is stale' }, 'mergeBranch')).toBe(false);
  });
});
