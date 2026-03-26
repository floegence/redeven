import { For, Show, createMemo } from 'solid-js';

import { useCodexContext } from './CodexProvider';
import { CodexComposerShell } from './CodexComposerShell';
import { CodexHeaderBar } from './CodexHeaderBar';
import { CodexPendingRequestsPanel } from './CodexPendingRequestsPanel';
import { CodexStatusBannerStack } from './CodexStatusBannerStack';
import { CodexTranscript } from './CodexTranscript';
import { buildCodexWorkbenchSummary, type CodexWorkbenchMetric } from './viewModel';

function ToolbarChip(props: { metric: CodexWorkbenchMetric }) {
  return (
    <span
      class={`codex-page-chip codex-page-chip--${props.metric.tone}`}
      title={props.metric.title || props.metric.value}
    >
      <span class="codex-page-chip-label">{props.metric.label}</span>
      <span
        class={`codex-page-chip-value ${
          props.metric.id === 'workspace' ? 'codex-page-chip-value--path' : ''
        }`}
      >
        {props.metric.value}
      </span>
    </span>
  );
}

export function CodexPageShell() {
  const codex = useCodexContext();

  const summary = createMemo(() => buildCodexWorkbenchSummary({
    thread: codex.activeThread(),
    status: codex.status(),
    workingDirDraft: codex.workingDirDraft(),
    modelDraft: codex.modelDraft(),
    activeStatus: codex.activeStatus(),
    activeStatusFlags: codex.activeStatusFlags(),
    pendingRequests: codex.pendingRequests(),
    transcriptItems: codex.transcriptItems(),
  }));

  const showBannerStack = createMemo(() =>
    Boolean(codex.statusError() || codex.streamError() || !summary().hostReady),
  );

  const emptyStateTitle = () => (
    summary().hostReady
      ? 'Hello! I’m Codex'
      : 'Install Codex on the host'
  );
  const emptyStateBody = () => (
    summary().hostReady
      ? 'This shell keeps Codex threads, approvals, and transcript evidence independent from Flower while matching the same compact workbench rhythm.'
      : 'Redeven does not install Codex for you. Put the host machine\'s `codex` binary on PATH, then refresh this page to start a dedicated Codex chat.'
  );

  return (
    <div data-codex-surface="page-shell" class="codex-page-shell">
      <CodexHeaderBar
        summary={summary()}
        refreshing={codex.refreshingThread()}
        canRefresh={Boolean(codex.activeThreadID()) && !codex.refreshingThread()}
        canArchive={Boolean(codex.activeThreadID())}
        onRefresh={() => void codex.refreshActiveThread()}
        onArchive={() => void codex.archiveActiveThread()}
      />

      <div class="codex-page-main">
        <div class="codex-page-transcript">
          <Show when={showBannerStack()}>
            <div class="codex-page-status-stack">
              <CodexStatusBannerStack
                statusError={codex.statusError()}
                streamError={codex.streamError()}
                hostAvailable={summary().hostReady}
              />
            </div>
          </Show>

          <div class="codex-page-transcript-main">
            <div class="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,rgba(88,102,123,0.14),transparent_72%)]" />
            <div class="pointer-events-none absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
            <div class="relative mx-auto flex h-full w-full max-w-5xl flex-col">
              <CodexTranscript
                items={codex.transcriptItems()}
                emptyTitle={emptyStateTitle()}
                emptyBody={emptyStateBody()}
                onSuggestionClick={(prompt) => codex.setComposerText(prompt)}
                suggestionDisabled={!summary().hostReady}
              />
            </div>
          </div>
        </div>

        <div class="codex-page-bottom-dock">
          <Show when={summary().metrics.length > 0}>
            <div class="codex-page-toolbar">
              <div class="codex-page-toolbar-main">
                <div class="codex-page-toolbar-lane">
                  <For each={summary().metrics}>
                    {(metric) => <ToolbarChip metric={metric} />}
                  </For>
                </div>
              </div>
            </div>
          </Show>

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
              activeThreadID={codex.activeThreadID()}
              activeStatus={codex.activeStatus()}
              workspaceLabel={codex.workingDirDraft()}
              modelLabel={codex.modelDraft()}
              composerText={codex.composerText()}
              submitting={codex.submitting()}
              hostAvailable={summary().hostReady}
              onWorkspaceInput={codex.setWorkingDirDraft}
              onModelInput={codex.setModelDraft}
              onComposerInput={codex.setComposerText}
              onPromptSelect={codex.setComposerText}
              onSend={() => void codex.sendTurn()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
