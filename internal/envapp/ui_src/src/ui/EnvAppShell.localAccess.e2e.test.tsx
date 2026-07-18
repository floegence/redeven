// @vitest-environment jsdom

import { For, Show, createContext, createEffect, createSignal, onCleanup, onMount, useContext, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY } from './security/networkExposureWarningPreference';

const getLocalRuntimeMock = vi.fn();
const getLocalAccessStatusMock = vi.fn();
const unlockLocalAccessMock = vi.fn();
const getEnvAppAccessStatusMock = vi.fn();
const unlockEnvAppAccessMock = vi.fn();
const getEnvironmentMock = vi.fn();
const mintLocalDirectConnectArtifactMock = vi.fn();
const mintEnvProxyEntryTicketMock = vi.fn();
const mintEnvEntryTicketForAppMock = vi.fn();
const connectArtifactEntryMock = vi.fn();
const getEnvPublicIDFromSessionMock = vi.fn(() => '');
const refreshLocalRuntimeMock = vi.fn();
const reloadCurrentPageMock = vi.fn();
const desktopAppReadyMock = vi.fn();
const commandState = vi.hoisted(() => ({
  open: vi.fn(),
  commands: [] as Array<Record<string, unknown>>,
}));
const notesOverlayState = vi.hoisted(() => ({
  lastProps: null as null | {
    open: boolean;
    onClose: () => void;
    viewportHosts?: readonly HTMLElement[];
    toggleKeybind?: string;
  },
}));
const settingsPageState = vi.hoisted(() => ({
  focusSeq: 0,
  focusSection: null as string | null,
}));
const registeredComponentsState = vi.hoisted(() => ({
  components: [] as Array<{ id: string; component: () => JSX.Element }>,
}));
const activitySurfaceLifecycleState = vi.hoisted(() => ({
  fileMounts: 0,
  fileCleanups: 0,
  codexProviderMounts: 0,
  codexProviderCleanups: 0,
  codexPageMounts: 0,
  codexPageCleanups: 0,
  codexSidebarMounts: 0,
  codexSidebarCleanups: 0,
}));
const pluginApiMocks = vi.hoisted(() => ({
  executePluginLifecycleCommand: vi.fn(async (_command: any) => ({})),
  loadPluginInventoryProjection: vi.fn(),
}));
const terminalFeaturePreloadMocks = vi.hoisted(() => ({
  preloadTerminalFeatureResources: vi.fn(async () => undefined),
  scheduleTerminalFeaturePreload: vi.fn(() => () => undefined),
}));

const connectMock = vi.fn(async (_config: Record<string, unknown>) => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-1' };
  protocolError = null;
});
const reconnectMock = vi.fn(async (_config?: Record<string, unknown>) => {
  protocolStatus = 'connected';
  protocolClient = { id: 'client-2' };
  protocolError = null;
});
const disconnectMock = vi.fn(() => {
  protocolStatus = 'disconnected';
  protocolClient = null;
});
const accessStatusMock = vi.fn(async () => ({ passwordRequired: true, unlocked: resumeCalls.length > 0 }));
const accessResumeMock = vi.fn(async ({ token }: { token: string }) => {
  resumeCalls.push(token);
});

let protocolStatus: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let protocolClient: unknown = null;
let protocolError: unknown = null;
let resumeCalls: string[] = [];
let layoutIsMobile = false;
let sidebarActiveTabValue = 'terminal';
let sidebarVisibilityMotionValue: 'animated' | 'instant' = 'animated';
let setSidebarActiveTabSignal: ((value: string) => void) | null = null;
const setSidebarActiveTabMock = vi.fn((tab: string, opts?: {
  openSidebar?: boolean;
  visibilityMotion?: 'animated' | 'instant';
}) => {
  sidebarActiveTabValue = tab;
  setSidebarActiveTabSignal?.(tab);
  sidebarVisibilityMotionValue = opts?.visibilityMotion ?? 'animated';
});
const setSidebarCollapsedMock = vi.fn();
const EnvContextMock = createContext({} as any);

function MockDisplayModeSurface(props: Readonly<{ testId: string }>) {
  return (
    <div>
      <div data-testid={props.testId} />
    </div>
  );
}

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  createUIFirstSelection: (options: any) => {
    const [visual, setVisual] = createSignal(options.committed());
    const [pending, setPending] = createSignal(false);
    let requestID = 0;
    createEffect(() => {
      const committed = options.committed();
      if (!pending()) setVisual(committed);
    });
    return {
      visual,
      committed: options.committed,
      pending,
      preview: setVisual,
      resetPreview: () => setVisual(options.committed()),
      request: (value: unknown, metadata?: unknown) => {
        const currentRequest = ++requestID;
        setVisual(value);
        setPending(true);
        setTimeout(() => {
          if (currentRequest !== requestID) return;
          options.commit(value, metadata);
          setTimeout(() => {
            if (currentRequest !== requestID) return;
            setPending(false);
            setVisual(options.committed());
          }, 0);
        }, 0);
      },
      commitNow: (value: unknown, metadata?: unknown) => options.commit(value, metadata),
      cancel: () => {
        requestID += 1;
        setPending(false);
        setVisual(options.committed());
      },
    };
  },
  deferAfterPaint: (fn: () => void) => setTimeout(fn, 0),
  useCommand: () => ({
    open: commandState.open,
    getKeybindDisplay: (keybind: string) => (keybind === 'mod+.' ? '⌘.' : keybind),
    registerAll: (commands: Array<Record<string, unknown>>) => {
      commandState.commands = commands;
      return () => {
        if (commandState.commands === commands) {
          commandState.commands = [];
        }
      };
    },
  }),
  useLayout: () => {
    const [activeTab, setActiveTab] = createSignal(sidebarActiveTabValue);
    setSidebarActiveTabSignal = setActiveTab;
    return {
      isMobile: () => layoutIsMobile,
      sidebarActiveTab: activeTab,
      sidebarVisibilityMotion: () => sidebarVisibilityMotionValue,
      setSidebarActiveTab: setSidebarActiveTabMock,
      setSidebarCollapsed: setSidebarCollapsedMock,
    };
  },
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  useTheme: () => ({
    resolvedTheme: () => 'dark',
    toggleTheme: vi.fn(),
    themePresets: () => [],
    themePreset: () => undefined,
    setThemePreset: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/app', () => ({
  ActivityAppsMain: (props: any) => {
    const activeId = () => (typeof props.activeId === 'function' ? props.activeId() : props.activeId);
    const [mountedComponents, setMountedComponents] = createSignal<Array<{ id: string; component: () => JSX.Element }>>([]);

    createEffect(() => {
      const nextActiveId = activeId();
      const match = registeredComponentsState.components.find((component) => component.id === nextActiveId);
      if (!match) return;
      setMountedComponents((current) => (
        current.some((component) => component.id === match.id)
          ? current
          : [...current, match]
      ));
    });

    return (
      <div data-testid="activity-main" data-active-id={activeId()}>
        <For each={mountedComponents()}>
          {(match) => {
            const Component = match.component;
            return (
              <div
                data-testid={`activity-view-${match.id}`}
                style={{ display: activeId() === match.id ? 'block' : 'none' }}
              >
                <Component />
              </div>
            );
          }}
        </For>
      </div>
    );
  },
  FloeRegistryRuntime: (props: any) => {
    registeredComponentsState.components = Array.isArray(props.components) ? props.components : [];
    return <>{props.children}</>;
  },
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  BottomBarItem: (props: any) => <button type="button" class={props.class} onClick={props.onClick}>{props.children}</button>,
  DisplayModePageShell: (props: any) => (
    <div data-testid="display-mode-page-shell" data-title={props.title ?? ''}>
      {props.logo}
      {props.title ? <div>{props.title}</div> : null}
      {props.actions}
      {props.children}
    </div>
  ),
  DisplayModeSwitcher: (props: any) => (
    <div data-testid="display-mode-switcher">
      {['activity', 'workbench'].map((mode) => (
        <button
          type="button"
          aria-selected={props.mode === mode}
          onClick={() => props.onChange?.(mode)}
        >
          {mode === 'activity' ? 'Activity' : 'Workbench'}
        </button>
      ))}
    </div>
  ),
  KeepAliveStack: (props: any) => {
    const [mountedIDs, setMountedIDs] = createSignal<string[]>([props.activeId]);
    createEffect(() => {
      const activeID = props.activeId;
      setMountedIDs((current) => current.includes(activeID) ? current : [...current, activeID]);
    });
    return (
      <div class={props.class} data-testid="display-mode-keep-alive" data-active-id={props.activeId}>
        <For each={props.views.filter((view: any) => mountedIDs().includes(view.id))}>
          {(view: any) => (
            <div data-testid={`display-mode-view-${view.id}`} style={{ display: view.id === props.activeId ? 'block' : 'none' }}>
              {view.render()}
            </div>
          )}
        </For>
      </div>
    );
  },
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
  sanitizeDisplayMode: (value: unknown, fallback = 'activity') => (
    value === 'activity' || value === 'workbench' ? value : fallback
  ),
  Shell: (props: any) => {
    const env = useContext(EnvContextMock as any) as {
      activeSurface?: () => string;
      openSettings?: (section?: string, options?: { origin?: { kind: 'flower'; returnSurfaceId: 'ai' } }) => void;
      returnFromSettingsOrigin?: () => void;
      settingsOrigin?: () => { kind?: string } | null;
      settingsFocusSeq?: () => number;
      settingsFocusSection?: () => string | null;
    } | undefined;
    createEffect(() => {
      settingsPageState.focusSeq = env?.settingsFocusSeq?.() ?? 0;
      settingsPageState.focusSection = env?.settingsFocusSection?.() ?? null;
    });

    const activateItem = (item: any) => {
      if (item.onClick) {
        item.onClick();
        return;
      }
      const openSidebar = item.collapseBehavior === 'toggle';
      const visibilityMotion = props.resolveSidebarVisibilityMotion?.({
        currentActiveId: sidebarActiveTabValue,
        nextActiveId: item.id,
        openSidebar,
        source: 'activity-bar',
        isMobile: layoutIsMobile,
      });
      props.onActivitySelectionEvent?.({
        phase: 'requested',
        value: item.id,
        metadata: { source: 'activity-bar', opts: { openSidebar } },
        transactionId: 1,
        startedAt: 0,
        timestamp: 0,
        elapsedMs: 0,
      });
      setSidebarActiveTabMock(item.id, { openSidebar, visibilityMotion });
    };
    return (
      <div class={props.class} data-floe-shell="">
        {props.logo}
        {props.topBarActions}
        <div>
          {Array.isArray(props.activityItems)
            ? props.activityItems.map((item: any) => (
                <button type="button" data-activity-id={item.id} onClick={() => activateItem(item)}>
                  {item.label}
                </button>
              ))
            : null}
        </div>
        <div>
          {Array.isArray(props.activityBottomItems)
            ? props.activityBottomItems.map((item: any) => (
                <button type="button" data-activity-id={item.id} onClick={() => activateItem(item)}>
                  {item.label}
                </button>
              ))
            : null}
        </div>
        {props.bottomBarItems}
        <div
          data-testid="mock-env-context-state"
          data-active-surface={env?.activeSurface?.() ?? ''}
          data-settings-origin={env?.settingsOrigin?.()?.kind ?? ''}
        >
          <button
            type="button"
            data-testid="mock-context-open-flower-settings"
            onClick={() => env?.openSettings?.('ai', { origin: { kind: 'flower', returnSurfaceId: 'ai' } })}
          >
            Open Flower Settings
          </button>
          <button
            type="button"
            data-testid="mock-context-return-from-settings"
            onClick={() => env?.returnFromSettingsOrigin?.()}
          >
            Return From Settings
          </button>
        </div>
        <div data-testid="shell-sidebar" data-floe-shell-slot="sidebar" class={props.slotClassNames?.sidebar}>
          {props.sidebarContent?.(env?.activeSurface?.() ?? sidebarActiveTabValue)}
        </div>
        <div data-floe-shell-slot="content-area">
          <main data-floe-shell-slot="main">{props.children}</main>
        </div>
      </div>
    );
  },
  StatusIndicator: (props: any) => <div>{props.label ?? props.status}</div>,
  TopBarIconButton: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      aria-label={props.label}
      data-tooltip={props.tooltip === false ? undefined : String(props.tooltip ?? props.label)}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled || props.loading}
      aria-label={props['aria-label']}
      data-testid={props['data-testid']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <section role="dialog" aria-label={props.title} class={props.class}>
        <h2>{props.title}</h2>
        <Show when={props.description}><p>{props.description}</p></Show>
        {props.children}
        {props.footer}
      </section>
    </Show>
  ),
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Dropdown: (props: any) => (
    <div>
      {props.trigger}
      {props.items?.map((item: any) => (
        item.separator
          ? <div data-dropdown-separator="" />
          : (
            <button
              type="button"
              data-dropdown-item-id={item.id}
              disabled={item.disabled}
              onClick={() => props.onSelect?.(item.id)}
            >
              {item.label}
            </button>
          )
      ))}
    </div>
  ),
  SegmentedControl: (props: any) => (
    <div data-testid="segmented-control">
      {props.options?.map((option: any) => (
        <button
          type="button"
          data-segment-value={option.value}
          disabled={option.disabled}
          onClick={() => props.onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: (props: any) => <>{props.children}</>,
}));

vi.mock('./TopBarBrandButton', () => ({
  TopBarBrandButton: (props: any) => (
    <button
      type="button"
      class={props.class}
      onClick={props.onClick}
      aria-label={props.label}
      data-tooltip={props.tooltip === false ? undefined : String(props.tooltip ?? props.label)}
    >
      {props.children}
    </button>
  ),
}));

vi.mock('./notes/NotesOverlay', () => ({
  NotesOverlay: (props: any) => {
    notesOverlayState.lastProps = props;
    return <div data-testid="notes-overlay" data-open={String(props.open)} />;
  },
}));

vi.mock('./plugins/PluginSurfaceFrame', () => ({
  PluginSurfaceFrame: (props: any) => (
    <section
      data-plugin-surface-host
      data-plugin-id={props.surface?.plugin_id ?? ''}
      data-surface-id={props.surface?.surface_id ?? ''}
    >
      <button type="button" aria-label="Close Plugin Surface" onClick={() => props.onClose?.()}>Close</button>
      <iframe data-plugin-surface-iframe />
    </section>
  ),
}));
vi.mock('./plugins/PluginPanel', () => ({
  PluginPanel: (props: any) => (
    <Show when={props.open}>
      <div>
        {props.model?.tiles?.map((tile: any) => {
          const tileID = tile.kind === 'open_center' ? tile.id : tile.item?.pluginID;
          return (
            <button
              type="button"
              data-plugin-panel-tile={tileID}
              onClick={() => {
                if (tile.kind === 'open_center') {
                  props.onOpenCenter?.();
                } else if (tile.action === 'open_surface' && tile.item?.defaultLaunchTarget) {
                  props.onOpenPluginSurface?.(tile.item.defaultLaunchTarget);
                } else {
                  props.onOpenPluginDetails?.(tile.item?.pluginID);
                }
                props.onClose?.();
              }}
            >
              {tile.kind === 'open_center' ? tile.label : tile.item?.displayName}
            </button>
          );
        })}
      </div>
    </Show>
  ),
}));
vi.mock('./plugins/PluginCenterView', () => ({
  PluginCenterView: (props: any) => (
    <section data-plugin-center-view data-plugin-center-shell>
      <Show when={props.selectedPluginID}>
        <div data-plugin-center-item={props.selectedPluginID}>Selected plugin</div>
        <div data-plugin-center-details>Disabled</div>
      </Show>
      <button type="button" aria-label="Close Plugin Center" onClick={() => props.onClose?.()}>Close</button>
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Activity: Icon,
    AlertCircle: Icon,
    AlertTriangle: Icon,
    ArrowRightLeft: Icon,
    Check: Icon,
    ChevronDown: Icon,
    Code: Icon,
    Copy: Icon,
    Download: Icon,
    Files: Icon,
    Globe: Icon,
    Grid3x3: Icon,
    LayoutDashboard: Icon,
    Loader2: Icon,
    MoreVertical: Icon,
    Moon: Icon,
    Refresh: Icon,
    RefreshIcon: Icon,
    Search: Icon,
    Settings: Icon,
    Shield: Icon,
    Sun: Icon,
    Terminal: Icon,
    CheckCircle: Icon,
    Plus: Icon,
    Trash: Icon,
    X: Icon,
  };
});

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    status: () => protocolStatus,
    client: () => protocolClient,
    connect: connectMock,
    reconnect: reconnectMock,
    disconnect: disconnectMock,
    error: () => protocolError,
  }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    access: {
      status: accessStatusMock,
      resume: accessResumeMock,
    },
    sys: {
      ping: vi.fn(async () => undefined),
    },
    ai: {
      subscribeThread: vi.fn(async () => undefined),
      sendUserTurn: vi.fn(async () => undefined),
    },
  }),
}));

vi.mock('./services/controlplaneApi', () => ({
  connectArtifactEntry: connectArtifactEntryMock,
  getEnvPublicIDFromSession: getEnvPublicIDFromSessionMock,
  getLocalAccessStatus: getLocalAccessStatusMock,
  getLocalRuntime: getLocalRuntimeMock,
  getEnvironment: getEnvironmentMock,
  mintEnvProxyEntryTicket: mintEnvProxyEntryTicketMock,
  mintLocalDirectConnectArtifact: mintLocalDirectConnectArtifactMock,
  mintEnvEntryTicketForApp: mintEnvEntryTicketForAppMock,
  refreshLocalRuntime: refreshLocalRuntimeMock,
  unlockLocalAccess: unlockLocalAccessMock,
}));
vi.mock('./services/terminalFeaturePreload', () => terminalFeaturePreloadMocks);

vi.mock('./accessResume', () => ({
  consumeAccessResumeTokenFromWindow: () => '',
}));

vi.mock('./icons/FlowerIcon', () => ({ FlowerIcon: () => <span /> }));
vi.mock('./icons/CodexIcon', () => ({ CodexIcon: () => <span />, CodexNavigationIcon: () => <span /> }));
vi.mock('./workbench/EnvWorkbenchPage', () => ({ EnvWorkbenchPage: () => <MockDisplayModeSurface testId="workbench-page" /> }));
vi.mock('./pages/EnvTerminalPage', () => ({ EnvTerminalPage: () => <div>activity main</div> }));
vi.mock('./pages/EnvMonitorPage', () => ({ EnvMonitorPage: () => <div>activity main</div> }));
vi.mock('./pages/EnvFileBrowserPage', () => ({
  EnvFileBrowserPage: () => {
    const [loading, setLoading] = createSignal(true);
    const [path, setPath] = createSignal('/workspace');
    const [filter, setFilter] = createSignal('');
    const [expanded, setExpanded] = createSignal(false);
    const [viewMode, setViewMode] = createSignal<'list' | 'grid'>('list');
    const [selection, setSelection] = createSignal('');

    onMount(() => {
      activitySurfaceLifecycleState.fileMounts += 1;
      queueMicrotask(() => setLoading(false));
    });
    onCleanup(() => {
      activitySurfaceLifecycleState.fileCleanups += 1;
    });

    return (
      <div
        data-testid="mock-file-browser"
        data-expanded={String(expanded())}
        data-view-mode={viewMode()}
        data-selection={selection()}
      >
        <Show when={loading()}>
          <div data-testid="mock-file-loading">Loading files</div>
        </Show>
        <input
          data-testid="mock-file-path"
          value={path()}
          onInput={(event) => setPath(event.currentTarget.value)}
        />
        <input
          data-testid="mock-file-filter"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <button type="button" data-testid="mock-file-expand" onClick={() => setExpanded(true)}>Expand</button>
        <button type="button" data-testid="mock-file-grid" onClick={() => setViewMode('grid')}>Grid</button>
        <button type="button" data-testid="mock-file-select" onClick={() => setSelection('/workspace/src/main.ts')}>Select</button>
        <div data-testid="mock-file-scroll" style={{ height: '40px', overflow: 'auto' }}>
          <div style={{ height: '400px' }}>Scrollable files</div>
        </div>
      </div>
    );
  },
}));
vi.mock('./pages/EnvCodespacesPage', () => ({ EnvCodespacesPage: () => <div>activity main</div> }));
vi.mock('./pages/EnvPortForwardsPage', () => ({ EnvPortForwardsPage: () => <div>activity main</div> }));
vi.mock('./pages/EnvAIPage', () => ({
  EnvAIPage: () => {
    const env = useContext(EnvContextMock as any) as {
      openSettings?: (section?: string, options?: { origin?: { kind: 'flower'; returnSurfaceId: 'ai' } }) => void;
    } | undefined;
    return (
      <div data-testid="ai-page">
        <button
          type="button"
          data-testid="mock-open-flower-settings"
          onClick={() => env?.openSettings?.('ai', { origin: { kind: 'flower', returnSurfaceId: 'ai' } })}
        >
          Open Flower Settings
        </button>
      </div>
    );
  },
}));
vi.mock('./codex/CodexPage', () => ({
  CodexPage: () => {
    onMount(() => {
      activitySurfaceLifecycleState.codexPageMounts += 1;
    });
    onCleanup(() => {
      activitySurfaceLifecycleState.codexPageCleanups += 1;
    });
    return <div data-testid="mock-codex-page" />;
  },
}));
vi.mock('./codex/CodexProvider', () => ({
  CodexProvider: (props: any) => {
    onMount(() => {
      activitySurfaceLifecycleState.codexProviderMounts += 1;
    });
    onCleanup(() => {
      activitySurfaceLifecycleState.codexProviderCleanups += 1;
    });
    return <>{props.children}</>;
  },
}));
vi.mock('./codex/CodexSidebar', () => ({
  CodexSidebar: () => {
    onMount(() => {
      activitySurfaceLifecycleState.codexSidebarMounts += 1;
    });
    onCleanup(() => {
      activitySurfaceLifecycleState.codexSidebarCleanups += 1;
    });
    return <div data-testid="mock-codex-sidebar" />;
  },
}));
vi.mock('./pages/EnvSettingsPage', async () => {
  const { EnvContext } = await import('./pages/EnvContext');
  return {
    EnvSettingsPage: () => {
      const env = useContext(EnvContext);
      settingsPageState.focusSeq = env?.settingsFocusSeq() ?? 0;
      settingsPageState.focusSection = env?.settingsFocusSection() ?? null;
      const origin = env?.settingsOrigin?.() ?? null;
      return (
        <div
          data-testid="settings-page"
          data-focus-seq={String(settingsPageState.focusSeq)}
          data-focus-section={settingsPageState.focusSection ?? ''}
          data-origin={origin?.kind ?? ''}
        >
          {origin?.kind === 'flower' ? (
            <button type="button" data-testid="mock-back-to-flower" onClick={() => env?.returnFromSettingsOrigin?.()}>
              Back to Flower
            </button>
          ) : null}
        </div>
      );
    },
  };
});
vi.mock('./pages/aiPermissions', () => ({ hasRWXPermissions: () => true }));
vi.mock('./widgets/AuditLogDialog', () => ({ AuditLogDialog: () => <div /> }));
vi.mock('./widgets/FlowerTurnLauncherWindow', () => ({ FlowerTurnLauncherWindow: () => <div /> }));
vi.mock('./widgets/FileBrowserSurfaceHost', () => ({ FileBrowserSurfaceHost: () => <div /> }));
vi.mock('./widgets/FilePreviewHost', () => ({ FilePreviewHost: () => <div /> }));
vi.mock('./utils/askFlowerPath', () => ({
  basenameFromAbsolutePath: (value: string) => {
    const normalized = String(value ?? '').trim().replace(/\/+$/, '');
    if (!normalized || normalized === '/') return 'File';
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'File';
  },
  normalizeAbsolutePath: (value: string) => {
    const raw = String(value ?? '').trim().replace(/\\+/g, '/');
    if (!raw.startsWith('/')) return '';
    if (raw === '/') return '/';
    return raw.replace(/\/+$/, '') || '/';
  },
  resolveSuggestedWorkingDirAbsolute: () => '',
}));
vi.mock('./utils/windowNavigation', () => ({ reloadCurrentPage: reloadCurrentPageMock }));
vi.mock('./services/localApi', () => ({
  fetchLocalApiJSON: vi.fn(),
  localApiRequestCredentials: () => 'same-origin',
  getEnvAppAccessStatus: getEnvAppAccessStatusMock,
  uploadLocalApiFile: vi.fn(),
  unlockEnvAppAccess: unlockEnvAppAccessMock,
}));
vi.mock('./plugins/pluginApi', () => ({
  executePluginLifecycleCommand: pluginApiMocks.executePluginLifecycleCommand,
  loadPluginInventoryProjection: pluginApiMocks.loadPluginInventoryProjection,
}));
vi.mock('./services/sandboxWindowRegistry', () => ({ getSandboxWindowInfo: () => null }));
vi.mock('./pages/EnvContext', () => ({
  EnvContext: EnvContextMock,
  useEnvContext: () => useContext(EnvContextMock as any),
}));
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean, attempts = 12): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }
    await flushAsync();
  }
  if (!predicate()) {
    throw new Error('Condition did not become true in time.');
  }
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

function findButtonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((node) => node.textContent?.trim().includes(text)) as HTMLButtonElement | undefined;
}

function expectPluginCenterMountedInActivityMain(host: ParentNode): void {
  const view = host.querySelector('[data-plugin-center-view]');
  const main = host.querySelector('[data-floe-shell-slot="main"]');
  expect(view).toBeTruthy();
  expect(main?.contains(view)).toBe(true);

  let node = view?.parentElement ?? null;
  while (node && node !== document.body) {
    const className = node.getAttribute('class') ?? '';
    expect(className.split(/\s+/u)).not.toEqual(expect.arrayContaining(['fixed', 'z-40', 'shadow-2xl']));
    node = node.parentElement;
  }
}

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(String(key)) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(String(key));
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  } as Storage;
}

type DesktopSessionSource = 'provider_environment' | 'ssh_environment' | 'external_local_ui';

function installDesktopSessionContext(args: Readonly<{
  sessionSource: DesktopSessionSource;
  label: string;
  localEnvironmentID: string;
  envPublicID?: string;
}>): void {
  window.redevenDesktopSessionContext = {
    getSnapshot: () => ({
      local_environment_id: args.localEnvironmentID,
      renderer_storage_scope_id: `desktop:${args.localEnvironmentID}`,
      target_kind: args.sessionSource === 'ssh_environment'
        ? 'ssh_environment'
        : args.sessionSource === 'external_local_ui'
          ? 'external_local_ui'
          : 'local_environment',
      target_route: 'remote_desktop',
      session_source: args.sessionSource,
      ...(args.envPublicID ? { env_public_id: args.envPublicID } : {}),
      label: args.label,
    }),
    notifyAppReady: desktopAppReadyMock,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  commandState.commands = [];
  notesOverlayState.lastProps = null;
  settingsPageState.focusSeq = 0;
  settingsPageState.focusSection = null;
  registeredComponentsState.components = [];
  activitySurfaceLifecycleState.fileMounts = 0;
  activitySurfaceLifecycleState.fileCleanups = 0;
  activitySurfaceLifecycleState.codexProviderMounts = 0;
  activitySurfaceLifecycleState.codexProviderCleanups = 0;
  activitySurfaceLifecycleState.codexPageMounts = 0;
  activitySurfaceLifecycleState.codexPageCleanups = 0;
  activitySurfaceLifecycleState.codexSidebarMounts = 0;
  activitySurfaceLifecycleState.codexSidebarCleanups = 0;
  protocolStatus = 'disconnected';
  protocolClient = null;
  protocolError = null;
  resumeCalls = [];
  layoutIsMobile = false;
  sidebarActiveTabValue = 'terminal';
  setSidebarActiveTabSignal = null;
  delete window.redevenDesktopShell;
  delete window.redevenDesktopSessionContext;
  setSidebarActiveTabMock.mockClear();
  setSidebarCollapsedMock.mockClear();
  reloadCurrentPageMock.mockReset();
  desktopAppReadyMock.mockReset();
  delete window.redevenDesktopLanguage;
  accessStatusMock.mockReset();
  accessStatusMock.mockImplementation(async () => ({ passwordRequired: true, unlocked: resumeCalls.length > 0 }));
  accessResumeMock.mockReset();
  accessResumeMock.mockImplementation(async ({ token }: { token: string }) => {
    resumeCalls.push(token);
  });
  pluginApiMocks.executePluginLifecycleCommand.mockClear();
  pluginApiMocks.executePluginLifecycleCommand.mockImplementation(async (command: any) => (
    command?.type === 'open_surface'
      ? {
          plugin_id: 'com.redeven.official.containers',
          plugin_instance_id: 'plugininst_containers',
          surface_id: 'containers.activity',
          surface_instance_id: 'surface_containers',
          active_fingerprint: 'sha256:official-containers',
          asset_ticket: 'asset_ticket_containers',
          asset_ticket_id: 'assetticket_containers',
          bridge_nonce: 'bridge_nonce_containers',
        }
      : {}
  ));
  pluginApiMocks.loadPluginInventoryProjection.mockReset();
  terminalFeaturePreloadMocks.preloadTerminalFeatureResources.mockClear();
  terminalFeaturePreloadMocks.scheduleTerminalFeaturePreload.mockClear();
  pluginApiMocks.loadPluginInventoryProjection.mockResolvedValue({
    items: [
      {
        pluginID: 'com.redeven.official.containers',
        displayName: 'Containers',
        description: 'Manage Docker and Podman resources.',
        iconFallback: 'containers',
        publisher: 'Redeven',
        lifecycleState: 'not_installed',
        trustBadge: 'official',
        pinned: false,
        officialCatalog: {
          pluginID: 'com.redeven.official.containers',
          displayName: 'Containers',
          description: 'Manage Docker and Podman resources.',
          publisher: 'Redeven',
          latestVersion: '1.0.0',
          stableVersion: '1.0.0',
          minRedevenVersion: '0.1.0',
          minReDevPluginVersion: '0.1.1',
          rolloutState: 'stable',
          defaultSurfaceID: 'containers.activity',
          iconFallback: 'containers',
          distribution: {
            releaseChannel: 'github_release_and_redeven_cdn',
            artifactName: 'containers-1.0.0.redevplugin',
            officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
          },
        },
      },
    ],
  });
  getLocalRuntimeMock.mockResolvedValue({ mode: 'local', env_public_id: 'env_local', direct_ws_url: 'ws://localhost/_redeven_direct/ws' });
  refreshLocalRuntimeMock.mockResolvedValue({ mode: 'local', env_public_id: 'env_local', direct_ws_url: 'ws://localhost/_redeven_direct/ws' });
  getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: false });
  unlockLocalAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvAppAccessStatusMock
    .mockResolvedValueOnce({ password_required: true, unlocked: false })
    .mockResolvedValueOnce({ password_required: true, unlocked: true });
  unlockEnvAppAccessMock.mockResolvedValue({ unlocked: true, resume_token: 'resume123' });
  getEnvironmentMock.mockResolvedValue({
    public_id: 'env_local',
    name: 'Local runtime',
    namespace_public_id: 'ns_local',
    status: 'online',
    lifecycle_status: 'running',
    permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
  });
  mintLocalDirectConnectArtifactMock.mockResolvedValue({
    transport: 'direct',
    direct_info: {
      ws_url: 'ws://localhost/_redeven_direct/ws',
      channel_id: 'ch_local',
      e2ee_psk_b64u: 'secret',
      channel_init_expire_at_unix_s: 1,
      default_suite: 1,
    },
  });
  connectArtifactEntryMock.mockReturnValue({
    transport: 'tunnel',
    tunnel_grant: { channel_id: 'ch_local' },
  });
});

describe('EnvAppShell environment entry affordances', () => {
  it('shows the runtime-driven plaintext exposure warning and exact security details before dismissal', async () => {
    const accessStatus = {
      password_required: true,
      unlocked: true,
      exposure: {
        scope: 'network' as const,
        transport: 'plaintext' as const,
        password_required: true,
      },
      urls: ['http://192.168.1.20:23998/'],
    };
    getLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });
    refreshLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="network-exposure-warning"]')));
      const warning = host.querySelector('[data-testid="network-exposure-warning"]') as HTMLElement;
      expect(warning.textContent).toContain('Plaintext network exposure is active');
      expect(warning.textContent).toContain('Password enabled; TLS is not. Use only on a trusted network.');
      expect(warning.getAttribute('data-redeven-desktop-window-titlebar')).toBe('true');
      expect(warning.getAttribute('data-redeven-desktop-titlebar-drag-region')).toBe('true');
      expect(warning.querySelector('[data-redeven-desktop-window-titlebar-content="true"]')).toBeTruthy();
      expect(warning.querySelector('[data-redeven-desktop-titlebar-no-drag="true"]')?.textContent).toContain('View security details');
      expect(host.querySelector('[data-testid="display-mode-keep-alive"]')?.className).toContain('redeven-env-shell-stage');

      findButtonByText(host, 'Activity')?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-floe-shell]')));
      expect(host.querySelector('[data-floe-shell]')?.className).toContain('!h-full');

      findButtonByText(host, 'View security details')?.click();
      await flushUntil(() => Boolean(host.querySelector('[role="dialog"]')));

      const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.textContent).toContain('http://192.168.1.20:23998/');
      expect(dialog.textContent).toContain('HTTP, no TLS');
      expect(dialog.textContent).toContain('Password enabled');
      expect(dialog.textContent).toContain('Flowersec end-to-end encryption begins only after its handshake completes');

      findButtonByText(host, 'Close')?.click();
      await flushUntil(() => !host.querySelector('[role="dialog"]'));
      expect(host.querySelector('[data-testid="network-exposure-warning"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('closes the plaintext exposure warning only for the current Env App mount', async () => {
    const accessStatus = {
      password_required: true,
      unlocked: true,
      exposure: {
        scope: 'network' as const,
        transport: 'plaintext' as const,
        password_required: true,
      },
      urls: ['http://192.168.1.20:23998/'],
    };
    getLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });
    refreshLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const firstDispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="network-exposure-warning"]')));
      (host.querySelector('[data-testid="network-exposure-dismiss"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => !host.querySelector('[data-testid="network-exposure-warning"]'));
      expect(window.localStorage.getItem(NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY)).toBeNull();
    } finally {
      firstDispose();
    }

    const secondDispose = render(() => <EnvAppShell />, host);
    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="network-exposure-warning"]')));
      expect(host.querySelector('[data-testid="network-exposure-warning"]')).toBeTruthy();
    } finally {
      secondDispose();
    }
  });

  it('persists the choice to stop showing plaintext exposure warnings', async () => {
    const accessStatus = {
      password_required: true,
      unlocked: true,
      exposure: {
        scope: 'network' as const,
        transport: 'plaintext' as const,
        password_required: true,
      },
      urls: ['http://192.168.1.20:23998/'],
    };
    getLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });
    refreshLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: accessStatus,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const firstDispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="network-exposure-warning"]')));
      (host.querySelector('[data-testid="network-exposure-dont-remind"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => !host.querySelector('[data-testid="network-exposure-warning"]'));
      expect(JSON.parse(window.localStorage.getItem(NETWORK_EXPOSURE_WARNING_PREFERENCE_STORAGE_KEY) ?? 'null')).toEqual({
        version: 1,
        suppressed: true,
      });
    } finally {
      firstDispose();
    }

    const secondDispose = render(() => <EnvAppShell />, host);
    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="display-mode-keep-alive"]')));
      expect(host.querySelector('[data-testid="network-exposure-warning"]')).toBeNull();
    } finally {
      secondDispose();
    }
  });

  it('keeps visited Activity surfaces mounted across Files, Terminal, Monitor, Flower, and Codex navigation', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    // Keep this lifecycle test independent of Vitest's dynamic-module transform timing.
    // Importing the component module does not mount or initialize the Codex provider.
    await import('./codex/CodexActivitySurface');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-activity-id="codex"]')));
      expect(activitySurfaceLifecycleState.codexProviderMounts).toBe(0);
      expect(activitySurfaceLifecycleState.codexPageMounts).toBe(0);
      expect(activitySurfaceLifecycleState.codexSidebarMounts).toBe(0);

      (host.querySelector('[data-activity-id="files"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-testid="mock-file-browser"]')));
      await flushUntil(() => !host.querySelector('[data-testid="mock-file-loading"]'));
      terminalFeaturePreloadMocks.preloadTerminalFeatureResources.mockClear();

      const fileBrowser = host.querySelector('[data-testid="mock-file-browser"]') as HTMLElement;
      const pathInput = host.querySelector('[data-testid="mock-file-path"]') as HTMLInputElement;
      const filterInput = host.querySelector('[data-testid="mock-file-filter"]') as HTMLInputElement;
      const scrollViewport = host.querySelector('[data-testid="mock-file-scroll"]') as HTMLElement;

      pathInput.value = '/workspace/src';
      pathInput.dispatchEvent(new Event('input', { bubbles: true }));
      filterInput.value = 'main.ts';
      filterInput.dispatchEvent(new Event('input', { bubbles: true }));
      (host.querySelector('[data-testid="mock-file-expand"]') as HTMLButtonElement).click();
      (host.querySelector('[data-testid="mock-file-grid"]') as HTMLButtonElement).click();
      (host.querySelector('[data-testid="mock-file-select"]') as HTMLButtonElement).click();
      scrollViewport.scrollTop = 176;

      for (const target of ['terminal', 'monitor', 'ai', 'codex']) {
        (host.querySelector(`[data-activity-id="${target}"]`) as HTMLButtonElement | null)?.click();
        await flushUntil(() => sidebarActiveTabValue === target);

        if (target === 'terminal') {
          expect(terminalFeaturePreloadMocks.preloadTerminalFeatureResources).toHaveBeenCalledWith({ reason: 'intent' });
          expect(terminalFeaturePreloadMocks.preloadTerminalFeatureResources.mock.invocationCallOrder.at(-1)).toBeLessThan(
            setSidebarActiveTabMock.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
          );
        }

        expect(host.querySelector('[data-testid="mock-file-browser"]')).toBe(fileBrowser);
        expect(activitySurfaceLifecycleState.fileMounts).toBe(1);
        expect(activitySurfaceLifecycleState.fileCleanups).toBe(0);

        if (target === 'codex') {
          await flushUntil(() => activitySurfaceLifecycleState.codexProviderMounts === 1, 60);
          expect(activitySurfaceLifecycleState.codexPageMounts).toBe(1);
          expect(activitySurfaceLifecycleState.codexSidebarMounts).toBe(1);
          expect(host.querySelector('[data-testid="mock-codex-sidebar"]')).toBeTruthy();
        }

        (host.querySelector('[data-activity-id="files"]') as HTMLButtonElement | null)?.click();
        expect(host.querySelector('[data-testid="mock-file-loading"]')).toBeNull();
        await flushUntil(() => sidebarActiveTabValue === 'files');

        expect(host.querySelector('[data-testid="mock-file-browser"]')).toBe(fileBrowser);
        expect((host.querySelector('[data-testid="mock-file-path"]') as HTMLInputElement).value).toBe('/workspace/src');
        expect((host.querySelector('[data-testid="mock-file-filter"]') as HTMLInputElement).value).toBe('main.ts');
        expect(fileBrowser.dataset.expanded).toBe('true');
        expect(fileBrowser.dataset.viewMode).toBe('grid');
        expect(fileBrowser.dataset.selection).toBe('/workspace/src/main.ts');
        expect((host.querySelector('[data-testid="mock-file-scroll"]') as HTMLElement).scrollTop).toBe(176);
      }

      expect(activitySurfaceLifecycleState.codexProviderMounts).toBe(1);
      expect(activitySurfaceLifecycleState.codexProviderCleanups).toBe(0);
      expect(activitySurfaceLifecycleState.codexPageMounts).toBe(1);
      expect(activitySurfaceLifecycleState.codexPageCleanups).toBe(0);
      expect(activitySurfaceLifecycleState.codexSidebarMounts).toBe(1);
      expect(activitySurfaceLifecycleState.codexSidebarCleanups).toBe(0);
    } finally {
      dispose();
    }
  }, 10000);

  it('returns Flower-origin runtime settings to Flower and clears the origin on normal settings entry', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-testid="mock-context-open-flower-settings"]') as HTMLButtonElement | null)?.click();
      await flushAsync();

      const flowerContextState = host.querySelector('[data-testid="mock-env-context-state"]') as HTMLElement | null;
      expect(sidebarActiveTabValue).toBe('settings');
      expect(flowerContextState?.dataset.settingsOrigin).toBe('flower');

      (host.querySelector('[data-testid="mock-context-return-from-settings"]') as HTMLButtonElement | null)?.click();
      await flushAsync();

      expect(sidebarActiveTabValue).toBe('ai');
      expect((host.querySelector('[data-testid="mock-env-context-state"]') as HTMLElement | null)?.dataset.settingsOrigin).toBe('');

      (host.querySelector('[data-activity-id="settings"]') as HTMLButtonElement | null)?.click();
      await flushAsync();

      expect(sidebarActiveTabValue).toBe('settings');
      expect((host.querySelector('[data-testid="mock-env-context-state"]') as HTMLElement | null)?.dataset.settingsOrigin).toBe('');
    } finally {
      dispose();
    }
  }, 10000);

  it('shows the browser language command in the palette while keeping runtime settings separate', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();
      const runtimeSettingsCommand = commandState.commands.find((command) => command.id === 'redeven.env.openRuntimeSettings') as
        | undefined
        | {
            title?: string;
            keybind?: string;
          };
      const runtimeSettingsButton = host.querySelector('[data-activity-id="settings"]') as HTMLButtonElement | null;
      const languageButton = host.querySelector('[data-envapp-language-trigger="topbar"]') as HTMLButtonElement | null;

      expect(runtimeSettingsCommand).toBeTruthy();
      expect(runtimeSettingsCommand?.title).toBe('Open Runtime Settings');
      expect(runtimeSettingsCommand?.keybind).toBe('mod+,');
      expect(runtimeSettingsButton).toBeTruthy();
      expect(runtimeSettingsButton?.textContent).toContain('Runtime Settings');
      expect(host.querySelector('[data-activity-id="switch-environment"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Open environment actions"]')).toBeNull();
      expect(languageButton).toBeTruthy();

      setSidebarActiveTabMock.mockClear();
      runtimeSettingsButton?.click();
      await flushAsync();

      expect(sidebarActiveTabValue).toBe('settings');
      expect(setSidebarActiveTabMock).toHaveBeenCalled();
      expect(settingsPageState.focusSection).toBe('config');

      languageButton?.click();
      await flushAsync();

      expect(host.querySelector('[data-envapp-language-menu="topbar"]')).toBeTruthy();

      const changeLanguageCommand = commandState.commands.find((command) => command.id === 'redeven.env.changeLanguage') as
        | undefined
        | {
            execute?: () => void;
          };
      expect(changeLanguageCommand).toBeTruthy();
      changeLanguageCommand?.execute?.();
      await flushAsync();

      expect(host.querySelector('[data-envapp-language-menu="topbar"]')).toBeTruthy();
      expect(settingsPageState.focusSection).toBe('config');

      runtimeSettingsButton?.click();
      await flushAsync();

      expect(settingsPageState.focusSection).toBe('config');
    } finally {
      dispose();
    }
  }, 10000);

  it('opens the dedicated Plugin Center from the Plugins panel without entering Runtime Settings', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-activity-id="plugins"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-panel-tile="plugin-center"]')));

      (host.querySelector('[data-plugin-panel-tile="plugin-center"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-center-view]')));

      expect(host.querySelector('[data-plugin-center-shell]')).toBeTruthy();
      expectPluginCenterMountedInActivityMain(host);
      expect(host.querySelector('[data-testid="settings-page"]')).toBeNull();
      expect(settingsPageState.focusSection).not.toBe('plugins');
      expect(sidebarActiveTabValue).toBe('plugin-center');
    } finally {
      dispose();
    }
  }, 10000);

  it('closes Plugin Center back to the last normal activity surface', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-activity-id="monitor"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => sidebarActiveTabValue === 'monitor');

      (host.querySelector('[data-activity-id="plugins"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-panel-tile="plugin-center"]')));

      (host.querySelector('[data-plugin-panel-tile="plugin-center"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-center-view]')));
      expectPluginCenterMountedInActivityMain(host);
      expect(sidebarActiveTabValue).toBe('plugin-center');

      (host.querySelector('button[aria-label="Close Plugin Center"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => sidebarActiveTabValue === 'monitor');

      const hiddenPluginCenter = host.querySelector('[data-plugin-center-view]');
      expect(hiddenPluginCenter).toBeTruthy();
      expect((hiddenPluginCenter?.closest('[data-testid="activity-view-plugin-center"]') as HTMLElement | null)?.style.display).toBe('none');
      expect(host.querySelector('[data-testid="settings-page"]')).toBeNull();
    } finally {
      dispose();
    }
  }, 10000);

  it('routes disabled plugin panel tiles to the dedicated Plugin Center details', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    pluginApiMocks.loadPluginInventoryProjection.mockResolvedValue({
      items: [
        {
          pluginID: 'com.redeven.official.containers',
          pluginInstanceID: 'plugininst_containers',
          displayName: 'Containers',
          description: 'Manage Docker and Podman resources.',
          iconFallback: 'containers',
          publisher: 'Redeven',
          version: '1.0.0',
          lifecycleState: 'disabled',
          trustBadge: 'official',
          pinned: false,
          attentionReason: 'disabled',
          officialCatalog: {
            pluginID: 'com.redeven.official.containers',
            displayName: 'Containers',
            description: 'Manage Docker and Podman resources.',
            publisher: 'Redeven',
            latestVersion: '1.0.0',
            stableVersion: '1.0.0',
            minRedevenVersion: '0.1.0',
            minReDevPluginVersion: '0.1.1',
            rolloutState: 'stable',
            defaultSurfaceID: 'containers.activity',
            iconFallback: 'containers',
            distribution: {
              releaseChannel: 'github_release_and_redeven_cdn',
              artifactName: 'containers-1.0.0.redevplugin',
              officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
            },
          },
        },
      ],
    });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-activity-id="plugins"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-panel-tile="com.redeven.official.containers"]')));

      (host.querySelector('[data-plugin-panel-tile="com.redeven.official.containers"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-center-view]')));
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-center-item="com.redeven.official.containers"]')));

      expect(host.querySelector('[data-plugin-center-item="com.redeven.official.containers"]')).toBeTruthy();
      expect(host.querySelector('[data-plugin-center-details]')?.textContent).toContain('Disabled');
      expectPluginCenterMountedInActivityMain(host);
      expect(host.querySelector('[data-testid="settings-page"]')).toBeNull();
      expect(settingsPageState.focusSection).not.toBe('plugins');
      expect(sidebarActiveTabValue).toBe('plugin-center');
    } finally {
      dispose();
    }
  }, 10000);

  it('opens enabled plugin panel tiles in the sandboxed plugin surface activity', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    pluginApiMocks.executePluginLifecycleCommand.mockResolvedValueOnce({
      plugin_id: 'com.redeven.official.containers',
      plugin_instance_id: 'plugininst_containers',
      surface_id: 'containers.activity',
      surface_instance_id: 'surface_containers_1',
      active_fingerprint: 'sha256:containers',
      asset_ticket: 'asset_ticket_1',
      asset_ticket_id: 'asset_ticket_id_1',
      bridge_nonce: 'bridge_nonce_1',
    });
    pluginApiMocks.loadPluginInventoryProjection.mockResolvedValue({
      items: [
        {
          pluginID: 'com.redeven.official.containers',
          pluginInstanceID: 'plugininst_containers',
          displayName: 'Containers',
          description: 'Manage Docker and Podman resources.',
          iconFallback: 'containers',
          publisher: 'Redeven',
          version: '1.0.0',
          lifecycleState: 'enabled',
          trustBadge: 'official',
          pinned: false,
          defaultLaunchTarget: {
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.activity',
            preferredPlacement: 'activity',
          },
          officialCatalog: {
            pluginID: 'com.redeven.official.containers',
            displayName: 'Containers',
            description: 'Manage Docker and Podman resources.',
            publisher: 'Redeven',
            latestVersion: '1.0.0',
            stableVersion: '1.0.0',
            minRedevenVersion: '0.1.0',
            minReDevPluginVersion: '0.1.1',
            rolloutState: 'stable',
            defaultSurfaceID: 'containers.activity',
            iconFallback: 'containers',
            distribution: {
              releaseChannel: 'github_release_and_redeven_cdn',
              artifactName: 'containers-1.0.0.redevplugin',
              officialArtifactPath: 'official/containers/1.0.0/containers-1.0.0.redevplugin',
            },
          },
        },
      ],
    });
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      (host.querySelector('[data-activity-id="plugins"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-panel-tile="com.redeven.official.containers"]')));

      (host.querySelector('[data-plugin-panel-tile="com.redeven.official.containers"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => Boolean(host.querySelector('[data-plugin-surface-host]')));
      await flushUntil(() => (
        host.querySelector('[data-plugin-surface-host]')?.getAttribute('data-plugin-id') === 'com.redeven.official.containers'
      ));

      const surfaceHost = host.querySelector('[data-plugin-surface-host]');
      const main = host.querySelector('[data-floe-shell-slot="main"]');
      expect(surfaceHost).toBeTruthy();
      expect(main?.contains(surfaceHost)).toBe(true);
      expect(surfaceHost?.getAttribute('data-plugin-id')).toBe('com.redeven.official.containers');
      expect(pluginApiMocks.executePluginLifecycleCommand).toHaveBeenCalledWith({
        type: 'open_surface',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.activity',
        placement: 'activity',
      });
      expect(host.querySelector('[data-plugin-center-view]')).toBeNull();
      expect(host.querySelector('[data-testid="settings-page"]')).toBeNull();
      expect(settingsPageState.focusSection).not.toBe('plugins');
      expect(sidebarActiveTabValue).toBe('plugin-surface');

      (host.querySelector('[aria-label="Close Plugin Surface"]') as HTMLButtonElement | null)?.click();
      await flushUntil(() => sidebarActiveTabValue === 'terminal');
      const hiddenPluginSurface = host.querySelector('[data-plugin-surface-host]');
      expect(hiddenPluginSurface).toBeTruthy();
      expect((hiddenPluginSurface?.closest('[data-testid="activity-view-plugin-surface"]') as HTMLElement | null)?.style.display).toBe('none');
      expect(sidebarActiveTabValue).toBe('terminal');
    } finally {
      dispose();
    }
  }, 10000);

  it('keeps browser language controls available on the access gate without touching runtime settings', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: false });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const trigger = host.querySelector('[data-envapp-language-trigger="access_gate"]') as HTMLButtonElement | null;
      expect(trigger).toBeTruthy();
      expect(host.querySelector('[data-envapp-language-trigger="topbar"]')).toBeNull();
      expect(host.querySelector('[data-envapp-language-menu="access_gate"]')).toBeNull();

      const openLanguageCommand = commandState.commands.find((command) => command.id === 'redeven.env.changeLanguage') as
        | undefined
        | {
            execute?: () => void;
          };
      expect(openLanguageCommand).toBeTruthy();
      openLanguageCommand?.execute?.();
      await flushAsync();

      expect(host.querySelector('[data-envapp-language-menu="access_gate"]')).toBeTruthy();
      expect(host.querySelector('[data-envapp-language-menu="topbar"]')).toBeNull();

      trigger?.click();
      await flushAsync();

      expect(host.querySelector('[data-envapp-language-menu="access_gate"]')).toBeNull();
      expect(settingsPageState.focusSection).toBe(null);
      expect(connectMock).not.toHaveBeenCalled();
      expect(unlockLocalAccessMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('does not register Env App language controls when Desktop owns the language bridge', async () => {
    const snapshot = {
      preference: 'zh-CN',
      resolved_locale: 'zh-CN',
      source: 'explicit',
      system_candidates: ['zh-Hans'],
    } as const;
    const setPreference = vi.fn(() => snapshot);
    window.redevenDesktopLanguage = {
      getSnapshot: () => snapshot,
      setPreference,
      subscribe: () => () => undefined,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const { I18nProvider } = await import('./i18n');
    const dispose = render(() => (
      <I18nProvider>
        <EnvAppShell />
      </I18nProvider>
    ), host);

    try {
      await vi.waitFor(() => {
        expect(document.documentElement.lang).toBe('zh-CN');
      });
      expect(host.querySelector('[data-envapp-language-trigger]')).toBeNull();
      expect(commandState.commands.find((command) => command.id === 'redeven.env.changeLanguage')).toBeFalsy();
      expect(setPreference).not.toHaveBeenCalled();
    } finally {
      dispose();
      delete window.redevenDesktopLanguage;
    }
  });

  it('shows Switch Environment on the activity bottom area and keeps the command palette entry when the desktop bridge is available', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    const openConnectionCenterMock = vi.fn().mockResolvedValue(undefined);
    window.redevenDesktopShell = {
      openConnectionCenter: openConnectionCenterMock,
    };

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      const switchEnvironmentCommand = commandState.commands.find((command) => command.id === 'redeven.desktop.openEnvironment') as
        | undefined
        | {
            execute: () => Promise<void>;
          };
      const switchEnvironmentButton = host.querySelector('[data-activity-id="switch-environment"]') as HTMLButtonElement | null;

      expect(switchEnvironmentCommand).toBeTruthy();
      expect(switchEnvironmentButton).toBeTruthy();
      expect(switchEnvironmentButton?.textContent).toContain('Switch Environment');

      switchEnvironmentButton?.click();
      await flushAsync();

      expect(openConnectionCenterMock).toHaveBeenCalledTimes(1);

      await switchEnvironmentCommand?.execute();
      await flushAsync();

      expect(openConnectionCenterMock).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
      delete window.redevenDesktopShell;
    }
  });

  it('uses the dark-mode svg variant for the original redeven logo mark', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const logoImage = host.querySelector('img[alt="Redeven"]');
      expect(logoImage).toBeTruthy();
      expect(logoImage?.getAttribute('data-redeven-logo-theme')).toBe('dark');
      expect(logoImage?.getAttribute('src')).toContain('logo-dark.svg');
    } finally {
      dispose();
    }
  });

  it('opens the dashboard through the system browser bridge in Desktop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const openDashboardMock = vi.fn().mockResolvedValue({ ok: true });
    window.redevenDesktopShell = {
      openDashboard: openDashboardMock,
    };

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const logoButton = host.querySelector('button[aria-label="Back to dashboard"]') as HTMLButtonElement | null;
      expect(logoButton).toBeTruthy();

      logoButton?.click();
      await flushAsync();

      expect(openDashboardMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      delete window.redevenDesktopShell;
    }
  });

  it('keeps desktop top bar tooltips enabled for the remaining shared icon actions', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]');
      const toggleThemeButton = host.querySelector('button[aria-label="Toggle theme"]');

      expect(notesButton).toBeTruthy();
      expect(notesButton?.getAttribute('data-tooltip')).toBe('Notes overlay (⌘.)');
      expect(host.querySelector('button[aria-label="Command palette"]')).toBeNull();
      expect(toggleThemeButton).toBeTruthy();
      expect(toggleThemeButton?.getAttribute('data-tooltip')).toBe('Toggle theme');
    } finally {
      dispose();
    }
  });

  it('omits the environment name from the full-page header shell title slot', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const displayModeShell = host.querySelector('[data-testid="display-mode-page-shell"]');
      expect(displayModeShell).toBeTruthy();
      expect(displayModeShell?.getAttribute('data-title')).toBe('');
      expect(host.querySelector('button[aria-label="Open environment actions"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('keeps the notes entry available on mobile while disabling top bar tooltips', async () => {
    layoutIsMobile = true;
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]') as HTMLButtonElement | null;
      const toggleThemeButton = host.querySelector('button[aria-label="Toggle theme"]');
      expect(host.querySelector('button[aria-label="Command palette"]')).toBeNull();
      expect(notesButton).toBeTruthy();
      expect(notesButton?.getAttribute('data-tooltip')).toBeNull();
      expect(notesOverlayState.lastProps?.open).toBe(false);

      notesButton?.click();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);

      expect(toggleThemeButton).toBeTruthy();
      expect(toggleThemeButton?.getAttribute('data-tooltip')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('toggles the notes overlay from the top bar and shared close callback', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesButton = host.querySelector('button[aria-label="Notes overlay"]') as HTMLButtonElement | null;
      const displayModeShell = host.querySelector('[data-testid="display-mode-page-shell"]') as HTMLElement | null;
      expect(notesButton).toBeTruthy();
      expect(notesOverlayState.lastProps?.open).toBe(false);
      expect(notesOverlayState.lastProps?.viewportHosts).toHaveLength(1);
      expect(displayModeShell?.contains(notesOverlayState.lastProps?.viewportHosts?.[0] ?? null)).toBe(true);

      notesButton?.click();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);
      expect(notesOverlayState.lastProps?.viewportHosts).toHaveLength(1);
      expect(displayModeShell?.contains(notesOverlayState.lastProps?.viewportHosts?.[0] ?? null)).toBe(true);

      notesOverlayState.lastProps?.onClose();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(false);
    } finally {
      dispose();
    }
  });

  it('binds Notes to the full-page display shell viewport while workbench mode is active', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const displayModeShell = host.querySelector('[data-testid="display-mode-page-shell"]') as HTMLElement | null;

      expect(displayModeShell).toBeTruthy();
      expect(notesOverlayState.lastProps?.viewportHosts).toHaveLength(1);
      expect(displayModeShell?.contains(notesOverlayState.lastProps?.viewportHosts?.[0] ?? null)).toBe(true);
    } finally {
      dispose();
    }
  });

  it('registers a typing-safe notes toggle command', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const notesCommand = commandState.commands.find((command) => command.id === 'redeven.env.toggleNotesOverlay') as
        | undefined
        | {
            keybind?: string;
            allowWhileTyping?: boolean;
            execute: () => void;
          };

      expect(notesCommand).toBeTruthy();
      expect(notesCommand?.keybind).toBe('mod+.');
      expect(notesCommand?.allowWhileTyping).toBe(true);
      expect(notesOverlayState.lastProps?.open).toBe(false);
      expect(notesOverlayState.lastProps?.toggleKeybind).toBe('mod+.');

      notesCommand?.execute();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(true);

      notesCommand?.execute();
      await flushAsync();
      expect(notesOverlayState.lastProps?.open).toBe(false);
    } finally {
      dispose();
    }
  });

  it('suppresses the desktop sidebar width transition for one frame when opening Codex from a full-screen activity surface', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    const storage = createStorageMock();
    storage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    vi.stubGlobal('localStorage', storage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const shellSidebar = host.querySelector('[data-testid="shell-sidebar"]');
      const codexButton = findButtonByText(host, 'Codex');

      expect(shellSidebar?.className).not.toContain('transition-none');
      expect(codexButton).toBeTruthy();

      codexButton?.click();

      expect(setSidebarActiveTabMock).toHaveBeenCalledWith(
        'codex',
        expect.objectContaining({ openSidebar: true, visibilityMotion: 'instant' }),
      );

      await flushAsync();

      expect(shellSidebar?.className).not.toContain('transition-none');
    } finally {
      dispose();
    }
  });
});

describe('EnvAppShell local access gate', () => {
  it('reports an interactive Desktop access gate after the shell paint boundary', async () => {
    installDesktopSessionContext({
      sessionSource: 'ssh_environment',
      label: 'SSH Workstation',
      localEnvironmentID: 'ssh:workstation:2222:key_agent:remote_default',
    });
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => desktopAppReadyMock.mock.calls.length > 0, 40);

      expect(host.querySelector('input[type="password"]')).toBeTruthy();
      expect(desktopAppReadyMock).toHaveBeenCalledWith({
        state: 'access_gate_interactive',
        timings: expect.objectContaining({
          bootstrap_ms: expect.any(Number),
          access_ready_ms: expect.any(Number),
          shell_painted_ms: expect.any(Number),
        }),
      });
    } finally {
      dispose();
    }
  });

  it('shows a neutral checking gate while local access is still resolving', async () => {
    const accessDeferred = deferred<{ password_required: boolean; unlocked: boolean } | null>();
    getLocalAccessStatusMock.mockReturnValueOnce(accessDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Preparing secure access');
      expect(host.textContent).toContain('Checking secure access...');
      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).not.toHaveBeenCalled();

      accessDeferred.resolve({ password_required: true, unlocked: false });
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('waits for password unlock before connecting the local runtime', async () => {
    const networkExposure = {
      scope: 'network' as const,
      transport: 'plaintext' as const,
      password_required: true,
    };
    getLocalAccessStatusMock.mockResolvedValue({
      password_required: true,
      unlocked: false,
      exposure: networkExposure,
      urls: ['http://192.168.1.20:23998/'],
    });
    refreshLocalRuntimeMock.mockResolvedValue({
      mode: 'local',
      env_public_id: 'env_local',
      direct_ws_url: 'ws://localhost/_redeven_direct/ws',
      access_status: {
        password_required: true,
        unlocked: true,
        exposure: networkExposure,
        urls: ['http://192.168.1.20:23998/'],
      },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock local runtime');
      expect(connectMock).not.toHaveBeenCalled();
      expect(mintLocalDirectConnectArtifactMock).not.toHaveBeenCalled();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(unlockLocalAccessMock).toHaveBeenCalledWith('secret');
      expect(getLocalAccessStatusMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      const localConnectConfig = connectMock.mock.calls[0]?.[0];
      expect(localConnectConfig).toMatchObject({
        observer: expect.any(Object),
        source: {
          kind: 'refreshable',
          acquire: expect.any(Function),
        },
        connect: {
          outboundRecordChunkBytes: 64 * 1024,
          liveness: { intervalMs: 15_000, timeoutMs: 10_000 },
          transportSecurityPolicy: 'allow_plaintext_for_loopback',
          webSocketLimits: {
            maxInboundQueuedBytes: 4 * 1024 * 1024,
            outboundLowWatermarkBytes: 256 * 1024,
            outboundHighWatermarkBytes: 1024 * 1024,
            outboundHardLimitBytes: 4 * 1024 * 1024,
            outboundDrainTimeoutMs: 10_000,
          },
          yamuxLimits: {
            maxActiveStreams: 64,
            maxInboundStreams: 32,
            maxFrameBytes: 256 * 1024,
            preferredOutboundFrameBytes: 64 * 1024,
            maxStreamReceiveBytes: 256 * 1024,
            maxSessionReceiveBytes: 16 * 1024 * 1024,
          },
        },
        autoReconnect: {
          enabled: true,
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 3_000,
        },
      });
      expect(localConnectConfig).not.toHaveProperty('directInfo');
      expect(mintLocalDirectConnectArtifactMock).not.toHaveBeenCalled();
      expect(accessResumeMock).not.toHaveBeenCalled();
      expect(resumeCalls).toEqual([]);
      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      expect(host.textContent).not.toContain('Preparing secure session');
      expect(host.querySelector('[data-testid="network-exposure-warning"]')).toBeTruthy();
      expect(host.textContent).toContain('Plaintext network exposure is active');
    } finally {
      dispose();
    }
  });

  it('labels the password field, links helper/error text, and restores focus after unlock failures', async () => {
    unlockLocalAccessMock.mockRejectedValueOnce(new Error('Wrong password.'));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const label = host.querySelector('label[for="redeven-access-password"]');
      const input = host.querySelector('#redeven-access-password') as HTMLInputElement | null;
      const help = host.querySelector('#redeven-access-password-help');
      const notice = host.querySelector('#redeven-access-notice');

      expect(label?.textContent).toContain('Access password');
      expect(input).toBeTruthy();
      expect(input?.getAttribute('aria-describedby')).toContain('redeven-access-password-help');
      expect(help?.textContent).toContain('Use the full Local UI password');
      expect(notice?.textContent).toContain('Password verification stays inside the Runtime-managed session');

      input!.value = 'bad-secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      const error = host.querySelector('#redeven-access-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent).toContain('Wrong password.');
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input);
    } finally {
      dispose();
    }
  });

  it('shows the retry countdown and disables unlock while access retries are cooling down', async () => {
    vi.useFakeTimers();
    const { AccessUnlockError } = await import('./services/accessUnlockError');
    unlockLocalAccessMock.mockRejectedValueOnce(new AccessUnlockError({
      message: 'Too many incorrect password attempts.',
      status: 429,
      code: 'ACCESS_PASSWORD_RETRY_LATER',
      retryAfterMs: 30_000,
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('#redeven-access-password') as HTMLInputElement | null;
      input!.value = 'bad-secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();
      await flushAsync();

      const help = host.querySelector('#redeven-access-password-help');
      const button = host.querySelector('button[type="submit"]') as HTMLButtonElement | null;

      expect(help?.textContent).toContain('Try again in 30s');
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain('Retry in 30s');

      await vi.advanceTimersByTimeAsync(30_000);
      await flushAsync();

      expect(help?.textContent).not.toContain('Try again in');
      expect(button?.disabled).toBe(false);
      expect(button?.textContent).toContain('Unlock');
    } finally {
      dispose();
    }
  });

  it('reuses an existing unlocked local session without prompting for password', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: true, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).not.toContain('Unlock local runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(unlockLocalAccessMock).not.toHaveBeenCalled();
      expect(accessResumeMock).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('shows Desktop provider identity while loading local runtime details from the local route', async () => {
    window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    installDesktopSessionContext({
      sessionSource: 'provider_environment',
      label: 'Acme Desktop',
      localEnvironmentID: 'provider:https%3A%2F%2Fredeven.test:env:env_provider',
      envPublicID: 'env_provider',
    });
    getEnvironmentMock.mockImplementation(async (request: { source?: string; envId?: string }) => {
      return {
        public_id: request.envId || 'env_local',
        name: 'Local runtime',
        namespace_public_id: 'ns_local',
        status: 'online',
        lifecycle_status: 'running',
        permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
      };
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => getEnvironmentMock.mock.calls.length > 0 && (host.textContent?.includes('Acme Desktop') ?? false), 40);

      expect(host.textContent).toContain('Acme Desktop');
      expect(host.textContent).toContain('env_provider');
      expect(host.textContent).toContain('Provider');
      expect(window.sessionStorage.getItem('redeven_env_public_id')).toBe('env_provider');
      expect(getEnvironmentMock).toHaveBeenCalledWith({ source: 'local', envId: 'env_local' });
      expect(getEnvironmentMock).not.toHaveBeenCalledWith({ source: 'controlplane', envId: 'env_provider' });
      expect(getEnvironmentMock.mock.calls.every(([request]) => request?.source === 'local')).toBe(true);
    } finally {
      dispose();
    }
  });

  const nonProviderRemoteDesktopCases = [
    {
      sessionSource: 'external_local_ui' as const,
      label: 'External Local UI',
      localEnvironmentID: 'http://127.0.0.1:24000/',
      expectedType: 'Remote',
    },
    {
      sessionSource: 'ssh_environment' as const,
      label: 'SSH Workstation',
      localEnvironmentID: 'ssh:workstation:2222:key_agent:remote_default',
      expectedType: 'SSH',
    },
  ];

  for (const testCase of nonProviderRemoteDesktopCases) {
    it(`does not treat remote_desktop ${testCase.sessionSource} sessions as provider identity`, async () => {
      window.localStorage.setItem('redeven_envapp_desktop_view_mode', 'activity');
      getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
      installDesktopSessionContext({
        sessionSource: testCase.sessionSource,
        label: testCase.label,
        localEnvironmentID: testCase.localEnvironmentID,
      });

      const host = document.createElement('div');
      document.body.appendChild(host);

      const { EnvAppShell } = await import('./EnvAppShell');
      const dispose = render(() => <EnvAppShell />, host);

      try {
        await flushUntil(() => getEnvironmentMock.mock.calls.length > 0 && (host.textContent?.includes(testCase.label) ?? false), 40);

        expect(host.textContent).toContain(testCase.label);
        expect(host.textContent).toContain(testCase.localEnvironmentID);
        expect(host.textContent).toContain(testCase.expectedType);
        expect(host.textContent).not.toContain('Provider');
        expect(getEnvironmentMock).toHaveBeenCalledWith({ source: 'local', envId: 'env_local' });
        expect(getEnvironmentMock).not.toHaveBeenCalledWith({ source: 'controlplane', envId: testCase.localEnvironmentID });
        expect(getEnvironmentMock.mock.calls.every(([request]) => request?.source === 'local')).toBe(true);
      } finally {
        dispose();
      }
    });
  }

  it('switches local direct reconnect into runtime waiting and reconnects after the runtime comes back', async () => {
    vi.useFakeTimers();
    getLocalAccessStatusMock.mockReset();
    getLocalAccessStatusMock
      .mockResolvedValueOnce({ password_required: true, unlocked: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ password_required: true, unlocked: true });
    reconnectMock.mockImplementationOnce(async () => {
      protocolStatus = 'connected';
      protocolClient = { id: 'client-local-recovered' };
      protocolError = null;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'Runtime is offline' };
      const observer = connectMock.mock.calls[0]?.[0]?.observer as {
        onDiagnosticEvent?: (event: Record<string, unknown>) => void;
      } | undefined;
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_attempt', result: 'retry', attempt_seq: 1 });
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_exhausted', result: 'fail', attempt_seq: 1 });
      await flushAsync();

      expect(host.querySelector('[data-testid="connection-recovery-view"]')).toBeTruthy();
      expect(host.textContent).toContain('Restoring connection');
      expect(host.querySelector('[data-testid="workbench-page"]')?.closest('[aria-hidden="true"]')).toBeTruthy();
      expect(reconnectMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(12_000);
      await flushUntil(() => reconnectMock.mock.calls.length === 1);

      expect(getLocalAccessStatusMock.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(reconnectMock).toHaveBeenCalledTimes(1);
      expect(reconnectMock.mock.calls[0]?.[0]).toBe(connectMock.mock.calls[0]?.[0]);
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      expect(protocolStatus).toBe('connected');
    } finally {
      dispose();
    }
  });

  it('returns to the local password prompt after restart invalidates the local access session', async () => {
    vi.useFakeTimers();
    getLocalAccessStatusMock.mockReset();
    getLocalAccessStatusMock
      .mockResolvedValueOnce({ password_required: true, unlocked: true })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ password_required: true, unlocked: false });
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'Runtime is offline' };
      const observer = connectMock.mock.calls[0]?.[0]?.observer as {
        onDiagnosticEvent?: (event: Record<string, unknown>) => void;
      } | undefined;
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_attempt', result: 'retry', attempt_seq: 1 });
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_exhausted', result: 'fail', attempt_seq: 1 });
      await flushAsync();
      expect(host.querySelector('[data-testid="connection-recovery-view"]')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(12_000);
      await flushUntil(() => host.textContent?.includes('Connection could not be restored') ?? false);

      expect(host.textContent).toContain('Connection could not be restored');
      expect(host.textContent).toContain('Desktop could not authenticate the original runtime connection.');
      expect(host.querySelector('[data-testid="workbench-page"]')?.closest('[aria-hidden="true"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('restores the persisted Codex activity surface after refresh once permissions are ready', async () => {
    const storage = createStorageMock();
    storage.setItem('redeven_envapp_desktop_view_mode', 'activity');
    storage.setItem('redeven_envapp_active_tab', 'codex');
    vi.stubGlobal('localStorage', storage);
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();
      await flushAsync();
      await flushAsync();
      await flushAsync();

      expect(setSidebarActiveTabMock).toHaveBeenCalledWith(
        'terminal',
        expect.objectContaining({ openSidebar: false }),
      );
      expect(setSidebarActiveTabMock).toHaveBeenCalledWith(
        'codex',
        expect.objectContaining({ openSidebar: true, visibilityMotion: 'instant' }),
      );
      expect(sidebarActiveTabValue).toBe('codex');
      expect(storage.getItem('redeven_envapp_active_tab')).toBe('codex');
    } finally {
      dispose();
    }
  });
});


describe('EnvAppShell remote access gate', () => {
  it('shows a neutral checking gate while remote access is still resolving', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const accessDeferred = deferred<{ password_required: boolean; unlocked: boolean }>();
    getEnvAppAccessStatusMock.mockReset();
    getEnvAppAccessStatusMock.mockReturnValueOnce(accessDeferred.promise);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Preparing secure access');
      expect(host.textContent).toContain('Checking secure access...');
      expect(host.textContent).not.toContain('Unlock runtime');
      expect(host.querySelector('input[type="password"]')).toBeFalsy();
      expect(connectMock).not.toHaveBeenCalled();

      accessDeferred.resolve({ password_required: true, unlocked: false });
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('Unlock runtime');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('keeps the app blocked until access resume finishes', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const resumeDeferred = deferred<void>();
    accessResumeMock.mockImplementationOnce(async ({ token }: { token: string }) => {
      resumeCalls.push(token);
      await resumeDeferred.promise;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('Preparing secure session');
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeNull();

      resumeDeferred.resolve();
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      expect(host.textContent).not.toContain('Preparing secure session');
    } finally {
      dispose();
    }
  });

  it('exposes retry and reload actions after the secure-session resume times out', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    vi.useFakeTimers();
    accessResumeMock.mockImplementationOnce(async ({ token }: { token: string }) => {
      resumeCalls.push(token);
      await new Promise<void>(() => {});
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(host.textContent).toContain('Preparing secure session');
      expect(findButtonByText(host, 'Preparing secure session...')).toBeTruthy();
      expect(findButtonByText(host, 'Reload page')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsync();

      expect(host.textContent).toContain('Failed to prepare the secure session');
      const retryButton = findButtonByText(host, 'Retry connection');
      expect(retryButton).toBeTruthy();
      expect(retryButton?.disabled).toBe(false);
      expect(findButtonByText(host, 'Reload page')).toBeTruthy();
      expect(Array.from(host.querySelectorAll('button')).filter((node) => node.textContent?.includes('Retry connection')).length).toBe(1);

      findButtonByText(host, 'Reload page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(reloadCurrentPageMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('retries with a fresh connection after a timed-out secure-session resume', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    vi.useFakeTimers();
    let statusCalls = 0;
    accessStatusMock.mockImplementation(async () => {
      statusCalls += 1;
      return { passwordRequired: true, unlocked: false };
    });
    accessResumeMock
      .mockImplementationOnce(async ({ token }: { token: string }) => {
        resumeCalls.push(token);
        await new Promise<void>(() => {});
      })
      .mockImplementationOnce(async ({ token }: { token: string }) => {
        resumeCalls.push(token);
      });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsync();

      expect(connectMock).toHaveBeenCalledTimes(1);
      const retryButton = findButtonByText(host, 'Retry connection');
      expect(retryButton).toBeTruthy();
      expect(retryButton?.disabled).toBe(false);
      retryButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await flushUntil(() => connectMock.mock.calls.length === 2);

      expect(disconnectMock).toHaveBeenCalled();
      expect(connectMock).toHaveBeenCalledTimes(2);
      expect(accessResumeMock).toHaveBeenCalledTimes(2);
      expect(resumeCalls).toEqual(['resume123', 'resume123']);
      expect(statusCalls).toBeGreaterThanOrEqual(2);
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      expect(host.textContent).not.toContain('Secure session needs attention');
    } finally {
      dispose();
    }
  });

  it('returns to the password prompt when the resume token is rejected', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
    accessResumeMock.mockRejectedValueOnce(Object.assign(new Error('invalid resume token'), { code: 401 }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.textContent).toContain('Unlock runtime');
      expect(host.textContent).toContain('Access password expired. Enter it again to continue.');
      expect(host.querySelector('input[type="password"]')).toBeTruthy();
    } finally {
      dispose();
    }
  });

  it('waits for password unlock before connecting the remote runtime', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      expect(host.textContent).toContain('Unlock runtime');
      expect(connectMock).not.toHaveBeenCalled();
      expect(getEnvironmentMock).not.toHaveBeenCalled();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));

      const form = host.querySelector('form');
      expect(form).toBeTruthy();
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      expect(unlockEnvAppAccessMock).toHaveBeenCalledWith('secret');
      expect(getEnvAppAccessStatusMock).toHaveBeenCalledTimes(2);
      expect(connectMock).toHaveBeenCalledTimes(1);
      const remoteConnectConfig = connectMock.mock.calls[0]?.[0];
      expect(remoteConnectConfig).toMatchObject({
        observer: expect.any(Object),
        source: {
          kind: 'refreshable',
          acquire: expect.any(Function),
        },
        connect: {
          outboundRecordChunkBytes: 64 * 1024,
          transportSecurityPolicy: 'require_tls',
          webSocketLimits: {
            maxInboundQueuedBytes: 4 * 1024 * 1024,
            outboundLowWatermarkBytes: 256 * 1024,
            outboundHighWatermarkBytes: 1024 * 1024,
            outboundHardLimitBytes: 4 * 1024 * 1024,
            outboundDrainTimeoutMs: 10_000,
          },
          yamuxLimits: {
            maxActiveStreams: 64,
            maxInboundStreams: 32,
            maxFrameBytes: 256 * 1024,
            preferredOutboundFrameBytes: 64 * 1024,
            maxStreamReceiveBytes: 256 * 1024,
            maxSessionReceiveBytes: 16 * 1024 * 1024,
          },
        },
        autoReconnect: {
          enabled: true,
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 3_000,
        },
      });
      expect(accessResumeMock).toHaveBeenCalledWith({ token: 'resume123' });
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      expect(host.textContent).not.toContain('Unlock runtime');
    } finally {
      dispose();
    }
  });

  it('mints a fresh connect artifact when the remote runtime requests a new session', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
    getEnvironmentMock.mockResolvedValue({
      public_id: 'env_demo',
      name: 'Remote runtime',
      namespace_public_id: 'ns_remote',
      status: 'online',
      lifecycle_status: 'running',
      permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
    });
    mintEnvProxyEntryTicketMock.mockResolvedValue('ticket-1');
    connectArtifactEntryMock.mockResolvedValue({
      transport: 'tunnel',
      tunnel_grant: { channel_id: 'ch_remote' },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      const remoteConnectConfig = connectMock.mock.calls[0]?.[0] as {
        source: { acquire: (context?: Readonly<{ traceId?: string; signal?: AbortSignal }>) => Promise<unknown> };
      };
      expect(remoteConnectConfig?.source.acquire).toEqual(expect.any(Function));

      getEnvironmentMock.mockClear();
      mintEnvProxyEntryTicketMock.mockClear();
      connectArtifactEntryMock.mockClear();

      const artifact = await remoteConnectConfig.source.acquire();

      expect(getEnvironmentMock).toHaveBeenCalledTimes(1);
      expect(getEnvironmentMock).toHaveBeenCalledWith({ source: 'controlplane', envId: 'env_demo' });
      expect(mintEnvProxyEntryTicketMock).toHaveBeenCalledTimes(1);
      expect(mintEnvProxyEntryTicketMock).toHaveBeenCalledWith({
        endpointId: 'env_demo',
        floeApp: 'com.floegence.redeven.agent',
        codeSpaceId: 'env-ui',
      });
      expect(connectArtifactEntryMock).toHaveBeenCalledTimes(1);
      expect(connectArtifactEntryMock).toHaveBeenCalledWith({
        endpointId: 'env_demo',
        floeApp: 'com.floegence.redeven.agent',
        entryTicket: 'ticket-1',
      });
      expect(artifact).toEqual({
        transport: 'tunnel',
        tunnel_grant: { channel_id: 'ch_remote' },
      });
    } finally {
      dispose();
    }
  });

  it('refuses to mint a remote connect artifact while the runtime is offline', async () => {
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
    getEnvironmentMock.mockResolvedValue({
      public_id: 'env_demo',
      name: 'Remote runtime',
      namespace_public_id: 'ns_remote',
      status: 'offline',
      lifecycle_status: 'running',
      permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();

      const input = host.querySelector('input[type="password"]') as HTMLInputElement | null;
      expect(input).toBeTruthy();
      input!.value = 'secret';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await flushAsync();
      await flushAsync();

      const remoteConnectConfig = connectMock.mock.calls[0]?.[0] as {
        source: { acquire: (context?: Readonly<{ traceId?: string; signal?: AbortSignal }>) => Promise<unknown> };
      };
      expect(remoteConnectConfig?.source.acquire).toEqual(expect.any(Function));

      getEnvironmentMock.mockClear();
      mintEnvProxyEntryTicketMock.mockClear();
      connectArtifactEntryMock.mockClear();

      await expect(remoteConnectConfig.source.acquire()).rejects.toThrow('Runtime is offline.');
      expect(getEnvironmentMock).toHaveBeenCalledTimes(1);
      expect(getEnvironmentMock).toHaveBeenCalledWith({ source: 'controlplane', envId: 'env_demo' });
      expect(mintEnvProxyEntryTicketMock).not.toHaveBeenCalled();
      expect(connectArtifactEntryMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('switches to waiting-for-agent mode after remote reconnect exhausts fast retries and probes again later', async () => {
    vi.useFakeTimers();
    getLocalRuntimeMock.mockResolvedValue(null);
    getEnvPublicIDFromSessionMock.mockReturnValue('env_demo');
    accessStatusMock.mockResolvedValue({ passwordRequired: false, unlocked: true });
    getEnvAppAccessStatusMock.mockReset();
    getEnvAppAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    let remoteRuntimeStatus = 'offline';
    getEnvironmentMock.mockImplementation(async () => ({
        public_id: 'env_demo',
        name: 'Remote runtime',
        namespace_public_id: 'ns_remote',
        status: remoteRuntimeStatus,
        lifecycle_status: 'running',
        permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true, is_owner: true },
      }));

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.querySelector('[data-testid="workbench-page"]')).toBeTruthy();
      protocolStatus = 'error';
      protocolClient = null;
      protocolError = { code: 'AGENT_OFFLINE', status: 503, message: 'Runtime is offline' };
      const observer = connectMock.mock.calls[0]?.[0]?.observer as {
        onDiagnosticEvent?: (event: Record<string, unknown>) => void;
      } | undefined;
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_attempt', result: 'retry', attempt_seq: 7 });
      observer?.onDiagnosticEvent?.({ stage: 'reconnect', code: 'reconnect_exhausted', result: 'fail', attempt_seq: 7 });
      await flushAsync();
      expect(host.querySelector('[data-testid="connection-recovery-view"]')).toBeTruthy();
      expect(host.textContent).toContain('1 attempt');
      expect(reconnectMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      await flushAsync();

      expect(getEnvironmentMock).toHaveBeenCalled();
      expect(reconnectMock).not.toHaveBeenCalled();

      remoteRuntimeStatus = 'online';
      await vi.advanceTimersByTimeAsync(3_000);
      await flushUntil(() => reconnectMock.mock.calls.length === 1);

      expect(reconnectMock).toHaveBeenCalledTimes(1);
      expect(protocolStatus).toBe('connected');
    } finally {
      dispose();
    }
  });

  it('migrates persisted deck mode to workbench and switches between activity and workbench on desktop', async () => {
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });
    const storage = createStorageMock();
    storage.setItem('redeven_envapp_desktop_view_mode', 'deck');
    vi.stubGlobal('localStorage', storage);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushUntil(() => Boolean(host.querySelector('[data-testid="workbench-page"]')), 40);

      const workbenchPage = host.querySelector('[data-testid="workbench-page"]');
      const workbenchView = host.querySelector('[data-testid="display-mode-view-workbench"]') as HTMLElement | null;
      expect(workbenchPage).toBeTruthy();
      expect(workbenchView?.style.display).toBe('block');
      expect(storage.getItem('redeven_envapp_desktop_view_mode')).toBe('workbench');

      findButtonByText(host, 'Activity')?.click();
      await flushUntil(() => host.textContent?.includes('activity main') ?? false);

      const activityMain = Array.from(host.querySelectorAll('div')).find((element) => element.textContent === 'activity main') ?? null;
      const activityView = host.querySelector('[data-testid="display-mode-view-activity"]') as HTMLElement | null;
      expect(host.textContent).toContain('activity main');
      expect(activityMain).toBeTruthy();
      expect(activityView?.style.display).toBe('block');
      expect(host.querySelector('[data-testid="workbench-page"]')).toBe(workbenchPage);
      expect(workbenchView?.style.display).toBe('none');

      findButtonByText(host, 'Workbench')?.click();
      await flushUntil(() => workbenchView?.style.display === 'block');

      expect(host.querySelector('[data-testid="workbench-page"]')).toBe(workbenchPage);
      expect(workbenchView?.style.display).toBe('block');
      expect(activityView?.style.display).toBe('none');
      expect(Array.from(host.querySelectorAll('div')).find((element) => element.textContent === 'activity main') ?? null).toBe(activityMain);
    } finally {
      dispose();
    }
  });

  it('forces activity mode on mobile and hides the mode switcher', async () => {
    layoutIsMobile = true;
    getLocalAccessStatusMock.mockResolvedValue({ password_required: false, unlocked: true });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const { EnvAppShell } = await import('./EnvAppShell');
    const dispose = render(() => <EnvAppShell />, host);

    try {
      await flushAsync();
      await flushAsync();

      expect(host.textContent).toContain('activity main');
      expect(host.querySelector('[data-testid="workbench-page"]')).toBeNull();
      expect(findButtonByText(host, 'Activity')).toBeUndefined();
      expect(findButtonByText(host, 'Workbench')).toBeUndefined();
    } finally {
      dispose();
    }
  });
});
