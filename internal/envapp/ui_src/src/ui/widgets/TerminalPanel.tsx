import { Index, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { useCurrentWidgetId, useLayout, useNotification, useResolvedFloeConfig, useTheme, useViewActivation } from '@floegence/floe-webapp-core';
import { Copy, Folder, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Dropdown, type DropdownItem, Input, MobileKeyboard, Tabs, TabPanel, type TabItem } from '@floegence/floe-webapp-core/ui';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { FlowerContextMenuIcon } from '../icons/FlowerSoftAuraIcon';
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
  type TerminalMobileInputMode,
  useTerminalPreferences,
} from '../services/terminalPreferences';
import {
  applyTerminalMobileKeyboardPayload,
  buildTerminalMobileKeyboardSuggestions,
  createEmptyTerminalMobileKeyboardDraftState,
  deriveTerminalMobileKeyboardContext,
  parseTerminalMobileKeyboardScripts,
  rememberTerminalMobileKeyboardHistory,
  resolveTerminalMobileKeyboardPackageJsonPath,
  type TerminalMobileKeyboardPathEntry,
  type TerminalMobileKeyboardScript,
  type TerminalMobileKeyboardSuggestion,
  TERMINAL_MOBILE_KEYBOARD_QUICK_INSERTS,
} from '../services/terminalMobileKeyboard';
import { useEnvContext } from '../pages/EnvContext';
import { isPermissionDeniedError } from '../utils/permission';
import { createClientId } from '../utils/clientId';
import { PermissionEmptyState } from './PermissionEmptyState';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { normalizeAbsolutePath as normalizeAskFlowerAbsolutePath } from '../utils/askFlowerPath';
import { resolveTerminalSurfaceTouchAction } from '../mobileViewportPolicy';
import { resolveTerminalFontFamily, TerminalSettingsDialog } from './TerminalSettingsDialog';
import { resolveTerminalMobileKeyboardInsetPx } from './terminalMobileKeyboardInset';
import { useFilePreviewContext } from './FilePreviewContext';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { createTerminalFileLinkProvider, type TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import { TerminalShellIntegrationParser, type TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import { createTerminalTabActivityTracker, type TerminalTabVisualState } from '../services/terminalTabActivity';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { FLOATING_CONTEXT_MENU_WIDTH_PX, FloatingContextMenu, estimateFloatingContextMenuHeight, type FloatingContextMenuItem } from './FloatingContextMenu';

type session_loading_state = 'idle' | 'initializing' | 'attaching' | 'loading_history';

export type TerminalPanelVariant = 'panel' | 'deck' | 'workbench';

export type TerminalPanelSessionGroupState = Readonly<{
  sessionIds: string[];
  activeSessionId: string | null;
}>;

export type TerminalPanelSessionOperations = Readonly<{
  createSession: (name: string | undefined, workingDir: string) => Promise<string | null>;
  deleteSession: (sessionId: string) => Promise<void>;
}>;

export interface TerminalPanelProps {
  variant?: TerminalPanelVariant;
  openSessionRequest?: {
    requestId: string;
    workingDir: string;
    preferredName?: string;
    targetMode?: 'activity' | 'deck' | 'workbench';
  } | null;
  onOpenSessionRequestHandled?: (requestId: string) => void;
  sessionGroupState?: TerminalPanelSessionGroupState;
  onSessionGroupStateChange?: (next: TerminalPanelSessionGroupState) => void;
  sessionOperations?: TerminalPanelSessionOperations;
  workbenchActivationSeq?: number;
  onTitleChange?: (title: string) => void;
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

function sameSessionIdList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sameTerminalPanelSessionGroupState(
  left: TerminalPanelSessionGroupState,
  right: TerminalPanelSessionGroupState,
): boolean {
  return left.activeSessionId === right.activeSessionId
    && sameSessionIdList(left.sessionIds, right.sessionIds);
}

function pickPreferredActiveId(list: TerminalSessionInfo[], preferredId: string | null): string | null {
  if (preferredId && list.some((s) => s.id === preferredId)) return preferredId;
  const active = list.find((s) => s.isActive);
  if (active) return active.id;
  const byLastActive = [...list].sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0));
  return byLastActive[0]?.id ?? null;
}

function resolveRequestedSessionName(preferredName: string | undefined, workingDir: string, nextIndex: number): string {
  const normalizedPreferredName = String(preferredName ?? '').trim();
  if (normalizedPreferredName) return normalizedPreferredName;

  const normalizedWorkingDir = String(workingDir ?? '').trim();
  if (normalizedWorkingDir && normalizedWorkingDir !== '/') {
    const parts = normalizedWorkingDir.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] ?? '';
    if (basename) return basename;
  }

  return `Terminal ${nextIndex}`;
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
  agentHomePathAbs: () => string;
  canOpenFilePreview: () => boolean;
  bottomInsetPx: () => number;
  connId: string;
  transport: TerminalTransport;
  eventSource: TerminalEventSource;
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: { reload: () => Promise<void> } | null) => void;
  onBell?: (sessionId: string) => void;
  onShellIntegrationEvent?: (sessionId: string, event: TerminalShellIntegrationEvent, source: 'history' | 'live') => void;
  onVisibleOutput?: (sessionId: string, source: 'history' | 'live', byteLength: number) => void;
  onTerminalFileLinkOpen?: (target: TerminalResolvedLinkTarget) => Promise<void> | void;
  onNameUpdate?: (sessionId: string, newName: string, workingDir: string) => void;
};

const HISTORY_STATS_POLL_MS = 10_000;
const MAX_INLINE_TERMINAL_SELECTION_CHARS = 10_000;
const ASK_FLOWER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const TERMINAL_SELECTION_BACKGROUND = 'rgba(255, 234, 0, 0.72)';
const TERMINAL_SELECTION_FOREGROUND = '#000000';
const TERMINAL_INPUT_SELECTOR = 'textarea[aria-label="Terminal input"], textarea';
const MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX = 20;
const MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX = 12;
type TerminalSessionTabVisualStateMap = Record<string, TerminalTabVisualState>;

type terminal_touch_scroll_target = {
  scrollLines?: (amount: number) => void;
  getScrollbackLength?: () => number;
  isAlternateScreen?: () => boolean;
  input?: (data: string, wasUserInput?: boolean) => void;
};

type terminal_selection_snapshot = {
  sessionId: string;
  selectionText: string;
  hasSelection: boolean;
};

function resolveTerminalTouchScrollTarget(core: TerminalCore | null): terminal_touch_scroll_target | null {
  if (!core) return null;
  const inner = (core as unknown as { terminal?: terminal_touch_scroll_target | null }).terminal;
  return inner ?? null;
}

function readTerminalSelectionText(core: TerminalCore | null): string {
  try {
    return String(core?.getSelectionText?.() ?? '');
  } catch {
    return '';
  }
}

function buildTerminalSelectionSnapshot(sessionId: string, core: TerminalCore | null): terminal_selection_snapshot {
  const normalizedSessionId = String(sessionId ?? '').trim();
  const rawSelectionText = readTerminalSelectionText(core);
  const hasSelection = (() => {
    try {
      return Boolean(core?.hasSelection?.() ?? false);
    } catch {
      return rawSelectionText.length > 0;
    }
  })();
  const normalizedSelectionText = hasSelection ? rawSelectionText : '';
  return {
    sessionId: normalizedSessionId,
    selectionText: normalizedSelectionText,
    hasSelection,
  };
}

function buildTerminalSessionLabel(session: TerminalSessionInfo, index: number): string {
  return session.name?.trim() ? session.name.trim() : `Terminal ${index + 1}`;
}

function buildTerminalPanelTitle(session: TerminalSessionInfo | null): string {
  const sessionName = String(session?.name ?? '').trim();
  if (sessionName) {
    return `Terminal · ${sessionName}`;
  }

  const workingDir = normalizeAskFlowerAbsolutePath(String(session?.workingDir ?? '').trim());
  if (workingDir && workingDir !== '/') {
    const parts = workingDir.split('/').filter(Boolean);
    const basename = parts[parts.length - 1] ?? '';
    if (basename) {
      return `Terminal · ${basename}`;
    }
  }

  return 'Terminal';
}

const TerminalTabStatusIcon = (props: { state: 'none' | 'running' | 'unread' }) => {
  if (props.state === 'running') {
    return (
      <span class="inline-flex h-3 w-3 items-center justify-center text-muted-foreground" data-terminal-tab-status="running" aria-hidden="true">
        <svg
          class="h-3 w-3 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="8" class="opacity-20" stroke="currentColor" stroke-width="3" />
          <path d="M20 12a8 8 0 0 0-8-8" class="opacity-100" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </span>
    );
  }

  if (props.state === 'unread') {
    return (
      <span class="inline-flex h-3 w-3 items-center justify-center" data-terminal-tab-status="unread" aria-hidden="true">
        <span class="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" />
      </span>
    );
  }

  return <span class="inline-block h-3 w-3 opacity-0" data-terminal-tab-status="none" aria-hidden="true" />;
};

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
  const shellIntegrationParser = new TerminalShellIntegrationParser();

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

  const consumeTerminalChunk = (data: Uint8Array, source: 'history' | 'live'): Uint8Array => {
    const result = shellIntegrationParser.parse(data);
    for (const event of result.events) {
      props.onShellIntegrationEvent?.(sessionId(), event, source);
    }
    if (result.displayData.byteLength > 0) {
      props.onVisibleOutput?.(sessionId(), source, result.displayData.byteLength);
    }
    return result.displayData;
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
    shellIntegrationParser.reset();
    setReadyOnce(false);
    props.registerCore(sessionId(), null);
  };

  let initSeq = 0;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const confirmAttachedViewportSize = async (core: TerminalCore, id: string, seq: number) => {
    await nextAnimationFrame();
    if (seq !== initSeq) return;

    core.forceResize();

    await nextAnimationFrame();
    if (seq !== initSeq) return;

    const dims = core.getDimensions();
    if (dims.cols <= 0 || dims.rows <= 0) return;
    await props.transport.resize(id, dims.cols, dims.rows);
  };

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
        cursorBlink: false,
        fontSize: fontSize(),
        allowTransparency: false,
        theme: colors(),
        fontFamily: fontFamily(),
        clipboard: {
          copyOnSelect: false,
        },
        // When multiple views/panels show the same terminal session, only the focused terminal should emit remote resize.
        // Focus also re-fits and re-emits the current size so the active surface can reclaim remote PTY ownership after
        // another view with a different width was previously attached to the same session/connection.
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
        onBell: () => {
          props.onBell?.(id);
        },
      },
      buildLogger(),
    );

    core.registerLinkProvider?.(createTerminalFileLinkProvider({
      core,
      isEnabled: () => props.canOpenFilePreview(),
      getContext: () => ({
        workingDirAbs: normalizeAskFlowerAbsolutePath(props.session.workingDir ?? '')
          || normalizeAskFlowerAbsolutePath(props.agentHomePathAbs())
          || '/',
        agentHomePathAbs: normalizeAskFlowerAbsolutePath(props.agentHomePathAbs()) || undefined,
      }),
      onActivate: (target) => props.onTerminalFileLinkOpen?.(target),
    }));

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
        const displayData = consumeTerminalChunk(ev.data, 'live');
        if (displayData.byteLength === 0) return;
        queued.push(displayData);
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

      await replayHistory(sorted
        .map((chunk) => consumeTerminalChunk(chunk.data, 'history'))
        .filter((chunk) => chunk.byteLength > 0));
      if (seq !== initSeq) return;

      replaying = false;
      const liveSorted = [...bufferedLive]
        .filter((c) => typeof c.sequence !== 'number' || c.sequence <= 0 || c.sequence > historyMaxSeq)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      bufferedLive = [];
      for (const c of liveSorted) {
        const displayData = consumeTerminalChunk(c.data, 'live');
        if (displayData.byteLength === 0) continue;
        queued.push(displayData);
      }
      if (queued.length > 0) scheduleFlush();

      await confirmAttachedViewportSize(core, id, seq);
      if (seq !== initSeq) return;

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
    term.setFontFamily?.(fontFamily());
  });

  onCleanup(() => {
    initSeq += 1;
    reloadSeq += 1;
    disposeTerminal();
    props.registerCore(sessionId(), null);
    props.registerSurfaceElement(sessionId(), null);
  });

  const terminalBackground = () => colors().background ?? '#1e1e1e';
  const terminalForeground = () => colors().foreground ?? '#c9d1d9';

  return (
    <div
      class="h-full min-h-0 relative overflow-hidden"
      style={{
        'background-color': terminalBackground(),
        '--terminal-bottom-inset': `${props.bottomInsetPx()}px`,
        '--background': terminalBackground(),
        '--primary': terminalForeground(),
        '--muted': `color-mix(in srgb, ${terminalForeground()} 12%, ${terminalBackground()})`,
        '--muted-foreground': `color-mix(in srgb, ${terminalForeground()} 70%, transparent)`,
      }}
    >
      <div
        ref={(n) => {
          container = n;
          props.registerSurfaceElement(sessionId(), n);
        }}
        {...REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS}
        class="absolute top-2 left-2 right-0 bottom-0 redeven-terminal-surface"
        style={{
          transition: 'opacity 0.15s ease-out',
          bottom: 'var(--terminal-bottom-inset)',
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
          style={{
            'background-color': `color-mix(in srgb, ${terminalBackground()} 80%, transparent)`,
            bottom: 'calc(var(--terminal-bottom-inset) + 0.75rem)',
          }}
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
  const filePreview = useFilePreviewContext();
  const layout = useLayout();
  const notify = useNotification();
  const theme = useTheme();
  const floe = useResolvedFloeConfig();
  const widgetId = (() => {
    try {
      return useCurrentWidgetId();
    } catch {
      return null;
    }
  })();
  const view = (() => {
    try {
      return useViewActivation();
    } catch {
      // Deck layouts can mount terminals outside tab activation providers.
      const fallbackId = String(widgetId ?? '').trim();
      return {
        id: fallbackId ? `deck:${fallbackId}` : 'terminal_page',
        active: () => true,
        activationSeq: () => 0,
      };
    }
  })();
  const connId = getOrCreateTerminalConnId();
  const panelId = (() => {
    const wid = String(widgetId ?? '').trim();
    return wid ? `deck:${wid}` : 'terminal_page';
  })();
  const activeSessionStorageKey = buildActiveSessionStorageKey(panelId);
  const sessionGroupState = createMemo<TerminalPanelSessionGroupState | null>(() => props.sessionGroupState ?? null);

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchResultCount, setSearchResultCount] = createSignal(0);
  const [searchResultIndex, setSearchResultIndex] = createSignal(-1);
  const [panelHasFocus, setPanelHasFocus] = createSignal(false);
  const [agentHomePathAbs, setAgentHomePathAbs] = createSignal('');
  const [terminalAskMenu, setTerminalAskMenu] = createSignal<{
    x: number;
    y: number;
    workingDir: string;
    homePath?: string;
    selection: terminal_selection_snapshot;
    showBrowseFiles: boolean;
  } | null>(null);
  let terminalAskMenuEl: HTMLDivElement | null = null;
  const [terminalContextMenuHostEl, setTerminalContextMenuHostEl] = createSignal<HTMLDivElement | null>(null);

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
  const permissionReady = () => env.env.state === 'ready';
  const canBrowseFiles = createMemo(() => connected() && permissionReady() && Boolean(env.env()?.permissions?.can_read));

  createEffect(() => {
    if (viewActive()) return;
    // Reset focus state when the view becomes inactive to avoid stale focus affecting autoFocus decisions.
    setPanelHasFocus(false);
  });

  createEffect(() => {
    if (!connected()) return;
    void (async () => {
      try {
        const resp = await rpc.fs.getPathContext();
        const home = normalizeAskFlowerAbsolutePath(String(resp?.agentHomePathAbs ?? '').trim());
        if (home) setAgentHomePathAbs(home);
      } catch {
        // ignore
      }
    })();
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

  createEffect(() => {
    const host = terminalContextMenuHostEl();
    if (!host) return;

    const onContextMenuCapture = (event: MouseEvent) => {
      handleTerminalContextMenuCapture(event);
    };

    host.addEventListener('contextmenu', onContextMenuCapture, true);
    onCleanup(() => {
      host.removeEventListener('contextmenu', onContextMenuCapture, true);
    });
  });

  createEffect(() => {
    const host = terminalContextMenuHostEl();
    if (!host) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      if (!shouldUseFloeMobileKeyboard()) return;
      if (!isTerminalSurfaceContextMenuEvent(event as unknown as MouseEvent)) return;
      openFloeMobileKeyboard();
    };

    const onFocusInCapture = (event: FocusEvent) => {
      if (!shouldUseFloeMobileKeyboard()) return;
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!host.contains(target)) return;

      requestAnimationFrame(() => {
        target.blur();
      });
    };

    host.addEventListener('pointerdown', onPointerDownCapture, true);
    host.addEventListener('focusin', onFocusInCapture, true);

    onCleanup(() => {
      host.removeEventListener('pointerdown', onPointerDownCapture, true);
      host.removeEventListener('focusin', onFocusInCapture, true);
    });
  });

  const userTheme = terminalPrefs.userTheme;
  const fontSize = terminalPrefs.fontSize;
  const fontFamilyId = terminalPrefs.fontFamilyId;
  const mobileInputMode = terminalPrefs.mobileInputMode;

  const fontFamily = createMemo<string>(() => {
    return resolveTerminalFontFamily(fontFamilyId());
  });

  const isMobileLayout = () => layout.isMobile();

  const persistFontSize = (value: number) => {
    terminalPrefs.setFontSize(value);
  };

  const persistFontFamily = (id: string) => {
    terminalPrefs.setFontFamily(id);
  };

  const persistMobileInputMode = (value: TerminalMobileInputMode) => {
    terminalPrefs.setMobileInputMode(value);
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

  const [allSessions, setAllSessions] = createSignal<TerminalSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = createSignal(false);
  const [localActiveSessionId, setLocalActiveSessionId] = createSignal<string | null>(readActiveSessionId(activeSessionStorageKey));
  const [mountedSessionIds, setMountedSessionIds] = createSignal<Set<string>>(new Set());
  const [error, setError] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [mobileKeyboardVisible, setMobileKeyboardVisible] = createSignal(
    isMobileLayout() && mobileInputMode() === 'floe',
  );
  const [mobileKeyboardInsetPx, setMobileKeyboardInsetPx] = createSignal(0);
  const [mobileKeyboardDraftState, setMobileKeyboardDraftState] = createSignal(
    createEmptyTerminalMobileKeyboardDraftState(),
  );
  const [mobileKeyboardHistoryBySession, setMobileKeyboardHistoryBySession] = createSignal<Record<string, string[]>>({});
  const [mobileKeyboardPathEntries, setMobileKeyboardPathEntries] = createSignal<TerminalMobileKeyboardPathEntry[]>([]);
  const [mobileKeyboardPackageScripts, setMobileKeyboardPackageScripts] = createSignal<TerminalMobileKeyboardScript[]>([]);
  const [tabVisualStateBySession, setTabVisualStateBySession] = createSignal<TerminalSessionTabVisualStateMap>({});

  const handleExecuteDenied = (e: unknown): boolean => {
    if (!isPermissionDeniedError(e, 'execute')) return false;
    props.onExecuteDenied?.();
    return true;
  };

  const [historyBytes, setHistoryBytes] = createSignal<number | null>(null);

  const coreRegistry = new Map<string, TerminalCore>();
  const surfaceRegistry = new Map<string, HTMLDivElement>();
  const actionsRegistry = new Map<string, { reload: () => Promise<void> }>();
  const mobileKeyboardPathCache = new Map<string, TerminalMobileKeyboardPathEntry[]>();
  const mobileKeyboardPackageScriptsCache = new Map<string, TerminalMobileKeyboardScript[]>();
  const tabActivityTracker = createTerminalTabActivityTracker({
    publishVisualState: (sessionId, state) => {
      setTabVisualStateBySession((prev) => {
        if (prev[sessionId] === state) {
          return prev;
        }
        return {
          ...prev,
          [sessionId]: state,
        };
      });
    },
  });

  const [coreRegistrySeq, setCoreRegistrySeq] = createSignal(0);
  const [surfaceRegistrySeq, setSurfaceRegistrySeq] = createSignal(0);
  let mobileKeyboardInsetSyncRaf: number | null = null;

  const updateSessionGroupState = (
    updater: (previous: TerminalPanelSessionGroupState) => TerminalPanelSessionGroupState,
  ): boolean => {
    const current = sessionGroupState();
    if (!current || !props.onSessionGroupStateChange) {
      return false;
    }

    const next = updater(current);
    if (sameTerminalPanelSessionGroupState(current, next)) {
      return true;
    }

    props.onSessionGroupStateChange(next);
    return true;
  };

  const sessions = createMemo<TerminalSessionInfo[]>(() => {
    const list = allSessions();
    const group = sessionGroupState();
    if (!group) {
      return list;
    }

    const sessionsById = new Map(list.map((session) => [session.id, session]));
    const orderedVisibleSessions: TerminalSessionInfo[] = [];
    for (const sessionId of group.sessionIds) {
      const session = sessionsById.get(sessionId);
      if (session) {
        orderedVisibleSessions.push(session);
      }
    }
    return orderedVisibleSessions;
  });

  const activeSessionId = createMemo<string | null>(() => {
    const group = sessionGroupState();
    if (group) {
      return group.activeSessionId;
    }
    return localActiveSessionId();
  });

  const setActiveSessionId = (value: string | null) => {
    const normalizedValue = String(value ?? '').trim() || null;
    if (!updateSessionGroupState((previous) => ({
      sessionIds: previous.sessionIds,
      activeSessionId: normalizedValue === null
        ? null
        : previous.sessionIds.includes(normalizedValue)
          ? normalizedValue
          : previous.activeSessionId,
    }))) {
      setLocalActiveSessionId(normalizedValue);
    }
  };

  const ensureSessionInGroup = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return;
    }

    updateSessionGroupState((previous) => (
      previous.sessionIds.includes(normalizedSessionId)
        ? previous
        : {
          sessionIds: [...previous.sessionIds, normalizedSessionId],
          activeSessionId: previous.activeSessionId,
        }
    ));
  };

  onCleanup(() => {
    tabActivityTracker.dispose();
  });

  const registerCore = (id: string, core: TerminalCore | null) => {
    if (!id) return;
    if (core) {
      coreRegistry.set(id, core);
      core.setTheme(terminalThemeColors());
      core.setFontSize(fontSize());
      core.setFontFamily?.(fontFamily());
      setCoreRegistrySeq((v) => v + 1);
      return;
    }
    coreRegistry.delete(id);
    setCoreRegistrySeq((v) => v + 1);
  };

  const registerSurfaceElement = (id: string, surface: HTMLDivElement | null) => {
    if (!id) return;
    if (surface) {
      surfaceRegistry.set(id, surface);
      setSurfaceRegistrySeq((v) => v + 1);
      return;
    }
    surfaceRegistry.delete(id);
    setSurfaceRegistrySeq((v) => v + 1);
  };

  const registerActions = (id: string, actions: { reload: () => Promise<void> } | null) => {
    if (!id) return;
    if (actions) {
      actionsRegistry.set(id, actions);
      return;
    }
    actionsRegistry.delete(id);
  };

  const getActiveTerminalViewportElement = (): HTMLDivElement | null => {
    const sid = activeSessionId();
    if (!sid) return null;
    const surface = surfaceRegistry.get(sid);
    const viewport = surface?.parentElement;
    return viewport instanceof HTMLDivElement ? viewport : null;
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

    setAllSessions(next);

    const group = sessionGroupState();
    if (group && props.onSessionGroupStateChange) {
      const nextVisibleIds = group.sessionIds.filter((sessionId) => next.some((session) => session.id === sessionId));
      const visibleSessions = nextVisibleIds
        .map((sessionId) => next.find((session) => session.id === sessionId) ?? null)
        .filter((session): session is TerminalSessionInfo => session !== null);
      const preferredActiveSessionId = group.activeSessionId && nextVisibleIds.includes(group.activeSessionId)
        ? group.activeSessionId
        : null;
      const resolvedActiveSessionId = preferredActiveSessionId ?? pickPreferredActiveId(visibleSessions, null);
      const nextGroupState: TerminalPanelSessionGroupState = {
        sessionIds: nextVisibleIds,
        activeSessionId: resolvedActiveSessionId,
      };
      if (!sameTerminalPanelSessionGroupState(group, nextGroupState)) {
        props.onSessionGroupStateChange(nextGroupState);
      }
      return;
    }

    const currentActive = activeSessionId();
    if (currentActive && next.some((session) => session.id === currentActive)) {
      return;
    }

    let nextActive: string | null = null;
    if (currentActive) {
      const prevIdx = prev.findIndex((session) => session.id === currentActive);
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
      core.setFontFamily?.(family);
    }
  });

  const shouldMarkSessionUnread = (sessionId: string): boolean => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) {
      return false;
    }

    if (!sessions().some((session) => session.id === normalizedSessionId)) {
      return false;
    }

    return activeSessionId() !== normalizedSessionId || !viewActive();
  };

  const handleShellIntegrationEvent = (
    sessionId: string,
    event: TerminalShellIntegrationEvent,
    source: 'history' | 'live',
  ) => {
    if (event.kind === 'cwd-update') {
      const workingDir = normalizeAskFlowerAbsolutePath(event.workingDir);
      if (workingDir) {
        sessionsCoordinator.updateSessionMeta(sessionId, { workingDir });
      }
      return;
    }

    if (event.kind === 'command-start') {
      tabActivityTracker.handleCommandStart(sessionId);
      return;
    }

    if (event.kind === 'command-finish' || event.kind === 'prompt-ready') {
      if (event.kind === 'command-finish' && source === 'live') {
        tabActivityTracker.handleCommandFinish(sessionId, shouldMarkSessionUnread(sessionId));
        return;
      }
      tabActivityTracker.handlePromptReady(sessionId);
      return;
    }

    if (event.kind === 'program-activity') {
      tabActivityTracker.handleProgramActivity(sessionId, event.phase);
    }
  };

  const handleVisibleOutput = (sessionId: string, source: 'history' | 'live', byteLength: number) => {
    tabActivityTracker.handleVisibleOutput(sessionId, {
      source,
      byteLength,
      shouldMarkUnread: shouldMarkSessionUnread(sessionId),
    });
  };

  const handleSessionBell = (sessionId: string) => {
    tabActivityTracker.handleBell(sessionId, shouldMarkSessionUnread(sessionId));
  };

  const openTerminalFileLinkTarget = async (target: TerminalResolvedLinkTarget) => {
    if (!canBrowseFiles()) {
      return;
    }

    try {
      await filePreview.openPreview(fileItemFromPath(target.resolvedPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify.error('Failed to open file preview', message || 'Could not open the terminal file reference.');
    }
  };

  const activeSession = createMemo<TerminalSessionInfo | null>(() => {
    const sid = activeSessionId();
    if (!sid) return null;
    return sessions().find((session) => session.id === sid) ?? null;
  });

  createEffect(() => {
    props.onTitleChange?.(buildTerminalPanelTitle(activeSession()));
  });

  const activeSessionWorkingDir = createMemo(() => {
    return normalizeAskFlowerAbsolutePath(activeSession()?.workingDir ?? '')
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '/';
  });

  const activeMobileKeyboardHistory = createMemo(() => {
    const sid = activeSessionId();
    if (!sid) return [] as string[];
    return mobileKeyboardHistoryBySession()[sid] ?? [];
  });

  const mobileKeyboardContext = createMemo(() => {
    return deriveTerminalMobileKeyboardContext({
      state: mobileKeyboardDraftState(),
      workingDirAbs: activeSessionWorkingDir(),
      agentHomePathAbs: agentHomePathAbs(),
    });
  });

  const shouldUseFloeMobileKeyboard = createMemo(() => {
    return isMobileLayout() && mobileInputMode() === 'floe';
  });

  const mobileKeyboardSuggestions = createMemo<TerminalMobileKeyboardSuggestion[]>(() => {
    if (!shouldUseFloeMobileKeyboard()) return [];
    return buildTerminalMobileKeyboardSuggestions({
      context: mobileKeyboardContext(),
      history: activeMobileKeyboardHistory(),
      pathEntries: mobileKeyboardPathEntries(),
      packageScripts: mobileKeyboardPackageScripts(),
    });
  });

  const terminalViewportInsetPx = createMemo(() => {
    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible()) return 0;
    return mobileKeyboardInsetPx();
  });

  const showTerminalStatusBar = createMemo(() => {
    return Boolean(activeSessionId()) && !(shouldUseFloeMobileKeyboard() && mobileKeyboardVisible());
  });

  const shouldRestoreTerminalFocus = () => {
    return !isMobileLayout() || mobileInputMode() === 'system';
  };

  const shouldAutoFocus = () => {
    return (!isInDeckWidget || panelHasFocus()) && shouldRestoreTerminalFocus();
  };

  const blurActiveElement = () => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  };

  const resolveTerminalInputElement = (surface: HTMLDivElement | null): HTMLTextAreaElement | null => {
    if (!surface) return null;
    const input = surface.querySelector(TERMINAL_INPUT_SELECTOR);
    return input instanceof HTMLTextAreaElement ? input : null;
  };

  const syncTerminalInputElementMode = (surface: HTMLDivElement | null) => {
    const input = resolveTerminalInputElement(surface);
    if (!input) return;

    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    (input as unknown as { autocorrect?: string }).autocorrect = 'off';
    input.spellcheck = false;

    if (shouldUseFloeMobileKeyboard()) {
      input.setAttribute('inputmode', 'none');
      input.setAttribute('enterkeyhint', 'done');
      input.setAttribute('virtualkeyboardpolicy', 'manual');
      return;
    }

    input.setAttribute('inputmode', 'text');
    input.setAttribute('enterkeyhint', 'enter');
    input.removeAttribute('virtualkeyboardpolicy');
  };

  const syncAllTerminalInputElementModes = () => {
    for (const surface of surfaceRegistry.values()) {
      syncTerminalInputElementMode(surface);
    }
  };

  const restoreActiveTerminalFocus = () => {
    if (!shouldRestoreTerminalFocus()) return;
    requestAnimationFrame(() => {
      getActiveCore()?.focus();
    });
  };

  createEffect(() => {
    const activationSeq = props.workbenchActivationSeq ?? 0;
    if (variant !== 'workbench') return;
    if (activationSeq <= 0) return;
    if (!viewActive()) return;
    restoreActiveTerminalFocus();
  });

  const openFloeMobileKeyboard = () => {
    if (!shouldUseFloeMobileKeyboard()) return;
    setMobileKeyboardVisible(true);
    requestAnimationFrame(() => {
      syncAllTerminalInputElementModes();
      getActiveTerminalInputElement()?.blur();
      blurActiveElement();
    });
  };

  let lastMobileKeyboardEligible = false;
  createEffect(() => {
    const eligible = shouldUseFloeMobileKeyboard() && connected() && Boolean(activeSessionId());
    if (eligible && !lastMobileKeyboardEligible) {
      setMobileKeyboardVisible(true);
    } else if (!eligible) {
      setMobileKeyboardVisible(false);
    }
    lastMobileKeyboardEligible = eligible;
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    void coreRegistrySeq();
    void shouldUseFloeMobileKeyboard();

    requestAnimationFrame(() => {
      syncAllTerminalInputElementModes();
    });
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    const mobile = isMobileLayout();

    for (const surface of surfaceRegistry.values()) {
      surface.style.touchAction = resolveTerminalSurfaceTouchAction(mobile);
      surface.style.overscrollBehavior = mobile ? 'contain' : '';
    }
  });

  createEffect(() => {
    void activeSessionId();
    setMobileKeyboardDraftState(createEmptyTerminalMobileKeyboardDraftState());
  });

  createEffect(() => {
    const query = mobileKeyboardContext().pathQuery;
    if (!shouldUseFloeMobileKeyboard() || !query) {
      setMobileKeyboardPathEntries([]);
      return;
    }

    const cacheKey = `${query.baseDirAbs}:${query.showHidden ? 'hidden' : 'visible'}`;
    const cached = mobileKeyboardPathCache.get(cacheKey);
    if (cached) {
      setMobileKeyboardPathEntries(cached);
    } else {
      setMobileKeyboardPathEntries([]);
    }

    let cancelled = false;
    void (async () => {
      if (cached) return;
      try {
        const resp = await rpc.fs.list({ path: query.baseDirAbs, showHidden: query.showHidden });
        if (cancelled) return;
        const entries: TerminalMobileKeyboardPathEntry[] = Array.isArray(resp?.entries)
          ? resp.entries.map((entry) => ({
            name: String(entry.name ?? '').trim(),
            path: String(entry.path ?? '').trim(),
            isDirectory: Boolean(entry.isDirectory),
          })).filter((entry) => entry.name && entry.path)
          : [];
        mobileKeyboardPathCache.set(cacheKey, entries);
        setMobileKeyboardPathEntries(entries);
      } catch {
        if (!cancelled) {
          setMobileKeyboardPathEntries([]);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const workingDir = activeSessionWorkingDir();
    if (!shouldUseFloeMobileKeyboard() || !workingDir) {
      setMobileKeyboardPackageScripts([]);
      return;
    }

    const packageJsonPath = resolveTerminalMobileKeyboardPackageJsonPath(workingDir);
    if (!packageJsonPath) {
      setMobileKeyboardPackageScripts([]);
      return;
    }

    const cached = mobileKeyboardPackageScriptsCache.get(packageJsonPath);
    if (cached) {
      setMobileKeyboardPackageScripts(cached);
    } else {
      setMobileKeyboardPackageScripts([]);
    }

    let cancelled = false;
    void (async () => {
      if (cached) return;
      try {
        const resp = await rpc.fs.readFile({ path: packageJsonPath, encoding: 'utf8' });
        if (cancelled) return;
        const scripts = parseTerminalMobileKeyboardScripts(String(resp?.content ?? ''));
        mobileKeyboardPackageScriptsCache.set(packageJsonPath, scripts);
        setMobileKeyboardPackageScripts(scripts);
      } catch {
        if (!cancelled) {
          setMobileKeyboardPackageScripts([]);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

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

  const activateSession = (sessionId: string) => {
    const normalizedSessionId = String(sessionId ?? '').trim();
    if (!normalizedSessionId) return;

    ensureSessionInGroup(normalizedSessionId);
    setActiveSessionId(normalizedSessionId);
    setMountedSessionIds((prev) => {
      if (prev.has(normalizedSessionId)) return prev;
      const next = new Set(prev);
      next.add(normalizedSessionId);
      return next;
    });
  };

  const createPanelSession = async (name: string | undefined, workingDir: string): Promise<string | null> => {
    const normalizedWorkingDir = normalizeAskFlowerAbsolutePath(String(workingDir ?? '').trim()) || agentHomePathAbs() || '';
    if (props.sessionOperations) {
      const sessionId = await props.sessionOperations.createSession(name, normalizedWorkingDir);
      await sessionsCoordinator.refresh();
      return String(sessionId ?? '').trim() || null;
    }

    const session = await sessionsCoordinator.createSession(String(name ?? '').trim(), normalizedWorkingDir);
    return String(session?.id ?? '').trim() || null;
  };

  const createSession = async () => {
    if (!connected()) return;
    setCreating(true);
    setError(null);
    try {
      const nextIndex = (sessions()?.length ?? 0) + 1;
      const sessionId = await createPanelSession(`Terminal ${nextIndex}`, agentHomePathAbs() || '');
      if (!sessionId) throw new Error('Invalid create response');

      activateSession(sessionId);
    } catch (e) {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  let lastHandledOpenSessionRequestId = '';
  createEffect(() => {
    const request = props.openSessionRequest;
    const requestId = String(request?.requestId ?? '').trim();
    if (!requestId || requestId === lastHandledOpenSessionRequestId) return;
    if (!connected()) return;
    const currentMode = variant === 'deck' ? 'deck' : variant === 'workbench' ? 'workbench' : 'activity';
    const targetMode = request?.targetMode ?? currentMode;
    if (targetMode !== currentMode) return;

    const workingDir = normalizeAskFlowerAbsolutePath(String(request?.workingDir ?? '').trim());
    if (!workingDir) {
      lastHandledOpenSessionRequestId = requestId;
      props.onOpenSessionRequestHandled?.(requestId);
      setError('Invalid working directory.');
      return;
    }

    lastHandledOpenSessionRequestId = requestId;
    void (async () => {
      setCreating(true);
      setError(null);
      try {
        const nextIndex = (sessions()?.length ?? 0) + 1;
        const sessionId = await createPanelSession(
          resolveRequestedSessionName(request?.preferredName, workingDir, nextIndex),
          workingDir,
        );
        if (!sessionId) throw new Error('Invalid create response');
        activateSession(sessionId);
      } catch (e) {
        if (handleExecuteDenied(e)) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        props.onOpenSessionRequestHandled?.(requestId);
        setCreating(false);
      }
    })();
  });

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
        if (props.sessionOperations) {
          await props.sessionOperations.deleteSession(id);
          await sessionsCoordinator.refresh();
        } else {
          await sessionsCoordinator.deleteSession(id);
        }
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
    if (!viewActive()) return;
    const id = activeSessionId();
    if (!id) return;
    tabActivityTracker.clearUnread(id);
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

    tabActivityTracker.pruneSessions(ids);

    setTabVisualStateBySession((prev) => {
      let changed = false;
      const next: TerminalSessionTabVisualStateMap = {};
      for (const [id, state] of Object.entries(prev)) {
        if (ids.has(id)) {
          next[id] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });

  createEffect(() => {
    writeActiveSessionId(activeSessionStorageKey, activeSessionId());
  });

  const tabItems = createMemo<TabItem[]>(() => {
    const list = sessions();
    const tabStates = tabVisualStateBySession();
    return list.map((s, index) => ({
      id: s.id,
      label: buildTerminalSessionLabel(s, index),
      icon: <TerminalTabStatusIcon state={tabStates[s.id] ?? 'none'} />,
      closable: true,
    }));
  });

  let searchInputEl: HTMLInputElement | null = null;
  let rootEl: HTMLDivElement | null = null;
  const [mobileKeyboardElement, setMobileKeyboardElement] = createSignal<HTMLDivElement | null>(null);

  const getActiveCore = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return coreRegistry.get(sid) ?? null;
  };

  const getActiveSurfaceElement = () => {
    const sid = activeSessionId();
    if (!sid) return null;
    return surfaceRegistry.get(sid) ?? null;
  };

  const getActiveTerminalInputElement = () => {
    return resolveTerminalInputElement(getActiveSurfaceElement());
  };

  const getTerminalTouchScrollLineHeightPx = (surface: HTMLDivElement, core: TerminalCore) => {
    const rows = Math.max(1, core.getDimensions().rows);
    const height = surface.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) {
      return MOBILE_TERMINAL_TOUCH_SCROLL_LINE_HEIGHT_FALLBACK_PX;
    }

    return Math.max(MOBILE_TERMINAL_TOUCH_SCROLL_MIN_LINE_HEIGHT_PX, height / rows);
  };

  const applyTerminalTouchScrollLines = (sessionId: string, core: TerminalCore, lineDelta: number): boolean => {
    if (lineDelta === 0) return false;

    const target = resolveTerminalTouchScrollTarget(core);
    if (!target) return false;

    if (target.isAlternateScreen?.()) {
      const sequence = (lineDelta > 0 ? '\x1B[B' : '\x1B[A').repeat(Math.abs(lineDelta));
      if (!sequence) return false;

      if (typeof target.input === 'function') {
        target.input(sequence, true);
      } else {
        void transport.sendInput(sessionId, sequence, connId);
      }
      return true;
    }

    if ((target.getScrollbackLength?.() ?? 0) <= 0) return false;
    if (typeof target.scrollLines !== 'function') return false;

    target.scrollLines(lineDelta);
    return true;
  };

  const recordMobileKeyboardHistory = (sessionId: string, command: string) => {
    setMobileKeyboardHistoryBySession((prev) => {
      const current = prev[sessionId] ?? [];
      const next = rememberTerminalMobileKeyboardHistory(current, command);
      if (next === current) return prev;
      return { ...prev, [sessionId]: next };
    });
  };

  const syncMobileKeyboardInset = () => {
    const keyboardEl = mobileKeyboardElement();
    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible() || !keyboardEl) {
      setMobileKeyboardInsetPx(0);
      return;
    }

    setMobileKeyboardInsetPx(resolveTerminalMobileKeyboardInsetPx({
      viewportEl: getActiveTerminalViewportElement(),
      keyboardEl,
    }));
  };

  const cancelScheduledMobileKeyboardInsetSync = () => {
    if (mobileKeyboardInsetSyncRaf === null) return;
    cancelAnimationFrame(mobileKeyboardInsetSyncRaf);
    mobileKeyboardInsetSyncRaf = null;
  };

  const scheduleMobileKeyboardInsetSync = () => {
    if (mobileKeyboardInsetSyncRaf !== null) return;
    mobileKeyboardInsetSyncRaf = requestAnimationFrame(() => {
      mobileKeyboardInsetSyncRaf = null;
      syncMobileKeyboardInset();
    });
  };

  createEffect(() => {
    void shouldUseFloeMobileKeyboard();
    void mobileKeyboardVisible();
    void activeSessionId();
    void surfaceRegistrySeq();
    const el = mobileKeyboardElement();

    const viewportEl = getActiveTerminalViewportElement();
    if (!el || !viewportEl) {
      setMobileKeyboardInsetPx(0);
      return;
    }

    scheduleMobileKeyboardInsetSync();

    if (!shouldUseFloeMobileKeyboard() || !mobileKeyboardVisible()) {
      return;
    }

    const scheduleSync = () => {
      scheduleMobileKeyboardInsetSync();
    };
    const visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        scheduleSync();
      });
    observer?.observe(el);
    observer?.observe(viewportEl);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('orientationchange', scheduleSync);
    visualViewport?.addEventListener('resize', scheduleSync);
    visualViewport?.addEventListener('scroll', scheduleSync);

    onCleanup(() => {
      cancelScheduledMobileKeyboardInsetSync();
      observer?.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('orientationchange', scheduleSync);
      visualViewport?.removeEventListener('resize', scheduleSync);
      visualViewport?.removeEventListener('scroll', scheduleSync);
    });
  });

  createEffect(() => {
    const sid = activeSessionId();
    const inset = terminalViewportInsetPx();
    if (!sid) return;
    if (!connected()) return;

    const core = coreRegistry.get(sid);
    if (!core) return;

    requestAnimationFrame(() => {
      if (activeSessionId() !== sid) return;
      if (!connected()) return;
      if (terminalViewportInsetPx() !== inset) return;
      core.forceResize();
    });
  });

  createEffect(() => {
    void surfaceRegistrySeq();
    void coreRegistrySeq();
    const sid = activeSessionId();
    const surface = getActiveSurfaceElement();
    const core = getActiveCore();
    const mobile = isMobileLayout();

    if (!mobile || !sid || !surface || !core) return;

    let pointerId: number | null = null;
    let lastY = 0;
    let accumulatedPx = 0;

    const resetGesture = () => {
      if (pointerId === null) return;

      if (typeof surface.hasPointerCapture === 'function' && surface.hasPointerCapture(pointerId)) {
        try {
          surface.releasePointerCapture(pointerId);
        } catch {
        }
      }

      pointerId = null;
      lastY = 0;
      accumulatedPx = 0;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return;

      pointerId = event.pointerId;
      lastY = event.clientY;
      accumulatedPx = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;

      const deltaY = event.clientY - lastY;
      lastY = event.clientY;
      accumulatedPx += deltaY;

      const lineHeightPx = getTerminalTouchScrollLineHeightPx(surface, core);
      const rawLineDelta = -accumulatedPx / lineHeightPx;
      const wholeLineDelta = rawLineDelta > 0 ? Math.floor(rawLineDelta) : Math.ceil(rawLineDelta);
      if (wholeLineDelta === 0) return;

      if (!applyTerminalTouchScrollLines(sid, core, wholeLineDelta)) {
        accumulatedPx = 0;
        return;
      }

      accumulatedPx += wholeLineDelta * lineHeightPx;
      if (typeof surface.setPointerCapture === 'function') {
        try {
          surface.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      event.preventDefault();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      resetGesture();
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerEnd);
    surface.addEventListener('pointercancel', onPointerEnd);

    onCleanup(() => {
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerEnd);
      surface.removeEventListener('pointercancel', onPointerEnd);
      resetGesture();
    });
  });

  const handleMobileKeyboardPayload = (payload: string) => {
    const sid = activeSessionId();
    if (!sid || !connected()) return;

    const update = applyTerminalMobileKeyboardPayload({
      state: mobileKeyboardDraftState(),
      payload,
      history: activeMobileKeyboardHistory(),
    });
    setMobileKeyboardDraftState(update.nextState);
    if (update.committedCommand) {
      recordMobileKeyboardHistory(sid, update.committedCommand);
    }

    void transport.sendInput(sid, payload, connId).catch((e) => {
      if (handleExecuteDenied(e)) return;
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  const handleMobileKeyboardSuggestionSelect = (suggestion: TerminalMobileKeyboardSuggestion) => {
    if (!suggestion.insertText) return;
    handleMobileKeyboardPayload(suggestion.insertText);
  };

  const handleMobileInputModeChange = (
    value: TerminalMobileInputMode,
    options?: { focusTerminal?: boolean },
  ) => {
    persistMobileInputMode(value);
    if (!isMobileLayout()) return;

    if (value === 'floe') {
      setMobileKeyboardVisible(true);
      if (options?.focusTerminal !== false) {
        openFloeMobileKeyboard();
      }
      return;
    }

    setMobileKeyboardVisible(false);
    if (options?.focusTerminal !== false) {
      restoreActiveTerminalFocus();
    }
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open) {
      restoreActiveTerminalFocus();
    }
  };

  const moreItems = createMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [{ id: 'search', label: 'Search' }];
    if (isMobileLayout() && mobileInputMode() === 'floe') {
      items.push({
        id: mobileKeyboardVisible() ? 'hide_floe_keyboard' : 'show_floe_keyboard',
        label: mobileKeyboardVisible() ? 'Hide Floe Keyboard' : 'Show Floe Keyboard',
      });
    }
    items.push({ id: 'settings', label: 'Terminal settings' });
    return items;
  });

  const clampAskMenuPosition = (x: number, y: number, itemCount: number): { x: number; y: number } => {
    if (typeof window === 'undefined') return { x, y };

    const margin = 8;
    const menuWidth = FLOATING_CONTEXT_MENU_WIDTH_PX;
    const menuHeight = estimateFloatingContextMenuHeight(itemCount, 1);
    const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);

    return {
      x: Math.min(Math.max(x, margin), maxX),
      y: Math.min(Math.max(y, margin), maxY),
    };
  };

  const isTerminalSurfaceContextMenuEvent = (event: MouseEvent): boolean => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const host = terminalContextMenuHostEl();
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node.classList.contains('redeven-terminal-surface')) return true;
      if (node === host) break;
    }

    const target = event.target;
    if (target instanceof Element) {
      return !!target.closest('.redeven-terminal-surface');
    }

    return false;
  };

  const openTerminalAskMenu = (event: MouseEvent) => {
    if (!connected()) return;

    const currentActiveId = String(activeSessionId() ?? '').trim();
    const activeSession = currentActiveId
      ? sessions().find((item) => item.id === currentActiveId) ?? null
      : null;
    const resolvedSession = activeSession ?? sessions()[0] ?? null;
    if (!resolvedSession) return;

    const workingDir = normalizeAskFlowerAbsolutePath(String(resolvedSession.workingDir ?? '').trim())
      || normalizeAskFlowerAbsolutePath(agentHomePathAbs())
      || '';
    const homePath = normalizeAskFlowerAbsolutePath(agentHomePathAbs()) || undefined;
    const core = coreRegistry.get(resolvedSession.id) ?? getActiveCore();
    const selection = buildTerminalSelectionSnapshot(resolvedSession.id, core);
    const showBrowseFiles = Boolean(workingDir) && canBrowseFiles();

    const pos = clampAskMenuPosition(event.clientX, event.clientY, showBrowseFiles ? 3 : 2);
    event.preventDefault();
    event.stopPropagation();

    if (!currentActiveId) {
      setActiveSessionId(resolvedSession.id);
    }

    setTerminalAskMenu({
      x: pos.x,
      y: pos.y,
      workingDir,
      homePath,
      selection,
      showBrowseFiles,
    });
  };

  function handleTerminalContextMenuCapture(event: MouseEvent) {
    if (!connected()) return;
    if (!isTerminalSurfaceContextMenuEvent(event)) return;
    openTerminalAskMenu(event);
  }

  const executeTerminalCopyCommand = async (context: { source: 'shortcut' | 'context_menu'; sessionId: string }): Promise<boolean> => {
    const normalizedSessionId = String(context.sessionId ?? '').trim();
    if (!normalizedSessionId) return false;

    const core = coreRegistry.get(normalizedSessionId)
      ?? (activeSessionId() === normalizedSessionId ? getActiveCore() : null);
    if (!core) return false;

    const result = await core.copySelection(context.source === 'shortcut' ? 'shortcut' : 'command');
    if (result.copied) return true;
    if (result.reason === 'clipboard_unavailable') {
      throw new Error('Clipboard is unavailable.');
    }
    return false;
  };

  const notifyTerminalCopyFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    notify.error('Copy failed', message || 'Failed to copy text to clipboard.');
  };

  const handleCopyTerminalSelection = () => {
    const menu = terminalAskMenu();
    setTerminalAskMenu(null);
    if (!menu) return;
    void executeTerminalCopyCommand({
      source: 'context_menu',
      sessionId: menu.selection.sessionId,
    }).catch(notifyTerminalCopyFailure);
  };

  const handleBrowseFilesFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu || !menu.showBrowseFiles) return;
    setTerminalAskMenu(null);

    void env.openFileBrowserAtPath(menu.workingDir, {
      homePath: menu.homePath,
    });
  };

  const handleBrowseFilesInNewWindowFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu || !menu.showBrowseFiles) return;
    setTerminalAskMenu(null);

    void env.openFileBrowserAtPath(menu.workingDir, {
      homePath: menu.homePath,
      openStrategy: 'create_new',
    });
  };

  const askFlowerFromTerminal = () => {
    const menu = terminalAskMenu();
    if (!menu) return;
    setTerminalAskMenu(null);

    const selection = menu.selection.selectionText;
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
          notes.push(`Large terminal selection was attached as "${attachmentName}".`);
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

    env.openAskFlowerComposer({
      id: createClientId('ask-flower'),
      source: 'terminal',
      mode: 'append',
      suggestedWorkingDirAbs: menu.workingDir,
      contextItems,
      pendingAttachments,
      notes,
    }, { x: menu.x, y: menu.y });
  };

  const buildTerminalAskMenuItems = (menu: NonNullable<ReturnType<typeof terminalAskMenu>>): FloatingContextMenuItem[] => {
    const items: FloatingContextMenuItem[] = [
      {
        id: 'ask-flower',
        kind: 'action',
        label: 'Ask Flower',
        icon: FlowerContextMenuIcon,
        onSelect: askFlowerFromTerminal,
      },
    ];

    if (menu.showBrowseFiles) {
      items.push({
        id: 'browse-files',
        kind: 'action',
        label: 'Browse files',
        icon: Folder,
        onSelect: handleBrowseFilesFromTerminal,
      });
      if (env.viewMode() === 'workbench') {
        items.push({
          id: 'browse-files-new-window',
          kind: 'action',
          label: 'Open in New File Window',
          icon: Folder,
          onSelect: handleBrowseFilesInNewWindowFromTerminal,
        });
      }
    }

    items.push({
      id: 'priority-secondary-separator',
      kind: 'separator',
    });
    items.push({
      id: 'copy-selection',
      kind: 'action',
      label: 'Copy selection',
      icon: Copy,
      onSelect: handleCopyTerminalSelection,
      disabled: !menu.selection.hasSelection,
    });

    return items;
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
    restoreActiveTerminalFocus();
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

    if (id === 'show_floe_keyboard') {
      openFloeMobileKeyboard();
      return;
    }

    if (id === 'hide_floe_keyboard') {
      setMobileKeyboardVisible(false);
      return;
    }

    if (id === 'settings') {
      handleSettingsOpenChange(true);
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
        <div
          ref={setTerminalContextMenuHostEl}
          data-testid="terminal-content"
          class="flex-1 min-h-0 relative"
        >
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
                        agentHomePathAbs={agentHomePathAbs}
                        canOpenFilePreview={canBrowseFiles}
                        bottomInsetPx={terminalViewportInsetPx}
                        connId={connId}
                        transport={transport}
                        eventSource={eventSource}
                        registerCore={registerCore}
                        registerSurfaceElement={registerSurfaceElement}
                        registerActions={registerActions}
                        onBell={handleSessionBell}
                        onShellIntegrationEvent={handleShellIntegrationEvent}
                        onVisibleOutput={handleVisibleOutput}
                        onTerminalFileLinkOpen={openTerminalFileLinkTarget}
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
          <FloatingContextMenu
            x={menu.x}
            y={menu.y}
            items={buildTerminalAskMenuItems(menu)}
            menuRef={(el) => {
              terminalAskMenuEl = el;
            }}
          />
        )}
      </Show>

      <Show when={shouldUseFloeMobileKeyboard()}>
        <MobileKeyboard
          ref={(el) => {
            setMobileKeyboardElement(el);
            syncMobileKeyboardInset();
          }}
          visible={mobileKeyboardVisible()}
          quickInserts={TERMINAL_MOBILE_KEYBOARD_QUICK_INSERTS}
          suggestions={mobileKeyboardSuggestions()}
          onKey={handleMobileKeyboardPayload}
          onSuggestionSelect={handleMobileKeyboardSuggestionSelect}
          onDismiss={() => setMobileKeyboardVisible(false)}
        />
      </Show>

      <TerminalSettingsDialog
        open={settingsOpen()}
        userTheme={userTheme()}
        fontSize={fontSize()}
        fontFamilyId={fontFamilyId()}
        mobileInputMode={mobileInputMode()}
        minFontSize={TERMINAL_MIN_FONT_SIZE}
        maxFontSize={TERMINAL_MAX_FONT_SIZE}
        onOpenChange={handleSettingsOpenChange}
        onThemeChange={handleThemeChange}
        onFontSizeChange={persistFontSize}
        onFontFamilyChange={persistFontFamily}
        onMobileInputModeChange={(value) => handleMobileInputModeChange(value, { focusTerminal: false })}
      />

      <Show when={error()}>
        <div class="p-2 text-[11px] text-error border-t border-border bg-background/80 break-words">{error()}</div>
      </Show>
      <Show when={showTerminalStatusBar()}>
        <div class="flex items-center justify-between px-3 py-1 border-t border-border text-[10px] text-muted-foreground">
          <span>Session: {activeSessionId()}</span>
          <span>History: {historyBytes() === null ? '-' : formatBytes(historyBytes() ?? 0)}</span>
        </div>
      </Show>
    </div>
  );

  if (variant === 'deck' || variant === 'workbench') return body;

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
          variant={props.variant === 'deck' || props.variant === 'workbench' ? 'workbench' : 'panel'}
          title="Execute permission required"
          description="Terminal is disabled because execute permission is not granted for this session."
        />
      }
    >
      <TerminalPanelInner {...props} onExecuteDenied={() => setExecuteDenied(true)} />
    </Show>
  );
}
