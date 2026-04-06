import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { createFollowBottomController } from '../chat/scroll/createFollowBottomController';
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
import { CodexStatusBannerStack } from './CodexStatusBannerStack';
import { CodexTranscript } from './CodexTranscript';
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

export function CodexPageShell() {
  const codex = useCodexContext();
  const rpc = useRedevenRpc();
  const followBottomController = createFollowBottomController();
  const [workingDirPickerOpen, setWorkingDirPickerOpen] = createSignal(false);
  let transcriptContainerRef: HTMLDivElement | undefined;

  onCleanup(() => {
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

  const showBannerStack = createMemo(() =>
    Boolean(codex.statusError() || codex.activeThreadError() || codex.streamError() || !summary().hostReady),
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
  const composerStopVisible = createMemo(() => hasActiveRun());
  const composerStopDisabledReason = createMemo(() => {
    if (!composerStopVisible()) return '';
    if (!summary().hostReady) {
      return composerDisabledReason() || codex.hostDisabledReason();
    }
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
  });
  const composerStopDisabled = createMemo(() => {
    if (!composerStopVisible()) return true;
    return Boolean(composerStopDisabledReason());
  });
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
    followBottomController.requestFollowBottom(request);
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
                streamError={codex.streamError()}
                hostAvailable={summary().hostReady}
              />
            </div>
          </Show>

          <div
            ref={(element) => {
              transcriptContainerRef = element;
              followBottomController.setScrollContainer(element);
            }}
            class="codex-page-transcript-main"
            data-codex-transcript-scroll-region="true"
            onScroll={followBottomController.handleScroll}
          >
            <CodexTranscript
              rootRef={followBottomController.setContentRoot}
              items={codex.transcriptItems()}
              optimisticUserTurns={codex.activeOptimisticUserTurns()}
              showWorkingState={shouldShowWorkingState()}
              workingLabel={codex.activeStatus() || summary().statusLabel || 'working'}
              workingFlags={summary().statusFlags}
              loading={codex.threadLoading()}
              loadingTitle={codex.threadTitle()}
              loadingBody="Loading the selected Codex thread."
              emptyTitle={emptyStateTitle()}
              emptyBody={emptyStateBody()}
            />
            <CodexFileBrowserFAB
              workingDir={workingDirPath()}
              homePath={homePath()}
              containerRef={transcriptContainerRef}
            />
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
                    showStopAction={composerStopVisible()}
                    stopPending={interruptPending()}
                    stopDisabled={composerStopDisabled()}
                    stopDisabledReason={composerStopDisabledReason()}
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
