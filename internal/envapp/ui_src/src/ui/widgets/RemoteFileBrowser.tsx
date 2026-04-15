import { Show, batch, createEffect, createMemo, createSignal, untrack } from 'solid-js';
import { useDeck, useLayout, useNotification, useResolvedFloeConfig } from '@floegence/floe-webapp-core';
import { KeepAliveStack } from '@floegence/floe-webapp-core/layout';
import { Copy, MoreHorizontal, Pencil, Plus, Refresh, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import {
  type ContextMenuCallbacks,
  type ContextMenuEvent,
  type ContextMenuItem,
  type FileBrowserRevealRequest,
  type FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, ConfirmDialog, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import type { Client } from '@floegence/flowersec-core';
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import {
  useRedevenRpc,
  type GitBranchSummary,
  type GitCommitSummary,
  type GitListBranchesResponse,
  type GitListWorkspacePageResponse,
  type GitListWorkspaceChangesResponse,
  type GitPreviewDeleteBranchResponse,
  type GitPreviewMergeBranchResponse,
  type GitRepoSummaryResponse,
  type GitResolveRepoResponse,
  type GitStashDetail,
  type GitStashSummary,
  type GitWorkspaceChange,
  type GitWorkspaceSection,
  type GitWorkspaceSummary,
} from '../protocol/redeven_v1';
import { getExtDot, mimeFromExtDot } from '../utils/filePreview';
import { readFileBytesOnce } from '../utils/fileStreamReader';
import { useEnvContext } from '../pages/EnvContext';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { resolveEnvironmentStorageScopeID } from '../services/desktopSessionContext';
import {
  normalizeAbsolutePath,
} from '../utils/askFlowerPath';
import { setAskFlowerAttachmentSourcePath } from '../utils/askFlowerAttachmentMetadata';
import { pathInputIncludesHiddenSegment } from '../utils/fileBrowserPathInput';
import {
  copyFileBrowserItemNames,
  copyFileBrowserItemPaths,
  describeCopiedFileBrowserItemNames,
  describeCopiedFileBrowserItemPaths,
} from '../utils/fileBrowserClipboard';
import { buildFilePathAskFlowerIntent } from '../utils/filePathAskFlower';
import { buildGitAskFlowerIntent, type GitAskFlowerRequest, type GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import { canOpenDirectoryPathInTerminal, openDirectoryInTerminal } from '../utils/openDirectoryInTerminal';
import { useFilePreviewContext } from './FilePreviewContext';
import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { InputDialog } from './InputDialog';
import { type GitHistoryMode } from './GitHistoryModeSwitch';
import { FileBrowserWorkspace, type FileBrowserPathSubmitResult } from './FileBrowserWorkspace';
import { FlowerContextMenuIcon } from '../icons/FlowerSoftAuraIcon';
import { GitStashWindow } from './GitStashWindow';
import { GitWorkspace } from './GitWorkspace';
import {
  WORKSPACE_VIEW_SECTIONS,
  applyWorkspaceViewPageSnapshot,
  branchIdentity,
  clearWorkspaceViewSections,
  createEmptyWorkspaceViewPageState,
  createEmptyWorkspaceViewPageStateRecord,
  findGitBranchByKey,
  findWorkspaceChangeByKey,
  isGitWorkspaceSection,
  shortGitHash,
  summarizeWorkspaceCount,
  type GitBranchDetailPresentationState,
  type GitBranchSubview,
  type GitDetachedSwitchTarget,
  type GitStashWindowRequest,
  type GitStashWindowSource,
  type GitStashWindowTab,
  type GitWorkspaceViewPageState,
  type GitWorkspaceViewSection,
  pickDefaultGitBranch,
  pickDefaultWorkspaceChange,
  pickDefaultWorkspaceViewSection,
  workspaceViewSectionCount,
  workspaceViewSectionActionKey,
  workspaceViewSectionForItem,
  workspaceViewSectionHasItem,
  workspaceViewSectionItems,
  workspaceEntryKey,
  workspaceMutationPaths,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import {
  buildGitStashReviewContextFromApplyPreview,
  buildGitStashReviewContextFromDropPreview,
  stashReviewMatchesTarget,
  type GitStashReviewState,
} from '../utils/gitStashReview';
import {
  buildGitActivationRefreshPlan,
  normalizeGitActivationSubview,
} from '../utils/gitActivationRefresh';
import { buildGitMutationRefreshPlan, type GitMutationRefreshKind } from '../utils/gitMutationRefresh';
import {
  buildChildPath,
  canInsertIntoTree,
  extNoDot,
  fileNameFromPath,
  getParentDir,
  insertItemToTree,
  normalizePath,
  removeCachePathPrefix,
  removeItemsFromTree,
  rewriteCachePathPrefix,
  rewriteSubtreePaths,
  sortFileItems,
  toFileItem,
  updateItemInTree,
  validateFileBrowserEntryName,
  withChildrenAtRoot,
} from './FileBrowserShared';

type DirCache = Map<string, FileItem[]>;

type PathLoadStatus = 'canceled' | 'invalid_path' | 'permission_denied' | 'transport_error';

type PathLoadResult = {
  status: PathLoadStatus;
  message?: string;
};

type DirTargetLoadPolicy = 'use_cache' | 'revalidate_target' | 'force_reload';

type PreparedDirectoryState = {
  tree: FileItem[];
  cache: DirCache;
  rootPath: string;
  committedPath: string;
  lastLoadedPath: string;
};

type DirectoryStateSeed = {
  tree: FileItem[];
  cache: DirCache;
};

type DirectoryPrepareResult =
  | { status: 'ok'; state: PreparedDirectoryState }
  | (PathLoadResult & { rootPath?: string });

type DirectoryNavigationResult =
  | { status: 'ready' | 'fallback'; state: PreparedDirectoryState }
  | { status: 'canceled' }
  | { status: 'error'; result: PathLoadResult };

type DirectoryNavigationOptions = {
  fallbackPath?: string;
  persistEnvId?: string;
  persistOnReady?: boolean;
  targetPolicy?: DirTargetLoadPolicy;
  showBlockingOverlay?: boolean;
  seed?: DirectoryStateSeed;
  allowInvalidTargetFallback?: boolean;
  showHiddenOverride?: boolean;
};

type ManualDirectoryNavigationResult =
  | { status: 'ready' | 'refreshed'; committedPath: string }
  | { status: 'invalid_path' | 'permission_denied' | 'transport_error'; message: string }
  | { status: 'canceled' };

type BrowserPageMode = GitHistoryMode;
type CreateEntryKind = 'file' | 'folder';
type CreateEntryDraft = {
  kind: CreateEntryKind;
  parentDir: string;
  initialName: string;
};

let createdEntryRevealSeq = 0;

const ASK_FLOWER_MAX_ATTACHMENTS = 5;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const GIT_COMMIT_PAGE_SIZE = 50;
const GIT_WORKSPACE_PAGE_SIZE = 200;
const DEFAULT_GIT_UNAVAILABLE_REASON = 'Git is not installed or not available in PATH on this runtime host.';
const PAGE_SIDEBAR_DEFAULT_WIDTH = 240;
const PAGE_SIDEBAR_MIN_WIDTH = 180;
const PAGE_SIDEBAR_MAX_WIDTH = 520;
const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';
const WIDGET_SIDEBAR_WIDTH_STATE_KEY = 'browserSidebarWidth';
const PAGE_MODE_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:page-mode:';
const GIT_SUBVIEW_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:git-subview:';
const SHOW_HIDDEN_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:show-hidden:';
const GO_TO_PATH_DROPDOWN_ITEM_ID = 'go-to-path';
const SHOW_HIDDEN_DROPDOWN_ITEM_ID = 'show-hidden-files';
const STASH_DROP_PLAN_STALE_ERROR_FRAGMENT = 'stash drop plan is stale';
const STASH_NOT_FOUND_ERROR_FRAGMENT = 'stash not found';

type GitMutationScope =
  | 'stage'
  | 'unstage'
  | 'commit'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'checkout'
  | 'switchDetached'
  | 'mergeBranch'
  | 'deleteBranch'
  | 'saveStash'
  | 'applyStash'
  | 'dropStash'
  | '';

type GitMutationRepoResponse = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  detached?: boolean;
};

type GitStashWindowContext = {
  repoRootPath: string;
  source: GitStashWindowSource;
};

type GitLoadOptions = {
  silent?: boolean;
  repoRootPath?: string;
};

type GitBranchSelectionMode = 'preserve' | 'default_if_empty' | 'default_if_missing';

type GitBranchLoadOptions = GitLoadOptions & {
  selectionMode?: GitBranchSelectionMode;
};

type GitWorkspaceLoadOptions = GitLoadOptions & {
  append?: boolean;
  offset?: number;
  force?: boolean;
};

type GitCommitContextScope = 'repo' | 'branch';

type GitCommitContext = {
  key: string;
  scope: GitCommitContextScope;
  repoRootPath: string;
  ref: string;
};

type GitCommitLoadOptions = GitLoadOptions & {
  context?: GitCommitContext | null;
  mode?: 'blocking' | 'background';
};

type GitCommitListCacheEntry = {
  commits: GitCommitSummary[];
  hasMore: boolean;
  nextOffset: number;
  resolved: boolean;
  selectedCommitHash: string;
};

type GitBranchDetailState =
  | { kind: 'idle' }
  | { kind: 'verifying'; requestedKey: string }
  | { kind: 'ready'; requestedKey: string }
  | { kind: 'missing'; requestedKey: string; title: string; detail: string }
  | { kind: 'error'; requestedKey: string; message: string };

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

function buildFallbackDirectoryCandidates(path: string, rootPath: string, fallbackPath?: string): string[] {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath);
  const normalizedFallback = fallbackPath ? normalizePath(fallbackPath) : '';
  const seen = new Set<string>();
  const candidates: string[] = [];

  let cursor = normalizedPath;
  while (cursor !== normalizedRoot) {
    cursor = getParentDir(cursor);
    if (cursor !== normalizedRoot && !cursor.startsWith(`${normalizedRoot}/`)) {
      break;
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    candidates.push(cursor);
  }

  if (
    normalizedFallback
    && (normalizedFallback === normalizedRoot || normalizedFallback.startsWith(`${normalizedRoot}/`))
    && !seen.has(normalizedFallback)
  ) {
    candidates.push(normalizedFallback);
  }

  return candidates;
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

function normalizeRpcErrorMessage(err: unknown): string {
  if (err instanceof RpcError) return String(err.message ?? '').trim().toLowerCase();
  if (err instanceof Error) return String(err.message ?? '').trim().toLowerCase();
  return String(err ?? '').trim().toLowerCase();
}

function isRpcErrorWithMessage(err: unknown, code: number, fragment: string): boolean {
  return err instanceof RpcError && err.code === code && normalizeRpcErrorMessage(err).includes(fragment);
}

function isStashDropPlanStaleError(err: unknown): boolean {
  return isRpcErrorWithMessage(err, 409, STASH_DROP_PLAN_STALE_ERROR_FRAGMENT);
}

function isStashNotFoundError(err: unknown): boolean {
  return isRpcErrorWithMessage(err, 404, STASH_NOT_FOUND_ERROR_FRAGMENT);
}

function createGitCommitContext(params: {
  repoRootPath?: string;
  subview: GitWorkbenchSubview;
  branchSubview: GitBranchSubview;
  branch?: GitBranchSummary | null;
}): GitCommitContext | null {
  const repoRootPath = String(params.repoRootPath ?? '').trim();
  if (!repoRootPath) return null;
  if (params.subview === 'history') {
    return {
      key: `${repoRootPath}|repo|`,
      scope: 'repo',
      repoRootPath,
      ref: '',
    };
  }
  if (params.subview === 'branches' && params.branchSubview === 'history') {
    const ref = String(params.branch?.name ?? '').trim();
    if (!ref) return null;
    return {
      key: `${repoRootPath}|branch|${ref}`,
      scope: 'branch',
      repoRootPath,
      ref,
    };
  }
  return null;
}

function inferGitBranchSummaryFromKey(
  key: string,
  fallback?: GitBranchSummary | null,
): GitBranchSummary | null {
  if (fallback) return fallback;
  const trimmed = String(key ?? '').trim();
  if (!trimmed) return null;
  const remote = trimmed.startsWith('refs/remotes/');
  const local = trimmed.startsWith('refs/heads/');
  let name = trimmed;
  if (remote) {
    name = trimmed.slice('refs/remotes/'.length);
  } else if (local) {
    name = trimmed.slice('refs/heads/'.length);
  }
  return {
    name,
    fullName: trimmed,
    kind: remote ? 'remote' : 'local',
  };
}

function createMissingGitBranchMessage(branch: GitBranchSummary | null | undefined, requestedKey: string): {
  title: string;
  detail: string;
} {
  const summary = inferGitBranchSummaryFromKey(requestedKey, branch);
  const name = String(summary?.name ?? summary?.fullName ?? requestedKey).trim() || 'This branch';
  return {
    title: 'Branch no longer exists',
    detail: `${name} was deleted outside Redeven. Refresh branches or switch to another branch to continue.`,
  };
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
  const fileBrowserSurface = useFileBrowserSurfaceContext();

  const envId = () => resolveEnvironmentStorageScopeID(ctx.env_id() ?? '');
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
  const [pathLoadInFlight, setPathLoadInFlight] = createSignal('');
  const [pendingBrowserPath, setPendingBrowserPath] = createSignal('');

  let cache: DirCache = new Map();

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteDialogItems, setDeleteDialogItems] = createSignal<FileItem[]>([]);
  const [deleteLoading, setDeleteLoading] = createSignal(false);

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [renameDialogItem, setRenameDialogItem] = createSignal<FileItem | null>(null);
  const [renameLoading, setRenameLoading] = createSignal(false);

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [createDialogDraft, setCreateDialogDraft] = createSignal<CreateEntryDraft | null>(null);
  const [createLoading, setCreateLoading] = createSignal(false);
  const [pendingCreatedEntryReveal, setPendingCreatedEntryReveal] = createSignal<FileBrowserRevealRequest | null>(null);

  const [duplicateLoading, setDuplicateLoading] = createSignal(false);

  const [dragMoveLoading, setDragMoveLoading] = createSignal(false);
  const [fileBrowserResetSeq, setFileBrowserResetSeq] = createSignal(0);

  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('');
  const [lastLoadedBrowserPath, setLastLoadedBrowserPath] = createSignal('');

  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [showHidden, setShowHidden] = createSignal(false);
  const [pageMode, setPageMode] = createSignal<BrowserPageMode>('files');
  const [pathEditorRequestKey, setPathEditorRequestKey] = createSignal(0);
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
  const [gitCommitContextKey, setGitCommitContextKey] = createSignal('');
  const [gitCommitListCache, setGitCommitListCache] = createSignal<Record<string, GitCommitListCacheEntry>>({});
  const [selectedCommitHash, setSelectedCommitHash] = createSignal('');
  const [gitListRefreshing, setGitListRefreshing] = createSignal(false);
  const [browserSidebarWidth, setBrowserSidebarWidth] = createSignal(readPersistedSidebarWidth());
  const [browserSidebarOpen, setBrowserSidebarOpen] = createSignal(false);
  const [gitSubview, setGitSubview] = createSignal<GitWorkbenchSubview>('changes');
  const [gitRepoSummary, setGitRepoSummary] = createSignal<GitRepoSummaryResponse | null>(null);
  const [gitRepoSummaryLoading, setGitRepoSummaryLoading] = createSignal(false);
  const [gitRepoSummaryError, setGitRepoSummaryError] = createSignal('');
  const [gitWorkspace, setGitWorkspace] = createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [gitWorkspacePages, setGitWorkspacePages] = createSignal<Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>>(createEmptyWorkspaceViewPageStateRecord());
  const [gitWorkspaceError, setGitWorkspaceError] = createSignal('');
  const [selectedGitWorkspaceSection, setSelectedGitWorkspaceSection] = createSignal<GitWorkspaceViewSection>('changes');
  const [selectedGitWorkspaceKey, setSelectedGitWorkspaceKey] = createSignal('');
  const [gitBranches, setGitBranches] = createSignal<GitListBranchesResponse | null>(null);
  const [gitBranchesLoading, setGitBranchesLoading] = createSignal(false);
  const [gitBranchesError, setGitBranchesError] = createSignal('');
  const [selectedGitBranchName, setSelectedGitBranchName] = createSignal('');
  const [selectedGitBranchSnapshot, setSelectedGitBranchSnapshot] = createSignal<GitBranchSummary | null>(null);
  const [gitBranchDetailState, setGitBranchDetailState] = createSignal<GitBranchDetailState>({ kind: 'idle' });
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
  const [gitBranchStatusRefreshToken, setGitBranchStatusRefreshToken] = createSignal(0);
  const [stashWindowOpen, setStashWindowOpen] = createSignal(false);
  const [stashWindowTab, setStashWindowTab] = createSignal<GitStashWindowTab>('save');
  const [stashWindowContext, setStashWindowContext] = createSignal<GitStashWindowContext | null>(null);
  const [stashRepoSummary, setStashRepoSummary] = createSignal<GitRepoSummaryResponse | null>(null);
  const [stashWorkspaceSummary, setStashWorkspaceSummary] = createSignal<GitWorkspaceSummary | null>(null);
  const [stashContextLoading, setStashContextLoading] = createSignal(false);
  const [stashContextError, setStashContextError] = createSignal('');
  const [stashList, setStashList] = createSignal<GitStashSummary[]>([]);
  const [stashListLoading, setStashListLoading] = createSignal(false);
  const [stashListError, setStashListError] = createSignal('');
  const [selectedStashId, setSelectedStashId] = createSignal('');
  const [stashDetail, setStashDetail] = createSignal<GitStashDetail | null>(null);
  const [stashDetailLoading, setStashDetailLoading] = createSignal(false);
  const [stashDetailError, setStashDetailError] = createSignal('');
  const [stashSaveMessage, setStashSaveMessage] = createSignal('');
  const [stashIncludeUntracked, setStashIncludeUntracked] = createSignal(false);
  const [stashKeepIndex, setStashKeepIndex] = createSignal(false);
  const [stashReview, setStashReview] = createSignal<GitStashReviewState | null>(null);
  const [stashReviewLoading, setStashReviewLoading] = createSignal(false);
  const [stashReviewError, setStashReviewError] = createSignal('');
  let previousEnvId: string | null = null;
  const [gitDeleteActionError, setGitDeleteActionError] = createSignal('');

  let dirReqSeq = 0;
  let repoReqSeq = 0;
  let gitListReqSeq = 0;
  let gitRepoSummaryReqSeq = 0;
  let gitWorkspaceReqSeqBySection: Record<GitWorkspaceViewSection, number> = { changes: 0, conflicted: 0, staged: 0 };
  let gitBranchesReqSeq = 0;
  let gitBranchDetailReqSeq = 0;
  let gitMergeReviewReqSeq = 0;
  let gitDeleteReviewReqSeq = 0;
  let stashContextReqSeq = 0;
  let stashListReqSeq = 0;
  let stashDetailReqSeq = 0;
  let stashReviewReqSeq = 0;
  let lastGitCommitContextKey = '';
  let lastGitRepoKey = '';
  let lastGitSubviewActivationKey = '';
  let lastGitBranchStatusActivationKey = '';

  const readGitCommitCacheEntry = (contextKey: string): GitCommitListCacheEntry | null => {
    const key = String(contextKey ?? '').trim();
    if (!key) return null;
    return gitCommitListCache()[key] ?? null;
  };

  const applyGitCommitContextEntry = (context: GitCommitContext | null, entry: GitCommitListCacheEntry | null) => {
    const nextContextKey = String(context?.key ?? '').trim();
    const nextRef = String(context?.ref ?? '').trim();
    const nextCommits = entry?.commits ?? [];
    const nextSelectedCommitHash = String(entry?.selectedCommitHash ?? '').trim();
    const selectedStillVisible = nextSelectedCommitHash.length > 0 && nextCommits.some((item) => item.hash === nextSelectedCommitHash);

    setGitCommitContextKey(nextContextKey);
    setGitCommitListRef(nextRef);
    setGitCommits(nextCommits);
    setGitHasMore(Boolean(entry?.hasMore));
    setGitNextOffset(Number(entry?.nextOffset ?? 0));
    setGitListResolved(Boolean(entry?.resolved));
    setGitListError('');
    setGitListLoading(false);
    setGitListLoadingMore(false);
    setGitListRefreshing(false);
    setSelectedCommitHash(selectedStillVisible ? nextSelectedCommitHash : '');
  };

  const restoreGitCommitContextFromCache = (context: GitCommitContext): boolean => {
    const entry = readGitCommitCacheEntry(context.key);
    applyGitCommitContextEntry(context, entry);
    return Boolean(entry?.resolved);
  };

  const rememberSelectedGitBranchSnapshot = (branch: GitBranchSummary | null | undefined, requestedKey = '') => {
    setSelectedGitBranchSnapshot(inferGitBranchSummaryFromKey(requestedKey, branch));
  };

  const setGitBranchDetailIdle = () => {
    setGitBranchDetailState({ kind: 'idle' });
  };

  const setGitBranchDetailVerifying = (requestedKey: string, branch: GitBranchSummary | null | undefined) => {
    rememberSelectedGitBranchSnapshot(branch, requestedKey);
    setGitBranchDetailState({ kind: 'verifying', requestedKey });
  };

  const setGitBranchDetailReady = (requestedKey: string, branch: GitBranchSummary | null | undefined) => {
    const resolvedBranch = inferGitBranchSummaryFromKey(requestedKey, branch);
    rememberSelectedGitBranchSnapshot(resolvedBranch, requestedKey);
    if (!resolvedBranch) {
      setGitBranchDetailIdle();
      return;
    }
    setGitBranchDetailState({ kind: 'ready', requestedKey });
  };

  const setGitBranchDetailMissing = (requestedKey: string, branch: GitBranchSummary | null | undefined) => {
    const message = createMissingGitBranchMessage(branch, requestedKey);
    rememberSelectedGitBranchSnapshot(branch, requestedKey);
    setGitBranchDetailState({
      kind: 'missing',
      requestedKey,
      title: message.title,
      detail: message.detail,
    });
  };

  const setGitBranchDetailError = (requestedKey: string, branch: GitBranchSummary | null | undefined, message: string) => {
    rememberSelectedGitBranchSnapshot(branch, requestedKey);
    setGitBranchDetailState({
      kind: 'error',
      requestedKey,
      message,
    });
  };

  const selectedGitBranch = () => findGitBranchByKey(gitBranches(), selectedGitBranchName());
  const selectedGitBranchDisplay = () => selectedGitBranch() ?? selectedGitBranchSnapshot();
  const selectedGitReadyBranch = () => {
    const state = gitBranchDetailState();
    if (state.kind !== 'ready') return null;
    return selectedGitBranch() ?? selectedGitBranchSnapshot();
  };

  const currentGitCommitContext = (): GitCommitContext | null => createGitCommitContext({
    repoRootPath: repoInfo()?.repoRootPath,
    subview: gitSubview(),
    branchSubview: selectedGitBranchSubview(),
    branch: selectedGitReadyBranch(),
  });

  const prefersBackgroundGitCommitReload = (context: GitCommitContext | null): boolean => {
    const contextKey = String(context?.key ?? '').trim();
    if (!contextKey) return false;
    if (gitCommitContextKey() === contextKey && gitListResolved()) return true;
    return Boolean(readGitCommitCacheEntry(contextKey)?.resolved);
  };

  const cloneDirCache = (source: DirCache): DirCache => new Map(source);

  const applyPreparedDirectoryState = (state: PreparedDirectoryState, options: { persistEnvId?: string } = {}) => {
    batch(() => {
      cache = state.cache;
      setFiles(state.tree);
      setLastLoadedBrowserPath(state.lastLoadedPath);
      setCurrentBrowserPath(state.committedPath);
      if (options.persistEnvId) {
        writePersistedLastPath(options.persistEnvId, state.committedPath);
      }
    });
  };

  const resetFileBrowser = () => {
    setFileBrowserResetSeq((value) => value + 1);
  };

  const clearDirectoryState = () => {
    dirReqSeq += 1;
    cache = new Map();
    setFiles([]);
    setLoading(false);
    setPendingBrowserPath('');
    setPathLoadInFlight('');
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
  const repoUnavailableReason = createMemo(() => {
    const info = repoInfo();
    const reason = String(info?.unavailableReason ?? '').trim();
    if (reason) return reason;
    if (info?.gitAvailable === false) return DEFAULT_GIT_UNAVAILABLE_REASON;
    if (repoInfoResolved() && !info?.available) return 'Current path is not inside a Git repository.';
    return '';
  });
  const gitModeDisabledReason = createMemo(() => {
    if (repoInfoLoading()) return 'Checking repository context for the current path...';
    if (!repoInfoResolved()) return 'Checking repository context for the current path...';
    const infoError = String(repoInfoError() ?? '').trim();
    if (infoError) return infoError;
    return repoUnavailableReason();
  });
  const gitShellLoadingMessage = createMemo(() => {
    if (pageMode() !== 'git') return '';
    if (repoInfoLoading()) return 'Checking repository...';
    if (!repoHistoryAvailable()) return '';
    if (gitSubview() === 'changes') {
      return !gitWorkspace() && !gitWorkspaceError() ? 'Loading workspace changes...' : '';
    }
    if (gitSubview() === 'branches') {
      if (!gitBranches() && !gitBranchesError()) return 'Loading branches...';
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
            gitAvailable: resp.gitAvailable,
            repoRootPath: resp.repoRootPath,
            headRef: resp.headRef,
            headCommit: resp.headCommit,
            dirty: resp.dirty,
          }
        : {
            available: false,
            gitAvailable: resp?.gitAvailable,
            unavailableReason: resp?.unavailableReason,
          };
      setRepoInfo(nextInfo);
      return nextInfo;
    } catch (err) {
      if (seq !== repoReqSeq) return null;
      const result = classifyPathLoadError(err);
      if (!options.silent) {
        if (result.status === 'invalid_path') {
          setRepoInfo({
            available: false,
            gitAvailable: true,
            unavailableReason: result.message || 'Current path is not inside a Git repository.',
          });
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
    setGitCommitListCache({});
    applyGitCommitContextEntry(null, null);
  };

  const clearStashReview = (options: { cancelInFlight?: boolean } = {}) => {
    if (options.cancelInFlight) {
      stashReviewReqSeq += 1;
    }
    setStashReviewLoading(false);
    setStashReview(null);
    setStashReviewError('');
  };

  const resetGitStashState = () => {
    stashContextReqSeq += 1;
    stashListReqSeq += 1;
    stashDetailReqSeq += 1;
    stashReviewReqSeq += 1;
    setStashWindowOpen(false);
    setStashWindowTab('save');
    setStashWindowContext(null);
    setStashRepoSummary(null);
    setStashWorkspaceSummary(null);
    setStashContextLoading(false);
    setStashContextError('');
    setStashList([]);
    setStashListLoading(false);
    setStashListError('');
    setSelectedStashId('');
    setStashDetail(null);
    setStashDetailLoading(false);
    setStashDetailError('');
    setStashSaveMessage('');
    setStashIncludeUntracked(false);
    setStashKeepIndex(false);
    clearStashReview();
  };

  const resetGitWorkspacePages = () => {
    gitWorkspaceReqSeqBySection = { changes: 0, conflicted: 0, staged: 0 };
    setGitWorkspacePages(createEmptyWorkspaceViewPageStateRecord());
  };

  const updateGitWorkspacePageState = (
    section: GitWorkspaceViewSection,
    updater: (state: GitWorkspaceViewPageState) => GitWorkspaceViewPageState,
  ) => {
    setGitWorkspacePages((prev) => ({
      ...prev,
      [section]: updater(prev[section]),
    }));
  };

  const gitWorkspacePageState = (section: GitWorkspaceViewSection) => gitWorkspacePages()[section];
  const selectedGitWorkspacePageState = createMemo(() => gitWorkspacePageState(selectedGitWorkspaceSection()));
  // Keep blocking `Changes` loading derived from the selected page state so late requests cannot strand a global flag.
  const gitWorkspaceLoading = createMemo(() => {
    const state = selectedGitWorkspacePageState();
    return state.loading && !state.initialized;
  });

  const syncGitWorkspaceSelection = (nextWorkspace: GitListWorkspaceChangesResponse | null | undefined) => {
    if (!nextWorkspace) {
      setSelectedGitWorkspaceKey('');
      return;
    }
    const nextSection = selectedGitWorkspaceSection() || pickDefaultWorkspaceViewSection(nextWorkspace);
    setSelectedGitWorkspaceSection(nextSection);
    const currentKey = selectedGitWorkspaceKey();
    const scopedCurrentItem = findWorkspaceChangeByKey(nextWorkspace, currentKey);
    const nextItem = workspaceViewSectionHasItem(nextSection, scopedCurrentItem)
      ? scopedCurrentItem
      : workspaceViewSectionItems(nextWorkspace, nextSection)[0] ?? pickDefaultWorkspaceChange(nextWorkspace);
    setSelectedGitWorkspaceKey(workspaceEntryKey(nextItem));
  };

  const applyWorkspacePageSnapshot = (
    page: GitListWorkspacePageResponse | null | undefined,
    options: { append?: boolean } = {},
  ) => {
    if (!page) return;
    const section = page.section ?? 'changes';
    let nextWorkspace: GitListWorkspaceChangesResponse | null = null;
    setGitWorkspace((prev) => {
      nextWorkspace = applyWorkspaceViewPageSnapshot(prev, page, options);
      return nextWorkspace;
    });
    setGitRepoSummary((prev) => (prev ? { ...prev, workspaceSummary: page.summary } : prev));
    setRepoInfo((prev) => (prev ? { ...prev, dirty: summarizeWorkspaceCount(page.summary) > 0 } : prev));
    updateGitWorkspacePageState(section, (state) => ({
      ...state,
      items: options.append ? [...state.items, ...page.items] : [...page.items],
      totalCount: Number(page.totalCount ?? 0),
      nextOffset: Number(page.nextOffset ?? 0),
      hasMore: Boolean(page.hasMore),
      loading: false,
      error: '',
      initialized: true,
    }));
    syncGitWorkspaceSelection(nextWorkspace);
  };

  const invalidateGitWorkspaceSections = (sections: GitWorkspaceViewSection[]) => {
    const wanted = Array.from(new Set(sections));
    setGitWorkspace((prev) => clearWorkspaceViewSections(prev, wanted));
    setGitWorkspacePages((prev) => {
      const next = { ...prev };
      for (const section of wanted) {
        next[section] = createEmptyWorkspaceViewPageState();
      }
      return next;
    });
    if (wanted.includes(selectedGitWorkspaceSection())) {
      setSelectedGitWorkspaceKey('');
    }
  };

  const invalidateInactiveGitWorkspaceSections = (
    sections: GitWorkspaceViewSection[],
    activeSection = selectedGitWorkspaceSection(),
  ) => {
    const staleSections = Array.from(new Set(sections)).filter((section) => section !== activeSection);
    if (staleSections.length > 0) {
      invalidateGitWorkspaceSections(staleSections);
    }
  };

  const resetGitWorkbenchData = () => {
    gitRepoSummaryReqSeq += 1;
    gitBranchesReqSeq += 1;
    gitMergeReviewReqSeq += 1;
    gitDeleteReviewReqSeq += 1;
    lastGitRepoKey = '';
    setGitRepoSummary(null);
    setGitRepoSummaryLoading(false);
    setGitRepoSummaryError('');
    setGitWorkspace(null);
    resetGitWorkspacePages();
    setGitWorkspaceError('');
    setSelectedGitWorkspaceSection('changes');
    setSelectedGitWorkspaceKey('');
    setGitBranches(null);
    setGitBranchesLoading(false);
    setGitBranchesError('');
    setSelectedGitBranchName('');
    setSelectedGitBranchSnapshot(null);
    setGitBranchDetailIdle();
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
    setGitBranchStatusRefreshToken(0);
    resetGitStashState();
  };

  const selectedGitWorkspaceItem = () => findWorkspaceChangeByKey(gitWorkspace(), selectedGitWorkspaceKey());
  const activeStashRepoRootPath = () => String(stashWindowContext()?.repoRootPath ?? '').trim();
  const activeStashSource = () => stashWindowContext()?.source ?? 'header';
  const selectedStashSummary = createMemo<GitStashSummary | GitStashDetail | null>(() => {
    const stashId = String(selectedStashId() ?? '').trim();
    if (!stashId) return stashList()[0] ?? null;
    if (stashDetail()?.id === stashId) return stashDetail();
    return stashList().find((item) => item.id === stashId) ?? null;
  });

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
    const requestedKey = branchIdentity(branch);
    setSelectedGitBranchName(requestedKey);
    rememberSelectedGitBranchSnapshot(branch, requestedKey);
    setSelectedGitBranchSubview('status');
    if (requestedKey) {
      void reconcileSelectedGitBranch({
        requestedKey,
        requestedBranch: branch ?? null,
        showVerifying: true,
      });
    } else {
      setGitBranchDetailIdle();
    }
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

  const gitCurrentBranch = () => (
    (gitBranches()?.local ?? []).find((branch) => branch.current)
      ?? null
  );

  const gitBranchPresentationState = createMemo<GitBranchDetailPresentationState>(() => {
    const displayBranch = selectedGitBranchDisplay();
    const state = gitBranchDetailState();
    switch (state.kind) {
      case 'verifying':
        return displayBranch ? { kind: 'verifying', branch: displayBranch } : { kind: 'idle', branch: null };
      case 'ready':
        return displayBranch ? { kind: 'ready', branch: displayBranch } : { kind: 'idle', branch: null };
      case 'missing':
        return displayBranch
          ? { kind: 'missing', branch: displayBranch, title: state.title, detail: state.detail }
          : { kind: 'idle', branch: null };
      case 'error':
        return displayBranch
          ? { kind: 'error', branch: displayBranch, message: state.message }
          : { kind: 'idle', branch: null };
      case 'idle':
      default:
        return displayBranch ? { kind: 'ready', branch: displayBranch } : { kind: 'idle', branch: null };
    }
  });

  const refreshSelectedGitBranch = () => {
    void reconcileSelectedGitBranch({ showVerifying: true });
  };

  const refreshVisibleGitWorkspaceSection = async (
    repoRootPath: string,
  ): Promise<void> => {
    const activeSection = selectedGitWorkspaceSection();
    const state = gitWorkspacePageState(activeSection);
    if (state.loading) return;
    invalidateInactiveGitWorkspaceSections(WORKSPACE_VIEW_SECTIONS, activeSection);
    await loadGitWorkspaceSection(activeSection, {
      repoRootPath,
      silent: state.initialized,
      force: true,
    });
  };

  const refreshVisibleGitBranches = async (
    repoRootPath: string,
    options: {
      background: boolean;
      showVerifying: boolean;
    },
  ): Promise<void> => {
    if (selectedGitBranchName().trim()) {
      await reconcileSelectedGitBranch({
        repoRootPath,
        showVerifying: options.showVerifying,
      });
      return;
    }
    await loadGitBranches({
      silent: options.background && Boolean(gitBranches()),
      repoRootPath,
      selectionMode: 'default_if_empty',
    });
  };

  const refreshActivatedGitSubview = async (
    repoRootPath: string,
  ): Promise<void> => {
    const plan = buildGitActivationRefreshPlan({
      subview: gitSubview(),
      branchSubview: selectedGitBranchSubview(),
    });
    const refreshes: Array<Promise<unknown>> = [];

    if (plan.refreshRepoSummary && gitRepoSummary()) {
      refreshes.push(loadGitRepoSummary({ silent: true, repoRootPath }));
    }

    if (plan.refreshWorkspace) {
      const state = gitWorkspacePageState(selectedGitWorkspaceSection());
      if (state.initialized && !state.loading) {
        refreshes.push(refreshVisibleGitWorkspaceSection(repoRootPath));
      }
    }

    if (plan.refreshBranches) {
      const hasBranchContext = Boolean(gitBranches()) || selectedGitBranchName().trim().length > 0;
      if (hasBranchContext && !gitBranchesLoading()) {
        refreshes.push(refreshVisibleGitBranches(repoRootPath, {
          background: true,
          showVerifying: false,
        }));
      }
    }

    await Promise.all(refreshes);
  };

  const selectCurrentGitBranch = () => {
    const nextBranch = gitCurrentBranch() ?? pickDefaultGitBranch(gitBranches());
    if (!nextBranch) return;
    selectGitBranch(nextBranch);
  };

  const reconcileSelectedGitBranchAfterDetailFailure = () => {
    if (gitBranchDetailState().kind !== 'ready') return;
    void reconcileSelectedGitBranch({ showVerifying: false });
  };

  const selectGitCommit = (hash: string) => {
    setSelectedCommitHash(hash);
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  createEffect(() => {
    const contextKey = String(gitCommitContextKey() ?? '').trim();
    if (!contextKey) return;
    const selectedHash = String(selectedCommitHash() ?? '').trim();
    setGitCommitListCache((prev) => {
      const current = prev[contextKey];
      if (!current || current.selectedCommitHash === selectedHash) {
        return prev;
      }
      return {
        ...prev,
        [contextKey]: {
          ...current,
          selectedCommitHash: selectedHash,
        },
      };
    });
  });

  const busyWorkspaceAction = (): 'stage' | 'unstage' | '' => {
    const scope = gitMutationScope();
    return scope === 'stage' || scope === 'unstage' ? scope : '';
  };

  const formatGitFileCountLabel = (count: number): string => (count === 1 ? '1 file' : `${count} files`);

  const refreshGitWorkspaceSectionsAfterMutation = async (repoRootPath: string, sections: GitWorkspaceViewSection[]) => {
    const wanted = Array.from(new Set(sections));
    await loadGitRepoSummary({ silent: true, repoRootPath });
    const activeSection = selectedGitWorkspaceSection();
    if (gitSubview() === 'changes' && wanted.includes(activeSection)) {
      invalidateInactiveGitWorkspaceSections(wanted, activeSection);
      await loadGitWorkspaceSection(activeSection, { silent: true, repoRootPath, force: true });
      return;
    }
    invalidateGitWorkspaceSections(wanted);
  };

  const runGitMutation = async <T,>(
    scope: GitMutationScope,
    key: string,
    action: () => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>,
  ) => {
    if (!protocol.client()) {
      notification.error('Git unavailable', 'Connection is not ready.');
      return false;
    }
    setGitMutationScope(scope);
    setGitMutationKey(key);
    try {
      const result = await action();
      await onSuccess(result);
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
                : scope === 'switchDetached'
                  ? 'Detach failed'
                  : scope === 'mergeBranch'
                    ? 'Merge failed'
                    : scope === 'deleteBranch'
                      ? 'Delete failed'
                      : scope === 'saveStash'
                        ? 'Stash save failed'
                        : scope === 'applyStash'
                          ? 'Apply stash failed'
                          : scope === 'dropStash'
                            ? 'Delete stash failed'
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
      () => rpc.git.stageWorkspace({
        repoRootPath,
        section: paths.length === 0 ? (uniqueSourceSections[0] === 'conflicted' ? 'conflicted' : 'changes') : undefined,
        paths: paths.length > 0 ? paths : undefined,
      }),
      async () => {
        const impactedSections: GitWorkspaceViewSection[] = uniqueSourceSections.length === 1 && uniqueSourceSections[0] === 'conflicted'
          ? ['conflicted', 'staged']
          : ['changes', 'staged'];
        await refreshGitWorkspaceSectionsAfterMutation(repoRootPath, impactedSections);
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
      () => rpc.git.unstageWorkspace({
        repoRootPath,
        section: paths.length === 0 ? 'staged' : undefined,
        paths: paths.length > 0 ? paths : undefined,
      }),
      async () => {
        await refreshGitWorkspaceSectionsAfterMutation(repoRootPath, ['changes', 'staged']);
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
    const count = workspaceViewSectionCount(gitWorkspace()?.summary ?? gitRepoSummary()?.workspaceSummary, section);
    if (count <= 0) return;
    setSelectedGitWorkspaceSection(section);
    if (section === 'staged') {
      void handleUnstageWorkspacePaths([], workspaceViewSectionActionKey(section), count);
      return;
    }
    if (section === 'changes') {
      void handleStageWorkspacePaths(['unstaged', 'untracked'], [], workspaceViewSectionActionKey(section), count);
      return;
    }
    void handleStageWorkspacePaths(['conflicted'], [], workspaceViewSectionActionKey(section), count);
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
      async (resp) => {
        invalidateGitWorkspaceSections(['staged']);
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
        await refreshGitStateAfterMutation('commit', resp);
        notification.success('Committed', `${resp.headRef || 'HEAD'} ${String(resp.headCommit ?? '').slice(0, 7)}`.trim());
      },
    );
  };

  const handleOpenCommitDialog = () => {
    void loadGitWorkspaceSection('staged', { silent: true });
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
        detached: typeof resp.detached === 'boolean' ? resp.detached : prev.detached,
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
      invalidateGitWorkspaceSections(['changes', 'conflicted', 'staged']);
      if (gitSubview() === 'changes') {
        refreshes.push(loadCurrentGitWorkspaceSection({ silent: true, repoRootPath, force: true }));
      }
    }
    if (plan.refreshBranches) {
      refreshes.push(loadGitBranches({ silent: true, repoRootPath }));
    }
    await Promise.all(refreshes);

    if (plan.refreshCommits) {
      const commitContext = currentGitCommitContext();
      if (!commitContext) return;
      const useBackgroundRefresh = prefersBackgroundGitCommitReload(commitContext);
      lastGitCommitContextKey = '';
      await loadGitCommits(true, commitContext.ref, {
        context: commitContext,
        mode: useBackgroundRefresh ? 'background' : 'blocking',
        repoRootPath,
        silent: useBackgroundRefresh,
      });
    }
  };

  const resolveStashRepoRootPath = (overridePath?: string): string => (
    String(overridePath ?? activeStashRepoRootPath()).trim()
  );

  const loadStashContext = async (options: GitLoadOptions = {}) => {
    const repoRootPath = resolveStashRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++stashContextReqSeq;
    if (!options.silent) {
      setStashContextLoading(true);
      setStashContextError('');
    }
    try {
      const repoSummaryResp = await rpc.git.getRepoSummary({ repoRootPath });
      if (seq !== stashContextReqSeq) return;
      setStashRepoSummary(repoSummaryResp);
      setStashWorkspaceSummary(repoSummaryResp?.workspaceSummary ?? null);
      setStashContextError('');
      return {
        repoSummary: repoSummaryResp,
        workspaceSummary: repoSummaryResp?.workspaceSummary ?? null,
      };
    } catch (err) {
      if (seq !== stashContextReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load stash context');
      if (!options.silent) {
        setStashRepoSummary(null);
        setStashWorkspaceSummary(null);
        setStashContextError(message);
      } else {
        notification.warning('Stash refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === stashContextReqSeq) {
        setStashContextLoading(false);
      }
    }
  };

  const resetStashDetailState = () => {
    setStashDetail(null);
    setStashDetailError('');
  };

  const loadStashList = async (options: GitLoadOptions & { preferredSelectedId?: string; reloadDetail?: boolean } = {}) => {
    const repoRootPath = resolveStashRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++stashListReqSeq;
    if (!options.silent) {
      setStashListLoading(true);
      setStashListError('');
    }
    try {
      const resp = await rpc.git.listStashes({ repoRootPath });
      if (seq !== stashListReqSeq) return;
      const nextItems = Array.isArray(resp?.stashes) ? resp.stashes : [];
      const preferredSelectedId = String(options.preferredSelectedId ?? '').trim();
      const currentSelectedId = String(selectedStashId() ?? '').trim();
      const nextSelectedId = nextItems.some((item) => item.id === preferredSelectedId)
        ? preferredSelectedId
        : nextItems.some((item) => item.id === currentSelectedId)
          ? currentSelectedId
          : (nextItems[0]?.id ?? '');

      setStashList(nextItems);
      setSelectedStashId(nextSelectedId);
      setStashListError('');

      const reviewStashId = String(stashReview()?.preview.stash?.id ?? '').trim();
      if (reviewStashId && reviewStashId !== nextSelectedId) {
        clearStashReview({ cancelInFlight: true });
      }

      if (!nextSelectedId) {
        resetStashDetailState();
      } else if (options.reloadDetail || stashDetail()?.id !== nextSelectedId) {
        resetStashDetailState();
      }
      return resp;
    } catch (err) {
      if (seq !== stashListReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load stashes');
      if (!options.silent) {
        setStashList([]);
        setSelectedStashId('');
        resetStashDetailState();
        setStashListError(message);
      } else {
        notification.warning('Stash refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === stashListReqSeq) {
        setStashListLoading(false);
      }
    }
  };

  const loadStashDetail = async (options: GitLoadOptions & { id?: string } = {}) => {
    const repoRootPath = resolveStashRepoRootPath(options.repoRootPath);
    const stashId = String(options.id ?? selectedStashId() ?? '').trim();
    if (!repoRootPath || !stashId || !protocol.client()) return;
    const seq = ++stashDetailReqSeq;
    if (!options.silent) {
      setStashDetailLoading(true);
      setStashDetailError('');
    }
    try {
      const resp = await rpc.git.getStashDetail({
        repoRootPath,
        id: stashId,
      });
      if (seq !== stashDetailReqSeq) return;
      setStashDetail(resp?.stash ?? null);
      setStashDetailError('');
      return resp;
    } catch (err) {
      if (seq !== stashDetailReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load stash detail');
      if (!options.silent) {
        setStashDetail(null);
        setStashDetailError(message);
      } else {
        notification.warning('Stash refresh incomplete', message);
      }
    } finally {
      if (!options.silent && seq === stashDetailReqSeq) {
        setStashDetailLoading(false);
      }
    }
  };

  const refreshStashWindowData = async (options: GitLoadOptions & { preferredSelectedId?: string; reloadDetail?: boolean } = {}) => {
    const repoRootPath = resolveStashRepoRootPath(options.repoRootPath);
    if (!repoRootPath) return;
    await Promise.all([
      loadStashContext({ silent: Boolean(options.silent), repoRootPath }),
      loadStashList({
        silent: Boolean(options.silent),
        repoRootPath,
        preferredSelectedId: options.preferredSelectedId,
        reloadDetail: options.reloadDetail,
      }),
    ]);
  };

  const refreshActiveGitStateAfterStashMutation = async (
    kind: Extract<GitMutationRefreshKind, 'saveStash' | 'applyStash' | 'dropStash'>,
    targetRepoRootPath: string,
    resp: GitMutationRepoResponse,
  ) => {
    const normalizedTargetPath = String(targetRepoRootPath ?? '').trim();
    const activeRepoRootPath = resolveActiveRepoRootPath();
    if (activeRepoRootPath && activeRepoRootPath === normalizedTargetPath) {
      await refreshGitStateAfterMutation(kind, resp);
    } else {
      const refreshes: Array<Promise<unknown>> = [];
      if (activeRepoRootPath) {
        refreshes.push(loadGitRepoSummary({ silent: true, repoRootPath: activeRepoRootPath }));
        if (pageMode() === 'git' || gitBranches()) {
          refreshes.push(loadGitBranches({ silent: true, repoRootPath: activeRepoRootPath }));
        }
      }
      await Promise.all(refreshes);
    }
    setGitBranchStatusRefreshToken((value) => value + 1);
  };

  const openGitStashWindow = (request: GitStashWindowRequest = {}) => {
    const repoRootPath = String(request.repoRootPath ?? resolveActiveRepoRootPath()).trim();
    if (!repoRootPath) {
      notification.error('Stash unavailable', 'Repository path is unavailable.');
      return;
    }
    const previousRepoRootPath = activeStashRepoRootPath();
    const repoChanged = previousRepoRootPath !== repoRootPath;
    if (repoChanged) {
      stashContextReqSeq += 1;
      stashListReqSeq += 1;
      stashDetailReqSeq += 1;
      setStashRepoSummary(null);
      setStashWorkspaceSummary(null);
      setStashContextError('');
      setStashList([]);
      setStashListError('');
      setSelectedStashId('');
      setStashDetail(null);
      setStashDetailError('');
      setStashSaveMessage('');
      clearStashReview({ cancelInFlight: true });
    }
    setStashWindowContext({
      repoRootPath,
      source: request.source ?? 'header',
    });
    setStashWindowTab(request.tab ?? 'save');
    setStashWindowOpen(true);
    void refreshStashWindowData({
      repoRootPath,
      silent: !repoChanged && Boolean(stashRepoSummary()) && stashList().length > 0,
    });
  };

  const handleStashWindowOpenChange = (open: boolean) => {
    setStashWindowOpen(open);
    if (!open) {
      clearStashReview({ cancelInFlight: true });
    }
  };

  const handleSaveStash = async () => {
    const repoRootPath = activeStashRepoRootPath();
    if (!repoRootPath) return;
    const message = String(stashSaveMessage() ?? '').trim();
    await runGitMutation(
      'saveStash',
      `stash:save:${repoRootPath}`,
      () => rpc.git.saveStash({
        repoRootPath,
        message: message || undefined,
        includeUntracked: stashIncludeUntracked(),
        keepIndex: stashKeepIndex(),
      }),
      async (resp) => {
        setStashWindowTab('stashes');
        setStashSaveMessage('');
        clearStashReview({ cancelInFlight: true });
        await Promise.all([
          refreshActiveGitStateAfterStashMutation('saveStash', repoRootPath, resp),
          refreshStashWindowData({
            repoRootPath,
            preferredSelectedId: resp.created?.id,
            silent: true,
            reloadDetail: true,
          }),
        ]);
        notification.success(
          'Stashed',
          resp.created?.ref
            ? `Saved current changes as ${resp.created.ref}.`
            : 'Saved current changes to the stash stack.',
        );
      },
    );
  };

  const handleRequestApplyStash = async (removeAfterApply: boolean) => {
    const repoRootPath = activeStashRepoRootPath();
    const stashId = String(selectedStashId() ?? '').trim();
    if (!repoRootPath || !stashId || !protocol.client()) return;
    const seq = ++stashReviewReqSeq;
    setStashReviewLoading(true);
    setStashReviewError('');
    try {
      const preview = await rpc.git.previewApplyStash({
        repoRootPath,
        id: stashId,
        removeAfterApply,
      });
      if (seq !== stashReviewReqSeq) return;
      setStashReview({
        kind: 'apply',
        removeAfterApply,
        preview,
        reviewContext: buildGitStashReviewContextFromApplyPreview(preview),
      });
    } catch (err) {
      if (seq !== stashReviewReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to review stash apply');
      setStashReview(null);
      setStashReviewError(message);
      notification.error('Stash review failed', message);
    } finally {
      if (seq === stashReviewReqSeq) {
        setStashReviewLoading(false);
      }
    }
  };

  const handleRequestDropStash = async (options: { id?: string; repoRootPath?: string; notifyOnError?: boolean } = {}) => {
    const repoRootPath = resolveStashRepoRootPath(options.repoRootPath);
    const stashId = String(options.id ?? selectedStashId() ?? '').trim();
    if (!repoRootPath || !stashId || !protocol.client()) return;
    const seq = ++stashReviewReqSeq;
    setStashReviewLoading(true);
    setStashReviewError('');
    try {
      const preview = await rpc.git.previewDropStash({
        repoRootPath,
        id: stashId,
      });
      if (seq !== stashReviewReqSeq) return;
      setStashReview({
        kind: 'drop',
        preview,
        reviewContext: buildGitStashReviewContextFromDropPreview(preview),
      });
    } catch (err) {
      if (seq !== stashReviewReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to review stash deletion');
      setStashReview(null);
      setStashReviewError(message);
      if (options.notifyOnError !== false) {
        notification.error('Stash review failed', message);
      }
    } finally {
      if (seq === stashReviewReqSeq) {
        setStashReviewLoading(false);
      }
    }
  };

  const recoverDropStashError = async (err: unknown, options: { repoRootPath: string; stashId: string }): Promise<boolean> => {
    const { repoRootPath, stashId } = options;
    if (isStashDropPlanStaleError(err)) {
      clearStashReview({ cancelInFlight: true });
      await refreshStashWindowData({
        repoRootPath,
        preferredSelectedId: stashId,
        silent: true,
        reloadDetail: true,
      });
      const stashStillExists = stashList().some((item) => item.id === stashId);
      if (!stashStillExists) {
        notification.info('Stash no longer available', 'The selected stash no longer exists. The stash list was refreshed.');
        return true;
      }
      await handleRequestDropStash({
        id: stashId,
        repoRootPath,
        notifyOnError: false,
      });
      if (stashReviewMatchesTarget(stashReview(), {
        repoRootPath,
        repoSummary: stashRepoSummary(),
        stash: selectedStashSummary(),
      })) {
        notification.info('Delete confirmation refreshed', 'Repository state changed. Confirm deletion again.');
        return true;
      }
      const refreshMessage = String(stashReviewError() ?? '').trim();
      notification.warning('Delete confirmation unavailable', refreshMessage || 'Failed to refresh the delete confirmation. Try Delete again.');
      return true;
    }
    if (isStashNotFoundError(err)) {
      clearStashReview({ cancelInFlight: true });
      await refreshStashWindowData({
        repoRootPath,
        preferredSelectedId: stashId,
        silent: true,
        reloadDetail: true,
      });
      notification.info('Stash no longer available', 'The selected stash no longer exists. The stash list was refreshed.');
      return true;
    }
    return false;
  };

  const handleConfirmStashReview = async () => {
    const review = stashReview();
    const repoRootPath = activeStashRepoRootPath();
    const stashId = String(review?.preview.stash?.id ?? selectedStashId() ?? '').trim();
    if (!review || !repoRootPath || !stashId || !protocol.client()) return;

    setStashReviewError('');
    setGitMutationScope(review.kind === 'drop' ? 'dropStash' : 'applyStash');
    setGitMutationKey(stashId);
    try {
      if (review.kind === 'apply') {
        const resp = await rpc.git.applyStash({
          repoRootPath,
          id: stashId,
          removeAfterApply: review.removeAfterApply,
          planFingerprint: review.preview.planFingerprint,
        });
        clearStashReview({ cancelInFlight: true });
        await Promise.all([
          refreshActiveGitStateAfterStashMutation('applyStash', repoRootPath, resp),
          refreshStashWindowData({
            repoRootPath,
            preferredSelectedId: review.removeAfterApply ? undefined : stashId,
            silent: true,
            reloadDetail: true,
          }),
        ]);
        notification.success(
          review.removeAfterApply ? 'Applied and removed' : 'Applied',
          review.removeAfterApply
            ? 'Applied the stash and removed it from the stack.'
            : 'Applied the selected stash to the current worktree.',
        );
      } else {
        const resp = await rpc.git.dropStash({
          repoRootPath,
          id: stashId,
          planFingerprint: review.preview.planFingerprint,
        });
        clearStashReview({ cancelInFlight: true });
        await Promise.all([
          refreshActiveGitStateAfterStashMutation('dropStash', repoRootPath, resp),
          refreshStashWindowData({
            repoRootPath,
            silent: true,
            reloadDetail: true,
          }),
        ]);
        notification.success('Deleted stash', 'Removed the selected stash from the stack.');
      }
    } catch (err) {
      if (review.kind === 'drop' && await recoverDropStashError(err, { repoRootPath, stashId })) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err ?? 'Request failed.');
      setStashReviewError(message);
      if (err instanceof RpcError && (err.code === 404 || err.code === 409)) {
        void refreshStashWindowData({
          repoRootPath,
          preferredSelectedId: stashId,
          silent: true,
          reloadDetail: true,
        });
      }
      notification.error(review.kind === 'drop' ? 'Delete stash failed' : 'Apply stash failed', message || 'Request failed.');
    } finally {
      setGitMutationScope('');
      setGitMutationKey('');
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

  const handleSwitchDetached = async (target: GitDetachedSwitchTarget) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const commitHash = String(target.commitHash ?? '').trim();
    if (!repoRootPath || !commitHash) return;
    if (target.source === 'branch_history') {
      setGitSubview('history');
    }
    setSelectedCommitHash(commitHash);
    await runGitMutation(
      'switchDetached',
      commitHash,
      () => rpc.git.switchDetached({
        repoRootPath,
        targetRef: commitHash,
      }),
      async (resp) => {
        await refreshGitStateAfterMutation('switchDetached', resp);
        notification.success('Detached HEAD', `Detached HEAD at ${shortGitHash(resp.headCommit || commitHash) || target.shortHash || 'selected commit'}.`);
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

    await loadGitBranches({
      silent: true,
      repoRootPath,
      selectionMode: 'default_if_missing',
    });
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

      await loadGitWorkspaceSection('conflicted', { silent: true, repoRootPath, force: true });
      focusGitWorkspaceSection('conflicted', gitWorkspace());
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
      deleteMode: 'safe' | 'force';
      confirmBranchName?: string;
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
        deleteMode: options.deleteMode,
        confirmBranchName: options.confirmBranchName,
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

  const loadGitWorkspaceSection = async (
    section: GitWorkspaceViewSection,
    options: GitWorkspaceLoadOptions = {},
  ): Promise<GitListWorkspacePageResponse | undefined> => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;

    const currentState = gitWorkspacePageState(section);
    const append = Boolean(options.append);
    const offset = typeof options.offset === 'number'
      ? Math.max(0, options.offset)
      : (append ? currentState.nextOffset : 0);

    if (!options.force) {
      if (append) {
        if (!currentState.initialized || currentState.loading || !currentState.hasMore) {
          return;
        }
      } else if (currentState.initialized && !currentState.loading) {
        return;
      }
    }

    const seq = (gitWorkspaceReqSeqBySection[section] ?? 0) + 1;
    gitWorkspaceReqSeqBySection[section] = seq;

    updateGitWorkspacePageState(section, (state) => ({
      ...state,
      loading: true,
      error: options.silent ? state.error : '',
    }));
    if (!options.silent && selectedGitWorkspaceSection() === section && !append) {
      setGitWorkspaceError('');
    }

    try {
      const resp = await rpc.git.listWorkspacePage({
        repoRootPath,
        section,
        offset,
        limit: GIT_WORKSPACE_PAGE_SIZE,
      });
      if (seq !== gitWorkspaceReqSeqBySection[section]) return;
      applyWorkspacePageSnapshot(resp, { append });
      return resp;
    } catch (err) {
      if (seq !== gitWorkspaceReqSeqBySection[section]) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load workspace changes');
      updateGitWorkspacePageState(section, (state) => ({
        ...state,
        loading: false,
        error: message,
      }));
      if (!options.silent && selectedGitWorkspaceSection() === section && !append) {
        if (!currentState.initialized) {
          setGitWorkspace(null);
          setSelectedGitWorkspaceKey('');
        }
        setGitWorkspaceError(message);
      } else if (options.silent) {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (seq === gitWorkspaceReqSeqBySection[section]) {
        updateGitWorkspacePageState(section, (state) => ({
          ...state,
          loading: false,
        }));
      }
    }
  };

  const loadMoreGitWorkspaceSection = async (section: GitWorkspaceViewSection) => {
    const state = gitWorkspacePageState(section);
    if (!state.initialized || state.loading || !state.hasMore) return;
    return loadGitWorkspaceSection(section, {
      append: true,
      offset: state.nextOffset,
      silent: true,
      force: true,
    });
  };

  const loadCurrentGitWorkspaceSection = async (options: GitWorkspaceLoadOptions = {}) => (
    loadGitWorkspaceSection(selectedGitWorkspaceSection(), options)
  );

  const requestGitBranchesSnapshot = async (repoRootPath: string): Promise<GitListBranchesResponse> => (
    rpc.git.listBranches({ repoRootPath })
  );

  const applyGitBranchesSnapshot = (
    resp: GitListBranchesResponse,
    options: { selectionMode?: GitBranchSelectionMode; requestedKey?: string } = {},
  ): GitBranchSummary | null => {
    const selectionMode = options.selectionMode ?? 'preserve';
    const requestedKey = String(options.requestedKey ?? selectedGitBranchName()).trim();
    const currentBranch = findGitBranchByKey(resp, requestedKey);
    const defaultBranch = pickDefaultGitBranch(resp);

    setGitBranches(resp);

    if (selectionMode === 'default_if_missing') {
      const nextBranch = currentBranch ?? defaultBranch ?? null;
      setSelectedGitBranchName(branchIdentity(nextBranch));
      setSelectedGitBranchSnapshot(nextBranch);
      if (nextBranch) {
        setGitBranchDetailReady(branchIdentity(nextBranch), nextBranch);
      } else {
        setGitBranchDetailIdle();
      }
      return nextBranch;
    }

    if (selectionMode === 'default_if_empty' && !requestedKey) {
      const nextBranch = defaultBranch ?? null;
      setSelectedGitBranchName(branchIdentity(nextBranch));
      setSelectedGitBranchSnapshot(nextBranch);
      if (nextBranch) {
        setGitBranchDetailReady(branchIdentity(nextBranch), nextBranch);
      } else {
        setGitBranchDetailIdle();
      }
      return nextBranch;
    }

    if (currentBranch) {
      rememberSelectedGitBranchSnapshot(currentBranch, requestedKey);
      const state = gitBranchDetailState();
      if (state.kind !== 'idle' && state.requestedKey === requestedKey) {
        setGitBranchDetailReady(requestedKey, currentBranch);
      }
    }

    return currentBranch;
  };

  const reconcileSelectedGitBranch = async (options: {
    repoRootPath?: string;
    requestedKey?: string;
    requestedBranch?: GitBranchSummary | null;
    showVerifying?: boolean;
  } = {}): Promise<boolean> => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    const requestedKey = String(options.requestedKey ?? selectedGitBranchName()).trim();
    const requestedBranch = options.requestedBranch ?? selectedGitBranchDisplay();
    if (!repoRootPath || !protocol.client()) return false;
    if (!requestedKey) {
      setGitBranchDetailIdle();
      return false;
    }

    const seq = ++gitBranchDetailReqSeq;
    if (options.showVerifying !== false) {
      setGitBranchDetailVerifying(requestedKey, requestedBranch);
    }

    try {
      const resp = await requestGitBranchesSnapshot(repoRootPath);
      if (seq !== gitBranchDetailReqSeq) return false;
      const resolvedBranch = applyGitBranchesSnapshot(resp, {
        selectionMode: 'preserve',
        requestedKey,
      });
      if (!resolvedBranch) {
        setGitBranchDetailMissing(requestedKey, requestedBranch);
        return false;
      }
      setGitBranchDetailReady(requestedKey, resolvedBranch);
      return true;
    } catch (err) {
      if (seq !== gitBranchDetailReqSeq) return false;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to verify branch');
      setGitBranchDetailError(requestedKey, requestedBranch, message);
      return false;
    }
  };

  const loadGitBranches = async (options: GitBranchLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitBranchesReqSeq;
    if (!options.silent) {
      setGitBranchesLoading(true);
      setGitBranchesError('');
    }
    try {
      const resp = await requestGitBranchesSnapshot(repoRootPath);
      if (seq !== gitBranchesReqSeq) return;
      applyGitBranchesSnapshot(resp, {
        selectionMode: options.selectionMode ?? 'preserve',
      });
      setSelectedGitBranchSubview((prev) => (prev === 'history' ? 'history' : 'status'));
      return resp;
    } catch (err) {
      if (seq !== gitBranchesReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load branches');
      if (!options.silent) {
        setGitBranches(null);
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
    const repoRootPath = String(nextInfo.repoRootPath ?? '').trim();
    const plan = buildGitActivationRefreshPlan({
      subview: gitSubview(),
      branchSubview: selectedGitBranchSubview(),
    });

    const refreshes: Array<Promise<unknown>> = [];
    if (plan.refreshRepoSummary) {
      refreshes.push(loadGitRepoSummary({
        silent: Boolean(gitRepoSummary()),
        repoRootPath,
      }));
    }
    if (plan.refreshWorkspace) {
      refreshes.push(refreshVisibleGitWorkspaceSection(repoRootPath));
    }
    if (plan.refreshBranches) {
      refreshes.push(refreshVisibleGitBranches(repoRootPath, {
        background: false,
        showVerifying: true,
      }));
    }
    await Promise.all(refreshes);

    if (plan.refreshBranchStatus) {
      setGitBranchStatusRefreshToken((value) => value + 1);
    }

    const commitContext = currentGitCommitContext();
    if (commitContext) {
      const useBackgroundRefresh = prefersBackgroundGitCommitReload(commitContext);
      lastGitCommitContextKey = '';
      void loadGitCommits(true, commitContext.ref, {
        context: commitContext,
        mode: useBackgroundRefresh ? 'background' : 'blocking',
        silent: useBackgroundRefresh,
        repoRootPath,
      });
    }
  };

  const loadGitCommits = async (reset: boolean, ref = gitCommitListRef(), options: GitCommitLoadOptions = {}) => {
    const repoRootPath = resolveActiveRepoRootPath(options.repoRootPath);
    if (!repoRootPath || !protocol.client()) return;
    const seq = ++gitListReqSeq;
    const nextRef = String(ref ?? '').trim();
    const context = options.context ?? createGitCommitContext({
      repoRootPath,
      subview: gitSubview(),
      branchSubview: selectedGitBranchSubview(),
      branch: selectedGitBranch(),
    });
    const contextKey = String(context?.key ?? '').trim();
    const backgroundRefresh = reset && options.mode === 'background';
    if (!options.silent) {
      setGitListError('');
      if (reset) {
        setGitCommitListRef(nextRef);
        if (backgroundRefresh) {
          setGitListRefreshing(true);
        } else {
          setGitListLoading(true);
          setGitListResolved(false);
        }
      } else {
        setGitListLoadingMore(true);
      }
    } else if (backgroundRefresh) {
      setGitListRefreshing(true);
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
      const cachedEntry = readGitCommitCacheEntry(contextKey);
      const existingItems = reset
        ? []
        : (gitCommitContextKey() === contextKey ? gitCommits() : (cachedEntry?.commits ?? []));
      const seenCommitHashes = new Set(existingItems.map((entry) => entry.hash));
      const mergedItems = reset
        ? nextItems
        : [...existingItems, ...nextItems.filter((item) => !seenCommitHashes.has(item.hash))];
      const nextSelectedCommitHash = (() => {
        const currentSelection = gitCommitContextKey() === contextKey
          ? String(selectedCommitHash() ?? '').trim()
          : String(cachedEntry?.selectedCommitHash ?? '').trim();
        if (currentSelection && mergedItems.some((item) => item.hash === currentSelection)) {
          return currentSelection;
        }
        return '';
      })();

      if (contextKey) {
        setGitCommitListCache((prev) => ({
          ...prev,
          [contextKey]: {
            commits: mergedItems,
            hasMore: Boolean(resp?.hasMore),
            nextOffset: Number(resp?.nextOffset ?? 0),
            resolved: true,
            selectedCommitHash: nextSelectedCommitHash,
          },
        }));
      }

      if (!contextKey || gitCommitContextKey() === contextKey) {
        setGitCommits(mergedItems);
        setGitHasMore(Boolean(resp?.hasMore));
        setGitNextOffset(Number(resp?.nextOffset ?? 0));
        setGitListResolved(true);
        if (selectedCommitHash() !== nextSelectedCommitHash) {
          setSelectedCommitHash(nextSelectedCommitHash);
        }
      }
      if (reset) {
        setGitCommitListRef(nextRef);
      }
      return resp;
    } catch (err) {
      if (seq !== gitListReqSeq) return;
      const message = err instanceof Error ? err.message : String(err ?? 'Failed to load commits');
      if (context?.scope === 'branch' && gitSubview() === 'branches' && selectedGitBranchSubview() === 'history') {
        void reconcileSelectedGitBranch({
          requestedKey: selectedGitBranchName(),
          requestedBranch: selectedGitBranchDisplay(),
          showVerifying: false,
        });
      }
      if (!options.silent && !backgroundRefresh) {
        setGitListError(message);
      } else if (!backgroundRefresh) {
        notification.warning('Git refresh incomplete', message);
      }
    } finally {
      if (seq === gitListReqSeq) {
        if (!options.silent && !backgroundRefresh) {
          setGitListLoading(false);
        }
        setGitListLoadingMore(false);
        setGitListRefreshing(false);
      }
    }
  };

  const canEnterGitHistory = () => gitModeDisabledReason() === '';
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
      id: GO_TO_PATH_DROPDOWN_ITEM_ID,
      label: 'Go to path...',
    },
    {
      id: SHOW_HIDDEN_DROPDOWN_ITEM_ID,
      label: 'Show hidden files',
    },
  ]);

  const handleFileBrowserMoreSelect = (itemId: string) => {
    if (itemId === GO_TO_PATH_DROPDOWN_ITEM_ID) {
      setPathEditorRequestKey((value) => value + 1);
      return;
    }
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
      batch(() => {
        clearDirectoryState();
        setShowHidden(nextShowHidden);
        setCurrentBrowserPath(nextPath);
        setLoading(true);
        resetFileBrowser();
      });

      await requestDirectoryNavigation(nextPath, {
        fallbackPath: rootPath,
        persistEnvId: id,
        persistOnReady: true,
        showBlockingOverlay: true,
      });
    })();
  };

  const fileBrowserToolbarEndActions = () => (
    <>
      <Show when={fileBrowserNavigationMessage()}>
        <span class="shrink-0 text-[10px] text-muted-foreground">{fileBrowserNavigationMessage()}</span>
      </Show>
      <Button
        size="sm"
        variant="outline"
        icon={Refresh}
        class="cursor-pointer"
        aria-label="Refresh current directory"
        onClick={() => { void refreshCurrentDirectory({ forceReload: true }); }}
        disabled={!currentBrowserPath().trim() || loading() || !!pendingBrowserPath().trim()}
      >
        Refresh
      </Button>
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
    </>
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
    setPendingCreatedEntryReveal(null);
    resetFileBrowser();

    repoReqSeq += 1;
    if (previousEnvId && previousEnvId !== id) {
      filePreview.closePreview();
    }
    previousEnvId = id;
  });

  const notifyPathLoadFailure = (result: PathLoadResult) => {
    if (result.status === 'canceled' || result.status === 'invalid_path') return;
    notification.error('Failed to load directory', result.message ?? 'Unable to load directory.');
  };

  const prepareDirectoryState = async (
    requestedPath: string,
    seq: number,
    options: {
      targetPolicy?: DirTargetLoadPolicy;
      seed?: DirectoryStateSeed;
      showHiddenOverride?: boolean;
    } = {},
  ): Promise<DirectoryPrepareResult> => {
    if (seq !== dirReqSeq) return { status: 'canceled' };

    if (!protocol.client()) {
      return { status: 'transport_error', message: 'Connection is not ready.' };
    }

    let rootPath = '';
    try {
      rootPath = normalizePath(await resolveFsRootAbs());
    } catch (error) {
      return {
        status: 'transport_error',
        message: error instanceof Error ? error.message : 'Failed to resolve home directory.',
      };
    }

    const normalizedRequestedPath = normalizePath(requestedPath);
    if (normalizedRequestedPath !== rootPath && !normalizedRequestedPath.startsWith(`${rootPath}/`)) {
      return {
        status: 'invalid_path',
        message: 'Path is outside the runtime home directory.',
        rootPath,
      };
    }

    const targetPolicy = options.targetPolicy ?? 'use_cache';
    let nextTree = options.seed?.tree ?? files();
    const nextCache = options.seed?.cache ?? cloneDirCache(cache);

    const rel = normalizedRequestedPath === rootPath ? '' : normalizedRequestedPath.slice(rootPath.length);
    const parts = rel.split('/').filter(Boolean);
    const chain: string[] = [rootPath];
    let cursor = rootPath;
    for (const part of parts) {
      cursor = cursor === '/' ? `/${part}` : `${cursor}/${part}`;
      chain.push(cursor);
    }

    for (const dir of chain) {
      if (seq !== dirReqSeq) return { status: 'canceled' };

      const forceReload = dir === normalizedRequestedPath && (targetPolicy === 'force_reload' || targetPolicy === 'revalidate_target');
      const cachedItems = !forceReload ? nextCache.get(dir) : undefined;
      if (cachedItems) {
        nextTree = withChildrenAtRoot(nextTree, dir, cachedItems, rootPath);
        continue;
      }

      try {
        const resp = await rpc.fs.list({
          path: dir,
          showHidden: options.showHiddenOverride ?? showHidden(),
        });
        if (seq !== dirReqSeq) return { status: 'canceled' };

        const entries = resp?.entries ?? [];
        const items = entries
          .map(toFileItem)
          .sort((a: FileItem, b: FileItem) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
        nextCache.set(dir, items);
        nextTree = withChildrenAtRoot(nextTree, dir, items, rootPath);
      } catch (error) {
        if (seq !== dirReqSeq) return { status: 'canceled' };
        return {
          ...classifyPathLoadError(error),
          rootPath,
        };
      }
    }

    return {
      status: 'ok',
      state: {
        tree: nextTree,
        cache: nextCache,
        rootPath,
        committedPath: normalizedRequestedPath,
        lastLoadedPath: normalizedRequestedPath,
      },
    };
  };

  const resolveDirectoryNavigation = async (
    requestedPath: string,
    seq: number,
    options: Pick<DirectoryNavigationOptions, 'fallbackPath' | 'targetPolicy' | 'seed' | 'allowInvalidTargetFallback' | 'showHiddenOverride'> = {},
  ): Promise<DirectoryNavigationResult> => {
    const normalizedRequestedPath = normalizePath(requestedPath);
    const prepared = await prepareDirectoryState(normalizedRequestedPath, seq, {
      targetPolicy: options.targetPolicy ?? 'use_cache',
      seed: options.seed,
      showHiddenOverride: options.showHiddenOverride,
    });
    if (prepared.status === 'ok') {
      return { status: 'ready', state: prepared.state };
    }
    if (prepared.status === 'canceled') {
      return { status: 'canceled' };
    }
    if (prepared.status !== 'invalid_path' || options.allowInvalidTargetFallback === false) {
      return { status: 'error', result: prepared };
    }

    const rootPath = normalizePath(prepared.rootPath || agentHomePathAbs() || '/');
    const normalizedFallbackPath = options.fallbackPath
      ? normalizePath(options.fallbackPath)
      : '';
    const nextCache = cloneDirCache(cache);
    removeCachePathPrefix(nextCache, normalizedRequestedPath);
    const nextTree = removeItemsFromTree(files(), new Set([normalizedRequestedPath]));
    const fallbackCandidates = buildFallbackDirectoryCandidates(normalizedRequestedPath, rootPath, normalizedFallbackPath);

    for (const candidate of fallbackCandidates) {
      const fallbackPrepared = await prepareDirectoryState(candidate, seq, {
        targetPolicy: 'force_reload',
        seed: {
          tree: nextTree,
          cache: cloneDirCache(nextCache),
        },
        showHiddenOverride: options.showHiddenOverride,
      });
      if (fallbackPrepared.status === 'ok') {
        return { status: 'fallback', state: fallbackPrepared.state };
      }
      if (fallbackPrepared.status === 'canceled') {
        return { status: 'canceled' };
      }
      if (fallbackPrepared.status !== 'invalid_path') {
        return { status: 'error', result: fallbackPrepared };
      }
    }

    return { status: 'error', result: prepared };
  };

  const runDirectoryNavigationRequest = async (
    requestedPath: string,
    options: DirectoryNavigationOptions = {},
  ): Promise<DirectoryNavigationResult> => {
    const normalizedRequestedPath = normalizePath(requestedPath);
    if (pathLoadInFlight() === normalizedRequestedPath) {
      return { status: 'canceled' };
    }

    const seq = ++dirReqSeq;
    setPendingBrowserPath(normalizedRequestedPath);
    setPathLoadInFlight(normalizedRequestedPath);
    if (options.showBlockingOverlay) {
      setLoading(true);
    }
    try {
      const result = await resolveDirectoryNavigation(normalizedRequestedPath, seq, {
        fallbackPath: options.fallbackPath,
        targetPolicy: options.targetPolicy,
        seed: options.seed,
        allowInvalidTargetFallback: options.allowInvalidTargetFallback,
        showHiddenOverride: options.showHiddenOverride,
      });
      if (seq !== dirReqSeq || result.status === 'canceled') {
        return { status: 'canceled' };
      }
      if (result.status === 'error') {
        return result;
      }
      applyPreparedDirectoryState(result.state, {
        persistEnvId: options.persistEnvId && (result.status === 'fallback' || options.persistOnReady === true)
          ? options.persistEnvId
          : undefined,
      });
      return result;
    } finally {
      if (seq === dirReqSeq) {
        setPendingBrowserPath('');
        setPathLoadInFlight('');
        setLoading(false);
      }
    }
  };

  const requestDirectoryNavigation = async (
    requestedPath: string,
    options: DirectoryNavigationOptions = {},
  ): Promise<void> => {
    const result = await runDirectoryNavigationRequest(requestedPath, {
      ...options,
      allowInvalidTargetFallback: options.allowInvalidTargetFallback ?? true,
    });
    if (result.status === 'error') {
      notifyPathLoadFailure(result.result);
    }
  };

  const requestManualDirectoryNavigation = async (requestedPath: string): Promise<ManualDirectoryNavigationResult> => {
    let rootPath = '';
    try {
      rootPath = normalizePath(await resolveFsRootAbs());
    } catch (error) {
      return {
        status: 'transport_error',
        message: error instanceof Error ? error.message : 'Failed to resolve home directory.',
      };
    }

    const id = envId();
    const normalizedRequestedPath = normalizePath(requestedPath);
    const normalizedCurrentPath = normalizeAbsolutePath(currentBrowserPath())
      ? normalizePath(currentBrowserPath())
      : rootPath;
    const nextShowHidden = !showHidden() && pathInputIncludesHiddenSegment(normalizedRequestedPath, rootPath);
    const result = await runDirectoryNavigationRequest(normalizedRequestedPath, {
      fallbackPath: lastLoadedBrowserPath() || rootPath,
      persistEnvId: id || undefined,
      persistOnReady: true,
      targetPolicy: 'revalidate_target',
      allowInvalidTargetFallback: false,
      showHiddenOverride: nextShowHidden ? true : undefined,
      seed: nextShowHidden
        ? {
            tree: files(),
            cache: new Map(),
          }
        : undefined,
    });

    if (result.status === 'canceled') {
      return { status: 'canceled' };
    }
    if (result.status === 'error') {
      return {
        status: result.result.status,
        message: result.result.message ?? 'Unable to open the requested path.',
      };
    }

    if (nextShowHidden) {
      setShowHidden(true);
      if (id) {
        writePersistedShowHidden(id, true);
      }
    }

    return {
      status: normalizedRequestedPath === normalizedCurrentPath ? 'refreshed' : 'ready',
      committedPath: result.state.committedPath,
    };
  };

  const refreshCurrentDirectory = async (options: { forceReload?: boolean } = {}): Promise<void> => {
    const id = envId();
    const path = normalizeAbsolutePath(currentBrowserPath());
    if (!id || !path) return;
    const normalizedPath = normalizePath(path);
    if (pathLoadInFlight() === normalizedPath) return;

    await requestDirectoryNavigation(path, {
      fallbackPath: lastLoadedBrowserPath() || agentHomePathAbs(),
      persistEnvId: id,
      targetPolicy: options.forceReload ? 'force_reload' : 'revalidate_target',
      showBlockingOverlay: lastLoadedBrowserPath() === '',
    });
  };

  const fileBrowserNavigationMessage = createMemo(() => {
    const pendingPath = normalizeAbsolutePath(pendingBrowserPath());
    if (!pendingPath) return '';
    const currentPath = normalizeAbsolutePath(currentBrowserPath());
    return normalizePath(pendingPath) === normalizePath(currentPath) ? 'Refreshing...' : 'Opening...';
  });

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
        if (item.type === 'folder') {
          removeCachePathPrefix(cache, item.path);
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

  const resolveValidatedEntryName = (value: string, failureTitle: string): string | null => {
    const nextName = String(value ?? '').trim();
    const validationError = validateFileBrowserEntryName(nextName);
    if (validationError) {
      notification.error(failureTitle, validationError);
      return null;
    }
    return nextName;
  };

  const insertCreatedItemIntoState = (parentDirPath: string, item: FileItem) => {
    const parentDir = normalizePath(parentDirPath);
    const scopedRootPath = normalizePath(agentHomePathAbs() || parentDir);
    const cached = cache.get(parentDir);

    if (cached && !cached.some((entry) => normalizePath(entry.path) === normalizePath(item.path))) {
      cache.set(parentDir, sortFileItems([...cached, item]));
    }

    if (canInsertIntoTree(files(), parentDir, scopedRootPath)) {
      setFiles((prev) => insertItemToTree(prev, parentDir, item, scopedRootPath));
    }
  };

  const buildCreatedItem = (kind: CreateEntryKind, parentDir: string, name: string): FileItem => {
    const path = buildChildPath(parentDir, name);
    return {
      id: path,
      name,
      type: kind === 'folder' ? 'folder' : 'file',
      path,
      extension: kind === 'file' ? extNoDot(name) : undefined,
      children: kind === 'folder' ? [] : undefined,
    };
  };

  const buildCreatedEntryReveal = (itemPath: string, parentDir: string): FileBrowserRevealRequest => {
    const targetPath = normalizePath(itemPath);
    return {
      requestId: `created-entry-${++createdEntryRevealSeq}`,
      targetId: targetPath,
      targetPath,
      parentPath: normalizePath(parentDir),
      clearFilter: 'if-needed',
    };
  };

  const resolveDirectoryContextTarget = (event?: ContextMenuEvent | null) => {
    const directoryPath = normalizeAbsolutePath(event?.directory?.path ?? '');
    if (!directoryPath) return null;

    const item = event?.directory?.item?.type === 'folder'
      ? event.directory.item
      : undefined;

    return {
      path: directoryPath,
      item,
      preferredName: item?.name || fileNameFromPath(directoryPath) || undefined,
    };
  };

  const askFlowerFromDirectoryContext = (event?: ContextMenuEvent | null) => {
    const directory = resolveDirectoryContextTarget(event);
    if (!directory) {
      notification.error('Ask Flower unavailable', 'Failed to resolve the target directory.');
      return;
    }

    const result = buildFilePathAskFlowerIntent({
      items: [{
        path: directory.path,
        isDirectory: true,
      }],
      fallbackWorkingDirAbs: directory.path,
    });
    if (!result.intent) {
      notification.error('Ask Flower unavailable', result.error ?? 'Failed to resolve selected file paths.');
      return;
    }

    dispatchAskFlowerIntent(result.intent);
  };

  const handleRename = async (item: FileItem, newName: string) => {
    const client = protocol.client();
    if (!client) return;

    const nextName = resolveValidatedEntryName(newName, 'Rename failed');
    if (!nextName) return;
    if (nextName === item.name) {
      setRenameDialogOpen(false);
      setRenameDialogItem(null);
      return;
    }

    const parentDir = getParentDir(item.path);
    const newPath = buildChildPath(parentDir, nextName);
    const newExt = item.type === 'file' ? extNoDot(nextName) : undefined;

    setRenameLoading(true);

    try {
      await rpc.fs.rename({ oldPath: item.path, newPath });
      const updates: Partial<FileItem> = {
        name: nextName,
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

      setRenameDialogOpen(false);
      setRenameDialogItem(null);
      notification.success('Renamed', `"${item.name}" renamed to "${nextName}".`);
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
    const destPath = buildChildPath(parentDir, newName);
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

  const handleCreateEntry = async (name: string) => {
    const client = protocol.client();
    const draft = createDialogDraft();
    if (!client || !draft) return;

    const nextName = resolveValidatedEntryName(name, 'Create failed');
    if (!nextName) return;

    const finalPath = buildChildPath(draft.parentDir, nextName);
    setCreateLoading(true);

    try {
      if (draft.kind === 'file') {
        await rpc.fs.writeFile({
          path: finalPath,
          content: '',
          createDirs: false,
        });
      } else {
        await rpc.fs.mkdir({
          path: finalPath,
          createParents: false,
        });
      }

      const newItem = buildCreatedItem(draft.kind, draft.parentDir, nextName);
      const revealRequest = buildCreatedEntryReveal(newItem.path, draft.parentDir);
      insertCreatedItemIntoState(draft.parentDir, newItem);
      batch(() => {
        setCreateDialogOpen(false);
        setCreateDialogDraft(null);
        setPendingCreatedEntryReveal(revealRequest);
      });

      if (normalizePath(currentBrowserPath()) !== normalizePath(draft.parentDir)) {
        await requestDirectoryNavigation(draft.parentDir, {
          fallbackPath: lastLoadedBrowserPath() || agentHomePathAbs(),
          persistEnvId: envId(),
          persistOnReady: true,
          targetPolicy: 'revalidate_target',
        });

        if (normalizePath(currentBrowserPath()) !== normalizePath(draft.parentDir)) {
          setPendingCreatedEntryReveal((current) => current?.requestId === revealRequest.requestId ? null : current);
        }
      }

      notification.success('Created', `"${nextName}" created.`);
    } catch (e) {
      notification.error('Create failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCreateLoading(false);
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
    if (loading() || pathLoadInFlight() === normalizedPath || lastLoadedBrowserPath() === normalizedPath) return;

    void refreshCurrentDirectory();
  });

  createEffect(() => {
    const id = envId();
    const client = protocol.client();
    const path = currentBrowserPath();
    if (!id || !client || !path.trim()) {
      repoReqSeq += 1;
      setRepoInfo(null);
      setRepoInfoLoading(false);
      setRepoInfoResolved(false);
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
    const nextRepoRootPath = String(info?.repoRootPath ?? '').trim();
    const previousRepoRootPath = lastGitRepoKey ? String(lastGitRepoKey.split('|')[0] ?? '').trim() : '';
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
    if (previousRepoRootPath && nextRepoRootPath && previousRepoRootPath !== nextRepoRootPath) {
      setSelectedGitBranchName('');
      setSelectedGitBranchSnapshot(null);
      setGitBranchDetailIdle();
      setSelectedGitBranchSubview('status');
    }
    lastGitRepoKey = repoKey;
    lastGitCommitContextKey = '';
    void loadGitRepoSummary({ silent: Boolean(gitRepoSummary()) });
    if (gitSubview() === 'changes') {
      invalidateGitWorkspaceSections(['changes', 'conflicted', 'staged']);
      void loadCurrentGitWorkspaceSection({ silent: Boolean(gitWorkspace()), force: true });
    }
    if (gitSubview() === 'branches') {
      void loadGitBranches({ silent: Boolean(gitBranches()), selectionMode: 'default_if_empty' });
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
    if (subview === 'changes') {
      const section = selectedGitWorkspaceSection();
      const sectionState = gitWorkspacePageState(section);
      if (!sectionState.initialized && !sectionState.loading) {
        void loadGitWorkspaceSection(section);
      }
    }
    if (subview === 'branches' && !gitBranches() && !gitBranchesLoading()) {
      void loadGitBranches({ selectionMode: 'default_if_empty' });
    }
  });

  createEffect(() => {
    const mode = pageMode();
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const context = currentGitCommitContext();

    if (mode !== 'git' || !repoRootPath) {
      lastGitCommitContextKey = '';
      return;
    }
    if (!context) {
      lastGitCommitContextKey = '';
      setGitListRefreshing(false);
      return;
    }

    if (context.key === lastGitCommitContextKey) {
      return;
    }
    lastGitCommitContextKey = context.key;
    const hasCachedContext = restoreGitCommitContextFromCache(context);
    void loadGitCommits(true, context.ref, {
      context,
      mode: hasCachedContext ? 'background' : 'blocking',
      silent: hasCachedContext,
    });
  });

  createEffect(() => {
    const mode = pageMode();
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const subview = normalizeGitActivationSubview(gitSubview());
    const activationKey = mode === 'git' && repoRootPath ? subview : '';
    if (!activationKey) {
      lastGitSubviewActivationKey = '';
      return;
    }
    if (activationKey === lastGitSubviewActivationKey) {
      return;
    }
    lastGitSubviewActivationKey = activationKey;
    void refreshActivatedGitSubview(repoRootPath);
  });

  createEffect(() => {
    const mode = pageMode();
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    const subview = normalizeGitActivationSubview(gitSubview());
    const branchSubview = selectedGitBranchSubview();
    const activationKey = mode === 'git' && repoRootPath && subview === 'branches' && branchSubview === 'status'
      ? `${subview}:${branchSubview}`
      : '';
    if (!activationKey) {
      lastGitBranchStatusActivationKey = '';
      return;
    }
    if (activationKey === lastGitBranchStatusActivationKey) {
      return;
    }
    lastGitBranchStatusActivationKey = activationKey;
    if (selectedGitBranchName().trim()) {
      setGitBranchStatusRefreshToken((value) => value + 1);
    }
  });

  createEffect(() => {
    const open = stashWindowOpen();
    const repoRootPath = activeStashRepoRootPath();
    const tab = stashWindowTab();
    const stashId = String(selectedStashId() ?? '').trim();

    if (!open || !repoRootPath || tab !== 'stashes') return;
    if (!stashId) {
      stashDetailReqSeq += 1;
      setStashDetail(null);
      setStashDetailLoading(false);
      setStashDetailError('');
      return;
    }
    if (stashDetail()?.id === stashId && !stashDetailError()) return;
    void loadStashDetail({
      repoRootPath,
      id: stashId,
      silent: Boolean(stashDetail()),
    });
  });

  createEffect(() => {
    const review = stashReview();
    if (!review) return;
    if (stashReviewMatchesTarget(review, {
      repoRootPath: activeStashRepoRootPath(),
      repoSummary: stashRepoSummary(),
      stash: selectedStashSummary(),
    })) {
      return;
    }
    clearStashReview({ cancelInFlight: true });
  });

  const dispatchAskFlowerIntent = (intent: AskFlowerIntent) => {
    ctx.openAskFlowerComposer(intent);
  };

  const handleGitAskFlower = (request: GitAskFlowerRequest) => {
    const result = buildGitAskFlowerIntent(request);
    if (!result.intent) {
      notification.error('Ask Flower unavailable', result.error ?? 'Failed to build Git context.');
      return;
    }
    dispatchAskFlowerIntent(result.intent);
  };

  const handleGitOpenInTerminal = (request: GitDirectoryShortcutRequest) => {
    openDirectoryInTerminal({
      path: request.path,
      preferredName: request.preferredName,
      openTerminalInDirectory: ctx.openTerminalInDirectory,
      onInvalidDirectory: () => {
        notification.error('Invalid directory', 'Could not resolve a terminal working directory.');
      },
    });
  };

  const handleGitBrowseFiles = async (request: GitDirectoryShortcutRequest) => {
    const path = normalizeAbsolutePath(request.path);
    const homePath = normalizeAbsolutePath(request.homePath ?? '') || agentHomePathAbs() || undefined;
    if (!path) {
      notification.error('Browse files unavailable', 'Could not resolve a valid directory path.');
      return;
    }

    await fileBrowserSurface.openBrowser({
      path,
      homePath,
      title: request.title,
    });
  };

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
      const file = setAskFlowerAttachmentSourcePath(new File([bytes], item.name || 'attachment', {
        type: mime,
        lastModified: item.modifiedAt?.getTime() ?? Date.now(),
      }), normalizedPath);
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

    const result = buildFilePathAskFlowerIntent({
      items: normalizedItems.map((item) => ({
        path: item.path,
        isDirectory: item.type === 'folder',
      })),
      fallbackWorkingDirAbs: currentBrowserPath(),
      pendingAttachments,
      notes,
    });
    if (!result.intent) {
      notification.error('Ask Flower unavailable', result.error ?? 'Failed to resolve selected file paths.');
      return;
    }

    dispatchAskFlowerIntent(result.intent);
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

  const handleCopyPath = (items: FileItem[]) => {
    void (async () => {
      try {
        const result = await copyFileBrowserItemPaths(items);
        notification.success('Copied', describeCopiedFileBrowserItemPaths(result));
      } catch (e) {
        notification.error('Copy failed', e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const canOpenDirectoryContextInTerminal = (event?: ContextMenuEvent | null) => {
    const directory = resolveDirectoryContextTarget(event);
    return Boolean(
      directory
      && ctx.env()?.permissions?.can_execute
      && canOpenDirectoryPathInTerminal(directory.path)
    );
  };

  const handleOpenDirectoryContextInTerminal = (event?: ContextMenuEvent | null) => {
    const directory = resolveDirectoryContextTarget(event);
    if (!directory) return;

    openDirectoryInTerminal({
      path: directory.path,
      preferredName: directory.preferredName,
      openTerminalInDirectory: ctx.openTerminalInDirectory,
      onInvalidDirectory: () => {
        notification.error('Invalid directory', 'Could not resolve a terminal working directory.');
      },
    });
  };

  const openCreateEntryDialog = (kind: CreateEntryKind, event?: ContextMenuEvent | null) => {
    const directory = resolveDirectoryContextTarget(event);
    if (!directory) {
      notification.error('Create unavailable', 'Could not resolve the target directory.');
      return;
    }

    setCreateDialogDraft({
      kind,
      parentDir: directory.path,
      initialName: '',
    });
    setCreateDialogOpen(true);
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
    onCopyName: (items: FileItem[]) => {
      handleCopyName(items);
    },
  };

  const secondaryOverrideContextMenuItems: ContextMenuItem[] = [
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
      id: 'copy-path',
      label: 'Copy Path',
      type: 'custom',
      icon: (props) => <ClipboardIcon class={props.class} />,
      onAction: (items: FileItem[]) => {
        handleCopyPath(items);
      },
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

  type FileBrowserContextMenuScope =
    | 'directory-background'
    | 'single-file'
    | 'single-folder'
    | 'multi-select';

  const singleSelectSecondaryContextMenuItemIds = new Set([
    'duplicate',
    'copy-name',
    'copy-path',
    'rename',
    'delete',
  ]);

  const multiSelectSecondaryContextMenuItemIds = new Set([
    'duplicate',
    'copy-name',
    'copy-path',
    'delete',
  ]);

  const filterSecondaryContextMenuItems = (allowedIds: ReadonlySet<string>): ContextMenuItem[] => (
    secondaryOverrideContextMenuItems.filter((item) => allowedIds.has(item.id))
  );

  const resolveContextMenuScope = (event: ContextMenuEvent | null): FileBrowserContextMenuScope | null => {
    if (!event) return null;

    if (event.targetKind === 'directory-background' && resolveDirectoryContextTarget(event)) {
      return 'directory-background';
    }

    if (event.items.length > 1) {
      return 'multi-select';
    }

    const item = event.items[0];
    if (!item) return null;
    return item.type === 'folder' ? 'single-folder' : 'single-file';
  };

  const buildAskFlowerMenuItem = (options?: {
    separator?: boolean;
    onAction?: (items: FileItem[], event?: ContextMenuEvent) => void;
  }): ContextMenuItem => ({
    id: 'ask-flower',
    label: 'Ask Flower',
    type: 'custom',
    icon: (props) => <FlowerContextMenuIcon class={props.class} />,
    separator: options?.separator,
    onAction: (items, event) => {
      if (options?.onAction) {
        options.onAction(items, event);
        return;
      }
      void askFlowerFromFileBrowser(items);
    },
  });

  const buildOpenInTerminalMenuItem = (): ContextMenuItem => ({
    id: 'open-in-terminal',
    label: 'Open in Terminal',
    type: 'custom',
    icon: (props) => <Terminal class={props.class} />,
    onAction: (_items, event) => {
      handleOpenDirectoryContextInTerminal(event);
    },
  });

  const buildNewContextMenuItem = (separator = false): ContextMenuItem => ({
    id: 'new',
    label: 'New',
    type: 'custom',
    icon: (props) => <Plus class={props.class} />,
    separator,
    children: [
      {
        id: 'new-file',
        label: 'File',
        type: 'custom',
        onAction: (_items, event) => {
          openCreateEntryDialog('file', event);
        },
      },
      {
        id: 'new-folder',
        label: 'Folder',
        type: 'custom',
        onAction: (_items, event) => {
          openCreateEntryDialog('folder', event);
        },
      },
    ],
  });

  const resolveOverrideContextMenuItems = (event: ContextMenuEvent | null): ContextMenuItem[] => {
    const scope = resolveContextMenuScope(event);
    if (!event || !scope) return [];

    if (scope === 'directory-background') {
      const backgroundItems: ContextMenuItem[] = [
        buildAskFlowerMenuItem({
          onAction: (_items, menuEvent) => {
            askFlowerFromDirectoryContext(menuEvent);
          },
        }),
      ];
      if (canOpenDirectoryContextInTerminal(event)) {
        backgroundItems.push(buildOpenInTerminalMenuItem());
      }
      backgroundItems.push(buildNewContextMenuItem());
      return backgroundItems;
    }

    if (scope === 'single-folder') {
      const folderItems: ContextMenuItem[] = [
        buildAskFlowerMenuItem(),
      ];
      if (canOpenDirectoryContextInTerminal(event)) {
        folderItems.push(buildOpenInTerminalMenuItem());
      }
      folderItems.push(buildNewContextMenuItem(true));
      return [...folderItems, ...filterSecondaryContextMenuItems(singleSelectSecondaryContextMenuItemIds)];
    }

    return [
      buildAskFlowerMenuItem({ separator: true }),
      ...filterSecondaryContextMenuItems(
        scope === 'multi-select'
          ? multiSelectSecondaryContextMenuItemIds
          : singleSelectSecondaryContextMenuItemIds,
      ),
    ];
  };

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
                      gitHistoryDisabledReason={gitModeDisabledReason() || undefined}
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
                      pathEditRequestKey={pathEditorRequestKey()}
                      toolbarEndActions={fileBrowserToolbarEndActions()}
                      revealRequest={pendingCreatedEntryReveal()}
                      onRevealRequestConsumed={(requestId) => {
                        setPendingCreatedEntryReveal((current) => current?.requestId === requestId ? null : current);
                      }}
                      onNavigate={(path) => {
                        const targetPath = normalizePath(path);
                        void requestDirectoryNavigation(targetPath, {
                          fallbackPath: lastLoadedBrowserPath() || agentHomePathAbs(),
                          persistEnvId: id,
                          persistOnReady: true,
                          targetPolicy: 'revalidate_target',
                        });
                      }}
                      onPathChange={(_path, source) => {
                        if (source === 'user' && layout.isMobile()) {
                          closePageSidebar();
                        }
                      }}
                      onPathSubmit={async (path): Promise<FileBrowserPathSubmitResult> => {
                        const result = await requestManualDirectoryNavigation(path);
                        switch (result.status) {
                          case 'ready':
                          case 'refreshed':
                            return result;
                          case 'canceled':
                            return {
                              status: 'error',
                              message: 'Path navigation was canceled.',
                            };
                          case 'invalid_path':
                          case 'permission_denied':
                          case 'transport_error':
                            return {
                              status: 'error',
                              message: result.message,
                            };
                        }
                      }}
                      onOpen={(item) => void filePreview.openPreview(item)}
                      onDragMove={(items, targetPath) => void handleDragMove(items, targetPath)}
                      contextMenuCallbacks={ctxMenu}
                      resolveOverrideContextMenuItems={resolveOverrideContextMenuItems}
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
                      gitHistoryDisabledReason={gitModeDisabledReason() || undefined}
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
                      repoUnavailableReason={repoUnavailableReason() || undefined}
                      repoSummary={gitRepoSummary()}
                      repoSummaryLoading={gitRepoSummaryLoading()}
                      repoSummaryError={gitRepoSummaryError()}
                      workspace={gitWorkspace()}
                      workspacePages={gitWorkspacePages()}
                      workspaceLoading={gitWorkspaceLoading()}
                      workspaceError={gitWorkspaceError()}
                      selectedWorkspaceSection={selectedGitWorkspaceSection()}
                      onSelectWorkspaceSection={selectGitWorkspaceSection}
                      selectedWorkspaceItem={selectedGitWorkspaceItem()}
                      onSelectWorkspaceItem={selectGitWorkspaceItem}
                      onStageWorkspaceItem={handleStageWorkspaceItem}
                      onUnstageWorkspaceItem={handleUnstageWorkspaceItem}
                      onBulkWorkspaceAction={handleBulkWorkspaceAction}
                      onOpenStash={openGitStashWindow}
                      onAskFlower={handleGitAskFlower}
                      onOpenInTerminal={ctx.env()?.permissions?.can_execute ? handleGitOpenInTerminal : undefined}
                      onBrowseFiles={handleGitBrowseFiles}
                      busyWorkspaceKey={gitMutationKey()}
                      busyWorkspaceAction={busyWorkspaceAction()}
                      branches={gitBranches()}
                      branchesLoading={gitBranchesLoading()}
                      branchesError={gitBranchesError()}
                      statusRefreshToken={gitBranchStatusRefreshToken()}
                      selectedBranch={selectedGitBranchDisplay()}
                      branchDetailState={gitBranchPresentationState()}
                      selectedBranchKey={selectedGitBranchName()}
                      onSelectBranch={selectGitBranch}
                      selectedBranchSubview={selectedGitBranchSubview()}
                      onSelectBranchSubview={selectGitBranchSubview}
                      onRefreshSelectedBranch={refreshSelectedGitBranch}
                      onSelectCurrentBranch={selectCurrentGitBranch}
                      onBranchDetailLoadFailure={reconcileSelectedGitBranchAfterDetailFailure}
                      commits={gitCommits()}
                      listLoading={gitListLoading()}
                      listRefreshing={gitListRefreshing()}
                      listLoadingMore={gitListLoadingMore()}
                      listError={gitListError()}
                      hasMore={gitHasMore()}
                      selectedCommitHash={selectedCommitHash()}
                      onSelectCommit={selectGitCommit}
                      onLoadMore={() => void loadGitCommits(false)}
                      switchDetachedBusy={gitMutationScope() === 'switchDetached'}
                      commitMessage={gitCommitMessage()}
                      commitBusy={gitMutationScope() === 'commit'}
                      onCommitMessageChange={setGitCommitMessage}
                      onCommit={(message) => { void handleCommitWorkspace(message); }}
                      onLoadMoreWorkspaceSection={(section) => { void loadMoreGitWorkspaceSection(section); }}
                      onOpenCommitDialog={handleOpenCommitDialog}
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
                      onSwitchDetached={(target) => { void handleSwitchDetached(target); }}
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

      <GitStashWindow
        open={stashWindowOpen()}
        onOpenChange={handleStashWindowOpenChange}
        tab={stashWindowTab()}
        onTabChange={setStashWindowTab}
        repoRootPath={activeStashRepoRootPath()}
        source={activeStashSource()}
        repoSummary={stashRepoSummary()}
        workspaceSummary={stashWorkspaceSummary()}
        contextLoading={stashContextLoading()}
        contextError={stashContextError()}
        stashes={stashList()}
        stashesLoading={stashListLoading()}
        stashesError={stashListError()}
        selectedStashId={selectedStashId()}
        onSelectStash={(id) => {
          setSelectedStashId(id);
          if (stashReview()?.preview.stash?.id !== id) {
            clearStashReview({ cancelInFlight: true });
          }
        }}
        stashDetail={stashDetail()}
        stashDetailLoading={stashDetailLoading()}
        stashDetailError={stashDetailError()}
        saveMessage={stashSaveMessage()}
        includeUntracked={stashIncludeUntracked()}
        keepIndex={stashKeepIndex()}
        saveBusy={gitMutationScope() === 'saveStash'}
        applyBusy={gitMutationScope() === 'applyStash'}
        dropBusy={gitMutationScope() === 'dropStash'}
        reviewLoading={stashReviewLoading()}
        review={stashReview()}
        reviewError={stashReviewError()}
        onSaveMessageChange={setStashSaveMessage}
        onIncludeUntrackedChange={setStashIncludeUntracked}
        onKeepIndexChange={setStashKeepIndex}
        onSave={() => { void handleSaveStash(); }}
        onRefreshStashes={() => {
          void refreshStashWindowData({
            repoRootPath: activeStashRepoRootPath(),
            reloadDetail: true,
          });
        }}
        onRequestApply={(removeAfterApply) => {
          void handleRequestApplyStash(removeAfterApply);
        }}
        onRequestDrop={() => {
          void handleRequestDropStash();
        }}
        onConfirmReview={() => {
          void handleConfirmStashReview();
        }}
        onCancelReview={() => clearStashReview({ cancelInFlight: true })}
      />

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

      {/* Create Dialog */}
      <InputDialog
        open={createDialogOpen()}
        title={createDialogDraft()?.kind === 'folder' ? 'New Folder' : 'New File'}
        label={createDialogDraft()?.kind === 'folder' ? 'Folder name' : 'File name'}
        value={createDialogDraft()?.initialName ?? ''}
        placeholder={createDialogDraft()?.kind === 'folder' ? 'new-folder' : 'README.md'}
        confirmText="Create"
        loading={createLoading()}
        onConfirm={(name) => {
          void handleCreateEntry(name);
        }}
        onCancel={() => {
          setCreateDialogOpen(false);
          setCreateDialogDraft(null);
        }}
      />

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
        onCancel={() => {
          setRenameDialogOpen(false);
          setRenameDialogItem(null);
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
