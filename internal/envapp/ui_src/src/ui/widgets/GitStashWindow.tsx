import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Eye,
  FileText,
  Folder,
  Files,
  GitBranch,
  Layers,
  Plus,
  Minus,
  Refresh,
  Save,
  Terminal,
  Trash,
} from '@floegence/floe-webapp-core/icons';
import { Button, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import type {
  GitRepoSummaryResponse,
  GitStashSummary,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';
import {
  changeDisplayPath,
  changeSecondaryPath,
  gitDiffEntryIdentity,
  repoDisplayName,
  shortGitHash,
  summarizeWorkspaceCount,
  type GitSeededCommitFileSummary,
  type GitSeededStashDetail,
  type GitStashWindowSource,
  type GitStashWindowTab,
} from '../utils/gitWorkbench';
import { useI18n } from '../i18n';
import { stashReviewMatchesTarget, type GitStashReviewState } from '../utils/gitStashReview';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { gitChangePathClass } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import { GitStashDeleteConfirmDialog } from './GitStashDeleteConfirmDialog';
import { GitVirtualTable } from './GitVirtualTable';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChecklistItem,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitStatePane,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import { PreviewWindow } from './PreviewWindow';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';
import { FlowerIcon } from '../icons/FlowerIcon';
import {
  buildGitDirectoryShortcutRequest,
  buildGitFileShortcutTarget,
  type GitAskFlowerRequest,
  type GitDirectoryShortcutRequest,
  type GitFileShortcutTarget,
} from '../utils/gitBrowserShortcuts';
import {
  GitEntityContextMenu,
  createGitEntityContextMenuController,
  type GitContextMenuActionItem,
} from './GitEntityContextMenu';

export type { GitStashReviewState } from '../utils/gitStashReview';

type StashPatchErrorState = {
  message: string;
  detail?: string;
};

const STASH_DIFF_DIALOG_Z_INDEX = ENV_APP_FLOATING_LAYER.floatingWindowModal;

export interface GitStashWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: GitStashWindowTab;
  onTabChange: (tab: GitStashWindowTab) => void;
  repoRootPath?: string;
  source?: GitStashWindowSource;
  repoSummary?: GitRepoSummaryResponse | null;
  workspaceSummary?: GitWorkspaceSummary | null;
  contextLoading?: boolean;
  contextError?: string;
  stashes: GitStashSummary[];
  stashesLoading?: boolean;
  stashesError?: string;
  selectedStashId?: string;
  onSelectStash?: (id: string) => void;
  stashDetail?: GitSeededStashDetail | null;
  stashDetailLoading?: boolean;
  stashDetailError?: string;
  saveMessage?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
  saveBusy?: boolean;
  applyBusy?: boolean;
  dropBusy?: boolean;
  reviewLoading?: boolean;
  review?: GitStashReviewState | null;
  reviewError?: string;
  onSaveMessageChange?: (value: string) => void;
  onIncludeUntrackedChange?: (value: boolean) => void;
  onKeepIndexChange?: (value: boolean) => void;
  onSave?: () => void;
  onRefreshStashes?: () => void;
  onRequestApply?: (stashId: string, removeAfterApply: boolean) => void;
  onRequestDrop?: (stashId: string) => void;
  onAskFlower?: (request: Extract<GitAskFlowerRequest, { kind: 'stash' | 'stash_file' }>) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onPreviewCurrentFile?: (target: GitFileShortcutTarget) => void;
  onCopyText?: (value: string) => void;
  onConfirmReview?: () => void;
  onCancelReview?: () => void;
}

type GitStashContextMenuTarget =
  | Readonly<{
      kind: 'stash';
      repoRootPath: string;
      stash: GitStashSummary;
      files?: GitSeededCommitFileSummary[];
      displayRef: string;
    }>
  | Readonly<{
      kind: 'file';
      repoRootPath: string;
      stash: GitStashSummary;
      file: GitSeededCommitFileSummary;
    }>;

// -- helpers --

function buildStashPatchErrorState(error: unknown, i18n: ReturnType<typeof useI18n>): StashPatchErrorState {
  const raw = typeof error === 'string'
    ? error.trim()
    : error instanceof Error
      ? String(error.message ?? '').trim()
      : String(error ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('stash not found')) {
    return {
      message: i18n.t('git.notifications.stashNoLongerAvailableMessage'),
      detail: i18n.t('common.actions.refresh'),
    };
  }
  if (lower.includes('file not found in diff')) {
    return {
      message: i18n.t('gitStash.fileUnavailable'),
      detail: i18n.t('common.actions.refresh'),
    };
  }
  return {
    message: i18n.t('gitDiff.failedPatch'),
    detail: i18n.t('common.actions.refresh'),
  };
}

function computeStashStats(files: GitSeededCommitFileSummary[]): {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
} {
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions ?? 0;
    totalDeletions += file.deletions ?? 0;
  }
  return {
    totalFiles: files.length,
    totalAdditions,
    totalDeletions,
  };
}

function stashDisplayIndex(id: string, stashes: GitStashSummary[]): string {
  const index = stashes.findIndex((s) => s.id === id);
  if (index < 0) return '';
  return `stash@{${index}}`;
}

// -- sub-components --

interface StashActionButtonProps {
  mobile: boolean;
  tooltip: string;
  disabled?: boolean;
  children: JSX.Element;
}

function StashActionButton(props: StashActionButtonProps) {
  return (
    <Show when={!props.mobile} fallback={props.children}>
      <Tooltip content={props.tooltip} placement="top" delay={0}>
        <span class={cn('inline-flex shrink-0', props.disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {props.children}
        </span>
      </Tooltip>
    </Show>
  );
}

interface StashListItemCardProps {
  stash: GitStashSummary;
  stashes: GitStashSummary[];
  active: boolean;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

function StashListItemCard(props: StashListItemCardProps) {
  const i18n = useI18n();
  return (
    <button
      type="button"
      data-git-stash-id={props.stash.id}
      class={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2.5 text-left',
        'transition-all duration-150 border-l-[3px]',
        props.active
          ? 'border-l-[var(--redeven-status-info)] bg-[var(--redeven-status-info-soft)] shadow-sm'
          : 'border-l-transparent hover:bg-muted/[0.06]',
      )}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
    >
      <span class={cn(
        'shrink-0 text-[11px] font-mono font-semibold tabular-nums tracking-tight',
        props.active ? 'text-[var(--redeven-status-info-foreground)]' : 'text-muted-foreground/60',
      )}>
        {stashDisplayIndex(props.stash.id, props.stashes)}
      </span>
      <div class="min-w-0 flex-1">
        <div class={cn(
          'truncate text-xs font-medium',
          props.active ? 'text-foreground' : 'text-foreground',
        )}>
          {props.stash.message || props.stash.ref || i18n.t('uiCopy.git.unnamedStash')}
        </div>
        <div class={cn(
          'mt-0.5 flex items-center gap-1.5 text-[10px]',
          props.active ? 'text-muted-foreground/90' : 'text-muted-foreground/70',
        )}>
          <GitBranch class="h-3 w-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{props.stash.branchName || i18n.t('uiCopy.git.unknown')}</span>
          <span aria-hidden="true">·</span>
          <Clock class="h-3 w-3 shrink-0" aria-hidden="true" />
          <span class="shrink-0">{props.stash.createdAtUnixMs ? i18n.formatRelativeTime(props.stash.createdAtUnixMs) : '–'}</span>
        </div>
      </div>
      <Show when={props.stash.hasUntracked}>
        <AlertTriangle class={cn(
          'h-3.5 w-3.5 shrink-0',
          props.active ? 'text-warning' : 'text-warning/60',
        )} aria-label={i18n.t('uiCopy.git.includesUntracked')} />
      </Show>
    </button>
  );
}

function StashDetailHeader(props: {
  stash: GitSeededStashDetail;
  stashes: GitStashSummary[];
  onContextMenu: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const i18n = useI18n();
  const stats = createMemo(() => computeStashStats(props.stash.files));
  return (
    <div
      data-git-stash-detail-header
      class="space-y-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      tabIndex={0}
      aria-label={`${String(props.stash.ref ?? '').trim()} ${props.stash.message || i18n.t('uiCopy.git.unnamedStash')}`.trim()}
      onContextMenu={props.onContextMenu}
      onKeyDown={props.onKeyDown}
    >
      <div>
        <div class="flex items-baseline gap-2">
          <span class="text-[11px] font-mono font-semibold tracking-tight text-muted-foreground/60">
            {stashDisplayIndex(props.stash.id, props.stashes)}
          </span>
          <h3 class="text-sm font-semibold text-foreground truncate">
            {props.stash.message || i18n.t('uiCopy.git.unnamedStash')}
          </h3>
        </div>
        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
          <span class="inline-flex items-center gap-1">
            <GitBranch class="h-3 w-3" aria-hidden="true" />
            {props.stash.branchName || i18n.t('uiCopy.git.unknown')}
          </span>
          <span class="inline-flex items-center gap-1">
            <Clock class="h-3 w-3" aria-hidden="true" />
            {props.stash.createdAtUnixMs ? i18n.formatRelativeTime(props.stash.createdAtUnixMs) : '–'}
          </span>
          <Show when={props.stash.headCommit}>
            <span class="font-mono text-[10px]">{shortGitHash(props.stash.headCommit)}</span>
          </Show>
        </div>
      </div>

      <div class="flex items-center gap-4 text-xs">
        <span class="inline-flex items-center gap-1.5">
          <Files class="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
          <span class="font-medium tabular-nums">{i18n.tn('git.common.fileCount', stats().totalFiles)}</span>
        </span>
        <span class="inline-flex items-center gap-1.5 text-success">
          <Plus class="h-3 w-3" aria-hidden="true" />
          <span class="font-medium tabular-nums">+{stats().totalAdditions}</span>
        </span>
        <span class="inline-flex items-center gap-1.5 text-destructive">
          <Minus class="h-3 w-3" aria-hidden="true" />
          <span class="font-medium tabular-nums">-{stats().totalDeletions}</span>
        </span>
      </div>

      <Show when={props.stash.hasUntracked}>
        <div class="flex items-center gap-1.5 text-[11px] text-warning/80">
          <AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
          {i18n.t('uiCopy.git.includesUntracked')}
        </div>
      </Show>
    </div>
  );
}

// -- main component --

export function GitStashWindow(props: GitStashWindowProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitSeededCommitFileSummary | null>(null);
  const [diffDialogStashId, setDiffDialogStashId] = createSignal('');
  const [floatingSurfaceEl, setFloatingSurfaceEl] = createSignal<HTMLElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = createSignal(304); // px, default ~19rem
  const contextMenu = createGitEntityContextMenuController<GitStashContextMenuTarget>({
    snapshotTarget: (target) => (
      target.kind === 'file'
        ? {
            ...target,
            stash: { ...target.stash },
            file: { ...target.file },
          }
        : {
            ...target,
            stash: { ...target.stash },
            files: target.files?.map((file) => ({ ...file })),
          }
    ),
  });

  // -- resize handle --
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  const onResizeMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = leftPanelWidth();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onResizeMouseMove = (e: MouseEvent) => {
    if (!resizing) return;
    const delta = e.clientX - resizeStartX;
    const next = Math.max(180, Math.min(500, resizeStartWidth + delta));
    setLeftPanelWidth(next);
  };

  const onResizeMouseUp = () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  document.addEventListener('mousemove', onResizeMouseMove);
  document.addEventListener('mouseup', onResizeMouseUp);
  onCleanup(() => {
    document.removeEventListener('mousemove', onResizeMouseMove);
    document.removeEventListener('mouseup', onResizeMouseUp);
  });

  const repoPath = () => String(props.repoRootPath ?? props.repoSummary?.repoRootPath ?? '').trim();
  const repoName = () => repoDisplayName(repoPath());
  const workspaceTotal = () => summarizeWorkspaceCount(props.workspaceSummary);
  const canSave = createMemo(() => Boolean(
    repoPath()
    && !props.contextLoading
    && workspaceTotal() > 0
    && !props.saveBusy
  ));
  const selectedStash = createMemo(() => {
    const selectedId = String(props.selectedStashId ?? '').trim();
    if (!selectedId) return null;
    if (props.stashDetail?.id === selectedId) return props.stashDetail;
    return props.stashes.find((item) => item.id === selectedId) ?? null;
  });
  const detailFiles = createMemo(() => props.stashDetail?.files ?? []);
  const reviewMatchesSelection = createMemo(() => {
    return stashReviewMatchesTarget(props.review, {
      repoRootPath: repoPath(),
      repoSummary: props.repoSummary ?? null,
      stash: selectedStash(),
    });
  });
  const reviewBlockingReason = createMemo(() => {
    const review = props.review;
    if (!reviewMatchesSelection() || !review) return '';
    if (review.kind !== 'apply') return '';
    return String(review.preview.blockingReason ?? review.preview.blocking?.reason ?? '').trim();
  });
  const applyReview = createMemo(() => (
    reviewMatchesSelection() && props.review?.kind === 'apply'
      ? props.review
      : null
  ));
  const deleteReviewOpen = createMemo(() => Boolean(props.open && reviewMatchesSelection() && props.review?.kind === 'drop'));
  const canConfirmReview = createMemo(() => {
    const review = props.review;
    if (!reviewMatchesSelection() || !review || props.reviewLoading) return false;
    if (review.kind === 'apply') {
      return !reviewBlockingReason() && !props.applyBusy;
    }
    return !props.dropBusy;
  });
  const actionsDisabled = createMemo(() => Boolean(props.reviewLoading || props.applyBusy || props.dropBusy));
  const actionsDisabledReason = createMemo(() => {
    if (props.reviewLoading) return i18n.t('common.status.loading');
    if (props.applyBusy) return i18n.t('uiCopy.git.applying');
    if (props.dropBusy) return i18n.t('uiCopy.git.deleting');
    return undefined;
  });
  const isMobile = createMemo(() => layout.isMobile());
  const stashTabOptions = createMemo(() => [
    { value: 'save', label: 'Save Changes' },
    { value: 'stashes', label: 'Saved Stashes' },
  ]);
  const handleTabChange = (value: string) => {
    props.onTabChange(value === 'stashes' ? 'stashes' : 'save');
  };

  const closeDiffDialog = () => {
    setDiffDialogOpen(false);
    setDiffDialogItem(null);
    setDiffDialogStashId('');
  };
  const openDiffDialog = (file: GitSeededCommitFileSummary, stashId = String(selectedStash()?.id ?? '').trim()) => {
    setDiffDialogItem(file);
    setDiffDialogStashId(stashId);
    setDiffDialogOpen(true);
  };

  const stashTarget = (
    stash: GitStashSummary,
    files?: GitSeededCommitFileSummary[],
  ): GitStashContextMenuTarget => ({
    kind: 'stash',
    repoRootPath: repoPath(),
    stash,
    files,
    displayRef: String(stash.ref ?? '').trim() || stashDisplayIndex(stash.id, props.stashes),
  });

  const fileTarget = (
    stash: GitStashSummary,
    file: GitSeededCommitFileSummary,
  ): GitStashContextMenuTarget => ({
    kind: 'file',
    repoRootPath: repoPath(),
    stash,
    file,
  });

  const contextMenuItems = (target: GitStashContextMenuTarget): GitContextMenuActionItem[] => {
    const items: GitContextMenuActionItem[] = [];
    const repositoryRequest = buildGitDirectoryShortcutRequest({ rootPath: target.repoRootPath });
    const repositoryUnavailable = repositoryRequest ? '' : i18n.t('git.notifications.repositoryPathUnavailable');
    const currentFile = target.kind === 'file'
      ? buildGitFileShortcutTarget({ rootPath: target.repoRootPath, item: target.file })
      : null;
    const directoryRequest = target.kind === 'file'
      ? currentFile
        ? buildGitDirectoryShortcutRequest({
            rootPath: target.repoRootPath,
            directoryPath: currentFile.relativePath.split('/').slice(0, -1).join('/'),
          })
        : null
      : repositoryRequest;
    const directoryUnavailable = directoryRequest
      ? undefined
      : repositoryUnavailable || i18n.t('git.contextMenu.previewCurrentFileUnavailable');
    const addItem = (item: Omit<GitContextMenuActionItem, 'kind'>) => {
      items.push({ ...item, kind: 'action' });
    };

    if (props.onAskFlower) {
      addItem({
        id: 'ask-flower',
        group: 'assistant',
        rank: 10,
        label: i18n.t('git.contextMenu.askFlower'),
        icon: FlowerIcon,
        disabledReason: repositoryUnavailable || undefined,
        onSelect: () => {
          if (target.kind === 'file') {
            props.onAskFlower?.({
              kind: 'stash_file',
              repoRootPath: target.repoRootPath,
              stash: target.stash,
              file: target.file,
            });
            return;
          }
          props.onAskFlower?.({
            kind: 'stash',
            repoRootPath: target.repoRootPath,
            stash: target.stash,
            files: target.files,
          });
        },
      });
    }

    if (target.kind === 'file') {
      const deleted = String(target.file.changeType ?? '').trim().toLowerCase() === 'deleted';
      addItem({
        id: 'view-diff',
        group: 'inspect',
        rank: 10,
        label: i18n.t('git.contextMenu.viewDiff'),
        icon: FileText,
        onSelect: () => openDiffDialog(target.file, target.stash.id),
      });
      if (!deleted && props.onPreviewCurrentFile) {
        addItem({
          id: 'preview-current-file',
          group: 'inspect',
          rank: 20,
          label: i18n.t('git.contextMenu.previewCurrentFile'),
          icon: Eye,
          disabledReason: currentFile?.canPreviewCurrentFile
            ? undefined
            : i18n.t('git.contextMenu.previewCurrentFileUnavailable'),
          onSelect: () => {
            if (currentFile?.canPreviewCurrentFile) props.onPreviewCurrentFile?.(currentFile);
          },
        });
      }
      if (props.onCopyText) {
        if (currentFile?.absolutePath) {
          addItem({
            id: 'copy-absolute-path',
            group: 'clipboard',
            rank: 10,
            label: i18n.t('git.contextMenu.copyAbsolutePath'),
            icon: Copy,
            onSelect: () => props.onCopyText?.(currentFile.absolutePath),
          });
        }
        if (currentFile?.relativePath) {
          addItem({
            id: 'copy-relative-path',
            group: 'clipboard',
            rank: 20,
            label: i18n.t('git.contextMenu.copyRelativePath'),
            icon: Copy,
            onSelect: () => props.onCopyText?.(currentFile.relativePath),
          });
        }
      }
    }

    if (props.onOpenInTerminal) {
      addItem({
        id: 'open-terminal',
        group: 'navigate',
        rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'),
        icon: Terminal,
        disabledReason: directoryUnavailable,
        onSelect: () => {
          if (directoryRequest) props.onOpenInTerminal?.(directoryRequest);
        },
      });
    }
    if (props.onBrowseFiles) {
      addItem({
        id: 'browse-files',
        group: 'navigate',
        rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'),
        icon: Folder,
        disabledReason: directoryUnavailable,
        onSelect: () => {
          if (directoryRequest) void props.onBrowseFiles?.(directoryRequest);
        },
      });
    }

    if (target.kind === 'stash') {
      if (props.onRequestApply) {
        addItem({
          id: 'apply-stash',
          group: 'modify',
          rank: 10,
          label: i18n.t('git.contextMenu.applyStash'),
          icon: CheckCircle,
          disabled: actionsDisabled(),
          disabledReason: actionsDisabledReason(),
          onSelect: () => props.onRequestApply?.(target.stash.id, false),
        });
        addItem({
          id: 'apply-and-remove-stash',
          group: 'modify',
          rank: 20,
          label: i18n.t('git.contextMenu.applyAndRemoveStash'),
          icon: Check,
          disabled: actionsDisabled(),
          disabledReason: actionsDisabledReason(),
          onSelect: () => props.onRequestApply?.(target.stash.id, true),
        });
      }
      if (props.onCopyText && target.displayRef) {
        addItem({
          id: 'copy-stash-ref',
          group: 'clipboard',
          rank: 10,
          label: i18n.t('git.contextMenu.copyStashRef'),
          icon: Copy,
          onSelect: () => props.onCopyText?.(target.displayRef),
        });
      }
      if (props.onRequestDrop) {
        addItem({
          id: 'delete-stash',
          group: 'destructive',
          rank: 10,
          label: i18n.t('git.contextMenu.deleteStash'),
          icon: Trash,
          destructive: true,
          disabled: actionsDisabled(),
          disabledReason: actionsDisabledReason(),
          onSelect: () => props.onRequestDrop?.(target.stash.id),
        });
      }
    }

    return items;
  };

  const openContextMenu = (event: MouseEvent, target: GitStashContextMenuTarget) => {
    if (contextMenuItems(target).length > 0) contextMenu.openFromContextMenu(event, target);
  };
  const openKeyboardMenu = (event: KeyboardEvent, target: GitStashContextMenuTarget) => {
    if (contextMenuItems(target).length > 0) contextMenu.openFromKeyboard(event, target);
  };

  createEffect(on(() => [props.open, props.tab] as const, ([open, tab]) => {
    if (open && tab === 'stashes') return;
    closeDiffDialog();
    if (contextMenu.state()) contextMenu.close();
  }));

  createEffect(on(() => selectedStash()?.id ?? '', (stashId) => {
    const activeDialogStashId = diffDialogStashId();
    if (!activeDialogStashId) return;
    if (stashId && stashId === activeDialogStashId) return;
    closeDiffDialog();
  }));

  createEffect(() => {
    const item = diffDialogItem();
    if (!item) return;
    if (diffDialogStashId() !== String(props.stashDetail?.id ?? '').trim()) return;
    if (detailFiles().some((file) => gitDiffEntryIdentity(file) === gitDiffEntryIdentity(item))) return;
    closeDiffDialog();
  });

  return (
    <>
      <PreviewWindow
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={`${i18n.t('git.common.stashes')} · ${repoName()}`}
        persistenceKey="git-stash-window"
        defaultSize={{ width: 1040, height: 760 }}
        minSize={{ width: 720, height: 520 }}
        floatingClass="bg-background"
        mobileClass="bg-background"
        surfaceRef={setFloatingSurfaceEl}
      >
        <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
          {/* Header */}
          <div class={cn('shrink-0 border-b px-3 py-2', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-[13px] font-semibold tracking-tight text-foreground truncate">{repoName()}</span>
                <Show when={props.tab === 'stashes'}>
                  <span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[11px] font-medium tabular-nums text-muted-foreground">
                    <Layers class="h-3 w-3" aria-hidden="true" />
                    {props.stashes.length}
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <Show when={props.tab === 'stashes'}>
                  <Button size="xs" variant="ghost" class="h-6 w-6 p-0" icon={Refresh} aria-label={i18n.t('uiCopy.git.refreshStashes')} onClick={() => props.onRefreshStashes?.()} />
                </Show>
                <SegmentedControl
                  value={props.tab}
                  onChange={handleTabChange}
                  size="sm"
                  aria-label={i18n.t('uiCopy.git.stashTabs')}
                  class="h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:py-0"
                  options={stashTabOptions()}
                />
              </div>
            </div>
          </div>

          <div class="@container min-h-0 flex-1 overflow-hidden">
            <Show
              when={props.tab === 'save'}
              fallback={(
                <div class="flex h-full min-h-0 flex-col overflow-hidden @[640px]:flex-row">
                  {/* Left: stash list */}
                  <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="min-h-0 overflow-auto w-full @[640px]:shrink-0 @[640px]:border-r @[640px]:w-[var(--stash-left-panel-width)]" style={{ "--stash-left-panel-width": `${leftPanelWidth()}px` } as JSX.CSSProperties}>

                    <Show when={!props.stashesLoading} fallback={<GitStatePane loading message={i18n.t('uiCopy.git.loadingStashes')} surface class="min-h-[12rem]" />}>
                      <Show when={!props.stashesError} fallback={<GitStatePane tone="error" message={props.stashesError ?? i18n.t('uiCopy.git.failedToLoadStashes')} surface class="min-h-[12rem]" />}>
                        <Show
                          when={props.stashes.length > 0}
                          fallback={<GitStatePane message={i18n.t('uiCopy.git.noStashes')} detail={i18n.t('uiCopy.git.noStashesDescription')} surface class="min-h-[12rem]" />}
                        >
                          <div class="space-y-px p-1.5">
                            <For each={props.stashes}>
                              {(stash) => {
                                const active = () => stash.id === selectedStash()?.id;
                                return (
                                  <StashListItemCard
                                    stash={stash}
                                    stashes={props.stashes}
                                    active={active()}
                                    onClick={() => props.onSelectStash?.(stash.id)}
                                    onContextMenu={(event) => openContextMenu(event, stashTarget(stash))}
                                    onKeyDown={(event) => openKeyboardMenu(event, stashTarget(stash))}
                                  />
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </Show>
                  </div>

                      {/* Resize handle — row layout only */}
                      <div
                        aria-hidden="true"
                        class="hidden @[640px]:block w-1 shrink-0 cursor-col-resize transition-colors hover:bg-primary/40 active:bg-primary/60"
                        onMouseDown={onResizeMouseDown}
                      />

                        {/* Right: context-aware panel */}
                        <Show when={props.stashDetail || props.stashDetailLoading || props.stashDetailError}>
                          <div class="flex min-h-0 flex-1 flex-col">
                            <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="min-h-0 flex-1 overflow-auto p-3">
                              <Show when={!props.stashDetailError} fallback={<GitStatePane tone="error" message={props.stashDetailError ?? i18n.t('uiCopy.git.failedToLoadStashDetail')} surface class="h-full" />}>
                                {(() => {
                                  if (!props.stashDetail && props.stashDetailLoading) {
                                    return <GitStatePane loading message={i18n.t('uiCopy.git.loadingStashDetail')} surface class="h-full" />;
                                  }
                                  const detail = props.stashDetail;
                                  if (!detail) return null;
                                  return (
                                    <>
                                      <Show when={props.stashDetailLoading}>
                                        <div class="mb-3 -mt-1">
                                          <div class="h-0.5 w-full animate-pulse rounded-full bg-primary/40" />
                                        </div>
                                      </Show>
                                      <div class="flex flex-col gap-4">
                                        <StashDetailHeader
                                          stash={detail}
                                          stashes={props.stashes}
                                          onContextMenu={(event) => openContextMenu(event, stashTarget(detail, detail.files))}
                                          onKeyDown={(event) => openKeyboardMenu(event, stashTarget(detail, detail.files))}
                                        />
                                        {/* Changed files */}
                                        <div>
                                          <div class="flex items-center gap-2 mb-1.5">
                                            <FileText class="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />
                                            <span class="text-xs font-medium text-foreground">{i18n.t('uiCopy.git.changedFiles')}</span>
                                            <span class="inline-flex items-center rounded-full bg-muted px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">{String(detailFiles().length)}</span>
                                          </div>
                                          <Show when={detailFiles().length > 0} fallback={<GitSubtleNote>{i18n.t('uiCopy.git.noStashFiles')}</GitSubtleNote>}>
                                            <div class="overflow-hidden rounded-md border">
                                              <GitVirtualTable
                                                items={detailFiles()}
                                                tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[34rem] sm:min-w-[42rem] md:min-w-0`}
                                                header={(
                                                  <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.path')}</th>
                                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.status')}</th>
                                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.changes')}</th>
                                                    <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>{i18n.t('git.common.action')}</th>
                                                  </tr>
                                                )}
                                                renderRow={(file) => {
                                                  const active = () => (
                                                    diffDialogOpen()
                                                    && diffDialogStashId() === String(selectedStash()?.id ?? '').trim()
                                                    && gitDiffEntryIdentity(diffDialogItem()) === gitDiffEntryIdentity(file)
                                                  );
                                                  const primaryPath = changeDisplayPath(file);
                                                  const secondaryPath = changeSecondaryPath(file);
                                                  return (
                                                    <tr
                                                      data-git-stash-file={file.path}
                                                      aria-selected={active()}
                                                      class={`${gitChangedFilesRowClass(active())} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70`}
                                                      onClick={() => openDiffDialog(file)}
                                                      tabIndex={0}
                                                      onContextMenu={(event) => openContextMenu(event, fileTarget(detail, file))}
                                                      onKeyDown={(event) => openKeyboardMenu(event, fileTarget(detail, file))}
                                                    >
                                                      <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                                        <div class="min-w-0">
                                                          <button
                                                            type="button"
                                                            class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(file.changeType)}`}
                                                            title={secondaryPath}
                                                            onClick={(event) => {
                                                              event.stopPropagation();
                                                              openDiffDialog(file);
                                                            }}
                                                          >
                                                            {primaryPath}
                                                          </button>
                                                          <Show when={secondaryPath !== primaryPath}>
                                                            <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={secondaryPath}>{secondaryPath}</div>
                                                          </Show>
                                                        </div>
                                                      </td>
                                                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeStatusPill change={file.changeType} /></td>
                                                      <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={file.additions} deletions={file.deletions} /></td>
                                                      <td class={gitChangedFilesStickyCellClass(active())}>
                                                        <GitChangedFilesActionButton
                                                          onClick={(event) => {
                                                            event.stopPropagation();
                                                            openDiffDialog(file);
                                                          }}
                                                        >
                                                          {i18n.t('files.menuViewDiff')}
                                                        </GitChangedFilesActionButton>
                                                      </td>
                                                    </tr>
                                                  );
                                                }}
                                              />
                                            </div>
                                          </Show>
                                        </div>
                                      </div>
                                    </>
                                  );
                                })()}
                              </Show>
                            </div>

                            {/* Fixed footer with actions */}
                            <Show when={props.stashDetail}>
                              <div class="shrink-0 border-t px-3 py-2">
                                <div data-git-stash-actions class="flex flex-wrap items-center gap-2">
                                  <div class="inline-flex flex-wrap items-center gap-2">
                                    <StashActionButton mobile={isMobile()} tooltip={i18n.t('gitStash.applyTooltip')} disabled={actionsDisabled()}>
                                      <Button size="sm" variant="default" class="rounded-md" icon={CheckCircle} disabled={actionsDisabled()} onClick={() => props.onRequestApply?.(props.stashDetail!.id, false)}>
                                        {props.applyBusy && props.review?.kind === 'apply' && !props.review?.removeAfterApply ? i18n.t('uiCopy.git.applying') : i18n.t('uiCopy.git.apply')}
                                      </Button>
                                    </StashActionButton>
                                    <StashActionButton mobile={isMobile()} tooltip={i18n.t('gitStash.applyRemoveTooltip')} disabled={actionsDisabled()}>
                                      <Button size="sm" variant="outline" class={cn('rounded-md', redevenSurfaceRoleClass('control'))} disabled={actionsDisabled()} onClick={() => props.onRequestApply?.(props.stashDetail!.id, true)}>
                                        {props.applyBusy && props.review?.kind === 'apply' && props.review?.removeAfterApply ? i18n.t('uiCopy.git.applying') : i18n.t('uiCopy.git.applyAndRemove')}
                                      </Button>
                                    </StashActionButton>
                                  </div>

                                  <div
                                    data-git-stash-actions-divider
                                    aria-hidden="true"
                                    class={cn('hidden h-5 w-px shrink-0 sm:block', redevenDividerRoleClass())}
                                  />

                                  <StashActionButton mobile={isMobile()} tooltip={i18n.t('gitStash.deleteTooltip')} disabled={actionsDisabled()}>
                                    <Button size="sm" variant="ghost" class="rounded-md text-destructive hover:text-destructive" icon={Trash} disabled={actionsDisabled()} onClick={() => props.onRequestDrop?.(props.stashDetail!.id)}>
                                      {props.dropBusy ? i18n.t('uiCopy.git.deleting') : i18n.t('common.actions.delete')}
                                    </Button>
                                  </StashActionButton>
                                </div>

                                <Show when={applyReview()}>
                                  <div class="mt-3">
                                    <GitChecklistItem
                                      title={applyReview()?.removeAfterApply ? i18n.t('uiCopy.git.applyAndRemoveTitle') : i18n.t('uiCopy.git.applyTitle')}
                                      detail={reviewBlockingReason()
                                        ? reviewBlockingReason()
                                        : i18n.t('uiCopy.git.confirmApplyDescription')}
                                      tone={reviewBlockingReason() ? 'warning' : 'info'}
                                      complete={!reviewBlockingReason()}
                                      required
                                    >
                                      <Show when={props.reviewError}>
                                        <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.reviewError}</GitSubtleNote>
                                      </Show>
                                      <div class="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" class={cn('rounded-md', redevenSurfaceRoleClass('control'))} onClick={() => props.onCancelReview?.()}>
                                          {i18n.t('common.actions.cancel')}
                                        </Button>
                                        <Button size="sm" variant="default" class="rounded-md" icon={Check} disabled={!canConfirmReview()} loading={Boolean(props.reviewLoading || props.applyBusy || props.dropBusy)} onClick={() => props.onConfirmReview?.()}>
                                          {applyReview()?.removeAfterApply ? i18n.t('uiCopy.git.confirmApplyAndRemove') : i18n.t('uiCopy.git.confirmApply')}
                                        </Button>
                                      </div>
                                    </GitChecklistItem>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
              )}
            >
              {/* Save tab */}
              <div class="flex h-full min-h-0 flex-col overflow-hidden px-2.5 py-2">
                <Show when={!props.contextLoading} fallback={<GitStatePane loading message={i18n.t('uiCopy.git.loadingStashSaveContext')} class="h-full" />}>
                  <Show when={!props.contextError} fallback={<GitStatePane tone="error" message={props.contextError ?? i18n.t('uiCopy.git.failedToLoadStashContext')} class="h-full" />}>
                    <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-2">
                      <div class="w-full max-w-lg space-y-5">
                        {/* Heading */}
                        <div class="text-center">
                          <div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                            <Save class="h-5 w-5 text-primary" aria-hidden="true" />
                          </div>
                          <h2 class="text-sm font-semibold text-foreground">{i18n.t('uiCopy.git.stashCurrentWorkspace')}</h2>
                          <p class="mt-1 text-[11px] text-muted-foreground">
                            <span class="font-medium text-foreground">{i18n.tn('git.common.fileCount', workspaceTotal())}</span> · <span class="font-medium text-foreground">{repoName()}</span>
                            <Show when={(props.repoSummary?.stashCount ?? 0) > 0}>
                              <span> · {props.repoSummary?.stashCount} {i18n.t('git.common.stashes')}</span>
                            </Show>
                          </p>
                        </div>

                        {/* Message input */}
                        <div class="space-y-2">
                          <label class="text-[11px] font-medium text-foreground">{i18n.t('uiCopy.git.stashMessage')}</label>
                          <input
                            type="text"
                            class={cn('w-full rounded-lg border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-shadow focus:ring-2 focus:ring-ring/20', redevenSurfaceRoleClass('control'))}
                            value={props.saveMessage ?? ''}
                            placeholder={i18n.t('uiCopy.git.stashMessagePlaceholder')}
                            onInput={(event) => props.onSaveMessageChange?.(event.currentTarget.value)}
                          />
                        </div>

                        {/* Options */}
                        <div class="space-y-2">
                          <label class={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/[0.10]', redevenSurfaceRoleClass('controlMuted'))}>
                            <input type="checkbox" class="mt-px h-3.5 w-3.5" checked={Boolean(props.includeUntracked)} onChange={(event) => props.onIncludeUntrackedChange?.(event.currentTarget.checked)} />
                            <FileText class="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                            <span class="text-[12px] text-foreground">{i18n.t('uiCopy.git.includeUntracked')}</span>
                          </label>
                          <label class={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/[0.10]', redevenSurfaceRoleClass('controlMuted'))}>
                            <input type="checkbox" class="mt-px h-3.5 w-3.5" checked={Boolean(props.keepIndex)} onChange={(event) => props.onKeepIndexChange?.(event.currentTarget.checked)} />
                            <CheckCircle class="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                            <span class="text-[12px] text-foreground">{i18n.t('uiCopy.git.keepStaged')}</span>
                          </label>
                        </div>

                        <Show when={workspaceTotal() <= 0}>
                          <GitSubtleNote>{i18n.t('uiCopy.git.noLocalChangesToStash')}</GitSubtleNote>
                        </Show>

                        {/* Action */}
                        <div class="flex flex-col gap-2 pt-1">
                          <Button variant="default" class="w-full rounded-lg py-2.5 text-sm font-semibold" icon={Save} disabled={!canSave()} loading={Boolean(props.saveBusy)} onClick={() => props.onSave?.()}>
                            {i18n.t('uiCopy.git.stashChanges')}
                          </Button>
                          <button
                            type="button"
                            class="text-center text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                            onClick={() => props.onTabChange('stashes')}
                          >
                            {i18n.t('uiCopy.git.viewSavedStash')} ({props.stashes.length})
                          </button>
                        </div>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        <GitDiffDialog
          open={diffDialogOpen()}
          onOpenChange={(open) => {
            if (open) {
              setDiffDialogOpen(true);
              return;
            }
            closeDiffDialog();
          }}
          item={diffDialogItem()}
          source={diffDialogItem() && diffDialogStashId() ? {
            kind: 'stash',
            repoRootPath: repoPath(),
            stashId: diffDialogStashId(),
          } : null}
          title={i18n.t('uiCopy.git.stashDiff')}
          description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : i18n.t('uiCopy.git.reviewSelectedStashDiff')}
          emptyMessage={i18n.t('uiCopy.git.selectChangedFile')}
          unavailableMessage={(item) => (item.isBinary ? i18n.t('git.patchViewer.binaryDiffUnavailable') : undefined)}
          errorFormatter={(error) => buildStashPatchErrorState(error, i18n)}
          desktopWindowZIndex={STASH_DIFF_DIALOG_Z_INDEX}
        />
        <GitEntityContextMenu controller={contextMenu} items={contextMenuItems} />
      </PreviewWindow>

      <GitStashDeleteConfirmDialog
        open={deleteReviewOpen()}
        host={floatingSurfaceEl()}
        stash={selectedStash()}
        reviewError={deleteReviewOpen() ? props.reviewError : ''}
        loading={Boolean(props.reviewLoading || props.dropBusy)}
        onClose={() => props.onCancelReview?.()}
        onConfirm={() => props.onConfirmReview?.()}
      />
    </>
  );
}
