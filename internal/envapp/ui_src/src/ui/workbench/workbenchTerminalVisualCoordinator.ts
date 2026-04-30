import type {
  TerminalCore,
  TerminalVisualSuspendHandle,
  TerminalVisualSuspendReason,
} from '@floegence/floeterm-terminal-web';

export type WorkbenchTerminalInteractionKind =
  | 'viewport_pan'
  | 'viewport_zoom'
  | 'widget_drag'
  | 'widget_resize'
  | 'widget_layer_switch'
  | 'widget_maximize'
  | 'widget_minimize'
  | 'widget_create'
  | 'widget_close';

export type WorkbenchTerminalInteractionToken = Readonly<{
  id: number;
  kind: WorkbenchTerminalInteractionKind;
  end: () => void;
}>;

type TerminalRegistration = {
  widgetId: string;
  sessionId: string;
  core: TerminalCore | null;
  surface: HTMLDivElement | null;
  suspend: TerminalVisualSuspendHandle | null;
};

type IdleCallbackHandle = number;

const INTERACTION_REASON: Record<WorkbenchTerminalInteractionKind, TerminalVisualSuspendReason> = {
  viewport_pan: 'workbench_pan',
  viewport_zoom: 'workbench_zoom',
  widget_drag: 'workbench_widget_drag',
  widget_resize: 'workbench_widget_resize',
  widget_layer_switch: 'workbench_layer_switch',
  widget_maximize: 'workbench_window_fit',
  widget_minimize: 'workbench_window_fit',
  widget_create: 'workbench_widget_create',
  widget_close: 'workbench_widget_close',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function terminalKey(widgetId: string, sessionId: string): string {
  return `${widgetId}\u001f${sessionId}`;
}

function terminalSurfaceVisible(surface: HTMLDivElement | null): boolean {
  if (!surface || !surface.isConnected) {
    return false;
  }
  if (typeof window === 'undefined') {
    return true;
  }
  const rect = surface.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) {
    return false;
  }
  return rect.right >= -64
    && rect.bottom >= -64
    && rect.left <= window.innerWidth + 64
    && rect.top <= window.innerHeight + 64;
}

function requestIdle(callback: () => void): IdleCallbackHandle {
  if (typeof window === 'undefined') {
    return 0;
  }
  const request = (window as typeof window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  }).requestIdleCallback;
  return request ? request(callback, { timeout: 220 }) : window.setTimeout(callback, 32);
}

function cancelIdle(handle: IdleCallbackHandle): void {
  if (typeof window === 'undefined' || handle === 0) {
    return;
  }
  const cancel = (window as typeof window & {
    cancelIdleCallback?: (id: number) => void;
  }).cancelIdleCallback;
  if (cancel) {
    cancel(handle);
  } else {
    window.clearTimeout(handle);
  }
}

export function createWorkbenchTerminalVisualCoordinator() {
  const terminals = new Map<string, TerminalRegistration>();
  const activeInteractions = new Map<number, WorkbenchTerminalInteractionKind>();
  const pendingResumeKeys: string[] = [];
  let nextInteractionId = 1;
  let sequence = 0;
  let resumeFrame: number | null = null;
  let resumeIdle: IdleCallbackHandle | null = null;
  let selectedWidgetId = '';

  const cancelResumeQueue = () => {
    sequence += 1;
    pendingResumeKeys.length = 0;
    if (resumeFrame !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(resumeFrame);
      resumeFrame = null;
    }
    if (resumeIdle !== null) {
      cancelIdle(resumeIdle);
      resumeIdle = null;
    }
  };

  const clearSuspend = (entry: TerminalRegistration) => {
    entry.suspend?.dispose();
    entry.suspend = null;
  };

  const suspendEntry = (entry: TerminalRegistration, reason: TerminalVisualSuspendReason) => {
    if (!entry.core || entry.suspend) {
      return;
    }
    entry.suspend = entry.core.beginVisualSuspend?.({ reason }) ?? null;
  };

  const activeReason = (): TerminalVisualSuspendReason => {
    const lastKind = Array.from(activeInteractions.values()).at(-1) ?? 'viewport_pan';
    return INTERACTION_REASON[lastKind];
  };

  const scheduleBackgroundResume = () => {
    if (pendingResumeKeys.length === 0 || activeInteractions.size > 0 || typeof window === 'undefined') {
      return;
    }
    const currentSequence = sequence;
    if (resumeFrame !== null || resumeIdle !== null) {
      return;
    }

    resumeFrame = window.requestAnimationFrame(() => {
      resumeFrame = null;
      if (currentSequence !== sequence || activeInteractions.size > 0) {
        return;
      }
      const key = pendingResumeKeys.shift();
      const entry = key ? terminals.get(key) : null;
      if (entry) {
        clearSuspend(entry);
      }
      if (pendingResumeKeys.length === 0) {
        return;
      }
      resumeIdle = requestIdle(() => {
        resumeIdle = null;
        scheduleBackgroundResume();
      });
    });
  };

  const resumeTerminals = () => {
    cancelResumeQueue();

    const visible: string[] = [];
    const background: string[] = [];
    for (const [key, entry] of terminals) {
      if (!entry.suspend) {
        continue;
      }
      if (entry.widgetId === selectedWidgetId || terminalSurfaceVisible(entry.surface)) {
        visible.push(key);
      } else {
        background.push(key);
      }
    }

    for (const key of visible) {
      const entry = terminals.get(key);
      if (entry) {
        clearSuspend(entry);
      }
    }

    pendingResumeKeys.push(...background);
    scheduleBackgroundResume();
  };

  const suspendTerminals = () => {
    cancelResumeQueue();
    const reason = activeReason();
    for (const entry of terminals.values()) {
      suspendEntry(entry, reason);
    }
  };

  const registerCore = (widgetIdRaw: string, sessionIdRaw: string, core: TerminalCore | null) => {
    const widgetId = compact(widgetIdRaw);
    const sessionId = compact(sessionIdRaw);
    if (!widgetId || !sessionId) {
      return;
    }
    const key = terminalKey(widgetId, sessionId);
    const entry = terminals.get(key) ?? {
      widgetId,
      sessionId,
      core: null,
      surface: null,
      suspend: null,
    };
    if (entry.core === core) {
      if (!core && !entry.surface) {
        terminals.delete(key);
        return;
      }
      terminals.set(key, entry);
      return;
    }
    clearSuspend(entry);
    entry.core = core;
    if (core && activeInteractions.size > 0) {
      suspendEntry(entry, activeReason());
    }
    if (!core && !entry.surface) {
      terminals.delete(key);
      return;
    }
    terminals.set(key, entry);
  };

  const registerSurface = (widgetIdRaw: string, sessionIdRaw: string, surface: HTMLDivElement | null) => {
    const widgetId = compact(widgetIdRaw);
    const sessionId = compact(sessionIdRaw);
    if (!widgetId || !sessionId) {
      return;
    }
    const key = terminalKey(widgetId, sessionId);
    const entry = terminals.get(key) ?? {
      widgetId,
      sessionId,
      core: null,
      surface: null,
      suspend: null,
    };
    entry.surface = surface;
    if (!entry.core && !surface) {
      terminals.delete(key);
      return;
    }
    terminals.set(key, entry);
  };

  const setSelectedWidgetId = (widgetIdRaw: string | null | undefined) => {
    selectedWidgetId = compact(widgetIdRaw);
  };

  const beginInteraction = (kind: WorkbenchTerminalInteractionKind): WorkbenchTerminalInteractionToken => {
    const id = nextInteractionId;
    nextInteractionId += 1;
    activeInteractions.set(id, kind);
    suspendTerminals();
    let ended = false;
    return {
      id,
      kind,
      end: () => {
        if (ended) {
          return;
        }
        ended = true;
        activeInteractions.delete(id);
        if (activeInteractions.size === 0) {
          resumeTerminals();
        }
      },
    };
  };

  const dispose = () => {
    cancelResumeQueue();
    activeInteractions.clear();
    for (const entry of terminals.values()) {
      clearSuspend(entry);
    }
    terminals.clear();
  };

  return {
    beginInteraction,
    dispose,
    registerCore,
    registerSurface,
    setSelectedWidgetId,
  };
}
