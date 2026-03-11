import { For, Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { useDeck, useLayout, useNotification, useResolvedFloeConfig } from '@floegence/floe-webapp-core';
import { ArrowRightLeft, Copy, Folder, Pencil, Sparkles, Trash } from '@floegence/floe-webapp-core/icons';
import { type ContextMenuCallbacks, type ContextMenuItem, type FileItem } from '@floegence/floe-webapp-core/file-browser';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, ConfirmDialog, DirectoryPicker, FileSavePicker, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { Client } from '@floegence/flowersec-core';
import { DEFAULT_MAX_JSON_FRAME_BYTES, readJsonFrame, writeJsonFrame } from '@floegence/flowersec-core/framing';
import { ByteReader, type YamuxStream } from '@floegence/flowersec-core/yamux';
import { RpcError, useProtocol } from '@floegence/floe-webapp-protocol';
import {
  useRedevenRpc,
  type GitBranchSummary,
  type GitCommitSummary,
  type GitListBranchesResponse,
  type GitListWorkspaceChangesResponse,
  type GitRepoSummaryResponse,
  type GitResolveRepoResponse,
  type GitWorkspaceChange,
  type GitWorkspaceSection,
} from '../protocol/redeven_v1';
import { getExtDot, isLikelyTextContent, mimeFromExtDot, previewModeByName, type PreviewMode } from '../utils/filePreview';
import { readFileBytesOnce, normalizeRespMeta, byteReaderFromStream, type FsReadFileStreamMeta, type FsReadFileStreamRespMeta } from '../utils/fileStreamReader';
import { useEnvContext } from '../pages/EnvContext';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import {
  deriveAbsoluteWorkingDirFromItems,
  deriveVirtualWorkingDirFromItems,
  dirnameAbsolute,
  dirnameVirtual,
  normalizeAbsolutePath,
  normalizeVirtualPath as normalizeAskFlowerVirtualPath,
  virtualPathToAbsolutePath,
} from '../utils/askFlowerPath';
import { InputDialog } from './InputDialog';
import { type GitHistoryMode } from './GitHistoryModeSwitch';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { GitWorkspace } from './GitWorkspace';
import {
  applyWorkspaceSectionMutation,
  branchIdentity,
  findGitBranchByKey,
  findWorkspaceChangeByKey,
  recountWorkspaceSummary,
  summarizeWorkspaceCount,
  type GitBranchSubview,
  pickDefaultGitBranch,
  pickDefaultWorkspaceChange,
  pickDefaultWorkspaceSection,
  unstageWorkspaceDestination,
  workspaceSectionActionKey,
  workspaceSectionItems,
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
  withChildren,
} from './FileBrowserShared';

type DirCache = Map<string, FileItem[]>;

type PathLoadStatus = 'ok' | 'canceled' | 'invalid_path' | 'permission_denied' | 'transport_error';

type PathLoadResult = {
  status: PathLoadStatus;
  message?: string;
};

type BrowserPageMode = GitHistoryMode;

const JSON_FRAME_MAX_BYTES = DEFAULT_MAX_JSON_FRAME_BYTES;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
const ASK_FLOWER_MAX_ATTACHMENTS = 5;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ASK_FLOWER_MAX_INLINE_SELECTION_CHARS = 10_000;
const GIT_COMMIT_PAGE_SIZE = 50;
const PAGE_SIDEBAR_DEFAULT_WIDTH = 240;
const PAGE_SIDEBAR_MIN_WIDTH = 180;
const PAGE_SIDEBAR_MAX_WIDTH = 520;
const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';
const PAGE_MODE_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:page-mode:';
const GIT_SUBVIEW_STORAGE_KEY_PREFIX = 'redeven:remote-file-browser:git-subview:';

type GitMutationScope = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'checkout' | '';

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

export interface RemoteFileBrowserProps {
  widgetId?: string;
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

function downloadBlob(params: { name: string; blob: Blob }) {
  const url = URL.createObjectURL(params.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.name || 'download';
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function RemoteFileBrowser(props: RemoteFileBrowserProps = {}) {
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const ctx = useEnvContext();
  const deck = useDeck();
  const floe = useResolvedFloeConfig();
  const layout = useLayout();
  const notification = useNotification();

  const envId = () => (ctx.env_id() ?? '').trim();
  const useExternalMobileSidebarToggle = () => !props.widgetId;

  const [files, setFiles] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(false);

  let cache: DirCache = new Map();

  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewItem, setPreviewItem] = createSignal<FileItem | null>(null);
  const [previewMode, setPreviewMode] = createSignal<PreviewMode>('text');
  const [previewText, setPreviewText] = createSignal('');
  const [previewMessage, setPreviewMessage] = createSignal('');
  const [previewObjectUrl, setPreviewObjectUrl] = createSignal('');
  const [previewBytes, setPreviewBytes] = createSignal<Uint8Array<ArrayBuffer> | null>(null);
  const [previewTruncated, setPreviewTruncated] = createSignal(false);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewAskMenu, setPreviewAskMenu] = createSignal<{ x: number; y: number; selection: string } | null>(null);

  const [xlsxSheetName, setXlsxSheetName] = createSignal('');
  const [xlsxRows, setXlsxRows] = createSignal<string[][]>([]);

  const [downloadLoading, setDownloadLoading] = createSignal(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteDialogItems, setDeleteDialogItems] = createSignal<FileItem[]>([]);
  const [deleteLoading, setDeleteLoading] = createSignal(false);

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [renameDialogItem, setRenameDialogItem] = createSignal<FileItem | null>(null);
  const [renameLoading, setRenameLoading] = createSignal(false);

  const [moveToDialogOpen, setMoveToDialogOpen] = createSignal(false);
  const [moveToDialogItem, setMoveToDialogItem] = createSignal<FileItem | null>(null);
  const [moveToLoading, setMoveToLoading] = createSignal(false);

  const [duplicateLoading, setDuplicateLoading] = createSignal(false);

  const [dragMoveLoading, setDragMoveLoading] = createSignal(false);
  const [fileBrowserResetSeq, setFileBrowserResetSeq] = createSignal(0);

  const [copyToDialogOpen, setCopyToDialogOpen] = createSignal(false);
  const [copyToDialogItem, setCopyToDialogItem] = createSignal<FileItem | null>(null);
  const [copyToLoading, setCopyToLoading] = createSignal(false);

  const [currentBrowserPath, setCurrentBrowserPath] = createSignal('/');
  const [lastLoadedBrowserPath, setLastLoadedBrowserPath] = createSignal('/');

  const [fsRootAbs, setFsRootAbs] = createSignal('');
  const [pageMode, setPageMode] = createSignal<BrowserPageMode>('files');
  const [repoInfo, setRepoInfo] = createSignal<GitResolveRepoResponse | null>(null);
  const [repoInfoLoading, setRepoInfoLoading] = createSignal(false);
  const [repoInfoResolved, setRepoInfoResolved] = createSignal(false);
  const [repoInfoError, setRepoInfoError] = createSignal('');

  const [gitCommits, setGitCommits] = createSignal<GitCommitSummary[]>([]);
  const [gitListLoading, setGitListLoading] = createSignal(false);
  const [gitListLoadingMore, setGitListLoadingMore] = createSignal(false);
  const [gitListError, setGitListError] = createSignal('');
  const [gitHasMore, setGitHasMore] = createSignal(false);
  const [gitNextOffset, setGitNextOffset] = createSignal(0);
  const [gitCommitListRef, setGitCommitListRef] = createSignal('');
  const [selectedCommitHash, setSelectedCommitHash] = createSignal('');
  const [browserSidebarWidth, setBrowserSidebarWidth] = createSignal(
    normalizePageSidebarWidth(floe.persist.load<number>(PAGE_SIDEBAR_WIDTH_STORAGE_KEY, PAGE_SIDEBAR_DEFAULT_WIDTH))
  );
  const [browserSidebarOpen, setBrowserSidebarOpen] = createSignal(false);
  const [gitSubview, setGitSubview] = createSignal<GitWorkbenchSubview>('changes');
  const [gitRepoSummary, setGitRepoSummary] = createSignal<GitRepoSummaryResponse | null>(null);
  const [gitRepoSummaryLoading, setGitRepoSummaryLoading] = createSignal(false);
  const [gitRepoSummaryError, setGitRepoSummaryError] = createSignal('');
  const [gitWorkspace, setGitWorkspace] = createSignal<GitListWorkspaceChangesResponse | null>(null);
  const [gitWorkspaceLoading, setGitWorkspaceLoading] = createSignal(false);
  const [gitWorkspaceError, setGitWorkspaceError] = createSignal('');
  const [selectedGitWorkspaceSection, setSelectedGitWorkspaceSection] = createSignal<GitWorkspaceSection>('unstaged');
  const [selectedGitWorkspaceKey, setSelectedGitWorkspaceKey] = createSignal('');
  const [gitBranches, setGitBranches] = createSignal<GitListBranchesResponse | null>(null);
  const [gitBranchesLoading, setGitBranchesLoading] = createSignal(false);
  const [gitBranchesError, setGitBranchesError] = createSignal('');
  const [selectedGitBranchName, setSelectedGitBranchName] = createSignal('');
  const [selectedGitBranchSubview, setSelectedGitBranchSubview] = createSignal<GitBranchSubview>('status');
  const [gitCommitMessage, setGitCommitMessage] = createSignal('');
  const [gitMutationScope, setGitMutationScope] = createSignal<GitMutationScope>('');
  const [gitMutationKey, setGitMutationKey] = createSignal('');

  let activePreviewStream: YamuxStream | null = null;
  let activeObjectUrl: string | null = null;
  let previewReqSeq = 0;
  let dirReqSeq = 0;
  let repoReqSeq = 0;
  let gitListReqSeq = 0;
  let gitRepoSummaryReqSeq = 0;
  let gitWorkspaceReqSeq = 0;
  let gitBranchesReqSeq = 0;
  let lastGitCommitContextKey = '';
  let lastGitRepoKey = '';
  let docxHost: HTMLDivElement | undefined;
  let previewContentEl: HTMLDivElement | undefined;
  let previewAskMenuEl: HTMLDivElement | undefined;

  const cleanupPreview = () => {
    if (activePreviewStream) {
      try {
        activePreviewStream.reset(new Error('canceled'));
      } catch {
      }
      try {
        void activePreviewStream.close();
      } catch {
      }
      activePreviewStream = null;
    }
    if (activeObjectUrl) {
      try {
        URL.revokeObjectURL(activeObjectUrl);
      } catch {
      }
      activeObjectUrl = null;
    }
    if (docxHost) {
      docxHost.innerHTML = '';
    }

    setPreviewObjectUrl('');
    setPreviewBytes(null);
    setPreviewText('');
    setPreviewMessage('');
    setPreviewTruncated(false);
    setPreviewError(null);
    setPreviewAskMenu(null);
    setXlsxRows([]);
    setXlsxSheetName('');
    setPreviewLoading(false);
  };

  onCleanup(() => {
    previewReqSeq += 1;
    cleanupPreview();
  });

  const readPersistedLastPath = (id: string): string => {
    const eid = id.trim();
    if (!eid) return '/';

    if (props.widgetId) {
      const state = deck.getWidgetState(props.widgetId);
      const byEnv = (state as any).lastPathByEnv;
      if (byEnv && typeof byEnv === 'object' && !Array.isArray(byEnv)) {
        const saved = (byEnv as any)[eid];
        if (typeof saved === 'string' && saved.trim()) return normalizePath(saved);
      }
      return '/';
    }

    return normalizePath(floe.persist.load<string>(`files:lastPath:${eid}`, '/'));
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

    floe.persist.debouncedSave(`files:lastPath:${eid}`, next);
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

    const saved = floe.persist.load<string>(`files:lastTargetPath:${eid}`, '');
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

    floe.persist.debouncedSave(`files:lastTargetPath:${eid}`, next);
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

    return normalizeBrowserPageMode(floe.persist.load<string>(`${PAGE_MODE_STORAGE_KEY_PREFIX}${eid}`, 'files'));
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

    floe.persist.debouncedSave(`${PAGE_MODE_STORAGE_KEY_PREFIX}${eid}`, next);
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

    return normalizeGitSubview(floe.persist.load<string>(`${GIT_SUBVIEW_STORAGE_KEY_PREFIX}${eid}`, 'changes'));
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

    floe.persist.debouncedSave(`${GIT_SUBVIEW_STORAGE_KEY_PREFIX}${eid}`, next);
  };

  const resolveFsRootAbs = async (): Promise<string> => {
    const cached = normalizeAbsolutePath(fsRootAbs());
    if (cached) return cached;

    const resp = await rpc.fs.getHome();
    const root = normalizeAbsolutePath(String(resp?.path ?? '').trim());
    if (!root) {
      throw new Error('Failed to resolve home directory.');
    }
    setFsRootAbs(root);
    return root;
  };

  const repoHistoryAvailable = () => Boolean(repoInfo()?.available && repoInfo()?.repoRootPath);

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
    setGitHasMore(false);
    setGitNextOffset(0);
    setSelectedCommitHash('');
  };

  const resetGitWorkbenchData = () => {
    gitRepoSummaryReqSeq += 1;
    gitWorkspaceReqSeq += 1;
    gitBranchesReqSeq += 1;
    lastGitRepoKey = '';
    setGitRepoSummary(null);
    setGitRepoSummaryLoading(false);
    setGitRepoSummaryError('');
    setGitWorkspace(null);
    setGitWorkspaceLoading(false);
    setGitWorkspaceError('');
    setSelectedGitWorkspaceSection('unstaged');
    setSelectedGitWorkspaceKey('');
    setGitBranches(null);
    setGitBranchesLoading(false);
    setGitBranchesError('');
    setSelectedGitBranchName('');
    setSelectedGitBranchSubview('status');
    setGitCommitMessage('');
    setGitMutationScope('');
    setGitMutationKey('');
  };

  const selectedGitWorkspaceItem = () => findWorkspaceChangeByKey(gitWorkspace(), selectedGitWorkspaceKey());

  const selectedGitBranch = () => findGitBranchByKey(gitBranches(), selectedGitBranchName());

  const applyWorkspaceSnapshot = (nextWorkspace: GitListWorkspaceChangesResponse | null | undefined) => {
    if (!nextWorkspace) return;
    setGitWorkspace(nextWorkspace);
    setGitRepoSummary((prev) => (prev ? { ...prev, workspaceSummary: nextWorkspace.summary } : prev));
    setRepoInfo((prev) => (prev ? { ...prev, dirty: summarizeWorkspaceCount(nextWorkspace.summary) > 0 } : prev));

    const nextSection = selectedGitWorkspaceSection() || pickDefaultWorkspaceSection(nextWorkspace);
    setSelectedGitWorkspaceSection(nextSection);
    const currentKey = selectedGitWorkspaceKey();
    const scopedCurrentItem = findWorkspaceChangeByKey(nextWorkspace, currentKey);
    const nextItem = scopedCurrentItem?.section === nextSection
      ? scopedCurrentItem
      : workspaceSectionItems(nextWorkspace, nextSection)[0] ?? pickDefaultWorkspaceChange(nextWorkspace);
    setSelectedGitWorkspaceKey(workspaceEntryKey(nextItem));
  };

  const selectGitWorkspaceItem = (item: GitWorkspaceChange | null | undefined) => {
    if (item?.section) {
      setSelectedGitWorkspaceSection(item.section as GitWorkspaceSection);
    }
    setSelectedGitWorkspaceKey(workspaceEntryKey(item));
    if (layout.isMobile()) {
      closePageSidebar();
    }
  };

  const selectGitWorkspaceSection = (section: GitWorkspaceSection) => {
    setSelectedGitWorkspaceSection(section);
    const firstItem = workspaceSectionItems(gitWorkspace(), section)[0] ?? null;
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
                    : 'Git request failed';
      notification.error(title, message || 'Request failed.');
      return false;
    } finally {
      setGitMutationScope('');
      setGitMutationKey('');
    }
  };

  const handleStageWorkspacePaths = async (sourceSection: GitWorkspaceSection, paths: string[], key: string, count: number) => {
    const repoRootPath = String(repoInfo()?.repoRootPath ?? '').trim();
    if (!repoRootPath) return;
    await runGitMutation(
      'stage',
      key,
      () => rpc.git.stageWorkspace({ repoRootPath, paths: paths.length > 0 ? paths : undefined }),
      () => {
        const nextWorkspace = applyWorkspaceSectionMutation(gitWorkspace(), {
          sourceSection,
          paths,
          destinationSection: 'staged',
        });
        applyWorkspaceSnapshot(nextWorkspace);
        notification.success(sourceSection === 'untracked' ? 'Tracked' : 'Staged', `${formatGitFileCountLabel(count)} moved into the index.`);
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
    const sourceSection = (item.section as GitWorkspaceSection | undefined) ?? selectedGitWorkspaceSection();
    setSelectedGitWorkspaceSection(sourceSection);
    void handleStageWorkspacePaths(sourceSection, workspaceMutationPaths(item), workspaceEntryKey(item), 1);
  };

  const handleUnstageWorkspaceItem = (item: GitWorkspaceChange) => void handleUnstageWorkspacePaths(workspaceMutationPaths(item), workspaceEntryKey(item), 1);

  const handleBulkWorkspaceAction = (section: GitWorkspaceSection) => {
    const items = workspaceSectionItems(gitWorkspace(), section);
    if (items.length === 0) return;
    setSelectedGitWorkspaceSection(section);
    const paths = Array.from(new Set(items.flatMap((item) => workspaceMutationPaths(item))));
    if (section === 'staged') {
      void handleUnstageWorkspacePaths(paths, workspaceSectionActionKey(section), items.length);
      return;
    }
    void handleStageWorkspacePaths(section, paths, workspaceSectionActionKey(section), items.length);
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
        setSelectedGitWorkspaceSection('unstaged');
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
    const nextInfo = await resolveRepoInfo(currentBrowserPath());
    if (!nextInfo?.available) {
      resetGitCommitSidebar();
      resetGitWorkbenchData();
      return;
    }
    lastGitRepoKey = '';
    lastGitCommitContextKey = '';
    void loadGitRepoSummary();
    void loadGitWorkspace();
    void loadGitBranches();
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
  const openPageSidebar = () => setMobileSidebarOpen(true);
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

  createEffect(() => {
    floe.persist.debouncedSave(PAGE_SIDEBAR_WIDTH_STORAGE_KEY, browserSidebarWidth());
  });

  createEffect(() => {
    const id = envId();
    const restored = untrack(() => ({
      nextPath: id ? readPersistedLastPath(id) : '/',
      nextMode: id ? readPersistedPageMode(id) : 'files',
      nextSubview: id ? readPersistedGitSubview(id) : 'changes',
    }));

    dirReqSeq += 1;
    cache = new Map();
    setFiles([]);
    setLoading(false);
    setCurrentBrowserPath(restored.nextPath);
    setLastLoadedBrowserPath('/');
    setFsRootAbs('');
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
    setFileBrowserResetSeq(0);

    repoReqSeq += 1;
    previewReqSeq += 1;
    cleanupPreview();
    setPreviewItem(null);
    setPreviewOpen(false);
  });

  const loadDirOnce = async (path: string, seq: number): Promise<PathLoadResult> => {
    if (seq !== dirReqSeq) return { status: 'canceled' };

    const p = normalizePath(path);
    if (cache.has(p)) {
      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, cache.get(p)!));
      return { status: 'ok' };
    }

    if (!protocol.client()) {
      return { status: 'transport_error', message: 'Connection is not ready.' };
    }

    try {
      const resp = await rpc.fs.list({ path: p, showHidden: false });
      if (seq !== dirReqSeq) return { status: 'canceled' };

      const entries = resp?.entries ?? [];
      const items = entries
        .map(toFileItem)
        .sort((a: FileItem, b: FileItem) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
      if (seq !== dirReqSeq) return { status: 'canceled' };
      cache.set(p, items);

      if (seq === dirReqSeq) setFiles((prev) => withChildren(prev, p, items));
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

    const seq = ++dirReqSeq;
    const p = normalizePath(path);
    const parts = p.split('/').filter(Boolean);
    const chain: string[] = ['/'];
    for (let i = 0; i < parts.length; i += 1) {
      chain.push(`/${parts.slice(0, i + 1).join('/')}`);
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

  const openPreview = async (item: FileItem) => {
    if (item.type !== 'file') return;
    const client = protocol.client();
    if (!client) return;

    setPreviewOpen(true);
    setPreviewItem(item);
    cleanupPreview();

    const seq = (previewReqSeq += 1);
    setPreviewLoading(true);

    const baseMode = previewModeByName(item.name);
    setPreviewMode(baseMode);

    const fileSize = typeof item.size === 'number' ? item.size : undefined;
    const maxBytes = baseMode === 'text' ? MAX_TEXT_PREVIEW_BYTES : MAX_PREVIEW_BYTES;
    if (fileSize != null && fileSize > maxBytes && baseMode !== 'text') {
      setPreviewMode('unsupported');
      setPreviewMessage('This file is too large to preview.');
      setPreviewLoading(false);
      return;
    }

    try {
      const wantBytes = baseMode === 'binary' ? SNIFF_BYTES : maxBytes;

      const stream = await client.openStream('fs/read_file');
      activePreviewStream = stream;
      const reader = byteReaderFromStream(stream);

      const req: FsReadFileStreamMeta = { path: item.path, offset: 0, max_bytes: wantBytes };
      await writeJsonFrame((b) => stream.write(b), req);
      const metaRaw = await readJsonFrame((n) => reader.readExactly(n), JSON_FRAME_MAX_BYTES);
      const meta = normalizeRespMeta(metaRaw);

      if (seq !== previewReqSeq) return;

      if (!meta.ok) {
        const code = meta.error?.code ?? 0;
        const msg = meta.error?.message ?? 'Failed to load file';
        throw new Error(code ? `${msg} (${code})` : msg);
      }

      const contentLen = Math.max(0, Math.floor(Number(meta.content_len ?? 0)));
      const out = new Uint8Array(new ArrayBuffer(contentLen));
      let off = 0;
      while (off < contentLen) {
        if (seq !== previewReqSeq) return;
        const take = Math.min(64 * 1024, contentLen - off);
        const chunk = await reader.readExactly(take);
        out.set(chunk, off);
        off += chunk.length;
      }

      try {
        await stream.close();
      } catch {
      } finally {
        if (activePreviewStream === stream) activePreviewStream = null;
      }

      if (seq !== previewReqSeq) return;

      const truncated = !!meta.truncated;
      setPreviewBytes(out);
      setPreviewTruncated(truncated);

      const extDot = getExtDot(item.name);
      const mime = mimeFromExtDot(extDot) ?? 'application/octet-stream';

      if (baseMode === 'text') {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
        setPreviewText(text);
        if (truncated) {
          setPreviewMessage('Showing partial content (truncated).');
        }
        return;
      }

      if (baseMode === 'image') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This image is too large to preview.');
          return;
        }
        const url = URL.createObjectURL(new Blob([out], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseMode === 'pdf') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This PDF is too large to preview.');
          return;
        }
        const url = URL.createObjectURL(new Blob([out], { type: mime }));
        activeObjectUrl = url;
        setPreviewObjectUrl(url);
        return;
      }

      if (baseMode === 'docx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This document is too large to preview.');
          return;
        }
        return;
      }

      if (baseMode === 'xlsx') {
        if (truncated) {
          setPreviewMode('unsupported');
          setPreviewMessage('This spreadsheet is too large to preview.');
          return;
        }
        const mod = await import('exceljs');
        if (seq !== previewReqSeq) return;
        const ExcelJS: any = (mod as any).default ?? mod;

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(out.buffer);
        if (seq !== previewReqSeq) return;

        const ws = workbook.worksheets?.[0] ?? workbook.getWorksheet?.(1);
        if (!ws) {
          setPreviewMode('unsupported');
          setPreviewMessage('No worksheet found in this file.');
          return;
        }

        const cellToText = (v: unknown): string => {
          if (v == null) return '';
          if (typeof v === 'string') return v;
          if (typeof v === 'number') return String(v);
          if (typeof v === 'boolean') return v ? 'true' : 'false';
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'object') {
            const o = v as any;
            if (typeof o.text === 'string') return o.text;
            if (Array.isArray(o.richText)) return o.richText.map((p: any) => String(p?.text ?? '')).join('');
            if (o.result != null) return cellToText(o.result);
            if (typeof o.formula === 'string' && o.result != null) return `${o.formula} = ${cellToText(o.result)}`;
            try {
              return JSON.stringify(o);
            } catch {
              return String(o);
            }
          }
          return String(v);
        };

        const maxRows = 200;
        const maxCols = 50;
        const rows: string[][] = [];
        const rowCount = typeof ws.rowCount === 'number' ? ws.rowCount : 0;
        const takeRows = Math.min(rowCount || maxRows, maxRows);
        for (let r = 1; r <= takeRows; r += 1) {
          const row = ws.getRow?.(r);
          if (!row) continue;
          const outRow: string[] = [];
          for (let c = 1; c <= maxCols; c += 1) {
            const cell = row.getCell?.(c);
            outRow.push(cellToText(cell?.value));
          }
          rows.push(outRow);
        }

        setXlsxSheetName(String(ws.name ?? 'Sheet1'));
        setXlsxRows(rows);
        return;
      }

      if (baseMode === 'binary') {
        if (isLikelyTextContent(out)) {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
          setPreviewMode('text');
          setPreviewText(text);
          if (truncated) {
            setPreviewMessage('Showing partial content (truncated).');
          }
          return;
        }
        setPreviewMessage('Preview is not available for this file type.');
        return;
      }
    } catch (e) {
      if (seq !== previewReqSeq) return;
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreviewMode('unsupported');
      setPreviewMessage('Failed to load file.');
    } finally {
      if (seq === previewReqSeq) setPreviewLoading(false);
    }
  };

  const downloadCurrent = async () => {
    const client = protocol.client();
    const it = previewItem();
    if (!client || !it) return;
    if (downloadLoading()) return;

    setDownloadLoading(true);
    try {
      const cached = previewBytes();
      const truncated = previewTruncated();
      if (cached && !truncated) {
        const mime = mimeFromExtDot(getExtDot(it.name)) ?? 'application/octet-stream';
        downloadBlob({ name: it.name, blob: new Blob([cached], { type: mime }) });
        return;
      }

      const size = typeof it.size === 'number' ? it.size : undefined;
      const { bytes } = await readFileBytesOnce({ client, path: it.path, maxBytes: size ?? 0 });
      const mime = mimeFromExtDot(getExtDot(it.name)) ?? 'application/octet-stream';
      downloadBlob({ name: it.name, blob: new Blob([bytes], { type: mime }) });
    } catch {
    } finally {
      setDownloadLoading(false);
    }
  };

  const invalidateDirCache = (dirPath: string) => {
    const p = normalizePath(dirPath);
    cache.delete(p);
  };

  const refreshDir = async (dirPath: string) => {
    invalidateDirCache(dirPath);
    const result = await loadPathChain(dirPath);
    if (result.status !== 'ok') notifyPathLoadFailure(result);
  };

  const applyLocalMove = (item: FileItem, destDir: string) => {
    const from = normalizePath(item.path);
    const to = destDir === '/' ? `/${item.name}` : `${destDir}/${item.name}`;
    const movedItem = rewriteSubtreePaths(item, from, to);

    setFiles((prev) => {
      const removed = removeItemsFromTree(prev, new Set([from]));
      return insertItemToTree(removed, destDir, movedItem);
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
      setFileBrowserResetSeq((v) => v + 1);
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
        setFileBrowserResetSeq((v) => v + 1);

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

    try {
      await rpc.fs.copy({ sourcePath: item.path, destPath });
      const newItem: FileItem = {
        ...item,
        id: destPath,
        name: newName,
        path: destPath,
        extension: item.type === 'file' ? extNoDot(newName) : undefined,
      };
      setFiles((prev) => insertItemToTree(prev, parentDir, newItem));
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
          setFiles((prev) => insertItemToTree(prev, destDir, newItem));
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
    const rememberedPath = normalizePath(currentBrowserPath());
    const persistedPath = untrack(() => readPersistedLastPath(id));
    const startPath = rememberedPath !== '/' ? rememberedPath : persistedPath;
    setCurrentBrowserPath(startPath);
    void (async () => {
      const result = await loadPathChain(startPath);
      if (result.status === 'ok' || result.status === 'canceled') return;
      if (result.status === 'invalid_path' && startPath !== '/') {
        writePersistedLastPath(id, '/');
        setCurrentBrowserPath('/');
        setFileBrowserResetSeq((n) => n + 1);
        const rootResult = await loadPathChain('/');
        if (rootResult.status !== 'ok') notifyPathLoadFailure(rootResult);
        return;
      }
      notifyPathLoadFailure(result);
    })();

    void (async () => {
      try {
        await resolveFsRootAbs();
      } catch {
      }
    })();
  });

  createEffect(() => {
    const id = envId();
    const client = protocol.client();
    const path = currentBrowserPath();
    if (!id || !client) {
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
    void loadGitRepoSummary();
    void loadGitWorkspace();
    void loadGitBranches();
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

  createEffect(() => {
    if (previewMode() !== 'docx') return;
    const it = previewItem();
    const bytes = previewBytes();
    if (!it || !bytes || !docxHost) return;

    const seq = previewReqSeq;
    void (async () => {
      try {
        docxHost!.innerHTML = '';
        const mod = await import('docx-preview');
        if (seq !== previewReqSeq) return;
        const renderAsync = (mod as any).renderAsync as ((buf: ArrayBuffer, container: HTMLElement, styleContainer?: HTMLElement, options?: any) => Promise<void>) | undefined;
        if (!renderAsync) throw new Error('renderAsync not found');
        await renderAsync(bytes.buffer, docxHost!, undefined, {
          className: 'docx-preview-container',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: false,
        });
      } catch (e) {
        if (seq !== previewReqSeq) return;
        setPreviewError(e instanceof Error ? e.message : String(e));
        setPreviewMode('unsupported');
        setPreviewMessage('Failed to render DOCX document.');
      }
    })();
  });

  createEffect(() => {
    const menu = previewAskMenu();
    if (!menu) return;

    const closeMenu = () => {
      setPreviewAskMenu(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeMenu();
        return;
      }
      if (previewAskMenuEl?.contains(target)) return;
      closeMenu();
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);

    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    });
  });

  const dispatchAskFlowerIntent = (intent: AskFlowerIntent) => {
    ctx.openAskFlowerComposer(intent);
  };

  const toAbsolutePath = (path: string, rootAbs: string): string => {
    const normalizedPath = normalizeAskFlowerVirtualPath(path);
    return virtualPathToAbsolutePath(normalizedPath, rootAbs);
  };

  const toFileContextItems = (items: FileItem[], rootAbs: string): AskFlowerIntent['contextItems'] =>
    items
      .map((item) => {
        const absolutePath = toAbsolutePath(item.path, rootAbs);
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

    const normalizedPath = normalizeAskFlowerVirtualPath(item.path);
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

    let rootAbs = '';
    try {
      rootAbs = await resolveFsRootAbs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notification.error('Ask Flower unavailable', msg || 'Failed to resolve home directory.');
      return;
    }

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

    const contextItems = toFileContextItems(normalizedItems, rootAbs);
    if (contextItems.length <= 0) {
      notification.error('Ask Flower unavailable', 'Failed to resolve selected file paths.');
      return;
    }

    const suggestedWorkingDirVirtual = deriveVirtualWorkingDirFromItems(
      normalizedItems.map((item) => ({ path: item.path, isDirectory: item.type === 'folder' })),
      currentBrowserPath(),
    );
    const absoluteItems = normalizedItems
      .map((item) => ({
        path: toAbsolutePath(item.path, rootAbs),
        isDirectory: item.type === 'folder',
      }))
      .filter((item) => item.path);
    const suggestedWorkingDirAbs = deriveAbsoluteWorkingDirFromItems(absoluteItems, rootAbs);

    dispatchAskFlowerIntent({
      id: crypto.randomUUID(),
      source: 'file_browser',
      mode: 'append',
      suggestedWorkingDirAbs: suggestedWorkingDirAbs || undefined,
      suggestedWorkingDirVirtual: suggestedWorkingDirVirtual || undefined,
      fsRootAbs: rootAbs,
      contextItems,
      pendingAttachments,
      notes,
    });
  };

  const readPreviewSelectionText = (): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount <= 0) return '';

    const raw = String(selection.toString() ?? '').trim();
    if (!raw) return '';

    if (previewContentEl) {
      const range = selection.getRangeAt(0);
      const containerNode = range.commonAncestorContainer;
      const containerElement =
        containerNode.nodeType === Node.ELEMENT_NODE
          ? (containerNode as Element)
          : containerNode.parentElement;
      if (!containerElement || !previewContentEl.contains(containerElement)) {
        return '';
      }
    }

    return raw;
  };

  const buildPreviewIntent = async (selectionText: string): Promise<AskFlowerIntent | null> => {
    const item = previewItem();
    if (!item || item.type !== 'file') return null;

    let rootAbs = '';
    try {
      rootAbs = await resolveFsRootAbs();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notification.error('Ask Flower unavailable', msg || 'Failed to resolve home directory.');
      return null;
    }

    const virtualPath = normalizeAskFlowerVirtualPath(item.path);
    const absolutePath = virtualPathToAbsolutePath(virtualPath, rootAbs);
    if (!absolutePath) {
      notification.error('Ask Flower unavailable', 'Failed to resolve file path.');
      return null;
    }

    const selection = String(selectionText ?? '').trim();
    const notes: string[] = [];
    const pendingAttachments: File[] = [];
    let contextItems: AskFlowerIntent['contextItems'];

    if (selection) {
      if (selection.length > ASK_FLOWER_MAX_INLINE_SELECTION_CHARS) {
        const attachmentName = `${item.name || 'file'}-selection-${Date.now()}.txt`;
        pendingAttachments.push(new File([selection], attachmentName, { type: 'text/plain' }));
        notes.push(`Large selection was attached as "${attachmentName}".`);
        contextItems = [{ kind: 'file_path', path: absolutePath, isDirectory: false }];
      } else {
        contextItems = [{ kind: 'file_selection', path: absolutePath, selection, selectionChars: selection.length }];
      }
    } else {
      contextItems = [{ kind: 'file_path', path: absolutePath, isDirectory: false }];
    }

    return {
      id: crypto.randomUUID(),
      source: 'file_preview',
      mode: 'append',
      suggestedWorkingDirAbs: dirnameAbsolute(absolutePath),
      suggestedWorkingDirVirtual: dirnameVirtual(virtualPath),
      fsRootAbs: rootAbs,
      contextItems,
      pendingAttachments,
      notes,
    };
  };

  const openPreviewAskMenu = (event: MouseEvent) => {
    const item = previewItem();
    if (!item || item.type !== 'file') return;
    event.preventDefault();
    event.stopPropagation();

    setPreviewAskMenu({
      x: event.clientX,
      y: event.clientY,
      selection: readPreviewSelectionText(),
    });
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
            <Show
              when={pageMode() === 'files'}
              fallback={
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
                  onResize={(delta) => setBrowserSidebarWidth((width) => normalizePageSidebarWidth(width + delta))}
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
                  onFetch={() => { void handleFetchRepo(); }}
                  onPull={() => { void handlePullRepo(); }}
                  onPush={() => { void handlePushRepo(); }}
                  onCheckoutBranch={(branch) => { void handleCheckoutBranch(branch); }}
                  showMobileSidebarButton={layout.isMobile() && Boolean(props.widgetId)}
                  onToggleSidebar={togglePageSidebar}
                  onRefresh={() => { void refreshGitWorkbench(); }}
                />
              }
            >
              <FileBrowserWorkspace
                class="h-full"
                mode={pageMode()}
                onModeChange={handlePageModeChange}
                gitHistoryDisabled={!canEnterGitHistory()}
                files={files()}
                currentPath={currentBrowserPath()}
                initialPath={readPersistedLastPath(id)}
                persistenceKey={`files:${id}`}
                instanceId={props.widgetId ? `redeven-files:${id}:${props.widgetId}` : `redeven-files:${id}`}
                resetKey={fileBrowserResetSeq()}
                width={browserSidebarWidth()}
                open={pageSidebarOpen()}
                resizable
                onResize={(delta) => setBrowserSidebarWidth((width) => normalizePageSidebarWidth(width + delta))}
                onClose={closePageSidebar}
                showMobileSidebarButton={layout.isMobile() && Boolean(props.widgetId)}
                onToggleSidebar={togglePageSidebar}
                onNavigate={(path) => {
                  const targetPath = normalizePath(path);
                  writePersistedLastPath(id, targetPath);
                  setCurrentBrowserPath(targetPath);
                  void (async () => {
                    const result = await loadPathChain(targetPath);
                    if (result.status === 'ok' || result.status === 'canceled') return;
                    if (result.status === 'invalid_path') {
                      const fallbackPath = normalizePath(lastLoadedBrowserPath());
                      writePersistedLastPath(id, fallbackPath);
                      setCurrentBrowserPath(fallbackPath);
                      setFileBrowserResetSeq((n) => n + 1);
                      const fallbackResult = await loadPathChain(fallbackPath);
                      if (fallbackResult.status !== 'ok') notifyPathLoadFailure(fallbackResult);
                      return;
                    }
                    notifyPathLoadFailure(result);
                  })();
                }}
                onPathChange={(_path, source) => {
                  if (source === 'user' && layout.isMobile()) {
                    closePageSidebar();
                  }
                }}
                onOpen={(item) => void openPreview(item)}
                onDragMove={(items, targetPath) => void handleDragMove(items, targetPath)}
                contextMenuCallbacks={ctxMenu}
                overrideContextMenuItems={overrideContextMenuItems}
              />
            </Show>
          </div>
        )}
      </Show>

      <LoadingOverlay visible={loading()} message="Loading files..." />
      <LoadingOverlay visible={dragMoveLoading()} message="Moving..." />

      <FloatingWindow
        open={previewOpen()}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPreviewAskMenu(null);
          if (!open) {
            previewReqSeq += 1;
            cleanupPreview();
            setPreviewItem(null);
          }
        }}
        title={previewItem()?.name ?? 'File preview'}
        defaultSize={{ width: 920, height: 620 }}
        minSize={{ width: 520, height: 320 }}
      >
        <div class="h-full flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-border text-[11px] text-muted-foreground font-mono truncate">
            {previewItem()?.path}
          </div>

          <div
            ref={previewContentEl}
            class="flex-1 min-h-0 overflow-auto relative bg-background"
            onContextMenu={(event) => openPreviewAskMenu(event)}
          >
            <Show when={previewMode() === 'text' && !previewError()}>
              <pre class="p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-text">
                {previewText()}
              </pre>
            </Show>

            <Show when={previewMode() === 'image' && !previewError()}>
              <div class="p-3 h-full flex items-center justify-center">
                <img src={previewObjectUrl()} alt={previewItem()?.name ?? 'Preview'} class="max-w-full max-h-full object-contain" />
              </div>
            </Show>

            <Show when={previewMode() === 'pdf' && !previewError()}>
              <iframe src={previewObjectUrl()} class="w-full h-full border-0" title="PDF preview" />
            </Show>

            <Show when={previewMode() === 'docx' && !previewError()}>
              <div ref={docxHost} class="p-3" />
            </Show>

            <Show when={previewMode() === 'xlsx' && !previewError()}>
              <div class="p-3">
                <Show when={xlsxSheetName()}>
                  <div class="text-[11px] text-muted-foreground mb-2">Sheet: {xlsxSheetName()}</div>
                </Show>
                <div class="overflow-auto border border-border rounded-md">
                  <table class="w-full text-xs">
                    <tbody>
                      <For each={xlsxRows()}>
                        {(row) => (
                          <tr class="border-b border-border last:border-b-0">
                            <For each={row}>
                              {(cell) => (
                                <td class="px-2 py-1 border-r border-border last:border-r-0 align-top whitespace-pre-wrap break-words">
                                  {cell}
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </Show>

            <Show when={(previewMode() === 'binary' || previewMode() === 'unsupported') && !previewError()}>
              <div class="p-4 text-sm text-muted-foreground">
                <div class="font-medium text-foreground mb-1">
                  {previewMode() === 'binary' ? 'Binary file' : 'Preview not available'}
                </div>
                <div class="text-xs">{previewMessage() || 'Preview is not available.'}</div>
              </div>
            </Show>

            <Show when={previewError()}>
              <div class="p-4 text-sm text-error">
                <div class="font-medium mb-1">Failed to load file</div>
                <div class="text-xs text-muted-foreground">{previewError()}</div>
              </div>
            </Show>

            <LoadingOverlay visible={previewLoading()} message="Loading file..." />
          </div>

          <div class="px-3 py-2 border-t border-border flex items-center justify-between gap-2">
            <div class="min-w-0">
              <Show when={previewTruncated()}>
                <div class="text-[11px] text-muted-foreground truncate">Truncated preview</div>
              </Show>
            </div>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="outline" loading={downloadLoading()} disabled={!previewItem() || previewLoading() || !!previewError()} onClick={downloadCurrent}>
                Download
              </Button>
            </div>
          </div>
        </div>
      </FloatingWindow>

      <Show when={previewAskMenu()} keyed>
        {(menu) => (
          <div
            ref={previewAskMenuEl}
            class="fixed z-[120] min-w-[160px] rounded-md border border-border bg-background shadow-lg p-1"
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              class="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/60"
              onClick={() => {
                void (async () => {
                  setPreviewAskMenu(null);
                  const intent = await buildPreviewIntent(menu.selection);
                  if (!intent) return;
                  ctx.openAskFlowerComposer(intent, { x: menu.x, y: menu.y });
                })();
              }}
            >
              Ask Flower
            </button>
          </div>
        )}
      </Show>

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
        homePath={fsRootAbs() || undefined}
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
        homePath={fsRootAbs() || undefined}
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
