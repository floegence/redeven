import { For, Show, createEffect, createSignal } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { GitListWorkspaceChangesResponse, GitRepoSummaryResponse, GitWorkspaceChange } from '../protocol/redeven_v1';
import {
  changeSecondaryPath,
  pickDefaultWorkspaceViewSection,
  workspaceEntryKey,
  workspaceViewBulkActionLabel,
  workspaceViewSectionActionKey,
  workspaceViewSectionItems,
  workspaceViewSectionLabel,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import { gitChangePathClass, gitChangeTone, gitToneDotClass, workspaceSectionTone } from './GitChrome';
import { GitCommitDialog } from './GitCommitDialog';
import { GitDiffDialog } from './GitDiffDialog';
import { GitChangeMetrics, GitLabelBlock, GitMetaPill, GitPrimaryTitle, GitSubtleNote } from './GitWorkbenchPrimitives';

export interface GitChangesPanelProps {
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitListWorkspaceChangesResponse | null;
  selectedSection?: GitWorkspaceViewSection;
  onSelectSection?: (section: GitWorkspaceViewSection) => void;
  selectedItem?: GitWorkspaceChange | null;
  onSelectItem?: (item: GitWorkspaceChange) => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | '';
  loading?: boolean;
  error?: string;
  commitMessage?: string;
  onCommitMessageChange?: (value: string) => void;
  onCommit?: (message: string) => void;
  commitBusy?: boolean;
  onStageSelected?: (item: GitWorkspaceChange) => void;
  onUnstageSelected?: (item: GitWorkspaceChange) => void;
  onBulkAction?: (section: GitWorkspaceViewSection) => void;
}

function itemPath(item: GitWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function listItemActionLabel(item: GitWorkspaceChange): string {
  return item.section === 'staged' ? 'Unstage' : '+ Stage';
}

function sectionItems(workspace: GitListWorkspaceChangesResponse | null | undefined, section: GitWorkspaceViewSection): GitWorkspaceChange[] {
  return workspaceViewSectionItems(workspace, section);
}

function emptySectionMessage(section: GitWorkspaceViewSection): string {
  switch (section) {
    case 'staged':
      return 'No staged files yet. Stage files from the pending sections, then open the commit dialog.';
    case 'changes':
      return 'No pending files in this repository.';
    case 'conflicted':
      return 'No conflicted files right now.';
    default:
      return 'No files in this section.';
  }
}

interface WorkspaceTableProps {
  section: GitWorkspaceViewSection;
  items: GitWorkspaceChange[];
  selectedKey?: string;
  onSelectItem?: (item: GitWorkspaceChange) => void;
  onOpenDiff?: (item: GitWorkspaceChange) => void;
  onAction?: (item: GitWorkspaceChange) => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | '';
}

function WorkspaceTable(props: WorkspaceTableProps) {
  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="px-4 py-8">
            <GitSubtleNote>{emptySectionMessage(props.section)}</GitSubtleNote>
          </div>
        )}
      >
        <div class="min-h-0 flex-1 overflow-auto">
          <table class="w-full min-w-[42rem] text-xs md:min-w-0">
            <thead class="sticky top-0 z-10 bg-muted/30 backdrop-blur">
              <tr class="border-b border-border/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <th class="px-3 py-2.5 font-medium">Path</th>
                <th class="px-3 py-2.5 font-medium">Status</th>
                <th class="px-3 py-2.5 font-medium">Changes</th>
                <th class="sticky right-0 z-20 border-l border-border/50 bg-muted/30 px-3 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.items}>
                {(item) => {
                  const active = () => props.selectedKey === workspaceEntryKey(item);
                  const action = () => (item.section === 'staged' ? 'unstage' : 'stage');
                  const busy = () => (
                    (props.busyWorkspaceKey === workspaceEntryKey(item) || props.busyWorkspaceKey === workspaceViewSectionActionKey(props.section))
                    && props.busyWorkspaceAction === action()
                  );
                  return (
                    <tr
                      aria-selected={active()}
                      class={`group cursor-pointer border-b border-border/45 last:border-b-0 ${active() ? 'bg-muted/45' : 'bg-transparent hover:bg-muted/25'}`}
                      onClick={() => props.onSelectItem?.(item)}
                    >
                      <td class="px-3 py-2.5 align-top">
                        <div class="min-w-0">
                          <button
                            type="button"
                            class={`block max-w-full cursor-pointer truncate text-left text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                            title={changeSecondaryPath(item)}
                            onClick={(event) => {
                              event.stopPropagation();
                              props.onOpenDiff?.(item);
                            }}
                          >
                            {itemPath(item)}
                          </button>
                          <Show when={changeSecondaryPath(item) !== itemPath(item)}>
                            <div class="mt-0.5 truncate text-[10px] text-muted-foreground" title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                          </Show>
                        </div>
                      </td>
                      <td class="px-3 py-2.5 align-top">
                        <div class="inline-flex items-center gap-1.5 text-xs text-foreground">
                          <span class={`h-1.5 w-1.5 rounded-full ${gitToneDotClass(gitChangeTone(item.changeType))}`} aria-hidden="true" />
                          <span class="capitalize">{item.changeType || 'modified'}</span>
                        </div>
                      </td>
                      <td class="px-3 py-2.5 align-top"><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                      <td class={`sticky right-0 z-10 border-l border-border/45 px-3 py-2.5 text-right align-top shadow-[-1px_0_0_rgba(0,0,0,0.03)] ${active() ? 'bg-muted/45' : 'bg-card group-hover:bg-muted/25'}`}>
                        <Button
                          size="xs"
                          variant={item.section === 'staged' ? 'outline' : 'default'}
                          class={item.section === 'staged' ? 'min-w-[5.5rem] justify-center rounded-sm' : 'min-w-[5.5rem] justify-center rounded-sm'}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onAction?.(item);
                          }}
                          loading={busy()}
                          disabled={busy()}
                        >
                          {listItemActionLabel(item)}
                        </Button>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const [commitDialogOpen, setCommitDialogOpen] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitWorkspaceChange | null>(null);

  const selectedSection = () => props.selectedSection ?? pickDefaultWorkspaceViewSection(props.workspace);
  const visibleItems = () => sectionItems(props.workspace, selectedSection());
  const stagedItems = () => sectionItems(props.workspace, 'staged');
  const stagedCount = () => stagedItems().length;
  const selectedTone = () => workspaceSectionTone(selectedSection());
  const visibleSectionLabel = () => workspaceViewSectionLabel(selectedSection());
  const diffItem = () => diffDialogItem() ?? props.selectedItem ?? null;
  const selectedKey = () => workspaceEntryKey(diffItem());
  const canCommit = () => stagedCount() > 0 && String(props.commitMessage ?? '').trim().length > 0 && !props.commitBusy;
  const bulkActionLabel = () => workspaceViewBulkActionLabel(selectedSection());
  const bulkAction = () => (selectedSection() === 'staged' ? 'unstage' : 'stage');
  const bulkActionBusy = () => props.busyWorkspaceKey === workspaceViewSectionActionKey(selectedSection()) && props.busyWorkspaceAction === bulkAction();

  createEffect(() => {
    if (!commitDialogOpen()) return;
    if (props.commitBusy) return;
    if (stagedCount() === 0 && String(props.commitMessage ?? '').trim().length === 0) {
      setCommitDialogOpen(false);
    }
  });

  createEffect(() => {
    if (!diffDialogOpen()) return;
    if (diffItem()) return;
    setDiffDialogOpen(false);
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
        <Show when={!props.loading} fallback={<div class="flex flex-1 items-center text-xs text-muted-foreground">Loading workspace changes...</div>}>
          <Show when={!props.error} fallback={<div class="flex flex-1 items-center text-xs text-error">{props.error}</div>}>
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="shrink-0 rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <GitLabelBlock class="min-w-0 flex-1" label="Workspace" tone={selectedTone()}>
                    <div class="flex flex-wrap items-center gap-2">
                      <GitPrimaryTitle>{visibleSectionLabel()}</GitPrimaryTitle>
                      <GitMetaPill tone={selectedTone()}>{visibleItems().length} file{visibleItems().length === 1 ? '' : 's'}</GitMetaPill>
                      <Show when={stagedCount() > 0}>
                        <GitMetaPill tone="success">{stagedCount()} staged</GitMetaPill>
                      </Show>
                    </div>
                    <div class="text-[11px] leading-relaxed text-muted-foreground">
                      {selectedSection() === 'staged'
                        ? 'Review the staged snapshot, then commit it from the dialog.'
                        : 'Stage the files you want from this table, then commit them from the staged dialog.'}
                    </div>
                  </GitLabelBlock>
                  <div class="flex shrink-0 items-center justify-end gap-2 self-start">
                    <Button
                      size="sm"
                      variant="outline"
                      class="rounded-md"
                      onClick={() => props.onBulkAction?.(selectedSection())}
                      disabled={visibleItems().length === 0 || bulkActionBusy()}
                      loading={bulkActionBusy()}
                    >
                      {bulkActionLabel()}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      class="rounded-md"
                      onClick={() => setCommitDialogOpen(true)}
                      disabled={stagedCount() === 0}
                    >
                      Commit...
                    </Button>
                  </div>
                </div>
              </div>

              <div class="min-h-0 flex-1">
                <WorkspaceTable
                  section={selectedSection()}
                  items={visibleItems()}
                  selectedKey={selectedKey()}
                  onSelectItem={props.onSelectItem}
                  onOpenDiff={(item) => {
                    setDiffDialogItem(item);
                    props.onSelectItem?.(item);
                    setDiffDialogOpen(true);
                  }}
                  onAction={(item) => {
                    if (item.section === 'staged') props.onUnstageSelected?.(item);
                    else props.onStageSelected?.(item);
                  }}
                  busyWorkspaceKey={props.busyWorkspaceKey}
                  busyWorkspaceAction={props.busyWorkspaceAction}
                />
              </div>
            </div>
          </Show>
        </Show>
      </div>

      <GitCommitDialog
        open={commitDialogOpen()}
        stagedItems={stagedItems()}
        message={props.commitMessage ?? ''}
        loading={props.commitBusy}
        onMessageChange={(value) => props.onCommitMessageChange?.(value)}
        onConfirm={() => props.onCommit?.(String(props.commitMessage ?? ''))}
        onClose={() => setCommitDialogOpen(false)}
        canCommit={canCommit()}
      />

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffItem()}
        title="Workspace Diff"
        description={diffItem() ? changeSecondaryPath(diffItem()) : 'Review the selected workspace change.'}
        emptyMessage="Select a workspace file to inspect its diff."
      />
    </div>
  );
}
