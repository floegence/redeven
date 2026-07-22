import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { AlertTriangle, CheckCircle, Copy, Eye, FileText, Folder, Minus, MoreHorizontal, Package, Plus, Search, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog, Dropdown, SegmentedControl, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { FlowerIcon } from '../icons/FlowerIcon';
import type { GitRepoSummaryResponse } from '../protocol/redeven_v1';
import {
  createEmptyWorkspaceViewPageState,
  changeSecondaryPath,
  isGitWorkspaceDirectoryEntry,
  pickDefaultWorkspaceViewSection,
  type GitSeededWorkspaceChange,
  type GitSeededWorkspaceChangesResponse,
  type GitWorkspaceViewPageState,
  workspaceDirectoryPath,
  workspaceEntryKey,
  workspaceViewSectionCount,
  workspaceViewSectionActionKey,
  workspaceViewSectionItems,
  type GitStashWindowRequest,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import { gitChangePathClass } from './GitChrome';
import { GitCommitDialog } from './GitCommitDialog';
import { GitDiffDialog } from './GitDiffDialog';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitInlineLoadingStatus,
  GitMetaPill,
  GitPagedTableFooter,
  GitShortcutOrbButton,
  GitShortcutOrbDock,
  GitStatePane,
  GitTableFrame,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import {
  buildGitDirectoryShortcutRequest,
  buildGitFileShortcutTarget,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
  type GitFileShortcutTarget,
} from '../utils/gitBrowserShortcuts';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitVirtualTable } from './GitVirtualTable';
import { GitChangesBreadcrumb } from './GitChangesBreadcrumb';
import {
  buildGitChangesHeaderPresentation,
  resolveGitChangesHeaderDensity,
  type GitChangesBreadcrumbSegment,
  type GitChangesHeaderActionId,
} from './gitChangesHeaderLayout';
import { useI18n, type I18nHelpers } from '../i18n';
import { extNoDot } from './FileBrowserShared';
import {
  GitEntityContextMenu,
  createGitEntityContextMenuController,
  type GitContextMenuActionItem,
} from './GitEntityContextMenu';

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
  onDiscardAll?: (
    section: GitWorkspaceViewSection,
    scope?: { directoryPath?: string; count?: number },
  ) => void;
  onLoadMoreWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenCommitDialog?: () => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'workspace_section' | 'workspace_item' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onPreviewCurrentFile?: (target: GitFileShortcutTarget) => void;
  onCopyText?: (value: string) => void;
}

function workspaceChangeFileName(item: GitSeededWorkspaceChange): string {
  const pathValue = isGitWorkspaceDirectoryEntry(item)
    ? workspaceDirectoryPath(item)
    : itemPath(item);
  const parts = pathValue.split('/').filter(Boolean);
  return parts[parts.length - 1] || pathValue || '(unknown path)';
}

function buildFileItemForIcon(item: GitSeededWorkspaceChange): { name: string; type: 'file' | 'folder'; extension?: string } {
  const name = workspaceChangeFileName(item);
  return {
    name,
    type: isGitWorkspaceDirectoryEntry(item) ? 'folder' : 'file',
    extension: isGitWorkspaceDirectoryEntry(item) ? undefined : extNoDot(name),
  };
}

function itemPath(item: GitSeededWorkspaceChange): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function itemDirectorySummary(item: GitSeededWorkspaceChange, i18n: I18nHelpers): string {
  const count = Number(item.descendantFileCount ?? 0);
  return i18n.tn('git.common.fileCount', count);
}

function isDiscardableWorkspaceItem(item: GitSeededWorkspaceChange | null | undefined): boolean {
  if (isGitWorkspaceDirectoryEntry(item)) return true;
  return item?.section === 'unstaged' || item?.section === 'untracked';
}

function sectionItems(workspace: GitSeededWorkspaceChangesResponse | null | undefined, section: GitWorkspaceViewSection): GitSeededWorkspaceChange[] {
  return workspaceViewSectionItems(workspace, section) as GitSeededWorkspaceChange[];
}

function emptySectionMessage(section: GitWorkspaceViewSection, i18n: I18nHelpers): string {
  switch (section) {
    case 'staged':
      return i18n.t('git.changes.noStagedFiles');
    case 'changes':
      return i18n.t('git.changes.noPendingFiles');
    case 'conflicted':
      return i18n.t('git.changes.noConflictedFiles');
    default:
      return i18n.t('git.changes.noFilesInSection');
  }
}

function emptySectionIcon(section: GitWorkspaceViewSection) {
  switch (section) {
    case 'conflicted':
      return AlertTriangle;
    case 'staged':
      return CheckCircle;
    case 'changes':
    default:
      return FileText;
  }
}

function GitChangesEmptyState(props: { section: GitWorkspaceViewSection; message: string }) {
  const Icon = emptySectionIcon(props.section);
  return (
    <div class="git-changes-empty-state" data-git-changes-empty-section={props.section}>
      <div class="git-changes-empty-state__mark" aria-hidden="true">
        <Icon class="git-changes-empty-state__icon" />
      </div>
      <div class="git-changes-empty-state__title">{props.message}</div>
    </div>
  );
}

interface WorkspaceTableProps {
  section: GitWorkspaceViewSection;
  items: GitSeededWorkspaceChange[];
  totalCount: number;
  loadingState?: 'idle' | 'initial' | 'refreshing';
  expectedCount?: number;
  loadingLabel?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  selectedKey?: string;
  filtered?: boolean;
  filteredCount?: number;
  onSelectItem?: (item: GitSeededWorkspaceChange) => void;
  onOpenDiff?: (item: GitSeededWorkspaceChange) => void;
  onOpenDirectory?: (directoryPath: string) => void;
  onAction?: (item: GitSeededWorkspaceChange) => void;
  onDiscard?: (item: GitSeededWorkspaceChange) => void;
  onOpenContextMenu?: (event: MouseEvent, item: GitSeededWorkspaceChange) => void;
  onOpenContextMenuFromKeyboard?: (event: KeyboardEvent, item: GitSeededWorkspaceChange) => void;
  onLoadMore?: () => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | 'discard' | '';
  sectionActionKey?: string;
}

function WorkspaceTable(props: WorkspaceTableProps) {
  const i18n = useI18n();
  const summaryUnit = () => props.section === 'changes' ? i18n.tn('git.common.itemCount', props.totalCount) : i18n.tn('git.common.fileCount', props.totalCount);
  const loadingState = () => props.loadingState ?? 'idle';
  const initialLoading = () => loadingState() === 'initial';
  const refreshing = () => loadingState() === 'refreshing';
  const loadingLabel = () => props.loadingLabel ?? i18n.t('git.changes.loadingWorkspaceChanges');
  const skeletonRows = () => Array.from({ length: Math.max(3, Math.min(8, Number(props.expectedCount ?? props.totalCount ?? 0) || 3)) });
  return (
    <GitTableFrame class="flex h-full min-h-0 flex-col rounded-none border-0">
      <Show
        when={!initialLoading()}
        fallback={(
          <div
            class="git-changes-table-pending"
            role="status"
            aria-live="polite"
            aria-busy="true"
            data-git-changes-table-state="initial-loading"
          >
            <div class="git-changes-table-status-slot">
              <GitInlineLoadingStatus>{loadingLabel()}</GitInlineLoadingStatus>
            </div>
            <div class="git-changes-table-skeleton" aria-hidden="true">
              <For each={skeletonRows()}>
                {(_, index) => (
                  <div class="git-changes-table-skeleton__row">
                    <span class="git-changes-table-skeleton__path" data-skeleton-index={index()} />
                    <span class="git-changes-table-skeleton__pill" />
                    <span class="git-changes-table-skeleton__metrics" />
                    <span class="git-changes-table-skeleton__actions" />
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      >
      <Show
        when={props.items.length > 0}
        fallback={(
          <div class="git-changes-table-empty">
            <div class="git-changes-table-status-slot" data-visible={refreshing() ? 'true' : 'false'}>
              <Show when={refreshing()}>
                <GitInlineLoadingStatus>{loadingLabel()}</GitInlineLoadingStatus>
              </Show>
            </div>
            <GitChangesEmptyState
              section={props.section}
              message={emptySectionMessage(props.section, i18n)}
            />
          </div>
        )}
      >
        <GitVirtualTable
          items={props.items}
          tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[34rem] sm:min-w-[42rem] md:min-w-0`}
          header={(
            <tr class="hidden">
              <th>{i18n.t('git.common.path')}</th>
              <th>{i18n.t('git.common.status')}</th>
              <th>{i18n.t('git.common.changes')}</th>
              <th>{i18n.t('settings.table.actions')}</th>
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
                tabIndex={0}
                data-git-changes-context-target="item"
                onClick={() => {
                  if (isGitWorkspaceDirectoryEntry(item)) {
                    const directoryPath = workspaceDirectoryPath(item);
                    if (directoryPath) props.onOpenDirectory?.(directoryPath);
                    return;
                  }
                  props.onSelectItem?.(item);
                }}
                on:contextmenu={(event) => {
                  event.stopPropagation();
                  props.onOpenContextMenu?.(event, item);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                  event.stopPropagation();
                  props.onOpenContextMenuFromKeyboard?.(event, item);
                }}
              >
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <div class="min-w-0">
                    <button
                      type="button"
                      class={`inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
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
                      <FileItemIcon item={buildFileItemForIcon(item)} class="h-3.5 w-3.5 shrink-0" />
                      <span class="truncate">{workspaceChangeFileName(item)}</span>
                      <Show when={!isGitWorkspaceDirectoryEntry(item) && changeSecondaryPath(item) !== workspaceChangeFileName(item)}>
                        <span class="sr-only">{changeSecondaryPath(item)}</span>
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
                      <GitMetaPill tone="neutral">{i18n.t('git.common.folder')}</GitMetaPill>
                      <Show when={item.containsUnstaged}>
                        <GitMetaPill tone="warning">{i18n.t('git.common.unstaged')}</GitMetaPill>
                      </Show>
                      <Show when={item.containsUntracked}>
                        <GitMetaPill tone="brand">{i18n.t('git.common.untracked')}</GitMetaPill>
                      </Show>
                    </div>
                  </Show>
                </td>
                <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                  <Show
                    when={isGitWorkspaceDirectoryEntry(item)}
                    fallback={<GitChangeMetrics additions={item.additions} deletions={item.deletions} />}
                  >
                    <div class="text-[11px] font-medium text-muted-foreground">{itemDirectorySummary(item, i18n)}</div>
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
                      <Plus class="size-3.5" />
                      <span class="sr-only">{action() === 'unstage' ? i18n.t('git.changes.unstage') : i18n.t('git.changes.stageWithPlus')}</span>
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
                        <Trash class="size-3.5" />
                        <span class="sr-only">{i18n.t('git.changes.discard')}</span>
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
                {i18n.t('git.changes.showingOf', { visible: props.items.length, total: props.totalCount, unit: summaryUnit() })}
              </>
            )}
            onLoadMore={props.onLoadMore}
            hasMore={props.hasMore}
            loading={props.loadingMore}
            loadingStatus={i18n.t('git.changes.loadingNextPage')}
          />
        </Show>
        <Show when={refreshing() && props.items.length > 0 && !props.loadingMore}>
          <div class={`git-changes-table-refresh-row border-t px-2.5 py-1 ${redevenDividerRoleClass()} ${redevenSurfaceRoleClass('inset')}`}>
            <GitInlineLoadingStatus>{loadingLabel()}</GitInlineLoadingStatus>
          </div>
        </Show>
        <Show when={props.items.length > 0}>
          <div class={`flex flex-wrap items-center justify-between gap-2 border-t px-2.5 py-1 text-[10px] text-muted-foreground ${redevenDividerRoleClass()} ${redevenSurfaceRoleClass('inset')}`}>
            <div class="flex flex-wrap items-center gap-1.5">
              <span>{i18n.tn('git.common.fileCount', props.totalCount)}</span>
              <Show when={props.filtered}>
                <span aria-hidden="true">·</span>
                <span>{i18n.t('git.changes.filterActive')}</span>
                <span aria-hidden="true">·</span>
                <span>{i18n.t('git.changes.showingFiltered', { visible: props.filteredCount ?? props.items.length, total: props.totalCount })}</span>
              </Show>
            </div>
            <div class="max-w-full truncate text-right sm:max-w-[45%]">
              {props.section === 'changes' ? i18n.t('git.common.changes') : props.section === 'staged' ? i18n.t('git.common.staged') : i18n.t('git.common.conflicted')}
            </div>
          </div>
        </Show>
      </Show>
      </Show>
    </GitTableFrame>
  );
}

const EMPTY_WORKSPACE_PAGE_STATE = createEmptyWorkspaceViewPageState();
type WorkspaceDiscardTarget =
  | { kind: 'item'; item: GitSeededWorkspaceChange }
  | {
      kind: 'section';
      section: GitWorkspaceViewSection;
      directoryPath: string;
      count: number;
    }
  | null;

type GitChangesContextMenuTarget =
  | Readonly<{
      kind: 'section';
      repoRootPath: string;
      effectiveRootPath: string;
      headRef?: string;
      section: GitWorkspaceViewSection;
      directoryPath: string;
      count: number;
      items: GitSeededWorkspaceChange[];
    }>
  | Readonly<{
      kind: 'item';
      repoRootPath: string;
      effectiveRootPath: string;
      headRef?: string;
      section: GitWorkspaceViewSection;
      directoryPath: string;
      item: GitSeededWorkspaceChange;
    }>;

function parentGitPath(relativePath: string): string {
  const normalized = String(relativePath ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex < 0 ? '' : normalized.slice(0, separatorIndex);
}

export function GitChangesPanel(props: GitChangesPanelProps) {
  const i18n = useI18n();
  const [commitDialogOpen, setCommitDialogOpen] = createSignal(false);
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitSeededWorkspaceChange | null>(null);
  const [discardTarget, setDiscardTarget] = createSignal<WorkspaceDiscardTarget>(null);
  const [headerElement, setHeaderElement] = createSignal<HTMLDivElement>();
  const [headerWidth, setHeaderWidth] = createSignal(0);
  const [filterQuery, setFilterQuery] = createSignal('');
  const contextMenu = createGitEntityContextMenuController<GitChangesContextMenuTarget>();

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
  const filteredItems = createMemo(() => {
    const query = filterQuery().toLowerCase().trim();
    if (!query) return visibleItems();
    return visibleItems().filter((item) => {
      const pathValue = itemPath(item).toLowerCase();
      return pathValue.includes(query);
    });
  });
  const filterActive = () => filterQuery().trim().length > 0;
  const filteredCount = () => filteredItems().length;

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
  const selectedLoadingMode = () => {
    const state = selectedPageState();
    if (!state.loading) return 'idle';
    if (state.loadingMode) return state.loadingMode;
    if (!state.initialized) return 'initial';
    return state.hasMore ? 'append' : 'refresh';
  };
  const tableLoadingState = () => {
    const state = selectedPageState();
    if (props.loading || (state.loading && !state.initialized)) return 'initial';
    if (state.loading && state.initialized && selectedLoadingMode() !== 'append') return 'refreshing';
    return 'idle';
  };
  const tableLoadingLabel = () => (
    tableLoadingState() === 'refreshing'
      ? i18n.t('files.refreshing')
      : i18n.t('git.changes.loadingWorkspaceChanges')
  );
  const filterDisabled = () => tableLoadingState() === 'initial';
  const visibleError = () => String(props.error ?? '').trim() || (!selectedPageState().initialized ? selectedPageState().error : '');
  const visibleLoadingMore = () => Boolean(selectedPageState().loading && selectedPageState().initialized && selectedLoadingMode() === 'append');
  const stagedLoadingItems = () => Boolean(stagedPageState().loading && !props.commitBusy);
  const activeDirectoryPath = () => selectedSection() === 'changes' ? String(selectedPageState().directoryPath ?? '').trim() : '';
  const activeBreadcrumbs = () => selectedSection() === 'changes' ? selectedPageState().breadcrumbs ?? [] : [];
  const repoRootPath = () => String(props.workspace?.repoRootPath ?? props.repoSummary?.repoRootPath ?? '').trim();
  const effectiveRootPath = () => String(props.repoSummary?.worktreePath ?? repoRootPath()).trim();
  const repoShortcutRequest = (directoryPath = activeDirectoryPath()): GitDirectoryShortcutRequest | null => (
    buildGitDirectoryShortcutRequest({
      rootPath: effectiveRootPath(),
      directoryPath,
    })
  );
  const diffItem = () => diffDialogItem() ?? props.selectedItem ?? null;
  const selectedKey = () => workspaceEntryKey(diffItem());
  const canCommit = () => stagedCount() > 0 && String(props.commitMessage ?? '').trim().length > 0 && !props.commitBusy;
  const bulkActionLabel = () => (
    selectedSection() === 'changes' && activeDirectoryPath()
      ? i18n.t('git.changes.stageFolder')
      : selectedSection() === 'staged'
        ? i18n.t('git.changes.unstageAll')
        : selectedSection() === 'conflicted'
          ? i18n.t('git.changes.stageAll')
          : i18n.t('git.changes.stageAll')
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
  const countBadgeLabel = () => (
    headerPresentation().isCleanState
      ? i18n.t('git.changes.noPendingChanges')
      : i18n.tn('git.common.fileCount', visibleCount())
  );
  const stagedBadgeLabel = () => i18n.t('git.changes.stagedCount', { count: stagedCount() });
  const summaryCopy = () => {
    if (headerPresentation().isCleanState) return '';
    if (selectedSection() === 'staged') return i18n.t('git.changes.reviewStagedSnapshot');
    if (selectedSection() === 'changes' && visibleCount() === 0 && stagedCount() > 0) return i18n.t('git.changes.pendingClearCommitReady');
    if (selectedSection() === 'changes' && activeDirectoryPath()) return i18n.t('git.changes.reviewScopeThenStage');
    return i18n.t('git.changes.stageThenCommit');
  };
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
  const breadcrumbSegments = createMemo<GitChangesBreadcrumbSegment[]>(() => activeBreadcrumbs().map((crumb) => ({
    label: String(crumb.label ?? '').trim() || i18n.t('git.common.folder'),
    path: String(crumb.path ?? '').trim(),
  })));
  const headerPrimaryActions = () => headerPresentation().primaryActionIds;
  const headerUtilityActions = () => headerPresentation().utilityActionIds;
  const overflowItems = createMemo<DropdownItem[]>(() => headerPresentation().overflowActionIds.map((actionId) => ({
    id: actionId,
    label: actionId === 'discard'
      ? (activeDirectoryPath() ? i18n.t('git.changes.discardFolderChanges') : i18n.t('git.changes.discardAllChanges'))
      : actionId === 'terminal'
        ? i18n.t('git.changes.openInTerminal')
        : actionId === 'files'
          ? i18n.t('git.changes.browseFiles')
          : i18n.t('git.changes.askFlower'),
  })));
  const showActionRow = () => headerPrimaryActions().length > 0 || headerUtilityActions().length > 0 || overflowItems().length > 0;
  const showBreadcrumbRail = () => (
    selectedSection() === 'changes'
    && Boolean(activeDirectoryPath())
    && breadcrumbSegments().length > 0
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
      return target.directoryPath ? i18n.t('git.changes.discardFolderChanges') : i18n.t('git.changes.discardPendingTitle');
    }
    if (target?.kind === 'item' && isGitWorkspaceDirectoryEntry(target.item)) {
      return i18n.t('git.changes.discardFolderChanges');
    }
    return i18n.t('git.changes.discardFileTitle');
  };
  const discardConfirmText = () => {
    const target = discardTarget();
    if (target?.kind === 'section') return target.directoryPath ? i18n.t('git.changes.discardFolderConfirm') : i18n.t('git.changes.discardAllConfirm');
    if (target?.kind === 'item' && isGitWorkspaceDirectoryEntry(target.item)) return i18n.t('git.changes.discardFolderConfirm');
    return i18n.t('git.changes.discardConfirm');
  };
  const discardDescription = () => {
    const target = discardTarget();
    if (!target) return '';
    if (target.kind === 'section') {
      if (target.directoryPath) {
        return i18n.t('git.changes.discardDirectoryDescription', {
          count: target.count,
          unit: i18n.tn('git.common.fileCount', target.count),
          path: target.directoryPath,
        });
      }
      return i18n.t('git.changes.discardAllDescription', {
        count: target.count,
        unit: i18n.tn('git.common.fileCount', target.count),
      });
    }
    if (isGitWorkspaceDirectoryEntry(target.item)) {
      const count = Number(target.item.descendantFileCount ?? 0) || 1;
      return i18n.t('git.changes.discardDirectoryDescription', {
        count,
        unit: itemDirectorySummary(target.item, i18n),
        path: workspaceDirectoryPath(target.item),
      });
    }
    if (target.item.section === 'untracked') {
      return i18n.t('git.changes.discardUntrackedFileDescription', { path: itemPath(target.item) });
    }
    return i18n.t('git.changes.discardFileDescription', { path: itemPath(target.item) });
  };

  const openWorkspaceDiff = (item: GitSeededWorkspaceChange) => {
    setDiffDialogItem(item);
    props.onSelectItem?.(item);
    setDiffDialogOpen(true);
  };

  const sectionContextTarget = (): GitChangesContextMenuTarget => ({
    kind: 'section',
    repoRootPath: repoRootPath(),
    effectiveRootPath: effectiveRootPath(),
    headRef: props.repoSummary?.headRef,
    section: selectedSection(),
    directoryPath: activeDirectoryPath(),
    count: visibleCount(),
    items: visibleItems().map((item) => ({ ...item })),
  });

  const itemContextTarget = (item: GitSeededWorkspaceChange): GitChangesContextMenuTarget => ({
    kind: 'item',
    repoRootPath: repoRootPath(),
    effectiveRootPath: effectiveRootPath(),
    headRef: props.repoSummary?.headRef,
    section: selectedSection(),
    directoryPath: activeDirectoryPath(),
    item: { ...item },
  });

  const itemFileTarget = (target: GitChangesContextMenuTarget): GitFileShortcutTarget | null => (
    target.kind === 'item' && !isGitWorkspaceDirectoryEntry(target.item)
      ? buildGitFileShortcutTarget({ rootPath: target.effectiveRootPath, item: target.item })
      : null
  );

  const targetDirectoryPath = (target: GitChangesContextMenuTarget): string => {
    if (target.kind === 'section') return target.directoryPath;
    if (isGitWorkspaceDirectoryEntry(target.item)) return workspaceDirectoryPath(target.item);
    const fileTarget = itemFileTarget(target);
    return fileTarget ? parentGitPath(fileTarget.relativePath) : '';
  };

  const targetDirectoryRequest = (target: GitChangesContextMenuTarget): GitDirectoryShortcutRequest | null => (
    buildGitDirectoryShortcutRequest({
      rootPath: target.effectiveRootPath,
      directoryPath: targetDirectoryPath(target),
    })
  );

  const contextMenuActions = (target: GitChangesContextMenuTarget): GitContextMenuActionItem[] => {
    const actions: GitContextMenuActionItem[] = [];
    const directoryRequest = targetDirectoryRequest(target);
    const fileTarget = itemFileTarget(target);
    const item = target.kind === 'item' ? target.item : null;
    const itemStaged = item?.section === 'staged';
    const actionBusy = target.kind === 'item'
      ? props.busyWorkspaceKey === workspaceEntryKey(target.item) && Boolean(props.busyWorkspaceAction)
      : props.busyWorkspaceKey === workspaceViewSectionActionKey(target.section, target.directoryPath) && Boolean(props.busyWorkspaceAction);
    const addAction = (
      action: Omit<GitContextMenuActionItem, 'kind'>,
    ) => actions.push({ ...action, kind: 'action' });

    if (props.onAskFlower && target.repoRootPath) {
      addAction({
        id: 'ask-flower',
        group: 'assistant',
        rank: 10,
        label: i18n.t('git.contextMenu.askFlower'),
        icon: FlowerIcon,
        onSelect: () => {
          if (target.kind === 'section') {
            props.onAskFlower?.({
              kind: 'workspace_section',
              repoRootPath: target.repoRootPath,
              headRef: target.headRef,
              section: target.section,
              items: target.items,
            });
            return;
          }
          props.onAskFlower?.({
            kind: 'workspace_item',
            repoRootPath: target.repoRootPath,
            headRef: target.headRef,
            section: target.section,
            item: target.item,
          });
        },
      });
    }

    if (item && isGitWorkspaceDirectoryEntry(item) && props.onNavigateDirectory) {
      addAction({
        id: 'open-directory',
        group: 'inspect',
        rank: 10,
        label: i18n.t('git.contextMenu.openDirectory'),
        icon: Folder,
        onSelect: () => props.onNavigateDirectory?.(workspaceDirectoryPath(item)),
      });
    }
    if (item && !isGitWorkspaceDirectoryEntry(item)) {
      addAction({
        id: 'view-diff',
        group: 'inspect',
        rank: 10,
        label: i18n.t('git.contextMenu.viewDiff'),
        icon: FileText,
        onSelect: () => openWorkspaceDiff(item),
      });
    }
    if (
      item
      && !isGitWorkspaceDirectoryEntry(item)
      && String(item.changeType ?? '').toLowerCase() !== 'deleted'
      && fileTarget
      && props.onPreviewCurrentFile
    ) {
      addAction({
        id: 'preview-current-file',
        group: 'inspect',
        rank: 20,
        label: i18n.t('git.contextMenu.previewCurrentFile'),
        icon: Eye,
        disabledReason: fileTarget.canPreviewCurrentFile
          ? undefined
          : i18n.t('git.contextMenu.previewCurrentFileUnavailable'),
        onSelect: () => props.onPreviewCurrentFile?.(fileTarget),
      });
    }

    if (directoryRequest && props.onOpenInTerminal) {
      addAction({
        id: 'open-in-terminal',
        group: 'navigate',
        rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'),
        icon: Terminal,
        onSelect: () => props.onOpenInTerminal?.(directoryRequest),
      });
    }
    if (directoryRequest && props.onBrowseFiles) {
      addAction({
        id: 'browse-files',
        group: 'navigate',
        rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'),
        icon: Folder,
        onSelect: () => void props.onBrowseFiles?.(directoryRequest),
      });
    }

    if (target.kind === 'section' && props.onBulkAction) {
      addAction({
        id: target.section === 'staged' ? 'unstage' : 'stage',
        group: 'modify',
        rank: 10,
        label: i18n.t(target.section === 'staged' ? 'git.contextMenu.unstage' : 'git.contextMenu.stage'),
        icon: target.section === 'staged' ? Minus : Plus,
        disabled: actionBusy,
        disabledReason: actionBusy ? i18n.t('common.status.loading') : undefined,
        onSelect: () => props.onBulkAction?.(target.section),
      });
    }
    if (item && ((itemStaged && props.onUnstageSelected) || (!itemStaged && props.onStageSelected))) {
      addAction({
        id: itemStaged ? 'unstage' : 'stage',
        group: 'modify',
        rank: 10,
        label: i18n.t(itemStaged ? 'git.contextMenu.unstage' : 'git.contextMenu.stage'),
        icon: itemStaged ? Minus : Plus,
        disabled: actionBusy,
        disabledReason: actionBusy ? i18n.t('common.status.loading') : undefined,
        onSelect: () => {
          if (itemStaged) props.onUnstageSelected?.(item);
          else props.onStageSelected?.(item);
        },
      });
    }

    if (target.kind === 'section' && props.onOpenCommitDialog) {
      addAction({
        id: 'commit',
        group: 'modify',
        rank: 20,
        label: i18n.t('git.changes.commitAction'),
        icon: CheckCircle,
        disabled: stagedCount() === 0,
        disabledReason: stagedCount() === 0 ? i18n.t('git.branches.nothingStaged') : undefined,
        onSelect: () => {
          props.onOpenCommitDialog?.();
          setCommitDialogOpen(true);
        },
      });
    }
    if (target.kind === 'section' && props.onOpenStash) {
      addAction({
        id: 'stash',
        group: 'modify',
        rank: 30,
        label: i18n.t('git.changes.stashAction'),
        icon: Package,
        disabled: !target.repoRootPath,
        disabledReason: target.repoRootPath ? undefined : i18n.t('git.notifications.repositoryPathUnavailable'),
        onSelect: () => {
          if (!target.repoRootPath) return;
          props.onOpenStash?.({
            tab: 'save',
            repoRootPath: target.repoRootPath,
            source: 'changes',
          });
        },
      });
    }

    if (props.onCopyText) {
      const absolutePath = fileTarget?.absolutePath ?? directoryRequest?.path ?? '';
      const relativePath = fileTarget?.relativePath ?? targetDirectoryPath(target);
      if (absolutePath) {
        addAction({
          id: 'copy-absolute-path',
          group: 'clipboard',
          rank: 10,
          label: i18n.t('git.contextMenu.copyAbsolutePath'),
          icon: Copy,
          onSelect: () => props.onCopyText?.(absolutePath),
        });
      }
      if (relativePath) {
        addAction({
          id: 'copy-relative-path',
          group: 'clipboard',
          rank: 20,
          label: i18n.t('git.contextMenu.copyRelativePath'),
          icon: Copy,
          onSelect: () => props.onCopyText?.(relativePath),
        });
      }
    }

    if (target.kind === 'section' && target.section === 'changes' && props.onDiscardAll) {
      addAction({
        id: 'discard',
        group: 'destructive',
        rank: 10,
        label: i18n.t('git.contextMenu.discard'),
        icon: Trash,
        destructive: true,
        disabled: actionBusy,
        disabledReason: actionBusy ? i18n.t('common.status.loading') : undefined,
        onSelect: () => setDiscardTarget({
          kind: 'section',
          section: target.section,
          directoryPath: target.directoryPath,
          count: target.count,
        }),
      });
    }
    if (item && isDiscardableWorkspaceItem(item) && props.onDiscardSelected) {
      addAction({
        id: 'discard',
        group: 'destructive',
        rank: 10,
        label: i18n.t('git.contextMenu.discard'),
        icon: Trash,
        destructive: true,
        disabled: actionBusy,
        disabledReason: actionBusy ? i18n.t('common.status.loading') : undefined,
        onSelect: () => setDiscardTarget({ kind: 'item', item }),
      });
    }

    return actions;
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
        setDiscardTarget({
          kind: 'section',
          section: selectedSection(),
          directoryPath: activeDirectoryPath(),
          count: visibleCount(),
        });
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
        label={actionId === 'flower' ? i18n.t('git.changes.askFlower') : actionId === 'terminal' ? i18n.t('git.changes.terminal') : i18n.t('git.changes.files')}
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
        return i18n.t('git.changes.commitAction');
      case 'bulk':
        return bulkActionLabel();
      case 'stash':
        return i18n.t('git.changes.stashAction');
      case 'discard':
        return activeDirectoryPath() ? i18n.t('git.changes.discardFolderAction') : i18n.t('git.changes.discardAllAction');
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
            aria-label={i18n.t('git.common.moreActions')}
            title={i18n.t('git.common.moreActions')}
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
  const browseFilesForBreadcrumb = (segment: GitChangesBreadcrumbSegment) => {
    const request = repoShortcutRequest(segment.path);
    if (!request) return;
    void props.onBrowseFiles?.(request);
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="sr-only">
        <span class="git-tone-dot git-tone-dot--warning" aria-hidden="true" />
        <div class="tracking-[0.16em]">{i18n.t('git.changes.workspace')}</div>
      </div>
      <Show when={!visibleError()} fallback={<GitStatePane tone="error" message={visibleError()} />}>
        {(() => {
          return (
            <>
              {/* Toolbar — exactly matches FileWorkspaceHeader pattern */}
          <div class={`shrink-0 border-b px-2.5 py-1.5 ${redevenDividerRoleClass()} ${redevenSurfaceRoleClass('inset')}`}>
            <div ref={setHeaderElement} data-git-changes-header-density={headerPresentation().density}>
              {/* Row 1: SegmentedControl + Filter — like Files toolbar grid */}
              <div class="grid items-center gap-2 grid-cols-[auto_minmax(0,1fr)_auto]">
                <SegmentedControl
                  size="sm"
                  value={selectedSection()}
                  onChange={(value) => props.onSelectSection?.(value as GitWorkspaceViewSection)}
                  options={[
                    { value: 'changes', label: i18n.t('git.common.changes') },
                    { value: 'staged', label: i18n.t('git.common.staged') },
                    { value: 'conflicted', label: i18n.t('git.common.conflicted') },
                  ]}
                  class="h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:py-0"
                />
                <label
                  class={`git-changes-filter-slot flex h-7 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] text-muted-foreground shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring ${redevenSurfaceRoleClass('control')} ${redevenSurfaceRoleClass('controlMuted')}`}
                  data-git-changes-filter-state={filterDisabled() ? 'pending' : 'ready'}
                >
                  <Search class="size-3.5 shrink-0" />
                  <input
                    type="text"
                    value={filterQuery()}
                    onInput={(event) => setFilterQuery(event.currentTarget.value)}
                    placeholder={i18n.t('git.changes.filterPlaceholder')}
                    aria-label={i18n.t('git.changes.filterPlaceholder')}
                    disabled={filterDisabled()}
                    class="h-full min-w-0 flex-1 border-0 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-wait"
                  />
                </label>
              </div>

              {/* Row 2: Status info + action buttons — like Files status info bar */}
              <div class="git-changes-toolbar-status-row mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Show when={headerPresentation().isCleanState}>
                    <span>{i18n.t('git.common.clean')}</span>
                    <span aria-hidden="true">·</span>
                  </Show>
                  <span>{countBadgeLabel()}</span>
                  <Show when={stagedCount() > 0}>
                    <span aria-hidden="true">·</span>
                    <span>{stagedBadgeLabel()}</span>
                  </Show>
                  <Show when={headerPresentation().showSummaryCopy}>
                    <span aria-hidden="true">·</span>
                    <span class="line-clamp-1">{summaryCopy()}</span>
                  </Show>
                  <span
                    class="git-changes-toolbar-loading-slot"
                    data-visible={tableLoadingState() !== 'idle' ? 'true' : 'false'}
                  >
                    <Show when={tableLoadingState() !== 'idle'}>
                      <GitInlineLoadingStatus>{tableLoadingLabel()}</GitInlineLoadingStatus>
                    </Show>
                  </span>
                </div>
                <Show when={showActionRow()}>
                  <div
                    class="flex items-center gap-1.5"
                    data-git-changes-header-actions={headerPresentation().layoutMode === 'quiet_inline' ? 'inline' : 'separate'}
                  >
                    <For each={headerPrimaryActions()}>
                      {(actionId) => renderPrimaryAction(actionId)}
                    </For>
                    <Show when={headerUtilityActions().length > 0}>
                      <GitShortcutOrbDock>
                        <For each={headerUtilityActions()}>
                          {(actionId) => renderUtilityAction(actionId)}
                        </For>
                      </GitShortcutOrbDock>
                    </Show>
                    {renderOverflowAction()}
                  </div>
                </Show>
              </div>

              {/* Row 3: Breadcrumb */}
              <div class="git-changes-breadcrumb-slot mt-1" data-visible={showBreadcrumbRail() ? 'true' : 'false'}>
                <Show when={showBreadcrumbRail()}>
                  <GitChangesBreadcrumb
                    segments={breadcrumbSegments()}
                    onSelect={props.onNavigateDirectory ? (segment) => props.onNavigateDirectory?.(segment.path) : undefined}
                    onBrowseFiles={props.onBrowseFiles ? browseFilesForBreadcrumb : undefined}
                  />
                </Show>
              </div>
            </div>
          </div>

          {/* Content area — table fills edge-to-edge, no card wrapping */}
          <div
            class="min-h-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            tabIndex={0}
            data-git-changes-context-target="section"
            on:contextmenu={(event) => contextMenu.openFromContextMenu(event, sectionContextTarget())}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              contextMenu.openFromKeyboard(event, sectionContextTarget());
            }}
          >
            <WorkspaceTable
              section={selectedSection()}
              items={filteredItems()}
              totalCount={visibleItemCount()}
              loadingState={tableLoadingState()}
              expectedCount={visibleCount()}
              loadingLabel={tableLoadingLabel()}
              hasMore={selectedPageState().hasMore}
              loadingMore={visibleLoadingMore()}
              selectedKey={selectedKey()}
              filtered={filterActive()}
              filteredCount={filteredCount()}
              onSelectItem={props.onSelectItem}
              onOpenDiff={openWorkspaceDiff}
              onOpenDirectory={(directoryPath) => props.onNavigateDirectory?.(directoryPath)}
              onAction={(item) => {
                if (item.section === 'staged') props.onUnstageSelected?.(item);
                else props.onStageSelected?.(item);
              }}
              onDiscard={(item) => setDiscardTarget({ kind: 'item', item })}
              onOpenContextMenu={(event, item) => contextMenu.openFromContextMenu(event, itemContextTarget(item))}
              onOpenContextMenuFromKeyboard={(event, item) => contextMenu.openFromKeyboard(event, itemContextTarget(item))}
              onLoadMore={() => props.onLoadMoreWorkspaceSection?.(selectedSection())}
              busyWorkspaceKey={props.busyWorkspaceKey}
              busyWorkspaceAction={props.busyWorkspaceAction}
              sectionActionKey={sectionActionKey()}
            />
          </div>
          </>
        );
      })()}
        </Show>

      <GitEntityContextMenu
        controller={contextMenu}
        items={contextMenuActions}
      />

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
        title={i18n.t('git.changes.workspaceDiffTitle')}
        description={diffItem() ? changeSecondaryPath(diffItem()) : i18n.t('git.changes.workspaceDiffDescription')}
        emptyMessage={i18n.t('git.changes.workspaceDiffEmpty')}
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
          if (target.kind === 'section') {
            props.onDiscardAll?.(target.section, {
              directoryPath: target.directoryPath,
              count: target.count,
            });
          }
          else props.onDiscardSelected?.(target.item);
          setDiscardTarget(null);
        }}
      >
        <div class="text-sm leading-relaxed text-foreground">{discardDescription()}</div>
      </ConfirmDialog>
    </div>
  );
}
