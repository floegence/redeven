import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { useDeck, useLayout, useNotification, useResolvedFloeConfig } from '@floegence/floe-webapp-core';
import { KeepAliveStack } from '@floegence/floe-webapp-core/layout';
import { ArrowRightLeft, Copy, Folder, MoreHorizontal, Pencil, Sparkles, Trash } from '@floegence/floe-webapp-core/icons';
import { type ContextMenuCallbacks, type ContextMenuItem, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, ConfirmDialog, DirectoryPicker, Dropdown, FileSavePicker, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import type { Client } from '@floegence/flowersec-core';
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import {
  useRedevenRpc,
  type GitBranchSummary,
  type GitCommitSummary,
  type GitListBranchesResponse,
  type GitListWorkspaceChangesResponse,
  type GitPreviewDeleteBranchResponse,
  type GitPreviewMergeBranchResponse,
  type GitRepoSummaryResponse,
  type GitResolveRepoResponse,
  type GitWorkspaceChange,
  type GitWorkspaceSection,
} from '../protocol/redeven_v1';
import { getExtDot, mimeFromExtDot } from '../utils/filePreview';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { useEnvContext } from '../pages/EnvContext';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import {
  deriveAbsoluteWorkingDirFromItems,
  normalizeAbsolutePath,
} from '../utils/askFlowerPath';
import { copyFileBrowserItemNames, describeCopiedFileBrowserItemNames } from '../utils/fileBrowserClipboard';
import { createClientId } from '../utils/clientId';
import { useFilePreviewContext } from './FilePreviewContext';
import { InputDialog } from './InputDialog';
import { type GitHistoryMode } from './GitHistoryModeSwitch';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { GitWorkspace } from './GitWorkspace';
import {
  applyWorkspaceSectionMutation,
  branchIdentity,
  findGitBranchByKey,
  findWorkspaceChangeByKey,
  isGitWorkspaceSection,
  recountWorkspaceSummary,
  summarizeWorkspaceCount,
  type GitBranchSubview,
  type GitWorkspaceViewSection,
  pickDefaultGitBranch,
  pickDefaultWorkspaceChange,
  pickDefaultWorkspaceViewSection,
  unstageWorkspaceDestination,
  workspaceViewSectionActionKey,
  workspaceViewSectionForItem,
  workspaceViewSectionHasItem,
  workspaceViewSectionItems,
  workspaceEntryKey,
  workspaceMutationPaths,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import { buildGitMutationRefreshPlan, type GitMutationRefreshKind } from '../utils/gitMutationRefresh';
import {
  extNoDot,
  getParentDir,
  insertItemToTree,
  normalizePath,
  removeItemsFromTree,
  rewriteCachePathPrefix,
  rewriteSubtreePaths,
  sortFileItems,
  toFileItem,
  updateItemInTree,
  withChildrenAtRoot,
} from './FileBrowserShared';

type DirCache = Map<string, FileItem[]>;

type PathLoadStatus = 'ok' | 'canceled' | 'invalid_path' | 'permission_denied' | 'transport_error';

type PathLoadResult = {
  status: PathLoadStatus;
  message?: string;
};

type BrowserPageMode = GitHistoryMode;

const ASK_FLOWER_MAX_ATTACHMENTS = 5;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const GIT_COMMIT_PAGE_SIZE = 50;
const PAGE_SIDEBAR_DEFAULT_WIDTH = 240;
const PAGE_SIDEBAR_MIN_WIDTH = 180;
const PAGE_SIDEBAR_MAX_WIDTH = 520;
const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';
const WIDGET_SIDEBAR_WIDTH_STATE_KEY = 'browserSidebarWidth';
const PAGE_MODE_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:page-mode:';
const GIT_SUBVIEW_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:git-subview:';
const SHOW_HIDDEN_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:show-hidden:';
const SHOW_HIDDEN_DROPDOWN_ITEM_ID = 'show-hidden-files';

type GitMutationScope = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'checkout' | 'mergeBranch' | 'deleteBranch' | '';

type GitMutationRepoResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
};

type GitLoadOptions = {
  silent?: boolean;
  repoRootPath?: string;
};

function normalizePageSidebarWidth(width: unknown): number {
  const raw = typeof width === 'number' && Number.isFinite(width) ? width : PAGE_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(PAGE_SIDEBAR_MIN_WIDTH, Math.min(PAGE_SIDEBAR_MAX_WIDTH, Math.round(raw)));
}

function normalizeBrowserPageMode(value: unknown): BrowserPageMode {
  return value === 'git' ? 'git' : 'files';
}

function normalizeGitSubview(value: unknown): GitWorkbenchSubview {
  switch (value) {
    case 'changes':
    case 'branches':
    case 'history':
      return value;
    default:
      return 'changes';
  }
}

function normalizeShowHidden(value: unknown): boolean {
  return value === true;
}

function visibleBrowserPath(path: string, rootPath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath);
  if (normalizedPath === normalizedRoot) return normalizedRoot;
  if (normalizedRoot !== '/' && !normalizedPath.startsWith(`${normalizedRoot}/`)) return normalizedRoot;

  const relativePath = normalizedRoot === '/'
    ? normalizedPath
    : normalizedPath.slice(normalizedRoot.length);
  const parts = relativePath.split('/').filter(Boolean);

  let cursor = normalizedRoot;
  for (const part of parts) {
    if (part.startsWith('.')) return cursor;
    cursor = cursor === '/' ? `/${part}` : `${cursor}/${part}`;
  }

  return normalizedPath;
}

const ClipboardIcon = (props: { class?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class={props.class}>
    <rect width="14" height="16" x="5" y="4" rx="2" />
    <path d="M9 4.5h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v.5a1 1 0 0 0 1 1Z" />
  </svg>
);

export interface RemoteFileBrowserProps {
  widgetId?: string;
  stateScope?: string;
  initialPathOverride?: string;
  homePathOverride?: string;
}

function normalizeBrowserStateScope(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'page';
  return raw.replace(/[^a-z0-9:_-]+/g, '-');
}

function classifyPathLoadError(err: unknown): PathLoadResult {
  if (err instanceof RpcError) {
    if (err.code === 400 || err.code === 404 || err.code === 416) {
      return { status: 'invalid_path', message: err.message };
    }
    if (err.code === 403) {
      return { status: 'permission_denied', message: err.message };
    }
    return { status: 'transport_error', message: err.message };
  }

  if (err instanceof Error) {
    const msg = String(err.message ?? '').trim();
    if (msg) return { status: 'transport_error', message: msg };
    return { status: 'transport_error' };
  }

  const text = String(err ?? '').trim();
  return text ? { status: 'transport_error', message: text } : { status: 'transport_error' };
}

export function RemoteFileBrowser(props: RemoteFileBrowserProps = {}) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const ctx = useEnvContext();
  const deck = useDeck();
  const floe = useResolvedFloeConfig();
  const layout = useLayout();
  const notification = useNotification();
  const filePreview = useFilePreviewContext();

  const envId = () => (ctx.env_id() ?? '').trim();
  const useExternalMobileSidebarToggle = () => !props.widgetId;
  const browserStateScope = () => normalizeBrowserStateScope(props.stateScope);
  const initialPathOverride = () => normalizeAbsolutePath(props.initialPathOverride ?? '');
  const homePathOverride = () => normalizeAbsolutePath(props.homePathOverride ?? '');
  const scopedStorageKey = (key: string): string => (
    browserStateScope() === 'page' ? key : `${key}:${browserStateScope()}`
  );
  const scopedStorageKeyByEnv = (prefix: string, id: string): string => (
    browserStateScope() === 'page' ? `${prefix}:${id}` : `${prefix}:${browserStateScope()}:${id}`
  );
  const workspacePersistenceKey = (id: string): string => (
    browserStateScope() === 'page' ? `files:${id}` : `files:${browserStateScope()}:${id}`
  );
  const workspaceInstanceId = (id: string): string => (
    props.widgetId
      ? `redeven-files:${id}:${props.widgetId}`
      : browserStateScope() === 'page'
        ? `redeven-files:${id}`
        : `redeven-files:${browserStateScope()}:${id}`
  );

  function readPersistedSidebarWidth(): number {
    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      return normalizePageSidebarWidth((state as any)[WIDGET_SIDEBAR_WIDTH_STATE_KEY]);
    }

    return normalizePageSidebarWidth(
      floe.persist.load<number>(scopedStorageKey(PAGE_SIDEBAR_WIDTH_STORAGE_KEY), PAGE_SIDEBAR_DEFAULT_WIDTH)
    );
  }

  function writePersistedSidebarWidth(value: number): void {
    const next = normalizePageSidebarWidth(value);

    if (props.widgetId) {
      deck.updateWidgetState(props.widgetId, WIDGET_SIDEBAR_WIDTH_STATE_KEY, next);
      return;
    }

    floe.persist.debouncedSave(scopedStorageKey(PAGE_SIDEBAR_WIDTH_STORAGE_KEY), next);
  }

  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);

  let cache: DirCache = new Map();

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteDialogItems, setDeleteDialogItems] = createSignal<FileItem[]>([]);
  const [deleteLoading, setDeleteLoading] = createSignal(false);

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [renameDialogItem, setRenameDialogItem] = createSignal<FileItem | null>(null);
  const [renameLoading, setRenameLoading] = createSignal(false);

  const [moveToDialogOpen, setMoveToDialogOpen] = createSignal(false);
  const [moveToDialogItem, setMoveToDialogItem] = createSignal<FileItem | null>(null);
  const [, setMoveToLoading] = createSignal(false);

  const [duplicateLoading, setDuplicateLoading] = createSignal(false);

  const [dragMoveLoading, setDragMoveLoading] = createSignal(false);
  const [fileBrowserResetSeq, setFileBrowserResetSeq] = createSignal(0);

  const [copyToDialogOpen, setCopyToDialogOpen] = createSignal(false);
  const [copyToDialogItem, setCopyToDialogItem] = createSignal<FileItem | null>(null);
  const [, setCopyToLoading] = createSignal(false);

  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('');
  const [lastLoadedBrowserPath, setLastLoadedBrowserPath] = createSignal('');

  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [showHidden, setShowHidden] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<BrowserPageMode>('files');
  const [repoInfo, setRepoInfo] = createSignal<GitResolveRepoResponse | null>(null);
  const [repoInfoLoading, setRepoInfoLoading] = createSignal(false);
  const [repoInfoResolved, setRepoInfoResolved] = createSignal(false);
  const [repoInfoError, setRepoInfoError] = createSignal('');

  const [gitCommits, setGitCommits] = createSignal<GitCommitSummary[]>([]);
  const [gitListLoading, setGitListLoading] = createSignal(false);
  const [gitListLoadingMore, setGitListLoadingMore] = createSignal(false);
  const [gitListError, setGitListError] = createSignal('');
  const [gitListResolved, setGitListResolved] = createSignal(false);
  const [gitHasMore, setGitHasMore] = createSignal(false);
  const [gitNextOffset, setGitNextOffset] = createSignal(0);
  const [gitCommitListRef, setGitCommitListRef] = createSignal('');
  const [selectedCommitHash, setSelectedCommitHash] = createSignal('');
  const [browserSidebarWidth, setBrowserSidebarWidth] = createSignal(readPersistedSidebarWidth());
  const [browserSidebarOpen, setBrowserSidebarOpen] = createSignal(false);
  const [gitSubview, setGitSubview] = createSignal<GitWorkbenchSubview>('changes');
  const [gitRepoSummary, setGitRepoSummary] = createSignal<GitRepoSummaryResponse | null>(null);
  const [gitRepoSummaryLoading, setGitRepoSummaryLoading] = createSignal(false);
  const [gitRepoSummaryError, setGitRepoSummaryError] = createSignal('');
  const [gitWorkspace, setGitWorkspace] = createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [gitWorkspaceLoading, setGitWorkspaceLoading] = createSignal(false);
  const [gitWorkspaceError, setGitWorkspaceError] = createSignal('');
  const [selectedGitWorkspaceSection, setSelectedGitWorkspaceSection] = createSignal<GitWorkspaceViewSection>('changes');
  const [selectedGitWorkspaceKey, setSelectedGitWorkspaceKey] = createSignal('');
  const [gitBranches, setGitBranches] = createSignal<GitListBranchesResponse | null>(null);
  const [gitBranchesLoading, setGitBranchesLoading] = createSignal(false);
  const [gitBranchesError, setGitBranchesError] = createSignal('');
  const [selectedGitBranchName, setSelectedGitBranchName] = createSignal('');
  const [selectedGitBranchSubview, setSelectedGitBranchSubview] = createSignal<GitBranchSubview>('status');
  const [gitCommitMessage, setGitCommitMessage] = createSignal('');
  const [gitMutationScope, setGitMutationScope] = createSignal<GitMutationScope>('');
  const [gitMutationKey, setGitMutationKey] = createSignal('');
  const [gitMergeReviewOpen, setGitMergeReviewOpen] = createSignal(false);
  const [gitMergeReviewBranch, setGitMergeReviewBranch] = createSignal<GitBranchSummary | null>(null);
  const [gitMergeReviewPreview, setGitMergeReviewPreview] = createSignal<GitPreviewMergeBranchResponse | null>(null);
  const [gitMergeReviewLoading, setGitMergeReviewLoading] = createSignal(false);
  const [gitMergeReviewError, setGitMergeReviewError] = createSignal('');
  const [gitMergeActionError, setGitMergeActionError] = createSignal('');
  const [gitDeleteReviewOpen, setGitDeleteReviewOpen] = createSignal(false);
  const [gitDeleteReviewBranch, setGitDeleteReviewBranch] = createSignal<GitBranchSummary | null>(null);
  const [gitDeleteReviewPreview, setGitDeleteReviewPreview] = createSignal<GitPreviewDeleteBranchResponse | null>(null);
  const [gitDeleteReviewLoading, setGitDeleteReviewLoading] = createSignal(false);
  const [gitDeleteReviewError, setGitDeleteReviewError] = createSignal('');
  const [gitDeleteActionError, setGitDeleteActionError] = createSignal('');

  let dirReqSeq = 0;
  let repoReqSeq = 0;
  let gitListReqSeq = 0;
  let gitRepoSummaryReqSeq = 0;
  let gitWorkspaceReqSeq = 0;
  let gitBranchesReqSeq = 0;
  let gitMergeReviewReqSeq = 0;
  let gitDeleteReviewReqSeq = 0;
  let lastGitCommitContextKey = '';
  let lastGitRepoKey = '';

  const resetFileBrowser = () => {
    setFileBrowserResetSeq((value) => value + 1);
  };

  const clearDirectoryState = () => {
    dirReqSeq += 1;
    cache = new Map();
    setFiles([]);
    setLoading(false);
    setLastLoadedBrowserPath('');
  };

  const readPersistedLastPath = (id: string): string => {
    const eid = id.trim();
    if (!eid) return '';
    const override = initialPathOverride();
    if (override) return override;

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).lastPathByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        const saved = (byEnv as any)[eid];
        if (typeof saved === 'string' && saved.trim()) return normalizePath(saved);
      }
      return '';
    }

    const saved = floe.persist.load<string>(scopedStorageKeyByEnv('files:lastPath', eid), '');
    return saved ? normalizePath(saved) : '';
  };

  const writePersistedLastPath = (id: string, path: string) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizePath(path);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).lastPathByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, string>)
          : {};
      deck.updateWidgetState(props.widgetId, 'lastPathByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(scopedStorageKeyByEnv('files:lastPath', eid), next);
  };

  const readPersistedTargetPath = (id: string): string | null => {
    const eid = id.trim();
    if (!eid) return null;

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).lastTargetPathByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        const saved = (byEnv as any)[eid];
        if (typeof saved === 'string' && saved.trim()) return normalizePath(saved);
      }
      return null;
    }

    const saved = floe.persist.load<string>(scopedStorageKeyByEnv('files:lastTargetPath', eid), '');
    return saved ? normalizePath(saved) : null;
  };

  const writePersistedTargetPath = (id: string, path: string) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizePath(path);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).lastTargetPathByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, string>)
          : {};
      deck.updateWidgetState(props.widgetId, 'lastTargetPathByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(scopedStorageKeyByEnv('files:lastTargetPath', eid), next);
  };

  const readPersistedShowHidden = (id: string): boolean => {
    const eid = id.trim();
    if (!eid) return false;

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).showHiddenByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        return normalizeShowHidden((byEnv as any)[eid]);
      }
      return false;
    }

    return normalizeShowHidden(floe.persist.load<boolean>(scopedStorageKey(`${SHOW_HIDDEN_STORAGE_KEY_PREFIX}${eid}`), false));
  };

  const writePersistedShowHidden = (id: string, value: boolean) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizeShowHidden(value);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).showHiddenByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, boolean>)
          : {};
      deck.updateWidgetState(props.widgetId, 'showHiddenByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(scopedStorageKey(`${SHOW_HIDDEN_STORAGE_KEY_PREFIX}${eid}`), next);
  };


  const readPersistedPageMode = (id: string): BrowserPageMode => {
    const eid = id.trim();
    if (!eid) return 'files';

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).pageModeByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        return normalizeBrowserPageMode((byEnv as any)[eid]);
      }
      return 'files';
    }

    return normalizeBrowserPageMode(floe.persist.load<string>(scopedStorageKey(`${PAGE_MODE_STORAGE_KEY_PREFIX}${eid}`), 'files'));
  };

  const writePersistedPageMode = (id: string, mode: BrowserPageMode) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizeBrowserPageMode(mode);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).pageModeByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, BrowserPageMode>)
          : {};
      deck.updateWidgetState(props.widgetId, 'pageModeByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(scopedStorageKey(`${PAGE_MODE_STORAGE_KEY_PREFIX}${eid}`), next);
  };

  const readPersistedGitSubview = (id: string): GitWorkbenchSubview => {
    const eid = id.trim();
    if (!eid) return 'changes';

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).gitSubviewByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        return normalizeGitSubview((byEnv as any)[eid]);
      }
      return 'changes';
    }

    return normalizeGitSubview(floe.persist.load<string>(scopedStorageKey(`${GIT_SUBVIEW_STORAGE_KEY_PREFIX}${eid}`), 'changes'));
  };

  const writePersistedGitSubview = (id: string, view: GitWorkbenchSubview) => {
    const eid = id.trim();
    if (!eid) return;
    const next = normalizeGitSubview(view);

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const prevRaw = (state as any).gitSubviewByEnv;
      const prev =
        prevRaw && typeof prevRaw === 'object' && !Array.isArray(prevRaw)
          ? (prevRaw as Record<string, GitWorkbenchSubview>)
          : {};
      deck.updateWidgetState(props.widgetId, 'gitSubviewByEnv', { ...prev, [eid]: next });
      return;
    }

    floe.persist.debouncedSave(scopedStorageKey(`${GIT_SUBVIEW_STORAGE_KEY_PREFIX}${eid}`), next);
  };

  const commitBrowserSidebarWidth = (value: number) => {
    const next = normalizePageSidebarWidth(value);
    setBrowserSidebarWidth(next);
    writePersistedSidebarWidth(next);
  };

  const resolveFsRootAbs = async (): Promise<string> => {
    const override = homePathOverride();
    if (override) {
      setAgentHomePathAbs(override);
      return override;
    }

    const cached = normalizeAbsolutePath(agentHomePathAbs());
    if (cached) return cached;

    const resp = await rpc.fs.getPathContext();
    const root = normalizeAbsolutePath(String(resp?.agentHomePathAbs ?? '').trim());
    if (!root) {
      throw new Error('Failed to resolve home directory.');
    }
    setAgentHomePathAbs(root);
    return root;
  };

  const repoHistoryAvailable = () => Boolean(repoInfo()?.available && repoInfo()?.repoRootPath);
  const gitShellLoadingMessage = createMemo(() => {
    if (pageMode() !== 'git') return '';
    if (repoInfoLoading()) return 'Checking repository...';
    if (!repoHistoryAvailable()) return '';
    if (gitSubview() === 'changes') {
      return !gitWorkspace() && !gitWorkspaceError() ? 'Loading workspace changes...' : '';
    }
    if (gitSubview() === 'branches') {
      if (!gitBranches() && !gitBranchesError()) return 'Loading branches...';
      if (selectedGitBranchSubview() === 'history' && gitBranches() && !gitListResolved() && !gitListError()) {
        return 'Loading commit history...';
      }
      return '';
    }
    if (gitSubview() === 'history') {
      return !gitListResolved() && !gitListError() ? 'Loading commits...' : '';
    }
    return '';
  });

  const resolveActiveRepoRootPath = (overridePath?: string): string => {
    const candidate = String(overridePath ?? repoInfo()?.repoRootPath ?? '').trim();
    return candidate;
  };

  const resolveRepoInfo = async (path: string = currentBrowserPath(), options: { silent?: boolean } = {}): Promise<GitResolveRepoResponse | null> => {
    const client = protocol.client();
    if (!client) {
      repoReqSeq += 1;
      setRepoInfo(null);
      setRepoInfoLoading(false);
      setRepoInfoResolved(false);
      setRepoInfoError('');
      return null;
    }

    const seq = ++repoReqSeq;
    if (!options.silent) {
      setRepoInfoLoading(true);
      setRepoInfoResolved(false);
      setRepoInfoError('');
    }
    try {
      const resp = await rpc.git.resolveRepo({ path: normalizePath(path) });
      if (seq !== repoReqSeq) return null;
      const nextInfo: GitResolveRepoResponse = resp?.available
        ? {
            available: true,
            repoRootPath: resp.repoRootPath,
            headRef: resp.headRef,
            headCommit: resp.headCommit,
            dirty: resp.dirty,
          }
        : { available: false };
      setRepoInfo(nextInfo);
      return nextInfo;
    } catch (err) {
      if (seq !== repoReqSeq) return null;
      const result = classifyPathLoadError(err);
      if (!options.silent) {
        if (result.status === 'invalid_path') {
          setRepoInfo({ available: false });
          setRepoInfoError('');
        } else {
          setRepoInfo(null);
          setRepoInfoError(result.message ?? 'Failed to inspect Git repository.');
        }
      } else {
        notification.warning('Git refresh incomplete', result.message ?? 'Failed to inspect the updated repository state.');
      }
      return null;
    } finally {
      if (!options.silent && seq === repoReqSeq) {
        setRepoInfoLoading(false);
        setRepoInfoResolved(true);
      }
    }
  };

  const resetGitCommitSidebar = () => {
    gitListReqSeq += 1;
    lastGitCommitContextKey = '';
    setGitCommitListRef('');
    setGitCommits([]);
    setGitListLoading(false);
    setGitListLoadingMore(false);
    setGitListError('');
    setGitListResolved(false);
    setGitHasMore(false);
    setGitNextOffset(0);
    setSelectedCommitHash('');
  };

  const resetGitWorkbenchData = () => {
    gitRepoSummaryReqSeq += 1;
    gitWorkspaceReqSeq += 1;
    gitBranchesReqSeq += 1;
    gitMergeReviewReqSeq += 1;
    gitDeleteReviewReqSeq += 1;
    lastGitRepoKey = '';
    setGitRepoSummary(null);
    setGitRepoSummaryLoading(false);
    setGitRepoSummaryError('');
    setGitWorkspace(null);
    setGitWorkspaceLoading(false);
    setGitWorkspaceError('');
    setSelectedGitWorkspaceSection('changes');
    setSelectedGitWorkspaceKey('');
    setGitBranches(null);
    setGitBranchesLoading(false);
    setGitBranchesError('');
    setSelectedGitBranchName('');
    setSelectedGitBranchSubview('status');
    setGitCommitMessage('');
    setGitMutationScope('');
    setGitMutationKey('');
    setGitMergeReviewOpen(false);
    setGitMergeReviewBranch(null);
    setGitMergeReviewPreview(null);
    setGitMergeReviewLoading(false);
    setGitMergeReviewError('');
    setGitMergeActionError('');
    setGitDeleteReviewOpen(false);
    setGitDeleteReviewBranch(null);
    setGitDeleteReviewPreview(null);
    setGitDeleteReviewLoading(false);
    setGitDeleteReviewError('');
    setGitDeleteActionError('');
  };

  const selectedGitWorkspaceItem = () => findWorkspaceChangeByKey(gitWorkspace(), selectedGitWorkspaceKey());

  const selectedGitBranch = () => findGitBranchByKey(gitBranches(), selectedGitBranchName());

  const applyWorkspaceSnapshot = (nextWorkspace: GitListWorkspaceChangesResponse | null | undefined) => {
    if (!nextWorkspace) return;
    setGitWorkspace(nextWorkspace);
    setGitRepoSummary((prev) => (prev ? { ...prev, workspaceSummary: nextWorkspace.summary } : prev));
    setRepoInfo((prev) => (prev ? { ...prev, dirty: summarizeWorkspaceCount(nextWorkspace.summary) > 0 } : prev));

    const nextSection = selectedGitWorkspaceSection() || pickDefaultWorkspaceViewSection(nextWorkspace);
    setSelectedGitWorkspaceSection(nextSection);
    const currentKey = selectedGitWorkspaceKey();
    const scopedCurrentItem = findWorkspaceChangeByKey(nextWorkspace, currentKey);
    const nextItem = workspaceViewSectionHasItem(nextSection, scopedCurrentItem)
      ? scopedCurrentItem
      : workspaceViewSectionItems(nextWorkspace, nextSection)[0] ?? pickDefaultWorkspaceChange(nextWorkspace);
    setSelectedGitWorkspaceKey(workspaceEntryKey(nextItem));
  };

  const selectGitWorkspaceItem = (item: GitWorkspaceChange | null | undefined) => {
    setSelectedGitWorkspaceSection(workspaceViewSectionForItem(item));
    setSelectedGitWorkspaceKey(workspaceEntryKey(item));
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const focusGitWorkspaceSection = (section: GitWorkspaceViewSection, workspace = gitWorkspace()) => {
    setGitSubview('changes');
    setSelectedGitWorkspaceSection(section);
    const firstItem = workspaceViewSectionItems(workspace, section)[0] ?? null;
    setSelectedGitWorkspaceKey(workspaceEntryKey(firstItem));
  };

  const selectGitWorkspaceSection = (section: GitWorkspaceViewSection) => {
    setSelectedGitWorkspaceSection(section);
    const firstItem = workspaceViewSectionItems(gitWorkspace(), section)[0] ?? null;
    setSelectedGitWorkspaceKey(workspaceEntryKey(firstItem));
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const selectGitBranch = (branch: GitBranchSummary | null | undefined) => {
    setSelectedGitBranchName(branchIdentity(branch));
    setSelectedGitBranchSubview('status');
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const selectGitBranchSubview = (view: GitBranchSubview) => {
    setSelectedGitBranchSubview(view);
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const selectGitCommit = (hash: string) => {
    setSelectedCommitHash(hash);
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const busyWorkspaceAction = (): 'stage' | 'unstage' | '' => {
    const scope = gitMutationScope();
    return scope === 'stage' || scope === 'unstage' ? scope : '';
  };

  const formatGitFileCountLabel = (count: number): string => (count === 1 ? '1 file' : `${count} files`);

  const runGitMutation = async <T,>(
    scope: GitMutationScope,
    key: string,
    action: () => Promise<T>,
    onSuccess: (result: T) => void,
  ) => {
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return false;
    }
    setGitMutationScope(scope);
    setGitMutationKey(key);
    try {
      const result = await action();
      onSuccess(result);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'Request failed.');
      const title = scope === 'commit'
        ? 'Commit failed'
        : scope === 'stage'
          ? 'Stage failed'
          : scope === 'unstage'
            ? 'Unstage failed'
            : scope === 'fetch'
              ? 'Fetch failed'
              : scope === 'pull'
                ? 'Pull failed'
                : scope === 'push'
                ? 'Push failed'
                : scope === 'checkout'
                  ? 'Checkout failed'
                  : scope === 'mergeBranch'
                    ? 'Merge failed'
                  : scope === 'deleteBranch'
                    ? 'Delete failed'
                    : 'Git request failed';
      notification.error(title, message || 'Request failed.');
      return false;
    } finally {
      setGitMutationScope('');
      setGitMutationKey('');
    }
  };

  const handleStageWorkspacePaths = async (sourceSections: GitWorkspaceSection[], paths: string[], key: string, count: number) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    const uniqueSourceSections = Array.from(new Set(sourceSections));
    await runGitMutation(
      'stage',
      key,
      () => rpc.git.stageWorkspace({ repoRootPath, paths: paths.length > 0 ? paths : undefined }),
      () => {
        const nextWorkspace = uniqueSourceSections.reduce(
          (workspace, sourceSection) => applyWorkspaceSectionMutation(workspace, {
            sourceSection,
            paths,
            destinationSection: 'staged',
          }),
          gitWorkspace(),
        );
        applyWorkspaceSnapshot(nextWorkspace);
        notification.success(
          uniqueSourceSections.length === 1 && uniqueSourceSections[0] === 'untracked' ? 'Tracked' : 'Staged',
          `${formatGitFileCountLabel(count)} moved into the index.`,
        );
      },
    );
  };

  const handleUnstageWorkspacePaths = async (paths: string[], key: string, count: number) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'unstage',
      key,
      () => rpc.git.unstageWorkspace({ repoRootPath, paths: paths.length > 0 ? paths : undefined }),
      () => {
        const nextWorkspace = applyWorkspaceSectionMutation(gitWorkspace(), {
          sourceSection: 'staged',
          paths,
          destinationSection: (item) => unstageWorkspaceDestination(item),
        });
        applyWorkspaceSnapshot(nextWorkspace);
        notification.success('Unstaged', `${formatGitFileCountLabel(count)} moved back to pending changes.`);
      },
    );
  };

  const handleStageWorkspaceItem = (item: GitWorkspaceChange) => {
    const sourceSection = isGitWorkspaceSection(item.section) ? item.section : 'unstaged';
    setSelectedGitWorkspaceSection(workspaceViewSectionForItem(item));
    void handleStageWorkspacePaths([sourceSection], workspaceMutationPaths(item), workspaceEntryKey(item), 1);
  };

  const handleUnstageWorkspaceItem = (item: GitWorkspaceChange) => void handleUnstageWorkspacePaths(workspaceMutationPaths(item), workspaceEntryKey(item), 1);

  const handleBulkWorkspaceAction = (section: GitWorkspaceViewSection) => {
    const items = workspaceViewSectionItems(gitWorkspace(), section);
    if (items.length === 0) return;
    setSelectedGitWorkspaceSection(section);
    const paths = Array.from(new Set(items.flatMap((item) => workspaceMutationPaths(item))));
    if (section === 'staged') {
      void handleUnstageWorkspacePaths(paths, workspaceViewSectionActionKey(section), items.length);
      return;
    }
    const sourceSections = section === 'changes'
      ? Array.from(new Set(items.map((item) => (isGitWorkspaceSection(item.section) ? item.section : 'unstaged'))))
      : [section];
    void handleStageWorkspacePaths(sourceSections, paths, workspaceViewSectionActionKey(section), items.length);
  };

  const handleCommitWorkspace = async (message: string) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const trimmed = String(message ?? '').trim();
    if (!repoRootPath) return;
    if (!trimmed) {
      notification.error('Missing commit message', 'Write a commit message before committing staged changes.');
      return;
    }
    await runGitMutation(
      'commit',
      'commit',
      () => rpc.git.commitWorkspace({ repoRootPath, message: trimmed }),
      (resp) => {
        const currentWorkspace = gitWorkspace();
        if (currentWorkspace) {
          const nextWorkspace = {
            ...currentWorkspace,
            staged: [],
            summary: recountWorkspaceSummary({
              ...currentWorkspace,
              staged: [],
            }),
          };
          applyWorkspaceSnapshot(nextWorkspace);
        }
        setGitRepoSummary((prev) => (prev
          ? {
            ...prev,
            headRef: resp.headRef ?? prev.headRef,
            headCommit: resp.headCommit ?? prev.headCommit,
          }
          : prev));
        setRepoInfo((prev) => (prev
          ? {
            ...prev,
            headRef: resp.headRef ?? prev.headRef,
            headCommit: resp.headCommit ?? prev.headCommit,
          }
          : prev));
        setGitCommitMessage('');
        void refreshGitStateAfterMutation('commit', resp);
        notification.success('Committed', `${resp.headRef || 'HEAD'} ${String(resp.headCommit ?? '').slice(0, 7)}`.trim());
      },
    );
  };

  const currentGitCommitRef = (): string => {
    if (gitSubview() === 'branches' && selectedGitBranchSubview() === 'history') {
      return String(selectedGitBranch()?.name ?? '').trim();
    }
    return '';
  };

  const applyGitMutationRepoState = (resp: GitMutationRepoResponse) => {
    const repoRootPath = String(resp.repoRootPath ?? '').trim() || resolveActiveRepoRootPath();
    const nextHeadRef = typeof resp.headRef === 'string' ? resp.headRef : undefined;
    const nextHeadCommit = typeof resp.headCommit === 'string' ? resp.headCommit : undefined;
    const nextRepoKey = repoRootPath ? `${repoRootPath}|${nextHeadCommit ?? (repoInfo()?.headCommit ?? '')}` : '';

    if (nextRepoKey) {
      lastGitRepoKey = nextRepoKey;
    }

    setRepoInfo((prev) => (prev
      ? {
        ...prev,
        available: true,
        repoRootPath: repoRootPath || prev.repoRootPath,
        headRef: nextHeadRef ?? prev.headRef,
        headCommit: nextHeadCommit ?? prev.headCommit,
      }
      : prev));

    setGitRepoSummary((prev) => (prev
      ? {
        ...prev,
        repoRootPath: repoRootPath || prev.repoRootPath,
        headRef: nextHeadRef ?? prev.headRef,
        headCommit: nextHeadCommit ?? prev.headCommit,
      }
      : prev));
  };

  const refreshGitStateAfterMutation = async (kind: GitMutationRefreshKind, resp: GitMutationRepoResponse) => {
    applyGitMutationRepoState(resp);

    const repoRootPath = String(resp.repoRootPath ?? '').trim() || resolveActiveRepoRootPath();
    if (!repoRootPath) return;

    const plan = buildGitMutationRefreshPlan(kind, {
      subview: gitSubview(),
      branchSubview: selectedGitBranchSubview(),
    });

    const refreshes: Array<Promise<unknown>> = [];
    if (plan.refreshRepoSummary) {
      refreshes.push(loadGitRepoSummary({ silent: true, repoRootPath }));
    }
    if (plan.refreshWorkspace) {
      refreshes.push(loadGitWorkspace({ silent: true, repoRootPath }));
    }
    if (plan.refreshBranches) {
      refreshes.push(loadGitBranches({ silent: true, repoRootPath }));
    }
    await Promise.all(refreshes);

    if (plan.refreshCommits) {
      lastGitCommitContextKey = '';
      await loadGitCommits(true, currentGitCommitRef(), { silent: true, repoRootPath });
    }
  };

  const handleFetchRepo = async () => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'fetch',
      'repo:fetch',
      () => rpc.git.fetchRepo({ repoRootPath }),
      (resp) => {
        void refreshGitStateAfterMutation('fetch', resp);
        notification.success('Fetched', 'Remote refs were updated.');
      },
    );
  };

  const handlePullRepo = async () => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'pull',
      'repo:pull',
      () => rpc.git.pullRepo({ repoRootPath }),
      (resp) => {
        void refreshGitStateAfterMutation('pull', resp);
        notification.success('Pulled', `${resp.headRef || 'HEAD'} ${String(resp.headCommit ?? '').slice(0, 7)}`.trim());
      },
    );
  };

  const handlePushRepo = async () => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'push',
      'repo:push',
      () => rpc.git.pushRepo({ repoRootPath }),
      (resp) => {
        void refreshGitStateAfterMutation('push', resp);
        notification.success('Pushed', `${resp.headRef || 'HEAD'} ${String(resp.headCommit ?? '').slice(0, 7)}`.trim());
      },
    );
  };

  const handleCheckoutBranch = async (branch: GitBranchSummary) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'checkout',
      branchIdentity(branch),
      () => rpc.git.checkoutBranch({
        repoRootPath,
        name: branch.name,
        fullName: branch.fullName,
        kind: branch.kind,
      }),
      (resp) => {
        void refreshGitStateAfterMutation('checkout', resp);
        notification.success('Checked out', `${resp.headRef || branch.name || 'branch'} is now active.`);
      },
    );
  };

  const gitMergeDialogState = (): 'idle' | 'previewing' | 'merging' => {
    if (gitMergeReviewLoading()) return 'previewing';
    if (gitMutationScope() === 'mergeBranch' && gitMutationKey() === branchIdentity(gitMergeReviewBranch())) {
      return 'merging';
    }
    return 'idle';
  };

  const closeGitMergeReview = (options: { force?: boolean } = {}) => {
    if (!options.force && gitMergeDialogState() === 'merging') return;
    gitMergeReviewReqSeq += 1;
    setGitMergeReviewOpen(false);
    setGitMergeReviewBranch(null);
    setGitMergeReviewPreview(null);
    setGitMergeReviewLoading(false);
    setGitMergeReviewError('');
    setGitMergeActionError('');
  };

  const handleMergeBranch = async (branch: GitBranchSummary) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return;
    }

    const seq = ++gitMergeReviewReqSeq;
    setGitMergeReviewOpen(true);
    setGitMergeReviewBranch(branch);
    setGitMergeReviewPreview(null);
    setGitMergeReviewError('');
    setGitMergeActionError('');
    setGitMergeReviewLoading(true);

    try {
      const resp = await rpc.git.previewMergeBranch({
        repoRootPath,
        name: branch.name,
        fullName: branch.fullName,
        kind: branch.kind,
      });
      if (seq !== gitMergeReviewReqSeq) return;
      setGitMergeReviewPreview(resp);
    } catch (err) {
      if (seq !== gitMergeReviewReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to review branch merge.');
      setGitMergeReviewPreview(null);
      setGitMergeReviewError(message);
    } finally {
      if (seq === gitMergeReviewReqSeq) setGitMergeReviewLoading(false);
    }
  };

  const gitDeleteDialogState = (): 'idle' | 'previewing' | 'deleting' => {
    if (gitDeleteReviewLoading()) return 'previewing';
    if (gitMutationScope() === 'deleteBranch' && gitMutationKey() === branchIdentity(gitDeleteReviewBranch())) {
      return 'deleting';
    }
    return 'idle';
  };

  const closeGitDeleteReview = (options: { force?: boolean } = {}) => {
    if (!options.force && gitDeleteDialogState() === 'deleting') return;
    gitDeleteReviewReqSeq += 1;
    setGitDeleteReviewOpen(false);
    setGitDeleteReviewBranch(null);
    setGitDeleteReviewPreview(null);
    setGitDeleteReviewLoading(false);
    setGitDeleteReviewError('');
    setGitDeleteActionError('');
  };

  const handleDeleteBranch = async (branch: GitBranchSummary) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return;
    }

    const seq = ++gitDeleteReviewReqSeq;
    setGitDeleteReviewOpen(true);
    setGitDeleteReviewBranch(branch);
    setGitDeleteReviewPreview(null);
    setGitDeleteReviewError('');
    setGitDeleteActionError('');
    setGitDeleteReviewLoading(true);

    try {
      const resp = await rpc.git.previewDeleteBranch({
        repoRootPath,
        name: branch.name,
        fullName: branch.fullName,
        kind: branch.kind,
      });
      if (seq !== gitDeleteReviewReqSeq) return;
      setGitDeleteReviewPreview(resp);
    } catch (err) {
      if (seq !== gitDeleteReviewReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to review branch deletion.');
      setGitDeleteReviewPreview(null);
      setGitDeleteReviewError(message);
    } finally {
      if (seq === gitDeleteReviewReqSeq) setGitDeleteReviewLoading(false);
    }
  };

  const refreshGitStateAfterBranchDelete = async (resp: GitMutationRepoResponse) => {
    applyGitMutationRepoState(resp);

    const repoRootPath = String(resp.repoRootPath ?? '').trim() || resolveActiveRepoRootPath();
    if (!repoRootPath) return;

    const branchesResp = await loadGitBranches({ silent: true, repoRootPath });
    if (gitSubview() !== 'branches' || selectedGitBranchSubview() !== 'history') {
      return;
    }

    const nextBranches = branchesResp ?? gitBranches();
    const nextBranch = findGitBranchByKey(nextBranches, selectedGitBranchName()) ?? pickDefaultGitBranch(nextBranches);
    const nextRef = String(nextBranch?.name ?? '').trim();
    lastGitCommitContextKey = '';
    if (!nextRef) {
      resetGitCommitSidebar();
      return;
    }
    await loadGitCommits(true, nextRef, { silent: true, repoRootPath });
  };

  const handleConfirmMergeBranch = async (
    branch: GitBranchSummary,
    options: {
      planFingerprint?: string;
    },
  ) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return;
    }

    setGitMergeActionError('');
    setGitMutationScope('mergeBranch');
    setGitMutationKey(branchIdentity(branch));
    try {
      const resp = await rpc.git.mergeBranch({
        repoRootPath,
        name: branch.name,
        fullName: branch.fullName,
        kind: branch.kind,
        planFingerprint: options.planFingerprint,
      });
      closeGitMergeReview({ force: true });
      void refreshGitStateAfterMutation('merge', resp);

      const targetRef = resp.headRef || String(gitRepoSummary()?.headRef ?? '').trim() || 'current branch';
      if (resp.result === 'up_to_date') {
        notification.info('Up to date', `${targetRef} already includes ${branch.name || 'the selected branch'}.`);
        return;
      }
      if (resp.result === 'fast_forward') {
        notification.success('Fast-forwarded', `${targetRef} now includes ${branch.name || 'the selected branch'}.`);
        return;
      }
      if (resp.result === 'merge_commit') {
        notification.success('Merged', `${branch.name || 'Branch'} was merged into ${targetRef}.`);
        return;
      }

      const nextWorkspace = await loadGitWorkspace({ silent: true, repoRootPath }) ?? gitWorkspace();
      focusGitWorkspaceSection('conflicted', nextWorkspace);
      notification.warning('Merge has conflicts', `Resolve the conflicted files in ${targetRef}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'Request failed.');
      if (message.toLowerCase().includes('stale')) {
        setGitMergeReviewPreview(null);
        setGitMergeReviewError(message);
      } else {
        setGitMergeActionError(message);
      }
      notification.error('Merge failed', message || 'Request failed.');
    } finally {
      setGitMutationScope('');
      setGitMutationKey('');
    }
  };

  const handleConfirmDeleteBranch = async (
    branch: GitBranchSummary,
    options: {
      removeLinkedWorktree: boolean;
      discardLinkedWorktreeChanges: boolean;
      planFingerprint?: string;
    },
  ) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return;
    }

    setGitDeleteActionError('');
    setGitMutationScope('deleteBranch');
    setGitMutationKey(branchIdentity(branch));
    try {
      const resp = await rpc.git.deleteBranch({
        repoRootPath,
        name: branch.name,
        fullName: branch.fullName,
        kind: branch.kind,
        removeLinkedWorktree: options.removeLinkedWorktree,
        discardLinkedWorktreeChanges: options.discardLinkedWorktreeChanges,
        planFingerprint: options.planFingerprint,
      });
      closeGitDeleteReview({ force: true });
      void refreshGitStateAfterBranchDelete(resp);
      notification.success('Deleted', `${branch.name || 'Branch'} was removed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? 'Request failed.');
      if (message.toLowerCase().includes('stale')) {
        setGitDeleteReviewPreview(null);
        setGitDeleteReviewError(message);
      } else {
        setGitDeleteActionError(message);
      }
      notification.error('Delete failed', message || 'Request failed.');
    } finally {
      setGitMutationScope('');
      setGitMutationKey('');
    }
  };

  const loadGitRepoSummary = async (options: GitLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitRepoSummaryReqSeq;
    if (!options.silent) {
      setGitRepoSummaryLoading(true);
      setGitRepoSummaryError('');
    }
    try {
      const resp = await rpc.git.getRepoSummary({ repoRootPath });
      if (seq !== gitRepoSummaryReqSeq) return;
      setGitRepoSummary(resp);
      return resp;
    } catch (err) {
      if (seq !== gitRepoSummaryReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load repository summary');
      if (!options.silent) {
        setGitRepoSummary(null);
        setGitRepoSummaryError(message);
      } else {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === gitRepoSummaryReqSeq) setGitRepoSummaryLoading(false);
    }
  };

  const loadGitWorkspace = async (options: GitLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitWorkspaceReqSeq;
    if (!options.silent) {
      setGitWorkspaceLoading(true);
      setGitWorkspaceError('');
    }
    try {
      const resp = await rpc.git.listWorkspaceChanges({ repoRootPath });
      if (seq !== gitWorkspaceReqSeq) return;
      applyWorkspaceSnapshot(resp);
      return resp;
    } catch (err) {
      if (seq !== gitWorkspaceReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load workspace changes');
      if (!options.silent) {
        setGitWorkspace(null);
        setSelectedGitWorkspaceSection('changes');
        setSelectedGitWorkspaceKey('');
        setGitWorkspaceError(message);
      } else {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === gitWorkspaceReqSeq) setGitWorkspaceLoading(false);
    }
  };

  const loadGitBranches = async (options: GitLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitBranchesReqSeq;
    if (!options.silent) {
      setGitBranchesLoading(true);
      setGitBranchesError('');
    }
    try {
      const resp = await rpc.git.listBranches({ repoRootPath });
      if (seq !== gitBranchesReqSeq) return;
      setGitBranches(resp);
      const currentKey = selectedGitBranchName();
      const nextBranch = findGitBranchByKey(resp, currentKey) ?? pickDefaultGitBranch(resp);
      setSelectedGitBranchName(branchIdentity(nextBranch));
      setSelectedGitBranchSubview((prev) => (prev === 'history' ? 'history' : 'status'));
      return resp;
    } catch (err) {
      if (seq !== gitBranchesReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load branches');
      if (!options.silent) {
        setGitBranches(null);
        setSelectedGitBranchName('');
        setGitBranchesError(message);
      } else {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === gitBranchesReqSeq) setGitBranchesLoading(false);
    }
  };

  const refreshGitWorkbench = async () => {
    const nextInfo = await resolveRepoInfo(currentBrowserPath(), { silent: Boolean(repoInfo()) });
    if (!nextInfo?.available) {
      resetGitCommitSidebar();
      resetGitWorkbenchData();
      return;
    }
    lastGitRepoKey = '';
    lastGitCommitContextKey = '';
    void loadGitRepoSummary({ silent: Boolean(gitRepoSummary()) });
    if (gitSubview() === 'changes') {
      void loadGitWorkspace({ silent: Boolean(gitWorkspace()) });
    }
    if (gitSubview() === 'branches') {
      void loadGitBranches({ silent: Boolean(gitBranches()) });
    }
    if (gitSubview() === 'history' || (gitSubview() === 'branches' && selectedGitBranchSubview() === 'history')) {
      void loadGitCommits(true, currentGitCommitRef(), { silent: gitCommits().length > 0 });
    }
  };

  const loadGitCommits = async (reset: boolean, ref = gitCommitListRef(), options: GitLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitListReqSeq;
    const nextRef = String(ref ?? '').trim();
    if (!options.silent) {
      setGitListError('');
      if (reset) {
        setGitCommitListRef(nextRef);
        setGitListLoading(true);
        setGitListResolved(false);
      } else {
        setGitListLoadingMore(true);
      }
    }
    try {
      const resp = await rpc.git.listCommits({
        repoRootPath,
        ref: nextRef || undefined,
        offset: reset ? 0 : gitNextOffset(),
        limit: GIT_COMMIT_PAGE_SIZE,
      });
      if (seq !== gitListReqSeq) return;
      const nextItems = Array.isArray(resp?.commits) ? resp.commits : [];
      if (reset) {
        setGitCommits(nextItems);
        setGitListResolved(true);
      } else {
        const seen = new Set(gitCommits().map((item) => item.hash));
        setGitCommits([...gitCommits(), ...nextItems.filter((item) => !seen.has(item.hash))]);
      }
      setGitHasMore(Boolean(resp?.hasMore));
      setGitNextOffset(Number(resp?.nextOffset ?? 0));
      const allItems = reset ? nextItems : gitCommits();
      const current = selectedCommitHash();
      if (current && !allItems.some((item) => item.hash === current)) {
        setSelectedCommitHash('');
      }
      if (reset) {
        setGitCommitListRef(nextRef);
      }
      return resp;
    } catch (err) {
      if (seq !== gitListReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load commits');
      if (!options.silent) {
        setGitListError(message);
      } else {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === gitListReqSeq) {
        setGitListLoading(false);
        setGitListLoadingMore(false);
      }
    }
  };

  const canEnterGitHistory = () => repoHistoryAvailable() && !repoInfoLoading();
  const mobileSidebarOpen = () => (useExternalMobileSidebarToggle() ? ctx.filesSidebarOpen() : browserSidebarOpen());
  const setMobileSidebarOpen = (open: boolean) => {
    if (useExternalMobileSidebarToggle()) {
      ctx.setFilesSidebarOpen(open);
      return;
    }
    setBrowserSidebarOpen(open);
  };
  const closePageSidebar = () => setMobileSidebarOpen(false);
  const togglePageSidebar = () => setMobileSidebarOpen(!mobileSidebarOpen());
  const pageSidebarOpen = () => !layout.isMobile() || mobileSidebarOpen();

  const setBrowserPageMode = (mode: BrowserPageMode) => {
    const next = normalizeBrowserPageMode(mode);
    setPageMode(next);
    const id = envId();
    if (id) {
      writePersistedPageMode(id, next);
    }
  };

  const handlePageModeChange = (mode: BrowserPageMode) => {
    if (mode === 'git' && !canEnterGitHistory()) {
      return;
    }
    setBrowserPageMode(mode);
  };

  const handleGitSubviewChange = (view: GitWorkbenchSubview) => {
    const next = normalizeGitSubview(view);
    setGitSubview(next);
    const id = envId();
    if (id) {
      writePersistedGitSubview(id, next);
    }
  };

  const fileBrowserMoreItems = createMemo<DropdownItem[]>(() => [
    {
      id: SHOW_HIDDEN_DROPDOWN_ITEM_ID,
      label: 'Show hidden files',
    },
  ]);

  const handleFileBrowserMoreSelect = (itemId: string) => {
    if (itemId !== SHOW_HIDDEN_DROPDOWN_ITEM_ID) return;

    const id = envId();
    if (!id) return;

    void (async () => {
      let rootPath = '';
      try {
        rootPath = normalizePath(await resolveFsRootAbs());
      } catch (error) {
        notifyPathLoadFailure({
          status: 'transport_error',
          message: error instanceof Error ? error.message : 'Failed to resolve home directory.',
        });
        return;
      }

      const nextShowHidden = !showHidden();
      const currentPath = normalizeAbsolutePath(currentBrowserPath()) || rootPath;
      const nextPath = nextShowHidden
        ? normalizePath(currentPath)
        : visibleBrowserPath(currentPath, rootPath);

      writePersistedShowHidden(id, nextShowHidden);
      writePersistedLastPath(id, nextPath);
      setShowHidden(nextShowHidden);
      setCurrentBrowserPath(nextPath);
      clearDirectoryState();
      resetFileBrowser();

      await loadPathOrFallback(nextPath, {
        fallbackPath: rootPath,
        persistEnvId: id,
        resetOnFallback: false,
      });
    })();
  };

  const fileBrowserToolbarEndActions = () => (
    <Dropdown
      trigger={(
        <Button
          size="sm"
          variant="outline"
          class="cursor-pointer"
          aria-label="More file browser options"
          title="More options"
        >
          <MoreHorizontal class="size-3.5" />
        </Button>
      )}
      items={fileBrowserMoreItems()}
      value={showHidden() ? SHOW_HIDDEN_DROPDOWN_ITEM_ID : undefined}
      onSelect={handleFileBrowserMoreSelect}
      align="end"
    />
  );

  createEffect(() => {
    const id = envId();
    const restored = untrack(() => ({
      nextPath: id ? readPersistedLastPath(id) : '',
      nextShowHidden: id ? readPersistedShowHidden(id) : false,
      nextMode: id ? readPersistedPageMode(id) : 'files',
      nextSubview: id ? readPersistedGitSubview(id) : 'changes',
    }));

    clearDirectoryState();
    setCurrentBrowserPath(restored.nextPath);
    setAgentHomePathAbs('');
    setShowHidden(restored.nextShowHidden);
    setGitSubview(restored.nextSubview);
    setPageMode(restored.nextMode);
    closePageSidebar();
    setRepoInfo(null);
    setRepoInfoLoading(false);
    setRepoInfoResolved(false);
    setRepoInfoError('');
    resetGitCommitSidebar();
    resetGitWorkbenchData();
    setDragMoveLoading(false);
    resetFileBrowser();

    repoReqSeq += 1;
    filePreview.closePreview();
  });

  const loadDirOnce = async (path: string, seq: number): Promise<PathLoadResult> => {
    if (seq !== dirReqSeq) return { status: 'canceled' };

    const p = normalizePath(path);
    const scopedRootPath = normalizePath(agentHomePathAbs() || p);
    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildrenAtRoot(prev, p, cache.get(p)!, scopedRootPath));
      return { status: 'ok' };
    }

    if (!protocol.client()) {
      return { status: 'transport_error', message: 'Connection is not ready.' };
    }

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: showHidden() });
      if (seq !== dirReqSeq) return { status: 'canceled' };

      const entries = resp?.entries ?? [];
      const items = entries
        .map(toFileItem)
        .sort((a: FileItem, b: FileItem) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
      if (seq !== dirReqSeq) return { status: 'canceled' };
      cache.set(p, items);

      if (seq === dirReqSeq) setFiles((prev) => withChildrenAtRoot(prev, p, items, scopedRootPath));
      return { status: 'ok' };
    } catch (e) {
      if (seq !== dirReqSeq) return { status: 'canceled' };
      return classifyPathLoadError(e);
    }
  };

  const loadPathChain = async (path: string): Promise<PathLoadResult> => {
    if (!protocol.client()) {
      return { status: 'transport_error', message: 'Connection is not ready.' };
    }

    let rootPath = '';
    try {
      rootPath = normalizePath(await resolveFsRootAbs());
    } catch (e) {
      return {
        status: 'transport_error',
        message: e instanceof Error ? e.message : 'Failed to resolve home directory.',
      };
    }

    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    if (p !== rootPath && !p.startsWith(`${rootPath}/`)) {
      return { status: 'invalid_path', message: 'Path is outside agent home.' };
    }

    const rel = p === rootPath ? '' : p.slice(rootPath.length);
    const parts = rel.split('/').filter(Boolean);
    const chain: string[] = [rootPath];
    let cursor = rootPath;
    for (const part of parts) {
      cursor = cursor === '/' ? `/${part}` : `${cursor}/${part}`;
      chain.push(cursor);
    }

    setLoading(true);
    try {
      for (const dir of chain) {
        const step = await loadDirOnce(dir, seq);
        if (step.status !== 'ok') return step;
      }
      setLastLoadedBrowserPath(p);
      return { status: 'ok' };
    } finally {
      if (seq === dirReqSeq) setLoading(false);
    }
  };

  const notifyPathLoadFailure = (result: PathLoadResult) => {
    if (result.status === 'canceled' || result.status === 'invalid_path') return;
    notification.error('Failed to load directory', result.message ?? 'Unable to load directory.');
  };

  const loadPathOrFallback = async (
    requestedPath: string,
    options: {
      fallbackPath?: string;
      persistEnvId?: string;
      resetOnFallback?: boolean;
    } = {},
  ): Promise<void> => {
    const normalizedRequestedPath = normalizePath(requestedPath);
    const normalizedFallbackPath = options.fallbackPath
      ? normalizePath(options.fallbackPath)
      : '';
    const result = await loadPathChain(normalizedRequestedPath);
    if (result.status === 'ok' || result.status === 'canceled') return;

    if (result.status === 'invalid_path' && normalizedFallbackPath && normalizedFallbackPath !== normalizedRequestedPath) {
      if (options.persistEnvId) {
        writePersistedLastPath(options.persistEnvId, normalizedFallbackPath);
      }
      setCurrentBrowserPath(normalizedFallbackPath);
      if (options.resetOnFallback !== false) {
        resetFileBrowser();
      }

      const fallbackResult = await loadPathChain(normalizedFallbackPath);
      if (fallbackResult.status !== 'ok') notifyPathLoadFailure(fallbackResult);
      return;
    }

    notifyPathLoadFailure(result);
  };

  const applyLocalMove = (item: FileItem, destDir: string) => {
    const from = normalizePath(item.path);
    const to = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
    const scopedRootPath = normalizePath(agentHomePathAbs() || getParentDir(from));
    const movedItem = rewriteSubtreePaths(item, from, to);

    setFiles((prev) => {
      const removed = removeItemsFromTree(prev, new Set([from]));
      return insertItemToTree(removed, destDir, movedItem, scopedRootPath);
    });

    const srcDir = getParentDir(from);
    const srcCached = cache.get(srcDir);
    if (srcCached) {
      cache.set(srcDir, srcCached.filter((c) => normalizePath(c.path) !== from));
    }

    const destCached = cache.get(destDir);
    if (destCached) {
      const next = destCached.filter((c) => normalizePath(c.path) !== normalizePath(to));
      cache.set(destDir, sortFileItems([...next, movedItem]));
    }

    if (item.type === 'folder') {
      rewriteCachePathPrefix(cache, from, to);
    }
  };

  const handleDragMove = async (items: FileItem[], targetPath: string) => {
    if (items.length === 0) return;

    const client = protocol.client();
    if (!client) {
      resetFileBrowser();
      notification.error('Move failed', 'Connection is not ready.');
      return;
    }

    if (dragMoveLoading()) return;

    const destDir = normalizePath(targetPath);
    setDragMoveLoading(true);

    let okCount = 0;
    const failures: string[] = [];

    try {
      for (const item of items) {
        const from = normalizePath(item.path);
        const to = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
        if (normalizePath(to) === from) continue;

        try {
          await rpc.fs.rename({ oldPath: from, newPath: to });

          applyLocalMove(item, destDir);
          okCount += 1;
        } catch (e) {
          failures.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (okCount > 0) {
        writePersistedTargetPath(envId(), destDir);
      }

      if (failures.length > 0) {
        // FileBrowser drag uses optimistic UI updates; when the RPC fails we need to remount
        // the FileBrowser to clear those optimistic ops and show the real state again.
        resetFileBrowser();

        const prefix = okCount > 0
          ? `${okCount} moved, ${failures.length} failed.`
          : `${failures.length} failed.`;
        notification.error('Move failed', `${prefix} ${failures[0] ?? ''}`.trim());
        return;
      }

      if (okCount > 0) {
        notification.success('Moved', okCount === 1 ? '1 item moved.' : `${okCount} items moved.`);
      }
    } finally {
      setDragMoveLoading(false);
    }
  };

  const handleDelete = async (items: FileItem[]) => {
    const client = protocol.client();
    if (!client || items.length === 0) return;

    setDeleteLoading(true);
    setDeleteDialogOpen(false);

    try {
      for (const item of items) {
        const isDir = item.type === 'folder';
        await rpc.fs.delete({ path: item.path, recursive: isDir });
      }
      const pathsToRemove = new Set(items.map((i) => normalizePath(i.path)));
      setFiles((prev) => removeItemsFromTree(prev, pathsToRemove));
      for (const item of items) {
        const parentDir = getParentDir(item.path);
        const cached = cache.get(parentDir);
        if (cached) {
          cache.set(parentDir, cached.filter((c) => !pathsToRemove.has(normalizePath(c.path))));
        }
      }

      notification.success(
        items.length === 1 ? 'Deleted' : 'Delete completed',
        items.length === 1 ? `"${items[0]!.name}" deleted.` : `${items.length} items deleted.`
      );
    } catch (e) {
      notification.error('Delete failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRename = async (item: FileItem, newName: string) => {
    const client = protocol.client();
    if (!client || !newName.trim()) return;

    const newNameTrimmed = newName.trim();
    if (newNameTrimmed === item.name) {
      setRenameDialogOpen(false);
      return;
    }

    const parentDir = getParentDir(item.path);
    const newPath = parentDir === '/' ? `/${newNameTrimmed}` : `${parentDir}/${newNameTrimmed}`;
    const newExt = item.type === 'file' ? extNoDot(newNameTrimmed) : undefined;

    setRenameLoading(true);
    setRenameDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath });
      const updates: Partial<FileItem> = {
        name: newNameTrimmed,
        path: newPath,
        id: newPath,
        extension: newExt,
      };
      setFiles((prev) => updateItemInTree(prev, item.path, updates));
      const cached = cache.get(parentDir);
      if (cached) {
        cache.set(
          parentDir,
          cached.map((c) => (normalizePath(c.path) === normalizePath(item.path) ? { ...c, ...updates } : c))
        );
      }

      notification.success('Renamed', `"${item.name}" renamed to "${newNameTrimmed}".`);
    } catch (e) {
      notification.error('Rename failed', e instanceof Error ? e.message : String(e));
    } finally {
      setRenameLoading(false);
    }
  };

  const duplicateOne = async (
    item: FileItem
  ): Promise<{ ok: true; newName: string } | { ok: false }> => {
    const client = protocol.client();
    if (!client) return { ok: false };

    const parentDir = getParentDir(item.path);
    const baseName = item.name;
    const ext = baseName.includes('.')
      ? baseName.slice(baseName.lastIndexOf('.'))
      : '';
    const nameWithoutExt = ext
      ? baseName.slice(0, baseName.lastIndexOf('.'))
      : baseName;
    const newName = `${nameWithoutExt} (copy)${ext}`;
    const destPath = parentDir === '/' ? `/${newName}` : `${parentDir}/${newName}`;
    const scopedRootPath = normalizePath(agentHomePathAbs() || parentDir);

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath });
      const newItem: FileItem = {
        ...item,
        id: destPath,
        name: newName,
        path: destPath,
        extension: item.type === 'file' ? extNoDot(newName) : undefined,
      };
      setFiles((prev) => insertItemToTree(prev, parentDir, newItem, scopedRootPath));
      const cached = cache.get(parentDir);
      if (cached && !cached.some((c) => normalizePath(c.path) === normalizePath(destPath))) {
        cache.set(parentDir, sortFileItems([...cached, newItem]));
      }
      return { ok: true, newName };
    } catch (e) {
      notification.error('Duplicate failed', e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  };

  const handleMoveTo = async (item: FileItem, destDirPath: string) => {
    const client = protocol.client();
    if (!client || !destDirPath.trim()) return;

    const destDir = normalizePath(destDirPath.trim());
    const finalDestPath = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;

    if (finalDestPath === item.path) {
      setMoveToDialogOpen(false);
      return;
    }

    setMoveToLoading(true);
    setMoveToDialogOpen(false);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath: finalDestPath });
      const srcDir = getParentDir(item.path);
      const pathsToRemove = new Set([normalizePath(item.path)]);
      setFiles((prev) => removeItemsFromTree(prev, pathsToRemove));
      const srcCached = cache.get(srcDir);
      if (srcCached) {
        cache.set(srcDir, srcCached.filter((c) => normalizePath(c.path) !== normalizePath(item.path)));
      }
      writePersistedTargetPath(envId(), destDir);

      notification.success('Moved', `"${item.name}" moved to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Move failed', e instanceof Error ? e.message : String(e));
    } finally {
      setMoveToLoading(false);
    }
  };

  const handleCopyTo = async (item: FileItem, destDirPath: string, destFileName: string) => {
    const client = protocol.client();
    if (!client || !destDirPath.trim() || !destFileName.trim()) return;

    const destDir = normalizePath(destDirPath.trim());
    const finalDestPath = destDir === '/' ? `/${destFileName.trim()}` : `${destDir}/${destFileName.trim()}`;

    if (finalDestPath === item.path) {
      setCopyToDialogOpen(false);
      return;
    }

    setCopyToLoading(true);
    setCopyToDialogOpen(false);

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath: finalDestPath });
      const destDir = getParentDir(finalDestPath);
      const scopedRootPath = normalizePath(agentHomePathAbs() || destDir);
      const newName = finalDestPath.split('/').pop() ?? item.name;
      const newItem: FileItem = {
        ...item,
        id: finalDestPath,
        name: newName,
        path: finalDestPath,
        extension: item.type === 'file' ? extNoDot(newName) : undefined,
      };
      const destCached = cache.get(destDir);
      if (destCached) {
        if (!destCached.some((c) => normalizePath(c.path) === normalizePath(finalDestPath))) {
          cache.set(destDir, sortFileItems([...destCached, newItem]));
          setFiles((prev) => insertItemToTree(prev, destDir, newItem, scopedRootPath));
        }
      }
      writePersistedTargetPath(envId(), destDir);

      notification.success('Copied', `"${item.name}" copied to "${finalDestPath}".`);
    } catch (e) {
      notification.error('Copy failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCopyToLoading(false);
    }
  };

  createEffect(() => {
    if (!protocol.client()) return;
    const id = envId();
    if (!id) return;
    void (async () => {
      let rootPath = '';
      try {
        rootPath = normalizePath(await resolveFsRootAbs());
      } catch (e) {
        notifyPathLoadFailure({
          status: 'transport_error',
          message: e instanceof Error ? e.message : 'Failed to resolve home directory.',
        });
        return;
      }

      const rememberedPath = normalizeAbsolutePath(currentBrowserPath());
      const persistedPath = normalizeAbsolutePath(untrack(() => readPersistedLastPath(id)));
      const showHiddenEnabled = untrack(() => showHidden());
      const requestedStartPath = rememberedPath || persistedPath || rootPath;
      const startPath = showHiddenEnabled
        ? normalizePath(requestedStartPath)
        : visibleBrowserPath(requestedStartPath, rootPath);
      if (startPath !== requestedStartPath) {
        writePersistedLastPath(id, startPath);
      }
      setCurrentBrowserPath(startPath);
    })();
  });

  createEffect(() => {
    const id = envId();
    const client = protocol.client();
    const mode = pageMode();
    const path = normalizeAbsolutePath(currentBrowserPath());
    if (!id || !client || mode !== 'files' || !path) return;

    const normalizedPath = normalizePath(path);
    if (loading() || lastLoadedBrowserPath() === normalizedPath) return;

    void loadPathOrFallback(normalizedPath, {
      fallbackPath: lastLoadedBrowserPath() || agentHomePathAbs(),
      persistEnvId: id,
      resetOnFallback: false,
    });
  });

  createEffect(() => {
    const id = envId();
    const client = protocol.client();
    const path = currentBrowserPath();
    if (!id || !client || !path.trim()) {
      repoReqSeq += 1;
      setRepoInfo(null);
      setRepoInfoLoading(false);
      setRepoInfoError('');
      return;
    }
    void resolveRepoInfo(path);
  });

  createEffect(() => {
    if (pageMode() === 'git' && repoInfoResolved() && !repoInfoLoading() && !repoHistoryAvailable()) {
      setBrowserPageMode('files');
      if (layout.isMobile()) {
        closePageSidebar();
      }
    }
  });

  createEffect(() => {
    const mode = pageMode();
    const info = repoInfo();
    const repoKey = info?.available ? `${info.repoRootPath ?? ''}|${info.headCommit ?? ''}` : '';
    if (mode !== 'git') {
      return;
    }
    if (!repoKey) {
      resetGitCommitSidebar();
      resetGitWorkbenchData();
      return;
    }
    if (repoKey === lastGitRepoKey) {
      return;
    }
    lastGitRepoKey = repoKey;
    lastGitCommitContextKey = '';
    void loadGitRepoSummary({ silent: Boolean(gitRepoSummary()) });
    if (gitSubview() === 'changes') {
      void loadGitWorkspace({ silent: Boolean(gitWorkspace()) });
    }
    if (gitSubview() === 'branches') {
      void loadGitBranches({ silent: Boolean(gitBranches()) });
    }
  });

  createEffect(() => {
    const mode = pageMode();
    const subview = gitSubview();
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (mode !== 'git' || !repoRootPath) return;

    if (!gitRepoSummary() && !gitRepoSummaryLoading()) {
      void loadGitRepoSummary();
    }
    if (subview === 'changes' && !gitWorkspace() && !gitWorkspaceLoading()) {
      void loadGitWorkspace();
    }
    if (subview === 'branches' && !gitBranches() && !gitBranchesLoading()) {
      void loadGitBranches();
    }
  });

  createEffect(() => {
    const mode = pageMode();
    const subview = gitSubview();
    const branchSubview = selectedGitBranchSubview();
    const branch = selectedGitBranch();
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const isBranchHistory = subview === 'branches' && branchSubview === 'history';
    const isRepoHistory = subview === 'history';
    const ref = isBranchHistory ? String(branch?.name ?? '').trim() : '';

    if (mode !== 'git' || !repoRootPath || (!isRepoHistory && !isBranchHistory)) {
      lastGitCommitContextKey = '';
      return;
    }
    if (isBranchHistory && !ref) {
      resetGitCommitSidebar();
      return;
    }

    const contextKey = `${repoRootPath}|${subview}|${ref}`;
    if (contextKey === lastGitCommitContextKey) {
      return;
    }
    lastGitCommitContextKey = contextKey;
    void loadGitCommits(true, ref);
  });

  const dispatchAskFlowerIntent = (intent: AskFlowerIntent) => {
    ctx.openAskFlowerComposer(intent);
  };

  const toAbsolutePath = (path: string): string => normalizeAbsolutePath(path);

  const toFileContextItems = (items: FileItem[]): AskFlowerIntent['contextItems'] =>
    items
      .map((item) => {
        const absolutePath = toAbsolutePath(item.path);
        if (!absolutePath) return null;
        return {
          kind: 'file_path' as const,
          path: absolutePath,
          isDirectory: item.type === 'folder',
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item);

  const createAttachmentFromFileItem = async (
    item: FileItem,
    client: Client,
  ): Promise<{ file: File | null; note?: string }> => {
    if (item.type !== 'file') return { file: null };

    const normalizedPath = normalizeAbsolutePath(item.path);
    const declaredSize = typeof item.size === 'number' && Number.isFinite(item.size) ? Math.max(0, Math.floor(item.size)) : null;
    if (declaredSize != null && declaredSize > ASK_FLOWER_ATTACHMENT_MAX_BYTES) {
      return {
        file: null,
        note: `Skipped "${item.name}" because it exceeds the 10 MiB upload limit.`,
      };
    }

    const readMaxBytes = declaredSize != null ? Math.min(declaredSize, ASK_FLOWER_ATTACHMENT_MAX_BYTES + 1) : ASK_FLOWER_ATTACHMENT_MAX_BYTES + 1;
    try {
      const { bytes, meta } = await readFileBytesOnce({
        client,
        path: normalizedPath,
        maxBytes: readMaxBytes,
      });

      const reportedSize = Number(meta.file_size ?? declaredSize ?? bytes.byteLength);
      const exceedsLimit = (Number.isFinite(reportedSize) && reportedSize > ASK_FLOWER_ATTACHMENT_MAX_BYTES) || bytes.byteLength > ASK_FLOWER_ATTACHMENT_MAX_BYTES || !!meta.truncated;
      if (exceedsLimit) {
        return {
          file: null,
          note: `Skipped "${item.name}" because it exceeds the 10 MiB upload limit.`,
        };
      }

      const mime = mimeFromExtDot(getExtDot(item.name)) ?? 'application/octet-stream';
      const file = new File([bytes], item.name || 'attachment', {
        type: mime,
        lastModified: item.modifiedAt?.getTime() ?? Date.now(),
      });
      return { file };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        file: null,
        note: `Skipped "${item.name}" because it could not be read (${msg || 'unknown error'}).`,
      };
    }
  };

  const askFlowerFromFileBrowser = async (items: FileItem[]) => {
    const normalizedItems = items.filter((item) => String(item.path ?? '').trim());
    if (normalizedItems.length <= 0) return;

    const notes: string[] = [];
    const pendingAttachments: File[] = [];
    const fileCandidates = normalizedItems.filter((item) => item.type === 'file');

    if (fileCandidates.length > ASK_FLOWER_MAX_ATTACHMENTS) {
      notes.push(`Attached only the first ${ASK_FLOWER_MAX_ATTACHMENTS} files. Remaining files are added as path context only.`);
    }

    const attachmentCandidates = fileCandidates.slice(0, ASK_FLOWER_MAX_ATTACHMENTS);
    const client = protocol.client();
    if (attachmentCandidates.length > 0 && !client) {
      notes.push('Skipped file attachments because the connection is not ready.');
    }

    if (client) {
      for (const fileItem of attachmentCandidates) {
        const result = await createAttachmentFromFileItem(fileItem, client);
        if (result.file) {
          pendingAttachments.push(result.file);
        } else if (result.note) {
          notes.push(result.note);
        }
      }
    }

    const contextItems = toFileContextItems(normalizedItems);
    if (contextItems.length <= 0) {
      notification.error('Ask Flower unavailable', 'Failed to resolve selected file paths.');
      return;
    }

    const absoluteItems = normalizedItems
      .map((item) => ({
        path: normalizeAbsolutePath(item.path),
        isDirectory: item.type === 'folder',
      }))
      .filter((item) => item.path);
    const suggestedWorkingDirAbs = deriveAbsoluteWorkingDirFromItems(absoluteItems, currentBrowserPath());

    dispatchAskFlowerIntent({
      id: createClientId('ask-flower'),
      source: 'file_browser',
      mode: 'append',
      suggestedWorkingDirAbs: suggestedWorkingDirAbs || undefined,
      contextItems,
      pendingAttachments,
      notes,
    });
  };

  const handleCopyName = (items: FileItem[]) => {
    void (async () => {
      try {
        const result = await copyFileBrowserItemNames(items);
        notification.success('Copied', describeCopiedFileBrowserItemNames(result));
      } catch (e) {
        notification.error('Copy failed', e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const ctxMenu: ContextMenuCallbacks = {
    onDelete: (items: FileItem[]) => {
      setDeleteDialogItems(items);
      setDeleteDialogOpen(true);
    },
    onRename: (item: FileItem) => {
      setRenameDialogItem(item);
      setRenameDialogOpen(true);
    },
    onDuplicate: (items: FileItem[]) => {
      void (async () => {
        if (duplicateLoading()) return;
        setDuplicateLoading(true);
        try {
          let okCount = 0;
          let lastNewName: string | null = null;

          for (const item of items) {
            const ret = await duplicateOne(item);
            if (ret.ok) {
              okCount += 1;
              lastNewName = ret.newName;
            }
          }

          if (okCount <= 0) return;
          if (okCount === 1) {
            notification.success('Duplicated', lastNewName ? `Created "${lastNewName}".` : 'Duplicate completed.');
            return;
          }
          notification.success('Duplicate completed', `${okCount} items duplicated.`);
        } finally {
          setDuplicateLoading(false);
        }
      })();
    },
    onMoveTo: (items: FileItem[]) => {
      if (items.length > 0) {
        setMoveToDialogItem(items[0]);
        setMoveToDialogOpen(true);
      }
    },
    onCopyTo: (items: FileItem[]) => {
      if (items.length > 0) {
        setCopyToDialogItem(items[0]);
        setCopyToDialogOpen(true);
      }
    },
    onCopyName: (items: FileItem[]) => {
      handleCopyName(items);
    },
  };

  const overrideContextMenuItems: ContextMenuItem[] = [
    {
      id: 'ask-flower',
      label: 'Ask Flower',
      type: 'custom',
      icon: (props) => <Sparkles class={props.class} />,
      separator: true,
      onAction: (items: FileItem[]) => {
        void askFlowerFromFileBrowser(items);
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      type: 'duplicate',
      icon: (props) => <Copy class={props.class} />,
      shortcut: 'Cmd+D',
    },
    {
      id: 'copy-name',
      label: 'Copy Name',
      type: 'copy-name',
      icon: (props) => <ClipboardIcon class={props.class} />,
    },
    {
      id: 'copy-to',
      label: 'Copy to...',
      type: 'copy-to',
      icon: (props) => <Folder class={props.class} />,
    },
    {
      id: 'move-to',
      label: 'Move to...',
      type: 'move-to',
      icon: (props) => <ArrowRightLeft class={props.class} />,
      separator: true,
    },
    {
      id: 'rename',
      label: 'Rename',
      type: 'rename',
      icon: (props) => <Pencil class={props.class} />,
      shortcut: 'Enter',
    },
    {
      id: 'delete',
      label: 'Delete',
      type: 'delete',
      icon: (props) => <Trash class={props.class} />,
      shortcut: 'Del',
    },
  ];

  return (
    <div class="h-full relative">
      <Show
        when={envId()}
        keyed
        fallback={<div class="h-full" />}
      >
        {(id) => (
          <div class="h-full min-h-0">
            <KeepAliveStack
              class="h-full"
              activeId={pageMode()}
              lazyMount
              keepMounted
              views={[
                {
                  id: 'files',
                  class: 'h-full',
                  render: () => (
                    <FileBrowserWorkspace
                      class="h-full"
                      mode={pageMode()}
                      onModeChange={handlePageModeChange}
                      gitHistoryDisabled={!canEnterGitHistory()}
                      captureTypingFromPage={!props.widgetId}
                      files={files()}
                      currentPath={currentBrowserPath()}
                      initialPath={readPersistedLastPath(id)}
                      homePath={agentHomePathAbs() || undefined}
                      persistenceKey={workspacePersistenceKey(id)}
                      instanceId={workspaceInstanceId(id)}
                      resetKey={fileBrowserResetSeq()}
                      width={browserSidebarWidth()}
                      open={pageSidebarOpen()}
                      resizable
                      onResize={(delta) => commitBrowserSidebarWidth(browserSidebarWidth() + delta)}
                      onClose={closePageSidebar}
                      showMobileSidebarButton={layout.isMobile() && Boolean(props.widgetId)}
                      onToggleSidebar={togglePageSidebar}
                      toolbarEndActions={fileBrowserToolbarEndActions()}
                      onNavigate={(path) => {
                        const targetPath = normalizePath(path);
                        writePersistedLastPath(id, targetPath);
                        setCurrentBrowserPath(targetPath);
                        void loadPathOrFallback(targetPath, {
                          fallbackPath: lastLoadedBrowserPath() || agentHomePathAbs(),
                          persistEnvId: id,
                        });
                      }}
                      onPathChange={(_path, source) => {
                        if (source === 'user' && layout.isMobile()) {
                          closePageSidebar();
                        }
                      }}
                      onOpen={(item) => void filePreview.openPreview(item)}
                      onDragMove={(items, targetPath) => void handleDragMove(items, targetPath)}
                      contextMenuCallbacks={ctxMenu}
                      overrideContextMenuItems={overrideContextMenuItems}
                    />
                  ),
                },
                {
                  id: 'git',
                  class: 'h-full',
                  render: () => (
                    <GitWorkspace
                      class="h-full"
                      mode={pageMode()}
                      onModeChange={handlePageModeChange}
                      gitHistoryDisabled={!canEnterGitHistory()}
                      subview={gitSubview()}
                      onSubviewChange={handleGitSubviewChange}
                      width={browserSidebarWidth()}
                      open={pageSidebarOpen()}
                      resizable
                      onResize={(delta) => commitBrowserSidebarWidth(browserSidebarWidth() + delta)}
                      onClose={closePageSidebar}
                      currentPath={currentBrowserPath()}
                      repoInfo={repoInfo()}
                      repoInfoLoading={repoInfoLoading()}
                      repoInfoError={repoInfoError()}
                      repoSummary={gitRepoSummary()}
                      repoSummaryLoading={gitRepoSummaryLoading()}
                      repoSummaryError={gitRepoSummaryError()}
                      workspace={gitWorkspace()}
                      workspaceLoading={gitWorkspaceLoading()}
                      workspaceError={gitWorkspaceError()}
                      selectedWorkspaceSection={selectedGitWorkspaceSection()}
                      onSelectWorkspaceSection={selectGitWorkspaceSection}
                      selectedWorkspaceItem={selectedGitWorkspaceItem()}
                      onSelectWorkspaceItem={selectGitWorkspaceItem}
                      onStageWorkspaceItem={handleStageWorkspaceItem}
                      onUnstageWorkspaceItem={handleUnstageWorkspaceItem}
                      onBulkWorkspaceAction={handleBulkWorkspaceAction}
                      busyWorkspaceKey={gitMutationKey()}
                      busyWorkspaceAction={busyWorkspaceAction()}
                      branches={gitBranches()}
                      branchesLoading={gitBranchesLoading()}
                      branchesError={gitBranchesError()}
                      selectedBranch={selectedGitBranch()}
                      selectedBranchKey={selectedGitBranchName()}
                      onSelectBranch={selectGitBranch}
                      selectedBranchSubview={selectedGitBranchSubview()}
                      onSelectBranchSubview={selectGitBranchSubview}
                      commits={gitCommits()}
                      listLoading={gitListLoading()}
                      listLoadingMore={gitListLoadingMore()}
                      listError={gitListError()}
                      hasMore={gitHasMore()}
                      selectedCommitHash={selectedCommitHash()}
                      onSelectCommit={selectGitCommit}
                      onLoadMore={() => void loadGitCommits(false)}
                      commitMessage={gitCommitMessage()}
                      commitBusy={gitMutationScope() === 'commit'}
                      onCommitMessageChange={setGitCommitMessage}
                      onCommit={(message) => { void handleCommitWorkspace(message); }}
                      fetchBusy={gitMutationScope() === 'fetch'}
                      pullBusy={gitMutationScope() === 'pull'}
                      pushBusy={gitMutationScope() === 'push'}
                      checkoutBusy={gitMutationScope() === 'checkout'}
                      mergeBusy={gitMutationScope() === 'mergeBranch'}
                      deleteBusy={gitMutationScope() === 'deleteBranch'}
                      mergeReviewOpen={gitMergeReviewOpen()}
                      mergeReviewBranch={gitMergeReviewBranch()}
                      mergePreview={gitMergeReviewPreview()}
                      mergePreviewError={gitMergeReviewError()}
                      mergeActionError={gitMergeActionError()}
                      mergeDialogState={gitMergeDialogState()}
                      deleteReviewOpen={gitDeleteReviewOpen()}
                      deleteReviewBranch={gitDeleteReviewBranch()}
                      deletePreview={gitDeleteReviewPreview()}
                      deletePreviewError={gitDeleteReviewError()}
                      deleteActionError={gitDeleteActionError()}
                      deleteDialogState={gitDeleteDialogState()}
                      onFetch={() => { void handleFetchRepo(); }}
                      onPull={() => { void handlePullRepo(); }}
                      onPush={() => { void handlePushRepo(); }}
                      onCheckoutBranch={(branch) => { void handleCheckoutBranch(branch); }}
                      onMergeBranch={(branch) => { void handleMergeBranch(branch); }}
                      onDeleteBranch={(branch) => { void handleDeleteBranch(branch); }}
                      onCloseMergeReview={closeGitMergeReview}
                      onRetryMergePreview={(branch) => { void handleMergeBranch(branch); }}
                      onConfirmMergeBranch={(branch, options) => { void handleConfirmMergeBranch(branch, options); }}
                      onCloseDeleteReview={closeGitDeleteReview}
                      onRetryDeletePreview={(branch) => { void handleDeleteBranch(branch); }}
                      onConfirmDeleteBranch={(branch, options) => { void handleConfirmDeleteBranch(branch, options); }}
                      showMobileSidebarButton={layout.isMobile() && Boolean(props.widgetId)}
                      onToggleSidebar={togglePageSidebar}
                      onRefresh={() => { void refreshGitWorkbench(); }}
                      shellLoadingMessage={gitShellLoadingMessage()}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </Show>

      <LoadingOverlay visible={pageMode() === 'files' && loading()} message="Loading files..." />
      <LoadingOverlay visible={dragMoveLoading()} message="Moving..." />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(false);
        }}
        title="Delete"
        confirmText="Delete"
        variant="destructive"
        loading={deleteLoading()}
        onConfirm={() => void handleDelete(deleteDialogItems())}
      >
        <div class="text-sm text-foreground">
          <Show
            when={deleteDialogItems().length === 1}
            fallback={<>Are you sure you want to delete <span class="font-semibold">{deleteDialogItems().length} items</span>?</>}
          >
            Are you sure you want to delete <span class="font-semibold">"{deleteDialogItems()[0]?.name}"</span>?
          </Show>
        </div>
      </ConfirmDialog>

      {/* Rename Dialog */}
      <InputDialog
        open={renameDialogOpen()}
        title="Rename"
        label="New name"
        value={renameDialogItem()?.name ?? ''}
        loading={renameLoading()}
        onConfirm={(newName) => {
          const item = renameDialogItem();
          if (item) void handleRename(item, newName);
        }}
        onCancel={() => setRenameDialogOpen(false)}
      />

      {/* Move To Directory Picker */}
      <DirectoryPicker
        open={moveToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setMoveToDialogOpen(false);
        }}
        files={files()}
        initialPath={readPersistedTargetPath(envId()) ?? currentBrowserPath()}
        homeLabel="Home"
        homePath={agentHomePathAbs() || undefined}
        title="Move To"
        confirmText="Move"
        onSelect={(dirPath) => {
          const item = moveToDialogItem();
          if (item) void handleMoveTo(item, dirPath);
        }}
      />

      {/* Copy To File Save Picker */}
      <FileSavePicker
        open={copyToDialogOpen()}
        onOpenChange={(open) => {
          if (!open) setCopyToDialogOpen(false);
        }}
        files={files()}
        initialPath={readPersistedTargetPath(envId()) ?? currentBrowserPath()}
        homeLabel="Home"
        homePath={agentHomePathAbs() || undefined}
        initialFileName={copyToDialogItem()?.name ?? ''}
        title="Copy To"
        confirmText="Copy"
        onSave={(dirPath, fileName) => {
          const item = copyToDialogItem();
          if (item) void handleCopyTo(item, dirPath, fileName);
        }}
      />

      {/* Duplicate Loading Overlay */}
      <Show when={duplicateLoading()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div class="bg-background border border-border rounded-lg shadow-lg px-4 py-3 text-sm">
            Duplicating...
          </div>
        </div>
      </Show>
    </div>
  );
}
