import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

import {
  TerminalCore,
  createPagedTerminalOutputCoordinator,
  getDefaultTerminalConfig,
  type Logger,
  type PagedTerminalOutputCoordinatorHandle,
  type PagedTerminalOutputSnapshot,
  type TerminalAppearance,
  type TerminalEventSource,
  type TerminalResponsiveConfig,
  type TerminalRestorableSnapshot,
  type TerminalSessionInfo,
} from '@floegence/floeterm-terminal-web';
import type { RedevenTerminalTransport } from '../services/terminalTransport';
import { createTerminalFileLinkProvider, type TerminalResolvedLinkTarget } from '../services/terminalLinkProvider';
import { TerminalShellIntegrationParser, type TerminalShellIntegrationEvent } from '../services/terminalShellIntegration';
import {
  restoreTerminalSnapshotOrReplay,
  type TerminalWorkingSetInteraction,
  type TerminalWorkingSetRuntime,
} from '../services/terminalAdaptiveWorkingSet';
import { normalizeAbsolutePath as normalizeAskFlowerAbsolutePath } from '../utils/askFlowerPath';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useI18n } from '../i18n';

type SessionLoadingState = 'idle' | 'initializing' | 'attaching' | 'loading_history';

const TERMINAL_HISTORY_REPLAY_MODE_MS = 120_000;

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
  resetAfterClear: () => void;
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
  eventSource: TerminalEventSource;
  registerCore: (sessionId: string, core: TerminalCore | null) => void;
  registerSurfaceElement: (sessionId: string, surface: HTMLDivElement | null) => void;
  registerActions: (sessionId: string, actions: TerminalSessionRuntimeActions | null) => void;
  registerWorkingSetRuntime: (sessionId: string, runtime: TerminalWorkingSetRuntime | null) => void;
  setWorkingSetInteraction: (sessionId: string, interaction: TerminalWorkingSetInteraction, active: boolean) => void;
  onSurfaceClick?: (event: MouseEvent) => void;
  onBell?: (sessionId: string) => void;
  onShellIntegrationEvent?: (sessionId: string, event: TerminalShellIntegrationEvent, source: 'history' | 'live') => void;
  onVisibleOutput?: (sessionId: string, source: 'history' | 'live', byteLength: number) => void;
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
  const [error, setError] = createSignal<string | null>(null);
  const [readyOnce, setReadyOnce] = createSignal(false);
  const [outputRecoveryState, setOutputRecoveryState] = createSignal<PagedTerminalOutputSnapshot['state']>('idle');
  const [outputRecoveryError, setOutputRecoveryError] = createSignal<string | null>(null);
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

  const outputRecoveryMessage = createMemo(() => {
    const state = outputRecoveryState();
    if (state === 'catching-up') return i18n.t('terminal.recoveringOutput');
    if (state === 'retry-wait') return i18n.t('terminal.retryingOutputRecovery');
    if (state === 'failed') return outputRecoveryError() ?? i18n.t('terminal.outputRecoveryFailed');
    return error();
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
    if (opts?.focus && props.viewActive() && props.active() && props.autoFocus()) {
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
      if (!core) return;
      applyTerminalAppearance(core, buildTerminalAppearance(), {
        forceResize: true,
        focus: true,
      });
    });
  };

  let replaying = false;
  const shellIntegrationParser = new TerminalShellIntegrationParser();
  let outputCoordinator: PagedTerminalOutputCoordinatorHandle | null = null;
  let outputCoordinatorSnapshot: PagedTerminalOutputSnapshot | null = null;
  let replayCoveredBytes = 0;
  let replayTotalBytes = 0;
  const projectedLiveBySequence = new Map<number, Uint8Array>();

  const liveRenderActive = () => {
    const active = props.viewActive() && props.active();
    return term !== null && active;
  };

  const normalizeLiveSequence = (sequence: number | undefined): number | undefined => (
    typeof sequence === 'number' && Number.isFinite(sequence) && sequence > 0
      ? Math.floor(sequence)
      : undefined
  );

  const historyPageCoveredThrough = (page: {
    lastSequence: number;
    chunks: readonly { sequence: number }[];
  }): number | undefined => {
    let coveredThrough = normalizeLiveSequence(page.lastSequence);
    for (const chunk of page.chunks) {
      const seq = normalizeLiveSequence(chunk.sequence);
      if (seq && (!coveredThrough || seq > coveredThrough)) {
        coveredThrough = seq;
      }
    }
    return coveredThrough;
  };

  const terminalInputBlocked = () => {
    if (loading() !== 'idle' || replaying) return true;
    return false;
  };

  const clearOutputSubscription = () => {
    unsubData?.();
    unsubData = null;
    unsubNameUpdate?.();
    unsubNameUpdate = null;
  };

  const consumeTerminalChunk = (
    data: Uint8Array,
    source: 'history' | 'live',
    opts?: { publishActivity?: boolean },
  ): Uint8Array => {
    const result = shellIntegrationParser.parse(data);
    if (opts?.publishActivity !== false) {
      for (const event of result.events) {
        props.onShellIntegrationEvent?.(sessionId(), event, source);
      }
      if (result.displayData.byteLength > 0) {
        props.onVisibleOutput?.(sessionId(), source, result.displayData.byteLength);
      }
    }
    return result.displayData;
  };

  const handleLiveTerminalData = (data: Uint8Array, sequence: number | undefined) => {
    const coordinator = outputCoordinator;
    if (!coordinator) return;

    const normalizedSequence = normalizeLiveSequence(sequence);
    if (
      normalizedSequence
      && outputCoordinatorSnapshot
      && normalizedSequence <= outputCoordinatorSnapshot.coveredThroughSequence
    ) {
      return;
    }

    const shouldProjectNow = outputCoordinatorSnapshot?.state !== 'initial-replay';
    const projectedData = shouldProjectNow ? consumeTerminalChunk(data, 'live') : data;
    if (shouldProjectNow && normalizedSequence) {
      projectedLiveBySequence.set(normalizedSequence, projectedData);
    }
    coordinator.pushLive({
      sequence: normalizedSequence,
      data: projectedData,
      source: 'live',
      pretransformed: shouldProjectNow,
    } as { sequence?: number; data: Uint8Array; source: 'live'; pretransformed: boolean });
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
    projectedLiveBySequence.clear();
    disposeCore();
    replaying = false;
    shellIntegrationParser.reset();
    setReadyOnce(false);
    if (workingSetRegistered) {
      workingSetRegistered = false;
      props.registerWorkingSetRuntime(sessionId(), null);
    }
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
    props.registerActions(id, {
      reload: () => reload(),
      resetAfterClear: () => {
        projectedLiveBySequence.clear();
        shellIntegrationParser.reset();
        outputCoordinator?.clear(1);
        void outputCoordinator?.attach(0);
      },
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
      onActivate: (targetLink) => props.onTerminalFileLinkOpen?.(targetLink),
    }));

    term = core;
    props.registerCore(id, core);
    return core;
  };

  const ensureOutputCoordinator = (id: string) => {
    if (outputCoordinator) return outputCoordinator;
    replayCoveredBytes = 0;
    replayTotalBytes = 0;
    outputCoordinator = createPagedTerminalOutputCoordinator({
      isInteractive: liveRenderActive,
      policy: {
        maxRetainedLiveChunks: 2048,
        maxRetainedLiveBytes: 8 * 1024 * 1024,
        retryDelaysMs: [250, 1000, 4000],
      },
      fetchPage: async ({ startSequence, cursor }) => {
        const pageCursor = typeof cursor === 'number' ? cursor : startSequence;
        const page = await props.transport.historyPage(id, pageCursor, -1);
        replayCoveredBytes += Math.max(0, page.coveredBytes);
        replayTotalBytes = page.totalBytes > 0 ? page.totalBytes : replayTotalBytes;
        if (replayTotalBytes > 0) {
          setHistoryReplayProgress({
            loadedBytes: Math.min(replayCoveredBytes, replayTotalBytes),
            totalBytes: replayTotalBytes,
          });
        }
        const coveredThroughSequence = historyPageCoveredThrough(page) ?? Math.max(0, pageCursor - 1);
        return {
          chunks: page.chunks.map((chunk) => {
            const projected = projectedLiveBySequence.get(chunk.sequence);
            return {
              ...chunk,
              data: projected === undefined
                ? chunk.data
                : consumeTerminalChunk(chunk.data, 'history', { publishActivity: false }),
              source: 'history' as const,
              pretransformed: projected !== undefined,
            };
          }),
          hasMore: page.hasMore,
          nextCursor: page.hasMore ? page.nextStartSeq : undefined,
          firstAvailableSequence: page.firstSequence > 0 ? page.firstSequence : undefined,
          coveredThroughSequence,
          coveredBytes: page.coveredBytes,
          totalBytes: page.totalBytes,
        };
      },
      transformChunk: (chunk) => {
        const metadata = chunk as {
          sequence?: number;
          data: Uint8Array;
          source?: 'history' | 'live';
          pretransformed?: boolean;
        };
        if (metadata.pretransformed) return chunk.data;
        const source = metadata.source ?? 'live';
        return consumeTerminalChunk(chunk.data, source);
      },
      write: (payload) => {
        if (payload.byteLength > 0) term?.write(payload);
      },
      clear: () => {
        term?.clear();
        shellIntegrationParser.reset();
      },
      onHistoryTruncated: (reason) => {
        buildLogger().warn('[TerminalPanel] Rebased truncated terminal history', { sessionId: id, reason });
        setOutputRecoveryState('catching-up');
      },
      onStateChange: (snapshot) => {
        outputCoordinatorSnapshot = snapshot;
        setOutputRecoveryState(snapshot.state);
        if (snapshot.state === 'failed') {
          const message = snapshot.lastError instanceof Error
            ? snapshot.lastError.message
            : String(snapshot.lastError || 'Terminal output recovery failed');
          setOutputRecoveryError(message);
        } else if (snapshot.state !== 'disposed') {
          setOutputRecoveryError(null);
        }
        if (snapshot.state === 'live') {
          setHistoryReplayProgress(null);
          for (const sequence of projectedLiveBySequence.keys()) {
            if (sequence <= snapshot.coveredThroughSequence) {
              projectedLiveBySequence.delete(sequence);
            }
          }
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
    setError(null);
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
      replaying = true;
      unsubData = props.eventSource.onTerminalData(id, (ev) => {
        handleLiveTerminalData(ev.data, ev.sequence);
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
      core.clear();
      shellIntegrationParser.reset();
      core.startHistoryReplay(TERMINAL_HISTORY_REPLAY_MODE_MS);
      try {
        await outputCoordinator?.attach(0);
        while (
          seq === initSeq
          && outputCoordinatorSnapshot
          && outputCoordinatorSnapshot.state !== 'live'
          && outputCoordinatorSnapshot.state !== 'failed'
        ) {
          await sleep(25);
        }
      } finally {
        core.endHistoryReplay();
        setHistoryReplayProgress(null);
      }
      if (seq !== initSeq) return;
      if (outputCoordinatorSnapshot?.state === 'failed') {
        throw outputCoordinatorSnapshot.lastError instanceof Error
          ? outputCoordinatorSnapshot.lastError
          : new Error(String(outputCoordinatorSnapshot.lastError || 'Terminal output recovery failed'));
      }
      replaying = false;

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
      replaying = false;
      setLoading('idle');
      if (outputCoordinatorSnapshot?.state !== 'failed') {
        setError(e instanceof Error ? e.message : String(e));
      }
      const el = container;
      if (el) el.style.opacity = '1';
    }
  };

  const hibernateForWorkingSet = async (): Promise<TerminalRestorableSnapshot | null> => {
    const core = term;
    if (!core) return null;

    outputCoordinator?.setActive(false);
    await nextAnimationFrame();
    if (term !== core) return null;

    const snapshot = core.captureRestorableSnapshot({
      coveredThroughSequence: outputCoordinator?.getSnapshot().coveredThroughSequence ?? 0,
    });
    disposeCore();
    return snapshot;
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
    setError(null);
    setLoading('initializing');
    setShowLoading(true);
    const core = createCore(id, target);
    const coordinator = ensureOutputCoordinator(id);

    try {
      await core.initialize();
      if (seq !== initSeq) return;
      props.registerCore(id, core);
      applyTerminalAppearance(core, buildTerminalAppearance(), { forceResize: true });

      const recoverySource = await restoreTerminalSnapshotOrReplay({
        snapshot,
        restoreSnapshot: (value) => core.restoreSnapshot(value),
        replayHistory: async () => {
          replaying = true;
          replayCoveredBytes = 0;
          replayTotalBytes = 0;
          setLoading('loading_history');
          core.clear();
          shellIntegrationParser.reset();
          core.startHistoryReplay(TERMINAL_HISTORY_REPLAY_MODE_MS);
          try {
            await coordinator.attach(0);
            while (
              seq === initSeq
              && outputCoordinatorSnapshot
              && outputCoordinatorSnapshot.state !== 'live'
              && outputCoordinatorSnapshot.state !== 'failed'
            ) {
              await sleep(25);
            }
          } finally {
            core.endHistoryReplay();
            setHistoryReplayProgress(null);
          }
          if (seq !== initSeq) return;
          if (outputCoordinatorSnapshot?.state === 'failed') {
            throw outputCoordinatorSnapshot.lastError instanceof Error
              ? outputCoordinatorSnapshot.lastError
              : new Error(String(outputCoordinatorSnapshot.lastError || 'Terminal output recovery failed'));
          }
          replaying = false;
        },
      });
      if (seq !== initSeq) return;

      setLoading('idle');
      setReadyOnce(true);
      setShowLoading(false);
      if (recoverySource === 'snapshot' && snapshot) {
        coordinator.setActive(false);
        void coordinator.attach(snapshot.coveredThroughSequence + 1).then(() => {
          if (seq === initSeq && term === core) coordinator.setActive(liveRenderActive());
        });
      } else {
        coordinator.setActive(liveRenderActive());
      }
      requestAnimationFrame(() => {
        if (term !== core) return;
        core.forceResize();
        if (props.viewActive() && props.active() && props.autoFocus()) core.focus();
      });
      await confirmAttachedViewportSize(core, id, seq);
    } catch (errorValue) {
      if (seq !== initSeq) return;
      replaying = false;
      setLoading('idle');
      setShowLoading(false);
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
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
    if (replaying || loading() !== 'idle') return;
    scheduleTerminalActivationRefresh();
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
  const terminalLoadingVars = () => ({
    '--redeven-terminal-loading-background': terminalBackground(),
    '--redeven-terminal-loading-foreground': terminalForeground(),
  });
  const retryOutputRecovery = () => {
    setOutputRecoveryError(null);
    if (!readyOnce()) {
      void reload();
      return;
    }
    outputCoordinator?.retry();
  };

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

      <Show when={outputRecoveryMessage()}>
        <div
          class="absolute left-3 right-3 bottom-3 flex min-h-8 items-center gap-2 rounded border border-border px-2 py-1 text-[11px] break-words"
          classList={{
            'text-error': outputRecoveryState() === 'failed' || Boolean(error()),
            'text-foreground': outputRecoveryState() !== 'failed' && !error(),
          }}
          style={{
            'background-color': `color-mix(in srgb, ${terminalBackground()} 80%, transparent)`,
            bottom: 'calc(var(--terminal-bottom-inset) + 0.75rem)',
          }}
        >
          <span class="min-w-0 flex-1">{outputRecoveryMessage()}</span>
          <Show when={outputRecoveryState() === 'failed'}>
            <button
              type="button"
              class="shrink-0 rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
              onClick={retryOutputRecovery}
            >
              {i18n.t('terminal.retry')}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
