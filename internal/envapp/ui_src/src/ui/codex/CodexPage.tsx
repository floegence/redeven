import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, type JSX } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { Code, FileText, Pencil, Refresh, Terminal, Trash } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Input } from '@floegence/floe-webapp-core/ui';

import { useEnvContext } from '../pages/EnvContext';
import {
  archiveCodexThread,
  connectCodexEventStream,
  fetchCodexStatus,
  listCodexThreads,
  openCodexThread,
  respondToCodexRequest,
  startCodexThread,
  startCodexTurn,
} from './api';
import { applyCodexEvent, buildCodexThreadSession } from './state';
import type {
  CodexItem,
  CodexPendingRequest,
  CodexThread,
  CodexThreadDetail,
  CodexThreadSession,
  CodexTranscriptItem,
} from './types';

function formatUpdatedAt(unixSeconds: number): string {
  const value = Number(unixSeconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value * 1000).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

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
          <div class="rounded-lg border border-border/80 bg-black/95 p-3 font-mono text-xs text-zinc-200">
            <div class="mb-2 text-[11px] text-zinc-400">{item.cwd || 'Working directory unavailable'}</div>
            <div>{item.command || 'Command unavailable'}</div>
            <Show when={item.aggregated_output}>
              <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] text-zinc-300">
                {item.aggregated_output}
              </pre>
            </Show>
          </div>
          <div class="text-[11px] text-muted-foreground">
            <Show when={item.status}><span>Status: {item.status}</span></Show>
            <Show when={typeof item.exit_code === 'number'}>
              <span>{item.status ? ' · ' : ''}Exit code: {item.exit_code}</span>
            </Show>
          </div>
        </div>
      );
    case 'fileChange':
      return (
        <div class="space-y-2">
          <For each={item.changes ?? []}>
            {(change) => (
              <div class="rounded-lg border border-border/80 bg-muted/35 p-3">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="truncate font-mono text-xs text-foreground">{change.path}</div>
                  <div class="rounded-full bg-background px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {change.kind}
                  </div>
                </div>
                <Show when={change.move_path}>
                  <div class="mb-2 text-[11px] text-muted-foreground">Move path: {change.move_path}</div>
                </Show>
                <pre class="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/80 p-2 font-mono text-[11px] text-muted-foreground">
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
            <pre class="whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-3 text-sm text-muted-foreground">{item.text}</pre>
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

type CodexRequestDrafts = Record<string, Record<string, string>>;

export function CodexPage() {
  const notify = useNotification();
  const env = useEnvContext();

  const [activeThreadID, setActiveThreadID] = createSignal<string | null>(null);
  const [preferBlankComposer, setPreferBlankComposer] = createSignal(false);
  const [session, setSession] = createSignal<CodexThreadSession | null>(null);
  const [workingDirDraft, setWorkingDirDraft] = createSignal('');
  const [modelDraft, setModelDraft] = createSignal('');
  const [composerText, setComposerText] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [refreshingThread, setRefreshingThread] = createSignal(false);
  const [requestDrafts, setRequestDrafts] = createSignal<CodexRequestDrafts>({});
  const [streamError, setStreamError] = createSignal<string | null>(null);

  const [status] = createResource(() => env.settingsSeq(), async () => fetchCodexStatus());
  const [threads, { refetch: refetchThreads }] = createResource(
    () => (status.loading ? null : status()?.enabled ? env.settingsSeq() : null),
    async () => (status()?.enabled ? listCodexThreads(100) : []),
  );
  const [threadDetail, { refetch: refetchThreadDetail }] = createResource(
    () => activeThreadID(),
    async (threadID) => (threadID ? openCodexThread(threadID) : null),
  );

  createEffect(() => {
    const currentStatus = status();
    if (!currentStatus) return;
    if (!workingDirDraft()) {
      setWorkingDirDraft(String(currentStatus.agent_home_dir ?? '').trim());
    }
    if (!modelDraft()) {
      setModelDraft(String(currentStatus.default_model ?? '').trim());
    }
  });

  createEffect(() => {
    const list = threads();
    if (!Array.isArray(list)) return;
    const current = String(activeThreadID() ?? '').trim();
    if (current && list.some((thread) => thread.id === current)) return;
    if (preferBlankComposer()) return;
    setActiveThreadID(list[0]?.id ?? null);
  });

  createEffect(() => {
    const detail = threadDetail();
    if (!detail) {
      setSession(null);
      return;
    }
    setSession(buildCodexThreadSession(detail));
    setStreamError(null);
  });

  createEffect(() => {
    const currentSession = session();
    const threadID = String(currentSession?.thread.id ?? '').trim();
    if (!threadID) return;

    const controller = new AbortController();
    setStreamError(null);
    void connectCodexEventStream({
      threadID,
      afterSeq: 0,
      signal: controller.signal,
      onEvent: (event) => {
        setSession((prev) => applyCodexEvent(prev, event));
      },
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setStreamError(error instanceof Error ? error.message : String(error));
    });

    onCleanup(() => controller.abort());
  });

  const transcriptItems = createMemo<CodexTranscriptItem[]>(() => {
    const current = session();
    if (!current) return [];
    return current.item_order
      .map((itemID) => current.items_by_id[itemID])
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  });

  const pendingRequests = createMemo<CodexPendingRequest[]>(() => {
    const current = session();
    if (!current) return [];
    return Object.values(current.pending_requests);
  });

  const activeThread = createMemo<CodexThread | null>(() => session()?.thread ?? null);
  const threadTitle = createMemo(() => {
    const thread = activeThread();
    if (!thread) return 'New thread';
    return String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread';
  });

  const selectThread = (threadID: string) => {
    setPreferBlankComposer(false);
    setActiveThreadID(threadID);
  };

  const startNewThreadDraft = () => {
    setPreferBlankComposer(true);
    setActiveThreadID(null);
    setSession(null);
    setStreamError(null);
  };

  const refreshActiveThread = async () => {
    if (!activeThreadID()) return;
    setRefreshingThread(true);
    try {
      await Promise.all([refetchThreads(), refetchThreadDetail()]);
      setStreamError(null);
    } catch (error) {
      notify.error('Refresh failed', error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingThread(false);
    }
  };

  const sendTurn = async () => {
    const message = String(composerText() ?? '').trim();
    if (!message || submitting()) return;
    setSubmitting(true);
    try {
      let targetThreadID = String(activeThreadID() ?? '').trim();
      if (!targetThreadID) {
        const thread = await startCodexThread({
          cwd: workingDirDraft(),
          model: modelDraft(),
        });
        targetThreadID = thread.id;
        setPreferBlankComposer(false);
        setActiveThreadID(targetThreadID);
        const bootstrapDetail: CodexThreadDetail = {
          thread,
          pending_requests: [],
          last_event_seq: 0,
          active_status: thread.status,
          active_status_flags: thread.active_flags ?? [],
        };
        setSession(buildCodexThreadSession(bootstrapDetail));
      }
      await startCodexTurn({ threadID: targetThreadID, inputText: message });
      setComposerText('');
      void refetchThreads();
      void refetchThreadDetail();
    } catch (error) {
      notify.error('Send failed', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const archiveActiveThread = async () => {
    const threadID = String(activeThreadID() ?? '').trim();
    if (!threadID) return;
    try {
      await archiveCodexThread(threadID);
      notify.success('Archived', 'The Codex thread has been archived.');
      startNewThreadDraft();
      await refetchThreads();
    } catch (error) {
      notify.error('Archive failed', error instanceof Error ? error.message : String(error));
    }
  };

  const setRequestDraftValue = (requestID: string, questionID: string, value: string) => {
    setRequestDrafts((current) => ({
      ...current,
      [requestID]: {
        ...(current[requestID] ?? {}),
        [questionID]: value,
      },
    }));
  };

  const answerRequest = async (request: CodexPendingRequest, decision?: string) => {
    if (!session()) return;
    try {
      await respondToCodexRequest({
        threadID: request.thread_id,
        requestID: request.id,
        type: request.type,
        decision,
        answers: request.type === 'user_input' ? requestDrafts()[request.id] ?? {} : undefined,
      });
      notify.success('Submitted', 'Codex request response sent.');
    } catch (error) {
      notify.error('Request failed', error instanceof Error ? error.message : String(error));
    }
  };

  const showSetupState = createMemo(() => !status.loading && !status()?.enabled);
  const showStatusError = createMemo(() => String(status()?.error ?? '').trim());

  return (
    <div class="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,_rgba(120,119,198,0.08),_transparent_48%),linear-gradient(180deg,_rgba(255,255,255,0.02),_transparent_28%)]">
      <Show when={status.loading}>
        <LoadingOverlay visible message="Loading Codex..." />
      </Show>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <aside class="flex w-[18rem] shrink-0 flex-col border-r border-border/80 bg-background/80">
          <div class="border-b border-border/70 px-4 py-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Codex</div>
                <div class="mt-1 text-sm text-foreground">Independent app-server sessions</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void refetchThreads()} disabled={status.loading}>
                <Refresh class="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" class="w-full" onClick={startNewThreadDraft}>
              <Pencil class="mr-2 h-4 w-4" />
              New thread
            </Button>
          </div>

          <div class="min-h-0 flex-1 overflow-auto px-3 py-3">
            <Show when={(threads()?.length ?? 0) > 0} fallback={<div class="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">No Codex threads yet. Start a new one from this panel.</div>}>
              <div class="space-y-2">
                <For each={threads() ?? []}>
                  {(thread) => {
                    const active = () => activeThreadID() === thread.id;
                    return (
                      <button
                        type="button"
                        onClick={() => selectThread(thread.id)}
                        class="w-full rounded-xl border px-3 py-3 text-left transition-colors"
                        classList={{
                          'border-primary/40 bg-primary/10': active(),
                          'border-border/70 bg-background hover:bg-muted/35': !active(),
                        }}
                      >
                        <div class="mb-2 flex items-center justify-between gap-3">
                          <div class="truncate text-sm font-semibold text-foreground">
                            {String(thread.name ?? thread.preview ?? '').trim() || 'Untitled thread'}
                          </div>
                          <div class="rounded-full bg-background/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {thread.status}
                          </div>
                        </div>
                        <div class="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {thread.preview || thread.cwd || 'Thread has no preview yet.'}
                        </div>
                        <div class="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                          <span class="truncate">{thread.model_provider || 'provider n/a'}</span>
                          <span>{formatUpdatedAt(thread.updated_at_unix_s)}</span>
                        </div>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </aside>

        <main class="flex min-h-0 flex-1 flex-col">
          <div class="border-b border-border/80 bg-background/70 px-5 py-4 backdrop-blur">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <Code class="h-4 w-4 text-primary" />
                  <h2 class="text-lg font-semibold text-foreground">{threadTitle()}</h2>
                </div>
                <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span class="rounded-full border border-border/70 bg-background px-2 py-1">Model: {modelDraft() || status()?.default_model || 'default'}</span>
                  <span class="rounded-full border border-border/70 bg-background px-2 py-1">Approval: {status()?.approval_policy || 'default'}</span>
                  <span class="rounded-full border border-border/70 bg-background px-2 py-1">Sandbox: {status()?.sandbox_mode || 'default'}</span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={refreshActiveThread} disabled={!activeThreadID() || refreshingThread()}>
                  <Refresh class="mr-2 h-4 w-4" />
                  {refreshingThread() ? 'Refreshing...' : 'Refresh'}
                </Button>
                <Button size="sm" variant="outline" onClick={archiveActiveThread} disabled={!activeThreadID()}>
                  <Trash class="mr-2 h-4 w-4" />
                  Archive
                </Button>
              </div>
            </div>

            <Show when={showStatusError()}>
              <div class="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">{showStatusError()}</div>
            </Show>
            <Show when={streamError()}>
              <div class="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
                Live event stream disconnected: {streamError()}
              </div>
            </Show>
          </div>

          <Show when={showSetupState()}>
            <div class="m-5 rounded-2xl border border-dashed border-border/80 bg-background/80 p-6">
              <div class="mb-2 text-lg font-semibold text-foreground">Codex is disabled</div>
              <div class="max-w-2xl text-sm leading-6 text-muted-foreground">
                Enable the independent Codex integration from Agent Settings, then point it at a `codex` binary if it is not already available on `PATH`.
              </div>
              <div class="mt-4">
                <Button size="sm" variant="outline" onClick={() => env.openSettings('codex')}>
                  Open Codex Settings
                </Button>
              </div>
            </div>
          </Show>

          <Show when={!showSetupState()}>
            <div class="flex min-h-0 flex-1 flex-col">
              <div class="min-h-0 flex-1 overflow-auto px-5 py-5">
                <Show
                  when={transcriptItems().length > 0}
                  fallback={
                    <div class="flex h-full min-h-[16rem] items-center justify-center">
                      <div class="max-w-xl rounded-2xl border border-dashed border-border/80 bg-background/70 p-6 text-center">
                        <div class="mb-2 text-lg font-semibold text-foreground">Start a Codex session</div>
                        <div class="text-sm leading-6 text-muted-foreground">
                          Threads stay independent from Flower. Choose a working directory below and send the first message to create a new Codex thread.
                        </div>
                      </div>
                    </div>
                  }
                >
                  <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
                    <For each={transcriptItems()}>
                      {(item) => (
                        <div class="rounded-2xl border border-border/80 bg-background/75 p-4 shadow-sm">
                          <div class="mb-3 flex items-center justify-between gap-3">
                            <div class="flex items-center gap-2">
                              <div class="rounded-full bg-primary/10 p-2 text-primary">
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
                              <div class="rounded-full border border-border/70 bg-muted/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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

              <Show when={pendingRequests().length > 0}>
                <div class="border-t border-border/80 bg-background/70 px-5 py-4">
                  <div class="mx-auto flex w-full max-w-4xl flex-col gap-3">
                    <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Pending Codex requests</div>
                    <For each={pendingRequests()}>
                      {(request) => (
                        <div class="rounded-2xl border border-border/80 bg-background p-4 shadow-sm">
                          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div class="text-sm font-semibold text-foreground">{request.type.replaceAll('_', ' ')}</div>
                              <div class="text-xs text-muted-foreground">{request.reason || 'Codex needs a response to continue this turn.'}</div>
                            </div>
                            <div class="text-[11px] text-muted-foreground">Item: {request.item_id}</div>
                          </div>

                          <Show when={request.command}>
                            <div class="mb-3 rounded-lg border border-border/80 bg-muted/35 p-3 font-mono text-xs text-foreground">
                              <div class="mb-2 text-[11px] text-muted-foreground">{request.cwd || 'Working directory unavailable'}</div>
                              {request.command}
                            </div>
                          </Show>

                          <Show when={request.permissions}>
                            <div class="mb-3 rounded-lg border border-border/80 bg-muted/35 p-3 text-sm text-muted-foreground">
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
                                  <div class="rounded-lg border border-border/80 bg-muted/25 p-3">
                                    <div class="mb-1 text-sm font-semibold text-foreground">{question.header}</div>
                                    <div class="mb-3 text-sm text-muted-foreground">{question.question}</div>
                                    <Input
                                      type={question.is_secret ? 'password' : 'text'}
                                      value={requestDrafts()[request.id]?.[question.id] ?? ''}
                                      onInput={(event) => setRequestDraftValue(request.id, question.id, event.currentTarget.value)}
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
                                              onClick={() => setRequestDraftValue(request.id, question.id, option.label)}
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
                            <Show when={request.type === 'user_input'} fallback={
                              <>
                                <Button size="sm" onClick={() => void answerRequest(request, 'accept')}>
                                  Approve once
                                </Button>
                                <Show when={(request.available_decisions ?? []).includes('accept_for_session')}>
                                  <Button size="sm" variant="outline" onClick={() => void answerRequest(request, 'accept_for_session')}>
                                    Approve for session
                                  </Button>
                                </Show>
                                <Button size="sm" variant="outline" onClick={() => void answerRequest(request, 'decline')}>
                                  Decline
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => void answerRequest(request, 'cancel')}>
                                  Cancel
                                </Button>
                              </>
                            }>
                              <Button size="sm" onClick={() => void answerRequest(request)}>
                                Submit response
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void answerRequest(request, 'cancel')}>
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

              <div class="border-t border-border/80 bg-background/90 px-5 py-4">
                <div class="mx-auto flex w-full max-w-4xl flex-col gap-3">
                  <div class="grid gap-3 md:grid-cols-2">
                    <label class="block">
                      <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Working directory</div>
                      <Input
                        value={workingDirDraft()}
                        onInput={(event) => setWorkingDirDraft(event.currentTarget.value)}
                        placeholder={status()?.agent_home_dir || 'Absolute workspace path'}
                        class="w-full"
                      />
                    </label>
                    <label class="block">
                      <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Model override</div>
                      <Input
                        value={modelDraft()}
                        onInput={(event) => setModelDraft(event.currentTarget.value)}
                        placeholder={status()?.default_model || 'Use Codex default model'}
                        class="w-full"
                      />
                    </label>
                  </div>

                  <label class="block">
                    <div class="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Prompt</div>
                    <textarea
                      value={composerText()}
                      onInput={(event) => setComposerText(event.currentTarget.value)}
                      rows={5}
                      placeholder="Describe the change, bug, or task for Codex..."
                      class="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition-[border,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                  </label>

                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-muted-foreground">
                      Codex threads stay separate from Flower state, routes, and renderer logic.
                    </div>
                    <Button onClick={() => void sendTurn()} disabled={!String(composerText() ?? '').trim() || submitting()}>
                      {submitting() ? 'Sending...' : activeThreadID() ? 'Send to Codex' : 'Create thread and send'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </main>
      </div>
    </div>
  );
}
