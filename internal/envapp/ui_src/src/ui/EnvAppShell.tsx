import { Show, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import {
  Activity,
  ActivityAppsMain,
  BottomBarItem,
  Copy,
  Code,
  Files,
  FloeRegistryRuntime,
  Grid,
  Grid3x3,
  LayoutDashboard,
  Moon,
  Panel,
  PanelContent,
  Refresh,
  Sparkles,
  Search,
  Shell,
  StatusIndicator,
  Sun,
  Terminal,
  Tooltip,
  type ActivityBarItem,
  type FloeComponent,
  useCommand,
  useLayout,
  useNotification,
  useTheme,
  useWidgetRegistry,
} from '@floegence/floe-webapp-core';
import type { ClientObserverLike } from '@floegence/flowersec-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { EnvContext, type EnvNavTab } from './pages/EnvContext';
import { EnvDeckPage } from './pages/EnvDeckPage';
import { EnvTerminalPage } from './pages/EnvTerminalPage';
import { EnvMonitorPage } from './pages/EnvMonitorPage';
import { EnvFileBrowserPage } from './pages/EnvFileBrowserPage';
import { EnvCodespacesPage } from './pages/EnvCodespacesPage';
import { EnvPluginMarketPage } from './pages/EnvPluginMarketPage';
import { EnvAIPage } from './pages/EnvAIPage';
import { redevenDeckWidgets } from './deck/redevenDeckWidgets';
import { useRedevenRpc } from './protocol/redeven_v1';
import { GrantAuditDialog } from './widgets/GrantAuditDialog';
import { getSandboxWindowInfo } from './services/sandboxWindowRegistry';
import {
  channelInitEntry,
  exchangeBrokerToEntryTicket,
  getBrokerTokenFromSession,
  getEnvPublicIDFromSession,
  getEnvironment,
  mintEnvEntryTicketForApp,
  type EnvironmentDetail,
} from './services/controlplaneApi';

const FLOE_APP_AGENT = 'com.floegence.redeven.agent';
const CODE_SPACE_ID_ENV_UI = 'env-ui';

const ACTIVE_TAB_STORAGE_KEY = 'redeven_envapp_active_tab';

function readPersistedActiveTab(): EnvNavTab | null {
  try {
    const v = String(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) ?? '').trim();
    if (
      v === 'deck' ||
      v === 'terminal' ||
      v === 'monitor' ||
      v === 'files' ||
      v === 'codespaces' ||
      v === 'market' ||
      v === 'ai'
    ) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

function persistActiveTab(tab: EnvNavTab): void {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

export function EnvAppShell() {
  const layout = useLayout();
  const theme = useTheme();
  const widgetRegistry = useWidgetRegistry();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const cmd = useCommand();
  const notify = useNotification();

  widgetRegistry.registerAll(redevenDeckWidgets);

  const [envId] = createSignal(getEnvPublicIDFromSession());

  const [env] = createResource<EnvironmentDetail | null, string | null>(
    () => envId() || null,
    (id) => (id ? getEnvironment(id) : null),
  );

  const [manualError, setManualError] = createSignal<string | null>(null);
  const [auditOpen, setAuditOpen] = createSignal(false);

  const [aiInjectionSeq, setAiInjectionSeq] = createSignal(0);
  const [aiInjectionMarkdown, setAiInjectionMarkdown] = createSignal<string | null>(null);

  const injectAiMarkdown = (markdown: string) => {
    setAiInjectionMarkdown(String(markdown ?? ''));
    setAiInjectionSeq((n) => n + 1);
  };

  const status = createMemo(() => (manualError() ? 'error' : protocol.status()));
  const connecting = () => protocol.status() === 'connecting';
  const connectError = createMemo(() => manualError() ?? protocol.error()?.message ?? null);

  const RECENT_AGENT_RX_MS = 10_000;
  const PROBE_TIMEOUT_MS = 1_200;

  let lastAgentRxAtMs = 0;
  const markAgentRx = () => {
    lastAgentRxAtMs = Date.now();
  };

  const observer: ClientObserverLike = {
    onRpcNotify: () => {
      markAgentRx();
    },
    onRpcCall: (result) => {
      // Only count results that prove we received a response envelope from the peer.
      if (result === 'ok' || result === 'rpc_error' || result === 'handler_not_found') {
        markAgentRx();
      }
    },
  };

  let ensureInFlight: Promise<void> | null = null;

  const createGetGrant = () => async () => {
    const id = envId();
    if (!id) throw new Error('Missing env context. Please reopen from the Redeven Portal.');

    const brokerToken = getBrokerTokenFromSession();
    if (!brokerToken) throw new Error('Missing broker token. Please reopen from the Redeven Portal.');

    // Probe agent status to avoid grant-audit spam while the agent is clearly offline.
    let agentStatus: string | null = null;
    try {
      const detail = await getEnvironment(id);
      // `status` is the only availability source of truth returned by the controlplane API.
      agentStatus = detail?.status ? String(detail.status) : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Missing broker token')) throw new Error(msg);
      // For transient failures (meta/network), continue with the grant flow below.
    }
    if (agentStatus && agentStatus !== 'online') {
      throw new Error(`Agent is ${agentStatus}.`);
    }

    const entryTicket = await exchangeBrokerToEntryTicket({
      endpointId: id,
      floeApp: FLOE_APP_AGENT,
      brokerToken,
      codeSpaceId: CODE_SPACE_ID_ENV_UI,
    });

    return channelInitEntry({ endpointId: id, floeApp: FLOE_APP_AGENT, entryTicket });
  };

  const connect = async () => {
    if (connecting()) return;

    const id = envId();
    if (!id) {
      setManualError('Missing env context. Please reopen from the Redeven Portal.');
      protocol.disconnect();
      return;
    }

    const brokerToken = getBrokerTokenFromSession();
    if (!brokerToken) {
      setManualError('Missing broker token. Please reopen from the Redeven Portal.');
      protocol.disconnect();
      return;
    }

    setManualError(null);

    try {
      await protocol.connect({
        mode: 'tunnel',
        getGrant: createGetGrant(),
        observer,
        autoReconnect: {
          enabled: true,
          // Env App should be resilient to agent restarts and transient network issues.
          maxAttempts: 1_000_000,
          initialDelayMs: 500,
          maxDelayMs: 30_000,
        },
      });
    } catch {
      // protocol.error() will expose the last failure; avoid noisy rethrows here.
    }
  };

  const probe = async (): Promise<boolean> => {
    const startedAt = Date.now();

    const p = rpc.sys.ping();
    // If we timeout and then close the client (by reconnecting), the original ping promise
    // might reject later; attach a handler to avoid unhandled rejections.
    p.catch(() => {
    });

    let timer: number | undefined;
    try {
      await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
        }),
      ]);
      console.debug('[envapp] health probe ok', { ms: Date.now() - startedAt });
      return true;
    } catch (e) {
      console.debug('[envapp] health probe failed', {
        ms: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      if (typeof timer !== 'undefined') window.clearTimeout(timer);
    }
  };

  const ensureHealthy = (reason: string) => {
    if (ensureInFlight) return ensureInFlight;

    ensureInFlight = (async () => {
      if (connecting()) return;

      const st = protocol.status();
      const client = protocol.client();
      if (st !== 'connected' || !client) {
        console.debug('[envapp] ensureHealthy: connect', { reason, status: st });
        await connect();
        return;
      }

      const now = Date.now();
      const lastRxAgeMs = lastAgentRxAtMs > 0 ? now - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (lastRxAgeMs <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: recent rx; skip', { reason, lastRxAgeMs });
        return;
      }

      console.debug('[envapp] ensureHealthy: probing', { reason, lastRxAgeMs });
      const ok = await probe();
      if (ok) return;

      const rxAgeAfterProbe = lastAgentRxAtMs > 0 ? Date.now() - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (rxAgeAfterProbe <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: rx during probe; skip reconnect', { reason, rxAgeAfterProbe });
        return;
      }

      console.debug('[envapp] ensureHealthy: reconnect', { reason });
      await connect();
    })().finally(() => {
      ensureInFlight = null;
    });

    return ensureInFlight;
  };

  onMount(() => {
    layout.setSidebarCollapsed(true);
    const preferred = readPersistedActiveTab();
    const initial = (() => {
      if (preferred) {
        if (layout.isMobile() && preferred === 'deck') return 'terminal';
        return preferred;
      }
      return layout.isMobile() ? 'terminal' : 'deck';
    })();
    layout.setSidebarActiveTab(initial, { openSidebar: false });
    void connect();
  });

  onCleanup(() => {
    protocol.disconnect();
  });

  // Cross-window handshake: allow non-Env App sandbox windows (codespaces/3rd-party apps) to
  // request a fresh entry_ticket after refresh, without leaking broker_token outside the Env App origin.
  onMount(() => {
    const onMessage = (ev: MessageEvent) => {
      const data: any = ev.data;
      if (!data || typeof data !== 'object') return;
      if (String(data.type ?? '') !== 'redeven:boot_ready') return;

      const payload: any = data.payload;
      const floeApp = String(payload?.floe_app ?? '').trim();
      const codeSpaceID = String(payload?.code_space_id ?? '').trim();
      if (!floeApp || !codeSpaceID) return;

      const info = getSandboxWindowInfo(ev.source);
      if (!info) return;
      if (ev.origin !== info.origin) return;
      if (floeApp !== info.floe_app || codeSpaceID !== info.code_space_id) return;

      const envPublicID = envId();
      if (!envPublicID) return;

      void (async () => {
        try {
          const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp, codeSpaceId: codeSpaceID });
          (ev.source as Window).postMessage(
            {
              type: 'redeven:boot_init',
              payload: {
                v: 1,
                env_public_id: envPublicID,
                floe_app: floeApp,
                code_space_id: codeSpaceID,
                app_path: info.app_path,
                entry_ticket: entryTicket,
              },
            },
            info.origin,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          notify.error('Failed to refresh session', msg);
        }
      })();
    };

    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  // Ensure the tunnel is healthy after common browser lifecycle transitions.
  onMount(() => {
    const onOnline = () => void ensureHealthy('online');
    const onFocus = () => void ensureHealthy('focus');
    const onVisibility = () => {
      if (!document.hidden) void ensureHealthy('visibility');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    onCleanup(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  const components: FloeComponent[] = [
    { id: 'deck', name: 'Deck', icon: LayoutDashboard, component: EnvDeckPage, sidebar: { order: 1, fullScreen: true } },
    { id: 'terminal', name: 'Terminal', icon: Terminal, component: EnvTerminalPage, sidebar: { order: 2, fullScreen: true } },
    { id: 'monitor', name: 'Monitoring', icon: Activity, component: EnvMonitorPage, sidebar: { order: 3, fullScreen: true } },
    { id: 'files', name: 'File Browser', icon: Files, component: EnvFileBrowserPage, sidebar: { order: 4, fullScreen: true } },
    { id: 'codespaces', name: 'Codespaces', icon: Code, component: EnvCodespacesPage, sidebar: { order: 5, fullScreen: true } },
    { id: 'market', name: 'Plugin Market', icon: Grid, component: EnvPluginMarketPage, sidebar: { order: 6, fullScreen: true } },
    { id: 'ai', name: 'AI', icon: Sparkles, component: EnvAIPage, sidebar: { order: 7, fullScreen: true } },
  ];

  const goTab = (tab: EnvNavTab) => {
    // Persist the user's preference; the runtime may downgrade it on mobile (deck -> terminal).
    persistActiveTab(tab);
    let next = tab;
    if (layout.isMobile() && next === 'deck') next = 'terminal';
    layout.setSidebarActiveTab(next, { openSidebar: false });
  };

  const activityItems = (): ActivityBarItem[] => {
    const items: ActivityBarItem[] = [];

    if (!layout.isMobile()) {
      items.push({ id: 'deck', icon: LayoutDashboard, label: 'Deck', onClick: () => goTab('deck') });
    }
    items.push(
      { id: 'terminal', icon: Terminal, label: 'Terminal', onClick: () => goTab('terminal') },
      { id: 'monitor', icon: Activity, label: 'Monitoring', onClick: () => goTab('monitor') },
      { id: 'files', icon: Files, label: 'File Browser', onClick: () => goTab('files') },
      { id: 'codespaces', icon: Code, label: 'Codespaces', onClick: () => goTab('codespaces') },
      { id: 'market', icon: Grid, label: 'Plugin Market', onClick: () => goTab('market') },
      { id: 'ai', icon: Sparkles, label: 'AI', onClick: () => goTab('ai') },
    );
    return items;
  };

  const envName = () => {
    if (env.state !== 'ready') return 'Loading...';
    return env()?.name || 'Environment';
  };

  function portalOrigin(): string {
    // The Env App runs on a sandbox subdomain (env-<env_id>.<region>.<base>),
    // while the Portal is on the region root domain (<region>.<base>).
    const proto = window.location.protocol;
    const host = window.location.hostname.trim().toLowerCase();
    const port = window.location.port ? `:${window.location.port}` : '';
    const parts = host.split('.');
    // sandbox origin always has an extra label (sandbox_id.<region>.<base>).
    if (parts.length >= 4) {
      parts.shift();
      return `${proto}//${parts.join('.')}${port}`;
    }
    return `${proto}//${host}${port}`;
  }

  // Env App command palette commands (navigation + common actions).
  // Note: register commands once per Shell lifecycle to avoid duplicates during HMR/remount.
  onMount(() => {
    const unregister = cmd.registerAll([
      {
        id: 'redeven.env.goToDeck',
        title: 'Go to Deck',
        description: 'Open the deck view',
        category: 'Navigation',
        keybind: 'mod+shift+d',
        icon: LayoutDashboard,
        execute: () => goTab('deck'),
      },
      {
        id: 'redeven.env.goToTerminal',
        title: 'Go to Terminal',
        description: 'Open the terminal',
        category: 'Navigation',
        keybind: 'mod+shift+t',
        icon: Terminal,
        execute: () => goTab('terminal'),
      },
      {
        id: 'redeven.env.goToMonitoring',
        title: 'Go to Monitoring',
        description: 'Open monitoring',
        category: 'Navigation',
        keybind: 'mod+shift+m',
        icon: Activity,
        execute: () => goTab('monitor'),
      },
      {
        id: 'redeven.env.goToFiles',
        title: 'Go to File Browser',
        description: 'Browse remote files',
        category: 'Navigation',
        keybind: 'mod+shift+f',
        icon: Files,
        execute: () => goTab('files'),
      },
      {
        id: 'redeven.env.goToCodespaces',
        title: 'Go to Codespaces',
        description: 'Open codespaces',
        category: 'Navigation',
        keybind: 'mod+shift+c',
        icon: Code,
        execute: () => goTab('codespaces'),
      },
      {
        id: 'redeven.env.goToMarket',
        title: 'Go to Plugin Market',
        description: 'Browse plugins',
        category: 'Navigation',
        keybind: 'mod+shift+p',
        icon: Grid,
        execute: () => goTab('market'),
      },
      {
        id: 'redeven.env.backToEnvironments',
        title: 'Back to Environments',
        description: 'Return to the environments list',
        category: 'Navigation',
        keybind: 'mod+shift+e',
        icon: Grid3x3,
        execute: () => window.location.assign(`${portalOrigin()}/`),
      },
      {
        id: 'redeven.env.reconnect',
        title: 'Reconnect',
        description: 'Reconnect to the environment tunnel',
        category: 'Environment',
        keybind: 'mod+shift+r',
        icon: Refresh,
        execute: () => {
          void connect();
        },
      },
      {
        id: 'redeven.env.copyEnvId',
        title: 'Copy Environment ID',
        description: 'Copy the environment id to clipboard',
        category: 'Environment',
        icon: Copy,
        execute: async () => {
          const id = envId() || '';
          if (!id) {
            notify.error('Copy failed', 'Missing environment id');
            return;
          }

          try {
            await navigator.clipboard.writeText(id);
            notify.success('Copied', 'Environment id copied to clipboard');
          } catch {
            notify.error('Copy failed', 'Clipboard permission denied');
          }
        },
      },
      {
        id: 'redeven.env.toggleTheme',
        title: 'Toggle Theme',
        description: 'Switch between light and dark theme',
        category: 'View',
        keybind: 'mod+shift+l',
        icon: () => (theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />),
        execute: () => {
          theme.toggleTheme();
          const nextTheme = theme.resolvedTheme() === 'light' ? 'dark' : 'light';
          notify.info('Theme changed', `Switched to ${nextTheme} theme`);
        },
      },
      {
        id: 'redeven.env.openCommandPalette',
        title: 'Open Command Palette',
        description: 'Open the command palette',
        category: 'General',
        keybind: 'mod+k',
        icon: Search,
        execute: () => cmd.open(),
      },
    ]);

    onCleanup(() => unregister());
  });

  return (
    <EnvContext.Provider
      value={{
        env_id: envId,
        env,
        connect,
        connecting,
        connectError,
        goTab,
        aiInjectionSeq,
        aiInjectionMarkdown,
        injectAiMarkdown,
      }}
    >
      <FloeRegistryRuntime components={components}>
        <Shell
          sidebarMode="hidden"
          logo={
            <Tooltip content="Back to environments" placement="bottom" delay={0}>
              <button
                type="button"
                class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                onClick={() => window.location.assign(`${portalOrigin()}/`)}
                aria-label="Back to environments"
              >
                <img src="/logo.png" alt="Redeven" class="w-6 h-6 object-contain" />
              </button>
            </Tooltip>
          }
          activityItems={activityItems()}
          topBarActions={
            <div class="flex items-center gap-1">
              <Tooltip content="Command palette" placement="bottom" delay={0}>
                <button
                  type="button"
                  class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => cmd.open()}
                  aria-label="Command palette"
                >
                  <Search class="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip content="Toggle theme" placement="bottom" delay={0}>
                <button
                  type="button"
                  class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => theme.toggleTheme()}
                  aria-label="Toggle theme"
                >
                  {theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />}
                </button>
              </Tooltip>
            </div>
          }
          bottomBarItems={
            <>
              <div class="flex items-center gap-2 min-w-0">
                <BottomBarItem class="min-w-0">
                  <span class="truncate">{envName()}</span>
                </BottomBarItem>
                <BottomBarItem class="min-w-0">
                  <span class="truncate">{envId() || '(missing env id)'}</span>
                </BottomBarItem>
              </div>
              <div class="flex items-center gap-2">
                <StatusIndicator status={status()} />
                <BottomBarItem onClick={() => setAuditOpen(true)}>Audit log</BottomBarItem>
                <BottomBarItem
                  onClick={connecting() ? undefined : () => void connect()}
                  class={connecting() ? 'opacity-60 pointer-events-none' : undefined}
                >
                  {connecting() ? 'Connecting...' : 'Reconnect'}
                </BottomBarItem>
              </div>
            </>
          }
        >
          <div class="h-full min-h-0 overflow-hidden flex flex-col">
            <Show when={connectError()}>
              <Panel class="h-auto rounded-none border-0 border-b border-error/40">
                <PanelContent class="p-3 text-xs">
                  <div class="text-error font-medium">Connection failed</div>
                  <div class="text-muted-foreground break-words">{connectError()}</div>
                </PanelContent>
              </Panel>
            </Show>

            <div class="flex-1 min-h-0 overflow-hidden relative">
              <ActivityAppsMain activeId={() => layout.sidebarActiveTab()} />
            </div>
          </div>

          <GrantAuditDialog open={auditOpen()} envId={envId()} onClose={() => setAuditOpen(false)} />
        </Shell>
      </FloeRegistryRuntime>
    </EnvContext.Provider>
  );
}
