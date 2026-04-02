import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import { createFollowBottomController } from '../chat/scroll/createFollowBottomController';
import { useRedevenRpc, type FsFileInfo } from '../protocol/redeven_v1';
import { normalizeAbsolutePath, toHomeDisplayPath } from '../utils/askFlowerPath';
import {
  replacePickerChildren,
  sortPickerFolderItems,
  toPickerFolderItem,
  toPickerTreeAbsolutePath,
  toPickerTreePath,
} from '../utils/directoryPickerTree';
import { useCodexContext } from './CodexProvider';
import { CodexComposerShell } from './CodexComposerShell';
import { CodexHeaderBar, type CodexHeaderAction } from './CodexHeaderBar';
import { CodexPendingRequestsPanel } from './CodexPendingRequestsPanel';
import { CodexStatusBannerStack } from './CodexStatusBannerStack';
import { CodexTranscript } from './CodexTranscript';
import { CodexWorkingDirPickerDialog } from './CodexWorkingDirPickerDialog';
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
} from './viewModel';

type ComposerOption = Readonly<{
  value: string;
  label: string;
}>;

type DirCache = Map<string, FileItem[]>;

export function CodexPageShell() {
  const codex = useCodexContext();
  const rpc = useRedevenRpc();
  const followBottomController = createFollowBottomController();
  const [workingDirPickerOpen, setWorkingDirPickerOpen] = createSignal(false);
  const [workingDirFiles, setWorkingDirFiles] = createSignal<FileItem[]>([]);
  let workingDirCache: DirCache = new Map();

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
    codex.threadFilter() === 'archived' && !codex.activeThreadID()
      ? 'Archived Codex Threads'
      : (
    summary().hostReady
      ? 'Codex'
      : 'Install Codex on the host'
      )
  );
  const emptyStateBody = () => (
    codex.threadFilter() === 'archived' && !codex.activeThreadID()
      ? 'Select an archived thread to inspect it, or switch back to Active to start a new Codex conversation.'
      : (
    summary().hostReady
      ? 'Start a Codex conversation with a prompt, paste an image, use @ to reference files, or use / for local composer commands.'
      : 'Redeven does not install Codex for you. Put the host machine\'s `codex` binary on PATH, then refresh this page to start a dedicated Codex chat.'
      )
  );
  const modelValue = createMemo(() => String(codex.modelDraft() ?? '').trim());
  const effortValue = createMemo(() => String(codex.effortDraft() ?? '').trim());
  const approvalPolicyValue = createMemo(() => resolveCodexApprovalPolicyValue(codex.approvalPolicyDraft()));
  const sandboxModeValue = createMemo(() => resolveCodexSandboxModeValue(codex.sandboxModeDraft()));
  const homePath = createMemo(() => normalizeAbsolutePath(String(codex.status()?.agent_home_dir ?? '').trim()));
  const workingDirPath = createMemo(() => (
    normalizeAbsolutePath(String(codex.workingDirDraft() ?? '').trim()) ||
    normalizeAbsolutePath(String(codex.activeRuntimeConfig().cwd ?? '').trim()) ||
    normalizeAbsolutePath(String(codex.activeThread()?.cwd ?? '').trim()) ||
    homePath()
  ));
  const workingDirValue = createMemo(() => toHomeDisplayPath(workingDirPath(), homePath()) || workingDirPath());
  const workingDirLocked = createMemo(() => Boolean(String(codex.activeThreadID() ?? '').trim()));
  const workingDirDisabled = createMemo(() => !summary().hostReady || codex.submitting() || !homePath());
  const canPickWorkingDir = createMemo(() => !workingDirLocked() && !workingDirDisabled());
  const workingDirPickerInitialPath = createMemo(() => toPickerTreePath(workingDirPath(), homePath()));
  const modelOptions = createMemo<ComposerOption[]>(() => {
    const items = (codex.capabilities()?.models ?? []).map((model) => ({
      value: String(model.id ?? '').trim(),
      label: String(model.display_name ?? model.id ?? '').trim() || String(model.id ?? '').trim(),
    })).filter((option) => option.value);
    if (items.length > 0) return items;
    const fallbackValue = modelValue();
    if (!fallbackValue) return [];
    return [{ value: fallbackValue, label: codexModelLabel(codex.capabilities(), fallbackValue) || fallbackValue }];
  });
  const effortOptions = createMemo<ComposerOption[]>(() => {
    const seen = new Set<string>();
    const out: ComposerOption[] = [];
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
  const approvalPolicyOptions = createMemo<ComposerOption[]>(() => {
    const seen = new Set<string>();
    const out: ComposerOption[] = [];
    for (const value of [...codexAllowedApprovalPolicies(codex.capabilities()), approvalPolicyValue()]) {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ value: normalized, label: codexApprovalPolicyLabel(normalized) });
    }
    return out;
  });
  const sandboxModeOptions = createMemo<ComposerOption[]>(() => {
    const seen = new Set<string>();
    const out: ComposerOption[] = [];
    for (const value of [...codexAllowedSandboxModes(codex.capabilities()), sandboxModeValue()]) {
      const normalized = String(value ?? '').trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ value: normalized, label: codexSandboxModeLabel(normalized) });
    }
    return out;
  });
  const supportsImages = createMemo(() => codexModelSupportsImages(codex.capabilities(), modelValue()));
  const shouldShowWorkingState = createMemo(() => (
    summary().hostReady && (
      codex.submitting() ||
      isWorkingStatus(codex.activeStatus())
    )
  ));
  const threadArchived = createMemo(() => String(codex.activeThread()?.status ?? '').trim().toLowerCase() === 'archived');
  const archivedBrowseMode = createMemo(() => codex.threadFilter() === 'archived' && !codex.activeThreadID());
  const composerHostAvailable = createMemo(() => summary().hostReady && !threadArchived() && !archivedBrowseMode());
  const composerDisabledReason = createMemo(() => (
    archivedBrowseMode()
      ? 'Switch back to Active to start a new Codex conversation.'
      : !summary().hostReady
      ? codex.hostDisabledReason()
      : threadArchived()
        ? 'Restore the archived thread before sending another turn.'
        : ''
  ));
  const headerActions = createMemo<CodexHeaderAction[]>(() => {
    const threadID = String(codex.activeThreadID() ?? '').trim();
    if (!threadID) return [];
    const actions: CodexHeaderAction[] = [];
    const hostUnavailableReason = codex.hostDisabledReason();
    const archivePending = codex.archivingThreadID() === threadID;
    const restorePending = codex.restoringThreadID() === threadID;
    const forkPending = codex.forkingThreadID() === threadID;
    const reviewPending = codex.reviewingThreadID() === threadID;
    const interruptPending = codex.interruptingTurnID() === codex.activeInterruptTurnID();
    if (threadArchived()) {
      actions.push({
        key: 'restore',
        label: restorePending ? 'Restoring…' : 'Restore',
        aria_label: 'Restore Codex thread',
        onClick: () => void codex.restoreActiveThread(),
        disabled: !summary().hostReady || restorePending,
        disabled_reason: !summary().hostReady ? hostUnavailableReason : restorePending ? 'Restore in progress.' : '',
      });
      return actions;
    }
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
    if (String(codex.activeInterruptTurnID() ?? '').trim()) {
      actions.push({
        key: 'stop',
        label: interruptPending ? 'Stopping…' : 'Stop',
        aria_label: 'Stop active Codex turn',
        onClick: () => void codex.interruptActiveTurn(),
        disabled: !summary().hostReady || interruptPending || !codex.supportsOperation('turn_interrupt'),
        disabled_reason: !summary().hostReady
          ? hostUnavailableReason
          : !codex.supportsOperation('turn_interrupt')
            ? 'Turn interruption is unavailable on this host.'
            : interruptPending
              ? 'Stop request in progress.'
              : '',
      });
    }
    return actions;
  });

  createEffect(() => {
    homePath();
    workingDirCache = new Map();
    setWorkingDirFiles([]);
  });

  createEffect(() => {
    const request = codex.scrollToBottomRequest();
    if (!request) return;
    followBottomController.requestFollowBottom(request);
  });

  const loadWorkingDirTree = async (pickerPath: string) => {
    const absolutePath = toPickerTreeAbsolutePath(pickerPath, homePath());
    if (!absolutePath) return;
    if (workingDirCache.has(absolutePath)) {
      setWorkingDirFiles((prev) => replacePickerChildren(prev, pickerPath, workingDirCache.get(absolutePath)!));
      return;
    }
    try {
      const response = await rpc.fs.list({ path: absolutePath, showHidden: false });
      const items = sortPickerFolderItems(
        (response?.entries ?? [])
          .map((entry) => toPickerFolderItem(entry as FsFileInfo, homePath()))
          .filter((item): item is FileItem => Boolean(item)),
      );
      workingDirCache.set(absolutePath, items);
      setWorkingDirFiles((prev) => replacePickerChildren(prev, pickerPath, items));
    } catch {
      // ignore picker tree load failures and keep the previous tree state
    }
  };

  createEffect(() => {
    if (!workingDirPickerOpen()) return;
    if (workingDirFiles().length > 0) return;
    void loadWorkingDirTree('/');
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
            ref={followBottomController.setScrollContainer}
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
          </div>
        </div>

        <div class="codex-page-bottom-dock">
          <div class="codex-page-bottom-support">
            <Show when={codex.pendingRequests().length > 0}>
              <div class="codex-page-bottom-support-lane">
                <div class="codex-page-bottom-support-track">
                  <div class="codex-page-bottom-support-content">
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
              <div class="codex-page-bottom-support-track">
                <div class="codex-page-bottom-support-content">
                  <CodexComposerShell
                    workingDirPath={workingDirPath()}
                    workingDirLabel={workingDirValue()}
                    workingDirTitle={workingDirPath() || workingDirValue() || 'Working directory'}
                    workingDirLocked={workingDirLocked()}
                    workingDirDisabled={workingDirDisabled()}
                    modelValue={modelValue()}
                    modelOptions={modelOptions()}
                    effortValue={effortValue()}
                    effortOptions={effortOptions()}
                    approvalPolicyValue={approvalPolicyValue()}
                    approvalPolicyOptions={approvalPolicyOptions()}
                    sandboxModeValue={sandboxModeValue()}
                    sandboxModeOptions={sandboxModeOptions()}
                    attachments={codex.attachments()}
                    mentions={codex.mentions()}
                    supportsImages={supportsImages()}
                    capabilitiesLoading={codex.capabilitiesLoading()}
                    composerText={codex.composerText()}
                    submitting={codex.submitting()}
                    hostAvailable={composerHostAvailable()}
                    hostDisabledReason={composerDisabledReason()}
                    onOpenWorkingDirPicker={() => {
                      if (!canPickWorkingDir()) return;
                      setWorkingDirPickerOpen(true);
                    }}
                    onModelChange={codex.setModelDraft}
                    onEffortChange={codex.setEffortDraft}
                    onApprovalPolicyChange={codex.setApprovalPolicyDraft}
                    onSandboxModeChange={codex.setSandboxModeDraft}
                    onAddAttachments={codex.addImageAttachments}
                    onRemoveAttachment={codex.removeAttachment}
                    onAddFileMentions={codex.addFileMentions}
                    onRemoveMention={codex.removeMention}
                    onComposerInput={codex.setComposerText}
                    onResetComposer={codex.resetComposer}
                    onStartNewThreadDraft={codex.startNewThreadDraft}
                    onSend={() => void codex.sendTurn()}
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
        files={workingDirFiles()}
        initialPath={workingDirPickerInitialPath()}
        homePath={homePath()}
        onExpand={(path) => {
          void loadWorkingDirTree(path);
        }}
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
