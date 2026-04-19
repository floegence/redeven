// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type {
  ContextMenuCallbacks,
  ContextMenuEvent,
  ContextMenuItem,
  FileBrowserRevealRequest,
  FileItem,
} from '@floegence/floe-webapp-core/file-browser';
import { RpcError } from '@floegence/floe-webapp-protocol';
import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvContext, type EnvContextValue } from '../pages/EnvContext';
import { RemoteFileBrowser } from './RemoteFileBrowser';

const widgetStateStore = vi.hoisted(() => ({
  values: {} as Record<string, Record<string, unknown>>,
  updateCalls: [] as Array<{ widgetId: string; key: string; value: unknown }>,
}));

const persistStore = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  loadCalls: [] as Array<{ key: string; fallback: unknown }>,
  saveCalls: [] as Array<{ key: string; value: unknown }>,
}));

const notificationStore = vi.hoisted(() => ({
  success: [] as Array<{ title: string; message?: string }>,
  error: [] as Array<{ title: string; message?: string }>,
  warning: [] as Array<{ title: string; message?: string }>,
  info: [] as Array<{ title: string; message?: string }>,
}));

const clipboardStore = vi.hoisted(() => ({
  writeText: vi.fn(),
}));

const legacyClipboardStore = vi.hoisted(() => ({
  execCommand: vi.fn(),
}));

const gitWorkspaceRenderStore = vi.hoisted(() => ({
  snapshots: [] as Array<{
    subview: string;
    onSubviewChange?: (view: 'changes' | 'branches' | 'history') => void;
    selectedBranchSubview?: string;
    selectedBranchName?: string;
    branchDetailKind?: string;
    selectedWorkspaceSection?: string;
    repoInfoLoading: boolean;
    repoSummaryLoading: boolean;
    workspaceLoading: boolean;
    branchesLoading: boolean;
    listLoading: boolean;
    listRefreshing: boolean;
    shellLoadingMessage?: string;
    fetchBusy: boolean;
    pullBusy: boolean;
    pushBusy: boolean;
    checkoutBusy: boolean;
    switchDetachedBusy: boolean;
    mergeBusy: boolean;
    deleteBusy: boolean;
  }>,
}));

const gitStashWindowRenderStore = vi.hoisted(() => ({
  snapshots: [] as Array<{
    open: boolean;
    tab?: string;
    stashCount: number;
    selectedStashId?: string;
    stashDetailId?: string;
    stashDetailLoading: boolean;
    reviewKind?: string;
    reviewError?: string;
  }>,
  onRefreshStashes: undefined as (() => void) | undefined,
  onRequestDrop: undefined as (() => void) | undefined,
  onConfirmReview: undefined as (() => void) | undefined,
}));

const workspaceLifecycleStore = vi.hoisted(() => ({
  filesMounts: 0,
  filesUnmounts: 0,
  gitMounts: 0,
  gitUnmounts: 0,
}));

const workspacePathSubmitStore = vi.hoisted(() => ({
  nextPath: '/workspace/repo/src',
}));

const inputDialogStore = vi.hoisted(() => ({
  pendingConfirmValue: null as string | null,
}));

const filePreviewStore = vi.hoisted(() => ({
  openPreview: vi.fn(),
  closePreview: vi.fn(),
}));

const fileBrowserSurfaceStore = vi.hoisted(() => ({
  openBrowser: vi.fn(async () => undefined),
  closeBrowser: vi.fn(),
}));

const envActionSpies = vi.hoisted(() => ({
  openTerminalInDirectory: vi.fn(),
  openFileBrowserAtPath: vi.fn(async () => undefined),
  openAskFlowerComposer: vi.fn(),
}));

const mockRpc = vi.hoisted(() => ({
  fs: {
    list: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
    delete: vi.fn(),
    getPathContext: vi.fn(),
  },
  git: {
    resolveRepo: vi.fn(),
    getRepoSummary: vi.fn(),
    listWorkspacePage: vi.fn(),
    listBranches: vi.fn(),
    getBranchCompare: vi.fn(),
    listCommits: vi.fn(),
    listStashes: vi.fn(),
    getStashDetail: vi.fn(),
    saveStash: vi.fn(),
    previewApplyStash: vi.fn(),
    applyStash: vi.fn(),
    previewDropStash: vi.fn(),
    dropStash: vi.fn(),
    discardWorkspace: vi.fn(),
    fetchRepo: vi.fn(),
    pullRepo: vi.fn(),
    pushRepo: vi.fn(),
    checkoutBranch: vi.fn(),
    switchDetached: vi.fn(),
    previewMergeBranch: vi.fn(),
    mergeBranch: vi.fn(),
    previewDeleteBranch: vi.fn(),
    deleteBranch: vi.fn(),
  },
}));

vi.mock('@floegence/floe-webapp-core', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core')>('@floegence/floe-webapp-core');
  return {
    ...actual,
    useDeck: () => ({
      getWidgetState: (widgetId: string) => widgetStateStore.values[widgetId] ?? {},
      updateWidgetState: (widgetId: string, key: string, value: unknown) => {
        widgetStateStore.updateCalls.push({ widgetId, key, value });
        widgetStateStore.values[widgetId] = {
          ...(widgetStateStore.values[widgetId] ?? {}),
          [key]: value,
        };
      },
    }),
    useResolvedFloeConfig: () => ({
      persist: {
        load: (key: string, fallback: unknown) => {
          persistStore.loadCalls.push({ key, fallback });
          return key in persistStore.values ? persistStore.values[key] : fallback;
        },
        debouncedSave: (key: string, value: unknown) => {
          persistStore.saveCalls.push({ key, value });
          persistStore.values[key] = value;
        },
      },
    }),
    useLayout: () => ({
      isMobile: () => false,
    }),
    useNotification: () => ({
      error: (title: string, message?: string) => {
        notificationStore.error.push({ title, message });
      },
      success: (title: string, message?: string) => {
        notificationStore.success.push({ title, message });
      },
      warning: (title: string, message?: string) => {
        notificationStore.warning.push({ title, message });
      },
      info: (title: string, message?: string) => {
        notificationStore.info.push({ title, message });
      },
    }),
  };
});

vi.mock('@floegence/floe-webapp-protocol', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol');
  return {
    ...actual,
    useProtocol: () => ({
      client: () => ({ connected: true }),
      status: () => 'connected',
    }),
  };
});

vi.mock('../protocol/redeven_v1', async () => {
  const actual = await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1');
  return {
    ...actual,
    useRedevenRpc: () => mockRpc,
  };
});

vi.mock('./FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview: filePreviewStore.openPreview,
    closePreview: filePreviewStore.closePreview,
    controller: {},
  }),
}));

vi.mock('./FileBrowserSurfaceContext', () => ({
  useFileBrowserSurfaceContext: () => ({
    controller: {},
    openBrowser: fileBrowserSurfaceStore.openBrowser,
    closeBrowser: fileBrowserSurfaceStore.closeBrowser,
  }),
}));

vi.mock('./InputDialog', () => ({
  InputDialog: (props: {
    open: boolean;
    title: string;
    label: string;
    value: string;
    placeholder?: string;
    confirmText?: string;
    loading?: boolean;
    onConfirm: (value: string) => void;
    onCancel: () => void;
  }) => {
    const [draft, setDraft] = createSignal(props.value);

    createEffect(() => {
      if (props.open) {
        setDraft(props.value);
      }
    });

    createEffect(() => {
      if (!props.open || inputDialogStore.pendingConfirmValue == null) return;
      const nextValue = inputDialogStore.pendingConfirmValue;
      inputDialogStore.pendingConfirmValue = null;
      queueMicrotask(() => props.onConfirm(nextValue));
    });

    return props.open ? (
      <div data-testid="mock-input-dialog">
        <div>{props.title}</div>
        <label>
          {props.label}
          <input
            aria-label={props.label}
            value={draft()}
            placeholder={props.placeholder}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
        </label>
        <button type="button" onClick={() => props.onConfirm(draft())} disabled={props.loading}>
          {props.confirmText ?? 'Confirm'}
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    ) : null;
  },
}));

vi.mock('./FileBrowserWorkspace', () => ({
  FileBrowserWorkspace: (props: {
    mode: string;
    files: FileItem[];
    currentPath: string;
    width?: number;
    resetKey?: number;
    captureTypingFromPage?: boolean;
    toolbarEndActions?: JSX.Element;
    onModeChange?: (mode: string) => void;
    onResize?: (delta: number) => void;
    onNavigate?: (path: string) => void;
    onPathSubmit?: (path: string) => Promise<{ status: string; committedPath?: string; message?: string }>;
    pathEditRequestKey?: number;
    contextMenuCallbacks?: ContextMenuCallbacks;
    overrideContextMenuItems?: ContextMenuItem[];
    resolveOverrideContextMenuItems?: (event: ContextMenuEvent | null) => ContextMenuItem[] | undefined;
    revealRequest?: FileBrowserRevealRequest | null;
    onRevealRequestConsumed?: (requestId: string) => void;
  }) => {
    const [localCount, setLocalCount] = createSignal(0);
    const copyNameTarget: FileItem = {
      id: '/workspace/repo/src/.env',
      name: '.env',
      type: 'file',
      path: '/workspace/repo/src/.env',
    };
    const folderTarget: FileItem = {
      id: '/workspace/repo/src',
      name: 'src',
      type: 'folder',
      path: '/workspace/repo/src',
    };
    const fileEvent: ContextMenuEvent = {
      x: 40,
      y: 44,
      items: [copyNameTarget],
      targetKind: 'item',
      source: 'list',
      directory: null,
    };
    const folderEvent: ContextMenuEvent = {
      x: 24,
      y: 32,
      items: [folderTarget],
      targetKind: 'item',
      source: 'list',
      directory: {
        path: folderTarget.path,
        item: folderTarget,
      },
    };
    const multiSelectEvent: ContextMenuEvent = {
      x: 48,
      y: 56,
      items: [folderTarget, copyNameTarget],
      targetKind: 'item',
      source: 'list',
      directory: null,
    };
    const backgroundEvent: ContextMenuEvent = {
      x: 16,
      y: 24,
      items: [],
      targetKind: 'directory-background',
      source: 'background',
      directory: {
        path: props.currentPath,
      },
    };
    const resolver = props.resolveOverrideContextMenuItems;
    const resolveItems = (event: ContextMenuEvent) => resolver?.(event) ?? props.overrideContextMenuItems ?? [];
    const copyNameItems = resolveItems(fileEvent);
    const folderItems = resolveItems(folderEvent);
    const fileItems = resolveItems(fileEvent);
    const multiSelectItems = resolveItems(multiSelectEvent);
    const backgroundItems = () => resolveItems({
      ...backgroundEvent,
      directory: {
        path: props.currentPath,
      },
    });
    const describeMenuItems = (items: ContextMenuItem[]) => items.flatMap((item) => {
      const label = item.children?.length
        ? `${item.id}[${item.children.map((child) => child.id).join('|')}]`
        : item.id;
      return item.separator ? [label, `separator:${item.id}`] : [label];
    }).join(',');
    const describeRevealRequest = (request: FileBrowserRevealRequest | null | undefined) => (
      request ? `${request.requestId}|${request.parentPath}|${request.targetPath}` : ''
    );
    const flattenTreePaths = (items: FileItem[]): string[] => items.flatMap((item) => [
      item.path,
      ...(item.children ? flattenTreePaths(item.children) : []),
    ]);
    const findMenuItem = (items: ContextMenuItem[], id: string): ContextMenuItem | undefined => {
      for (const item of items) {
        if (item.id === id) return item;
        const child = item.children ? findMenuItem(item.children, id) : undefined;
        if (child) return child;
      }
      return undefined;
    };

    onMount(() => {
      workspaceLifecycleStore.filesMounts += 1;
    });

    onCleanup(() => {
      workspaceLifecycleStore.filesUnmounts += 1;
    });

    return (
      <div data-testid="files-workspace">
        <div>files:{props.mode}:{props.currentPath}:{props.width ?? 0}:{localCount()}:{props.captureTypingFromPage ? 'page' : 'scoped'}</div>
        <div data-testid="mock-path-edit-request-key">{props.pathEditRequestKey ?? 0}</div>
        <div>{props.toolbarEndActions}</div>
        <div data-testid="mock-folder-menu-order">{describeMenuItems(folderItems)}</div>
        <div data-testid="mock-background-menu-order">{describeMenuItems(backgroundItems())}</div>
        <div data-testid="mock-file-menu-order">{describeMenuItems(fileItems)}</div>
        <div data-testid="mock-multi-menu-order">{describeMenuItems(multiSelectItems)}</div>
        <div data-testid="mock-folder-new-has-icon">{findMenuItem(folderItems, 'new')?.icon ? 'yes' : 'no'}</div>
        <div data-testid="mock-background-new-has-icon">{findMenuItem(backgroundItems(), 'new')?.icon ? 'yes' : 'no'}</div>
        <div data-testid="mock-files-tree">{flattenTreePaths(props.files).join(',')}</div>
        <div data-testid="mock-current-path">{props.currentPath}</div>
        <div data-testid="mock-reveal-request">{describeRevealRequest(props.revealRequest)}</div>
        <div data-testid="mock-reveal-request-id">{props.revealRequest?.requestId ?? ''}</div>
        <div data-testid="mock-reveal-parent-path">{props.revealRequest?.parentPath ?? ''}</div>
        <div data-testid="mock-reveal-target-path">{props.revealRequest?.targetPath ?? ''}</div>
        <button type="button" onClick={() => setLocalCount((count) => count + 1)}>mock-files-bump</button>
        <button type="button" onClick={() => props.onModeChange?.('git')}>mock-to-git</button>
        <button type="button" onClick={() => props.onResize?.(24)}>mock-resize-sidebar</button>
        <button type="button" onClick={() => props.onNavigate?.('/workspace/repo')}>mock-nav-repo</button>
        <button type="button" onClick={() => props.onNavigate?.('/workspace/repo/src')}>mock-nav-src</button>
        <button type="button" onClick={() => props.onNavigate?.('/workspace/repo/missing')}>mock-nav-missing</button>
        <button
          type="button"
          onClick={async () => {
            const result = await props.onPathSubmit?.(workspacePathSubmitStore.nextPath);
            if (result) {
              notificationStore.info.push({
                title: 'mock-path-submit',
                message: `${result.status}:${result.committedPath ?? result.message ?? ''}`,
              });
            }
          }}
        >
          mock-submit-path
        </button>
        {props.revealRequest ? (
          <button
            type="button"
            onClick={() => props.onRevealRequestConsumed?.(props.revealRequest!.requestId)}
          >
            mock-consume-reveal
          </button>
        ) : null}
        {copyNameItems.some((item) => item.type === 'copy-name') ? (
          <button
            type="button"
            onClick={() => props.contextMenuCallbacks?.onCopyName?.([copyNameTarget])}
          >
            mock-copy-name
          </button>
        ) : null}
        {fileItems.some((item) => item.id === 'copy-path') ? (
          <button
            type="button"
            onClick={() => fileItems.find((item) => item.id === 'copy-path')?.onAction?.(fileEvent.items, fileEvent)}
          >
            mock-copy-path
          </button>
        ) : null}
        {multiSelectItems.some((item) => item.id === 'copy-path') ? (
          <button
            type="button"
            onClick={() => multiSelectItems.find((item) => item.id === 'copy-path')?.onAction?.(multiSelectEvent.items, multiSelectEvent)}
          >
            mock-copy-path-multi
          </button>
        ) : null}
        {multiSelectItems.some((item) => item.id === 'ask-flower') ? (
          <button
            type="button"
            onClick={() => multiSelectItems.find((item) => item.id === 'ask-flower')?.onAction?.(multiSelectEvent.items, multiSelectEvent)}
          >
            mock-ask-flower-multi
          </button>
        ) : null}
        {folderItems.some((item) => item.id === 'open-in-terminal') ? (
          <button
            type="button"
            onClick={() => folderItems.find((item) => item.id === 'open-in-terminal')?.onAction?.(folderEvent.items, folderEvent)}
          >
            mock-open-terminal-folder
          </button>
        ) : null}
        {backgroundItems().some((item) => item.id === 'open-in-terminal') ? (
          <button
            type="button"
            onClick={() => backgroundItems().find((item) => item.id === 'open-in-terminal')?.onAction?.([], {
              ...backgroundEvent,
              directory: {
                path: props.currentPath,
              },
            })}
          >
            mock-open-terminal-background
          </button>
        ) : null}
        {backgroundItems().some((item) => item.id === 'ask-flower') ? (
          <button
            type="button"
            onClick={() => backgroundItems().find((item) => item.id === 'ask-flower')?.onAction?.([], {
              ...backgroundEvent,
              directory: {
                path: props.currentPath,
              },
            })}
          >
            mock-ask-flower-background
          </button>
        ) : null}
        {findMenuItem(folderItems, 'new-file') ? (
          <button
            type="button"
            onClick={() => findMenuItem(folderItems, 'new-file')?.onAction?.(folderEvent.items, folderEvent)}
          >
            mock-create-file-from-folder
          </button>
        ) : null}
        {findMenuItem(folderItems, 'new-folder') ? (
          <button
            type="button"
            onClick={() => findMenuItem(folderItems, 'new-folder')?.onAction?.(folderEvent.items, folderEvent)}
          >
            mock-create-folder-from-folder
          </button>
        ) : null}
        {findMenuItem(backgroundItems(), 'new-file') ? (
          <button
            type="button"
            onClick={() => findMenuItem(backgroundItems(), 'new-file')?.onAction?.([], {
              ...backgroundEvent,
              directory: {
                path: props.currentPath,
              },
            })}
          >
            mock-create-file-from-background
          </button>
        ) : null}
        {findMenuItem(backgroundItems(), 'new-folder') ? (
          <button
            type="button"
            onClick={() => findMenuItem(backgroundItems(), 'new-folder')?.onAction?.([], {
              ...backgroundEvent,
              directory: {
                path: props.currentPath,
              },
            })}
          >
            mock-create-folder-from-background
          </button>
        ) : null}
        {fileItems.some((item) => item.id === 'open-in-terminal') ? (
          <button type="button">mock-open-terminal-file</button>
        ) : null}
        {multiSelectItems.some((item) => item.id === 'open-in-terminal') ? (
          <button type="button">mock-open-terminal-multi</button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('./GitWorkspace', () => ({
  GitWorkspace: (props: {
    mode: string;
    currentPath: string;
    subview: string;
    selectedBranchSubview?: string;
    selectedBranch?: { name?: string; fullName?: string; kind?: string } | null;
    branchDetailState?: { kind?: string; branch?: { name?: string; fullName?: string } | null } | null;
    width?: number;
    selectedWorkspaceSection?: string;
    listRefreshing?: boolean;
    shellLoadingMessage?: string;
    onModeChange?: (mode: string) => void;
    onSubviewChange?: (view: 'changes' | 'branches' | 'history' | 'overview') => void;
    onResize?: (delta: number) => void;
    repoInfoLoading?: boolean;
    repoSummaryLoading?: boolean;
    workspaceLoading?: boolean;
    branchesLoading?: boolean;
    listLoading?: boolean;
    fetchBusy?: boolean;
    pullBusy?: boolean;
    pushBusy?: boolean;
    checkoutBusy?: boolean;
    switchDetachedBusy?: boolean;
    mergeBusy?: boolean;
    deleteBusy?: boolean;
    mergeReviewOpen?: boolean;
    mergePreview?: { planFingerprint?: string } | null;
    mergeDialogState?: string;
    deleteReviewOpen?: boolean;
    deletePreview?: { planFingerprint?: string } | null;
    deleteDialogState?: string;
    onSelectBranchSubview?: (view: 'status' | 'history') => void;
    onFetch?: () => void;
    onPull?: () => void;
    onPush?: () => void;
    onSelectBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onCheckoutBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onSwitchDetached?: (target: { commitHash: string; shortHash?: string; source: 'graph' | 'branch_history'; branchName?: string }) => void;
    onMergeBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onDeleteBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onRefresh?: () => void;
    onRefreshSelectedBranch?: () => void;
    onSelectCurrentBranch?: () => void;
    onAskFlower?: (request: {
      kind: 'workspace_section';
      repoRootPath: string;
      headRef?: string;
      section: 'changes' | 'staged' | 'unstaged' | 'untracked' | 'conflicted';
      items: Array<{ section: 'staged' | 'unstaged' | 'untracked' | 'conflicted'; changeType: string; path: string; displayPath: string }>;
    }) => void;
    onOpenStash?: (request?: { tab?: 'save' | 'stashes'; repoRootPath?: string; source?: 'header' | 'changes' | 'branch_status' | 'merge_blocker' }) => void;
    onDiscardWorkspaceSection?: (section: 'changes' | 'staged' | 'conflicted') => void;
    onOpenInTerminal?: (request: { path: string; preferredName?: string }) => void;
    onBrowseFiles?: (request: { path: string; preferredName?: string; title?: string }) => void | Promise<void>;
    onConfirmMergeBranch?: (
      branch: { name?: string; fullName?: string; kind?: string },
      options: { planFingerprint?: string },
    ) => void;
    onConfirmDeleteBranch?: (
      branch: { name?: string; fullName?: string; kind?: string },
      options: { deleteMode: 'safe' | 'force'; confirmBranchName?: string; removeLinkedWorktree: boolean; discardLinkedWorktreeChanges: boolean; planFingerprint?: string },
    ) => void;
  }) => {
    onMount(() => {
      workspaceLifecycleStore.gitMounts += 1;
    });

    onCleanup(() => {
      workspaceLifecycleStore.gitUnmounts += 1;
    });

    createEffect(() => {
      gitWorkspaceRenderStore.snapshots.push({
        subview: props.subview,
        selectedBranchSubview: props.selectedBranchSubview,
        selectedBranchName: props.selectedBranch?.fullName ?? props.selectedBranch?.name,
        branchDetailKind: props.branchDetailState?.kind,
        selectedWorkspaceSection: props.selectedWorkspaceSection,
        repoInfoLoading: Boolean(props.repoInfoLoading),
        repoSummaryLoading: Boolean(props.repoSummaryLoading),
        workspaceLoading: Boolean(props.workspaceLoading),
        branchesLoading: Boolean(props.branchesLoading),
        listLoading: Boolean(props.listLoading),
        listRefreshing: Boolean(props.listRefreshing),
        shellLoadingMessage: props.shellLoadingMessage,
        fetchBusy: Boolean(props.fetchBusy),
        pullBusy: Boolean(props.pullBusy),
        pushBusy: Boolean(props.pushBusy),
        checkoutBusy: Boolean(props.checkoutBusy),
        switchDetachedBusy: Boolean(props.switchDetachedBusy),
        mergeBusy: Boolean(props.mergeBusy),
        deleteBusy: Boolean(props.deleteBusy),
      });
    });

    return (
      <div data-testid="git-workspace">
        <div>git:{props.mode}:{props.subview}:{props.currentPath}:{props.width ?? 0}</div>
        <div>branch-subview:{props.selectedBranchSubview ?? 'status'}</div>
        <div>selected-branch:{props.selectedBranch?.fullName ?? props.selectedBranch?.name ?? ''}</div>
        <div>branch-detail:{props.branchDetailState?.kind ?? ''}</div>
        <div>shell-loading:{props.shellLoadingMessage ?? ''}</div>
        <button type="button" onClick={() => props.onModeChange?.('files')}>mock-to-files</button>
        <button type="button" onClick={() => props.onSubviewChange?.('changes')}>mock-to-changes</button>
        <button type="button" onClick={() => props.onSubviewChange?.('branches')}>mock-to-branches</button>
        <button type="button" onClick={() => props.onSubviewChange?.('history')}>mock-to-history</button>
        <button type="button" onClick={() => props.onResize?.(24)}>mock-resize-sidebar</button>
        <button type="button" onClick={() => props.onRefresh?.()}>mock-refresh</button>
        <button type="button" onClick={() => props.onDiscardWorkspaceSection?.('changes')}>mock-discard-changes</button>
        <button type="button" onClick={() => props.onSelectBranchSubview?.('status')}>mock-branch-status</button>
        <button type="button" onClick={() => props.onSelectBranchSubview?.('history')}>mock-branch-history</button>
        <button type="button" onClick={() => props.onSelectBranch?.({ name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local' })}>mock-select-feature-branch</button>
        <button type="button" onClick={() => props.onRefreshSelectedBranch?.()}>mock-refresh-selected-branch</button>
        <button type="button" onClick={() => props.onSelectCurrentBranch?.()}>mock-select-current-branch</button>
        <button type="button" onClick={() => props.onFetch?.()}>mock-fetch</button>
        <button type="button" onClick={() => props.onPull?.()}>mock-pull</button>
        <button type="button" onClick={() => props.onPush?.()}>mock-push</button>
        {props.onOpenStash ? (
          <button
            type="button"
            onClick={() => props.onOpenStash?.({
              repoRootPath: '/workspace/repo',
              tab: 'stashes',
              source: 'changes',
            })}
          >
            mock-open-stash
          </button>
        ) : null}
        {props.onAskFlower ? (
          <button
            type="button"
            onClick={() => props.onAskFlower?.({
              kind: 'workspace_section',
              repoRootPath: '/workspace/repo',
              headRef: 'main',
              section: 'changes',
              items: [
                {
                  section: 'unstaged',
                  changeType: 'modified',
                  path: 'src/app.ts',
                  displayPath: 'src/app.ts',
                },
              ],
            })}
          >
            mock-git-ask-flower
          </button>
        ) : null}
        {props.onOpenInTerminal ? (
          <button
            type="button"
            onClick={() => props.onOpenInTerminal?.({
              path: '/workspace/repo',
              preferredName: 'repo',
            })}
          >
            mock-git-open-terminal
          </button>
        ) : null}
        {props.onBrowseFiles ? (
          <button
            type="button"
            onClick={() => props.onBrowseFiles?.({
              path: '/workspace/repo',
              preferredName: 'repo',
              title: 'Repo',
            })}
          >
            mock-git-browse-files
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => props.onCheckoutBranch?.({
            name: 'feature/demo',
            fullName: 'refs/heads/feature/demo',
            kind: 'local',
          })}
        >
          mock-checkout
        </button>
        <button
          type="button"
          onClick={() => props.onSwitchDetached?.({
            commitHash: 'fedcba9876543210',
            shortHash: 'fedcba98',
            source: 'branch_history',
            branchName: 'feature/demo',
          })}
        >
          mock-switch-detached
        </button>
        <button
          type="button"
          onClick={() => props.onMergeBranch?.({
            name: 'feature/demo',
            fullName: 'refs/heads/feature/demo',
            kind: 'local',
          })}
        >
          mock-merge-branch
        </button>
        <button
          type="button"
          onClick={() => props.onDeleteBranch?.({
            name: 'feature/demo',
            fullName: 'refs/heads/feature/demo',
            kind: 'local',
          })}
        >
          mock-delete-branch
        </button>
        {props.mergeReviewOpen && props.mergePreview ? (
          <button
            type="button"
            onClick={() => props.onConfirmMergeBranch?.({
              name: 'feature/demo',
              fullName: 'refs/heads/feature/demo',
              kind: 'local',
            }, {
              planFingerprint: props.mergePreview?.planFingerprint,
            })}
          >
            mock-confirm-merge-branch
          </button>
        ) : null}
        {props.deleteReviewOpen && props.deletePreview ? (
          <button
            type="button"
            onClick={() => props.onConfirmDeleteBranch?.({
              name: 'feature/demo',
              fullName: 'refs/heads/feature/demo',
              kind: 'local',
            }, {
              deleteMode: 'safe',
              removeLinkedWorktree: false,
              discardLinkedWorktreeChanges: false,
              planFingerprint: props.deletePreview?.planFingerprint,
            })}
          >
            mock-confirm-delete-branch
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock('./GitStashWindow', () => ({
  GitStashWindow: (props: {
    open?: boolean;
    tab?: 'save' | 'stashes';
    stashes: Array<{ id: string }>;
    selectedStashId?: string;
    stashDetail?: { id?: string } | null;
    stashDetailLoading?: boolean;
    review?: { kind?: 'apply' | 'drop'; preview?: { stash?: { id?: string } | null } | null } | null;
    reviewError?: string;
    reviewLoading?: boolean;
    onRefreshStashes?: () => void;
    onSelectStash?: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
    onRequestDrop?: () => void;
    onConfirmReview?: () => void;
  }) => {
    createEffect(() => {
      gitStashWindowRenderStore.snapshots.push({
        open: Boolean(props.open),
        tab: props.tab,
        stashCount: props.stashes.length,
        selectedStashId: props.selectedStashId,
        stashDetailId: props.stashDetail?.id,
        stashDetailLoading: Boolean(props.stashDetailLoading),
        reviewKind: props.review?.kind,
        reviewError: props.reviewError,
      });
      gitStashWindowRenderStore.onRefreshStashes = props.onRefreshStashes;
      gitStashWindowRenderStore.onRequestDrop = props.onRequestDrop;
      gitStashWindowRenderStore.onConfirmReview = props.onConfirmReview;
    });

    return props.open ? (
      <div data-testid="git-stash-window">
        <div>stash-tab:{props.tab ?? 'save'}</div>
        <div>stash-count:{props.stashes.length}</div>
        <div>stash-selected:{props.selectedStashId ?? ''}</div>
        <div>stash-detail:{props.stashDetail?.id ?? ''}</div>
        <div>stash-detail-loading:{props.stashDetailLoading ? 'yes' : 'no'}</div>
        <div>stash-review-kind:{props.review?.kind ?? ''}</div>
        <div>stash-review-stash:{props.review?.preview?.stash?.id ?? ''}</div>
        <div>stash-review-loading:{props.reviewLoading ? 'yes' : 'no'}</div>
        <div>stash-review-error:{props.reviewError ?? ''}</div>
        <button type="button" onClick={() => props.onRefreshStashes?.()}>mock-stash-refresh</button>
        <button type="button" onClick={() => props.onSelectStash?.(props.stashes[0]?.id ?? '')}>mock-stash-select-first</button>
        <button type="button" onClick={() => props.onRequestDrop?.()}>mock-stash-delete</button>
        <button type="button" onClick={() => props.onConfirmReview?.()}>mock-stash-confirm-review</button>
        <button type="button" onClick={() => props.onOpenChange?.(false)}>mock-stash-close</button>
      </div>
    ) : null;
  },
}));

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createEnvContext(options?: { canExecute?: boolean }): EnvContextValue {
  return createEnvContextWithIdAccessor(() => 'env-1', options);
}

function createEnvContextWithIdAccessor(envId: () => string, options?: { canExecute?: boolean }): EnvContextValue {
  const canExecute = options?.canExecute ?? true;
  const envResource = Object.assign(
    () => ({ permissions: { can_execute: canExecute } } as any),
    { state: 'ready' as const },
  ) as unknown as EnvContextValue['env'];
  return {
    env_id: envId,
    env: envResource,
    localRuntime: () => null,
    connect: async () => {},
    connecting: () => false,
    connectError: () => null,
    connectionOverlayVisible: () => false,
    connectionOverlayMessage: () => 'Connecting to runtime...',
    viewMode: () => 'activity',
    setViewMode: () => {},
    activeSurface: () => 'files',
    lastActivitySurface: () => 'files',
    openSurface: () => {},
    goActivity: () => {},
    deckSurfaceActivationSeq: () => 0,
    deckSurfaceActivation: () => null,
    consumeDeckSurfaceActivation: () => {},
    workbenchSurfaceActivationSeq: () => 0,
    workbenchSurfaceActivation: () => null,
    consumeWorkbenchSurfaceActivation: () => {},
    filesSidebarOpen: () => false,
    setFilesSidebarOpen: () => {},
    toggleFilesSidebar: () => {},
    settingsSeq: () => 0,
    bumpSettingsSeq: () => {},
    openSettings: () => {},
    debugConsoleEnabled: () => false,
    setDebugConsoleEnabled: () => {},
    openDebugConsole: () => {},
    settingsFocusSeq: () => 0,
    settingsFocusSection: () => null,
    askFlowerIntentSeq: () => 0,
    askFlowerIntent: () => null,
    injectAskFlowerIntent: () => {},
    openAskFlowerComposer: envActionSpies.openAskFlowerComposer,
    openTerminalInDirectoryRequestSeq: () => 0,
    openTerminalInDirectoryRequest: () => null,
    openTerminalInDirectory: envActionSpies.openTerminalInDirectory,
    openFileBrowserAtPath: envActionSpies.openFileBrowserAtPath,
    consumeOpenTerminalInDirectoryRequest: () => {},
    aiThreadFocusSeq: () => 0,
    aiThreadFocusId: () => null,
    focusAIThread: () => {},
  };
}

beforeEach(() => {
  delete window.redevenDesktopSessionContext;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  });

  widgetStateStore.values = {
    'widget-1': {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'history' },
    },
  };
  widgetStateStore.updateCalls = [];
  persistStore.values = {
    'redeven:remote-file-browser:page-sidebar-width': 268,
  };
  persistStore.loadCalls = [];
  persistStore.saveCalls = [];
  notificationStore.success = [];
  notificationStore.error = [];
  notificationStore.warning = [];
  notificationStore.info = [];
  clipboardStore.writeText.mockReset();
  legacyClipboardStore.execCommand.mockReset();
  legacyClipboardStore.execCommand.mockReturnValue(true);
  gitWorkspaceRenderStore.snapshots = [];
  gitStashWindowRenderStore.snapshots = [];
  gitStashWindowRenderStore.onRefreshStashes = undefined;
  gitStashWindowRenderStore.onRequestDrop = undefined;
  gitStashWindowRenderStore.onConfirmReview = undefined;
  workspaceLifecycleStore.filesMounts = 0;
  workspaceLifecycleStore.filesUnmounts = 0;
  workspaceLifecycleStore.gitMounts = 0;
  workspaceLifecycleStore.gitUnmounts = 0;
  workspacePathSubmitStore.nextPath = '/workspace/repo/src';
  inputDialogStore.pendingConfirmValue = null;
  fileBrowserSurfaceStore.openBrowser.mockReset();
  fileBrowserSurfaceStore.openBrowser.mockResolvedValue(undefined);
  fileBrowserSurfaceStore.closeBrowser.mockReset();
  envActionSpies.openAskFlowerComposer.mockReset();

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardStore.writeText,
    },
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: legacyClipboardStore.execCommand,
  });

  mockRpc.fs.list.mockResolvedValue({ entries: [] });
  mockRpc.fs.writeFile.mockResolvedValue({ success: true });
  mockRpc.fs.mkdir.mockResolvedValue({ success: true });
  mockRpc.fs.rename.mockResolvedValue({ success: true, newPath: '/workspace/repo/renamed' });
  mockRpc.fs.copy.mockResolvedValue({ success: true, newPath: '/workspace/repo/copied' });
  mockRpc.fs.delete.mockResolvedValue({ success: true });
  mockRpc.fs.getPathContext.mockResolvedValue({ agentHomePathAbs: '/workspace' });
  mockRpc.git.resolveRepo.mockResolvedValue({
    available: true,
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
  });
  mockRpc.git.getRepoSummary.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
    workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
  });
  mockRpc.git.listWorkspacePage.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    section: 'changes',
    summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
    totalCount: 0,
    offset: 0,
    nextOffset: 0,
    hasMore: false,
    items: [],
  });
  mockRpc.git.listBranches.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    currentRef: 'main',
    local: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true }],
    remote: [],
  });
  mockRpc.git.getBranchCompare.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    baseRef: 'main',
    targetRef: 'main',
    commits: [],
    files: [],
  });
  mockRpc.git.listCommits.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    commits: [{ hash: 'abc1234', shortHash: 'abc1234', parents: [], subject: 'Initial commit' }],
    hasMore: false,
    nextOffset: 0,
  });
  mockRpc.git.listStashes.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    stashes: [{
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP demo stash',
      branchName: 'main',
      createdAtUnixMs: 1,
    }],
  });
  mockRpc.git.getStashDetail.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    stash: {
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP demo stash',
      branchName: 'main',
      createdAtUnixMs: 1,
      files: [{
        changeType: 'modified',
        path: 'src/app.ts',
        displayPath: 'src/app.ts',
      }],
    },
  });
  mockRpc.git.saveStash.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
    created: {
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP demo stash',
    },
  });
  mockRpc.git.previewApplyStash.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    planFingerprint: 'stash-plan-1',
    stash: {
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP demo stash',
    },
  });
  mockRpc.git.applyStash.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
  });
  mockRpc.git.previewDropStash.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    planFingerprint: 'stash-drop-plan-1',
    stash: {
      id: 'stash-1',
      ref: 'stash@{0}',
      message: 'WIP demo stash',
    },
  });
  mockRpc.git.dropStash.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
  });
  mockRpc.git.fetchRepo.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
  });
  mockRpc.git.pullRepo.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'def5678',
  });
  mockRpc.git.pushRepo.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
  });
  mockRpc.git.checkoutBranch.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'feature/demo',
    headCommit: 'fedcba9',
  });
  mockRpc.git.switchDetached.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'HEAD',
    headCommit: 'fedcba9876543210',
    detached: true,
  });
  mockRpc.git.previewMergeBranch.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    currentRef: 'main',
    currentCommit: 'abc1234',
    sourceName: 'feature/demo',
    sourceFullName: 'refs/heads/feature/demo',
    sourceKind: 'local',
    sourceCommit: 'fedcba9',
    mergeBase: 'abc1234',
    sourceAheadCount: 1,
    sourceBehindCount: 0,
    outcome: 'fast_forward',
    planFingerprint: 'merge-plan-1',
    files: [],
  });
  mockRpc.git.mergeBranch.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'fedcba9',
    result: 'fast_forward',
    conflictSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
  });
  mockRpc.git.previewDeleteBranch.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    name: 'feature/demo',
    fullName: 'refs/heads/feature/demo',
    kind: 'local',
    requiresWorktreeRemoval: false,
    requiresDiscardConfirmation: false,
    safeDeleteAllowed: true,
    safeDeleteBaseRef: 'main',
    forceDeleteAllowed: true,
    forceDeleteRequiresConfirm: true,
    planFingerprint: 'plan-1',
  });
  mockRpc.git.deleteBranch.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    headRef: 'main',
    headCommit: 'abc1234',
    linkedWorktreeRemoved: false,
  });
});

afterEach(() => {
  delete window.redevenDesktopSessionContext;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('RemoteFileBrowser persistence', () => {
  it('restores the persisted git mode, subview, and directory on mount', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const gitWorkspace = host.querySelector('[data-testid="git-workspace"]') as HTMLDivElement | null;
      const filesWorkspace = host.querySelector('[data-testid="files-workspace"]') as HTMLDivElement | null;

      expect(gitWorkspace?.textContent).toContain('git:git:history:/workspace/repo/src:312');
      expect(gitWorkspace?.parentElement?.style.display).toBe('block');
      expect(filesWorkspace).toBeTruthy();
      expect(filesWorkspace?.parentElement?.style.display).toBe('none');
      expect(mockRpc.fs.list).not.toHaveBeenCalled();
      expect(mockRpc.git.resolveRepo).toHaveBeenCalledWith({ path: '/workspace/repo/src' });
    } finally {
      dispose();
    }
  });

  it('uses the desktop-managed environment scope id instead of the runtime env id for persisted paths', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.redevenDesktopSessionContext = {
      getSnapshot: () => ({
        managed_environment_id: 'local:dev-b',
        environment_storage_scope_id: 'local:dev-b',
      }),
    };
    widgetStateStore.values = {
      'widget-1': {
        browserSidebarWidth: 312,
        lastPathByEnv: {
          env_local: '/workspace/repo/shared-collision',
          'local:dev-b': '/workspace/repo/dev-b',
        },
        showHiddenByEnv: {
          env_local: false,
          'local:dev-b': false,
        },
        pageModeByEnv: {
          env_local: 'files',
          'local:dev-b': 'git',
        },
        gitSubviewByEnv: {
          env_local: 'changes',
          'local:dev-b': 'history',
        },
      },
    };

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContextWithIdAccessor(() => 'env_local')}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const gitWorkspace = host.querySelector('[data-testid="git-workspace"]') as HTMLDivElement | null;

      expect(gitWorkspace?.textContent).toContain('git:git:history:/workspace/repo/dev-b:312');
      expect(mockRpc.git.resolveRepo).toHaveBeenCalledWith({ path: '/workspace/repo/dev-b' });
      expect(mockRpc.git.resolveRepo).not.toHaveBeenCalledWith({ path: '/workspace/repo/shared-collision' });
    } finally {
      dispose();
    }
  });

  it('hydrates the file tree lazily when returning from restored git mode to files', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const toFilesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-files') as HTMLButtonElement | undefined;
      expect(toFilesButton).toBeTruthy();
      toFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.fs.list).toHaveBeenCalledWith({ path: '/workspace/repo/src', showHidden: false });
    } finally {
      dispose();
    }
  });

  it('restores the persisted hidden-file preference on mount', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      showHiddenByEnv: { 'env-1': true },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(mockRpc.fs.list).toHaveBeenCalledWith({ path: '/workspace/repo/src', showHidden: true });
    } finally {
      dispose();
    }
  });

  it('does not rewrite widget persistence while restoring state on mount', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(widgetStateStore.updateCalls).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('revalidates a cached directory when navigating back into it', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    let srcLoadCount = 0;
    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          srcLoadCount += 1;
          return {
            entries: [
              {
                name: srcLoadCount === 1 ? 'old.txt' : 'new.txt',
                path: `/workspace/repo/src/${srcLoadCount === 1 ? 'old.txt' : 'new.txt'}`,
                isDirectory: false,
                size: 1,
                modifiedAt: 1,
                createdAt: 1,
                permissions: '-rw-r--r--',
              },
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const navSrcButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-nav-src') as HTMLButtonElement | undefined;
      const navRepoButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-nav-repo') as HTMLButtonElement | undefined;
      expect(navSrcButton).toBeTruthy();
      expect(navRepoButton).toBeTruthy();

      navSrcButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      navRepoButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      navSrcButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const srcCalls = mockRpc.fs.list.mock.calls.filter((call) => call[0]?.path === '/workspace/repo/src');
      expect(srcCalls).toHaveLength(2);
    } finally {
      dispose();
    }
  });

  it('keeps the current directory rendered until the requested target directory is ready', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const srcLoad = deferred<{ entries: Array<Record<string, unknown>> }>();
    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return srcLoad.promise;
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const navSrcButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-nav-src') as HTMLButtonElement | undefined;
      expect(navSrcButton).toBeTruthy();

      navSrcButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();

      expect(host.textContent).toContain('files:files:/workspace/repo:312:0');
      expect(host.textContent).toContain('Opening...');
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);

      srcLoad.resolve({
        entries: [
          { name: 'fresh.txt', path: '/workspace/repo/src/fresh.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
        ],
      });
      await flush();
      await flush();

      expect(host.textContent).toContain('files:files:/workspace/repo/src:312:0');
      expect(host.textContent).not.toContain('Opening...');
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);
    } finally {
      dispose();
    }
  });

  it('recovers to the nearest existing ancestor after a cached directory disappears', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    let missingLoadCount = 0;
    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              {
                name: missingLoadCount >= 2 ? 'renamed' : 'missing',
                path: missingLoadCount >= 2 ? '/workspace/repo/renamed' : '/workspace/repo/missing',
                isDirectory: true,
                size: 0,
                modifiedAt: 1,
                createdAt: 1,
                permissions: 'drwxr-xr-x',
              },
            ],
          };
        case '/workspace/repo/missing':
          missingLoadCount += 1;
          if (missingLoadCount === 1) {
            return {
              entries: [
                { name: 'nested.txt', path: '/workspace/repo/missing/nested.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
              ],
            };
          }
          throw new RpcError({ typeId: 1001, code: 404, message: 'not found' });
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const navMissingButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-nav-missing') as HTMLButtonElement | undefined;
      const navRepoButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-nav-repo') as HTMLButtonElement | undefined;
      expect(navMissingButton).toBeTruthy();
      expect(navRepoButton).toBeTruthy();

      navMissingButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      navRepoButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      mockRpc.fs.list.mockClear();
      navMissingButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.fs.list.mock.calls.map((call) => call[0]?.path)).toEqual([
        '/workspace/repo/missing',
        '/workspace/repo',
      ]);
      expect(host.textContent).toContain('files:files:/workspace/repo:');
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'lastPathByEnv',
        value: { 'env-1': '/workspace/repo' },
      });
    } finally {
      dispose();
    }
  });

  it('keeps the deleted current directory rendered until the fallback ancestor is ready', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/missing' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    let missingDeleted = false;
    let repoFallbackLoad = deferred<{ entries: Array<Record<string, unknown>> }>();
    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          if (missingDeleted) {
            return repoFallbackLoad.promise;
          }
          return {
            entries: [
              { name: 'missing', path: '/workspace/repo/missing', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/missing':
          if (!missingDeleted) {
            return {
              entries: [
                { name: 'nested.txt', path: '/workspace/repo/missing/nested.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
              ],
            };
          }
          throw new RpcError({ typeId: 1001, code: 404, message: 'directory missing' });
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const refreshButton = host.querySelector('button[aria-label="Refresh current directory"]') as HTMLButtonElement | null;
      expect(refreshButton).toBeTruthy();

      missingDeleted = true;
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();

      expect(host.textContent).toContain('files:files:/workspace/repo/missing:312:0');
      expect(host.textContent).toContain('Refreshing...');
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);

      repoFallbackLoad.resolve({
        entries: [
          { name: 'renamed', path: '/workspace/repo/renamed', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
        ],
      });
      await flush();
      await flush();

      expect(host.textContent).toContain('files:files:/workspace/repo:312:0');
      expect(host.textContent).not.toContain('Refreshing...');
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'lastPathByEnv',
        value: { 'env-1': '/workspace/repo' },
      });
    } finally {
      dispose();
    }
  });

  it('refreshes the current directory explicitly even when the path stays the same', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return {
            entries: [
              { name: 'current.txt', path: '/workspace/repo/src/current.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const refreshButton = host.querySelector('button[aria-label="Refresh current directory"]') as HTMLButtonElement | null;
      expect(refreshButton).toBeTruthy();
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.fs.list.mock.calls.map((call) => call[0]?.path)).toEqual(['/workspace/repo/src']);
    } finally {
      dispose();
    }
  });

  it('commits manual go-to-path navigation only after the requested directory is ready', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    workspacePathSubmitStore.nextPath = '/workspace/repo/src';

    const srcLoad = deferred<{ entries: Array<Record<string, unknown>> }>();
    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return srcLoad.promise;
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const submitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-submit-path') as HTMLButtonElement | undefined;
      expect(submitButton).toBeTruthy();

      submitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();

      expect(host.textContent).toContain('files:files:/workspace/repo:312:0');
      expect(host.textContent).toContain('Opening...');

      srcLoad.resolve({
        entries: [
          { name: 'fresh.txt', path: '/workspace/repo/src/fresh.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
        ],
      });
      await flush();
      await flush();

      expect(host.textContent).toContain('files:files:/workspace/repo/src:312:0');
      expect(host.textContent).not.toContain('Opening...');
    } finally {
      dispose();
    }
  });

  it('keeps the current directory stable when manual go-to-path targets an invalid directory', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    workspacePathSubmitStore.nextPath = '/workspace/repo/missing';

    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/missing':
          throw new RpcError({ typeId: 1001, code: 404, message: 'not found' });
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      widgetStateStore.updateCalls = [];

      const submitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-submit-path') as HTMLButtonElement | undefined;
      expect(submitButton).toBeTruthy();

      submitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.textContent).toContain('files:files:/workspace/repo:312:0');
      expect(notificationStore.info).toContainEqual({
        title: 'mock-path-submit',
        message: 'error:not found',
      });
      expect(widgetStateStore.updateCalls).not.toContainEqual({
        widgetId: 'widget-1',
        key: 'lastPathByEnv',
        value: { 'env-1': '/workspace/repo/missing' },
      });
    } finally {
      dispose();
    }
  });

  it('revalidates the current directory when manual go-to-path submits the current path again', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    workspacePathSubmitStore.nextPath = '/workspace/repo/src';

    mockRpc.fs.list.mockImplementation(async ({ path, showHidden: showHiddenArg }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return {
            entries: [
              { name: showHiddenArg ? '.env' : 'current.txt', path: showHiddenArg ? '/workspace/repo/src/.env' : '/workspace/repo/src/current.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();

      const submitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-submit-path') as HTMLButtonElement | undefined;
      expect(submitButton).toBeTruthy();

      submitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.fs.list.mock.calls.map((call) => call[0]?.path)).toEqual(['/workspace/repo/src']);
      expect(notificationStore.info).toContainEqual({
        title: 'mock-path-submit',
        message: 'refreshed:/workspace/repo/src',
      });
    } finally {
      dispose();
    }
  });

  it('enables hidden-file visibility after manual go-to-path opens a hidden directory successfully', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    workspacePathSubmitStore.nextPath = '/workspace/.config';

    mockRpc.fs.list.mockImplementation(async ({ path, showHidden: showHiddenArg }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: showHiddenArg
              ? [
                  { name: '.config', path: '/workspace/.config', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
                  { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
                ]
              : [
                  { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
                ],
          };
        case '/workspace/repo':
          return { entries: [] };
        case '/workspace/.config':
          return {
            entries: [
              { name: 'redeven', path: '/workspace/.config/redeven', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      widgetStateStore.updateCalls = [];
      mockRpc.fs.list.mockClear();

      const submitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-submit-path') as HTMLButtonElement | undefined;
      expect(submitButton).toBeTruthy();

      submitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(mockRpc.fs.list.mock.calls[0]?.[0]).toEqual({ path: '/workspace', showHidden: true });
      expect(host.textContent).toContain('files:files:/workspace/.config:312:0');
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'showHiddenByEnv',
        value: { 'env-1': true },
      });
    } finally {
      dispose();
    }
  });

  it('restores page and widget sidebar widths from their own surfaces without cross-writing on mount', async () => {
    const pageHost = document.createElement('div');
    const widgetHost = document.createElement('div');
    document.body.append(pageHost, widgetHost);

    const disposePage = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser />
        </EnvContext.Provider>
      </LayoutProvider>
    ), pageHost);
    const disposeWidget = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), widgetHost);

    try {
      await flush();

      expect(pageHost.textContent).toContain('files:files:/workspace:268:0:page');
      expect(widgetHost.textContent).toContain('git:git:history:/workspace/repo/src:312');
      expect(widgetStateStore.updateCalls).toEqual([]);
      expect(persistStore.saveCalls).toEqual([]);
    } finally {
      disposeWidget();
      disposePage();
    }
  });

  it('persists widget sidebar width only to widget state when the integrated browser is resized', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      widgetStateStore.updateCalls = [];
      persistStore.saveCalls = [];

      const resizeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-resize-sidebar') as HTMLButtonElement | undefined;
      expect(resizeButton).toBeTruthy();

      resizeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.textContent).toContain('git:git:history:/workspace/repo/src:336');
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'browserSidebarWidth',
        value: 336,
      });
      expect(persistStore.saveCalls).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('persists page sidebar width only to the dedicated page storage key when resized', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      widgetStateStore.updateCalls = [];
      persistStore.saveCalls = [];

      const resizeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-resize-sidebar') as HTMLButtonElement | undefined;
      expect(resizeButton).toBeTruthy();

      resizeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.textContent).toContain('files:files:/workspace:292:0:page');
      expect(persistStore.saveCalls).toContainEqual({
        key: 'redeven:remote-file-browser:page-sidebar-width',
        value: 292,
      });
      expect(widgetStateStore.updateCalls).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('keeps the files workspace mounted after switching away so local state survives the round trip', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const filesWorkspace = host.querySelector('[data-testid="files-workspace"]') as HTMLDivElement | null;
      expect(filesWorkspace).toBeTruthy();
      expect(workspaceLifecycleStore.filesMounts).toBe(1);
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);
      expect(filesWorkspace?.parentElement?.style.display).toBe('block');

      const bumpButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-files-bump') as HTMLButtonElement | undefined;
      const toGitButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-git') as HTMLButtonElement | undefined;
      expect(bumpButton).toBeTruthy();
      expect(toGitButton).toBeTruthy();

      bumpButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      toGitButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const gitWorkspace = host.querySelector('[data-testid="git-workspace"]') as HTMLDivElement | null;
      expect(gitWorkspace).toBeTruthy();
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);
      expect(workspaceLifecycleStore.gitMounts).toBe(1);
      expect(filesWorkspace?.parentElement?.style.display).toBe('none');
      expect(gitWorkspace?.parentElement?.style.display).toBe('block');
      expect(gitWorkspace?.textContent).toContain('git:git:changes:/workspace/repo/src:312');

      const toFilesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-files') as HTMLButtonElement | undefined;
      expect(toFilesButton).toBeTruthy();
      toFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(workspaceLifecycleStore.filesMounts).toBe(1);
      expect(workspaceLifecycleStore.filesUnmounts).toBe(0);
      expect(filesWorkspace?.parentElement?.style.display).toBe('block');
      expect(filesWorkspace?.textContent).toContain('files:files:/workspace/repo/src:312:1');
    } finally {
      dispose();
    }
  });

  it('refetches the same branch history when returning from status to history', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'branches' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.git.listCommits.mockClear();

      const toHistoryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-branch-history') as HTMLButtonElement | undefined;
      const toStatusButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-branch-status') as HTMLButtonElement | undefined;
      expect(toHistoryButton).toBeTruthy();
      expect(toStatusButton).toBeTruthy();

      toHistoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.listCommits).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.listCommits).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        ref: 'main',
        offset: 0,
        limit: 50,
      });

      toStatusButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      toHistoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.listCommits).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });

  it('refetches graph commits when returning from changes to the same graph view', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'history' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.git.listCommits.mockClear();

      const toChangesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-changes') as HTMLButtonElement | undefined;
      const toHistoryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-history') as HTMLButtonElement | undefined;
      expect(toChangesButton).toBeTruthy();
      expect(toHistoryButton).toBeTruthy();

      toChangesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      toHistoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.listCommits).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.listCommits).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        ref: undefined,
        offset: 0,
        limit: 50,
      });
    } finally {
      dispose();
    }
  });

  it('keeps branch history loading local to the panel instead of sending a shell blocking message', async () => {
    widgetStateStore.values['widget-1'] = {
      browserSidebarWidth: 312,
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'branches' },
    };

    let resolveCommits: ((value: Awaited<ReturnType<typeof mockRpc.git.listCommits>>) => void) | undefined;
    mockRpc.git.listCommits.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCommits = resolve;
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const toHistoryButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-branch-history') as HTMLButtonElement | undefined;
      expect(toHistoryButton).toBeTruthy();

      toHistoryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.textContent).toContain('branch-subview:history');
      expect(host.textContent).toContain('shell-loading:');
      expect(host.textContent).not.toContain('Loading commit history...');
      expect(gitWorkspaceRenderStore.snapshots.some((item) => (
        item.subview === 'branches'
        && item.selectedBranchSubview === 'history'
        && item.listLoading
        && item.shellLoadingMessage === ''
      ))).toBe(true);
    } finally {
      resolveCommits?.({
        repoRootPath: '/workspace/repo',
        commits: [{ hash: 'abc1234', shortHash: 'abc1234', parents: [], subject: 'Initial commit' }],
        hasMore: false,
        nextOffset: 0,
      });
      dispose();
    }
  });

  it('reloads stash detail exactly once after refreshing the same selected stash', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.git.listStashes.mockClear();
      mockRpc.git.getStashDetail.mockClear();
      gitStashWindowRenderStore.snapshots = [];

      const openStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-stash') as HTMLButtonElement | undefined;
      expect(openStashButton).toBeTruthy();

      openStashButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.tab === 'stashes')).toBe(true);
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.selectedStashId === 'stash-1')).toBe(true);
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.stashDetailId === 'stash-1')).toBe(true);
      expect(mockRpc.git.listStashes).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.getStashDetail).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.getStashDetail).toHaveBeenNthCalledWith(1, {
        repoRootPath: '/workspace/repo',
        id: 'stash-1',
      });

      expect(gitStashWindowRenderStore.onRefreshStashes).toBeTruthy();
      gitStashWindowRenderStore.onRefreshStashes?.();
      await flush();
      await flush();

      expect(mockRpc.git.listStashes).toHaveBeenCalledTimes(2);
      expect(mockRpc.git.getStashDetail).toHaveBeenCalledTimes(2);
      expect(mockRpc.git.getStashDetail).toHaveBeenNthCalledWith(2, {
        repoRootPath: '/workspace/repo',
        id: 'stash-1',
      });
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.tab === 'stashes' && item.stashDetailLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('rebuilds the delete confirmation after a stale stash drop plan', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    mockRpc.git.previewDropStash.mockReset();
    mockRpc.git.previewDropStash
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        headCommit: 'abc1234',
        planFingerprint: 'stash-drop-plan-1',
        stash: {
          id: 'stash-1',
          ref: 'stash@{0}',
          message: 'WIP demo stash',
        },
      })
      .mockResolvedValueOnce({
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        headCommit: 'def5678',
        planFingerprint: 'stash-drop-plan-2',
        stash: {
          id: 'stash-1',
          ref: 'stash@{0}',
          message: 'WIP demo stash',
        },
      });
    mockRpc.git.dropStash.mockRejectedValueOnce(new RpcError({
      typeId: 1127,
      code: 409,
      message: 'stash drop plan is stale; review the stash again',
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const openStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-stash') as HTMLButtonElement | undefined;
      expect(openStashButton).toBeTruthy();
      openStashButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();

      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.tab === 'stashes')).toBe(true);
      expect(gitStashWindowRenderStore.onRequestDrop).toBeTruthy();
      gitStashWindowRenderStore.onRequestDrop?.();
      await flush();
      await flush();

      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.reviewKind === 'drop')).toBe(true);
      mockRpc.git.getRepoSummary.mockResolvedValueOnce({
        repoRootPath: '/workspace/repo',
        headRef: 'main',
        headCommit: 'def5678',
        workspaceSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      });

      expect(gitStashWindowRenderStore.onConfirmReview).toBeTruthy();
      gitStashWindowRenderStore.onConfirmReview?.();
      await flush();
      await flush();

      expect(mockRpc.git.dropStash).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.previewDropStash).toHaveBeenCalledTimes(2);
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.reviewKind === 'drop')).toBe(true);
      expect(notificationStore.info).toContainEqual({
        title: 'Delete confirmation refreshed',
        message: 'Repository state changed. Confirm deletion again.',
      });
      expect(notificationStore.error.some((item) => item.title === 'Delete stash failed')).toBe(false);
    } finally {
      dispose();
    }
  });

  it('refreshes the stash list and clears the delete confirmation when the stash is already gone', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };
    mockRpc.git.previewDropStash.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      headRef: 'main',
      headCommit: 'abc1234',
      planFingerprint: 'stash-drop-plan-1',
      stash: {
        id: 'stash-1',
        ref: 'stash@{0}',
        message: 'WIP demo stash',
      },
    });
    mockRpc.git.dropStash.mockRejectedValueOnce(new RpcError({
      typeId: 1127,
      code: 404,
      message: 'stash not found',
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const openStashButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-stash') as HTMLButtonElement | undefined;
      expect(openStashButton).toBeTruthy();
      openStashButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();

      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.tab === 'stashes')).toBe(true);
      expect(gitStashWindowRenderStore.onRequestDrop).toBeTruthy();
      gitStashWindowRenderStore.onRequestDrop?.();
      await flush();
      await flush();
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.reviewKind === 'drop')).toBe(true);
      mockRpc.git.listStashes.mockResolvedValueOnce({
        repoRootPath: '/workspace/repo',
        stashes: [],
      });

      expect(gitStashWindowRenderStore.onConfirmReview).toBeTruthy();
      gitStashWindowRenderStore.onConfirmReview?.();
      await flush();
      await flush();

      expect(notificationStore.info).toContainEqual({
        title: 'Stash no longer available',
        message: 'The selected stash no longer exists. The stash list was refreshed.',
      });
      expect(notificationStore.error.some((item) => item.title === 'Delete stash failed')).toBe(false);
      expect(gitStashWindowRenderStore.snapshots.some((item) => item.open && item.stashCount === 0 && item.selectedStashId === '')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('routes Git helper actions through the host integrations', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const askFlowerButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-git-ask-flower') as HTMLButtonElement | undefined;
      const openTerminalButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-git-open-terminal') as HTMLButtonElement | undefined;
      const browseFilesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-git-browse-files') as HTMLButtonElement | undefined;

      expect(askFlowerButton).toBeTruthy();
      expect(openTerminalButton).toBeTruthy();
      expect(browseFilesButton).toBeTruthy();

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      openTerminalButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      browseFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(envActionSpies.openAskFlowerComposer).toHaveBeenCalledTimes(1);
      expect(envActionSpies.openAskFlowerComposer.mock.calls[0]?.[0]).toMatchObject({
        source: 'git_browser',
        mode: 'append',
        suggestedWorkingDirAbs: '/workspace/repo',
        contextItems: [
          {
            kind: 'text_snapshot',
            title: 'Workspace changes',
            detail: 'main · Changes',
          },
        ],
      });
      const intent = envActionSpies.openAskFlowerComposer.mock.calls[0]?.[0];
      expect(intent?.contextItems?.[0]?.content ?? '').toContain('Context: Git workspace changes');
      expect(envActionSpies.openTerminalInDirectory).toHaveBeenCalledWith('/workspace/repo', { preferredName: 'repo' });
      expect(envActionSpies.openFileBrowserAtPath).toHaveBeenCalledWith('/workspace/repo', {
        homePath: '/workspace',
        title: 'Repo',
      });
    } finally {
      dispose();
    }
  });

  it('falls back to the nearest visible ancestor when hidden files are disabled from a hidden path', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/src/.cache/config' },
      showHiddenByEnv: { 'env-1': true },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.fs.list.mockClear();
      widgetStateStore.updateCalls = [];

      const moreButton = document.body.querySelector('button[aria-label="More file browser options"]') as HTMLButtonElement | null;
      expect(moreButton).toBeTruthy();
      moreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const showHiddenItem = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Show hidden files')) as HTMLButtonElement | undefined;
      expect(showHiddenItem).toBeTruthy();
      showHiddenItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(mockRpc.fs.list).toHaveBeenLastCalledWith({ path: '/workspace/src', showHidden: false });
      expect(host.textContent).toContain('files:files:/workspace/src:240:0');
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'showHiddenByEnv',
        value: { 'env-1': false },
      });
      expect(widgetStateStore.updateCalls).toContainEqual({
        widgetId: 'widget-1',
        key: 'lastPathByEnv',
        value: { 'env-1': '/workspace/src' },
      });
    } finally {
      dispose();
    }
  });

  it('routes the More menu go-to-path action into the workspace path editor request key', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      showHiddenByEnv: { 'env-1': false },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      const requestKeyBefore = host.querySelector('[data-testid="mock-path-edit-request-key"]') as HTMLElement | null;
      expect(requestKeyBefore?.textContent).toBe('0');

      const moreButton = document.body.querySelector('button[aria-label="More file browser options"]') as HTMLButtonElement | null;
      expect(moreButton).toBeTruthy();
      moreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const goToPathItem = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.includes('Go to path...')) as HTMLButtonElement | undefined;
      expect(goToPathItem).toBeTruthy();
      goToPathItem!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const requestKeyAfter = host.querySelector('[data-testid="mock-path-edit-request-key"]') as HTMLElement | null;
      expect(requestKeyAfter?.textContent).toBe('1');
    } finally {
      dispose();
    }
  });

  it('copies the selected file name from the file browser context menu', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    clipboardStore.writeText.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const copyNameButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-copy-name') as HTMLButtonElement | undefined;
      expect(copyNameButton).toBeTruthy();

      copyNameButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(clipboardStore.writeText).toHaveBeenCalledWith('.env');
      expect(notificationStore.success).toContainEqual({ title: 'Copied', message: '".env" copied to clipboard.' });
    } finally {
      dispose();
    }
  });

  it('copies the selected absolute path from the file browser context menu', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    clipboardStore.writeText.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const copyPathButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-copy-path') as HTMLButtonElement | undefined;
      expect(copyPathButton).toBeTruthy();

      copyPathButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(clipboardStore.writeText).toHaveBeenCalledWith('/workspace/repo/src/.env');
      expect(notificationStore.success).toContainEqual({ title: 'Copied', message: '"/workspace/repo/src/.env" copied to clipboard.' });
    } finally {
      dispose();
    }
  });

  it('copies every selected absolute path from the multi-select context menu', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    clipboardStore.writeText.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const copyPathButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-copy-path-multi') as HTMLButtonElement | undefined;
      expect(copyPathButton).toBeTruthy();

      copyPathButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(clipboardStore.writeText).toHaveBeenCalledWith('/workspace/repo/src\n/workspace/repo/src/.env');
      expect(notificationStore.success).toContainEqual({ title: 'Copied', message: '2 paths copied to clipboard.' });
    } finally {
      dispose();
    }
  });

  it('routes multi-select Ask Flower through the entire current selection', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const askFlowerButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-ask-flower-multi') as HTMLButtonElement | undefined;
      expect(askFlowerButton).toBeTruthy();

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(envActionSpies.openAskFlowerComposer).toHaveBeenCalledTimes(1);
      expect(envActionSpies.openAskFlowerComposer.mock.calls[0]?.[0]).toMatchObject({
        source: 'file_browser',
        mode: 'append',
        suggestedWorkingDirAbs: '/workspace/repo/src',
        contextItems: [
          {
            kind: 'file_path',
            path: '/workspace/repo/src',
            isDirectory: true,
          },
          {
            kind: 'file_path',
            path: '/workspace/repo/src/.env',
            isDirectory: false,
          },
        ],
      });
    } finally {
      dispose();
    }
  });

  it('shows directory helper menus with New submenus and dispatches terminal requests for both folder and background contexts', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      expect(host.querySelector('[data-testid="mock-folder-menu-order"]')?.textContent).toBe(
        'ask-flower,open-in-terminal,new[new-file|new-folder],separator:new,duplicate,copy-name,copy-path,rename,delete',
      );
      expect(host.querySelector('[data-testid="mock-background-menu-order"]')?.textContent).toBe(
        'ask-flower,open-in-terminal,new[new-file|new-folder]',
      );
      expect(host.querySelector('[data-testid="mock-folder-new-has-icon"]')?.textContent).toBe('yes');
      expect(host.querySelector('[data-testid="mock-background-new-has-icon"]')?.textContent).toBe('yes');
      expect(host.querySelector('[data-testid="mock-file-menu-order"]')?.textContent).toBe(
        'ask-flower,separator:ask-flower,duplicate,copy-name,copy-path,rename,delete',
      );
      expect(host.querySelector('[data-testid="mock-multi-menu-order"]')?.textContent).toBe(
        'ask-flower,separator:ask-flower,duplicate,copy-name,copy-path,delete',
      );

      const folderButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-folder') as HTMLButtonElement | undefined;
      const backgroundButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-background') as HTMLButtonElement | undefined;
      const fileButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-file') as HTMLButtonElement | undefined;
      const multiButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-multi') as HTMLButtonElement | undefined;

      expect(folderButton).toBeTruthy();
      expect(backgroundButton).toBeTruthy();
      expect(fileButton).toBeUndefined();
      expect(multiButton).toBeUndefined();

      folderButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      backgroundButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(envActionSpies.openTerminalInDirectory).toHaveBeenNthCalledWith(1, '/workspace/repo/src', { preferredName: 'src' });
      expect(envActionSpies.openTerminalInDirectory).toHaveBeenNthCalledWith(2, '/workspace/repo/src', { preferredName: 'src' });
    } finally {
      dispose();
    }
  });

  it('routes background Ask Flower through the current directory context', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const askFlowerButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-ask-flower-background') as HTMLButtonElement | undefined;
      expect(askFlowerButton).toBeTruthy();

      askFlowerButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(envActionSpies.openAskFlowerComposer).toHaveBeenCalledTimes(1);
      expect(envActionSpies.openAskFlowerComposer.mock.calls[0]?.[0]).toMatchObject({
        source: 'file_browser',
        mode: 'append',
        suggestedWorkingDirAbs: '/workspace/repo/src',
        contextItems: [
          {
            kind: 'file_path',
            path: '/workspace/repo/src',
            isDirectory: true,
          },
        ],
      });
    } finally {
      dispose();
    }
  });

  it('creates a file from the background New submenu, issues a reveal request, and clears it after consume', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return {
            entries: [
              { name: 'current.txt', path: '/workspace/repo/src/current.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const createButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-create-file-from-background') as HTMLButtonElement | undefined;
      expect(createButton).toBeTruthy();
      inputDialogStore.pendingConfirmValue = 'fresh.txt';

      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(mockRpc.fs.writeFile).toHaveBeenCalledWith({
        path: '/workspace/repo/src/fresh.txt',
        content: '',
        createDirs: false,
      });
      expect(host.querySelector('[data-testid="mock-files-tree"]')?.textContent).toContain('/workspace/repo/src/fresh.txt');
      expect(host.querySelector('[data-testid="mock-current-path"]')?.textContent).toBe('/workspace/repo/src');
      expect(host.querySelector('[data-testid="mock-reveal-parent-path"]')?.textContent).toBe('/workspace/repo/src');
      expect(host.querySelector('[data-testid="mock-reveal-target-path"]')?.textContent).toBe('/workspace/repo/src/fresh.txt');
      expect(host.querySelector('[data-testid="mock-reveal-request-id"]')?.textContent).toMatch(/^created-entry-\d+$/);
      expect(notificationStore.success).toContainEqual({ title: 'Created', message: '"fresh.txt" created.' });

      const consumeRevealButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-consume-reveal') as HTMLButtonElement | undefined;
      expect(consumeRevealButton).toBeTruthy();
      consumeRevealButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.querySelector('[data-testid="mock-reveal-request"]')?.textContent).toBe('');
    } finally {
      dispose();
    }
  });

  it('creates a folder from the directory New submenu, navigates into the target parent, and keeps the reveal request until consumed', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    mockRpc.fs.list.mockImplementation(async ({ path }) => {
      switch (path) {
        case '/workspace':
          return {
            entries: [
              { name: 'repo', path: '/workspace/repo', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo':
          return {
            entries: [
              { name: 'src', path: '/workspace/repo/src', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' },
            ],
          };
        case '/workspace/repo/src':
          return {
            entries: [
              { name: 'current.txt', path: '/workspace/repo/src/current.txt', isDirectory: false, size: 1, modifiedAt: 1, createdAt: 1, permissions: '-rw-r--r--' },
              ...(mockRpc.fs.mkdir.mock.calls.some(([request]) => request?.path === '/workspace/repo/src/components')
                ? [{ name: 'components', path: '/workspace/repo/src/components', isDirectory: true, size: 0, modifiedAt: 1, createdAt: 1, permissions: 'drwxr-xr-x' }]
                : []),
            ],
          };
        default:
          return { entries: [] };
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const createButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-create-folder-from-folder') as HTMLButtonElement | undefined;
      expect(createButton).toBeTruthy();
      inputDialogStore.pendingConfirmValue = 'components';

      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
      await flush();

      expect(mockRpc.fs.mkdir).toHaveBeenCalledWith({
        path: '/workspace/repo/src/components',
        createParents: false,
      });
      expect(mockRpc.fs.list).toHaveBeenCalledWith({ path: '/workspace/repo/src', showHidden: false });
      expect(host.querySelector('[data-testid="mock-files-tree"]')?.textContent).toContain('/workspace/repo/src/components');
      expect(host.querySelector('[data-testid="mock-current-path"]')?.textContent).toBe('/workspace/repo/src');
      expect(host.querySelector('[data-testid="mock-reveal-parent-path"]')?.textContent).toBe('/workspace/repo/src');
      expect(host.querySelector('[data-testid="mock-reveal-target-path"]')?.textContent).toBe('/workspace/repo/src/components');
      expect(host.querySelector('[data-testid="mock-reveal-request-id"]')?.textContent).toMatch(/^created-entry-\d+$/);
      expect(notificationStore.success).toContainEqual({ title: 'Created', message: '"components" created.' });

      const consumeRevealButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-consume-reveal') as HTMLButtonElement | undefined;
      expect(consumeRevealButton).toBeTruthy();
      consumeRevealButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(host.querySelector('[data-testid="mock-reveal-request"]')?.textContent).toBe('');
    } finally {
      dispose();
    }
  });

  it('hides Open in Terminal when execute permission is unavailable', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext({ canExecute: false })}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      expect(host.querySelector('[data-testid="mock-folder-menu-order"]')?.textContent).toBe(
        'ask-flower,new[new-file|new-folder],separator:new,duplicate,copy-name,copy-path,rename,delete',
      );
      expect(host.querySelector('[data-testid="mock-background-menu-order"]')?.textContent).toBe(
        'ask-flower,new[new-file|new-folder]',
      );
      const folderButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-folder') as HTMLButtonElement | undefined;
      const backgroundButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-open-terminal-background') as HTMLButtonElement | undefined;
      expect(folderButton).toBeUndefined();
      expect(backgroundButton).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('enables page-level type-to-filter routing only for the dedicated browser page', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(host.textContent).toContain(':page');
    } finally {
      dispose();
    }
  });

  it('does not close the preview while the initial env id is still hydrating', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [envId, setEnvId] = createSignal('');

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContextWithIdAccessor(envId)}>
          <RemoteFileBrowser />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      filePreviewStore.openPreview.mockClear();
      filePreviewStore.closePreview.mockClear();
      envActionSpies.openTerminalInDirectory.mockReset();

      filePreviewStore.openPreview({
        id: '/workspace/repo/src/index.ts',
        name: 'index.ts',
        type: 'file',
        path: '/workspace/repo/src/index.ts',
      });
      expect(filePreviewStore.openPreview).toHaveBeenCalledTimes(1);

      setEnvId('env-1');
      await flush();

      expect(filePreviewStore.closePreview).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('closes the preview when switching between concrete environments', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const [envId, setEnvId] = createSignal('env-1');

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContextWithIdAccessor(envId)}>
          <RemoteFileBrowser />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      filePreviewStore.closePreview.mockClear();

      setEnvId('env-2');
      await flush();

      expect(filePreviewStore.closePreview).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('copies the selected file name with the legacy clipboard fallback when the async clipboard API is unavailable', async () => {
    widgetStateStore.values['widget-1'] = {
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'files' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const copyNameButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-copy-name') as HTMLButtonElement | undefined;
      expect(copyNameButton).toBeTruthy();

      copyNameButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(legacyClipboardStore.execCommand).toHaveBeenCalledWith('copy');
      expect(notificationStore.success).toContainEqual({ title: 'Copied', message: '".env" copied to clipboard.' });
    } finally {
      dispose();
    }
  });

  it('keeps repository sync actions on local busy states and shows success toasts', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];

      const fetchButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-fetch') as HTMLButtonElement | undefined;
      expect(fetchButton).toBeTruthy();
      fetchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.fetchRepo).toHaveBeenCalledWith({ repoRootPath: '/workspace/repo' });
      expect(notificationStore.success).toContainEqual({ title: 'Fetched', message: 'Remote refs were updated.' });
      expect(gitWorkspaceRenderStore.snapshots.length).toBeGreaterThan(0);
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.fetchBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.repoInfoLoading && !item.repoSummaryLoading && !item.workspaceLoading && !item.branchesLoading && !item.listLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('refreshes the visible changes section in place without duplicating the selected workspace reload', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const initialWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }],
    };
    const refreshedWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' },
        { section: 'unstaged', changeType: 'modified', path: 'src/config.ts', displayPath: 'src/config.ts' },
      ],
    };

    let resolveRefreshWorkspacePage!: (value: typeof refreshedWorkspacePage) => void;
    const refreshWorkspacePagePromise = new Promise<typeof refreshedWorkspacePage>((resolve) => {
      resolveRefreshWorkspacePage = resolve;
    });

    mockRpc.git.listWorkspacePage.mockReset();
    mockRpc.git.listWorkspacePage
      .mockResolvedValueOnce(initialWorkspacePage)
      .mockImplementationOnce(() => refreshWorkspacePagePromise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(mockRpc.git.listWorkspacePage).toHaveBeenCalledTimes(1);

      gitWorkspaceRenderStore.snapshots = [];

      const refreshButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-refresh') as HTMLButtonElement | undefined;
      expect(refreshButton).toBeTruthy();
      refreshButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.listWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockRpc.git.listWorkspacePage).toHaveBeenNthCalledWith(2, {
        repoRootPath: '/workspace/repo',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.workspaceLoading)).toBe(false);

      resolveRefreshWorkspacePage(refreshedWorkspacePage);
      await flush();

      expect(mockRpc.git.listWorkspacePage).toHaveBeenCalledTimes(2);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.workspaceLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('revalidates the loaded changes view when returning from branches without blocking the shell', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    const initialWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' }],
    };
    const refreshedWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 2, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        { section: 'unstaged', changeType: 'modified', path: 'src/app.ts', displayPath: 'src/app.ts' },
        { section: 'unstaged', changeType: 'modified', path: 'src/config.ts', displayPath: 'src/config.ts' },
      ],
    };

    let resolveRefreshWorkspacePage!: (value: typeof refreshedWorkspacePage) => void;
    const refreshWorkspacePagePromise = new Promise<typeof refreshedWorkspacePage>((resolve) => {
      resolveRefreshWorkspacePage = resolve;
    });

    mockRpc.git.listWorkspacePage.mockReset();
    mockRpc.git.listWorkspacePage
      .mockResolvedValueOnce(initialWorkspacePage)
      .mockImplementationOnce(() => refreshWorkspacePagePromise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      expect(mockRpc.git.listWorkspacePage).toHaveBeenCalledTimes(1);
      gitWorkspaceRenderStore.snapshots = [];

      const toBranchesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-branches') as HTMLButtonElement | undefined;
      const toChangesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-changes') as HTMLButtonElement | undefined;
      expect(toBranchesButton).toBeTruthy();
      expect(toChangesButton).toBeTruthy();

      toBranchesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      toChangesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.listWorkspacePage).toHaveBeenCalledTimes(2);
      expect(mockRpc.git.listWorkspacePage).toHaveBeenLastCalledWith({
        repoRootPath: '/workspace/repo',
        section: 'changes',
        offset: 0,
        limit: 200,
      });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.subview === 'changes' && item.workspaceLoading)).toBe(false);

      resolveRefreshWorkspacePage(refreshedWorkspacePage);
      await flush();
    } finally {
      dispose();
    }
  });

  it('passes the active folder scope to discard and shows a no-op warning when nothing changed', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'changes' },
    };

    mockRpc.git.listWorkspacePage.mockReset();
    mockRpc.git.listWorkspacePage.mockResolvedValue({
      repoRootPath: '/workspace/repo',
      section: 'changes',
      directoryPath: 'desktop/diagnostics',
      breadcrumbs: [
        { label: 'repo', path: '' },
        { label: 'desktop', path: 'desktop' },
        { label: 'diagnostics', path: 'desktop/diagnostics' },
      ],
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 3, conflictedCount: 0 },
      scopeFileCount: 3,
      totalCount: 2,
      offset: 0,
      nextOffset: 2,
      hasMore: false,
      items: [
        {
          section: 'changes',
          entryKind: 'directory',
          path: 'desktop/diagnostics/logs',
          displayPath: 'desktop/diagnostics/logs',
          directoryPath: 'desktop/diagnostics/logs',
          descendantFileCount: 2,
          containsUntracked: true,
        },
        {
          section: 'untracked',
          entryKind: 'file',
          path: 'desktop/diagnostics/readme.md',
          displayPath: 'desktop/diagnostics/readme.md',
        },
      ],
    });
    mockRpc.git.discardWorkspace.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      result: {
        requestedCount: 0,
        matchedCount: 0,
        affectedCount: 0,
        remainingCount: 0,
        warnings: ['No current files matched the selected folder.'],
      },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const discardButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-discard-changes') as HTMLButtonElement | undefined;
      expect(discardButton).toBeTruthy();
      discardButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.discardWorkspace).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        section: 'changes',
        directoryPath: 'desktop/diagnostics',
        paths: undefined,
      });
      expect(notificationStore.warning).toContainEqual({
        title: 'Nothing discarded',
        message: 'No current files matched the selected folder.',
      });
    } finally {
      dispose();
    }
  });

  it('keeps checkout on local busy state and shows a toast without global reload flags', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];

      const checkoutButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-checkout') as HTMLButtonElement | undefined;
      expect(checkoutButton).toBeTruthy();
      checkoutButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.checkoutBranch).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
      });
      expect(notificationStore.success).toContainEqual({ title: 'Checked out', message: 'feature/demo is now active.' });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.checkoutBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.repoInfoLoading && !item.repoSummaryLoading && !item.workspaceLoading && !item.branchesLoading && !item.listLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('keeps detached switch on local busy state, redirects branch history to graph, and shows a toast', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];
      widgetStateStore.updateCalls = [];

      const detachButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-switch-detached') as HTMLButtonElement | undefined;
      expect(detachButton).toBeTruthy();
      detachButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.switchDetached).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        targetRef: 'fedcba9876543210',
      });
      expect(notificationStore.success).toContainEqual({ title: 'Detached HEAD', message: 'Detached HEAD at fedcba98.' });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.switchDetachedBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.repoInfoLoading && !item.repoSummaryLoading && !item.workspaceLoading && !item.branchesLoading && !item.listLoading)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.subview === 'history')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('keeps merge on local busy state and shows a success toast without global reload flags', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];

      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-merge-branch') as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      mergeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.previewMergeBranch).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
      });

      const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-confirm-merge-branch') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.mergeBranch).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
        planFingerprint: 'merge-plan-1',
      });
      expect(notificationStore.success).toContainEqual({ title: 'Fast-forwarded', message: 'main now includes feature/demo.' });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.mergeBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.repoInfoLoading && !item.repoSummaryLoading && !item.workspaceLoading && !item.branchesLoading && !item.listLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('focuses conflicted changes after a merge conflict', async () => {
    const cleanWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'changes',
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      totalCount: 0,
      offset: 0,
      nextOffset: 0,
      hasMore: false,
      items: [],
    };
    const conflictedWorkspacePage = {
      repoRootPath: '/workspace/repo',
      section: 'conflicted',
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 1 },
      totalCount: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
      items: [{ section: 'conflicted', changeType: 'conflicted', path: 'src/conflict.txt', displayPath: 'src/conflict.txt' }],
    };

    mockRpc.git.listWorkspacePage.mockReset();
    mockRpc.git.listWorkspacePage
      .mockResolvedValueOnce(cleanWorkspacePage)
      .mockResolvedValue(conflictedWorkspacePage);
    mockRpc.git.mergeBranch.mockResolvedValueOnce({
      repoRootPath: '/workspace/repo',
      headRef: 'main',
      headCommit: 'abc1234',
      result: 'conflicted',
      conflictSummary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 1 },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];

      const mergeButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-merge-branch') as HTMLButtonElement | undefined;
      expect(mergeButton).toBeTruthy();
      mergeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-confirm-merge-branch') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(notificationStore.warning).toContainEqual({ title: 'Merge has conflicts', message: 'Resolve the conflicted files in main.' });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.mergeBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.subview === 'changes' && item.selectedWorkspaceSection === 'conflicted')).toBe(true);
    } finally {
      dispose();
    }
  });

  it('keeps branch delete on local busy state and shows a toast without global reload flags', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      gitWorkspaceRenderStore.snapshots = [];

      const deleteButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-delete-branch') as HTMLButtonElement | undefined;
      expect(deleteButton).toBeTruthy();
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.previewDeleteBranch).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
      });

      const confirmButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-confirm-delete-branch') as HTMLButtonElement | undefined;
      expect(confirmButton).toBeTruthy();
      confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();

      expect(mockRpc.git.deleteBranch).toHaveBeenCalledWith({
        repoRootPath: '/workspace/repo',
        name: 'feature/demo',
        fullName: 'refs/heads/feature/demo',
        kind: 'local',
        deleteMode: 'safe',
        confirmBranchName: undefined,
        removeLinkedWorktree: false,
        discardLinkedWorktreeChanges: false,
        planFingerprint: 'plan-1',
      });
      expect(notificationStore.success).toContainEqual({ title: 'Deleted', message: 'feature/demo was removed.' });
      expect(gitWorkspaceRenderStore.snapshots.some((item) => item.deleteBusy)).toBe(true);
      expect(gitWorkspaceRenderStore.snapshots.every((item) => !item.repoInfoLoading && !item.repoSummaryLoading && !item.workspaceLoading && !item.branchesLoading && !item.listLoading)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('keeps the selected stale branch visible and surfaces a missing detail state after revalidation', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'branches' },
    };

    const initialBranches = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
        { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local' },
      ],
      remote: [],
    };
    const branchesAfterDeletion = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
      ],
      remote: [],
    };

    mockRpc.git.listBranches.mockReset();
    mockRpc.git.listBranches.mockResolvedValue(initialBranches);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();
      mockRpc.git.listBranches.mockReset();
      mockRpc.git.listBranches.mockResolvedValueOnce(branchesAfterDeletion);
      gitWorkspaceRenderStore.snapshots = [];

      const selectBranchButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-select-feature-branch') as HTMLButtonElement | undefined;
      expect(selectBranchButton).toBeTruthy();

      selectBranchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(mockRpc.git.listBranches).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.listBranches).toHaveBeenCalledWith({ repoRootPath: '/workspace/repo' });
      expect(host.textContent).toContain('selected-branch:refs/heads/feature/demo');
      expect(host.textContent).toContain('branch-detail:missing');
      expect(gitWorkspaceRenderStore.snapshots.some((item) => (
        item.subview === 'branches'
        && item.selectedBranchName === 'refs/heads/feature/demo'
        && item.branchDetailKind === 'missing'
      ))).toBe(true);
    } finally {
      dispose();
    }
  });

  it('revalidates the selected branch when returning to branches and surfaces a missing detail state', async () => {
    widgetStateStore.values['widget-1'] = {
      ...(widgetStateStore.values['widget-1'] ?? {}),
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'branches' },
    };

    const initialBranches = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
        { name: 'feature/demo', fullName: 'refs/heads/feature/demo', kind: 'local' },
      ],
      remote: [],
    };
    const branchesAfterDeletion = {
      repoRootPath: '/workspace/repo',
      currentRef: 'main',
      local: [
        { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true },
      ],
      remote: [],
    };

    mockRpc.git.listBranches.mockReset();
    mockRpc.git.listBranches.mockResolvedValue(initialBranches);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <LayoutProvider>
        <EnvContext.Provider value={createEnvContext()}>
          <RemoteFileBrowser widgetId="widget-1" />
        </EnvContext.Provider>
      </LayoutProvider>
    ), host);

    try {
      await flush();

      const selectBranchButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-select-feature-branch') as HTMLButtonElement | undefined;
      const toChangesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-changes') as HTMLButtonElement | undefined;
      const toBranchesButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent === 'mock-to-branches') as HTMLButtonElement | undefined;
      expect(selectBranchButton).toBeTruthy();
      expect(toChangesButton).toBeTruthy();
      expect(toBranchesButton).toBeTruthy();

      selectBranchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      mockRpc.git.listBranches.mockReset();
      mockRpc.git.listBranches.mockResolvedValueOnce(branchesAfterDeletion);
      gitWorkspaceRenderStore.snapshots = [];

      toChangesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      toBranchesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();

      expect(mockRpc.git.listBranches).toHaveBeenCalledTimes(1);
      expect(mockRpc.git.listBranches).toHaveBeenCalledWith({ repoRootPath: '/workspace/repo' });
      expect(host.textContent).toContain('selected-branch:refs/heads/feature/demo');
      expect(host.textContent).toContain('branch-detail:missing');
      expect(gitWorkspaceRenderStore.snapshots.some((item) => (
        item.subview === 'branches'
        && item.selectedBranchName === 'refs/heads/feature/demo'
        && item.branchDetailKind === 'missing'
      ))).toBe(true);
    } finally {
      dispose();
    }
  });
});
