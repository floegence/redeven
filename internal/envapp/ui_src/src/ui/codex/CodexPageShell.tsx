import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import {
  createFollowBottomController,
  type FollowBottomRequest,
} from '../chat/scroll/createFollowBottomController';
import { useRedevenRpc } from '../protocol/redeven_v1';
import { normalizeAbsolutePath, toHomeDisplayPath } from '../utils/askFlowerPath';
import {
  toPickerTreeAbsolutePath,
  toPickerTreePath,
} from '../utils/directoryPickerTree';
import { createDirectoryPickerDataSource } from '../utils/createDirectoryPickerDataSource';
import { useCodexContext } from './CodexProvider';
import { CodexFileBrowserFAB } from './CodexFileBrowserFAB';
import { CodexComposerShell } from './CodexComposerShell';
import { CodexHeaderBar, type CodexHeaderAction } from './CodexHeaderBar';
import { CodexPendingRequestsPanel } from './CodexPendingRequestsPanel';
import { CodexPendingInputsPanel } from './CodexPendingInputsPanel';
import { CodexStatusBannerStack } from './CodexStatusBannerStack';
import { CodexTranscript, type CodexTranscriptRowHeightCache } from './CodexTranscript';
import { CodexWorkingDirPickerDialog } from './CodexWorkingDirPickerDialog';
import type {
  CodexComposerControlOption,
  CodexComposerControlSpec,
} from './composerControls';
import { isWorkingStatus } from './presentation';
import {
  resolveCodexApprovalPolicyValue,
  resolveCodexSandboxModeValue,
} from './runtimeDefaults';
import {
  buildCodexWorkbenchSummary,
  codexAllowedApprovalPolicies,
  codexAllowedSandboxModes,
  codexApprovalPolicyLabel,
  codexModelLabel,
  codexModelSupportsImages,
  codexSandboxModeLabel,
  codexSupportedReasoningEfforts,
  resolveCodexWorkingDir,
} from './viewModel';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

const THREAD_SWITCH_STAGING_MIN_WARMUP_FRAMES = 2;
const THREAD_SWITCH_STAGING_STABLE_FRAMES = 3;
const THREAD_SWITCH_STAGING_MAX_FRAMES = 12;
const THREAD_SWITCH_POST_REVEAL_FOLLOW_WINDOW_MS = 350;

function createCodexTranscriptRowHeightCache(): CodexTranscriptRowHeightCache {
  const rowHeightsByID = new Map<string, number>();

  return {
    readHeights: (rowIDs) => {
      if (rowIDs.length === 0) return {};
      const nextHeights: Record<string, number> = {};
      for (const rowID of rowIDs) {
        const height = rowHeightsByID.get(rowID);
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) continue;
        nextHeights[rowID] = height;
      }
      return nextHeights;
    },
    writeHeight: (rowID, height) => {
      const normalizedRowID = String(rowID ?? '').trim();
      if (!normalizedRowID) return;
      const normalizedHeight = Math.round(Number(height));
      if (!Number.isFinite(normalizedHeight) || normalizedHeight <= 0) return;
      rowHeightsByID.set(normalizedRowID, normalizedHeight);
    },
  };
}

function fallbackRequestAnimationFrame(callback: FrameRequestCallback): number {
  callback(0);
  return 0;
}

function fallbackCancelAnimationFrame(): void {
  // No-op fallback for environments without rAF.
}

export function CodexPageShell() {
  const codex = useCodexContext();
  const rpc = useRedevenRpc();
  const followBottomController = createFollowBottomController();
  const transcriptRowHeightCache = createCodexTranscriptRowHeightCache();
  const requestFrame = globalThis.requestAnimationFrame ?? fallbackRequestAnimationFrame;
  const cancelFrame = globalThis.cancelAnimationFrame ?? fallbackCancelAnimationFrame;
  const [workingDirPickerOpen, setWorkingDirPickerOpen] = createSignal(false);
  const [transcriptOverlayTrackRef, setTranscriptOverlayTrackRef] = createSignal<HTMLDivElement>();
  const [transcriptScrollRegionRef, setTranscriptScrollRegionRef] = createSignal<HTMLDivElement>();
  const [visibleTranscriptRootRef, setVisibleTranscriptRootRef] = createSignal<HTMLDivElement>();
  const [pendingThreadSwitchRequest, setPendingThreadSwitchRequest] = createSignal<FollowBottomRequest | null>(null);
  const [pendingThreadSwitchOriginKey, setPendingThreadSwitchOriginKey] = createSignal('new-thread');
  const [stagingTranscriptThreadKey, setStagingTranscriptThreadKey] = createSignal<string | null>(null);
  const [stagingTranscriptMeasurementVersion, setStagingTranscriptMeasurementVersion] = createSignal(0);
  const [postRevealFollowRequest, setPostRevealFollowRequest] = createSignal<FollowBottomRequest | null>(null);
  let pendingRevealFrame: number | null = null;
  let pendingFollowBottomDispatchTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingFollowBottomDispatchToken = 0;
  let postRevealFollowTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  let lastRevealedTranscriptThreadKey = String(codex.displayedThreadID() ?? codex.activeThreadID() ?? '').trim() || 'new-thread';

  followBottomController.setPausedContentAnchorRestoreEnabled(false);

  const cancelPendingRevealFrame = (): void => {
    if (pendingRevealFrame === null) return;
    cancelFrame(pendingRevealFrame);
    pendingRevealFrame = null;
  };

  const cancelPendingFollowBottomDispatchFrame = (): void => {
    pendingFollowBottomDispatchToken += 1;
    if (pendingFollowBottomDispatchTimeout !== null) {
      globalThis.clearTimeout(pendingFollowBottomDispatchTimeout);
      pendingFollowBottomDispatchTimeout = null;
    }
  };

  const clearPostRevealFollowRequest = (): void => {
    if (postRevealFollowTimeout !== null) {
      globalThis.clearTimeout(postRevealFollowTimeout);
      postRevealFollowTimeout = null;
    }
    setPostRevealFollowRequest(null);
  };

  const clearThreadSwitchStaging = (): void => {
    cancelPendingRevealFrame();
    setStagingTranscriptThreadKey(null);
    setStagingTranscriptMeasurementVersion(0);
  };

  const commitRevealedTranscriptThread = (threadKey: string | null | undefined): void => {
    lastRevealedTranscriptThreadKey = String(threadKey ?? '').trim() || 'new-thread';
  };

  const queueFollowBottomDispatch = (request: FollowBottomRequest): void => {
    cancelPendingFollowBottomDispatchFrame();
    const token = pendingFollowBottomDispatchToken;
    pendingFollowBottomDispatchTimeout = globalThis.setTimeout(() => {
      pendingFollowBottomDispatchTimeout = null;
      if (pendingFollowBottomDispatchToken !== token) return;
      followBottomController.requestFollowBottom(request);
    }, 0);
  };

  const armPostRevealFollowRequest = (request: FollowBottomRequest): void => {
    clearPostRevealFollowRequest();
    setPostRevealFollowRequest(request);
    postRevealFollowTimeout = globalThis.setTimeout(() => {
      postRevealFollowTimeout = null;
      setPostRevealFollowRequest(null);
    }, THREAD_SWITCH_POST_REVEAL_FOLLOW_WINDOW_MS);
  };

  const finishThreadSwitchStaging = (
    threadKey: string,
    request: FollowBottomRequest,
  ): void => {
    commitRevealedTranscriptThread(threadKey);
    setPendingThreadSwitchRequest(null);
    clearThreadSwitchStaging();
    queueFollowBottomDispatch(request);
    armPostRevealFollowRequest(request);
  };

  const displayedTranscriptThreadKey = createMemo(() => String(codex.displayedThreadID() ?? '').trim());
  const liveTranscriptThreadKey = createMemo(() => (
    displayedTranscriptThreadKey() ||
    String(codex.activeThreadID() ?? '').trim() ||
    'new-thread'
  ));
  const threadSwitchStagingActive = createMemo(() => Boolean(stagingTranscriptThreadKey()));
  const stagingTranscriptReady = createMemo(() => {
    const threadKey = stagingTranscriptThreadKey();
    if (!threadKey) return false;
    return !codex.threadLoading() && displayedTranscriptThreadKey() === threadKey;
  });

  const scheduleThreadSwitchReveal = (
    threadKey: string,
    request: FollowBottomRequest,
  ): void => {
    cancelPendingRevealFrame();
    let warmupFrames = 0;
    let stableFrames = 0;
    let totalFrames = 0;
    let lastMeasurementVersion = stagingTranscriptMeasurementVersion();

    const tick = () => {
      if (pendingThreadSwitchRequest()?.seq !== request.seq) return;
      if (stagingTranscriptThreadKey() !== threadKey) return;
      if (!stagingTranscriptReady()) {
        pendingRevealFrame = requestFrame(tick);
        return;
      }

      totalFrames += 1;
      warmupFrames += 1;
      const nextMeasurementVersion = stagingTranscriptMeasurementVersion();
      if (nextMeasurementVersion !== lastMeasurementVersion) {
        lastMeasurementVersion = nextMeasurementVersion;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }

      const warmedUp = warmupFrames >= THREAD_SWITCH_STAGING_MIN_WARMUP_FRAMES;
      if (
        warmedUp &&
        (stableFrames >= THREAD_SWITCH_STAGING_STABLE_FRAMES || totalFrames >= THREAD_SWITCH_STAGING_MAX_FRAMES)
      ) {
        pendingRevealFrame = null;
        finishThreadSwitchStaging(threadKey, request);
        return;
      }

      pendingRevealFrame = requestFrame(tick);
    };

    pendingRevealFrame = requestFrame(tick);
  };
  onCleanup(() => {
    cancelPendingRevealFrame();
    cancelPendingFollowBottomDispatchFrame();
    clearPostRevealFollowRequest();
    followBottomController.dispose();
  });

  const summary = createMemo(() => buildCodexWorkbenchSummary({
    thread: codex.activeThread(),
    runtimeConfig: codex.activeRuntimeConfig(),
    capabilities: codex.capabilities(),
    status: codex.status(),
    workingDirDraft: codex.workingDirDraft(),
    modelDraft: codex.modelDraft(),
    tokenUsage: codex.activeTokenUsage(),
    activeStatus: codex.activeStatus(),
    activeStatusFlags: codex.activeStatusFlags(),
    pendingRequests: codex.pendingRequests(),
  }));
  const hasStreamBanner = createMemo(() => {
    const phase = String(codex.streamTransportState().phase ?? '').trim();
    return phase === 'reconnecting' || phase === 'lagged' || phase === 'desynced';
  });

  const showBannerStack = createMemo(() =>
    Boolean(codex.statusError() || codex.activeThreadError() || hasStreamBanner() || !summary().hostReady),
  );

  const emptyStateTitle = () => (
    summary().hostReady
      ? 'Codex'
      : 'Install Codex on the host'
  );
  const emptyStateBody = () => (
    summary().hostReady
      ? 'Start a Codex conversation with a prompt, paste an image, use @ to reference files, or use / for local composer commands.'
      : 'Redeven does not install Codex for you. Put the host machine\'s `codex` binary on PATH, then refresh this page to start a dedicated Codex chat.'
  );
  const modelValue = createMemo(() => String(codex.modelDraft() ?? '').trim());
  const effortValue = createMemo(() => String(codex.effortDraft() ?? '').trim());
  const approvalPolicyValue = createMemo(() => resolveCodexApprovalPolicyValue(codex.approvalPolicyDraft()));
  const sandboxModeValue = createMemo(() => resolveCodexSandboxModeValue(codex.sandboxModeDraft()));
  const homePath = createMemo(() => normalizeAbsolutePath(String(codex.status()?.agent_home_dir ?? '').trim()));
  const workingDirPath = createMemo(() => normalizeAbsolutePath(resolveCodexWorkingDir({
    workingDirDraft: codex.workingDirDraft(),
    runtimeConfig: codex.activeRuntimeConfig(),
    capabilities: codex.capabilities(),
    thread: codex.activeThread(),
    status: codex.status(),
  })));
  const workingDirValue = createMemo(() => toHomeDisplayPath(workingDirPath(), homePath()) || workingDirPath());
  const workingDirLocked = createMemo(() => Boolean(String(codex.activeThreadID() ?? '').trim()));
  const workingDirDisabled = createMemo(() => !summary().hostReady || codex.submitting() || !homePath());
  const canPickWorkingDir = createMemo(() => !workingDirLocked() && !workingDirDisabled());
  const workingDirPickerInitialPath = createMemo(() => toPickerTreePath(workingDirPath(), homePath()));
  const workingDirPicker = createDirectoryPickerDataSource({
    homePath,
    listDirectory: async (absolutePath) => (await rpc.fs.list({ path: absolutePath, showHidden: false }))?.entries ?? [],
  });
  const modelOptions = createMemo<CodexComposerControlOption[]>(() => {
    const items = (codex.capabilities()?.models ?? []).map((model) => ({
      value: String(model.id ?? '').trim(),
      label: String(model.display_name ?? model.id ?? '').trim() || String(model.id ?? '').trim(),
      description: String(model.description ?? '').trim() || undefined,
    })).filter((option) => option.value);
    if (items.length > 0) return items;
    const fallbackValue = modelValue();
    if (!fallbackValue) return [];
    return [{
      value: fallbackValue,
      label: codexModelLabel(codex.capabilities(), fallbackValue) || fallbackValue,
    }];
  });
  const effortOptions = createMemo<CodexComposerControlOption[]>(() => {
    const seen = new Set<string>();
    const out: CodexComposerControlOption[] = [];
    for (const value of codexSupportedReasoningEfforts(codex.capabilities(), modelValue())) {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ value: normalized, label: normalized.toUpperCase() });
    }
    if (out.length === 0 && effortValue()) {
      out.push({ value: effortValue(), label: effortValue().toUpperCase() });
    }
    return out;
  });
  const approvalPolicyOptions = createMemo<CodexComposerControlOption[]>(() => {
    const seen = new Set<string>();
    const out: CodexComposerControlOption[] = [];
    for (const value of [...codexAllowedApprovalPolicies(codex.capabilities()), approvalPolicyValue()]) {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ value: normalized, label: codexApprovalPolicyLabel(normalized) });
    }
    return out;
  });
  const sandboxModeOptions = createMemo<CodexComposerControlOption[]>(() => {
    const seen = new Set<string>();
    const out: CodexComposerControlOption[] = [];
    for (const value of [...codexAllowedSandboxModes(codex.capabilities()), sandboxModeValue()]) {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ value: normalized, label: codexSandboxModeLabel(normalized) });
    }
    return out;
  });
  const supportsImages = createMemo(() => codexModelSupportsImages(codex.capabilities(), modelValue()));
  const hasActiveRun = createMemo(() => (
    codex.submitting() ||
    isWorkingStatus(codex.activeStatus())
  ));
  const shouldShowWorkingState = createMemo(() => (
    summary().hostReady && hasActiveRun()
  ));
  const visibleTranscriptThreadKey = createMemo(() => stagingTranscriptThreadKey() ?? liveTranscriptThreadKey());
  const visibleTranscriptItems = createMemo(() => (
    threadSwitchStagingActive() ? [] : codex.transcriptItems()
  ));
  const visibleOptimisticUserTurns = createMemo(() => (
    threadSwitchStagingActive() ? [] : codex.activeOptimisticUserTurns()
  ));
  const visibleShowWorkingState = createMemo(() => (
    !threadSwitchStagingActive() && shouldShowWorkingState()
  ));
  const visibleTranscriptLoading = createMemo(() => (
    codex.threadLoading() || threadSwitchStagingActive()
  ));
  const visibleTranscriptLoadingBody = createMemo(() => (
    threadSwitchStagingActive()
      ? 'Preparing the selected Codex thread.'
      : 'Loading the selected Codex thread.'
  ));
  const activeInterruptTurnID = createMemo(() => String(codex.activeInterruptTurnID() ?? '').trim());
  const interruptPending = createMemo(() => (
    !!activeInterruptTurnID() && codex.interruptingTurnID() === activeInterruptTurnID()
  ));
  const threadArchived = createMemo(() => String(codex.activeThread()?.status ?? '').trim().toLowerCase() === 'archived');
  const composerHostAvailable = createMemo(() => summary().hostReady && !threadArchived());
  const composerDisabledReason = createMemo(() => (
    !summary().hostReady
      ? codex.hostDisabledReason()
      : threadArchived()
        ? 'Archived threads are hidden from the conversation list.'
        : ''
  ));
  const runtimeControls = createMemo<readonly CodexComposerControlSpec[]>(() => ([
    {
      id: 'model',
      label: 'Model',
      value: modelValue(),
      options: modelOptions(),
      placeholder: 'Default',
      disabled: !composerHostAvailable() || modelOptions().length === 0,
      variant: 'value',
      onChange: codex.setModelDraft,
    },
    {
      id: 'effort',
      label: 'Effort',
      value: effortValue(),
      options: effortOptions(),
      placeholder: 'Default',
      disabled: !composerHostAvailable() || effortOptions().length === 0,
      variant: 'value',
      onChange: codex.setEffortDraft,
    },
    {
      id: 'approval',
      label: 'Approval',
      value: approvalPolicyValue(),
      options: approvalPolicyOptions(),
      placeholder: 'Never',
      disabled: !composerHostAvailable() || approvalPolicyOptions().length === 0,
      variant: 'policy',
      onChange: codex.setApprovalPolicyDraft,
    },
    {
      id: 'sandbox',
      label: 'Sandbox',
      value: sandboxModeValue(),
      options: sandboxModeOptions(),
      placeholder: 'Full access',
      disabled: !composerHostAvailable() || sandboxModeOptions().length === 0,
      variant: 'policy',
      onChange: codex.setSandboxModeDraft,
    },
  ]));
  const composerHasQueueableDraftContent = createMemo(() => (
    !!String(codex.composerText() ?? '').trim() ||
    codex.attachments().length > 0 ||
    codex.mentions().length > 0
  ));
  const composerPrimaryActionKind = createMemo<'send' | 'queue' | 'stop'>(() => {
    if (!hasActiveRun()) return 'send';
    return composerHasQueueableDraftContent() ? 'queue' : 'stop';
  });
  const composerPrimaryActionDisabledReason = createMemo(() => {
    if (!summary().hostReady) {
      return composerDisabledReason() || codex.hostDisabledReason();
    }
    if (composerPrimaryActionKind() === 'stop') {
      if (interruptPending()) {
        return 'Stop request in progress.';
      }
      if (!activeInterruptTurnID()) {
        return codex.submitting()
          ? 'Waiting for the active turn to start.'
          : 'Waiting for Codex to expose an interruptible turn.';
      }
      if (!codex.supportsOperation('turn_interrupt')) {
        return 'Turn interruption is unavailable on this host.';
      }
      return '';
    }
    if (composerPrimaryActionKind() === 'queue') {
      if (!String(codex.activeThreadID() ?? '').trim()) {
        return 'Queue is available after the current thread starts.';
      }
      return '';
    }
    if (!composerHasQueueableDraftContent()) {
      return 'Add a prompt, image, or file mention to send.';
    }
    if (codex.submitting()) {
      return 'Sending...';
    }
    return '';
  });
  const composerPrimaryActionDisabled = createMemo(() => Boolean(composerPrimaryActionDisabledReason()));
  const queuedGuideDisabledReason = createMemo(() => {
    if (!summary().hostReady) {
      return composerDisabledReason() || codex.hostDisabledReason();
    }
    if (!hasActiveRun()) {
      return 'Guide is available while Codex is running a turn.';
    }
    if (interruptPending()) {
      return 'Guide is unavailable while a stop request is in progress.';
    }
    if (!activeInterruptTurnID()) {
      return 'Codex is still starting the current turn.';
    }
    if (!codex.supportsOperation('turn_steer')) {
      return 'This Codex host does not support same-turn guidance.';
    }
    if (codex.activeTurnCanSteer() === false) {
      const turnKind = String(codex.activeTurnKind() ?? '').trim();
      return turnKind
        ? `This ${turnKind} turn cannot accept guided input.`
        : 'This turn cannot accept guided input.';
    }
    if (codex.submitting()) {
      return 'Sending...';
    }
    return '';
  });
  const queuedGuideAvailable = createMemo(() => !queuedGuideDisabledReason());
  const composerGuidanceNote = createMemo(() => '');
  const headerActions = createMemo<CodexHeaderAction[]>(() => {
    const threadID = String(codex.activeThreadID() ?? '').trim();
    if (!threadID) return [];
    const actions: CodexHeaderAction[] = [];
    const hostUnavailableReason = codex.hostDisabledReason();
    const archivePending = codex.archivingThreadID() === threadID;
    const forkPending = codex.forkingThreadID() === threadID;
    const reviewPending = codex.reviewingThreadID() === threadID;
    if (threadArchived()) return actions;
    actions.push({
      key: 'archive',
      label: archivePending ? 'Archiving…' : 'Archive',
      aria_label: 'Archive Codex thread',
      onClick: () => void codex.archiveActiveThread(),
      disabled: !summary().hostReady || archivePending || !codex.supportsOperation('thread_archive'),
      disabled_reason: !summary().hostReady
        ? hostUnavailableReason
        : !codex.supportsOperation('thread_archive')
          ? 'Archive is unavailable on this host.'
          : archivePending
            ? 'Archive in progress.'
            : '',
    });
    actions.push({
      key: 'fork',
      label: forkPending ? 'Forking…' : 'Fork',
      aria_label: 'Fork Codex thread',
      onClick: () => void codex.forkActiveThread(),
      disabled: !summary().hostReady || forkPending || !codex.supportsOperation('thread_fork'),
      disabled_reason: !summary().hostReady
        ? hostUnavailableReason
        : !codex.supportsOperation('thread_fork')
          ? 'Fork is unavailable on this host.'
          : forkPending
            ? 'Fork in progress.'
            : '',
    });
    actions.push({
      key: 'review',
      label: reviewPending ? 'Reviewing…' : 'Review',
      aria_label: 'Review current workspace changes',
      onClick: () => void codex.reviewActiveThread(),
      disabled: !summary().hostReady || reviewPending || !codex.supportsOperation('review_start'),
      disabled_reason: !summary().hostReady
        ? hostUnavailableReason
        : !codex.supportsOperation('review_start')
          ? 'Review is unavailable on this host.'
          : reviewPending
            ? 'Review already in progress.'
            : '',
    });
    if (hasActiveRun()) {
      actions.push({
        key: 'stop',
        label: interruptPending() ? 'Stopping…' : 'Stop',
        aria_label: 'Stop active Codex turn',
        onClick: () => void codex.interruptActiveTurn(),
        disabled: !summary().hostReady || interruptPending() || !codex.supportsOperation('turn_interrupt') || !activeInterruptTurnID(),
        disabled_reason: !summary().hostReady
          ? hostUnavailableReason
          : !codex.supportsOperation('turn_interrupt')
            ? 'Turn interruption is unavailable on this host.'
            : interruptPending()
              ? 'Stop request in progress.'
              : !activeInterruptTurnID()
                ? (
                  codex.submitting()
                    ? 'Stop will be available once the turn starts.'
                    : 'Waiting for Codex to expose an interruptible turn.'
                )
                : '',
      });
    }
    return actions;
  });

  createEffect(() => {
    homePath();
    workingDirPicker.reset();
  });

  createEffect(() => {
    const request = codex.scrollToBottomRequest();
    if (!request) return;
    if (request.reason === 'thread_switch') {
      const originThreadKey = lastRevealedTranscriptThreadKey;
      cancelPendingFollowBottomDispatchFrame();
      clearPostRevealFollowRequest();
      setPendingThreadSwitchOriginKey(originThreadKey);
      setPendingThreadSwitchRequest(request);
      return;
    }
    setPendingThreadSwitchOriginKey(lastRevealedTranscriptThreadKey);
    setPendingThreadSwitchRequest(null);
    clearPostRevealFollowRequest();
    if (threadSwitchStagingActive()) {
      commitRevealedTranscriptThread(liveTranscriptThreadKey());
      clearThreadSwitchStaging();
    }
    followBottomController.requestFollowBottom(request);
  });

  createEffect(() => {
    if (threadSwitchStagingActive() || pendingThreadSwitchRequest()) return;
    commitRevealedTranscriptThread(liveTranscriptThreadKey());
  });

  createEffect(() => {
    const request = pendingThreadSwitchRequest();
    if (!request) return;
    const originThreadKey = pendingThreadSwitchOriginKey();
    const threadKey = displayedTranscriptThreadKey();
    if (!threadKey) {
      if (!codex.threadLoading()) {
        setPendingThreadSwitchRequest(null);
        clearThreadSwitchStaging();
        followBottomController.requestFollowBottom(request);
      }
      return;
    }
    if (threadKey === originThreadKey) {
      return;
    }
    if (stagingTranscriptThreadKey() === threadKey) return;
    cancelPendingRevealFrame();
    setStagingTranscriptMeasurementVersion(0);
    setStagingTranscriptThreadKey(threadKey);
  });

  createEffect(() => {
    const root = visibleTranscriptRootRef();
    const request = postRevealFollowRequest();
    if (!root || !request || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followBottomController.mode() !== 'following') {
        clearPostRevealFollowRequest();
        return;
      }
      queueFollowBottomDispatch(request);
    });
    observer.observe(root);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  createEffect(() => {
    const request = pendingThreadSwitchRequest();
    const threadKey = stagingTranscriptThreadKey();
    if (!request || !threadKey || !stagingTranscriptReady()) return;
    scheduleThreadSwitchReveal(threadKey, request);
  });

  createEffect(() => {
    if (!workingDirPickerOpen()) return;
    if (workingDirPicker.files().length > 0) return;
    void workingDirPicker.ensureRootLoaded();
  });

  return (
    <div data-codex-surface="page-shell" class="codex-page-shell">
      <CodexHeaderBar
        summary={summary()}
        actions={headerActions()}
      />

      <div class="codex-page-main">
        <div class="codex-page-transcript">
          <Show when={showBannerStack()}>
            <div class="codex-page-status-stack">
              <CodexStatusBannerStack
                statusError={codex.statusError()}
                threadError={codex.activeThreadError()}
                streamTransportState={codex.streamTransportState()}
                hostAvailable={summary().hostReady}
              />
            </div>
          </Show>

          <div
            class="codex-page-transcript-viewport"
          >
            <div
              ref={(element) => {
                followBottomController.setScrollContainer(element);
                setTranscriptScrollRegionRef(element);
              }}
              {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS}
              class="codex-page-transcript-main"
              data-codex-transcript-scroll-region="true"
              onScroll={followBottomController.handleScroll}
            >
              <CodexTranscript
                rootRef={(element) => {
                  followBottomController.setContentRoot(element);
                  setVisibleTranscriptRootRef(element);
                }}
                scrollContainer={transcriptScrollRegionRef()}
                onViewportAnchorResolverChange={followBottomController.setViewportAnchorResolver}
                followBottomMode={followBottomController.mode}
                rowHeightCache={transcriptRowHeightCache}
                threadKey={visibleTranscriptThreadKey()}
                items={visibleTranscriptItems()}
                optimisticUserTurns={visibleOptimisticUserTurns()}
                showWorkingState={visibleShowWorkingState()}
                workingLabel={codex.activeStatus() || summary().statusLabel || 'working'}
                workingFlags={summary().statusFlags}
                loading={visibleTranscriptLoading()}
                loadingTitle={codex.threadTitle()}
                loadingBody={visibleTranscriptLoadingBody()}
                emptyTitle={emptyStateTitle()}
                emptyBody={emptyStateBody()}
              />
            </div>
            <Show when={stagingTranscriptReady()}>
              <div
                aria-hidden="true"
                data-codex-staging-transcript="true"
                class="absolute inset-x-0 top-0 pointer-events-none invisible"
              >
                <CodexTranscript
                  threadKey={stagingTranscriptThreadKey() ?? liveTranscriptThreadKey()}
                  rowHeightCache={transcriptRowHeightCache}
                  onMeasuredHeightsUpdated={() => {
                    setStagingTranscriptMeasurementVersion((value) => value + 1);
                  }}
                  items={codex.transcriptItems()}
                  optimisticUserTurns={codex.activeOptimisticUserTurns()}
                  showWorkingState={shouldShowWorkingState()}
                  workingLabel={codex.activeStatus() || summary().statusLabel || 'working'}
                  workingFlags={summary().statusFlags}
                  emptyTitle={emptyStateTitle()}
                  emptyBody={emptyStateBody()}
                />
              </div>
            </Show>
            <div class="codex-page-transcript-overlay">
              <div
                ref={setTranscriptOverlayTrackRef}
                class="codex-page-transcript-overlay-track"
                data-codex-transcript-overlay-track="true"
              >
                <CodexFileBrowserFAB
                  workingDir={workingDirPath()}
                  homePath={homePath()}
                  containerRef={transcriptOverlayTrackRef}
                />
              </div>
            </div>
          </div>
        </div>
        <div class="codex-page-bottom-dock">
          <div class="codex-page-bottom-support">
            <Show when={codex.pendingRequests().length > 0}>
              <div class="codex-page-bottom-support-lane">
                <div class="codex-page-bottom-support-track codex-page-bottom-support-track-thread">
                  <div class="codex-page-bottom-support-content codex-page-bottom-support-content-thread">
                    <CodexPendingRequestsPanel
                      requests={codex.pendingRequests()}
                      requestDraftValue={codex.requestDraftValue}
                      setRequestDraftValue={codex.setRequestDraftValue}
                      onAnswer={(request, decision) => void codex.answerRequest(request, decision)}
                    />
                  </div>
                </div>
              </div>
            </Show>

            <Show when={codex.dispatchingInputs().length > 0 || codex.queuedFollowups().length > 0}>
              <div class="codex-page-bottom-support-lane">
                <div class="codex-page-bottom-support-track codex-page-bottom-support-track-page">
                  <div class="codex-page-bottom-support-content codex-page-bottom-support-content-page">
                    <CodexPendingInputsPanel
                      dispatchingItems={codex.dispatchingInputs()}
                      queuedItems={codex.queuedFollowups()}
                      canGuideQueued={queuedGuideAvailable()}
                      guideQueuedDisabledReason={queuedGuideDisabledReason()}
                      onGuideQueued={(followupID) => void codex.guideQueuedFollowup(followupID)}
                      onRestoreQueued={codex.restoreQueuedFollowup}
                      onRemoveQueued={codex.removeQueuedFollowup}
                      onMoveQueued={codex.moveQueuedFollowup}
                    />
                  </div>
                </div>
              </div>
            </Show>

            <div class="codex-page-bottom-support-lane">
              <div class="codex-page-bottom-support-track codex-page-bottom-support-track-page">
                <div class="codex-page-bottom-support-content codex-page-bottom-support-content-page">
                  <CodexComposerShell
                    workingDirPath={workingDirPath()}
                    workingDirLabel={workingDirValue()}
                    workingDirTitle={workingDirPath() || workingDirValue() || 'Working directory'}
                    workingDirLocked={workingDirLocked()}
                    workingDirDisabled={workingDirDisabled()}
                    runtimeControls={runtimeControls()}
                    attachments={codex.attachments()}
                    mentions={codex.mentions()}
                    supportsImages={supportsImages()}
                    capabilitiesLoading={codex.capabilitiesLoading()}
                    composerText={codex.composerText()}
                    submitting={codex.submitting()}
                    primaryActionKind={composerPrimaryActionKind()}
                    primaryActionDisabled={composerPrimaryActionDisabled()}
                    primaryActionDisabledReason={composerPrimaryActionDisabledReason()}
                    guidanceNote={composerGuidanceNote()}
                    hostAvailable={composerHostAvailable()}
                    hostDisabledReason={composerDisabledReason()}
                    onOpenWorkingDirPicker={() => {
                      if (!canPickWorkingDir()) return;
                      setWorkingDirPickerOpen(true);
                    }}
                    onAddAttachments={codex.addImageAttachments}
                    onRemoveAttachment={codex.removeAttachment}
                    onAddFileMentions={codex.addFileMentions}
                    onRemoveMention={codex.removeMention}
                    onComposerInput={codex.setComposerText}
                    onResetComposer={codex.resetComposer}
                    onStartNewThreadDraft={codex.startNewThreadDraft}
                    onSend={() => void codex.sendTurn()}
                    onQueue={() => void codex.queueTurn()}
                    onStop={() => void codex.interruptActiveTurn()}
                  />
                </div>
              </div>
          </div>
        </div>
      </div>
      </div>

      <CodexWorkingDirPickerDialog
        open={workingDirPickerOpen()}
        onOpenChange={(open) => {
          if (!open) setWorkingDirPickerOpen(false);
        }}
        files={workingDirPicker.files()}
        initialPath={workingDirPickerInitialPath()}
        homePath={homePath()}
        onExpand={workingDirPicker.expandPath}
        ensurePath={workingDirPicker.ensurePath}
        onSelect={(selectedPath) => {
          if (!canPickWorkingDir()) return;
          const realPath = toPickerTreeAbsolutePath(selectedPath, homePath());
          if (!realPath) return;
          codex.setWorkingDirDraft(realPath);
          setWorkingDirPickerOpen(false);
        }}
      />
    </div>
  );
}
