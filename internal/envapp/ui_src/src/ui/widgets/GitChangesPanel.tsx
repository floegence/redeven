import { Show, createEffect, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitListWorkspaceChangesResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { changeMetricsText, changeSecondaryPath, summarizeWorkspaceCount, workspaceSectionLabel } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitChangeTone, gitToneBadgeClass, gitToneInsetClass, gitToneSurfaceClass, workspaceSectionTone } from './GitChrome';

export interface GitChangesPanelProps {
  repoRootPath?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  selectedItem?: GitWorkspaceChange | null;
  loading?: boolean;
  error?: string;
  inspectNonce?: number;
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const [diffOpen, setDiffOpen] = createSignal(false);
  const totalChanges = () => summarizeWorkspaceCount(props.workspace?.summary);
  const selectedSectionTone = () => workspaceSectionTone(props.selectedItem?.section);

  createEffect(() => {
    const nonce = Number(props.inspectNonce ?? 0);
    if (nonce <= 0) return;
    if (props.selectedItem) {
      setDiffOpen(true);
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div class="shrink-0 border-b border-border/70 px-3 py-2">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground">Workspace</div>
            <div class="mt-0.5 text-[11px] text-muted-foreground">
              <Show when={!props.loading && !props.error} fallback={<span>Loading workspace state...</span>}>
                <span>{totalChanges() > 0 ? `${totalChanges()} file${totalChanges() === 1 ? '' : 's'} need review.` : 'Working tree is clean.'}</span>
              </Show>
            </div>
          </div>

          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(totalChanges() > 0 ? 'warning' : 'success'))}>
            {totalChanges() > 0 ? `${totalChanges()} open` : 'Clean'}
          </span>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
        <Show when={!props.loading} fallback={<div class="text-xs text-muted-foreground">Loading workspace changes...</div>}>
          <Show when={!props.error} fallback={<div class="text-xs text-error">{props.error}</div>}>
            <div class="space-y-1.5 sm:space-y-2">
              <div class="grid grid-cols-1 gap-1.5 sm:gap-2 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
                <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(totalChanges() > 0 ? 'warning' : 'success'))}>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Workspace Summary</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">Select files from the sidebar; diff opens in a floating panel.</div>
                    </div>
                    <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(totalChanges() > 0 ? 'warning' : 'success'))}>
                      {totalChanges() > 0 ? `${totalChanges()} open` : 'Clean'}
                    </span>
                  </div>

                  <div class="mt-2 flex flex-wrap items-end gap-2.5">
                    <div class="text-[24px] font-semibold tracking-tight text-foreground">{totalChanges()}</div>
                    <div class="text-[11px] text-muted-foreground">Focus stays here while diffs open in a separate floating surface.</div>
                  </div>

                  <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px] lg:grid-cols-4">
                    <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('staged')))}>
                      <div class="text-muted-foreground">Staged</div>
                      <div class="mt-0.5 text-sm font-semibold text-foreground">{props.workspace?.summary?.stagedCount ?? 0}</div>
                    </div>
                    <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('unstaged')))}>
                      <div class="text-muted-foreground">Unstaged</div>
                      <div class="mt-0.5 text-sm font-semibold text-foreground">{props.workspace?.summary?.unstagedCount ?? 0}</div>
                    </div>
                    <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('untracked')))}>
                      <div class="text-muted-foreground">Untracked</div>
                      <div class="mt-0.5 text-sm font-semibold text-foreground">{props.workspace?.summary?.untrackedCount ?? 0}</div>
                    </div>
                    <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('conflicted')))}>
                      <div class="text-muted-foreground">Conflicted</div>
                      <div class="mt-0.5 text-sm font-semibold text-foreground">{props.workspace?.summary?.conflictedCount ?? 0}</div>
                    </div>
                  </div>
                </section>

                <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(props.selectedItem ? selectedSectionTone() : 'neutral'))}>
                  <Show when={props.selectedItem} fallback={(
                    <div class="flex h-full min-h-[148px] flex-col justify-between gap-2">
                      <div>
                        <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Focused File</div>
                        <div class="mt-2 text-sm font-medium text-foreground">No file selected</div>
                        <div class="mt-1 text-[11px] leading-5 text-muted-foreground">Select a file from the sidebar to open its diff.</div>
                      </div>
                      <div class={cn('rounded-xl border px-2 py-1.5 text-[11px] text-muted-foreground', gitToneInsetClass('neutral'))}>
                        Diff opens separately, so this surface stays compact and easy to scan.
                      </div>
                    </div>
                  )}>
                    {(itemAccessor) => {
                      const item = itemAccessor();
                      return (
                        <div class="flex h-full min-h-[148px] flex-col justify-between gap-2">
                          <div>
                            <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Focused File</div>
                            <div class="mt-2 truncate text-sm font-medium text-foreground" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(selectedSectionTone()))}>
                                {workspaceSectionLabel((item.section || 'unstaged') as 'staged' | 'unstaged' | 'untracked' | 'conflicted')}
                              </span>
                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(gitChangeTone(item.changeType)))}>{item.changeType || 'modified'}</span>
                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('neutral'))}>{changeMetricsText(item)}</span>
                            </div>
                          </div>

                          <div class={cn('rounded-xl border px-2 py-1.5 text-[11px] text-muted-foreground', gitToneInsetClass(selectedSectionTone()))}>
                            {item.section === 'untracked'
                              ? 'Untracked files do not have a Git patch yet, but you can still keep them in the current review queue.'
                              : 'Open the floating diff to inspect exact line changes without leaving the current review context.'}
                          </div>

                          <div class="flex justify-end">
                            <Button size="sm" variant="outline" class="cursor-pointer" onClick={() => setDiffOpen(true)}>
                              Open Diff
                            </Button>
                          </div>
                        </div>
                      );
                    }}
                  </Show>
                </section>
              </div>
            </div>
          </Show>
        </Show>
      </div>

      <GitDiffDialog
        open={diffOpen()}
        onOpenChange={setDiffOpen}
        item={props.selectedItem}
        title="Workspace Diff"
        emptyMessage={totalChanges() > 0 ? 'Select a workspace file from the Git sidebar to inspect its diff.' : 'Workspace is clean.'}
        unavailableMessage={(item) => item.section === 'untracked' ? 'Untracked files do not have a Git patch yet.' : undefined}
      />
    </div>
  );
}
