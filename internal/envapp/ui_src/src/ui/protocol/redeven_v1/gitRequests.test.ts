import { describe, expect, it, vi } from 'vitest';
import { createRedevenV1Rpc, type RedevenV1Rpc } from './contract';
import { redevenV1TypeIds } from './typeIds';
import { fromWireGitPreviewDeleteBranchResponse } from './codec/git';

type GitRpc = RedevenV1Rpc['git'];
const repo = { repoRootPath: '/workspace/repo' };
const cases = {
  getCapabilities: undefined,
  resolveRepo: { path: '/workspace/repo' },
  getRepoSummary: repo,
  listWorkspaceChanges: repo,
  listWorkspacePage: { ...repo, section: 'changes' },
  listWorkspacePathStatuses: { ...repo, paths: ['src/file.ts'] },
  listStashes: repo,
  getStashDetail: { ...repo, id: 'stash-object-id' },
  saveStash: repo,
  previewApplyStash: { ...repo, id: 'stash-object-id' },
  applyStash: { ...repo, id: 'stash-object-id', planFingerprint: 'reviewed-plan' },
  previewDropStash: { ...repo, id: 'stash-object-id' },
  dropStash: { ...repo, id: 'stash-object-id', planFingerprint: 'reviewed-plan' },
  stageWorkspace: { ...repo, section: 'changes' },
  unstageWorkspace: { ...repo, section: 'staged' },
  discardWorkspace: { ...repo, section: 'changes' },
  listBranches: repo,
  listCommits: repo,
  getCommitDetail: { ...repo, commit: 'commit-id' },
  getDiffContent: { ...repo, sourceKind: 'workspace', workspaceSection: 'untracked', file: { path: 'src/file.ts' } },
  getBranchCompare: { ...repo, baseRef: 'main', targetRef: 'feature' },
  commitWorkspace: { ...repo, message: 'fix: preserve literal commit message' },
  fetchRepo: repo,
  pullRepo: repo,
  pushRepo: repo,
  checkoutBranch: { ...repo, name: 'feature' },
  switchDetached: { ...repo, targetRef: 'commit-id' },
  previewDeleteBranch: { ...repo, name: 'feature' },
  deleteBranch: { ...repo, name: 'feature', planFingerprint: 'reviewed-plan', removeLinkedWorktree: false, discardLinkedWorktreeChanges: false },
  previewMergeBranch: { ...repo, name: 'feature' },
  mergeBranch: { ...repo, name: 'feature', planFingerprint: 'reviewed-plan' },
} satisfies { [K in keyof GitRpc]: Parameters<GitRpc[K]>[0] };

function createRequestProbe() {
  const call = vi.fn(async (_typeId: number, payload: unknown) => {
    // Flowersec accepts JSON values, not objects that become JSON only after serialization.
    expect(payload).toStrictEqual(JSON.parse(JSON.stringify(payload)));
  });
  return { call, rpc: createRedevenV1Rpc({ call, onNotify: vi.fn() } as any) };
}

describe('Git public RPC request contracts', () => {
  it.each(Object.keys(cases) as (keyof GitRpc)[])('%s sends JSON with omitted optional fields', async (operation) => {
    const { call, rpc } = createRequestProbe();
    await (rpc.git[operation] as (request: unknown) => Promise<unknown>)(cases[operation]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(redevenV1TypeIds.git[operation]);
  });

  it.each(['stageWorkspace', 'unstageWorkspace', 'discardWorkspace'] as const)('%s preserves exact file, folder, and section scopes', async (operation) => {
    const { call, rpc } = createRequestProbe();
    const section = operation === 'unstageWorkspace' ? 'staged' : 'changes';
    for (const [scope, wireScope] of [
      [{ section }, { section }],
      [{ section, directoryPath: 'nested folder/' }, { section, directory_path: 'nested folder/' }],
      [{ paths: [' leading :[literal]*.txt ', '目录/file.ts'] }, { paths: [' leading :[literal]*.txt ', '目录/file.ts'] }],
    ] as const) {
      await rpc.git[operation]({ ...repo, ...scope } as Parameters<GitRpc[typeof operation]>[0]);
      expect(call.mock.lastCall?.[1]).toStrictEqual({ repo_root_path: repo.repoRootPath, ...wireScope });
    }
  });

  it('retains structured worktree blockers at the response boundary', () => {
    const result = fromWireGitPreviewDeleteBranchResponse({
      repo_root_path: '/repo', requires_worktree_removal: false,
      requires_discard_confirmation: false, safe_delete_allowed: false,
      force_delete_allowed: false, force_delete_requires_confirm: true,
      blocking_code: 'primary_worktree', blocking_reason: 'The primary worktree cannot be removed.',
    });
    expect(result.blockingCode).toBe('primary_worktree');
    expect(result.safeDeleteAllowed).toBe(false);
    expect(result.forceDeleteAllowed).toBe(false);
  });

  it('preserves explicit false, empty text, and branch review authorization', async () => {
    const { call, rpc } = createRequestProbe();
    await rpc.git.saveStash({ ...repo, message: '', includeUntracked: false, keepIndex: false });
    expect(call.mock.lastCall?.[1]).toStrictEqual({ repo_root_path: repo.repoRootPath, message: '', include_untracked: false, keep_index: false });
    await rpc.git.deleteBranch({ ...repo, fullName: 'refs/heads/feature', kind: 'local', deleteMode: 'force', confirmBranchName: 'feature', removeLinkedWorktree: true, discardLinkedWorktreeChanges: false, planFingerprint: 'reviewed-plan' });
    expect(call.mock.lastCall?.[1]).toStrictEqual({ repo_root_path: repo.repoRootPath, full_name: 'refs/heads/feature', kind: 'local', delete_mode: 'force', confirm_branch_name: 'feature', remove_linked_worktree: true, discard_linked_worktree_changes: false, plan_fingerprint: 'reviewed-plan' });
  });
});
