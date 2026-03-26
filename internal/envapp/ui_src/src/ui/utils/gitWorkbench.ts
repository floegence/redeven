import type {
  GitBranchSummary,
  GitCommitFileSummary,
  GitDiffFileContent,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
  GitStashDetail,
  GitWorkspaceChange,
  GitWorkspaceSection,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';

type GitDiffEntryLike = GitWorkspaceChange | GitCommitFileSummary | GitDiffFileContent;

export type GitWorkbenchSubview = 'overview' | 'changes' | 'branches' | 'history';
export type GitBranchSubview = 'status' | 'history';
export type GitWorkspaceViewSection = GitWorkspaceSection | 'changes';
export type GitDetachedSwitchSource = 'graph' | 'branch_history';
export type GitStashWindowTab = 'save' | 'stashes';
export type GitStashWindowSource = 'header' | 'changes' | 'branch_status' | 'merge_blocker';

export type GitStashWindowRequest = {
  tab?: GitStashWindowTab;
  repoRootPath?: string;
  source?: GitStashWindowSource;
};

export type GitDetachedSwitchTarget = {
  commitHash: string;
  shortHash?: string;
  source: GitDetachedSwitchSource;
  branchName?: string;
};

type GitSeededDiffFields = Pick<Partial<GitDiffFileContent>, 'patchText' | 'patchTruncated'>;

export type GitSeededDiffEntry<T extends GitCommitFileSummary | GitWorkspaceChange> = T & GitSeededDiffFields;
export type GitSeededCommitFileSummary = GitSeededDiffEntry<GitCommitFileSummary>;
export type GitSeededWorkspaceChange = GitSeededDiffEntry<GitWorkspaceChange>;
export type GitSeededWorkspaceChangesResponse = Omit<GitListWorkspaceChangesResponse, 'staged' | 'unstaged' | 'untracked' | 'conflicted'> & {
  staged: GitSeededWorkspaceChange[];
  unstaged: GitSeededWorkspaceChange[];
  untracked: GitSeededWorkspaceChange[];
  conflicted: GitSeededWorkspaceChange[];
};
export type GitSeededStashDetail = Omit<GitStashDetail, 'files'> & {
  files: GitSeededCommitFileSummary[];
};

export type GitHeadDisplay = {
  label: string;
  detail?: string;
  detached: boolean;
};

export function seedGitDiffContent(
  item: GitSeededCommitFileSummary | GitSeededWorkspaceChange | GitDiffFileContent | null | undefined,
): GitDiffFileContent | null {
  if (!item) return null;
  const patchText = typeof item.patchText === 'string' ? item.patchText : '';
  if (!patchText.trim()) return null;
  return {
    changeType: item.changeType,
    path: item.path,
    oldPath: item.oldPath,
    newPath: item.newPath,
    displayPath: item.displayPath,
    additions: item.additions,
    deletions: item.deletions,
    isBinary: item.isBinary,
    patchText,
    patchTruncated: item.patchTruncated,
  };
}

export type GitWorkbenchSubviewItem = {
  id: GitWorkbenchSubview;
  label: string;
  count?: number;
};

export const WORKSPACE_SECTIONS: GitWorkspaceSection[] = ['staged', 'unstaged', 'untracked', 'conflicted'];
export const WORKSPACE_REVIEW_SECTIONS: GitWorkspaceSection[] = ['unstaged', 'untracked', 'conflicted', 'staged'];
export const WORKSPACE_VIEW_SECTIONS: GitWorkspaceViewSection[] = ['changes', 'conflicted', 'staged'];

export function summarizeWorkspaceCount(summary: GitWorkspaceSummary | null | undefined): number {
  return Number(summary?.stagedCount ?? 0)
    + Number(summary?.unstagedCount ?? 0)
    + Number(summary?.untrackedCount ?? 0)
    + Number(summary?.conflictedCount ?? 0);
}

export function summarizePendingWorkspaceCount(summary: GitWorkspaceSummary | null | undefined): number {
  return Number(summary?.unstagedCount ?? 0)
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
    { id: 'changes', label: 'Changes', count: summarizeWorkspaceCount(summary) || undefined },
    { id: 'branches', label: 'Branches', count: params.branchesCount || undefined },
    { id: 'history', label: 'Graph' },
  ];
}

export function repoDisplayName(repoRootPath: string | null | undefined): string {
  const pathValue = String(repoRootPath ?? '').trim();
  if (!pathValue || pathValue === '/') return 'Repository';
  const parts = pathValue.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'Repository';
}

export function shortGitHash(hash: string | null | undefined, length = 8): string {
  const value = String(hash ?? '').trim();
  if (!value) return '';
  return value.slice(0, Math.max(1, length));
}

export function describeGitHead(
  primary?: Pick<GitRepoSummaryResponse, 'headRef' | 'headCommit' | 'detached'> | null,
  fallback?: Pick<GitRepoSummaryResponse, 'headRef' | 'headCommit' | 'detached'> | Pick<{ headRef?: string; headCommit?: string }, 'headRef' | 'headCommit'> | null,
): GitHeadDisplay {
  const headRef = String(primary?.headRef ?? fallback?.headRef ?? '').trim();
  const headCommit = String(primary?.headCommit ?? fallback?.headCommit ?? '').trim();
  const detached = Boolean(primary?.detached)
    || Boolean((fallback as { detached?: boolean } | null | undefined)?.detached)
    || headRef === ''
    || headRef === 'HEAD'
    || headRef === '(detached)';
  return {
    label: detached ? 'Detached HEAD' : (headRef || 'HEAD'),
    detail: detached ? shortGitHash(headCommit) || undefined : undefined,
    detached,
  };
}

export function reattachBranchFromRepoSummary(summary?: GitRepoSummaryResponse | null): GitBranchSummary | null {
  const branch = summary?.reattachBranch;
  if (!branch) return null;
  if (String(branch.kind ?? '').trim() !== 'local') return null;
  if (!String(branch.name ?? '').trim()) return null;
  return branch;
}

export function detachedHeadViewingSummary(headCommit: string | null | undefined): string {
  const detail = shortGitHash(headCommit);
  return detail ? `Viewing ${detail} without a branch.` : 'Viewing repository history without a branch.';
}

export function detachedHeadReattachSummary(
  branch: GitBranchSummary | null | undefined,
  options?: { compact?: boolean },
): string {
  const name = String(branch?.name ?? '').trim();
  if (!name) return '';
  return options?.compact ? `Last attached: ${name}` : `Last attached branch: ${name}.`;
}

export function detachedHeadCheckoutActionLabel(
  branch: GitBranchSummary | null | undefined,
  busy = false,
): string {
  if (busy) return 'Checking out...';
  const name = String(branch?.name ?? '').trim();
  return name ? `Checkout ${name}` : 'Checkout branch';
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

export function workspaceViewSectionLabel(section: GitWorkspaceViewSection): string {
  if (section === 'changes') return 'Changes';
  return workspaceSectionLabel(section);
}

export function workspaceBulkActionLabel(section: GitWorkspaceSection): string {
  switch (section) {
    case 'staged':
      return 'Unstage All';
    case 'untracked':
      return 'Track All';
    case 'conflicted':
    case 'unstaged':
    default:
      return 'Stage All';
  }
}

export function workspaceViewBulkActionLabel(section: GitWorkspaceViewSection): string {
  if (section === 'changes') return 'Stage All';
  return workspaceBulkActionLabel(section);
}

export function workspaceSectionActionKey(section: GitWorkspaceSection): string {
  return `section:${section}`;
}

export function workspaceViewSectionActionKey(section: GitWorkspaceViewSection): string {
  return `section:${section}`;
}

export function branchSubviewLabel(section: GitBranchSubview): string {
  switch (section) {
    case 'status':
      return 'Status';
    case 'history':
      return 'History';
    default:
      return 'Status';
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

export function workspaceViewSectionCount(summary: GitWorkspaceSummary | null | undefined, section: GitWorkspaceViewSection): number {
  if (section === 'changes') {
    return Number(summary?.unstagedCount ?? 0) + Number(summary?.untrackedCount ?? 0);
  }
  return workspaceSectionCount(summary, section);
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

export function workspaceViewSectionItems(
  workspace: GitListWorkspaceChangesResponse | null | undefined,
  section: GitWorkspaceViewSection,
): GitWorkspaceChange[] {
  if (section === 'changes') {
    return [
      ...workspaceSectionItems(workspace, 'unstaged'),
      ...workspaceSectionItems(workspace, 'untracked'),
    ];
  }
  return workspaceSectionItems(workspace, section);
}

export function workspaceViewSectionForItem(
  item: GitWorkspaceChange | null | undefined,
): GitWorkspaceViewSection {
  const section = String(item?.section ?? '').trim();
  if (section === 'unstaged' || section === 'untracked') return 'changes';
  if (section === 'staged' || section === 'conflicted') return section;
  return 'changes';
}

export function workspaceViewSectionHasItem(
  section: GitWorkspaceViewSection,
  item: GitWorkspaceChange | null | undefined,
): boolean {
  if (!item) return false;
  return workspaceViewSectionForItem(item) === section;
}

export function gitDiffEntryIdentity(item: GitDiffEntryLike | null | undefined): string {
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

export function pickDefaultWorkspaceSection(workspace: GitListWorkspaceChangesResponse | null | undefined): GitWorkspaceSection {
  for (const section of WORKSPACE_REVIEW_SECTIONS) {
    if (workspaceSectionItems(workspace, section).length > 0) return section;
  }
  return 'unstaged';
}

export function pickDefaultWorkspaceViewSection(
  workspace: GitListWorkspaceChangesResponse | null | undefined,
): GitWorkspaceViewSection {
  for (const section of WORKSPACE_VIEW_SECTIONS) {
    if (workspaceViewSectionItems(workspace, section).length > 0) return section;
  }
  return 'changes';
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

export function branchContextSummary(branch: GitBranchSummary | null | undefined): string {
  if (!branch) return 'No branch selected';
  const parts: string[] = [];
  if (branch.upstreamRef) parts.push(`Upstream ${branch.upstreamRef}`);
  if (branch.upstreamGone) parts.push('Upstream gone');
  if ((branch.aheadCount ?? 0) > 0 || (branch.behindCount ?? 0) > 0) {
    parts.push(`↑${branch.aheadCount ?? 0} ↓${branch.behindCount ?? 0}`);
  }
  if (branch.worktreePath) parts.push('Linked worktree');
  return parts.join(' · ') || 'No extra status';
}

export function branchStatusSummary(branch: GitBranchSummary | null | undefined): string {
  if (!branch) return 'No branch selected';
  const parts: string[] = [];
  if (branch.current) parts.push('Current');
  if (branch.kind === 'remote') parts.push('Remote');
  const context = branchContextSummary(branch);
  if (context !== 'No extra status') parts.push(context);
  return parts.join(' · ') || 'No extra status';
}

export function resolveGitBranchWorktreePath(
  branch: GitBranchSummary | null | undefined,
  activeRepoRootPath: string,
): string {
  if (!branch) return '';
  if (branch.current) return String(activeRepoRootPath ?? '').trim();
  return String(branch.worktreePath ?? '').trim();
}

export function compareHeadline(compare: GitGetBranchCompareResponse | null | undefined): string {
  if (!compare) return 'Select branches to inspect compare details.';
  const ahead = Number(compare.targetAheadCount ?? 0);
  const behind = Number(compare.targetBehindCount ?? 0);
  if (ahead <= 0 && behind <= 0) return 'Compared branch matches the reference branch.';
  if (ahead > 0 && behind <= 0) return `Compared branch is ahead by ${ahead} commit${ahead === 1 ? '' : 's'}.`;
  if (behind > 0 && ahead <= 0) return `Compared branch is behind by ${behind} commit${behind === 1 ? '' : 's'}.`;
  return `Compared branch is ahead by ${ahead} and behind by ${behind} commits.`;
}

export function syncStatusLabel(ahead?: number, behind?: number): string {
  const aheadCount = Number(ahead ?? 0);
  const behindCount = Number(behind ?? 0);
  if (aheadCount <= 0 && behindCount <= 0) return 'Up to date';
  if (aheadCount > 0 && behindCount <= 0) return `${aheadCount} outgoing`;
  if (behindCount > 0 && aheadCount <= 0) return `${behindCount} incoming`;
  return `${aheadCount} outgoing, ${behindCount} incoming`;
}

export function workspaceHealthLabel(summary: GitWorkspaceSummary | null | undefined): string {
  const total = summarizeWorkspaceCount(summary);
  if (total <= 0) return 'Working tree is clean.';
  const staged = Number(summary?.stagedCount ?? 0);
  const pending = summarizePendingWorkspaceCount(summary);
  if (staged > 0 && pending > 0) return `${staged} staged, ${pending} pending review.`;
  if (staged > 0) return `${staged} staged and ready to commit.`;
  return `${pending} pending change${pending === 1 ? '' : 's'} to review.`;
}

export function changeDisplayPath(change: GitDiffEntryLike | null | undefined): string {
  return String(change?.displayPath || change?.path || change?.newPath || change?.oldPath || '').trim() || '(unknown path)';
}

export function changeSecondaryPath(change: GitDiffEntryLike | null | undefined): string {
  if (!change) return '';
  if (change.oldPath && change.newPath && change.oldPath !== change.newPath) {
    return `${change.oldPath} → ${change.newPath}`;
  }
  return changeDisplayPath(change);
}

export function changeMetricsText(change: GitDiffEntryLike | null | undefined): string {
  return `+${change?.additions ?? 0} / −${change?.deletions ?? 0}`;
}

export function workspaceMutationPaths(change: GitWorkspaceChange | null | undefined): string[] {
  if (!change) return [];
  const values = [change.path, change.newPath, change.oldPath]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

export function isGitWorkspaceSection(value: unknown): value is GitWorkspaceSection {
  return WORKSPACE_SECTIONS.includes(value as GitWorkspaceSection);
}

export function recountWorkspaceSummary(workspace: GitListWorkspaceChangesResponse | null | undefined): GitWorkspaceSummary {
  return {
    stagedCount: workspace?.staged.length ?? 0,
    unstagedCount: workspace?.unstaged.length ?? 0,
    untrackedCount: workspace?.untracked.length ?? 0,
    conflictedCount: workspace?.conflicted.length ?? 0,
  };
}

export function unstageWorkspaceDestination(change: GitWorkspaceChange | null | undefined): GitWorkspaceSection {
  if (change?.changeType === 'added' && !String(change.oldPath ?? '').trim()) {
    return 'untracked';
  }
  return 'unstaged';
}

export function applyWorkspaceSectionMutation(
  workspace: GitListWorkspaceChangesResponse | null | undefined,
  params: {
    sourceSection: GitWorkspaceSection;
    paths: string[];
    destinationSection: GitWorkspaceSection | ((change: GitWorkspaceChange) => GitWorkspaceSection);
  },
): GitListWorkspaceChangesResponse | null {
  if (!workspace) return null;
  const wanted = new Set(params.paths.map((item) => String(item ?? '').trim()).filter(Boolean));
  if (wanted.size === 0) return workspace;

  const next = {
    staged: [...workspace.staged],
    unstaged: [...workspace.unstaged],
    untracked: [...workspace.untracked],
    conflicted: [...workspace.conflicted],
  };
  const sourceItems = next[params.sourceSection];
  const moved: GitWorkspaceChange[] = [];
  next[params.sourceSection] = sourceItems.filter((item) => {
    const match = workspaceMutationPaths(item).some((path) => wanted.has(path));
    if (!match) return true;
    const destination = typeof params.destinationSection === 'function'
      ? params.destinationSection(item)
      : params.destinationSection;
    moved.push({ ...item, section: destination });
    return false;
  });

  if (moved.length === 0) return workspace;

  for (const item of moved) {
    next[item.section as GitWorkspaceSection].push(item);
  }

  const summary = recountWorkspaceSummary({
    ...workspace,
    ...next,
  });

  return {
    ...workspace,
    ...next,
    summary,
  };
}
