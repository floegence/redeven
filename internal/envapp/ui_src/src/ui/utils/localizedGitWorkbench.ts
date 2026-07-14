import type {
  GitBranchSummary,
  GitCommitDiffPresentation,
  GitRepoSummaryResponse,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';
import type { I18nHelpers } from '../i18n';
import {
  buildGitWorkbenchSubviewItems,
  isGitFirstParentCommitPresentation,
  isGitMergeCommitPresentation,
  shortGitHash,
  summarizePendingWorkspaceCount,
  summarizeWorkspaceCount,
  type GitHeadDisplay,
  type GitWorkbenchSubviewItem,
  type GitWorkspaceViewSection,
} from './gitWorkbench';

export function localizedGitCommitDiffPresentationBadge(
  presentation: GitCommitDiffPresentation | null | undefined,
  i18n: I18nHelpers,
): string {
  return isGitMergeCommitPresentation(presentation) ? i18n.t('gitPresentation.mergeCommit') : '';
}

export function localizedGitCommitDiffPresentationDetail(
  presentation: GitCommitDiffPresentation | null | undefined,
  i18n: I18nHelpers,
): string {
  if (isGitFirstParentCommitPresentation(presentation)) return i18n.t('gitPresentation.firstParentDiff');
  if (isGitMergeCommitPresentation(presentation)) return i18n.t('gitPresentation.mergeDiffContext');
  return '';
}

export function localizedGitHeadDisplay(display: GitHeadDisplay, i18n: I18nHelpers): GitHeadDisplay {
  return display.detached
    ? { ...display, label: i18n.t('git.notifications.detachedHeadTitle') }
    : display;
}

export function localizedDetachedHeadViewingSummary(
  headCommit: string | null | undefined,
  i18n: I18nHelpers,
): string {
  const commit = shortGitHash(headCommit);
  return commit
    ? i18n.t('gitPresentation.viewingDetachedAt', { commit })
    : i18n.t('gitPresentation.viewingDetached');
}

export function localizedDetachedHeadReattachSummary(
  branch: GitBranchSummary | null | undefined,
  i18n: I18nHelpers,
  options?: { compact?: boolean },
): string {
  const name = String(branch?.name ?? '').trim();
  if (!name) return '';
  return options?.compact
    ? i18n.t('gitPresentation.lastAttachedCompact', { branch: name })
    : i18n.t('gitPresentation.lastAttached', { branch: name });
}

export function localizedDetachedHeadCheckoutActionLabel(
  branch: GitBranchSummary | null | undefined,
  busy: boolean,
  i18n: I18nHelpers,
): string {
  if (busy) return i18n.t('gitPresentation.checkingOut');
  const name = String(branch?.name ?? '').trim();
  return name ? `${i18n.t('git.common.checkout')} ${name}` : i18n.t('gitPresentation.checkoutBranch');
}

export function localizedWorkspaceViewSectionLabel(
  section: GitWorkspaceViewSection,
  i18n: I18nHelpers,
): string {
  switch (section) {
    case 'staged':
      return i18n.t('git.common.staged');
    case 'conflicted':
      return i18n.t('git.common.conflicted');
    case 'changes':
    default:
      return i18n.t('git.common.changes');
  }
}

export function localizedBranchContextSummary(
  branch: GitBranchSummary | null | undefined,
  i18n: I18nHelpers,
): string {
  if (!branch) return i18n.t('git.overview.chooseBranch');
  const parts: string[] = [];
  if (branch.upstreamRef) parts.push(`${i18n.t('git.common.upstream')} ${branch.upstreamRef}`);
  if (branch.upstreamGone) parts.push(i18n.t('gitPresentation.upstreamGone'));
  if ((branch.aheadCount ?? 0) > 0 || (branch.behindCount ?? 0) > 0) {
    parts.push(`↑${branch.aheadCount ?? 0} ↓${branch.behindCount ?? 0}`);
  }
  if (branch.worktreePath) parts.push(i18n.t('git.overview.linkedWorktree'));
  return parts.join(' · ') || i18n.t('gitPresentation.noExtraStatus');
}

export function localizedBranchStatusSummary(
  branch: GitBranchSummary | null | undefined,
  i18n: I18nHelpers,
): string {
  if (!branch) return i18n.t('git.overview.chooseBranch');
  const parts: string[] = [];
  if (branch.current) parts.push(i18n.t('uiCopy.git.current'));
  if (branch.kind === 'remote') parts.push(i18n.t('uiCopy.git.remote'));
  const context = localizedBranchContextSummary(branch, i18n);
  if (context !== i18n.t('gitPresentation.noExtraStatus')) parts.push(context);
  return parts.join(' · ') || i18n.t('gitPresentation.noExtraStatus');
}

export function localizedWorkspaceHealthLabel(
  summary: GitWorkspaceSummary | null | undefined,
  i18n: I18nHelpers,
): string {
  const total = summarizeWorkspaceCount(summary);
  if (total <= 0) return i18n.t('git.overview.workingTreeClean');
  const staged = Number(summary?.stagedCount ?? 0);
  const pending = summarizePendingWorkspaceCount(summary);
  if (staged > 0 && pending > 0) {
    return `${i18n.t('git.common.staged')}: ${staged} · ${i18n.t('git.common.changes')}: ${pending}`;
  }
  if (staged > 0) return `${i18n.t('git.common.staged')}: ${staged}`;
  return i18n.tn('git.overview.openCount', pending);
}

export function localizedSyncStatusLabel(ahead: number | undefined, behind: number | undefined, i18n: I18nHelpers): string {
  const aheadCount = Number(ahead ?? 0);
  const behindCount = Number(behind ?? 0);
  if (aheadCount <= 0 && behindCount <= 0) return i18n.t('git.notifications.upToDateTitle');
  return `↑${aheadCount} ↓${behindCount}`;
}

export function localizedGitWorkbenchSubviewItems(
  params: {
    repoSummary?: GitRepoSummaryResponse | null;
    workspace?: Parameters<typeof buildGitWorkbenchSubviewItems>[0]['workspace'];
    branchesCount?: number;
  },
  i18n: I18nHelpers,
): GitWorkbenchSubviewItem[] {
  return buildGitWorkbenchSubviewItems(params).map((item) => ({
    ...item,
    label: item.id === 'changes'
      ? i18n.t('git.common.changes')
      : item.id === 'branches'
        ? i18n.t('gitPresentation.branchesView')
        : i18n.t('gitPresentation.graphView'),
  }));
}
