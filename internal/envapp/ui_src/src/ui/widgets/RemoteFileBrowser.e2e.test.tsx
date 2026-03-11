// @vitest-environment jsdom

import { LayoutProvider } from '@floegence/floe-webapp-core';
import { createEffect, createResource } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvContext, type EnvContextValue } from '../pages/EnvContext';
import { RemoteFileBrowser } from './RemoteFileBrowser';

const widgetStateStore = vi.hoisted(() => ({
  values: {} as Record<string, Record<string, unknown>>,
  updateCalls: [] as Array<{ widgetId: string; key: string; value: unknown }>,
}));

const notificationStore = vi.hoisted(() => ({
  success: [] as Array<{ title: string; message?: string }>,
  error: [] as Array<{ title: string; message?: string }>,
  warning: [] as Array<{ title: string; message?: string }>,
  info: [] as Array<{ title: string; message?: string }>,
}));

const gitWorkspaceRenderStore = vi.hoisted(() => ({
  snapshots: [] as Array<{
    repoInfoLoading: boolean;
    repoSummaryLoading: boolean;
    workspaceLoading: boolean;
    branchesLoading: boolean;
    listLoading: boolean;
    fetchBusy: boolean;
    pullBusy: boolean;
    pushBusy: boolean;
    checkoutBusy: boolean;
  }>,
}));

const mockRpc = vi.hoisted(() => ({
  fs: {
    list: vi.fn(),
    getHome: vi.fn(),
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
        load: (_key: string, fallback: unknown) => fallback,
        debouncedSave: () => {},
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

vi.mock('./FileBrowserWorkspace', () => ({
  FileBrowserWorkspace: (props: { mode: string; currentPath: string }) => (
    <div data-testid="files-workspace">files:{props.mode}:{props.currentPath}</div>
  ),
}));

vi.mock('./GitWorkspace', () => ({
  GitWorkspace: (props: {
    mode: string;
    currentPath: string;
    subview: string;
    repoInfoLoading?: boolean;
    repoSummaryLoading?: boolean;
    workspaceLoading?: boolean;
    branchesLoading?: boolean;
    listLoading?: boolean;
    fetchBusy?: boolean;
    pullBusy?: boolean;
    pushBusy?: boolean;
    checkoutBusy?: boolean;
    onFetch?: () => void;
    onPull?: () => void;
    onPush?: () => void;
    onCheckoutBranch?: (branch: { name?: string; fullName?: string; kind?: string }) => void;
  }) => {
    createEffect(() => {
      gitWorkspaceRenderStore.snapshots.push({
        repoInfoLoading: Boolean(props.repoInfoLoading),
        repoSummaryLoading: Boolean(props.repoSummaryLoading),
        workspaceLoading: Boolean(props.workspaceLoading),
        branchesLoading: Boolean(props.branchesLoading),
        listLoading: Boolean(props.listLoading),
        fetchBusy: Boolean(props.fetchBusy),
        pullBusy: Boolean(props.pullBusy),
        pushBusy: Boolean(props.pushBusy),
        checkoutBusy: Boolean(props.checkoutBusy),
      });
    });

    return (
      <div data-testid="git-workspace">
        <div>git:{props.mode}:{props.subview}:{props.currentPath}</div>
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
  const [envResource] = createResource(async () => null);
  return {
    env_id: () => 'env-1',
    env: envResource,
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
      lastPathByEnv: { 'env-1': '/workspace/repo/src' },
      pageModeByEnv: { 'env-1': 'git' },
      gitSubviewByEnv: { 'env-1': 'history' },
    },
  };
  widgetStateStore.updateCalls = [];
  notificationStore.success = [];
  notificationStore.error = [];
  notificationStore.warning = [];
  notificationStore.info = [];
  gitWorkspaceRenderStore.snapshots = [];

  mockRpc.fs.list.mockResolvedValue({ entries: [] });
  mockRpc.fs.getHome.mockResolvedValue({ path: '/Users/tester' });
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
      expect(host.querySelector('[data-testid="git-workspace"]')?.textContent).toContain('git:git:history:/workspace/repo/src');
      expect(host.querySelector('[data-testid="files-workspace"]')).toBeNull();
      expect(mockRpc.fs.list).toHaveBeenCalledWith({ path: '/workspace/repo/src', showHidden: false });
      expect(mockRpc.git.resolveRepo).toHaveBeenCalledWith({ path: '/workspace/repo/src' });
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
});
