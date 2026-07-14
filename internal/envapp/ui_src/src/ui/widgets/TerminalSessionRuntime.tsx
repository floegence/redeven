import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

import {
  TerminalCore,
  createPagedTerminalOutputCoordinator,
  getDefaultTerminalConfig,
  type Logger,
  type PagedTerminalHistoryPage,
  type PagedTerminalOutputCoordinatorHandle,
  type PagedTerminalOutputFailureCode,
  type PagedTerminalOutputSnapshot,
  type TerminalAppearance,
  type TerminalEventSource,
  type TerminalResponsiveConfig,
  type TerminalRestorableSnapshot,
  type TerminalSessionInfo,
} from '@floegence/floeterm-terminal-web';
import type { RedevenTerminalTransport } from '../services/terminalTransport';
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
  type TerminalRecoveryPhase,
  type TerminalRecoveryTrace,
} from '../services/terminalRecoveryDiagnostics';

type SessionLoadingState = 'idle' | 'initializing' | 'attaching' | 'loading_history';

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

export type TerminalSessionRuntimeActions = Readonly<{
  reload: () => Promise<void>;
  resetAfterClear: () => Promise<boolean>;
  retryOutputRecovery: () => Promise<void>;
  focusIfInteractive: () => boolean;
}>;

export type TerminalSessionRuntimeStatus = Readonly<{
  state: 'idle' | 'retrying' | 'degraded' | 'blocking';
  failureCode?: PagedTerminalOutputFailureCode | 'terminal_unavailable';
  retryable?: boolean;
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
  eventSource: TerminalEventSource;
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: TerminalSessionRuntimeActions | null) => void;
  registerWorkingSetRuntime: (sessionId: string, runtime: TerminalWorkingSetRuntime | null) => void;
  onRuntimeStatus?: (sessionId: string, status: TerminalSessionRuntimeStatus) => void;
  onLiveOutputObserved?: (sessionId: string, byteLength: number, sequence: number | undefined) => void;
  onOutputCommitted?: (sessionId: string, source: 'history' | 'live', sequence: number | undefined) => void;
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
  onNameUpdate?: (sessionId: string, newName: string, workingDir: string) => void;
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

  const [showLoading, setShowLoading] = createSignal(false);
  let loadingDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const loadingMessage = createMemo(() => {
    if (loading() === 'initializing') return i18n.t('terminal.initializing');
    if (loading() === 'attaching') return i18n.t('terminal.attaching');
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
      return { state: 'blocking', failureCode: blocking, retryable: isTerminalRecoveryRetryable(blocking) };
    }
    if (baselineReady() && outputRecoveryState() === 'failed') {
      return {
        state: 'degraded',
        failureCode: recoveryFailureCode() ?? undefined,
        retryable: recoveryRetryable() ?? undefined,
      };
    }
    if (baselineReady() && outputRecoveryState() === 'retry-wait' && showRetryingStatus()) {
      return { state: 'retrying', failureCode: recoveryFailureCode() ?? undefined };
    }
    return { state: 'idle' };
  });

  createEffect(() => {
    const status = runtimeStatus();
    props.onRuntimeStatus?.(stableSessionId, status);
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
  let appearanceRaf: number | null = null;
  let activationRaf: number | null = null;
  let inputProtectionTimer: ReturnType<typeof setTimeout> | null = null;
  let workingSetRegistered = false;
  let recoveryTrace: TerminalRecoveryTrace | null = null;
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
  let lastDegradedEventKey = '';
  let lastBlockingEventKey = '';
  let liveMilestoneMarked = false;
  let outputCoordinatorEpoch = 0;
  let observedLiveAttachGeneration = 0;
  let maxObservedLiveSequence = 0;

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

  const reportBlockingFailure = (code: 'terminal_unavailable' | PagedTerminalOutputFailureCode) => {
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
      props.onOutputCommitted?.(sessionId(), source, sequence);
    },
    onVisibleOutput: (source, byteLength, sequence) => {
      props.onVisibleOutput?.(sessionId(), source, byteLength, sequence);
    },
  });
  let outputCoordinator: PagedTerminalOutputCoordinatorHandle | null = null;
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
    if (!core || terminalInputBlocked() || core.hasSelection()) return false;
    core.focus();
    return true;
  };

  const clearOutputSubscription = () => {
    unsubData?.();
    unsubData = null;
    unsubNameUpdate?.();
    unsubNameUpdate = null;
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
      props.onLiveOutputObserved?.(sessionId(), data.byteLength, normalizedSequence);
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
    term?.dispose();
    term = null;
    props.registerCore(sessionId(), null);
  };

  const disposeTerminal = () => {
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
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const reload = async (opts?: { fadeOut?: boolean }): Promise<boolean> => {
    const id = sessionId();
    if (!id) return false;
    if (!props.connected()) return false;
    if (!container) return false;

    const seq = ++reloadSeq;

    // Keep the surface hidden until the new terminal is attached and history is replayed (same as page open).
    setBlockingFailureCode(null);
    setLoading('initializing');

    if (opts?.fadeOut) {
      container.style.opacity = '0';
      await sleep(150);
      if (seq !== reloadSeq) return false;
    }

    // Invalidate the old init before waiting so a baseline waiter cannot publish stale state.
    initSeq += 1;
    const coordinator = outputCoordinator;
    if (coordinator) await coordinator.pause();
    if (seq !== reloadSeq) return false;
    disposeTerminal();

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (seq !== reloadSeq) return false;
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
      resetAfterClear: () => reload(),
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

  const createCore = (id: string, target: HTMLDivElement): TerminalCore => {
    const core = new TerminalCore(
      target,
      getDefaultTerminalConfig('dark', {
        cursorBlink: false,
        rendererType: 'webgl',
        fontSize: fontSize(),
        // Workbench zoom is an outer visual transform; terminal geometry stays stable.
        presentationScale: 1,
        fit: props.variant === 'workbench' ? { scrollbarReservePx: 0 } : undefined,
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
          void props.transport.resize(id, size.cols, size.rows);
        },
        onError: (e: Error) => {
          buildLogger().error('[TerminalPanel] Terminal core failed', { sessionId: id, error: e });
          reportBlockingFailure('terminal_unavailable');
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
      write: (payload) => new Promise<void>((resolve, reject) => {
        if (payload.byteLength === 0) {
          resolve();
          return;
        }
        const core = term;
        if (!core) {
          reject(new Error('Terminal output writer lost its active core'));
          return;
        }
        core.write(payload, resolve);
      }),
      writeHistory: (payload) => new Promise<void>((resolve, reject) => {
        if (payload.byteLength === 0) {
          resolve();
          return;
        }
        const core = term;
        if (!core) {
          reject(new Error('Terminal history writer lost its active core'));
          return;
        }
        core.writeHistory(payload, resolve);
      }),
      clear: () => {
        term?.clear();
        outputProjection.reset();
      },
      onHistoryTruncated: (reason) => {
        buildLogger().warn('[TerminalPanel] Rebased truncated terminal history', { sessionId: id, reason });
        setOutputRecoveryState('catching-up');
      },
      onStateChange: (snapshot) => {
        outputCoordinatorSnapshot = snapshot;
        if (snapshot.attachGeneration !== observedLiveAttachGeneration) {
          observedLiveAttachGeneration = snapshot.attachGeneration;
          maxObservedLiveSequence = snapshot.coveredThroughSequence;
        } else {
          maxObservedLiveSequence = Math.max(maxObservedLiveSequence, snapshot.coveredThroughSequence);
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
    const trace = startRecoveryTrace();
    const focusOwnerAtStart = typeof document === 'undefined' ? null : document.activeElement;
    const focusWasAvailableAtStart = focusOwnerAtStart == null
      || focusOwnerAtStart === document.body
      || target.contains(focusOwnerAtStart);
    setBlockingFailureCode(null);
    setLoading('initializing');

    const core = createCore(id, target);
    ensureOutputCoordinator(id);

    try {
      await core.initialize();
      if (seq !== initSeq) return;

      // After core.initialize(), the underlying terminal instance is ready: re-register to keep the outer registry consistent.
      props.registerCore(id, core);

      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });

      clearOutputSubscription();
      unsubData = props.eventSource.onTerminalData(id, (ev) => {
        handleLiveTerminalData(ev.data, ev.sequence);
      });

      if (props.eventSource.onTerminalNameUpdate) {
        unsubNameUpdate = props.eventSource.onTerminalNameUpdate(id, (ev) => {
          props.onNameUpdate?.(ev.sessionId, ev.newName, ev.workingDir);
        });
      }

      setLoading('attaching');
      transitionRecoveryPhase('attaching');
      const dims = core.getDimensions();
      markTerminalRecoveryMilestone(trace, 'attach-start', { cols: dims.cols, rows: dims.rows });
      await props.transport.attach(id, dims.cols, dims.rows);
      if (seq !== initSeq) return;
      markTerminalRecoveryMilestone(trace, 'attach-ack', { cols: dims.cols, rows: dims.rows });
      publishTerminalRecoveryEvent(trace, 'attach_ack', { cols: dims.cols, rows: dims.rows });

      setLoading('loading_history');
      transitionRecoveryPhase('replaying');
      core.clear();
      outputProjection.reset();
      try {
        const coordinator = outputCoordinator;
        if (!coordinator) throw new Error('Terminal output coordinator unavailable');
        markTerminalRecoveryMilestone(trace, 'baseline-queued');
        void coordinator.attach(0);
        const baseline = await coordinator.waitForBaseline();
        if (!baseline.baselineReady) {
          reportBlockingFailure(baseline.failure?.code ?? 'terminal_unavailable');
          throw new Error('Terminal history baseline unavailable');
        }
        markTerminalRecoveryMilestone(trace, 'baseline-parser-committed', {
          coordinator_attach_generation: baseline.attachGeneration,
          history_generation: lastHistoryGeneration,
          covered_through_sequence: baseline.coveredThroughSequence,
          snapshot_end_sequence: lastSnapshotEndSequence,
          first_retained_sequence: lastFirstRetainedSequence,
          history_reset: historyReset,
          history_truncated: historyTruncated,
        });
        publishTerminalRecoveryEvent(trace, 'baseline_ready', {
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
        });
      } finally {
        setHistoryReplayProgress(null);
      }
      if (seq !== initSeq) return;
      setLoading('idle');
      setReadyOnce(true);
      transitionRecoveryPhase('interactive');
      markTerminalRecoveryMilestone(trace, 'interactive', {
        coordinator_attach_generation: outputCoordinatorSnapshot?.attachGeneration,
        history_generation: lastHistoryGeneration,
        covered_through_sequence: outputCoordinatorSnapshot?.coveredThroughSequence,
      });

      requestAnimationFrame(() => {
        if (seq !== initSeq || recoveryTrace !== trace || term !== core) return;
        core.forceResize();
        const activeElement = typeof document === 'undefined' ? null : document.activeElement;
        const focusStillOwned = focusWasAvailableAtStart && (activeElement == null
          || activeElement === document.body
          || target.contains(activeElement));
        if (focusStillOwned && props.viewActive() && props.active() && props.autoFocus() && !core.hasSelection()) core.focus();
        const el = container;
        if (el && el.style.opacity !== '1') {
          el.style.opacity = '1';
        }
      });
    } catch {
      if (seq !== initSeq) return;
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
    const trace = startRecoveryTrace();
    const focusOwnerAtStart = typeof document === 'undefined' ? null : document.activeElement;
    const focusWasAvailableAtStart = focusOwnerAtStart == null
      || focusOwnerAtStart === document.body
      || target.contains(focusOwnerAtStart);
    setBlockingFailureCode(null);
    setLoading('initializing');
    setShowLoading(true);
    const core = createCore(id, target);
    const coordinator = ensureOutputCoordinator(id);

    try {
      await core.initialize();
      if (seq !== initSeq) return;
      props.registerCore(id, core);
      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });

      await restoreTerminalSnapshotOrReplay({
        snapshot,
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
            markTerminalRecoveryMilestone(trace, 'baseline-parser-committed', {
              coordinator_attach_generation: baseline.attachGeneration,
              history_generation: lastHistoryGeneration,
              covered_through_sequence: baseline.coveredThroughSequence,
            });
            publishTerminalRecoveryEvent(trace, 'baseline_ready', {
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
            });
          } finally {
            setHistoryReplayProgress(null);
          }
          if (seq !== initSeq) return;
        },
      });
      if (seq !== initSeq) return;

      setLoading('idle');
      setReadyOnce(true);
      setShowLoading(false);
      transitionRecoveryPhase('interactive');
      markTerminalRecoveryMilestone(trace, 'interactive', {
        coordinator_attach_generation: coordinator.getSnapshot().attachGeneration,
        covered_through_sequence: coordinator.getSnapshot().coveredThroughSequence,
      });
      coordinator.setActive(liveRenderActive());
      requestAnimationFrame(() => {
        if (term !== core || seq !== initSeq || recoveryTrace !== trace) return;
        core.forceResize();
        const activeElement = typeof document === 'undefined' ? null : document.activeElement;
        const focusStillOwned = focusWasAvailableAtStart && (activeElement == null
          || activeElement === document.body
          || target.contains(activeElement));
        if (focusStillOwned && props.viewActive() && props.active() && props.autoFocus() && !core.hasSelection()) core.focus();
      });
    } catch (errorValue) {
      if (seq !== initSeq) return;
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

    // Untrack to avoid capturing theme/font reactivity as init dependencies.
    untrack(() => void reload());
  });

  createEffect(() => {
    const appearance = buildTerminalAppearance();
    if (!term) return;
    scheduleTerminalAppearanceApply(appearance);
  });

  createEffect(() => {
    if (!props.viewActive() || !props.active()) return;
    if (!term) return;
    if (loading() !== 'idle') return;
    scheduleTerminalActivationRefresh();
  });

  onCleanup(() => {
    initSeq += 1;
    reloadSeq += 1;
    disposeTerminal();
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
      class="h-full min-h-0 relative overflow-hidden"
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
