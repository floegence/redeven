import { Show, createEffect, createSignal } from 'solid-js';
import { Folder, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { GitRepoSummaryResponse } from '../protocol/redeven_v1';
import {
  createEmptyWorkspaceViewPageState,
  changeSecondaryPath,
  pickDefaultWorkspaceViewSection,
  repoDisplayName,
  type GitSeededWorkspaceChange,
  type GitSeededWorkspaceChangesResponse,
  type GitWorkspaceViewPageState,
  workspaceEntryKey,
  workspaceViewBulkActionLabel,
  workspaceViewSectionCount,
  workspaceViewSectionActionKey,
  workspaceViewSectionItems,
  workspaceViewSectionLabel,
  type GitStashWindowRequest,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import { gitChangePathClass, workspaceSectionTone } from './GitChrome';
import { GitCommitDialog } from './GitCommitDialog';
import { GitDiffDialog } from './GitDiffDialog';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitLabelBlock,
  GitMetaPill,
  GitPagedTableFooter,
  GitPrimaryTitle,
  GitShortcutOrbButton,
  GitShortcutOrbDock,
  GitStatePane,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import type { GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import type { GitAskFlowerRequest } from '../utils/gitBrowserShortcuts';
import { GitVirtualTable } from './GitVirtualTable';

export interface GitChangesPanelProps {
  repoSummary?: GitRepoSummaryResponse | null;
  workspace?: GitSeededWorkspaceChangesResponse | null;
  workspacePages?: Partial<Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>>;
  selectedSection?: GitWorkspaceViewSection;
  onSelectSection?: (section: GitWorkspaceViewSection) => void;
  selectedItem?: GitSeededWorkspaceChange | null;
  onSelectItem?: (item: GitSeededWorkspaceChange) => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | '';
  loading?: boolean;
  error?: string;
  commitMessage?: string;
  onCommitMessageChange?: (value: string) => void;
  onCommit?: (message: string) => void;
  commitBusy?: boolean;
  onStageSelected?: (item: GitSeededWorkspaceChange) => void;
  onUnstageSelected?: (item: GitSeededWorkspaceChange) => void;
  onBulkAction?: (section: GitWorkspaceViewSection) => void;
  onLoadMoreWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenCommitDialog?: () => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'workspace_section' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
}

function itemPath(item: GitSeededWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function listItemActionLabel(item: GitSeededWorkspaceChange): string {
  return item.section === 'staged' ? 'Unstage' : '+ Stage';
}

function sectionItems(workspace: GitSeededWorkspaceChangesResponse | null | undefined, section: GitWorkspaceViewSection): GitSeededWorkspaceChange[] {
  return workspaceViewSectionItems(workspace, section) as GitSeededWorkspaceChange[];
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
  items: GitSeededWorkspaceChange[];
  totalCount: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  selectedKey?: string;
  onSelectItem?: (item: GitSeededWorkspaceChange) => void;
  onOpenDiff?: (item: GitSeededWorkspaceChange) => void;
  onAction?: (item: GitSeededWorkspaceChange) => void;
  onLoadMore?: () => void;
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
        <GitVirtualTable
          items={props.items}
          tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[42rem] md:min-w-0`}
          header={(
            <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
              <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
              <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
            </tr>
          )}
          renderRow={(item) => {
            const active = () => props.selectedKey === workspaceEntryKey(item);
            const action = () => (item.section === 'staged' ? 'unstage' : 'stage');
            const busy = () => (
              (props.busyWorkspaceKey === workspaceEntryKey(item) || props.busyWorkspaceKey === workspaceViewSectionActionKey(props.section))
              && props.busyWorkspaceAction === action()
            );
            return (
              <tr
                aria-selected={active()}
                class={`${gitChangedFilesRowClass(active())} cursor-pointer`}
                onClick={() => props.onSelectItem?.(item)}
              >
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <div class="min-w-0">
                    <button
                      type="button"
                      class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                      title={changeSecondaryPath(item)}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onOpenDiff?.(item);
                      }}
                    >
                      {itemPath(item)}
                    </button>
                    <Show when={changeSecondaryPath(item) !== itemPath(item)}>
                      <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                    </Show>
                  </div>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <GitChangeStatusPill change={item.changeType} />
                </td>
                <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={item.additions} deletions={item.deletions} /></td>
                <td class={gitChangedFilesStickyCellClass(active())}>
                  <GitChangedFilesActionButton
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onAction?.(item);
                    }}
                    busy={busy()}
                    disabled={busy()}
                  >
                    {listItemActionLabel(item)}
                  </GitChangedFilesActionButton>
                </td>
              </tr>
            );
          }}
        />
        <Show when={(props.hasMore || props.loadingMore) && props.items.length > 0}>
          <GitPagedTableFooter
            summary={(
              <>
                Showing <span class="font-semibold tabular-nums text-foreground/90">{props.items.length}</span> of{' '}
                <span class="font-semibold tabular-nums text-foreground/90">{props.totalCount}</span> file{props.totalCount === 1 ? '' : 's'}.
              </>
            )}
            onLoadMore={props.onLoadMore}
            hasMore={props.hasMore}
            loading={props.loadingMore}
            loadingStatus="Loading next page"
          />
        </Show>
      </Show>
    </div>
  );
}

const EMPTY_WORKSPACE_PAGE_STATE = createEmptyWorkspaceViewPageState();

export function GitChangesPanel(props: GitChangesPanelProps) {
  const [commitDialogOpen, setCommitDialogOpen] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitSeededWorkspaceChange | null>(null);

  const selectedSection = () => props.selectedSection ?? pickDefaultWorkspaceViewSection(props.workspace);
  const summary = () => props.workspace?.summary ?? props.repoSummary?.workspaceSummary ?? null;
  const pageStateFor = (section: GitWorkspaceViewSection) => props.workspacePages?.[section] ?? EMPTY_WORKSPACE_PAGE_STATE;
  const selectedPageState = () => pageStateFor(selectedSection());
  const stagedPageState = () => pageStateFor('staged');
  const visibleItems = () => sectionItems(props.workspace, selectedSection());
  const stagedItems = () => sectionItems(props.workspace, 'staged');
  const visibleCount = () => (
    selectedPageState().initialized
      ? selectedPageState().totalCount
      : workspaceViewSectionCount(summary(), selectedSection())
  );
  const stagedCount = () => (
    stagedPageState().initialized
      ? stagedPageState().totalCount
      : workspaceViewSectionCount(summary(), 'staged')
  );
  const visibleLoading = () => Boolean(props.loading || (selectedPageState().loading && !selectedPageState().initialized));
  const visibleError = () => String(props.error ?? '').trim() || (!selectedPageState().initialized ? selectedPageState().error : '');
  const visibleLoadingMore = () => Boolean(selectedPageState().loading && selectedPageState().initialized);
  const stagedLoadingItems = () => Boolean(stagedPageState().loading && !props.commitBusy);
  const selectedTone = () => workspaceSectionTone(selectedSection());
  const visibleSectionLabel = () => workspaceViewSectionLabel(selectedSection());
  const repoRootPath = () => String(props.workspace?.repoRootPath ?? props.repoSummary?.repoRootPath ?? '').trim();
  const repoShortcutRequest = (): GitDirectoryShortcutRequest | null => {
    const path = repoRootPath();
    if (!path) return null;
    return {
      path,
      preferredName: repoDisplayName(path),
    };
  };
  const diffItem = () => diffDialogItem() ?? props.selectedItem ?? null;
  const selectedKey = () => workspaceEntryKey(diffItem());
  const canCommit = () => stagedCount() > 0 && String(props.commitMessage ?? '').trim().length > 0 && !props.commitBusy;
  const bulkActionLabel = () => workspaceViewBulkActionLabel(selectedSection());
  const bulkAction = () => (selectedSection() === 'staged' ? 'unstage' : 'stage');
  const bulkActionBusy = () => props.busyWorkspaceKey === workspaceViewSectionActionKey(selectedSection()) && props.busyWorkspaceAction === bulkAction();
  const canAskFlower = () => Boolean(props.onAskFlower && repoRootPath() && visibleItems().length > 0);
  const canOpenInTerminal = () => Boolean(props.onOpenInTerminal && repoShortcutRequest());
  const canBrowseFiles = () => Boolean(props.onBrowseFiles && repoShortcutRequest());
  const canOpenStash = () => Boolean(props.onOpenStash && repoRootPath());
  const repoShortcutDisabledReason = () => (repoShortcutRequest() ? '' : 'Repository path is unavailable.');
  const askFlowerDisabledReason = () => {
    if (canAskFlower()) return '';
    if (!repoRootPath()) return 'Repository path is unavailable.';
    if (visibleItems().length === 0) return 'No files in this section.';
    return 'Ask Flower is unavailable right now.';
  };

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
        <Show when={!visibleLoading()} fallback={<GitStatePane loading message="Loading workspace changes..." />}>
          <Show when={!visibleError()} fallback={<GitStatePane tone="error" message={visibleError()} />}>
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="shrink-0 rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <GitLabelBlock class="min-w-0 flex-1" label="Workspace" tone={selectedTone()}>
                    <div class="flex flex-wrap items-center gap-2">
                      <GitPrimaryTitle>{visibleSectionLabel()}</GitPrimaryTitle>
                      <GitMetaPill tone={selectedTone()}>{visibleCount()} file{visibleCount() === 1 ? '' : 's'}</GitMetaPill>
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
                  <div class="flex shrink-0 flex-wrap items-center justify-end gap-2.5 self-start">
                    <Show when={props.onAskFlower || props.onOpenInTerminal || props.onBrowseFiles}>
                      <GitShortcutOrbDock>
                        <Show when={props.onAskFlower}>
                          <GitShortcutOrbButton
                            label="Ask Flower"
                            tone="flower"
                            icon={FlowerIcon}
                            disabled={!canAskFlower()}
                            disabledReason={askFlowerDisabledReason()}
                            onClick={() => {
                              if (!canAskFlower()) return;
                              props.onAskFlower?.({
                                kind: 'workspace_section',
                                repoRootPath: repoRootPath(),
                                headRef: props.repoSummary?.headRef,
                                section: selectedSection(),
                                items: visibleItems(),
                              });
                            }}
                          />
                        </Show>
                        <Show when={props.onOpenInTerminal}>
                          <GitShortcutOrbButton
                            label="Terminal"
                            tone="terminal"
                            icon={Terminal}
                            disabled={!canOpenInTerminal()}
                            disabledReason={repoShortcutDisabledReason()}
                            onClick={() => {
                              const request = repoShortcutRequest();
                              if (!request) return;
                              props.onOpenInTerminal?.(request);
                            }}
                          />
                        </Show>
                        <Show when={props.onBrowseFiles}>
                          <GitShortcutOrbButton
                            label="Files"
                            tone="files"
                            icon={Folder}
                            disabled={!canBrowseFiles()}
                            disabledReason={repoShortcutDisabledReason()}
                            onClick={() => {
                              const request = repoShortcutRequest();
                              if (!request) return;
                              void props.onBrowseFiles?.(request);
                            }}
                          />
                        </Show>
                      </GitShortcutOrbDock>
                    </Show>

                    <div class="flex flex-wrap items-center justify-end gap-2">
                      <Show when={props.onOpenStash}>
                        <Button
                          size="sm"
                          variant="outline"
                          class="rounded-md"
                          disabled={!canOpenStash()}
                          onClick={() => {
                            const repoRoot = repoRootPath();
                            if (!repoRoot) return;
                            props.onOpenStash?.({
                              tab: 'save',
                              repoRootPath: repoRoot,
                              source: 'changes',
                            });
                          }}
                        >
                          Stash...
                        </Button>
                      </Show>
                      <Button
                        size="sm"
                        variant="outline"
                        class="rounded-md"
                        onClick={() => props.onBulkAction?.(selectedSection())}
                        disabled={visibleCount() === 0 || bulkActionBusy()}
                        loading={bulkActionBusy()}
                      >
                        {bulkActionLabel()}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        class="rounded-md"
                        onClick={() => {
                          props.onOpenCommitDialog?.();
                          setCommitDialogOpen(true);
                        }}
                        disabled={stagedCount() === 0}
                      >
                        Commit...
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="min-h-0 flex-1">
                <WorkspaceTable
                  section={selectedSection()}
                  items={visibleItems()}
                  totalCount={visibleCount()}
                  hasMore={selectedPageState().hasMore}
                  loadingMore={visibleLoadingMore()}
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
                  onLoadMore={() => props.onLoadMoreWorkspaceSection?.(selectedSection())}
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
        totalCount={stagedCount()}
        hasMore={stagedPageState().hasMore}
        loadingItems={stagedLoadingItems()}
        message={props.commitMessage ?? ''}
        loading={props.commitBusy}
        onMessageChange={(value) => props.onCommitMessageChange?.(value)}
        onConfirm={() => props.onCommit?.(String(props.commitMessage ?? ''))}
        onLoadMore={() => props.onLoadMoreWorkspaceSection?.('staged')}
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
        source={diffItem() ? {
          kind: 'workspace',
          repoRootPath: String(props.workspace?.repoRootPath ?? props.repoSummary?.repoRootPath ?? '').trim(),
          workspaceSection: String(diffItem()?.section ?? '').trim(),
        } : null}
        title="Workspace Diff"
        description={diffItem() ? changeSecondaryPath(diffItem()) : 'Review the selected workspace change.'}
        emptyMessage="Select a workspace file to inspect its diff."
      />
    </div>
  );
}
