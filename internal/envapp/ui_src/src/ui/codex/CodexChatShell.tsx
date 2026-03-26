import { For, Show, createMemo } from 'solid-js';
import { Refresh, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tag } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import { CodexComposerShell } from './CodexComposerShell';
import { CodexTranscript } from './CodexTranscript';
import {
  displayStatus,
  formatRelativeThreadTime,
  requestTagVariant,
  statusTagVariant,
} from './presentation';

function Banner(props: {
  title: string;
  body: string;
  tone?: 'warning' | 'neutral';
}) {
  return (
    <div class={`rounded-xl border px-4 py-3 text-xs shadow-sm ${
      props.tone === 'warning'
        ? 'border-warning/30 bg-warning/10 text-warning'
        : 'border-border/60 bg-card/70 text-muted-foreground'
    }`}>
      <div class={`font-medium ${props.tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
        {props.title}
      </div>
      <div class="mt-1 leading-6">{props.body}</div>
    </div>
  );
}

function PendingRequestsPanel() {
  const codex = useCodexContext();

  return (
    <div class="rounded-2xl border border-warning/25 bg-warning/[0.07] p-4 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-sm font-medium text-foreground">Pending Codex requests</div>
          <div class="mt-1 text-xs leading-5 text-muted-foreground">
            Resolve these to let the active Codex run continue.
          </div>
        </div>
        <Tag variant="warning" tone="soft" size="sm">
          {codex.pendingRequests().length}
        </Tag>
      </div>

      <div class="mt-4 flex max-h-80 flex-col gap-3 overflow-auto pr-1">
        <For each={codex.pendingRequests()}>
          {(request) => (
            <div class="rounded-xl border border-border/60 bg-background/85 p-4">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {request.type.replaceAll('_', ' ')}
                    </div>
                    <Tag variant={requestTagVariant(request.type)} tone="soft" size="sm">
                      {displayStatus(request.type, 'Request')}
                    </Tag>
                  </div>
                  <div class="mt-2 text-sm leading-6 text-foreground">
                    {request.reason || 'Codex needs a response before it can continue.'}
                  </div>
                </div>
                <Tag variant="neutral" tone="soft" size="sm">
                  Item {request.item_id}
                </Tag>
              </div>

              <Show when={request.command}>
                <div class="mt-3 rounded-xl border border-border/60 bg-muted/10 p-3 font-mono text-xs text-foreground">
                  <div class="mb-1 text-[11px] text-muted-foreground">{request.cwd || 'Working directory unavailable'}</div>
                  {request.command}
                </div>
              </Show>

              <Show when={(request.questions?.length ?? 0) > 0}>
                <div class="mt-3 space-y-3">
                  <For each={request.questions ?? []}>
                    {(question) => (
                      <div class="rounded-xl border border-border/60 bg-muted/10 p-3">
                        <div class="text-sm font-medium text-foreground">{question.header}</div>
                        <div class="mt-1 text-sm leading-6 text-muted-foreground">{question.question}</div>
                        <Input
                          type={question.is_secret ? 'password' : 'text'}
                          value={codex.requestDraftValue(request.id, question.id)}
                          onInput={(event) => codex.setRequestDraftValue(request.id, question.id, event.currentTarget.value)}
                          placeholder={question.options?.[0]?.label || 'Enter response'}
                          class="mt-3 w-full"
                        />
                        <Show when={(question.options?.length ?? 0) > 0}>
                          <div class="mt-3 flex flex-wrap gap-2">
                            <For each={question.options ?? []}>
                              {(option) => (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => codex.setRequestDraftValue(request.id, question.id, option.label)}
                                >
                                  {option.label}
                                </Button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="mt-4 flex flex-wrap gap-2">
                <Show
                  when={request.type === 'user_input'}
                  fallback={
                    <>
                      <Button size="sm" onClick={() => void codex.answerRequest(request, 'accept')}>
                        Approve once
                      </Button>
                      <Show when={(request.available_decisions ?? []).includes('accept_for_session')}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void codex.answerRequest(request, 'accept_for_session')}
                        >
                          Approve for session
                        </Button>
                      </Show>
                      <Button size="sm" variant="outline" onClick={() => void codex.answerRequest(request, 'decline')}>
                        Decline
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void codex.answerRequest(request, 'cancel')}>
                        Cancel
                      </Button>
                    </>
                  }
                >
                  <Button size="sm" onClick={() => void codex.answerRequest(request)}>
                    Submit response
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void codex.answerRequest(request, 'cancel')}>
                    Cancel
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function CodexChatShell() {
  const codex = useCodexContext();

  const workspaceLabel = createMemo(() => {
    const thread = codex.activeThread();
    const candidates = [thread?.path, thread?.cwd, codex.workingDirDraft(), codex.status()?.agent_home_dir];
    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) return value;
    }
    return '';
  });
  const modelLabel = createMemo(() => codex.modelDraft() || codex.activeThread()?.model_provider || '');
  const latestActivityLabel = createMemo(() => {
    const activeThread = codex.activeThread();
    if (!activeThread) return '';
    return formatRelativeThreadTime(activeThread.updated_at_unix_s);
  });

  const emptyStateTitle = () => (codex.hasHostBinary() ? 'Hello! I’m Codex' : 'Install Codex on the host');
  const emptyStateBody = () =>
    codex.hasHostBinary()
      ? 'This shell keeps Codex threads, approvals, and transcript evidence independent from Flower while matching the same compact conversation rhythm.'
      : 'Redeven does not install Codex for you. Put the host machine\'s `codex` binary on PATH, then refresh this page to start a dedicated Codex chat.';

  return (
    <div class="flex h-full min-h-0 flex-col bg-muted/[0.03]">
      <div class="border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <CodexIcon class="h-8 w-8 shrink-0" />
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-foreground">{codex.threadTitle()}</div>
              <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Show when={workspaceLabel()}>
                  <span class="truncate rounded-full border border-border/60 bg-muted/15 px-2 py-0.5" title={workspaceLabel()}>
                    {workspaceLabel()}
                  </span>
                </Show>
                <Show when={latestActivityLabel()}>
                  <span>{latestActivityLabel()}</span>
                </Show>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Tag variant={statusTagVariant(codex.activeStatus())} tone="soft" size="sm">
              {displayStatus(codex.activeStatus(), 'idle')}
            </Tag>
            <Show when={modelLabel()}>
              <Tag variant="neutral" tone="soft" size="sm">
                {modelLabel()}
              </Tag>
            </Show>
            <Tag variant={codex.hasHostBinary() ? 'success' : 'warning'} tone="soft" size="sm">
              {codex.hasHostBinary() ? 'Host ready' : 'Install required'}
            </Tag>
            <Show when={codex.pendingRequests().length > 0}>
              <Tag variant="warning" tone="soft" size="sm">
                {codex.pendingRequests().length} pending
              </Tag>
            </Show>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void codex.refreshActiveThread()}
              disabled={!codex.activeThreadID() || codex.refreshingThread()}
            >
              <Refresh class="mr-1 h-4 w-4" />
              {codex.refreshingThread() ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void codex.archiveActiveThread()}
              disabled={!codex.activeThreadID()}
            >
              <Trash class="mr-1 h-4 w-4" />
              Archive
            </Button>
          </div>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="relative min-h-0 flex-1 overflow-auto">
          <div class="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_top,rgba(88,102,123,0.14),transparent_72%)]" />
          <div class="pointer-events-none absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
          <div class="relative mx-auto flex h-full w-full max-w-5xl flex-col">
            <div class="space-y-3 px-4 pt-5 lg:px-6">
              <Show when={codex.statusError()}>
                <Banner title="Status error" body={codex.statusError() || ''} tone="warning" />
              </Show>
              <Show when={codex.streamError()}>
                <Banner title="Live event stream" body={`Live event stream disconnected: ${codex.streamError()}`} tone="warning" />
              </Show>
              <Show when={!codex.hasHostBinary()}>
                <Banner
                  title="Host diagnostics"
                  body="Redeven uses the host machine's `codex` binary directly. There is no separate in-app Codex runtime toggle to manage here."
                  tone="warning"
                />
              </Show>
            </div>

            <div class="min-h-0 flex-1">
              <CodexTranscript
                items={codex.transcriptItems()}
                emptyTitle={emptyStateTitle()}
                emptyBody={emptyStateBody()}
                onSuggestionClick={(prompt) => codex.setComposerText(prompt)}
                suggestionDisabled={!codex.hasHostBinary()}
              />
            </div>
          </div>
        </div>

        <div class="relative border-t border-border/80 bg-background/95 backdrop-blur-md">
          <div class="pointer-events-none absolute inset-x-0 bottom-full h-16 bg-gradient-to-t from-background via-background/85 to-transparent" />
          <div class="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3 lg:px-6">
            <Show when={codex.pendingRequests().length > 0}>
              <PendingRequestsPanel />
            </Show>

            <CodexComposerShell
              activeThreadID={codex.activeThreadID()}
              activeStatus={codex.activeStatus()}
              statusFlags={codex.activeStatusFlags()}
              workspaceLabel={codex.workingDirDraft()}
              modelLabel={codex.modelDraft()}
              composerText={codex.composerText()}
              submitting={codex.submitting()}
              hostAvailable={codex.hasHostBinary()}
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
