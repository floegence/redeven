import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

import {
  TerminalCore,
  createPagedTerminalOutputCoordinator,
  getDefaultTerminalConfig,
  type AtomicPagedTerminalOutputCoordinatorHandle,
  type Logger,
  type PagedTerminalHistoryPage,
  type PagedTerminalOutputFailureCode,
  type PagedTerminalOutputSnapshot,
  type PreparedPagedTerminalHistory,
  type TerminalAppearance,
  type TerminalOutputPipelineChunk,
  type TerminalResponsiveConfig,
  type TerminalRestorableSnapshot,
  type TerminalSessionInfo,
} from '@floegence/floeterm-terminal-web';
import {
  classifyTerminalAttachLifecycleExit,
  type RedevenTerminalEventSource,
  type RedevenTerminalTransport,
} from '../services/terminalTransport';
import type { TerminalNameUpdateEvent } from '../protocol/redeven_v1/sdk/terminal';
import { createTerminalFileLinkProvider, type TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import type { TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import {
  createTerminalOutputProjection,
  tagTerminalOutputChunk,
} from '../services/terminalOutputProjection';
import {
  restoreTerminalSnapshotOrReplay,
  type TerminalWorkingSetInteraction,
  type TerminalWorkingSetRuntime,
} from '../services/terminalAdaptiveWorkingSet';
import { normalizeAbsolutePath as normalizeAskFlowerAbsolutePath } from '../utils/askFlowerPath';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';
import {
  markTerminalRecoveryMilestone,
  publishTerminalRecoveryEvent,
  startTerminalRecoveryTrace,
  terminalRecoveryDiagnosticsQuery,
  type TerminalRecoveryEventDetail,
  type TerminalRecoveryPhase,
  type TerminalRecoveryTrace,
} from '../services/terminalRecoveryDiagnostics';
import {
  markTerminalPerformance,
  pseudonymousTerminalSessionRef,
} from '../services/terminalPerformance';
import {
  createTerminalGeometryPresentationController,
  type TerminalEffectiveGeometry,
  type TerminalGeometryRequestContext,
  type TerminalSharedGeometryPresentation,
} from './terminalSharedGeometryPresentation';

type SessionLoadingState = 'idle' | 'initializing' | 'attaching' | 'loading_history' | 'reconnecting';

type SharedTerminalGeometryEvent = Readonly<{
  sessionId: string;
  lifecycleEpoch: number;
  generation: number;
  outputSequenceBoundary: number;
  cols: number;
  rows: number;
}>;

type PendingBaselineRender = Readonly<{
  core: TerminalCore;
  initSequence: number;
  trace: TerminalRecoveryTrace;
  detail: TerminalRecoveryEventDetail;
  armed: boolean;
}>;

export function shouldPublishTerminalOutputCoverage(
  previousAttachGeneration: number,
  previousCoveredThroughSequence: number,
  nextAttachGeneration: number,
  nextCoveredThroughSequence: number,
): boolean {
  return previousAttachGeneration !== nextAttachGeneration
    || nextCoveredThroughSequence > previousCoveredThroughSequence;
}

function buildLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
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

export type TerminalSessionRuntimeActions = Readonly<{
  reload: () => Promise<void>;
  resetAfterClear: () => Promise<boolean>;
  retryOutputRecovery: () => Promise<void>;
  focusIfInteractive: () => 'focused' | 'not_interactive' | 'selection_active';
}>;

export type TerminalSessionRuntimeStatus = Readonly<{
  state: 'idle' | 'reconnecting' | 'retrying' | 'degraded' | 'blocking';
  failureCode?: PagedTerminalOutputFailureCode | 'terminal_unavailable';
  retryable?: boolean;
  diagnosticsQuery?: string;
}>;

function isTerminalRecoveryRetryable(
  code: PagedTerminalOutputFailureCode | 'terminal_unavailable' | null,
): boolean {
  return code !== 'history_contract_missing' && code !== 'history_contract_invalid';
}

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
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: TerminalSessionRuntimeActions | null) => void;
  registerWorkingSetRuntime: (sessionId: string, runtime: TerminalWorkingSetRuntime | null) => void;
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
  onPendingOutputReset?: (sessionId: string, opts?: { preserveUnread?: boolean }) => void;
  setWorkingSetInteraction: (sessionId: string, interaction: TerminalWorkingSetInteraction, active: boolean) => void;
  onSurfaceClick?: (event: MouseEvent) => void;
  onBell?: (sessionId: string) => void;
  onShellIntegrationEvent?: (sessionId: string, event: TerminalShellIntegrationEvent, source: 'history' | 'live') => void;
  onVisibleOutput?: (
    sessionId: string,
    source: 'history' | 'live',
    byteLength: number,
    sequence: number | undefined,
  ) => void;
  onTerminalFileLinkOpen?: (target: TerminalResolvedLinkTarget) => Promise<void> | void;
  onNameUpdate?: (sessionId: string, newName: string, workingDir: string, localPathCapability: TerminalNameUpdateEvent['localPathCapability']) => void;
  requestPreparedHistory?: (sessionId: string) => Promise<PreparedPagedTerminalHistory | null>;
}>;

export function TerminalSessionRuntime(props: TerminalSessionRuntimeProps) {
  const i18n = useI18n();
  const stableSessionId = props.session.id;
  const sessionId = () => stableSessionId;
  const colors = () => props.themeColors();
  const fontSize = () => props.fontSize();
  const fontFamily = () => props.fontFamily();
  const [loading, setLoading] = createSignal<SessionLoadingState>('initializing');
  const [readyOnce, setReadyOnce] = createSignal(false);
  const [outputRecoveryState, setOutputRecoveryState] = createSignal<PagedTerminalOutputSnapshot['state']>('idle');
  const [baselineReady, setBaselineReady] = createSignal(false);
  const [recoveryFailureCode, setRecoveryFailureCode] = createSignal<PagedTerminalOutputFailureCode | null>(null);
  const [recoveryRetryable, setRecoveryRetryable] = createSignal<boolean | null>(null);
  const [blockingFailureCode, setBlockingFailureCode] = createSignal<'terminal_unavailable' | PagedTerminalOutputFailureCode | null>(null);
  const [showRetryingStatus, setShowRetryingStatus] = createSignal(false);
  const [historyReplayProgress, setHistoryReplayProgress] = createSignal<{ loadedBytes: number; totalBytes: number } | null>(null);
  const [geometryRendererReady, setGeometryRendererReady] = createSignal(false);
  const geometryPresentation = createTerminalGeometryPresentationController({
    onPresentation: presentation => props.onGeometryPresentation?.(stableSessionId, presentation),
  });

  const [showLoading, setShowLoading] = createSignal(false);
  let loadingDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const loadingMessage = createMemo(() => {
    if (loading() === 'initializing') return i18n.t('terminal.initializing');
    if (loading() === 'attaching') return i18n.t('terminal.attaching');
    if (loading() === 'reconnecting') return i18n.t('terminal.reconnecting');
    if (loading() === 'loading_history') {
      const progress = historyReplayProgress();
      if (progress && progress.totalBytes > 0) {
        return i18n.t('terminal.loadingHistoryProgress', {
          loaded: formatBytes(Math.min(progress.loadedBytes, progress.totalBytes)),
          total: formatBytes(progress.totalBytes),
        });
      }
      return i18n.t('terminal.loadingHistory');
    }
    return undefined;
  });

  const runtimeStatus = createMemo<TerminalSessionRuntimeStatus>(() => {
    const blocking = blockingFailureCode();
    if (blocking) {
      return {
        state: 'blocking',
        failureCode: blocking,
        retryable: isTerminalRecoveryRetryable(blocking),
        diagnosticsQuery: terminalRecoveryDiagnosticsQuery(recoveryTrace, blocking),
      };
    }
    if (loading() === 'reconnecting') return { state: 'reconnecting' };
    if (baselineReady() && outputRecoveryState() === 'failed') {
      return {
        state: 'degraded',
        failureCode: recoveryFailureCode() ?? undefined,
        retryable: recoveryRetryable() ?? undefined,
        diagnosticsQuery: terminalRecoveryDiagnosticsQuery(recoveryTrace, recoveryFailureCode() ?? undefined),
      };
    }
    if (baselineReady() && outputRecoveryState() === 'retry-wait' && showRetryingStatus()) {
      return {
        state: 'retrying',
        failureCode: recoveryFailureCode() ?? undefined,
        diagnosticsQuery: terminalRecoveryDiagnosticsQuery(recoveryTrace, recoveryFailureCode() ?? undefined),
      };
    }
    return { state: 'idle' };
  });

  createEffect(() => {
    const status = runtimeStatus();
    props.onRuntimeStatus?.(stableSessionId, status);
  });

  createEffect(() => {
    geometryPresentation.setEligible(
      props.viewActive()
      && props.active()
      && geometryRendererReady()
      && runtimeStatus().state === 'idle',
    );
  });

  createEffect(() => {
    const shouldDelay = baselineReady() && outputRecoveryState() === 'retry-wait';
    setShowRetryingStatus(false);
    if (!shouldDelay) return;
    const timer = setTimeout(() => setShowRetryingStatus(true), 750);
    onCleanup(() => clearTimeout(timer));
  });

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
  let unsubGeometry: (() => void) | null = null;
  let unsubAttachmentLifecycle: (() => void) | null = null;
  let appearanceRaf: number | null = null;
  let activationRaf: number | null = null;
  let inputProtectionTimer: ReturnType<typeof setTimeout> | null = null;
  let workingSetRegistered = false;
  let recoveryTrace: TerminalRecoveryTrace | null = null;
  let pendingBaselineRender: PendingBaselineRender | null = null;
  let recoveryPhase: TerminalRecoveryPhase | null = null;
  let historyPageCount = 0;
  let historyChunkCount = 0;
  let historyBytes = 0;
  let lastHistoryGeneration: number | undefined;
  let lastSnapshotEndSequence: number | undefined;
  let lastFirstRetainedSequence: number | undefined;
  let historyReset = false;
  let historyTruncated = false;
  let lastRetryEventKey = '';
  let lastWrittenOutputSequence = 0;
  let lastAppliedGeometryGeneration = 0;
  let lastAppliedGeometryBoundary = -1;
  let pendingGeometryEvents: SharedTerminalGeometryEvent[] = [];
  const geometryGridByGeneration = new Map<number, Readonly<{ cols: number; rows: number }>>();
  let activeGeometryLifecycleEpoch = 0;
  let activeGeometryRendererEpoch = 0;
  let activeRuntimeAttachGeneration = 0;
  let latestGeometryResizeContext: TerminalGeometryRequestContext | null = null;
  const snapshotGeometryFacts = new WeakMap<object, Readonly<{
    effective: TerminalEffectiveGeometry;
    coveredThroughSequence: number;
  }>>();
  let liveAttachmentReady = false;
  let terminalPresentationSettling = false;
  let latestHostDimensions: Readonly<{ cols: number; rows: number }> | null = null;
  const currentHostDimensions = () => latestHostDimensions;
  let lastDegradedEventKey = '';
  let lastBlockingEventKey = '';
  let liveMilestoneMarked = false;
  let outputCoordinatorEpoch = 0;
  let observedLiveAttachGeneration = 0;
  let maxObservedLiveSequence = 0;
  let activitySettledAttachGeneration = 0;
  let activitySettledThroughSequence = 0;

  const transitionRecoveryPhase = (next: TerminalRecoveryPhase) => {
    const trace = recoveryTrace;
    if (!trace || recoveryPhase === next) return;
    publishTerminalRecoveryEvent(trace, 'phase_transition', {
      phase_from: recoveryPhase ?? undefined,
      phase_to: next,
    });
    recoveryPhase = next;
  };

  const startRecoveryTrace = () => {
    pendingBaselineRender = null;
    recoveryTrace = startTerminalRecoveryTrace(stableSessionId, props.variant);
    recoveryPhase = null;
    historyPageCount = 0;
    historyChunkCount = 0;
    historyBytes = 0;
    lastHistoryGeneration = undefined;
    lastSnapshotEndSequence = undefined;
    lastFirstRetainedSequence = undefined;
    historyReset = false;
    historyTruncated = false;
    lastRetryEventKey = '';
    lastDegradedEventKey = '';
    lastBlockingEventKey = '';
    setRecoveryRetryable(null);
    liveMilestoneMarked = false;
    transitionRecoveryPhase('initializing');
    return recoveryTrace;
  };

  const armBaselineRender = (
    core: TerminalCore,
    trace: TerminalRecoveryTrace,
    initSequence: number,
  ) => {
    const pending = pendingBaselineRender;
    if (
      !pending
      || pending.core !== core
      || pending.trace !== trace
      || pending.initSequence !== initSequence
    ) {
      return;
    }
    pendingBaselineRender = { ...pending, armed: true };
  };

  const reportBlockingFailure = (code: 'terminal_unavailable' | PagedTerminalOutputFailureCode) => {
    pendingBaselineRender = null;
    const trace = recoveryTrace;
    if (trace) {
      const eventKey = `${trace.surfaceGeneration}:${code}`;
      if (lastBlockingEventKey !== eventKey) {
        lastBlockingEventKey = eventKey;
        publishTerminalRecoveryEvent(trace, 'blocking', {
          error_code: code,
          recovery_action: isTerminalRecoveryRetryable(code) ? 'retry' : 'update_runtime',
        });
      }
    }
    setBlockingFailureCode(code);
  };

  const buildTerminalAppearance = (): TerminalAppearance => ({
    theme: colors(),
    fontSize: fontSize(),
    fontFamily: fontFamily(),
  });

  const applyTerminalAppearance = (
    core: TerminalCore,
    appearance: TerminalAppearance = buildTerminalAppearance(),
    opts?: { forceResize?: boolean; focus?: boolean },
  ) => {
    core.setAppearance(appearance);
    if (opts?.forceResize) {
      core.forceResize();
    }
    if (opts?.focus && props.viewActive() && props.active() && props.autoFocus() && !core.hasSelection()) {
      core.focus();
    }
  };

  const cancelPendingAppearanceApply = () => {
    if (appearanceRaf !== null) {
      cancelAnimationFrame(appearanceRaf);
      appearanceRaf = null;
    }
  };

  const cancelPendingActivationRefresh = () => {
    if (activationRaf !== null) {
      cancelAnimationFrame(activationRaf);
      activationRaf = null;
    }
  };

  const scheduleTerminalAppearanceApply = (appearance: TerminalAppearance) => {
    cancelPendingAppearanceApply();
    appearanceRaf = requestAnimationFrame(() => {
      appearanceRaf = null;
      const core = term;
      if (!core) return;
      applyTerminalAppearance(core, appearance);
    });
  };

  const scheduleTerminalActivationRefresh = () => {
    cancelPendingActivationRefresh();
    activationRaf = requestAnimationFrame(() => {
      activationRaf = null;
      const core = term;
      if (!core || terminalInputBlocked() || core.hasSelection()) return;
      const activeElement = typeof document === 'undefined' ? null : document.activeElement;
      const focusStillOwned = activeElement == null
        || activeElement === document.body
        || Boolean(container?.contains(activeElement));
      applyTerminalAppearance(core, buildTerminalAppearance(), {
        forceResize: true,
        focus: focusStillOwned,
      });
    });
  };

  const outputProjection = createTerminalOutputProjection({
    onShellIntegrationEvent: (event, source) => {
      props.onShellIntegrationEvent?.(sessionId(), event, source);
    },
    onChunkCommitted: (source, sequence) => {
      const normalizedSequence = normalizeLiveSequence(sequence);
      const snapshot = outputCoordinator?.getSnapshot();
      if (snapshot && normalizedSequence !== undefined) {
        if (activitySettledAttachGeneration !== snapshot.attachGeneration) {
          activitySettledAttachGeneration = snapshot.attachGeneration;
          activitySettledThroughSequence = snapshot.coveredThroughSequence;
        }
        activitySettledThroughSequence = Math.max(activitySettledThroughSequence, normalizedSequence);
      }
      props.onOutputCommitted?.(sessionId(), source, sequence);
    },
    onVisibleOutput: (source, byteLength, sequence) => {
      props.onVisibleOutput?.(sessionId(), source, byteLength, sequence);
    },
  });
  let outputCoordinator: AtomicPagedTerminalOutputCoordinatorHandle | null = null;
  let outputCoordinatorSnapshot: PagedTerminalOutputSnapshot | null = null;
  let replayCoveredBytes = 0;
  let replayTotalBytes = 0;

  const liveRenderActive = () => {
    const active = props.viewActive() && props.active();
    return term !== null && active;
  };

  const normalizeLiveSequence = (sequence: number | undefined): number | undefined => (
    typeof sequence === 'number' && Number.isFinite(sequence) && sequence > 0
      ? Math.floor(sequence)
      : undefined
  );

  const terminalInputBlocked = () => {
    if (loading() !== 'idle' || !baselineReady() || blockingFailureCode()) return true;
    return false;
  };

  const focusTerminalIfInteractive = () => {
    const core = term;
    if (!core || terminalInputBlocked()) return 'not_interactive' as const;
    if (!props.viewActive() || !props.active() || !props.autoFocus()) return 'not_interactive' as const;
    if (core.hasSelection()) return 'selection_active' as const;
    core.focus();
    return 'focused' as const;
  };

  const clearOutputSubscription = () => {
    unsubData?.();
    unsubData = null;
    unsubNameUpdate?.();
    unsubNameUpdate = null;
    unsubGeometry?.();
    unsubGeometry = null;
    unsubAttachmentLifecycle?.();
    unsubAttachmentLifecycle = null;
  };

  const applyPendingGeometry = () => {
    const core = term;
    if (!core) return;
    while (pendingGeometryEvents.length > 0) {
      const event = pendingGeometryEvents[0]!;
      if (event.lifecycleEpoch !== activeGeometryLifecycleEpoch) {
        pendingGeometryEvents.shift();
        continue;
      }
      if (event.generation < lastAppliedGeometryGeneration
        || (event.generation === lastAppliedGeometryGeneration
          && event.outputSequenceBoundary <= lastAppliedGeometryBoundary)) {
        pendingGeometryEvents.shift();
        continue;
      }
      if (event.outputSequenceBoundary > lastWrittenOutputSequence) return;
      pendingGeometryEvents.shift();
      lastAppliedGeometryGeneration = event.generation;
      lastAppliedGeometryBoundary = event.outputSequenceBoundary;
      core.setFixedDimensions({ cols: event.cols, rows: event.rows });
      geometryPresentation.noteAppliedEffective({
        lifecycleEpoch: event.lifecycleEpoch,
        rendererEpoch: activeGeometryRendererEpoch,
        generation: event.generation,
        outputSequenceBoundary: event.outputSequenceBoundary,
        cols: event.cols,
        rows: event.rows,
      });
    }
  };

  const queueTerminalGeometry = (event: SharedTerminalGeometryEvent) => {
    if (!Number.isSafeInteger(event.generation) || event.generation <= 0
      || !Number.isSafeInteger(event.outputSequenceBoundary) || event.outputSequenceBoundary < 0
      || !Number.isSafeInteger(event.cols) || event.cols <= 0
      || !Number.isSafeInteger(event.rows) || event.rows <= 0) {
      reportBlockingFailure('terminal_unavailable');
      return;
    }
    if (event.lifecycleEpoch !== activeGeometryLifecycleEpoch) return;
    const generationGrid = geometryGridByGeneration.get(event.generation);
    if (generationGrid
      && (generationGrid.cols !== event.cols || generationGrid.rows !== event.rows)) {
      reportBlockingFailure('terminal_unavailable');
      return;
    }
    if (!generationGrid) {
      geometryGridByGeneration.set(event.generation, { cols: event.cols, rows: event.rows });
    }
    if (!geometryPresentation.noteKnownEffective(event)) {
      const known = geometryPresentation.getState().knownEffective;
      if (known
        && known.generation === event.generation
        && (known.cols !== event.cols || known.rows !== event.rows)) {
        reportBlockingFailure('terminal_unavailable');
        return;
      }
    }
    if (event.generation < lastAppliedGeometryGeneration
      || (event.generation === lastAppliedGeometryGeneration
        && event.outputSequenceBoundary <= lastAppliedGeometryBoundary)) return;
    const duplicate = pendingGeometryEvents.find(pending => (
      pending.lifecycleEpoch === event.lifecycleEpoch
      && pending.generation === event.generation
      && pending.outputSequenceBoundary === event.outputSequenceBoundary
    ));
    if (duplicate) {
      if (duplicate.cols !== event.cols
        || duplicate.rows !== event.rows) {
        reportBlockingFailure('terminal_unavailable');
      }
      return;
    }
    pendingGeometryEvents.push(event);
    pendingGeometryEvents.sort((left, right) => (
      left.generation - right.generation
      || left.outputSequenceBoundary - right.outputSequenceBoundary
    ));
    applyPendingGeometry();
  };

  const concatTerminalChunks = (chunks: readonly TerminalOutputPipelineChunk[]): Uint8Array => {
    const size = chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk.data, offset);
      offset += chunk.data.byteLength;
    }
    return result;
  };

  const writeTerminalChunks = async (
    chunks: readonly TerminalOutputPipelineChunk[],
    history: boolean,
  ): Promise<void> => {
    const core = term;
    if (!core) throw new Error('Terminal output writer lost its active core');
    let remaining = [...chunks];
    while (remaining.length > 0) {
      applyPendingGeometry();
      const boundary = pendingGeometryEvents[0]?.outputSequenceBoundary;
      const splitIndex = boundary === undefined
        ? remaining.length
        : remaining.findIndex(chunk => (normalizeLiveSequence(chunk.sequence) ?? 0) > boundary);
      const count = splitIndex < 0 ? remaining.length : splitIndex;
      if (count === 0) {
        throw new Error(`Terminal output did not cover geometry boundary ${boundary}`);
      }
      const current = remaining.slice(0, count);
      remaining = remaining.slice(count);
      const payload = concatTerminalChunks(current);
      if (payload.byteLength > 0) {
        if (history) {
          await new Promise<void>((resolve) => core.writeHistory(payload, resolve));
        } else {
          core.writeFrame(payload);
        }
      }
      for (const chunk of current) {
        const sequence = normalizeLiveSequence(chunk.sequence);
        if (sequence !== undefined) lastWrittenOutputSequence = Math.max(lastWrittenOutputSequence, sequence);
      }
      applyPendingGeometry();
    }
  };

  const handleLiveTerminalData = (data: Uint8Array, sequence: number | undefined) => {
    const coordinator = outputCoordinator;
    if (!coordinator) return;

    const normalizedSequence = normalizeLiveSequence(sequence);
    const snapshot = coordinator.getSnapshot();
    if (snapshot.attachGeneration !== observedLiveAttachGeneration) {
      observedLiveAttachGeneration = snapshot.attachGeneration;
      maxObservedLiveSequence = snapshot.coveredThroughSequence;
    } else {
      maxObservedLiveSequence = Math.max(maxObservedLiveSequence, snapshot.coveredThroughSequence);
    }
    if (
      normalizedSequence
      && normalizedSequence <= snapshot.coveredThroughSequence
    ) {
      return;
    }

    const projectionFloor = maxObservedLiveSequence;
    const trace = recoveryTrace;
    if (trace && normalizedSequence !== undefined && normalizedSequence > projectionFloor + 1) {
      publishTerminalRecoveryEvent(trace, 'live', {
        coordinator_attach_generation: snapshot.attachGeneration,
        catch_up_gap_sequences: normalizedSequence - projectionFloor - 1,
        covered_through_sequence: snapshot.coveredThroughSequence,
      });
    }
    if (normalizedSequence !== undefined) {
      maxObservedLiveSequence = Math.max(maxObservedLiveSequence, normalizedSequence);
    }
    if (trace && !liveMilestoneMarked) {
      liveMilestoneMarked = true;
      markTerminalRecoveryMilestone(trace, 'live', {
        coordinator_attach_generation: snapshot.attachGeneration,
        covered_through_sequence: snapshot.coveredThroughSequence,
      });
      publishTerminalRecoveryEvent(trace, 'live', {
        coordinator_attach_generation: snapshot.attachGeneration,
        covered_through_sequence: snapshot.coveredThroughSequence,
      });
    }
    if (data.byteLength > 0) {
      const alreadySettledForActivity = normalizedSequence !== undefined
        && activitySettledAttachGeneration === snapshot.attachGeneration
        && normalizedSequence <= activitySettledThroughSequence;
      if (!alreadySettledForActivity) {
        props.onLiveOutputObserved?.(sessionId(), data.byteLength, normalizedSequence);
      }
    }
    const liveChunk = tagTerminalOutputChunk({
      sequence: normalizedSequence,
      data,
    }, 'live');
    coordinator.pushLive(liveChunk);
  };

  let reloadSeq = 0;
  const disposeCore = () => {
    cancelPendingAppearanceApply();
    cancelPendingActivationRefresh();
    pendingBaselineRender = null;
    setGeometryRendererReady(false);
    geometryPresentation.endRenderer(activeGeometryRendererEpoch);
    term?.dispose();
    term = null;
    props.registerCore(sessionId(), null);
  };

  const disposeTerminal = (opts?: { preservePendingUnread?: boolean }) => {
    clearOutputSubscription();
    if (inputProtectionTimer) {
      clearTimeout(inputProtectionTimer);
      inputProtectionTimer = null;
    }
    props.setWorkingSetInteraction(sessionId(), 'input', false);
    props.setWorkingSetInteraction(sessionId(), 'composition', false);
    outputCoordinator?.dispose();
    outputCoordinator = null;
    outputCoordinatorSnapshot = null;
    observedLiveAttachGeneration = 0;
    maxObservedLiveSequence = 0;
    activitySettledAttachGeneration = 0;
    activitySettledThroughSequence = 0;
    lastWrittenOutputSequence = 0;
    lastAppliedGeometryGeneration = 0;
    lastAppliedGeometryBoundary = -1;
    pendingGeometryEvents = [];
    geometryGridByGeneration.clear();
    if (activeRuntimeAttachGeneration > 0) {
      geometryPresentation.closeAttachment(activeRuntimeAttachGeneration);
    }
    activeRuntimeAttachGeneration = 0;
    latestGeometryResizeContext = null;
    liveAttachmentReady = false;
    latestHostDimensions = null;
    props.onPendingOutputReset?.(sessionId(), {
      preserveUnread: opts?.preservePendingUnread !== false,
    });
    setBaselineReady(false);
    setRecoveryFailureCode(null);
    disposeCore();
    outputProjection.reset();
    setReadyOnce(false);
    if (workingSetRegistered) {
      workingSetRegistered = false;
      props.registerWorkingSetRuntime(sessionId(), null);
    }
  };

  let initSeq = 0;
  let disposed = false;
  let waitingForProtocolClient: unknown = null;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const reload = async (opts?: {
    fadeOut?: boolean;
    preservePendingUnread?: boolean;
  }): Promise<boolean> => {
    if (disposed) return false;
    const id = sessionId();
    if (!id) return false;
    if (!props.connected()) return false;
    if (!container) return false;

    const seq = ++reloadSeq;
    // Keep the surface hidden until the new terminal is attached and history is replayed (same as page open).
    setBlockingFailureCode(null);
    waitingForProtocolClient = null;
    setLoading('initializing');

    if (opts?.fadeOut) {
      container.style.opacity = '0';
      await sleep(150);
      if (disposed || seq !== reloadSeq) return false;
    }

    // Invalidate the old init before waiting so a baseline waiter cannot publish stale state.
    initSeq += 1;
    const coordinator = outputCoordinator;
    if (coordinator) await coordinator.pause();
    if (disposed || seq !== reloadSeq) return false;
    disposeTerminal({ preservePendingUnread: opts?.preservePendingUnread });

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (disposed || seq !== reloadSeq) return false;
    if (!props.connected()) return false;
    if (!container) return false;

    try {
      await initOnce();
      return baselineReady() && !blockingFailureCode();
    } catch {
      setLoading('idle');
      reportBlockingFailure('terminal_unavailable');
      const el = container;
      if (el) el.style.opacity = '1';
      return false;
    }
  };

  createEffect(() => {
    const id = sessionId();
    if (!id) return;
    props.registerActions(id, {
      reload: async () => {
        await reload();
      },
      resetAfterClear: () => reload({ preservePendingUnread: false }),
      retryOutputRecovery: async () => {
        setRecoveryFailureCode(null);
        if (blockingFailureCode() || !readyOnce()) {
          await reload();
          return;
        }
        outputCoordinator?.retry();
      },
      focusIfInteractive: focusTerminalIfInteractive,
    });
    onCleanup(() => {
      props.registerActions(id, null);
    });
  });

  const protectTerminalInput = () => {
    props.setWorkingSetInteraction(sessionId(), 'input', true);
    if (inputProtectionTimer) clearTimeout(inputProtectionTimer);
    inputProtectionTimer = setTimeout(() => {
      inputProtectionTimer = null;
      props.setWorkingSetInteraction(sessionId(), 'input', false);
    }, 750);
  };

  const requestTerminalResize = async (
    id: string,
    size: Readonly<{ cols: number; rows: number }>,
  ): Promise<TerminalEffectiveGeometry | null> => {
    const context = geometryPresentation.beginResize(size);
    if (!context) return null;
    latestGeometryResizeContext = context;
    try {
      const result = await props.transport.resizeWithEffectiveGeometry(id, size.cols, size.rows);
      if (disposed) return null;
      const effective = geometryPresentation.acknowledgeResize(context, result);
      if (!effective) return null;
      queueTerminalGeometry({ sessionId: id, ...effective });
      return effective;
    } catch (errorValue) {
      geometryPresentation.failResize(context);
      if (latestGeometryResizeContext?.callSequence !== context.callSequence
        || !liveAttachmentReady
        || disposed) return null;
      const lifecycleExit = classifyTerminalAttachLifecycleExit(errorValue);
      if (lifecycleExit === 'session_gone') {
        if (props.onSessionGone) props.onSessionGone(id);
        else props.transport.forgetSession(id);
        return null;
      }
      if (lifecycleExit === 'disconnected') {
        waitingForProtocolClient = props.protocolClient();
        setLoading('reconnecting');
        return null;
      }
      reportBlockingFailure('terminal_unavailable');
      return null;
    }
  };

  const terminalPresentationIsCurrent = (
    core: TerminalCore,
    initSequence: number,
    reloadSequence: number,
    trace: TerminalRecoveryTrace,
  ): boolean => !disposed
    && initSequence === initSeq
    && reloadSequence === reloadSeq
    && recoveryTrace === trace
    && term === core;

  const waitForAppliedGeometry = async (
    effective: TerminalEffectiveGeometry,
    core: TerminalCore,
    initSequence: number,
    reloadSequence: number,
    trace: TerminalRecoveryTrace,
  ): Promise<void> => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!terminalPresentationIsCurrent(core, initSequence, reloadSequence, trace)) {
        throw new Error('Terminal geometry presentation was superseded');
      }
      applyPendingGeometry();
      const applied = geometryPresentation.getState().appliedEffective;
      if (applied
        && applied.lifecycleEpoch === effective.lifecycleEpoch
        && applied.rendererEpoch === activeGeometryRendererEpoch
        && applied.generation === effective.generation
        && applied.outputSequenceBoundary === effective.outputSequenceBoundary
        && applied.cols === effective.cols
        && applied.rows === effective.rows) {
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
    throw new Error('Terminal geometry presentation did not reach the acknowledged boundary');
  };

  const settleTerminalPresentation = async (
    id: string,
    core: TerminalCore,
    initSequence: number,
    reloadSequence: number,
    trace: TerminalRecoveryTrace,
  ): Promise<boolean> => {
    terminalPresentationSettling = true;
    try {
      let geometryChanged = false;
      await core.forceResizeAndWaitForPresentation();
      if (!terminalPresentationIsCurrent(core, initSequence, reloadSequence, trace)) return false;

      if (props.viewActive() && props.active()) {
        const hostDimensions = core.measureHostDimensions?.();
        const effective = geometryPresentation.getState().knownEffective;
        if (hostDimensions && effective
          && (hostDimensions.cols !== effective.cols || hostDimensions.rows !== effective.rows)) {
          const acknowledged = await requestTerminalResize(id, hostDimensions);
          if (!acknowledged) {
            if (!terminalPresentationIsCurrent(core, initSequence, reloadSequence, trace)
              || loading() === 'reconnecting'
              || !liveAttachmentReady) return false;
            throw new Error('Terminal host capacity resize was not acknowledged');
          }
          await waitForAppliedGeometry(acknowledged, core, initSequence, reloadSequence, trace);
          geometryChanged = true;
        }
      }

      if (geometryChanged) {
        // Let geometry-triggered renderer work commit before the final fence; otherwise
        // the renderer scheduler can coalesce the second demand behind the resize frame.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      await core.forceResizeAndWaitForPresentation();
      return terminalPresentationIsCurrent(core, initSequence, reloadSequence, trace);
    } finally {
      terminalPresentationSettling = false;
    }
  };

  const createCore = (
    id: string,
    target: HTMLDivElement,
    options?: Readonly<{ preserveGeometryQueue?: boolean }>,
  ): TerminalCore => {
    activeGeometryRendererEpoch = geometryPresentation.beginRenderer();
    lastWrittenOutputSequence = 0;
    lastAppliedGeometryGeneration = 0;
    lastAppliedGeometryBoundary = -1;
    if (!options?.preserveGeometryQueue) pendingGeometryEvents = [];
    let core: TerminalCore | null = null;
    core = new TerminalCore(
      target,
      getDefaultTerminalConfig('dark', {
        cursorBlink: false,
        rendererType: 'webgl',
        fontSize: fontSize(),
        // Workbench zoom is an outer visual transform; terminal geometry stays stable.
        presentationScale: 1,
        fit: { scrollbarReservePx: 15 },
        scrollbar: {
          visibility: 'persistent',
          ariaLabel: i18n.t('terminal.historyScrollbar'),
        },
        allowTransparency: false,
        theme: colors(),
        fontFamily: fontFamily(),
        clipboard: {
          copyOnSelect: false,
        },
        responsive: {
          fitOnFocus: true,
          emitResizeOnFocus: true,
          notifyResizeOnlyWhenFocused: true,
          reportHostDimensionsWithFixedGrid: true,
        } satisfies TerminalResponsiveConfig,
      }),
      {
        onData: (data: string) => {
          if (!props.viewActive() || !props.active()) return;
          if (terminalInputBlocked()) return;
          protectTerminalInput();
          void props.transport.sendInput(id, data, props.connId);
        },
        onResize: (size: { cols: number; rows: number }) => {
          if (!props.viewActive() || !props.active()) return;
          latestHostDimensions = { cols: size.cols, rows: size.rows };
          geometryPresentation.observeLocal(size);
          if (!liveAttachmentReady || terminalPresentationSettling) return;
          void requestTerminalResize(id, size);
        },
        onError: () => {
          console.error('[TerminalPanel] Terminal core failed', { event: 'terminal_core_failed' });
          reportBlockingFailure('terminal_unavailable');
        },
        onBell: () => {
          props.onBell?.(id);
        },
        onRender: () => {
          const pending = pendingBaselineRender;
          if (
            !pending
            || !pending.armed
            || !core
            || pending.core !== core
            || term !== core
            || pending.initSequence !== initSeq
            || recoveryTrace !== pending.trace
          ) {
            return;
          }
          pendingBaselineRender = null;
          markTerminalRecoveryMilestone(pending.trace, 'baseline-rendered', pending.detail);
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
      onActivate: (targetLink) => props.onTerminalFileLinkOpen?.(targetLink),
    }));

    term = core;
    props.registerCore(id, core);
    return core;
  };

  const ensureOutputCoordinator = (id: string) => {
    if (outputCoordinator) return outputCoordinator;
    const coordinatorEpoch = ++outputCoordinatorEpoch;
    replayCoveredBytes = 0;
    replayTotalBytes = 0;
    outputCoordinator = createPagedTerminalOutputCoordinator({
      isInteractive: liveRenderActive,
      policy: {
        maxRetainedLiveChunks: 2048,
        maxRetainedLiveBytes: 8 * 1024 * 1024,
        retryDelaysMs: [250, 1000, 4000],
      },
      fetchPage: async ({ startSequence, endSequence, historyGeneration, cursor, signal }) => {
        const requestInitSequence = initSeq;
        const requestTrace = recoveryTrace;
        const pageCursor = typeof cursor === 'number' ? cursor : startSequence;
        const pageOptions = endSequence === undefined && historyGeneration === undefined
          ? undefined
          : { snapshotEndSequence: endSequence, historyGeneration };
        const page = pageOptions === undefined
          ? await props.transport.historyPage(id, pageCursor, -1)
          : await props.transport.historyPage(id, pageCursor, -1, pageOptions);
        const requestStillCurrent = !signal.aborted
          && requestInitSequence === initSeq
          && requestTrace === recoveryTrace
          && coordinatorEpoch === outputCoordinatorEpoch;
        if (requestStillCurrent) {
          historyPageCount += 1;
          historyChunkCount += page.chunks.length;
          historyBytes += Math.max(0, page.coveredBytes);
          lastHistoryGeneration = page.historyGeneration;
          lastSnapshotEndSequence = page.snapshotEndSequence;
          lastFirstRetainedSequence = page.firstRetainedSequence;
          historyReset ||= page.historyReset;
          historyTruncated ||= page.historyTruncated;
          if (requestTrace) {
            publishTerminalRecoveryEvent(requestTrace, 'history_page', {
              history_page_count: historyPageCount,
              history_chunk_count: historyChunkCount,
              history_bytes: historyBytes,
              covered_through_sequence: page.coveredThroughSequence,
              snapshot_end_sequence: page.snapshotEndSequence,
              first_retained_sequence: page.firstRetainedSequence,
              history_generation: page.historyGeneration,
              history_reset: page.historyReset,
              history_truncated: page.historyTruncated,
            });
          }
          replayCoveredBytes += Math.max(0, page.coveredBytes);
          replayTotalBytes = page.totalBytes > 0 ? page.totalBytes : replayTotalBytes;
          if (replayTotalBytes > 0) {
            setHistoryReplayProgress({
              loadedBytes: Math.min(replayCoveredBytes, replayTotalBytes),
              totalBytes: replayTotalBytes,
            });
          }
        }
        return {
          chunks: page.chunks.map((chunk) => tagTerminalOutputChunk(chunk, 'history')),
          hasMore: page.hasMore,
          nextCursor: page.hasMore
            && Number.isSafeInteger(page.nextStartSeq)
            && page.nextStartSeq > pageCursor
            ? page.nextStartSeq
            : undefined,
          firstAvailableSequence: page.firstSequence > 0 ? page.firstSequence : undefined,
          ...(Object.prototype.hasOwnProperty.call(page, 'firstRetainedSequence')
            ? { firstRetainedSequence: page.firstRetainedSequence }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(page, 'coveredThroughSequence')
            ? { coveredThroughSequence: page.coveredThroughSequence as number }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(page, 'snapshotEndSequence')
            ? { snapshotEndSequence: page.snapshotEndSequence }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(page, 'historyGeneration')
            ? { historyGeneration: page.historyGeneration }
            : {}),
          historyReset: page.historyReset,
          historyTruncated: page.historyTruncated,
          coveredBytes: page.coveredBytes,
          totalBytes: page.totalBytes,
        } as PagedTerminalHistoryPage;
      },
      transformChunk: outputProjection.transformChunk,
      applyHistoryGeometry: ({ cols, rows }) => {
        const core = term;
        if (!core) throw new Error('Terminal history geometry has no active core');
        core.setFixedDimensions({ cols, rows });
      },
      write: (_payload, chunks) => writeTerminalChunks(chunks, false),
      writeHistory: (_payload, chunks) => writeTerminalChunks(chunks, true),
      clear: () => {
        term?.clear();
        outputProjection.reset();
      },
      onHistoryTruncated: (reason) => {
        console.debug('[TerminalPanel] Rebased truncated terminal history', {
          event: 'terminal_history_rebased',
          reason,
        });
        setOutputRecoveryState('catching-up');
        const snapshot = outputCoordinator?.getSnapshot();
        if (snapshot) {
          activitySettledAttachGeneration = snapshot.attachGeneration;
          activitySettledThroughSequence = snapshot.coveredThroughSequence;
          props.onOutputCoverage?.(id, {
            attachGeneration: snapshot.attachGeneration,
            coveredThroughSequence: snapshot.coveredThroughSequence,
            rebased: true,
          });
        }
      },
      onStateChange: (snapshot) => {
        const baselineBecameReady = snapshot.baselineReady
          && outputCoordinatorSnapshot?.baselineReady !== true;
        outputCoordinatorSnapshot = snapshot;
        if (baselineBecameReady) {
          lastWrittenOutputSequence = Math.max(
            lastWrittenOutputSequence,
            snapshot.coveredThroughSequence,
          );
          applyPendingGeometry();
        }
        if (snapshot.attachGeneration !== observedLiveAttachGeneration) {
          observedLiveAttachGeneration = snapshot.attachGeneration;
          maxObservedLiveSequence = snapshot.coveredThroughSequence;
        } else {
          maxObservedLiveSequence = Math.max(maxObservedLiveSequence, snapshot.coveredThroughSequence);
        }
        const activityCoverageChanged = shouldPublishTerminalOutputCoverage(
          activitySettledAttachGeneration,
          activitySettledThroughSequence,
          snapshot.attachGeneration,
          snapshot.coveredThroughSequence,
        );
        if (activitySettledAttachGeneration !== snapshot.attachGeneration) {
          activitySettledAttachGeneration = snapshot.attachGeneration;
          activitySettledThroughSequence = snapshot.coveredThroughSequence;
        } else {
          activitySettledThroughSequence = Math.max(
            activitySettledThroughSequence,
            snapshot.coveredThroughSequence,
          );
        }
        if (activityCoverageChanged) {
          props.onOutputCoverage?.(id, {
            attachGeneration: snapshot.attachGeneration,
            coveredThroughSequence: snapshot.coveredThroughSequence,
          });
        }
        setOutputRecoveryState(snapshot.state);
        setBaselineReady(snapshot.baselineReady);
        setRecoveryFailureCode(snapshot.failure?.code ?? null);
        setRecoveryRetryable(snapshot.failure?.retryable ?? null);
        const trace = recoveryTrace;
        if (trace && snapshot.state === 'retry-wait') {
          const retryKey = `${snapshot.attachGeneration}:${snapshot.retryAttempt}`;
          if (lastRetryEventKey !== retryKey) {
            lastRetryEventKey = retryKey;
            publishTerminalRecoveryEvent(trace, 'retry_scheduled', {
              coordinator_attach_generation: snapshot.attachGeneration,
              retry_attempt: snapshot.retryAttempt,
              retry_delay_ms: [250, 1000, 4000][Math.max(0, snapshot.retryAttempt - 1)],
              error_code: snapshot.failure?.code,
              covered_through_sequence: snapshot.coveredThroughSequence,
              recovery_action: 'retry',
            });
          }
        }
        if (trace && snapshot.state === 'failed') {
          const degradedKey = `${snapshot.attachGeneration}:${snapshot.failure?.code ?? 'unknown'}`;
          if (lastDegradedEventKey !== degradedKey) {
            lastDegradedEventKey = degradedKey;
            publishTerminalRecoveryEvent(trace, 'degraded', {
              coordinator_attach_generation: snapshot.attachGeneration,
              retry_attempt: snapshot.retryAttempt,
              error_code: snapshot.failure?.code,
              covered_through_sequence: snapshot.coveredThroughSequence,
              recovery_action: snapshot.failure?.retryable === false ? 'update_runtime' : 'retry',
            });
          }
        }
        if (snapshot.state === 'live') {
          setHistoryReplayProgress(null);
        }
      },
    });
    return outputCoordinator;
  };

  const initOnce = async () => {
    const id = sessionId();
    const target = container;
    if (!target) throw new Error('Terminal not mounted');

    const seq = ++initSeq;
    const reloadSequence = reloadSeq;
    const trace = startRecoveryTrace();
    const focusOwnerAtStart = typeof document === 'undefined' ? null : document.activeElement;
    const focusWasAvailableAtStart = focusOwnerAtStart == null
      || focusOwnerAtStart === document.body
      || target.contains(focusOwnerAtStart);
    setBlockingFailureCode(null);
    setLoading('initializing');
    liveAttachmentReady = false;
    latestHostDimensions = null;
    activeGeometryLifecycleEpoch = geometryPresentation.beginLifecycle();
    geometryGridByGeneration.clear();
    activeRuntimeAttachGeneration = 0;
    latestGeometryResizeContext = null;

    const core = createCore(id, target);
    const coordinator = ensureOutputCoordinator(id);
    const preparedHistoryPromise = props.requestPreparedHistory?.(id) ?? null;

    try {
      await core.initialize({ priority: 'interactive' });
      if (seq !== initSeq) return;

      // After core.initialize(), the underlying terminal instance is ready: re-register to keep the outer registry consistent.
      props.registerCore(id, core);

      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });

      // Begin retaining live output before subscription and before the server
      // captures the atomic history boundary for this attachment.
      activitySettledAttachGeneration = 0;
      activitySettledThroughSequence = 0;
      const coordinatorAttachGeneration = coordinator.beginAttach(0);
      activitySettledAttachGeneration = coordinatorAttachGeneration;

      clearOutputSubscription();
      unsubData = props.eventSource.onTerminalData(id, (ev) => {
        handleLiveTerminalData(ev.data, ev.sequence);
      });

      if (props.eventSource.onTerminalGeometry) {
        const lifecycleEpoch = activeGeometryLifecycleEpoch;
        unsubGeometry = props.eventSource.onTerminalGeometry(id, event => {
          queueTerminalGeometry({ ...event, lifecycleEpoch });
        });
      }

      const lifecycleEpoch = activeGeometryLifecycleEpoch;
      unsubAttachmentLifecycle = props.eventSource.onTerminalLiveAttachmentLifecycle(id, event => {
        if (lifecycleEpoch !== activeGeometryLifecycleEpoch) return;
        if (event.state === 'attached') {
          if (!geometryPresentation.bindAttachment(lifecycleEpoch, event.runtimeAttachGeneration)) {
            reportBlockingFailure('terminal_unavailable');
            return;
          }
          activeRuntimeAttachGeneration = event.runtimeAttachGeneration;
          liveAttachmentReady = true;
          return;
        }
        geometryPresentation.closeAttachment(event.runtimeAttachGeneration);
        if (event.runtimeAttachGeneration !== activeRuntimeAttachGeneration) return;
        activeRuntimeAttachGeneration = 0;
        liveAttachmentReady = false;
        term?.setConnected(false);
        if (event.reason === 'session_closed' || event.reason === 'session_deleted') {
          setLoading('idle');
          if (props.onSessionGone) props.onSessionGone(id);
          else props.transport.forgetSession(id);
          return;
        }
        if (event.reason === 'stream_ended'
          || event.reason === 'error'
          || event.reason === 'connection_epoch_changed') {
          waitingForProtocolClient = null;
          setLoading('reconnecting');
          queueMicrotask(() => {
            if (!disposed && loading() === 'reconnecting') void reload();
          });
        }
      });

      if (props.eventSource.onTerminalNameUpdate) {
        unsubNameUpdate = props.eventSource.onTerminalNameUpdate(id, (ev) => {
          props.onNameUpdate?.(ev.sessionId, ev.newName, ev.workingDir, ev.localPathCapability);
        });
      }

      setLoading('attaching');
      transitionRecoveryPhase('attaching');
      const dims = core.getDimensions();
      geometryPresentation.observeLocal(dims);
      const attachRequestEpoch = geometryPresentation.getState().requestEpoch;
      markTerminalRecoveryMilestone(trace, 'attach-start', { cols: dims.cols, rows: dims.rows });
      const attachResult = await props.transport.attachWithHistoryBoundary(id, dims.cols, dims.rows);
      if (seq !== initSeq) return;
      if (!Object.prototype.hasOwnProperty.call(attachResult, 'historyBoundarySequence')) {
        reportBlockingFailure('history_contract_missing');
        throw new Error('Terminal attach response omitted the history boundary');
      }
      const historyBoundarySequence = attachResult.historyBoundarySequence;
      if (!Number.isSafeInteger(historyBoundarySequence) || (historyBoundarySequence as number) < 0) {
        reportBlockingFailure('history_contract_invalid');
        throw new Error('Terminal attach response returned an invalid history boundary');
      }
      const initialEffective = geometryPresentation.acknowledgeAttach({
        lifecycleEpoch,
        rendererEpoch: activeGeometryRendererEpoch,
        requestEpoch: attachRequestEpoch,
        requested: dims,
        runtimeAttachGeneration: attachResult.runtimeAttachGeneration,
        effective: {
          generation: attachResult.geometryGeneration,
          outputSequenceBoundary: historyBoundarySequence,
          cols: attachResult.cols,
          rows: attachResult.rows,
        },
      });
      if (!initialEffective) {
        reportBlockingFailure('terminal_unavailable');
        throw new Error('Terminal attach geometry acknowledgement was inconsistent');
      }
      activeRuntimeAttachGeneration = attachResult.runtimeAttachGeneration;
      queueTerminalGeometry({ sessionId: id, ...initialEffective });
      markTerminalRecoveryMilestone(trace, 'attach-ack', {
        runtime_attach_generation: attachResult.runtimeAttachGeneration,
        cols: dims.cols,
        rows: dims.rows,
        snapshot_end_sequence: historyBoundarySequence,
      });
      publishTerminalRecoveryEvent(trace, 'attach_ack', {
        runtime_attach_generation: attachResult.runtimeAttachGeneration,
        cols: dims.cols,
        rows: dims.rows,
        snapshot_end_sequence: historyBoundarySequence,
      });
      core.setConnected(true);
      liveAttachmentReady = true;
      const latestDimensions = currentHostDimensions();
      if (latestDimensions && (latestDimensions.cols !== dims.cols || latestDimensions.rows !== dims.rows)) {
        await requestTerminalResize(id, latestDimensions);
        if (seq !== initSeq) return;
      }

      setLoading('loading_history');
      transitionRecoveryPhase('replaying');
      core.clear();
      outputProjection.reset();
      try {
        markTerminalRecoveryMilestone(trace, 'baseline-queued');
        const preparedHistory = preparedHistoryPromise
          ? await preparedHistoryPromise.catch(() => null)
          : null;
        if (seq !== initSeq) return;
        void coordinator.completeAttach(
          coordinatorAttachGeneration,
          historyBoundarySequence,
          preparedHistory ? { preparedHistory } : undefined,
        );
        const baseline = await coordinator.waitForBaseline();
        if (!baseline.baselineReady) {
          reportBlockingFailure(baseline.failure?.code ?? 'terminal_unavailable');
          throw new Error('Terminal history baseline unavailable');
        }
        if (preparedHistoryPromise) {
          const preparedHistoryOutcome = baseline.preparedHistoryOutcome;
          const preparedHistoryHit = preparedHistory !== null
            && preparedHistoryOutcome?.status === 'accepted';
          const preparedHistoryRebased = preparedHistory !== null
            && preparedHistoryOutcome?.rebased === true;
          if (preparedHistoryRebased) {
            markTerminalPerformance('prepared-history-rebased', {
              session_ref: pseudonymousTerminalSessionRef(id),
              variant: props.variant,
              history_generation: preparedHistory.historyGeneration,
              byte_length: preparedHistory.byteLength,
              page_count: preparedHistory.pageCount,
            });
            publishTerminalRecoveryEvent(trace, 'prepared_history_rebased', {
              history_generation: preparedHistory.historyGeneration,
              prepared_history_bytes: preparedHistory.byteLength,
              prepared_history_page_count: preparedHistory.pageCount,
            });
          }
          markTerminalPerformance(
            preparedHistoryHit ? 'prepared-history-hit' : 'prepared-history-miss',
            {
              session_ref: pseudonymousTerminalSessionRef(id),
              variant: props.variant,
              byte_length: preparedHistory?.byteLength,
              page_count: preparedHistory?.pageCount,
              delta_byte_length: historyBytes,
              delta_page_count: historyPageCount,
            },
          );
          publishTerminalRecoveryEvent(
            trace,
            preparedHistoryHit ? 'prepared_history_hit' : 'prepared_history_miss',
            preparedHistory
              ? {
                prepared_history_bytes: preparedHistory.byteLength,
                prepared_history_page_count: preparedHistory.pageCount,
                history_bytes: historyBytes,
                history_page_count: historyPageCount,
              }
              : {},
          );
        }
        const baselineDetail: TerminalRecoveryEventDetail = {
          coordinator_attach_generation: baseline.attachGeneration,
          history_generation: lastHistoryGeneration,
          history_page_count: historyPageCount,
          history_chunk_count: historyChunkCount,
          history_bytes: historyBytes,
          covered_through_sequence: baseline.coveredThroughSequence,
          snapshot_end_sequence: lastSnapshotEndSequence,
          first_retained_sequence: lastFirstRetainedSequence,
          history_reset: historyReset,
          history_truncated: historyTruncated,
        };
        markTerminalRecoveryMilestone(trace, 'baseline-parser-committed', baselineDetail);
        pendingBaselineRender = {
          core,
          initSequence: seq,
          trace,
          detail: baselineDetail,
          armed: false,
        };
        publishTerminalRecoveryEvent(trace, 'baseline_ready', baselineDetail);
      } finally {
        setHistoryReplayProgress(null);
      }
      if (seq !== initSeq) return;

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (seq !== initSeq || recoveryTrace !== trace || term !== core) return;
      armBaselineRender(core, trace, seq);
      if (!await settleTerminalPresentation(id, core, seq, reloadSequence, trace)) return;
      if (seq !== initSeq || recoveryTrace !== trace || term !== core) return;
      setLoading('idle');
      setReadyOnce(true);
      setGeometryRendererReady(true);
      transitionRecoveryPhase('interactive');
      markTerminalRecoveryMilestone(trace, 'interactive', {
        coordinator_attach_generation: outputCoordinatorSnapshot?.attachGeneration,
        history_generation: lastHistoryGeneration,
        covered_through_sequence: outputCoordinatorSnapshot?.coveredThroughSequence,
      });
      const activeElement = typeof document === 'undefined' ? null : document.activeElement;
      const focusStillOwned = focusWasAvailableAtStart && (activeElement == null
        || activeElement === document.body
        || target.contains(activeElement));
      if (focusStillOwned && props.viewActive() && props.active() && props.autoFocus() && !core.hasSelection()) core.focus();
      const el = container;
      if (el && el.style.opacity !== '1') {
        el.style.opacity = '1';
      }
      props.onInteractive?.(id);
    } catch (errorValue) {
      if (seq !== initSeq) return;
      if (pendingBaselineRender?.trace === trace) pendingBaselineRender = null;
      const lifecycleExit = classifyTerminalAttachLifecycleExit(errorValue);
      if (lifecycleExit) {
        if (lifecycleExit === 'session_gone') {
          setLoading('idle');
          if (props.onSessionGone) props.onSessionGone(id);
          else props.transport.forgetSession(id);
        } else {
          waitingForProtocolClient = props.protocolClient();
          setLoading('reconnecting');
        }
        const el = container;
        if (el) el.style.opacity = '1';
        return;
      }
      transitionRecoveryPhase('failed');
      setLoading('idle');
      if (!blockingFailureCode()) reportBlockingFailure('terminal_unavailable');
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  const hibernateForWorkingSet = async (): Promise<TerminalRestorableSnapshot | null> => {
    const core = term;
    if (!core) return null;

    const coordinator = outputCoordinator;
    if (!coordinator) return null;
    const restoreCoordinatorActivity = () => {
      if (outputCoordinator === coordinator) coordinator.setActive(liveRenderActive());
    };
    try {
      const coordinatorSnapshot = await coordinator.pause();
      if (term !== core) {
        restoreCoordinatorActivity();
        return null;
      }

      const snapshot = core.captureRestorableSnapshot({
        coveredThroughSequence: coordinatorSnapshot.coveredThroughSequence,
      });
      const knownEffective = geometryPresentation.getState().knownEffective;
      if (snapshot
        && knownEffective
        && snapshot.cols === knownEffective.cols
        && snapshot.rows === knownEffective.rows
        && snapshot.coveredThroughSequence >= knownEffective.outputSequenceBoundary) {
        snapshotGeometryFacts.set(snapshot, {
          effective: knownEffective,
          coveredThroughSequence: snapshot.coveredThroughSequence,
        });
      }
      disposeCore();
      return snapshot;
    } catch (errorValue) {
      restoreCoordinatorActivity();
      throw errorValue;
    }
  };

  const resumeFromWorkingSet = async (snapshot: TerminalRestorableSnapshot | null): Promise<void> => {
    if (term) {
      outputCoordinator?.setActive(liveRenderActive());
      return;
    }
    const id = sessionId();
    const target = container;
    if (!target || !props.connected()) {
      throw new Error('Terminal cannot resume while disconnected');
    }

    const seq = ++initSeq;
    const reloadSequence = reloadSeq;
    const trace = startRecoveryTrace();
    const focusOwnerAtStart = typeof document === 'undefined' ? null : document.activeElement;
    const focusWasAvailableAtStart = focusOwnerAtStart == null
      || focusOwnerAtStart === document.body
      || target.contains(focusOwnerAtStart);
    setBlockingFailureCode(null);
    setLoading('initializing');
    setShowLoading(true);
    const core = createCore(id, target, { preserveGeometryQueue: true });
    const coordinator = ensureOutputCoordinator(id);

    try {
      await core.initialize({ priority: 'interactive' });
      if (seq !== initSeq) return;
      props.registerCore(id, core);
      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });
      core.setConnected(true);

      const snapshotCapture = snapshot ? snapshotGeometryFacts.get(snapshot) ?? null : null;
      const snapshotFact = snapshotCapture?.effective ?? null;
      const snapshotEffective = snapshot
        && snapshotFact
        && snapshotCapture
        && snapshotFact.lifecycleEpoch === activeGeometryLifecycleEpoch
        && snapshot.cols === snapshotFact.cols
        && snapshot.rows === snapshotFact.rows
        && snapshot.coveredThroughSequence === snapshotCapture.coveredThroughSequence
        && snapshot.coveredThroughSequence >= snapshotFact.outputSequenceBoundary
        ? snapshotFact
        : null;
      const validSnapshot = snapshotEffective ? snapshot : null;
      const retainedEffective = geometryPresentation.getState().knownEffective;
      let seedEffective = snapshotEffective ?? retainedEffective;
      if (!seedEffective) {
        const dimensions = core.getDimensions();
        latestHostDimensions = dimensions;
        geometryPresentation.observeLocal(dimensions);
        seedEffective = await requestTerminalResize(id, dimensions);
        if (!seedEffective) {
          throw new Error('Terminal resume could not confirm the current shared geometry');
        }
      }
      if (seedEffective) {
        core.setFixedDimensions({ cols: seedEffective.cols, rows: seedEffective.rows });
      }

      const restoreSource = await restoreTerminalSnapshotOrReplay({
        snapshot: validSnapshot,
        restoreSnapshot: (value) => core.restoreSnapshot(value),
        replayHistory: async () => {
          replayCoveredBytes = 0;
          replayTotalBytes = 0;
          setLoading('loading_history');
          transitionRecoveryPhase('replaying');
          core.clear();
          outputProjection.reset();
          try {
            markTerminalRecoveryMilestone(trace, 'baseline-queued');
            void coordinator.attach(0);
            const baseline = await coordinator.waitForBaseline();
            if (!baseline.baselineReady) {
              reportBlockingFailure(baseline.failure?.code ?? 'terminal_unavailable');
              throw new Error('Terminal history baseline unavailable');
            }
            const baselineDetail: TerminalRecoveryEventDetail = {
              coordinator_attach_generation: baseline.attachGeneration,
              history_generation: lastHistoryGeneration,
              history_page_count: historyPageCount,
              history_chunk_count: historyChunkCount,
              history_bytes: historyBytes,
              covered_through_sequence: baseline.coveredThroughSequence,
              snapshot_end_sequence: lastSnapshotEndSequence,
              first_retained_sequence: lastFirstRetainedSequence,
              history_reset: historyReset,
              history_truncated: historyTruncated,
            };
            markTerminalRecoveryMilestone(trace, 'baseline-parser-committed', baselineDetail);
            pendingBaselineRender = {
              core,
              initSequence: seq,
              trace,
              detail: baselineDetail,
              armed: false,
            };
            publishTerminalRecoveryEvent(trace, 'baseline_ready', baselineDetail);
          } finally {
            setHistoryReplayProgress(null);
          }
          if (seq !== initSeq) return;
        },
      });
      if (seq !== initSeq) return;

      if (restoreSource === 'snapshot' && validSnapshot && snapshotEffective) {
        lastWrittenOutputSequence = Math.max(
          lastWrittenOutputSequence,
          validSnapshot.coveredThroughSequence,
        );
        queueTerminalGeometry({ sessionId: id, ...snapshotEffective });
      }
      const latestEffective = geometryPresentation.getState().knownEffective;
      if (latestEffective) queueTerminalGeometry({ sessionId: id, ...latestEffective });

      coordinator.setActive(liveRenderActive());
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (term !== core || seq !== initSeq || recoveryTrace !== trace) return;
      armBaselineRender(core, trace, seq);
      if (!await settleTerminalPresentation(id, core, seq, reloadSequence, trace)) return;
      if (term !== core || seq !== initSeq || recoveryTrace !== trace) return;
      setLoading('idle');
      setReadyOnce(true);
      setShowLoading(false);
      setGeometryRendererReady(true);
      transitionRecoveryPhase('interactive');
      markTerminalRecoveryMilestone(trace, 'interactive', {
        coordinator_attach_generation: coordinator.getSnapshot().attachGeneration,
        covered_through_sequence: coordinator.getSnapshot().coveredThroughSequence,
      });
      const activeElement = typeof document === 'undefined' ? null : document.activeElement;
      const focusStillOwned = focusWasAvailableAtStart && (activeElement == null
        || activeElement === document.body
        || target.contains(activeElement));
      const interactiveCore = core as TerminalCore;
      if (focusStillOwned && props.viewActive() && props.active() && props.autoFocus() && !interactiveCore.hasSelection()) interactiveCore.focus();
      props.onInteractive?.(id);
    } catch (errorValue) {
      if (seq !== initSeq) return;
      if (pendingBaselineRender?.trace === trace) pendingBaselineRender = null;
      transitionRecoveryPhase('failed');
      setLoading('idle');
      setShowLoading(false);
      if (!blockingFailureCode()) reportBlockingFailure('terminal_unavailable');
      throw errorValue;
    }
  };

  const workingSetRuntime: TerminalWorkingSetRuntime = {
    getResourceEstimate: () => term?.getResourceEstimate() ?? {
      bufferBytes: 0,
      cellCount: 0,
      wasmMemoryBytes: 0,
      estimatedBytes: 0,
      rendererType: 'webgl',
    },
    isProtected: () => term?.hasSelection() === true,
    hibernate: hibernateForWorkingSet,
    resume: resumeFromWorkingSet,
  };

  createEffect(() => {
    if (!readyOnce() || workingSetRegistered) return;
    workingSetRegistered = true;
    props.registerWorkingSetRuntime(sessionId(), workingSetRuntime);
  });

  createEffect(() => {
    const active = liveRenderActive();
    outputCoordinator?.setActive(active);
  });

  createEffect(() => {
    const client = props.protocolClient();
    if (!client) return;
    if (!container) return;
    if (untrack(loading) === 'reconnecting' && client === waitingForProtocolClient) return;

    // Untrack to avoid capturing theme/font reactivity as init dependencies.
    untrack(() => void reload());
  });

  createEffect(() => {
    const appearance = buildTerminalAppearance();
    if (!term) return;
    scheduleTerminalAppearanceApply(appearance);
  });

  createEffect(() => {
    const ariaLabel = i18n.t('terminal.historyScrollbar');
    if (!term) return;
    term.setScrollbarOptions({ ariaLabel });
  });

  createEffect(() => {
    if (!props.viewActive() || !props.active()) return;
    if (!term) return;
    if (loading() !== 'idle') return;
    scheduleTerminalActivationRefresh();
  });

  onCleanup(() => {
    disposed = true;
    initSeq += 1;
    reloadSeq += 1;
    disposeTerminal();
    geometryPresentation.dispose();
    props.registerCore(sessionId(), null);
    props.registerSurfaceElement(sessionId(), null);
    props.onRuntimeStatus?.(stableSessionId, { state: 'idle' });
  });

  const terminalBackground = () => colors().background ?? '#1e1e1e';
  const terminalForeground = () => colors().foreground ?? '#c9d1d9';
  const terminalLoadingVars = () => ({
    '--redeven-terminal-loading-background': terminalBackground(),
    '--redeven-terminal-loading-foreground': terminalForeground(),
  });
  return (
    <div
      aria-busy={terminalInputBlocked()}
      class="h-full min-h-0 relative overflow-hidden"
      data-terminal-runtime-session={stableSessionId}
      onCompositionStart={() => props.setWorkingSetInteraction(sessionId(), 'composition', true)}
      onCompositionEnd={() => props.setWorkingSetInteraction(sessionId(), 'composition', false)}
      style={{
        'background-color': terminalBackground(),
        '--terminal-bottom-inset': `${props.bottomInsetPx()}px`,
        '--background': terminalBackground(),
        '--foreground': terminalForeground(),
        '--primary': terminalForeground(),
        '--muted': `color-mix(in srgb, ${terminalForeground()} 12%, ${terminalBackground()})`,
        '--muted-foreground': `color-mix(in srgb, ${terminalForeground()} 70%, transparent)`,
        ...terminalLoadingVars(),
      }}
    >
      <div
        ref={(n) => {
          container = n;
          props.registerSurfaceElement(sessionId(), n);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class="absolute top-2 left-2 right-0 bottom-0 redeven-terminal-surface"
        onClick={(event) => props.onSurfaceClick?.(event)}
        style={{
          transition: 'opacity 0.15s ease-out',
          bottom: 'var(--terminal-bottom-inset)',
          opacity: readyOnce() ? (showLoading() ? '0' : '1') : (loading() === 'idle' ? '1' : '0'),
        }}
      />

      <RedevenLoadingCurtain
        visible={showLoading()}
        eyebrow={i18n.t('terminal.creatingEyebrow')}
        message={loadingMessage()}
        class="redeven-terminal-loading-curtain"
      />
    </div>
  );
}
