import { Show, createEffect, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitListWorkspaceChangesResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import { changeMetricsText, changeSecondaryPath, summarizeWorkspaceCount, workspaceSectionLabel } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitToneActionButtonClass, workspaceSectionTone } from './GitChrome';
import { GitSection, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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
      <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
        <Show when={!props.loading} fallback={<div class="text-xs text-muted-foreground">Loading workspace changes...</div>}>
          <Show when={!props.error} fallback={<div class="text-xs text-error">{props.error}</div>}>
            <div class="space-y-1.5 sm:space-y-2">
              <GitSection
                label="Workspace Summary"
                description={totalChanges() > 0 ? `${totalChanges()} file${totalChanges() === 1 ? '' : 's'} need review.` : 'Working tree is clean.'}
                aside={totalChanges() > 0 ? `${totalChanges()} open` : 'Clean'}
                tone={totalChanges() > 0 ? 'warning' : 'success'}
              >
                <GitStatStrip
                  columnsClass="grid-cols-2 lg:grid-cols-4"
                  items={[
                    { label: 'Staged', value: String(props.workspace?.summary?.stagedCount ?? 0) },
                    { label: 'Unstaged', value: String(props.workspace?.summary?.unstagedCount ?? 0) },
                    { label: 'Untracked', value: String(props.workspace?.summary?.untrackedCount ?? 0) },
                    { label: 'Conflicted', value: String(props.workspace?.summary?.conflictedCount ?? 0) },
                  ]}
                />
                <GitSubtleNote class="mt-2">
                  Choose a workspace file from the Git sidebar; floating diffs keep this review surface compact.
                </GitSubtleNote>
              </GitSection>

              <GitSection label="Focused File" tone={props.selectedItem ? selectedSectionTone() : 'neutral'}>
                <Show
                  when={props.selectedItem}
                  fallback={
                    <div>
                      <div class="text-[12px] font-medium text-foreground">Choose a workspace file</div>
                      <div class="mt-1 text-[11px] leading-5 text-muted-foreground">Select a file from the sidebar to load its floating diff.</div>
                      <GitSubtleNote class="mt-2">Line-level inspection opens in a floating panel while this review surface stays compact.</GitSubtleNote>
                    </div>
                  }
                >
                  {(itemAccessor) => {
                    const item = itemAccessor();
                    return (
                      <div>
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0 flex-1">
                            <div class="truncate text-[12px] font-medium text-foreground" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span>{workspaceSectionLabel((item.section || 'unstaged') as 'staged' | 'unstaged' | 'untracked' | 'conflicted')}</span>
                              <span aria-hidden="true">·</span>
                              <span class="capitalize">{item.changeType || 'modified'}</span>
                              <span aria-hidden="true">·</span>
                              <span>{changeMetricsText(item)}</span>
                            </div>
                          </div>

                          <Button size="sm" variant="ghost" class={gitToneActionButtonClass()} onClick={() => setDiffOpen(true)}>
                            Open Diff
                          </Button>
                        </div>

                        <GitSubtleNote class="mt-2">
                          {item.section === 'untracked'
                            ? 'Untracked files do not have a Git patch yet, but they can still stay in the current review queue.'
                            : 'Open the floating diff to inspect exact line changes without leaving the current review context.'}
                        </GitSubtleNote>
                      </div>
                    );
                  }}
                </Show>
              </GitSection>
            </div>
          </Show>
        </Show>
      </div>

      <GitDiffDialog
        open={diffOpen()}
        onOpenChange={setDiffOpen}
        item={props.selectedItem}
        title="Workspace Diff"
        emptyMessage={totalChanges() > 0 ? 'Choose a workspace file to inspect its diff.' : 'Workspace is clean.'}
        unavailableMessage={(item) => (item.section === 'untracked' ? 'Untracked files do not have a Git patch yet.' : undefined)}
      />
    </div>
  );
}
