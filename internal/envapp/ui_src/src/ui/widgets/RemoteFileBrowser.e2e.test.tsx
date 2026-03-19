// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import type { ContextMenuCallbacks, ContextMenuItem, FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createEffect, createResource, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
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
    selectedWorkspaceSection?: string;
    repoInfoLoading: boolean;
    repoSummaryLoading: boolean;
    workspaceLoading: boolean;
    branchesLoading: boolean;
    listLoading: boolean;
    fetchBusy: boolean;
    pullBusy: boolean;
    pushBusy: boolean;
    checkoutBusy: boolean;
    mergeBusy: boolean;
    deleteBusy: boolean;
  }>,
}));

const workspaceLifecycleStore = vi.hoisted(() => ({
  filesMounts: 0,
  filesUnmounts: 0,
  gitMounts: 0,
  gitUnmounts: 0,
}));

const filePreviewStore = vi.hoisted(() => ({
  openPreview: vi.fn(),
  closePreview: vi.fn(),
}));

const mockRpc = vi.hoisted(() => ({
  fs: {
    list: vi.fn(),
    getPathContext: vi.fn(),
  },
  git: {
    resolveRepo: vi.fn(),
    getRepoSummary: vi.fn(),
    listWorkspaceChanges: vi.fn(),
    listBranches: vi.fn(),
    getBranchCompare: vi.fn(),
    listCommits: vi.fn(),
    fetchRepo: vi.fn(),
    pullRepo: vi.fn(),
    pushRepo: vi.fn(),
    checkoutBranch: vi.fn(),
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

vi.mock('./FileBrowserWorkspace', () => ({
  FileBrowserWorkspace: (props: {
    mode: string;
    currentPath: string;
    width?: number;
    resetKey?: number;
    captureTypingFromPage?: boolean;
    toolbarEndActions?: JSX.Element;
    onModeChange?: (mode: string) => void;
    onResize?: (delta: number) => void;
    contextMenuCallbacks?: ContextMenuCallbacks;
    overrideContextMenuItems?: ContextMenuItem[];
  }) => {
    const [localCount, setLocalCount] = createSignal(0);
    const copyNameTarget: FileItem = {
      id: '/workspace/repo/src/.env',
      name: '.env',
      type: 'file',
      path: '/workspace/repo/src/.env',
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
        <div>{props.toolbarEndActions}</div>
        <button type="button" onClick={() => setLocalCount((count) => count + 1)}>mock-files-bump</button>
        <button type="button" onClick={() => props.onModeChange?.('git')}>mock-to-git</button>
        <button type="button" onClick={() => props.onResize?.(24)}>mock-resize-sidebar</button>
        {props.overrideContextMenuItems?.some((item) => item.type === 'copy-name') ? (
          <button
            type="button"
            onClick={() => props.contextMenuCallbacks?.onCopyName?.([copyNameTarget])}
          >
            mock-copy-name
          </button>
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
    width?: number;
    selectedWorkspaceSection?: string;
    onModeChange?: (mode: string) => void;
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
    mergeBusy?: boolean;
    deleteBusy?: boolean;
    mergeReviewOpen?: boolean;
    mergePreview?: { planFingerprint?: string } | null;
    mergeDialogState?: string;
    deleteReviewOpen?: boolean;
    deletePreview?: { planFingerprint?: string } | null;
    deleteDialogState?: string;
    onFetch?: () => void;
    onPull?: () => void;
    onPush?: () => void;
    onCheckoutBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onMergeBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onDeleteBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
    onConfirmMergeBranch?: (
      branch: { name?: string; fullName?: string; kind?: string },
      options: { planFingerprint?: string },
    ) => void;
    onConfirmDeleteBranch?: (
      branch: { name?: string; fullName?: string; kind?: string },
      options: { removeLinkedWorktree: boolean; discardLinkedWorktreeChanges: boolean; planFingerprint?: string },
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
        selectedWorkspaceSection: props.selectedWorkspaceSection,
        repoInfoLoading: Boolean(props.repoInfoLoading),
        repoSummaryLoading: Boolean(props.repoSummaryLoading),
        workspaceLoading: Boolean(props.workspaceLoading),
        branchesLoading: Boolean(props.branchesLoading),
        listLoading: Boolean(props.listLoading),
        fetchBusy: Boolean(props.fetchBusy),
        pullBusy: Boolean(props.pullBusy),
        pushBusy: Boolean(props.pushBusy),
        checkoutBusy: Boolean(props.checkoutBusy),
        mergeBusy: Boolean(props.mergeBusy),
        deleteBusy: Boolean(props.deleteBusy),
      });
    });

    return (
      <div data-testid="git-workspace">
        <div>git:{props.mode}:{props.subview}:{props.currentPath}:{props.width ?? 0}</div>
        <button type="button" onClick={() => props.onModeChange?.('files')}>mock-to-files</button>
        <button type="button" onClick={() => props.onResize?.(24)}>mock-resize-sidebar</button>
        <button type="button" onClick={() => props.onFetch?.()}>mock-fetch</button>
        <button type="button" onClick={() => props.onPull?.()}>mock-pull</button>
        <button type="button" onClick={() => props.onPush?.()}>mock-push</button>
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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createEnvContext(): EnvContextValue {
  return createEnvContextWithIdAccessor(() => 'env-1');
}

function createEnvContextWithIdAccessor(envId: () => string): EnvContextValue {
  const [envResource] = createResource(async () => null);
  return {
    env_id: envId,
    env: envResource,
    localRuntime: () => null,
    connect: async () => {},
    connecting: () => false,
    connectError: () => null,
    goTab: () => {},
    filesSidebarOpen: () => false,
    setFilesSidebarOpen: () => {},
    toggleFilesSidebar: () => {},
    settingsSeq: () => 0,
    bumpSettingsSeq: () => {},
    openSettings: () => {},
    settingsFocusSeq: () => 0,
    settingsFocusSection: () => null,
    askFlowerIntentSeq: () => 0,
    askFlowerIntent: () => null,
    injectAskFlowerIntent: () => {},
    openAskFlowerComposer: () => {},
    aiThreadFocusSeq: () => 0,
    aiThreadFocusId: () => null,
    focusAIThread: () => {},
  };
}

beforeEach(() => {
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
  workspaceLifecycleStore.filesMounts = 0;
  workspaceLifecycleStore.filesUnmounts = 0;
  workspaceLifecycleStore.gitMounts = 0;
  workspaceLifecycleStore.gitUnmounts = 0;

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
  mockRpc.git.listWorkspaceChanges.mockResolvedValue({
    repoRootPath: '/workspace/repo',
    summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
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
    const cleanWorkspace = {
      repoRootPath: '/workspace/repo',
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 },
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    };
    const conflictedWorkspace = {
      repoRootPath: '/workspace/repo',
      summary: { stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 1 },
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [{ section: 'conflicted', changeType: 'conflicted', path: 'src/conflict.txt', displayPath: 'src/conflict.txt' }],
    };

    mockRpc.git.listWorkspaceChanges.mockReset();
    mockRpc.git.listWorkspaceChanges
      .mockResolvedValueOnce(cleanWorkspace)
      .mockResolvedValue(conflictedWorkspace);
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
});
