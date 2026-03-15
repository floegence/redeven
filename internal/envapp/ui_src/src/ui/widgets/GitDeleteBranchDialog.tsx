import { Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Files, Shield, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Checkbox, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { branchDisplayName, gitDiffEntryIdentity, summarizeWorkspaceCount } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { GitWorkspaceStatusTable } from './GitWorkspaceStatusTable';
import { GitLabelBlock, GitMetaPill, GitPrimaryTitle, GitSection, GitStatePane, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

export type GitDeleteBranchDialogState = 'idle' | 'previewing' | 'deleting';

export interface GitDeleteBranchDialogConfirmOptions {
  removeLinkedWorktree: boolean;
  discardLinkedWorktreeChanges: boolean;
  planFingerprint?: string;
}

export interface GitDeleteBranchDialogProps {
  open: boolean;
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  actionError?: string;
  state?: GitDeleteBranchDialogState;
  onClose: () => void;
  onRetryPreview?: (branch: GitBranchSummary) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
}

interface DeleteReviewStepProps {
  step: string;
  title: string;
  detail: JSX.Element;
  ready?: boolean;
  emphasis?: 'neutral' | 'danger';
  children: JSX.Element;
}

function DeleteReviewStep(props: DeleteReviewStepProps) {
  const emphasis = () => props.emphasis ?? 'neutral';

  return (
    <div
      class={cn(
        'rounded-lg border px-3 py-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]',
        props.ready
          ? 'border-success/25 bg-success/10'
          : emphasis() === 'danger'
            ? 'border-error/20 bg-background/80'
            : 'border-border/50 bg-background/72',
      )}
    >
      <div class="flex items-start gap-3">
        <div
          class={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
            props.ready
              ? 'border-success/20 bg-success/12 text-success'
              : emphasis() === 'danger'
                ? 'border-error/20 bg-error/10 text-error'
                : 'border-border/50 bg-muted/[0.2] text-muted-foreground',
          )}
        >
          {props.step}
        </div>

        <div class="min-w-0 flex-1 space-y-2">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-xs font-semibold text-foreground">{props.title}</div>
              <GitMetaPill tone={props.ready ? 'success' : emphasis() === 'danger' ? 'danger' : 'neutral'}>
                {props.ready ? 'Ready' : 'Required'}
              </GitMetaPill>
            </div>
            <div class="text-[11px] leading-relaxed text-muted-foreground">{props.detail}</div>
          </div>
          {props.children}
        </div>
      </div>
    </div>
  );
}

function flattenLinkedWorktreeItems(preview: GitPreviewDeleteBranchResponse | null | undefined): GitWorkspaceChange[] {
  const linked = preview?.linkedWorktree;
  if (!linked) return [];
  return [
    ...(linked.staged ?? []).map((item) => ({ ...item, section: 'staged' as const })),
    ...(linked.unstaged ?? []).map((item) => ({ ...item, section: 'unstaged' as const })),
    ...(linked.untracked ?? []).map((item) => ({ ...item, section: 'untracked' as const })),
    ...(linked.conflicted ?? []).map((item) => ({ ...item, section: 'conflicted' as const })),
  ];
}

function fileCountLabel(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

export function GitDeleteBranchDialog(props: GitDeleteBranchDialogProps) {
  const layout = useLayout();

  const [confirmWorktreeRemoval, setConfirmWorktreeRemoval] = createSignal(false);
  const [confirmDiscardChanges, setConfirmDiscardChanges] = createSignal(false);
  const [typedBranchName, setTypedBranchName] = createSignal('');
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitWorkspaceChange | null>(null);

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const linkedWorktree = () => preview()?.linkedWorktree;
  const linkedItems = createMemo(() => flattenLinkedWorktreeItems(preview()));
  const linkedWorkspaceCount = createMemo(() => summarizeWorkspaceCount(linkedWorktree()?.summary));
  const safeDeleteBlocked = () => Boolean(preview() && !preview()!.safeDeleteAllowed);
  const blockingReason = () => String(preview()?.blockingReason ?? '').trim();
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const deleting = () => state() === 'deleting';
  const requiresWorktreeRemoval = () => Boolean(preview()?.requiresWorktreeRemoval);
  const requiresDiscardConfirmation = () => Boolean(preview()?.requiresDiscardConfirmation);
  const linkedWorktreePath = () => linkedWorktree()?.worktreePath || 'the linked worktree path';
  const worktreeAccessible = () => Boolean(linkedWorktree()?.accessible);

  createEffect(() => {
    if (!props.open) return;
    setConfirmWorktreeRemoval(false);
    setConfirmDiscardChanges(false);
    setTypedBranchName('');
    setDiffDialogOpen(false);
    setDiffDialogItem(null);
  });

  const canConfirm = () => {
    const currentBranch = props.branch;
    const currentPreview = preview();
    if (!props.open || !currentBranch || !currentPreview) return false;
    if (loading() || deleting()) return false;
    if (blockingReason() || safeDeleteBlocked()) return false;
    if (!currentPreview.requiresWorktreeRemoval) return true;
    if (!confirmWorktreeRemoval() || !confirmDiscardChanges()) return false;
    if (!currentPreview.requiresDiscardConfirmation) return true;
    return typedBranchName().trim() === branchName();
  };

  const confirmLabel = () => {
    if (deleting()) return 'Deleting...';
    if (!requiresWorktreeRemoval()) return 'Delete Branch';
    if (requiresDiscardConfirmation()) return 'Discard Changes, Delete Worktree and Branch';
    return 'Delete Worktree and Branch';
  };

  const reviewStatusTone = () => {
    if (blockingReason() || props.actionError) return 'warning' as const;
    return safeDeleteBlocked() ? 'warning' : 'success';
  };

  const deleteReadinessLabel = () => {
    if (blockingReason() || safeDeleteBlocked()) return 'Blocked';
    return canConfirm() ? 'Ready to delete' : 'Review required';
  };

  const deleteStatusValue = () => {
    if (blockingReason() || safeDeleteBlocked()) return <span class="text-warning">Blocked</span>;
    if (canConfirm()) return <span class="text-success">Ready to delete</span>;
    return <span class="text-warning">Review required</span>;
  };

  const changeImpactLabel = () => {
    const count = linkedWorkspaceCount();
    if (!requiresWorktreeRemoval()) return 'No linked worktree cleanup';
    if (count <= 0) return requiresDiscardConfirmation() ? 'Discard any new edits' : 'Linked worktree is clean';
    return `Discard ${fileCountLabel(count)}`;
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title={requiresWorktreeRemoval() ? 'Delete Branch Review' : 'Delete Branch'}
        description={requiresWorktreeRemoval()
          ? 'Review the linked worktree, verify pending files, and complete the final checkpoint before cleanup.'
          : 'Confirm the local branch deletion after reviewing the safe delete status.'}
        footer={(
          <div class="border-t border-border/60 bg-background/88 px-4 pt-3 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/78">
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button size="sm" variant="outline" class="w-full sm:w-auto" disabled={loading() || deleting()} onClick={props.onClose}>
                Cancel
              </Button>
              <Show when={props.previewError && props.branch}>
                <Button
                  size="sm"
                  variant="outline"
                  class="w-full sm:w-auto"
                  disabled={loading() || deleting()}
                  onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
                >
                  Retry Review
                </Button>
              </Show>
              <Button
                size="sm"
                variant="destructive"
                class="w-full sm:w-auto"
                disabled={!canConfirm()}
                loading={deleting()}
                onClick={() => {
                  const branch = props.branch;
                  const currentPreview = preview();
                  if (!branch || !currentPreview) return;
                  props.onConfirm?.(branch, {
                    removeLinkedWorktree: Boolean(currentPreview.requiresWorktreeRemoval),
                    discardLinkedWorktreeChanges: Boolean(currentPreview.requiresDiscardConfirmation),
                    planFingerprint: currentPreview.planFingerprint,
                  });
                }}
              >
                {confirmLabel()}
              </Button>
            </div>
          </div>
        )}
        class={cn(
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
          layout.isMobile() ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none' : 'max-h-[88vh] w-[min(1120px,94vw)]',
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show
            when={!loading()}
            fallback={<GitStatePane loading message="Reviewing branch deletion..." class="m-4" surface />}
          >
            <Show when={!props.previewError} fallback={<GitStatePane tone="error" message={props.previewError ?? 'Delete review failed.'} class="m-4" surface />}>
              <Show when={props.branch && preview()} fallback={<GitStatePane message="Choose a branch to review its deletion plan." class="m-4" surface />}>
                <div class="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-4">
                  <GitSection
                    label="Delete Plan"
                    tone={requiresWorktreeRemoval() ? 'warning' : 'neutral'}
                    description={requiresWorktreeRemoval()
                      ? 'This branch is still attached to a linked worktree. Review the pending files before confirming permanent cleanup.'
                      : 'This delete flow removes only the local branch after Git safe delete checks pass.'}
                    aside={<GitMetaPill tone={requiresWorktreeRemoval() ? 'warning' : 'neutral'}>{requiresWorktreeRemoval() ? 'Linked worktree review' : 'Local branch delete'}</GitMetaPill>}
                    class="shrink-0 border-border/70 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]"
                    bodyClass="space-y-3"
                  >
                    <GitLabelBlock label="Branch" tone={requiresWorktreeRemoval() ? 'warning' : 'neutral'}>
                      <div class="flex flex-wrap items-center gap-2.5">
                        <GitPrimaryTitle>{branchName()}</GitPrimaryTitle>
                        <Show when={preview()?.safeDeleteBaseRef}>
                          <GitMetaPill tone={safeDeleteBlocked() ? 'warning' : 'success'}>Delete base {preview()?.safeDeleteBaseRef}</GitMetaPill>
                        </Show>
                      </div>
                      <div class="text-[11px] leading-relaxed text-muted-foreground">
                        <Show
                          when={requiresWorktreeRemoval()}
                          fallback={'Git can delete this local branch directly when the safe delete check stays green.'}
                        >
                          Deleting this branch also removes the linked worktree and any uncommitted files listed in this review.
                        </Show>
                      </div>
                    </GitLabelBlock>

                    <GitStatStrip
                      columnsClass="grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-4"
                      items={[
                        { label: 'Branch', value: branchName() },
                        { label: 'Worktree', value: linkedWorktree()?.worktreePath || 'No linked worktree' },
                        { label: 'Delete status', value: deleteStatusValue() },
                        { label: 'Files to review', value: requiresWorktreeRemoval() ? fileCountLabel(linkedWorkspaceCount()) : 'No review required' },
                      ]}
                    />

                    <GitSubtleNote class="border-warning/20 bg-warning/10 text-foreground">
                      <div class="flex items-start gap-2">
                        <Files class="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        <span>
                          Open any listed file diff before confirming cleanup. The destructive action remains disabled until every required checkpoint is complete.
                        </span>
                      </div>
                    </GitSubtleNote>
                  </GitSection>

                  <div class={cn('grid min-h-0 flex-1 gap-3', linkedWorktree() ? 'xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.95fr)]' : 'grid-cols-1')}>
                    <div class="order-2 flex min-h-0 flex-col gap-3 xl:order-1">
                      <Show when={linkedWorktree()}>
                        <GitSection
                          label="Review Scope"
                          tone={worktreeAccessible() ? 'warning' : 'danger'}
                          description="Inspect the linked worktree before approving permanent cleanup."
                          aside={<GitMetaPill tone={worktreeAccessible() ? 'info' : 'warning'}>{worktreeAccessible() ? 'Accessible' : 'Inspection blocked'}</GitMetaPill>}
                          class="flex min-h-0 flex-1 flex-col overflow-hidden"
                          bodyClass="flex min-h-0 flex-1 flex-col gap-3"
                        >
                          <div class="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/45 bg-background/72 px-3 py-2.5">
                            <div class="min-w-0 flex-1 space-y-1">
                              <div class="text-xs font-semibold tracking-tight text-foreground">Linked worktree path</div>
                              <div class="text-[11px] leading-relaxed text-muted-foreground break-words">{linkedWorktreePath()}</div>
                            </div>
                            <GitMetaPill tone={linkedWorktree()?.accessible ? 'info' : 'warning'}>
                              {linkedWorktree()?.accessible ? 'Review before remove' : 'Path unavailable'}
                            </GitMetaPill>
                          </div>

                          <GitStatStrip
                            columnsClass="grid-cols-2 gap-1 xl:grid-cols-4"
                            items={[
                              { label: 'Staged', value: String(linkedWorktree()?.summary.stagedCount ?? 0) },
                              { label: 'Unstaged', value: String(linkedWorktree()?.summary.unstagedCount ?? 0) },
                              { label: 'Untracked', value: String(linkedWorktree()?.summary.untrackedCount ?? 0) },
                              { label: 'Conflicted', value: String(linkedWorktree()?.summary.conflictedCount ?? 0) },
                            ]}
                          />

                          <Show
                            when={worktreeAccessible()}
                            fallback={<GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">The linked worktree exists, but its file list is not accessible from the current agent scope.</GitSubtleNote>}
                          >
                            <div class="flex min-h-0 flex-1 flex-col gap-2">
                              <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <div class="text-xs font-semibold text-foreground">Pending changes</div>
                                <div class="text-[11px] leading-relaxed text-muted-foreground">
                                  Review every file that would be discarded with the linked worktree.
                                </div>
                              </div>
                              <div class="min-h-[14rem] max-h-[min(40dvh,24rem)] flex-1 overflow-hidden xl:max-h-none">
                                <GitWorkspaceStatusTable
                                  items={linkedItems()}
                                  selectedKey={gitDiffEntryIdentity(diffDialogItem())}
                                  emptyMessage="The linked worktree is clean."
                                  onOpenDiff={(item) => {
                                    setDiffDialogItem(item);
                                    setDiffDialogOpen(true);
                                  }}
                                />
                              </div>
                            </div>
                          </Show>
                        </GitSection>
                      </Show>
                    </div>

                    <div class="order-1 flex min-h-0 flex-col gap-3 xl:order-2">
                      <GitSection
                        label="Delete Safety"
                        tone={reviewStatusTone()}
                        description={safeDeleteBlocked()
                          ? 'Git safe delete is blocked, so the destructive action stays unavailable.'
                          : 'Git safe delete is ready. The remaining requirement is explicit review of the linked worktree cleanup.'}
                        aside={(
                          <div class="inline-flex items-center gap-1.5">
                            <Shield class="h-3.5 w-3.5 shrink-0" />
                            <span>{safeDeleteBlocked() || blockingReason() ? 'Blocked' : 'Ready'}</span>
                          </div>
                        )}
                        bodyClass="space-y-3"
                      >
                        <Show
                          when={preview()?.safeDeleteAllowed}
                          fallback={<GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{preview()?.safeDeleteReason || 'Safe delete is blocked.'}</GitSubtleNote>}
                        >
                          <GitSubtleNote class="border-success/30 bg-success/14 text-foreground">
                            <div class="flex items-start gap-2">
                              <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                              <div class="space-y-1">
                                <div class="text-[11px] font-semibold text-success">Safe delete ready</div>
                                <div class="text-[11px] leading-relaxed text-muted-foreground">
                                  Git can remove this branch with `git branch -d` once the review checkpoint is complete.
                                </div>
                              </div>
                            </div>
                          </GitSubtleNote>
                        </Show>
                        <Show when={blockingReason()}>
                          <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                        </Show>
                        <Show when={props.actionError}>
                          <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                        </Show>
                      </GitSection>

                      <Show when={requiresWorktreeRemoval()}>
                        <section class="overflow-hidden rounded-xl border border-error/30 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_52%),linear-gradient(180deg,rgba(255,99,99,0.12),rgba(255,99,99,0.04))] shadow-[0_12px_40px_rgba(120,18,18,0.10)] ring-1 ring-error/10">
                          <div class="space-y-4 px-4 py-4 sm:px-5">
                            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div class="flex min-w-0 items-start gap-3">
                                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-error/25 bg-background/75 text-error shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
                                  <Trash class="h-4 w-4" />
                                </div>
                                <div class="min-w-0 space-y-1">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-error">Final checkpoint</div>
                                    <GitMetaPill tone={canConfirm() ? 'danger' : 'warning'}>{deleteReadinessLabel()}</GitMetaPill>
                                  </div>
                                  <div class="text-sm font-semibold tracking-tight text-foreground">Confirm Destructive Actions</div>
                                  <div class="text-[11px] leading-relaxed text-muted-foreground">
                                    This cleanup removes the linked worktree and permanently discards every uncommitted file shown in this review.
                                  </div>
                                </div>
                              </div>
                              <div class="rounded-md border border-error/20 bg-background/75 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground sm:max-w-[15rem]">
                                The footer action stays disabled until each required step below is marked ready.
                              </div>
                            </div>

                            <GitStatStrip
                              columnsClass="grid-cols-1 gap-1 sm:grid-cols-3"
                              class="bg-background/20"
                              items={[
                                { label: 'Branch action', value: 'Delete local branch' },
                                { label: 'Worktree action', value: 'Remove linked worktree' },
                                { label: 'File impact', value: changeImpactLabel() },
                              ]}
                            />

                            <div class="space-y-2.5">
                              <DeleteReviewStep
                                step="1"
                                title="Approve linked worktree removal"
                                detail={`The linked worktree at ${linkedWorktreePath()} will be deleted together with this branch.`}
                                ready={confirmWorktreeRemoval()}
                              >
                                <Checkbox
                                  checked={confirmWorktreeRemoval()}
                                  onChange={setConfirmWorktreeRemoval}
                                  label={`I understand the linked worktree at ${linkedWorktreePath()} will be removed.`}
                                  size="sm"
                                />
                              </DeleteReviewStep>

                              <DeleteReviewStep
                                step="2"
                                title="Approve permanent file discard"
                                detail="Any staged, unstaged, untracked, or conflicted files inside that worktree will be lost."
                                ready={confirmDiscardChanges()}
                                emphasis="danger"
                              >
                                <Checkbox
                                  checked={confirmDiscardChanges()}
                                  onChange={setConfirmDiscardChanges}
                                  label="I understand uncommitted changes in that worktree will be permanently discarded."
                                  size="sm"
                                />
                              </DeleteReviewStep>

                              <Show when={requiresDiscardConfirmation()}>
                                <DeleteReviewStep
                                  step="3"
                                  title="Type the branch name"
                                  detail={(
                                    <>
                                      Type <span class="font-semibold text-foreground">{branchName()}</span> to complete the final destructive gate.
                                    </>
                                  )}
                                  ready={typedBranchName().trim() === branchName()}
                                  emphasis="danger"
                                >
                                  <div class="space-y-2">
                                    <label class="block text-[11px] font-medium text-foreground">
                                      Expected value: <span class="font-semibold">{branchName()}</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={typedBranchName()}
                                      class={cn(
                                        'w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors duration-150 focus:outline-none focus:ring-2',
                                        typedBranchName().trim() === branchName()
                                          ? 'border-success/35 focus:ring-success/30'
                                          : 'border-error/25 focus:ring-error/25',
                                      )}
                                      placeholder={branchName()}
                                      onInput={(event) => setTypedBranchName(event.currentTarget.value)}
                                    />
                                    <div class="text-[10px] leading-relaxed text-muted-foreground">
                                      The destructive action will only unlock when the typed branch name matches exactly.
                                    </div>
                                  </div>
                                </DeleteReviewStep>
                              </Show>
                            </div>
                          </div>
                        </section>
                      </Show>

                      <Show when={!requiresWorktreeRemoval()}>
                        <GitSubtleNote class="border-border/55 bg-card text-muted-foreground">
                          This branch does not require linked worktree cleanup. Use the lightweight confirmation flow to remove only the local branch reference.
                        </GitSubtleNote>
                      </Show>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </Dialog>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        title="Linked Worktree Diff"
        description={diffDialogItem()?.displayPath || diffDialogItem()?.path || 'Review the selected linked worktree diff.'}
        emptyMessage="Select a linked worktree file to inspect its diff."
      />
    </>
  );
}
