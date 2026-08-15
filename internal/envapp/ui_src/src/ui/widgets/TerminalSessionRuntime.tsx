import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';

import {
  getThemeColors,
  presentationAdvances,
  RendererSurface,
  SEMANTIC_CELL_HEIGHT_CSS_PX,
  SEMANTIC_CELL_WIDTH_CSS_PX,
  SEMANTIC_TERMINAL_FONT_FAMILY,
  TerminalInputBridge,
  validatePresentation,
  type SemanticFrame,
  type SemanticHistoryPage,
  type SemanticHistoryRequest,
  type SemanticPresentation,
  type SemanticTerminalCellMetrics,
  type SemanticTerminalPalette,
  type TerminalKeyInputIntent,
} from '@floegence/floeterm-terminal-web/semantic';
import type { TerminalSessionInfo } from '../protocol/redeven_v1/sdk/terminal';
import type { TerminalNameUpdateEvent } from '../protocol/redeven_v1/sdk/terminal';
import type {
  RedevenTerminalEventSource,
  RedevenTerminalTransport,
} from '../services/terminalTransport';
import type { TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import type { TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import {
  isSemanticTerminalPalette,
  resolveSemanticTerminalLinkAtPoint,
} from './semanticTerminalViewport';
import type {
  SemanticTerminalAppearance,
  SemanticTerminalCopyResult,
  SemanticTerminalSearchResult,
  SemanticTerminalViewportHandle,
} from './semanticTerminalViewport';
import type { TerminalSharedGeometryPresentation } from './terminalSharedGeometryPresentation';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';

type SessionLoadingState = 'initializing' | 'attaching' | 'reconnecting' | 'idle';
type GridSize = Readonly<{ cols: number; rows: number }>;
type EffectiveGeometry = GridSize & Readonly<{
  generation: number;
  presentationSequence: number;
}>;

const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 1;
const MAX_TERMINAL_COLS = 500;
const MAX_TERMINAL_ROWS = 200;
const SEMANTIC_HISTORY_PAGE_LIMIT = 200;
const SEMANTIC_HISTORY_MAX_PAGE_CELLS = 1024;
const RECONNECT_DELAYS_MS = [100, 300, 900] as const;

export function shouldPublishTerminalOutputCoverage(
  previousAttachGeneration: number,
  previousCoveredThroughSequence: number,
  nextAttachGeneration: number,
  nextCoveredThroughSequence: number,
): boolean {
  return previousAttachGeneration !== nextAttachGeneration
    || nextCoveredThroughSequence > previousCoveredThroughSequence;
}

function sameGrid(left: GridSize | null, right: GridSize): boolean {
  return left?.cols === right.cols && left.rows === right.rows;
}

function frameLines(frame: SemanticFrame | null): string[] {
  if (!frame) return [];
  return frame.rows.map((row) => row.cells.map((cell) => cell.text).join('').trimEnd());
}

function frameText(frame: SemanticFrame | null): string {
  return frameLines(frame).join('\n').replace(/\n+$/, '');
}

function semanticHistoryPageLimit(frame: SemanticFrame): number {
  return Math.max(1, Math.min(
    SEMANTIC_HISTORY_PAGE_LIMIT,
    Math.floor(SEMANTIC_HISTORY_MAX_PAGE_CELLS / Math.max(1, frame.width)),
  ));
}

function auxiliaryTerminalErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = Number((error as Error & { code?: unknown }).code);
  const safeCode = Number.isInteger(code) ? `:${code}` : '';
  const safeMessage = error.message.replace(/[\r\n\0]/gu, ' ').slice(0, 160);
  const cause = (error as Error & { cause?: unknown }).cause;
  const safeCause = cause instanceof Error
    ? `; cause=${cause.name}:${cause.message.replace(/[\r\n\0]/gu, ' ').slice(0, 160)}`
    : '';
  return `${error.name}${safeCode}:${safeMessage}${safeCause}`;
}

function terminalPalette(colors: Readonly<Record<string, string>>): SemanticTerminalPalette {
  if (isSemanticTerminalPalette(colors)) return { ...colors };
  const fallback = getThemeColors('dark');
  return {
    ...fallback,
    ...(typeof colors.background === 'string' ? { background: colors.background } : {}),
    ...(typeof colors.foreground === 'string' ? { foreground: colors.foreground } : {}),
    ...(typeof colors.cursor === 'string' ? { cursor: colors.cursor } : {}),
    ...(typeof colors.cursorAccent === 'string' ? { cursorAccent: colors.cursorAccent } : {}),
  };
}

function copyResult(
  copied: boolean,
  source: 'shortcut' | 'command',
  textLength = 0,
): SemanticTerminalCopyResult {
  return copied
    ? { copied: true, source, textLength }
    : { copied: false, source, reason: 'clipboard_unavailable' };
}

export type TerminalSessionRuntimeActions = Readonly<{
  reload: () => Promise<void>;
  retryOutputRecovery: () => Promise<void>;
  focusIfInteractive: () => 'focused' | 'not_interactive' | 'selection_active';
}>;

export type TerminalSessionRuntimeStatus = Readonly<{
  state: 'idle' | 'reconnecting' | 'retrying' | 'degraded' | 'blocking';
  failureCode?: string;
  retryable?: boolean;
  diagnosticsQuery?: string;
}>;

export type TerminalSessionRuntimeProps = Readonly<{
  session: TerminalSessionInfo;
  variant: 'panel' | 'workbench';
  active: () => boolean;
  connected: () => boolean;
  protocolClient: () => unknown;
  viewActive: () => boolean;
  autoFocus: () => boolean;
  themeColors: () => Record<string, string>;
  fontSize: () => number;
  fontFamily: () => string;
  agentHomePathAbs: () => string;
  canOpenFilePreview: () => boolean;
  bottomInsetPx: () => number;
  connId: string;
  transport: RedevenTerminalTransport;
  eventSource: RedevenTerminalEventSource;
  registerViewport: (sessionId: string, viewport: SemanticTerminalViewportHandle | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: TerminalSessionRuntimeActions | null) => void;
  onRuntimeStatus?: (sessionId: string, status: TerminalSessionRuntimeStatus) => void;
  onGeometryPresentation?: (
    sessionId: string,
    presentation: TerminalSharedGeometryPresentation | null,
  ) => void;
  onSessionGone?: (sessionId: string) => void;
  onInteractive?: (sessionId: string) => void;
  onLiveOutputObserved?: (sessionId: string, byteLength: number, sequence: number | undefined) => void;
  onOutputCommitted?: (sessionId: string, source: 'history' | 'live', sequence: number | undefined) => void;
  onOutputCoverage?: (
    sessionId: string,
    update: { attachGeneration: number; coveredThroughSequence: number; rebased?: boolean },
  ) => void;
  onHistorySummary?: (
    sessionId: string,
    summary: Readonly<{ revision: number; totalRows: number; screenStartOffset: number }>,
  ) => void;
  onPendingOutputReset?: (sessionId: string, opts?: { preserveUnread?: boolean }) => void;
  onSurfaceClick?: (event: MouseEvent) => void;
  onBell?: (sessionId: string) => void;
  onShellIntegrationEvent?: (
    sessionId: string,
    event: TerminalShellIntegrationEvent,
    source: 'history' | 'live',
  ) => void;
  onVisibleOutput?: (
    sessionId: string,
    source: 'history' | 'live',
    byteLength: number,
    sequence: number | undefined,
  ) => void;
  onTerminalFileLinkOpen?: (target: TerminalResolvedLinkTarget) => Promise<void> | void;
  onTerminalExternalLinkOpen?: (url: string) => Promise<void> | void;
  onNameUpdate?: (
    sessionId: string,
    newName: string,
    workingDir: string,
    localPathCapability: TerminalNameUpdateEvent['localPathCapability'],
  ) => void;
  requestPreparedHistory?: (sessionId: string) => Promise<unknown>;
}>;

type SearchMatch = Readonly<{
  page: SemanticHistoryPage;
  frame: SemanticFrame;
  line: number;
}>;

export function TerminalSessionRuntime(props: TerminalSessionRuntimeProps) {
  const i18n = useI18n();
  const sessionId = String(props.session.id ?? '').trim();
  const [loading, setLoading] = createSignal<SessionLoadingState>('initializing');
  const [ready, setReady] = createSignal(false);
  const [runtimeError, setRuntimeError] = createSignal('');
  const [historyPage, setHistoryPage] = createSignal<SemanticHistoryPage | null>(null);
  const [historyProjected, setHistoryProjected] = createSignal(false);
  const [historyBusy, setHistoryBusy] = createSignal(false);
  const [historyError, setHistoryError] = createSignal(false);
  const [historyErrorDetail, setHistoryErrorDetail] = createSignal('');
  const [historyRequestTrace, setHistoryRequestTrace] = createSignal({
    count: 0,
    direction: '' as SemanticHistoryRequest['direction'] | '',
    state: 'idle' as 'idle' | 'pending' | 'settled' | 'error',
    revision: 0,
    offset: 0,
  });
  const [presentationRevision, setPresentationRevision] = createSignal(0);
  const [geometryRevision, setGeometryRevision] = createSignal(0);
  const [controllerRevision, setControllerRevision] = createSignal(0);

  let host: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let inputElement: HTMLTextAreaElement | null = null;
  let renderer: RendererSurface | null = null;
  let inputBridge: TerminalInputBridge | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let latestPresentation: SemanticPresentation | null = null;
  let latestEffectiveGeometry: EffectiveGeometry | null = null;
  let controllerEpoch = 0;
  let isController = false;
  let desiredSize: GridSize | null = null;
  let appliedSize: GridSize | null = null;
  let inFlightSize: GridSize | null = null;
  let resizeWork: Promise<void> | null = null;
  let attached = false;
  let attachWork: Promise<void> | null = null;
  let runtimeAttachGeneration = 0;
  let attachmentOperation = 0;
  let disposed = false;
  let lastProtocolClient: unknown;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReconnectError: Error | null = null;
  let historyRequestEpoch = 0;
  let searchRequestEpoch = 0;
  let searchQuery = '';
  let searchMatches: SearchMatch[] = [];
  let searchIndex = -1;
  let searchState: SemanticTerminalSearchResult['state'] = 'idle';
  let searchCallback: ((result: SemanticTerminalSearchResult) => void) | null = null;
  let retryHistoryRequest: (() => void) | null = null;
  let pendingHistoryDirection: 'forward' | 'backward' | null = null;
  let lastBell = 0;
  let geometryLifecycleEpoch = 0;
  let geometryRendererEpoch = 1;
  let geometryRequestEpoch = 0;
  let appliedTypography: Readonly<{ fontSize: number; fontFamily: string }> | null = null;
  let desiredActivationSize: GridSize | null = null;
  let activationWork: Promise<void> | null = null;
  let interactionTail: Promise<void> = Promise.resolve();
  let pendingInteractions = 0;

  const currentFrame = (): SemanticFrame | null => (
    historyProjected() ? historyPage()?.frame ?? null : latestPresentation?.frame ?? null
  );

  const historySummary = createMemo(() => {
    void presentationRevision();
    const frame = latestPresentation?.frame;
    return {
      totalRows: frame?.history.totalRows ?? 0,
      screenStartOffset: frame?.history.screenStartOffset ?? 0,
    };
  });
  const resolvedPalette = createMemo(() => terminalPalette(props.themeColors()));

  const cellMetrics = (): SemanticTerminalCellMetrics => renderer?.getCellMetrics() ?? {
    cellWidthCssPx: SEMANTIC_CELL_WIDTH_CSS_PX,
    cellHeightCssPx: SEMANTIC_CELL_HEIGHT_CSS_PX,
  };

  const applyTypography = (fontSize: number, fontFamily: string): boolean => {
    if (!renderer) return false;
    if (
      appliedTypography?.fontSize === fontSize
      && appliedTypography.fontFamily === fontFamily
    ) {
      return false;
    }
    renderer.setTypography({ fontSizeCssPx: fontSize, fontFamily });
    appliedTypography = { fontSize, fontFamily };
    inputBridge?.syncGeometry();
    return true;
  };

  const historyMaximum = createMemo(() => Math.max(0, historySummary().screenStartOffset));
  const historyCurrent = createMemo(() => (
    historyProjected()
      ? Math.min(historyMaximum(), historyPage()?.offset ?? historyMaximum())
      : historyMaximum()
  ));
  const historyThumbSize = createMemo(() => {
    const totalRows = historyPage()?.totalRows ?? historySummary().totalRows;
    const visibleRows = currentFrame()?.height ?? 0;
    if (totalRows <= 0 || visibleRows <= 0) return 100;
    return Math.max(8, Math.min(100, visibleRows / totalRows * 100));
  });
  const historyThumbStart = createMemo(() => {
    const maximum = historyMaximum();
    if (maximum <= 0) return 0;
    return Math.min(
      100 - historyThumbSize(),
      historyCurrent() / maximum * (100 - historyThumbSize()),
    );
  });

  const setStatus = (status: TerminalSessionRuntimeStatus) => {
    props.onRuntimeStatus?.(sessionId, status);
  };

  const failClosed = (error: unknown, code = 'semantic_terminal_unavailable') => {
    const message = error instanceof Error ? error.message : String(error);
    setRuntimeError(message || i18n.t('terminal.terminalUnavailable'));
    setStatus({ state: 'blocking', failureCode: code, retryable: false });
  };

  const measure = (): GridSize => {
    const width = host?.clientWidth ?? 0;
    const height = host?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) {
      return appliedSize ?? desiredSize ?? { cols: 80, rows: 24 };
    }
    const metrics = cellMetrics();
    return {
      cols: Math.max(
        MIN_TERMINAL_COLS,
        Math.min(MAX_TERMINAL_COLS, Math.floor(width / metrics.cellWidthCssPx)),
      ),
      rows: Math.max(
        MIN_TERMINAL_ROWS,
        Math.min(MAX_TERMINAL_ROWS, Math.floor(height / metrics.cellHeightCssPx)),
      ),
    };
  };

  const syncInputGeometry = () => {
    if (!canvas || !inputElement) return;
    const metrics = cellMetrics();
    canvas.dataset.terminalCellWidth = String(metrics.cellWidthCssPx);
    canvas.dataset.terminalCellHeight = String(metrics.cellHeightCssPx);
    const rect = renderer?.getCursorLayoutRect() ?? {
      left: 0,
      top: 0,
      width: Math.min(metrics.cellWidthCssPx, Math.max(1, canvas.clientWidth)),
      height: Math.min(metrics.cellHeightCssPx, Math.max(1, canvas.clientHeight)),
    };
    inputElement.style.left = `${rect.left}px`;
    inputElement.style.top = `${rect.top}px`;
    inputElement.style.width = `${Math.max(1, rect.width)}px`;
    inputElement.style.height = `${Math.max(1, rect.height)}px`;
    inputElement.style.lineHeight = `${Math.max(1, rect.height)}px`;
    inputElement.style.font = `${appliedTypography?.fontSize ?? 14}px ${appliedTypography?.fontFamily ?? SEMANTIC_TERMINAL_FONT_FAMILY}`;
  };

  const publishGeometryPresentation = (local: GridSize, effective: EffectiveGeometry) => {
    props.onGeometryPresentation?.(sessionId, {
      lifecycleEpoch: geometryLifecycleEpoch,
      rendererEpoch: geometryRendererEpoch,
      requestEpoch: geometryRequestEpoch,
      local: { ...local },
      effective: {
        lifecycleEpoch: geometryLifecycleEpoch,
        rendererEpoch: geometryRendererEpoch,
        generation: effective.generation,
        presentationSequence: effective.presentationSequence,
        cols: effective.cols,
        rows: effective.rows,
      },
    });
  };

  const acceptEffectiveGeometry = (geometry: EffectiveGeometry, local: GridSize) => {
    if (
      latestEffectiveGeometry
      && (
        geometry.generation < latestEffectiveGeometry.generation
        || geometry.presentationSequence < latestEffectiveGeometry.presentationSequence
      )
    ) {
      throw new Error('terminal geometry settlement regressed');
    }
    if (
      latestEffectiveGeometry
      && geometry.generation === latestEffectiveGeometry.generation
      && !sameGrid(latestEffectiveGeometry, geometry)
    ) {
      throw new Error('terminal geometry changed without advancing its generation');
    }
    latestEffectiveGeometry = { ...geometry };
    appliedSize = { cols: geometry.cols, rows: geometry.rows };
    setGeometryRevision((value) => value + 1);
    publishGeometryPresentation(local, geometry);
  };

  const acceptController = (controller: Readonly<{ epoch: number; isController: boolean }>) => {
    if (controller.epoch < controllerEpoch) return;
    if (controller.epoch === controllerEpoch && controller.isController !== isController) {
      throw new Error('terminal controller ownership changed without advancing its epoch');
    }
    controllerEpoch = controller.epoch;
    isController = controller.isController;
    setControllerRevision((value) => value + 1);
  };

  const resetController = () => {
    controllerEpoch = 0;
    isController = false;
    setControllerRevision((value) => value + 1);
  };

  const runAttach = async (): Promise<void> => {
    if (disposed || !props.connected()) return;
    const operation = ++attachmentOperation;
    const requested = desiredSize ?? measure();
    desiredSize = requested;
    geometryLifecycleEpoch += 1;
    geometryRequestEpoch += 1;
    setLoading(ready() ? 'reconnecting' : 'attaching');
    setStatus({ state: ready() ? 'reconnecting' : 'idle' });
    try {
      const result = await props.transport.attachWithPresentation(
        sessionId,
        requested.cols,
        requested.rows,
      );
      if (disposed || operation !== attachmentOperation) return;
      attached = true;
      runtimeAttachGeneration = result.runtimeAttachGeneration;
      acceptController({ epoch: result.controllerEpoch, isController: result.isController });
      reconnectAttempt = 0;
      lastReconnectError = null;
      acceptEffectiveGeometry({
        generation: result.geometryGeneration,
        presentationSequence: result.presentationSequence,
        cols: result.cols,
        rows: result.rows,
      }, requested);
      if (appliedSize && sameGrid(desiredSize, appliedSize)) desiredSize = null;
      setRuntimeError('');
      setStatus({ state: 'idle' });
      if (desiredSize) void startResizeWork();
    } catch (error) {
      if (disposed || operation !== attachmentOperation) return;
      attached = false;
      runtimeAttachGeneration = 0;
      lastReconnectError = error instanceof Error ? error : new Error(String(error));
      failClosed(error, 'terminal_attach_failed');
      throw error;
    }
  };

  const attach = (): Promise<void> => {
    if (attachWork) return attachWork;
    const work = runAttach().finally(() => {
      if (attachWork === work) attachWork = null;
    });
    attachWork = work;
    return work;
  };

  const runResizeWork = async () => {
    while (!disposed && attached && desiredSize) {
      const requested = desiredSize;
      desiredSize = null;
      if (sameGrid(appliedSize, requested)) continue;
      inFlightSize = requested;
      geometryRequestEpoch += 1;
      try {
        const result = await props.transport.resizeWithEffectiveGeometry(
          sessionId,
          requested.cols,
          requested.rows,
        );
        if (disposed || !attached) return;
        if (result.runtimeAttachGeneration !== runtimeAttachGeneration) {
          throw new Error('terminal resize settled for a stale attachment generation');
        }
        if (!sameGrid(result.requested, requested)) {
          throw new Error('terminal resize settlement changed the requested geometry');
        }
        acceptEffectiveGeometry(result.effective, requested);
        setRuntimeError('');
        setStatus({ state: 'idle' });
      } catch (error) {
        if (!disposed && attached) failClosed(error, 'terminal_resize_failed');
        return;
      } finally {
        inFlightSize = null;
      }
    }
  };

  const startResizeWork = (): Promise<void> => {
    if (!resizeWork) {
      resizeWork = runResizeWork().finally(() => {
        resizeWork = null;
        if (!disposed && attached && desiredSize) void startResizeWork();
      });
    }
    return resizeWork;
  };

  const requestResize = async (): Promise<void> => {
    if (disposed) return;
    renderer?.resize();
    inputBridge?.syncGeometry();
    const next = measure();
    if (!attached) {
      desiredSize = next;
      if (props.connected()) await attach();
      return;
    }
    desiredSize = inFlightSize && sameGrid(inFlightSize, next)
      ? null
      : sameGrid(appliedSize, next) ? null : next;
    await startResizeWork();
  };

  const runActivationWork = async (): Promise<void> => {
    while (!disposed && desiredActivationSize) {
      const requested = desiredActivationSize;
      desiredActivationSize = null;
      if (!attached) {
        desiredSize = requested;
        await attach();
      }
      if (disposed) return;
      if (!attached || runtimeAttachGeneration <= 0) {
        throw new Error('terminal view activation requires a live attachment');
      }
      if (isController && sameGrid(appliedSize, requested)) continue;

      const result = await props.transport.activate(
        sessionId,
        requested.cols,
        requested.rows,
      );
      if (disposed) return;
      if (result.runtimeAttachGeneration !== runtimeAttachGeneration) {
        throw new Error('terminal view activation settled for a stale attachment generation');
      }
      if (!sameGrid(result.requested, requested)) {
        throw new Error('terminal view activation changed the requested geometry');
      }
      if (!result.controller.isController) {
        throw new Error('terminal view activation did not grant controller ownership');
      }
      acceptController(result.controller);
      acceptEffectiveGeometry(result.effective, requested);
      setRuntimeError('');
      setStatus({ state: 'idle' });
    }
  };

  const activateCurrentView = (): Promise<void> => {
    if (disposed || !props.connected() || !props.viewActive() || !props.active()) {
      return Promise.resolve();
    }
    desiredActivationSize = measure();
    if (!activationWork) {
      activationWork = runActivationWork()
        .catch((error) => {
          if (!disposed) failClosed(error, 'terminal_activation_failed');
          throw error;
        })
        .finally(() => {
          activationWork = null;
          if (!disposed && desiredActivationSize) void activateCurrentView();
        });
    }
    return activationWork;
  };

  const focusAfterActivation = (requireAutoFocus: boolean) => {
    const canFocus = () => (
      !disposed
      && props.active()
      && props.viewActive()
      && (!requireAutoFocus || props.autoFocus())
      && !renderer?.hasSelection()
    );
    if (!canFocus()) return;
    void activateCurrentView().then(() => {
      if (canFocus()) inputBridge?.focus({ preventScroll: true });
    }).catch(() => undefined);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (disposed || !props.connected() || reconnectTimer !== null) return;
    if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      failClosed(
        lastReconnectError ?? new Error('terminal live attachment could not be restored'),
        'terminal_reconnect_exhausted',
      );
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempt] ?? RECONNECT_DELAYS_MS.at(-1)!;
    reconnectAttempt += 1;
    setLoading('reconnecting');
    setStatus({ state: 'reconnecting', retryable: true });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void attach().catch(() => {
        if (!disposed) scheduleReconnect();
      });
    }, delay);
  };

  const dispatchInteraction = (send: () => Promise<void>) => {
    const run = async () => {
      if (!props.connected() || !props.viewActive() || !props.active()) return;
      await activateCurrentView();
      if (!props.connected() || !props.viewActive() || !props.active()) return;
      try {
        await send();
      } catch (error) {
        if (!disposed) failClosed(error, 'terminal_input_failed');
        throw error;
      }
    };
    if (pendingInteractions === 0 && isController && sameGrid(appliedSize, measure())) {
      void send().catch((error) => failClosed(error, 'terminal_input_failed'));
      return;
    }
    pendingInteractions += 1;
    const next = interactionTail.then(run, run).finally(() => {
      pendingInteractions -= 1;
    });
    interactionTail = next.catch(() => undefined);
    void next.catch(() => undefined);
  };

  const sendInput = (data: string) => {
    if (!data || !props.connected() || !props.viewActive() || !props.active()) return;
    dispatchInteraction(() => props.transport.sendInput(sessionId, data));
  };

  const sendInputIntent = (intent: TerminalKeyInputIntent) => {
    if (!props.connected() || !props.viewActive() || !props.active()) return;
    dispatchInteraction(() => props.transport.sendInputIntent(sessionId, intent));
  };

  function publishSearchResult() {
    searchCallback?.({
      resultIndex: searchIndex,
      resultCount: searchMatches.length,
      state: searchState,
      retryable: searchState === 'error',
    });
  }

  const resetSearch = () => {
    searchRequestEpoch += 1;
    searchQuery = '';
    searchMatches = [];
    searchIndex = -1;
    searchState = 'idle';
    publishSearchResult();
  };

  const showLatestPresentation = () => {
    historyRequestEpoch += 1;
    resetSearch();
    retryHistoryRequest = null;
    setHistoryRequestTrace((previous) => ({
      ...previous,
      direction: '',
      state: 'idle',
      revision: 0,
      offset: 0,
    }));
    setHistoryError(false);
    setHistoryErrorDetail('');
    setHistoryProjected(false);
    setHistoryPage(null);
    renderer?.project(null);
  };

  const queryHistory = async (
    direction: SemanticHistoryRequest['direction'],
    project: boolean,
    retry: () => void,
    anchorOverride?: string,
  ): Promise<SemanticHistoryPage | null> => {
    const presentation = latestPresentation;
    if (!presentation) return null;
    const current = historyPage();
    if ((direction === 'forward' || direction === 'backward') && !current) return null;
    const requestEpoch = ++historyRequestEpoch;
    setHistoryRequestTrace((previous) => ({
      ...previous,
      count: previous.count + 1,
      direction,
      state: 'pending',
      revision: 0,
      offset: 0,
    }));
    try {
      const page = await props.transport.semanticHistory(sessionId, {
        ...(direction === 'forward' || direction === 'backward'
          ? { anchor: anchorOverride ?? current!.anchor }
          : {}),
        direction,
        limit: Math.min(semanticHistoryPageLimit(presentation.frame), presentation.frame.height),
      });
      if (requestEpoch !== historyRequestEpoch) return null;
      setHistoryRequestTrace((previous) => ({
        ...previous,
        state: 'settled',
        revision: page.revision,
        offset: page.offset,
      }));
      retryHistoryRequest = null;
      setHistoryError(false);
      setHistoryErrorDetail('');
      setHistoryPage(page);
      if (project && page.offset < page.screenStartOffset) {
        setHistoryProjected(true);
        renderer?.project(page.frame);
      } else {
        setHistoryProjected(false);
        renderer?.project(null);
      }
      return page;
    } catch (error) {
      if (requestEpoch !== historyRequestEpoch) return null;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setHistoryRequestTrace((previous) => ({ ...previous, state: 'idle' }));
        return null;
      }
      setHistoryRequestTrace((previous) => ({ ...previous, state: 'error' }));
      retryHistoryRequest = retry;
      setHistoryError(true);
      setHistoryErrorDetail(auxiliaryTerminalErrorDetail(error));
      setHistoryProjected(false);
      setHistoryPage(null);
      renderer?.project(null);
      return null;
    }
  };

  const projectHistoryStart = () => {
    void queryHistory('start', true, projectHistoryStart);
  };

  const scrollHistory = async (direction: 'forward' | 'backward') => {
    if (!latestPresentation) return;
    if (historyBusy()) {
      pendingHistoryDirection = direction;
      return;
    }
    resetSearch();
    if (direction === 'forward' && !historyProjected()) return;
    setHistoryBusy(true);
    try {
      let current = historyPage();
      if (!current) {
        current = await queryHistory('end', false, () => { void scrollHistory(direction); });
      }
      if (!current) return;
      if (direction === 'backward' && !current.hasPrevious) return;
      if (direction === 'forward' && !current.hasNext) {
        showLatestPresentation();
        return;
      }
      await queryHistory(
        direction,
        true,
        () => { void scrollHistory(direction); },
        direction === 'backward' && !historyProjected() ? current.screenStart : undefined,
      );
    } finally {
      setHistoryBusy(false);
      const pending = pendingHistoryDirection;
      pendingHistoryDirection = null;
      if (pending) queueMicrotask(() => { void scrollHistory(pending); });
    }
  };

  const scanHistory = async (query: string, requestEpoch: number) => {
    const presentation = latestPresentation;
    if (!presentation) return;
    const normalized = query.toLocaleLowerCase();
    const matches: SearchMatch[] = [];
    const pageLimit = semanticHistoryPageLimit(presentation.frame);
    let page = await props.transport.semanticHistory(sessionId, {
      direction: 'start',
      limit: pageLimit,
    });
    let pageRevision = page.revision;
    // The server may lower the requested page size to stay below its RPC
    // transport budget. One-row progress is the strict lower bound.
    const maxPages = page.totalRows + 1;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      if (requestEpoch !== searchRequestEpoch) return;
      if (page.revision < pageRevision) {
        throw new Error('terminal history revision regressed while searching');
      }
      pageRevision = page.revision;
      frameLines(page.frame).forEach((line, lineIndex) => {
        if (line.toLocaleLowerCase().includes(normalized)) {
          matches.push({ page, frame: page.frame, line: lineIndex });
        }
      });
      if (!page.hasNext) break;
      const previousOffset = page.offset;
      const nextPage = await props.transport.semanticHistory(sessionId, {
        anchor: page.anchor,
        direction: 'forward',
        limit: pageLimit,
      });
      if (nextPage.offset <= previousOffset) {
        throw new Error('terminal history offset did not advance while searching');
      }
      page = nextPage;
    }
    if (requestEpoch !== searchRequestEpoch) return;
    searchMatches = matches;
    searchIndex = matches.length > 0 ? 0 : -1;
    searchState = 'ready';
    if (searchIndex >= 0) {
      setHistoryPage(matches[searchIndex]!.page);
      setHistoryProjected(true);
      renderer?.project(matches[searchIndex]!.frame);
    } else {
      setHistoryPage(null);
      setHistoryProjected(false);
      renderer?.project(null);
    }
    publishSearchResult();
  };

  const find = (query: string, delta: 1 | -1) => {
    const normalized = query.trim();
    if (!normalized) {
      viewport.clearSearch();
      return;
    }
    if (normalized !== searchQuery || searchState === 'error') {
      historyRequestEpoch += 1;
      pendingHistoryDirection = null;
      setHistoryProjected(false);
      setHistoryPage(null);
      renderer?.project(null);
      searchQuery = normalized;
      searchMatches = [];
      searchIndex = -1;
      searchState = 'searching';
      publishSearchResult();
      const requestEpoch = ++searchRequestEpoch;
      void scanHistory(normalized, requestEpoch).catch((error) => {
        if (
          requestEpoch === searchRequestEpoch
          && !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          searchMatches = [];
          searchIndex = -1;
          searchState = 'error';
          setHistoryProjected(false);
          setHistoryPage(null);
          renderer?.project(null);
          publishSearchResult();
        }
      });
      return;
    }
    if (searchMatches.length === 0) return;
    searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length;
    setHistoryPage(searchMatches[searchIndex]!.page);
    setHistoryProjected(true);
    renderer?.project(searchMatches[searchIndex]!.frame);
    publishSearchResult();
  };

  const copySelection = async (
    source: 'shortcut' | 'command' | 'copy_event',
    clipboardData?: DataTransfer | null,
  ): Promise<SemanticTerminalCopyResult | Readonly<{
    copied: true;
    source: 'copy_event';
    textLength: number;
  }> | Readonly<{
    copied: false;
    source: 'copy_event';
    reason: 'empty_selection' | 'clipboard_unavailable';
  }>> => {
    const text = renderer?.getSelectionText() ?? '';
    if (!text) return { copied: false, source, reason: 'empty_selection' };
    if (clipboardData) {
      clipboardData.setData('text/plain', text);
      return { copied: true, source, textLength: text.length };
    }
    if (!navigator.clipboard?.writeText) {
      return source === 'copy_event'
        ? { copied: false, source, reason: 'clipboard_unavailable' }
        : copyResult(false, source);
    }
    await navigator.clipboard.writeText(text);
    return source === 'copy_event'
      ? { copied: true, source, textLength: text.length }
      : copyResult(true, source, text.length);
  };

  const viewport: SemanticTerminalViewportHandle = {
    activate: activateCurrentView,
    focus: (options) => inputBridge?.focus(options),
    forceResize: () => { void requestResize(); },
    setAppearance: (appearance: SemanticTerminalAppearance) => {
      renderer?.setPalette(terminalPalette(appearance.theme));
      if (applyTypography(appearance.fontSize, appearance.fontFamily)) {
        void requestResize();
      }
    },
    getDimensions: () => appliedSize ?? measure(),
    getTerminalInfo: () => {
      const frame = currentFrame();
      return {
        rows: frame?.height ?? 0,
        cols: frame?.width ?? 0,
        bufferLength: frame?.history.totalRows ?? 0,
      };
    },
    readBufferLine: (row, options) => {
      const frame = currentFrame();
      if (!frame) return '';
      const firstRow = historyProjected()
        ? historyPage()?.offset ?? 0
        : frame.history.screenStartOffset;
      const localRow = row - firstRow;
      const text = frame.rows[localRow]?.cells.map((cell) => cell.text).join('') ?? '';
      return options?.trimRight === false ? text : text.trimEnd();
    },
    getVisibleScreenText: () => frameText(currentFrame()),
    getSelectionText: () => renderer?.getSelectionText() ?? '',
    hasSelection: () => renderer?.hasSelection() ?? false,
    copySelection: (source) => copySelection(source) as Promise<SemanticTerminalCopyResult>,
    getTouchScrollRuntime: () => ({
      isAlternateScreen: () => latestPresentation?.frame.bufferKind === 'alternate',
      getScrollbackLength: () => latestPresentation?.frame.history.screenStartOffset ?? 0,
      scrollLines: (lines) => {
        if (lines === 0) return;
        void scrollHistory(lines > 0 ? 'forward' : 'backward');
      },
      sendAlternateScreenInput: sendInput,
    }),
    setSearchResultsCallback: (callback) => {
      searchCallback = callback;
      publishSearchResult();
    },
    clearSearch: () => {
      showLatestPresentation();
    },
    findNext: (query) => find(query, 1),
    findPrevious: (query) => find(query, -1),
    getPresentation: () => latestPresentation,
  };

  const actions: TerminalSessionRuntimeActions = {
    reload: async () => {
      reconnectAttempt = 0;
      clearReconnectTimer();
      showLatestPresentation();
      attached = false;
      runtimeAttachGeneration = 0;
      props.transport.forgetSession(sessionId);
      await attach();
    },
    retryOutputRecovery: async () => {
      await actions.reload();
    },
    focusIfInteractive: () => {
      if (!props.active() || !props.viewActive()) return 'not_interactive';
      if (renderer?.hasSelection()) return 'selection_active';
      focusAfterActivation(false);
      return 'focused';
    },
  };

  const applyPresentation = (value: unknown) => {
    const presentation = validatePresentation(value);
    if (!presentationAdvances(latestPresentation, presentation)) return;
    const previous = latestPresentation;
    if (
      previous
      && (
        previous.frame.width !== presentation.frame.width
        || previous.frame.height !== presentation.frame.height
        || (previous.state.contentEpoch ?? 0) !== (presentation.state.contentEpoch ?? 0)
      )
    ) {
      showLatestPresentation();
    }
    latestPresentation = presentation;
    renderer?.apply(presentation);
    inputBridge?.syncGeometry();
    setPresentationRevision((value) => value + 1);
    setReady(true);
    setLoading('idle');
    setRuntimeError('');
    setStatus({ state: 'idle' });
    props.onOutputCommitted?.(sessionId, 'live', presentation.sequence);
    props.onOutputCoverage?.(sessionId, {
      attachGeneration: runtimeAttachGeneration,
      coveredThroughSequence: presentation.sequence,
    });
    props.onHistorySummary?.(sessionId, presentation.frame.history);
    if ((presentation.state.bell ?? 0) > lastBell) props.onBell?.(sessionId);
    lastBell = presentation.state.bell ?? lastBell;
    props.onInteractive?.(sessionId);
  };

  onMount(() => {
    if (!host || !canvas || !inputElement) {
      failClosed(new Error('semantic terminal surface is incomplete'));
      return;
    }

    renderer = new RendererSurface(canvas, (error) => failClosed(error, 'semantic_renderer_failed'));
    renderer.setVisible(props.active() && props.viewActive());
    renderer.setPalette(resolvedPalette());
    applyTypography(props.fontSize(), props.fontFamily());
    inputBridge = new TerminalInputBridge({
      inputHost: canvas,
      inputElement,
      onData: sendInput,
      onInputIntent: sendInputIntent,
      hasSelection: () => renderer?.hasSelection() ?? false,
      copySelection,
      syncInputGeometry,
    });
    props.registerViewport(sessionId, viewport);
    props.registerActions(sessionId, actions);

    const unsubscribePresentation = props.eventSource.onTerminalPresentation(
      sessionId,
      (value) => {
        try {
          applyPresentation(value);
        } catch (error) {
          failClosed(error, 'semantic_presentation_invalid');
        }
      },
    );
    const unsubscribeGeometry = props.eventSource.onTerminalGeometry(sessionId, (event) => {
      try {
        acceptEffectiveGeometry({
          generation: event.generation,
          presentationSequence: event.presentationSequence,
          cols: event.cols,
          rows: event.rows,
        }, measure());
      } catch (error) {
        failClosed(error, 'semantic_geometry_invalid');
      }
    });
    const unsubscribeController = props.eventSource.onTerminalController(sessionId, (event) => {
      try {
        acceptController(event);
      } catch (error) {
        failClosed(error, 'semantic_controller_invalid');
      }
    });
    const unsubscribeLifecycle = props.eventSource.onTerminalLiveAttachmentLifecycle(
      sessionId,
      (event) => {
        if (event.state === 'attached') {
          attached = true;
          runtimeAttachGeneration = event.runtimeAttachGeneration;
          reconnectAttempt = 0;
          clearReconnectTimer();
          return;
        }
        if (event.runtimeAttachGeneration !== runtimeAttachGeneration && runtimeAttachGeneration > 0) return;
        showLatestPresentation();
        attached = false;
        runtimeAttachGeneration = 0;
        resetController();
        appliedSize = null;
        latestEffectiveGeometry = null;
        props.onGeometryPresentation?.(sessionId, null);
        if (event.reason === 'session_closed' || event.reason === 'session_deleted') {
          props.onSessionGone?.(sessionId);
          return;
        }
        if (event.reason === 'disposed' || event.reason === 'detached') return;
        if (event.reason === 'superseded' && attachmentOperation > 0) return;
        scheduleReconnect();
      },
    );
    const unsubscribeDeleted = props.eventSource.onSessionDeleted(sessionId, () => {
      props.onSessionGone?.(sessionId);
    });
    const unsubscribeName = props.eventSource.onTerminalNameUpdate?.(sessionId, (event) => {
      props.onNameUpdate?.(
        sessionId,
        event.newName,
        event.workingDir,
        event.localPathCapability,
      );
    });

    resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => { void requestResize(); });
    resizeObserver?.observe(host);
    const handleWindowResize = () => { void requestResize(); };
    const handleScroll = () => inputBridge?.syncGeometry();
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('scroll', handleScroll, true);
    document.fonts?.addEventListener?.('loadingdone', handleWindowResize);
    void document.fonts?.ready.then(handleWindowResize);
    syncInputGeometry();
    untrack(() => { void requestResize(); });

    onCleanup(() => {
      unsubscribePresentation();
      unsubscribeGeometry();
      unsubscribeController();
      unsubscribeLifecycle();
      unsubscribeDeleted();
      unsubscribeName?.();
      resizeObserver?.disconnect();
      resizeObserver = null;
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('scroll', handleScroll, true);
      document.fonts?.removeEventListener?.('loadingdone', handleWindowResize);
    });
  });

  createEffect(() => {
    renderer?.setPalette(resolvedPalette());
  });

  createEffect(() => {
    const visible = props.active() && props.viewActive();
    if (!renderer) return;
    if (!visible) {
      renderer.setVisible(false);
      if (canvas) canvas.dataset.terminalVisibilityCommit = 'hidden';
      return;
    }
    renderer.resize();
    renderer.setVisible(true);
    if (canvas) canvas.dataset.terminalVisibilityCommit = 'visible';
    inputBridge?.syncGeometry();
  });

  createEffect(() => {
    const fontSize = props.fontSize();
    const fontFamily = props.fontFamily();
    if (applyTypography(fontSize, fontFamily)) {
      void requestResize();
    }
  });

  createEffect(() => {
    const currentClient = props.protocolClient();
    const connected = props.connected();
    if (!connected || !currentClient) {
      if (lastProtocolClient !== undefined) {
        attachmentOperation += 1;
        showLatestPresentation();
        attached = false;
        runtimeAttachGeneration = 0;
        resetController();
        clearReconnectTimer();
      }
      lastProtocolClient = currentClient;
      setLoading('reconnecting');
      setStatus({ state: 'reconnecting', retryable: true });
      return;
    }
    if (lastProtocolClient === currentClient && (attached || resizeWork)) return;
    lastProtocolClient = currentClient;
    reconnectAttempt = 0;
    lastReconnectError = null;
    untrack(() => { void attach().catch(() => scheduleReconnect()); });
  });

  createEffect(() => {
    if (!props.active() || !props.viewActive() || !props.autoFocus() || !ready()) return;
    focusAfterActivation(true);
  });

  onCleanup(() => {
    disposed = true;
    attachmentOperation += 1;
    historyRequestEpoch += 1;
    searchRequestEpoch += 1;
    clearReconnectTimer();
    lastReconnectError = null;
    inputBridge?.dispose();
    inputBridge = null;
    renderer?.dispose();
    renderer = null;
    appliedTypography = null;
    props.transport.forgetSession(sessionId);
    props.registerViewport(sessionId, null);
    props.registerActions(sessionId, null);
    props.registerSurfaceElement(sessionId, null);
    props.onGeometryPresentation?.(sessionId, null);
    props.onRuntimeStatus?.(sessionId, { state: 'idle' });
  });

  const terminalBackground = () => resolvedPalette().background;
  const terminalForeground = () => resolvedPalette().foreground;
  const presentationTrace = () => {
    void presentationRevision();
    return latestPresentation;
  };
  const geometryTrace = () => {
    void geometryRevision();
    return latestEffectiveGeometry;
  };
  const controllerTrace = () => {
    void controllerRevision();
    return { epoch: controllerEpoch, isController };
  };
  const loadingMessage = createMemo(() => {
    if (loading() === 'attaching') return i18n.t('terminal.attaching');
    if (loading() === 'reconnecting') return i18n.t('terminal.reconnecting');
    return i18n.t('terminal.initializing');
  });

  const activateSemanticLink = (event: MouseEvent) => {
    if ((!event.metaKey && !event.ctrlKey) || renderer?.hasSelection()) return false;
    const frame = currentFrame();
    if (!frame || !canvas) return false;
    const target = resolveSemanticTerminalLinkAtPoint(frame, {
      clientX: event.clientX,
      clientY: event.clientY,
      bounds: canvas.getBoundingClientRect(),
      workingDirAbs: props.session.workingDir,
      agentHomePathAbs: props.agentHomePathAbs(),
    });
    if (!target) return false;
    if (target.kind === 'external') {
      void props.onTerminalExternalLinkOpen?.(target.url);
    } else if (props.canOpenFilePreview()) {
      void props.onTerminalFileLinkOpen?.(target.target);
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  return (
    <div
      aria-busy={!ready() || loading() !== 'idle'}
      class="h-full min-h-0 relative overflow-hidden"
      data-terminal-runtime-session={sessionId}
      data-terminal-renderer="semantic"
      data-terminal-session-active={props.active() ? 'true' : 'false'}
      data-terminal-view-active={props.viewActive() ? 'true' : 'false'}
      data-terminal-connected={props.connected() ? 'true' : 'false'}
      data-terminal-presentation-sequence={presentationTrace()?.sequence ?? ''}
      data-terminal-content-epoch={presentationTrace()?.state.contentEpoch ?? ''}
      data-terminal-frame-cols={presentationTrace()?.frame.width ?? ''}
      data-terminal-frame-rows={presentationTrace()?.frame.height ?? ''}
      data-terminal-buffer-kind={presentationTrace()?.frame.bufferKind ?? ''}
      data-terminal-geometry-generation={geometryTrace()?.generation ?? ''}
      data-terminal-geometry-sequence={geometryTrace()?.presentationSequence ?? ''}
      data-terminal-geometry-cols={geometryTrace()?.cols ?? ''}
      data-terminal-geometry-rows={geometryTrace()?.rows ?? ''}
      data-terminal-controller-epoch={controllerTrace().epoch || ''}
      data-terminal-is-controller={controllerTrace().isController ? 'true' : 'false'}
      data-terminal-history-projected={historyProjected() ? 'true' : 'false'}
      data-terminal-history-busy={historyBusy() ? 'true' : 'false'}
      data-terminal-history-offset={historyPage()?.offset ?? ''}
      data-terminal-history-request-count={historyRequestTrace().count}
      data-terminal-history-request-direction={historyRequestTrace().direction}
      data-terminal-history-request-state={historyRequestTrace().state}
      data-terminal-history-request-revision={historyRequestTrace().revision || ''}
      data-terminal-history-request-offset={historyRequestTrace().offset}
      style={{
        'background-color': terminalBackground(),
        '--terminal-bottom-inset': `${props.bottomInsetPx()}px`,
        '--background': terminalBackground(),
        '--foreground': terminalForeground(),
        '--primary': terminalForeground(),
        '--muted': `color-mix(in srgb, ${terminalForeground()} 12%, ${terminalBackground()})`,
        '--muted-foreground': `color-mix(in srgb, ${terminalForeground()} 70%, transparent)`,
        '--redeven-terminal-loading-background': terminalBackground(),
        '--redeven-terminal-loading-foreground': terminalForeground(),
      }}
    >
      <div
        ref={(node) => {
          host = node;
          props.registerSurfaceElement(sessionId, node);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class="absolute top-2 left-2 right-0 bottom-0 redeven-terminal-surface"
        data-terminal-semantic-surface="true"
        onClick={(event) => {
          if (!activateSemanticLink(event)) props.onSurfaceClick?.(event);
        }}
        onWheel={(event) => {
          if (latestPresentation?.frame.bufferKind === 'alternate') return;
          if (event.deltaY === 0) return;
          event.preventDefault();
          void scrollHistory(event.deltaY > 0 ? 'forward' : 'backward');
        }}
        style={{
          bottom: 'var(--terminal-bottom-inset)',
          'background-color': terminalBackground(),
          opacity: ready() ? '1' : '0',
        }}
      >
        <canvas
          ref={(node) => { canvas = node; }}
          aria-label={i18n.t('terminal.title')}
          data-terminal-semantic-canvas="true"
          class="absolute inset-0 h-full w-full"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            focusAfterActivation(false);
            event.currentTarget.setPointerCapture(event.pointerId);
            renderer?.beginSelection(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              renderer?.updateSelection(event.clientX, event.clientY);
            }
          }}
          onPointerUp={(event) => {
            renderer?.endSelection(event.clientX, event.clientY);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        />
        <textarea
          ref={(node) => { inputElement = node; }}
          aria-label={i18n.t('terminal.inputAria')}
          data-terminal-input-bridge="semantic"
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          class="absolute min-w-0 min-h-0 box-border border-0 p-0 m-0 resize-none overflow-hidden outline-none"
          style={{
            position: 'absolute',
            'min-width': '0',
            'min-height': '0',
            'box-sizing': 'border-box',
            opacity: '0.01',
            color: 'transparent',
            'caret-color': 'transparent',
            'background-color': 'transparent',
            'z-index': '2',
          }}
        />
        <div
          aria-label={i18n.t('terminal.historyScrollbar')}
          aria-orientation="vertical"
          aria-valuemax={historyMaximum()}
          aria-valuemin="0"
          aria-valuenow={historyCurrent()}
          data-floeterm-scrollbar=""
          data-visible={historyMaximum() > 0 ? 'true' : 'false'}
          hidden={historyMaximum() <= 0}
          role="scrollbar"
          class="absolute right-0 top-0 bottom-0 w-3"
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
            if (ratio <= 0.25) projectHistoryStart();
            else if (ratio >= 0.75) showLatestPresentation();
            else if (ratio < 0.5) void scrollHistory('backward');
            else void scrollHistory('forward');
          }}
          style={{ background: `color-mix(in srgb, ${terminalForeground()} 8%, transparent)` }}
        >
          <div
            data-floeterm-scrollbar-thumb=""
            class="absolute left-0.5 right-0.5 rounded-sm"
            style={{
              top: `${historyThumbStart()}%`,
              height: `${historyThumbSize()}%`,
              background: `color-mix(in srgb, ${terminalForeground()} 38%, transparent)`,
            }}
          />
        </div>
      </div>

      <RedevenLoadingCurtain
        visible={!ready()}
        eyebrow={i18n.t('terminal.creatingEyebrow')}
        message={loadingMessage()}
        class="redeven-terminal-loading-curtain"
      />

      {historyError() ? (
        <div
          class="absolute left-3 bottom-3 z-10 flex items-center gap-2 border border-warning/40 bg-background px-3 py-2 text-xs text-foreground"
          data-terminal-semantic-history-error="true"
          data-terminal-semantic-history-error-detail={historyErrorDetail()}
          role="status"
        >
          <span>{i18n.t('terminal.olderOutputUnavailable')}</span>
          <button
            type="button"
            class="font-medium text-primary underline-offset-2 hover:underline"
            data-terminal-semantic-history-retry="true"
            disabled={historyBusy()}
            onClick={() => retryHistoryRequest?.()}
          >
            {i18n.t('terminal.retry')}
          </button>
        </div>
      ) : null}

      {runtimeError() ? (
        <div
          class="absolute left-3 right-3 bottom-3 z-10 border border-destructive/40 bg-background px-3 py-2 text-xs text-destructive"
          data-terminal-semantic-error="true"
          role="alert"
        >
          {runtimeError()}
        </div>
      ) : null}
    </div>
  );
}
