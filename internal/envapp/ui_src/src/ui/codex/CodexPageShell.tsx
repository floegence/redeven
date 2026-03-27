import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { useCodexContext } from './CodexProvider';
import { CodexComposerShell } from './CodexComposerShell';
import { CodexHeaderBar } from './CodexHeaderBar';
import { CodexPendingRequestsPanel } from './CodexPendingRequestsPanel';
import { CodexStatusBannerStack } from './CodexStatusBannerStack';
import { CodexTranscript } from './CodexTranscript';
import { isWorkingStatus } from './presentation';
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
import type { CodexOptimisticUserTurn, CodexTranscriptItem } from './types';

type ComposerOption = Readonly<{
  value: string;
  label: string;
}>;

const TRANSCRIPT_AUTO_FOLLOW_THRESHOLD_PX = 72;

function transcriptItemActivityKey(item: CodexTranscriptItem): string {
  return [
    item.id,
    item.type,
    String(item.status ?? '').trim(),
    String(item.text ?? '').length,
    String(item.aggregated_output ?? '').length,
    (item.summary ?? []).map((entry) => String(entry ?? '').length).join(','),
    (item.content ?? []).map((entry) => String(entry ?? '').length).join(','),
    (item.changes ?? []).map((change) => `${change.path}:${String(change.diff ?? '').length}`).join(','),
  ].join(':');
}

function optimisticTurnActivityKey(turn: CodexOptimisticUserTurn): string {
  return [
    turn.id,
    turn.thread_id,
    String(turn.text ?? '').length,
    turn.inputs.map((entry) => `${entry.type}:${String(entry.text ?? entry.path ?? entry.url ?? entry.name ?? '').length}`).join(','),
  ].join(':');
}

function transcriptDistanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

export function CodexPageShell() {
  const codex = useCodexContext();
  const [autoFollowTranscript, setAutoFollowTranscript] = createSignal(true);
  let transcriptScrollEl: HTMLDivElement | undefined;
  let followFrameOuter: number | null = null;
  let followFrameInner: number | null = null;

  const cancelPendingTranscriptFollow = () => {
    if (followFrameOuter !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(followFrameOuter);
    }
    if (followFrameInner !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(followFrameInner);
    }
    followFrameOuter = null;
    followFrameInner = null;
  };

  const syncTranscriptAutoFollow = () => {
    const element = transcriptScrollEl;
    if (!element) return;
    setAutoFollowTranscript(transcriptDistanceFromBottom(element) <= TRANSCRIPT_AUTO_FOLLOW_THRESHOLD_PX);
  };

  const scheduleTranscriptFollow = () => {
    const element = transcriptScrollEl;
    if (!element) return;

    cancelPendingTranscriptFollow();

    if (typeof requestAnimationFrame !== 'function') {
      element.scrollTop = element.scrollHeight;
      return;
    }

    followFrameOuter = requestAnimationFrame(() => {
      followFrameOuter = null;
      followFrameInner = requestAnimationFrame(() => {
        followFrameInner = null;
        if (!autoFollowTranscript()) return;
        const target = transcriptScrollEl;
        if (!target) return;
        target.scrollTop = target.scrollHeight;
      });
    });
  };

  onCleanup(() => {
    cancelPendingTranscriptFollow();
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
      ? 'Start a Codex conversation with a prompt, or attach an image to give Codex visual context.'
      : 'Redeven does not install Codex for you. Put the host machine\'s `codex` binary on PATH, then refresh this page to start a dedicated Codex chat.'
  );
  const modelValue = createMemo(() => String(codex.modelDraft() ?? '').trim());
  const effortValue = createMemo(() => String(codex.effortDraft() ?? '').trim());
  const approvalPolicyValue = createMemo(() => String(codex.approvalPolicyDraft() ?? '').trim());
  const sandboxModeValue = createMemo(() => String(codex.sandboxModeDraft() ?? '').trim());
  const workingDirValue = createMemo(() => String(codex.workingDirDraft() ?? summary().workspaceLabel ?? '').trim());
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
  const transcriptFollowVersion = createMemo(() => [
    codex.activeThreadID() ?? '__new__',
    shouldShowWorkingState() ? 'working' : 'idle',
    codex.transcriptItems().map(transcriptItemActivityKey).join('|'),
    codex.activeOptimisticUserTurns().map(optimisticTurnActivityKey).join('|'),
  ].join('::'));

  createEffect(() => {
    codex.activeThreadID();
    setAutoFollowTranscript(true);
    scheduleTranscriptFollow();
  });

  createEffect(() => {
    transcriptFollowVersion();
    if (!autoFollowTranscript()) return;
    scheduleTranscriptFollow();
  });

  return (
    <div data-codex-surface="page-shell" class="codex-page-shell">
      <CodexHeaderBar
        summary={summary()}
        canArchive={Boolean(codex.activeThreadID())}
        onArchive={() => void codex.archiveActiveThread()}
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
              transcriptScrollEl = element;
              syncTranscriptAutoFollow();
              scheduleTranscriptFollow();
            }}
            class="codex-page-transcript-main"
            data-codex-transcript-scroll-region="true"
            onScroll={syncTranscriptAutoFollow}
          >
            <div class="relative mx-auto flex h-full w-full max-w-5xl flex-col">
              <CodexTranscript
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
        </div>

        <div class="codex-page-bottom-dock">
          <div class="codex-page-bottom-support">
            <Show when={codex.pendingRequests().length > 0}>
              <CodexPendingRequestsPanel
                requests={codex.pendingRequests()}
                requestDraftValue={codex.requestDraftValue}
                setRequestDraftValue={codex.setRequestDraftValue}
                onAnswer={(request, decision) => void codex.answerRequest(request, decision)}
              />
            </Show>

            <CodexComposerShell
              workspaceLabel={workingDirValue()}
              modelValue={modelValue()}
              modelOptions={modelOptions()}
              effortValue={effortValue()}
              effortOptions={effortOptions()}
              approvalPolicyValue={approvalPolicyValue()}
              approvalPolicyOptions={approvalPolicyOptions()}
              sandboxModeValue={sandboxModeValue()}
              sandboxModeOptions={sandboxModeOptions()}
              attachments={codex.attachments()}
              supportsImages={supportsImages()}
              capabilitiesLoading={codex.capabilitiesLoading()}
              composerText={codex.composerText()}
              submitting={codex.submitting()}
              hostAvailable={summary().hostReady}
              onWorkspaceInput={codex.setWorkingDirDraft}
              onModelChange={codex.setModelDraft}
              onEffortChange={codex.setEffortDraft}
              onApprovalPolicyChange={codex.setApprovalPolicyDraft}
              onSandboxModeChange={codex.setSandboxModeDraft}
              onAddAttachments={codex.addImageAttachments}
              onRemoveAttachment={codex.removeAttachment}
              onComposerInput={codex.setComposerText}
              onSend={() => void codex.sendTurn()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
