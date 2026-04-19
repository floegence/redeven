import { For, Show, createEffect, createSignal } from 'solid-js';
import { Folder, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { GitRepoSummaryResponse } from '../protocol/redeven_v1';
import {
  createEmptyWorkspaceViewPageState,
  changeSecondaryPath,
  isGitWorkspaceDirectoryEntry,
  pickDefaultWorkspaceViewSection,
  repoDisplayName,
  type GitSeededWorkspaceChange,
  type GitSeededWorkspaceChangesResponse,
  type GitWorkspaceViewPageState,
  workspaceDirectoryPath,
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
  GitPanelFrame,
  GitPagedTableFooter,
  GitPrimaryTitle,
  GitShortcutOrbButton,
  GitShortcutOrbDock,
  GitStatePane,
  GitSubtleNote,
  GitTableFrame,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import type { GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import type { GitAskFlowerRequest } from '../utils/gitBrowserShortcuts';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
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
  busyWorkspaceAction?: 'stage' | 'unstage' | 'discard' | '';
  loading?: boolean;
  error?: string;
  commitMessage?: string;
  onCommitMessageChange?: (value: string) => void;
  onCommit?: (message: string) => void;
  commitBusy?: boolean;
  onStageSelected?: (item: GitSeededWorkspaceChange) => void;
  onUnstageSelected?: (item: GitSeededWorkspaceChange) => void;
  onDiscardSelected?: (item: GitSeededWorkspaceChange) => void;
  onNavigateDirectory?: (directoryPath: string) => void;
  onBulkAction?: (section: GitWorkspaceViewSection) => void;
  onDiscardAll?: (section: GitWorkspaceViewSection) => void;
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

function itemPrimaryLabel(item: GitSeededWorkspaceChange): string {
  const pathValue = isGitWorkspaceDirectoryEntry(item)
    ? workspaceDirectoryPath(item)
    : itemPath(item);
  const parts = pathValue.split('/').filter(Boolean);
  return parts[parts.length - 1] || pathValue || '(unknown path)';
}

function itemDirectorySummary(item: GitSeededWorkspaceChange): string {
  const count = Number(item.descendantFileCount ?? 0);
  return count === 1 ? '1 file' : `${count} files`;
}

function listItemActionLabel(item: GitSeededWorkspaceChange): string {
  if (isGitWorkspaceDirectoryEntry(item)) return 'Stage';
  return item.section === 'staged' ? 'Unstage' : '+ Stage';
}

function isDiscardableWorkspaceItem(item: GitSeededWorkspaceChange | null | undefined): boolean {
  if (isGitWorkspaceDirectoryEntry(item)) return true;
  return item?.section === 'unstaged' || item?.section === 'untracked';
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
  onOpenDirectory?: (directoryPath: string) => void;
  onAction?: (item: GitSeededWorkspaceChange) => void;
  onDiscard?: (item: GitSeededWorkspaceChange) => void;
  onLoadMore?: () => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | 'discard' | '';
  sectionActionKey?: string;
}

function WorkspaceTable(props: WorkspaceTableProps) {
  const summaryUnit = () => props.section === 'changes' ? 'item' : 'file';
  return (
    <GitTableFrame class="flex h-full min-h-0 flex-col">
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
          tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[34rem] sm:min-w-[42rem] md:min-w-0`}
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
            const busyScope = () => props.busyWorkspaceKey === workspaceEntryKey(item) || props.busyWorkspaceKey === props.sectionActionKey;
            const busy = (name: 'stage' | 'unstage' | 'discard') => busyScope() && props.busyWorkspaceAction === name;
            const actionsDisabled = () => busyScope() && Boolean(props.busyWorkspaceAction);
            return (
              <tr
                aria-selected={active()}
                class={`${gitChangedFilesRowClass(active())} cursor-pointer`}
                onClick={() => {
                  if (isGitWorkspaceDirectoryEntry(item)) {
                    const directoryPath = workspaceDirectoryPath(item);
                    if (directoryPath) props.onOpenDirectory?.(directoryPath);
                    return;
                  }
                  props.onSelectItem?.(item);
                }}
              >
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <div class="min-w-0">
                    <button
                      type="button"
                      class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                      title={isGitWorkspaceDirectoryEntry(item) ? workspaceDirectoryPath(item) : changeSecondaryPath(item)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isGitWorkspaceDirectoryEntry(item)) {
                          const directoryPath = workspaceDirectoryPath(item);
                          if (directoryPath) props.onOpenDirectory?.(directoryPath);
                          return;
                        }
                        props.onOpenDiff?.(item);
                      }}
                    >
                      <Show
                        when={isGitWorkspaceDirectoryEntry(item)}
                        fallback={itemPath(item)}
                      >
                        <span class="inline-flex items-center gap-1.5">
                          <Folder class="size-3.5 shrink-0" />
                          <span class="truncate">{itemPrimaryLabel(item)}</span>
                        </span>
                      </Show>
                    </button>
                    <Show when={isGitWorkspaceDirectoryEntry(item)}>
                      <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={workspaceDirectoryPath(item)}>{workspaceDirectoryPath(item)}</div>
                    </Show>
                    <Show when={!isGitWorkspaceDirectoryEntry(item) && changeSecondaryPath(item) !== itemPath(item)}>
                      <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                    </Show>
                  </div>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <Show
                    when={isGitWorkspaceDirectoryEntry(item)}
                    fallback={<GitChangeStatusPill change={item.changeType} />}
                  >
                    <div class="flex flex-wrap items-center gap-1.5">
                      <GitMetaPill tone="neutral">Folder</GitMetaPill>
                      <Show when={item.containsUnstaged}>
                        <GitMetaPill tone="warning">Unstaged</GitMetaPill>
                      </Show>
                      <Show when={item.containsUntracked}>
                        <GitMetaPill tone="brand">Untracked</GitMetaPill>
                      </Show>
                    </div>
                  </Show>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <Show
                    when={isGitWorkspaceDirectoryEntry(item)}
                    fallback={<GitChangeMetrics additions={item.additions} deletions={item.deletions} />}
                  >
                    <div class="text-[11px] font-medium text-muted-foreground">{itemDirectorySummary(item)}</div>
                  </Show>
                </td>
                <td class={gitChangedFilesStickyCellClass(active())}>
                  <div class="flex items-center justify-end gap-3 whitespace-nowrap">
                    <GitChangedFilesActionButton
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onAction?.(item);
                      }}
                      busy={busy(action())}
                      disabled={actionsDisabled()}
                    >
                      {listItemActionLabel(item)}
                    </GitChangedFilesActionButton>
                    <Show when={isDiscardableWorkspaceItem(item)}>
                      <GitChangedFilesActionButton
                        class="text-destructive hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onDiscard?.(item);
                        }}
                        busy={busy('discard')}
                        disabled={actionsDisabled()}
                      >
                        Discard...
                      </GitChangedFilesActionButton>
                    </Show>
                  </div>
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
                <span class="font-semibold tabular-nums text-foreground/90">{props.totalCount}</span> {summaryUnit()}{props.totalCount === 1 ? '' : 's'}.
              </>
            )}
            onLoadMore={props.onLoadMore}
            hasMore={props.hasMore}
            loading={props.loadingMore}
            loadingStatus="Loading next page"
          />
        </Show>
      </Show>
    </GitTableFrame>
  );
}

const EMPTY_WORKSPACE_PAGE_STATE = createEmptyWorkspaceViewPageState();
type WorkspaceDiscardTarget =
  | { kind: 'item'; item: GitSeededWorkspaceChange }
  | { kind: 'section'; section: GitWorkspaceViewSection }
  | null;

export function GitChangesPanel(props: GitChangesPanelProps) {
  const [commitDialogOpen, setCommitDialogOpen] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitSeededWorkspaceChange | null>(null);
  const [discardTarget, setDiscardTarget] = createSignal<WorkspaceDiscardTarget>(null);

  const selectedSection = () => props.selectedSection ?? pickDefaultWorkspaceViewSection(props.workspace);
  const summary = () => props.workspace?.summary ?? props.repoSummary?.workspaceSummary ?? null;
  const pageStateFor = (section: GitWorkspaceViewSection) => props.workspacePages?.[section] ?? EMPTY_WORKSPACE_PAGE_STATE;
  const selectedPageState = () => pageStateFor(selectedSection());
  const stagedPageState = () => pageStateFor('staged');
  const visibleItems = () => {
    const fallbackItems = sectionItems(props.workspace, selectedSection());
    if (selectedSection() === 'changes') {
      return selectedPageState().initialized
        ? (selectedPageState().items as GitSeededWorkspaceChange[])
        : fallbackItems;
    }
    return selectedPageState().items.length > 0
      ? (selectedPageState().items as GitSeededWorkspaceChange[])
      : fallbackItems;
  };
  const stagedItems = () => (
    stagedPageState().items.length > 0
      ? (stagedPageState().items as GitSeededWorkspaceChange[])
      : sectionItems(props.workspace, 'staged')
  );
  const visibleItemCount = () => (
    selectedPageState().initialized
      ? selectedPageState().totalCount
      : workspaceViewSectionCount(summary(), selectedSection())
  );
  const visibleCount = () => (
    selectedSection() === 'changes' && selectedPageState().initialized
      ? Number(selectedPageState().scopeFileCount ?? selectedPageState().totalCount ?? 0)
      : visibleItemCount()
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
  const activeDirectoryPath = () => selectedSection() === 'changes' ? String(selectedPageState().directoryPath ?? '').trim() : '';
  const activeBreadcrumbs = () => selectedSection() === 'changes' ? selectedPageState().breadcrumbs ?? [] : [];
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
  const bulkActionLabel = () => (
    selectedSection() === 'changes' && activeDirectoryPath()
      ? 'Stage Folder'
      : workspaceViewBulkActionLabel(selectedSection())
  );
  const bulkAction = () => (selectedSection() === 'staged' ? 'unstage' : 'stage');
  const sectionActionKey = () => workspaceViewSectionActionKey(selectedSection(), activeDirectoryPath());
  const bulkActionBusy = () => props.busyWorkspaceKey === sectionActionKey() && props.busyWorkspaceAction === bulkAction();
  const discardActionBusy = () => props.busyWorkspaceKey === sectionActionKey() && props.busyWorkspaceAction === 'discard';
  const canDiscardAll = () => selectedSection() === 'changes' && Boolean(props.onDiscardAll);
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

  const discardTitle = () => {
    const target = discardTarget();
    if (target?.kind === 'section') {
      return activeDirectoryPath() ? 'Discard folder changes' : 'Discard pending changes';
    }
    if (target?.kind === 'item' && isGitWorkspaceDirectoryEntry(target.item)) {
      return 'Discard folder changes';
    }
    return 'Discard file changes';
  };
  const discardConfirmText = () => {
    const target = discardTarget();
    if (target?.kind === 'section') return activeDirectoryPath() ? 'Discard Folder' : 'Discard All';
    if (target?.kind === 'item' && isGitWorkspaceDirectoryEntry(target.item)) return 'Discard Folder';
    return 'Discard';
  };
  const discardDescription = () => {
    const target = discardTarget();
    if (!target) return '';
    if (target.kind === 'section') {
      if (activeDirectoryPath()) {
        return `Discard all ${visibleCount()} file${visibleCount() === 1 ? '' : 's'} inside "${activeDirectoryPath()}"? Tracked files will be restored to their last Git state, and untracked files will be deleted from the working tree.`;
      }
      return `Discard all ${visibleCount()} file${visibleCount() === 1 ? '' : 's'} in Changes? Tracked files will be restored to their last Git state, and untracked files will be deleted from the working tree.`;
    }
    if (isGitWorkspaceDirectoryEntry(target.item)) {
      return `Discard all ${itemDirectorySummary(target.item)} inside "${workspaceDirectoryPath(target.item)}"? Tracked files will be restored to their last Git state, and untracked files will be deleted from the working tree.`;
    }
    if (target.item.section === 'untracked') {
      return `Delete the untracked file "${itemPath(target.item)}" from the working tree? Git cannot restore untracked files after they are discarded.`;
    }
    return `Restore "${itemPath(target.item)}" to the last Git state and drop its unstaged edits? Any staged snapshot for this file will stay intact.`;
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
        <Show when={!visibleLoading()} fallback={<GitStatePane loading message="Loading workspace changes..." />}>
          <Show when={!visibleError()} fallback={<GitStatePane tone="error" message={visibleError()} />}>
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <GitPanelFrame class="shrink-0">
                <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <GitLabelBlock class="min-w-0 flex-1" label="Workspace" tone={selectedTone()}>
                    <div class="flex flex-wrap items-center gap-2">
                      <GitPrimaryTitle>{visibleSectionLabel()}</GitPrimaryTitle>
                      <GitMetaPill tone={selectedTone()}>{visibleCount()} file{visibleCount() === 1 ? '' : 's'}</GitMetaPill>
                      <Show when={stagedCount() > 0}>
                        <GitMetaPill tone="success">{stagedCount()} staged</GitMetaPill>
                      </Show>
                    </div>
                    <div class="max-w-full text-[11px] leading-relaxed text-muted-foreground sm:max-w-[34rem]">
                      {selectedSection() === 'staged'
                        ? 'Review the staged snapshot, then commit it from the dialog.'
                        : activeDirectoryPath()
                          ? `Review the current folder, then stage or discard this scope without leaving the Changes view.`
                          : 'Stage the files you want from this table, discard the rest when needed, then commit from the staged dialog.'}
                    </div>
                    <Show when={selectedSection() === 'changes' && activeBreadcrumbs().length > 0}>
                      <div class="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                        <For each={activeBreadcrumbs()}>
                          {(crumb, index) => (
                            <>
                              <Show when={index() > 0}>
                                <span aria-hidden="true">/</span>
                              </Show>
                              <button
                                type="button"
                                class="cursor-pointer rounded-sm px-1 py-0.5 text-left text-foreground/90 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                                disabled={!props.onNavigateDirectory}
                                onClick={() => props.onNavigateDirectory?.(String(crumb.path ?? '').trim())}
                              >
                                {String(crumb.label ?? '').trim() || 'Folder'}
                              </button>
                            </>
                          )}
                        </For>
                      </div>
                    </Show>
                  </GitLabelBlock>
                  <div class="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:w-auto lg:flex-col lg:items-end lg:justify-start">
                    <Show when={props.onAskFlower || props.onOpenInTerminal || props.onBrowseFiles}>
                      <GitShortcutOrbDock class="w-full justify-start sm:w-auto sm:justify-end">
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

                    <div class="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                      <Show when={props.onOpenStash}>
                        <Button
                          size="sm"
                          variant="outline"
                          class={`w-full rounded-md sm:w-auto ${redevenSurfaceRoleClass('control')}`}
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
                      <Show when={canDiscardAll()}>
                        <Button
                          size="sm"
                          variant="outline"
                          class={`w-full rounded-md text-destructive hover:text-destructive sm:w-auto ${redevenSurfaceRoleClass('control')}`}
                          onClick={() => setDiscardTarget({ kind: 'section', section: selectedSection() })}
                          disabled={visibleCount() === 0 || bulkActionBusy() || discardActionBusy()}
                          loading={discardActionBusy()}
                        >
                          {activeDirectoryPath() ? 'Discard Folder...' : 'Discard All...'}
                        </Button>
                      </Show>
                      <Button
                        size="sm"
                        variant="outline"
                        class={`w-full rounded-md sm:w-auto ${redevenSurfaceRoleClass('control')}`}
                        onClick={() => props.onBulkAction?.(selectedSection())}
                        disabled={visibleCount() === 0 || bulkActionBusy() || discardActionBusy()}
                        loading={bulkActionBusy()}
                      >
                        {bulkActionLabel()}
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        class="w-full rounded-md sm:w-auto"
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
              </GitPanelFrame>

              <div class="min-h-0 flex-1">
                <WorkspaceTable
                  section={selectedSection()}
                  items={visibleItems()}
                  totalCount={visibleItemCount()}
                  hasMore={selectedPageState().hasMore}
                  loadingMore={visibleLoadingMore()}
                  selectedKey={selectedKey()}
                  onSelectItem={props.onSelectItem}
                  onOpenDiff={(item) => {
                    setDiffDialogItem(item);
                    props.onSelectItem?.(item);
                    setDiffDialogOpen(true);
                  }}
                  onOpenDirectory={(directoryPath) => props.onNavigateDirectory?.(directoryPath)}
                  onAction={(item) => {
                    if (item.section === 'staged') props.onUnstageSelected?.(item);
                    else props.onStageSelected?.(item);
                  }}
                  onDiscard={(item) => setDiscardTarget({ kind: 'item', item })}
                  onLoadMore={() => props.onLoadMoreWorkspaceSection?.(selectedSection())}
                  busyWorkspaceKey={props.busyWorkspaceKey}
                  busyWorkspaceAction={props.busyWorkspaceAction}
                  sectionActionKey={sectionActionKey()}
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

      <ConfirmDialog
        open={Boolean(discardTarget())}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
        title={discardTitle()}
        confirmText={discardConfirmText()}
        variant="destructive"
        onConfirm={() => {
          const target = discardTarget();
          if (!target) return;
          if (target.kind === 'section') props.onDiscardAll?.(target.section);
          else props.onDiscardSelected?.(target.item);
          setDiscardTarget(null);
        }}
      >
        <div class="text-sm leading-relaxed text-foreground">{discardDescription()}</div>
      </ConfirmDialog>
    </div>
  );
}
