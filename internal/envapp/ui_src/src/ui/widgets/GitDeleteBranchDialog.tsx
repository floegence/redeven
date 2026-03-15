import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Checkbox, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { branchDisplayName, gitDiffEntryIdentity, summarizeWorkspaceCount } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { GitWorkspaceStatusTable } from './GitWorkspaceStatusTable';
import { GitLabelBlock, GitMetaPill, GitPrimaryTitle, GitStatePane, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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
    if (!preview()?.requiresWorktreeRemoval) return 'Delete Branch';
    if (preview()?.requiresDiscardConfirmation) return 'Discard Changes, Delete Worktree and Branch';
    return 'Delete Worktree and Branch';
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title={preview()?.requiresWorktreeRemoval ? 'Delete Branch Review' : 'Delete Branch'}
        description={preview()?.requiresWorktreeRemoval
          ? 'Review the linked worktree before removing it and deleting the branch.'
          : 'Confirm the local branch deletion after reviewing the safe delete status.'}
        footer={(
          <div class="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" disabled={loading() || deleting()} onClick={props.onClose}>
              Cancel
            </Button>
            <Show when={props.previewError && props.branch}>
              <Button size="sm" variant="outline" disabled={loading() || deleting()} onClick={() => props.branch && props.onRetryPreview?.(props.branch)}>
                Retry Review
              </Button>
            </Show>
            <Button
              size="sm"
              variant="destructive"
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
        )}
        class={cn(
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
          layout.isMobile() ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none' : 'max-h-[88vh] w-[min(1100px,94vw)]',
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
                  <section class="shrink-0 rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                    <div class="flex flex-col gap-3">
                      <GitLabelBlock label="Branch" tone={preview()?.requiresWorktreeRemoval ? 'warning' : 'neutral'}>
                        <div class="flex flex-wrap items-center gap-2.5">
                          <GitPrimaryTitle>{branchName()}</GitPrimaryTitle>
                          <Show when={preview()?.safeDeleteBaseRef}>
                            <GitMetaPill tone={safeDeleteBlocked() ? 'warning' : 'success'}>Delete base {preview()?.safeDeleteBaseRef}</GitMetaPill>
                          </Show>
                        </div>
                        <div class="text-[11px] leading-relaxed text-muted-foreground">
                          <Show
                            when={preview()?.requiresWorktreeRemoval}
                            fallback={'The branch can be removed directly if the safe delete check passes.'}
                          >
                            This branch is checked out in a linked worktree and must be reviewed before deletion.
                          </Show>
                        </div>
                      </GitLabelBlock>

                      <GitStatStrip
                        columnsClass="grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-4"
                        items={[
                          { label: 'Branch', value: branchName() },
                          { label: 'Worktree', value: linkedWorktree()?.worktreePath || 'No linked worktree' },
                          { label: 'Safe Delete', value: safeDeleteBlocked() ? 'Blocked' : 'Ready' },
                          { label: 'Files to Review', value: String(linkedWorkspaceCount()) },
                        ]}
                      />
                    </div>
                  </section>

                  <Show when={linkedWorktree()}>
                    <section class="flex min-h-0 flex-1 flex-col gap-3">
                      <div class="shrink-0 rounded-md border border-border/65 bg-card px-3 py-2.5">
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0 flex-1">
                            <div class="text-xs font-medium text-foreground">Linked Worktree</div>
                            <div class="mt-1 text-[11px] leading-relaxed text-muted-foreground break-words">{linkedWorktree()?.worktreePath}</div>
                          </div>
                          <GitMetaPill tone={linkedWorktree()?.accessible ? 'info' : 'warning'}>
                            {linkedWorktree()?.accessible ? 'Accessible' : 'Blocked'}
                          </GitMetaPill>
                        </div>

                        <GitStatStrip
                          class="mt-3"
                          columnsClass="grid-cols-2 gap-1 xl:grid-cols-4"
                          items={[
                            { label: 'Staged', value: String(linkedWorktree()?.summary.stagedCount ?? 0) },
                            { label: 'Unstaged', value: String(linkedWorktree()?.summary.unstagedCount ?? 0) },
                            { label: 'Untracked', value: String(linkedWorktree()?.summary.untrackedCount ?? 0) },
                            { label: 'Conflicted', value: String(linkedWorktree()?.summary.conflictedCount ?? 0) },
                          ]}
                        />
                      </div>

                      <Show
                        when={linkedWorktree()?.accessible}
                        fallback={<GitSubtleNote>Linked worktree changes cannot be inspected from the current agent scope.</GitSubtleNote>}
                      >
                        <div class="flex min-h-0 flex-1 flex-col gap-2">
                          <div class="flex items-center justify-between gap-2">
                            <div class="text-xs font-medium text-foreground">Pending Changes</div>
                            <div class="text-[11px] text-muted-foreground">Open any file to inspect the diff before deleting the worktree.</div>
                          </div>
                          <div class="flex min-h-0 flex-1 overflow-hidden">
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
                    </section>
                  </Show>

                  <div class="shrink-0 space-y-3 rounded-md border border-border/65 bg-card px-3 py-2.5">
                    <div class="text-xs font-medium text-foreground">Delete Safety</div>
                    <Show
                      when={preview()?.safeDeleteAllowed}
                      fallback={<GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{preview()?.safeDeleteReason || 'Safe delete is blocked.'}</GitSubtleNote>}
                    >
                      <GitSubtleNote class="border-success/25 bg-success/10 text-success-foreground">
                        Safe delete is ready. Git can remove this branch with `git branch -d`.
                      </GitSubtleNote>
                    </Show>
                    <Show when={blockingReason()}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                    </Show>
                    <Show when={props.actionError}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                    </Show>
                  </div>

                  <Show when={preview()?.requiresWorktreeRemoval}>
                    <div class="shrink-0 space-y-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5">
                      <div class="text-xs font-medium text-foreground">Confirm Destructive Actions</div>
                      <Checkbox
                        checked={confirmWorktreeRemoval()}
                        onChange={setConfirmWorktreeRemoval}
                        label={`I understand the linked worktree at ${linkedWorktree()?.worktreePath || 'this path'} will be removed.`}
                        size="sm"
                      />
                      <Checkbox
                        checked={confirmDiscardChanges()}
                        onChange={setConfirmDiscardChanges}
                        label="I understand uncommitted changes in that worktree will be permanently discarded."
                        size="sm"
                      />
                      <Show when={preview()?.requiresDiscardConfirmation}>
                        <div>
                          <label class="mb-1 block text-xs font-medium text-foreground">
                            Type <span class="font-semibold">{branchName()}</span> to confirm
                          </label>
                          <input
                            type="text"
                            value={typedBranchName()}
                            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70"
                            placeholder={branchName()}
                            onInput={(event) => setTypedBranchName(event.currentTarget.value)}
                          />
                        </div>
                      </Show>
                    </div>
                  </Show>
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
