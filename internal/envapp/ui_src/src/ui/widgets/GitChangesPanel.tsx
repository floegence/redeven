import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Folder, MoreHorizontal, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
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
import { GitChangesBreadcrumb } from './GitChangesBreadcrumb';
import {
  buildGitChangesHeaderPresentation,
  resolveGitChangesHeaderDensity,
  type GitChangesBreadcrumbSegment,
  type GitChangesHeaderActionId,
} from './gitChangesHeaderLayout';

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
  const [headerElement, setHeaderElement] = createSignal<HTMLDivElement>();
  const [headerWidth, setHeaderWidth] = createSignal(0);

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
  const headerDensity = createMemo(() => resolveGitChangesHeaderDensity(headerWidth()));
  const headerPresentation = createMemo(() => buildGitChangesHeaderPresentation({
    density: headerDensity(),
    selectedSection: selectedSection(),
    visibleCount: visibleCount(),
    stagedCount: stagedCount(),
    activeDirectoryPath: activeDirectoryPath(),
    canBulkAction: Boolean(props.onBulkAction) && visibleCount() > 0,
    canDiscardAll: canDiscardAll() && visibleCount() > 0,
    canOpenStash: canOpenStash(),
    canOpenInTerminal: canOpenInTerminal(),
    canBrowseFiles: canBrowseFiles(),
    canAskFlower: canAskFlower(),
  }));
  const headerTone = () => headerPresentation().isCleanState ? 'success' : selectedTone();
  const breadcrumbSegments = createMemo<GitChangesBreadcrumbSegment[]>(() => activeBreadcrumbs().map((crumb) => ({
    label: String(crumb.label ?? '').trim() || 'Folder',
    path: String(crumb.path ?? '').trim(),
  })));
  const headerPrimaryActions = () => headerPresentation().primaryActionIds;
  const headerUtilityActions = () => headerPresentation().utilityActionIds;
  const overflowItems = createMemo<DropdownItem[]>(() => headerPresentation().overflowActionIds.map((actionId) => ({
    id: actionId,
    label: actionId === 'discard'
      ? (activeDirectoryPath() ? 'Discard folder changes' : 'Discard all changes')
      : actionId === 'terminal'
        ? 'Open in Terminal'
        : actionId === 'files'
          ? 'Browse Files'
          : 'Ask Flower',
  })));
  const showActionRow = () => headerPrimaryActions().length > 0 || headerUtilityActions().length > 0 || overflowItems().length > 0;
  const showBreadcrumbRail = () => (
    selectedSection() === 'changes'
    && Boolean(activeDirectoryPath())
    && breadcrumbSegments().length > 0
  );
  const useInlineQuietHeaderActions = () => (
    headerDensity() === 'comfortable'
    && headerPresentation().layoutMode === 'quiet_inline'
  );
  const showSeparateActionRow = () => showActionRow() && !useInlineQuietHeaderActions();
  const headerContainerClass = () => (
    useInlineQuietHeaderActions()
      ? 'flex flex-col gap-1.5'
      : 'flex flex-col gap-2.5'
  );
  const headerTopRowClass = () => (
    useInlineQuietHeaderActions()
      ? 'grid gap-2 grid-cols-[minmax(0,1fr)_auto] items-start'
      : headerDensity() === 'comfortable'
      ? 'grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start'
      : 'grid gap-2.5 grid-cols-1'
  );
  const headerActionRowClass = () => {
    if (headerDensity() === 'comfortable') return 'flex flex-wrap items-center justify-end gap-2';
    return 'grid gap-2 grid-cols-[minmax(0,1fr)_auto] items-start';
  };
  const headerPrimaryActionRailClass = () => (
    headerDensity() === 'collapsed'
      ? 'flex min-w-0 flex-wrap items-center gap-1.5'
      : 'flex min-w-0 flex-wrap items-center gap-2'
  );
  const headerSecondaryActionRailClass = () => (
    headerDensity() === 'collapsed'
      ? 'flex items-center justify-end gap-1.5'
      : 'flex min-w-0 items-center justify-end gap-1.5'
  );

  createEffect(() => {
    const element = headerElement();
    if (!element) {
      setHeaderWidth(0);
      return;
    }

    const syncHeaderWidth = () => {
      setHeaderWidth(element.offsetWidth ?? 0);
    };

    syncHeaderWidth();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      syncHeaderWidth();
    });
    observer.observe(element);

    onCleanup(() => observer.disconnect());
  });

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

  const runHeaderAction = (actionId: GitChangesHeaderActionId) => {
    switch (actionId) {
      case 'commit':
        props.onOpenCommitDialog?.();
        setCommitDialogOpen(true);
        return;
      case 'bulk':
        props.onBulkAction?.(selectedSection());
        return;
      case 'stash': {
        const repoRoot = repoRootPath();
        if (!repoRoot) return;
        props.onOpenStash?.({
          tab: 'save',
          repoRootPath: repoRoot,
          source: 'changes',
        });
        return;
      }
      case 'discard':
        setDiscardTarget({ kind: 'section', section: selectedSection() });
        return;
      case 'terminal': {
        const request = repoShortcutRequest();
        if (!request) return;
        props.onOpenInTerminal?.(request);
        return;
      }
      case 'files': {
        const request = repoShortcutRequest();
        if (!request) return;
        void props.onBrowseFiles?.(request);
        return;
      }
      case 'flower':
        props.onAskFlower?.({
          kind: 'workspace_section',
          repoRootPath: repoRootPath(),
          headRef: props.repoSummary?.headRef,
          section: selectedSection(),
          items: visibleItems(),
        });
        return;
    }
  };

  const renderUtilityAction = (actionId: GitChangesHeaderActionId) => (
    <Show when={actionId === 'flower' || actionId === 'terminal' || actionId === 'files'}>
      <GitShortcutOrbButton
        label={actionId === 'flower' ? 'Ask Flower' : actionId === 'terminal' ? 'Terminal' : 'Files'}
        tone={actionId === 'flower' ? 'flower' : actionId === 'terminal' ? 'terminal' : 'files'}
        icon={actionId === 'flower' ? FlowerIcon : actionId === 'terminal' ? Terminal : Folder}
        onClick={() => runHeaderAction(actionId)}
      />
    </Show>
  );

  const primaryActionVariant = (actionId: GitChangesHeaderActionId) => actionId === 'commit' ? 'default' : 'outline';
  const primaryActionClass = (actionId: GitChangesHeaderActionId) => {
    if (actionId === 'discard') {
      return `rounded-md text-destructive hover:text-destructive ${redevenSurfaceRoleClass('control')}`;
    }
    return actionId === 'commit'
      ? 'rounded-md'
      : `rounded-md ${redevenSurfaceRoleClass('control')}`;
  };
  const primaryActionLabel = (actionId: GitChangesHeaderActionId) => {
    switch (actionId) {
      case 'commit':
        return 'Commit...';
      case 'bulk':
        return bulkActionLabel();
      case 'stash':
        return 'Stash...';
      case 'discard':
        return activeDirectoryPath() ? 'Discard Folder...' : 'Discard All...';
      default:
        return '';
    }
  };
  const primaryActionDisabled = (actionId: GitChangesHeaderActionId) => {
    switch (actionId) {
      case 'bulk':
        return visibleCount() === 0 || bulkActionBusy() || discardActionBusy();
      case 'discard':
        return visibleCount() === 0 || bulkActionBusy() || discardActionBusy();
      case 'commit':
        return stagedCount() === 0;
      default:
        return false;
    }
  };
  const primaryActionLoading = (actionId: GitChangesHeaderActionId) => {
    switch (actionId) {
      case 'bulk':
        return bulkActionBusy();
      case 'discard':
        return discardActionBusy();
      default:
        return false;
    }
  };
  const renderPrimaryAction = (actionId: GitChangesHeaderActionId) => (
    <Button
      size="sm"
      variant={primaryActionVariant(actionId)}
      class={primaryActionClass(actionId)}
      onClick={() => runHeaderAction(actionId)}
      disabled={primaryActionDisabled(actionId)}
      loading={primaryActionLoading(actionId)}
    >
      {primaryActionLabel(actionId)}
    </Button>
  );
  const renderOverflowAction = () => (
    <Show when={overflowItems().length > 0}>
      <Dropdown
        trigger={(
          <Button
            size="sm"
            variant="outline"
            class={`rounded-md ${redevenSurfaceRoleClass('control')}`}
            aria-label="More actions"
            title="More actions"
          >
            <MoreHorizontal class="size-3.5" />
          </Button>
        )}
        items={overflowItems()}
        onSelect={(itemId) => runHeaderAction(itemId as GitChangesHeaderActionId)}
        align="end"
      />
    </Show>
  );
  const renderInlineHeaderActions = () => (
    <div
      data-git-changes-header-actions="inline"
      class="flex flex-wrap items-center justify-end gap-2"
    >
      <Show when={headerUtilityActions().length > 0}>
        <GitShortcutOrbDock class="justify-end">
          <For each={headerUtilityActions()}>
            {(actionId) => renderUtilityAction(actionId)}
          </For>
        </GitShortcutOrbDock>
      </Show>
      <For each={headerPrimaryActions()}>
        {(actionId) => renderPrimaryAction(actionId)}
      </For>
      {renderOverflowAction()}
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex flex-1 min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
        <Show when={!visibleLoading()} fallback={<GitStatePane loading message="Loading workspace changes..." />}>
          <Show when={!visibleError()} fallback={<GitStatePane tone="error" message={visibleError()} />}>
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <GitPanelFrame class="shrink-0">
                <div
                  ref={setHeaderElement}
                  data-git-changes-header-density={headerPresentation().density}
                  class={headerContainerClass()}
                >
                  <div class={headerTopRowClass()}>
                    <GitLabelBlock class="min-w-0" label="Workspace" tone={headerTone()}>
                      <div class="flex flex-wrap items-center gap-2">
                        <GitPrimaryTitle>{headerPresentation().title}</GitPrimaryTitle>
                        <GitMetaPill tone={headerPresentation().isCleanState ? 'success' : headerTone()}>
                          {headerPresentation().countBadgeLabel}
                        </GitMetaPill>
                        <Show when={stagedCount() > 0}>
                          <GitMetaPill tone="success">{headerPresentation().stagedBadgeLabel}</GitMetaPill>
                        </Show>
                      </div>
                      <Show when={headerPresentation().showSummaryCopy}>
                        <div class="max-w-full text-[11px] leading-relaxed text-muted-foreground line-clamp-2 sm:max-w-[32rem]">
                          {headerPresentation().summaryCopy}
                        </div>
                      </Show>
                    </GitLabelBlock>

                    <Show when={useInlineQuietHeaderActions()} fallback={(
                      <Show when={headerPresentation().density === 'comfortable' && headerUtilityActions().length > 0}>
                        <GitShortcutOrbDock class="justify-end">
                          <For each={headerUtilityActions()}>
                            {(actionId) => renderUtilityAction(actionId)}
                          </For>
                        </GitShortcutOrbDock>
                      </Show>
                    )}>
                      {renderInlineHeaderActions()}
                    </Show>
                  </div>

                  <Show when={showSeparateActionRow()}>
                    <div
                      data-git-changes-header-actions="separate"
                      class={headerActionRowClass()}
                    >
                      <div class={headerPrimaryActionRailClass()}>
                        <For each={headerPrimaryActions()}>
                          {(actionId) => renderPrimaryAction(actionId)}
                        </For>
                      </div>

                      <div class={headerSecondaryActionRailClass()}>
                        <Show when={headerPresentation().density !== 'comfortable' && headerUtilityActions().length > 0}>
                          <GitShortcutOrbDock class="justify-end">
                            <For each={headerUtilityActions()}>
                              {(actionId) => renderUtilityAction(actionId)}
                            </For>
                          </GitShortcutOrbDock>
                        </Show>
                        {renderOverflowAction()}
                      </div>
                    </div>
                  </Show>

                  <Show when={showBreadcrumbRail()}>
                    <GitChangesBreadcrumb
                      segments={breadcrumbSegments()}
                      onSelect={props.onNavigateDirectory ? (segment) => props.onNavigateDirectory?.(segment.path) : undefined}
                      class="pt-0.5"
                    />
                  </Show>
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
