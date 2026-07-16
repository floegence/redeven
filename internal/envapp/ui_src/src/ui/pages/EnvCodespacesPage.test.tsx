// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EnvCodespacesPage } from './EnvCodespacesPage';
import { buildFlowerTurnLauncherCopy } from '../../../../../flower_ui/src/flowerTurnLauncherCopy';
import { browserEditorSetupError } from '../services/browserEditorSetupError';

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const envContextMocks = vi.hoisted(() => ({
  env: Object.assign(
    () => ({ permissions: { can_write: true, can_execute: true } }),
    { state: 'ready', loading: false, error: null },
  ),
  openFlowerTurnLauncher: vi.fn(),
  openTerminalInDirectory: vi.fn(),
}));

const protocolMocks = vi.hoisted(() => ({
  client: vi.fn(),
}));

const rpcMocks = vi.hoisted(() => ({
  fs: {
    getPathContext: vi.fn(),
    list: vi.fn(),
  },
}));

const localApiMocks = vi.hoisted(() => ({
  fetchLocalApiJSON: vi.fn(),
}));

const desktopCodeWorkspaceMocks = vi.hoisted(() => ({
  prepareAvailable: vi.fn(() => true),
  prepareWorkspaceEngineWithDesktop: vi.fn<(args: any) => Promise<any>>(async () => ({ ok: true, prepared: true })),
  cancelWorkspaceEnginePreparation: vi.fn<(operationID: string, installMethod: string) => Promise<any>>(async () => ({ ok: true, cancelled: true })),
}));

const desktopSessionContextMocks = vi.hoisted(() => ({
  readSnapshot: vi.fn(() => null),
}));

const controlplaneMocks = vi.hoisted(() => ({
  getEnvPublicIDFromSession: vi.fn(),
  getLocalRuntime: vi.fn(),
  mintEnvEntryTicketForApp: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  AlertTriangle: (props: any) => <span class={props.class} data-testid="alert-triangle-icon" />,
  Check: (props: any) => <span class={props.class} data-testid="check-icon" />,
  ChevronDown: (props: any) => <span class={props.class} data-testid="chevron-down-icon" />,
  ChevronRight: (props: any) => <span class={props.class} data-testid="chevron-right-icon" />,
  Code: (props: any) => <span class={props.class} data-testid="code-icon" />,
  Cloud: (props: any) => <span class={props.class} data-testid="cloud-icon" />,
  ExternalLink: (props: any) => <span class={props.class} data-testid="external-link-icon" />,
  Maximize: (props: any) => <span class={props.class} data-testid="maximize-icon" />,
  Cpu: (props: any) => <span class={props.class} data-testid="cpu-icon" />,
  Play: (props: any) => <span class={props.class} data-testid="play-icon" />,
  RefreshIcon: (props: any) => <span class={props.class} data-testid="refresh-icon" />,
  Sparkles: (props: any) => <span class={props.class} data-testid="sparkles-icon" />,
  Stop: (props: any) => <span class={props.class} data-testid="stop-icon" />,
  Terminal: (props: any) => <span class={props.class} data-testid="terminal-icon" />,
  Trash: (props: any) => <span class={props.class} data-testid="trash-icon" />,
  X: (props: any) => <span class={props.class} data-testid="x-icon" />,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div class={props.class} data-testid={props['data-testid']}>{props.children}</div>,
  PanelContent: (props: any) => <div class={props.class}>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
  SkeletonCard: (props: any) => <div class={props.class} data-testid="skeleton-card" />,
  SnakeLoader: () => <div data-testid="snake-loader" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      aria-busy={props['aria-busy']}
      title={props.title}
    >
      {props.children}
    </button>
  ),
  Card: (props: any) => (
    <div class={props.class} onContextMenu={props.onContextMenu} data-testid="codespace-card">
      {props.children}
    </div>
  ),
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <div class={props.class} title={props.title}>{props.children}</div>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  Dialog: (props: any) => <Show when={props.open}><div>{props.children}{props.footer}</div></Show>,
  DirectoryInput: (props: any) => <input value={props.value} onInput={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).value)} />,
  Dropdown: (props: any) => (
    <div data-testid="dropdown">
      {props.trigger}
      <div>
        {(props.items ?? []).map((item: any) => (
          <button type="button" disabled={props.disabled || item.disabled} onClick={() => props.onSelect?.(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ),
  HighlightBlock: (props: any) => (
    <div
      class={['highlight-block', props.class].filter(Boolean).join(' ')}
      data-testid={props['data-testid']}
      data-highlight-variant={props.variant}
    >
      <div>{props.title}</div>
      {props.children}
    </div>
  ),
  Input: (props: any) => <input value={props.value} onInput={props.onInput} />,
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Tooltip: (props: any) => <>{props.children}</>,
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={layerRef}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: protocolMocks.client,
  }),
}));

vi.mock('./EnvContext', () => ({
  useEnvContext: () => ({
    env: envContextMocks.env,
    openFlowerTurnLauncher: envContextMocks.openFlowerTurnLauncher,
    openTerminalInDirectory: envContextMocks.openTerminalInDirectory,
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

vi.mock('../services/controlplaneApi', () => ({
  getEnvPublicIDFromSession: controlplaneMocks.getEnvPublicIDFromSession,
  getLocalRuntime: controlplaneMocks.getLocalRuntime,
  mintEnvEntryTicketForApp: controlplaneMocks.mintEnvEntryTicketForApp,
}));

vi.mock('../services/floeproxyContract', () => ({
  FLOE_APP_CODE: 'com.floegence.redeven.code',
}));

vi.mock('../services/localApi', () => ({
  fetchLocalApiJSON: localApiMocks.fetchLocalApiJSON,
}));

vi.mock('../services/desktopCodeWorkspaceBridge', () => ({
  desktopCodeWorkspacePrepareAvailable: desktopCodeWorkspaceMocks.prepareAvailable,
}));

vi.mock('../services/browserEditorSetup', () => ({
  browserEditorRuntimeOperationAbsenceConfirmed: () => true,
  cancelBrowserEditorSetup: desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation,
  createBrowserEditorSetupOrchestration: (options: any) => {
    const controller = new AbortController();
    let operation = { operationID: options.operationID, installMethod: options.installMethod };
    let operationObserved = false;
    let localProgress: any = null;
    let runtimeStatus: any = null;
    let cancelled = false;
    const snapshot = () => ({
      requestedOperation: { operationID: options.operationID, installMethod: options.installMethod },
      operation,
      operationObserved,
      phase: 'submitting',
      localProgress,
      runtimeStatus,
      result: null,
    });
    return {
      snapshot,
      isCancellationRequested: () => cancelled,
      run: async () => {
        const result = await desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop({
          status: options.status,
          operationID: options.operationID,
          installMethod: options.installMethod,
          signal: controller.signal,
          onProgress: (progress: any) => {
            localProgress = progress;
            options.onSnapshot?.(snapshot());
          },
          onOperationObserved: (identity: any) => {
            operation = identity;
            operationObserved = true;
            localProgress = null;
            options.onSnapshot?.(snapshot());
          },
          onRuntimeStatus: (status: any) => {
            runtimeStatus = status;
            options.onSnapshot?.(snapshot());
          },
        });
        if (result.state) return result;
        if (!result.ok || !result.prepared) throw new Error(result.message);
        return { state: 'succeeded', ...result };
      },
      cancel: async () => {
        cancelled = true;
        controller.abort();
        await desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation(operation.operationID, operation.installMethod);
      },
    };
  },
  defaultBrowserEditorInstallMethod: () => (desktopCodeWorkspaceMocks.prepareAvailable() ? 'desktop_transfer' : 'remote_download'),
  prepareBrowserEditorSetup: desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop,
}));

vi.mock('../services/desktopSessionContext', () => ({
  readDesktopSessionContextSnapshot: desktopSessionContextMocks.readSnapshot,
}));

vi.mock('../services/localAccessAuth', () => ({
  appendLocalAccessResumeQuery: (value: string) => value,
}));

vi.mock('../services/sandboxOrigins', () => ({
  trustedLauncherOriginFromSandboxLocation: () => 'https://codespace.test',
}));

vi.mock('../services/sandboxWindowRegistry', () => ({
  registerSandboxWindow: vi.fn(),
}));

vi.mock('../../../../../flower_ui/src/filePicker/directoryPickerTree', () => ({
  replacePickerChildren: vi.fn((prev: any) => prev),
  sortPickerFolderItems: vi.fn((items: any) => items),
  toPickerFolderItem: vi.fn(),
  toPickerTreeAbsolutePath: vi.fn(),
}));

async function flushPage(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitForHostText(host: HTMLElement, text: string, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (host.textContent?.includes(text)) return;
    await flushPage();
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

function makeRuntimeStatus(overrides: any = {}): any {
  const sharedRoot = '/Users/test/.redeven/shared/code-server/darwin-arm64';
  const managedPrefix = '/Users/test/.redeven/local-environment/apps/code/runtime/managed';
  return {
    active_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.active_runtime ?? {}),
    },
    managed_runtime: {
      detection_state: 'ready',
      present: true,
      source: 'managed',
      binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
      version: '4.109.1',
      ...(overrides.managed_runtime ?? {}),
    },
    managed_prefix: overrides.managed_prefix ?? managedPrefix,
    shared_runtime_root: overrides.shared_runtime_root ?? sharedRoot,
    managed_runtime_version: overrides.managed_runtime_version ?? '4.109.1',
    managed_runtime_source: overrides.managed_runtime_source ?? 'managed',
    installed_versions: overrides.installed_versions ?? [
      {
        version: '4.109.1',
        binary_path: `${sharedRoot}/versions/4.109.1/bin/code-server`,
        selected_by_local_environment: true,
        removable: false,
        detection_state: 'ready',
      },
    ],
    operation: {
      state: 'idle',
      log_tail: [],
      ...(overrides.operation ?? {}),
    },
    updated_at_unix_ms: 1,
    ...overrides,
  };
}

describe('EnvCodespacesPage', () => {
  let host: HTMLDivElement;
  let runtimeStatusResponse: any;

  beforeEach(() => {
    notificationMocks.success.mockReset();
    notificationMocks.error.mockReset();
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_write: true, can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );
    envContextMocks.openFlowerTurnLauncher.mockReset();
    envContextMocks.openTerminalInDirectory.mockReset();
    protocolMocks.client.mockReset();
    protocolMocks.client.mockReturnValue(null);
    rpcMocks.fs.getPathContext.mockReset();
    rpcMocks.fs.list.mockReset();
    controlplaneMocks.getEnvPublicIDFromSession.mockReset();
    controlplaneMocks.getEnvPublicIDFromSession.mockReturnValue('env_local');
    controlplaneMocks.getLocalRuntime.mockReset();
    controlplaneMocks.getLocalRuntime.mockResolvedValue(null);
    controlplaneMocks.mintEnvEntryTicketForApp.mockReset();
    controlplaneMocks.mintEnvEntryTicketForApp.mockResolvedValue('entry-ticket-123');
    runtimeStatusResponse = makeRuntimeStatus();
    desktopCodeWorkspaceMocks.prepareAvailable.mockReset();
    desktopCodeWorkspaceMocks.prepareAvailable.mockReturnValue(true);
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockReset();
    desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation.mockReset();
    desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation.mockResolvedValue({ ok: true, cancelled: true });
    desktopSessionContextMocks.readSnapshot.mockReset();
    desktopSessionContextMocks.readSnapshot.mockReturnValue(null);
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockImplementation(async () => {
      runtimeStatusResponse = makeRuntimeStatus({
        ...runtimeStatusResponse,
        active_runtime: {
          detection_state: 'ready',
          present: true,
          source: 'managed',
          binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
          version: '4.109.1',
        },
        managed_runtime: {
          detection_state: 'ready',
          present: true,
          source: 'managed',
          binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
          version: '4.109.1',
        },
        installed_versions: [
          {
            version: '4.109.1',
            binary_path: '/Users/test/.redeven/shared/code-server/darwin-arm64/versions/4.109.1/bin/code-server',
            selected_by_local_environment: true,
            removable: false,
            detection_state: 'ready',
          },
        ],
        managed_runtime_version: '4.109.1',
        managed_runtime_source: 'managed',
        operation: { state: 'succeeded', action: 'prepare_workspace_engine', log_tail: ['Browser Editor is ready.'] },
      });
      return { ok: true, prepared: true, status: runtimeStatusResponse };
    });
    localApiMocks.fetchLocalApiJSON.mockReset();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/code-runtime/cancel') {
        runtimeStatusResponse = makeRuntimeStatus({
          ...runtimeStatusResponse,
          operation: {
            action: 'prepare_workspace_engine',
            state: 'cancelled',
            stage: '',
            log_tail: runtimeStatusResponse.operation?.log_tail ?? [],
          },
        });
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: true,
              pid: 4242,
            },
          ],
        };
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return {
          code_space_id: 'space-1',
          name: 'Demo Space',
          description: 'Workspace demo',
          workspace_path: '/workspace/demo',
          code_port: 13337,
          created_at_unix_ms: 1,
          updated_at_unix_ms: 1,
          last_opened_at_unix_ms: 1,
          running: true,
          pid: 4242,
        };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    delete window.redevenDesktopShell;
    host.remove();
    document.body.innerHTML = '';
  });

  it('delays the quiet card skeleton for the initial codespaces request', async () => {
    vi.useFakeTimers();
    const spacesRequest = deferred<{ spaces: any[] }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') return runtimeStatusResponse;
      if (url === '/_redeven_proxy/api/spaces') return spacesRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });
    const dispose = render(() => <EnvCodespacesPage />, host);

    try {
      await flushMicrotasks();
      const listRegion = host.querySelector('[data-testid="codespaces-list-region"]');
      expect(listRegion?.querySelector('.redeven-loading-curtain')).toBeNull();
      expect(host.querySelector('[data-testid="codespaces-initial-loading"]')).toBeNull();

      await vi.advanceTimersByTimeAsync(149);
      expect(host.querySelector('[data-testid="codespaces-initial-loading"]')).toBeNull();

      await vi.advanceTimersByTimeAsync(1);
      expect(host.querySelector('[data-testid="codespaces-initial-loading"]')).not.toBeNull();
      const skeletonCards = Array.from(host.querySelectorAll('[data-testid="skeleton-card"]'));
      expect(skeletonCards).toHaveLength(3);
      expect(skeletonCards[0]?.className).not.toContain('hidden');
      expect(skeletonCards[1]?.className).toContain('hidden');
      expect(skeletonCards[1]?.className).toContain('md:block');
      expect(skeletonCards[2]?.className).toContain('lg:block');

      spacesRequest.resolve({ spaces: [] });
      await flushMicrotasks();
      expect(host.querySelector('[data-testid="codespaces-initial-loading"]')).toBeNull();
      expect(host.textContent).toContain('No codespaces yet');
    } finally {
      dispose();
      vi.useRealTimers();
    }
  });

  it('keeps the current codespace card mounted while refreshing', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const currentCard = host.querySelector('[data-testid="codespace-card"]');
    const spacesRequest = deferred<{ spaces: any[] }>();
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') return runtimeStatusResponse;
      if (url === '/_redeven_proxy/api/spaces') return spacesRequest.promise;
      throw new Error(`Unexpected local API call: ${url}`);
    });

    const refreshButton = host.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement | null;
    expect(refreshButton).toBeTruthy();
    refreshButton?.click();
    await flushMicrotasks();

    expect(host.querySelector('[data-testid="codespace-card"]')).toBe(currentCard);
    expect(host.querySelector('[data-testid="codespaces-list-region"]')?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton?.querySelector('[data-testid="refresh-icon"]')?.className).toContain('animate-spin');
    expect(host.querySelector('[data-testid="codespaces-initial-loading"]')).toBeNull();
    expect(host.querySelector('[data-testid="codespaces-list-region"] .redeven-loading-curtain')).toBeNull();

    spacesRequest.resolve({
      spaces: [
        {
          code_space_id: 'space-2',
          name: 'Updated Space',
          description: 'Updated workspace',
          workspace_path: '/workspace/updated',
          code_port: 13338,
          created_at_unix_ms: 2,
          updated_at_unix_ms: 2,
          last_opened_at_unix_ms: 2,
          running: false,
          pid: 0,
        },
      ],
    });
    await flushPage();

    expect(host.textContent).toContain('Updated Space');
    expect(host.querySelector('[data-testid="codespaces-list-region"]')?.getAttribute('aria-busy')).toBeNull();
    expect(refreshButton?.getAttribute('aria-busy')).toBeNull();
    expect(refreshButton?.querySelector('[data-testid="refresh-icon"]')?.className).not.toContain('animate-spin');
  });

  it('opens Ask Flower from a codespace card context menu with directory context copy', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []);
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual(['Ask Flower', 'Open in Terminal']);

    const askFlowerButton = menuButtons.find((button) => button.textContent?.includes('Ask Flower'));
    expect(askFlowerButton).toBeTruthy();

    askFlowerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPage();

    expect(envContextMocks.openFlowerTurnLauncher).toHaveBeenCalledTimes(1);
    const [intent, anchor] = envContextMocks.openFlowerTurnLauncher.mock.calls[0];
    expect(anchor).toEqual({ x: 40, y: 56 });
    expect(intent).toMatchObject({
      source_surface: 'file_browser',
      suggested_working_dir: '/workspace/demo',
      context_items: [
        {
          kind: 'file_path',
          path: '/workspace/demo',
          is_directory: true,
        },
      ],
      pending_attachments: [],
      notes: [],
    });
    expect(buildFlowerTurnLauncherCopy(intent).question).toBe('What would you like to explore inside it?');
  });

  it('shows Browser Editor setup guidance when the runtime is missing', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: { state: 'idle', log_tail: [] },
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const wizard = host.querySelector('[data-testid="browser-editor-setup-activity"]') as HTMLDivElement | null;
    expect(wizard).toBeTruthy();
    expect(wizard?.textContent).toContain('Browser Editor');
    expect(wizard?.textContent).toContain('Not ready');
    expect(wizard?.textContent).toContain('Set up Browser Editor');
    expect(wizard?.textContent).toContain('sends it through the current connection to this environment');
    expect(wizard?.textContent).toContain('Desktop network → current connection → environment');
    expect(wizard?.getAttribute('data-layout')).toBe('wide');
    expect(wizard?.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('shows unsupported Linux platforms as non-retryable diagnostics while keeping the empty state', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      platform: {
        os: 'linux',
        arch: 'amd64',
        libc: 'musl',
        platform_id: 'linux-amd64-musl',
        supported: false,
        unsupported_code: 'unsupported_libc',
        message: 'This Linux distribution is not supported by the managed code workspace engine.',
      },
      operation: { state: 'idle', log_tail: [] },
    });
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') return runtimeStatusResponse;
      if (url === '/_redeven_proxy/api/spaces') return { spaces: [] };
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const wizard = host.querySelector('[data-testid="browser-editor-setup-activity"]') as HTMLDivElement | null;
    expect(wizard).toBeTruthy();
    expect(wizard?.getAttribute('data-presentation')).toBe('result');
    expect(wizard?.textContent).toContain('This environment is not supported');
    expect(wizard?.textContent).toContain('linux / amd64 / musl');
    expect(wizard?.textContent).toContain('Linux amd64/arm64 · glibc');
    expect(wizard?.textContent).not.toContain('Retry setup');
    expect(wizard?.textContent).not.toContain('Set up Browser Editor');
    expect(host.textContent).toContain('No codespaces yet');

    const detailsButton = Array.from(wizard?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Technical details'));
    expect(detailsButton?.getAttribute('aria-expanded')).toBe('false');
    detailsButton?.click();
    await flushPage();
    expect(detailsButton?.getAttribute('aria-expanded')).toBe('true');
    expect(wizard?.textContent).toContain('Environment platform');
    expect(wizard?.textContent).toContain('unsupported_libc');
  });

  it('keeps the initial Browser Editor runtime check in the header while showing codespaces', async () => {
    let resolveRuntimeStatus!: (value: any) => void;

    localApiMocks.fetchLocalApiJSON.mockImplementation((url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return new Promise((resolve) => {
          resolveRuntimeStatus = resolve as (value: any) => void;
        });
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return Promise.resolve({
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: true,
              pid: 4242,
            },
          ],
        });
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    expect(host.querySelector('[data-testid="browser-editor-setup-activity"]')).toBeNull();
    expect(host.querySelector('[data-testid="codespace-card"]')).toBeTruthy();
    const inlineStatus = host.querySelector('[data-testid="browser-editor-readiness-inline-status"]') as HTMLButtonElement | null;
    expect(inlineStatus).toBeTruthy();
    expect(inlineStatus?.textContent).toContain('Checking');
    expect(inlineStatus?.title).toContain('Checking Browser Editor readiness');

    resolveRuntimeStatus(makeRuntimeStatus());
    await flushPage();

    expect(host.querySelector('[data-testid="browser-editor-setup-activity"]')).toBeNull();
    expect(host.querySelector('[data-testid="browser-editor-readiness-inline-status"]')).toBeNull();
  });

  it('shows Retry setup when the Browser Editor setup operation failed', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: {
        state: 'failed',
        action: 'prepare_workspace_engine',
        last_error: 'Download failed.',
        log_tail: ['Download failed.'],
      },
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const wizard = host.querySelector('[data-testid="browser-editor-setup-activity"]') as HTMLDivElement | null;
    expect(wizard).toBeTruthy();
    expect(wizard?.textContent).toContain('Browser Editor');
    expect(wizard?.textContent).toContain('Retry setup');
    expect(wizard?.textContent).toContain('Download failed.');
  });

  it('shows and cancels an existing Runtime setup using its real identity', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      operation: {
        action: 'prepare_workspace_engine',
        operation_id: 'browser-editor:existing',
        install_method: 'remote_download',
        state: 'running',
        stage: 'downloading',
        transfer: {
          received_bytes: 1024,
          expected_bytes: 4096,
        },
        log_tail: [],
      },
      updated_at_unix_ms: 2,
    });
    desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation.mockImplementationOnce(async () => {
      runtimeStatusResponse = makeRuntimeStatus({
        operation: {
          action: 'prepare_workspace_engine',
          operation_id: 'browser-editor:existing',
          install_method: 'remote_download',
          state: 'cancelled',
          stage: 'downloading',
          log_tail: [],
        },
        updated_at_unix_ms: 3,
      });
      return runtimeStatusResponse;
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const wizard = host.querySelector('[data-testid="browser-editor-setup-activity"]') as HTMLDivElement | null;
    expect(wizard).toBeTruthy();
    expect(wizard?.textContent).toContain('This environment is downloading the Browser Editor');
    expect(wizard?.textContent).toContain('1 KiB of 4 KiB');
    const cancelButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cancel');
    cancelButton?.click();

    await vi.waitFor(() => {
      expect(desktopCodeWorkspaceMocks.cancelWorkspaceEnginePreparation).toHaveBeenCalledWith(
        'browser-editor:existing',
        'remote_download',
      );
    });
  });

  it('prepares the workspace through Desktop instead of calling the old local API install path', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: { state: 'idle', log_tail: [] },
    });

    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return {
          code_space_id: 'space-1',
          name: 'Demo Space',
          description: 'Workspace demo',
          workspace_path: '/workspace/demo',
          code_port: 13337,
          created_at_unix_ms: 1,
          updated_at_unix_ms: 2,
          last_opened_at_unix_ms: 1,
          running: true,
          pid: 4242,
        };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    let resolvePrepare!: (value: { ok: true; prepared: true; status: any }) => void;
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePrepare = resolve;
    }));

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const startButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start');
    expect(startButton).toBeTruthy();

    startButton?.click();
    await waitForHostText(host, 'Demo Space');
    expect(localApiMocks.fetchLocalApiJSON.mock.calls.filter(([url]) => url === '/_redeven_proxy/api/code-runtime/status').length).toBeGreaterThanOrEqual(2);
    expect(desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop).not.toHaveBeenCalled();

    const setupButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Set up Browser Editor');
    expect(setupButton).toBeTruthy();
    setupButton?.click();
    await vi.waitFor(() => {
      expect(desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop).toHaveBeenCalledTimes(1);
    });

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop).toHaveBeenCalledWith(expect.objectContaining({
      status: expect.anything(),
      installMethod: 'desktop_transfer',
      signal: expect.any(AbortSignal),
      operationID: expect.stringMatching(/^browser-editor:/),
      onProgress: expect.any(Function),
    }));
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith('/_redeven_proxy/api/code-runtime/install', expect.anything());
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith('/_redeven_proxy/api/spaces/space-1/start', expect.anything());

    runtimeStatusResponse = makeRuntimeStatus();
    resolvePrepare({ ok: true, prepared: true, status: runtimeStatusResponse });
    await vi.waitFor(() => {
      expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith(
        '/_redeven_proxy/api/spaces/space-1/start',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    windowOpenSpy.mockRestore();
  });

  it('keeps Desktop prepare failures visible in the Browser Editor setup panel', async () => {
    runtimeStatusResponse = makeRuntimeStatus({
      active_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'none',
        binary_path: '',
      },
      managed_runtime: {
        detection_state: 'missing',
        present: false,
        source: 'managed',
        binary_path: '',
      },
      installed_versions: [],
      managed_runtime_version: '',
      managed_runtime_source: 'none',
      operation: { state: 'idle', log_tail: [] },
    });
    desktopCodeWorkspaceMocks.prepareWorkspaceEngineWithDesktop.mockRejectedValueOnce(
      browserEditorSetupError(
        'desktop_release_lookup',
        'Redeven Browser Editor catalog lookup failed with HTTP 503.',
      ),
    );
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const startButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start');
    expect(startButton).toBeTruthy();

    startButton?.click();
    await waitForHostText(host, 'Set up Browser Editor');

    const setupButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Set up Browser Editor');
    expect(setupButton).toBeTruthy();
    setupButton?.click();
    await waitForHostText(host, 'Redeven Browser Editor catalog lookup failed with HTTP 503.');

    const wizard = host.querySelector('[data-testid="browser-editor-setup-activity"]') as HTMLDivElement | null;
    expect(wizard).toBeTruthy();
    expect(wizard?.textContent).toContain('Setup failed');
    expect(wizard?.textContent).toContain('Couldn’t check the latest Browser Editor.');
    expect(wizard?.textContent).toContain('Retry setup');
    expect(wizard?.textContent).not.toContain('Continue to start codespace');
    expect(notificationMocks.error).toHaveBeenCalledWith('Browser Editor setup failed', 'Redeven Browser Editor catalog lookup failed with HTTP 503.');
    expect(localApiMocks.fetchLocalApiJSON).not.toHaveBeenCalledWith('/_redeven_proxy/api/spaces/space-1/start', expect.anything());
  });

  it('shows a shimmer busy state while starting a stopped codespace', async () => {
    let resolveStart!: (value: any) => void;
    localApiMocks.fetchLocalApiJSON.mockImplementation((url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return Promise.resolve(runtimeStatusResponse);
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return Promise.resolve({
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        });
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const startButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start') as HTMLButtonElement | undefined;
    expect(startButton).toBeTruthy();

    startButton?.click();
    await flushPage();

    const busyStartButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Starting...')) as HTMLButtonElement | undefined;
    expect(busyStartButton).toBeTruthy();
    expect(busyStartButton?.getAttribute('aria-busy')).toBe('true');
    expect(busyStartButton?.querySelector('.redeven-loading-shimmer-overlay')).toBeTruthy();

    resolveStart({
      code_space_id: 'space-1',
      name: 'Demo Space',
      description: 'Workspace demo',
      workspace_path: '/workspace/demo',
      code_port: 13337,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      last_opened_at_unix_ms: 1,
      running: true,
      pid: 4242,
    });
    await flushPage();

    expect(host.querySelector('.redeven-loading-shimmer-overlay')).toBeNull();
  });

  it('opens a local-runtime codespace in a desktop window from the primary action', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });
    const openCodespaceWindowBridge = vi.fn().mockResolvedValue({ ok: true });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      openCodespaceWindow: openCodespaceWindowBridge,
      openExternalURL: openExternalURLBridge,
    };

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open in Desktop');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(openExternalURLBridge).not.toHaveBeenCalled();
    expect(openCodespaceWindowBridge).toHaveBeenCalledTimes(2);
    expect(openCodespaceWindowBridge.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      mode: 'loading',
      code_space_id: 'space-1',
      title: 'Opening Codespace',
    }));
    expect(openCodespaceWindowBridge.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      mode: 'navigate',
      code_space_id: 'space-1',
    }));
    expect(String(openCodespaceWindowBridge.mock.calls[1]?.[0]?.url ?? '')).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
    expect(controlplaneMocks.mintEnvEntryTicketForApp).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  it('keeps system browser available from the desktop split menu', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });
    const openCodespaceWindowBridge = vi.fn().mockResolvedValue({ ok: true });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openCodespaceWindow: openCodespaceWindowBridge,
      openExternalURL: openExternalURLBridge,
    };

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const browserButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open in Browser');
    expect(browserButton).toBeTruthy();

    browserButton?.click();
    await flushPage();

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(openCodespaceWindowBridge).not.toHaveBeenCalled();
    expect(openExternalURLBridge).toHaveBeenCalledTimes(1);
    expect(openExternalURLBridge.mock.calls[0]?.[0]).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');

    windowOpenSpy.mockRestore();
  });

  it('auto-starts a stopped codespace before opening the selected browser target', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return {
          code_space_id: 'space-1',
          name: 'Demo Space',
          description: 'Workspace demo',
          workspace_path: '/workspace/demo',
          code_port: 13337,
          created_at_unix_ms: 1,
          updated_at_unix_ms: 1,
          last_opened_at_unix_ms: 1,
          running: true,
          pid: 4242,
        };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    const openCodespaceWindowBridge = vi.fn().mockResolvedValue({ ok: true });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openCodespaceWindow: openCodespaceWindowBridge,
      openExternalURL: openExternalURLBridge,
    };

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const browserButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open in Browser');
    expect(browserButton).toBeTruthy();

    browserButton?.click();
    await flushPage();

    expect(localApiMocks.fetchLocalApiJSON).toHaveBeenCalledWith('/_redeven_proxy/api/spaces/space-1/start', { method: 'POST' });
    expect(openCodespaceWindowBridge).not.toHaveBeenCalled();
    expect(openExternalURLBridge).toHaveBeenCalledTimes(1);
    expect(openExternalURLBridge.mock.calls[0]?.[0]).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
  });

  it('opens a loading desktop window before auto-starting a stopped codespace', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });
    let resolveStart!: (value: any) => void;
    localApiMocks.fetchLocalApiJSON.mockImplementation((url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return Promise.resolve(runtimeStatusResponse);
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return Promise.resolve({
          spaces: [
            {
              code_space_id: 'space-1',
              name: 'Demo Space',
              description: 'Workspace demo',
              workspace_path: '/workspace/demo',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        });
      }
      if (url === '/_redeven_proxy/api/spaces/space-1/start') {
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });
    const openCodespaceWindowBridge = vi.fn().mockResolvedValue({ ok: true });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openCodespaceWindow: openCodespaceWindowBridge,
      openExternalURL: openExternalURLBridge,
    };

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const desktopButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open in Desktop');
    expect(desktopButton).toBeTruthy();

    desktopButton?.click();
    await flushPage();

    expect(openExternalURLBridge).not.toHaveBeenCalled();
    expect(openCodespaceWindowBridge).toHaveBeenCalledTimes(1);
    expect(openCodespaceWindowBridge.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      mode: 'loading',
      code_space_id: 'space-1',
      title: 'Opening Codespace',
    }));
    const busyOpenButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Opening...')) as HTMLButtonElement | undefined;
    expect(busyOpenButton).toBeTruthy();
    expect(busyOpenButton?.getAttribute('aria-busy')).toBe('true');
    expect(busyOpenButton?.querySelector('.redeven-loading-shimmer-overlay')).toBeTruthy();

    resolveStart({
      code_space_id: 'space-1',
      name: 'Demo Space',
      description: 'Workspace demo',
      workspace_path: '/workspace/demo',
      code_port: 13337,
      created_at_unix_ms: 1,
      updated_at_unix_ms: 1,
      last_opened_at_unix_ms: 1,
      running: true,
      pid: 4242,
    });
    await flushPage();

    expect(openCodespaceWindowBridge).toHaveBeenCalledTimes(2);
    expect(openCodespaceWindowBridge.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      mode: 'navigate',
      code_space_id: 'space-1',
    }));
    expect(String(openCodespaceWindowBridge.mock.calls[1]?.[0]?.url ?? '')).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
  });

  it('opens a trusted-launcher codespace in a desktop window from the primary action', async () => {
    const openCodespaceWindowBridge = vi.fn().mockResolvedValue({ ok: true });
    const openExternalURLBridge = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openConnectionCenter: vi.fn().mockResolvedValue(undefined),
      openCodespaceWindow: openCodespaceWindowBridge,
      openExternalURL: openExternalURLBridge,
    };

    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => null);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open in Desktop');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).not.toHaveBeenCalled();
    expect(controlplaneMocks.mintEnvEntryTicketForApp).toHaveBeenCalledWith({
      envId: 'env_local',
      floeApp: 'com.floegence.redeven.code',
      codeSpaceId: 'space-1',
    });
    expect(openExternalURLBridge).not.toHaveBeenCalled();
    expect(openCodespaceWindowBridge).toHaveBeenCalledTimes(2);
    expect(openCodespaceWindowBridge.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      mode: 'loading',
      code_space_id: 'space-1',
      title: 'Opening Codespace',
    }));
    const targetURL = String(openCodespaceWindowBridge.mock.calls[1]?.[0]?.url ?? '');
    expect(openCodespaceWindowBridge.mock.calls[1]?.[0]?.mode).toBe('navigate');
    expect(openCodespaceWindowBridge.mock.calls[1]?.[0]?.code_space_id).toBe('space-1');
    expect(targetURL).toContain('https://codespace.test/_redeven_boot/?env=env_local#redeven=');

    windowOpenSpy.mockRestore();
  });

  it('falls back to the browser popup path when the desktop shell bridge is unavailable', async () => {
    controlplaneMocks.getLocalRuntime.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
    });

    const assign = vi.fn();
    const close = vi.fn();
    const popupWindow = {
      location: { assign },
      close,
    } as unknown as Window;
    const windowOpenSpy = vi.spyOn(window, 'open');
    windowOpenSpy.mockImplementation(() => popupWindow);

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Open');
    expect(openButton).toBeTruthy();

    openButton?.click();
    await flushPage();

    expect(windowOpenSpy).toHaveBeenCalledWith('about:blank', 'redeven_codespace_space-1');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]?.[0] ?? '')).toContain('/cs/space-1/?folder=%2Fworkspace%2Fdemo');
    expect(close).not.toHaveBeenCalled();

    windowOpenSpy.mockRestore();
  });

  it('opens Terminal from a codespace card context menu with the absolute directory and preferred name', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const openButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Open in Terminal'));
    expect(openButton).toBeTruthy();

    openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPage();

    expect(envContextMocks.openTerminalInDirectory).toHaveBeenCalledTimes(1);
    expect(envContextMocks.openTerminalInDirectory).toHaveBeenCalledWith('/workspace/demo', {
      preferredName: 'Demo Space',
      workbenchAnchor: { clientX: 40, clientY: 56 },
    });
  });

  it('keeps the codespace context menu inside the local surface host', async () => {
    render(() => (
      <div data-floe-dialog-surface-host="true">
        <EnvCodespacesPage />
      </div>
    ), host);
    await flushPage();

    const surfaceHost = host.querySelector('[data-floe-dialog-surface-host="true"]') as HTMLDivElement | null;
    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(surfaceHost).toBeTruthy();
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    const menu = surfaceHost?.querySelector('[role="menu"]') as HTMLDivElement | null;
    const askFlowerButton = Array.from(menu?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Ask Flower')
    ) as HTMLButtonElement | undefined;
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');
    expect(askFlowerButton).toBeTruthy();
  });

  it('hides Open in Terminal when write permission is unavailable', async () => {
    envContextMocks.env = Object.assign(
      () => ({ permissions: { can_write: false, can_execute: true } }),
      { state: 'ready', loading: false, error: null },
    );

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();

    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Open in Terminal'))).toBe(false);
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(true);
  });

  it('closes the codespace context menu on Escape', async () => {
    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;
    expect(card).toBeTruthy();

    card?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPage();
    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPage();

    expect(Array.from(host.querySelectorAll('button')).some((button) => button.textContent?.includes('Ask Flower'))).toBe(false);
  });

  it('uses semantic panel and card surface classes for the neutral codespace shell', async () => {
    localApiMocks.fetchLocalApiJSON.mockImplementation(async (url: string) => {
      if (url === '/_redeven_proxy/api/code-runtime/status') {
        return runtimeStatusResponse;
      }
      if (url === '/_redeven_proxy/api/spaces') {
        return {
          spaces: [
            {
              code_space_id: 'space-2',
              name: 'Stopped Space',
              description: 'Stopped workspace',
              workspace_path: '/workspace/stopped',
              code_port: 13337,
              created_at_unix_ms: 1,
              updated_at_unix_ms: 1,
              last_opened_at_unix_ms: 1,
              running: false,
              pid: 0,
            },
          ],
        };
      }
      throw new Error(`Unexpected local API call: ${url}`);
    });

    render(() => <EnvCodespacesPage />, host);
    await flushPage();

    const panel = host.querySelector('[data-testid="codespaces-panel"]') as HTMLDivElement | null;
    const card = host.querySelector('[data-testid="codespace-card"]') as HTMLDivElement | null;

    expect(panel?.className).toContain('redeven-surface-panel--strong');
    expect(card?.className).toContain('redeven-surface-panel--interactive');
    expect(card?.className).toContain('opacity-75');
  });
});
