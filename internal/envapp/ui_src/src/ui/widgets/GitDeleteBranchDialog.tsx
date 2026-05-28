import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse, GitWorkspaceSummary } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { GitDeleteBranchReviewDialog } from './GitDeleteBranchReviewDialog';
import { type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';
import { useI18n, type EnvAppI18nContext, type I18nHelpers } from '../i18n';

export type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

export interface GitDeleteBranchDialogProps {
  open: boolean;
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  actionError?: string;
  state?: GitDeleteBranchDialogState;
  worktreeMode?: boolean;
  onClose: () => void;
  onRetryPreview?: (branch: GitBranchSummary) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
}

function formatPendingSummary(i18n: I18nHelpers, summary: GitWorkspaceSummary | null | undefined): string {
  const staged = Number(summary?.stagedCount ?? 0);
  const unstaged = Number(summary?.unstagedCount ?? 0);
  const untracked = Number(summary?.untrackedCount ?? 0);
  const conflicted = Number(summary?.conflictedCount ?? 0);

  const items: string[] = [];
  if (staged > 0) items.push(i18n.t('git.deleteBranch.pendingStaged', { count: i18n.formatNumber(staged) }));
  if (unstaged > 0) items.push(i18n.t('git.deleteBranch.pendingUnstaged', { count: i18n.formatNumber(unstaged) }));
  if (untracked > 0) items.push(i18n.t('git.deleteBranch.pendingUntracked', { count: i18n.formatNumber(untracked) }));
  if (conflicted > 0) items.push(i18n.t('git.deleteBranch.pendingConflicted', { count: i18n.formatNumber(conflicted) }));

  if (items.length <= 0) return '';
  return items.join(' · ');
}

function renderHighlightedPlaceholder(
  i18n: EnvAppI18nContext,
  key: Parameters<I18nHelpers['t']>[0],
  placeholderName: string,
  value: string,
  className: string,
): JSX.Element {
  const token = `__REDEVEN_${placeholderName.toUpperCase()}__`;
  const message = i18n.t(key, { [placeholderName]: token });
  const tokenIndex = message.indexOf(token);
  if (tokenIndex < 0) return message;
  return (
    <>
      {message.slice(0, tokenIndex)}
      <span class={className}>{value}</span>
      {message.slice(tokenIndex + token.length)}
    </>
  );
}

export function GitDeleteBranchDialog(props: GitDeleteBranchDialogProps) {
  const i18n = useI18n();
  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const worktreeMode = () => props.worktreeMode ?? true;
  const linkedWorktree = () => preview()?.linkedWorktree;
  const requiresWorktreeRemoval = () => Boolean(preview()?.requiresWorktreeRemoval);
  const linkedWorktreePath = () => linkedWorktree()?.worktreePath || i18n.t('git.deleteBranch.linkedWorktreePathFallback');
  const worktreeAccessible = () => Boolean(linkedWorktree()?.accessible);
  const pendingChangeSummary = () => formatPendingSummary(i18n, linkedWorktree()?.summary);

  const changeImpact = () => {
    if (!requiresWorktreeRemoval()) return i18n.t('git.deleteBranch.noWorktreeOrUncommittedRemoved');
    if (!worktreeAccessible()) return i18n.t('git.deleteBranch.runtimeCannotInspectWorktree');
    if (!pendingChangeSummary()) return i18n.t('git.deleteBranch.noUncommittedDetected');
    return i18n.t('git.deleteBranch.uncommittedDiscarded', { summary: pendingChangeSummary() });
  };

  return (
    <GitDeleteBranchReviewDialog
      open={props.open}
      branch={props.branch}
      preview={props.preview}
      previewError={props.previewError}
      actionError={props.actionError}
      state={props.state}
      description={worktreeMode() ? i18n.t('git.deleteBranch.descriptionWithWorktree', { branch: branchName() }) : i18n.t('git.deleteBranch.descriptionBranchOnly', { branch: branchName() })}
      safeConfirmLabel={worktreeMode() ? i18n.t('git.deleteBranch.deleteBranchAndWorktree') : i18n.t('git.deleteBranch.deleteBranch')}
      forceConfirmLabel={worktreeMode() ? i18n.t('git.deleteBranch.forceDeleteBranchAndWorktree') : i18n.t('git.deleteBranch.forceDeleteBranch')}
      dialogDesktopWidthClass={worktreeMode() ? 'w-[min(34rem,94vw)]' : 'w-[min(36rem,94vw)]'}
      summaryNoteClass={cn('text-foreground', worktreeMode() && requiresWorktreeRemoval() ? 'border-error/20 bg-error/10' : '')}
      safeSummary={(
        <div class="space-y-2">
          <div class="text-xs font-semibold text-foreground">{i18n.t('git.deleteBranch.thisActionWill')}</div>
          <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            <li class="list-disc">
              {renderHighlightedPlaceholder(i18n, 'git.deleteBranch.deleteLocalBranch', 'branch', branchName(), 'font-medium text-foreground')}
            </li>
            <Show when={worktreeMode() && requiresWorktreeRemoval()}>
              <li class="list-disc">
                {renderHighlightedPlaceholder(i18n, 'git.deleteBranch.removeLinkedWorktree', 'path', linkedWorktreePath(), 'break-all font-medium text-foreground')}
              </li>
            </Show>
            <Show
              when={worktreeMode()}
              fallback={<li class="list-disc">{i18n.t('git.deleteBranch.leaveCurrentWorktreeUntouched')}</li>}
            >
              <li class="list-disc">{changeImpact()}</li>
            </Show>
          </ul>
        </div>
      )}
      forceDeleteSummary={(
        <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li class="list-disc">
            {renderHighlightedPlaceholder(i18n, 'git.deleteBranch.branchPermanentlyRemoved', 'branch', branchName(), 'font-medium text-foreground')}
          </li>
          <Show when={worktreeMode()}>
            <li class="list-disc">
              {renderHighlightedPlaceholder(i18n, 'git.deleteBranch.linkedWorktreeRemoved', 'path', linkedWorktreePath(), 'break-all font-medium text-foreground')}
            </li>
            <li class="list-disc">{changeImpact()}</li>
          </Show>
          <Show when={!worktreeMode()}>
            <li class="list-disc">
              {i18n.t('git.deleteBranch.commitRecoveryWarning')}
            </li>
          </Show>
          <li class="list-disc">
            {renderHighlightedPlaceholder(i18n, 'git.deleteBranch.currentRepositoryWorktreeUnmodified', 'path', preview()?.repoRootPath || i18n.t('git.deleteBranch.currentRepositoryRootFallback'), 'break-all font-medium text-foreground')}
          </li>
        </ul>
      )}
      onClose={props.onClose}
      onRetryPreview={props.onRetryPreview}
      onConfirm={props.onConfirm}
    />
  );
}
