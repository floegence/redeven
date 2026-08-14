import type { SemanticTerminalViewportHandle } from '../widgets/semanticTerminalViewport';

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
  viewport: SemanticTerminalViewportHandle | null;
  surface: HTMLDivElement | null;
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function terminalKey(widgetId: string, sessionId: string): string {
  return `${widgetId}\u001f${sessionId}`;
}

export function createWorkbenchTerminalVisualCoordinator() {
  const terminals = new Map<string, TerminalRegistration>();
  const activeInteractions = new Map<number, WorkbenchTerminalInteractionKind>();
  let nextInteractionId = 1;
  let selectedWidgetId = '';

  const deleteIfDetached = (key: string, entry: TerminalRegistration) => {
    if (!entry.viewport && !entry.surface) {
      terminals.delete(key);
    }
  };

  const registerViewport = (
    widgetIdRaw: string,
    sessionIdRaw: string,
    viewport: SemanticTerminalViewportHandle | null,
  ) => {
    const widgetId = compact(widgetIdRaw);
    const sessionId = compact(sessionIdRaw);
    if (!widgetId || !sessionId) {
      return;
    }
    const key = terminalKey(widgetId, sessionId);
    const entry = terminals.get(key) ?? {
      widgetId,
      sessionId,
      viewport: null,
      surface: null,
    };
    entry.viewport = viewport;
    terminals.set(key, entry);
    deleteIfDetached(key, entry);
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
      viewport: null,
      surface: null,
    };
    entry.surface = surface;
    terminals.set(key, entry);
    deleteIfDetached(key, entry);
  };

  const setSelectedWidgetId = (widgetIdRaw: string | null | undefined) => {
    selectedWidgetId = compact(widgetIdRaw);
  };

  const beginInteraction = (kind: WorkbenchTerminalInteractionKind): WorkbenchTerminalInteractionToken => {
    const id = nextInteractionId;
    nextInteractionId += 1;
    activeInteractions.set(id, kind);
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
      },
    };
  };

  const dispose = () => {
    activeInteractions.clear();
    terminals.clear();
    selectedWidgetId = '';
  };

  const getDiagnostics = () => ({
    activeInteractionCount: activeInteractions.size,
    registeredTerminalCount: terminals.size,
    selectedWidgetId,
  });

  return {
    beginInteraction,
    dispose,
    getDiagnostics,
    registerViewport,
    registerSurface,
    setSelectedWidgetId,
  };
}
