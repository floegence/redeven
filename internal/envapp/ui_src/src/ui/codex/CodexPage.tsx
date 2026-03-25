import { For, Show, type JSX } from 'solid-js';
import { Code, FileText, Refresh, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Input } from '@floegence/floe-webapp-core/ui';

import { CodexIcon } from '../icons/CodexIcon';
import { useCodexContext } from './CodexProvider';
import type { CodexItem, CodexTranscriptItem } from './types';

function itemTitle(item: CodexItem): string {
  switch (item.type) {
    case 'userMessage':
      return 'You';
    case 'agentMessage':
      return 'Codex';
    case 'commandExecution':
      return 'Command';
    case 'fileChange':
      return 'File change';
    case 'reasoning':
      return 'Reasoning';
    case 'plan':
      return 'Plan';
    default:
      return item.type || 'Event';
  }
}

function itemBody(item: CodexTranscriptItem): JSX.Element {
  switch (item.type) {
    case 'commandExecution':
      return (
        <div class="space-y-3">
          <div class="rounded-2xl border border-slate-900/80 bg-slate-950 p-3 font-mono text-xs text-slate-200 shadow-inner">
            <div class="mb-2 text-[11px] text-slate-400">{item.cwd || 'Working directory unavailable'}</div>
            <div>{item.command || 'Command unavailable'}</div>
            <Show when={item.aggregated_output}>
              <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-300">
                {item.aggregated_output}
              </pre>
            </Show>
          </div>
          <div class="text-[11px] text-muted-foreground">
            <Show when={item.status}><span>Status: {item.status}</span></Show>
            <Show when={typeof item.exit_code === 'number'}>
              <span>{item.status ? ' | ' : ''}Exit code: {item.exit_code}</span>
            </Show>
          </div>
        </div>
      );
    case 'fileChange':
      return (
        <div class="space-y-2">
          <For each={item.changes ?? []}>
            {(change) => (
              <div class="rounded-2xl border border-border/80 bg-muted/20 p-3">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="truncate font-mono text-xs text-foreground">{change.path}</div>
                  <div class="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {change.kind}
                  </div>
                </div>
                <Show when={change.move_path}>
                  <div class="mb-2 text-[11px] text-muted-foreground">Move path: {change.move_path}</div>
                </Show>
                <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-background/90 p-2 font-mono text-[11px] text-muted-foreground">
                  {change.diff || 'No diff provided.'}
                </pre>
              </div>
            )}
          </For>
          <Show when={(item.changes?.length ?? 0) === 0}>
            <div class="text-sm text-muted-foreground">No file change details were provided yet.</div>
          </Show>
        </div>
      );
    case 'reasoning':
      return (
        <div class="space-y-2">
          <Show when={(item.summary?.length ?? 0) > 0}>
            <ul class="space-y-1 text-sm text-foreground">
              <For each={item.summary}>{(entry) => <li>{entry}</li>}</For>
            </ul>
          </Show>
          <Show when={item.text}>
            <pre class="whitespace-pre-wrap break-words rounded-2xl bg-muted/20 p-3 text-sm text-muted-foreground">{item.text}</pre>
          </Show>
        </div>
      );
    case 'plan':
    case 'agentMessage':
    case 'userMessage':
    default:
      return <div class="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{item.text || 'No content.'}</div>;
  }
}

export function CodexPage() {
  const codex = useCodexContext();

  const emptyStateTitle = () => (codex.hasHostBinary() ? 'Start a dedicated Codex thread' : 'Install Codex on the host');
  const emptyStateBody = () =>
    codex.hasHostBinary()
      ? 'Use the shell sidebar to switch threads or create a fresh Codex session. The transcript and approvals here stay fully separate from Flower.'
      : 'Redeven does not configure Codex for you. Install the host machine\'s `codex` binary, expose it on PATH, then refresh diagnostics to start local Codex sessions.';

  return (
    <div class="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(15,23,42,0.02),transparent_28%),linear-gradient(120deg,rgba(2,6,23,0.03),transparent_42%)]">
      <Show when={codex.statusLoading()}>
        <LoadingOverlay visible message="Loading Codex..." />
      </Show>

      <div class="border-b border-border/80 bg-background/85 px-6 py-5 backdrop-blur">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="flex items-start gap-3">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary ring-1 ring-primary/15">
                <CodexIcon class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Codex workspace</div>
                <h2 class="mt-1 truncate text-xl font-semibold tracking-tight text-foreground">{codex.threadTitle()}</h2>
                <div class="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span class="rounded-full border border-border/70 bg-background px-2.5 py-1">
                    Bridge: {codex.status()?.ready ? 'Connected' : 'Starts on demand'}
                  </span>
                  <span class="rounded-full border border-border/70 bg-background px-2.5 py-1">
                    Runtime: {codex.hasHostBinary() ? 'Host Codex detected' : 'Waiting for host install'}
                  </span>
                  <span class="max-w-full truncate rounded-full border border-border/70 bg-background px-2.5 py-1">
                    Binary: {codex.status()?.binary_path || 'Not detected'}
                  </span>
                  <span class="max-w-full truncate rounded-full border border-border/70 bg-background px-2.5 py-1">
                    Working dir: {codex.workingDirDraft() || codex.status()?.agent_home_dir || 'Set below'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void codex.refreshActiveThread()} disabled={!codex.activeThreadID() || codex.refreshingThread()}>
              <Refresh class="mr-2 h-4 w-4" />
              {codex.refreshingThread() ? 'Refreshing...' : 'Refresh'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void codex.archiveActiveThread()} disabled={!codex.activeThreadID()}>
              <Trash class="mr-2 h-4 w-4" />
              Archive
            </Button>
          </div>
        </div>

        <Show when={!codex.hasHostBinary()}>
          <div class="mt-4 rounded-[1.25rem] border border-border/80 bg-muted/20 p-4">
            <div class="text-sm font-semibold text-foreground">Host diagnostics</div>
            <div class="mt-1 text-sm leading-6 text-muted-foreground">
              Redeven uses the host machine&apos;s <span class="font-mono">codex</span> binary directly. Install it on the host and keep it on
              <span class="font-mono"> PATH</span>; there is no separate in-app Codex runtime toggle to manage here.
            </div>
          </div>
        </Show>

        <Show when={codex.statusError()}>
          <div class="mt-4 rounded-[1.25rem] border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning">
            {codex.statusError()}
          </div>
        </Show>

        <Show when={codex.streamError()}>
          <div class="mt-4 rounded-[1.25rem] border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning">
            Live event stream disconnected: {codex.streamError()}
          </div>
        </Show>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 overflow-auto px-6 py-6">
          <Show
            when={codex.transcriptItems().length > 0}
            fallback={
              <div class="flex h-full min-h-[18rem] items-center justify-center">
                <div class="max-w-2xl rounded-[1.75rem] border border-border/80 bg-background/80 p-8 text-center shadow-sm">
                  <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary ring-1 ring-primary/15">
                    <CodexIcon class="h-8 w-8" />
                  </div>
                  <div class="mt-5 text-xl font-semibold tracking-tight text-foreground">{emptyStateTitle()}</div>
                  <div class="mt-3 text-sm leading-7 text-muted-foreground">{emptyStateBody()}</div>
                  <div class="mt-5 flex flex-wrap justify-center gap-2 text-[11px] text-muted-foreground">
                    <span class="rounded-full border border-border/70 bg-muted/10 px-3 py-1">Dedicated activity-bar entry</span>
                    <span class="rounded-full border border-border/70 bg-muted/10 px-3 py-1">Separate gateway namespace</span>
                    <span class="rounded-full border border-border/70 bg-muted/10 px-3 py-1">Independent from Flower state</span>
                  </div>
                </div>
              </div>
            }
          >
            <div class="mx-auto flex w-full max-w-5xl flex-col gap-4">
              <For each={codex.transcriptItems()}>
                {(item) => (
                  <div class="rounded-[1.5rem] border border-border/80 bg-background/85 p-4 shadow-sm">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div class="flex items-center gap-3">
                        <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Show when={item.type === 'commandExecution'} fallback={<FileText class="h-4 w-4" />}>
                            <Terminal class="h-4 w-4" />
                          </Show>
                        </div>
                        <div>
                          <div class="text-sm font-semibold text-foreground">{itemTitle(item)}</div>
                          <div class="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{item.type}</div>
                        </div>
                      </div>

                      <Show when={item.status}>
                        <div class="rounded-full border border-border/70 bg-muted/20 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {item.status}
                        </div>
                      </Show>
                    </div>
                    {itemBody(item)}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={codex.pendingRequests().length > 0}>
          <div class="border-t border-border/80 bg-background/70 px-6 py-4">
            <div class="mx-auto flex w-full max-w-5xl flex-col gap-3">
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pending Codex requests</div>
              <For each={codex.pendingRequests()}>
                {(request) => (
                  <div class="rounded-[1.5rem] border border-border/80 bg-background p-4 shadow-sm">
                    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold capitalize text-foreground">{request.type.replaceAll('_', ' ')}</div>
                        <div class="text-xs text-muted-foreground">{request.reason || 'Codex needs a response to continue this turn.'}</div>
                      </div>
                      <div class="text-[11px] text-muted-foreground">Item: {request.item_id}</div>
                    </div>

                    <Show when={request.command}>
                      <div class="mb-3 rounded-2xl border border-border/80 bg-muted/20 p-3 font-mono text-xs text-foreground">
                        <div class="mb-2 text-[11px] text-muted-foreground">{request.cwd || 'Working directory unavailable'}</div>
                        {request.command}
                      </div>
                    </Show>

                    <Show when={request.permissions}>
                      <div class="mb-3 rounded-2xl border border-border/80 bg-muted/20 p-3 text-sm text-muted-foreground">
                        <div>Requested permissions:</div>
                        <Show when={(request.permissions?.file_system_write?.length ?? 0) > 0}>
                          <div class="mt-1">Write: {(request.permissions?.file_system_write ?? []).join(', ')}</div>
                        </Show>
                        <Show when={(request.permissions?.file_system_read?.length ?? 0) > 0}>
                          <div class="mt-1">Read: {(request.permissions?.file_system_read ?? []).join(', ')}</div>
                        </Show>
                        <Show when={request.permissions?.network_enabled}>
                          <div class="mt-1">Network access requested</div>
                        </Show>
                      </div>
                    </Show>

                    <Show when={(request.questions?.length ?? 0) > 0}>
                      <div class="mb-3 space-y-3">
                        <For each={request.questions ?? []}>
                          {(question) => (
                            <div class="rounded-2xl border border-border/80 bg-muted/20 p-3">
                              <div class="mb-1 text-sm font-semibold text-foreground">{question.header}</div>
                              <div class="mb-3 text-sm text-muted-foreground">{question.question}</div>
                              <Input
                                type={question.is_secret ? 'password' : 'text'}
                                value={codex.requestDraftValue(request.id, question.id)}
                                onInput={(event) => codex.setRequestDraftValue(request.id, question.id, event.currentTarget.value)}
                                placeholder={question.options?.[0]?.label || 'Enter response'}
                                class="w-full"
                              />
                              <Show when={(question.options?.length ?? 0) > 0}>
                                <div class="mt-2 flex flex-wrap gap-2">
                                  <For each={question.options ?? []}>
                                    {(option) => (
                                      <button
                                        type="button"
                                        class="rounded-full border border-border/70 bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                                        onClick={() => codex.setRequestDraftValue(request.id, question.id, option.label)}
                                      >
                                        {option.label}
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div class="flex flex-wrap gap-2">
                      <Show
                        when={request.type === 'user_input'}
                        fallback={
                          <>
                            <Button size="sm" onClick={() => void codex.answerRequest(request, 'accept')}>
                              Approve once
                            </Button>
                            <Show when={(request.available_decisions ?? []).includes('accept_for_session')}>
                              <Button size="sm" variant="outline" onClick={() => void codex.answerRequest(request, 'accept_for_session')}>
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
        </Show>

        <div class="border-t border-border/80 bg-background/92 px-6 py-4 backdrop-blur">
          <div class="mx-auto max-w-5xl rounded-[1.75rem] border border-border/80 bg-background p-4 shadow-sm">
            <div class="mb-4 flex items-start gap-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Code class="h-4 w-4" />
              </div>
              <div>
                <div class="text-sm font-semibold text-foreground">Codex composer</div>
                <div class="mt-1 text-sm leading-6 text-muted-foreground">
                  Send implementation tasks here while keeping Codex routes, thread state, and approvals isolated from Flower.
                </div>
              </div>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <label class="block">
                <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Working directory</div>
                <Input
                  value={codex.workingDirDraft()}
                  onInput={(event) => codex.setWorkingDirDraft(event.currentTarget.value)}
                  placeholder={codex.status()?.agent_home_dir || 'Absolute workspace path'}
                  class="w-full"
                />
              </label>

              <label class="block">
                <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Model override</div>
                <Input
                  value={codex.modelDraft()}
                  onInput={(event) => codex.setModelDraft(event.currentTarget.value)}
                  placeholder="Use host Codex default model"
                  class="w-full"
                />
              </label>
            </div>

            <label class="mt-4 block">
              <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Prompt</div>
              <textarea
                value={codex.composerText()}
                onInput={(event) => codex.setComposerText(event.currentTarget.value)}
                rows={5}
                placeholder="Describe the change, bug, or task for Codex..."
                class="min-h-[7.5rem] w-full rounded-[1.25rem] border border-border bg-muted/10 px-4 py-3 text-sm text-foreground outline-none transition-[border,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </label>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div class="text-xs leading-6 text-muted-foreground">
                The shell sidebar owns thread navigation now, so this page can stay focused on transcript, approvals, and composing the next turn.
              </div>
              <Button onClick={() => void codex.sendTurn()} disabled={!String(codex.composerText() ?? '').trim() || codex.submitting()}>
                {codex.submitting() ? 'Sending...' : codex.activeThreadID() ? 'Send to Codex' : 'Create thread and send'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
