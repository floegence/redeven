import { Index, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { useCurrentWidgetId, useNotification, useResolvedFloeConfig, useTheme, useViewActivation } from '@floegence/floe-webapp-core';
import { Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Dropdown, type DropdownItem, Input, NumberInput, Tabs, TabPanel, type TabItem } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useRedevenRpc } from '../protocol/redeven_v1';
import {
  TerminalCore,
  getDefaultTerminalConfig,
  getThemeColors,
  type Logger,
  type TerminalEventSource,
  type TerminalResponsiveConfig,
  type TerminalSessionInfo,
  type TerminalThemeName,
  type TerminalTransport,
} from '@floegence/floeterm-terminal-web';
import {
  createRedevenTerminalEventSource,
  createRedevenTerminalTransport,
  getOrCreateTerminalConnId,
} from '../services/terminalTransport';
import { disposeRedevenTerminalSessionsCoordinator, getRedevenTerminalSessionsCoordinator } from '../services/terminalSessions';
import {
  ensureTerminalPreferencesInitialized,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
  useTerminalPreferences,
} from '../services/terminalPreferences';
import { useEnvContext } from '../pages/EnvContext';
import { isPermissionDeniedError } from '../utils/permission';
import { PermissionEmptyState } from './PermissionEmptyState';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { normalizeVirtualPath as normalizeAskFlowerVirtualPath } from '../utils/askFlowerPath';

type session_loading_state = 'idle' | 'initializing' | 'attaching' | 'loading_history';

export type TerminalPanelVariant = 'panel' | 'deck';

export interface TerminalPanelProps {
  variant?: TerminalPanelVariant;
}

type TerminalPanelInnerProps = TerminalPanelProps & {
  onExecuteDenied?: () => void;
};

function buildActiveSessionStorageKey(panelId: string): string {
  return `redeven_terminal_active_session_id:${panelId}`;
}

function readActiveSessionId(storageKey: string): string | null {
  try {
    const v = sessionStorage.getItem(storageKey);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function writeActiveSessionId(storageKey: string, id: string | null) {
  try {
    if (id && id.trim()) {
      sessionStorage.setItem(storageKey, id.trim());
      return;
    }
    sessionStorage.removeItem(storageKey);
  } catch {
  }
}

function pickPreferredActiveId(list: TerminalSessionInfo[], preferredId: string | null): string | null {
  if (preferredId && list.some((s) => s.id === preferredId)) return preferredId;
  const active = list.find((s) => s.isActive);
  if (active) return active.id;
  const byLastActive = [...list].sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0));
  return byLastActive[0]?.id ?? null;
}

function buildLogger(): Logger {
  return {
    debug: (message, meta) => (typeof meta === 'undefined' ? console.debug(message) : console.debug(message, meta)),
    info: (message, meta) => (typeof meta === 'undefined' ? console.info(message) : console.info(message, meta)),
    warn: (message, meta) => (typeof meta === 'undefined' ? console.warn(message) : console.warn(message, meta)),
    error: (message, meta) => (typeof meta === 'undefined' ? console.error(message) : console.error(message, meta)),
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

type terminal_session_view_props = {
  session: TerminalSessionInfo;
  active: () => boolean;
  connected: () => boolean;
  protocolClient: () => unknown;
  viewActive: () => boolean;
  autoFocus: () => boolean;
  themeName: () => TerminalThemeName;
  themeColors: () => Record<string, string>;
  fontSize: () => number;
  fontFamily: () => string;
  connId: string;
  transport: TerminalTransport;
  eventSource: TerminalEventSource;
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerActions: (sessionId: string, actions: { reload: () => Promise<void> } | null) => void;
  onNameUpdate?: (sessionId: string, newName: string, workingDir: string) => void;
};

const TERMINAL_THEME_ITEMS: DropdownItem[] = [
  { id: 'system', label: 'System Theme' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'solarizedDark', label: 'Solarized Dark' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'tokyoNight', label: 'Tokyo Night' },
];

const HISTORY_STATS_POLL_MS = 10_000;
const MAX_INLINE_TERMINAL_SELECTION_CHARS = 10_000;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const TERMINAL_SELECTION_BACKGROUND = 'rgba(255, 234, 0, 0.72)';
const TERMINAL_SELECTION_FOREGROUND = '#000000';

const TERMINAL_FONT_OPTIONS: Array<{ id: string; label: string; family: string }> = [
  {
    id: 'iosevka',
    label: 'Iosevka',
    family: '"Iosevka", "JetBrains Mono", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", "Iosevka", "SF Mono", Menlo, Monaco, monospace',
  },
  {
    id: 'sfmono',
    label: 'SF Mono',
    family: '"SF Mono", Menlo, Monaco, "JetBrains Mono", "Iosevka", monospace',
  },
  {
    id: 'menlo',
    label: 'Menlo',
    family: 'Menlo, Monaco, "SF Mono", "JetBrains Mono", "Iosevka", monospace',
  },
  {
    id: 'monaco',
    label: 'Monaco',
    family: 'Monaco, Menlo, "SF Mono", "JetBrains Mono", "Iosevka", monospace',
  },
];

const PlusIcon = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const RefreshIcon = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

const MoreVerticalIcon = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
  >
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </svg>
);

function TerminalSessionView(props: terminal_session_view_props) {
  const sessionId = () => props.session.id;
  const colors = () => props.themeColors();
  const fontSize = () => props.fontSize();
  const fontFamily = () => props.fontFamily();
  const [loading, setLoading] = createSignal<session_loading_state>('initializing');
  const [error, setError] = createSignal<string | null>(null);
  const [readyOnce, setReadyOnce] = createSignal(false);

  const [showLoading, setShowLoading] = createSignal(false);
  let loadingDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const isLoading = loading() !== 'idle';
    if (loadingDebounceTimer) {
      clearTimeout(loadingDebounceTimer);
      loadingDebounceTimer = null;
    }
    if (isLoading) {
      loadingDebounceTimer = setTimeout(() => {
        setShowLoading(true);
      }, 150);
    } else {
      setShowLoading(false);
    }
  });

  onCleanup(() => {
    if (loadingDebounceTimer) {
      clearTimeout(loadingDebounceTimer);
    }
  });

  let container: HTMLDivElement | null = null;
  let term: TerminalCore | null = null;
  let unsubData: (() => void) | null = null;
  let unsubNameUpdate: (() => void) | null = null;

  let didApplyTheme = false;

  let historyMaxSeq = 0;
  let replaying = false;
  let bufferedLive: Array<{ sequence?: number; data: Uint8Array }> = [];

  let queued: Uint8Array[] = [];
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
      flushScheduled = false;
      const batch = queued.splice(0, 20);
      for (const chunk of batch) {
        term?.write(chunk);
      }
      if (queued.length > 0) scheduleFlush();
    });
  };

  const clearOutputSubscription = () => {
    unsubData?.();
    unsubData = null;
    unsubNameUpdate?.();
    unsubNameUpdate = null;
  };

  const replayHistory = async (chunks: Uint8Array[]) => {
    const core = term;
    if (!core) return;

    core.clear();
    if (chunks.length === 0) return;

    core.startHistoryReplay(5000);

    await new Promise<void>((resolve) => {
      let i = 0;
      const step = () => {
        const end = Math.min(i + 20, chunks.length);
        for (; i < end; i += 1) {
          core.write(chunks[i]!);
        }
        if (i < chunks.length) {
          requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      requestAnimationFrame(step);
    });

    core.endHistoryReplay();
  };

  let reloadSeq = 0;
  const disposeTerminal = () => {
    clearOutputSubscription();
    term?.dispose();
    term = null;
    queued = [];
    flushScheduled = false;
    bufferedLive = [];
    replaying = false;
    historyMaxSeq = 0;
    setReadyOnce(false);
    props.registerCore(sessionId(), null);
  };

  let initSeq = 0;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const reload = async (opts?: { fadeOut?: boolean }) => {
    const id = sessionId();
    if (!id) return;
    if (!props.connected()) return;
    if (!container) return;

    const seq = ++reloadSeq;

    // Keep the surface hidden until the new terminal is attached and history is replayed (same as page open).
    setError(null);
    setLoading('initializing');

    if (opts?.fadeOut) {
      container.style.opacity = '0';
      await sleep(150);
      if (seq !== reloadSeq) return;
    }

    // Cancel any in-flight init and dispose the previous core before rebuilding.
    initSeq += 1;
    disposeTerminal();

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (seq !== reloadSeq) return;
    if (!props.connected()) return;
    if (!container) return;

    try {
      await initOnce();
    } catch (e) {
      setLoading('idle');
      setError(e instanceof Error ? e.message : String(e));
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  createEffect(() => {
    const id = sessionId();
    if (!id) return;
    props.registerActions(id, { reload: () => reload() });
    onCleanup(() => {
      props.registerActions(id, null);
    });
  });

  const initOnce = async () => {
    const id = sessionId();
    const target = container;
    if (!target) throw new Error('Terminal not mounted');

    const seq = ++initSeq;
    setError(null);
    setLoading('initializing');

    const core = new TerminalCore(
      target,
      getDefaultTerminalConfig('dark', {
        fontSize: fontSize(),
        allowTransparency: false,
        theme: colors(),
        fontFamily: fontFamily(),
        // When multiple views/panels show the same terminal session, only the focused terminal should emit remote resize.
        // This prevents hidden terminals from locking the remote PTY cols/rows to an inactive size.
        responsive: {
          fitOnFocus: true,
          emitResizeOnFocus: true,
          notifyResizeOnlyWhenFocused: true,
        } satisfies TerminalResponsiveConfig,
      }),
      {
        onData: (data: string) => {
          if (!props.viewActive() || !props.active()) return;
          void props.transport.sendInput(id, data, props.connId);
        },
        onResize: (size: { cols: number; rows: number }) => {
          if (!props.viewActive() || !props.active()) return;
          void props.transport.resize(id, size.cols, size.rows);
        },
        onError: (e: Error) => {
          setError(e.message);
        },
      },
      buildLogger(),
    );

    term = core;
    props.registerCore(id, core);

    try {
      await core.initialize();
      if (seq !== initSeq) return;

      // After core.initialize(), the underlying terminal instance is ready: re-register to keep the outer registry consistent.
      props.registerCore(id, core);

      core.setTheme(colors());
      core.forceResize();

      clearOutputSubscription();
      historyMaxSeq = 0;
      replaying = true;
      bufferedLive = [];
      unsubData = props.eventSource.onTerminalData(id, (ev) => {
        if (replaying) {
          bufferedLive.push({ sequence: ev.sequence, data: ev.data });
          return;
        }
        if (typeof ev.sequence === 'number' && ev.sequence > 0 && ev.sequence <= historyMaxSeq) return;
        queued.push(ev.data);
        scheduleFlush();
      });

      if (props.eventSource.onTerminalNameUpdate) {
        unsubNameUpdate = props.eventSource.onTerminalNameUpdate(id, (ev) => {
          props.onNameUpdate?.(ev.sessionId, ev.newName, ev.workingDir);
        });
      }

      setLoading('attaching');
      const dims = core.getDimensions();
      await props.transport.attach(id, dims.cols, dims.rows);
      if (seq !== initSeq) return;

      setLoading('loading_history');
      const history = await props.transport.history(id, 0, -1);
      if (seq !== initSeq) return;

      const sorted = [...history].sort((a, b) => a.sequence - b.sequence);
      historyMaxSeq = sorted.length > 0 ? sorted[sorted.length - 1]!.sequence : 0;

      await replayHistory(sorted.map((c) => c.data));
      if (seq !== initSeq) return;

      replaying = false;
      const liveSorted = [...bufferedLive]
        .filter((c) => typeof c.sequence !== 'number' || c.sequence <= 0 || c.sequence > historyMaxSeq)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      bufferedLive = [];
      for (const c of liveSorted) {
        queued.push(c.data);
      }
      if (queued.length > 0) scheduleFlush();

      setLoading('idle');
      setReadyOnce(true);

      requestAnimationFrame(() => {
        core.forceResize();
        if (props.viewActive() && props.active() && props.autoFocus()) core.focus();
        const el = container;
        if (el && el.style.opacity !== '1') {
          el.style.opacity = '1';
        }
      });
    } catch (e) {
      if (seq !== initSeq) return;
      setLoading('idle');
      setError(e instanceof Error ? e.message : String(e));
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  createEffect(() => {
    const client = props.protocolClient();
    if (!client) return;
    if (!container) return;

    // Untrack to avoid capturing theme/font reactivity as init dependencies.
    untrack(() => void reload());
  });

  createEffect(() => {
    void props.themeName();
    if (!didApplyTheme) {
      didApplyTheme = true;
      return;
    }
    if (!term) return;

    untrack(() => void reload({ fadeOut: true }));
  });

  createEffect(() => {
    if (!props.viewActive() || !props.active()) return;
    const core = term;
    if (!core) return;
    requestAnimationFrame(() => {
      core.setTheme(colors());
      core.setFontSize(fontSize());
      core.forceResize();
      if (props.autoFocus()) core.focus();
    });
  });

  createEffect(() => {
    if (!term) return;
    term.setFontSize(fontSize());
    term.forceResize();
  });

  createEffect(() => {
    if (!term) return;
    // TerminalCore does not expose setFontFamily yet; pass through to ghostty-web options (a Proxy) to trigger re-layout.
    const anyCore = term as any;
    const inner = anyCore?.terminal;
    if (inner?.options) {
      inner.options.fontFamily = fontFamily();
      term.forceResize();
    }
  });

  onCleanup(() => {
    initSeq += 1;
    reloadSeq += 1;
    disposeTerminal();
    props.registerCore(sessionId(), null);
  });

  const terminalBackground = () => colors().background ?? '#1e1e1e';
  const terminalForeground = () => colors().foreground ?? '#c9d1d9';

  return (
    <div
      class="h-full min-h-0 relative overflow-hidden"
      style={{
        'background-color': terminalBackground(),
        '--background': terminalBackground(),
        '--primary': terminalForeground(),
        '--muted': `color-mix(in srgb, ${terminalForeground()} 12%, ${terminalBackground()})`,
        '--muted-foreground': `color-mix(in srgb, ${terminalForeground()} 70%, transparent)`,
      }}
    >
      <div
        ref={(n) => (container = n)}
        class="absolute top-2 left-2 right-0 bottom-0 redeven-terminal-surface"
        style={{
          transition: 'opacity 0.15s ease-out',
          opacity: readyOnce() ? (showLoading() ? '0' : '1') : (loading() === 'idle' ? '1' : '0'),
        }}
      />

      <LoadingOverlay
        visible={showLoading()}
        message={
          loading() === 'initializing' ? 'Initializing terminal...' :
          loading() === 'attaching' ? 'Attaching terminal...' :
          loading() === 'loading_history' ? 'Loading history...' :
          undefined
        }
      />

      <Show when={error()}>
        <div
          class="absolute left-3 right-3 bottom-3 text-[11px] px-2 py-1 rounded border border-border text-error break-words"
          style={{ 'background-color': `color-mix(in srgb, ${terminalBackground()} 80%, transparent)` }}
        >
          {error()}
        </div>
      </Show>
    </div>
  );
}

function TerminalPanelInner(props: TerminalPanelInnerProps = {}) {
  const variant: TerminalPanelVariant = props.variant ?? 'panel';
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const notify = useNotification();
  const theme = useTheme();
  const floe = useResolvedFloeConfig();
  const view = useViewActivation();
  const widgetId = (() => {
    try {
      return useCurrentWidgetId();
    } catch {
      return null;
    }
  })();
  const connId = getOrCreateTerminalConnId();
  const panelId = (() => {
    const wid = String(widgetId ?? '').trim();
    return wid ? `deck:${wid}` : 'terminal_page';
  })();
  const activeSessionStorageKey = buildActiveSessionStorageKey(panelId);

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResultCount, setSearchResultCount] = createSignal(0);
  const [searchResultIndex, setSearchResultIndex] = createSignal(-1);
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [terminalAskMenu, setTerminalAskMenu] = createSignal<{
    x: number;
    y: number;
    workingDir: string;
    selection: string;
  } | null>(null);
  let terminalAskMenuEl: HTMLDivElement | null = null;

  let searchLastAppliedKey = '';
  let searchBoundCore: TerminalCore | null = null;

  ensureTerminalPreferencesInitialized(floe.persist);
  const terminalPrefs = useTerminalPreferences();

  const transport = createRedevenTerminalTransport(rpc, connId);
  const eventSource = createRedevenTerminalEventSource(rpc);
  const sessionsCoordinator = getRedevenTerminalSessionsCoordinator({ connId, transport, logger: buildLogger() });

  const connected = () => Boolean(protocol.client());
  const viewActive = () => view.active();
  const isInDeckWidget = Boolean(String(widgetId ?? '').trim());

  createEffect(() => {
    if (viewActive()) return;
    // Reset focus state when the view becomes inactive to avoid stale focus affecting autoFocus decisions.
    setPanelHasFocus(false);
  });

  createEffect(() => {
    const menu = terminalAskMenu();
    if (!menu) return;

    const closeMenu = () => {
      setTerminalAskMenu(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        closeMenu();
        return;
      }
      if (terminalAskMenuEl?.contains(target)) return;
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

  const userTheme = terminalPrefs.userTheme;
  const fontSize = terminalPrefs.fontSize;
  const fontFamilyId = terminalPrefs.fontFamilyId;

  const fontFamily = createMemo<string>(() => {
    const id = fontFamilyId();
    return TERMINAL_FONT_OPTIONS.find((o) => o.id === id)?.family ?? TERMINAL_FONT_OPTIONS[0]!.family;
  });

  const persistFontSize = (value: number) => {
    terminalPrefs.setFontSize(value);
  };

  const persistFontFamily = (id: string) => {
    terminalPrefs.setFontFamily(id);
  };

  const terminalThemeName = createMemo<TerminalThemeName>(() => {
    const selected = userTheme();
    if (selected === 'system') {
      return theme.resolvedTheme() === 'light' ? 'light' : 'dark';
    }
    return selected as TerminalThemeName;
  });

  const terminalThemeColors = createMemo<Record<string, string>>(() => {
    // Unify and slightly brighten selection colors to keep readability consistent across themes.
    return {
      ...getThemeColors(terminalThemeName()),
      selectionBackground: TERMINAL_SELECTION_BACKGROUND,
      selectionForeground: TERMINAL_SELECTION_FOREGROUND,
      selection: TERMINAL_SELECTION_BACKGROUND,
    } as Record<string, string>;
  });

  const [sessions, setSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = createSignal(false);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(readActiveSessionId(activeSessionStorageKey));
  const [mountedSessionIds, setMountedSessionIds] = createSignal<Set<string>>(new Set());
  const [error, setError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);

  const handleExecuteDenied = (e: unknown): boolean => {
    if (!isPermissionDeniedError(e, 'execute')) return false;
    props.onExecuteDenied?.();
    return true;
  };

  const [historyBytes, setHistoryBytes] = createSignal<number | null>(null);

  const coreRegistry = new Map<string, TerminalCore>();
  const actionsRegistry = new Map<string, { reload: () => Promise<void> }>();

  const [coreRegistrySeq, setCoreRegistrySeq] = createSignal(0);

  const registerCore = (id: string, core: TerminalCore | null) => {
    if (!id) return;
    if (core) {
      coreRegistry.set(id, core);
      core.setTheme(terminalThemeColors());
      core.setFontSize(fontSize());
      const anyCore = core as any;
      const inner = anyCore?.terminal;
      if (inner?.options) {
        inner.options.fontFamily = fontFamily();
      }
      setCoreRegistrySeq((v) => v + 1);
      return;
    }
    coreRegistry.delete(id);
    setCoreRegistrySeq((v) => v + 1);
  };

  const registerActions = (id: string, actions: { reload: () => Promise<void> } | null) => {
    if (!id) return;
    if (actions) {
      actionsRegistry.set(id, actions);
      return;
    }
    actionsRegistry.delete(id);
  };

  const handleNameUpdate = (sessionId: string, newName: string, workingDir: string) => {
    sessionsCoordinator.updateSessionMeta(sessionId, { name: newName, workingDir });
  };

  const handleThemeChange = (value: string) => {
    terminalPrefs.setUserTheme(value);
  };

  let prevSessionsSnapshot: TerminalSessionInfo[] = [];
  const handleSessionsSnapshot = (next: TerminalSessionInfo[]) => {
    const prev = prevSessionsSnapshot;
    prevSessionsSnapshot = next;

    setSessions(next);

    const currentActive = activeSessionId();
    if (currentActive && next.some((s) => s.id === currentActive)) {
      return;
    }

    let nextActive: string | null = null;
    if (currentActive) {
      const prevIdx = prev.findIndex((s) => s.id === currentActive);
      if (prevIdx >= 0) {
        nextActive = next[prevIdx]?.id ?? next[prevIdx - 1]?.id ?? null;
      }
    }

    if (!nextActive) {
      nextActive = pickPreferredActiveId(next, null);
    }

    setActiveSessionId(nextActive);
  };

  createEffect(() => {
    const unsub = sessionsCoordinator.subscribe(handleSessionsSnapshot);
    onCleanup(() => unsub());
  });

  createEffect(() => {
    const size = fontSize();
    for (const core of coreRegistry.values()) {
      core.setFontSize(size);
    }
  });

  createEffect(() => {
    const family = fontFamily();
    for (const core of coreRegistry.values()) {
      const anyCore = core as any;
      const inner = anyCore?.terminal;
      if (inner?.options) {
        inner.options.fontFamily = family;
      }
    }
  });

  const shouldAutoFocus = () => !isInDeckWidget || panelHasFocus();

  createEffect(() => {
    const sid = activeSessionId();
    const isConnected = connected();
    if (!isConnected || !sid) {
      setHistoryBytes(null);
      return;
    }

    setHistoryBytes(null);

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const stats = await transport.getSessionStats(sid);
        if (cancelled) return;
        setHistoryBytes(stats.history.totalBytes);
      } catch {
      }
    };

    void refresh();
    if (HISTORY_STATS_POLL_MS > 0) {
      timer = setInterval(() => void refresh(), HISTORY_STATS_POLL_MS);
    }

    onCleanup(() => {
      cancelled = true;
      if (timer) clearInterval(timer);
    });
  });

  const refreshSessions = async () => {
    if (!connected()) return;
    setSessionsLoading(true);
    try {
      await sessionsCoordinator.refresh();
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionsLoading(false);
    }
  };

  const createSession = async () => {
    if (!connected()) return;
    setCreating(true);
    setError(null);
    try {
      const nextIndex = (sessions()?.length ?? 0) + 1;
      const session = await sessionsCoordinator.createSession(`Terminal ${nextIndex}`, '/', 80, 24);
      if (!session?.id) throw new Error('Invalid create response');

      setActiveSessionId(session.id);
      setMountedSessionIds((prev) => {
        if (prev.has(session.id)) return prev;
        const next = new Set(prev);
        next.add(session.id);
        return next;
      });
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const clearActive = async () => {
    const sid = activeSessionId();
    if (!sid) return;
    setError(null);

    coreRegistry.get(sid)?.clear();
    try {
      await transport.clear(sid);
      await transport.sendInput(sid, '\r', connId);
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [refreshing, setRefreshing] = createSignal(false);

  const refreshHistoryStats = async (sid: string) => {
    if (!connected()) return;
    if (!sid) return;
    try {
      const stats = await transport.getSessionStats(sid);
      if (activeSessionId() !== sid) return;
      setHistoryBytes(stats.history.totalBytes);
    } catch {
    }
  };

  const waitForActions = async (sid: string, maxFrames = 4) => {
    for (let i = 0; i < maxFrames; i += 1) {
      const actions = actionsRegistry.get(sid);
      if (actions) return actions;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return null;
  };

  const handleRefresh = async () => {
    if (!connected() || refreshing()) return;

    setRefreshing(true);
    setError(null);

    try {
      await refreshSessions();

      const sid = activeSessionId();
      if (sid) {
        setHistoryBytes(null);

        // Ensure the refresh flow matches the page open path: rebuild + attach + replay history.
        const actions = await waitForActions(sid);
        await actions?.reload();

        await refreshHistoryStats(sid);
      }
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const closeSession = (id: string) => {
    void (async () => {
      try {
        await sessionsCoordinator.deleteSession(id);
      } catch (e) {
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  createEffect(() => {
    const client = protocol.client();
    if (!client) return;

    let cancelled = false;
    void (async () => {
      setSessionsLoading(true);
      try {
        await sessionsCoordinator.refresh();
      } catch (e) {
        if (cancelled) return;
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const id = activeSessionId();
    if (!id) return;
    if (!sessions().some((s) => s.id === id)) return;
    setMountedSessionIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  });

  createEffect(() => {
    const ids = new Set(sessions().map((s) => s.id));
    setMountedSessionIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  });

  createEffect(() => {
    writeActiveSessionId(activeSessionStorageKey, activeSessionId());
  });

  const tabItems = createMemo<TabItem[]>(() => {
    const list = sessions();
    return list.map((s, index) => ({
      id: s.id,
      label: s.name?.trim() ? s.name.trim() : `Terminal ${index + 1}`,
      closable: true,
    }));
  });

  const currentThemeLabel = createMemo(() => {
    const id = userTheme();
    return TERMINAL_THEME_ITEMS.find((i) => i.id === id)?.label ?? 'System Theme';
  });

  const currentFontLabel = createMemo(() => {
    const id = fontFamilyId();
    return TERMINAL_FONT_OPTIONS.find((o) => o.id === id)?.label ?? TERMINAL_FONT_OPTIONS[0]!.label;
  });

  const themeMenuItems = createMemo<DropdownItem[]>(() => {
    const selected = userTheme();
    return TERMINAL_THEME_ITEMS.map((item) => ({
      id: `theme:${item.id}`,
      label: item.id === selected ? `${item.label} (Current)` : item.label,
      keepOpen: true,
    }));
  });

  const fontMenuItems = createMemo<DropdownItem[]>(() => {
    const selected = fontFamilyId();
    return [
      {
        id: 'font:size',
        label: '',
        keepOpen: true,
        content: () => (
          <div
            class="flex items-center gap-2 px-2 py-1"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="text-xs text-muted-foreground w-10 shrink-0">Size</div>
            <NumberInput
              value={fontSize()}
              onChange={(v) => persistFontSize(v)}
              min={TERMINAL_MIN_FONT_SIZE}
              max={TERMINAL_MAX_FONT_SIZE}
              step={1}
              size="sm"
              class="w-36"
            />
          </div>
        ),
      },
      { id: 'sep-font', label: '', separator: true },
      ...TERMINAL_FONT_OPTIONS.map((o) => ({
        id: `font:family:${o.id}`,
        label: o.id === selected ? `${o.label} (Current)` : o.label,
        keepOpen: true,
      })),
    ];
  });

  const moreItems = createMemo<DropdownItem[]>(() => {
    return [
      { id: 'search', label: 'Search' },
      { id: 'sep-1', label: '', separator: true },
      { id: 'theme-menu', label: `Theme: ${currentThemeLabel()}`, children: themeMenuItems(), keepOpen: true },
      { id: 'font-menu', label: `Font: ${currentFontLabel()}`, children: fontMenuItems(), keepOpen: true },
    ];
  });

  let searchInputEl: HTMLInputElement | null = null;
  let rootEl: HTMLDivElement | null = null;

  const getActiveCore = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return coreRegistry.get(sid) ?? null;
  };

  const openTerminalAskMenu = (event: MouseEvent) => {
    if (!connected()) return;

    const sid = String(activeSessionId() ?? '').trim();
    if (!sid) return;

    const session = sessions().find((item) => item.id === sid);
    const workingDir = normalizeAskFlowerVirtualPath(String(session?.workingDir ?? '').trim() || '/');

    let selection = '';
    try {
      const core = getActiveCore() as any;
      selection = String(core?.getSelectionText?.() ?? '').trim();
    } catch {
      selection = '';
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalAskMenu({
      x: event.clientX,
      y: event.clientY,
      workingDir,
      selection,
    });
  };

  const askFlowerFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu) return;
    setTerminalAskMenu(null);

    const selection = String(menu.selection ?? '');
    const trimmedSelection = selection.trim();
    const pendingAttachments: File[] = [];
    const notes: string[] = [];
    let contextItems: AskFlowerIntent['contextItems'] = [];

    if (trimmedSelection) {
      if (trimmedSelection.length > MAX_INLINE_TERMINAL_SELECTION_CHARS) {
        const attachmentName = `terminal-selection-${Date.now()}.txt`;
        const attachmentBlob = new Blob([trimmedSelection], { type: 'text/plain' });
        if (attachmentBlob.size > ASK_FLOWER_ATTACHMENT_MAX_BYTES) {
          notes.push('Skipped large terminal selection attachment because it exceeds the 10 MiB upload limit.');
        } else {
          pendingAttachments.push(new File([attachmentBlob], attachmentName, { type: 'text/plain' }));
          notes.push(`Large terminal selection was attached as \"${attachmentName}\".`);
        }
        contextItems = [
          {
            kind: 'terminal_selection',
            workingDir: menu.workingDir,
            selection: '',
            selectionChars: trimmedSelection.length,
          },
        ];
      } else {
        contextItems = [
          {
            kind: 'terminal_selection',
            workingDir: menu.workingDir,
            selection: trimmedSelection,
            selectionChars: trimmedSelection.length,
          },
        ];
      }
    } else {
      notes.push('No terminal text selected. Added working directory context only.');
      contextItems = [
        {
          kind: 'terminal_selection',
          workingDir: menu.workingDir,
          selection: '',
          selectionChars: 0,
        },
      ];
    }

    env.goTab('ai');
    env.injectAskFlowerIntent({
      id: crypto.randomUUID(),
      source: 'terminal',
      mode: 'append',
      suggestedWorkingDir: menu.workingDir,
      contextItems,
      pendingAttachments,
      notes,
    });
    notify.info('Ask Flower', 'Terminal context added to draft.');
  };

  const bindSearchCore = (core: TerminalCore | null) => {
    if (searchBoundCore && searchBoundCore !== core) {
      // Unbind callbacks from the previous core to avoid cross-session search counters.
      searchBoundCore.setSearchResultsCallback(null);
    }

    searchBoundCore = core;

    if (!core) {
      setSearchResultIndex(-1);
      setSearchResultCount(0);
      return;
    }

    core.setSearchResultsCallback(({ resultIndex, resultCount }) => {
      setSearchResultIndex(Number.isFinite(resultIndex) ? resultIndex : -1);
      setSearchResultCount(Number.isFinite(resultCount) ? resultCount : 0);
    });
  };

  createEffect(() => {
    const open = searchOpen();
    const sid = activeSessionId();
    void coreRegistrySeq();

    const core = sid ? (coreRegistry.get(sid) ?? null) : null;
    if (!open || !core) {
      bindSearchCore(null);
      searchLastAppliedKey = '';
      return;
    }

    bindSearchCore(core);
  });

  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const open = searchOpen();
    const q = searchQuery();
    const sid = activeSessionId();
    void coreRegistrySeq();
    if (!open || !sid) {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
      return;
    }

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const core = coreRegistry.get(sid) ?? null;
      if (!core) return;

      const term = q.trim();
      const key = `${sid}:${term}`;
      if (key === searchLastAppliedKey) return;

      if (!term) {
        core.clearSearch();
        searchLastAppliedKey = key;
        return;
      }

      core.findNext(term);
      searchLastAppliedKey = key;
    }, 120);
  });

  onCleanup(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    bindSearchCore(null);
  });

  const openSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputEl?.focus();
      searchInputEl?.select?.();
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResultIndex(-1);
    setSearchResultCount(0);
    searchLastAppliedKey = '';
    // Search UI is panel-scoped; clear all sessions on close to avoid lingering highlights.
    for (const core of coreRegistry.values()) {
      core.clearSearch();
    }
    bindSearchCore(null);
    requestAnimationFrame(() => {
      getActiveCore()?.focus();
    });
  };

  const goNextMatch = () => {
    const core = getActiveCore();
    const term = searchQuery().trim();
    if (!core || !term) return;
    core.findNext(term);
  };

  const goPrevMatch = () => {
    const core = getActiveCore();
    const term = searchQuery().trim();
    if (!core || !term) return;
    core.findPrevious(term);
  };

  const handleRootKeyDown: (e: KeyboardEvent) => void = (e) => {
    const key = e.key?.toLowerCase?.() ?? '';

    if ((e.ctrlKey || e.metaKey) && key === 'f') {
      // Common terminal shortcut: intercept browser find.
      e.preventDefault();
      openSearch();
      return;
    }

    if (e.key === 'Escape' && searchOpen()) {
      e.preventDefault();
      closeSearch();
      return;
    }

    if (e.key === 'Enter' && searchOpen()) {
      // Enter/Shift+Enter navigates to next/previous match.
      e.preventDefault();
      if (e.shiftKey) goPrevMatch();
      else goNextMatch();
    }
  };

  const handleMoreSelect = (id: string) => {
    if (id === 'search') {
      openSearch();
      return;
    }

    if (id.startsWith('theme:')) {
      handleThemeChange(id.slice('theme:'.length));
      return;
    }

    if (id.startsWith('font:family:')) {
      persistFontFamily(id.slice('font:family:'.length));
      return;
    }
  };

  const body = (
    <div
      ref={(n) => (rootEl = n)}
      class="h-full flex flex-col"
      onKeyDown={handleRootKeyDown}
      onFocusIn={() => setPanelHasFocus(true)}
      onPointerDown={() => setPanelHasFocus(true)}
      onFocusOut={() => {
        // focusout also fires when moving within the subtree; re-check on the next frame to confirm if we really left the panel.
        requestAnimationFrame(() => {
          const active = typeof document !== 'undefined' ? document.activeElement : null;
          setPanelHasFocus(Boolean(active && rootEl?.contains(active)));
        });
      }}
    >
      <div
        class={`relative pt-2 px-2 pb-0 flex items-end gap-2 ${variant === 'panel' ? 'justify-between' : 'justify-end'}`}
      >
        <Show
          when={tabItems().length > 0}
          fallback={
            <Show when={variant === 'panel'}>
              <div class="text-xs font-medium border-b border-border pb-2">Terminal</div>
            </Show>
          }
        >
          <Tabs
            items={tabItems()}
            activeId={activeSessionId() ?? undefined}
            onChange={(id) => {
              setActiveSessionId(id);
            }}
            onClose={(id) => closeSession(id)}
            onAdd={createSession}
            showAdd={connected() && !creating()}
            closable
            features={{
              indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true },
              closeButton: { enabledByDefault: true, dangerHover: true },
              addButton: { enabled: connected() && !creating() },
            }}
            class="flex-1 min-w-0"
          />
        </Show>

        <div class="flex items-center gap-1 border-b border-border h-8 shrink-0">
          <Show when={tabItems().length === 0}>
            <Button
              size="sm"
              variant="ghost"
              onClick={createSession}
              disabled={!connected() || creating()}
              loading={creating()}
              title="New session"
            >
              <PlusIcon class="w-3.5 h-3.5" />
            </Button>
          </Show>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={!connected() || refreshing()}
            loading={refreshing()}
            title="Refresh"
          >
            <RefreshIcon class="w-3.5 h-3.5" />
          </Button>
          <Show when={tabItems().length > 0}>
            <Button size="sm" variant="ghost" onClick={clearActive} disabled={!connected() || !activeSessionId()} title="Clear">
              <Trash class="w-3.5 h-3.5" />
            </Button>
            <Dropdown
              trigger={
                <Button size="sm" variant="ghost" disabled={!connected()} title="More options">
                  <MoreVerticalIcon class="w-3.5 h-3.5" />
                </Button>
              }
              items={moreItems()}
              onSelect={handleMoreSelect}
              align="end"
            />
          </Show>
        </div>
      </div>

      <Show when={connected()} fallback={<div class="p-4 text-xs text-muted-foreground">Not connected.</div>}>
        <div class="flex-1 min-h-0 relative" onContextMenu={openTerminalAskMenu}>
          <Show when={searchOpen()}>
            <div class="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-white/15 bg-[#0b0f14]/95 px-2 py-1 shadow-md backdrop-blur">
              <Input
                ref={(n) => (searchInputEl = n)}
                size="sm"
                value={searchQuery()}
                placeholder="Search..."
                class="w-[220px] bg-black/20 border-white/20 text-[#e5e7eb] placeholder:text-[#94a3b8] focus:ring-yellow-400 focus:border-yellow-400 shadow-none"
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
              <div class="text-[10px] text-[#94a3b8] tabular-nums min-w-[54px] text-right">
                {searchResultCount() <= 0 || searchResultIndex() < 0 ? '0/0' : `${searchResultIndex() + 1}/${searchResultCount()}`}
              </div>
              <Button
                size="sm"
                variant="ghost"
                class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                onClick={goPrevMatch}
                disabled={searchResultCount() <= 0}
                title="Previous"
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                onClick={goNextMatch}
                disabled={searchResultCount() <= 0}
                title="Next"
              >
                Next
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="text-[#e5e7eb] hover:bg-white/10 hover:text-white"
                onClick={closeSearch}
                title="Close"
              >
                Close
              </Button>
            </div>
          </Show>
          <Show when={sessions().length > 0}>
            <div class="h-full">
              <Index each={sessions()}>
                {(session) => (
                  <Show when={mountedSessionIds().has(session().id)}>
                    <TabPanel active={activeSessionId() === session().id} keepMounted class="h-full">
	                      <TerminalSessionView
	                        session={session()}
	                        active={() => activeSessionId() === session().id}
	                        connected={connected}
	                        protocolClient={() => protocol.client()}
	                        viewActive={viewActive}
	                        autoFocus={shouldAutoFocus}
	                        themeName={terminalThemeName}
	                        themeColors={terminalThemeColors}
                        fontSize={fontSize}
                        fontFamily={fontFamily}
                        connId={connId}
                        transport={transport}
                        eventSource={eventSource}
                        registerCore={registerCore}
                        registerActions={registerActions}
                        onNameUpdate={handleNameUpdate}
                      />
                    </TabPanel>
                  </Show>
                )}
              </Index>
            </div>
          </Show>

          <Show when={sessionsLoading() && sessions().length === 0}>
            <LoadingOverlay visible message="Loading sessions..." />
          </Show>

          <Show when={!sessionsLoading() && sessions().length === 0}>
            <div class="absolute inset-0 flex items-center justify-center p-8">
              <div class="max-w-sm text-center flex flex-col items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Terminal class="w-5 h-5 text-muted-foreground" />
                </div>
                <div class="text-sm font-medium text-foreground">No terminal sessions yet</div>
                <div class="text-xs text-muted-foreground">
                  Create your first terminal session to start running commands.
                </div>
                <Button
                  size="lg"
                  variant="primary"
                  onClick={createSession}
                  loading={creating()}
                  disabled={!connected()}
                >
                  Create session
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={terminalAskMenu()} keyed>
        {(menu) => (
          <div
            ref={(el) => {
              terminalAskMenuEl = el;
            }}
            class="fixed z-[120] min-w-[160px] rounded-md border border-border bg-background shadow-lg p-1"
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              class="w-full text-left px-3 py-1.5 text-xs rounded hover:bg-muted/60"
              onClick={askFlowerFromTerminal}
            >
              Ask Flower
            </button>
          </div>
        )}
      </Show>

      <Show when={error()}>
        <div class="p-2 text-[11px] text-error border-t border-border bg-background/80 break-words">{error()}</div>
      </Show>
      <Show when={activeSessionId()}>
        <div class="flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
          <span>Session: {activeSessionId()}</span>
          <span>History: {historyBytes() === null ? '-' : formatBytes(historyBytes() ?? 0)}</span>
        </div>
      </Show>
    </div>
  );

  if (variant === 'deck') return body;

  return (
    <Panel class="border border-border rounded-md overflow-hidden h-full">
      <PanelContent class="p-0 h-full">{body}</PanelContent>
    </Panel>
  );
}

export function TerminalPanel(props: TerminalPanelProps = {}) {
  const protocol = useProtocol();
  const ctx = useEnvContext();

  const [executeDenied, setExecuteDenied] = createSignal(false);

  const permissionReady = () => ctx.env.state === 'ready';
  const canExecute = () => Boolean(ctx.env()?.permissions?.can_execute);
  const noExecute = createMemo(() => executeDenied() || (permissionReady() && !canExecute()));

  createEffect(() => {
    // Reset when disconnected so users can reconnect after policy changes.
    if (protocol.status() !== 'connected') {
      setExecuteDenied(false);
    }
  });

  createEffect(() => {
    if (noExecute()) {
      disposeRedevenTerminalSessionsCoordinator();
    }
  });

  return (
    <Show
      when={!noExecute()}
      fallback={
        <PermissionEmptyState
          variant={props.variant === 'deck' ? 'deck' : 'panel'}
          title="Execute permission required"
          description="Terminal is disabled because execute permission is not granted for this session."
        />
      }
    >
      <TerminalPanelInner {...props} onExecuteDenied={() => setExecuteDenied(true)} />
    </Show>
  );
}
