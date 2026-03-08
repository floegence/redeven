import type {
  GitBranchSummary,
  GitCommitFileSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
  GitWorkspaceChange,
  GitWorkspaceSection,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';

export type GitWorkbenchSubview = 'overview' | 'changes' | 'branches' | 'history';

export type GitWorkbenchSubviewItem = {
  id: GitWorkbenchSubview;
  label: string;
  count?: number;
};

export const WORKSPACE_SECTIONS: GitWorkspaceSection[] = ['staged', 'unstaged', 'untracked', 'conflicted'];

export function summarizeWorkspaceCount(summary: GitWorkspaceSummary | null | undefined): number {
  return Number(summary?.stagedCount ?? 0)
    + Number(summary?.unstagedCount ?? 0)
    + Number(summary?.untrackedCount ?? 0)
    + Number(summary?.conflictedCount ?? 0);
}

export function buildGitWorkbenchSubviewItems(params: {
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitListWorkspaceChangesResponse | null;
  branchesCount?: number;
}): GitWorkbenchSubviewItem[] {
  const summary = params.workspace?.summary ?? params.repoSummary?.workspaceSummary;
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'changes', label: 'Changes', count: summarizeWorkspaceCount(summary) || undefined },
    { id: 'branches', label: 'Branches', count: params.branchesCount || undefined },
    { id: 'history', label: 'History' },
  ];
}

export function repoDisplayName(repoRootPath: string | null | undefined): string {
  const pathValue = String(repoRootPath ?? '').trim();
  if (!pathValue || pathValue === '/') return 'Repository';
  const parts = pathValue.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Repository';
}

export function workspaceSectionLabel(section: GitWorkspaceSection): string {
  switch (section) {
    case 'staged':
      return 'Staged';
    case 'unstaged':
      return 'Unstaged';
    case 'untracked':
      return 'Untracked';
    case 'conflicted':
      return 'Conflicted';
    default:
      return section;
  }
}

export function workspaceSectionCount(summary: GitWorkspaceSummary | null | undefined, section: GitWorkspaceSection): number {
  switch (section) {
    case 'staged':
      return Number(summary?.stagedCount ?? 0);
    case 'unstaged':
      return Number(summary?.unstagedCount ?? 0);
    case 'untracked':
      return Number(summary?.untrackedCount ?? 0);
    case 'conflicted':
      return Number(summary?.conflictedCount ?? 0);
    default:
      return 0;
  }
}

export function workspaceSectionItems(
  workspace: GitListWorkspaceChangesResponse | null | undefined,
  section: GitWorkspaceSection,
): GitWorkspaceChange[] {
  if (!workspace) return [];
  switch (section) {
    case 'staged':
      return workspace.staged ?? [];
    case 'unstaged':
      return workspace.unstaged ?? [];
    case 'untracked':
      return workspace.untracked ?? [];
    case 'conflicted':
      return workspace.conflicted ?? [];
    default:
      return [];
  }
}

export function gitDiffEntryIdentity(item: GitWorkspaceChange | GitCommitFileSummary | null | undefined): string {
  if (!item) return '';
  return [item.changeType || '', item.path || '', item.oldPath || '', item.newPath || ''].join(':');
}

export function workspaceEntryKey(item: GitWorkspaceChange | null | undefined): string {
  if (!item) return '';
  return `${item.section || ''}:${gitDiffEntryIdentity(item)}`;
}

export function pickDefaultWorkspaceChange(workspace: GitListWorkspaceChangesResponse | null | undefined): GitWorkspaceChange | null {
  for (const section of WORKSPACE_SECTIONS) {
    const item = workspaceSectionItems(workspace, section)[0];
    if (item) return item;
  }
  return null;
}

export function findWorkspaceChangeByKey(
  workspace: GitListWorkspaceChangesResponse | null | undefined,
  key: string | null | undefined,
): GitWorkspaceChange | null {
  const wanted = String(key ?? '').trim();
  if (!wanted) return null;
  for (const section of WORKSPACE_SECTIONS) {
    const item = workspaceSectionItems(workspace, section).find((entry) => workspaceEntryKey(entry) === wanted);
    if (item) return item;
  }
  return null;
}

export function branchIdentity(branch: GitBranchSummary | null | undefined): string {
  return String(branch?.fullName || branch?.name || '').trim();
}

export function allGitBranches(branches: GitListBranchesResponse | null | undefined): GitBranchSummary[] {
  return [...(branches?.local ?? []), ...(branches?.remote ?? [])];
}

export function findGitBranchByKey(
  branches: GitListBranchesResponse | null | undefined,
  key: string | null | undefined,
): GitBranchSummary | null {
  const wanted = String(key ?? '').trim();
  if (!wanted) return null;
  return allGitBranches(branches).find((branch) => branchIdentity(branch) === wanted) ?? null;
}

export function pickDefaultGitBranch(branches: GitListBranchesResponse | null | undefined): GitBranchSummary | null {
  const local = branches?.local ?? [];
  return local.find((branch) => !branch.current)
    ?? local.find((branch) => branch.current)
    ?? (branches?.remote ?? [])[0]
    ?? null;
}

export function branchDisplayName(branch: GitBranchSummary | null | undefined): string {
  return String(branch?.name ?? '').trim() || '(unknown branch)';
}

export function branchStatusSummary(branch: GitBranchSummary | null | undefined): string {
  if (!branch) return 'No branch selected';
  const parts: string[] = [];
  if (branch.current) parts.push('Current');
  if (branch.kind === 'remote') parts.push('Remote');
  if (branch.upstreamRef) parts.push(`Upstream ${branch.upstreamRef}`);
  if (branch.upstreamGone) parts.push('Upstream gone');
  if ((branch.aheadCount ?? 0) > 0 || (branch.behindCount ?? 0) > 0) {
    parts.push(`↑${branch.aheadCount ?? 0} ↓${branch.behindCount ?? 0}`);
  }
  if (branch.worktreePath) parts.push('Linked worktree');
  return parts.join(' · ') || 'No extra status';
}

export function compareHeadline(compare: GitGetBranchCompareResponse | null | undefined): string {
  if (!compare) return 'Select a branch to inspect compare details.';
  const ahead = Number(compare.targetAheadCount ?? 0);
  const behind = Number(compare.targetBehindCount ?? 0);
  if (ahead <= 0 && behind <= 0) return 'Selected branch matches the base branch.';
  if (ahead > 0 && behind <= 0) return `Target branch is ahead by ${ahead} commit${ahead === 1 ? '' : 's'}.`;
  if (behind > 0 && ahead <= 0) return `Target branch is behind by ${behind} commit${behind === 1 ? '' : 's'}.`;
  return `Target branch is ahead by ${ahead} and behind by ${behind} commits.`;
}

export function changeDisplayPath(change: GitWorkspaceChange | GitCommitFileSummary | null | undefined): string {
  return String(change?.displayPath || change?.path || change?.newPath || change?.oldPath || '').trim() || '(unknown path)';
}

export function changeSecondaryPath(change: GitWorkspaceChange | GitCommitFileSummary | null | undefined): string {
  if (!change) return '';
  if (change.oldPath && change.newPath && change.oldPath !== change.newPath) {
    return `${change.oldPath} → ${change.newPath}`;
  }
  return changeDisplayPath(change);
}

export function changeMetricsText(change: GitWorkspaceChange | GitCommitFileSummary | null | undefined): string {
  return `+${change?.additions ?? 0} / −${change?.deletions ?? 0}`;
}
